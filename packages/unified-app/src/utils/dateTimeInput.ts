// Manual date/time entry for the maintenance report form: two plain text
// fields (DD/MM/YYYY, HH:MM) instead of a native datetime-local picker.
//
// DD/MM/YYYY avoids the MM/DD-vs-DD/MM ambiguity of typed slash-dates and
// matches the day-first convention this app's Arabic UI already uses
// elsewhere (customers.city/district address fields etc.). 24-hour HH:MM
// matches the exact precision/shape the previous <input type="datetime-local">
// already produced -- no new time format is introduced.
//
// combineManualDateTime reconstructs the SAME "YYYY-MM-DDTHH:mm" string
// shape the old datetime-local input's value already was (see
// splitToManualParts below), so PUT /dashboard/appointment/:id's existing
// `new Date(scheduledDate)` server-side parsing keeps behaving identically --
// this file changes only the data-entry UI, never the wire format.

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isValidManualDate(value: string): boolean {
  const m = DATE_RE.exec(value.trim());
  if (!m) return false;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  if (month < 1 || month > 12) return false;
  if (year < 1970 || year > 2200) return false;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay = month === 2 && isLeap ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= maxDay;
}

export function isValidManualTime(value: string): boolean {
  return TIME_RE.test(value.trim());
}

/** Combines DD/MM/YYYY + HH:MM into the same "YYYY-MM-DDTHH:mm" shape the
 *  old datetime-local input already sent, or null if either part is invalid. */
export function combineManualDateTime(dateStr: string, timeStr: string): string | null {
  if (!isValidManualDate(dateStr) || !isValidManualTime(timeStr)) return null;
  const m = DATE_RE.exec(dateStr.trim())!;
  const [, day, month, year] = m;
  return `${year}-${month}-${day}T${timeStr.trim()}`;
}

/** Splits a stored scheduledDate value into DD/MM/YYYY + HH:MM for prefilling
 *  the manual-entry form, using the same UTC-based extraction the old
 *  `new Date(x).toISOString().slice(0,16)` prefill already relied on. */
export function splitToManualParts(isoValue: string): { date: string; time: string } {
  if (!isoValue) return { date: "", time: "" };
  const d = new Date(isoValue);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const [datePart, timePart] = d.toISOString().slice(0, 16).split("T");
  const [year, month, day] = datePart.split("-");
  return { date: `${day}/${month}/${year}`, time: timePart };
}

// --- Gregorian, English-digit, locale-independent BUSINESS DATE display ---
//
// Root cause of "weird" Arabic-device date rendering: naked toLocaleDateString()/
// toLocaleString() calls (many of them explicitly passed "ar-SA" when the UI is
// Arabic) inherit the OS/browser locale, which can switch both the calendar
// (Hijri) and the digits (Arabic-Indic ٠١٢٣...) even though Arabic UI TEXT is
// fine to stay Arabic. The `-u-ca-gregory-nu-latn` BCP-47 extension explicitly
// locks the calendar to Gregorian and digits to Latin/English regardless of
// device locale -- these functions must be used for every BUSINESS DATE
// display; real timestamps (createdAt/message activity feeds/etc.) are out of
// scope unless already broken by this exact naked-toLocale* pattern.
//
// All stored business-date/datetime API values (scheduledDate,
// actualCompletionDate, postponements[].newDate, callDate, createdAt,
// installationDate, lastMaintenance, nextMaintenance, expense.date) are read
// back via UTC extraction (utc=true, the default) -- matching
// splitToManualParts above and guaranteeing the displayed value never shifts
// due to the VIEWING machine's local timezone: date-only strings parse as UTC
// midnight per the ISO 8601 spec, and datetime strings are written/read by a
// UTC backend, so UTC extraction on the frontend always reconstructs exactly
// what was typed, on any device in any timezone (verified for the Saudi
// +03:00 case explicitly -- see dateFormat.test.ts).
// Pass { utc: false } only for ephemeral local-only Date objects that were
// never round-tripped through the API (e.g. a "this calendar week" label
// built from `new Date()` for a report period caption).

/** Converts a LOCAL-midnight Date object (e.g. `new Date(y, m, d)`) into its
 *  own YYYY-MM-DD string by reading its local y/m/d fields directly -- never
 *  via `.toISOString()`, which forces a UTC conversion and can shift the
 *  result back a calendar day in a positive-offset timezone like Saudi's
 *  +03:00 (local midnight becomes 21:00 the previous day in UTC). Use this
 *  for report date-range boundaries built from local Date arithmetic;
 *  formatGregorianDate's UTC-extraction default is for the different case of
 *  reading back a value that was already round-tripped through the API. */
export function localDateOnlyStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's date in the local YYYY-MM-DD form a native `<input type="date">`
 *  expects -- offsets by the local timezone before UTC-slicing so the result
 *  is the viewing device's local calendar day, not UTC's (which can be a day
 *  off around local midnight, e.g. in Saudi's +03:00 the UTC day rolls over 3
 *  hours after local midnight). Matches the pre-existing, already-correct
 *  Modification #8 pattern this project established for the same purpose. */
export function todayDateOnly(): string {
  const d = new Date();
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
}

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** DD/MM/YYYY, Gregorian, English digits, no time. The one shared formatter
 *  for every business-date display across the app. Returns "" for null/
 *  undefined/invalid input -- callers keep their existing `? ... : "—"`
 *  placeholder convention around the call. */
export function formatGregorianDate(value: Date | string | null | undefined, opts?: { utc?: boolean }): string {
  const d = toValidDate(value);
  if (!d) return "";
  const utc = opts?.utc !== false;
  return new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
    day: "2-digit", month: "2-digit", year: "numeric",
    ...(utc ? { timeZone: "UTC" } : {}),
  }).format(d);
}

/** HH:MM, 24-hour, English digits -- for the rare read-only display that
 *  needs a business date's time portion shown separately from its date. */
export function formatGregorianTime(value: Date | string | null | undefined, opts?: { utc?: boolean }): string {
  const d = toValidDate(value);
  if (!d) return "";
  const utc = opts?.utc !== false;
  return new Intl.DateTimeFormat("en-GB-u-nu-latn", {
    hour: "2-digit", minute: "2-digit", hour12: false,
    ...(utc ? { timeZone: "UTC" } : {}),
  }).format(d);
}

/** "DD/MM/YYYY HH:MM" -- for read-only combined display of a value that
 *  genuinely carries both a business date and a meaningful clock time (e.g.
 *  an appointment's scheduledDate). Never used for an INPUT control -- input
 *  forms keep date and time as two separate fields per the project's
 *  established manual-entry pattern above. */
export function formatGregorianDateTime(value: Date | string | null | undefined, opts?: { utc?: boolean }): string {
  const d = toValidDate(value);
  if (!d) return "";
  return `${formatGregorianDate(d, opts)} ${formatGregorianTime(d, opts)}`;
}

/** Localized month+year label (e.g. "August 2026" / "أغسطس 2026") for report
 *  period captions -- the month NAME is allowed to follow the UI language
 *  (Arabic text may stay Arabic), but the calendar/digits stay locked
 *  Gregorian/Latin. Always local (never UTC-forced): callers pass ephemeral
 *  Date objects built from `new Date(y, m, d)` for "this local calendar
 *  month/week", never a round-tripped API value. */
export function formatGregorianMonthYear(value: Date | string | null | undefined, isAr: boolean): string {
  const d = toValidDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(isAr ? "ar-SA-u-ca-gregory-nu-latn" : "en-US-u-ca-gregory-nu-latn", {
    month: "long", year: "numeric",
  }).format(d);
}
