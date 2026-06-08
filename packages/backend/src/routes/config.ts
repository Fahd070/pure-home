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

const ENV_FALLBACKS: Record<string, string> = {
  ACCESS_CODE_ADMIN:      process.env.ADMIN_CODE      || '9012',
  ACCESS_CODE_SCHEDULING: process.env.SCHEDULING_CODE || '9013',
  ACCESS_CODE_TECHNICIAN: process.env.TECHNICIAN_CODE || '9014',
};

type Dept = keyof typeof CODE_KEYS;

async function getCurrentCode(dept: Dept): Promise<string> {
  const key = CODE_KEYS[dept];
  const record = await prisma.systemConfig.findUnique({ where: { key } });
  return record?.value || ENV_FALLBACKS[key];
}

router.get('/access-codes', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const configs = await prisma.systemConfig.findMany({
      where: { key: { in: Object.values(CODE_KEYS) } }
    });
    const m: Record<string, string> = {};
    for (const c of configs) m[c.key] = c.value;

    const result: Record<Dept, string> = {
      admin:      m['ACCESS_CODE_ADMIN']      || ENV_FALLBACKS['ACCESS_CODE_ADMIN'],
      scheduling: m['ACCESS_CODE_SCHEDULING'] || ENV_FALLBACKS['ACCESS_CODE_SCHEDULING'],
      technician: m['ACCESS_CODE_TECHNICIAN'] || ENV_FALLBACKS['ACCESS_CODE_TECHNICIAN'],
    };
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
});

router.put('/access-codes', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      dept:        z.enum(['admin', 'scheduling', 'technician']),
      currentCode: z.string().min(1),
      newCode:     z.string().regex(/^\d{4}$/, 'New code must be exactly 4 digits'),
      confirmCode: z.string().regex(/^\d{4}$/, 'Confirm code must be exactly 4 digits'),
    }).parse(req.body);

    if (body.newCode !== body.confirmCode) {
      return res.status(400).json({ success: false, error: 'New code and confirmation do not match' });
    }

    const stored = await getCurrentCode(body.dept);
    if (body.currentCode !== stored) {
      return res.status(400).json({ success: false, error: 'Current code is incorrect' });
    }

    const key = CODE_KEYS[body.dept];
    await prisma.systemConfig.upsert({
      where:  { key },
      update: { value: body.newCode, updatedBy: req.user!.userId },
      create: { key, value: body.newCode, updatedBy: req.user!.userId },
    });

    await writeAudit({
      action: 'UPDATE', entityType: 'system_config', entityId: 'access_codes',
      userId: req.user!.userId,
      label: `Access code changed for department: ${body.dept}`,
      after: { dept: body.dept },
    });

    await emitEvent({
      type: EVENT_TYPES.ACCESS_CODE_UPDATED,
      entityType: 'system_config',
      entityId: 'access_codes',
      userId: req.user!.userId,
      payload: { dept: body.dept },
    });

    emitToAll(SOCKET_EVENTS.CONFIG_UPDATED, { type: 'access-codes', updatedDepts: [body.dept] });

    res.json({ success: true, data: { dept: body.dept } });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: e.errors[0]?.message || 'Validation failed' });
    }
    next(e);
  }
});

export default router;
