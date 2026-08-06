import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

let io: Server;

const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return true;
  // Render cloud URL — allow only the specific deployed URL, not all HTTPS origins
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl && origin === renderUrl) return true;
  const extra = process.env.ALLOWED_ORIGINS || '';
  if (extra) {
    for (const allowed of extra.split(',')) {
      if (allowed.trim() === origin) return true;
    }
  }
  return false;
};

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error('CORS: origin not allowed')) },
  });
  io.use((socket: Socket, next) => {
    // Auth is the sole source of identity/role for this socket: the JWT is verified
    // here and nothing the client sends afterward (room names, "role", "userId", etc.)
    // is ever trusted again for routing decisions.
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
      if (!payload?.userId || !payload?.role) return next(new Error('Invalid token'));
      (socket as any).userId = payload.userId;
      (socket as any).userRole = payload.role;
      next();
    } catch {
      // Covers invalid signature AND expired tokens (jwt.verify throws TokenExpiredError).
      next(new Error('Invalid token'));
    }
  });
  io.on('connection', (socket: Socket) => {
    // Room membership is derived exclusively from the verified JWT payload set above --
    // never from anything supplied by the client at connection time.
    const userId = (socket as any).userId;
    const role = (socket as any).userRole;
    socket.join(`user:${userId}`);
    socket.join(role);
    if (role === 'TECHNICIAN') socket.join(`technician:${userId}`);
  });
  return io;
}

export function getIO() { return io; }
export function emitToRole(role: string, event: string, data: any) { io?.to(role).emit(event, data); }
export function emitToRoles(roles: string[], event: string, data: any) { io?.to(roles).emit(event, data); }
export function emitToUser(userId: string, event: string, data: any) { io?.to(`user:${userId}`).emit(event, data); }
export function emitToTechnician(technicianId: string, event: string, data: any) { io?.to(`technician:${technicianId}`).emit(event, data); }
