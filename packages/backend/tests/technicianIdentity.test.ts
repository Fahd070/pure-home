// v4 Requirement #12: independent technician identities, and the Administration
// Employees management that issues them.
//
// Access codes used here are TEST-ONLY fixture values created inside this file's
// setup against the disposable test database. They are never production data and
// never appear in source outside this test.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, ensureTestAccessCodes, signTestToken, TEST_ACCESS_CODES, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

// Deliberately distinct from every other fixture code in this suite so a
// cross-test collision cannot make an assertion pass for the wrong reason.
const CODE_A = '7101';
const CODE_B = '7102';
const CODE_UNUSED = '7199';

describe('Technician identity + Employees management', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;
  const createdIds: string[] = [];

  // Technician accounts accrue audit_logs (login and management entries), and
  // AuditLog.userId is a plain foreign key with no cascade -- so a technician
  // cannot simply be deleted. That is deliberate production behaviour, not a
  // test problem: attribution history must outlive convenience, which is exactly
  // why the Employees API deactivates rather than deletes. Only this disposable
  // test database clears the audit rows first, to keep fixtures isolated.
  //
  // The retry is not defensive padding: routes/auth.ts writes its login audit
  // entry fire-and-forget (deliberately, so login is never slowed or blocked by
  // the audit write), which means that INSERT can land a few milliseconds AFTER
  // the login response this test already asserted on. Deleting the audit rows
  // and the user in one pass therefore races that insert. Retrying resolves it
  // without weakening the production behaviour being tested.
  async function purgeCreatedTechnicians() {
    if (createdIds.length === 0) return;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await prisma.auditLog.deleteMany({ where: { userId: { in: createdIds } } });
        await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
        return;
      } catch (e: any) {
        if (attempt === 4) throw e;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }

  async function createTechnician(name: string, accessCode?: string) {
    const res = await request(ts.baseUrl)
      .post('/api/employees/technicians')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, ...(accessCode ? { accessCode } : {}) });
    if (res.body?.data?.id) createdIds.push(res.body.data.id);
    return res;
  }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    await ensureTestAccessCodes();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  beforeEach(async () => {
    // Every test starts from "no technician has a personal code", so the
    // shared-code retirement switch is in a known state. The two shared fixture
    // technicians are reset too, because other test files rely on them having no
    // personal code.
    await purgeCreatedTechnicians();
    createdIds.length = 0;
    await prisma.user.updateMany({
      where: { role: 'TECHNICIAN' },
      data: { accessCodeHash: null, accessCodeSetAt: null },
    });
  });

  afterAll(async () => {
    await purgeCreatedTechnicians();
    await prisma.user.updateMany({ where: { role: 'TECHNICIAN' }, data: { accessCodeHash: null, accessCodeSetAt: null } });
    await ensureTestAccessCodes();
    await stopTestServer(ts.server);
  });

  // ---------------------------------------------------------------- identity

  it("technician A's code authenticates A, and technician B's code authenticates B", async () => {
    const a = await createTechnician('Technician Alpha', CODE_A);
    const b = await createTechnician('Technician Beta', CODE_B);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const loginA = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: CODE_A, dept: 'technician' });
    const loginB = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: CODE_B, dept: 'technician' });

    expect(loginA.status).toBe(200);
    expect(loginB.status).toBe(200);
    expect(loginA.body.data.user.id).toBe(a.body.data.id);
    expect(loginB.body.data.user.id).toBe(b.body.data.id);
    // The whole point of the requirement: the UI shows the real person.
    expect(loginA.body.data.user.name).toBe('Technician Alpha');
    expect(loginB.body.data.user.name).toBe('Technician Beta');
  });

  it('the JWT identifies the exact technician, not a shared account', async () => {
    const a = await createTechnician('Technician Alpha', CODE_A);
    const b = await createTechnician('Technician Beta', CODE_B);

    const loginA = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: CODE_A, dept: 'technician' });
    const loginB = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: CODE_B, dept: 'technician' });

    const [, payloadA] = loginA.body.data.token.split('.');
    const [, payloadB] = loginB.body.data.token.split('.');
    const claimsA = JSON.parse(Buffer.from(payloadA, 'base64').toString());
    const claimsB = JSON.parse(Buffer.from(payloadB, 'base64').toString());

    expect(claimsA.userId).toBe(a.body.data.id);
    expect(claimsB.userId).toBe(b.body.data.id);
    expect(claimsA.userId).not.toBe(claimsB.userId);
    // Permissions are unchanged: still the plain TECHNICIAN role.
    expect(claimsA.role).toBe('TECHNICIAN');
    expect(claimsB.role).toBe('TECHNICIAN');
  });

  it('a wrong code is rejected with a generic 401 that does not reveal why', async () => {
    await createTechnician('Technician Alpha', CODE_A);
    const res = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: CODE_UNUSED, dept: 'technician' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid code');
    expect(res.body.data).toBeUndefined();
  });

  it('a deactivated technician cannot authenticate with their code', async () => {
    const a = await createTechnician('Technician Alpha', CODE_A);

    const ok = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: CODE_A, dept: 'technician' });
    expect(ok.status).toBe(200);

    const deact = await request(ts.baseUrl)
      .patch(`/api/employees/technicians/${a.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(deact.status).toBe(200);

    const after = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: CODE_A, dept: 'technician' });
    expect(after.status).toBe(401);
  });

  it('two technicians cannot share one access code', async () => {
    await createTechnician('Technician Alpha', CODE_A);
    const dup = await createTechnician('Technician Beta', CODE_A);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('CODE_TAKEN');
  });

  it('a technician can be re-assigned their own current code without a false collision', async () => {
    const a = await createTechnician('Technician Alpha', CODE_A);
    const res = await request(ts.baseUrl)
      .put(`/api/employees/technicians/${a.body.data.id}/access-code`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newCode: CODE_A, confirmCode: CODE_A });
    expect(res.status).toBe(200);
  });

  // ------------------------------------------------- backward compatibility

  it('the legacy shared department code still works while no technician has a personal code', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/auth/code-login')
      .send({ code: TEST_ACCESS_CODES.technician, dept: 'technician' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('TECHNICIAN');
  });

  // SUPERSEDED BY THE PHASE 1 CLOSURE DECISION. This previously asserted that the
  // shared code was retired as soon as ANY technician had a personal code. That
  // rule created a real operational lockout: the moment the first technician was
  // configured, every technician still awaiting a code lost the shared code too.
  //
  // The approved rule is "ALL active individual technicians configured". The
  // assertion is inverted rather than deleted, because "the shared code SURVIVES
  // partial setup" is now the property that must not regress. Full cutover
  // behaviour is covered in phase1Hardening.test.ts, which controls the whole
  // technician roster.
  it('the legacy shared department code SURVIVES partial setup (no lockout window)', async () => {
    await createTechnician('Technician Alpha', CODE_A);
    // The shared fixture set still contains an active technician with no personal
    // code, so setup is genuinely partial here.
    const res = await request(ts.baseUrl)
      .post('/api/auth/code-login')
      .send({ code: TEST_ACCESS_CODES.technician, dept: 'technician' });
    expect(res.status).toBe(200);

    // ...and the configured technician's personal code works at the same time.
    const personal = await request(ts.baseUrl)
      .post('/api/auth/code-login')
      .send({ code: CODE_A, dept: 'technician' });
    expect(personal.status).toBe(200);
    expect(personal.body.data.user.name).toBe('Technician Alpha');
  });

  it('ADMIN and SCHEDULING department logins are completely unaffected', async () => {
    await createTechnician('Technician Alpha', CODE_A);
    const admin = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.admin, dept: 'admin' });
    const sched = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: TEST_ACCESS_CODES.scheduling, dept: 'scheduling' });
    expect(admin.status).toBe(200);
    expect(sched.status).toBe(200);
  });

  // ------------------------------------------------------------ management

  it('ADMIN can create, rename and reset the code of a technician', async () => {
    const created = await createTechnician('Original Name', CODE_A);
    expect(created.status).toBe(201);
    expect(created.body.data.hasAccessCode).toBe(true);

    const renamed = await request(ts.baseUrl)
      .patch(`/api/employees/technicians/${created.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Renamed Technician' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Renamed Technician');

    const reset = await request(ts.baseUrl)
      .put(`/api/employees/technicians/${created.body.data.id}/access-code`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newCode: CODE_B, confirmCode: CODE_B });
    expect(reset.status).toBe(200);

    // Old code no longer works; new one does, and still resolves the same person.
    const old = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: CODE_A, dept: 'technician' });
    expect(old.status).toBe(401);
    const fresh = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: CODE_B, dept: 'technician' });
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.user.id).toBe(created.body.data.id);
    expect(fresh.body.data.user.name).toBe('Renamed Technician');
  });

  it('a technician created without a code cannot log in until one is assigned', async () => {
    const created = await createTechnician('No Code Yet');
    expect(created.status).toBe(201);
    expect(created.body.data.hasAccessCode).toBe(false);

    const assigned = await request(ts.baseUrl)
      .put(`/api/employees/technicians/${created.body.data.id}/access-code`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newCode: CODE_A, confirmCode: CODE_A });
    expect(assigned.status).toBe(200);

    const login = await request(ts.baseUrl).post('/api/auth/code-login').send({ code: CODE_A, dept: 'technician' });
    expect(login.status).toBe(200);
    expect(login.body.data.user.id).toBe(created.body.data.id);
  });

  it('a mismatched confirmation is rejected', async () => {
    const created = await createTechnician('Technician Alpha');
    const res = await request(ts.baseUrl)
      .put(`/api/employees/technicians/${created.body.data.id}/access-code`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newCode: CODE_A, confirmCode: CODE_B });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISMATCH');
  });

  it('a non-4-digit code is rejected', async () => {
    // Sent explicitly rather than through createTechnician(), whose optional
    // spread would drop an empty-string code before it ever reached the API and
    // silently turn this into a "created with no code" success.
    for (const bad of ['abc', '123', '12345', '', '12a4']) {
      const res = await request(ts.baseUrl)
        .post('/api/employees/technicians')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Bad ${bad || 'empty'}`, accessCode: bad });
      if (res.body?.data?.id) createdIds.push(res.body.data.id);
      expect(res.status).toBe(400);
    }
  });

  // ------------------------------------------------------------- security

  it('access-code hashes are NEVER returned by any employees endpoint', async () => {
    const created = await createTechnician('Technician Alpha', CODE_A);
    const list = await request(ts.baseUrl).get('/api/employees/technicians').set('Authorization', `Bearer ${adminToken}`);

    const serialized = JSON.stringify(list.body) + JSON.stringify(created.body);
    expect(serialized).not.toContain('accessCodeHash');
    expect(serialized).not.toContain('$2a$');
    expect(serialized).not.toContain('$2b$');
    // Nor the plaintext code itself.
    expect(serialized).not.toContain(CODE_A);
    // Only the masked state.
    const row = list.body.data.find((e: any) => e.id === created.body.data.id);
    expect(row.hasAccessCode).toBe(true);
  });

  it('access-code hashes are NEVER returned by the Access Codes endpoint', async () => {
    await createTechnician('Technician Alpha', CODE_A);
    const res = await request(ts.baseUrl).get('/api/config/access-codes').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('accessCodeHash');
    expect(serialized).not.toContain('$2a$');
    expect(serialized).not.toContain(CODE_A);
    // This endpoint deliberately no longer carries the technician roster or the
    // migration flag: the v4 UI reads both from /api/employees/*, so duplicating
    // them here would be a second, unread copy paid for on every call. Its shape
    // is exactly what Desktop v3.6.5 expects.
    expect(res.body.data).toHaveProperty('admin');
    expect(res.body.data).toHaveProperty('scheduling');
    expect(res.body.data).toHaveProperty('technician');
    expect(res.body.data).not.toHaveProperty('technicians');
  });

  it('the migration endpoint reports status without exposing any credential material', async () => {
    await createTechnician('Technician Alpha', CODE_A);
    const res = await request(ts.baseUrl).get('/api/employees/technician-migration').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('accessCodeHash');
    expect(serialized).not.toContain('$2a$');
    expect(serialized).not.toContain(CODE_A);

    // Setup is still partial here (another active fixture technician has no
    // personal code), so cutover is correctly unavailable.
    expect(res.body.data.sharedLoginRetired).toBe(false);
    expect(res.body.data.canCompleteCutover).toBe(false);
  });

  it('the stored code is a hash, not the plaintext', async () => {
    const created = await createTechnician('Technician Alpha', CODE_A);
    const row = await prisma.user.findUnique({ where: { id: created.body.data.id }, select: { accessCodeHash: true } });
    expect(row!.accessCodeHash).toBeTruthy();
    expect(row!.accessCodeHash).not.toBe(CODE_A);
    expect(await bcrypt.compare(CODE_A, row!.accessCodeHash!)).toBe(true);
  });

  it('SCHEDULING cannot list, create, rename or reset technician credentials', async () => {
    const created = await createTechnician('Technician Alpha', CODE_A);
    const calls = [
      request(ts.baseUrl).get('/api/employees/technicians').set('Authorization', `Bearer ${schedToken}`),
      request(ts.baseUrl).post('/api/employees/technicians').set('Authorization', `Bearer ${schedToken}`).send({ name: 'X' }),
      request(ts.baseUrl).patch(`/api/employees/technicians/${created.body.data.id}`).set('Authorization', `Bearer ${schedToken}`).send({ name: 'X' }),
      request(ts.baseUrl).put(`/api/employees/technicians/${created.body.data.id}/access-code`).set('Authorization', `Bearer ${schedToken}`).send({ newCode: CODE_B, confirmCode: CODE_B }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
  });

  it('a TECHNICIAN cannot manage technician accounts, including their own', async () => {
    const created = await createTechnician('Technician Alpha', CODE_A);
    const calls = [
      request(ts.baseUrl).get('/api/employees/technicians').set('Authorization', `Bearer ${techToken}`),
      request(ts.baseUrl).post('/api/employees/technicians').set('Authorization', `Bearer ${techToken}`).send({ name: 'X' }),
      request(ts.baseUrl).put(`/api/employees/technicians/${created.body.data.id}/access-code`).set('Authorization', `Bearer ${techToken}`).send({ newCode: CODE_B, confirmCode: CODE_B }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
  });

  it('an unauthenticated caller cannot reach any employees endpoint', async () => {
    const res = await request(ts.baseUrl).get('/api/employees/technicians');
    expect(res.status).toBe(401);
  });

  it('the create endpoint cannot be used to mint an ADMIN account', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/employees/technicians')
      .set('Authorization', `Bearer ${adminToken}`)
      // A client attempting privilege escalation via the request body.
      .send({ name: 'Escalation Attempt', role: 'ADMIN' });
    expect(res.status).toBe(201);
    createdIds.push(res.body.data.id);
    const row = await prisma.user.findUnique({ where: { id: res.body.data.id }, select: { role: true } });
    expect(row!.role).toBe('TECHNICIAN');
  });

  it('the update endpoint cannot rename or deactivate a non-technician account', async () => {
    const res = await request(ts.baseUrl)
      .patch(`/api/employees/technicians/${users.admin.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Hijacked', isActive: false });
    expect(res.status).toBe(404);

    const admin = await prisma.user.findUnique({ where: { id: users.admin.id }, select: { name: true, isActive: true } });
    expect(admin!.name).not.toBe('Hijacked');
    expect(admin!.isActive).toBe(true);
  });

  it('a technician account cannot be used to log in by email', async () => {
    const created = await createTechnician('Technician Alpha', CODE_A);
    const row = await prisma.user.findUnique({ where: { id: created.body.data.id }, select: { email: true } });
    // The generated password is a discarded random secret, so no password a
    // caller could supply -- including the access code -- can authenticate here.
    // An empty password is excluded deliberately: it is rejected at 400 by the
    // login schema before any credential check, which would prove nothing about
    // the account itself.
    for (const attempt of [CODE_A, 'password', row!.email]) {
      const res = await request(ts.baseUrl).post('/api/auth/login').send({ email: row!.email, password: attempt });
      expect(res.status).toBe(401);
    }
  });
});
