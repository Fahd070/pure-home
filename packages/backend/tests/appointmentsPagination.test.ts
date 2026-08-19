// Perf fix: GET /appointments was previously fully unbounded (no `limit`/
// `skip` of any kind). This file proves the new page/limit pagination
// (default 20/page, max 100, response meta { page, limit, total, totalPages })
// while every pre-existing filter, role-based visibility rule, and the
// scheduledDate-desc ordering all continue to behave exactly as before.
//
// Isolation strategy: every fixture group lives in its own far-future block,
// spaced 1000 hours apart, and every assertion query bounds BOTH `from` and
// `to` tightly around exactly the block it needs -- no query relies on an
// open-ended `from` with no upper bound, since that previously let one
// fixture group's rows leak into another group's "expected total" (an
// unbounded `from` window will match literally everything scheduled after
// it, including a different fixture group's own far-future rows). Blocks are
// far enough out (5000h+) that no other test file's near-term (1-5 day)
// appointments could ever land in any of them either.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

const GENERAL_COUNT = 25;

function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 3600000).toISOString();
}

// General block: 25 plain appointments at offsets 5000..5024.
const GENERAL_BASE = 5000;
const GENERAL_FROM = hoursFromNow(GENERAL_BASE - 1);
const GENERAL_TO = hoursFromNow(GENERAL_BASE + GENERAL_COUNT - 0.5); // just past offset 5024, strictly before any other block

// Each of these lives in its own isolated block, far from GENERAL and from
// each other -- so a query scoped to one block's from/to can never include
// another block's rows.
const HIDDEN_BASE = 6000;
const TECH_BASE = 7000;
const URGENT_BASE = 8000;

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
    // with distinct increasing scheduledDate values -- the baseline dataset
    // for pagination/ordering tests.
    const generalCreates = Array.from({ length: GENERAL_COUNT }, (_, i) =>
      request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          type: 'MAINTENANCE',
          scheduledDate: hoursFromNow(GENERAL_BASE + i),
          visibleToScheduling: true,
        })
    );
    const generalResults = await Promise.all(generalCreates);
    generalIds = generalResults.map(r => r.body.data.id);
    createdAppointmentIds.push(...generalIds);

    // Isolated block: one appointment hidden from SCHEDULING.
    const hiddenRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId, type: 'MAINTENANCE',
        scheduledDate: hoursFromNow(HIDDEN_BASE),
        visibleToScheduling: false,
      });
    hiddenFromSchedulingId = hiddenRes.body.data.id;
    createdAppointmentIds.push(hiddenFromSchedulingId);

    // Isolated block: two appointments, each assigned to a different technician.
    const tech1Res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: hoursFromNow(TECH_BASE), technicianId: users.technician.id });
    tech1OwnId = tech1Res.body.data.id;
    createdAppointmentIds.push(tech1OwnId);

    const tech2Res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: hoursFromNow(TECH_BASE + 1), technicianId: users.technician2.id });
    tech2OwnId = tech2Res.body.data.id;
    createdAppointmentIds.push(tech2OwnId);

    // Isolated block: two urgent appointments; one is later flipped to
    // visibleToTechnician=false to prove ADMIN/TECHNICIAN urgent visibility
    // stays exactly as before.
    const urgent1Res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'MAINTENANCE', isUrgent: true, scheduledDate: hoursFromNow(URGENT_BASE),
        urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'Olaya', street: 'King Fahd Rd' }),
        customerName: 'Pagination Urgent Customer', customerPhone: testPhone(),
      });
    urgentVisibleId = urgent1Res.body.data.id;
    createdAppointmentIds.push(urgentVisibleId);
    if (urgent1Res.body.data.customerId) createdCustomerIds.push(urgent1Res.body.data.customerId);

    const urgent2Res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'MAINTENANCE', isUrgent: true, scheduledDate: hoursFromNow(URGENT_BASE + 1),
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
  // Every "general block only" query bounds both ends tightly, so it can
  // never see the hidden/tech/urgent blocks (each 1000h+ away).
  function getGeneral(token: string, extraParams: Record<string, any> = {}) {
    return get(token, { from: GENERAL_FROM, to: GENERAL_TO, ...extraParams });
  }

  it('1/6. default pagination: page 1 of 20, correct total/totalPages, isolated to this test\'s 25 rows', async () => {
    const res = await getGeneral(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(20);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: GENERAL_COUNT, totalPages: 2 });
  });

  it('2. page=2 returns the remaining rows, no overlap with page 1, full coverage of all 25', async () => {
    const page1 = await getGeneral(adminToken, { page: 1 });
    const page2 = await getGeneral(adminToken, { page: 2 });
    expect(page2.status).toBe(200);
    expect(page2.body.data.length).toBe(5);
    expect(page2.body.meta.page).toBe(2);

    const page1Ids = page1.body.data.map((a: any) => a.id);
    const page2Ids = page2.body.data.map((a: any) => a.id);
    expect(page1Ids.filter((id: string) => page2Ids.includes(id))).toHaveLength(0);
    expect(new Set([...page1Ids, ...page2Ids])).toEqual(new Set(generalIds));
  });

  it('3. limit is respected', async () => {
    const res = await getGeneral(adminToken, { limit: 5 });
    expect(res.body.data.length).toBe(5);
    expect(res.body.meta).toMatchObject({ limit: 5, total: GENERAL_COUNT, totalPages: 5 });
  });

  it('4. limit > 100 is clamped to 100 (documented policy), not rejected', async () => {
    const res = await getGeneral(adminToken, { limit: 500 });
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
      const res = await getGeneral(adminToken, params);
      expect(res.status, `params=${JSON.stringify(params)}`).toBe(400);
      expect(res.body.success).toBe(false);
    }
  });

  it('6. totalPages is exactly ceil(total/limit) for a non-round split', async () => {
    const res = await getGeneral(adminToken, { limit: 7 });
    expect(res.body.meta).toMatchObject({ limit: 7, total: GENERAL_COUNT, totalPages: 4 });
  });

  it('7. filters (status + from/to) combine correctly with pagination', async () => {
    const res = await getGeneral(adminToken, { status: 'CANCELLED', limit: 20 });
    expect(res.body.meta.total).toBe(5);
    expect(res.body.data.length).toBe(5);
    expect(res.body.data.every((a: any) => a.status === 'CANCELLED')).toBe(true);
    expect(new Set(res.body.data.map((a: any) => a.id))).toEqual(new Set(cancelledIds));
  });

  it('8. ADMIN visibility unchanged: sees every one of the 25 general appointments, exactly', async () => {
    const res = await getGeneral(adminToken, { limit: 100 });
    expect(new Set(res.body.data.map((a: any) => a.id))).toEqual(new Set(generalIds));
  });

  it('9. SCHEDULING visibility unchanged: a visibleToScheduling=false appointment is excluded', async () => {
    const hiddenFrom = hoursFromNow(HIDDEN_BASE - 1);
    const hiddenTo = hoursFromNow(HIDDEN_BASE + 1);

    const asAdmin = await get(adminToken, { from: hiddenFrom, to: hiddenTo });
    expect(asAdmin.body.meta.total).toBe(1); // Admin can see it -- proves the fixture exists and is isolated
    expect(asAdmin.body.data[0].id).toBe(hiddenFromSchedulingId);

    const asSched = await get(schedToken, { from: hiddenFrom, to: hiddenTo });
    expect(asSched.body.meta.total).toBe(0); // Scheduling cannot
  });

  it('10. TECHNICIAN visibility/assignment unchanged: own job visible, another technician\'s assigned job is not', async () => {
    const techFrom = hoursFromNow(TECH_BASE - 1);
    const techTo = hoursFromNow(TECH_BASE + 1.5);

    const tech1Res = await get(tech1Token, { from: techFrom, to: techTo });
    const tech1Ids = tech1Res.body.data.map((a: any) => a.id);
    expect(tech1Res.body.meta.total).toBe(1); // only technician1's own job in this block
    expect(tech1Ids).toContain(tech1OwnId);
    expect(tech1Ids).not.toContain(tech2OwnId);

    const tech2Res = await get(tech2Token, { from: techFrom, to: techTo });
    const tech2Ids = tech2Res.body.data.map((a: any) => a.id);
    expect(tech2Res.body.meta.total).toBe(1);
    expect(tech2Ids).toContain(tech2OwnId);
    expect(tech2Ids).not.toContain(tech1OwnId);
  });

  it('11. urgent=true behavior unchanged: ADMIN sees all urgent regardless of visibleToTechnician; TECHNICIAN only visibleToTechnician ones', async () => {
    const urgentFrom = hoursFromNow(URGENT_BASE - 1);
    const urgentTo = hoursFromNow(URGENT_BASE + 1.5);

    const adminUrgent = await get(adminToken, { from: urgentFrom, to: urgentTo, urgent: 'true' });
    const adminUrgentIds = adminUrgent.body.data.map((a: any) => a.id);
    expect(adminUrgent.body.meta.total).toBe(2);
    expect(adminUrgentIds).toEqual(expect.arrayContaining([urgentVisibleId, urgentHiddenFromTechId]));

    const techUrgent = await get(tech1Token, { from: urgentFrom, to: urgentTo, urgent: 'true' });
    const techUrgentIds = techUrgent.body.data.map((a: any) => a.id);
    expect(techUrgent.body.meta.total).toBe(1);
    expect(techUrgentIds).toContain(urgentVisibleId);
    expect(techUrgentIds).not.toContain(urgentHiddenFromTechId);
  });

  it('12. workStatus filtering unchanged (single value and comma-list) combined with pagination', async () => {
    const single = await getGeneral(adminToken, { workStatus: 'WAITING', limit: 100 });
    expect(single.body.meta.total).toBe(GENERAL_COUNT); // none of the general 25 were started/completed

    const list = await getGeneral(adminToken, { workStatus: 'WAITING,IN_PROGRESS', limit: 100 });
    expect(list.body.meta.total).toBe(GENERAL_COUNT);
  });

  it('13. ordering remains scheduledDate desc across pages', async () => {
    const page1 = await getGeneral(adminToken, { page: 1 });
    const page2 = await getGeneral(adminToken, { page: 2 });
    const combined = [...page1.body.data, ...page2.body.data].map((a: any) => new Date(a.scheduledDate).getTime());
    for (let i = 1; i < combined.length; i++) {
      expect(combined[i - 1]).toBeGreaterThanOrEqual(combined[i]);
    }
    // The very first row overall must be the latest-scheduled of the 25
    // (index 24 was created with the largest offset).
    expect(page1.body.data[0].id).toBe(generalIds[GENERAL_COUNT - 1]);
  });
});
