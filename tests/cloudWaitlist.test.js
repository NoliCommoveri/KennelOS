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
  assert.deepEqual(calls, ['GET /waitlist/inbox', `PUT /waitlist/projection/${k.public_id}`], 'new applications first, then the list');

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
  assert.deepEqual(calls, ['GET /waitlist/inbox'], 'only the look for new applications');

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

test("every family on an online list gets a status link, and New link replaces only theirs", async () => {
  await breeder();
  const k = await putOnline();
  await cw.syncWaitlistOnline();
  const entries = (await waitlistEntryRepo.getByKennel(k.id));
  assert.ok(entries.length > 0);
  assert.ok(entries.every((e) => /^[0-9a-f]{64}$/.test(e.status_token)), 'minted for everyone');
  assert.equal(new Set(entries.map((e) => e.status_token)).size, entries.length, 'all different');
  assert.deepEqual(raw('SELECT token FROM wl_tokens ORDER BY token').map((r) => r.token), entries.map((e) => e.status_token).sort());

  const [first, second] = entries;
  await cw.replaceStatusToken(first.id);
  const after = await waitlistEntryRepo.getById(first.id);
  assert.notEqual(after.status_token, first.status_token);
  const tokens = raw('SELECT token FROM wl_tokens').map((r) => r.token);
  assert.ok(!tokens.includes(first.status_token), 'the old link stops working');
  assert.ok(tokens.includes(after.status_token));
  assert.ok(tokens.includes(second.status_token), "everyone else's link is untouched");
});

test('links point at the family pages: staging serves them itself, production at apply.kennelos.app', async () => {
  const cfg = await import('../shared/data/cloud/cloudConfig.js');
  const { devCloudUrl } = await import('../shared/data/editionConfig.js');
  globalThis.location = { hostname: 'localhost' };
  assert.equal(cfg.familyPagesUrl(), devCloudUrl);
  assert.equal(cfg.statusPageLink('a'.repeat(64)), `${devCloudUrl}/s/${'a'.repeat(64)}`);
  assert.equal(cfg.publicListLink('kos1_x'), `${devCloudUrl}/list/kos1_x`);
  assert.equal(cfg.statusPageLink(null), null);
  assert.equal(cfg.FAMILY_PAGES_URL, 'https://apply.kennelos.app');
});

// An applicant, through the real Worker routes: seal with the published key, send,
// type the emailed code. → the status token they end up with.
async function applyOnline(publicId, { name = 'Nina Applicant', email = 'nina@example.com', answers = {}, prefs = {} } = {}) {
  const { seal } = await import('../cloud/public/family/seal.js');
  const call = async (path, init) => worker.fetch(new Request(`https://api.example${path}`, {
    ...init, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.20', ...(init?.headers || {}) },
  }), env);
  const formRes = await call(`/f/form/${publicId}`, { method: 'GET' });
  assert.equal(formRes.status, 200);
  const { form } = await formRes.json();
  const sealed = await seal(form.public_key, form.key_id, { answers: { name, email, ...answers }, prefs });
  const res = await call(`/f/apply/${publicId}`, { method: 'POST', body: JSON.stringify({ key_id: form.key_id, sealed, name, email }) });
  assert.equal(res.status, 200);
  const code = /(\d{6})/.exec(env.DB.raw.prepare("SELECT subject FROM wl_messages WHERE kind = 'application_code' ORDER BY rowid DESC LIMIT 1").get().subject)[1];
  const v = await call('/f/verify', { method: 'POST', body: JSON.stringify({ public_id: publicId, code }) });
  assert.equal(v.status, 200);
  return (await v.json()).status_token;
}

test('taking applications online: the form is published with its key, and a confirmed application becomes an applied family', async () => {
  await breeder();
  const k0 = await putOnline();
  await kennelRepo.update(k0.id, { waitlist_config: { ...k0.waitlist_config, online_form: true } });
  await cw.syncWaitlistOnline();
  const k = await thornfield();
  assert.equal(k.waitlist_form_keys.length, 1, 'a form key was made on this device');
  const published = JSON.parse(raw('SELECT body FROM wl_projection')[0].body);
  assert.equal(published.kennel.form.key_id, k.waitlist_form_keys[0].id);
  assert.equal(published.kennel.form.public_key, k.waitlist_form_keys[0].public_key);
  assert.equal(JSON.stringify(published).includes('"d"'), false, 'the private half never leaves the device');
  assert.ok(published.kennel.form.questions.some((q) => q.key === 'ready_timing'));

  const token = await applyOnline(k.public_id, {
    answers: { phone: '555-0142', about: 'Two kids, big yard' },
    prefs: { pref_sex: 'female', pref_breed: 'Boston Terrier', ready_timing: 'asap' }
  });
  const result = await cw.syncWaitlistOnline();
  assert.equal(result.inbox.taken, 1);
  const entry = (await waitlistEntryRepo.getByKennel(k.id)).find((e) => e.application?.email === 'nina@example.com');
  assert.ok(entry, 'the family is on her Waitlist page as a new application');
  assert.equal(entry.status, 'applied');
  assert.equal(entry.source, 'online_form');
  assert.equal(entry.status_token, token, 'the link the applicant already has keeps working');
  assert.equal(entry.application.phone, '555-0142');
  assert.equal(entry.application.about, 'Two kids, big yard');
  assert.equal(entry.pref_sex, 'female');
  assert.equal(entry.ready_timing, 'asap');
  assert.deepEqual(raw('SELECT acked_at FROM wl_inbox').map((r) => Boolean(r.acked_at)), [true]);
  const after = JSON.parse(raw('SELECT body FROM wl_projection')[0].body);
  assert.equal(after.entries[entry.id].status, 'applied');
  assert.equal(raw('SELECT token FROM wl_tokens WHERE entry_id = ?', entry.id)[0].token, token);

  assert.equal((await cw.syncWaitlistOnline()).inbox.taken, 0, 'taken in once');
});

test('a reset phone fetches what the server still holds and fills in answers a backup without private backup lost', async () => {
  await breeder();
  const k0 = await putOnline();
  await kennelRepo.update(k0.id, { waitlist_config: { ...k0.waitlist_config, online_form: true } });
  await cw.syncWaitlistOnline();
  const k = await thornfield();
  await applyOnline(k.public_id, { name: 'Omar Reset', email: 'omar@example.com', answers: { about: 'Kept safe' } });
  await cw.syncWaitlistOnline();
  const entry = (await waitlistEntryRepo.getByKennel(k.id)).find((e) => e.application?.email === 'omar@example.com');
  // A restore from cloud backup alone brings back only name and email.
  await waitlistEntryRepo.update(entry.id, { application: { name: 'Omar Reset', email: 'omar@example.com' } });
  settings.updateWaitlistOnlineState({ inboxFetchedAll: false }); // as on a fresh device
  const res = await cw.syncWaitlistOnline();
  assert.equal(res.inbox.filled, 1);
  assert.equal((await waitlistEntryRepo.getById(entry.id)).application.about, 'Kept safe');
});

test('rotating the form key: the new key is published, old applications still open', async () => {
  await breeder();
  const k0 = await putOnline();
  await kennelRepo.update(k0.id, { waitlist_config: { ...k0.waitlist_config, online_form: true } });
  await cw.syncWaitlistOnline();
  const before = await thornfield();
  await cw.rotateFormKey(before.id);
  const after = await thornfield();
  assert.equal(after.waitlist_form_keys.length, 2);
  assert.ok(after.waitlist_form_keys[0].retired_at);
  const published = JSON.parse(raw('SELECT body FROM wl_projection')[0].body);
  assert.equal(published.kennel.form.key_id, after.waitlist_form_keys[1].id);
});
