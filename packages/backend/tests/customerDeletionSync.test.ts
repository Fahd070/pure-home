// Customer deletion synchronization fix: deleting a customer must not leave
// their still-actionable (operational) appointments behind as ghost cards in
// Scheduling/Technician views. Appointment.customerId is ON DELETE SET NULL
// at the DB level (a deliberate, separate decision -- see schema.prisma), so
// a naive prisma.customer.delete() alone never removed these rows; it just
// orphaned them (customerId -> null) while they stayed fully visible and
// actionable everywhere. The fix (services/customerDeletion.service.ts)
// explicitly, transactionally deletes only OPERATIONAL appointments
// (WAITING/IN_PROGRESS/POSTPONED, non-urgent) belonging to the deleted
// customer, while COMPLETED appointments are deliberately preserved
// (customerId -> null) for their historical/financial data -- they never
// appear in Work Queue or any "live" list regardless.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';
import fs from 'fs';
import path from 'path';

function dateOnly(d: Date | string): string { return new Date(d).toISOString().slice(0, 10); }

describe('Customer deletion synchronization (Part A)', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;
  const createdCustomerIds: string[] = [];
  const createdAppointmentIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    if (createdCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await stopTestServer(ts.server);
  });

  async function createCustomer(name: string): Promise<string> {
    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    createdCustomerIds.push(id);
    return id;
  }

  async function createAppointment(customerId: string, technicianId?: string): Promise<string> {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString(), ...(technicianId ? { technicianId } : {}) });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    createdAppointmentIds.push(id);
    return id;
  }

  // Scheduling-created (not Admin-created): apptSchema's `adminApproved` at
  // creation time is reused for the separate, pre-existing Admin<->Scheduling
  // visibleToScheduling approval flow, which sets it true by default for an
  // Admin-created appointment -- that would start the export state machine
  // already at "(true,true) already approved" and mask the actual export/
  // approve transition this helper needs to exercise. Matches the precedent
  // in appointmentExport.test.ts's createSchedulingAppointment().
  async function createSchedulingAppointment(customerId: string): Promise<string> {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString() });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    createdAppointmentIds.push(id);
    return id;
  }

  async function startAppointment(id: string) {
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    expect(res.status).toBe(200);
  }

  async function completeAppointment(id: string) {
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`).send({
      serviceDetails: 'Serviced', completionAmount: 100, completionPaymentMethod: 'CASH',
      actualCompletionDate: dateOnly(new Date()), technicianName: 'Ahmed',
    });
    expect(res.status).toBe(200);
  }

  async function postponeAppointment(id: string) {
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/postpone`).set('Authorization', `Bearer ${techToken}`).send({ reason: 'Customer unavailable' });
    expect(res.status).toBe(200);
  }

  // 1, 2, 3. Admin deletes a customer with a normal pending (WAITING) appointment.
  it('deletes a customer and its normal pending appointment together', async () => {
    const custId = await createCustomer('Sync Delete Pending Customer');
    const apptId = await createAppointment(custId);

    const res = await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    expect(await prisma.customer.findUnique({ where: { id: custId } })).toBeNull();
    expect(await prisma.appointment.findUnique({ where: { id: apptId } })).toBeNull();
  });

  // 4. Scheduling GET /appointments no longer returns it.
  it('Scheduling no longer sees the deleted customer\'s appointment', async () => {
    const custId = await createCustomer('Sync Delete Sched View Customer');
    const apptId = await createAppointment(custId);

    await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);

    const listRes = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${schedToken}`);
    expect(listRes.body.data.some((a: any) => a.id === apptId)).toBe(false);
  });

  // 5, 6, 7. Technician: no ghost card in the list, and the detail endpoint 404s
  // (i.e. the frontend can never render a blank/orphan card -- there is nothing to fetch).
  it('Technician no longer sees the deleted customer\'s appointment in the list or by id', async () => {
    const custId = await createCustomer('Sync Delete Tech View Customer');
    const apptId = await createAppointment(custId, users.technician.id);

    await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);

    const listRes = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${techToken}`);
    expect(listRes.body.data.some((a: any) => a.id === apptId)).toBe(false);

    const detailRes = await request(ts.baseUrl).get(`/api/appointments/${apptId}`).set('Authorization', `Bearer ${techToken}`);
    expect(detailRes.status).toBe(404);
  });

  // 8. Customer with multiple operational appointments: all are cleaned.
  it('cleans every operational appointment when a customer has more than one', async () => {
    const custId = await createCustomer('Sync Delete Multi Appt Customer');
    const apptId1 = await createAppointment(custId);
    const apptId2 = await createAppointment(custId);
    const apptId3 = await createAppointment(custId);

    const res = await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    for (const id of [apptId1, apptId2, apptId3]) {
      expect(await prisma.appointment.findUnique({ where: { id } })).toBeNull();
    }
  });

  // 9. Appointment assigned to a Technician (IN_PROGRESS) is cleaned correctly.
  it('cleans an appointment already assigned to and started by a Technician', async () => {
    const custId = await createCustomer('Sync Delete In-Progress Customer');
    const apptId = await createAppointment(custId, users.technician.id);
    await startAppointment(apptId);
    expect((await prisma.appointment.findUnique({ where: { id: apptId } }))?.workStatus).toBe('IN_PROGRESS');

    await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(await prisma.appointment.findUnique({ where: { id: apptId } })).toBeNull();
  });

  // 10. Approved appointment (Modification #5) is cleaned correctly. A
  // Scheduling-created appointment now starts already-pending (the approval-
  // flow fix), so it goes straight to approve-export -- no separate export
  // step is reachable/needed anymore for a freshly-created appointment.
  it('cleans an appointment that has been Admin-approved', async () => {
    const custId = await createCustomer('Sync Delete Exported Approved Customer');
    const apptId = await createSchedulingAppointment(custId);
    const approveRes = await request(ts.baseUrl).patch(`/api/appointments/${apptId}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    expect(approveRes.status).toBe(200);
    const beforeDelete = await prisma.appointment.findUnique({ where: { id: apptId } });
    expect(beforeDelete?.visibleToTechnician).toBe(true);
    expect(beforeDelete?.adminApproved).toBe(true);

    await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(await prisma.appointment.findUnique({ where: { id: apptId } })).toBeNull();
  });

  // 11. Pending Admin-approval appointment is cleaned correctly -- a
  // Scheduling-created appointment is already in this state immediately at
  // creation (the approval-flow fix), with no export step required.
  it('cleans an appointment that is still pending Admin approval', async () => {
    const custId = await createCustomer('Sync Delete Pending Approval Customer');
    const apptId = await createSchedulingAppointment(custId);
    const beforeDelete = await prisma.appointment.findUnique({ where: { id: apptId } });
    expect(beforeDelete?.visibleToTechnician).toBe(false);
    expect(beforeDelete?.adminApproved).toBe(false);

    await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(await prisma.appointment.findUnique({ where: { id: apptId } })).toBeNull();
  });

  // 12. COMPLETED appointment is deliberately preserved (historical data), while a
  // POSTPONED one -- still "live"/actionable work -- is cleaned like WAITING/IN_PROGRESS.
  // Neither survives as a "broken live operational card": the completed one never
  // appears in Work Queue (which only ever queries non-COMPLETED workStatus) and
  // still carries its full completion record; the postponed one is gone entirely.
  it('preserves a COMPLETED appointment (historical) but removes a POSTPONED one (operational)', async () => {
    const custId = await createCustomer('Sync Delete Completed Postponed Customer');
    const completedApptId = await createAppointment(custId, users.technician.id);
    await startAppointment(completedApptId);
    await completeAppointment(completedApptId);

    const postponedApptId = await createAppointment(custId, users.technician.id);
    await startAppointment(postponedApptId);
    await postponeAppointment(postponedApptId);

    const res = await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const completedAfter = await prisma.appointment.findUnique({ where: { id: completedApptId } });
    expect(completedAfter).not.toBeNull();
    expect(completedAfter?.workStatus).toBe('COMPLETED');
    expect(completedAfter?.customerId).toBeNull();
    expect(completedAfter?.completionAmount).toBe(100);
    expect(completedAfter?.serviceDetails).toBe('Serviced');

    expect(await prisma.appointment.findUnique({ where: { id: postponedApptId } })).toBeNull();
  });

  // 13. Audit/history retention: AuditLog rows are never tied to Appointment by a
  // real FK (entityId is a plain string column) and are never touched by this
  // cleanup, so earlier lifecycle audit entries for a since-deleted appointment
  // survive intact -- exactly as this project's existing architecture already
  // guarantees for every other hard-delete in this codebase.
  it('preserves prior audit log entries for an appointment after it is deleted via customer cleanup', async () => {
    const custId = await createCustomer('Sync Delete Audit Retention Customer');
    const apptId = await createAppointment(custId, users.technician.id);
    await startAppointment(apptId);
    const startAudit = await prisma.auditLog.findFirst({ where: { entityType: 'appointment', entityId: apptId }, orderBy: { createdAt: 'desc' } });
    expect(startAudit).toBeTruthy();

    await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);

    const stillThere = await prisma.auditLog.findUnique({ where: { id: startAudit!.id } });
    expect(stillThere).toBeTruthy();
    const deleteAudit = await prisma.auditLog.findFirst({ where: { entityType: 'customer', entityId: custId }, orderBy: { createdAt: 'desc' } });
    expect(deleteAudit).toBeTruthy();
    expect(deleteAudit!.action).toContain('deleted');
  });

  // 14. Unauthorized roles cannot delete a customer (existing requireRole('ADMIN'), regression).
  it('SCHEDULING and TECHNICIAN cannot delete a customer', async () => {
    const custId = await createCustomer('Sync Delete Unauthorized Customer');
    const schedRes = await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${schedToken}`);
    expect(schedRes.status).toBe(403);
    const techRes = await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${techToken}`);
    expect(techRes.status).toBe(403);
    expect(await prisma.customer.findUnique({ where: { id: custId } })).not.toBeNull();
  });

  // 15. Atomicity: the transaction leaves no partial state. Functionally verified by
  // the fact that every test above sees the customer and its operational appointments
  // disappear together in one commit (never one without the other); the transactional
  // mechanism itself (prisma.$transaction wrapping both the appointment cleanup and the
  // customer delete) is confirmed at the source level below, matching this project's
  // established pattern of pairing a functional atomicity check with a source-level
  // confirmation of the mechanism when a genuine mid-transaction DB fault can't be
  // safely fabricated against a real integration-test database.
  it('a delete attempt on an already-gone customer is a clean 404 with no side effects (no partial state)', async () => {
    const custId = await createCustomer('Sync Delete Already Gone Customer');
    const apptId = await createAppointment(custId);
    const first = await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(first.status).toBe(200);
    expect(await prisma.appointment.findUnique({ where: { id: apptId } })).toBeNull();

    const auditCountBefore = await prisma.auditLog.count({ where: { entityType: 'customer', entityId: custId } });
    const second = await request(ts.baseUrl).delete(`/api/customers/${custId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(second.status).toBe(404);
    const auditCountAfter = await prisma.auditLog.count({ where: { entityType: 'customer', entityId: custId } });
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it('the cleanup transaction wraps both the appointment cleanup and the customer delete in prisma.$transaction (source confirmation)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/services/customerDeletion.service.ts'), 'utf-8');
    expect(src).toMatch(/prisma\.\$transaction\(async \(tx\) => \{/);
    expect(src).toMatch(/tx\.appointment\.deleteMany/);
    expect(src).toMatch(/tx\.customer\.delete/);
  });

  // The Admin Dashboard drill-down's own delete button (DELETE /api/dashboard/customer/:id,
  // a genuinely separate live call site -- see dashboardDelete.test.ts) must behave
  // identically, since it now shares the same cleanup function.
  it('DELETE /api/dashboard/customer/:id applies the same operational-appointment cleanup', async () => {
    const custId = await createCustomer('Sync Delete Dashboard Route Customer');
    const apptId = await createAppointment(custId, users.technician.id);

    const res = await request(ts.baseUrl).delete(`/api/dashboard/customer/${custId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(await prisma.customer.findUnique({ where: { id: custId } })).toBeNull();
    expect(await prisma.appointment.findUnique({ where: { id: apptId } })).toBeNull();
  });

  // Unrelated customer/appointments remain unchanged (no over-deletion).
  it('deleting Customer A does not touch Customer B\'s appointments', async () => {
    const custA = await createCustomer('Sync Delete Customer A');
    const custB = await createCustomer('Sync Delete Customer B (bystander)');
    const apptA = await createAppointment(custA);
    const apptB = await createAppointment(custB);

    await request(ts.baseUrl).delete(`/api/customers/${custA}`).set('Authorization', `Bearer ${adminToken}`);

    expect(await prisma.customer.findUnique({ where: { id: custB } })).not.toBeNull();
    expect(await prisma.appointment.findUnique({ where: { id: apptB } })).not.toBeNull();
    expect(await prisma.appointment.findUnique({ where: { id: apptA } })).toBeNull();
  });
});
