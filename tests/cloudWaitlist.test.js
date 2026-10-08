// cloudWaitlist.test.js — Waitlist W2 Plan step 2: publishing her waitlist
// online (data/cloud/cloudWaitlist + its cloudApi calls) end to end against the
// real Worker code in-process, as cloudClient.test.js does, with the real
// Thornfield seed in the in-memory database.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { makeEnv, lastCode } from '../cloud/tests/helpers/env.js';
import { worker } from '../cloud/tests/helpers/worker.js';

let env;
let auth; let api; let cw; let settings; let kennelRepo; let waitlistEntryRepo;
const calls = [];

async function workerFetch(url, init = {}) {
  const headers = { ...(init.headers || {}), origin: 'http://localhost:8000' };
  if (typeof init.body === 'string') headers['content-length'] = String(new TextEncoder().encode(init.body).length);
  calls.push(`${init.method || 'GET'} ${new URL(url).pathname}`);
  return worker.fetch(new Request(url, { method: init.method, headers, body: init.body, signal: init.signal }), env);
}

const raw = (sql, ...args) => env.DB.raw.prepare(sql).all(...args);

// A signed-in Pro breeder whose device backs up.
async function breeder({ pro = true, backing = true, backup = true, email = 'breeder@example.com' } = {}) {
  await auth.startSignIn(email);
  const account = await auth.verifySignIn(email, lastCode(env), { deviceLabel: 'Phone' });
  if (pro) {
    const { email_hash: eh } = env.DB.raw.prepare('SELECT email_hash FROM users').get();
    env.DB.raw.prepare(`INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
      VALUES ('order:1', ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`).run(eh, new Date().toISOString(), new Date().toISOString());
  }
  if (backing) await api.takeOverBacking(auth.sessionToken());
  if (backup) settings.updateCloudBackupState({ enabled: true });
  calls.length = 0;
  return account;
}

async function thornfield() {
  return (await kennelRepo.getAll()).find((k) => k.kennel_name.startsWith('Thornfield'));
}

async function putOnline(on = true) {
  const k = await thornfield();
  return kennelRepo.update(k.id, { waitlist_config: { ...(k.waitlist_config || {}), online: on }, time_zone: 'America/Chicago' });
}

before(async () => {
  await installMemoryDb();
  globalThis.location = { hostname: 'localhost' }; // → editionConfig.devCloudUrl (staging): offered
  globalThis.fetch = workerFetch;
  api = await import('../shared/data/cloud/cloudApi.js');
  auth = await import('../shared/data/cloud/cloudAuth.js');
  cw = await import('../shared/data/cloud/cloudWaitlist.js');
  settings = await import('../shared/data/settings.js');
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js'));
  const { seedSampleData } = await import('../shared/data/sampleData.js');
  await seedSampleData();
});

beforeEach(async () => {
  env = await makeEnv();
  localStorage.clear();
  calls.length = 0;
  globalThis.location = { hostname: 'localhost' };
  await putOnline(false);
});

test('nothing online: no request at all', async () => {
  await breeder();
  assert.deepEqual(await cw.syncWaitlistOnline(), { status: 'skipped', reason: 'nothing-online' });
  assert.deepEqual(calls, []);
});

test("not offered (a deployed origin, released switch off): no request, whatever's online", async () => {
  await breeder();
  await putOnline();
  globalThis.location = { hostname: 'pro.kennelos.app' };
  assert.deepEqual(await cw.syncWaitlistOnline(), { status: 'skipped', reason: 'unavailable' });
  assert.deepEqual(calls, []);
});

test('online publishes the projection once, then only after a change', async () => {
  await breeder();
  const k = await putOnline();
  const first = await cw.syncWaitlistOnline();
  assert.equal(first.status, 'ok');
  assert.deepEqual(first.published, [k.id]);
  assert.deepEqual(calls, [`PUT /waitlist/projection/${k.public_id}`]);

  const [row] = raw('SELECT public_id, version, body FROM wl_projection');
  assert.equal(row.public_id, k.public_id);
  assert.equal(row.version, 1);
  const body = JSON.parse(row.body);
  assert.equal(body.kennel.name, k.kennel_name);
  assert.equal(body.kennel.time_zone, 'America/Chicago');
  assert.ok(Object.keys(body.entries).length > 0);
  assert.equal(JSON.stringify(body).includes('"phone"'), false);

  calls.length = 0;
  assert.equal((await cw.syncWaitlistOnline()).published.length, 0, 'unchanged: nothing sent');
  assert.deepEqual(calls, []);

  const e = (await waitlistEntryRepo.getAll()).find((x) => x.kennel_id === k.id && x.status === 'active');
  await waitlistEntryRepo.update(e.id, { paused_until: '2099-01-01' });
  await cw.syncWaitlistOnline();
  assert.equal(raw('SELECT version FROM wl_projection')[0].version, 2);
  assert.equal(JSON.parse(raw('SELECT body FROM wl_projection')[0].body).entries[e.id].paused_until, '2099-01-01');

  const st = cw.waitlistOnlineStatus(k);
  assert.equal(st.online, true);
  assert.equal(st.published.version, 2);
  assert.equal(st.lastError, null);
});

test('taking it offline unpublishes it', async () => {
  await breeder();
  const k = await putOnline();
  await cw.syncWaitlistOnline();
  await putOnline(false);
  const res = await cw.syncWaitlistOnline();
  assert.deepEqual(res.unpublished, [k.id]);
  assert.deepEqual(raw('SELECT * FROM wl_projection'), []);
  assert.deepEqual(settings.getWaitlistOnlineState().kennels, {});
});

test("what stops publishing is recorded, and the request isn't made when it can't work", async () => {
  await putOnline();
  assert.equal((await cw.syncWaitlistOnline()).reason, 'signed-out');
  assert.deepEqual(calls, []);

  await breeder({ backup: false });
  assert.equal((await cw.syncWaitlistOnline()).reason, 'backup-off');
  assert.deepEqual(calls, []);
  assert.equal(settings.getWaitlistOnlineState().lastError.code, 'backup-off');
});

test('another device backs up: not this one to publish', async () => {
  await breeder({ backing: false });
  env.DB.raw.prepare("UPDATE programs SET backing_device_id = 'someone-else'").run();
  await putOnline();
  const res = await cw.syncWaitlistOnline();
  assert.deepEqual([res.status, res.reason], ['error', 'not-backing']);
  assert.equal(cw.waitlistOnlineStatus(await thornfield()).lastError.code, 'not-backing');
});

test('an account the server does not know is Pro: told so', async () => {
  await breeder({ pro: false });
  await putOnline();
  const res = await cw.syncWaitlistOnline();
  assert.deepEqual([res.status, res.reason], ['error', 'pro-required']);
  assert.deepEqual(raw('SELECT * FROM wl_projection'), []);
});
