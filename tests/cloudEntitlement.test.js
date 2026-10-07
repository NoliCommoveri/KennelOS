// cloudEntitlement.test.js — License Link Plan §10 step 3: the client half of
// the Pro license link (data/cloud/cloudEntitlement + its cloudApi calls), end
// to end against the real Worker code in-process, as cloudClient.test.js does.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { installMemoryDb } from './support/memoryDb.js';
import { makeEnv, lastCode } from '../cloud/tests/helpers/env.js';
import { worker } from '../cloud/tests/helpers/worker.js';

const LS = {
  LEMONSQUEEZY_WEBHOOK_SECRET: 'whsec-test', LS_STORE_ID: '100', LS_PRO_PRODUCT_IDS: '200',
  LS_YEARLY_VARIANT_IDS: '302', LS_LIFETIME_VARIANT_IDS: '303', LS_TEST_MODE: 'true',
};

let env;
let auth; let ent; let api;
const calls = [];

async function workerFetch(url, init = {}) {
  const headers = { ...(init.headers || {}), origin: 'http://localhost:8000' };
  if (typeof init.body === 'string') headers['content-length'] = String(new TextEncoder().encode(init.body).length);
  calls.push(`${init.method || 'GET'} ${new URL(url).pathname}`);
  return worker.fetch(new Request(url, { method: init.method, headers, body: init.body, signal: init.signal }), env);
}

// Lemon Squeezy telling the Worker about a purchase.
async function purchase({ email, id = 1, variant = 302, status = 'active' }) {
  const body = JSON.stringify({
    meta: { event_name: 'subscription_created' },
    data: { type: 'subscriptions', id: String(id), attributes: {
      store_id: 100, product_id: 200, variant_id: variant, status, user_email: email,
      renews_at: new Date(Date.now() + 30 * 864e5).toISOString(), ends_at: null, test_mode: true, updated_at: new Date().toISOString(),
    } },
  });
  const res = await worker.fetch(new Request('https://api.example/webhooks/lemonsqueezy', {
    method: 'POST', body,
    headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', LS.LEMONSQUEEZY_WEBHOOK_SECRET).update(body).digest('hex') },
  }), env);
  assert.equal(res.status, 200);
}

async function signIn(email = 'breeder@example.com') {
  await auth.startSignIn(email);
  return auth.verifySignIn(email, lastCode(env), { deviceLabel: 'Laptop' });
}

before(async () => {
  await installMemoryDb();
  globalThis.location = { hostname: 'localhost' }; // → editionConfig.devCloudUrl
  globalThis.fetch = workerFetch;
  api = await import('../shared/data/cloud/cloudApi.js');
  auth = await import('../shared/data/cloud/cloudAuth.js');
  ent = await import('../shared/data/cloud/cloudEntitlement.js');
});

beforeEach(async () => {
  env = await makeEnv(LS);
  localStorage.clear();
  calls.length = 0;
  ent.forgetEntitlement();
  globalThis.location = { hostname: 'localhost' };
});

test('signed out: no request; signed in with the purchase email: Pro, and the answer is cached', async () => {
  await assert.rejects(ent.entitlement(), { name: 'CloudAuthError' });
  assert.deepEqual(calls, []);
  await purchase({ email: 'breeder@example.com' });
  await signIn();
  calls.length = 0;
  const e = await ent.entitlement();
  assert.deepEqual(e, { pro: true, plan: 'yearly', until: null, source: 'email', lapsed: false, linkedEmails: 0 });
  assert.deepEqual(await ent.entitlement(), e);
  assert.deepEqual(ent.cachedEntitlement(), e);
  assert.equal(calls.length, 1, 'one read per five minutes');
  await ent.entitlement({ fresh: true });
  assert.equal(calls.length, 2);
  await ent.entitlement({ now: Date.now() + ent.CACHE_MS + 1 });
  assert.equal(calls.length, 3);
});

test('a purchase made with another email: link it by the code sent there', async () => {
  await purchase({ email: 'kennel.business@example.com', variant: 303 });
  await signIn();
  assert.equal((await ent.entitlement()).pro, false);

  await assert.rejects(ent.startPurchaseLink('breeder@example.com'), { name: 'CloudRequestError', code: 'own_email' });
  await assert.rejects(ent.startPurchaseLink('nope'), { code: 'bad_email' });
  await ent.startPurchaseLink(' kennel.business@example.com ');
  await assert.rejects(ent.finishPurchaseLink('kennel.business@example.com', '000000' === lastCode(env) ? '111111' : '000000'), { code: 'invalid_code' });
  const e = await ent.finishPurchaseLink('kennel.business@example.com', ` ${lastCode(env)} `);
  assert.deepEqual(e, { pro: true, plan: 'lifetime', until: null, source: 'linked', lapsed: false, linkedEmails: 1 });
  assert.deepEqual(ent.cachedEntitlement(), e, 'the cache follows the link');

  const after = await ent.unlinkPurchaseEmails();
  assert.equal(after.pro, false);
  assert.equal(after.linkedEmails, 0);
  assert.deepEqual(ent.cachedEntitlement(), after);
});

test('another sign-in never sees the previous one\'s cached answer', async () => {
  await purchase({ email: 'breeder@example.com' });
  await signIn();
  assert.equal((await ent.entitlement()).pro, true);
  await auth.signOut();
  await signIn('someone.else@example.com');
  assert.equal(ent.cachedEntitlement(), null);
  assert.equal((await ent.entitlement()).pro, false);
});

test('cloudUrl: null (a deployed origin with no server) makes no request', async () => {
  globalThis.location = { hostname: 'pro.kennelos.app' }; // the shared default config: cloudUrl null
  await assert.rejects(ent.entitlement(), { name: 'CloudUnavailableError' });
  await assert.rejects(ent.startPurchaseLink('a@example.com'), { name: 'CloudUnavailableError' });
  assert.equal(ent.cachedEntitlement(), null);
  assert.deepEqual(calls, []);
  assert.ok(api.getEntitlement);
});
