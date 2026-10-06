// cloudClient.test.js — Cloud Phase 1 plan §9 step 4: the client cloud modules
// (data/cloud/cloudConfig, cloudApi, cloudAuth, cloudBackup) driven END TO END
// against the real Worker code (cloud/src), in-process: the cloud test harness
// gives a migrated node:sqlite D1 and an in-memory R2, and globalThis.fetch is
// routed to worker.fetch. Staging's DEV_OUTBOX holds the sign-in codes.
//
// "Devices" are simulated by swapping localStorage and the in-memory tables.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { makeEnv, lastCode } from '../cloud/tests/helpers/env.js';
import { worker } from '../cloud/tests/helpers/worker.js';

let tables;
let env;
let cb; let auth; let api; let config; let settings; let appReset;
const calls = [];

// The browser sets Content-Length itself for a Blob/string body; Node's Request
// doesn't, and the Worker requires it, so the stand-in adds it.
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
  config = await import('../shared/data/cloud/cloudConfig.js');
  api = await import('../shared/data/cloud/cloudApi.js');
  auth = await import('../shared/data/cloud/cloudAuth.js');
  cb = await import('../shared/data/cloud/cloudBackup.js');
  settings = await import('../shared/data/settings.js');
  appReset = await import('../shared/data/appReset.js');
});

beforeEach(async () => {
  env = await makeEnv();
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
  calls.length = 0;
  globalThis.fetch = workerFetch;
  globalThis.location = { hostname: 'localhost' };
});

// --- helpers -----------------------------------------------------------------
const T0 = '2026-01-01T00:00:00.000Z';
const put = (table, row) => tables[table].rows.set(row.id, structuredClone(row));
const row = (id, extra = {}) => ({ id, is_archived: false, created_at: T0, updated_at: T0, ...extra });

function putDog(id, extra = {}) {
  put('dogs', row(id, { call_name: id, sex: 'female', breed: 'Boxer', status: 'active_breeding', ownership_type: 'owned', kennel_id: 'k1', notes: `notes for ${id}`, ...extra }));
}

function putProgram(nDogs = 3) {
  put('kennels', row('k1', { kennel_name: 'Oak Hill', is_own_kennel: true }));
  put('contacts', row('c1', { name: 'Pat', email: 'pat@example.com', phone: '555' }));
  for (let i = 1; i <= nDogs; i++) putDog(`d${i}`);
  settings.markDataChanged();
}

// Save this device (localStorage + tables) and load another one.
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

// --- cloudConfig / no server ----------------------------------------------------

test('no server (not localhost, cloudUrl null): nothing is available and nothing is fetched', async () => {
  globalThis.location = { hostname: 'pro.kennelos.app' };
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; throw new Error('no'); };
  assert.equal(config.isCloudAvailable(), false);
  assert.equal(config.cloudBaseUrl(), null);
  settings.updateCloudBackupState({ enabled: true });
  settings.setCloudSession({ token: 'x'.repeat(64), email: 'a@b.co', programId: 'p', deviceId: 'd' });
  settings.markDataChanged();
  assert.deepEqual(await cb.pushIfDirty(), { status: 'skipped', reason: 'unavailable' });
  await assert.rejects(auth.startSignIn('a@b.co'), api.CloudUnavailableError);
  const stop = cb.startBackupScheduler({ win: new EventTarget() });
  stop();
  assert.equal(fetched, 0);
});

test('localhost uses the staging override, without a trailing slash', () => {
  assert.equal(config.cloudBaseUrl(), 'https://kennelos-api-staging.admin-kennelos.workers.dev');
});

// --- cloudAuth ------------------------------------------------------------------

test('sign in by code: the session is stored, the device keeps its id across sign-ins', async () => {
  const first = await signIn();
  assert.match(first.token, /^[0-9a-f]{64}$/);
  assert.equal(first.email, 'breeder@example.com');
  const deviceId = settings.getCloudDeviceId();
  assert.equal(first.deviceId, deviceId);

  const again = await signIn();
  assert.equal(again.deviceId, deviceId, 'same device, same id');
  assert.equal(again.programId, first.programId);
  assert.deepEqual(auth.currentAccount(), { email: 'breeder@example.com', programId: first.programId, deviceId, signedIn: true });
});

test('a wrong code is a CloudRequestError with the server code', async () => {
  await auth.startSignIn('a@b.co');
  const code = lastCode(env);
  const wrong = code === '000000' ? '111111' : '000000';
  await assert.rejects(auth.verifySignIn('a@b.co', wrong), (e) => e instanceof api.CloudRequestError && e.code === 'invalid_code');
  await assert.rejects(auth.startSignIn('not-an-email'), (e) => e.code === 'bad_email');
});

test('sign out revokes the token server-side and forgets the session', async () => {
  const s = await signIn();
  await auth.signOut();
  assert.equal(auth.currentAccount(), null);
  await assert.rejects(api.getProgram(s.token), api.CloudAuthError);
});

// --- pushing ----------------------------------------------------------------------

test('turn on: the first backup runs at once, and the cloud copy has no private field', async () => {
  putProgram();
  await signIn();
  const r = await cb.enableBackup();
  assert.equal(r.status, 'pushed');
  assert.equal(r.counts.dogs, 3);
  assert.equal(settings.getCloudDirtyAt(), null, 'clean after a push');

  const list = await cb.listSnapshots();
  assert.equal(list.length, 1);
  assert.equal(list[0].deviceLabel, 'Phone A');
  const envelope = await cb.downloadSnapshot(list[0].id);
  assert.equal(envelope.collections.dogs.length, 3);
  const json = JSON.stringify(envelope);
  for (const leaked of ['notes for', 'pat@example.com', '"phone"']) assert.ok(!json.includes(leaked), leaked);

  const status = cb.getBackupStatus();
  assert.equal(status.enabled, true);
  assert.ok(status.lastPushedAt);
  assert.equal(status.lastError, null);
});

test('pushes only when dirty; a change to private data only is "unchanged" and sends nothing', async () => {
  putProgram();
  await signIn();
  await cb.enableBackup();
  assert.deepEqual(await cb.pushIfDirty(), { status: 'skipped', reason: 'clean' });

  calls.length = 0;
  tables.dogs.rows.get('d1').notes = 'a new private note';
  settings.markDataChanged();
  assert.equal((await cb.pushIfDirty()).status, 'unchanged');
  assert.deepEqual(calls, [], 'no request at all');
  assert.equal(settings.getCloudDirtyAt(), null);

  putDog('d4');
  settings.markDataChanged();
  const r = await cb.pushIfDirty();
  assert.equal(r.status, 'pushed');
  assert.equal(r.counts.dogs, 4);
  assert.equal((await cb.listSnapshots()).length, 2);
});

test('files go up once, before the snapshot that references them', async () => {
  putProgram();
  put('files', { id: 'f1', blob: new Blob(['%PDF hips'], { type: 'application/pdf' }), mime: 'application/pdf', filename: 'ofa.pdf', size: 9, thumbnail: '', created_at: T0 });
  put('documents', row('doc1', { kennel_id: 'k1', dog_id: 'd1', doc_type: 'health_test', file_id: 'f1', title: 'OFA' }));
  await signIn();
  calls.length = 0;
  await cb.enableBackup();
  const firstPut = calls.findIndex((c) => c.startsWith('PUT /files/'));
  const describe = calls.indexOf('POST /snapshots');
  assert.ok(firstPut !== -1 && firstPut < describe, calls.join(' | '));

  calls.length = 0;
  putDog('d9');
  settings.markDataChanged();
  assert.equal((await cb.pushIfDirty()).status, 'pushed');
  assert.ok(calls.some((c) => c.startsWith('HEAD /files/')));
  assert.ok(!calls.some((c) => c.startsWith('PUT /files/')), 'already there: not uploaded again');
});

test('offline and maintenance are quiet: status offline, the change stays dirty', async () => {
  putProgram();
  await signIn();
  settings.updateCloudBackupState({ enabled: true });
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal((await cb.pushIfDirty()).status, 'offline');
  assert.ok(settings.getCloudDirtyAt());
  assert.equal(cb.getBackupStatus().lastError.code, 'offline');
  assert.equal(cb.getBackupStatus().paused, false, 'offline never pauses the scheduler');

  globalThis.fetch = async () => new Response(JSON.stringify({ maintenance: true }), { status: 503 });
  assert.equal((await cb.pushIfDirty()).status, 'offline');

  globalThis.fetch = workerFetch;
  assert.equal((await cb.pushIfDirty()).status, 'pushed');
});

test('an expired session: status auth, the token is dropped, automatic pushes pause', async () => {
  putProgram();
  await signIn();
  await cb.enableBackup();
  settings.setCloudSession({ ...settings.getCloudSession(), token: 'f'.repeat(64) }); // revoked/unknown
  putDog('d5');
  settings.markDataChanged();
  assert.equal((await cb.pushIfDirty()).status, 'auth');
  assert.equal(auth.currentAccount().signedIn, false);
  assert.deepEqual(await cb.pushIfDirty(), { status: 'skipped', reason: 'signed-out' });
});

// --- shrink guard ---------------------------------------------------------------

test('shrink guard: a half-empty device does not overwrite a good backup unless the user says so', async () => {
  putProgram(12);
  await signIn();
  await cb.enableBackup();
  for (let i = 1; i <= 10; i++) tables.dogs.rows.delete(`d${i}`);
  settings.markDataChanged();
  const r = await cb.pushIfDirty();
  assert.equal(r.status, 'shrink');
  assert.deepEqual(r.shrink.dogs, { previous: 12, next: 2 });
  assert.equal(cb.getBackupStatus().paused, true);
  assert.deepEqual(await cb.pushIfDirty(), { status: 'skipped', reason: 'paused' });
  assert.equal((await cb.pushIfDirty({ force: true, allowShrink: true })).status, 'pushed');
  assert.equal(cb.getBackupStatus().paused, false);
});

// --- one backup device ------------------------------------------------------------

test('a second device meets a 409, restores (keeping its own private data), then takes over', async () => {
  putProgram();
  await signIn('breeder@example.com', 'Phone A');
  await cb.enableBackup();

  switchDevice('B');
  putDog('dB', { notes: 'only on B' }); // B has something of its own
  await signIn('breeder@example.com', 'Laptop B');
  const r = await cb.enableBackup();
  assert.equal(r.status, 'conflict');
  assert.equal(r.backingDevice.label, 'Phone A');
  assert.equal(r.ownDevice, false);
  assert.equal(cb.getBackupStatus().paused, true);

  const { restored, push } = await cb.restoreLatestAndTakeOver();
  assert.equal(restored.summary.dogs.inserted, 3);
  assert.ok(!('notes' in tables.dogs.rows.get('d1')), 'private fields never came from the cloud');
  assert.equal(tables.dogs.rows.get('dB').notes, 'only on B');
  assert.equal(push.status, 'pushed');
  assert.equal(push.counts.dogs, 4);

  // A is no longer the backing device: its next push is a conflict naming B.
  switchDevice('A');
  putDog('dA2');
  settings.markDataChanged();
  const back = await cb.pushIfDirty();
  assert.equal(back.status, 'conflict');
  assert.equal(back.backingDevice.label, 'Laptop B');

  // Choice 2 on A: replace the cloud copy with A's records.
  const replaced = await cb.replaceCloudWithThisDevice();
  assert.equal(replaced.status, 'pushed');
  assert.equal(replaced.counts.dogs, 4); // d1–d3 + dA2
  assert.equal((await cb.getProgramStatus()).backingDevice.label, 'Phone A');
});

test('Reset App turns backup off; turning it back on goes through the restore-or-replace choice', async () => {
  putProgram();
  await signIn();
  await cb.enableBackup();
  appReset.stopCloudBackupAfterReset();
  for (const t of Object.values(tables)) t.rows.clear(); // what resetApp does to the data
  assert.equal(cb.getBackupStatus().enabled, false);
  assert.equal(auth.currentAccount().signedIn, true, 'the sign-in is kept');

  const r = await cb.enableBackup();
  assert.equal(r.status, 'conflict', 'never an empty program pushed on a matching base');
  assert.equal(r.ownDevice, true);
  const { restored } = await cb.restoreLatestAndTakeOver();
  assert.equal(restored.summary.dogs.inserted, 3);
});

// --- restore as of… ----------------------------------------------------------------

test('restore as of an earlier snapshot rolls cloud fields back and keeps private ones', async () => {
  putProgram();
  await signIn();
  await cb.enableBackup();
  const [older] = await cb.listSnapshots();

  const d1 = tables.dogs.rows.get('d1');
  d1.status = 'retired_breeding';
  d1.updated_at = '2026-05-01T00:00:00.000Z';
  d1.notes = 'newer private note';
  settings.markDataChanged();
  assert.equal((await cb.pushIfDirty()).status, 'pushed');

  const envelope = await cb.downloadSnapshot(older.id);
  const preview = await cb.previewRestore(envelope, { overwrite: true });
  assert.equal(preview.summary.dogs.updated, 1);
  await cb.restoreSnapshot(envelope, { overwrite: true });
  assert.equal(tables.dogs.rows.get('d1').status, 'active_breeding');
  assert.equal(tables.dogs.rows.get('d1').notes, 'newer private note');
  assert.ok(settings.getCloudDirtyAt(), 'the rollback is itself backed up next');
});

test('restore fetches files by sha256 and reports progress', async () => {
  putProgram();
  put('files', { id: 'f1', blob: new Blob(['%PDF'], { type: 'application/pdf' }), mime: 'application/pdf', filename: 'p.pdf', size: 4, thumbnail: '', created_at: T0 });
  put('documents', row('doc1', { kennel_id: 'k1', dog_id: 'd1', doc_type: 'pedigree', file_id: 'f1' }));
  await signIn();
  await cb.enableBackup();
  const [snap] = await cb.listSnapshots();

  switchDevice('C');
  await signIn('breeder@example.com', 'Tablet C');
  const progress = [];
  const r = await cb.restoreSnapshot(await cb.downloadSnapshot(snap.id), { onProgress: (d, t) => progress.push([d, t]) });
  assert.deepEqual(r.missingFiles, []);
  assert.equal(await tables.files.rows.get('f1').blob.text(), '%PDF');
  assert.deepEqual(progress, [[1, 1]]);
});

// --- leaving -----------------------------------------------------------------------

test('delete my cloud data: everything server-side goes, local data stays, signed out', async () => {
  putProgram();
  await signIn();
  await cb.enableBackup();
  await cb.deleteCloudData();
  assert.equal(auth.currentAccount(), null);
  assert.equal(tables.dogs.rows.size, 3);
  assert.equal(env.FILES.store.size, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('turn off: no pushes, the cloud copy stays', async () => {
  putProgram();
  await signIn();
  await cb.enableBackup();
  cb.disableBackup();
  putDog('d7');
  settings.markDataChanged();
  assert.deepEqual(await cb.pushIfDirty(), { status: 'skipped', reason: 'off' });
  assert.equal((await cb.listSnapshots()).length, 1);
});

// --- scheduler ----------------------------------------------------------------------

test('scheduler timing: five minutes from the first unpushed change, never sooner than five after the last attempt', () => {
  const now = Date.parse('2026-10-06T10:00:00.000Z');
  const min = 60 * 1000;
  assert.equal(cb.nextPushDelay({ now, dirtySince: null }), null);
  assert.equal(cb.nextPushDelay({ now, dirtySince: '2026-10-06T10:00:00.000Z' }), 5 * min);
  assert.equal(cb.nextPushDelay({ now, dirtySince: '2026-10-06T09:58:00.000Z' }), 3 * min);
  assert.equal(cb.nextPushDelay({ now, dirtySince: '2026-10-06T09:00:00.000Z' }), 0);
  assert.equal(cb.nextPushDelay({ now, dirtySince: '2026-10-06T09:00:00.000Z', lastAttemptAt: '2026-10-06T09:59:00.000Z' }), 4 * min);
});

test('dirty-since: later changes keep the first time; a change mid-push moves it to that change', () => {
  settings.markDataChanged('2026-10-06T10:00:00.000Z');
  settings.markDataChanged('2026-10-06T10:03:00.000Z');
  assert.equal(settings.getCloudDirtySince(), '2026-10-06T10:00:00.000Z');
  settings.clearCloudDirty('2026-10-06T10:00:00.000Z'); // pushed an older value
  assert.equal(settings.getCloudDirtySince(), '2026-10-06T10:03:00.000Z');
  settings.clearCloudDirty('2026-10-06T10:03:00.000Z');
  assert.equal(settings.getCloudDirtySince(), null);
});

test('scheduler: the first page of a session pushes at once when dirty', async () => {
  putProgram();
  await signIn();
  await cb.enableBackup();
  putDog('d8');
  settings.markDataChanged();
  settings.updateCloudBackupState({ lastAttemptAt: '2000-01-01T00:00:00.000Z' });

  const win = new EventTarget();
  const store = new Map();
  win.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  win.document = new EventTarget();
  const stop = cb.startBackupScheduler({ win });
  await new Promise((r) => setTimeout(r, 50));
  for (let i = 0; i < 20 && settings.getCloudDirtyAt(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(settings.getCloudDirtyAt(), null, 'cold start pushed');
  assert.equal((await cb.listSnapshots()).length, 2);
  stop();
});
