// Recovering an account with no signed-in device (docs/KennelOS_Cloud_Phase1_Plan.md §2.7).
// The server never opens anything, so the wrap and the check are opaque,
// correctly shaped stand-ins; the client's derivation is tests/cloudRecovery.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn, lastCode } from './helpers/env.js';

const { applyDueEmailChanges, EMAIL_CHANGE_WAIT_MS } = await import('../src/emailChange.js');

const OLD = 'breeder@example.com';
const NEW = 'new@example.com';
const PHONE = '11111111-1111-4111-8111-111111111111';
const KEY_ID = 'a'.repeat(32);
const WRAP = Buffer.from(new Uint8Array(60).fill(7)).toString('base64');
const CHECK = 'c'.repeat(64);

async function vaultAccount(env, { saveCheck = true } = {}) {
  const s = await signIn(env, OLD, { deviceId: PHONE, deviceLabel: "Jen's iPhone" });
  assert.equal((await call(env, 'POST', '/vault', { token: s.token, body: { keyId: KEY_ID, recoveryWrap: WRAP } })).status, 200);
  if (saveCheck) assert.equal((await call(env, 'PUT', '/vault/check', { token: s.token, body: { keyId: KEY_ID, check: CHECK } })).status, 200);
  return s;
}
const post = async (env, path, body) => {
  const res = await call(env, 'POST', path, { body });
  return { status: res.status, body: await res.json() };
};
const sendCode = async (env, email) => {
  assert.equal((await call(env, 'POST', '/auth/start', { body: { email } })).status, 200);
  return lastCode(env);
};

test('the recovery wrap is handed out with no token; an unknown address gets a stand-in, the same each time', async () => {
  const env = await makeEnv();
  await vaultAccount(env);
  const real = await post(env, '/recover/wrap', { email: OLD });
  assert.deepEqual(real.body, { keyId: KEY_ID, wrapped: WRAP });

  const a = await post(env, '/recover/wrap', { email: 'nobody@example.com' });
  const b = await post(env, '/recover/wrap', { email: 'nobody@example.com' });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, b.body);
  assert.match(a.body.keyId, /^[0-9a-f]{32}$/);
  assert.equal(Buffer.from(a.body.wrapped, 'base64').length, 60);
  // An account without a vault looks the same as no account.
  await signIn(env, 'plain@example.com');
  const plain = await post(env, '/recover/wrap', { email: 'plain@example.com' });
  assert.equal(plain.status, 200);
  assert.notEqual(plain.body.wrapped, WRAP);
});

test('the check is saved once, and only for the current key; GET /vault says whether it is there', async () => {
  const env = await makeEnv();
  const s = await vaultAccount(env, { saveCheck: false });
  assert.equal((await (await call(env, 'GET', '/vault', { token: s.token })).json()).recoveryCheck, false);
  const stale = await call(env, 'PUT', '/vault/check', { token: s.token, body: { keyId: 'b'.repeat(32), check: CHECK } });
  assert.equal(stale.status, 409);
  await call(env, 'PUT', '/vault/check', { token: s.token, body: { keyId: KEY_ID, check: CHECK } });
  // A second, different check doesn't replace the first.
  await call(env, 'PUT', '/vault/check', { token: s.token, body: { keyId: KEY_ID, check: 'd'.repeat(64) } });
  assert.equal((await (await call(env, 'GET', '/vault', { token: s.token })).json()).recoveryCheck, true);
  assert.equal((await post(env, '/recover/check', { email: OLD, check: CHECK })).status, 200);
  assert.equal((await post(env, '/recover/check', { email: OLD, check: 'd'.repeat(64) })).body.error, 'no_match');
});

test('a wrong check, a missing account and a vault with no saved check all answer no_match', async () => {
  const env = await makeEnv();
  await vaultAccount(env, { saveCheck: false });
  assert.equal((await post(env, '/recover/check', { email: OLD, check: CHECK })).body.error, 'no_match');
  assert.equal((await post(env, '/recover/check', { email: 'nobody@example.com', check: CHECK })).body.error, 'no_match');
  assert.equal((await post(env, '/recover/check', { email: OLD, check: 'nope' })).body.error, 'bad_proof');
});

test('a recovery asks for the new email: pending a day, shown with via recovery, the old address told, then applied', async () => {
  const env = await makeEnv();
  const s = await vaultAccount(env);
  const code = await sendCode(env, NEW);
  const res = await post(env, '/recover/email', { email: OLD, check: CHECK, newEmail: NEW, code });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'pending');
  const wait = Date.parse(res.body.effectiveAt) - Date.now();
  assert.ok(wait > EMAIL_CHANGE_WAIT_MS - 60_000 && wait <= EMAIL_CHANGE_WAIT_MS);
  // The notice went to the old address (staging's outbox records it).
  assert.equal(lastCode(env), 'notice');

  // A device still signed in sees it, and can cancel it.
  const state = await (await call(env, 'GET', '/account/email', { token: s.token })).json();
  assert.equal(state.pending.via, 'recovery');
  assert.equal(state.pending.deviceLabel, null);

  env.DB.raw.prepare("UPDATE email_changes SET effective_at = '2020-01-01T00:00:00.000Z'").run();
  assert.equal((await applyDueEmailChanges(env)).applied, 1);
  const again = await signIn(env, NEW);
  assert.equal(again.programId, s.programId);
});

test('a recovery with a wrong check, a taken address or a wrong code changes nothing', async () => {
  const env = await makeEnv();
  await vaultAccount(env);
  await signIn(env, 'taken@example.com');
  const pending = () => env.DB.raw.prepare('SELECT COUNT(*) AS n FROM email_changes').get().n;

  let code = await sendCode(env, NEW);
  assert.equal((await post(env, '/recover/email', { email: OLD, check: 'd'.repeat(64), newEmail: NEW, code })).body.error, 'no_match');
  assert.equal((await post(env, '/recover/email', { email: OLD, check: CHECK, newEmail: 'taken@example.com', code })).body.error, 'email_taken');
  assert.equal((await post(env, '/recover/email', { email: OLD, check: CHECK, newEmail: OLD, code })).body.error, 'same_email');
  assert.equal((await post(env, '/recover/email', { email: OLD, check: CHECK, newEmail: NEW, code: '000000' })).body.error, 'invalid_code');
  assert.equal(pending(), 0);
  code = await sendCode(env, NEW);
  assert.equal((await post(env, '/recover/email', { email: OLD, check: CHECK, newEmail: NEW, code })).status, 200);
  assert.equal(pending(), 1);
});

test('a device-asked change reports via device', async () => {
  const env = await makeEnv();
  const s = await vaultAccount(env);
  env.DB.raw.prepare("UPDATE sessions SET created_at = '2026-01-01T00:00:00.000Z'").run();
  const code = await sendCode(env, NEW);
  await call(env, 'POST', '/account/email', { token: s.token, body: { email: NEW, code } });
  const state = await (await call(env, 'GET', '/account/email', { token: s.token })).json();
  assert.equal(state.pending.via, 'device');
});

test('recovery calls are rate-limited per address', async () => {
  const env = await makeEnv();
  const { RECOVERY_LIMITS } = await import('../src/recovery.js');
  let last;
  for (let i = 0; i <= RECOVERY_LIMITS.email; i++) last = await post(env, '/recover/wrap', { email: OLD });
  assert.equal(last.status, 429);
});
