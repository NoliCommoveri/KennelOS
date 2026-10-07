// /ops export and import of the D1 metadata (plan §6.3, §6.6).
//
// R2 is not in the export: snapshots and files are too big for a download, and
// R2 has no time travel, so this restores the index, not the bytes. Its use is
// putting D1 back over an R2 bucket that still holds the objects.
//
// Import fills an EMPTY schema only, and refuses before writing anything if the
// schema version differs, a table is unknown, a column is unknown, or any target
// table already has rows. All rows go in one batch, so it lands whole or not at all.
//
// Ephemeral tables (codes, rate limits, the staging outbox, vault pairings) are
// not exported.
import { migrationStatus } from './migrate.js';

// Foreign-key order: parents before children.
export const EXPORT_TABLES = ['users', 'programs', 'sessions', 'device_erasures', 'snapshots', 'files', 'snapshot_files', 'notices', 'vaults', 'vault_wraps'];
export const FORMAT = 'kennelos-cloud-d1';

async function schemaVersion(db) {
  const applied = (await migrationStatus(db)).filter((m) => m.state === 'applied');
  return applied.length ? applied[applied.length - 1].id : null;
}

async function columnsOf(db, table) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(results.map((r) => r.name));
}

export async function exportAll(db) {
  const tables = {};
  for (const t of EXPORT_TABLES) tables[t] = (await db.prepare(`SELECT * FROM ${t}`).all()).results;
  return { format: FORMAT, schema_version: await schemaVersion(db), exported_at: new Date().toISOString(), tables };
}

// Returns {ok: true, rows} or {ok: false, reason}. Never writes on refusal.
export async function importAll(db, data) {
  if (!data || data.format !== FORMAT || typeof data.tables !== 'object') return { ok: false, reason: 'This is not a KennelOS cloud export.' };
  const version = await schemaVersion(db);
  if (data.schema_version !== version) {
    return { ok: false, reason: `The file is schema ${data.schema_version}; this database is ${version}.` };
  }

  const statements = [];
  for (const t of EXPORT_TABLES) {
    const rows = data.tables[t] ?? [];
    if (!Array.isArray(rows)) return { ok: false, reason: `Table ${t} is not a list.` };
    const existing = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first('n');
    if (existing > 0) return { ok: false, reason: `Table ${t} already has ${existing} rows. Import only fills an empty database.` };
    const allowed = await columnsOf(db, t);
    for (const row of rows) {
      const cols = Object.keys(row);
      const unknown = cols.find((c) => !allowed.has(c));
      if (unknown) return { ok: false, reason: `Table ${t} has no column ${unknown}.` };
      statements.push(db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .bind(...cols.map((c) => row[c])));
    }
  }
  const extra = Object.keys(data.tables).find((t) => !EXPORT_TABLES.includes(t));
  if (extra) return { ok: false, reason: `Unknown table ${extra}.` };

  if (statements.length) await db.batch(statements);
  return { ok: true, rows: statements.length };
}
