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

test('a deleted owner contact is replaced by the one contact linked to her kennel', async () => {
  put('kennels', { id: 'mine', kennel_name: 'A-K', is_own_kennel: true });
  put('contacts', { id: 'new-me', name: 'Jenah Carson', kennel_id: 'mine' });
  put('contacts', { id: 'buyer', name: 'A Buyer' });
  settings.setMyContactId('gone');
  assert.equal(await ks.resolveMyContactId(), 'new-me');
  assert.equal(settings.getMyContactId(), 'new-me');
});

test('an archived owner contact is replaced; an unset one is adopted', async () => {
  put('kennels', { id: 'mine', kennel_name: 'A-K', is_own_kennel: true });
  put('contacts', { id: 'old-me', name: 'Jenah', kennel_id: 'mine', is_archived: true });
  put('contacts', { id: 'new-me', name: 'Jenah Carson', kennel_id: 'mine' });
  settings.setMyContactId('old-me');
  assert.equal(await ks.resolveMyContactId(), 'new-me');
  localStorage.clear();
  assert.equal(await ks.resolveMyContactId(), 'new-me');
});

test('a live owner contact is kept; two linked contacts and no setting guess nothing', async () => {
  put('kennels', { id: 'mine', kennel_name: 'A-K', is_own_kennel: true });
  put('contacts', { id: 'me', name: 'Jenah', kennel_id: 'mine' });
  put('contacts', { id: 'co', name: 'Co-owner', kennel_id: 'mine' });
  settings.setMyContactId('me');
  assert.equal(await ks.resolveMyContactId(), 'me');
  localStorage.clear();
  assert.equal(await ks.resolveMyContactId(), null);
  assert.equal(settings.getMyContactId(), null);
});

test('never adopts a tour contact while sample data is loaded', async () => {
  put('kennels', { id: 'tour', kennel_name: 'Thornfield', is_own_kennel: true });
  put('contacts', { id: 'tour-owner', name: 'Tour Owner', kennel_id: 'tour' });
  localStorage.setItem('kennelOS.sampleDataManifest', JSON.stringify({ kennels: ['tour'] }));
  assert.equal(await ks.resolveMyContactId(), null);
});

test('the wizard adopts her contact by name when the stored owner was deleted', async () => {
  put('kennels', { id: 'mine', kennel_name: 'A-K', is_own_kennel: true });
  put('contacts', { id: 'me', name: 'Jenah Carson', kennel_id: 'mine' });
  put('contacts', { id: 'co', name: 'Co-owner', kennel_id: 'mine' });
  settings.setMyContactId('gone');
  const { contact } = await ks.completeKennelSetup({ kennelName: 'A-K', ownerName: 'Jenah Carson' });
  assert.equal(contact.id, 'me');
  assert.equal(tables.contacts.rows.size, 2);
  assert.equal(settings.getMyContactId(), 'me');
});
