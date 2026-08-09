// Modification #8: Technician-declared actual Completion Date on /complete, and
// the Scheduling/Maintenance confirm-operation review workflow. Verifies the
// date is distinct from completedAt, the confirmation state machine, and that
// Modification #6's completion-amount privacy is never regressed.
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
function dateOnly(d: Date | string): string { return new Date(d).toISOString().slice(0, 10); }
function daysAgo(n: number): Date { return new Date(Date.now() - n * 86400000); }

describe('Modification #8: Completion Date + Maintenance Confirmation', () => {
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
        name: 'Completion Date Customer',
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

  async function createInProgressAppointment(scheduledDate: Date = new Date(Date.now() + 86400000)) {
    const apptRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: scheduledDate.toISOString(), technicianId: users.technician.id });
    const id = apptRes.body.data.id;
    createdAppointmentIds.push(id);
    await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    return id;
  }

  const validCompleteBody = { serviceDetails: 'Serviced units', completionAmount: 300, completionPaymentMethod: 'CASH' };

  // 1. Cannot complete without Completion Date
  it('Technician cannot complete without a Completion Date', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`).send(validCompleteBody);
    expect(res.status).toBe(400);
  });

  // 2. Valid Completion Date accepted
  it('a valid Completion Date is accepted', async () => {
    const id = await createInProgressAppointment();
    const dateStr = dateOnly(daysAgo(1));
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateStr });
    expect(res.status).toBe(200);
    expect(dateOnly(res.body.data.actualCompletionDate)).toBe(dateStr);
  });

  // 3. Invalid date rejected
  it('a malformed Completion Date is rejected', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  // 4. Future date rejected
  it('a future Completion Date is rejected', async () => {
    const id = await createInProgressAppointment();
    const futureDate = dateOnly(new Date(Date.now() + 5 * 86400000));
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: futureDate });
    expect(res.status).toBe(400);
  });

  it("today's date is accepted (boundary, not rejected as 'future')", async () => {
    const id = await createInProgressAppointment();
    const todayStr = dateOnly(new Date());
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: todayStr });
    expect(res.status).toBe(200);
  });

  // 5 & 6 & IMPORTANT DATE TEST: actualCompletionDate persists distinctly from
  // completedAt (submission timestamp) and from scheduledDate.
  it('IMPORTANT DATE TEST: scheduledDate, actualCompletionDate, and completedAt all remain distinct and correct', async () => {
    const scheduled = daysAgo(2);
    const actual = daysAgo(1);
    const id = await createInProgressAppointment(scheduled);
    const beforeSubmit = Date.now();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(actual) });
    const afterSubmit = Date.now();
    expect(res.status).toBe(200);

    expect(dateOnly(res.body.data.scheduledDate)).toBe(dateOnly(scheduled));
    expect(dateOnly(res.body.data.actualCompletionDate)).toBe(dateOnly(actual));
    // completedAt is the submission timestamp -- must fall within this test's
    // own request window, not equal to the technician-entered date.
    const completedAtMs = new Date(res.body.data.completedAt).getTime();
    expect(completedAtMs).toBeGreaterThanOrEqual(beforeSubmit - 1000);
    expect(completedAtMs).toBeLessThanOrEqual(afterSubmit + 1000);
    expect(dateOnly(res.body.data.completedAt)).not.toBe(dateOnly(actual));

    // Persists correctly on a fresh fetch too.
    const fetchRes = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(dateOnly(fetchRes.body.data.actualCompletionDate)).toBe(dateOnly(actual));
    expect(dateOnly(fetchRes.body.data.scheduledDate)).toBe(dateOnly(scheduled));
  });

  // 7. Completion sets maintenanceConfirmed pending
  it('Technician completion sets maintenanceConfirmed to false (pending)', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(new Date()) });
    expect(res.body.data.maintenanceConfirmed).toBe(false);
  });

  // 8-12. Scheduling retrieval: allowed fields yes, financial fields no
  it('Scheduling can retrieve the actual Completion Date, serviceDetails, and nextMaintenanceNote, but not the amount/payment method', async () => {
    const id = await createInProgressAppointment();
    const dateStr = dateOnly(daysAgo(1));
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateStr, nextMaintenanceNote: 'Check filter' });

    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    expect(dateOnly(res.body.data.actualCompletionDate)).toBe(dateStr);
    expect(res.body.data.serviceDetails).toBe('Serviced units');
    expect(res.body.data.nextMaintenanceNote).toBe('Check filter');
    expect(res.body.data.completionAmount).toBeUndefined();
    expect(res.body.data.completionPaymentMethod).toBeUndefined();
  });

  // 13. Scheduling can confirm a genuinely completed operation
  it('Scheduling can confirm a completed operation', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(new Date()) });
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.maintenanceConfirmed).toBe(true);
  });

  // 14. Cannot confirm an uncompleted appointment
  it('Scheduling cannot confirm an appointment that has not been completed', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NOT_COMPLETED');
  });

  it('Scheduling cannot confirm a WAITING appointment either', async () => {
    const apptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString() });
    createdAppointmentIds.push(apptRes.body.data.id);
    const res = await request(ts.baseUrl).patch(`/api/appointments/${apptRes.body.data.id}/confirm-operation`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(res.status).toBe(409);
  });

  // 15 & 16. Unauthorized roles rejected, including Technician self-confirmation
  it('Technician cannot self-confirm the Maintenance approval', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(new Date()) });
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${techToken}`).send({});
    expect(res.status).toBe(403);
  });

  it('Admin is not authorized to confirm either -- confirmation is a Scheduling/Maintenance-specific responsibility', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(new Date()) });
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated confirm-operation request', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).send({});
    expect(res.status).toBe(401);
  });

  // 17. Successful confirmation persists
  it('confirmation persists on a subsequent fetch', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(new Date()) });
    await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${schedToken}`).send({});
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(res.body.data.maintenanceConfirmed).toBe(true);
  });

  // 18. Repeated confirmation is safe/controlled
  it('a repeated confirmation is rejected safely (409) without corrupting state', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(new Date()) });
    await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${schedToken}`).send({});
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_CONFIRMED');
    const check = await prisma.appointment.findUnique({ where: { id } });
    expect(check?.maintenanceConfirmed).toBe(true);
  });

  // 21 & 22. Existing Admin/Technician financial visibility unaffected
  it('Admin can still retrieve completionAmount (regression)', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(new Date()) });
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.completionAmount).toBe(300);
  });

  it('Technician can still retrieve completionAmount for their own completed job (regression)', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(new Date()) });
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    expect(res.body.data.completionAmount).toBe(300);
  });

  // 23. Mod6 privacy remains enforced on the list endpoint too
  it('Scheduling still does not receive completionAmount from the list endpoint (Modification #6 regression)', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(new Date()) });
    const res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${schedToken}`);
    const found = res.body.data.find((a: any) => a.id === id);
    expect(found.completionAmount).toBeUndefined();
    expect(found.actualCompletionDate).toBeTruthy();
  });

  // 24. Mod7 latest-maintenance-note endpoint still works
  it('Modification #7 latest-maintenance-note endpoint still works (regression)', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(new Date()), nextMaintenanceNote: 'Inspect drainage' });
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.nextMaintenanceNote).toBe('Inspect drainage');
  });

  // 25. Realtime never exposes financial fields
  it('a SCHEDULING socket never receives completionAmount on completion or confirmation', async () => {
    const schedSocket = track(await connectSocket(ts.baseUrl, schedToken));
    const completedEvent = waitForEvent(schedSocket, 'appointment:completed');

    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(new Date()) });

    const completedPayload = await completedEvent;
    expect(completedPayload.completionAmount).toBeUndefined();
    expect(completedPayload.completionPaymentMethod).toBeUndefined();
    expect(completedPayload.actualCompletionDate).toBeTruthy();

    const statusEvent = waitForEvent(schedSocket, 'appointment:status');
    await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${schedToken}`).send({});
    const statusPayload = await statusEvent;
    expect(statusPayload.completionAmount).toBeUndefined();
    expect(statusPayload.completionPaymentMethod).toBeUndefined();
  });

  // 26. Confirmation realtime update reaches Scheduling
  it('confirming an operation emits an appointment:status update to the SCHEDULING room with maintenanceConfirmed=true', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...validCompleteBody, actualCompletionDate: dateOnly(new Date()) });

    const schedSocket = track(await connectSocket(ts.baseUrl, schedToken));
    const statusEvent = waitForEvent(schedSocket, 'appointment:status');
    await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${schedToken}`).send({});
    const payload = await statusEvent;
    expect(payload.id).toBe(id);
    expect(payload.maintenanceConfirmed).toBe(true);
  });
});
