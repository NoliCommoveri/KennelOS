// csvImport.test.js — the CSV match-or-create engine (data/csvImport.js): the
// biggest, most invariant-critical file in the app per CLAUDE.md's "CSV import"
// section (match-or-create by natural key, case-insensitive+trimmed name
// matching, exact date matching, keyless/unresolved rows forced to "needs
// review") and, until now, untested.
//
// Scope / approach: `getMapping(entity).classify(row, index, i)` is pure given
// an `index` (no Dexie, no localStorage) — the natural-key logic this file
// exists to pin lives entirely there. `loadExisting()` is NOT pure (it awaits
// dogRepo/kennelRepo/etc., i.e. live IndexedDB) so these tests bypass it:
// each mapping caches what loadExisting() would have fetched on `this._foo`
// private fields, so tests seed those fields directly, hand `buildIndex()` a
// synthetic `existing` array, and call `classify()` on synthetic rows — the
// same DB-free seam scopePredicates.test.js already uses for kennelScope.js.
//
// Deliberately OUT of scope, matching tests/README's existing carve-out ("repo
// CRUD... needs a live IndexedDB... out of scope here"):
//   - buildPlan/commitPlan/stampKennelScope (call repo.create/update and
//     resolveKennelIdForWrite, all real Dexie access)
//   - EXPENSE_MAPPING's blank-subject-name kennel default and the
//     no-mileage_rate-given default (getMyKennelId()/getMileageDefaults() read
//     a global `localStorage` that doesn't exist in Node) — every expense test
//     below supplies an explicit subject_name / mileage_rate to avoid that path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, getMapping, summarize, flagMissingKennel, commitPlan } from '../shared/data/csvImport.js';

// --- Local re-implementations of csvImport.js's private index builders -----
// (not exported; classify()'s `index` argument is whatever buildIndex()
// returns, and these mirror it closely enough to drive that seam directly).
function kennelNameIndex(kennels) {
  const byName = new Map();
  const ownIds = new Set();
  for (const k of kennels) {
    if (k.kennel_name) byName.set(k.kennel_name.trim().toLowerCase(), k);
    if (k.is_own_kennel) ownIds.add(k.id);
  }
  return { byName, ownIds };
}

function dogNameIndex(dogs) {
  const byName = new Map();
  for (const d of dogs) {
    if (d.registered_name) byName.set(d.registered_name.trim().toLowerCase(), d);
    const ck = d.call_name?.trim().toLowerCase();
    if (ck && !byName.has(ck)) byName.set(ck, d);
  }
  return byName;
}

function nameMap(records) {
  const m = new Map();
  for (const r of records) if (r.name) m.set(r.name.trim().toLowerCase(), r);
  return m;
}

function reasonsInclude(reasons, substr) {
  return reasons.some((r) => r.includes(substr));
}

// =========================================================================
// parseCsv
// =========================================================================

test('parseCsv normalizes headers to lower_snake_case and trims values', async () => {
  const { rows, fields } = await parseCsv('Call Name, Registered  Name\n Rex , Rex Von Trapp \n');
  assert.deepEqual(fields, ['call_name', 'registered_name']);
  assert.deepEqual(rows, [{ call_name: 'Rex', registered_name: 'Rex Von Trapp' }]);
});

test('parseCsv is case-insensitive on headers and skips blank lines', async () => {
  const { rows } = await parseCsv('NAME\nFido\n\n\nBuddy\n');
  assert.deepEqual(rows, [{ name: 'Fido' }, { name: 'Buddy' }]);
});

// =========================================================================
// getMapping
// =========================================================================

test('getMapping throws on an unknown entity', () => {
  assert.throws(() => getMapping('nonesuch'), /Unknown import entity/);
});

test('getMapping returns the same mapping for every known entity', () => {
  for (const entity of ['kennel', 'dog', 'contact', 'pairing', 'litter', 'sale', 'event', 'stud_service', 'expense', 'waitlist']) {
    assert.equal(getMapping(entity).entity, entity);
  }
});

// =========================================================================
// summarize
// =========================================================================

test('summarize tallies rows by status', () => {
  const plan = [{ status: 'create' }, { status: 'create' }, { status: 'update' }, { status: 'review' }];
  assert.deepEqual(summarize(plan), { create: 2, update: 1, review: 1, skip: 0 });
});

// =========================================================================
// Dog mapping
// =========================================================================

const dogMapping = getMapping('dog');

function dogIndex({ dogs = [], kennels = [], contacts = [] } = {}) {
  dogMapping._kennels = kennelNameIndex(kennels);
  dogMapping._contactByName = new Map(contacts.map((c) => [c.name.toLowerCase(), c]));
  return dogMapping.buildIndex(dogs);
}

const validDogRow = (over = {}) => ({
  call_name: 'Rex', sex: 'Male', date_of_birth: '2022-05-04', breed: 'German Shepherd',
  ownership_type: 'Owned', status: 'Active breeding', ...over
});

test('dog: a fully valid new row is a create', () => {
  const index = dogIndex();
  const r = dogMapping.classify(validDogRow(), index, 0);
  assert.equal(r.status, 'create');
  assert.equal(r.decision, 'create');
  assert.deepEqual(r.reasons, []);
  assert.equal(r.record.sex, 'male');
  assert.equal(r.record.ownership_type, 'owned');
  assert.equal(r.record.status, 'active_breeding');
});

test('dog: no name at all is keyless -> review', () => {
  const index = dogIndex();
  const row = validDogRow({ call_name: '' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.status, 'review');
  assert.equal(r.decision, 'skip');
  assert.ok(reasonsInclude(r.reasons, 'No registered_name or call_name'));
});

test('dog: a name with no date_of_birth is keyless -> review', () => {
  const index = dogIndex();
  const row = validDogRow({ date_of_birth: '' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'No date_of_birth'));
});

test('dog: matches an existing dog by registered_name + exact DOB, case-insensitive and trimmed', () => {
  const existing = { id: 'dog-1', registered_name: 'Rex Von Trapp', call_name: 'Rex', date_of_birth: '2022-05-04' };
  const index = dogIndex({ dogs: [existing] });
  const row = validDogRow({ registered_name: '  rex von trapp  ' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.match.id, 'dog-1');
  assert.equal(r.decisionTarget, 'dog-1');
});

test('dog: falls back to call_name + DOB when no registered_name is given', () => {
  const existing = { id: 'dog-2', registered_name: 'Zeus', call_name: 'Buddy', date_of_birth: '2021-01-01' };
  const index = dogIndex({ dogs: [existing] });
  const row = validDogRow({ call_name: 'Buddy', registered_name: '', date_of_birth: '2021-01-01' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.match.id, 'dog-2');
});

test('dog: DOB must match exactly - no fuzzy date match', () => {
  const existing = { id: 'dog-3', registered_name: 'Rex Von Trapp', date_of_birth: '2022-05-04' };
  const index = dogIndex({ dogs: [existing] });
  const row = validDogRow({ registered_name: 'Rex Von Trapp', date_of_birth: '2022-05-05' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.status, 'create');
  assert.equal(r.match, null);
});

test('dog: an unrecognized date_of_birth is treated as keyless, not silently dropped', () => {
  const index = dogIndex();
  const row = validDogRow({ date_of_birth: 'not-a-date' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Unrecognized date_of_birth "not-a-date"'));
  assert.equal(r.record.date_of_birth, undefined);
});

test('dog: an unrecognized enum on a CREATE forces review via the missing-required-field check', () => {
  const index = dogIndex();
  const row = validDogRow({ sex: 'not-a-sex' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Unrecognized sex "not-a-sex"'));
  assert.ok(reasonsInclude(r.reasons, 'Missing required field(s) for a new dog: sex'));
  assert.equal(r.record.sex, undefined);
});

test('dog: an unrecognized enum on an UPDATE does not force review (blank/garbage never overwrites)', () => {
  // Pinned current behavior: the required-fields gate only runs for status_
  // === 'create' (csvImport.js DOG_MAPPING.classify), so a matched row with a
  // garbage enum column still updates - the bad value is simply never applied.
  const existing = { id: 'dog-4', registered_name: 'Rex Von Trapp', date_of_birth: '2022-05-04' };
  const index = dogIndex({ dogs: [existing] });
  const row = validDogRow({ registered_name: 'Rex Von Trapp', status: 'not-a-status' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.status, 'update');
  assert.ok(reasonsInclude(r.reasons, 'Unrecognized status "not-a-status"'));
  assert.equal(r.record.status, undefined);
});

test('dog: missing a required field for a new dog is flagged by name', () => {
  const index = dogIndex();
  const row = validDogRow({ breed: '' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Missing required field(s) for a new dog: breed'));
});

test('dog: sire/dam resolve against existing dogs by name', () => {
  const sire = { id: 'sire-1', registered_name: 'Zeus', date_of_birth: '2018-01-01' };
  const dam = { id: 'dam-1', registered_name: 'Bella', date_of_birth: '2019-01-01' };
  const index = dogIndex({ dogs: [sire, dam] });
  const row = validDogRow({ sire_registered_name: 'Zeus', dam_registered_name: 'Bella' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.record.sire_id, 'sire-1');
  assert.equal(r.record.dam_id, 'dam-1');
  assert.equal(r.status, 'create');
});

test('dog: an unresolved sire name is flagged, never invented, and forces review', () => {
  const index = dogIndex();
  const row = validDogRow({ sire_registered_name: 'Ghost Dog' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.status, 'review');
  assert.equal(r.record.sire_id, undefined);
  assert.ok(reasonsInclude(r.reasons, 'Sire "Ghost Dog" not found'));
});

test('dog: kennel_name resolves against existing kennels only', () => {
  const kennel = { id: 'k1', kennel_name: 'Willow Creek', is_own_kennel: true };
  const index = dogIndex({ kennels: [kennel] });
  const row = validDogRow({ kennel_name: 'willow creek' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.record.kennel_id, 'k1');
  assert.equal(r.status, 'create');
});

test('dog: an unresolved kennel_name is flagged and forces review', () => {
  const index = dogIndex();
  const row = validDogRow({ kennel_name: 'No Such Kennel' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Kennel "No Such Kennel" not found'));
});

test('dog: an owned dog naming someone else\'s kennel is rejected (requireOwn)', () => {
  const outside = { id: 'k2', kennel_name: 'Someone Else', is_own_kennel: false };
  const index = dogIndex({ kennels: [outside] });
  const row = validDogRow({ ownership_type: 'Owned', kennel_name: 'Someone Else' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'not one of your own kennels'));
});

test('dog: an external dog MAY legitimately name someone else\'s kennel', () => {
  const outside = { id: 'k2', kennel_name: 'Someone Else', is_own_kennel: false };
  const index = dogIndex({ kennels: [outside], contacts: [{ id: 'c1', name: 'Pat Owner' }] });
  const row = validDogRow({ ownership_type: 'External', status: 'External reference', kennel_name: 'Someone Else', owner_name: 'Pat Owner' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.record.kennel_id, 'k2');
  assert.equal(r.record.owner_contact_id, 'c1');
  assert.equal(r.status, 'create');
});

// dogRepo requires owner_contact_id on an external / leased-in dog; without an
// owner the row would preview as create and then fail at commit.
test('dog: a leased-in dog with no owner goes to review', () => {
  const r = dogMapping.classify(validDogRow({ ownership_type: 'Leased in' }), dogIndex(), 0);
  assert.equal(r.status, 'review');
  assert.equal(r.decision, 'skip');
  assert.ok(reasonsInclude(r.reasons, 'needs its owner'));
});

test('dog: a NEW external dog with no owner is created pedigree-only', () => {
  const r = dogMapping.classify(validDogRow({ call_name: '', registered_name: 'Big Sire', ownership_type: 'External', status: '' }), dogIndex(), 0);
  assert.equal(r.status, 'create');
  assert.equal(r.record.pedigree_only, true);
  assert.equal(r.record.status, 'external_reference');
  assert.ok(!('pedigree_only' in r.changes));
  assert.ok(reasonsInclude(r.reasons, 'pedigree-only'));
});

test('dog: an update never turns an existing external dog pedigree-only', () => {
  const existing = { id: 'd1', call_name: 'Rex', date_of_birth: '2022-05-04', ownership_type: 'owned' };
  const r = dogMapping.classify(validDogRow({ ownership_type: 'External' }), dogIndex({ dogs: [existing] }), 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'needs its owner'));
});

test('dog: registration number alone is a key (no date of birth needed)', () => {
  const existing = { id: 'd1', registered_name: 'Big Sire', registration_number: 'NP97386402' };
  const index = dogIndex({ dogs: [existing] });
  const r = dogMapping.classify(validDogRow({ call_name: '', registered_name: 'Big Sire', date_of_birth: '', registration_number: 'np973864/02 11-26' }), index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.decisionTarget, 'd1');
  const fresh = dogMapping.classify(validDogRow({ date_of_birth: '', registration_number: 'NP11111111' }), index, 0);
  assert.equal(fresh.status, 'create');
});

test('dog: name+DOB and registration number pointing at different dogs -> review', () => {
  const a = { id: 'a', call_name: 'Rex', date_of_birth: '2022-05-04' };
  const b = { id: 'b', registered_name: 'Other', registration_number: 'NP22222222' };
  const r = dogMapping.classify(validDogRow({ registration_number: 'NP22222222' }), dogIndex({ dogs: [a, b] }), 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'belongs to Other'));
});

test('dog: an unknown owner_name is flagged, never invented', () => {
  const index = dogIndex();
  const r = dogMapping.classify(validDogRow({ ownership_type: 'External', owner_name: 'Nobody' }), index, 0);
  assert.equal(r.status, 'review');
  assert.equal(r.record.owner_contact_id, undefined);
  assert.ok(reasonsInclude(r.reasons, 'Owner "Nobody" not found'));
});

test('dog: an update of an external dog that already has an owner needs no owner column', () => {
  const existing = { id: 'd1', call_name: 'Rex', date_of_birth: '2022-05-04', ownership_type: 'external', owner_contact_id: 'c9' };
  const index = dogIndex({ dogs: [existing] });
  const r = dogMapping.classify(validDogRow({ ownership_type: 'External' }), index, 0);
  assert.equal(r.status, 'update');
});

test('dog: a pedigree-only match is exempt from the owner rule', () => {
  const existing = { id: 'd1', call_name: 'Rex', date_of_birth: '2022-05-04', ownership_type: 'external', pedigree_only: true };
  const index = dogIndex({ dogs: [existing] });
  const r = dogMapping.classify(validDogRow({ ownership_type: 'External' }), index, 0);
  assert.equal(r.status, 'update');
});

// Kennel-scoped creates with no kennel and no active/sole kennel to default to
// (repo: kennel_id required) go to review in the preview instead of failing at commit.
test('flagMissingKennel: creates with no kennel and no default go to review', () => {
  const plan = () => [
    { status: 'create', decision: 'create', record: {}, reasons: [] },
    { status: 'create', decision: 'create', record: { kennel_id: 'k1' }, reasons: [] },
    { status: 'update', decision: 'update', record: {}, reasons: [] }
  ];
  const flagged = flagMissingKennel('litter', plan(), null);
  assert.deepEqual(flagged.map((r) => r.status), ['review', 'create', 'update']);
  assert.equal(flagged[0].decision, 'skip');
  assert.ok(reasonsInclude(flagged[0].reasons, 'No kennel'));
  assert.deepEqual(flagMissingKennel('litter', plan(), 'k1').map((r) => r.status), ['create', 'create', 'update']);
  // Only owned / co-owned dogs carry a kennel; an external one is left alone.
  const dogs = [
    { status: 'create', decision: 'create', record: { ownership_type: 'owned' }, reasons: [] },
    { status: 'create', decision: 'create', record: { ownership_type: 'external' }, reasons: [] }
  ];
  assert.deepEqual(flagMissingKennel('dog', dogs, null).map((r) => r.status), ['review', 'create']);
});

test('dog: recorded_coi is stored only when coi_value is numeric', () => {
  const index = dogIndex();
  const row = validDogRow({ coi_value: '6.25', coi_method: 'genomic', coi_source: 'Embark', coi_as_of: '2023-01-01' });
  const r = dogMapping.classify(row, index, 0);
  assert.deepEqual(r.record.recorded_coi, { value: 6.25, method: 'genomic', source: 'Embark', as_of_date: '2023-01-01' });
});

test('dog: a non-numeric coi_value is dropped with a soft warning, not forced to review', () => {
  const index = dogIndex();
  const row = validDogRow({ coi_value: 'high' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.record.recorded_coi, undefined);
  assert.ok(reasonsInclude(r.reasons, 'Unrecognized coi_value "high"'));
  assert.equal(r.status, 'create'); // soft warning: doesn't block an otherwise-valid create
});

test('dog: no coi_value means no recorded_coi at all, even if method/source were given', () => {
  const index = dogIndex();
  const row = validDogRow({ coi_method: 'genomic', coi_source: 'Embark' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.record.recorded_coi, undefined);
});

// =========================================================================
// Contact mapping
// =========================================================================

// A dog's breeder kennel resolves against ANY kennel on file, own or outside.
test('dog: breeder_kennel_name resolves to an outside kennel', () => {
  const index = dogIndex({ kennels: [{ id: 'k-out', kennel_name: 'Willow Creek', is_own_kennel: false }] });
  const r = dogMapping.classify(validDogRow({ breeder_kennel_name: ' willow creek ' }), index, 0);
  assert.equal(r.status, 'create');
  assert.equal(r.record.breeder_kennel_id, 'k-out');
});

test('dog: an unknown breeder_kennel_name is flagged -> review, never invented', () => {
  const index = dogIndex();
  const r = dogMapping.classify(validDogRow({ breeder_kennel: 'Nowhere' }), index, 0);
  assert.equal(r.status, 'review');
  assert.equal(r.record.breeder_kennel_id, undefined);
  assert.ok(reasonsInclude(r.reasons, 'Breeder kennel "Nowhere" not found'));
});

// --- One file, dogs and their parents: the batch fallback + the link pass ----

const classifyBatch = (rows, opts) => {
  const index = dogIndex(opts);
  dogMapping.indexBatch(rows, index);
  return dogMapping.finishPlan(rows.map((r, i) => dogMapping.classify(r, index, i)));
};
const pupRow = validDogRow({ call_name: 'Pup', sire_registered_name: 'big sire', dam_registered_name: 'Mom' });
const sireRow = validDogRow({ call_name: 'Duke', registered_name: 'Big Sire', ownership_type: 'External', date_of_birth: '2019-01-01' });
const damRow = validDogRow({ call_name: 'Mom', date_of_birth: '2020-01-01' });

test('dog: a sire/dam named on another row of the file is a create, linked later', () => {
  const plan = classifyBatch([pupRow, sireRow, damRow]);
  assert.equal(plan[0].status, 'create');
  assert.deepEqual(plan[0].batchParents, { sire_id: 1, dam_id: 2 });
  assert.equal(plan[0].record.sire_id, undefined);
  assert.ok(reasonsInclude(plan[0].reasons, 'is row 3 of this file'));
});

test('dog: an existing dog wins over a same-named row of the file', () => {
  const plan = classifyBatch([pupRow, sireRow], { dogs: [{ id: 'old', registered_name: 'Big Sire' }] });
  assert.equal(plan[0].record.sire_id, 'old');
  assert.equal(plan[0].batchParents?.sire_id, undefined);
});

test('dog: a parent name matching two rows of the file is flagged -> review', () => {
  const plan = classifyBatch([validDogRow({ call_name: 'Pup', dam_registered_name: 'Mom' }), damRow, { ...damRow, date_of_birth: '2021-01-01' }]);
  assert.equal(plan[0].status, 'review');
  assert.ok(reasonsInclude(plan[0].reasons, 'matches 2 rows of this file'));
});

test('dog: a parent row that needs review is noted on the pup', () => {
  const plan = classifyBatch([pupRow, { ...sireRow, date_of_birth: '' }, damRow]);
  assert.equal(plan[1].status, 'review');
  assert.equal(plan[0].status, 'create');
  assert.ok(reasonsInclude(plan[0].reasons, 'Row 3 needs review'));
});

test('dog: commit writes every row, then links parents; an unimported parent is a note', async () => {
  const plan = classifyBatch([pupRow, sireRow, damRow]);
  plan[1].decision = 'skip'; // the user leaves the sire out
  const calls = [];
  let n = 0;
  const realRepo = dogMapping.repo;
  dogMapping.repo = {
    create: async (rec) => { calls.push(['create', rec.call_name]); return { id: `id${n++}` }; },
    update: async (id, ch) => { calls.push(['update', id, ch]); return {}; }
  };
  plan.forEach((r) => { r.record.kennel_id = 'k1'; }); // skip the localStorage kennel default
  try {
    const res = await commitPlan('dog', plan);
    assert.equal(res.created, 2);
    assert.deepEqual(calls, [['create', 'Pup'], ['create', 'Mom'], ['update', 'id0', { dam_id: 'id1' }]]);
    assert.equal(res.notes.length, 1);
    assert.ok(res.notes[0].message.includes('Not linked to its sire: row 3'));
  } finally {
    dogMapping.repo = realRepo;
  }
});

// =========================================================================
// Kennel mapping
// =========================================================================

const kennelMapping = getMapping('kennel');

test('kennel: a new name is a create, always as an outside kennel', () => {
  const index = kennelMapping.buildIndex([]);
  const r = kennelMapping.classify({ kennel_name: 'Cottonpaws', prefix: 'Cottonpaws', location: 'TX' }, index, 0);
  assert.equal(r.status, 'create');
  assert.deepEqual(r.record, { kennel_name: 'Cottonpaws', prefix: 'Cottonpaws', location: 'TX', is_own_kennel: false });
});

test('kennel: a name match (case/space-insensitive) is an update that never touches is_own_kennel', () => {
  const own = { id: 'k1', kennel_name: 'Thornfield', is_own_kennel: true };
  const index = kennelMapping.buildIndex([own]);
  const r = kennelMapping.classify({ kennel: '  THORNFIELD ', website: 'https://x.test' }, index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.decisionTarget, 'k1');
  assert.deepEqual(r.changes, { kennel_name: 'THORNFIELD', website: 'https://x.test' });
  assert.ok(!('is_own_kennel' in r.changes));
});

test('kennel: no name is keyless -> review', () => {
  const r = kennelMapping.classify({ location: 'TX' }, kennelMapping.buildIndex([]), 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'No kennel_name'));
});

test('kennel: two kennels sharing the name -> review, user picks', () => {
  const index = kennelMapping.buildIndex([{ id: 'a', kennel_name: 'Dreams' }, { id: 'b', kennel_name: 'dreams' }]);
  const r = kennelMapping.classify({ kennel_name: 'Dreams' }, index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, '2 kennels on file'));
});

const contactMapping = getMapping('contact');

function contactIndex({ contacts = [], kennels = [] } = {}) {
  contactMapping._kennels = kennels;
  return contactMapping.buildIndex(contacts);
}

test('contact: a nameless row is keyless -> review', () => {
  const index = contactIndex();
  const r = contactMapping.classify({ name: '' }, index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'No name'));
});

test('contact: matches an existing contact by name, case-insensitive and trimmed', () => {
  const existing = { id: 'c1', name: 'Jane Doe' };
  const index = contactIndex({ contacts: [existing] });
  const r = contactMapping.classify({ name: '  JANE DOE  ' }, index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.match.id, 'c1');
});

test('contact: unrecognized contact_type entries are dropped with a soft warning', () => {
  const index = contactIndex();
  const r = contactMapping.classify({ name: 'Jane Doe', contact_type: 'vet; not_a_type' }, index, 0);
  assert.deepEqual(r.record.contact_type, ['vet']);
  assert.ok(reasonsInclude(r.reasons, 'Unrecognized contact_type "not_a_type"'));
  assert.equal(r.status, 'create'); // soft warning only - contact_type isn't required
});

test('contact: kennel_name resolves against existing kennels', () => {
  const kennel = { id: 'k1', kennel_name: 'Willow Creek' };
  const index = contactIndex({ kennels: [kennel] });
  const r = contactMapping.classify({ name: 'Jane Doe', kennel_name: 'Willow Creek' }, index, 0);
  assert.equal(r.record.kennel_id, 'k1');
});

test('contact: an unresolved kennel_name is left blank WITHOUT forcing review (unlike every other mapping)', () => {
  // Pinned asymmetry: CONTACT_MAPPING.classify pushes a reason but never sets
  // status_ = 'review' for an unmatched kennel_name, unlike Dog/Pairing/Litter/
  // Sale/StudService, which all route through resolveKennelColumn() and force
  // review on an unresolved name.
  const index = contactIndex();
  const r = contactMapping.classify({ name: 'Jane Doe', kennel_name: 'Nowhere' }, index, 0);
  assert.equal(r.record.kennel_id, undefined);
  assert.ok(reasonsInclude(r.reasons, 'Kennel "Nowhere" not found (left blank)'));
  assert.equal(r.status, 'create');
});

// =========================================================================
// Pairing mapping
// =========================================================================

const pairingMapping = getMapping('pairing');

function pairingIndex({ pairings = [], dogs = [], kennels = [] } = {}) {
  pairingMapping._dogNames = dogNameIndex(dogs);
  pairingMapping._kennels = kennelNameIndex(kennels);
  return pairingMapping.buildIndex(pairings);
}

const sire = { id: 'sire-1', registered_name: 'Zeus' };
const dam = { id: 'dam-1', registered_name: 'Bella' };

const validPairingRow = (over = {}) => ({
  sire_registered_name: 'Zeus', dam_registered_name: 'Bella', pairing_type: 'Planned',
  status: 'Planned', planned_date: '2024-03-01', ...over
});

test('pairing: sire + dam + planned_date all required for a natural key', () => {
  const index = pairingIndex({ dogs: [sire, dam] });
  const r = pairingMapping.classify(validPairingRow({ planned_date: '' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'No planned_date'));
});

test('pairing: an unresolved sire or dam name is flagged and always forces review', () => {
  const index = pairingIndex({ dogs: [dam] });
  const r = pairingMapping.classify(validPairingRow(), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Sire "Zeus" not found'));
});

test('pairing: matches an existing pairing by sire + dam + exact planned_date', () => {
  const existing = { id: 'p1', sire_id: 'sire-1', dam_id: 'dam-1', planned_date: '2024-03-01' };
  const index = pairingIndex({ pairings: [existing], dogs: [sire, dam] });
  const r = pairingMapping.classify(validPairingRow(), index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.match.id, 'p1');
});

test('pairing: same dog as sire and dam is rejected on create', () => {
  const index = pairingIndex({ dogs: [sire] });
  const r = pairingMapping.classify(validPairingRow({ dam_registered_name: 'Zeus' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Sire and dam cannot be the same dog'));
});

test('pairing: missing a required field for a new pairing is flagged by name', () => {
  const index = pairingIndex({ dogs: [sire, dam] });
  const r = pairingMapping.classify(validPairingRow({ pairing_type: '' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Missing required field(s) for a new pairing: pairing_type'));
});

test('pairing: an unresolved kennel_name forces review (requireOwn always true)', () => {
  const index = pairingIndex({ dogs: [sire, dam] });
  const r = pairingMapping.classify(validPairingRow({ kennel_name: 'Nowhere' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Kennel "Nowhere" not found'));
});

// =========================================================================
// Litter mapping
// =========================================================================

const litterMapping = getMapping('litter');

function litterIndex({ litters = [], dogs = [], kennels = [] } = {}) {
  litterMapping._dogNames = dogNameIndex(dogs);
  litterMapping._kennels = kennelNameIndex(kennels);
  return litterMapping.buildIndex(litters);
}

const validLitterRow = (over = {}) => ({
  dam_registered_name: 'Bella', sire_registered_name: 'Zeus', whelp_date: '2024-05-10', status: 'Whelped', ...over
});

test('litter: dam + sire + whelp_date all required for a natural key', () => {
  const index = litterIndex({ dogs: [sire, dam] });
  const r = litterMapping.classify(validLitterRow({ whelp_date: '' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'No whelp_date'));
});

test('litter: an unresolved dam is flagged and forces review', () => {
  const index = litterIndex({ dogs: [sire] });
  const r = litterMapping.classify(validLitterRow(), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Dam "Bella" not found'));
});

test('litter: matches an existing litter by dam + sire + exact whelp_date', () => {
  const existing = { id: 'l1', dam_id: 'dam-1', sire_id: 'sire-1', whelp_date: '2024-05-10' };
  const index = litterIndex({ litters: [existing], dogs: [sire, dam] });
  const r = litterMapping.classify(validLitterRow(), index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.match.id, 'l1');
});

test('litter: a non-numeric puppy count is dropped with a soft warning, not forced to review', () => {
  const index = litterIndex({ dogs: [sire, dam] });
  const r = litterMapping.classify(validLitterRow({ puppies_born_total: 'lots' }), index, 0);
  assert.equal(r.record.puppies_born_total, undefined);
  assert.ok(reasonsInclude(r.reasons, 'Unrecognized puppies_born_total "lots"'));
  assert.equal(r.status, 'create');
});

test('litter: missing a required field for a new litter is flagged by name', () => {
  const index = litterIndex({ dogs: [sire, dam] });
  const r = litterMapping.classify(validLitterRow({ status: '' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Missing required field(s) for a new litter: status'));
});

// =========================================================================
// Sale mapping
// =========================================================================

const saleMapping = getMapping('sale');
const puppy = { id: 'puppy-1', registered_name: 'Rex Von Trapp' };

function saleIndex({ sales = [], dogs = [], contacts = [], kennels = [] } = {}) {
  saleMapping._dogNames = dogNameIndex(dogs);
  saleMapping._contactsById = new Map(contacts.map((c) => [c.id, c]));
  saleMapping._contactByName = nameMap(contacts);
  saleMapping._kennels = kennelNameIndex(kennels);
  return saleMapping.buildIndex(sales);
}

const validSaleRow = (over = {}) => ({
  dog_registered_name: 'Rex Von Trapp', buyer_name: 'John Smith', sale_date: '2024-06-01',
  registration_type: 'Limited', status: 'Deposit Paid', ...over
});

test('sale: dog + buyer_name + sale_date all required for a natural key', () => {
  const index = saleIndex({ dogs: [puppy] });
  const r = saleMapping.classify(validSaleRow({ sale_date: '' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'No sale_date'));
});

test('sale: an unresolved dog is ALWAYS flagged and forces review', () => {
  const index = saleIndex();
  const r = saleMapping.classify(validSaleRow(), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Dog "Rex Von Trapp" not found'));
});

test('sale: an unmatched buyer_name is NOT flagged for review - it is queued for inline creation', () => {
  const index = saleIndex({ dogs: [puppy] });
  const r = saleMapping.classify(validSaleRow(), index, 0);
  assert.equal(r.status, 'create'); // no review forced by the missing buyer
  assert.equal(r.record.buyer_contact_id, undefined);
  assert.equal(r._buyerNameToCreate, 'John Smith');
  assert.ok(reasonsInclude(r.reasons, 'Buyer "John Smith" not found — will be created as a new Contact'));
});

test('sale: matches an existing sale by dog + buyer NAME + exact sale_date, even though the buyer is only a name at classify time', () => {
  const buyer = { id: 'buyer-1', name: 'John Smith' };
  const existing = { id: 's1', dog_id: 'puppy-1', buyer_contact_id: 'buyer-1', sale_date: '2024-06-01' };
  const index = saleIndex({ sales: [existing], dogs: [puppy], contacts: [buyer] });
  const r = saleMapping.classify(validSaleRow({ buyer_name: '  JOHN SMITH  ' }), index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.match.id, 's1');
});

test('sale: missing a required field for a new sale is flagged by name', () => {
  const index = saleIndex({ dogs: [puppy] });
  const r = saleMapping.classify(validSaleRow({ status: '' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Missing required field(s) for a new sale: status'));
});

test('sale: an unresolved kennel_name forces review (requireOwn always true)', () => {
  const index = saleIndex({ dogs: [puppy] });
  const r = saleMapping.classify(validSaleRow({ kennel_name: 'Nowhere' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Kennel "Nowhere" not found'));
});

// =========================================================================
// Event mapping (dog-subject only)
// =========================================================================

const eventMapping = getMapping('event');

function eventIndex({ events = [], dogs = [], contacts = [] } = {}) {
  eventMapping._dogNames = dogNameIndex(dogs);
  eventMapping._contactByName = nameMap(contacts);
  return eventMapping.buildIndex(events);
}

const validEventRow = (over = {}) => ({
  dog_registered_name: 'Rex Von Trapp', event_type: 'Vaccination', event_date: '2024-01-15', title: 'Rabies', ...over
});

test('event: dog + event_type + event_date all required for a natural key', () => {
  const index = eventIndex({ dogs: [puppy] });
  const r = eventMapping.classify(validEventRow({ event_date: '' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'No event_date'));
});

test('event: an unresolved dog is always flagged and forces review', () => {
  const index = eventIndex();
  const r = eventMapping.classify(validEventRow(), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Dog "Rex Von Trapp" not found'));
});

test('event: matches a single existing event sharing dog + type + date', () => {
  const existing = { id: 'e1', subject_type: 'dog', subject_id: 'puppy-1', event_type: 'vaccination', event_date: '2024-01-15', title: 'Rabies' };
  const index = eventIndex({ events: [existing], dogs: [puppy] });
  const r = eventMapping.classify(validEventRow(), index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.match.id, 'e1');
});

test('event: multiple candidates on the same key are resolved by a unique title match', () => {
  const e1 = { id: 'e1', subject_type: 'dog', subject_id: 'puppy-1', event_type: 'vaccination', event_date: '2024-01-15', title: 'Rabies' };
  const e2 = { id: 'e2', subject_type: 'dog', subject_id: 'puppy-1', event_type: 'vaccination', event_date: '2024-01-15', title: 'Bordetella' };
  const index = eventIndex({ events: [e1, e2], dogs: [puppy] });
  const r = eventMapping.classify(validEventRow({ title: 'bordetella' }), index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.match.id, 'e2');
});

test('event: an ambiguous title across multiple candidates forces review rather than guessing', () => {
  const e1 = { id: 'e1', subject_type: 'dog', subject_id: 'puppy-1', event_type: 'vaccination', event_date: '2024-01-15', title: 'Rabies' };
  const e2 = { id: 'e2', subject_type: 'dog', subject_id: 'puppy-1', event_type: 'vaccination', event_date: '2024-01-15', title: 'Bordetella' };
  const index = eventIndex({ events: [e1, e2], dogs: [puppy] });
  const r = eventMapping.classify(validEventRow({ title: '' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, "didn't uniquely resolve"));
});

test('event: event_end_date on an instant type is dropped with a soft warning', () => {
  const index = eventIndex({ dogs: [puppy] });
  const r = eventMapping.classify(validEventRow({ event_end_date: '2024-01-20' }), index, 0);
  assert.equal(r.record.event_end_date, undefined);
  assert.ok(reasonsInclude(r.reasons, 'only for span events'));
  assert.equal(r.status, 'create');
});

test('event: event_end_date on a span type IS stored', () => {
  const index = eventIndex({ dogs: [puppy] });
  const r = eventMapping.classify(validEventRow({ event_type: 'Boarding', event_end_date: '2024-01-20' }), index, 0);
  assert.equal(r.record.event_end_date, '2024-01-20');
  assert.equal(r.status, 'create');
});

test('event: an unresolved related_contact_name forces review', () => {
  const index = eventIndex({ dogs: [puppy] });
  const r = eventMapping.classify(validEventRow({ event_type: 'Boarding', related_contact_name: 'Ghost Sitter' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Related contact "Ghost Sitter" not found'));
});

test('event: malformed details_json forces review', () => {
  const index = eventIndex({ dogs: [puppy] });
  const r = eventMapping.classify(validEventRow({ details_json: '{not json' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Malformed details_json'));
});

test('event: a valid details_json object is parsed; a blank column defaults to {}', () => {
  const index = eventIndex({ dogs: [puppy] });
  const withJson = eventMapping.classify(validEventRow({ details_json: '{"vaccine":"Rabies"}' }), index, 0);
  assert.deepEqual(withJson.record.details, { vaccine: 'Rabies' });
  const blank = eventMapping.classify(validEventRow(), index, 1);
  assert.deepEqual(blank.record.details, {});
});

test('event: an unrecognized reminder_date is dropped with a soft warning, not forced to review', () => {
  const index = eventIndex({ dogs: [puppy] });
  const r = eventMapping.classify(validEventRow({ reminder_date: 'soon' }), index, 0);
  assert.equal(r.record.reminder_date, undefined);
  assert.ok(reasonsInclude(r.reasons, 'Unrecognized reminder_date "soon"'));
  assert.equal(r.status, 'create');
});

test('event: missing a required field for a new event is flagged by name', () => {
  const index = eventIndex({ dogs: [puppy] });
  const r = eventMapping.classify(validEventRow({ title: '' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Missing required field(s) for a new event: title'));
});

// --- show double-headers (Show Tracking Spec §8) ---------------------------
// For `show` rows the title always takes part in the match, even with a single
// candidate, so "… Show 2" never silently overwrites "… Show 1".
const showOnFile = { id: 's1', subject_type: 'dog', subject_id: 'puppy-1', event_type: 'show', event_date: '2024-03-02', title: 'Greater Example KC — Show 1' };
const showRow = (over = {}) => validEventRow({ event_type: 'show', event_date: '2024-03-02', title: 'Greater Example KC — Show 1', ...over });

test('event: a single same-day show with a DIFFERENT title goes to review, never a silent update', () => {
  const index = eventIndex({ events: [showOnFile], dogs: [puppy] });
  const r = eventMapping.classify(showRow({ title: 'Greater Example KC — Show 2' }), index, 0);
  assert.equal(r.status, 'review');
  assert.equal(r.match.id, 's1');
  assert.ok(reasonsInclude(r.reasons, 'different title'));
});

test('event: a single same-day show with the SAME title (case/whitespace-insensitive) is an update', () => {
  const index = eventIndex({ events: [showOnFile], dogs: [puppy] });
  const r = eventMapping.classify(showRow({ title: '  greater example kc — show 1 ' }), index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.match.id, 's1');
});

test('event: a show with no candidates on its key is still a create', () => {
  const index = eventIndex({ dogs: [puppy] });
  const r = eventMapping.classify(showRow(), index, 0);
  assert.equal(r.status, 'create');
  assert.equal(r.record.event_type, 'show');
});

test('event: a NON-show type with a single candidate and a different title is still an update (unchanged)', () => {
  const existing = { id: 'e1', subject_type: 'dog', subject_id: 'puppy-1', event_type: 'vaccination', event_date: '2024-01-15', title: 'Rabies' };
  const index = eventIndex({ events: [existing], dogs: [puppy] });
  const r = eventMapping.classify(validEventRow({ title: 'Something else' }), index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.match.id, 'e1');
});

// =========================================================================
// StudService mapping
// =========================================================================

const studMapping = getMapping('stud_service');
const ourDog = { id: 'our-1', registered_name: 'Zeus' };
const partnerDog = { id: 'partner-1', registered_name: 'Ruby' };

function studIndex({ services = [], dogs = [], contacts = [], kennels = [] } = {}) {
  studMapping._dogNames = dogNameIndex(dogs);
  studMapping._dogsById = new Map(dogs.map((d) => [d.id, d]));
  studMapping._contactByName = nameMap(contacts);
  studMapping._kennels = kennelNameIndex(kennels);
  return studMapping.buildIndex(services);
}

const validStudRow = (over = {}) => ({
  direction: 'Outgoing', our_dog_registered_name: 'Zeus', partner_dog_registered_name: 'Ruby',
  partner_contact_name: 'Ruby\'s Owner', status: 'Arranged', ...over
});

test('stud service: our_dog + partner_dog + direction all required for a natural key', () => {
  const index = studIndex({ dogs: [ourDog, partnerDog] });
  const r = studMapping.classify(validStudRow({ direction: '' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'No direction'));
});

test('stud service: an unresolved our_dog name forces review', () => {
  const index = studIndex({ dogs: [partnerDog] });
  const r = studMapping.classify(validStudRow(), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Our dog "Zeus" not found'));
});

test('stud service: any existing match on the pair+direction key is ALWAYS routed to review, never auto-updated', () => {
  const existing = { id: 'ss1', our_dog_id: 'our-1', partner_dog_id: 'partner-1', direction: 'outgoing' };
  const index = studIndex({ services: [existing], dogs: [ourDog, partnerDog] });
  const r = studMapping.classify(validStudRow(), index, 0);
  assert.equal(r.status, 'review');
  assert.equal(r.match.id, 'ss1');
  assert.ok(reasonsInclude(r.reasons, 'already matches this dog pair + direction'));
});

const partnerContact = { id: 'pc-1', name: "Ruby's Owner" };

test('stud service: no existing match, with a resolvable partner contact, is a plain create', () => {
  const index = studIndex({ dogs: [ourDog, partnerDog], contacts: [partnerContact] });
  const r = studMapping.classify(validStudRow(), index, 0);
  assert.equal(r.status, 'create');
  assert.equal(r.match, null);
});

test('BUG: an unmatched partner_contact_name is forced to review, contradicting the "never a needs-review stall" comment', () => {
  // requiredForCreate includes 'partner_contact_id' (line ~992), so on a pure
  // create with no matching contact, partner_contact_id is never set (it's
  // only filled in by prepareRecord() at commit time) and the missing-
  // required-field gate forces this row to review anyway. prepareRecord's own
  // comment says this mirrors the Sale buyer_name exception, but
  // SALE_MAPPING.requiredForCreate deliberately EXCLUDES buyer_contact_id for
  // exactly this reason (see the sale buyer test above), so the "auto-create,
  // never stall" behavior the comment promises cannot actually happen here -
  // pinning the current (likely unintended) behavior.
  const index = studIndex({ dogs: [ourDog, partnerDog] });
  const r = studMapping.classify(validStudRow(), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Missing required field(s) for a new stud service: partner_contact_id'));
  assert.equal(r._partnerContactNameToCreate, "Ruby's Owner");
  assert.ok(reasonsInclude(r.reasons, 'will be created as a new Contact'));
});

test('stud service: missing a required field for a new stud service is flagged by name', () => {
  const index = studIndex({ dogs: [ourDog, partnerDog], contacts: [partnerContact] });
  const r = studMapping.classify(validStudRow({ status: '' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Missing required field(s) for a new stud service: status'));
});

test('stud service: an unresolved kennel_name forces review (requireOwn always true)', () => {
  const index = studIndex({ dogs: [ourDog, partnerDog] });
  const r = studMapping.classify(validStudRow({ kennel_name: 'Nowhere' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Kennel "Nowhere" not found'));
});

// =========================================================================
// Expense mapping
// =========================================================================

const expenseMapping = getMapping('expense');
const ownKennel = { id: 'k1', kennel_name: 'Willow Creek', is_own_kennel: true, is_archived: false };
const expenseDog = { id: 'd1', registered_name: 'Rex Von Trapp', call_name: 'Rex' };

function expenseIndex({ expenses = [], kennels = [ownKennel], dogs = [expenseDog], ambiguousNames = [] } = {}) {
  const kennelByName = new Map();
  const ownKennels = [];
  for (const k of kennels) {
    if (k.kennel_name) kennelByName.set(k.kennel_name.trim().toLowerCase(), k);
    if (k.is_own_kennel && !k.is_archived) ownKennels.push(k);
  }
  expenseMapping._kennelByName = kennelByName;
  expenseMapping._ownKennels = ownKennels;
  expenseMapping._kennelById = new Map(kennels.map((k) => [k.id, k]));
  const dogByName = new Map();
  const dogAmbiguous = new Set(ambiguousNames);
  for (const d of dogs) {
    for (const nm of [d.registered_name, d.call_name]) {
      const key = nm?.trim().toLowerCase();
      if (key) dogByName.set(key, d);
    }
  }
  expenseMapping._dogByName = dogByName;
  expenseMapping._dogAmbiguous = dogAmbiguous;
  expenseMapping._dogById = new Map(dogs.map((d) => [d.id, d]));
  return expenseMapping.buildIndex(expenses);
}

const validExpenseRow = (over = {}) => ({
  subject_type: 'Kennel', subject_name: 'Willow Creek', expense_date: '2024-02-01', amount: '49.99', category: 'Food', ...over
});

test('expense: a fully valid flat-amount row is a create', () => {
  const index = expenseIndex();
  const r = expenseMapping.classify(validExpenseRow(), index, 0);
  assert.equal(r.status, 'create');
  assert.equal(r.record.subject_id, 'k1');
  assert.equal(r.record.amount, 49.99);
  assert.equal(r.record.category, 'food');
});

test('expense: an unresolved kennel subject forces review via the reasons-any-message gate', () => {
  const index = expenseIndex();
  const r = expenseMapping.classify(validExpenseRow({ subject_name: 'Nowhere' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'Kennel "Nowhere" not found'));
});

test('expense: an unrecognized category defaults to Other WITHOUT forcing review (the one excluded reason)', () => {
  const index = expenseIndex();
  const r = expenseMapping.classify(validExpenseRow({ category: 'not-a-category' }), index, 0);
  assert.equal(r.record.category, undefined); // repo itself defaults to 'other'
  assert.ok(reasonsInclude(r.reasons, 'defaulted to Other'));
  assert.equal(r.status, 'create');
});

test('expense: a dog subject resolves by registered or call name', () => {
  const index = expenseIndex();
  const r = expenseMapping.classify(validExpenseRow({ subject_type: 'Dog', subject_name: 'Rex' }), index, 0);
  assert.equal(r.record.subject_id, 'd1');
  assert.equal(r.status, 'create');
});

test('expense: an ambiguous dog name forces review instead of guessing', () => {
  const index = expenseIndex({ ambiguousNames: ['rex'] });
  const r = expenseMapping.classify(validExpenseRow({ subject_type: 'Dog', subject_name: 'Rex' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'matches more than one dog'));
});

test('expense: litter/pairing subjects always route to review - no name key to resolve against', () => {
  const index = expenseIndex();
  for (const subjectType of ['Litter', 'Pairing']) {
    const r = expenseMapping.classify(validExpenseRow({ subject_type: subjectType, subject_name: '' }), index, 0);
    assert.equal(r.status, 'review');
    assert.ok(reasonsInclude(r.reasons, "can't be imported from CSV"));
  }
});

test('expense: a mileage row derives its amount and forces category to mileage; miles/rate are stored, not amount', () => {
  const index = expenseIndex();
  const r = expenseMapping.classify(validExpenseRow({ miles: '20', mileage_rate: '0.5', amount: '' }), index, 0);
  assert.equal(r.record.category, 'mileage');
  assert.equal(r.record.miles, 20);
  assert.equal(r.record.mileage_rate, 0.5);
  assert.equal(r.record.amount, undefined);
  assert.equal(r.status, 'create');
});

test('expense: no amount and no miles is flagged and forces review', () => {
  const index = expenseIndex();
  const r = expenseMapping.classify(validExpenseRow({ amount: '' }), index, 0);
  assert.equal(r.status, 'review');
  assert.ok(reasonsInclude(r.reasons, 'No amount (and no miles)'));
});

test('expense: matches an existing ledger row by subject + date + amount + category + vendor', () => {
  const existing = { id: 'ex1', subject_type: 'kennel', subject_id: 'k1', expense_date: '2024-02-01', amount: 49.99, category: 'food', vendor: 'Acme' };
  const index = expenseIndex({ expenses: [existing] });
  const r = expenseMapping.classify(validExpenseRow({ vendor: 'Acme' }), index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.match.id, 'ex1');
});

test('expense: an archived or event-linked existing row is excluded from matching (never silently updated)', () => {
  const archived = { id: 'ex1', subject_type: 'kennel', subject_id: 'k1', expense_date: '2024-02-01', amount: 49.99, category: 'food', is_archived: true };
  const eventLinked = { id: 'ex2', subject_type: 'kennel', subject_id: 'k1', expense_date: '2024-02-01', amount: 49.99, category: 'food', event_id: 'evt-1' };
  const index = expenseIndex({ expenses: [archived, eventLinked] });
  const r = expenseMapping.classify(validExpenseRow(), index, 0);
  assert.equal(r.status, 'create');
  assert.equal(r.match, null);
});

test('expense: a receipt_number is an idempotent override key - it matches regardless of amount/date/subject drift', () => {
  const existing = { id: 'ex1', subject_type: 'kennel', subject_id: 'k1', expense_date: '2024-02-01', amount: 10, category: 'food', receipt_number: 'R-100' };
  const index = expenseIndex({ expenses: [existing] });
  // Everything else about the row changed, but the receipt number is the same.
  const r = expenseMapping.classify(validExpenseRow({ amount: '999', category: 'Supplies', expense_date: '2024-09-09', receipt_number: 'r-100' }), index, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.match.id, 'ex1');
});

// ===========================================================================
// Waitlist applications (Waitlist Spec §5.1, W1d) — natural key = email,
// scoped to one kennel; contacts are never matched here.
// ===========================================================================
const wlMapping = getMapping('waitlist');

function wlSetup(existing = [], { defaultKennelId = 'k1', programs = [], contacts = [], breeds = ['Boxer', 'Boston Terrier'] } = {}) {
  wlMapping._breedsByKennel = new Map([['k1', breeds], ['k2', breeds]]);
  wlMapping._own = [{ id: 'k1', kennel_name: 'Thornfield Kennels', is_own_kennel: true }, { id: 'k2', kennel_name: 'Second Kennel', is_own_kennel: true }];
  wlMapping._programs = programs;
  wlMapping._contactsById = new Map(contacts.map((c) => [c.id, c]));
  wlMapping._defaultKennelId = defaultKennelId;
  return wlMapping.buildIndex(existing);
}

test('waitlist: a new email creates an applied entry on the default kennel, Google Form timestamp → date', () => {
  const idx = wlSetup();
  const r = wlMapping.classify({ name: 'Leo Grant', email: 'Leo@Example.com', timestamp: '10/5/2026 14:33:00', sex: 'Boy', breed: ' boxer', colors: 'red; fawn', household: 'Two adults' }, idx, 0);
  assert.equal(r.status, 'create');
  assert.equal(r.record.kennel_id, 'k1');
  assert.equal(r.record.status, 'applied');
  assert.equal(r.record.applied_date, '2026-10-05');
  assert.equal(r.record.pref_sex, 'male');
  assert.equal(r.record.pref_breed, 'Boxer');
  assert.deepEqual(r.record.pref_colors, ['red', 'fawn']);
  assert.equal(r.record.application.household, 'Two adults');
  assert.equal(r.record.contact_id, undefined, 'contacts are matched at approval, never on import');
});

test('waitlist: a breed that isn\'t one of the kennel\'s breeds is flagged and left as any, never invented', () => {
  const idx = wlSetup();
  const r = wlMapping.classify({ name: 'Bo', email: 'bo@example.com', breed: 'Bostons' }, idx, 0);
  assert.equal(r.status, 'create');
  assert.equal(r.record.pref_breed, undefined);
  assert.ok(r.reasons.some((x) => /Breed "Bostons" isn't one of this kennel's breeds/.test(x)));
});

test('waitlist: no email or no name → needs review, default skip (keyless rows are never auto-created)', () => {
  const idx = wlSetup();
  const noEmail = wlMapping.classify({ name: 'Only Name' }, idx, 0);
  assert.equal(noEmail.status, 'review');
  assert.equal(noEmail.decision, 'skip');
  const noName = wlMapping.classify({ email: 'x@example.com' }, idx, 1);
  assert.equal(noName.status, 'review');
});

test('waitlist: an email matching a still-applied entry on that kennel updates its answers only', () => {
  const existing = [{ id: 'e1', kennel_id: 'k1', status: 'applied', application: { name: 'Leo', email: 'leo@example.com', about: 'old' } }];
  const idx = wlSetup(existing);
  const r = wlMapping.classify({ name: 'Leo', email: ' LEO@example.com ', about: 'new answer' }, idx, 0);
  assert.equal(r.status, 'update');
  assert.equal(r.decisionTarget, 'e1');
  assert.equal(r.changes.application.about, 'new answer');
  assert.equal(r.changes.status, undefined, 'an update never touches status');
  assert.equal(r.changes.kennel_id, undefined);
});

test('waitlist: a family already on the list (by application or contact email) → review, skipped', () => {
  const existing = [{ id: 'e2', kennel_id: 'k1', status: 'active', contact_id: 'c1', application: { name: 'Ann' } }];
  const idx = wlSetup(existing, { contacts: [{ id: 'c1', name: 'Ann', email: 'ann@example.com' }] });
  const r = wlMapping.classify({ name: 'Ann', email: 'ann@example.com' }, idx, 0);
  assert.equal(r.status, 'review');
  assert.equal(r.decision, 'skip');
  assert.match(r.reasons.join(' '), /on the list/);
});

test('waitlist: the same email on ANOTHER kennel is a new application (one list per kennel)', () => {
  const existing = [{ id: 'e3', kennel_id: 'k1', status: 'active', application: { name: 'Ann', email: 'ann@example.com' } }];
  const idx = wlSetup(existing);
  const r = wlMapping.classify({ name: 'Ann', email: 'ann@example.com', kennel_name: 'second kennel' }, idx, 0);
  assert.equal(r.status, 'create');
  assert.equal(r.record.kennel_id, 'k2');
});

test('waitlist: no kennel resolvable → review; unknown kennel / program / purpose are flagged, never invented', () => {
  const none = wlSetup([], { defaultKennelId: null });
  assert.equal(wlMapping.classify({ name: 'A', email: 'a@example.com' }, none, 0).status, 'review');
  const idx = wlSetup([], { programs: [{ id: 'p1', kennel_id: 'k1', name: 'Treatment family' }] });
  const ok = wlMapping.classify({ name: 'B', email: 'b@example.com', program: 'treatment FAMILY' }, idx, 1);
  assert.equal(ok.record.waitlist_program_id, 'p1');
  const bad = wlMapping.classify({ name: 'C', email: 'c@example.com', program: 'Nope', placement: 'zoo', kennel_name: 'Elsewhere' }, idx, 2);
  assert.equal(bad.record.waitlist_program_id, undefined);
  assert.equal(bad.record.pref_purposes, undefined);
  // Unknown kennel + unknown purpose flagged, plus the "no kennel" review reason;
  // the program can't be looked up without a kennel, so it's left blank silently.
  assert.equal(bad.reasons.length, 3);
  assert.match(bad.reasons.join(' '), /isn't one of your kennels/);
  assert.match(bad.reasons.join(' '), /Unrecognized purpose "zoo"/);
  assert.equal(bad.status, 'review');
});
