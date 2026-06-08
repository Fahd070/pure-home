import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';

const router = Router();
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const codeLoginSchema = z.object({
  code: z.string().regex(/^\d{4}$/),
  dept: z.enum(['admin', 'scheduling', 'technician']),
});

const DEPT_ROLE: Record<string, string> = {
  admin: 'ADMIN', scheduling: 'SCHEDULING', technician: 'TECHNICIAN',
};

async function getAccessCodes(): Promise<{ admin: string; scheduling: string; technician: string }> {
  try {
    const configs = await prisma.systemConfig.findMany({
      where: { key: { in: ['ACCESS_CODE_ADMIN', 'ACCESS_CODE_SCHEDULING', 'ACCESS_CODE_TECHNICIAN'] } }
    });
    const m: Record<string, string> = {};
    for (const c of configs) m[c.key] = c.value;
    return {
      admin:      m['ACCESS_CODE_ADMIN']      || process.env.ADMIN_CODE      || '9012',
      scheduling: m['ACCESS_CODE_SCHEDULING'] || process.env.SCHEDULING_CODE || '9013',
      technician: m['ACCESS_CODE_TECHNICIAN'] || process.env.TECHNICIAN_CODE || '9014',
    };
  } catch {
    return {
      admin:      process.env.ADMIN_CODE      || '9012',
      scheduling: process.env.SCHEDULING_CODE || '9013',
      technician: process.env.TECHNICIAN_CODE || '9014',
    };
  }
}

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

    const codes = await getAccessCodes();
    const codeMap: Record<string, string> = {
      [codes.admin]:      'ADMIN',
      [codes.scheduling]: 'SCHEDULING',
      [codes.technician]: 'TECHNICIAN',
    };

    const codeRole = codeMap[code];
    const expectedRole = DEPT_ROLE[dept];

    if (!codeRole || codeRole !== expectedRole) {
      return res.status(401).json({ success: false, message: 'Invalid code' });
    }

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
