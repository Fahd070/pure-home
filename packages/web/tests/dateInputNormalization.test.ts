// Source-level regression tests for business-date form controls, covering two
// stacked batches:
// 1) Date normalization (Gregorian calendar, English digits, lang="en-GB"
//    dir="ltr" on native date inputs) -- still fully in effect.
// 2) Date-picker-only simplification (THIS batch): every business-date form
//    that previously used <input type="datetime-local"> was converted to
//    manual DD/MM/YYYY + HH:MM text fields in the date-normalization batch,
//    and is now converted AGAIN to a single native <input type="date"> with
//    NO time field at all, per the explicit new requirement that removes
//    time selection from business-date scheduling entirely. Follows this
//    project's established pattern (see technicianNameCompletion.test.ts,
//    dateTimeInput.test.ts) -- source-level assertions against the exact
//    production wiring.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function src(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../unified-app/src', rel), 'utf-8');
}

const FORMS_CONVERTED_TO_DATE_PICKER = [
  'admin/pages/Dashboard.tsx',
  'admin/pages/Appointments.tsx',
  'admin/pages/UrgentAppointments.tsx',
  'scheduling/pages/Dashboard.tsx',
  'scheduling/pages/CustomerList.tsx',
  'scheduling/pages/NewAppointment.tsx',
  'admin/components/CallReportForm.tsx',
  'scheduling/components/CallReportForm.tsx',
];

describe('No business-date form uses <input type="datetime-local"> anywhere in the app', () => {
  it.each(FORMS_CONVERTED_TO_DATE_PICKER)('%s does not contain a datetime-local input', (rel) => {
    expect(src(rel)).not.toMatch(/type="datetime-local"/);
  });

  it('no file under unified-app/src still contains a datetime-local input', () => {
    const root = path.resolve(__dirname, '../../unified-app/src');
    const offenders: string[] = [];
    function nonCommentLines(text: string): string {
      return text.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    }
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          if (nonCommentLines(fs.readFileSync(full, 'utf-8')).includes('type="datetime-local"')) offenders.push(full);
        }
      }
    }
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('No business-date form uses manual DD/MM/YYYY text entry anymore', () => {
  it.each(FORMS_CONVERTED_TO_DATE_PICKER)('%s does not render a manual DD/MM/YYYY placeholder text input', (rel) => {
    expect(src(rel)).not.toMatch(/placeholder="15\/06\/2026"/);
  });
  it('the removed manual-entry helpers (combineManualDateTime, splitToManualParts) no longer exist anywhere in the app', () => {
    const root = path.resolve(__dirname, '../../unified-app/src');
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf-8');
          if (/\bcombineManualDateTime\(/.test(text) || /\bsplitToManualParts\(/.test(text)) offenders.push(full);
        }
      }
    }
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('Each converted form now uses a single native date-only picker', () => {
  it.each(FORMS_CONVERTED_TO_DATE_PICKER)('%s renders a native type="date" input locked to Gregorian/English digits', (rel) => {
    const s = src(rel);
    expect(s).toMatch(/type="date" lang="en-GB" dir="ltr"/);
  });
  it.each(FORMS_CONVERTED_TO_DATE_PICKER)('%s reuses dateOnlyToApiDate from the shared utility rather than a bespoke normalizer', (rel) => {
    expect(src(rel)).toMatch(/dateOnlyToApiDate/);
  });
});

describe('No user-facing time field remains in any business-date scheduling form', () => {
  it.each(FORMS_CONVERTED_TO_DATE_PICKER)('%s has no type="time" input', (rel) => {
    expect(src(rel)).not.toMatch(/type="time"/);
  });
  it.each(FORMS_CONVERTED_TO_DATE_PICKER)('%s renders no "Time"/"الوقت" label for date scheduling', (rel) => {
    const s = src(rel);
    expect(s).not.toMatch(/>{?\s*"?Time"?\s*}?</);
    expect(s).not.toMatch(/الوقت/);
  });
  it('the dead dashboard.manualDate/manualTime/invalidDateTime i18n keys were removed, not just left unused', () => {
    const i18nSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/i18n.ts'), 'utf-8');
    expect(i18nSrc).not.toMatch(/manualDate:/);
    expect(i18nSrc).not.toMatch(/manualTime:/);
    expect(i18nSrc).not.toMatch(/invalidDateTime:/);
  });
});

describe('Native date-only inputs (business-date fields with no time) are locked to Gregorian/English-digit rendering', () => {
  const NATIVE_DATE_ONLY_SITES: Array<[string, RegExp]> = [
    ['technician/pages/TaskDetail.tsx', /type="date" required lang="en-GB" dir="ltr" value=\{completeForm\.actualCompletionDate\}/],
    ['technician/pages/TaskDetail.tsx', /type="date" lang="en-GB" dir="ltr" value=\{postponeDate\}/],
    ['technician/pages/Expenses.tsx', /type="date" required lang="en-GB" dir="ltr" value=\{form\.date\}/],
    ['admin/pages/Expenses.tsx', /type="date" lang="en-GB" dir="ltr" value=\{filters\.from\}/],
    ['admin/pages/Expenses.tsx', /type="date" lang="en-GB" dir="ltr" value=\{filters\.to\}/],
    ['admin/pages/Reports.tsx', /type="date" lang="en-GB" dir="ltr" value=\{filters\.dateFrom\}/],
    ['admin/pages/Reports.tsx', /type="date" lang="en-GB" dir="ltr" value=\{filters\.dateTo\}/],
    ['admin/pages/Reports.tsx', /type="date" lang="en-GB" dir="ltr" value=\{apptFilters\.dateFrom\}/],
    ['admin/pages/Reports.tsx', /type="date" lang="en-GB" dir="ltr" value=\{apptFilters\.dateTo\}/],
  ];

  it.each(NATIVE_DATE_ONLY_SITES)('%s has the expected lang="en-GB" dir="ltr" native date input', (rel, re) => {
    expect(src(rel)).toMatch(re);
  });

  it('no native date input in the app is missing the lang="en-GB" lock', () => {
    const root = path.resolve(__dirname, '../../unified-app/src');
    const excluded = path.join(root, 'utils', 'dateTimeInput.ts');
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && full !== excluded) {
          const text = fs.readFileSync(full, 'utf-8');
          for (const m of text.matchAll(/<input[^>]*type="date"[^>]*>/g)) {
            if (!m[0].includes('lang="en-GB"')) offenders.push(`${full}: ${m[0].slice(0, 60)}`);
          }
        }
      }
    }
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('Regression: Technician Work Queue displays scheduled date only (no fabricated time)', () => {
  it('WorkQueue.tsx shows the Gregorian date via the shared formatter, with no time portion', () => {
    const s = src('technician/pages/WorkQueue.tsx');
    expect(s).toMatch(/formatGregorianDate\(appt\.scheduledDate\)/);
    expect(s).not.toMatch(/formatGregorianTime\(appt\.scheduledDate\)/);
  });
});

describe('Regression: Call Report date behavior remains correct (both departments), now date-only', () => {
  it.each(['admin/components/CallReportForm.tsx', 'scheduling/components/CallReportForm.tsx'])(
    '%s: callDate is derived from a single native date picker via dateOnlyToApiDate',
    (rel) => {
      const s = src(rel);
      expect(s).toMatch(/const callDate = dateOnlyToApiDate\(form\.date\);/);
    }
  );
  it.each(['admin/pages/CallReports.tsx', 'scheduling/pages/CallReports.tsx'])(
    '%s: the call-report list shows the date only, via the shared formatter (no fabricated time)',
    (rel) => {
      const s = src(rel);
      expect(s).toMatch(/formatGregorianDate\(r\.callDate\)/);
      expect(s).not.toMatch(/formatGregorianTime\(r\.callDate\)/);
    }
  );
});

describe('Regression: Urgent Visit date behavior remains correct, now date-only', () => {
  it('admin UrgentAppointments.tsx create form uses a single native date picker', () => {
    const s = src('admin/pages/UrgentAppointments.tsx');
    expect(s).toMatch(/const scheduledDate = dateOnlyToApiDate\(form\.date\);/);
    expect(s).toMatch(/if \(!scheduledDate \|\| !form\.city \|\| !form\.district \|\| !form\.street\)/);
  });
  it('technician UrgentAppointments.tsx list shows the urgent appointment\'s date only (no fabricated time)', () => {
    const s = src('technician/pages/UrgentAppointments.tsx');
    expect(s).toMatch(/formatGregorianDate\(a\.scheduledDate\)/);
    expect(s).not.toMatch(/formatGregorianTime\(a\.scheduledDate\)/);
  });
  it('admin UrgentAppointments.tsx visit-detail modal still shows the real submitted-at system timestamp WITH time (not a business date, not stripped)', () => {
    const s = src('admin/pages/UrgentAppointments.tsx');
    expect(s).toMatch(/formatGregorianDate\(visitDetail\.createdAt\)/);
    expect(s).toMatch(/formatGregorianTime\(visitDetail\.createdAt\)/);
  });
});

describe('Existing report timestamps that legitimately include time were not accidentally stripped', () => {
  it('PDF/report generation footers still show a full date+time (formatGregorianDateTime), not date-only', () => {
    for (const rel of ['admin/pages/Reports.tsx', 'admin/pages/Customers.tsx', 'admin/pages/CustomerDetail.tsx', 'admin/pages/Expenses.tsx']) {
      expect(src(rel)).toMatch(/formatGregorianDateTime\(new Date\(\), \{ utc: false \}\)/);
    }
  });
});

describe('Regression: Modification #8 (actualCompletionDate date-only, capped at today) still holds', () => {
  it('TaskDetail.tsx still requires actualCompletionDate via a native date-only input, capped at today', () => {
    const s = src('technician/pages/TaskDetail.tsx');
    expect(s).toMatch(/type="date" required lang="en-GB" dir="ltr" value=\{completeForm\.actualCompletionDate\}\s+max=\{todayDateInputValue\(\)\}/);
  });
});
