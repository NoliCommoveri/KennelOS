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
  assert.deepEqual(summary, { snapshotsDropped: 1, pendingDropped: 1, filesDropped: 1, r2Deleted: 3 });

  const ids = env.DB.raw.prepare('SELECT id FROM snapshots').all().map((r) => r.id);
  assert.deepEqual(ids, [second.snapshotId]);
  const keys = [...env.FILES.store.keys()];
  assert.equal(keys.filter((k) => k.startsWith('files/')).length, 1);
  assert.ok(keys.some((k) => k.endsWith(`${second.snapshotId}.json.gz`)));

  assert.deepEqual(await runRetention(env, new Date()), { snapshotsDropped: 0, pendingDropped: 0, filesDropped: 0, r2Deleted: 0 }, 'a second run finds nothing');
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
