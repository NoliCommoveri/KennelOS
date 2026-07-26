// license.test.js — the Pro license verdict state machine (data/license.js):
// interval detection and the online/offline grace-window logic. This pins the
// grace windows (yearly 7d, monthly 3d) that the README had drifted on, and the
// lifetime / expired / revoked branches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectInterval, onlineVerdict, offlineVerdict,
  buildInstanceName, recordFromPayload, DEFAULT_DEVICE_LABEL,
} from '../shared/data/license.js';

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

// --- Instance naming --------------------------------------------------------
// The activation's name is the only handle an owner has on a slot they want to
// release, so two activations must never produce the same string.

test('buildInstanceName: owner label plus a short device-id suffix', () => {
  const id = 'd3f1a2b4-1111-2222-3333-444455556666';
  assert.equal(buildInstanceName('Kitchen laptop', id), 'Kitchen laptop · d3f1a2b4');
  assert.equal(buildInstanceName('  Kitchen   laptop  ', id), 'Kitchen laptop · d3f1a2b4',
    'whitespace is normalized so a stray space is not a different device');
});

test('buildInstanceName: an unnamed device still gets a distinct name', () => {
  const a = buildInstanceName('', 'aaaaaaaa-0000-0000-0000-000000000000');
  const b = buildInstanceName('', 'bbbbbbbb-0000-0000-0000-000000000000');
  assert.equal(a, `${DEFAULT_DEVICE_LABEL} · aaaaaaaa`);
  assert.notEqual(a, b, 'two unnamed devices must not collide — that was the old bug');
  assert.equal(buildInstanceName(null, 'cccccccc-0000-0000-0000-000000000000'),
    `${DEFAULT_DEVICE_LABEL} · cccccccc`);
});

test('buildInstanceName: two devices sharing a label stay distinguishable', () => {
  assert.notEqual(
    buildInstanceName('Laptop', '11111111-0000-0000-0000-000000000000'),
    buildInstanceName('Laptop', '22222222-0000-0000-0000-000000000000')
  );
});

test('buildInstanceName: an over-long label is capped, not rejected', () => {
  const name = buildInstanceName('x'.repeat(200), 'abcdef12-0000-0000-0000-000000000000');
  assert.equal(name, `${'x'.repeat(60)} · abcdef12`);
});

// --- Status precedence ------------------------------------------------------
// `license_key.status` describes the KEY; `valid` describes THIS activation.
// When they disagree, the activation has to win — otherwise a device released
// (or deliberately cut off) in the store dashboard keeps running.

test('recordFromPayload: valid:false downgrades an otherwise-active key', () => {
  const r = recordFromPayload('K', {
    valid: false,
    error: 'instance_id not found',
    license_key: { status: 'active', expires_at: null },
  }, 'inst-1', 'Laptop · abcdef12');
  assert.equal(r.status, 'inactive', 'a deactivated instance must not read as active');
  assert.equal(onlineVerdict(r), 'wall', 'and it walls immediately, with no grace');
});

test('recordFromPayload: valid:false preserves a more specific key status', () => {
  // A lapsed subscription is also valid:false, but 'expired' earns its grace
  // window — flattening it to 'inactive' would wall a renewal a day late.
  const r = recordFromPayload('K', {
    valid: false,
    license_key: { status: 'expired', expires_at: iso(-1 * DAY) },
    meta: { variant_name: 'KennelOS Pro (Yearly)' },
  }, 'inst-1', 'Laptop · abcdef12');
  assert.equal(r.status, 'expired');
  assert.equal(onlineVerdict(r), 'grace', 'a just-lapsed yearly key still gets its 7 days');
});

test('recordFromPayload: a valid activation is untouched', () => {
  const r = recordFromPayload('K', {
    valid: true,
    license_key: { status: 'active', expires_at: null },
    meta: { variant_name: 'KennelOS Pro (Monthly)' },
  }, 'inst-1', 'Laptop · abcdef12');
  assert.equal(r.status, 'active');
  assert.equal(r.interval, 'monthly');
  assert.equal(r.instanceId, 'inst-1');
  assert.equal(onlineVerdict(r), 'valid');
});

test('recordFromPayload: an activate response (no `valid` field) never downgrades', () => {
  // /activate answers with `activated`, not `valid`. An absent field must not be
  // read as a failure, or every fresh activation would wall itself.
  const r = recordFromPayload('K', {
    activated: true,
    license_key: { status: 'active', expires_at: null },
    meta: { variant_name: 'Lifetime' },
  }, 'inst-1', 'Laptop · abcdef12');
  assert.equal(r.status, 'active');
  assert.equal(onlineVerdict(r), 'valid');
});
