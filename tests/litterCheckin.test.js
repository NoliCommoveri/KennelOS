// litterCheckin.test.js — Kels's "Check in on a litter" task, its data half
// (data/litterCheckin.js): which litters are offered, what Kels brings up about
// one (picks, Weaning, Ready, and Today's sold / reopen / close rules), weights
// and how they compare, and the care events he writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../shared/data/litterCheckin.js';
import { addDaysToYMD } from '../shared/data/dateUtils.js';

const today = '2026-10-14';
const ago = (n) => addDaysToYMD(today, -n);
const litter = (extra = {}) => ({ id: 'L', status: 'whelped', whelp_date: ago(10), dam_id: 'd', sire_id: 's', ...extra });
const pup = (id, extra = {}) => ({ id, litter_id: 'L', status: 'puppy', disposition: 'undecided', call_name: id, ...extra });
const ids = (list) => list.map((s) => `${s.id}:${s.status || ''}${s.reopen ? ':reopen' : ''}`);

test('every litter that isn\'t closed or archived is offered, pups at home first, newest born first', () => {
  const list = C.checkinLitters([
    { id: 'closed', status: 'closed', whelp_date: ago(90) },
    { id: 'arch', status: 'whelped', whelp_date: ago(3), is_archived: true },
    { id: 'sold', status: 'sold', whelp_date: ago(80) },
    { id: 'exp', status: 'expected' },
    { id: 'old', status: 'ready', whelp_date: ago(60) },
    { id: 'new', status: 'whelped', whelp_date: ago(5) }
  ]);
  assert.deepEqual(list.map((l) => l.id), ['new', 'old', 'exp', 'sold']);
});

test('age reads in days, then weeks and days', () => {
  assert.equal(C.ageText(1), '1 day old');
  assert.equal(C.ageText(10), '10 days old');
  assert.equal(C.ageText(21), '3 weeks old');
  assert.equal(C.ageText(30), '4 weeks 2 days old');
  assert.equal(C.ageText(225), '7 months old');
  assert.equal(C.ageText(-2), null);
  assert.equal(C.ageDays(litter(), today), 10);
});

test('the roster drops archived and deceased pups; at home drops grown dogs and delivered ones', () => {
  const dogs = [pup('a'), pup('b', { status: 'deceased' }), pup('c', { is_archived: true }), pup('d', { status: 'active_breeding', disposition: null }), pup('e', { disposition: 'placed' }), { id: 'x', litter_id: 'other', status: 'puppy' }];
  const roster = C.rosterOf('L', dogs);
  assert.deepEqual(roster.map((d) => d.id), ['a', 'd', 'e']);
  assert.deepEqual(C.homePups(roster, [{ dog_id: 'e', status: 'delivered' }]).map((d) => d.id), ['a']);
  assert.deepEqual(C.homePups(roster, [{ dog_id: 'e', status: 'deposit_paid' }]).map((d) => d.id), ['a', 'e']);
  assert.equal(C.dispositionSummary([pup('a', { disposition: 'available' }), pup('b', { disposition: 'available' }), pup('c')]), '3 puppies: 1 undecided, 2 available.');
});

test('Weaning is offered from 4 weeks while Whelped, Ready from the ready date while Weaning', () => {
  const roster = [pup('a')];
  assert.deepEqual(ids(C.checkinSuggestions({ litter: litter({ whelp_date: ago(27) }), roster, today })), []);
  assert.deepEqual(ids(C.checkinSuggestions({ litter: litter({ whelp_date: ago(28) }), roster, today })), ['status:weaning']);
  assert.deepEqual(ids(C.checkinSuggestions({ litter: litter({ status: 'weaning', whelp_date: ago(40), estimated_ready_date: ago(-3) }), roster, today })), []);
  assert.deepEqual(ids(C.checkinSuggestions({ litter: litter({ status: 'weaning', whelp_date: ago(40), estimated_ready_date: today }), roster, today })), ['status:ready']);
  // No ready date: 8 weeks.
  assert.deepEqual(ids(C.checkinSuggestions({ litter: litter({ status: 'weaning', whelp_date: ago(56) }), roster, today })), ['status:ready']);
});

test('open picks comes up only with the waitlist on, once the deposit date has come and picks are shut', () => {
  const l = litter({ status: 'weaning', whelp_date: ago(35), accept_deposits_date: today });
  const roster = [pup('a', { disposition: 'available' })];
  assert.deepEqual(ids(C.checkinSuggestions({ litter: l, roster, today, waitlistOn: true })), ['open-picks:']);
  assert.deepEqual(ids(C.checkinSuggestions({ litter: l, roster, today, waitlistOn: false })), []);
  assert.deepEqual(ids(C.checkinSuggestions({ litter: { ...l, accept_deposits_date: ago(-1) }, roster, today, waitlistOn: true })), []);
  assert.deepEqual(ids(C.checkinSuggestions({ litter: { ...l, picks_opened_date: ago(2) }, roster, today, waitlistOn: true })), []);
  // Nobody available to offer.
  assert.deepEqual(ids(C.checkinSuggestions({ litter: l, roster: [pup('a', { disposition: 'keeping' })], today, waitlistOn: true })), []);
  // Picks come before the status question.
  assert.deepEqual(ids(C.checkinSuggestions({ litter: { ...l, status: 'whelped' }, roster, today, waitlistOn: true })), ['open-picks:', 'status:weaning']);
});

test('Today\'s litter rules: sold when all spoken for, reopen when one is available again, close when all delivered', () => {
  const ready = litter({ status: 'ready', whelp_date: ago(60), estimated_ready_date: ago(4) });
  assert.deepEqual(ids(C.checkinSuggestions({ litter: ready, roster: [pup('a', { disposition: 'placed' }), pup('b', { disposition: 'keeping' })], today })), ['status:sold']);
  // All kept: nothing was sold.
  assert.deepEqual(ids(C.checkinSuggestions({ litter: ready, roster: [pup('b', { disposition: 'keeping' })], today })), []);
  const sold = { ...ready, status: 'sold' };
  assert.deepEqual(ids(C.checkinSuggestions({ litter: sold, roster: [pup('a', { disposition: 'available' })], today })), ['status:ready:reopen']);
  const placed = [pup('a', { disposition: 'placed' })];
  assert.deepEqual(ids(C.checkinSuggestions({ litter: sold, roster: placed, sales: [{ dog_id: 'a', status: 'paid_in_full' }], today })), []);
  assert.deepEqual(ids(C.checkinSuggestions({ litter: sold, roster: placed, sales: [{ dog_id: 'a', status: 'delivered' }], today })), ['status:closed']);
});

test('weights: parsed from pounds and ounces, stored like the birth weight, compared with the last one', () => {
  assert.equal(C.parseWeight('', ''), null);
  assert.equal(C.parseWeight('2', '3.5'), 35.5);
  assert.equal(C.parseWeight('', '20'), 20);
  assert.ok(C.parseWeight('-1', '').error);
  assert.ok(C.parseWeight('0', '0').error);
  assert.ok(C.parseWeight('abc', '').error);
  assert.deepEqual(C.weightDetails(35.5, 'AM'), { weight_lbs: 2, weight_oz: 3.5, time_of_day: 'AM' });
  assert.deepEqual(C.weightDetails(14), { weight_lbs: 0, weight_oz: 14 });
  assert.equal(C.fmtOz(35.5), '2 lb 3.5 oz');
  assert.equal(C.fmtOz(32), '2 lb');
  assert.equal(C.fmtOz(9), '9 oz');

  const ev = (subject_id, event_date, details, extra = {}) => ({ subject_type: 'dog', subject_id, event_type: 'weight_check', event_date, details, ...extra });
  const weights = C.lastWeights([
    ev('a', ago(14), { weight_oz: 14 }),
    ev('a', ago(7), { weight_lbs: 1, weight_oz: 4 }),
    ev('a', ago(1), { weight_lbs: 9 }, { is_archived: true }),
    ev('b', ago(7), { weight_oz: 18 }),
    { subject_type: 'dog', subject_id: 'b', event_type: 'vaccination', event_date: ago(1), details: {} }
  ]);
  assert.deepEqual([weights.get('a').oz, weights.get('a').date], [20, ago(7)]);
  assert.equal(weights.get('b').oz, 18);
  assert.equal(C.lastWeighedDate(weights, [pup('a'), pup('b'), pup('c')]), ago(7));

  const rep = C.weightReport([
    { pup: pup('a'), oz: 28, prev: weights.get('a') },
    { pup: pup('b'), oz: 16, prev: weights.get('b') },
    { pup: pup('c'), oz: 15, prev: null }
  ]);
  assert.deepEqual(rep.gained.map((r) => [r.pup.id, r.diff]), [['a', 8]]);
  assert.deepEqual(rep.lost.map((r) => [r.pup.id, r.diff]), [['b', -2]]);
  assert.deepEqual(rep.first.map((r) => r.pup.id), ['c']);
  assert.equal(rep.top.pup.id, 'a');
});

test('care: one event per chosen pup, titled by what was given; the form refuses what\'s missing', () => {
  const form = { date: today, endDate: ago(-5), details: { drug: ' Metronidazole ', dose: '1 ml', frequency: '' } };
  const events = C.careEvents('medication', ['a', 'b'], form);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    subject_type: 'dog', subject_id: 'a', event_type: 'medication', event_date: today, event_end_date: ago(-5),
    title: 'Metronidazole', details: { drug: 'Metronidazole', dose: '1 ml' }
  });
  assert.equal(C.careEvents('vet_visit', ['a'], { date: today, details: {} })[0].title, 'Vet visit');
  assert.equal(C.careProblem('medication', [], form), 'Pick at least one puppy.');
  assert.ok(C.careProblem('medication', ['a'], { ...form, details: { drug: '' } }));
  assert.ok(C.careProblem('medication', ['a'], { ...form, endDate: ago(1) }));
  assert.equal(C.careProblem('vet_visit', ['a'], { date: today, details: {} }), '');
  assert.equal(C.careProblem('medication', ['a'], form), '');
});

test('the deposit date moves a week out by default', () => {
  assert.equal(C.rescheduleDefault(today), ago(-7));
});
