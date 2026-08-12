import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

// Modification #5: Scheduling/Maintenance export -> Admin approval -> Technician
// workflow. UPDATED for the approval-flow fix: a Scheduling-created normal
// appointment now starts DIRECTLY in the pending (visibleToTechnician=false,
// adminApproved=false) state at creation time -- it no longer needs (or can
// reach, via creation) the old "created and already technician-visible, not
// yet exported" (true,false) state. The export-to-technicians/approve-export
// endpoints themselves are completely unchanged; only their reachable
// PRECONDITION changed. Tests that exercised "export a freshly-created
// appointment" are simplified since creation itself now does that; the one
// test that specifically needs the old (true,false) "never exported" state
// (a legacy scenario, e.g. an appointment that existed before this fix
// shipped) constructs it explicitly via createLegacyUnexportedAppointment().
describe('Appointment export-to-technician approval workflow', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;
  let customerId: string;
  const createdAppointmentIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');

    const custRes = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Export Flow Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Jeddah', district: 'Test', street: 'Test' },
      });
    customerId = custRes.body.data.id;
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) {
      await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    }
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

  // Now already-pending immediately (the approval-flow fix): visibleToTechnician
  // and adminApproved both start false, matching what a manual export used to produce.
  async function createSchedulingAppointment() {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(res.status).toBe(201);
    createdAppointmentIds.push(res.body.data.id);
    return res.body.data;
  }

  // Simulates a LEGACY appointment still in the pre-fix "created and
  // immediately technician-visible, never yet exported" state -- the only way
  // a Scheduling appointment reaches (visibleToTechnician=true,
  // adminApproved=false) today, since creation itself no longer produces it.
  async function createLegacyUnexportedAppointment() {
    const appt = await createSchedulingAppointment();
    await prisma.appointment.update({ where: { id: appt.id }, data: { visibleToTechnician: true } });
    return { ...appt, visibleToTechnician: true };
  }

  // 1. Export success + resulting field values (legacy precondition)
  it('Scheduling can export a legacy never-exported appointment; sets visibleToTechnician=false, adminApproved=false', async () => {
    const appt = await createLegacyUnexportedAppointment();
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/export-to-technicians`)
      .set('Authorization', `Bearer ${schedToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.visibleToTechnician).toBe(false);
    expect(res.body.data.adminApproved).toBe(false);
  });

  // 2. A newly-created (already pending) appointment remains visible to Scheduling
  it('a newly-created, already-pending appointment remains visible to Scheduling', async () => {
    const appt = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).get(`/api/appointments/${appt.id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
  });

  // 3. Technician cannot retrieve a pending appointment (single GET)
  it('Technician cannot GET a pending appointment directly', async () => {
    const appt = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).get(`/api/appointments/${appt.id}`).set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(404);
  });

  // 3b. Technician cannot retrieve a pending appointment (list)
  it('Technician list does not include a pending appointment', async () => {
    const appt = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.find((a: any) => a.id === appt.id)).toBeUndefined();
  });

  // 4. Non-Admin (Scheduling) cannot approve
  it('Scheduling cannot call approve-export', async () => {
    const appt = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/approve-export`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(res.status).toBe(403);
  });

  // 4b. Non-Admin (Technician) cannot approve
  it('Technician cannot call approve-export', async () => {
    const appt = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/approve-export`).set('Authorization', `Bearer ${techToken}`).send({});
    expect(res.status).toBe(403);
  });

  // 5. Admin can approve + resulting field values
  it('Admin can approve a pending appointment; sets visibleToTechnician=true, adminApproved=true', async () => {
    const appt = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.visibleToTechnician).toBe(true);
    expect(res.body.data.adminApproved).toBe(true);
  });

  // 6. Technician CAN retrieve after approval
  it('Technician can retrieve the appointment after Admin approval', async () => {
    const appt = await createSchedulingAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    const res = await request(ts.baseUrl).get(`/api/appointments/${appt.id}`).set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
  });

  // 7. An Admin-created ordinary appointment stays technician-visible by default
  // (unchanged). A Scheduling-created one no longer does -- that is precisely
  // the approval-flow fix; see appointmentApprovalFlow.test.ts.
  it('an ordinary Admin-created appointment stays technician-visible (default true)', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString() });
    expect(res.status).toBe(201);
    createdAppointmentIds.push(res.body.data.id);
    const check = await request(ts.baseUrl).get(`/api/appointments/${res.body.data.id}`).set('Authorization', `Bearer ${techToken}`);
    expect(check.status).toBe(200);
    expect(check.body.data.visibleToTechnician).toBe(true);
  });

  // 8. A freshly-created (already-pending) appointment rejects an export attempt
  // immediately -- it's already in the state export used to have to be manually
  // triggered to reach (409 ALREADY_PENDING, same as the old "duplicate export" case).
  it('exporting a freshly-created (already-pending) appointment is rejected (409 ALREADY_PENDING)', async () => {
    const appt = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/export-to-technicians`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_PENDING');
    const check = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(check?.visibleToTechnician).toBe(false);
    expect(check?.adminApproved).toBe(false);
  });

  it('an export attempt on an already-approved appointment is rejected (409 ALREADY_APPROVED)', async () => {
    const appt = await createSchedulingAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    const res = await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/export-to-technicians`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_APPROVED');
  });

  // 9. Duplicate approval is safe/controlled (idempotent-rejecting, not corrupting)
  it('a second approval attempt on an already-approved appointment is rejected (409 NOT_PENDING), state unchanged', async () => {
    const appt = await createSchedulingAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    const res = await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NOT_PENDING');
    const check = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(check?.visibleToTechnician).toBe(true);
    expect(check?.adminApproved).toBe(true);
  });

  // A legacy never-exported appointment (visibleToTechnician=true, adminApproved=false)
  // still correctly rejects a direct approval attempt.
  it('approving a legacy never-exported appointment is rejected (409 NOT_PENDING)', async () => {
    const appt = await createLegacyUnexportedAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NOT_PENDING');
  });

  // 10. Existing urgent appointment behavior not broken (regression)
  it('urgent appointments remain fully technician-visible and are unaffected by export gating', async () => {
    const urgentRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        isUrgent: true,
        urgentLocation: 'Test urgent location',
        customerName: 'Export Regression Urgent Customer',
        customerPhone: testPhone(),
      });
    expect(urgentRes.status).toBe(201);
    createdAppointmentIds.push(urgentRes.body.data.id);
    expect(urgentRes.body.data.visibleToTechnician).toBe(true);

    const res = await request(ts.baseUrl).get(`/api/appointments?urgent=true`).set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.find((a: any) => a.id === urgentRes.body.data.id)).toBeTruthy();
  });

  // 11. Existing Admin<->Scheduling approve-visibility flow not broken (regression)
  it('the pre-existing Admin<->Scheduling approve-visibility flow is unaffected by the export workflow', async () => {
    const hiddenRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        visibleToScheduling: false,
      });
    expect(hiddenRes.status).toBe(201);
    createdAppointmentIds.push(hiddenRes.body.data.id);
    expect(hiddenRes.body.data.visibleToScheduling).toBe(false);
    // Admin-created appointment: visibleToTechnician defaults true regardless of visibleToScheduling
    expect(hiddenRes.body.data.visibleToTechnician).toBe(true);

    const notVisible = await request(ts.baseUrl).get(`/api/appointments/${hiddenRes.body.data.id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(notVisible.status).toBe(404);

    const approveRes = await request(ts.baseUrl).patch(`/api/appointments/${hiddenRes.body.data.id}/approve-visibility`).set('Authorization', `Bearer ${adminToken}`).send({});
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.visibleToScheduling).toBe(true);

    const nowVisible = await request(ts.baseUrl).get(`/api/appointments/${hiddenRes.body.data.id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(nowVisible.status).toBe(200);
  });

  // 12. Export is scoped to what Scheduling can already see (visibleToScheduling + non-urgent)
  it('Scheduling cannot export an appointment outside its own visible scope (404, not a state leak)', async () => {
    const hiddenRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        visibleToScheduling: false,
      });
    createdAppointmentIds.push(hiddenRes.body.data.id);
    const res = await request(ts.baseUrl).patch(`/api/appointments/${hiddenRes.body.data.id}/export-to-technicians`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(res.status).toBe(404);
  });

  // 13. Non-Scheduling roles cannot call export-to-technicians
  it('Admin and Technician cannot call export-to-technicians (SCHEDULING-only)', async () => {
    const appt = await createSchedulingAppointment();
    const adminAttempt = await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/export-to-technicians`).set('Authorization', `Bearer ${adminToken}`).send({});
    expect(adminAttempt.status).toBe(403);
    const techAttempt = await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/export-to-technicians`).set('Authorization', `Bearer ${techToken}`).send({});
    expect(techAttempt.status).toBe(403);
  });
});
