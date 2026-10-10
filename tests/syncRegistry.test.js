// syncRegistry.test.js — the cloud allow-list (shared/data/syncRegistry.js;
// Cloud Phase 1 plan §5). It IS the cloud-backup privacy promise, so this pins:
//   - every table in db.js has an entry, and every entry names a real table;
//   - each field sits in exactly one bucket (cloud / private / pending);
//   - COVERAGE: every key the full Thornfield sample packet writes is classified,
//     so a new field fails here until someone decides cloud or private;
//   - the projection of that packet carries no private key anywhere, and the
//     positive check (assertCloudRow) throws on an injected one;
//   - the row rules (documents by doc_type, files only when a kept document
//     references them, expenses never) and the event-details filter.
//
// The sample packet is produced by running the REAL seed (sampleData.js, through
// the real repos) against an in-memory stand-in for the Dexie tables
// (tests/support/memoryDb.js), so the coverage set is exactly what the app writes.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb, snapshotTables } from './support/memoryDb.js';

let reg;
let vocab;
let packet; // { table: rows[] } after seeding

before(async () => {
  const { tables } = await installMemoryDb();
  reg = await import('../shared/data/syncRegistry.js');
  vocab = await import('../shared/data/vocab.js');
  const { seedSampleData } = await import('../shared/data/sampleData.js');
  await seedSampleData();
  packet = snapshotTables(tables);
  delete packet.device_secrets; // device-only, never kennel data (db.js)
  delete packet.sync_meta;
});

// Mirror of db.version(1).stores (data/db.js) — a deliberate change-detector, as
// in referenceRegistry.test.js: a new table must be classified here too.
const KNOWN_TABLES = [
  'dogs', 'events', 'expenses', 'contacts', 'kennels', 'pairings', 'litters',
  'sales', 'contracts', 'stud_services', 'documents', 'files',
  'breed_feeding_schedules', 'waitlist_entries', 'waitlist_offers', 'waitlist_programs',
  'accounts'
];

test('every db.js data table has a registry entry, and nothing else does', async () => {
  const { dataTables, DEVICE_ONLY_TABLES } = await import('../shared/data/db.js');
  const dbTables = dataTables().map((t) => t.name).sort();
  // Device-only tables (the vault key) are never kennel data, so never in a snapshot.
  for (const t of DEVICE_ONLY_TABLES) assert.ok(!(t in reg.SYNC_REGISTRY), t);
  assert.deepEqual(dbTables, [...KNOWN_TABLES].sort(), 'db.js tables changed: update KNOWN_TABLES and syncRegistry.js');
  assert.deepEqual([...reg.REGISTRY_TABLES].sort(), dbTables);
});

test('every field sits in exactly one bucket, and implicit fields are never re-listed', () => {
  for (const [table, entry] of Object.entries(reg.SYNC_REGISTRY)) {
    const seen = new Map();
    for (const bucket of ['cloud', 'private', 'pending', 'derived']) {
      for (const f of entry[bucket] || []) {
        assert.ok(!seen.has(f), `${table}.${f} is in both ${seen.get(f)} and ${bucket}`);
        assert.ok(!reg.IMPLICIT_CLOUD_FIELDS.includes(f), `${table}.${f} is implicit; don't list it`);
        seen.set(f, bucket);
      }
    }
    assert.ok(['all', 'none', 'referenced'].includes(entry.rows) || typeof entry.rows === 'function',
      `${table}: bad row rule`);
  }
});

test('coverage: every key in the Thornfield sample packet is classified', () => {
  const unclassified = [];
  for (const [table, rows] of Object.entries(packet)) {
    const entry = reg.SYNC_REGISTRY[table];
    const known = new Set([
      ...reg.IMPLICIT_CLOUD_FIELDS, ...entry.cloud, ...entry.private, ...entry.pending
    ]);
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!known.has(key)) unclassified.push(`${table}.${key}`);
      }
    }
  }
  assert.deepEqual([...new Set(unclassified)], [],
    'unclassified field(s): add each to cloud or private in shared/data/syncRegistry.js');
});

test('the packet is a real one (the seed ran and populated the main tables)', () => {
  for (const t of ['dogs', 'events', 'contacts', 'kennels', 'litters', 'sales', 'waitlist_entries']) {
    assert.ok(packet[t].length > 0, `${t} is empty — did the seed run?`);
  }
});

test('the projected packet carries no private or pending key anywhere, and passes the positive check', () => {
  const cloud = reg.filterCollectionsForCloud(packet);
  reg.assertCloudCollections(cloud);
  for (const [table, rows] of Object.entries(cloud)) {
    const entry = reg.SYNC_REGISTRY[table];
    for (const row of rows) {
      for (const f of [...entry.private, ...entry.pending]) {
        assert.ok(!(f in row), `${table}.${f} leaked into the cloud projection`);
      }
    }
  }
  assert.equal(cloud.expenses.length, 0, 'expenses never go to the cloud');
  assert.equal(cloud.dogs.length, packet.dogs.length, 'every dog row is kept');
  // The money is really in the source, so its absence above means something.
  assert.ok(packet.sales.some((s) => s.price != null), 'sample sales carry prices');
  assert.ok(packet.contacts.some((c) => c.email || c.phone), 'sample contacts carry email/phone');
});

test('projection builds a NEW object by name (no spread, no shared reference)', () => {
  const dog = packet.dogs[0];
  const out = reg.projectRow('dogs', dog);
  assert.notEqual(out, dog);
  out.call_name = 'changed';
  assert.notEqual(dog.call_name, 'changed');
  // Keys absent on the source are omitted, not written as undefined.
  const sparse = reg.projectRow('dogs', { id: 'x', call_name: 'Rex', notes: 'secret' });
  assert.deepEqual(sparse, { id: 'x', call_name: 'Rex' });
});

test('assertCloudRow throws on an injected private key, an unclassified key, and an unknown table', () => {
  const dog = reg.projectRow('dogs', packet.dogs[0]);
  assert.throws(() => reg.assertCloudRow('dogs', { ...dog, notes: 'x' }), reg.CloudKeyError);
  assert.throws(() => reg.assertCloudRow('dogs', { ...dog, brand_new_field: 1 }), reg.CloudKeyError);
  assert.throws(() => reg.assertCloudRow('contacts', { id: 'c', name: 'Pat', email: 'p@x.co' }), /email/);
  // A partial object field: only its listed keys may ride along.
  reg.assertCloudRow('waitlist_entries', { id: 'w', application: { name: 'Sam', email: 's@x.co' } });
  assert.throws(() => reg.assertCloudRow('waitlist_entries', { id: 'w', application: { name: 'Sam', phone: '555' } }), /application\.phone/);
  assert.throws(() => reg.assertCloudRow('sales', { id: 's', price: 1500 }), /price/);
  assert.throws(() => reg.assertCloudRow('expenses', { id: 'e', amount: 1 }), reg.CloudKeyError);
  assert.throws(() => reg.assertCloudRow('no_such_table', { id: 'z' }), reg.CloudKeyError);
  // Derived keys are allowed only where declared.
  reg.assertCloudRow('files', { id: 'f', mime: 'application/pdf', sha256: 'abc' });
  assert.throws(() => reg.assertCloudRow('dogs', { id: 'd', sha256: 'abc' }), reg.CloudKeyError);
});

test('event details: textarea and undeclared keys are private; other declared keys are cloud', () => {
  const illness = { diagnosis: 'Giardia', treatment: 'Metronidazole 10 days', extra: 'x' };
  assert.deepEqual(reg.filterEventDetails('illness', illness), { diagnosis: 'Giardia' });
  assert.deepEqual(
    reg.filterEventDetails('vet_visit', { reason: 'Annual', vet: 'Dr. A', findings: 'Mild otitis' }),
    { reason: 'Annual', vet: 'Dr. A' }
  );
  assert.deepEqual(reg.filterEventDetails('note', { notes: 'anything' }), {});
  assert.deepEqual(reg.filterEventDetails('unknown_type', { a: 1 }), {});
  assert.equal(reg.filterEventDetails('illness', null), null);

  // Derived from vocab: every textarea key of every type is excluded, every other declared key kept.
  for (const t of vocab.EVENT_TYPES) {
    const keys = reg.cloudDetailKeys(t.value);
    for (const f of t.fields || []) {
      assert.equal(keys.has(f.key), f.type !== 'textarea', `${t.value}.details.${f.key}`);
    }
  }

  // The positive check looks inside details too.
  const ev = { id: 'e1', event_type: 'illness', details: { diagnosis: 'x', treatment: 'y' } };
  assert.throws(() => reg.assertCloudRow('events', ev), /details\.treatment/);
  reg.assertCloudRow('events', reg.projectRow('events', ev));
  assert.throws(() => reg.assertCloudRow('events', { id: 'e2', event_type: 'note', details: 'text' }), reg.CloudKeyError);
});

test('row rules: documents by doc_type; files only when a KEPT document references them', () => {
  const collections = {
    documents: [
      { id: 'd1', dog_id: 'dog', doc_type: 'health_test', file_id: 'f1', title: 'OFA hips', notes: 'private' },
      { id: 'd2', dog_id: 'dog', doc_type: 'contract', file_id: 'f2', contract_id: 'c1' },
      { id: 'd3', dog_id: 'dog', doc_type: 'other', file_id: 'f3' },
      { id: 'd4', dog_id: 'dog', doc_type: 'pedigree', file_id: 'f4' },
      { id: 'd5', dog_id: 'dog', doc_type: 'registration', file_id: 'f5' }
    ],
    files: ['f1', 'f2', 'f3', 'f4', 'f5', 'receipt'].map((id) => ({
      id, blob: { fake: true }, mime: 'application/pdf', filename: `${id}.pdf`, size: 10, thumbnail: '', created_at: '2026-01-01T00:00:00.000Z'
    })),
    expenses: [{ id: 'x1', amount: 40, receipt_file_id: 'receipt' }],
    some_future_table: [{ id: 'z' }]
  };
  const cloud = reg.filterCollectionsForCloud(collections);
  assert.deepEqual(cloud.documents.map((d) => d.id), ['d1', 'd4', 'd5']);
  assert.deepEqual(cloud.files.map((f) => f.id), ['f1', 'f4', 'f5']);
  assert.ok(cloud.files.every((f) => !('blob' in f)), 'the blob never rides the snapshot JSON');
  assert.ok(!('notes' in cloud.documents[0]));
  assert.deepEqual(cloud.expenses, []);
  assert.ok(!('some_future_table' in cloud), 'an unregistered table is dropped');
  reg.assertCloudCollections(cloud);
  // keepsRow without a context keeps no file (fail closed).
  assert.equal(reg.keepsRow('files', { id: 'f1' }), false);
});

test('the decided §5 privacy lines hold (field-by-field spot checks)', () => {
  const cloud = (t, f) => reg.isCloudField(t, f);
  // Contacts: name is cloud; how to reach them is not.
  assert.ok(cloud('contacts', 'name'));
  for (const f of ['email', 'phone', 'address', 'notes', 'companion_note']) assert.ok(!cloud('contacts', f), f);
  // Money never leaves.
  for (const f of ['price', 'deposit_amount', 'transport_fee', 'payment_method', 'invoice_number', 'lead_source', 'referred_by_contact_id']) {
    assert.ok(!cloud('sales', f), `sales.${f}`);
  }
  for (const f of ['fee_amount', 'pick_value_amount', 'referred_by_contact_id']) assert.ok(!cloud('stud_services', f), f);
  for (const f of ['expected_price_male', 'foster_our_share_pct', 'foster_flat_fee_per_pup']) assert.ok(!cloud('litters', f), f);
  // Notes are private on every table that has them.
  for (const [table, entry] of Object.entries(reg.SYNC_REGISTRY)) {
    assert.ok(!entry.cloud.includes('notes'), `${table}.notes must not be cloud`);
  }
  // Waitlist: the position anchor is cloud; the family's fee money isn't.
  assert.ok(cloud('waitlist_entries', 'fee_received_date'));
  for (const f of ['fee_amount', 'fee_payment_method', 'pause_reason']) assert.ok(!cloud('waitlist_entries', f), f);
  // Decided 2026-10-07 (Cloud plan §5.1): her waitlist setup and the running
  // state are cloud; of an application, only the applicant's name + email.
  for (const f of ['ready_timing', 'soon_notified_litter_ids', 'application_questions']) assert.ok(cloud('waitlist_entries', f), f);
  assert.deepEqual(reg.projectRow('waitlist_entries', {
    id: 'w', application: { name: 'Sam Lee', email: 's@x.co', phone: '555', household: 'two kids', about: 'long story' }
  }).application, { name: 'Sam Lee', email: 's@x.co' });
  assert.ok(!cloud('waitlist_programs', 'fee_override'));
  assert.ok(cloud('kennels', 'location'));
  // The five fields first left pending (decided 2026-10-06).
  assert.ok(cloud('dogs', 'dob_is_estimated'));
  assert.ok(cloud('dogs', 'recorded_coi'));
  assert.ok(cloud('litters', 'picks_opened_date'));
  assert.ok(cloud('kennels', 'waitlist_config'), 'her own waitlist setup (decided 2026-10-07)');
  assert.ok(cloud('kennels', 'puppy_record_fields'), 'a print setting (2026-10-09)');
  assert.ok(!cloud('litters', 'feeding_schedule_override'));
});

test('restore keeps an applicant\'s private answers on the device and takes name + email from the snapshot', () => {
  const local = { id: 'w', updated_at: 'a', application: { name: 'Old', email: 'old@x.co', phone: '555', household: 'two kids' } };
  const snap = { id: 'w', updated_at: 'b', application: { name: 'Sam Lee', email: 's@x.co' } };
  assert.deepEqual(reg.overlayCloudFields('waitlist_entries', local, snap).application,
    { name: 'Sam Lee', email: 's@x.co', phone: '555', household: 'two kids' });
  // A new device (no local row) gets just what the snapshot has.
  assert.deepEqual(reg.snapshotRowToLocal('waitlist_entries', snap).application, { name: 'Sam Lee', email: 's@x.co' });
});
