import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { emitToUser } from '../socket';
import { SOCKET_EVENTS, NOTIFICATION_SEVERITY } from '../constants';

const router = Router();
router.use(authenticate);

// Every route below scopes strictly to `userId: req.user!.userId`.
//
// That single scope IS the authorization model for notifications: rows are
// per-recipient, so a user can only ever read or modify their own, and role
// isolation follows for free without a role column that could disagree with the
// row's owner. No route accepts a userId from the client.
const ownScope = (req: AuthRequest) => ({ userId: req.user!.userId });

/**
 * PHASE 1 CORRECTNESS FIX.
 *
 * This route previously hardcoded `type: 'APPOINTMENT_REMINDER'` while
 * PATCH /read-all below cleared EVERY unread row for the user. With one
 * notification type in existence that mismatch was invisible. The moment Phase 2
 * introduces a second type (postponement, customer-did-not-answer, urgent
 * assignment), it becomes a silent data-loss bug: the new notifications would
 * never appear in this list, yet the user's "mark all read" button would mark
 * them read anyway -- so the badge count would drop and the user would never
 * learn what it had been counting.
 *
 * Fixed by widening the read to the user's whole scope rather than by narrowing
 * read-all, because the list is what the user actually sees; narrowing read-all
 * to one type would instead leave a badge that no visible action could clear.
 * GET and PATCH /read-all now operate on exactly the same set, which is the
 * property that has to hold.
 */
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const { unread, severity } = req.query as { unread?: string; severity?: string };
    /**
     * PHASE 2, ADDITIVE: an optional `severity` filter.
     *
     * The centred critical-alert queue needs the user's unread CRITICAL
     * notifications. Without this filter it would have to take the unfiltered
     * page below and filter in the browser -- and that page is `take: 50`
     * ordered newest-first, while the hourly reminder cron creates an INFO row
     * per user per appointment. A user with more than 50 unread reminders would
     * therefore never be shown a genuinely critical alert that happens to be
     * older than them. Filtering server-side is what makes the queue correct.
     *
     * Unrecognised values are ignored rather than rejected, so this stays
     * backward compatible with any caller that omits or misspells it.
     */
    const severityFilter =
      severity === NOTIFICATION_SEVERITY.CRITICAL || severity === NOTIFICATION_SEVERITY.INFO
        ? { severity }
        : {};
    const notifications = await prisma.notification.findMany({
      where: {
        ...ownScope(req),
        ...(unread === 'true' ? { isRead: false } : {}),
        ...severityFilter,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: notifications });
  } catch (e) { next(e); }
});

/**
 * Unread count, without transferring the notifications themselves.
 *
 * Phase 2's sidebar badges need a number, and every existing badge that reads
 * this data currently fetches up to 50 full rows on a 30-second poll purely to
 * call `.filter(n => !n.isRead).length` in the browser. This is the same value
 * as a COUNT. `byType` is returned alongside so a per-destination badge does not
 * require a second round trip per badge.
 */
router.get('/unread-count', async (req: AuthRequest, res, next) => {
  try {
    const [total, grouped] = await Promise.all([
      prisma.notification.count({ where: { ...ownScope(req), isRead: false } }),
      prisma.notification.groupBy({
        by: ['type'],
        where: { ...ownScope(req), isRead: false },
        _count: { _all: true },
      }),
    ]);
    const byType: Record<string, number> = {};
    for (const row of grouped) byType[row.type] = row._count._all;
    // Response shape is UNCHANGED from Phase 1. A `bySeverity` breakdown was
    // considered and deliberately left out: the critical-alert queue reads the
    // rows themselves (GET /notifications?unread=true&severity=CRITICAL), so a
    // severity count would have been a second grouped query on every badge poll
    // that nothing reads.
    res.json({ success: true, data: { total, byType } });
  } catch (e) { next(e); }
});

router.patch('/read-all', async (req: AuthRequest, res, next) => {
  try {
    // Deliberately the SAME scope as GET / above -- see the note there. If a
    // future change narrows or widens one of these, it must change both.
    const result = await prisma.notification.updateMany({
      where: { ...ownScope(req), isRead: false },
      data: { isRead: true },
    });
    // Phase 2: tell this user's OTHER live clients that their unread set
    // changed, so a badge on a second device clears without waiting for a poll.
    // Into the caller's own room only -- read state is per user.
    if (result.count > 0) emitToUser(req.user!.userId, SOCKET_EVENTS.NOTIFICATION_READ, { all: true });
    res.json({ success: true, data: { updated: result.count } });
  } catch (e) { next(e); }
});

router.patch('/:id/read', async (req: AuthRequest, res, next) => {
  try {
    // Object-level authorization: another user's notification id is
    // indistinguishable from a nonexistent one -- both a plain 404.
    const existing = await prisma.notification.findFirst({ where: { id: req.params.id, ...ownScope(req) } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    const n = await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    // Same purpose as read-all above: a critical alert acknowledged on one
    // device should stop demanding attention on this user's other devices.
    emitToUser(req.user!.userId, SOCKET_EVENTS.NOTIFICATION_READ, { id: n.id });
    res.json({ success: true, data: n });
  } catch (e) { next(e); }
});

export default router;
