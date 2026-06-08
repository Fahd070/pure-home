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
  return false;
};

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error('CORS: origin not allowed')) },
  });
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
      (socket as any).userId = payload.userId;
      (socket as any).userRole = payload.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });
  io.on('connection', (socket: Socket) => {
    socket.join('all');
    const role = (socket as any).userRole;
    if (role) socket.join(role);
  });
  return io;
}

export function getIO() { return io; }
export function emitToAll(event: string, data: any) { io?.to('all').emit(event, data); }
export function emitToRole(role: string, event: string, data: any) { io?.to(role).emit(event, data); }
