// Recovering an account with no signed-in device (docs/KennelOS_Cloud_Phase1_Plan.md §2.7).
//
// The owner lost the account's email and has no device still signed in. The
// recovery code proves the account instead: it opens the vault's recovery
// wrap, and the vault key gives a check value whose hash unlocked devices saved
// (vault.js saveRecoveryCheck). The server compares hashes; it never sees the
// code or the key. The new email then waits a day in email_changes, exactly
// like a change asked for without the old inbox (emailChange.js), shown on any
// device still signed in with Cancel, and the old address is told.
//
//   POST /recover/wrap   {email}                          → {keyId, wrapped}
//   POST /recover/check  {email, check}                   → {ok: true}
//   POST /recover/email  {email, check, newEmail, code}   → {status: 'pending', effectiveAt}
//
// None of these says whether an address has an account: an address without one
// (or without a vault) gets a stand-in wrap made from its hash, which no code
// opens, so the app says "doesn't match" either way. A check that fails says
// `no_match` whether the account is missing, has no saved check yet, or the
// check is wrong. Only someone holding a code that opens the real wrap can tell
// "not set up yet" apart, by seeing the wrap open.
//
// Nothing here logs an email, a code, a check or a request body (cloud/README.md).
import { fail } from './lib/http.js';
import { hmacHex, timingSafeEqual } from './lib/crypto.js';
import { checkCode, emailHash, normalizeEmail } from './auth.js';
import { EMAIL_CHANGE_WAIT_MS } from './emailChange.js';
import { proofOf, sha256Hex } from './vault.js';
import { ipKey, limitBucket } from './ratelimit.js';
import { sendNotice } from './mail.js';

export const RECOVERY_LIMITS = { email: 20, ip: 60 };

// Per address and per caller, per UTC hour; one recovery takes three calls.
// The code is 120 bits, so this is against hammering, not guessing.
async function limit(env, request, eh) {
  await limitBucket(env, `recover:${eh}`, RECOVERY_LIMITS.email);
  await limitBucket(env, `recover-ip:${await ipKey(env, request)}`, RECOVERY_LIMITS.ip);
}

async function addressHash(env, raw) {
  const email = normalizeEmail(raw);
  if (!email) fail(400, 'bad_email');
  return { email, eh: await emailHash(env, email) };
}

// The account behind an email hash, with its vault and recovery wrap, or null.
async function findRecoverable(env, eh) {
  return env.DB.prepare(
    `SELECT u.id AS user_id, v.key_id, v.recovery_check_hash, w.wrapped
       FROM users u
       JOIN programs p ON p.owner_user_id = u.id
       JOIN vaults v ON v.program_id = p.id
       JOIN vault_wraps w ON w.program_id = p.id AND w.kind = 'recovery'
      WHERE u.email_hash = ?`,
  ).bind(eh).first();
}

// A wrap-shaped value no code opens, the same every time for one address, so
// asking twice can't tell a stand-in from a real wrap.
async function standIn(env, eh) {
  const a = await hmacHex(env.EMAIL_HMAC_KEY, `recover-standin:a:${eh}`);
  const b = await hmacHex(env.EMAIL_HMAC_KEY, `recover-standin:b:${eh}`);
  const bytes = (a + b).slice(0, 120).match(/../g).map((h) => parseInt(h, 16));
  return { keyId: b.slice(0, 32), wrapped: btoa(String.fromCharCode(...bytes)) };
}

// POST /recover/wrap {email}
export async function recoveryWrap(env, request, body) {
  const { eh } = await addressHash(env, body.email);
  await limit(env, request, eh);
  const row = await findRecoverable(env, eh);
  return row ? { keyId: row.key_id, wrapped: row.wrapped } : standIn(env, eh);
}

async function provenAccount(env, eh, check) {
  const checkHash = await sha256Hex(proofOf(check));
  const row = await findRecoverable(env, eh);
  if (!row?.recovery_check_hash || !timingSafeEqual(row.recovery_check_hash, checkHash)) fail(400, 'no_match');
  return row;
}

// POST /recover/check {email, check}: screen 1's answer, before a code is sent
// to a new address.
export async function checkRecovery(env, request, body) {
  const { eh } = await addressHash(env, body.email);
  await limit(env, request, eh);
  await provenAccount(env, eh, body.check);
  return { ok: true };
}

const whenText = (iso) => new Date(iso).toLocaleString('en-US', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
}) + ' UTC';

export function recoveryNoticeMessage(effectiveAt) {
  return {
    subject: "Your KennelOS account's email is changing",
    text: "Someone used your recovery code to change this account's email. "
      + `It takes effect on ${whenText(effectiveAt)}.\n\n`
      + 'If this wasn\'t you, sign in to KennelOS with this address before then and tap "Cancel it" on the Account card.\n',
  };
}

// POST /recover/email {email, check, newEmail, code}: the check again (nothing
// is kept between the screens), then the new address's code.
export async function requestRecoveryEmail(env, request, body) {
  const { email, eh } = await addressHash(env, body.email);
  await limit(env, request, eh);
  const row = await provenAccount(env, eh, body.check);

  const newEmail = normalizeEmail(body.newEmail);
  if (!newEmail) fail(400, 'bad_email');
  const code = String(body.code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) fail(400, 'invalid_code');
  const newHash = await emailHash(env, newEmail);
  if (newHash === eh) fail(400, 'same_email');
  // Before the code is burned, so a taken address doesn't cost a code.
  if (await env.DB.prepare('SELECT id FROM users WHERE email_hash = ?').bind(newHash).first()) fail(409, 'email_taken');
  await checkCode(env, newHash, code);

  const at = new Date();
  const effectiveAt = new Date(at.getTime() + EMAIL_CHANGE_WAIT_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO email_changes (user_id, new_email_hash, device_id, device_label, requested_at, effective_at, via)
     VALUES (?, ?, 'recovery', NULL, ?, ?, 'recovery')
     ON CONFLICT (user_id) DO UPDATE SET new_email_hash = excluded.new_email_hash, device_id = excluded.device_id,
       device_label = excluded.device_label, requested_at = excluded.requested_at, effective_at = excluded.effective_at,
       via = excluded.via`,
  ).bind(row.user_id, newHash, at.toISOString(), effectiveAt).run();

  // Tell the old address. A failed send doesn't undo the request: the wait
  // and the notice on signed-in devices still stand.
  try {
    await sendNotice(env, { email, emailHash: eh, message: recoveryNoticeMessage(effectiveAt) });
  } catch {
    console.error('recovery notice not sent');
  }
  return { status: 'pending', effectiveAt };
}
