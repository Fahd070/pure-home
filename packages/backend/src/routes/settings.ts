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
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "user_settings" WHERE "userId" = $1 LIMIT 1`,
      req.user!.userId
    );
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

    await prisma.$executeRawUnsafe(
      `INSERT INTO "user_settings" (
        "id","userId","theme","fontSize","interfaceScale","background",
        "highContrast","improvedReadability","notificationsEnabled","soundEnabled","soundVolume",
        "primaryColor","secondaryColor","buttonColor","cardColor",
        "updatedAt","createdAt"
       ) VALUES (
        $1,$2,
        COALESCE($3,'light'),COALESCE($4,'medium'),COALESCE($5,'normal'),COALESCE($6,'day'),
        COALESCE($7::boolean,false),COALESCE($8::boolean,false),
        COALESCE($9::boolean,true),COALESCE($10::boolean,true),
        COALESCE($11::integer,70),
        COALESCE($12,'#1E6FFF'),COALESCE($13,'#0F1B2D'),
        COALESCE($14,'#1E6FFF'),COALESCE($15,'#FFFFFF'),
        CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
       )
       ON CONFLICT ("userId") DO UPDATE SET
        "theme"                = COALESCE($3,"user_settings"."theme"),
        "fontSize"             = COALESCE($4,"user_settings"."fontSize"),
        "interfaceScale"       = COALESCE($5,"user_settings"."interfaceScale"),
        "background"           = COALESCE($6,"user_settings"."background"),
        "highContrast"         = COALESCE($7::boolean,"user_settings"."highContrast"),
        "improvedReadability"  = COALESCE($8::boolean,"user_settings"."improvedReadability"),
        "notificationsEnabled" = COALESCE($9::boolean,"user_settings"."notificationsEnabled"),
        "soundEnabled"         = COALESCE($10::boolean,"user_settings"."soundEnabled"),
        "soundVolume"          = COALESCE($11::integer,"user_settings"."soundVolume"),
        "primaryColor"         = COALESCE($12,"user_settings"."primaryColor"),
        "secondaryColor"       = COALESCE($13,"user_settings"."secondaryColor"),
        "buttonColor"          = COALESCE($14,"user_settings"."buttonColor"),
        "cardColor"            = COALESCE($15,"user_settings"."cardColor"),
        "updatedAt"            = CURRENT_TIMESTAMP`,
      id, userId,
      body.theme             ?? null,
      body.fontSize          ?? null,
      body.interfaceScale    ?? null,
      body.background        ?? null,
      body.highContrast      ?? null,
      body.improvedReadability    ?? null,
      body.notificationsEnabled   ?? null,
      body.soundEnabled           ?? null,
      body.soundVolume            ?? null,
      body.primaryColor           ?? null,
      body.secondaryColor         ?? null,
      body.buttonColor            ?? null,
      body.cardColor              ?? null,
    );

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "user_settings" WHERE "userId" = $1 LIMIT 1`, userId
    );
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
