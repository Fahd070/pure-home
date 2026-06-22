import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToAll, emitToRole } from '../socket';
import { SOCKET_EVENTS, SOCKET_ROOMS } from '../constants';
import { writeAudit } from '../services/audit.service';
import { emitEvent, EVENT_TYPES } from '../services/event.service';

const router = Router();
router.use(authenticate);

const apptSchema = z.object({
  customerId: z.string().optional(),
  type: z.enum(['INSTALLATION','MAINTENANCE']),
  scheduledDate: z.string().refine(v => !isNaN(Date.parse(v)), { message: 'Invalid date' }),
  notes: z.string().max(1000).optional(),
  technicianId: z.string().optional(),
  isUrgent: z.boolean().optional(),
  visibleToScheduling: z.boolean().optional(),
  urgentLocation: z.string().max(2000).optional(),
});

function conflict(res: any, current: number, yours: number) {
  return res.status(409).json({
    success: false,
    error: 'CONFLICT',
    message: 'This record was modified by someone else. Please refresh and try again.',
    currentVersion: current,
    yourVersion: yours,
  });
}

function apptFields(a: any) {
  return {
    id: a.id, type: a.type, status: a.status, scheduledDate: a.scheduledDate,
    notes: a.notes, version: a.version, customerId: a.customerId,
    isUrgent: a.isUrgent, adminApproved: a.adminApproved,
    visibleToScheduling: a.visibleToScheduling, createdByRole: a.createdByRole,
    technicianId: a.technicianId, workStatus: a.workStatus,
  };
}

const WORK_INCLUDE = {
  customer: { include: { address: true } },
  technician: true,
  postponements: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  urgentVisitRecord: true,
};

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const { status, workStatus: workStatusFilter, from, to, urgent } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (from || to) where.scheduledDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
    if (urgent === 'true') where.isUrgent = true;
    if (urgent === 'false') where.isUrgent = false;

    if (workStatusFilter) {
      const statuses = String(workStatusFilter).split(',').map((s: string) => s.trim()).filter(Boolean);
      if (statuses.length === 1) where.workStatus = statuses[0];
      else if (statuses.length > 1) where.workStatus = { in: statuses };
    }

    if (req.user!.role === 'SCHEDULING') {
      where.visibleToScheduling = true;
    }
    if (req.user!.role === 'TECHNICIAN') {
      where.isUrgent = false;
      where.OR = [
        { technicianId: req.user!.userId },
        { technicianId: null },
      ];
    }

    const appts = await prisma.appointment.findMany({
      where,
      include: WORK_INCLUDE,
      orderBy: { scheduledDate: 'desc' },
    });

    if (req.user!.role === 'SCHEDULING') {
      appts.forEach((a: any) => {
        delete a.completionAmount; delete a.completionPaymentMethod;
        if (a.urgentVisitRecord) { delete a.urgentVisitRecord.amount; delete a.urgentVisitRecord.paymentMethod; }
      });
    } else if (req.user!.role === 'TECHNICIAN') {
      appts.forEach((a: any) => {
        if (a.technicianId !== req.user!.userId) {
          delete a.completionAmount; delete a.completionPaymentMethod;
        }
        delete a.completionImage;
      });
    }

    res.json({ success: true, data: appts });
  } catch (e) { next(e); }
});

router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const where: any = { id: req.params.id };
    if (req.user!.role === 'SCHEDULING') {
      where.visibleToScheduling = true;
    }
    if (req.user!.role === 'TECHNICIAN') {
      where.isUrgent = false;
      where.OR = [
        { technicianId: req.user!.userId },
        { technicianId: null },
      ];
    }
    const appt = await prisma.appointment.findFirst({
      where,
      include: WORK_INCLUDE,
    });
    if (!appt) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

router.post('/', requireRole('ADMIN','SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = apptSchema.parse(req.body);
    const isAdmin = req.user!.role === 'ADMIN';
    const isUrgent = isAdmin ? (body.isUrgent ?? false) : false;
    const visibleToScheduling = isAdmin ? (body.visibleToScheduling ?? true) : true;
    const adminApproved = isAdmin ? (visibleToScheduling ? true : false) : false;

    if (!isUrgent && !body.customerId) {
      return res.status(400).json({ success: false, message: 'customerId is required for non-urgent appointments' });
    }

    const appt = await prisma.appointment.create({
      data: {
        customerId: body.customerId || null,
        type: body.type as any,
        scheduledDate: new Date(body.scheduledDate),
        notes: body.notes,
        urgentLocation: body.urgentLocation || null,
        isUrgent,
        visibleToScheduling,
        adminApproved,
        createdByRole: req.user!.role,
        createdById: req.user!.userId,
        technicianId: body.technicianId ?? null,
        workStatus: 'WAITING',
      },
      include: { customer: { include: { address: true } }, technician: true },
    });
    if (body.customerId) {
      await prisma.customer.update({ where: { id: body.customerId }, data: { activityDismissed: false } });
    }
    const dateStr = new Date(body.scheduledDate).toLocaleDateString('en-GB');
    const urgentLabel = isUrgent ? ' [URGENT]' : '';
    const urgentLabelAr = isUrgent ? ' [عاجل]' : '';
    const customerLabel = appt.customer?.name || 'Urgent Visit';
    const customerLabelAr = appt.customer?.name || 'زيارة عاجلة';
    const typeEn = appt.type === 'MAINTENANCE' ? 'Maintenance' : 'Installation';
    const typeAr = appt.type === 'MAINTENANCE' ? 'صيانة' : 'تركيب';
    const roleAr = req.user!.role === 'ADMIN' ? 'الإدارة' : 'قسم الجدولة';
    await writeAudit({
      action: 'CREATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Appointment${urgentLabel} scheduled for '${customerLabel}' on ${dateStr} (${typeEn}) by ${req.user!.role}`,
      labelAr: `تم جدولة موعد${urgentLabelAr} لـ '${customerLabelAr}' بتاريخ ${dateStr} (${typeAr}) بواسطة ${roleAr}`,
      after: apptFields(appt),
    });
    await emitEvent({ type: EVENT_TYPES.APPOINTMENT_CREATED, entityType: 'appointment', entityId: appt.id, userId: req.user!.userId, payload: apptFields(appt) });
    if (isUrgent && !visibleToScheduling) {
      emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_CREATED, appt);
      emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.APPOINTMENT_CREATED, appt);
    } else {
      emitToAll(SOCKET_EVENTS.APPOINTMENT_CREATED, appt);
    }
    res.status(201).json({ success: true, data: appt });
  } catch (e) { next(e); }
});

router.put('/:id', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      scheduledDate:       z.string().optional(),
      type:                z.enum(['INSTALLATION','MAINTENANCE']).optional(),
      notes:               z.string().max(2000).optional().nullable(),
      visibleToScheduling: z.boolean().optional(),
    }).parse(req.body);
    const existing = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { customer: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    const updated = await prisma.appointment.update({
      where: { id: req.params.id },
      data: {
        ...(body.scheduledDate ? { scheduledDate: new Date(body.scheduledDate), status: 'RESCHEDULED' } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.visibleToScheduling !== undefined ? { visibleToScheduling: body.visibleToScheduling } : {}),
        version: { increment: 1 },
      },
      include: { customer: { include: { address: true } }, technician: true, urgentVisitRecord: true },
    });
    const custNameUpd = existing.customer?.name || 'Urgent Visit';
    const custNameUpdAr = existing.customer?.name || 'زيارة عاجلة';
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: updated.id, userId: req.user!.userId,
      label: `Appointment for '${custNameUpd}' updated`,
      labelAr: `تم تحديث موعد العميل '${custNameUpdAr}'`,
      after: apptFields(updated),
    });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_STATUS, updated);
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
});

router.patch('/:id/approve-visibility', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const appt = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { customer: true } });
    if (!appt) return res.status(404).json({ success: false, message: 'Not found' });
    const updated = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { visibleToScheduling: true, adminApproved: true, version: { increment: 1 } },
      include: { customer: { include: { address: true } }, technician: true },
    });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_STATUS, updated);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_CREATED, updated);
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
});

router.patch('/:id/status', requireRole('ADMIN','SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { status, version, notes } = z.object({
      status: z.enum(['SCHEDULED','RESCHEDULED','CANCELLED','PENDING']),
      version: z.number().int().optional(),
      notes: z.string().max(1000).optional(),
    }).parse(req.body);

    const before = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: { customer: true },
    });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (req.user!.role === 'SCHEDULING' && !before.visibleToScheduling) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (version !== undefined && before.version !== version) return conflict(res, before.version, version);

    const updateData: any = { status: status as any, version: { increment: 1 } };
    if (notes !== undefined) updateData.notes = notes;

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: updateData,
      include: { customer: true, technician: true },
    });
    const custNameSt = appt.customer?.name || 'Urgent Visit';
    const custNameStAr = appt.customer?.name || 'زيارة عاجلة';
    const roleStAr = req.user!.role === 'ADMIN' ? 'الإدارة' : 'قسم الجدولة';
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Appointment for '${custNameSt}' status changed to ${status} by ${req.user!.role}`,
      labelAr: `تم تغيير حالة موعد '${custNameStAr}' إلى ${status} بواسطة ${roleStAr}`,
      before: apptFields(before), after: apptFields(appt),
    });
    const eventType = status === 'CANCELLED' ? EVENT_TYPES.APPOINTMENT_UPDATED : EVENT_TYPES.SCHEDULE_CHANGED;
    await emitEvent({ type: eventType, entityType: 'appointment', entityId: appt.id, userId: req.user!.userId, payload: apptFields(appt) });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_STATUS, appt);
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

// Technician starts work on an appointment
router.patch('/:id/start', requireRole('TECHNICIAN', 'ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { version } = z.object({ version: z.number().int().optional() }).parse(req.body);
    const isAdmin = req.user!.role === 'ADMIN';

    const before = await prisma.appointment.findFirst({
      where: {
        id: req.params.id,
        isUrgent: false,
        ...(isAdmin ? {} : { OR: [{ technicianId: req.user!.userId }, { technicianId: null }] }),
      },
      include: { customer: true },
    });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (version !== undefined && before.version !== version) return conflict(res, before.version, version);
    if (before.workStatus !== 'WAITING') {
      return res.status(409).json({ success: false, message: 'Job must be WAITING before it can be started' });
    }

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: {
        workStatus: 'IN_PROGRESS', startedAt: new Date(), version: { increment: 1 },
        ...(before.technicianId === null && !isAdmin ? { technicianId: req.user!.userId } : {}),
      },
      include: { technician: true, customer: { include: { address: true } } },
    });
    if (appt.customerId) {
      await prisma.customer.update({ where: { id: appt.customerId }, data: { activityDismissed: false } });
    }
    const custName = appt.customer?.name || 'Urgent Visit';
    const custNameAr = appt.customer?.name || 'زيارة عاجلة';
    const techName = appt.technician?.name || '';
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Technician ${techName} started work for '${custName}'`,
      labelAr: `بدأ الفني ${techName} العمل لـ '${custNameAr}'`,
      before: apptFields(before), after: apptFields(appt),
    });
    await emitEvent({ type: EVENT_TYPES.APPOINTMENT_STARTED, entityType: 'appointment', entityId: appt.id, userId: req.user!.userId, payload: apptFields(appt) });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_STARTED, appt);
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

// Technician completes work on an appointment
router.patch('/:id/complete', requireRole('TECHNICIAN', 'ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      serviceDetails: z.string().max(2000).optional(),
      completionAmount: z.number().optional(),
      completionPaymentMethod: z.enum(['CASH','BANK_TRANSFER']).optional(),
      completionImage: z.string().max(5_000_000).optional(),
      version: z.number().int().optional(),
    }).parse(req.body);
    const isAdmin = req.user!.role === 'ADMIN';

    if (!isAdmin) {
      if (!body.serviceDetails?.trim()) return res.status(400).json({ success: false, message: 'Service details are required' });
      if (body.completionAmount == null || body.completionAmount < 0) return res.status(400).json({ success: false, message: 'Amount is required' });
      if (!body.completionPaymentMethod) return res.status(400).json({ success: false, message: 'Payment method is required' });
    }

    const before = await prisma.appointment.findFirst({
      where: {
        id: req.params.id,
        isUrgent: false,
        ...(isAdmin ? {} : { OR: [{ technicianId: req.user!.userId }, { technicianId: null }] }),
      },
      include: { customer: true },
    });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (body.version !== undefined && before.version !== body.version) return conflict(res, before.version, body.version);
    if (before.workStatus !== 'IN_PROGRESS') {
      return res.status(409).json({ success: false, message: 'Job must be IN_PROGRESS before it can be completed' });
    }

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: {
        workStatus: 'COMPLETED', completedAt: new Date(),
        serviceDetails: body.serviceDetails,
        completionAmount: body.completionAmount,
        completionPaymentMethod: body.completionPaymentMethod,
        completionImage: body.completionImage ?? null,
        version: { increment: 1 },
      },
      include: { technician: true, customer: true },
    });
    if (appt.customerId) {
      await prisma.customer.update({ where: { id: appt.customerId }, data: { activityDismissed: false } });
    }
    const custName = appt.customer?.name || 'Urgent Visit';
    const custNameAr = appt.customer?.name || 'زيارة عاجلة';
    const techName = isAdmin ? `Administration` : (appt.technician?.name || 'Technician');
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Maintenance for '${custName}' completed by ${techName}`,
      labelAr: `تم إكمال صيانة '${custNameAr}' بواسطة ${techName}`,
      before: apptFields(before), after: apptFields(appt),
    });
    await emitEvent({ type: EVENT_TYPES.APPOINTMENT_COMPLETED, entityType: 'appointment', entityId: appt.id, userId: req.user!.userId, payload: apptFields(appt) });
    const sanitized = { ...appt, completionAmount: undefined, completionPaymentMethod: undefined };
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_COMPLETED, appt);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_COMPLETED, sanitized);
    emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.APPOINTMENT_COMPLETED, sanitized);
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

// Technician postpones work on an appointment
router.patch('/:id/postpone', requireRole('TECHNICIAN', 'ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { reason, newDate, version } = z.object({
      reason: z.string().min(1).max(1000),
      newDate: z.string().optional(),
      version: z.number().int().optional(),
    }).parse(req.body);
    const isAdmin = req.user!.role === 'ADMIN';

    const before = await prisma.appointment.findFirst({
      where: {
        id: req.params.id,
        isUrgent: false,
        ...(isAdmin ? {} : { OR: [{ technicianId: req.user!.userId }, { technicianId: null }] }),
      },
      include: { customer: true },
    });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (version !== undefined && before.version !== version) return conflict(res, before.version, version);
    if (before.workStatus !== 'WAITING' && before.workStatus !== 'IN_PROGRESS') {
      return res.status(409).json({ success: false, message: 'Job cannot be postponed in its current state' });
    }

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: {
        workStatus: 'POSTPONED', version: { increment: 1 },
        postponements: { create: { reason, newDate: newDate ? new Date(newDate) : null, requestedById: req.user!.userId } },
      },
      include: { technician: true, customer: true },
    });
    if (appt.customerId) {
      await prisma.customer.update({ where: { id: appt.customerId }, data: { activityDismissed: false } });
    }
    const custName = appt.customer?.name || 'Urgent Visit';
    const custNameAr = appt.customer?.name || 'زيارة عاجلة';
    const actorName = isAdmin ? 'Administration' : (appt.technician?.name || 'Technician');
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Maintenance for '${custName}' postponed by ${actorName}: ${reason}`,
      labelAr: `تم تأجيل صيانة '${custNameAr}' بواسطة ${actorName}: ${reason}`,
      before: apptFields(before), after: apptFields(appt),
    });
    await emitEvent({ type: EVENT_TYPES.APPOINTMENT_POSTPONED, entityType: 'appointment', entityId: appt.id, userId: req.user!.userId, payload: apptFields(appt) });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_POSTPONED, appt);
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: { customer: true },
    });
    if (!appt) return res.status(404).json({ success: false, message: 'Not found' });
    await prisma.appointment.delete({ where: { id: req.params.id } });
    const custName = appt.customer?.name || 'Urgent Visit';
    const custNameAr = appt.customer?.name || 'زيارة عاجلة';
    await writeAudit({
      action: 'DELETE', entityType: 'appointment', entityId: req.params.id, userId: req.user!.userId,
      label: `Appointment for '${custName}' was deleted by Admin`,
      labelAr: `تم حذف موعد العميل '${custNameAr}' بواسطة الإدارة`,
      before: apptFields(appt),
    });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_DELETED, { id: req.params.id });
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
