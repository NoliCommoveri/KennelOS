import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worker } from './helpers/worker.js';
import { makeEnv, call, signIn } from './helpers/env.js';

const { runRetention } = await import('../src/retention.js');
const PHONE = '11111111-1111-4111-8111-111111111111';
const LAPTOP = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'twice@example.com';

const opsReq = (path, init = {}) => new Request(`https://api.example${path}`, init);
async function ops(env, path, fields) {
  const login = await worker.fetch(opsReq('/ops/login', { method: 'POST', body: new URLSearchParams({ token: env.OPS_TOKEN }) }), env);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return worker.fetch(opsReq(path, { method: 'POST', body: new URLSearchParams(fields), headers: { Cookie: cookie } }), env);
}
const count = (env, table) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const userId = (env) => env.DB.raw.prepare('SELECT id FROM users').get().id;
async function refusal(env, token, path = '/program') {
  const res = await call(env, 'GET', path, { token });
  return { status: res.status, ...(await res.json()) };
}

test('deleting your own account: your other devices hear account_deleted, without erase', async () => {
  const env = await makeEnv();
  const phone = await signIn(env, EMAIL, { deviceId: PHONE, deviceLabel: 'Phone' });
  const laptop = await signIn(env, EMAIL, { deviceId: LAPTOP, deviceLabel: 'Laptop' });
  assert.equal((await call(env, 'DELETE', '/account', { token: laptop.token, body: { confirm: 'DELETE' } })).status, 200);
  assert.deepEqual(await refusal(env, phone.token), { status: 401, error: 'account_deleted', erase: false });
  assert.equal((await refusal(env, laptop.token)).error, 'unauthorized', 'the deleting device signs itself out');
  assert.equal(count(env, 'users'), 0);
  assert.equal(count(env, 'sessions'), 0);
});

test('/ops looks an account up by email without showing the address, and refuses an unknown one', async () => {
  const env = await makeEnv();
  await signIn(env, EMAIL, { deviceId: PHONE, deviceLabel: "Dana's Pixel" });
  const html = await (await ops(env, '/ops/account/find', { email: ` ${EMAIL.toUpperCase()} ` })).text();
  assert.match(html, /Dana&#39;s Pixel|Dana's Pixel/);
  assert.match(html, /Type DELETE to confirm/);
  assert.doesNotMatch(html, /twice@example\.com/i);
  assert.match(await (await ops(env, '/ops/account/find', { email: 'nobody@example.com' })).text(), /No account uses that address/);
});

test('/ops deletes nothing without the typed confirmation', async () => {
  const env = await makeEnv();
  await signIn(env, EMAIL, { deviceId: PHONE });
  const html = await (await ops(env, '/ops/account/delete', { user_id: userId(env), erase: '1', confirm: 'delete it' })).text();
  assert.match(html, /Nothing was deleted/);
  assert.equal(count(env, 'users'), 1);
});

test('/ops delete with erase: everything goes, devices hear erase, the address can start over', async () => {
  const env = await makeEnv();
  const phone = await signIn(env, EMAIL, { deviceId: PHONE });
  const laptop = await signIn(env, EMAIL, { deviceId: LAPTOP });
  await call(env, 'POST', '/auth/signout', { token: laptop.token, body: {} }); // a signed-out device hears it too

  const html = await (await ops(env, '/ops/account/delete', { user_id: userId(env), erase: '1', confirm: 'DELETE' })).text();
  assert.match(html, /Account deleted\. Its 2 device\(s\) will erase themselves/);
  for (const t of ['users', 'programs', 'sessions']) assert.equal(count(env, t), 0, t);

  assert.deepEqual(await refusal(env, phone.token), { status: 401, error: 'account_deleted', erase: true });
  assert.deepEqual(await refusal(env, laptop.token), { status: 401, error: 'account_deleted', erase: true });
  // The erased device's acknowledgement is refused the same way, and it clears it.
  assert.equal((await call(env, 'POST', '/devices/erase-ack', { token: phone.token, body: {} })).status, 401);

  // The same address makes a brand-new account.
  const fresh = await signIn(env, EMAIL, { deviceId: PHONE });
  assert.equal((await call(env, 'GET', '/program', { token: fresh.token })).status, 200);
  assert.notEqual(fresh.programId, phone.programId);
});

test('/ops delete without erase: devices keep their records and hear erase: false', async () => {
  const env = await makeEnv();
  const phone = await signIn(env, EMAIL, { deviceId: PHONE });
  await ops(env, '/ops/account/delete', { user_id: userId(env), confirm: 'DELETE' });
  assert.deepEqual(await refusal(env, phone.token), { status: 401, error: 'account_deleted', erase: false });
});

test('retention forgets deleted accounts after 90 days', async () => {
  const env = await makeEnv();
  const phone = await signIn(env, EMAIL, { deviceId: PHONE });
  await ops(env, '/ops/account/delete', { user_id: userId(env), erase: '1', confirm: 'DELETE' });
  await runRetention(env);
  assert.equal(count(env, 'account_deletions'), 1, 'kept while recent');
  env.DB.raw.prepare("UPDATE account_deletions SET deleted_at = '2000-01-01T00:00:00.000Z'").run();
  await runRetention(env);
  assert.equal(count(env, 'account_deletions'), 0);
  assert.equal((await refusal(env, phone.token)).error, 'unauthorized');
});
