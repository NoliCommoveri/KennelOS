// cloudNotify.test.js — app alerts on this device (review K12-8, K12-4): the note
// sw.js reads is kept per account, sign-out and an erase forget it, and the app can
// say when this device shows alerts it can't take in.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let notify; let settings;

// --- Browser stand-ins -------------------------------------------------------------
const store = new Map(); // Cache Storage: one cache, keyed by request key
globalThis.caches = {
  open: async () => ({
    match: async (k) => (store.has(k) ? new Response(store.get(k)) : undefined),
    put: async (k, res) => { store.set(k, await res.text()); },
    delete: async (k) => store.delete(k)
  })
};
let subscription = null;
const pushManager = {
  getSubscription: async () => subscription,
  subscribe: async () => { subscription = fakeSub(); return subscription; }
};
const reg = { pushManager };
const fakeSub = () => ({
  unsubscribed: false,
  async unsubscribe() { this.unsubscribed = true; subscription = null; return true; },
  toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { auth: 'AAAAAAAAAAAAAAAAAAAAAA' } }),
  options: {}
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'node', serviceWorker: { ready: Promise.resolve(reg), getRegistration: async () => reg } }
});
globalThis.PushManager = function PushManager() {};
globalThis.Notification = { permission: 'granted', requestPermission: async () => 'granted' };

// The server, stubbed: records each call and answers from `answers`.
const calls = [];
let answers = {};
globalThis.fetch = async (url, init = {}) => {
  const key = `${init.method || 'GET'} ${new URL(url).pathname}`;
  calls.push(key);
  const body = answers[key] ?? {};
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

const note = () => (store.has('config') ? JSON.parse(store.get('config')) : null);
const setNote = (n) => store.set('config', JSON.stringify(n));
const PUSH = { push: { available: true, publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', thisDevice: true, devices: 1 }, digest: { available: false } };

before(async () => {
  await installMemoryDb();
  globalThis.location = { hostname: 'localhost' }; // → editionConfig.devCloudUrl
  settings = await import('../shared/data/settings.js');
  notify = await import('../shared/data/cloud/cloudNotify.js');
});

beforeEach(() => {
  store.clear();
  localStorage.clear();
  calls.length = 0;
  answers = { 'GET /notify': PUSH, 'POST /notify/push/subscribe': PUSH };
  subscription = fakeSub();
});

const signedIn = (extra = {}) => settings.setCloudSession({ token: 't-1', email: 'her@example.com', programId: 'p-1', deviceId: 'd-1', ...extra });
const stale = { api: 'x', on: true, refreshedAt: 1 }; // a day old, so a refresh is due

test('enabling alerts records whose they are', async () => {
  signedIn();
  await notify.enableAlertsHere(PUSH.push.publicKey);
  assert.equal(note().programId, 'p-1');
  assert.equal(note().on, true);
});

test('a note left by another account is never refreshed (review K12-8)', async () => {
  signedIn();
  setNote({ ...stale, programId: 'p-other' });
  assert.equal(await notify.refreshAlertsHere(), 'off');
  assert.ok(!calls.includes('POST /notify/push/subscribe'));
});

test('support’s helper session never re-subscribes her alerts (review K12-8)', async () => {
  signedIn({ role: 'helper', email: null });
  setNote({ ...stale, programId: 'p-1' });
  assert.equal(await notify.refreshAlertsHere(), 'off');
  setNote({ ...stale }); // an old note with no account
  assert.equal(await notify.refreshAlertsHere(), 'off');
  assert.ok(!calls.includes('POST /notify/push/subscribe'));
});

test('her own note is refreshed, and an old one without an account is adopted', async () => {
  signedIn();
  setNote({ ...stale });
  assert.equal(await notify.refreshAlertsHere(), 'refreshed');
  assert.equal(note().programId, 'p-1');
  assert.ok(calls.includes('POST /notify/push/subscribe'));
});

test('forgetting alerts unsubscribes the browser, tells the server and deletes the note', async () => {
  signedIn();
  setNote({ ...stale, programId: 'p-1' });
  const sub = subscription;
  await notify.forgetAlertsHere('t-1');
  assert.equal(sub.unsubscribed, true);
  assert.equal(note(), null);
  assert.ok(calls.includes('POST /notify/push/unsubscribe'));
});

test('sign-out forgets this device’s alerts (review K12-8)', async () => {
  const auth = await import('../shared/data/cloud/cloudAuth.js');
  signedIn();
  setNote({ ...stale, programId: 'p-1' });
  const sub = subscription;
  await auth.signOut();
  assert.equal(sub.unsubscribed, true);
  assert.equal(note(), null);
  assert.equal(settings.getCloudSession(), null);
});

test('where family events land: the backing device, another device, or a device not in step (review K12-4)', async () => {
  signedIn();
  answers['GET /program'] = { thisDeviceId: 'd-1', backingDevice: { id: 'd-1', label: 'Phone' } };
  assert.deepEqual(await notify.takeInHere(), { ok: true });
  answers['GET /program'] = { thisDeviceId: 'd-1', backingDevice: { id: 'd-2', label: 'Laptop' } };
  const away = await notify.takeInHere();
  assert.deepEqual(away, { ok: false, reason: 'not_backing', label: 'Laptop' });
  assert.match(notify.takeInHereText(away), /“Laptop”/);
  answers['GET /program'] = { thisDeviceId: 'd-1', backingDevice: null, syncing: true };
  assert.deepEqual(await notify.takeInHere({ syncHere: true }), { ok: true });
  const notInStep = await notify.takeInHere({ syncHere: false });
  assert.equal(notInStep.reason, 'not_syncing_here');
  assert.match(notify.takeInHereText(notInStep), /keeps in step/);
  assert.equal(notify.takeInHereText({ ok: true }), '');
});

test('alerts the server has on can be blocked or lost on this device (review K12-7)', async () => {
  assert.equal(await notify.alertsLiveHere(), 'ok');
  subscription = null;
  assert.equal(await notify.alertsLiveHere(), 'lost');
  globalThis.Notification.permission = 'denied';
  try {
    assert.equal(await notify.alertsLiveHere(), 'blocked');
  } finally { globalThis.Notification.permission = 'granted'; }
});
