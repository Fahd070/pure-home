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
    if (!user || !await bcrypt.compare(body.password, user.password)) {
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

    const where: any = { role: codeRole as any };
    if (codeRole === 'TECHNICIAN') where.email = process.env.TECHNICIAN_EMAIL || 'tech1@wfm.local';

    const user = await prisma.user.findFirst({ where });
    if (!user) return res.status(403).json({ success: false, message: 'User not found' });

    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '8h' });

    prisma.auditLog.create({
      data: { action: `Login: ${user.name} (${user.role})`, entityType: 'auth', entityId: user.id, userId: user.id }
    }).catch(() => {});

    res.json({ success: true, data: { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } } });
  } catch (e) { next(e); }
});

export default router;
