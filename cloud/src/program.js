// The program (one per user in Phase 1): its state, the takeover, and deleting
// the account (plan §2.4, §3.4, §6.1).
import { fail } from './lib/http.js';
import { sha256Hex } from './lib/crypto.js';
import { backingInfo } from './snapshots.js';
import { requireFreshSignIn } from './auth.js';
import { deleteWaitlistStatements } from './waitlist.js';
import { deleteIntegrationStatements, revokeAllConnections } from './integrations.js';
import { deleteNotifyStatements } from './notify.js';

export async function getProgram(env, auth) {
  const program = await env.DB.prepare('SELECT id, backing_device_id, latest_snapshot_id FROM programs WHERE id = ?').bind(auth.programId).first();
  let latestSnapshot = null;
  if (program.latest_snapshot_id) {
    const s = await env.DB.prepare('SELECT id, created_at, size, counts_json FROM snapshots WHERE id = ?').bind(program.latest_snapshot_id).first();
    if (s) latestSnapshot = { id: s.id, createdAt: s.created_at, size: s.size, counts: JSON.parse(s.counts_json) };
  }
  return { programId: program.id, thisDeviceId: auth.deviceId, ...(await backingInfo(env, program)), latestSnapshot };
}

// POST /program/backing-device: this device becomes the one that backs up. The
// client then pushes with base = latestSnapshotId (or restores that first).
export async function takeOver(env, auth) {
  await env.DB.prepare('UPDATE programs SET backing_device_id = ? WHERE id = ?').bind(auth.deviceId, auth.programId).run();
  return getProgram(env, auth);
}

// --- Deleting an account for a user who asked (/ops and the manager app) ----------
// Both doors look the account up first and show what only that account has, then
// delete against a fingerprint of what was shown: a delete whose account changed
// since the look (another device synced, a backup landed, a device signed in) is
// refused and looked up again (review K04-6, K05-2).

const count = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).first('n')) ?? 0;

// What deleting an account would take: its devices, what the cloud holds, and
// whether support set it up. Counts, dates and device names only; the email is
// never stored, so never shown back (maskEmail echoes what the operator typed).
export async function accountSummary(env, user) {
  const program = await env.DB.prepare('SELECT id, latest_snapshot_id FROM programs WHERE owner_user_id = ?').bind(user.id).first();
  const p = program?.id ?? '';
  const { results: devices } = await env.DB.prepare(
    `SELECT device_id, MAX(device_label) AS label, MAX(last_seen_at) AS last_seen,
            SUM(CASE WHEN revoked_at IS NULL AND expires_at > ? THEN 1 ELSE 0 END) AS live,
            MAX(CASE WHEN role = 'helper' THEN 1 ELSE 0 END) AS helper
       FROM sessions WHERE user_id = ? GROUP BY device_id ORDER BY last_seen DESC`,
  ).bind(new Date().toISOString(), user.id).all();
  const latest = program?.latest_snapshot_id
    ? await env.DB.prepare('SELECT id, created_at, size, counts_json FROM snapshots WHERE id = ?').bind(program.latest_snapshot_id).first()
    : null;
  let latestCounts = null;
  try { latestCounts = latest ? JSON.parse(latest.counts_json) : null; } catch { /* shown as unknown */ }
  const assist = p ? await env.DB.prepare('SELECT label, state FROM assist_programs WHERE program_id = ?').bind(p).first() : null;
  return {
    userId: user.id,
    programId: p,
    createdAt: user.created_at,
    devices: devices.map((d) => ({ deviceId: d.device_id, label: d.label, lastSeen: d.last_seen, live: d.live > 0, helper: d.helper === 1 })),
    snapshots: await count(env, "SELECT COUNT(*) AS n FROM snapshots WHERE program_id = ? AND status = 'committed'", p),
    latestSnapshot: latest ? { id: latest.id, createdAt: latest.created_at, size: latest.size, counts: latestCounts } : null,
    records: await count(env, 'SELECT COUNT(*) AS n FROM sync_records WHERE program_id = ?', p),
    vault: !!(await env.DB.prepare('SELECT 1 AS x FROM vaults WHERE program_id = ?').bind(p).first()),
    passkeys: await count(env, "SELECT COUNT(*) AS n FROM vault_wraps WHERE program_id = ? AND kind = 'passkey'", p),
    waitlist: await count(env, 'SELECT COUNT(*) AS n FROM wl_projection WHERE program_id = ?', p),
    assist: assist ? { label: assist.label, state: assist.state } : null,
  };
}

// A hash of everything accountSummary shows, so the delete can check it is still
// the account that was looked at.
export async function summaryFingerprint(s) {
  return sha256Hex(JSON.stringify([
    s.userId, s.programId, s.createdAt, s.devices.map((d) => [d.deviceId, d.lastSeen, d.live]),
    s.snapshots, s.latestSnapshot?.id ?? null, s.records, s.vault, s.passkeys, s.waitlist,
  ]));
}

// "dana@example.com" → "d•••a@e•••.com": what the operator typed, shown back so a
// slip is visible, without the page holding the address.
export function maskEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return '';
  const part = (x) => (x.length <= 2 ? `${x[0] ?? ''}•••` : `${x[0]}•••${x[x.length - 1]}`);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return `${part(email.slice(0, at))}@${dot > 0 ? `${part(domain.slice(0, dot))}${domain.slice(dot)}` : part(domain)}`;
}

async function deletePrefix(bucket, prefix) {
  let cursor;
  let deleted = 0;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    const keys = page.objects.map((o) => o.key);
    if (keys.length) await bucket.delete(keys);
    deleted += keys.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

// DELETE /account {confirm: "DELETE", email?, code?}. Needs a fresh sign-in
// (auth.js), so a stolen phone can't take the owner's cloud copy with it. The
// device's own data is untouched; her other devices hear account_deleted.
export async function deleteAccount(env, auth, body) {
  if (body.confirm !== 'DELETE') fail(400, 'confirm_required');
  await requireFreshSignIn(env, auth, body);
  // This device signs itself out; only her other devices need telling.
  await removeAccount(env, { userId: auth.userId, programId: auth.programId }, { except: auth.tokenHash });
  return { ok: true };
}

// Everything of one account, for DELETE /account and for /ops (a user who asked).
// Snapshots (with their
// vault parts), files, the vault's wraps and pairings, everything of the waitlist
// online (published lists, status links, inbox, events, holds, emails), her vendor
// connections (revoked at each vendor first) and their events, her notification
// settings (the digest's address with them) and alert subscriptions, sessions, the program
// and the user all go. Each session's token hash is kept in account_deletions
// (migration 0020), so a device that turns up later hears account_deleted (with
// `erase`, it wipes itself) rather than a plain sign-out.
export async function removeAccount(env, { userId, programId }, { erase = false, except = '' } = {}) {
  const p = programId;
  await revokeAllConnections(env, p); // her vendor tokens, at each vendor (best effort)
  await deletePrefix(env.FILES, `snapshots/${p}/`);
  await deletePrefix(env.FILES, `files/${p}/`);
  await deletePrefix(env.FILES, `esign/${p}/`); // signed copies KennelOS kept (firma.js, D33)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM snapshot_files WHERE snapshot_id IN (SELECT id FROM snapshots WHERE program_id = ?)').bind(p),
    env.DB.prepare('DELETE FROM snapshots WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM files WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM vault_wraps WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM vault_pairings WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM vault_handoffs WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM email_changes WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM vaults WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM sync_records WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM sync_devices WHERE program_id = ?').bind(p),
    ...deleteWaitlistStatements(env, p),
    ...deleteIntegrationStatements(env, p),
    ...deleteNotifyStatements(env, p),
    env.DB.prepare('DELETE FROM assist_links WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM assist_events WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM assist_programs WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM programs WHERE id = ?').bind(p),
    env.DB.prepare('INSERT OR REPLACE INTO account_deletions (token_hash, erase, deleted_at) SELECT token_hash, ?, ? FROM sessions WHERE user_id = ? AND token_hash <> ?')
      .bind(erase ? 1 : 0, new Date().toISOString(), userId, except),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM device_erasures WHERE user_id = ?').bind(userId),
    // Linked purchase emails go; pro_purchases stay (the store's facts about an
    // email hash, not this account's data; License Link Plan §4).
    env.DB.prepare('DELETE FROM license_links WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM license_link_codes WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM login_codes WHERE email_hash = (SELECT email_hash FROM users WHERE id = ?)').bind(userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}
