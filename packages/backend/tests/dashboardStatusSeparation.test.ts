import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Dashboard scheduled customer status separation', () => {
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

  async function createCustomer(name: string) {
    const res = await request(ts.baseUrl).post('/api/customers').set('Authorization', `Bearer ${adminToken}`).send({
      name, phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1,
      address: { city: 'Riyadh', district: 'Test', street: 'Status test' },
    });
    expect(res.status).toBe(201);
    customerIds.push(res.body.data.id);
    return res.body.data.id as string;
  }

  async function dashboardCustomers(endpoint: string, search: string) {
    const res = await request(ts.baseUrl).get(`/api/dashboard/${endpoint}`).query({ search }).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return res.body.data as any[];
  }

  it('moves only the scheduled customer from needs-scheduling to scheduled, then moves it back when its appointment is deleted', async () => {
    const targetId = await createCustomer('Dashboard Status Target');
    const bystanderId = await createCustomer('Dashboard Status Bystander');

    expect((await dashboardCustomers('customers-list', 'Dashboard Status')).map(c => c.id)).toEqual(expect.arrayContaining([targetId, bystanderId]));
    expect((await dashboardCustomers('scheduled', 'Dashboard Status Target')).map(c => c.id)).not.toContain(targetId);

    const create = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
      customerId: targetId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(create.status).toBe(201);
    const appointmentId = create.body.data.id as string;
    appointmentIds.push(appointmentId);

    const scheduledIds = (await dashboardCustomers('scheduled', 'Dashboard Status Target')).map(c => c.id);
    const needsSchedulingIds = (await dashboardCustomers('customers-list', 'Dashboard Status')).map(c => c.id);
    expect(scheduledIds).toContain(targetId);
    expect(needsSchedulingIds).not.toContain(targetId);
    expect(needsSchedulingIds).toContain(bystanderId);

    const deleted = await request(ts.baseUrl).delete(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(deleted.status).toBe(200);
    appointmentIds.splice(appointmentIds.indexOf(appointmentId), 1);
    expect((await dashboardCustomers('customers-list', 'Dashboard Status')).map(c => c.id)).toEqual(expect.arrayContaining([targetId, bystanderId]));
    expect((await dashboardCustomers('scheduled', 'Dashboard Status Target')).map(c => c.id)).not.toContain(targetId);
  });
});
