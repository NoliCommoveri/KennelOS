// The waitlist online, her side (docs/KennelOS_Waitlist_W2_Plan.md §4–§6):
// publishing a kennel's projection and its status-page tokens, taking it
// offline, the encrypted inbox, the events stream, and the bookkeeping around
// them (Pro only, backing device only for writes, retention, export, deletion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn } from './helpers/env.js';

const { runRetention } = await import('../src/retention.js');
const { exportAll } = await import('../src/backup.js');
const { splitTokens, PROJECTION_MAX_BYTES, WAITLIST_LIMITS } = await import('../src/waitlist.js');

const KENNEL = 'kos1_11111111-2222-4333-8444-555555555555';
const OTHER_KENNEL = 'kos1_99999999-2222-4333-8444-555555555555';
const tok = (c) => c.repeat(64);
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const count = (env, table) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

function makePro(env, session) {
  const { email_hash: eh } = env.DB.raw.prepare(
    'SELECT u.email_hash FROM users u JOIN programs p ON p.owner_user_id = u.id WHERE p.id = ?',
  ).get(session.programId);
  env.DB.raw.prepare(
    `INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
     VALUES (?, ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`,
  ).run(`order:${session.programId}`, eh, iso(Date.now()), iso(Date.now()));
}

// A Pro breeder whose phone is the backing device.
async function breeder(env, email = 'breeder@example.com', deviceId = 'phone-1') {
  const s = await signIn(env, email, { deviceId });
  makePro(env, s);
  await call(env, 'POST', '/program/backing-device', { token: s.token });
  return s;
}

const projection = (entries = {}) => ({
  kennel: { name: 'Thornfield Kennels', time_zone: 'America/Chicago', auto_offer_on: [] },
  public_list: [{ position: 1, name: 'Ann L.', pref_sex: 'female', added: '2026-09-01' }],
  entries,
  litters: {},
});

const publish = (env, s, body, kennel = KENNEL) => call(env, 'PUT', `/waitlist/projection/${kennel}`, { token: s.token, body });

function inboxItem(env, s, id, { acked = null, kind = 'application', created = iso(Date.now()), confirmed = true } = {}) {
  env.DB.raw.prepare(
    `INSERT INTO wl_inbox (id, program_id, public_id, kind, entry_id, name, email, key_id, blob, created_at, acked_at, confirmed_at)
     VALUES (?, ?, ?, ?, NULL, 'Ann Lee', 'ann@example.com', 'k1', 'ciphertext', ?, ?, ?)`,
  ).run(id, s.programId, KENNEL, kind, created, acked, confirmed ? created : null);
}

function event(env, s, kind, { created = iso(Date.now()), entry = 'e1' } = {}) {
  env.DB.raw.prepare(
    `INSERT INTO wl_events (program_id, public_id, entry_id, kind, payload, based_on_version, made_by, created_at)
     VALUES (?, ?, ?, ?, '{"litter_id":"l1"}', 3, 'family', ?)`,
  ).run(s.programId, KENNEL, entry, kind, created);
}

test('every waitlist route needs a server-known Pro account', async () => {
  const env = await makeEnv();
  const s = await signIn(env, 'lite@example.com', { deviceId: 'phone-1' });
  for (const [method, path, body] of [
    ['PUT', `/waitlist/projection/${KENNEL}`, { projection: projection() }],
    ['GET', `/waitlist/projection/${KENNEL}`],
    ['DELETE', `/waitlist/projection/${KENNEL}`],
    ['GET', '/waitlist/inbox'],
    ['POST', '/waitlist/inbox/ack', { ids: [] }],
    ['GET', '/waitlist/events?since=0'],
  ]) {
    const res = await call(env, method, path, { token: s.token, body });
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.equal((await res.json()).error, 'pro_required');
  }
  assert.equal((await call(env, 'GET', '/waitlist/inbox')).status, 401, 'and a signed-in one');
});

test('publishing stores the projection without its tokens, and counts versions', async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  const first = await publish(env, s, { projection: projection({ e1: { status: 'active', status_token: tok('a') }, e2: { status: 'applied' } }) });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).version, 1);

  const read = await (await call(env, 'GET', `/waitlist/projection/${KENNEL}`, { token: s.token })).json();
  assert.equal(read.version, 1);
  assert.deepEqual(read.projection.entries, { e1: { status: 'active' }, e2: { status: 'applied' } });
  assert.equal(JSON.stringify(read).includes(tok('a')), false, 'the token never comes back in the body');
  const raw = env.DB.raw.prepare('SELECT body FROM wl_projection').get().body;
  assert.equal(raw.includes(tok('a')), false, 'nor is it stored there');
  assert.deepEqual(env.DB.raw.prepare('SELECT token, entry_id, public_id FROM wl_tokens').all().map((r) => ({ ...r })),
    [{ token: tok('a'), entry_id: 'e1', public_id: KENNEL }]);

  // New link: e1's token replaced; e2 gets its first one.
  const second = await publish(env, s, { projection: projection({ e1: { status: 'active', status_token: tok('b') }, e2: { status: 'approved', status_token: tok('c') } }) });
  assert.equal((await second.json()).version, 2);
  assert.deepEqual(env.DB.raw.prepare('SELECT token FROM wl_tokens ORDER BY token').all().map((r) => r.token), [tok('b'), tok('c')]);
});

test('a projection or token that is not well formed is refused', async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  assert.equal((await call(env, 'PUT', '/waitlist/projection/thornfield', { token: s.token, body: { projection: projection() } })).status, 400);
  assert.equal((await publish(env, s, {})).status, 400);
  assert.equal((await publish(env, s, { projection: [] })).status, 400);
  assert.equal((await publish(env, s, { projection: { entries: [] } })).status, 400);
  assert.equal((await publish(env, s, { projection: projection({ e1: { status_token: 'short' } }) })).status, 400);
  assert.equal((await publish(env, s, { projection: projection({ 'bad id!': {} }) })).status, 400);
  const dup = await publish(env, s, { projection: projection({ e1: { status_token: tok('a') }, e2: { status_token: tok('a') } }) });
  assert.equal(dup.status, 400, 'two families can never share a link');
  const huge = await publish(env, s, { projection: { ...projection(), filler: 'x'.repeat(PROJECTION_MAX_BYTES) } });
  assert.equal(huge.status, 413);
  assert.equal(count(env, 'wl_projection'), 0);
  assert.throws(() => splitTokens({ entries: { e1: null } }), /bad_projection/);
});

test('only the backing device writes; her other devices can read', async () => {
  const env = await makeEnv();
  const phone = await breeder(env);
  const laptop = await signIn(env, 'breeder@example.com', { deviceId: 'laptop-1' });
  assert.equal((await publish(env, phone, { projection: projection() })).status, 200);

  const refused = await publish(env, laptop, { projection: projection() });
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.equal(body.error, 'not_backing_device');
  assert.equal(body.backingDevice.id, phone.deviceId);
  assert.equal((await call(env, 'DELETE', `/waitlist/projection/${KENNEL}`, { token: laptop.token })).status, 409);
  assert.equal((await call(env, 'POST', '/waitlist/inbox/ack', { token: laptop.token, body: { ids: [] } })).status, 409);

  assert.equal((await call(env, 'GET', `/waitlist/projection/${KENNEL}`, { token: laptop.token })).status, 200);
  assert.equal((await call(env, 'GET', '/waitlist/inbox', { token: laptop.token })).status, 200);
  assert.equal((await call(env, 'GET', '/waitlist/events', { token: laptop.token })).status, 200);
});

test("another account can't publish over a kennel, read it, or take its tokens", async () => {
  const env = await makeEnv();
  const a = await breeder(env, 'a@example.com', 'a-phone');
  const b = await breeder(env, 'b@example.com', 'b-phone');
  assert.equal((await publish(env, a, { projection: projection({ e1: { status_token: tok('a') } }) })).status, 200);

  const over = await publish(env, b, { projection: projection() });
  assert.equal(over.status, 409);
  assert.equal((await over.json()).error, 'kennel_taken');
  assert.equal((await call(env, 'GET', `/waitlist/projection/${KENNEL}`, { token: b.token })).status, 409);
  assert.equal((await call(env, 'DELETE', `/waitlist/projection/${KENNEL}`, { token: b.token })).status, 409);

  const steal = await publish(env, b, { projection: projection({ e9: { status_token: tok('a') } }) }, OTHER_KENNEL);
  assert.equal(steal.status, 409);
  assert.equal((await steal.json()).error, 'token_taken');
  assert.equal(env.DB.raw.prepare('SELECT program_id FROM wl_tokens').get().program_id, a.programId);
  assert.equal((await call(env, 'GET', `/waitlist/projection/${OTHER_KENNEL}`, { token: b.token })).status, 404);
});

test('taking a list offline removes the projection, its links and its holds, not the inbox', async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  await publish(env, s, { projection: projection({ e1: { status_token: tok('a') } }) });
  env.DB.raw.prepare(`INSERT INTO wl_holds (public_id, dog_id, program_id, entry_id, offer_id, created_at) VALUES (?, 'd1', ?, 'e1', 'o1', ?)`)
    .run(KENNEL, s.programId, iso(Date.now()));
  inboxItem(env, s, 'i1');
  assert.equal((await call(env, 'DELETE', `/waitlist/projection/${KENNEL}`, { token: s.token })).status, 200);
  assert.equal(count(env, 'wl_projection'), 0);
  assert.equal(count(env, 'wl_tokens'), 0);
  assert.equal(count(env, 'wl_holds'), 0);
  assert.equal(count(env, 'wl_inbox'), 1);
  // Publishing again starts it afresh.
  assert.equal((await (await publish(env, s, { projection: projection() })).json()).version, 1);
});

test('the inbox gives unacknowledged items oldest first; the backing device acknowledges them', async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  const other = await breeder(env, 'other@example.com', 'other-phone');
  inboxItem(env, s, 'i2', { created: iso(Date.now() - 1000) });
  inboxItem(env, s, 'i1', { created: iso(Date.now() - 2000) });
  inboxItem(env, s, 'i0', { acked: iso(Date.now()) });
  inboxItem(env, other, 'x1');

  const inbox = await (await call(env, 'GET', '/waitlist/inbox', { token: s.token })).json();
  assert.deepEqual(inbox.items.map((i) => i.id), ['i1', 'i2']);
  assert.equal(inbox.more, false);
  assert.deepEqual(Object.keys(inbox.items[0]).sort(), ['acked', 'blob', 'createdAt', 'email', 'entryId', 'id', 'keyId', 'kind', 'name', 'publicId', 'statusToken']);

  const ack = await (await call(env, 'POST', '/waitlist/inbox/ack', { token: s.token, body: { ids: ['i1', 'x1', 'nope'] } })).json();
  assert.equal(ack.acked, 1, "another account's item is never touched");
  assert.deepEqual((await (await call(env, 'GET', '/waitlist/inbox', { token: s.token })).json()).items.map((i) => i.id), ['i2']);
  assert.equal(env.DB.raw.prepare("SELECT acked_at FROM wl_inbox WHERE id = 'x1'").get().acked_at, null);
  assert.equal((await call(env, 'POST', '/waitlist/inbox/ack', { token: s.token, body: { ids: 'i2' } })).status, 400);
  assert.equal((await call(env, 'POST', '/waitlist/inbox/ack', { token: s.token, body: { ids: Array(WAITLIST_LIMITS.inboxPage + 1).fill('a') } })).status, 400);
});

test('events are read after a cursor, in pages, and never consumed', async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  const other = await breeder(env, 'other@example.com', 'other-phone');
  event(env, s, 'pass');
  event(env, other, 'pass');
  event(env, s, 'pause_request');

  const all = await (await call(env, 'GET', '/waitlist/events?since=0', { token: s.token })).json();
  assert.deepEqual(all.events.map((e) => e.kind), ['pass', 'pause_request']);
  assert.deepEqual(all.events[0].payload, { litter_id: 'l1' });
  assert.equal(all.events[0].basedOnVersion, 3);
  assert.equal(all.events[0].madeBy, 'family');
  assert.equal(all.last, all.events[1].seq);

  const after = await (await call(env, 'GET', `/waitlist/events?since=${all.events[0].seq}`, { token: s.token })).json();
  assert.deepEqual(after.events.map((e) => e.kind), ['pause_request']);
  const none = await (await call(env, 'GET', `/waitlist/events?since=${all.last}`, { token: s.token })).json();
  assert.deepEqual(none, { events: [], last: all.last, more: false });
  assert.equal((await (await call(env, 'GET', '/waitlist/events', { token: s.token })).json()).events.length, 2, 'reading consumed nothing');
  assert.equal((await call(env, 'GET', '/waitlist/events?since=-1', { token: s.token })).status, 400);

  for (let i = 0; i < WAITLIST_LIMITS.eventsPage; i++) event(env, s, 'still_interested');
  const page = await (await call(env, 'GET', '/waitlist/events?since=0', { token: s.token })).json();
  assert.equal(page.events.length, WAITLIST_LIMITS.eventsPage);
  assert.equal(page.more, true);
});

test('the waitlist routes are rate-limited per program', async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  const window = `${new Date().toISOString().slice(0, 13)}:00:00Z`;
  env.DB.raw.prepare('INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, ?)')
    .run(`wl:${s.programId}`, window, WAITLIST_LIMITS.callsPerHour);
  const res = await call(env, 'GET', '/waitlist/inbox', { token: s.token });
  assert.equal(res.status, 429);
});

function snapshot(env, s, created, { vault = true } = {}) {
  env.DB.raw.prepare(
    `INSERT INTO snapshots (id, program_id, device_id, created_at, size, counts_json, r2_key, status, vault_size, vault_key_id, vault_landed)
     VALUES (?, ?, 'phone', ?, 1, '{}', ?, 'committed', ?, ?, ?)`,
  ).run(`snap-${created}-${vault}`, s.programId, created, `snapshots/${s.programId}/${created}.json.gz`,
    vault ? 1 : null, vault ? 'vk1' : null, vault ? 1 : 0);
}

test("an application stays on the server until it's safe in a private backup made after her device took it in", async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  const now = Date.now();
  inboxItem(env, s, 'unread', { created: iso(now - 400 * DAY) });
  inboxItem(env, s, 'acked-recently', { acked: iso(now - 2 * DAY) });
  inboxItem(env, s, 'acked-long-ago', { acked: iso(now - 60 * DAY) });

  await runRetention(env, new Date(now));
  assert.equal(count(env, 'wl_inbox'), 3, 'no backup since: everything stays');

  snapshot(env, s, iso(now - 50 * DAY), { vault: false });
  await runRetention(env, new Date(now));
  assert.equal(count(env, 'wl_inbox'), 3, 'a backup without the private part holds only name and email: still kept');

  snapshot(env, s, iso(now - 70 * DAY));
  await runRetention(env, new Date(now));
  assert.equal(count(env, 'wl_inbox'), 3, 'a private backup from BEFORE the ack never had it');

  snapshot(env, s, iso(now - DAY));
  await runRetention(env, new Date(now));
  assert.deepEqual(env.DB.raw.prepare('SELECT id FROM wl_inbox ORDER BY id').all().map((r) => r.id), ['acked-recently', 'unread'],
    'only an item acknowledged 30+ days ago and private-backed-up since goes; an unread one never does');
});

test('a reset or new phone can fetch again what was acknowledged but is still on the server', async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  const now = Date.now();
  for (let i = 0; i < WAITLIST_LIMITS.inboxPage + 5; i++) {
    inboxItem(env, s, `i${String(i).padStart(3, '0')}`, { created: iso(now - 1000 * (200 - i)), acked: i % 2 ? iso(now) : null });
  }
  const unread = await (await call(env, 'GET', '/waitlist/inbox', { token: s.token })).json();
  assert.equal(unread.items.length, 53);
  assert.equal(unread.more, false);
  assert.ok(unread.items.every((i) => !i.acked));

  const first = await (await call(env, 'GET', '/waitlist/inbox?all=1', { token: s.token })).json();
  assert.equal(first.items.length, WAITLIST_LIMITS.inboxPage);
  assert.equal(first.more, true);
  const second = await (await call(env, 'GET', `/waitlist/inbox?all=1&after=${encodeURIComponent(first.next)}`, { token: s.token })).json();
  assert.equal(second.items.length, 5);
  assert.equal(second.more, false);
  assert.equal(second.next, null);
  const ids = [...first.items, ...second.items].map((i) => i.id);
  assert.equal(new Set(ids).size, WAITLIST_LIMITS.inboxPage + 5, 'every item once, in order');
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(first.items[1].acked, true);
  assert.equal((await call(env, 'GET', '/waitlist/inbox?after=nonsense', { token: s.token })).status, 400);
});

test('retention trims old events and old email bodies', async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  const now = Date.now();
  event(env, s, 'pass', { created: iso(now - 91 * DAY) });
  event(env, s, 'pass', { created: iso(now - 5 * DAY) });
  for (const [id, sentAt] of [['m-old', iso(now - 91 * DAY)], ['m-new', iso(now - DAY)]]) {
    env.DB.raw.prepare(
      `INSERT INTO wl_messages (id, program_id, public_id, kind, to_email, subject, body, send_after, status, sent_at, created_at)
       VALUES (?, ?, ?, 'offer', 'ann@example.com', 'Your turn', 'Hello', ?, 'sent', ?, ?)`,
    ).run(id, s.programId, KENNEL, sentAt, sentAt, sentAt);
  }
  await runRetention(env, new Date(now));
  assert.equal(count(env, 'wl_events'), 1);
  const msgs = env.DB.raw.prepare('SELECT id, subject, body FROM wl_messages ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(msgs, [{ id: 'm-new', subject: 'Your turn', body: 'Hello' }, { id: 'm-old', subject: 'Your turn', body: null }]);
});

test('the /ops export carries the waitlist tables, and deleting the account removes them', async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  const keep = await breeder(env, 'keep@example.com', 'keep-phone');
  await publish(env, s, { projection: projection({ e1: { status_token: tok('a') } }) });
  await publish(env, keep, { projection: projection({ e1: { status_token: tok('f') } }) }, OTHER_KENNEL);
  inboxItem(env, s, 'i1');
  event(env, s, 'pass');

  const dump = await exportAll(env.DB);
  for (const t of ['wl_projection', 'wl_tokens', 'wl_inbox', 'wl_events', 'wl_holds', 'wl_messages']) assert.ok(Array.isArray(dump.tables[t]), t);
  assert.equal(dump.tables.wl_projection.length, 2);

  assert.equal((await call(env, 'DELETE', '/account', { token: s.token, body: { confirm: 'DELETE' } })).status, 200);
  assert.equal(count(env, 'wl_inbox'), 0);
  assert.equal(count(env, 'wl_events'), 0);
  assert.deepEqual(env.DB.raw.prepare('SELECT public_id FROM wl_projection').all().map((r) => r.public_id), [OTHER_KENNEL]);
  assert.deepEqual(env.DB.raw.prepare('SELECT token FROM wl_tokens').all().map((r) => r.token), [tok('f')]);
});
