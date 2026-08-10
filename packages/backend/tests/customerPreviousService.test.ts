// Focused modification batch: optional one-time "Previous Service" historical
// record on Customer (previousServiceType/previousServiceDate/previousServiceNote).
// This is customer historical metadata ONLY -- never an Appointment, never a
// completed task, never touches Appointment/dashboard counts. See
// resolvePreviousService() in routes/customers.ts for the all-or-nothing
// validation rule this file exercises.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

function dateOnly(d: Date | string): string { return new Date(d).toISOString().slice(0, 10); }
function toApiDate(dateOnlyStr: string): string { return `${dateOnlyStr}T23:59:59`; }

describe('Customer Previous Service (historical metadata, not an Appointment)', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string;
  const createdCustomerIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
  });

  afterAll(async () => {
    if (createdCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await stopTestServer(ts.server);
  });

  const baseAddress = { city: 'Riyadh', district: 'Test', street: 'Test' };

  // 6. Customer can be created without previous-service data.
  it('6. creates a customer successfully with no previous-service data at all (all three fields null)', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'No Previous Service', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress });
    expect(res.status).toBe(201);
    expect(res.body.data.previousServiceType).toBeNull();
    expect(res.body.data.previousServiceDate).toBeNull();
    expect(res.body.data.previousServiceNote).toBeNull();
    createdCustomerIds.push(res.body.data.id);
  });

  // 7. Customer can be created with previous installation.
  it('7. creates a customer with a previous INSTALLATION record', async () => {
    const svcDate = toApiDate('2025-01-15');
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Previous Installation Customer', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'INSTALLATION', previousServiceDate: svcDate, previousServiceNote: 'Installed by another company',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.previousServiceType).toBe('INSTALLATION');
    expect(dateOnly(res.body.data.previousServiceDate)).toBe('2025-01-15');
    expect(res.body.data.previousServiceNote).toBe('Installed by another company');
    createdCustomerIds.push(res.body.data.id);
  });

  // 8. Customer can be created with previous maintenance.
  it('8. creates a customer with a previous MAINTENANCE record', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Previous Maintenance Customer', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'MAINTENANCE', previousServiceDate: toApiDate('2025-06-01'),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.previousServiceType).toBe('MAINTENANCE');
    createdCustomerIds.push(res.body.data.id);
  });

  // 9. previousServiceType is validated.
  it('9. rejects an invalid previousServiceType', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Invalid Type', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'REPAIR', previousServiceDate: toApiDate('2025-06-01'),
      });
    expect(res.status).toBe(400);
    const found = await prisma.customer.findFirst({ where: { name: 'Invalid Type' } });
    expect(found).toBeNull();
  });

  // 10. previousServiceDate is required when service type is provided.
  it('10. rejects a type with no date (incomplete half-record)', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Type No Date', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'INSTALLATION',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/تاريخ الخدمة السابقة مطلوب/);
  });

  // 11. service type is required when date is provided.
  it('11. rejects a date with no type (incomplete half-record)', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Date No Type', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceDate: toApiDate('2025-06-01'),
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/نوع الخدمة السابقة مطلوب/);
  });

  it('rejects a note-only submission (note alone does not complete the record)', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Note Only', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceNote: 'Just a note',
      });
    expect(res.status).toBe(400);
  });

  // 12. note remains optional.
  it('12. accepts a full previous-service record with no note (note is optional even when type+date are present)', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'No Note', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'MAINTENANCE', previousServiceDate: toApiDate('2025-06-01'),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.previousServiceNote).toBeNull();
    createdCustomerIds.push(res.body.data.id);
  });

  // 15. date survives save/refetch with no timezone shift.
  it('15. the saved previousServiceDate survives a refetch with no calendar-day shift', async () => {
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Date Roundtrip', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'INSTALLATION', previousServiceDate: toApiDate('2025-03-20'),
      });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);

    const getRes = await request(ts.baseUrl).get(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    expect(dateOnly(getRes.body.data.previousServiceDate)).toBe('2025-03-20');
  });

  // 19. edit (PUT) can update previous-service data.
  it('19. PUT updates an existing previous-service record to a new type/date/note', async () => {
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'To Be Updated PS', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'INSTALLATION', previousServiceDate: toApiDate('2025-01-01'), previousServiceNote: 'Old note',
      });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);

    const res = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ previousServiceType: 'MAINTENANCE', previousServiceDate: toApiDate('2025-07-07'), previousServiceNote: 'New note', version: createRes.body.data.version });
    expect(res.status).toBe(200);
    expect(res.body.data.previousServiceType).toBe('MAINTENANCE');
    expect(dateOnly(res.body.data.previousServiceDate)).toBe('2025-07-07');
    expect(res.body.data.previousServiceNote).toBe('New note');
  });

  it('PUT can add a previous-service record to a customer that had none', async () => {
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Add PS Later', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);
    expect(createRes.body.data.previousServiceType).toBeNull();

    const res = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ previousServiceType: 'INSTALLATION', previousServiceDate: toApiDate('2024-11-11'), version: createRes.body.data.version });
    expect(res.status).toBe(200);
    expect(res.body.data.previousServiceType).toBe('INSTALLATION');
  });

  it('PUT partial-update: changing only the note keeps the existing type/date (merge-with-existing)', async () => {
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Merge Note Only', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'MAINTENANCE', previousServiceDate: toApiDate('2025-05-05'),
      });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);

    const res = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ previousServiceNote: 'Added later', version: createRes.body.data.version });
    expect(res.status).toBe(200);
    expect(res.body.data.previousServiceType).toBe('MAINTENANCE');
    expect(dateOnly(res.body.data.previousServiceDate)).toBe('2025-05-05');
    expect(res.body.data.previousServiceNote).toBe('Added later');
  });

  it('PUT rejects clearing type alone while date still exists (would leave an incomplete half-record)', async () => {
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Reject Half Clear', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'INSTALLATION', previousServiceDate: toApiDate('2025-02-02'),
      });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);

    const res = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ previousServiceType: '', version: createRes.body.data.version });
    expect(res.status).toBe(400);
  });

  // 20. edit (PUT) can clear previous-service data entirely.
  it('20. PUT clears the whole previous-service record when all three are sent blank', async () => {
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'To Be Cleared PS', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'MAINTENANCE', previousServiceDate: toApiDate('2025-04-04'), previousServiceNote: 'Some note',
      });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);

    const res = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ previousServiceType: '', previousServiceDate: '', previousServiceNote: '', version: createRes.body.data.version });
    expect(res.status).toBe(200);
    expect(res.body.data.previousServiceType).toBeNull();
    expect(res.body.data.previousServiceDate).toBeNull();
    expect(res.body.data.previousServiceNote).toBeNull();
  });

  it('PUT omitting all three previous-service keys leaves the existing record untouched (partial-update semantics)', async () => {
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Untouched PS', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'INSTALLATION', previousServiceDate: toApiDate('2025-08-08'),
      });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);

    const res = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'unrelated update', version: createRes.body.data.version });
    expect(res.status).toBe(200);
    expect(res.body.data.previousServiceType).toBe('INSTALLATION');
  });

  // 21. legacy customers with null fields continue to work.
  it('21. a legacy customer with all-null previous-service fields continues to work end-to-end', async () => {
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Legacy Null PS', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress });
    const id = createRes.body.data.id;
    createdCustomerIds.push(id);

    const getRes = await request(ts.baseUrl).get(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.previousServiceType).toBeNull();

    const putRes = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'legacy customer, unrelated field update', version: createRes.body.data.version });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data.previousServiceType).toBeNull();
  });

  // 22. historical service does NOT create Appointment records or affect task/dashboard counts.
  it('22. creating a customer with a full previous-service record creates zero Appointment rows', async () => {
    const before = await prisma.appointment.count();
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'No Fake Appointment', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'INSTALLATION', previousServiceDate: toApiDate('2025-01-01'), previousServiceNote: 'note',
      });
    expect(res.status).toBe(201);
    createdCustomerIds.push(res.body.data.id);
    const after = await prisma.appointment.count();
    expect(after).toBe(before);

    // Confirm no appointment references this customer either.
    const linked = await prisma.appointment.findMany({ where: { customerId: res.body.data.id } });
    expect(linked.length).toBe(0);
  });

  it('previousServiceType/Date/Note are visible to Scheduling (not financial data, no privacy stripping applies)', async () => {
    const createRes = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Scheduling Visibility PS', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'MAINTENANCE', previousServiceDate: toApiDate('2025-09-09'),
      });
    createdCustomerIds.push(createRes.body.data.id);

    const res = await request(ts.baseUrl).get(`/api/customers/${createRes.body.data.id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.previousServiceType).toBe('MAINTENANCE');
  });

  it('Scheduling can also create a customer with a previous-service record (role parity with Admin)', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${schedToken}`)
      .send({
        name: 'Scheduling Created PS', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        previousServiceType: 'INSTALLATION', previousServiceDate: toApiDate('2025-10-10'),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.previousServiceType).toBe('INSTALLATION');
    createdCustomerIds.push(res.body.data.id);
  });
});
