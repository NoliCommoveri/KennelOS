// rosterCount.test.js — the active-roster classification and the import-cap set
// math (data/rosterCount.js). This is the counting logic behind BOTH the Lite
// interactive dog cap and the JSON-restore import cap (cap spec §2 / §9), so it's
// the highest-value thing to pin down against regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isActiveRosterDog,
  countActiveRosterDogs,
  dogsAfterImport,
  ACTIVE_ROSTER_OWNERSHIP,
  ACTIVE_ROSTER_ADULT_STATUS,
} from '../shared/data/rosterCount.js';

// A live, owned, active-breeding adult — the canonical "counts" dog.
const dog = (over = {}) => ({
  id: over.id ?? crypto.randomUUID(),
  ownership_type: 'owned',
  status: 'active_breeding',
  is_archived: false,
  ...over,
});

test('isActiveRosterDog: a live owned/co-owned adult counts', () => {
  assert.equal(isActiveRosterDog(dog()), true);
  assert.equal(isActiveRosterDog(dog({ ownership_type: 'co_owned' })), true);
  assert.equal(isActiveRosterDog(dog({ status: 'retired_breeding' })), true);
});

test('isActiveRosterDog: pet_home/for_sale count defensively (import can carry them)', () => {
  // A Lite user can never select these, but a Pro backup imported into Lite can
  // carry them and they must still count rather than slip the cap (cap spec §1a).
  assert.equal(isActiveRosterDog(dog({ status: 'pet_home' })), true);
  assert.equal(isActiveRosterDog(dog({ status: 'for_sale' })), true);
});

test('isActiveRosterDog: puppies, deceased, external, and archived never count', () => {
  assert.equal(isActiveRosterDog(dog({ status: 'puppy' })), false);
  assert.equal(isActiveRosterDog(dog({ status: 'deceased' })), false);
  assert.equal(isActiveRosterDog(dog({ status: 'external_reference' })), false);
  assert.equal(isActiveRosterDog(dog({ ownership_type: 'external' })), false);
  assert.equal(isActiveRosterDog(dog({ ownership_type: 'leased_in' })), false);
  assert.equal(isActiveRosterDog(dog({ is_archived: true })), false, 'archived = departed = uncounted');
});

test('isActiveRosterDog: tolerates missing/garbage records', () => {
  assert.equal(isActiveRosterDog(null), false);
  assert.equal(isActiveRosterDog(undefined), false);
  assert.equal(isActiveRosterDog({}), false);
});

test('the counted sets match the cap spec vocabulary exactly', () => {
  // A change here is a deliberate policy change — this asserts the current policy.
  assert.deepEqual([...ACTIVE_ROSTER_OWNERSHIP].sort(), ['co_owned', 'owned']);
  assert.deepEqual(
    [...ACTIVE_ROSTER_ADULT_STATUS].sort(),
    ['active_breeding', 'for_sale', 'pet_home', 'retired_breeding']
  );
});

test('countActiveRosterDogs: counts only the counting dogs, honoring excludeId', () => {
  const dogs = [
    dog({ id: 'a' }),
    dog({ id: 'b', ownership_type: 'co_owned' }),
    dog({ id: 'c', status: 'puppy' }),      // not counted
    dog({ id: 'd', is_archived: true }),    // not counted
  ];
  assert.equal(countActiveRosterDogs(dogs), 2);
  assert.equal(countActiveRosterDogs(dogs, 'a'), 1, 'excludeId drops one counting dog');
  assert.equal(countActiveRosterDogs(dogs, 'c'), 2, 'excluding a non-counting dog changes nothing');
});

test('dogsAfterImport replace: the table becomes exactly the incoming rows', () => {
  const existing = [dog({ id: 'x' }), dog({ id: 'y' })];
  const incoming = [dog({ id: 'z' })];
  const after = dogsAfterImport(existing, incoming, 'replace');
  assert.deepEqual(after.map((d) => d.id), ['z']);
});

test('dogsAfterImport merge: incoming upserts by id over existing', () => {
  const existing = [dog({ id: 'x' }), dog({ id: 'y', status: 'active_breeding' })];
  const incoming = [dog({ id: 'y', status: 'deceased' }), dog({ id: 'z' })];
  const after = dogsAfterImport(existing, incoming, 'merge');
  assert.deepEqual(after.map((d) => d.id).sort(), ['x', 'y', 'z']);
  const y = after.find((d) => d.id === 'y');
  assert.equal(y.status, 'deceased', 'the incoming row wins on a matching id');
});

// --- The import-cap decision (mirrors lite/editionConfig.enforceImportDogCap) --
// lite/editionConfig.js can't be imported directly (its ./db.js import only
// resolves inside an assembled dist/), so we assert the exact math its hook runs:
//   resulting = countActiveRosterDogs(dogsAfterImport(existing, incoming, mode))
//   reject when resulting > cap
const CAP = 6;
function wouldReject(existing, incoming, mode) {
  const base = mode === 'merge' ? existing : [];
  return countActiveRosterDogs(dogsAfterImport(base, incoming, mode)) > CAP;
}

test('import cap: a legitimate ≤6 backup restores (replace)', () => {
  const backup = Array.from({ length: 6 }, (_, i) => dog({ id: `d${i}` }));
  assert.equal(wouldReject([], backup, 'replace'), false);
});

test('import cap: a >6-active backup is rejected (replace), regardless of current data', () => {
  const backup = Array.from({ length: 7 }, (_, i) => dog({ id: `d${i}` }));
  assert.equal(wouldReject([], backup, 'replace'), true);
  // Non-counting rows in the backup don't push it over: 6 adults + puppies is fine.
  const mixed = [
    ...Array.from({ length: 6 }, (_, i) => dog({ id: `a${i}` })),
    ...Array.from({ length: 10 }, (_, i) => dog({ id: `p${i}`, status: 'puppy' })),
  ];
  assert.equal(wouldReject([], mixed, 'replace'), false, 'puppies never trip the cap');
});

test('import cap: merge counts the RESULTING union, not just the incoming rows', () => {
  const existing = Array.from({ length: 5 }, (_, i) => dog({ id: `e${i}` }));
  // Two brand-new adults on top of 5 existing → 7 → reject.
  const addTwoNew = [dog({ id: 'n1' }), dog({ id: 'n2' })];
  assert.equal(wouldReject(existing, addTwoNew, 'merge'), true);
  // One brand-new adult → 6 → allowed.
  assert.equal(wouldReject(existing, [dog({ id: 'n1' })], 'merge'), false);
  // Overwriting an existing adult in-place (same id) doesn't grow the roster.
  assert.equal(wouldReject(existing, [dog({ id: 'e0', status: 'retired_breeding' })], 'merge'), false);
  // A merge that DEPARTS existing dogs (archives them) can even shrink it.
  const departFour = existing.slice(0, 4).map((d) => ({ ...d, is_archived: true }));
  assert.equal(wouldReject(existing, [...departFour, dog({ id: 'n1' }), dog({ id: 'n2' }), dog({ id: 'n3' })], 'merge'), false);
});
