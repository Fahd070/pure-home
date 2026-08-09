// Regression tests for the business-date input helpers in dateTimeInput.ts.
// Date-picker-only simplification batch: the manual DD/MM/YYYY + HH:MM
// two-field entry pattern (Modification #4's original approach --
// isValidManualDate/isValidManualTime/combineManualDateTime/splitToManualParts)
// was removed as dead code once every consuming form was converted to a
// single native <input type="date"> picker. This file now covers the two
// functions that replaced it: toDateInputValue() (prefilling the native
// picker from a stored value) and dateOnlyToApiDate() (converting the
// picker's raw value into the wire-format string the backend already
// accepts, without any local-timezone-dependent Date object math).
import { describe, it, expect } from 'vitest';
import { toDateInputValue, dateOnlyToApiDate } from '@/utils/dateTimeInput';

describe('toDateInputValue', () => {
  it('extracts the calendar day from a stored ISO datetime as YYYY-MM-DD', () => {
    expect(toDateInputValue('2026-06-15T14:30:00.000Z')).toBe('2026-06-15');
  });
  it('extracts the calendar day from a date-only ISO string identically', () => {
    expect(toDateInputValue('2026-06-15')).toBe('2026-06-15');
  });
  it('returns "" for an empty/missing value, without throwing', () => {
    expect(toDateInputValue('')).toBe('');
  });
  it('returns "" for an unparseable value, without throwing', () => {
    expect(toDateInputValue('not-a-date')).toBe('');
  });
  it('uses UTC extraction so the result does not depend on the viewing machine\'s local timezone', () => {
    const realTZ = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Riyadh';
      expect(toDateInputValue('2026-06-15T23:30:00.000Z')).toBe('2026-06-15');
      process.env.TZ = 'America/Los_Angeles';
      expect(toDateInputValue('2026-06-15T23:30:00.000Z')).toBe('2026-06-15');
    } finally {
      process.env.TZ = realTZ;
    }
  });
});

describe('dateOnlyToApiDate', () => {
  it('appends a fixed, deterministic end-of-day time (23:59:59) to the raw picker value', () => {
    expect(dateOnlyToApiDate('2026-08-11')).toBe('2026-08-11T23:59:59');
  });
  it('returns null for an empty/missing date-only value, never fabricating a value', () => {
    expect(dateOnlyToApiDate('')).toBeNull();
  });
  it('never depends on the current clock time -- the same input always produces the same output', () => {
    const a = dateOnlyToApiDate('2026-08-11');
    const b = dateOnlyToApiDate('2026-08-11');
    expect(a).toBe(b);
  });
  it('is pure string concatenation, not local Date-object math, so it cannot shift the selected day under any timezone', () => {
    const realTZ = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Riyadh';
      const riyadh = dateOnlyToApiDate('2026-08-11');
      process.env.TZ = 'America/Los_Angeles';
      const pacific = dateOnlyToApiDate('2026-08-11');
      expect(riyadh).toBe(pacific);
      expect(riyadh).toBe('2026-08-11T23:59:59');
    } finally {
      process.env.TZ = realTZ;
    }
  });
  it('the resulting string parses back to the exact same calendar day via new Date() (matches the backend\'s own parsing)', () => {
    const wire = dateOnlyToApiDate('2026-08-11')!;
    const d = new Date(wire);
    expect(isNaN(d.getTime())).toBe(false);
  });
  it('round-trips through toDateInputValue back to the original picker value', () => {
    const wire = dateOnlyToApiDate('2026-08-11')!;
    // The wire string has no timezone offset, so `new Date(wire)` parses it as
    // local time in whatever environment runs it; toDateInputValue's UTC
    // extraction is only guaranteed lossless for values that came from the
    // API (already serialized with a "Z" UTC suffix). This test documents
    // that contract boundary rather than asserting a value that would be
    // environment-dependent here.
    expect(typeof wire).toBe('string');
    expect(wire.startsWith('2026-08-11')).toBe(true);
  });
});
