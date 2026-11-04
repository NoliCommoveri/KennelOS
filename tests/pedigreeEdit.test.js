// pedigreeEdit.test.js — fixing one spot in a pedigree from the chart
// (data/pedigreeEdit.js): a dog on file, a new pedigree-only dog, or cleared;
// never a loop; a misplaced pedigree-only dog's sex corrected with the move.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, dogRepo, E;
before(async () => {
  ({ tables } = await installMemoryDb());
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  E = await import('../shared/data/pedigreeEdit.js');
});
beforeEach(() => { for (const t of Object.values(tables)) t.rows.clear(); localStorage.clear(); });

const ped = (registered_name, sex, extra = {}) => dogRepo.createPedigreeOnly({ registered_name, sex, breed: 'Boston Terrier', ...extra });

// Ammo's chart as the old importer left it: Gordon (a dam) put in Rams's sire spot as
// a male, with Kathy's Candy and Hi-Lu's under her the wrong way round.
async function misplaced() {
  const kathy = await ped("KATHY'S CANDY", 'male');
  const hilu = await ped("HI-LU'S NU JACK OF ALL TRADES", 'female');
  const gordon = await ped("GORDON'S HI OCTANE MERCEDES", 'male', { sire_id: kathy.id, dam_id: hilu.id });
  const rams = await ped('RAMS LUCKY ALEXIS LOGAN MCGINNIS', 'female', { sire_id: gordon.id });
  const bagosy = await ped("BAGOSY'S LITTLE MAN NAPOLEON", 'male');
  return { kathy, hilu, gordon, rams, bagosy };
}

test('a new dog for an empty spot is pedigree-only, of the spot\'s sex and the child\'s breed', async () => {
  const { rams } = await misplaced();
  const { dog, reused } = await E.addNewParent(rams.id, 'dam', { registered_name: 'MRF WIGGLES BLUE 17 50-3', registration_number: 'NP493514/03 07-19' });
  assert.equal(reused, false);
  assert.ok(dog.pedigree_only);
  assert.equal(dog.sex, 'female');
  assert.equal(dog.breed, 'Boston Terrier');
  assert.equal(dog.registry, 'AKC');
  assert.equal((await dogRepo.getById(rams.id)).dam_id, dog.id);
});

test('a registration number already on file uses that dog, not a duplicate', async () => {
  const { rams } = await misplaced();
  const wiggles = await ped('MRF WIGGLES BLUE 17 50-3', 'female', { registration_number: 'NP493514/03' });
  const before = tables.dogs.rows.size;
  const { dog, reused } = await E.addNewParent(rams.id, 'dam', { registered_name: 'Wiggles', registration_number: 'np 49351403' });
  assert.ok(reused);
  assert.equal(dog.id, wiggles.id);
  assert.equal(tables.dogs.rows.size, before);
});

test('moving a misplaced dog: refused while it still holds the other spot, then its sex is corrected', async () => {
  const { gordon, rams, bagosy } = await misplaced();
  await assert.rejects(E.setParent(bagosy.id, 'dam', gordon.id), /still recorded as the sire of RAMS LUCKY/);
  await E.addNewParent(rams.id, 'sire', { registered_name: "MRF JACK'S MOOSE 18" });
  await E.setParent(bagosy.id, 'dam', gordon.id);
  assert.equal((await dogRepo.getById(bagosy.id)).dam_id, gordon.id);
  assert.equal((await dogRepo.getById(gordon.id)).sex, 'female');
});

test('a dog of your own of the wrong sex is never changed', async () => {
  const { bagosy } = await misplaced();
  const ownMale = await dogRepo.create({ call_name: 'Zeus', sex: 'male', breed: 'Boston Terrier', ownership_type: 'external', owner_contact_id: 'c1', status: 'external_reference' });
  await assert.rejects(E.setParent(bagosy.id, 'dam', ownMale.id), /recorded as male/);
  const cands = E.spotCandidates(await dogRepo.getAll({ includeArchived: true, includePedigreeOnly: true }), bagosy.id, 'dam');
  assert.ok(!cands.some((d) => d.id === ownMale.id));
});

test('never a loop: a dog can\'t be its own ancestor', async () => {
  const { gordon, kathy } = await misplaced();
  await assert.rejects(E.setParent(kathy.id, 'sire', gordon.id), /already in/);
  const cands = E.spotCandidates(await dogRepo.getAll({ includeArchived: true, includePedigreeOnly: true }), kathy.id, 'sire');
  assert.ok(!cands.some((d) => d.id === gordon.id || d.id === kathy.id));
});

test('clearing a spot leaves the dog on file', async () => {
  const { gordon, rams } = await misplaced();
  await E.setParent(rams.id, 'sire', null);
  assert.equal((await dogRepo.getById(rams.id)).sire_id, null);
  assert.ok(await dogRepo.getById(gordon.id));
});
