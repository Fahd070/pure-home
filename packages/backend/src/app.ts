import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth';
import customerRoutes from './routes/customers';
import appointmentRoutes from './routes/appointments';
import taskRoutes from './routes/tasks';
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
import customerApprovalRoutes from './routes/customer-approvals';
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
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error('CORS: origin not allowed')),
}));
app.use(express.json({ limit: '5mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, message: { success: false, message: 'Too many attempts, try again later' } });

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

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/tasks', taskRoutes);
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
app.use('/api/customer-approvals', customerApprovalRoutes);

app.use(errorHandler);
export default app;