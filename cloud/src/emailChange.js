// Changing the account's email (docs/KennelOS_Cloud_Phase1_Plan.md §2.6).
//
// The account is its email's keyed hash, so a change swaps users.email_hash.
// The new address is proven by a sign-in code sent to it (/auth/start, then
// its code here). The old one is the hard part: an owner who still gets mail
// there proves it with a code (or a sign-in under 15 minutes old, which took
// one), and the change happens at once. One who lost it can still ask, from a
// signed-in device; the change then waits a day, shown on every signed-in
// device with Cancel, so a borrowed, unlocked phone can't quietly take the
// account. The old address stays a linked purchase email, so a Pro purchase
// made with it still counts.
//
//   GET    /account/email   { pending: {requestedAt, effectiveAt, deviceLabel} | null, changedAt }
//   POST   /account/email   {email, code, oldEmail?, oldCode?} → {status: 'changed'} | {status: 'pending', effectiveAt}
//   DELETE /account/email   cancel a pending change (any signed-in device)
//
// Nothing here logs an email, a code or a request body (cloud/README.md).
import { fail } from './lib/http.js';
import { checkCode, emailHash, normalizeEmail, FRESH_SIGN_IN_MS } from './auth.js';

export const EMAIL_CHANGE_WAIT_MS = 24 * 60 * 60 * 1000;

const nowIso = () => new Date().toISOString();

// Applies a change whose wait is over. The new hash may have been taken in the
// meantime (someone signed up with it): then the change is dropped.
async function applyChange(env, userId, newHash, at = nowIso()) {
  const user = await env.DB.prepare('SELECT email_hash FROM users WHERE id = ?').bind(userId).first();
  if (!user) return false;
  const taken = await env.DB.prepare('SELECT id FROM users WHERE email_hash = ? AND id <> ?').bind(newHash, userId).first();
  if (taken) {
    await env.DB.prepare('DELETE FROM email_changes WHERE user_id = ?').bind(userId).run();
    return false;
  }
  await env.DB.batch([
    // Keep the old address's Pro purchases with the account (License Link Plan §5).
    env.DB.prepare('INSERT OR IGNORE INTO license_links (user_id, email_hash, linked_at) VALUES (?, ?, ?)').bind(userId, user.email_hash, at),
    env.DB.prepare('DELETE FROM license_links WHERE user_id = ? AND email_hash = ?').bind(userId, newHash),
    env.DB.prepare('UPDATE users SET email_hash = ?, email_changed_at = ? WHERE id = ?').bind(newHash, at, userId),
    env.DB.prepare('DELETE FROM email_changes WHERE user_id = ?').bind(userId),
  ]);
  return true;
}

// The account's own change, if its wait is over. Called before any read, so a
// device sees the outcome even if the hourly run hasn't happened yet.
export async function applyDueEmailChange(env, userId) {
  const due = await env.DB.prepare('SELECT new_email_hash FROM email_changes WHERE user_id = ? AND effective_at <= ?')
    .bind(userId, nowIso()).first();
  if (due) await applyChange(env, userId, due.new_email_hash);
}

// The hourly run (index.js): every change whose wait is over.
export async function applyDueEmailChanges(env) {
  const { results } = await env.DB.prepare('SELECT user_id, new_email_hash FROM email_changes WHERE effective_at <= ?').bind(nowIso()).all();
  let applied = 0;
  for (const r of results) if (await applyChange(env, r.user_id, r.new_email_hash)) applied++;
  return { applied, dropped: results.length - applied };
}

// What check-in and the Account card show.
export async function emailChangeState(env, auth) {
  await applyDueEmailChange(env, auth.userId);
  const row = await env.DB.prepare(
    `SELECT u.email_changed_at, c.requested_at, c.effective_at, c.device_label
       FROM users u LEFT JOIN email_changes c ON c.user_id = u.id WHERE u.id = ?`,
  ).bind(auth.userId).first();
  return {
    pending: row?.requested_at ? { requestedAt: row.requested_at, effectiveAt: row.effective_at, deviceLabel: row.device_label } : null,
    changedAt: row?.email_changed_at ?? null,
  };
}

export async function getEmailChange(env, auth) {
  return emailChangeState(env, auth);
}

// POST /account/email {email, code, oldEmail?, oldCode?}
export async function requestEmailChange(env, auth, body) {
  const email = normalizeEmail(body.email);
  if (!email) fail(400, 'bad_email');
  const code = String(body.code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) fail(400, 'invalid_code');
  const newHash = await emailHash(env, email);
  const user = await env.DB.prepare('SELECT email_hash FROM users WHERE id = ?').bind(auth.userId).first();
  if (!user) fail(401, 'unauthorized');
  if (user.email_hash === newHash) fail(400, 'same_email');
  // Before the code is burned, so a taken address doesn't cost a code.
  if (await env.DB.prepare('SELECT id FROM users WHERE email_hash = ?').bind(newHash).first()) fail(409, 'email_taken');

  // The old inbox, when they can still prove it: checked first, so a wrong old
  // code fails before the new one is spent.
  let proven = Date.now() - Date.parse(auth.createdAt) <= FRESH_SIGN_IN_MS;
  if (!proven && body.oldCode != null && body.oldCode !== '') {
    const oldEmail = normalizeEmail(body.oldEmail);
    const oldCode = String(body.oldCode).replace(/\s/g, '');
    if (!oldEmail || !/^\d{6}$/.test(oldCode)) fail(400, 'invalid_old_code');
    const oldHash = await emailHash(env, oldEmail);
    if (oldHash !== user.email_hash) fail(400, 'invalid_old_code');
    try { await checkCode(env, oldHash, oldCode); } catch (err) {
      fail(400, err?.code === 'too_many_attempts' ? 'too_many_attempts' : 'invalid_old_code');
    }
    proven = true;
  }
  await checkCode(env, newHash, code);

  const at = nowIso();
  if (proven) {
    if (!(await applyChange(env, auth.userId, newHash, at))) fail(409, 'email_taken');
    return { status: 'changed' };
  }
  const effectiveAt = new Date(Date.now() + EMAIL_CHANGE_WAIT_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO email_changes (user_id, new_email_hash, device_id, device_label, requested_at, effective_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET new_email_hash = excluded.new_email_hash, device_id = excluded.device_id,
       device_label = excluded.device_label, requested_at = excluded.requested_at, effective_at = excluded.effective_at`,
  ).bind(auth.userId, newHash, auth.deviceId, auth.deviceLabel, at, effectiveAt).run();
  return { status: 'pending', effectiveAt };
}

// DELETE /account/email: from any signed-in device.
export async function cancelEmailChange(env, auth) {
  await env.DB.prepare('DELETE FROM email_changes WHERE user_id = ?').bind(auth.userId).run();
  return { ok: true };
}
