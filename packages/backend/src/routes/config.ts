import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { emitToAll } from '../socket';
import { SOCKET_EVENTS } from '../constants';
import { writeAudit } from '../services/audit.service';
import { emitEvent, EVENT_TYPES } from '../services/event.service';

const router = Router();
router.use(authenticate);

const CODE_KEYS = {
  admin:      'ACCESS_CODE_ADMIN',
  scheduling: 'ACCESS_CODE_SCHEDULING',
  technician: 'ACCESS_CODE_TECHNICIAN',
} as const;

type Dept = keyof typeof CODE_KEYS;

router.get('/access-codes', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const configs = await prisma.systemConfig.findMany({
      where: { key: { in: Object.values(CODE_KEYS) } }
    });
    const m: Record<string, string> = {};
    for (const c of configs) m[c.key] = c.value;

    const result: Record<Dept, string> = {
      admin:      m['ACCESS_CODE_ADMIN']      || process.env.ADMIN_CODE      || '9012',
      scheduling: m['ACCESS_CODE_SCHEDULING'] || process.env.SCHEDULING_CODE || '9013',
      technician: m['ACCESS_CODE_TECHNICIAN'] || process.env.TECHNICIAN_CODE || '9014',
    };
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
});

router.put('/access-codes', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      admin:      z.string().regex(/^\d{4}$/).optional(),
      scheduling: z.string().regex(/^\d{4}$/).optional(),
      technician: z.string().regex(/^\d{4}$/).optional(),
    }).parse(req.body);

    const updated: string[] = [];
    for (const dept of Object.keys(body) as Dept[]) {
      const code = body[dept];
      if (!code) continue;
      const key = CODE_KEYS[dept];
      await prisma.systemConfig.upsert({
        where: { key },
        update: { value: code, updatedBy: req.user!.userId },
        create: { key, value: code, updatedBy: req.user!.userId },
      });
      updated.push(dept);
    }

    if (updated.length > 0) {
      await writeAudit({
        action: 'UPDATE', entityType: 'system_config', entityId: 'access_codes',
        userId: req.user!.userId,
        label: `Access codes updated for departments: ${updated.join(', ')}`,
        after: { updatedDepts: updated },
      });
      await emitEvent({
        type: EVENT_TYPES.USER_UPDATED, entityType: 'system_config', entityId: 'access_codes',
        userId: req.user!.userId, payload: { updatedDepts: updated },
      });
      emitToAll(SOCKET_EVENTS.CONFIG_UPDATED, { type: 'access-codes', updatedDepts: updated });
    }

    res.json({ success: true, data: { updated } });
  } catch (e) { next(e); }
});

export default router;
