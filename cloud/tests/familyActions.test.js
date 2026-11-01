// What a family does on their status page (docs/KennelOS_Waitlist_W2_Plan.md
// step 5): only from a signed-in browser, only what her published list allows,
// recorded as events her device applies; a picked pup is held at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn } from './helpers/env.js';

const { checkAction, ACTION_LIMITS } = await import('../src/familyActions.js');

const KENNEL = 'kos1_11111111-2222-4333-8444-555555555555';
const tok = (c) => c.repeat(64);
const iso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const projection = (extra = {}) => ({
  format: 1, as_of: today(),
  kennel: {
    public_id: KENNEL, name: 'Thornfield Kennels', time_zone: 'America/Chicago',
    parents: { sires: [{ id: 'sire1', name: 'Ash' }], dams: [{ id: 'dam1', name: 'Juniper' }] },
    breeds: ['Boston Terrier'], message_key: { key_id: 'fk_1', public_key: 'PUB' },
    pass_reasons: [{ id: 'timing', label: 'Timing', message: 'Thanks!' }, { id: 'other', label: 'Other', message: 'Thanks.' }],
  },
  public_list: [],
  entries: {
    ann: { name: 'Ann Lee', email: 'ann@example.com', status: 'active', status_token: tok('a'), position: 1, matching_litter_ids: ['l1'],
      offers: [{ id: 'o1', litter_id: 'l1', respond_by_date: plusDays(3), eligible_dog_ids: ['p1', 'p2'], picked_dog_id: null }] },
    bo: { name: 'Bo Kim', email: 'bo@example.com', status: 'active', status_token: tok('b'), position: 2,
      offers: [{ id: 'o2', litter_id: 'l2', respond_by_date: plusDays(3), eligible_dog_ids: ['p2', 'p3'], picked_dog_id: null }] },
    cy: { name: 'Cy Day', email: 'cy@example.com', status: 'placed', status_token: tok('c') },
  },
  litters: {
    l1: { label: 'Juniper × Ash', picks_open: true, pups: [{ id: 'p1', call_name: 'Pip' }, { id: 'p2', call_name: 'Poppy' }] },
    l2: { label: 'Willow × Ash', picks_open: true, pups: [{ id: 'p2', call_name: 'Poppy' }, { id: 'p3', call_name: 'Pearl' }] },
    l3: { label: 'Spring litter', picks_open: false, pups: [{ id: 'p4', call_name: 'Pansy' }] },
  },
  upcoming: [
    { id: 'pair1', kind: 'pairing', pairing_id: 'pair1', litter_id: null, public: false, family: true },
    { id: 'pair2', kind: 'planned_pairing', pairing_id: 'pair2', litter_id: null, public: true, family: false },
    { id: 'heat1', kind: 'planned_heat', pairing_id: null, litter_id: null, expected_month: '2027-03', public: true, family: true },
  ],
  ...extra,
});

async function setup() {
  const env = await makeEnv();
  const s = await signIn(env, 'breeder@example.com');
  const { email_hash: eh } = env.DB.raw.prepare('SELECT email_hash FROM users').get();
  env.DB.raw.prepare(`INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
    VALUES ('order:1', ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`).run(eh, iso(), iso());
  await call(env, 'POST', '/program/backing-device', { token: s.token });
  const publish = async (p = projection()) => assert.equal((await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: p } })).status, 200);
  await publish();
  let ip = 10;
  const familySession = async (email) => {
    const at = `192.0.2.${ip++}`;
    await call(env, 'POST', '/f/code', { body: { public_id: KENNEL, email }, ip: at });
    const code = /(\d{6})/.exec(env.DB.raw.prepare('SELECT subject FROM wl_messages ORDER BY rowid DESC LIMIT 1').get().subject)[1];
    return (await (await call(env, 'POST', '/f/verify', { body: { public_id: KENNEL, code }, ip: at })).json()).session;
  };
  return { env, s, publish, familySession, ann: await familySession('ann@example.com'), bo: await familySession('bo@example.com') };
}

const act = (env, session, token, action, extra = {}) => call(env, 'POST', '/f/act', { body: { session, status_token: token, action, ...extra } });
const err = async (res) => (await res.json()).error;
const events = (env) => env.DB.raw.prepare('SELECT entry_id, kind, payload, made_by, based_on_version FROM wl_events ORDER BY seq').all()
  .map((r) => ({ ...r, payload: JSON.parse(r.payload) }));

test('acting needs a signed-in browser, and only on its own family\'s page', async () => {
  const { env, ann, bo } = await setup();
  assert.equal((await act(env, undefined, tok('a'), 'still_interested')).status, 401, 'a status link alone can look but not act');
  assert.equal((await act(env, 'f'.repeat(64), tok('a'), 'still_interested')).status, 401);
  const other = await act(env, bo, tok('a'), 'still_interested');
  assert.equal(other.status, 403, "signed in as Bo, on Ann's page");
  assert.equal(await err(other), 'other_family');
  assert.equal((await act(env, ann, tok('a'), 'still_interested')).status, 200);
  assert.deepEqual(events(env).map((e) => [e.entry_id, e.kind, e.made_by]), [['ann', 'still_interested', 'family']]);
});

test('accepting a pup holds it at once: another family can\'t pick it, and it drops off their offer', async () => {
  const { env, ann, bo, publish } = await setup();
  const res = await act(env, ann, tok('a'), 'pick', { offer_id: 'o1', dog_id: 'p2' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).pending.map((p) => [p.kind, p.payload.dog_id]), [['pick', 'p2']]);
  assert.deepEqual(env.DB.raw.prepare('SELECT dog_id, entry_id, offer_id FROM wl_holds').all().map((r) => ({ ...r })), [{ dog_id: 'p2', entry_id: 'ann', offer_id: 'o1' }]);

  const boPage = await (await call(env, 'GET', `/f/status/${tok('b')}`)).json();
  assert.deepEqual(boPage.offers[0].pups.map((d) => d.id), ['p3'], 'Poppy is no longer offered to Bo');
  const taken = await act(env, bo, tok('b'), 'pick', { offer_id: 'o2', dog_id: 'p2' });
  assert.equal(taken.status, 409);
  assert.equal(await err(taken), 'pup_taken');

  const annPage = await (await call(env, 'GET', `/f/status/${tok('a')}`)).json();
  assert.equal(annPage.pending[0].kind, 'pick', 'her page says it was sent');
  assert.equal(await err(await act(env, ann, tok('a'), 'pick', { offer_id: 'o1', dog_id: 'p1' })), 'already_picked');
  assert.equal(await err(await act(env, ann, tok('a'), 'pass', { offer_id: 'o1' })), 'already_picked');
  // Her device publishes without having applied it: still held. Once it has: released.
  await publish();
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM wl_holds').get().n, 1);
  const seq = env.DB.raw.prepare("SELECT seq FROM wl_events WHERE kind = 'pick'").get().seq;
  await publish(projection({ events_through: seq }));
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM wl_holds').get().n, 0, 'released once applied');
});

test('only what her list allows: a closed offer, a pup not offered, a family no longer on the list', async () => {
  const { env, ann } = await setup();
  assert.equal(await err(await act(env, ann, tok('a'), 'pick', { offer_id: 'o9', dog_id: 'p1' })), 'offer_closed');
  assert.equal(await err(await act(env, ann, tok('a'), 'pick', { offer_id: 'o1', dog_id: 'p3' })), 'pup_not_offered');
  assert.equal(await err(await act(env, ann, tok('a'), 'fly')), 'bad_action');
  assert.equal(await err(await act(env, ann, tok('a'), 'pass', { offer_id: 'o1' })), 'reason_required', 'a pass needs one of her reasons');
  assert.equal(await err(await act(env, ann, tok('a'), 'pass', { offer_id: 'o1', reason_id: 'other' })), 'reason_required', 'Other needs its words');
  assert.equal((await act(env, ann, tok('a'), 'pass', { offer_id: 'o1', reason_id: 'timing' })).status, 200);
  assert.equal(await err(await act(env, ann, tok('a'), 'pass', { offer_id: 'o1', reason_id: 'timing' })), 'already_passed');
  assert.throws(() => checkAction('leave', {}, { entry: { status: 'placed' }, projection: projection(), pending: [] }), /not_on_list/);
});

test('a pause request needs a date in the future (within two years); listen-only and answer changes only use her choices', async () => {
  const { env, ann } = await setup();
  for (const until of ['', 'soon', today(), plusDays(ACTION_LIMITS.maxPauseDays + 5)]) {
    assert.equal(await err(await act(env, ann, tok('a'), 'pause_request', { until })), 'bad_date', until);
  }
  assert.equal((await act(env, ann, tok('a'), 'pause_request', { until: plusDays(60), note: 'Moving house' })).status, 200);

  assert.equal(await err(await act(env, ann, tok('a'), 'listen', { mode: 'selected', sire_ids: ['someone-else'] })), 'bad_parent');
  assert.equal(await err(await act(env, ann, tok('a'), 'listen', { mode: 'selected', sire_ids: [], dam_ids: [] })), 'no_parents');
  assert.equal((await act(env, ann, tok('a'), 'listen', { mode: 'selected', dam_ids: ['dam1'] })).status, 200);
  assert.equal(await err(await act(env, ann, tok('a'), 'listen', { mode: 'except', sire_ids: [], dam_ids: [] })), 'no_parents');
  assert.equal(await err(await act(env, ann, tok('a'), 'listen', { mode: 'except', dam_ids: ['someone-else'] })), 'bad_parent');
  assert.equal(await err(await act(env, ann, tok('a'), 'listen', { mode: 'never' })), 'bad_request');

  assert.equal(await err(await act(env, ann, tok('a'), 'pref_change', { changes: { pref_breed: 'Poodle' } })), 'bad_value');
  assert.equal(await err(await act(env, ann, tok('a'), 'pref_change', { changes: { pref_sex: 'puppy' } })), 'bad_value');
  assert.equal(await err(await act(env, ann, tok('a'), 'pref_change', { changes: {} })), 'nothing_to_change');
  assert.equal(await err(await act(env, ann, tok('a'), 'pref_change', { changes: { pref_purposes: ['pet', 'zoo'] } })), 'bad_value');
  assert.equal(await err(await act(env, ann, tok('a'), 'pref_change', { changes: { pref_purposes: 'pet' } })), 'bad_value');
  assert.equal((await act(env, ann, tok('a'), 'pref_change', { changes: { pref_sex: 'male', ready_timing: '3_months', pref_purposes: ['show', 'pet', 'show'] }, note: 'x'.repeat(900) })).status, 200);

  const ev = events(env);
  assert.deepEqual(ev.map((e) => e.kind), ['pause_request', 'listen', 'pref_change']);
  assert.equal(ev[0].payload.until, plusDays(60));
  assert.deepEqual(ev[1].payload, { mode: 'selected', sire_ids: [], dam_ids: ['dam1'] });
  assert.equal(ev[2].payload.note.length, ACTION_LIMITS.noteChars);
  assert.deepEqual(ev[2].payload.changes.pref_purposes, ['pet', 'show'], 'deduped, in vocab order');
  assert.ok(ev.every((e) => e.based_on_version === 1));
});

test('her device reads the events; once it publishes its answer they\'re no longer pending', async () => {
  const { env, s, publish, ann } = await setup();
  await act(env, ann, tok('a'), 'leave');
  const read = await (await call(env, 'GET', '/waitlist/events?since=0', { token: s.token })).json();
  assert.deepEqual(read.events.map((e) => [e.entryId, e.kind, e.madeBy]), [['ann', 'leave', 'family']]);
  assert.equal((await (await call(env, 'GET', `/f/status/${tok('a')}`)).json()).pending.length, 1);
  await publish(); // published without having read it: still pending
  assert.equal((await (await call(env, 'GET', `/f/status/${tok('a')}`)).json()).pending.length, 1);
  await publish(projection({ events_through: read.last })); // applied it
  assert.equal((await (await call(env, 'GET', `/f/status/${tok('a')}`)).json()).pending.length, 0);
});

test('a family message is sealed to her key and lands in her inbox, already confirmed', async () => {
  const { env, s, publish, ann } = await setup();
  const send = (extra = {}) => call(env, 'POST', '/f/message', { body: { session: ann, status_token: tok('a'), key_id: 'fk_1', sealed: 'U0VBTEVE', ...extra } });
  assert.equal((await send()).status, 200);
  const items = (await (await call(env, 'GET', '/waitlist/inbox', { token: s.token })).json()).items;
  assert.deepEqual(items.map((i) => [i.kind, i.entryId, i.name, i.email, i.blob]), [['message', 'ann', 'Ann Lee', null, 'U0VBTEVE']]);
  assert.equal(await err(await send({ key_id: 'fk_old' })), 'form_changed');
  assert.equal((await send({ sealed: '' })).status, 400);
  assert.equal((await call(env, 'POST', '/f/message', { body: { status_token: tok('a'), key_id: 'fk_1', sealed: 'x' } })).status, 401);
  const p = projection();
  delete p.kennel.message_key;
  await publish(p);
  assert.equal(await err(await send()), 'messages_off');
});

test('turns (Spec §16.1): a pass covers every litter of the turn; one pick per turn', async () => {
  const p = projection();
  p.entries.ann.offers = [
    { id: 'o1', turn_id: 't1', litter_id: 'l1', respond_by_date: plusDays(3), eligible_dog_ids: ['p1'], picked_dog_id: null },
    { id: 'o3', turn_id: 't1', litter_id: 'l2', respond_by_date: plusDays(3), eligible_dog_ids: ['p3'], picked_dog_id: null },
  ];
  const { env, ann, publish } = await setup();
  await publish(p);
  const res = await act(env, ann, tok('a'), 'pick', { offer_id: 'o1', dog_id: 'p1' });
  assert.equal(res.status, 200);
  assert.equal(await err(await act(env, ann, tok('a'), 'pick', { offer_id: 'o3', dog_id: 'p3' })), 'already_picked', 'one pick per turn');
  assert.equal(await err(await act(env, ann, tok('a'), 'pass', { turn_id: 't1' })), 'already_picked');
  const pending = { entry: p.entries.ann, projection: p, pending: [] };
  assert.deepEqual(checkAction('pass', { turn_id: 't1', reason_id: 'other', reason_text: ' Moving ' }, pending),
    { turn_id: 't1', offer_ids: ['o1', 'o3'], litter_ids: ['l1', 'l2'], reason: { id: 'other', text: 'Moving' } });
  assert.deepEqual(checkAction('pass', { offer_id: 'o3', reason_id: 'timing' }, pending).turn_id, 't1', 'by any row of the turn, too');
});

test('"Not this litter" (Spec §16.2): a reason, a litter she listed, never one in their open turn; and taken back', async () => {
  const { env, bo } = await setup();
  assert.equal(await err(await act(env, bo, tok('b'), 'prepass', { litter_id: 'l1' })), 'reason_required');
  assert.equal(await err(await act(env, bo, tok('b'), 'prepass', { litter_id: 'l2', reason_id: 'timing' })), 'in_your_turn');
  assert.equal(await err(await act(env, bo, tok('b'), 'prepass', { litter_id: 'nope', reason_id: 'timing' })), 'not_listed');
  const res = await act(env, bo, tok('b'), 'prepass', { litter_id: 'l1', reason_id: 'timing' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).pending.map((p) => [p.kind, p.payload]), [['prepass', { litter_id: 'l1', reason: { id: 'timing', text: '' } }]]);
  assert.equal(await err(await act(env, bo, tok('b'), 'unprepass', { litter_id: 'l2' })), 'not_prepassed');
  assert.equal((await act(env, bo, tok('b'), 'unprepass', { litter_id: 'l1' })).status, 200);
});

test('"Not this litter" before picks open: only on what she shows on family pages (Spec §16.4)', async () => {
  const { env, bo } = await setup();
  assert.equal(await err(await act(env, bo, tok('b'), 'prepass', { litter_id: 'l3', reason_id: 'timing' })), 'not_listed', 'picks not open and not shown');
  assert.equal(await err(await act(env, bo, tok('b'), 'prepass', { pairing_id: 'pair2', reason_id: 'timing' })), 'not_listed', 'shown publicly only');
  assert.equal(await err(await act(env, bo, tok('b'), 'prepass', { pairing_id: 'heat1', reason_id: 'timing' })), 'not_listed', 'a planned heat is no litter to pass on');
  assert.equal((await act(env, bo, tok('b'), 'prepass', { pairing_id: 'pair1', reason_id: 'timing' })).status, 200);
});

test('"Ready now?" (Spec §16.7): only while she asks it, once; not yet needs a date and a reason', async () => {
  const { env, ann, bo, publish } = await setup();
  assert.equal(await err(await act(env, ann, tok('a'), 'ready', { answer: 'yes' })), 'not_asked');
  const p = projection();
  p.entries.bo.ready_check = { asked: today(), answer_by: null, answer: null };
  await publish(p);
  assert.equal(await err(await act(env, bo, tok('b'), 'ready', { answer: 'maybe' })), 'bad_request');
  assert.equal(await err(await act(env, bo, tok('b'), 'ready', { answer: 'no', until: plusDays(30) })), 'reason_required');
  assert.equal(await err(await act(env, bo, tok('b'), 'ready', { answer: 'no', until: today(), reason: 'x' })), 'bad_date');
  assert.equal((await act(env, bo, tok('b'), 'ready', { answer: 'no', until: plusDays(30), reason: 'Moving house' })).status, 200);
  assert.equal(await err(await act(env, bo, tok('b'), 'ready', { answer: 'yes' })), 'already_answered');
  const last = events(env).at(-1);
  assert.equal(last.kind, 'ready');
  assert.deepEqual(last.payload, { answer: 'no', until: plusDays(30), reason: 'Moving house' });
});

test('a Companion link request (Spec §8.3): only with an open sale, placed families too; one at a time; with an optional note', async () => {
  const { env, ann, publish, familySession } = await setup();
  assert.equal(await err(await act(env, ann, tok('a'), 'companion_request')), 'no_sale', 'no open sale: nothing to send');
  const p = projection();
  p.entries.cy.companion = { available: true, request: null };
  await publish(p);
  const cy = await familySession('cy@example.com');
  const page = await (await call(env, 'GET', `/f/status/${tok('c')}`)).json();
  assert.deepEqual(page.family.companion, { available: true, request: null }, 'a placed family sees it');
  assert.equal((await act(env, cy, tok('c'), 'companion_request', { note: `  Can it go to my partner too?${'x'.repeat(600)}` })).status, 200);
  const last = events(env).at(-1);
  assert.equal(last.kind, 'companion_request');
  assert.equal(last.payload.note.length, ACTION_LIMITS.noteChars, 'the note is trimmed and capped');
  assert.ok(last.payload.note.startsWith('Can it go to my partner too?'));
  assert.equal(await err(await act(env, cy, tok('c'), 'companion_request')), 'already_requested', 'sent, not applied yet');
  // Her device applied it and published: still waiting on her. Once she marks it sent, they can ask again.
  const seq = env.DB.raw.prepare("SELECT seq FROM wl_events WHERE kind = 'companion_request'").get().seq;
  p.events_through = seq;
  p.entries.cy.companion = { available: true, request: { requested_date: today(), decided: null, decided_date: null } };
  await publish(p);
  assert.equal(await err(await act(env, cy, tok('c'), 'companion_request')), 'already_requested');
  p.entries.cy.companion.request = { requested_date: today(), decided: 'sent', decided_date: today() };
  await publish(p);
  assert.equal((await act(env, cy, tok('c'), 'companion_request')).status, 200);
  assert.deepEqual(events(env).at(-1).payload, { note: '' });
});

// --- Extras (docs/KennelOS_Family_Requests_Plan.md §3) ----------------------------------

test('an extra can be asked for only as published, inside its dates, once; a cancel only while allowed', () => {
  const extras = {
    available: [{ id: 'tr', name: 'Puppy training', open_from: '2026-10-20', open_until: null }, { id: 'ph', name: 'Photos', open_from: null, open_until: '2026-10-12' }],
    current: [{ id: 'c1', list_id: 'gold', name: 'Gold photos', can_cancel: true, cancel_until: '2026-10-25' }, { id: 'c2', name: 'Video', can_cancel: false }],
    requests: [],
  };
  const entry = { status: 'placed', companion: { available: true }, extras };
  const at = (d) => ({ entry, projection: projection(), pending: [], now: new Date(`${d}T12:00:00Z`) });
  assert.deepEqual(checkAction('extra_request', { list_id: 'tr', note: ' Before pickup ' }, at('2026-10-21')), { list_id: 'tr', name: 'Puppy training', note: 'Before pickup' }, 'a placed family too');
  assert.throws(() => checkAction('extra_request', { list_id: 'tr' }, at('2026-10-19')), /not_open/, 'not yet');
  assert.throws(() => checkAction('extra_request', { list_id: 'ph' }, at('2026-10-13')), /not_open/, 'closed');
  assert.throws(() => checkAction('extra_request', { list_id: 'nope' }, at('2026-10-21')), /not_listed/);
  assert.throws(() => checkAction('extra_request', { list_id: 'tr' }, { ...at('2026-10-21'), pending: [{ kind: 'extra_request', payload: { list_id: 'tr' } }] }), /already_requested/);
  assert.throws(() => checkAction('extra_request', { list_id: 'tr' }, { ...at('2026-10-21'), entry: { ...entry, extras: { ...extras, requests: [{ kind: 'add', list_id: 'tr', decided: null }] } } }), /already_requested/);
  assert.throws(() => checkAction('extra_request', { list_id: 'tr' }, { ...at('2026-10-21'), entry: { ...entry, companion: null } }), /no_sale/);
  assert.deepEqual(checkAction('extra_cancel', { charge_id: 'c1' }, at('2026-10-25')), { charge_id: 'c1', list_id: 'gold', name: 'Gold photos', note: '' });
  assert.throws(() => checkAction('extra_cancel', { charge_id: 'c1' }, at('2026-10-26')), /not_open/, 'past its cancel date');
  assert.throws(() => checkAction('extra_cancel', { charge_id: 'c2' }, at('2026-10-21')), /not_open/, 'she said no cancelling');
});

// --- Pickup (docs/KennelOS_Family_Requests_Plan.md §4) ---------------------------------

test('a pickup time only as published, with room, one request at a time; changes until her cutoff; own place only when allowed', () => {
  const pickup = {
    slots: [{ id: 'x1', date: '2026-11-21', start_time: '10:00', end_time: '10:30', left: 1, location: { label: 'Library' } }, { id: 'x2', date: '2026-11-21', start_time: '11:00', left: 0, location: { label: 'Library' } }],
    booked: null, requests: [], own_place: false, ask_home: true, far_miles: 150, min_home_miles: 200,
  };
  const entry = { status: 'placed', companion: { available: true }, pickup };
  const at = (d, over = {}) => ({ entry: { ...entry, pickup: { ...pickup, ...over } }, projection: projection(), pending: [], now: new Date(`${d}T12:00:00Z`) });
  assert.deepEqual(checkAction('pickup_book', { slot_id: 'x1' }, at('2026-11-01')),
    { slot_id: 'x1', date: '2026-11-21', start_time: '10:00', end_time: '10:30', place: 'Library', note: '' });
  assert.throws(() => checkAction('pickup_book', { slot_id: 'x2' }, at('2026-11-01')), /slot_full/);
  assert.throws(() => checkAction('pickup_book', { slot_id: 'x1' }, at('2026-11-01', { dates: [{ date: '2026-11-21', requires: '10 week training', has_it: false }] })), /needs_extra/, 'a package needed first');
  assert.equal(checkAction('pickup_book', { slot_id: 'x1' }, at('2026-11-01', { dates: [{ date: '2026-11-21', requires: '10 week training', has_it: true }] })).slot_id, 'x1');
  assert.throws(() => checkAction('pickup_book', { slot_id: 'nope' }, at('2026-11-01')), /not_listed/);
  assert.throws(() => checkAction('pickup_book', { slot_id: 'x1' }, { ...at('2026-11-01'), pending: [{ kind: 'pickup_book', payload: {} }] }), /already_requested/);
  assert.throws(() => checkAction('pickup_book', { slot_id: 'x1' }, at('2026-11-04', { booked: { date: '2026-11-05', change_until: '2026-11-03' } })), /too_late/, 'past her cutoff');
  assert.deepEqual(checkAction('pickup_cancel', {}, at('2026-11-02', { booked: { date: '2026-11-05', change_until: '2026-11-03' } })), { note: '' });
  assert.throws(() => checkAction('pickup_address', { address: '9 Oak, Dallas TX' }, at('2026-11-01')), /not_allowed/);
  assert.deepEqual(checkAction('pickup_address', { address: ' 9 Oak,  Dallas TX ', date: '2026-11-22' }, at('2026-11-01', { own_place: true })), { address: '9 Oak, Dallas TX', date: '2026-11-22', note: '' });
  assert.throws(() => checkAction('pickup_address', { address: '9 Oak', date: '2026-10-01' }, at('2026-11-01', { own_place: true })), /bad_date/);
  assert.deepEqual(checkAction('home_location', { place: 'Dallas, TX' }, at('2026-11-01', { own_place: null })), { place: 'Dallas, TX' });
  assert.throws(() => checkAction('home_location', { place: 'Dallas, TX' }, at('2026-11-01', { own_place: true, ask_home: false })), /not_asked/);
  assert.throws(() => checkAction('pickup_book', { slot_id: 'x1' }, { ...at('2026-11-01'), entry: { ...entry, companion: null } }), /no_sale/);
});

test('driving miles: geocode both, one route (Directions API); no key, no call; addresses stay out of the result', async () => {
  const { drivingDistance, handleGeoDistance } = await import('../src/geo.js');
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (String(url).includes('/geocode/')) return new Response(JSON.stringify({ features: [{ geometry: { coordinates: String(url).includes('Library') ? [-97.7, 30.2] : [-96.8, 32.8] } }] }));
    return new Response(JSON.stringify({ routes: [{ distance: 315000, duration: 11400 }] }));
  };
  try {
    await assert.rejects(drivingDistance({}, 'Library, Austin TX', 'Dallas TX'), /geo_off/);
    assert.equal(asked.length, 0, 'no key: nothing asked');
    assert.deepEqual(await drivingDistance({ MAPBOX_TOKEN: 'pk.test' }, 'Library, Austin TX', 'Dallas TX'), { miles: 195.7, minutes: 190 });
    assert.equal(asked.length, 3);
    assert.match(asked[2], /directions\/v5\/mapbox\/driving\/-97\.7,30\.2;-96\.8,32\.8\?/);
    globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).includes('/geocode/') ? { features: [] } : {}));
    assert.equal(await drivingDistance({ MAPBOX_TOKEN: 'pk.test' }, 'Nowhere', 'Dallas TX'), null);
    const env = await makeEnv({ MAPBOX_TOKEN: 'pk.test' });
    const req = (body) => new Request('http://x/geo/distance', { method: 'POST', body: JSON.stringify(body) });
    await assert.rejects(handleGeoDistance(env, { programId: 'p1' }, req({ from: 'x', to: '' })), /bad_address/);
    await assert.rejects(handleGeoDistance(env, { programId: 'p1' }, req({ from: 'Library', to: 'Nowhere' })), /not_found/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- Backing out (docs/KennelOS_Family_Requests_Plan.md §7) ------------------------------

test('backing out: only with an open sale, one of her reasons, one request at a time', () => {
  const p = projection();
  p.kennel.back_out_reasons = [{ id: 'changed_mind', label: 'We changed our mind' }, { id: 'other', label: 'Something else' }];
  const entry = { status: 'placed', companion: { available: true }, back_out: { available: true, request: null } };
  const ctx = (over = {}) => ({ entry: { ...entry, ...over }, projection: p, pending: [] });
  assert.deepEqual(checkAction('back_out', { reason_id: 'changed_mind', note: ' Sorry ' }, ctx()), { reason_id: 'changed_mind', reason_text: '', note: 'Sorry' }, 'a placed family too');
  assert.deepEqual(checkAction('back_out', { reason_id: 'other', reason_text: ' Moving abroad ' }, ctx()).reason_text, 'Moving abroad');
  assert.throws(() => checkAction('back_out', { reason_id: 'other' }, ctx()), /reason_required/);
  assert.throws(() => checkAction('back_out', { reason_id: 'nope' }, ctx()), /reason_required/);
  assert.throws(() => checkAction('back_out', { reason_id: 'changed_mind' }, ctx({ back_out: { available: true, request: { decided: null } } })), /already_requested/);
  assert.throws(() => checkAction('back_out', { reason_id: 'changed_mind' }, { ...ctx(), pending: [{ kind: 'back_out', payload: {} }] }), /already_requested/);
  assert.throws(() => checkAction('back_out', { reason_id: 'changed_mind' }, ctx({ back_out: null })), /no_sale/);
});
