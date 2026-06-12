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
        _count: { select: { tasks: true } },
        tasks: {
          where: { status: { in: ['COMPLETED', 'POSTPONED'] } },
          select: {
            id: true, status: true, completedAt: true,
            appointment: { include: { customer: { select: { id: true, name: true, phone: true } } } },
            postponements: { orderBy: { createdAt: 'desc' as const }, take: 1 },
          },
          orderBy: { createdAt: 'desc' as const },
          take: 40,
        },
      },
    });
    const result = techs.map((t: any) => {
      const completedTasksList = t.tasks.filter((x: any) => x.status === 'COMPLETED').slice(0, 20);
      const postponedTasksList = t.tasks.filter((x: any) => x.status === 'POSTPONED').slice(0, 20);
      const { tasks, ...rest } = t;
      return {
        ...rest,
        completedTasks: completedTasksList.length,
        postponedTasks: postponedTasksList.length,
        pendingTasks: postponedTasksList.length,
        completedTasksList,
        postponedTasksList,
      };
    });
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
