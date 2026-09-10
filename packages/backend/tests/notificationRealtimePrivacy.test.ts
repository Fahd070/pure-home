/**
 * PHASE 2 CLOSURE: realtime privacy for the postpone / did-not-answer events.
 *
 * `visibleToScheduling: false` is an authorization gate -- Scheduling gets a
 * plain 404 for such an appointment over REST. The Socket.IO delivery for these
 * two events used to ignore that gate entirely and broadcast the appointment
 * (with its nested customer) to the whole SCHEDULING room, so a role that could
 * not fetch the record could still watch it change.
 *
 * These tests assert the property that closes it: a realtime event never reveals
 * what the recipient cannot fetch through the corresponding authorized REST
 * route -- and that the gate is not over-applied to visible appointments.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { io as ioClient, Socket } from 'socket.io-client';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

function connectSocket(baseUrl: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      auth: { token },
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
    socket.once(event, (data: any) => { clearTimeout(timer); resolve(data); });
  });
}

function assertEventNotReceived(socket: Socket, event: string, waitMs = 900): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); resolve(); }, waitMs);
    function onEvent(payload: any) {
      clearTimeout(timer);
      reject(new Error(`Unexpectedly received "${event}": ${JSON.stringify(payload)?.slice(0, 300)}`));
    }
    socket.once(event, onEvent);
  });
}

describe('Phase 2 realtime privacy (postpone / no-answer)', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string, tech2Token: string;
  let customerId: string;
  const openSockets: Socket[] = [];
  const apptIds: string[] = [];

  const track = (s: Socket) => { openSockets.push(s); return s; };

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
    tech2Token = signTestToken(users.technician2.id, 'TECHNICIAN');

    const cust = await prisma.customer.create({
      data: {
        name: 'Realtime Privacy Customer', phone: '0559990077',
        maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1,
        installationAmount: 1234.5, installationNote: 'PRIVATE FINANCIAL NOTE',
      },
    });
    customerId = cust.id;
  });

  afterEach(() => {
    while (openSockets.length) {
      const s = openSockets.pop();
      try { s?.disconnect(); } catch { /* already closed */ }
    }
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { type: { in: ['APPOINTMENT_POSTPONED', 'APPOINTMENT_NO_ANSWER'] } },
    });
    if (apptIds.length) await prisma.appointment.deleteMany({ where: { id: { in: apptIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

  async function createAppointment(visibleToScheduling: boolean) {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 3 * 86400000).toISOString(),
        technicianId: users.technician.id,
        visibleToScheduling,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.visibleToScheduling).toBe(visibleToScheduling);
    apptIds.push(res.body.data.id);
    return res.body.data.id as string;
  }

  const postpone = (id: string) =>
    request(ts.baseUrl).patch(`/api/appointments/${id}/postpone`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ note: 'moving it', newDate: new Date(Date.now() + 9 * 86400000).toISOString() });

  const noAnswer = (id: string) =>
    request(ts.baseUrl).patch(`/api/appointments/${id}/no-answer`)
      .set('Authorization', `Bearer ${techToken}`).send({ note: 'no reply' });

  // ------------------------------------------------------------- VISIBLE
  describe('visibleToScheduling = true', () => {
    it('POSTPONED reaches both Admin and Scheduling', async () => {
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(true);

      const adminSeen = waitForEvent(adminSock, 'appointment:postponed');
      const schedSeen = waitForEvent(schedSock, 'appointment:postponed');
      expect((await postpone(apptId)).status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      expect((await schedSeen).id).toBe(apptId);
    });

    it('NO_ANSWER reaches both Admin and Scheduling', async () => {
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(true);

      const adminSeen = waitForEvent(adminSock, 'appointment:no-answer');
      const schedSeen = waitForEvent(schedSock, 'appointment:no-answer');
      expect((await noAnswer(apptId)).status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      expect((await schedSeen).id).toBe(apptId);
    });
  });

  // -------------------------------------------------------------- HIDDEN
  describe('visibleToScheduling = false', () => {
    it('Scheduling genuinely cannot fetch the appointment over REST', async () => {
      const apptId = await createAppointment(false);
      const res = await request(ts.baseUrl).get(`/api/appointments/${apptId}`).set('Authorization', `Bearer ${schedToken}`);
      expect(res.status).toBe(404);
    });

    it('POSTPONED reaches Admin but NOT the Scheduling room', async () => {
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(false);

      const adminSeen = waitForEvent(adminSock, 'appointment:postponed');
      const schedSilent = assertEventNotReceived(schedSock, 'appointment:postponed');
      expect((await postpone(apptId)).status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      await schedSilent;
    });

    it('NO_ANSWER reaches Admin but NOT the Scheduling room', async () => {
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(false);

      const adminSeen = waitForEvent(adminSock, 'appointment:no-answer');
      const schedSilent = assertEventNotReceived(schedSock, 'appointment:no-answer');
      expect((await noAnswer(apptId)).status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      await schedSilent;
    });

    it('the accompanying status-refresh emit is withheld from Scheduling too', async () => {
      // Redacting financials is not the same as withholding an appointment the
      // recipient may not see at all -- this emit carries the same payload.
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(false);

      const schedSilent = assertEventNotReceived(schedSock, 'appointment:status');
      expect((await noAnswer(apptId)).status).toBe(200);
      await schedSilent;
    });

    it('a hidden appointment stays unfetchable AFTER the event fires', async () => {
      // Even if some generic signal ever reaches Scheduling, the entity itself
      // must remain unreachable -- no notification or event grants access.
      const apptId = await createAppointment(false);
      expect((await postpone(apptId)).status).toBe(200);

      const byId = await request(ts.baseUrl).get(`/api/appointments/${apptId}`).set('Authorization', `Bearer ${schedToken}`);
      expect(byId.status).toBe(404);
      const inList = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${schedToken}`);
      expect((inList.body.data || []).map((a: any) => a.id)).not.toContain(apptId);
    });
  });

  // ------------------------------------------------------- ROLE ISOLATION
  describe('role isolation and payload hygiene', () => {
    it('an unrelated technician never receives the Admin/Scheduling critical payload', async () => {
      const tech2Sock = track(await connectSocket(ts.baseUrl, tech2Token));
      const apptId = await createAppointment(true);

      // technician2 owns nothing here, so neither the assigned-technician room
      // nor the unassigned-pool broadcast applies to them.
      const silent = assertEventNotReceived(tech2Sock, 'appointment:no-answer');
      expect((await noAnswer(apptId)).status).toBe(200);
      await silent;
    });

    it('per-user notification delivery is private to its recipient', async () => {
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const tech2Sock = track(await connectSocket(ts.baseUrl, tech2Token));
      const apptId = await createAppointment(true);

      const adminSeen = waitForEvent(adminSock, 'notification:new');
      // The notification is addressed to Administration, and rides the per-user
      // room -- an unrelated technician's socket must never see it.
      const tech2Silent = assertEventNotReceived(tech2Sock, 'notification:new');
      expect((await noAnswer(apptId)).status).toBe(200);

      const n = await adminSeen;
      expect(n.userId).toBe(users.admin.id);
      expect(n.type).toBe('APPOINTMENT_NO_ANSWER');
      await tech2Silent;
    });

    it('no credential, financial or branch field appears in a realtime payload', async () => {
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(true);

      const adminSeen = waitForEvent(adminSock, 'appointment:postponed');
      const schedSeen = waitForEvent(schedSock, 'appointment:postponed');
      expect((await postpone(apptId)).status).toBe(200);

      for (const payload of [await adminSeen, await schedSeen]) {
        const text = JSON.stringify(payload);
        // Credentials must never ride any socket payload, for any audience.
        expect(text).not.toContain('accessCodeHash');
        expect(text).not.toContain('sessionVersion');
        expect(text).not.toContain('password');
        expect(payload.technician?.password).toBeUndefined();
        expect(payload.technician?.accessCodeHash).toBeUndefined();
      }
      // completionAmount is Administration-only and must not ride the Scheduling copy.
      expect((await schedSeen).completionAmount).toBeUndefined();
      // Customer installation financials are deliberately NOT asserted absent
      // here: GET /customers and GET /customers/:id are requireRole('ADMIN',
      // 'SCHEDULING') and return installationNote/installationAmount to BOTH
      // roles, so Scheduling receiving them over the socket does not exceed what
      // it can already fetch over REST. The rule under test is "realtime never
      // reveals more than the authorized REST route", not "hide every field".
      // The audience those fields ARE private from is TECHNICIAN -- asserted below.
      expect((await schedSeen).customer.installationNote).toBe('PRIVATE FINANCIAL NOTE');
    });

    it('the technician copy of the same event has customer installation financials stripped', async () => {
      // Privacy Patch #2: these fields are private FROM technicians, and the
      // assigned technician's own room copy must not carry them.
      const techSock = track(await connectSocket(ts.baseUrl, techToken));
      const apptId = await createAppointment(true);

      const techSeen = waitForEvent(techSock, 'appointment:postponed');
      expect((await postpone(apptId)).status).toBe(200);

      const payload = await techSeen;
      expect(payload.customer.installationAmount).toBeUndefined();
      expect(payload.customer.installationPaymentMethod).toBeUndefined();
      expect(payload.completionAmount).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain('accessCodeHash');
    });
  });
  // ============================================ MUTATION ROUTES (FINAL CLOSURE)
  /**
   * Every OTHER route that broadcasts an appointment payload to the SCHEDULING
   * room. `visibleToScheduling` gates the Scheduling REST surface, so it must
   * gate these too -- realtime can never grant more visibility than REST.
   *
   * Each operation is asserted twice: visible (Scheduling still receives, so the
   * gate is not over-applied) and hidden (Scheduling receives nothing).
   */
  describe('appointment mutation routes respect the same visibility rule', () => {
    const setStatus = (id: string) =>
      request(ts.baseUrl).patch(`/api/appointments/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`).send({ status: 'RESCHEDULED' });

    const editAppointment = (id: string) =>
      request(ts.baseUrl).put(`/api/appointments/${id}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ notes: 'edited by admin' });

    const startJob = (id: string) =>
      request(ts.baseUrl).patch(`/api/appointments/${id}/start`)
        .set('Authorization', `Bearer ${techToken}`).send({});

    async function completeJob(id: string) {
      await startJob(id);
      // A technician completion requires all four of these (see the route).
      return request(ts.baseUrl).patch(`/api/appointments/${id}/complete`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({
          serviceDetails: 'filters replaced',
          completionAmount: 250,
          completionPaymentMethod: 'CASH',
          actualCompletionDate: new Date().toISOString(),
        });
    }

    const deleteAppointment = (id: string) =>
      request(ts.baseUrl).delete(`/api/appointments/${id}`).set('Authorization', `Bearer ${adminToken}`);

    // ---------------------------------------------------------- PUT /:id
    it('PUT /:id -- visible: Admin AND Scheduling both receive', async () => {
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(true);

      const adminSeen = waitForEvent(adminSock, 'appointment:status');
      const schedSeen = waitForEvent(schedSock, 'appointment:status');
      expect((await editAppointment(apptId)).status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      expect((await schedSeen).id).toBe(apptId);
    });

    it('PUT /:id -- hidden: Admin receives, Scheduling receives nothing', async () => {
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(false);

      const adminSeen = waitForEvent(adminSock, 'appointment:status');
      const schedSilent = assertEventNotReceived(schedSock, 'appointment:status');
      expect((await editAppointment(apptId)).status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      await schedSilent;
    });

    // --------------------------------------------------- PATCH /:id/status
    it('/status -- visible: Admin AND Scheduling both receive', async () => {
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(true);

      const adminSeen = waitForEvent(adminSock, 'appointment:status');
      const schedSeen = waitForEvent(schedSock, 'appointment:status');
      expect((await setStatus(apptId)).status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      expect((await schedSeen).id).toBe(apptId);
    });

    it('/status -- hidden: Admin receives, Scheduling receives nothing', async () => {
      // The lookup in this route is scoped for a SCHEDULING caller but NOT for
      // an ADMIN one, which is exactly how a hidden appointment reached the
      // Scheduling room from here.
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(false);

      const adminSeen = waitForEvent(adminSock, 'appointment:status');
      const schedSilent = assertEventNotReceived(schedSock, 'appointment:status');
      expect((await setStatus(apptId)).status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      await schedSilent;
    });

    // ---------------------------------------------------- PATCH /:id/start
    it('/start -- Admin and the owning technician receive; Scheduling is never an audience', async () => {
      // This route has no Scheduling emit at all, by design. Asserted so a
      // future edit cannot quietly add one without the gate.
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const techSock = track(await connectSocket(ts.baseUrl, techToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(true);

      const adminSeen = waitForEvent(adminSock, 'appointment:started');
      const techSeen = waitForEvent(techSock, 'appointment:started');
      const schedSilent = assertEventNotReceived(schedSock, 'appointment:started');
      expect((await startJob(apptId)).status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      expect((await techSeen).id).toBe(apptId);
      await schedSilent;
    });

    // ------------------------------------------------- PATCH /:id/complete
    it('/complete -- visible: Admin, Scheduling and the owning technician all receive', async () => {
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const techSock = track(await connectSocket(ts.baseUrl, techToken));
      const apptId = await createAppointment(true);

      const adminSeen = waitForEvent(adminSock, 'appointment:completed');
      const schedSeen = waitForEvent(schedSock, 'appointment:completed');
      const techSeen = waitForEvent(techSock, 'appointment:completed');
      expect((await completeJob(apptId)).status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      expect((await schedSeen).id).toBe(apptId);
      expect((await techSeen).id).toBe(apptId);
      // Admin sees the money; Scheduling's copy must not carry it.
      expect((await adminSeen).completionAmount).toBe(250);
      expect((await schedSeen).completionAmount).toBeUndefined();
    });

    it('/complete -- hidden: Admin and technician receive, Scheduling receives nothing', async () => {
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const techSock = track(await connectSocket(ts.baseUrl, techToken));
      const apptId = await createAppointment(false);

      const adminSeen = waitForEvent(adminSock, 'appointment:completed');
      const techSeen = waitForEvent(techSock, 'appointment:completed');
      const schedSilent = assertEventNotReceived(schedSock, 'appointment:completed');
      expect((await completeJob(apptId)).status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      expect((await techSeen).id).toBe(apptId);
      await schedSilent;
    });

    it('/complete on a hidden appointment still attributes the authenticated technician and recalculates the due date', async () => {
      // Recipient gating only: completion ownership, the authenticated identity
      // and the atomic due-date recalculation must be untouched by this change.
      const apptId = await createAppointment(false);
      expect((await completeJob(apptId)).status).toBe(200);

      const appt = await prisma.appointment.findUnique({ where: { id: apptId } });
      expect(appt!.workStatus).toBe('COMPLETED');
      expect(appt!.technicianId).toBe(users.technician.id);
      expect(appt!.completedAt).not.toBeNull();

      const cust = await prisma.customer.findUnique({ where: { id: customerId } });
      expect(cust!.nextMaintenanceDueAt).not.toBeNull();
    });

    // --------------------------------------------------------- DELETE /:id
    it('DELETE /:id -- visible: Scheduling receives the id-only invalidation', async () => {
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(true);

      const schedSeen = waitForEvent(schedSock, 'appointment:deleted');
      expect((await deleteAppointment(apptId)).status).toBe(200);
      expect((await schedSeen).id).toBe(apptId);
    });

    it('DELETE /:id -- hidden: Admin receives, Scheduling is not told the id existed', async () => {
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(false);

      const adminSeen = waitForEvent(adminSock, 'appointment:deleted');
      const schedSilent = assertEventNotReceived(schedSock, 'appointment:deleted');
      expect((await deleteAppointment(apptId)).status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      await schedSilent;
    });

    // --------------------------------------------- PATCH /:id/approve-export
    it('/approve-export -- visible: Scheduling still receives (the gate is not over-applied)', async () => {
      // A Scheduling-created appointment starts pending export approval and is
      // visibleToScheduling by construction. This is the normal flow, and the
      // new gate must not disturb it.
      const created = await request(ts.baseUrl).post('/api/appointments')
        .set('Authorization', `Bearer ${schedToken}`)
        .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 4 * 86400000).toISOString() });
      expect(created.status).toBe(201);
      const apptId = created.body.data.id as string;
      apptIds.push(apptId);
      expect(created.body.data.visibleToScheduling).toBe(true);
      expect(created.body.data.visibleToTechnician).toBe(false);

      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const adminSeen = waitForEvent(adminSock, 'appointment:status');
      const schedSeen = waitForEvent(schedSock, 'appointment:status');

      const res = await request(ts.baseUrl).patch(`/api/appointments/${apptId}/approve-export`)
        .set('Authorization', `Bearer ${adminToken}`).send({});
      expect(res.status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      expect((await schedSeen).id).toBe(apptId);
    });

    it('/approve-export -- hidden: Admin receives, Scheduling receives nothing', async () => {
      // Admin can hide a pending-export appointment first; approve-export leaves
      // visibleToScheduling untouched, so it would otherwise broadcast a hidden
      // appointment to the whole Scheduling room.
      const created = await request(ts.baseUrl).post('/api/appointments')
        .set('Authorization', `Bearer ${schedToken}`)
        .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 5 * 86400000).toISOString() });
      expect(created.status).toBe(201);
      const apptId = created.body.data.id as string;
      apptIds.push(apptId);

      const hide = await request(ts.baseUrl).put(`/api/appointments/${apptId}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ visibleToScheduling: false });
      expect(hide.status).toBe(200);
      expect(hide.body.data.visibleToScheduling).toBe(false);

      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const adminSeen = waitForEvent(adminSock, 'appointment:status');
      const schedSilent = assertEventNotReceived(schedSock, 'appointment:status');

      const res = await request(ts.baseUrl).patch(`/api/appointments/${apptId}/approve-export`)
        .set('Authorization', `Bearer ${adminToken}`).send({});
      expect(res.status).toBe(200);

      expect((await adminSeen).id).toBe(apptId);
      await schedSilent;
    });

    it('revoking visibility mid-life stops Scheduling events from that point on', async () => {
      // Documents the visible -> hidden transition deliberately: the PUT that
      // performs the revocation emits nothing to Scheduling (the appointment is
      // already hidden by the time the gate runs), and no later event reaches
      // them either. A Scheduling client that cached the row while it was
      // visible keeps showing it until its next refetch -- accepted, because the
      // alternative is inventing an invalidation event that would itself have to
      // name the appointment.
      const adminSock = track(await connectSocket(ts.baseUrl, adminToken));
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const apptId = await createAppointment(true);

      // Visible: Scheduling does receive this one.
      const firstSeen = waitForEvent(schedSock, 'appointment:status');
      expect((await editAppointment(apptId)).status).toBe(200);
      expect((await firstSeen).id).toBe(apptId);

      // Revoke visibility -- and from here on, silence for Scheduling.
      const revokeSilent = assertEventNotReceived(schedSock, 'appointment:status');
      const revoke = await request(ts.baseUrl).put(`/api/appointments/${apptId}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ visibleToScheduling: false });
      expect(revoke.status).toBe(200);
      await revokeSilent;

      const laterSilent = assertEventNotReceived(schedSock, 'appointment:status');
      const adminSeen = waitForEvent(adminSock, 'appointment:status');
      expect((await setStatus(apptId)).status).toBe(200);
      expect((await adminSeen).id).toBe(apptId);
      await laterSilent;

      // And REST agrees.
      const byId = await request(ts.baseUrl).get(`/api/appointments/${apptId}`)
        .set('Authorization', `Bearer ${schedToken}`);
      expect(byId.status).toBe(404);
    });

    // ------------------------------------------------------------ SWEEP
    it('no hidden-appointment mutation leaks ANY customer or appointment data to Scheduling', async () => {
      // One socket, every appointment event name, across the whole mutation
      // sequence on a hidden appointment.
      const schedSock = track(await connectSocket(ts.baseUrl, schedToken));
      const received: any[] = [];
      for (const ev of ['appointment:created', 'appointment:status', 'appointment:started',
                        'appointment:completed', 'appointment:postponed', 'appointment:no-answer',
                        'appointment:deleted', 'customer:created']) {
        schedSock.on(ev, (p: any) => received.push({ ev, p }));
      }

      const apptId = await createAppointment(false);
      await editAppointment(apptId);
      await setStatus(apptId);
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/no-answer`)
        .set('Authorization', `Bearer ${techToken}`).send({ note: 'x' });
      await completeJob(apptId);
      await deleteAppointment(apptId);
      await new Promise((r) => setTimeout(r, 900));

      const dump = JSON.stringify(received);
      expect(dump).not.toContain(apptId);
      expect(dump).not.toContain('Realtime Privacy Customer');
      expect(dump).not.toContain('0559990077');
      expect(received).toHaveLength(0);
    });

    it('the hidden appointment remains unfetchable through Scheduling REST throughout', async () => {
      const apptId = await createAppointment(false);
      await editAppointment(apptId);
      await setStatus(apptId);

      const byId = await request(ts.baseUrl).get(`/api/appointments/${apptId}`)
        .set('Authorization', `Bearer ${schedToken}`);
      expect(byId.status).toBe(404);
      const list = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${schedToken}`);
      expect((list.body.data || []).map((a: any) => a.id)).not.toContain(apptId);
    });
  });
});
