// ageBrackets.js — the life-stage age brackets used to GROUP a pet's care and to
// pick an age-appropriate feeding schedule. Pure content + date math, no Dexie:
// the Health page buckets its derived schedule by these ranges (auto-expanding the
// pet's current stage), and the Feeding page uses the same ranges to choose the
// default portion/frequency for the pet's age.
//
// The brackets are ordered, non-overlapping, and cover every age: each carries the
// EXCLUSIVE upper bound in months, so a value is placed in the first bracket whose
// `maxMonths` it is strictly below (the last bracket's bound is Infinity). Keep the
// `value` slugs stable — the feeding content (careLibrary.FEEDING_PLAN) keys on them.
export const AGE_BRACKETS = [
  { value: 'baby',   label: 'Up to 2 months',   maxMonths: 2 },
  { value: 'puppy',  label: '2 to 6 months',    maxMonths: 6 },
  { value: 'junior', label: '6 to 12 months',   maxMonths: 12 },
  { value: 'adult',  label: '1 year and older', maxMonths: Infinity }
];

// The average length of a month in days — for converting a schedule offset (which
// is authored in days/weeks/months/years) to an approximate age in months so an
// item can be bucketed even for a pet with no birthday on file yet.
const DAYS_PER_MONTH = 30.44;

// Approximate an { unit, value } schedule offset as a number of months. Used to
// place a schedule item in its life-stage bracket by the age it comes due AT,
// independent of the pet's DOB (so bucketing works before a birthday is set).
export function offsetToMonths(offset) {
  if (!offset || typeof offset.value !== 'number') return 0;
  switch (offset.unit) {
    case 'day':   return offset.value / DAYS_PER_MONTH;
    case 'week':  return (offset.value * 7) / DAYS_PER_MONTH;
    case 'month': return offset.value;
    case 'year':  return offset.value * 12;
    default:      return 0;
  }
}

// Whole months of age from a YYYY-MM-DD birthday to an as-of date (default today's
// caller-supplied YMD). Returns null when there's no usable DOB. Mirrors the
// month math in ui.ageLabel, but returns the number so callers can bracket on it.
export function ageInMonths(dobYMD, asOfYMD) {
  if (!dobYMD || !asOfYMD) return null;
  const [by, bm, bd] = dobYMD.split('-').map(Number);
  const [ty, tm, td] = asOfYMD.split('-').map(Number);
  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months -= 1;
  return months < 0 ? 0 : months;
}

// The bracket a given age-in-months falls in (the first whose exclusive upper
// bound it is below). Returns the bracket object; never null (adult is Infinity).
export function bracketForMonths(months) {
  const m = typeof months === 'number' ? months : 0;
  return AGE_BRACKETS.find((b) => m < b.maxMonths) || AGE_BRACKETS[AGE_BRACKETS.length - 1];
}

// Convenience: look up a bracket by its slug.
export function bracketByValue(value) {
  return AGE_BRACKETS.find((b) => b.value === value) || null;
}
