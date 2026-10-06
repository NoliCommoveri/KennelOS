import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worker } from './helpers/worker.js';
import { makeDb, makeBucket } from './helpers/d1.js';

const TOKEN = 'correct horse battery staple';
const req = (path, init = {}) => new Request(`https://api.example${path}`, init);
const form = (fields) => ({ method: 'POST', body: new URLSearchParams(fields) });

async function signIn(env) {
  const res = await worker.fetch(req('/ops/login', form({ token: TOKEN })), env);
  assert.equal(res.status, 303);
  return res.headers.get('set-cookie').split(';')[0];
}

test('with no OPS_TOKEN set, /ops refuses everything and says how to set it', async () => {
  const env = { DB: makeDb() };
  for (const [path, init] of [['/ops', {}], ['/ops/migrate', { method: 'POST' }], ['/ops/login', form({ token: '' })]]) {
    const res = await worker.fetch(req(path, init), env);
    assert.equal(res.status, 503, path);
    assert.match(await res.text(), /OPS_TOKEN is not set/);
  }
  const tables = env.DB.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  assert.deepEqual(tables, [], 'nothing ran');
});

test('a wrong token gets the sign-in page and no cookie', async () => {
  const env = { DB: makeDb(), OPS_TOKEN: TOKEN };
  const res = await worker.fetch(req('/ops/login', form({ token: 'wrong' })), env);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.match(await res.text(), /did not match/);
});

test('signed out, Apply pending does nothing', async () => {
  const env = { DB: makeDb(), OPS_TOKEN: TOKEN };
  const res = await worker.fetch(req('/ops/migrate', { method: 'POST' }), env);
  assert.match(await res.text(), /Ops token/);
  const tables = env.DB.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'users'").all();
  assert.deepEqual(tables, []);
});

test('a forged or expired cookie is refused', async () => {
  const env = { DB: makeDb(), OPS_TOKEN: TOKEN };
  for (const cookie of ['ops_session=9999999999.deadbeef', 'ops_session=1.abc', 'ops_session=']) {
    const res = await worker.fetch(req('/ops', { headers: { Cookie: cookie } }), env);
    assert.match(await res.text(), /Ops token/, cookie);
  }
});

test('signed in: the dashboard shows 0001 pending, Apply pending applies it, and the API opens', async () => {
  const env = { DB: makeDb(), FILES: makeBucket(), OPS_TOKEN: TOKEN };
  const cookie = await signIn(env);

  const before = await (await worker.fetch(req('/ops', { headers: { Cookie: cookie } }), env)).text();
  assert.match(before, /pending/);
  assert.match(before, /answering 503/);

  const after = await (await worker.fetch(req('/ops/migrate', { method: 'POST', headers: { Cookie: cookie } }), env)).text();
  assert.match(after, /Applied <code>0001<\/code>/);
  assert.match(after, /Schema is current/);

  const health = await worker.fetch(req('/health'), env);
  assert.equal((await health.json()).ok, true);
});
