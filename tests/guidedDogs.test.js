// guidedDogs.test.js — Kels's "Add dogs" task, its data half
// (data/guidedDogs.js): which steps apply, what each step refuses, what the
// shared answers fill in, the review, and the save, run through the REAL repos
// against support/memoryDb.js on the Thornfield seed. The save is resumable, so
// a second run must make nothing twice; Lite's cap stops it partway.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let g; let tables; let dogRepo; let seedTestsKennel; let CapExceededError; let onFile; let kennelId;

before(async () => {
  ({ tables } = await installMemoryDb());
  g = await import('../shared/data/guidedDogs.js');
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ seedTestsKennel } = await import('../shared/data/kennelRepo.js'));
  ({ CapExceededError } = await import('../shared/data/repoBase.js'));
  const { seedSampleData } = await import('../shared/data/sampleData.js');
  await seedSampleData();
  onFile = await dogRepo.getAll({ includeArchived: false, includePedigreeOnly: true });
  kennelId = [...tables.kennels.rows.values()].find((k) => k.is_own_kennel).id;
});

const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
const dogsNamed = (name) => [...tables.dogs.rows.values()].filter((d) => d.call_name === name);

// A draft with these roster rows, through the roster step's own after().
function rosterDraft(rows) {
  const d = g.emptyDraft();
  d.common.kennelId = kennelId; // the seed has more than one own kennel, so she's asked
  d.dogs = rows.map(([call_name, sex]) => Object.assign(g.newDog(), { call_name, sex }));
  g.afterRoster(d, onFile);
  g.fillFromCommon(d);
  return d;
}

test('one dog: no "in common" step; several: one, before each dog\'s details and parents', () => {
  const one = rosterDraft([['Zinnia', 'female']]);
  assert.deepEqual(g.stepsFor(one), ['roster', 'dog:0', 'parents:0', 'breeder:0', 'review']);
  // A dog that may be on file gets its question right after its details.
  one.dogs[0].matchIds = ['x'];
  assert.deepEqual(g.stepsFor(one), ['roster', 'dog:0', 'match:0', 'parents:0', 'breeder:0', 'review']);
  const two = rosterDraft([['Zinnia', 'female'], ['Quillon', 'male']]);
  assert.deepEqual(g.stepsFor(two), ['roster', 'common', 'dog:0', 'parents:0', 'breeder:0', 'dog:1', 'parents:1', 'breeder:1', 'review']);
});

test('the roster refuses empty, unnamed, sexless and doubled rows; blank rows are dropped', () => {
  const d = g.emptyDraft();
  assert.match(g.stepProblem('roster', d), /Type the name/);
  d.dogs = [Object.assign(g.newDog(), { sex: 'male' })];
  assert.match(g.stepProblem('roster', d), /name for each dog/);
  d.dogs = [Object.assign(g.newDog(), { call_name: 'Pip' })];
  assert.match(g.stepProblem('roster', d), /Is Pip a boy or a girl/);
  d.dogs = [Object.assign(g.newDog(), { call_name: 'Pip', sex: 'male' }), Object.assign(g.newDog(), { call_name: ' pip ', sex: 'female' })];
  assert.match(g.stepProblem('roster', d), /Two dogs are named/);
  d.dogs = [Object.assign(g.newDog(), { call_name: 'Pip', sex: 'male' }), g.newDog()];
  assert.equal(g.stepProblem('roster', d), null);
  g.afterRoster(d, onFile);
  assert.equal(d.dogs.length, 1);
});

test('after its details, a dog on file it may be is asked about; one of hers is only filled in where blank', async () => {
  const existing = await dogRepo.create({ call_name: 'Zoey', registered_name: 'Thornfield Zoey Mae', sex: 'female', breed: 'Whippet',
    ownership_type: 'owned', status: 'active_breeding', kennel_id: kennelId, color_markings: 'Brindle' });
  const dogsNow = await dogRepo.getAll({ includeArchived: false, includePedigreeOnly: true });
  const d = rosterDraft([['Zoe', 'female'], ['Zinnia', 'female']]);
  // Nothing is looked up until its details are in.
  assert.deepEqual(d.dogs[0].matchIds, []);
  Object.assign(d.dogs[0], { breed: 'Whippet', microchip_id: '900111', color_markings: 'Red' });
  g.findMatchesFor(d.dogs[0], dogsNow, d);
  assert.equal(d.dogs[0].matchIds[0], existing.id);
  assert.deepEqual(g.stepsFor(d).slice(0, 4), ['roster', 'common', 'dog:0', 'match:0']);
  assert.match(g.stepProblem('match:0', d), /Tap one/);
  d.dogs[0].match = existing.id;
  assert.equal(g.stepProblem('match:0', d), null);
  assert.match(g.reviewSections(d)[0].title, /filling in what's missing/);
  // The same details keep her answer; changed ones ask again.
  g.findMatchesFor(d.dogs[0], dogsNow, d);
  assert.equal(d.dogs[0].match, existing.id);
  const before = tables.dogs.rows.size;
  d.dogs[1].breed = 'Whippet';
  await g.saveGuidedDogs(d);
  assert.equal(tables.dogs.rows.size, before + 1); // only Zinnia is new
  const after = await dogRepo.getById(existing.id);
  assert.equal(after.microchip_id, '900111'); // blank: filled in
  assert.equal(after.color_markings, 'Brindle'); // never overwritten
  assert.equal(after.call_name, 'Zoey');
  d.dogs[0].matchesFor = null;
  d.dogs[0].registration_number = 'XX1';
  g.findMatchesFor(d.dogs[0], dogsNow, d);
  assert.equal(d.dogs[0].match, null);
});

test('"in common" fills each dog; her own change on a dog is kept', () => {
  const d = rosterDraft([['Zinnia', 'female'], ['Quillon', 'male']]);
  assert.equal(d.dogs[0].status, 'active_breeding');
  assert.equal(d.dogs[0].ownership_type, 'owned');
  d.common.breed = 'Golden Retriever';
  g.fillFromCommon(d);
  assert.equal(d.dogs[1].breed, 'Golden Retriever');
  d.dogs[1].breed = 'Labrador Retriever';
  d.common.breed = 'Goldendoodle';
  g.fillFromCommon(d);
  assert.equal(d.dogs[0].breed, 'Goldendoodle');
  assert.equal(d.dogs[1].breed, 'Labrador Retriever');
  // Someone else's dog keeps an owner; switching back to hers clears it.
  d.dogs[0].ownership_type = 'external';
  d.dogs[0].ownerName = 'Pat Smith';
  g.fillFromCommon(d);
  assert.equal(d.dogs[0].ownerName, 'Pat Smith');
  d.dogs[0].ownership_type = 'owned';
  g.fillFromCommon(d);
  assert.equal(d.dogs[0].ownerName, '');
});

test('each dog\'s details: breed, a past birth date, status, whose, owner, kennel', () => {
  const d = rosterDraft([['Zinnia', 'female']]);
  const z = d.dogs[0];
  assert.match(g.stepProblem('dog:0', d), /breed/);
  z.breed = 'Golden Retriever';
  z.date_of_birth = tomorrow();
  assert.match(g.stepProblem('dog:0', d), /future/);
  z.date_of_birth = '2022-03-01';
  assert.equal(g.stepProblem('dog:0', d), null);
  z.ownership_type = 'external';
  assert.match(g.stepProblem('dog:0', d), /owner/);
  z.ownerName = 'Pat Smith';
  assert.equal(g.stepProblem('dog:0', d), null);
  z.ownership_type = 'owned';
  assert.match(g.stepProblem('dog:0', d, { multiKennel: true, ownKennelIds: ['k1', 'k2'] }), /Which of your kennels/);
  z.kennelId = 'k2';
  assert.equal(g.stepProblem('dog:0', d, { multiKennel: true, ownKennelIds: ['k1', 'k2'] }), null);
});

test('parents are optional; a typed ancestor is a registered name, looked up by both names and its number', () => {
  const regDam = onFile.find((x) => x.sex === 'female' && x.registered_name);
  const d = rosterDraft([['Zinnia', 'female'], ['Quintessa', 'female']]);
  const z = d.dogs[0];
  // Not known is fine: she may not know right off.
  assert.equal(z.dam.pick, '');
  assert.equal(g.stepProblem('parents:0', d, { dogs: onFile }), null);
  z.dam = { pick: 'new', name: '' };
  assert.match(g.stepProblem('parents:0', d, { dogs: onFile }), /mom's registered name/);
  // Her name, call or registered (titles in front ignored), finds the dog on file.
  z.dam = { pick: 'new', name: regDam.call_name };
  assert.match(g.stepProblem('parents:0', d, { dogs: onFile }), /already in KennelOS/);
  // A near name with nothing else agreeing doesn't stop her.
  z.dam = { pick: 'new', name: 'Ch Wholly Different Lass' };
  assert.equal(g.stepProblem('parents:0', d, { dogs: onFile }), null);
  z.dam = { pick: 'new', name: `GCH CH ${regDam.registered_name}` };
  assert.match(g.stepProblem('parents:0', d, { dogs: onFile }), /already in KennelOS.*registration number/);
  // A different number says it's a different dog.
  if (regDam.registration_number) {
    z.dam.regNum = 'ZZ99999999';
    assert.equal(g.stepProblem('parents:0', d, { dogs: onFile }), null);
    // Her number is that dog: picked for her.
    z.dam.regNum = ` ${regDam.registration_number.toLowerCase().replace(/ /g, "-")} `;
    g.resolveTypedParents(z, onFile);
    assert.equal(z.dam.pick, `dog:${regDam.id}`);
  }
  z.dam = { pick: 'new', name: 'quintessa' };
  assert.match(g.stepProblem('parents:0', d, { dogs: onFile }), /one of the dogs we're adding/);
  z.dam = { pick: `batch:${z.key}`, name: '' };
  assert.match(g.stepProblem('parents:0', d, { dogs: onFile }), /own mom/);
  z.dam = { pick: `batch:${d.dogs[1].key}`, name: '' };
  assert.equal(g.stepProblem('parents:0', d, { dogs: onFile }), null);
  // Taking that dog off the roster clears the parent that pointed at it.
  d.dogs.splice(1, 1);
  g.afterRoster(d, onFile);
  assert.equal(z.dam.pick, '');
});

test('the save: owners, typed parents and batch parents, each made once; a second run makes nothing', async () => {
  const before = tables.dogs.rows.size;
  const contactsBefore = tables.contacts.rows.size;
  const d = rosterDraft([['Lumi', 'female'], ['Thistledown', 'female'], ['Brackenridge', 'male']]);
  d.common.breed = 'Golden Retriever';
  g.fillFromCommon(d);
  const [mari, thistle, bramble] = d.dogs;
  mari.registered_name = 'Sunny Marigold of Elm';
  mari.date_of_birth = '2021-05-02';
  // Littermates with the same typed mom: one pedigree-only dam for both.
  mari.dam = { pick: 'new', name: 'Ch Olde Bess of Elm', regNum: '', callName: 'Bess' };
  thistle.dam = { pick: 'new', name: 'ch olde  bess of elm', regNum: '', callName: '' };
  thistle.sire = { pick: `batch:${bramble.key}`, name: '' };
  // Two outside dogs with the same new owner: one contact.
  thistle.ownership_type = 'external'; thistle.ownerName = 'Pat Smith';
  bramble.ownership_type = 'external'; bramble.ownerName = 'Pat  Smith';
  for (const step of g.stepsFor(d)) assert.equal(g.stepProblem(step, d, { dogs: onFile }), null, step);

  const res = await g.saveGuidedDogs(d);
  assert.equal(res.capError, null);
  assert.equal(res.made.length, 3);
  assert.equal(tables.dogs.rows.size, before + 4); // three dogs + their typed mom
  assert.equal(tables.contacts.rows.size, contactsBefore + 1);

  const bess = [...tables.dogs.rows.values()].filter((x) => x.registered_name === 'Ch Olde Bess of Elm');
  assert.equal(bess.length, 1);
  assert.equal(bess[0].call_name, 'Bess');
  assert.equal(bess[0].pedigree_only, true);
  assert.equal(bess[0].status, 'external_reference');
  const m = await dogRepo.getById(mari.id);
  assert.equal(m.dam_id, bess[0].id);
  assert.equal(m.registered_name, 'Sunny Marigold of Elm');
  assert.equal(m.ownership_type, 'owned');
  assert.ok(m.kennel_id, 'a dog of hers is in her kennel');
  const t = await dogRepo.getById(thistle.id);
  assert.equal(t.sire_id, bramble.id);
  assert.equal(t.dam_id, bess[0].id);
  assert.equal(t.owner_contact_id, (await dogRepo.getById(bramble.id)).owner_contact_id);
  assert.equal(d.done, true);

  await g.saveGuidedDogs(d);
  assert.equal(tables.dogs.rows.size, before + 4);
  assert.equal(tables.contacts.rows.size, contactsBefore + 1);
});

test('a pedigree-only dog she names is brought into use, not made twice', async () => {
  const ped = await dogRepo.create({ call_name: 'Hazelwick', sex: 'female', breed: 'Golden Retriever', ownership_type: 'external', status: 'external_reference', pedigree_only: true });
  const dogsNow = await dogRepo.getAll({ includeArchived: false, includePedigreeOnly: true });
  const d = g.emptyDraft();
  d.common.kennelId = kennelId;
  d.dogs = [Object.assign(g.newDog(), { call_name: 'Hazelwick', sex: 'female' })];
  g.afterRoster(d);
  g.fillFromCommon(d);
  d.dogs[0].breed = 'Golden Retriever';
  g.findMatchesFor(d.dogs[0], dogsNow, d);
  assert.equal(d.dogs[0].matchIds[0], ped.id);
  Object.assign(d.dogs[0], { match: ped.id, bringIn: true });
  assert.deepEqual(g.stepsFor(d), ['roster', 'dog:0', 'match:0', 'parents:0', 'breeder:0', 'review']);
  assert.match(g.reviewSections(d)[0].title, /bringing in/);
  const before = tables.dogs.rows.size;
  const res = await g.saveGuidedDogs(d);
  assert.deepEqual(res.made, [ped.id]);
  assert.equal(tables.dogs.rows.size, before);
  const after = await dogRepo.getById(ped.id);
  assert.equal(after.pedigree_only, false);
  assert.equal(after.status, 'active_breeding');
  assert.equal(after.ownership_type, 'owned');
});

test('Lite\'s cap stops the save: the dogs made so far stay and are linked, the rest aren\'t made', async () => {
  const d = rosterDraft([['Calloway', 'female'], ['Fenwick', 'male'], ['Solveig', 'female']]);
  d.common.breed = 'Golden Retriever';
  g.fillFromCommon(d);
  d.dogs[0].sire = { pick: `batch:${d.dogs[1].key}`, name: '' };
  const real = dogRepo.create;
  let n = 0;
  dogRepo.create = async (data) => {
    if (++n > 2) throw new CapExceededError('dogs', 6, 6);
    return real.call(dogRepo, data);
  };
  try {
    const res = await g.saveGuidedDogs(d);
    assert.ok(res.capError instanceof CapExceededError);
    assert.equal(res.made.length, 2);
    assert.deepEqual(res.notMade.map((x) => x.call_name), ['Solveig']);
    assert.equal(dogsNamed('Solveig').length, 0);
    assert.equal((await dogRepo.getById(d.dogs[0].id)).sire_id, d.dogs[1].id);
    assert.equal(d.done, true);
  } finally {
    dogRepo.create = real;
  }
});

test('seedTestsKennel: her dog\'s own kennel, else her only one; never an outside dog', () => {
  const k1 = { id: 'k1', is_own_kennel: true };
  const k2 = { id: 'k2', is_own_kennel: true };
  const out = { id: 'k3', is_own_kennel: false };
  assert.equal(seedTestsKennel({ ownership_type: 'owned' }, [k1, out]), k1);
  assert.equal(seedTestsKennel({ ownership_type: 'owned' }, [k1, k2]), null);
  assert.equal(seedTestsKennel({ ownership_type: 'co_owned', kennel_id: 'k2' }, [k1, k2]), k2);
  assert.equal(seedTestsKennel({ ownership_type: 'external' }, [k1]), null);
});

test('statuses and ownership follow the edition', () => {
  assert.deepEqual(g.statusChoices({ fullDogStatuses: false }).map((s) => s.value), ['active_breeding', 'retired_breeding', 'deceased']);
  assert.ok(g.statusChoices({ fullDogStatuses: true }).some((s) => s.value === 'pet_home'));
  assert.ok(!g.statusChoices({ fullDogStatuses: true }).some((s) => ['puppy', 'external_reference'].includes(s.value)));
  assert.deepEqual(g.ownershipChoices({ externalOwnership: false }).map((o) => o.value), ['owned', 'co_owned']);
  assert.deepEqual(g.ownershipChoices({ externalOwnership: true }).map((o) => o.value), ['owned', 'co_owned', 'external']);
});

test('Lite: the roster never has more rows than she has room for', () => {
  assert.equal(g.maxDogs(null), g.MAX_DOGS);
  assert.equal(g.maxDogs({ current: 4, cap: 6 }), 2);
  assert.equal(g.maxDogs({ current: 6, cap: 6 }), 0);
  const d = g.emptyDraft();
  d.dogs = ['Aa', 'Bb', 'Cc'].map((call_name) => Object.assign(g.newDog(), { call_name, sex: 'male' }));
  assert.match(g.stepProblem('roster', d, { maxDogs: 2 }), /room for 2 more dogs/);
  assert.equal(g.stepProblem('roster', d, { maxDogs: 3 }), null);
});

test('"Did you buy them?": a date for each (rough is fine), then an acquisition event and its price', async () => {
  const { eventRepo } = await import('../shared/data/eventRepo.js');
  const { expenseRepo } = await import('../shared/data/expenseRepo.js');
  assert.ok(g.canBeBought({ ownership_type: 'owned' }));
  assert.ok(!g.canBeBought({ ownership_type: 'external' }));
  assert.match(g.acquisitionProblem([]), /Tick the dogs/);
  assert.match(g.acquisitionProblem([{ name: 'Pip', date: '' }]), /rough date is fine/);
  assert.match(g.acquisitionProblem([{ name: 'Pip', date: tomorrow() }]), /future/);
  assert.match(g.acquisitionProblem([{ name: 'Pip', date: '2023-01-01', price: 'lots' }]), /number/);
  const dog = await dogRepo.create({ call_name: 'Wexley', sex: 'male', breed: 'Whippet', ownership_type: 'owned', status: 'active_breeding', kennel_id: kennelId });
  const plain = await dogRepo.create({ call_name: 'Yarrowby', sex: 'female', breed: 'Whippet', ownership_type: 'owned', status: 'active_breeding', kennel_id: kennelId });
  const rows = [
    { dogId: dog.id, name: 'Wexley', date: '2023-06-01', source: ' Ridgeline Whippets ', price: '1800' },
    { dogId: plain.id, name: 'Yarrowby', date: '2022-01-01', source: '', price: '' }
  ];
  assert.equal(g.acquisitionProblem(rows), null);
  await g.saveAcquisitions(rows);
  const [ev] = (await eventRepo.getForSubject('dog', dog.id)).filter((e) => e.event_type === 'acquisition');
  assert.equal(ev.title, 'Purchased from Ridgeline Whippets');
  assert.deepEqual(ev.details, { source: 'Ridgeline Whippets' });
  const exp = await expenseRepo.getOneByEvent(ev.id);
  assert.equal(exp.amount, 1800);
  assert.equal(exp.category, 'dog_purchase');
  assert.equal(exp.expense_date, '2023-06-01');
  const [ev2] = (await eventRepo.getForSubject('dog', plain.id)).filter((e) => e.event_type === 'acquisition');
  assert.equal(ev2.title, 'Purchased');
  assert.equal(await expenseRepo.getOneByEvent(ev2.id), null);
});

test('shots: the checklist\'s dated rows become vaccinations, due and reminded by how long they\'re good for', async () => {
  const { eventRepo } = await import('../shared/data/eventRepo.js');
  assert.match(g.shotsProblem([{ vaccine: 'Rabies', date: '', goodFor: '1' }]), /at least one/);
  assert.match(g.shotsProblem([{ vaccine: 'Rabies', date: tomorrow(), goodFor: '1' }]), /future/);
  assert.match(g.shotsProblem([{ vaccine: 'Rabies', date: '2024-01-01', goodFor: '' }]), /good for/);
  const rows = [
    { vaccine: 'Rabies', date: '2024-02-29', goodFor: '3' },
    { vaccine: 'DHPP', date: '2025-06-10', goodFor: 'lifetime' },
    { vaccine: 'Bordetella', date: '', goodFor: '1' }
  ];
  assert.equal(g.shotsProblem(rows), null);
  const evs = g.shotEvents('dog1', rows, { remind: true });
  assert.equal(evs.length, 2);
  assert.equal(evs[0].title, 'Rabies (3-year)');
  assert.deepEqual(evs[0].details, { vaccine: 'Rabies', next_due: '2027-02-28' });
  assert.equal(evs[0].reminder_date, '2027-02-28');
  assert.equal(evs[1].title, 'DHPP (lifetime)');
  assert.deepEqual(evs[1].details, { vaccine: 'DHPP' });
  assert.equal(evs[1].reminder_date, undefined);
  assert.equal(g.shotEvents('dog1', rows)[0].reminder_date, undefined);

  const dog = await dogRepo.create({ call_name: 'Shotwell', sex: 'male', breed: 'Whippet', ownership_type: 'owned', status: 'active_breeding', kennel_id: kennelId });
  await g.saveShots(dog.id, rows, { remind: true });
  const reminders = (await eventRepo.getReminders()).filter((e) => e.subject_id === dog.id);
  assert.deepEqual(reminders.map((e) => [e.title, e.reminder_date]), [['Rabies (3-year)', '2027-02-28']]);
});

test('who bred them: hers, or another breeder\'s kennel and contact, each made once; bred by her skips the purchase', async () => {
  const kennelsBefore = tables.kennels.rows.size;
  const contactsBefore = tables.contacts.rows.size;
  const d = rosterDraft([['Breezy', 'female'], ['Brisket', 'male'], ['Homebred', 'female']]);
  d.common.breed = 'Whippet';
  g.fillFromCommon(d);
  const [a, b, c] = d.dogs;
  a.breeder = { ...g.noBreeder(), bredBy: 'other', kennelName: 'Windmere Whippets', contactName: 'Lou Park', contactEmail: 'lou@example.com' };
  // The next dog starts with the one before's answer.
  b.breeder = g.breederDefault(d, 1);
  assert.equal(b.breeder.kennelName, 'Windmere Whippets');
  c.breeder = { ...g.noBreeder(), bredBy: 'me' };
  const ctx = { dogs: onFile, outsideBreeders: true };
  assert.equal(g.stepProblem('breeder:0', d, ctx), null);
  const bad = { ...g.noBreeder(), bredBy: 'other', contactPhone: '555' };
  d.dogs[0].breeder = bad;
  assert.match(g.stepProblem('breeder:0', d, ctx), /kennel/);
  bad.kennelName = 'Windmere Whippets';
  assert.match(g.stepProblem('breeder:0', d, ctx), /breeder's name/);
  assert.equal(g.stepProblem('breeder:0', d, { ...ctx, outsideBreeders: false }), null);
  d.dogs[0].breeder = { ...b.breeder };
  assert.match(g.reviewSections(d)[0].lines.at(-1), /Bred by Windmere Whippets \(a new kennel\), Lou Park \(a new contact\)/);
  assert.match(g.reviewSections(d)[2].lines.at(-1), /Bred by you/);

  await g.saveGuidedDogs(d);
  assert.equal(tables.kennels.rows.size, kennelsBefore + 1);
  assert.equal(tables.contacts.rows.size, contactsBefore + 1);
  const windmere = [...tables.kennels.rows.values()].find((k) => k.kennel_name === 'Windmere Whippets');
  assert.equal(windmere.is_own_kennel, false);
  const lou = [...tables.contacts.rows.values()].find((x) => x.name === 'Lou Park');
  assert.equal(lou.kennel_id, windmere.id);
  assert.deepEqual(lou.contact_type, ['breeder']);
  const [ra, rb, rc] = await Promise.all([a, b, c].map((x) => dogRepo.getById(x.id)));
  assert.equal(ra.breeder_kennel_id, windmere.id);
  assert.equal(rb.breeder_kennel_id, windmere.id);
  assert.equal(rc.breeder_kennel_id, rc.kennel_id);
  assert.ok(g.canBeBought(ra, [kennelId]));
  assert.ok(!g.canBeBought(rc, [rc.kennel_id]));

  // A typed kennel name already on file is that kennel, not a second one.
  const d2 = rosterDraft([['Breezer', 'male']]);
  d2.common.breed = 'Whippet';
  g.fillFromCommon(d2);
  d2.dogs[0].breeder = { ...g.noBreeder(), bredBy: 'other', kennelName: ' windmere whippets ' };
  await g.saveGuidedDogs(d2);
  assert.equal(tables.kennels.rows.size, kennelsBefore + 1);
  assert.equal((await dogRepo.getById(d2.dogs[0].id)).breeder_kennel_id, windmere.id);
});

test('findOrCreateOutside: an outside kennel by name, never an own one, never twice', async () => {
  const { kennelRepo } = await import('../shared/data/kennelRepo.js');
  const own = [...tables.kennels.rows.values()].find((k) => k.is_own_kennel);
  const a = await kennelRepo.findOrCreateOutside('  Hollowbrook  Setters ');
  assert.equal(a.created, true);
  assert.equal(a.kennel.is_own_kennel, false);
  const b = await kennelRepo.findOrCreateOutside('hollowbrook  setters');
  assert.equal(b.created, false);
  assert.equal(b.kennel.id, a.kennel.id);
  const c = await kennelRepo.findOrCreateOutside(own.kennel_name);
  assert.equal(c.created, true, 'her own kennel\'s name is not an outside kennel');
  await assert.rejects(() => kennelRepo.findOrCreateOutside('  '));
});

test('createPedigreeOnly: a registered name is enough; always somebody else\'s, off the roster', async () => {
  const made = await dogRepo.createPedigreeOnly({ registered_name: 'Ch Ancestor Annie', sex: 'female', breed: 'Whippet' });
  assert.equal(made.call_name, '');
  assert.equal(made.pedigree_only, true);
  assert.equal(made.ownership_type, 'external');
  assert.equal(made.status, 'external_reference');
  assert.ok(!(await dogRepo.getAll()).some((x) => x.id === made.id));
});
