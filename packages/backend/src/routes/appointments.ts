import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToAll } from '../socket';
import { SOCKET_EVENTS } from '../constants';

const router = Router();
router.use(authenticate);

const apptSchema = z.object({
  customerId: z.string(),
  type: z.enum(['INSTALLATION','MAINTENANCE']),
  scheduledDate: z.string().refine(v => !isNaN(Date.parse(v)), { message: 'Invalid date' }),
  notes: z.string().max(1000).optional(),
  technicianId: z.string().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const { status, from, to } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (from || to) where.scheduledDate = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    const appts = await prisma.appointment.findMany({ where, include: { customer: { include: { address: true } }, task: { include: { technician: true } } }, orderBy: { scheduledDate: 'desc' } });
    res.json({ success: true, data: appts });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const appt = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { customer: { include: { address: true } }, task: { include: { technician: true } } } });
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
        task: { create: { technicianId: body.technicianId } }
      },
      include: { customer: { include: { address: true } }, task: true }
    });
    // Reset activityDismissed so customer reappears in activity feed
    await prisma.customer.update({ where: { id: body.customerId }, data: { activityDismissed: false } });
    const dateStr = new Date(body.scheduledDate).toLocaleDateString('en-GB');
    const log = await prisma.auditLog.create({
      data: { action: `Appointment scheduled for '${appt.customer.name}' on ${dateStr} (${appt.type})`, entityType: 'appointment', entityId: appt.id, userId: req.user!.userId },
      include: { user: { select: { id: true, name: true, role: true } } }
    });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_CREATED, appt);
    emitToAll(SOCKET_EVENTS.AUDIT_NEW, log);
    res.status(201).json({ success: true, data: appt });
  } catch (e) { next(e); }
});

router.patch('/:id/status', requireRole('ADMIN','SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(['SCHEDULED','RESCHEDULED','CANCELLED','PENDING']) }).parse(req.body);
    const appt = await prisma.appointment.update({ where: { id: req.params.id }, data: { status: status as any }, include: { customer: true, task: true } });
    const log = await prisma.auditLog.create({
      data: { action: `Appointment for '${appt.customer.name}' status changed to ${status}`, entityType: 'appointment', entityId: appt.id, userId: req.user!.userId },
      include: { user: { select: { id: true, name: true, role: true } } }
    });
    emitToAll(SOCKET_EVENTS.APPOINTMENT_STATUS, appt);
    emitToAll(SOCKET_EVENTS.AUDIT_NEW, log);
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

export default router;