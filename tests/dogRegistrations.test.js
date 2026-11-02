// dogRegistrations.test.js — a dog's additional registrations
// (Dog.additional_registrations): normalized on write, searchable by number,
// and kept whole when two dogs are merged.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, repo, M, S;
before(async () => {
  ({ tables } = await installMemoryDb());
  repo = await import('../shared/data/dogRepo.js');
  M = await import('../shared/data/recordMerge.js');
  S = await import('../shared/data/dogSearch.js');
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  tables.kennels.rows.set('K', { id: 'K', kennel_name: 'Mine', is_own_kennel: true, is_archived: false });
});

const base = { call_name: 'Bella', sex: 'female', breed: 'Beagle', ownership_type: 'owned', status: 'active_breeding', kennel_id: 'K' };

test('normalizeRegistrations trims and drops empty entries', () => {
  assert.deepEqual(repo.normalizeRegistrations([
    { registry: ' UKC ', registration_number: ' P123 ' },
    { registry: '', registration_number: '', registered_name: 'x' },
    null
  ]), [{ registry: 'UKC', registration_number: 'P123', registered_name: '' }]);
  assert.deepEqual(repo.normalizeRegistrations(undefined), []);
});

test('create and update normalize additional_registrations; an update without it leaves it alone', async () => {
  const d = await repo.dogRepo.create({ ...base, additional_registrations: [{ registry: 'UKC', registration_number: ' P1 ' }, { registry: '' }] });
  assert.deepEqual(d.additional_registrations, [{ registry: 'UKC', registration_number: 'P1', registered_name: '' }]);
  await repo.dogRepo.update(d.id, { notes: 'hi' });
  assert.equal((await repo.dogRepo.getById(d.id)).additional_registrations.length, 1);
  await repo.dogRepo.update(d.id, { additional_registrations: [{ registry: 'CKC', registration_number: 'C9', registered_name: 'Bella of Maple' }] });
  assert.deepEqual((await repo.dogRepo.getById(d.id)).additional_registrations, [{ registry: 'CKC', registration_number: 'C9', registered_name: 'Bella of Maple' }]);
});

test('dogRegistrationNumbers lists the main number first, then the others; matching finds a dog by either', () => {
  const dog = { id: 'd', call_name: 'Bella', sex: 'female', registration_number: 'SR12345601', additional_registrations: [{ registry: 'UKC', registration_number: 'P1048221' }] };
  assert.deepEqual(S.dogRegistrationNumbers(dog), ['SR12345601', 'P1048221']);
  assert.deepEqual(S.dogRegistrationNumbers({}), []);
  const hits = S.findDogMatches([dog], { registrationNumber: 'P1048221' });
  assert.equal(hits[0]?.dog?.id ?? hits[0]?.id, 'd');
});

test('a merge keeps every registration either dog held, each once', () => {
  const keep = { id: 'a', registry: 'AKC', registration_number: 'SR12345601', additional_registrations: [{ registry: 'UKC', registration_number: 'P-1', registered_name: '' }] };
  const drop = { id: 'b', registry: 'AKC', registration_number: 'SR 123456/01', additional_registrations: [{ registry: 'ukc', registration_number: 'P1', registered_name: '' }, { registry: 'CKC', registration_number: 'C9', registered_name: '' }] };
  assert.deepEqual(M.mergedChanges('dog', keep, drop).additional_registrations,
    [...keep.additional_registrations, { registry: 'CKC', registration_number: 'C9', registered_name: '' }]);
  // Taking the other dog's main registration moves the kept one into the list.
  const k2 = { id: 'a', registry: 'AKC', registration_number: 'SR1' };
  const d2 = { id: 'b', registry: 'UKC', registration_number: 'P2' };
  const ch = M.mergedChanges('dog', k2, d2, { registry: 'drop', registration_number: 'drop' });
  assert.equal(ch.registration_number, 'P2');
  assert.deepEqual(ch.additional_registrations, [{ registry: 'AKC', registration_number: 'SR1', registered_name: '' }]);
  // Nothing to add → no change.
  assert.equal('additional_registrations' in M.mergedChanges('dog', { id: 'a' }, { id: 'b' }), false);
});
