import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
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

function envFallback(dept: Dept): string {
  if (dept === 'admin')      return process.env.ADMIN_CODE      || '9012';
  if (dept === 'scheduling') return process.env.SCHEDULING_CODE || '9013';
  return                            process.env.TECHNICIAN_CODE  || '9014';
}

async function getStoredCode(dept: Dept): Promise<string> {
  try {
    const key = CODE_KEYS[dept];
    const record = await prisma.systemConfig.findUnique({ where: { key } });
    return record?.value || envFallback(dept);
  } catch {
    return envFallback(dept);
  }
}

async function upsertCode(dept: Dept, newCode: string, userId: string): Promise<void> {
  const key = CODE_KEYS[dept];
  const now = new Date();
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "system_configs" ("id","key","value","updatedBy","updatedAt","createdAt")
     VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT ("key") DO UPDATE SET "value"=$3,"updatedBy"=$4,"updatedAt"=$5`,
    id, key, newCode, userId, now
  );
}

router.get('/access-codes', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const [admin, scheduling, technician] = await Promise.all([
      getStoredCode('admin'),
      getStoredCode('scheduling'),
      getStoredCode('technician'),
    ]);
    res.json({ success: true, data: { admin, scheduling, technician } });
  } catch (e) { next(e); }
});

router.put('/access-codes', requireRole('ADMIN'), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      dept:        z.enum(['admin', 'scheduling', 'technician']),
      currentCode: z.string().min(1, 'Current code is required'),
      newCode:     z.string().regex(/^\d{4}$/, 'New code must be exactly 4 digits'),
      confirmCode: z.string().regex(/^\d{4}$/, 'Confirm code must be exactly 4 digits'),
    }).parse(req.body);

    if (body.newCode !== body.confirmCode) {
      return res.status(400).json({ success: false, error: 'MISMATCH', message: 'New code and confirmation do not match' });
    }

    const stored = await getStoredCode(body.dept);

    if (body.currentCode !== stored) {
      return res.status(400).json({ success: false, error: 'WRONG_CURRENT', message: 'Current code is incorrect' });
    }

    await upsertCode(body.dept, body.newCode, req.user!.userId);

    await writeAudit({
      action: 'UPDATE', entityType: 'system_config', entityId: 'access_codes',
      userId: req.user!.userId,
      label: `Access code changed for department: ${body.dept}`,
      after: { dept: body.dept },
    });

    await emitEvent({
      type: EVENT_TYPES.ACCESS_CODE_UPDATED,
      entityType: 'system_config', entityId: 'access_codes',
      userId: req.user!.userId,
      payload: { dept: body.dept },
    });

    emitToAll(SOCKET_EVENTS.CONFIG_UPDATED, { type: 'access-codes', updatedDepts: [body.dept] });

    res.json({ success: true, data: { dept: body.dept } });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'VALIDATION', message: e.errors[0]?.message || 'Validation failed' });
    }
    next(e);
  }
});

export default router;
