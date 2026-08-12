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
}

// Source-of-truth priority for the date recurrence is added to:
//   1. The most recent COMPLETED, non-urgent appointment's actualCompletionDate
//      (falling back to completedAt, then scheduledDate, for legacy/Admin
//      completions submitted before actualCompletionDate existed or that
//      never required it -- see routes/appointments.ts's `/complete` route).
//   2. If the customer has no in-system completion yet, previousServiceDate
//      (historical service that happened before the customer existed in the
//      system) establishes the FIRST next-maintenance baseline only.
//   3. Otherwise there is no computable date.
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

  const baseline = completions[0]?.sourceDate ?? customer.previousServiceDate ?? null;
  if (!baseline) return null;

  return calculateNextMaintenanceDate(new Date(baseline), customer.maintenanceCycle, customer.maintenanceFrequency);
}
