// familyDetails.test.js — one person, one set of details (owner, 2026-11-19): a
// family's name, email, phone and address are their contact's once they're linked,
// edited on their waitlist page and the same everywhere; what they first typed stays
// with their answers; a new application from an email she has joins that person.
// (waitlistRules.contactForEmail / familyDetails, waitlistActions.saveEntryEdits.)
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, A, R, P;
before(async () => {
  ({ tables } = await installMemoryDb());
  A = await import('../shared/data/waitlistActions.js');
  R = await import('../shared/data/waitlistRules.js');
  P = await import('../shared/data/waitlistProjection.js');
});

const put = (table, row) => tables[table].rows.set(row.id, { is_archived: false, created_at: '2026-01-01T00:00:00Z', ...row });
const row = (table, id) => tables[table].rows.get(id);
const entry = (id, over = {}) => ({
  id, kennel_id: 'K', status: 'active', applied_date: '2026-10-01', pref_sex: 'any', listen_mode: 'all',
  listen_sire_ids: [], listen_dam_ids: [], ...over
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  put('kennels', { id: 'K', kennel_name: 'Mine', is_own_kennel: true });
});

test('contactForEmail: the one live contact with that address, case and spaces aside', () => {
  const contacts = [
    { id: 'a', name: 'Jenah', email: 'Jenah@Example.com ' },
    { id: 'b', name: 'Gone', email: 'gone@example.com', is_archived: true },
    { id: 'c', name: 'One', email: 'two@example.com' }, { id: 'd', name: 'Two', email: 'TWO@example.com' }
  ];
  assert.equal(R.contactForEmail(' jenah@example.com', contacts)?.id, 'a');
  assert.equal(R.contactForEmail('gone@example.com', contacts), null, 'archived: not her contact any more');
  assert.equal(R.contactForEmail('two@example.com', contacts), null, 'two share it: she picks at approval');
  assert.equal(R.contactForEmail('', contacts), null);
  assert.equal(R.contactForEmail('nobody@example.com', contacts), null);
});

test('familyDetails: the contact\'s once linked, never the application\'s; before that, what they applied with', () => {
  const e = entry('e', { application: { name: 'Jenah R', email: 'old@example.com', phone: '111', location: 'Austin, TX' } });
  const c = { id: 'c', name: 'Jenah Reyes', email: 'new@example.com', phone: '', address: '' };
  assert.deepEqual(R.familyDetails(e, c), { name: 'Jenah Reyes', email: 'new@example.com', phone: '', address: '' }, 'a blank on the contact stays blank: no second copy shows through');
  assert.deepEqual(R.familyDetails(e, null), { name: 'Jenah R', email: 'old@example.com', phone: '111', address: 'Austin, TX' });
});

test('saving the family page changes their details everywhere: the contact, and so every email and code', async () => {
  put('contacts', { id: 'c', name: 'Jenah Reyes', email: 'typo@exmaple.com', phone: '555-0100', address: '1 Elm' });
  put('waitlist_entries', entry('e', { contact_id: 'c', status_token: 't', application: { name: 'Jenah', email: 'typo@exmaple.com' }, notes: '' }));
  await A.saveEntryEdits('e', { notes: 'Called her' }, { name: 'Jenah Reyes', email: ' jenah@example.com ', phone: '555-0100', address: '1 Elm' });
  const c = row('contacts', 'c');
  assert.equal(c.email, 'jenah@example.com');
  assert.equal(c.phone, '555-0100');
  assert.equal(row('waitlist_entries', 'e').notes, 'Called her');
  assert.equal(row('waitlist_entries', 'e').application.email, 'typo@exmaple.com', 'what they first typed stays with their answers');
  assert.equal(P.entryEmail(row('waitlist_entries', 'e'), c), 'jenah@example.com', 'the next "It\'s your turn" and sign-in code go to the new address');
});

test('only what changed is written; a blank name is refused and nothing is saved', async () => {
  put('contacts', { id: 'c', name: 'Jenah', email: 'j@example.com', waitlist_status: 'active', contact_type: ['buyer'], updated_at: 'then' });
  put('waitlist_entries', entry('e', { contact_id: 'c', notes: 'a' }));
  await A.saveEntryEdits('e', { notes: 'b' }, { name: 'Jenah', email: 'j@example.com', phone: '', address: '' });
  assert.equal(row('contacts', 'c').updated_at, 'then', 'nothing changed on the contact: not written');
  await assert.rejects(A.saveEntryEdits('e', { notes: 'c' }, { name: '  ', email: 'j@example.com' }), /Name/);
  assert.equal(row('contacts', 'c').name, 'Jenah');
});

test('not linked yet: details are ignored and the application is what changes', async () => {
  put('waitlist_entries', entry('e', { status: 'applied', application: { name: 'Jenah', email: 'j@example.com' } }));
  await A.saveEntryEdits('e', { application: { name: 'Jenah', email: 'jenah@example.com' } }, { name: 'X', email: 'x@example.com' });
  assert.equal(row('waitlist_entries', 'e').application.email, 'jenah@example.com');
  assert.equal(tables.contacts.rows.size, 0, 'no contact is made by saving');
});
