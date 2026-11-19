// scale.test.js — the Worker's reads and writes that grow with programs (review
// K4-11, K4-14; Review Remainder batch D): retention and the digests page through
// programs instead of reading them all at once, the D1 export pages each table,
// and a disaster-recovery restore writes in batches and can be run again to finish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, signIn, push } from './helpers/env.js';
import { makeDb, makeBucket } from './helpers/d1.js';

const { runRetention, PROGRAM_PAGE } = await import('../src/retention.js');
const { runDigests, DIGEST_PAGE } = await import('../src/notify.js');
const { exportAll, importAll, IMPORT_BATCH, EXPORT_PAGE, EXPORT_TABLES } = await import('../src/backup.js');
const migrate = await import('../src/migrate.js');

const pad = (n) => String(n).padStart(4, '0');
function seedPrograms(env, n) {
  const ins = (sql, ...a) => env.DB.raw.prepare(sql).run(...a);
  env.DB.raw.exec('BEGIN');
  for (let i = 0; i < n; i++) {
    ins('INSERT INTO users (id, email_hash, created_at) VALUES (?, ?, ?)', `u${pad(i)}`, `h${pad(i)}`, '2026-01-01T00:00:00.000Z');
    ins('INSERT INTO programs (id, owner_user_id, created_at) VALUES (?, ?, ?)', `p${pad(i)}`, `u${pad(i)}`, '2026-01-01T00:00:00.000Z');
  }
  env.DB.raw.exec('COMMIT');
}
// Five committed snapshots per program, the four older ones past the 30-day window.
function seedSnapshots(env, n) {
  const st = env.DB.raw.prepare(`INSERT INTO snapshots (id, program_id, device_id, created_at, size, counts_json, r2_key, status)
    VALUES (?, ?, 'dev', ?, 1, '{}', ?, 'committed')`);
  env.DB.raw.exec('BEGIN');
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 5; k++) {
      const id = `s${pad(i)}-${k}`;
      st.run(id, `p${pad(i)}`, k === 0 ? '2026-10-06T11:00:00.000Z' : `2026-0${k + 1}-01T00:00:00.000Z`, `snapshots/p${pad(i)}/${id}.json.gz`);
    }
  }
  env.DB.raw.exec('COMMIT');
}
const count = (env, sql) => env.DB.raw.prepare(sql).get().n;

// D1 refuses a response over its size cap; this stands in for it by row count, so
// a read that takes everything at once fails here the way it would at scale.
function capReads(db, max) {
  const wrap = (st) => {
    const all = st.all.bind(st);
    st.all = async () => {
      const r = await all();
      if (r.results.length > max) throw new Error(`D1_ERROR: response too large (${r.results.length} rows)`);
      return r;
    };
    const bind = st.bind.bind(st);
    st.bind = (...a) => wrap(bind(...a));
    return st;
  };
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => wrap(prepare(sql));
}

test('retention covers more programs than one page, and keeps its per-run cap', async () => {
  const env = await makeEnv();
  const n = PROGRAM_PAGE + 100; // 300 programs × 4 drops = 1,200, over one run's 1,000
  seedPrograms(env, n);
  seedSnapshots(env, n);
  capReads(env.DB, PROGRAM_PAGE * 5); // one page of programs' snapshots, never all 1,500
  const now = new Date('2026-10-06T12:00:00.000Z');
  const first = await runRetention(env, now);
  assert.equal(first.snapshotsDropped, 1000, 'the cap');
  const second = await runRetention(env, now);
  assert.equal(second.snapshotsDropped, 200, 'the rest, programs past the first page included');
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM snapshots'), n, 'one kept per program');
  assert.equal(count(env, "SELECT COUNT(DISTINCT program_id) AS n FROM snapshots WHERE id LIKE '%-0'"), n);
});

test('the digests reach programs past the first page', async () => {
  const env = await makeEnv();
  const n = DIGEST_PAGE + 50;
  seedPrograms(env, n);
  const set = env.DB.raw.prepare(`INSERT INTO notify_settings (program_id, digest_email, digest_tz, digest_kinds, digest_last_sent_at, updated_at)
    VALUES (?, ?, 'UTC', '["message"]', '2026-01-01T09:00:00Z', '2026-01-01T09:00:00Z')`);
  for (let i = 0; i < n; i++) set.run(`p${pad(i)}`, `kennel${i}@example.com`);
  capReads(env.DB, DIGEST_PAGE);
  const last = `p${pad(n - 1)}`;
  env.DB.raw.prepare(`INSERT INTO notify_items (program_id, kind, what, at) VALUES (?, 'message', 'A message', ?)`).run(last, '2026-10-05T10:00:00.000Z');
  const out = await runDigests(env, { now: new Date('2026-10-06T09:00:00.000Z'), origin: 'https://api.example' });
  assert.deepEqual(out, { due: 1, sent: 1, failed: 0 });
});

test('the export pages each table and holds every row', async () => {
  const env = await makeEnv();
  seedPrograms(env, EXPORT_PAGE + 5);
  capReads(env.DB, EXPORT_PAGE);
  const data = await exportAll(env.DB);
  assert.equal(data.tables.users.length, EXPORT_PAGE + 5);
  assert.equal(new Set(data.tables.users.map((u) => u.id)).size, EXPORT_PAGE + 5);
});

// A database the export is restored into; its batch() fails once on call `failAt`.
async function freshDb({ failAt = 0 } = {}) {
  const db = makeDb();
  await migrate.applyPending(db);
  const real = db.batch.bind(db);
  let calls = 0;
  db.batch = async (s) => {
    calls++;
    if (calls === failAt) { failAt = 0; throw new Error('D1_ERROR: simulated'); }
    return real(s);
  };
  return db;
}
const dump = (db) => Object.fromEntries(EXPORT_TABLES.map((t) => [t, db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));

test('a restore that fails on its third batch, run again, ends the same as one clean run', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  await push(env, s);
  seedPrograms(env, IMPORT_BATCH * 3);
  const data = JSON.parse(JSON.stringify(await exportAll(env.DB)));

  const clean = await freshDb();
  assert.equal((await importAll(clean, data)).ok, true);

  const broken = await freshDb({ failAt: 3 });
  const part = await importAll(broken, data);
  assert.equal(part.ok, false);
  assert.equal(part.partial, true);
  assert.ok(part.done.length < EXPORT_TABLES.length);
  assert.ok(!part.done.includes('programs'), 'programs had rows in the failed batch');

  // Another file is refused while this one is unfinished.
  const other = await importAll(broken, { ...data, exported_at: '2000-01-01T00:00:00.000Z' });
  assert.match(other.reason, /is not finished/);

  const again = await importAll(broken, data);
  assert.equal(again.ok, true);
  assert.deepEqual(dump(broken), dump(clean));
  assert.equal(broken.raw.prepare("SELECT COUNT(*) AS n FROM ops_config WHERE key = 'restore_in_progress'").get().n, 0);
  // Once finished, the empty-database rule is back.
  assert.match((await importAll(broken, data)).reason, /already has/);
});
