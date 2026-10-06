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

// An R2-shaped stand-in: put (with R2's sha256 check), get, list by prefix with
// a key cursor, and delete of up to 1000 keys. Bodies are drained, because the
// Worker hands R2 a stream.
import { createHash } from 'node:crypto';

export function makeBucket() {
  const store = new Map();
  const object = (key, entry) => ({
    key,
    size: entry.bytes.length,
    httpMetadata: entry.httpMetadata,
    get body() { return new Response(entry.bytes).body; },
    async arrayBuffer() { return entry.bytes.slice().buffer; },
  });
  return {
    store,
    async put(key, value, options = {}) {
      const bytes = value instanceof Uint8Array ? value
        : typeof value === 'string' ? new TextEncoder().encode(value)
        : new Uint8Array(await new Response(value).arrayBuffer());
      if (options.sha256 && createHash('sha256').update(bytes).digest('hex') !== options.sha256) {
        throw new Error('put: The SHA-256 checksum you specified did not match what we received.');
      }
      store.set(key, { bytes, httpMetadata: options.httpMetadata ?? {} });
      return object(key, store.get(key));
    },
    async get(key) {
      const entry = store.get(key);
      return entry ? object(key, entry) : null;
    },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = cursor ? all.findIndex((k) => k > cursor) : 0;
      const start = from === -1 ? all.length : from;
      const page = all.slice(start, start + limit);
      return { objects: page.map((key) => ({ key })), truncated: start + page.length < all.length, cursor: page.at(-1) };
    },
    async delete(keys) {
      const list = [].concat(keys);
      if (list.length > 1000) throw new Error('R2 deletes at most 1000 keys per call');
      for (const k of list) store.delete(k);
    },
  };
}
