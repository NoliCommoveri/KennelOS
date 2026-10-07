import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn, lastCode } from './helpers/env.js';

test('sign-in by code creates a user and a program, and stores no readable email', async () => {
  const env = await makeEnv();
  const s = await signIn(env, '  Breeder@Example.COM ');
  assert.match(s.token, /^[0-9a-f]{64}$/);
  assert.ok(s.programId && s.deviceId);

  const dump = JSON.stringify([
    env.DB.raw.prepare('SELECT * FROM users').all(),
    env.DB.raw.prepare('SELECT * FROM sessions').all(),
    env.DB.raw.prepare('SELECT * FROM dev_outbox').all(),
  ]);
  assert.doesNotMatch(dump.toLowerCase(), /breeder@example\.com/);
  assert.doesNotMatch(dump, new RegExp(s.token), 'the token is stored hashed');

  const program = await call(env, 'GET', '/program', { token: s.token });
  assert.equal(program.status, 200);
  assert.equal((await program.json()).programId, s.programId);
});

test('the same email signs in to the same program, with the address normalized', async () => {
  const env = await makeEnv();
  const a = await signIn(env, 'breeder@example.com');
  const b = await signIn(env, ' BREEDER@example.com');
  assert.equal(a.programId, b.programId);
  assert.notEqual(a.token, b.token);
});

test('a device keeps the id it sends', async () => {
  const env = await makeEnv();
  const id = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  assert.equal((await signIn(env, 'a@b.co', { deviceId: id })).deviceId, id);
});

test('/auth/start answers the same for a known and an unknown address', async () => {
  const env = await makeEnv();
  await signIn(env, 'known@example.com');
  const known = await call(env, 'POST', '/auth/start', { body: { email: 'known@example.com' }, ip: '198.51.100.2' });
  const unknown = await call(env, 'POST', '/auth/start', { body: { email: 'nobody@example.com' }, ip: '198.51.100.2' });
  assert.equal(known.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
});

test('a malformed address is refused', async () => {
  const env = await makeEnv();
  assert.equal((await call(env, 'POST', '/auth/start', { body: { email: 'not-an-email' } })).status, 400);
});

test('with no email provider and no staging outbox, sign-in refuses rather than pretending', async () => {
  const env = await makeEnv({ DEV_OUTBOX: undefined });
  const res = await call(env, 'POST', '/auth/start', { body: { email: 'a@b.co' } });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'email_unavailable');
});

test('a code works once', async () => {
  const env = await makeEnv();
  await call(env, 'POST', '/auth/start', { body: { email: 'a@b.co' } });
  const code = lastCode(env);
  assert.equal((await call(env, 'POST', '/auth/verify', { body: { email: 'a@b.co', code } })).status, 200);
  assert.equal((await call(env, 'POST', '/auth/verify', { body: { email: 'a@b.co', code } })).status, 400);
});

test('five wrong guesses lock the code, even against the right one', async () => {
  const env = await makeEnv();
  await call(env, 'POST', '/auth/start', { body: { email: 'a@b.co' } });
  const code = lastCode(env);
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await call(env, 'POST', '/auth/verify', { body: { email: 'a@b.co', code: wrong } });
  const res = await call(env, 'POST', '/auth/verify', { body: { email: 'a@b.co', code } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'too_many_attempts');
});

test('an expired code is refused', async () => {
  const env = await makeEnv();
  await call(env, 'POST', '/auth/start', { body: { email: 'a@b.co' } });
  const code = lastCode(env);
  env.DB.raw.prepare("UPDATE login_codes SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await call(env, 'POST', '/auth/verify', { body: { email: 'a@b.co', code } })).status, 400);
});

test('more than five codes an hour for one address is rate-limited', async () => {
  const env = await makeEnv();
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await call(env, 'POST', '/auth/start', { body: { email: 'a@b.co' }, ip: `192.0.2.${i}` })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

test('more than thirty from one IP an hour is rate-limited, and the IP is not stored', async () => {
  const env = await makeEnv();
  let last;
  for (let i = 0; i < 31; i++) last = await call(env, 'POST', '/auth/start', { body: { email: `p${i}@b.co` }, ip: '192.0.2.77' });
  assert.equal(last.status, 429);
  assert.doesNotMatch(JSON.stringify(env.DB.raw.prepare('SELECT * FROM rate_limits').all()), /192\.0\.2\.77/);
});

test('no token, a bad token, a revoked token and an expired token are all 401', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  assert.equal((await call(env, 'GET', '/program')).status, 401);
  assert.equal((await call(env, 'GET', '/program', { token: 'f'.repeat(64) })).status, 401);

  const other = await signIn(env);
  env.DB.raw.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE device_id = ?").run(other.deviceId);
  assert.equal((await call(env, 'GET', '/program', { token: other.token })).status, 401);

  assert.equal((await call(env, 'POST', '/auth/signout', { token: s.token })).status, 200);
  assert.equal((await call(env, 'GET', '/program', { token: s.token })).status, 401);
});

test('sign out other devices keeps this one', async () => {
  const env = await makeEnv();
  const phone = await signIn(env);
  const laptop = await signIn(env);
  const res = await call(env, 'POST', '/auth/signout-others', { token: laptop.token, body: {} });
  assert.equal((await res.json()).revoked, 1);
  assert.equal((await call(env, 'GET', '/program', { token: phone.token })).status, 401);
  assert.equal((await call(env, 'GET', '/program', { token: laptop.token })).status, 200);
});

test('a session used after a day slides its expiry out again', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  env.DB.raw.prepare("UPDATE sessions SET last_seen_at = '2020-01-01T00:00:00.000Z', expires_at = ?").run(new Date(Date.now() + 3600e3).toISOString());
  await call(env, 'GET', '/program', { token: s.token });
  const row = env.DB.raw.prepare('SELECT expires_at FROM sessions').get();
  assert.ok(Date.parse(row.expires_at) > Date.now() + 80 * 86400e3);
});
