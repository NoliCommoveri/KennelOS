// Live sync, the server side (docs/KennelOS_Cloud_Phase2_Sync_Plan.md §6).
//
// One row per record in sync_records, each version numbered from the program's
// sync_seq. A push bumps sync_seq by its count and upserts its records in ONE
// D1 batch (one transaction), so no two versions share a seq and a pull in seq
// order never misses one. Whoever's version the server receives last wins
// (plan §12 decision 3); a push whose base_seq is older than the stored version
// is accepted and reported back as `superseded`.
//
// The server can read only each record's cloud part, the same allow-listed
// fields every snapshot already holds (checked here against CLOUD_FIELDS, a
// generated copy of the app's registry); the sealed part is the whole row under
// the vault key, which it can't open.
//
//   POST   /sync/enable                      turn sync on for the program (needs the vault)
//   DELETE /sync {email?, code?}             turn it off for every device (fresh sign-in)
//   GET    /sync/head                        { enabled, seq, keyId }
//   POST   /sync/push {records}              → { seq, accepted, superseded, dropped }
//   GET    /sync/pull?since=&limit=          → { records, seq, more }; 410 resync_required
//   POST   /sync/cursor {seq}                this device's applied cursor
//
// Every route needs Pro (requirePro) and is rate-limited per program. Nothing
// here logs a record, a payload or a request body (cloud/README.md).
import { fail } from './lib/http.js';
import { requireFreshSignIn } from './auth.js';
import { requirePro } from './license.js';
import { loadVault, KEY_ID } from './vault.js';
import { limitBucket } from './ratelimit.js';
import { SHA256 } from './files.js';
import { CLOUD_FIELDS } from './lib/cloudFields.js';

export const SYNC_LIMITS = { callsPerHour: 1200 };
export const MAX_PUSH_RECORDS = 200;
export const MAX_PUSH_BYTES = 4 * 1024 * 1024;
export const MAX_RECORD_BYTES = 1024 * 1024;
export const MAX_PULL_RECORDS = 500;
const MAX_PULL_BYTES = 4 * 1024 * 1024;
export const TOMBSTONE_KEEP_DAYS = 90;
export const SYNC_OFF_KEEP_DAYS = 30;
const ROW_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

const nowIso = () => new Date().toISOString();

async function loadSyncProgram(env, programId) {
  return env.DB.prepare('SELECT id, sync_enabled_at, sync_seq, sync_purged_seq FROM programs WHERE id = ?').bind(programId).first();
}

// Every sync route starts here: Pro, the rate limit, and the program.
async function begin(env, auth) {
  await requirePro(env, auth);
  await limitBucket(env, `sync:${auth.programId}`, SYNC_LIMITS.callsPerHour);
  return loadSyncProgram(env, auth.programId);
}

function requireOn(program) {
  if (!program?.sync_enabled_at) fail(409, 'sync_off');
}

// --- Turning it on and off (plan §2.1, §2.4) ------------------------------------
export async function enableSync(env, auth) {
  const program = await begin(env, auth);
  const vault = await loadVault(env, auth.programId);
  if (!vault) fail(409, 'vault_required');
  if (!program.sync_enabled_at) {
    await env.DB.prepare('UPDATE programs SET sync_enabled_at = ?, sync_disabled_at = NULL WHERE id = ?').bind(nowIso(), auth.programId).run();
  }
  return syncHead(env, auth, { skipChecks: true });
}

// DELETE /sync {email?, code?}: for every device. The records stay 30 days
// (turning it back on is quick), then retention deletes them.
export async function disableSync(env, auth, body) {
  // No Pro check: a lapsed license must still be able to turn sync off.
  await limitBucket(env, `sync:${auth.programId}`, SYNC_LIMITS.callsPerHour);
  await requireFreshSignIn(env, auth, body);
  await env.DB.prepare('UPDATE programs SET sync_enabled_at = NULL, sync_disabled_at = ? WHERE id = ? AND sync_enabled_at IS NOT NULL')
    .bind(nowIso(), auth.programId).run();
  return { ok: true };
}

// GET /sync/head: what the 60-second poll asks (plan §5.2).
export async function syncHead(env, auth, { skipChecks = false } = {}) {
  const program = skipChecks ? await loadSyncProgram(env, auth.programId) : await begin(env, auth);
  const vault = await loadVault(env, auth.programId);
  return { enabled: Boolean(program.sync_enabled_at), seq: program.sync_seq, keyId: vault?.key_id ?? null };
}

// --- Checking one record ----------------------------------------------------------
const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

// The reason a cloud part isn't allowed, or null. Top-level keys against the
// table's list; a nested-filtered field (waitlist_entries.application,
// events.details) against its own keys.
export function cloudPartProblem(tbl, cloud) {
  if (cloud === null) return null;
  if (!isPlainObject(cloud)) return 'cloud_not_object';
  const spec = CLOUD_FIELDS.tables[tbl];
  const allowed = new Set(spec.keys);
  for (const [key, value] of Object.entries(cloud)) {
    if (!allowed.has(key)) return `cloud_key:${key}`;
    let nested = spec.nested[key] || null;
    if (tbl === 'events' && key === 'details') nested = CLOUD_FIELDS.eventDetails[cloud.event_type] || [];
    if (!nested || value == null) continue;
    if (!isPlainObject(value)) return `cloud_key:${key}`;
    const inner = new Set(nested);
    for (const k of Object.keys(value)) if (!inner.has(k)) return `cloud_key:${key}.${k}`;
  }
  if (cloud.id !== undefined && cloud.id !== null && typeof cloud.id !== 'string') return 'cloud_key:id';
  return null;
}

// → { ok: record } or { problem }; a malformed push as a whole is a 400 instead.
function checkRecord(r, vault) {
  if (!isPlainObject(r)) fail(400, 'bad_record');
  if (typeof r.tbl !== 'string' || !CLOUD_FIELDS.tables[r.tbl]) fail(400, 'bad_table');
  if (typeof r.id !== 'string' || !ROW_ID.test(r.id)) fail(400, 'bad_id');
  if (r.op !== 'put' && r.op !== 'delete') fail(400, 'bad_op');
  const baseSeq = r.base_seq ?? 0;
  if (!Number.isInteger(baseSeq) || baseSeq < 0) fail(400, 'bad_base_seq');
  if (r.op === 'delete') return { ok: { tbl: r.tbl, id: r.id, op: 'delete', baseSeq } };

  if (JSON.stringify(r).length > MAX_RECORD_BYTES) return { problem: 'too_large' };
  if (typeof r.sealed !== 'string' || !r.sealed || !B64.test(r.sealed)) fail(400, 'bad_sealed');
  if (typeof r.key_id !== 'string' || !KEY_ID.test(r.key_id)) fail(400, 'bad_key_id');
  // A stale key is the whole push's problem: the device must unlock with the new one.
  if (r.key_id !== vault.key_id) fail(409, 'vault_key_stale', { keyId: vault.key_id });
  const cloud = r.cloud ?? null;
  const problem = cloudPartProblem(r.tbl, cloud);
  if (problem) return { problem };
  if (cloud && cloud.id !== undefined && cloud.id !== r.id) return { problem: 'cloud_key:id' };
  let file = null;
  if (r.tbl === 'files' && r.file != null) {
    if (typeof r.file !== 'string' || !SHA256.test(r.file)) fail(400, 'bad_file');
    file = r.file;
  }
  return { ok: { tbl: r.tbl, id: r.id, op: 'put', baseSeq, cloud, sealed: r.sealed, keyId: r.key_id, file } };
}

// --- Push (plan §5.1, §6.1) --------------------------------------------------------
export async function pushRecords(env, auth, body) {
  const program = await begin(env, auth);
  requireOn(program);
  const vault = await loadVault(env, auth.programId);
  if (!vault) fail(409, 'vault_required');
  if (!Array.isArray(body.records) || body.records.length > MAX_PUSH_RECORDS) fail(400, 'bad_records');

  const records = [];
  const dropped = [];
  const seen = new Set();
  for (const raw of body.records) {
    const { ok, problem } = checkRecord(raw, vault);
    const key = `${raw.tbl}/${raw.id}`;
    if (seen.has(key)) fail(400, 'duplicate_record');
    seen.add(key);
    if (problem) dropped.push({ tbl: raw.tbl, id: raw.id, reason: problem });
    else records.push(ok);
  }
  if (!records.length) return { seq: program.sync_seq, accepted: [], superseded: [], dropped };

  // Every file a record names must already be uploaded (HEAD/PUT /files first).
  const files = [...new Set(records.map((r) => r.file).filter(Boolean))];
  if (files.length) {
    const { results: missing } = await env.DB.prepare(
      `SELECT j.value AS sha256 FROM json_each(?) j
        WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.program_id = ? AND f.sha256 = j.value)`,
    ).bind(JSON.stringify(files), auth.programId).all();
    if (missing.length) fail(400, 'missing_files', { missing: missing.map((m) => m.sha256) });
  }

  // The versions stored now, for `superseded`. One bound parameter for the list.
  const keys = JSON.stringify(records.map((r) => `${r.tbl}/${r.id}`));
  const { results: stored } = await env.DB.prepare(
    `SELECT tbl, id, seq FROM sync_records
      WHERE program_id = ? AND tbl || '/' || id IN (SELECT value FROM json_each(?))`,
  ).bind(auth.programId, keys).all();
  const storedSeq = new Map(stored.map((s) => [`${s.tbl}/${s.id}`, s.seq]));

  // One batch: bump the counter by N, then record i takes (new counter) - (N-1-i),
  // read inside the same transaction. Single-row statements (D1's parameter cap).
  const n = records.length;
  const at = nowIso();
  const statements = [
    env.DB.prepare('UPDATE programs SET sync_seq = sync_seq + ? WHERE id = ? AND sync_enabled_at IS NOT NULL').bind(n, auth.programId),
  ];
  records.forEach((r, i) => {
    statements.push(env.DB.prepare(
      `INSERT INTO sync_records (program_id, tbl, id, seq, deleted, cloud_json, sealed, key_id, file_sha256, device_id, received_at)
       SELECT ?, ?, ?, sync_seq - ?, ?, ?, ?, ?, ?, ?, ? FROM programs WHERE id = ? AND sync_enabled_at IS NOT NULL
       ON CONFLICT (program_id, tbl, id) DO UPDATE SET seq = excluded.seq, deleted = excluded.deleted,
         cloud_json = excluded.cloud_json, sealed = excluded.sealed, key_id = excluded.key_id,
         file_sha256 = excluded.file_sha256, device_id = excluded.device_id, received_at = excluded.received_at`,
    ).bind(
      auth.programId, r.tbl, r.id, n - 1 - i, r.op === 'delete' ? 1 : 0,
      r.op === 'put' && r.cloud ? JSON.stringify(r.cloud) : null,
      r.op === 'put' ? r.sealed : null, r.op === 'put' ? r.keyId : null, r.op === 'put' ? r.file : null,
      auth.deviceId, at, auth.programId,
    ));
  });
  statements.push(env.DB.prepare('SELECT sync_seq FROM programs WHERE id = ?').bind(auth.programId));
  const results = await env.DB.batch(statements);
  if (results[0].meta.changes !== 1) fail(409, 'sync_off'); // turned off between the check and the batch
  const seq = results[results.length - 1].results[0].sync_seq;

  const accepted = [];
  const superseded = [];
  records.forEach((r, i) => {
    const mine = seq - (n - 1 - i);
    accepted.push({ tbl: r.tbl, id: r.id, seq: mine });
    const before = storedSeq.get(`${r.tbl}/${r.id}`);
    if (before !== undefined && before > r.baseSeq) superseded.push({ tbl: r.tbl, id: r.id, seq: mine, overwrote: before });
  });
  return { seq, accepted, superseded, dropped };
}

// --- Pull (plan §5.2) ---------------------------------------------------------------
// → { records, seq, more, through }. `through` is the last seq returned (or
// `since`). `seq` is the program's counter read BEFORE the query, so when `more`
// is false every record up to `seq` has been returned and the device's cursor
// may move to `seq` (a full pull, since=0, leaves tombstones out: it has none to
// apply).
export async function pullRecords(env, auth, url) {
  const program = await begin(env, auth);
  requireOn(program);
  const since = Number(url.searchParams.get('since') ?? 0);
  if (!Number.isInteger(since) || since < 0) fail(400, 'bad_since');
  let limit = Number(url.searchParams.get('limit') ?? MAX_PULL_RECORDS);
  if (!Number.isInteger(limit) || limit < 1) fail(400, 'bad_limit');
  limit = Math.min(limit, MAX_PULL_RECORDS);
  // A cursor below a deleted tombstone may have missed that delete. since=0 is a
  // full pull, which needs no tombstones.
  if (since > 0 && since < program.sync_purged_seq) fail(410, 'resync_required', { seq: program.sync_seq });

  const { results } = await env.DB.prepare(
    `SELECT tbl, id, seq, deleted, sealed, key_id, device_id, received_at FROM sync_records
      WHERE program_id = ? AND seq > ? ${since === 0 ? 'AND deleted = 0' : ''} ORDER BY seq LIMIT ?`,
  ).bind(auth.programId, since, limit + 1).all();
  const records = [];
  let bytes = 0;
  for (const r of results.slice(0, limit)) {
    bytes += (r.sealed?.length ?? 0) + 200;
    if (records.length && bytes > MAX_PULL_BYTES) break;
    records.push(r.deleted
      ? { tbl: r.tbl, id: r.id, seq: r.seq, op: 'delete', device_id: r.device_id, received_at: r.received_at }
      : { tbl: r.tbl, id: r.id, seq: r.seq, op: 'put', sealed: r.sealed, key_id: r.key_id, device_id: r.device_id, received_at: r.received_at });
  }
  const more = records.length < results.length;
  return { records, seq: program.sync_seq, more, through: records.length ? records[records.length - 1].seq : since };
}

// --- The device's cursor (plan §6.1) ---------------------------------------------
export async function recordCursor(env, auth, body) {
  const program = await begin(env, auth);
  requireOn(program);
  const seq = body.seq;
  if (!Number.isInteger(seq) || seq < 0 || seq > program.sync_seq) fail(400, 'bad_seq');
  await env.DB.prepare(
    `INSERT INTO sync_devices (program_id, device_id, cursor_seq, last_sync_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (program_id, device_id) DO UPDATE SET cursor_seq = excluded.cursor_seq, last_sync_at = excluded.last_sync_at`,
  ).bind(auth.programId, auth.deviceId, seq, nowIso()).run();
  return { ok: true };
}

// --- Retention (plan §6.3), from retention.js ------------------------------------------
export function syncRetentionStatements(env, nowMs) {
  const DAY = 24 * 60 * 60 * 1000;
  const tombstoneCut = new Date(nowMs - TOMBSTONE_KEEP_DAYS * DAY).toISOString();
  const offCut = new Date(nowMs - SYNC_OFF_KEEP_DAYS * DAY).toISOString();
  return [
    // Remember the highest tombstone seq about to go, then drop them.
    env.DB.prepare(
      `UPDATE programs SET sync_purged_seq = MAX(sync_purged_seq, (
         SELECT MAX(seq) FROM sync_records r WHERE r.program_id = programs.id AND r.deleted = 1 AND r.received_at < ?))
        WHERE EXISTS (SELECT 1 FROM sync_records r WHERE r.program_id = programs.id AND r.deleted = 1 AND r.received_at < ?)`,
    ).bind(tombstoneCut, tombstoneCut),
    env.DB.prepare('DELETE FROM sync_records WHERE deleted = 1 AND received_at < ?').bind(tombstoneCut),
    // Sync off for 30 days: its records go, and the counter moves one past every
    // cursor (a seq with no record), so any device that comes back re-joins and
    // re-sends what the server no longer has. Once per wipe: only while records remain.
    env.DB.prepare(
      `UPDATE programs SET sync_seq = sync_seq + 1, sync_purged_seq = sync_seq + 1
        WHERE sync_enabled_at IS NULL AND sync_disabled_at < ?
          AND EXISTS (SELECT 1 FROM sync_records r WHERE r.program_id = programs.id)`,
    ).bind(offCut),
    env.DB.prepare(
      'DELETE FROM sync_records WHERE program_id IN (SELECT id FROM programs WHERE sync_enabled_at IS NULL AND sync_disabled_at < ?)',
    ).bind(offCut),
    env.DB.prepare(
      'DELETE FROM sync_devices WHERE program_id IN (SELECT id FROM programs WHERE sync_enabled_at IS NULL AND sync_disabled_at < ?)',
    ).bind(offCut),
  ];
}

// /ops: counts only (plan §6.3).
export async function syncCounts(env) {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [programs, records, recent] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM programs WHERE sync_enabled_at IS NOT NULL').first('n'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM sync_records WHERE deleted = 0').first('n'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM sync_records WHERE received_at > ?').bind(hourAgo).first('n'),
  ]);
  return { programs, records, recentVersions: recent };
}
