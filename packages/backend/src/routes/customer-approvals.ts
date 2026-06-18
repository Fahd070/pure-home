import { Router } from 'express';
import { randomUUID } from 'crypto';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToRole } from '../socket';
import { SOCKET_ROOMS, SOCKET_EVENTS } from '../constants';
import { writeAudit } from '../services/audit.service';

const router = Router();
router.use(authenticate);

router.get('/', requireRole('ADMIN'), async (_req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT car.id, car.status, car."requestData", car."creatorId", car."createdAt",
             u.name as "creatorName"
      FROM "customer_approval_requests" car
      LEFT JOIN "users" u ON car."creatorId" = u.id
      WHERE car.status = 'PENDING'
      ORDER BY car."createdAt" DESC
    `);
    res.json({ success: true, data: rows });
  } catch (e) { next(e); }
});

router.get('/count', requireRole('ADMIN'), async (_req, res, next) => {
  try {
    const result = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int as count FROM "customer_approval_requests" WHERE status = 'PENDING'`
    );
    res.json({ success: true, data: { count: Number(result[0]?.count || 0) } });
  } catch (e) { next(e); }
});

router.post('/', requireRole('ADMIN', 'SCHEDULING'), async (req: AuthRequest, res, next) => {
  try {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "customer_approval_requests" ("id","status","requestData","creatorId","createdAt","updatedAt")
       VALUES ($1,'PENDING',$2::jsonb,$3,NOW(),NOW())`,
      id, JSON.stringify(req.body), req.user!.userId
    );
    emitToRole(SOCKET_ROOMS.ADMIN, 'customer_approval:new', { id, requestData: req.body, creatorId: req.user!.userId });
    res.status(201).json({ success: true, data: { id } });
  } catch (e) { next(e); }
});

router.post('/:id/approve', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "customer_approval_requests" WHERE id = $1 AND status = 'PENDING'`,
      req.params.id
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

    const item = rows[0];
    const data = typeof item.requestData === 'string' ? JSON.parse(item.requestData) : item.requestData;
    const { address, installationDate, maintenanceDate: _md, nextMaintenanceDate: _nmd, ...customerRest } = data;

    const customer = await prisma.customer.create({
      data: {
        ...customerRest,
        installationDate: installationDate ? new Date(installationDate) : undefined,
        createdById: item.creatorId,
        ...(address ? { address: { create: address } } : {}),
      },
      include: { address: true },
    });

    await prisma.$executeRawUnsafe(
      `UPDATE "customer_approval_requests" SET status = 'APPROVED', "updatedAt" = NOW() WHERE id = $1`,
      req.params.id
    );

    await writeAudit({
      action: 'CREATE', entityType: 'customer', entityId: customer.id, userId: req.user!.userId,
      label: `Customer '${customer.name}' approved from scheduling request`,
      labelAr: `تمت الموافقة على إنشاء العميل '${customer.name}' بناءً على طلب الجدولة`,
      after: { id: customer.id, name: customer.name, phone: customer.phone },
    });

    emitToRole(SOCKET_ROOMS.ADMIN, SOCKET_EVENTS.CUSTOMER_CREATED, customer);
    emitToRole(SOCKET_ROOMS.SCHEDULING, SOCKET_EVENTS.CUSTOMER_CREATED, customer);
    emitToRole(SOCKET_ROOMS.ADMIN, 'customer_approval:resolved', { id: req.params.id, action: 'approved' });
    emitToRole(SOCKET_ROOMS.SCHEDULING, 'customer_approval:resolved', { id: req.params.id, action: 'approved' });

    res.json({ success: true, data: customer });
  } catch (e) { next(e); }
});

router.post('/:id/reject', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "customer_approval_requests" WHERE id = $1 AND status = 'PENDING'`,
      req.params.id
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

    await prisma.$executeRawUnsafe(
      `UPDATE "customer_approval_requests" SET status = 'REJECTED', "updatedAt" = NOW() WHERE id = $1`,
      req.params.id
    );

    await writeAudit({
      action: 'DELETE', entityType: 'customer_approval_request', entityId: req.params.id,
      userId: req.user!.userId,
      label: 'Customer approval request rejected',
      labelAr: 'تم رفض طلب إضافة عميل جديد من قسم الجدولة',
    });

    emitToRole(SOCKET_ROOMS.ADMIN, 'customer_approval:resolved', { id: req.params.id, action: 'rejected' });
    emitToRole(SOCKET_ROOMS.SCHEDULING, 'customer_approval:resolved', { id: req.params.id, action: 'rejected' });

    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
