// dogSearch.test.js — the one way Kels looks for a dog already on file
// (data/dogSearch.js): names both ways and fuzzy, then the number, breed,
// birthday and sex decide how sure it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDogMatches, nameHit, nameKey, matchReason, similarNamed, looksLikeNumber } from '../shared/data/dogSearch.js';

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
  assert.equal(nameHit('zoey', 'zoe'), 'close');
  assert.equal(nameHit('zoey', 'thornfield zoey mae'), 'partial');
  assert.equal(nameHit('thornfield zoey mae', 'zoey'), 'partial');
  assert.equal(nameHit('bella', 'belle'), 'close');
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

test('then the facts: a number is certain, a breed or birthday likely, a different number doubtful, a different breed another dog', () => {
  const ms = findDogMatches(dogs, { callName: 'Zoey', breed: 'golden retriever', registrationNumber: 'sr-123456/01', sex: 'female' });
  assert.deepEqual(ms.map((m) => [m.dog.id, m.strength]), [['num', 'certain'], ['mae', 'likely'], ['other', 'possible']]);
  assert.equal(matchReason(ms[0]), 'Same registration number');
  assert.equal(matchReason(ms[1]), 'Same breed');
  // A different number is a reason to doubt, not to hide (numbers get mistyped).
  assert.equal(matchReason(ms[2]), 'Different registration number');
  // A different breed is a different dog: Zoe the Whippet isn't offered.
  assert.ok(!ids(ms).includes('zoe'));
  // ...unless the number is the same, which she's told about.
  const same = findDogMatches([{ id: 'w', call_name: 'Rex', breed: 'Whippet', registration_number: 'SR12345601' }], { callName: 'Rex', breed: 'Beagle', registrationNumber: 'SR 123456/01' });
  assert.equal(matchReason(same[0]), 'Same registration number; Different breed');
  assert.equal(same[0].strength, 'possible', 'never taken without her say');
  const bday = findDogMatches(dogs, { callName: 'Zoey', dateOfBirth: '2022-01-01', sex: 'female' });
  assert.equal(bday.find((m) => m.dog.id === 'mae').strength, 'likely');
  assert.deepEqual(ids(findDogMatches(dogs, { callName: 'Zoey', sex: 'female' }, { excludeIds: ['zoe', 'mae'] })), ['other']);
});

test('people: typos, sound-alikes, run-together names, numbers in name boxes, swapped dates', () => {
  for (const [a, b] of [['Zoey', 'Zoie'], ['Khloe', 'Chloe'], ['Thornfeild', 'Thornfield'], ['Golden Retreiver', 'Golden Retriever']]) {
    assert.ok(nameHit(nameKey(a), nameKey(b)), `${a} / ${b}`);
  }
  assert.equal(nameHit(nameKey('MaryLou'), nameKey('Mary Lou')), 'exact');
  assert.equal(nameHit(nameKey('Thornfeild Midnigt Juniper'), nameKey('Thornfield Midnight Juniper')), 'close');
  const on = [
    { id: 'a', call_name: 'Zoey', registered_name: 'SR12345601', sex: 'female', breed: 'Whippet' }, // number typed in the name box
    { id: 'b', call_name: 'Pip', registration_number: 'SR12345609', sex: 'female' }, // one slip off
    { id: 'c', call_name: 'Zoey', sex: 'male', registration_number: 'SR12345601' } // wrong sex, same number
  ];
  const ms = findDogMatches(on, { callName: 'Zoie', registrationNumber: 'sr 123456/01', breed: 'whipet', dateOfBirth: '2022-03-04', sex: 'female' });
  // 'c' has her number but is male: shown, saying so, never certain.
  assert.deepEqual(ms.map((m) => [m.dog.id, m.strength]).sort(), [['a', 'certain'], ['b', 'likely'], ['c', 'possible']]);
  assert.match(matchReason(ms.find((m) => m.dog.id === 'c')), /Different sex/);
  assert.equal(matchReason(ms.find((m) => m.dog.id === 'b')), 'Nearly the same registration number');
  // Day and month swapped, or a few days off, is the same birthday.
  const bd = findDogMatches([{ id: 'd', call_name: 'Zoey', date_of_birth: '2022-04-03', sex: 'female' }], { callName: 'Zoey', dateOfBirth: '2022-03-04' });
  assert.equal(bd[0].strength, 'likely');
  assert.equal(similarNamed([{ n: 'Windmere Goldens' }], 'windmere golden', (x) => x.n).n, 'Windmere Goldens');
  assert.ok(looksLikeNumber('AKC ws-71029304'));
  assert.ok(!looksLikeNumber('Zoey'));
});

test('registration numbers: spaces, slashes, dashes and a typed "AKC" never count', async () => {
  const { normReg } = await import('../shared/data/dogSearch.js');
  for (const n of ['SR 123456/01', 'sr123456-01', 'AKC SR12345601', 'SR 12345601 03-25', ' S R 1 2 3 4 5 6 / 0 1 ']) assert.equal(normReg(n), 'SR12345601', n);
  const ms = findDogMatches([{ id: 'x', call_name: 'Rex', registration_number: 'SR12345601' }], { callName: 'Fido', registrationNumber: 'SR 123456/01' });
  assert.deepEqual(ms.map((m) => [m.dog.id, m.strength]), [['x', 'certain']]);
  // A number typed with a space is one number, not two.
  const none = findDogMatches([{ id: 'y', call_name: 'Pip', registration_number: '12345601' }], { callName: 'Fido', registrationNumber: 'SR 123456/01' });
  assert.ok(!none.some((m) => m.strength === 'certain'));
});

test('breedChoices: her dogs\' breeds and her kennel\'s list, one per breed, her usual spelling', async () => {
  const { breedChoices } = await import('../shared/data/dogSearch.js');
  const dogs = [{ breed: 'Golden Retriever' }, { breed: 'golden  retriever' }, { breed: 'Golden Retriever' }, { breed: ' Whippet ' }, { breed: '' }, {}];
  assert.deepEqual(breedChoices({ dogs, pool: ['GOLDEN RETRIEVER', 'Vizsla'] }), ['Golden Retriever', 'Vizsla', 'Whippet']);
  // Before her first dog: the breeds she picked at setup.
  assert.deepEqual(breedChoices({ pool: ['Boston Terrier'] }), ['Boston Terrier']);
});
