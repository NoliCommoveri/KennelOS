// breedingReports.test.js + waitlistReports — the pure math behind the phase-2
// reports: Dam & Sire Production, Pairing Success, Puppy Growth, the Waitlist
// Funnel and Demand vs Supply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageMonths, daysBetween, productionRows, pairingOutcome, pairingRows, successBy, progesteroneAtBreeding,
  weightLbs, growthSeries, growthFlags, BACK_TO_BACK_DAYS
} from '../shared/data/breedingReports.js';
import { funnelStage, funnelCounts, exitReasons, offerOutcomes, daysToPlacement, median, demandSupply } from '../shared/data/waitlistReports.js';

test('ageMonths / daysBetween', () => {
  assert.equal(ageMonths('2022-03-15', '2024-03-14'), 23);
  assert.equal(ageMonths('2022-03-15', '2024-03-15'), 24);
  assert.equal(ageMonths('', '2024-03-15'), null);
  assert.equal(daysBetween('2026-01-01', '2026-03-01'), 59);
});

test('productionRows: per dam and sire; live %, average, sex split, ages, back-to-back', () => {
  const dogs = [
    { id: 'd', call_name: 'Ivy', sex: 'female', date_of_birth: '2022-01-01' },
    { id: 's', call_name: 'Gus', sex: 'male', date_of_birth: '2020-06-01' },
    { id: 'x', call_name: 'Nobody', sex: 'female' }
  ];
  const litters = [
    { id: 'L1', dam_id: 'd', sire_id: 's', whelp_date: '2024-02-01', status: 'closed', puppies_born_total: 6, puppies_born_alive: 5 },
    { id: 'L2', dam_id: 'd', sire_id: 's', whelp_date: '2024-08-15', status: 'sold', puppies_born_total: 4, puppies_born_alive: 4 },
    { id: 'L3', dam_id: 'd', sire_id: 's', whelp_date: '2026-12-01', status: 'expected' }
  ];
  const puppies = [{ litter_id: 'L1', sex: 'male' }, { litter_id: 'L1', sex: 'female' }, { litter_id: 'L2', sex: 'female' }];
  const rows = productionRows({ dogs, litters, puppies });
  assert.deepEqual(rows.map((r) => r.role).sort(), ['dam', 'sire']);
  const dam = rows.find((r) => r.role === 'dam');
  assert.equal(dam.litters, 2, 'an expected litter is not production');
  assert.equal(dam.born, 10);
  assert.equal(dam.alive, 9);
  assert.equal(dam.avgLitter, 5);
  assert.equal(Math.round(dam.livePct * 100), 90);
  assert.deepEqual([dam.males, dam.females], [1, 2]);
  assert.deepEqual([dam.firstAge, dam.lastAge], [25, 31]);
  assert.ok(dam.shortestGapDays < BACK_TO_BACK_DAYS);
  assert.equal(dam.backToBack, 1);
  const sire = rows.find((r) => r.role === 'sire');
  assert.equal(sire.backToBack, 0, 'back-to-back is a dam flag');
  assert.ok(!rows.some((r) => r.dog.id === 'x'), 'a dog with no litters has no row');
});

test('pairing outcomes, progesterone at breeding, success rates', () => {
  const litters = [{ id: 'L', pairing_id: 'p3', puppies_born_total: 5 }];
  const pairings = [
    { id: 'p1', status: 'planned', method: 'natural' },
    { id: 'p2', status: 'not_pregnant', method: 'ai_frozen', sire_id: 'A', dam_id: 'D', planned_date: '2026-02-10' },
    { id: 'p3', status: 'bred', method: 'natural', sire_id: 'A', dam_id: 'D', planned_date: '2026-05-10' },
    { id: 'p4', status: 'bred', method: 'natural', sire_id: 'B', dam_id: 'D', planned_date: '2026-09-10' },
    { id: 'p5', status: 'cancelled' }
  ];
  assert.equal(pairingOutcome(pairings[2], new Set(['p3'])), 'success', 'a litter on it means it took');
  assert.equal(pairingOutcome(pairings[0]), null);
  const events = [
    { subject_id: 'D', event_type: 'progesterone_test', event_date: '2026-05-08', details: { value: '12.5' } },
    { subject_id: 'D', event_type: 'progesterone_test', event_date: '2026-05-01', details: { value: '4' } },
    { subject_id: 'D', event_type: 'progesterone_test', event_date: '2026-05-12', details: { value: '30' } }
  ];
  assert.deepEqual(progesteroneAtBreeding(pairings[2], events), { value: 12.5, date: '2026-05-08' }, 'the last reading on or before the tie, within a week');
  const rows = pairingRows({ pairings, litters, events });
  assert.deepEqual(rows.map((r) => [r.pairing.id, r.outcome]), [['p4', 'pending'], ['p3', 'success'], ['p2', 'failed']]);
  const byMethod = successBy(rows, (r) => r.pairing.method);
  const natural = byMethod.find((g) => g.key === 'natural');
  assert.deepEqual([natural.success, natural.failed, natural.pending, natural.rate], [1, 0, 1, 1]);
  assert.equal(byMethod.find((g) => g.key === 'ai_frozen').rate, 0);
});

test('growth: pounds from lbs+oz, ages from birth, a lagging pup flagged', () => {
  assert.equal(weightLbs({ details: { weight_lbs: '2', weight_oz: '8' } }), 2.5);
  assert.equal(weightLbs({ details: {} }), null);
  const pups = ['a', 'b', 'c', 'd'].map((id) => ({ id, date_of_birth: '2026-01-01' }));
  const w = (id, date, lbs) => ({ subject_id: id, event_type: 'weight_check', event_date: date, details: { weight_lbs: lbs } });
  const events = [w('a', '2026-01-01', 1), w('a', '2026-01-15', 2), w('b', '2026-01-15', 2.1), w('c', '2026-01-16', 1.9), w('d', '2026-01-15', 1.2), w('d', '2025-12-30', 1)];
  const series = growthSeries(pups, events);
  assert.deepEqual(series[0].points.map((p) => [p.x, p.y]), [[0, 1], [14, 2]]);
  assert.equal(series[3].points.length, 1, 'a weigh-in before birth is dropped');
  const flags = growthFlags(series);
  assert.deepEqual([...flags.keys()], ['d']);
  assert.equal(flags.get('d').median, 2);
});

test('waitlist funnel: stages only narrow; exits, offers and passes counted', () => {
  const entries = [
    { id: 1, status: 'applied' },
    { id: 2, status: 'approved', approved_date: '2026-01-02' },
    { id: 3, status: 'active', fee_received_date: '2026-01-03' },
    { id: 4, status: 'active', fee_received_date: '2026-01-03' },
    { id: 5, status: 'placed', placed_sale_id: 'S', applied_date: '2026-01-01' },
    { id: 6, status: 'removed', removed_reason: 'second_pass' },
    { id: 7, status: 'withdrawn' },
    { id: 8, status: 'removed', removed_reason: 'fee_expired' }
  ];
  const offers = [
    { entry_id: 4, outcome: 'passed', pass_reason: { label: 'Timing' } },
    { entry_id: 6, outcome: 'passed' },
    { entry_id: 5, outcome: 'accepted' },
    { entry_id: 3, outcome: 'open' }
  ];
  assert.equal(funnelStage(entries[7], new Set()), 1, 'fee expired: approved, never on the list');
  assert.deepEqual(funnelCounts(entries, offers).map((s) => s.count), [8, 6, 4, 4, 1]);
  assert.deepEqual(exitReasons(entries).map((r) => [r.label, r.value]).sort(), [['Fee not received in time', 1], ['Second pass', 1], ['Withdrew', 1]]);
  const o = offerOutcomes(offers);
  assert.deepEqual(o.outcomes, [{ label: 'Passed', value: 2 }, { label: 'Accepted', value: 1 }]);
  assert.deepEqual(o.reasons, [{ label: 'Timing', value: 1 }, { label: 'Recorded by you', value: 1 }]);
  assert.deepEqual(daysToPlacement(entries, new Map([['S', { sale_date: '2026-03-02' }]])), [60]);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test('demand vs supply: families counted by the waitlist matching rule; pups by kind', () => {
  const families = [
    { pref_sex: 'female', pref_purposes: ['show'] },
    { pref_sex: 'any', pref_purposes: ['pet'] },
    { pref_sex: 'male', pref_purposes: [] }
  ];
  const pups = [
    { id: 'p1', status: 'puppy', sex: 'female', breed: 'Boxer', intended_registration: 'full' },
    { id: 'p2', status: 'puppy', sex: 'female', breed: 'Boxer', intended_registration: 'limited' },
    { id: 'p3', status: 'puppy', sex: 'male', breed: 'Boxer', intended_registration: 'limited', disposition: 'keeping' },
    { id: 'p4', status: 'puppy', sex: 'unknown', breed: 'Boxer' }
  ];
  const sales = [{ dog_id: 'p2', status: 'deposit_paid' }];
  const { rows, availableCount, unsexed } = demandSupply({ families, pups, sales, breeds: ['Boxer'] });
  const at = (sex, reg) => rows.find((r) => r.sex === sex && r.registration === reg);
  assert.deepEqual([at('female', 'full').families, at('female', 'full').pups], [1, 1]);
  assert.deepEqual([at('female', 'limited').families, at('female', 'limited').pups], [1, 0], 'a sold pup is not supply');
  assert.equal(at('male', 'limited').families, 2, 'the pet family and the any-purpose male family');
  assert.equal(at('male', 'limited').pups, 0, 'a kept pup is not supply');
  assert.equal(at('female', ''), undefined, 'no undecided pups and none asked for: no row');
  assert.equal(at('male', 'co_own'), undefined, 'nobody asked for a co-own male: the open family alone makes no row');
  const open = demandSupply({ families: [{ pref_sex: 'any' }], pups: [{ id: 'q', status: 'puppy', sex: 'male', breed: 'Boxer' }], breeds: ['Boxer'] });
  assert.deepEqual(open.rows.map((r) => [r.label, r.families, r.pups]), [['Male · Registration not decided', 1, 1]]);
  assert.equal(availableCount, 2);
  assert.equal(unsexed, 1);
});
