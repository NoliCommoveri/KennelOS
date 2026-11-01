import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worker, migrate, gate } from './helpers/worker.js';
import { makeDb, makeBucket } from './helpers/d1.js';
import { makeEnv, signIn, push, lastCode } from './helpers/env.js';

const opsReq = (path, init = {}) => new Request(`https://api.example${path}`, init);

async function opsCookie(env) {
  const res = await worker.fetch(opsReq('/ops/login', { method: 'POST', body: new URLSearchParams({ token: env.OPS_TOKEN }) }), env);
  return res.headers.get('set-cookie').split(';')[0];
}
async function ops(env, path, init = {}) {
  const headers = { Cookie: await opsCookie(env), ...(init.headers ?? {}) };
  return worker.fetch(opsReq(path, { ...init, headers }), env);
}

test('while a migration is pending, only the migration table shows', async () => {
  gate.resetGateCache();
  const env = { DB: makeDb(), FILES: makeBucket(), OPS_TOKEN: 'ops', DEV_OUTBOX: '1' };
  const html = await (await ops(env, '/ops')).text();
  assert.match(html, /appear once every migration is applied/);
  assert.doesNotMatch(html, /Run retention now/);
});

test('the staging outbox shows the code, never the address', async () => {
  const env = await makeEnv();
  const { call } = await import('./helpers/env.js');
  await call(env, 'POST', '/auth/start', { body: { email: 'outbox@example.com' } });
  const html = await (await ops(env, '/ops')).text();
  assert.match(html, new RegExp(lastCode(env)));
  assert.doesNotMatch(html, /outbox@example\.com/);
});

test('no outbox section without DEV_OUTBOX', async () => {
  const env = await makeEnv({ DEV_OUTBOX: undefined });
  assert.doesNotMatch(await (await ops(env, '/ops')).text(), /staging outbox/);
});

test('a notice added on /ops is served by /notice, and removing it ends it', async () => {
  const env = await makeEnv();
  const body = new URLSearchParams({ level: 'shutdown', message: 'KennelOS cloud closes on 1 March', until: '' });
  assert.match(await (await ops(env, '/ops/notices', { method: 'POST', body })).text(), /Notice added/);
  const served = await (await worker.fetch(opsReq('/notice'), env)).json();
  assert.equal(served.notices[0].message, 'KennelOS cloud closes on 1 March');

  const id = served.notices[0].id;
  await ops(env, '/ops/notices/remove', { method: 'POST', body: new URLSearchParams({ id }) });
  assert.deepEqual((await (await worker.fetch(opsReq('/notice'), env)).json()).notices, []);

  const bad = await ops(env, '/ops/notices', { method: 'POST', body: new URLSearchParams({ level: 'panic', message: 'x' }) });
  assert.match(await bad.text(), /Level must be/);
});

test('Run retention now reports what it removed', async () => {
  const env = await makeEnv();
  assert.match(await (await ops(env, '/ops/retention', { method: 'POST' })).text(), /Retention done: 0 snapshots/);
});

test('export, then import into a fresh database, gives the same rows', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  await push(env, s);
  const exported = await (await ops(env, '/ops/export.json')).text();
  const data = JSON.parse(exported);
  assert.equal(data.format, 'kennelos-cloud-d1');
  assert.equal(data.tables.users.length, 1);
  assert.equal(data.tables.snapshots.length, 1);
  assert.equal(data.tables.login_codes, undefined, 'ephemeral tables are not exported');

  const fresh = { DB: makeDb(), FILES: makeBucket(), OPS_TOKEN: 'ops' };
  await migrate.applyPending(fresh.DB);
  const form = new FormData();
  form.set('file', new File([exported], 'export.json', { type: 'application/json' }));
  const html = await (await ops(fresh, '/ops/import', { method: 'POST', body: form })).text();
  assert.match(html, /Imported \d+ rows/);
  for (const t of ['users', 'programs', 'sessions', 'snapshots']) {
    assert.deepEqual(fresh.DB.raw.prepare(`SELECT * FROM ${t}`).all(), env.DB.raw.prepare(`SELECT * FROM ${t}`).all(), t);
  }

  // A second import is refused, and writes nothing.
  const again = await (await ops(fresh, '/ops/import', { method: 'POST', body: form })).text();
  assert.match(again, /Nothing was imported\. Table users already has 1 rows/);
});

test('import refuses an unknown column or a different schema version before writing', async () => {
  const env = await makeEnv();
  const send = async (data) => {
    const form = new FormData();
    form.set('file', new File([JSON.stringify(data)], 'x.json'));
    return (await ops(env, '/ops/import', { method: 'POST', body: form })).text();
  };
  const version = (await (await ops(env, '/ops/export.json')).json()).schema_version;
  assert.match(await send({ format: 'kennelos-cloud-d1', schema_version: '0001', tables: {} }), /The file is schema 0001/);
  assert.match(await send({ format: 'kennelos-cloud-d1', schema_version: version, tables: { users: [{ id: 'u', email_hash: 'h', created_at: 'x', evil: 1 }] } }), /no column evil/);
  assert.match(await send({ format: 'kennelos-cloud-d1', schema_version: version, tables: { users: [], bogus: [] } }), /Unknown table bogus/);
  assert.match(await send({ hello: 1 }), /not a KennelOS cloud export/);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('emails sent month to date, by kind', async () => {
  const env = await makeEnv();
  const month = new Date().toISOString().slice(0, 7);
  env.DB.raw.prepare('INSERT INTO mail_counts (month, kind, sent, failed, first_at) VALUES (?, ?, ?, ?, ?)').run(month, 'family', 12, 1, `${month}-01T08:00:00.000Z`);
  env.DB.raw.prepare('INSERT INTO mail_counts (month, kind, sent, failed, first_at) VALUES (?, ?, ?, ?, ?)').run(month, 'code', 30, 0, `${month}-01T09:00:00.000Z`);
  env.DB.raw.prepare('INSERT INTO mail_counts (month, kind, sent, failed, first_at) VALUES (?, ?, ?, ?, ?)').run('2000-01', 'code', 999, 0, '2000-01-01T00:00:00.000Z');
  const html = await (await ops(env, '/ops')).text();
  assert.match(html, /month to date/);
  assert.match(html, /<strong[^>]*>42<\/strong> sent · <span class="bad">1 failed<\/span>/, 'only this month');
  assert.match(html, /Emails to families<\/td><td>12<\/td>/);
});

test('the Mapbox key: off without the secret, working or not with it, checked with fixed places only', async () => {
  const realFetch = globalThis.fetch;
  try {
    let html = await (await ops(await makeEnv(), '/ops')).text();
    assert.match(html, /Driving miles \(Mapbox\)<\/td><td>off: secret <code>MAPBOX_TOKEN<\/code> is not set/);
    const env = await makeEnv({ MAPBOX_TOKEN: 'pk.test' });
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/geocode/')) return Response.json({ features: [{ geometry: { coordinates: [-104.99, 39.74] } }] });
      return Response.json({ routes: [{ distance: 46671 }] });
    };
    html = await (await ops(env, '/ops')).text();
    assert.match(html, /<span class="ok">working<\/span>.*29 mi/);
    assert.equal(urls.length, 2);
    assert.match(urls[0], /Denver/);
    globalThis.fetch = async () => Response.json({ message: 'Not Authorized - Invalid Token' }, { status: 401 });
    html = await (await ops(env, '/ops')).text();
    assert.match(html, /not working.*address lookup, HTTP 401: Not Authorized - Invalid Token.*token is wrong/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
