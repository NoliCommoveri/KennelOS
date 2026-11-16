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

// Rows from an older schema, brought up to this one (K14-18). A restore never
// runs db.js's .upgrade() blocks, so each one's row change is repeated here.
//   v1 → v2: contacts.pet_id (null = every pet) → contacts.pet_ids.
// Keyed on the row's shape rather than the file's schema_version, so a
// hand-edited or mislabelled file comes up too. Pure.
export function migrateCollections(collections) {
  const out = { ...collections };
  if (Array.isArray(out.contacts)) {
    const allPetIds = (Array.isArray(out.pets) ? out.pets : []).map((p) => p.id);
    out.contacts = out.contacts.map((c) => {
      if (!c || Array.isArray(c.pet_ids) || !('pet_id' in c)) return c;
      const { pet_id, ...rest } = c;
      return { ...rest, pet_ids: pet_id == null ? allPetIds.slice() : [pet_id] };
    });
  }
  return out;
}

// The tables whose rows point at a pet, and how (referenceRegistry's PET list).
const PET_ID_TABLES = ['care_events', 'care_plans', 'feeding', 'potty_events', 'documents', 'photos', 'practice_logs', 'skill_progress'];

// Merge by NATURAL key, not only by id (K14-7), the way the breeder app's restore
// matches: a family's two phones each made their own row for the same pup
// (`pup_id`), the same breeder (`breeder_key`) and the same content pack
// (`pack_key`, a unique index). An incoming row that matches a local one takes
// the local id, and every row pointing at it follows. The pet and breeder rows
// keep whichever copy is newer (updated_at); a pack keeps the higher version and
// both phones' per-pet fetch state. Pure: (incoming collections, local rows) →
// collections to bulkPut.
export function planMerge(collections, local) {
  const out = { ...collections };
  const petMap = new Map();
  const breederMap = new Map();
  const newer = (a, b) => String(a.updated_at || '') > String(b.updated_at || '');

  if (Array.isArray(out.breeders)) {
    const byKey = new Map((local.breeders || []).filter((b) => b.breeder_key).map((b) => [b.breeder_key, b]));
    out.breeders = out.breeders.flatMap((b) => {
      const mine = b && b.breeder_key ? byKey.get(b.breeder_key) : null;
      if (!mine || mine.id === b.id) return [b];
      breederMap.set(b.id, mine.id);
      return newer(b, mine) ? [{ ...b, id: mine.id }] : [];
    });
  }
  if (Array.isArray(out.pets)) {
    const byPup = new Map((local.pets || []).filter((p) => p.pup_id).map((p) => [p.pup_id, p]));
    out.pets = out.pets.flatMap((p) => {
      const mine = p && p.pup_id ? byPup.get(p.pup_id) : null;
      const row = p && breederMap.has(p.breeder_id) ? { ...p, breeder_id: breederMap.get(p.breeder_id) } : p;
      if (!mine || mine.id === p.id) return [row];
      petMap.set(p.id, mine.id);
      return newer(p, mine) ? [{ ...row, id: mine.id }] : [];
    });
  }
  const pet = (id) => (petMap.has(id) ? petMap.get(id) : id);
  if (petMap.size) {
    for (const t of PET_ID_TABLES) {
      if (Array.isArray(out[t])) out[t] = out[t].map((r) => (r && petMap.has(r.pet_id) ? { ...r, pet_id: pet(r.pet_id) } : r));
    }
    if (Array.isArray(out.contacts)) {
      out.contacts = out.contacts.map((c) => (c && Array.isArray(c.pet_ids) ? { ...c, pet_ids: [...new Set(c.pet_ids.map(pet))] } : c));
    }
  }
  // Both phones fetched the same pack for the same pup: keep one copy of each
  // breeder document (pet, pack, Drive file).
  if (Array.isArray(out.documents) && local.documents) {
    const docKey = (d) => `${d.pet_id}|${d.pack_key}|${d.drive_file_id}`;
    const have = new Map(local.documents.filter((d) => d.source === 'breeder').map((d) => [docKey(d), d.id]));
    out.documents = out.documents.filter((d) => !(d && d.source === 'breeder' && have.has(docKey(d)) && have.get(docKey(d)) !== d.id));
  }
  if (Array.isArray(out.content_packs)) {
    const byKey = new Map((local.content_packs || []).map((r) => [r.pack_key, r]));
    out.content_packs = out.content_packs.map((r) => {
      const pets = {};
      for (const [id, st] of Object.entries((r && r.pets) || {})) pets[pet(id)] = st;
      const mine = r ? byKey.get(r.pack_key) : null;
      if (!mine) return { ...r, pets };
      return {
        ...mine,
        version: Math.max(Number(mine.version) || 0, Number(r.version) || 0),
        pets: { ...pets, ...(mine.pets || {}) }
      };
    });
  }
  return out;
}

// Restore a parsed backup.
//   mode 'replace' — wipe EVERY known table, then load the file's rows, so the
//                    result is exactly the backup's contents.
//   mode 'merge'   — upsert the file's rows, matched by natural key where one
//                    exists (planMerge), leaving other records intact.
// Rows from an older schema are migrated first (migrateCollections). Unknown
// collections (tables not in this schema version) are skipped, not an error. A
// failure changes nothing and says so in a sentence.
export async function restoreBackup(obj, mode) {
  inspectBackup(obj);
  const names = existingTableNames();
  const known = new Set(names);
  let collections = migrateCollections(Object.fromEntries(
    Object.entries(obj.collections).filter(([name]) => known.has(name))
  ));
  if (mode === 'merge') {
    const local = {};
    for (const t of ['pets', 'breeders', 'content_packs', 'documents']) if (known.has(t)) local[t] = await db.table(t).toArray();
    collections = planMerge(collections, local);
  }
  const entries = Object.entries(collections);

  try {
    await db.transaction('rw', names.map((n) => db.table(n)), async () => {
      if (mode === 'replace') {
        for (const name of names) await db.table(name).clear();
      }
      for (const [name, rows] of entries) {
        if (rows.length) await db.table(name).bulkPut(rows.map(decodeRowBlobs));
      }
    });
  } catch (err) {
    throw new Error(`This backup couldn’t be ${mode === 'merge' ? 'merged' : 'restored'}, so nothing was changed. (${(err && err.message) || err})`);
  }
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
