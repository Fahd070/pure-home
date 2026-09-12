// v4 Requirement #10B/#10C: the ONE vocabulary of statuses a report may be
// filtered by, and the ONE translation of each into a database filter.
//
// WHY THIS FILE EXISTS
// --------------------
// An appointment carries TWO status fields, and every screen in this app already
// combines them the same way when it shows "what state is this in":
//
//   Appointment.status     -- SCHEDULED | RESCHEDULED | CANCELLED | PENDING
//   Appointment.workStatus -- WAITING | IN_PROGRESS | COMPLETED | POSTPONED
//
// So COMPLETED, POSTPONED and RESCHEDULED -- the three the requirement names
// together -- do not live in one column and cannot be expressed as one IN (...).
// Nothing new is invented here: every value below is an existing value of one of
// those two fields, and the precedence is exactly the one the customer history
// modal and the technician task list already display (cancellation wins, then
// work state, then schedule state).
//
// The fragments are mutually exclusive and exhaustive, which is what makes
// selecting several of them a plain OR with no double-counting: an appointment
// that is both RESCHEDULED and COMPLETED reports as COMPLETED in the UI, so it
// must also be found by COMPLETED and not by RESCHEDULED -- otherwise the report
// would contradict the screen it was generated from. The rendering half of that
// rule lives with the renderer, in unified-app/src/utils/reportStatus.ts.
import { Prisma } from '@prisma/client';

export const APPOINTMENT_REPORT_STATUSES = [
  'COMPLETED', 'POSTPONED', 'RESCHEDULED', 'SCHEDULED', 'PENDING', 'IN_PROGRESS', 'CANCELLED',
] as const;

export type AppointmentReportStatus = typeof APPOINTMENT_REPORT_STATUSES[number];

// WAITING is the "nothing has happened to this job yet" work state, so it is what
// remains once the three active work states are excluded. Naming it explicitly
// (rather than a notIn) keeps the fragments readable and exactly complementary.
const NOT_CANCELLED: Prisma.AppointmentWhereInput = { status: { not: 'CANCELLED' } };

const APPOINTMENT_STATUS_WHERE: Record<AppointmentReportStatus, Prisma.AppointmentWhereInput> = {
  CANCELLED:   { status: 'CANCELLED' },
  COMPLETED:   { ...NOT_CANCELLED, workStatus: 'COMPLETED' },
  IN_PROGRESS: { ...NOT_CANCELLED, workStatus: 'IN_PROGRESS' },
  POSTPONED:   { ...NOT_CANCELLED, workStatus: 'POSTPONED' },
  SCHEDULED:   { status: 'SCHEDULED',   workStatus: 'WAITING' },
  RESCHEDULED: { status: 'RESCHEDULED', workStatus: 'WAITING' },
  PENDING:     { status: 'PENDING',     workStatus: 'WAITING' },
};

// The customer report asks a different question -- "which customers have an
// appointment in this state" -- plus two calendar-window states. These values are
// exactly the ones routes/reports.ts already accepted as its single `status`
// parameter; multi-selection is the only thing being added.
export const CUSTOMER_REPORT_STATUSES = [
  'COMPLETED', 'POSTPONED', 'OVERDUE', 'UPCOMING', 'SCHEDULED', 'IN_PROGRESS', 'CANCELLED',
  'THIS_MONTH', 'NEXT_MONTH',
] as const;

export type CustomerReportStatus = typeof CUSTOMER_REPORT_STATUSES[number];

/**
 * Parses a repeatable/comma-separated status parameter.
 *
 * Accepts status=A,B or status=A&status=B or a single value, matching the comma
 * convention GET /api/appointments already uses for workStatus rather than
 * introducing a second encoding. Returns null for "not specified", which every
 * caller treats as its existing no-filter meaning.
 *
 * Rejects an unknown value instead of ignoring it: a typo that silently widens a
 * report to every record is far worse than an error message, because the result
 * still looks like a report.
 */
export function parseReportStatuses<T extends string>(
  raw: unknown,
  allowed: readonly T[]
): { ok: true; statuses: T[] | null } | { ok: false; invalid: string[] } {
  if (raw === undefined || raw === null) return { ok: true, statuses: null };
  const flat = (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  // An explicitly empty value ("" or ",,") means the same as omitting it: the
  // caller cleared the filter. It must not mean "match nothing".
  if (flat.length === 0) return { ok: true, statuses: null };
  // ALL is the existing sentinel the customer report dropdown sends.
  if (flat.every((v) => v === 'ALL')) return { ok: true, statuses: null };

  const invalid = flat.filter((v) => !(allowed as readonly string[]).includes(v));
  if (invalid.length) return { ok: false, invalid: Array.from(new Set(invalid)) };
  // De-duplicated so a repeated value cannot produce a duplicated OR branch.
  return { ok: true, statuses: Array.from(new Set(flat)) as T[] };
}

/** The OR fragment for a set of appointment statuses. */
export function appointmentStatusFilter(statuses: AppointmentReportStatus[]): Prisma.AppointmentWhereInput {
  return { OR: statuses.map((s) => APPOINTMENT_STATUS_WHERE[s]) };
}

/**
 * The customer-side filter: "has at least one appointment matching ANY selected
 * state". `some` already means "at least one", so several statuses collapse into
 * a single `some` over an OR -- NOT one `some` per status, which would require
 * the same appointment to satisfy all of them if combined with AND, and would
 * duplicate the customer if combined naively.
 */
export function customerStatusFilter(
  statuses: CustomerReportStatus[],
  now: Date
): Prisma.CustomerWhereInput {
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const startOfFollowingMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  const in30 = new Date(now.getTime() + 30 * 86400000);

  // Byte-for-byte the conditions routes/reports.ts applied for each single
  // status before multi-select existed, so a one-status report returns exactly
  // the rows it always did.
  const per: Record<CustomerReportStatus, Prisma.AppointmentWhereInput> = {
    COMPLETED:   { workStatus: 'COMPLETED' },
    POSTPONED:   { workStatus: 'POSTPONED' },
    OVERDUE:     { scheduledDate: { lt: now }, status: { not: 'CANCELLED' }, workStatus: { not: 'COMPLETED' } },
    UPCOMING:    { scheduledDate: { gte: now, lte: in30 }, status: { not: 'CANCELLED' } },
    SCHEDULED:   { scheduledDate: { gte: now }, status: { not: 'CANCELLED' }, workStatus: { in: ['WAITING'] } },
    IN_PROGRESS: { workStatus: 'IN_PROGRESS' },
    CANCELLED:   { status: 'CANCELLED' },
    THIS_MONTH:  { scheduledDate: { gte: startOfThisMonth, lt: startOfNextMonth } },
    NEXT_MONTH:  { scheduledDate: { gte: startOfNextMonth, lt: startOfFollowingMonth } },
  };

  return { appointments: { some: { OR: statuses.map((s) => per[s]) } } };
}
