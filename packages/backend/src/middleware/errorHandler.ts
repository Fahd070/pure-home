import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  let status = err.status || err.statusCode || 500;

  if (err.name === 'ZodError') status = 400;

  if (status >= 500) {
    console.error(`[ERROR] ${req.method} ${req.path}`, err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }

  if (err.name === 'ZodError') {
    return res.status(400).json({ success: false, message: 'Invalid request data' });
  }

  res.status(status).json({ success: false, message: err.message || 'Request failed' });
}
