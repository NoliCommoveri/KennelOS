// licenseRevalidate.test.js — validate()/evaluateLicense() against the store's
// answers (data/license.js). Pins two ways a released device used to keep Pro
// without asking for its key:
//   1. a validate in flight when a remote erase wiped the record wrote it back;
//   2. the store's "activation not found" (a 4xx with valid:false) was read as
//      offline, so the cached record kept the device running for the whole
//      offline window (90 days for a lifetime key).
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let license, settings;
const realFetch = globalThis.fetch;

before(async () => {
  await installMemoryDb(); // localStorage stand-in
  settings = await import('../shared/data/settings.js');
  license = await import('../shared/data/license.js');
});

beforeEach(() => localStorage.clear());
afterEach(() => { globalThis.fetch = realFetch; });

const record = (over = {}) => ({
  key: 'KEY-1', instanceId: 'inst-1', instanceName: 'Phone · abcd1234', status: 'active',
  expiresAt: null, variantName: 'Lifetime', interval: 'lifetime',
  lastValidated: new Date().toISOString(), ...over,
});
const answer = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const valid = { valid: true, license_key: { status: 'active', expires_at: null }, meta: { variant_name: 'Lifetime' } };

test('isGoneAnswer: only the store\'s own 4xx valid:false', () => {
  assert.equal(license.isGoneAnswer(404, { valid: false, error: 'license_key not found.' }), true);
  assert.equal(license.isGoneAnswer(400, { valid: false }), true);
  assert.equal(license.isGoneAnswer(429, { valid: false }), false, 'a rate limit is a blip');
  assert.equal(license.isGoneAnswer(500, { valid: false }), false, 'a server error is a blip');
  assert.equal(license.isGoneAnswer(404, {}), false, 'no store answer: a blip (proxy, CDN)');
});

test('a released activation (404 valid:false) asks for the key, not the cache', async () => {
  settings.setProLicense(record());
  globalThis.fetch = answer(404, { valid: false, error: 'license_key instance not found.' });
  const r = await license.evaluateLicense();
  assert.equal(r.state, 'unactivated');
  assert.equal(settings.getProLicense(), null);
});

test('a network failure still keeps the cache (offline-first)', async () => {
  settings.setProLicense(record());
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const r = await license.evaluateLicense();
  assert.equal(r.state, 'valid');
  assert.ok(settings.getProLicense());
});

test('a server error keeps the cache too', async () => {
  settings.setProLicense(record());
  globalThis.fetch = answer(503, {});
  assert.equal((await license.evaluateLicense()).state, 'valid');
  assert.ok(settings.getProLicense());
});

test('a validate answering after an erase wiped the record does not bring it back', async () => {
  settings.setProLicense(record());
  globalThis.fetch = async () => {
    settings.clearProLicense(); // the remote erase lands while the request is out
    return answer(200, valid)();
  };
  const r = await license.evaluateLicense();
  assert.equal(settings.getProLicense(), null, 'the wiped license stays wiped');
  assert.equal(r.state, 'unactivated');
});

test('a 404 for a record already replaced by a new key leaves the new one alone', async () => {
  const old = record();
  settings.setProLicense(old);
  globalThis.fetch = async () => {
    settings.setProLicense(record({ key: 'KEY-2', instanceId: 'inst-2' }));
    return answer(404, { valid: false })();
  };
  assert.equal(await license.validate(old), null);
  assert.equal(settings.getProLicense().key, 'KEY-2');
});

test('an ordinary valid answer is cached as before', async () => {
  settings.setProLicense(record({ lastValidated: '2026-01-01T00:00:00.000Z' }));
  globalThis.fetch = answer(200, valid);
  const r = await license.evaluateLicense();
  assert.equal(r.state, 'valid');
  assert.notEqual(settings.getProLicense().lastValidated, '2026-01-01T00:00:00.000Z');
});

// --- How often the store is asked (Load Performance plan D6) ---------------------
function sessionStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}

test('the store is asked once per browsing session, and again after 6 hours', () => {
  globalThis.sessionStorage = sessionStore();
  const t0 = Date.parse('2026-11-18T10:00:00.000Z');
  assert.equal(license.licenseCheckDue(t0), true, 'never asked: due');
  settings.markLicenseAsked(new Date(t0).toISOString());
  assert.equal(license.licenseCheckDue(t0 + 60_000), false, 'asked this session: not due');
  assert.equal(license.licenseCheckDue(t0 + license.LICENSE_RECHECK_MS - 1), false);
  assert.equal(license.licenseCheckDue(t0 + license.LICENSE_RECHECK_MS), true, '6 hours on: due');
  assert.equal(license.licenseCheckDue(t0 - 60_000), true, 'a clock set back can\'t put it off');
  globalThis.sessionStorage = sessionStore(); // a new tab, or the app relaunched
  assert.equal(license.licenseCheckDue(t0 + 60_000), true, 'a new session asks again');
  delete globalThis.sessionStorage;
});

test('askLicenseStore notes the attempt even when the store can\'t be reached', async () => {
  globalThis.sessionStorage = sessionStore();
  settings.setProLicense(record());
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const r = await license.askLicenseStore();
  assert.equal(r.state, 'valid', 'the cache still decides offline');
  assert.equal(license.licenseCheckDue(), false);
  delete globalThis.sessionStorage;
});

test('cachedLicense decides from the stored record alone, with no request', () => {
  globalThis.fetch = async () => { throw new Error('no request expected'); };
  assert.deepEqual(license.cachedLicense(), { state: 'unactivated', record: null });
  settings.setProLicense(record({ interval: 'monthly', variantName: 'Monthly', status: 'disabled' }));
  assert.equal(license.cachedLicense().state, 'wall');
  settings.setProLicense(record({ interval: 'monthly', variantName: 'Monthly' }));
  assert.equal(license.cachedLicense().state, 'valid');
});

test('a store call carries a 5 s timeout, and a timeout reads as offline', async () => {
  settings.setProLicense(record());
  let signal = null;
  globalThis.fetch = async (_url, opts) => {
    signal = opts.signal;
    const e = new Error('The operation timed out.'); e.name = 'TimeoutError'; throw e;
  };
  const r = await license.evaluateLicense();
  assert.ok(signal, 'the request had a signal');
  assert.equal(license.LICENSE_TIMEOUT_MS, 5000);
  assert.equal(r.state, 'valid', 'the cached record decides, as offline');
  assert.ok(settings.getProLicense());
});
