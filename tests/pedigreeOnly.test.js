// pedigreeOnly.test.js — pedigree-only dogs (ancestors kept for lineage) stay out
// of every default dog list and every roster count, save without an owner, and
// can only be pedigree-only while `external` (dogRepo.js, rosterCount.js).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, dogRepo, isActiveRosterDog;

before(async () => {
  ({ tables } = await installMemoryDb());
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ isActiveRosterDog } = await import('../shared/data/rosterCount.js'));
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
});

const ancestor = (extra = {}) => ({
  call_name: 'CH Old Sire', registered_name: 'CH Old Sire', sex: 'male', breed: 'Labrador Retriever',
  ownership_type: 'external', status: 'external_reference', pedigree_only: true, ...extra
});

test('a pedigree-only dog saves with no owner contact', async () => {
  const d = await dogRepo.create(ancestor());
  assert.equal(d.pedigree_only, true);
});

test('an ordinary external dog still needs an owner', async () => {
  await assert.rejects(dogRepo.create(ancestor({ pedigree_only: false })), /owner_contact_id is required/);
});

test('pedigree-only requires ownership external', async () => {
  await assert.rejects(dogRepo.create(ancestor({ ownership_type: 'owned', kennel_id: 'k1' })), /must have ownership "external"/);
});

test('getAll leaves pedigree-only dogs out unless asked; getById still finds them', async () => {
  const anc = await dogRepo.create(ancestor());
  tables.dogs.rows.set('own', { id: 'own', call_name: 'Bella', sex: 'female', breed: 'Lab', ownership_type: 'external', owner_contact_id: 'c', status: 'external_reference', is_archived: false });
  assert.deepEqual((await dogRepo.getAll()).map((d) => d.id), ['own']);
  assert.deepEqual((await dogRepo.getAll({ includeArchived: true })).map((d) => d.id), ['own']);
  assert.equal((await dogRepo.getAll({ includePedigreeOnly: true })).length, 2);
  assert.equal((await dogRepo.getById(anc.id)).id, anc.id);
});

test('a pedigree-only dog never counts toward the roster', () => {
  assert.equal(isActiveRosterDog({ ownership_type: 'owned', status: 'active_breeding', pedigree_only: true }), false);
  assert.equal(isActiveRosterDog({ ownership_type: 'owned', status: 'active_breeding' }), true);
});
