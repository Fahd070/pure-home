// v4 Requirement #11: the Technician Tasks page reports real, durable,
// per-technician operational activity.
//
// The three counters each come from a different source of truth, and each of
// those choices is a behaviour worth pinning: completions from the appointment's
// technician relation, postponements from PostponementRecord (so a reschedule
// does not erase history), and no-answers from CustomerNoAnswerRecord (so a
// second attempt is a second event).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers, testPhone, uniqueSuffix } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Technician Tasks — counts and durable details', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string;
  let schedToken: string;
  const tag = `tech-${uniqueSuffix()}`;
  const customerIds: string[] = [];
  const apptIds: string[] = [];
  const recordIds = { postponements: [] as string[], noAnswers: [] as string[] };

  async function makeAppt(name: string, technicianId: string | null, data: any = {}) {
    const customer = await prisma.customer.create({
      data: { name: `${tag}-${name}`, phone: testPhone(), maintenanceCycle: 'MONTHLY', maintenanceFrequency: 6 },
    });
    customerIds.push(customer.id);
    const appt = await prisma.appointment.create({
      data: {
        customerId: customer.id, type: 'MAINTENANCE', scheduledDate: new Date('2026-05-10T09:00:00Z'),
        isUrgent: false, technicianId, ...data,
      },
    });
    apptIds.push(appt.id);
    return appt;
  }

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');

    // Technician 1: three completions.
    for (let i = 0; i < 3; i++) {
      await makeAppt(`t1-done-${i}`, users.technician.id, {
        workStatus: 'COMPLETED', completedAt: new Date('2026-05-11T10:00:00Z'),
        actualCompletionDate: new Date('2026-05-10T00:00:00Z'),
      });
    }

    // Technician 1: a postponement that was LATER RESCHEDULED. The appointment is
    // back in WAITING/RESCHEDULED, so counting current appointment state would
    // lose it entirely -- which is the behaviour under test.
    const rescheduled = await makeAppt('t1-was-postponed', users.technician.id, {
      workStatus: 'WAITING', status: 'RESCHEDULED', scheduledDate: new Date('2026-06-20T09:00:00Z'),
    });
    const p1 = await prisma.postponementRecord.create({
      data: {
        appointmentId: rescheduled.id, reason: 'customer travelling',
        previousDate: new Date('2026-05-10T09:00:00Z'), newDate: new Date('2026-06-20T09:00:00Z'),
        requestedById: users.technician.id,
      },
    });
    recordIds.postponements.push(p1.id);

    // Technician 1: a still-postponed one, so both shapes are represented.
    const stillPostponed = await makeAppt('t1-postponed', users.technician.id, { workStatus: 'POSTPONED' });
    const p2 = await prisma.postponementRecord.create({
      data: { appointmentId: stillPostponed.id, reason: 'no new date agreed', requestedById: users.technician.id },
    });
    recordIds.postponements.push(p2.id);

    // Technician 1: TWO no-answer attempts on ONE appointment. Repeated attempts
    // are separate durable events, not one stuck job.
    const unreachable = await makeAppt('t1-no-answer', users.technician.id, { workStatus: 'WAITING' });
    for (const note of ['first attempt', 'second attempt']) {
      const r = await prisma.customerNoAnswerRecord.create({
        data: { appointmentId: unreachable.id, note, recordedById: users.technician.id },
      });
      recordIds.noAnswers.push(r.id);
    }

    // Technician 2: one completion and one no-answer, so cross-contamination
    // between two technicians would be visible.
    await makeAppt('t2-done', users.technician2.id, {
      workStatus: 'COMPLETED', completedAt: new Date('2026-05-12T10:00:00Z'),
    });
    const t2Unreachable = await makeAppt('t2-no-answer', users.technician2.id, { workStatus: 'WAITING' });
    const r2 = await prisma.customerNoAnswerRecord.create({
      data: { appointmentId: t2Unreachable.id, recordedById: users.technician2.id },
    });
    recordIds.noAnswers.push(r2.id);

    // A legacy completion with no technician relation at all, carrying only the
    // name typed at the time. It must not be attributed to anybody's count.
    await makeAppt('legacy-shared', null, {
      workStatus: 'COMPLETED', completionTechnicianName: 'Ahmed',
      completedAt: new Date('2025-01-01T10:00:00Z'),
    });
  });

  afterAll(async () => {
    await prisma.customerNoAnswerRecord.deleteMany({ where: { id: { in: recordIds.noAnswers } } });
    await prisma.postponementRecord.deleteMany({ where: { id: { in: recordIds.postponements } } });
    await prisma.appointment.deleteMany({ where: { id: { in: apptIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await stopTestServer(ts.server);
  });

  const roster = (token: string) =>
    request(ts.baseUrl).get('/api/technicians').set('Authorization', `Bearer ${token}`);

  const activity = (token: string, id: string, kind: string, params: Record<string, unknown> = {}) =>
    request(ts.baseUrl).get(`/api/technicians/${id}/activity`).query({ kind, ...params })
      .set('Authorization', `Bearer ${token}`);

  it('reports each technician by their own exact identity', async () => {
    const res = await roster(adminToken);
    expect(res.status).toBe(200);
    const t1 = res.body.data.find((t: any) => t.id === users.technician.id);
    const t2 = res.body.data.find((t: any) => t.id === users.technician2.id);
    expect(t1.name).toBe('Test Technician 1');
    expect(t2.name).toBe('Test Technician 2');
    expect(t1.name).not.toBe(t2.name);
  });

  it('counts completions from the technician relation, per technician', async () => {
    const res = await roster(adminToken);
    const t1 = res.body.data.find((t: any) => t.id === users.technician.id);
    const t2 = res.body.data.find((t: any) => t.id === users.technician2.id);
    expect(t1.completedTasks).toBe(3);
    expect(t2.completedTasks).toBe(1);
  });

  it('counts postponement HISTORY, including one that was later rescheduled', async () => {
    const res = await roster(adminToken);
    const t1 = res.body.data.find((t: any) => t.id === users.technician.id);
    // Two postponement records. Only ONE appointment is still in POSTPONED, so a
    // count derived from current appointment state would say 1 and quietly lose
    // the rescheduled one.
    expect(t1.postponedTasks).toBe(2);
    const stillPostponed = await prisma.appointment.count({
      where: { technicianId: users.technician.id, workStatus: 'POSTPONED', id: { in: apptIds } },
    });
    expect(stillPostponed).toBe(1);
  });

  it('counts every no-answer ATTEMPT, not every stuck appointment', async () => {
    const res = await roster(adminToken);
    const t1 = res.body.data.find((t: any) => t.id === users.technician.id);
    const t2 = res.body.data.find((t: any) => t.id === users.technician2.id);
    expect(t1.noAnswerCount).toBe(2); // two attempts on one appointment
    expect(t2.noAnswerCount).toBe(1);
  });

  it('never attributes one technician’s work to another', async () => {
    const completed = await activity(adminToken, users.technician.id, 'completed', { limit: 100 });
    const names = completed.body.data.map((a: any) => a.customer?.name);
    expect(names.some((n: string) => n?.includes('t2-'))).toBe(false);

    const noAnswer = await activity(adminToken, users.technician2.id, 'no-answer', { limit: 100 });
    expect(noAnswer.body.data).toHaveLength(1);
    expect(noAnswer.body.data[0].appointment.customer.name).toBe(`${tag}-t2-no-answer`);
  });

  it('leaves legacy shared-attribution work out of every individual count', async () => {
    const res = await roster(adminToken);
    const total = res.body.data.reduce((s: number, t: any) => s + t.completedTasks, 0);
    const legacy = await prisma.appointment.findFirst({ where: { id: { in: apptIds }, technicianId: null } });
    expect(legacy?.completionTechnicianName).toBe('Ahmed');
    // It exists, it is completed, and it belongs to nobody -- which is the honest
    // answer rather than assigning it to whoever is convenient.
    expect(total).toBeGreaterThan(0);
    const t1 = res.body.data.find((t: any) => t.id === users.technician.id);
    expect(t1.completedTasks).toBe(3);
  });

  it('serves postponement details from the durable records, with the old and new dates', async () => {
    const res = await activity(adminToken, users.technician.id, 'postponed', { limit: 100 });
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    const moved = res.body.data.find((r: any) => r.reason === 'customer travelling');
    expect(moved.previousDate).toContain('2026-05-10');
    expect(moved.newDate).toContain('2026-06-20');
    expect(moved.appointment.customer.name).toBe(`${tag}-t1-was-postponed`);
    // A record written before previousDate existed renders as absent, not invented.
    const noDates = res.body.data.find((r: any) => r.reason === 'no new date agreed');
    expect(noDates.previousDate).toBeNull();
    expect(noDates.newDate).toBeNull();
  });

  it('serves no-answer details with the customer, appointment, timestamp and note', async () => {
    const res = await activity(adminToken, users.technician.id, 'no-answer', { limit: 100 });
    expect(res.body.meta.total).toBe(2);
    for (const row of res.body.data) {
      expect(row.appointment.customer.name).toBe(`${tag}-t1-no-answer`);
      expect(row.appointment.scheduledDate).toBeTruthy();
      expect(row.createdAt).toBeTruthy();
    }
    expect(res.body.data.map((r: any) => r.note).sort()).toEqual(['first attempt', 'second attempt']);
    expect(res.body.meta.technician.name).toBe('Test Technician 1');
  });

  it('exposes no credentials or hashes through the activity route', async () => {
    for (const kind of ['completed', 'postponed', 'no-answer']) {
      const res = await activity(adminToken, users.technician.id, kind, { limit: 100 });
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/accessCodeHash|"password"|\$2[aby]\$/);
    }
  });

  it('paginates activity rather than returning everything at once', async () => {
    const page1 = await activity(adminToken, users.technician.id, 'completed', { limit: 2, page: 1 });
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta.total).toBe(3);
    expect(page1.body.meta.totalPages).toBe(2);
    const page2 = await activity(adminToken, users.technician.id, 'completed', { limit: 2, page: 2 });
    expect(page2.body.data).toHaveLength(1);
    const overlap = page2.body.data.filter((r: any) => page1.body.data.some((p: any) => p.id === r.id));
    expect(overlap).toHaveLength(0);
  });

  it('rejects an unknown activity kind and a non-technician id', async () => {
    expect((await activity(adminToken, users.technician.id, 'everything')).status).toBe(400);
    // Pointing it at an Admin account must not enumerate that account's records.
    expect((await activity(adminToken, users.admin.id, 'completed')).status).toBe(404);
  });

  it('keeps the activity route ADMIN-only', async () => {
    expect((await activity(schedToken, users.technician.id, 'completed')).status).toBe(403);
    const techToken = signTestToken(users.technician.id, 'TECHNICIAN');
    expect((await activity(techToken, users.technician.id, 'completed')).status).toBe(403);
  });

  it('still withholds financial completion fields from Scheduling on the roster', async () => {
    const res = await roster(schedToken);
    expect(res.status).toBe(200);
    for (const tech of res.body.data) {
      for (const task of tech.completedTasksList || []) {
        expect(task).not.toHaveProperty('completionAmount');
        expect(task).not.toHaveProperty('completionPaymentMethod');
        expect(task).not.toHaveProperty('completionImage');
      }
    }
  });
});
