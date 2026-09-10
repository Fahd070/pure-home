import cron from 'node-cron';
import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import prisma from '../prisma';
import { emitToRole, emitToUser } from '../socket';
import { SOCKET_EVENTS, NOTIFICATION_SEVERITY, NOTIFICATION_TYPES } from '../constants';

const REMINDER_DAYS = [10, 7, 3, 1];

// Guards against two overlapping runs (a slow run still in progress when the next
// hourly tick fires, or the hourly tick landing close to the startup delay call).
// Without this, each reminder's duplicate-check (findFirst then createMany, not in
// a transaction) is a time-of-check-to-time-of-use race: both runs could see "not
// yet created" and both insert a duplicate notification for the same appointment/day.
let isRunning = false;

// Exported for the overlap-guard regression test only; startNotificationCron()
// remains the real entry point used by index.ts.
export async function generateReminders() {
  if (isRunning) {
    console.log('[cron] Previous reminder run still in progress; skipping this tick.');
    return;
  }
  isRunning = true;
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
    if (!users.length) return;

    let created = 0;

    // Upcoming reminders: 10, 7, 3, 1 days ahead
    for (const days of REMINDER_DAYS) {
      const target = new Date(now);
      target.setDate(target.getDate() + days);
      const start = new Date(target.getFullYear(), target.getMonth(), target.getDate());
      const end = new Date(start.getTime() + 86400000);

      const appointments = await prisma.appointment.findMany({
        where: { scheduledDate: { gte: start, lt: end }, status: { not: 'CANCELLED' } },
        include: { customer: true }
      });

      for (const appt of appointments) {
        const key = `upcoming:${appt.id}:${days}`;
        const existing = await prisma.notification.findFirst({
          where: { type: NOTIFICATION_TYPES.APPOINTMENT_REMINDER, body: { contains: key }, createdAt: { gte: todayStart } }
        });
        if (existing) continue;

        const customerName = appt.customer?.name || 'زيارة عاجلة';
        const titleAr = days === 1
          ? `تذكير: صيانة "${customerName}" غداً`
          : `تذكير: صيانة "${customerName}" بعد ${days} أيام`;
        const bodyAr = `العميل ${customerName} لديه موعد صيانة بعد ${days === 1 ? 'يوم' : days + ' أيام'}. [${key}]`;

        await prisma.notification.createMany({
          data: users.map((u: { id: string }) => ({
            userId: u.id,
            title: titleAr,
            body: bodyAr,
            type: NOTIFICATION_TYPES.APPOINTMENT_REMINDER
          }))
        });
        created++;
      }
    }

    // Due today
    const todayAppts = await prisma.appointment.findMany({
      where: { scheduledDate: { gte: todayStart, lt: todayEnd }, status: { not: 'CANCELLED' } },
      include: { customer: true }
    });
    for (const appt of todayAppts) {
      const key = `today:${appt.id}`;
      const existing = await prisma.notification.findFirst({
        where: { type: NOTIFICATION_TYPES.APPOINTMENT_REMINDER, body: { contains: key }, createdAt: { gte: todayStart } }
      });
      if (existing) continue;
      await prisma.notification.createMany({
        data: users.map((u: { id: string }) => ({
          userId: u.id,
          title: `الصيانة اليوم: "${appt.customer?.name || 'زيارة عاجلة'}"`,
          body: `موعد صيانة العميل ${appt.customer?.name || 'زيارة عاجلة'} اليوم. [${key}]`,
          type: NOTIFICATION_TYPES.APPOINTMENT_REMINDER
        }))
      });
      created++;
    }

    // Overdue: past due, not cancelled, not completed, within last 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const overdueAppts = await prisma.appointment.findMany({
      where: {
        scheduledDate: { gte: thirtyDaysAgo, lt: todayStart },
        status: { not: 'CANCELLED' },
        workStatus: { not: 'COMPLETED' }
      },
      include: { customer: true }
    });
    for (const appt of overdueAppts) {
      const key = `overdue:${appt.id}`;
      const existing = await prisma.notification.findFirst({
        where: { type: NOTIFICATION_TYPES.APPOINTMENT_REMINDER, body: { contains: key }, createdAt: { gte: todayStart } }
      });
      if (existing) continue;
      const daysLate = Math.floor((now.getTime() - new Date(appt.scheduledDate).getTime()) / 86400000);
      await prisma.notification.createMany({
        data: users.map((u: { id: string }) => ({
          userId: u.id,
          title: `⚠️ صيانة متأخرة: "${appt.customer?.name || 'زيارة عاجلة'}"`,
          body: `صيانة العميل ${appt.customer?.name || 'زيارة عاجلة'} متأخرة منذ ${daysLate === 1 ? 'يوم' : daysLate + ' أيام'}. [${key}]`,
          type: NOTIFICATION_TYPES.APPOINTMENT_REMINDER
        }))
      });
      created++;
    }

    if (created > 0) {
      ['ADMIN', 'SCHEDULING', 'TECHNICIAN'].forEach(role =>
        emitToRole(role, SOCKET_EVENTS.NOTIFICATION_NEW, { type: NOTIFICATION_TYPES.APPOINTMENT_REMINDER, count: created })
      );
      console.log(`[cron] Created ${created} reminder notification(s)`);
    }
  } catch (e) {
    console.error('[cron] Reminder error:', e);
  } finally {
    isRunning = false;
  }
}

// Returns the scheduled task so the caller can stop it during graceful
// shutdown (see src/shutdown.ts) -- previously the return value of
// cron.schedule() was discarded, so the hourly interval kept firing for the
// remainder of the process's lifetime with no way to stop it cleanly.
export function startNotificationCron() {
  const task = cron.schedule('0 * * * *', generateReminders); // Every hour
  setTimeout(generateReminders, 3000);                        // Also run shortly after startup
  return task;
}

// ---------------------------------------------------------------------------
// PHASE 2: the central notification dispatch service.
//
// Every durable notification in this application is created through the three
// functions below -- `resolveActiveRoleRecipients`, `createNotifications` and
// `emitCreatedNotifications` -- so recipient rules, deduplication and realtime
// delivery each exist in exactly one place rather than being re-implemented in
// every route that happens to produce an event.
//
// It is deliberately NOT a generic event bus. There are three critical events
// and one cron producer; an indirection layer with subscribers and handlers
// would be more machinery than the problem has.
// ---------------------------------------------------------------------------

/**
 * Anything that can run a Prisma query: the top-level client, or an interactive
 * transaction client. This is what lets a route create its domain row and the
 * notifications it implies inside ONE transaction, so the two can never diverge.
 */
export type NotificationDb = Pick<PrismaClient, 'notification' | 'user'>;

export interface NotificationContent {
  /**
   * Default-language (Arabic) display text. PLAIN TEXT ONLY.
   *
   * The shipped Desktop v3.6.5 client renders `title`/`body` directly, so
   * whatever goes here is shown to that client verbatim. It must never hold a
   * serialized structure or any encoding that client cannot read.
   */
  title: string;
  body: string;
  /**
   * English counterparts. Optional: a producer with no English text simply
   * omits them, and readers fall back to the default-language fields above.
   */
  titleEn?: string;
  bodyEn?: string;
  type: string;
  severity?: string;
  entityType?: string;
  entityId?: string;
  /**
   * Stable identity of the SOURCE EVENT (not of the entity). Combined with the
   * recipient it is enforced unique by the database, which is what makes a
   * duplicate insert a no-op instead of a duplicate alert.
   */
  dedupeKey?: string;
}

/**
 * The ONLY way recipients are chosen for a role-targeted event.
 *
 * Derived server-side from the role and the user's active state -- never from
 * anything the event-producing client sent. Inactive users are excluded here,
 * which is what keeps a deactivated employee from accumulating alerts.
 */
export async function resolveActiveRoleRecipients(db: NotificationDb, roles: string[]): Promise<string[]> {
  const users = await db.user.findMany({
    where: { role: { in: roles as any }, isActive: true },
    select: { id: true },
  });
  return users.map((u: { id: string }) => u.id);
}

/**
 * Creates one notification row per recipient and returns the CANDIDATE ids it
 * generated -- one per recipient, whether or not that row survived deduplication.
 *
 * Stated precisely because it matters to callers: these are the ids that WOULD
 * have been inserted. A row skipped by `skipDuplicates` still has its id in this
 * list, so the length is a count of recipients, never a count of rows created.
 * To learn what actually landed, read the ids back -- which is exactly what
 * `emitCreatedNotifications` does, and why it can never re-announce a duplicate.
 *
 * Deduplication is enforced by the database, not by a read-then-write check:
 * `createMany({ skipDuplicates: true })` compiles to a single
 * `INSERT ... ON CONFLICT DO NOTHING` against the existing
 * `UNIQUE(userId, dedupeKey)` index. That matters for two independent reasons:
 *
 *   1. It is race-free. A `findFirst` followed by a `create` -- the pattern the
 *      reminder cron still uses -- can let two concurrent runs both observe
 *      "not present" and both insert.
 *   2. It cannot poison a transaction. Catching a P2002 unique violation inside
 *      an interactive transaction would NOT let the caller continue: PostgreSQL
 *      aborts the whole transaction on the failed statement, so every later
 *      statement in it errors. `ON CONFLICT DO NOTHING` never raises, so a
 *      duplicate stays a silent no-op and the surrounding domain write commits.
 *
 * Row ids are generated here rather than by the database precisely so the
 * caller can tell inserted rows from skipped duplicates afterwards: only rows
 * that actually landed have one of the returned ids. Re-emitting an
 * already-acknowledged notification is exactly what that distinction prevents.
 */
export async function createNotifications(
  db: NotificationDb,
  recipientIds: string[],
  content: NotificationContent
): Promise<string[]> {
  const unique = Array.from(new Set(recipientIds)).filter(Boolean);
  if (unique.length === 0) return [];

  const rows = unique.map((userId) => ({
    id: randomUUID(),
    userId,
    title: content.title,
    body: content.body,
    titleEn: content.titleEn ?? null,
    bodyEn: content.bodyEn ?? null,
    type: content.type,
    severity: content.severity ?? NOTIFICATION_SEVERITY.INFO,
    entityType: content.entityType ?? null,
    entityId: content.entityId ?? null,
    dedupeKey: content.dedupeKey ?? null,
  }));

  await db.notification.createMany({ data: rows, skipDuplicates: true });
  return rows.map((r) => r.id);
}

/**
 * Realtime delivery, AFTER the producing transaction has committed.
 *
 * Called with the candidate ids returned by `createNotifications`; rows that
 * were skipped as duplicates simply do not come back from this read, so they
 * are never re-announced. Delivery is strictly into each recipient's OWN
 * `user:<id>` room -- a notification body can name a customer, and role rooms
 * contain users this particular row was never created for.
 *
 * Best-effort by design: the durable row is already committed, so a socket
 * failure costs a live update, never the notification itself. It is deliberately
 * never awaited inside a transaction.
 */
export async function emitCreatedNotifications(candidateIds: string[]): Promise<void> {
  if (candidateIds.length === 0) return;
  try {
    const created = await prisma.notification.findMany({ where: { id: { in: candidateIds } } });
    for (const n of created) {
      emitToUser(n.userId, SOCKET_EVENTS.NOTIFICATION_NEW, n);
    }
  } catch (e: any) {
    console.error('[notifications] Failed to emit created notifications:', e?.message || e);
  }
}
