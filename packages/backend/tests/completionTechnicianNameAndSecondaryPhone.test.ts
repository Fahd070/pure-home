// Focused modification batch:
// (A) Normal (non-urgent) Technician completion: the submitted "Technician
//     Name" is now persisted as Appointment.completionTechnicianName (a
//     completion-record field, never used for permissions/ownership/audit --
//     the `technician` relation and req.user!.userId remain authoritative,
//     unchanged from technicianNameCompletion.test.ts) and surfaced through
//     GET /technicians for the Admin "Completed Task Details" view. Legacy
//     completions (or Admin completions, which never submit a name) simply
//     have a null value -- the frontend fallback to the technician relation's
//     first name is covered at the source level in packages/web/tests.
// (B) Customer.secondaryPhone: an optional second contact number, same
//     05XXXXXXXX format as the required primary `phone`, validated and
//     persisted through the existing create/update endpoints. No new
//     uniqueness constraint beyond "must differ from this customer's own
//     primary phone" -- matches the existing (lack of) global uniqueness
//     rule on `phone` itself.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

function dateOnly(d: Date | string): string { return new Date(d).toISOString().slice(0, 10); }

describe('Completion Technician Name persistence/display + Customer secondaryPhone', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string;
  let customerId: string;
  const createdAppointmentIds: string[] = [];
  const createdCustomerIds: string[] = [];

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
        name: 'Completion Name / Secondary Phone Batch Customer',
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
    if (createdCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await stopTestServer(ts.server);
  });

  async function createInProgressAppointment() {
    const apptRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString(), technicianId: users.technician.id });
    const id = apptRes.body.data.id;
    createdAppointmentIds.push(id);
    await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    return id;
  }

  const baseBody = {
    serviceDetails: 'Serviced units',
    completionAmount: 300,
    completionPaymentMethod: 'CASH',
    actualCompletionDate: dateOnly(new Date()),
  };

  // ================= Part A: completionTechnicianName =================

  it('3. the submitted technician name is persisted on the Appointment row', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'Sultan' });
    expect(res.status).toBe(200);
    expect(res.body.data.completionTechnicianName).toBe('Sultan');

    const row = await prisma.appointment.findUnique({ where: { id } });
    expect(row?.completionTechnicianName).toBe('Sultan');
  });

  it('an Admin completion (no technicianName submitted) stores a null completionTechnicianName, not a blank string', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${adminToken}`)
      .send(baseBody);
    expect(res.status).toBe(200);
    expect(res.body.data.completionTechnicianName).toBeNull();
  });

  it('5. GET /technicians (Admin) returns the submitted completionTechnicianName for a completed task', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'Fahad' });

    const res = await request(ts.baseUrl).get('/api/technicians').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const tech = res.body.data.find((t: any) => t.id === users.technician.id);
    const task = tech.completedTasksList.find((x: any) => x.id === id);
    expect(task.completionTechnicianName).toBe('Fahad');
  });

  it('6. GET /technicians returns null completionTechnicianName for a legacy/Admin completion, distinct from the technician relation (frontend fallback covered at source level)', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${adminToken}`)
      .send(baseBody);

    const res = await request(ts.baseUrl).get('/api/technicians').set('Authorization', `Bearer ${adminToken}`);
    const tech = res.body.data.find((t: any) => t.id === users.technician.id);
    const task = tech.completedTasksList.find((x: any) => x.id === id);
    expect(task.completionTechnicianName).toBeNull();
    // The technician relation itself is still identifiable via the parent object's name.
    expect(tech.name).toBeTruthy();
  });

  it('7. completionTechnicianName IS visible to Scheduling via /technicians (not financial data, unaffected by the completionAmount privacy stripper)', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'Nasser' });

    const res = await request(ts.baseUrl).get('/api/technicians').set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    const tech = res.body.data.find((t: any) => t.id === users.technician.id);
    const task = tech.completedTasksList.find((x: any) => x.id === id);
    expect(task.completionTechnicianName).toBe('Nasser');
    // Regression: the actual financial fields remain stripped for Scheduling.
    expect(task.completionAmount).toBeUndefined();
    expect(task.completionPaymentMethod).toBeUndefined();
  });

  // ================= Part B: Customer.secondaryPhone =================

  it('8. Customer can be created with primary phone only (secondaryPhone omitted -> null)', async () => {
    const phone = testPhone();
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Primary Only', phone, maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    expect(res.status).toBe(201);
    expect(res.body.data.secondaryPhone).toBeNull();
    createdCustomerIds.push(res.body.data.id);
  });

  it('9. Customer can be created with primary + secondary phone', async () => {
    const phone = testPhone();
    const secondaryPhone = testPhone();
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Primary And Secondary', phone, secondaryPhone, maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    expect(res.status).toBe(201);
    expect(res.body.data.secondaryPhone).toBe(secondaryPhone);
    createdCustomerIds.push(res.body.data.id);
  });

  it('10. secondaryPhone is optional -- a blank string at create time is accepted and stored as null', async () => {
    const phone = testPhone();
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Blank Secondary', phone, secondaryPhone: '   ', maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    expect(res.status).toBe(201);
    expect(res.body.data.secondaryPhone).toBeNull();
    createdCustomerIds.push(res.body.data.id);
  });

  it('11. a malformed secondary phone is rejected (400), customer not created', async () => {
    const phone = testPhone();
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bad Secondary', phone, secondaryPhone: '12345', maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    expect(res.status).toBe(400);
    const found = await prisma.customer.findFirst({ where: { name: 'Bad Secondary' } });
    expect(found).toBeNull();
  });

  it('12. a secondary phone identical to the primary is rejected with the exact Arabic message', async () => {
    const phone = testPhone();
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Same As Primary', phone, secondaryPhone: phone, maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('رقم الجوال الإضافي يجب أن يكون مختلفًا عن رقم الجوال الأساسي');
  });

  it('13. secondary phone can be updated to a new value via PUT', async () => {
    const phone = testPhone();
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'To Be Updated', phone, secondaryPhone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);

    const newSecondary = testPhone();
    const res = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ secondaryPhone: newSecondary, version: createRes.body.data.version });
    expect(res.status).toBe(200);
    expect(res.body.data.secondaryPhone).toBe(newSecondary);
  });

  it('14. secondary phone can be cleared via PUT (empty string -> null), primary phone untouched', async () => {
    const phone = testPhone();
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'To Be Cleared', phone, secondaryPhone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);

    const res = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ secondaryPhone: '', version: createRes.body.data.version });
    expect(res.status).toBe(200);
    expect(res.body.data.secondaryPhone).toBeNull();
    expect(res.body.data.phone).toBe(phone);
  });

  it('omitting secondaryPhone entirely on PUT leaves the existing value untouched (partial-update semantics)', async () => {
    const phone = testPhone();
    const secondaryPhone = testPhone();
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Untouched On Partial Update', phone, secondaryPhone, maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);

    const res = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'unrelated update', version: createRes.body.data.version });
    expect(res.status).toBe(200);
    expect(res.body.data.secondaryPhone).toBe(secondaryPhone);
  });

  it('18. customer search finds a customer by their secondary phone', async () => {
    const phone = testPhone();
    const secondaryPhone = testPhone();
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Findable By Secondary', phone, secondaryPhone, maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    createdCustomerIds.push(createRes.body.data.id);

    const res = await request(ts.baseUrl).get('/api/customers').set('Authorization', `Bearer ${adminToken}`).query({ search: secondaryPhone });
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: any) => c.id === createRes.body.data.id)).toBe(true);
  });

  it('19. existing primary-phone search still works (regression)', async () => {
    const phone = testPhone();
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Findable By Primary', phone, maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    createdCustomerIds.push(createRes.body.data.id);

    const res = await request(ts.baseUrl).get('/api/customers').set('Authorization', `Bearer ${adminToken}`).query({ search: phone });
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: any) => c.id === createRes.body.data.id)).toBe(true);
  });

  it('20. a legacy customer with a null secondaryPhone continues to work normally end-to-end (fetch, unrelated update)', async () => {
    const phone = testPhone();
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Legacy Null Secondary', phone, maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);
    expect(createRes.body.data.secondaryPhone).toBeNull();

    const getRes = await request(ts.baseUrl).get(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.secondaryPhone).toBeNull();

    const putRes = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'legacy customer, unrelated field update', version: createRes.body.data.version });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data.secondaryPhone).toBeNull();
  });

  it('Scheduling can also create a customer with a secondary phone (role parity with Admin)', async () => {
    const phone = testPhone();
    const secondaryPhone = testPhone();
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${schedToken}`)
      .send({ name: 'Scheduling Created', phone, secondaryPhone, maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: { city: 'Riyadh', district: 'Test', street: 'Test' } });
    expect(res.status).toBe(201);
    expect(res.body.data.secondaryPhone).toBe(secondaryPhone);
    createdCustomerIds.push(res.body.data.id);
  });
});
