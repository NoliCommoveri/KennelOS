// license.test.js — the Pro license verdict state machine (data/license.js):
// interval detection and the online/offline grace-window logic. This pins the
// grace windows (yearly 7d, monthly 3d) that the README had drifted on, and the
// lifetime / expired / revoked branches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectInterval, onlineVerdict, offlineVerdict } from '../shared/data/license.js';

const DAY = 24 * 60 * 60 * 1000;
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

// Build a cached-record shape (recordFromPayload's output) for the verdict fns.
const rec = (over = {}) => ({
  key: 'K',
  status: 'active',
  interval: 'monthly',
  expiresAt: null,
  lastValidated: new Date().toISOString(),
  ...over,
});

test('detectInterval: reads the interval out of the variant name', () => {
  assert.equal(detectInterval('KennelOS Pro (Yearly)'), 'yearly');
  assert.equal(detectInterval('Annual plan'), 'yearly');
  assert.equal(detectInterval('Monthly'), 'monthly');
  assert.equal(detectInterval('Lifetime'), 'lifetime');
  assert.equal(detectInterval('Perpetual license'), 'lifetime');
  assert.equal(detectInterval(''), 'monthly', 'unknown → the stricter monthly');
  assert.equal(detectInterval(undefined), 'monthly');
  // Lifetime is checked before yearly so "Lifetime (annual billing)" reads lifetime.
  assert.equal(detectInterval('Lifetime annual'), 'lifetime');
});

test('onlineVerdict: active with no/future expiry is valid', () => {
  assert.equal(onlineVerdict(rec({ status: 'active', expiresAt: null })), 'valid');
  assert.equal(onlineVerdict(rec({ status: 'active', expiresAt: iso(30 * DAY) })), 'valid');
});

test('onlineVerdict: yearly grace window is 7 days past expiry', () => {
  const y = (exp) => onlineVerdict(rec({ interval: 'yearly', status: 'active', expiresAt: iso(exp) }));
  assert.equal(y(-1 * DAY), 'grace', '1 day past expiry → grace');
  assert.equal(y(-6 * DAY), 'grace', '6 days past → still in the 7d window');
  assert.equal(y(-8 * DAY), 'wall', '8 days past → beyond 7d → wall');
});

test('onlineVerdict: monthly grace window is 3 days past expiry', () => {
  const m = (exp) => onlineVerdict(rec({ interval: 'monthly', status: 'active', expiresAt: iso(exp) }));
  assert.equal(m(-1 * DAY), 'grace', '1 day past → grace');
  assert.equal(m(-2 * DAY), 'grace', '2 days past → still in the 3d window');
  assert.equal(m(-5 * DAY), 'wall', '5 days past → beyond 3d → wall');
});

test('onlineVerdict: status expired still gets its grace window, then walls', () => {
  assert.equal(onlineVerdict(rec({ interval: 'yearly', status: 'expired', expiresAt: iso(-3 * DAY) })), 'grace');
  assert.equal(onlineVerdict(rec({ interval: 'yearly', status: 'expired', expiresAt: iso(-30 * DAY) })), 'wall');
});

test('onlineVerdict: revoked (disabled/inactive) walls immediately, no grace', () => {
  assert.equal(onlineVerdict(rec({ status: 'disabled', expiresAt: iso(30 * DAY) })), 'wall');
  assert.equal(onlineVerdict(rec({ status: 'inactive', expiresAt: iso(30 * DAY) })), 'wall');
});

test('onlineVerdict: lifetime ignores expiry/grace — active is valid, anything else walls', () => {
  assert.equal(onlineVerdict(rec({ interval: 'lifetime', status: 'active', expiresAt: iso(-999 * DAY) })), 'valid');
  assert.equal(onlineVerdict(rec({ interval: 'lifetime', status: 'disabled' })), 'wall');
});

test('onlineVerdict: a null record walls', () => {
  assert.equal(onlineVerdict(null), 'wall');
});

test('offlineVerdict: honors the cache only within the re-validation window', () => {
  // Monthly, active, no expiry → base verdict is 'valid'; offline it also requires
  // a recent-enough lastValidated (within the same grace window, 3d for monthly).
  assert.equal(
    offlineVerdict(rec({ interval: 'monthly', status: 'active', lastValidated: iso(-1 * DAY) })),
    'valid', 'validated yesterday → trusted offline'
  );
  assert.equal(
    offlineVerdict(rec({ interval: 'monthly', status: 'active', lastValidated: iso(-10 * DAY) })),
    'wall', 'stale cache (>3d) → wall, so a cancelled sub cannot ride a stale active forever'
  );
});

test('offlineVerdict: a base wall stays a wall regardless of freshness', () => {
  assert.equal(
    offlineVerdict(rec({ status: 'disabled', lastValidated: iso(0) })),
    'wall'
  );
});

test('offlineVerdict: lifetime needs no periodic re-validation', () => {
  assert.equal(
    offlineVerdict(rec({ interval: 'lifetime', status: 'active', lastValidated: iso(-999 * DAY) })),
    'valid', 'a lifetime key stays licensed offline indefinitely'
  );
});
