// Breeding dogs' routine care (data/dogCare.js): the next heat (6 months after a
// single heat, else her average interval) and this month's preventatives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictNextHeat, heatStarts, heatForecast, preventativeGaps, breedingDogs, heatBasisText, monthName } from '../shared/data/dogCare.js';

const heat = (id, d, extra = {}) => ({ subject_type: 'dog', subject_id: id, event_type: 'heat_cycle', event_date: d, ...extra });
const prev = (id, d) => ({ subject_type: 'dog', subject_id: id, event_type: 'preventative', event_date: d });
const dog = (id, extra = {}) => ({ id, call_name: id, sex: 'female', status: 'active_breeding', ...extra });

test('one heat: the next is 6 months after it began; more: her average interval', () => {
  assert.equal(predictNextHeat([]), null);
  assert.deepEqual(predictNextHeat(['2026-05-31']), { next: '2026-11-30', last: '2026-05-31', heats: 1, basis: 'one', avgDays: null });
  const p = predictNextHeat(['2025-06-01', '2025-12-01', '2026-06-10']);
  assert.equal(p.avgDays, 187, '(183 + 191) / 2');
  assert.equal(p.next, '2026-12-14');
  assert.equal(heatBasisText(p), 'her average of 187 days between 3 heats');
  assert.equal(heatBasisText(predictNextHeat(['2026-05-01'])), '6 months after her heat on 2026-05-01');
});

test('heat starts: once each, oldest first, future ones count, archived and other dogs don\'t', () => {
  const events = [heat('a', '2026-07-01'), heat('a', '2026-01-01'), heat('a', '2026-01-01'), heat('a', '2027-01-15'),
    heat('a', '2026-03-01', { is_archived: true }), heat('b', '2026-02-01'), prev('a', '2026-02-01')];
  assert.deepEqual(heatStarts('a', events), ['2026-01-01', '2026-07-01', '2027-01-15']);
});

test('the forecast: from 30 days before, "soon"; past the date, "overdue"; a newly logged heat (even future) moves it', () => {
  const today = '2026-11-01';
  const dogs = [dog('soon'), dog('late'), dog('far'), dog('none'), dog('retired', { status: 'retired_breeding' }), dog('boy', { sex: 'male' })];
  const events = [heat('soon', '2026-05-20'), heat('late', '2026-04-01'), heat('far', '2026-09-01'), heat('retired', '2026-05-01'), heat('boy', '2026-05-01')];
  const f = heatForecast(dogs, events, today);
  assert.deepEqual(f.map((h) => [h.dog.id, h.next, h.state]), [['late', '2026-10-01', 'overdue'], ['soon', '2026-11-20', 'soon'], ['far', '2027-03-01', 'later']]);
  // She logs Late's heat with a future date: the prediction moves past the notice window.
  const after = heatForecast(dogs, [...events, heat('late', '2026-11-10')], today).find((h) => h.dog.id === 'late');
  assert.equal(after.state, 'later');
  assert.equal(after.next, '2027-06-21', 'her new average, 223 days, from 2026-11-10');
  assert.equal(heatForecast(dogs, [heat('soon', '2026-05-02')], today)[0].state, 'soon', 'the predicted day itself is still "soon"');
});

test('preventatives: active breeding dogs (both sexes) with none dated this month', () => {
  const dogs = [dog('Bea'), dog('Ash', { sex: 'male' }), dog('Cy'), dog('Pup', { status: 'puppy' }), dog('Old', { is_archived: true })];
  const events = [prev('Bea', '2026-11-03'), prev('Cy', '2026-10-30'), { ...prev('Ash', '2026-11-02'), is_archived: true }];
  assert.deepEqual(preventativeGaps(dogs, events, '2026-11-15').map((d) => d.id), ['Ash', 'Cy']);
  assert.deepEqual(preventativeGaps(dogs, [...events, prev('Ash', '2026-11-20'), prev('Cy', '2026-11-01')], '2026-11-15'), [], 'all done: the nudge goes');
  assert.deepEqual(breedingDogs(dogs, 'male').map((d) => d.id), ['Ash']);
  assert.equal(monthName('2026-11-15'), 'November 2026');
});
