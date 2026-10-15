// recordMerge.test.js — merging two records for one dog or one person
// (data/recordMerge.js): what the kept record ends up with, that every row
// pointing at the other one now points at the kept one, and when it refuses.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, M;
before(async () => {
  ({ tables } = await installMemoryDb());
  M = await import('../shared/data/recordMerge.js');
});

const put = (table, row) => tables[table].rows.set(row.id, { is_archived: false, created_at: '2026-01-01T00:00:00Z', ...row });
const row = (table, id) => tables[table].rows.get(id);

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  put('kennels', { id: 'K', kennel_name: 'Mine', is_own_kennel: true });
});

test('conflicts list only fields both records have and disagree on; ownership is one choice', () => {
  const keep = { id: 'a', call_name: 'Bella', registered_name: 'CH Bella', ownership_type: 'owned', status: 'active_breeding', kennel_id: 'K' };
  const drop = { id: 'b', call_name: 'Bella', registered_name: 'Bella of X', microchip_id: '985', ownership_type: 'external', status: 'external_reference', pedigree_only: true };
  assert.deepEqual(M.mergeConflicts('dog', keep, drop).map((c) => c.key), ['registered_name', 'ownership']);
  const ch = M.mergedChanges('dog', keep, drop, { registered_name: 'drop' });
  assert.deepEqual(ch, { registered_name: 'Bella of X', microchip_id: '985' });
  assert.equal(M.suggestKeep(drop, keep), keep); // the one in use beats pedigree-only
});

test('lists are joined, notes kept from both, and the owner never also a co-owner', () => {
  const ch = M.mergedChanges('dog',
    { id: 'a', owner_contact_id: 'c1', co_owner_contact_ids: ['c2'], planned_tests: ['OFA'], notes: 'one' },
    { id: 'b', co_owner_contact_ids: ['c1', 'c3'], planned_tests: ['ofa', 'PRA'], notes: 'two' });
  assert.deepEqual(ch.co_owner_contact_ids, ['c2', 'c3']);
  assert.deepEqual(ch.planned_tests, ['OFA', 'ofa', 'PRA']);
  assert.equal(ch.notes, 'one\n\ntwo');
});

test('merging dogs moves every reference to the kept dog and archives the other', async () => {
  put('dogs', { id: 'keep', call_name: 'Bella', sex: 'female', breed: 'Boston', ownership_type: 'owned', status: 'active_breeding', kennel_id: 'K' });
  put('dogs', { id: 'dup', call_name: 'Bella', sex: 'female', breed: 'Boston', ownership_type: 'external', status: 'external_reference', pedigree_only: true, registration_number: 'R1' });
  put('dogs', { id: 'pup', call_name: 'Pup', sex: 'male', breed: 'Boston', ownership_type: 'owned', status: 'puppy', kennel_id: 'K', dam_id: 'dup' });
  put('litters', { id: 'L', sire_id: 'S', dam_id: 'dup', status: 'whelped', kennel_id: 'K' });
  put('events', { id: 'e', subject_type: 'dog', subject_id: 'dup', event_type: 'heat_cycle', event_date: '2026-01-01', title: 'Heat' });
  put('events', { id: 'e2', subject_type: 'litter', subject_id: 'dup', event_type: 'note', event_date: '2026-01-01', title: 'Not a dog' });
  put('waitlist_offers', { id: 'o', eligible_dog_ids: ['dup', 'keep'], chosen_dog_id: 'dup' });

  const { moved } = await M.mergeRecords('dog', 'keep', 'dup');
  assert.equal(moved, 5);
  assert.equal(row('dogs', 'pup').dam_id, 'keep');
  assert.equal(row('litters', 'L').dam_id, 'keep');
  assert.equal(row('events', 'e').subject_id, 'keep');
  assert.equal(row('events', 'e2').subject_id, 'dup'); // a litter's event, untouched
  assert.deepEqual(row('waitlist_offers', 'o').eligible_dog_ids, ['keep']);
  assert.equal(row('waitlist_offers', 'o').chosen_dog_id, 'keep');
  assert.equal(row('dogs', 'keep').registration_number, 'R1'); // filled in from the other
  assert.equal(row('dogs', 'keep').ownership_type, 'owned');   // ownership kept
  assert.equal(row('dogs', 'dup').is_archived, true);
});

test('refuses a dog that is in the other\'s pedigree, or of the other sex', async () => {
  put('dogs', { id: 'gran', call_name: 'Rose', sex: 'female', breed: 'Boston', ownership_type: 'external', status: 'external_reference', pedigree_only: true });
  put('dogs', { id: 'mom', call_name: 'Lily', sex: 'female', breed: 'Boston', ownership_type: 'external', status: 'external_reference', pedigree_only: true, dam_id: 'gran' });
  put('dogs', { id: 'me', call_name: 'Rose', sex: 'female', breed: 'Boston', ownership_type: 'owned', status: 'active_breeding', kennel_id: 'K', dam_id: 'mom' });
  await assert.rejects(M.mergeRecords('dog', 'me', 'gran'), /pedigree/);
  put('dogs', { id: 'boy', call_name: 'Rose', sex: 'male', breed: 'Boston', ownership_type: 'owned', status: 'active_breeding', kennel_id: 'K' });
  await assert.rejects(M.mergeRecords('dog', 'me', 'boy'), /male/);
  assert.equal(row('dogs', 'gran').is_archived, false);
});

test('merging contacts moves sales, ownership and waitlist places, and joins their roles', async () => {
  put('contacts', { id: 'c1', name: 'Mary Smith', phone: '555', contact_type: ['buyer'] });
  put('contacts', { id: 'c2', name: 'Mary Smith', email: 'm@x.com', contact_type: ['breeder'] });
  put('dogs', { id: 'd', call_name: 'Max', sex: 'male', breed: 'Boston', ownership_type: 'co_owned', status: 'active_breeding', kennel_id: 'K', owner_contact_id: 'c1', co_owner_contact_ids: ['c2'] });
  put('sales', { id: 's', dog_id: 'd', buyer_contact_id: 'c2', status: 'delivered', kennel_id: 'K' });
  put('waitlist_entries', { id: 'w', contact_id: 'c2', kennel_id: 'K', status: 'placed' });

  await M.mergeRecords('contact', 'c1', 'c2');
  const c1 = row('contacts', 'c1');
  assert.deepEqual([c1.email, c1.contact_type], ['m@x.com', ['buyer', 'breeder']]);
  assert.equal(row('sales', 's').buyer_contact_id, 'c1');
  assert.deepEqual(row('dogs', 'd').co_owner_contact_ids, []); // c1 owns it; not also a co-owner
  assert.equal(row('waitlist_entries', 'w').contact_id, 'c1');
  assert.equal(c1.waitlist_status, 'fulfilled'); // recomputed from the moved entry
  assert.equal(row('contacts', 'c2').is_archived, true);
});

test('refuses two contacts who both hold a live place on the same waitlist', async () => {
  put('contacts', { id: 'c1', name: 'A' });
  put('contacts', { id: 'c2', name: 'A' });
  put('waitlist_entries', { id: 'w1', contact_id: 'c1', kennel_id: 'K', status: 'active' });
  put('waitlist_entries', { id: 'w2', contact_id: 'c2', kennel_id: 'K', status: 'applied' });
  await assert.rejects(M.mergeRecords('contact', 'c1', 'c2'), /waitlist/);
});
