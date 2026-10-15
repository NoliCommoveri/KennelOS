// breedingReports.test.js + waitlistReports — the pure math behind the phase-2
// reports: Dam & Sire Production, Pairing Success, Puppy Growth, the Waitlist
// Funnel and Demand vs Supply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageMonths, daysBetween, productionRows, pairingOutcome, pairingRows, successBy, progesteroneAtBreeding,
  weightLbs, growthSeries, growthFlags, BACK_TO_BACK_DAYS
} from '../shared/data/breedingReports.js';
import {
  funnelStage, funnelCounts, exitReasons, offerOutcomes, daysToPlacement, median, demandSupply,
  mean, applicationGaps, wasApproved, wasDecided, wasListed, daysToApprove, daysToFee, sexWanted,
  listedSince, waitBuckets, exitGroup, exitDate, offerAndExitRows, offerAndExitStats,
  purposesWanted, purposesText, parentsWanted, parentsNamed, breedsWanted, colorsWanted
} from '../shared/data/waitlistReports.js';

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

// --- Phase 3 ---------------------------------------------------------------------------
import { heatRows, testGapRows, studResultRows } from '../shared/data/breedingReports.js';

test('heatRows: interval from her own history; prediction and due-soon / overdue', () => {
  const heat = (id, d) => ({ subject_id: id, event_type: 'heat_cycle', event_date: d });
  const rows = heatRows([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [
    heat('a', '2026-01-01'), heat('a', '2026-07-01'), heat('a', '2026-07-01'),
    heat('b', '2025-06-01'), heat('b', '2025-12-01'),
    heat('c', '2026-03-01')
  ], '2026-12-15');
  const a = rows.find((r) => r.dog.id === 'a');
  assert.equal(a.heats, 2, 'the same start logged twice is one heat');
  assert.equal(a.avgInterval, 181);
  assert.equal(a.next, '2026-12-29');
  assert.equal(a.status, 'due_soon');
  assert.equal(rows.find((r) => r.dog.id === 'b').status, 'overdue');
  const c = rows.find((r) => r.dog.id === 'c');
  assert.deepEqual([c.avgInterval, c.next, c.status], [null, null, null], 'one heat: no prediction');
  assert.equal(rows[rows.length - 1].dog.id, 'c', 'unpredicted last');
});

test('testGapRows: planned vs logged by name token, case-insensitive', () => {
  const tokens = (e) => (e.details?.panel_name ? [e.details.panel_name] : []);
  const rows = testGapRows(
    [{ id: 'd', planned_tests: ['Embark Panel', ' OFA Hips ', 'CAER'] }, { id: 'e' }],
    [{ subject_type: 'dog', subject_id: 'd', details: { panel_name: 'embark panel' } }, { subject_type: 'dog', subject_id: 'd', details: { panel_name: 'Extra' } }],
    tokens
  );
  assert.deepEqual(rows[0].done, ['Embark Panel']);
  assert.deepEqual(rows[0].missing, ['OFA Hips', 'CAER']);
  assert.equal(rows[0].extra, 1, 'a result not on the plan');
  assert.deepEqual([rows[1].planned, rows[1].missing], [[], []]);
});

test('studResultRows: the litter its pairing produced', () => {
  const rows = studResultRows([{ id: 's1', pairing_id: 'p1' }, { id: 's2', pairing_id: 'p2' }, { id: 's3' }], [{ id: 'L', pairing_id: 'p1', puppies_born_total: '6' }]);
  assert.deepEqual(rows.map((r) => [r.service.id, r.litter?.id || null, r.born]), [['s1', 'L', 6], ['s2', null, null], ['s3', null, null]]);
});

test('applications: gaps between applications, approval and listing rates, days to approve and to fee', () => {
  const entries = [
    { id: 1, status: 'applied', applied_date: '2026-01-10', pref_sex: 'female' },
    { id: 2, status: 'declined', applied_date: '2026-01-01', declined_date: '2026-01-03' },
    { id: 3, status: 'active', applied_date: '2026-01-01', approved_date: '2026-01-04', fee_received_date: '2026-01-09', pref_sex: 'male' },
    { id: 4, status: 'expired', applied_date: '2026-01-20', approved_date: '2026-01-21', pref_sex: 'weird' },
    { id: 5, status: 'withdrawn', applied_date: '2026-01-25' }
  ];
  assert.deepEqual(applicationGaps(entries), [0, 9, 10, 5], 'sorted by applied date; same day is 0');
  assert.equal(mean([0, 9, 10, 5]), 6);
  assert.equal(mean([]), null);
  assert.deepEqual(entries.map(wasDecided), [false, true, true, true, false], 'waiting or withdrawn before a decision: not decided');
  assert.deepEqual(entries.map(wasApproved), [false, false, true, true, false]);
  assert.deepEqual(entries.map(wasListed), [false, false, true, false, false]);
  assert.equal(daysToApprove(entries[2]), 3);
  assert.equal(daysToFee(entries[2]), 5);
  assert.equal(daysToFee(entries[3]), null);
  assert.deepEqual(sexWanted(entries).map((s) => [s.value, s.count]), [['female', 1], ['male', 1], ['any', 3]], 'blank or unknown = Either');
});

test('waitlist today: waiting counted from the anchor, then fee, approval, application; bucketed', () => {
  assert.equal(listedSince({ position_anchor_date: '2025-01-01', fee_received_date: '2025-06-01' }), '2025-01-01');
  assert.equal(listedSince({ fee_received_date: '2025-06-01', approved_date: '2025-05-01' }), '2025-06-01');
  assert.equal(listedSince({ approved_date: '2025-05-01', applied_date: '2025-04-01' }), '2025-05-01');
  assert.equal(listedSince({}), null);
  const today = '2026-01-01';
  const b = waitBuckets([
    { fee_received_date: '2025-12-01' }, { fee_received_date: '2025-10-03' }, { fee_received_date: '2025-10-02' },
    { fee_received_date: '2025-02-01' }, { fee_received_date: '2024-01-01' }, {}
  ], today);
  assert.deepEqual(b.map((x) => x.value), [2, 1, 1, 1], '90 days is under 3 months, 91 is not; no date is left out');
});

test('offers & removals: rule removals apart from hers; rates over closed offers', () => {
  assert.equal(exitGroup({ status: 'removed', removed_reason: 'second_pass' }), 'rules');
  assert.equal(exitGroup({ status: 'removed', removed_reason: 'no_ready_answer' }), 'rules');
  assert.equal(exitGroup({ status: 'expired' }), 'rules', 'a fee that lapsed before listing');
  assert.equal(exitGroup({ status: 'removed', removed_reason: 'by_breeder' }), 'by_breeder');
  assert.equal(exitGroup({ status: 'removed' }), 'by_breeder', 'no reason recorded: hers');
  assert.equal(exitGroup({ status: 'withdrawn' }), 'withdrew');
  assert.equal(exitGroup({ status: 'active' }), null);
  assert.equal(exitDate({ status: 'expired', fee_due_date: '2026-02-01' }), '2026-02-01');

  const entries = [
    { id: 'a', status: 'active' },
    { id: 'b', status: 'removed', removed_reason: 'second_pass', removed_date: '2026-03-01' },
    { id: 'c', status: 'placed' },
    { id: 'd', status: 'withdrawn', withdrawn_date: '2026-02-01' }
  ];
  const offers = [
    { id: 1, entry_id: 'a', outcome: 'passed', outcome_date: '2026-01-05', counts_as_pass: false },
    { id: 2, entry_id: 'b', outcome: 'passed', outcome_date: '2026-01-06', counts_as_pass: true },
    { id: 3, entry_id: 'b', outcome: 'no_response', outcome_date: '2026-02-20', counts_as_pass: true },
    { id: 4, entry_id: 'c', outcome: 'accepted', outcome_date: '2026-02-10' },
    { id: 5, entry_id: 'a', outcome: 'open' },
    { id: 6, entry_id: 'a', outcome: 'voided' },
    { id: 7, entry_id: 'zz', outcome: 'passed' }
  ];
  const rows = offerAndExitRows(entries, offers);
  assert.deepEqual(rows.map((r) => r.id), ['e:b', 'o:3', 'o:4', 'e:d', 'o:2', 'o:1'], 'closed offers and exits, newest first; open, voided and orphans out');
  const s = offerAndExitStats(rows);
  assert.equal(s.closed, 4);
  assert.deepEqual([s.accepted, s.passed, s.noResponse, s.countedPasses], [1, 2, 1, 2]);
  assert.deepEqual([s.familiesOffered, s.familiesPassed], [3, 2]);
  assert.equal(s.left, 2);
  assert.deepEqual(s.byGroup.map((g) => [g.value, g.count]), [['rules', 1], ['by_breeder', 0], ['declined', 0], ['withdrew', 1]]);
});

test('what families asked for: purposes (each picked), parents, named parents, breed and color', () => {
  const entries = [
    { pref_purposes: ['pet', 'show'], listen_mode: 'selected', listen_dam_ids: ['d1'], listen_sire_ids: ['s1'], pref_breed: 'Boxer', pref_colors: ['Fawn', 'brindle'] },
    { pref_purposes: 'show', listen_mode: 'selected', listen_dam_ids: ['d1'], pref_breed: ' boxer ', pref_colors: 'fawn' },
    { pref_purposes: [], listen_mode: 'except', listen_sire_ids: ['s1'] },
    { pref_purposes: ['bogus'], listen_mode: 'weird', pref_breed: 'Poodle' }
  ];
  const pw = Object.fromEntries(purposesWanted(entries).map((r) => [r.value, r.count]));
  assert.deepEqual(pw, { pet: 1, performance: 0, show: 2, breeding: 0, co_own: 0, '': 2 }, 'each purpose picked counts; none or unknown = any');
  assert.equal(purposesText(entries[0]), 'Pet / companion + Show');
  assert.equal(purposesText(entries[2]), 'Any');
  assert.deepEqual(parentsWanted(entries).map((r) => [r.value, r.count]), [['all', 1], ['selected', 2], ['except', 1]], 'unknown mode reads as any parents');
  const name = (id) => ({ d1: 'Bella', s1: 'Duke' })[id];
  assert.deepEqual(parentsNamed(entries, 'selected', name), [{ label: 'Bella', value: 2 }, { label: 'Duke', value: 1 }]);
  assert.deepEqual(parentsNamed(entries, 'except', name), [{ label: 'Duke', value: 1 }]);
  assert.deepEqual(breedsWanted(entries).map((r) => [r.label, r.count]), [['Boxer', 2], ['Poodle', 1], ['Any breed', 1]], 'any case and spacing match');
  assert.deepEqual(colorsWanted(entries).map((r) => [r.label, r.count]), [['Fawn', 2], ['brindle', 1], ['Any color', 2]]);
});
