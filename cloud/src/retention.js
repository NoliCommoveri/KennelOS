// Retention and garbage collection (plan §6.3). Run by the daily cron and by
// /ops's "Run retention now". Idempotent: it recomputes what to keep from the
// stored rows every run, so a missed or doubled run is harmless.
//
// Keep, per program:
//   - the newest committed snapshot, always;
//   - for the last 24 h, the newest in each UTC hour;
//   - from 24 h to 30 days, the newest in each UTC day;
//   - nothing older.
// Then: abandoned pending snapshots (no body after a day), files no surviving
// snapshot references (after a day's grace, so a file uploaded just before its
// snapshot is never collected), and expired codes, limits, outbox rows, sessions,
// confirmed erasures and vault pairings. A snapshot's encrypted vault part
// (Private Vault Plan §6.2) goes with it. A Pro purchase whose access ended
// more than 90 days ago is deleted (License Link Plan §4). The waitlist online
// (Waitlist W2 Plan §4): acknowledged inbox items go after 30 days, events after
// 90, and a sent email's body after 90 (its subject and date stay for her log).
//
// D1 rows go first, then R2 objects. If the R2 delete fails, the leftovers are
// unreferenced objects (harmless), never rows pointing at nothing.
import { vaultKeyFor } from './snapshots.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const KEEP_DAYS = 30;
export const PURCHASE_KEEP_DAYS = 90;
export const WL_INBOX_KEEP_DAYS = 30;
export const WL_EVENTS_KEEP_DAYS = 90;
const MAX_PER_RUN = 1000; // R2 deletes at most 1000 keys per call

// The bucket a snapshot competes in, or null once it's past the window.
function bucketOf(s, nowMs) {
  const age = nowMs - Date.parse(s.created_at);
  if (age <= DAY) return `h:${s.created_at.slice(0, 13)}`;
  if (age <= KEEP_DAYS * DAY) return `d:${s.created_at.slice(0, 10)}`;
  return null;
}

// Pure: which committed snapshots to drop. `snapshots` is [{id, program_id, created_at}].
// Walking newest-first, the first snapshot in each bucket is kept; the newest
// overall is kept even when it's older than the window.
export function pickDrops(snapshots, nowMs) {
  const byProgram = new Map();
  for (const s of snapshots) {
    if (!byProgram.has(s.program_id)) byProgram.set(s.program_id, []);
    byProgram.get(s.program_id).push(s);
  }
  const drops = [];
  for (const list of byProgram.values()) {
    list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const seen = new Set();
    list.forEach((s, i) => {
      const bucket = bucketOf(s, nowMs);
      if (i > 0 && (bucket === null || seen.has(bucket))) drops.push(s);
      else seen.add(bucket);
    });
  }
  return drops;
}

export async function runRetention(env, now = new Date()) {
  const nowMs = now.getTime();
  const iso = (ms) => new Date(ms).toISOString();
  const summary = { snapshotsDropped: 0, pendingDropped: 0, filesDropped: 0, r2Deleted: 0 };

  const { results: committed } = await env.DB.prepare(
    `SELECT id, program_id, created_at, r2_key FROM snapshots WHERE status = 'committed'`,
  ).all();
  const { results: stale } = await env.DB.prepare(
    `SELECT id, r2_key FROM snapshots WHERE status = 'pending' AND created_at < ?`,
  ).bind(iso(nowMs - DAY)).all();

  const drops = pickDrops(committed, nowMs).slice(0, MAX_PER_RUN);
  const stalePart = stale.slice(0, MAX_PER_RUN - drops.length);
  const gone = [...drops, ...stalePart];
  if (gone.length) {
    const ids = JSON.stringify(gone.map((s) => s.id));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM snapshot_files WHERE snapshot_id IN (SELECT value FROM json_each(?))').bind(ids),
      env.DB.prepare('DELETE FROM snapshots WHERE id IN (SELECT value FROM json_each(?))').bind(ids),
    ]);
    // Body and vault part per snapshot; R2 deletes at most 1000 keys a call.
    // Deleting a vault key that was never written is a no-op.
    const keys = gone.flatMap((s) => [s.r2_key, vaultKeyFor(s.r2_key)]);
    for (let i = 0; i < keys.length; i += MAX_PER_RUN) await env.FILES.delete(keys.slice(i, i + MAX_PER_RUN));
    summary.snapshotsDropped = drops.length;
    summary.pendingDropped = stalePart.length;
    summary.r2Deleted += gone.length;
  }

  const { results: orphans } = await env.DB.prepare(
    `SELECT f.program_id, f.sha256 FROM files f
      WHERE f.created_at < ?
        AND NOT EXISTS (SELECT 1 FROM snapshot_files sf JOIN snapshots s ON s.id = sf.snapshot_id
                         WHERE s.program_id = f.program_id AND sf.sha256 = f.sha256)
      LIMIT ${MAX_PER_RUN}`,
  ).bind(iso(nowMs - DAY)).all();
  if (orphans.length) {
    const keys = orphans.map((o) => `${o.program_id}/${o.sha256}`);
    await env.DB.prepare(`DELETE FROM files WHERE program_id || '/' || sha256 IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(keys)).run();
    await env.FILES.delete(keys.map((k) => `files/${k}`));
    summary.filesDropped = orphans.length;
    summary.r2Deleted += orphans.length;
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_codes WHERE expires_at < ?').bind(iso(nowMs)),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(iso(nowMs - DAY)),
    env.DB.prepare('DELETE FROM dev_outbox WHERE created_at < ?').bind(iso(nowMs - HOUR)),
    // A device with an erase still pending keeps its sessions, however old, so
    // the erase lands whenever it turns up (plan §2.5).
    env.DB.prepare(
      `DELETE FROM sessions WHERE (expires_at < ? OR revoked_at < ?)
         AND NOT EXISTS (SELECT 1 FROM device_erasures e
                          WHERE e.user_id = sessions.user_id AND e.device_id = sessions.device_id AND e.confirmed_at IS NULL)`,
    ).bind(iso(nowMs), iso(nowMs - KEEP_DAYS * DAY)),
    env.DB.prepare('DELETE FROM device_erasures WHERE confirmed_at < ?').bind(iso(nowMs - KEEP_DAYS * DAY)),
    env.DB.prepare('DELETE FROM vault_pairings WHERE expires_at < ?').bind(iso(nowMs)),
    env.DB.prepare('DELETE FROM license_link_codes WHERE expires_at < ?').bind(iso(nowMs)),
    env.DB.prepare('DELETE FROM pro_purchases WHERE access_until < ?').bind(iso(nowMs - PURCHASE_KEEP_DAYS * DAY)),
    env.DB.prepare('DELETE FROM wl_inbox WHERE acked_at < ?').bind(iso(nowMs - WL_INBOX_KEEP_DAYS * DAY)),
    env.DB.prepare('DELETE FROM wl_events WHERE created_at < ?').bind(iso(nowMs - WL_EVENTS_KEEP_DAYS * DAY)),
    env.DB.prepare(`UPDATE wl_messages SET body = NULL WHERE status = 'sent' AND body IS NOT NULL AND sent_at < ?`).bind(iso(nowMs - WL_EVENTS_KEEP_DAYS * DAY)),
  ]);

  return summary;
}
