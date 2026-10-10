// cloudVault.test.js — Private Vault Plan §9 step 3: the client vault modules
// (data/cloud/vaultKeyStore, cloudVault, and the vault half of cloudBackup)
// driven END TO END against the real Worker code (cloud/src), in-process, the
// same way as cloudClient.test.js: a migrated node:sqlite D1, an in-memory R2,
// and globalThis.fetch routed to worker.fetch.
//
// "Devices" are simulated by swapping localStorage and the in-memory tables
// (device_secrets, the vault key, included).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { makeEnv, lastCode } from '../cloud/tests/helpers/env.js';
import { worker } from '../cloud/tests/helpers/worker.js';
import { installFakePasskeys, uninstallFakePasskeys } from './support/fakePasskeys.js';

let tables;
let env;
let cb; let auth; let api; let settings; let appReset; let vault; let keyStore; let crypto; let ie;
const calls = [];

async function workerFetch(url, init = {}) {
  const headers = { ...(init.headers || {}), origin: 'http://localhost:8000' };
  let body = init.body;
  if (body instanceof Blob) {
    body = new Uint8Array(await body.arrayBuffer());
    headers['content-length'] = String(body.length);
  } else if (typeof body === 'string') {
    headers['content-length'] = String(new TextEncoder().encode(body).length);
  }
  calls.push(`${init.method || 'GET'} ${new URL(url).pathname}`);
  return worker.fetch(new Request(url, { method: init.method, headers, body, signal: init.signal }), env);
}

before(async () => {
  ({ tables } = await installMemoryDb());
  globalThis.location = { hostname: 'localhost' }; // → editionConfig.devCloudUrl
  globalThis.fetch = workerFetch;
  api = await import('../shared/data/cloud/cloudApi.js');
  auth = await import('../shared/data/cloud/cloudAuth.js');
  cb = await import('../shared/data/cloud/cloudBackup.js');
  vault = await import('../shared/data/cloud/cloudVault.js');
  keyStore = await import('../shared/data/cloud/vaultKeyStore.js');
  crypto = await import('../shared/data/cloud/vaultCrypto.js');
  settings = await import('../shared/data/settings.js');
  appReset = await import('../shared/data/appReset.js');
  ie = await import('../shared/data/importExport.js');
  const edition = await import('../shared/data/editionConfig.js');
  edition.editionFlags.licenseGate = false;
});

beforeEach(async () => {
  env = await makeEnv();
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
  calls.length = 0;
  devices.clear();
  currentDevice = 'A';
  globalThis.fetch = workerFetch;
  uninstallFakePasskeys();
});

// --- helpers -----------------------------------------------------------------
const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-03-01T00:00:00.000Z';
const put = (table, row) => tables[table].rows.set(row.id, structuredClone(row));
const row = (id, extra = {}) => ({ id, is_archived: false, created_at: T0, updated_at: T0, ...extra });

function putDog(id, extra = {}) {
  put('dogs', row(id, { call_name: id, sex: 'female', breed: 'Boxer', status: 'active_breeding', ownership_type: 'owned', kennel_id: 'k1', notes: `notes for ${id}`, ...extra }));
}

// A program with private data in every shape: private fields, a private-only
// document (a contract) whose file must be encrypted, and a cloud-tier one.
function putProgram() {
  put('kennels', row('k1', { kennel_name: 'Oak Hill', is_own_kennel: true }));
  put('contacts', row('c1', { name: 'Pat', email: 'pat@example.com', phone: '555-0101' }));
  for (let i = 1; i <= 3; i++) putDog(`d${i}`);
  put('files', { id: 'fc', blob: new Blob(['%PDF contract terms'], { type: 'application/pdf' }), mime: 'application/pdf', filename: 'contract.pdf', size: 19, thumbnail: '', created_at: T0 });
  put('documents', row('docc', { kennel_id: 'k1', dog_id: 'd1', doc_type: 'contract', file_id: 'fc', title: 'Sale contract' }));
  put('files', { id: 'fp', blob: new Blob(['%PDF pedigree'], { type: 'application/pdf' }), mime: 'application/pdf', filename: 'ped.pdf', size: 13, thumbnail: '', created_at: T0 });
  put('documents', row('docp', { kennel_id: 'k1', dog_id: 'd1', doc_type: 'pedigree', file_id: 'fp', title: 'Pedigree' }));
  settings.markDataChanged();
}

const devices = new Map();
let currentDevice = 'A';
function switchDevice(name) {
  const storage = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); storage[k] = localStorage.getItem(k); }
  const data = {};
  for (const [n, t] of Object.entries(tables)) data[n] = new Map(t.rows);
  devices.set(currentDevice, { storage, data });
  localStorage.clear();
  for (const t of Object.values(tables)) t.rows.clear();
  const saved = devices.get(name);
  if (saved) {
    for (const [k, v] of Object.entries(saved.storage)) localStorage.setItem(k, v);
    for (const [n, rows] of Object.entries(saved.data)) for (const [id, r] of rows) tables[n].rows.set(id, r);
  }
  currentDevice = name;
}

async function signIn(email = 'breeder@example.com', deviceLabel = 'Phone A') {
  await auth.startSignIn(email);
  return auth.verifySignIn(email, lastCode(env), { deviceLabel });
}

// Device A: backup on, vault on. Returns the recovery code.
async function turnOnWithVault() {
  putProgram();
  await signIn();
  assert.equal((await cb.enableBackup()).status, 'pushed');
  const setup = await vault.startVaultSetup();
  const push = await vault.finishVaultSetup(setup, { confirmation: setup.lastGroup });
  assert.equal(push.status, 'pushed');
  assert.equal(push.vault, true);
  return setup.recoveryCode;
}

// A new device B that signed in and restored the latest backup (locked unless
// it was unlocked first).
async function newDeviceRestores({ code = null } = {}) {
  switchDevice('B');
  await signIn('breeder@example.com', 'Laptop B');
  if (code) await vault.unlockWithRecoveryCode(code, { merge: false });
  return cb.restoreLatestAndTakeOver();
}

// --- turning it on -------------------------------------------------------------------

test('turning it on needs the last group typed back; then the first encrypted backup runs', async () => {
  putProgram();
  await signIn();
  await cb.enableBackup();
  const setup = await vault.startVaultSetup();
  assert.match(setup.recoveryCode, /^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/);
  await assert.rejects(vault.finishVaultSetup(setup, { confirmation: 'ZZZZ' }), { name: 'VaultSetupError', code: 'confirm_mismatch' });
  assert.equal((await vault.vaultStatus()).enabled, false, 'nothing sent on a mismatch');

  calls.length = 0;
  const push = await vault.finishVaultSetup(setup, { confirmation: setup.lastGroup.toLowerCase() });
  assert.equal(push.status, 'pushed');
  // The vault part lands before the body that commits; the contract goes up encrypted.
  const vaultPut = calls.findIndex((c) => /^PUT \/snapshots\/.*\/vault$/.test(c));
  const bodyPut = calls.findIndex((c) => /^PUT \/snapshots\/.*\/body$/.test(c));
  assert.ok(vaultPut !== -1 && vaultPut < bodyPut, calls.join(' | '));

  const status = await vault.vaultStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.unlocked, true);
  assert.ok(status.recovery);
  assert.equal(cb.getBackupStatus().vault, 'on');
  assert.ok(cb.getBackupStatus().vaultPushedAt);
});

test('leak test: the kennel-tier snapshot is the same with the vault on', async () => {
  putProgram();
  await signIn();
  await cb.enableBackup();
  const before = (await cb.buildCloudSnapshot({ now: new Date(T1) })).envelope;
  const setup = await vault.startVaultSetup();
  await vault.finishVaultSetup(setup, { confirmation: setup.lastGroup });
  const after = (await cb.buildCloudSnapshot({ now: new Date(T1) })).envelope;
  assert.deepEqual(after, before);

  const [snap] = await cb.listSnapshots();
  assert.equal(snap.vaultKeyId, (await keyStore.getVaultKey(auth.currentAccount().programId)).keyId);
  const json = JSON.stringify(await cb.downloadSnapshot(snap.id));
  for (const leaked of ['notes for', 'pat@example.com', '555-0101', 'Sale contract']) assert.ok(!json.includes(leaked), leaked);

  // The vault part on the server is ciphertext: none of it readable.
  const bytes = new Uint8Array(await (await api.getSnapshotVault(auth.sessionToken(), snap.id)).arrayBuffer());
  assert.equal(crypto.readVaultHeader(bytes).keyId, snap.vaultKeyId);
  const text = new TextDecoder('latin1').decode(bytes);
  for (const leaked of ['notes for', 'pat@example.com', 'contract terms']) assert.ok(!text.includes(leaked), leaked);
});

test('with the vault on, a private-only edit pushes (it used to be "unchanged")', async () => {
  await turnOnWithVault();
  tables.contacts.rows.get('c1').phone = '555-0199';
  settings.markDataChanged();
  const r = await cb.pushIfDirty();
  assert.equal(r.status, 'pushed');
  assert.equal(r.vault, true);
  assert.equal((await cb.pushIfDirty()).status, 'skipped', 'clean afterwards');
});

// --- a new device ------------------------------------------------------------------------

test('a new device unlocked first gets everything back, private files included', async () => {
  const code = await turnOnWithVault();
  const { restored, push } = await newDeviceRestores({ code });
  assert.equal(restored.vault.status, 'restored');
  assert.deepEqual(restored.vault.missingFiles, []);
  assert.equal(tables.dogs.rows.get('d1').notes, 'notes for d1');
  assert.equal(tables.contacts.rows.get('c1').phone, '555-0101');
  assert.equal(tables.documents.rows.get('docc').title, 'Sale contract');
  assert.equal(await tables.files.rows.get('fc').blob.text(), '%PDF contract terms');
  assert.equal(tables.files.rows.get('fc').blob.type, 'application/pdf');
  assert.equal(await tables.files.rows.get('fp').blob.text(), '%PDF pedigree');
  assert.ok(!('vault_file' in tables.files.rows.get('fc')));
  assert.equal(push.status, 'pushed');
  assert.equal(push.vault, true, 'B now backs up both tiers');
});

test('"Not now": the kennel tier restores, pushes pause until unlocked, then the private tier merges in', async () => {
  const code = await turnOnWithVault();
  const { restored, push } = await newDeviceRestores();
  assert.equal(restored.vault.status, 'locked');
  assert.equal(tables.dogs.rows.get('d1').call_name, 'd1');
  assert.ok(!('notes' in tables.dogs.rows.get('d1')), 'private fields blank while locked');
  assert.equal(tables.documents.rows.get('docc'), undefined, 'private-only rows absent while locked');
  assert.equal(push.status, 'vault_locked');
  let st = cb.getBackupStatus();
  assert.equal(st.vault, 'locked');
  assert.equal(st.paused, true);

  // Paused: automatic pushes don't try.
  putDog('d9');
  settings.markDataChanged();
  calls.length = 0;
  assert.deepEqual(await cb.pushIfDirty(), { status: 'skipped', reason: 'paused' });
  assert.deepEqual(calls, []);

  // A wrong code doesn't open it.
  await assert.rejects(vault.unlockWithRecoveryCode('0000-0000-0000-0000-0000-0000'), { name: 'VaultLockedError' });
  await assert.rejects(vault.unlockWithRecoveryCode('too short'), { name: 'VaultLockedError' });

  const { merged } = await vault.unlockWithRecoveryCode(code.toLowerCase().replace(/-/g, ' '));
  assert.equal(merged.status, 'restored');
  assert.equal(tables.dogs.rows.get('d1').notes, 'notes for d1');
  assert.equal(tables.documents.rows.get('docc').title, 'Sale contract');
  assert.equal(await tables.files.rows.get('fc').blob.text(), '%PDF contract terms');
  assert.equal(tables.dogs.rows.get('d9').call_name, 'd9', 'records added while locked stay');
  st = cb.getBackupStatus();
  assert.equal(st.paused, false);
  assert.equal(st.vault, 'on');
  const r = await cb.pushIfDirty();
  assert.equal(r.status, 'pushed');
  assert.equal(r.vault, true);
});

test('a record edited while locked keeps the edit and gets its private details back', async () => {
  const code = await turnOnWithVault();
  await newDeviceRestores();
  const d1 = tables.dogs.rows.get('d1');
  d1.call_name = 'Renamed';
  d1.updated_at = T1;
  const d2 = tables.dogs.rows.get('d2');
  d2.notes = 'typed in while locked';
  d2.updated_at = T1;
  await vault.unlockWithRecoveryCode(code);
  assert.equal(tables.dogs.rows.get('d1').call_name, 'Renamed');
  assert.equal(tables.dogs.rows.get('d1').notes, 'notes for d1');
  assert.equal(tables.dogs.rows.get('d2').notes, 'typed in while locked');
});

// --- the vault changing elsewhere ------------------------------------------------------------

test('turned off on one device: the other forgets its key and keeps backing up without it', async () => {
  const code = await turnOnWithVault();
  await newDeviceRestores({ code });
  await vault.disableVault();
  assert.equal(await keyStore.getVaultKey(auth.currentAccount().programId), null);
  assert.equal((await vault.vaultStatus()).enabled, false);
  assert.equal(cb.getBackupStatus().vault, 'off');
  await assert.rejects(vault.unlockWithRecoveryCode(code), { name: 'VaultSetupError', code: 'no_vault' });

  // A still holds the key. B takes over again from A's side, then pushes.
  switchDevice('A');
  await cb.restoreLatestAndTakeOver();
  const programId = auth.currentAccount().programId;
  assert.equal(await keyStore.getVaultKey(programId), null, 'no_vault: the key here is forgotten');
  assert.equal(cb.getBackupStatus().vault, 'off');
  putDog('d7');
  settings.markDataChanged();
  const r = await cb.pushIfDirty();
  assert.equal(r.status, 'pushed');
  assert.equal(r.vault, false);
});

test('re-keyed elsewhere: a device with the old key pauses as locked instead of pushing', async () => {
  await turnOnWithVault();
  switchDevice('B');
  await signIn('breeder@example.com', 'Laptop B');
  await vault.disableVault();
  const setup = await vault.startVaultSetup();
  await vault.finishVaultSetup(setup, { confirmation: setup.lastGroup }); // backup is off on B: no push

  switchDevice('A');
  putDog('d8');
  settings.markDataChanged();
  const r = await cb.pushIfDirty();
  assert.equal(r.status, 'vault_locked');
  assert.equal(r.stale, true);
  assert.equal(await keyStore.getVaultKey(auth.currentAccount().programId), null);
  assert.equal(cb.getBackupStatus().vault, 'locked');

  await vault.unlockWithRecoveryCode(setup.recoveryCode, { merge: false });
  assert.equal((await cb.pushIfDirty({ force: true })).status, 'pushed');
});

test('a new recovery code replaces the old one', async () => {
  const oldCode = await turnOnWithVault();
  const d = vault.startNewRecoveryCode();
  await assert.rejects(vault.finishNewRecoveryCode(d, { confirmation: 'nope' }), { code: 'confirm_mismatch' });
  await vault.finishNewRecoveryCode(d, { confirmation: d.lastGroup });

  switchDevice('B');
  await signIn('breeder@example.com', 'Laptop B');
  await assert.rejects(vault.unlockWithRecoveryCode(oldCode, { merge: false }), { name: 'VaultLockedError' });
  await vault.unlockWithRecoveryCode(d.recoveryCode, { merge: false });
  assert.equal((await vault.vaultStatus()).unlocked, true);
});

test('restore as of an earlier backup rolls private fields back too, when unlocked', async () => {
  await turnOnWithVault();
  const [older] = await cb.listSnapshots();
  const d1 = tables.dogs.rows.get('d1');
  d1.notes = 'newer private note';
  d1.updated_at = T1;
  settings.markDataChanged();
  assert.equal((await cb.pushIfDirty()).status, 'pushed');

  const r = await cb.restoreSnapshot(await cb.downloadSnapshot(older.id), { overwrite: true });
  assert.equal(r.vault.status, 'restored');
  assert.equal(tables.dogs.rows.get('d1').notes, 'notes for d1');
});

// --- the key on the device ---------------------------------------------------------------------

test('the vault key is never in a backup, and Reset App clears it', async () => {
  await turnOnWithVault();
  const programId = auth.currentAccount().programId;
  assert.ok(await keyStore.getVaultKey(programId));
  const backup = await ie.exportAll({ encodeBlobs: false });
  assert.ok(!('device_secrets' in backup.collections));
  await ie.restoreBackup({ collections: { device_secrets: [{ id: 'vault-key', program_id: programId, key_id: 'x' }] } }, 'replace');
  assert.ok((await keyStore.getVaultKey(programId)).key, 'a file restore neither imports nor clears it');

  await appReset.resetApp();
  assert.equal(await keyStore.getVaultKey(programId), null);
  assert.equal(cb.getBackupStatus().vault, null);
});

test('the key is tagged with its program: another account never uses it', async () => {
  await turnOnWithVault();
  const programId = auth.currentAccount().programId;
  assert.equal(await keyStore.getVaultKey('another-program'), null);
  assert.ok(await keyStore.getVaultKey(programId));
});

// --- unlocking from another device (§2.4, §5.3) ---------------------------------------------

// Device A has the vault on and unlocked; device B signs in, restores locked,
// and asks to be unlocked. Returns B's request (B is the current device).
async function bAsksToBeUnlocked() {
  await turnOnWithVault();
  await newDeviceRestores();
  return vault.requestDeviceUnlock({ label: 'Laptop B' });
}

test('another device unlocks this one with the code shown here; the private tier merges in', async () => {
  const req = await bAsksToBeUnlocked();
  assert.match(req.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.deepEqual(await vault.pollDeviceUnlock(), { status: 'waiting', expiresAt: req.expiresAt });
  assert.equal((await vault.pendingDeviceUnlock()).code, req.code, 'survives a page change');
  assert.deepEqual(await vault.listUnlockRequests(), [], 'a device never sees its own request');

  switchDevice('A');
  const [open] = await vault.listUnlockRequests();
  assert.equal(open.id, req.pairingId);
  assert.equal(open.deviceLabel, 'Laptop B');
  await assert.rejects(vault.approveDeviceUnlock(open, 'short'), { name: 'VaultLockedError' });
  await vault.approveDeviceUnlock(open, req.code.toLowerCase());
  assert.deepEqual(await vault.listUnlockRequests(), []);

  switchDevice('B');
  const r = await vault.pollDeviceUnlock();
  assert.equal(r.status, 'unlocked');
  assert.equal(r.merged.status, 'restored');
  assert.equal(tables.dogs.rows.get('d1').notes, 'notes for d1');
  assert.equal(await tables.files.rows.get('fc').blob.text(), '%PDF contract terms');
  assert.equal(await vault.pendingDeviceUnlock(), null, 'the request is done');
  assert.equal(cb.getBackupStatus().paused, false);
  const push = await cb.pushIfDirty({ force: true });
  assert.equal(push.status, 'pushed');
  assert.equal(push.vault, true);
});

test('a wrong code typed on the approver: the new device can\'t open it and must ask again', async () => {
  const req = await bAsksToBeUnlocked();
  switchDevice('A');
  const [open] = await vault.listUnlockRequests();
  await vault.approveDeviceUnlock(open, 'ZZZZ-ZZZZ-ZZZZ');
  switchDevice('B');
  await assert.rejects(vault.pollDeviceUnlock(), { name: 'VaultLockedError' });
  assert.equal(await keyStore.getVaultKey(auth.currentAccount().programId), null);
  await assert.rejects(vault.pollDeviceUnlock(), { name: 'VaultSetupError', code: 'expired' }, 'one try per request');
  assert.ok(req.code);
});

test('a request expires after ten minutes, on both sides', async () => {
  await bAsksToBeUnlocked();
  env.DB.raw.prepare("UPDATE vault_pairings SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  switchDevice('A');
  assert.deepEqual(await vault.listUnlockRequests(), []);
  switchDevice('B');
  await assert.rejects(vault.pollDeviceUnlock(), { name: 'VaultSetupError', code: 'expired' });
  assert.equal(await vault.pendingDeviceUnlock(), null);
  // And locally, without asking the server, once its time has passed.
  await vault.requestDeviceUnlock();
  assert.equal(await vault.pendingDeviceUnlock({ now: Date.now() + 11 * 60 * 1000 }), null);
});

test('only an unlocked device can approve', async () => {
  const req = await bAsksToBeUnlocked();
  switchDevice('C');
  await signIn('breeder@example.com', 'Tablet C');
  const [open] = await vault.listUnlockRequests();
  await assert.rejects(vault.approveDeviceUnlock(open, req.code), { name: 'VaultSetupError', code: 'locked' });
});

test('waiting: polls until approved, and stops when cancelled', async () => {
  const req = await bAsksToBeUnlocked();
  const controller = new AbortController();
  let waits = 0;
  const cancelled = await vault.waitForDeviceUnlock({ intervalMs: 1, signal: controller.signal, onWaiting: () => { if (++waits === 2) controller.abort(); } });
  assert.deepEqual(cancelled, { status: 'cancelled' });
  assert.equal(waits, 2);

  // Approve from A between B's polls (the fetch stand-in switches devices).
  let approved = false;
  const r = await vault.waitForDeviceUnlock({
    intervalMs: 1,
    merge: false,
    onWaiting: async () => {
      if (approved) return;
      approved = true;
      switchDevice('A');
      const [open] = await vault.listUnlockRequests();
      await vault.approveDeviceUnlock(open, req.code);
      switchDevice('B');
    }
  });
  assert.equal(r.status, 'unlocked');
  assert.equal(r.merged, null);
});

// --- passkeys (§5.2) ---------------------------------------------------------------------------
// The fake authenticator stands for a synced password manager: a passkey made
// on A is there on B too.

test('a passkey added on one device unlocks another; the private tier merges in', async () => {
  const pk = installFakePasskeys();
  await turnOnWithVault();
  const before = await vault.vaultStatus();
  assert.equal(before.passkeySupported, true);
  assert.deepEqual(before.passkeys, []);
  const { id } = await vault.addPasskey({ label: 'Made on Phone A' });
  assert.equal(pk.creates[0].rp.id, 'localhost');
  const st = await vault.vaultStatus();
  assert.deepEqual(st.passkeys.map((p) => [p.id, p.label]), [[id, 'Made on Phone A']]);
  assert.ok(!('credentialId' in st.passkeys[0]));

  // The server holds the credential id and salt, never the PRF output.
  const w = await api.getVaultWrap(auth.sessionToken(), id);
  assert.equal(w.kind, 'passkey');
  assert.ok(pk.store.has(w.credentialId));

  await newDeviceRestores();
  assert.equal(cb.getBackupStatus().vault, 'locked');
  const { merged } = await vault.unlockWithPasskey();
  assert.equal(merged.status, 'restored');
  assert.equal(tables.contacts.rows.get('c1').phone, '555-0101');
  assert.equal(await tables.files.rows.get('fc').blob.text(), '%PDF contract terms');
  assert.equal(cb.getBackupStatus().vault, 'on');
  const push = await cb.pushIfDirty({ force: true });
  assert.equal(push.status, 'pushed');
  assert.equal(push.vault, true);
});

test('passkeys: a duplicate is refused, one without PRF saves nothing, a locked device can\'t add', async () => {
  const pk = installFakePasskeys();
  await turnOnWithVault();
  await vault.addPasskey();
  await assert.rejects(vault.addPasskey(), { name: 'PasskeyError', code: 'exists' }, 'the same password manager');
  assert.equal(pk.creates[1].excludeCredentials.length, 1);

  pk.prfSupported = false;
  pk.store.clear(); // a different authenticator, one without PRF
  await assert.rejects(vault.addPasskey(), { name: 'PasskeyError', code: 'unsupported' });
  assert.equal((await vault.vaultStatus()).passkeys.length, 1, 'nothing saved');

  await newDeviceRestores();
  pk.prfSupported = true;
  await assert.rejects(vault.addPasskey(), { name: 'VaultSetupError', code: 'locked' });
  await assert.rejects(vault.unlockWithPasskey(), { name: 'PasskeyError', code: 'cancelled' }, 'its passkey is not on this device');
  assert.equal(cb.getBackupStatus().vault, 'locked');
});

test('passkeys: none set up; a removed one stops working; a new recovery code keeps them', async () => {
  const pk = installFakePasskeys();
  const code = await turnOnWithVault();
  await assert.rejects(vault.unlockWithPasskey(), { name: 'VaultSetupError', code: 'no_passkey' });
  const { id: first } = await vault.addPasskey({ label: 'one' });
  const keep = new Map(pk.store);
  pk.store.clear(); // a second password manager
  await vault.addPasskey({ label: 'two' });
  for (const [k, v] of keep) pk.store.set(k, v);

  const d = vault.startNewRecoveryCode();
  await vault.finishNewRecoveryCode(d, { confirmation: d.lastGroup });

  switchDevice('B');
  await signIn('breeder@example.com', 'Laptop B');
  await vault.unlockWithPasskey({ merge: false });
  assert.equal((await vault.vaultStatus()).unlocked, true, 'the passkey survived the new recovery code');
  await vault.removePasskey(first);
  assert.deepEqual((await vault.vaultStatus()).passkeys.map((p) => p.label), ['two']);

  // C has only the first passkey's password manager: it can't unlock any more.
  switchDevice('C');
  await signIn('breeder@example.com', 'Tablet C');
  for (const k of [...pk.store.keys()]) if (!keep.has(k)) pk.store.delete(k);
  await assert.rejects(vault.unlockWithPasskey({ merge: false }), { name: 'PasskeyError', code: 'cancelled' });
  await assert.rejects(vault.unlockWithRecoveryCode(code, { merge: false }), { name: 'VaultLockedError' });
  await vault.unlockWithRecoveryCode(d.recoveryCode, { merge: false });

  // Turning it off removes every passkey wrap with the rest.
  await vault.disableVault();
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM vault_wraps').get().n, 0);
});

// --- handoff codes (§5.4) ------------------------------------------------------------

test('handoff code: the unlocked device makes it, the new one pastes it once and gets everything', async () => {
  await turnOnWithVault();
  const { code, expiresAt } = await vault.createHandoffCode();
  assert.match(code, /^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/);
  assert.ok(Date.parse(expiresAt) > Date.now() + 59 * 60 * 1000);

  switchDevice('B');
  await signIn('breeder@example.com', 'Pro on the same phone');
  await assert.rejects(vault.createHandoffCode(), { name: 'VaultSetupError', code: 'locked' });
  await assert.rejects(vault.unlockWithHandoffCode('0000-0000-0000-0000-0000-0000'), { name: 'VaultLockedError' });
  await assert.rejects(vault.unlockWithHandoffCode('short'), { name: 'VaultLockedError' });

  const { merged } = await vault.unlockWithHandoffCode(` ${code.toLowerCase()} `);
  assert.equal(merged.status, 'restored');
  assert.equal(tables.contacts.rows.get('c1').phone, '555-0101');
  assert.equal(await tables.files.rows.get('fc').blob.text(), '%PDF contract terms');
  assert.equal((await vault.vaultStatus()).unlocked, true);

  // Used up: pasting it again (after forgetting the key) doesn't open anything.
  await keyStore.clearVaultKey();
  await assert.rejects(vault.unlockWithHandoffCode(code, { merge: false }), { name: 'VaultLockedError' });
});

test('handoff box: the recovery code works there too', async () => {
  const recovery = await turnOnWithVault();
  switchDevice('B');
  await signIn('breeder@example.com', 'Laptop B');
  await vault.unlockWithHandoffCode(recovery, { merge: false });
  assert.equal((await vault.vaultStatus()).unlocked, true);
});

// --- passkey first (§2.1, decided 2026-10-10) ------------------------------------------

test('passkey first: one prompt turns it on; the recovery code waits, works, and is saved by its last group', async () => {
  installFakePasskeys();
  putProgram();
  await signIn();
  assert.equal((await cb.enableBackup()).status, 'pushed');
  const push = await vault.quickVaultSetup({ label: 'Phone A' });
  assert.equal(push.status, 'pushed');
  assert.equal(push.vault, true);
  const st = await vault.vaultStatus();
  assert.equal(st.unlocked, true);
  assert.deepEqual(st.passkeys.map((p) => p.label), ['Phone A']);

  const code = await vault.unsavedRecoveryCode();
  assert.match(code, /^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/);
  await assert.rejects(vault.markRecoveryCodeSaved('ZZZZ'), { name: 'VaultSetupError', code: 'confirm_mismatch' });
  assert.equal(await vault.unsavedRecoveryCode(), code);

  // The waiting code really opens the vault on a new device.
  switchDevice('B');
  await signIn('breeder@example.com', 'Laptop B');
  await vault.unlockWithRecoveryCode(code, { merge: false });
  assert.equal((await vault.vaultStatus()).unlocked, true);
  assert.equal(await vault.unsavedRecoveryCode(), null, 'only the device that made it shows it');

  switchDevice('A');
  await vault.markRecoveryCodeSaved(code.slice(-4).toLowerCase());
  assert.equal(await vault.unsavedRecoveryCode(), null);
});

test('passkey first: no PRF or a cancel leaves the vault off; turning it off forgets the unsaved code', async () => {
  const pk = installFakePasskeys({ prf: false });
  putProgram();
  await signIn();
  await cb.enableBackup();
  await assert.rejects(vault.quickVaultSetup(), { name: 'PasskeyError', code: 'unsupported' });
  pk.prfSupported = true;
  pk.cancelNext = true;
  await assert.rejects(vault.quickVaultSetup(), { name: 'PasskeyError', code: 'cancelled' });
  assert.equal((await vault.vaultStatus()).enabled, false);

  await vault.quickVaultSetup();
  assert.ok(await vault.unsavedRecoveryCode());
  await vault.disableVault();
  assert.equal(await vault.unsavedRecoveryCode(), null);
});
