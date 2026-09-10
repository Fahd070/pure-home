/**
 * PHASE 2: the three critical notification events.
 *
 * These tests exist to lock down the two properties that are easy to break and
 * expensive to get wrong -- WHO receives a notification, and how many are
 * created -- against the real Express app and a real database, not mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';
import { createNotifications } from '../src/services/notification.service';

const URGENT_PHONE = '0501234567';

describe('Phase 2 critical notifications', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string, tech2Token: string;
  // An extra, deliberately INACTIVE admin: the recipient rules must skip them.
  let inactiveAdminId: string;
  let customerId: string;
  const apptIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
    tech2Token = signTestToken(users.technician2.id, 'TECHNICIAN');

    const inactive = await prisma.user.upsert({
      where: { email: 'inactive-admin@test.local' },
      update: { isActive: false },
      create: {
        name: 'Inactive Admin', email: 'inactive-admin@test.local',
        password: 'x', role: 'ADMIN', isActive: false,
      },
    });
    inactiveAdminId = inactive.id;

    const cust = await prisma.customer.create({
      data: { name: 'Phase2 Notify Customer', phone: '0559990001', maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1 },
    });
    customerId = cust.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { type: { in: ['URGENT_APPOINTMENT_ASSIGNED', 'APPOINTMENT_POSTPONED', 'APPOINTMENT_NO_ANSWER'] } },
    });
    if (apptIds.length) await prisma.appointment.deleteMany({ where: { id: { in: apptIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.customer.deleteMany({ where: { phone: URGENT_PHONE } });
    await prisma.user.deleteMany({ where: { id: inactiveAdminId } });
    await stopTestServer(ts.server);
  });

  // Every test starts from a clean notification slate so counts are exact.
  beforeEach(async () => {
    await prisma.notification.deleteMany({});
  });

  const notifsFor = (userId: string, type?: string) =>
    prisma.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: { createdAt: 'asc' } });

  async function createAppointment(body: any, token = adminToken) {
    const res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${token}`).send(body);
    if (res.body?.data?.id) apptIds.push(res.body.data.id);
    return res;
  }

  async function createNormalAppointment(technicianId?: string) {
    const res = await createAppointment({
      customerId,
      type: 'MAINTENANCE',
      scheduledDate: new Date(Date.now() + 3 * 86400000).toISOString(),
      ...(technicianId ? { technicianId } : {}),
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  // ---------------------------------------------------------------- EVENT A
  describe('Event A -- urgent appointment assigned to a technician', () => {
    async function createUrgentAssigned(technicianId: string | undefined) {
      return createAppointment({
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        isUrgent: true,
        customerName: 'Urgent Notify Customer',
        customerPhone: URGENT_PHONE,
        urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'D', street: 'S' }),
        ...(technicianId ? { technicianId } : {}),
      });
    }

    it('notifies ONLY the assigned technician, with CRITICAL severity and the appointment entity', async () => {
      const res = await createUrgentAssigned(users.technician.id);
      expect(res.status).toBe(201);

      const mine = await notifsFor(users.technician.id, 'URGENT_APPOINTMENT_ASSIGNED');
      expect(mine).toHaveLength(1);
      expect(mine[0].severity).toBe('CRITICAL');
      expect(mine[0].entityType).toBe('appointment');
      expect(mine[0].entityId).toBe(res.body.data.id);
      expect(mine[0].isRead).toBe(false);

      // Role isolation: nobody else -- not the other technician, not the
      // Administration/Scheduling users -- receives this technician-private row.
      expect(await notifsFor(users.technician2.id, 'URGENT_APPOINTMENT_ASSIGNED')).toHaveLength(0);
      expect(await notifsFor(users.admin.id, 'URGENT_APPOINTMENT_ASSIGNED')).toHaveLength(0);
      expect(await notifsFor(users.scheduling.id, 'URGENT_APPOINTMENT_ASSIGNED')).toHaveLength(0);
    });

    it('creates NO urgent notification when the urgent appointment has no assignee', async () => {
      const res = await createUrgentAssigned(undefined);
      expect(res.status).toBe(201);
      expect(await prisma.notification.count({ where: { type: 'URGENT_APPOINTMENT_ASSIGNED' } })).toBe(0);
    });

    it('creates NO notification when the named assignee is not an active technician', async () => {
      // An Admin user id in technicianId must not become a notification
      // recipient: the recipient is re-derived from role + active state.
      const res = await createUrgentAssigned(users.admin.id);
      expect(res.status).toBe(201);
      expect(await prisma.notification.count({ where: { type: 'URGENT_APPOINTMENT_ASSIGNED' } })).toBe(0);
    });

    it('carries no financial, credential or internal field in its payload', async () => {
      await createUrgentAssigned(users.technician.id);
      const [n] = await notifsFor(users.technician.id, 'URGENT_APPOINTMENT_ASSIGNED');
      const text = `${n.title} ${n.body}`.toLowerCase();
      for (const forbidden of ['password', 'accesscode', 'sessionversion', 'completionamount', 'hash']) {
        expect(text).not.toContain(forbidden);
      }
    });
  });

  // ---------------------------------------------------------------- EVENT B
  describe('Event B -- technician postpones', () => {
    it('notifies every ACTIVE Admin and Scheduling user, and no technician', async () => {
      const apptId = await createNormalAppointment(users.technician.id);
      const res = await request(ts.baseUrl)
        .patch(`/api/appointments/${apptId}/postpone`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ note: 'Customer asked to move it', newDate: new Date(Date.now() + 10 * 86400000).toISOString() });
      expect(res.status).toBe(200);

      const adminN = await notifsFor(users.admin.id, 'APPOINTMENT_POSTPONED');
      const schedN = await notifsFor(users.scheduling.id, 'APPOINTMENT_POSTPONED');
      expect(adminN).toHaveLength(1);
      expect(schedN).toHaveLength(1);
      expect(adminN[0].severity).toBe('CRITICAL');
      expect(adminN[0].entityId).toBe(apptId);

      // The acting technician and every unrelated technician get nothing.
      expect(await notifsFor(users.technician.id, 'APPOINTMENT_POSTPONED')).toHaveLength(0);
      expect(await notifsFor(users.technician2.id, 'APPOINTMENT_POSTPONED')).toHaveLength(0);
      // Inactive users are never recipients.
      expect(await notifsFor(inactiveAdminId, 'APPOINTMENT_POSTPONED')).toHaveLength(0);
    });

    it('names the AUTHENTICATED actor, not the appointment assignee', async () => {
      // Unassigned job postponed by technician 2 from the shared pool: the
      // notification must attribute technician 2, and there is no assignee at all.
      const apptId = await createNormalAppointment(undefined);
      await request(ts.baseUrl)
        .patch(`/api/appointments/${apptId}/postpone`)
        .set('Authorization', `Bearer ${tech2Token}`)
        .send({ note: 'n', newDate: new Date(Date.now() + 5 * 86400000).toISOString() });

      const [n] = await notifsFor(users.admin.id, 'APPOINTMENT_POSTPONED');
      expect(n.body).toContain('Test Technician 2');
    });

    it('two legitimate postponements of the same appointment create TWO notifications', async () => {
      const apptId = await createNormalAppointment(users.technician.id);
      const postpone = (days: number) =>
        request(ts.baseUrl)
          .patch(`/api/appointments/${apptId}/postpone`)
          .set('Authorization', `Bearer ${techToken}`)
          .send({ note: `move ${days}`, newDate: new Date(Date.now() + days * 86400000).toISOString() });

      expect((await postpone(4)).status).toBe(200);
      expect((await postpone(9)).status).toBe(200);

      // Two distinct postponement EVENTS -> two distinct notifications, because
      // the dedupe key is the postponement record, not the appointment.
      const adminN = await notifsFor(users.admin.id, 'APPOINTMENT_POSTPONED');
      expect(adminN).toHaveLength(2);
      expect(new Set(adminN.map((n) => n.dedupeKey)).size).toBe(2);
    });
  });

  // ---------------------------------------------------------------- EVENT C
  describe('Event C -- customer did not answer', () => {
    it('notifies every ACTIVE Admin and Scheduling user, and no technician', async () => {
      const apptId = await createNormalAppointment(users.technician.id);
      const res = await request(ts.baseUrl)
        .patch(`/api/appointments/${apptId}/no-answer`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ note: 'Rang twice' });
      expect(res.status).toBe(200);

      expect(await notifsFor(users.admin.id, 'APPOINTMENT_NO_ANSWER')).toHaveLength(1);
      expect(await notifsFor(users.scheduling.id, 'APPOINTMENT_NO_ANSWER')).toHaveLength(1);
      expect(await notifsFor(users.technician.id, 'APPOINTMENT_NO_ANSWER')).toHaveLength(0);
      expect(await notifsFor(users.technician2.id, 'APPOINTMENT_NO_ANSWER')).toHaveLength(0);
      expect(await notifsFor(inactiveAdminId, 'APPOINTMENT_NO_ANSWER')).toHaveLength(0);
    });

    it('two contact attempts on the same appointment create TWO notifications', async () => {
      const apptId = await createNormalAppointment(users.technician.id);
      const attempt = (note: string) =>
        request(ts.baseUrl)
          .patch(`/api/appointments/${apptId}/no-answer`)
          .set('Authorization', `Bearer ${techToken}`)
          .send({ note });

      expect((await attempt('first')).status).toBe(200);
      expect((await attempt('second')).status).toBe(200);

      const adminN = await notifsFor(users.admin.id, 'APPOINTMENT_NO_ANSWER');
      expect(adminN).toHaveLength(2);
      expect(new Set(adminN.map((n) => n.dedupeKey)).size).toBe(2);
    });

    it('leaves the appointment actionable (Phase 1 semantics unchanged)', async () => {
      const apptId = await createNormalAppointment(users.technician.id);
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/no-answer`).set('Authorization', `Bearer ${techToken}`).send({});
      const appt = await prisma.appointment.findUnique({ where: { id: apptId } });
      expect(appt!.workStatus).toBe('WAITING');
    });
  });

  // ------------------------------------------------- VISIBILITY (SECURITY)
  describe('Scheduling visibility gate', () => {
    /**
     * `visibleToScheduling: false` is an authorization gate, not a preference:
     * GET /appointments and GET /appointments/:id both 404 for Scheduling on
     * such a row. A notification names the customer and the dates, so
     * announcing the event to Scheduling would be a disclosure channel around
     * that gate.
     */
    async function createHiddenAppointment() {
      const res = await createAppointment({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 3 * 86400000).toISOString(),
        technicianId: users.technician.id,
        visibleToScheduling: false,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.visibleToScheduling).toBe(false);
      return res.body.data.id as string;
    }

    it('Scheduling genuinely cannot read the hidden appointment', async () => {
      const apptId = await createHiddenAppointment();
      const res = await request(ts.baseUrl).get(`/api/appointments/${apptId}`).set('Authorization', `Bearer ${schedToken}`);
      expect(res.status).toBe(404);
    });

    it('a postponement on a Scheduling-hidden appointment notifies Admin ONLY', async () => {
      const apptId = await createHiddenAppointment();
      await request(ts.baseUrl)
        .patch(`/api/appointments/${apptId}/postpone`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ note: 'x', newDate: new Date(Date.now() + 8 * 86400000).toISOString() });

      expect(await notifsFor(users.admin.id, 'APPOINTMENT_POSTPONED')).toHaveLength(1);
      // The customer name must not reach a role that cannot open the record.
      expect(await notifsFor(users.scheduling.id, 'APPOINTMENT_POSTPONED')).toHaveLength(0);
    });

    it('a did-not-answer on a Scheduling-hidden appointment notifies Admin ONLY', async () => {
      const apptId = await createHiddenAppointment();
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/no-answer`).set('Authorization', `Bearer ${techToken}`).send({});

      expect(await notifsFor(users.admin.id, 'APPOINTMENT_NO_ANSWER')).toHaveLength(1);
      expect(await notifsFor(users.scheduling.id, 'APPOINTMENT_NO_ANSWER')).toHaveLength(0);
    });

    it('a VISIBLE appointment still reaches Scheduling (the gate is not over-applied)', async () => {
      const apptId = await createNormalAppointment(users.technician.id);
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/no-answer`).set('Authorization', `Bearer ${techToken}`).send({});
      expect(await notifsFor(users.scheduling.id, 'APPOINTMENT_NO_ANSWER')).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------- DEDUPE
  describe('deduplication', () => {
    it('a duplicate insert of the same source event is a safe no-op, not a second row', async () => {
      const content = {
        title: 'عنوان',
        body: 'نص',
        titleEn: 'Title',
        bodyEn: 'Body',
        type: 'APPOINTMENT_POSTPONED',
        severity: 'CRITICAL',
        dedupeKey: 'postpone:fixed-key-for-test',
      };
      const first = await createNotifications(prisma, [users.admin.id], content);
      const second = await createNotifications(prisma, [users.admin.id], content);

      expect(first).toHaveLength(1);
      // The second call reports NO newly-inserted row -- which is exactly what
      // stops an already-acknowledged alert being re-announced over the socket.
      const reallyCreated = await prisma.notification.findMany({ where: { id: { in: second } } });
      expect(reallyCreated).toHaveLength(0);
      expect(await prisma.notification.count({ where: { dedupeKey: 'postpone:fixed-key-for-test' } })).toBe(1);
    });

    it('handles a concurrent duplicate insert race without error and without a duplicate row', async () => {
      const content = {
        title: 'ع', body: 'ن', titleEn: 'T', bodyEn: 'B',
        type: 'APPOINTMENT_NO_ANSWER', severity: 'CRITICAL',
        dedupeKey: 'no-answer:race-key',
      };
      // Both run concurrently against the same unique constraint. The database
      // decides; neither call may throw.
      const results = await Promise.all([
        createNotifications(prisma, [users.admin.id], content),
        createNotifications(prisma, [users.admin.id], content),
      ]);
      expect(results.every(Array.isArray)).toBe(true);
      expect(await prisma.notification.count({ where: { dedupeKey: 'no-answer:race-key' } })).toBe(1);
    });

    it('the same dedupeKey still creates one row PER recipient', async () => {
      const ids = await createNotifications(prisma, [users.admin.id, users.scheduling.id], {
        title: 'ع', body: 'ن', titleEn: 'T', bodyEn: 'B',
        type: 'APPOINTMENT_POSTPONED', severity: 'CRITICAL',
        dedupeKey: 'postpone:per-recipient',
      });
      expect(ids).toHaveLength(2);
      expect(await prisma.notification.count({ where: { dedupeKey: 'postpone:per-recipient' } })).toBe(2);
    });
  });

  // ------------------------------------------------------- COUNTS / FILTERS
  describe('unread-count and severity filter', () => {
    it('returns the unchanged Phase 1 total and byType shape', async () => {
      const apptId = await createNormalAppointment(users.technician.id);
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/no-answer`).set('Authorization', `Bearer ${techToken}`).send({});

      const res = await request(ts.baseUrl).get('/api/notifications/unread-count').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.byType.APPOINTMENT_NO_ANSWER).toBe(1);
      // Shape is exactly Phase 1's -- no field was added to this response.
      expect(Object.keys(res.body.data).sort()).toEqual(['byType', 'total']);
    });

    it('the severity filter returns only the unread critical rows', async () => {
      await prisma.notification.create({
        data: { userId: users.admin.id, title: 'info', body: 'info', type: 'APPOINTMENT_REMINDER', severity: 'INFO' },
      });
      const apptId = await createNormalAppointment(users.technician.id);
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/no-answer`).set('Authorization', `Bearer ${techToken}`).send({});

      const res = await request(ts.baseUrl)
        .get('/api/notifications?unread=true&severity=CRITICAL')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].severity).toBe('CRITICAL');
      expect(res.body.data[0].type).toBe('APPOINTMENT_NO_ANSWER');
    });

    it('another user cannot fetch or acknowledge a private notification', async () => {
      const apptId = await createNormalAppointment(users.technician.id);
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/no-answer`).set('Authorization', `Bearer ${techToken}`).send({});
      const [adminNotif] = await notifsFor(users.admin.id, 'APPOINTMENT_NO_ANSWER');

      // Not listed for anyone else...
      const list = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${tech2Token}`);
      expect(list.body.data.map((n: any) => n.id)).not.toContain(adminNotif.id);
      // ...and not acknowledgeable by anyone else.
      const ack = await request(ts.baseUrl).patch(`/api/notifications/${adminNotif.id}/read`).set('Authorization', `Bearer ${tech2Token}`);
      expect(ack.status).toBe(404);
      expect((await prisma.notification.findUnique({ where: { id: adminNotif.id } }))!.isRead).toBe(false);
    });

    it('acknowledging one notification decrements the unread count', async () => {
      const apptId = await createNormalAppointment(users.technician.id);
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/no-answer`).set('Authorization', `Bearer ${techToken}`).send({});
      const [n] = await notifsFor(users.admin.id, 'APPOINTMENT_NO_ANSWER');

      const before = await request(ts.baseUrl).get('/api/notifications/unread-count').set('Authorization', `Bearer ${adminToken}`);
      expect(before.body.data.total).toBe(1);

      await request(ts.baseUrl).patch(`/api/notifications/${n.id}/read`).set('Authorization', `Bearer ${adminToken}`);

      const after = await request(ts.baseUrl).get('/api/notifications/unread-count').set('Authorization', `Bearer ${adminToken}`);
      expect(after.body.data.total).toBe(0);
      expect(after.body.data.byType.APPOINTMENT_NO_ANSWER ?? 0).toBe(0);
    });
  });

  // ------------------------------------------------------------ DURABILITY
  describe('durability', () => {
    it('creates no notification when the domain mutation itself fails', async () => {
      // A postpone against an appointment in a state that cannot be postponed
      // is rejected before any write -- and must leave no notification behind.
      const apptId = await createNormalAppointment(users.technician.id);
      await prisma.appointment.update({ where: { id: apptId }, data: { workStatus: 'COMPLETED' } });

      const res = await request(ts.baseUrl)
        .patch(`/api/appointments/${apptId}/postpone`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ note: 'x', newDate: new Date(Date.now() + 86400000).toISOString() });
      expect(res.status).toBe(409);
      expect(await prisma.notification.count({ where: { entityId: apptId } })).toBe(0);
    });

    it('the postponement record and its notifications commit together', async () => {
      const apptId = await createNormalAppointment(users.technician.id);
      await request(ts.baseUrl)
        .patch(`/api/appointments/${apptId}/postpone`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ note: 'x', newDate: new Date(Date.now() + 6 * 86400000).toISOString() });

      const records = await prisma.postponementRecord.findMany({ where: { appointmentId: apptId } });
      expect(records).toHaveLength(1);
      // The notification's dedupe key is derived from that very record.
      const [n] = await notifsFor(users.admin.id, 'APPOINTMENT_POSTPONED');
      expect(n.dedupeKey).toBe(`postpone:${records[0].id}`);
      expect(records[0].requestedById).toBe(users.technician.id);
    });
  });
});
