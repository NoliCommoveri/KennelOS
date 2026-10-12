// cloudSync.test.js — live sync's client loop (Cloud Phase 2 plan §5; build step 3):
// data/cloud/cloudSync.js and data/syncApply.js driven END TO END against the
// real Worker code (cloud/src), in-process, as cloudVault.test.js does. "Devices"
// are simulated by swapping localStorage and the in-memory tables (sync_meta
// and the vault key included).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { makeEnv, lastCode } from '../cloud/tests/helpers/env.js';
import { worker } from '../cloud/tests/helpers/worker.js';

let tables; let env;
let auth; let api; let settings; let vault; let sync; let apply; let state;

async function workerFetch(url, init = {}) {
  const headers = { ...(init.headers || {}), origin: 'http://localhost:8000' };
  let body = init.body;
  if (body instanceof Blob) {
    body = new Uint8Array(await body.arrayBuffer());
    headers['content-length'] = String(body.length);
  } else if (typeof body === 'string') {
    headers['content-length'] = String(new TextEncoder().encode(body).length);
  }
  return worker.fetch(new Request(url, { method: init.method, headers, body, signal: init.signal }), env);
}

before(async () => {
  ({ tables } = await installMemoryDb());
  globalThis.location = { hostname: 'localhost' }; // → editionConfig.devCloudUrl
  globalThis.fetch = workerFetch;
  api = await import('../shared/data/cloud/cloudApi.js');
  auth = await import('../shared/data/cloud/cloudAuth.js');
  vault = await import('../shared/data/cloud/cloudVault.js');
  sync = await import('../shared/data/cloud/cloudSync.js');
  apply = await import('../shared/data/syncApply.js');
  state = await import('../shared/data/cloud/syncState.js');
  settings = await import('../shared/data/settings.js');
  const edition = await import('../shared/data/editionConfig.js');
  edition.editionFlags.licenseGate = false;
});

beforeEach(async () => {
  env = await makeEnv();
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
  devices.clear();
  currentDevice = 'A';
});

// --- devices -----------------------------------------------------------------
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

const T0 = '2026-01-01T00:00:00.000Z';
const put = (table, row) => tables[table].rows.set(row.id, structuredClone(row));
const row = (id, extra = {}) => ({ id, is_archived: false, created_at: T0, updated_at: T0, ...extra });
const dog = (id, extra = {}) => row(id, { call_name: id, sex: 'female', breed: 'Boxer', status: 'active_breeding', ownership_type: 'owned', kennel_id: 'k1', notes: `notes for ${id}`, ...extra });
const get = (table, id) => structuredClone(tables[table].rows.get(id));

function makePro() {
  const eh = env.DB.raw.prepare('SELECT email_hash FROM users LIMIT 1').get().email_hash;
  env.DB.raw.prepare(
    `INSERT OR IGNORE INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
     VALUES ('order:1', ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`,
  ).run(eh, T0, T0);
}

async function signIn(label) {
  await auth.startSignIn('breeder@example.com');
  return auth.verifySignIn('breeder@example.com', lastCode(env), { deviceLabel: label });
}

// Device A: a small program, Pro, the vault on, sync on; then B signed in,
// unlocked and syncing with nothing yet. Returns to A.
async function twoDevices() {
  put('kennels', row('k1', { kennel_name: 'Oak Hill', is_own_kennel: true }));
  put('contacts', row('c1', { name: 'Pat', email: 'pat@example.com', phone: '555-0101' }));
  put('dogs', dog('d1'));
  put('dogs', dog('d2'));
  await signIn('Phone A');
  makePro();
  const setup = await vault.startVaultSetup();
  await vault.finishVaultSetup(setup, { confirmation: setup.lastGroup });
  await api.enableSync(auth.sessionToken());
  settings.updateCloudSyncState({ enabled: true });
  switchDevice('B');
  await signIn('Laptop B');
  await vault.unlockWithRecoveryCode(setup.recoveryCode, { merge: false });
  settings.updateCloudSyncState({ enabled: true });
  switchDevice('A');
  return setup.recoveryCode;
}

test('A pushes everything; B pulls it, private fields included, and nothing echoes back', async () => {
  await twoDevices();
  const first = await sync.syncNow();
  assert.equal(first.push.status, 'pushed');
  assert.equal(first.push.pushed, 4);
  assert.equal((await sync.syncNow()).push.status, 'nothing', 'its own records are known now');

  switchDevice('B');
  const b = await sync.syncNow();
  assert.equal(b.pull.status, 'pulled');
  assert.equal(b.pull.applied, 4);
  assert.deepEqual(get('contacts', 'c1'), row('c1', { name: 'Pat', email: 'pat@example.com', phone: '555-0101' }), 'the sealed whole row, private fields too');
  assert.equal(get('dogs', 'd1').notes, 'notes for d1');
  assert.equal((await sync.syncNow()).push.status, 'nothing', 'pulled rows are not pushed back');
  assert.equal(settings.getCloudSyncState().cursor, 4);
});

test('an edit on B reaches A; a hard delete on A reaches B', async () => {
  await twoDevices();
  await sync.syncNow();
  switchDevice('B');
  await sync.syncNow();
  put('dogs', { ...get('dogs', 'd1'), call_name: 'Birch', updated_at: '2026-02-01T00:00:00.000Z' });
  assert.equal((await sync.syncNow()).push.pushed, 1);

  switchDevice('A');
  const a = await sync.syncNow();
  assert.equal(a.pull.applied, 1);
  assert.equal(get('dogs', 'd1').call_name, 'Birch');
  assert.equal(get('dogs', 'd1').updated_at, '2026-02-01T00:00:00.000Z', 'pulled rows keep their own timestamps');
  tables.dogs.rows.delete('d2');
  assert.equal((await sync.syncNow()).push.deleted, 1);

  switchDevice('B');
  await sync.syncNow();
  assert.equal(tables.dogs.rows.has('d2'), false);
});

test('the same record edited on both: the version the server got last wins, and the loser is noted', async () => {
  await twoDevices();
  await sync.syncNow();
  switchDevice('B');
  await sync.syncNow();
  put('dogs', { ...get('dogs', 'd1'), notes: 'from B' });
  switchDevice('A');
  put('dogs', { ...get('dogs', 'd1'), notes: 'from A, not pushed yet' });
  switchDevice('B');
  await sync.syncNow({ pull: false }); // B's reaches the server first
  switchDevice('A');
  const res = await sync.pullChanges();
  assert.equal(res.applied, 1);
  assert.equal(get('dogs', 'd1').notes, 'from B');
  const act = settings.getCloudSyncState().activity;
  assert.equal(act[0].kind, 'kept_theirs');
  assert.equal(act[0].id, 'd1');
  assert.equal((await sync.pushChanges()).status, 'nothing', 'A\'s overwritten edit isn\'t pushed afterwards');
});

test('a delete that arrives where something now points at the record becomes an archive, pushed back', async () => {
  await twoDevices();
  await sync.syncNow();
  switchDevice('B');
  await sync.syncNow();
  // B: a litter for d2, not pushed yet.
  put('litters', row('l1', { dam_id: 'd2', sire_id: 'd1', status: 'planned', kennel_id: 'k1' }));
  switchDevice('A');
  tables.dogs.rows.delete('d2');
  await sync.syncNow();
  switchDevice('B');
  const res = await sync.pullChanges();
  assert.equal(res.applied, 1);
  assert.equal(get('dogs', 'd2').is_archived, true, 'archived, not deleted');
  assert.equal(settings.getCloudSyncState().activity[0].kind, 'archived_instead');
  const pushed = await sync.pushChanges();
  assert.equal(pushed.pushed, 2, 'the archived dog and the litter go up');
  switchDevice('A');
  await sync.pullChanges();
  assert.equal(get('dogs', 'd2').is_archived, true);
  assert.equal(get('litters', 'l1').dam_id, 'd2');
});

test('documents: a private file and a cloud file reach the other device with their bytes', async () => {
  await twoDevices();
  put('files', { id: 'fc', blob: new Blob(['%PDF contract terms'], { type: 'application/pdf' }), mime: 'application/pdf', filename: 'contract.pdf', size: 19, thumbnail: '', created_at: T0 });
  put('documents', row('docc', { kennel_id: 'k1', dog_id: 'd1', doc_type: 'contract', file_id: 'fc', title: 'Sale contract' }));
  put('files', { id: 'fp', blob: new Blob(['%PDF pedigree'], { type: 'application/pdf' }), mime: 'application/pdf', filename: 'ped.pdf', size: 13, thumbnail: '', created_at: T0 });
  put('documents', row('docp', { kennel_id: 'k1', dog_id: 'd1', doc_type: 'pedigree', file_id: 'fp', title: 'Pedigree' }));
  await sync.syncNow();
  const stored = env.DB.raw.prepare("SELECT id, cloud_json, file_sha256 FROM sync_records WHERE tbl = 'files' ORDER BY id").all();
  assert.equal(JSON.parse(stored[1].cloud_json).filename, 'ped.pdf', 'the pedigree file is cloud tier');
  assert.equal(stored[0].cloud_json, null, 'the contract file is private');
  assert.ok(stored.every((s) => /^[0-9a-f]{64}$/.test(s.file_sha256)));

  switchDevice('B');
  await sync.syncNow();
  assert.equal(await get('files', 'fc').blob.text(), '%PDF contract terms');
  assert.equal(await get('files', 'fp').blob.text(), '%PDF pedigree');
  assert.equal((await sync.pushChanges()).status, 'nothing', 'pulled files hash the same as the scan');
});

test('a record the server drops is not resent until it changes', async () => {
  await twoDevices();
  await sync.syncNow();
  // Pretend the server's allow-list is narrower than this device's (an old server).
  const { CLOUD_FIELDS } = await import('../cloud/src/lib/cloudFields.js');
  const keys = CLOUD_FIELDS.tables.dogs.keys;
  CLOUD_FIELDS.tables.dogs.keys = keys.filter((k) => k !== 'call_name');
  try {
    put('dogs', { ...get('dogs', 'd1'), notes: 'edit' });
    const res = await sync.pushChanges();
    assert.equal(res.dropped, 1);
    assert.equal(settings.getCloudSyncState().activity[0].reason, 'cloud_key:call_name');
    assert.equal((await sync.pushChanges()).status, 'nothing', 'not resent unchanged');
  } finally {
    CLOUD_FIELDS.tables.dogs.keys = keys;
  }
  put('dogs', { ...get('dogs', 'd1'), notes: 'edit again' });
  assert.equal((await sync.pushChanges()).pushed, 1, 'a new change goes');
});

test('the shrink guard stops a push that deletes most records, until the user says yes', async () => {
  await twoDevices();
  for (let i = 0; i < 10; i++) put('dogs', dog(`x${i}`));
  await sync.syncNow();
  for (let i = 0; i < 10; i++) tables.dogs.rows.delete(`x${i}`);
  const res = await sync.pushChanges();
  assert.equal(res.status, 'shrink');
  assert.equal(settings.getCloudSyncState().lastError.code, 'shrink');
  assert.equal((await sync.pushChanges({ allowShrink: true })).deleted, 10);
});

test('pauses: a locked vault, a lapsed license, sync turned off, a cursor past the horizon', async () => {
  await twoDevices();
  await sync.syncNow();
  const keyStore = await import('../shared/data/cloud/vaultKeyStore.js');
  const key = await keyStore.getVaultKey(auth.currentAccount().programId);
  await keyStore.clearVaultKey();
  assert.deepEqual(await sync.pushChanges(), { status: 'paused', code: 'vault_locked' });
  await keyStore.setVaultKey(auth.currentAccount().programId, key);

  env.DB.raw.prepare('DELETE FROM pro_purchases').run();
  assert.deepEqual(await sync.pullChanges(), { status: 'paused', code: 'pro_required' });
  makePro();

  settings.updateCloudSyncState({ cursor: 1 });
  env.DB.raw.prepare('UPDATE programs SET sync_purged_seq = 3').run();
  assert.deepEqual(await sync.pullChanges(), { status: 'paused', code: 'resync_required' });

  env.DB.raw.prepare('UPDATE programs SET sync_enabled_at = NULL').run();
  put('dogs', dog('d9'));
  assert.deepEqual(await sync.pushChanges(), { status: 'paused', code: 'sync_off' });
  assert.equal(sync.syncStatus().paused, 'sync_off');
});

test('nothing runs where live sync isn\'t offered, or while this device isn\'t syncing', async () => {
  await twoDevices();
  settings.updateCloudSyncState({ enabled: false });
  assert.deepEqual(await sync.syncNow(), { push: null, pull: null });
  const edition = await import('../shared/data/editionConfig.js');
  edition.editionFlags.liveSync = false;
  try {
    settings.updateCloudSyncState({ enabled: true });
    assert.equal(sync.isSyncAvailable(), false);
    assert.deepEqual(await sync.syncNow(), { push: null, pull: null });
  } finally {
    edition.editionFlags.liveSync = true;
  }
});

test('its own echo never overwrites a newer local edit', async () => {
  await twoDevices();
  await sync.pushChanges(); // cursor still 0: the next pull returns these records
  put('dogs', { ...get('dogs', 'd1'), notes: 'edited again, not pushed yet' });
  const res = await sync.pullChanges();
  assert.equal(res.applied, 0);
  assert.equal(get('dogs', 'd1').notes, 'edited again, not pushed yet');
  assert.equal((await sync.pushChanges()).pushed, 1, 'and it still goes up');
});

// --- Step 4: turning it on, joining, turning it off (plan §2.1, §2.4, §5.5) -------------
// A: records, Pro, the vault on, backup on, sync NOT on. B: signed in and unlocked,
// backup on, with records of its own. Returns to A.
async function beforeSync() {
  put('kennels', row('k1', { kennel_name: 'Oak Hill', is_own_kennel: true }));
  put('dogs', dog('d1'));
  put('dogs', dog('d2'));
  await signIn('Phone A');
  makePro();
  const setup = await vault.startVaultSetup();
  await vault.finishVaultSetup(setup, { confirmation: setup.lastGroup });
  settings.updateCloudBackupState({ enabled: true });
  switchDevice('B');
  await signIn('Laptop B');
  await vault.unlockWithRecoveryCode(setup.recoveryCode, { merge: false });
  settings.updateCloudBackupState({ enabled: true });
  switchDevice('A');
  return setup.recoveryCode;
}

test('turning it on: what\'s missing is named; then the first device uploads everything', async () => {
  put('dogs', dog('d1'));
  await signIn('Phone A');
  assert.deepEqual(await sync.syncReadiness(), ['backup_off', 'vault_off']);
  settings.updateCloudBackupState({ enabled: true });
  assert.deepEqual(await sync.enableSync(), { status: 'not_ready', missing: ['vault_off'] });
  const setup = await vault.startVaultSetup();
  await vault.finishVaultSetup(setup, { confirmation: setup.lastGroup });
  assert.deepEqual(await sync.syncReadiness(), []);
  assert.deepEqual(await sync.enableSync(), { status: 'refused', code: 'pro_required' }, 'Pro is the server\'s to say');
  assert.equal(settings.getCloudSyncState().enabled, false);

  makePro();
  const steps = [];
  const on = await sync.enableSync({ onProgress: (p) => steps.push(p) });
  assert.deepEqual(on, { status: 'on', pulled: 0, keptOurs: 0, pushed: 1 });
  assert.deepEqual(steps.filter((s) => s.phase === 'push').at(-1), { phase: 'push', done: 1, total: 1 });
  const s = settings.getCloudSyncState();
  assert.equal(s.enabled, true);
  assert.equal(s.joining, false);
  assert.equal(s.cursor, 1);
});

test('joining: the newer updated_at wins each record, both sides\' new records meet, nothing is deleted', async () => {
  await beforeSync();
  assert.equal((await sync.enableSync()).status, 'on');
  tables.dogs.rows.delete('d2');
  await sync.syncNow(); // A deletes d2: a tombstone on the server

  switchDevice('B');
  put('dogs', dog('d1', { notes: 'older on B', updated_at: '2025-12-01T00:00:00.000Z' }));
  put('dogs', dog('d2', { notes: 'B still has it' }));
  put('dogs', dog('d3', { notes: 'only on B' }));
  put('kennels', row('k1', { kennel_name: 'Oak Hill Kennels', is_own_kennel: true, updated_at: '2026-03-01T00:00:00.000Z' }));
  const joined = await sync.joinSync();
  assert.equal(joined.status, 'on');
  assert.equal(joined.keptOurs, 1, 'B\'s newer kennel is kept');
  assert.equal(get('dogs', 'd1').notes, 'notes for d1', 'A\'s newer d1 wins');
  assert.equal(get('kennels', 'k1').kennel_name, 'Oak Hill Kennels');
  assert.equal(get('dogs', 'd2').notes, 'B still has it', 'a join deletes nothing');
  assert.equal((await sync.syncNow()).push.status, 'nothing', 'everything B kept is on the server now');

  switchDevice('A');
  await sync.syncNow();
  assert.equal(get('kennels', 'k1').kennel_name, 'Oak Hill Kennels');
  assert.equal(get('dogs', 'd3').notes, 'only on B');
  assert.equal(get('dogs', 'd2').notes, 'B still has it', 'B\'s copy came back as a record of its own');
});

test('an interrupted join resumes as a join, never as a plain pull', async () => {
  await beforeSync();
  await sync.enableSync();
  switchDevice('B');
  put('kennels', row('k1', { kennel_name: 'Newer on B', is_own_kennel: true, updated_at: '2026-03-01T00:00:00.000Z' }));
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/sync/push') && ++calls === 1) throw new TypeError('Failed to fetch');
    return realFetch(url, init);
  };
  try {
    assert.equal((await sync.joinSync()).status, 'offline');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(settings.getCloudSyncState().joining, true);
  assert.equal(sync.syncStatus().joining, true);
  const again = await sync.syncNow();
  assert.equal(again.join.status, 'on');
  assert.equal(get('kennels', 'k1').kennel_name, 'Newer on B');
  switchDevice('A');
  await sync.syncNow();
  assert.equal(get('kennels', 'k1').kennel_name, 'Newer on B');
});

test('turning it off here, then for every device: the others stop and say so', async () => {
  await beforeSync();
  await sync.enableSync();
  switchDevice('B');
  await sync.joinSync();
  assert.deepEqual(await sync.disableSyncHere(), { status: 'off' });
  assert.equal(settings.getCloudSyncState().enabled, false);
  assert.equal(tables.sync_meta.rows.size, 0, 'what it synced is forgotten here');
  assert.equal(tables.dogs.rows.size, 2, 'its records stay');
  assert.equal((await sync.programSyncs()).enabled, true, 'the program still syncs');
  await sync.joinSync();

  assert.deepEqual(await sync.disableSyncEverywhere({}), { status: 'off' });
  assert.equal((await sync.programSyncs()).enabled, false);
  switchDevice('A');
  assert.deepEqual(await sync.pullIfBehind(), { status: 'paused', code: 'sync_off' });
  assert.equal(settings.getCloudSyncState().enabled, false);
  assert.equal(sync.syncStatus().paused, 'sync_off', 'it says why');
});

test('turning the vault off ends sync for every device', async () => {
  await beforeSync();
  await sync.enableSync();
  switchDevice('B');
  await sync.joinSync();
  await vault.disableVault({});
  assert.equal(settings.getCloudSyncState().enabled, false);
  switchDevice('A');
  assert.equal((await sync.pullIfBehind()).code, 'sync_off');
});

test('backups on a syncing program: a caught-up device states its seq; one behind waits; a lapsed one goes by Phase 1', async () => {
  const backup = await import('../shared/data/cloud/cloudBackup.js');
  await beforeSync();
  await sync.enableSync();
  settings.markDataChanged();
  const pushed = await backup.pushIfDirty({ force: true });
  assert.equal(pushed.status, 'pushed');
  assert.equal(env.DB.raw.prepare('SELECT sync_seq FROM snapshots WHERE id = ?').get(pushed.snapshotId).sync_seq, 3, 'the kennel and two dogs');

  put('dogs', dog('d5')); // not pushed to sync yet
  assert.deepEqual(await backup.pushIfDirty({ force: true }), { status: 'skipped', reason: 'sync_behind' });
  await sync.syncNow();
  assert.equal((await backup.pushIfDirty({ force: true })).status, 'pushed');

  switchDevice('B'); // never joined: not syncing here, so the Phase 1 rule; the program syncs, so it's refused
  assert.equal((await backup.pushIfDirty({ force: true })).status, 'conflict');
  switchDevice('A');
  env.DB.raw.prepare('DELETE FROM pro_purchases').run();
  put('dogs', dog('d6'));
  assert.equal((await sync.syncNow()).push.code, 'pro_required');
  const lapsed = await backup.pushIfDirty({ force: true });
  assert.equal(lapsed.status, 'pushed', 'a lapsed license backs up the Phase 1 way (decision 6)');
  assert.equal(env.DB.raw.prepare('SELECT sync_seq FROM snapshots WHERE id = ?').get(lapsed.snapshotId).sync_seq, null);
});
