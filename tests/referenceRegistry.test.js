// referenceRegistry.test.js — structural integrity of the FK registry that drives
// hard-delete blocking (data/referenceRegistry.js). A malformed entry (wrong
// table name, missing label, a polymorphic entry without its discriminator) would
// silently make the guard under- or over-count, so this pins the shape. It does
// NOT exercise counting (that needs a live IndexedDB) — it validates the declared
// registry itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as registry from '../shared/data/referenceRegistry.js';

// Mirror of the tables declared in db.version(1).stores (data/db.js). Kept here on
// purpose: if a table is added/removed there, this list must change too, which is
// exactly the moment to re-check the registry — a deliberate change-detector.
const KNOWN_TABLES = new Set([
  'dogs', 'events', 'expenses', 'contacts', 'kennels', 'pairings',
  'litters', 'sales', 'contracts', 'stud_services', 'documents', 'files',
]);

const SUBJECT_TYPES = new Set(['dog', 'pairing', 'litter', 'kennel']);

// Every exported array whose name ends in _REFERENCES is a registry.
const registries = Object.entries(registry).filter(([name]) => name.endsWith('_REFERENCES'));

test('the module exports the expected registry arrays', () => {
  const names = registries.map(([n]) => n).sort();
  assert.deepEqual(names, [
    'CONTACT_REFERENCES', 'CONTRACT_REFERENCES', 'DOCUMENT_REFERENCES',
    'DOG_REFERENCES', 'EVENT_REFERENCES', 'EXPENSE_REFERENCES',
    'KENNEL_REFERENCES', 'LITTER_REFERENCES', 'PAIRING_REFERENCES',
    'SALE_REFERENCES', 'STUD_SERVICE_REFERENCES',
  ]);
});

for (const [name, entries] of registries) {
  test(`${name}: every entry is well-formed and points at a known table`, () => {
    assert.ok(Array.isArray(entries), `${name} is an array`);
    const seen = new Set();
    for (const e of entries) {
      assert.ok(KNOWN_TABLES.has(e.table), `${name}: unknown table "${e.table}"`);
      assert.equal(typeof e.field, 'string');
      assert.ok(e.field.length > 0, `${name}: entry has an empty field`);
      assert.equal(typeof e.label, 'string');
      assert.ok(e.label.length > 0, `${name}: entry has an empty label`);

      // Polymorphic (Event/Expense) entries must carry BOTH the compound index and
      // a valid discriminator, or countReferences would match the wrong rows.
      if (e.compoundIndex || e.discriminatorValue) {
        assert.equal(e.compoundIndex, '[subject_type+subject_id]', `${name}: bad compoundIndex`);
        assert.ok(SUBJECT_TYPES.has(e.discriminatorValue), `${name}: bad discriminator "${e.discriminatorValue}"`);
        assert.equal(e.field, 'subject_id', `${name}: polymorphic entry must match on subject_id`);
      }

      // multiEntry is a boolean flag when present.
      if ('multiEntry' in e) assert.equal(typeof e.multiEntry, 'boolean');

      const key = `${e.table}.${e.field}.${e.discriminatorValue ?? ''}`;
      assert.ok(!seen.has(key), `${name}: duplicate entry ${key}`);
      seen.add(key);
    }
  });
}

test('leaf entities declare an empty registry (nothing points at them)', () => {
  assert.deepEqual(registry.CONTRACT_REFERENCES, []);
  assert.deepEqual(registry.EXPENSE_REFERENCES, []);
  assert.deepEqual(registry.DOCUMENT_REFERENCES, []);
});

test('the documents FK is guarded on Dog (regression: a filed doc blocks dog delete)', () => {
  assert.ok(
    registry.DOG_REFERENCES.some((e) => e.table === 'documents' && e.field === 'dog_id'),
    'DOG_REFERENCES must include documents.dog_id'
  );
});
