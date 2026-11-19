// /ops export and import of the D1 metadata (plan §6.3, §6.6).
//
// R2 is not in the export: snapshots and files are too big for a download, and
// R2 has no time travel, so this restores the index, not the bytes. Its use is
// putting D1 back over an R2 bucket that still holds the objects.
//
// Import fills an EMPTY schema only, and refuses before writing anything if the
// schema version differs, a table is unknown, a column is unknown, or any target
// table already has rows. It writes IMPORT_BATCH rows per batch, parents first
// (K4-14: the whole database in one batch fails at production size, at the worst
// moment), so a failure part-way leaves some tables restored: ops_config's
// restore_in_progress then names the file, and running the same file again
// finishes it (INSERT OR IGNORE: a row already in is the file's own). Any other
// file is refused until that one is finished.
//
// Ephemeral tables (codes, link codes, rate limits, the staging outbox, vault
// pairings) are not exported. Nor is sync_records (live sync's records): the
// snapshots in R2 are the recovery copy (Phase 2 plan §6.3); sync_devices is.
// notify_items (alerts' and digests' recent events) aren't: a week of them at most.
// mail_counts and mail_daily (emails sent per month and per day, counts only) are
// server state, like r2_sweep, and so is account_deletions (token hashes of deleted accounts, for 90 days). Of
// assisted setup, assist_programs is exported; its links, events and the manager's
// push subscriptions aren't. E-sign sends, own limits and ops_config are (the sends
// map Firma's requests back to contracts and count the month), and so is the template
// library (its offers, named breeders, who may add what, and the copies made).
import { migrationStatus } from './migrate.js';

// Foreign-key order: parents before children.
export const EXPORT_TABLES = ['users', 'programs', 'assist_programs', 'sessions', 'device_erasures', 'snapshots', 'files', 'snapshot_files', 'notices', 'vaults', 'vault_wraps',
  'pro_purchases', 'license_links', 'wl_projection', 'wl_tokens', 'wl_inbox', 'wl_events', 'wl_holds', 'wl_messages', 'wl_family_sessions', 'wl_senders',
  'sync_devices', 'int_connections', 'int_events', 'notify_settings', 'push_subscriptions', 'esign_sends', 'esign_limits', 'ops_config',
  'esign_library_templates', 'esign_library_breeders', 'esign_library_access', 'esign_library_copies'];
export const FORMAT = 'kennelos-cloud-d1';

async function schemaVersion(db) {
  const applied = (await migrationStatus(db)).filter((m) => m.state === 'applied');
  return applied.length ? applied[applied.length - 1].id : null;
}

async function columnsOf(db, table) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(results.map((r) => r.name));
}

export const EXPORT_PAGE = 1000;
export const IMPORT_BATCH = 200;
const IN_PROGRESS = 'restore_in_progress';

// Each table a page at a time (K4-14), in rowid order.
async function allRows(db, table) {
  const rows = [];
  for (let offset = 0; ; offset += EXPORT_PAGE) {
    const { results } = await db.prepare(`SELECT * FROM ${table} ORDER BY rowid LIMIT ${EXPORT_PAGE} OFFSET ${offset}`).all();
    rows.push(...results);
    if (results.length < EXPORT_PAGE) return rows;
  }
}

export async function exportAll(db) {
  const tables = {};
  for (const t of EXPORT_TABLES) tables[t] = await allRows(db, t);
  // A restore's own note is this database's state, not data.
  tables.ops_config = tables.ops_config.filter((r) => r.key !== IN_PROGRESS);
  return { format: FORMAT, schema_version: await schemaVersion(db), exported_at: new Date().toISOString(), tables };
}

// Returns {ok: true, rows} or {ok: false, reason}, and on a failure part-way
// {ok: false, partial: true, done: [tables fully restored], reason}. Never writes
// on refusal.
export async function importAll(db, data) {
  if (!data || data.format !== FORMAT || typeof data.tables !== 'object') return { ok: false, reason: 'This is not a KennelOS cloud export.' };
  const version = await schemaVersion(db);
  if (data.schema_version !== version) {
    return { ok: false, reason: `The file is schema ${data.schema_version}; this database is ${version}.` };
  }
  const extra = Object.keys(data.tables).find((t) => !EXPORT_TABLES.includes(t));
  if (extra) return { ok: false, reason: `Unknown table ${extra}.` };

  // A run of this same file that stopped part-way is carried on; anything else
  // needs an empty database.
  const fileId = String(data.exported_at || '');
  const running = await db.prepare('SELECT value FROM ops_config WHERE key = ?').bind(IN_PROGRESS).first('value');
  if (running && running !== fileId) {
    return { ok: false, reason: `A restore of the export made ${running} is not finished. Run that file again to finish it.` };
  }

  const plan = [];
  for (const t of EXPORT_TABLES) {
    const rows = data.tables[t] ?? [];
    if (!Array.isArray(rows)) return { ok: false, reason: `Table ${t} is not a list.` };
    if (!running) {
      const existing = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first('n');
      if (existing > 0) return { ok: false, reason: `Table ${t} already has ${existing} rows. Import only fills an empty database.` };
    }
    const allowed = await columnsOf(db, t);
    for (const row of rows) {
      const cols = Object.keys(row);
      const unknown = cols.find((c) => !allowed.has(c));
      if (unknown) return { ok: false, reason: `Table ${t} has no column ${unknown}.` };
      plan.push({ t, stmt: db.prepare(`INSERT OR IGNORE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .bind(...cols.map((c) => row[c])) });
    }
  }
  if (!plan.length) return { ok: true, rows: 0 };

  await db.prepare('INSERT OR REPLACE INTO ops_config (key, value, updated_at) VALUES (?, ?, ?)')
    .bind(IN_PROGRESS, fileId, new Date().toISOString()).run();
  // The last batch each table's rows are in, so a failure can say which tables are whole.
  const lastBatchOf = new Map(plan.map((p, i) => [p.t, Math.floor(i / IMPORT_BATCH)]));
  let batch = 0;
  try {
    for (; batch * IMPORT_BATCH < plan.length; batch++) {
      await db.batch(plan.slice(batch * IMPORT_BATCH, (batch + 1) * IMPORT_BATCH).map((p) => p.stmt));
    }
  } catch (err) {
    const done = EXPORT_TABLES.filter((t) => !lastBatchOf.has(t) || lastBatchOf.get(t) < batch);
    return { ok: false, partial: true, done, reason: String(err?.message ?? err) };
  }
  await db.prepare('DELETE FROM ops_config WHERE key = ?').bind(IN_PROGRESS).run();
  return { ok: true, rows: plan.length };
}
