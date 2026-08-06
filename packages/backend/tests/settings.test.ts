import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers } from './helpers/fixtures';

describe('User settings', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string;

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
  });

  afterAll(async () => {
    await stopTestServer(ts.server);
  });

  it('GET returns settings (defaults if none saved yet)', async () => {
    const res = await request(ts.baseUrl).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.theme).toBeDefined();
  });

  it('PUT updates settings and the response reflects the new values', async () => {
    const res = await request(ts.baseUrl)
      .put('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ theme: 'dark', soundVolume: 55 });
    expect(res.status).toBe(200);
    expect(res.body.data.theme).toBe('dark');
    expect(res.body.data.soundVolume).toBe(55);
  });

  it('GET after PUT shows the persisted value on readback', async () => {
    const res = await request(ts.baseUrl).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.theme).toBe('dark');
    expect(res.body.data.soundVolume).toBe(55);
  });
});
