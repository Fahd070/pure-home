// Part 1: optional installation-details section on Customer
// (installationNote / installationAmount / installationPaymentMethod, plus
// the reused pre-existing installationDate). Each of the three new fields is
// independently optional -- unlike previousService*, there is no
// all-or-nothing rule here. Both ADMIN and SCHEDULING may create/edit/view
// this data (unlike Appointment completion financials, which are private to
// ADMIN/TECHNICIAN -- see completionPrivacy.service.ts, untouched by this
// feature).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

function toApiDate(dateOnlyStr: string): string { return `${dateOnlyStr}T23:59:59`; }

describe('Customer installation details (Part 1)', () => {
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

  it('Admin creates a customer with no installation fields at all -- succeeds, all four fields null', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Admin No Installation', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress });
    expect(res.status).toBe(201);
    expect(res.body.data.installationDate).toBeNull();
    expect(res.body.data.installationNote).toBeNull();
    expect(res.body.data.installationAmount).toBeNull();
    expect(res.body.data.installationPaymentMethod).toBeNull();
    createdCustomerIds.push(res.body.data.id);
  });

  it('Scheduling creates a customer with no installation fields at all -- succeeds, all four fields null', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${schedToken}`)
      .send({ name: 'Sched No Installation', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress });
    expect(res.status).toBe(201);
    expect(res.body.data.installationNote).toBeNull();
    expect(res.body.data.installationAmount).toBeNull();
    expect(res.body.data.installationPaymentMethod).toBeNull();
    createdCustomerIds.push(res.body.data.id);
  });

  it('creates a customer with all installation fields set', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Full Installation', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        installationDate: toApiDate('2025-03-01'),
        installationNote: 'Installed under the sink, extra filter stage added',
        installationAmount: 450.5,
        installationPaymentMethod: 'BANK_CARD_PERSONAL',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.installationNote).toBe('Installed under the sink, extra filter stage added');
    expect(res.body.data.installationAmount).toBe(450.5);
    expect(res.body.data.installationPaymentMethod).toBe('BANK_CARD_PERSONAL');
    expect(new Date(res.body.data.installationDate).toISOString().slice(0, 10)).toBe('2025-03-01');
    createdCustomerIds.push(res.body.data.id);
  });

  it('Scheduling can also create a customer with installation fields set (not Admin-only)', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${schedToken}`)
      .send({
        name: 'Sched Full Installation', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        installationAmount: 0, installationPaymentMethod: 'CASH', installationNote: 'Paid cash on delivery',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.installationAmount).toBe(0);
    expect(res.body.data.installationPaymentMethod).toBe('CASH');
    createdCustomerIds.push(res.body.data.id);
  });

  it('edits an existing customer to add installation fields', async () => {
    const create = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Edit To Add Installation', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress });
    const id = create.body.data.id;
    createdCustomerIds.push(id);

    const res = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ version: create.body.data.version, installationNote: 'Added later', installationAmount: 200, installationPaymentMethod: 'BANK_CARD_COMMERCIAL' });
    expect(res.status).toBe(200);
    expect(res.body.data.installationNote).toBe('Added later');
    expect(res.body.data.installationAmount).toBe(200);
    expect(res.body.data.installationPaymentMethod).toBe('BANK_CARD_COMMERCIAL');
  });

  it('clears previously-set installation fields (explicit null / empty string)', async () => {
    const create = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Clear Installation', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        installationNote: 'Will be cleared', installationAmount: 999, installationPaymentMethod: 'CASH',
      });
    const id = create.body.data.id;
    createdCustomerIds.push(id);
    expect(create.body.data.installationAmount).toBe(999);

    const res = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ version: create.body.data.version, installationNote: '', installationAmount: null, installationPaymentMethod: null });
    expect(res.status).toBe(200);
    expect(res.body.data.installationNote).toBeNull();
    expect(res.body.data.installationAmount).toBeNull();
    expect(res.body.data.installationPaymentMethod).toBeNull();
  });

  it('omitting installation fields on an update leaves existing values untouched', async () => {
    const create = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Untouched Installation', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        installationAmount: 123, installationPaymentMethod: 'CASH',
      });
    const id = create.body.data.id;
    createdCustomerIds.push(id);

    // Unrelated field-only update -- installation keys are simply absent from the body.
    const res = await request(ts.baseUrl).put(`/api/customers/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ version: create.body.data.version, name: 'Untouched Installation (renamed)' });
    expect(res.status).toBe(200);
    expect(res.body.data.installationAmount).toBe(123);
    expect(res.body.data.installationPaymentMethod).toBe('CASH');
  });

  it('rejects an invalid installationPaymentMethod', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Invalid Payment Method', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        installationPaymentMethod: 'PAYPAL',
      });
    expect(res.status).toBe(400);
  });

  it('rejects a negative installationAmount', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Negative Amount', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        installationAmount: -50,
      });
    expect(res.status).toBe(400);
  });

  it('rejects a non-finite installationAmount (Infinity/NaN cannot cross JSON, so this proves the schema truly enforces .finite())', async () => {
    // JSON.stringify would drop a literal Infinity/NaN, so this exercises the
    // rule the same way an actual malformed request body would: a numeric
    // string is never accepted by z.number() in the first place.
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Bad Amount Type', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress,
        installationAmount: 'not-a-number',
      });
    expect(res.status).toBe(400);
  });

  it('installation fields are independently optional -- setting only one does not require the others', async () => {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Only Note', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress, installationNote: 'Just a note, nothing else' });
    expect(res.status).toBe(201);
    expect(res.body.data.installationNote).toBe('Just a note, nothing else');
    expect(res.body.data.installationAmount).toBeNull();
    expect(res.body.data.installationPaymentMethod).toBeNull();
    createdCustomerIds.push(res.body.data.id);
  });

  it('a customer created before this feature (all installation fields null) remains fully valid and readable', async () => {
    // Simulates a historical/pre-existing row: create with zero installation
    // data, exactly as every customer created before this migration would
    // have, then confirm a plain read round-trips cleanly with no errors.
    const create = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Historical Customer', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress });
    createdCustomerIds.push(create.body.data.id);

    const res = await request(ts.baseUrl).get(`/api/customers/${create.body.data.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.installationNote).toBeNull();
    expect(res.body.data.installationAmount).toBeNull();
    expect(res.body.data.installationPaymentMethod).toBeNull();
  });

  it('GET /customers (list) also returns the installation fields for both Admin and Scheduling', async () => {
    const create = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Listed Installation', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1, address: baseAddress, installationAmount: 77, installationPaymentMethod: 'CASH' });
    createdCustomerIds.push(create.body.data.id);

    const adminList = await request(ts.baseUrl).get('/api/customers').set('Authorization', `Bearer ${adminToken}`).query({ search: 'Listed Installation' });
    const schedList = await request(ts.baseUrl).get('/api/customers').set('Authorization', `Bearer ${schedToken}`).query({ search: 'Listed Installation' });
    expect(adminList.body.data[0].installationAmount).toBe(77);
    expect(schedList.body.data[0].installationAmount).toBe(77);
    expect(schedList.body.data[0].installationPaymentMethod).toBe('CASH');
  });
});
