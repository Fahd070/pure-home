// Date input/date display normalization batch: source-level regression tests
// for every business-date form control across the app. Follows this project's
// established pattern (see technicianNameCompletion.test.ts, dateTimeInput.test.ts)
// -- source-level assertions against the exact production wiring.
//
// Scope recap: business-date fields (appointment date, completion date,
// postpone date, call date, expense date, report filters) must never use
// <input type="datetime-local"> or ask for a time inside a date-only field.
// Where an appointment/call genuinely needs BOTH a date and a time, the two
// remain separate manual DD/MM/YYYY + HH:MM fields (the existing Modification
// #4 pattern, now reused everywhere instead of duplicated ad hoc). Native
// <input type="date"> fields keep their calendar-picker UX but gain
// lang="en-GB" dir="ltr" (Chromium/Electron's documented mechanism for
// locking a form control's locale independent of the page's own language).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function src(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../unified-app/src', rel), 'utf-8');
}

const FORMS_CONVERTED_FROM_DATETIME_LOCAL = [
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
  it.each(FORMS_CONVERTED_FROM_DATETIME_LOCAL)('%s no longer contains a datetime-local input', (rel) => {
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

describe('Each converted form now uses separate manual DD/MM/YYYY + HH:MM fields', () => {
  it.each(FORMS_CONVERTED_FROM_DATETIME_LOCAL)('%s reuses combineManualDateTime from the shared utility', (rel) => {
    expect(src(rel)).toMatch(/combineManualDateTime/);
  });

  it.each(FORMS_CONVERTED_FROM_DATETIME_LOCAL)('%s renders two manual text inputs with dir="ltr" (date + time, not a native picker)', (rel) => {
    const s = src(rel);
    const manualInputs = s.match(/inputMode="numeric" dir="ltr"/g) || [];
    expect(manualInputs.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Appointment scheduling time is preserved as a separate field, not removed', () => {
  it('admin Appointments.tsx: manualDate and manualTime are both required, distinct state fields', () => {
    const s = src('admin/pages/Appointments.tsx');
    expect(s).toMatch(/manualDate: "", manualTime: ""/);
    expect(s).toMatch(/combineManualDateTime\(form\.manualDate, form\.manualTime\)/);
  });
  it('scheduling NewAppointment.tsx: manualDate and manualTime are both present', () => {
    const s = src('scheduling/pages/NewAppointment.tsx');
    expect(s).toMatch(/manualDate: "", manualTime: ""/);
    expect(s).toMatch(/combineManualDateTime\(form\.manualDate, form\.manualTime\)/);
  });
  it('admin UrgentAppointments.tsx create form: manualDate and manualTime are both present', () => {
    const s = src('admin/pages/UrgentAppointments.tsx');
    expect(s).toMatch(/manualDate: "", manualTime: ""/);
  });
});

describe('Native date-only inputs (no time needed) are locked to Gregorian/English-digit rendering', () => {
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
    // dateTimeInput.ts itself is the utility module -- it only ever mentions
    // `<input type="date">` inside a JSDoc comment describing what calls it,
    // never a real form control.
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

describe('Regression: Modification #4 (EditApptModal manual date/time) still works unchanged', () => {
  it('admin Dashboard.tsx EditApptModal still uses splitToManualParts + combineManualDateTime', () => {
    const s = src('admin/pages/Dashboard.tsx');
    expect(s).toMatch(/const initialParts = splitToManualParts\(appt\.scheduledDate\);/);
    expect(s).toMatch(/const scheduledDate = combineManualDateTime\(form\.manualDate, form\.manualTime\);/);
  });
  it('scheduling Dashboard.tsx EditApptModal still uses splitToManualParts + combineManualDateTime', () => {
    const s = src('scheduling/pages/Dashboard.tsx');
    expect(s).toMatch(/const initialParts = splitToManualParts\(appt\.scheduledDate\);/);
    expect(s).toMatch(/const scheduledDate = combineManualDateTime\(form\.manualDate, form\.manualTime\);/);
  });
  it('the wire-format contract (YYYY-MM-DDTHH:mm) is unchanged -- combineManualDateTime is still the single source of the value sent to the backend', () => {
    const dtiSrc = src('utils/dateTimeInput.ts');
    expect(dtiSrc).toMatch(/return `\$\{year\}-\$\{month\}-\$\{day\}T\$\{timeStr\.trim\(\)\}`;/);
  });
});

describe('Regression: Modification #8 (actualCompletionDate is date-only, distinct from completedAt) still holds', () => {
  it('TaskDetail.tsx still requires actualCompletionDate via a native date-only input, capped at today', () => {
    const s = src('technician/pages/TaskDetail.tsx');
    expect(s).toMatch(/type="date" required lang="en-GB" dir="ltr" value=\{completeForm\.actualCompletionDate\}\s+max=\{todayDateInputValue\(\)\}/);
  });
  it('completedAt is never conflated with actualCompletionDate in the completion payload', () => {
    const s = src('technician/pages/TaskDetail.tsx');
    expect(s).not.toMatch(/completedAt:\s*completeForm/);
  });
});

describe('Regression: Technician Work Queue displays scheduled date and time, standardized', () => {
  it('WorkQueue.tsx shows the Gregorian date and time together via the shared formatter, not a naked toLocaleString', () => {
    const s = src('technician/pages/WorkQueue.tsx');
    expect(s).toMatch(/formatGregorianDate\(appt\.scheduledDate\)/);
    expect(s).toMatch(/formatGregorianTime\(appt\.scheduledDate\)/);
    expect(s).not.toMatch(/toLocaleString|toLocaleDateString/);
  });
});

describe('Regression: Call Report date behavior remains correct (both departments)', () => {
  it.each(['admin/components/CallReportForm.tsx', 'scheduling/components/CallReportForm.tsx'])(
    '%s: callDate is still assembled from manual date+time and padded to :00 seconds, matching the pre-existing wire contract',
    (rel) => {
      const s = src(rel);
      expect(s).toMatch(/const combined = combineManualDateTime\(form\.manualDate, form\.manualTime\);/);
      expect(s).toMatch(/const callDate = combined \+ ":00";/);
    }
  );
  it.each(['admin/pages/CallReports.tsx', 'scheduling/pages/CallReports.tsx'])(
    '%s: the call-report list still shows date and time together via the shared formatter',
    (rel) => {
      const s = src(rel);
      expect(s).toMatch(/formatGregorianDate\(r\.callDate\)/);
      expect(s).toMatch(/formatGregorianTime\(r\.callDate\)/);
    }
  );
});

describe('Regression: Urgent Visit date behavior remains correct', () => {
  it('admin UrgentAppointments.tsx create form still requires a date and time before submit', () => {
    const s = src('admin/pages/UrgentAppointments.tsx');
    expect(s).toMatch(/const scheduledDate = combineManualDateTime\(form\.manualDate, form\.manualTime\);/);
    expect(s).toMatch(/if \(!scheduledDate \|\| !form\.city \|\| !form\.district \|\| !form\.street\)/);
  });
  it('technician UrgentAppointments.tsx list still shows the urgent appointment\'s date and time via the shared formatter', () => {
    const s = src('technician/pages/UrgentAppointments.tsx');
    expect(s).toMatch(/formatGregorianDate\(a\.scheduledDate\)/);
    expect(s).toMatch(/formatGregorianTime\(a\.scheduledDate\)/);
  });
});

describe('Existing report timestamps that legitimately include time were not accidentally stripped', () => {
  it('PDF/report generation footers still show a full date+time (formatGregorianDateTime), not date-only', () => {
    for (const rel of ['admin/pages/Reports.tsx', 'admin/pages/Customers.tsx', 'admin/pages/CustomerDetail.tsx', 'admin/pages/Expenses.tsx']) {
      expect(src(rel)).toMatch(/formatGregorianDateTime\(new Date\(\), \{ utc: false \}\)/);
    }
  });
});
