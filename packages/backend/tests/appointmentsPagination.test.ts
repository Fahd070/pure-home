// Perf fix: GET /appointments was previously fully unbounded (no `limit`/
// `skip` of any kind). This file proves the new page/limit pagination
// (default 20/page, max 100, response meta { page, limit, total, totalPages })
// while every pre-existing filter, role-based visibility rule, and the
// scheduledDate-desc ordering all continue to behave exactly as before.
//
// Isolation strategy: every assertion query includes `from` scoped to a
// far-future window (BASE_HOURS below) that no other test file's
// appointments could ever land in, so counts/totals here are exact and
// unaffected by whatever else exists in the shared disposable test database
// -- this also directly exercises "filters combine correctly with
// pagination" (the `from` filter), not just an isolation trick.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

const BASE_HOURS = 5000;
const ISOLATION_FROM = new Date(Date.now() + (BASE_HOURS - 1) * 3600000).toISOString();
const GENERAL_COUNT = 25;

describe('GET /appointments pagination', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, tech1Token: string, tech2Token: string;
  let customerId: string;
  const createdAppointmentIds: string[] = [];
  const createdCustomerIds: string[] = [];

  let generalIds: string[] = [];
  let hiddenFromSchedulingId: string;
  let tech1OwnId: string;
  let tech2OwnId: string;
  let urgentVisibleId: string;
  let urgentHiddenFromTechId: string;
  let cancelledIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    tech1Token = signTestToken(users.technician.id, 'TECHNICIAN');
    tech2Token = signTestToken(users.technician2.id, 'TECHNICIAN');

    const custRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Pagination Test Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Riyadh', district: 'Test', street: 'Test' },
      });
    customerId = custRes.body.data.id;
    createdCustomerIds.push(customerId);

    // 25 plain, unassigned, non-urgent, ADMIN-visible-to-everyone appointments
    // with distinct increasing scheduledDate values, entirely within the
    // isolation window -- the baseline dataset for pagination/ordering tests.
    const generalCreates = Array.from({ length: GENERAL_COUNT }, (_, i) =>
      request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          type: 'MAINTENANCE',
          scheduledDate: new Date(Date.now() + (BASE_HOURS + i) * 3600000).toISOString(),
          visibleToScheduling: true,
        })
    );
    const generalResults = await Promise.all(generalCreates);
    generalIds = generalResults.map(r => r.body.data.id);
    createdAppointmentIds.push(...generalIds);

    // One appointment hidden from SCHEDULING (role-visibility test).
    const hiddenRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + (BASE_HOURS + 100) * 3600000).toISOString(),
        visibleToScheduling: false,
      });
    hiddenFromSchedulingId = hiddenRes.body.data.id;
    createdAppointmentIds.push(hiddenFromSchedulingId);

    // Two appointments each assigned to a different technician (TECHNICIAN
    // ownership-filtering test).
    const tech1Res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId, type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + (BASE_HOURS + 101) * 3600000).toISOString(),
        technicianId: users.technician.id,
      });
    tech1OwnId = tech1Res.body.data.id;
    createdAppointmentIds.push(tech1OwnId);

    const tech2Res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId, type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + (BASE_HOURS + 102) * 3600000).toISOString(),
        technicianId: users.technician2.id,
      });
    tech2OwnId = tech2Res.body.data.id;
    createdAppointmentIds.push(tech2OwnId);

    // Two urgent appointments (urgent=true filtering test); one is later
    // flipped to visibleToTechnician=false to prove ADMIN/TECHNICIAN urgent
    // visibility stays exactly as before.
    const urgent1Res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'MAINTENANCE', isUrgent: true,
        scheduledDate: new Date(Date.now() + (BASE_HOURS + 103) * 3600000).toISOString(),
        urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'Olaya', street: 'King Fahd Rd' }),
        customerName: 'Pagination Urgent Customer', customerPhone: testPhone(),
      });
    urgentVisibleId = urgent1Res.body.data.id;
    createdAppointmentIds.push(urgentVisibleId);
    if (urgent1Res.body.data.customerId) createdCustomerIds.push(urgent1Res.body.data.customerId);

    const urgent2Res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'MAINTENANCE', isUrgent: true,
        scheduledDate: new Date(Date.now() + (BASE_HOURS + 104) * 3600000).toISOString(),
        urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'Olaya', street: 'King Fahd Rd' }),
        customerName: 'Pagination Urgent Customer 2', customerPhone: testPhone(),
      });
    urgentHiddenFromTechId = urgent2Res.body.data.id;
    createdAppointmentIds.push(urgentHiddenFromTechId);
    if (urgent2Res.body.data.customerId) createdCustomerIds.push(urgent2Res.body.data.customerId);
    await prisma.appointment.update({ where: { id: urgentHiddenFromTechId }, data: { visibleToTechnician: false } });

    // Cancel 5 of the general appointments (status-filter + pagination test).
    cancelledIds = generalIds.slice(0, 5);
    await Promise.all(cancelledIds.map(id =>
      request(ts.baseUrl).patch(`/api/appointments/${id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CANCELLED' })
    ));
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) {
      await prisma.urgentVisitRecord.deleteMany({ where: { appointmentId: { in: createdAppointmentIds } } });
      await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    }
    if (createdCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await stopTestServer(ts.server);
  });

  function get(token: string, params: Record<string, any>) {
    return request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${token}`).query(params);
  }

  it('1/6. default pagination: page 1 of 20, correct total/totalPages, isolated to this test\'s 25 rows', async () => {
    const res = await get(adminToken, { from: ISOLATION_FROM });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(20);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: GENERAL_COUNT, totalPages: 2 });
  });

  it('2. page=2 returns the remaining rows, no overlap with page 1, full coverage of all 25', async () => {
    const page1 = await get(adminToken, { from: ISOLATION_FROM, page: 1 });
    const page2 = await get(adminToken, { from: ISOLATION_FROM, page: 2 });
    expect(page2.status).toBe(200);
    expect(page2.body.data.length).toBe(5);
    expect(page2.body.meta.page).toBe(2);

    const page1Ids = page1.body.data.map((a: any) => a.id);
    const page2Ids = page2.body.data.map((a: any) => a.id);
    expect(page1Ids.filter((id: string) => page2Ids.includes(id))).toHaveLength(0);
    expect(new Set([...page1Ids, ...page2Ids])).toEqual(new Set(generalIds));
  });

  it('3. limit is respected', async () => {
    const res = await get(adminToken, { from: ISOLATION_FROM, limit: 5 });
    expect(res.body.data.length).toBe(5);
    expect(res.body.meta).toMatchObject({ limit: 5, total: GENERAL_COUNT, totalPages: 5 });
  });

  it('4. limit > 100 is clamped to 100 (documented policy), not rejected', async () => {
    const res = await get(adminToken, { from: ISOLATION_FROM, limit: 500 });
    expect(res.status).toBe(200);
    expect(res.body.meta.limit).toBe(100);
    expect(res.body.data.length).toBe(GENERAL_COUNT); // only 25 exist, all fit under the clamped 100
  });

  it('5. invalid page/limit values are rejected with 400, not silently coerced', async () => {
    const cases = [
      { page: 0 }, { page: -1 }, { page: 'abc' }, { page: 1.5 },
      { limit: 0 }, { limit: -5 }, { limit: 'abc' }, { limit: 2.5 },
    ];
    for (const params of cases) {
      const res = await get(adminToken, { from: ISOLATION_FROM, ...params });
      expect(res.status, `params=${JSON.stringify(params)}`).toBe(400);
      expect(res.body.success).toBe(false);
    }
  });

  it('6. totalPages is exactly ceil(total/limit) for a non-round split', async () => {
    const res = await get(adminToken, { from: ISOLATION_FROM, limit: 7 });
    expect(res.body.meta).toMatchObject({ limit: 7, total: GENERAL_COUNT, totalPages: 4 });
  });

  it('7. filters (status + from) combine correctly with pagination', async () => {
    const res = await get(adminToken, { from: ISOLATION_FROM, status: 'CANCELLED', limit: 20 });
    expect(res.body.meta.total).toBe(5);
    expect(res.body.data.length).toBe(5);
    expect(res.body.data.every((a: any) => a.status === 'CANCELLED')).toBe(true);
    expect(new Set(res.body.data.map((a: any) => a.id))).toEqual(new Set(cancelledIds));
  });

  it('8. ADMIN visibility unchanged: sees every one of the 25 general appointments', async () => {
    const res = await get(adminToken, { from: ISOLATION_FROM, limit: 100 });
    expect(new Set(res.body.data.map((a: any) => a.id))).toEqual(new Set(generalIds));
  });

  it('9. SCHEDULING visibility unchanged: the visibleToScheduling=false appointment is excluded', async () => {
    const res = await get(schedToken, { from: ISOLATION_FROM, limit: 100 });
    expect(res.body.meta.total).toBe(GENERAL_COUNT); // 25 general (visibleToScheduling true) -- hidden one excluded
    const ids = res.body.data.map((a: any) => a.id);
    expect(ids).not.toContain(hiddenFromSchedulingId);
  });

  it('10. TECHNICIAN visibility/assignment unchanged: own + unassigned only, never another technician\'s assigned job', async () => {
    const tech1Res = await get(tech1Token, { from: ISOLATION_FROM, limit: 100 });
    const tech1Ids = tech1Res.body.data.map((a: any) => a.id);
    expect(tech1Res.body.meta.total).toBe(GENERAL_COUNT + 1); // 25 unassigned + technician1's own
    expect(tech1Ids).toContain(tech1OwnId);
    expect(tech1Ids).not.toContain(tech2OwnId);

    const tech2Res = await get(tech2Token, { from: ISOLATION_FROM, limit: 100 });
    const tech2Ids = tech2Res.body.data.map((a: any) => a.id);
    expect(tech2Res.body.meta.total).toBe(GENERAL_COUNT + 1);
    expect(tech2Ids).toContain(tech2OwnId);
    expect(tech2Ids).not.toContain(tech1OwnId);
  });

  it('11. urgent=true behavior unchanged: ADMIN sees all urgent regardless of visibleToTechnician; TECHNICIAN only visibleToTechnician ones', async () => {
    const adminUrgent = await get(adminToken, { from: ISOLATION_FROM, urgent: 'true', limit: 100 });
    const adminUrgentIds = adminUrgent.body.data.map((a: any) => a.id);
    expect(adminUrgent.body.meta.total).toBe(2);
    expect(adminUrgentIds).toEqual(expect.arrayContaining([urgentVisibleId, urgentHiddenFromTechId]));

    const techUrgent = await get(tech1Token, { from: ISOLATION_FROM, urgent: 'true', limit: 100 });
    const techUrgentIds = techUrgent.body.data.map((a: any) => a.id);
    expect(techUrgent.body.meta.total).toBe(1);
    expect(techUrgentIds).toContain(urgentVisibleId);
    expect(techUrgentIds).not.toContain(urgentHiddenFromTechId);
  });

  it('12. workStatus filtering unchanged (single value and comma-list) combined with pagination', async () => {
    const single = await get(adminToken, { from: ISOLATION_FROM, workStatus: 'WAITING', limit: 100 });
    expect(single.body.meta.total).toBe(GENERAL_COUNT); // none of the general 25 were started/completed

    const list = await get(adminToken, { from: ISOLATION_FROM, workStatus: 'WAITING,IN_PROGRESS', limit: 100 });
    expect(list.body.meta.total).toBe(GENERAL_COUNT);
  });

  it('13. ordering remains scheduledDate desc across pages', async () => {
    const page1 = await get(adminToken, { from: ISOLATION_FROM, page: 1 });
    const page2 = await get(adminToken, { from: ISOLATION_FROM, page: 2 });
    const combined = [...page1.body.data, ...page2.body.data].map((a: any) => new Date(a.scheduledDate).getTime());
    for (let i = 1; i < combined.length; i++) {
      expect(combined[i - 1]).toBeGreaterThanOrEqual(combined[i]);
    }
    // The very first row overall must be the latest-scheduled of the 25
    // (index 24 was created with the largest offset).
    expect(page1.body.data[0].id).toBe(generalIds[GENERAL_COUNT - 1]);
  });
});
