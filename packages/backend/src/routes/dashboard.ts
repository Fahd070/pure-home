import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToRole, emitToRoles } from '../socket';
import { SOCKET_EVENTS, SOCKET_ROOMS } from '../constants';
import { writeAudit } from '../services/audit.service';
import { stripCompletionAmount, stripCompletionAmountFromList, stripCompletionAmountFromCustomers } from '../services/completionPrivacy.service';
import { deleteCustomerWithOperationalCleanup } from '../services/customerDeletion.service';
import { applySchedulingCustomerVisibility } from '../services/schedulingCustomerVisibility.service';

const router = Router();
router.use(authenticate);

// A maintenance appointment belongs in the "scheduled" customer category only
// while it is still a valid, actionable schedule.  Keeping this predicate in
// one place makes the counter and both drill-down lists agree.
const validMaintenanceSchedule: any = {
  type: 'MAINTENANCE',
  isUrgent: false,
  status: { in: ['SCHEDULED', 'RESCHEDULED', 'PENDING'] },
  workStatus: { in: ['WAITING', 'IN_PROGRESS'] },
};

// Same field selections as the canonical delete routes' own customerFields()/apptFields()
// (packages/backend/src/routes/customers.ts, appointments.ts) -- kept local here rather
// than imported so this file's audit snapshot matches theirs without coupling to their
// internals.
function customerAuditFields(c: any) {
  return { id: c.id, name: c.name, phone: c.phone, maintenanceCycle: c.maintenanceCycle, maintenanceFrequency: c.maintenanceFrequency, isActive: c.isActive, notes: c.notes, version: c.version };
}
function appointmentAuditFields(a: any) {
  return {
    id: a.id, type: a.type, status: a.status, scheduledDate: a.scheduledDate,
    notes: a.notes, version: a.version, customerId: a.customerId,
    isUrgent: a.isUrgent, adminApproved: a.adminApproved,
    visibleToScheduling: a.visibleToScheduling, createdByRole: a.createdByRole,
    technicianId: a.technicianId, workStatus: a.workStatus,
  };
}

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

    const [total, scheduled, completed, thisMonth, nextMonth, pending, pendingApproval, todayCount, urgentCount] = await Promise.all([
      // This is intentionally the complement of `scheduled`: a customer can
      // appear in exactly one of these two scheduling-status categories.
      prisma.customer.count({ where: req.user!.role === 'SCHEDULING'
        ? applySchedulingCustomerVisibility({ appointments: { none: validMaintenanceSchedule } })
        : { appointments: { none: validMaintenanceSchedule } } }),
      prisma.customer.count({ where: { appointments: { some: validMaintenanceSchedule } } }),
      // customerId: not null -- matches this counter's own drill-down (GET
      // /completed-maintenance, which is customer-driven and so already
      // naturally excludes an orphaned appointment left behind by an explicit
      // customer deletion). Without this filter the count stayed stale
      // forever for a deleted customer's completed appointment, since that
      // row is deliberately preserved (customerId set to null, not deleted)
      // for its historical/financial data.
      prisma.appointment.count({ where: { workStatus: 'COMPLETED', isUrgent: false, customerId: { not: null } } }),
      prisma.appointment.count({ where: { isUrgent: false, customerId: { not: null }, scheduledDate: { gte: startOfMonth, lt: startOfNextMonth } } }),
      prisma.appointment.count({ where: { isUrgent: false, customerId: { not: null }, scheduledDate: { gte: startOfNextMonth, lte: endOfNextMonth } } }),
      // Same reasoning as `completed` above -- matches GET /postponed's own
      // customer-driven drill-down.
      prisma.appointment.count({ where: { workStatus: 'POSTPONED', isUrgent: false, customerId: { not: null } } }),
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

    res.json({ success: true, data: { total, scheduled, completed, thisMonth, nextMonth, pending, pendingApproval, todayCount, urgentCount } });
  } catch (e) { next(e); }
});

router.get('/activity', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const customers = await prisma.customer.findMany({
      where: req.user!.role === 'SCHEDULING'
        ? applySchedulingCustomerVisibility({ isActive: true, activityDismissed: false })
        : { isActive: true, activityDismissed: false },
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

router.get('/customers-list', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    // The customer list is the "needs scheduling" category.  A customer with
    // a valid maintenance schedule is represented by /scheduled instead.
    let where: any = { appointments: { none: validMaintenanceSchedule } };
    if (req.user!.role === 'SCHEDULING') where = applySchedulingCustomerVisibility(where);
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

router.get('/scheduled', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    let where: any = { appointments: { some: validMaintenanceSchedule } };
    if (req.user!.role === 'SCHEDULING') where = applySchedulingCustomerVisibility(where);
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
    const total = await prisma.customer.count({ where });
    let data: any[] = await prisma.customer.findMany({
      where,
      include: {
        address: true,
        appointments: { where: validMaintenanceSchedule, orderBy: { scheduledDate: 'asc' }, take: 1 },
      },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { updatedAt: 'desc' },
    });
    if (req.user!.role === 'SCHEDULING') data = stripCompletionAmountFromCustomers(data);
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/completed-maintenance', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const where: any = { appointments: { some: { workStatus: 'COMPLETED' } } };
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
    const total = await prisma.customer.count({ where });
    let data: any[] = await prisma.customer.findMany({
      where, include: {
        address: true,
        appointments: { where: { workStatus: 'COMPLETED' }, orderBy: { scheduledDate: 'desc' }, take: 5 }
      },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { updatedAt: 'desc' }
    });
    // Modification #6: completionAmount is private to ADMIN/TECHNICIAN -- these are
    // completed appointments, so the amount is populated here more than anywhere else.
    if (req.user!.role === 'SCHEDULING') data = stripCompletionAmountFromCustomers(data);
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/this-month', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const where: any = { isUrgent: false, customerId: { not: null }, scheduledDate: { gte: start, lt: end } };
    if (search) where.customer = { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] };
    const total = await prisma.appointment.count({ where });
    let data: any[] = await prisma.appointment.findMany({
      where, include: { customer: { include: { address: true } } },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'asc' }
    });
    // Modification #6: completionAmount is private to ADMIN/TECHNICIAN -- this
    // range can include an appointment already completed earlier this month.
    if (req.user!.role === 'SCHEDULING') data = stripCompletionAmountFromList(data);
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/next-month', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
    const where: any = { isUrgent: false, customerId: { not: null }, scheduledDate: { gte: start, lte: end } };
    if (search) where.customer = { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] };
    const total = await prisma.appointment.count({ where });
    let data: any[] = await prisma.appointment.findMany({
      where, include: { customer: { include: { address: true } } },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'asc' }
    });
    // Modification #6: completionAmount is private to ADMIN/TECHNICIAN.
    if (req.user!.role === 'SCHEDULING') data = stripCompletionAmountFromList(data);
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/postponed', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const where: any = { appointments: { some: { workStatus: 'POSTPONED' } } };
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
    const total = await prisma.customer.count({ where });
    let data: any[] = await prisma.customer.findMany({
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
    // Modification #6: completionAmount is private to ADMIN/TECHNICIAN.
    if (req.user!.role === 'SCHEDULING') data = stripCompletionAmountFromCustomers(data);
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/overdue', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
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
    let data: any[] = await prisma.appointment.findMany({
      where, include: { customer: { include: { address: true } } },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'asc' }
    });
    // Modification #6: completionAmount is private to ADMIN/TECHNICIAN.
    if (req.user!.role === 'SCHEDULING') data = stripCompletionAmountFromList(data);
    res.json({ success: true, data, meta: { total } });
  } catch (e) { next(e); }
});

router.get('/today', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
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
    let data: any[] = await prisma.appointment.findMany({
      where, include: { customer: { include: { address: true } } },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'asc' }
    });
    // Modification #6: completionAmount is private to ADMIN/TECHNICIAN.
    if (req.user!.role === 'SCHEDULING') data = stripCompletionAmountFromList(data);
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
    // Same shared cleanup as DELETE /api/customers/:id -- see
    // services/customerDeletion.service.ts. This route is a genuinely
    // separate, live call site (the Admin Dashboard drill-down's delete
    // button), which is exactly why it must use the same shared function
    // rather than its own copy of the business rule.
    const result = await deleteCustomerWithOperationalCleanup(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'Not found' });
    const { customer, operationalAppointmentIds: apptIds } = result;
    await writeAudit({
      action: 'DELETE', entityType: 'customer', entityId: req.params.id, userId: req.user!.userId,
      label: `Customer '${customer.name}' was deleted`,
      labelAr: `تم حذف العميل '${customer.name}'`,
      before: customerAuditFields(customer),
    });
    emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.CUSTOMER_DELETED, { id: req.params.id });
    if (apptIds.length > 0) {
      emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.APPOINTMENT_DELETED, { ids: apptIds, customerId: req.params.id });
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.delete('/appointment/:id', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const appt = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { customer: true } });
    if (!appt) return res.status(404).json({ success: false, message: 'Not found' });
    await prisma.appointment.delete({ where: { id: req.params.id } });
    const custName = appt.customer?.name || 'Urgent Visit';
    const custNameAr = appt.customer?.name || 'زيارة عاجلة';
    await writeAudit({
      action: 'DELETE', entityType: 'appointment', entityId: req.params.id, userId: req.user!.userId,
      label: `Appointment for '${custName}' was deleted by Admin`,
      labelAr: `تم حذف موعد العميل '${custNameAr}' بواسطة الإدارة`,
      before: appointmentAuditFields(appt),
    });
    emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.APPOINTMENT_DELETED, { ids: [req.params.id] });
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
    // No technician subscriber for this event name -- confirmed via frontend audit.
    // Modification #6: strip completionAmount before it reaches the SCHEDULING
    // room/response -- this route is SCHEDULING-callable and can target an
    // already-completed appointment (e.g. editing its notes afterward).
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_STATUS, appt);
    const schedSafeAppt = stripCompletionAmount(appt);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_STATUS, schedSafeAppt);
    const out = req.user!.role === 'SCHEDULING' ? schedSafeAppt : appt;
    res.json({ success: true, data: out });
  } catch (e) { next(e); }
});

export default router;
