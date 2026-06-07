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
import { errorHandler } from './middleware/errorHandler';
import prisma from './prisma';

// Allow: Electron (no origin), private LAN ranges (RFC 1918), Tailscale CGNAT (100.64/10)
// Primary security is JWT — CORS is a browser-layer supplement, not the auth gate.
const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;                                                      // Electron file:// → no origin
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;               // local dev
  if (/^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;   // RFC 1918 /8
  if (/^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true; // RFC 1918 /12
  if (/^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;      // RFC 1918 /16
  // Tailscale CGNAT range: 100.64.0.0/10 (100.64.x.x – 100.127.x.x)
  if (/^https?:\/\/100\.(6[4-9]|[789]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;
  return false;
};

const app = express();
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error('CORS: origin not allowed')),
}));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { success: false, message: 'Too many attempts, try again later' } });

// Health check — no auth required, used by monitoring and client connectivity tests
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'disconnected', timestamp: new Date().toISOString() });
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

app.use(errorHandler);
export default app;