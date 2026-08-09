// Final payment/visit-note batch:
// (A) "Service Note" -> "Next Maintenance Note" rename was found already correct
//     everywhere (tasks.nextMaintenanceNote); no backend change, no test needed here.
// (B) "Visit Only" (urgent-visits flow only): completion amount/payment method are
//     never trusted from the payload when serviceType === 'VISIT_ONLY' -- always
//     normalized server-side to 0 / '' regardless of what is submitted.
// (C) "Bank Transfer" subtype (urgent-visits flow): the bare 'BANK_TRANSFER' value no
//     longer exists -- only 'BANK_TRANSFER_COMMERCIAL' / 'BANK_TRANSFER_PERSONAL' are
//     accepted, enforced by removing the old value from the Zod enum entirely.
// (D) Same Bank Transfer subtype behavior in the normal Technician completion flow
//     (PATCH /appointments/:id/complete) -- same enum change, same file family.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Visit Only + Bank Transfer subtype (Parts B/C/D)', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, schedToken: string, techToken: string, tech2Token: string;
  let customerId: string;
  const createdAppointmentIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
    tech2Token = signTestToken(users.technician2.id, 'TECHNICIAN');

    const custRes = await request(ts.baseUrl)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Visit Only / Bank Transfer Subtype Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Riyadh', district: 'Test', street: 'Test' },
      });
    customerId = custRes.body.data.id;
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) {
      await prisma.urgentVisitRecord.deleteMany({ where: { appointmentId: { in: createdAppointmentIds } } });
      await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    }
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

  // ---- helpers ----

  async function createUrgentAppointment(technicianId: string | null = users.technician.id) {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        isUrgent: true,
        urgentLocation: JSON.stringify({ city: 'Riyadh' }),
        ...(technicianId ? { technicianId } : {}),
      });
    const id = res.body.data.id;
    createdAppointmentIds.push(id);
    return id;
  }

  async function createInProgressAppointment(technicianId: string = users.technician.id) {
    const apptRes = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, type: 'MAINTENANCE', scheduledDate: new Date(Date.now() + 86400000).toISOString(), technicianId });
    const id = apptRes.body.data.id;
    createdAppointmentIds.push(id);
    const claimToken = technicianId === users.technician.id ? techToken : tech2Token;
    await request(ts.baseUrl).patch(`/api/appointments/${id}/start`).set('Authorization', `Bearer ${claimToken}`).send({});
    return id;
  }

  function dateOnly(d: Date | string): string { return new Date(d).toISOString().slice(0, 10); }

  const urgentVisitBase = { customerName: 'Urgent Visit Customer', customerPhone: '0511111111' };

  // ================= Part B: Visit Only (urgent-visits) =================

  it('1. Visit Only submission is accepted with no paymentMethod/amount in the payload', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'VISIT_ONLY' });
    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(0);
    expect(res.body.data.paymentMethod).toBe('');
  });

  it('2. Visit Only + manipulated amount 500 is normalized to 0 server-side', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'VISIT_ONLY', amount: 500 });
    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(0);
  });

  it('3. Visit Only + manipulated Bank Transfer payment method is ignored server-side', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'VISIT_ONLY', paymentMethod: 'BANK_TRANSFER_COMMERCIAL', amount: 500 });
    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(0);
    expect(res.body.data.paymentMethod).toBe('');
  });

  it('4. Non-Visit-Only (MAINTENANCE) still requires paymentMethod', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'MAINTENANCE', amount: 200 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Payment method is required/i);
  });

  it('5. Non-Visit-Only (INSTALLATION) still requires amount', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'INSTALLATION', paymentMethod: 'CASH' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Amount is required/i);
  });

  it('6. A normal (non-Visit-Only) visit with valid amount+payment still succeeds unchanged', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'MAINTENANCE', amount: 250, paymentMethod: 'CASH' });
    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(250);
    expect(res.body.data.paymentMethod).toBe('CASH');
  });

  // ================= Part C: Bank Transfer subtype (urgent-visits) =================

  it('7. Bank Transfer Commercial subtype is accepted', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'MAINTENANCE', amount: 300, paymentMethod: 'BANK_TRANSFER_COMMERCIAL' });
    expect(res.status).toBe(201);
    expect(res.body.data.paymentMethod).toBe('BANK_TRANSFER_COMMERCIAL');
  });

  it('8. Bank Transfer Personal subtype is accepted', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'MAINTENANCE', amount: 300, paymentMethod: 'BANK_TRANSFER_PERSONAL' });
    expect(res.status).toBe(201);
    expect(res.body.data.paymentMethod).toBe('BANK_TRANSFER_PERSONAL');
  });

  it('9. Bare "BANK_TRANSFER" (no subtype) is rejected — old value no longer valid', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'MAINTENANCE', amount: 300, paymentMethod: 'BANK_TRANSFER' });
    expect(res.status).toBe(400);
  });

  it('10. An unrecognized payment method string is rejected', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'MAINTENANCE', amount: 300, paymentMethod: 'CRYPTO' });
    expect(res.status).toBe(400);
  });

  // ================= Part D: Bank Transfer subtype (normal completion flow) =================

  const completeBase = { serviceDetails: 'Serviced units', actualCompletionDate: dateOnly(new Date()), technicianName: 'Ahmed' };

  it('11. Normal completion with CASH still works unchanged', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...completeBase, completionAmount: 300, completionPaymentMethod: 'CASH' });
    expect(res.status).toBe(200);
    expect(res.body.data.completionPaymentMethod).toBe('CASH');
  });

  it('12. Normal completion with Bank Transfer Commercial subtype succeeds', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...completeBase, completionAmount: 300, completionPaymentMethod: 'BANK_TRANSFER_COMMERCIAL' });
    expect(res.status).toBe(200);
    expect(res.body.data.completionPaymentMethod).toBe('BANK_TRANSFER_COMMERCIAL');
  });

  it('13. Normal completion with Bank Transfer Personal subtype succeeds', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...completeBase, completionAmount: 300, completionPaymentMethod: 'BANK_TRANSFER_PERSONAL' });
    expect(res.status).toBe(200);
    expect(res.body.data.completionPaymentMethod).toBe('BANK_TRANSFER_PERSONAL');
  });

  it('14. Normal completion with bare "BANK_TRANSFER" (no subtype) is rejected', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...completeBase, completionAmount: 300, completionPaymentMethod: 'BANK_TRANSFER' });
    expect(res.status).toBe(400);
  });

  it('15. Admin completion without any payment method still works (backward-compatible, unaffected by enum change)', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceDetails: 'Serviced', actualCompletionDate: dateOnly(new Date()), completionAmount: 300 });
    expect(res.status).toBe(200);
  });

  // ================= Cross-cutting: privacy (Modification #6) unaffected by new values =================

  it('16. completionPaymentMethod with a Bank Transfer subtype is still stripped from the Scheduling-room payload shape', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...completeBase, completionAmount: 300, completionPaymentMethod: 'BANK_TRANSFER_PERSONAL' });
    expect(res.status).toBe(200);

    const schedRead = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(schedRead.body.data.completionPaymentMethod).toBeUndefined();
    expect(schedRead.body.data.completionAmount).toBeUndefined();
  });

  it('17. urgent-visits list (Admin-only) still returns the new subtype values correctly', async () => {
    const id = await createUrgentAppointment();
    await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'MAINTENANCE', amount: 400, paymentMethod: 'BANK_TRANSFER_COMMERCIAL' });
    const res = await request(ts.baseUrl).get('/api/urgent-visits').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const record = res.body.data.find((r: any) => r.appointmentId === id);
    expect(record).toBeTruthy();
    expect(record.paymentMethod).toBe('BANK_TRANSFER_COMMERCIAL');
  });

  it('18. Scheduling cannot access urgent-visits list at all (unrelated to this fix, re-verified)', async () => {
    const res = await request(ts.baseUrl).get('/api/urgent-visits').set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(403);
  });

  it('19. Technician cannot submit a visit record for an appointment assigned to another Technician', async () => {
    const id = await createUrgentAppointment(users.technician2.id);
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'VISIT_ONLY' });
    expect(res.status).toBe(403);
  });

  it('20. A duplicate visit-record submission for the same appointment is rejected (unrelated to this fix, re-verified)', async () => {
    const id = await createUrgentAppointment();
    const first = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'VISIT_ONLY' });
    expect(first.status).toBe(201);
    const second = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'VISIT_ONLY' });
    expect(second.status).toBe(409);
  });
});
