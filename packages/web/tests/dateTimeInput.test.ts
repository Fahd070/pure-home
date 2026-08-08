// Regression tests for the manual maintenance-report date/time entry helpers
// (Modification #4: no native date/time picker, manual DD/MM/YYYY + HH:MM
// text fields instead). Verifies both the validation/combination logic and,
// critically, that combineManualDateTime reconstructs the exact same
// "YYYY-MM-DDTHH:mm" wire-format string the old <input type="datetime-local">
// already sent, so the existing PUT /dashboard/appointment/:id backend
// contract (`new Date(scheduledDate)`) is preserved byte-for-byte.
import { describe, it, expect } from 'vitest';
import { isValidManualDate, isValidManualTime, combineManualDateTime, splitToManualParts } from '@/utils/dateTimeInput';

describe('isValidManualDate', () => {
  it('accepts a well-formed DD/MM/YYYY date', () => {
    expect(isValidManualDate('15/06/2026')).toBe(true);
  });
  it('accepts the last day of February in a leap year', () => {
    expect(isValidManualDate('29/02/2028')).toBe(true);
  });
  it('rejects the 29th of February in a non-leap year', () => {
    expect(isValidManualDate('29/02/2026')).toBe(false);
  });
  it('rejects an out-of-range day for the given month', () => {
    expect(isValidManualDate('31/04/2026')).toBe(false);
  });
  it('rejects a month outside 1-12', () => {
    expect(isValidManualDate('15/13/2026')).toBe(false);
  });
  it('rejects malformed input (wrong separators, missing parts, non-numeric)', () => {
    expect(isValidManualDate('2026-06-15')).toBe(false);
    expect(isValidManualDate('15/06/26')).toBe(false);
    expect(isValidManualDate('abc')).toBe(false);
    expect(isValidManualDate('')).toBe(false);
  });
});

describe('isValidManualTime', () => {
  it('accepts a well-formed 24-hour HH:MM time', () => {
    expect(isValidManualTime('14:30')).toBe(true);
    expect(isValidManualTime('00:00')).toBe(true);
    expect(isValidManualTime('23:59')).toBe(true);
  });
  it('rejects hours >= 24 or minutes >= 60', () => {
    expect(isValidManualTime('24:00')).toBe(false);
    expect(isValidManualTime('12:60')).toBe(false);
  });
  it('rejects 12-hour/AM-PM style input', () => {
    expect(isValidManualTime('2:30 PM')).toBe(false);
  });
  it('rejects malformed input', () => {
    expect(isValidManualTime('1430')).toBe(false);
    expect(isValidManualTime('')).toBe(false);
  });
});

describe('combineManualDateTime', () => {
  it('combines a valid date and time into the same "YYYY-MM-DDTHH:mm" shape the old datetime-local input produced', () => {
    expect(combineManualDateTime('15/06/2026', '14:30')).toBe('2026-06-15T14:30');
  });
  it('the combined string round-trips correctly through the native Date constructor (the same parsing the backend already relies on)', () => {
    const combined = combineManualDateTime('15/06/2026', '14:30')!;
    const d = new Date(combined);
    expect(isNaN(d.getTime())).toBe(false);
  });
  it('returns null when the date is invalid, without touching the time', () => {
    expect(combineManualDateTime('31/04/2026', '14:30')).toBeNull();
  });
  it('returns null when the time is invalid, without touching the date', () => {
    expect(combineManualDateTime('15/06/2026', '25:00')).toBeNull();
  });
  it('returns null when both are invalid', () => {
    expect(combineManualDateTime('', '')).toBeNull();
  });
});

describe('splitToManualParts (prefilling the form when editing an existing appointment)', () => {
  it('splits a stored ISO scheduledDate into DD/MM/YYYY + HH:MM', () => {
    const parts = splitToManualParts('2026-06-15T14:30:00.000Z');
    expect(parts.date).toBe('15/06/2026');
    expect(parts.time).toBe('14:30');
  });
  it('round-trips through combineManualDateTime back to the exact same "YYYY-MM-DDTHH:mm" wire string splitToManualParts was derived from', () => {
    // Note: this compares the wire STRING, not the absolute UTC instant --
    // a timezone-less "YYYY-MM-DDTHH:mm" string is parsed as local time by
    // `new Date(...)`, which was already true of the old datetime-local
    // input's value (unchanged by this modification, not something this
    // helper introduces or needs to fix).
    const original = '2026-06-15T14:30:00.000Z';
    const parts = splitToManualParts(original);
    const recombined = combineManualDateTime(parts.date, parts.time);
    expect(recombined).toBe('2026-06-15T14:30');
  });
  it('returns empty parts for an empty/missing value (new/unscheduled appointment)', () => {
    expect(splitToManualParts('')).toEqual({ date: '', time: '' });
  });
  it('returns empty parts for an unparseable value rather than throwing', () => {
    expect(splitToManualParts('not-a-date')).toEqual({ date: '', time: '' });
  });
});
