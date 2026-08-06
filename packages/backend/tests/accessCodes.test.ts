// Regression coverage for the previously-fixed hardcoded department access-code
// security issue: codes must come from the database/test config only, never the old
// literal fallback (9012/9013/9014).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, ensureTestAccessCodes, signTestToken, TEST_ACCESS_CODES, TestUsers } from './helpers/fixtures';

describe('System config / access codes', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, techToken: string;

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    await ensureTestAccessCodes();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    // Restore the fixed test codes so this file leaves no lingering rotation for any
    // other test file that might run after it in the same suite invocation.
    await ensureTestAccessCodes();
    await stopTestServer(ts.server);
  });

  it('a valid, DB-configured test code logs in successfully', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.admin, dept: 'admin' });
    expect(res.status).toBe(200);
  });

  it('an invalid code is rejected', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: '1111', dept: 'admin' });
    expect(res.status).toBe(401);
  });

  it('the old hardcoded literal (9012) is NOT accepted once a different code is configured', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: '9012', dept: 'admin' });
    expect(res.status).toBe(401);
  });

  it('an authorized ADMIN can read the configured codes', async () => {
    const res = await request(ts.baseUrl).get('/api/config/access-codes').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.admin).toBe(TEST_ACCESS_CODES.admin);
  });

  it('an unauthorized role (TECHNICIAN) cannot modify access codes', async () => {
    const res = await request(ts.baseUrl)
      .put('/api/config/access-codes')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ dept: 'admin', currentCode: TEST_ACCESS_CODES.admin, newCode: '6001', confirmCode: '6001' });
    expect(res.status).toBe(403);
  });

  it('ADMIN can rotate a code with the correct current code, and the new code takes effect', async () => {
    const rotateRes = await request(ts.baseUrl)
      .put('/api/config/access-codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dept: 'admin', currentCode: TEST_ACCESS_CODES.admin, newCode: '6002', confirmCode: '6002' });
    expect(rotateRes.status).toBe(200);

    const loginWithNew = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: '6002', dept: 'admin' });
    expect(loginWithNew.status).toBe(200);

    const loginWithOld = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.admin, dept: 'admin' });
    expect(loginWithOld.status).toBe(401);
  });

  it('rotation with the wrong current code is rejected', async () => {
    const res = await request(ts.baseUrl)
      .put('/api/config/access-codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dept: 'scheduling', currentCode: 'wrong', newCode: '6003', confirmCode: '6003' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('WRONG_CURRENT');
  });
});
