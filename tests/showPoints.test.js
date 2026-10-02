// showPoints.test.js — the derived championship-points engine (Show Tracking
// Spec §4). Points are never stored, so this pure core is the only place a
// dog's title progress comes from; a wrong count here would tell a breeder a dog
// has (or hasn't) finished. Pins the spec §10 Phase 2 list: CH incomplete /
// complete, the per-show cap, same-judge majors, ignored events, GCH gating on
// CH (logged title or completed track), the before-CH exclusion, string points
// and champion defeats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_TRACKS } from '../shared/data/vocab.js';
import {
  eventPoints,
  normalizeJudge,
  trackProgress,
  titleEarnedEvent,
  showRecordFrom,
} from '../shared/data/showPoints.js';

const CH = TITLE_TRACKS.find((t) => t.value === 'akc_ch');
const GCH = TITLE_TRACKS.find((t) => t.value === 'akc_gch');

let seq = 0;
const show = (date, points, judge, over = {}) => ({
  id: `s${++seq}`,
  event_type: 'show',
  event_date: date,
  is_archived: false,
  created_at: `${date}T00:00:00.000Z`,
  ...over,
  details: { entry_status: 'shown', points_toward: 'akc_ch', points, judge, ...(over.details || {}) },
});
const titled = (date, abbr, over = {}) => ({
  id: `t${++seq}`, event_type: 'title_earned', event_date: date, is_archived: false,
  details: { title_abbreviation: abbr, organization: 'AKC' }, ...over,
});
const gch = (date, points, judge, details = {}) => show(date, points, judge, { details: { points_toward: 'akc_gch', ...details } });

// A finished CH: 15 points, majors under two judges (A, B), a third judge (C).
const finishedCh = () => [
  show('2026-01-03', 3, 'Judge A'),
  show('2026-01-10', 4, 'Judge B'),
  show('2026-02-01', 2, 'Judge C'),
  show('2026-02-08', 2, 'Judge C'),
  show('2026-03-01', 2, 'Judge A'),
  show('2026-03-15', 2, 'Judge D'), // 15th point
];

// --- Helpers -----------------------------------------------------------------

test('eventPoints coerces strings and treats blank / junk / negative as 0', () => {
  assert.equal(eventPoints({ details: { points: 3 } }), 3);
  assert.equal(eventPoints({ details: { points: '3' } }), 3);
  assert.equal(eventPoints({ details: { points: '' } }), 0);
  assert.equal(eventPoints({ details: { points: 'two' } }), 0);
  assert.equal(eventPoints({ details: { points: -2 } }), 0);
  assert.equal(eventPoints({ details: {} }), 0);
  assert.equal(eventPoints({}), 0);
});

test('normalizeJudge trims, collapses whitespace and case-folds', () => {
  assert.equal(normalizeJudge('  Mrs. Jane   DOE '), 'mrs. jane doe');
  assert.equal(normalizeJudge(null), '');
});

// --- CH ------------------------------------------------------------------------

test('CH incomplete: tally and human-readable gaps', () => {
  const p = trackProgress([
    show('2026-01-03', 3, 'Judge A'),
    show('2026-01-10', 2, 'Judge B'),
    show('2026-01-17', 2, 'Judge C'),
  ], CH);
  assert.equal(p.points, 7);
  assert.equal(p.majors, 1);
  assert.equal(p.majorJudges, 1);
  assert.equal(p.judges, 3);
  assert.equal(p.complete, false);
  assert.equal(p.completedOn, null);
  assert.deepEqual(p.missing, ['8 more points', '1 more major under a new judge']);
});

test('CH with no wins yet asks for majors under different judges', () => {
  const p = trackProgress([], CH);
  assert.equal(p.points, 0);
  assert.deepEqual(p.missing, ['15 more points', '2 majors under 2 different judges', 'points under 3 more judges']);
});

test('CH complete, with the completing win dated', () => {
  const p = trackProgress(finishedCh(), CH);
  assert.equal(p.points, 15);
  assert.equal(p.complete, true);
  assert.deepEqual(p.missing, []);
  assert.equal(p.completedOn, '2026-03-15');
});

test('completedOn is the first win that satisfies every requirement, not the last win', () => {
  const p = trackProgress([...finishedCh(), show('2026-04-01', 2, 'Judge E')], CH);
  assert.equal(p.points, 17);
  assert.equal(p.completedOn, '2026-03-15');
});

test('points over the per-show max are clamped', () => {
  const p = trackProgress([show('2026-01-03', 7, 'Judge A')], CH);
  assert.equal(p.points, 5);
  assert.equal(p.majors, 1);
});

test('two majors under the same judge count as one major judge', () => {
  const p = trackProgress([
    show('2026-01-03', 5, 'Judge A'),
    show('2026-01-04', 5, ' judge a '),
    show('2026-01-10', 2, 'Judge B'),
    show('2026-01-11', 2, 'Judge C'),
    show('2026-01-12', 1, 'Judge D'),
  ], CH);
  assert.equal(p.points, 15);
  assert.equal(p.majors, 2);
  assert.equal(p.majorJudges, 1);
  assert.equal(p.complete, false);
  assert.deepEqual(p.missing, ['1 more major under a new judge']);
});

test('a blank judge never counts as a distinct judge', () => {
  const p = trackProgress([show('2026-01-03', 3, ''), show('2026-01-04', 3, '  ')], CH);
  assert.equal(p.majors, 2);
  assert.equal(p.majorJudges, 0);
  assert.equal(p.judges, 0);
});

test('non-shown, wrong-track, zero-point, archived and non-show events are ignored', () => {
  const p = trackProgress([
    show('2026-01-03', 3, 'Judge A'),
    show('2026-01-04', 3, 'Judge B', { details: { entry_status: 'entered' } }),
    show('2026-01-05', 3, 'Judge B', { details: { entry_status: 'absent' } }),
    show('2026-01-06', 3, 'Judge B', { details: { points_toward: 'akc_gch' } }),
    show('2026-01-07', 3, 'Judge B', { details: { points_toward: '' } }),
    show('2026-01-08', 0, 'Judge B'),
    show('2026-01-09', 3, 'Judge B', { is_archived: true }),
    { id: 'x', event_type: 'note', event_date: '2026-01-10', details: { entry_status: 'shown', points_toward: 'akc_ch', points: 3, judge: 'Judge B' } },
  ], CH);
  assert.equal(p.points, 3);
  assert.equal(p.majors, 1);
  assert.equal(p.judges, 1);
});

test('string points from a CSV import count like numbers', () => {
  const p = trackProgress([show('2026-01-03', '3', 'Judge A'), show('2026-01-04', '2', 'Judge B')], CH);
  assert.equal(p.points, 5);
  assert.equal(p.majors, 1);
});

// --- GCH -------------------------------------------------------------------------

test('GCH with no CH date is incomplete ("CH not yet earned") but still tallies', () => {
  const p = trackProgress([gch('2026-05-01', 3, 'Judge A')], GCH);
  assert.equal(p.points, 3);
  assert.equal(p.complete, false);
  assert.equal(p.missing[0], 'CH not yet earned');
  assert.equal(p.notCounted, 0);
});

test('GCH wins on or before the CH date are excluded and counted in notCounted', () => {
  const p = trackProgress([
    gch('2026-03-01', 3, 'Judge A'),
    gch('2026-03-15', 3, 'Judge B'), // same day as CH — not after it
    gch('2026-04-01', 2, 'Judge C'),
  ], GCH, { since: '2026-03-15' });
  assert.equal(p.points, 2);
  assert.equal(p.notCounted, 2);
  assert.ok(!p.missing.includes('CH not yet earned'));
});

test('champion defeats are counted among counting GCH wins', () => {
  const p = trackProgress([
    gch('2026-05-01', 3, 'Judge A', { defeated_champion: 'Yes' }),
    gch('2026-05-02', 1, 'Judge B', { defeated_champion: 'No' }),
    gch('2026-05-03', 1, 'Judge C', { defeated_champion: 'Yes' }),
  ], GCH, { since: '2026-04-01' });
  assert.equal(p.championDefeats, 2);
  assert.ok(p.missing.includes('defeat a champion at 1 more show'));
});

test('GCH complete after CH', () => {
  const events = [
    gch('2026-05-01', 5, 'Judge A', { defeated_champion: 'Yes' }),
    gch('2026-05-02', 5, 'Judge B', { defeated_champion: 'Yes' }),
    gch('2026-05-03', 5, 'Judge C', { defeated_champion: 'Yes' }),
    gch('2026-05-04', 5, 'Judge D'),
    gch('2026-05-05', 5, 'Judge D'),
  ];
  const p = trackProgress(events, GCH, { since: '2026-04-01' });
  assert.equal(p.points, 25);
  assert.equal(p.complete, true);
  assert.equal(p.completedOn, '2026-05-05');
});

// --- showRecordFrom: requires resolution ------------------------------------------

test('titleEarnedEvent matches the abbreviation case-insensitively, earliest first, skipping archived', () => {
  const evs = [titled('2026-06-01', 'ch'), titled('2026-05-01', 'CH', { is_archived: true }), titled('2026-07-01', ' CH ')];
  assert.equal(titleEarnedEvent(evs, 'CH').event_date, '2026-06-01');
  assert.equal(titleEarnedEvent(evs, 'GCH'), null);
});

test('a logged CH title unlocks GCH even with no CH show history', () => {
  const rec = showRecordFrom([
    titled('2025-11-01', 'ch'),
    gch('2025-10-01', 3, 'Judge A'), // before the title — not counted
    gch('2026-01-01', 3, 'Judge B'),
  ]);
  assert.equal(rec.tracks.length, 1);
  const [row] = rec.tracks;
  assert.equal(row.track.value, 'akc_gch');
  assert.equal(row.since, '2025-11-01');
  assert.equal(row.progress.points, 3);
  assert.equal(row.progress.notCounted, 1);
  assert.ok(!row.progress.missing.includes('CH not yet earned'));
});

test('a completed CH track unlocks GCH from the completing win, earliest of that and a logged title', () => {
  const evs = [...finishedCh(), gch('2026-03-15', 3, 'Judge X'), gch('2026-03-20', 3, 'Judge Y')];
  let rec = showRecordFrom(evs);
  const gRow = rec.tracks.find((r) => r.track.value === 'akc_gch');
  assert.equal(gRow.since, '2026-03-15');
  assert.equal(gRow.progress.points, 3);
  assert.equal(gRow.progress.notCounted, 1);

  // A title logged later than the completing win doesn't push the date out.
  rec = showRecordFrom([...evs, titled('2026-04-30', 'CH')]);
  assert.equal(rec.tracks.find((r) => r.track.value === 'akc_gch').since, '2026-03-15');
  assert.equal(rec.tracks.find((r) => r.track.value === 'akc_ch').titleEvent.event_date, '2026-04-30');
});

test('only tracks the dog has show events for get a row; history is newest first and excludes archived', () => {
  const evs = [
    show('2026-01-03', 3, 'Judge A'),
    show('2026-02-03', 0, 'Judge B', { details: { entry_status: 'entered' } }),
    show('2026-01-20', 1, 'Judge C', { is_archived: true }),
    titled('2026-01-01', 'CH'),
  ];
  const rec = showRecordFrom(evs);
  assert.deepEqual(rec.tracks.map((r) => r.track.value), ['akc_ch']);
  assert.deepEqual(rec.history.map((e) => e.event_date), ['2026-02-03', '2026-01-03']);
  assert.deepEqual(showRecordFrom([]).tracks, []);
});
