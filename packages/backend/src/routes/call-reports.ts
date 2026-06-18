import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToAll } from '../socket';
import { writeAudit } from '../services/audit.service';

const router = Router();
router.use(authenticate);

const callReportSchema = z.object({
  customerId:        z.string().uuid().optional(),
  unregisteredName:  z.string().min(1).max(200).optional(),
  unregisteredPhone: z.string().max(20).optional(),
  employeeName:      z.string().min(1).max(200),
  callDate:          z.string().refine(v => !isNaN(Date.parse(v))),
  notes:             z.string().max(2000).optional(),
}).refine(d => d.customerId || (d.unregisteredName && d.unregisteredName.trim().length > 0), {
  message: 'Either customerId or unregisteredName is required',
});

router.get('/', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { customerId, page = '1', limit = '50' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 50, 200);
    const offset = (parseInt(page) - 1) * safeLimit;

    let whereClause = '';
    const params: any[] = [];
    if (customerId) {
      params.push(customerId);
      whereClause = `WHERE cr."customerId" = $${params.length}`;
    }

    const countResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int as count FROM "call_reports" cr ${whereClause}`,
      ...params
    );
    const total = Number(countResult[0]?.count || 0);

    params.push(safeLimit, offset);
    const reports = await prisma.$queryRawUnsafe<any[]>(`
      SELECT cr.id, cr."customerId", cr."employeeName", cr."callDate", cr."notes",
             cr."unregisteredName", cr."unregisteredPhone", cr."createdAt", cr."createdById",
             json_build_object('id', c.id, 'name', c.name, 'phone', c.phone) as customer,
             json_build_object('id', u.id, 'name', u.name) as "createdBy"
      FROM "call_reports" cr
      LEFT JOIN "customers" c ON cr."customerId" = c.id
      LEFT JOIN "users" u ON cr."createdById" = u.id
      ${whereClause}
      ORDER BY cr."callDate" DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, ...params);

    const cleaned = reports.map((r: any) => ({
      ...r,
      customer: r.customerId ? r.customer : null,
    }));

    res.json({ success: true, data: cleaned, meta: { total, page: parseInt(page), limit: safeLimit } });
  } catch (e) { next(e); }
});

router.post('/', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = callReportSchema.parse(req.body);
    const id = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO "call_reports" ("id","customerId","unregisteredName","unregisteredPhone","employeeName","callDate","notes","createdAt","createdById")
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8)`,
      id,
      body.customerId ?? null,
      body.unregisteredName ?? null,
      body.unregisteredPhone ?? null,
      body.employeeName,
      new Date(body.callDate),
      body.notes ?? null,
      req.user!.userId
    );

    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT cr.*, json_build_object('id', c.id, 'name', c.name) as customer
      FROM "call_reports" cr
      LEFT JOIN "customers" c ON cr."customerId" = c.id
      WHERE cr.id = $1
    `, id);
    const report = rows[0];

    const customerLabel = body.customerId
      ? report.customer?.name
      : (body.unregisteredName || 'غير مسجل');

    await writeAudit({
      action: 'CREATE', entityType: 'call_report', entityId: id, userId: req.user!.userId,
      label: `Call report created for '${customerLabel}' by ${body.employeeName}`,
      after: { id, customerId: body.customerId, employeeName: body.employeeName, callDate: body.callDate },
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
    await prisma.$executeRawUnsafe(`DELETE FROM "call_reports"`);
    emitToAll('call_report:deleted', { all: true });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "call_reports" WHERE id = $1`, req.params.id
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    await prisma.$executeRawUnsafe(`DELETE FROM "call_reports" WHERE id = $1`, req.params.id);
    emitToAll('call_report:deleted', { ids: [req.params.id] });
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
