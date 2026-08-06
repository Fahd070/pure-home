import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Call reports', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, techToken: string;
  let createdId: string;

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    if (createdId) await prisma.$executeRawUnsafe(`DELETE FROM "call_reports" WHERE id = $1`, createdId);
    await stopTestServer(ts.server);
  });

  it('creates a call report for an unregistered caller', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ unregisteredName: 'Walk-in Caller', employeeName: 'Test Employee', callDate: new Date().toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    createdId = res.body.data.id;
  });

  it('reads the call report back in the list', async () => {
    const res = await request(ts.baseUrl).get('/api/call-reports').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const found = res.body.data.find((r: any) => r.id === createdId);
    expect(found).toBeTruthy();
  });

  it('TECHNICIAN cannot access call reports (ADMIN/SCHEDULING only)', async () => {
    const res = await request(ts.baseUrl).get('/api/call-reports').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(403);
  });
});
