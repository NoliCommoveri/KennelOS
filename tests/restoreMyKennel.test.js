// A file restore points "My kennel" (the nav banner) at the restored own kennel.
// The setting lives in localStorage, not in the backup, so a backup restored on a
// new browser — or a Replace that wipes the kennel the setting named — would
// otherwise leave the app with no kennel name across the top.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, ie, settings;

before(async () => {
  ({ tables } = await installMemoryDb());
  ie = await import('../shared/data/importExport.js');
  settings = await import('../shared/data/settings.js');
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
});

const T = '2026-01-01T00:00:00.000Z';
const kennel = (id, extra = {}) => ({ id, kennel_name: id, is_archived: false, created_at: T, updated_at: T, ...extra });
const backup = (kennels) => ({ schema_version: 1, collections: { kennels } });

test('restore on a fresh browser sets My kennel to the restored own kennel', async () => {
  await ie.restoreBackup(backup([kennel('outside', { is_own_kennel: false }), kennel('old', { is_own_kennel: true, is_archived: true }), kennel('mine', { is_own_kennel: true })]), 'replace');
  assert.equal(settings.getMyKennelId(), 'mine');
});

test('a replace that wipes the kennel My kennel named repoints it', async () => {
  settings.setMyKennelId('gone');
  await ie.restoreBackup(backup([kennel('mine', { is_own_kennel: true })]), 'replace');
  assert.equal(settings.getMyKennelId(), 'mine');
});

test('a My kennel that still resolves is left alone', async () => {
  settings.setMyKennelId('second');
  await ie.restoreBackup(backup([kennel('first', { is_own_kennel: true }), kennel('second', { is_own_kennel: true })]), 'merge');
  assert.equal(settings.getMyKennelId(), 'second');
});

test('no own kennel in the file leaves the setting unset', async () => {
  await ie.restoreBackup(backup([kennel('outside', { is_own_kennel: false })]), 'replace');
  assert.equal(settings.getMyKennelId(), null);
});
