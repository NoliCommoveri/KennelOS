// dateUtils.js — "what is today" and date-only arithmetic as YYYY-MM-DD strings
// (date-only fields compare lexicographically as LOCAL calendar strings; only
// created_at/updated_at are full ISO/UTC). Self-contained copy of the breeder
// app's helpers so Furever's data layer has no cross-app import.
//
// Deliberately LOCAL time (getFullYear/getMonth/getDate), not UTC — "today"
// should match the family's own wall clock.
export function formatYMD(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayYMD() {
  return formatYMD(new Date());
}

// n days after a given YYYY-MM-DD (negative = before). Parses as local calendar
// components, matching todayYMD's local-time convention.
export function addDaysToYMD(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return formatYMD(date);
}

// n weeks after a given YYYY-MM-DD (negative = before).
export function addWeeksToYMD(ymd, n) {
  return addDaysToYMD(ymd, n * 7);
}

// n months after a given YYYY-MM-DD (negative = before). Day-of-month is clamped
// by the Date object (e.g. Jan 31 + 1mo → Mar 3 in JS); acceptable for care
// scheduling, where the grain is "about a month out".
export function addMonthsToYMD(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1 + n, d);
  return formatYMD(date);
}

// n years after a given YYYY-MM-DD (negative = before).
export function addYearsToYMD(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y + n, m - 1, d);
  return formatYMD(date);
}

// Add an {unit, value} offset to an anchor date. Central so the schedule engine
// and any UI use ONE definition of "8 weeks after DOB", "1 year after".
export function addOffset(ymd, { unit, value }) {
  switch (unit) {
    case 'day':   return addDaysToYMD(ymd, value);
    case 'week':  return addWeeksToYMD(ymd, value);
    case 'month': return addMonthsToYMD(ymd, value);
    case 'year':  return addYearsToYMD(ymd, value);
    default: throw new Error(`addOffset: unknown unit "${unit}"`);
  }
}

// Whole days from `fromYMD` to `toYMD` (positive if toYMD is later). Used by the
// schedule engine to bucket a due date into overdue / due-soon / upcoming.
export function daysBetween(fromYMD, toYMD) {
  const [fy, fm, fd] = fromYMD.split('-').map(Number);
  const [ty, tm, td] = toYMD.split('-').map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Split a partial date ("YYYY" or "YYYY-MM") into its parts, for pre-filling an
// edit form. Returns { year: '', month: '' } for anything unrecognized.
export function parsePartialDate(value) {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(value || '');
  if (!m) return { year: '', month: '' };
  return { year: m[1], month: m[2] || '' };
}

// Human label for a partial "joined the family" date — deliberately never a day,
// just "2024" or "June 2024" (dateUtils.js §joined-family field). Falls back to
// the raw string for anything unrecognized rather than hiding it.
export function formatPartialDate(value) {
  if (!value) return '';
  const { year, month } = parsePartialDate(value);
  if (!year) return value;
  if (!month) return year;
  const name = MONTH_NAMES[Number(month) - 1];
  return name ? `${name} ${year}` : value;
}
