import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { isSessionStillValid } from './middleware/auth';

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
  io.use(async (socket: Socket, next) => {
    // Auth is the sole source of identity/role for this socket: the JWT is verified
    // here and nothing the client sends afterward (room names, "role", "userId", etc.)
    // is ever trusted again for routing decisions.
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    let payload: any;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET!);
    } catch {
      // Covers invalid signature AND expired tokens (jwt.verify throws TokenExpiredError).
      return next(new Error('Invalid token'));
    }
    if (!payload?.userId || !payload?.role) return next(new Error('Invalid token'));

    // v4 decision D9: the handshake applies the SAME revocation rules as the HTTP
    // middleware, via the same shared function -- otherwise a deactivated
    // technician whose requests are all rejected could still open a live socket
    // and keep receiving appointment and customer data.
    try {
      const check = await isSessionStillValid(payload.userId, payload.role, payload.sv);
      if (!check.ok) return next(new Error('Invalid token'));
    } catch {
      // A database failure must fail CLOSED here. Accepting the connection on
      // error would turn an outage into an authentication bypass.
      return next(new Error('Invalid token'));
    }

    (socket as any).userId = payload.userId;
    (socket as any).userRole = payload.role;
    next();
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

/**
 * Forcibly closes every live socket belonging to one user.
 *
 * v4 decision D9. Revoking HTTP access alone would leave an already-connected
 * socket streaming appointment and customer updates to a deactivated technician
 * until they happened to reconnect. This reuses the per-user room the connection
 * handler already joins -- no new socket subsystem, no connection registry to
 * keep in sync.
 *
 * Best-effort by design: if the socket server is not up yet (or this instance
 * holds none of that user's sockets) it is simply a no-op, and the handshake
 * check above still refuses the reconnect.
 */
export function disconnectUserSockets(userId: string) {
  try {
    io?.in(`user:${userId}`).disconnectSockets(true);
  } catch (e: any) {
    console.error(`[socket] Failed to disconnect sockets for user ${userId}:`, e?.message || e);
  }
}
