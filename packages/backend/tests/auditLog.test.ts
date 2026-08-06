import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Audit log', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, techToken: string;
  let customerId: string;

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

  it('a real business action (customer creation) produces a retrievable audit log entry', async () => {
    const createRes = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Audit Trail Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Dammam', district: 'Test', street: 'Test' },
      });
    expect(createRes.status).toBe(201);
    customerId = createRes.body.data.id;

    const auditRes = await request(ts.baseUrl).get('/api/messages').set('Authorization', `Bearer ${adminToken}`);
    expect(auditRes.status).toBe(200);
    const found = auditRes.body.data.find((entry: any) => entry.entityType === 'customer' && entry.entityId === customerId);
    expect(found).toBeTruthy();
    expect(found.action).toContain('Audit Trail Customer');
  });

  // The audit log route (GET /api/messages) is restricted to ADMIN/SCHEDULING by its
  // own requireRole() configuration -- this test documents that CURRENT, real
  // behavior for TECHNICIAN as a passing regression test. It is not a defect
  // introduced or fixed by this test suite.
  it('TECHNICIAN is refused access to the audit log route (current, supported restriction)', async () => {
    const res = await request(ts.baseUrl).get('/api/messages').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(403);
  });
});
