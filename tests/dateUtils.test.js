// dateUtils.test.js — the date-only (YYYY-MM-DD, local-calendar) helpers that the
// repos and nudge engine build on (data/dateUtils.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatYMD, todayYMD, addDaysToYMD, monthsBetween } from '../shared/data/dateUtils.js';

test('formatYMD: zero-pads month and day', () => {
  assert.equal(formatYMD(new Date(2026, 0, 5)), '2026-01-05'); // Jan = month 0
  assert.equal(formatYMD(new Date(2026, 11, 31)), '2026-12-31');
});

test('todayYMD: is a well-formed YYYY-MM-DD string', () => {
  assert.match(todayYMD(), /^\d{4}-\d{2}-\d{2}$/);
});

test('addDaysToYMD: rolls across month and year boundaries', () => {
  assert.equal(addDaysToYMD('2026-01-30', 3), '2026-02-02');
  assert.equal(addDaysToYMD('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToYMD('2026-03-01', -1), '2026-02-28');
  assert.equal(addDaysToYMD('2024-03-01', -1), '2024-02-29', 'leap year');
});

test('monthsBetween: whole months, day-of-month aware', () => {
  assert.equal(monthsBetween('2026-01-15', '2026-04-15'), 3, 'exact months');
  assert.equal(monthsBetween('2026-01-15', '2026-04-14'), 2, 'one day short → not a full 3rd month');
  assert.equal(monthsBetween('2026-01-15', '2026-04-16'), 3, 'one day past → still 3');
  assert.equal(monthsBetween('2025-06-10', '2026-06-10'), 12, 'across a year');
  assert.equal(monthsBetween('2026-01-15', '2026-01-20'), 0, 'less than a month');
});
