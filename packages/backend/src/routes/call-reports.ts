import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToAll } from '../socket';
import { SOCKET_EVENTS } from '../constants';
import { writeAudit } from '../services/audit.service';

const router = Router();
router.use(authenticate);

const callReportSchema = z.object({
  customerId:   z.string().uuid(),
  employeeName: z.string().min(1).max(200),
  callDate:     z.string().refine(v => !isNaN(Date.parse(v))),
  notes:        z.string().max(2000).optional(),
});

router.get('/', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { customerId, page = '1', limit = '50' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 50, 200);
    const where: any = {};
    if (customerId) where.customerId = customerId;
    const total = await prisma.callReport.count({ where });
    const reports = await prisma.callReport.findMany({
      where,
      include: { customer: { select: { id: true, name: true, phone: true } }, createdBy: { select: { id: true, name: true } } },
      orderBy: { callDate: 'desc' },
      skip: (parseInt(page) - 1) * safeLimit,
      take: safeLimit,
    });
    res.json({ success: true, data: reports, meta: { total, page: parseInt(page), limit: safeLimit } });
  } catch (e) { next(e); }
});

router.post('/', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = callReportSchema.parse(req.body);
    const report = await prisma.callReport.create({
      data: {
        customerId:   body.customerId,
        employeeName: body.employeeName,
        callDate:     new Date(body.callDate),
        notes:        body.notes,
        createdById:  req.user!.userId,
      },
      include: { customer: { select: { id: true, name: true } } },
    });
    await writeAudit({
      action: 'CREATE', entityType: 'call_report', entityId: report.id, userId: req.user!.userId,
      label: `Call report created for customer '${report.customer.name}' by ${body.employeeName}`,
      after: { id: report.id, customerId: report.customerId, employeeName: report.employeeName, callDate: report.callDate },
    });
    emitToAll('call_report:new', report);
    res.status(201).json({ success: true, data: report });
  } catch (e) { next(e); }
});

router.delete('/bulk', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { ids } = req.body as { ids?: string[] };
    if (Array.isArray(ids) && ids.length > 0) {
      await prisma.callReport.deleteMany({ where: { id: { in: ids } } });
      emitToAll('call_report:deleted', { ids });
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.delete('/all', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    await prisma.callReport.deleteMany({});
    emitToAll('call_report:deleted', { all: true });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const report = await prisma.callReport.findUnique({ where: { id: req.params.id } });
    if (!report) return res.status(404).json({ success: false, message: 'Not found' });
    await prisma.callReport.delete({ where: { id: req.params.id } });
    emitToAll('call_report:deleted', { ids: [req.params.id] });
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
