// The server's own moves (docs/KennelOS_Waitlist_W2_Plan.md §6, step 7): a
// deadline she lets the server close, the next family offered from her published
// order, a family's pass moving the turn on, reminders once each, the status page
// showing it all, and a publish refused until her device has applied the moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn } from './helpers/env.js';

const { localNow, addDays, addOpenDays, fillTemplate, openTurns, nextFromQueue, runKennel, runWaitlistMoves, turnIsEmpty } = await import('../src/serverMoves.js');
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
  assert.deepEqual(localNow(new Date('2026-10-12T04:30:00Z'), 'America/Chicago'), { date: '2026-10-11', hour: 23, time: '23:30' });
  assert.deepEqual(localNow(new Date('2026-10-12T04:30:00Z'), 'Not/AZone'), { date: '2026-10-12', hour: 4, time: '04:30' });
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

test('a turn with no pup left in it: the server neither closes it at its deadline nor reminds them', async () => {
  const p = projection();
  const t = openTurns(p)[0];
  assert.equal(turnIsEmpty(p, t), false);
  p.litters.l1.pups = [{ id: 'p3' }];
  assert.equal(turnIsEmpty(p, openTurns(p)[0]), true, 'none of p1, p2 is still available');
  assert.equal(turnIsEmpty(p, { ...openTurns(p)[0], picked: 'p1' }), false, 'a pick holds it');
  delete p.litters.l1;
  assert.equal(turnIsEmpty(p, openTurns(p)[0]), false, 'a litter not in the projection says nothing');

  const env = await makeEnv({ FAMILY_PAGES_ORIGIN: 'https://apply.example' });
  const s = await breeder(env);
  const gone = projection();
  gone.litters.l1.pups = [];
  assert.equal((await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: gone } })).status, 200);
  const c = await runKennel(env, row(env), { now: NOW, origin: 'https://apply.example' });
  assert.deepEqual(c, { closed: 0, offered: 0, reminders: 0 });
  assert.deepEqual(events(env), []);
  assert.deepEqual(mails(env), [], 'no "your deadline passed" email');
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

test('her alerts and digest hear about the server\'s moves, as she must contact the family offered', async () => {
  const { env, s } = await published();
  await call(env, 'POST', '/notify/digest', { token: s.token, body: { email: 'breeder@example.com', tz: 'America/Chicago' } });
  await runKennel(env, row(env), { now: NOW, origin: 'https://apply.example' });
  const items = env.DB.raw.prepare('SELECT kind, what, name, kennel, entry_id FROM notify_items ORDER BY seq').all().map((r) => ({ ...r }));
  assert.deepEqual(items, [
    { kind: 'server_move', what: 'server_close', name: 'Ann L.', kennel: 'Thornfield Kennels', entry_id: 'ann' },
    { kind: 'server_move', what: 'server_offer', name: 'Bo K.', kennel: 'Thornfield Kennels', entry_id: 'bo' },
  ]);
});

test('her open days: a turn the server offers counts only the days she does business, like her device', () => {
  const noSat = [0, 1, 2, 3, 4, 5];
  assert.equal(addOpenDays('2026-11-06', 3, noSat), '2026-11-10', 'Fri + 3 open days, Saturday closed');
  assert.equal(addOpenDays('2026-11-06', 3, null), '2026-11-09', 'every day open');
  assert.equal(addOpenDays('2026-11-08', -1, noSat), '2026-11-06', 'the open day before');
});

test('her closed dates: a turn the server offers skips them too', () => {
  assert.equal(addOpenDays('2026-11-25', 2, [0, 1, 2, 3, 4, 5], ['2026-11-26', '2026-11-27']), '2026-11-30');
  assert.equal(addOpenDays('2026-11-25', 2, null, ['2026-11-26']), '2026-11-28');
});

test('a side sale row (direct) is never a turn: no block, no close, no "deciding"; reminders still go', async () => {
  const p = projection();
  p.entries.ann.offers = [];
  p.entries.cy.offers = [{ id: 's1', turn_id: 's1', litter_id: 'l1', offered_date: '2026-10-08', respond_by_date: '2026-10-11', eligible_dog_ids: ['p2'], picked_dog_id: 'p2', direct: true }];
  assert.equal(openTurns(p).length, 0, 'not a turn');
  assert.equal(openTurns(p, { includeDirect: true }).length, 1, 'the reminders see it');
  assert.equal(nextFromQueue(p).entryId, 'bo', 'it never blocks the next turn');
  // Past its deadline with every automatic close ticked: the server leaves it to her.
  const { env } = await published({ respondBy: '2026-10-20' });
  const body = stored(env);
  body.entries.ann.offers = [];
  body.entries.cy.offers = p.entries.cy.offers;
  env.DB.raw.prepare('UPDATE wl_projection SET body = ?').run(JSON.stringify(body));
  await runKennel(env, row(env), NOW);
  assert.equal(events(env).filter((e) => e.kind === 'server_close').length, 0, 'a side sale is never closed by the server');
  assert.deepEqual(stored(env).entries.cy.offers.map((o) => o.id), ['s1']);
});

// --- Review K4-1 and K4-7 (fix step 9b): a move lands once, or not at all ---------

test('K4-1: two runs on the same version (the hourly run and a pass) make one close, one offer, one email each', async () => {
  const { env } = await published();
  const r = row(env);
  const first = await runKennel(env, r, { now: NOW, origin: 'o' });
  const second = await runKennel(env, r, { now: NOW, origin: 'o' });
  assert.deepEqual(first, { closed: 1, offered: 1, reminders: 0 });
  assert.equal(second.lost, true);
  assert.deepEqual(events(env).map((e) => e.kind), ['server_close', 'server_offer']);
  assert.deepEqual(mails(env).map((m) => [m.kind, m.to_email]), [['deadline_passed', 'ann@example.com'], ['offer', 'bo@example.com']]);
});

test('K4-1: her device publishing inside the run\'s window: nothing written, nobody emailed, the next run does it once', async () => {
  const { env } = await published();
  const r = row(env);
  env.DB.raw.prepare('UPDATE wl_projection SET version = version + 1').run(); // her publish lands first
  const lost = await runKennel(env, r, { now: NOW, origin: 'o' });
  assert.equal(lost.lost, true);
  assert.equal(count(env, 'wl_events'), 0);
  assert.equal(count(env, 'wl_messages'), 0);
  assert.equal(stored(env).entries.ann.offers.length, 1, 'Ann\'s turn still open');
  const next = await runKennel(env, row(env), { now: NOW, origin: 'o' });
  assert.deepEqual(next, { closed: 1, offered: 1, reminders: 0 });
  assert.equal(count(env, 'wl_events'), 2);
});

test('K4-1: an email that throws after the move landed is recorded as failed; the move is not done again', async () => {
  const { env } = await published();
  env.RESEND_API_KEY = 'test-key';
  delete env.DEV_OUTBOX;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  const error = console.error;
  console.error = () => {};
  try {
    const c = await runKennel(env, row(env), { now: NOW, origin: 'o' });
    assert.deepEqual(c, { closed: 1, offered: 1, reminders: 0 });
    assert.deepEqual(env.DB.raw.prepare('SELECT kind, status FROM wl_messages ORDER BY rowid').all().map((m) => [m.kind, m.status]),
      [['deadline_passed', 'failed'], ['offer', 'failed']]);
    await runKennel(env, row(env), { now: NOW, origin: 'o' });
    assert.deepEqual(events(env).map((e) => e.kind), ['server_close', 'server_offer'], 'no second close or offer');
  } finally {
    globalThis.fetch = realFetch;
    console.error = error;
  }
});

test('K4-7: a fee reminder whose day was missed goes on the due day, once', async () => {
  const { env } = await published({ auto: [], feeDue: '2026-10-13', respondBy: '2026-10-20' });
  // Oct 12 (the day before) had no run; Oct 13, 10:00 Chicago.
  const dueDay = new Date('2026-10-13T15:00:00Z');
  await runKennel(env, row(env), { now: dueDay, origin: 'o' });
  assert.equal(mails(env).filter((m) => m.kind === 'fee_reminder').length, 1);
  await runKennel(env, row(env), { now: dueDay, origin: 'o' });
  assert.equal(mails(env).filter((m) => m.kind === 'fee_reminder').length, 1, 'once');
  // After the due day, nothing.
  const late = await published({ auto: [], feeDue: '2026-10-11', respondBy: '2026-10-20' });
  await runKennel(late.env, row(late.env), { now: NOW, origin: 'o' });
  assert.equal(mails(late.env).filter((m) => m.kind === 'fee_reminder').length, 0);
});

test('a turn\'s deadline is its latest row\'s, whichever row comes first (K6-12)', () => {
  const p = { entries: { ann: { offers: [
    { id: 'o1', turn_id: 't', litter_id: 'l1', offered_date: '2026-10-01', respond_by_date: '2026-10-04' },
    { id: 'o2', turn_id: 't', litter_id: 'l2', offered_date: '2026-10-02', respond_by_date: '2026-10-09' }
  ] } } };
  assert.equal(openTurns(p)[0].respondBy, '2026-10-09');
});

test('a kennel with no time zone has no deadline closed or reminded by the server (D11, K6-3)', async () => {
  const { env } = await published();
  const p = stored(env);
  delete p.kennel.time_zone;
  env.DB.raw.prepare('UPDATE wl_projection SET body = ?').run(JSON.stringify(p));
  assert.deepEqual(await runKennel(env, row(env), { now: NOW, origin: 'o' }), { closed: 0, offered: 0, reminders: 0 });
  assert.equal(count(env, 'wl_events'), 0);
  assert.equal(mails(env).length, 0);
});

// --- Deadlines at a time of day (Waitlist Timers plan) ---------------------------------

const timers = await import('../src/serverMoves.js');

// Ann's turn ends at 7:00 pm Chicago on Oct 12 (00:00 UTC Oct 13); turns are 24 hours,
// waking hours 8 am–9 pm.
async function timed() {
  const out = await published();
  const p = stored(out.env);
  p.entries.ann.offers[0].respond_by_date = '2026-10-12';
  p.entries.ann.offers[0].respond_by_time = '19:00';
  Object.assign(p.kennel, { turn_hours: 24, awake_from: '08:00', awake_until: '21:00' });
  p.turn_queue[0].respond_hours = 24;
  out.env.DB.raw.prepare('UPDATE wl_projection SET body = ?').run(JSON.stringify(p));
  return out;
}

test('a deadline at 7:00 pm: open at 6:30 pm, closed on the 7:00 pm run; the next turn ends 24 hours later', async () => {
  const before = await timed();
  assert.equal((await runKennel(before.env, row(before.env), { now: new Date('2026-10-12T23:30:00Z'), origin: 'o' })).closed, 0, '6:30 pm: still open');
  const { env } = await timed();
  const c = await runKennel(env, row(env), { now: new Date('2026-10-13T00:00:00Z'), origin: 'o' });
  assert.equal(c.closed, 1);
  assert.equal(c.offered, 1);
  const ev = events(env);
  assert.equal(ev[0].payload.respond_by_time, '19:00');
  assert.equal(ev[1].payload.offered_date, '2026-10-12');
  assert.equal(ev[1].payload.respond_by_date, '2026-10-13');
  assert.equal(ev[1].payload.respond_by_time, '19:00');
  assert.equal(stored(env).entries.bo.offers[0].respond_by_time, '19:00');
  const offer = mails(env).find((m) => m.kind === 'offer');
  assert.match(offer.body, /choose by October 13, 2026 at 7:00 pm/);
});

test('hours deadlines: rounded up to the half hour, kept in waking hours, closed days skipped', () => {
  const awake = { from: 8 * 60, until: 21 * 60 };
  assert.deepEqual(timers.hoursDeadline({ date: '2026-10-12', time: '19:13' }, 24, null, [], awake), { date: '2026-10-13', time: '19:30' });
  assert.deepEqual(timers.hoursDeadline({ date: '2026-10-12', time: '02:00' }, 24, null, [], awake), { date: '2026-10-13', time: '08:00' }, 'before waking hours: their start');
  assert.deepEqual(timers.hoursDeadline({ date: '2026-10-12', time: '22:00' }, 24, null, [], awake), { date: '2026-10-14', time: '08:00' }, 'after them: the next morning');
  // Sunday Oct 18 closed: Saturday 7 pm + 24 h runs Saturday's 5 hours, then Monday's 19.
  assert.deepEqual(timers.hoursDeadline({ date: '2026-10-17', time: '19:00' }, 24, [1, 2, 3, 4, 5, 6], [], awake), { date: '2026-10-19', time: '19:00' });
  assert.deepEqual(timers.hoursDeadline({ date: '2026-10-12', time: '19:00' }, 24, null, ['2026-10-13'], awake), { date: '2026-10-14', time: '19:00' }, 'a closed date too');
});

test('the last reminder of a timed turn: 3 hours before, never before waking hours', () => {
  const k = { awake_from: '08:00', awake_until: '21:00' };
  assert.equal(timers.lastReminderKey({ respondBy: '2026-10-12', respondByTime: '19:00' }, k), '2026-10-12T16:00');
  assert.equal(timers.lastReminderKey({ respondBy: '2026-10-12', respondByTime: '09:00' }, k), '2026-10-11T20:00', 'the evening before');
  assert.equal(timers.lastReminderKey({ respondBy: '2026-10-12', respondByTime: null }, k), null, 'a day deadline keeps the morning one');
  assert.equal(fillTemplate(TEMPLATES.offer, { family: 'Ann', litters: ['A'], respondBy: '2026-10-20', respondByTime: '07:30' }).body, 'Hi Ann, choose by October 20, 2026 at 7:30 am.');
});

test('a timed turn reminds them 3 hours before its deadline, once', async () => {
  const early = await timed();
  assert.equal((await runKennel(early.env, row(early.env), { now: new Date('2026-10-12T20:30:00Z'), origin: 'o' })).reminders, 0, '3:30 pm: not yet (the fee is not due)');
  const { env } = await timed();
  assert.equal((await runKennel(env, row(env), { now: new Date('2026-10-12T21:00:00Z'), origin: 'o' })).reminders, 1, '4:00 pm');
  assert.match(mails(env).find((m) => m.kind === 'offer_reminder').body, /ends October 12, 2026 at 7:00 pm/);
  assert.equal((await runKennel(env, row(env), { now: new Date('2026-10-12T21:30:00Z'), origin: 'o' })).reminders, 0, 'once');
});

// --- Countdowns and the turn estimate (Waitlist Timers plan Phases 2–3) ----------------

test('a kennel wall time as a moment, across daylight saving and odd offsets', () => {
  assert.equal(new Date(timers.zonedInstant('2026-11-21', '19:00', 'America/Chicago')).toISOString(), '2026-11-22T01:00:00.000Z');
  assert.equal(new Date(timers.zonedInstant('2026-06-21', '19:00', 'America/Chicago')).toISOString(), '2026-06-22T00:00:00.000Z');
  assert.equal(new Date(timers.zonedInstant('2026-10-11', null, 'America/Chicago')).toISOString(), '2026-10-12T05:00:00.000Z', 'no time: the end of the day');
  assert.equal(new Date(timers.zonedInstant('2026-11-21', '08:00', 'Asia/Kathmandu')).toISOString(), '2026-11-21T02:15:00.000Z');
  assert.equal(timers.zonedInstant('', '08:00', 'UTC'), null);
});

test('the estimate: every family ahead in the one turn order using its full time (days)', () => {
  const p = projection();
  const now = new Date('2026-10-10T15:00:00Z');
  // Ann holds the turn until the end of Oct 11; Bo is first in line, Cy second.
  assert.equal(timers.turnEstimate(p, 'ann', now), null, 'holding a turn: no estimate');
  const bo = timers.turnEstimate(p, 'bo', now);
  assert.equal(new Date(bo.at).toISOString(), '2026-10-12T05:00:00.000Z');
  assert.equal(bo.next, false);
  assert.equal(bo.short, false);
  const cy = timers.turnEstimate(p, 'cy', now);
  assert.equal(new Date(cy.at).toISOString(), '2026-10-16T05:00:00.000Z', 'after Bo\'s 3 days');
  assert.equal(cy.short, true, 'one pup they\'d take, one family ahead');
  assert.equal(timers.turnEstimate(p, 'dee', now), null, 'not on the list yet');
  p.kennel.time_zone = null;
  assert.equal(timers.turnEstimate(p, 'bo', now), null, 'no kennel clock, no estimate');
});

test('the estimate with turns in hours, and from her next planned opening', () => {
  const p = projection();
  p.entries.ann.offers[0].respond_by_date = '2026-10-12';
  p.entries.ann.offers[0].respond_by_time = '19:00';
  Object.assign(p.kennel, { turn_hours: 24, awake_from: '08:00', awake_until: '21:00' });
  const now = new Date('2026-10-12T15:00:00Z');
  assert.equal(new Date(timers.turnEstimate(p, 'bo', now).at).toISOString(), '2026-10-13T00:00:00.000Z');
  assert.equal(new Date(timers.turnEstimate(p, 'cy', now).at).toISOString(), '2026-10-14T00:00:00.000Z');

  // Nothing open; her next litter is planned to open Oct 20 at 7 pm.
  p.entries.ann.offers = [];
  p.turn_queue = [];
  p.next_opening = { litter_id: 'l2', date: '2026-10-20', time: '19:00', queue: [{ entry_id: 'bo', pups: 2, planned: true }, { entry_id: 'cy', pups: 1, planned: true }] };
  assert.equal(timers.turnEstimate(p, 'bo', now), null, 'only for a planned litter she shows on family pages');
  p.upcoming = [{ id: 'l2', kind: 'early_litter', litter_id: 'l2', family: true }];
  const bo = timers.turnEstimate(p, 'bo', now);
  assert.equal(new Date(bo.at).toISOString(), '2026-10-21T00:00:00.000Z', 'when picks open');
  assert.equal(bo.opens_at, bo.at);
  assert.equal(new Date(timers.turnEstimate(p, 'cy', now).at).toISOString(), '2026-10-22T00:00:00.000Z');
  assert.equal(timers.turnEstimate(p, 'cy', new Date('2026-10-21T01:00:00Z')), null, 'once the planned time has passed, the open order counts');
});

test('picks due to open: one alert to her on the run that holds the planned time', async () => {
  const { env } = await published();
  const p = stored(env);
  p.litters.l2 = { label: 'Willow × Ash', picks_open: false, pups: [{ id: 'p9' }], planned_open: { date: '2026-10-12', time: '19:00' } };
  env.DB.raw.prepare('UPDATE wl_projection SET body = ?').run(JSON.stringify(p));
  const at = new Date('2026-10-13T00:00:00Z'); // 7:00 pm Chicago
  assert.equal((await runKennel(env, row(env), { now: new Date('2026-10-12T23:30:00Z'), origin: 'o', cron: true })).picks_due ?? 0, 0, '6:30 pm: not yet');
  assert.equal((await runKennel(env, row(env), { now: at, origin: 'o' })).picks_due ?? 0, 0, 'never from a family\'s pass');
  assert.equal((await runKennel(env, row(env), { now: at, origin: 'o', cron: true })).picks_due, 1);
  assert.equal((await runKennel(env, row(env), { now: new Date('2026-10-13T00:30:00Z'), origin: 'o', cron: true })).picks_due ?? 0, 0, 'the next run: once');
});

test('the family\'s page gets the estimate as a time (never a count) and each deadline as a moment', async () => {
  const { statusView } = await import('../src/familyPages.js');
  const p = projection();
  const now = new Date('2026-10-10T15:00:00Z');
  const cy = statusView(p, 'cy', now);
  assert.deepEqual(cy.family.turn_estimate, { at: '2026-10-16T05:00:00.000Z', next: false, short: true });
  const ann = statusView(p, 'ann', now);
  assert.equal(ann.family.turn_estimate, undefined);
  assert.equal(ann.offers[0].respond_by_at, '2026-10-12T05:00:00.000Z');
});
