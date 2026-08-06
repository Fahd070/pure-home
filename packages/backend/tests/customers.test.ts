import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Customer core flow', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string;
  const createdCustomerIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
  });

  afterAll(async () => {
    if (createdCustomerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    }
    await stopTestServer(ts.server);
  });

  it('creates a customer', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Regression Test Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Riyadh', district: 'Test District', street: 'Test Street' },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.version).toBe(1);
    createdCustomerIds.push(res.body.data.id);
  });

  it('reads the created customer back', async () => {
    const id = createdCustomerIds[0];
    const res = await request(ts.baseUrl).get(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Regression Test Customer');
    expect(res.body.data.address.city).toBe('Riyadh');
  });

  it('updates the customer with the current version: succeeds and increments version', async () => {
    const id = createdCustomerIds[0];
    const res = await request(ts.baseUrl)
      .put(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated Name', version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Name');
    expect(res.body.data.version).toBe(2);
  });

  // Regression test for a previously-confirmed defect: customerSchema.partial() did
  // not declare `version`, so Zod silently stripped it before the conflict check ran,
  // making PUT /api/customers/:id never return 409 regardless of a stale version.
  // Fixed via customerUpdateSchema (src/routes/customers.ts) which explicitly includes
  // `version` for the update path only. This test proves the conflict check is now live.
  it('rejects a stale-version update with a 409 conflict, and does not overwrite the customer', async () => {
    const id = createdCustomerIds[0];
    // Current version is 2 (from the previous test); resubmitting the old version (1)
    // must be rejected rather than silently applied.
    const res = await request(ts.baseUrl)
      .put(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Stale Update', version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CONFLICT');
    expect(res.body.currentVersion).toBe(2);
    expect(res.body.yourVersion).toBe(1);

    const readBack = await request(ts.baseUrl).get(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(readBack.body.data.name).toBe('Updated Name');
    expect(readBack.body.data.version).toBe(2);
  });

  it('a representative update with no version field still succeeds unconditionally (unchanged, opt-in behavior)', async () => {
    const id = createdCustomerIds[0];
    const res = await request(ts.baseUrl)
      .put(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Updated without a version field' });
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Updated without a version field');
    expect(res.body.data.version).toBe(3);
  });

  it('rejects invalid input (malformed phone number)', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Bad Phone Customer',
        phone: '123',
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Riyadh', district: 'Test', street: 'Test' },
      });
    expect(res.status).toBe(400);
  });
});
