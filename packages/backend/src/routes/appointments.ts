import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToRole, emitToRoles, emitToTechnician } from '../socket';
import { SOCKET_EVENTS, SOCKET_ROOMS } from '../constants';
import { writeAudit } from '../services/audit.service';
import { emitEvent, EVENT_TYPES } from '../services/event.service';
import { stripCompletionAmount, stripCompletionAmountFromList, stripInstallationFinancialsFromCustomer, TECHNICIAN_PUBLIC_INCLUDE } from '../services/completionPrivacy.service';
import { resolveOrCreateUrgentCustomer, validateUrgentCustomerIdentity, InvalidCustomerIdentityError } from '../services/customerResolve.service';
import { recalculateCustomerMaintenanceDue } from '../services/maintenanceDue.service';

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
  // Part A: Admin owns the customer identity for an urgent appointment at
  // creation time -- the Technician no longer enters it at completion (see
  // routes/urgent-visits.ts). Only meaningful when isUrgent is true; ignored
  // for a normal appointment (which is identified by customerId instead).
  // Loosely typed here (format is validated below, only for the urgent path,
  // via validateUrgentCustomerIdentity) -- same "loose Zod, business rule in
  // the route" pattern this file already uses for technicianName/FIRST_NAME_RE.
  customerName: z.string().max(200).optional(),
  customerPhone: z.string().max(20).optional(),
});

// Modification #13: one Unicode letter "word" (Latin or Arabic), optionally
// joined by a single internal hyphen/apostrophe (e.g. "Jean-Paul", "O'Brien").
// Whitespace of any kind fails this by construction, which is what rejects a
// multi-word full name like "Ahmed Ali" -- no separate whitespace check needed.
const FIRST_NAME_RE = /^[\p{L}]+(?:['-][\p{L}]+)*$/u;

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
    visibleToScheduling: a.visibleToScheduling, visibleToTechnician: a.visibleToTechnician,
    createdByRole: a.createdByRole, technicianId: a.technicianId, workStatus: a.workStatus,
    // Modification #8: a workflow/state boolean, same category as the other
    // approval flags above -- unlike actualCompletionDate/serviceDetails/etc,
    // which stay out of the audit snapshot (established convention: completion
    // *content* is never audited here, only workflow state).
    maintenanceConfirmed: a.maintenanceConfirmed,
  };
}

// Routes an appointment:created event exactly the way GET /appointments already filters
// visibility: SCHEDULING only sees scheduling-visible appointments; a technician
// only sees their own assignment or the shared unassigned pool (never another technician's
// pre-assigned job), and never a Scheduling-exported appointment still pending Admin
// approval (Modification #5 -- visibleToTechnician).
function broadcastAppointmentCreated(appt: any, isUrgent: boolean, visibleToScheduling: boolean) {
  emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_CREATED, appt);
  if (visibleToScheduling) {
    // Privacy Patch #2: defense in depth -- completionAmount/completionImage/
    // urgentVisitRecord financials are always null on a freshly-created
    // appointment, but routing through the same helper every other
    // Scheduling-facing emit uses keeps this call site from silently drifting
    // out of sync if that ever changes.
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_CREATED, stripCompletionAmount(appt));
  }
  if (appt.visibleToTechnician) {
    // Privacy Patch #2 follow-up: this event's audience is always Technician
    // here (assigned technician or the shared unassigned pool), regardless of
    // who created the appointment -- strip the nested customer's
    // installation-financial fields, same as every other Technician-facing
    // appointment payload (see /start, /complete, /postpone in this file).
    const techSafeAppt = appt.customer ? { ...appt, customer: stripInstallationFinancialsFromCustomer(appt.customer) } : appt;
    if (appt.technicianId) {
      emitToTechnician(appt.technicianId, SOCKET_EVENTS.APPOINTMENT_CREATED, techSafeAppt);
    } else {
      emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.APPOINTMENT_CREATED, techSafeAppt);
    }
  }
}

const WORK_INCLUDE = {
  customer: { include: { address: true } },
  technician: TECHNICIAN_PUBLIC_INCLUDE,
  postponements: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  urgentVisitRecord: true,
};

// Perf fix: this route was previously fully unbounded (no `limit`/`skip` of
// any kind), so every caller -- regardless of whether it actually needed the
// complete matching dataset -- paid the cost of transferring every matching
// row's full relation graph. `page`/`limit` are additive and optional:
// omitting both preserves page 1 of DEFAULT_LIMIT rows (matching this
// codebase's existing GET /customers pagination convention), not the old
// unbounded behavior -- every caller that genuinely needs the complete
// matching set (urgent-work lists, the technician work queue, the
// appointments report/export) now fetches every page explicitly via the
// shared fetchAllPages() frontend helper instead of relying on an implicit
// unbounded response.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const { status, workStatus: workStatusFilter, from, to, urgent, pendingSchedulingApproval, page: pageRaw, limit: limitRaw } = req.query as any;

    let page = 1;
    if (pageRaw !== undefined) {
      const n = Number(pageRaw);
      if (!Number.isInteger(n) || n < 1) {
        return res.status(400).json({ success: false, message: 'page must be an integer >= 1' });
      }
      page = n;
    }
    let limit = DEFAULT_LIMIT;
    if (limitRaw !== undefined) {
      const n = Number(limitRaw);
      if (!Number.isInteger(n) || n < 1) {
        return res.status(400).json({ success: false, message: 'limit must be an integer >= 1' });
      }
      limit = Math.min(n, MAX_LIMIT);
    }

    const where: any = {};
    if (status) where.status = status;
    if (from || to) where.scheduledDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
    if (urgent === 'false') where.isUrgent = false;

    if (workStatusFilter) {
      const statuses = String(workStatusFilter).split(',').map((s: string) => s.trim()).filter(Boolean);
      if (statuses.length === 1) where.workStatus = statuses[0];
      else if (statuses.length > 1) where.workStatus = { in: statuses };
    }

    if (req.user!.role === 'SCHEDULING') {
      where.visibleToScheduling = true;
      // Approved urgent appointments use this same visibility gate; hidden
      // urgent work remains Administration/Technician-only until approval.
    }
    if (req.user!.role === 'TECHNICIAN') {
      // Modification #5: a Scheduling-exported appointment stays hidden from every
      // technician path (including the shared urgent pool, for defense in depth --
      // visibleToTechnician defaults true so this never affects existing/urgent
      // appointments) until Admin explicitly approves it.
      where.visibleToTechnician = true;
      if (urgent === 'true') {
        // Urgent appointments: all technicians can see all of them
        where.isUrgent = true;
      } else {
        // Regular work queue: own or unassigned non-urgent only
        where.isUrgent = false;
        where.OR = [
          { technicianId: req.user!.userId },
          { technicianId: null },
        ];
      }
    }
    if (req.user!.role === 'ADMIN') {
      if (urgent === 'true') where.isUrgent = true;
    }

    // Admin Appointments.tsx's "pending Scheduling approval" banner needs an
    // accurate total across ALL matching rows, not just the current page --
    // this narrows (never widens) whatever the role-based where above already
    // scoped, so it can't leak visibility across roles.
    if (pendingSchedulingApproval === 'true') {
      where.visibleToScheduling = false;
      where.createdByRole = 'SCHEDULING';
    }

    let [appts, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        include: WORK_INCLUDE,
        orderBy: { scheduledDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.appointment.count({ where }),
    ]) as [any[], number];

    // Privacy Patch #2: routed through the same centralized helper every other
    // Scheduling-facing appointment response uses, instead of this route's own
    // previously-separate inline delete logic -- keeps completionAmount,
    // completionPaymentMethod, completionImage and urgentVisitRecord.amount/
    // paymentMethod consistently redacted everywhere.
    if (req.user!.role === 'SCHEDULING') {
      appts = stripCompletionAmountFromList(appts);
    } else if (req.user!.role === 'TECHNICIAN') {
      appts.forEach((a: any) => {
        if (a.technicianId !== req.user!.userId) {
          delete a.completionAmount; delete a.completionPaymentMethod;
        }
        delete a.completionImage;
        if (a.customer) a.customer = stripInstallationFinancialsFromCustomer(a.customer);
      });
    }

    res.json({
      success: true,
      data: appts,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (e) { next(e); }
});

// Modification #10: lists exactly the appointments Scheduling has exported
// (Modification #5) that are still awaiting Admin approval -- the
// (visibleToTechnician=false, adminApproved=false) state. Registered before
// GET /:id so "pending-export-approval" is never swallowed by the :id param
// route. This boolean pair is only ever produced by the export-to-technicians
// endpoint (ordinary appointment creation always sets visibleToTechnician=true;
// export-to-technicians is itself scoped to visibleToScheduling=true,
// isUrgent=false appointments), so no separate createdByRole filter is needed
// to exclude unrelated appointments -- isUrgent:false is still asserted here
// explicitly, matching that same scoping, as defense in depth.
router.get('/pending-export-approval', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const appts = await prisma.appointment.findMany({
      where: { visibleToTechnician: false, adminApproved: false, isUrgent: false },
      include: { customer: { include: { address: true } }, technician: TECHNICIAN_PUBLIC_INCLUDE },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ success: true, data: appts });
  } catch (e) { next(e); }
});

// Perf fix: the Admin/Technician Sidebar urgent badges previously called
// GET /appointments?urgent=true&limit=200 (a `limit` this route never reads,
// so it was always fully unbounded) purely to compute
// `.filter(a => !a.urgentVisitRecord).length` client-side after transferring
// every relation (customer+address, technician, postponements,
// urgentVisitRecord) for every urgent appointment. This is a count-only
// replacement with exactly the same visibility/urgency semantics GET
// /appointments?urgent=true already applies for these two roles (ADMIN: all
// urgent appointments; TECHNICIAN: only visibleToTechnician ones) --
// "unresolved" is unchanged too: isUrgent && no urgentVisitRecord yet.
router.get('/urgent-unresolved-count', requireRole('ADMIN', 'TECHNICIAN'), async (req: AuthRequest, res, next) => {
  try {
    const where: any = { isUrgent: true, urgentVisitRecord: null };
    if (req.user!.role === 'TECHNICIAN') {
      where.visibleToTechnician = true;
    }
    const count = await prisma.appointment.count({ where });
    res.json({ success: true, data: count });
  } catch (e) { next(e); }
});

router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const where: any = { id: req.params.id };
    if (req.user!.role === 'SCHEDULING') {
      where.visibleToScheduling = true;
    }
    if (req.user!.role === 'TECHNICIAN') {
      // Can view urgent appointments (all) or their own/unassigned non-urgent appointments,
      // but never a Scheduling-exported appointment still pending Admin approval (#5).
      where.visibleToTechnician = true;
      where.OR = [
        { isUrgent: true },
        { isUrgent: false, technicianId: req.user!.userId },
        { isUrgent: false, technicianId: null },
      ];
    }
    const appt = await prisma.appointment.findFirst({
      where,
      include: WORK_INCLUDE,
    });
    if (!appt) return res.status(404).json({ success: false, message: 'Not found' });
    // Modification #6 / Privacy Patch #2: completionAmount/completionImage/
    // urgentVisitRecord financials are private to ADMIN/TECHNICIAN; the list
    // endpoint (GET /) already strips them for SCHEDULING via the same helper,
    // this single-record endpoint needs the same treatment. Technician's own
    // nested customer include also has its installation-financial fields
    // stripped (see stripInstallationFinancialsFromCustomer).
    let out: any = appt;
    if (req.user!.role === 'SCHEDULING') {
      out = stripCompletionAmount(appt);
    } else if (req.user!.role === 'TECHNICIAN' && appt.customer) {
      out = { ...appt, customer: stripInstallationFinancialsFromCustomer(appt.customer) };
    }
    res.json({ success: true, data: out });
  } catch (e) { next(e); }
});

router.post('/', requireRole('ADMIN','SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = apptSchema.parse(req.body);
    const isAdmin = req.user!.role === 'ADMIN';
    const isUrgent = isAdmin ? (body.isUrgent ?? false) : false;
    // Urgent work is private to Administration and Technicians at creation.
    // Only the Admin approval action may expose it to Scheduling.
    const visibleToScheduling = isUrgent ? false : (isAdmin ? (body.visibleToScheduling ?? true) : true);
    // `adminApproved` is the export-approval state for the technician workflow,
    // not the Scheduling visibility gate.  Admin-created urgent work is therefore
    // already approved for technicians even while it remains private to Scheduling.
    const adminApproved = isAdmin;

    if (!isUrgent && !body.customerId) {
      return res.status(400).json({ success: false, message: 'customerId is required for non-urgent appointments' });
    }

    // Part A: Admin owns the customer identity for an urgent appointment --
    // validated up front (before any DB write) so a malformed identity never
    // reaches resolveOrCreateUrgentCustomer. See services/customerResolve.service.ts.
    let urgentIdentity: { name: string; phone: string } | null = null;
    if (isUrgent) {
      try {
        urgentIdentity = validateUrgentCustomerIdentity(body.customerName, body.customerPhone);
      } catch (err) {
        if (err instanceof InvalidCustomerIdentityError) {
          return res.status(400).json({ success: false, message: err.message });
        }
        throw err;
      }
    }

    // Customer resolve/create + appointment creation happen in one transaction
    // so a new Customer can never be committed without the urgent appointment
    // that triggered it (or vice versa) -- no orphan records on partial failure.
    let urgentCustomerCreated = false;
    let urgentCustomerForEvents: { id: string; name: string; phone: string } | null = null;
    const appt = await prisma.$transaction(async (tx) => {
      let effectiveCustomerId: string | null = body.customerId || null;

      if (isUrgent && urgentIdentity) {
        let loc: Record<string, string> = {};
        if (body.urgentLocation) {
          try { loc = JSON.parse(body.urgentLocation); } catch {}
        }
        const resolved = await resolveOrCreateUrgentCustomer(tx, urgentIdentity, {
          addressFallback: loc,
          createdById: req.user!.userId,
        });
        effectiveCustomerId = resolved.customer.id;
        urgentCustomerCreated = resolved.created;
        urgentCustomerForEvents = resolved.customer;
      }

      return tx.appointment.create({
        data: {
          customerId: effectiveCustomerId,
          type: body.type as any,
          scheduledDate: new Date(body.scheduledDate),
          notes: body.notes,
          urgentLocation: body.urgentLocation || null,
          isUrgent,
          visibleToScheduling,
          adminApproved,
          // Approval-flow fix: a normal (non-urgent) appointment CREATED BY
          // SCHEDULING must start hidden from Technicians -- exactly the same
          // pending state the export-to-technicians endpoint below used to
          // require a separate manual action to reach -- so it lands directly
          // in Admin's Appointment Acceptance queue instead of ever having been
          // technician-visible. An Admin-created appointment (or any urgent
          // appointment, which only Admin can create here -- see `isUrgent`
          // above) needs no separate approval and stays immediately visible,
          // exactly as before. The client can never override this: visibleToTechnician
          // is not one of apptSchema's accepted fields, so a Scheduling-supplied
          // value is silently dropped by Zod before this line ever runs.
          visibleToTechnician: isAdmin || isUrgent,
          createdByRole: req.user!.role,
          createdById: req.user!.userId,
          technicianId: body.technicianId ?? null,
          workStatus: 'WAITING',
        },
        include: { customer: { include: { address: true } }, technician: TECHNICIAN_PUBLIC_INCLUDE },
      });
    });
    if (appt.customerId) {
      await prisma.customer.update({ where: { id: appt.customerId }, data: { activityDismissed: false } });
    }
    if (urgentCustomerCreated && urgentCustomerForEvents) {
      const newCust = urgentCustomerForEvents as { id: string; name: string; phone: string };
      await writeAudit({
        action: 'CREATE', entityType: 'customer', entityId: newCust.id, userId: req.user!.userId,
        label: `Customer '${newCust.name}' created from urgent appointment`,
        labelAr: `تم إنشاء العميل '${newCust.name}' من موعد عاجل`,
        after: { id: newCust.id, name: newCust.name, phone: newCust.phone },
      });
      await emitEvent({ type: EVENT_TYPES.CUSTOMER_CREATED, entityType: 'customer', entityId: newCust.id, userId: req.user!.userId, payload: newCust });
      // Customer PII must not leak to TECHNICIAN role via socket -- same rule as
      // routes/customers.ts's own POST /.
      emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.CUSTOMER_CREATED, newCust);
      if (!isUrgent || visibleToScheduling) emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.CUSTOMER_CREATED, newCust);
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
    broadcastAppointmentCreated(appt, isUrgent, visibleToScheduling);
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
    // Object-level authorization: a Scheduling caller must not be able to write to an
    // appointment that GET /api/appointments[/:id] would already hide from them
    // (visibleToScheduling=false). A hidden appointment's UUID is indistinguishable
    // from a nonexistent one -- both return a plain 404, never a distinguishable 403.
    const existing = req.user!.role === 'SCHEDULING'
      ? await prisma.appointment.findFirst({ where: { id: req.params.id, visibleToScheduling: true }, include: { customer: true } })
      : await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { customer: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    // scheduledDate is a due-date baseline for legacy COMPLETED appointments whose
    // actualCompletionDate and completedAt are both null (the explicitly-supported
    // legacy shape -- see computeNextMaintenanceDate). Moving it therefore carries
    // the same consistency requirement as completion and deletion: the edit and
    // the recalculated due date must commit together, or the stored due date
    // silently describes a schedule that no longer exists.
    const updated = await prisma.$transaction(async (tx) => {
      const updatedAppt = await tx.appointment.update({
        where: { id: req.params.id },
        data: {
          ...(body.scheduledDate ? { scheduledDate: new Date(body.scheduledDate), status: 'RESCHEDULED' } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.visibleToScheduling !== undefined ? { visibleToScheduling: body.visibleToScheduling } : {}),
          version: { increment: 1 },
        },
        include: { customer: { include: { address: true } }, technician: TECHNICIAN_PUBLIC_INCLUDE, urgentVisitRecord: true },
      });
      // Only when the date actually moved -- a notes or visibility edit cannot
      // change any due date.
      if (updatedAppt.customerId && body.scheduledDate) {
        await recalculateCustomerMaintenanceDue(tx, updatedAppt.customerId);
      }
      return updatedAppt;
    });
    const custNameUpd = existing.customer?.name || 'Urgent Visit';
    const custNameUpdAr = existing.customer?.name || 'زيارة عاجلة';
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: updated.id, userId: req.user!.userId,
      label: `Appointment for '${custNameUpd}' updated`,
      labelAr: `تم تحديث موعد العميل '${custNameUpdAr}'`,
      after: apptFields(updated),
    });
    // No technician subscriber for this event name -- confirmed via frontend audit.
    // Modification #6: completionAmount must never reach the SCHEDULING room --
    // an already-completed appointment can still be rescheduled/edited here.
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_STATUS, updated);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_STATUS, stripCompletionAmount(updated));
    const out = req.user!.role === 'SCHEDULING' ? stripCompletionAmount(updated) : updated;
    res.json({ success: true, data: out });
  } catch (e) { next(e); }
});

router.patch('/:id/approve-visibility', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const appt = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { customer: true } });
    if (!appt) return res.status(404).json({ success: false, message: 'Not found' });
    const updated = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { visibleToScheduling: true, adminApproved: true, version: { increment: 1 } },
      include: { customer: { include: { address: true } }, technician: TECHNICIAN_PUBLIC_INCLUDE },
    });
    // Modification #6: strip completionAmount before it reaches the SCHEDULING room.
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_STATUS, updated);
    const schedSafe = stripCompletionAmount(updated);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_STATUS, schedSafe);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_CREATED, schedSafe);
    if (updated.isUrgent && updated.customer) {
      emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.CUSTOMER_CREATED, updated.customer);
    }
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
});

// ── Modification #5: Scheduling/Maintenance export -> Admin approval -> Technician ──
// Scheduling requests that an appointment it already manages become visible to
// Technicians. Never trusts the request body for role or state -- everything is
// derived from the authenticated JWT role and the appointment's own current row.
router.patch('/:id/export-to-technicians', requireRole('SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    // Scoped to exactly what Scheduling can already see in its own appointment
    // table (visibleToScheduling + non-urgent) -- an appointment outside that
    // scope reports 404, the same as it would from GET /appointments/:id, rather
    // than leaking a distinguishable 403.
    const before = await prisma.appointment.findFirst({
      where: { id: req.params.id, visibleToScheduling: true, isUrgent: false },
      include: { customer: true },
    });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    // State machine (visibleToTechnician, adminApproved): (true,false) = never
    // exported -- the only state export is allowed from. (false,false) = already
    // pending. (true,true) = already exported and approved. (false,true) never
    // occurs. Both non-exportable states are rejected server-side, not just
    // hidden in the UI -- prevents duplicate/overlapping export requests from
    // corrupting the state or silently creating a second pending request.
    if (!before.visibleToTechnician && !before.adminApproved) {
      return res.status(409).json({ success: false, error: 'ALREADY_PENDING', message: 'This appointment is already pending Admin approval.' });
    }
    if (before.visibleToTechnician && before.adminApproved) {
      return res.status(409).json({ success: false, error: 'ALREADY_APPROVED', message: 'This appointment has already been exported and approved.' });
    }

    // scheduledDate is a due-date baseline for legacy COMPLETED appointments whose
    // actualCompletionDate and completedAt are both null (the explicitly-supported
    // Export-to-approval changes only visibility flags -- no date, no completion
    // state -- so no maintenance-due recalculation is involved.
    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { visibleToTechnician: false, adminApproved: false, version: { increment: 1 } },
      include: { customer: { include: { address: true } }, technician: TECHNICIAN_PUBLIC_INCLUDE },
    });
    const custName = appt.customer?.name || 'Urgent Visit';
    const custNameAr = appt.customer?.name || 'زيارة عاجلة';
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Appointment for '${custName}' exported for Admin approval by Scheduling`,
      labelAr: `تم تصدير موعد '${custNameAr}' لاعتماد الإدارة بواسطة الجدولة`,
      before: apptFields(before), after: apptFields(appt),
    });
    // Admin/Scheduling-only status update -- deliberately never reaches any
    // technician room; the appointment is not (or no longer) technician-visible.
    // Modification #6: strip completionAmount before it reaches the SCHEDULING
    // room/response -- the caller here IS Scheduling, and this appointment could
    // already carry a completed amount from a previous cycle.
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_STATUS, appt);
    const schedSafeAppt = stripCompletionAmount(appt);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_STATUS, schedSafeAppt);
    res.json({ success: true, data: schedSafeAppt });
  } catch (e) { next(e); }
});

// Admin approves a Scheduling-exported appointment, revealing it to Technicians.
router.patch('/:id/approve-export', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const before = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { customer: true } });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    // Only approvable from the "pending export approval" state -- rejects an
    // appointment that was never exported and one that's already approved
    // (idempotent-safe: a duplicate approval click gets a clear 409, not a
    // silent no-op or a corrupted double-increment).
    if (before.visibleToTechnician || before.adminApproved) {
      return res.status(409).json({ success: false, error: 'NOT_PENDING', message: 'This appointment is not pending export approval.' });
    }

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { visibleToTechnician: true, adminApproved: true, version: { increment: 1 } },
      include: { customer: { include: { address: true } }, technician: TECHNICIAN_PUBLIC_INCLUDE },
    });
    const custName = appt.customer?.name || 'Urgent Visit';
    const custNameAr = appt.customer?.name || 'زيارة عاجلة';
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Appointment for '${custName}' export approved by Admin -- now visible to Technicians`,
      labelAr: `تم اعتماد تصدير موعد '${custNameAr}' بواسطة الإدارة — أصبح مرئياً للفنيين`,
      before: apptFields(before), after: apptFields(appt),
    });
    // Modification #6: strip completionAmount before it reaches the SCHEDULING room.
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_STATUS, appt);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_STATUS, stripCompletionAmount(appt));
    // Reveal to Technicians now that Admin has approved -- same routing convention
    // as broadcastAppointmentCreated: the assigned technician if one exists,
    // otherwise the shared/unassigned pool (whole TECHNICIAN room). This is the
    // ONLY place a Scheduling-exported appointment ever reaches a technician room.
    // Privacy Patch #2 follow-up: same customer installation-financial redaction
    // as broadcastAppointmentCreated -- this audience is always Technician.
    const techSafeApprovedAppt = appt.customer ? { ...appt, customer: stripInstallationFinancialsFromCustomer(appt.customer) } : appt;
    if (appt.technicianId) {
      emitToTechnician(appt.technicianId, SOCKET_EVENTS.APPOINTMENT_CREATED, techSafeApprovedAppt);
    } else {
      emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.APPOINTMENT_CREATED, techSafeApprovedAppt);
    }
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

router.patch('/:id/status', requireRole('ADMIN','SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { status, version, notes } = z.object({
      status: z.enum(['SCHEDULED','RESCHEDULED','CANCELLED','PENDING']),
      version: z.number().int().optional(),
      notes: z.string().max(1000).optional(),
    }).parse(req.body);

    // Object-level authorization: scope the lookup itself to what Scheduling is
    // allowed to see, rather than fetching unconditionally and rejecting afterward --
    // a hidden appointment's UUID must return the same plain 404 a nonexistent one
    // would, not a distinguishable 403 that confirms the ID exists.
    const before = req.user!.role === 'SCHEDULING'
      ? await prisma.appointment.findFirst({ where: { id: req.params.id, visibleToScheduling: true }, include: { customer: true } })
      : await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { customer: true } });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    if (version !== undefined && before.version !== version) return conflict(res, before.version, version);

    const updateData: any = { status: status as any, version: { increment: 1 } };
    if (notes !== undefined) updateData.notes = notes;

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: updateData,
      include: { customer: true, technician: TECHNICIAN_PUBLIC_INCLUDE },
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
    // Modification #6: strip completionAmount before it reaches the SCHEDULING
    // room/response -- SCHEDULING can call this route directly, including on an
    // appointment that already has a completed amount from a previous cycle.
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_STATUS, appt);
    const schedSafeStatus = stripCompletionAmount(appt);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_STATUS, schedSafeStatus);
    const outStatus = req.user!.role === 'SCHEDULING' ? schedSafeStatus : appt;
    res.json({ success: true, data: outStatus });
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
      include: { technician: TECHNICIAN_PUBLIC_INCLUDE, customer: { include: { address: true } } },
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
    // Privacy Patch #2: the technician-room emit's audience is always a
    // Technician regardless of whether Admin or the Technician performed this
    // action -- strip the nested customer's installation-financial fields for
    // that emit unconditionally.
    const techSafeAppt = appt.customer ? { ...appt, customer: stripInstallationFinancialsFromCustomer(appt.customer) } : appt;
    // Only the owning technician's job -- other technicians must not see it start.
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_STARTED, appt);
    if (appt.technicianId) emitToTechnician(appt.technicianId, SOCKET_EVENTS.APPOINTMENT_STARTED, techSafeAppt);
    // The unassigned pool is visible to EVERY technician, so when a job
    // leaves that pool the other technicians' queues must refresh too.
    // Previously all technicians shared one User id, so the per-technician
    // room above happened to reach all of them; with real identities it no
    // longer does, and a stale queue means a tap that 404s.
    if (before.technicianId === null) emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.APPOINTMENT_STARTED, techSafeAppt);
    res.json({ success: true, data: isAdmin ? appt : techSafeAppt });
  } catch (e) { next(e); }
});

// Technician completes work on an appointment
router.patch('/:id/complete', requireRole('TECHNICIAN', 'ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      serviceDetails: z.string().max(2000).optional(),
      completionAmount: z.number().optional(),
      // Bank Transfer subtype fix: BANK_TRANSFER is no longer a valid bare
      // value -- it is replaced by the two required subtypes below, so a
      // submission of the old bare "BANK_TRANSFER" string now correctly fails
      // Zod validation (400) instead of silently accepting a transfer with no
      // subtype. completionPaymentMethod stays a plain Prisma String column
      // (see schema.prisma), so this is a validation-layer change only --
      // no migration.
      completionPaymentMethod: z.enum(['CASH','BANK_TRANSFER_COMMERCIAL','BANK_TRANSFER_PERSONAL']).optional(),
      completionImage: z.string().max(5_000_000).optional(),
      // Modification #6: optional note for the customer's next maintenance visit.
      // Never required, regardless of role -- unlike serviceDetails/amount/method
      // below, which are only required for a non-admin (technician) completion.
      nextMaintenanceNote: z.string().max(2000).optional(),
      // Modification #8: the ACTUAL operation date (not completedAt, which stays
      // the submission timestamp below). Required for a non-admin completion,
      // same as serviceDetails/amount/method.
      actualCompletionDate: z.string().refine(v => !isNaN(Date.parse(v)), { message: 'Invalid completion date' }).optional(),
      // Modification #13: the Technician's first name, entered fresh at
      // completion. Business/report data only -- it is validated for format
      // here but never used as identity; the authenticated actor remains
      // req.user!.userId (JWT) via the existing technicianId-ownership check
      // below. Persisted as completionTechnicianName (a completion-record
      // field, distinct from the `technician` relation, which remains the
      // sole source of truth for permissions/ownership/audit) so the exact
      // submitted name can be shown later in Admin -> Technicians completion
      // details -- see the persistence below and the inline note there.
      technicianName: z.string().max(100).optional(),
      version: z.number().int().optional(),
    }).parse(req.body);
    const isAdmin = req.user!.role === 'ADMIN';
    // Blank/whitespace-only input is treated the same as omitted -- stored as null,
    // never as an empty string.
    const trimmedNextMaintenanceNote = body.nextMaintenanceNote?.trim() || null;
    const trimmedTechnicianName = body.technicianName?.trim() || '';

    if (!isAdmin) {
      if (!body.serviceDetails?.trim()) return res.status(400).json({ success: false, message: 'Service details are required' });
      if (body.completionAmount == null || body.completionAmount < 0) return res.status(400).json({ success: false, message: 'Amount is required' });
      if (!body.completionPaymentMethod) return res.status(400).json({ success: false, message: 'Payment method is required' });
      if (!body.actualCompletionDate) return res.status(400).json({ success: false, message: 'Completion date is required' });
      // v4 decision D4: the technician's identity now comes from the
      // authenticated JWT, so the app no longer ASKS them to type their own
      // name. The field is therefore no longer required.
      //
      // It is still accepted and still validated when present, because
      // employees remain on Desktop v3.6.5 for this whole development cycle and
      // that client always sends it -- rejecting or ignoring it would either
      // break their completions or silently drop data they can see on screen.
      // What changed is that a missing name is no longer an error, and the
      // value is never treated as identity (see the persistence below).
      if (trimmedTechnicianName && !FIRST_NAME_RE.test(trimmedTechnicianName)) {
        return res.status(400).json({ success: false, message: 'Please enter first name only' });
      }
    }

    let actualCompletionDate: Date | null = null;
    if (body.actualCompletionDate) {
      actualCompletionDate = new Date(body.actualCompletionDate);
      // End of today (server time) -- the actual operation cannot have happened
      // in the future, but "today" itself must remain a valid entry.
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      if (actualCompletionDate.getTime() > endOfToday.getTime()) {
        return res.status(400).json({ success: false, message: 'Completion date cannot be in the future' });
      }
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

    // C9: the completion and the due-date it implies commit TOGETHER.
    //
    // Previously the completion committed first and the recalculation ran after
    // it as a failure-tolerant side effect, so a failure there left a completed
    // maintenance with an obsolete nextMaintenanceDueAt. That field is now
    // foundational -- dashboard buckets, overdue detection, due-soon state,
    // priority sorting and pagination order all read it -- so a stale value is a
    // silently wrong operational picture, not a cosmetic lag.
    //
    // The recalculation runs inside this transaction, so it SEES the appointment
    // it is reacting to and derives the date from the same history that is being
    // committed. Socket emission, audit and event writes stay outside: a
    // transaction must never be held open across network I/O.
    const appt = await prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.update({
      where: { id: req.params.id },
      data: {
        // Mirrors /start: a technician completing a job from the UNASSIGNED pool
        // claims it. Without this the completion could commit with technicianId
        // null AND completionTechnicianName null -- no attribution at all --
        // which is reachable today because an ADMIN pressing Start does not
        // assign anyone. The typed first name used to paper over exactly this
        // case; removing it (decision D4) made the gap real, so ownership has to
        // come from the JWT instead.
        ...(before.technicianId === null && !isAdmin ? { technicianId: req.user!.userId } : {}),
        workStatus: 'COMPLETED', completedAt: new Date(),
        serviceDetails: body.serviceDetails,
        completionAmount: body.completionAmount,
        completionPaymentMethod: body.completionPaymentMethod,
        completionImage: body.completionImage ?? null,
        nextMaintenanceNote: trimmedNextMaintenanceNote,
        actualCompletionDate,
        // Completion-record field only -- never identity (v4 decision D4). The
        // authenticated technician is the `technician` relation, resolved from
        // the JWT by the ownership check above; this string is at most a
        // historical artefact of what a v3.6.5 client typed.
        //
        // A v4 client sends nothing here, so this stores null and every display
        // falls back to the technician relation. Existing rows are untouched:
        // the values employees already submitted stay exactly as they are.
        completionTechnicianName: trimmedTechnicianName || null,
        // Modification #8: every completion submission starts a fresh Maintenance
        // review cycle -- the Technician can never self-confirm it, regardless of
        // whether this appointment was ever previously completed/confirmed.
        maintenanceConfirmed: false,
        version: { increment: 1 },
      },
      include: { technician: TECHNICIAN_PUBLIC_INCLUDE, customer: true },
      });

      if (updated.customerId) {
        await tx.customer.update({ where: { id: updated.customerId }, data: { activityDismissed: false } });
        // Requirement #4: a completed maintenance is the strongest signal that
        // the customer's next due date moved. The THROWING variant is used
        // deliberately -- a failure here must roll the completion back, which is
        // the whole point of C9. Still the one authoritative domain service; the
        // formula is never duplicated here.
        await recalculateCustomerMaintenanceDue(tx, updated.customerId);
      }

      return updated;
    });
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
    // Privacy Patch #2: this value is now technician-room-only (Scheduling's
    // emit below uses the centralized helper instead), so also strip the
    // nested customer's installation-financial fields for that audience.
    if (sanitized.customer) sanitized.customer = stripInstallationFinancialsFromCustomer(sanitized.customer);
    const schedSafeCompleted = stripCompletionAmount(appt);
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_COMPLETED, appt);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_COMPLETED, schedSafeCompleted);
    // Only the owning technician -- was previously routed to the whole TECHNICIAN role,
    // meaning every other technician received it too.
    if (appt.technicianId) emitToTechnician(appt.technicianId, SOCKET_EVENTS.APPOINTMENT_COMPLETED, sanitized);
    // The unassigned pool is visible to EVERY technician, so when a job
    // leaves that pool the other technicians' queues must refresh too.
    // Previously all technicians shared one User id, so the per-technician
    // room above happened to reach all of them; with real identities it no
    // longer does, and a stale queue means a tap that 404s.
    if (before.technicianId === null) emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.APPOINTMENT_COMPLETED, sanitized);
    // Privacy Patch #2: the acting Technician's own REST response keeps their
    // full just-submitted completion data (amount/image) -- only the nested
    // customer's installation-financial fields are stripped, same as every
    // other Technician-facing appointment response in this file.
    const responseData = (!isAdmin && appt.customer)
      ? { ...appt, customer: stripInstallationFinancialsFromCustomer(appt.customer) }
      : appt;
    res.json({ success: true, data: responseData });
  } catch (e) { next(e); }
});

// Modification #8: Scheduling/Maintenance explicitly reviews and confirms a
// Technician's completion report (actual completion date + non-financial
// completion details). Distinct action from the Technician's own completion
// submission -- never auto-approved, never confirmable by the Technician.
router.patch('/:id/confirm-operation', requireRole('SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    // Object-level authorization: this route is SCHEDULING-only, so the visibility
    // scope is unconditional -- same 404-for-hidden-or-nonexistent pattern as the
    // other Scheduling-facing lookups in this file (e.g. export-to-technicians).
    const before = await prisma.appointment.findFirst({ where: { id: req.params.id, visibleToScheduling: true }, include: { customer: true } });
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });

    if (before.workStatus !== 'COMPLETED') {
      return res.status(409).json({ success: false, error: 'NOT_COMPLETED', message: 'This appointment has not been completed by a Technician yet.' });
    }
    // Idempotent-safe: a duplicate confirmation click gets a clear 409, not a
    // silent no-op or a corrupted double-increment.
    if (before.maintenanceConfirmed) {
      return res.status(409).json({ success: false, error: 'ALREADY_CONFIRMED', message: 'This operation has already been confirmed.' });
    }

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { maintenanceConfirmed: true, version: { increment: 1 } },
      include: { technician: TECHNICIAN_PUBLIC_INCLUDE, customer: true },
    });
    const custName = appt.customer?.name || 'Urgent Visit';
    const custNameAr = appt.customer?.name || 'زيارة عاجلة';
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Completion for '${custName}' confirmed by Scheduling`,
      labelAr: `تم تأكيد إكمال '${custNameAr}' بواسطة الجدولة`,
      before: apptFields(before), after: apptFields(appt),
    });
    // completionAmount is never touched by this action, but the response/socket
    // still goes through the standard SCHEDULING-safe sanitizer for consistency
    // and defense in depth (Modification #6 privacy rule).
    const schedSafeAppt = stripCompletionAmount(appt);
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_STATUS, appt);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_STATUS, schedSafeAppt);
    res.json({ success: true, data: schedSafeAppt });
  } catch (e) { next(e); }
});

// Technician postpones work on an appointment.
//
// v4 Requirement #6 / decision D2: postponement is a RESCHEDULE, not a terminal
// state. The technician agrees a new date with the customer, the appointment
// moves to that date and becomes actionable again, and the postponement itself
// survives permanently as history (PostponementRecord), including the date it
// moved FROM.
//
// Legacy shape is still accepted: employees on Desktop v3.6.5 post
// { reason, newDate? }. Making newDate unconditionally required would 400 a live
// client mid-shift, so it stays optional.
//
// BEHAVIOUR CHANGE FOR v3.6.5, STATED PLAINLY: that client's postpone dialog
// already has an optional "New Date" field. A technician on v3.6.5 who fills it
// in previously got terminal POSTPONED with scheduledDate untouched; they now
// get the full reschedule. That is intended -- decision D2 is explicit that an
// appointment must not be stranded in POSTPONED once a replacement date has been
// agreed, and the technician supplying a date IS that agreement. Only the
// leave-it-blank path is byte-for-byte unchanged. This is a real change to a live
// client's behaviour and is called out rather than glossed as "no impact".
router.patch('/:id/postpone', requireRole('TECHNICIAN', 'ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { reason, note, newDate, version } = z.object({
      // v4 makes the free-text optional (the new UI asks for a date, and a note
      // only if the technician wants one); v3.6.5 always sends `reason` and its
      // own UI requires it, so both shapes are accepted here.
      reason: z.string().max(1000).optional(),
      note: z.string().max(1000).optional(),
      newDate: z.string().refine(v => !isNaN(Date.parse(v)), { message: 'Invalid new date' }).optional(),
      version: z.number().int().optional(),
    }).parse(req.body);
    const isAdmin = req.user!.role === 'ADMIN';
    // One stored value from either field name; empty rather than null because
    // PostponementRecord.reason is a NOT NULL column on existing rows.
    const effectiveReason = (note ?? reason ?? '').trim();
    const isReschedule = !!newDate;

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

    // A reschedule must move the appointment FORWARD. Without a server-side
    // bound, a past date (from a direct API call, or a v3.6.5 client whose date
    // input has no `min`) would move the job into the past and return it to
    // WAITING -- where it immediately reads as overdue in every dashboard bucket,
    // with a PostponementRecord claiming it was "rescheduled" backwards. The
    // client-side `min` is a convenience; this is the actual rule.
    // Start-of-today, so agreeing a later slot on the same day stays valid.
    if (isReschedule) {
      // UTC on BOTH sides. The client sends a date-only string from
      // <input type="date">, which parses as UTC midnight, while setHours() would
      // floor to server-LOCAL midnight -- so on any host west of UTC the
      // technician's own "today" (which the input's own `min` offers) would be
      // rejected as past. Same UTC-only convention as daysUntilDue().
      const now = new Date();
      const startOfTodayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const target = new Date(newDate!);
      const targetDayUTC = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
      if (targetDayUTC < startOfTodayUTC) {
        return res.status(400).json({ success: false, message: 'The new date cannot be in the past' });
      }
    }

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: {
        // Reschedule path (v4): the appointment MOVES to the agreed date and
        // returns to WAITING so it is actionable again on that date. Leaving it
        // in POSTPONED after the technician has already agreed a replacement
        // date would strand it -- it would vanish from the technician work
        // queue and from every operational dashboard bucket, both of which
        // filter on WAITING/IN_PROGRESS, even though real work is still due.
        //
        // RESCHEDULED is an existing, previously-unused value of the
        // AppointmentStatus enum, so recording "this was moved" costs no enum
        // migration -- the riskiest kind of change against this project's
        // migration history.
        ...(isReschedule
          ? { scheduledDate: new Date(newDate!), workStatus: 'WAITING', status: 'RESCHEDULED' as const }
          : { workStatus: 'POSTPONED' }),
        version: { increment: 1 },
        postponements: {
          create: {
            reason: effectiveReason,
            newDate: newDate ? new Date(newDate) : null,
            // The date this appointment is moving FROM, captured before the
            // update overwrites it. Without this the "from" half of
            // "postponed from X to Y" is unrecoverable the instant the write
            // lands, because scheduledDate now holds Y.
            previousDate: isReschedule ? before.scheduledDate : null,
            // Attribution comes from the authenticated JWT, never from the
            // request body (decision D4). A client cannot name a different
            // technician here because there is no field to name one in.
            requestedById: req.user!.userId,
          },
        },
      },
      include: { technician: TECHNICIAN_PUBLIC_INCLUDE, customer: true },
    });
    if (appt.customerId) {
      await prisma.customer.update({ where: { id: appt.customerId }, data: { activityDismissed: false } });
    }
    const custName = appt.customer?.name || 'Urgent Visit';
    const custNameAr = appt.customer?.name || 'زيارة عاجلة';
    const actorName = isAdmin ? 'Administration' : (appt.technician?.name || 'Technician');
    // The audit label states both dates for a reschedule, so Administration and
    // Scheduling can read "moved from X to Y" straight out of System Activity
    // without opening the appointment.
    const movedEn = isReschedule
      ? ` (rescheduled from ${new Date(before.scheduledDate).toLocaleDateString('en-GB')} to ${new Date(newDate!).toLocaleDateString('en-GB')})`
      : '';
    const movedAr = isReschedule
      ? ` (أُعيدت جدولته من ${new Date(before.scheduledDate).toLocaleDateString('en-GB')} إلى ${new Date(newDate!).toLocaleDateString('en-GB')})`
      : '';
    const reasonSuffix = effectiveReason ? `: ${effectiveReason}` : '';
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Maintenance for '${custName}' postponed by ${actorName}${movedEn}${reasonSuffix}`,
      labelAr: `تم تأجيل صيانة '${custNameAr}' بواسطة ${actorName}${movedAr}${reasonSuffix}`,
      before: apptFields(before), after: apptFields(appt),
    });
    await emitEvent({ type: EVENT_TYPES.APPOINTMENT_POSTPONED, entityType: 'appointment', entityId: appt.id, userId: req.user!.userId, payload: apptFields(appt) });
    const postponedSanitized = { ...appt, completionAmount: undefined, completionPaymentMethod: undefined };
    // Privacy Patch #2: this value is now technician-room-only (Scheduling's
    // emit below uses the centralized helper instead), so also strip the
    // nested customer's installation-financial fields for that audience.
    if (postponedSanitized.customer) postponedSanitized.customer = stripInstallationFinancialsFromCustomer(postponedSanitized.customer);
    const schedSafePostponed = stripCompletionAmount(appt);
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_POSTPONED, appt);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_POSTPONED, schedSafePostponed);
    // Only the owning technician -- other technicians have no reason to see this job.
    if (appt.technicianId) emitToTechnician(appt.technicianId, SOCKET_EVENTS.APPOINTMENT_POSTPONED, postponedSanitized);
    // The unassigned pool is visible to EVERY technician, so when a job
    // leaves that pool the other technicians' queues must refresh too.
    // Previously all technicians shared one User id, so the per-technician
    // room above happened to reach all of them; with real identities it no
    // longer does, and a stale queue means a tap that 404s.
    if (before.technicianId === null) emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.APPOINTMENT_POSTPONED, postponedSanitized);
    // Privacy Patch #2: strip only the nested customer's installation-financial
    // fields for the acting Technician's own REST response -- same narrow fix
    // as every other Technician-facing appointment response in this file.
    const responseData = (!isAdmin && appt.customer)
      ? { ...appt, customer: stripInstallationFinancialsFromCustomer(appt.customer) }
      : appt;
    res.json({ success: true, data: responseData });
  } catch (e) { next(e); }
});

// v4 Requirement #7: "Customer Did Not Answer".
//
// SEMANTICS (the documented decision this route implements):
// This is a durable operational EVENT, and the appointment stays actionable --
// option B of the two the audit put forward. It is deliberately NOT a terminal
// workStatus, because the technician work queue filters
// `workStatus IN (WAITING, IN_PROGRESS)` and dashboardCategorization.service.ts
// defines its whole `active` bucket the same way. A CUSTOMER_NO_ANSWER
// workStatus would therefore have deleted the appointment from the technician's
// own queue and from every Administration/Scheduling operational bucket at
// precisely the moment it most needs following up -- the exact opposite of the
// requirement's intent.
//
// So instead: the attempt is recorded permanently in CustomerNoAnswerRecord
// (one row per attempt, so repeated failed contacts all survive), and the
// appointment returns to WAITING so the technician or Administration can try
// again on the same date. Because the event lives in its own table rather than
// in a mutable column, it survives every later change to the appointment --
// including a subsequent completion or reschedule -- which is what makes it
// usable later for Phase 2 alerts, Phase 3 Technician Tasks aggregation, and
// reporting.
//
// It never reschedules automatically: no new date is invented on the customer's
// behalf.
router.patch('/:id/no-answer', requireRole('TECHNICIAN', 'ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { note, version } = z.object({
      note: z.string().max(1000).optional(),
      version: z.number().int().optional(),
    }).parse(req.body);
    const isAdmin = req.user!.role === 'ADMIN';

    // Identical object-level authorization to /start, /complete and /postpone:
    // a technician can only reach their own assignment or the unassigned pool,
    // and anything else is an indistinguishable 404. There is deliberately no
    // technicianId in the request body, so a technician has no way to record
    // this event against another technician's job.
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
      return res.status(409).json({ success: false, message: 'This job is not in a state where a contact attempt can be recorded' });
    }

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: {
        // Back to WAITING (from IN_PROGRESS, or unchanged if already WAITING) so
        // the job remains in the queue and can be attempted again. scheduledDate
        // is deliberately untouched -- a failed contact is not a reschedule.
        workStatus: 'WAITING',
        version: { increment: 1 },
        noAnswerRecords: {
          create: {
            note: note?.trim() || null,
            // Attribution from the authenticated JWT only.
            recordedById: req.user!.userId,
          },
        },
      },
      include: { technician: TECHNICIAN_PUBLIC_INCLUDE, customer: true },
    });

    if (appt.customerId) {
      await prisma.customer.update({ where: { id: appt.customerId }, data: { activityDismissed: false } });
    }

    const custName = appt.customer?.name || 'Urgent Visit';
    const custNameAr = appt.customer?.name || 'زيارة عاجلة';
    const actorName = isAdmin ? 'Administration' : (appt.technician?.name || 'Technician');
    const noteSuffix = note?.trim() ? `: ${note.trim()}` : '';
    await writeAudit({
      action: 'UPDATE', entityType: 'appointment', entityId: appt.id, userId: req.user!.userId,
      label: `Customer '${custName}' did not answer — reported by ${actorName}${noteSuffix}`,
      labelAr: `لم يرد العميل '${custNameAr}' — سجّله ${actorName}${noteSuffix}`,
      before: apptFields(before), after: apptFields(appt),
    });
    await emitEvent({
      type: EVENT_TYPES.APPOINTMENT_CUSTOMER_NO_ANSWER, entityType: 'appointment', entityId: appt.id,
      userId: req.user!.userId, payload: apptFields(appt),
    });

    // Same audience and same redaction as /postpone: Administration and
    // Scheduling need to follow this up, and the owning technician's own device
    // needs its view refreshed. Scheduling's copy goes through the standard
    // sanitizer so no completion financials can ride along, and the technician's
    // copy additionally has the nested customer's installation financials
    // stripped -- identical to every other technician-facing payload in this file.
    const schedSafe = stripCompletionAmount(appt);
    const techSafe: any = { ...appt, completionAmount: undefined, completionPaymentMethod: undefined };
    if (techSafe.customer) techSafe.customer = stripInstallationFinancialsFromCustomer(techSafe.customer);
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_NO_ANSWER, appt);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_NO_ANSWER, schedSafe);
    if (appt.technicianId) emitToTechnician(appt.technicianId, SOCKET_EVENTS.APPOINTMENT_NO_ANSWER, techSafe);
    // The unassigned pool is visible to EVERY technician, so when a job
    // leaves that pool the other technicians' queues must refresh too.
    // Previously all technicians shared one User id, so the per-technician
    // room above happened to reach all of them; with real identities it no
    // longer does, and a stale queue means a tap that 404s.
    if (before.technicianId === null) emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.APPOINTMENT_NO_ANSWER, techSafe);
    // This action moves the job from IN_PROGRESS back to WAITING, so every
    // Administration/Scheduling screen already listening for appointment state
    // changes must refresh. Nothing subscribes to the new no-answer event yet --
    // Phase 2 adds those surfaces -- and without this the dashboards would keep
    // showing IN_PROGRESS until an unrelated event happened to fire. Reusing the
    // existing, already-redacted status event rather than adding UI here keeps
    // Phase 1 frozen while still leaving no screen showing stale state.
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_STATUS, appt);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_STATUS, schedSafe);

    const responseData = (!isAdmin && appt.customer)
      ? { ...appt, customer: stripInstallationFinancialsFromCustomer(appt.customer) }
      : appt;
    res.json({ success: true, data: responseData });
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: { customer: true },
    });
    if (!appt) return res.status(404).json({ success: false, message: 'Not found' });
    // Deleting a COMPLETED appointment removes the very completion the customer's
    // due date was derived from, so the two must commit together for the same
    // reason completion does -- otherwise the due date would keep pointing at a
    // completion that no longer exists.
    await prisma.$transaction(async (tx) => {
      await tx.appointment.delete({ where: { id: req.params.id } });
      if (appt.customerId) await recalculateCustomerMaintenanceDue(tx, appt.customerId);
    });
    const custName = appt.customer?.name || 'Urgent Visit';
    const custNameAr = appt.customer?.name || 'زيارة عاجلة';
    await writeAudit({
      action: 'DELETE', entityType: 'appointment', entityId: req.params.id, userId: req.user!.userId,
      label: `Appointment for '${custName}' was deleted by Admin`,
      labelAr: `تم حذف موعد العميل '${custNameAr}' بواسطة الإدارة`,
      before: apptFields(appt),
    });
    // Non-sensitive (id only); all three roles' UIs subscribe to this event to refresh.
    emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.APPOINTMENT_DELETED, { id: req.params.id });
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
