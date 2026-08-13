import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers, TEST_USER_DEFS } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Urgent appointment privacy and approved maintenance history', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedulingToken: string, technicianToken: string;
  let customerId = '', appointmentId = '';

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedulingToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    technicianToken = signTestToken(users.technician.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    if (appointmentId) await prisma.appointment.deleteMany({ where: { id: appointmentId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

  it('keeps an urgent customer private until approval, then exposes its completed urgent record in Scheduling history without creating normal work', async () => {
    const phone = testPhone();
    const create = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({
      type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 3600000).toISOString(),
      isUrgent: true, visibleToScheduling: true, customerName: 'Urgent Privacy Customer', customerPhone: phone,
      urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'Test', street: 'Privacy Lane' }),
    });
    expect(create.status).toBe(201);
    appointmentId = create.body.data.id;
    customerId = create.body.data.customerId;
    expect(create.body.data.visibleToScheduling).toBe(false);

    const techList = await request(ts.baseUrl).get('/api/appointments').query({ urgent: 'true' }).set('Authorization', `Bearer ${technicianToken}`);
    expect(techList.status).toBe(200);
    expect(techList.body.data.some((a: any) => a.id === appointmentId)).toBe(true);

    const schedulingAppointments = await request(ts.baseUrl).get('/api/appointments').query({ urgent: 'true' }).set('Authorization', `Bearer ${schedulingToken}`);
    expect(schedulingAppointments.status).toBe(200);
    expect(schedulingAppointments.body.data.some((a: any) => a.id === appointmentId)).toBe(false);
    const schedulingCustomers = await request(ts.baseUrl).get('/api/customers').query({ search: phone }).set('Authorization', `Bearer ${schedulingToken}`);
    expect(schedulingCustomers.status).toBe(200);
    expect(schedulingCustomers.body.data.some((c: any) => c.id === customerId)).toBe(false);

    const record = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${technicianToken}`).send({
      appointmentId, serviceType: 'MAINTENANCE', paymentMethod: 'CASH', amount: 150,
      serviceDetails: 'Urgent filter repair completed', technicianName: 'Ahmed',
    });
    expect(record.status).toBe(201);

    const approve = await request(ts.baseUrl).patch(`/api/appointments/${appointmentId}/approve-visibility`).set('Authorization', `Bearer ${adminToken}`);
    expect(approve.status).toBe(200);
    expect(approve.body.data.visibleToScheduling).toBe(true);

    const approvedAppointments = await request(ts.baseUrl).get('/api/appointments').query({ urgent: 'true' }).set('Authorization', `Bearer ${schedulingToken}`);
    expect(approvedAppointments.body.data.some((a: any) => a.id === appointmentId)).toBe(true);
    const approvedAppointment = await request(ts.baseUrl).get(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${schedulingToken}`);
    expect(approvedAppointment.status).toBe(200);
    expect(approvedAppointment.body.data.id).toBe(appointmentId);
    const approvedCustomers = await request(ts.baseUrl).get('/api/customers').query({ search: phone }).set('Authorization', `Bearer ${schedulingToken}`);
    expect(approvedCustomers.body.data.some((c: any) => c.id === customerId)).toBe(true);

    const history = await request(ts.baseUrl).get(`/api/customers/${customerId}`).set('Authorization', `Bearer ${schedulingToken}`);
    expect(history.status).toBe(200);
    const urgentHistory = history.body.data.appointments.find((a: any) => a.id === appointmentId);
    expect(urgentHistory.isUrgent).toBe(true);
    expect(urgentHistory.urgentVisitRecord).toMatchObject({ serviceType: 'MAINTENANCE', serviceDetails: 'Urgent filter repair completed' });
    expect(urgentHistory.urgentVisitRecord.submittedBy.name).toBe(TEST_USER_DEFS.technician.name);

    const normalAppointments = await prisma.appointment.count({ where: { customerId, isUrgent: false } });
    expect(normalAppointments).toBe(0);
  });
});
