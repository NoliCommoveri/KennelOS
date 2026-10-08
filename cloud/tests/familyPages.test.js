// The waitlist's family pages (docs/KennelOS_Waitlist_W2_Plan.md §3, §5, §8):
// serving the static pages, the public list and a family's status page cut from
// her published projection, and "Email me my link".
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
  assert.deepEqual(Object.keys(v).sort(), ['as_of', 'family', 'kennel', 'litters', 'offers', 'public_list']);
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
  assert.deepEqual(placed, { kennel: { name: 'Thornfield Kennels', time_zone: 'America/Chicago' }, as_of: '2026-10-08',
    family: { name: 'Cy Day', status: 'placed' }, offers: [], litters: [], public_list: [] });
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

test('"Email me my link" sends the link only to an address on that list, and always answers the same', async () => {
  const { env } = await published();
  const ask = (email, publicId = KENNEL, ip) => call(env, 'POST', '/f/link', { body: { public_id: publicId, email }, ip });

  const unknown = await ask('stranger@example.com');
  assert.equal(unknown.status, 200);
  assert.deepEqual(await unknown.json(), { ok: true });
  assert.equal(count(env, 'wl_messages'), 0);

  assert.deepEqual(await (await ask('dee@example.com')).json(), { ok: true }, 'no link yet: same answer');
  assert.equal(count(env, 'wl_messages'), 0);

  assert.deepEqual(await (await ask('  ANN@example.com ')).json(), { ok: true });
  const msg = env.DB.raw.prepare('SELECT kind, to_email, subject, body, status, entry_id FROM wl_messages').get();
  assert.equal(msg.kind, 'status_link');
  assert.equal(msg.to_email, 'ann@example.com');
  assert.equal(msg.entry_id, 'ann');
  assert.match(msg.subject, /Thornfield Kennels/);
  assert.ok(msg.body.includes(`https://api.example/s/${tok('a')}`));
  assert.equal(msg.status, 'sent');

  assert.equal((await call(env, 'POST', '/f/link', { body: { public_id: KENNEL, email: 'nope' } })).status, 400);
  assert.equal((await call(env, 'POST', '/f/link', { body: { public_id: 'x', email: 'ann@example.com' } })).status, 400);
});

test('"Email me my link" is rate-limited per address and per caller, and honest when email is down', async () => {
  const { env } = await published();
  const ask = (email, ip) => call(env, 'POST', '/f/link', { body: { public_id: KENNEL, email }, ip });
  for (let i = 0; i < FAMILY_LIMITS.linkPerHourPerEmail; i++) assert.equal((await ask('bo@example.com', `198.51.100.${i}`)).status, 200);
  assert.equal((await ask('bo@example.com', '198.51.100.99')).status, 429, 'per address, whatever the IP');

  const noMail = await makeEnv({ ASSETS: assets, DEV_OUTBOX: '0' });
  const res = await call(noMail, 'POST', '/f/link', { body: { public_id: KENNEL, email: 'stranger@example.com' } });
  assert.equal(res.status, 503, 'said before any lookup, so it reveals nothing about the address');
});
