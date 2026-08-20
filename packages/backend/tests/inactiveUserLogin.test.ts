// Regression tests for the final security-hygiene fix: a disabled
// (isActive=false) user must not be able to start a NEW login session,
// via either POST /api/auth/login (email/password) or POST /api/auth/
// code-login (department access code). Already-issued JWTs are explicitly
// NOT revoked by this fix (see the comments in routes/auth.ts) -- that is
// a documented, accepted limitation, not something these tests attempt to
// cover.
//
// Tests E and G temporarily deactivate the SHARED scheduling/technician
// fixture users from tests/helpers/fixtures.ts (other test files depend on
// them staying active), so each restores isActive=true in a `finally`
// block immediately after asserting the rejection -- guaranteed to run
// even if an assertion throws.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, ensureTestAccessCodes, TEST_ACCESS_CODES, TEST_PASSWORD, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Inactive user cannot start a new login session', () => {
  let ts: TestServer;
  let users: TestUsers;
  let inactiveAdminEmail = '';

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    await ensureTestAccessCodes();

    // A dedicated, disabled admin user -- not one of the shared fixtures, so
    // no restoration is needed and no other test file is affected by it.
    const hash = await bcrypt.hash(TEST_PASSWORD, 4);
    inactiveAdminEmail = 'inactive-admin@test.local';
    await prisma.user.upsert({
      where: { email: inactiveAdminEmail },
      update: { isActive: false, password: hash },
      create: { name: 'Inactive Test Admin', email: inactiveAdminEmail, password: hash, role: 'ADMIN', isActive: false },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: inactiveAdminEmail } });
    await stopTestServer(ts.server);
  });

  // A. active Admin email login succeeds
  it('A. active Admin email login succeeds', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/login').send({ email: users.admin.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('ADMIN');
    expect(typeof res.body.data.token).toBe('string');
  });

  // B. inactive Admin email login rejected
  it('B. inactive Admin email login is rejected with the same generic message as a wrong password', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/login').send({ email: inactiveAdminEmail, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
    expect(res.body.message).toBe('Invalid credentials');
  });

  // C. wrong password behavior unchanged
  it('C. wrong password for an active account is still rejected with the same generic message', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/login').send({ email: users.admin.email, password: 'definitely-wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
    expect(res.body.message).toBe('Invalid credentials');
  });

  // D. active Scheduling code login succeeds
  it('D. active Scheduling code login succeeds', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.scheduling, dept: 'scheduling' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('SCHEDULING');
    expect(typeof res.body.data.token).toBe('string');
  });

  // E. inactive Scheduling account cannot code-login
  it('E. a deactivated Scheduling account cannot code-login', async () => {
    await prisma.user.update({ where: { id: users.scheduling.id }, data: { isActive: false } });
    try {
      const res = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.scheduling, dept: 'scheduling' });
      expect(res.status).toBe(403);
      expect(res.body.data).toBeUndefined();
    } finally {
      await prisma.user.update({ where: { id: users.scheduling.id }, data: { isActive: true } });
    }
  });

  // F. active Technician code login succeeds
  it('F. active Technician code login succeeds', async () => {
    const res = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.technician, dept: 'technician' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('TECHNICIAN');
    expect(typeof res.body.data.token).toBe('string');
  });

  // G. inactive Technician account cannot code-login
  it('G. a deactivated Technician account cannot code-login', async () => {
    await prisma.user.update({ where: { id: users.technician.id }, data: { isActive: false } });
    try {
      const res = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.technician, dept: 'technician' });
      expect(res.status).toBe(403);
      expect(res.body.data).toBeUndefined();
    } finally {
      await prisma.user.update({ where: { id: users.technician.id }, data: { isActive: true } });
    }
  });

  // Regression: after E/G's restoration, the shared fixtures are usable again.
  it('regression: Scheduling and Technician code login both work again after restoration', async () => {
    const sched = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.scheduling, dept: 'scheduling' });
    expect(sched.status).toBe(200);
    const tech = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.technician, dept: 'technician' });
    expect(tech.status).toBe(200);
  });
});
