import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Dashboard Customers card', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string;
  const customerIds: string[] = [];
  const appointmentIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
  });

  afterAll(async () => {
    if (appointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
    if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await stopTestServer(ts.server);
  });

  it('keeps every customer represented regardless of scheduling or completion state and removes the Scheduled category endpoint', async () => {
    const createCustomer = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`).send({
      name: 'Dashboard Permanent Customer', phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1,
      address: { city: 'Riyadh', district: 'Test', street: 'Status test' },
    });
    expect(createCustomer.status).toBe(201);
    const customerId = createCustomer.body.data.id as string;
    customerIds.push(customerId);

    const before = await request(ts.baseUrl).get('/api/dashboard/customers-list').query({ search: 'Dashboard Permanent Customer' }).set('Authorization', `Bearer ${adminToken}`);
    expect(before.body.data.map((customer: any) => customer.id)).toContain(customerId);

    const createAppointment = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
      customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString(), technicianId: users.technician.id,
    });
    expect(createAppointment.status).toBe(201);
    appointmentIds.push(createAppointment.body.data.id);

    const afterScheduling = await request(ts.baseUrl).get('/api/dashboard/customers-list').query({ search: 'Dashboard Permanent Customer' }).set('Authorization', `Bearer ${adminToken}`);
    expect(afterScheduling.body.data.map((customer: any) => customer.id)).toContain(customerId);

    await prisma.appointment.update({ where: { id: createAppointment.body.data.id }, data: { workStatus: 'COMPLETED', completedAt: new Date() } });
    const afterCompletion = await request(ts.baseUrl).get('/api/dashboard/customers-list').query({ search: 'Dashboard Permanent Customer' }).set('Authorization', `Bearer ${adminToken}`);
    expect(afterCompletion.body.data.map((customer: any) => customer.id)).toContain(customerId);

    const stats = await request(ts.baseUrl).get('/api/dashboard/stats').set('Authorization', `Bearer ${adminToken}`);
    const allCustomers = await request(ts.baseUrl).get('/api/dashboard/customers-list').query({ limit: 100 }).set('Authorization', `Bearer ${adminToken}`);
    expect(stats.body.data.total).toBe(allCustomers.body.meta.total);
    expect(stats.body.data).not.toHaveProperty('scheduled');

    const removed = await request(ts.baseUrl).get('/api/dashboard/scheduled').set('Authorization', `Bearer ${adminToken}`);
    expect(removed.status).toBe(404);
  });
});
