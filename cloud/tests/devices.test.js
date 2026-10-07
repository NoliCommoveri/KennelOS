import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn, push, lastCode } from './helpers/env.js';

const { runRetention } = await import('../src/retention.js');
const PHONE = '11111111-1111-4111-8111-111111111111';
const LAPTOP = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'breeder@example.com';

async function twoDevices(env) {
  const phone = await signIn(env, EMAIL, { deviceId: PHONE, deviceLabel: "Jen's iPhone" });
  const laptop = await signIn(env, EMAIL, { deviceId: LAPTOP, deviceLabel: 'Kitchen laptop' });
  return { phone, laptop };
}
const devices = async (env, token) => (await (await call(env, 'GET', '/devices', { token })).json()).devices;
const erase = (env, token, id, body = {}) => call(env, 'POST', `/devices/${id}/erase`, { token, body });
const ageSessions = (env, deviceId) =>
  env.DB.raw.prepare("UPDATE sessions SET created_at = '2026-01-01T00:00:00.000Z' WHERE device_id = ?").run(deviceId);

test('check-in records the Pro activation, keeps the session alive and carries the notices', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  env.DB.raw.prepare("INSERT INTO notices (id, level, message, until, created_at) VALUES ('n1', 'info', 'Hello', NULL, '2026-01-01')").run();
  env.DB.raw.prepare("UPDATE sessions SET last_seen_at = '2026-01-01T00:00:00.000Z', expires_at = ?").run(new Date(Date.now() + 3600e3).toISOString());

  const res = await call(env, 'POST', '/devices/check-in', { token: phone.token, body: { licenseInstanceId: 'inst-123' } });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).notices.map((n) => n.message), ['Hello']);
  const row = env.DB.raw.prepare('SELECT last_seen_at, expires_at FROM sessions WHERE device_id = ?').get(PHONE);
  assert.ok(Date.now() - Date.parse(row.last_seen_at) < 60e3);
  assert.ok(Date.parse(row.expires_at) - Date.now() > 80 * 86400e3);

  const list = await devices(env, laptop.token);
  assert.deepEqual(list.map((d) => [d.label, d.thisDevice, d.status, d.licenseInstanceId]), [
    ['Kitchen laptop', true, 'signed-in', null],
    ["Jen's iPhone", false, 'signed-in', 'inst-123'],
  ]);

  // A garbage instance id is not stored; a Lite check-in clears it.
  await call(env, 'POST', '/devices/check-in', { token: phone.token, body: { licenseInstanceId: '<script>' } });
  assert.equal((await devices(env, laptop.token))[1].licenseInstanceId, null);
});

test('the list says which devices an erase can still reach', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  const other = await signIn(env, EMAIL, { deviceId: '33333333-3333-4333-8333-333333333333', deviceLabel: 'Old tablet' });
  await call(env, 'POST', '/auth/signout', { token: other.token, body: {} });
  await call(env, 'POST', '/auth/signout-others', { token: laptop.token, body: {} });
  const byLabel = Object.fromEntries((await devices(env, laptop.token)).map((d) => [d.label, d.status]));
  assert.deepEqual(byLabel, { 'Kitchen laptop': 'signed-in', "Jen's iPhone": 'signed-out', 'Old tablet': 'signed-out-here' });
  assert.equal((await call(env, 'GET', '/devices', { token: phone.token })).status, 401);
});

test('erase: the lost device is signed out, every request it makes says device_erased, and it can acknowledge', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  const res = await erase(env, laptop.token, PHONE);
  assert.equal(res.status, 200);

  for (const [method, path] of [['GET', '/program'], ['POST', '/devices/check-in'], ['GET', '/snapshots']]) {
    const r = await call(env, method, path, { token: phone.token, body: method === 'POST' ? {} : undefined });
    assert.equal(r.status, 401, path);
    assert.equal((await r.json()).error, 'device_erased', path);
  }
  let d = (await devices(env, laptop.token)).find((x) => x.id === PHONE);
  assert.equal(d.erase.confirmedAt, null);
  assert.ok(d.erase.requestedAt);

  assert.equal((await call(env, 'POST', '/devices/erase-ack', { token: phone.token, body: {} })).status, 200);
  d = (await devices(env, laptop.token)).find((x) => x.id === PHONE);
  assert.ok(d.erase.confirmedAt);
  // Ack is only for an erased device.
  assert.equal((await call(env, 'POST', '/devices/erase-ack', { token: laptop.token, body: {} })).status, 400);
});

test('erase reaches a device that was already signed out from elsewhere, or whose session expired', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  await call(env, 'POST', '/auth/signout-others', { token: laptop.token, body: {} });
  env.DB.raw.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE device_id = ?").run(PHONE);
  assert.equal((await erase(env, laptop.token, PHONE)).status, 200);
  const r = await call(env, 'GET', '/program', { token: phone.token });
  assert.equal((await r.json()).error, 'device_erased');
});

test('erase needs a fresh sign-in: an old session must type a code sent to the account email', async () => {
  const env = await makeEnv();
  const { laptop } = await twoDevices(env);
  ageSessions(env, LAPTOP);

  const refused = await erase(env, laptop.token, PHONE);
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, 'reauth_required');

  // A code for a different address doesn't count.
  await call(env, 'POST', '/auth/start', { body: { email: 'thief@example.com' } });
  assert.equal((await erase(env, laptop.token, PHONE, { email: 'thief@example.com', code: lastCode(env) })).status, 400);

  await call(env, 'POST', '/auth/start', { body: { email: EMAIL } });
  const code = lastCode(env);
  assert.equal((await erase(env, laptop.token, PHONE, { email: ' Breeder@Example.com ', code: '000000' === code ? '111111' : '000000' })).status, 400);
  assert.equal((await erase(env, laptop.token, PHONE, { email: EMAIL, code })).status, 200);
  // The code is burned (the other address's unused one is all that's left).
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM login_codes').get().n, 1);
});

test('erase refuses this device and devices on other accounts', async () => {
  const env = await makeEnv();
  const { laptop } = await twoDevices(env);
  const stranger = await signIn(env, 'other@example.com', { deviceId: '44444444-4444-4444-8444-444444444444' });
  assert.equal((await erase(env, laptop.token, LAPTOP)).status, 400);
  assert.equal((await erase(env, laptop.token, stranger.deviceId)).status, 404);
  assert.equal((await erase(env, laptop.token, 'not-a-uuid')).status, 404);
  assert.equal((await call(env, 'GET', '/program', { token: stranger.token })).status, 200);
});

test('erasing the backup device frees the program for the next device', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  const { snapshotId } = await (await push(env, phone)).json();
  assert.equal((await push(env, laptop, { base: snapshotId })).status, 409);
  await erase(env, laptop.token, PHONE);
  assert.equal((await push(env, laptop, { base: snapshotId })).status, 200);
});

test('cancel: a found device signs in again and keeps working; too late once it confirmed', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  await erase(env, laptop.token, PHONE);
  assert.equal((await call(env, 'DELETE', `/devices/${PHONE}/erase`, { token: laptop.token })).status, 200);
  const old = await call(env, 'GET', '/program', { token: phone.token });
  assert.equal((await old.json()).error, 'unauthorized', 'still signed out, but no longer told to erase');
  const again = await signIn(env, EMAIL, { deviceId: PHONE });
  assert.equal((await call(env, 'GET', '/program', { token: again.token })).status, 200);

  await erase(env, laptop.token, PHONE);
  await call(env, 'POST', '/devices/erase-ack', { token: again.token, body: {} });
  assert.equal((await call(env, 'DELETE', `/devices/${PHONE}/erase`, { token: laptop.token })).status, 409);
});

test('signing in again on a device with a pending erase still erases it', async () => {
  const env = await makeEnv();
  const { laptop } = await twoDevices(env);
  await erase(env, laptop.token, PHONE);
  const again = await signIn(env, EMAIL, { deviceId: PHONE });
  assert.equal((await (await call(env, 'GET', '/program', { token: again.token })).json()).error, 'device_erased');
});

test('license released: the list stops offering it', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  await call(env, 'POST', '/devices/check-in', { token: phone.token, body: { licenseInstanceId: 'inst-1' } });
  assert.equal((await call(env, 'POST', `/devices/${PHONE}/license-released`, { token: laptop.token, body: {} })).status, 200);
  assert.equal((await devices(env, laptop.token)).find((d) => d.id === PHONE).licenseInstanceId, null);
  assert.equal((await call(env, 'POST', '/devices/55555555-5555-4555-8555-555555555555/license-released', { token: laptop.token, body: {} })).status, 404);
});

test('retention keeps a pending erase\'s sessions however old, and drops confirmed erasures after 30 days', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  await erase(env, laptop.token, PHONE);
  env.DB.raw.prepare("UPDATE sessions SET revoked_at = '2020-01-01T00:00:00.000Z', expires_at = '2020-01-01T00:00:00.000Z' WHERE device_id = ?").run(PHONE);
  await runRetention(env);
  assert.equal((await (await call(env, 'GET', '/program', { token: phone.token })).json()).error, 'device_erased');

  await call(env, 'POST', '/devices/erase-ack', { token: phone.token, body: {} });
  env.DB.raw.prepare("UPDATE device_erasures SET confirmed_at = '2020-01-01T00:00:00.000Z'").run();
  await runRetention(env);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM device_erasures').get().n, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE device_id = ?').get(PHONE).n, 0);
});

test('an erased device that freed its own license says so in its ack', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  await call(env, 'POST', '/devices/check-in', { token: phone.token, body: { licenseInstanceId: 'inst-1' } });
  await erase(env, laptop.token, PHONE);
  await call(env, 'POST', '/devices/erase-ack', { token: phone.token, body: { licenseReleased: true } });
  assert.equal((await devices(env, laptop.token)).find((d) => d.id === PHONE).licenseInstanceId, null);
});

test('delete account removes its erasures too', async () => {
  const env = await makeEnv();
  const { laptop } = await twoDevices(env);
  await erase(env, laptop.token, PHONE);
  assert.equal((await call(env, 'DELETE', '/account', { token: laptop.token, body: { confirm: 'DELETE' } })).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM device_erasures').get().n, 0);
});

test('sign out other devices and delete account also need a fresh sign-in', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  ageSessions(env, PHONE);

  // The old phone (think: stolen, still signed in) can do neither without a code.
  const others = await call(env, 'POST', '/auth/signout-others', { token: phone.token, body: {} });
  assert.equal(others.status, 403);
  assert.equal((await others.json()).error, 'reauth_required');
  const del = await call(env, 'DELETE', '/account', { token: phone.token, body: { confirm: 'DELETE' } });
  assert.equal(del.status, 403);
  assert.equal((await call(env, 'GET', '/program', { token: laptop.token })).status, 200, 'the laptop is still signed in');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1, 'the account is still there');

  // With a code sent to the account's email, they go ahead.
  await call(env, 'POST', '/auth/start', { body: { email: EMAIL } });
  const ok = await call(env, 'POST', '/auth/signout-others', { token: phone.token, body: { email: EMAIL, code: lastCode(env) } });
  assert.equal((await ok.json()).revoked, 1);
  await call(env, 'POST', '/auth/start', { body: { email: EMAIL } });
  assert.equal((await call(env, 'DELETE', '/account', { token: phone.token, body: { confirm: 'DELETE', email: EMAIL, code: lastCode(env) } })).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});
