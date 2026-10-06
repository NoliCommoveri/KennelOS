// Ported from MCCE_Coop_Learning (test/helpers/d1.js).
// A D1-shaped facade over node:sqlite, so the migration runner, the seed, the
// reset and the import can be tested against a real database instead of a mock
// that agrees with whatever the code does.
//
// The one behaviour that has to match exactly is laziness: D1 prepares a
// statement when it runs, so applyPending() can put "CREATE TABLE" and the
// "CREATE INDEX" that depends on it into a single batch. node:sqlite prepares
// eagerly and would throw on the index, so preparation is deferred here too.
import { DatabaseSync } from 'node:sqlite';

class Stmt {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Stmt(this.db, this.sql, params);
  }

  #prepared() {
    return this.db.prepare(this.sql);
  }

  async run() {
    const info = this.#prepared().run(...this.params);
    return { success: true, meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) } };
  }

  async all() {
    const results = this.#prepared().all(...this.params);
    return { success: true, results, meta: {} };
  }

  async first(column) {
    const row = this.#prepared().get(...this.params) ?? null;
    if (row === null) return null;
    return column === undefined ? row : row[column];
  }
}

class D1 {
  constructor() {
    this.raw = new DatabaseSync(':memory:');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.batches = 0;
  }

  prepare(sql) {
    return new Stmt(this.raw, sql);
  }

  async batch(statements) {
    this.batches++;
    this.raw.exec('BEGIN');
    try {
      const out = [];
      for (const s of statements) out.push(await s.run());
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }
}

export function makeDb() {
  return new D1();
}

// An R2-shaped stand-in with just what step 3a reads.
export function makeBucket() {
  return { async list() { return { objects: [], truncated: false }; } };
}
