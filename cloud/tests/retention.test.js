import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, signIn, push, bytes } from './helpers/env.js';
import { worker } from './helpers/worker.js';

const { pickDrops, runRetention } = await import('../src/retention.js');
const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const at = (iso, id = iso, program_id = 'p') => ({ id, program_id, created_at: iso });

test('within a day, the newest per hour is kept', () => {
  const drops = pickDrops([
    at('2026-10-06T11:55:00.000Z'), at('2026-10-06T11:20:00.000Z'), at('2026-10-06T11:05:00.000Z'),
    at('2026-10-06T10:40:00.000Z'),
  ], NOW);
  assert.deepEqual(drops.map((d) => d.id).sort(), ['2026-10-06T11:05:00.000Z', '2026-10-06T11:20:00.000Z']);
});

test('from a day to thirty days, the newest per day is kept; older goes', () => {
  const drops = pickDrops([
    at('2026-10-06T11:00:00.000Z'),
    at('2026-10-03T18:00:00.000Z'), at('2026-10-03T09:00:00.000Z'),
    at('2026-09-01T09:00:00.000Z'),
  ], NOW);
  assert.deepEqual(drops.map((d) => d.id).sort(), ['2026-09-01T09:00:00.000Z', '2026-10-03T09:00:00.000Z']);
});

test('the newest snapshot is kept however old it is', () => {
  assert.deepEqual(pickDrops([at('2025-01-01T00:00:00.000Z'), at('2024-01-01T00:00:00.000Z')], NOW).map((d) => d.id), ['2024-01-01T00:00:00.000Z']);
});

test('programs are judged separately', () => {
  const drops = pickDrops([at('2026-10-06T11:55:00.000Z', 'a1', 'a'), at('2026-10-06T11:50:00.000Z', 'b1', 'b')], NOW);
  assert.deepEqual(drops, []);
});

test('a run drops old snapshots, abandoned uploads and unreferenced files, from D1 and R2', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const oldDoc = bytes('superseded scan');
  const keptDoc = bytes('current scan');
  const first = await (await push(env, s, { files: [oldDoc] })).json();
  const second = await (await push(env, s, { base: first.snapshotId, files: [keptDoc] })).json();
  // Age the first snapshot past the window, and leave a pending upload behind.
  env.DB.raw.prepare("UPDATE snapshots SET created_at = '2026-08-01T00:00:00.000Z' WHERE id = ?").run(first.snapshotId);
  env.DB.raw.prepare("UPDATE files SET created_at = '2026-08-01T00:00:00.000Z'").run();
  env.DB.raw.prepare(`INSERT INTO snapshots (id, program_id, device_id, created_at, size, counts_json, r2_key, status)
    VALUES ('stale', ?, ?, '2026-08-01T00:00:00.000Z', 1, '{}', 'snapshots/x/stale.json.gz', 'pending')`).run(s.programId, s.deviceId);

  const summary = await runRetention(env, new Date());
  assert.deepEqual(summary, { snapshotsDropped: 1, pendingDropped: 1, filesDropped: 1, r2Deleted: 3, r2Untracked: 0 });

  const ids = env.DB.raw.prepare('SELECT id FROM snapshots').all().map((r) => r.id);
  assert.deepEqual(ids, [second.snapshotId]);
  const keys = [...env.FILES.store.keys()];
  assert.equal(keys.filter((k) => k.startsWith('files/')).length, 1);
  assert.ok(keys.some((k) => k.endsWith(`${second.snapshotId}.json.gz`)));

  assert.deepEqual(await runRetention(env, new Date()), { snapshotsDropped: 0, pendingDropped: 0, filesDropped: 0, r2Deleted: 0, r2Untracked: 0 }, 'a second run finds nothing');
});

test('a file uploaded moments ago survives even with no snapshot yet', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const { call, sha } = await import('./helpers/env.js');
  const f = bytes('just uploaded');
  await call(env, 'PUT', `/files/${sha(f)}`, { token: s.token, body: f });
  await runRetention(env, new Date());
  assert.equal(env.FILES.store.size, 1);
});

test('the cron runs retention, and skips while migrations are pending', async () => {
  const env = await makeEnv();
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  await worker.scheduled({}, env, ctx);
  await Promise.all(waits);

  const { makeDb, makeBucket } = await import('./helpers/d1.js');
  const { gate } = await import('./helpers/worker.js');
  gate.resetGateCache();
  const fresh = { DB: makeDb(), FILES: makeBucket() };
  const waits2 = [];
  await worker.scheduled({}, fresh, { waitUntil: (p) => waits2.push(p) });
  await Promise.all(waits2);
  const tables = fresh.DB.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'snapshots'").all();
  assert.deepEqual(tables, [], 'nothing ran against an unmigrated database');
});

// --- The R2 orphan sweep ------------------------------------------------------------

const { sweepR2Orphans, SWEEP_HALT_AT } = await import('../src/retention.js');
const DAY_MS = 24 * 60 * 60 * 1000;
const aged = (env, key, ms = 2 * DAY_MS) => { env.FILES.store.get(key).uploaded = new Date(Date.now() - ms); };

test('the sweep deletes objects D1 doesn\'t track, and nothing else', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const doc = bytes('a pedigree');
  const snap = await (await push(env, s, { files: [doc] })).json();
  const p = s.programId;
  const lost = 'a'.repeat(64);
  const leftovers = [`files/${p}/${lost}`, `snapshots/${p}/gone.json.gz`, `snapshots/${p}/gone.vault`];
  for (const k of leftovers) await env.FILES.put(k, 'x');
  await env.FILES.put(`files/${p}/${'b'.repeat(64)}`, 'x');            // untracked but uploaded moments ago
  await env.FILES.put(`files/nobody/${'c'.repeat(64)}`, 'x');          // a program D1 doesn't know
  await env.FILES.put('exports/something-else.bin', 'x');              // a shape the Worker never writes
  for (const k of env.FILES.store.keys()) if (!k.includes('b'.repeat(64))) aged(env, k);

  assert.deepEqual(await sweepR2Orphans(env), { r2Untracked: 3 });
  const keys = [...env.FILES.store.keys()];
  for (const k of leftovers) assert.ok(!keys.includes(k), `${k} deleted`);
  assert.ok(keys.some((k) => k.endsWith(`${snap.snapshotId}.json.gz`)), 'a tracked snapshot stays');
  assert.equal(keys.filter((k) => k.startsWith(`files/${p}/`)).length, 2, 'the tracked file and the fresh one stay');
  assert.ok(keys.includes(`files/nobody/${'c'.repeat(64)}`) && keys.includes('exports/something-else.bin'));
  assert.equal(env.DB.raw.prepare('SELECT cursor, last_pass_at FROM r2_sweep').get().cursor, null);
});

test('a big bucket is walked over several runs, carrying on where the last stopped', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const p = s.programId;
  for (let i = 0; i < 7; i++) await env.FILES.put(`files/${p}/${String(i).repeat(64)}`, 'x');
  for (const k of env.FILES.store.keys()) aged(env, k);
  const run = () => sweepR2Orphans(env, Date.now(), { pages: 1, pageSize: 3 });
  assert.deepEqual(await run(), { r2Untracked: 3 });
  assert.ok(env.DB.raw.prepare('SELECT cursor FROM r2_sweep').get().cursor, 'remembers its place');
  assert.deepEqual(await run(), { r2Untracked: 3 });
  assert.deepEqual(await run(), { r2Untracked: 1 });
  const state = env.DB.raw.prepare('SELECT cursor, pass_started_at, last_pass_at FROM r2_sweep').get();
  assert.equal(state.cursor, null);
  assert.equal(state.pass_started_at, null);
  assert.ok(state.last_pass_at);
  assert.equal(env.FILES.store.size, 0);
});

test('a sweep that finds too many untracked objects deletes none of them', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const p = s.programId;
  for (let i = 0; i <= SWEEP_HALT_AT; i++) await env.FILES.put(`files/${p}/${i.toString(16).padStart(64, '0')}`, 'x');
  for (const k of env.FILES.store.keys()) aged(env, k);
  assert.deepEqual(await sweepR2Orphans(env), { r2Untracked: 0, r2SweepHalted: SWEEP_HALT_AT + 1 });
  assert.equal(env.FILES.store.size, SWEEP_HALT_AT + 1);
});
