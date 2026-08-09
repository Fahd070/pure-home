// Modification #13: PATCH /appointments/:id/complete now requires a
// Technician-submitted "technicianName" (first name only) for a non-admin
// completion. This is validated server-side and used purely as business/
// report data -- it is never persisted (no schema change), never used as
// the audit actor (the authenticated req.user!.userId/appt.technician
// relation remain authoritative), and never changes technicianId/assignment.
// Everything else about /complete (Modification #8's actualCompletionDate,
// Modification #6's completion-amount privacy, maintenanceConfirmed reset,
// the Scheduling confirm-operation flow) must keep working unchanged.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, testPhone, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

function dateOnly(d: Date | string): string { return new Date(d).toISOString().slice(0, 10); }

describe('Modification #13: Technician Name required on completion', () => {
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
        name: 'Technician Name Completion Customer',
        phone: testPhone(),
        maintenanceCycle: 'MONTHLY',
        maintenanceFrequency: 1,
        address: { city: 'Riyadh', district: 'Test', street: 'Test' },
      });
    customerId = custRes.body.data.id;
  });

  afterAll(async () => {
    if (createdAppointmentIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

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

  const baseBody = {
    serviceDetails: 'Serviced units',
    completionAmount: 300,
    completionPaymentMethod: 'CASH',
    actualCompletionDate: dateOnly(new Date()),
  };

  // 6. Cannot submit without technicianName
  it('Technician cannot complete without technicianName', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`).send(baseBody);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Technician name is required/i);
  });

  // 7. Whitespace-only is rejected (treated as missing)
  it('rejects a whitespace-only technicianName', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Technician name is required/i);
  });

  // 8. Multi-word English name rejected
  it('rejects a multi-word English name ("Ahmed Ali")', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'Ahmed Ali' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/first name only/i);
  });

  // 9. Multi-word Arabic name rejected
  it('rejects a multi-word Arabic name ("محمد أحمد")', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'محمد أحمد' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/first name only/i);
  });

  // 10. Valid English first name accepted
  it('accepts a valid English first name and completes the appointment', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'Ahmed' });
    expect(res.status).toBe(200);
    expect(res.body.data.workStatus).toBe('COMPLETED');
  });

  // 11. Valid Arabic first name accepted
  it('accepts a valid Arabic first name and completes the appointment', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'محمد' });
    expect(res.status).toBe(200);
    expect(res.body.data.workStatus).toBe('COMPLETED');
  });

  // 12. Leading/trailing whitespace is trimmed before validation
  it('trims leading/trailing whitespace around a valid name', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: '  Khaled  ' });
    expect(res.status).toBe(200);
  });

  // Hyphen/apostrophe are reasonable name characters, not a second word.
  it('accepts a hyphenated single first name', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: "Jean-Paul" });
    expect(res.status).toBe(200);
  });

  // 14. Admin completion remains backward-compatible -- no technicianName required
  it('Admin completion does not require technicianName (backward-compatible)', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${adminToken}`)
      .send(baseBody);
    expect(res.status).toBe(200);
    expect(res.body.data.workStatus).toBe('COMPLETED');
  });

  // 15. Submitted name does not change technicianId/assignment
  it('does not change the appointment\'s technicianId', async () => {
    const id = await createInProgressAppointment();
    const before = await prisma.appointment.findUnique({ where: { id } });
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'Fahad' });
    expect(res.status).toBe(200);
    expect(res.body.data.technicianId).toBe(before?.technicianId);
    expect(res.body.data.technicianId).toBe(users.technician.id);
  });

  // 16. Submitted name does not become the audit actor or replace the real technician's name
  it('audit log identifies the real authenticated technician, not the submitted name string', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'Khaled' });
    expect(res.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'appointment', entityId: id, action: { contains: 'completed' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit?.userId).toBe(users.technician.id);
    // The real User.name ("Test Technician 1"), not the submitted "Khaled".
    expect(audit?.action).toContain('Test Technician 1');
    expect(audit?.action).not.toContain('Khaled');
  });

  // 17. Technician cannot use the field to access another Technician's appointment
  it('Technician 1 cannot complete an appointment assigned to Technician 2, regardless of technicianName', async () => {
    const id = await createInProgressAppointment(users.technician2.id);
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'Ahmed' });
    expect(res.status).toBe(404);
  });

  // 18. actualCompletionDate validation (Modification #8) still works
  it('still rejects a future actualCompletionDate even with a valid technicianName', async () => {
    const id = await createInProgressAppointment();
    const futureDate = dateOnly(new Date(Date.now() + 5 * 86400000));
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, actualCompletionDate: futureDate, technicianName: 'Ahmed' });
    expect(res.status).toBe(400);
  });

  // 19. nextMaintenanceNote remains optional
  it('completes successfully with technicianName present and nextMaintenanceNote omitted', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'Ahmed' });
    expect(res.status).toBe(200);
    expect(res.body.data.nextMaintenanceNote).toBeFalsy();
  });

  // 20. completionAmount privacy (Modification #6) is unchanged by this field
  it('completionAmount remains present for the Technician\'s own response and is stripped from the Scheduling-room payload shape', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'Ahmed' });
    expect(res.status).toBe(200);
    expect(res.body.data.completionAmount).toBe(300);

    // Scheduling reading the appointment list must not see completionAmount (existing privacy sanitizer).
    const schedRead = await request(ts.baseUrl).get(`/api/appointments/${id}`).set('Authorization', `Bearer ${schedToken}`);
    expect(schedRead.body.data.completionAmount).toBeUndefined();
  });

  // 21. maintenanceConfirmed resets to false on every Technician completion
  it('maintenanceConfirmed is reset to false on completion', async () => {
    const id = await createInProgressAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'Ahmed' });
    expect(res.status).toBe(200);
    expect(res.body.data.maintenanceConfirmed).toBe(false);
  });

  // 22. Scheduling confirm-operation flow still works after a completion that included technicianName
  it('Scheduling can still confirm-operation after a technicianName-bearing completion', async () => {
    const id = await createInProgressAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${id}/complete`).set('Authorization', `Bearer ${techToken}`)
      .send({ ...baseBody, technicianName: 'Ahmed' });
    const confirmRes = await request(ts.baseUrl).patch(`/api/appointments/${id}/confirm-operation`).set('Authorization', `Bearer ${schedToken}`).send({});
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.maintenanceConfirmed).toBe(true);
  });
});
