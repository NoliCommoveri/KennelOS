import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { makeEnv, call, signIn, push, sha, bytes } from './helpers/env.js';

test('files: upload once, HEAD finds it, GET returns it, a second upload is a no-op', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const pdf = bytes('%PDF hip score');
  const h = sha(pdf);

  assert.equal((await call(env, 'HEAD', `/files/${h}`, { token: s.token })).status, 404);
  const put = await call(env, 'PUT', `/files/${h}`, { token: s.token, body: pdf, headers: { 'content-type': 'application/pdf' } });
  assert.deepEqual(await put.json(), { ok: true, existed: false });
  assert.equal((await call(env, 'HEAD', `/files/${h}`, { token: s.token })).status, 200);

  const got = await call(env, 'GET', `/files/${h}`, { token: s.token });
  assert.equal(got.headers.get('content-type'), 'application/pdf');
  assert.equal(await got.text(), '%PDF hip score');
  assert.equal((await (await call(env, 'PUT', `/files/${h}`, { token: s.token, body: pdf })).json()).existed, true);
});

test('files: a body that does not match its sha256 is refused and nothing is recorded', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const res = await call(env, 'PUT', `/files/${sha(bytes('one'))}`, { token: s.token, body: bytes('two') });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'hash_mismatch');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM files').get().n, 0);
});

test('files: over 25 MB is refused before reading, and a length is required', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const h = sha(bytes('x'));
  const big = await call(env, 'PUT', `/files/${h}`, { token: s.token, body: bytes('x'), headers: { 'content-length': String(26 * 1024 * 1024) } });
  assert.equal(big.status, 413);
  assert.equal((await call(env, 'PUT', `/files/not-a-hash`, { token: s.token, body: bytes('x') })).status, 400);
});

test("files: one program can't see another's", async () => {
  const env = await makeEnv();
  const a = await signIn(env, 'a@b.co');
  const b = await signIn(env, 'c@d.co');
  const f = bytes('private pedigree');
  await call(env, 'PUT', `/files/${sha(f)}`, { token: a.token, body: f });
  assert.equal((await call(env, 'HEAD', `/files/${sha(f)}`, { token: b.token })).status, 404);
  assert.equal((await call(env, 'GET', `/files/${sha(f)}`, { token: b.token })).status, 404);
});

test('snapshots: push, list, download, and the program points at it', async () => {
  const env = await makeEnv();
  const s = await signIn(env, 'a@b.co', { deviceLabel: "Jen's iPhone" });
  const doc = bytes('health test');
  const res = await push(env, s, { files: [doc], payload: 'gz' });
  assert.equal(res.status, 200);
  const { snapshotId } = await res.json();

  const list = await (await call(env, 'GET', '/snapshots', { token: s.token })).json();
  assert.equal(list.snapshots.length, 1);
  assert.deepEqual(list.snapshots[0].counts, { dogs: 3 });
  assert.equal(list.snapshots[0].deviceLabel, "Jen's iPhone");

  assert.equal(await (await call(env, 'GET', `/snapshots/${snapshotId}`, { token: s.token })).text(), 'gz');
  const program = await (await call(env, 'GET', '/program', { token: s.token })).json();
  assert.equal(program.latestSnapshot.id, snapshotId);
  assert.equal(program.backingDevice.id, s.deviceId);
  assert.equal(program.backingDevice.label, "Jen's iPhone");
});

test('snapshots: real gzip bytes come back byte for byte', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const { gzipSync } = await import('node:zlib');
  const gz = new Uint8Array(gzipSync(JSON.stringify({ snapshot_format: 1 })));
  const created = await (await call(env, 'POST', '/snapshots', { token: s.token, body: { base_snapshot_id: null, size: gz.length, counts: {}, files: [] } })).json();
  await call(env, 'PUT', `/snapshots/${created.snapshotId}/body`, { token: s.token, body: gz });
  const back = new Uint8Array(await (await call(env, 'GET', `/snapshots/${created.snapshotId}`, { token: s.token })).arrayBuffer());
  assert.deepEqual(JSON.parse(gunzipSync(back)), { snapshot_format: 1 });
});

test('snapshots: a referenced file that was never uploaded is refused by name', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const missing = sha(bytes('never uploaded'));
  const res = await call(env, 'POST', '/snapshots', { token: s.token, body: { base_snapshot_id: null, size: 2, counts: {}, files: [missing] } });
  assert.equal(res.status, 400);
  assert.deepEqual((await res.json()).missing, [missing]);
});

test('snapshots: hundreds of file references go through one bound parameter', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const docs = Array.from({ length: 250 }, (_, i) => bytes(`doc ${i}`));
  assert.equal((await push(env, s, { files: docs })).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM snapshot_files').get().n, 250);
});

test('snapshots: the next push must name the latest as its base', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const first = await (await push(env, s)).json();
  const stale = await push(env, s, { base: null });
  assert.equal(stale.status, 409);
  assert.equal((await push(env, s, { base: first.snapshotId })).status, 200);
});

test('snapshots: a second device gets 409 naming the backing device, until it takes over', async () => {
  const env = await makeEnv();
  const phone = await signIn(env, 'a@b.co', { deviceLabel: "Jen's iPhone" });
  const first = await (await push(env, phone)).json();

  const laptop = await signIn(env, 'a@b.co', { deviceLabel: 'Laptop' });
  const refused = await push(env, laptop, { base: first.snapshotId });
  assert.equal(refused.status, 409);
  const info = await refused.json();
  assert.equal(info.error, 'not_backing_device');
  assert.equal(info.backingDevice.label, "Jen's iPhone");
  assert.ok(info.backingDevice.lastPushAt);

  const took = await (await call(env, 'POST', '/program/backing-device', { token: laptop.token })).json();
  assert.equal(took.backingDevice.id, laptop.deviceId);
  assert.equal((await push(env, laptop, { base: took.latestSnapshotId })).status, 200);
  assert.equal((await push(env, phone, { base: took.latestSnapshotId })).status, 409, 'the phone is now the stranger');
});

test('snapshots: the 409 names the backing device\'s edition (Lite → Pro upgrade)', async () => {
  const env = await makeEnv();
  const lite = await signIn(env, 'a@b.co', { deviceLabel: 'Lite phone' });
  const first = await (await push(env, lite, { edition: 'lite' })).json();
  const pro = await signIn(env, 'a@b.co', { deviceLabel: 'Pro laptop' });
  const took = await (await call(env, 'POST', '/program/backing-device', { token: pro.token })).json();
  assert.equal(took.latestSnapshotId, first.snapshotId);
  assert.equal((await push(env, pro, { base: first.snapshotId, edition: 'pro' })).status, 200);

  const refused = await push(env, lite, { base: first.snapshotId, edition: 'lite' });
  assert.equal(refused.status, 409);
  const info = await refused.json();
  assert.equal(info.backingDevice.label, 'Pro laptop');
  assert.equal(info.backingDevice.edition, 'pro');
  const list = await (await call(env, 'GET', '/snapshots', { token: pro.token })).json();
  assert.deepEqual(list.snapshots.map((x) => x.edition), ['pro', 'lite']);
});

test('snapshots: an unknown or missing edition is stored as null', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const a = await (await push(env, s, { edition: 'demo' })).json();
  await push(env, s, { base: a.snapshotId });
  const list = await (await call(env, 'GET', '/snapshots', { token: s.token })).json();
  assert.deepEqual(list.snapshots.map((x) => x.edition), [null, null]);
});

test('snapshots: a takeover between describe and upload loses the race cleanly', async () => {
  const env = await makeEnv();
  const phone = await signIn(env, 'a@b.co');
  const laptop = await signIn(env, 'a@b.co');
  const body = bytes('race');
  const { snapshotId } = await (await call(env, 'POST', '/snapshots', { token: phone.token, body: { base_snapshot_id: null, size: body.length, counts: {}, files: [] } })).json();
  await call(env, 'POST', '/program/backing-device', { token: laptop.token });

  const res = await call(env, 'PUT', `/snapshots/${snapshotId}/body`, { token: phone.token, body });
  assert.equal(res.status, 409);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n, 0, 'the loser leaves no row');
  assert.equal(env.FILES.store.size, 0, 'and no object');
});

test('snapshots: body size must match what was described, and only the describing device may upload', async () => {
  const env = await makeEnv();
  const phone = await signIn(env, 'a@b.co');
  const laptop = await signIn(env, 'a@b.co');
  const { snapshotId } = await (await call(env, 'POST', '/snapshots', { token: phone.token, body: { base_snapshot_id: null, size: 10, counts: {}, files: [] } })).json();
  assert.equal((await call(env, 'PUT', `/snapshots/${snapshotId}/body`, { token: phone.token, body: bytes('short') })).status, 400);
  assert.equal((await call(env, 'PUT', `/snapshots/${snapshotId}/body`, { token: laptop.token, body: bytes('0123456789') })).status, 403);
});

test("snapshots: another program's snapshot is invisible", async () => {
  const env = await makeEnv();
  const a = await signIn(env, 'a@b.co');
  const b = await signIn(env, 'c@d.co');
  const { snapshotId } = await (await push(env, a)).json();
  assert.equal((await call(env, 'GET', `/snapshots/${snapshotId}`, { token: b.token })).status, 404);
  assert.deepEqual((await (await call(env, 'GET', '/snapshots', { token: b.token })).json()).snapshots, []);
});

test('delete account removes rows and R2 objects for that account only', async () => {
  const env = await makeEnv();
  const a = await signIn(env, 'a@b.co');
  const b = await signIn(env, 'c@d.co');
  await push(env, a, { files: [bytes('a doc')] });
  await push(env, b, { files: [bytes('b doc')] });

  assert.equal((await call(env, 'DELETE', '/account', { token: a.token, body: {} })).status, 400, 'needs the typed confirmation');
  assert.equal((await call(env, 'DELETE', '/account', { token: a.token, body: { confirm: 'DELETE' } })).status, 200);

  assert.equal((await call(env, 'GET', '/program', { token: a.token })).status, 401);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.ok([...env.FILES.store.keys()].every((k) => k.includes(b.programId)));
  assert.equal((await call(env, 'GET', '/program', { token: b.token })).status, 200);
});

test('notices are public, served even before migrations, and end on their date', async () => {
  const env = await makeEnv();
  env.DB.raw.prepare("INSERT INTO notices (id, level, message, until, created_at) VALUES ('1', 'shutdown', 'Closing 1 March', NULL, '2026-01-01'), ('2', 'info', 'old', '2000-01-01T00:00:00Z', '2000-01-01')").run();
  const res = await call(env, 'GET', '/notice');
  assert.match(res.headers.get('cache-control'), /public/);
  assert.deepEqual((await res.json()).notices.map((n) => n.message), ['Closing 1 March']);

  const { makeDb } = await import('./helpers/d1.js');
  const empty = await call({ DB: makeDb() }, 'GET', '/notice');
  assert.deepEqual(await empty.json(), { notices: [] });
});

test('snapshots: a stranger device is refused at the describe step, before any bytes move', async () => {
  const env = await makeEnv();
  const phone = await signIn(env, 'a@b.co');
  const { snapshotId } = await (await push(env, phone)).json();
  const laptop = await signIn(env, 'a@b.co');
  const res = await call(env, 'POST', '/snapshots', { token: laptop.token, body: { base_snapshot_id: snapshotId, size: 5, counts: {}, files: [] } });
  assert.equal(res.status, 409);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE status = 'pending'").get().n, 0);
});
