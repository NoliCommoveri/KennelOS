// Assisted setup and help from KennelOS support (docs/KennelOS_Assisted_Setup_Plan.md):
// the manager app's routes, the helper session, her takeover, Get help, and the
// automatic vault pairings between her devices and support's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worker } from './helpers/worker.js';
import { makeEnv, call, signIn } from './helpers/env.js';

const EMAIL = 'dana@example.com';
const HER_PHONE = '11111111-1111-4111-8111-111111111111';
const SUPPORT = '33333333-3333-4333-8333-333333333333';
const KEY_ID = 'a'.repeat(32);
const wrap = () => Buffer.from(crypto.getRandomValues(new Uint8Array(60))).toString('base64');
async function publicKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64');
}

const mreq = (path, init = {}) => new Request(`https://api.example${path}`, init);
async function managerCookie(env) {
  const res = await worker.fetch(mreq('/manager/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: env.OPS_TOKEN }) }), env);
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}
async function manager(env, path, body) {
  const cookie = await managerCookie(env);
  const init = body === undefined ? { headers: { Cookie: cookie } }
    : { method: 'POST', headers: { Cookie: cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await worker.fetch(mreq(`/manager/api/${path}`, init), env);
  return { status: res.status, body: await res.json() };
}
const tokenOf = (link) => new URL(link).searchParams.get('assist');
const redeem = (env, link, deviceId = SUPPORT) => call(env, 'POST', '/assist/redeem', { body: { token: tokenOf(link), deviceId, deviceLabel: 'Laptop' } });
const state = async (env, s) => (await (await call(env, 'GET', '/assist/state', { token: s.token })).json());
const err = async (res) => ({ status: res.status, error: (await res.json()).error });

// Steps 1–2: support makes her account and signs a device in to it as a helper.
async function setUp(env) {
  const start = await manager(env, 'start', { email: EMAIL, label: 'Dana at Blue Ridge' });
  assert.equal(start.status, 200);
  const res = await redeem(env, start.body.link);
  assert.equal(res.status, 200);
  return { ...start.body, helper: await res.json() };
}

test('the manager app: its page and files are served, its API needs the ops token', async () => {
  const env = await makeEnv();
  for (const [path, type] of [['/manager/', 'text/html'], ['/manager/app.js', 'text/javascript'], ['/manager/sw.js', 'text/javascript'],
    ['/manager/manifest.webmanifest', 'application/manifest+json'], ['/manager/icon-512.png', 'image/png']]) {
    const res = await worker.fetch(mreq(path), env);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), new RegExp(type.replace('+', '\\+')), path);
  }
  assert.equal((await worker.fetch(mreq('/manager/api/programs'), env)).status, 401);
  const wrong = await worker.fetch(mreq('/manager/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'nope' }) }), env);
  assert.equal(wrong.status, 401);
  assert.equal((await manager(env, 'programs')).status, 200);
  // A write from another site is refused even with the cookie.
  const cookie = await managerCookie(env);
  const cross = await worker.fetch(mreq('/manager/api/start', { method: 'POST', headers: { Cookie: cookie, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }), env);
  assert.equal(cross.status, 403);
});

test('the manager scripts run in a browser after wrangler bundles them (its __name helper is shimmed)', async () => {
  const { MANAGER_FILES } = await import('../src/assistApp.js');
  for (const f of ['app.js', 'sw.js']) assert.match(MANAGER_FILES[f].body, /^var __name = function \(fn\) \{ return fn; \};/, f);
});

test('start: makes her account and a one-time link; an address with an account is refused', async () => {
  const env = await makeEnv();
  const { helper, programId } = await setUp(env);
  assert.equal(helper.role, 'helper');
  assert.equal(helper.programId, programId);
  assert.equal(helper.label, 'Dana at Blue Ridge');
  const row = env.DB.raw.prepare("SELECT device_label, role FROM sessions WHERE device_id = ?").get(SUPPORT);
  assert.deepEqual({ ...row }, { device_label: 'KennelOS support (Laptop)', role: 'helper' });
  assert.equal(JSON.stringify(env.DB.raw.prepare('SELECT * FROM assist_programs').all()).includes(EMAIL), false, 'no email kept');

  assert.deepEqual((await manager(env, 'start', { email: EMAIL.toUpperCase(), label: 'Again' })).body, { error: 'account_exists' });
  const list = (await manager(env, 'programs')).body.programs;
  assert.deepEqual(list.map((p) => [p.label, p.state, p.helperSignedIn]), [['Dana at Blue Ridge', 'setup', true]]);
});

test('a link works once and expires', async () => {
  const env = await makeEnv();
  const { link } = (await manager(env, 'start', { email: EMAIL, label: 'Dana' })).body;
  assert.equal((await redeem(env, link)).status, 200);
  assert.deepEqual(await err(await redeem(env, link)), { status: 400, error: 'link_expired' });
  const again = (await manager(env, 'link', { programId: (await manager(env, 'programs')).body.programs[0].programId })).body.link;
  env.DB.raw.prepare("UPDATE assist_links SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.deepEqual(await err(await redeem(env, again)), { status: 400, error: 'link_expired' });
});

test('the helper can set things up but not touch her account itself', async () => {
  const env = await makeEnv();
  const { helper } = await setUp(env);
  const s = { token: helper.token };
  assert.equal((await call(env, 'POST', '/vault', { token: s.token, body: { keyId: KEY_ID, recoveryWrap: wrap() } })).status, 200, 'turns the vault on');
  assert.equal((await call(env, 'GET', '/program', { token: s.token })).status, 200);
  for (const [m, path, body] of [['DELETE', '/account', { confirm: 'DELETE' }], ['DELETE', '/vault', {}], ['POST', '/auth/signout-others', {}],
    ['POST', '/account/email', { email: 'x@example.com', code: '123456' }], ['POST', `/devices/${HER_PHONE}/erase`, {}], ['PUT', '/vault/wraps/recovery', { keyId: KEY_ID, wrapped: wrap() }]]) {
    assert.deepEqual(await err(await call(env, m, path, { token: s.token, body })), { status: 403, error: 'helper_not_allowed' }, `${m} ${path}`);
  }
});

test('her takeover: her sign-in says assisted, her device gets the key from support’s automatically, and support is signed out', async () => {
  const env = await makeEnv();
  const { helper } = await setUp(env);
  await call(env, 'POST', '/vault', { token: helper.token, body: { keyId: KEY_ID, recoveryWrap: wrap() } });

  const her = await signIn(env, EMAIL, { deviceId: HER_PHONE, deviceLabel: "Dana's Pixel" });
  assert.equal(her.assisted, true);
  assert.deepEqual(await state(env, her), { role: 'owner', state: 'setup', label: 'Dana at Blue Ridge' });

  // Her device asks with its code; only support's device is shown it.
  const ask = await (await call(env, 'POST', '/vault/pairings', { token: her.token, body: { publicKey: await publicKey(), autoCode: 'ABCDEFGHJKMN' } })).json();
  const seen = (await (await call(env, 'GET', '/vault/pairings', { token: helper.token })).json()).pairings;
  assert.equal(seen.find((p) => p.id === ask.pairingId).autoCode, 'ABCDEFGHJKMN');
  assert.equal((await call(env, 'POST', `/vault/pairings/${ask.pairingId}/approve`, { token: helper.token, body: { approverKey: await publicKey(), wrapped: wrap(), keyId: KEY_ID } })).status, 200);
  assert.equal((await (await call(env, 'GET', `/vault/pairings/${ask.pairingId}`, { token: her.token })).json()).status, 'approved');

  assert.deepEqual(await (await call(env, 'POST', '/assist/claimed', { token: her.token, body: {} })).json(), { ok: true, state: 'idle' });
  assert.deepEqual(await err(await call(env, 'GET', '/program', { token: helper.token })), { status: 401, error: 'helper_removed' });
  const kinds = env.DB.raw.prepare('SELECT kind FROM assist_events ORDER BY seq').all().map((r) => r.kind);
  assert.deepEqual(kinds, ['setup_started', 'helper_in', 'claiming', 'claimed']);
  // Her later sign-ins are ordinary.
  assert.equal((await signIn(env, EMAIL, { deviceId: '44444444-4444-4444-8444-444444444444' })).assisted, undefined);
});

test('no automatic pairing outside an assisted state: the code is dropped, never shown', async () => {
  const env = await makeEnv();
  const owner = await signIn(env, 'plain@example.com', { deviceId: HER_PHONE });
  const other = await signIn(env, 'plain@example.com', { deviceId: SUPPORT });
  await call(env, 'POST', '/vault', { token: owner.token, body: { keyId: KEY_ID, recoveryWrap: wrap() } });
  await call(env, 'POST', '/vault/pairings', { token: other.token, body: { publicKey: await publicKey(), autoCode: 'ABCDEFGHJKMN' } });
  const seen = (await (await call(env, 'GET', '/vault/pairings', { token: owner.token })).json()).pairings;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].autoCode, undefined);
  assert.equal(env.DB.raw.prepare('SELECT auto_code FROM vault_pairings').get().auto_code, null);
});

test('Get help: she asks, support gets a link, its device gets the key from hers, and either ends it', async () => {
  const env = await makeEnv();
  const { helper, programId } = await setUp(env);
  await call(env, 'POST', '/vault', { token: helper.token, body: { keyId: KEY_ID, recoveryWrap: wrap() } });
  const her = await signIn(env, EMAIL, { deviceId: HER_PHONE });
  await call(env, 'POST', '/assist/claimed', { token: her.token, body: {} });

  assert.deepEqual((await manager(env, 'link', { programId })).body, { error: 'help_not_requested' });
  assert.deepEqual(await (await call(env, 'POST', '/assist/help', { token: her.token, body: {} })).json(), { ok: true, state: 'requested' });
  const { link } = (await manager(env, 'link', { programId })).body;
  const back = await (await redeem(env, link, '55555555-5555-4555-8555-555555555555')).json();
  assert.equal(back.state, 'helping');

  const ask = await (await call(env, 'POST', '/vault/pairings', { token: back.token, body: { publicKey: await publicKey(), autoCode: 'PQRSTUVWXYZ2' } })).json();
  const seen = (await (await call(env, 'GET', '/vault/pairings', { token: her.token })).json()).pairings;
  assert.equal(seen.find((p) => p.id === ask.pairingId).autoCode, 'PQRSTUVWXYZ2', 'her device sees support’s code');

  assert.deepEqual(await (await call(env, 'POST', '/assist/end', { token: her.token, body: {} })).json(), { ok: true, state: 'idle' });
  assert.deepEqual(await err(await call(env, 'GET', '/program', { token: back.token })), { status: 401, error: 'helper_removed' });
  assert.equal((await call(env, 'GET', '/program', { token: her.token })).status, 200, 'her own device is untouched');
});

test('a user support never set up can still ask for help; the helper can’t ask on her behalf', async () => {
  const env = await makeEnv();
  const owner = await signIn(env, 'other@example.com', { deviceId: HER_PHONE, deviceLabel: "Sam's iPad" });
  assert.equal((await call(env, 'POST', '/assist/help', { token: owner.token, body: {} })).status, 200);
  const list = (await manager(env, 'programs')).body.programs;
  assert.deepEqual(list.map((p) => [p.label, p.state]), [["Sam's iPad", 'requested']]);
  const back = await (await redeem(env, (await manager(env, 'link', { programId: list[0].programId })).body.link)).json();
  assert.deepEqual(await err(await call(env, 'POST', '/assist/help', { token: back.token, body: {} })), { status: 403, error: 'helper_not_allowed' });
  assert.equal((await manager(env, 'end', { programId: list[0].programId })).status, 200);
  assert.deepEqual(await err(await call(env, 'GET', '/program', { token: back.token })), { status: 401, error: 'helper_removed' });
});

test('pending: a manager push says who and what; delete from the manager removes the assist rows', async () => {
  const env = await makeEnv();
  const { programId } = await setUp(env);
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
  assert.equal((await manager(env, 'push', { endpoint })).status, 200);
  await signIn(env, EMAIL, { deviceId: HER_PHONE });
  const n = (await manager(env, 'pending', { endpoint })).body;
  assert.equal(n.title, 'Dana at Blue Ridge');
  assert.match(n.body, /signed in on her device/);
  assert.equal((await manager(env, 'pending', { endpoint })).body.body, 'Nothing new.', 'shown once');

  assert.deepEqual((await manager(env, 'delete', { email: EMAIL, confirm: 'nope' })).body, { error: 'confirm_required' });
  assert.equal((await manager(env, 'delete', { email: EMAIL, confirm: 'DELETE' })).body.devices, 2);
  for (const t of ['assist_programs', 'assist_events', 'users']) assert.equal(env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  assert.equal(programId.length, 36);
});
