import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToRole, emitToRoles } from '../socket';
import { SOCKET_EVENTS, SOCKET_ROOMS } from '../constants';
import { writeAudit } from '../services/audit.service';
import { emitEvent, EVENT_TYPES } from '../services/event.service';
import { bulkDeleteAllSchema, StaleCountError, sendStaleCountConflict, isTransactionConflict, sendTransactionConflict } from '../services/bulkDelete.service';

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
// PUT-only: adds the optimistic-concurrency `version` field on top of the partial
// create schema. Kept separate from customerSchema so POST /api/customers is
// unaffected -- version is never a create-time input.
const customerUpdateSchema = customerSchema.partial().extend({
  version: z.number().int().optional(),
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
      includeOpts.appointments = { orderBy: { scheduledDate: 'desc' as const } };
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
        .filter(a => a.workStatus === 'COMPLETED')
        .sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());
      const upcoming = appts
        .filter(a => new Date(a.scheduledDate) >= now && a.status !== 'CANCELLED' && a.workStatus !== 'COMPLETED')
        .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());
      const overdue = appts.filter(a =>
        new Date(a.scheduledDate) < now && a.status !== 'CANCELLED' && a.workStatus !== 'COMPLETED'
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
      include: { address: true, appointments: { include: { technician: { select: { id: true, name: true } } }, orderBy: { scheduledDate: 'desc' }, take: 10 } },
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
    // Customer PII must not leak to TECHNICIAN role via socket
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.CUSTOMER_CREATED, customer);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.CUSTOMER_CREATED, customer);
    res.status(201).json({ success: true, data: customer });
  } catch (e) { next(e); }
});

router.put('/:id', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = customerUpdateSchema.parse(req.body);
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
    // Customer PII must not leak to TECHNICIAN role via socket
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.CUSTOMER_UPDATED, customer);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.CUSTOMER_UPDATED, customer);
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
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.CUSTOMER_UPDATED, customer);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.CUSTOMER_UPDATED, customer);
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
    // Non-sensitive (id only); all three roles' UIs subscribe to refresh on this.
    emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.CUSTOMER_DELETED, { id: req.params.id });
    if (apptIds.length > 0) {
      emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.APPOINTMENT_DELETED, { ids: apptIds, customerId: req.params.id });
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});

// CRITICAL: deletes every customer in the system (and, via schema-level cascade,
// every Address and CallReport attached to them -- appointments are preserved with
// customerId set to null, per the SET NULL fix). Requires ADMIN, an explicit
// confirm:true, a typed "DELETE" phrase (the highest-risk tier -- an unconditional
// wipe of a major production table), and an expectedCount that must match the real
// count computed inside the same transaction as the delete, so a stale/reviewed
// number can never authorize deleting more than the caller actually saw.
const deleteAllCustomersSchema = bulkDeleteAllSchema.extend({
  confirmPhrase: z.literal('DELETE'),
});

router.delete('/', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { expectedCount } = deleteAllCustomersSchema.parse(req.body);

    const outcome = await prisma.$transaction(
      async (tx) => {
        const customers = await tx.customer.findMany({ select: { id: true, name: true } });
        if (customers.length !== expectedCount) {
          throw new StaleCountError(customers.length, expectedCount);
        }
        if (customers.length === 0) {
          return { deletedCount: 0, customers: [] as { id: string; name: string }[], apptIds: [] as string[] };
        }
        const apptRecords = await tx.appointment.findMany({
          where: { customerId: { in: customers.map((c) => c.id) } },
          select: { id: true },
        });
        const result = await tx.customer.deleteMany();
        return { deletedCount: result.count, customers, apptIds: apptRecords.map((a) => a.id) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if (outcome.deletedCount > 0) {
      await writeAudit({
        action: 'DELETE', entityType: 'customer', entityId: 'bulk',
        userId: req.user!.userId,
        label: `Bulk delete: ${outcome.deletedCount} customers permanently deleted`,
        labelAr: `حذف جماعي: تم حذف ${outcome.deletedCount} عميل بشكل نهائي`,
        before: { count: outcome.deletedCount, customers: outcome.customers },
      });
      await emitEvent({
        type: EVENT_TYPES.CUSTOMER_DELETED, entityType: 'customer', entityId: 'bulk',
        userId: req.user!.userId,
        payload: { bulk: true, count: outcome.deletedCount, ids: outcome.customers.map((c) => c.id) },
      });
      emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.CUSTOMERS_BULK_DELETED, { count: outcome.deletedCount });
      if (outcome.apptIds.length > 0) {
        emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.APPOINTMENT_DELETED, { ids: outcome.apptIds, bulk: true });
      }
    }
    res.json({ success: true, data: { deletedCount: outcome.deletedCount } });
  } catch (e) {
    if (e instanceof StaleCountError) return sendStaleCountConflict(res, e);
    if (isTransactionConflict(e)) return sendTransactionConflict(res);
    next(e);
  }
});

export default router;
