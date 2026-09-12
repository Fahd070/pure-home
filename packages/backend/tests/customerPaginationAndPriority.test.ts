// v4 Requirement #5/#9: every registered customer is reachable, the maintenance
// ordering is applied by the database BEFORE the page slice, and "export all"
// means all.
//
// The >100 customer fixture is the point of this file rather than incidental
// setup: the defects being covered here only appear past the first page and past
// the endpoint's own maximum page size, which is precisely why they survived.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers, testPhone, uniqueSuffix } from './helpers/fixtures';
import prisma from '../src/prisma';

const TOTAL = 130;

describe('Customer list pagination, ordering and export', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string;
  let schedToken: string;
  const tag = `page-${uniqueSuffix()}`;
  const ids: string[] = [];

  const daysFromNow = (n: number) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
  };

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');

    // 130 customers, created oldest-name-first, all with a comfortably FUTURE due
    // date so the deliberately-overdue fixtures below are the only ones that can
    // sort to the front.
    for (let i = 0; i < TOTAL; i++) {
      const c = await prisma.customer.create({
        data: {
          name: `${tag}-bulk-${String(i).padStart(3, '0')}`,
          phone: testPhone(),
          maintenanceCycle: 'MONTHLY',
          maintenanceFrequency: 6,
          nextMaintenanceDueAt: daysFromNow(200 + i),
        },
      });
      ids.push(c.id);
    }

    // Created LAST (so it is first under the default createdAt-desc ordering is
    // not what is being relied on) but the most overdue, and named so that
    // alphabetical ordering would bury it on the final page.
    const late = await prisma.customer.create({
      data: {
        name: `${tag}-zzz-most-overdue`,
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY', maintenanceFrequency: 6,
        nextMaintenanceDueAt: daysFromNow(-900),
      },
    });
    ids.push(late.id);

    const alsoLate = await prisma.customer.create({
      data: {
        name: `${tag}-yyy-less-overdue`,
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY', maintenanceFrequency: 6,
        nextMaintenanceDueAt: daysFromNow(-5),
      },
    });
    ids.push(alsoLate.id);

    const noDate = await prisma.customer.create({
      data: {
        name: `${tag}-aaa-unknown`,
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY', maintenanceFrequency: 6,
        nextMaintenanceDueAt: null,
      },
    });
    ids.push(noDate.id);
  }, 120_000);

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    await stopTestServer(ts.server);
  });

  const list = (token: string, params: Record<string, unknown>) =>
    request(ts.baseUrl).get('/api/customers').query({ search: tag, ...params }).set('Authorization', `Bearer ${token}`);

  it('reports totalPages so a caller never has to re-derive it', async () => {
    const res = await list(adminToken, { page: 1, limit: 20 });
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(TOTAL + 3);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(20);
    expect(res.body.meta.totalPages).toBe(Math.ceil((TOTAL + 3) / 20));
  });

  it('makes customer 101 and beyond reachable', async () => {
    // The Phase 0 defect: the UI asked for one page of 50 and offered no
    // navigation, so customer 51+ existed but could not be looked at.
    const perPage = 20;
    const totalPages = Math.ceil((TOTAL + 3) / perPage);
    const seen = new Set<string>();
    for (let page = 1; page <= totalPages; page++) {
      const res = await list(adminToken, { page, limit: perPage, sort: 'maintenance' });
      expect(res.status).toBe(200);
      for (const c of res.body.data) seen.add(c.id);
    }
    expect(seen.size).toBe(TOTAL + 3);

    // Specifically: the 101st row is served, and it is a distinct customer.
    const page6 = await list(adminToken, { page: 6, limit: 20, sort: 'maintenance' });
    expect(page6.body.data.length).toBeGreaterThan(0);
    const page1 = await list(adminToken, { page: 1, limit: 20, sort: 'maintenance' });
    const overlap = page6.body.data.filter((c: any) => page1.body.data.some((p: any) => p.id === c.id));
    expect(overlap).toHaveLength(0);
  });

  it('applies the maintenance ordering globally, before the page slice', async () => {
    // This is the assertion the requirement asks for: a customer who would not
    // otherwise have appeared on page 1 (created last, named last alphabetically)
    // outranks 130 others because they are the most overdue.
    const res = await list(adminToken, { page: 1, limit: 20, sort: 'maintenance' });
    expect(res.body.data[0].name).toBe(`${tag}-zzz-most-overdue`);
    expect(res.body.data[1].name).toBe(`${tag}-yyy-less-overdue`);

    // ...and under the DEFAULT ordering they are not first, which is what proves
    // the ordering came from the server rather than from the fixture's own shape.
    const recent = await list(adminToken, { page: 1, limit: 20 });
    expect(recent.body.data[0].name).not.toBe(`${tag}-zzz-most-overdue`);
  });

  it('orders overdue, then approaching/normal by date, then unknown last', async () => {
    const perPage = 100;
    const all: any[] = [];
    for (let page = 1; page <= Math.ceil((TOTAL + 3) / perPage); page++) {
      const res = await list(adminToken, { page, limit: perPage, sort: 'maintenance', includeSchedule: true });
      all.push(...res.body.data);
    }
    expect(all).toHaveLength(TOTAL + 3);

    // Dated rows come first, in ascending due-date order; the undated row is last.
    const dueValues = all.map((c) => c.nextMaintenanceDueAt);
    expect(dueValues[dueValues.length - 1]).toBeNull();
    const dated = dueValues.slice(0, -1) as string[];
    expect(dated.every((v) => v !== null)).toBe(true);
    for (let i = 1; i < dated.length; i++) {
      expect(new Date(dated[i]).getTime()).toBeGreaterThanOrEqual(new Date(dated[i - 1]).getTime());
    }
    expect(all[0].maintenancePriority).toBe('OVERDUE');
    expect(all[all.length - 1].maintenancePriority).toBe('UNKNOWN');
  });

  it('rejects an unknown sort rather than silently falling back', async () => {
    const res = await list(adminToken, { sort: 'whatever' });
    expect(res.status).toBe(400);
  });

  it('rejects inherited Object.prototype keys, which an `in` check would have accepted', async () => {
    // `sort in CUSTOMER_SORTS` walks the prototype chain, so these four names
    // passed an allowlist that reads as though they could not, and Prisma was
    // then handed a function or Object.prototype as its ordering.
    for (const sort of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      const res = await list(adminToken, { sort });
      expect(res.status).toBe(400);
    }
    // __proto__ cannot be sent as a plain query key by supertest's serializer,
    // but the same allowlist covers it; the two real values still work.
    expect((await list(adminToken, { sort: 'recent' })).status).toBe(200);
    expect((await list(adminToken, { sort: 'maintenance' })).status).toBe(200);
  });

  it('clamps the page size and never serves more than the documented maximum', async () => {
    // The export defect: the UI asked for limit=2000 and believed it got 2000.
    const res = await list(adminToken, { limit: 2000 });
    expect(res.body.data.length).toBeLessThanOrEqual(100);
    expect(res.body.meta.limit).toBe(100);
  });

  it('exports every matching customer by walking the endpoint meta, not one clamped page', async () => {
    // Exactly what the Admin export button now does (see utils/fetchAllPages.ts):
    // read page 1 to learn totalPages, then fetch the rest at the documented
    // page size. The result must equal the authorized matching dataset.
    const first = await list(adminToken, { page: 1, limit: 100, includeSchedule: true, sort: 'maintenance' });
    const totalPages = first.body.meta.totalPages;
    expect(totalPages).toBeGreaterThan(1);

    const rows: any[] = [...first.body.data];
    for (let page = 2; page <= totalPages; page++) {
      const res = await list(adminToken, { page, limit: 100, includeSchedule: true, sort: 'maintenance' });
      rows.push(...res.body.data);
    }
    expect(rows).toHaveLength(TOTAL + 3);
    expect(new Set(rows.map((r) => r.id)).size).toBe(TOTAL + 3);
    expect(rows.length).toBeGreaterThan(100);
  });

  it('gives Scheduling the same pagination while still hiding admin-private customers', async () => {
    const hidden = await prisma.customer.create({
      data: {
        name: `${tag}-hidden-from-scheduling`, phone: testPhone(),
        maintenanceCycle: 'MONTHLY', maintenanceFrequency: 6,
        nextMaintenanceDueAt: daysFromNow(-999), createdById: users.admin.id,
        appointments: {
          create: {
            type: 'MAINTENANCE', scheduledDate: new Date(), isUrgent: true,
            visibleToScheduling: false, createdByRole: 'ADMIN',
          },
        },
      },
    });
    ids.push(hidden.id);

    // Most overdue of all, so if it leaked it would be the very first row.
    const admin = await list(adminToken, { page: 1, limit: 20, sort: 'maintenance' });
    expect(admin.body.data[0].name).toBe(`${tag}-hidden-from-scheduling`);

    const sched = await list(schedToken, { page: 1, limit: 20, sort: 'maintenance' });
    expect(sched.body.data.some((c: any) => c.name === `${tag}-hidden-from-scheduling`)).toBe(false);
    expect(sched.body.meta.total).toBe(admin.body.meta.total - 1);
    expect(sched.body.meta.totalPages).toBe(Math.ceil(sched.body.meta.total / 20));

    // And it stays hidden from a Scheduling EXPORT, not merely from page 1.
    const pages = sched.body.meta.totalPages;
    for (let page = 1; page <= pages; page++) {
      const res = await list(schedToken, { page, limit: 20, sort: 'maintenance' });
      expect(res.body.data.some((c: any) => c.name === `${tag}-hidden-from-scheduling`)).toBe(false);
    }

    await prisma.appointment.deleteMany({ where: { customerId: hidden.id } });
  });

  it('keeps paging deterministic when many customers share a due date', async () => {
    // Without a total order, two rows can swap between requests and one of them
    // is then never returned by any page.
    const sameDay = daysFromNow(500);
    const tiedIds: string[] = [];
    for (let i = 0; i < 25; i++) {
      const c = await prisma.customer.create({
        data: {
          name: `${tag}-tie`, phone: testPhone(),
          maintenanceCycle: 'MONTHLY', maintenanceFrequency: 6, nextMaintenanceDueAt: sameDay,
        },
      });
      tiedIds.push(c.id);
      ids.push(c.id);
    }

    const collect = async () => {
      const out: string[] = [];
      for (let page = 1; page <= 3; page++) {
        const res = await request(ts.baseUrl).get('/api/customers')
          .query({ search: `${tag}-tie`, page, limit: 10, sort: 'maintenance' })
          .set('Authorization', `Bearer ${adminToken}`);
        out.push(...res.body.data.map((c: any) => c.id));
      }
      return out;
    };
    const first = await collect();
    const second = await collect();
    expect(new Set(first).size).toBe(25);
    expect(second).toEqual(first);
  }, 60_000);
});
