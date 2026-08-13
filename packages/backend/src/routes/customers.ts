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
import { stripCompletionAmountFromCustomers } from '../services/completionPrivacy.service';
import { deleteCustomerWithOperationalCleanup } from '../services/customerDeletion.service';
import { computeNextMaintenanceDate } from '../services/maintenanceSchedule.service';
import { applySchedulingCustomerVisibility } from '../services/schedulingCustomerVisibility.service';

const router = Router();
router.use(authenticate);

// Reused for both the primary phone's Zod-level check and the optional
// secondary phone's route-level check below (same format, single source).
// Exported so it stays the single source of truth for other routes/services
// that need the same primary-phone validation (see services/customerResolve.service.ts,
// used by the urgent-appointment creation flow) instead of a second implementation.
export const PHONE_RE = /^05\d{8}$/;

// Part D: maintenance recurrence must support half-month increments (1, 1.5,
// 2, 2.5, 3, 3.5, ...) but reject an arbitrary decimal (1.2, 2.37) -- i.e. the
// value must be a positive multiple of 0.5. Epsilon compare (not exact `%`)
// because a value round-tripped through JSON/float parsing can land a tiny
// distance off an exact half-step; the epsilon is far tighter than the
// smallest real gap between two valid steps (0.5), so it can never accept a
// value like 1.2 or 2.37. Exported for reuse in services/maintenanceSchedule.service.ts
// consumers/tests -- single source of truth for this business rule.
export function isHalfMonthStep(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const doubled = value * 2;
  return Math.abs(doubled - Math.round(doubled)) < 1e-9;
}

const addressSchema = z.object({
  city: z.string().max(100), district: z.string().max(100), street: z.string().max(200),
  postalCode: z.string().max(20).optional(), buildingNo: z.string().max(20).optional(),
  floorNo: z.string().max(20).optional(), apartmentNo: z.string().max(20).optional(),
});
const customerSchema = z.object({
  name: z.string().min(1).max(200), phone: z.string().regex(PHONE_RE),
  // Optional second contact number. Kept as a loose max-length string here
  // (not `.regex()`) so blank/omitted passes Zod -- format is validated in
  // the route below, same pattern as technicianName's FIRST_NAME_RE check in
  // routes/appointments.ts, because "blank is valid, malformed is not" isn't
  // expressible as a single regex without also accepting the empty string.
  secondaryPhone: z.string().max(20).optional(),
  maintenanceCycle: z.enum(['DAILY','WEEKLY','MONTHLY']),
  // Part D: no longer `.int()` -- half-month increments are required (see
  // isHalfMonthStep above). `1.2`/`2.37`/`0`/negative values are all rejected;
  // `1`/`1.5`/`2`/`2.5`/`3`/`3.5`/... are all accepted, and never rounded.
  maintenanceFrequency: z.number().positive().max(365)
    .refine(isHalfMonthStep, { message: 'Maintenance frequency must be in half-month steps (e.g. 1, 1.5, 2, 2.5)' })
    .default(1),
  notes: z.string().max(2000).optional(),
  installationDate: z.string().optional(),
  // Optional one-time historical service record (see resolvePreviousService
  // below for the all-or-nothing business rule). Loose string types here too,
  // same reasoning as secondaryPhone -- an empty string is a meaningful
  // "not provided/cleared" signal that a `.enum()`/date-refine directly on
  // the Zod schema can't express alongside a real value.
  previousServiceType: z.string().max(20).optional(),
  previousServiceDate: z.string().max(40).optional(),
  previousServiceNote: z.string().max(2000).optional(),
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
  return { id: c.id, name: c.name, phone: c.phone, secondaryPhone: c.secondaryPhone, maintenanceCycle: c.maintenanceCycle, maintenanceFrequency: c.maintenanceFrequency, isActive: c.isActive, notes: c.notes, version: c.version, previousServiceType: c.previousServiceType, previousServiceDate: c.previousServiceDate, previousServiceNote: c.previousServiceNote };
}

const PREVIOUS_SERVICE_TYPES = ['INSTALLATION', 'MAINTENANCE'];

// Merges a submitted previous-service trio (any subset may be present in this
// request; a key absent from `req.body` arrives here as `undefined` and means
// "not provided this request", not "clear it") against the customer's
// existing stored values, then validates the RESULTING effective state as a
// whole: this is historical metadata only (never an Appointment -- see
// PART B's business distinction), so it is either fully present or fully
// absent. An incomplete state (e.g. a date with no type) is rejected. `''`
// for a given key is the explicit "clear that field" signal, matching
// secondaryPhone's convention elsewhere in this file. Reused identically for
// both create (existing is always the all-null shape) and update.
function resolvePreviousService(
  submittedType: string | undefined,
  submittedDate: string | undefined,
  submittedNote: string | undefined,
  existing: { previousServiceType: string | null; previousServiceDate: Date | null; previousServiceNote: string | null }
): { previousServiceType: string | null; previousServiceDate: Date | null; previousServiceNote: string | null } | { error: string } {
  const effectiveType = submittedType !== undefined ? (submittedType.trim() || null) : existing.previousServiceType;
  if (effectiveType && !PREVIOUS_SERVICE_TYPES.includes(effectiveType)) {
    return { error: 'نوع الخدمة السابقة غير صالح' };
  }
  const effectiveDateRaw = submittedDate !== undefined
    ? (submittedDate.trim() || null)
    : (existing.previousServiceDate ? existing.previousServiceDate.toISOString() : null);
  if (effectiveDateRaw && isNaN(Date.parse(effectiveDateRaw))) {
    return { error: 'تاريخ الخدمة السابقة غير صالح' };
  }
  const effectiveNote = submittedNote !== undefined ? (submittedNote.trim() || null) : existing.previousServiceNote;

  const hasAny = !!effectiveType || !!effectiveDateRaw || !!effectiveNote;
  if (!hasAny) return { previousServiceType: null, previousServiceDate: null, previousServiceNote: null };
  if (!effectiveType) return { error: 'نوع الخدمة السابقة مطلوب عند إدخال بيانات الخدمة السابقة' };
  if (!effectiveDateRaw) return { error: 'تاريخ الخدمة السابقة مطلوب عند إدخال بيانات الخدمة السابقة' };
  return { previousServiceType: effectiveType, previousServiceDate: new Date(effectiveDateRaw), previousServiceNote: effectiveNote };
}

const NO_EXISTING_PREVIOUS_SERVICE = { previousServiceType: null, previousServiceDate: null, previousServiceNote: null };

// Normalizes a submitted secondaryPhone against the resolved primary phone.
// Returns { value } with value being a trimmed valid phone or null (blank/
// omitted -- explicit clear), or { error } with a user-facing message.
// Never invents a global cross-customer uniqueness rule -- only checks this
// one customer's own primary vs. secondary, per the existing primary-phone
// business rules (no such global constraint exists on `phone` either).
function normalizeSecondaryPhone(raw: string | undefined, primaryPhone: string): { value: string | null } | { error: string } {
  if (raw === undefined) return { value: null };
  const trimmed = raw.trim();
  if (!trimmed) return { value: null };
  if (!PHONE_RE.test(trimmed)) return { error: 'رقم الجوال الإضافي غير صالح' };
  if (trimmed === primaryPhone) return { error: 'رقم الجوال الإضافي يجب أن يكون مختلفًا عن رقم الجوال الأساسي' };
  return { value: trimmed };
}

router.get('/', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { search = '', page = '1', limit = '20', active, includeSchedule } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    let where: any = {};
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }, { secondaryPhone: { contains: search } }];
    if (active !== undefined) where.isActive = active === 'true';
    if (req.user!.role === 'SCHEDULING') where = applySchedulingCustomerVisibility(where);
    const total = await prisma.customer.count({ where });

    const includeOpts: any = { address: true };
    if (includeSchedule === 'true') {
      includeOpts.appointments = {
        include: { urgentVisitRecord: { include: { submittedBy: { select: { id: true, name: true } } } } },
        orderBy: { scheduledDate: 'desc' as const },
      };
    }

    let customers = await prisma.customer.findMany({
      where, include: includeOpts,
      skip: (parseInt(page)-1)*safeLimit, take: safeLimit, orderBy: { createdAt: 'desc' }
    });
    // Modification #6: completionAmount is private to ADMIN/TECHNICIAN.
    if (req.user!.role === 'SCHEDULING') customers = stripCompletionAmountFromCustomers(customers);

    if (includeSchedule !== 'true') {
      return res.json({ success: true, data: customers, meta: { total, page: parseInt(page), limit: safeLimit } });
    }

    const now = new Date();
    const enriched = customers.map((c: any) => {
      const appts: any[] = c.appointments || [];
      const completed = appts
        .filter(a => a.workStatus === 'COMPLETED')
        .sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());
      const overdue = appts.filter(a =>
        new Date(a.scheduledDate) < now && a.status !== 'CANCELLED' && a.workStatus !== 'COMPLETED'
      );
      // Source of truth: actualCompletionDate of the most recent completed
      // appointment + recurrence -- NOT the earliest upcoming scheduledDate
      // (a manually-scheduled future appointment may not exist, or may not
      // reflect the real recurrence cycle at all). See maintenanceSchedule.service.ts.
      const nextMaintenance = computeNextMaintenanceDate(c, appts);
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

router.get('/:id', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: req.user!.role === 'SCHEDULING'
        ? applySchedulingCustomerVisibility({ id: req.params.id })
        : { id: req.params.id },
      include: {
        address: true,
        appointments: {
          include: {
            technician: { select: { id: true, name: true } },
            urgentVisitRecord: { include: { submittedBy: { select: { id: true, name: true } } } },
          },
          orderBy: { scheduledDate: 'desc' },
          take: 10,
        },
      },
    });
    if (!customer) return res.status(404).json({ success: false, message: 'Not found' });
    // Modification #6: completionAmount is private to ADMIN/TECHNICIAN -- this is
    // the API behind Scheduling's "Maintenance History" view.
    const stripped: any = req.user!.role === 'SCHEDULING' ? stripCompletionAmountFromCustomers([customer])[0] : customer;
    // Same source of truth as GET / (includeSchedule) and GET /reports/customers --
    // see maintenanceSchedule.service.ts. The "Maintenance History" modal (Scheduling)
    // reads this field instead of deriving its own next-maintenance date from the raw
    // appointments list.
    const out = { ...stripped, nextMaintenance: computeNextMaintenanceDate(customer as any, (customer as any).appointments || []) };
    res.json({ success: true, data: out });
  } catch (e) { next(e); }
});

// Modification #7: surfaces the note a technician left on the customer's most
// recently COMPLETED appointment (Modification #6's nextMaintenanceNote), for
// display when Admin/Scheduling is creating that customer's next appointment.
// Reuses the existing field -- no new note storage. Only the minimal fields the
// UI needs are selected; completionAmount/completionPaymentMethod are never
// touched here, so there is nothing to strip.
router.get('/:id/latest-maintenance-note', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: req.user!.role === 'SCHEDULING'
        ? applySchedulingCustomerVisibility({ id: req.params.id })
        : { id: req.params.id },
      select: { id: true },
    });
    if (!customer) return res.status(404).json({ success: false, message: 'Not found' });

    // A handful of the most recent completed appointments, newest first. Most of
    // the time the very first one already has a note; a small lookahead handles
    // the case where one or more of the most recent completions left no note
    // (test scenario: newest completion has null nextMaintenanceNote, an older
    // one has a real note -- we must fall through to that older one, not stop).
    const candidates = await prisma.appointment.findMany({
      where: { customerId: req.params.id, workStatus: 'COMPLETED', nextMaintenanceNote: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { id: true, nextMaintenanceNote: true, completedAt: true },
      take: 5,
    });
    const match = candidates.find(a => a.nextMaintenanceNote && a.nextMaintenanceNote.trim().length > 0);

    if (!match) return res.json({ success: true, data: { nextMaintenanceNote: null } });
    res.json({
      success: true,
      data: { nextMaintenanceNote: match.nextMaintenanceNote, appointmentId: match.id, completedAt: match.completedAt },
    });
  } catch (e) { next(e); }
});

router.post('/', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = customerSchema.parse(req.body);
    const { address, installationDate, secondaryPhone, previousServiceType, previousServiceDate, previousServiceNote, ...rest } = body as any;
    const secondaryPhoneResult = normalizeSecondaryPhone(secondaryPhone, body.phone);
    if ('error' in secondaryPhoneResult) return res.status(400).json({ success: false, message: secondaryPhoneResult.error });
    const previousServiceResult = resolvePreviousService(previousServiceType, previousServiceDate, previousServiceNote, NO_EXISTING_PREVIOUS_SERVICE);
    if ('error' in previousServiceResult) return res.status(400).json({ success: false, message: previousServiceResult.error });
    const customer = await prisma.customer.create({
      data: {
        ...rest,
        secondaryPhone: secondaryPhoneResult.value,
        ...previousServiceResult,
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
    const { address, version, installationDate, secondaryPhone, previousServiceType, previousServiceDate, previousServiceNote, ...rest } = body as any;

    const before = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (version !== undefined && before.version !== version) return conflict(res, before.version, version);

    // Effective primary phone: the newly submitted one if this update changes
    // it, otherwise the customer's existing one -- either way, the secondary
    // must differ from whichever primary the customer will actually have.
    const effectivePrimaryPhone = body.phone !== undefined ? body.phone : before.phone;
    // Omitted entirely (key absent from the request body) -- leave the
    // existing secondaryPhone untouched, same partial-update semantics as
    // every other field on this route (Prisma skips an `undefined` value).
    let secondaryPhoneUpdate: { value: string | null } | undefined;
    if (secondaryPhone !== undefined) {
      const result = normalizeSecondaryPhone(secondaryPhone, effectivePrimaryPhone);
      if ('error' in result) return res.status(400).json({ success: false, message: result.error });
      secondaryPhoneUpdate = result;
    }
    // Same omitted-vs-provided distinction as secondaryPhone: only re-resolve
    // (and re-validate the all-or-nothing rule) the previous-service trio if
    // this request actually touches at least one of its three keys.
    let previousServiceUpdate: { previousServiceType: string | null; previousServiceDate: Date | null; previousServiceNote: string | null } | undefined;
    if (previousServiceType !== undefined || previousServiceDate !== undefined || previousServiceNote !== undefined) {
      const result = resolvePreviousService(previousServiceType, previousServiceDate, previousServiceNote, before);
      if ('error' in result) return res.status(400).json({ success: false, message: result.error });
      previousServiceUpdate = result;
    }

    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(secondaryPhoneUpdate ? { secondaryPhone: secondaryPhoneUpdate.value } : {}),
        ...(previousServiceUpdate ? previousServiceUpdate : {}),
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
    // See services/customerDeletion.service.ts for why this transactionally
    // deletes only the customer's operational (WAITING/IN_PROGRESS/POSTPONED,
    // non-urgent) appointments and leaves COMPLETED/urgent ones alone.
    const result = await deleteCustomerWithOperationalCleanup(req.params.id);

    if (!result) return res.status(404).json({ success: false, message: 'Not found' });
    const { customer, operationalAppointmentIds } = result;

    const cleanedNote = operationalAppointmentIds.length > 0
      ? ` (${operationalAppointmentIds.length} operational appointment${operationalAppointmentIds.length === 1 ? '' : 's'} removed)`
      : '';
    const cleanedNoteAr = operationalAppointmentIds.length > 0
      ? ` (تم حذف ${operationalAppointmentIds.length} موعد عمل)`
      : '';
    await writeAudit({
      action: 'DELETE', entityType: 'customer', entityId: req.params.id, userId: req.user!.userId,
      label: `Customer '${customer.name}' was deleted${cleanedNote}`,
      labelAr: `تم حذف العميل '${customer.name}'${cleanedNoteAr}`,
      before: customerFields(customer),
    });
    await emitEvent({ type: EVENT_TYPES.CUSTOMER_DELETED, entityType: 'customer', entityId: req.params.id, userId: req.user!.userId, payload: { id: req.params.id, name: customer.name } });
    // Non-sensitive (id only); all three roles' UIs subscribe to refresh on this.
    emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.CUSTOMER_DELETED, { id: req.params.id });
    if (operationalAppointmentIds.length > 0) {
      emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.APPOINTMENT_DELETED, { ids: operationalAppointmentIds, customerId: req.params.id });
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
