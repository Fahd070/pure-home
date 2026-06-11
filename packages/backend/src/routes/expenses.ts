import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToRole } from '../socket';
import { SOCKET_ROOMS } from '../constants';
import { writeAudit } from '../services/audit.service';

const router = Router();
router.use(authenticate);

const expenseSchema = z.object({
  amount:       z.number().positive(),
  category:     z.string().min(1).max(100),
  description:  z.string().max(1000).optional(),
  date:         z.string().refine(v => !isNaN(Date.parse(v))),
  receiptImage: z.string().max(500000).optional(), // base64 image
});

router.get('/', requireRole('ADMIN', 'TECHNICIAN'), async (req: AuthRequest, res, next) => {
  try {
    const { technicianId, from, to, page = '1', limit = '50' } = req.query as any;
    const safeLimit = Math.min(parseInt(limit) || 50, 5000);
    const where: any = {};
    // Technicians only see their own
    if (req.user!.role === 'TECHNICIAN') {
      where.technicianId = req.user!.userId;
    } else if (technicianId) {
      where.technicianId = technicianId;
    }
    if (from) where.date = { ...where.date, gte: new Date(from) };
    if (to)   where.date = { ...where.date, lte: new Date(to + 'T23:59:59') };

    const total = await prisma.expense.count({ where });
    const expenses = await prisma.expense.findMany({
      where,
      include: { technician: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
      skip: (parseInt(page) - 1) * safeLimit,
      take: safeLimit,
    });
    // Summary for admin
    const totalAmount = expenses.reduce((s, e) => s + e.amount, 0);
    res.json({ success: true, data: expenses, meta: { total, page: parseInt(page), limit: safeLimit, totalAmount } });
  } catch (e) { next(e); }
});

router.post('/', requireRole('TECHNICIAN'), async (req: AuthRequest, res, next) => {
  try {
    const body = expenseSchema.parse(req.body);
    const expense = await prisma.expense.create({
      data: {
        amount:       body.amount,
        category:     body.category,
        description:  body.description,
        date:         new Date(body.date),
        receiptImage: body.receiptImage,
        technicianId: req.user!.userId,
      },
      include: { technician: { select: { id: true, name: true } } },
    });
    await writeAudit({
      action: 'CREATE', entityType: 'expense', entityId: expense.id, userId: req.user!.userId,
      label: `Expense submitted: ${body.category} — ${body.amount} SAR by ${expense.technician.name}`,
      after: { id: expense.id, amount: expense.amount, category: expense.category, date: expense.date },
    });
    emitToRole(SOCKET_ROOMS.ADMIN, 'expense:new', expense);
    res.status(201).json({ success: true, data: expense });
  } catch (e) { next(e); }
});

router.patch('/:id/status', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(['PENDING','APPROVED','REJECTED']) }).parse(req.body);
    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: { status },
      include: { technician: { select: { id: true, name: true } } },
    });
    res.json({ success: true, data: expense });
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.patch('/:id/mark-invoice', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: { invoiceGenerated: true },
      include: { technician: { select: { id: true, name: true } } },
    });
    res.json({ success: true, data: expense });
  } catch (e) { next(e); }
});

export default router;
