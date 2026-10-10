// Changing the account's email (docs/KennelOS_Cloud_Phase1_Plan.md §2.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn, lastCode } from './helpers/env.js';

const { applyDueEmailChanges, EMAIL_CHANGE_WAIT_MS } = await import('../src/emailChange.js');

const OLD = 'breeder@example.com';
const NEW = 'new@example.com';
const PHONE = '11111111-1111-4111-8111-111111111111';
const LAPTOP = '22222222-2222-4222-8222-222222222222';

const sendCode = async (env, email) => {
  assert.equal((await call(env, 'POST', '/auth/start', { body: { email } })).status, 200);
  return lastCode(env);
};
const change = (env, s, body) => call(env, 'POST', '/account/email', { token: s.token, body });
const state = async (env, s) => (await call(env, 'GET', '/account/email', { token: s.token })).json();
const ageSessions = (env) => env.DB.raw.prepare("UPDATE sessions SET created_at = '2026-01-01T00:00:00.000Z'").run();
const users = (env) => env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n;

test('a fresh sign-in (it took a code to the old inbox) changes the email at once', async () => {
  const env = await makeEnv();
  const s = await signIn(env, OLD, { deviceId: PHONE });
  const code = await sendCode(env, NEW);
  const res = await change(env, s, { email: NEW, code });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'changed' });

  // Same account, same program and session; the new address signs in to it, the old one makes a new account.
  const again = await signIn(env, NEW, { deviceId: LAPTOP });
  assert.equal(again.programId, s.programId);
  assert.equal(users(env), 1);
  assert.ok((await state(env, s)).changedAt);
  // The old address stays linked for Pro purchases made with it.
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM license_links').get().n, 1);
  const fresh = await signIn(env, OLD);
  assert.notEqual(fresh.programId, s.programId);
});

test('an older sign-in proves the old inbox with its code; a wrong old code changes nothing', async () => {
  const env = await makeEnv();
  const s = await signIn(env, OLD);
  ageSessions(env);
  const newCode = await sendCode(env, NEW);
  const bad = await change(env, s, { email: NEW, code: newCode, oldEmail: OLD, oldCode: '000000' });
  assert.equal((await bad.json()).error, 'invalid_old_code');
  const wrongAddress = await change(env, s, { email: NEW, code: newCode, oldEmail: 'other@example.com', oldCode: '123456' });
  assert.equal((await wrongAddress.json()).error, 'invalid_old_code');

  const oldCode = await sendCode(env, OLD);
  const newCode2 = await sendCode(env, NEW);
  const ok = await change(env, s, { email: NEW, code: newCode2, oldEmail: OLD, oldCode });
  assert.deepEqual(await ok.json(), { status: 'changed' });
});

test('without the old inbox: pending for a day, shown on every device, cancellable from any', async () => {
  const env = await makeEnv();
  const phone = await signIn(env, OLD, { deviceId: PHONE, deviceLabel: "Jen's iPhone" });
  const laptop = await signIn(env, OLD, { deviceId: LAPTOP, deviceLabel: 'Laptop' });
  ageSessions(env);
  const res = await change(env, phone, { email: NEW, code: await sendCode(env, NEW) });
  const body = await res.json();
  assert.equal(body.status, 'pending');
  assert.ok(Math.abs(Date.parse(body.effectiveAt) - Date.now() - EMAIL_CHANGE_WAIT_MS) < 5000);

  const checkIn = await (await call(env, 'POST', '/devices/check-in', { token: laptop.token, body: {} })).json();
  assert.equal(checkIn.emailChange.pending.deviceLabel, "Jen's iPhone");
  assert.equal(checkIn.emailChange.changedAt, null);

  // Still the old email until then.
  assert.equal((await signIn(env, OLD)).programId, phone.programId);
  assert.equal((await call(env, 'DELETE', '/account/email', { token: laptop.token })).status, 200);
  assert.equal((await state(env, phone)).pending, null);
});

test('a pending change applies once its wait is over: on the next read, or the hourly run', async () => {
  const env = await makeEnv();
  const s = await signIn(env, OLD);
  ageSessions(env);
  await change(env, s, { email: NEW, code: await sendCode(env, NEW) });
  env.DB.raw.prepare("UPDATE email_changes SET effective_at = '2020-01-01T00:00:00.000Z'").run();
  assert.deepEqual(await applyDueEmailChanges(env), { applied: 1, dropped: 0 });
  const st = await state(env, s);
  assert.equal(st.pending, null);
  assert.ok(st.changedAt);
  assert.equal((await signIn(env, NEW)).programId, s.programId);
});

test('refusals: same email, an address with its own account, a bad code; a taken address drops a pending change', async () => {
  const env = await makeEnv();
  const s = await signIn(env, OLD);
  assert.equal((await (await change(env, s, { email: OLD, code: '123456' })).json()).error, 'same_email');
  assert.equal((await (await change(env, s, { email: 'nope', code: '123456' })).json()).error, 'bad_email');
  await signIn(env, 'taken@example.com');
  assert.equal((await change(env, s, { email: 'taken@example.com', code: '123456' })).status, 409);
  await sendCode(env, NEW);
  assert.equal((await (await change(env, s, { email: NEW, code: '000000' })).json()).error, 'invalid_code');

  ageSessions(env);
  await change(env, s, { email: NEW, code: await sendCode(env, NEW) });
  await signIn(env, NEW); // someone else takes it during the wait
  env.DB.raw.prepare("UPDATE email_changes SET effective_at = '2020-01-01T00:00:00.000Z'").run();
  assert.deepEqual(await applyDueEmailChanges(env), { applied: 0, dropped: 1 });
});

test('deleting the account removes a pending change', async () => {
  const env = await makeEnv();
  const s = await signIn(env, OLD);
  ageSessions(env);
  await change(env, s, { email: NEW, code: await sendCode(env, NEW) });
  const fresh = await signIn(env, OLD); // a fresh sign-in, for the delete
  assert.equal((await call(env, 'DELETE', '/account', { token: fresh.token, body: { confirm: 'DELETE' } })).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM email_changes').get().n, 0);
});
