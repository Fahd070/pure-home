// Regression coverage for Issue #7: server-side protection on bulk/mass-delete
// endpoints. The backend protection itself is the security boundary under test here
// -- every request below is a crafted, direct API call (no frontend involved),
// proving the frontend confirmation dialog cannot be the only thing standing between
// a request and mass deletion.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, uniqueSuffix, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Bulk delete protection', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    // Defensive final sweep: several tests intentionally leave rows behind when a
    // delete attempt is expected to fail (proving nothing was deleted). Clear them so
    // this file never leaks state into any test file that runs after it.
    await prisma.callReport.deleteMany();
    await prisma.customer.deleteMany();
    await stopTestServer(ts.server);
  });

  async function createCustomer(name: string) {
    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name, phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1,
        address: { city: 'Riyadh', district: 'Test', street: 'Test' },
      });
    return res.body.data.id as string;
  }

  async function createCallReport(label: string) {
    const res = await request(ts.baseUrl)
      .post('/api/call-reports')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ unregisteredName: label, employeeName: 'Tester', callDate: new Date().toISOString() });
    return res.body.data.id as string;
  }

  // ── DELETE /api/customers -- CRITICAL delete-all, requires confirm + typed phrase + expectedCount ──
  describe('DELETE /api/customers (delete-all, CRITICAL tier)', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(ts.baseUrl).delete('/api/customers');
      expect(res.status).toBe(401);
    });

    it('rejects TECHNICIAN', async () => {
      const res = await request(ts.baseUrl).delete('/api/customers').set('Authorization', `Bearer ${techToken}`)
        .send({ confirm: true, confirmPhrase: 'DELETE', expectedCount: 0 });
      expect(res.status).toBe(403);
    });

    it('rejects SCHEDULING', async () => {
      const res = await request(ts.baseUrl).delete('/api/customers').set('Authorization', `Bearer ${schedToken}`)
        .send({ confirm: true, confirmPhrase: 'DELETE', expectedCount: 0 });
      expect(res.status).toBe(403);
    });

    it('rejects ADMIN with no confirmation fields at all', async () => {
      const res = await request(ts.baseUrl).delete('/api/customers').set('Authorization', `Bearer ${adminToken}`).send({});
      expect(res.status).toBe(400);
    });

    it('rejects ADMIN with confirm:false', async () => {
      const res = await request(ts.baseUrl).delete('/api/customers').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: false, confirmPhrase: 'DELETE', expectedCount: 0 });
      expect(res.status).toBe(400);
    });

    it('rejects ADMIN with confirm:true but the wrong phrase', async () => {
      const res = await request(ts.baseUrl).delete('/api/customers').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, confirmPhrase: 'delete', expectedCount: 0 });
      expect(res.status).toBe(400);
    });

    it('rejects a malformed expectedCount', async () => {
      const res = await request(ts.baseUrl).delete('/api/customers').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, confirmPhrase: 'DELETE', expectedCount: 'twelve' });
      expect(res.status).toBe(400);
    });

    it('a wrong expectedCount is rejected with 409 and deletes NOTHING', async () => {
      const before = await prisma.customer.count();
      const res = await request(ts.baseUrl).delete('/api/customers').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, confirmPhrase: 'DELETE', expectedCount: before + 5 });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('CONFLICT');
      const after = await prisma.customer.count();
      expect(after).toBe(before);
    });

    it('a correct, fully-confirmed request succeeds, deletes exactly the reviewed set, and is audited', async () => {
      // Isolate: remove any customers left over from other test files/runs so the count is exact.
      await prisma.customer.deleteMany();
      const idA = await createCustomer('Bulk Delete Target A');
      const idB = await createCustomer('Bulk Delete Target B');
      const realCount = await prisma.customer.count();
      expect(realCount).toBe(2);

      const res = await request(ts.baseUrl).delete('/api/customers').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, confirmPhrase: 'DELETE', expectedCount: realCount });
      expect(res.status).toBe(200);
      expect(res.body.data.deletedCount).toBe(2);

      const remaining = await prisma.customer.count();
      expect(remaining).toBe(0);
      expect(await prisma.customer.findUnique({ where: { id: idA } })).toBeNull();
      expect(await prisma.customer.findUnique({ where: { id: idB } })).toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'customer', entityId: 'bulk' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toBeTruthy();
      expect(audit!.action).toContain('2');
    });
  });

  // ── DELETE /api/call-reports/bulk -- explicit bounded ID list ──
  describe('DELETE /api/call-reports/bulk (explicit IDs)', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(ts.baseUrl).delete('/api/call-reports/bulk');
      expect(res.status).toBe(401);
    });

    it('rejects TECHNICIAN', async () => {
      const id = await createCallReport(`tech-reject-${uniqueSuffix()}`);
      const res = await request(ts.baseUrl).delete('/api/call-reports/bulk').set('Authorization', `Bearer ${techToken}`)
        .send({ confirm: true, ids: [id], expectedCount: 1 });
      expect(res.status).toBe(403);
    });

    it('allows SCHEDULING (existing, consistently-applied business rule for this resource)', async () => {
      const id = await createCallReport(`sched-allowed-${uniqueSuffix()}`);
      const res = await request(ts.baseUrl).delete('/api/call-reports/bulk').set('Authorization', `Bearer ${schedToken}`)
        .send({ confirm: true, ids: [id], expectedCount: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.deletedCount).toBe(1);
    });

    it('rejects ADMIN with confirm:false', async () => {
      const id = await createCallReport(`no-confirm-${uniqueSuffix()}`);
      const res = await request(ts.baseUrl).delete('/api/call-reports/bulk').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: false, ids: [id], expectedCount: 1 });
      expect(res.status).toBe(400);
      expect(await prisma.callReport.findUnique({ where: { id } })).toBeTruthy();
    });

    it('rejects an empty ids array rather than treating it as delete-all or a silent no-op', async () => {
      const res = await request(ts.baseUrl).delete('/api/call-reports/bulk').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, ids: [], expectedCount: 0 });
      expect(res.status).toBe(400);
    });

    it('rejects malformed (non-UUID) IDs', async () => {
      const res = await request(ts.baseUrl).delete('/api/call-reports/bulk').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, ids: ['not-a-real-id'], expectedCount: 1 });
      expect(res.status).toBe(400);
    });

    it('duplicate IDs in the request cannot inflate or confuse the expected count', async () => {
      const id = await createCallReport(`dup-${uniqueSuffix()}`);
      // Real unique count is 1; submitting it twice with expectedCount:2 must be
      // rejected as stale rather than silently deleting once and "succeeding".
      const res = await request(ts.baseUrl).delete('/api/call-reports/bulk').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, ids: [id, id], expectedCount: 2 });
      expect(res.status).toBe(409);
      expect(await prisma.callReport.findUnique({ where: { id } })).toBeTruthy();

      // The correct call -- expectedCount matching the DE-DUPLICATED count -- succeeds
      // and deletes the row exactly once.
      const ok = await request(ts.baseUrl).delete('/api/call-reports/bulk').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, ids: [id, id], expectedCount: 1 });
      expect(ok.status).toBe(200);
      expect(ok.body.data.deletedCount).toBe(1);
      expect(await prisma.callReport.findUnique({ where: { id } })).toBeNull();
    });

    it('a stale ID that no longer exists is rejected with 409 and deletes nothing else in the batch', async () => {
      const stillThere = await createCallReport(`stays-${uniqueSuffix()}`);
      const alreadyGone = await createCallReport(`gone-${uniqueSuffix()}`);
      await prisma.callReport.delete({ where: { id: alreadyGone } }); // simulate a stale client view

      const res = await request(ts.baseUrl).delete('/api/call-reports/bulk').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, ids: [stillThere, alreadyGone], expectedCount: 2 });
      expect(res.status).toBe(409);
      // Nothing was deleted -- the still-existing report must survive the rejected batch.
      expect(await prisma.callReport.findUnique({ where: { id: stillThere } })).toBeTruthy();
    });

    it('an unrelated call report outside the ID list is never touched', async () => {
      const target = await createCallReport(`target-${uniqueSuffix()}`);
      const bystander = await createCallReport(`bystander-${uniqueSuffix()}`);
      const res = await request(ts.baseUrl).delete('/api/call-reports/bulk').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, ids: [target], expectedCount: 1 });
      expect(res.status).toBe(200);
      expect(await prisma.callReport.findUnique({ where: { id: target } })).toBeNull();
      expect(await prisma.callReport.findUnique({ where: { id: bystander } })).toBeTruthy();
      await prisma.callReport.delete({ where: { id: bystander } });
    });

    it('a successful bulk delete is audited', async () => {
      const id = await createCallReport(`audited-${uniqueSuffix()}`);
      await request(ts.baseUrl).delete('/api/call-reports/bulk').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, ids: [id], expectedCount: 1 });
      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'call_report', entityId: 'bulk' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toBeTruthy();
    });
  });

  // ── DELETE /api/call-reports/all -- delete-all, no typed phrase (proportional tier) ──
  describe('DELETE /api/call-reports/all', () => {
    it('rejects TECHNICIAN', async () => {
      const res = await request(ts.baseUrl).delete('/api/call-reports/all').set('Authorization', `Bearer ${techToken}`)
        .send({ confirm: true, expectedCount: 0 });
      expect(res.status).toBe(403);
    });

    it('a wrong expectedCount is rejected with 409 and deletes nothing', async () => {
      await prisma.callReport.deleteMany();
      await createCallReport(`all-target-${uniqueSuffix()}`);
      const real = await prisma.callReport.count();
      const res = await request(ts.baseUrl).delete('/api/call-reports/all').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, expectedCount: real + 1 });
      expect(res.status).toBe(409);
      expect(await prisma.callReport.count()).toBe(real);
    });

    it('a correct request deletes all and only the reviewed records, and is audited', async () => {
      const real = await prisma.callReport.count();
      const res = await request(ts.baseUrl).delete('/api/call-reports/all').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, expectedCount: real });
      expect(res.status).toBe(200);
      expect(res.body.data.deletedCount).toBe(real);
      expect(await prisma.callReport.count()).toBe(0);
      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'call_report', entityId: 'all' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toBeTruthy();
    });
  });

  // ── DELETE /api/messages -- wipes the audit trail itself, ADMIN-only, CRITICAL ──
  describe('DELETE /api/messages (delete-all audit log)', () => {
    it('rejects SCHEDULING (ADMIN-only, unlike the GET route which SCHEDULING can read)', async () => {
      const res = await request(ts.baseUrl).delete('/api/messages').set('Authorization', `Bearer ${schedToken}`)
        .send({ confirm: true, expectedCount: 0 });
      expect(res.status).toBe(403);
    });

    it('rejects TECHNICIAN', async () => {
      const res = await request(ts.baseUrl).delete('/api/messages').set('Authorization', `Bearer ${techToken}`)
        .send({ confirm: true, expectedCount: 0 });
      expect(res.status).toBe(403);
    });

    it('rejects ADMIN without confirm', async () => {
      const res = await request(ts.baseUrl).delete('/api/messages').set('Authorization', `Bearer ${adminToken}`).send({ expectedCount: 0 });
      expect(res.status).toBe(400);
    });

    it('a wrong expectedCount is rejected with 409 and deletes nothing', async () => {
      const real = await prisma.auditLog.count();
      const res = await request(ts.baseUrl).delete('/api/messages').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, expectedCount: real + 10 });
      expect(res.status).toBe(409);
      expect(await prisma.auditLog.count()).toBe(real);
    });

    it('a correct request wipes the log and leaves exactly one new audit row documenting the wipe itself', async () => {
      // Generate at least one real audit row to wipe (customer creation writes one).
      await createCustomer('Audit Bait Customer');
      const real = await prisma.auditLog.count();
      expect(real).toBeGreaterThan(0);

      const res = await request(ts.baseUrl).delete('/api/messages').set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: true, expectedCount: real });
      expect(res.status).toBe(200);
      expect(res.body.data.deletedCount).toBe(real);

      const remaining = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' } });
      expect(remaining.length).toBe(1);
      expect(remaining[0].entityType).toBe('audit_log');
      expect(remaining[0].entityId).toBe('all');
    });
  });
});
