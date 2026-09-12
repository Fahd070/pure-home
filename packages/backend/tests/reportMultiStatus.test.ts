// v4 Requirement #10B/#10C: reports filter on SEVERAL statuses at once, reject a
// status that is not real, and never become a way around the visibility rules
// that govern the screens they are generated from.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers, testPhone, uniqueSuffix } from './helpers/fixtures';
import prisma from '../src/prisma';
import {
  APPOINTMENT_REPORT_STATUSES,
  CUSTOMER_REPORT_STATUSES,
  parseReportStatuses,
} from '../src/services/reportStatus.service';

describe('Report status vocabulary — pure', () => {
  it('treats omitted, empty and ALL as "no filter", never as "match nothing"', () => {
    for (const raw of [undefined, null, '', ',,', 'ALL']) {
      expect(parseReportStatuses(raw, APPOINTMENT_REPORT_STATUSES)).toEqual({ ok: true, statuses: null });
    }
  });

  it('accepts comma-separated and repeated parameters, de-duplicated', () => {
    expect(parseReportStatuses('COMPLETED,POSTPONED', APPOINTMENT_REPORT_STATUSES))
      .toEqual({ ok: true, statuses: ['COMPLETED', 'POSTPONED'] });
    expect(parseReportStatuses(['COMPLETED', 'POSTPONED'], APPOINTMENT_REPORT_STATUSES))
      .toEqual({ ok: true, statuses: ['COMPLETED', 'POSTPONED'] });
    expect(parseReportStatuses('COMPLETED,COMPLETED', APPOINTMENT_REPORT_STATUSES))
      .toEqual({ ok: true, statuses: ['COMPLETED'] });
  });

  it('rejects an unknown status instead of ignoring it', () => {
    // Silently dropping it would widen the report to everything while still
    // looking like a filtered report.
    expect(parseReportStatuses('COMPLETED,NOT_A_STATUS', APPOINTMENT_REPORT_STATUSES))
      .toEqual({ ok: false, invalid: ['NOT_A_STATUS'] });
    // The two vocabularies are genuinely different: OVERDUE is a customer-report
    // concept and is not an appointment status.
    expect(parseReportStatuses('OVERDUE', APPOINTMENT_REPORT_STATUSES).ok).toBe(false);
    expect(parseReportStatuses('OVERDUE', CUSTOMER_REPORT_STATUSES).ok).toBe(true);
  });
});

describe('Appointment report — multi-status filtering', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string;
  let schedToken: string;
  const tag = `rep-${uniqueSuffix()}`;
  const customerIds: string[] = [];
  const apptIds: string[] = [];

  async function makeAppt(name: string, data: any) {
    const customer = await prisma.customer.create({
      data: { name: `${tag}-${name}`, phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 6 },
    });
    customerIds.push(customer.id);
    const appt = await prisma.appointment.create({
      data: {
        customerId: customer.id, type: 'MAINTENANCE', scheduledDate: new Date('2026-06-15T09:00:00Z'),
        isUrgent: false, ...data,
      },
    });
    apptIds.push(appt.id);
    return appt;
  }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');

    await makeAppt('done', { status: 'SCHEDULED', workStatus: 'COMPLETED' });
    await makeAppt('postponed', { status: 'SCHEDULED', workStatus: 'POSTPONED' });
    await makeAppt('rescheduled', { status: 'RESCHEDULED', workStatus: 'WAITING' });
    await makeAppt('scheduled', { status: 'SCHEDULED', workStatus: 'WAITING' });
    await makeAppt('cancelled', { status: 'CANCELLED', workStatus: 'WAITING' });
    // The overlap case: rescheduled AND since completed. It displays as
    // COMPLETED, so COMPLETED must find it and RESCHEDULED must not.
    await makeAppt('resched-then-done', { status: 'RESCHEDULED', workStatus: 'COMPLETED' });
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { id: { in: apptIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await stopTestServer(ts.server);
  });

  const names = (body: any) =>
    body.data.filter((a: any) => a.customer?.name?.startsWith(tag)).map((a: any) => a.customer.name).sort();

  const fetchAppts = (token: string, reportStatus?: string) =>
    request(ts.baseUrl).get('/api/appointments')
      .query({ limit: 100, ...(reportStatus ? { reportStatus } : {}) })
      .set('Authorization', `Bearer ${token}`);

  it('filters on a single selected status', async () => {
    const res = await fetchAppts(adminToken, 'POSTPONED');
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual([`${tag}-postponed`]);
  });

  it('filters on two selected statuses', async () => {
    const res = await fetchAppts(adminToken, 'COMPLETED,POSTPONED');
    expect(names(res.body)).toEqual([`${tag}-done`, `${tag}-postponed`, `${tag}-resched-then-done`].sort());
  });

  it('filters on three selected statuses, including RESCHEDULED', async () => {
    const res = await fetchAppts(adminToken, 'COMPLETED,POSTPONED,RESCHEDULED');
    expect(names(res.body)).toEqual(
      [`${tag}-done`, `${tag}-postponed`, `${tag}-rescheduled`, `${tag}-resched-then-done`].sort()
    );
  });

  it('never double-counts a row that satisfies two raw columns', async () => {
    // The rescheduled-then-completed appointment is reported as COMPLETED only.
    const completed = await fetchAppts(adminToken, 'COMPLETED');
    expect(names(completed.body)).toContain(`${tag}-resched-then-done`);
    const rescheduled = await fetchAppts(adminToken, 'RESCHEDULED');
    expect(names(rescheduled.body)).not.toContain(`${tag}-resched-then-done`);

    const both = await fetchAppts(adminToken, 'COMPLETED,RESCHEDULED');
    const ids = both.body.data.filter((a: any) => a.customer?.name?.startsWith(tag)).map((a: any) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns every status when none is selected, preserving the previous meaning', async () => {
    const none = await fetchAppts(adminToken);
    expect(names(none.body)).toHaveLength(6);
  });

  it('rejects an invalid status with 400 rather than a 500 or a silent full result', async () => {
    const res = await fetchAppts(adminToken, 'COMPLETED,NONSENSE');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('NONSENSE');

    // The pre-existing single-value `status` parameter is validated too; it used
    // to reach Prisma's enum coercion and surface as an opaque 500.
    const legacy = await request(ts.baseUrl).get('/api/appointments')
      .query({ status: 'NOT_AN_ENUM' }).set('Authorization', `Bearer ${adminToken}`);
    expect(legacy.status).toBe(400);
  });

  it('does not let the report bypass Scheduling appointment visibility', async () => {
    const hidden = await makeAppt('hidden-appt', {
      status: 'SCHEDULED', workStatus: 'COMPLETED', visibleToScheduling: false, createdByRole: 'ADMIN',
    });
    expect(hidden).toBeTruthy();

    const admin = await fetchAppts(adminToken, 'COMPLETED');
    expect(names(admin.body)).toContain(`${tag}-hidden-appt`);

    const sched = await fetchAppts(schedToken, 'COMPLETED');
    expect(names(sched.body)).not.toContain(`${tag}-hidden-appt`);

    // And it is still hidden with no status filter at all, so the filter is not
    // the thing doing the hiding.
    const schedAll = await fetchAppts(schedToken);
    expect(names(schedAll.body)).not.toContain(`${tag}-hidden-appt`);
  });
});

describe('Customer report — multi-status filtering', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string;
  let schedToken: string;
  const tag = `crep-${uniqueSuffix()}`;
  const customerIds: string[] = [];

  async function makeCustomer(name: string, appt: any | null) {
    const c = await prisma.customer.create({
      data: {
        name: `${tag}-${name}`, phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 6,
        ...(appt
          ? { appointments: { create: { type: 'MAINTENANCE', scheduledDate: new Date('2026-06-15T09:00:00Z'), isUrgent: false, ...appt } } }
          : {}),
      },
    });
    customerIds.push(c.id);
    return c;
  }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');

    await makeCustomer('completed', { status: 'SCHEDULED', workStatus: 'COMPLETED' });
    await makeCustomer('postponed', { status: 'SCHEDULED', workStatus: 'POSTPONED' });
    await makeCustomer('cancelled', { status: 'CANCELLED', workStatus: 'WAITING' });
    await makeCustomer('none', null);
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await stopTestServer(ts.server);
  });

  const report = (token: string, status?: string) =>
    request(ts.baseUrl).get('/api/reports/customers')
      .query({ search: tag, limit: 200, ...(status ? { status } : {}) })
      .set('Authorization', `Bearer ${token}`);

  const names = (body: any) => body.data.map((c: any) => c.name).sort();

  it('matches the single-status behaviour it replaced', async () => {
    expect(names((await report(adminToken, 'COMPLETED')).body)).toEqual([`${tag}-completed`]);
    expect(names((await report(adminToken, 'POSTPONED')).body)).toEqual([`${tag}-postponed`]);
  });

  it('supports the approved Completed + Postponed combination', async () => {
    const res = await report(adminToken, 'COMPLETED,POSTPONED');
    expect(names(res.body)).toEqual([`${tag}-completed`, `${tag}-postponed`].sort());
    expect(res.body.meta.total).toBe(2);
  });

  it('keeps ALL and an omitted status meaning every customer', async () => {
    expect(names((await report(adminToken)).body)).toHaveLength(4);
    expect(names((await report(adminToken, 'ALL')).body)).toHaveLength(4);
  });

  it('rejects an invalid status', async () => {
    const res = await report(adminToken, 'COMPLETED,MADE_UP');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('MADE_UP');
  });

  it('does not let the customer report bypass the hidden-customer rule', async () => {
    const hidden = await prisma.customer.create({
      data: {
        name: `${tag}-hidden-cust`, phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 6,
        createdById: users.admin.id,
        appointments: {
          create: {
            type: 'MAINTENANCE', scheduledDate: new Date('2026-06-15T09:00:00Z'), isUrgent: true,
            workStatus: 'COMPLETED', visibleToScheduling: false, createdByRole: 'ADMIN',
          },
        },
      },
    });
    customerIds.push(hidden.id);

    expect(names((await report(adminToken, 'COMPLETED')).body)).toContain(`${tag}-hidden-cust`);
    expect(names((await report(schedToken, 'COMPLETED')).body)).not.toContain(`${tag}-hidden-cust`);
    expect(names((await report(schedToken, 'COMPLETED,POSTPONED')).body)).not.toContain(`${tag}-hidden-cust`);
    expect(names((await report(schedToken)).body)).not.toContain(`${tag}-hidden-cust`);
  });

  it('withholds financial totals from a Scheduling report', async () => {
    const sched = await report(schedToken, 'COMPLETED');
    for (const row of sched.body.data) expect(row).not.toHaveProperty('totalAmount');
    const admin = await report(adminToken, 'COMPLETED');
    expect(admin.body.data[0]).toHaveProperty('totalAmount');
  });
});

describe('Sales report — no server-side cooldown was removed along with the client one', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string;

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
  });
  afterAll(async () => { await stopTestServer(ts.server); });

  it('serves the same period repeatedly with no throttle', async () => {
    // v4 Requirement #10A removed a browser-side lock. This confirms the endpoint
    // itself never had one to remove, so nothing real was bypassed.
    for (let i = 0; i < 4; i++) {
      const res = await request(ts.baseUrl).get('/api/reports/sales')
        .query({ from: '2026-01-01', to: '2026-01-31' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }
  });

  it('keeps two different periods independent of each other', async () => {
    // The removed lock stored one timestamp per period but was read with a key
    // that did not include the format, so generating a weekly PDF locked the
    // weekly Excel. Different requests must simply be different requests.
    const weekly = await request(ts.baseUrl).get('/api/reports/sales')
      .query({ from: '2026-01-01', to: '2026-01-07' }).set('Authorization', `Bearer ${adminToken}`);
    const monthly = await request(ts.baseUrl).get('/api/reports/sales')
      .query({ from: '2026-02-01', to: '2026-02-28' }).set('Authorization', `Bearer ${adminToken}`);
    expect(weekly.status).toBe(200);
    expect(monthly.status).toBe(200);
  });

  it('stays ADMIN-only', async () => {
    const schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    const res = await request(ts.baseUrl).get('/api/reports/sales')
      .query({ from: '2026-01-01', to: '2026-01-31' }).set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(403);
  });
});
