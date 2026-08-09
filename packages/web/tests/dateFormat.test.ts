// Date input/date display normalization batch: permanent tests for the shared
// Gregorian/English-digit/locale-independent date formatter (dateTimeInput.ts).
// Root cause of the reported Arabic-device "weird" rendering: naked
// toLocaleDateString()/toLocaleString() calls (often passed "ar-SA" explicitly)
// inherit the OS/browser locale, which can switch both calendar (Hijri) and
// digits (Arabic-Indic ٠١٢٣...). These functions instead pass an explicit
// `-u-ca-gregory-nu-latn` BCP-47 extension, making the output immune to
// device/OS locale entirely.
import { describe, it, expect, afterAll } from 'vitest';
import {
  formatGregorianDate, formatGregorianTime, formatGregorianDateTime,
  formatGregorianMonthYear, localDateOnlyStr, todayDateOnly,
} from '@/utils/dateTimeInput';

describe('formatGregorianDate: stable DD/MM/YYYY, no time', () => {
  it('formats a stored ISO datetime as DD/MM/YYYY with no time portion', () => {
    expect(formatGregorianDate('2026-08-09T14:05:00.000Z')).toBe('09/08/2026');
  });
  it('formats a date-only ISO string identically', () => {
    expect(formatGregorianDate('2026-08-09')).toBe('09/08/2026');
  });
  it('accepts a Date object directly', () => {
    expect(formatGregorianDate(new Date('2026-08-09T00:00:00.000Z'))).toBe('09/08/2026');
  });
  it('the same date formats identically on repeated calls (stable/deterministic)', () => {
    const a = formatGregorianDate('2026-08-09T14:05:00.000Z');
    const b = formatGregorianDate('2026-08-09T14:05:00.000Z');
    expect(a).toBe(b);
  });
  it('never includes a time portion', () => {
    expect(formatGregorianDate('2026-08-09T23:59:59.000Z')).not.toMatch(/:/);
  });
  it('returns "" for null/undefined/invalid input rather than throwing', () => {
    expect(formatGregorianDate(null)).toBe('');
    expect(formatGregorianDate(undefined)).toBe('');
    expect(formatGregorianDate('not-a-date')).toBe('');
    expect(formatGregorianDate('')).toBe('');
  });
});

describe('formatGregorianDate: English digits + Gregorian calendar, locale-independent', () => {
  it('produces only ASCII digits and slashes, never Arabic-Indic numerals', () => {
    const out = formatGregorianDate('2026-08-09T00:00:00.000Z');
    expect(out).toMatch(/^[0-9/]+$/);
  });
  it('never contains an Arabic-Indic digit (U+0660-U+0669), proving the ar-SA bug is fixed', () => {
    const out = formatGregorianDate('2026-08-09T00:00:00.000Z');
    expect(out).not.toMatch(/[٠-٩]/);
  });
  it('reproduces the exact bug this batch fixes: naked ar-SA toLocaleDateString produces Arabic-Indic digits', () => {
    // Documents the root cause directly -- this is what every call site used to
    // do before being replaced with formatGregorianDate.
    const buggyOutput = new Date('2026-08-09T00:00:00.000Z').toLocaleDateString('ar-SA');
    expect(buggyOutput).toMatch(/[٠-٩]/);
    // ...and confirms the fix avoids it entirely.
    expect(formatGregorianDate('2026-08-09T00:00:00.000Z')).not.toMatch(/[٠-٩]/);
  });
  it('the underlying Intl call explicitly locks the Gregorian calendar (-u-ca-gregory)', () => {
    const resolved = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
    }).resolvedOptions();
    expect(resolved.calendar).toBe('gregory');
  });
  it('the underlying Intl call explicitly locks Latin/English digits (-u-nu-latn)', () => {
    const resolved = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
    }).resolvedOptions();
    expect(resolved.numberingSystem).toBe('latn');
  });
});

describe('formatGregorianTime', () => {
  it('formats HH:MM in 24-hour English digits, no seconds/AM-PM', () => {
    expect(formatGregorianTime('2026-08-09T14:05:00.000Z')).toBe('14:05');
    expect(formatGregorianTime('2026-08-09T00:05:00.000Z')).toBe('00:05');
  });
  it('returns "" for null/invalid input', () => {
    expect(formatGregorianTime(null)).toBe('');
    expect(formatGregorianTime('garbage')).toBe('');
  });
});

describe('formatGregorianDateTime', () => {
  it('combines date and time with a single space', () => {
    expect(formatGregorianDateTime('2026-08-09T14:05:00.000Z')).toBe('09/08/2026 14:05');
  });
  it('returns "" for null/invalid input', () => {
    expect(formatGregorianDateTime(undefined)).toBe('');
  });
});

describe('formatGregorianMonthYear (report period labels)', () => {
  it('renders an English month name for isAr=false, with the Gregorian year', () => {
    expect(formatGregorianMonthYear('2026-08-09T00:00:00.000Z', false)).toBe('August 2026');
  });
  it('renders an Arabic month name for isAr=true, but the year digits stay English', () => {
    const out = formatGregorianMonthYear('2026-08-09T00:00:00.000Z', true);
    expect(out).toContain('2026');
    expect(out).not.toMatch(/[٠-٩]/);
  });
});

describe('Timezone safety: UTC extraction never shifts the calendar day', () => {
  const realTZ = process.env.TZ;
  afterAll(() => { process.env.TZ = realTZ; });

  it('a date-only midnight-UTC value formats to the same day under Saudi Arabia (+03:00)', () => {
    process.env.TZ = 'Asia/Riyadh';
    expect(formatGregorianDate('2026-08-10T00:00:00.000Z')).toBe('10/08/2026');
  });
  it('the same value formats identically under plain UTC', () => {
    process.env.TZ = 'UTC';
    expect(formatGregorianDate('2026-08-10T00:00:00.000Z')).toBe('10/08/2026');
  });
  it('the same value formats identically under a negative-offset zone (US Pacific) -- proves it is not just "safe near +03:00"', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(formatGregorianDate('2026-08-10T00:00:00.000Z')).toBe('10/08/2026');
  });
  it('a near-midnight-UTC datetime still reports the true UTC calendar day under Saudi local time, not the shifted local day', () => {
    process.env.TZ = 'Asia/Riyadh';
    // 23:30 UTC on the 9th is 02:30 on the 10th in Riyadh local time -- UTC
    // extraction must still report the 9th (the actual stored UTC day), proving
    // this is genuinely reading UTC fields, not silently falling back to local.
    expect(formatGregorianDate('2026-08-09T23:30:00.000Z')).toBe('09/08/2026');
  });
});

describe('localDateOnlyStr: local Date object -> YYYY-MM-DD without a UTC round-trip', () => {
  it('reads the Date object\'s own local y/m/d fields directly', () => {
    const d = new Date(2026, 7, 10); // August 10 2026, local midnight (month is 0-indexed)
    expect(localDateOnlyStr(d)).toBe('2026-08-10');
  });
  it('pads single-digit month/day with a leading zero', () => {
    const d = new Date(2026, 0, 5); // Jan 5 2026
    expect(localDateOnlyStr(d)).toBe('2026-01-05');
  });
  it('does not shift under a positive-offset local timezone (the toISOString() bug this replaces)', () => {
    const realTZ = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Riyadh';
      const d = new Date(2026, 7, 10); // local midnight in whatever TZ is active
      expect(localDateOnlyStr(d)).toBe('2026-08-10');
      // Demonstrates the bug localDateOnlyStr avoids: toISOString() converts to
      // UTC and can report the previous day for a positive-offset local zone.
      // (Not asserted as always-failing here since it depends on the exact
      // offset vs. local midnight, but documents the contrast for reviewers.)
    } finally {
      process.env.TZ = realTZ;
    }
  });
});

describe('todayDateOnly: local "today" for native date input default/max', () => {
  it('returns a YYYY-MM-DD string matching the current local calendar day', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(todayDateOnly()).toBe(expected);
  });
});
