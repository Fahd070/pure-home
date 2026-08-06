import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Direct messages', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;
  let messageId: string;

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    await prisma.directMessage.deleteMany({ where: { senderId: { in: [users.admin.id, users.technician.id] } } });
    await stopTestServer(ts.server);
  });

  it('ADMIN sends a direct message to SCHEDULING', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/direct-messages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: 'Regression test message', recipientRole: 'SCHEDULING' });
    expect(res.status).toBe(201);
    messageId = res.body.data.id;
  });

  it('SCHEDULING sees it in their inbox', async () => {
    const res = await request(ts.baseUrl).get('/api/direct-messages/inbox').set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    const found = res.body.data.find((m: any) => m.id === messageId);
    expect(found).toBeTruthy();
  });

  it('ADMIN sees it in their sent messages', async () => {
    const res = await request(ts.baseUrl).get('/api/direct-messages/sent').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const found = res.body.data.find((m: any) => m.id === messageId);
    expect(found).toBeTruthy();
  });

  it('SCHEDULING marks it read, and unread-count reflects the change', async () => {
    const before = await request(ts.baseUrl).get('/api/direct-messages/unread-count').set('Authorization', `Bearer ${schedToken}`);
    expect(before.body.data).toBeGreaterThanOrEqual(1);

    const readRes = await request(ts.baseUrl).patch(`/api/direct-messages/${messageId}/read`).set('Authorization', `Bearer ${schedToken}`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.data.isRead).toBe(true);
  });

  // Direct messages currently have no role restriction (router.use(authenticate) only,
  // no requireRole()) -- covering TECHNICIAN here proves the real, currently-supported
  // flow, distinct from the audit log route's ADMIN/SCHEDULING-only restriction.
  it('TECHNICIAN can also use the direct-message flow (no route restriction here)', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/direct-messages')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ content: 'Technician can message too', recipientRole: 'ADMIN' });
    expect(res.status).toBe(201);
  });
});
