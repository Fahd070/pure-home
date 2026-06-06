import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

function enrichWithSchedule(customers: any[], now: Date) {
  return customers.map(c => {
    const appts: any[] = c.appointments || [];
    const completed = appts
      .filter(a => a.task?.status === 'COMPLETED')
      .sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());
    const upcoming = appts
      .filter(a => new Date(a.scheduledDate) >= now && a.status !== 'CANCELLED' && a.task?.status !== 'COMPLETED')
      .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());
    const overdue = appts.filter(a =>
      new Date(a.scheduledDate) < now &&
      a.status !== 'CANCELLED' &&
      a.task?.status !== 'COMPLETED'
    );
    const lastMaintenance = completed[0]?.scheduledDate || null;
    const nextMaintenance = upcoming[0]?.scheduledDate || null;
    const daysUntil = nextMaintenance
      ? Math.ceil((new Date(nextMaintenance).getTime() - now.getTime()) / 86400000)
      : null;
    let alertLevel = 'ok';
    if (overdue.length > 0) alertLevel = 'overdue';
    else if (daysUntil !== null && daysUntil <= 10) alertLevel = 'soon';
    return {
      id: c.id, name: c.name, phone: c.phone, notes: c.notes,
      isActive: c.isActive, createdAt: c.createdAt,
      maintenanceCycle: c.maintenanceCycle, maintenanceFrequency: c.maintenanceFrequency,
      address: c.address, lastMaintenance, nextMaintenance, daysUntil, alertLevel,
      overdueCount: overdue.length
    };
  });
}

router.get('/customers', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { search = '', dateFrom, dateTo, status = 'ALL', page = '1', limit = '100' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 100, 200);
    const now = new Date();

    const where: any = {};
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } }
    ];
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59');
    }

    if (status === 'COMPLETED') {
      where.appointments = { some: { task: { status: 'COMPLETED' } } };
    } else if (status === 'OVERDUE') {
      where.appointments = {
        some: {
          scheduledDate: { lt: now },
          status: { not: 'CANCELLED' },
          NOT: { task: { status: 'COMPLETED' } }
        }
      };
    } else if (status === 'POSTPONED') {
      where.appointments = { some: { task: { status: 'POSTPONED' } } };
    } else if (status === 'UPCOMING') {
      const in30 = new Date(now.getTime() + 30 * 86400000);
      where.appointments = { some: { scheduledDate: { gte: now, lte: in30 }, status: { not: 'CANCELLED' } } };
    } else if (status === 'THIS_MONTH') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      where.appointments = { some: { scheduledDate: { gte: start, lt: end } } };
    } else if (status === 'NEXT_MONTH') {
      const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 2, 1);
      where.appointments = { some: { scheduledDate: { gte: start, lt: end } } };
    }

    const total = await prisma.customer.count({ where });
    const customers = await prisma.customer.findMany({
      where,
      include: {
        address: true,
        appointments: { include: { task: true }, orderBy: { scheduledDate: 'desc' } }
      },
      skip: (parseInt(page) - 1) * safeLimit,
      take: safeLimit,
      orderBy: { createdAt: 'desc' }
    });

    const enriched = enrichWithSchedule(customers, now);
    res.json({ success: true, data: enriched, meta: { total, page: parseInt(page), limit: safeLimit } });
  } catch (e) { next(e); }
});

export default router;
