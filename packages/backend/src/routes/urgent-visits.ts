import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToRole } from '../socket';
import { SOCKET_ROOMS } from '../constants';
import { writeAudit } from '../services/audit.service';

const router = Router();
router.use(authenticate);

// Modification #13's exact first-name rule, reused for urgent-visit
// completion (Part B of this batch): one Unicode letter "word" (Latin or
// Arabic), optionally joined by a single internal hyphen/apostrophe.
// Deliberately duplicated rather than imported -- matches this codebase's
// established convention for this exact regex (see routes/appointments.ts's
// own comment on FIRST_NAME_RE, which duplicates it for the same reason
// PHONE_RE is duplicated between AddCustomer.tsx and customers.ts).
const FIRST_NAME_RE = /^[\p{L}]+(?:['-][\p{L}]+)*$/u;

// Bank Transfer subtype fix: BANK_TRANSFER is no longer a valid bare value --
// replaced by the two required subtypes, so a submission of the old bare
// "BANK_TRANSFER" string now correctly fails validation instead of silently
// accepting a transfer with no subtype (matches the identical change in
// appointments.ts's completionPaymentMethod).
// Visit Only fix: paymentMethod/amount are optional at the schema level and
// enforced conditionally below, since VISIT_ONLY genuinely needs neither.
// Part A/B: customer identity is now Admin's responsibility, entered at
// urgent-appointment creation time (see routes/appointments.ts) and resolved
// to a real Customer there -- customerName/customerPhone are still accepted
// here for backward compatibility with any in-flight client build, but they
// are NEVER trusted as the customer's identity (see the handler below, which
// always derives the persisted values from the appointment's linked Customer,
// never from this payload). A Technician can no longer set or override which
// customer an urgent visit belongs to.
const visitSchema = z.object({
  appointmentId:   z.string().uuid(),
  customerName:    z.string().max(200).optional(),
  customerPhone:   z.string().max(20).optional(),
  customerDetails: z.string().max(1000).optional(),
  serviceNotes:    z.string().max(2000).optional(),
  serviceType:     z.enum(['INSTALLATION','MAINTENANCE','VISIT_ONLY']),
  paymentMethod:   z.enum(['CASH','BANK_TRANSFER_COMMERCIAL','BANK_TRANSFER_PERSONAL']).optional(),
  amount:          z.number().min(0).optional(),
  customerInfo:    z.string().max(1000).optional(),
  serviceDetails:  z.string().max(2000).optional(),
  notes:           z.string().max(2000).optional(),
  // Part B: required for every Technician-submitted urgent visit (this route
  // is TECHNICIAN-only -- see requireRole below), same first-name-only rule
  // as Modification #13's normal-completion technicianName. Business/display
  // data only -- never used as the audit actor or persisted (see
  // trimmedTechnicianName below and its comment).
  technicianName:  z.string().max(100).optional(),
});

// Technician submits visit record after completing urgent appointment
router.post('/', requireRole('TECHNICIAN'), async (req: AuthRequest, res, next) => {
  try {
    const body = visitSchema.parse(req.body);
    const isVisitOnly = body.serviceType === 'VISIT_ONLY';

    // Part B: technicianName required, first-name-only, same rule as
    // Modification #13. Blank/whitespace-only is treated as missing. This is
    // business/display data only -- the authenticated actor (req.user!.userId,
    // used below for submittedById and the audit log) remains authoritative
    // and is never replaced by this user-entered string, and it is not
    // persisted (UrgentVisitRecord has no such column -- see schema.prisma;
    // the real completer is already reliably identified via submittedById/
    // submittedBy, so no duplicate name column was added).
    const trimmedTechnicianName = body.technicianName?.trim() || '';
    if (!trimmedTechnicianName) return res.status(400).json({ success: false, message: 'Technician name is required' });
    if (!FIRST_NAME_RE.test(trimmedTechnicianName)) return res.status(400).json({ success: false, message: 'Please enter first name only' });

    // Visit Only: amount/payment method are not required and never trusted
    // from the payload -- normalized below regardless of what was submitted,
    // so "VISIT_ONLY + amount 500" or "VISIT_ONLY + BANK_TRANSFER" can never
    // reach the database. For a normal (non-Visit-Only) visit, both remain
    // required exactly as before.
    if (!isVisitOnly) {
      if (!body.paymentMethod) return res.status(400).json({ success: false, message: 'Payment method is required' });
      if (body.amount == null) return res.status(400).json({ success: false, message: 'Amount is required' });
    }

    const appt = await prisma.appointment.findUnique({
      where: { id: body.appointmentId },
      include: { customer: true },
    });
    if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });
    if (!appt.isUrgent) return res.status(400).json({ success: false, message: 'Appointment is not urgent' });

    // IDOR guard: if the appointment has an assigned technician, only that technician may submit
    if (appt.technicianId && appt.technicianId !== req.user!.userId) {
      return res.status(403).json({ success: false, message: 'You are not assigned to this appointment' });
    }

    if (await prisma.urgentVisitRecord.findUnique({ where: { appointmentId: body.appointmentId } })) {
      return res.status(409).json({ success: false, message: 'Record already submitted for this appointment' });
    }

    // UrgentVisitRecord.paymentMethod is a required (NOT NULL) String column
    // (see schema.prisma) -- no schema change was needed or made; an empty
    // string is the smallest-footprint way to represent "not applicable"
    // within that existing contract, and every display site already treats a
    // falsy paymentMethod as "no payment method" (see admin/pages/
    // UrgentAppointments.tsx).
    const normalizedAmount = isVisitOnly ? 0 : body.amount!;
    const normalizedPaymentMethod = isVisitOnly ? '' : body.paymentMethod!;

    // Part B backend safety: customer identity is never taken from this
    // payload -- it always comes from the Customer Admin already linked to
    // this urgent appointment at creation time (routes/appointments.ts). A
    // legacy urgent appointment created before this batch (no linked
    // Customer) simply has no identity to show here; it is never invented
    // from body.customerName/body.customerPhone, which are ignored even if
    // an older client build still sends them.
    const customerName = appt.customer?.name ?? null;
    const customerPhone = appt.customer?.phone ?? null;

    const record = await prisma.urgentVisitRecord.create({
      data: {
        appointmentId:   body.appointmentId,
        customerName,
        customerPhone,
        customerDetails: body.customerDetails,
        serviceNotes:    body.serviceNotes,
        serviceType:     body.serviceType,
        paymentMethod:   normalizedPaymentMethod,
        amount:          normalizedAmount,
        customerInfo:    body.customerInfo,
        serviceDetails:  body.serviceDetails,
        notes:           body.notes,
        submittedById:   req.user!.userId,
      },
      include: { submittedBy: { select: { id: true, name: true } } },
    });
    const customerLabel = customerName || 'Urgent Visit';
    await writeAudit({
      action: 'CREATE', entityType: 'urgent_visit', entityId: record.id, userId: req.user!.userId,
      label: `Urgent visit completed for customer '${customerLabel}' — Payment: ${normalizedPaymentMethod || 'N/A (Visit Only)'} — Amount: ${normalizedAmount}`,
      after: { id: record.id, customerName, paymentMethod: record.paymentMethod, appointmentId: record.appointmentId },
    });
    emitToRole(SOCKET_ROOMS.ADMIN, 'urgent_visit:submitted', record);

    res.status(201).json({ success: true, data: record });
  } catch (e) { next(e); }
});

// Admin views all urgent visit records
router.get('/', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { page = '1', limit = '50' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 50, 200);
    const total = await prisma.urgentVisitRecord.count();
    const records = await prisma.urgentVisitRecord.findMany({
      include: {
        appointment: { include: { customer: { include: { address: true } } } },
        submittedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * safeLimit,
      take: safeLimit,
    });
    res.json({ success: true, data: records, meta: { total, page: parseInt(page), limit: safeLimit } });
  } catch (e) { next(e); }
});

export default router;
