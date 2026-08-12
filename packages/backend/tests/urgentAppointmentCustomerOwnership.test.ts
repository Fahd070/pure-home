// Focused modification batch (Parts A/B/C): Admin now owns customer identity
// for an urgent appointment, entered at creation time and resolved/created via
// services/customerResolve.service.ts -- the Technician no longer enters or
// can override customer name/phone at completion time (routes/urgent-visits.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Urgent appointment customer ownership (Parts A/B/C)', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string, tech2Token: string;
  const createdAppointmentIds: string[] = [];
  const createdCustomerIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
    tech2Token = signTestToken(users.technician2.id, 'TECHNICIAN');
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) {
      await prisma.urgentVisitRecord.deleteMany({ where: { appointmentId: { in: createdAppointmentIds } } });
      await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    }
    if (createdCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await stopTestServer(ts.server);
  });

  async function createUrgentAppointment(overrides: Record<string, any> = {}) {
    const res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        isUrgent: true,
        urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'Olaya', street: 'King Fahd Rd' }),
        customerName: 'Urgent Owner Customer',
        customerPhone: testPhone(),
        ...overrides,
      });
    if (res.body?.data?.id) createdAppointmentIds.push(res.body.data.id);
    if (res.body?.data?.customerId) createdCustomerIds.push(res.body.data.customerId);
    return res;
  }

  // 1/2/3. Admin urgent appointment creation requires and validates customer
  // name/mobile (backend-enforced -- the frontend form fields exist in
  // admin/pages/UrgentAppointments.tsx).
  it('1/2. rejects an urgent appointment with no customerName', async () => {
    const res = await createUrgentAppointment({ customerName: '' });
    expect(res.status).toBe(400);
  });

  it('3. rejects an urgent appointment with a malformed customerPhone (same rule as Add Customer)', async () => {
    const res = await createUrgentAppointment({ customerPhone: '12345' });
    expect(res.status).toBe(400);
  });

  it('3. rejects an urgent appointment with a missing customerPhone', async () => {
    const res = await createUrgentAppointment({ customerPhone: '' });
    expect(res.status).toBe(400);
  });

  // 4/5/6. New phone -> new Customer, appearing in Customers data, linked to
  // the urgent appointment.
  it('4/5/6. creating an urgent appointment for a NEW phone creates a Customer and links the appointment to it', async () => {
    const phone = testPhone();
    const res = await createUrgentAppointment({ customerName: 'Brand New Urgent Customer', customerPhone: phone });
    expect(res.status).toBe(201);
    expect(res.body.data.customerId).toBeTruthy();
    expect(res.body.data.customer.name).toBe('Brand New Urgent Customer');
    expect(res.body.data.customer.phone).toBe(phone);

    const custList = await request(ts.baseUrl).get('/api/customers').set('Authorization', `Bearer ${adminToken}`)
      .query({ search: phone });
    expect(custList.body.data.some((c: any) => c.id === res.body.data.customerId)).toBe(true);
  });

  it('a new customer created from an urgent appointment gets a real address from urgentLocation, not invented data', async () => {
    const phone = testPhone();
    const res = await createUrgentAppointment({
      customerPhone: phone,
      urgentLocation: JSON.stringify({ city: 'Jeddah', district: 'Al Rawdah', street: 'Palestine St' }),
    });
    expect(res.status).toBe(201);
    const detail = await request(ts.baseUrl).get(`/api/customers/${res.body.data.customerId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.data.address.city).toBe('Jeddah');
    expect(detail.body.data.address.district).toBe('Al Rawdah');
  });

  // 7/8. Existing phone -> reuse, no duplicate.
  it('7/8. creating a second urgent appointment for an EXISTING phone reuses the same Customer (no duplicate)', async () => {
    const phone = testPhone();
    const first = await createUrgentAppointment({ customerName: 'Repeat Customer', customerPhone: phone });
    expect(first.status).toBe(201);
    const firstCustomerId = first.body.data.customerId;

    const before = await prisma.customer.count({ where: { phone } });
    expect(before).toBe(1);

    const second = await createUrgentAppointment({ customerName: 'Repeat Customer', customerPhone: phone });
    expect(second.status).toBe(201);
    expect(second.body.data.customerId).toBe(firstCustomerId);

    const after = await prisma.customer.count({ where: { phone } });
    expect(after).toBe(1);
  });

  it('reuses the existing customer even if the name typed this time differs slightly (matches by phone, the primary identity rule)', async () => {
    const phone = testPhone();
    const first = await createUrgentAppointment({ customerName: 'Ahmed Al-Otaibi', customerPhone: phone });
    const second = await createUrgentAppointment({ customerName: 'ahmed al otaibi', customerPhone: phone });
    expect(second.body.data.customerId).toBe(first.body.data.customerId);
    expect(await prisma.customer.count({ where: { phone } })).toBe(1);
  });

  it('SCHEDULING cannot create an urgent appointment at all (isUrgent forced false, existing rule unaffected)', async () => {
    const res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${schedToken}`)
      .send({
        type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        isUrgent: true, customerName: 'X', customerPhone: testPhone(),
      });
    // isUrgent is silently forced false for non-Admin, so this falls through to
    // the existing "customerId required for non-urgent appointments" rule.
    expect(res.status).toBe(400);
  });

  // 9/10/11/12. Technician completion: identity is read-only, sourced from the
  // linked Customer, and a malicious/legacy payload can never override it.
  it('9/10/12. Technician-submitted customerName/customerPhone in the completion payload are ignored -- persisted identity always comes from the linked Customer', async () => {
    const phone = testPhone();
    const created = await createUrgentAppointment({ customerName: 'Real Admin-Entered Name', customerPhone: phone });
    const apptId = created.body.data.id;

    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({
        appointmentId: apptId,
        serviceType: 'VISIT_ONLY',
        technicianName: 'Ahmed',
        // Malicious/stale override attempt -- must be ignored entirely.
        customerName: 'Attacker Controlled Name',
        customerPhone: '0599999999',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.customerName).toBe('Real Admin-Entered Name');
    expect(res.body.data.customerPhone).toBe(phone);

    // The linked Customer record itself must be untouched by the attempted override.
    const custRes = await request(ts.baseUrl).get(`/api/customers/${created.body.data.customerId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(custRes.body.data.name).toBe('Real Admin-Entered Name');
    expect(custRes.body.data.phone).toBe(phone);
  });

  it('11. Technician completion works with no customerName/customerPhone in the payload at all (fields are optional/backward-compatible)', async () => {
    const created = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ appointmentId: created.body.data.id, serviceType: 'VISIT_ONLY', technicianName: 'Ahmed' });
    expect(res.status).toBe(201);
    expect(res.body.data.customerName).toBe('Urgent Owner Customer');
  });

  it('a legacy urgent appointment with no linked customer (created before this batch) completes with null identity, never invented', async () => {
    // Simulates the pre-batch flow: an urgent appointment with no customerId.
    const apptRes = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        isUrgent: true, customerName: 'Placeholder', customerPhone: testPhone(),
      });
    const apptId = apptRes.body.data.id;
    createdAppointmentIds.push(apptId);
    if (apptRes.body.data.customerId) createdCustomerIds.push(apptRes.body.data.customerId);
    await prisma.appointment.update({ where: { id: apptId }, data: { customerId: null } });

    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ appointmentId: apptId, serviceType: 'VISIT_ONLY', technicianName: 'Ahmed', customerName: 'Should Be Ignored' });
    expect(res.status).toBe(201);
    expect(res.body.data.customerName).toBeNull();
  });

  // 13/16/17. Unresolved-count data (the sidebar badge's source of truth,
  // components/Sidebar.tsx) is exactly "isUrgent appointments with no
  // urgentVisitRecord yet" -- state/data-driven, not a client-side counter.
  it('13/16/17. unresolved urgent count reflects real DB state: increments on creation, decrements on completion, correct with multiple outstanding', async () => {
    const before = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .query({ urgent: 'true', limit: '200' });
    const beforeCount = before.body.data.filter((a: any) => !a.urgentVisitRecord).length;

    const first = await createUrgentAppointment();
    const second = await createUrgentAppointment();

    const afterCreate = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .query({ urgent: 'true', limit: '200' });
    expect(afterCreate.body.data.filter((a: any) => !a.urgentVisitRecord).length).toBe(beforeCount + 2);

    await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ appointmentId: first.body.data.id, serviceType: 'VISIT_ONLY', technicianName: 'Ahmed' });

    const afterOneCompleted = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .query({ urgent: 'true', limit: '200' });
    expect(afterOneCompleted.body.data.filter((a: any) => !a.urgentVisitRecord).length).toBe(beforeCount + 1);
    const stillOutstanding = afterOneCompleted.body.data.find((a: any) => a.id === second.body.data.id);
    expect(stillOutstanding.urgentVisitRecord).toBeFalsy();

    await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ appointmentId: second.body.data.id, serviceType: 'VISIT_ONLY', technicianName: 'Ahmed' });

    const afterBothCompleted = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .query({ urgent: 'true', limit: '200' });
    expect(afterBothCompleted.body.data.filter((a: any) => !a.urgentVisitRecord).length).toBe(beforeCount);
  });

  it('the same unresolved-count data is visible to a Technician (their sidebar badge query)', async () => {
    await createUrgentAppointment();
    const res = await request(ts.baseUrl).get('/api/appointments').set('Authorization', `Bearer ${techToken}`)
      .query({ urgent: 'true', limit: '200' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((a: any) => !a.urgentVisitRecord)).toBe(true);
  });

  it('a Technician not assigned to the appointment still cannot submit its urgent-visit record (existing IDOR rule unaffected)', async () => {
    const res = await createUrgentAppointment({ technicianId: users.technician.id });
    const submit = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${tech2Token}`)
      .send({ appointmentId: res.body.data.id, serviceType: 'VISIT_ONLY', technicianName: 'Ahmed' });
    expect(submit.status).toBe(403);
  });
});
