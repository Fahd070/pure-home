// Modification #7: GET /customers/:id/latest-maintenance-note -- surfaces the
// most recent COMPLETED appointment's nextMaintenanceNote (Modification #6) for
// display when Admin/Scheduling schedules that customer's next appointment.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('GET /customers/:id/latest-maintenance-note', () => {
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

  async function createCustomer() {
    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Latest Note Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Jeddah', district: 'Test', street: 'Test' },
      });
    createdCustomerIds.push(res.body.data.id);
    return res.body.data.id;
  }

  // Creates a COMPLETED appointment for the customer with a specific completedAt
  // and nextMaintenanceNote, bypassing the normal start->complete HTTP flow (which
  // always uses "now") so the test can control completion chronology directly --
  // exactly what the modification's "query test cases" need to verify ordering.
  async function createCompletedAppointment(customerId: string, completedAt: Date, nextMaintenanceNote: string | null) {
    const appt = await prisma.appointment.create({
      data: {
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: completedAt,
        workStatus: 'COMPLETED',
        completedAt,
        serviceDetails: 'x',
        completionAmount: 123.45,
        completionPaymentMethod: 'CASH',
        nextMaintenanceNote,
        createdByRole: 'ADMIN',
        technicianId: users.technician.id,
      },
    });
    createdAppointmentIds.push(appt.id);
    return appt;
  }

  // 1 & 2. Admin and Scheduling both see a customer's one previous note
  it('Admin sees the note when the customer has one previous completed appointment with a note', async () => {
    const customerId = await createCustomer();
    await createCompletedAppointment(customerId, new Date(Date.now() - 86400000), 'Check filter');
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.nextMaintenanceNote).toBe('Check filter');
  });

  it('Scheduling/Maintenance sees the note when the customer has one previous completed appointment with a note', async () => {
    const customerId = await createCustomer();
    await createCompletedAppointment(customerId, new Date(Date.now() - 86400000), 'Check filter');
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.nextMaintenanceNote).toBe('Check filter');
  });

  // 3. No note -> section not rendered == nextMaintenanceNote null
  it('returns null when the customer has no previous note', async () => {
    const customerId = await createCustomer();
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.nextMaintenanceNote).toBeNull();
  });

  it('returns null when the customer has appointments but none are completed', async () => {
    const customerId = await createCustomer();
    await prisma.appointment.create({
      data: { customerId, type: 'MAINTENANCE', scheduledDate: new Date(), workStatus: 'WAITING', createdByRole: 'ADMIN' },
    }).then(a => createdAppointmentIds.push(a.id));
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.nextMaintenanceNote).toBeNull();
  });

  // 4 & Query Test Cases: latest completed appointment WITH a valid note wins,
  // not merely the latest appointment.
  it('QUERY TEST CASE: older note is used when the newest completion has a null note, then a newer valid note supersedes it', async () => {
    const customerId = await createCustomer();
    const older = new Date(Date.now() - 3 * 86400000);
    const newer = new Date(Date.now() - 2 * 86400000);
    await createCompletedAppointment(customerId, older, 'Check filter');
    await createCompletedAppointment(customerId, newer, null);

    let res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.nextMaintenanceNote).toBe('Check filter');

    const newest = new Date(Date.now() - 1 * 86400000);
    await createCompletedAppointment(customerId, newest, 'Inspect drainage');

    res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.nextMaintenanceNote).toBe('Inspect drainage');
  });

  // 5. A newer null-note appointment must not hide an older valid note (same as
  // the first half of the query test case above, isolated as its own scenario).
  it('a newer appointment with a null note does not hide an older valid note', async () => {
    const customerId = await createCustomer();
    await createCompletedAppointment(customerId, new Date(Date.now() - 2 * 86400000), 'Older valid note');
    await createCompletedAppointment(customerId, new Date(Date.now() - 86400000), null);
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.nextMaintenanceNote).toBe('Older valid note');
  });

  // 6. Whitespace-only notes are ignored (defense in depth -- the /complete
  // endpoint already normalizes these to null, but the query itself must also
  // correctly skip a row that somehow has one and fall back further).
  it('a whitespace-only note is ignored in favor of an older valid one', async () => {
    const customerId = await createCustomer();
    await createCompletedAppointment(customerId, new Date(Date.now() - 2 * 86400000), 'Real note');
    await prisma.appointment.create({
      data: {
        customerId, type: 'MAINTENANCE', scheduledDate: new Date(), workStatus: 'COMPLETED',
        completedAt: new Date(), nextMaintenanceNote: '   ', createdByRole: 'ADMIN',
      },
    }).then(a => createdAppointmentIds.push(a.id));
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.nextMaintenanceNote).toBe('Real note');
  });

  // 12. Unauthorized role rejected
  it('rejects Technician (not required for this scheduling feature)', async () => {
    const customerId = await createCustomer();
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const customerId = await createCustomer();
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`);
    expect(res.status).toBe(401);
  });

  // 13 & 14. No financial completion data ever exposed
  it('does not expose completionAmount', async () => {
    const customerId = await createCustomer();
    await createCompletedAppointment(customerId, new Date(), 'Check filter');
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.completionAmount).toBeUndefined();
  });

  it('does not expose completionPaymentMethod', async () => {
    const customerId = await createCustomer();
    await createCompletedAppointment(customerId, new Date(), 'Check filter');
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${schedToken}`);
    expect(res.body.data.completionPaymentMethod).toBeUndefined();
  });

  it('response shape contains only the fields the UI needs', async () => {
    const customerId = await createCustomer();
    const appt = await createCompletedAppointment(customerId, new Date(), 'Check filter');
    const res = await request(ts.baseUrl).get(`/api/customers/${customerId}/latest-maintenance-note`).set('Authorization', `Bearer ${adminToken}`);
    expect(Object.keys(res.body.data).sort()).toEqual(['appointmentId', 'completedAt', 'nextMaintenanceNote'].sort());
    expect(res.body.data.appointmentId).toBe(appt.id);
  });

  it('404s for a nonexistent customer', async () => {
    const res = await request(ts.baseUrl).get('/api/customers/nonexistent-id/latest-maintenance-note').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
