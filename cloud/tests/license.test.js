// The server-side Pro license link (docs/KennelOS_License_Link_Plan.md): the
// Lemon Squeezy webhook, the entitlement it gives an account, linking another
// purchase email by code, and the bookkeeping around them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { makeEnv, call, signIn, lastCode } from './helpers/env.js';
import { worker } from './helpers/worker.js';

const { runRetention } = await import('../src/retention.js');
const { exportAll } = await import('../src/backup.js');
const { requirePro, entitlementFor, subscriptionAccessUntil, LINK_LIMIT_PER_HOUR } = await import('../src/license.js');
const { healthCheck } = await import('../src/health.js');

const SECRET = 'whsec-test';
const LS = {
  LEMONSQUEEZY_WEBHOOK_SECRET: SECRET,
  LS_STORE_ID: '100',
  LS_PRO_PRODUCT_IDS: '200, 201',
  LS_YEARLY_VARIANT_IDS: '302',
  LS_LIFETIME_VARIANT_IDS: '303',
  LS_TEST_MODE: 'true',
};
const MONTHLY = 301;
const YEARLY = 302;
const LIFETIME = 303;
const BUYER = 'Breeder@Example.com';
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const env0 = () => makeEnv(LS);
const count = (env, table) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

function subscription(id, attrs = {}, event = 'subscription_updated') {
  return {
    meta: { event_name: event },
    data: {
      type: 'subscriptions', id: String(id),
      attributes: {
        store_id: 100, product_id: 200, variant_id: MONTHLY, status: 'active', user_email: BUYER,
        user_name: 'Pat Breeder', renews_at: iso(Date.now() + 20 * DAY), ends_at: null,
        test_mode: true, updated_at: iso(Date.now()), ...attrs,
      },
    },
  };
}

function order(id, attrs = {}, event = 'order_created') {
  return {
    meta: { event_name: event },
    data: {
      type: 'orders', id: String(id),
      attributes: {
        store_id: 100, status: 'paid', refunded: false, user_email: BUYER, test_mode: true,
        first_order_item: { product_id: 200, variant_id: LIFETIME, variant_name: 'Lifetime' },
        updated_at: iso(Date.now()), ...attrs,
      },
    },
  };
}

async function hook(env, payload, { signature, secret = SECRET, raw } = {}) {
  const body = raw ?? JSON.stringify(payload);
  const sig = signature !== undefined ? signature : createHmac('sha256', secret).update(body).digest('hex');
  const headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) };
  if (sig !== null) headers['x-signature'] = sig;
  return worker.fetch(new Request('https://api.example/webhooks/lemonsqueezy', { method: 'POST', headers, body }), env);
}

const entitlement = async (env, s) => (await call(env, 'GET', '/account/entitlement', { token: s.token })).json();

// --- the webhook ---------------------------------------------------------------

test('a signed webhook records the purchase by email hash, never the address or the name', async () => {
  const env = await env0();
  const res = await hook(env, subscription(1));
  assert.equal(res.status, 200);
  const rows = env.DB.raw.prepare('SELECT * FROM pro_purchases').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'sub:1');
  assert.equal(rows[0].plan, 'monthly');
  assert.equal(rows[0].access_until, null);
  assert.match(rows[0].email_hash, /^[0-9a-f]{64}$/);
  const dump = JSON.stringify(env.DB.raw.prepare('SELECT * FROM pro_purchases').all());
  for (const leaked of ['example.com', 'Pat Breeder', 'Breeder@']) assert.ok(!dump.includes(leaked), leaked);
});

test('the signature is checked over the raw bytes: missing, wrong secret or altered body → 401, nothing stored', async () => {
  const env = await env0();
  assert.equal((await hook(env, subscription(1), { signature: null })).status, 401);
  assert.equal((await hook(env, subscription(1), { secret: 'other' })).status, 401);
  const body = JSON.stringify(subscription(1));
  const sig = createHmac('sha256', SECRET).update(body).digest('hex');
  assert.equal((await hook(env, null, { raw: body.replace('"active"', '"active" '), signature: sig })).status, 401);
  assert.equal((await hook(env, null, { raw: body, signature: sig.toUpperCase() })).status, 200, 'hex case does not matter');
  assert.equal(count(env, 'pro_purchases'), 1);
});

test('unconfigured: the webhook answers 503 (LS retries) and /ops health says what is missing', async () => {
  const env = await makeEnv({ ...LS, LS_STORE_ID: '' });
  assert.equal((await hook(env, subscription(1))).status, 503);
  const health = await healthCheck(env);
  assert.equal(health.license.ready, false);
  assert.equal(health.license.storeSet, false);
  assert.equal(health.secrets.LEMONSQUEEZY_WEBHOOK_SECRET, true);
  const noSecret = await makeEnv({ ...LS, LEMONSQUEEZY_WEBHOOK_SECRET: undefined });
  assert.equal((await hook(noSecret, subscription(1))).status, 503);
});

test('not ours is ignored with 200: another store, product or mode, a non-lifetime order, a license-key event', async () => {
  const env = await env0();
  for (const p of [
    subscription(1, { store_id: 999 }),
    subscription(2, { product_id: 999 }),
    subscription(3, { test_mode: false }),
    order(4, { first_order_item: { product_id: 200, variant_id: MONTHLY } }),
    { meta: { event_name: 'license_key_created' }, data: { type: 'license-keys', id: '5', attributes: { store_id: 100, key: 'SECRET-KEY', user_email: BUYER, test_mode: true } } },
    { meta: { event_name: 'subscription_updated' }, data: { type: 'subscriptions', id: '6' } },
  ]) assert.equal((await hook(env, p)).status, 200);
  assert.equal(count(env, 'pro_purchases'), 0);
  assert.ok(!JSON.stringify(env.DB.raw.prepare('SELECT * FROM rate_limits').all()).includes('SECRET-KEY'));
});

test('an older event never overwrites a newer one; the same event twice is a no-op', async () => {
  const env = await env0();
  const t1 = iso(Date.now() - 1000);
  const t2 = iso(Date.now());
  await hook(env, subscription(1, { status: 'expired', updated_at: t2 }));
  await hook(env, subscription(1, { status: 'active', updated_at: t1 })); // a late retry
  let row = env.DB.raw.prepare('SELECT status, source_updated_at FROM pro_purchases').get();
  assert.equal(row.status, 'expired');
  await hook(env, subscription(1, { status: 'expired', updated_at: t2 }));
  assert.equal(count(env, 'pro_purchases'), 1);
  await hook(env, subscription(1, { status: 'active', updated_at: iso(Date.now() + 1000) }), {});
  row = env.DB.raw.prepare('SELECT status FROM pro_purchases').get();
  assert.equal(row.status, 'active', 'resumed');
});

test('how long each subscription state gives Pro', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const renewsAt = iso(now - DAY);
  const endsAt = iso(now + 10 * DAY);
  const updatedAt = iso(now);
  const until = (status, plan = 'monthly') => subscriptionAccessUntil({ status, plan, renewsAt, endsAt, updatedAt });
  assert.equal(until('active'), null);
  assert.equal(until('on_trial'), null);
  assert.equal(until('past_due', 'monthly'), iso(now - DAY + 3 * DAY));
  assert.equal(until('past_due', 'yearly'), iso(now - DAY + 7 * DAY));
  assert.equal(until('unpaid', 'yearly'), iso(now - DAY + 7 * DAY));
  assert.equal(until('cancelled'), endsAt);
  assert.equal(until('paused'), updatedAt);
  assert.equal(until('expired'), updatedAt);
  assert.equal(until('something_new'), updatedAt);
  assert.equal(subscriptionAccessUntil({ status: 'expired', plan: 'monthly', updatedAt: iso(now + 5000), now: updatedAt }), updatedAt,
    'LS\'s clock a little ahead: it still ends now');
});

// --- entitlement ---------------------------------------------------------------------

test('purchase before the account, or account before the purchase: either way the same email is Pro', async () => {
  const env = await env0();
  await hook(env, subscription(1, { variant_id: YEARLY }));
  const s = await signIn(env, 'breeder@example.com');
  assert.deepEqual(await entitlement(env, s), { pro: true, plan: 'yearly', until: null, source: 'email', lapsed: false, linkedEmails: 0 });

  const other = await signIn(env, 'second@example.com');
  assert.equal((await entitlement(env, other)).pro, false);
  await hook(env, subscription(2, { user_email: 'second@example.com' }));
  assert.equal((await entitlement(env, other)).pro, true);
});

test('lapsed, cancelled-but-paid, grace, lifetime and refunds', async () => {
  const env = await env0();
  const s = await signIn(env, 'breeder@example.com');
  const auth = { userId: env.DB.raw.prepare('SELECT id FROM users').get().id };
  assert.deepEqual(await entitlementFor(env, auth.userId), { pro: false, plan: null, until: null, source: null, lapsed: false, linkedEmails: 0 });

  const ends = iso(Date.now() + 5 * DAY);
  await hook(env, subscription(1, { status: 'cancelled', ends_at: ends }));
  assert.deepEqual(await entitlement(env, s), { pro: true, plan: 'monthly', until: ends, source: 'email', lapsed: false, linkedEmails: 0 });
  assert.equal((await entitlementFor(env, auth.userId, new Date(Date.now() + 6 * DAY))).pro, false);
  assert.equal((await entitlementFor(env, auth.userId, new Date(Date.now() + 6 * DAY))).lapsed, true);

  await hook(env, subscription(1, { status: 'past_due', renews_at: iso(Date.now() - 2 * DAY), updated_at: iso(Date.now() + 1) }));
  assert.equal((await entitlement(env, s)).pro, true, 'inside the 3-day grace');
  await hook(env, subscription(1, { status: 'unpaid', renews_at: iso(Date.now() - 4 * DAY), updated_at: iso(Date.now() + 2) }));
  const lapsed = await entitlement(env, s);
  assert.equal(lapsed.pro, false);
  assert.equal(lapsed.lapsed, true);
  await assert.rejects(requirePro(env, auth), (e) => e.status === 403 && e.code === 'pro_required' && e.extra.lapsed === true);

  await hook(env, order(9));
  assert.deepEqual(await entitlement(env, s), { pro: true, plan: 'lifetime', until: null, source: 'email', lapsed: false, linkedEmails: 0 });
  assert.equal((await requirePro(env, auth)).plan, 'lifetime');
  await hook(env, order(9, { status: 'refunded', refunded: true, updated_at: iso(Date.now() + 5) }, 'order_refunded'));
  assert.equal((await entitlement(env, s)).pro, false);
});

test('the best purchase wins: no end beats an end, a later end beats an earlier one', async () => {
  const env = await env0();
  const s = await signIn(env, 'breeder@example.com');
  await hook(env, subscription(1, { status: 'cancelled', ends_at: iso(Date.now() + 2 * DAY) }));
  await hook(env, subscription(2, { status: 'cancelled', ends_at: iso(Date.now() + 9 * DAY), variant_id: YEARLY }));
  assert.equal((await entitlement(env, s)).plan, 'yearly');
  await hook(env, subscription(3, { status: 'active' }));
  assert.deepEqual(await entitlement(env, s), { pro: true, plan: 'monthly', until: null, source: 'email', lapsed: false, linkedEmails: 0 });
});

// --- linking another purchase email ------------------------------------------------------

test('a purchase made with another email is linked by a code sent to that address', async () => {
  const env = await env0();
  await hook(env, subscription(1, { user_email: 'business@example.com', variant_id: YEARLY }));
  const s = await signIn(env, 'breeder@example.com');
  assert.equal((await entitlement(env, s)).pro, false);

  const start = await call(env, 'POST', '/account/license-links/start', { token: s.token, body: { email: 'Business@Example.com ' } });
  assert.equal(start.status, 200);
  const code = lastCode(env);
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
  assert.equal((await call(env, 'POST', '/account/license-links/verify', { token: s.token, body: { email: 'business@example.com', code: wrong } })).status, 400);
  assert.equal((await call(env, 'POST', '/account/license-links/verify', { token: s.token, body: { email: 'other@example.com', code } })).status, 400, 'the code is for that address only');
  const ok = await call(env, 'POST', '/account/license-links/verify', { token: s.token, body: { email: 'business@example.com', code } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { pro: true, plan: 'yearly', until: null, source: 'linked', lapsed: false, linkedEmails: 1 });
  assert.equal((await call(env, 'POST', '/account/license-links/verify', { token: s.token, body: { email: 'business@example.com', code } })).status, 400, 'single use');

  // Linking doesn't move the purchase: that email's own account is Pro too.
  const business = await signIn(env, 'business@example.com');
  assert.equal((await entitlement(env, business)).source, 'email');
});

test('link start answers the same for any address, refuses its own, and is rate-limited', async () => {
  const env = await env0();
  const s = await signIn(env, 'breeder@example.com');
  const start = (email) => call(env, 'POST', '/account/license-links/start', { token: s.token, body: { email } });
  assert.deepEqual(await (await start('nobody-bought@example.com')).json(), { ok: true });
  assert.equal((await start('not an email')).status, 400);
  assert.equal((await start('BREEDER@example.com')).status, 400);
  let last;
  for (let i = 0; i < LINK_LIMIT_PER_HOUR; i++) last = await start(`addr${i}@example.com`);
  assert.equal(last.status, 429, 'the per-account hourly limit');
});

test('too many wrong codes burn the link code; an expired one fails', async () => {
  const env = await env0();
  const s = await signIn(env, 'breeder@example.com');
  await call(env, 'POST', '/account/license-links/start', { token: s.token, body: { email: 'business@example.com' } });
  const code = lastCode(env);
  const verify = (c) => call(env, 'POST', '/account/license-links/verify', { token: s.token, body: { email: 'business@example.com', code: c } });
  for (let i = 0; i < 5; i++) await verify('000000' === code ? '111111' : '000000');
  assert.equal((await (await verify(code)).json()).error, 'too_many_attempts');

  await call(env, 'POST', '/account/license-links/start', { token: s.token, body: { email: 'business@example.com' } });
  env.DB.raw.prepare("UPDATE license_link_codes SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  assert.equal((await verify(lastCode(env))).status, 400);
});

test('removing links needs a fresh sign-in', async () => {
  const env = await env0();
  await hook(env, subscription(1, { user_email: 'business@example.com' }));
  const s = await signIn(env, 'breeder@example.com');
  await call(env, 'POST', '/account/license-links/start', { token: s.token, body: { email: 'business@example.com' } });
  await call(env, 'POST', '/account/license-links/verify', { token: s.token, body: { email: 'business@example.com', code: lastCode(env) } });
  env.DB.raw.prepare("UPDATE sessions SET created_at = '2026-01-01T00:00:00.000Z'").run();
  const refused = await call(env, 'DELETE', '/account/license-links', { token: s.token, body: {} });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, 'reauth_required');
  await call(env, 'POST', '/auth/start', { body: { email: 'breeder@example.com' } });
  const removed = await call(env, 'DELETE', '/account/license-links', { token: s.token, body: { email: 'breeder@example.com', code: lastCode(env) } });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).pro, false);
  assert.equal(count(env, 'license_links'), 0);
});

// --- bookkeeping -----------------------------------------------------------------------------

test('account deletion removes links and codes but keeps the purchase; retention ages ended purchases out', async () => {
  const env = await env0();
  await hook(env, subscription(1));
  await hook(env, subscription(2, { user_email: 'business@example.com', status: 'expired', updated_at: iso(Date.now() - 100 * DAY) }));
  await hook(env, subscription(3, { user_email: 'recent@example.com', status: 'expired', updated_at: iso(Date.now() - 10 * DAY) }));
  const s = await signIn(env, 'breeder@example.com');
  await call(env, 'POST', '/account/license-links/start', { token: s.token, body: { email: 'business@example.com' } });
  await call(env, 'POST', '/account/license-links/verify', { token: s.token, body: { email: 'business@example.com', code: lastCode(env) } });
  await call(env, 'POST', '/account/license-links/start', { token: s.token, body: { email: 'recent@example.com' } });
  assert.equal(count(env, 'license_links'), 1);
  assert.equal(count(env, 'license_link_codes'), 1);

  const exported = await exportAll(env.DB);
  assert.equal(exported.tables.pro_purchases.length, 3);
  assert.equal(exported.tables.license_links.length, 1);
  assert.ok(!('license_link_codes' in exported.tables), 'codes are ephemeral');

  assert.equal((await call(env, 'DELETE', '/account', { token: s.token, body: { confirm: 'DELETE' } })).status, 200);
  assert.equal(count(env, 'license_links'), 0);
  assert.equal(count(env, 'license_link_codes'), 0);
  assert.equal(count(env, 'pro_purchases'), 3);

  await runRetention(env);
  const left = env.DB.raw.prepare('SELECT id FROM pro_purchases ORDER BY id').all().map((r) => r.id);
  assert.deepEqual(left, ['sub:1', 'sub:3'], 'ended more than 90 days ago: gone');
});

test('/ops shows counts and a time, never a hash or a row', async () => {
  const env = await env0();
  await hook(env, subscription(1));
  await hook(env, order(2));
  const cookieRes = await worker.fetch(new Request('https://api.example/ops/login', { method: 'POST', body: new URLSearchParams({ token: env.OPS_TOKEN }) }), env);
  const cookie = cookieRes.headers.get('set-cookie').split(';')[0];
  const html = await (await worker.fetch(new Request('https://api.example/ops', { headers: { Cookie: cookie } }), env)).text();
  assert.match(html, /Pro license link/);
  assert.match(html, /Pro license webhook<\/td><td><span class="ok">ready/);
  assert.match(html, /<td>lifetime<\/td><td>active<\/td><td>1<\/td>/);
  const hash = env.DB.raw.prepare('SELECT email_hash FROM pro_purchases LIMIT 1').get().email_hash;
  assert.ok(!html.includes(hash.slice(0, 10)));
});

test('nothing in license.js logs a body, an email or a key', () => {
  const src = readFileSync(new URL('../src/license.js', import.meta.url), 'utf8');
  const logs = src.match(/console\.\w+\([^)]*\)/g) ?? [];
  for (const line of logs) assert.match(line, /^console\.\w+\('[^']*'\)$/, `only fixed strings: ${line}`);
  assert.ok(readdirSync(new URL('../src/migrations/', import.meta.url)).includes('0006_license_link.sql'));
});
