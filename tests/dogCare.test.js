// Breeding dogs' routine care (data/dogCare.js): the next heat (6 months after a
// single heat, else her average interval) and this month's preventatives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictNextHeat, heatStarts, heatForecast, preventativeGaps, breedingDogs, homeDogs, heatBasisText, monthName, otherEventTypes, dogEvents, dogEventProblem, checkinDogs, ownDogs } from '../shared/data/dogCare.js';

const heat = (id, d, extra = {}) => ({ subject_type: 'dog', subject_id: id, event_type: 'heat_cycle', event_date: d, ...extra });
const prev = (id, d) => ({ subject_type: 'dog', subject_id: id, event_type: 'preventative', event_date: d });
const dog = (id, extra = {}) => ({ id, call_name: id, sex: 'female', status: 'active_breeding', ownership_type: 'owned', ...extra });

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

test('the multi-dog forms list the dogs at home, active breeding first', () => {
  const dogs = [dog('Zed'), dog('Ret', { status: 'retired_breeding' }), dog('Sale', { status: 'for_sale' }), dog('Abe'),
    dog('Pup', { status: 'puppy' }), dog('Pet', { status: 'pet_home' }), dog('Gone', { status: 'deceased' }), dog('Ext', { status: 'external_reference' })];
  assert.deepEqual(homeDogs(dogs).map((d) => d.id), ['Abe', 'Zed', 'Ret', 'Sale']);
});

test('otherEventTypes: dog types minus what the check-in asks and what other tasks log; show only with its flag', () => {
  const types = otherEventTypes({}).map((t) => t.value);
  for (const t of ['vet_visit', 'medication', 'vaccination', 'weight_check', 'illness', 'note']) assert.ok(types.includes(t), t);
  for (const t of ['heat_cycle', 'preventative', 'genetic_test', 'ofa_pennhip', 'breed_specific_test', 'acquisition', 'placement', 'whelping_summary', 'breeding_tie', 'show']) assert.equal(types.includes(t), false, t);
  assert.ok(otherEventTypes({ shows: true }).some((t) => t.value === 'show'));
});

test('dogEvents: one per dog, titled by what she typed, else the naming field, else the label; blanks dropped', () => {
  const [a, b] = dogEvents({ eventType: 'vet_visit', dogIds: ['d1', 'd2'], date: '2026-11-01', details: { reason: ' Ear infection ', vet: '', findings: 'Otitis' } });
  assert.deepEqual(a, { subject_type: 'dog', subject_id: 'd1', event_type: 'vet_visit', event_date: '2026-11-01', title: 'Ear infection', details: { reason: 'Ear infection', findings: 'Otitis' } });
  assert.equal(b.subject_id, 'd2');
  assert.notEqual(a.details, b.details, 'each event its own details object');
  assert.equal(dogEvents({ eventType: 'vet_visit', dogIds: ['d1'], date: '2026-11-01', details: {}, title: 'Annual exam' })[0].title, 'Annual exam');
  assert.equal(dogEvents({ eventType: 'weight_check', dogIds: ['d1'], date: '2026-11-01', details: { weight_lbs: '62' } })[0].title, 'Weight check');
  const med = dogEvents({ eventType: 'medication', dogIds: ['d1'], date: '2026-11-01', endDate: '2026-11-10', details: { drug: 'Apoquel' } })[0];
  assert.equal(med.event_end_date, '2026-11-10');
  assert.equal(med.title, 'Apoquel');
});

test('dogEventProblem: a dog, a date, an end after the start, a note\'s words, a sensible cost', () => {
  const ok = { eventType: 'vet_visit', dogIds: ['d1'], date: '2026-11-01' };
  assert.equal(dogEventProblem(ok), '');
  assert.match(dogEventProblem({ ...ok, dogIds: [] }), /at least one dog/);
  assert.match(dogEventProblem({ ...ok, date: '' }), /When was it/);
  assert.match(dogEventProblem({ ...ok, endDate: '2026-10-01' }), /before the start/);
  assert.match(dogEventProblem({ ...ok, eventType: 'note' }), /note/);
  assert.equal(dogEventProblem({ ...ok, eventType: 'note', title: 'Limping a little' }), '');
  assert.match(dogEventProblem({ ...ok, cost: 'abc' }), /cost/);
  assert.match(dogEventProblem({ ...ok, cost: '-5' }), /cost/);
  assert.equal(dogEventProblem({ ...ok, cost: '85.50' }), '');
});

test('checkinDogs: the dogs she looks after (owned, co-owned, leased in or out), never external, pedigree-only, archived, deceased or in a pet home; puppies only when kept', () => {
  const dog = (id, extra) => ({ id, call_name: id, ownership_type: 'owned', status: 'active_breeding', ...extra });
  const out = checkinDogs([
    dog('Zed'), dog('Ada', { ownership_type: 'co_owned', status: 'retired_breeding' }),
    dog('Ext', { ownership_type: 'external' }), dog('Lease', { ownership_type: 'leased_in' }),
    dog('Anc', { pedigree_only: true }), dog('Gone', { status: 'deceased' }), dog('Arch', { is_archived: true }),
    dog('Pip', { status: 'puppy', disposition: 'keeping' }), dog('Sold', { status: 'puppy', disposition: 'available' }),
    dog('Bea'), dog('Pet', { status: 'pet_home' }), dog('Out', { ownership_type: 'leased_out', status: 'retired_breeding' }),
    dog('Ref', { status: 'external_reference' })
  ]).map((d) => d.id);
  assert.deepEqual(out, ['Bea', 'Lease', 'Zed', 'Ada', 'Out', 'Pip']);
});

test('ownDogs / breedingDogs / homeDogs: only the dogs she looks after; heats and preventatives are those dogs\' active breeding ones', () => {
  const dog = (id, extra) => ({ id, call_name: id, ownership_type: 'owned', status: 'active_breeding', sex: 'female', ...extra });
  const dogs = [dog('Mine'), dog('Co', { ownership_type: 'co_owned', sex: 'male' }), dog('Stud', { ownership_type: 'external', sex: 'male' }),
    dog('Lease', { ownership_type: 'leased_in' }), dog('Gone', { status: 'deceased' }), dog('Arch', { is_archived: true }), dog('Old', { status: 'retired_breeding' })];
  assert.deepEqual(ownDogs(dogs).map((d) => d.id), ['Mine', 'Co', 'Lease', 'Old']);
  assert.deepEqual(breedingDogs(dogs, 'female').map((d) => d.id), ['Mine', 'Lease'], 'heats (also Today): her active breeding females, leased in included, never External');
  assert.deepEqual(preventativeGaps(dogs, [], '2026-11-01').map((d) => d.id), ['Co', 'Lease', 'Mine'], 'preventatives (also Today)');
  assert.equal(homeDogs(dogs).some((d) => d.id === 'Stud'), false, 'Log for several dogs never lists an External dog');
});
