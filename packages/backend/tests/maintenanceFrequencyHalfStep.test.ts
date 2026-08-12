// Focused modification batch (Part D): maintenanceFrequency must support
// half-month increments (1, 1.5, 2, 2.5, 3, 3.5, ...) while rejecting an
// arbitrary decimal (1.2, 2.37) and never rounding a valid fractional value.
// Schema changed from INTEGER to DOUBLE PRECISION (migration
// 20260812214706_change_customer_maintenance_frequency_to_decimal); validated
// at the API layer via isHalfMonthStep (routes/customers.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Maintenance recurrence half-month steps (Part D)', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string;
  const createdCustomerIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
  });

  afterAll(async () => {
    if (createdCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await stopTestServer(ts.server);
  });

  const baseAddress = { city: 'Riyadh', district: 'Test', street: 'Test' };

  async function createWithFrequency(maintenanceFrequency: number, token = adminToken) {
    return request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Half-Step Customer', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency, address: baseAddress });
  }

  // 21-24. Valid half-month steps are accepted.
  it.each([1, 1.5, 2, 2.5, 3, 3.5])('accepts recurrence %s', async (freq) => {
    const res = await createWithFrequency(freq);
    expect(res.status).toBe(201);
    expect(res.body.data.maintenanceFrequency).toBe(freq);
    createdCustomerIds.push(res.body.data.id);
  });

  // 25. Arbitrary decimals rejected.
  it.each([1.2, 2.37, 1.1, 0.3])('rejects arbitrary decimal recurrence %s', async (freq) => {
    const res = await createWithFrequency(freq);
    expect(res.status).toBe(400);
  });

  // 26. Zero rejected.
  it('26. rejects recurrence 0', async () => {
    const res = await createWithFrequency(0);
    expect(res.status).toBe(400);
  });

  // 27. Negative rejected.
  it('27. rejects a negative recurrence', async () => {
    const res = await createWithFrequency(-1.5);
    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric recurrence', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bad Freq', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 'abc', address: baseAddress });
    expect(res.status).toBe(400);
  });

  // 28/29. Both Admin and Scheduling can create a customer with a half-month
  // recurrence (role parity, same backend endpoint both frontend forms call).
  it('28/29. Scheduling can also create a customer with a half-month recurrence', async () => {
    const res = await createWithFrequency(2.5, schedToken);
    expect(res.status).toBe(201);
    expect(res.body.data.maintenanceFrequency).toBe(2.5);
    createdCustomerIds.push(res.body.data.id);
  });

  // 31/32. Persists without rounding; reloads exactly.
  it('31/32. saved 1.5 persists without rounding and reloads as exactly 1.5', async () => {
    const created = await createWithFrequency(1.5);
    expect(created.body.data.maintenanceFrequency).toBe(1.5);
    const reloaded = await request(ts.baseUrl).get(`/api/customers/${created.body.data.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.data.maintenanceFrequency).toBe(1.5);
    createdCustomerIds.push(created.body.data.id);
  });

  it('saved 3.5 reloads as exactly 3.5 via the list endpoint too', async () => {
    const created = await createWithFrequency(3.5);
    createdCustomerIds.push(created.body.data.id);
    const list = await request(ts.baseUrl).get('/api/customers').set('Authorization', `Bearer ${adminToken}`).query({ search: created.body.data.phone });
    const found = list.body.data.find((c: any) => c.id === created.body.data.id);
    expect(found.maintenanceFrequency).toBe(3.5);
  });

  // 30. Edit (PUT) retains/updates fractional recurrence correctly, never rounds.
  it('30. PUT updates recurrence from a whole number to a fractional one without rounding', async () => {
    const created = await createWithFrequency(1);
    createdCustomerIds.push(created.body.data.id);
    const res = await request(ts.baseUrl).put(`/api/customers/${created.body.data.id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ maintenanceFrequency: 2.5, version: created.body.data.version });
    expect(res.status).toBe(200);
    expect(res.body.data.maintenanceFrequency).toBe(2.5);
  });

  it('PUT rejects updating recurrence to an arbitrary decimal', async () => {
    const created = await createWithFrequency(1);
    createdCustomerIds.push(created.body.data.id);
    const res = await request(ts.baseUrl).put(`/api/customers/${created.body.data.id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ maintenanceFrequency: 1.2, version: created.body.data.version });
    expect(res.status).toBe(400);
    const unchanged = await prisma.customer.findUnique({ where: { id: created.body.data.id } });
    expect(unchanged!.maintenanceFrequency).toBe(1);
  });

  it('PUT omitting maintenanceFrequency leaves the existing fractional value untouched (partial-update semantics)', async () => {
    const created = await createWithFrequency(2.5);
    createdCustomerIds.push(created.body.data.id);
    const res = await request(ts.baseUrl).put(`/api/customers/${created.body.data.id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'unrelated update', version: created.body.data.version });
    expect(res.status).toBe(200);
    expect(res.body.data.maintenanceFrequency).toBe(2.5);
  });

  // 47 (reconfirmed under the new decimal-capable column): a legacy whole-number
  // recurrence is completely unaffected by the type change.
  it('47. a whole-number recurrence continues to work exactly as before under the new column type', async () => {
    const res = await createWithFrequency(1);
    expect(res.status).toBe(201);
    expect(res.body.data.maintenanceFrequency).toBe(1);
    expect(Number.isInteger(res.body.data.maintenanceFrequency)).toBe(true);
    createdCustomerIds.push(res.body.data.id);
  });
});
