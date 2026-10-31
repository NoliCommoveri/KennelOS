// Notifications for the breeder (docs/KennelOS_Notifications_Plan.md): app alerts
// (payload-free web push) and the email digest, two separate opt-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn } from './helpers/env.js';

const notify = await import('../src/notify.js');
const { runRetention } = await import('../src/retention.js');
const { listedName, itemLine, pushText, digestDue, digestEmail, localParts, validEndpoint, generateVapidKeys, vapidConfig, runDigests, notifyEvent } = notify;

const KENNEL = 'kos1_11111111-2222-4333-8444-555555555555';
const tok = (c) => c.repeat(64);
const iso = () => new Date().toISOString();
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const AUTH = 'c2VjcmV0LWF1dGgtMTIz';
const count = (env, table, where = '1=1') => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get().n;

const projection = () => ({
  format: 1, as_of: iso().slice(0, 10),
  kennel: {
    public_id: KENNEL, name: 'Thornfield Kennels', time_zone: 'America/Chicago',
    message_key: { key_id: 'fk_1', public_key: 'PUB' }, parents: { sires: [], dams: [] }, breeds: [],
    pass_reasons: [{ id: 'timing', label: 'Timing', message: 'Thanks!' }],
  },
  public_list: [],
  entries: {
    ann: { name: 'Ann Lee', email: 'ann@example.com', status: 'active', status_token: tok('a'), position: 1,
      offers: [{ id: 'o1', litter_id: 'l1', respond_by_date: '2099-01-01', eligible_dog_ids: ['p1'], picked_dog_id: null }] },
  },
  litters: { l1: { label: 'Juniper × Ash', picks_open: true, pups: [{ id: 'p1', call_name: 'Pip' }] } },
  upcoming: [],
});

// Pushes go to a stand-in push service: every request is recorded, and the
// answer is `pushStatus` (201 unless a test changes it).
const pushes = [];
let pushStatus = 201;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://fcm.googleapis.com/')) {
    pushes.push({ url: String(url), headers: init.headers, body: init.body });
    return new Response(null, { status: pushStatus });
  }
  return realFetch(url, init);
};

async function setup({ pro = true, vapid = true } = {}) {
  pushes.length = 0;
  pushStatus = 201;
  const keys = await generateVapidKeys();
  const env = await makeEnv(vapid ? { VAPID_PRIVATE_JWK: keys.privateJwk } : {});
  const s = await signIn(env, 'breeder@example.com');
  if (pro) {
    const { email_hash: eh } = env.DB.raw.prepare('SELECT email_hash FROM users').get();
    env.DB.raw.prepare(`INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
      VALUES ('order:1', ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`).run(eh, iso(), iso());
    await call(env, 'POST', '/program/backing-device', { token: s.token });
    assert.equal((await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: projection() } })).status, 200);
  }
  const familySession = async (email) => {
    await call(env, 'POST', '/f/code', { body: { public_id: KENNEL, email }, ip: '192.0.2.9' });
    const code = /(\d{6})/.exec(env.DB.raw.prepare('SELECT subject FROM wl_messages ORDER BY rowid DESC LIMIT 1').get().subject)[1];
    return (await (await call(env, 'POST', '/f/verify', { body: { public_id: KENNEL, code }, ip: '192.0.2.9' })).json()).session;
  };
  return { env, s, keys, familySession };
}

const api = async (env, s, method, path, body) => {
  const res = await call(env, method, path, { token: s.token, body });
  return { status: res.status, body: await res.json() };
};
const subscribe = (env, s, endpoint = ENDPOINT) => api(env, s, 'POST', '/notify/push/subscribe', { endpoint, auth: AUTH });
const pending = async (env, body = { endpoint: ENDPOINT, auth: AUTH }) => {
  const res = await call(env, 'POST', '/notify/push/pending', { body });
  return { status: res.status, body: await res.json() };
};
const message = (env, session) => call(env, 'POST', '/f/message', { body: { session, status_token: tok('a'), key_id: 'fk_1', sealed: 'U0VBTEVE' } });

// --- Pure ------------------------------------------------------------------------------

test('lines name the kind and the family\'s listed name, never more', () => {
  assert.equal(listedName('Ann Lee'), 'Ann L.');
  assert.equal(listedName('  jane van der berg '), 'jane B.');
  assert.equal(listedName('Cher'), 'Cher');
  assert.equal(listedName(''), '');
  assert.equal(itemLine({ kind: 'message', what: 'message', name: 'Ann L.' }), 'New message from Ann L.');
  assert.equal(itemLine({ kind: 'turn', what: 'pick', name: 'Ann L.' }), 'Ann L. picked a pup');
  assert.equal(itemLine({ kind: 'turn', what: 'pick', name: 'Ann L.' }, { hideNames: true }), 'A family picked a pup');
  assert.equal(itemLine({ kind: 'message', what: 'message', name: null }), 'New message from a family');
  assert.equal(itemLine({ kind: 'request', what: 'leave', name: 'Bo K.', kennel: 'Thornfield' }, { withKennel: true }), 'Bo K. left the list (Thornfield)');
  assert.equal(itemLine({ kind: 'server_move', what: 'server_offer', name: 'Bo K.' }), 'Bo K. was offered a turn: contact them');
});

test('an alert for one family opens their page; several, or an application, open Today', () => {
  const one = pushText([{ kind: 'message', what: 'message', name: 'Ann L.', entry_id: 'ann' }]);
  assert.deepEqual(one, { title: 'KennelOS', body: 'New message from Ann L.', path: 'pages/waitlist-entry.html?id=ann', tag: 'kennelos-waitlist', count: 1 });
  assert.equal(pushText([{ kind: 'application', what: 'application', name: 'Cy D.', entry_id: 'x' }]).path, 'pages/today.html');
  const many = pushText([{ kind: 'message', what: 'message', name: 'Ann L.', entry_id: 'ann' }, { kind: 'turn', what: 'pass', name: 'Bo K.', entry_id: 'bo' }]);
  assert.equal(many.title, 'KennelOS: 2 new on your waitlist');
  assert.equal(many.body, 'New message from Ann L.\nBo K. passed on their turn');
  assert.equal(many.path, 'pages/today.html');
  assert.equal(pushText([]).body, 'Something new on your waitlist.', 'a push always shows something');
});

test('only real push services are ever POSTed to', () => {
  assert.ok(validEndpoint('https://fcm.googleapis.com/fcm/send/x'));
  assert.ok(validEndpoint('https://web.push.apple.com/QAbc'));
  assert.ok(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(!validEndpoint('http://fcm.googleapis.com/x'));
  assert.ok(!validEndpoint('https://evil.example/fcm.googleapis.com'));
  assert.ok(!validEndpoint('https://push.apple.com.evil.example/x'));
  assert.ok(!validEndpoint(null));
});

test('the digest is due once a local day from 8 am (weekly: Mondays), in her time zone', () => {
  const tz = 'America/Chicago';
  const at = (s) => new Date(s);
  // 2026-11-02 is a Monday. 13:30 UTC = 7:30 am in Chicago (CST); 14:30 UTC = 8:30 am.
  assert.deepEqual(localParts(at('2026-11-02T14:30:00Z'), tz), { date: '2026-11-02', hour: 8, weekday: 1 });
  assert.equal(digestDue({ digest_tz: tz, digest_frequency: 'daily', digest_last_sent_at: null }, at('2026-11-02T13:30:00Z')), false, 'before 8 am');
  assert.equal(digestDue({ digest_tz: tz, digest_frequency: 'daily', digest_last_sent_at: null }, at('2026-11-02T14:30:00Z')), true);
  assert.equal(digestDue({ digest_tz: tz, digest_frequency: 'daily', digest_last_sent_at: '2026-11-02T14:31:00Z' }, at('2026-11-02T20:00:00Z')), false, 'once a day');
  assert.equal(digestDue({ digest_tz: tz, digest_frequency: 'daily', digest_last_sent_at: '2026-11-02T14:31:00Z' }, at('2026-11-03T15:00:00Z')), true);
  assert.equal(digestDue({ digest_tz: tz, digest_frequency: 'weekly', digest_last_sent_at: null }, at('2026-11-03T15:00:00Z')), false, 'not Tuesday');
  assert.equal(digestDue({ digest_tz: tz, digest_frequency: 'weekly', digest_last_sent_at: '2026-10-26T15:00:00Z' }, at('2026-11-02T15:00:00Z')), true);
  assert.equal(digestDue({ digest_tz: 'Not/AZone', digest_frequency: 'daily', digest_last_sent_at: null }, at('2026-11-02T08:30:00Z')), true, 'a bad zone falls back to UTC');
});

test('the digest email counts what happened, lists each line, and carries the turn-off link', () => {
  const items = [
    { kind: 'message', what: 'message', name: 'Ann L.', at: '2026-11-02T15:00:00Z' },
    { kind: 'message', what: 'message', name: 'Bo K.', at: '2026-11-02T16:00:00Z' },
    { kind: 'application', what: 'application', name: 'Cy D.', at: '2026-11-02T17:00:00Z' },
    { kind: 'turn', what: 'pass', name: 'Bo K.', at: '2026-11-02T18:00:00Z' },
  ];
  const m = digestEmail(items, { tz: 'America/Chicago', appUrl: 'https://pro.example/', offUrl: 'https://api.example/notify/off?p=1&s=2' });
  assert.equal(m.subject, 'KennelOS: 2 messages, 1 application, 1 other update');
  assert.match(m.text, /- Nov 2, 9:00 AM  New message from Ann L\./);
  assert.match(m.text, /Bo K\. passed on their turn/);
  assert.match(m.text, /https:\/\/pro\.example\//);
  assert.match(m.text, /Turn it off: https:\/\/api\.example\/notify\/off\?p=1&s=2/);
});

test('the VAPID header is an ES256 JWT for the push service, verifiable with the public key', async () => {
  const { env, s, keys } = await setup();
  assert.equal((await subscribe(env, s)).status, 200);
  assert.equal((await api(env, s, 'POST', '/notify/push/test')).body.ok, true);
  const h = pushes[0].headers;
  assert.equal(pushes[0].body, undefined, 'payload-free');
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h.authorization);
  assert.equal(k, keys.publicKey);
  const [head, claims, sig] = jwt.split('.');
  const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString());
  assert.deepEqual(dec(head), { typ: 'JWT', alg: 'ES256' });
  assert.equal(dec(claims).aud, 'https://fcm.googleapis.com');
  assert.ok(dec(claims).exp > Date.now() / 1000);
  const pub = await crypto.subtle.importKey('raw', Buffer.from(k, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${head}.${claims}`)));
  assert.deepEqual(vapidConfig({}).ready, false);
});

// --- Alerts ------------------------------------------------------------------------------

test('alerts: Pro only, real push services only, and "not available" until the key is set', async () => {
  const noPro = await setup({ pro: false });
  assert.equal((await subscribe(noPro.env, noPro.s)).status, 403);
  const noKey = await setup({ vapid: false });
  const got = await api(noKey.env, noKey.s, 'GET', '/notify');
  assert.equal(got.body.push.available, false);
  assert.equal((await subscribe(noKey.env, noKey.s)).status, 503);
  const { env, s } = await setup();
  assert.equal((await subscribe(env, s, 'https://evil.example/push')).status, 400);
  assert.equal((await api(env, s, 'POST', '/notify/push/subscribe', { endpoint: ENDPOINT, auth: '' })).status, 400);
  const on = await subscribe(env, s);
  assert.equal(on.status, 200);
  assert.equal(on.body.push.thisDevice, true);
  assert.deepEqual(on.body.push.kinds, ['message', 'application', 'turn', 'request', 'server_move']);
  assert.equal(count(env, 'push_subscriptions'), 1);
  await subscribe(env, s, 'https://fcm.googleapis.com/fcm/send/new');
  assert.equal(count(env, 'push_subscriptions'), 1, 'one subscription per device');
  assert.equal((await api(env, s, 'POST', '/notify/push/unsubscribe')).body.push.thisDevice, false);
});

test('a family\'s message wakes her device; the worker learns what to say with its own secret', async () => {
  const { env, s, familySession } = await setup();
  await subscribe(env, s);
  const ann = await familySession('ann@example.com');
  assert.equal((await message(env, ann)).status, 200);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].url, ENDPOINT);

  assert.equal((await pending(env, { endpoint: ENDPOINT, auth: 'wrong-secret-12345' })).status, 401);
  const first = await pending(env);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { title: 'KennelOS', body: 'New message from Ann L.', path: 'pages/waitlist-entry.html?id=ann', tag: 'kennelos-waitlist', count: 1 });
  assert.equal((await pending(env)).body.count, 0, 'shown once');

  // Her own actions as the family: a pass is a turn alert; still_interested isn't one.
  await call(env, 'POST', '/f/act', { body: { session: ann, status_token: tok('a'), action: 'still_interested' } });
  assert.equal(pushes.length, 1);
  await call(env, 'POST', '/f/act', { body: { session: ann, status_token: tok('a'), action: 'pass', offer_id: 'o1', reason_id: 'timing' } });
  assert.equal(pushes.length, 2);
  assert.equal((await pending(env)).body.body, 'Ann L. passed on their turn');
});

test('her choices: kinds she unticks aren\'t sent, and names can stay off the lock screen', async () => {
  const { env, s, familySession } = await setup();
  await subscribe(env, s);
  const ann = await familySession('ann@example.com');
  await api(env, s, 'PUT', '/notify', { push_kinds: ['application'], hide_names: true });
  await message(env, ann);
  assert.equal(pushes.length, 0, 'messages unticked');
  assert.equal(count(env, 'notify_items'), 0, 'nothing kept when nothing wants it');
  await api(env, s, 'PUT', '/notify', { push_kinds: ['message'] });
  await message(env, ann);
  assert.equal((await pending(env)).body.body, 'New message from a family');
});

test('a device that signs out stops getting alerts; a gone subscription is pruned', async () => {
  const { env, s, familySession } = await setup();
  await subscribe(env, s);
  const ann = await familySession('ann@example.com');
  pushStatus = 410;
  await message(env, ann);
  assert.equal(count(env, 'push_subscriptions'), 0, '410: pruned');
  pushStatus = 201;
  await subscribe(env, s);
  await call(env, 'POST', '/auth/signout', { token: s.token, body: {} });
  await message(env, ann);
  assert.equal(pushes.filter((p) => p.url === ENDPOINT).length, 1, 'only the 410 one: none after sign-out');
  assert.equal((await pending(env)).status, 401);
  assert.equal(count(env, 'push_subscriptions'), 0);
});

test('a confirmed application is an alert', async () => {
  const { env, s } = await setup();
  await subscribe(env, s);
  await notifyEvent(env, { programId: env.DB.raw.prepare('SELECT id FROM programs').get().id, kind: 'application', what: 'application', name: 'Cy Day', kennel: 'Thornfield Kennels', entryId: 'cy' });
  assert.equal(pushes.length, 1);
  assert.equal((await pending(env)).body.body, 'New application from Cy D.');
});

// --- The digest ----------------------------------------------------------------------------

test('the digest: her sign-in address is on at once; another needs its code', async () => {
  const { env, s } = await setup();
  const own = await api(env, s, 'POST', '/notify/digest', { email: 'Breeder@Example.com', frequency: 'weekly', tz: 'America/Chicago' });
  assert.equal(own.status, 200);
  assert.equal(own.body.pending, false);
  assert.equal(own.body.digest.email, 'breeder@example.com');
  assert.equal(own.body.digest.frequency, 'weekly');

  const other = await api(env, s, 'POST', '/notify/digest', { email: 'kennel.office@example.com' });
  assert.equal(other.body.pending, true);
  assert.equal(other.body.digest.email, 'breeder@example.com', 'unchanged until the code');
  assert.equal(other.body.digest.pendingEmail, 'kennel.office@example.com');
  const code = env.DB.raw.prepare('SELECT code FROM dev_outbox ORDER BY id DESC LIMIT 1').get().code;
  assert.equal((await api(env, s, 'POST', '/notify/digest/verify', { code: '000000' === code ? '111111' : '000000' })).status, 400);
  const ok = await api(env, s, 'POST', '/notify/digest/verify', { code });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.digest.email, 'kennel.office@example.com');
  assert.equal(ok.body.digest.pendingEmail, null);

  const off = await api(env, s, 'DELETE', '/notify/digest');
  assert.equal(off.body.digest.email, null);
  assert.equal(env.DB.raw.prepare('SELECT digest_email, pending_email FROM notify_settings').get().digest_email, null, 'the address is deleted');
});

test('the digest sends once when due and only when something happened; the turn-off link needs a press', async () => {
  const { env, s, familySession } = await setup();
  await api(env, s, 'POST', '/notify/digest', { email: 'breeder@example.com', tz: 'UTC' });
  env.DB.raw.prepare('UPDATE notify_settings SET digest_last_sent_at = ?').run('2026-01-01T09:00:00Z');
  const outbox = () => count(env, 'dev_outbox', "code = 'digest'");
  const morning = new Date(Date.now() + 86400000);
  morning.setUTCHours(9, 0, 0, 0);
  assert.deepEqual(await runDigests(env, { now: morning, origin: 'https://api.example' }), { due: 0, sent: 0, failed: 0 }, 'nothing happened: no email');

  const ann = await familySession('ann@example.com');
  await message(env, ann);
  assert.equal(count(env, 'notify_items'), 1, 'kept for the digest though no device has alerts on');
  const early = new Date(morning); early.setUTCHours(6);
  assert.equal((await runDigests(env, { now: early })).sent, 0, 'before 8 am');
  assert.equal((await runDigests(env, { now: morning, origin: 'https://api.example' })).sent, 1);
  assert.equal(outbox(), 1);
  assert.equal((await runDigests(env, { now: new Date(morning.getTime() + 3600000) })).sent, 0, 'once a day');
  assert.ok(env.DB.raw.prepare('SELECT digested_at FROM notify_items').get().digested_at);

  const programId = env.DB.raw.prepare('SELECT id FROM programs').get().id;
  const link = new URL(await notify.offLink(env, 'https://api.example', programId));
  const page = await call(env, 'GET', `${link.pathname}${link.search}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Turn off the email digest\?/);
  assert.ok(env.DB.raw.prepare('SELECT digest_email FROM notify_settings').get().digest_email, 'opening the link alone changes nothing');
  const bad = await call(env, 'GET', `/notify/off?p=${programId}&s=${'0'.repeat(64)}`);
  assert.equal(bad.status, 400);
  const form = new URLSearchParams({ p: programId, s: link.searchParams.get('s') });
  const press = await call(env, 'POST', '/notify/off', { body: new TextEncoder().encode(form.toString()), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(press.status, 200);
  assert.equal(env.DB.raw.prepare('SELECT digest_email FROM notify_settings').get().digest_email, null);
});

test('retention keeps a week of items; deleting the account deletes everything', async () => {
  const { env, s, familySession } = await setup();
  await subscribe(env, s);
  await api(env, s, 'POST', '/notify/digest', { email: 'breeder@example.com' });
  const ann = await familySession('ann@example.com');
  await message(env, ann);
  env.DB.raw.prepare('UPDATE notify_items SET at = ?').run(new Date(Date.now() - 9 * 86400000).toISOString());
  await runRetention(env);
  assert.equal(count(env, 'notify_items'), 0);
  assert.equal(count(env, 'push_subscriptions'), 1, 'a live device keeps its alerts');

  await call(env, 'POST', '/auth/start', { body: { email: 'breeder@example.com' } });
  const code = env.DB.raw.prepare('SELECT code FROM dev_outbox ORDER BY id DESC LIMIT 1').get().code;
  const del = await call(env, 'DELETE', '/account', { token: s.token, body: { confirm: 'DELETE', email: 'breeder@example.com', code } });
  assert.equal(del.status, 200);
  for (const t of ['notify_settings', 'push_subscriptions', 'notify_items']) assert.equal(count(env, t), 0, t);
});
