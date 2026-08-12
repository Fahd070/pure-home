// Focused modification batch (Part E): Next Maintenance must be calculated
// dynamically from the ACTUAL completion date + recurrence, using
// calendar-safe month arithmetic and a deterministic half-month rule (+15
// calendar days), never floating-point "average month length" math. Pure
// unit tests -- no DB needed, this is the single reusable calculation used by
// routes/customers.ts and routes/reports.ts (see maintenanceSchedule.service.ts).
import { describe, it, expect } from 'vitest';
import { calculateNextMaintenanceDate, computeNextMaintenanceDate } from '../src/services/maintenanceSchedule.service';

function d(s: string): Date { return new Date(s + 'T00:00:00.000Z'); }
function iso(date: Date): string { return date.toISOString().slice(0, 10); }

describe('calculateNextMaintenanceDate (calendar-safe month/half-month math)', () => {
  // 33/35/36. The task's exact reported-bug example: recurrence 2 months,
  // completed 12/08/2026 -> next maintenance 12/10/2026.
  it('33. recurrence 2 months from 2026-08-12 -> 2026-10-12', () => {
    expect(iso(calculateNextMaintenanceDate(d('2026-08-12'), 'MONTHLY', 2))).toBe('2026-10-12');
  });

  it('35. recurrence 1 month -> next calendar month, same day', () => {
    expect(iso(calculateNextMaintenanceDate(d('2026-08-12'), 'MONTHLY', 1))).toBe('2026-09-12');
  });

  it('36. recurrence 3 months -> correct 3-month date', () => {
    expect(iso(calculateNextMaintenanceDate(d('2026-08-12'), 'MONTHLY', 3))).toBe('2026-11-12');
  });

  // 37/38. Half-month rule: whole-month calendar-safe addition, then +15
  // calendar days for the ".5" remainder.
  it('37. recurrence 1.5 months -> +1 calendar month, then +15 days', () => {
    // 2026-08-12 + 1 month = 2026-09-12; + 15 days = 2026-09-27
    expect(iso(calculateNextMaintenanceDate(d('2026-08-12'), 'MONTHLY', 1.5))).toBe('2026-09-27');
  });

  it('38. recurrence 2.5 months -> +2 calendar months, then +15 days', () => {
    // 2026-08-12 + 2 months = 2026-10-12; + 15 days = 2026-10-27
    expect(iso(calculateNextMaintenanceDate(d('2026-08-12'), 'MONTHLY', 2.5))).toBe('2026-10-27');
  });

  // 39. End-of-month case: day-of-month clamped to the target month's last
  // day, never rolling over into the following month.
  it('39. 2026-01-31 + 1 month -> 2026-02-28 (deterministic clamp, not roll-over into March)', () => {
    expect(iso(calculateNextMaintenanceDate(d('2026-01-31'), 'MONTHLY', 1))).toBe('2026-02-28');
  });

  it('2026-11-30 + 3 months -> 2027-02-28 (clamped, Feb has fewer days than Nov)', () => {
    expect(iso(calculateNextMaintenanceDate(d('2026-11-30'), 'MONTHLY', 3))).toBe('2027-02-28');
  });

  // 40/41. February / leap year.
  it('40. February case: 2026-01-15 + 1 month -> 2026-02-15 (non-leap February)', () => {
    expect(iso(calculateNextMaintenanceDate(d('2026-01-15'), 'MONTHLY', 1))).toBe('2026-02-15');
  });

  it('41. leap-year case: 2028-01-31 + 1 month -> 2028-02-29 (2028 is a leap year)', () => {
    expect(iso(calculateNextMaintenanceDate(d('2028-01-31'), 'MONTHLY', 1))).toBe('2028-02-29');
  });

  it('leap-year case: 2028-01-29 + 1 month lands mid-February unaffected by the 29th existing that year', () => {
    expect(iso(calculateNextMaintenanceDate(d('2028-01-29'), 'MONTHLY', 1))).toBe('2028-02-29');
  });

  // 42. Timezone safety: UTC-only math, the calendar day is never shifted by
  // a non-UTC time-of-day component (simulates a Saudi-local end-of-day
  // timestamp as sometimes produced by date-only round-tripping elsewhere in
  // this codebase -- see utils/dateTimeInput.ts's dateOnlyToApiDate).
  it('42. a non-midnight UTC time-of-day does not shift the resulting calendar day', () => {
    const withTime = new Date('2026-08-12T23:59:59.000Z');
    expect(iso(calculateNextMaintenanceDate(withTime, 'MONTHLY', 2))).toBe('2026-10-12');
  });

  it('DAILY cycle adds calendar days', () => {
    expect(iso(calculateNextMaintenanceDate(d('2026-08-12'), 'DAILY', 5))).toBe('2026-08-17');
  });

  it('WEEKLY cycle adds frequency*7 days', () => {
    expect(iso(calculateNextMaintenanceDate(d('2026-08-12'), 'WEEKLY', 2))).toBe('2026-08-26');
  });
});

describe('computeNextMaintenanceDate (source-of-truth selection)', () => {
  const customer = (overrides: Partial<{ maintenanceCycle: 'DAILY'|'WEEKLY'|'MONTHLY'; maintenanceFrequency: number; previousServiceDate: Date | null }> = {}) => ({
    maintenanceCycle: 'MONTHLY' as const,
    maintenanceFrequency: 2,
    previousServiceDate: null,
    ...overrides,
  });

  // 34. Uses the ACTUAL completion date, not the original scheduled date.
  it('34. uses actualCompletionDate, not the appointment scheduledDate it was originally booked for', () => {
    const appts = [{
      isUrgent: false, workStatus: 'COMPLETED',
      scheduledDate: d('2026-08-01'), // originally booked for this date
      actualCompletionDate: d('2026-08-12'), // but actually happened on this date
      completedAt: d('2026-08-12'),
    }];
    expect(iso(computeNextMaintenanceDate(customer(), appts)!)).toBe('2026-10-12');
  });

  it('47. legacy customer with a whole-number recurrence continues to compute correctly', () => {
    const appts = [{
      isUrgent: false, workStatus: 'COMPLETED',
      scheduledDate: d('2026-08-12'), actualCompletionDate: d('2026-08-12'), completedAt: d('2026-08-12'),
    }];
    expect(iso(computeNextMaintenanceDate(customer({ maintenanceFrequency: 1 }), appts)!)).toBe('2026-09-12');
  });

  it('falls back to completedAt when actualCompletionDate is missing (e.g. an Admin completion, which does not require it)', () => {
    const appts = [{
      isUrgent: false, workStatus: 'COMPLETED',
      scheduledDate: d('2026-08-01'), actualCompletionDate: null, completedAt: d('2026-08-10'),
    }];
    expect(iso(computeNextMaintenanceDate(customer(), appts)!)).toBe('2026-10-10');
  });

  it('picks the MOST RECENT completed appointment when several exist', () => {
    const appts = [
      { isUrgent: false, workStatus: 'COMPLETED', scheduledDate: d('2026-01-01'), actualCompletionDate: d('2026-01-01'), completedAt: d('2026-01-01') },
      { isUrgent: false, workStatus: 'COMPLETED', scheduledDate: d('2026-08-12'), actualCompletionDate: d('2026-08-12'), completedAt: d('2026-08-12') },
    ];
    expect(iso(computeNextMaintenanceDate(customer(), appts)!)).toBe('2026-10-12');
  });

  it('ignores an urgent appointment even if marked COMPLETED (urgent visits have no actualCompletionDate/recurrence participation)', () => {
    const appts = [
      { isUrgent: true, workStatus: 'COMPLETED', scheduledDate: d('2026-08-12'), actualCompletionDate: d('2026-08-12'), completedAt: d('2026-08-12') },
    ];
    expect(computeNextMaintenanceDate(customer(), appts)).toBeNull();
  });

  it('ignores a scheduled-but-not-completed future appointment (must not use the manually scheduled date)', () => {
    const appts = [
      { isUrgent: false, workStatus: 'WAITING', scheduledDate: d('2026-12-25'), actualCompletionDate: null, completedAt: null },
    ];
    expect(computeNextMaintenanceDate(customer(), appts)).toBeNull();
  });

  // 48. previousServiceDate establishes the FIRST baseline only, when no
  // in-system completion exists yet -- never overrides a real completion.
  it('48. with no in-system completion, previousServiceDate establishes the first baseline', () => {
    expect(iso(computeNextMaintenanceDate(customer({ previousServiceDate: d('2026-06-01') }), [])!)).toBe('2026-08-01');
  });

  it('48. previousServiceDate is ignored once a real in-system completion exists', () => {
    const appts = [{
      isUrgent: false, workStatus: 'COMPLETED',
      scheduledDate: d('2026-08-12'), actualCompletionDate: d('2026-08-12'), completedAt: d('2026-08-12'),
    }];
    expect(iso(computeNextMaintenanceDate(customer({ previousServiceDate: d('2020-01-01') }), appts)!)).toBe('2026-10-12');
  });

  it('returns null with no completion and no previousServiceDate (nothing to compute from)', () => {
    expect(computeNextMaintenanceDate(customer(), [])).toBeNull();
  });
});
