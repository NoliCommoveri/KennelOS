// The server's own moves (docs/KennelOS_Waitlist_W2_Plan.md §6, step 7): a
// deadline she lets the server close, the next family offered from her published
// order, a family's pass moving the turn on, reminders once each, the status page
// showing it all, and a publish refused until her device has applied the moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn } from './helpers/env.js';

const { localNow, addDays, fillTemplate, openTurns, nextFromQueue, runKennel, runWaitlistMoves } = await import('../src/serverMoves.js');
const { DAILY_CRON } = await import('../src/index.js');

const KENNEL = 'kos1_11111111-2222-4333-8444-555555555555';
const tok = (c) => c.repeat(64);
const iso = (ms) => new Date(ms).toISOString();
const count = (env, table) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
// 2026-10-12 15:00 UTC = 10:00 in Chicago.
const NOW = new Date('2026-10-12T15:00:00Z');

function makePro(env, session) {
  const { email_hash: eh } = env.DB.raw.prepare(
    'SELECT u.email_hash FROM users u JOIN programs p ON p.owner_user_id = u.id WHERE p.id = ?',
  ).get(session.programId);
  env.DB.raw.prepare(
    `INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
     VALUES (?, ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`,
  ).run(`order:${session.programId}`, eh, iso(Date.now()), iso(Date.now()));
}

async function breeder(env) {
  const s = await signIn(env, 'breeder@example.com', { deviceId: 'phone-1' });
  makePro(env, s);
  await call(env, 'POST', '/program/backing-device', { token: s.token });
  return s;
}

const TEMPLATES = {
  offer: { subject: "It's your turn! [Litter]", body: 'Hi [Family], choose by [Respond by].' },
  deadline_passed: { subject: 'Your turn for [Litter] has closed', body: 'Hi [Family], it ended [Respond by].' },
  offer_reminder: { subject: 'Reminder: [Litter]', body: 'Hi [Family], your turn ends [Respond by].' },
  fee_reminder: { subject: 'Your fee', body: 'Hi [Family], please pay[Pay by].' },
  ready_check: { subject: 'Ready now?', body: 'Hi [Family], are you ready?' },
};

// Ann holds a turn on Juniper (offered Oct 8, respond by Oct 11); Bo and Cy wait.
function projection({ auto = ['no_response', 'no_deposit', 'passed', 'left'], reminders = true, respondBy = '2026-10-11', picked = null, feeDue = '2026-11-30' } = {}) {
  return {
    format: 1,
    as_of: '2026-10-10',
    kennel: { public_id: KENNEL, name: 'Thornfield Kennels', time_zone: 'America/Chicago', respond_days: 3, auto_offer_on: auto, reminders, email_templates: TEMPLATES },
    public_list: [],
    entries: {
      ann: { name: 'Ann Lee', email: 'ann@example.com', status: 'active', status_token: tok('a'), position: null, offers: [
        { id: 'o1', turn_id: 't1', litter_id: 'l1', offered_date: '2026-10-08', respond_by_date: respondBy, eligible_dog_ids: ['p1', 'p2'], picked_dog_id: picked },
      ] },
      bo: { name: 'Bo Kim', email: 'bo@example.com', status: 'active', status_token: tok('b'), position: 2, offers: [] },
      cy: { name: 'Cy Day', email: 'cy@example.com', status: 'active', status_token: tok('c'), position: 3, offers: [] },
      dee: { name: 'Dee Fox', email: 'dee@example.com', status: 'approved', status_token: tok('d'), offers: [], fee_due: { amount: 300, due_date: feeDue } },
    },
    litters: { l1: { label: 'Juniper × Ash', picks_open: true, pups: [{ id: 'p1' }, { id: 'p2' }], open_offer_entry_id: 'ann' } },
    turn_queue: [
      { entry_id: 'bo', litters: { l1: ['p1', 'p2'] }, prepassed: [], respond_days: 5 },
      { entry_id: 'cy', litters: { l1: ['p2'] }, prepassed: [] },
    ],
    events_through: 0,
  };
}

async function published(opts) {
  const env = await makeEnv({ FAMILY_PAGES_ORIGIN: 'https://apply.example' });
  const s = await breeder(env);
  const res = await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: projection(opts) } });
  assert.equal(res.status, 200);
  return { env, s };
}

const row = (env) => ({ ...env.DB.raw.prepare('SELECT public_id, program_id, version, body FROM wl_projection').get() });
const stored = (env) => JSON.parse(row(env).body);
const events = (env) => env.DB.raw.prepare("SELECT seq, entry_id, kind, payload, made_by FROM wl_events ORDER BY seq").all().map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
const mails = (env) => env.DB.raw.prepare('SELECT id, kind, to_email, subject, body FROM wl_messages ORDER BY rowid').all().map((r) => ({ ...r }));

test('dates are the kennel\'s; templates fill like her device\'s', () => {
  assert.deepEqual(localNow(new Date('2026-10-12T04:30:00Z'), 'America/Chicago'), { date: '2026-10-11', hour: 23 });
  assert.deepEqual(localNow(new Date('2026-10-12T04:30:00Z'), 'Not/AZone'), { date: '2026-10-12', hour: 4 });
  assert.equal(addDays('2026-12-30', 5), '2027-01-04');
  assert.equal(DAILY_CRON, '17 3 * * *');
  const f = fillTemplate(TEMPLATES.offer, { kennelName: 'T', family: 'Ann', litters: ['A', 'B'], respondBy: '2026-10-20' });
  assert.deepEqual(f, { subject: "It's your turn! A and B", body: 'Hi Ann, choose by October 20, 2026.' });
});

test('the next family comes from her published order: one turn at a time, held pups left out', () => {
  const p = projection();
  assert.equal(openTurns(p).length, 1);
  assert.equal(nextFromQueue(p), null, 'Ann holds the turn');
  p.entries.ann.offers = [];
  assert.deepEqual(nextFromQueue(p), { entryId: 'bo', rows: [{ litter_id: 'l1', dog_ids: ['p1', 'p2'] }], respondDays: 5 });
  assert.deepEqual(nextFromQueue(p, { skip: new Set(['bo']) }), { entryId: 'cy', rows: [{ litter_id: 'l1', dog_ids: ['p2'] }], respondDays: 3 });
  assert.equal(nextFromQueue(p, { skip: new Set(['bo']), held: new Set(['p2']) }), null, "Cy's only pup is held");
  p.litters.l1.picks_open = false;
  assert.equal(nextFromQueue(p), null);
});

test("a deadline she lets the server close: closed, the next family offered, both emailed, the status pages show it", async () => {
  const { env } = await published();
  const c = await runKennel(env, row(env), { now: NOW, origin: 'https://apply.example' });
  assert.deepEqual(c, { closed: 1, offered: 1, reminders: 0 });

  const ev = events(env);
  assert.deepEqual(ev.map((e) => [e.kind, e.entry_id, e.made_by]), [['server_close', 'ann', 'server'], ['server_offer', 'bo', 'server']]);
  assert.deepEqual(ev[0].payload, { turn_id: 't1', offer_ids: ['o1'], litter_ids: ['l1'], respond_by_date: '2026-10-11', trigger: 'no_response', picked_dog_id: null });
  assert.equal(ev[1].payload.cause, 'deadline');
  assert.equal(ev[1].payload.cause_seq, ev[0].seq);
  assert.equal(ev[1].payload.offered_date, '2026-10-12');
  assert.equal(ev[1].payload.respond_by_date, '2026-10-17', "Bo's own window (5 days)");

  const p = stored(env);
  assert.deepEqual(p.entries.ann.offers, []);
  assert.equal(p.entries.ann.place_hidden ?? null, null, 'turn closed: their number shows again');
  assert.equal(p.entries.bo.offers.length, 1);
  assert.deepEqual(p.entries.bo.offers[0].eligible_dog_ids, ['p1', 'p2']);
  assert.equal(p.entries.bo.place_hidden.reason, 'turn');
  assert.deepEqual(p.turn_queue.map((q) => q.entry_id), ['cy']);

  const m = mails(env);
  assert.deepEqual(m.map((x) => [x.kind, x.to_email, x.subject]), [
    ['deadline_passed', 'ann@example.com', 'Your turn for Juniper × Ash has closed'],
    ['offer', 'bo@example.com', "It's your turn! Juniper × Ash"],
  ]);
  assert.match(m[1].body, /choose by October 17, 2026\.$/);

  // Bo's page offers the turn, and Bo can pick from it.
  const bo = await (await call(env, 'GET', `/f/status/${tok('b')}`)).json();
  assert.equal(bo.offers.length, 1);
  assert.equal(bo.emails[0].subject, "It's your turn! Juniper × Ash");

  // Running again changes nothing.
  assert.deepEqual(await runKennel(env, row(env), { now: NOW, origin: 'https://apply.example' }), { closed: 0, offered: 0, reminders: 0 });
  assert.equal(count(env, 'wl_events'), 2);
});

test('a moment she did not tick: the server records nothing and offers nobody', async () => {
  const { env } = await published({ auto: [] });
  assert.deepEqual(await runKennel(env, row(env), { now: NOW, origin: 'o' }), { closed: 0, offered: 0, reminders: 0 });
  assert.equal(count(env, 'wl_events'), 0);
  const picked = await published({ auto: ['no_response'], picked: 'p1' });
  assert.equal((await runKennel(picked.env, row(picked.env), { now: NOW, origin: 'o' })).closed, 0, 'a family that picked is a no_deposit');
});

test('before the end of the last day (kennel time), nothing closes', async () => {
  const { env } = await published();
  const lateEvening = new Date('2026-10-12T04:30:00Z'); // 23:30 on Oct 11 in Chicago
  assert.equal((await runKennel(env, row(env), { now: lateEvening, origin: 'o' })).closed, 0);
});

test("a family's pass on their page moves the turn on when she ticked it", async () => {
  const { env } = await published({ respondBy: '2026-10-20' });
  const { program_id: programId } = row(env);
  env.DB.raw.prepare(`INSERT INTO wl_events (program_id, public_id, entry_id, kind, payload, based_on_version, made_by, created_at)
    VALUES (?, ?, 'ann', 'pass', '{"turn_id":"t1","offer_ids":["o1"],"litter_ids":["l1"]}', 1, 'family', ?)`).run(programId, KENNEL, iso(Date.now()));
  const c = await runKennel(env, row(env), { now: NOW, origin: 'o' });
  assert.equal(c.offered, 1);
  const offer = events(env).find((e) => e.kind === 'server_offer');
  assert.equal(offer.entry_id, 'bo');
  assert.equal(offer.payload.cause, 'passed');
  assert.equal(offer.payload.cause_seq, 1);
  assert.equal(mails(env).filter((m) => m.kind === 'deadline_passed').length, 0, 'their own pass: no "closed" email');
});

test('reminders: halfway and on the last morning, the day before a fee is due, and Ready now? — each once', async () => {
  const { env } = await published({ respondBy: '2026-10-14', auto: [], feeDue: '2026-10-13' });
  const p = stored(env);
  p.entries.bo.ready_check = { asked: '2026-10-12', answer_by: null, answer: null };
  env.DB.raw.prepare('UPDATE wl_projection SET body = ?').run(JSON.stringify(p));
  // Oct 12, 10:00: Ann's 6-day turn (Oct 8–14) is past halfway; Dee's fee is due tomorrow.
  assert.equal((await runKennel(env, row(env), { now: NOW, origin: 'o' })).reminders, 3);
  assert.deepEqual(mails(env).map((m) => [m.kind, m.to_email]).sort(), [
    ['fee_reminder', 'dee@example.com'], ['offer_reminder', 'ann@example.com'], ['ready_check', 'bo@example.com'],
  ]);
  assert.match(mails(env).find((m) => m.kind === 'fee_reminder').body, /please pay by October 13, 2026\./);
  assert.equal((await runKennel(env, row(env), { now: NOW, origin: 'o' })).reminders, 0, 'once');
  // Before 8 am kennel time: nothing.
  const early = await published({ respondBy: '2026-10-14', auto: [] });
  assert.equal((await runKennel(early.env, row(early.env), { now: new Date('2026-10-12T11:00:00Z'), origin: 'o' })).reminders, 0);
  // The last morning.
  assert.equal((await runKennel(env, row(env), { now: new Date('2026-10-14T14:00:00Z'), origin: 'o' })).reminders, 1);
  // Switched off.
  const off = await published({ respondBy: '2026-10-14', auto: [], reminders: false });
  assert.equal((await runKennel(off.env, row(off.env), { now: NOW, origin: 'o' })).reminders, 0);
});

test('a publish that has not seen the server\'s moves is refused until her device applies them', async () => {
  const { env, s } = await published();
  await runWaitlistMoves(env, { now: NOW });
  const refused = await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: projection() } });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'events_pending');
  const last = events(env).at(-1).seq;
  const ok = await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: { ...projection(), events_through: last } } });
  assert.equal(ok.status, 200);
});

test('the hourly run covers every published kennel and survives a broken one', async () => {
  const { env } = await published();
  env.DB.raw.prepare(`INSERT INTO wl_projection (public_id, program_id, version, body, device_id, published_at) VALUES ('kos1_broken', ?, 1, 'not json', 'd', ?)`)
    .run(row(env).program_id, iso(Date.now()));
  const realError = console.error;
  console.error = () => {};
  try {
    const totals = await runWaitlistMoves(env, { now: NOW });
    assert.deepEqual(totals, { kennels: 2, closed: 1, offered: 1, reminders: 0, failed: 1 });
  } finally {
    console.error = realError;
  }
});

test('a pass made on the status page moves the turn on straight away', async () => {
  const env = await makeEnv({ FAMILY_PAGES_ORIGIN: 'https://apply.example' });
  const s = await breeder(env);
  const p = projection({ respondBy: '2026-12-01' });
  p.kennel.pass_reasons = [{ id: 'timing', label: 'Timing', message: 'Thanks for letting us know.' }];
  assert.equal((await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: p } })).status, 200);
  await call(env, 'POST', '/f/code', { body: { public_id: KENNEL, email: 'ann@example.com' }, ip: '192.0.2.9' });
  const code = /(\d{6})/.exec(env.DB.raw.prepare('SELECT subject FROM wl_messages ORDER BY rowid DESC LIMIT 1').get().subject)[1];
  const { session } = await (await call(env, 'POST', '/f/verify', { body: { public_id: KENNEL, code }, ip: '192.0.2.9' })).json();
  const res = await call(env, 'POST', '/f/act', { body: { session, status_token: tok('a'), action: 'pass', turn_id: 't1', reason_id: 'timing' } });
  assert.equal(res.status, 200);
  const kinds = events(env).map((e) => [e.kind, e.entry_id, e.made_by]);
  assert.deepEqual(kinds, [['pass', 'ann', 'family'], ['server_offer', 'bo', 'server']]);
  assert.equal(events(env)[1].payload.cause_seq, events(env)[0].seq);
  const bo = await (await call(env, 'GET', `/f/status/${tok('b')}`)).json();
  assert.equal(bo.offers.length, 1, "Bo's page offers the turn now");
});
