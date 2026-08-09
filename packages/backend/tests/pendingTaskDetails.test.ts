// Modification #9: Technician cards/detail must show useful information for a
// PENDING (workStatus WAITING) task without requiring Start/Complete. This
// modification is frontend-only -- GET /appointments and GET /appointments/:id
// already return every field the UI needs for a Technician, unstripped. These
// tests lock that in as a permanent regression guard, and re-confirm the
// existing visibility/assignment/urgent/privacy rules are unaffected.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Modification #9: pending Technician task details', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string, tech2Token: string;
  let customerId: string;
  const createdAppointmentIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
    tech2Token = signTestToken(users.technician2.id, 'TECHNICIAN');

    const custRes = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Pending Task Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Riyadh', district: 'Olaya', street: 'King Fahd Rd' },
      });
    customerId = custRes.body.data.id;
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

  async function createPendingAppointment(overrides: Record<string, any> = {}) {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        notes: 'Bring spare filter cartridge',
        technicianId: users.technician.id,
        ...overrides,
      });
    createdAppointmentIds.push(res.body.data.id);
    return res.body.data.id;
  }

  // 8. GET /appointments returns required pending-card fields
  it('Technician GET /appointments returns customer, address, notes, full scheduledDate, and technician assignment for a pending task', async () => {
    await createPendingAppointment();
    const res = await request(ts.baseUrl).get('/api/appointments?workStatus=WAITING,IN_PROGRESS').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    const found = res.body.data.find((a: any) => a.customer?.name === 'Pending Task Customer');
    expect(found).toBeTruthy();
    expect(found.workStatus).toBe('WAITING');
    expect(found.customer.name).toBe('Pending Task Customer');
    expect(found.customer.phone).toBeTruthy();
    expect(found.customer.address.city).toBe('Riyadh');
    expect(found.notes).toBe('Bring spare filter cartridge');
    expect(found.type).toBe('MAINTENANCE');
    expect(found.technicianId).toBe(users.technician.id);
    expect(found.technician?.name).toBeTruthy();
    // scheduledDate must carry full date+time, not just a bare date
    expect(new Date(found.scheduledDate).toISOString()).toBe(found.scheduledDate);
  });

  // 9. GET /appointments/:id returns required pending-detail fields
  it('Technician GET /appointments/:id returns the same full set of pending-detail fields', async () => {
    const id = await createPendingAppointment({ notes: 'Gate code is 4471' });
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Gate code is 4471');
    expect(res.body.data.customer.address.district).toBe('Olaya');
    expect(res.body.data.workStatus).toBe('WAITING');
    expect(res.body.data.technicianId).toBe(users.technician.id);
  });

  it('an unassigned (pool) pending task reports technicianId as null so the UI can show it as unassigned', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString() });
    createdAppointmentIds.push(res.body.data.id);
    const detail = await request(ts.baseUrl).get(`/api/appointments/${res.body.data.id}`).set('Authorization', `Bearer ${techToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.technicianId).toBeNull();
  });

  // 6 & 7. Opening/viewing a pending task never changes its state
  it('viewing a pending task (GET) never changes workStatus, and repeated views are idempotent', async () => {
    const id = await createPendingAppointment();
    const before = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    expect(before.body.data.workStatus).toBe('WAITING');
    // View it multiple times.
    await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    const after = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    expect(after.body.data.workStatus).toBe('WAITING');
    expect(after.body.data.version).toBe(before.body.data.version);
    const dbRow = await prisma.appointment.findUnique({ where: { id } });
    expect(dbRow?.workStatus).toBe('WAITING');
    expect(dbRow?.startedAt).toBeNull();
  });

  // 10. Hidden by visibleToTechnician=false remains hidden
  it('a Scheduling-exported appointment pending Admin approval remains hidden from the pending list/detail (Modification #5 regression)', async () => {
    const schedApptRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString() });
    const id = schedApptRes.body.data.id;
    createdAppointmentIds.push(id);
    await request(ts.baseUrl).patch(`/api/appointments/${id}/export-to-technicians`).set('Authorization', `Bearer ${schedToken}`).send({});

    const detail = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    expect(detail.status).toBe(404);

    const list = await request(ts.baseUrl).get('/api/appointments?workStatus=WAITING,IN_PROGRESS').set('Authorization', `Bearer ${techToken}`);
    expect(list.body.data.find((a: any) => a.id === id)).toBeUndefined();
  });

  it('after Admin approves the export, the appointment appears normally with full pending-detail fields (Modification #5 regression)', async () => {
    const schedApptRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString(), notes: 'Approved job note' });
    const id = schedApptRes.body.data.id;
    createdAppointmentIds.push(id);
    await request(ts.baseUrl).patch(`/api/appointments/${id}/export-to-technicians`).set('Authorization', `Bearer ${schedToken}`).send({});
    await request(ts.baseUrl).patch(`/api/appointments/${id}/approve-export`).set('Authorization', `Bearer ${adminToken}`).send({});

    const detail = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.notes).toBe('Approved job note');
    expect(detail.body.data.workStatus).toBe('WAITING');
  });

  // 11. Assignment isolation -- another technician's non-urgent pending task stays hidden
  it('a second Technician cannot retrieve a task exclusively assigned to the first Technician', async () => {
    const id = await createPendingAppointment();
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${tech2Token}`);
    expect(res.status).toBe(404);
    const list = await request(ts.baseUrl).get('/api/appointments?workStatus=WAITING,IN_PROGRESS').set('Authorization', `Bearer ${tech2Token}`);
    expect(list.body.data.find((a: any) => a.id === id)).toBeUndefined();
  });

  it('an unassigned pending task is visible to any Technician (shared pool)', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString() });
    const id = res.body.data.id;
    createdAppointmentIds.push(id);
    const detail = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${tech2Token}`);
    expect(detail.status).toBe(200);
  });

  // 14. Urgent pending appointment still displays correctly
  it('an urgent pending appointment still exposes urgentLocation and notes to any Technician', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        isUrgent: true,
        urgentLocation: JSON.stringify({ city: 'Jeddah', district: 'Al Hamra' }),
        notes: 'Customer reports leak under sink',
      });
    const id = res.body.data.id;
    createdAppointmentIds.push(id);
    const list = await request(ts.baseUrl).get('/api/appointments?urgent=true').set('Authorization', `Bearer ${techToken}`);
    const found = list.body.data.find((a: any) => a.id === id);
    expect(found).toBeTruthy();
    expect(found.isUrgent).toBe(true);
    expect(JSON.parse(found.urgentLocation).city).toBe('Jeddah');
    expect(found.notes).toBe('Customer reports leak under sink');
    expect(found.workStatus).toBe('WAITING');
  });

  // 15 & 16. In-progress and completed states unaffected
  it('an IN_PROGRESS task still returns full detail fields (regression)', async () => {
    const id = await createPendingAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    const res = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    expect(res.body.data.workStatus).toBe('IN_PROGRESS');
    expect(res.body.data.notes).toBeTruthy();
    expect(res.body.data.customer.address).toBeTruthy();
  });

  // 17 & 18 & 19. Modification #8 completion workflow (actualCompletionDate,
  // maintenanceConfirmed) still works unmodified.
  it('the full start -> complete workflow (Modification #8 fields included) still works end-to-end', async () => {
    const id = await createPendingAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    const dateStr = new Date().toISOString().slice(0, 10);
    const completeRes = await request(ts.baseUrl)
      .patch(`/api/appointments/${id}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ serviceDetails: 'Replaced filter', completionAmount: 200, completionPaymentMethod: 'CASH', actualCompletionDate: dateStr });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.workStatus).toBe('COMPLETED');
    expect(completeRes.body.data.actualCompletionDate).toBeTruthy();
    expect(completeRes.body.data.maintenanceConfirmed).toBe(false);

    const confirmRes = await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.maintenanceConfirmed).toBe(true);
  });

  // 20. No financial/privacy regression for pending tasks
  it('a pending task never carries a completionAmount value (nothing to leak, and Scheduling privacy is unaffected)', async () => {
    const id = await createPendingAppointment();
    const techView = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${techToken}`);
    expect(techView.body.data.completionAmount).toBeNull();
    const schedView = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(schedView.body.data.completionAmount).toBeUndefined();
  });
});
