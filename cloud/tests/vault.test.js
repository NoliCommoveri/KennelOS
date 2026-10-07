// The private vault's routes and its snapshot rule (docs/KennelOS_Private_Vault_Plan.md
// §5, §6). The server never opens anything, so these use opaque, correctly shaped
// stand-ins for wraps and keys; the cryptography itself is tests/vaultCrypto.test.js
// at the repo root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn, lastCode, bytes } from './helpers/env.js';

const { runRetention } = await import('../src/retention.js');
const { exportAll } = await import('../src/backup.js');
const { MAX_PASSKEYS, PAIRING_MS } = await import('../src/vault.js');
const { VAULT_LIMITS } = await import('../src/ratelimit.js');

const PHONE = '11111111-1111-4111-8111-111111111111';
const LAPTOP = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'breeder@example.com';

const KEY_ID = 'a'.repeat(32);
const OTHER_KEY_ID = 'b'.repeat(32);
const wrap = () => Buffer.from(crypto.getRandomValues(new Uint8Array(60))).toString('base64');
async function publicKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64');
}

async function twoDevices(env) {
  const phone = await signIn(env, EMAIL, { deviceId: PHONE, deviceLabel: "Jen's iPhone" });
  const laptop = await signIn(env, EMAIL, { deviceId: LAPTOP, deviceLabel: 'Kitchen laptop' });
  return { phone, laptop };
}
const ageSession = (env, deviceId) =>
  env.DB.raw.prepare("UPDATE sessions SET created_at = '2026-01-01T00:00:00.000Z' WHERE device_id = ?").run(deviceId);
const enable = (env, s, body = {}) => call(env, 'POST', '/vault', { token: s.token, body: { keyId: KEY_ID, recoveryWrap: wrap(), ...body } });
const getVault = async (env, s) => (await call(env, 'GET', '/vault', { token: s.token })).json();
const count = (env, table) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

// A whole backup with an optional vault part: describe, vault PUT, body PUT.
async function pushWithVault(env, s, { base = null, vault, vaultBytes = 'sealed-private', payload = 'kennel-tier', skipVaultPut = false } = {}) {
  const body = bytes(payload);
  const sealed = bytes(vaultBytes);
  const description = { base_snapshot_id: base, size: body.length, counts: { dogs: 1 }, files: [] };
  if (vault !== undefined) description.vault = vault === true ? { size: sealed.length, keyId: KEY_ID } : vault;
  const created = await call(env, 'POST', '/snapshots', { token: s.token, body: description });
  if (created.status !== 200) return { created };
  const { snapshotId } = await created.json();
  let vaultPut = null;
  if (vault !== undefined && !skipVaultPut) vaultPut = await call(env, 'PUT', `/snapshots/${snapshotId}/vault`, { token: s.token, body: sealed });
  const committed = await call(env, 'PUT', `/snapshots/${snapshotId}/body`, { token: s.token, body });
  return { created, snapshotId, vaultPut, committed };
}

test('turning the vault on: off by default, one recovery wrap, no wrapped bytes in the listing', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  assert.deepEqual(await getVault(env, s), { enabled: false });

  assert.equal((await enable(env, s, { keyId: 'nope' })).status, 400);
  assert.equal((await enable(env, s, { recoveryWrap: 'not base64!' })).status, 400);
  assert.equal((await enable(env, s, { recoveryWrap: 'A'.repeat(400) })).status, 400);

  const on = await enable(env, s);
  assert.equal(on.status, 200);
  const v = await getVault(env, s);
  assert.equal(v.enabled, true);
  assert.equal(v.keyId, KEY_ID);
  assert.equal(v.wraps.length, 1);
  assert.equal(v.wraps[0].kind, 'recovery');
  assert.equal(v.wraps[0].wrapped, undefined, 'the listing never carries wrapped bytes');

  const again = await enable(env, s, { keyId: OTHER_KEY_ID });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error, 'vault_exists');
});

test('reading a wrap returns its bytes, only within the program, and is rate-limited', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  const recoveryWrap = wrap();
  await enable(env, s, { recoveryWrap });
  const id = (await getVault(env, s)).wraps[0].id;

  const got = await (await call(env, 'GET', `/vault/wraps/${id}`, { token: s.token })).json();
  assert.deepEqual(got, { id, kind: 'recovery', keyId: KEY_ID, wrapped: recoveryWrap });

  const stranger = await signIn(env, 'someone@else.co');
  await enable(env, stranger);
  assert.equal((await call(env, 'GET', `/vault/wraps/${id}`, { token: stranger.token })).status, 404);

  for (let i = 1; i < VAULT_LIMITS.wrapReads; i++) await call(env, 'GET', `/vault/wraps/${id}`, { token: s.token });
  const limited = await call(env, 'GET', `/vault/wraps/${id}`, { token: s.token });
  assert.equal(limited.status, 429);
});

test('passkeys: added under the current key, listed with credential and salt, capped, removed with a fresh sign-in', async () => {
  const env = await makeEnv();
  const s = await signIn(env, EMAIL, { deviceId: PHONE });
  const add = (body = {}) => call(env, 'POST', '/vault/wraps', {
    token: s.token,
    body: { kind: 'passkey', keyId: KEY_ID, wrapped: wrap(), credentialId: 'cred_ID-1', prfSalt: wrap(), label: 'iPhone passkey', ...body },
  });

  assert.equal((await add()).status, 404, 'no vault yet');
  await enable(env, s);
  assert.equal((await add({ keyId: OTHER_KEY_ID })).status, 409);
  assert.equal((await add({ kind: 'recovery' })).status, 400);
  assert.equal((await add({ credentialId: 'has space' })).status, 400);
  assert.equal((await add({ prfSalt: undefined })).status, 400);

  const added = await (await add()).json();
  const listed = (await getVault(env, s)).wraps.find((w) => w.id === added.id);
  assert.equal(listed.kind, 'passkey');
  assert.equal(listed.credentialId, 'cred_ID-1');
  assert.equal(listed.label, 'iPhone passkey');
  assert.ok(listed.prfSalt);

  for (let i = 1; i < MAX_PASSKEYS; i++) assert.equal((await add()).status, 200);
  assert.equal((await (await add()).json()).error, 'too_many_passkeys');

  const recoveryId = (await getVault(env, s)).wraps.find((w) => w.kind === 'recovery').id;
  assert.equal((await (await call(env, 'DELETE', `/vault/wraps/${recoveryId}`, { token: s.token, body: {} })).json()).error, 'cannot_remove_recovery');

  ageSession(env, PHONE);
  const refused = await call(env, 'DELETE', `/vault/wraps/${added.id}`, { token: s.token, body: {} });
  assert.equal((await refused.json()).error, 'reauth_required');
  await call(env, 'POST', '/auth/start', { body: { email: EMAIL } });
  const removed = await call(env, 'DELETE', `/vault/wraps/${added.id}`, { token: s.token, body: { email: EMAIL, code: lastCode(env) } });
  assert.equal(removed.status, 200);
  assert.equal((await getVault(env, s)).wraps.filter((w) => w.kind === 'passkey').length, MAX_PASSKEYS - 1);
});

test('a new recovery code replaces the old wrap, under the current key, with a fresh sign-in', async () => {
  const env = await makeEnv();
  const s = await signIn(env, EMAIL, { deviceId: PHONE });
  await enable(env, s);
  const id = (await getVault(env, s)).wraps[0].id;
  const replacement = wrap();

  assert.equal((await call(env, 'PUT', '/vault/wraps/recovery', { token: s.token, body: { keyId: OTHER_KEY_ID, wrapped: replacement } })).status, 409);
  ageSession(env, PHONE);
  assert.equal((await call(env, 'PUT', '/vault/wraps/recovery', { token: s.token, body: { keyId: KEY_ID, wrapped: replacement } })).status, 403);
  await call(env, 'POST', '/auth/start', { body: { email: EMAIL } });
  const ok = await call(env, 'PUT', '/vault/wraps/recovery', { token: s.token, body: { keyId: KEY_ID, wrapped: replacement, email: EMAIL, code: lastCode(env) } });
  assert.equal(ok.status, 200);
  assert.equal((await (await call(env, 'GET', `/vault/wraps/${id}`, { token: s.token })).json()).wrapped, replacement);
  assert.equal(count(env, 'vault_wraps'), 1);
});

test('snapshots: with a vault, the vault part is required, under the current key, before the body', async () => {
  const env = await makeEnv();
  const s = await signIn(env);

  // No vault: a vault part is refused, a plain push works.
  assert.equal((await (await pushWithVault(env, s, { vault: true })).created.json()).error, 'no_vault');
  const plain = await pushWithVault(env, s);
  assert.equal(plain.committed.status, 200);

  await enable(env, s);
  const missing = await (await pushWithVault(env, s, { base: plain.snapshotId })).created.json();
  assert.equal(missing.error, 'vault_required');
  assert.equal(missing.keyId, KEY_ID);
  const stale = await pushWithVault(env, s, { base: plain.snapshotId, vault: { size: 5, keyId: OTHER_KEY_ID } });
  assert.equal(stale.created.status, 409);
  assert.equal((await stale.created.json()).keyId, KEY_ID);
  assert.equal((await pushWithVault(env, s, { base: plain.snapshotId, vault: { size: 0, keyId: KEY_ID } })).created.status, 400);

  // Body before the vault part: refused, nothing committed.
  const early = await pushWithVault(env, s, { base: plain.snapshotId, vault: true, skipVaultPut: true });
  assert.equal((await early.committed.json()).error, 'vault_missing');

  // Wrong size for the vault part.
  const created = await (await call(env, 'POST', '/snapshots', {
    token: s.token, body: { base_snapshot_id: plain.snapshotId, size: 3, counts: {}, files: [], vault: { size: 10, keyId: KEY_ID } },
  })).json();
  assert.equal((await call(env, 'PUT', `/snapshots/${created.snapshotId}/vault`, { token: s.token, body: bytes('short') })).status, 400);

  const good = await pushWithVault(env, s, { base: plain.snapshotId, vault: true, vaultBytes: 'ciphertext!' });
  assert.equal(good.vaultPut.status, 200);
  assert.equal(good.committed.status, 200);
  assert.equal(await (await call(env, 'GET', `/snapshots/${good.snapshotId}/vault`, { token: s.token })).text(), 'ciphertext!');
  assert.equal((await call(env, 'GET', `/snapshots/${plain.snapshotId}/vault`, { token: s.token })).status, 404, 'made before the vault');

  const list = (await (await call(env, 'GET', '/snapshots', { token: s.token })).json()).snapshots;
  assert.equal(list.find((x) => x.id === good.snapshotId).vaultKeyId, KEY_ID);
  assert.equal(list.find((x) => x.id === plain.snapshotId).vaultKeyId, null);

  // Another program can't read it; a plain snapshot has no vault PUT.
  const stranger = await signIn(env, 'someone@else.co');
  assert.equal((await call(env, 'GET', `/snapshots/${good.snapshotId}/vault`, { token: stranger.token })).status, 404);
});

test('turning the vault off between describe and commit: the body is refused and the half-snapshot discarded', async () => {
  const env = await makeEnv();
  const s = await signIn(env, EMAIL, { deviceId: PHONE });
  await enable(env, s);
  const created = await (await call(env, 'POST', '/snapshots', {
    token: s.token, body: { base_snapshot_id: null, size: 4, counts: {}, files: [], vault: { size: 6, keyId: KEY_ID } },
  })).json();
  await call(env, 'PUT', `/snapshots/${created.snapshotId}/vault`, { token: s.token, body: bytes('sealed') });

  assert.equal((await call(env, 'DELETE', '/vault', { token: s.token, body: {} })).status, 200, 'fresh session');
  const body = await call(env, 'PUT', `/snapshots/${created.snapshotId}/body`, { token: s.token, body: bytes('body') });
  assert.equal(body.status, 409);
  assert.equal((await body.json()).error, 'no_vault');
  assert.equal(count(env, 'snapshots'), 0);
  assert.equal(env.FILES.store.size, 0, 'the vault part went with it');
});

test('turning the vault off needs a fresh sign-in, removes every wrap, and plain pushes work again', async () => {
  const env = await makeEnv();
  const s = await signIn(env, EMAIL, { deviceId: PHONE });
  await enable(env, s);
  const first = await pushWithVault(env, s, { vault: true });
  assert.equal(first.committed.status, 200);

  ageSession(env, PHONE);
  assert.equal((await call(env, 'DELETE', '/vault', { token: s.token, body: {} })).status, 403);
  await call(env, 'POST', '/auth/start', { body: { email: EMAIL } });
  assert.equal((await call(env, 'DELETE', '/vault', { token: s.token, body: { email: EMAIL, code: lastCode(env) } })).status, 200);

  assert.deepEqual(await getVault(env, s), { enabled: false });
  assert.equal(count(env, 'vault_wraps'), 0);
  assert.equal((await pushWithVault(env, s, { base: first.snapshotId })).committed.status, 200);
  // The old encrypted part stays until retention ages it out (plan §10 decision 7).
  assert.equal((await call(env, 'GET', `/snapshots/${first.snapshotId}/vault`, { token: s.token })).status, 200);
});

test('pairing: a new device asks, another of the owner\'s devices approves, the answer is read once', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  const newKey = await publicKey();
  const approverKey = await publicKey();

  assert.equal((await call(env, 'POST', '/vault/pairings', { token: phone.token, body: { publicKey: newKey } })).status, 404, 'no vault');
  await enable(env, laptop);
  assert.equal((await call(env, 'POST', '/vault/pairings', { token: phone.token, body: { publicKey: 'AAAA' } })).status, 400);

  const { pairingId, expiresAt } = await (await call(env, 'POST', '/vault/pairings', { token: phone.token, body: { publicKey: newKey } })).json();
  assert.ok(Date.parse(expiresAt) > Date.now());

  // The asking device doesn't see its own request; the other device does.
  assert.deepEqual((await (await call(env, 'GET', '/vault/pairings', { token: phone.token })).json()).pairings, []);
  const open = (await (await call(env, 'GET', '/vault/pairings', { token: laptop.token })).json()).pairings;
  assert.equal(open.length, 1);
  assert.equal(open[0].deviceLabel, "Jen's iPhone");
  assert.equal(open[0].publicKey, newKey);

  const poll = () => call(env, 'GET', `/vault/pairings/${pairingId}`, { token: phone.token });
  assert.equal((await (await poll()).json()).status, 'waiting');
  assert.equal((await call(env, 'GET', `/vault/pairings/${pairingId}`, { token: laptop.token })).status, 404, 'only the asking device polls');

  const approve = (token, body = {}) => call(env, 'POST', `/vault/pairings/${pairingId}/approve`, {
    token, body: { approverKey, wrapped: wrap(), keyId: KEY_ID, ...body },
  });
  assert.equal((await (await approve(phone.token)).json()).error, 'own_device');
  assert.equal((await approve(laptop.token, { keyId: OTHER_KEY_ID })).status, 409);
  assert.equal((await approve(laptop.token)).status, 200);
  assert.equal((await (await approve(laptop.token)).json()).error, 'already_approved');
  assert.deepEqual((await (await call(env, 'GET', '/vault/pairings', { token: laptop.token })).json()).pairings, [], 'approved leaves the list');

  const answer = await (await poll()).json();
  assert.equal(answer.status, 'approved');
  assert.equal(answer.approverKey, approverKey);
  assert.equal(answer.keyId, KEY_ID);
  assert.ok(answer.wrapped);
  assert.equal((await poll()).status, 404, 'read once');
});

test('pairing: another program never sees it; expired requests vanish and retention drops them', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  await enable(env, laptop);
  const { pairingId } = await (await call(env, 'POST', '/vault/pairings', { token: phone.token, body: { publicKey: await publicKey() } })).json();

  const stranger = await signIn(env, 'someone@else.co');
  await enable(env, stranger);
  assert.deepEqual((await (await call(env, 'GET', '/vault/pairings', { token: stranger.token })).json()).pairings, []);
  const theirs = await call(env, 'POST', `/vault/pairings/${pairingId}/approve`, {
    token: stranger.token, body: { approverKey: await publicKey(), wrapped: wrap(), keyId: KEY_ID },
  });
  assert.equal(theirs.status, 404);

  env.DB.raw.prepare("UPDATE vault_pairings SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  assert.deepEqual((await (await call(env, 'GET', '/vault/pairings', { token: laptop.token })).json()).pairings, []);
  assert.equal((await call(env, 'GET', `/vault/pairings/${pairingId}`, { token: phone.token })).status, 404);
  await runRetention(env);
  assert.equal(count(env, 'vault_pairings'), 0);
  assert.ok(PAIRING_MS === 10 * 60 * 1000);
});

test('pairing: at most five open requests at a time', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  await enable(env, laptop);
  for (let i = 0; i < 5; i++) {
    assert.equal((await call(env, 'POST', '/vault/pairings', { token: phone.token, body: { publicKey: await publicKey() } })).status, 200);
  }
  const sixth = await call(env, 'POST', '/vault/pairings', { token: phone.token, body: { publicKey: await publicKey() } });
  assert.equal((await sixth.json()).error, 'too_many_pairings');
});

test('retention removes a dropped snapshot\'s vault part with it', async () => {
  const env = await makeEnv();
  const s = await signIn(env);
  await enable(env, s);
  const old = await pushWithVault(env, s, { vault: true });
  const latest = await pushWithVault(env, s, { base: old.snapshotId, vault: true });
  env.DB.raw.prepare("UPDATE snapshots SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(old.snapshotId);

  const vaultKeys = () => [...env.FILES.store.keys()].filter((k) => k.endsWith('.vault'));
  assert.equal(vaultKeys().length, 2);
  await runRetention(env);
  assert.deepEqual(vaultKeys(), [`snapshots/${s.programId}/${latest.snapshotId}.vault`]);
});

test('deleting the account removes the vault, its wraps, pairings and encrypted parts', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  await enable(env, laptop);
  await pushWithVault(env, laptop, { vault: true });
  await call(env, 'POST', '/vault/pairings', { token: phone.token, body: { publicKey: await publicKey() } });

  const res = await call(env, 'DELETE', '/account', { token: laptop.token, body: { confirm: 'DELETE' } });
  assert.equal(res.status, 200);
  for (const t of ['vaults', 'vault_wraps', 'vault_pairings', 'snapshots']) assert.equal(count(env, t), 0, t);
  assert.equal(env.FILES.store.size, 0);
});

test('the /ops export carries the vault and its wraps, not pairings', async () => {
  const env = await makeEnv();
  const { phone, laptop } = await twoDevices(env);
  await enable(env, laptop);
  await call(env, 'POST', '/vault/pairings', { token: phone.token, body: { publicKey: await publicKey() } });
  const out = await exportAll(env.DB);
  assert.equal(out.tables.vaults.length, 1);
  assert.equal(out.tables.vault_wraps.length, 1);
  assert.equal(out.tables.vault_pairings, undefined);
});
