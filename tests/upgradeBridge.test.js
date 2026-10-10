// The Lite→Pro bridge's cloud-first test (Editions Plan, "After the vault"):
// the file is skipped only when cloud backup holds everything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdsEverything } from '../shared/data/cloud/cloudBackup.js';

const status = {
  enabled: true, paused: false, dirty: false, lastPushedAt: '2026-10-10T12:00:00Z',
  vault: 'on', vaultPushedAt: '2026-10-10T12:00:00Z'
};
const vault = { enabled: true, unlocked: true };

test('complete when backup and Sensitive records are on, unlocked and up to date', () => {
  assert.equal(holdsEverything(status, vault), true);
});

test('not complete when anything is missing', () => {
  for (const patch of [
    { enabled: false }, { paused: true }, { dirty: true }, { lastPushedAt: null },
    { vault: 'locked' }, { vault: 'off' }, { vaultPushedAt: null }
  ]) {
    assert.equal(holdsEverything({ ...status, ...patch }, vault), false, JSON.stringify(patch));
  }
  assert.equal(holdsEverything(status, { enabled: false, unlocked: false }), false);
  assert.equal(holdsEverything(status, { enabled: true, unlocked: false }), false);
  assert.equal(holdsEverything(status, null), false);
  assert.equal(holdsEverything(null, vault), false);
});
