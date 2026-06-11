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

function conflict(res: any, current: number, yours: number) {
  return res.status(409).json({
    success: false,
    error: 'CONFLICT',
    message: 'This record was modified by someone else. Please refresh and try again.',
    currentVersion: current,
    yourVersion: yours,
  });
}

function taskFields(t: any) {
  return {
    id: t.id, status: t.status, technicianId: t.technicianId, notes: t.notes,
    serviceDetails: t.serviceDetails, completionAmount: t.completionAmount,
    completionPaymentMethod: t.completionPaymentMethod,
    version: t.version, startedAt: t.startedAt, completedAt: t.completedAt,
  };
}

router.get('/pending-count', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const count = await prisma.maintenanceTask.count({ where: { status: 'PENDING_APPROVAL' } });
    res.json({ success: true, data: { count } });
  } catch (e) { next(e); }
});

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const where: any = {};
    if (req.user!.role === 'TECHNICIAN') {
      where.technicianId = req.user!.userId;
      where.appointment = { isUrgent: false };
    }
    const tasks = await prisma.maintenanceTask.findMany({
      where,
      include: {
        technician: true,
        appointment: { include: { customer: { include: { address: true } } } },
        history: { orderBy: { createdAt: 'desc' }, take: 5 },
        postponements: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Scheduling must never see financial completion data
    if (req.user!.role === 'SCHEDULING') {
      tasks.forEach((t: any) => {
        delete t.completionAmount;
        delete t.completionPaymentMethod;
      });
    }
    res.json({ success: true, data: tasks });
  } catch (e) { next(e); }
});

router.patch('/:id/approve', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { technicianId, version } = z.object({
      technicianId: z.string().uuid(),
      version: z.number().int().optional(),
    }).parse(req.body);

    // Validate technician exists and has TECHNICIAN role
    const technician = await prisma.user.findFirst({ where: { id: technicianId, role: 'TECHNICIAN' } });
    if (!technician) return res.status(400).json({ success: false, message: 'Invalid technician' });

    const before = await prisma.maintenanceTask.findUnique({
      where: { id: req.params.id },
      include: { appointment: { include: { customer: true } } },
    });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (version !== undefined && before.version !== version) return conflict(res, before.version, version);
    if (before.status !== 'PENDING_APPROVAL') {
      return res.status(409).json({ success: false, message: 'Task is not pending approval' });
    }

    const task = await prisma.maintenanceTask.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED', technicianId, version: { increment: 1 },
        history: { create: { status: 'APPROVED', changedById: req.user!.userId } },
      },
      include: { technician: true, appointment: { include: { customer: true } } },
    });

    const custNameAppr = task.appointment.customer?.name || 'Urgent Visit';
    const custNameApprAr = task.appointment.customer?.name || 'زيارة عاجلة';
    const techNameAppr = task.technician?.name || 'technician';
    await writeAudit({
      action: 'UPDATE', entityType: 'task', entityId: task.id, userId: req.user!.userId,
      label: `Maintenance for '${custNameAppr}' approved and assigned to ${techNameAppr}`,
      labelAr: `تمت الموافقة على صيانة '${custNameApprAr}' وتعيينها للفني ${techNameAppr}`,
      before: taskFields(before), after: taskFields(task),
    });
    await emitEvent({ type: EVENT_TYPES.TASK_APPROVED, entityType: 'task', entityId: task.id, userId: req.user!.userId, payload: taskFields(task) });
    emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.TASK_APPROVED, task);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.TASK_APPROVED, task);
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.TASK_APPROVED, task);
    res.json({ success: true, data: task });
  } catch (e) { next(e); }
});

router.patch('/:id/start', requireRole('TECHNICIAN', 'ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { version } = z.object({ version: z.number().int().optional() }).parse(req.body);
    const isAdmin = req.user!.role === 'ADMIN';

    const before = await prisma.maintenanceTask.findUnique({
      where: { id: req.params.id },
      include: { appointment: { include: { customer: true } } },
    });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (version !== undefined && before.version !== version) return conflict(res, before.version, version);
    if (!isAdmin && before.technicianId !== req.user!.userId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (before.status !== 'APPROVED') {
      return res.status(409).json({ success: false, message: 'Task must be APPROVED before it can be started' });
    }

    const task = await prisma.maintenanceTask.update({
      where: { id: req.params.id },
      data: {
        status: 'IN_PROGRESS', startedAt: new Date(), version: { increment: 1 },
        history: { create: { status: 'IN_PROGRESS', changedById: req.user!.userId } },
      },
      include: { technician: true, appointment: { include: { customer: { include: { address: true } } } } },
    });
    if (task.appointment.customerId) {
      await prisma.customer.update({ where: { id: task.appointment.customerId }, data: { activityDismissed: false } });
    }

    const actorLabel = isAdmin
      ? `Administration (on behalf of technician ${task.technician?.name || ''})`
      : `Technician ${task.technician?.name || ''}`;
    const actorLabelAr = isAdmin
      ? `الإدارة (نيابةً عن الفني ${task.technician?.name || ''})`
      : `الفني ${task.technician?.name || ''}`;
    const custNameStart = task.appointment.customer?.name || 'Urgent Visit';
    const custNameStartAr = task.appointment.customer?.name || 'زيارة عاجلة';
    await writeAudit({
      action: 'UPDATE', entityType: 'task', entityId: task.id, userId: req.user!.userId,
      label: `${actorLabel} started maintenance for '${custNameStart}'`,
      labelAr: `بدأ ${actorLabelAr} صيانة '${custNameStartAr}'`,
      before: taskFields(before), after: taskFields(task),
    });
    await emitEvent({ type: EVENT_TYPES.TASK_STARTED, entityType: 'task', entityId: task.id, userId: req.user!.userId, payload: taskFields(task) });
    emitToAll(SOCKET_EVENTS.TASK_APPROVED, task);
    res.json({ success: true, data: task });
  } catch (e) { next(e); }
});

router.patch('/:id/complete', requireRole('TECHNICIAN', 'ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      notes: z.string().max(2000).optional(),
      serviceDetails: z.string().max(2000).optional(),
      completionAmount: z.number().optional(),
      completionPaymentMethod: z.enum(['CASH','BANK_TRANSFER']).optional(),
      version: z.number().int().optional(),
    }).parse(req.body);
    const isAdmin = req.user!.role === 'ADMIN';

    // Technicians must provide all completion fields
    if (!isAdmin) {
      if (!body.notes?.trim()) return res.status(400).json({ success: false, message: 'Completion notes are required' });
      if (!body.serviceDetails?.trim()) return res.status(400).json({ success: false, message: 'Service details are required' });
      if (body.completionAmount == null || body.completionAmount < 0) return res.status(400).json({ success: false, message: 'Amount is required' });
      if (!body.completionPaymentMethod) return res.status(400).json({ success: false, message: 'Payment method is required' });
    }

    const before = await prisma.maintenanceTask.findUnique({
      where: { id: req.params.id },
      include: { appointment: { include: { customer: true } } },
    });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (body.version !== undefined && before.version !== body.version) return conflict(res, before.version, body.version);
    if (!isAdmin && before.technicianId !== req.user!.userId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (before.status !== 'IN_PROGRESS') {
      return res.status(409).json({ success: false, message: 'Task must be IN_PROGRESS before it can be completed' });
    }

    const task = await prisma.maintenanceTask.update({
      where: { id: req.params.id },
      data: {
        status: 'COMPLETED', completedAt: new Date(),
        notes: body.notes,
        serviceDetails: body.serviceDetails,
        completionAmount: body.completionAmount,
        completionPaymentMethod: body.completionPaymentMethod,
        version: { increment: 1 },
        history: { create: { status: 'COMPLETED', changedById: req.user!.userId, notes: body.notes } },
      },
      include: { technician: true, appointment: { include: { customer: true } } },
    });
    if (task.appointment.customerId) {
      await prisma.customer.update({ where: { id: task.appointment.customerId }, data: { activityDismissed: false } });
    }

    const actorLabelComp = isAdmin
      ? `Administration (on behalf of technician ${task.technician?.name || ''})`
      : `Technician ${task.technician?.name || ''}`;
    const actorLabelCompAr = isAdmin
      ? `الإدارة (نيابةً عن الفني ${task.technician?.name || ''})`
      : `الفني ${task.technician?.name || ''}`;
    const custNameComp = task.appointment.customer?.name || 'Urgent Visit';
    const custNameCompAr = task.appointment.customer?.name || 'زيارة عاجلة';
    await writeAudit({
      action: 'UPDATE', entityType: 'task', entityId: task.id, userId: req.user!.userId,
      label: `Maintenance for '${custNameComp}' was completed by ${actorLabelComp}`,
      labelAr: `تم إكمال صيانة '${custNameCompAr}' بواسطة ${actorLabelCompAr}`,
      before: taskFields(before), after: taskFields(task),
    });
    await emitEvent({ type: EVENT_TYPES.TASK_COMPLETED, entityType: 'task', entityId: task.id, userId: req.user!.userId, payload: taskFields(task) });
    // Admin receives full task with financial data; other roles receive a sanitized version
    const taskSanitized = { ...task, completionAmount: undefined, completionPaymentMethod: undefined };
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.TASK_COMPLETED, task);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.TASK_COMPLETED, taskSanitized);
    emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.TASK_COMPLETED, taskSanitized);
    res.json({ success: true, data: task });
  } catch (e) { next(e); }
});

router.patch('/:id/postpone', requireRole('TECHNICIAN', 'ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { reason, newDate, version } = z.object({
      reason: z.string().min(1).max(1000),
      newDate: z.string().optional(),
      version: z.number().int().optional(),
    }).parse(req.body);
    const isAdmin = req.user!.role === 'ADMIN';

    const before = await prisma.maintenanceTask.findUnique({
      where: { id: req.params.id },
      include: { appointment: { include: { customer: true } } },
    });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (version !== undefined && before.version !== version) return conflict(res, before.version, version);
    if (!isAdmin && before.technicianId !== req.user!.userId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (before.status !== 'APPROVED' && before.status !== 'IN_PROGRESS') {
      return res.status(409).json({ success: false, message: 'Task cannot be postponed in its current state' });
    }

    const task = await prisma.maintenanceTask.update({
      where: { id: req.params.id },
      data: {
        status: 'POSTPONED', version: { increment: 1 },
        history: { create: { status: 'POSTPONED', changedById: req.user!.userId, notes: reason } },
        postponements: { create: { reason, newDate: newDate ? new Date(newDate) : null, requestedById: req.user!.userId } },
      },
      include: { technician: true, appointment: { include: { customer: true } } },
    });
    if (task.appointment.customerId) {
      await prisma.customer.update({ where: { id: task.appointment.customerId }, data: { activityDismissed: false } });
    }

    const actorLabelPost = isAdmin
      ? `Administration (on behalf of technician ${task.technician?.name || ''})`
      : task.technician?.name || 'technician';
    const actorLabelPostAr = isAdmin
      ? `الإدارة (نيابةً عن الفني ${task.technician?.name || ''})`
      : (task.technician?.name || 'الفني');
    const custNamePost = task.appointment.customer?.name || 'Urgent Visit';
    const custNamePostAr = task.appointment.customer?.name || 'زيارة عاجلة';
    await writeAudit({
      action: 'UPDATE', entityType: 'task', entityId: task.id, userId: req.user!.userId,
      label: `Maintenance for '${custNamePost}' was postponed by ${actorLabelPost}: ${reason}`,
      labelAr: `تم تأجيل صيانة '${custNamePostAr}' بواسطة ${actorLabelPostAr}: ${reason}`,
      before: taskFields(before), after: taskFields(task),
    });
    await emitEvent({ type: EVENT_TYPES.TASK_POSTPONED, entityType: 'task', entityId: task.id, userId: req.user!.userId, payload: taskFields(task) });
    emitToAll(SOCKET_EVENTS.TASK_POSTPONED, task);
    res.json({ success: true, data: task });
  } catch (e) { next(e); }
});

export default router;
