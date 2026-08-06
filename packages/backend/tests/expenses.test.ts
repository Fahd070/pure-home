import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Expenses', () => {
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
    if (createdId) await prisma.expense.deleteMany({ where: { id: createdId } });
    await stopTestServer(ts.server);
  });

  it('a technician creates an expense', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ amount: 42.5, category: 'Fuel', date: new Date().toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.data.technicianId).toBe(users.technician.id);
    createdId = res.body.data.id;
  });

  it('the admin sees the expense in the full list', async () => {
    const res = await request(ts.baseUrl).get('/api/expenses').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const found = res.body.data.find((e: any) => e.id === createdId);
    expect(found).toBeTruthy();
  });

  it('admin approves the expense', async () => {
    const res = await request(ts.baseUrl)
      .patch(`/api/expenses/${createdId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
  });
});
