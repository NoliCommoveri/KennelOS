// waitlistEvents.test.js — what a family's action on their status page does on
// her device (shared/data/waitlistEvents.js, W2 Plan §6, step 5): checked again
// against her records now, applied only where it still fits, and a request
// (pause, narrower listen-only, answer change) where she decides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFamilyEvent, activityId } from '../shared/data/waitlistEvents.js';
import { listenChangeKind, listenParentChoices } from '../shared/data/waitlistRules.js';

const ev = (kind, payload = {}, extra = {}) => ({ seq: 7, publicId: 'kos1_x', entryId: 'e1', kind, payload, madeBy: 'family', createdAt: '2026-10-09T03:30:00.000Z', ...extra });
const entry = (extra = {}) => ({ id: 'e1', kennel_id: 'k', status: 'active', pref_sex: 'any', listen_mode: 'all', listen_sire_ids: [], listen_dam_ids: [], ...extra });
const offer = (extra = {}) => ({ id: 'o1', entry_id: 'e1', litter_id: 'l1', outcome: 'open', eligible_dog_ids: ['p1', 'p2'], chosen_dog_id: null, ...extra });
const pups = [{ id: 'p1', litter_id: 'l1', call_name: 'Pip' }, { id: 'p2', litter_id: 'l1', call_name: 'Poppy' }];
const ctx = (extra = {}) => ({
  entry: entry(), offers: [offer()], pups, sales: [], timeZone: 'America/Chicago',
  litterLabel: () => 'Juniper × Ash', pupName: (id) => pups.find((d) => d.id === id)?.call_name || 'a pup', ...extra
});

test('a pick that still fits is recorded; the day is the kennel\'s day', () => {
  const plan = planFamilyEvent(ev('pick', { offer_id: 'o1', litter_id: 'l1', dog_id: 'p2' }), ctx());
  assert.equal(plan.op, 'pick');
  assert.equal(plan.offerId, 'o1');
  assert.equal(plan.dogId, 'p2');
  assert.equal(plan.date, '2026-10-08', '03:30 UTC is still the evening before in Chicago');
  assert.equal(plan.activity.id, activityId({ seq: 7 }));
  assert.match(plan.activity.body, /picked Poppy from Juniper × Ash/);
});

test("a pick her records no longer allow becomes a line for her, never a forced write", () => {
  const pick = ev('pick', { offer_id: 'o1', dog_id: 'p2' });
  assert.match(planFamilyEvent(pick, ctx({ offers: [offer({ outcome: 'no_response' })] })).activity.body, /already closed \(no response\)/);
  assert.equal(planFamilyEvent(pick, ctx({ offers: [] })).op, 'note');
  assert.match(planFamilyEvent(pick, ctx({ offers: [offer({ chosen_dog_id: 'p1' })] })).activity.body, /already recorded Pip/);
  assert.equal(planFamilyEvent(pick, ctx({ offers: [offer({ chosen_dog_id: 'p2' })] })).op, 'skip', 'she already recorded the same pick');
  assert.match(planFamilyEvent(pick, ctx({ sales: [{ dog_id: 'p2', status: 'deposit_paid' }] })).activity.body, /no longer available/);
  assert.match(planFamilyEvent(ev('pick', { offer_id: 'o1', dog_id: 'p9' }), ctx()).activity.body, /wasn't one offered/);
});

test('pass, leave and still interested', () => {
  assert.deepEqual(planFamilyEvent(ev('pass', { offer_id: 'o1' }), ctx()).op, 'pass');
  assert.equal(planFamilyEvent(ev('pass', { offer_id: 'o1' }), ctx({ offers: [offer({ outcome: 'passed' })] })).op, 'note');
  const leave = planFamilyEvent(ev('leave', { note: 'We found a pup elsewhere' }), ctx());
  assert.equal(leave.op, 'withdraw');
  assert.match(leave.activity.body, /found a pup elsewhere/);
  assert.equal(planFamilyEvent(ev('leave'), ctx({ entry: entry({ status: 'placed' }) })).op, 'skip');
  const still = planFamilyEvent(ev('still_interested'), ctx());
  assert.equal(still.op, 'note');
  assert.match(still.activity.body, /still interested/);
});

test('a pause and a change to a matching answer wait for her', () => {
  const pause = planFamilyEvent(ev('pause_request', { until: '2026-12-31', note: 'Surgery' }), ctx());
  assert.equal(pause.op, 'pause_request');
  assert.deepEqual(pause.request, { requested_date: '2026-10-08', until: '2026-12-31', note: 'Surgery' });
  assert.equal(pause.activity, null, 'the request itself is what she sees');
  assert.equal(planFamilyEvent(ev('pause_request', { until: '2026-12-31' }), ctx({ entry: entry({ status: 'withdrawn' }) })).op, 'note');

  const pref = planFamilyEvent(ev('pref_change', { changes: { pref_sex: 'female', bogus: 'x' }, note: 'A girl suits us' }), ctx());
  assert.equal(pref.op, 'pref_request');
  assert.deepEqual(pref.request.changes, { pref_sex: 'female' }, 'only the matching answers');
  assert.equal(planFamilyEvent(ev('pref_change', { changes: { pref_sex: 'any' } }), ctx()).op, 'skip', 'no change');
});

test('listen-only: wider applies at once, narrower waits for her', () => {
  const selected = entry({ listen_mode: 'selected', listen_sire_ids: ['ash'], listen_dam_ids: [] });
  const wider = planFamilyEvent(ev('listen', { mode: 'selected', sire_ids: ['ash'], dam_ids: ['juniper'] }), ctx({ entry: selected }));
  assert.equal(wider.op, 'listen_apply');
  assert.deepEqual(wider.changes, { listen_mode: 'selected', listen_sire_ids: ['ash'], listen_dam_ids: ['juniper'] });
  const all = planFamilyEvent(ev('listen', { mode: 'all' }), ctx({ entry: selected }));
  assert.deepEqual(all.changes, { listen_mode: 'all' }, 'back to All keeps their earlier picks');
  const narrower = planFamilyEvent(ev('listen', { mode: 'selected', sire_ids: ['ash'], dam_ids: [] }), ctx());
  assert.equal(narrower.op, 'listen_request');
  assert.deepEqual(narrower.request, { requested_date: '2026-10-08', listen_mode: 'selected', listen_sire_ids: ['ash'], listen_dam_ids: [] });
  assert.equal(planFamilyEvent(ev('listen', { mode: 'all' }), ctx()).op, 'skip');
});

test("server moves (step 7), unknown kinds and families she no longer has are skipped", () => {
  assert.equal(planFamilyEvent(ev('no_response', {}, { madeBy: 'server' }), ctx()).reason, 'server_move');
  assert.equal(planFamilyEvent(ev('dance'), ctx()).reason, 'unknown_kind');
  assert.equal(planFamilyEvent(ev('still_interested'), ctx({ entry: null })).reason, 'no_entry');
  assert.equal(planFamilyEvent(ev('still_interested'), ctx({ entry: entry({ is_archived: true }) })).reason, 'no_entry');
});

test('listenChangeKind: dropping any parent or leaving All is narrower; adding or All is wider', () => {
  const sel = (s, d) => ({ listen_mode: 'selected', listen_sire_ids: s, listen_dam_ids: d });
  assert.equal(listenChangeKind({ listen_mode: 'all' }, sel(['a'], [])), 'narrower');
  assert.equal(listenChangeKind(sel(['a'], []), { listen_mode: 'all' }), 'wider');
  assert.equal(listenChangeKind(sel(['a'], []), sel(['a'], ['b'])), 'wider');
  assert.equal(listenChangeKind(sel(['a'], ['b']), sel(['a'], [])), 'narrower');
  assert.equal(listenChangeKind(sel(['a'], []), sel(['c'], [])), 'narrower', 'a swap drops a parent');
  assert.equal(listenChangeKind(sel(['a'], []), sel(['a'], [])), 'same');
  assert.equal(listenChangeKind({}, { listen_mode: 'all' }), 'same');
});

test('listenChangeKind with "except" (Spec §16.3): adding a parent or leaving All is narrower; removing one or All is wider; switching modes is narrower', () => {
  const ex = (s, d) => ({ listen_mode: 'except', listen_sire_ids: s, listen_dam_ids: d });
  const sel = (s, d) => ({ listen_mode: 'selected', listen_sire_ids: s, listen_dam_ids: d });
  assert.equal(listenChangeKind({ listen_mode: 'all' }, ex(['a'], [])), 'narrower');
  assert.equal(listenChangeKind(ex(['a'], []), { listen_mode: 'all' }), 'wider');
  assert.equal(listenChangeKind(ex(['a'], []), ex(['a'], ['b'])), 'narrower');
  assert.equal(listenChangeKind(ex(['a'], ['b']), ex(['a'], [])), 'wider');
  assert.equal(listenChangeKind(ex(['a'], []), ex(['c'], [])), 'narrower', 'a swap adds a parent');
  assert.equal(listenChangeKind(ex(['a'], []), ex(['a'], [])), 'same');
  assert.equal(listenChangeKind(sel(['a'], []), ex(['a'], [])), 'narrower');
  assert.equal(listenChangeKind(ex(['a'], []), sel(['a'], [])), 'narrower');
  assert.equal(listenChangeKind({ listen_mode: 'all' }, ex([], [])), 'same', 'an empty except is All litters');
  assert.equal(listenChangeKind(ex(['a'], []), ex([], [])), 'wider');
});

test('listen-only "except" from the status page: removing a parent applies; adding one waits for her', () => {
  const except = entry({ listen_mode: 'except', listen_sire_ids: ['ash'], listen_dam_ids: ['juniper'] });
  const wider = planFamilyEvent(ev('listen', { mode: 'except', sire_ids: ['ash'], dam_ids: [] }), ctx({ entry: except }));
  assert.equal(wider.op, 'listen_apply');
  assert.deepEqual(wider.changes, { listen_mode: 'except', listen_sire_ids: ['ash'], listen_dam_ids: [] });
  assert.match(wider.activity.body, /Took parents off/);
  const narrower = planFamilyEvent(ev('listen', { mode: 'except', sire_ids: ['ash'], dam_ids: [] }), ctx());
  assert.equal(narrower.op, 'listen_request');
  assert.deepEqual(narrower.request, { requested_date: '2026-10-08', listen_mode: 'except', listen_sire_ids: ['ash'], listen_dam_ids: [] });
  const swap = planFamilyEvent(ev('listen', { mode: 'selected', sire_ids: ['ash'], dam_ids: ['juniper'] }), ctx({ entry: except }));
  assert.equal(swap.op, 'listen_request', 'except → selected is narrower');
});

test('listenParentChoices: breeding dogs, live parents (an outside stud too), and anything already picked', () => {
  const kennel = { id: 'k' };
  const dogs = [
    { id: 'ash', call_name: 'Ash', sex: 'male', kennel_id: 'k', status: 'active_breeding' },
    { id: 'pet', call_name: 'Pet', sex: 'male', kennel_id: 'k', status: 'pet' },
    { id: 'stud', call_name: 'Stud', sex: 'male', kennel_id: 'other' },
    { id: 'old', call_name: 'Old', sex: 'male', kennel_id: 'k', status: 'retired', is_archived: true },
    { id: 'jun', call_name: 'Juniper', sex: 'female', kennel_id: 'k', status: 'active_breeding' }
  ];
  const pairings = [{ id: 'p', kennel_id: 'k', status: 'planned', sire_id: 'stud', dam_id: 'jun' }, { id: 'q', kennel_id: 'other', status: 'planned', sire_id: 'pet', dam_id: 'jun' }];
  const c = listenParentChoices(kennel, { dogs, pairings, selectedSires: ['old'] });
  assert.deepEqual(c.sires.map((d) => d.id), ['ash', 'old', 'stud']);
  assert.deepEqual(c.dams.map((d) => d.id), ['jun']);
});

test('turns: a pass closes the whole turn through any open row; one pick per turn', () => {
  const rows = [offer({ id: 'o1', turn_id: 't' }), offer({ id: 'o2', turn_id: 't', litter_id: 'l2', eligible_dog_ids: ['p3'] })];
  const pass = planFamilyEvent(ev('pass', { turn_id: 't', offer_ids: ['o1', 'o2'], litter_ids: ['l1', 'l2'] }), ctx({ offers: rows }));
  assert.equal(pass.op, 'pass');
  assert.equal(pass.offerId, 'o1');
  const picked = [offer({ id: 'o1', turn_id: 't', chosen_dog_id: 'p1' }), rows[1]];
  const pick = planFamilyEvent(ev('pick', { offer_id: 'o2', dog_id: 'p3' }), ctx({ offers: picked, pups: [...pups, { id: 'p3', litter_id: 'l2', call_name: 'Pearl' }] }));
  assert.equal(pick.op, 'note');
  assert.match(pick.activity.body, /already recorded Pip/);
});

test('pass reasons and "Not this litter": checked against her list; pending until the turn comes', async () => {
  const { passReasons, passReasonOf, splitPrepassed, DEFAULT_PASS_REASONS } = await import('../shared/data/waitlistRules.js');
  const config = { pass_reasons: [{ id: 'money', label: 'Money', message: 'Ask us about payment plans.' }], pass_other: true };
  assert.deepEqual(passReasons(config).map((r) => r.id), ['money', 'other']);
  assert.deepEqual(passReasons({ pass_other: false }).map((r) => r.id), DEFAULT_PASS_REASONS.map((r) => r.id));
  assert.deepEqual(passReasonOf(config, { id: 'money' }), { id: 'money', label: 'Money', text: '' });
  assert.equal(passReasonOf(config, { id: 'other', text: '  ' }), null, 'Other needs its words');
  assert.equal(passReasonOf(config, { id: 'nope' }), null);

  const pass = planFamilyEvent(ev('pass', { turn_id: 'o1', reason: { id: 'money' } }), ctx({ config }));
  assert.deepEqual(pass.reason, { id: 'money', label: 'Money', text: '' });
  assert.match(pass.activity.body, /Their reason: Money/);
  const pre = planFamilyEvent(ev('prepass', { litter_id: 'l2', reason: { id: 'other', text: 'Too far away' } }), ctx({ config }));
  assert.equal(pre.op, 'prepass');
  assert.deepEqual(pre.prepass, { litter_id: 'l2', reason: { id: 'other', label: 'Other', text: 'Too far away' }, date: '2026-10-08' });
  assert.equal(planFamilyEvent(ev('prepass', { litter_id: 'l1', reason: { id: 'money' } }), ctx({ config })).op, 'note', 'in their open turn: pass the turn instead');
  assert.equal(planFamilyEvent(ev('unprepass', { litter_id: 'l2' }), ctx({ entry: entry({ prepasses: [{ litter_id: 'l2' }] }) })).op, 'unprepass');
  assert.equal(planFamilyEvent(ev('unprepass', { litter_id: 'l2' }), ctx()).op, 'skip');

  const split = splitPrepassed(entry({ prepasses: [{ pairing_id: 'pr1' }] }), [{ litter: { id: 'l9', pairing_id: 'pr1' }, eligibleDogs: [] }, { litter: { id: 'l1' }, eligibleDogs: [] }]);
  assert.deepEqual([split.offer.map((x) => x.litter.id), split.prepassed.map((x) => x.litter.id)], [['l1'], ['l9']], 'a pass on a pairing carries over to the litter born of it');
});

test('"Ready now?" from the status page (Spec §16.7): yes is recorded; not yet carries a date and a reason', () => {
  const yes = planFamilyEvent(ev('ready', { answer: 'yes' }), ctx());
  assert.equal(yes.op, 'ready');
  assert.equal(yes.answer, 'yes');
  assert.match(yes.activity.body, /ready now/);
  const no = planFamilyEvent(ev('ready', { answer: 'no', until: '2026-12-01', reason: ' Moving house ' }), ctx());
  assert.deepEqual([no.op, no.answer, no.until, no.reason, no.activity], ['ready', 'no', '2026-12-01', 'Moving house', null], 'the pause request is what she sees');
  assert.equal(planFamilyEvent(ev('ready', { answer: 'no', until: '2026-12-01' }), ctx()).reason, 'bad_payload', 'a reason is required');
  assert.equal(planFamilyEvent(ev('ready', { answer: 'yes' }), ctx({ entry: entry({ status: 'withdrawn' }) })).op, 'note');
});
