// cloudIntegrations.test.js — Integrations plan §0, step 5, on her device: the
// pure planner (data/integrationEvents.js), and end to end against the real Worker
// in-process (as cloudWaitlist.test.js does): a test vendor posts a webhook, her
// backing device reads the events and applies them through the repos, a stale one
// becomes a review on the record, and Today shows it until she taps Done.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { makeEnv, lastCode } from '../cloud/tests/helpers/env.js';
import { worker } from '../cloud/tests/helpers/worker.js';
import { planIntegrationEvent, addReview, reviewTitle, REVIEWS_MAX } from '../shared/data/integrationEvents.js';

const ev = (kind, recordType, recordId, payload = {}, seq = 1) =>
  ({ seq, provider: 'stripe', kind, recordType, recordId, payload, createdAt: '2026-10-12T10:00:00.000Z' });

// --- Pure: the planner -----------------------------------------------------------------

test('contract.signed: applied while draft or sent, skipped when signed, a review otherwise', () => {
  const e = ev('contract.signed', 'contract', 'c1', { date: '2026-10-11' });
  assert.deepEqual(planIntegrationEvent(e, { status: 'sent' }), { op: 'update', changes: { status: 'signed', signed_date: '2026-10-11' } });
  assert.deepEqual(planIntegrationEvent(ev('contract.signed', 'contract', 'c1'), { status: 'draft' }).changes.signed_date, '2026-10-12', 'no date: the event\'s day');
  assert.equal(planIntegrationEvent(e, { status: 'signed' }).op, 'skip');
  const r = planIntegrationEvent(e, { status: 'void' });
  assert.equal(r.op, 'review');
  assert.match(r.review.reason, /void/);
  assert.equal(planIntegrationEvent(e, null).op, 'skip');
  assert.equal(planIntegrationEvent(e, { status: 'sent', is_archived: true }).op, 'skip');
});

test('payment.paid: a deposit or the balance, only from where the link left the sale', () => {
  const dep = ev('payment.paid', 'sale', 's1', { component: 'deposit', amount: 500, date: '2026-10-12', method: 'Card', reference: 'pi_1' });
  assert.deepEqual(planIntegrationEvent(dep, { status: 'deposit_pending' }).changes,
    { status: 'deposit_paid', deposit_date: '2026-10-12', payment_method: 'Card', payment_reference: 'pi_1' });
  assert.deepEqual(planIntegrationEvent(dep, { status: 'deposit_pending', payment_method: 'Zelle' }).changes.payment_method, undefined, 'hers stays');
  assert.equal(planIntegrationEvent(dep, { status: 'deposit_paid', deposit_date: '2026-10-12' }).op, 'skip', 'already applied');
  assert.equal(planIntegrationEvent(dep, { status: 'paid_in_full' }).op, 'review');
  assert.match(planIntegrationEvent(dep, { status: 'deposit_pending' }, { waitlistPick: true }).review.reason, /family's page/);

  const bal = ev('payment.paid', 'sale', 's1', { component: 'balance', amount: 2500, date: '2026-11-01' });
  assert.deepEqual(planIntegrationEvent(bal, { status: 'deposit_paid', deposit_date: '2026-10-12' }).changes,
    { status: 'paid_in_full', balance_paid_date: '2026-11-01' });
  assert.deepEqual(planIntegrationEvent(bal, { status: 'deposit_pending' }).changes,
    { status: 'paid_in_full', balance_paid_date: '2026-11-01', deposit_date: '2026-11-01' }, 'paid in one go');
  assert.equal(planIntegrationEvent(bal, { status: 'cancelled' }).op, 'review');
  assert.equal(planIntegrationEvent(ev('payment.refunded', 'sale', 's1', { amount: 500 }), { status: 'deposit_paid' }).op, 'review');
});

test('reviews: kept once each, the newest REVIEWS_MAX; a title for Today', () => {
  let list = [];
  for (let i = 1; i <= REVIEWS_MAX + 3; i++) list = addReview(list, { id: `int-${i}` });
  list = addReview(list, { id: `int-${REVIEWS_MAX + 3}` });
  assert.equal(list.length, REVIEWS_MAX);
  assert.equal(list.at(-1).id, `int-${REVIEWS_MAX + 3}`);
  assert.equal(reviewTitle({ provider: 'square', kind: 'payment.paid', payload: { component: 'balance', amount: 2500 } }),
    'Square says a balance payment of $2500.00 came in');
});

// --- End to end -----------------------------------------------------------------------------

let env; let auth; let api; let ci; let settings; let integrations;
let kennelRepo; let contactRepo; let dogRepo; let saleRepo; let contractRepo; let computeNudges;
const calls = [];

async function workerFetch(url, init = {}) {
  const headers = { ...(init.headers || {}), origin: 'http://localhost:8000' };
  if (typeof init.body === 'string') headers['content-length'] = String(new TextEncoder().encode(init.body).length);
  calls.push(`${init.method || 'GET'} ${new URL(url).pathname}`);
  return worker.fetch(new Request(url, { method: init.method, headers, body: init.body, signal: init.signal }), env);
}

async function breeder({ backing = true } = {}) {
  const email = 'breeder@example.com';
  await auth.startSignIn(email);
  await auth.verifySignIn(email, lastCode(env), { deviceLabel: 'Phone' });
  const { email_hash: eh } = env.DB.raw.prepare('SELECT email_hash FROM users').get();
  env.DB.raw.prepare(`INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
    VALUES ('order:1', ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`).run(eh, new Date().toISOString(), new Date().toISOString());
  if (backing) await api.takeOverBacking(auth.sessionToken());
  return env.DB.raw.prepare('SELECT id FROM programs').get().id;
}

// A vendor posting to her connection's webhook.
async function vendorSays(programId, events) {
  const { hookPath } = await integrations.createConnection(env, programId, { provider: 'testpay', token: 'sk' });
  const res = await worker.fetch(new Request(`https://api.example${hookPath}`, {
    method: 'POST', headers: { 'x-test-signature': 'ok', 'content-type': 'application/json' }, body: JSON.stringify({ events })
  }), env);
  assert.equal(res.status, 200);
}

let records;
async function makeRecords() {
  const k = (await kennelRepo.getAll())[0] || await kennelRepo.create({ kennel_name: 'Test Boston', is_own_kennel: true });
  const buyer = await contactRepo.create({ name: 'Ann Buyer' });
  const pup = await dogRepo.create({ call_name: `Maple ${Math.random()}`, breed: 'Lab', sex: 'female', ownership_type: 'owned', status: 'puppy', kennel_id: k.id });
  const sale = await saleRepo.create({ dog_id: pup.id, buyer_contact_id: buyer.id, registration_type: 'limited', status: 'deposit_pending', price: 3000, deposit_amount: 500, kennel_id: k.id });
  const paidSale = await saleRepo.create({ dog_id: pup.id, buyer_contact_id: buyer.id, registration_type: 'limited', status: 'paid_in_full', price: 3000, kennel_id: k.id });
  const contract = await contractRepo.create({ contract_type: 'sale', related_sale_id: sale.id, kennel_id: k.id, status: 'sent', title: 'Pet home: Maple' });
  return { sale, paidSale, contract };
}

before(async () => {
  await installMemoryDb();
  globalThis.location = { hostname: 'localhost' };
  globalThis.fetch = workerFetch;
  api = await import('../shared/data/cloud/cloudApi.js');
  auth = await import('../shared/data/cloud/cloudAuth.js');
  ci = await import('../shared/data/cloud/cloudIntegrations.js');
  settings = await import('../shared/data/settings.js');
  integrations = await import('../cloud/src/integrations.js');
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ contractRepo } = await import('../shared/data/contractRepo.js'));
  ({ computeNudges } = await import('../shared/data/nudges.js'));
});

beforeEach(async () => {
  env = await makeEnv({ INT_TOKEN_KEY: 'k' });
  localStorage.clear();
  calls.length = 0;
  globalThis.location = { hostname: 'localhost' };
  integrations.registerAdapter({ provider: 'testpay', verify: async (r) => r.headers.get('x-test-signature') === 'ok', toEvents: (p) => p.events });
  records = await makeRecords();
});
afterEach(() => integrations.unregisterAdapter('testpay'));

test('no connection: her device asks nothing of the server', async () => {
  await breeder();
  calls.length = 0;
  assert.equal(await ci.syncIntegrationEvents(), null);
  assert.deepEqual(calls, []);
});

test('the backing device applies what the vendor reported; a stale one waits on Today', async () => {
  const programId = await breeder();
  await vendorSays(programId, [
    { providerEventId: 'e1', kind: 'payment.paid', recordType: 'sale', recordId: records.sale.id, data: { component: 'deposit', amount: 500, date: '2026-10-12', method: 'Card', reference: 'pi_1' } },
    { providerEventId: 'e2', kind: 'contract.signed', recordType: 'contract', recordId: records.contract.id, data: { date: '2026-10-12' } },
    { providerEventId: 'e3', kind: 'payment.paid', recordType: 'sale', recordId: records.paidSale.id, data: { component: 'deposit', amount: 500, date: '2026-10-12' } },
    { providerEventId: 'e4', kind: 'contract.signed', recordType: 'contract', recordId: 'not-hers', data: {} }
  ]);
  assert.deepEqual((await ci.refreshConnections()).length, 1);
  assert.deepEqual(await ci.syncIntegrationEvents(), { applied: 2, review: 1, skipped: 1 });

  const sale = await saleRepo.getById(records.sale.id);
  assert.equal(sale.status, 'deposit_paid');
  assert.equal(sale.deposit_date, '2026-10-12');
  assert.equal(sale.payment_reference, 'pi_1');
  const contract = await contractRepo.getById(records.contract.id);
  assert.equal(contract.status, 'signed');
  assert.equal(contract.signed_date, '2026-10-12');
  const paid = await saleRepo.getById(records.paidSale.id);
  assert.equal(paid.status, 'paid_in_full', 'not overwritten');
  assert.equal(paid.integration_reviews.length, 1);

  // Read again: nothing new, nothing written.
  assert.deepEqual(await ci.syncIntegrationEvents(), { applied: 0, review: 0, skipped: 0 });

  const nudge = (await computeNudges()).find((n) => n.key.startsWith(`int-review:${records.paidSale.id}:`));
  assert.ok(nudge, 'Today shows the review');
  assert.match(nudge.title, /says a deposit payment of \$500\.00 came in/);
  await nudge.actions.find((a) => a.label === 'Done').run();
  assert.deepEqual((await saleRepo.getById(records.paidSale.id)).integration_reviews, []);
  assert.ok(!(await computeNudges()).some((n) => n.key.startsWith('int-review:')));
});

test('another device reads but never applies, and keeps its cursor', async () => {
  const programId = await breeder({ backing: false });
  await vendorSays(programId, [
    { providerEventId: 'e1', kind: 'contract.signed', recordType: 'contract', recordId: records.contract.id, data: {} }
  ]);
  settings.updateIntegrationsState({ connections: 1 });
  await assert.rejects(ci.syncIntegrationEvents(), (e) => e.code === 'not_backing_device');
  assert.equal(settings.getIntegrationsState().lastError, 'not-backing');
  assert.equal(settings.getIntegrationsState().eventsCursor, 0);
  assert.equal((await contractRepo.getById(records.contract.id)).status, 'sent');
});

test('a syncing program: the lease holder applies; with another device holding it, nothing is applied here', async () => {
  const programId = await breeder({ backing: false });
  env.DB.raw.prepare("UPDATE programs SET sync_enabled_at = '2026-10-12T00:00:00.000Z'").run();
  settings.updateCloudSyncState({ enabled: true });
  await vendorSays(programId, [
    { providerEventId: 'e1', kind: 'contract.signed', recordType: 'contract', recordId: records.contract.id, data: { date: '2026-10-12' } }
  ]);
  settings.updateIntegrationsState({ connections: 1 });
  env.DB.raw.prepare('INSERT INTO wl_leases (program_id, device_id, device_label, until) VALUES (?, ?, ?, ?)')
    .run(programId, 'laptop-1', 'Laptop', new Date(Date.now() + 60000).toISOString());
  await assert.rejects(ci.syncIntegrationEvents(), (e) => e.code === 'lease_held');
  assert.equal(settings.getIntegrationsState().lastError, 'lease-held');
  assert.equal((await contractRepo.getById(records.contract.id)).status, 'sent');

  env.DB.raw.prepare('DELETE FROM wl_leases').run(); // the laptop closed
  assert.deepEqual(await ci.syncIntegrationEvents(), { applied: 1, review: 0, skipped: 0 });
  assert.equal((await contractRepo.getById(records.contract.id)).status, 'signed');
});
