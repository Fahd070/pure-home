import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Appointment core flow', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, tech1Token: string, tech2Token: string;
  let customerId: string;
  let appointmentId: string;

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    tech1Token = signTestToken(users.technician.id, 'TECHNICIAN');
    tech2Token = signTestToken(users.technician2.id, 'TECHNICIAN');

    const custRes = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Appointment Flow Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Jeddah', district: 'Test', street: 'Test' },
      });
    customerId = custRes.body.data.id;
  });

  afterAll(async () => {
    if (appointmentId) await prisma.appointment.deleteMany({ where: { id: appointmentId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

  it('creates an appointment assigned to technician1', async () => {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        technicianId: users.technician.id,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.workStatus).toBe('WAITING');
    appointmentId = res.body.data.id;
  });

  it('is visible to ADMIN', async () => {
    const res = await request(ts.baseUrl).get(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('is visible to SCHEDULING (visibleToScheduling defaults true, not urgent)', async () => {
    const res = await request(ts.baseUrl).get(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
  });

  it('is accessible to the assigned technician', async () => {
    const res = await request(ts.baseUrl).get(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${tech1Token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.technicianId).toBe(users.technician.id);
  });

  it('is NOT accessible to a different, unassigned technician (data isolation)', async () => {
    const res = await request(ts.baseUrl).get(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${tech2Token}`);
    expect(res.status).toBe(404);
  });

  it('technician1 starts the appointment', async () => {
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appointmentId}/start`)
      .set('Authorization', `Bearer ${tech1Token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.workStatus).toBe('IN_PROGRESS');
  });

  it('technician1 completes the appointment', async () => {
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appointmentId}/complete`)
      .set('Authorization', `Bearer ${tech1Token}`)
      .send({ serviceDetails: 'Serviced 3 units', completionAmount: 250, completionPaymentMethod: 'CASH' });
    expect(res.status).toBe(200);
    expect(res.body.data.workStatus).toBe('COMPLETED');
    expect(res.body.data.completionAmount).toBe(250);
  });

  it('resulting state persists: completed appointment shows in the list, sanitized for SCHEDULING', async () => {
    const res = await request(ts.baseUrl)
      .get(`/api/appointments?workStatus=COMPLETED`)
      .set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    const found = res.body.data.find((a: any) => a.id === appointmentId);
    expect(found).toBeTruthy();
    expect(found.completionAmount).toBeUndefined();
  });
});
