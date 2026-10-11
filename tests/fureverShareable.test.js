// fureverShareable.test.js — which documents may go into a FurEver litter pack
// (documentRepo.isFureverShareable, decided 2026-10-11): nothing until she marks
// it shareable, except a document already published, which stays shareable until
// she sets it either way.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let isFureverShareable, publishedFureverDocIds;
before(async () => {
  await installMemoryDb();
  ({ isFureverShareable, publishedFureverDocIds } = await import('../shared/data/documentRepo.js'));
});

const litters = [
  { id: 'l1', furever_pack: { selection: { documentIds: ['d1', 'd2'] } } },
  { id: 'l2', furever_pack: null },
  { id: 'l3' }
];

test('publishedFureverDocIds collects every litter pack\'s documents', () => {
  assert.deepEqual([...publishedFureverDocIds(litters)].sort(), ['d1', 'd2']);
  assert.equal(publishedFureverDocIds(undefined).size, 0);
});

test('a document is not shareable until she says so', () => {
  assert.equal(isFureverShareable({ id: 'd9' }), false);
  assert.equal(isFureverShareable({ id: 'd9', furever_shareable: true }), true);
  assert.equal(isFureverShareable(null), false);
});

test('an already-published document stays shareable until she sets it', () => {
  const published = publishedFureverDocIds(litters);
  assert.equal(isFureverShareable({ id: 'd1' }, published), true);
  assert.equal(isFureverShareable({ id: 'd1', furever_shareable: false }, published), false);
});

test('documentRepo keeps her choice through create and update', async () => {
  const { documentRepo } = await import('../shared/data/documentRepo.js');
  const { kennelRepo } = await import('../shared/data/kennelRepo.js');
  const k = await kennelRepo.create({ kennel_name: 'T', is_own_kennel: true });
  const plain = await documentRepo.create({ kennel_id: k.id, dog_id: 'dog', doc_type: 'health_test', file_id: 'f' });
  assert.equal('furever_shareable' in plain, false);
  const marked = await documentRepo.create({ kennel_id: k.id, dog_id: 'dog', doc_type: 'health_test', file_id: 'f', furever_shareable: true });
  assert.equal(marked.furever_shareable, true);
  assert.equal((await documentRepo.update(marked.id, { title: 'Hips' })).furever_shareable, true);
  assert.equal((await documentRepo.update(marked.id, { furever_shareable: false })).furever_shareable, false);
});
