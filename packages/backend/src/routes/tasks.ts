import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToAll, emitToRole } from '../socket';
import { SOCKET_EVENTS, SOCKET_ROOMS } from '../constants';

const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const where: any = {};
    if (req.user!.role === 'TECHNICIAN') where.technicianId = req.user!.userId;
    const tasks = await prisma.maintenanceTask.findMany({
      where, include: { technician: true, appointment: { include: { customer: { include: { address: true } } } }, history: { orderBy: { createdAt: 'desc' }, take: 5 } },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: tasks });
  } catch (e) { next(e); }
});

router.patch('/:id/approve', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { technicianId } = z.object({ technicianId: z.string() }).parse(req.body);
    const task = await prisma.maintenanceTask.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', technicianId, history: { create: { status: 'APPROVED', changedById: req.user!.userId } } },
      include: { technician: true, appointment: { include: { customer: true } } }
    });
    const log = await prisma.auditLog.create({
      data: { action: `Maintenance for '${task.appointment.customer.name}' approved and assigned to ${task.technician?.name || 'technician'}`, entityType: 'task', entityId: task.id, userId: req.user!.userId },
      include: { user: { select: { id: true, name: true, role: true } } }
    });
    emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.TASK_APPROVED, task);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.TASK_APPROVED, task);
    emitToAll(SOCKET_EVENTS.AUDIT_NEW, log);
    res.json({ success: true, data: task });
  } catch (e) { next(e); }
});

router.patch('/:id/start', requireRole('TECHNICIAN'), async (req: AuthRequest, res, next) => {
  try {
    const task = await prisma.maintenanceTask.update({
      where: { id: req.params.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date(), history: { create: { status: 'IN_PROGRESS', changedById: req.user!.userId } } },
      include: { technician: true, appointment: { include: { customer: { include: { address: true } } } } }
    });
    await prisma.customer.update({ where: { id: task.appointment.customerId }, data: { activityDismissed: false } });
    const log = await prisma.auditLog.create({
      data: { action: `Technician ${task.technician?.name || ''} started maintenance for '${task.appointment.customer.name}'`, entityType: 'task', entityId: task.id, userId: req.user!.userId },
      include: { user: { select: { id: true, name: true, role: true } } }
    });
    emitToAll(SOCKET_EVENTS.TASK_APPROVED, task);
    emitToAll(SOCKET_EVENTS.AUDIT_NEW, log);
    res.json({ success: true, data: task });
  } catch (e) { next(e); }
});

router.patch('/:id/complete', requireRole('TECHNICIAN'), async (req: AuthRequest, res, next) => {
  try {
    const { notes } = z.object({ notes: z.string().max(2000).optional() }).parse(req.body);
    const task = await prisma.maintenanceTask.update({
      where: { id: req.params.id },
      data: { status: 'COMPLETED', completedAt: new Date(), notes, history: { create: { status: 'COMPLETED', changedById: req.user!.userId, notes } } },
      include: { technician: true, appointment: { include: { customer: true } } }
    });
    await prisma.customer.update({ where: { id: task.appointment.customerId }, data: { activityDismissed: false } });
    const log = await prisma.auditLog.create({
      data: { action: `Maintenance for '${task.appointment.customer.name}' was completed by ${task.technician?.name || 'technician'}`, entityType: 'task', entityId: task.id, userId: req.user!.userId },
      include: { user: { select: { id: true, name: true, role: true } } }
    });
    emitToAll(SOCKET_EVENTS.TASK_COMPLETED, task);
    emitToAll(SOCKET_EVENTS.AUDIT_NEW, log);
    res.json({ success: true, data: task });
  } catch (e) { next(e); }
});

router.patch('/:id/postpone', requireRole('TECHNICIAN'), async (req: AuthRequest, res, next) => {
  try {
    const { reason, newDate } = z.object({ reason: z.string().min(1).max(1000), newDate: z.string().optional() }).parse(req.body);
    const task = await prisma.maintenanceTask.update({
      where: { id: req.params.id },
      data: {
        status: 'POSTPONED',
        history: { create: { status: 'POSTPONED', changedById: req.user!.userId, notes: reason } },
        postponements: { create: { reason, newDate: newDate ? new Date(newDate) : null, requestedById: req.user!.userId } }
      },
      include: { technician: true, appointment: { include: { customer: true } } }
    });
    await prisma.customer.update({ where: { id: task.appointment.customerId }, data: { activityDismissed: false } });
    const log = await prisma.auditLog.create({
      data: { action: `Maintenance for '${task.appointment.customer.name}' was postponed: ${reason}`, entityType: 'task', entityId: task.id, userId: req.user!.userId },
      include: { user: { select: { id: true, name: true, role: true } } }
    });
    emitToAll(SOCKET_EVENTS.TASK_POSTPONED, task);
    emitToAll(SOCKET_EVENTS.AUDIT_NEW, log);
    res.json({ success: true, data: task });
  } catch (e) { next(e); }
});

export default router;