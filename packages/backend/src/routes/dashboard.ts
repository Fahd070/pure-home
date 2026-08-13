import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToRole, emitToRoles } from '../socket';
import { SOCKET_EVENTS, SOCKET_ROOMS } from '../constants';
import { writeAudit } from '../services/audit.service';
import { stripCompletionAmount, stripCompletionAmountFromList } from '../services/completionPrivacy.service';
import { deleteCustomerWithOperationalCleanup } from '../services/customerDeletion.service';
import { applySchedulingCustomerVisibility } from '../services/schedulingCustomerVisibility.service';
import { DashboardOperationalCategory, getDashboardCategoryWheres } from '../services/dashboardCategorization.service';

const router = Router();
router.use(authenticate);

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
    const categories = getDashboardCategoryWheres(now);

    const urgentWhere: any = { isUrgent: true };
    if (req.user?.role === 'SCHEDULING') urgentWhere.visibleToScheduling = true;

    const customerWhere = req.user!.role === 'SCHEDULING' ? applySchedulingCustomerVisibility({}) : {};
    const [total, completed, thisMonth, nextMonth, pending, pendingApproval, todayCount, urgentCount] = await Promise.all([
      prisma.customer.count({ where: customerWhere }),
      prisma.appointment.count({ where: categories.completed }),
      prisma.appointment.count({ where: categories.thisMonth }),
      prisma.appointment.count({ where: categories.nextMonth }),
      prisma.appointment.count({ where: categories.postponed }),
      prisma.appointment.count({ where: categories.overdue }),
      prisma.appointment.count({ where: categories.today }),
      prisma.appointment.count({ where: urgentWhere }),
    ]);

    res.json({ success: true, data: { total, completed, thisMonth, nextMonth, pending, pendingApproval, todayCount, urgentCount } });
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
    let where: any = {};
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

function registerOperationalCategoryRoute(path: string, category: DashboardOperationalCategory) {
  router.get(path, requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
    try {
      const { search = '', page = '1', limit = '20' } = req.query as any;
      const safeLimit = Math.min(parseInt(limit) || 20, 100);
      const where: any = { ...getDashboardCategoryWheres()[category] };
      if (search) where.customer = { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] };
      const total = await prisma.appointment.count({ where });
      let data: any[] = await prisma.appointment.findMany({
        where,
        include: { customer: { include: { address: true } } },
        skip: (parseInt(page) - 1) * safeLimit,
        take: safeLimit,
        orderBy: { scheduledDate: category === 'completed' || category === 'postponed' ? 'desc' : 'asc' },
      });
      if (req.user!.role === 'SCHEDULING') data = stripCompletionAmountFromList(data);
      res.json({ success: true, data, meta: { total } });
    } catch (e) { next(e); }
  });
}

registerOperationalCategoryRoute('/completed-maintenance', 'completed');
registerOperationalCategoryRoute('/this-month', 'thisMonth');
registerOperationalCategoryRoute('/next-month', 'nextMonth');
registerOperationalCategoryRoute('/postponed', 'postponed');
registerOperationalCategoryRoute('/overdue', 'overdue');
registerOperationalCategoryRoute('/today', 'today');

router.get('/urgent', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { page = '1', limit = '20' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const where: any = { isUrgent: true };
    if (req.user?.role === 'SCHEDULING') where.visibleToScheduling = true;
    const total = await prisma.appointment.count({ where });
    let data: any[] = await prisma.appointment.findMany({
      where,
      include: { technician: true, customer: { include: { address: true } } },
      skip: (parseInt(page) - 1) * safeLimit, take: safeLimit,
      orderBy: { scheduledDate: 'desc' }
    });
    if (req.user!.role === 'SCHEDULING') data = stripCompletionAmountFromList(data);
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
