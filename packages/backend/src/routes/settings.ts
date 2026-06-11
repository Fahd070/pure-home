import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { emitToRole } from '../socket';
import { SOCKET_EVENTS } from '../constants';
import { writeAudit } from '../services/audit.service';
import { emitEvent, EVENT_TYPES } from '../services/event.service';

const router = Router();
router.use(authenticate);

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 'medium',
  interfaceScale: 'normal',
  background: 'day',
  highContrast: false,
  improvedReadability: false,
  notificationsEnabled: true,
  soundEnabled: true,
  soundVolume: 70,
  primaryColor: '#1E6FFF',
  secondaryColor: '#0F1B2D',
  buttonColor: '#1E6FFF',
  cardColor: '#FFFFFF',
};

function rowToSettings(row: any) {
  return {
    theme:                row?.theme                ?? 'light',
    fontSize:             row?.fontSize             ?? 'medium',
    interfaceScale:       row?.interfaceScale       ?? 'normal',
    background:           row?.background           ?? 'day',
    highContrast:         row?.highContrast         ?? false,
    improvedReadability:  row?.improvedReadability  ?? false,
    notificationsEnabled: row?.notificationsEnabled ?? true,
    soundEnabled:         row?.soundEnabled         ?? true,
    soundVolume:          typeof row?.soundVolume === 'number' ? row.soundVolume : 70,
    primaryColor:         row?.primaryColor         ?? '#1E6FFF',
    secondaryColor:       row?.secondaryColor       ?? '#0F1B2D',
    buttonColor:          row?.buttonColor          ?? '#1E6FFF',
    cardColor:            row?.cardColor            ?? '#FFFFFF',
  };
}

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.$queryRaw<any[]>`SELECT * FROM "user_settings" WHERE "userId" = ${req.user!.userId} LIMIT 1`;
    res.json({ success: true, data: rowToSettings(rows[0]) });
  } catch {
    res.json({ success: true, data: DEFAULT_SETTINGS });
  }
});

const updateSchema = z.object({
  theme:                z.enum(['light','dark','system']).optional(),
  fontSize:             z.enum(['small','medium','large','xlarge']).optional(),
  interfaceScale:       z.enum(['compact','normal','comfortable']).optional(),
  background:           z.enum(['day','night']).optional(),
  highContrast:         z.boolean().optional(),
  improvedReadability:  z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
  soundEnabled:         z.boolean().optional(),
  soundVolume:          z.number().int().min(0).max(100).optional(),
  primaryColor:         z.string().max(20).optional(),
  secondaryColor:       z.string().max(20).optional(),
  buttonColor:          z.string().max(20).optional(),
  cardColor:            z.string().max(20).optional(),
});

router.put('/', async (req: AuthRequest, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const userId = req.user!.userId;
    const id = randomUUID();

    const theme               = body.theme             ?? null;
    const fontSize            = body.fontSize          ?? null;
    const interfaceScale      = body.interfaceScale    ?? null;
    const background          = body.background        ?? null;
    const highContrast        = body.highContrast      ?? null;
    const improvedReadability = body.improvedReadability    ?? null;
    const notificationsEnabled= body.notificationsEnabled   ?? null;
    const soundEnabled        = body.soundEnabled           ?? null;
    const soundVolume         = body.soundVolume            ?? null;
    const primaryColor        = body.primaryColor           ?? null;
    const secondaryColor      = body.secondaryColor         ?? null;
    const buttonColor         = body.buttonColor            ?? null;
    const cardColor           = body.cardColor              ?? null;

    await prisma.$executeRaw`
      INSERT INTO "user_settings" (
        "id","userId","theme","fontSize","interfaceScale","background",
        "highContrast","improvedReadability","notificationsEnabled","soundEnabled","soundVolume",
        "primaryColor","secondaryColor","buttonColor","cardColor",
        "updatedAt","createdAt"
      ) VALUES (
        ${id},${userId},
        COALESCE(${theme},'light'),COALESCE(${fontSize},'medium'),
        COALESCE(${interfaceScale},'normal'),COALESCE(${background},'day'),
        COALESCE(${highContrast}::boolean,false),COALESCE(${improvedReadability}::boolean,false),
        COALESCE(${notificationsEnabled}::boolean,true),COALESCE(${soundEnabled}::boolean,true),
        COALESCE(${soundVolume}::integer,70),
        COALESCE(${primaryColor},'#1E6FFF'),COALESCE(${secondaryColor},'#0F1B2D'),
        COALESCE(${buttonColor},'#1E6FFF'),COALESCE(${cardColor},'#FFFFFF'),
        CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      )
      ON CONFLICT ("userId") DO UPDATE SET
        "theme"                = COALESCE(${theme},"user_settings"."theme"),
        "fontSize"             = COALESCE(${fontSize},"user_settings"."fontSize"),
        "interfaceScale"       = COALESCE(${interfaceScale},"user_settings"."interfaceScale"),
        "background"           = COALESCE(${background},"user_settings"."background"),
        "highContrast"         = COALESCE(${highContrast}::boolean,"user_settings"."highContrast"),
        "improvedReadability"  = COALESCE(${improvedReadability}::boolean,"user_settings"."improvedReadability"),
        "notificationsEnabled" = COALESCE(${notificationsEnabled}::boolean,"user_settings"."notificationsEnabled"),
        "soundEnabled"         = COALESCE(${soundEnabled}::boolean,"user_settings"."soundEnabled"),
        "soundVolume"          = COALESCE(${soundVolume}::integer,"user_settings"."soundVolume"),
        "primaryColor"         = COALESCE(${primaryColor},"user_settings"."primaryColor"),
        "secondaryColor"       = COALESCE(${secondaryColor},"user_settings"."secondaryColor"),
        "buttonColor"          = COALESCE(${buttonColor},"user_settings"."buttonColor"),
        "cardColor"            = COALESCE(${cardColor},"user_settings"."cardColor"),
        "updatedAt"            = CURRENT_TIMESTAMP
    `;

    const rows = await prisma.$queryRaw<any[]>`SELECT * FROM "user_settings" WHERE "userId" = ${userId} LIMIT 1`;
    const settings = rowToSettings(rows[0]);

    emitToRole(req.user!.role, SOCKET_EVENTS.SETTINGS_UPDATED, settings);

    await writeAudit({
      action: 'UPDATE', entityType: 'user_settings', entityId: userId,
      userId, label: 'User settings updated', after: body,
    });
    await emitEvent({
      type: EVENT_TYPES.SETTINGS_UPDATED, entityType: 'user_settings', entityId: userId,
      userId, payload: body,
    });

    res.json({ success: true, data: settings });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ success: false, error: e.errors[0]?.message });
    next(e);
  }
});

export default router;
