import { z } from 'zod';
import { Response } from 'express';

// Shared server-side protection for destructive bulk-delete endpoints (Issue #7).
// A frontend confirmation dialog is not a security boundary -- these checks are.

// "Delete everything currently in the table" endpoints: the caller must confirm
// intent and state how many records it expects to remove (read from the same list
// view it's acting on). No `ids` -- the target set is "all rows", validated via
// expectedCount against the real server-side count.
export const bulkDeleteAllSchema = z.object({
  confirm: z.literal(true),
  expectedCount: z.number().int().min(0),
});

// "Delete these specific records" endpoints: the caller submits a bounded, explicit,
// de-duplicated list of IDs. expectedCount must match the de-duplicated ID count, so
// a caller can't submit duplicates to make an inflated list look smaller than it is.
export function bulkDeleteByIdsSchema(maxBatchSize: number) {
  return z.object({
    confirm: z.literal(true),
    ids: z.array(z.string().uuid()).min(1).max(maxBatchSize),
    expectedCount: z.number().int().min(0),
  });
}

// Thrown when the real, server-computed count doesn't match what the caller
// reviewed/expected -- signals "reject and delete nothing", not "delete what we can".
export class StaleCountError extends Error {
  actualCount: number;
  expectedCount: number;
  constructor(actualCount: number, expectedCount: number) {
    super('Stale request: the current record count no longer matches what was reviewed.');
    this.name = 'StaleCountError';
    this.actualCount = actualCount;
    this.expectedCount = expectedCount;
  }
}

export function sendStaleCountConflict(res: Response, err: StaleCountError) {
  return res.status(409).json({
    success: false,
    error: 'CONFLICT',
    message: 'The number of matching records has changed since this was last reviewed. Nothing was deleted -- please refresh and try again.',
    currentCount: err.actualCount,
    expectedCount: err.expectedCount,
  });
}

// Postgres serialization failure (Prisma error code P2034) under a Serializable
// transaction -- a genuine concurrent write conflict, not a validation problem.
// Treated the same way: reject, delete nothing, ask the caller to retry.
export function isTransactionConflict(e: any): boolean {
  return e?.code === 'P2034';
}

export function sendTransactionConflict(res: Response) {
  return res.status(409).json({
    success: false,
    error: 'CONFLICT',
    message: 'This action conflicted with another concurrent change. Nothing was deleted -- please try again.',
  });
}
