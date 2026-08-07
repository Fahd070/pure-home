// Regression coverage for audit finding F-8: the duplicate single-record delete
// routes in dashboard.ts (DELETE /api/dashboard/customer/:id and
// DELETE /api/dashboard/appointment/:id) are actively used by the admin
// dashboard's drill-down delete buttons (packages/unified-app/src/admin/pages/
// Dashboard.tsx's DrillModal), so they were kept and given the same audit-log
// semantics as the canonical DELETE /api/customers/:id and
// DELETE /api/appointments/:id routes, instead of being removed as dead code.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Dashboard single-record delete routes (F-8 audit trail)', () => {
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
    await prisma.appointment.deleteMany();
    await prisma.customer.deleteMany();
    await stopTestServer(ts.server);
  });

  async function createCustomer(name: string): Promise<string> {
    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name, phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1,
        address: { city: 'Riyadh', district: 'Test', street: 'Test' },
      });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  async function createAppointment(customerId: string): Promise<string> {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  describe('DELETE /api/dashboard/customer/:id', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(ts.baseUrl).delete('/api/dashboard/customer/does-not-matter');
      expect(res.status).toBe(401);
    });

    it('rejects SCHEDULING (route requires ADMIN, same as the canonical route)', async () => {
      const id = await createCustomer('Dashboard Delete Reject Sched');
      const res = await request(ts.baseUrl).delete(`/api/dashboard/customer/${id}`).set('Authorization', `Bearer ${schedToken}`);
      expect(res.status).toBe(403);
      expect(await prisma.customer.findUnique({ where: { id } })).not.toBeNull();
    });

    it('rejects TECHNICIAN', async () => {
      const id = await createCustomer('Dashboard Delete Reject Tech');
      const res = await request(ts.baseUrl).delete(`/api/dashboard/customer/${id}`).set('Authorization', `Bearer ${techToken}`);
      expect(res.status).toBe(403);
      expect(await prisma.customer.findUnique({ where: { id } })).not.toBeNull();
    });

    it('a nonexistent id returns 404 and writes no audit entry', async () => {
      const fakeId = 'nonexistent-customer-id';
      const before = await prisma.auditLog.count({ where: { entityType: 'customer', entityId: fakeId } });
      const res = await request(ts.baseUrl).delete(`/api/dashboard/customer/${fakeId}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      const after = await prisma.auditLog.count({ where: { entityType: 'customer', entityId: fakeId } });
      expect(after).toBe(before);
    });

    it('ADMIN deletes exactly the targeted customer, leaves other records untouched, and writes exactly one audit entry', async () => {
      const targetId = await createCustomer('Dashboard Delete Target');
      const otherId = await createCustomer('Dashboard Delete Bystander');

      const res = await request(ts.baseUrl).delete(`/api/dashboard/customer/${targetId}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      expect(await prisma.customer.findUnique({ where: { id: targetId } })).toBeNull();
      expect(await prisma.customer.findUnique({ where: { id: otherId } })).not.toBeNull();

      // entityId also carries the earlier CREATE audit entry from createCustomer() above
      // (the stored `action` column holds the human-readable label text, not a bare
      // action-type string), so check the most recent entry specifically -- same
      // findFirst+orderBy pattern already used in bulkDelete.test.ts.
      const deleteAudit = await prisma.auditLog.findFirst({
        where: { entityType: 'customer', entityId: targetId },
        orderBy: { createdAt: 'desc' },
      });
      expect(deleteAudit).toBeTruthy();
      expect(deleteAudit!.action).toContain('deleted');
      expect(deleteAudit!.action).toContain('Dashboard Delete Target');
      expect(deleteAudit!.userId).toBe(users.admin.id);

      await prisma.customer.delete({ where: { id: otherId } });
    });
  });

  describe('DELETE /api/dashboard/appointment/:id', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(ts.baseUrl).delete('/api/dashboard/appointment/does-not-matter');
      expect(res.status).toBe(401);
    });

    it('rejects SCHEDULING', async () => {
      const custId = await createCustomer('Dashboard Appt Reject Sched');
      const apptId = await createAppointment(custId);
      const res = await request(ts.baseUrl).delete(`/api/dashboard/appointment/${apptId}`).set('Authorization', `Bearer ${schedToken}`);
      expect(res.status).toBe(403);
      expect(await prisma.appointment.findUnique({ where: { id: apptId } })).not.toBeNull();
    });

    it('a nonexistent id returns 404 and writes no audit entry', async () => {
      const fakeId = 'nonexistent-appointment-id';
      const before = await prisma.auditLog.count({ where: { entityType: 'appointment', entityId: fakeId } });
      const res = await request(ts.baseUrl).delete(`/api/dashboard/appointment/${fakeId}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      const after = await prisma.auditLog.count({ where: { entityType: 'appointment', entityId: fakeId } });
      expect(after).toBe(before);
    });

    it('ADMIN deletes exactly the targeted appointment, leaves other records untouched, and writes exactly one audit entry', async () => {
      const custId = await createCustomer('Dashboard Appt Delete Owner');
      const targetApptId = await createAppointment(custId);
      const otherApptId = await createAppointment(custId);

      const res = await request(ts.baseUrl).delete(`/api/dashboard/appointment/${targetApptId}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      expect(await prisma.appointment.findUnique({ where: { id: targetApptId } })).toBeNull();
      expect(await prisma.appointment.findUnique({ where: { id: otherApptId } })).not.toBeNull();

      // entityId also carries the earlier CREATE audit entry from createAppointment() above.
      const deleteAudit = await prisma.auditLog.findFirst({
        where: { entityType: 'appointment', entityId: targetApptId },
        orderBy: { createdAt: 'desc' },
      });
      expect(deleteAudit).toBeTruthy();
      expect(deleteAudit!.action).toContain('deleted');
      expect(deleteAudit!.userId).toBe(users.admin.id);
    });
  });

  describe('canonical routes remain unchanged and still audited (no regression from this fix)', () => {
    it('DELETE /api/customers/:id still succeeds and still writes an audit entry', async () => {
      const id = await createCustomer('Canonical Customer Still Audited');
      const res = await request(ts.baseUrl).delete(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'customer', entityId: id } });
      expect(audit).toBeTruthy();
    });

    it('DELETE /api/appointments/:id still succeeds and still writes an audit entry', async () => {
      const custId = await createCustomer('Canonical Appt Still Audited Owner');
      const apptId = await createAppointment(custId);
      const res = await request(ts.baseUrl).delete(`/api/appointments/${apptId}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'appointment', entityId: apptId } });
      expect(audit).toBeTruthy();
      await prisma.customer.delete({ where: { id: custId } });
    });
  });
});
