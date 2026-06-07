import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToAll } from '../socket';
import { SOCKET_EVENTS } from '../constants';
import { writeAudit } from '../services/audit.service';
import { emitEvent, EVENT_TYPES } from '../services/event.service';

const router = Router();
router.use(authenticate);

const apptSchema = z.object({
  customerId: z.string(),
  type: z.enum(['INSTALLATION','MAINTENANCE']),
  scheduledDate: z.string().refine(v => !isNaN(Date.parse(v)), { message: 'Invalid date' }),
  notes: z.string().max(1000).optional(),
  technicianId: z.string().optional(),
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
  return { id: a.id, type: a.type, status: a.status, scheduledDate: a.scheduledDate, notes: a.notes, version: a.version, customerId: a.customerId };
}

router.get('/', async (req, res, next) => {
  try {
    const { status, from, to } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (from || to) where.scheduledDate = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    const appts = await prisma.appointment.findMany({
      where,
      include: { customer: { include: { address: true } }, task: { include: { technician: true } } },
      orderBy: { scheduledDate: 'desc' },
    });
    res.json({ success: true, data: appts });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: { customer: { include: { address: true } }, task: { include: { technician: true } } },
    });
    if (!appt) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

router.post('/', requireRole('ADMIN','SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = apptSchema.parse(req.body);
    const appt = await prisma.appointment.create({
      data: {
        customerId: body.customerId, type: body.type as any,
        scheduledDate: new Date(body.scheduledDate), notes: body.notes,
        createdById: req.user!.userId,
        task: { create: { technicianId: body.technicianId } },
      },
      include: { customer: { include: { address: true } }, task: true },
    });
    await prisma.customer.update({ where: { id: body.customerId }, data: { activityDismissed: false } });
    const dateStr = new Date(body.scheduledDate).toLocaleDateString('en-GB');
    await writeAudit({
      action: 'CREATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Appointment scheduled for '${appt.customer.name}' on ${dateStr} (${appt.type})`,
      after: apptFields(appt),
    });
    await emitEvent({ type: EVENT_TYPES.APPOINTMENT_CREATED, entityType: 'appointment', entityId: appt.id, userId: req.user!.userId, payload: apptFields(appt) });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_CREATED, appt);
    res.status(201).json({ success: true, data: appt });
  } catch (e) { next(e); }
});

router.patch('/:id/status', requireRole('ADMIN','SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { status, version } = z.object({
      status: z.enum(['SCHEDULED','RESCHEDULED','CANCELLED','PENDING']),
      version: z.number().int().optional(),
    }).parse(req.body);

    const before = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: { customer: true },
    });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (version !== undefined && before.version !== version) return conflict(res, before.version, version);

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { status: status as any, version: { increment: 1 } },
      include: { customer: true, task: true },
    });
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Appointment for '${appt.customer.name}' status changed to ${status}`,
      before: apptFields(before), after: apptFields(appt),
    });
    const eventType = status === 'CANCELLED' ? EVENT_TYPES.APPOINTMENT_UPDATED : EVENT_TYPES.SCHEDULE_CHANGED;
    await emitEvent({ type: eventType, entityType: 'appointment', entityId: appt.id, userId: req.user!.userId, payload: apptFields(appt) });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_STATUS, appt);
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

export default router;
