import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, ensureTestAccessCodes, TEST_ACCESS_CODES, TEST_PASSWORD, TestUsers } from './helpers/fixtures';

describe('Authentication / role login', () => {
  let ts: TestServer;
  let users: TestUsers;

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    await ensureTestAccessCodes();
  });

  afterAll(async () => {
    await stopTestServer(ts.server);
  });

  it('valid ADMIN access code succeeds and issues a JWT', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.admin, dept: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('ADMIN');
    expect(typeof res.body.data.token).toBe('string');
  });

  it('valid SCHEDULING access code succeeds and issues a JWT', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.scheduling, dept: 'scheduling' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('SCHEDULING');
    expect(typeof res.body.data.token).toBe('string');
  });

  it('valid TECHNICIAN access code succeeds and issues a JWT', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.technician, dept: 'technician' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('TECHNICIAN');
    expect(typeof res.body.data.token).toBe('string');
  });

  it('invalid access code is rejected with no token issued', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: '0000', dept: 'admin' });
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
  });

  it('email/password login works for the real login mechanism', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/login').send({ email: users.admin.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('ADMIN');
    expect(typeof res.body.data.token).toBe('string');
  });

  it('missing auth on a protected endpoint is rejected', async () => {
    const res = await request(ts.baseUrl).get('/api/customers');
    expect(res.status).toBe(401);
  });

  it('invalid JWT is rejected', async () => {
    const res = await request(ts.baseUrl).get('/api/customers').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('role enforcement: TECHNICIAN cannot access an ADMIN/SCHEDULING-only endpoint', async () => {
    const login = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.technician, dept: 'technician' });
    const techToken = login.body.data.token;
    const res = await request(ts.baseUrl).get('/api/customers').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(403);
  });
});
