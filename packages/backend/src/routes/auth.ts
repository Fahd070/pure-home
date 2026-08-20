import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';
import { resolveAccessCode, type Dept } from '../services/accessCode.service';

const router = Router();
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const codeLoginSchema = z.object({
  code: z.string().regex(/^\d{4}$/),
  dept: z.enum(['admin', 'scheduling', 'technician']),
});

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
    // Known accepted limitation: this only blocks NEW logins. A JWT already
    // issued before a user is deactivated remains valid until its normal 8h
    // expiry -- see middleware/auth.ts, which verifies the token signature
    // only and does not re-query the user on every request.
    const passwordValid = user ? await bcrypt.compare(body.password, user.password) : false;
    if (!user || !passwordValid || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '8h' });
    res.json({ success: true, data: { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } } });
  } catch (e) { next(e); }
});

router.post('/code-login', async (req, res, next) => {
  try {
    const { code, dept } = codeLoginSchema.parse(req.body);

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

    // Security hygiene fix: a disabled user must never be selected by the
    // department code-login flow. Same known accepted limitation as email
    // login above -- a JWT already issued before deactivation stays valid
    // until its normal 8h expiry.
    const where: any = { role: codeRole as any, isActive: true };
    if (codeRole === 'TECHNICIAN') where.email = process.env.TECHNICIAN_EMAIL || 'tech1@wfm.local';

    const user = await prisma.user.findFirst({ where });
    if (!user) return res.status(403).json({ success: false, message: 'User not found' });

    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '8h' });

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
