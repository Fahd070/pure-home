import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

function computeMaintenanceStatus(appts: any[], now: Date): string {
  if (!appts || appts.length === 0) return 'NO_APPOINTMENTS';
  const sorted = [...appts].sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());
  const latest = sorted[0];
  const taskStatus: string | undefined = latest?.task?.status;
  if (taskStatus === 'COMPLETED') return 'COMPLETED';
  if (taskStatus === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (taskStatus === 'POSTPONED') return 'POSTPONED';
  if (latest?.status === 'CANCELLED') return 'CANCELLED';
  if (new Date(latest.scheduledDate) < now && latest.status !== 'CANCELLED') return 'OVERDUE';
  if (new Date(latest.scheduledDate) >= now) return 'SCHEDULED';
  return 'SCHEDULED';
}

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
    const nextMaintenanceDate = nextMaintenance;
    const daysUntil = nextMaintenance
      ? Math.ceil((new Date(nextMaintenance).getTime() - now.getTime()) / 86400000)
      : null;
    let alertLevel = 'ok';
    if (overdue.length > 0) alertLevel = 'overdue';
    else if (daysUntil !== null && daysUntil <= 10) alertLevel = 'soon';

    const maintenanceStatus = computeMaintenanceStatus(appts, now);

    // Sum all completion amounts from tasks and urgent visit records
    const totalAmount = appts.reduce((sum: number, a: any) => {
      if (a.task?.completionAmount) sum += Number(a.task.completionAmount);
      if (a.urgentVisitRecord?.amount) sum += Number(a.urgentVisitRecord.amount);
      return sum;
    }, 0);

    return {
      id: c.id, name: c.name, phone: c.phone, notes: c.notes,
      isActive: c.isActive, createdAt: c.createdAt,
      installationDate: c.installationDate || null,
      maintenanceCycle: c.maintenanceCycle, maintenanceFrequency: c.maintenanceFrequency,
      address: c.address, lastMaintenance, nextMaintenance, nextMaintenanceDate,
      daysUntil, alertLevel, overdueCount: overdue.length,
      maintenanceStatus, totalAmount,
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

    // Status filter — 'ALL' fetches everything with no appointment condition
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
    } else if (status === 'SCHEDULED') {
      where.appointments = {
        some: { scheduledDate: { gte: now }, status: { not: 'CANCELLED' }, task: { status: { in: ['PENDING_APPROVAL','APPROVED'] } } }
      };
    } else if (status === 'IN_PROGRESS') {
      where.appointments = { some: { task: { status: 'IN_PROGRESS' } } };
    } else if (status === 'CANCELLED') {
      where.appointments = { some: { status: 'CANCELLED' } };
    }
    // status === 'ALL' → no appointment filter, returns every customer

    const total = await prisma.customer.count({ where });
    const customers = await prisma.customer.findMany({
      where,
      include: {
        address: true,
        appointments: { include: { task: true, urgentVisitRecord: true }, orderBy: { scheduledDate: 'desc' } }
      },
      skip: (parseInt(page) - 1) * safeLimit,
      take: safeLimit,
      orderBy: { createdAt: 'desc' }
    });

    const enriched = enrichWithSchedule(customers, now);
    // Scheduling must not see financial data
    const safe = req.user!.role === 'SCHEDULING'
      ? enriched.map((c: any) => { const { totalAmount, ...rest } = c; return rest; })
      : enriched;
    res.json({ success: true, data: safe, meta: { total, page: parseInt(page), limit: safeLimit } });
  } catch (e) { next(e); }
});

// Sales report: completed tasks + urgent visits for a date range
router.get('/sales', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { from, to } = req.query as any;
    if (!from || !to) return res.status(400).json({ success: false, message: 'from and to dates are required' });

    const fromDate = new Date(from);
    const toDate = new Date(to + 'T23:59:59');

    // Regular appointments with completed tasks in the date range
    const appointments = await prisma.appointment.findMany({
      where: {
        scheduledDate: { gte: fromDate, lte: toDate },
        isUrgent: false,
        task: { status: 'COMPLETED', completionAmount: { not: null } },
      },
      include: {
        customer: true,
        task: { include: { technician: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    });

    // Urgent visit records in the date range
    const urgentVisits = await prisma.urgentVisitRecord.findMany({
      where: {
        createdAt: { gte: fromDate, lte: toDate },
        amount: { not: null },
      },
      include: {
        appointment: true,
        submittedBy: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const regularRows = appointments.map(a => ({
      kind: 'regular',
      customerName: a.customer?.name || '—',
      customerPhone: a.customer?.phone || '—',
      appointmentType: a.type,
      date: a.scheduledDate,
      technicianName: a.task?.technician?.name || '—',
      paymentMethod: a.task?.completionPaymentMethod || '—',
      amount: a.task?.completionAmount || 0,
    }));

    const urgentRows = urgentVisits.map(v => ({
      kind: 'urgent',
      customerName: v.customerName || '—',
      customerPhone: v.customerPhone || '—',
      appointmentType: v.serviceType || 'MAINTENANCE',
      date: v.createdAt,
      technicianName: v.submittedBy?.name || '—',
      paymentMethod: v.paymentMethod,
      amount: v.amount || 0,
    }));

    const allRows = [...regularRows, ...urgentRows].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const totalAmount = allRows.reduce((s, r) => s + Number(r.amount), 0);

    res.json({ success: true, data: allRows, meta: { total: allRows.length, totalAmount } });
  } catch (e) { next(e); }
});

export default router;
