import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { emitToAll } from '../socket';
import { SOCKET_EVENTS } from '../constants';

const router = Router();
router.use(authenticate);

router.get('/', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const logs = await prisma.auditLog.findMany({
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
