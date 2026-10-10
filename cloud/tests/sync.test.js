// Live sync, the server side (docs/KennelOS_Cloud_Phase2_Sync_Plan.md §6; build step 2).
// The server never opens a record, so the sealed parts are opaque stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn, push, sha, bytes } from './helpers/env.js';

const { runRetention } = await import('../src/retention.js');
const { MAX_PUSH_RECORDS, MAX_RECORD_BYTES, TOMBSTONE_KEEP_DAYS, SYNC_OFF_KEEP_DAYS, cloudPartProblem } = await import('../src/sync.js');
const { exportAll } = await import('../src/backup.js');

const PHONE = '11111111-1111-4111-8111-111111111111';
const LAPTOP = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'breeder@example.com';
const KEY_ID = 'a'.repeat(32);
const WRAP = Buffer.from(new Uint8Array(60).fill(7)).toString('base64');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

function makePro(env, s) {
  const { email_hash: eh } = env.DB.raw.prepare('SELECT u.email_hash FROM users u JOIN programs p ON p.owner_user_id = u.id WHERE p.id = ?').get(s.programId);
  env.DB.raw.prepare(
    `INSERT OR IGNORE INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
     VALUES (?, ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`,
  ).run(`order:${s.programId}`, eh, iso(Date.now()), iso(Date.now()));
}

// Two signed-in devices of one Pro program with the vault on; sync on unless `enable: false`.
async function program(env, { enable = true, vault = true } = {}) {
  const phone = await signIn(env, EMAIL, { deviceId: PHONE, deviceLabel: "Jen's iPhone" });
  const laptop = await signIn(env, EMAIL, { deviceId: LAPTOP, deviceLabel: 'Laptop' });
  makePro(env, phone);
  if (vault) await call(env, 'POST', '/vault', { token: phone.token, body: { keyId: KEY_ID, recoveryWrap: WRAP } });
  if (enable) assert.equal((await call(env, 'POST', '/sync/enable', { token: phone.token })).status, 200);
  return { phone, laptop };
}

const sealed = (text) => Buffer.from(text).toString('base64');
const put = (tbl, id, { base = 0, cloud = { id }, text = `${tbl}/${id}`, extra = {} } = {}) =>
  ({ tbl, id, op: 'put', base_seq: base, cloud, sealed: sealed(text), key_id: KEY_ID, updated_at: '2026-10-10T00:00:00.000Z', ...extra });
const del = (tbl, id, base = 0) => ({ tbl, id, op: 'delete', base_seq: base });
const pushRecs = async (env, s, records) => {
  const res = await call(env, 'POST', '/sync/push', { token: s.token, body: { records } });
  return { status: res.status, body: await res.json() };
};
const pull = async (env, s, since = 0, limit) => {
  const res = await call(env, 'GET', `/sync/pull?since=${since}${limit ? `&limit=${limit}` : ''}`, { token: s.token });
  return { status: res.status, body: await res.json() };
};

test('sync needs Pro, the vault, and to be turned on', async () => {
  const env = await makeEnv();
  const s = await signIn(env, EMAIL, { deviceId: PHONE });
  assert.equal((await (await call(env, 'POST', '/sync/enable', { token: s.token })).json()).error, 'pro_required');
  makePro(env, s);
  assert.equal((await (await call(env, 'POST', '/sync/enable', { token: s.token })).json()).error, 'vault_required');
  await call(env, 'POST', '/vault', { token: s.token, body: { keyId: KEY_ID, recoveryWrap: WRAP } });
  assert.equal((await pushRecs(env, s, [put('dogs', 'd1')])).body.error, 'sync_off');
  const on = await (await call(env, 'POST', '/sync/enable', { token: s.token })).json();
  assert.deepEqual(on, { enabled: true, seq: 0, keyId: KEY_ID });
  assert.deepEqual(await (await call(env, 'GET', '/sync/head', { token: s.token })).json(), { enabled: true, seq: 0, keyId: KEY_ID });
});

test('a push numbers each record in order; a pull returns them in seq order, the other device included', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await program(env);
  const a = await pushRecs(env, phone, [put('kennels', 'k1'), put('dogs', 'd1'), put('dogs', 'd2')]);
  assert.equal(a.status, 200);
  assert.equal(a.body.seq, 3);
  assert.deepEqual(a.body.accepted.map((x) => [x.id, x.seq]), [['k1', 1], ['d1', 2], ['d2', 3]]);
  const b = await pushRecs(env, laptop, [put('dogs', 'd1', { base: 2, text: 'v2' })]);
  assert.deepEqual(b.body.accepted, [{ tbl: 'dogs', id: 'd1', seq: 4 }]);
  assert.deepEqual(b.body.superseded, [], 'it had seen the version it replaced');

  const all = await pull(env, phone, 0);
  assert.deepEqual(all.body.records.map((r) => [r.id, r.seq]), [['k1', 1], ['d2', 3], ['d1', 4]]);
  assert.equal(all.body.records[2].sealed, sealed('v2'));
  assert.equal(all.body.records[2].device_id, LAPTOP);
  assert.equal('cloud' in all.body.records[0], false, 'a pull carries the sealed row only');
  assert.equal(all.body.more, false);
  const since = await pull(env, phone, 3);
  assert.deepEqual(since.body.records.map((r) => r.id), ['d1']);
  // Paging.
  const page = await pull(env, phone, 0, 2);
  assert.equal(page.body.more, true);
  assert.equal(page.body.through, 3);
});

test('interleaved pushes never share a seq', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await program(env);
  const batches = [];
  for (let i = 0; i < 10; i++) batches.push(pushRecs(env, i % 2 ? phone : laptop, [put('dogs', `a${i}`), put('dogs', `b${i}`)]));
  const results = await Promise.all(batches);
  const seqs = results.flatMap((r) => r.body.accepted.map((x) => x.seq)).sort((x, y) => x - y);
  assert.deepEqual(seqs, Array.from({ length: 20 }, (_, i) => i + 1));
});

test('the last version received wins; an overwrite of an unseen version is reported as superseded', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await program(env);
  await pushRecs(env, phone, [put('dogs', 'd1', { text: 'phone 1' })]);
  await pushRecs(env, phone, [put('dogs', 'd1', { base: 1, text: 'phone 2' })]);
  const late = await pushRecs(env, laptop, [put('dogs', 'd1', { base: 1, text: 'laptop' })]);
  assert.deepEqual(late.body.superseded, [{ tbl: 'dogs', id: 'd1', seq: 3, overwrote: 2 }]);
  assert.equal((await pull(env, phone, 0)).body.records[0].sealed, sealed('laptop'));
});

test('deletes are tombstones: a full pull leaves them out, a cursor pull carries them', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await program(env);
  await pushRecs(env, phone, [put('dogs', 'd1'), put('dogs', 'd2')]);
  await pushRecs(env, laptop, [del('dogs', 'd1', 1)]);
  assert.deepEqual((await pull(env, phone, 0)).body.records.map((r) => r.id), ['d2']);
  const since = (await pull(env, phone, 2)).body.records;
  assert.deepEqual(since, [{ tbl: 'dogs', id: 'd1', seq: 3, op: 'delete', device_id: LAPTOP, received_at: since[0].received_at }]);
  const row = env.DB.raw.prepare("SELECT sealed, cloud_json FROM sync_records WHERE id = 'd1'").get();
  assert.deepEqual([row.sealed, row.cloud_json], [null, null], 'the payload is gone');
});

test('a tombstone past 90 days goes; a cursor below it must re-join (410), a full pull is fine', async () => {
  const env = await makeEnv();
  const { phone } = await program(env);
  await pushRecs(env, phone, [put('dogs', 'd1'), put('dogs', 'd2')]);
  await pushRecs(env, phone, [del('dogs', 'd1', 1)]);
  await pushRecs(env, phone, [put('dogs', 'd3')]);
  env.DB.raw.prepare("UPDATE sync_records SET received_at = ? WHERE id = 'd1'").run(iso(Date.now() - (TOMBSTONE_KEEP_DAYS + 1) * DAY));
  await runRetention(env);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sync_records WHERE id = 'd1'").get().n, 0);
  const stale = await pull(env, phone, 2);
  assert.equal(stale.status, 410);
  assert.equal(stale.body.error, 'resync_required');
  assert.equal((await pull(env, phone, 3)).status, 200);
  assert.deepEqual((await pull(env, phone, 0)).body.records.map((r) => r.id), ['d2', 'd3']);
});

test('the cloud part is held to the allow-list: a record with another key is dropped, the rest go through', async () => {
  const env = await makeEnv();
  const { phone } = await program(env);
  const res = await pushRecs(env, phone, [
    put('contacts', 'c1', { cloud: { id: 'c1', name: 'Pat', email: 'pat@example.com' } }),
    put('contacts', 'c2', { cloud: { id: 'c2', name: 'Lee' } }),
    put('waitlist_entries', 'w1', { cloud: { id: 'w1', application: { name: 'Ann', phone: '555' } } }),
    put('events', 'e1', { cloud: { id: 'e1', event_type: 'vet_visit', details: { treatment: 'secret' } } }),
    put('expenses', 'x1', { cloud: null }),
  ]);
  assert.deepEqual(res.body.dropped.map((d) => [d.id, d.reason]), [
    ['c1', 'cloud_key:email'], ['w1', 'cloud_key:application.phone'], ['e1', 'cloud_key:details.treatment'],
  ]);
  assert.deepEqual(res.body.accepted.map((a) => a.id), ['c2', 'x1']);
  assert.equal(env.DB.raw.prepare("SELECT cloud_json FROM sync_records WHERE id = 'x1'").get().cloud_json, null);
  assert.equal(cloudPartProblem('contacts', { id: 'c', name: 'n' }), null);
});

test('refusals: a stale vault key, a bad table, too many records, an oversized record, a missing file', async () => {
  const env = await makeEnv();
  const { phone } = await program(env);
  assert.equal((await pushRecs(env, phone, [put('dogs', 'd1', { extra: { key_id: 'b'.repeat(32) } })])).body.error, 'vault_key_stale');
  assert.equal((await pushRecs(env, phone, [put('sync_meta', 'x')])).body.error, 'bad_table');
  assert.equal((await pushRecs(env, phone, [put('dogs', 'd1'), put('dogs', 'd1')])).body.error, 'duplicate_record');
  const many = Array.from({ length: MAX_PUSH_RECORDS + 1 }, (_, i) => put('dogs', `d${i}`));
  assert.equal((await pushRecs(env, phone, many)).body.error, 'bad_records');
  const big = await pushRecs(env, phone, [put('kennels', 'k1', { text: 'x'.repeat(MAX_RECORD_BYTES) })]);
  assert.ok([200, 413].includes(big.status));
  if (big.status === 200) assert.deepEqual(big.body.dropped, [{ tbl: 'kennels', id: 'k1', reason: 'too_large' }]);
  const missing = await pushRecs(env, phone, [put('files', 'f1', { cloud: null, extra: { file: 'c'.repeat(64) } })]);
  assert.equal(missing.body.error, 'missing_files');
});

test('a synced file\'s bytes outlive every snapshot while its record lives', async () => {
  const env = await makeEnv();
  const { phone } = await program(env);
  const blob = bytes('%PDF private contract (ciphertext stand-in)');
  assert.equal((await call(env, 'PUT', `/files/${sha(blob)}`, { token: phone.token, body: blob })).status, 200);
  assert.equal((await pushRecs(env, phone, [put('files', 'f1', { cloud: null, extra: { file: sha(blob) } })])).status, 200);
  env.DB.raw.prepare('UPDATE files SET created_at = ?').run(iso(Date.now() - 3 * DAY));
  await runRetention(env);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM files').get().n, 1, 'kept: a record names it');
  await pushRecs(env, phone, [del('files', 'f1', 1)]);
  await runRetention(env);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM files').get().n, 0, 'gone once the record is deleted');
});

test('snapshots on a syncing program: any device that is caught up, never one that is behind', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await program(env);
  await pushRecs(env, phone, [put('dogs', 'd1')]);
  const describe = (s, syncSeq, base = null) => call(env, 'POST', '/snapshots', {
    token: s.token, body: { base_snapshot_id: base, size: 3, counts: { dogs: 1 }, files: [], vault: { size: 3, keyId: KEY_ID }, ...(syncSeq === undefined ? {} : { sync_seq: syncSeq }) },
  });
  const behind = await describe(laptop, 0);
  assert.equal(behind.status, 409);
  assert.equal((await behind.json()).error, 'not_caught_up');
  const old = await describe(laptop, undefined);
  assert.equal((await old.json()).syncing, true, 'a device that doesn\'t sync (Lite) hears the program syncs');

  const { snapshotId } = await (await describe(laptop, 1)).json();
  await call(env, 'PUT', `/snapshots/${snapshotId}/vault`, { token: laptop.token, body: bytes('vlt') });
  // A record arrives between the description and the commit: refused.
  await pushRecs(env, phone, [put('dogs', 'd2')]);
  const late = await call(env, 'PUT', `/snapshots/${snapshotId}/body`, { token: laptop.token, body: bytes('abc') });
  assert.equal((await late.json()).error, 'not_caught_up');

  const again = await (await describe(laptop, 2)).json();
  await call(env, 'PUT', `/snapshots/${again.snapshotId}/vault`, { token: laptop.token, body: bytes('vlt') });
  assert.equal((await call(env, 'PUT', `/snapshots/${again.snapshotId}/body`, { token: laptop.token, body: bytes('abc') })).status, 200);
  const prog = env.DB.raw.prepare('SELECT latest_snapshot_id, backing_device_id FROM programs').get();
  assert.equal(prog.latest_snapshot_id, again.snapshotId);
  assert.equal(env.DB.raw.prepare('SELECT sync_seq FROM snapshots WHERE id = ?').get(again.snapshotId).sync_seq, 2);
  // Then the phone, caught up too, on that base.
  const next = await (await describe(phone, 2, again.snapshotId)).json();
  assert.ok(next.snapshotId);
});

test('Phase 1 programs are untouched: the backing-device rule as before', async () => {
  const env = await makeEnv();
  const phone = await signIn(env, EMAIL, { deviceId: PHONE });
  const laptop = await signIn(env, EMAIL, { deviceId: LAPTOP });
  assert.equal((await push(env, phone)).status, 200);
  const res = await push(env, laptop, { base: env.DB.raw.prepare('SELECT latest_snapshot_id AS id FROM programs').get().id });
  assert.equal((await res.json()).error, 'not_backing_device');
});

test('turning it off: a fresh sign-in; records kept 30 days, then gone and any cursor must re-join', async () => {
  const env = await makeEnv();
  const { phone } = await program(env);
  await pushRecs(env, phone, [put('dogs', 'd1')]);
  await call(env, 'POST', '/sync/cursor', { token: phone.token, body: { seq: 1 } });
  env.DB.raw.prepare("UPDATE sessions SET created_at = '2026-01-01T00:00:00.000Z'").run();
  assert.equal((await (await call(env, 'DELETE', '/sync', { token: phone.token, body: {} })).json()).error, 'reauth_required');
  env.DB.raw.prepare('UPDATE sessions SET created_at = ?').run(iso(Date.now()));
  assert.equal((await call(env, 'DELETE', '/sync', { token: phone.token, body: {} })).status, 200);
  assert.equal((await pull(env, phone, 0)).body.error, 'sync_off');
  await runRetention(env);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sync_records').get().n, 1, 'kept for now');
  env.DB.raw.prepare('UPDATE programs SET sync_disabled_at = ?').run(iso(Date.now() - (SYNC_OFF_KEEP_DAYS + 1) * DAY));
  await runRetention(env);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sync_records').get().n, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sync_devices').get().n, 0);
  await call(env, 'POST', '/sync/enable', { token: phone.token });
  assert.equal((await pull(env, phone, 1)).status, 410, 'an old cursor re-joins');
});

test('cursor, account deletion, export, and a lapsed license', async () => {
  const env = await makeEnv();
  const { phone } = await program(env);
  await pushRecs(env, phone, [put('dogs', 'd1')]);
  assert.equal((await call(env, 'POST', '/sync/cursor', { token: phone.token, body: { seq: 5 } })).status, 400);
  assert.equal((await call(env, 'POST', '/sync/cursor', { token: phone.token, body: { seq: 1 } })).status, 200);
  const exported = await exportAll(env.DB);
  assert.ok('sync_devices' in exported.tables);
  assert.ok(!('sync_records' in exported.tables), 'records are not in the D1 export');

  env.DB.raw.prepare('DELETE FROM pro_purchases').run();
  assert.equal((await pull(env, phone, 0)).body.error, 'pro_required', 'a lapsed license pauses sync (decision 6)');

  makePro(env, phone);
  assert.equal((await call(env, 'DELETE', '/account', { token: phone.token, body: { confirm: 'DELETE' } })).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sync_records').get().n, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sync_devices').get().n, 0);
});

test('a lapsed license can still turn sync off', async () => {
  const env = await makeEnv();
  const { phone } = await program(env);
  env.DB.raw.prepare('DELETE FROM pro_purchases').run();
  assert.equal((await call(env, 'DELETE', '/sync', { token: phone.token, body: {} })).status, 200);
});
