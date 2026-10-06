// The migration runner /ops drives (plan §6.6). Ported from MCCE_Coop_Learning
// (src/migrate.js), unchanged in behaviour.
import { MIGRATIONS } from './migrations/index.js';
import { splitStatements } from './lib/sql.js';
import { sha256Hex } from './lib/crypto.js';

const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS _migrations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum   TEXT NOT NULL
)`;

export async function ensureMigrationsTable(db) {
  await db.prepare(CREATE_MIGRATIONS_TABLE).run();
}

// Every migration with its state: applied, pending, drifted (the file's checksum
// no longer matches what was applied) or orphaned (applied, but no file ships
// with this deploy). Drift is reported, never fixed automatically.
export async function migrationStatus(db, migrations = MIGRATIONS) {
  await ensureMigrationsTable(db);
  const { results } = await db.prepare('SELECT id, name, applied_at, checksum FROM _migrations').all();
  const applied = new Map(results.map((r) => [r.id, r]));

  const rows = [];
  for (const m of migrations) {
    const checksum = await sha256Hex(m.sql);
    const row = applied.get(m.id);
    rows.push({
      id: m.id,
      name: m.name,
      checksum,
      applied_at: row ? row.applied_at : null,
      state: !row ? 'pending' : row.checksum === checksum ? 'applied' : 'drifted',
    });
  }

  const known = new Set(migrations.map((m) => m.id));
  for (const row of results) {
    if (!known.has(row.id)) {
      rows.push({ id: row.id, name: row.name, checksum: row.checksum, applied_at: row.applied_at, state: 'orphaned' });
    }
  }

  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

// True when the database is exactly what this deploy's code expects: every
// bundled migration applied, none drifted, none orphaned.
export async function schemaIsCurrent(db, migrations = MIGRATIONS) {
  const rows = await migrationStatus(db, migrations);
  return rows.every((r) => r.state === 'applied');
}

// Apply every pending migration in order. Each migration's statements and its
// _migrations row go in one db.batch(), so a migration lands whole or not at
// all. Halts on the first failure. db.exec() is never used: it needs one
// statement per line, which a readable schema file is not.
export async function applyPending(db, migrations = MIGRATIONS) {
  const status = await migrationStatus(db, migrations);
  const pendingIds = new Set(status.filter((r) => r.state === 'pending').map((r) => r.id));
  const log = [];

  for (const m of migrations) {
    if (!pendingIds.has(m.id)) continue;

    const statements = splitStatements(m.sql);
    const checksum = await sha256Hex(m.sql);

    try {
      const batch = statements.map((s) => db.prepare(s));
      batch.push(
        db.prepare('INSERT INTO _migrations (id, name, applied_at, checksum) VALUES (?, ?, ?, ?)')
          .bind(m.id, m.name, new Date().toISOString(), checksum),
      );
      await db.batch(batch);
      log.push({ id: m.id, name: m.name, ok: true, statements: statements.length });
    } catch (err) {
      // The batch is atomic, so nothing from this migration landed. D1 does not
      // say which statement failed, so /ops prints the error and the numbered
      // statements to find it in.
      log.push({
        id: m.id,
        name: m.name,
        ok: false,
        error: String(err?.message ?? err),
        statementList: statements,
        statements: statements.length,
      });
      return { log, halted: true };
    }
  }

  return { log, halted: false };
}
