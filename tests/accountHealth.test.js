// accountHealth.test.js — Kels's "Check account health", its data half
// (data/accountHealth.js): which findings come from which facts, in what order,
// and what "All good" says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../shared/data/accountHealth.js';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * A.DAY_MS).toISOString();
const kinds = (facts) => A.healthFindings(facts, NOW).map((f) => f.kind);
const backup = (extra = {}) => ({ enabled: true, paused: false, dirty: false, lastPushedAt: daysAgo(0.1), lastError: null, ...extra });
const cloud = (b) => ({ available: true, backup: backup(b) });
const fresh = { lastExportAt: daysAgo(1) };

test('nothing known, nothing found (a failed read is skipped, not guessed)', () => {
  assert.deepEqual(kinds({ ...fresh }), []);
  assert.deepEqual(kinds({ ...fresh, storage: null, cloud: null, license: null, devices: null, vault: null }), []);
});

test('this device: storage that can be cleared, storage filling up, an update waiting', () => {
  assert.deepEqual(kinds({ ...fresh, storage: { persisted: false, usage: 10, quota: 100 } }), ['storage-persist']);
  assert.deepEqual(kinds({ ...fresh, storage: { persisted: true, usage: 80, quota: 100 } }), ['storage-full']);
  assert.deepEqual(kinds({ ...fresh, storage: { persisted: null, usage: 1, quota: 0 } }), [], 'unknown persistence, no quota');
  assert.deepEqual(kinds({ ...fresh, update: { waiting: true } }), ['update']);
});

test('cloud backup: off, paused, behind', () => {
  assert.deepEqual(kinds({ cloud: cloud({ enabled: false }), ...fresh }), ['backup-off']);
  assert.deepEqual(kinds({ cloud: cloud({ enabled: false, movedToEdition: 'pro' }), ...fresh }), [], 'records moved to Pro');
  const paused = A.healthFindings({ cloud: cloud({ paused: true, lastError: { code: 'conflict' } }), ...fresh }, NOW);
  assert.deepEqual(paused.map((f) => [f.kind, f.key, f.code]), [['backup-paused', 'backup-paused:conflict', 'conflict']]);
  assert.deepEqual(kinds({ cloud: cloud({ dirty: true, lastPushedAt: daysAgo(3) }) }), ['backup-behind']);
  assert.deepEqual(kinds({ cloud: cloud({ dirty: false, lastPushedAt: daysAgo(30) }) }), [], 'nothing changed since');
  assert.deepEqual(kinds({ cloud: cloud({ lastPushedAt: null }) }), ['backup-behind'], 'on, never backed up');
});

test('the backup file: only without working cloud backup, after 14 days or never', () => {
  assert.deepEqual(kinds({ lastExportAt: null }), ['export-old']);
  assert.deepEqual(kinds({ lastExportAt: daysAgo(15) }), ['export-old']);
  assert.deepEqual(kinds({ lastExportAt: daysAgo(13) }), []);
  assert.deepEqual(kinds({ lastExportAt: null, cloud: cloud({}) }), [], 'cloud backup covers it');
  assert.deepEqual(kinds({ lastExportAt: null, cloud: cloud({ paused: true, lastError: { code: 'auth' } }) }), ['backup-paused', 'export-old'], 'paused cloud doesn\'t');
});

test('Pro license: grace is a finding; only with the gate on', () => {
  assert.deepEqual(kinds({ ...fresh, license: { gated: true, state: 'grace', record: {} } }), ['license-grace']);
  assert.deepEqual(kinds({ ...fresh, license: { gated: true, state: 'valid', record: {} } }), []);
  assert.deepEqual(kinds({ ...fresh, license: { gated: false, state: 'grace' } }), []);
});

test('a device unseen for 60 days is lost; this one, erased or signed-out-here ones aren\'t', () => {
  const dev = (id, seen, extra = {}) => ({ id, label: id, lastSeenAt: daysAgo(seen), status: 'signed-in', erase: null, thisDevice: false, ...extra });
  const found = A.healthFindings({ ...fresh, devices: [
    dev('old', 61), dev('recent', 59), dev('me', 300, { thisDevice: true }),
    dev('erasing', 300, { erase: { requestedAt: daysAgo(1) } }), dev('gone', 300, { status: 'signed-out-here' })
  ] }, NOW);
  assert.deepEqual(found.map((f) => f.key), ['device-lost:old']);
});

test('Sensitive records: off, locked here, recovery code, passkey', () => {
  const v = (status, extra = {}) => ({ ...fresh, vault: { offered: true, status, unsavedCode: false, ...extra } });
  assert.deepEqual(kinds(v({ enabled: false })), ['vault-off']);
  const on = { enabled: true, unlocked: true, recovery: { createdAt: 'x' }, passkeys: [{ id: 'p' }], passkeySupported: true };
  assert.deepEqual(kinds(v(on)), []);
  assert.deepEqual(kinds(v({ ...on, unlocked: false })), ['vault-locked']);
  assert.deepEqual(kinds(v(on, { unsavedCode: true })), ['recovery-unsaved']);
  assert.deepEqual(kinds(v({ ...on, recovery: null })), ['recovery-unsaved']);
  assert.deepEqual(kinds(v({ ...on, passkeys: [] })), ['passkey-none']);
  assert.deepEqual(kinds(v({ ...on, passkeys: [], passkeySupported: false })), []);
  assert.deepEqual(kinds({ ...fresh, vault: { offered: false, status: { enabled: false } } }), [], 'not offered');
});

test('vendor keys: refused is a finding, unknown isn\'t', () => {
  const found = A.healthFindings({ ...fresh, keys: [
    { account: { id: 'a', name: 'Stripe' }, vendor: 'stripe', ok: false },
    { account: { id: 'b', name: 'Jotform' }, vendor: 'jotform', ok: null },
    { account: { id: 'c', name: 'Other' }, vendor: 'stripe', ok: true }
  ] }, NOW);
  assert.deepEqual(found.map((f) => f.key), ['key-rejected:stripe:a']);
});

test('the waitlist online: signed out, or its last update failed', () => {
  const w = (status) => ({ ...fresh, waitlists: [{ kennel: { id: 'k', kennel_name: 'Thornfield' }, status: { online: true, signedIn: true, lastError: null, ...status } }] });
  assert.deepEqual(kinds(w({ signedIn: false })), ['waitlist-signed-out']);
  assert.deepEqual(kinds(w({ lastError: { code: 'x' } })), ['waitlist-error']);
  assert.deepEqual(kinds(w({})), []);
  assert.deepEqual(kinds(w({ online: false, signedIn: false })), []);
});

test('order: records at risk first', () => {
  const all = kinds({
    lastExportAt: null, update: { waiting: true }, storage: { persisted: false, usage: 90, quota: 100 },
    cloud: cloud({ enabled: false }), vault: { offered: true, status: { enabled: false } }
  });
  assert.deepEqual(all, ['storage-persist', 'backup-off', 'export-old', 'update', 'vault-off', 'storage-full']);
});

test('All good lines say what was checked and is fine', () => {
  const lines = A.healthGoodLines({
    storage: { persisted: true, usage: 5 * 1024 * 1024 },
    cloud: cloud({}),
    license: { gated: true, state: 'valid', record: { interval: 'yearly', expiresAt: '2027-01-02T00:00:00Z' } },
    vault: { offered: true, status: { enabled: true, unlocked: true } },
    keys: [{ account: { name: 'Stripe' }, ok: true }]
  }, (iso) => iso.slice(0, 10));
  assert.deepEqual(lines, [
    'This browser keeps your records safe from clean-ups.',
    'Your records use 5 MB on this device.',
    'Cloud backup is on, last backed up 2026-10-15.',
    'Your Pro license is active and renews 2027-01-02.',
    'Sensitive records are backed up, encrypted.',
    'Stripe is connected and working.'
  ]);
  assert.deepEqual(A.healthGoodLines({ lastExportAt: '2026-10-10T00:00:00Z' }), ['Your last backup file is from 2026-10-10.']);
});

test('bytesText', () => {
  assert.equal(A.bytesText(500), '1 KB');
  assert.equal(A.bytesText(3 * 1024 * 1024), '3 MB');
  assert.equal(A.bytesText(1.5 * 1024 ** 3), '1.5 GB');
});
