// dogSearch.test.js — the one way Kels looks for a dog already on file
// (data/dogSearch.js): names both ways and fuzzy, then the number, breed,
// birthday and sex decide how sure it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDogMatches, nameHit, nameKey, matchReason } from '../shared/data/dogSearch.js';

const dogs = [
  { id: 'zoe', call_name: 'Zoe', sex: 'female', breed: 'Whippet' },
  { id: 'mae', call_name: '', registered_name: 'GCH Thornfield Zoey Mae', sex: 'female', breed: 'Golden Retriever', date_of_birth: '2022-01-01', pedigree_only: true },
  { id: 'boy', call_name: 'Zoey', sex: 'male' },
  { id: 'num', call_name: 'Rex', registration_number: 'AKC SR12345601', sex: 'female' },
  { id: 'old', call_name: 'Zoey', sex: 'female', is_archived: true },
  { id: 'other', call_name: 'Zoey', registration_number: 'SR99999901', sex: 'female' }
];
const ids = (ms) => ms.map((m) => m.dog.id);

test('names: titles, case and punctuation ignored; whole words, nearly the same, either way', () => {
  assert.equal(nameKey('GCH CH Thornfield Zoey-Mae'), 'thornfield zoey mae');
  assert.equal(nameHit('zoey', 'zoey'), 'exact');
  assert.equal(nameHit('zoey', 'zoe'), 'partial');
  assert.equal(nameHit('zoey', 'thornfield zoey mae'), 'partial');
  assert.equal(nameHit('thornfield zoey mae', 'zoey'), 'partial');
  assert.equal(nameHit('bella', 'belle'), 'partial');
  assert.equal(nameHit('daisy', 'dahlia'), null);
  assert.equal(nameHit('max', 'maximus'), null);
});

test('a call name finds call and registered names; the sex has to fit; archived never', () => {
  assert.deepEqual(ids(findDogMatches(dogs, { callName: 'Zoey', sex: 'female' })).sort(), ['mae', 'other', 'zoe']);
  // A registered name typed finds a dog by its call name too (not one whose
  // registered name has other words: "Ridgeline Zoe" isn't "Thornfield Zoey Mae").
  assert.deepEqual(ids(findDogMatches(dogs, { registeredName: 'Ch Ridgeline Zoe', sex: 'female' })).sort(), ['other', 'zoe']);
  assert.deepEqual(findDogMatches(dogs, { callName: 'Z', sex: 'female' }), []);
});

test('then the facts: a number is certain, a breed or birthday likely, a different number never', () => {
  const ms = findDogMatches(dogs, { callName: 'Zoey', breed: 'golden retriever', registrationNumber: 'sr-123456/01', sex: 'female' });
  assert.deepEqual(ms.map((m) => [m.dog.id, m.strength]), [['num', 'certain'], ['mae', 'likely'], ['zoe', 'possible']]);
  assert.equal(matchReason(ms[0]), 'Same registration number');
  assert.equal(matchReason(ms[1]), 'Same breed');
  assert.equal(matchReason(ms[2]), 'Different breed');
  // 'other' has a different number: a different dog, never offered.
  assert.ok(!ids(ms).includes('other'));
  const bday = findDogMatches(dogs, { callName: 'Zoey', dateOfBirth: '2022-01-01', sex: 'female' });
  assert.equal(bday.find((m) => m.dog.id === 'mae').strength, 'likely');
  assert.deepEqual(ids(findDogMatches(dogs, { callName: 'Zoey', sex: 'female' }, { excludeIds: ['zoe', 'mae'] })), ['other']);
});
