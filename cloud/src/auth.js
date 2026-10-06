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

  await sendCode(env, { email, emailHash: eh, code });
  return { ok: true };
}

// POST /auth/verify. Creates the user and their program on first sign-in.
export async function verifyCode(env, body) {
  const email = normalizeEmail(body.email);
  if (!email) fail(400, 'bad_email');
  const code = String(body.code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) fail(400, 'invalid_code');
  const eh = await emailHash(env, email);

  const row = await env.DB.prepare('SELECT code_hash, expires_at, attempts FROM login_codes WHERE email_hash = ?').bind(eh).first();
  const nowIso = new Date().toISOString();
  if (!row || row.expires_at <= nowIso) fail(400, 'invalid_code');
  if (row.attempts >= MAX_ATTEMPTS) fail(400, 'too_many_attempts');

  if (!timingSafeEqual(row.code_hash, await codeHash(env, eh, code))) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email_hash = ?').bind(eh).run();
    fail(400, row.attempts + 1 >= MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid_code');
  }

  // Burn the code before anything else, so it signs in exactly once.
  const burned = await env.DB.prepare('DELETE FROM login_codes WHERE email_hash = ? AND code_hash = ?').bind(eh, row.code_hash).run();
  if (burned.meta.changes !== 1) fail(400, 'invalid_code');

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
export async function authenticate(env, request) {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('authorization') ?? '');
  if (!match) fail(401, 'unauthorized');
  const tokenHash = await sha256Hex(match[1]);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.device_id, s.device_label, s.last_seen_at, s.expires_at, s.revoked_at, p.id AS program_id
       FROM sessions s JOIN programs p ON p.owner_user_id = s.user_id
      WHERE s.token_hash = ?`,
  ).bind(tokenHash).first();
  const now = Date.now();
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= now) fail(401, 'unauthorized');

  if (now - Date.parse(row.last_seen_at) > SLIDE_AFTER_MS) {
    await env.DB.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .bind(new Date(now).toISOString(), new Date(now + SESSION_MS).toISOString(), tokenHash)
      .run();
  }
  return { tokenHash, userId: row.user_id, deviceId: row.device_id, deviceLabel: row.device_label, programId: row.program_id };
}

export async function signOut(env, auth) {
  await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), auth.tokenHash).run();
  return { ok: true };
}

export async function signOutOthers(env, auth) {
  const res = await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), auth.userId, auth.tokenHash).run();
  return { ok: true, revoked: res.meta.changes };
}
