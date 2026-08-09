// Notification read-on-section-open fix (Part B): the backend read-state
// architecture is entirely pre-existing and unchanged -- Notification.isRead
// is a real per-user (userId), DB-persisted column, and GET /notifications,
// PATCH /notifications/read-all, and PATCH /notifications/:id/read are all
// already correctly scoped to the authenticated caller's own userId. The
// frontend fix (Notifications.tsx pages, all three departments) simply calls
// the existing PATCH /notifications/read-all automatically when the page
// mounts with unread items, instead of requiring a manual button click --
// no backend change was needed or made. These tests lock in the per-user
// read-state contract the frontend fix depends on for correctness/safety.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Notification read state (Part B backend contract)', () => {
  let ts: TestServer;
  let users: TestUsers;
  let techToken: string, schedToken: string, adminToken: string;
  const createdNotificationIds: string[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    techToken = signTestToken(users.technician.id, 'TECHNICIAN');
    schedToken = signTestToken(users.scheduling.id, 'SCHEDULING');
    adminToken = signTestToken(users.admin.id, 'ADMIN');
  });

  afterAll(async () => {
    if (createdNotificationIds.length) await prisma.notification.deleteMany({ where: { id: { in: createdNotificationIds } } });
    await stopTestServer(ts.server);
  });

  async function createNotification(userId: string, title = 'Test reminder'): Promise<string> {
    const n = await prisma.notification.create({
      data: { userId, title, body: 'Test body', type: 'APPOINTMENT_REMINDER', isRead: false },
    });
    createdNotificationIds.push(n.id);
    return n.id;
  }

  it('GET /notifications returns only the authenticated user\'s own notifications', async () => {
    const mine = await createNotification(users.technician.id, 'Mine');
    const other = await createNotification(users.technician2.id, 'Not mine');

    const res = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((n: any) => n.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(other);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(ts.baseUrl).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  // 11, 12, 16, 20. The auto-read-on-open frontend fix calls this exact
  // existing endpoint; it correctly marks the caller's own unread items read,
  // and the change persists on a subsequent fetch.
  it('PATCH /notifications/read-all marks the caller\'s own unread notifications as read, and it persists', async () => {
    const id1 = await createNotification(users.technician.id, 'Reminder 1');
    const id2 = await createNotification(users.technician.id, 'Reminder 2');

    const res = await request(ts.baseUrl).patch('/api/notifications/read-all').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);

    const after = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${techToken}`);
    const n1 = after.body.data.find((n: any) => n.id === id1);
    const n2 = after.body.data.find((n: any) => n.id === id2);
    expect(n1.isRead).toBe(true);
    expect(n2.isRead).toBe(true);

    // Persists on a fresh fetch (not just in the same response) -- a real DB
    // read, not local/session-only state.
    const refetch = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${techToken}`);
    expect(refetch.body.data.find((n: any) => n.id === id1).isRead).toBe(true);
  });

  // 17, 18. Per-user boundary: User A's read-all can never affect User B's
  // notifications, regardless of role -- Technician 1 cannot mark
  // Technician 2's, Scheduling's, or Admin's notifications read.
  it('marking one user\'s notifications read does not affect another user\'s unread notifications', async () => {
    const mine = await createNotification(users.technician.id, 'Mine to read');
    const tech2s = await createNotification(users.technician2.id, 'Tech2 stays unread');
    const scheds = await createNotification(users.scheduling.id, 'Scheduling stays unread');
    const admins = await createNotification(users.admin.id, 'Admin stays unread');

    await request(ts.baseUrl).patch('/api/notifications/read-all').set('Authorization', `Bearer ${techToken}`);

    const mineCheck = await prisma.notification.findUnique({ where: { id: mine } });
    expect(mineCheck?.isRead).toBe(true);

    const tech2Check = await prisma.notification.findUnique({ where: { id: tech2s } });
    expect(tech2Check?.isRead).toBe(false);
    const schedCheck = await prisma.notification.findUnique({ where: { id: scheds } });
    expect(schedCheck?.isRead).toBe(false);
    const adminCheck = await prisma.notification.findUnique({ where: { id: admins } });
    expect(adminCheck?.isRead).toBe(false);
  });

  // Direct per-notification mark-read is also correctly scoped: a caller
  // cannot mark another user's notification read by ID (404, not a silent
  // no-op or a cross-user write).
  it('PATCH /notifications/:id/read on another user\'s notification returns 404 and does not modify it', async () => {
    const tech2Notif = await createNotification(users.technician2.id, 'Belongs to Technician 2');

    const res = await request(ts.baseUrl).patch(`/api/notifications/${tech2Notif}/read`).set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(404);

    const check = await prisma.notification.findUnique({ where: { id: tech2Notif } });
    expect(check?.isRead).toBe(false);
  });

  it('PATCH /notifications/:id/read on the caller\'s own notification succeeds', async () => {
    const id = await createNotification(users.technician.id, 'Mark this one');
    const res = await request(ts.baseUrl).patch(`/api/notifications/${id}/read`).set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.isRead).toBe(true);
  });

  // 19. A notification created after an earlier read-all remains unread --
  // the read-all only ever affects what is unread at the moment it runs.
  it('a notification created after a read-all remains unread', async () => {
    await request(ts.baseUrl).patch('/api/notifications/read-all').set('Authorization', `Bearer ${techToken}`);
    const newId = await createNotification(users.technician.id, 'Arrived after read-all');
    const check = await prisma.notification.findUnique({ where: { id: newId } });
    expect(check?.isRead).toBe(false);
  });

  // Cross-role sanity: Scheduling and Admin each only ever see/affect their own.
  it('Scheduling and Admin each only see and can only mark their own notifications', async () => {
    const schedId = await createNotification(users.scheduling.id, 'Scheduling notif');
    const adminId = await createNotification(users.admin.id, 'Admin notif');

    const schedList = await request(ts.baseUrl).get('/api/notifications').set('Authorization', `Bearer ${schedToken}`);
    expect(schedList.body.data.map((n: any) => n.id)).toContain(schedId);
    expect(schedList.body.data.map((n: any) => n.id)).not.toContain(adminId);

    await request(ts.baseUrl).patch('/api/notifications/read-all').set('Authorization', `Bearer ${schedToken}`);
    const adminCheck = await prisma.notification.findUnique({ where: { id: adminId } });
    expect(adminCheck?.isRead).toBe(false);

    await request(ts.baseUrl).patch('/api/notifications/read-all').set('Authorization', `Bearer ${adminToken}`);
    const adminCheck2 = await prisma.notification.findUnique({ where: { id: adminId } });
    expect(adminCheck2?.isRead).toBe(true);
  });
});
