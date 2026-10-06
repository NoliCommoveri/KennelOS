// cloudBackup.js — cloud backup, the parts with no network yet (Cloud Phase 1
// plan §3.1, §3.5, §4.1). Builds the cloud-tier snapshot from the local
// database, gzips it, and decides whether a push would shrink the cloud copy
// suspiciously. Pushing, listing and restoring over the network (pushIfDirty,
// listSnapshots, restoreSnapshot and the scheduler) land with the client cloud
// modules in plan §9 step 4. The restore itself is importExport's 'cloud-merge'
// mode.
//
// Data layer: reads through importExport.exportAll, never db directly.
import { exportAll } from '../importExport.js';
import { getSampleDataManifest } from '../settings.js';
import { edition } from '../editionConfig.js';
import {
  filterCollectionsForCloud, assertCloudCollections, REGISTRY_TABLES
} from '../syncRegistry.js';

export const SNAPSHOT_FORMAT = 1;

// --- Building a snapshot (plan §4.1) ----------------------------------------
// 1. exportAll() with raw Blobs (the file backup's base64 markers would only be
//    thrown away here).
// 2. Drop every row listed in the sample-data manifest: sample data is never
//    backed up.
// 3. Row rules + by-name projection (syncRegistry.filterCollectionsForCloud).
// 4. Pull file blobs out: each kept `files` row gets its content's `sha256` in
//    the blob's place, and the bytes go in `files` of the result for a separate
//    content-addressed upload.
// 5. The positive key check over every row. An unexpected key throws
//    CloudKeyError, and the push must not happen.
//
// Returns { envelope, files: [{ sha256, size, mime, blob }] } (files deduped by
// sha256). Options are for tests and the step-4 caller:
//   deviceId — the server-issued device id from the cloud session;
//   manifest — the sample-data manifest (defaults to the stored one);
//   now      — the snapshot time.
export async function buildCloudSnapshot({ deviceId = null, manifest = getSampleDataManifest(), now = new Date() } = {}) {
  const backup = await exportAll({ encodeBlobs: false });
  const real = dropSampleRows(backup.collections, manifest);
  const collections = filterCollectionsForCloud(real);

  // Step 4: hash each kept file's bytes from the SOURCE row (the projection
  // never carries the blob).
  const files = [];
  if (collections.files && collections.files.length) {
    const sourceById = new Map((real.files || []).map((f) => [f.id, f]));
    const bySha = new Map();
    const kept = [];
    for (const row of collections.files) {
      const blob = sourceById.get(row.id)?.blob;
      if (!(blob instanceof Blob)) continue; // no bytes on this device: nothing to back up
      const sha256 = await sha256Hex(blob);
      kept.push({ ...row, sha256 });
      if (!bySha.has(sha256)) {
        bySha.set(sha256, { sha256, size: blob.size, mime: blob.type || row.mime || 'application/octet-stream', blob });
      }
    }
    collections.files = kept;
    files.push(...bySha.values());
  }

  assertCloudCollections(collections);

  const envelope = {
    snapshot_format: SNAPSHOT_FORMAT,
    schema_version: backup.schema_version,
    created_at: now.toISOString(),
    device_id: deviceId,
    edition,
    counts: countRows(collections),
    collections
  };
  return { envelope, files };
}

// Rows whose id is in the manifest's list for their table are sample data.
export function dropSampleRows(collections, manifest) {
  if (!manifest) return collections;
  const out = {};
  for (const [table, rows] of Object.entries(collections)) {
    const ids = Array.isArray(manifest[table]) ? new Set(manifest[table]) : null;
    out[table] = ids && ids.size ? rows.filter((r) => !ids.has(r.id)) : rows;
  }
  return out;
}

export function countRows(collections) {
  const counts = {};
  for (const table of REGISTRY_TABLES) {
    if (Array.isArray(collections[table])) counts[table] = collections[table].length;
  }
  return counts;
}

export async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- gzip (plan §4.1 step 6) ------------------------------------------------
export async function gzipJson(obj) {
  const stream = new Blob([JSON.stringify(obj)], { type: 'application/json' })
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const bytes = await new Response(stream).arrayBuffer();
  return new Blob([bytes], { type: 'application/gzip' });
}

export async function gunzipJson(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

// --- Shrink guard (plan §3.5) ------------------------------------------------
// Before a push, compare the new snapshot's counts with the last pushed ones.
// Blocked when the new one has FEWER THAN HALF the dogs, or fewer than half the
// total records, of the last one. Each measure applies only when its previous
// count was at least SHRINK_MIN_PREVIOUS, so a small program can't trip it by
// removing a couple of records. Catches a half-cleared browser, a wrong
// "replace" import, and Reset App on a forgotten second device. The UI then
// offers "Upload anyway" or "Restore from backup instead".
export const SHRINK_MIN_PREVIOUS = 10;

const totalOf = (counts) => Object.values(counts || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);

// Returns { ok, dogs: { previous, next }, total: { previous, next } }. With no
// previous counts (first push) it is always ok.
export function checkShrink(previousCounts, nextCounts) {
  const dogs = { previous: Number(previousCounts?.dogs) || 0, next: Number(nextCounts?.dogs) || 0 };
  const total = { previous: totalOf(previousCounts), next: totalOf(nextCounts) };
  const shrank = (m) => m.previous >= SHRINK_MIN_PREVIOUS && m.next < m.previous / 2;
  return { ok: !previousCounts || !(shrank(dogs) || shrank(total)), dogs, total };
}
