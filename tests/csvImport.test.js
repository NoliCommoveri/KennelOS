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
import { parseCsv, getMapping, summarize } from '../shared/data/csvImport.js';

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
  for (const entity of ['dog', 'contact', 'pairing', 'litter', 'sale', 'event', 'stud_service', 'expense']) {
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

function dogIndex({ dogs = [], kennels = [] } = {}) {
  dogMapping._kennels = kennelNameIndex(kennels);
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
  const index = dogIndex({ kennels: [outside] });
  const row = validDogRow({ ownership_type: 'External', status: 'External reference', kennel_name: 'Someone Else' });
  const r = dogMapping.classify(row, index, 0);
  assert.equal(r.record.kennel_id, 'k2');
  assert.equal(r.status, 'create');
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
  placement_type: 'Pet', status: 'Deposit Paid', ...over
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
