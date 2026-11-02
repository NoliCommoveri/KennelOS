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

// --- One rule for "the same dog?" everywhere -----------------------------------

const akc = { id: 'a', call_name: 'Bella', sex: 'female', breed: 'Beagle', registry: 'AKC', registration_number: 'SR12345601', registered_name: 'CH Maple Bella' };
const ukcOnly = { id: 'b', call_name: 'Belle', sex: 'female', breed: 'Beagle', registry: 'UKC', registration_number: 'P1048221' };

test('shared helpers: any number or registered name in common; numbers conflict only within a registry', () => {
  const both = { ...akc, additional_registrations: [{ registry: 'UKC', registration_number: 'P1048-221', registered_name: 'Maple Belle' }] };
  assert.deepEqual(S.dogRegKeys(both), ['SR12345601', 'P1048221']);
  assert.deepEqual(S.dogNameKeys(both), ['maple bella', 'maple belle']);
  assert.equal(S.sameRegistration(both, ukcOnly), true);
  assert.equal(S.sameRegisteredName({ registered_name: 'Maple Belle' }, both), true);
  // AKC on one, UKC on the other: says nothing.
  assert.equal(S.registrationsConflict(akc, ukcOnly), false);
  // The same registry, or one not given, with different numbers: a different dog.
  assert.equal(S.registrationsConflict(akc, { registry: 'akc', registration_number: 'SR99999901' }), true);
  assert.equal(S.registrationsConflict(akc, { registration_number: 'SR99999901' }), true);
  assert.equal(S.registrationsConflict(akc, {}), false);
});

test('tidy-up, duplicate scan, restore and Kels all pair by an additional registration', async () => {
  const T = await import('../shared/data/tidyRules.js');
  const D = await import('../shared/data/duplicateScan.js');
  const R = await import('../shared/data/restoreMatch.js');
  const both = { ...akc, created_at: '2026-01-01', additional_registrations: [{ registry: 'UKC', registration_number: 'P1048-221' }] };
  const other = { ...ukcOnly, created_at: '2026-01-02' };
  assert.equal(T.compareDogs(both, other)?.strength, 'certain');
  assert.equal(T.duplicateDogFindings([both, other]).length, 1);
  const found = D.findDuplicates({ rows: { dogs: [both, other] }, flags: { contactsSection: true } }).filter((f) => f.table === 'dogs');
  assert.equal(found.length, 1);
  assert.equal(found[0].strength, 'certain');
  assert.ok(found[0].shared.includes('registration number'));
  assert.equal(R.MATCH_RULES.dogs(both, other, { fk: (x) => x }), 'same');
  // AKC vs UKC numbers alone never rule a pair out; a second AKC number does.
  assert.equal(R.dogNever(akc, ukcOnly, { fk: (x) => x }), false);
  assert.equal(R.dogNever(akc, { ...ukcOnly, registry: 'AKC' }, { fk: (x) => x }), true);
  // A registered name from an additional registration.
  const byName = { id: 'c', sex: 'female', registered_name: 'Maple Belle' };
  const withName = { ...akc, additional_registrations: [{ registry: 'UKC', registration_number: 'P1', registered_name: 'Maple Belle' }] };
  assert.equal(T.compareDogs(withName, byName)?.strength, 'certain');
  assert.equal(S.findDogMatches([withName], { registeredName: 'Maple Belle' })[0]?.dog.id, 'a');
});
