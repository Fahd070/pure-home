// v4 Requirement #8 (multi-branch customers) and the Phase 1 notification
// correctness fix.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers, testPhone, uniqueSuffix } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Customer branches', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;
  const customerIds: string[] = [];

  async function createCustomer(branches?: unknown) {
    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Branch Co ${uniqueSuffix()}`, phone: testPhone(),
        maintenanceCycle: 'MONTHLY', maintenanceFrequency: 3,
        address: { city: 'Riyadh', district: 'D', street: 'S' },
        ...(branches !== undefined ? { branches } : {}),
      });
    if (res.body?.data?.id) customerIds.push(res.body.data.id);
    return res;
  }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await stopTestServer(ts.server);
  });

  it('a customer with no branches is unaffected', async () => {
    const res = await createCustomer();
    expect(res.status).toBe(201);
    const detail = await request(ts.baseUrl).get(`/api/customers/${res.body.data.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.data.branches).toEqual([]);
    expect(detail.body.data.branchCount).toBe(0);
  });

  it('creates a customer with one branch', async () => {
    const res = await createCustomer([
      { branchName: 'Olaya', supervisorName: 'Mahdi', supervisorMobile: '0501234567', notes: 'Ground floor' },
    ]);
    expect(res.status).toBe(201);
    const detail = await request(ts.baseUrl).get(`/api/customers/${res.body.data.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.data.branches).toHaveLength(1);
    expect(detail.body.data.branches[0].branchName).toBe('Olaya');
    expect(detail.body.data.branches[0].supervisorMobile).toBe('0501234567');
  });

  it('ONE customer with many branches remains ONE customer', async () => {
    const res = await createCustomer([
      { branchName: 'Olaya' }, { branchName: 'Malaz' }, { branchName: 'Nakheel' },
    ]);
    expect(res.status).toBe(201);

    // The critical domain rule: three branches must not become three customers.
    const matching = await prisma.customer.findMany({ where: { name: res.body.data.name } });
    expect(matching).toHaveLength(1);

    const detail = await request(ts.baseUrl).get(`/api/customers/${res.body.data.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.data.branchCount).toBe(3);
  });

  it('a multi-branch customer appears exactly once in the customer list', async () => {
    const res = await createCustomer([{ branchName: 'A' }, { branchName: 'B' }, { branchName: 'C' }]);
    const list = await request(ts.baseUrl)
      .get('/api/customers')
      .query({ search: res.body.data.name, limit: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const rows = list.body.data.filter((c: any) => c.id === res.body.data.id);
    expect(rows).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);
  });

  it('replaces the whole branch set on update', async () => {
    const created = await createCustomer([{ branchName: 'Old A' }, { branchName: 'Old B' }]);
    const id = created.body.data.id;

    const updated = await request(ts.baseUrl)
      .put(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ branches: [{ branchName: 'New Only', supervisorName: 'Salem' }] });
    expect(updated.status).toBe(200);

    const rows = await prisma.customerBranch.findMany({ where: { customerId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].branchName).toBe('New Only');
  });

  it('an explicit empty array clears branches; an omitted key leaves them alone', async () => {
    const created = await createCustomer([{ branchName: 'Keep me' }]);
    const id = created.body.data.id;

    // Omitted -> untouched.
    await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`).send({ notes: 'unrelated edit' });
    expect(await prisma.customerBranch.count({ where: { customerId: id } })).toBe(1);

    // Explicit [] -> cleared.
    await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`).send({ branches: [] });
    expect(await prisma.customerBranch.count({ where: { customerId: id } })).toBe(0);
  });

  it('requires a branch name and validates the supervisor mobile', async () => {
    const noName = await createCustomer([{ branchName: '   ' }]);
    expect(noName.status).toBe(400);

    const badPhone = await createCustomer([{ branchName: 'Olaya', supervisorMobile: '12345' }]);
    expect(badPhone.status).toBe(400);
  });

  it('blank optional branch fields are stored as null, not empty strings', async () => {
    const created = await createCustomer([{ branchName: 'Olaya', supervisorName: '', supervisorMobile: '', notes: '' }]);
    const rows = await prisma.customerBranch.findMany({ where: { customerId: created.body.data.id } });
    expect(rows[0].supervisorName).toBeNull();
    expect(rows[0].supervisorMobile).toBeNull();
    expect(rows[0].notes).toBeNull();
  });

  it('branches are removed with the customer', async () => {
    const created = await createCustomer([{ branchName: 'Olaya' }]);
    const id = created.body.data.id;
    await request(ts.baseUrl).delete(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(await prisma.customerBranch.count({ where: { customerId: id } })).toBe(0);
  });

  it('SCHEDULING can manage branches, TECHNICIAN cannot reach the customer API at all', async () => {
    const created = await createCustomer();
    const sched = await request(ts.baseUrl)
      .put(`/api/customers/${created.body.data.id}`)
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ branches: [{ branchName: 'Sched added' }] });
    expect(sched.status).toBe(200);

    const tech = await request(ts.baseUrl)
      .get(`/api/customers/${created.body.data.id}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(tech.status).toBe(403);
  });

  it('PRIVACY: branch supervisor details never reach a technician appointment payload', async () => {
    const created = await createCustomer([
      { branchName: 'Olaya', supervisorName: 'Branch Supervisor Secret', supervisorMobile: '0509998888' },
    ]);
    const appt = await prisma.appointment.create({
      data: {
        customerId: created.body.data.id, type: 'MAINTENANCE',
        scheduledDate: new Date('2026-06-10'), workStatus: 'WAITING',
        technicianId: users.technician.id, isUrgent: false,
      },
    });

    const list = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${techToken}`);
    const detail = await request(ts.baseUrl).get(`/api/appointments/${appt.id}`).set('Authorization', `Bearer ${techToken}`);

    const payload = JSON.stringify(list.body) + JSON.stringify(detail.body);
    expect(payload).not.toContain('Branch Supervisor Secret');
    expect(payload).not.toContain('0509998888');
    expect(payload).not.toContain('branches');
  });
});

describe('Notification GET / read-all correctness', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string;
  const notificationIds: string[] = [];

  async function seed(userId: string, type: string, title = 'n') {
    const n = await prisma.notification.create({
      data: { userId, type, title, body: 'b', isRead: false },
    });
    notificationIds.push(n.id);
    return n;
  }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
    await stopTestServer(ts.server);
  });

  it('returns MULTIPLE notification types, not just the legacy reminder type', async () => {
    await prisma.notification.deleteMany({ where: { userId: users.admin.id } });
    await seed(users.admin.id, 'APPOINTMENT_REMINDER', 'reminder');
    await seed(users.admin.id, 'APPOINTMENT_POSTPONED', 'postponed');
    await seed(users.admin.id, 'CUSTOMER_NO_ANSWER', 'no answer');

    const res = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const types = res.body.data.map((n: any) => n.type).sort();
    // Before the fix, only APPOINTMENT_REMINDER came back.
    expect(types).toEqual(['APPOINTMENT_POSTPONED', 'APPOINTMENT_REMINDER', 'CUSTOMER_NO_ANSWER']);
  });

  it('read-all marks EXACTLY the set GET returns — no silently-read invisible rows', async () => {
    await prisma.notification.deleteMany({ where: { userId: users.admin.id } });
    await seed(users.admin.id, 'APPOINTMENT_REMINDER');
    await seed(users.admin.id, 'CUSTOMER_NO_ANSWER');

    const before = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${adminToken}`);
    const visibleBefore = before.body.data.length;

    const readAll = await request(ts.baseUrl).patch('/api/notifications/read-all').set('Authorization', `Bearer ${adminToken}`);
    expect(readAll.status).toBe(200);
    // The number marked read equals the number the user could actually see.
    expect(readAll.body.data.updated).toBe(visibleBefore);

    const count = await request(ts.baseUrl).get('/api/notifications/unread-count').set('Authorization', `Bearer ${adminToken}`);
    expect(count.body.data.total).toBe(0);
  });

  it('the unread count matches the unread rows, broken down by type', async () => {
    await prisma.notification.deleteMany({ where: { userId: users.admin.id } });
    await seed(users.admin.id, 'APPOINTMENT_REMINDER');
    await seed(users.admin.id, 'APPOINTMENT_REMINDER');
    await seed(users.admin.id, 'CUSTOMER_NO_ANSWER');

    const res = await request(ts.baseUrl).get('/api/notifications/unread-count').set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.byType.APPOINTMENT_REMINDER).toBe(2);
    expect(res.body.data.byType.CUSTOMER_NO_ANSWER).toBe(1);
  });

  it('a user never sees, counts, or can read another user\'s notifications', async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: [users.admin.id, users.scheduling.id] } } });
    const adminNotif = await seed(users.admin.id, 'APPOINTMENT_REMINDER', 'ADMIN ONLY SECRET');
    await seed(users.scheduling.id, 'APPOINTMENT_REMINDER', 'sched');

    const list = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${schedToken}`);
    expect(JSON.stringify(list.body)).not.toContain('ADMIN ONLY SECRET');

    const count = await request(ts.baseUrl).get('/api/notifications/unread-count').set('Authorization', `Bearer ${schedToken}`);
    expect(count.body.data.total).toBe(1);

    // Cross-user read attempt is an indistinguishable 404.
    const steal = await request(ts.baseUrl).patch(`/api/notifications/${adminNotif.id}/read`).set('Authorization', `Bearer ${schedToken}`);
    expect(steal.status).toBe(404);
    const stillUnread = await prisma.notification.findUnique({ where: { id: adminNotif.id } });
    expect(stillUnread!.isRead).toBe(false);
  });

  it("read-all does not touch another user's notifications", async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: [users.admin.id, users.scheduling.id] } } });
    const adminNotif = await seed(users.admin.id, 'APPOINTMENT_REMINDER');
    await seed(users.scheduling.id, 'APPOINTMENT_REMINDER');

    await request(ts.baseUrl).patch('/api/notifications/read-all').set('Authorization', `Bearer ${schedToken}`);

    const untouched = await prisma.notification.findUnique({ where: { id: adminNotif.id } });
    expect(untouched!.isRead).toBe(false);
  });

  it('the dedupe constraint permits many null keys but blocks a real duplicate', async () => {
    await prisma.notification.deleteMany({ where: { userId: users.admin.id } });
    // Existing production rows all have a null dedupeKey -- many must coexist.
    await seed(users.admin.id, 'APPOINTMENT_REMINDER');
    await seed(users.admin.id, 'APPOINTMENT_REMINDER');
    expect(await prisma.notification.count({ where: { userId: users.admin.id } })).toBe(2);

    const withKey = await prisma.notification.create({
      data: { userId: users.admin.id, type: 'CUSTOMER_NO_ANSWER', title: 't', body: 'b', dedupeKey: 'no-answer:appt-1' },
    });
    notificationIds.push(withKey.id);

    await expect(
      prisma.notification.create({
        data: { userId: users.admin.id, type: 'CUSTOMER_NO_ANSWER', title: 't', body: 'b', dedupeKey: 'no-answer:appt-1' },
      })
    ).rejects.toThrow();
  });

  it('existing rows default to INFO severity', async () => {
    const n = await seed(users.admin.id, 'APPOINTMENT_REMINDER');
    const row = await prisma.notification.findUnique({ where: { id: n.id } });
    expect(row!.severity).toBe('INFO');
    expect(row!.dedupeKey).toBeNull();
  });
});
