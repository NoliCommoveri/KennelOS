// Notifications for the breeder (docs/KennelOS_Notifications_Plan.md): app alerts
// (web push, payload-free) and the email digest, two separate opt-ins.
//
// - notifyEvent(): what familyActions.js, familyPages.js and serverMoves.js call
//   when something happens. Records an item (kind, the family's listed name, the
//   kennel's name; never what anyone wrote) and wakes her devices. Never throws:
//   the family's action is already recorded, and an alert is a second way to find
//   out, never the only one.
// - Web push with NO payload: a signed (VAPID) empty POST to the push service. The
//   service worker then asks POST /notify/push/pending what to show, proving itself
//   with its subscription's auth secret (no bearer token in a service worker).
// - The digest (runDigests, hourly cron): one email per due program, only when
//   something happened, through mail.js. Her address is kept only while the digest
//   is on; another address than her sign-in one is confirmed with a code first.
//
// Never logged: an email address, an endpoint, a secret, a code.
import { fail } from './lib/http.js';
import { hmacHex, randomCode, sha256Hex, timingSafeEqual } from './lib/crypto.js';
import { emailHash, normalizeEmail } from './auth.js';
import { requirePro } from './license.js';
import { limitBucket } from './ratelimit.js';
import { assertMailAvailable, mailMode, sendCode, sendDigestMail } from './mail.js';
import { escapeHtml as esc } from './lib/html.js';

// --- The catalog (plan §1) --------------------------------------------------------

// Kinds she ticks; `what` is the finer event inside a kind (the line's wording).
export const NOTIFY_KINDS = ['message', 'application', 'turn', 'request', 'ready', 'server_move'];
export const PUSH_DEFAULT_KINDS = ['message', 'application', 'turn', 'request', 'server_move'];
export const DIGEST_DEFAULT_KINDS = [...NOTIFY_KINDS];
export const DIGEST_FREQUENCIES = ['daily', 'weekly'];
export const ITEM_KEEP_DAYS = 8;
export const DIGEST_HOUR = 8; // local time, as the family reminders (serverMoves MORNING_HOUR)
export const DIGEST_CODE_TTL_MS = 10 * 60 * 1000;
const DIGEST_CODE_MAX_ATTEMPTS = 5;
const DAY = 86400000;

// A family's action (familyActions FAMILY_ACTIONS) → its kind, or null (not notified).
export const ACTION_KINDS = Object.freeze({
  pick: 'turn', pass: 'turn',
  leave: 'request', pause_request: 'request', listen: 'request', pref_change: 'request', companion_request: 'request',
  extra_request: 'request', extra_cancel: 'request',
  pickup_book: 'request', pickup_cancel: 'request', pickup_address: 'request', home_location: 'request', back_out: 'request',
  ready: 'ready',
});

const LINES = {
  message: (n) => `New message from ${n}`,
  application: (n) => `New application from ${n}`,
  pick: (n) => `${n} picked a pup`,
  pass: (n) => `${n} passed on their turn`,
  leave: (n) => `${n} left the list`,
  pause_request: (n) => `${n} asked to pause`,
  listen: (n) => `${n} asked to change which litters they wait for`,
  pref_change: (n) => `${n} asked to change their answers`,
  companion_request: (n) => `${n} asked for their Companion link`,
  extra_request: (n) => `${n} asked for an extra`,
  extra_cancel: (n) => `${n} asked to cancel an extra`,
  pickup_book: (n) => `${n} asked for a pickup time`,
  pickup_cancel: (n) => `${n} asked to cancel their pickup time`,
  pickup_address: (n) => `${n} asked to meet at their own address`,
  home_location: (n) => `${n} said where they live`,
  back_out: (n) => `${n} asked to back out`,
  ready: (n) => `${n} answered "Ready now?"`,
  server_offer: (n) => `${n} was offered a turn: contact them`,
  server_close: (n) => `${n}'s turn closed with no response`,
  test: () => 'Test alert: alerts work on this device',
};

// "Jane S." from "Jane Smith" (the app's waitlistRules.publicName). Blank: "A family".
export function listedName(fullName) {
  const words = String(fullName ?? '').trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!words.length) return '';
  if (words.length === 1) return words[0];
  return `${words[0]} ${[...words[words.length - 1]][0].toUpperCase()}.`;
}

// Pure: one item as a line. `hideNames` → "A family …"; `withKennel` adds it.
export function itemLine(item, { hideNames = false, withKennel = false } = {}) {
  const build = LINES[item.what] || LINES[item.kind];
  if (!build) return '';
  const name = !hideNames && item.name ? item.name : 'a family';
  let line = build(name);
  line = line.charAt(0).toUpperCase() + line.slice(1);
  return withKennel && item.kennel ? `${line} (${item.kennel})` : line;
}

const parseKinds = (raw, fallback) => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((k) => NOTIFY_KINDS.includes(k)) : fallback;
  } catch { return fallback; }
};
const cleanKinds = (v, fallback) => (Array.isArray(v) ? NOTIFY_KINDS.filter((k) => v.includes(k)) : fallback);

// --- VAPID (plan §2.4) ------------------------------------------------------------

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const enc = new TextEncoder();

// The key pair is ONE secret, VAPID_PRIVATE_JWK (a P-256 private JWK, with x and
// y), so the public half can't drift from it. → { ready, publicKey, jwk }
export function vapidConfig(env) {
  try {
    const jwk = JSON.parse(env.VAPID_PRIVATE_JWK || 'null');
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y) return { ready: false, publicKey: null, jwk: null };
    const raw = new Uint8Array(65);
    raw[0] = 4;
    raw.set(fromB64url(jwk.x), 1);
    raw.set(fromB64url(jwk.y), 33);
    return { ready: true, publicKey: b64url(raw), jwk };
  } catch {
    return { ready: false, publicKey: null, jwk: null };
  }
}

// /ops's "Generate push keys": a fresh pair, the private JWK to paste as the secret.
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const { kty, crv, x, y, d } = jwk;
  const privateJwk = JSON.stringify({ kty, crv, x, y, d });
  return { privateJwk, publicKey: vapidConfig({ VAPID_PRIVATE_JWK: privateJwk }).publicKey };
}

async function vapidHeader(env, endpoint, now) {
  const { jwk, publicKey } = vapidConfig(env);
  const key = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:support@kennelos.app',
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${publicKey}`;
}

// Only real push services get a request from this Worker (an endpoint is a URL a
// browser gave us; nothing else may be POSTed to).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
export function validEndpoint(raw) {
  try {
    const u = new URL(String(raw ?? ''));
    return u.protocol === 'https:' && raw.length <= 1024 && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch { return false; }
}

// One payload-free push. → the push service's status (0 when unreachable).
export async function sendPush(env, endpoint, now = new Date()) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: await vapidHeader(env, endpoint, now), ttl: '86400', urgency: 'high', 'content-length': '0' },
      signal: AbortSignal.timeout(5000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

// --- Settings ---------------------------------------------------------------------

async function settingsRow(env, programId) {
  return env.DB.prepare('SELECT * FROM notify_settings WHERE program_id = ?').bind(programId).first();
}

async function ensureSettings(env, programId, now = new Date()) {
  await env.DB.prepare(
    `INSERT INTO notify_settings (program_id, push_kinds, digest_kinds, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (program_id) DO NOTHING`,
  ).bind(programId, JSON.stringify(PUSH_DEFAULT_KINDS), JSON.stringify(DIGEST_DEFAULT_KINDS), now.toISOString()).run();
  return settingsRow(env, programId);
}

// GET /notify → what the Notifications card shows.
export async function getNotify(env, auth) {
  const s = await settingsRow(env, auth.programId);
  const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE program_id = ? AND device_id = ?')
    .bind(auth.programId, auth.deviceId).first('n');
  const devices = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE program_id = ?').bind(auth.programId).first('n');
  const { ready, publicKey } = vapidConfig(env);
  return {
    kinds: NOTIFY_KINDS,
    push: {
      available: ready, publicKey,
      kinds: s ? parseKinds(s.push_kinds, PUSH_DEFAULT_KINDS) : PUSH_DEFAULT_KINDS,
      hideNames: Boolean(s && s.hide_names),
      thisDevice: mine > 0, devices,
    },
    digest: {
      available: Boolean(mailMode(env)),
      email: s?.digest_email ?? null,
      pendingEmail: s?.pending_email && s.pending_expires_at > new Date().toISOString() ? s.pending_email : null,
      frequency: s?.digest_frequency || 'daily',
      kinds: s ? parseKinds(s.digest_kinds, DIGEST_DEFAULT_KINDS) : DIGEST_DEFAULT_KINDS,
    },
  };
}

const validTz = (tz) => {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return null; }
};

// PUT /notify {push_kinds?, hide_names?, digest_kinds?, digest_frequency?, tz?}
export async function putNotify(env, auth, body) {
  await requirePro(env, auth);
  const s = await ensureSettings(env, auth.programId);
  const freq = body.digest_frequency === undefined ? s.digest_frequency
    : DIGEST_FREQUENCIES.includes(body.digest_frequency) ? body.digest_frequency : fail(400, 'bad_value');
  await env.DB.prepare(
    `UPDATE notify_settings SET push_kinds = ?, hide_names = ?, digest_kinds = ?, digest_frequency = ?, digest_tz = ?, updated_at = ?
      WHERE program_id = ?`,
  ).bind(
    JSON.stringify(cleanKinds(body.push_kinds, parseKinds(s.push_kinds, PUSH_DEFAULT_KINDS))),
    body.hide_names === undefined ? s.hide_names : (body.hide_names ? 1 : 0),
    JSON.stringify(cleanKinds(body.digest_kinds, parseKinds(s.digest_kinds, DIGEST_DEFAULT_KINDS))),
    freq, validTz(body.tz) ?? s.digest_tz, new Date().toISOString(), auth.programId,
  ).run();
  return getNotify(env, auth);
}

// --- Push subscriptions -----------------------------------------------------------

const AUTH_SECRET = /^[A-Za-z0-9_-]{16,64}$/;

// POST /notify/push/subscribe {endpoint, auth}: this device. Again with the same
// endpoint just refreshes it (the app does that on open, so a dropped iPhone
// subscription comes back).
export async function subscribePush(env, auth, body) {
  await requirePro(env, auth);
  if (!vapidConfig(env).ready) fail(503, 'push_unavailable');
  if (!validEndpoint(body.endpoint) || typeof body.auth !== 'string' || !AUTH_SECRET.test(body.auth)) fail(400, 'bad_subscription');
  await ensureSettings(env, auth.programId);
  const now = new Date().toISOString();
  await env.DB.batch([
    // One subscription per device: a new one replaces the old.
    env.DB.prepare('DELETE FROM push_subscriptions WHERE program_id = ? AND device_id = ? AND endpoint != ?').bind(auth.programId, auth.deviceId, body.endpoint),
    env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint_hash, program_id, user_id, device_id, endpoint, auth_secret, created_at, last_shown_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) FROM notify_items))
       ON CONFLICT (endpoint_hash) DO UPDATE SET program_id = excluded.program_id, user_id = excluded.user_id,
         device_id = excluded.device_id, auth_secret = excluded.auth_secret`,
    ).bind(await sha256Hex(body.endpoint), auth.programId, auth.userId, auth.deviceId, body.endpoint, body.auth, now),
  ]);
  return getNotify(env, auth);
}

// POST /notify/push/unsubscribe: this device's alerts off.
export async function unsubscribePush(env, auth) {
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE program_id = ? AND device_id = ?').bind(auth.programId, auth.deviceId).run();
  return getNotify(env, auth);
}

// Subscriptions whose device still has a live session (sign out or an erase
// silences a device with nothing else to remember).
async function liveSubscriptions(env, programId, now = new Date()) {
  const { results } = await env.DB.prepare(
    `SELECT p.endpoint_hash, p.endpoint FROM push_subscriptions p
      WHERE p.program_id = ?
        AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = p.user_id AND s.device_id = p.device_id
                     AND s.revoked_at IS NULL AND s.expires_at > ?)`,
  ).bind(programId, now.toISOString()).all();
  return results;
}

async function pushAll(env, subs, now = new Date()) {
  let sent = 0;
  for (const sub of subs) {
    const status = await sendPush(env, sub.endpoint, now);
    if (status === 404 || status === 410) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ?').bind(sub.endpoint_hash).run();
    } else if (status >= 200 && status < 300) {
      sent++;
      await env.DB.prepare('UPDATE push_subscriptions SET last_sent_at = ? WHERE endpoint_hash = ?').bind(now.toISOString(), sub.endpoint_hash).run();
    } else {
      console.error('push send failed', status);
    }
  }
  return sent;
}

// POST /notify/push/test: an alert to this device.
export async function testPush(env, auth) {
  if (!vapidConfig(env).ready) fail(503, 'push_unavailable');
  await limitBucket(env, `push-test:${auth.programId}`, 10);
  const subs = (await liveSubscriptions(env, auth.programId)).filter(Boolean);
  const mine = await env.DB.prepare('SELECT endpoint_hash, endpoint FROM push_subscriptions WHERE program_id = ? AND device_id = ?')
    .bind(auth.programId, auth.deviceId).first();
  if (!mine || !subs.some((s) => s.endpoint_hash === mine.endpoint_hash)) fail(409, 'not_subscribed');
  await env.DB.prepare(
    `INSERT INTO notify_items (program_id, kind, what, name, kennel, entry_id, at) VALUES (?, 'test', 'test', NULL, NULL, ?, ?)`,
  ).bind(auth.programId, mine.endpoint_hash, new Date().toISOString()).run();
  return { ok: (await pushAll(env, [mine])) === 1 };
}

// POST /notify/push/pending {endpoint, auth} — no bearer token: the service
// worker proves it holds the subscription. → { title, body, path, tag, count }.
// Marks what it returns as shown on this device.
export async function pendingPush(env, body, now = new Date()) {
  if (!validEndpoint(body.endpoint) || typeof body.auth !== 'string') fail(401, 'unknown_subscription');
  const sub = await env.DB.prepare('SELECT * FROM push_subscriptions WHERE endpoint_hash = ?').bind(await sha256Hex(body.endpoint)).first();
  if (!sub || !timingSafeEqual(sub.auth_secret, body.auth)) fail(401, 'unknown_subscription');
  const live = (await liveSubscriptions(env, sub.program_id, now)).some((s) => s.endpoint_hash === sub.endpoint_hash);
  if (!live) {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ?').bind(sub.endpoint_hash).run();
    fail(401, 'unknown_subscription');
  }
  const s = await settingsRow(env, sub.program_id);
  const kinds = s ? parseKinds(s.push_kinds, PUSH_DEFAULT_KINDS) : PUSH_DEFAULT_KINDS;
  const { results } = await env.DB.prepare(
    `SELECT seq, kind, what, name, kennel, entry_id, at FROM notify_items
      WHERE program_id = ? AND seq > ? AND (kind != 'test' OR entry_id = ?) ORDER BY seq`,
  ).bind(sub.program_id, sub.last_shown_seq, sub.endpoint_hash).all();
  const items = results.filter((i) => i.kind === 'test' || kinds.includes(i.kind));
  if (results.length) {
    await env.DB.prepare('UPDATE push_subscriptions SET last_shown_seq = ? WHERE endpoint_hash = ?').bind(results[results.length - 1].seq, sub.endpoint_hash).run();
  }
  return pushText(items, { hideNames: Boolean(s && s.hide_names), withKennel: await kennelCount(env, sub.program_id) > 1 });
}

const kennelCount = async (env, programId) => env.DB.prepare('SELECT COUNT(*) AS n FROM wl_projection WHERE program_id = ?').bind(programId).first('n');

// Pure: the notification for these items. One family's item opens their page;
// anything else opens Today. Nothing new (already shown): a quiet generic one,
// because a push must always show something.
export function pushText(items, { hideNames = false, withKennel = false } = {}) {
  const lines = items.map((i) => itemLine(i, { hideNames, withKennel })).filter(Boolean);
  const tag = 'kennelos-waitlist';
  if (!lines.length) return { title: 'KennelOS', body: 'Something new on your waitlist.', path: 'pages/today.html', tag, count: 0 };
  const one = items.length === 1 && items[0].entry_id && items[0].kind !== 'test' && items[0].kind !== 'application';
  return {
    title: lines.length === 1 ? 'KennelOS' : `KennelOS: ${lines.length} new on your waitlist`,
    body: lines.slice(-4).join('\n'),
    path: one ? `pages/waitlist-entry.html?id=${encodeURIComponent(items[0].entry_id)}` : 'pages/today.html',
    tag, count: lines.length,
  };
}

// --- Recording an event -----------------------------------------------------------

// What happened: `kind` (NOTIFY_KINDS), `what` (the LINES key), the family's FULL
// name (made into their listed name here), the kennel's name, the entry id.
// Recorded only when she turned on alerts or the digest for that kind; pushes to
// her live devices when alerts are on for it. Never throws.
export async function notifyEvent(env, { programId, kind, what, name = '', kennel = '', entryId = null }, now = new Date()) {
  try {
    const s = await settingsRow(env, programId);
    if (!s) return 'off';
    const pushOn = parseKinds(s.push_kinds, PUSH_DEFAULT_KINDS).includes(kind);
    const subs = pushOn ? await liveSubscriptions(env, programId, now) : [];
    const digestOn = Boolean(s.digest_email) && parseKinds(s.digest_kinds, DIGEST_DEFAULT_KINDS).includes(kind);
    if (!subs.length && !digestOn) return 'off';
    await env.DB.prepare(
      'INSERT INTO notify_items (program_id, kind, what, name, kennel, entry_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(programId, kind, what || kind, listedName(name) || null, String(kennel || '').slice(0, 80) || null, entryId, now.toISOString()).run();
    if (subs.length && vapidConfig(env).ready) await pushAll(env, subs, now);
    return 'recorded';
  } catch (err) {
    console.error('notify failed', String(err?.message ?? err));
    return 'failed';
  }
}

// --- The email digest (plan §3) ---------------------------------------------------

const digestCodeHash = (env, programId, code) => hmacHex(env.EMAIL_HMAC_KEY, `digest-code:${programId}:${code}`);

export function digestCodeMessage(code, minutes) {
  return {
    subject: `Your KennelOS code: ${code}`,
    text: `Your KennelOS code is ${code}\n\n`
      + 'It confirms this address for the KennelOS email digest (a summary of what happened on your waitlist). '
      + `Type it into the app within ${minutes} minutes.\n\n`
      + 'If you did not ask for this, ignore this email: without the code nothing is sent here.\n',
  };
}

// POST /notify/digest {email, frequency?, kinds?, tz?}: turn the digest on (or
// change its address). Her sign-in address is on at once; another waits for a
// code sent to it. → getNotify, plus { pending: true } while a code is out.
export async function startDigest(env, auth, request, body) {
  await requirePro(env, auth);
  assertMailAvailable(env);
  const email = normalizeEmail(body.email);
  if (!email) fail(400, 'bad_email');
  await putNotify(env, auth, { digest_frequency: body.frequency, digest_kinds: body.kinds, tz: body.tz });
  const own = await env.DB.prepare('SELECT email_hash FROM users WHERE id = ?').bind(auth.userId).first('email_hash');
  const now = new Date();
  if (own && own === await emailHash(env, email)) {
    await env.DB.prepare(
      `UPDATE notify_settings SET digest_email = ?, pending_email = NULL, pending_code_hash = NULL, pending_expires_at = NULL,
         pending_attempts = 0, digest_last_sent_at = COALESCE(digest_last_sent_at, ?), updated_at = ? WHERE program_id = ?`,
    ).bind(email, now.toISOString(), now.toISOString(), auth.programId).run();
    return { ...(await getNotify(env, auth)), pending: false };
  }
  await limitBucket(env, `digest-code:${auth.programId}`, 5);
  const code = randomCode();
  await env.DB.prepare(
    `UPDATE notify_settings SET pending_email = ?, pending_code_hash = ?, pending_expires_at = ?, pending_attempts = 0, updated_at = ?
      WHERE program_id = ?`,
  ).bind(email, await digestCodeHash(env, auth.programId, code), new Date(now.getTime() + DIGEST_CODE_TTL_MS).toISOString(), now.toISOString(), auth.programId).run();
  await sendCode(env, { email, emailHash: await emailHash(env, email), code, minutes: DIGEST_CODE_TTL_MS / 60000, message: digestCodeMessage(code, DIGEST_CODE_TTL_MS / 60000) });
  return { ...(await getNotify(env, auth)), pending: true };
}

// POST /notify/digest/verify {code}
export async function verifyDigest(env, auth, body) {
  const code = String(body.code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) fail(400, 'invalid_code');
  const s = await settingsRow(env, auth.programId);
  const now = new Date();
  if (!s || !s.pending_email || !s.pending_expires_at || s.pending_expires_at <= now.toISOString()) fail(400, 'invalid_code');
  if (s.pending_attempts >= DIGEST_CODE_MAX_ATTEMPTS) fail(400, 'too_many_attempts');
  if (!timingSafeEqual(s.pending_code_hash, await digestCodeHash(env, auth.programId, code))) {
    await env.DB.prepare('UPDATE notify_settings SET pending_attempts = pending_attempts + 1 WHERE program_id = ?').bind(auth.programId).run();
    fail(400, s.pending_attempts + 1 >= DIGEST_CODE_MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid_code');
  }
  await env.DB.prepare(
    `UPDATE notify_settings SET digest_email = pending_email, pending_email = NULL, pending_code_hash = NULL, pending_expires_at = NULL,
       pending_attempts = 0, digest_last_sent_at = COALESCE(digest_last_sent_at, ?), updated_at = ? WHERE program_id = ?`,
  ).bind(now.toISOString(), now.toISOString(), auth.programId).run();
  return getNotify(env, auth);
}

// DELETE /notify/digest, and the email's turn-off link: the address is deleted.
async function stopDigest(env, programId) {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE notify_settings SET digest_email = NULL, pending_email = NULL, pending_code_hash = NULL, pending_expires_at = NULL,
         pending_attempts = 0, digest_last_sent_at = NULL, updated_at = ? WHERE program_id = ?`,
    ).bind(new Date().toISOString(), programId),
    env.DB.prepare('UPDATE notify_items SET digested_at = ? WHERE program_id = ? AND digested_at IS NULL').bind(new Date().toISOString(), programId),
  ]);
}
export async function deleteDigest(env, auth) {
  await stopDigest(env, auth.programId);
  return getNotify(env, auth);
}

const offSig = (env, programId) => hmacHex(env.EMAIL_HMAC_KEY, `digest-off:${programId}`);
export async function offLink(env, origin, programId) {
  return `${origin}/notify/off?p=${encodeURIComponent(programId)}&s=${await offSig(env, programId)}`;
}

const offPage = (body, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>KennelOS email digest</title></head>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;">${body}</body></html>`,
{ status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" } });

// GET shows a button (an email client opening links must not turn it off by
// itself); POST turns it off.
export async function handleDigestOff(request, env, url) {
  const form = request.method === 'POST' ? await request.formData() : null;
  const p = String((form ? form.get('p') : url.searchParams.get('p')) ?? '');
  const sig = String((form ? form.get('s') : url.searchParams.get('s')) ?? '');
  if (!p || !env.EMAIL_HMAC_KEY || !timingSafeEqual(sig, await offSig(env, p))) {
    return offPage('<h1>Link not recognised</h1><p>Turn the digest off in KennelOS: Settings, Notifications.</p>', 400);
  }
  if (request.method !== 'POST') {
    return offPage(`<h1>Turn off the email digest?</h1><p>You'll stop getting KennelOS waitlist summaries, and your address is deleted from the KennelOS server. App alerts aren't affected.</p>
<form method="post" action="/notify/off"><input type="hidden" name="p" value="${esc(p)}"><input type="hidden" name="s" value="${esc(sig)}">
<button type="submit" style="font:inherit;padding:.5rem 1rem;">Turn it off</button></form>`);
  }
  await stopDigest(env, p);
  return offPage('<h1>The digest is off</h1><p>Your address was deleted. You can turn it back on in KennelOS: Settings, Notifications.</p>');
}

// Pure: local date, hour and weekday (0 = Sunday) in `tz`.
export function localParts(now, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: validTz(tz) || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday) };
}

// Pure: is this program's digest due now? Daily: once a local day, from 8 am.
// Weekly: Mondays from 8 am, once.
export function digestDue(s, now) {
  const here = localParts(now, s.digest_tz);
  if (here.hour < DIGEST_HOUR) return false;
  const last = s.digest_last_sent_at ? localParts(new Date(s.digest_last_sent_at), s.digest_tz).date : null;
  if (s.digest_frequency === 'weekly') return here.weekday === 1 && last !== here.date;
  return last !== here.date;
}

const PLURAL = { message: ['message', 'messages'], application: ['application', 'applications'] };

// Pure: the digest email. `items` oldest first.
export function digestEmail(items, { tz, withKennel = false, appUrl, offUrl, frequency = 'daily' }) {
  const counts = { message: 0, application: 0, other: 0 };
  for (const i of items) counts[PLURAL[i.kind] ? i.kind : 'other']++;
  const bits = [];
  for (const k of ['message', 'application']) if (counts[k]) bits.push(`${counts[k]} ${PLURAL[k][counts[k] === 1 ? 0 : 1]}`);
  if (counts.other) bits.push(`${counts.other} other update${counts.other === 1 ? '' : 's'}`);
  const when = new Intl.DateTimeFormat('en-US', { timeZone: validTz(tz) || 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const lines = items.map((i) => `- ${when.format(new Date(i.at))}  ${itemLine(i, { withKennel })}`);
  return {
    subject: `KennelOS: ${bits.join(', ')}`,
    text: `Here's what happened on your waitlist since your last ${frequency === 'weekly' ? 'weekly ' : ''}digest.\n\n`
      + `${lines.join('\n')}\n\n`
      + `Open KennelOS to read and answer them:\n${appUrl}\n\n`
      + '--\nYou get this because you turned on the email digest in KennelOS (Settings, Notifications). '
      + 'It never includes what families wrote.\n'
      + `Turn it off: ${offUrl}\n`,
  };
}

// The hourly run: every program with the digest on, when due and something
// happened. → { due, sent, failed }
export async function runDigests(env, { now = new Date(), origin = env.FAMILY_PAGES_ORIGIN || '' } = {}) {
  const out = { due: 0, sent: 0, failed: 0 };
  if (!mailMode(env)) return out;
  const { results } = await env.DB.prepare('SELECT * FROM notify_settings WHERE digest_email IS NOT NULL').all();
  for (const s of results) {
    try {
      if (!digestDue(s, now)) continue;
      const kinds = parseKinds(s.digest_kinds, DIGEST_DEFAULT_KINDS);
      const { results: rows } = await env.DB.prepare(
        "SELECT seq, kind, what, name, kennel, at FROM notify_items WHERE program_id = ? AND digested_at IS NULL AND kind != 'test' ORDER BY seq",
      ).bind(s.program_id).all();
      const items = rows.filter((i) => kinds.includes(i.kind));
      if (!items.length) continue;
      out.due++;
      const mail = digestEmail(items, {
        tz: s.digest_tz, frequency: s.digest_frequency, withKennel: await kennelCount(env, s.program_id) > 1,
        appUrl: env.APP_URL || 'https://pro.kennelos.app/pages/today.html', offUrl: await offLink(env, origin, s.program_id),
      });
      const status = await sendDigestMail(env, { to: s.digest_email, ...mail });
      if (status !== 'sent') { out.failed++; continue; }
      out.sent++;
      await env.DB.batch([
        env.DB.prepare('UPDATE notify_items SET digested_at = ? WHERE program_id = ? AND digested_at IS NULL AND seq <= ?')
          .bind(now.toISOString(), s.program_id, rows[rows.length - 1].seq),
        env.DB.prepare('UPDATE notify_settings SET digest_last_sent_at = ? WHERE program_id = ?').bind(now.toISOString(), s.program_id),
      ]);
    } catch (err) {
      out.failed++;
      console.error('digest failed', String(err?.message ?? err));
    }
  }
  return out;
}

// --- Housekeeping -----------------------------------------------------------------

// For retention.js: old items, expired codes, subscriptions whose device has no
// live session.
export const notifyRetentionStatements = (env, nowMs) => {
  const iso = (ms) => new Date(ms).toISOString();
  return [
    env.DB.prepare('DELETE FROM notify_items WHERE at < ?').bind(iso(nowMs - ITEM_KEEP_DAYS * DAY)),
    env.DB.prepare(
      `UPDATE notify_settings SET pending_email = NULL, pending_code_hash = NULL, pending_expires_at = NULL, pending_attempts = 0
        WHERE pending_expires_at < ?`,
    ).bind(iso(nowMs)),
    env.DB.prepare(
      `DELETE FROM push_subscriptions WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = push_subscriptions.user_id
         AND s.device_id = push_subscriptions.device_id AND s.revoked_at IS NULL AND s.expires_at > ?)`,
    ).bind(iso(nowMs)),
  ];
};

// For program.js's account deletion.
export const deleteNotifyStatements = (env, programId) => ['notify_items', 'push_subscriptions', 'notify_settings']
  .map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE program_id = ?`).bind(programId));
