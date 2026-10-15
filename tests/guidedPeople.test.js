// guidedPeople.test.js — Kels's "Add people" task, its data half
// (data/guidedPeople.js), and the one contact rule it shares (data/contactSearch.js):
// which steps apply (the vet question, matches, kennels, breeders on file), what
// each step refuses, the review, and the save, run through the REAL repos against
// support/memoryDb.js. The save is resumable, so a second run makes nothing twice.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let g; let cs; let tables; let contactRepo; let kennelRepo;

before(async () => {
  ({ tables } = await installMemoryDb());
  g = await import('../shared/data/guidedPeople.js');
  cs = await import('../shared/data/contactSearch.js');
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
});

const live = () => [...tables.contacts.rows.values()].filter((c) => !c.is_archived);
const named = (name) => live().filter((c) => c.name === name);

// A draft with these roster rows, through the roster step's own after().
function rosterDraft(rows) {
  const d = g.emptyDraft();
  d.people = rows.map(([name, type]) => g.newPerson({ name, type }));
  g.afterRoster(d);
  return d;
}

// --- contactSearch -------------------------------------------------------------------

test('contact match: email or phone is certain; a same or near name only possible; never a single first name', () => {
  const contacts = [
    { id: 'a', name: 'Pat Smith', email: 'PAT@x.com', phone: '' },
    { id: 'b', name: 'Robin Lee', phone: '+1 (555) 222-3333' },
    { id: 'c', name: 'Patricia Smyth' },
    { id: 'd', name: 'Pat Smyth' },
    { id: 'e', name: 'Pat', is_archived: true }
  ];
  const m = (typed) => cs.findContactMatches(typed, contacts).map((x) => [x.contact.id, x.strength, x.reason]);
  assert.deepEqual(m({ name: 'Someone', email: ' pat@x.com' }), [['a', 'certain', 'email']]);
  assert.deepEqual(m({ name: 'Bob', phone: '555.222.3333' }), [['b', 'certain', 'phone']]);
  assert.deepEqual(m({ name: 'pat smith' }), [['a', 'possible', 'name'], ['d', 'possible', 'similar name']]);
  assert.deepEqual(m({ name: 'Pat' }), [], 'a lone first name is too little to suggest anyone');
  assert.deepEqual(cs.findContactMatches({ name: 'Pat Smith' }, contacts, { excludeIds: ['a'] }).map((x) => x.contact.id), ['d']);
  assert.equal(cs.contactMatchReason({ reason: 'phone' }), 'Same phone');
});

test('hasVet: an unarchived contact tagged Vet', () => {
  assert.equal(cs.hasVet([{ contact_type: ['vet'], is_archived: true }]), false);
  assert.equal(cs.hasVet([{ contact_type: ['breeder', 'vet'] }]), true);
});

// --- Steps --------------------------------------------------------------------------------

test('the vet question: asked when no one listed or on file is a vet, and stays once answered', () => {
  const d = rosterDraft([['Pat Smith', 'buyer']]);
  assert.deepEqual(g.stepsFor(d, { contacts: [] }), ['roster', 'vet', 'person:0', 'review']);
  assert.ok(!g.stepsFor(d, { contacts: [{ id: 'v', name: 'Doc', contact_type: ['vet'] }] }).includes('vet'), 'a vet on file');
  const withVet = rosterDraft([['Pat Smith', 'buyer'], ['Lakeside Clinic', 'vet']]);
  assert.ok(!g.stepsFor(withVet, { contacts: [] }).includes('vet'), 'a vet on the list');

  // "Yes, add my vet": the vet joins the list (and gets details); the question stays.
  d.vet = { answer: 'add', name: 'Lakeside Clinic', contactId: null };
  assert.equal(g.stepProblem('vet', d), null);
  g.afterVet(d);
  assert.deepEqual(d.people.map((p) => [p.name, p.types, p.fromVet]), [['Pat Smith', ['buyer'], false], ['Lakeside Clinic', ['vet'], true]]);
  assert.deepEqual(g.stepsFor(d, { contacts: [] }), ['roster', 'vet', 'common', 'person:0', 'person:1', 'review']);
  // Changing to "Not now" takes the vet back off.
  d.vet.answer = 'no';
  g.afterVet(d);
  assert.deepEqual(d.people.map((p) => p.name), ['Pat Smith']);
  assert.ok(g.stepsFor(d, { contacts: [] }).includes('vet'));
});

test('the vet question refuses: no answer, no name, no pick, a name already on the list', () => {
  const d = rosterDraft([['Lakeside Clinic', 'buyer']]);
  assert.match(g.stepProblem('vet', d), /Tap one/);
  d.vet = { answer: 'add', name: '', contactId: null };
  assert.match(g.stepProblem('vet', d), /Who's your vet/);
  d.vet.name = 'lakeside clinic';
  assert.match(g.stepProblem('vet', d), /already on the list/);
  d.vet = { answer: 'onfile', name: '', contactId: null };
  assert.match(g.stepProblem('vet', d), /Pick your vet/);
});

test('roster refuses: nobody, a blank name, no type, the same name twice', () => {
  const d = g.emptyDraft();
  assert.match(g.stepProblem('roster', d), /Type the name/);
  d.people = [g.newPerson({ name: '', type: 'buyer' })];
  assert.match(g.stepProblem('roster', d), /Type a name for each/);
  d.people = [g.newPerson({ name: 'Pat', type: '' })];
  assert.match(g.stepProblem('roster', d), /What is Pat to you/);
  d.people = [g.newPerson({ name: 'Pat', type: 'buyer' }), g.newPerson({ name: 'pat', type: 'vet' })];
  assert.match(g.stepProblem('roster', d), /on the list twice/);
});

test('roster: the main type joins their types; changing it there replaces it', () => {
  const d = rosterDraft([['Pat', 'buyer']]);
  assert.deepEqual(d.people[0].types, ['buyer']);
  d.people[0].types.push('co_owner');
  d.people[0].type = 'breeder';
  g.afterRoster(d);
  assert.deepEqual(d.people[0].types, ['breeder', 'co_owner']);
});

test('a match is asked after their details; a breeder\'s kennel unless the one on file has one; breeders on file without one', () => {
  const contacts = [
    { id: 'c1', name: 'Pat Smith', email: 'pat@x.com', contact_type: ['buyer'] },
    { id: 'c2', name: 'Jo Breeder', contact_type: ['breeder'], kennel_id: 'k1' },
    { id: 'c3', name: 'Sam Old', contact_type: ['breeder'] },
    { id: 'v', name: 'Doc', contact_type: ['vet'] }
  ];
  const d = rosterDraft([['Pat Smith', 'buyer'], ['Jo Breeder', 'breeder']]);
  d.people[0].email = 'PAT@x.com';
  g.findMatchesFor(d.people[0], contacts, d);
  g.findMatchesFor(d.people[1], contacts, d);
  assert.deepEqual(d.people[0].matchIds, ['c1']);
  assert.deepEqual(g.stepsFor(d, { contacts }), ['roster', 'common', 'person:0', 'match:0', 'person:1', 'match:1', 'kennel:1', 'breeders', 'review']);
  d.people[1].match = 'c2';
  assert.ok(!g.stepsFor(d, { contacts }).includes('kennel:1'), 'their kennel on file is their kennel');
  d.people[1].match = 'none';
  assert.match(g.stepProblem('kennel:1', d), /Tap one/);
  d.people[1].kennel = { has: 'yes', kennelId: null, kennelName: '' };
  assert.match(g.stepProblem('kennel:1', d), /Pick their kennel/);
  d.people[1].kennel.kennelName = 'Elmwod Kennels';
  const like = g.stepProblem('kennel:1', d, { outsideKennels: [{ id: 'k9', kennel_name: 'Elmwood Kennels' }] });
  assert.match(like.message, /Is that Elmwood Kennels/);
  // The same details keep her answer; a changed email asks again.
  d.people[0].match = 'c1';
  g.findMatchesFor(d.people[0], contacts, d);
  assert.equal(d.people[0].match, 'c1');
  d.people[0].email = 'new@x.com';
  g.findMatchesFor(d.people[0], contacts, d);
  assert.equal(d.people[0].match, null);
  assert.deepEqual(g.breedersWithoutKennel(d, contacts).map((c) => c.id), ['c3']);
});

test('how she met them fills in on each person, keeping her own changes', () => {
  const d = rosterDraft([['A', 'buyer'], ['B', 'buyer']]);
  d.common.first_contact_source = 'Facebook';
  g.fillFromCommon(d);
  d.people[1].first_contact_source = 'A show';
  d.common.first_contact_source = 'Instagram';
  g.fillFromCommon(d);
  assert.deepEqual(d.people.map((p) => p.first_contact_source), ['Instagram', 'A show']);
});

test('review: each person, then what changes on contacts she has', () => {
  const d = rosterDraft([['Jo', 'breeder']]);
  Object.assign(d.people[0], { phone: '555', email: 'jo@x.com', first_contact_source: 'A show', kennel: { has: 'yes', kennelId: null, kennelName: 'Elm' } });
  d.vet = { answer: 'onfile', name: '', contactId: 'v' };
  d.existing = { c3: { kennelId: 'k1', kennelName: '' } };
  const s = g.reviewSections(d, { contact: (id) => ({ v: 'Doc', c3: 'Sam' }[id]), kennel: (id) => (id === 'k1' ? 'Oak Kennel' : '') });
  assert.deepEqual(s[0].lines, ['Breeder.', '555, jo@x.com.', 'Met through A show.', 'Kennel: Elm (a new kennel).']);
  assert.deepEqual(s[0].steps, { details: 'person:0', kennel: 'kennel:0' });
  assert.deepEqual(s[1].lines, ['Doc becomes your vet.', 'Sam\'s kennel: Oak Kennel.']);
});

// --- The save --------------------------------------------------------------------------------

test('save: new people and kennels, one on file filled in (never overwritten), vet tagged, breeders on file linked; resumable', async () => {
  const onFile = await contactRepo.create({ name: 'Pat Smith', email: 'pat@x.com', phone: '111', contact_type: ['buyer'] });
  const vet = await contactRepo.create({ name: 'Doc Ames', contact_type: [] });
  const oldBreeder = await contactRepo.create({ name: 'Sam Old', contact_type: ['breeder'] });
  const d = rosterDraft([['Patty Smith', 'co_owner'], ['Jo Breeder', 'breeder'], ['Kim Breeder', 'breeder']]);
  Object.assign(d.people[0], { match: onFile.id, phone: '999', address: '1 Elm St' });
  d.people[1].kennel = { has: 'yes', kennelId: null, kennelName: 'Hilltop Kennels' };
  d.people[2].kennel = { has: 'yes', kennelId: null, kennelName: 'hilltop  kennels' };
  d.vet = { answer: 'onfile', name: '', contactId: vet.id };
  d.existing = { [oldBreeder.id]: { kennelId: null, kennelName: 'Old Oak' } };

  const res = await g.saveGuidedPeople(d);
  const pat = await contactRepo.getById(onFile.id);
  assert.equal(pat.name, 'Pat Smith', 'name kept');
  assert.equal(pat.phone, '111', 'never overwritten');
  assert.equal(pat.address, '1 Elm St', 'blank filled in');
  assert.deepEqual(pat.contact_type, ['buyer', 'co_owner']);
  const [jo] = named('Jo Breeder');
  const [kim] = named('Kim Breeder');
  assert.ok(jo.kennel_id && jo.kennel_id === kim.kennel_id, 'one kennel for one name');
  assert.equal((await kennelRepo.getById(jo.kennel_id)).is_own_kennel, false);
  assert.deepEqual((await contactRepo.getById(vet.id)).contact_type, ['vet']);
  const sam = await contactRepo.getById(oldBreeder.id);
  assert.ok(sam.kennel_id);
  assert.deepEqual(new Set(res.kennelIds), new Set([jo.kennel_id, sam.kennel_id]));
  assert.equal(res.people.length, 3);

  // A retry makes nothing twice.
  const before = tables.contacts.rows.size;
  const kennels = tables.kennels.rows.size;
  d.done = false;
  await g.saveGuidedPeople(d);
  assert.equal(tables.contacts.rows.size, before);
  assert.equal(tables.kennels.rows.size, kennels);
});

test('a vet added by name is made a Vet contact with their details', async () => {
  const d = rosterDraft([['Ann Buyer', 'buyer']]);
  d.vet = { answer: 'add', name: 'Riverside Vets', contactId: null };
  g.afterVet(d);
  d.people[1].phone = '555-0100';
  await g.saveGuidedPeople(d);
  const [v] = named('Riverside Vets');
  assert.deepEqual(v.contact_type, ['vet']);
  assert.equal(v.phone, '555-0100');
});

// --- The dogs they bred -------------------------------------------------------------------------

test('dogs they bred: only her dogs with none; this run\'s kennels first, never her own; a set one is never changed', () => {
  const dogs = [
    { id: 'd1', ownership_type: 'owned' },
    { id: 'd2', ownership_type: 'co_owned' },
    { id: 'd3', ownership_type: 'owned', breeder_kennel_id: 'k0' },
    { id: 'd4', ownership_type: 'external' },
    { id: 'd5', ownership_type: 'owned', pedigree_only: true },
    { id: 'd6', ownership_type: 'owned', is_archived: true }
  ];
  assert.deepEqual(g.dogsWithoutBreeder(dogs).map((x) => x.id), ['d1', 'd2']);
  const kennels = [
    { id: 'own', kennel_name: 'Mine', is_own_kennel: true },
    { id: 'kb', kennel_name: 'Beta' },
    { id: 'ka', kennel_name: 'Alpha' },
    { id: 'kn', kennel_name: 'New One' }
  ];
  assert.deepEqual(g.breederKennelChoices(kennels, ['kn']).map((c) => [c.kennel.id, c.fromRun]), [['kn', true], ['ka', false], ['kb', false]]);
  assert.deepEqual(g.breederLinks({ d1: 'kn', d2: '', d3: 'ka', d4: 'ka' }, dogs, kennels), [{ dogId: 'd1', kennelId: 'kn' }]);
  assert.deepEqual(g.breederLinks({ d1: 'own' }, dogs, kennels), [], 'never her own kennel');
});

test('pendingPeopleDraft: unfinished drafts of this version only', () => {
  assert.equal(g.pendingPeopleDraft(null), null);
  assert.equal(g.pendingPeopleDraft({ ...g.emptyDraft(), done: true }), null);
  assert.equal(g.pendingPeopleDraft({ ...g.emptyDraft(), v: 0 }), null);
  const d = g.emptyDraft();
  assert.equal(g.pendingPeopleDraft(d), d);
  assert.equal(g.draftLabel(rosterDraft([['A', 'buyer'], ['B', 'vet'], ['C', 'other']])), 'A, B and C');
});
