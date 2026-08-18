import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToRole, emitToRoles, emitToTechnician } from '../socket';
import { SOCKET_EVENTS, SOCKET_ROOMS } from '../constants';
import { writeAudit } from '../services/audit.service';
import { emitEvent, EVENT_TYPES } from '../services/event.service';
import { stripCompletionAmount } from '../services/completionPrivacy.service';
import { resolveOrCreateUrgentCustomer, validateUrgentCustomerIdentity, InvalidCustomerIdentityError } from '../services/customerResolve.service';

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
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_CREATED, appt);
  }
  if (appt.visibleToTechnician) {
    if (appt.technicianId) {
      emitToTechnician(appt.technicianId, SOCKET_EVENTS.APPOINTMENT_CREATED, appt);
    } else {
      emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.APPOINTMENT_CREATED, appt);
    }
  }
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
      include: { customer: { include: { address: true } }, technician: true },
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
    // Modification #6: completionAmount is private to ADMIN/TECHNICIAN. The list
    // endpoint (GET /) already strips it for SCHEDULING; this single-record
    // endpoint needs the same treatment.
    const out = req.user!.role === 'SCHEDULING' ? stripCompletionAmount(appt) : appt;
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
        include: { customer: { include: { address: true } }, technician: true },
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
      include: { customer: { include: { address: true } }, technician: true },
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

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { visibleToTechnician: false, adminApproved: false, version: { increment: 1 } },
      include: { customer: { include: { address: true } }, technician: true },
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
      include: { customer: { include: { address: true } }, technician: true },
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
    if (appt.technicianId) {
      emitToTechnician(appt.technicianId, SOCKET_EVENTS.APPOINTMENT_CREATED, appt);
    } else {
      emitToRole(SOCKET_ROOMS.TECHNICIAN, SOCKET_EVENTS.APPOINTMENT_CREATED, appt);
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
    // Only the owning technician's job -- other technicians must not see it start.
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_STARTED, appt);
    if (appt.technicianId) emitToTechnician(appt.technicianId, SOCKET_EVENTS.APPOINTMENT_STARTED, appt);
    res.json({ success: true, data: appt });
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
      if (!trimmedTechnicianName) return res.status(400).json({ success: false, message: 'Technician name is required' });
      if (!FIRST_NAME_RE.test(trimmedTechnicianName)) return res.status(400).json({ success: false, message: 'Please enter first name only' });
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

    const appt = await prisma.appointment.update({
      where: { id: req.params.id },
      data: {
        workStatus: 'COMPLETED', completedAt: new Date(),
        serviceDetails: body.serviceDetails,
        completionAmount: body.completionAmount,
        completionPaymentMethod: body.completionPaymentMethod,
        completionImage: body.completionImage ?? null,
        nextMaintenanceNote: trimmedNextMaintenanceNote,
        actualCompletionDate,
        // Completion-record field only -- see the schema comment and the Zod
        // field comment above. Admin completions never submit this, so it
        // stays null there (the display layer falls back to the technician
        // relation); a Technician completion always has a validated value by
        // this point.
        completionTechnicianName: trimmedTechnicianName || null,
        // Modification #8: every completion submission starts a fresh Maintenance
        // review cycle -- the Technician can never self-confirm it, regardless of
        // whether this appointment was ever previously completed/confirmed.
        maintenanceConfirmed: false,
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
    // Only the owning technician -- was previously routed to the whole TECHNICIAN role,
    // meaning every other technician received it too.
    if (appt.technicianId) emitToTechnician(appt.technicianId, SOCKET_EVENTS.APPOINTMENT_COMPLETED, sanitized);
    res.json({ success: true, data: appt });
  } catch (e) { next(e); }
});

// Modification #8: Scheduling/Maintenance explicitly reviews and confirms a
// Technician's completion report (actual completion date + non-financial
// completion details). Distinct action from the Technician's own completion
// submission -- never auto-approved, never confirmable by the Technician.
router.patch('/:id/confirm-operation', requireRole('SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const before = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { customer: true } });
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
      include: { technician: true, customer: true },
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
    const postponedSanitized = { ...appt, completionAmount: undefined, completionPaymentMethod: undefined };
    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.APPOINTMENT_POSTPONED, appt);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.APPOINTMENT_POSTPONED, postponedSanitized);
    // Only the owning technician -- other technicians have no reason to see this job.
    if (appt.technicianId) emitToTechnician(appt.technicianId, SOCKET_EVENTS.APPOINTMENT_POSTPONED, postponedSanitized);
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
    // Non-sensitive (id only); all three roles' UIs subscribe to this event to refresh.
    emitToRoles([SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING, SOCKET_ROOMS.TECHNICIAN], SOCKET_EVENTS.APPOINTMENT_DELETED, { id: req.params.id });
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
