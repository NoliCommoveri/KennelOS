// Snapshots: the gzipped, filtered backup of one program (plan §3.4, §4, §6.1).
//
// Two requests per backup:
//   POST /snapshots          {base_snapshot_id, size, counts, files}  → {snapshotId}
//   PUT  /snapshots/:id/body gzipped bytes, Content-Length = size     → committed
// The first refuses a stale or foreign device (409) and a missing file (400)
// before any megabytes move. The second re-checks the 409 rule at the moment of
// commit, so two devices racing can't both win.
//
// The server never opens the snapshot: it stores the bytes.
import { contentLength, fail } from './lib/http.js';
import { SHA256 } from './files.js';

export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_FILE_REFS = 20000;
export const snapshotKey = (programId, id) => `snapshots/${programId}/${id}.json.gz`;

async function loadProgram(env, programId) {
  return env.DB.prepare('SELECT id, backing_device_id, latest_snapshot_id FROM programs WHERE id = ?').bind(programId).first();
}

// What a 409 tells the client: who is backing up, and when they last did.
export async function backingInfo(env, program) {
  let label = null;
  let lastPushAt = null;
  if (program.latest_snapshot_id) {
    const latest = await env.DB.prepare('SELECT device_id, device_label, created_at FROM snapshots WHERE id = ?').bind(program.latest_snapshot_id).first();
    if (latest && latest.device_id === program.backing_device_id) {
      label = latest.device_label;
      lastPushAt = latest.created_at;
    }
  }
  if (program.backing_device_id && !label) {
    const s = await env.DB.prepare('SELECT device_label FROM sessions WHERE device_id = ? ORDER BY last_seen_at DESC LIMIT 1')
      .bind(program.backing_device_id).first();
    label = s?.device_label ?? null;
  }
  return {
    backingDevice: program.backing_device_id ? { id: program.backing_device_id, label, lastPushAt } : null,
    latestSnapshotId: program.latest_snapshot_id ?? null,
  };
}

function canPush(program, deviceId, base) {
  const deviceOk = !program.backing_device_id || program.backing_device_id === deviceId;
  return deviceOk && (program.latest_snapshot_id ?? null) === (base ?? null);
}

function validCounts(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return false;
  const entries = Object.entries(counts);
  return entries.length <= 50 && entries.every(([k, v]) => /^[a-z_]{1,40}$/.test(k) && Number.isInteger(v) && v >= 0);
}

export async function createSnapshot(env, auth, body) {
  const base = body.base_snapshot_id ?? null;
  if (base !== null && typeof base !== 'string') fail(400, 'bad_request');
  if (!Number.isInteger(body.size) || body.size <= 0 || body.size > MAX_SNAPSHOT_BYTES) fail(400, 'bad_size');
  if (!validCounts(body.counts)) fail(400, 'bad_counts');
  const files = Array.isArray(body.files) ? [...new Set(body.files)] : null;
  if (!files || files.length > MAX_FILE_REFS || !files.every((f) => typeof f === 'string' && SHA256.test(f))) fail(400, 'bad_files');

  const program = await loadProgram(env, auth.programId);
  if (!canPush(program, auth.deviceId, base)) fail(409, 'not_backing_device', await backingInfo(env, program));

  // One bound parameter for the whole list (D1 allows ~100 per query, plan §6.2).
  const filesJson = JSON.stringify(files);
  const { results: missing } = await env.DB.prepare(
    `SELECT j.value AS sha256 FROM json_each(?) j
      WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.program_id = ? AND f.sha256 = j.value)`,
  ).bind(filesJson, auth.programId).all();
  if (missing.length) fail(400, 'missing_files', { missing: missing.map((m) => m.sha256) });

  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO snapshots (id, program_id, device_id, device_label, created_at, size, counts_json, r2_key, status, base_snapshot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).bind(id, auth.programId, auth.deviceId, auth.deviceLabel, new Date().toISOString(), body.size,
      JSON.stringify(body.counts), snapshotKey(auth.programId, id), base),
    env.DB.prepare('INSERT INTO snapshot_files (snapshot_id, sha256) SELECT ?, value FROM json_each(?)').bind(id, filesJson),
  ]);
  return { snapshotId: id };
}

async function discard(env, row) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM snapshot_files WHERE snapshot_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM snapshots WHERE id = ?').bind(row.id),
  ]);
  await env.FILES.delete(row.r2_key);
}

export async function uploadSnapshotBody(env, auth, id, request) {
  const row = await env.DB.prepare('SELECT * FROM snapshots WHERE id = ? AND program_id = ?').bind(id, auth.programId).first();
  if (!row) fail(404, 'not_found');
  if (row.status !== 'pending') fail(409, 'already_committed');
  if (row.device_id !== auth.deviceId) fail(403, 'wrong_device');
  if (contentLength(request, MAX_SNAPSHOT_BYTES) !== row.size) fail(400, 'size_mismatch');

  await env.FILES.put(row.r2_key, request.body, { httpMetadata: { contentType: 'application/gzip' } });

  // Commit only if this device may still push on that base. The second
  // statement is conditional on the first having happened, in one batch.
  const [moved] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE programs SET latest_snapshot_id = ?, backing_device_id = ?
        WHERE id = ? AND (backing_device_id IS NULL OR backing_device_id = ?) AND latest_snapshot_id IS ?`,
    ).bind(id, auth.deviceId, auth.programId, auth.deviceId, row.base_snapshot_id),
    env.DB.prepare(
      `UPDATE snapshots SET status = 'committed'
        WHERE id = ? AND EXISTS (SELECT 1 FROM programs WHERE id = ? AND latest_snapshot_id = ?)`,
    ).bind(id, auth.programId, id),
  ]);
  if (moved.meta.changes !== 1) {
    await discard(env, row);
    fail(409, 'not_backing_device', await backingInfo(env, await loadProgram(env, auth.programId)));
  }
  return { ok: true, snapshotId: id };
}

export async function listSnapshots(env, auth) {
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, size, counts_json, device_id, device_label FROM snapshots
      WHERE program_id = ? AND status = 'committed' ORDER BY created_at DESC LIMIT 200`,
  ).bind(auth.programId).all();
  return {
    snapshots: results.map((r) => ({
      id: r.id, createdAt: r.created_at, size: r.size, counts: JSON.parse(r.counts_json),
      deviceId: r.device_id, deviceLabel: r.device_label,
    })),
  };
}

// GET /snapshots/:id → the R2 object, or null.
export async function getSnapshot(env, auth, id) {
  const row = await env.DB.prepare(`SELECT r2_key FROM snapshots WHERE id = ? AND program_id = ? AND status = 'committed'`)
    .bind(id, auth.programId).first();
  return row ? env.FILES.get(row.r2_key) : null;
}
