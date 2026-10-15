// guidedLitter.test.js — the guided "Record a new litter" flow's data half
// (data/guidedLitter.js): which steps apply, what each step refuses, the review
// lines, and the save, run through the REAL repos against support/memoryDb.js on
// the Thornfield seed. The save is resumable, so a second run after a stop must
// make nothing twice.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let g; let tables; let dogRepo; let litterRepo; let pairingRepo; let studServiceRepo; let eventRepo; let kennelId;
let dam; let sire;

before(async () => {
  ({ tables } = await installMemoryDb());
  g = await import('../shared/data/guidedLitter.js');
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ litterRepo } = await import('../shared/data/litterRepo.js'));
  ({ pairingRepo } = await import('../shared/data/pairingRepo.js'));
  ({ studServiceRepo } = await import('../shared/data/studServiceRepo.js'));
  ({ eventRepo } = await import('../shared/data/eventRepo.js'));
  const { seedSampleData } = await import('../shared/data/sampleData.js');
  await seedSampleData();
  const kennels = [...tables.kennels.rows.values()].filter((k) => k.is_own_kennel);
  kennelId = kennels[0].id;
  const dogs = [...tables.dogs.rows.values()];
  dam = g.damChoices(dogs).find((d) => d.kennel_id === kennelId && d.breed);
  sire = g.sireChoices(dogs, { excludeId: dam.id }).find((d) => d.kennel_id === kennelId);
  assert.ok(dam && sire, 'seed has an own dam and sire');
});

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

function birthDraft(extra = {}) {
  const d = g.emptyDraft();
  Object.assign(d, { damId: dam.id, sireId: sire.id, bredDate: daysAgo(65), method: 'natural', whelpDate: daysAgo(2), alive: '3', deceased: '1', kennelId, ...extra });
  g.syncPups(d);
  d.pups[0].sex = 'male'; d.pups[1].sex = 'female'; d.pups[2].sex = 'female';
  d.pups[0].birth_oz = '14';
  d.pups[1].disposition = 'available'; d.pups[1].intended_registration = 'limited';
  d.prices.expected_price_female = '2500'; d.prices.expected_deposit_female = '500';
  return d;
}

test('the mom comes first, then the dad; a new dog adds its questions, and "we found…" only when there are matches', () => {
  const d = g.emptyDraft();
  assert.deepEqual(g.stepsFor(d).slice(0, 4), ['dam', 'sire', 'bred', 'born']);
  d.newDam = g.newDogSpec();
  assert.deepEqual(g.stepsFor(d).slice(0, 3), ['dam', 'dam-new', 'sire']);
  d.newDam.matchIds = ['x'];
  assert.deepEqual(g.stepsFor(d).slice(0, 4), ['dam', 'dam-new', 'dam-match', 'sire']);
  d.newSire = { ...g.newDogSpec(), mine: false };
  const pro = g.stepsFor(d, { canOutsideDog: true, canStudService: true });
  assert.deepEqual(pro.slice(3, 9), ['sire', 'sire-new', 'sire-owner', 'sire-kennel', 'bred', 'stud-service']);
  // Lite: no outside dogs or stud services, so never asked.
  const lite = g.stepsFor(d, { canOutsideDog: false, canStudService: false });
  assert.ok(!lite.includes('sire-owner') && !lite.includes('stud-service'));
  // Opened from an Expected litter's page: no parent questions.
  assert.equal(g.stepsFor(g.emptyDraft({ litterId: 'x' }))[0], 'bred');
  assert.equal(g.stepsFor(g.emptyDraft({ litterId: 'x' }), { linkedPairing: { id: 'p' } })[0], 'born');
});

test('an existing litter is offered before an existing breeding, and a picked breeding skips "when was she bred?"', () => {
  const d = g.emptyDraft();
  Object.assign(d, { damId: 'd', sireId: 's' });
  const withLitter = g.stepsFor(d, { litterOptions: [{ id: 'l' }], pairingOptions: [{ id: 'p' }] });
  assert.deepEqual(withLitter.slice(2, 5), ['match-litter', 'match-pairing', 'bred']);
  d.pairingChoice = 'p';
  assert.deepEqual(g.stepsFor(d, { pairingOptions: [{ id: 'p' }] }).slice(2, 4), ['match-pairing', 'born']);
  // A litter that already has its breeding: neither question.
  assert.deepEqual(g.stepsFor(d, { litterOptions: [{ id: 'l' }], linkedPairing: { id: 'p' } }).slice(2, 4), ['match-litter', 'born']);
});

test('litters with no pups and open breedings of the same parents are the candidates', () => {
  const litters = [
    { id: 'a', dam_id: 'd', sire_id: 's', status: 'expected' },
    { id: 'b', dam_id: 'd', sire_id: 's', status: 'whelped', pairing_id: 'p1' },
    { id: 'c', dam_id: 'd', sire_id: 'x', status: 'expected' }
  ];
  const dogs = [{ id: 'pup', litter_id: 'b' }];
  assert.deepEqual(g.litterCandidates({ litters, dogs, damId: 'd', sireId: 's' }).map((l) => l.id), ['a']);
  const pairings = [
    { id: 'p1', dam_id: 'd', sire_id: 's', status: 'whelped' },
    { id: 'p2', dam_id: 'd', sire_id: 's', status: 'confirmed_pregnant' },
    { id: 'p3', dam_id: 'd', sire_id: 's', status: 'failed' }
  ];
  assert.deepEqual(g.pairingCandidates({ pairings, litters, damId: 'd', sireId: 's' }).map((p) => p.id), ['p2']);
  assert.deepEqual(g.litterCandidates({ litters, dogs, damId: 'd', sireId: null }), []);
});

test('one screen per puppy, then the sale-ready steps, then the review', () => {
  const d = birthDraft();
  const steps = g.stepsFor(d);
  assert.deepEqual(steps.slice(steps.indexOf('count')), ['count', 'pup:0', 'pup:1', 'pup:2', 'plans', 'prices', 'dates', 'extras', 'review']);
});

test('syncPups names pups by collar and never drops one already recorded', () => {
  const d = g.emptyDraft();
  d.alive = '2';
  g.syncPups(d);
  assert.deepEqual(d.pups.map((p) => p.call_name), ['Red collar', 'Blue collar']);
  d.pups[0].id = 'saved-pup';
  d.alive = '0';
  d.deceased = '1';
  g.syncPups(d);
  assert.equal(d.pups.length, 1);
  assert.match(g.stepProblem('count', d), /already entered/);
});

test('steps refuse plainly worded problems', () => {
  const d = birthDraft();
  assert.equal(g.stepProblem('born', { ...d, whelpDate: '2999-01-01' }), 'The birth date can\'t be in the future.');
  assert.match(g.stepProblem('born', { ...d, whelpDate: daysAgo(70) }), /before the breeding/);
  assert.equal(g.stepProblem('sire', { ...d, sireId: dam.id }), 'The dad can\'t be the same dog as the mom.');
  assert.equal(g.stepProblem('pup:0', { ...d, pups: [{ ...d.pups[0], sex: '' }] }), 'Tap Boy or Girl.');
  const dupe = { ...d, pups: d.pups.map((p) => ({ ...p, call_name: 'Red collar' })) };
  assert.match(g.stepProblem('pup:1', dupe), /already has that name/);
  assert.equal(g.stepProblem('prices', { ...d, prices: { ...d.prices, expected_price_male: 'lots' } }), 'Prices must be numbers, like 2500.');
  assert.match(g.stepProblem('dam', d, { dam: { call_name: 'Nell', breed: '' } }), /no breed/);
  assert.equal(g.stepProblem('sire-owner', { ...d, newSire: { owner: { name: '' } } }), 'Pick his owner, or type the owner\'s name.');
  assert.equal(g.stepProblem('dam-match', { ...d, newDam: { matchIds: ['x'] } }), 'Tap one of the choices.');
  assert.equal(g.stepProblem('dam-match', { ...d, newDam: { matchIds: ['x'], matchDeclined: true } }), null);
  assert.equal(g.stepProblem('dam-new', { ...d, newDam: { call_name: 'Daisy', breed: '' } }), 'Pick her breed, or type a new one.');
  assert.equal(g.stepProblem('pup:0', d), null);
});

test('the review lists the price a buyer will see, with the Full surcharge', () => {
  const prices = { expected_price_male: '2000', expected_deposit_male: '400', full_reg_surcharge_male: '1000' };
  assert.equal(g.pupPriceText({ sex: 'male', intended_registration: 'full' }, prices), '$3,000, $400 deposit');
  assert.equal(g.pupPriceText({ sex: 'male', intended_registration: 'limited' }, prices), '$2,000, $400 deposit');
  const sections = g.reviewSections(birthDraft(), { dam, sire, kennelName: 'Thornfield' });
  const plans = sections.find((s) => s.title === 'Plans & prices').lines.join('\n');
  assert.match(plans, /Blue collar: Available, Limited registration, \$2,500, \$500 deposit/);
  assert.ok(sections.find((s) => s.title === 'The parents & breeding').lines[0].includes('marked Whelped'));
});

test('saving a new breeding makes the pairing, the litter, the pups and the birth weight', async () => {
  const d = birthDraft();
  const before = tables.pairings.rows.size;
  const { litterId } = await g.saveGuidedLitter(d);
  const litter = await litterRepo.getById(litterId);
  assert.equal(litter.status, 'whelped');
  assert.equal(litter.puppies_born_total, 4);
  assert.equal(litter.expected_price_female, 2500);
  assert.equal(tables.pairings.rows.size, before + 1);
  const pairing = await pairingRepo.getById(litter.pairing_id);
  assert.equal(pairing.status, 'whelped');
  assert.equal(pairing.pairing_type, 'actual');
  const pups = await dogRepo.getByLitter(litterId);
  assert.equal(pups.length, 3);
  const blue = pups.find((p) => p.call_name === 'Blue collar');
  assert.equal(blue.disposition, 'available');
  assert.equal(blue.intended_registration, 'limited');
  assert.equal(blue.breed, dam.breed);
  assert.equal(blue.date_of_birth, d.whelpDate);
  assert.equal(blue.kennel_id, kennelId);
  const weights = await eventRepo.getForSubject('dog', pups.find((p) => p.call_name === 'Red collar').id);
  assert.deepEqual(weights.map((e) => [e.title, e.details.weight_oz]), [['Birth weight', 14]]);

  // Resumable: running it again (a retry after a stop) makes nothing twice.
  const counts = () => [tables.pairings.rows.size, tables.litters.rows.size, tables.dogs.rows.size, tables.events.rows.size];
  const at = counts();
  await g.saveGuidedLitter(d);
  assert.deepEqual(counts(), at);
});

test('an outside stud not in KennelOS becomes a dog, his owner a contact, plus his kennel and the stud service', async () => {
  const d = birthDraft({
    sireId: null,
    newSire: { ...g.newDogSpec(dam.breed), call_name: 'Duke', registered_name: 'Ch. Duke of Elm', mine: false, owner: { name: 'Pat Owner', phone: '555-0100', email: '' }, kennelName: 'Elmwood' },
    stud: { record: true, fee_structure: 'flat_fee', fee_amount: '1500', type: '' }
  });
  const { litterId } = await g.saveGuidedLitter(d);
  const litter = await litterRepo.getById(litterId);
  const duke = await dogRepo.getById(litter.sire_id);
  assert.equal(duke.call_name, 'Duke');
  assert.equal(duke.ownership_type, 'external');
  const owner = tables.contacts.rows.get(duke.owner_contact_id);
  assert.equal(owner.name, 'Pat Owner');
  const kennel = tables.kennels.rows.get(duke.kennel_id);
  assert.equal(kennel.kennel_name, 'Elmwood');
  assert.equal(kennel.is_own_kennel, false);
  assert.equal(owner.kennel_id, kennel.id);
  const [ss] = await studServiceRepo.getByPairing(litter.pairing_id);
  assert.equal(ss.direction, 'to_partner', 'a natural breeding: our dam went to him');
  assert.equal(ss.partner_contact_id, owner.id);
  assert.equal(ss.our_dog_id, dam.id);
  assert.equal(ss.fee_amount, 1500);
  assert.equal(ss.type, 'in_person');
});

test('recording the birth of an Expected litter updates it and its pups instead of making new ones', async () => {
  const pairing = await pairingRepo.create({ dam_id: dam.id, sire_id: sire.id, pairing_type: 'actual', status: 'confirmed_pregnant', kennel_id: kennelId });
  const litter = await litterRepo.create({ dam_id: dam.id, sire_id: sire.id, pairing_id: pairing.id, status: 'expected', kennel_id: kennelId });
  const placeholder = await dogRepo.create({ ...(await import('../shared/data/puppyDefaults.js')).baseFromLitter(litter, dam), call_name: 'Puppy 1', sex: 'unknown' });
  const d = g.emptyDraft();
  Object.assign(d, { damId: dam.id, sireId: sire.id });
  g.applyLitterChoice(d, litter, [...tables.dogs.rows.values()]);
  assert.equal(d.pups.length, 1, 'the placeholder pup comes along');
  Object.assign(d, { whelpDate: daysAgo(1), alive: '2', deceased: '0' });
  g.syncPups(d);
  d.pups[0].sex = 'female'; d.pups[0].call_name = 'Rosie';
  d.pups[1].sex = 'male';
  await g.saveGuidedLitter(d);
  const after = await litterRepo.getById(litter.id);
  assert.equal(after.status, 'whelped');
  assert.equal((await pairingRepo.getById(pairing.id)).status, 'whelped');
  const pups = await dogRepo.getByLitter(litter.id);
  assert.equal(pups.length, 2);
  const rosie = pups.find((p) => p.id === placeholder.id);
  assert.equal(rosie.call_name, 'Rosie');
  assert.equal(rosie.date_of_birth, d.whelpDate, 'the placeholder gets the birth date');
});

test('suggested prices come from the newest priced litter of the same breed', () => {
  const dogsById = new Map([['d1', { breed: 'Labrador Retriever' }], ['d2', { breed: 'Poodle' }]]);
  const litters = [
    { id: 'a', dam_id: 'd1', whelp_date: '2025-01-01', expected_price_male: 1000 },
    { id: 'b', dam_id: 'd1', whelp_date: '2026-01-01', expected_price_male: 1800 },
    { id: 'c', dam_id: 'd2', whelp_date: '2026-06-01', expected_price_male: 3000 }
  ];
  assert.equal(g.suggestedPrices({ litters, dogsById, breed: 'labrador retriever' }).expected_price_male, '1800');
  assert.equal(g.suggestedPrices({ litters, dogsById, breed: 'Beagle' }), null);
});

test('a new dog of hers, and a litter entered without its breeding: the picked breeding is linked to it', async () => {
  const pairing = await pairingRepo.create({ dam_id: dam.id, sire_id: sire.id, pairing_type: 'actual', status: 'bred', planned_date: daysAgo(64), kennel_id: kennelId });
  const litter = await litterRepo.create({ dam_id: dam.id, sire_id: sire.id, status: 'expected', kennel_id: kennelId });
  const d = g.emptyDraft();
  Object.assign(d, { damId: dam.id, sireId: sire.id, kennelId });
  g.applyLitterChoice(d, litter, []);
  g.applyPairingChoice(d, pairing);
  assert.equal(d.bredDate, pairing.planned_date);
  Object.assign(d, { whelpDate: daysAgo(1), alive: '1', deceased: '0' });
  g.syncPups(d);
  d.pups[0].sex = 'female';
  const pairingsBefore = tables.pairings.rows.size;
  await g.saveGuidedLitter(d);
  assert.equal(tables.pairings.rows.size, pairingsBefore, 'no new breeding');
  assert.equal((await litterRepo.getById(litter.id)).pairing_id, pairing.id);
  assert.equal((await pairingRepo.getById(pairing.id)).status, 'whelped');

  // A mom who isn't in KennelOS yet, and hers: made as her own dog in the litter's kennel.
  const n = birthDraft({ damId: null, newDam: { ...g.newDogSpec('Poodle'), call_name: 'Daisy' } });
  const { litterId } = await g.saveGuidedLitter(n);
  const daisy = await dogRepo.getById((await litterRepo.getById(litterId)).dam_id);
  assert.equal(daisy.call_name, 'Daisy');
  assert.equal(daisy.ownership_type, 'owned');
  assert.equal(daisy.kennel_id, kennelId);
  assert.equal((await dogRepo.getByLitter(litterId))[0].breed, 'Poodle');
});

test('a new mom who is only on a pedigree is brought into use, not made twice', async () => {
  const ped = await dogRepo.createPedigreeOnly({ registered_name: 'Ch Ancestral Nell of Elm', sex: 'female', breed: dam.breed });
  const d = birthDraft({ damId: null });
  d.newDam = Object.assign(g.newDogSpec(dam.breed), { call_name: 'Nellie', registered_name: 'Ancestral Nell', bringInId: ped.id });
  assert.equal(g.stepProblem('dam-match', d), null);
  assert.match(g.reviewSections(d, {})[0].lines[0], /Brought into your dogs from a pedigree/);
  const before = tables.dogs.rows.size;
  const { litterId } = await g.saveGuidedLitter(d);
  const litter = await litterRepo.getById(litterId);
  assert.equal(litter.dam_id, ped.id);
  const nell = await dogRepo.getById(ped.id);
  assert.equal(nell.pedigree_only, false);
  assert.equal(nell.ownership_type, 'owned');
  assert.equal(nell.registered_name, 'Ch Ancestral Nell of Elm', 'the pedigree\'s name stays');
  assert.equal(nell.call_name, 'Nellie', 'her call name fills the blank');
  assert.equal(tables.dogs.rows.size, before + 3, 'only the three pups are new');
});
