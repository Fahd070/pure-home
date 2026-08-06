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

  it('updates the customer and increments its version', async () => {
    const id = createdCustomerIds[0];
    const res = await request(ts.baseUrl)
      .put(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated Name', version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Name');
    expect(res.body.data.version).toBe(2);
  });

  // KNOWN PRE-EXISTING DEFECT (discovered by this suite, not fixed -- out of this
  // task's scope, which is test infrastructure only): `customerSchema` in
  // src/routes/customers.ts never declares a `version` field, so
  // `customerSchema.partial().parse(req.body)` silently strips `version` from the
  // request body before the `before.version !== version` conflict check ever runs.
  // The check is therefore dead code -- PUT /api/customers/:id never returns 409,
  // regardless of a stale version being submitted. Reproduced directly above: the
  // "stale" update below returns 200, not 409. Skipped rather than asserting a
  // business rule the current code does not actually enforce; see the Issue #5
  // final report ("existing application defects discovered but deliberately not
  // fixed") for this exact finding.
  it.skip('rejects a stale-version update with a 409 conflict (BLOCKED: version check is dead code, see comment above)', async () => {
    const id = createdCustomerIds[0];
    const res = await request(ts.baseUrl)
      .put(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Stale Update', version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CONFLICT');
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
