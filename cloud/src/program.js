// The program (one per user in Phase 1): its state, the takeover, and deleting
// the account (plan §2.4, §3.4, §6.1).
import { fail } from './lib/http.js';
import { backingInfo } from './snapshots.js';
import { requireFreshSignIn } from './auth.js';

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

// DELETE /account {confirm: "DELETE", email?, code?}. Snapshots (with their
// vault parts), files, the vault's wraps and pairings, sessions, the program
// and the user all go. The device's own data is
// untouched. Needs a fresh sign-in (auth.js), so a stolen phone can't take the
// owner's cloud copy with it.
export async function deleteAccount(env, auth, body) {
  if (body.confirm !== 'DELETE') fail(400, 'confirm_required');
  await requireFreshSignIn(env, auth, body);
  const p = auth.programId;
  await deletePrefix(env.FILES, `snapshots/${p}/`);
  await deletePrefix(env.FILES, `files/${p}/`);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM snapshot_files WHERE snapshot_id IN (SELECT id FROM snapshots WHERE program_id = ?)').bind(p),
    env.DB.prepare('DELETE FROM snapshots WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM files WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM vault_wraps WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM vault_pairings WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM vaults WHERE program_id = ?').bind(p),
    env.DB.prepare('DELETE FROM programs WHERE id = ?').bind(p),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM device_erasures WHERE user_id = ?').bind(auth.userId),
    // Linked purchase emails go; pro_purchases stay (the store's facts about an
    // email hash, not this account's data; License Link Plan §4).
    env.DB.prepare('DELETE FROM license_links WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM license_link_codes WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM login_codes WHERE email_hash = (SELECT email_hash FROM users WHERE id = ?)').bind(auth.userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(auth.userId),
  ]);
  return { ok: true };
}
