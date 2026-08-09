import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToRole } from '../socket';
import { SOCKET_ROOMS, SOCKET_EVENTS } from '../constants';
import { writeAudit } from '../services/audit.service';

const router = Router();
router.use(authenticate);

// Bank Transfer subtype fix: BANK_TRANSFER is no longer a valid bare value --
// replaced by the two required subtypes, so a submission of the old bare
// "BANK_TRANSFER" string now correctly fails validation instead of silently
// accepting a transfer with no subtype (matches the identical change in
// appointments.ts's completionPaymentMethod).
// Visit Only fix: paymentMethod/amount are optional at the schema level and
// enforced conditionally below, since VISIT_ONLY genuinely needs neither.
const visitSchema = z.object({
  appointmentId:   z.string().uuid(),
  customerName:    z.string().min(1).max(200),
  customerPhone:   z.string().min(1).max(20),
  customerDetails: z.string().max(1000).optional(),
  serviceNotes:    z.string().max(2000).optional(),
  serviceType:     z.enum(['INSTALLATION','MAINTENANCE','VISIT_ONLY']),
  paymentMethod:   z.enum(['CASH','BANK_TRANSFER_COMMERCIAL','BANK_TRANSFER_PERSONAL']).optional(),
  amount:          z.number().min(0).optional(),
  customerInfo:    z.string().max(1000).optional(),
  serviceDetails:  z.string().max(2000).optional(),
  notes:           z.string().max(2000).optional(),
});

// Technician submits visit record after completing urgent appointment
router.post('/', requireRole('TECHNICIAN'), async (req: AuthRequest, res, next) => {
  try {
    const body = visitSchema.parse(req.body);
    const isVisitOnly = body.serviceType === 'VISIT_ONLY';

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

    const record = await prisma.urgentVisitRecord.create({
      data: {
        appointmentId:   body.appointmentId,
        customerName:    body.customerName,
        customerPhone:   body.customerPhone,
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
    await writeAudit({
      action: 'CREATE', entityType: 'urgent_visit', entityId: record.id, userId: req.user!.userId,
      label: `Urgent visit completed for customer '${body.customerName}' — Payment: ${normalizedPaymentMethod || 'N/A (Visit Only)'} — Amount: ${normalizedAmount}`,
      after: { id: record.id, customerName: body.customerName, paymentMethod: record.paymentMethod, appointmentId: record.appointmentId },
    });
    emitToRole(SOCKET_ROOMS.ADMIN, 'urgent_visit:submitted', record);

    // Auto-create customer from urgent visit data — never overwrite existing customer records.
    // A customer is considered the same only when both phone AND name match (case-insensitive).
    // Any mismatch in identity always produces a new, independent customer record.
    try {
      const phone = body.customerPhone.trim();
      const name = body.customerName.trim();

      // Parse structured location from appointment urgentLocation
      let loc: Record<string, string> = {};
      if (appt.urgentLocation) {
        try { loc = JSON.parse(appt.urgentLocation); } catch {}
      }

      const city = loc.city || '—';
      const district = loc.district || '—';
      const street = loc.street || '—';
      const addrData = {
        city,
        district,
        street,
        ...(loc.postalCode   ? { postalCode:   loc.postalCode }   : {}),
        ...(loc.buildingNo   ? { buildingNo:   loc.buildingNo }   : {}),
        ...(loc.floorNo      ? { floorNo:      loc.floorNo }      : {}),
        ...(loc.apartmentNo  ? { apartmentNo:  loc.apartmentNo }  : {}),
      };

      // Match by phone AND name so a different person who happens to share a phone number
      // is never confused with an existing customer and their data is never overwritten.
      const existing = await prisma.customer.findFirst({
        where: { phone, name: { equals: name, mode: 'insensitive' } },
      });

      let resolvedCustomerId: string;

      if (existing) {
        // Confirmed same customer — link to existing record without touching their data.
        resolvedCustomerId = existing.id;
        emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.CUSTOMER_CREATED, { id: existing.id, name, phone });
        emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.CUSTOMER_CREATED, { id: existing.id, name, phone });
        // Link the appointment to the existing customer for history tracking.
        await prisma.appointment.update({
          where: { id: body.appointmentId },
          data: { customerId: existing.id },
        });
      } else {
        // New customer created from urgent appointment — do NOT link the urgent appointment
        // to prevent it from appearing as an unwanted "next maintenance" date. The visit
        // record already captures all required customer and service info for reference.
        const installDate = body.serviceType === 'INSTALLATION' ? new Date() : undefined;
        const newCust = await prisma.customer.create({
          data: {
            name,
            phone,
            maintenanceCycle: 'MONTHLY' as any,
            maintenanceFrequency: 1,
            notes: body.serviceNotes || undefined,
            ...(installDate ? { installationDate: installDate } : {}),
            createdById: req.user!.userId,
            address: { create: { ...addrData } },
          },
        });
        resolvedCustomerId = newCust.id;
        await writeAudit({
          action: 'CREATE', entityType: 'customer', entityId: newCust.id, userId: req.user!.userId,
          label: `Customer '${name}' created from urgent appointment`,
          after: { id: newCust.id, name, phone },
        });
        emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.CUSTOMER_CREATED, { id: newCust.id, name, phone });
        emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.CUSTOMER_CREATED, { id: newCust.id, name, phone });
      }
    } catch (autoErr: any) {
      console.error('[urgent-visit] auto-customer sync warning:', autoErr?.message);
    }

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
