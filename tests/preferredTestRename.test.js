// preferredTestRename.test.js — renaming one of a kennel's preferred tests
// (kennelRepo.renamePreferredTest, used by Kels's Getting Started): in place, tags
// kept, and two tests renamed into one become one.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, kennelRepo;

before(async () => {
  ({ tables } = await installMemoryDb());
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
});

const T = '2026-01-01T00:00:00.000Z';
const put = (row) => tables.kennels.rows.set(row.id, { is_archived: false, created_at: T, updated_at: T, kennel_name: 'K', is_own_kennel: true, ...row });

test('renamed in place, its breed tags moved with it', async () => {
  put({ id: 'k', preferred_tests: ['OFA Hips', 'PRA', 'Eyes'], preferred_test_breeds: { pra: ['Golden Retriever'] } });
  const k = await kennelRepo.renamePreferredTest('k', 'PRA', 'PRA-prcd');
  assert.deepEqual(k.preferred_tests, ['OFA Hips', 'PRA-prcd', 'Eyes']);
  assert.deepEqual(k.preferred_test_breeds, { 'pra-prcd': ['Golden Retriever'] });
});

test('a case-only rename keeps its tags', async () => {
  put({ id: 'k', preferred_tests: ['ofa hips'], preferred_test_breeds: { 'ofa hips': ['Lab'] } });
  const k = await kennelRepo.renamePreferredTest('k', 'ofa hips', 'OFA Hips');
  assert.deepEqual(k.preferred_tests, ['OFA Hips']);
  assert.deepEqual(k.preferred_test_breeds, { 'ofa hips': ['Lab'] });
});

test('renamed to another test: one test, both breeds; untagged wins', async () => {
  put({ id: 'k', preferred_tests: ['Hips', 'OFA Hips', 'Eyes', 'CAER'], preferred_test_breeds: { hips: ['Lab'], 'ofa hips': ['Golden'], caer: ['Lab'] } });
  let k = await kennelRepo.renamePreferredTest('k', 'Hips', 'ofa hips');
  assert.deepEqual(k.preferred_tests, ['OFA Hips', 'Eyes', 'CAER']);
  assert.deepEqual(k.preferred_test_breeds['ofa hips'], ['Golden', 'Lab']);
  k = await kennelRepo.renamePreferredTest('k', 'CAER', 'Eyes');
  assert.deepEqual(k.preferred_tests, ['OFA Hips', 'Eyes']);
  assert.equal(k.preferred_test_breeds.eyes, undefined);
  assert.equal(k.preferred_test_breeds.caer, undefined);
});

test('a blank name or an unknown test is refused', async () => {
  put({ id: 'k', preferred_tests: ['Eyes'] });
  await assert.rejects(() => kennelRepo.renamePreferredTest('k', 'Eyes', '  '), /Give the test a name/);
  await assert.rejects(() => kennelRepo.renamePreferredTest('k', 'Hips', 'OFA'), /isn't one of/);
});
