// Modification #10: GET /appointments/pending-export-approval and the reused
// Modification #5 PATCH /appointments/:id/approve-export action, as consumed by
// the new Admin "Appointment Acceptance" page.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Modification #10: Appointment Acceptance (pending export approval)', () => {
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
        name: 'Acceptance Page Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Dammam', district: 'Al Faisaliyah', street: 'Prince Mohammed St' },
      });
    customerId = custRes.body.data.id;
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

  async function createSchedulingAppointment(overrides: Record<string, any> = {}) {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        notes: 'Customer requested morning visit',
        ...overrides,
      });
    createdAppointmentIds.push(res.body.data.id);
    return res.body.data.id;
  }

  async function exportAppointment(id: string) {
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/export-to-technicians`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(res.status).toBe(200);
  }

  // Route-ordering sanity check: this must not be swallowed by GET /:id.
  it('GET /appointments/pending-export-approval resolves to its own route, not GET /:id', async () => {
    const res = await request(ts.baseUrl).get('/api/appointments/pending-export-approval').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // 5, 6, 7. Exactly the pending-exported appointments, nothing else
  it('a pending exported appointment appears; an ordinary appointment and an already-approved one do not', async () => {
    const pendingId = await createSchedulingAppointment();
    await exportAppointment(pendingId);

    const ordinaryId = await createSchedulingAppointment();

    const approvedId = await createSchedulingAppointment();
    await exportAppointment(approvedId);
    await request(ts.baseUrl).patch(`/api/appointments/${approvedId}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});

    const res = await request(ts.baseUrl).get('/api/appointments/pending-export-approval').set('Authorization', `Bearer ${adminToken}`);
    const ids = res.body.data.map((a: any) => a.id);
    expect(ids).toContain(pendingId);
    expect(ids).not.toContain(ordinaryId);
    expect(ids).not.toContain(approvedId);
  });

  // 8-11. Decision-relevant fields present
  it('a pending item includes customer, service type, scheduled date, location, and notes', async () => {
    const id = await createSchedulingAppointment({ notes: 'Gate code 9012' });
    await exportAppointment(id);
    const res = await request(ts.baseUrl).get('/api/appointments/pending-export-approval').set('Authorization', `Bearer ${adminToken}`);
    const found = res.body.data.find((a: any) => a.id === id);
    expect(found).toBeTruthy();
    expect(found.customer.name).toBe('Acceptance Page Customer');
    expect(found.customer.phone).toBeTruthy();
    expect(found.customer.address.city).toBe('Dammam');
    expect(found.type).toBe('MAINTENANCE');
    expect(found.scheduledDate).toBeTruthy();
    expect(found.notes).toBe('Gate code 9012');
  });

  // 12, 13, 14, 15. Approve from this flow uses the exact Modification #5 action
  it('Admin approving removes the item from the pending list and sets adminApproved=true, visibleToTechnician=true', async () => {
    const id = await createSchedulingAppointment();
    await exportAppointment(id);

    let list = await request(ts.baseUrl).get('/api/appointments/pending-export-approval').set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.data.map((a: any) => a.id)).toContain(id);

    const approveRes = await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.adminApproved).toBe(true);
    expect(approveRes.body.data.visibleToTechnician).toBe(true);

    list = await request(ts.baseUrl).get('/api/appointments/pending-export-approval').set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.data.map((a: any) => a.id)).not.toContain(id);
  });

  // 16, 17. Technician visibility before/after
  it('Technician cannot see the appointment before approval, and can see it after', async () => {
    const id = await createSchedulingAppointment();
    await exportAppointment(id);

    const before = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    expect(before.status).toBe(404);

    await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});

    const after = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    expect(after.status).toBe(200);
  });

  // 18. Scheduling visibility preserved throughout
  it('Scheduling continues to see the appointment before and after approval', async () => {
    const id = await createSchedulingAppointment();
    await exportAppointment(id);
    const duringPending = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(duringPending.status).toBe(200);

    await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    const afterApproval = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(afterApproval.status).toBe(200);
  });

  // 19, 20. Only Admin may use the pending-list endpoint or the approval action
  it('Scheduling cannot call GET pending-export-approval or PATCH approve-export', async () => {
    const id = await createSchedulingAppointment();
    await exportAppointment(id);
    const listRes = await request(ts.baseUrl).get('/api/appointments/pending-export-approval').set('Authorization', `Bearer ${schedToken}`);
    expect(listRes.status).toBe(403);
    const approveRes = await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(approveRes.status).toBe(403);
  });

  it('Technician cannot call GET pending-export-approval or PATCH approve-export', async () => {
    const id = await createSchedulingAppointment();
    await exportAppointment(id);
    const listRes = await request(ts.baseUrl).get('/api/appointments/pending-export-approval').set('Authorization', `Bearer ${techToken}`);
    expect(listRes.status).toBe(403);
    const approveRes = await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${techToken}`).send({});
    expect(approveRes.status).toBe(403);
  });

  it('rejects an unauthenticated request to the pending list endpoint', async () => {
    const res = await request(ts.baseUrl).get('/api/appointments/pending-export-approval');
    expect(res.status).toBe(401);
  });

  // 21. Duplicate/stale approval handled safely
  it('a second (stale) approval attempt is rejected safely and does not corrupt state', async () => {
    const id = await createSchedulingAppointment();
    await exportAppointment(id);
    await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    const secondAttempt = await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});
    expect(secondAttempt.status).toBe(409);
    expect(secondAttempt.body.error).toBe('NOT_PENDING');
    const check = await prisma.appointment.findUnique({ where: { id } });
    expect(check?.adminApproved).toBe(true);
    expect(check?.visibleToTechnician).toBe(true);
  });

  // Urgent appointments are excluded from this workflow (export-to-technicians
  // itself only operates on isUrgent:false appointments -- re-verified here).
  it('an urgent appointment can never appear in the pending-export-approval list', async () => {
    const urgentRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 3600000).toISOString(), isUrgent: true, urgentLocation: 'Test' });
    createdAppointmentIds.push(urgentRes.body.data.id);
    const list = await request(ts.baseUrl).get('/api/appointments/pending-export-approval').set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.data.map((a: any) => a.id)).not.toContain(urgentRes.body.data.id);
  });

  // 25, 26, 27. Regressions
  it('the normal Admin Appointments list endpoint still returns everything, unaffected by this new route (regression)', async () => {
    const id = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.find((a: any) => a.id === id)).toBeTruthy();
  });

  it('the Modification #5 export action still works end-to-end outside this page (regression)', async () => {
    const id = await createSchedulingAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/export-to-technicians`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.visibleToTechnician).toBe(false);
    expect(res.body.data.adminApproved).toBe(false);
  });

  it('the Modification #8 completion/confirmation workflow still works after an export approval (regression)', async () => {
    const id = await createSchedulingAppointment({ technicianId: users.technician.id });
    await exportAppointment(id);
    await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});

    await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    const completeRes = await request(ts.baseUrl)
      .patch(`/api/appointments/${id}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ serviceDetails: 'x', completionAmount: 100, completionPaymentMethod: 'CASH', actualCompletionDate: new Date().toISOString().slice(0, 10) });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.maintenanceConfirmed).toBe(false);

    const confirmRes = await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.maintenanceConfirmed).toBe(true);
  });
});
