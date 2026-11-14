// pedigreeImport.test.js — matching and saving read pedigrees (data/pedigreeImport.js):
// numbers merge automatically (within a chart, across charts, against the app),
// names alone never do, parent disagreements need a decision, existing dogs are
// only filled in, and everything new is pedigree-only.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, planImport, commitImport, normReg, dogRepo, breederName, matchBreederContacts;

before(async () => {
  ({ tables } = await installMemoryDb());
  ({ planImport, commitImport, normReg, breederName, matchBreederContacts } = await import('../shared/data/pedigreeImport.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
});

const dog = (path, name, reg = '', extra = {}) => [path, {
  path, registered_name: name, registration_number: reg, registry: reg ? 'AKC' : '', color_markings: '',
  notes: [], sex: path ? (path.endsWith('s') ? 'male' : 'female') : 'female', ...extra
}];
const file = (id, entries, breed = 'Boston Terrier') => ({ id, name: `${id}.pdf`, breed, dogs: new Map(entries) });

test('the same number twice in one chart is one dog (line-breeding)', () => {
  const plan = planImport({ files: [file('A', [
    dog('', 'Pup', 'NP000001/01'), dog('s', 'Sire', 'NP000002/01'), dog('d', 'Dam', 'NP000003/01'),
    dog('ss', 'Grand Sire', 'NP000009/01'), dog('ds', 'Grand Sire', 'NP000009/01')
  ])] });
  assert.equal(plan.rows.length, 4);
  assert.equal(plan.rows.find((r) => r.name === 'Grand Sire').sources.length, 2);
  assert.ok(plan.ready);
});

test('the same dog across two charts merges, and the chart dogs stay linked', () => {
  const plan = planImport({ files: [
    file('A', [dog('', 'Pup', 'NP000001/01'), dog('s', 'Sire', 'NP000002/01')]),
    file('B', [dog('', 'Sire', 'NP000002/01', { sex: 'male' }), dog('s', 'Grand Sire', 'NP000009/01')])
  ] });
  assert.equal(plan.rows.length, 3);
  const sire = plan.rows.find((r) => r.name === 'Sire');
  assert.deepEqual(sire.subjectOf, ['B']);
  assert.equal(plan.rows.find((r) => r.key === sire.sireKey).name, 'Grand Sire');
});

test('a dog already in the app is matched by an additional registration number', () => {
  const existing = [{ id: 'x2', call_name: 'Max', registry: 'UKC', registration_number: 'P1',
    additional_registrations: [{ registry: 'AKC', registration_number: 'NP000002/01', registered_name: '' }] }];
  const plan = planImport({ files: [file('A', [dog('', 'Pup', 'NP000001/01'), dog('s', 'Sire', 'NP000002/01')])], existing });
  const sire = plan.rows.find((r) => r.name === 'Sire');
  assert.equal(sire.action, 'existing');
  assert.equal(sire.existingId, 'x2');
});

test('a numbered dog already in the app is matched automatically', () => {
  const existing = [{ id: 'x1', call_name: 'Max', registration_number: 'np 000002/01' }];
  const plan = planImport({ files: [file('A', [dog('', 'Pup', 'NP000001/01'), dog('s', 'Sire', 'NP000002/01')])], existing });
  const sire = plan.rows.find((r) => r.name === 'Sire');
  assert.equal(sire.action, 'existing');
  assert.equal(sire.existingId, 'x1');
});

test('a name alone never matches: it waits for a decision', () => {
  const existing = [{ id: 'x1', call_name: 'Old Sire', registered_name: 'Old Sire' }];
  const files = [file('A', [dog('', 'Pup', 'NP000001/01'), dog('s', 'old  sire')])];
  let plan = planImport({ files, existing });
  const row = plan.rows.find((r) => r.name === 'old  sire');
  assert.equal(row.action, 'review');
  assert.ok(!plan.ready);
  assert.deepEqual(row.choices.map((c) => c.value), ['existing:x1', 'new']);
  plan = planImport({ files, existing, decisions: { [row.key]: 'existing:x1' } });
  assert.equal(plan.rows.find((r) => r.key === row.key).existingId, 'x1');
  assert.ok(plan.ready);
});

test('two charts that disagree on a sire need a choice', () => {
  const files = [
    file('A', [dog('', 'Pup', 'NP000001/01'), dog('s', 'Sire One', 'NP000002/01')]),
    file('B', [dog('', 'Pup', 'NP000001/01'), dog('s', 'Sire Two', 'NP000003/01')])
  ];
  let plan = planImport({ files });
  const pup = plan.rows.find((r) => r.name === 'Pup');
  assert.ok(pup.sireConflict);
  assert.deepEqual(pup.sireFrom['r:NP00000201'], ['A']);
  assert.ok(!plan.ready);
  plan = planImport({ files, decisions: { [`sire:${pup.key}`]: 'r:NP00000301' } });
  assert.equal(plan.rows.find((r) => r.name === 'Pup').sireKey, 'r:NP00000301');
  assert.ok(plan.ready);
});

test('an edit to a number re-matches the dog', () => {
  const files = [file('A', [dog('', 'Pup', 'NP000001/01'), dog('s', 'Sire', 'NPO00002/01')]), file('B', [dog('', 'Sire', 'NP000002/01')])];
  assert.equal(planImport({ files }).rows.length, 3);
  assert.equal(planImport({ files, edits: { 'A:s': { registration_number: 'NP000002/01' } } }).rows.length, 2);
});

test('a new dog with no breed blocks the import', () => {
  const plan = planImport({ files: [file('A', [dog('', 'Pup', 'NP000001/01')], '')] });
  assert.ok(!plan.ready);
});

test('commit: new dogs are pedigree-only and linked; an existing dog is only filled in', async () => {
  await tables.dogs.rows.set('own', {
    id: 'own', call_name: 'Bella', registered_name: '', sex: 'female', breed: 'Boston Terrier',
    ownership_type: 'external', owner_contact_id: 'c1', status: 'external_reference',
    registration_number: 'NP000001/01', color_markings: 'Seal & White', is_archived: false
  });
  const existing = await dogRepo.getAll({ includeArchived: true, includePedigreeOnly: true });
  const plan = planImport({ existing, files: [file('A', [
    dog('', 'A-K Bella', 'NP000001/01', { color_markings: 'Black & White' }),
    dog('s', 'Sire', 'NP000002/01'), dog('d', 'Dam', 'NP000003/01'), dog('ss', 'Grand Sire', 'NP000009/01')
  ])] });
  assert.ok(plan.ready);
  const res = await commitImport(plan);
  assert.equal(res.created, 3);
  assert.equal(res.updated, 1);
  const bella = await dogRepo.getById('own');
  assert.equal(bella.registered_name, 'A-K Bella', 'blank filled');
  assert.equal(bella.color_markings, 'Seal & White', 'never overwritten');
  assert.ok(!bella.pedigree_only, 'an existing dog is never made pedigree-only');
  const sire = await dogRepo.getById(bella.sire_id);
  assert.equal(sire.registered_name, 'Sire');
  assert.equal(sire.call_name, '', 'a chart gives registered names, not call names');
  assert.equal(bella.call_name, 'Bella', 'an existing call name is untouched');
  assert.equal(sire.pedigree_only, true);
  assert.equal(sire.sex, 'male');
  assert.equal((await dogRepo.getById(sire.sire_id)).registered_name, 'Grand Sire');
  assert.equal((await dogRepo.getAll()).length, 1, 'the new ancestors stay out of the kennel lists');
  assert.equal(res.subjects.A, 'own');
});

test('a kept PDF is filed as a pedigree document on the chart’s dog, under a kennel', async () => {
  tables.kennels.rows.set('k1', { id: 'k1', kennel_name: 'Mine', is_own_kennel: true, is_archived: false });
  tables.kennels.rows.set('k2', { id: 'k2', kennel_name: 'Also mine', is_own_kennel: true, is_archived: false });
  const plan = planImport({ files: [file('A', [dog('', 'Pup', 'NP000001/01'), dog('s', 'Sire', 'NP000002/01')])] });
  const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
  // Two own kennels, none active, and a pedigree-only dog lends none: the page's choice is used.
  const res = await commitImport(plan, { storeFiles: [{ fileId: 'A', blob, filename: 'pup.pdf', kennelId: 'k2' }] });
  assert.deepEqual(res.fileErrors, []);
  const docs = [...tables.documents.rows.values()];
  assert.equal(docs.length, 1);
  assert.equal(docs[0].dog_id, res.subjects.A);
  assert.equal(docs[0].doc_type, 'pedigree');
  assert.equal(docs[0].kennel_id, 'k2');
  assert.equal(docs[0].registration_number, 'NP000001/01');
});

test('without a kennel to file under, the dogs still save and the PDF is reported', async () => {
  tables.kennels.rows.set('k1', { id: 'k1', kennel_name: 'Mine', is_own_kennel: true, is_archived: false });
  tables.kennels.rows.set('k2', { id: 'k2', kennel_name: 'Also mine', is_own_kennel: true, is_archived: false });
  const plan = planImport({ files: [file('A', [dog('', 'Pup', 'NP000001/01')])] });
  const res = await commitImport(plan, { storeFiles: [{ fileId: 'A', blob: new Blob(['x']), filename: 'pup.pdf' }] });
  assert.equal(res.created, 1);
  assert.equal(res.fileErrors.length, 1);
  assert.equal(tables.documents.rows.size, 0);
});

test('a chart name is a registered name: it never matches an existing call name', () => {
  const existing = [{ id: 'x1', call_name: 'Bella', registered_name: '' },
    { id: 'x2', call_name: 'Bee', registered_name: 'Bella' }];
  const plan = planImport({ existing, files: [file('A', [dog('', 'Bella', '')])] });
  const row = plan.rows[0];
  assert.equal(row.action, 'review');
  assert.deepEqual(row.choices.map((c) => c.value), ['existing:x2', 'new'], 'only the registered-name match is offered');
});

test('a chart name is checked against the registered names of the kennel’s current dogs, titles ignored', () => {
  const existing = [
    { id: 'own', call_name: 'Bella', registered_name: 'GCH A-K Bella’s Star', ownership_type: 'owned', status: 'active_breeding', is_archived: false },
    { id: 'other', call_name: 'A-K Bella’s Star', registered_name: '', ownership_type: 'owned', status: 'active_breeding', is_archived: false }
  ];
  const plan = planImport({ existing, files: [file('A', [dog('', "A-K Bella's Star", '')])] });
  const row = plan.rows[0];
  assert.equal(row.action, 'review', 'a name alone still never matches automatically');
  assert.deepEqual(row.choices.map((c) => c.value), ['existing:own', 'new'], 'the current dog is offered by its registered name; a call name never is');
  assert.match(row.choices[0].label, /GCH A-K Bella’s Star “Bella”/);
});

test('a numbered chart dog is offered a current dog with the same registered name and no number', () => {
  const existing = [{ id: 'own', call_name: 'Max', registered_name: 'CH Dark Knight', is_archived: false }];
  const plan = planImport({ existing, files: [file('A', [dog('', 'Dark Knight', 'NP000001/01')])] });
  assert.deepEqual(plan.rows[0].choices.map((c) => c.value), ['existing:own', 'new']);
});

test('a registration number matches however it was typed', () => {
  for (const stored of ['NP165114/01', 'np 165114-01', 'NP16511401', 'AKC NP165114/01', 'AKC# NP165114.01']) {
    const existing = [{ id: 'own', call_name: 'Bella', registered_name: 'Somebody Else', registration_number: stored }];
    const plan = planImport({ existing, files: [file('A', [dog('', 'A-K Bella', 'NP165114/01')])] });
    assert.equal(plan.rows[0].action, 'existing', stored);
    assert.equal(plan.rows[0].existingId, 'own', stored);
  }
});

test('your dog with the same registered name but a different number is offered, never silently duplicated', () => {
  const existing = [{ id: 'own', call_name: 'Bella', registered_name: 'A-K Bella', registration_number: 'NP165114/1' }];
  const plan = planImport({ existing, files: [file('A', [dog('', 'A-K Bella', 'NP165114/01')])] });
  const row = plan.rows[0];
  assert.equal(row.action, 'review');
  assert.ok(!plan.ready);
  assert.deepEqual(row.choices.map((c) => c.value), ['existing:own', 'new']);
  assert.ok(row.issues.some((i) => /registration numbers differ/.test(i)));
  const chosen = planImport({ existing, files: [file('A', [dog('', 'A-K Bella', 'NP165114/01')])], decisions: { [row.key]: 'existing:own' } });
  assert.equal(chosen.rows[0].action, 'existing');
});

test('an AKC number matches with or without the four digits printed after it', () => {
  for (const stored of ['NP888072/07 03-25', 'NP888072/07 03/25', 'NP888072/07', 'NP8880720703 25']) {
    const existing = [{ id: 'own', call_name: 'Bella', registered_name: 'A-K Bella', registration_number: stored }];
    const plan = planImport({ existing, files: [file('A', [dog('', 'A-K Bella', 'NP888072/07 03-25')])] });
    assert.equal(plan.rows[0].action, 'existing', stored);
  }
  assert.equal(normReg('NP888072/07 03-25'), normReg('NP888072/07'));
  assert.notEqual(normReg('NP888072/07'), normReg('NP888072/08'));
});

// --- The chart's breeder, saved as a contact ---------------------------------------

test('breeder: an all-caps name is name-cased; contacts match by name, case and punctuation ignored', () => {
  assert.equal(breederName('JAMIE COTTON'), 'Jamie Cotton');
  assert.equal(breederName('MR. JOHNNY W SPENCE'), 'Johnny W Spence', 'honorific off');
  assert.equal(breederName("MARY O'NEIL"), "Mary O'Neil");
  assert.equal(breederName('Jo deVries'), 'Jo deVries', 'mixed case kept as printed');
  const contacts = [
    { id: 'a', name: 'Jamie  Cotton', is_archived: false },
    { id: 'b', name: 'jamie cotton.', is_archived: false },
    { id: 'c', name: 'Jamie Cotton', is_archived: true },
    { id: 'd', name: 'Jamie Cottonwood', is_archived: false }
  ];
  assert.deepEqual(matchBreederContacts('JAMIE COTTON', contacts).map((c) => c.id), ['a', 'b']);
  assert.deepEqual(matchBreederContacts('', contacts), []);
});

test('commit: a new breeder name is one new contact across charts, tagged Breeder', async () => {
  const plan = planImport({ existing: [], files: [
    file('A', [dog('', 'Pup One', 'NP000001/01')]), file('B', [dog('', 'Pup Two', 'NP000002/01')])
  ] });
  const res = await commitImport(plan, { breeders: [{ fileId: 'A', name: 'JAMIE COTTON' }, { fileId: 'B', name: 'Jamie Cotton' }] });
  assert.equal(res.contactsCreated, 1);
  const contacts = [...tables.contacts.rows.values()];
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name, 'Jamie Cotton');
  assert.deepEqual(contacts[0].contact_type, ['breeder']);
  assert.ok(!(await dogRepo.getById(res.subjects.A)).breeder_kennel_id, 'no kennel to link');
});

test('commit: a breeder already on file is tagged Breeder, and her kennel becomes the dog\'s breeder kennel', async () => {
  await tables.contacts.rows.set('c1', { id: 'c1', name: 'Jamie Cotton', contact_type: ['co_owner'], kennel_id: 'k9', is_archived: false });
  const plan = planImport({ existing: [], files: [file('A', [dog('', 'Pup', 'NP000001/01')])] });
  const res = await commitImport(plan, { breeders: [{ fileId: 'A', contactId: 'c1' }] });
  assert.equal(res.contactsCreated, 0);
  assert.deepEqual(tables.contacts.rows.get('c1').contact_type, ['co_owner', 'breeder']);
  assert.equal((await dogRepo.getById(res.subjects.A)).breeder_kennel_id, 'k9');
});

test('commit: the chart dog\'s microchip is saved, and only fills a blank one', async () => {
  await tables.dogs.rows.set('own', { id: 'own', call_name: 'Laire', sex: 'male', breed: 'Boston Terrier',
    ownership_type: 'external', owner_contact_id: 'c1', status: 'external_reference', registration_number: 'NR019857/06', microchip_id: '', is_archived: false });
  const existing = await dogRepo.getAll({ includeArchived: true, includePedigreeOnly: true });
  const plan = planImport({ existing, files: [
    file('A', [dog('', 'DND Laire of Legacy', 'NR019857/06', { microchip_id: '900263007514602' })]),
    file('B', [dog('', 'New Pup', 'NP000005/01', { microchip_id: '111222333444555' })])
  ] });
  const res = await commitImport(plan);
  assert.equal((await dogRepo.getById('own')).microchip_id, '900263007514602');
  assert.equal((await dogRepo.getById(res.subjects.B)).microchip_id, '111222333444555');
});

// --- Titles, country and Imported (Dog Titles Field Plan §8 phase 4) ----------

const jr = (path, name, n, extra = {}) => dog(path, name, `JR ${n}`, { registry: 'JR', ...extra });

test('new dogs: titles, country, a second registration and a pre-ticked Imported are saved', async () => {
  const plan = planImport({ files: [file('A', [
    dog('', 'Pup', 'NP000001/01', { additional_registrations: [{ registry: 'JR', registration_number: 'JR 777', registered_name: '' }] }),
    jr('s', 'Srb Sire', 1), jr('d', 'Srb Dam', 2),
    jr('ss', 'X', 3, { titles: [{ abbr: 'GCH', organization: '', earned_on: '' }, { abbr: 'CH', organization: '', earned_on: '' }] })
  ])] });
  const pup = plan.rows.find((r) => r.name === 'Pup');
  assert.equal(pup.importOffer, 'ticked');
  assert.equal(pup.imported, true);
  assert.equal(pup.country_of_origin, 'Serbia', 'dual-registered: its own JR number');
  const sire = plan.rows.find((r) => r.name === 'Srb Sire');
  assert.equal(sire.country_of_origin, 'Serbia');
  assert.equal(sire.importOffer, null, 'a foreign-only dog is never offered Imported');
  const res = await commitImport(plan);
  const saved = await dogRepo.getById(res.subjects.A);
  assert.equal(saved.imported, true);
  assert.equal(saved.import_country, 'Serbia');
  assert.equal(saved.country_of_origin, 'Serbia');
  assert.deepEqual(saved.additional_registrations.map((r) => r.registration_number), ['JR 777']);
  const s = await dogRepo.getById(saved.sire_id);
  assert.equal(s.country_of_origin, 'Serbia');
  assert.equal(s.imported, false);
  // KennelPort's ask 1: the chart grandsire "GCH CH X" holds both titles.
  assert.deepEqual((await dogRepo.getById(s.sire_id)).titles.map((t) => t.abbr), ['GCH', 'CH']);
  assert.ok(!(await dogRepo.getById(s.sire_id)).notes.includes('Titles:'));
});

test('an unticked offer stays unticked; her edits to titles, country and Imported win', async () => {
  const files = [file('A', [dog('', 'Pup', 'NP000001/01'), jr('s', 'Srb Sire', 1), dog('d', 'Dam', 'NP000003/01'),
    dog('ss', 'Gs', 'NP000009/01', { titles: [{ abbr: 'CH' }] })])];
  let plan = planImport({ files });
  const pup = plan.rows.find((r) => r.name === 'Pup');
  assert.equal(pup.importOffer, 'offer');
  assert.equal(pup.imported, false);
  assert.equal(pup.country_of_origin, '', 'born at home: no country until she ticks Imported');
  assert.equal(pup.importCountry, 'Serbia');
  const gs = plan.rows.find((r) => r.name === 'Gs');
  const edits = {
    'A:': { imported: true },
    'A:ss': { titles: [{ abbr: 'GCH' }, { abbr: 'CH' }], country_of_origin: 'Canada' }
  };
  plan = planImport({ files, edits });
  const res = await commitImport(plan);
  const saved = await dogRepo.getById(res.subjects.A);
  assert.equal(saved.imported, true);
  assert.equal(saved.import_country, 'Serbia', 'ticked with a blank box: the country it came from');
  assert.equal(saved.country_of_origin, 'Serbia');
  const g = await dogRepo.getById((await dogRepo.getById(saved.sire_id)).sire_id);
  assert.equal(g.registered_name, 'Gs');
  assert.deepEqual(g.titles.map((t) => t.abbr), ['GCH', 'CH']);
  assert.equal(g.country_of_origin, 'Canada');
  assert.equal(gs.importOffer, null);
});

test('an all-home line gets no country and no Imported', () => {
  const plan = planImport({ files: [file('A', [dog('', 'Pup', 'NP000001/01'), dog('s', 'S', 'NP000002/01'), dog('d', 'D', 'NP000003/01')])] });
  for (const r of plan.rows) {
    assert.equal(r.country_of_origin, '');
    assert.equal(r.importOffer, null);
    assert.equal(r.imported, false);
  }
});

test('home follows her own dogs’ registry: a Serbian kennel’s JR dogs are home', () => {
  const existing = [1, 2].map((i) => ({ id: `o${i}`, call_name: `O${i}`, registry: 'JR', registration_number: `JR ${i}0`, ownership_type: 'owned' }));
  const plan = planImport({ existing, files: [file('A', [jr('', 'Pup', 1), jr('s', 'S', 2), jr('d', 'D', 3)])] });
  for (const r of plan.rows) { assert.equal(r.country_of_origin, ''); assert.equal(r.importOffer, null); }
});

test('a dog she has is only offered what it lacks, each unticked until ticked', async () => {
  await tables.dogs.rows.set('own', {
    id: 'own', call_name: 'Bella', registered_name: 'CH Bella', sex: 'female', breed: 'Boston Terrier',
    ownership_type: 'external', owner_contact_id: 'c1', status: 'external_reference',
    registration_number: 'NP000001/01', titles: [{ abbr: 'CGC', organization: '', earned_on: '' }], is_archived: false
  });
  const existing = await dogRepo.getAll({ includeArchived: true, includePedigreeOnly: true });
  const files = [file('A', [
    dog('', 'Bella', 'NP000001/01', { titles: [{ abbr: 'GCH' }, { abbr: 'CH' }, { abbr: 'CGC' }] }),
    jr('s', 'Srb Sire', 1), jr('d', 'Srb Dam', 2)
  ])];
  let plan = planImport({ existing, files });
  const row = plan.rows.find((r) => r.existingId === 'own');
  assert.deepEqual(row.fill.titles.map((t) => t.abbr), ['GCH'], 'CH is in its name, CGC on its titles');
  assert.equal(row.fill.imported, true);
  assert.equal(row.fill.importCountry, 'Serbia');
  assert.equal(row.fill.country, 'Serbia');
  assert.deepEqual([row.fill.titlesOn, row.fill.countryOn, row.fill.importedOn], [false, false, false]);

  // Nothing ticked: nothing of the three is written.
  await commitImport(plan);
  let bella = await dogRepo.getById('own');
  assert.deepEqual(bella.titles.map((t) => t.abbr), ['CGC']);
  assert.ok(!bella.imported);
  assert.ok(!bella.country_of_origin);

  plan = planImport({ existing: await dogRepo.getAll({ includeArchived: true, includePedigreeOnly: true }), files,
    decisions: { 'fill:titles:r:NP00000101': true, 'fill:imported:r:NP00000101': true } });
  const r2 = plan.rows.find((r) => r.existingId === 'own');
  assert.ok(r2.fill.titlesOn && r2.fill.importedOn && !r2.fill.countryOn, `key ${r2.key}`);
  await commitImport(plan);
  bella = await dogRepo.getById('own');
  assert.deepEqual(bella.titles.map((t) => t.abbr), ['CGC', 'GCH']);
  assert.equal(bella.imported, true);
  assert.equal(bella.import_country, 'Serbia');
  assert.equal(bella.country_of_origin, 'Serbia', 'Imported brings its country with it');
});

test('a country she already set is never offered or overwritten', () => {
  const existing = [{ id: 'x', call_name: 'X', registry: 'JR', registration_number: 'JR 1', country_of_origin: 'Montenegro' }];
  const plan = planImport({ existing, files: [file('A', [jr('', 'X', 1)])] });
  assert.equal(plan.rows[0].fill, null);
});

test('a dual-registered dog matches a dog she has by its second number', () => {
  const existing = [{ id: 'x', call_name: 'X', registry: 'JR', registration_number: 'JR 777' }];
  const plan = planImport({ existing, files: [file('A', [
    dog('', 'Pup', 'NP000001/01', { additional_registrations: [{ registry: 'JR', registration_number: 'JR 777', registered_name: '' }] })
  ])] });
  assert.equal(plan.rows[0].existingId, 'x');
});
