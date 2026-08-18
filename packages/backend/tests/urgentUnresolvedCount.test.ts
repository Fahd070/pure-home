// Perf fix: the Admin/Technician Sidebar urgent badges now call
// GET /appointments/urgent-unresolved-count instead of fetching every urgent
// appointment's full relation graph via GET /appointments?urgent=true just to
// compute `.filter(a => !a.urgentVisitRecord).length` client-side. This file
// proves the new endpoint preserves the exact same "unresolved" and
// visibility semantics that query already had for ADMIN/TECHNICIAN.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('GET /appointments/urgent-unresolved-count', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;
  const createdAppointmentIds: string[] = [];
  const createdCustomerIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) {
      await prisma.urgentVisitRecord.deleteMany({ where: { appointmentId: { in: createdAppointmentIds } } });
      await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    }
    if (createdCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await stopTestServer(ts.server);
  });

  async function createUrgentAppointment(overrides: Record<string, any> = {}) {
    const res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        isUrgent: true,
        urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'Olaya', street: 'King Fahd Rd' }),
        customerName: 'Urgent Count Test Customer',
        customerPhone: testPhone(),
        ...overrides,
      });
    if (res.body?.data?.id) createdAppointmentIds.push(res.body.data.id);
    if (res.body?.data?.customerId) createdCustomerIds.push(res.body.data.customerId);
    return res;
  }

  function currentCount(token: string) {
    return request(ts.baseUrl).get('/api/appointments/urgent-unresolved-count').set('Authorization', `Bearer ${token}`);
  }

  it('1/6. Admin count reflects the real unresolved-urgent total, returned as a bare number envelope (no relations/rows)', async () => {
    const before = await currentCount(adminToken);
    expect(before.status).toBe(200);
    expect(typeof before.body.data).toBe('number');
    expect(Object.keys(before.body).sort()).toEqual(['data', 'success']);

    await createUrgentAppointment();
    await createUrgentAppointment();

    const after = await currentCount(adminToken);
    expect(after.body.data).toBe(before.body.data + 2);
  });

  it('2. a resolved urgent appointment (has an urgentVisitRecord) is excluded from the count', async () => {
    const created = await createUrgentAppointment();
    const before = await currentCount(adminToken);

    await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ appointmentId: created.body.data.id, serviceType: 'VISIT_ONLY', technicianName: 'Ahmed' });

    const after = await currentCount(adminToken);
    expect(after.body.data).toBe(before.body.data - 1);
  });

  it('3. a non-urgent appointment never contributes to the count', async () => {
    const before = await currentCount(adminToken);

    const custRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Non-Urgent Count Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Jeddah', district: 'Test', street: 'Test' },
      });
    createdCustomerIds.push(custRes.body.data.id);

    const apptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId: custRes.body.data.id, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString() });
    createdAppointmentIds.push(apptRes.body.data.id);

    const after = await currentCount(adminToken);
    expect(after.body.data).toBe(before.body.data);
  });

  it('4. Technician count excludes an urgent appointment Admin has hidden from Technicians (visibleToTechnician=false), Admin count is unaffected', async () => {
    const created = await createUrgentAppointment();
    const beforeAdmin = await currentCount(adminToken);
    const beforeTech = await currentCount(techToken);

    // Simulates the same (visibleToTechnician=false) state the export-approval
    // workflow uses for non-urgent appointments -- an urgent appointment can't
    // reach this state through any current UI action, but GET /appointments's
    // own TECHNICIAN filter already defends against it (Modification #5), so
    // this endpoint must match that defense exactly.
    await prisma.appointment.update({ where: { id: created.body.data.id }, data: { visibleToTechnician: false } });

    const afterAdmin = await currentCount(adminToken);
    const afterTech = await currentCount(techToken);
    expect(afterAdmin.body.data).toBe(beforeAdmin.body.data);
    expect(afterTech.body.data).toBe(beforeTech.body.data - 1);
  });

  it('5. SCHEDULING is rejected -- not an allowed role for this endpoint', async () => {
    const res = await currentCount(schedToken);
    expect(res.status).toBe(403);
  });

  it('5. an unauthenticated request is rejected', async () => {
    const res = await request(ts.baseUrl).get('/api/appointments/urgent-unresolved-count');
    expect(res.status).toBe(401);
  });
});
