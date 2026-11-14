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
