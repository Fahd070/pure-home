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

const addressSchema = z.object({
  city: z.string().max(100), district: z.string().max(100), street: z.string().max(200),
  postalCode: z.string().max(20).optional(), buildingNo: z.string().max(20).optional(),
  floorNo: z.string().max(20).optional(), apartmentNo: z.string().max(20).optional(),
});
const customerSchema = z.object({
  name: z.string().min(1).max(200), phone: z.string().regex(/^05\d{8}$/),
  maintenanceCycle: z.enum(['DAILY','WEEKLY','MONTHLY']),
  maintenanceFrequency: z.number().int().positive().max(365).default(1),
  notes: z.string().max(2000).optional(),
  installationDate: z.string().optional(),
  address: addressSchema,
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

function customerFields(c: any) {
  return { id: c.id, name: c.name, phone: c.phone, maintenanceCycle: c.maintenanceCycle, maintenanceFrequency: c.maintenanceFrequency, isActive: c.isActive, notes: c.notes, version: c.version };
}

router.get('/', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { search = '', page = '1', limit = '20', active, includeSchedule } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const where: any = {};
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
    if (active !== undefined) where.isActive = active === 'true';
    const total = await prisma.customer.count({ where });

    const includeOpts: any = { address: true };
    if (includeSchedule === 'true') {
      includeOpts.appointments = { include: { task: true }, orderBy: { scheduledDate: 'desc' as const } };
    }

    const customers = await prisma.customer.findMany({
      where, include: includeOpts,
      skip: (parseInt(page)-1)*safeLimit, take: safeLimit, orderBy: { createdAt: 'desc' }
    });

    if (includeSchedule !== 'true') {
      return res.json({ success: true, data: customers, meta: { total, page: parseInt(page), limit: safeLimit } });
    }

    const now = new Date();
    const enriched = customers.map((c: any) => {
      const appts: any[] = c.appointments || [];
      const completed = appts
        .filter(a => a.task?.status === 'COMPLETED')
        .sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());
      const upcoming = appts
        .filter(a => new Date(a.scheduledDate) >= now && a.status !== 'CANCELLED' && a.task?.status !== 'COMPLETED')
        .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());
      const overdue = appts.filter(a =>
        new Date(a.scheduledDate) < now && a.status !== 'CANCELLED' && a.task?.status !== 'COMPLETED'
      );
      const nextMaintenance = upcoming[0]?.scheduledDate || null;
      const daysUntil = nextMaintenance
        ? Math.ceil((new Date(nextMaintenance).getTime() - now.getTime()) / 86400000)
        : null;
      let alertLevel = 'ok';
      if (overdue.length > 0) alertLevel = 'overdue';
      else if (daysUntil !== null && daysUntil <= 10) alertLevel = 'soon';
      return { ...c, lastMaintenance: completed[0]?.scheduledDate || null, nextMaintenance, daysUntil, alertLevel, overdueCount: overdue.length };
    });

    res.json({ success: true, data: enriched, meta: { total, page: parseInt(page), limit: safeLimit } });
  } catch (e) { next(e); }
});

router.get('/:id', requireRole('ADMIN', 'SCHEDULING'), async (req, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: { address: true, appointments: { include: { task: { include: { technician: { select: { id: true, name: true } } } } }, orderBy: { scheduledDate: 'desc' }, take: 10 } },
    });
    if (!customer) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: customer });
  } catch (e) { next(e); }
});

router.post('/', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = customerSchema.parse(req.body);
    const { address, installationDate, ...rest } = body as any;
    const customer = await prisma.customer.create({
      data: {
        ...rest,
        installationDate: installationDate ? new Date(installationDate) : undefined,
        createdById: req.user!.userId,
        address: { create: address },
      },
      include: { address: true },
    });
    await writeAudit({
      action: 'CREATE', entityType: 'customer', entityId: customer.id, userId: req.user!.userId,
      label: `Customer '${customer.name}' was created`,
      labelAr: `تم إنشاء العميل '${customer.name}'`,
      after: customerFields(customer),
    });
    await emitEvent({ type: EVENT_TYPES.CUSTOMER_CREATED, entityType: 'customer', entityId: customer.id, userId: req.user!.userId, payload: customerFields(customer) });
    emitToAll(SOCKET_EVENTS.CUSTOMER_CREATED, customer);
    res.status(201).json({ success: true, data: customer });
  } catch (e) { next(e); }
});

router.put('/:id', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = customerSchema.partial().parse(req.body);
    const { address, version, installationDate, ...rest } = body as any;

    const before = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (version !== undefined && before.version !== version) return conflict(res, before.version, version);

    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(installationDate !== undefined ? { installationDate: installationDate ? new Date(installationDate) : null } : {}),
        version: { increment: 1 },
        ...(address ? { address: { update: address } } : {}),
      },
      include: { address: true },
    });
    await writeAudit({
      action: 'UPDATE', entityType: 'customer', entityId: customer.id, userId: req.user!.userId,
      label: `Customer '${customer.name}' was updated`,
      labelAr: `تم تحديث بيانات العميل '${customer.name}'`,
      before: customerFields(before), after: customerFields(customer),
    });
    await emitEvent({ type: EVENT_TYPES.CUSTOMER_UPDATED, entityType: 'customer', entityId: customer.id, userId: req.user!.userId, payload: customerFields(customer) });
    emitToAll(SOCKET_EVENTS.CUSTOMER_UPDATED, customer);
    res.json({ success: true, data: customer });
  } catch (e) { next(e); }
});

router.patch('/:id/toggle-active', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const existing = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: { isActive: !existing.isActive, version: { increment: 1 } },
      include: { address: true },
    });
    await writeAudit({
      action: 'UPDATE', entityType: 'customer', entityId: customer.id, userId: req.user!.userId,
      label: `Customer '${customer.name}' ${customer.isActive ? 'activated' : 'deactivated'}`,
      labelAr: `تم ${customer.isActive ? 'تفعيل' : 'تعطيل'} العميل '${customer.name}'`,
      before: customerFields(existing), after: customerFields(customer),
    });
    await emitEvent({ type: EVENT_TYPES.CUSTOMER_UPDATED, entityType: 'customer', entityId: customer.id, userId: req.user!.userId, payload: customerFields(customer) });
    emitToAll(SOCKET_EVENTS.CUSTOMER_UPDATED, customer);
    res.json({ success: true, data: customer });
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: { appointments: { select: { id: true } } },
    });
    if (!customer) return res.status(404).json({ success: false, message: 'Not found' });
    const apptIds = customer.appointments.map((a: any) => a.id);
    await prisma.customer.delete({ where: { id: req.params.id } });
    await writeAudit({
      action: 'DELETE', entityType: 'customer', entityId: req.params.id, userId: req.user!.userId,
      label: `Customer '${customer.name}' was deleted`,
      labelAr: `تم حذف العميل '${customer.name}'`,
      before: customerFields(customer),
    });
    await emitEvent({ type: EVENT_TYPES.CUSTOMER_DELETED, entityType: 'customer', entityId: req.params.id, userId: req.user!.userId, payload: { id: req.params.id, name: customer.name } });
    emitToAll(SOCKET_EVENTS.CUSTOMER_DELETED, { id: req.params.id });
    if (apptIds.length > 0) {
      emitToAll(SOCKET_EVENTS.APPOINTMENT_DELETED, { ids: apptIds, customerId: req.params.id });
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.delete('/', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const customers = await prisma.customer.findMany({ select: { id: true, name: true } });
    if (customers.length === 0) return res.json({ success: true, data: { count: 0 } });
    const apptRecords = await prisma.appointment.findMany({
      where: { customerId: { in: customers.map(c => c.id) } },
      select: { id: true },
    });
    const apptIds = apptRecords.map((a: any) => a.id);
    const result = await prisma.customer.deleteMany();
    await writeAudit({
      action: 'DELETE', entityType: 'customer', entityId: 'bulk',
      userId: req.user!.userId,
      label: `Bulk delete: ${result.count} customers permanently deleted`,
      labelAr: `حذف جماعي: تم حذف ${result.count} عميل بشكل نهائي`,
      before: { count: result.count, customers: customers.map(c => ({ id: c.id, name: c.name })) },
    });
    await emitEvent({
      type: EVENT_TYPES.CUSTOMER_DELETED, entityType: 'customer', entityId: 'bulk',
      userId: req.user!.userId,
      payload: { bulk: true, count: result.count, ids: customers.map(c => c.id) },
    });
    emitToAll(SOCKET_EVENTS.CUSTOMERS_BULK_DELETED, { count: result.count });
    if (apptIds.length > 0) {
      emitToAll(SOCKET_EVENTS.APPOINTMENT_DELETED, { ids: apptIds, bulk: true });
    }
    res.json({ success: true, data: { count: result.count } });
  } catch (e) { next(e); }
});

export default router;
