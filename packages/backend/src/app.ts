import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import authRoutes from './routes/auth';
import customerRoutes from './routes/customers';
import appointmentRoutes from './routes/appointments';
import technicianRoutes from './routes/technicians';
import notificationRoutes from './routes/notifications';
import messageRoutes from './routes/messages';
import dashboardRoutes from './routes/dashboard';
import directMessageRoutes from './routes/direct-messages';
import reportRoutes from './routes/reports';
import configRoutes from './routes/config';
import settingsRoutes from './routes/settings';
import callReportRoutes from './routes/call-reports';
import expenseRoutes from './routes/expenses';
import urgentVisitRoutes from './routes/urgent-visits';
import employeeRoutes from './routes/employees';
import { errorHandler } from './middleware/errorHandler';
import prisma from './prisma';

// Allow: Electron desktop app (no Origin header), localhost dev, private LAN, Tailscale CGNAT.
// Render cloud: Electron sends no Origin header so it always passes. JWT is the auth gate.
const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;                                                      // Electron file:// → no origin
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;               // local dev
  if (/^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;   // RFC 1918 /8
  if (/^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true; // RFC 1918 /12
  if (/^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;      // RFC 1918 /16
  // Tailscale CGNAT range: 100.64.0.0/10 (100.64.x.x – 100.127.x.x)
  if (/^https?:\/\/100\.(6[4-9]|[789]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;
  // Web deployment: comma-separated list in ALLOWED_ORIGINS env var
  // e.g. ALLOWED_ORIGINS=https://portal.purehome.sa,https://purehome.vercel.app
  const extra = process.env.ALLOWED_ORIGINS || '';
  if (extra) {
    for (const allowed of extra.split(',')) {
      if (allowed.trim() === origin) return true;
    }
  }
  return false;
};

const app = express();
// Render terminates TLS at its own load balancer and forwards requests to this
// service over HTTP through exactly one proxy hop, setting X-Forwarded-For/
// X-Forwarded-Proto. Trusting exactly 1 hop (not `true`) means Express reads
// the client IP from the right-most-but-one entry in X-Forwarded-For -- the
// address Render's own proxy appended -- and ignores any further-left entries
// a client could forge, which is what express-rate-limit relies on for req.ip.
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error('CORS: origin not allowed')),
}));
app.use(express.json({ limit: '5mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

// The limiter stores are constructed explicitly and exported ONLY so the test
// suite can reset counters between test files. Production behaviour, windows and
// limits are completely unchanged by this -- nothing calls resetAll() at runtime.
// Without it, a test file that legitimately exercises repeated failed logins
// would poison every later file on the same IP.
export const authLimiterStore = new MemoryStore();
export const technicianCodeLimiterStore = new MemoryStore();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, store: authLimiterStore, message: { success: false, message: 'Too many attempts, try again later' } });

// v4 decision D8: technician access codes stay 4 digits by deliberate
// operational choice, which is only a 10,000-value space. The generic 50/15min
// auth limiter is far too permissive against that: an attacker gets 50 guesses
// per window per IP, and with several technicians each holding a distinct valid
// code the chance of hitting SOME valid code is meaningfully higher than
// guessing one specific credential.
//
// This is a second, tighter limiter layered on top -- it never replaces or
// loosens the existing one.
//
// Scoped by `skip` rather than by a custom keyGenerator on purpose. The limiter
// therefore only ever observes technician code-login attempts, so its ordinary
// per-IP counter IS "per IP per technician department" without hand-rolling a
// key (which in express-rate-limit v7 would also need explicit IPv6
// normalisation to be correct). Administration and Scheduling code-login are
// completely untouched and keep their existing budget.
//
// `skipSuccessfulRequests` means a technician signing in normally never consumes
// budget -- only FAILURES count, so a legitimately busy shift cannot lock the
// team out.
//
// Deliberately per-IP and time-boxed rather than a per-account lockout: locking
// an account after N failures would let anyone who knows a technician exists
// deny them access at will, turning a brute-force defence into a denial-of-service
// tool. The window simply expires.
const technicianCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  store: technicianCodeLimiterStore,
  skipSuccessfulRequests: true,
  skip: (req) => (req.body as any)?.dept !== 'technician',
  // Same generic wording and shape as every other rejected attempt, so a caller
  // cannot learn anything about whether a code was close, valid, or belongs to
  // an inactive account.
  message: { success: false, message: 'Too many attempts, try again later' },
});

// Health check — no auth required, used by monitoring and client connectivity tests
app.get('/health', async (_req, res) => {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const dbMs = Date.now() - t0;
    res.json({
      status: 'ok',
      database: 'connected',
      dbResponseMs: dbMs,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(503).json({
      status: 'degraded',
      database: 'disconnected',
      error: process.env.NODE_ENV === 'production' ? 'DB unreachable' : e?.message,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  }
});

app.use('/api/auth', authLimiter, technicianCodeLimiter, authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/technicians', technicianRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/direct-messages', directMessageRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/config', configRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/call-reports', callReportRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/urgent-visits', urgentVisitRoutes);
app.use('/api/employees', employeeRoutes);
app.use(errorHandler);
export default app;
