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
        _count: { select: { assignedAppointments: true } },
        assignedAppointments: {
          where: { workStatus: { in: ['COMPLETED', 'POSTPONED'] } },
          select: {
            id: true, workStatus: true, completedAt: true,
            workNotes: true, serviceDetails: true,
            completionAmount: true, completionPaymentMethod: true,
            completionImage: true,
            type: true, scheduledDate: true,
            customer: { select: { id: true, name: true, phone: true } },
            postponements: { orderBy: { createdAt: 'desc' as const }, take: 1 },
          },
          orderBy: { createdAt: 'desc' as const },
          take: 40,
        },
      },
    });
    const result = techs.map((t: any) => {
      const completedTasksList = t.assignedAppointments.filter((x: any) => x.workStatus === 'COMPLETED').slice(0, 20);
      const postponedTasksList = t.assignedAppointments.filter((x: any) => x.workStatus === 'POSTPONED').slice(0, 20);
      const { assignedAppointments, ...rest } = t;
      return {
        ...rest,
        completedTasks: completedTasksList.length,
        postponedTasks: postponedTasksList.length,
        pendingTasks: postponedTasksList.length,
        completedTasksList,
        postponedTasksList,
      };
    });
    if (!isAdmin) {
      result.forEach((tech: any) => {
        tech.completedTasksList?.forEach((appt: any) => {
          delete appt.completionImage;
          delete appt.completionAmount;
          delete appt.completionPaymentMethod;
        });
        tech.postponedTasksList?.forEach((appt: any) => { delete appt.completionImage; });
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
