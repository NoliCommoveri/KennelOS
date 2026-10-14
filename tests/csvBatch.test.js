// csvBatch.test.js — the several-file import's file-type guess and run order
// (data/csvBatch.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEntity, orderFiles, ENTITY_PAGE, HANDOFF_ENTITIES } from '../shared/data/csvBatch.js';
import { getMapping } from '../shared/data/csvImport.js';
import { HELP_ENTITIES } from '../shared/data/csvImportHelp.js';

test('every importer has a page, and every link names an importer', () => {
  assert.deepEqual(Object.keys(ENTITY_PAGE).sort(), [...HELP_ENTITIES].sort());
  for (const e of HELP_ENTITIES) {
    for (const l of getMapping(e).links) assert.ok(HELP_ENTITIES.includes(l), `${e} links to unknown "${l}"`);
  }
  for (const e of HANDOFF_ENTITIES.keys()) assert.ok(ENTITY_PAGE[e]);
});

test('each importer\'s own template is recognized as that importer, clearly', () => {
  for (const e of HELP_ENTITIES) {
    const d = detectEntity(getMapping(e).templateHeaders);
    assert.equal(d.entity, e);
    assert.equal(d.sure, true, `${e} template is a toss-up`);
  }
});

test('headers are read in any spelling, and aliases count', () => {
  assert.equal(detectEntity(['Kennel Name', 'Prefix', 'Location']).entity, 'kennel');
  assert.equal(detectEntity(['Dog Name', 'Type', 'Event Date', 'Title']).entity, 'event');
  assert.equal(detectEntity(['Name', 'Sex', 'DOB', 'Breed', 'Ownership', 'Status']).entity, 'dog');
});

test('a file sharing only a few columns with an importer is not guessed at', () => {
  // The ancestor checklist: three of its ten columns are dog columns.
  const d = detectEntity(['subject_dog', 'position', 'generation', 'registered_name', 'registration_number',
    'stud_book_date', 'color', 'extra', 'confidence', 'note']);
  assert.equal(d.entity, null);
  assert.equal(detectEntity(['notes']).entity, null);
  assert.equal(detectEntity([]).entity, null);
});

test('detection only considers the importers this edition offers', () => {
  const d = detectEntity(['kennel_name', 'prefix', 'location', 'website'], ['dog', 'event']);
  assert.equal(d.entity, null);
});

test('files run after the files they link to; same-type files keep their order', () => {
  const files = [
    { name: 'events.csv', entity: 'event' },
    { name: 'dogs-a.csv', entity: 'dog' },
    { name: 'notes.csv', entity: null },
    { name: 'contacts.csv', entity: 'contact' },
    { name: 'dogs-b.csv', entity: 'dog' },
    { name: 'kennels.csv', entity: 'kennel' }
  ];
  assert.deepEqual(orderFiles(files).map((f) => f.name),
    ['kennels.csv', 'contacts.csv', 'dogs-a.csv', 'dogs-b.csv', 'events.csv']);
});

test('a link to an entity with no file in the run does not hold a file back', () => {
  assert.deepEqual(orderFiles([{ name: 'l', entity: 'litter' }, { name: 'p', entity: 'pairing' }]).map((f) => f.name), ['l', 'p']);
});
