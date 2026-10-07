// Sign-in by emailed 6-digit code, and bearer-token sessions (plan §2.1, §6.1, §6.2).
//
// The server never keeps a readable email address: it keeps
// HMAC(EMAIL_HMAC_KEY, normalized email). Codes and tokens are stored hashed.
import { hmacHex, sha256Hex, randomCode, randomHex, timingSafeEqual } from './lib/crypto.js';
import { fail } from './lib/http.js';
import { limitSignIn } from './ratelimit.js';
import { assertMailAvailable, sendCode } from './mail.js';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const SLIDE_AFTER_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export async function emailHash(env, email) {
  if (!env.EMAIL_HMAC_KEY) fail(503, 'not_configured');
  return hmacHex(env.EMAIL_HMAC_KEY, `email:${email}`);
}

const codeHash = (env, eh, code) => hmacHex(env.EMAIL_HMAC_KEY, `code:${eh}:${code}`);

// POST /auth/start. Always {ok: true} for a well-formed address, whether or not
// it has an account.
export async function startSignIn(env, request, body) {
  const email = normalizeEmail(body.email);
  if (!email) fail(400, 'bad_email');
  assertMailAvailable(env);
  const eh = await emailHash(env, email);
  await limitSignIn(env, request, eh);

  const code = randomCode();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO login_codes (email_hash, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (email_hash) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       attempts = 0, created_at = excluded.created_at`,
  ).bind(eh, await codeHash(env, eh, code), new Date(now + CODE_TTL_MS).toISOString(), new Date(now).toISOString()).run();

  await sendCode(env, { email, emailHash: eh, code, minutes: CODE_TTL_MS / 60000 });
  return { ok: true };
}

// Checks a typed code for this email hash and burns it, so it works exactly
// once. Throws 400 invalid_code / too_many_attempts otherwise. Shared by
// sign-in and by the fresh-sign-in check in front of an erase (devices.js).
export async function checkCode(env, eh, code) {
  const row = await env.DB.prepare('SELECT code_hash, expires_at, attempts FROM login_codes WHERE email_hash = ?').bind(eh).first();
  if (!row || row.expires_at <= new Date().toISOString()) fail(400, 'invalid_code');
  if (row.attempts >= MAX_ATTEMPTS) fail(400, 'too_many_attempts');

  if (!timingSafeEqual(row.code_hash, await codeHash(env, eh, code))) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email_hash = ?').bind(eh).run();
    fail(400, row.attempts + 1 >= MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid_code');
  }

  // Burn the code before anything else, so it signs in exactly once.
  const burned = await env.DB.prepare('DELETE FROM login_codes WHERE email_hash = ? AND code_hash = ?').bind(eh, row.code_hash).run();
  if (burned.meta.changes !== 1) fail(400, 'invalid_code');
}

// POST /auth/verify. Creates the user and their program on first sign-in.
export async function verifyCode(env, body) {
  const email = normalizeEmail(body.email);
  if (!email) fail(400, 'bad_email');
  const code = String(body.code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) fail(400, 'invalid_code');
  const eh = await emailHash(env, email);

  await checkCode(env, eh, code);

  const nowIso = new Date().toISOString();
  let user = await env.DB.prepare('SELECT id FROM users WHERE email_hash = ?').bind(eh).first();
  if (!user) {
    const userId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, email_hash, created_at) VALUES (?, ?, ?)').bind(userId, eh, nowIso),
      env.DB.prepare('INSERT INTO programs (id, owner_user_id, created_at) VALUES (?, ?, ?)').bind(crypto.randomUUID(), userId, nowIso),
    ]);
    user = { id: userId };
  }
  const program = await env.DB.prepare('SELECT id FROM programs WHERE owner_user_id = ?').bind(user.id).first();

  // The device keeps its own id across sign-ins, so signing in again on the
  // backing device doesn't turn it into a stranger (plan §3.4).
  const deviceId = UUID.test(String(body.deviceId ?? '')) ? String(body.deviceId).toLowerCase() : crypto.randomUUID();
  const deviceLabel = String(body.deviceLabel ?? '').trim().slice(0, 60) || null;
  const token = randomHex(32);
  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, device_id, device_label, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(await sha256Hex(token), user.id, deviceId, deviceLabel, nowIso, nowIso, new Date(Date.now() + SESSION_MS).toISOString()).run();

  return { token, programId: program.id, deviceId };
}

// Every authenticated route starts here. Sliding expiry: a request more than a
// day after the last one pushes the expiry 90 days out again.
//
// A device its owner asked to erase (plan §2.5) gets 401 device_erased, checked
// BEFORE revoked and expired: the erase revokes its sessions, and a phone that
// stayed away past its expiry must still hear it. Only the erase-ack route
// passes `allowErased`.
export async function authenticate(env, request, { allowErased = false } = {}) {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('authorization') ?? '');
  if (!match) fail(401, 'unauthorized');
  const tokenHash = await sha256Hex(match[1]);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.device_id, s.device_label, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
            p.id AS program_id, e.requested_at AS erase_requested_at
       FROM sessions s JOIN programs p ON p.owner_user_id = s.user_id
       LEFT JOIN device_erasures e ON e.user_id = s.user_id AND e.device_id = s.device_id
      WHERE s.token_hash = ?`,
  ).bind(tokenHash).first();
  if (!row) fail(401, 'unauthorized');
  const auth = {
    tokenHash, userId: row.user_id, deviceId: row.device_id, deviceLabel: row.device_label,
    programId: row.program_id, createdAt: row.created_at,
  };
  if (row.erase_requested_at) {
    if (allowErased) return { ...auth, erased: true };
    fail(401, 'device_erased');
  }
  const now = Date.now();
  if (row.revoked_at || Date.parse(row.expires_at) <= now) fail(401, 'unauthorized');

  if (now - Date.parse(row.last_seen_at) > SLIDE_AFTER_MS) {
    await env.DB.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .bind(new Date(now).toISOString(), new Date(now + SESSION_MS).toISOString(), tokenHash)
      .run();
  }
  return auth;
}

export async function signOut(env, auth) {
  await env.DB.prepare("UPDATE sessions SET revoked_at = ?, revoked_reason = 'self' WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), auth.tokenHash).run();
  return { ok: true };
}

// POST /auth/signout-others {email?, code?}: needs a fresh sign-in.
export async function signOutOthers(env, auth, body = {}) {
  await requireFreshSignIn(env, auth, body);
  const res = await env.DB.prepare("UPDATE sessions SET revoked_at = ?, revoked_reason = 'others' WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), auth.userId, auth.tokenHash).run();
  return { ok: true, revoked: res.meta.changes };
}

// The actions a stolen phone that is still signed in must not be able to take
// (plan §2.5, §6.4): erasing another device, signing out the others, deleting
// the account. They need a fresh sign-in: a session from the last 15 minutes
// (so an owner who just signed in on their new phone isn't asked twice), or
// {email, code} with a code just sent by /auth/start. Otherwise 403
// reauth_required.
export const FRESH_SIGN_IN_MS = 15 * 60 * 1000;

export async function requireFreshSignIn(env, auth, body = {}) {
  if (Date.now() - Date.parse(auth.createdAt) <= FRESH_SIGN_IN_MS) return;
  const code = String(body.code ?? '').replace(/\s/g, '');
  const email = normalizeEmail(body.email);
  if (!code) fail(403, 'reauth_required');
  if (!email || !/^\d{6}$/.test(code)) fail(400, 'invalid_code');
  const eh = await emailHash(env, email);
  const user = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND email_hash = ?').bind(auth.userId, eh).first();
  if (!user) fail(400, 'invalid_code');
  await checkCode(env, eh, code);
}
