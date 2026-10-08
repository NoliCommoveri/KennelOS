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
  },
  public_list: [],
  entries: {
    ann: { name: 'Ann Lee', email: 'ann@example.com', status: 'active', status_token: tok('a'), position: 1, litter_positions: { l1: 1 },
      offers: [{ id: 'o1', litter_id: 'l1', respond_by_date: plusDays(3), eligible_dog_ids: ['p1', 'p2'], picked_dog_id: null }] },
    bo: { name: 'Bo Kim', email: 'bo@example.com', status: 'active', status_token: tok('b'), position: 2,
      offers: [{ id: 'o2', litter_id: 'l2', respond_by_date: plusDays(3), eligible_dog_ids: ['p2', 'p3'], picked_dog_id: null }] },
    cy: { name: 'Cy Day', email: 'cy@example.com', status: 'placed', status_token: tok('c') },
  },
  litters: {
    l1: { label: 'Juniper × Ash', pups: [{ id: 'p1', call_name: 'Pip' }, { id: 'p2', call_name: 'Poppy' }] },
    l2: { label: 'Willow × Ash', pups: [{ id: 'p2', call_name: 'Poppy' }, { id: 'p3', call_name: 'Pearl' }] },
  },
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
  return { env, s, publish, ann: await familySession('ann@example.com'), bo: await familySession('bo@example.com') };
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
  assert.equal((await act(env, ann, tok('a'), 'pass', { offer_id: 'o1' })).status, 200);
  assert.equal(await err(await act(env, ann, tok('a'), 'pass', { offer_id: 'o1' })), 'already_passed');
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

  assert.equal(await err(await act(env, ann, tok('a'), 'pref_change', { changes: { pref_breed: 'Poodle' } })), 'bad_value');
  assert.equal(await err(await act(env, ann, tok('a'), 'pref_change', { changes: { pref_sex: 'puppy' } })), 'bad_value');
  assert.equal(await err(await act(env, ann, tok('a'), 'pref_change', { changes: {} })), 'nothing_to_change');
  assert.equal((await act(env, ann, tok('a'), 'pref_change', { changes: { pref_sex: 'male', ready_timing: '3_months' }, note: 'x'.repeat(900) })).status, 200);

  const ev = events(env);
  assert.deepEqual(ev.map((e) => e.kind), ['pause_request', 'listen', 'pref_change']);
  assert.equal(ev[0].payload.until, plusDays(60));
  assert.deepEqual(ev[1].payload, { mode: 'selected', sire_ids: [], dam_ids: ['dam1'] });
  assert.equal(ev[2].payload.note.length, ACTION_LIMITS.noteChars);
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
  assert.deepEqual(checkAction('pass', { turn_id: 't1' }, pending), { turn_id: 't1', offer_ids: ['o1', 'o3'], litter_ids: ['l1', 'l2'] });
  assert.deepEqual(checkAction('pass', { offer_id: 'o3' }, pending).turn_id, 't1', 'by any row of the turn, too');
});
