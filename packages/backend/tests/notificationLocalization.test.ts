/**
 * PHASE 2 CLOSURE: notification localization must not break the shipped client.
 *
 * The shipped Desktop v3.6.5 client renders `title` and `body` DIRECTLY -- see
 * technician/pages/Notifications.tsx on main: `{n.title}` and
 * `{cleanBody(n.body)}`. An earlier Phase 2 iteration encoded both languages as
 * a JSON `{ar, en}` pair inside those columns, which that client would have
 * displayed verbatim as raw JSON for the whole rollout.
 *
 * The shipped design instead keeps title/body as ordinary default-language text
 * and adds nullable `titleEn`/`bodyEn` beside them. These tests defend that
 * contract at the API boundary, where a legacy client actually reads it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

/** Exactly what the v3.6.5 client does with a notification body. */
const legacyCleanBody = (body: string) => body.replace(/\s*\[[\w:.\\-]+\]\s*$/, '').trim();

/** Would a legacy client show the user serialized data instead of a sentence? */
function looksLikeSerializedData(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
  return /"\s*(ar|en)\s*"\s*:/.test(trimmed);
}

describe('Notification localization / legacy client compatibility', () => {
  let ts: TestServer;
  let users: TestUsers;
  let adminToken: string, techToken: string;
  let customerId: string;
  const apptIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    adminToken = signTestToken(users.admin.id, 'ADMIN');
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
    const cust = await prisma.customer.create({
      data: { name: 'Localization Customer', phone: '0559990088', maintenanceCycle: 'MONTHLY', maintenanceFrequency: 1 },
    });
    customerId = cust.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { type: { in: ['URGENT_APPOINTMENT_ASSIGNED', 'APPOINTMENT_POSTPONED', 'APPOINTMENT_NO_ANSWER'] } },
    });
    if (apptIds.length) await prisma.appointment.deleteMany({ where: { id: { in: apptIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await stopTestServer(ts.server);
  });

  beforeEach(async () => { await prisma.notification.deleteMany({}); });

  async function makeAppointment() {
    const res = await request(ts.baseUrl).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId, type: 'MAINTENANCE',
        scheduledDate: new Date(Date.now() + 3 * 86400000).toISOString(),
        technicianId: users.technician.id,
      });
    expect(res.status).toBe(201);
    apptIds.push(res.body.data.id);
    return res.body.data.id as string;
  }

  /** Produces one of each Phase 2 notification type, for the admin recipient. */
  async function produceAllPhase2Notifications() {
    const a = await makeAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${a}/no-answer`).set('Authorization', `Bearer ${techToken}`).send({ note: 'n' });
    const b = await makeAppointment();
    await request(ts.baseUrl).patch(`/api/appointments/${b}/postpone`).set('Authorization', `Bearer ${techToken}`)
      .send({ note: 'n', newDate: new Date(Date.now() + 9 * 86400000).toISOString() });
  }

  // 1 + 2: the contract a v3.6.5 client depends on.
  it('every Phase 2 notification exposes title/body as ordinary readable strings', async () => {
    await produceAllPhase2Notifications();
    const res = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);

    for (const n of res.body.data) {
      expect(typeof n.title).toBe('string');
      expect(typeof n.body).toBe('string');
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.body.length).toBeGreaterThan(0);
      // The regression this whole design exists to prevent.
      expect(looksLikeSerializedData(n.title)).toBe(false);
      expect(looksLikeSerializedData(n.body)).toBe(false);
      expect(n.title).not.toContain('{"ar"');
      expect(n.body).not.toContain('{"ar"');
    }
  });

  it('a v3.6.5-style consumer rendering title/body verbatim gets readable text', async () => {
    await produceAllPhase2Notifications();
    const res = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${adminToken}`);

    for (const n of res.body.data) {
      // Exactly the two expressions the shipped client evaluates.
      const renderedTitle = n.title;
      const renderedBody = legacyCleanBody(n.body);
      expect(renderedTitle.trim().length).toBeGreaterThan(0);
      expect(renderedBody.trim().length).toBeGreaterThan(0);
      expect(renderedTitle).not.toMatch(/[{}]/);
      expect(JSON.parse(JSON.stringify(renderedBody))).toBe(renderedBody);
      // And it is genuine Arabic display text, the language that client shows.
      expect(/[؀-ۿ]/.test(renderedTitle)).toBe(true);
    }
  });

  // 3 + 4: both languages are present and separated, not encoded together.
  it('stores Arabic in title/body and English in titleEn/bodyEn', async () => {
    await produceAllPhase2Notifications();
    const rows = await prisma.notification.findMany({ where: { userId: users.admin.id } });
    expect(rows.length).toBe(2);

    for (const n of rows) {
      expect(/[؀-ۿ]/.test(n.title)).toBe(true);
      expect(/[؀-ۿ]/.test(n.body)).toBe(true);
      expect(n.titleEn).toBeTruthy();
      expect(n.bodyEn).toBeTruthy();
      // English columns hold English, and no Arabic leaked across.
      expect(/[A-Za-z]/.test(n.titleEn!)).toBe(true);
      expect(/[؀-ۿ]/.test(n.titleEn!)).toBe(false);
    }
  });

  it('exposes titleEn/bodyEn over the API so an English reader can use them', async () => {
    await produceAllPhase2Notifications();
    const res = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${adminToken}`);
    for (const n of res.body.data) {
      expect(n).toHaveProperty('titleEn');
      expect(n).toHaveProperty('bodyEn');
      expect(typeof n.titleEn).toBe('string');
    }
  });

  // 5 + 7: pre-Phase-2 rows are untouched and still work.
  it('a legacy row with NULL English columns is returned unchanged and renders safely', async () => {
    // Exactly the shape the reminder cron has always written.
    const legacyTitle = 'تذكير: صيانة "عميل" غداً';
    const legacyBody = 'العميل عميل لديه موعد صيانة بعد يوم. [upcoming:abc-123:1]';
    const created = await prisma.notification.create({
      data: { userId: users.admin.id, title: legacyTitle, body: legacyBody, type: 'APPOINTMENT_REMINDER' },
    });
    expect(created.titleEn).toBeNull();
    expect(created.bodyEn).toBeNull();

    const res = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${adminToken}`);
    const row = res.body.data.find((n: any) => n.id === created.id);
    expect(row.title).toBe(legacyTitle);
    expect(row.titleEn).toBeNull();
    // A legacy client renders it exactly as it always did.
    expect(legacyCleanBody(row.body)).toBe('العميل عميل لديه موعد صيانة بعد يوم.');
  });

  it('needs no backfill: existing rows stay valid and are never rewritten', async () => {
    const created = await prisma.notification.create({
      data: { userId: users.admin.id, title: 'قديم', body: 'نص قديم', type: 'APPOINTMENT_REMINDER' },
    });
    // Producing new Phase 2 notifications must not touch historical rows.
    await produceAllPhase2Notifications();
    const after = await prisma.notification.findUnique({ where: { id: created.id } });
    expect(after!.title).toBe('قديم');
    expect(after!.body).toBe('نص قديم');
    expect(after!.titleEn).toBeNull();
    expect(after!.bodyEn).toBeNull();
  });

  // 6: read/unread semantics are untouched by localization.
  it('read/unread logic is unaffected by the localization columns', async () => {
    await produceAllPhase2Notifications();
    const before = await request(ts.baseUrl).get('/api/notifications/unread-count').set('Authorization', `Bearer ${adminToken}`);
    expect(before.body.data.total).toBe(2);

    const list = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${adminToken}`);
    const target = list.body.data[0];
    const ack = await request(ts.baseUrl).patch(`/api/notifications/${target.id}/read`).set('Authorization', `Bearer ${adminToken}`);
    expect(ack.status).toBe(200);
    expect(ack.body.data.isRead).toBe(true);
    // Localized text survives the acknowledgement untouched.
    expect(ack.body.data.title).toBe(target.title);
    expect(ack.body.data.titleEn).toBe(target.titleEn);

    const after = await request(ts.baseUrl).get('/api/notifications/unread-count').set('Authorization', `Bearer ${adminToken}`);
    expect(after.body.data.total).toBe(1);
  });

  /**
   * Regression: notification dates are formatted in UTC.
   *
   * A date-only <input type="date"> value parses as UTC midnight. Formatting it
   * in server-local time on a host west of UTC renders the PREVIOUS day, so a
   * visit moved to the 15th would be announced as the 14th.
   */
  it('names the agreed date in UTC, not the server timezone', async () => {
    const apptId = await makeAppointment();
    // A date-only value, exactly as the client sends it.
    const newDateOnly = '2027-03-15';
    const res = await request(ts.baseUrl).patch(`/api/appointments/${apptId}/postpone`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ note: 'n', newDate: newDateOnly });
    expect(res.status).toBe(200);

    const [n] = await prisma.notification.findMany({
      where: { userId: users.admin.id, type: 'APPOINTMENT_POSTPONED' },
    });
    // The day named must be the day agreed, in both languages.
    expect(n.body).toContain('15/03/2027');
    expect(n.bodyEn).toContain('15/03/2027');
    expect(n.bodyEn).not.toContain('14/03/2027');
  });

  /**
   * Regression: a did-not-answer records a real INSTANT, not a date-only value.
   * Formatting an instant in UTC reports the previous calendar day for anything
   * recorded between midnight and 03:00 in this deployment's timezone (UTC+3).
   */
  it('names the did-not-answer date in the server timezone, not UTC', async () => {
    const apptId = await makeAppointment();
    const res = await request(ts.baseUrl).patch(`/api/appointments/${apptId}/no-answer`)
      .set('Authorization', `Bearer ${techToken}`).send({ note: 'x' });
    expect(res.status).toBe(200);

    const [record] = await prisma.customerNoAnswerRecord.findMany({ where: { appointmentId: apptId } });
    const expected = new Date(record.createdAt).toLocaleDateString('en-GB');
    const [n] = await prisma.notification.findMany({
      where: { userId: users.admin.id, type: 'APPOINTMENT_NO_ANSWER' },
    });
    expect(n.body).toContain(expected);
    expect(n.bodyEn).toContain(expected);
  });

  it('the unread-count response shape is still exactly Phase 1 total + byType', async () => {
    await produceAllPhase2Notifications();
    const res = await request(ts.baseUrl).get('/api/notifications/unread-count').set('Authorization', `Bearer ${adminToken}`);
    expect(Object.keys(res.body.data).sort()).toEqual(['byType', 'total']);
  });
});
