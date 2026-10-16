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
// (Waitlist W2 Plan §4): an inbox item (an application or family message) is the
// server's delivery copy, kept until her device has it AND it's safe in a private
// backup: acknowledged at least 30 days ago and a committed snapshot WITH a vault
// part made after the acknowledgement. Without private backup it stays (her
// device's copy is then the only other one), and an unacknowledged item is never
// purged. Events go after 90 days, and a sent email's body after 90 (its subject
// and date stay for her log).
//
// D1 rows go first, then R2 objects. If the R2 delete fails, the leftovers are
// unreferenced objects, never rows pointing at nothing; the orphan sweep at the
// end of every run (sweepR2Orphans) finds and deletes them.
import { syncRetentionStatements } from './sync.js';
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
  const summary = { snapshotsDropped: 0, pendingDropped: 0, filesDropped: 0, r2Deleted: 0, r2Untracked: 0 };

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
        -- A synced document's bytes stay while its record does (Phase 2 plan §4.1).
        AND NOT EXISTS (SELECT 1 FROM sync_records r
                         WHERE r.program_id = f.program_id AND r.file_sha256 = f.sha256 AND r.deleted = 0)
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

  Object.assign(summary, await sweepR2Orphans(env, nowMs));

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
    env.DB.prepare('DELETE FROM vault_handoffs WHERE expires_at < ?').bind(iso(nowMs)),
    env.DB.prepare('DELETE FROM license_link_codes WHERE expires_at < ?').bind(iso(nowMs)),
    env.DB.prepare('DELETE FROM pro_purchases WHERE access_until < ?').bind(iso(nowMs - PURCHASE_KEEP_DAYS * DAY)),
    env.DB.prepare(
      `DELETE FROM wl_inbox WHERE acked_at < ?
         AND EXISTS (SELECT 1 FROM snapshots s
                      WHERE s.program_id = wl_inbox.program_id AND s.status = 'committed'
                        AND s.vault_key_id IS NOT NULL AND s.created_at > wl_inbox.acked_at)`,
    ).bind(iso(nowMs - WL_INBOX_KEEP_DAYS * DAY)),
    env.DB.prepare('DELETE FROM wl_events WHERE created_at < ?').bind(iso(nowMs - WL_EVENTS_KEEP_DAYS * DAY)),
    // Integration events, like the waitlist's: 90 days (Integrations plan §0).
    env.DB.prepare('DELETE FROM int_events WHERE created_at < ?').bind(iso(nowMs - WL_EVENTS_KEEP_DAYS * DAY)),
    env.DB.prepare('DELETE FROM wl_family_codes WHERE expires_at < ?').bind(iso(nowMs)),
    // An application never confirmed by its emailed code goes after two days, with its link.
    env.DB.prepare(
      `DELETE FROM wl_tokens WHERE entry_id IN (SELECT id FROM wl_inbox WHERE kind = 'application' AND confirmed_at IS NULL AND created_at < ?)`,
    ).bind(iso(nowMs - 2 * DAY)),
    env.DB.prepare(`DELETE FROM wl_inbox WHERE kind = 'application' AND confirmed_at IS NULL AND created_at < ?`).bind(iso(nowMs - 2 * DAY)),
    env.DB.prepare('DELETE FROM wl_family_sessions WHERE expires_at < ?').bind(iso(nowMs)),
    // Live sync (Phase 2 plan §6.3): old tombstones, and records of sync turned off a while ago.
    ...syncRetentionStatements(env, nowMs),
    env.DB.prepare(`UPDATE wl_messages SET body = NULL WHERE status = 'sent' AND body IS NOT NULL AND sent_at < ?`).bind(iso(nowMs - WL_EVENTS_KEEP_DAYS * DAY)),
  ]);

  return summary;
}

// --- The R2 orphan sweep ----------------------------------------------------------
// An object nothing in D1 tracks (an R2 delete above that failed after its rows
// went, or an upload whose row never landed) can't be reached through the API, so
// it's deleted. The bucket is walked a few pages a run, carrying on from where the
// last run stopped (r2_sweep, migration 0017), so a big bucket is covered over
// several days at a bounded cost per run. Safe by construction:
//   - only the two shapes the Worker writes: files/<program>/<sha256> (tracked by
//     `files`) and snapshots/<program>/<id>.json.gz | .vault (tracked by
//     `snapshots`, any status); any other key is left alone;
//   - only for a program D1 knows, so an emptied or restored D1 (backup.js
//     imports D1 back over a bucket that still holds the objects) deletes nothing;
//   - only objects uploaded more than a day ago, so an upload whose row is a
//     moment behind (files.js writes R2 first) is never caught mid-way;
//   - a run that finds more than SWEEP_HALT_AT deletes none of them and stays
//     where it was: that many means D1 isn't the bucket's index right now
//     (a restore, a bug), which is for a person to look at, not to "fix".
export const SWEEP_PAGES = 10;
export const SWEEP_HALT_AT = 1000;
const FILE_KEY = /^files\/([^/]+)\/([0-9a-f]{64})$/;
const SNAPSHOT_KEY = /^snapshots\/([^/]+)\/([^/]+)\.(?:json\.gz|vault)$/;

function parseKey(key) {
  let m = FILE_KEY.exec(key);
  if (m) return { k: key, kind: 'file', p: m[1], x: m[2] };
  m = SNAPSHOT_KEY.exec(key);
  if (m) return { k: key, kind: 'snapshot', p: m[1], x: m[2] };
  return null;
}

// The keys among `keys` nothing in D1 tracks (one query, one bound parameter).
async function untrackedKeys(env, keys) {
  const parsed = keys.map(parseKey).filter(Boolean);
  if (!parsed.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT json_extract(j.value, '$.k') AS key FROM json_each(?) j
      WHERE EXISTS (SELECT 1 FROM programs p WHERE p.id = json_extract(j.value, '$.p'))
        AND NOT (json_extract(j.value, '$.kind') = 'file' AND EXISTS (SELECT 1 FROM files f
              WHERE f.program_id = json_extract(j.value, '$.p') AND f.sha256 = json_extract(j.value, '$.x')))
        AND NOT (json_extract(j.value, '$.kind') = 'snapshot' AND EXISTS (SELECT 1 FROM snapshots s
              WHERE s.id = json_extract(j.value, '$.x') AND s.program_id = json_extract(j.value, '$.p')))`,
  ).bind(JSON.stringify(parsed)).all();
  return results.map((r) => r.key);
}

// → { r2Untracked: objects deleted, r2SweepHalted?: how many it found instead }.
export async function sweepR2Orphans(env, nowMs = Date.now(), { pages = SWEEP_PAGES, pageSize = MAX_PER_RUN } = {}) {
  const iso = (ms) => new Date(ms).toISOString();
  const state = await env.DB.prepare('SELECT cursor, pass_started_at FROM r2_sweep WHERE id = 1').first();
  let cursor = state?.cursor || undefined;
  const passStarted = state?.pass_started_at || iso(nowMs);
  let passDone = false;
  const found = [];
  for (let i = 0; i < pages; i++) {
    const page = await env.FILES.list({ cursor, limit: pageSize });
    const settled = page.objects.filter((o) => o.uploaded && nowMs - new Date(o.uploaded).getTime() > DAY);
    found.push(...await untrackedKeys(env, settled.map((o) => o.key)));
    if (!page.truncated) { passDone = true; cursor = undefined; break; }
    cursor = page.cursor;
  }
  if (found.length > SWEEP_HALT_AT) {
    console.log('r2 sweep halted', JSON.stringify({ untracked: found.length }));
    return { r2Untracked: 0, r2SweepHalted: found.length };
  }
  for (let i = 0; i < found.length; i += MAX_PER_RUN) await env.FILES.delete(found.slice(i, i + MAX_PER_RUN));
  await env.DB.prepare(
    `INSERT INTO r2_sweep (id, cursor, pass_started_at, last_pass_at) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET cursor = excluded.cursor, pass_started_at = excluded.pass_started_at,
       last_pass_at = COALESCE(excluded.last_pass_at, r2_sweep.last_pass_at)`,
  ).bind(cursor ?? null, passDone ? null : passStarted, passDone ? iso(nowMs) : null).run();
  return { r2Untracked: found.length };
}
