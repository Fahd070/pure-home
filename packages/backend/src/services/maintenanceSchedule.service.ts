// Single reusable source of truth for "Next Maintenance" date math. Next
// Maintenance is never stored -- it is always derived from the customer's
// most recent COMPLETED (non-urgent) appointment's actualCompletionDate (the
// Technician/Admin-declared ACTUAL operation date -- see schema.prisma), plus
// the customer's maintenanceCycle/maintenanceFrequency. This replaces the
// previous per-route "earliest upcoming scheduledDate" derivation, which used
// a manually-scheduled future appointment (or nothing) instead of the actual
// completion date and ignored the recurrence cycle entirely.
//
// All date math is done via UTC getters/setters only (never local Date
// methods), matching this codebase's existing convention for date-only
// business fields (see utils/dateTimeInput.ts's formatGregorianDate, which
// forces `timeZone: "UTC"` for the same reason) -- this guarantees the
// calculation never shifts by a day regardless of the server or viewing
// device's timezone (Saudi Arabia, UTC+3).

export type MaintenanceCycleType = 'DAILY' | 'WEEKLY' | 'MONTHLY';

// Adds a whole number of calendar months, clamping the day-of-month to the
// last day of the target month when it doesn't exist there (e.g. 31 Jan + 1
// month -> 28/29 Feb, never rolling over into March). Deterministic, no
// floating-point "average month length" math.
function addMonthsCalendarSafeUTC(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const hh = date.getUTCHours(), mm = date.getUTCMinutes(), ss = date.getUTCSeconds(), ms = date.getUTCMilliseconds();

  const totalMonths = month + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);

  return new Date(Date.UTC(targetYear, targetMonth, clampedDay, hh, mm, ss, ms));
}

function addDaysUTC(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

// Half-month business rule (documented per the task -- no prior rule existed
// in this codebase): a ".5" recurrence adds exactly 15 calendar days on top
// of the whole-month calendar-safe addition. E.g. 1.5 months = +1 calendar
// month, then +15 days. Deliberately NOT `days * 30.44` or any other
// floating-point average -- always deterministic.
export function calculateNextMaintenanceDate(fromDate: Date, cycle: MaintenanceCycleType, frequency: number): Date {
  if (cycle === 'DAILY') return addDaysUTC(fromDate, frequency);
  if (cycle === 'WEEKLY') return addDaysUTC(fromDate, frequency * 7);

  const wholeMonths = Math.trunc(frequency);
  const halfMonthRemainder = frequency - wholeMonths;
  let result = addMonthsCalendarSafeUTC(fromDate, wholeMonths);
  if (halfMonthRemainder >= 0.5 - 1e-9) {
    result = addDaysUTC(result, 15);
  }
  return result;
}

export interface MaintenanceScheduleAppointment {
  isUrgent: boolean;
  workStatus: string;
  actualCompletionDate: Date | null;
  completedAt: Date | null;
  scheduledDate: Date;
}

export interface MaintenanceScheduleCustomer {
  maintenanceCycle: MaintenanceCycleType;
  maintenanceFrequency: number;
  previousServiceDate: Date | null;
  // v4 Requirement #4: optional, because several call sites legitimately select
  // only the recurrence fields. When absent it is simply not available as a
  // baseline -- it is never defaulted to "now", which would fabricate a due date.
  installationDate?: Date | null;
}

// Source-of-truth priority for the date recurrence is added to:
//   1. The most recent COMPLETED, non-urgent appointment's actualCompletionDate
//      (falling back to completedAt, then scheduledDate, for legacy/Admin
//      completions submitted before actualCompletionDate existed or that
//      never required it -- see routes/appointments.ts's `/complete` route).
//   2. If the customer has no in-system completion yet, previousServiceDate
//      (historical service that happened before the customer existed in the
//      system) establishes the FIRST next-maintenance baseline only.
//   3. v4 Requirement #4: otherwise installationDate. A customer whose filter
//      was installed but who has never had a recorded service is still on a
//      maintenance cycle -- it simply started at installation. Before this
//      fallback existed, such a customer had NO computable due date at all and
//      was therefore invisible to every due calculation, dashboard bucket and
//      overdue list, which is exactly the "only monitored if an appointment was
//      manually scheduled" defect Requirement #4 exists to fix.
//   4. Otherwise there is no computable date, and this returns null. Null is a
//      real answer meaning "unknown", never a reason to substitute today's date.
// Urgent appointments/visits are deliberately excluded -- they have no
// actualCompletionDate field (see UrgentVisitRecord in schema.prisma) and are
// not part of the customer's regular recurring-maintenance cycle.
export function computeNextMaintenanceDate(
  customer: MaintenanceScheduleCustomer,
  appointments: MaintenanceScheduleAppointment[]
): Date | null {
  const completions = appointments
    .filter(a => !a.isUrgent && a.workStatus === 'COMPLETED')
    .map(a => ({ sourceDate: a.actualCompletionDate ?? a.completedAt ?? a.scheduledDate }))
    .sort((a, b) => new Date(b.sourceDate).getTime() - new Date(a.sourceDate).getTime());

  const baseline =
    completions[0]?.sourceDate ??
    customer.previousServiceDate ??
    customer.installationDate ??
    null;
  if (!baseline) return null;

  return calculateNextMaintenanceDate(new Date(baseline), customer.maintenanceCycle, customer.maintenanceFrequency);
}

// ---------------------------------------------------------------------------
// Maintenance priority
// ---------------------------------------------------------------------------

export type MaintenancePriority = 'OVERDUE' | 'DUE_SOON' | 'NORMAL' | 'UNKNOWN';

/**
 * The "due soon" window, in days.
 *
 * This is the ONE place the threshold lives (approved decision D3). It
 * previously existed as a bare `daysUntil <= 10` literal duplicated in
 * routes/customers.ts and routes/reports.ts, which meant the two surfaces could
 * silently disagree; both now import this constant, including for the legacy
 * `alertLevel` field they still emit for Desktop v3.6.5.
 *
 * The value is deliberately unchanged at 10, preserving today's behaviour
 * exactly: the business has not yet approved a different threshold, and this
 * refactor is not the place to quietly change what employees see. When a value
 * is approved, it changes here and everywhere follows.
 */
export const DUE_SOON_DAYS = 10;

/**
 * Whole days from `now` until `dueDate`, using UTC date boundaries only.
 *
 * Date-only semantics matter here: "due in 1 day" must not flip to "overdue"
 * because of a clock time. Both sides are floored to their UTC calendar day
 * before subtracting, so the result counts calendar days, never elapsed hours.
 * This matches the UTC-only convention used by the recurrence math above and by
 * utils/dateTimeInput.ts on the frontend, and is what keeps the answer stable
 * for Asia/Riyadh (UTC+3) viewers regardless of server timezone.
 *
 * Negative means overdue by that many days, so callers never have to reinvent
 * the sign convention -- and the UI never has to render a negative "days
 * remaining", which is the Requirement #5 defect.
 */
export function daysUntilDue(dueDate: Date, now: Date = new Date()): number {
  const startOfDayUTC = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDayUTC(new Date(dueDate)) - startOfDayUTC(now)) / 86400000);
}

/**
 * The single classification used by dashboard buckets, customer list colours,
 * overdue-first sorting and reports. Frontends render this value; they never
 * recompute it, so a colour and a sort order can never disagree.
 */
export function getMaintenancePriority(dueDate: Date | null | undefined, now: Date = new Date()): MaintenancePriority {
  if (!dueDate) return 'UNKNOWN';
  const days = daysUntilDue(dueDate, now);
  if (days < 0) return 'OVERDUE';
  if (days <= DUE_SOON_DAYS) return 'DUE_SOON';
  return 'NORMAL';
}

/**
 * Both derived values a list row needs, computed once together so callers cannot
 * pair a priority from one date with a day count from another.
 *
 * `daysUntil` is signed; `daysOverdue` is the positive magnitude for OVERDUE
 * rows and null otherwise, so the UI can render "overdue by X days" without ever
 * negating a number itself.
 */
export function describeMaintenanceDue(dueDate: Date | null | undefined, now: Date = new Date()) {
  if (!dueDate) {
    return { maintenancePriority: 'UNKNOWN' as MaintenancePriority, daysUntilMaintenance: null, daysOverdue: null };
  }
  const daysUntil = daysUntilDue(dueDate, now);
  const priority = getMaintenancePriority(dueDate, now);
  return {
    maintenancePriority: priority,
    daysUntilMaintenance: daysUntil,
    daysOverdue: priority === 'OVERDUE' ? Math.abs(daysUntil) : null,
  };
}
