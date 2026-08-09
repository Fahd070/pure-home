// Modification #12: the Scheduling "Add Customer" UI no longer collects
// Installation Date. The backend contract itself is untouched (the field was
// already optional on POST /customers and update-only-if-present on PUT), so
// these tests lock in the contract the now-simplified frontend relies on and
// guard the parts explicitly called out as regression risk: omitting the
// field must never fabricate a date, other legitimate callers that still
// send installationDate must keep working, historical values on existing
// customers must survive unrelated edits, and INSTALLATION appointments
// (a completely different model) must be unaffected.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Modification #12: Customer.installationDate omission from Scheduling Add Customer', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string;
  const createdCustomerIds: string[] = [];
  const createdAppointmentIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    if (createdCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await stopTestServer(ts.server);
  });

  it('Scheduling can create a customer with no installationDate key at all (the new Add Customer payload shape)', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({
        name: 'No Install Date Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Dammam', district: 'Test', street: 'Test' },
      });
    expect(res.status).toBe(201);
    createdCustomerIds.push(res.body.data.id);
    expect(res.body.data.installationDate).toBeFalsy();
  });

  it('does not fabricate a date: an explicit installationDate:"" is also not stored as a real date', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({
        name: 'Empty Install Date Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        installationDate: '',
        address: { city: 'Dammam', district: 'Test', street: 'Test' },
      });
    expect(res.status).toBe(201);
    createdCustomerIds.push(res.body.data.id);
    expect(res.body.data.installationDate).toBeFalsy();
  });

  it('a legitimate caller that still sends a real installationDate is still accepted unchanged (backend contract untouched)', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Admin Install Date Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        installationDate: '2025-05-10',
        address: { city: 'Dammam', district: 'Test', street: 'Test' },
      });
    expect(res.status).toBe(201);
    createdCustomerIds.push(res.body.data.id);
    expect(new Date(res.body.data.installationDate).toISOString().slice(0, 10)).toBe('2025-05-10');
  });

  it('an existing customer with a historical installationDate retains it when an unrelated field is edited', async () => {
    const createRes = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Historical Install Date Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        installationDate: '2024-01-15',
        address: { city: 'Riyadh', district: 'Test', street: 'Test' },
      });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);

    const updateRes = await request(ts.baseUrl)
      .put(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ notes: 'Just updating notes', version: 1 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.notes).toBe('Just updating notes');
    expect(new Date(updateRes.body.data.installationDate).toISOString().slice(0, 10)).toBe('2024-01-15');

    const readBack = await request(ts.baseUrl).get(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(new Date(readBack.body.data.installationDate).toISOString().slice(0, 10)).toBe('2024-01-15');
  });

  it('explicitly setting installationDate to an empty string on update still works as a deliberate clear (unchanged pre-existing behavior, not exercised by the new Add Customer form)', async () => {
    const createRes = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'To Be Cleared Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        installationDate: '2024-06-01',
        address: { city: 'Riyadh', district: 'Test', street: 'Test' },
      });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);

    const updateRes = await request(ts.baseUrl)
      .put(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ installationDate: '', version: 1 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.installationDate).toBeFalsy();
  });

  it('customer search/list still returns customers with and without installationDate unchanged', async () => {
    const res = await request(ts.baseUrl)
      .get('/api/customers')
      .set('Authorization', `Bearer ${schedToken}`)
      .query({ search: 'Install Date Customer', limit: 50 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('INSTALLATION-type appointments remain unaffected -- Appointment.type is unrelated to Customer.installationDate', async () => {
    const custRes = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({
        name: 'Install Appointment Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Jeddah', district: 'Test', street: 'Test' },
      });
    const customerId = custRes.body.data.id;
    createdCustomerIds.push(customerId);
    expect(custRes.body.data.installationDate).toBeFalsy();

    const apptRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, type: 'INSTALLATION', scheduledDate: new Date(Date.now() + 86400000).toISOString() });
    expect(apptRes.status).toBe(201);
    createdAppointmentIds.push(apptRes.body.data.id);
    expect(apptRes.body.data.type).toBe('INSTALLATION');
  });
});
