// Approval-flow fix: a normal (non-urgent) appointment created by SCHEDULING
// must start hidden from Technicians and land directly in Admin's existing
// Appointment Acceptance queue (Modification #5/#10's adminApproved/
// visibleToTechnician state and pending-export-approval/approve-export
// endpoints, reused unchanged) -- no separate "Export" action required
// anymore. An appointment created by ADMIN needs no approval and stays
// immediately Technician-visible, exactly as before. The backend is the sole
// source of truth: visibleToTechnician/adminApproved are not accepted input
// fields on apptSchema, so a Scheduling-supplied value for either is silently
// dropped by Zod before the creator-role rule ever runs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Appointment approval flow: creator-role rule', () => {
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
        name: 'Approval Flow Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Riyadh', district: 'Test', street: 'Test' },
      });
    customerId = custRes.body.data.id;
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

  async function createSchedulingAppointment(extra: Record<string, any> = {}) {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString(), ...extra });
    expect(res.status).toBe(201);
    createdAppointmentIds.push(res.body.data.id);
    return res.body.data;
  }

  // 1, 2, 3. Scheduling creates a normal appointment -- forced pending, hidden from Technicians.
  it('Scheduling-created appointment starts with adminApproved=false and visibleToTechnician=false', async () => {
    const appt = await createSchedulingAppointment();
    expect(appt.adminApproved).toBe(false);
    expect(appt.visibleToTechnician).toBe(false);
  });

  // 4, 18. Scheduling cannot override the flags via the request payload, including
  // a raw/direct API call with fields that aren't part of the schema at all.
  it('Scheduling cannot self-approve by supplying visibleToTechnician/adminApproved in the payload', async () => {
    const appt = await createSchedulingAppointment({ visibleToTechnician: true, adminApproved: true });
    expect(appt.adminApproved).toBe(false);
    expect(appt.visibleToTechnician).toBe(false);
  });

  // 5. Still visible to Scheduling itself.
  it('remains visible to Scheduling in its own appointment list', async () => {
    const appt = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${schedToken}`);
    expect(res.body.data.some((a: any) => a.id === appt.id)).toBe(true);
  });

  // 6. Appears in Admin's existing Appointment Acceptance queue -- automatically,
  // with no separate Export action required.
  it('appears in Admin\'s pending-export-approval list immediately on creation', async () => {
    const appt = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).get('/api/appointments/pending-export-approval').set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.some((a: any) => a.id === appt.id)).toBe(true);
  });

  // 7, 16. Technician cannot see it before approval.
  it('Technician cannot see the appointment before Admin approval', async () => {
    const appt = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${techToken}`);
    expect(res.body.data.some((a: any) => a.id === appt.id)).toBe(false);
    const detailRes = await request(ts.baseUrl).get(`/api/appointments/${appt.id}`).set('Authorization', `Bearer ${techToken}`);
    expect(detailRes.status).toBe(404);
  });

  // 8, 9. Admin approves through the existing, reused approve-export endpoint.
  it('Admin can approve through the existing approve-export endpoint, setting both flags true', async () => {
    const appt = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.adminApproved).toBe(true);
    expect(res.body.data.visibleToTechnician).toBe(true);
  });

  // 10. Technician can see it after approval.
  it('Technician can see the appointment after Admin approval', async () => {
    const appt = await createSchedulingAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    const res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${techToken}`);
    expect(res.body.data.some((a: any) => a.id === appt.id)).toBe(true);
    const detailRes = await request(ts.baseUrl).get(`/api/appointments/${appt.id}`).set('Authorization', `Bearer ${techToken}`);
    expect(detailRes.status).toBe(200);
  });

  // 11, 12. Admin-created normal appointment is automatically approved+visible.
  it('Admin-created appointment starts with adminApproved=true and visibleToTechnician=true', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString() });
    expect(res.status).toBe(201);
    createdAppointmentIds.push(res.body.data.id);
    expect(res.body.data.adminApproved).toBe(true);
    expect(res.body.data.visibleToTechnician).toBe(true);
  });

  // 13. Does NOT appear in Appointment Acceptance -- never needed approval.
  it('Admin-created appointment does not appear in pending-export-approval', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString() });
    createdAppointmentIds.push(res.body.data.id);
    const pending = await request(ts.baseUrl).get('/api/appointments/pending-export-approval').set('Authorization', `Bearer ${adminToken}`);
    expect(pending.body.data.some((a: any) => a.id === res.body.data.id)).toBe(false);
  });

  // 14. Technician sees an Admin-created appointment immediately, no approval needed.
  it('Technician sees an Admin-created appointment immediately', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString() });
    createdAppointmentIds.push(res.body.data.id);
    const techRes = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${techToken}`);
    expect(techRes.body.data.some((a: any) => a.id === res.body.data.id)).toBe(true);
  });

  // 15. Existing technician-assignment filtering remains intact for an Admin-created,
  // technician-assigned appointment: only the assigned technician (or an unassigned
  // shared-pool appointment) is returned, unaffected by this fix.
  it('technician assignment filtering is unaffected: an appointment assigned to Technician 1 is not returned for Technician 2', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString(), technicianId: users.technician.id });
    createdAppointmentIds.push(res.body.data.id);
    const tech2Token = signTestToken(users.technician2.id, 'TECHNICIAN');
    const tech2Res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${tech2Token}`);
    expect(tech2Res.body.data.some((a: any) => a.id === res.body.data.id)).toBe(false);
    const tech1Res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${techToken}`);
    expect(tech1Res.body.data.some((a: any) => a.id === res.body.data.id)).toBe(true);
  });

  // 17. Existing urgent behavior is unchanged by this fix: an Admin-created urgent
  // appointment is still immediately visible (isUrgent can only ever be true for an
  // Admin-created appointment -- Scheduling can never set isUrgent via this endpoint).
  it('an urgent appointment (Admin-created, isUrgent=true) remains immediately technician-visible, unaffected by this fix', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString(), isUrgent: true, urgentLocation: JSON.stringify({ city: 'Riyadh' }), customerName: 'Approval Flow Urgent Customer', customerPhone: testPhone() });
    expect(res.status).toBe(201);
    createdAppointmentIds.push(res.body.data.id);
    expect(res.body.data.isUrgent).toBe(true);
    expect(res.body.data.visibleToTechnician).toBe(true);
    expect(res.body.data.adminApproved).toBe(true);
  });

  // Scheduling can never create an urgent appointment via this endpoint (existing,
  // unrelated protection -- confirms this fix's `isUrgent` reuse in the
  // visibleToTechnician expression never accidentally becomes reachable for Scheduling).
  it('Scheduling cannot create an urgent appointment (existing protection, unaffected)', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString(), isUrgent: true });
    expect(res.status).toBe(201);
    createdAppointmentIds.push(res.body.data.id);
    expect(res.body.data.isUrgent).toBe(false);
    expect(res.body.data.visibleToTechnician).toBe(false);
  });
});
