// cloudBackup.test.js — Cloud Phase 1 plan §9 step 2, still no network:
//   - buildCloudSnapshot (plan §4.1): sample rows dropped, registry projection,
//     file blobs pulled out by sha256, the positive key check, the envelope;
//   - gzip round trip;
//   - the shrink guard thresholds (plan §3.5);
//   - importExport's 'cloud-merge' restore (plan §4.3): private fields survive,
//     missing rows are inserted, newer-wins vs overwrite, events.details merge,
//     files fetched by sha256, never deletes;
//   - the dirty signal (plan §3.2) set by repo writes and restores.
// Runs against the in-memory Dexie stand-in (tests/support/memoryDb.js).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables;
let cb;          // data/cloud/cloudBackup.js
let ie;          // data/importExport.js
let settings;    // data/settings.js
let dogRepo;
let seedSampleData;

before(async () => {
  ({ tables } = await installMemoryDb());
  cb = await import('../shared/data/cloud/cloudBackup.js');
  ie = await import('../shared/data/importExport.js');
  settings = await import('../shared/data/settings.js');
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ seedSampleData } = await import('../shared/data/sampleData.js'));
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
});

const put = (table, row) => tables[table].rows.set(row.id, structuredClone(row));
const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-02-01T00:00:00.000Z';
const T2 = '2026-03-01T00:00:00.000Z';
const base = (id, at = T1) => ({ id, is_archived: false, created_at: T0, updated_at: at });

// A small "real" program written straight into the tables (not via the seed).
function putProgram() {
  put('kennels', { ...base('k1'), kennel_name: 'Oak Hill', is_own_kennel: true, waitlist_config: { fee_amount: 300 } });
  put('contacts', { ...base('c1'), name: 'Pat Buyer', email: 'pat@example.com', phone: '555-0100', address: '1 Elm St', notes: 'n' });
  put('dogs', { ...base('d1'), call_name: 'Maple', sex: 'female', breed: 'Boxer', status: 'active_breeding', ownership_type: 'owned', kennel_id: 'k1', notes: 'private dog note' });
  put('dogs', { ...base('d2'), call_name: 'Juniper', sex: 'male', breed: 'Boxer', status: 'puppy', ownership_type: 'owned', kennel_id: 'k1', notes: 'pup note' });
  put('sales', { ...base('s1'), kennel_id: 'k1', dog_id: 'd2', buyer_contact_id: 'c1', status: 'reserved', registration_type: 'limited', price: 2500, deposit_amount: 500, notes: 'x' });
  put('events', {
    ...base('e1'), subject_type: 'dog', subject_id: 'd1', event_type: 'illness', event_date: '2026-01-10', title: 'Sick',
    details: { diagnosis: 'Giardia', treatment: 'Metronidazole' }, notes: 'vet said'
  });
  put('expenses', { ...base('x1'), subject_type: 'dog', subject_id: 'd1', amount: 80, category: 'vet', expense_date: '2026-01-10' });
}

// --- buildCloudSnapshot -------------------------------------------------------

test('a seeded sample packet produces an empty snapshot (sample data is never backed up)', async () => {
  await seedSampleData();
  assert.ok(tables.dogs.rows.size > 0);
  const { envelope, files } = await cb.buildCloudSnapshot();
  for (const [table, n] of Object.entries(envelope.counts)) assert.equal(n, 0, `${table} should be empty`);
  assert.deepEqual(files, []);
});

test('real records added beside the sample are the only ones kept, projected to the cloud tier', async () => {
  await seedSampleData();
  put('contacts', { ...base('c0'), name: 'Outside Owner' });
  const dog = await dogRepo.create({ call_name: 'Real Dog', sex: 'male', breed: 'Boxer', status: 'external', ownership_type: 'external', owner_contact_id: 'c0', notes: 'keep me local' });
  const { envelope } = await cb.buildCloudSnapshot();
  assert.deepEqual(envelope.collections.dogs.map((d) => d.id), [dog.id]);
  assert.ok(!('notes' in envelope.collections.dogs[0]));
  assert.equal(envelope.collections.dogs[0].call_name, 'Real Dog');
});

test('the whole sample packet, treated as real, projects cleanly and fills the envelope', async () => {
  await seedSampleData();
  const now = new Date('2026-10-06T09:14:00.000Z');
  const { envelope } = await cb.buildCloudSnapshot({ manifest: null, deviceId: 'dev-1', now });
  assert.equal(envelope.snapshot_format, cb.SNAPSHOT_FORMAT);
  assert.equal(envelope.schema_version, 1);
  assert.equal(envelope.created_at, now.toISOString());
  assert.equal(envelope.device_id, 'dev-1');
  assert.equal(envelope.edition, 'pro');
  assert.equal(envelope.counts.dogs, tables.dogs.rows.size);
  assert.equal(envelope.counts.expenses, 0);
  const c = envelope.collections;
  for (const [table, rows] of Object.entries(c)) {
    for (const r of rows) assert.ok(!('notes' in r), `${table}.notes leaked into the snapshot`);
  }
  for (const r of c.contacts) for (const f of ['email', 'phone', 'address']) assert.ok(!(f in r), `contacts.${f} leaked`);
  for (const r of c.sales) for (const f of ['price', 'deposit_amount']) assert.ok(!(f in r), `sales.${f} leaked`);
  // Waitlist (decided 2026-10-07): an application carries only name + email; the
  // family's own fee and payment details stay on the device.
  assert.ok(c.waitlist_entries.some((e) => e.application?.name), 'applicant names are backed up');
  for (const e of c.waitlist_entries) {
    for (const f of ['fee_amount', 'fee_payment_method', 'fee_payment_reference', 'pause_reason']) assert.ok(!(f in e), `waitlist_entries.${f} leaked`);
    if (e.application) for (const k of Object.keys(e.application)) assert.ok(['name', 'email'].includes(k), `application.${k} leaked`);
  }
});

test('files: only those a kept document references, by sha256, blob out of the JSON, deduped', async () => {
  putProgram();
  const pdf = new Blob(['abc'], { type: 'application/pdf' });
  put('files', { id: 'f1', blob: pdf, mime: 'application/pdf', filename: 'ofa.pdf', size: 3, thumbnail: '', created_at: T0 });
  put('files', { id: 'f1copy', blob: new Blob(['abc'], { type: 'application/pdf' }), mime: 'application/pdf', filename: 'ofa2.pdf', size: 3, thumbnail: '', created_at: T0 });
  put('files', { id: 'f2', blob: new Blob(['contract'], { type: 'application/pdf' }), mime: 'application/pdf', filename: 'c.pdf', size: 8, thumbnail: '', created_at: T0 });
  put('files', { id: 'receipt', blob: new Blob(['r']), mime: 'application/pdf', filename: 'r.pdf', size: 1, thumbnail: '', created_at: T0 });
  put('documents', { ...base('doc1'), kennel_id: 'k1', dog_id: 'd1', doc_type: 'health_test', file_id: 'f1', title: 'OFA', notes: 'private' });
  put('documents', { ...base('doc1b'), kennel_id: 'k1', dog_id: 'd1', doc_type: 'pedigree', file_id: 'f1copy' });
  put('documents', { ...base('doc2'), kennel_id: 'k1', dog_id: 'd1', doc_type: 'contract', file_id: 'f2', contract_id: 'k' });

  const { envelope, files } = await cb.buildCloudSnapshot();
  const sha = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'; // sha256("abc")
  assert.deepEqual(envelope.collections.files.map((f) => [f.id, f.sha256]).sort(), [['f1', sha], ['f1copy', sha]]);
  assert.ok(envelope.collections.files.every((f) => !('blob' in f)));
  assert.equal(files.length, 1, 'one upload per distinct content');
  assert.equal(files[0].sha256, sha);
  assert.equal(files[0].size, 3);
  assert.equal(files[0].mime, 'application/pdf');
  assert.deepEqual(envelope.collections.documents.map((d) => d.id).sort(), ['doc1', 'doc1b']);
});

test('the positive key check stops a snapshot when a private key would slip through', async () => {
  const reg = await import('../shared/data/syncRegistry.js');
  putProgram();
  const { envelope } = await cb.buildCloudSnapshot();
  reg.assertCloudCollections(envelope.collections);
  envelope.collections.dogs[0].notes = 'oops';
  assert.throws(() => reg.assertCloudCollections(envelope.collections), reg.CloudKeyError);
});

test('gzip round trip', async () => {
  putProgram();
  const { envelope } = await cb.buildCloudSnapshot();
  const gz = await cb.gzipJson(envelope);
  assert.equal(gz.type, 'application/gzip');
  assert.deepEqual(await cb.gunzipJson(gz), envelope);
});

// --- Shrink guard -------------------------------------------------------------

test('shrink guard: fewer than half the dogs or total records, when the last had at least 10', () => {
  const ok = (p, n) => cb.checkShrink(p, n).ok;
  assert.equal(ok(null, { dogs: 0 }), true, 'first push');
  assert.equal(ok({ dogs: 10, events: 20 }, { dogs: 5, events: 20 }), true, 'exactly half is fine');
  assert.equal(ok({ dogs: 10, events: 20 }, { dogs: 4, events: 20 }), false, 'dogs below half');
  assert.equal(ok({ dogs: 4, events: 40 }, { dogs: 4, events: 10 }), false, 'total below half');
  assert.equal(ok({ dogs: 9 }, { dogs: 0 }), true, 'under 10 dogs and 9 total: never trips');
  assert.equal(ok({ dogs: 6, events: 4 }, { dogs: 0, events: 4 }), false, 'total 10 → 4 trips even with few dogs');
  assert.equal(ok({ dogs: 50, events: 500 }, { dogs: 0, events: 0 }), false, 'a wiped device');
  const r = cb.checkShrink({ dogs: 20, events: 10 }, { dogs: 8, events: 10 });
  assert.deepEqual(r.dogs, { previous: 20, next: 8 });
  assert.deepEqual(r.total, { previous: 30, next: 18 });
});

// --- 'cloud-merge' restore ----------------------------------------------------

async function snapshotOfProgram() {
  putProgram();
  const { envelope } = await cb.buildCloudSnapshot();
  return structuredClone(envelope);
}

test('cloud-merge on an empty device inserts every row, with private fields absent', async () => {
  const snap = await snapshotOfProgram();
  for (const t of Object.values(tables)) t.rows.clear();
  const { summary } = await ie.restoreBackup(snap, 'cloud-merge');
  assert.equal(summary.dogs.inserted, 2);
  const d1 = tables.dogs.rows.get('d1');
  assert.equal(d1.call_name, 'Maple');
  assert.ok(!('notes' in d1));
  assert.equal(tables.sales.rows.get('s1').price, undefined);
  assert.equal(tables.expenses.rows.size, 0);
});

test('cloud-merge keeps every private field already on the device', async () => {
  const snap = await snapshotOfProgram();
  snap.collections.dogs.find((d) => d.id === 'd1').status = 'retired_breeding';
  snap.collections.dogs.find((d) => d.id === 'd1').updated_at = T2; // newer than local
  await ie.restoreBackup(snap, 'cloud-merge');
  const d1 = tables.dogs.rows.get('d1');
  assert.equal(d1.status, 'retired_breeding');
  assert.equal(d1.notes, 'private dog note');
  assert.equal(tables.sales.rows.get('s1').price, 2500);
  assert.equal(tables.contacts.rows.get('c1').email, 'pat@example.com');
  assert.deepEqual(tables.kennels.rows.get('k1').waitlist_config, { fee_amount: 300 });
});

test('overwrite:false leaves a locally newer row alone; overwrite:true rolls it back', async () => {
  const snap = await snapshotOfProgram(); // d1 at T1 in the snapshot
  const local = tables.dogs.rows.get('d1');
  local.status = 'retired_breeding';
  local.updated_at = T2; // edited after the snapshot

  const r1 = await ie.restoreBackup(snap, 'cloud-merge', { overwrite: false });
  assert.equal(tables.dogs.rows.get('d1').status, 'retired_breeding');
  assert.equal(r1.summary.dogs.keptLocal, 1);

  const preview = await ie.planCloudMerge(snap, { overwrite: true });
  assert.equal(preview.summary.dogs.updated, 1, 'the "N records will be rolled back" count');
  assert.equal(tables.dogs.rows.get('d1').status, 'retired_breeding', 'planning writes nothing');

  await ie.restoreBackup(snap, 'cloud-merge', { overwrite: true });
  const d1 = tables.dogs.rows.get('d1');
  assert.equal(d1.status, 'active_breeding');
  assert.equal(d1.updated_at, T1);
  assert.equal(d1.notes, 'private dog note', 'private fields keep their current values');
});

test('a cloud field absent from the snapshot row is cleared on overlay', async () => {
  const snap = await snapshotOfProgram();
  const row = snap.collections.dogs.find((d) => d.id === 'd1');
  delete row.kennel_id;
  row.updated_at = T2;
  await ie.restoreBackup(snap, 'cloud-merge');
  assert.ok(!('kennel_id' in tables.dogs.rows.get('d1')));
});

test('events.details merges by key: cloud keys from the snapshot, private keys kept locally', async () => {
  const snap = await snapshotOfProgram();
  const ev = snap.collections.events.find((e) => e.id === 'e1');
  assert.deepEqual(ev.details, { diagnosis: 'Giardia' });
  ev.details.diagnosis = 'Coccidia';
  ev.updated_at = T2;
  await ie.restoreBackup(snap, 'cloud-merge');
  const local = tables.events.rows.get('e1');
  assert.deepEqual(local.details, { diagnosis: 'Coccidia', treatment: 'Metronidazole' });
  assert.equal(local.notes, 'vet said');
});

test('restore never deletes local rows the snapshot lacks', async () => {
  const snap = await snapshotOfProgram();
  put('dogs', { ...base('d3'), call_name: 'Local Only', sex: 'male', breed: 'Boxer', status: 'external', ownership_type: 'external' });
  await ie.restoreBackup(snap, 'cloud-merge', { overwrite: true });
  assert.ok(tables.dogs.rows.has('d3'));
});

test('files: a missing file is fetched by sha256; without a fetcher it is reported missing', async () => {
  putProgram();
  put('files', { id: 'f1', blob: new Blob(['abc'], { type: 'application/pdf' }), mime: 'application/pdf', filename: 'ofa.pdf', size: 3, thumbnail: '', created_at: T0 });
  put('documents', { ...base('doc1'), kennel_id: 'k1', dog_id: 'd1', doc_type: 'health_test', file_id: 'f1' });
  const { envelope } = await cb.buildCloudSnapshot();
  const snap = structuredClone(envelope);

  tables.files.rows.clear();
  const r1 = await ie.restoreBackup(snap, 'cloud-merge');
  assert.deepEqual(r1.missingFiles, ['f1']);
  assert.equal(tables.files.rows.size, 0);

  const asked = [];
  const r2 = await ie.restoreBackup(snap, 'cloud-merge', {
    fetchFile: async (sha) => { asked.push(sha); return new Blob(['abc'], { type: 'application/pdf' }); }
  });
  assert.deepEqual(r2.missingFiles, []);
  assert.equal(asked.length, 1);
  const f1 = tables.files.rows.get('f1');
  assert.equal(await f1.blob.text(), 'abc');
  assert.ok(!('sha256' in f1), 'the derived key is never stored locally');

  // Already present: no fetch.
  const r3 = await ie.restoreBackup(snap, 'cloud-merge', { fetchFile: async () => { throw new Error('should not fetch'); } });
  assert.equal(r3.summary.files.unchanged, 1);
});

test('cloud-merge refuses a snapshot format it does not understand', async () => {
  const snap = await snapshotOfProgram();
  snap.snapshot_format = 2;
  await assert.rejects(ie.restoreBackup(snap, 'cloud-merge'), /format v2/);
});

// --- Dirty signal -------------------------------------------------------------

test('repo writes and restores set cloudDirtyAt; clearCloudDirty only clears what was pushed', async () => {
  assert.equal(settings.getCloudDirtyAt(), null);
  put('contacts', { ...base('c0'), name: 'Outside Owner' });
  await dogRepo.create({ call_name: 'A', sex: 'male', breed: 'Boxer', status: 'external', ownership_type: 'external', owner_contact_id: 'c0' });
  const at = settings.getCloudDirtyAt();
  assert.ok(at);

  settings.markDataChanged('2099-01-01T00:00:00.000Z'); // a change lands mid-push
  settings.clearCloudDirty(at);
  assert.equal(settings.getCloudDirtyAt(), '2099-01-01T00:00:00.000Z', 'a newer change survives');
  settings.clearCloudDirty('2099-01-01T00:00:00.000Z');
  assert.equal(settings.getCloudDirtyAt(), null);

  const snap = await snapshotOfProgram();
  settings.clearCloudDirty();
  snap.collections.dogs.find((d) => d.id === 'd1').updated_at = T2;
  await ie.restoreBackup(snap, 'cloud-merge');
  assert.ok(settings.getCloudDirtyAt());
});
