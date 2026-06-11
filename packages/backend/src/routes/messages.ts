import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToAll } from '../socket';
import { SOCKET_EVENTS } from '../constants';

const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const where: any = {};
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
    res.json({ success: true, data: logs });
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await prisma.auditLog.delete({ where: { id: req.params.id } });
    emitToAll(SOCKET_EVENTS.AUDIT_DELETED, { id: req.params.id });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.delete('/', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await prisma.auditLog.deleteMany({});
    emitToAll(SOCKET_EVENTS.AUDIT_DELETED, { all: true });
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
