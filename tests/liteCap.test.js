// liteCap.test.js — Lite's cap at the doors the review found open (K13-4, K13-5,
// K13-9), run against the REAL lite/editionConfig.js through liteHarness.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installLite } from './support/liteHarness.js';

let H; // { db, tables, lite }
const mods = {};
before(async () => {
  H = await installLite();
  mods.cfg = await H.lite('editionConfig.js');
  mods.io = await H.lite('importExport.js');
  mods.csv = await H.lite('csvImport.js');
  mods.merge = await H.lite('recordMerge.js');
});

function reset() { for (const t of Object.values(H.tables)) t.rows.clear(); }
const adult = (id, over = {}) => ({ id, call_name: id, sex: 'female', ownership_type: 'owned', status: 'active_breeding', is_archived: false, ...over });
const litter = (id) => ({ id, is_archived: false });
const file = (collections) => ({ app: 'kennelos', collections });
const capErr = (kind) => (e) => e.name === 'CapExceededError' && e.kind === kind;

test('the harness runs the Lite config, not the shared one', () => {
  assert.equal(mods.cfg.edition, 'lite');
});

// --- K13-5: every restore checks the litter cap ------------------------------

test('K13-5: Replace with more than 10 litters is refused and writes nothing', async () => {
  reset();
  H.tables.litters.rows.set('mine', litter('mine'));
  const litters = Array.from({ length: 11 }, (_, i) => litter(`l${i}`));
  await assert.rejects(mods.io.restoreBackup(file({ dogs: [adult('d1')], litters }), 'replace'), capErr('litters'));
  assert.deepEqual([...H.tables.litters.rows.keys()], ['mine'], 'nothing written, nothing cleared');
  assert.equal(H.tables.dogs.rows.size, 0);
});

test('K13-5: Replace with exactly 10 litters restores', async () => {
  reset();
  const litters = Array.from({ length: 10 }, (_, i) => litter(`l${i}`));
  await mods.io.restoreBackup(file({ dogs: [adult('d1')], litters }), 'replace');
  assert.equal(H.tables.litters.rows.size, 10);
});

test('K13-5: the merge-shaped restores count her litters plus the new ones', async () => {
  reset();
  for (let i = 0; i < 8; i++) H.tables.litters.rows.set(`l${i}`, litter(`l${i}`));
  // The cloud and vault merges count `writes` over what's on the device.
  await assert.rejects(
    mods.cfg.enforceImportLitterCap({ incomingLitters: [litter('n1'), litter('n2'), litter('n3')], mode: 'merge' }),
    capErr('litters'));
  // An update of a litter she already has doesn't add one.
  await mods.cfg.enforceImportLitterCap({ incomingLitters: [litter('l0'), litter('n1'), litter('n2')], mode: 'merge' });
});

test('K13-5: a file Merge that would pass 10 litters is refused', async () => {
  reset();
  for (let i = 0; i < 9; i++) H.tables.litters.rows.set(`l${i}`, litter(`l${i}`));
  await assert.rejects(
    mods.io.restoreBackup(file({ litters: [litter('n1'), litter('n2')] }), 'merge', {}),
    capErr('litters'));
  assert.equal(H.tables.litters.rows.size, 9);
});

test('litterCapStatus reads the raw litter count against 10', async () => {
  reset();
  for (let i = 0; i < 3; i++) H.tables.litters.rows.set(`l${i}`, litter(`l${i}`));
  assert.deepEqual(await mods.cfg.litterCapStatus(), { current: 3, cap: 10 });
});

// --- K13-4: Lite's CSV takes only the ownerships its form offers -------------

function dogRow(over = {}) {
  return { call_name: 'Rex', sex: 'Male', date_of_birth: '2022-05-04', breed: 'Beagle', ownership_type: 'Owned', status: 'Active breeding', ...over };
}
function classifyDog(row) {
  const m = mods.csv.getMapping('dog');
  m._kennels = { byName: new Map(), ownIds: new Set() };
  m._contactByName = new Map();
  return m.classify(row, m.buildIndex([]), 0);
}

test('K13-4: Lite CSV refuses leased ownerships, and an external dog with an owner', () => {
  for (const over of [{ ownership_type: 'leased_out' }, { ownership_type: 'Leased in' }, { ownership_type: 'external', owner_name: 'Ann' }]) {
    const r = classifyDog(dogRow(over));
    assert.equal(r.decision, 'skip', over.ownership_type);
    assert.equal(r.record.ownership_type, undefined, 'nothing to save with it');
    assert.ok(r.reasons.some((x) => x.includes("isn't available in this edition")), over.ownership_type);
  }
});

test('K13-4: an external dog with no owner still lands pedigree-only in Lite (an ancestor)', () => {
  const r = classifyDog(dogRow({ ownership_type: 'external', status: '' }));
  assert.equal(r.record.pedigree_only, true);
  assert.ok(!r.reasons.some((x) => x.includes("isn't available in this edition")));
});

test('K13-4: Lite CSV still takes owned and co-owned', () => {
  for (const o of ['Owned', 'co_owned']) assert.equal(classifyDog(dogRow({ ownership_type: o })).decision, 'create', o);
});

// --- K13-9: a merge that leaves the count unchanged isn't refused ------------

test('K13-9: at 6/6, keeping the puppy copy and taking the adult copy\'s status merges', async () => {
  reset();
  H.tables.kennels.rows.set('k1', { id: 'k1', kennel_name: 'Mine', is_own_kennel: true, is_archived: false });
  const dog = (id, over = {}) => adult(id, { breed: 'Beagle', kennel_id: 'k1', date_of_birth: '2022-01-01', ...over });
  for (let i = 0; i < 5; i++) H.tables.dogs.rows.set(`a${i}`, dog(`a${i}`));
  H.tables.dogs.rows.set('bonnieAdult', dog('bonnieAdult', { call_name: 'Bonnie' }));
  H.tables.dogs.rows.set('bonniePup', dog('bonniePup', { call_name: 'Bonnie', status: 'puppy', notes: 'from her litter' }));
  await mods.merge.mergeDuplicate('dogs', 'bonniePup', 'bonnieAdult', { ownership: 'drop' });
  assert.equal(H.tables.dogs.rows.get('bonniePup').status, 'active_breeding');
  assert.equal(H.tables.dogs.rows.has('bonnieAdult'), false);
});

test('K13-9: a merge that does make a new adult at the cap is still refused', async () => {
  reset();
  H.tables.kennels.rows.set('k1', { id: 'k1', kennel_name: 'Mine', is_own_kennel: true, is_archived: false });
  const dog = (id, over = {}) => adult(id, { breed: 'Beagle', kennel_id: 'k1', date_of_birth: '2022-01-01', ...over });
  for (let i = 0; i < 6; i++) H.tables.dogs.rows.set(`a${i}`, dog(`a${i}`));
  H.tables.dogs.rows.set('p1', dog('p1', { call_name: 'Pip', status: 'puppy' }));
  H.tables.dogs.rows.set('p2', dog('p2', { call_name: 'Pip', status: 'retired_breeding', is_archived: true }));
  await assert.rejects(mods.merge.mergeDuplicate('dogs', 'p1', 'p2', { ownership: 'drop' }), capErr('dogs'));
  assert.ok(H.tables.dogs.rows.has('p2'), 'nothing deleted');
});

// --- K11-1: Kels's Record a litter checks room for every new parent first -----

test('K11-1: at 5/6, a new mom and a new dad of hers are refused before either is made', async () => {
  reset();
  H.tables.kennels.rows.set('k1', { id: 'k1', kennel_name: 'Mine', is_own_kennel: true, is_archived: false });
  for (let i = 0; i < 5; i++) H.tables.dogs.rows.set(`a${i}`, adult(`a${i}`, { breed: 'Beagle', kennel_id: 'k1' }));
  const G = await H.lite('guidedLitter.js');
  const draft = G.emptyDraft();
  draft.kennelId = 'k1';
  draft.newDam = { ...G.newDogSpec('Beagle'), call_name: 'NewMom' };
  draft.newSire = { ...G.newDogSpec('Beagle'), call_name: 'NewDad' };
  assert.equal(G.newParentsToMake(draft), 2);
  assert.equal(G.roomForNewParent({ current: 5, cap: 6 }, draft, 'sire'), false, 'the mom already takes the last slot');
  assert.equal(G.roomForNewParent({ current: 4, cap: 6 }, draft, 'sire'), true);
  await assert.rejects(G.saveGuidedLitter(draft), capErr('dogs'));
  assert.equal(H.tables.dogs.rows.size, 5, 'no parent made');
  assert.equal(H.tables.litters.rows.size, 0);
});
