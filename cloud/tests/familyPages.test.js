// The waitlist's family pages (docs/KennelOS_Waitlist_W2_Plan.md §3, §5, §8):
// serving the static pages, the public list and a family's status page cut from
// her published projection, and See Your Details (sign in with an emailed code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn } from './helpers/env.js';

const { statusView, listView, FAMILY_LIMITS } = await import('../src/familyPages.js');

const KENNEL = 'kos1_11111111-2222-4333-8444-555555555555';
const tok = (c) => c.repeat(64);
const iso = () => new Date().toISOString();
const count = (env, table) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

// Stands in for the ASSETS binding: echoes the file asked for.
const assets = {
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (!path.startsWith('/family/')) return new Response('not found', { status: 404 });
    return new Response(`file:${path}`, { headers: { 'content-type': path.endsWith('.html') ? 'text/html' : 'text/plain' } });
  },
};

async function breeder(env) {
  const s = await signIn(env, 'breeder@example.com');
  const { email_hash: eh } = env.DB.raw.prepare('SELECT email_hash FROM users').get();
  env.DB.raw.prepare(`INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
    VALUES ('order:1', ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`).run(eh, iso(), iso());
  await call(env, 'POST', '/program/backing-device', { token: s.token });
  return s;
}

const projection = () => ({
  format: 1,
  as_of: '2026-10-08',
  kennel: { public_id: KENNEL, name: 'Thornfield Kennels', time_zone: 'America/Chicago', respond_days: 3, max_passes: 2, auto_offer_on: [] },
  public_list: [{ position: 1, name: 'Ann L.', pref_sex: 'female', added: '2026-02-01' }, { position: 3, name: 'Bo K.', pref_sex: 'any', added: '2026-02-03' }],
  entries: {
    ann: {
      name: 'Ann Lee', email: 'Ann@Example.com', status: 'active', status_token: tok('a'),
      applied_date: '2026-01-01', approved_date: '2026-01-05', position: 1,
      prefs: { sex: 'female', breed: null, placement: null, colors: [], ready_timing: 'asap' },
      paused_until: null, ready_from: null, listen: { mode: 'all', sire_ids: [], dam_ids: [] },
      passes: { used: 0, max: 2 }, fee_received_date: '2026-02-01', fee_due: null,
      litter_positions: { l1: 1 },
      offers: [{ id: 'o1', litter_id: 'l1', offered_date: '2026-10-07', respond_by_date: '2026-10-10', eligible_dog_ids: ['p2'], picked_dog_id: null }],
    },
    bo: { name: 'Bo Kim', email: 'bo@example.com', status: 'active', status_token: tok('b'), position: 3, litter_positions: { l1: 2 }, offers: [] },
    cy: { name: 'Cy Day', email: 'cy@example.com', status: 'placed', status_token: tok('c') },
    dee: { name: 'Dee Fox', email: 'dee@example.com', status: 'approved', position: null, offers: [],
      fee_due: { amount: 300, due_date: '2026-10-20', instructions: 'Venmo @thornfield', credit_policy: 'credited_to_purchase' } },
  },
  litters: {
    l1: {
      label: 'Juniper × Ash', status: 'whelped', whelp_date: '2026-09-01', ready_date: '2026-10-27', picks_open: true,
      pups: [{ id: 'p1', call_name: 'Pip', sex: 'male', color: 'black' }, { id: 'p2', call_name: 'Poppy', sex: 'female', color: 'black' }],
      open_offer_entry_id: 'ann',
      queue: [{ entry_id: 'ann', dog_ids: ['p2'] }, { entry_id: 'bo', dog_ids: ['p1', 'p2'] }],
    },
  },
});

async function published(extra = {}) {
  const env = await makeEnv({ ASSETS: assets, ...extra });
  const s = await breeder(env);
  const res = await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: projection() } });
  assert.equal(res.status, 200);
  return { env, s };
}

const get = (env, path, opts) => call(env, 'GET', path, opts);

test('the pages and their files are served by the Worker, with headers that keep the link private', async () => {
  const { env } = await published();
  const page = await get(env, `/s/${tok('a')}`);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), 'file:/family/status.html');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.match(page.headers.get('x-robots-tag'), /noindex/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(await (await get(env, `/list/${KENNEL}`)).text(), 'file:/family/list.html');
  assert.equal(await (await get(env, '/family/status.js')).text(), 'file:/family/status.js');
  // Anything else is not a page: the API answers it.
  for (const path of ['/family/../wrangler.toml', '/family/x.html', '/s/a/b', '/list']) {
    const res = await get(env, path);
    assert.equal(res.headers.get('content-type')?.includes('application/json'), true, path);
  }
  const noAssets = await makeEnv();
  assert.notEqual((await get(noAssets, `/s/${tok('a')}`)).status, 200, 'no binding: not served');
});

test('the public list shows only her published rows', async () => {
  const { env } = await published();
  const res = await get(env, `/f/list/${KENNEL}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { kennel: { name: 'Thornfield Kennels' }, as_of: '2026-10-08', rows: projection().public_list });
  assert.equal((await get(env, '/f/list/kos1_99999999-2222-4333-8444-555555555555')).status, 404);
  assert.equal((await get(env, '/f/list/thornfield')).status, 404);
});

test("a family's status page shows their own place and offers, never anyone else's", async () => {
  const { env } = await published();
  const res = await get(env, `/f/status/${tok('a')}`);
  assert.equal(res.status, 200);
  const v = await res.json();
  assert.deepEqual(Object.keys(v).sort(), ['as_of', 'family', 'kennel', 'litters', 'offers', 'pending', 'public_list']);
  assert.equal(v.kennel.public_id, KENNEL, 'so the page can find this browser\'s sign-in');
  assert.deepEqual(v.pending, []);
  assert.equal(v.family.name, 'Ann Lee');
  assert.equal(v.family.position, 1);
  assert.equal('email' in v.family, false, 'their email is not on the page');
  assert.deepEqual(v.offers, [{ id: 'o1', litter: 'Juniper × Ash', offered_date: '2026-10-07', respond_by_date: '2026-10-10', picked_dog_id: null,
    pups: [{ id: 'p2', call_name: 'Poppy', sex: 'female', color: 'black' }] }]);
  assert.deepEqual(v.litters, [{ id: 'l1', label: 'Juniper × Ash', status: 'whelped', whelp_date: '2026-09-01', ready_date: '2026-10-27',
    picks_open: true, pups_available: 2, your_position: 1 }]);
  const text = JSON.stringify(v);
  for (const other of ['Bo Kim', 'bo@example.com', '"bo"', 'Cy Day', 'Dee Fox', 'Venmo', tok('b'), 'queue', 'open_offer_entry_id']) {
    assert.equal(text.includes(other), false, other);
  }
  assert.ok(env.DB.raw.prepare('SELECT last_used_at FROM wl_tokens WHERE token = ?').get(tok('a')).last_used_at);
});

test('a placed family sees only that; an unknown, malformed or replaced link finds nothing', async () => {
  const { env, s } = await published();
  const placed = await (await get(env, `/f/status/${tok('c')}`)).json();
  assert.deepEqual(placed, { kennel: { name: 'Thornfield Kennels', time_zone: 'America/Chicago', public_id: KENNEL, can_message: false }, as_of: '2026-10-08',
    family: { name: 'Cy Day', status: 'placed' }, offers: [], litters: [], public_list: [], pending: [] });
  assert.equal((await get(env, `/f/status/${tok('d')}`)).status, 404);
  assert.equal((await get(env, '/f/status/nope')).status, 404);

  // New link for Ann: the old one stops working at the next publish.
  const next = projection();
  next.entries.ann.status_token = tok('e');
  await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: next } });
  assert.equal((await get(env, `/f/status/${tok('a')}`)).status, 404);
  assert.equal((await get(env, `/f/status/${tok('e')}`)).status, 200);
});

test('statusView and listView are allow-lists over the projection', () => {
  assert.equal(statusView(projection(), 'nobody'), null);
  const dee = statusView(projection(), 'dee');
  assert.deepEqual(dee.family.fee_due, { amount: 300, due_date: '2026-10-20', instructions: 'Venmo @thornfield', credit_policy: 'credited_to_purchase' },
    'an approved, unpaid family sees what to pay and how');
  const p = projection();
  p.entries.ann.secret = 'x';
  p.kennel.private = 'y';
  assert.equal(JSON.stringify(statusView(p, 'ann')).includes('"x"'), false, 'an unknown field is never passed through');
  assert.deepEqual(Object.keys(listView(p)).sort(), ['as_of', 'kennel', 'rows']);
});

// The code in the newest verification email (staging's outbox records it).
const lastCodeSent = (env) => /is (\d{6})\n/.exec(env.DB.raw.prepare("SELECT body FROM wl_messages WHERE kind = 'verification_code' ORDER BY created_at DESC, rowid DESC LIMIT 1").get()?.body || '')?.[1];

test('See Your Details: a code goes only to an address on that list, and the answer is always the same', async () => {
  const { env } = await published();
  const ask = (email, publicId = KENNEL) => call(env, 'POST', '/f/code', { body: { public_id: publicId, email } });

  const unknown = await ask('stranger@example.com');
  assert.equal(unknown.status, 200);
  assert.deepEqual(await unknown.json(), { ok: true });
  assert.equal(count(env, 'wl_messages'), 0);
  assert.deepEqual(await (await ask('dee@example.com')).json(), { ok: true }, 'on the list but no link yet: same answer, nothing sent');
  assert.equal(count(env, 'wl_messages'), 0);

  assert.deepEqual(await (await ask('  ANN@example.com ')).json(), { ok: true });
  const msg = env.DB.raw.prepare('SELECT kind, to_email, subject, body, entry_id FROM wl_messages').get();
  assert.equal(msg.kind, 'verification_code');
  assert.equal(msg.to_email, 'ann@example.com');
  assert.equal(msg.entry_id, 'ann');
  assert.match(msg.subject, /Thornfield Kennels waitlist code: \d{6}/);
  assert.equal(msg.body.includes(tok('a')), false, 'the email carries a code, not the link');
  assert.equal(count(env, 'wl_family_codes'), 1);

  assert.equal((await ask('nope')).status, 400);
  assert.equal((await ask('ann@example.com', 'x')).status, 400);
});

test('See Your Details: the code opens their page once, and remembers this browser', async () => {
  const { env } = await published();
  await call(env, 'POST', '/f/code', { body: { public_id: KENNEL, email: 'ann@example.com' } });
  const code = lastCodeSent(env);
  const verify = (c, ip) => call(env, 'POST', '/f/verify', { body: { public_id: KENNEL, code: c }, ip });

  const ok = await verify(code.replace(/(\d{3})/, '$1 '));
  assert.equal(ok.status, 200, 'a space typed in the middle is fine');
  const body = await ok.json();
  assert.equal(body.status_token, tok('a'));
  assert.match(body.session, /^[0-9a-f]{64}$/);
  assert.ok(Date.parse(body.expires_at) > Date.now() + 89 * 24 * 3600 * 1000);
  assert.equal(env.DB.raw.prepare('SELECT token_hash FROM wl_family_sessions').get().token_hash === body.session, false, 'stored hashed');

  const again = await verify(code, '198.51.100.7');
  assert.equal(again.status, 400, 'a code works once');
  assert.equal((await again.json()).error, 'invalid_code');

  const remembered = await call(env, 'POST', '/f/session', { body: { session: body.session } });
  assert.deepEqual(await remembered.json(), { public_id: KENNEL, status_token: tok('a') });
  assert.equal((await call(env, 'POST', '/f/session', { body: { session: 'f'.repeat(64) } })).status, 401);
  assert.equal((await call(env, 'POST', '/f/session', { body: {} })).status, 401);
});

test('See Your Details: a new code replaces the old one; codes expire; wrong codes are rate-limited', async () => {
  const { env } = await published();
  const send = () => call(env, 'POST', '/f/code', { body: { public_id: KENNEL, email: 'ann@example.com' } });
  await send();
  const first = lastCodeSent(env);
  await send();
  const second = lastCodeSent(env);
  assert.equal(count(env, 'wl_family_codes'), 1, 'one live code per family');
  const verify = (c, ip = '203.0.113.9') => call(env, 'POST', '/f/verify', { body: { public_id: KENNEL, code: c }, ip });
  if (first !== second) assert.equal((await verify(first)).status, 400, 'the older code stops working');

  env.DB.raw.prepare('UPDATE wl_family_codes SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await verify(second)).status, 400, 'an expired code fails');

  assert.equal((await verify('12345')).status, 400);
  for (let i = 0; i < FAMILY_LIMITS.verifyPerHourPerIp; i++) assert.equal((await verify('000000', '203.0.113.50')).status, 400);
  assert.equal((await verify('000000', '203.0.113.50')).status, 429, 'guessing is cut off per connection');
});

test('See Your Details: sending codes is rate-limited per address, honest when email is down, and taking the list offline signs families out', async () => {
  const { env, s } = await published();
  const ask = (email, ip) => call(env, 'POST', '/f/code', { body: { public_id: KENNEL, email }, ip });
  for (let i = 0; i < FAMILY_LIMITS.codesPerHourPerEmail; i++) assert.equal((await ask('bo@example.com', `198.51.100.${i}`)).status, 200);
  assert.equal((await ask('bo@example.com', '198.51.100.99')).status, 429, 'per address, whatever the IP');

  const noMail = await makeEnv({ ASSETS: assets, DEV_OUTBOX: '0' });
  assert.equal((await call(noMail, 'POST', '/f/code', { body: { public_id: KENNEL, email: 'stranger@example.com' } })).status, 503,
    'said before any lookup, so it reveals nothing about the address');

  await call(env, 'POST', '/f/code', { body: { public_id: KENNEL, email: 'ann@example.com' }, ip: '192.0.2.1' });
  const { session } = await (await call(env, 'POST', '/f/verify', { body: { public_id: KENNEL, code: lastCodeSent(env) }, ip: '192.0.2.1' })).json();
  assert.equal((await call(env, 'DELETE', `/waitlist/projection/${KENNEL}`, { token: s.token })).status, 200);
  assert.equal(count(env, 'wl_family_sessions'), 0);
  assert.equal((await call(env, 'POST', '/f/session', { body: { session } })).status, 401);
});

test('See Your Details: a family can be signed in on several devices at once (one code per sign-in)', async () => {
  const { env } = await published();
  const signInDevice = async (ip) => {
    await call(env, 'POST', '/f/code', { body: { public_id: KENNEL, email: 'ann@example.com' }, ip });
    return (await (await call(env, 'POST', '/f/verify', { body: { public_id: KENNEL, code: lastCodeSent(env) }, ip })).json()).session;
  };
  const herPhone = await signInDevice('192.0.2.10');
  const hisPhone = await signInDevice('192.0.2.11');
  await call(env, 'POST', '/f/code', { body: { public_id: KENNEL, email: 'ann@example.com' }, ip: '192.0.2.12' });
  for (const session of [herPhone, hisPhone]) {
    const res = await call(env, 'POST', '/f/session', { body: { session } });
    assert.equal(res.status, 200, 'still signed in after another device signs in and after a new code is sent');
    assert.equal((await res.json()).status_token, tok('a'));
  }
  assert.equal(count(env, 'wl_family_sessions'), 2);
});
