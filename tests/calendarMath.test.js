// calendarMath.test.js — the Calendar page's pure arithmetic (data/calendarMath.js):
// the Sunday-first month grid, span clipping into days, and the Google link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shiftMonth, isMonth, monthGridDates, eventSpan, bucketByDay, googleCalendarUrl
} from '../shared/data/calendarMath.js';

test('shiftMonth: crosses year boundaries both ways', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-10', 0), '2026-10');
});

test('isMonth: accepts YYYY-MM only', () => {
  assert.ok(isMonth('2026-10'));
  for (const bad of ['2026-13', '2026-1', '2026-10-01', '', null, 'x']) assert.ok(!isMonth(bad), String(bad));
});

test('monthGridDates: Sunday-first, padded to whole weeks', () => {
  const cells = monthGridDates('2026-10'); // Oct 1 2026 is a Thursday
  assert.equal(cells.length % 7, 0);
  assert.deepEqual(cells.slice(0, 5), [null, null, null, null, '2026-10-01']);
  assert.equal(cells.filter(Boolean).length, 31);
  assert.equal(cells.filter(Boolean).pop(), '2026-10-31');
  assert.equal(monthGridDates('2024-02').filter(Boolean).length, 29, 'leap February');
  assert.equal(monthGridDates('2026-02')[0], '2026-02-01', 'Feb 2026 starts on a Sunday — no leading pad');
});

test('eventSpan: instant, closed span, open span', () => {
  assert.deepEqual(eventSpan({ event_date: '2026-10-05', event_end_date: '2026-10-09' }, 'instant'), ['2026-10-05', '2026-10-05']);
  assert.deepEqual(eventSpan({ event_date: '2026-10-05', event_end_date: '2026-10-09' }, 'span'), ['2026-10-05', '2026-10-09']);
  assert.deepEqual(eventSpan({ event_date: '2026-10-05', event_end_date: null }, 'span'), ['2026-10-05', '2026-10-05']);
  assert.deepEqual(eventSpan({ event_date: '2026-10-05', event_end_date: '2026-10-01' }, 'span'), ['2026-10-05', '2026-10-05'], 'end before start ignored');
});

test('bucketByDay: spans fill each day and clip to the month', () => {
  const a = { start: '2026-09-29', end: '2026-10-02' };
  const b = { start: '2026-10-31', end: '2026-11-03' };
  const c = { start: '2026-10-15', end: '2026-10-15' };
  const outside = { start: '2026-11-05', end: '2026-11-05' };
  const byDay = bucketByDay([a, b, c, outside], '2026-10');
  assert.deepEqual([...byDay.keys()].sort(), ['2026-10-01', '2026-10-02', '2026-10-15', '2026-10-31']);
  assert.deepEqual(byDay.get('2026-10-01'), [a]);
  assert.deepEqual(byDay.get('2026-10-31'), [b]);
});

test('googleCalendarUrl: all-day with an exclusive end date', () => {
  const one = new URL(googleCalendarUrl({ title: 'Bella — Vet visit', start: '2026-10-31' }));
  assert.equal(one.origin + one.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(one.searchParams.get('action'), 'TEMPLATE');
  assert.equal(one.searchParams.get('text'), 'Bella — Vet visit');
  assert.equal(one.searchParams.get('dates'), '20261031/20261101');
  assert.equal(one.searchParams.get('details'), null);

  const span = new URL(googleCalendarUrl({ title: 'x', start: '2026-12-30', end: '2027-01-02', details: 'd & e', location: 'Smith, TX' }));
  assert.equal(span.searchParams.get('dates'), '20261230/20270103');
  assert.equal(span.searchParams.get('details'), 'd & e');
  assert.equal(span.searchParams.get('location'), 'Smith, TX');
});
