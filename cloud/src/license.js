// The server-side Pro license link (docs/KennelOS_License_Link_Plan.md).
//
// Lemon Squeezy (LS) POSTs signed webhooks about KennelOS Pro purchases. The
// server keeps the keyed hash of the purchase email (the same HMAC sign-in
// uses), never the address, and never the license key: the license_key_*
// events, whose payloads carry the key, are not subscribed and are ignored if
// they arrive. An account is Pro on the server when a purchase under its own
// email hash, or under an email it linked by code, still grants access.
//
//   POST   /webhooks/lemonsqueezy             LS → Worker, HMAC-signed (no CORS, no bearer)
//   GET    /account/entitlement               { pro, plan, until, source, lapsed, linkedEmails }
//   POST   /account/license-links/start       {email}: a code to that address
//   POST   /account/license-links/verify      {email, code}: link it
//   DELETE /account/license-links             unlink every extra email (fresh sign-in)
//
// This gates only what the SERVER does for an account (the waitlist's W2
// routes call requirePro). The Pro app itself is still gated by the browser's
// own license check, and works the same with no server at all.
//
// Nothing here logs a body, an email, a code or a key (cloud/README.md).
import { emailHash, normalizeEmail, requireFreshSignIn, CODE_TTL_MS, MAX_ATTEMPTS } from './auth.js';
import { hmacHex, hmacHexBytes, randomCode, timingSafeEqual } from './lib/crypto.js';
import { fail, json } from './lib/http.js';
import { limitBucket, limitSignIn } from './ratelimit.js';
import { assertMailAvailable, linkCodeMessage, sendCode } from './mail.js';

const DAY = 24 * 60 * 60 * 1000;
// The app's own grace for a lapsed renewal (shared/data/license.js), so the
// server and the app agree about a failed card (plan §9 decision 3).
export const GRACE_MS = { yearly: 7 * DAY, monthly: 3 * DAY, lifetime: 0 };
export const MAX_WEBHOOK_BYTES = 256 * 1024;
export const LINK_LIMIT_PER_HOUR = 10;

const ids = (raw) => new Set(String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean));

// The webhook's settings: a secret, and wrangler vars naming the store, the
// Pro products and which variants are yearly or lifetime (anything else is
// monthly; plan §9 decision 7). `ready` is false until the secret, the store
// and at least one product are set.
export function licenseConfig(env) {
  const cfg = {
    secretSet: Boolean(env.LEMONSQUEEZY_WEBHOOK_SECRET),
    storeId: String(env.LS_STORE_ID ?? '').trim(),
    productIds: ids(env.LS_PRO_PRODUCT_IDS),
    yearly: ids(env.LS_YEARLY_VARIANT_IDS),
    lifetime: ids(env.LS_LIFETIME_VARIANT_IDS),
    testMode: env.LS_TEST_MODE === 'true',
  };
  cfg.ready = cfg.secretSet && Boolean(cfg.storeId) && cfg.productIds.size > 0;
  return cfg;
}

// --- The webhook ------------------------------------------------------------------
const ok = () => json({ ok: true });

// POST /webhooks/lemonsqueezy. The signature is checked over the raw bytes
// before anything is parsed. 401 on a bad signature; 503 while unconfigured
// (LS retries, and the failed deliveries show in its dashboard); 200 for an
// event that's valid but not ours, so LS doesn't retry it.
export async function handleWebhook(request, env, now = new Date()) {
  const cfg = licenseConfig(env);
  if (!cfg.ready) fail(503, 'not_configured');
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_WEBHOOK_BYTES) fail(413, 'too_large');
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.length > MAX_WEBHOOK_BYTES) fail(413, 'too_large');

  const given = String(request.headers.get('x-signature') ?? '').trim().toLowerCase();
  const expected = await hmacHexBytes(env.LEMONSQUEEZY_WEBHOOK_SECRET, raw);
  if (!given || !timingSafeEqual(given, expected)) {
    console.error('webhook: bad signature');
    fail(401, 'bad_signature');
  }

  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { fail(400, 'bad_json'); }
  const event = String(payload?.meta?.event_name ?? '');
  const data = payload?.data;
  const a = data?.attributes;
  if (!a || typeof a !== 'object') return ok();

  let row;
  if (data.type === 'subscriptions' && event.startsWith('subscription_')) row = subscriptionRow(cfg, data, a, now);
  else if (data.type === 'orders' && (event === 'order_created' || event === 'order_refunded')) row = orderRow(cfg, data, a, now);
  if (!row) return ok(); // not a Pro purchase, another store, the wrong mode, or an event we don't use

  const email = normalizeEmail(a.user_email);
  if (!email) {
    console.error('webhook: no usable email');
    return ok();
  }
  const eh = await emailHash(env, email);
  // An older event (LS retries arrive out of order) never overwrites a newer one.
  await env.DB.prepare(
    `INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET email_hash = excluded.email_hash, kind = excluded.kind, plan = excluded.plan,
       status = excluded.status, access_until = excluded.access_until,
       source_updated_at = excluded.source_updated_at, received_at = excluded.received_at
     WHERE excluded.source_updated_at >= pro_purchases.source_updated_at`,
  ).bind(row.id, eh, row.kind, row.plan, row.status, row.accessUntil, row.updatedAt, now.toISOString()).run();
  return ok();
}

const iso = (v) => {
  const t = Date.parse(v ?? '');
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// Ours: this store, a Pro product, and the Worker's mode (test-mode purchases
// on staging, live ones on production).
function ours(cfg, a, productId) {
  return String(a.store_id ?? '') === cfg.storeId
    && cfg.productIds.has(String(productId ?? ''))
    && Boolean(a.test_mode) === cfg.testMode;
}

function planOf(cfg, variantId) {
  const v = String(variantId ?? '');
  if (cfg.lifetime.has(v)) return 'lifetime';
  if (cfg.yearly.has(v)) return 'yearly';
  return 'monthly';
}

// An ended purchase ends now, even when LS's updated_at runs a little ahead
// of this Worker's clock.
const endedAt = (updatedAt, now) => (updatedAt < now ? updatedAt : now);

// When Pro on the server ends for a subscription in this state (plan §5).
// null = no end while it stays this way.
export function subscriptionAccessUntil({ status, plan, renewsAt, endsAt, updatedAt, now = updatedAt }) {
  switch (status) {
    case 'active':
    case 'on_trial':
      return null;
    case 'past_due':
    case 'unpaid': {
      const from = Date.parse(renewsAt ?? updatedAt);
      return new Date(from + (GRACE_MS[plan] ?? GRACE_MS.monthly)).toISOString();
    }
    case 'cancelled':
      return endsAt ?? updatedAt; // paid to the end of the period
    default: // paused, expired, anything new
      return endedAt(updatedAt, now);
  }
}

function subscriptionRow(cfg, data, a, now) {
  if (!ours(cfg, a, a.product_id)) return null;
  const plan = planOf(cfg, a.variant_id);
  const updatedAt = iso(a.updated_at) ?? now.toISOString();
  const status = String(a.status ?? '');
  return {
    id: `sub:${data.id}`, kind: 'subscription', plan, status, updatedAt,
    accessUntil: subscriptionAccessUntil({ status, plan, renewsAt: iso(a.renews_at), endsAt: iso(a.ends_at), updatedAt, now: now.toISOString() }),
  };
}

// Only a lifetime order grants Pro by itself; a subscription's orders are
// left to its subscription events.
function orderRow(cfg, data, a, now) {
  const item = a.first_order_item ?? {};
  if (!ours(cfg, a, item.product_id)) return null;
  if (planOf(cfg, item.variant_id) !== 'lifetime') return null;
  const updatedAt = iso(a.updated_at) ?? now.toISOString();
  const refunded = a.refunded === true || a.status === 'refunded';
  const status = refunded ? 'refunded' : String(a.status ?? '');
  return {
    id: `order:${data.id}`, kind: 'order', plan: 'lifetime', status, updatedAt,
    accessUntil: status === 'paid' ? null : endedAt(updatedAt, now.toISOString()),
  };
}

// --- Entitlement ---------------------------------------------------------------------
async function accountHashes(env, userId) {
  const own = await env.DB.prepare('SELECT email_hash FROM users WHERE id = ?').bind(userId).first('email_hash');
  const { results } = await env.DB.prepare('SELECT email_hash FROM license_links WHERE user_id = ?').bind(userId).all();
  return { own, linked: results.map((r) => r.email_hash) };
}

const PLAN_RANK = { lifetime: 3, yearly: 2, monthly: 1 };

// → { pro, plan, until, source: 'email' | 'linked' | null, lapsed, linkedEmails }.
// `lapsed`: a purchase exists but none grants access now (renew, rather than
// buy or link). The best active purchase wins: no end before an end, then the
// later end, then the bigger plan.
export async function entitlementFor(env, userId, now = new Date()) {
  const { own, linked } = await accountHashes(env, userId);
  const hashes = [own, ...linked].filter(Boolean);
  const { results } = await env.DB.prepare(
    'SELECT email_hash, plan, access_until FROM pro_purchases WHERE email_hash IN (SELECT value FROM json_each(?))',
  ).bind(JSON.stringify(hashes)).all();
  const nowIso = now.toISOString();
  const active = results.filter((r) => r.access_until === null || r.access_until > nowIso);
  active.sort((x, y) => {
    if ((x.access_until === null) !== (y.access_until === null)) return x.access_until === null ? -1 : 1;
    if (x.access_until !== y.access_until) return x.access_until < y.access_until ? 1 : -1;
    return (PLAN_RANK[y.plan] ?? 0) - (PLAN_RANK[x.plan] ?? 0);
  });
  const best = active[0];
  return {
    pro: Boolean(best),
    plan: best?.plan ?? null,
    until: best ? best.access_until : null,
    source: best ? (best.email_hash === own ? 'email' : 'linked') : null,
    lapsed: !best && results.length > 0,
    linkedEmails: linked.length,
  };
}

// For W2's /waitlist/* routes. 403 pro_required carries `lapsed` and
// `linkedEmails`, so the app can say renew, link or buy.
export async function requirePro(env, auth, now = new Date()) {
  const e = await entitlementFor(env, auth.userId, now);
  if (!e.pro) fail(403, 'pro_required', { lapsed: e.lapsed, linkedEmails: e.linkedEmails });
  return e;
}

export const getEntitlement = (env, auth) => entitlementFor(env, auth.userId);

// --- Linking another purchase email (plan §5) -------------------------------------------
const linkCodeHash = (env, userId, eh, code) => hmacHex(env.EMAIL_HMAC_KEY, `link:${userId}:${eh}:${code}`);

// POST /account/license-links/start {email}. Always {ok: true} for a
// well-formed address that isn't the account's own, whether or not it bought
// Pro, so it can't be used to test who's a customer.
export async function startLink(env, auth, request, body) {
  const email = normalizeEmail(body.email);
  if (!email) fail(400, 'bad_email');
  assertMailAvailable(env);
  const eh = await emailHash(env, email);
  const { own } = await accountHashes(env, auth.userId);
  if (eh === own) fail(400, 'own_email');
  await limitSignIn(env, request, eh);
  await limitBucket(env, `license-link:${auth.userId}`, LINK_LIMIT_PER_HOUR);

  const code = randomCode();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO license_link_codes (user_id, email_hash, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT (user_id) DO UPDATE SET email_hash = excluded.email_hash, code_hash = excluded.code_hash,
       expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
  ).bind(auth.userId, eh, await linkCodeHash(env, auth.userId, eh, code), new Date(now + CODE_TTL_MS).toISOString(), new Date(now).toISOString()).run();

  const minutes = CODE_TTL_MS / 60000;
  await sendCode(env, { email, emailHash: eh, code, minutes, message: linkCodeMessage(code, minutes) });
  return { ok: true };
}

// POST /account/license-links/verify {email, code} → the new entitlement.
export async function verifyLink(env, auth, body) {
  const email = normalizeEmail(body.email);
  if (!email) fail(400, 'bad_email');
  const code = String(body.code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) fail(400, 'invalid_code');
  const eh = await emailHash(env, email);

  const row = await env.DB.prepare('SELECT email_hash, code_hash, expires_at, attempts FROM license_link_codes WHERE user_id = ?')
    .bind(auth.userId).first();
  if (!row || row.email_hash !== eh || row.expires_at <= new Date().toISOString()) fail(400, 'invalid_code');
  if (row.attempts >= MAX_ATTEMPTS) fail(400, 'too_many_attempts');
  if (!timingSafeEqual(row.code_hash, await linkCodeHash(env, auth.userId, eh, code))) {
    await env.DB.prepare('UPDATE license_link_codes SET attempts = attempts + 1 WHERE user_id = ?').bind(auth.userId).run();
    fail(400, row.attempts + 1 >= MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid_code');
  }
  const burned = await env.DB.prepare('DELETE FROM license_link_codes WHERE user_id = ? AND code_hash = ?').bind(auth.userId, row.code_hash).run();
  if (burned.meta.changes !== 1) fail(400, 'invalid_code');

  await env.DB.prepare('INSERT OR IGNORE INTO license_links (user_id, email_hash, linked_at) VALUES (?, ?, ?)')
    .bind(auth.userId, eh, new Date().toISOString()).run();
  return entitlementFor(env, auth.userId);
}

// DELETE /account/license-links {email?, code?}: fresh sign-in, as for the
// other account-changing actions.
export async function removeLinks(env, auth, body) {
  await requireFreshSignIn(env, auth, body);
  await env.DB.prepare('DELETE FROM license_links WHERE user_id = ?').bind(auth.userId).run();
  return entitlementFor(env, auth.userId);
}
