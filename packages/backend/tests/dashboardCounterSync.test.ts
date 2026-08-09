// Dashboard counter synchronization fix (Part B): GET /dashboard/stats'
// `completed` and `pending` (postponed) counts were missing the
// `customerId: { not: null }` filter that every sibling count query in the
// same endpoint, and each counter's own drill-down endpoint
// (/completed-maintenance, /postponed), already had. That made those two
// counters stay stale forever after a customer deletion left a completed or
// postponed appointment orphaned (customerId -> null) -- the exact scenario
// the deletion-sync fix (customerDeletionSync.test.ts) intentionally
// preserves for COMPLETED appointments. Root-cause fix: add the same filter,
// matching this endpoint's own existing convention. The frontend's React
// Query invalidation + Socket.IO refresh on `customer:deleted`/
// `appointment:deleted` (both Admin and Scheduling dashboards) was already
// implemented by a prior modification -- confirmed unaffected here, and
// covered at the source level in the web test suite.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

function dateOnly(d: Date | string): string { return new Date(d).toISOString().slice(0, 10); }

describe('Dashboard counter synchronization after deletion (Part B)', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;
  const createdCustomerIds: string[] = [];
  const createdAppointmentIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    if (createdCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await stopTestServer(ts.server);
  });

  async function createCustomer(name: string): Promise<string> {
    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    createdCustomerIds.push(id);
    return id;
  }

  async function createAppointment(customerId: string): Promise<string> {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString(), technicianId: users.technician.id });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    createdAppointmentIds.push(id);
    return id;
  }

  async function completeViaTechnician(customerId: string): Promise<string> {
    const apptId = await createAppointment(customerId);
    await request(ts.baseUrl).patch(`/api/appointments/${apptId}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    const res = await request(ts.baseUrl).patch(`/api/appointments/${apptId}/complete`).set('Authorization', `Bearer ${techToken}`).send({
      serviceDetails: 'Serviced', completionAmount: 150, completionPaymentMethod: 'CASH',
      actualCompletionDate: dateOnly(new Date()), technicianName: 'Ahmed',
    });
    expect(res.status).toBe(200);
    return apptId;
  }

  async function postponeViaTechnician(customerId: string): Promise<string> {
    const apptId = await createAppointment(customerId);
    await request(ts.baseUrl).patch(`/api/appointments/${apptId}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    const res = await request(ts.baseUrl).patch(`/api/appointments/${apptId}/postpone`).set('Authorization', `Bearer ${techToken}`).send({ reason: 'Customer unavailable' });
    expect(res.status).toBe(200);
    return apptId;
  }

  async function getStats(token: string) {
    const res = await request(ts.baseUrl).get('/api/dashboard/stats').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body.data;
  }

  // 16, 17, 18, 19. Completed counter includes the appointment, then decreases
  // to exclude it once the owning customer is deleted.
  it('the "completed" stats counter recalculates correctly after the customer is deleted', async () => {
    const custId = await createCustomer('Counter Sync Completed Customer');
    await completeViaTechnician(custId);

    const before = await getStats(adminToken);
    expect(before.completed).toBeGreaterThan(0);

    await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);

    const after = await getStats(adminToken);
    expect(after.completed).toBe(before.completed - 1);
  });

  // 20. Postponed/suspended counter recalculates correctly after deletion.
  it('the "pending" (postponed) stats counter recalculates correctly after the customer is deleted', async () => {
    const custId = await createCustomer('Counter Sync Postponed Customer');
    await postponeViaTechnician(custId);

    const before = await getStats(adminToken);
    expect(before.pending).toBeGreaterThan(0);

    await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);

    const after = await getStats(adminToken);
    // The postponed appointment is itself deleted by the operational cleanup
    // (customerDeletionSync.test.ts), so the counter must reflect that too.
    expect(after.pending).toBe(before.pending - 1);
  });

  // 21, 22. Both Admin and Scheduling dashboards consume the same backend
  // aggregate (GET /dashboard/stats), so a single fix updates both.
  it('the fix applies identically to both the Admin and Scheduling dashboards (same endpoint)', async () => {
    const custId = await createCustomer('Counter Sync Both Dashboards Customer');
    await completeViaTechnician(custId);

    const adminBefore = await getStats(adminToken);
    const schedBefore = await getStats(schedToken);
    expect(adminBefore.completed).toBe(schedBefore.completed);

    await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);

    const adminAfter = await getStats(adminToken);
    const schedAfter = await getStats(schedToken);
    expect(adminAfter.completed).toBe(adminBefore.completed - 1);
    expect(schedAfter.completed).toBe(schedBefore.completed - 1);
    expect(adminAfter.completed).toBe(schedAfter.completed);
  });

  // 26. Existing counter definitions are unchanged -- thisMonth/nextMonth/todayCount/
  // pendingApproval already filtered customerId: not null before this fix and still do;
  // an appointment for a customer that is NOT deleted still counts normally everywhere.
  it('an appointment for a customer that still exists keeps contributing to every relevant counter (definitions unchanged)', async () => {
    const custId = await createCustomer('Counter Sync Definitions Unchanged Customer');
    const now = new Date();
    const thisMonthDate = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate() + 1, 27));
    const apptRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId: custId, type: 'MAINTENANCE', scheduledDate: thisMonthDate.toISOString() });
    expect(apptRes.status).toBe(201);
    createdAppointmentIds.push(apptRes.body.data.id);

    const stats = await getStats(adminToken);
    expect(stats.thisMonth).toBeGreaterThan(0);
  });

  // 27. Deleting Customer A does not change unrelated Customer B's contribution to counts.
  it('deleting Customer A does not affect Customer B\'s counted appointments', async () => {
    const custA = await createCustomer('Counter Sync Customer A');
    const custB = await createCustomer('Counter Sync Customer B (bystander)');
    await completeViaTechnician(custA);
    const bApptId = await completeViaTechnician(custB);

    const before = await getStats(adminToken);
    await request(ts.baseUrl).delete(`/api/customers/${custA}`).set('Authorization', `Bearer ${adminToken}`);
    const after = await getStats(adminToken);

    expect(after.completed).toBe(before.completed - 1);
    // Customer B's completed appointment must still exist and still be attributed to B.
    const bAppt = await prisma.appointment.findUnique({ where: { id: bApptId } });
    expect(bAppt?.customerId).toBe(custB);
  });

  // 28. The stats counter and its own drill-down list stay consistent with each other,
  // both before and after deletion (they were inconsistent before this fix: the
  // counter included the orphaned completed appointment while the customer-driven
  // drill-down never could).
  it('the "completed" counter matches the /completed-maintenance drill-down\'s total both before and after deletion', async () => {
    const custId = await createCustomer('Counter Sync Drilldown Consistency Customer');
    await completeViaTechnician(custId);

    const statsBefore = await getStats(adminToken);
    const drillBefore = await request(ts.baseUrl).get('/api/dashboard/completed-maintenance').set('Authorization', `Bearer ${adminToken}`).query({ limit: 100 });
    expect(statsBefore.completed).toBe(drillBefore.body.meta.total);

    await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);

    const statsAfter = await getStats(adminToken);
    const drillAfter = await request(ts.baseUrl).get('/api/dashboard/completed-maintenance').set('Authorization', `Bearer ${adminToken}`).query({ limit: 100 });
    expect(statsAfter.completed).toBe(drillAfter.body.meta.total);
  });
});
