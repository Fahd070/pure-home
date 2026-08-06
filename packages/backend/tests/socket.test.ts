// Regression coverage for the Socket.IO cross-role data-leak fix: room membership is
// derived exclusively from the verified JWT at connection time, and events are routed
// to specific roles/users/technicians rather than broadcast globally.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { io as ioClient, Socket } from 'socket.io-client';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, ensureTestAccessCodes, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

function connectSocket(baseUrl: string, token?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err: Error) => reject(err));
  });
}

function waitForEvent(socket: Socket, event: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data: any) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function assertEventNotReceived(socket: Socket, event: string, waitMs = 800): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve();
    }, waitMs);
    function onEvent() {
      clearTimeout(timer);
      reject(new Error(`Unexpectedly received "${event}"`));
    }
    socket.once(event, onEvent);
  });
}

describe('Socket.IO security regression', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, tech1Token: string, tech2Token: string;
  const openSockets: Socket[] = [];
  const createdCustomerIds: string[] = [];

  function track(socket: Socket): Socket {
    openSockets.push(socket);
    return socket;
  }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    await ensureTestAccessCodes();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    tech1Token = signTestToken(users.technician.id, 'TECHNICIAN');
    tech2Token = signTestToken(users.technician2.id, 'TECHNICIAN');
  });

  afterEach(() => {
    for (const s of openSockets.splice(0)) s.close();
  });

  afterAll(async () => {
    if (createdCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await ensureTestAccessCodes(); // restore in case a test rotated a code
    await stopTestServer(ts.server);
  });

  it('rejects a connection with no auth token', async () => {
    await expect(connectSocket(ts.baseUrl)).rejects.toBeTruthy();
  });

  it('rejects a connection with an invalid JWT', async () => {
    await expect(connectSocket(ts.baseUrl, 'not-a-real-token')).rejects.toBeTruthy();
  });

  it('accepts a valid ADMIN connection', async () => {
    const s = track(await connectSocket(ts.baseUrl, adminToken));
    expect(s.connected).toBe(true);
  });

  it('accepts a valid SCHEDULING connection', async () => {
    const s = track(await connectSocket(ts.baseUrl, schedToken));
    expect(s.connected).toBe(true);
  });

  it('accepts a valid TECHNICIAN connection', async () => {
    const s = track(await connectSocket(ts.baseUrl, tech1Token));
    expect(s.connected).toBe(true);
  });

  it('a TECHNICIAN socket does not receive an ADMIN/SCHEDULING-only customer:created event', async () => {
    const techSocket = track(await connectSocket(ts.baseUrl, tech1Token));
    const notReceived = assertEventNotReceived(techSocket, 'customer:created');

    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Socket Isolation Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Riyadh', district: 'Test', street: 'Test' },
      });
    expect(res.status).toBe(201);
    createdCustomerIds.push(res.body.data.id);

    await notReceived;
  });

  it('a SCHEDULING socket does not receive the ADMIN-only config:updated event', async () => {
    const schedSocket = track(await connectSocket(ts.baseUrl, schedToken));
    const notReceived = assertEventNotReceived(schedSocket, 'config:updated');

    const rotateRes = await request(ts.baseUrl)
      .put('/api/config/access-codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dept: 'admin', currentCode: '5001', newCode: '5001', confirmCode: '5001' });
    expect(rotateRes.status).toBe(200);

    await notReceived;
  });

  it('the assigned technician receives appointment:created; a different technician does not', async () => {
    const tech1Socket = track(await connectSocket(ts.baseUrl, tech1Token));
    const tech2Socket = track(await connectSocket(ts.baseUrl, tech2Token));

    const custRes = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Socket Appointment Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Riyadh', district: 'Test', street: 'Test' },
      });
    const customerId = custRes.body.data.id;
    createdCustomerIds.push(customerId);

    const tech1Received = waitForEvent(tech1Socket, 'appointment:created');
    const tech2NotReceived = assertEventNotReceived(tech2Socket, 'appointment:created');

    const apptRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        technicianId: users.technician.id,
      });
    expect(apptRes.status).toBe(201);

    const [received] = await Promise.all([tech1Received, tech2NotReceived]);
    expect(received.id).toBe(apptRes.body.data.id);

    await prisma.appointment.deleteMany({ where: { id: apptRes.body.data.id } });
  });
});
