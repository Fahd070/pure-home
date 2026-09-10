// Phase 1 closure hardening: shared-code transition, session revocation (D9),
// access-code reset semantics, and technician code-login rate limiting (D8).
//
// All access codes here are TEST-ONLY fixture values created in setup against
// the disposable test database.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { io as ioClient, Socket } from 'socket.io-client';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, ensureTestAccessCodes, signTestToken, TEST_ACCESS_CODES, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';
import { authLimiterStore, technicianCodeLimiterStore } from '../src/app';
import { sharedTechnicianEmail, SHARED_LOGIN_RETIRED_KEY } from '../src/services/technicianIdentity.service';

const CODE_A = '8101';
const CODE_B = '8102';
const CODE_C = '8103';

describe('Phase 1 hardening', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string;
  const createdIds: string[] = [];

  async function purge() {
    if (createdIds.length === 0) return;
    for (let i = 0; i < 5; i++) {
      try {
        // Order matters: appointments.technicianId is a foreign key to users, so
        // any appointment still pointing at a created technician must go first
        // or the user delete fails and leaves an ACTIVE, code-less technician
        // behind -- which would then block the cutover condition in every later
        // run against the same disposable database.
        const appts = await prisma.appointment.findMany({
          where: { technicianId: { in: createdIds } },
          select: { id: true, customerId: true },
        });
        if (appts.length) {
          await prisma.appointment.deleteMany({ where: { id: { in: appts.map(a => a.id) } } });
          const custIds = appts.map(a => a.customerId).filter((x): x is string => !!x);
          if (custIds.length) await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
        }
        await prisma.auditLog.deleteMany({ where: { userId: { in: createdIds } } });
        await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
        return;
      } catch (e) {
        if (i === 4) throw e;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }

  async function addTechnician(name: string, accessCode?: string) {
    const res = await request(ts.baseUrl)
      .post('/api/employees/technicians')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, ...(accessCode ? { accessCode } : {}) });
    if (res.body?.data?.id) createdIds.push(res.body.data.id);
    return res;
  }

  const login = (code: string) =>
    request(ts.baseUrl).post('/api/auth/code-login').send({ code, dept: 'technician' });

  /**
   * The shared fixture set includes a SECOND technician account (technician2,
   * used by other files' data-isolation tests) which is active and has no
   * personal code. That is a perfectly valid production-shaped state -- and it
   * correctly keeps the shared code alive, because an active individual
   * technician without a code is exactly who the shared code must keep serving.
   *
   * Cutover tests therefore have to account for it explicitly rather than
   * pretend it is not there. Parking it (deactivating) is the realistic
   * equivalent of an employee who has left.
   */
  async function parkFixtureTechnician2() {
    await prisma.user.update({ where: { id: users.technician2.id }, data: { isActive: false } });
  }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    await ensureTestAccessCodes();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    // The shared/legacy account must exist for the transition tests to be
    // meaningful. The fixture technician already uses the shared email.
    await prisma.user.update({
      where: { email: sharedTechnicianEmail() },
      data: { isActive: true, accessCodeHash: null },
    });
  });

  beforeEach(async () => {
    await purge();
    createdIds.length = 0;
    // Retirement is deliberately PERMANENT in production, so each test has to
    // start from a known pre-cutover state on this disposable database.
    await prisma.systemConfig.deleteMany({ where: { key: SHARED_LOGIN_RETIRED_KEY } });
    // This file deliberately exercises many failed logins (cutover checks are
    // 401s, and the rate-limit test is 12 more). Those are real rejections that
    // consume the real limiter budget, so counters are reset between tests --
    // the limiter itself is production-configured and untouched.
    authLimiterStore.resetAll?.();
    technicianCodeLimiterStore.resetAll?.();
    // Reset every technician to "no personal code", active, version 1.
    await prisma.user.updateMany({
      where: { role: 'TECHNICIAN' },
      data: { accessCodeHash: null, accessCodeSetAt: null, isActive: true, sessionVersion: 1 },
    });
  });

  afterAll(async () => {
    await purge();
    await prisma.systemConfig.deleteMany({ where: { key: SHARED_LOGIN_RETIRED_KEY } });
    await prisma.user.updateMany({
      where: { role: 'TECHNICIAN' },
      data: { accessCodeHash: null, accessCodeSetAt: null, isActive: true, sessionVersion: 1 },
    });
    await ensureTestAccessCodes();
    await stopTestServer(ts.server);
  });

  // ================= shared-code transition =================

  const cutover = (token?: string) =>
    request(ts.baseUrl).post('/api/employees/technician-cutover').set('Authorization', 'Bearer ' + (token || adminToken));

  describe('A. SETUP PERIOD — no automatic retirement ever occurs', () => {
    it('1. only the historical shared account exists -> shared code works', async () => {
      const res = await login(TEST_ACCESS_CODES.technician);
      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe('TECHNICIAN');
    });

    it('2. first individual technician WITH a code -> shared code STILL works', async () => {
      await addTechnician('Tech One', CODE_A);
      // The previous automatic rule retired HERE, permanently locking out every
      // technician who did not yet have an individual account. It must not.
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(200);
      expect((await login(CODE_A)).status).toBe(200);
    });

    it('3. second technician with NO code -> shared code works', async () => {
      await addTechnician('Tech One', CODE_A);
      await addTechnician('Tech Two');
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(200);
    });

    it('4. second technician gets a code -> shared code STILL works (no auto-retirement)', async () => {
      await addTechnician('Tech One', CODE_A);
      const b = await addTechnician('Tech Two');
      await request(ts.baseUrl).put('/api/employees/technicians/' + b.body.data.id + '/access-code')
        .set('Authorization', 'Bearer ' + adminToken).send({ newCode: CODE_B, confirmCode: CODE_B });

      // Fully configured -- but retirement is an ADMINISTRATIVE decision, never
      // an inference from the roster.
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(200);
      const flag = await prisma.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } });
      expect(flag, 'login must never write the retirement flag').toBeNull();
    });

    it('login is non-mutating: repeated shared logins never set the flag', async () => {
      await parkFixtureTechnician2();
      await addTechnician('Tech One', CODE_A);
      for (let i = 0; i < 3; i++) await login(TEST_ACCESS_CODES.technician);
      expect(await prisma.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } })).toBeNull();
    });
  });

  describe('B. CUTOVER VALIDATION (server-authoritative)', () => {
    it('5. no individual technicians -> cutover rejected', async () => {
      await parkFixtureTechnician2();
      const res = await cutover();
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('NO_INDIVIDUAL_TECHNICIANS');
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(200);
    });

    it('6. an active individual technician missing a code -> cutover rejected', async () => {
      await parkFixtureTechnician2();
      await addTechnician('Tech One', CODE_A);
      await addTechnician('Tech Two');
      const res = await cutover();
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('TECHNICIANS_WITHOUT_CODE');
      expect(res.body.techniciansWithoutCode).toBe(1);
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(200);
    });

    it('7 + 8. all configured -> Admin cutover succeeds and the flag is durably true', async () => {
      await parkFixtureTechnician2();
      await addTechnician('Tech One', CODE_A);
      const res = await cutover();
      expect(res.status).toBe(200);
      expect(res.body.data.sharedLoginRetired).toBe(true);
      const flag = await prisma.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } });
      expect(flag!.value).toBe('true');
    });

    /**
     * Cutover must never race a concurrent roster change.
     *
     * If a technician created WITHOUT a code commits between the eligibility
     * read and the flag write, the bridge closes permanently while that person
     * has no way to sign in at all. Same read-then-write shape as the S2
     * uniqueness race, and the same serializable fix.
     */
    /**
     * The interleaving that a plain (READ COMMITTED) technician INSERT allowed:
     * the insert commits alongside a cutover that never saw it, the bridge closes
     * permanently, and that technician has neither a personal code nor the shared
     * one. See runSerializedAgainstCutover() for the fix.
     *
     * WHAT THIS ASSERTS, and why it is not a coin flip. Both operations really do
     * race, so which one commits first is genuinely nondeterministic -- but under
     * a correct serialization exactly one serial ORDER is realised, and the create
     * response reports which one via `sharedLoginRetired` (the flag value the
     * insert's own transaction read). That turns an unobservable ordering into an
     * assertable one:
     *
     *   sharedLoginRetired === false -> the insert was ordered BEFORE the cutover,
     *       so the cutover MUST have seen this code-less technician and MUST be
     *       refused, and the shared bridge must still work.
     *   sharedLoginRetired === true  -> the cutover was ordered FIRST, so it may
     *       succeed and this technician legitimately exists code-less afterwards.
     *       They cannot sign in until issued a code -- correct and recoverable,
     *       unlike a bridge closed over someone the cutover never saw.
     *
     * The forbidden combination -- create says "not retired yet" while the cutover
     * committed anyway -- is precisely the non-serializable outcome, and is what
     * failed before the fix.
     */
    it('cutover cannot race a technician being added without a code', async () => {
      const sharedId = (await prisma.user.findUnique({ where: { email: sharedTechnicianEmail() } }))!.id;
      const ROUNDS = 10;

      for (let round = 0; round < ROUNDS; round++) {
        // Each round restarts from a clean pre-cutover state: this is one race
        // repeated, not ten races against accumulated roster.
        await purge();
        createdIds.length = 0;
        await prisma.systemConfig.deleteMany({ where: { key: SHARED_LOGIN_RETIRED_KEY } });
        await prisma.user.updateMany({
          where: { role: 'TECHNICIAN' },
          data: { accessCodeHash: null, accessCodeSetAt: null, isActive: true, sessionVersion: 1 },
        });
        technicianCodeLimiterStore.resetAll?.();
        authLimiterStore.resetAll?.();
        await parkFixtureTechnician2();
        // Asserted for the same reason as the reactivation round below: if this
        // setup step failed, the cutover would be refused every round for an
        // unrelated reason and the race would never actually be exercised.
        expect((await addTechnician('Tech One', CODE_A)).status, `round ${round} setup`).toBe(201);
        expect(
          await prisma.user.count({ where: { role: 'TECHNICIAN', isActive: true, accessCodeHash: null, NOT: { id: sharedId } } }),
          `round ${round} setup: no code-less active technician before the race`
        ).toBe(0);

        const [cut, late] = await Promise.all([
          cutover(),
          request(ts.baseUrl).post('/api/employees/technicians')
            .set('Authorization', 'Bearer ' + adminToken)
            .send({ name: 'Race Hire' }),
        ]);
        if (late.body?.data?.id) createdIds.push(late.body.data.id);

        const where = { round, cut: cut.status, late: late.status };
        const retired = (await prisma.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } }))?.value === 'true';
        const strandedRows = await prisma.user.findMany({
          where: { role: 'TECHNICIAN', isActive: true, accessCodeHash: null, NOT: { id: sharedId } },
          select: { id: true, name: true },
        });

        // Either side may lose the race outright (503 BUSY after the bounded
        // retries). That is a refusal, never a partial write.
        expect([201, 503], JSON.stringify(where)).toContain(late.status);
        expect([200, 409, 503], JSON.stringify(where)).toContain(cut.status);

        if (late.status === 201) {
          // Exactly one technician was created -- no duplicate from a retry that
          // re-ran the insert after its transaction had actually committed.
          expect(await prisma.user.count({ where: { name: 'Race Hire' } }), JSON.stringify(where)).toBe(1);
          const row = late.body.data;
          expect(row.hasAccessCode).toBe(false);
          expect(row.isActive).toBe(true);
          expect(row.name).toBe('Race Hire');
          // The response must never carry credential material.
          expect(row).not.toHaveProperty('accessCodeHash');
          expect(row).not.toHaveProperty('password');
          expect(row).not.toHaveProperty('sessionVersion');
          expect(typeof row.sharedLoginRetired).toBe('boolean');

          if (row.sharedLoginRetired === false) {
            // OUTCOME 1 -- creation ordered first. The cutover cannot have
            // committed from a snapshot that predates it.
            expect(retired, `cutover committed although the insert was serialized before it (${JSON.stringify(where)})`).toBe(false);
            expect(cut.status, JSON.stringify(where)).not.toBe(200);
            expect((await login(TEST_ACCESS_CODES.technician)).status, JSON.stringify(where)).toBe(200);
          } else {
            // OUTCOME 2 -- cutover ordered first; retirement is durable and the
            // new hire is code-less by construction, awaiting a personal code.
            expect(retired, JSON.stringify(where)).toBe(true);
            expect(strandedRows.map((r) => r.name), JSON.stringify(where)).toEqual(['Race Hire']);
            expect((await login(TEST_ACCESS_CODES.technician)).status, JSON.stringify(where)).toBe(401);
          }
        } else {
          // The insert was refused, so nothing can be stranded either way.
          expect(await prisma.user.count({ where: { name: 'Race Hire' } }), JSON.stringify(where)).toBe(0);
          expect(strandedRows, JSON.stringify(where)).toEqual([]);
          if (!retired) expect((await login(TEST_ACCESS_CODES.technician)).status, JSON.stringify(where)).toBe(200);
        }

        // Regardless of ordering: retirement is never undone, and the historical
        // shared account is never mutated by either operation.
        const shared = await prisma.user.findUnique({ where: { id: sharedId } });
        expect(shared!.isActive, JSON.stringify(where)).toBe(true);
        expect(shared!.accessCodeHash, JSON.stringify(where)).toBeNull();
        expect(shared!.email, JSON.stringify(where)).toBe(sharedTechnicianEmail());
        // 'Tech One' keeps the code it was created with -- the race never
        // corrupts an unrelated row.
        const one = await prisma.user.findFirst({ where: { name: 'Tech One' } });
        expect(one!.accessCodeHash, JSON.stringify(where)).not.toBeNull();
      }
    }, 180000);

    /**
     * The same race through the OTHER route that can produce an active
     * technician without a personal code: reactivating a parked one.
     */
    it('cutover cannot race a code-less technician being reactivated', async () => {
      const sharedId = (await prisma.user.findUnique({ where: { email: sharedTechnicianEmail() } }))!.id;

      for (let round = 0; round < 10; round++) {
        await purge();
        createdIds.length = 0;
        await prisma.systemConfig.deleteMany({ where: { key: SHARED_LOGIN_RETIRED_KEY } });
        await prisma.user.updateMany({
          where: { role: 'TECHNICIAN' },
          data: { accessCodeHash: null, accessCodeSetAt: null, isActive: true, sessionVersion: 1 },
        });
        technicianCodeLimiterStore.resetAll?.();
        authLimiterStore.resetAll?.();
        await parkFixtureTechnician2();
        await addTechnician('Tech One', CODE_A);
        // A code-less technician who has been parked: reactivating them is the
        // second way to break the cutover's "everyone active has a code" premise.
        const parked = await addTechnician('Tech Parked');
        // Both setup steps are asserted. If either silently failed, 'Tech Parked'
        // would stay ACTIVE and code-less, the cutover would be refused on every
        // round for that unrelated reason, and this test would pass without ever
        // exercising the race it exists for.
        expect(parked.status, `round ${round} setup: create parked technician`).toBe(201);
        const parkedId = parked.body.data.id;
        const parkRes = await request(ts.baseUrl).patch('/api/employees/technicians/' + parkedId)
          .set('Authorization', 'Bearer ' + adminToken).send({ isActive: false });
        expect(parkRes.status, `round ${round} setup: deactivate parked technician`).toBe(200);
        expect(parkRes.body.data.isActive, `round ${round} setup`).toBe(false);
        // Precondition for the race: the cutover would SUCCEED right now.
        expect(
          await prisma.user.count({ where: { role: 'TECHNICIAN', isActive: true, accessCodeHash: null, NOT: { id: sharedId } } }),
          `round ${round} setup: no code-less active technician before the race`
        ).toBe(0);

        const [cut, back] = await Promise.all([
          cutover(),
          request(ts.baseUrl).patch('/api/employees/technicians/' + parkedId)
            .set('Authorization', 'Bearer ' + adminToken).send({ isActive: true }),
        ]);

        const where = { round, cut: cut.status, back: back.status };
        const retired = (await prisma.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } }))?.value === 'true';
        const stranded = await prisma.user.count({
          where: { role: 'TECHNICIAN', isActive: true, accessCodeHash: null, NOT: { id: sharedId } },
        });

        expect([200, 503], JSON.stringify(where)).toContain(back.status);
        expect([200, 409, 503], JSON.stringify(where)).toContain(cut.status);

        if (back.status === 200) {
          // Same ordering witness as the creation race: the flag value the
          // reactivation's own transaction read.
          expect(typeof back.body.data.sharedLoginRetired).toBe('boolean');
          expect(back.body.data.isActive).toBe(true);
          expect(back.body.data.hasAccessCode).toBe(false);
          expect(back.body.data).not.toHaveProperty('accessCodeHash');

          if (back.body.data.sharedLoginRetired === false) {
            // Reactivation ordered FIRST, so the cutover could only have been
            // ordered after it -- where it MUST see an active technician with no
            // code and refuse. A committed cutover here is the non-serializable
            // outcome this test exists to forbid.
            expect(retired, `cutover committed although the reactivation was serialized before it (${JSON.stringify(where)})`).toBe(false);
            expect(cut.status, JSON.stringify(where)).not.toBe(200);
            expect(stranded, JSON.stringify(where)).toBe(1);
            expect((await login(TEST_ACCESS_CODES.technician)).status, JSON.stringify(where)).toBe(200);
          } else {
            // Cutover ordered first: retirement is durable, and this technician
            // is code-less by their own history rather than by a lost update.
            expect(retired, JSON.stringify(where)).toBe(true);
            expect(stranded, JSON.stringify(where)).toBe(1);
            expect((await login(TEST_ACCESS_CODES.technician)).status, JSON.stringify(where)).toBe(401);
          }
          // Either way the reactivation never invents a credential.
          const row = await prisma.user.findUnique({ where: { id: parkedId } });
          expect(row!.accessCodeHash, JSON.stringify(where)).toBeNull();
          expect(row!.isActive, JSON.stringify(where)).toBe(true);
        } else {
          // The reactivation was refused outright: the technician stays parked,
          // so nothing is stranded whichever way the cutover went.
          expect(stranded, JSON.stringify(where)).toBe(0);
          expect((await prisma.user.findUnique({ where: { id: parkedId } }))!.isActive, JSON.stringify(where)).toBe(false);
        }

        const shared = await prisma.user.findUnique({ where: { id: sharedId } });
        expect(shared!.isActive, JSON.stringify(where)).toBe(true);
        expect(shared!.accessCodeHash, JSON.stringify(where)).toBeNull();
      }
    }, 180000);

    it('an inactive technician without a code does not block cutover', async () => {
      await parkFixtureTechnician2();
      await addTechnician('Tech One', CODE_A);
      const gone = await addTechnician('Tech Gone');
      await request(ts.baseUrl).patch('/api/employees/technicians/' + gone.body.data.id)
        .set('Authorization', 'Bearer ' + adminToken).send({ isActive: false });
      expect((await cutover()).status).toBe(200);
    });
  });

  describe('C. PERMANENCE — retirement is one-way', () => {
    async function reachCutover() {
      await parkFixtureTechnician2();
      const a = await addTechnician('Tech One', CODE_A);
      expect((await cutover()).status).toBe(200);
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(401);
      return a;
    }

    it('9. after cutover the shared login is 401', async () => {
      await reachCutover();
      const res = await login(TEST_ACCESS_CODES.technician);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid code');
    });

    it('10. adding a new technician without a code does NOT reopen it', async () => {
      await reachCutover();
      await addTechnician('Tech Four');
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(401);
    });

    it('11 + 12. deactivating then reactivating a technician does NOT reopen it', async () => {
      const a = await reachCutover();
      const id = a.body.data.id;
      await request(ts.baseUrl).patch('/api/employees/technicians/' + id)
        .set('Authorization', 'Bearer ' + adminToken).send({ isActive: false });
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(401);

      // Reactivated with the credential cleared -- the worst case for any
      // roster-derived rule.
      await prisma.user.update({ where: { id }, data: { accessCodeHash: null, accessCodeSetAt: null } });
      await request(ts.baseUrl).patch('/api/employees/technicians/' + id)
        .set('Authorization', 'Bearer ' + adminToken).send({ isActive: true });
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(401);
    });

    it('13. changing a technician code does NOT reopen it', async () => {
      const a = await reachCutover();
      await request(ts.baseUrl).put('/api/employees/technicians/' + a.body.data.id + '/access-code')
        .set('Authorization', 'Bearer ' + adminToken).send({ newCode: CODE_C, confirmCode: CODE_C });
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(401);
      expect((await login(CODE_C)).status).toBe(200);
    });

    it('14. a repeated cutover request is idempotent and stays retired', async () => {
      await reachCutover();
      const again = await cutover();
      expect(again.status).toBe(200);
      expect(again.body.data.alreadyRetired).toBe(true);
      expect((await prisma.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } }))!.value).toBe('true');
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(401);
    });

    it('15. no supported API can reactivate the shared login', async () => {
      await reachCutover();
      // Attempting to unset it through the purpose-built action -- the body is
      // ignored entirely, the server decides what is written.
      const attempt = await request(ts.baseUrl).post('/api/employees/technician-cutover')
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ retired: false, sharedLoginRetired: false, value: 'false' });
      expect(attempt.status).toBe(200);
      expect(attempt.body.data.sharedLoginRetired).toBe(true);

      // And through department code rotation, which has no access to this flag.
      await request(ts.baseUrl).put('/api/config/access-codes')
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ dept: 'technician', currentCode: TEST_ACCESS_CODES.technician, newCode: '7777', confirmCode: '7777' });

      expect((await prisma.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } }))!.value).toBe('true');
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(401);
      expect((await login('7777')).status).toBe(401);
    });
  });

  describe('D. AUTHORIZATION on cutover', () => {
    beforeEach(async () => {
      await parkFixtureTechnician2();
      await addTechnician('Tech One', CODE_A);
    });

    it('16. SCHEDULING cannot perform cutover', async () => {
      expect((await cutover(schedToken)).status).toBe(403);
      expect(await prisma.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } })).toBeNull();
    });

    it('17. a TECHNICIAN cannot perform cutover', async () => {
      const techTok = (await login(CODE_A)).body.data.token;
      expect((await cutover(techTok)).status).toBe(403);
      expect(await prisma.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } })).toBeNull();
    });

    it('18. an unauthenticated caller cannot perform cutover', async () => {
      const res = await request(ts.baseUrl).post('/api/employees/technician-cutover');
      expect(res.status).toBe(401);
      expect(await prisma.systemConfig.findUnique({ where: { key: SHARED_LOGIN_RETIRED_KEY } })).toBeNull();
    });
  });

  describe('E. LEGACY ACCOUNT is not an employee', () => {
    it('19 + 20. it never appears in the employee list, nor in employee counts', async () => {
      // Park the OTHER fixture technician so the only code-less individual left
      // would be the legacy account -- if it were counted, this would show 1.
      await parkFixtureTechnician2();
      await addTechnician('Real One', CODE_A);
      const list = await request(ts.baseUrl).get('/api/employees/technicians').set('Authorization', 'Bearer ' + adminToken);
      expect(list.status).toBe(200);

      const legacy = await prisma.user.findUnique({ where: { email: sharedTechnicianEmail() } });
      expect(list.body.data.some((e: any) => e.id === legacy!.id)).toBe(false);

      // Nor as a technician "awaiting code setup" -- it never has a personal code.
      const status = await request(ts.baseUrl).get('/api/employees/technician-migration').set('Authorization', 'Bearer ' + adminToken);
      expect(status.body.data.techniciansWithoutCode).toBe(0);
      expect(status.body.data.canCompleteCutover).toBe(true);
    });

    it('the legacy account cannot be renamed, deactivated, or given a code through Employees', async () => {
      const legacy = await prisma.user.findUnique({ where: { email: sharedTechnicianEmail() } });
      const id = legacy!.id;

      expect((await request(ts.baseUrl).patch('/api/employees/technicians/' + id)
        .set('Authorization', 'Bearer ' + adminToken).send({ name: 'Hijacked' })).status).toBe(404);
      expect((await request(ts.baseUrl).patch('/api/employees/technicians/' + id)
        .set('Authorization', 'Bearer ' + adminToken).send({ isActive: false })).status).toBe(404);
      expect((await request(ts.baseUrl).put('/api/employees/technicians/' + id + '/access-code')
        .set('Authorization', 'Bearer ' + adminToken).send({ newCode: CODE_C, confirmCode: CODE_C })).status).toBe(404);

      const after = await prisma.user.findUnique({ where: { id } });
      // Restored defensively BEFORE asserting. If the guard ever regresses, this
      // test must fail loudly on its own rather than leaving a renamed/disabled
      // shared account behind to corrupt every later suite -- ensureTestUsers
      // upserts with `update: {}` and would not repair it.
      await prisma.user.update({
        where: { id },
        data: { name: legacy!.name, isActive: legacy!.isActive, accessCodeHash: null, accessCodeSetAt: null },
      });

      expect(after!.name).toBe(legacy!.name);
      expect(after!.isActive).toBe(true);
      expect(after!.accessCodeHash).toBeNull();
    });

    it('21. the historical row and its foreign keys survive cutover', async () => {
      const legacy = await prisma.user.findUnique({ where: { email: sharedTechnicianEmail() } });
      const cust = await prisma.customer.create({
        data: { name: 'Legacy FK ' + Date.now(), phone: '0500000000', maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1 },
      });
      const appt = await prisma.appointment.create({
        data: { customerId: cust.id, type: 'MAINTENANCE', scheduledDate: new Date(), technicianId: legacy!.id },
      });

      await parkFixtureTechnician2();
      await addTechnician('Tech One', CODE_A);
      expect((await cutover()).status).toBe(200);

      const stillThere = await prisma.user.findUnique({ where: { email: sharedTechnicianEmail() } });
      expect(stillThere).not.toBeNull();
      const linked = await prisma.appointment.findUnique({ where: { id: appt.id }, include: { technician: { select: { id: true } } } });
      expect(linked!.technician!.id).toBe(legacy!.id);

      await prisma.appointment.delete({ where: { id: appt.id } });
      await prisma.customer.delete({ where: { id: cust.id } });
    });
  });

  describe('F. INDIVIDUAL ACCESS across the transition', () => {
    it('22 + 23. personal codes work before AND after cutover', async () => {
      await parkFixtureTechnician2();
      const a = await addTechnician('Tech One', CODE_A);
      expect((await login(CODE_A)).body.data.user.id).toBe(a.body.data.id);
      expect((await cutover()).status).toBe(200);
      expect((await login(CODE_A)).body.data.user.id).toBe(a.body.data.id);
    });

    it('24. a technician added AFTER cutover signs in once Admin gives them a code', async () => {
      await parkFixtureTechnician2();
      await addTechnician('Tech One', CODE_A);
      expect((await cutover()).status).toBe(200);

      const late = await addTechnician('Late Hire');
      // No code yet -- and the shared login is NOT a fallback for them.
      expect((await login(TEST_ACCESS_CODES.technician)).status).toBe(401);

      await request(ts.baseUrl).put('/api/employees/technicians/' + late.body.data.id + '/access-code')
        .set('Authorization', 'Bearer ' + adminToken).send({ newCode: CODE_B, confirmCode: CODE_B });

      const login2 = await login(CODE_B);
      expect(login2.status).toBe(200);
      expect(login2.body.data.user.id).toBe(late.body.data.id);
    });
  });

  // ================= session revocation (D9) =================

  describe('session revocation', () => {
    async function makeAppointmentFor(technicianId: string) {
      const cust = await prisma.customer.create({
        data: { name: `Rev ${Date.now()}-${Math.random()}`, phone: '0500000000', maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1 },
      });
      const appt = await prisma.appointment.create({
        data: { customerId: cust.id, type: 'MAINTENANCE', scheduledDate: new Date(), workStatus: 'WAITING', technicianId, isUrgent: false },
      });
      return { custId: cust.id, apptId: appt.id };
    }

    it('deactivation invalidates an already-issued token for protected requests', async () => {
      const tech = await addTechnician('Revoke Me', CODE_A);
      const token = (await login(CODE_A)).body.data.token;

      // Works before deactivation.
      expect((await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${token}`)).status).toBe(200);

      await request(ts.baseUrl)
        .patch(`/api/employees/technicians/${tech.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      // The SAME token is now refused, generically.
      const after = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${token}`);
      expect(after.status).toBe(401);
      expect(after.body.message).toBe('Invalid token');
    });

    it('a deactivated technician cannot mutate an appointment with their old token', async () => {
      const tech = await addTechnician('Revoke Me', CODE_A);
      const token = (await login(CODE_A)).body.data.token;
      const { apptId, custId } = await makeAppointmentFor(tech.body.data.id);

      await request(ts.baseUrl)
        .patch(`/api/employees/technicians/${tech.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      for (const path of ['start', 'postpone', 'no-answer']) {
        const res = await request(ts.baseUrl)
          .patch(`/api/appointments/${apptId}/${path}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ newDate: new Date().toISOString(), note: 'x' });
        expect(res.status).toBe(401);
      }

      // Nothing was written.
      const appt = await prisma.appointment.findUnique({ where: { id: apptId } });
      expect(appt!.workStatus).toBe('WAITING');
      expect(await prisma.customerNoAnswerRecord.count({ where: { appointmentId: apptId } })).toBe(0);

      await prisma.appointment.delete({ where: { id: apptId } });
      await prisma.customer.delete({ where: { id: custId } });
    });

    it('a deactivated technician cannot log in again', async () => {
      const tech = await addTechnician('Revoke Me', CODE_A);
      await request(ts.baseUrl)
        .patch(`/api/employees/technicians/${tech.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      const res = await login(CODE_A);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid code');
    });

    it('a deactivated technician cannot establish a socket connection with the old token', async () => {
      const tech = await addTechnician('Revoke Me', CODE_A);
      const token = (await login(CODE_A)).body.data.token;

      // Connects fine while active.
      const okSocket: Socket = ioClient(ts.baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false });
      await new Promise<void>((resolve, reject) => {
        okSocket.on('connect', () => resolve());
        okSocket.on('connect_error', (e) => reject(e));
        setTimeout(() => reject(new Error('socket connect timeout')), 8000);
      });
      okSocket.disconnect();

      await request(ts.baseUrl)
        .patch(`/api/employees/technicians/${tech.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      // Reconnect with the same token is refused at the handshake.
      const denied: Socket = ioClient(ts.baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false });
      const err = await new Promise<Error>((resolve, reject) => {
        denied.on('connect_error', (e) => resolve(e as Error));
        denied.on('connect', () => reject(new Error('socket should NOT have connected')));
        setTimeout(() => reject(new Error('expected connect_error')), 8000);
      });
      expect(String(err.message)).toContain('Invalid token');
      denied.disconnect();
    }, 20000);

    it('reactivation requires a fresh login — the pre-deactivation token stays dead', async () => {
      const tech = await addTechnician('Revoke Me', CODE_A);
      const oldToken = (await login(CODE_A)).body.data.token;
      const id = tech.body.data.id;

      await request(ts.baseUrl).patch(`/api/employees/technicians/${id}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ isActive: false });
      await request(ts.baseUrl).patch(`/api/employees/technicians/${id}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ isActive: true });

      // Reactivation must NOT resurrect the old session.
      const revived = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${oldToken}`);
      expect(revived.status).toBe(401);

      // A fresh login works and yields a usable token.
      const fresh = await login(CODE_A);
      expect(fresh.status).toBe(200);
      const ok = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${fresh.body.data.token}`);
      expect(ok.status).toBe(200);
    });

    it('TRANSITIONAL: a token minted without an `sv` claim still works, but only while the account is active', async () => {
      const tech = await addTechnician('Legacy Token', CODE_A);
      // signTestToken deliberately mints the pre-D9 payload shape { userId, role }.
      const legacyToken = signTestToken(tech.body.data.id, 'TECHNICIAN');

      expect((await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${legacyToken}`)).status).toBe(200);

      await request(ts.baseUrl).patch(`/api/employees/technicians/${tech.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ isActive: false });

      // Deactivation is still enforced for claim-less tokens.
      expect((await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${legacyToken}`)).status).toBe(401);
    });

    it('a forged sessionVersion cannot bypass the middleware', async () => {
      const tech = await addTechnician('Forger', CODE_A);
      const token = (await login(CODE_A)).body.data.token;
      await request(ts.baseUrl).patch(`/api/employees/technicians/${tech.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ isActive: false });

      // Tamper with the payload without a valid signature.
      const [h, p, sig] = token.split('.');
      const claims = JSON.parse(Buffer.from(p, 'base64').toString());
      claims.sv = 999;
      const forged = `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`;

      const res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it('ADMIN and SCHEDULING sessions are unaffected by technician revocation', async () => {
      const tech = await addTechnician('Revoke Me', CODE_A);
      await request(ts.baseUrl).patch(`/api/employees/technicians/${tech.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ isActive: false });

      expect((await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
      expect((await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${schedToken}`)).status).toBe(200);
    });
  });

  // ================= access-code reset =================

  describe('access-code reset', () => {
    it('resets the credential and ends the session established with the old code', async () => {
      const tech = await addTechnician('Reset Me', CODE_A);
      const oldToken = (await login(CODE_A)).body.data.token;
      expect((await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${oldToken}`)).status).toBe(200);

      const reset = await request(ts.baseUrl)
        .put(`/api/employees/technicians/${tech.body.data.id}/access-code`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newCode: CODE_C, confirmCode: CODE_C });
      expect(reset.status).toBe(200);

      // Old code rejected, new code accepted.
      expect((await login(CODE_A)).status).toBe(401);
      const fresh = await login(CODE_C);
      expect(fresh.status).toBe(200);
      expect(fresh.body.data.user.id).toBe(tech.body.data.id);

      // And the session created with the OLD code is dead.
      expect((await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${oldToken}`)).status).toBe(401);
    });
  });

  // ================= authorization =================

  describe('authorization on deactivate/reactivate', () => {
    it('ADMIN can deactivate and reactivate', async () => {
      const tech = await addTechnician('Toggle', CODE_A);
      const id = tech.body.data.id;
      expect((await request(ts.baseUrl).patch(`/api/employees/technicians/${id}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ isActive: false })).status).toBe(200);
      expect((await request(ts.baseUrl).patch(`/api/employees/technicians/${id}`)
        .set('Authorization', `Bearer ${adminToken}`).send({ isActive: true })).status).toBe(200);
    });

    it('SCHEDULING and another TECHNICIAN cannot deactivate', async () => {
      const victim = await addTechnician('Victim', CODE_A);
      const other = await addTechnician('Other', CODE_B);
      const otherToken = (await login(CODE_B)).body.data.token;

      for (const tok of [schedToken, otherToken]) {
        const res = await request(ts.baseUrl)
          .patch(`/api/employees/technicians/${victim.body.data.id}`)
          .set('Authorization', `Bearer ${tok}`)
          .send({ isActive: false });
        expect(res.status).toBe(403);
      }
      const still = await prisma.user.findUnique({ where: { id: victim.body.data.id } });
      expect(still!.isActive).toBe(true);
    });
  });

  // ================= credential-hash exposure =================

  describe('technician credential hashes never leave the server', () => {
    /**
     * REGRESSION GUARD for a real HIGH-severity leak found in security review.
     *
     * Prisma's `include: { technician: true }` loads EVERY scalar column of the
     * related user row, so adding `accessCodeHash` to the User model silently
     * published it through every appointment endpoint and socket payload that
     * embedded the technician -- including ones a TECHNICIAN can call. A 4-digit
     * code's bcrypt hash can be exhausted offline in seconds, so a technician
     * could have recovered a colleague's code and authenticated as them,
     * defeating both the rate limiter and the whole attribution model.
     *
     * These assert the ABSENCE of the fields, which is what must never regress.
     */
    async function seedAppointmentWithTechnician() {
      const tech = await addTechnician('Hash Leak Probe', CODE_A);
      const cust = await prisma.customer.create({
        data: { name: `Leak ${Date.now()}`, phone: '0500000000', maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1 },
      });
      const appt = await prisma.appointment.create({
        data: { customerId: cust.id, type: 'MAINTENANCE', scheduledDate: new Date(), technicianId: tech.body.data.id, isUrgent: true, visibleToTechnician: true },
      });
      return { techId: tech.body.data.id, custId: cust.id, apptId: appt.id };
    }

    function assertNoCredentials(payload: string, label: string) {
      expect(payload, `${label} leaked accessCodeHash`).not.toContain('accessCodeHash');
      expect(payload, `${label} leaked password`).not.toContain('"password"');
      expect(payload, `${label} leaked sessionVersion`).not.toContain('sessionVersion');
      expect(payload, `${label} leaked a bcrypt hash`).not.toMatch(/\$2[aby]\$/);
    }

    it('no appointment endpoint exposes a technician credential hash, to ANY role', async () => {
      const { apptId, custId, techId } = await seedAppointmentWithTechnician();
      const techToken = (await login(CODE_A)).body.data.token;

      const responses: Array<[string, any]> = [
        ['GET /appointments (technician)', await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${techToken}`)],
        ['GET /appointments?urgent=true (technician)', await request(ts.baseUrl).get('/api/appointments').query({ urgent: 'true' }).set('Authorization', `Bearer ${techToken}`)],
        ['GET /appointments/:id (technician)', await request(ts.baseUrl).get(`/api/appointments/${apptId}`).set('Authorization', `Bearer ${techToken}`)],
        ['GET /appointments (admin)', await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${adminToken}`)],
        ['GET /dashboard/urgent (admin)', await request(ts.baseUrl).get('/api/dashboard/urgent').set('Authorization', `Bearer ${adminToken}`)],
        ['GET /dashboard/urgent (scheduling)', await request(ts.baseUrl).get('/api/dashboard/urgent').set('Authorization', `Bearer ${schedToken}`)],
      ];

      for (const [label, res] of responses) {
        assertNoCredentials(JSON.stringify(res.body), label);
      }

      // The technician object is still present and still useful -- the fix is a
      // narrower projection, not removal.
      const admin = await request(ts.baseUrl).get('/api/dashboard/urgent').set('Authorization', `Bearer ${adminToken}`);
      const row = admin.body.data.find((a: any) => a.id === apptId);
      expect(row.technician.id).toBe(techId);
      expect(row.technician.name).toBe('Hash Leak Probe');

      await prisma.appointment.delete({ where: { id: apptId } });
      await prisma.customer.delete({ where: { id: custId } });
    });

    it('the sales report does not expose technician or submitter credentials', async () => {
      const { apptId, custId } = await seedAppointmentWithTechnician();
      await prisma.appointment.update({
        where: { id: apptId },
        data: { isUrgent: false, workStatus: 'COMPLETED', completionAmount: 100, completionPaymentMethod: 'CASH' },
      });

      const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const res = await request(ts.baseUrl).get('/api/reports/sales').query({ from, to }).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      assertNoCredentials(JSON.stringify(res.body), 'GET /reports/sales');

      await prisma.appointment.delete({ where: { id: apptId } });
      await prisma.customer.delete({ where: { id: custId } });
    });
  });

  // ================= rate limiting (D8) =================

  describe('technician code-login rate limiting', () => {
    // Deliberately ONE test rather than two. The pre-existing generic auth
    // limiter (50 requests / 15 min per IP, unchanged by this work) is shared by
    // every /api/auth call, so a second test that re-exhausted the technician
    // budget would push this file's total auth traffic past that generic cap and
    // fail for a reason that has nothing to do with the behaviour under test.
    it('limits repeated FAILED technician attempts, stays generic, and does not scope-leak to other departments', async () => {
      await addTechnician('Rate Target', CODE_A);

      // Other departments work before the technician budget is touched.
      expect((await request(ts.baseUrl).post('/api/auth/code-login')
        .send({ code: TEST_ACCESS_CODES.admin, dept: 'admin' })).status).toBe(200);

      const statuses: number[] = [];
      const messages = new Set<string>();
      for (let i = 0; i < 12; i++) {
        const res = await login('9999'); // never valid
        statuses.push(res.status);
        messages.add(res.body?.message);
      }

      // Ordinary rejections first, then the limiter engages.
      expect(statuses.filter((s) => s === 401).length).toBeGreaterThan(0);
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
      // The limiter must engage well inside the 10,000-code space -- that is the
      // entire point of layering it over a 4-digit credential (decision D8).
      expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(10);

      // No response ever reveals whether the submitted code belonged to nobody,
      // an inactive technician, or the legacy shared identity.
      for (const m of messages) {
        expect(['Invalid code', 'Too many attempts, try again later']).toContain(m);
      }

      // The technician budget is now exhausted...
      expect((await login('9999')).status).toBe(429);

      // ...but Administration and Scheduling are scoped out of that limiter
      // entirely and are still served.
      expect((await request(ts.baseUrl).post('/api/auth/code-login')
        .send({ code: TEST_ACCESS_CODES.admin, dept: 'admin' })).status).toBe(200);
      expect((await request(ts.baseUrl).post('/api/auth/code-login')
        .send({ code: TEST_ACCESS_CODES.scheduling, dept: 'scheduling' })).status).toBe(200);
    }, 30000);
  });
});
