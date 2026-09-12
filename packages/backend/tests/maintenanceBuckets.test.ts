// v4 Requirement #4/#5: maintenance due buckets and priority, and the dashboard
// surfaces built on them.
//
// The pure block below needs no database: the classification is a function of a
// stored date and a clock reading, and that is exactly what makes the boundary
// cases (today, yesterday, month end, December, leap day) cheap to pin down.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers, testPhone, uniqueSuffix } from './helpers/fixtures';
import prisma from '../src/prisma';
import {
  getMaintenanceBucket,
  maintenanceBucketBoundaries,
  getMaintenancePriority,
  describeMaintenanceDue,
  DUE_SOON_DAYS,
} from '../src/services/maintenanceSchedule.service';
import { getMaintenanceBucketWheres } from '../src/services/dashboardCategorization.service';

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('Maintenance buckets — pure domain', () => {
  // Mid-month so "this month" has room on both sides of today.
  const now = new Date('2026-09-12T09:30:00.000Z');

  it('classifies a date before today as OVERDUE, never as THIS_MONTH', () => {
    // 1 September is in the current calendar month AND in the past. Overdue has
    // to win, or a customer who is a week late reads as "due this month".
    expect(getMaintenanceBucket(utc('2026-09-01'), now)).toBe('OVERDUE');
    expect(getMaintenanceBucket(utc('2026-09-11'), now)).toBe('OVERDUE');
  });

  it('treats today itself as THIS_MONTH, not overdue', () => {
    expect(getMaintenanceBucket(utc('2026-09-12'), now)).toBe('THIS_MONTH');
  });

  it('is unaffected by a time-of-day component on the due date', () => {
    // Due dates inherit the time of whatever baseline produced them, so a
    // due-today date can carry any time. It must still read as due today.
    expect(getMaintenanceBucket(new Date('2026-09-12T23:59:59.000Z'), now)).toBe('THIS_MONTH');
    expect(getMaintenanceBucket(new Date('2026-09-11T23:59:59.000Z'), now)).toBe('OVERDUE');
  });

  it('classifies the rest of the current month, next month and beyond', () => {
    expect(getMaintenanceBucket(utc('2026-09-30'), now)).toBe('THIS_MONTH');
    expect(getMaintenanceBucket(utc('2026-10-01'), now)).toBe('NEXT_MONTH');
    expect(getMaintenanceBucket(utc('2026-10-31'), now)).toBe('NEXT_MONTH');
    expect(getMaintenanceBucket(utc('2026-11-01'), now)).toBe('FUTURE');
  });

  it('returns UNKNOWN for a null due date — never OVERDUE', () => {
    // The whole point of the nullable column: "we cannot compute a date" must
    // not be rendered as "this customer is late".
    expect(getMaintenanceBucket(null, now)).toBe('UNKNOWN');
    expect(getMaintenanceBucket(undefined, now)).toBe('UNKNOWN');
  });

  it('rolls December into January rather than month 12', () => {
    const december = new Date('2026-12-20T09:00:00.000Z');
    expect(getMaintenanceBucket(utc('2026-12-31'), december)).toBe('THIS_MONTH');
    expect(getMaintenanceBucket(utc('2027-01-01'), december)).toBe('NEXT_MONTH');
    expect(getMaintenanceBucket(utc('2027-01-31'), december)).toBe('NEXT_MONTH');
    expect(getMaintenanceBucket(utc('2027-02-01'), december)).toBe('FUTURE');

    const b = maintenanceBucketBoundaries(december);
    expect(b.startOfNextMonth.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(b.startOfFollowingMonth.toISOString()).toBe('2027-02-01T00:00:00.000Z');
  });

  it('handles a leap-day boundary', () => {
    const feb = new Date('2028-02-20T09:00:00.000Z');
    expect(getMaintenanceBucket(utc('2028-02-29'), feb)).toBe('THIS_MONTH');
    expect(getMaintenanceBucket(utc('2028-03-01'), feb)).toBe('NEXT_MONTH');
    expect(maintenanceBucketBoundaries(feb).startOfNextMonth.toISOString()).toBe('2028-03-01T00:00:00.000Z');
  });

  it('keeps the SQL boundaries and the in-memory classification in agreement', () => {
    // The counters run as SQL comparisons against the raw stored timestamp while
    // the row classification floors to the UTC day. They are only equivalent
    // because every boundary is a midnight; this asserts that rather than
    // assuming it.
    const wheres = getMaintenanceBucketWheres(now);
    const { startOfToday, startOfNextMonth, startOfFollowingMonth } = maintenanceBucketBoundaries(now);
    expect((wheres.OVERDUE.nextMaintenanceDueAt as any).lt).toEqual(startOfToday);
    expect((wheres.THIS_MONTH.nextMaintenanceDueAt as any).gte).toEqual(startOfToday);
    expect((wheres.THIS_MONTH.nextMaintenanceDueAt as any).lt).toEqual(startOfNextMonth);
    expect((wheres.NEXT_MONTH.nextMaintenanceDueAt as any).gte).toEqual(startOfNextMonth);
    expect((wheres.NEXT_MONTH.nextMaintenanceDueAt as any).lt).toEqual(startOfFollowingMonth);
    expect((wheres.FUTURE.nextMaintenanceDueAt as any).gte).toEqual(startOfFollowingMonth);
    expect(wheres.UNKNOWN.nextMaintenanceDueAt).toBeNull();

    // Every candidate date must land in exactly one bucket under both readings.
    const candidates = [
      '2026-08-31', '2026-09-01', '2026-09-11', '2026-09-12', '2026-09-13',
      '2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01', '2027-01-01',
    ].map(utc);
    for (const d of candidates) {
      const bucket = getMaintenanceBucket(d, now);
      const matches = (['OVERDUE', 'THIS_MONTH', 'NEXT_MONTH', 'FUTURE'] as const).filter((b) => {
        const f = wheres[b].nextMaintenanceDueAt as any;
        return (f.lt === undefined || d < f.lt) && (f.gte === undefined || d >= f.gte);
      });
      expect(matches).toEqual([bucket]);
    }
  });
});

describe('Maintenance priority — the Requirement #5 thresholds', () => {
  const now = new Date('2026-09-12T09:30:00.000Z');

  it('uses the approved 10-day window, unchanged', () => {
    expect(DUE_SOON_DAYS).toBe(10);
  });

  it('treats exactly 10 days as approaching and 11 days as normal', () => {
    expect(getMaintenancePriority(utc('2026-09-22'), now)).toBe('DUE_SOON');
    expect(getMaintenancePriority(utc('2026-09-23'), now)).toBe('NORMAL');
  });

  it('treats today as approaching and yesterday as overdue', () => {
    expect(getMaintenancePriority(utc('2026-09-12'), now)).toBe('DUE_SOON');
    expect(getMaintenancePriority(utc('2026-09-11'), now)).toBe('OVERDUE');
  });

  it('never produces a negative "days remaining" for the UI to render', () => {
    // The Requirement #5 defect was a label reading "متبقي -742 يوم". The server
    // hands the UI a positive magnitude for the overdue case, so the UI has no
    // number to negate.
    const late = describeMaintenanceDue(utc('2024-09-01'), now);
    expect(late.maintenancePriority).toBe('OVERDUE');
    expect(late.daysUntilMaintenance).toBeLessThan(0);
    expect(late.daysOverdue).toBe(Math.abs(late.daysUntilMaintenance!));
    expect(late.daysOverdue).toBeGreaterThan(0);

    const soon = describeMaintenanceDue(utc('2026-12-03'), now);
    expect(soon.daysOverdue).toBeNull();
    expect(soon.daysUntilMaintenance).toBe(82);
  });

  it('reports UNKNOWN with no day count at all for a missing date', () => {
    expect(describeMaintenanceDue(null, now)).toEqual({
      maintenancePriority: 'UNKNOWN', daysUntilMaintenance: null, daysOverdue: null,
    });
  });
});

describe('Maintenance dashboard surfaces', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string;
  let schedToken: string;
  const tag = `bucket-${uniqueSuffix()}`;
  const createdCustomerIds: string[] = [];

  // Dates chosen relative to the real clock so the test does not rot: the
  // classification is being exercised, not a frozen calendar.
  const daysFromNow = (n: number) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
  };

  async function makeCustomer(name: string, dueAt: Date | null) {
    const c = await prisma.customer.create({
      data: {
        name: `${tag}-${name}`,
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 6,
        // Written directly: this block is testing how a stored due date is
        // CLASSIFIED, which is a different question from how it is derived (that
        // is maintenanceDueEngine.test.ts's job).
        nextMaintenanceDueAt: dueAt,
      },
    });
    createdCustomerIds.push(c.id);
    return c;
  }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');

    await makeCustomer('very-overdue', daysFromNow(-400));
    await makeCustomer('overdue', daysFromNow(-3));
    await makeCustomer('unknown', null);
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await stopTestServer(ts.server);
  });

  it('counts customers, not appointments — a due customer with no appointment is counted', async () => {
    // None of the fixtures above has a single appointment. Under the previous
    // appointment-derived counters every one of them was invisible.
    const res = await request(ts.baseUrl).get('/api/dashboard/stats').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.maintenanceOverdue).toBeGreaterThanOrEqual(2);
    expect(typeof res.body.data.maintenanceThisMonth).toBe('number');
    expect(typeof res.body.data.maintenanceNextMonth).toBe('number');
    expect(res.body.data.maintenanceUnknown).toBeGreaterThanOrEqual(1);
    // The appointment-derived keys Desktop v3.6.5 reads are still present.
    for (const legacy of ['thisMonth', 'nextMonth', 'pendingApproval', 'todayCount']) {
      expect(res.body.data).toHaveProperty(legacy);
    }
  });

  it('lists overdue customers with no appointment, most overdue first', async () => {
    const res = await request(ts.baseUrl)
      .get('/api/dashboard/maintenance-overdue')
      .query({ search: tag, limit: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const names = res.body.data.map((c: any) => c.name);
    expect(names).toEqual([`${tag}-very-overdue`, `${tag}-overdue`]);
    // The derived trio travels with every row, so the UI never recomputes it.
    expect(res.body.data[0].maintenancePriority).toBe('OVERDUE');
    expect(res.body.data[0].daysOverdue).toBeGreaterThan(300);
    expect(res.body.meta.totalPages).toBe(1);
  });

  it('keeps a null due date out of the overdue bucket and in UNKNOWN', async () => {
    const overdue = await request(ts.baseUrl)
      .get('/api/dashboard/maintenance-overdue').query({ search: tag, limit: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(overdue.body.data.some((c: any) => c.name === `${tag}-unknown`)).toBe(false);

    const unknown = await request(ts.baseUrl)
      .get('/api/dashboard/maintenance-unknown').query({ search: tag, limit: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(unknown.body.data.map((c: any) => c.name)).toEqual([`${tag}-unknown`]);
    expect(unknown.body.data[0].maintenancePriority).toBe('UNKNOWN');
  });

  it('moves a customer between buckets as soon as their due date is recalculated', async () => {
    const c = await makeCustomer('moves', daysFromNow(-30));
    const before = await request(ts.baseUrl)
      .get('/api/dashboard/maintenance-overdue').query({ search: `${tag}-moves`, limit: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(before.body.data).toHaveLength(1);

    // Exactly what a completion does: rewrite the stored due date.
    await prisma.customer.update({ where: { id: c.id }, data: { nextMaintenanceDueAt: daysFromNow(40) } });

    const after = await request(ts.baseUrl)
      .get('/api/dashboard/maintenance-overdue').query({ search: `${tag}-moves`, limit: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.body.data).toHaveLength(0);
  });

  it('is reachable by Scheduling and still applies the hidden-customer gate', async () => {
    const res = await request(ts.baseUrl)
      .get('/api/dashboard/maintenance-overdue').query({ search: tag, limit: 50 })
      .set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);

    // An admin-created, urgent-only, unapproved customer is private to
    // Administration -- including here.
    const hidden = await prisma.customer.create({
      data: {
        name: `${tag}-hidden`, phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 6,
        nextMaintenanceDueAt: daysFromNow(-10), createdById: users.admin.id,
        appointments: {
          create: {
            type: 'MAINTENANCE', scheduledDate: new Date(), isUrgent: true,
            visibleToScheduling: false, createdByRole: 'ADMIN',
          },
        },
      },
    });
    createdCustomerIds.push(hidden.id);

    const asAdmin = await request(ts.baseUrl)
      .get('/api/dashboard/maintenance-overdue').query({ search: `${tag}-hidden`, limit: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(asAdmin.body.data.map((c: any) => c.name)).toEqual([`${tag}-hidden`]);

    const asScheduling = await request(ts.baseUrl)
      .get('/api/dashboard/maintenance-overdue').query({ search: `${tag}-hidden`, limit: 50 })
      .set('Authorization', `Bearer ${schedToken}`);
    expect(asScheduling.body.data).toHaveLength(0);

    await prisma.appointment.deleteMany({ where: { customerId: hidden.id } });
  });

  it('refuses the maintenance drill-downs to a technician', async () => {
    const techToken = signTestToken(users.technician.id, 'TECHNICIAN');
    const res = await request(ts.baseUrl)
      .get('/api/dashboard/maintenance-overdue')
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(403);
  });
});
