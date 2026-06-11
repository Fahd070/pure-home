import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/stats', async (req: AuthRequest, res, next) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    // Scheduling dept only sees urgent appointments that admin has made visible to them
    const urgentWhere: any = { isUrgent: true };
    if (req.user?.role === 'SCHEDULING') urgentWhere.visibleToScheduling = true;

    const [total, completed, thisMonth, nextMonth, pending, pendingApproval, todayCount, urgentCount] = await Promise.all([
      prisma.customer.count(),
      prisma.maintenanceTask.count({ where: { status: 'COMPLETED', appointment: { isUrgent: false } } }),
      prisma.appointment.count({ where: { isUrgent: false, customerId: { not: null }, scheduledDate: { gte: startOfMonth, lt: startOfNextMonth } } }),
      prisma.appointment.count({ where: { isUrgent: false, customerId: { not: null }, scheduledDate: { gte: startOfNextMonth, lte: endOfNextMonth } } }),
      prisma.maintenanceTask.count({ where: { status: 'POSTPONED', appointment: { isUrgent: false } } }),
      prisma.appointment.count({
        where: {
          isUrgent: false,
          customerId: { not: null },
          scheduledDate: { lt: now },
          status: { not: 'CANCELLED' },
          task: { status: { notIn: ['COMPLETED'] } }
        }
      }),
      prisma.appointment.count({
        where: {
          isUrgent: false,
          customerId: { not: null },
          scheduledDate: { gte: todayStart, lt: todayEnd },
          status: { not: 'CANCELLED' },
          NOT: { task: { status: 'COMPLETED' } }
        }
      }),
      prisma.appointment.count({ where: urgentWhere }),
    ]);

    res.json({ success: true, data: { total, completed, thisMonth, nextMonth, pending, pendingApproval, todayCount, urgentCount } });
  } catch (e) { next(e); }
});

router.get('/activity', async (req, res, next) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { isActive: true, activityDismissed: false },
      include: {
        appointments: {
          include: { task: true },
          orderBy: { scheduledDate: 'desc' },
          take: 1
        }
      },
      take: 20,
      orderBy: { updatedAt: 'desc' }
    });
    const activity = customers.map((c: any) => ({
      customerId: c.id,
      customerName: c.name,
      phone: c.phone,
      lastAppointment: c.appointments[0] || null,
      status: c.appointments[0]?.task?.status || 'NO_TASK'
    }));
    res.json({ success: true, data: activity });
  } catch (e) { next(e); }
});

router.delete('/activity/:customerId', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    await prisma.customer.update({
      where: { id: req.params.customerId },
      data: { activityDismissed: true }
    });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.delete('/activity', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    await prisma.customer.updateMany({
      where: { isActive: true },
      data: { activityDismissed: true }
    });
    res.json({ success: true });
  } catch (e) { next(e); }
});

// --- Drill-down endpoints for clickable cards ---
router.get('/customers-list', async (req, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const where: any = {};
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
    const total = await prisma.customer.count({ where });
    const data = await prisma.customer.findMany({
      where, include: { address: true },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/completed-maintenance', async (req, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const where: any = {
      appointments: { some: { task: { status: 'COMPLETED' } } }
    };
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
    const total = await prisma.customer.count({ where });
    const data = await prisma.customer.findMany({
      where, include: {
        address: true,
        appointments: { where: { task: { status: 'COMPLETED' } }, include: { task: true }, orderBy: { scheduledDate: 'desc' }, take: 5 }
      },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { updatedAt: 'desc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/this-month', async (req, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const where: any = { isUrgent: false, customerId: { not: null }, scheduledDate: { gte: start, lt: end } };
    if (search) where.customer = { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] };
    const total = await prisma.appointment.count({ where });
    const data = await prisma.appointment.findMany({
      where, include: { customer: { include: { address: true } }, task: true },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'asc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/next-month', async (req, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
    const where: any = { isUrgent: false, customerId: { not: null }, scheduledDate: { gte: start, lte: end } };
    if (search) where.customer = { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] };
    const total = await prisma.appointment.count({ where });
    const data = await prisma.appointment.findMany({
      where, include: { customer: { include: { address: true } }, task: true },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'asc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/postponed', async (req, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const where: any = { appointments: { some: { task: { status: 'POSTPONED' } } } };
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
    const total = await prisma.customer.count({ where });
    const data = await prisma.customer.findMany({
      where, include: {
        address: true,
        appointments: { where: { task: { status: 'POSTPONED' } }, include: { task: { include: { postponements: { orderBy: { createdAt: 'desc' }, take: 1 } } } }, orderBy: { scheduledDate: 'desc' }, take: 3 }
      },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/overdue', async (req, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const now = new Date();
    const where: any = {
      isUrgent: false,
      customerId: { not: null },
      scheduledDate: { lt: now },
      status: { not: 'CANCELLED' },
      task: { status: { notIn: ['COMPLETED'] } }
    };
    if (search) where.customer = { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] };
    const total = await prisma.appointment.count({ where });
    const data = await prisma.appointment.findMany({
      where, include: { customer: { include: { address: true } }, task: true },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'asc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/today', async (req, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);
    const where: any = {
      isUrgent: false,
      customerId: { not: null },
      scheduledDate: { gte: todayStart, lt: todayEnd },
      status: { not: 'CANCELLED' },
      NOT: { task: { status: 'COMPLETED' } }
    };
    if (search) where.customer = { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] };
    const total = await prisma.appointment.count({ where });
    const data = await prisma.appointment.findMany({
      where, include: { customer: { include: { address: true } }, task: true },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'asc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/urgent', async (req: AuthRequest, res, next) => {
  try {
    const { page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const where: any = { isUrgent: true };
    if (req.user?.role === 'SCHEDULING') where.visibleToScheduling = true;
    const total = await prisma.appointment.count({ where });
    const data = await prisma.appointment.findMany({
      where,
      include: { task: { include: { technician: true } } },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'desc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

export default router;