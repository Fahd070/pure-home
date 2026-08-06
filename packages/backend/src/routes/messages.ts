import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToRoles } from '../socket';
import { SOCKET_EVENTS, SOCKET_ROOMS } from '../constants';
import { writeAudit } from '../services/audit.service';
import {
  bulkDeleteAllSchema,
  StaleCountError,
  sendStaleCountConflict,
  isTransactionConflict,
  sendTransactionConflict,
} from '../services/bulkDelete.service';

const router = Router();
router.use(authenticate);

router.get('/', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const where: any = { NOT: { action: { contains: 'Scheduling visibility' } } };
    if (req.user!.role === 'SCHEDULING') {
      // Scheduling only sees customer logs and appointment logs for visible appointments
      const visibleAppts = await prisma.appointment.findMany({
        where: { visibleToScheduling: true },
        select: { id: true }
      });
      const visibleApptIds = visibleAppts.map((a: any) => a.id);
      where.OR = [
        { entityType: 'customer' },
        { entityType: 'appointment', entityId: { in: visibleApptIds } },
      ];
    }
    const logs = await prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    // Unconditional total (not the role-filtered `where` above): DELETE / below wipes
    // every audit log row unconditionally, so the confirmation count shown to the
    // caller must match that real, full scope -- not the filtered list view -- or the
    // expectedCount safety check below would perpetually mismatch and block ADMIN.
    const total = await prisma.auditLog.count();
    res.json({ success: true, data: logs, meta: { total } });
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await prisma.auditLog.delete({ where: { id: req.params.id } });
    emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.AUDIT_DELETED, { id: req.params.id });
    res.json({ success: true });
  } catch (e) { next(e); }
});

// CRITICAL: wipes the entire audit trail -- the system's own accountability record.
// ADMIN only, confirm:true, and expectedCount checked against the real unconditional
// count inside the same transaction as the delete. A single new audit row documenting
// the wipe itself is written immediately afterward (outside the transaction, since the
// table it targets was just emptied), so the action of clearing the log is itself the
// one thing that always survives being logged.
router.delete('/', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { expectedCount } = bulkDeleteAllSchema.parse(req.body);

    const outcome = await prisma.$transaction(
      async (tx) => {
        const actualCount = await tx.auditLog.count();
        if (actualCount !== expectedCount) {
          throw new StaleCountError(actualCount, expectedCount);
        }
        if (actualCount === 0) return { deletedCount: 0 };
        const result = await tx.auditLog.deleteMany({});
        return { deletedCount: result.count };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if (outcome.deletedCount > 0) {
      await writeAudit({
        action: 'DELETE', entityType: 'audit_log', entityId: 'all',
        userId: req.user!.userId,
        label: `Audit log cleared (${outcome.deletedCount} entries permanently deleted)`,
        labelAr: `تم مسح سجل النشاط (${outcome.deletedCount} إدخال تم حذفه نهائيًا)`,
        before: { count: outcome.deletedCount },
      });
      emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.AUDIT_DELETED, { all: true });
    }
    res.json({ success: true, data: { deletedCount: outcome.deletedCount } });
  } catch (e) {
    if (e instanceof StaleCountError) return sendStaleCountConflict(res, e);
    if (isTransactionConflict(e)) return sendTransactionConflict(res);
    next(e);
  }
});

export default router;
