// csvImportPlan.test.js — buildPlan against the in-memory database: the same dog on
// several rows of one file (review K2-2), and a file's day/month date order (K2-3).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables; let kennelRepo; let csv;
before(async () => {
  ({ tables } = await installMemoryDb());
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  csv = await import('../shared/data/csvImport.js');
});
beforeEach(async () => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
  await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true });
});

const dog = (status, dob = '2021-07-07', extra = {}) => ({ call_name: 'Juno', registered_name: 'Thornfield Juno', sex: 'female', date_of_birth: dob,
  breed: 'Labrador Retriever', ownership_type: 'owned', status, ...extra });

test('K2-2: the same dog on three rows is one dog: the first is created, the others wait for review naming it', async () => {
  const plan = await csv.buildPlan('dog', [dog('puppy'), dog('active_breeding'), dog('pet_home')]);
  assert.deepEqual(plan.rows.map((r) => [r.status, r.decision]), [['create', 'create'], ['review', 'skip'], ['review', 'skip']]);
  assert.match(plan.rows[1].reasons.at(-1), /The same dog as row 2: only that row is imported/);
  const res = await csv.commitPlan('dog', plan.rows);
  assert.equal(res.created, 1);
  assert.equal([...tables.dogs.rows.values()].length, 1);
});

test('K2-2: two rows with one registration number are one dog; different dogs stay apart', async () => {
  const plan = await csv.buildPlan('dog', [
    dog('puppy', '2021-07-07', { registration_number: 'SR 123456/01' }),
    dog('puppy', '2021-07-08', { call_name: 'June', registered_name: 'Thornfield June', registration_number: 'sr12345601' }),
    dog('puppy', '2021-07-07', { call_name: 'Blue', registered_name: 'Thornfield Blue 1' }),
    dog('puppy', '2021-07-07', { call_name: 'Ozzy', registered_name: 'Thornfield Blue 2' })
  ]);
  assert.deepEqual(plan.rows.map((r) => r.status), ['create', 'review', 'create', 'create']);
});

test('K2-3: the file\'s own dates decide day-first or month-first; either-way dates are asked about', async () => {
  assert.deepEqual(csv.detectDateOrder([{ dob: '25/01/2021' }, { dob: '05/01/2021' }]), { order: 'dmy', ambiguous: 1 });
  assert.deepEqual(csv.detectDateOrder([{ dob: '1/25/2021' }]), { order: 'mdy', ambiguous: 0 });
  assert.deepEqual(csv.detectDateOrder([{ dob: '25/01/2021' }, { dob: '1/25/2021' }]).order, 'mixed');
  assert.deepEqual(csv.detectDateOrder([{ dob: '7/7/2021' }]), { order: null, ambiguous: 0 }, 'the same either way');

  const dayFirst = await csv.buildPlan('dog', [dog('puppy', '25/01/2021', { call_name: 'A', registered_name: 'A' }), dog('puppy', '05/01/2021')]);
  assert.deepEqual(dayFirst.rows.map((r) => r.record.date_of_birth), ['2021-01-25', '2021-01-05'], 'a UK file reads 05/01 as 5 January');
  assert.equal(dayFirst.dates.ask, false);

  const unsure = await csv.buildPlan('dog', [dog('puppy', '05/01/2021')]);
  assert.deepEqual([unsure.rows[0].record.date_of_birth, unsure.dates.ask, unsure.dates.order], ['2021-05-01', true, 'mdy'], 'month first until she says');
  const told = await csv.buildPlan('dog', [dog('puppy', '05/01/2021')], { dateOrder: 'dmy' });
  assert.equal(told.rows[0].record.date_of_birth, '2021-01-05');

  const mixed = await csv.buildPlan('dog', [dog('puppy', '25/01/2021', { call_name: 'A', registered_name: 'A' }), dog('puppy', '1/25/2021', { call_name: 'B', registered_name: 'B' }), dog('puppy', '05/01/2021')]);
  assert.deepEqual(mixed.rows.map((r) => r.record.date_of_birth ?? null), ['2021-01-25', '2021-01-25', null], 'both ways in one file: the either-way date is left for review');
  assert.match(mixed.rows[2].reasons.join(' '), /date_of_birth/);
});
