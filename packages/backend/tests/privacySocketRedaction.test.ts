// Regression tests for the narrow Socket.IO privacy follow-up to PR #80.
// PR #80 fixed Technician-facing installation-financial exposure on the REST
// responses and on the /start, /complete, /postpone socket emits, but missed
// two other "appointment:created" emit paths that also carry a raw nested
// `customer` object to a Technician room/user:
//   1. broadcastAppointmentCreated() -- fired from POST /api/appointments
//   2. PATCH /api/appointments/:id/approve-export
// Both are fixed here by routing the Technician-targeted payload through the
// existing stripInstallationFinancialsFromCustomer() helper. These tests
// assert on the actual payload delivered to a live socket connection, not on
// the helper function in isolation.
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

function expectNoEvent(socket: Socket, event: string, windowMs = 800): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = () => { clearTimeout(timer); reject(new Error(`Unexpectedly received "${event}"`)); };
    const timer = setTimeout(() => { socket.off(event, handler); resolve(); }, windowMs);
    socket.once(event, handler);
  });
}

describe('Privacy socket redaction follow-up: appointment:created Technician payload', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string, tech2Token: string;
  let installationCustomerId = '';
  const createdAppointmentIds: string[] = [];
  const openSockets: Socket[] = [];
  function track(s: Socket): Socket { openSockets.push(s); return s; }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
    tech2Token = signTestToken(users.technician2.id, 'TECHNICIAN');

    const custRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Socket Redaction Customer', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1,
      installationAmount: 6200, installationPaymentMethod: 'CASH', installationNote: 'Gate code 4471',
      address: { city: 'Dammam', district: 'Test', street: 'Test' },
    });
    installationCustomerId = custRes.body.data.id;
    expect(custRes.body.data.installationAmount).toBe(6200);
  });

  afterEach(async () => {
    for (const s of openSockets.splice(0)) s.close();
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    if (installationCustomerId) await prisma.customer.deleteMany({ where: { id: installationCustomerId } });
    await stopTestServer(ts.server);
  });

  // ── Path 1: broadcastAppointmentCreated (POST /api/appointments) ──────────
  describe('POST /api/appointments -> appointment:created', () => {
    it('A/B/C/F. assigned Technician receives appointment:created without installation financials, but with installationNote and operational fields', async () => {
      const techSocket = track(await connectSocket(ts.baseUrl, techToken));
      const received = waitForEvent(techSocket, 'appointment:created');

      const apptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
        customerId: installationCustomerId, type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(), technicianId: users.technician.id,
      });
      expect(apptRes.status).toBe(201);
      createdAppointmentIds.push(apptRes.body.data.id);

      const payload = await received;
      expect(payload.customer.installationAmount).toBeUndefined();
      expect(payload.customer.installationPaymentMethod).toBeUndefined();
      // B. installationNote remains available.
      expect(payload.customer.installationNote).toBe('Gate code 4471');
      // C. other operational fields remain present.
      expect(payload.customer.name).toBe('Socket Redaction Customer');
      expect(payload.customer.phone).toBeTruthy();
      expect(payload.type).toBe('MAINTENANCE');
    });

    it('D. Admin-directed appointment:created payload is unaffected and still includes installation financials', async () => {
      const adminSocket = track(await connectSocket(ts.baseUrl, adminToken));
      const received = waitForEvent(adminSocket, 'appointment:created');

      const apptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
        customerId: installationCustomerId, type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(), technicianId: users.technician.id,
      });
      createdAppointmentIds.push(apptRes.body.data.id);

      const payload = await received;
      expect(payload.customer.installationAmount).toBe(6200);
      expect(payload.customer.installationPaymentMethod).toBe('CASH');
    });

    it('E. Scheduling-directed appointment:created payload is unaffected except the already-established PR #80 completion redaction', async () => {
      const schedSocket = track(await connectSocket(ts.baseUrl, schedToken));
      const received = waitForEvent(schedSocket, 'appointment:created');

      const apptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
        customerId: installationCustomerId, type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(), technicianId: users.technician.id,
        visibleToScheduling: true,
      });
      createdAppointmentIds.push(apptRes.body.data.id);

      const payload = await received;
      // Installation financials remain visible to Scheduling (PR #80 policy).
      expect(payload.customer.installationAmount).toBe(6200);
      // Existing PR #80 completion-privacy rule still applies (defense in depth).
      expect(payload.completionAmount).toBeUndefined();
      expect(payload.completionPaymentMethod).toBeUndefined();
    });

    it('G. a different Technician (not assigned) is not newly given access to this event', async () => {
      const tech2Socket = track(await connectSocket(ts.baseUrl, tech2Token));
      const notReceived = expectNoEvent(tech2Socket, 'appointment:created');

      const apptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
        customerId: installationCustomerId, type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(), technicianId: users.technician.id,
      });
      createdAppointmentIds.push(apptRes.body.data.id);

      await notReceived;
    });

    it('unassigned-pool broadcast (no technicianId) also redacts installation financials for a Technician in the shared room', async () => {
      const techSocket = track(await connectSocket(ts.baseUrl, techToken));
      const received = waitForEvent(techSocket, 'appointment:created');

      const apptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
        customerId: installationCustomerId, type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(apptRes.status).toBe(201);
      createdAppointmentIds.push(apptRes.body.data.id);

      const payload = await received;
      expect(payload.customer.installationAmount).toBeUndefined();
      expect(payload.customer.installationPaymentMethod).toBeUndefined();
      expect(payload.customer.name).toBe('Socket Redaction Customer');
    });
  });

  // ── Path 2: PATCH /api/appointments/:id/approve-export ────────────────────
  describe('PATCH /api/appointments/:id/approve-export -> appointment:created', () => {
    async function createPendingApprovalAppointment(technicianId?: string) {
      // A non-urgent appointment created by SCHEDULING starts in the
      // (visibleToTechnician:false, adminApproved:false) state -- directly
      // pending Admin's approve-export action (see the POST / handler's own
      // "Approval-flow fix" comment).
      const apptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${schedToken}`).send({
        customerId: installationCustomerId, type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        ...(technicianId ? { technicianId } : {}),
      });
      expect(apptRes.status).toBe(201);
      expect(apptRes.body.data.visibleToTechnician).toBe(false);
      createdAppointmentIds.push(apptRes.body.data.id);
      return apptRes.body.data.id;
    }

    it('F. assigned Technician receives the approval reveal without installation financials', async () => {
      const id = await createPendingApprovalAppointment(users.technician.id);
      const techSocket = track(await connectSocket(ts.baseUrl, techToken));
      const received = waitForEvent(techSocket, 'appointment:created');

      const approveRes = await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${adminToken}`);
      expect(approveRes.status).toBe(200);

      const payload = await received;
      expect(payload.customer.installationAmount).toBeUndefined();
      expect(payload.customer.installationPaymentMethod).toBeUndefined();
      expect(payload.customer.installationNote).toBe('Gate code 4471');
      expect(payload.customer.name).toBe('Socket Redaction Customer');
    });

    it("D. Admin's own REST response for approve-export is unaffected and still includes installation financials", async () => {
      const id = await createPendingApprovalAppointment(users.technician.id);
      const approveRes = await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${adminToken}`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.customer.installationAmount).toBe(6200);
    });

    it('G. a different Technician is not newly given access to the approval reveal', async () => {
      const id = await createPendingApprovalAppointment(users.technician.id);
      const tech2Socket = track(await connectSocket(ts.baseUrl, tech2Token));
      const notReceived = expectNoEvent(tech2Socket, 'appointment:created');

      await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${adminToken}`);
      await notReceived;
    });

    it('unassigned-pool approval reveal also redacts installation financials', async () => {
      const id = await createPendingApprovalAppointment();
      const techSocket = track(await connectSocket(ts.baseUrl, techToken));
      const received = waitForEvent(techSocket, 'appointment:created');

      await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${adminToken}`);

      const payload = await received;
      expect(payload.customer.installationAmount).toBeUndefined();
      expect(payload.customer.installationPaymentMethod).toBeUndefined();
    });
  });
});
