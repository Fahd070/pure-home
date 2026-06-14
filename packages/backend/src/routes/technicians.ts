import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const isAdmin = req.user!.role === 'ADMIN';
    const techs = await prisma.user.findMany({
      where: { role: 'TECHNICIAN' },
      select: {
        id: true, name: true, email: true, role: true,
        _count: { select: { tasks: true } },
        tasks: {
          where: { status: { in: ['COMPLETED', 'POSTPONED'] } },
          select: {
            id: true, status: true, completedAt: true,
            completionImage: true,
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
    // Strip completionImage from SCHEDULING role — admin-only field
    if (!isAdmin) {
      result.forEach((tech: any) => {
        tech.completedTasksList?.forEach((task: any) => { delete task.completionImage; });
        tech.postponedTasksList?.forEach((task: any) => { delete task.completionImage; });
      });
    }
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
