import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToRoles } from '../socket';
import { SOCKET_ROOMS } from '../constants';
import { writeAudit } from '../services/audit.service';
import {
  bulkDeleteAllSchema,
  bulkDeleteByIdsSchema,
  StaleCountError,
  sendStaleCountConflict,
  isTransactionConflict,
  sendTransactionConflict,
} from '../services/bulkDelete.service';

// Well above the largest page this UI ever loads (call-reports lists are fetched
// with limit: 200), while still bounding a malformed/crafted request.
const MAX_BULK_DELETE_IDS = 500;

// Call reports contain customer name/phone/notes -- no technician UI subscribes to
// these events, matching the permission baseline ("must not receive full customer
// lists"/private customer data).
const CALL_REPORT_ROOMS = [SOCKET_ROOMS.ADMIN, SOCKET_ROOMS.SCHEDULING];

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

    emitToRoles(CALL_REPORT_ROOMS, 'call_report:new', report);
    res.status(201).json({ success: true, data: report });
  } catch (e) { next(e); }
});

// Explicit, bounded ID list. expectedCount must match the de-duplicated ID count --
// duplicates in the submitted list can never inflate or confuse what's expected.
router.delete('/bulk', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const body = bulkDeleteByIdsSchema(MAX_BULK_DELETE_IDS).parse(req.body);
    const uniqueIds = Array.from(new Set(body.ids));
    if (uniqueIds.length !== body.expectedCount) {
      return sendStaleCountConflict(res, new StaleCountError(uniqueIds.length, body.expectedCount));
    }

    const outcome = await prisma.$transaction(
      async (tx) => {
        const toDelete = await tx.callReport.findMany({ where: { id: { in: uniqueIds } }, select: { id: true } });
        const result = await tx.callReport.deleteMany({ where: { id: { in: uniqueIds } } });
        if (result.count !== uniqueIds.length) {
          // Some of the submitted IDs no longer matched a real row -- roll back
          // rather than silently deleting a partial, unreviewed subset.
          throw new StaleCountError(result.count, uniqueIds.length);
        }
        return { deletedCount: result.count, ids: toDelete.map((r) => r.id) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    await writeAudit({
      action: 'DELETE', entityType: 'call_report', entityId: 'bulk',
      userId: req.user!.userId,
      label: `Bulk delete: ${outcome.deletedCount} call reports deleted`,
      labelAr: `حذف جماعي: تم حذف ${outcome.deletedCount} تقرير مكالمة`,
      before: { count: outcome.deletedCount, ids: outcome.ids },
    });
    emitToRoles(CALL_REPORT_ROOMS, 'call_report:deleted', { ids: outcome.ids });
    res.json({ success: true, data: { deletedCount: outcome.deletedCount } });
  } catch (e) {
    if (e instanceof StaleCountError) return sendStaleCountConflict(res, e);
    if (isTransactionConflict(e)) return sendTransactionConflict(res);
    next(e);
  }
});

// CRITICAL: deletes every call report in the system. ADMIN or SCHEDULING (an existing,
// consistently-applied business rule across this entire route file), confirm:true, and
// an expectedCount checked against the real count inside the same transaction as the
// delete.
router.delete('/all', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const { expectedCount } = bulkDeleteAllSchema.parse(req.body);

    const outcome = await prisma.$transaction(
      async (tx) => {
        const actualCount = await tx.callReport.count();
        if (actualCount !== expectedCount) {
          throw new StaleCountError(actualCount, expectedCount);
        }
        if (actualCount === 0) return { deletedCount: 0 };
        const result = await tx.callReport.deleteMany();
        return { deletedCount: result.count };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if (outcome.deletedCount > 0) {
      await writeAudit({
        action: 'DELETE', entityType: 'call_report', entityId: 'all',
        userId: req.user!.userId,
        label: `All call reports deleted (${outcome.deletedCount} records)`,
        labelAr: `تم حذف جميع تقارير المكالمات (${outcome.deletedCount} سجل)`,
        before: { count: outcome.deletedCount },
      });
      emitToRoles(CALL_REPORT_ROOMS, 'call_report:deleted', { all: true });
    }
    res.json({ success: true, data: { deletedCount: outcome.deletedCount } });
  } catch (e) {
    if (e instanceof StaleCountError) return sendStaleCountConflict(res, e);
    if (isTransactionConflict(e)) return sendTransactionConflict(res);
    next(e);
  }
});

router.delete('/:id', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "call_reports" WHERE id = $1`, req.params.id
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    await prisma.$executeRawUnsafe(`DELETE FROM "call_reports" WHERE id = $1`, req.params.id);
    emitToRoles(CALL_REPORT_ROOMS, 'call_report:deleted', { ids: [req.params.id] });
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
