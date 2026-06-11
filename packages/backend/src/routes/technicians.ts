import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', requireRole('ADMIN', 'SCHEDULING'), async (req, res, next) => {
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
      const postponed = await prisma.maintenanceTask.count({ where: { technicianId: t.id, status: 'POSTPONED' } });
      const pending = await prisma.maintenanceTask.count({ where: { technicianId: t.id, status: 'POSTPONED' } });
      const completedTasksList = await prisma.maintenanceTask.findMany({
        where: { technicianId: t.id, status: 'COMPLETED' },
        include: { appointment: { include: { customer: { select: { id: true, name: true, phone: true } } } } },
        orderBy: { completedAt: 'desc' },
        take: 20,
      });
      const postponedTasksList = await prisma.maintenanceTask.findMany({
        where: { technicianId: t.id, status: 'POSTPONED' },
        include: {
          appointment: { include: { customer: { select: { id: true, name: true, phone: true } } } },
          postponements: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        take: 20,
      });
      return { ...t, completedTasks: completed, postponedTasks: postponed, pendingTasks: pending, completedTasksList, postponedTasksList };
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
