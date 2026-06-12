import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { emitToRole } from '../socket';
import { SOCKET_EVENTS } from '../constants';

const router = Router();
router.use(authenticate);

const include = { sender: { select: { id: true, name: true, role: true } } };

router.get('/inbox', async (req: AuthRequest, res, next) => {
  try {
    const msgs = await prisma.directMessage.findMany({
      where: { recipientRole: req.user!.role },
      include, orderBy: { createdAt: 'desc' }, take: 100
    });
    res.json({ success: true, data: msgs });
  } catch (e) { next(e); }
});

router.get('/sent', async (req: AuthRequest, res, next) => {
  try {
    const msgs = await prisma.directMessage.findMany({
      where: { senderId: req.user!.userId },
      include, orderBy: { createdAt: 'desc' }, take: 100
    });
    res.json({ success: true, data: msgs });
  } catch (e) { next(e); }
});

router.get('/conversations', async (req: AuthRequest, res, next) => {
  try {
    const myRole = req.user!.role;
    const myUserId = req.user!.userId;

    const [inbox, sent] = await Promise.all([
      prisma.directMessage.findMany({ where: { recipientRole: myRole }, include, orderBy: { createdAt: 'desc' }, take: 200 }),
      prisma.directMessage.findMany({ where: { senderId: myUserId }, include, orderBy: { createdAt: 'desc' }, take: 200 })
    ]);

    const convMap: Record<string, any[]> = {};

    for (const msg of inbox) {
      const otherRole = (msg.sender as any).role;
      if (!convMap[otherRole]) convMap[otherRole] = [];
      convMap[otherRole].push({ ...msg, direction: 'received' });
    }
    for (const msg of sent) {
      const otherRole = msg.recipientRole;
      if (otherRole === myRole) continue;
      if (!convMap[otherRole]) convMap[otherRole] = [];
      convMap[otherRole].push({ ...msg, direction: 'sent' });
    }

    const conversations = Object.entries(convMap).map(([otherRole, messages]) => {
      const sorted = messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const unreadCount = sorted.filter((m: any) => m.direction === 'received' && !m.isRead).length;
      return { otherRole, messages: sorted, unreadCount, lastMessage: sorted[sorted.length - 1] };
    }).sort((a, b) => new Date((b.lastMessage as any).createdAt).getTime() - new Date((a.lastMessage as any).createdAt).getTime());

    res.json({ success: true, data: conversations });
  } catch (e) { next(e); }
});

router.get('/unread-count', async (req: AuthRequest, res, next) => {
  try {
    const count = await prisma.directMessage.count({
      where: { recipientRole: req.user!.role, isRead: false }
    });
    res.json({ success: true, data: count });
  } catch (e) { next(e); }
});

router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const { content, recipientRole } = z.object({
      content: z.string().min(1).max(5000),
      recipientRole: z.enum(['ADMIN', 'SCHEDULING', 'TECHNICIAN'])
    }).parse(req.body);
    const msg = await prisma.directMessage.create({
      data: { content, senderId: req.user!.userId, recipientRole },
      include
    });
    emitToRole(recipientRole, SOCKET_EVENTS.DM_NEW, msg);
    res.status(201).json({ success: true, data: msg });
  } catch (e) { next(e); }
});

router.patch('/:id/read', async (req: AuthRequest, res, next) => {
  try {
    const existing = await prisma.directMessage.findFirst({ where: { id: req.params.id, recipientRole: req.user!.role } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    const msg = await prisma.directMessage.update({ where: { id: req.params.id }, data: { isRead: true }, include });
    res.json({ success: true, data: msg });
  } catch (e) { next(e); }
});

const VALID_ROLES = ['ADMIN', 'SCHEDULING', 'TECHNICIAN'] as const;

router.delete('/conversation/:otherRole', async (req: AuthRequest, res, next) => {
  try {
    const myRole = req.user!.role;
    const otherRole = req.params.otherRole;
    if (!(VALID_ROLES as readonly string[]).includes(otherRole)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    await prisma.directMessage.deleteMany({
      where: { senderId: req.user!.userId, recipientRole: otherRole }
    });

    const toDelete = await prisma.directMessage.findMany({
      where: { recipientRole: myRole as any, sender: { role: otherRole as any } },
      select: { id: true }
    });
    if (toDelete.length > 0) {
      await prisma.directMessage.deleteMany({ where: { id: { in: toDelete.map((m: any) => m.id) } } });
    }

    emitToRole(myRole, SOCKET_EVENTS.DM_DELETED, { conversationWith: otherRole });
    emitToRole(otherRole, SOCKET_EVENTS.DM_DELETED, { conversationWith: myRole });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.delete('/all', async (req: AuthRequest, res, next) => {
  try {
    const myRole = req.user!.role;

    await prisma.directMessage.deleteMany({ where: { senderId: req.user!.userId } });

    const toDelete = await prisma.directMessage.findMany({
      where: { recipientRole: myRole },
      select: { id: true }
    });
    if (toDelete.length > 0) {
      await prisma.directMessage.deleteMany({ where: { id: { in: toDelete.map((m: any) => m.id) } } });
    }

    emitToRole(myRole, SOCKET_EVENTS.DM_DELETED, { all: true });
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
