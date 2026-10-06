import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { worker, migrate, gate } from './helpers/worker.js';
import { makeDb, makeBucket } from './helpers/d1.js';

const LITE = 'https://lite.kennelos.app';
const req = (path, init = {}) => new Request(`https://api.example${path}`, init);

beforeEach(() => gate.resetGateCache());

test('before Apply pending every API route answers 503 maintenance, with CORS', async () => {
  const env = { DB: makeDb(), FILES: makeBucket() };
  const res = await worker.fetch(req('/program', { headers: { Origin: LITE } }), env);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { maintenance: true });
  assert.equal(res.headers.get('access-control-allow-origin'), LITE,
    'the 503 must be readable by the edition, or the client cannot tell maintenance from a dead network');

  const health = await worker.fetch(req('/health'), env);
  assert.deepEqual(await health.json(), { ok: false, maintenance: true });
});

test('after Apply pending the gate opens without a redeploy', async () => {
  const env = { DB: makeDb(), FILES: makeBucket() };
  await worker.fetch(req('/health'), env); // caches nothing while not ready
  await migrate.applyPending(env.DB);

  const health = await worker.fetch(req('/health'), env);
  assert.deepEqual(await health.json(), { ok: true, maintenance: false });
  const unknown = await worker.fetch(req('/nope'), env);
  assert.equal(unknown.status, 404);
});

test('a drifted migration closes the gate', async () => {
  const env = { DB: makeDb(), FILES: makeBucket() };
  await migrate.applyPending(env.DB);
  env.DB.raw.prepare("UPDATE _migrations SET checksum = 'x' WHERE id = '0001'").run();
  const res = await worker.fetch(req('/health'), env);
  assert.equal((await res.json()).maintenance, true);
});

test('no D1 binding answers 503, not a crash', async () => {
  const res = await worker.fetch(req('/program'), {});
  assert.equal(res.status, 503);
});

test('preflight: an edition and localhost are allowed, anything else is refused', async () => {
  const env = { DB: makeDb() };
  for (const origin of [LITE, 'https://pro.kennelos.app', 'http://localhost:8000', 'http://127.0.0.1:3000']) {
    const res = await worker.fetch(req('/snapshots', { method: 'OPTIONS', headers: { Origin: origin } }), env);
    assert.equal(res.status, 204, origin);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.match(res.headers.get('access-control-allow-headers'), /authorization/);
  }
  for (const origin of ['https://demo.kennelos.app', 'https://kennelos.app', 'https://evil.example', 'http://localhost.evil.example']) {
    const res = await worker.fetch(req('/snapshots', { method: 'OPTIONS', headers: { Origin: origin } }), env);
    assert.equal(res.status, 403, origin);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  }
});
