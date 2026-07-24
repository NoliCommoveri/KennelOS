// importExport.js — JSON backup/restore for the whole Furever database: every
// pet, the breeder seed, household, contacts, care history, feeding, potty log,
// and documents/photos (with their file blobs). Mirrors the breeder core's
// shared/data/importExport.js (same blob round-tripping + counts-preview shape),
// but simpler — no editions, no demo mode, no per-collection import cap.
import { db, existingTableNames } from './db.js';
import { setLastBackupDate } from './settings.js';

// Bumped only when the on-disk backup shape changes in a way that needs a
// migration on restore.
export const BACKUP_FORMAT_VERSION = 1;

// --- Blob (binary) round-tripping -------------------------------------------
// JSON can't represent a Blob (JSON.stringify silently turns one into `{}`), and
// `files.blob` (behind documents/photos) is a real Blob. Export replaces any Blob
// with a base64 marker; restore rehydrates it.
const BLOB_TAG = '__blob_b64__';

function isBlobMarker(v) {
  return !!v && typeof v === 'object' && v[BLOB_TAG] === true && typeof v.data === 'string';
}

async function blobToMarker(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Chunked to avoid blowing the argument limit of String.fromCharCode on big files.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return { [BLOB_TAG]: true, mime: blob.type || 'application/octet-stream', data: btoa(binary) };
}

function markerToBlob(marker) {
  const binary = atob(marker.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: marker.mime || 'application/octet-stream' });
}

async function encodeRowBlobs(row) {
  let out = row;
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Blob) {
      if (out === row) out = { ...row };
      out[k] = await blobToMarker(v);
    }
  }
  return out;
}

function decodeRowBlobs(row) {
  let out = row;
  for (const [k, v] of Object.entries(row)) {
    if (isBlobMarker(v)) {
      if (out === row) out = { ...row };
      out[k] = markerToBlob(v);
    }
  }
  return out;
}

// Build the full backup object: { app, schema_version, format_version,
// exported_at, collections }. `app: 'furever'` guards against restoring a
// breeder-app backup here (or vice versa) — the shapes look similar enough at a
// glance to invite that mistake.
export async function exportAll() {
  const names = existingTableNames();
  // Read every row out first, THEN encode blobs — awaiting blob.arrayBuffer()
  // inside the Dexie transaction could let it auto-commit early; the Blobs stay
  // readable after the transaction closes, so encode outside it.
  const raw = {};
  await db.transaction('r', names.map((n) => db.table(n)), async () => {
    for (const name of names) raw[name] = await db.table(name).toArray();
  });
  const collections = {};
  for (const [name, rows] of Object.entries(raw)) {
    collections[name] = await Promise.all(rows.map(encodeRowBlobs));
  }
  return {
    app: 'furever',
    schema_version: db.verno,
    format_version: BACKUP_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    collections
  };
}

// Trigger a browser download of the backup and record the backup time.
export async function downloadBackup() {
  const data = await exportAll();
  const stamp = data.exported_at.slice(0, 19).replace(/[:T]/g, '-');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `furever-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setLastBackupDate(data.exported_at);
  return data;
}

// Basic shape validation of a parsed backup object. Returns a summary of counts
// so the UI can show what a restore would load before touching anything.
export function inspectBackup(obj) {
  if (!obj || typeof obj !== 'object' || !obj.collections || typeof obj.collections !== 'object') {
    throw new Error('This does not look like a valid backup file (missing "collections").');
  }
  if (obj.app && obj.app !== 'furever') {
    throw new Error(`This backup is from a different app ("${obj.app}") — it can't be restored into Furever.`);
  }
  // Forward-compat guard: refuse a file whose on-disk format is NEWER than this
  // build understands. Older/equal/absent is fine.
  const fmt = obj.format_version;
  if (typeof fmt === 'number' && fmt > BACKUP_FORMAT_VERSION) {
    throw new Error(
      `This backup was made by a newer version of Furever (format v${fmt}; this app ` +
      `understands up to v${BACKUP_FORMAT_VERSION}). Update the app, then restore.`
    );
  }
  const known = new Set(existingTableNames());
  const counts = {};
  const unknownTables = [];
  for (const [name, rows] of Object.entries(obj.collections)) {
    if (!Array.isArray(rows)) throw new Error(`Collection "${name}" is not an array.`);
    if (!known.has(name)) unknownTables.push(name);
    counts[name] = rows.length;
  }
  return { schema_version: obj.schema_version, exported_at: obj.exported_at, counts, unknownTables };
}

// Restore a parsed backup.
//   mode 'replace' — wipe EVERY known table, then load the file's rows, so the
//                    result is exactly the backup's contents.
//   mode 'merge'   — upsert the file's rows by id, leaving other records intact.
// Unknown collections (tables not in this schema version) are skipped, not an error.
export async function restoreBackup(obj, mode) {
  inspectBackup(obj);
  const names = existingTableNames();
  const known = new Set(names);
  const entries = Object.entries(obj.collections).filter(([name]) => known.has(name));

  await db.transaction('rw', names.map((n) => db.table(n)), async () => {
    if (mode === 'replace') {
      for (const name of names) await db.table(name).clear();
    }
    for (const [name, rows] of entries) {
      if (rows.length) await db.table(name).bulkPut(rows.map(decodeRowBlobs));
    }
  });
  return entries.map(([name, rows]) => ({ name, count: rows.length }));
}

// Read a File object as parsed JSON.
export async function readBackupFile(file) {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Could not parse the file as JSON.');
  }
}
