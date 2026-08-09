// Completion/reporting batch:
// (A) Admin -> Technicians must show full normal-completion details, including
//     actualCompletionDate and maintenanceConfirmed -- both were missing from
//     GET /technicians's select and are added here (no privacy change: neither
//     is financial data, so both are visible to ADMIN and SCHEDULING alike,
//     matching Modification #8's existing precedent elsewhere in the app).
// (B) Technician -> Urgent Appointments completion form gains a required
//     Technician Name field (Modification #13's exact first-name rule, reused
//     not duplicated in spirit). UrgentVisitRecord already has a reliable
//     Technician/User relation (submittedById/submittedBy) -- the submitted
//     name is validated but deliberately NOT persisted; no schema change.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Completion details (Admin Technicians) + Urgent Technician Name', () => {
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
        name: 'Completion Details Batch Customer',
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

  function dateOnly(d: Date | string): string { return new Date(d).toISOString().slice(0, 10); }

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

  async function createUrgentAppointment(technicianId: string | null = users.technician.id) {
    const res = await request(ts.baseUrl)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        isUrgent: true,
        urgentLocation: JSON.stringify({ city: 'Riyadh', district: 'Al Malqa', street: 'King Fahd Rd' }),
        ...(technicianId ? { technicianId } : {}),
      });
    const id = res.body.data.id;
    createdAppointmentIds.push(id);
    return id;
  }

  const completeBase = { serviceDetails: 'Serviced units', actualCompletionDate: dateOnly(new Date()), technicianName: 'Ahmed' };
  const urgentVisitBase = { customerName: 'Urgent Visit Customer', customerPhone: '0511111111', technicianName: 'Ahmed' };

  // ================= Part A: Admin -> Technicians full completion details =================

  it('1. GET /technicians (Admin) includes actualCompletionDate for a completed task', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...completeBase, completionAmount: 300, completionPaymentMethod: 'CASH' });

    const res = await request(ts.baseUrl).get('/api/technicians').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const tech = res.body.data.find((t: any) => t.id === users.technician.id);
    const task = tech.completedTasksList.find((x: any) => x.id === id);
    expect(task).toBeTruthy();
    expect(task.actualCompletionDate).toBeTruthy();
    expect(new Date(task.actualCompletionDate).toISOString().slice(0, 10)).toBe(completeBase.actualCompletionDate);
  });

  it('2. GET /technicians (Admin) includes maintenanceConfirmed, defaulting to false right after completion', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...completeBase, completionAmount: 300, completionPaymentMethod: 'CASH' });

    const res = await request(ts.baseUrl).get('/api/technicians').set('Authorization', `Bearer ${adminToken}`);
    const tech = res.body.data.find((t: any) => t.id === users.technician.id);
    const task = tech.completedTasksList.find((x: any) => x.id === id);
    expect(task.maintenanceConfirmed).toBe(false);
  });

  it('3. maintenanceConfirmed flips to true in the Admin Technicians view after Scheduling confirms the operation (Modification #8 regression)', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...completeBase, completionAmount: 300, completionPaymentMethod: 'CASH' });
    await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${schedToken}`).send({});

    const res = await request(ts.baseUrl).get('/api/technicians').set('Authorization', `Bearer ${adminToken}`);
    const tech = res.body.data.find((t: any) => t.id === users.technician.id);
    const task = tech.completedTasksList.find((x: any) => x.id === id);
    expect(task.maintenanceConfirmed).toBe(true);
  });

  it('4. GET /technicians still includes all pre-existing completion fields alongside the two new ones (no field was dropped)', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...completeBase, completionAmount: 300, completionPaymentMethod: 'BANK_TRANSFER_COMMERCIAL', nextMaintenanceNote: 'Replace filter next time' });

    const res = await request(ts.baseUrl).get('/api/technicians').set('Authorization', `Bearer ${adminToken}`);
    const tech = res.body.data.find((t: any) => t.id === users.technician.id);
    const task = tech.completedTasksList.find((x: any) => x.id === id);
    expect(task.completionAmount).toBe(300);
    expect(task.completionPaymentMethod).toBe('BANK_TRANSFER_COMMERCIAL');
    expect(task.nextMaintenanceNote).toBe('Replace filter next time');
    expect(task.serviceDetails).toBe('Serviced units');
    expect(task.customer.name).toBeTruthy();
    expect(task.type).toBe('MAINTENANCE');
    expect(task.scheduledDate).toBeTruthy();
    expect(task.completedAt).toBeTruthy();
  });

  it('5. Scheduling still does NOT receive completionAmount/completionPaymentMethod via /technicians (Modification #6 privacy regression)', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...completeBase, completionAmount: 300, completionPaymentMethod: 'CASH' });

    const res = await request(ts.baseUrl).get('/api/technicians').set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(200);
    const tech = res.body.data.find((t: any) => t.id === users.technician.id);
    const task = tech.completedTasksList.find((x: any) => x.id === id);
    expect(task.completionAmount).toBeUndefined();
    expect(task.completionPaymentMethod).toBeUndefined();
    expect(task.completionImage).toBeUndefined();
  });

  it('6. actualCompletionDate and maintenanceConfirmed ARE visible to Scheduling via /technicians (not financial data, unaffected by Modification #6 stripping)', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...completeBase, completionAmount: 300, completionPaymentMethod: 'CASH' });

    const res = await request(ts.baseUrl).get('/api/technicians').set('Authorization', `Bearer ${schedToken}`);
    const tech = res.body.data.find((t: any) => t.id === users.technician.id);
    const task = tech.completedTasksList.find((x: any) => x.id === id);
    expect(task.actualCompletionDate).toBeTruthy();
    expect(task.maintenanceConfirmed).toBe(false);
  });

  // ================= Part B: Urgent Technician Name (required, not persisted) =================

  it('7. POST /urgent-visits rejects a missing technicianName', async () => {
    const id = await createUrgentAppointment();
    const { technicianName, ...body } = urgentVisitBase;
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...body, appointmentId: id, serviceType: 'MAINTENANCE', amount: 200, paymentMethod: 'CASH' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Technician name is required/i);
  });

  it('8. POST /urgent-visits rejects a whitespace-only technicianName', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, technicianName: '   ', appointmentId: id, serviceType: 'MAINTENANCE', amount: 200, paymentMethod: 'CASH' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Technician name is required/i);
  });

  it('9. POST /urgent-visits rejects a multi-word English name ("Ahmed Ali")', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, technicianName: 'Ahmed Ali', appointmentId: id, serviceType: 'MAINTENANCE', amount: 200, paymentMethod: 'CASH' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/first name only/i);
  });

  it('10. POST /urgent-visits rejects a multi-word Arabic name ("محمد أحمد")', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, technicianName: 'محمد أحمد', appointmentId: id, serviceType: 'MAINTENANCE', amount: 200, paymentMethod: 'CASH' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/first name only/i);
  });

  it('11. POST /urgent-visits accepts a valid English first name', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, technicianName: 'Ahmed', appointmentId: id, serviceType: 'MAINTENANCE', amount: 200, paymentMethod: 'CASH' });
    expect(res.status).toBe(201);
  });

  it('12. POST /urgent-visits accepts a valid Arabic first name', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, technicianName: 'محمد', appointmentId: id, serviceType: 'MAINTENANCE', amount: 200, paymentMethod: 'CASH' });
    expect(res.status).toBe(201);
  });

  it('13. technicianName is not persisted -- the created record has no such field, and the DB row confirms it', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'MAINTENANCE', amount: 200, paymentMethod: 'CASH' });
    expect(res.status).toBe(201);
    expect(res.body.data.technicianName).toBeUndefined();
    const row = await prisma.urgentVisitRecord.findUnique({ where: { id: res.body.data.id } });
    expect((row as any).technicianName).toBeUndefined();
  });

  it('14. The audit log identifies the real authenticated technician, not the submitted technicianName string', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, technicianName: 'Khaled', appointmentId: id, serviceType: 'MAINTENANCE', amount: 200, paymentMethod: 'CASH' });
    expect(res.status).toBe(201);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'urgent_visit', entityId: res.body.data.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit?.userId).toBe(users.technician.id);
  });

  it('15. Submitted technicianName does not change technicianId/assignment or bypass the IDOR guard', async () => {
    const id = await createUrgentAppointment(users.technician2.id);
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, technicianName: 'Ahmed', appointmentId: id, serviceType: 'MAINTENANCE', amount: 200, paymentMethod: 'CASH' });
    expect(res.status).toBe(403);
  });

  it('16. GET /urgent-visits (Admin) returns the completing technician\'s real name via submittedBy, plus customerDetails/serviceNotes and the linked appointment\'s urgentLocation', async () => {
    const id = await createUrgentAppointment();
    await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({
        ...urgentVisitBase, technicianName: 'Ahmed', appointmentId: id, serviceType: 'MAINTENANCE',
        amount: 200, paymentMethod: 'CASH', customerDetails: 'Gate code 1234', serviceNotes: 'Replaced filter cartridge',
      });

    const res = await request(ts.baseUrl).get('/api/urgent-visits').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const record = res.body.data.find((r: any) => r.appointmentId === id);
    expect(record.submittedBy?.name).toBe('Test Technician 1');
    expect(record.customerDetails).toBe('Gate code 1234');
    expect(record.serviceNotes).toBe('Replaced filter cartridge');
    expect(record.appointment?.urgentLocation).toBeTruthy();
    const loc = JSON.parse(record.appointment.urgentLocation);
    expect(loc.city).toBe('Riyadh');
  });

  it('17. Scheduling still cannot access GET /urgent-visits at all (regression, unaffected by this batch)', async () => {
    const res = await request(ts.baseUrl).get('/api/urgent-visits').set('Authorization', `Bearer ${schedToken}`);
    expect(res.status).toBe(403);
  });

  it('18. Visit Only submissions still normalize amount to 0 with technicianName required and present (Visit Only regression)', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'VISIT_ONLY' });
    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(0);
    expect(res.body.data.paymentMethod).toBe('');
  });

  it('19. Bank Transfer subtype requirement still enforced alongside the new technicianName requirement', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'MAINTENANCE', amount: 300, paymentMethod: 'BANK_TRANSFER' });
    expect(res.status).toBe(400);
  });

  it('20. Existing urgent completion submit flow still succeeds end-to-end with a valid technicianName', async () => {
    const id = await createUrgentAppointment();
    const res = await request(ts.baseUrl).post('/api/urgent-visits').set('Authorization', `Bearer ${techToken}`)
      .send({ ...urgentVisitBase, appointmentId: id, serviceType: 'MAINTENANCE', amount: 300, paymentMethod: 'BANK_TRANSFER_PERSONAL' });
    expect(res.status).toBe(201);
    expect(res.body.data.paymentMethod).toBe('BANK_TRANSFER_PERSONAL');
    expect(res.body.data.submittedBy?.name).toBe('Test Technician 1');
  });
});
