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
