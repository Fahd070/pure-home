import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';
import { resolveAccessCode, type Dept } from '../services/accessCode.service';
import { resolveTechnicianByAccessCode, shouldRefuseSharedTechnicianCode, sharedTechnicianEmail } from '../services/technicianIdentity.service';

const router = Router();
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const codeLoginSchema = z.object({
  code: z.string().regex(/^\d{4}$/),
  dept: z.enum(['admin', 'scheduling', 'technician']),
});

/**
 * The ONE place a session token is minted.
 *
 * Every token carries `sv`, the account's sessionVersion at the moment of login
 * (v4 decision D9). middleware/auth.ts compares it on every request, so bumping
 * the stored value revokes every token issued before the bump. Centralised so a
 * future login path cannot forget the claim and silently mint an unrevocable
 * token.
 */
function issueToken(user: { id: string; role: string; sessionVersion: number }): string {
  return jwt.sign(
    { userId: user.id, role: user.role, sv: user.sessionVersion },
    process.env.JWT_SECRET!,
    { expiresIn: '8h' }
  );
}

const DEPT_ROLE: Record<string, string> = {
  admin: 'ADMIN', scheduling: 'SCHEDULING', technician: 'TECHNICIAN',
};

router.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Security hygiene fix: a disabled user must not be able to start a new
    // session. bcrypt.compare still runs whenever a user row exists (active or
    // not) before this check is consulted, so a disabled account's login
    // attempt takes the same time as a wrong-password attempt against an
    // active account -- this deliberately avoids a timing side-channel that
    // would otherwise let a caller distinguish "disabled" from "wrong
    // password" by response latency. Same generic message/401 either way, so
    // account existence/status is never revealed.
    // v4 decision D9: this is no longer only a NEW-login check. An already-issued
    // token is now rejected too, because middleware/auth.ts re-checks isActive
    // and sessionVersion on every request.
    const passwordValid = user ? await bcrypt.compare(body.password, user.password) : false;
    if (!user || !passwordValid || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const token = issueToken(user);
    res.json({ success: true, data: { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } } });
  } catch (e) { next(e); }
});

router.post('/code-login', async (req, res, next) => {
  try {
    const { code, dept } = codeLoginSchema.parse(req.body);

    // v4 Requirement #12: a technician's PERSONAL access code identifies exactly
    // which technician is logging in. Tried first, before the shared department
    // code, so that once a technician has a personal code it is what determines
    // their identity.
    //
    // Backward compatibility is the whole reason this is a fall-through rather
    // than a replacement: employees remain on Desktop v3.6.5 during this
    // development cycle, and their client posts the same { code, dept } body it
    // always has. If no technician has a personal code yet -- or the submitted
    // code is the old shared one -- resolution returns null here and the
    // original shared-code path below runs completely unchanged. There is no
    // flag day.
    if (dept === 'technician') {
      const technician = await resolveTechnicianByAccessCode(code);
      if (technician) {
        const token = issueToken(technician);

        // Same fire-and-forget audit as the shared-code path below: login must
        // never be slowed or blocked by the audit write.
        prisma.auditLog.create({
          data: {
            action: `Login: ${technician.name} (${technician.role})`,
            entityType: 'auth',
            entityId: technician.id,
            userId: technician.id,
          },
        }).catch((e) => {
          console.error(`[audit] Failed to write login audit entry for role ${technician.role}:`, e?.message);
        });

        return res.json({
          success: true,
          data: { token, user: { id: technician.id, name: technician.name, email: technician.email, role: technician.role } },
        });
      }
      // Deliberately falls through rather than returning 401 here: a wrong
      // personal code and a valid legacy shared code are indistinguishable at
      // this point, and only the shared-code check below can tell them apart.

      // ...but once EVERY active individual technician has a personal code, the
      // shared code is retired -- PERMANENTLY and irreversibly. Leaving it live
      // would be a backdoor into the old ambiguous shared account: anyone
      // holding the department code could still act as the generic legacy
      // technician, and every action they took would be attributed to nobody.
      //
      // Two properties matter here, and both live in
      // shouldRefuseSharedTechnicianCode():
      //   1. Cutover is "all configured", not "any configured", so the shared
      //      code keeps working right through partial setup and Administration
      //      can configure technicians one at a time without locking out those
      //      not yet done.
      //   2. Cutover is ONE-WAY. It is recorded durably, so later roster changes
      //      -- a new technician with no code yet, a deactivation, a
      //      reactivation, a credential reset -- can never bring the shared
      //      login back. The fix for a technician without a working code is
      //      always to set their personal code, never to fall back to the
      //      shared identity.
      //
      // Safe for employees on Desktop v3.6.5: their client posts exactly the
      // same { code, dept } body, so a personal code works on the existing
      // code-entry screen with no client change at all.
      if (await shouldRefuseSharedTechnicianCode()) {
        return res.status(401).json({ success: false, message: 'Invalid code' });
      }
    }

    const expectedCode = await resolveAccessCode(dept as Dept);

    if (!expectedCode) {
      return res.status(503).json({
        success: false,
        error: 'NOT_CONFIGURED',
        message: 'This department has no access code configured. Contact an administrator.',
      });
    }

    if (code !== expectedCode) {
      return res.status(401).json({ success: false, message: 'Invalid code' });
    }
    const codeRole = DEPT_ROLE[dept];

    // A disabled user must never be selected by the department code-login flow.
    // Already-issued tokens are separately revoked -- see middleware/auth.ts.
    const where: any = { role: codeRole as any, isActive: true };
    // The single definition of "the shared technician identity" lives in
    // technicianIdentity.service.ts, so this path and the retirement rule above
    // can never disagree about which account that is.
    if (codeRole === 'TECHNICIAN') where.email = sharedTechnicianEmail();

    const user = await prisma.user.findFirst({ where });
    if (!user) return res.status(403).json({ success: false, message: 'User not found' });

    const token = issueToken(user);

    // Fire-and-forget: login must never be slowed or blocked by the audit write.
    // The catch here only adds observability (a failed audit write should be
    // visible in server logs, never silently lost) -- login itself is unaffected.
    prisma.auditLog.create({
      data: { action: `Login: ${user.name} (${user.role})`, entityType: 'auth', entityId: user.id, userId: user.id }
    }).catch((e) => {
      console.error(`[audit] Failed to write login audit entry for role ${user.role}:`, e?.message);
    });

    res.json({ success: true, data: { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } } });
  } catch (e) { next(e); }
});

export default router;
