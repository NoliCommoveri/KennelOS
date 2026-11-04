// dogPickerOrder.test.js — the one order every sire/dam and dog picker lists dogs in
// (dogRepo.pickerGroups): her own dogs (owned, co-owned), then other full dogs, then
// pedigree-only ancestors; A–Z by the shown name within each, titles in front ignored.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let pickerGroups;
before(async () => {
  await installMemoryDb();
  ({ pickerGroups } = await import('../shared/data/dogRepo.js'));
});

test('her dogs, then other dogs, then pedigree only, A–Z within each', () => {
  const dogs = [
    { id: 'p1', registered_name: 'NATALY', ownership_type: 'external', pedigree_only: true },
    { id: 'o1', call_name: 'Zara', ownership_type: 'owned' },
    { id: 'x1', call_name: 'Stud Muffin', ownership_type: 'external' },
    { id: 'p2', registered_name: 'BATES’ BLUE BROOKE', ownership_type: 'external', pedigree_only: true },
    { id: 'o2', call_name: 'bijou', ownership_type: 'co_owned' },
    { id: 'x2', call_name: 'Ace', ownership_type: 'leased_in' },
    { id: 'o3', call_name: 'Dolly', ownership_type: 'owned' },
    { id: 'p3', registered_name: 'CH ZEBRA KING', ownership_type: 'external', pedigree_only: true },
    { id: 'o4', call_name: 'Pup 10', ownership_type: 'owned' },
    { id: 'o5', call_name: 'Pup 9', ownership_type: 'owned' }
  ];
  const groups = pickerGroups(dogs, (d) => d.call_name || d.registered_name);
  assert.deepEqual(groups.map((g) => g.label), ['Your dogs', 'Other dogs', 'Pedigree only']);
  assert.deepEqual(groups.map((g) => g.dogs.map((d) => d.id)), [
    ['o2', 'o3', 'o5', 'o4', 'o1'], // case ignored; numbers in order (9 before 10)
    ['x2', 'x1'],
    ['p2', 'p1', 'p3'] // "CH ZEBRA KING" sorts under Z
  ]);
});

test('empty groups are left out', () => {
  const groups = pickerGroups([{ id: 'a', call_name: 'A', ownership_type: 'owned' }], (d) => d.call_name);
  assert.deepEqual(groups.map((g) => g.key), ['own']);
});
