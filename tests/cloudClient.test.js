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
let cb; let auth; let api; let config; let settings; let appReset; let dv; let edition;
const calls = [];

// Lemon Squeezy's License API, stubbed: every deactivate succeeds and is recorded.
const lemon = [];

// The browser sets Content-Length itself for a Blob/string body; Node's Request
// doesn't, and the Worker requires it, so the stand-in adds it.
async function workerFetch(url, init = {}) {
  if (String(url).startsWith('https://api.lemonsqueezy.com/')) {
    lemon.push({ path: new URL(url).pathname, params: Object.fromEntries(new URLSearchParams(String(init.body))) });
    return new Response(JSON.stringify({ deactivated: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
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
  dv = await import('../shared/data/cloud/cloudDevices.js');
  edition = await import('../shared/data/editionConfig.js');
});

beforeEach(async () => {
  env = await makeEnv();
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
  calls.length = 0;
  lemon.length = 0;
  devices.clear();
  currentDevice = 'A';
  edition.editionFlags.licenseGate = false;
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

// --- the test-server switch (?cloud=staging / ?cloud=off) ------------------------

const STAGING = 'https://kennelos-api-staging.admin-kennelos.workers.dev';
function deployedPage(search) {
  const href = `https://pro.kennelos.app/pages/today.html${search}#top`;
  const loc = { hostname: 'pro.kennelos.app', href, search };
  const replaced = [];
  const hist = { state: null, replaceState: (_s, _t, url) => replaced.push(url) };
  globalThis.location = loc;
  return { loc, hist, replaced };
}

test('test switch: ?cloud=staging on a deployed origin points this browser at staging', () => {
  const { loc, hist, replaced } = deployedPage('?cloud=staging&x=1');
  settings.setCloudSession({ token: 'x'.repeat(64), email: 'a@b.co', programId: 'p', deviceId: 'd' });
  settings.updateCloudBackupState({ enabled: true, lastSnapshotId: 's1' });
  assert.equal(config.isCloudAvailable(), false, 'off until the switch is visited');
  assert.equal(config.applyCloudTestSwitch(loc, hist), true);
  assert.equal(config.cloudBaseUrl(), STAGING);
  assert.equal(config.isUsingTestServer(), true);
  assert.deepEqual(replaced, ['/pages/today.html?x=1#top'], 'the parameter leaves the address bar');
  assert.equal(settings.getCloudSession(), null, 'a sign-in belongs to one server');
  assert.equal(settings.getCloudBackupState().enabled, false);
  assert.equal(settings.getCloudBackupState().lastSnapshotId, null);
});

test('private backup is offered only against staging until it is released', () => {
  assert.equal(config.VAULT_RELEASED, false, 'releasing it is a deliberate one-line change: update this test with it');
  assert.equal(config.isVaultOffered(), true, 'localhost talks to staging');
  deployedPage('');
  assert.equal(config.isVaultOffered(), false, 'a deployed origin without the switch');
  const { loc, hist } = deployedPage('?cloud=staging');
  config.applyCloudTestSwitch(loc, hist);
  assert.equal(config.isVaultOffered(), true, 'the test-server switch');
});

test('test switch: visiting it again changes nothing; ?cloud=off turns it off', () => {
  let page = deployedPage('?cloud=staging');
  config.applyCloudTestSwitch(page.loc, page.hist);
  settings.setCloudSession({ token: 'y'.repeat(64), email: 'a@b.co', programId: 'p', deviceId: 'd' });
  page = deployedPage('?cloud=staging');
  assert.equal(config.applyCloudTestSwitch(page.loc, page.hist), false);
  assert.ok(settings.getCloudSession(), 'a repeat visit keeps the staging sign-in');
  page = deployedPage('?cloud=off');
  assert.equal(config.applyCloudTestSwitch(page.loc, page.hist), true);
  assert.equal(config.isCloudAvailable(), false);
  assert.equal(config.isUsingTestServer(), false);
  assert.equal(settings.getCloudSession(), null);
});

test('test switch: other values and pages without it do nothing; localhost is never "test server"', () => {
  for (const search of ['', '?cloud=prod', '?other=staging']) {
    const page = deployedPage(search);
    assert.equal(config.applyCloudTestSwitch(page.loc, page.hist), false);
    assert.deepEqual(page.replaced, []);
    assert.equal(config.isCloudAvailable(), false);
  }
  globalThis.location = { hostname: 'localhost' };
  settings.setCloudTestServer(true);
  assert.equal(config.isUsingTestServer(), false, 'no banner in local dev');
  assert.equal(config.cloudBaseUrl(), STAGING);
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
  assert.deepEqual(auth.currentAccount(), { email: 'breeder@example.com', programId: first.programId, deviceId, deviceLabel: 'Phone A', signedIn: true });
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

// --- Lite → Pro (Editions Plan, "Converting Lite → Pro") ------------------------------

test('each push names its edition, and a 409 passes the backing device\'s edition on', async () => {
  putProgram();
  await signIn('breeder@example.com', 'Phone A');
  await cb.enableBackup();
  assert.equal((await cb.listSnapshots())[0].edition, 'pro', 'the shared config is the Pro default');

  switchDevice('B');
  await signIn('breeder@example.com', 'Laptop B');
  const r = await cb.enableBackup();
  assert.equal(r.status, 'conflict');
  assert.equal(r.backingDevice.edition, 'pro');
  assert.equal(r.movedToEdition, null, 'Pro meeting Pro is an ordinary second device');
});

test('movedToEdition: only a Lite device whose program is backed up from Pro', () => {
  const pro = { id: 'x', edition: 'pro' };
  assert.equal(cb.movedToEdition(pro, false, 'lite'), 'pro');
  assert.equal(cb.movedToEdition(pro, true, 'lite'), null, 'this device before a reset is not an upgrade');
  assert.equal(cb.movedToEdition({ id: 'x', edition: 'lite' }, false, 'lite'), null);
  assert.equal(cb.movedToEdition({ id: 'x', edition: null }, false, 'lite'), null, 'a snapshot from before editions were recorded');
  assert.equal(cb.movedToEdition(pro, false, 'pro'), null);
  assert.equal(cb.movedToEdition(null, false, 'lite'), null);
});

test('turning off after a move to Pro is remembered until backup is turned back on', async () => {
  putProgram();
  await signIn();
  await cb.enableBackup();
  cb.disableBackup({ movedToEdition: 'pro' });
  assert.equal(cb.getBackupStatus().movedToEdition, 'pro');
  assert.equal(cb.getBackupStatus().enabled, false);
  await cb.enableBackup();
  assert.equal(cb.getBackupStatus().movedToEdition, null);
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

// --- A lost device: erase it, free its Pro license (plan §2.5) ---------------------

const appKeys = () => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  return keys.filter((k) => k.startsWith('kennelOS.'));
};

async function until(check, what) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  assert.fail(`timed out waiting for ${what}`);
}

// Phone A (signed in, with a program) and Laptop B, both on one account; ends on B.
async function lostPhoneAndLaptop() {
  putProgram();
  await signIn('breeder@example.com', 'Phone A');
  await cb.enableBackup();
  const phoneId = auth.currentAccount().deviceId;
  switchDevice('B');
  await signIn('breeder@example.com', 'Laptop B');
  return phoneId;
}

test('check-in: once per 15 minutes unless forced, and it carries the service notices', async () => {
  await signIn();
  env.DB.raw.prepare("INSERT INTO notices (id, level, message, until, created_at) VALUES ('n1', 'warning', 'Maintenance Sunday', NULL, '2026-01-01')").run();
  calls.length = 0;
  assert.deepEqual((await dv.checkIn()).notices.map((n) => n.message), ['Maintenance Sunday']);
  assert.equal(await dv.checkIn(), null, 'throttled');
  assert.deepEqual(await cb.getServiceNotices().then((n) => n.map((x) => x.message)), ['Maintenance Sunday']);
  assert.deepEqual(calls, ['POST /devices/check-in', 'POST /devices/check-in'], 'notices come from the check-in, not GET /notice');
  assert.ok(settings.getCloudBackupState().lastCheckInAt);
});

test('check-in: nothing without a sign-in or a server', async () => {
  assert.equal(await dv.checkIn({ force: true }), null);
  globalThis.location = { hostname: 'pro.kennelos.app' };
  settings.setCloudSession({ token: 'x'.repeat(64), email: 'a@b.co', programId: 'p', deviceId: 'd' });
  dv.bootDeviceCheck({ win: new EventTarget() });
  assert.equal(await dv.checkIn({ force: true }), null);
  assert.deepEqual(calls, []);
});

test('erase: the lost phone wipes everything at its next check-in, frees its own license and confirms', async () => {
  const phoneId = await lostPhoneAndLaptop();
  const listed = await dv.listDevices();
  assert.deepEqual(listed.map((d) => [d.label, d.thisDevice, d.backing]), [['Laptop B', true, false], ['Phone A', false, true]]);
  await dv.requestErase(phoneId);

  switchDevice('A');
  settings.setProLicense({ key: 'KEY-1', instanceId: 'inst-A', status: 'active' });
  assert.ok(tables.dogs.rows.size > 0);
  assert.deepEqual(await dv.checkIn({ force: true }), { erased: true });
  for (const t of Object.values(tables)) assert.equal(t.rows.size, 0, t.name);
  assert.deepEqual(appKeys(), [], 'no key of this app survives, not even the license or the cloud ids');
  assert.deepEqual(lemon, [{ path: '/v1/licenses/deactivate', params: { license_key: 'KEY-1', instance_id: 'inst-A' } }]);

  switchDevice('B');
  const phone = (await dv.listDevices()).find((d) => d.id === phoneId);
  assert.ok(phone.erase.confirmedAt);
  assert.equal(phone.backing, false);
});

test('erase: any request the lost phone makes erases it, not only the check-in', async () => {
  const phoneId = await lostPhoneAndLaptop();
  await dv.requestErase(phoneId);
  switchDevice('A');
  putDog('d9');
  settings.markDataChanged();
  const result = await cb.pushIfDirty();
  assert.equal(result.status, 'auth');
  await until(() => tables.dogs.rows.size === 0 && appKeys().length === 0, 'the erase');
  switchDevice('B');
  await until(() => env.DB.raw.prepare('SELECT confirmed_at FROM device_erasures').get()?.confirmed_at, 'the ack');
});

test('erase: an ack that could not reach the server is retried later', async () => {
  const phoneId = await lostPhoneAndLaptop();
  await dv.requestErase(phoneId);
  switchDevice('A');
  globalThis.fetch = async (url, init) => (String(url).includes('/devices/erase-ack') ? Promise.reject(new Error('offline')) : workerFetch(url, init));
  await dv.checkIn({ force: true });
  assert.equal(tables.dogs.rows.size, 0);
  assert.deepEqual(appKeys(), ['kennelOS.eraseAck'], 'only the dead token, until the server hears it');
  assert.equal(env.DB.raw.prepare('SELECT confirmed_at FROM device_erasures').get().confirmed_at, null);

  globalThis.fetch = workerFetch;
  assert.equal(await dv.finishEraseAck(), true);
  assert.deepEqual(appKeys(), []);
  assert.ok(env.DB.raw.prepare('SELECT confirmed_at FROM device_erasures').get().confirmed_at);
});

test('erase needs a fresh sign-in: an older one is asked for a code', async () => {
  const phoneId = await lostPhoneAndLaptop();
  env.DB.raw.prepare("UPDATE sessions SET created_at = '2026-01-01T00:00:00.000Z' WHERE device_id = ?").run(auth.currentAccount().deviceId);
  await assert.rejects(dv.requestErase(phoneId), (e) => e instanceof api.CloudRequestError && e.code === 'reauth_required');
  await auth.startSignIn('breeder@example.com');
  await dv.requestErase(phoneId, { email: 'breeder@example.com', code: lastCode(env) });
  assert.ok((await dv.listDevices()).find((d) => d.id === phoneId).erase);
});

test('cancel: a found phone keeps its records and is asked to sign in again', async () => {
  const phoneId = await lostPhoneAndLaptop();
  await dv.requestErase(phoneId);
  await dv.cancelErase(phoneId);
  switchDevice('A');
  assert.equal(await dv.checkIn({ force: true }), null);
  assert.equal(tables.dogs.rows.size, 3);
  assert.equal(auth.currentAccount().signedIn, false);
});

test('free its Pro license: the check-in reports the activation; the key goes to Lemon Squeezy only', async () => {
  edition.editionFlags.licenseGate = true;
  putProgram();
  settings.setProLicense({ key: 'KEY-1', instanceId: 'inst-A', status: 'active' });
  await signIn('breeder@example.com', 'Phone A');
  await dv.checkIn({ force: true });
  const phoneId = auth.currentAccount().deviceId;
  switchDevice('B');
  await signIn('breeder@example.com', 'Laptop B');

  const phone = (await dv.listDevices()).find((d) => d.id === phoneId);
  assert.equal(phone.licenseInstanceId, 'inst-A');
  calls.length = 0;
  assert.equal(await dv.releaseDeviceLicense(phone, ' KEY-1 '), true);
  assert.deepEqual(lemon, [{ path: '/v1/licenses/deactivate', params: { license_key: 'KEY-1', instance_id: 'inst-A' } }]);
  assert.ok(calls.every((c) => !c.includes('KEY')), 'the key never reaches our server');
  assert.equal((await dv.listDevices()).find((d) => d.id === phoneId).licenseInstanceId, null);
});

test('free its Pro license: a refusal from Lemon Squeezy leaves it offered', async () => {
  edition.editionFlags.licenseGate = true;
  settings.setProLicense({ key: 'KEY-1', instanceId: 'inst-A', status: 'active' });
  await signIn('breeder@example.com', 'Phone A');
  await dv.checkIn({ force: true });
  const phoneId = auth.currentAccount().deviceId;
  switchDevice('B');
  await signIn('breeder@example.com', 'Laptop B');
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://api.lemonsqueezy.com/')
    ? new Response(JSON.stringify({ deactivated: false, error: 'license_key not found' }), { status: 404 })
    : workerFetch(url, init));
  const phone = (await dv.listDevices()).find((d) => d.id === phoneId);
  assert.equal(await dv.releaseDeviceLicense(phone, 'WRONG'), false);
  assert.equal((await dv.listDevices()).find((d) => d.id === phoneId).licenseInstanceId, 'inst-A');
});

test('check-in at boot: the first page of a browsing session checks in after a minute; later pages after fifteen', async () => {
  await signIn();
  const fakeWin = () => {
    const win = new EventTarget();
    const store = new Map();
    win.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
    return win;
  };
  const twoMinutesAgo = () => settings.updateCloudBackupState({ lastCheckInAt: new Date(Date.now() - 2 * 60 * 1000).toISOString() });
  const checkIns = () => calls.filter((c) => c === 'POST /devices/check-in').length;
  const settle = () => new Promise((r) => setTimeout(r, 20));

  twoMinutesAgo();
  const win = fakeWin();
  dv.bootDeviceCheck({ win });
  await settle();
  assert.equal(checkIns(), 1, 'first page of the session');

  twoMinutesAgo();
  dv.bootDeviceCheck({ win });
  await settle();
  assert.equal(checkIns(), 1, 'a later page in the same session waits fifteen minutes');

  dv.bootDeviceCheck({ win: fakeWin() });
  await settle();
  assert.equal(checkIns(), 2, 'a new session after two minutes checks in');
});

test('sign out other devices and delete my cloud data need a code when the sign-in is old', async () => {
  putProgram();
  await signIn();
  await cb.enableBackup();
  env.DB.raw.prepare("UPDATE sessions SET created_at = '2026-01-01T00:00:00.000Z'").run();
  const reauthRequired = (e) => e instanceof api.CloudRequestError && e.code === 'reauth_required';

  await assert.rejects(auth.signOutOtherDevices(), reauthRequired);
  await auth.startSignIn('breeder@example.com');
  assert.equal(await auth.signOutOtherDevices({ email: 'breeder@example.com', code: lastCode(env) }), 0);

  await assert.rejects(cb.deleteCloudData(), reauthRequired);
  assert.ok(auth.currentAccount(), 'still signed in after the refusal');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  await auth.startSignIn('breeder@example.com');
  await cb.deleteCloudData({ email: 'breeder@example.com', code: lastCode(env) });
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
  assert.equal(auth.currentAccount(), null);
});
