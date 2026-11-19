// pedigreeLifeStage.test.js — review batch F: a delivered pup's life stage (K9-7, R3),
// a chart parent fix and its litter (K9-8), the same ancestor typed twice (K9-9) and
// an archived dog's registration number (K9-11).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables; let dogRepo; let litterRepo; let kennelRepo; let contactRepo; let saleRepo; let E; let goHome; let nudges;
before(async () => {
  ({ tables } = await installMemoryDb());
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ litterRepo } = await import('../shared/data/litterRepo.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  E = await import('../shared/data/pedigreeEdit.js');
  goHome = await import('../shared/data/goHome.js');
  nudges = await import('../shared/data/nudges.js');
});
beforeEach(() => { for (const t of Object.values(tables)) t.rows.clear(); localStorage.clear(); });

async function litterOf() {
  const K = await kennelRepo.create({ kennel_name: 'Oak Hill', is_own_kennel: true });
  const dog = (o) => dogRepo.create({ breed: 'Boxer', ownership_type: 'owned', kennel_id: K.id, ...o });
  const hazel = await dog({ call_name: 'Hazel', sex: 'female', status: 'active_breeding' });
  const rocco = await dog({ call_name: 'Rocco', sex: 'male', status: 'active_breeding' });
  const duke = await dog({ call_name: 'Duke', sex: 'male', status: 'active_breeding' });
  const l = await litterRepo.create({ kennel_id: K.id, dam_id: hazel.id, sire_id: rocco.id, status: 'ready', whelp_date: '2026-01-01' });
  const pup = (name) => dog({ call_name: name, sex: 'male', status: 'puppy', litter_id: l.id, sire_id: rocco.id, dam_id: hazel.id, date_of_birth: '2026-01-01' });
  const red = await pup('Red');
  const blue = await pup('Blue');
  return { K, hazel, rocco, duke, l, red, blue };
}

// --- K9-7 -----------------------------------------------------------------------

test('a co-own Delivered with Active breeding makes the pup an active breeding dog', () => {
  const ruby = { id: 'r', status: 'puppy', co_owner_contact_ids: [] };
  assert.deepEqual(goHome.deliveredOwnershipChanges(ruby, 'co_owned', { buyerId: 'b', stage: 'active_breeding', today: '2026-05-01' }),
    { ownership_type: 'co_owned', co_owner_contact_ids: ['b'], status: 'active_breeding', status_date: '2026-05-01' });
  // Left owned, Pet home: only the life stage.
  assert.deepEqual(goHome.deliveredOwnershipChanges(ruby, null, { stage: 'pet_home', today: '2026-05-01' }),
    { status: 'pet_home', status_date: '2026-05-01' });
  // "Leave as Puppy" changes nothing; External ignores a stage.
  assert.equal(goHome.deliveredOwnershipChanges(ruby, null, {}), null);
  assert.equal(goHome.deliveredOwnershipChanges(ruby, 'external', { stage: 'pet_home', today: '2026-05-01' }).status, 'external_reference');
});

test('a delivered pup still a Puppy is nudged at day 181 after delivery, not before', async () => {
  const { red } = await litterOf();
  const buyer = await contactRepo.create({ name: 'Co-owner' });
  await dogRepo.update(red.id, { ownership_type: 'co_owned', co_owner_contact_ids: [buyer.id], disposition: 'placed' });
  const sale = await saleRepo.create({ kennel_id: red.kennel_id, dog_id: red.id, buyer_contact_id: buyer.id, registration_type: 'full',
    status: 'delivered', sale_date: '2026-02-01', balance_paid_date: '2026-03-01' });
  const dogs = await dogRepo.getAll();
  const at = (today) => nudges.deliveredStillPuppyNudges(dogs, [sale], [], today);
  assert.equal(at('2026-08-28').length, 0, 'day 180');
  const [n] = at('2026-08-29');
  assert.ok(n, 'day 181');
  assert.equal(n.key, `delivered-still-puppy:${red.id}`);
  assert.deepEqual(n.actions.map((a) => a.label), ['Pet home', 'Active breeding']);
  // A pickup logged on the pup is the delivery day when there is one.
  const pickup = { subject_type: 'dog', subject_id: red.id, event_type: 'placement', event_date: '2026-04-01' };
  assert.equal(nudges.deliveredStillPuppyNudges(dogs, [sale], [pickup], '2026-08-29').length, 0);
  assert.equal(nudges.deliveredStillPuppyNudges(dogs, [sale], [pickup], '2026-09-29').length, 1);
  // Grown up or gone: nothing.
  await n.actions[1].run();
  assert.equal((await dogRepo.getById(red.id)).status, 'active_breeding');
  assert.equal(nudges.deliveredStillPuppyNudges(await dogRepo.getAll(), [sale], [], '2026-08-29').length, 0);
});

// --- K9-8 -----------------------------------------------------------------------

test('a chart parent that differs from the litter\'s is flagged', async () => {
  const { l, red, duke, rocco } = await litterOf();
  assert.equal(E.litterParentMismatch(red, l, 'sire', duke.id), true);
  assert.equal(E.litterParentMismatch(red, l, 'sire', rocco.id), false);
  assert.equal(E.litterParentMismatch({ ...red, litter_id: null }, l, 'sire', duke.id), false);
  assert.equal(E.litterParentMismatch(red, l, 'sire', null), false, 'clearing a spot isn\'t a mismatch');
});

test('fixing the sire for the whole litter changes the litter and every pup on the old sire', async () => {
  const { l, red, blue, duke } = await litterOf();
  await E.setParent(red.id, 'sire', duke.id, { litter: 'all' });
  assert.equal((await litterRepo.getById(l.id)).sire_id, duke.id);
  assert.equal((await dogRepo.getById(red.id)).sire_id, duke.id);
  assert.equal((await dogRepo.getById(blue.id)).sire_id, duke.id);
});

test('just this pup (a split litter) leaves the litter and its littermates alone', async () => {
  const { l, red, blue, duke, rocco } = await litterOf();
  await E.setParent(red.id, 'sire', duke.id);
  assert.equal((await litterRepo.getById(l.id)).sire_id, rocco.id);
  assert.equal((await dogRepo.getById(red.id)).sire_id, duke.id);
  assert.equal((await dogRepo.getById(blue.id)).sire_id, rocco.id);
});

test('a litter\'s sire corrected moves the pups still on the old one', async () => {
  const { l, red, blue, duke, rocco } = await litterOf();
  const other = await dogRepo.create({ call_name: 'Split', sex: 'male', breed: 'Boxer', ownership_type: 'external', status: 'external_reference', owner_contact_id: (await contactRepo.create({ name: 'O' })).id });
  await dogRepo.update(blue.id, { sire_id: other.id });
  const pups = await E.litterPupsOnParent(l.id, 'sire', rocco.id);
  assert.deepEqual(pups.map((p) => p.id), [red.id]);
  await E.moveLitterPups(l.id, 'sire', rocco.id, duke.id);
  assert.equal((await dogRepo.getById(red.id)).sire_id, duke.id);
  assert.equal((await dogRepo.getById(blue.id)).sire_id, other.id, 'a split pup keeps its own sire');
});

// --- K9-9 -----------------------------------------------------------------------

test('typing an ancestor\'s name already on file offers that dog instead of a second one', async () => {
  const kid1 = await dogRepo.createPedigreeOnly({ registered_name: 'Thornfield Rocco', sex: 'male', breed: 'Boxer' });
  const kid2 = await dogRepo.createPedigreeOnly({ registered_name: 'Thornfield Hazel', sex: 'female', breed: 'Boxer' });
  const first = await E.addNewParent(kid1.id, 'sire', { registered_name: 'CH Briar Ace' });
  assert.equal(first.reused, false);
  // The second time, nothing is written until she answers.
  const second = await E.addNewParent(kid2.id, 'sire', { registered_name: 'GCH  Briar ace' });
  assert.equal(second.dog, null);
  assert.deepEqual(second.matches.map((d) => d.id), [first.dog.id]);
  assert.equal((await dogRepo.getById(kid2.id)).sire_id ?? null, null);
  // "Use it": the same Ace in both spots.
  const used = await E.addNewParent(kid2.id, 'sire', { registered_name: 'GCH  Briar ace', matchId: first.dog.id });
  assert.equal(used.reused, true);
  assert.equal((await dogRepo.getById(kid2.id)).sire_id, first.dog.id);
  // "A different dog": a new one.
  const kid3 = await dogRepo.createPedigreeOnly({ registered_name: 'Thornfield Blue', sex: 'male', breed: 'Boxer' });
  const fresh = await E.addNewParent(kid3.id, 'sire', { registered_name: 'Briar Ace', matchId: null });
  assert.notEqual(fresh.dog.id, first.dog.id);
});

test('a name match with a different registration number is a different dog', async () => {
  const kid1 = await dogRepo.createPedigreeOnly({ registered_name: 'A', sex: 'male', breed: 'Boxer' });
  const kid2 = await dogRepo.createPedigreeOnly({ registered_name: 'B', sex: 'male', breed: 'Boxer' });
  await E.addNewParent(kid1.id, 'sire', { registered_name: 'Briar Ace', registration_number: 'WS11111101' });
  const r = await E.addNewParent(kid2.id, 'sire', { registered_name: 'Briar Ace', registration_number: 'WS22222202' });
  assert.equal(r.reused, false);
  assert.ok(r.dog);
});

// --- K9-11 ----------------------------------------------------------------------

test('an archived dog\'s registration number isn\'t reused: it says whose it is', async () => {
  const old = await dogRepo.createPedigreeOnly({ registered_name: 'Old Timer', registration_number: 'NP12345601', sex: 'male', breed: 'Boxer' });
  await dogRepo.archive(old.id);
  const kid = await dogRepo.createPedigreeOnly({ registered_name: 'Kid', sex: 'male', breed: 'Boxer' });
  await assert.rejects(E.addNewParent(kid.id, 'sire', { registered_name: 'Old Timer', registration_number: 'NP 12345601' }), /Old Timer.*archived/);
  assert.equal((await dogRepo.getById(kid.id)).sire_id ?? null, null);
});

test('a spot under a dog that can\'t be edited isn\'t offered', () => {
  const lite = { archivedDogLinks: false };
  const archived = { id: 'a', is_archived: true };
  const live = { id: 'b' };
  assert.equal(E.spotFixable(archived, lite), false, 'Lite: an archived dog\'s own parents');
  assert.equal(E.spotFixable(archived, { archivedDogLinks: true }), true, 'Pro opens archived dogs');
  assert.equal(E.spotFixable(live, lite), true);
});
