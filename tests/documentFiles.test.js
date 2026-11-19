// documentFiles.test.js — a document's file is stored with the document or not at
// all (review K2-8; Review Remainder plan §3 E): the kennel is checked before any
// blob is written, the old file goes only once an edit has saved, and the
// Duplicates card lists files nothing uses.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, documentRepo, fileRepo, kennelRepo, PICK_KENNEL_MESSAGE;
before(async () => {
  ({ tables } = await installMemoryDb());
  ({ documentRepo } = await import('../shared/data/documentRepo.js'));
  ({ fileRepo } = await import('../shared/data/fileRepo.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ PICK_KENNEL_MESSAGE } = await import('../shared/data/kennelScope.js'));
});
beforeEach(() => { for (const t of Object.values(tables)) t.rows.clear(); });

const pdf = (text = '%PDF-1.4 x') => ({ blob: new Blob([text], { type: 'application/pdf' }), filename: 'pedigree.pdf', thumbnail: '' });

test('three failed saves with no kennel leave no files, and say what to do', async () => {
  for (let i = 0; i < 3; i++) {
    await assert.rejects(documentRepo.createWithFile({ dog_id: 'ped-only', doc_type: 'pedigree', kennel_id: null }, pdf()),
      (e) => e.message === PICK_KENNEL_MESSAGE);
  }
  assert.equal(tables.files.rows.size, 0);
  assert.equal(tables.documents.rows.size, 0);
  assert.equal(PICK_KENNEL_MESSAGE, 'Pick one of your kennels at the top first, then save again.');
});

test('a good save stores the file and the document together', async () => {
  const k = await kennelRepo.create({ kennel_name: 'Ashvale', is_own_kennel: true });
  const doc = await documentRepo.createWithFile({ dog_id: 'd1', doc_type: 'pedigree', kennel_id: k.id, title: 'Pedigree' }, pdf());
  assert.equal(tables.files.rows.size, 1);
  assert.ok(tables.files.rows.has(doc.file_id));
  await assert.rejects(documentRepo.createWithFile({ dog_id: 'd1', doc_type: 'pedigree', kennel_id: k.id }, null), /Choose a PDF/);
  assert.equal(tables.files.rows.size, 1);
});

test('an edit that fails keeps the old file; one that saves replaces it', async () => {
  const k = await kennelRepo.create({ kennel_name: 'Ashvale', is_own_kennel: true });
  const doc = await documentRepo.createWithFile({ dog_id: 'd1', doc_type: 'pedigree', kennel_id: k.id }, pdf('old'));
  const oldFile = doc.file_id;
  // A change the document can't take (no dog): refused before anything is written.
  await assert.rejects(documentRepo.updateWithFile(doc.id, { dog_id: '' }, pdf('new')), /a dog is required/);
  assert.deepEqual([...tables.files.rows.keys()], [oldFile], 'the old file is still there, and no new one');
  assert.equal((await documentRepo.getById(doc.id)).file_id, oldFile);

  const saved = await documentRepo.updateWithFile(doc.id, { title: 'Re-scanned' }, pdf('new'));
  assert.notEqual(saved.file_id, oldFile);
  assert.deepEqual([...tables.files.rows.keys()], [saved.file_id], 'the old file goes once the edit saved');
  assert.equal((await documentRepo.updateWithFile(doc.id, { title: 'No new file' })).file_id, saved.file_id);
});

test('files nothing uses are listed, largest first, and only those can be removed', async () => {
  const k = await kennelRepo.create({ kennel_name: 'Ashvale', is_own_kennel: true });
  const doc = await documentRepo.createWithFile({ dog_id: 'd1', doc_type: 'pedigree', kennel_id: k.id }, pdf());
  const receipt = await fileRepo.create(new Blob(['r']), { filename: 'receipt.pdf' });
  tables.expenses.rows.set('e1', { id: 'e1', receipt_file_id: receipt });
  const small = await fileRepo.create(new Blob(['x'.repeat(10)]), { filename: 'small.pdf' });
  const big = await fileRepo.create(new Blob(['x'.repeat(5000)]), { filename: 'big.pdf' });
  const unused = await fileRepo.unused();
  assert.deepEqual(unused.map((f) => f.id), [big, small]);
  assert.equal(unused[0].filename, 'big.pdf');
  assert.equal(await fileRepo.removeUnused(doc.file_id), false, 'a file a document names is kept');
  assert.equal(await fileRepo.removeUnused(receipt), false, 'a receipt is kept');
  assert.equal(await fileRepo.removeUnused(big), true);
  assert.deepEqual((await fileRepo.unused()).map((f) => f.id), [small]);
});
