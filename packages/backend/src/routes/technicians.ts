import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const techs = await prisma.user.findMany({
      where: { role: 'TECHNICIAN' },
      select: {
        id: true, name: true, email: true, role: true,
        _count: { select: { tasks: true } }
      }
    });
    const result = await Promise.all(techs.map(async (t: any) => {
      const completed = await prisma.maintenanceTask.count({ where: { technicianId: t.id, status: 'COMPLETED' } });
      const pending = await prisma.maintenanceTask.count({ where: { technicianId: t.id, status: { in: ['PENDING_APPROVAL','APPROVED','IN_PROGRESS'] } } });
      return { ...t, completedTasks: completed, pendingTasks: pending };
    }));
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
});

router.get('/users', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true } });
    res.json({ success: true, data: users });
  } catch (e) { next(e); }
});

export default router;
