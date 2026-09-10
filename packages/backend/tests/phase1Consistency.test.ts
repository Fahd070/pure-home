// Phase 1 closure: S2 (technician access-code uniqueness under concurrency) and
// C9 (appointment completion + maintenance-due recalculation atomicity).
//
// Access codes here are TEST-ONLY fixture values created against the disposable
// test database.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers, testPhone, uniqueSuffix } from './helpers/fixtures';
import prisma from '../src/prisma';
import { authLimiterStore, technicianCodeLimiterStore } from '../src/app';

describe('S2 — technician access-code uniqueness under concurrency', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string;
  const createdIds: string[] = [];

  // Retried because routes/auth.ts writes its login audit entry fire-and-forget
  // (deliberately, so login is never blocked by the audit write). These tests log
  // in, so that INSERT can land just after the response was asserted and race the
  // cleanup's user delete, which the audit_logs foreign key then refuses.
  async function purge() {
    if (!createdIds.length) return;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await prisma.auditLog.deleteMany({ where: { userId: { in: createdIds } } });
        await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
        createdIds.length = 0;
        return;
      } catch (e) {
        if (attempt === 4) throw e;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }

  /** A technician with NO code, so both racers start from the same state. */
  async function makeTechnician(name: string) {
    const res = await request(ts.baseUrl)
      .post('/api/employees/technicians')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name });
    expect(res.status).toBe(201);
    createdIds.push(res.body.data.id);
    return res.body.data.id as string;
  }

  const setCode = (id: string, code: string) =>
    request(ts.baseUrl)
      .put(`/api/employees/technicians/${id}/access-code`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newCode: code, confirmCode: code });

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
  });

  beforeEach(async () => {
    await purge();
    await prisma.user.updateMany({ where: { role: 'TECHNICIAN' }, data: { accessCodeHash: null, accessCodeSetAt: null } });
    authLimiterStore.resetAll?.();
    technicianCodeLimiterStore.resetAll?.();
  });

  afterAll(async () => {
    await purge();
    await prisma.user.updateMany({ where: { role: 'TECHNICIAN' }, data: { accessCodeHash: null, accessCodeSetAt: null } });
    await stopTestServer(ts.server);
  });

  /**
   * THE RACE, run for real.
   *
   * Two different technicians, one code, both requests fired without awaiting
   * the first. Under the old check-then-write both could observe "not taken" and
   * both commit, leaving two people sharing a credential and login resolving
   * deterministically to whichever was created first -- silently attributing one
   * technician's work to the other, forever, with no error.
   *
   * Repeated, because a single pass proves nothing about a race: one green run
   * could simply be lucky scheduling.
   */
  const ROUNDS = 6;
  for (let round = 1; round <= ROUNDS; round++) {
    it(`round ${round}/${ROUNDS}: exactly ONE of two concurrent assignments of the same code succeeds`, async () => {
      const code = String(6000 + round).padStart(4, '0');
      const a = await makeTechnician(`Racer A ${uniqueSuffix()}`);
      const b = await makeTechnician(`Racer B ${uniqueSuffix()}`);

      const [resA, resB] = await Promise.all([setCode(a, code), setCode(b, code)]);
      const statuses = [resA.status, resB.status].sort();

      // Exactly one winner. The loser is refused safely -- either the uniqueness
      // conflict or, if the database aborted its transaction, a retryable 503.
      // Never two 200s.
      const successes = [resA, resB].filter((r) => r.status === 200);
      expect(successes, `both assignments succeeded: ${JSON.stringify(statuses)}`).toHaveLength(1);
      const loser = [resA, resB].find((r) => r.status !== 200)!;
      expect([409, 503]).toContain(loser.status);

      // INVARIANT: at most one technician holds that code.
      const rows = await prisma.user.findMany({
        where: { id: { in: [a, b] } },
        select: { id: true, accessCodeHash: true },
      });
      const holders: string[] = [];
      for (const r of rows) {
        if (r.accessCodeHash && (await bcrypt.compare(code, r.accessCodeHash))) holders.push(r.id);
      }
      expect(holders, 'more than one technician ended up holding the same code').toHaveLength(1);

      // And login is unambiguous: the code authenticates exactly the holder.
      const login = await request(ts.baseUrl).post('/api/auth/code-login').send({ code, dept: 'technician' });
      expect(login.status).toBe(200);
      expect(login.body.data.user.id).toBe(holders[0]);

      // The loser did not silently receive the credential.
      const loserId = holders[0] === a ? b : a;
      const loserRow = rows.find((r) => r.id === loserId)!;
      if (loserRow.accessCodeHash) {
        expect(await bcrypt.compare(code, loserRow.accessCodeHash)).toBe(false);
      }
    }, 30000);
  }

  it('a concurrent CREATE-with-code and RESET of the same code cannot both win', async () => {
    // Both assignment paths share one concurrency-safe service, so the race is
    // covered across paths and not just within one of them.
    const code = '6099';
    const existing = await makeTechnician(`Existing ${uniqueSuffix()}`);

    const [createRes, resetRes] = await Promise.all([
      request(ts.baseUrl).post('/api/employees/technicians')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Fresh ${uniqueSuffix()}`, accessCode: code }),
      setCode(existing, code),
    ]);
    if (createRes.body?.data?.id) createdIds.push(createRes.body.data.id);

    const successes = [createRes, resetRes].filter((r) => r.status === 200 || r.status === 201);
    expect(successes).toHaveLength(1);

    const all = await prisma.user.findMany({ where: { role: 'TECHNICIAN', accessCodeHash: { not: null } }, select: { id: true, accessCodeHash: true } });
    const holders: string[] = [];
    for (const r of all) if (r.accessCodeHash && (await bcrypt.compare(code, r.accessCodeHash))) holders.push(r.id);
    expect(holders).toHaveLength(1);
  }, 30000);

  it('a failed create-with-code leaves no half-created employee behind', async () => {
    const code = '6098';
    const first = await makeTechnician(`Holder ${uniqueSuffix()}`);
    expect((await setCode(first, code)).status).toBe(200);

    const before = await prisma.user.count({ where: { role: 'TECHNICIAN' } });
    const res = await request(ts.baseUrl).post('/api/employees/technicians')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Should Not Exist', accessCode: code });
    expect(res.status).toBe(409);

    // The admin asked for "this person WITH this code" as one action; refusing
    // the code must not leave the person behind.
    expect(await prisma.user.count({ where: { role: 'TECHNICIAN' } })).toBe(before);
    expect(await prisma.user.findFirst({ where: { name: 'Should Not Exist' } })).toBeNull();
  });

  it('re-assigning a technician their own current code still succeeds', async () => {
    const id = await makeTechnician(`Self ${uniqueSuffix()}`);
    expect((await setCode(id, '6097')).status).toBe(200);
    expect((await setCode(id, '6097')).status).toBe(200);
  });
});

describe('C9 — completion and maintenance-due recalculation are atomic', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, techToken: string;
  const customerIds: string[] = [];

  async function makeInProgressAppointment(installationDate: Date) {
    const c = await prisma.customer.create({
      data: {
        name: `C9 ${uniqueSuffix()}`, phone: testPhone(),
        maintenanceCycle: 'MONTHLY', maintenanceFrequency: 3,
        installationDate,
      },
    });
    customerIds.push(c.id);
    const a = await prisma.appointment.create({
      data: {
        customerId: c.id, type: 'MAINTENANCE', scheduledDate: new Date(),
        workStatus: 'IN_PROGRESS', technicianId: users.technician.id, isUrgent: false,
      },
    });
    return { customerId: c.id, appointmentId: a.id };
  }

  const completeBody = (actualCompletionDate: string) => ({
    serviceDetails: 'Filter replaced',
    completionAmount: 250,
    completionPaymentMethod: 'CASH',
    actualCompletionDate,
  });

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await stopTestServer(ts.server);
  });

  it('SUCCESS PATH: completion and the new due date land together and are readable immediately', async () => {
    const { customerId, appointmentId } = await makeInProgressAppointment(new Date('2020-01-15'));

    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appointmentId}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send(completeBody('2026-06-11'));
    expect(res.status).toBe(200);

    const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appt!.workStatus).toBe('COMPLETED');
    expect(appt!.actualCompletionDate!.toISOString().slice(0, 10)).toBe('2026-06-11');

    // Derived from the completion that just committed -- 11 June + 3 months.
    const cust = await prisma.customer.findUnique({ where: { id: customerId }, select: { nextMaintenanceDueAt: true } });
    expect(cust!.nextMaintenanceDueAt!.toISOString().slice(0, 10)).toBe('2026-09-11');

    // And a subsequent GET reads the same value, not a stale one.
    const detail = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(String(detail.body.data.nextMaintenanceDueAt).slice(0, 10)).toBe('2026-09-11');
  });

  /**
   * FAULT INJECTION at the smallest available boundary.
   *
   * The due-date write is forced to fail by making the customer row unreachable
   * to the recalculation's UPDATE from inside the transaction -- a deferred
   * foreign-key-free approach is not available here, so the failure is injected
   * through the database itself with a constraint the recalculation write must
   * violate. Production code is NOT weakened to make this testable: the trigger
   * is created and dropped entirely within the test.
   */
  it('ROLLBACK: if the due-date write fails, the completion does NOT commit', async () => {
    const { customerId, appointmentId } = await makeInProgressAppointment(new Date('2020-01-15'));

    const before = await prisma.customer.findUnique({ where: { id: customerId }, select: { nextMaintenanceDueAt: true } });

    // Fail ONLY the recalculation's write, and only for this customer.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION c9_block_due_write() RETURNS trigger AS $$
      BEGIN
        IF NEW."nextMaintenanceDueAt" IS DISTINCT FROM OLD."nextMaintenanceDueAt" THEN
          RAISE EXCEPTION 'c9 injected failure';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER c9_block_due
      BEFORE UPDATE ON customers FOR EACH ROW
      WHEN (OLD.id = '${customerId}')
      EXECUTE FUNCTION c9_block_due_write();
    `);

    try {
      const res = await request(ts.baseUrl)
        .patch(`/api/appointments/${appointmentId}/complete`)
        .set('Authorization', `Bearer ${techToken}`)
        .send(completeBody('2026-06-11'));

      // The request must fail rather than report a completion it did not durably make.
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS c9_block_due ON customers;`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS c9_block_due_write();`);
    }

    // NEITHER domain mutation committed.
    const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appt!.workStatus, 'appointment must not remain completed').toBe('IN_PROGRESS');
    expect(appt!.completedAt).toBeNull();
    expect(appt!.actualCompletionDate).toBeNull();

    const after = await prisma.customer.findUnique({ where: { id: customerId }, select: { nextMaintenanceDueAt: true, activityDismissed: true } });
    expect(after!.nextMaintenanceDueAt).toEqual(before!.nextMaintenanceDueAt);

    // And the operation is retryable once the fault clears -- no wedged state.
    const retry = await request(ts.baseUrl)
      .patch(`/api/appointments/${appointmentId}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send(completeBody('2026-06-11'));
    expect(retry.status).toBe(200);
    const healed = await prisma.customer.findUnique({ where: { id: customerId }, select: { nextMaintenanceDueAt: true } });
    expect(healed!.nextMaintenanceDueAt!.toISOString().slice(0, 10)).toBe('2026-09-11');
  }, 30000);

  it('deleting a completed appointment rolls the due date back atomically', async () => {
    const { customerId, appointmentId } = await makeInProgressAppointment(new Date('2020-01-15'));
    await request(ts.baseUrl)
      .patch(`/api/appointments/${appointmentId}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send(completeBody('2026-06-11'));

    const withCompletion = await prisma.customer.findUnique({ where: { id: customerId }, select: { nextMaintenanceDueAt: true } });
    expect(withCompletion!.nextMaintenanceDueAt!.toISOString().slice(0, 10)).toBe('2026-09-11');

    const del = await request(ts.baseUrl).delete(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);

    // The completion is gone, so the due date must fall back to the installation
    // baseline rather than keep pointing at a completion that no longer exists.
    const afterDelete = await prisma.customer.findUnique({ where: { id: customerId }, select: { nextMaintenanceDueAt: true } });
    expect(afterDelete!.nextMaintenanceDueAt!.toISOString().slice(0, 10)).toBe('2020-04-15');
  });
});
