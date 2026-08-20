import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { computeNextMaintenanceDate } from '../services/maintenanceSchedule.service';
import { applySchedulingCustomerVisibility } from '../services/schedulingCustomerVisibility.service';

const router = Router();
router.use(authenticate);

function computeMaintenanceStatus(appts: any[], now: Date): string {
  if (!appts || appts.length === 0) return 'NO_APPOINTMENTS';
  const sorted = [...appts].sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());
  const latest = sorted[0];
  const ws: string | undefined = latest?.workStatus;
  if (ws === 'COMPLETED') return 'COMPLETED';
  if (ws === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (ws === 'POSTPONED') return 'POSTPONED';
  if (latest?.status === 'CANCELLED') return 'CANCELLED';
  if (new Date(latest.scheduledDate) < now && latest.status !== 'CANCELLED') return 'OVERDUE';
  if (new Date(latest.scheduledDate) >= now) return 'SCHEDULED';
  return 'SCHEDULED';
}

function enrichWithSchedule(customers: any[], now: Date, apptsByCustomer: Map<string, any[]>, totalAmountByCustomer: Map<string, number>) {
  return customers.map(c => {
    const appts: any[] = apptsByCustomer.get(c.id) || [];
    const completed = appts
      .filter(a => a.workStatus === 'COMPLETED')
      .sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());
    const overdue = appts.filter(a =>
      new Date(a.scheduledDate) < now &&
      a.status !== 'CANCELLED' &&
      a.workStatus !== 'COMPLETED'
    );
    const lastMaintenance = completed[0]?.scheduledDate || null;
    // Source of truth: actualCompletionDate of the most recent completed
    // appointment + recurrence -- same computation as routes/customers.ts's
    // GET / (includeSchedule) and GET /:id. See maintenanceSchedule.service.ts.
    const nextMaintenance = computeNextMaintenanceDate(c, appts);
    const nextMaintenanceDate = nextMaintenance;
    const daysUntil = nextMaintenance
      ? Math.ceil((new Date(nextMaintenance).getTime() - now.getTime()) / 86400000)
      : null;
    let alertLevel = 'ok';
    if (overdue.length > 0) alertLevel = 'overdue';
    else if (daysUntil !== null && daysUntil <= 10) alertLevel = 'soon';

    const maintenanceStatus = computeMaintenanceStatus(appts, now);

    const totalAmount = totalAmountByCustomer.get(c.id) || 0;

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

    let where: any = {};
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
      where.appointments = { some: { workStatus: 'COMPLETED' } };
    } else if (status === 'OVERDUE') {
      where.appointments = {
        some: {
          scheduledDate: { lt: now },
          status: { not: 'CANCELLED' },
          workStatus: { not: 'COMPLETED' }
        }
      };
    } else if (status === 'POSTPONED') {
      where.appointments = { some: { workStatus: 'POSTPONED' } };
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
        some: { scheduledDate: { gte: now }, status: { not: 'CANCELLED' }, workStatus: { in: ['WAITING'] } }
      };
    } else if (status === 'IN_PROGRESS') {
      where.appointments = { some: { workStatus: 'IN_PROGRESS' } };
    } else if (status === 'CANCELLED') {
      where.appointments = { some: { status: 'CANCELLED' } };
    }

    // Object-level authorization: same hidden-customer policy as GET /api/customers
    // and GET /dashboard/customers-list -- Scheduling must never see an admin-private
    // urgent-only customer through this report either.
    if (req.user!.role === 'SCHEDULING') where = applySchedulingCustomerVisibility(where);

    const total = await prisma.customer.count({ where });
    const customers = await prisma.customer.findMany({
      where,
      include: { address: true },
      skip: (parseInt(page) - 1) * safeLimit,
      take: safeLimit,
      orderBy: { createdAt: 'desc' }
    });

    // Perf fix: this previously loaded every appointment (with a nested
    // urgentVisitRecord include) for every returned customer via a Prisma
    // relation `include`, an unbounded load that grew without limit as a
    // customer's history grew. Replaced with two small, page-scoped queries
    // (not one per customer) for exactly the scalar fields enrichWithSchedule
    // needs: one for the date/status fields behind lastMaintenance/
    // nextMaintenance/overdueCount/maintenanceStatus, and one -- skipped
    // entirely for SCHEDULING, whose response never includes totalAmount
    // anyway -- for the completionAmount/urgentVisitRecord.amount figures
    // behind totalAmount. The derived-field math in enrichWithSchedule is
    // byte-for-byte the same as before.
    const customerIds = customers.map((c: any) => c.id);
    const apptRows = customerIds.length
      ? await prisma.appointment.findMany({
          where: { customerId: { in: customerIds } },
          select: { customerId: true, isUrgent: true, workStatus: true, status: true, scheduledDate: true, actualCompletionDate: true, completedAt: true },
        })
      : [];
    const apptsByCustomer = new Map<string, any[]>();
    for (const row of apptRows) {
      const list = apptsByCustomer.get(row.customerId as string);
      if (list) list.push(row); else apptsByCustomer.set(row.customerId as string, [row]);
    }

    const totalAmountByCustomer = new Map<string, number>();
    if (req.user!.role !== 'SCHEDULING' && customerIds.length) {
      const financialRows = await prisma.appointment.findMany({
        where: {
          customerId: { in: customerIds },
          OR: [{ completionAmount: { not: null } }, { urgentVisitRecord: { amount: { not: null } } }],
        },
        select: { customerId: true, completionAmount: true, urgentVisitRecord: { select: { amount: true } } },
      });
      for (const row of financialRows) {
        const key = row.customerId as string;
        const add = (row.completionAmount ? Number(row.completionAmount) : 0) + (row.urgentVisitRecord?.amount ? Number(row.urgentVisitRecord.amount) : 0);
        totalAmountByCustomer.set(key, (totalAmountByCustomer.get(key) || 0) + add);
      }
    }

    const enriched = enrichWithSchedule(customers, now, apptsByCustomer, totalAmountByCustomer);
    const safe = req.user!.role === 'SCHEDULING'
      ? enriched.map((c: any) => { const { totalAmount, ...rest } = c; return rest; })
      : enriched;
    res.json({ success: true, data: safe, meta: { total, page: parseInt(page), limit: safeLimit } });
  } catch (e) { next(e); }
});

router.get('/sales', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { from, to } = req.query as any;
    if (!from || !to) return res.status(400).json({ success: false, message: 'from and to dates are required' });

    const fromDate = new Date(from);
    const toDate = new Date(to + 'T23:59:59');

    const appointments = await prisma.appointment.findMany({
      where: {
        scheduledDate: { gte: fromDate, lte: toDate },
        isUrgent: false,
        workStatus: 'COMPLETED',
        completionAmount: { not: null },
      },
      include: { customer: true, technician: true },
      orderBy: { scheduledDate: 'asc' },
    });

    const urgentVisits = await prisma.urgentVisitRecord.findMany({
      where: {
        createdAt: { gte: fromDate, lte: toDate },
        amount: { not: null },
      },
      include: { appointment: true, submittedBy: true },
      orderBy: { createdAt: 'asc' },
    });

    const regularRows = appointments.map(a => ({
      kind: 'regular',
      customerName: a.customer?.name || '—',
      customerPhone: a.customer?.phone || '—',
      appointmentType: a.type,
      date: a.scheduledDate,
      technicianName: a.technician?.name || '—',
      paymentMethod: a.completionPaymentMethod || '—',
      amount: a.completionAmount || 0,
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
