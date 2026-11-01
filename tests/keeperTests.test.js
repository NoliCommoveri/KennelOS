// keeperTests.test.js — a new dog's planned tests, and the ones a pup just
// marked Keeping is offered (kennelRepo.seedTestsFor / withSeededTests /
// testsToPlan), plus the CSV dog import seeding through the same helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestsFor, withSeededTests, testsToPlan } from '../shared/data/kennelRepo.js';
import { getMapping, commitPlan } from '../shared/data/csvImport.js';

const kennel = {
  id: 'k1', is_own_kennel: true,
  preferred_tests: ['OFA Hips', 'OFA Elbows', 'DM'],
  preferred_test_breeds: { dm: ['German Shepherd'] }
};
const outside = { id: 'k9', is_own_kennel: false, preferred_tests: ['Other'] };

test('seedTestsFor: the seeding kennel\'s panel for the breed, else none', () => {
  assert.deepEqual(seedTestsFor({ ownership_type: 'owned', breed: 'German Shepherd' }, [kennel, outside]), ['OFA Hips', 'OFA Elbows', 'DM']);
  assert.deepEqual(seedTestsFor({ ownership_type: 'owned', breed: 'Poodle' }, [kennel]), ['OFA Hips', 'OFA Elbows']);
  assert.deepEqual(seedTestsFor({ ownership_type: 'external', breed: 'Poodle' }, [kennel]), []);
});

test('withSeededTests: adds the plan, but never over one the fields carry or to a pedigree-only dog', () => {
  assert.deepEqual(withSeededTests({ ownership_type: 'owned', breed: 'Poodle' }, [kennel]).planned_tests, ['OFA Hips', 'OFA Elbows']);
  assert.deepEqual(withSeededTests({ ownership_type: 'owned', planned_tests: ['Eyes'] }, [kennel]).planned_tests, ['Eyes']);
  assert.equal(withSeededTests({ ownership_type: 'owned', pedigree_only: true }, [kennel]).planned_tests, undefined);
  const none = { ownership_type: 'owned' };
  assert.equal(withSeededTests(none, []), none);
});

test('testsToPlan: only the tests a kept pup has no plan for yet (case-insensitive)', () => {
  const pup = { ownership_type: 'owned', kennel_id: 'k1', breed: 'German Shepherd', status: 'puppy', disposition: 'keeping', planned_tests: [' ofa hips'] };
  assert.deepEqual(testsToPlan(pup, [kennel]), ['OFA Elbows', 'DM']);
  assert.deepEqual(testsToPlan({ ...pup, planned_tests: ['OFA Hips', 'OFA Elbows', 'dm'] }, [kennel]), []);
});

test('CSV dog import: a new dog is created with its kennel\'s planned tests', async () => {
  const dogMapping = getMapping('dog');
  const r = dogMapping.classify({
    call_name: 'Rex', sex: 'Male', date_of_birth: '2022-05-04', breed: 'German Shepherd',
    ownership_type: 'Owned', status: 'Active breeding'
  }, dogMapping.buildIndex([]), 0);
  r.record.kennel_id = 'k1';
  const made = [];
  const realRepo = dogMapping.repo;
  const realKennels = dogMapping._allKennels;
  dogMapping.repo = { create: async (rec) => { made.push(rec); return { id: 'd1' }; }, update: async () => ({}) };
  dogMapping._allKennels = [kennel];
  try {
    const res = await commitPlan('dog', [r]);
    assert.equal(res.created, 1);
    assert.deepEqual(made[0].planned_tests, ['OFA Hips', 'OFA Elbows', 'DM']);
  } finally {
    dogMapping.repo = realRepo;
    dogMapping._allKennels = realKennels;
  }
});
