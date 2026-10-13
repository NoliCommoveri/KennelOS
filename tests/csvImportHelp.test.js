// csvImportHelp.test.js — the import screens' column guide (data/csvImportHelp.js)
// must explain exactly the columns each importer reads, so a new column can't
// ship unexplained and a removed one can't linger in the help.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMapping } from '../shared/data/csvImport.js';
import { importHelp, HELP_ENTITIES, NEED_LABELS, templateCsv } from '../shared/data/csvImportHelp.js';

const IMPORTERS = ['dog', 'contact', 'pairing', 'litter', 'sale', 'event', 'stud_service', 'expense', 'waitlist'];

test('every importer has a guide, and nothing else does', () => {
  assert.deepEqual([...HELP_ENTITIES].sort(), [...IMPORTERS].sort());
});

for (const entity of IMPORTERS) {
  test(`${entity}: the guide lists the importer's columns, in order, each explained`, () => {
    const help = importHelp(entity);
    assert.deepEqual(help.columns.map((c) => c.name), getMapping(entity).templateHeaders);
    assert.ok(help.match.length > 20);
    for (const c of help.columns) {
      assert.ok(NEED_LABELS[c.need], `${entity}.${c.name}: unknown need "${c.need}"`);
      assert.ok(c.text && c.text.length > 3, `${entity}.${c.name}: no explanation`);
      if (c.values) assert.ok(c.values.length > 0 && c.values.every(Boolean), `${entity}.${c.name}: empty values`);
    }
    assert.equal(templateCsv(entity), getMapping(entity).templateHeaders.join(',') + '\r\n');
  });
}
