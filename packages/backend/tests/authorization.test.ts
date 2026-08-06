import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers } from './helpers/fixtures';

describe('Authorization / data isolation', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    await stopTestServer(ts.server);
  });

  it('TECHNICIAN cannot access the customers list (ADMIN/SCHEDULING only)', async () => {
    const res = await request(ts.baseUrl).get('/api/customers').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(403);
  });

  it('SCHEDULING cannot access the admin-only access-codes endpoint', async () => {
    const res = await request(ts.baseUrl).get('/api/config/access-codes').set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(403);
  });

  it('ADMIN can access the admin-only access-codes endpoint', async () => {
    const res = await request(ts.baseUrl).get('/api/config/access-codes').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('SCHEDULING cannot access the expenses endpoint (ADMIN/TECHNICIAN only)', async () => {
    const res = await request(ts.baseUrl).get('/api/expenses').set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(403);
  });

  it("TECHNICIAN's own expense list never includes another technician's expenses (per-request scoping)", async () => {
    const res = await request(ts.baseUrl).get('/api/expenses').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    for (const expense of res.body.data) {
      expect(expense.technicianId).toBe(users.technician.id);
    }
  });
});
