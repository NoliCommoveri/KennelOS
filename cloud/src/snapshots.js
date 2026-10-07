// Snapshots: the gzipped, filtered backup of one program (plan §3.4, §4, §6.1).
//
// Two requests per backup:
//   POST /snapshots          {base_snapshot_id, size, counts, files, edition?}  → {snapshotId}
//   PUT  /snapshots/:id/body gzipped bytes, Content-Length = size     → committed
// The first refuses a stale or foreign device (409) and a missing file (400)
// before any megabytes move. The second re-checks the 409 rule at the moment of
// commit, so two devices racing can't both win.
//
// The server never opens the snapshot: it stores the bytes.
//
// With the private vault on (Private Vault Plan §3.4, §6.1), a snapshot also has
// an encrypted vault part: declared in the POST as `vault: {size, keyId}`,
// uploaded by PUT /snapshots/:id/vault BEFORE the body PUT that commits. While
// the program has a vault, a snapshot without one (or under a replaced key) is
// refused, so no device can push the vault out of the backup history.
import { contentLength, fail } from './lib/http.js';
import { SHA256 } from './files.js';
import { KEY_ID, loadVault } from './vault.js';

export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_FILE_REFS = 20000;
export const snapshotKey = (programId, id) => `snapshots/${programId}/${id}.json.gz`;
// The vault part sits beside the body; derived from the body's key so retention
// and discard need no extra column.
export const vaultKeyFor = (r2Key) => r2Key.replace(/\.json\.gz$/, '.vault');

async function loadProgram(env, programId) {
  return env.DB.prepare('SELECT id, backing_device_id, latest_snapshot_id FROM programs WHERE id = ?').bind(programId).first();
}

// What a 409 tells the client: who is backing up, when they last did, and from
// which edition (so Lite can tell an upgrade to Pro from a second device).
export async function backingInfo(env, program) {
  let label = null;
  let lastPushAt = null;
  let edition = null;
  if (program.latest_snapshot_id) {
    const latest = await env.DB.prepare('SELECT device_id, device_label, created_at, edition FROM snapshots WHERE id = ?').bind(program.latest_snapshot_id).first();
    if (latest && latest.device_id === program.backing_device_id) {
      label = latest.device_label;
      lastPushAt = latest.created_at;
      edition = latest.edition ?? null;
    }
  }
  if (program.backing_device_id && !label) {
    const s = await env.DB.prepare('SELECT device_label FROM sessions WHERE device_id = ? ORDER BY last_seen_at DESC LIMIT 1')
      .bind(program.backing_device_id).first();
    label = s?.device_label ?? null;
  }
  return {
    backingDevice: program.backing_device_id ? { id: program.backing_device_id, label, lastPushAt, edition } : null,
    latestSnapshotId: program.latest_snapshot_id ?? null,
  };
}

function canPush(program, deviceId, base) {
  const deviceOk = !program.backing_device_id || program.backing_device_id === deviceId;
  return deviceOk && (program.latest_snapshot_id ?? null) === (base ?? null);
}

// The editions that back up (Demo has no cloud). Anything else is stored as NULL.
const EDITIONS = new Set(['lite', 'pro']);

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
  const edition = EDITIONS.has(body.edition) ? body.edition : null;

  const program = await loadProgram(env, auth.programId);
  if (!canPush(program, auth.deviceId, base)) fail(409, 'not_backing_device', await backingInfo(env, program));
  const vaultPart = await checkVaultPart(env, auth.programId, body.vault);

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
      `INSERT INTO snapshots (id, program_id, device_id, device_label, created_at, size, counts_json, r2_key, status, base_snapshot_id, edition,
                              vault_size, vault_key_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    ).bind(id, auth.programId, auth.deviceId, auth.deviceLabel, new Date().toISOString(), body.size,
      JSON.stringify(body.counts), snapshotKey(auth.programId, id), base, edition,
      vaultPart?.size ?? null, vaultPart?.keyId ?? null),
    env.DB.prepare('INSERT INTO snapshot_files (snapshot_id, sha256) SELECT ?, value FROM json_each(?)').bind(id, filesJson),
  ]);
  return { snapshotId: id };
}

// The vault rule. Returns {size, keyId} for a valid vault part, null when the
// program has no vault and none was sent; refuses everything else.
async function checkVaultPart(env, programId, part) {
  const vault = await loadVault(env, programId);
  if (!vault) {
    if (part !== undefined && part !== null) fail(400, 'no_vault');
    return null;
  }
  if (!part || typeof part !== 'object') fail(400, 'vault_required', { keyId: vault.key_id });
  if (!Number.isInteger(part.size) || part.size <= 0 || part.size > MAX_SNAPSHOT_BYTES) fail(400, 'bad_vault_size');
  if (typeof part.keyId !== 'string' || !KEY_ID.test(part.keyId)) fail(400, 'bad_key_id');
  if (part.keyId !== vault.key_id) fail(409, 'vault_key_stale', { keyId: vault.key_id });
  return { size: part.size, keyId: part.keyId };
}

async function discard(env, row) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM snapshot_files WHERE snapshot_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM snapshots WHERE id = ?').bind(row.id),
  ]);
  await env.FILES.delete([row.r2_key, vaultKeyFor(row.r2_key)]);
}

// PUT /snapshots/:id/vault: the encrypted vault part, before the body.
export async function uploadSnapshotVault(env, auth, id, request) {
  const row = await env.DB.prepare('SELECT * FROM snapshots WHERE id = ? AND program_id = ?').bind(id, auth.programId).first();
  if (!row) fail(404, 'not_found');
  if (row.status !== 'pending') fail(409, 'already_committed');
  if (row.device_id !== auth.deviceId) fail(403, 'wrong_device');
  if (row.vault_size === null) fail(400, 'no_vault_part');
  if (contentLength(request, MAX_SNAPSHOT_BYTES) !== row.vault_size) fail(400, 'size_mismatch');

  await env.FILES.put(vaultKeyFor(row.r2_key), request.body, { httpMetadata: { contentType: 'application/octet-stream' } });
  await env.DB.prepare('UPDATE snapshots SET vault_landed = 1 WHERE id = ?').bind(id).run();
  return { ok: true };
}

export async function uploadSnapshotBody(env, auth, id, request) {
  const row = await env.DB.prepare('SELECT * FROM snapshots WHERE id = ? AND program_id = ?').bind(id, auth.programId).first();
  if (!row) fail(404, 'not_found');
  if (row.status !== 'pending') fail(409, 'already_committed');
  if (row.device_id !== auth.deviceId) fail(403, 'wrong_device');
  if (contentLength(request, MAX_SNAPSHOT_BYTES) !== row.size) fail(400, 'size_mismatch');
  if (row.vault_size !== null && !row.vault_landed) fail(400, 'vault_missing');
  // The vault may have been turned off or re-keyed since the POST.
  const vault = await loadVault(env, auth.programId);
  if ((vault?.key_id ?? null) !== (row.vault_key_id ?? null)) {
    await discard(env, row);
    fail(409, vault ? 'vault_key_stale' : 'no_vault', vault ? { keyId: vault.key_id } : {});
  }

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
    `SELECT id, created_at, size, counts_json, device_id, device_label, edition, vault_key_id FROM snapshots
      WHERE program_id = ? AND status = 'committed' ORDER BY created_at DESC LIMIT 200`,
  ).bind(auth.programId).all();
  return {
    snapshots: results.map((r) => ({
      id: r.id, createdAt: r.created_at, size: r.size, counts: JSON.parse(r.counts_json),
      deviceId: r.device_id, deviceLabel: r.device_label, edition: r.edition ?? null,
      vaultKeyId: r.vault_key_id ?? null,
    })),
  };
}

// GET /snapshots/:id → the R2 object, or null.
export async function getSnapshot(env, auth, id) {
  const row = await env.DB.prepare(`SELECT r2_key FROM snapshots WHERE id = ? AND program_id = ? AND status = 'committed'`)
    .bind(id, auth.programId).first();
  return row ? env.FILES.get(row.r2_key) : null;
}

// GET /snapshots/:id/vault → the encrypted vault part's R2 object, or null.
export async function getSnapshotVault(env, auth, id) {
  const row = await env.DB.prepare(
    `SELECT r2_key FROM snapshots WHERE id = ? AND program_id = ? AND status = 'committed' AND vault_size IS NOT NULL`,
  ).bind(id, auth.programId).first();
  return row ? env.FILES.get(vaultKeyFor(row.r2_key)) : null;
}
