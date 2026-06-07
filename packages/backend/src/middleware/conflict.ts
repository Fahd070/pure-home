import { Request, Response, NextFunction } from 'express';

export interface Versioned {
  version: number;
}

/**
 * Returns an Express middleware that enforces optimistic locking.
 * If `req.body.version` is provided, the middleware fetches the entity and
 * rejects with HTTP 409 when the stored version does not match.
 * If `req.body.version` is absent the check is skipped (backward compat).
 */
export function checkVersion<T extends Versioned>(
  fetch: (id: string) => Promise<T | null>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const clientVersion = req.body?.version;
    if (clientVersion === undefined || clientVersion === null) {
      return next();
    }

    const id = req.params.id;
    if (!id) return next();

    try {
      const entity = await fetch(id);
      if (!entity) {
        return res.status(404).json({ success: false, message: 'Not found' });
      }
      if (entity.version !== Number(clientVersion)) {
        return res.status(409).json({
          success: false,
          error: 'CONFLICT',
          message: 'This record was modified by someone else. Please refresh and try again.',
          currentVersion: entity.version,
          yourVersion: Number(clientVersion),
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
