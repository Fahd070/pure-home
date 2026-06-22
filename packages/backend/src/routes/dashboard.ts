import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToAll } from '../socket';
import { SOCKET_EVENTS } from '../constants';

const router = Router();
router.use(authenticate);

router.get('/stats', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const urgentWhere: any = { isUrgent: true };
    if (req.user?.role === 'SCHEDULING') urgentWhere.visibleToScheduling = true;

    const [total, completed, thisMonth, nextMonth, pending, pendingApproval, todayCount, urgentCount] = await Promise.all([
      prisma.customer.count(),
      prisma.appointment.count({ where: { workStatus: 'COMPLETED', isUrgent: false } }),
      prisma.appointment.count({ where: { isUrgent: false, customerId: { not: null }, scheduledDate: { gte: startOfMonth, lt: startOfNextMonth } } }),
      prisma.appointment.count({ where: { isUrgent: false, customerId: { not: null }, scheduledDate: { gte: startOfNextMonth, lte: endOfNextMonth } } }),
      prisma.appointment.count({ where: { workStatus: 'POSTPONED', isUrgent: false } }),
      prisma.appointment.count({
        where: {
          isUrgent: false,
          customerId: { not: null },
          scheduledDate: { lt: now },
          status: { not: 'CANCELLED' },
          workStatus: { notIn: ['COMPLETED'] }
        }
      }),
      prisma.appointment.count({
        where: {
          isUrgent: false,
          customerId: { not: null },
          scheduledDate: { gte: todayStart, lt: todayEnd },
          status: { not: 'CANCELLED' },
          workStatus: { not: 'COMPLETED' }
        }
      }),
      prisma.appointment.count({ where: urgentWhere }),
    ]);

    res.json({ success: true, data: { total, completed, thisMonth, nextMonth, pending, pendingApproval, todayCount, urgentCount } });
  } catch (e) { next(e); }
});

router.get('/activity', requireRole('ADMIN', 'SCHEDULING'), async (req, res, next) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { isActive: true, activityDismissed: false },
      include: {
        appointments: {
          select: { workStatus: true, scheduledDate: true },
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
      status: c.appointments[0]?.workStatus || 'NO_APPOINTMENT'
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

router.get('/customers-list', requireRole('ADMIN', 'SCHEDULING'), async (req, res, next) => {
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

router.get('/completed-maintenance', requireRole('ADMIN', 'SCHEDULING'), async (req, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const where: any = { appointments: { some: { workStatus: 'COMPLETED' } } };
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
    const total = await prisma.customer.count({ where });
    const data = await prisma.customer.findMany({
      where, include: {
        address: true,
        appointments: { where: { workStatus: 'COMPLETED' }, orderBy: { scheduledDate: 'desc' }, take: 5 }
      },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { updatedAt: 'desc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/this-month', requireRole('ADMIN', 'SCHEDULING'), async (req, res, next) => {
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
      where, include: { customer: { include: { address: true } } },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'asc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/next-month', requireRole('ADMIN', 'SCHEDULING'), async (req, res, next) => {
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
      where, include: { customer: { include: { address: true } } },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'asc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/postponed', requireRole('ADMIN', 'SCHEDULING'), async (req, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const where: any = { appointments: { some: { workStatus: 'POSTPONED' } } };
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
    const total = await prisma.customer.count({ where });
    const data = await prisma.customer.findMany({
      where, include: {
        address: true,
        appointments: {
          where: { workStatus: 'POSTPONED' },
          include: { postponements: { orderBy: { createdAt: 'desc' }, take: 1 } },
          orderBy: { scheduledDate: 'desc' }, take: 3
        }
      },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/overdue', requireRole('ADMIN', 'SCHEDULING'), async (req, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const now = new Date();
    const where: any = {
      isUrgent: false,
      customerId: { not: null },
      scheduledDate: { lt: now },
      status: { not: 'CANCELLED' },
      workStatus: { notIn: ['COMPLETED'] }
    };
    if (search) where.customer = { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] };
    const total = await prisma.appointment.count({ where });
    const data = await prisma.appointment.findMany({
      where, include: { customer: { include: { address: true } } },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'asc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/today', requireRole('ADMIN', 'SCHEDULING'), async (req, res, next) => {
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
      workStatus: { not: 'COMPLETED' }
    };
    if (search) where.customer = { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] };
    const total = await prisma.appointment.count({ where });
    const data = await prisma.appointment.findMany({
      where, include: { customer: { include: { address: true } } },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'asc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/urgent', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const where: any = { isUrgent: true };
    if (req.user?.role === 'SCHEDULING') where.visibleToScheduling = true;
    const total = await prisma.appointment.count({ where });
    const data = await prisma.appointment.findMany({
      where,
      include: { technician: true },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'desc' }
    });
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.delete('/customer/:id', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: { appointments: { select: { id: true } } },
    });
    if (!customer) return res.status(404).json({ success: false, message: 'Not found' });
    const apptIds = customer.appointments.map((a: any) => a.id);
    await prisma.customer.delete({ where: { id: req.params.id } });
    emitToAll(SOCKET_EVENTS.CUSTOMER_DELETED, { id: req.params.id });
    if (apptIds.length > 0) {
      emitToAll(SOCKET_EVENTS.APPOINTMENT_DELETED, { ids: apptIds, customerId: req.params.id });
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.delete('/appointment/:id', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const appt = await prisma.appointment.findUnique({ where: { id: req.params.id } });
    if (!appt) return res.status(404).json({ success: false, message: 'Not found' });
    await prisma.appointment.delete({ where: { id: req.params.id } });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_DELETED, { ids: [req.params.id] });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.put('/appointment/:id', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { scheduledDate, type, status, notes } = req.body;
    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: {
        ...(scheduledDate ? { scheduledDate: new Date(scheduledDate) } : {}),
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(notes !== undefined ? { notes } : {}),
        version: { increment: 1 },
      },
      include: { customer: { include: { address: true } }, urgentVisitRecord: true },
    });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_STATUS, appt);
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

export default router;
