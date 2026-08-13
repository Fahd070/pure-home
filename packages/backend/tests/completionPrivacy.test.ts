// Modification #6: (A) an optional "Next Maintenance Note" recorded at completion,
// visible to Admin/Technician/Scheduling alike; (B) completionAmount/
// completionPaymentMethod are private to Admin/Technician only -- Scheduling (the
// "Maintenance" department in this system -- there is no separate Maintenance role,
// see UserRole enum) must never receive them, from REST or Socket.IO.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { io as ioClient, Socket } from 'socket.io-client';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

function connectSocket(baseUrl: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err: Error) => reject(err));
  });
}

function waitForEvent(socket: Socket, event: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data: any) => { clearTimeout(timer); resolve(data); });
  });
}

describe('Modification #6: Next Maintenance Note + completion amount privacy', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;
  let customerId: string;
  const createdAppointmentIds: string[] = [];
  const openSockets: Socket[] = [];
  function track(s: Socket): Socket { openSockets.push(s); return s; }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');

    const custRes = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Completion Privacy Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Jeddah', district: 'Test', street: 'Test' },
      });
    customerId = custRes.body.data.id;
  });

  afterEach(() => {
    for (const s of openSockets.splice(0)) s.close();
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

  // Full WAITING -> IN_PROGRESS -> COMPLETED cycle, returning the final completed record.
  async function createAndComplete(completeBody: Record<string, any>) {
    const apptRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        technicianId: users.technician.id,
      });
    const id = apptRes.body.data.id;
    createdAppointmentIds.push(id);
    await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    const completeRes = await request(ts.baseUrl)
      .patch(`/api/appointments/${id}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      // Modification #8: actualCompletionDate, and Modification #13:
      // technicianName, are now required for a Technician completion --
      // included here so this pre-#8/#13 helper keeps working.
      .send({ serviceDetails: 'Serviced units', completionAmount: 300, completionPaymentMethod: 'CASH', actualCompletionDate: new Date().toISOString().slice(0, 10), technicianName: 'Ahmed', ...completeBody });
    return { id, completeRes };
  }

  // 1. Technician can complete with Next Maintenance Note
  it('technician can complete an appointment with a Next Maintenance Note', async () => {
    const { completeRes } = await createAndComplete({ nextMaintenanceNote: 'Filter should be replaced next visit' });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.nextMaintenanceNote).toBe('Filter should be replaced next visit');
  });

  // 2. Technician can complete without Next Maintenance Note
  it('technician can complete an appointment without a Next Maintenance Note', async () => {
    const { completeRes } = await createAndComplete({});
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.nextMaintenanceNote).toBeNull();
  });

  // 3. Empty/whitespace note handled safely
  it('a whitespace-only Next Maintenance Note is stored as null, not as whitespace', async () => {
    const { completeRes } = await createAndComplete({ nextMaintenanceNote: '   ' });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.nextMaintenanceNote).toBeNull();
  });

  // 4. Persists correctly
  it('the note persists and is readable on a subsequent fetch', async () => {
    const { id } = await createAndComplete({ nextMaintenanceNote: 'Check drainage on next visit' });
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.nextMaintenanceNote).toBe('Check drainage on next visit');
  });

  // 5-8. Note visible to all four roles
  it('Admin can retrieve the Next Maintenance Note', async () => {
    const { id } = await createAndComplete({ nextMaintenanceNote: 'Possible part replacement next maintenance' });
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.nextMaintenanceNote).toBe('Possible part replacement next maintenance');
  });

  it('Scheduling (Maintenance department) can retrieve the Next Maintenance Note', async () => {
    const { id } = await createAndComplete({ nextMaintenanceNote: 'Inspect another unit next time' });
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.nextMaintenanceNote).toBe('Inspect another unit next time');
  });

  it('Scheduling can retrieve the Next Maintenance Note via the customer detail (maintenance history) API', async () => {
    const { id } = await createAndComplete({ nextMaintenanceNote: 'Note via customer history' });
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    const appt = res.body.data.appointments.find((a: any) => a.id === id);
    expect(appt.nextMaintenanceNote).toBe('Note via customer history');
  });

  it('Technician can retrieve the Next Maintenance Note', async () => {
    const { id } = await createAndComplete({ nextMaintenanceNote: 'Technician re-reads own note' });
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.nextMaintenanceNote).toBe('Technician re-reads own note');
  });

  // 9-10. Amount visible to Admin and Technician
  it('Admin can retrieve the completion amount', async () => {
    const { id } = await createAndComplete({});
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.completionAmount).toBe(300);
  });

  it('Technician can retrieve the completion amount', async () => {
    const { id } = await createAndComplete({});
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    expect(res.body.data.completionAmount).toBe(300);
  });

  // 11-14. Amount NOT exposed to Scheduling/Maintenance, list or detail
  it('Scheduling does not receive completionAmount from the list endpoint', async () => {
    await createAndComplete({});
    const res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    for (const a of res.body.data) {
      expect(a.completionAmount).toBeUndefined();
      expect(a.completionPaymentMethod).toBeUndefined();
    }
  });

  it('Scheduling does not receive completionAmount from the detail endpoint', async () => {
    const { id } = await createAndComplete({});
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.completionAmount).toBeUndefined();
    expect(res.body.data.completionPaymentMethod).toBeUndefined();
  });

  it('Maintenance department (same SCHEDULING role) does not receive completionAmount from dashboard/completed-maintenance', async () => {
    await createAndComplete({});
    const res = await request(ts.baseUrl).get('/api/dashboard/completed-maintenance').set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    for (const c of res.body.data) {
      for (const a of (c.appointments || [])) {
        expect(a.completionAmount).toBeUndefined();
        expect(a.completionPaymentMethod).toBeUndefined();
      }
    }
  });

  it('Maintenance department does not receive completionAmount via the customer detail (maintenance history) API', async () => {
    const { id } = await createAndComplete({});
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    const appt = res.body.data.appointments.find((a: any) => a.id === id);
    expect(appt.completionAmount).toBeUndefined();
  });

  // 15. Realtime: Scheduling socket must not receive completionAmount on completion
  it('a SCHEDULING socket does not receive completionAmount in the realtime appointment:completed payload', async () => {
    const schedSocket = track(await connectSocket(ts.baseUrl, schedToken));
    const received = waitForEvent(schedSocket, 'appointment:completed');

    const apptRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        technicianId: users.technician.id,
      });
    const id = apptRes.body.data.id;
    createdAppointmentIds.push(id);
    await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    await request(ts.baseUrl)
      .patch(`/api/appointments/${id}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ serviceDetails: 'x', completionAmount: 500, completionPaymentMethod: 'CASH', actualCompletionDate: new Date().toISOString().slice(0, 10), technicianName: 'Ahmed' });

    const payload = await received;
    expect(payload.completionAmount).toBeUndefined();
    expect(payload.completionPaymentMethod).toBeUndefined();
  });

  // 16. Existing completion flow still works end-to-end
  it('the existing completion flow still works end-to-end (regression)', async () => {
    const { id, completeRes } = await createAndComplete({ nextMaintenanceNote: 'Regression check' });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.workStatus).toBe('COMPLETED');
    const check = await prisma.appointment.findUnique({ where: { id } });
    expect(check?.workStatus).toBe('COMPLETED');
    expect(check?.completionAmount).toBe(300);
  });

  // 17. Existing Admin dashboard financial visibility not broken
  it('Admin dashboard/completed-maintenance still shows completionAmount (regression)', async () => {
    await createAndComplete({});
    const res = await request(ts.baseUrl).get('/api/dashboard/completed-maintenance').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const anyAmountPresent = res.body.data.some((appointment: any) => appointment.completionAmount != null);
    expect(anyAmountPresent).toBe(true);
  });

  // 18. Existing Technician completion behavior not broken (required fields still enforced)
  it('Technician completion still requires serviceDetails/amount/paymentMethod (regression)', async () => {
    const apptRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        technicianId: users.technician.id,
      });
    const id = apptRes.body.data.id;
    createdAppointmentIds.push(id);
    await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${id}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ nextMaintenanceNote: 'note only, missing required fields' });
    expect(res.status).toBe(400);
  });

  // 19. Existing appointment/customer history remains correct
  it('customer appointment history remains correct and complete for Admin (regression)', async () => {
    const { id } = await createAndComplete({ nextMaintenanceNote: 'History check' });
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const appt = res.body.data.appointments.find((a: any) => a.id === id);
    expect(appt).toBeTruthy();
    expect(appt.workStatus).toBe('COMPLETED');
    expect(appt.completionAmount).toBe(300);
    expect(appt.nextMaintenanceNote).toBe('History check');
  });
});
