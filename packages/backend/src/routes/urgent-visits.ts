import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToRole, emitToAll } from '../socket';
import { SOCKET_ROOMS, SOCKET_EVENTS } from '../constants';
import { writeAudit } from '../services/audit.service';

const router = Router();
router.use(authenticate);

const visitSchema = z.object({
  appointmentId:   z.string().uuid(),
  customerName:    z.string().min(1).max(200),
  customerPhone:   z.string().min(1).max(20),
  customerDetails: z.string().max(1000).optional(),
  serviceNotes:    z.string().max(2000).optional(),
  serviceType:     z.enum(['INSTALLATION','MAINTENANCE','VISIT_ONLY']),
  paymentMethod:   z.enum(['CASH','BANK_TRANSFER']),
  amount:          z.number().min(0),
  customerInfo:    z.string().max(1000).optional(),
  serviceDetails:  z.string().max(2000).optional(),
  notes:           z.string().max(2000).optional(),
});

// Technician submits visit record after completing urgent appointment
router.post('/', requireRole('TECHNICIAN'), async (req: AuthRequest, res, next) => {
  try {
    const body = visitSchema.parse(req.body);
    const appt = await prisma.appointment.findUnique({
      where: { id: body.appointmentId },
    });
    if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });
    if (!appt.isUrgent) return res.status(400).json({ success: false, message: 'Appointment is not urgent' });
    if (await prisma.urgentVisitRecord.findUnique({ where: { appointmentId: body.appointmentId } })) {
      return res.status(409).json({ success: false, message: 'Record already submitted for this appointment' });
    }

    const record = await prisma.urgentVisitRecord.create({
      data: {
        appointmentId:   body.appointmentId,
        customerName:    body.customerName,
        customerPhone:   body.customerPhone,
        customerDetails: body.customerDetails,
        serviceNotes:    body.serviceNotes,
        serviceType:     body.serviceType,
        paymentMethod:   body.paymentMethod,
        amount:          body.amount,
        customerInfo:    body.customerInfo,
        serviceDetails:  body.serviceDetails,
        notes:           body.notes,
        submittedById:   req.user!.userId,
      },
      include: { submittedBy: { select: { id: true, name: true } } },
    });
    await writeAudit({
      action: 'CREATE', entityType: 'urgent_visit', entityId: record.id, userId: req.user!.userId,
      label: `Urgent visit completed for customer '${body.customerName}' — Payment: ${body.paymentMethod} — Amount: ${body.amount}`,
      after: { id: record.id, customerName: body.customerName, paymentMethod: record.paymentMethod, appointmentId: record.appointmentId },
    });
    emitToRole(SOCKET_ROOMS.ADMIN, 'urgent_visit:submitted', record);

    // Auto-create or update customer from urgent visit data
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

      const existing = await prisma.customer.findFirst({ where: { phone } });

      if (existing) {
        await prisma.customer.update({
          where: { id: existing.id },
          data: { name, notes: body.serviceNotes || existing.notes || undefined, version: { increment: 1 } },
        });
        await prisma.address.upsert({
          where: { customerId: existing.id },
          create: { customerId: existing.id, ...addrData },
          update: addrData,
        });
        emitToAll(SOCKET_EVENTS.CUSTOMER_CREATED, { id: existing.id, name, phone });
      } else {
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
        emitToAll(SOCKET_EVENTS.CUSTOMER_CREATED, { id: newCust.id, name, phone });
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
