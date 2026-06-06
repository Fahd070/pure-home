import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.userId, type: 'APPOINTMENT_REMINDER' },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json({ success: true, data: notifications });
  } catch (e) { next(e); }
});

router.patch('/read-all', async (req: AuthRequest, res, next) => {
  try {
    await prisma.notification.updateMany({ where: { userId: req.user!.userId, isRead: false }, data: { isRead: true } });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.patch('/:id/read', async (req: AuthRequest, res, next) => {
  try {
    const existing = await prisma.notification.findFirst({ where: { id: req.params.id, userId: req.user!.userId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    const n = await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    res.json({ success: true, data: n });
  } catch (e) { next(e); }
});

export default router;