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
  assert.deepEqual(calls, ['GET /waitlist/inbox', `GET /waitlist/projection/${k.public_id}`, 'GET /waitlist/events', `PUT /waitlist/projection/${k.public_id}`],
    'new applications first, then (from where any earlier device got to) what families did, then the list');

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
  assert.deepEqual(calls, ['GET /waitlist/inbox', 'GET /waitlist/events'], 'only the looks for new applications and family actions');

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

// A family on the list, signed in on their own phone through the real Worker
// routes (See Your Details). → { session, statusToken, call }
async function familySignIn(publicId, email) {
  const call = async (path, body) => worker.fetch(new Request(`https://api.example${path}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.30' },
  }), env);
  assert.equal((await call('/f/code', { public_id: publicId, email })).status, 200);
  const code = /(\d{6})/.exec(env.DB.raw.prepare('SELECT subject FROM wl_messages ORDER BY rowid DESC LIMIT 1').get().subject)[1];
  const v = await (await call('/f/verify', { public_id: publicId, code })).json();
  return { session: v.session, statusToken: v.status_token, call };
}

test('what a family does on their page reaches her device: a pick makes the Sale, a pause waits for her, a message lands on the entry', async () => {
  const { contactRepo } = await import('../shared/data/contactRepo.js');
  const { waitlistOfferRepo } = await import('../shared/data/waitlistOfferRepo.js');
  const { saleRepo } = await import('../shared/data/saleRepo.js');
  const { litterRepo } = await import('../shared/data/litterRepo.js');
  const { dogRepo } = await import('../shared/data/dogRepo.js');
  const actions = await import('../shared/data/waitlistActions.js');
  await breeder();
  const k = await putOnline();

  // A family with an email and an open offer on a litter with a pup for them.
  let offer = (await waitlistOfferRepo.getByKennel(k.id)).find((o) => o.outcome === 'open' && !o.chosen_dog_id);
  if (!offer) {
    for (const l of (await litterRepo.getAll()).filter((x) => x.kennel_id === k.id)) {
      for (const e of (await waitlistEntryRepo.getByKennel(k.id)).filter((x) => x.status === 'active')) {
        try { offer = await actions.offerTo(l.id, e.id); break; } catch { /* not eligible here */ }
      }
      if (offer) break;
    }
  }
  assert.ok(offer, 'the sample data has a family who can be offered a litter');
  const entry = await waitlistEntryRepo.getById(offer.entry_id);
  const email = `family-${entry.id.slice(0, 6)}@example.com`;
  await contactRepo.update(entry.contact_id, { email });
  await cw.syncWaitlistOnline();
  const published = JSON.parse(raw('SELECT body FROM wl_projection')[0].body);
  assert.ok(published.kennel.message_key?.public_key, 'an online list has a key for families\' messages');

  const fam = await familySignIn(k.public_id, email);
  const act = (action, extra = {}) => fam.call('/f/act', { session: fam.session, status_token: fam.statusToken, action, ...extra });
  const dogId = offer.eligible_dog_ids[0];
  assert.equal((await act('pick', { offer_id: offer.id, dog_id: dogId })).status, 200);
  const until = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  assert.equal((await act('pause_request', { until, note: 'Moving house' })).status, 200);
  assert.equal((await act('still_interested')).status, 200);
  const { seal } = await import('../cloud/public/family/seal.js');
  const key = published.kennel.message_key;
  const sealed = await seal(key.public_key, key.key_id, { body: 'Can we visit on Saturday?' });
  assert.equal((await fam.call('/f/message', { session: fam.session, status_token: fam.statusToken, key_id: key.key_id, sealed })).status, 200);
  assert.equal(raw('SELECT COUNT(*) AS n FROM wl_holds')[0].n, 1, 'the server holds the pup until her device catches up');

  const res = await cw.syncWaitlistOnline();
  assert.equal(res.status, 'ok');
  assert.deepEqual(res.events, { applied: 2, noted: 1, skipped: 0 });
  assert.equal(res.inbox.messages, 1);

  const savedOffer = await waitlistOfferRepo.getById(offer.id);
  assert.equal(savedOffer.chosen_dog_id, dogId, 'the pick is recorded');
  const sale = await saleRepo.getById(savedOffer.sale_id);
  assert.equal(sale.status, 'deposit_pending', 'a Sale holds the pup; the deposit stays her tap');
  assert.equal((await dogRepo.getById(dogId)).id, dogId);
  const saved = await waitlistEntryRepo.getById(entry.id);
  assert.equal(saved.paused_until ?? null, entry.paused_until ?? null, 'a pause waits for her approval');
  assert.equal(saved.pause_request.until, until);
  assert.equal(saved.pause_request.note, 'Moving house');
  assert.ok(saved.messages.some((m) => m.kind === 'message' && m.body === 'Can we visit on Saturday?' && !m.read));
  assert.ok(saved.messages.some((m) => m.kind === 'action' && /still interested/.test(m.body)));
  assert.ok(saved.messages.some((m) => m.kind === 'action' && /picked/.test(m.body)));
  assert.equal(raw('SELECT COUNT(*) AS n FROM wl_holds')[0].n, 0, 'the publish told the server, which let go of the hold');
  const after = JSON.parse(raw('SELECT body FROM wl_projection')[0].body);
  assert.equal(after.events_through, settings.getWaitlistOnlineState().eventsCursor);
  assert.equal(after.entries[entry.id].requests.pause.until, until);
  assert.equal(JSON.stringify(after).includes('Moving house'), false, "the family's note stays on her device");
  assert.equal(JSON.stringify(after).includes('Saturday'), false);

  const again = await cw.syncWaitlistOnline();
  assert.deepEqual(again.events, { applied: 0, noted: 0, skipped: 0 }, 'each action is applied once');
  assert.equal((await waitlistEntryRepo.getById(entry.id)).messages.length, saved.messages.length);

  // Today asks her about the pause and shows the message; neither changes anything by itself.
  const { computeNudges } = await import('../shared/data/nudges.js');
  const nudges = await computeNudges();
  const pauseNudge = nudges.find((n) => n.key.startsWith(`waitlist-pause-request:${entry.id}:`));
  assert.ok(pauseNudge, 'a pause request is a Today nudge');
  assert.deepEqual(pauseNudge.actions.map((a) => a.label), ['Approve', 'Decline']);
  assert.match(pauseNudge.detail, /Moving house/);
  const msgNudge = nudges.find((n) => n.key.startsWith(`waitlist-messages:${entry.id}:`));
  assert.match(msgNudge.title, /A message from/);
  assert.match(msgNudge.detail, /Saturday/);
  await msgNudge.actions.find((a) => a.label === 'Mark read').run();
  assert.equal((await waitlistEntryRepo.getById(entry.id)).messages.some((m) => !m.read), false);

  await pauseNudge.actions.find((a) => a.label === 'Approve').run();
  const approved = await waitlistEntryRepo.getById(entry.id);
  assert.equal(approved.paused_until, until);
  assert.equal(approved.pause_request.decided, 'approved');
});

test('a Companion link request (Spec §8.3): a family with a sale asks, her Today asks her, Mark sent shows on their page; their note stays on her device', async () => {
  const { contactRepo } = await import('../shared/data/contactRepo.js');
  const { saleRepo } = await import('../shared/data/saleRepo.js');
  const { dogRepo } = await import('../shared/data/dogRepo.js');
  const actions = await import('../shared/data/waitlistActions.js');
  await breeder();
  const k = await putOnline();

  // A family on the list whose contact has no open sale yet.
  const sales = await saleRepo.getAll({ includeArchived: true });
  const entry = (await waitlistEntryRepo.getByKennel(k.id)).find((e) => e.status === 'active' && e.contact_id
    && !sales.some((x) => x.buyer_contact_id === e.contact_id && saleRepo.isOpenSale(x)));
  assert.ok(entry, 'the sample data has a family on the list without a sale');
  const email = `companion-${entry.id.slice(0, 6)}@example.com`;
  await contactRepo.update(entry.contact_id, { email });
  await cw.syncWaitlistOnline();
  const fam = await familySignIn(k.public_id, email);
  const act = (action, extra = {}) => fam.call('/f/act', { session: fam.session, status_token: fam.statusToken, action, ...extra });
  const page = async () => (await (await worker.fetch(new Request(`http://localhost/f/status/${fam.statusToken}`), env)).json()).family;

  // Before their pick there's no sale: nothing to ask for.
  const before = await page();
  assert.equal('companion' in before, false);
  assert.equal((await act('companion_request')).status, 409);

  // A sale for them (deposit pending); her next sync offers the Companion link.
  const dog = (await dogRepo.getAll()).find((d) => d.kennel_id === k.id);
  await saleRepo.create({ kennel_id: k.id, dog_id: dog.id, buyer_contact_id: entry.contact_id, placement_type: 'pet', status: 'deposit_pending' });
  await cw.syncWaitlistOnline();
  assert.deepEqual((await page()).companion, { available: true, request: null });

  assert.equal((await act('companion_request', { note: 'Text it to my wife please' })).status, 200);
  const res = await cw.syncWaitlistOnline();
  assert.deepEqual(res.events, { applied: 1, noted: 0, skipped: 0 });
  const saved = await waitlistEntryRepo.getById(entry.id);
  assert.equal(saved.companion_request.note, 'Text it to my wife please');
  assert.equal(actions.hasPendingRequest(saved, 'companion_request'), true);
  const published = raw('SELECT body FROM wl_projection')[0].body;
  assert.equal(published.includes('my wife'), false, "the family's note stays on her device");
  assert.equal((await page()).companion.request.decided, null);
  assert.equal((await act('companion_request')).status, 409, 'one at a time');

  const { computeNudges } = await import('../shared/data/nudges.js');
  const nudge = (await computeNudges()).find((n) => n.key.startsWith(`waitlist-companion-request:${entry.id}:`));
  assert.ok(nudge, 'a Companion link request is a Today nudge');
  assert.deepEqual(nudge.actions.map((a) => a.label), ['Open Companion', 'Mark sent', 'Decline']);
  assert.match(nudge.detail, /my wife/);
  await nudge.actions.find((a) => a.label === 'Mark sent').run();
  assert.equal((await waitlistEntryRepo.getById(entry.id)).companion_request.decided, 'sent');
  await assert.rejects(actions.markCompanionLinkSent(entry.id), /no Companion link request/);

  await cw.syncWaitlistOnline();
  assert.equal((await page()).companion.request.decided, 'sent');
  assert.equal((await act('companion_request')).status, 200, 'after she sent it they can ask again');
});

test('only the backing device applies family actions; a new backing device starts where the last one got to', async () => {
  await breeder();
  const k = await putOnline();
  const entry = (await waitlistEntryRepo.getByKennel(k.id)).find((e) => e.status === 'active' && e.contact_id);
  const { contactRepo } = await import('../shared/data/contactRepo.js');
  await contactRepo.update(entry.contact_id, { email: 'still@example.com' });
  await cw.syncWaitlistOnline();
  const fam = await familySignIn(k.public_id, 'still@example.com');
  assert.equal((await fam.call('/f/act', { session: fam.session, status_token: fam.statusToken, action: 'still_interested' })).status, 200);
  await cw.syncWaitlistOnline();
  const cursor = settings.getWaitlistOnlineState().eventsCursor;
  assert.ok(cursor > 0);

  settings.updateWaitlistOnlineState({ eventsCursor: null }); // a device that never applied any
  await cw.syncWaitlistOnline();
  assert.equal(settings.getWaitlistOnlineState().eventsCursor, cursor, 'picked up from events_through, nothing applied twice');
  assert.equal((await waitlistEntryRepo.getById(entry.id)).messages.filter((m) => /still interested/.test(m.body)).length, 1);

  // Another device took over backing up: this one must not apply anything.
  assert.equal((await fam.call('/f/act', { session: fam.session, status_token: fam.statusToken, action: 'still_interested' })).status, 200);
  env.DB.raw.prepare("UPDATE programs SET backing_device_id = 'someone-else'").run();
  const res = await cw.syncWaitlistOnline();
  assert.equal(res.status, 'error');
  assert.equal(res.reason, 'not-backing');
  assert.equal(settings.getWaitlistOnlineState().eventsCursor, cursor, 'the event waits for the backing device');
});

test("her decisions on families' requests: an answer change is applied and logged as theirs; a decline changes nothing but is logged; listen-only too", async () => {
  const actions = await import('../shared/data/waitlistActions.js');
  const k = await thornfield();
  const e = (await waitlistEntryRepo.getByKennel(k.id)).find((x) => x.status === 'active' && x.pref_sex === 'any' && (x.listen_mode || 'all') === 'all');
  assert.ok(e);
  await waitlistEntryRepo.update(e.id, { pref_change_request: { requested_date: '2026-10-08', changes: { pref_sex: 'female' }, note: '' } });
  await actions.declinePrefChange(e.id, { date: '2026-10-09' });
  let saved = await waitlistEntryRepo.getById(e.id);
  assert.equal(saved.pref_sex, 'any');
  assert.equal(saved.pref_change_request.decided, 'declined');
  assert.deepEqual(saved.pref_change_log.at(-1), { date: '2026-10-09', field: 'pref_sex', from: 'any', to: 'female', by: 'request', declined: true });
  await assert.rejects(actions.approvePrefChange(e.id), /no answer-change request/);

  await waitlistEntryRepo.update(e.id, { pref_change_request: { requested_date: '2026-10-10', changes: { pref_sex: 'female' }, note: '' } });
  await actions.approvePrefChange(e.id, { date: '2026-10-10' });
  saved = await waitlistEntryRepo.getById(e.id);
  assert.equal(saved.pref_sex, 'female');
  assert.equal(saved.pref_change_log.filter((l) => l.date === '2026-10-10').length, 1, 'logged once, as theirs, not also as her edit');
  assert.equal(saved.pref_change_log.at(-1).by, 'request');

  const sire = (await (await import('../shared/data/dogRepo.js')).dogRepo.getAll()).find((d) => d.sex === 'male');
  await waitlistEntryRepo.update(e.id, { listen_change_request: { requested_date: '2026-10-10', listen_mode: 'selected', listen_sire_ids: [sire.id], listen_dam_ids: [] } });
  await actions.approveListenChange(e.id, { date: '2026-10-10' });
  saved = await waitlistEntryRepo.getById(e.id);
  assert.equal(saved.listen_mode, 'selected');
  assert.deepEqual(saved.listen_sire_ids, [sire.id]);
  await waitlistEntryRepo.update(e.id, { listen_change_request: { requested_date: '2026-10-11', listen_mode: 'except', listen_sire_ids: [sire.id], listen_dam_ids: [] } });
  await actions.approveListenChange(e.id, { date: '2026-10-11' });
  saved = await waitlistEntryRepo.getById(e.id);
  assert.equal(saved.listen_mode, 'except', 'All except these parents (Spec §16.3)');
  assert.deepEqual(saved.listen_sire_ids, [sire.id]);
  await waitlistEntryRepo.update(e.id, { pref_sex: 'any', listen_mode: 'all', listen_sire_ids: [], pref_change_request: null, listen_change_request: null });
});

test('a family action her records refuse at the last moment becomes a line for her, not an error', async () => {
  const actions = await import('../shared/data/waitlistActions.js');
  const k = await thornfield();
  const e = (await waitlistEntryRepo.getByKennel(k.id)).find((x) => x.status === 'active');
  const res = await actions.applyFamilyPlan(e.id, {
    op: 'pick', offerId: 'no-such-offer', dogId: 'x', date: '2026-10-08',
    activity: { id: 'event-999999', at: '2026-10-08T12:00:00.000Z', body: 'They picked Pip from Juniper × Ash on their status page. Their pick is held by a sale with the deposit pending.' }
  });
  assert.equal(res.result, null);
  const line = (await waitlistEntryRepo.getById(e.id)).messages.find((m) => m.id === 'event-999999');
  assert.match(line.body, /couldn't be recorded: That offer no longer exists/);
  assert.equal(line.body.includes('is held'), false);
});

test('a pass with a reason and a "Not this litter" from the status page reach her device', async () => {
  const { contactRepo } = await import('../shared/data/contactRepo.js');
  const { waitlistOfferRepo } = await import('../shared/data/waitlistOfferRepo.js');
  const { litterRepo } = await import('../shared/data/litterRepo.js');
  const actions = await import('../shared/data/waitlistActions.js');
  await breeder();
  const k = await putOnline();
  // Start clean: no open turns, so one can be offered.
  for (const o of (await waitlistOfferRepo.getByKennel(k.id)).filter((x) => x.outcome === 'open')) await waitlistOfferRepo.update(o.id, { outcome: 'voided' });
  let turn = null;
  for (const l of (await litterRepo.getAll()).filter((x) => x.kennel_id === k.id)) {
    for (const e of (await waitlistEntryRepo.getByKennel(k.id)).filter((x) => x.status === 'active')) {
      try { turn = await actions.offerTo(l.id, e.id); break; } catch { /* not eligible */ }
    }
    if (turn) break;
  }
  assert.ok(turn);
  const entry = await waitlistEntryRepo.getById(turn.entry_id);
  await contactRepo.update(entry.contact_id, { email: 'reasons@example.com' });
  // "Not this litter" before picks open works on what she shows on family pages (§16.4).
  const { kennelRepo } = await import('../shared/data/kennelRepo.js');
  const on = { public: false, family: true };
  await kennelRepo.update(k.id, { waitlist_config: { ...(await kennelRepo.getById(k.id)).waitlist_config, show_upcoming: { planned_pairings: on, pairings: on, early_litters: on } } });
  await cw.syncWaitlistOnline();
  const published = JSON.parse(raw('SELECT body FROM wl_projection')[0].body);
  assert.deepEqual(published.kennel.pass_reasons.map((r) => r.id), ['timing', 'finances', 'fit', 'other']);
  const other = Object.keys(published.litters).find((id) => !turn.litter_ids.includes(id));
  const fam = await familySignIn(k.public_id, 'reasons@example.com');
  const act = (action, extra) => fam.call('/f/act', { session: fam.session, status_token: fam.statusToken, action, ...extra });
  if (other) assert.equal((await act('prepass', { litter_id: other, reason_id: 'other', reason_text: 'Too far to drive' })).status, 200);
  assert.equal((await act('pass', { turn_id: turn.id, reason_id: 'finances' })).status, 200);

  const res = await cw.syncWaitlistOnline();
  assert.equal(res.status, 'ok');
  const rows = await waitlistOfferRepo.getByEntry(entry.id);
  const passed = rows.filter((o) => o.turn_id === turn.id);
  assert.ok(passed.every((o) => o.outcome === 'passed'));
  assert.equal(passed.filter((o) => o.counts_as_pass).length, 1);
  assert.deepEqual(passed.find((o) => o.counts_as_pass).pass_reason, { id: 'finances', label: 'Financial reasons', text: '' });
  const saved = await waitlistEntryRepo.getById(entry.id);
  if (other) {
    assert.deepEqual(saved.prepasses.map((p) => [p.litter_id, p.reason.text]), [[other, 'Too far to drive']]);
    const after = JSON.parse(raw('SELECT body FROM wl_projection')[0].body);
    assert.deepEqual(after.entries[entry.id].prepasses.map((p) => p.litter_id), [other]);
    assert.equal(JSON.stringify(after).includes('Too far to drive'), false, 'the reason stays on her device');
  }
});

test('"Ready now?" (Spec §16.7): asked online, answered on the status page, applied on her device; no answer past her window removes', async () => {
  const { contactRepo } = await import('../shared/data/contactRepo.js');
  const { todayYMD, addDaysToYMD } = await import('../shared/data/dateUtils.js');
  const actions = await import('../shared/data/waitlistActions.js');
  await breeder();
  const k0 = await putOnline();
  const today = todayYMD();
  // A one-month hold that ended ten days ago, after the list went online.
  const k = await kennelRepo.update(k0.id, { waitlist_config: { ...k0.waitlist_config, online_since: addDaysToYMD(today, -60), ready_no_answer: 'remove_after', ready_answer_days: 30 } });
  const actives = (await waitlistEntryRepo.getByKennel(k.id)).filter((x) => x.status === 'active');
  const [asked, lapsed] = actives;
  const feeDate = (daysAgo) => { const d = new Date(`${addDaysToYMD(today, -daysAgo)}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
  await waitlistEntryRepo.update(asked.id, { ready_timing: '1_month', fee_received_date: feeDate(10), ready_check: null, paused_until: null });
  await waitlistEntryRepo.update(lapsed.id, { ready_timing: '1_month', fee_received_date: feeDate(40), ready_check: null, paused_until: null });
  await contactRepo.update(asked.contact_id, { email: 'ready@example.com' });

  await cw.syncWaitlistOnline();
  assert.equal((await waitlistEntryRepo.getById(lapsed.id)).removed_reason, 'no_ready_answer', 'forty days unanswered: removed by the sweep');
  const published = JSON.parse(raw('SELECT body FROM wl_projection')[0].body);
  assert.equal(published.entries[asked.id].ready_check.answer, null);
  assert.ok(published.entries[asked.id].ready_check.answer_by, 'remove_after: they see the date');

  const fam = await familySignIn(k.public_id, 'ready@example.com');
  const res = await fam.call('/f/act', { session: fam.session, status_token: fam.statusToken, action: 'ready', answer: 'no', until: addDaysToYMD(today, 45), reason: 'Moving house' });
  assert.equal(res.status, 200);
  await cw.syncWaitlistOnline();
  const saved = await waitlistEntryRepo.getById(asked.id);
  assert.equal(saved.ready_check.answer, 'no');
  assert.equal(saved.ready_check.reason, 'Moving house');
  assert.equal(saved.pause_request.until, addDaysToYMD(today, 45), 'not yet: a pause request for her');
  assert.equal(saved.status, 'active');

  // Undo the removal: back, and asked again from today (so the sweep leaves them).
  await actions.undoRemoval(lapsed.id, { today });
  await cw.syncWaitlistOnline();
  const back = await waitlistEntryRepo.getById(lapsed.id);
  assert.equal(back.status, 'active');
  assert.equal(back.ready_check.ask_from, today);
  await waitlistEntryRepo.update(asked.id, { ready_check: null, pause_request: null });
});

test('emails to families (W2 step 6): drafted from her records, queued on the entry, sent after the publish in the kennel name', async () => {
  await breeder();
  const k = await putOnline();
  const outbox = await import('../shared/data/waitlistOutbox.js');
  await cw.syncWaitlistOnline();
  const entries = await waitlistEntryRepo.getByKennel(k.id);
  const e = entries.find((x) => x.status === 'active');
  const draft = await outbox.draftFor(e.id, 'on_list');
  assert.ok(draft.email.includes('@'));
  assert.match(draft.subject, /: #\d+$/, 'their place, from the rules engine');
  assert.match(draft.body, new RegExp(k.kennel_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const queued = await outbox.queueEmail(e.id, { ...draft, body: `${draft.body}\n\nSee you soon!` });
  assert.equal(queued.status, 'queued');
  calls.length = 0;
  const res = await cw.syncWaitlistOnline();
  assert.deepEqual(res.emails, { sent: 1, failed: 0 });
  assert.equal(calls[calls.length - 1], 'POST /waitlist/messages', 'after the publish');
  const [row] = raw('SELECT id, entry_id, kind, to_email, subject, body, status FROM wl_messages');
  assert.equal(row.id, queued.id);
  assert.equal(row.entry_id, e.id);
  assert.equal(row.kind, 'on_list');
  assert.equal(row.to_email, draft.email);
  assert.match(row.body, /See you soon!$/);
  const after = (await waitlistEntryRepo.getById(e.id)).messages.find((m) => m.id === queued.id);
  assert.equal(after.status, 'sent');
  assert.ok(after.sent_at);

  calls.length = 0;
  assert.equal((await cw.syncWaitlistOnline()).emails.sent, 0, 'sent once');
  assert.ok(!calls.includes('POST /waitlist/messages'));

  // Their status page lists it.
  const view = await (await worker.fetch(new Request(`https://api.example/f/status/${(await waitlistEntryRepo.getById(e.id)).status_token}`), env)).json();
  assert.equal(view.emails[0].subject, draft.subject);

  // A family the server can't email: failed, with the reason, and Retry queues it again.
  const other = entries.find((x) => x.id !== e.id);
  const bad = await outbox.queueEmail(other.id, { kind: 'note', subject: 'Hello', body: 'Text' });
  env.DB.raw.prepare('UPDATE wl_projection SET body = json_set(body, ?, NULL)').run(`$.entries."${other.id}".email`);
  assert.deepEqual((await cw.sendQueuedEmails(auth.sessionToken(), [await thornfield()])), { sent: 0, failed: 1 });
  const failed = (await waitlistEntryRepo.getById(other.id)).messages.find((m) => m.id === bad.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'no_email');
  await outbox.retryEmail(other.id, bad.id);
  assert.equal(outbox.queuedEmails([await waitlistEntryRepo.getById(other.id)]).length, 1);
});

test('a turn change offers an email to each family a turn went to', async () => {
  const { offerSpecs, midTurn } = await import('../shared/data/waitlistOutbox.js');
  assert.deepEqual(offerSpecs({ next: { entry_id: 'a', litter_ids: ['l1', 'l2'], respond_by_date: '2026-10-20' }, offered: [{ entry_id: 'b', litter_id: 'l3', respond_by_date: '2026-10-21' }], waiting: [{ entry_id: 'c' }] }), [
    { entryId: 'a', kind: 'offer', extra: { litterIds: ['l1', 'l2'], respondBy: '2026-10-20' } },
    { entryId: 'b', kind: 'offer', extra: { litterIds: ['l3'], respondBy: '2026-10-21' } }
  ], 'never a family who is only next (automatic offers off)');
  assert.deepEqual(offerSpecs(null), []);
  assert.equal(midTurn([{ entry_id: 'a', outcome: 'open' }], 'a'), true);
  assert.equal(midTurn([{ entry_id: 'a', outcome: 'passed' }], 'a'), false);
});

test('no email is drafted where the list is not online', async () => {
  await breeder();
  const k = await thornfield();
  const outbox = await import('../shared/data/waitlistOutbox.js');
  const e = (await waitlistEntryRepo.getByKennel(k.id)).find((x) => x.status === 'active');
  assert.equal(await outbox.draftFor(e.id, 'on_list'), null);
});
