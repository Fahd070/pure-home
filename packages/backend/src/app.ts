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

// Allow localhost and all RFC 1918 private LAN ranges (10.x, 172.16-31.x, 192.168.x)
// Electron renderers load from file:// and send no Origin header, so the !origin branch
// is what covers all production client PCs. LAN IP patterns cover future web/dev scenarios.
const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;
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