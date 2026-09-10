import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';

export interface AuthRequest extends Request {
  user?: { userId: string; role: string };
}

/**
 * v4 decision D9: server-enforced session revocation.
 *
 * Previously this verified the JWT signature and nothing else, which was
 * documented as an accepted limitation: a token issued before a user was
 * deactivated stayed usable for the rest of its 8-hour life. That was tolerable
 * while every technician shared one account. It is not tolerable now that
 * Administration -> Employees -> Deactivate is a real offboarding control for a
 * named individual -- without this check, "deactivate" would only stop the NEXT
 * login, and the person could keep completing and rescheduling appointments for
 * hours.
 *
 * The check is one indexed primary-key lookup per authenticated request. That
 * cost is deliberate and is what makes revocation:
 *   * server-enforced      -- the client cannot opt out
 *   * deterministic        -- no TTL to wait out
 *   * durable              -- the source of truth is a row, so it survives
 *                             Render restarts and works identically if more than
 *                             one backend instance ever runs (an in-process
 *                             blacklist would satisfy neither)
 */
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Unauthorized' });

  let payload: any;
  try {
    payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  if (!payload?.userId || !payload?.role) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  // The database call MUST be guarded. Express 4 does not catch a rejected
  // promise from an async middleware: an unhandled rejection here would leave
  // the request with no response at all, hanging until the client times out.
  // It also has to fail CLOSED -- treating a database error as "session is
  // fine" would turn a database outage into an authentication bypass, which is
  // strictly worse than refusing the request.
  let check: { ok: boolean };
  try {
    check = await isSessionStillValid(payload.userId, payload.role, payload.sv);
  } catch (e: any) {
    console.error('[auth] Session validation failed:', e?.message || e);
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
  }

  if (!check.ok) {
    // Same generic 401 shape as an invalid signature. A caller must not be able
    // to tell "your account was deactivated" from "your token is malformed".
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  req.user = { userId: payload.userId, role: payload.role };
  next();
}

/**
 * Shared by the HTTP middleware above and the Socket.IO handshake, so a
 * connection can never be accepted under rules the request path would reject.
 *
 * `tokenSessionVersion` is the `sv` claim. It is OPTIONAL on purpose -- see the
 * transitional rule below.
 */
export async function isSessionStillValid(
  userId: string,
  tokenRole: string,
  tokenSessionVersion: unknown
): Promise<{ ok: boolean; reason?: 'NOT_FOUND' | 'INACTIVE' | 'ROLE_CHANGED' | 'SESSION_REVOKED' }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: true, sessionVersion: true },
  });

  if (!user) return { ok: false, reason: 'NOT_FOUND' };
  if (!user.isActive) return { ok: false, reason: 'INACTIVE' };
  // A token must not outlive a role change either: the role is an authorization
  // input carried in the token, so it has to still match the account.
  if (user.role !== tokenRole) return { ok: false, reason: 'ROLE_CHANGED' };

  // TRANSITIONAL RULE for tokens minted before this change shipped.
  //
  // Such a token has no `sv` claim. It is accepted (so a deploy does not sign
  // every employee out mid-shift) but ONLY the version comparison is skipped --
  // the isActive and role checks above still apply, so deactivation is enforced
  // for these tokens too. They age out naturally within the normal 8-hour token
  // lifetime, after which every token in circulation carries `sv`.
  if (typeof tokenSessionVersion !== 'number') return { ok: true };

  if (tokenSessionVersion !== user.sessionVersion) return { ok: false, reason: 'SESSION_REVOKED' };
  return { ok: true };
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
}
