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
