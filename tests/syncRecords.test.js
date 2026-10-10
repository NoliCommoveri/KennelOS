// syncRecords.test.js — live sync's record format and change detection (Cloud
// Phase 2 plan §3.3, §4; build step 1): data/cloud/syncRecords.js (pure) and
// data/cloud/syncState.js (the scan over sync_meta), run over the real sample
// data in the in-memory db.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb, snapshotTables } from './support/memoryDb.js';

let tables; let rec; let state; let reg; let crypto; let seeded;
let vault; let otherVault;

before(async () => {
  ({ tables } = await installMemoryDb());
  rec = await import('../shared/data/cloud/syncRecords.js');
  state = await import('../shared/data/cloud/syncState.js');
  reg = await import('../shared/data/syncRegistry.js');
  crypto = await import('../shared/data/cloud/vaultCrypto.js');
  const { seedSampleData } = await import('../shared/data/sampleData.js');
  await seedSampleData();
  seeded = snapshotTables(tables);
  vault = await crypto.generateVaultKey();
  otherVault = await crypto.generateVaultKey();
});

// Every test starts from the seeded tables, treated as real records (no manifest).
beforeEach(() => {
  for (const [name, t] of Object.entries(tables)) {
    t.rows.clear();
    for (const r of seeded[name] || []) t.rows.set(r.id, structuredClone(r));
  }
});
const real = { manifest: null };

test('sync_meta is device-only: in no backup, no registry, and a declared device-only table', async () => {
  const { DEVICE_ONLY_TABLES, dataTables } = await import('../shared/data/db.js');
  assert.ok(DEVICE_ONLY_TABLES.includes('sync_meta'));
  assert.ok(!dataTables().some((t) => t.name === 'sync_meta'));
  assert.ok(!('sync_meta' in reg.SYNC_REGISTRY));
  const { exportAll } = await import('../shared/data/importExport.js');
  assert.ok(!('sync_meta' in (await exportAll({ encodeBlobs: false })).collections));
  assert.deepEqual([...rec.APPLY_ORDER].sort(), [...rec.SYNC_TABLES].sort(), 'every syncing table has an apply position');
});

test('canonicalJson ignores key order and drops undefined; the hash follows it', async () => {
  assert.equal(rec.canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } }), '{"a":{"d":[1,{"x":1,"y":2}]},"b":1}');
  const h1 = await rec.rowHash('dogs', { id: 'a', call_name: 'Birch', sex: 'female' });
  assert.equal(await rec.rowHash('dogs', { sex: 'female', call_name: 'Birch', id: 'a' }), h1);
  assert.notEqual(await rec.rowHash('dogs', { id: 'a', call_name: 'Birch', sex: 'male' }), h1);
  assert.notEqual(await rec.rowHash('litters', { id: 'a', call_name: 'Birch', sex: 'female' }), h1, 'the table is part of it');
  assert.notEqual(await rec.rowHash('files', { id: 'f' }, { cloud: true }), await rec.rowHash('files', { id: 'f' }, { cloud: false }));
});

test('every sample record round-trips; the cloud part passes the allow-list and holds no private field', async () => {
  const { rows, keptFileIds } = await state.readSyncRows(real);
  assert.ok(rows.size > 100, 'the sample packet is a real workout');
  let clouds = 0;
  for (const r of rows.values()) {
    let syncRow = r.syncRow;
    if (r.tbl === 'files') syncRow = (await rec.sealFileRow(syncRow, r.blob, vault, { cloud: r.cloudFile })).row;
    const record = await rec.buildPutRecord(r.tbl, syncRow, vault, { keptFileIds, baseSeq: 7 });
    assert.equal(record.base_seq, 7);
    assert.equal(record.key_id, vault.keyId);
    if (record.cloud) {
      clouds++;
      reg.assertCloudRow(r.tbl, record.cloud);
      const entry = reg.SYNC_REGISTRY[r.tbl];
      for (const field of entry.private) assert.ok(!(field in record.cloud), `${r.tbl}.${field} reached the cloud part`);
    }
    const back = await rec.readRecord(record, vault);
    const expected = r.tbl === 'files' ? (({ vault_file, ...rest }) => rest)(syncRow) : syncRow;
    assert.deepEqual(back.row, expected, `${r.tbl}/${r.row_id}`);
  }
  assert.ok(clouds > 50);
});

test('the sealed part opens only with the vault key it was made with', async () => {
  const dog = seeded.dogs[0];
  const record = await rec.buildPutRecord('dogs', dog, vault);
  assert.ok(!record.sealed.includes(dog.call_name));
  await assert.rejects(rec.readRecord(record, otherVault), { name: 'VaultLockedError' });
  // A record whose contents name another row is refused.
  const other = await rec.buildPutRecord('dogs', seeded.dogs[1], vault);
  await assert.rejects(rec.readRecord({ ...other, id: dog.id }, vault), /doesn't match/);
});

test('rows the registry keeps nothing of (expenses, private documents) send no cloud part', async () => {
  const expense = { id: 'x1', amount: 12, category: 'food', is_archived: false, created_at: 'a', updated_at: 'b' };
  assert.equal((await rec.buildPutRecord('expenses', expense, vault)).cloud, null);
  const contractDoc = { id: 'd1', doc_type: 'contract', title: 'Sale', is_archived: false };
  assert.equal((await rec.buildPutRecord('documents', contractDoc, vault)).cloud, null);
  const pedigree = { id: 'd2', doc_type: 'pedigree', title: 'Ped', is_archived: false };
  assert.ok((await rec.buildPutRecord('documents', pedigree, vault)).cloud);
});

test('files: a cloud file uploads as is with sha256 in the cloud part; a private one encrypts deterministically', async () => {
  const blob = new Blob(['%PDF pedigree bytes'], { type: 'application/pdf' });
  const plain = 'a'.repeat(64);
  const syncRow = rec.prepareFileRow({ id: 'f1', blob, mime: 'application/pdf', filename: 'p.pdf', created_at: 'c' }, plain);
  assert.ok(!('blob' in syncRow));
  const asCloud = await rec.sealFileRow(syncRow, blob, vault, { cloud: true });
  assert.deepEqual(asCloud.row.vault_file, { sha256: plain, plain_sha256: plain, encrypted: false });
  const cloudRecord = await rec.buildPutRecord('files', asCloud.row, vault, { keptFileIds: new Set(['f1']) });
  assert.equal(cloudRecord.cloud.sha256, plain);
  assert.ok(!('vault_file' in cloudRecord.cloud));

  const asPrivate = await rec.sealFileRow(syncRow, blob, vault, { cloud: false });
  assert.equal(asPrivate.row.vault_file.encrypted, true);
  assert.notEqual(asPrivate.upload.sha256, plain);
  assert.equal((await rec.sealFileRow(syncRow, blob, vault)).upload.sha256, asPrivate.upload.sha256, 'deterministic: an unchanged file is the same upload');
  assert.equal((await rec.buildPutRecord('files', asPrivate.row, vault)).cloud, null);
  const back = await rec.readRecord(await rec.buildPutRecord('files', asPrivate.row, vault), vault);
  assert.deepEqual(back.fileRef, asPrivate.row.vault_file);
  assert.ok(!('vault_file' in back.row));
});

test('the scan: everything is new at first; then only changed rows, and removed ones as deletes', async () => {
  let scan = await state.scanLocalChanges(real);
  assert.equal(scan.deletes.length, 0);
  assert.equal(scan.puts.length, scan.rows.size);
  assert.ok(scan.puts.every((p) => p.baseSeq === 0));
  // Pretend all of it was pushed at seq 1..n.
  let seq = 0;
  await state.writeSyncMeta(scan.puts.map((p) => ({ tbl: p.tbl, row_id: p.row_id, seq: ++seq, hash: p.hash })));
  scan = await state.scanLocalChanges(real);
  assert.deepEqual([scan.puts.length, scan.deletes.length], [0, 0], 'nothing changed');

  const dog = seeded.dogs[0];
  tables.dogs.rows.set(dog.id, { ...dog, notes: 'changed' });
  const gone = seeded.contacts[0];
  tables.contacts.rows.delete(gone.id);
  scan = await state.scanLocalChanges(real);
  assert.deepEqual(scan.puts.map((p) => `${p.tbl}/${p.row_id}`), [`dogs/${dog.id}`]);
  assert.ok(scan.puts[0].baseSeq > 0, 'a changed row carries the seq it was last seen at');
  assert.deepEqual(scan.deletes.map((d) => `${d.tbl}/${d.row_id}`), [`contacts/${gone.id}`]);
  await state.clearSyncMeta();
});

test('the scan leaves sample rows out', async () => {
  const { getSampleDataManifest } = await import('../shared/data/settings.js');
  const manifest = getSampleDataManifest();
  assert.ok(manifest, 'the seed recorded its manifest');
  const scan = await state.scanLocalChanges({ manifest });
  for (const p of scan.puts) assert.ok(!(manifest[p.tbl] || []).includes(p.row_id), `${p.tbl}/${p.row_id} is sample`);
  await state.clearSyncMeta();
});

test('a file becoming cloud (a pedigree now points at it) is re-sent', async () => {
  const blob = new Blob(['x']);
  tables.files.rows.set('fz', { id: 'fz', blob, mime: 'text/plain', filename: 'x.txt', size: 1, created_at: 'c' });
  let scan = await state.scanLocalChanges(real);
  await state.writeSyncMeta(scan.puts.map((p) => ({ tbl: p.tbl, row_id: p.row_id, seq: 1, hash: p.hash })));
  tables.documents.rows.set('dz', { id: 'dz', doc_type: 'pedigree', file_id: 'fz', title: 'P', is_archived: false, created_at: 'c', updated_at: 'c' });
  scan = await state.scanLocalChanges(real);
  assert.deepEqual(scan.puts.map((p) => `${p.tbl}/${p.row_id}`).sort(), ['documents/dz', 'files/fz']);
  assert.equal(scan.puts.find((p) => p.tbl === 'files').cloudFile, true);
  await state.clearSyncMeta();
});
