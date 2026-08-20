// Regression tests for the Performance Patch (bounded customer-list/report
// queries, trimmed expense-list payload). These specifically cover the
// derived-field scenarios the recurrence/nextMaintenance logic itself does
// NOT already exercise (see tests/nextMaintenanceDynamic.test.ts and
// tests/maintenanceSchedule.test.ts for that): overdueCount, lastMaintenance,
// alertLevel, maintenanceStatus, totalAmount, and proof that the previously
// unbounded `appointments` relation array is no longer shipped in the
// customers list response. Every assertion here targets the real HTTP
// response shape, not the query implementation.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Performance patch: bounded customer/report queries + trimmed expense payload', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string, tech2Token: string;
  const createdCustomerIds: string[] = [];
  const createdAppointmentIds: string[] = [];
  const createdExpenseIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
    tech2Token = signTestToken(users.technician2.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    if (createdExpenseIds.length) await prisma.expense.deleteMany({ where: { id: { in: createdExpenseIds } } });
    if (createdAppointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    if (createdCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await stopTestServer(ts.server);
  });

  async function createCustomer(overrides: Record<string, any> = {}) {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Perf Patch Customer', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1,
      address: { city: 'Riyadh', district: 'Test', street: 'Test' }, ...overrides,
    });
    createdCustomerIds.push(res.body.data.id);
    return res.body.data.id as string;
  }

  async function createAppointment(customerId: string, scheduledDate: string, technicianId?: string) {
    const res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
      customerId, type: 'MAINTENANCE', scheduledDate, ...(technicianId ? { technicianId } : {}),
    });
    createdAppointmentIds.push(res.body.data.id);
    return res.body.data.id as string;
  }

  async function completeAppointment(id: string, actualCompletionDate: string) {
    await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${techToken}`).send({});
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`).send({
      serviceDetails: 'Serviced', completionAmount: 100, completionPaymentMethod: 'CASH',
      actualCompletionDate, technicianName: 'Ahmed',
    });
  }

  function findCustomer(list: any[], id: string) { return list.find((c: any) => c.id === id); }

  // ── GET /api/customers?includeSchedule=true ────────────────────────────────
  describe('GET /api/customers?includeSchedule=true', () => {
    it('the previously unbounded appointments array is no longer present on the response (proves the optimization)', async () => {
      const customerId = await createCustomer();
      await createAppointment(customerId, new Date(Date.now() + 86400000).toISOString());
      const res = await request(ts.baseUrl).get('/api/customers').query({ includeSchedule: 'true', limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c).toBeTruthy();
      expect(c.appointments).toBeUndefined();
    });

    it('a customer with no appointments: lastMaintenance null, overdueCount 0, alertLevel ok', async () => {
      const customerId = await createCustomer();
      const res = await request(ts.baseUrl).get('/api/customers').query({ includeSchedule: 'true', limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.lastMaintenance).toBeNull();
      expect(c.overdueCount).toBe(0);
      expect(c.alertLevel).toBe('ok');
      expect(c.nextMaintenance).toBeNull();
    });

    it('one completed appointment: lastMaintenance reflects it', async () => {
      const customerId = await createCustomer();
      const apptId = await createAppointment(customerId, '2026-08-12T00:00:00.000Z');
      await completeAppointment(apptId, '2026-08-12');
      const res = await request(ts.baseUrl).get('/api/customers').query({ includeSchedule: 'true', limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(new Date(c.lastMaintenance).toISOString().slice(0, 10)).toBe('2026-08-12');
    });

    it('many historical completed appointments: lastMaintenance is the most recent by scheduledDate', async () => {
      const customerId = await createCustomer();
      for (const d of ['2025-01-01', '2025-06-15', '2026-01-10']) {
        const apptId = await createAppointment(customerId, `${d}T00:00:00.000Z`);
        await completeAppointment(apptId, d);
      }
      const latestId = await createAppointment(customerId, '2026-07-20T00:00:00.000Z');
      await completeAppointment(latestId, '2026-07-20');
      const res = await request(ts.baseUrl).get('/api/customers').query({ includeSchedule: 'true', limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(new Date(c.lastMaintenance).toISOString().slice(0, 10)).toBe('2026-07-20');
    });

    it('an overdue (past, non-cancelled, non-completed) appointment sets alertLevel=overdue and overdueCount=1', async () => {
      const customerId = await createCustomer();
      await createAppointment(customerId, '2020-01-01T00:00:00.000Z');
      const res = await request(ts.baseUrl).get('/api/customers').query({ includeSchedule: 'true', limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.alertLevel).toBe('overdue');
      expect(c.overdueCount).toBe(1);
    });

    it('multiple overdue appointments are all counted', async () => {
      const customerId = await createCustomer();
      await createAppointment(customerId, '2020-01-01T00:00:00.000Z');
      await createAppointment(customerId, '2020-02-01T00:00:00.000Z');
      await createAppointment(customerId, '2020-03-01T00:00:00.000Z');
      const res = await request(ts.baseUrl).get('/api/customers').query({ includeSchedule: 'true', limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.overdueCount).toBe(3);
      expect(c.alertLevel).toBe('overdue');
    });

    it('a cancelled past appointment does NOT count as overdue', async () => {
      const customerId = await createCustomer();
      const apptId = await createAppointment(customerId, '2020-01-01T00:00:00.000Z');
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CANCELLED' });
      const res = await request(ts.baseUrl).get('/api/customers').query({ includeSchedule: 'true', limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.overdueCount).toBe(0);
      expect(c.alertLevel).toBe('ok');
    });

    it('a manually-scheduled future appointment does not itself trigger overdue/soon by its mere existence', async () => {
      const customerId = await createCustomer();
      await createAppointment(customerId, new Date(Date.now() + 365 * 86400000).toISOString());
      const res = await request(ts.baseUrl).get('/api/customers').query({ includeSchedule: 'true', limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.overdueCount).toBe(0);
      expect(c.alertLevel).toBe('ok');
    });

    it('half-month recurrence (2.5) still computes nextMaintenance correctly through the optimized path', async () => {
      const customerId = await createCustomer({ maintenanceFrequency: 2.5 });
      const apptId = await createAppointment(customerId, '2026-08-12T00:00:00.000Z');
      await completeAppointment(apptId, '2026-08-12');
      const res = await request(ts.baseUrl).get('/api/customers').query({ includeSchedule: 'true', limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(new Date(c.nextMaintenance).toISOString().slice(0, 10)).toBe('2026-10-27');
    });

    it('Scheduling hidden-customer authorization (PR #79) is unaffected by the query change', async () => {
      const urgentRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
        type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        isUrgent: true, customerName: 'Perf Hidden Customer', customerPhone: testPhone(),
        urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'Test', street: 'Hidden' }),
      });
      createdAppointmentIds.push(urgentRes.body.data.id);
      const hiddenCustomerId = urgentRes.body.data.customerId;
      createdCustomerIds.push(hiddenCustomerId);

      const res = await request(ts.baseUrl).get('/api/customers').query({ includeSchedule: 'true', limit: '200' }).set('Authorization', `Bearer ${schedToken}`);
      expect(findCustomer(res.body.data, hiddenCustomerId)).toBeUndefined();
    });

    it("Scheduling's completionAmount privacy (PR #80) is unaffected: no completion fields leak via the customer list", async () => {
      const customerId = await createCustomer();
      const apptId = await createAppointment(customerId, '2026-08-12T00:00:00.000Z');
      await completeAppointment(apptId, '2026-08-12');
      const res = await request(ts.baseUrl).get('/api/customers').query({ includeSchedule: 'true', limit: '200' }).set('Authorization', `Bearer ${schedToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c).toBeTruthy();
      expect(c.appointments).toBeUndefined();
    });
  });

  // ── GET /api/reports/customers ─────────────────────────────────────────────
  describe('GET /api/reports/customers', () => {
    it('maintenanceStatus=NO_APPOINTMENTS for a customer with none', async () => {
      const customerId = await createCustomer();
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.maintenanceStatus).toBe('NO_APPOINTMENTS');
    });

    it('maintenanceStatus=COMPLETED for a completed appointment', async () => {
      const customerId = await createCustomer();
      const apptId = await createAppointment(customerId, '2026-08-12T00:00:00.000Z');
      await completeAppointment(apptId, '2026-08-12');
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.maintenanceStatus).toBe('COMPLETED');
    });

    it('maintenanceStatus=IN_PROGRESS for a started (not yet completed) appointment', async () => {
      const customerId = await createCustomer();
      const apptId = await createAppointment(customerId, new Date().toISOString());
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/start`).set('Authorization', `Bearer ${techToken}`).send({});
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.maintenanceStatus).toBe('IN_PROGRESS');
    });

    it('maintenanceStatus=POSTPONED for a postponed appointment', async () => {
      const customerId = await createCustomer();
      const apptId = await createAppointment(customerId, new Date().toISOString());
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/postpone`).set('Authorization', `Bearer ${techToken}`).send({ reason: 'test' });
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.maintenanceStatus).toBe('POSTPONED');
    });

    it('maintenanceStatus=CANCELLED for a cancelled appointment', async () => {
      const customerId = await createCustomer();
      const apptId = await createAppointment(customerId, new Date(Date.now() + 86400000).toISOString());
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CANCELLED' });
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.maintenanceStatus).toBe('CANCELLED');
    });

    it('maintenanceStatus=OVERDUE for a past, non-cancelled, non-completed appointment', async () => {
      const customerId = await createCustomer();
      await createAppointment(customerId, '2020-01-01T00:00:00.000Z');
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.maintenanceStatus).toBe('OVERDUE');
      expect(c.overdueCount).toBe(1);
    });

    it('maintenanceStatus=SCHEDULED for a future, waiting appointment', async () => {
      const customerId = await createCustomer();
      await createAppointment(customerId, new Date(Date.now() + 86400000 * 30).toISOString());
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.maintenanceStatus).toBe('SCHEDULED');
    });

    it('totalAmount sums regular completionAmount across multiple historical appointments', async () => {
      const customerId = await createCustomer();
      const a1 = await createAppointment(customerId, '2026-01-01T00:00:00.000Z');
      await completeAppointment(a1, '2026-01-01');
      const a2 = await createAppointment(customerId, '2026-02-01T00:00:00.000Z');
      await completeAppointment(a2, '2026-02-01');
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      // completeAppointment always submits completionAmount: 100
      expect(c.totalAmount).toBe(200);
    });

    it('totalAmount includes urgent visit amounts for the same customer', async () => {
      const phone = testPhone();
      const urgentRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
        type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        isUrgent: true, visibleToScheduling: true, customerName: 'Perf Urgent Amount Customer', customerPhone: phone,
        urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'Test', street: 'X' }),
      });
      const apptId = urgentRes.body.data.id;
      const customerId = urgentRes.body.data.customerId;
      createdAppointmentIds.push(apptId);
      createdCustomerIds.push(customerId);
      await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`).send({
        appointmentId: apptId, serviceType: 'MAINTENANCE', paymentMethod: 'CASH', amount: 555, serviceDetails: 'Urgent fix', technicianName: 'Ahmed',
      });
      await request(ts.baseUrl).patch(`/api/appointments/${apptId}/approve-visibility`).set('Authorization', `Bearer ${adminToken}`);

      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c.totalAmount).toBe(555);
    });

    it('Scheduling never receives totalAmount (PR #80 privacy preserved)', async () => {
      const customerId = await createCustomer();
      const apptId = await createAppointment(customerId, '2026-01-01T00:00:00.000Z');
      await completeAppointment(apptId, '2026-01-01');
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' }).set('Authorization', `Bearer ${schedToken}`);
      const c = findCustomer(res.body.data, customerId);
      expect(c).toBeTruthy();
      expect(c.totalAmount).toBeUndefined();
    });

    it('Scheduling hidden-customer authorization (PR #79) is unaffected in the report', async () => {
      const urgentRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
        type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        isUrgent: true, customerName: 'Perf Report Hidden Customer', customerPhone: testPhone(),
        urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'Test', street: 'Hidden' }),
      });
      createdAppointmentIds.push(urgentRes.body.data.id);
      const hiddenCustomerId = urgentRes.body.data.customerId;
      createdCustomerIds.push(hiddenCustomerId);

      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ limit: '200' }).set('Authorization', `Bearer ${schedToken}`);
      expect(findCustomer(res.body.data, hiddenCustomerId)).toBeUndefined();
    });

    it('existing status filters (COMPLETED) still return the correct customers', async () => {
      const customerId = await createCustomer();
      const apptId = await createAppointment(customerId, '2026-08-12T00:00:00.000Z');
      await completeAppointment(apptId, '2026-08-12');
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ status: 'COMPLETED', limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      expect(findCustomer(res.body.data, customerId)).toBeTruthy();
    });

    it('existing status filters (OVERDUE) still return the correct customers', async () => {
      const customerId = await createCustomer();
      await createAppointment(customerId, '2020-01-01T00:00:00.000Z');
      const res = await request(ts.baseUrl).get('/api/reports/customers').query({ status: 'OVERDUE', limit: '200' }).set('Authorization', `Bearer ${adminToken}`);
      expect(findCustomer(res.body.data, customerId)).toBeTruthy();
    });
  });

  // ── GET /api/expenses (list) + GET /api/expenses/:id ───────────────────────
  describe('Expense list payload trimming + on-demand full-record retrieval', () => {
    const bigReceipt = 'A'.repeat(400000);

    async function createExpenseWithReceipt(token: string) {
      const res = await request(ts.baseUrl).post('/api/expenses').set('Authorization', `Bearer ${token}`).send({
        amount: 77.5, category: 'tools', date: new Date().toISOString(), receiptImage: bigReceipt,
      });
      createdExpenseIds.push(res.body.data.id);
      return res.body.data.id as string;
    }

    it('the list response no longer carries the large base64 receiptImage payload', async () => {
      const id = await createExpenseWithReceipt(techToken);
      const res = await request(ts.baseUrl).get('/api/expenses').set('Authorization', `Bearer ${adminToken}`);
      const found = res.body.data.find((e: any) => e.id === id);
      expect(found).toBeTruthy();
      expect(found.receiptImage).toBeUndefined();
      // Other fields remain present.
      expect(found.amount).toBe(77.5);
      expect(found.category).toBe('tools');
      expect(found.technician).toBeTruthy();
    });

    it('the receipt remains viewable via GET /api/expenses/:id for Admin', async () => {
      const id = await createExpenseWithReceipt(techToken);
      const res = await request(ts.baseUrl).get(`/api/expenses/${id}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.receiptImage).toBe(bigReceipt);
    });

    it("a Technician can retrieve their own expense's full receipt", async () => {
      const id = await createExpenseWithReceipt(techToken);
      const res = await request(ts.baseUrl).get(`/api/expenses/${id}`).set('Authorization', `Bearer ${techToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.receiptImage).toBe(bigReceipt);
    });

    it("a Technician cannot retrieve another technician's receipt (404, not a distinguishable 403)", async () => {
      const id = await createExpenseWithReceipt(techToken);
      const res = await request(ts.baseUrl).get(`/api/expenses/${id}`).set('Authorization', `Bearer ${tech2Token}`);
      expect(res.status).toBe(404);
    });

    it('expense totals and pagination meta are unchanged by the payload trim', async () => {
      const id = await createExpenseWithReceipt(techToken);
      const res = await request(ts.baseUrl).get('/api/expenses').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(typeof res.body.meta.total).toBe('number');
      expect(typeof res.body.meta.totalAmount).toBe('number');
      const found = res.body.data.find((e: any) => e.id === id);
      expect(found.amount).toBe(77.5);
    });
  });
});
