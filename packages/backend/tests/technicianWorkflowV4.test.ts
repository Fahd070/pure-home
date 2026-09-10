// v4 Requirements #6 and #7: postpone-as-reschedule, and customer-did-not-answer.
//
// Covers attribution (decision D4), BOLA/impersonation, durability of the
// history, and backward compatibility with the shape Desktop v3.6.5 sends.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers, testPhone, uniqueSuffix } from './helpers/fixtures';
import prisma from '../src/prisma';

/**
 * Dates are RELATIVE, never hardcoded calendar dates.
 *
 * These tests originally used fixed 2026-06/07 dates. Once the server gained a
 * "a reschedule may not move an appointment into the past" rule, those fixed
 * dates silently aged into the past and the suite started failing for a reason
 * unrelated to what it tests. Relative dates keep the intent ("later than the
 * appointment", "earlier than today") true forever.
 */
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}
const iso = (days: number) => daysFromNow(days).toISOString();
const ymd = (days: number) => daysFromNow(days).toISOString().slice(0, 10);

describe('v4 technician workflow: postpone / did-not-answer', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, techToken: string, tech2Token: string, schedToken: string;
  const customerIds: string[] = [];

  async function makeCustomer() {
    const c = await prisma.customer.create({
      data: {
        name: `WF ${uniqueSuffix()}`, phone: testPhone(),
        maintenanceCycle: 'MONTHLY', maintenanceFrequency: 3,
      },
    });
    customerIds.push(c.id);
    return c;
  }

  /** An appointment assigned to technician 1, in the given work state. */
  async function makeAppointment(workStatus = 'IN_PROGRESS', technicianId = users.technician.id) {
    const c = await makeCustomer();
    return prisma.appointment.create({
      data: {
        customerId: c.id, type: 'MAINTENANCE',
        scheduledDate: daysFromNow(3),
        workStatus, technicianId, isUrgent: false,
      },
    });
  }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
    tech2Token = signTestToken(users.technician2.id, 'TECHNICIAN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await stopTestServer(ts.server);
  });

  // ------------------------------------------------------------ postpone

  it('moves the appointment to the new date and keeps it actionable', async () => {
    const appt = await makeAppointment();
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/postpone`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ newDate: iso(10), note: 'Customer asked for next week' });

    expect(res.status).toBe(200);
    const after = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(after!.scheduledDate.toISOString().slice(0, 10)).toBe(ymd(10));
    // Actionable again -- not stranded in POSTPONED, where it would vanish from
    // the technician queue and every dashboard bucket.
    expect(after!.workStatus).toBe('WAITING');
    expect(after!.status).toBe('RESCHEDULED');
  });

  it('retains the original date in durable history', async () => {
    const appt = await makeAppointment();
    await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/postpone`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ newDate: iso(21) });

    const record = await prisma.postponementRecord.findFirst({ where: { appointmentId: appt.id } });
    expect(record!.previousDate!.toISOString().slice(0, 10)).toBe(ymd(3));
    expect(record!.newDate!.toISOString().slice(0, 10)).toBe(ymd(21));
  });

  it('attributes the postponement to the authenticated technician', async () => {
    const appt = await makeAppointment();
    await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/postpone`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ newDate: iso(21) });

    const record = await prisma.postponementRecord.findFirst({ where: { appointmentId: appt.id } });
    expect(record!.requestedById).toBe(users.technician.id);
  });

  it('ignores any technician identity supplied in the request body', async () => {
    const appt = await makeAppointment();
    await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/postpone`)
      .set('Authorization', `Bearer ${techToken}`)
      // A client attempting to attribute its action to someone else.
      .send({
        newDate: iso(21),
        requestedById: users.technician2.id,
        technicianId: users.technician2.id,
        technicianName: 'Someone Else',
      });

    const record = await prisma.postponementRecord.findFirst({ where: { appointmentId: appt.id } });
    // The JWT wins. Always.
    expect(record!.requestedById).toBe(users.technician.id);
    expect(record!.requestedById).not.toBe(users.technician2.id);
  });

  it("a technician cannot postpone another technician's appointment", async () => {
    const appt = await makeAppointment('IN_PROGRESS', users.technician.id);
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/postpone`)
      .set('Authorization', `Bearer ${tech2Token}`)
      .send({ newDate: iso(21) });
    // Indistinguishable from nonexistent.
    expect(res.status).toBe(404);
    const after = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(after!.scheduledDate.toISOString().slice(0, 10)).toBe(ymd(3));
  });

  it('postponement history survives a later reschedule and a later completion', async () => {
    const appt = await makeAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/postpone`)
      .set('Authorization', `Bearer ${techToken}`).send({ newDate: iso(10), note: 'first' });

    // Second postponement from the new date.
    await prisma.appointment.update({ where: { id: appt.id }, data: { workStatus: 'IN_PROGRESS' } });
    await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/postpone`)
      .set('Authorization', `Bearer ${techToken}`).send({ newDate: iso(14), note: 'second' });

    const records = await prisma.postponementRecord.findMany({ where: { appointmentId: appt.id }, orderBy: { createdAt: 'asc' } });
    expect(records).toHaveLength(2);
    expect(records[0].previousDate!.toISOString().slice(0, 10)).toBe(ymd(3));
    expect(records[1].previousDate!.toISOString().slice(0, 10)).toBe(ymd(10));
  });

  it('BACKWARD COMPATIBILITY: the v3.6.5 shape (reason, no newDate) still works unchanged', async () => {
    const appt = await makeAppointment();
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/postpone`)
      .set('Authorization', `Bearer ${techToken}`)
      // Exactly what Desktop v3.6.5 sends when the technician leaves the
      // optional date blank.
      .send({ reason: 'Legacy client reason' });

    expect(res.status).toBe(200);
    const after = await prisma.appointment.findUnique({ where: { id: appt.id } });
    // Old terminal behaviour preserved: no invented date, no silent reschedule.
    expect(after!.workStatus).toBe('POSTPONED');
    expect(after!.scheduledDate.toISOString().slice(0, 10)).toBe(ymd(3));
    const record = await prisma.postponementRecord.findFirst({ where: { appointmentId: appt.id } });
    expect(record!.reason).toBe('Legacy client reason');
    expect(record!.previousDate).toBeNull();
  });

  it('rejects an unparseable new date', async () => {
    const appt = await makeAppointment();
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/postpone`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ newDate: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  // ------------------------------------------------------- did not answer

  it('records the attempt and leaves the appointment open and actionable', async () => {
    const appt = await makeAppointment();
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/no-answer`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ note: 'Rang three times' });

    expect(res.status).toBe(200);
    const after = await prisma.appointment.findUnique({ where: { id: appt.id } });
    // Still in the queue -- the whole point of the chosen semantics.
    expect(after!.workStatus).toBe('WAITING');
    // Not rescheduled: no date is invented on the customer's behalf.
    expect(after!.scheduledDate.toISOString().slice(0, 10)).toBe(ymd(3));

    const record = await prisma.customerNoAnswerRecord.findFirst({ where: { appointmentId: appt.id } });
    expect(record!.note).toBe('Rang three times');
    expect(record!.recordedById).toBe(users.technician.id);
  });

  it('the note is optional', async () => {
    const appt = await makeAppointment();
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/no-answer`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({});
    expect(res.status).toBe(200);
    const record = await prisma.customerNoAnswerRecord.findFirst({ where: { appointmentId: appt.id } });
    expect(record!.note).toBeNull();
  });

  it('never asks for, or accepts, a technician name', async () => {
    const appt = await makeAppointment();
    await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/no-answer`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ note: 'x', technicianName: 'Fake Name', recordedById: users.technician2.id });

    const record = await prisma.customerNoAnswerRecord.findFirst({ where: { appointmentId: appt.id } });
    expect(record!.recordedById).toBe(users.technician.id);
    expect(JSON.stringify(record)).not.toContain('Fake Name');
  });

  it('repeated attempts each produce their own durable record', async () => {
    const appt = await makeAppointment();
    for (const note of ['attempt 1', 'attempt 2', 'attempt 3']) {
      const res = await request(ts.baseUrl)
        .patch(`/api/appointments/${appt.id}/no-answer`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ note });
      expect(res.status).toBe(200);
    }
    const records = await prisma.customerNoAnswerRecord.findMany({ where: { appointmentId: appt.id } });
    expect(records).toHaveLength(3);
  });

  it('the event survives a later completion of the same appointment', async () => {
    const appt = await makeAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${appt.id}/no-answer`)
      .set('Authorization', `Bearer ${techToken}`).send({ note: 'no answer' });

    await prisma.appointment.update({ where: { id: appt.id }, data: { workStatus: 'IN_PROGRESS' } });
    const done = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({
        serviceDetails: 'Filter replaced', completionAmount: 100,
        completionPaymentMethod: 'CASH', actualCompletionDate: '2026-06-11',
      });
    expect(done.status).toBe(200);

    // Still there. A mutable status column would have lost this.
    const records = await prisma.customerNoAnswerRecord.findMany({ where: { appointmentId: appt.id } });
    expect(records).toHaveLength(1);
  });

  it("a technician cannot record a no-answer on another technician's appointment", async () => {
    const appt = await makeAppointment('IN_PROGRESS', users.technician.id);
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/no-answer`)
      .set('Authorization', `Bearer ${tech2Token}`)
      .send({ note: 'x' });
    expect(res.status).toBe(404);
    expect(await prisma.customerNoAnswerRecord.count({ where: { appointmentId: appt.id } })).toBe(0);
  });

  it('SCHEDULING cannot record a no-answer', async () => {
    const appt = await makeAppointment();
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/no-answer`)
      .set('Authorization', `Bearer ${schedToken}`)
      .send({ note: 'x' });
    expect(res.status).toBe(403);
  });

  it('rejects a no-answer on an already-completed appointment', async () => {
    const appt = await makeAppointment('COMPLETED');
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/no-answer`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ note: 'x' });
    expect(res.status).toBe(409);
  });

  // --------------------------------------------------- completion (D4)

  it('completion no longer requires a typed technician name', async () => {
    const appt = await makeAppointment();
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({
        serviceDetails: 'Filter replaced', completionAmount: 250,
        completionPaymentMethod: 'CASH', actualCompletionDate: '2026-06-11',
      });
    expect(res.status).toBe(200);
    const after = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(after!.workStatus).toBe('COMPLETED');
    // No name typed, so nothing stored -- the technician relation is the identity.
    expect(after!.completionTechnicianName).toBeNull();
    expect(after!.technicianId).toBe(users.technician.id);
  });

  it('BACKWARD COMPATIBILITY: a v3.6.5 completion that still sends technicianName is preserved', async () => {
    const appt = await makeAppointment();
    const res = await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({
        serviceDetails: 'Filter replaced', completionAmount: 250,
        completionPaymentMethod: 'CASH', actualCompletionDate: '2026-06-11',
        technicianName: 'Mahdi',
      });
    expect(res.status).toBe(200);
    const after = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(after!.completionTechnicianName).toBe('Mahdi');
    // But it is still never treated as identity.
    expect(after!.technicianId).toBe(users.technician.id);
  });

  it('a completion updates the customer stored due date through the one service', async () => {
    const appt = await makeAppointment();
    await request(ts.baseUrl)
      .patch(`/api/appointments/${appt.id}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({
        serviceDetails: 'Filter replaced', completionAmount: 250,
        completionPaymentMethod: 'CASH', actualCompletionDate: '2026-06-11',
      });

    const cust = await prisma.customer.findUnique({ where: { id: appt.customerId! }, select: { nextMaintenanceDueAt: true } });
    // 11 June + 3 months.
    expect(cust!.nextMaintenanceDueAt!.toISOString().slice(0, 10)).toBe('2026-09-11');
  });
});
