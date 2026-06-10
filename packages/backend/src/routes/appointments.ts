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
  };
}

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const { status, from, to, urgent } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (from || to) where.scheduledDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
    if (urgent === 'true') where.isUrgent = true;
    if (urgent === 'false') where.isUrgent = false;

    // Scheduling department only sees appointments visible to them
    if (req.user!.role === 'SCHEDULING') {
      where.visibleToScheduling = true;
    }

    const appts = await prisma.appointment.findMany({
      where,
      include: {
        customer: { include: { address: true } },
        task: { include: { technician: true } },
        urgentVisitRecord: true,
      },
      orderBy: { scheduledDate: 'desc' },
    });
    res.json({ success: true, data: appts });
  } catch (e) { next(e); }
});

router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { include: { address: true } },
        task: { include: { technician: true } },
        urgentVisitRecord: true,
      },
    });
    if (!appt) return res.status(404).json({ success: false, message: 'Not found' });
    // Scheduling cannot see admin-hidden appointments
    if (req.user!.role === 'SCHEDULING' && !appt.visibleToScheduling) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

router.post('/', requireRole('ADMIN','SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = apptSchema.parse(req.body);
    const isAdmin = req.user!.role === 'ADMIN';
    const isUrgent = isAdmin ? (body.isUrgent ?? false) : false;
    // Scheduling-created appointments are always visible; Admin can hide theirs
    const visibleToScheduling = isAdmin ? (body.visibleToScheduling ?? true) : true;
    // Admin can create hidden appointments (adminApproved=false) e.g. urgent ones pending review
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
        task: { create: { technicianId: body.technicianId ?? null } },
      },
      include: { customer: { include: { address: true } }, task: true },
    });
    if (body.customerId) {
      await prisma.customer.update({ where: { id: body.customerId }, data: { activityDismissed: false } });
    }
    const dateStr = new Date(body.scheduledDate).toLocaleDateString('en-GB');
    const urgentLabel = isUrgent ? ' [URGENT]' : '';
    const customerLabel = appt.customer?.name || 'Urgent Visit';
    await writeAudit({
      action: 'CREATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Appointment${urgentLabel} scheduled for '${customerLabel}' on ${dateStr} (${appt.type}) by ${req.user!.role}`,
      after: apptFields(appt),
    });
    await emitEvent({ type: EVENT_TYPES.APPOINTMENT_CREATED, entityType: 'appointment', entityId: appt.id, userId: req.user!.userId, payload: apptFields(appt) });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_CREATED, appt);
    res.status(201).json({ success: true, data: appt });
  } catch (e) { next(e); }
});

// Admin/Scheduling edits appointment fields
router.put('/:id', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      scheduledDate:      z.string().optional(),
      type:               z.enum(['INSTALLATION','MAINTENANCE']).optional(),
      notes:              z.string().max(2000).optional().nullable(),
      visibleToScheduling:z.boolean().optional(),
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
      include: { customer: { include: { address: true } }, task: true, urgentVisitRecord: true },
    });
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: updated.id, userId: req.user!.userId,
      label: `Appointment for '${existing.customer?.name || 'Urgent Visit'}' updated`,
      after: apptFields(updated),
    });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_STATUS, updated);
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
});

// Admin approves appointment visibility to Scheduling
router.patch('/:id/approve-visibility', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const appt = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { customer: true } });
    if (!appt) return res.status(404).json({ success: false, message: 'Not found' });
    const updated = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { visibleToScheduling: true, adminApproved: true, version: { increment: 1 } },
      include: { customer: { include: { address: true } }, task: true },
    });
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Appointment for '${appt.customer?.name || 'Urgent Visit'}' approved for Scheduling visibility`,
      after: apptFields(updated),
    });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_STATUS, updated);
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
    // Scheduling cannot modify admin-hidden appointments
    if (req.user!.role === 'SCHEDULING' && !before.visibleToScheduling) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (version !== undefined && before.version !== version) return conflict(res, before.version, version);

    const updateData: any = { status: status as any, version: { increment: 1 } };
    if (notes !== undefined) updateData.notes = notes;

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: updateData,
      include: { customer: true, task: true },
    });
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Appointment for '${appt.customer?.name || 'Urgent Visit'}' status changed to ${status} by ${req.user!.role}`,
      before: apptFields(before), after: apptFields(appt),
    });
    const eventType = status === 'CANCELLED' ? EVENT_TYPES.APPOINTMENT_UPDATED : EVENT_TYPES.SCHEDULE_CHANGED;
    await emitEvent({ type: eventType, entityType: 'appointment', entityId: appt.id, userId: req.user!.userId, payload: apptFields(appt) });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_STATUS, appt);
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

export default router;
