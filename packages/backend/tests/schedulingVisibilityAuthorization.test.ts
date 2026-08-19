// Regression tests for the security patch closing the Scheduling
// object-level-authorization (IDOR/BOLA) gaps found by the read-only audit:
// SCHEDULING must never be able to read or write a customer/appointment that
// GET /api/customers[/:id] or GET /api/appointments[/:id] would already hide
// from them (an admin-private urgent-only customer, or an appointment with
// visibleToScheduling=false), through any alternate write/drill-down/audit-log
// path. Every "hidden object" case below must resolve as a plain 404 for
// SCHEDULING -- indistinguishable from a nonexistent ID -- while ADMIN's own
// behavior against the exact same object remains completely unchanged.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Scheduling object-level visibility authorization (security patch)', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedulingToken: string;

  // Customer fixtures
  let visibleCustomerId = '';
  let hiddenCustomerId = '';

  // Appointment fixtures (one per mutating test group, so tests never interfere
  // with each other's before-state by mutating a shared object)
  let visibleApptId = '';
  let hiddenApptForPutId = '';
  let hiddenApptForStatusId = '';
  let hiddenApptForConfirmId = '';
  let hiddenApptForDashboardPutId = '';
  let hiddenApptForTodayId = '';
  let hiddenUrgentApptId = ''; // the urgent appointment that made hiddenCustomerId private

  const allApptIds = () => [
    visibleApptId, hiddenApptForPutId, hiddenApptForStatusId, hiddenApptForConfirmId,
    hiddenApptForDashboardPutId, hiddenApptForTodayId, hiddenUrgentApptId,
  ].filter(Boolean);

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedulingToken = signTestToken(users.scheduling.id, 'SCHEDULING');

    // A normal, fully-visible customer.
    const customerRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Visibility Test Customer', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1,
      address: { city: 'Riyadh', district: 'Test', street: 'Test' },
    });
    expect(customerRes.status).toBe(201);
    visibleCustomerId = customerRes.body.data.id;

    // An admin-private urgent-only customer: created via an urgent appointment,
    // which is hidden from Scheduling until Admin approves it -- the exact
    // fixture pattern used by tests/urgentPrivacyAndHistory.test.ts.
    const urgentRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
      type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 3600000).toISOString(),
      isUrgent: true, customerName: 'Hidden Private Customer', customerPhone: testPhone(),
      urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'Test', street: 'Hidden Lane' }),
    });
    expect(urgentRes.status).toBe(201);
    hiddenUrgentApptId = urgentRes.body.data.id;
    hiddenCustomerId = urgentRes.body.data.customerId;
    expect(urgentRes.body.data.visibleToScheduling).toBe(false);

    // A normal, Scheduling-visible appointment.
    const visibleApptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
      type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 7200000).toISOString(), customerId: visibleCustomerId,
    });
    expect(visibleApptRes.status).toBe(201);
    visibleApptId = visibleApptRes.body.data.id;
    expect(visibleApptRes.body.data.visibleToScheduling).toBe(true);

    // Hidden (non-urgent) appointments: Admin explicitly hid each one from
    // Scheduling. One per mutating-route test group, so a state change made by
    // one test (e.g. an ADMIN write) can never affect another test's assertions.
    async function createHiddenAppt(): Promise<string> {
      const res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
        type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        customerId: visibleCustomerId, visibleToScheduling: false,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.visibleToScheduling).toBe(false);
      return res.body.data.id;
    }
    hiddenApptForPutId = await createHiddenAppt();
    hiddenApptForStatusId = await createHiddenAppt();
    hiddenApptForConfirmId = await createHiddenAppt();
    hiddenApptForDashboardPutId = await createHiddenAppt();

    // A hidden appointment scheduled for "today" -- WAITING/SCHEDULED (the
    // defaults), so it falls inside GET /dashboard/today's category window.
    const todayRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
      type: 'MAINTENANCE', scheduledDate: new Date().toISOString(),
      customerId: visibleCustomerId, visibleToScheduling: false,
    });
    expect(todayRes.status).toBe(201);
    hiddenApptForTodayId = todayRes.body.data.id;
  });

  afterAll(async () => {
    const ids = allApptIds();
    if (ids.length) await prisma.appointment.deleteMany({ where: { id: { in: ids } } });
    const custIds = [visibleCustomerId, hiddenCustomerId].filter(Boolean);
    if (custIds.length) await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
    await stopTestServer(ts.server);
  });

  // ── Customer write IDOR (PUT /api/customers/:id) ──────────────────────────
  describe('PUT /api/customers/:id', () => {
    it('A. SCHEDULING can update a normal, visible customer', async () => {
      const res = await request(ts.baseUrl).put(`/api/customers/${visibleCustomerId}`)
        .set('Authorization', `Bearer ${schedulingToken}`).send({ notes: 'Scheduling can edit this' });
      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('Scheduling can edit this');
    });

    it('B/C. SCHEDULING cannot update the hidden admin-private customer -- returns 404, not 403', async () => {
      const res = await request(ts.baseUrl).put(`/api/customers/${hiddenCustomerId}`)
        .set('Authorization', `Bearer ${schedulingToken}`).send({ notes: 'Attempted IDOR write' });
      expect(res.status).toBe(404);
      // Confirm the write never happened.
      const stillHidden = await prisma.customer.findUnique({ where: { id: hiddenCustomerId } });
      expect(stillHidden?.notes).not.toBe('Attempted IDOR write');
    });

    it('D. ADMIN can still update the same hidden customer (unaffected by the patch)', async () => {
      const res = await request(ts.baseUrl).put(`/api/customers/${hiddenCustomerId}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ notes: 'Admin can still edit this' });
      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('Admin can still edit this');
    });
  });

  // ── Appointment write IDOR (PUT /api/appointments/:id) ────────────────────
  describe('PUT /api/appointments/:id', () => {
    it('SCHEDULING can update a visible appointment', async () => {
      const res = await request(ts.baseUrl).put(`/api/appointments/${visibleApptId}`)
        .set('Authorization', `Bearer ${schedulingToken}`).send({ notes: 'Scheduling edit' });
      expect(res.status).toBe(200);
    });

    it('SCHEDULING cannot update a hidden appointment -- returns 404', async () => {
      const res = await request(ts.baseUrl).put(`/api/appointments/${hiddenApptForPutId}`)
        .set('Authorization', `Bearer ${schedulingToken}`).send({ notes: 'Attempted IDOR write' });
      expect(res.status).toBe(404);
      const stillHidden = await prisma.appointment.findUnique({ where: { id: hiddenApptForPutId } });
      expect(stillHidden?.notes).not.toBe('Attempted IDOR write');
    });

    it('ADMIN can still update the same hidden appointment', async () => {
      const res = await request(ts.baseUrl).put(`/api/appointments/${hiddenApptForPutId}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ notes: 'Admin edit' });
      expect(res.status).toBe(200);
    });
  });

  // ── PATCH /api/appointments/:id/status ─────────────────────────────────────
  describe('PATCH /api/appointments/:id/status', () => {
    it('SCHEDULING on a hidden appointment now returns 404 (previously a distinguishable 403)', async () => {
      const res = await request(ts.baseUrl).patch(`/api/appointments/${hiddenApptForStatusId}/status`)
        .set('Authorization', `Bearer ${schedulingToken}`).send({ status: 'CANCELLED' });
      expect(res.status).toBe(404);
    });

    it('SCHEDULING on a visible appointment still succeeds', async () => {
      const res = await request(ts.baseUrl).patch(`/api/appointments/${visibleApptId}/status`)
        .set('Authorization', `Bearer ${schedulingToken}`).send({ status: 'RESCHEDULED' });
      expect(res.status).toBe(200);
    });

    it('ADMIN on the same hidden appointment still succeeds', async () => {
      const res = await request(ts.baseUrl).patch(`/api/appointments/${hiddenApptForStatusId}/status`)
        .set('Authorization', `Bearer ${adminToken}`).send({ status: 'CANCELLED' });
      expect(res.status).toBe(200);
    });
  });

  // ── PATCH /api/appointments/:id/confirm-operation ──────────────────────────
  describe('PATCH /api/appointments/:id/confirm-operation', () => {
    it('SCHEDULING on a hidden appointment returns 404 (not a workStatus-conflict 409)', async () => {
      const res = await request(ts.baseUrl).patch(`/api/appointments/${hiddenApptForConfirmId}/confirm-operation`)
        .set('Authorization', `Bearer ${schedulingToken}`).send({});
      expect(res.status).toBe(404);
    });
  });

  // ── Dashboard alternate-path write (PUT /api/dashboard/appointment/:id) ───
  describe('PUT /api/dashboard/appointment/:id', () => {
    it('SCHEDULING cannot reach a hidden appointment through the dashboard drill-down write -- 404', async () => {
      const res = await request(ts.baseUrl).put(`/api/dashboard/appointment/${hiddenApptForDashboardPutId}`)
        .set('Authorization', `Bearer ${schedulingToken}`).send({ notes: 'Attempted dashboard IDOR write' });
      expect(res.status).toBe(404);
      const stillHidden = await prisma.appointment.findUnique({ where: { id: hiddenApptForDashboardPutId } });
      expect(stillHidden?.notes).not.toBe('Attempted dashboard IDOR write');
    });

    it('SCHEDULING can still reach a visible appointment through the same dashboard drill-down write', async () => {
      const res = await request(ts.baseUrl).put(`/api/dashboard/appointment/${visibleApptId}`)
        .set('Authorization', `Bearer ${schedulingToken}`).send({ notes: 'Scheduling dashboard edit' });
      expect(res.status).toBe(200);
    });

    it('ADMIN can still update the same hidden appointment through this route', async () => {
      const res = await request(ts.baseUrl).put(`/api/dashboard/appointment/${hiddenApptForDashboardPutId}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ notes: 'Admin dashboard edit' });
      expect(res.status).toBe(200);
    });
  });

  // ── Dashboard drill-down category leak (GET /api/dashboard/today) ─────────
  describe('GET /api/dashboard/today (operational-category drill-down)', () => {
    it('SCHEDULING never sees a hidden appointment in a drill-down category', async () => {
      const res = await request(ts.baseUrl).get('/api/dashboard/today').set('Authorization', `Bearer ${schedulingToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((a: any) => a.id === hiddenApptForTodayId)).toBe(false);
    });

    it('ADMIN still sees the same appointment in the same category', async () => {
      const res = await request(ts.baseUrl).get('/api/dashboard/today').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((a: any) => a.id === hiddenApptForTodayId)).toBe(true);
    });
  });

  // ── Reports customer visibility (GET /api/reports/customers) ──────────────
  describe('GET /api/reports/customers', () => {
    it('a visible customer appears for Scheduling when searched by name', async () => {
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ search: 'Visibility Test Customer' })
        .set('Authorization', `Bearer ${schedulingToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((c: any) => c.id === visibleCustomerId)).toBe(true);
    });

    it('the hidden admin-private customer never appears for Scheduling, even without a search filter', async () => {
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' })
        .set('Authorization', `Bearer ${schedulingToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((c: any) => c.id === hiddenCustomerId)).toBe(false);
    });

    it('Admin still sees the hidden customer in the same report', async () => {
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((c: any) => c.id === hiddenCustomerId)).toBe(true);
    });

    it('Scheduling still sees the visible customer in the same unfiltered report', async () => {
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' })
        .set('Authorization', `Bearer ${schedulingToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((c: any) => c.id === visibleCustomerId)).toBe(true);
    });
  });

  // ── Audit log / activity feed privacy bypass (GET /api/messages) ──────────
  describe('GET /api/messages (audit log side channel)', () => {
    it('A. Scheduling sees the audit entry for the visible customer', async () => {
      const res = await request(ts.baseUrl).get('/api/messages').set('Authorization', `Bearer ${schedulingToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((e: any) => e.entityType === 'customer' && e.entityId === visibleCustomerId)).toBe(true);
    });

    it('B. Scheduling does NOT see the audit entry for the hidden admin-private customer', async () => {
      const res = await request(ts.baseUrl).get('/api/messages').set('Authorization', `Bearer ${schedulingToken}`);
      expect(res.status).toBe(200);
      const leaked = res.body.data.find((e: any) => e.entityType === 'customer' && e.entityId === hiddenCustomerId);
      expect(leaked).toBeUndefined();
    });

    it('C. Admin still sees audit entries for both the visible and the hidden customer', async () => {
      const res = await request(ts.baseUrl).get('/api/messages').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((e: any) => e.entityType === 'customer' && e.entityId === visibleCustomerId)).toBe(true);
      expect(res.body.data.some((e: any) => e.entityType === 'customer' && e.entityId === hiddenCustomerId)).toBe(true);
    });

    it('D. Scheduling still sees appointment audit rows for visible appointments, and never for hidden ones', async () => {
      const res = await request(ts.baseUrl).get('/api/messages').set('Authorization', `Bearer ${schedulingToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((e: any) => e.entityType === 'appointment' && e.entityId === visibleApptId)).toBe(true);
      expect(res.body.data.some((e: any) => e.entityType === 'appointment' && e.entityId === hiddenUrgentApptId)).toBe(false);
    });

    it('E. pagination/take behavior is unchanged: at most 100 rows, meta.total present', async () => {
      const res = await request(ts.baseUrl).get('/api/messages').set('Authorization', `Bearer ${schedulingToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(100);
      expect(typeof res.body.meta.total).toBe('number');
    });
  });
});
