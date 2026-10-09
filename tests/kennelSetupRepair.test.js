// "My kennel" repairs itself when the setting is missing, so Settings shows the
// kennel and the setup wizard edits it instead of creating a duplicate — the
// state a backup restored before importExport's own repair leaves behind.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, ks, settings;

before(async () => {
  ({ tables } = await installMemoryDb());
  ks = await import('../shared/data/kennelSetup.js');
  settings = await import('../shared/data/settings.js');
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
});

const T = '2026-01-01T00:00:00.000Z';
const put = (table, row) => tables[table].rows.set(row.id, { is_archived: false, created_at: T, updated_at: T, ...row });

test('an unset setting adopts the one own kennel', async () => {
  put('kennels', { id: 'old', kennel_name: 'A-K', is_own_kennel: true, is_archived: true });
  put('kennels', { id: 'mine', kennel_name: 'A-K', is_own_kennel: true });
  put('kennels', { id: 'outside', kennel_name: 'Other', is_own_kennel: false });
  assert.equal(await ks.getMyKennelName(), 'A-K');
  assert.equal(settings.getMyKennelId(), 'mine');
});

test('two own kennels and no setting: nothing is guessed', async () => {
  put('kennels', { id: 'a', kennel_name: 'A', is_own_kennel: true });
  put('kennels', { id: 'b', kennel_name: 'B', is_own_kennel: true });
  assert.equal(await ks.getMyKennelName(), null);
  assert.equal(settings.getMyKennelId(), null);
});

test('never adopts the tour kennel while sample data is loaded', async () => {
  put('kennels', { id: 'tour', kennel_name: 'Thornfield', is_own_kennel: true });
  localStorage.setItem('kennelOS.sampleDataManifest', JSON.stringify({ kennels: ['tour'] }));
  assert.equal(await ks.getMyKennelName(), null);
});

test('the wizard edits her kennel and reuses her contact instead of duplicating', async () => {
  put('kennels', { id: 'mine', kennel_name: 'A-K', is_own_kennel: true });
  put('contacts', { id: 'me', name: 'Jenah Carson', kennel_id: 'mine' });
  const { kennel, contact } = await ks.completeKennelSetup({ kennelName: 'A-K Boston Terriers', ownerName: ' jenah carson ' });
  assert.equal(kennel.id, 'mine');
  assert.equal(contact.id, 'me');
  assert.equal(tables.kennels.rows.size, 1);
  assert.equal(tables.contacts.rows.size, 1);
  assert.equal(settings.getMyContactId(), 'me');
});
