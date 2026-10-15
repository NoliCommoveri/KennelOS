// tidyRules.test.js — Kels's "Tidy up my records" checks (data/tidyRules.js):
// each finding fires on the records that disagree and stays quiet otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../shared/data/tidyRules.js';

const today = '2026-10-15';
const litter = (extra = {}) => ({ id: 'L', status: 'whelped', sire_id: 'S', dam_id: 'D', kennel_id: 'K', ...extra });
const pup = (id, extra = {}) => ({ id, litter_id: 'L', status: 'puppy', ownership_type: 'owned', sire_id: 'S', dam_id: 'D', call_name: id, breed: 'Boston', sex: 'male', ...extra });
const kinds = (list) => list.map((f) => f.kind);

test('litter count: compares born alive (or total less deceased) with every pup record, departed and deceased too', () => {
  const dogs = [pup('a'), pup('b', { is_archived: true }), pup('c', { status: 'deceased' })];
  assert.equal(T.litterCountFindings([litter({ puppies_born_alive: 3 })], dogs).length, 0);
  assert.equal(T.litterCountFindings([litter({ puppies_born_total: 4, puppies_born_deceased: 1 })], dogs).length, 0);
  const [fewer] = T.litterCountFindings([litter({ puppies_born_alive: 5 })], dogs);
  assert.deepEqual([fewer.recorded, fewer.actual, fewer.more], [5, 3, false]);
  const [more] = T.litterCountFindings([litter({ puppies_born_total: 2 })], dogs);
  assert.equal(more.more, true);
  // No count entered, or not born yet: nothing to compare.
  assert.equal(T.litterCountFindings([litter(), litter({ id: 'E', status: 'expected', puppies_born_alive: 4 })], dogs).length, 0);
});

test('litter count fix: alive becomes the records, and the total follows when it no longer adds up', () => {
  assert.deepEqual(T.countFix({ puppies_born_alive: 5 }, 3), { puppies_born_alive: 3 });
  assert.deepEqual(T.countFix({ puppies_born_total: 6, puppies_born_deceased: 1 }, 3), { puppies_born_alive: 3, puppies_born_total: 4 });
});

test('a pup with a sale going ahead that isn\'t Placed; released sales don\'t count', () => {
  const dogs = [pup('a'), pup('b', { disposition: 'placed' }), pup('c'), pup('d')];
  const sales = [
    { id: 's1', dog_id: 'a', status: 'deposit_paid' },
    { id: 's2', dog_id: 'b', status: 'paid_in_full' },
    { id: 's3', dog_id: 'c', status: 'cancelled' },
    { id: 's4', dog_id: 'd', status: 'delivered' }
  ];
  assert.deepEqual(T.pupPlacedFindings(dogs, sales).map((f) => f.dog.id), ['a', 'd']);
});

test('a delivered dog still owned is flagged; co-owned, departed, or bought back again is not', () => {
  const sales = [
    { id: 's1', dog_id: 'a', status: 'delivered' },
    { id: 's2', dog_id: 'b', status: 'delivered' },
    { id: 's3', dog_id: 'c', status: 'delivered' },
    { id: 's4', dog_id: 'd', status: 'delivered' }, { id: 's5', dog_id: 'd', status: 'deposit_paid' }
  ];
  const dogs = [pup('a'), pup('b', { ownership_type: 'co_owned' }), pup('c', { is_archived: true }), pup('d')];
  assert.deepEqual(T.deliveredOwnedFindings(dogs, sales).map((f) => f.dog.id), ['a']);
});

test('a litter whose breeding names other parents', () => {
  const pairings = [{ id: 'P', sire_id: 'S2', dam_id: 'D' }];
  const [f] = T.litterPairingFindings([litter({ pairing_id: 'P' })], pairings);
  assert.deepEqual([f.sire, f.dam], [true, false]);
  assert.equal(T.litterPairingFindings([litter({ pairing_id: 'P', sire_id: 'S2' })], pairings).length, 0);
});

test('a litter\'s pups: blank parents to fill, different parents to correct', () => {
  const dogs = [pup('a'), pup('b', { sire_id: null }), pup('c', { dam_id: 'X' }), pup('d', { sire_id: null, is_archived: true })];
  const [f] = T.pupParentFindings([litter()], dogs);
  assert.deepEqual(f.fill.map((p) => p.id), ['b']);
  assert.deepEqual(f.conflict.map((p) => p.id), ['c']);
  assert.deepEqual(T.pupParentFix(dogs[2], litter()), { dam_id: 'D' });
});

test('her own dogs with no litter and a blank parent; outside and pedigree-only dogs are left alone', () => {
  const dogs = [
    { id: 'a', ownership_type: 'owned' },
    { id: 'b', ownership_type: 'owned', sire_id: 'S', dam_id: 'D' },
    { id: 'c', ownership_type: 'external' },
    { id: 'd', ownership_type: 'external', pedigree_only: true },
    { id: 'e', ownership_type: 'co_owned', sire_id: 'S' },
    { id: 'f', ownership_type: 'owned', litter_id: 'L' } // a litter pup: the pup rule's job
  ];
  const found = T.dogParentFindings(dogs, new Map([['L', litter()]]));
  assert.deepEqual(found.map((f) => [f.dog.id, f.missing.join('+')]), [['a', 'sire+dam'], ['e', 'dam']]);
});

test('a stud service past its date with no breeding: offers the matching unclaimed breeding to link', () => {
  const studs = [
    { id: 'in', direction: 'to_partner', our_dog_id: 'D', partner_dog_id: 'S', status: 'in_progress', sent_date: '2026-09-01', returned_date: '2026-09-05' },
    { id: 'future', direction: 'to_us', our_dog_id: 'S', partner_dog_id: 'D2', status: 'arranged', sent_date: '2026-11-01' },
    { id: 'linked', direction: 'to_partner', our_dog_id: 'D', partner_dog_id: 'S', status: 'completed', pairing_id: 'P0' },
    { id: 'off', direction: 'to_partner', our_dog_id: 'D', partner_dog_id: 'S', status: 'cancelled', sent_date: '2026-01-01' }
  ];
  const pairings = [
    { id: 'P0', sire_id: 'S', dam_id: 'D', planned_date: '2026-09-02' }, // claimed by "linked"
    { id: 'P1', sire_id: 'S', dam_id: 'D', planned_date: '2026-09-03' },
    { id: 'old', sire_id: 'S', dam_id: 'D', planned_date: '2025-01-01' },
    { id: 'other', sire_id: 'S9', dam_id: 'D', planned_date: '2026-09-03' }
  ];
  const dogs = [{ id: 'D', sex: 'female' }, { id: 'S', sex: 'male' }, { id: 'D2', sex: 'female' }];
  const found = T.studFindings(studs, pairings, today, dogs);
  assert.deepEqual(found.map((f) => f.stud.id), ['in']);
  assert.deepEqual(found[0].candidates.map((p) => p.id), ['P1']);
});

test('breeders without a kennel, and outside kennels no contact belongs to', () => {
  const contacts = [
    { id: 'c1', name: 'A', contact_type: ['breeder'] },
    { id: 'c2', name: 'B', contact_type: ['breeder'], kennel_id: 'K1' },
    { id: 'c3', name: 'C', contact_type: ['vet'] }
  ];
  assert.deepEqual(T.breederKennelFindings(contacts).map((f) => f.contact.id), ['c1']);
  const kennels = [{ id: 'K1' }, { id: 'K2' }, { id: 'K3' }, { id: 'MINE', is_own_kennel: true }];
  const found = T.kennelContactFindings(kennels, contacts, [{ id: 'd', breeder_kennel_id: 'K2' }]);
  assert.deepEqual(found.map((f) => [f.kennel.id, f.used]), [['K2', true], ['K3', false]]);
});

test('duplicate contacts: the same name plus one shared detail; a name alone is not enough', () => {
  const contacts = [
    { id: '1', name: 'Mary-Ann Smith', phone: '+1 (555) 123-4567', created_at: '2026-01-01' },
    { id: '2', name: 'mary ann  smith.', phone: '555.123.4567', created_at: '2026-02-01' },
    { id: '3', name: 'Mary Ann Smith', email: 'm@x.com' },
    { id: '4', name: 'Bob', email: 'm@x.com' }
  ];
  const found = T.duplicateContactFindings(contacts);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].a.id, found[0].b.id, found[0].shared], ['1', '2', ['phone']]);
});

test('duplicate dogs: missing details are unknown, never a difference', () => {
  const a = { id: 'a', call_name: 'Bella', breed: 'Boston', sex: 'female', ownership_type: 'owned', date_of_birth: '2022-01-01' };
  // The outside copy has no birthday: still a possible match, and says what's unknown.
  const m = T.compareDogs(a, { id: 'b', call_name: 'bella', breed: 'boston', sex: 'female' });
  assert.equal(m.strength, 'possible');
  assert.ok(m.unknown.includes('birthday'));
  // Both have birthdays and they differ: not the same dog.
  assert.equal(T.compareDogs(a, { id: 'c', call_name: 'Bella', breed: 'Boston', sex: 'female', date_of_birth: '2023-05-05' }), null);
  // Different breed or known sex: no.
  assert.equal(T.compareDogs(a, { id: 'd', call_name: 'Bella', breed: 'Poodle', sex: 'female' }), null);
  assert.equal(T.compareDogs(a, { id: 'e', call_name: 'Bella', breed: 'Boston', sex: 'male' }), null);
  // Littermates by name alone, and a dog and its own dam: no.
  assert.equal(T.compareDogs({ ...a, litter_id: 'L' }, { id: 'f', call_name: 'Bella', breed: 'Boston', litter_id: 'L' }), null);
  assert.equal(T.compareDogs(a, { id: 'g', call_name: 'Bella', breed: 'Boston', sex: 'female', dam_id: 'a' }), null);
});

test('duplicate dogs: a shared registration number is certain whatever the names; a registered name too unless numbers differ', () => {
  assert.equal(T.compareDogs({ id: 'a', call_name: 'Bo', registration_number: 'ws 123-45' }, { id: 'b', registered_name: 'CH Something', registration_number: 'WS12345' }).strength, 'certain');
  assert.equal(T.compareDogs({ id: 'a', registered_name: 'CH Rose of X' }, { id: 'b', registered_name: 'ch rose of x', pedigree_only: true }).strength, 'certain');
  assert.equal(T.compareDogs({ id: 'a', registered_name: 'Rose', registration_number: '1' }, { id: 'b', registered_name: 'Rose', registration_number: '2' }), null);
});

test('duplicate dogs: archived dogs are skipped, each pair once, certain first', () => {
  const dogs = [
    { id: '1', call_name: 'Max', breed: 'Boston', registration_number: 'R1', created_at: '1' },
    { id: '2', call_name: 'Max', breed: 'Boston', registration_number: 'R1', created_at: '2' },
    { id: '3', call_name: 'Zoe', breed: 'Boston' },
    { id: '4', call_name: 'Zoe', breed: 'Boston' },
    { id: '5', call_name: 'Zoe', breed: 'Boston', is_archived: true }
  ];
  const found = T.duplicateDogFindings(dogs);
  assert.deepEqual(found.map((f) => [f.a.id, f.b.id, f.strength]), [['1', '2', 'certain'], ['3', '4', 'possible']]);
});

test('tidyFindings: Lite (no contacts, no stud services) never gets those checks', () => {
  const input = {
    litters: [], pairings: [], sales: [], dogs: [], allDogs: [], today,
    studServices: [{ id: 's', direction: 'to_partner', our_dog_id: 'D', partner_dog_id: 'S', status: 'completed' }],
    contacts: [{ id: 'c', name: 'A', contact_type: ['breeder'] }, { id: 'c2', name: 'A', contact_type: ['breeder'] }],
    kennels: [{ id: 'K' }]
  };
  assert.deepEqual(T.tidyFindings({ ...input, flags: {} }), []);
  assert.deepEqual(kinds(T.tidyFindings({ ...input, flags: { contactsSection: true, studServices: true } })),
    ['stud-unlinked', 'breeder-no-kennel', 'breeder-no-kennel', 'kennel-no-contact']);
});
