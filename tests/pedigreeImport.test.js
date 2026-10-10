// pedigreeImport.test.js — matching and saving read pedigrees (data/pedigreeImport.js):
// numbers merge automatically (within a chart, across charts, against the app),
// names alone never do, parent disagreements need a decision, existing dogs are
// only filled in, and everything new is pedigree-only.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, planImport, commitImport, dogRepo;

before(async () => {
  ({ tables } = await installMemoryDb());
  ({ planImport, commitImport } = await import('../shared/data/pedigreeImport.js'));
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
  assert.deepEqual(pup.sireFrom['r:NP000002/01'], ['A']);
  assert.ok(!plan.ready);
  plan = planImport({ files, decisions: { [`sire:${pup.key}`]: 'r:NP000003/01' } });
  assert.equal(plan.rows.find((r) => r.name === 'Pup').sireKey, 'r:NP000003/01');
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
