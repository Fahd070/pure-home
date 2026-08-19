// Regression tests for Privacy Patch #2 -- the confirmed field-level privacy
// inconsistencies deferred from PR #79 (Scheduling object-visibility patch):
//
// 1. completionImage must be as private to SCHEDULING as completionAmount/
//    completionPaymentMethod already are, everywhere those two are already
//    stripped (established policy: routes/technicians.ts already strips
//    completionImage from its own SCHEDULING branch).
// 2. urgentVisitRecord.amount/paymentMethod must be stripped for SCHEDULING
//    consistently across the appointment list AND detail endpoints (the list
//    already did this; the detail endpoint did not).
// 3. Customer.installationAmount/installationPaymentMethod (installation
//    financial data, "Admin + Scheduling" owned per routes/customers.ts's own
//    schema comment, never read anywhere in the Technician frontend) must not
//    be exposed to TECHNICIAN merely because a customer is attached to their
//    assigned job.
// 4. SETTINGS_UPDATED must be a per-user event, not broadcast to the whole
//    role room (see SettingsPage.tsx's own "reload if another device updated
//    settings" comment -- this was always meant to be a same-user signal).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { io as ioClient, Socket } from 'socket.io-client';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers, TEST_PASSWORD } from './helpers/fixtures';
import prisma from '../src/prisma';
import bcrypt from 'bcryptjs';

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

// Resolves once no event fired within the window -- used to prove a socket
// was NOT targeted by an emission that a sibling socket did receive.
function expectNoEvent(socket: Socket, event: string, windowMs = 800): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = () => { clearTimeout(timer); reject(new Error(`Unexpectedly received "${event}"`)); };
    const timer = setTimeout(() => { socket.off(event, handler); resolve(); }, windowMs);
    socket.once(event, handler);
  });
}

describe('Privacy Patch #2: consistent sensitive-data redaction', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;
  let customerId = '';
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

    const custRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Privacy Patch 2 Customer', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1,
      address: { city: 'Jeddah', district: 'Test', street: 'Test' },
    });
    customerId = custRes.body.data.id;

    const installCustRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Installation Financials Customer', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1,
      installationAmount: 4500, installationPaymentMethod: 'CASH',
      address: { city: 'Riyadh', district: 'Test', street: 'Test' },
    });
    installationCustomerId = installCustRes.body.data.id;
    expect(installCustRes.body.data.installationAmount).toBe(4500);
  });

  afterEach(async () => {
    for (const s of openSockets.splice(0)) s.close();
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    const custIds = [customerId, installationCustomerId].filter(Boolean);
    if (custIds.length) await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
    await stopTestServer(ts.server);
  });

  async function createAndComplete(completeBody: Record<string, any> = {}) {
    const apptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
      customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString(), technicianId: users.technician.id,
    });
    const id = apptRes.body.data.id;
    createdAppointmentIds.push(id);
    await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    const completeRes = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`).send({
      serviceDetails: 'Serviced units', completionAmount: 300, completionPaymentMethod: 'CASH',
      completionImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg',
      actualCompletionDate: new Date().toISOString().slice(0, 10), technicianName: 'Ahmed', ...completeBody,
    });
    return { id, completeRes };
  }

  // ── completionImage: SCHEDULING must never receive it ─────────────────────
  describe('completionImage privacy', () => {
    it('A. Scheduling list response hides completionImage', async () => {
      await createAndComplete({});
      const res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${schedToken}`);
      expect(res.status).toBe(200);
      for (const a of res.body.data) expect(a.completionImage).toBeUndefined();
    });

    it('B. Scheduling single appointment response hides completionImage', async () => {
      const { id } = await createAndComplete({});
      const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${schedToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.completionImage).toBeUndefined();
    });

    it('Scheduling customer/history response hides completionImage', async () => {
      const { id } = await createAndComplete({});
      const res = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${schedToken}`);
      expect(res.status).toBe(200);
      const appt = res.body.data.appointments.find((a: any) => a.id === id);
      expect(appt.completionImage).toBeUndefined();
    });

    it('Scheduling dashboard/completed-maintenance response hides completionImage', async () => {
      await createAndComplete({});
      const res = await request(ts.baseUrl).get('/api/dashboard/completed-maintenance').set('Authorization', `Bearer ${schedToken}`);
      expect(res.status).toBe(200);
      for (const a of res.body.data) expect(a.completionImage).toBeUndefined();
    });

    it('C. Admin still receives completionImage from the list, detail, and dashboard', async () => {
      const { id } = await createAndComplete({});
      const listRes = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.body.data.some((a: any) => a.id === id && typeof a.completionImage === 'string')).toBe(true);
      const detailRes = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${adminToken}`);
      expect(typeof detailRes.body.data.completionImage).toBe('string');
      const dashRes = await request(ts.baseUrl).get('/api/dashboard/completed-maintenance').set('Authorization', `Bearer ${adminToken}`);
      expect(dashRes.body.data.some((a: any) => a.id === id && typeof a.completionImage === 'string')).toBe(true);
    });

    it('Technician behavior is not broadened: own list entry still has no completionImage (pre-existing behavior)', async () => {
      const { id } = await createAndComplete({});
      const res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${techToken}`);
      const appt = res.body.data.find((a: any) => a.id === id);
      expect(appt.completionImage).toBeUndefined();
    });

    it('Technician behavior is not broadened: own detail response still returns completionImage (pre-existing, unchanged)', async () => {
      const { id } = await createAndComplete({});
      const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
      expect(typeof res.body.data.completionImage).toBe('string');
    });

    it('a SCHEDULING socket does not receive completionImage in the realtime appointment:completed payload', async () => {
      const schedSocket = track(await connectSocket(ts.baseUrl, schedToken));
      const received = waitForEvent(schedSocket, 'appointment:completed');
      await createAndComplete({});
      const payload = await received;
      expect(payload.completionImage).toBeUndefined();
      expect(payload.completionAmount).toBeUndefined();
    });
  });

  // ── urgentVisitRecord.amount/paymentMethod: consistent across list+detail ─
  describe('urgentVisitRecord financial privacy', () => {
    async function createApprovedUrgentVisit() {
      const createRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
        type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        isUrgent: true, customerName: 'Urgent Financial Privacy Customer', customerPhone: testPhone(),
        urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'Test', street: 'Urgent Lane' }),
      });
      const appointmentId = createRes.body.data.id;
      createdAppointmentIds.push(appointmentId);
      expect(createRes.body.data.visibleToScheduling).toBe(false);

      await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`).send({
        appointmentId, serviceType: 'MAINTENANCE', paymentMethod: 'CASH', amount: 777,
        serviceDetails: 'Urgent repair completed', technicianName: 'Ahmed',
      });

      // D. Existing visibility rule (PR #79) is unaffected by this patch --
      // Scheduling still cannot see the appointment before Admin approval.
      const beforeApproval = await request(ts.baseUrl).get(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${schedToken}`);
      expect(beforeApproval.status).toBe(404);

      const approve = await request(ts.baseUrl).patch(`/api/appointments/${appointmentId}/approve-visibility`).set('Authorization', `Bearer ${adminToken}`);
      expect(approve.status).toBe(200);
      return appointmentId;
    }

    it('A. Scheduling list response hides urgentVisitRecord.amount and paymentMethod', async () => {
      const appointmentId = await createApprovedUrgentVisit();
      const res = await request(ts.baseUrl).get('/api/appointments').query({ urgent: 'true' }).set('Authorization', `Bearer ${schedToken}`);
      const appt = res.body.data.find((a: any) => a.id === appointmentId);
      expect(appt).toBeTruthy();
      expect(appt.urgentVisitRecord.amount).toBeUndefined();
      expect(appt.urgentVisitRecord.paymentMethod).toBeUndefined();
      // Non-financial urgentVisitRecord fields remain intact.
      expect(appt.urgentVisitRecord.serviceType).toBe('MAINTENANCE');
    });

    it('B. Scheduling single appointment response hides urgentVisitRecord.amount and paymentMethod (the fix)', async () => {
      const appointmentId = await createApprovedUrgentVisit();
      const res = await request(ts.baseUrl).get(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${schedToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.urgentVisitRecord.amount).toBeUndefined();
      expect(res.body.data.urgentVisitRecord.paymentMethod).toBeUndefined();
      expect(res.body.data.urgentVisitRecord.serviceDetails).toBe('Urgent repair completed');
    });

    it('C. Admin sees urgentVisitRecord.amount and paymentMethod in both list and detail', async () => {
      const appointmentId = await createApprovedUrgentVisit();
      const listRes = await request(ts.baseUrl).get('/api/appointments').query({ urgent: 'true' }).set('Authorization', `Bearer ${adminToken}`);
      const listAppt = listRes.body.data.find((a: any) => a.id === appointmentId);
      expect(listAppt.urgentVisitRecord.amount).toBe(777);
      expect(listAppt.urgentVisitRecord.paymentMethod).toBe('CASH');
      const detailRes = await request(ts.baseUrl).get(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${adminToken}`);
      expect(detailRes.body.data.urgentVisitRecord.amount).toBe(777);
      expect(detailRes.body.data.urgentVisitRecord.paymentMethod).toBe('CASH');
    });
  });

  // ── Customer.installationAmount/installationPaymentMethod vs TECHNICIAN ───
  describe('installation financial data (Customer.installationAmount/installationPaymentMethod)', () => {
    async function createAssignedAppointment() {
      const apptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
        customerId: installationCustomerId, type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(), technicianId: users.technician.id,
      });
      const id = apptRes.body.data.id;
      createdAppointmentIds.push(id);
      return id;
    }

    it('A. Admin receives installationAmount/installationPaymentMethod via the appointment detail', async () => {
      const id = await createAssignedAppointment();
      const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.body.data.customer.installationAmount).toBe(4500);
      expect(res.body.data.customer.installationPaymentMethod).toBe('CASH');
    });

    it('B. Scheduling receives installationAmount/installationPaymentMethod via the appointment detail', async () => {
      const id = await createAssignedAppointment();
      const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${schedToken}`);
      expect(res.body.data.customer.installationAmount).toBe(4500);
      expect(res.body.data.customer.installationPaymentMethod).toBe('CASH');
    });

    it("C. Technician's assigned appointment detail does NOT expose installationAmount/installationPaymentMethod", async () => {
      const id = await createAssignedAppointment();
      const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.customer.installationAmount).toBeUndefined();
      expect(res.body.data.customer.installationPaymentMethod).toBeUndefined();
    });

    it("C2. Technician's assigned appointment list entry does NOT expose installationAmount/installationPaymentMethod", async () => {
      const id = await createAssignedAppointment();
      const res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${techToken}`);
      const appt = res.body.data.find((a: any) => a.id === id);
      expect(appt).toBeTruthy();
      expect(appt.customer.installationAmount).toBeUndefined();
      expect(appt.customer.installationPaymentMethod).toBeUndefined();
    });

    it('D. Technician can still see all other operational customer information required for the job', async () => {
      const id = await createAssignedAppointment();
      const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
      expect(res.body.data.customer.name).toBe('Installation Financials Customer');
      expect(res.body.data.customer.phone).toBeTruthy();
      expect(res.body.data.customer.address).toBeTruthy();
    });

    it('Technician /start response strips installationAmount but keeps operational customer data', async () => {
      const id = await createAssignedAppointment();
      const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.customer.installationAmount).toBeUndefined();
      expect(res.body.data.customer.name).toBe('Installation Financials Customer');
    });

    it('Technician /complete response strips installationAmount but keeps the technician\'s own completion data', async () => {
      const id = await createAssignedAppointment();
      await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
      const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`).send({
        serviceDetails: 'Serviced', completionAmount: 250, completionPaymentMethod: 'CASH',
        actualCompletionDate: new Date().toISOString().slice(0, 10), technicianName: 'Ahmed',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.customer.installationAmount).toBeUndefined();
      // Own just-submitted completion data is unaffected by this patch.
      expect(res.body.data.completionAmount).toBe(250);
    });

    it('Admin retains installationAmount on the same /start response (unaffected)', async () => {
      const id = await createAssignedAppointment();
      const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${adminToken}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.customer.installationAmount).toBe(4500);
    });
  });

  // ── SETTINGS_UPDATED: per-user, not role-broadcast ─────────────────────────
  describe('SETTINGS_UPDATED socket targeting', () => {
    let schedulingUserBId = '';
    let schedTokenB = '';

    beforeAll(async () => {
      const hash = await bcrypt.hash(TEST_PASSWORD, 4);
      const userB = await prisma.user.upsert({
        where: { email: 'scheduling-b@test.local' },
        update: {},
        create: { name: 'Test Scheduling B', email: 'scheduling-b@test.local', password: hash, role: 'SCHEDULING' },
      });
      schedulingUserBId = userB.id;
      schedTokenB = signTestToken(userB.id, 'SCHEDULING');
    });

    it('User A updates settings: User A is targeted, and User B (same role) is NOT', async () => {
      const socketA = track(await connectSocket(ts.baseUrl, schedToken));
      const socketB = track(await connectSocket(ts.baseUrl, schedTokenB));

      const receivedA = waitForEvent(socketA, 'settings:updated');
      const notReceivedB = expectNoEvent(socketB, 'settings:updated');

      const updateRes = await request(ts.baseUrl).put('/api/settings').set('Authorization', `Bearer ${schedToken}`).send({ theme: 'dark' });
      expect(updateRes.status).toBe(200);

      const payload = await receivedA;
      expect(payload.theme).toBe('dark');
      await notReceivedB;
    });

    it('the REST response itself is unaffected (regression)', async () => {
      const res = await request(ts.baseUrl).put('/api/settings').set('Authorization', `Bearer ${schedToken}`).send({ fontSize: 'large' });
      expect(res.status).toBe(200);
      expect(res.body.data.fontSize).toBe('large');
    });
  });
});
