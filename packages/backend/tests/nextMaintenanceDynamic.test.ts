// Focused modification batch (Part E): Next Maintenance must be dynamic --
// computed from the ACTUAL completion date + recurrence, at the API layer
// (routes/customers.ts GET / includeSchedule + GET /:id, routes/reports.ts
// GET /customers), not derived from a stale/scheduled date and not merely a
// UI display patch. See maintenanceSchedule.test.ts for the pure calculation
// unit tests; this file exercises the real endpoints end-to-end.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Next Maintenance is dynamic (Part E)', () => {
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

  function dateOnly(d: Date | string): string { return new Date(d).toISOString().slice(0, 10); }

  async function createCustomer(maintenanceFrequency = 2) {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Next Maintenance Dynamic Customer', phone: testPhone(),
        maintenanceCycle: 'MONTHLY', maintenanceFrequency,
        address: { city: 'Riyadh', district: 'Test', street: 'Test' },
      });
    createdCustomerIds.push(res.body.data.id);
    return res.body.data.id as string;
  }

  async function createAndCompleteAppointment(customerId: string, actualCompletionDate: string, scheduledDate?: string) {
    const apptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: scheduledDate || new Date().toISOString(), technicianId: users.technician.id });
    const id = apptRes.body.data.id;
    createdAppointmentIds.push(id);
    await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({
        serviceDetails: 'Serviced', completionAmount: 100, completionPaymentMethod: 'CASH',
        actualCompletionDate, technicianName: 'Ahmed',
      });
    return id;
  }

  // 33. The task's exact reported-bug scenario.
  it("33/34. completion on 2026-08-12 with recurrence 2 -> Next Maintenance 2026-10-12, not the original scheduled date", async () => {
    const customerId = await createCustomer(2);
    await createAndCompleteAppointment(customerId, '2026-08-12', '2026-08-01T00:00:00.000Z');

    const list = await request(ts.baseUrl).get('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .query({ includeSchedule: 'true', limit: '200' });
    const found = list.body.data.find((c: any) => c.id === customerId);
    expect(found).toBeTruthy();
    expect(dateOnly(found.nextMaintenance)).toBe('2026-10-12');
  });

  // 44/45. The customer maintenance-history endpoint (GET /:id, backs the
  // Scheduling "Maintenance History" modal) and the Admin/Scheduling list
  // endpoint return the SAME value -- one reusable source of truth.
  it('44/45. GET /customers/:id and GET /customers (includeSchedule) return the same computed nextMaintenance', async () => {
    const customerId = await createCustomer(2);
    await createAndCompleteAppointment(customerId, '2026-08-12');

    const detail = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${schedToken}`);
    const list = await request(ts.baseUrl).get('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .query({ includeSchedule: 'true', limit: '200' });
    const found = list.body.data.find((c: any) => c.id === customerId);

    expect(dateOnly(detail.body.data.nextMaintenance)).toBe('2026-10-12');
    expect(dateOnly(found.nextMaintenance)).toBe(dateOnly(detail.body.data.nextMaintenance));
  });

  it('the Reports endpoint (GET /reports/customers) also returns the same computed value', async () => {
    const customerId = await createCustomer(2);
    await createAndCompleteAppointment(customerId, '2026-08-12');

    const reports = await request(ts.baseUrl).get('/api/reports/customers').set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: '200' });
    const found = reports.body.data.find((c: any) => c.id === customerId);
    expect(found).toBeTruthy();
    expect(dateOnly(found.nextMaintenance)).toBe('2026-10-12');
    expect(dateOnly(found.nextMaintenanceDate)).toBe('2026-10-12');
  });

  it('uses the MOST RECENT completion when the customer has completed maintenance more than once', async () => {
    const customerId = await createCustomer(1);
    await createAndCompleteAppointment(customerId, '2026-01-10');
    await createAndCompleteAppointment(customerId, '2026-08-12');

    const detail = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(dateOnly(detail.body.data.nextMaintenance)).toBe('2026-09-12');
  });

  it('a customer with no completed appointment yet and no previous service has no computable next maintenance', async () => {
    const customerId = await createCustomer(2);
    const detail = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.data.nextMaintenance).toBeNull();
  });

  // 48. A future manually-scheduled appointment must NOT be used as "next
  // maintenance" -- only the actual completion date + recurrence.
  it('a manually-scheduled future appointment does not become the displayed next-maintenance date', async () => {
    const customerId = await createCustomer(2);
    await createAndCompleteAppointment(customerId, '2026-08-12');
    // Scheduling manually books a follow-up for an arbitrary date far from
    // the recurrence-computed one.
    await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${schedToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: '2027-01-01T00:00:00.000Z' })
      .then(r => { if (r.body?.data?.id) createdAppointmentIds.push(r.body.data.id); });

    const detail = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(dateOnly(detail.body.data.nextMaintenance)).toBe('2026-10-12');
  });

  // Part D + E integration: half-month recurrence now that the schema stores
  // decimals (migration 20260812214706_change_customer_maintenance_frequency_to_decimal).
  // Same rule as maintenanceSchedule.test.ts's pure unit tests (#37/#38), exercised
  // end-to-end through the real API + real DB this time.
  it('37. recurrence 1.5 completed on 2026-08-12 -> next maintenance 2026-09-27 (+1 month, then +15 days)', async () => {
    const customerId = await createCustomer(1.5);
    await createAndCompleteAppointment(customerId, '2026-08-12');
    const detail = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(dateOnly(detail.body.data.nextMaintenance)).toBe('2026-09-27');
  });

  it('38. recurrence 2.5 completed on 2026-08-12 -> next maintenance 2026-10-27 (+2 months, then +15 days)', async () => {
    const customerId = await createCustomer(2.5);
    await createAndCompleteAppointment(customerId, '2026-08-12');
    const detail = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(dateOnly(detail.body.data.nextMaintenance)).toBe('2026-10-27');
  });

  it('recurrence 3.5 is stored and computed without rounding across the full create -> complete -> read cycle', async () => {
    const customerId = await createCustomer(3.5);
    const custDetail = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(custDetail.body.data.maintenanceFrequency).toBe(3.5);

    await createAndCompleteAppointment(customerId, '2026-08-12');
    const detail = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${adminToken}`);
    // +3 months = 2026-11-12; +15 days = 2026-11-27
    expect(dateOnly(detail.body.data.nextMaintenance)).toBe('2026-11-27');
  });
});
