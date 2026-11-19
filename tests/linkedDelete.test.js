// linkedDelete.test.js — the Delete wizard's data side (data/linkedDelete.js):
// a set of test records that point at each other is found from any one of them,
// the breeder's real records stay out of it, and deleting the set leaves her real
// records only without their links.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db, ld, tables;
const OLD = '2025-01-10T12:00:00.000Z';
const NOW = '2026-11-18T12:00:00.000Z';
const LATER = '2026-11-19T09:00:00.000Z';
const row = (id, created_at, rest = {}) => ({ id, created_at, updated_at: created_at, is_archived: false, ...rest });

before(async () => {
  ({ tables } = await installMemoryDb());
  ({ db } = await import('../shared/data/db.js'));
  ld = await import('../shared/data/linkedDelete.js');
});

// Her kennel: a real dam and sire with a real litter and pup, a real buyer and
// vet. Then the test set: a contact, a litter of the real pair, a pup, a sale of
// the pup to the contact (the vet as referrer), a contract on the sale, an event
// and a document (with its file) on the pup, an expense on the litter.
beforeEach(async () => {
  for (const t of Object.values(tables)) await t.clear();
  await db.kennels.add(row('k1', OLD, { kennel_name: 'Oak Ridge', is_own_kennel: true }));
  await db.dogs.bulkPut([
    row('dam', OLD, { call_name: 'Bella', kennel_id: 'k1' }),
    row('sire', OLD, { call_name: 'Duke', kennel_id: 'k1' }),
    row('realpup', OLD, { call_name: 'Max', dam_id: 'dam', sire_id: 'sire', litter_id: 'reallit' }),
    row('pup', NOW, { call_name: 'Test pup', dam_id: 'dam', sire_id: 'sire', litter_id: 'lit', kennel_id: 'k1' }),
    row('pup2', LATER, { call_name: 'Test pup 2', dam_id: 'dam', sire_id: 'sire', litter_id: 'lit', kennel_id: 'k1' })
  ]);
  await db.litters.bulkPut([
    row('reallit', OLD, { dam_id: 'dam', sire_id: 'sire', kennel_id: 'k1' }),
    row('lit', NOW, { nickname: 'Test litter', dam_id: 'dam', sire_id: 'sire', kennel_id: 'k1' })
  ]);
  await db.contacts.bulkPut([
    row('vet', OLD, { name: 'Dr. Vet' }),
    row('tc', NOW, { name: 'Test Buyer' })
  ]);
  await db.sales.add(row('sale', NOW, { dog_id: 'pup', buyer_contact_id: 'tc', referred_by_contact_id: 'vet', kennel_id: 'k1' }));
  await db.contracts.add(row('con', LATER, { contract_type: 'sale', related_sale_id: 'sale', related_dog_id: 'pup', related_contact_id: 'tc', kennel_id: 'k1' }));
  await db.events.bulkPut([
    row('ev', NOW, { subject_type: 'dog', subject_id: 'pup', event_type: 'weight_check' }),
    row('realev', OLD, { subject_type: 'dog', subject_id: 'dam', event_type: 'vet_visit', related_dog_id: 'pup' })
  ]);
  await db.files.add({ id: 'f1', created_at: NOW });
  await db.documents.add(row('doc', NOW, { dog_id: 'pup', file_id: 'f1', kennel_id: 'k1' }));
  await db.documents.add(row('realdoc', OLD, { dog_id: 'dam', contract_id: 'con', kennel_id: 'k1' }));
  await db.expenses.add(row('exp', NOW, { subject_type: 'litter', subject_id: 'lit', amount: 20 }));
});

const ticked = (g) => g.items.filter((i) => i.ticked).map((i) => `${i.table}:${i.id}`).sort();
const offered = (g) => g.items.filter((i) => !i.ticked).map((i) => `${i.table}:${i.id}:${i.why}`).sort();
const TEST_SET = ['contacts:tc', 'contracts:con', 'dogs:pup', 'dogs:pup2', 'litters:lit', 'sales:sale'];

for (const [table, id] of [['contacts', 'tc'], ['dogs', 'pup'], ['litters', 'lit'], ['sales', 'sale'], ['contracts', 'con']]) {
  test(`from the test ${table}, the whole test set is ticked and nothing real is`, async () => {
    const g = await ld.gatherLinked(table, id);
    assert.equal(g.start.id, id);
    assert.deepEqual(ticked(g), TEST_SET);
    // The real records it touches are listed, unticked, with why.
    for (const o of offered(g)) assert.match(o, /^(dogs:(dam|sire)|contacts:vet):time$/);
    assert.ok(offered(g).includes('dogs:dam:time'));
    assert.equal(g.capped, false);
  });
}

test('the plan: the picked records, their history and files, and what only loses a link', async () => {
  const g = await ld.gatherLinked('contacts', 'tc');
  const picked = g.items.filter((i) => i.ticked);
  const p = await ld.planLinkedDelete(picked);
  assert.deepEqual(p.counts, { contacts: 1, dogs: 2, litters: 1, sales: 1, contracts: 1 });
  assert.deepEqual(p.history, { events: 1, expenses: 1, documents: 1, files: 1 });
  const kept = p.kept.map((k) => `${k.table}:${k.id}`).sort();
  assert.deepEqual(kept, ['documents:realdoc', 'events:realev']);
});

test('deleting: the set is gone, her real records stay and lose only their links', async () => {
  const g = await ld.gatherLinked('sales', 'sale');
  const out = await ld.runLinkedDelete(g.items.filter((i) => i.ticked));
  assert.equal(out.removed, 6);
  for (const [t, id] of [['contacts', 'tc'], ['dogs', 'pup'], ['dogs', 'pup2'], ['litters', 'lit'], ['sales', 'sale'], ['contracts', 'con'], ['events', 'ev'], ['documents', 'doc'], ['files', 'f1'], ['expenses', 'exp']]) {
    assert.equal(await db.table(t).get(id), undefined, `${t}:${id} deleted`);
  }
  for (const [t, id] of [['dogs', 'dam'], ['dogs', 'sire'], ['dogs', 'realpup'], ['litters', 'reallit'], ['contacts', 'vet'], ['kennels', 'k1']]) {
    assert.ok(await db.table(t).get(id), `${t}:${id} kept`);
  }
  assert.equal((await db.events.get('realev')).related_dog_id, null, 'the real event no longer names the test pup');
  assert.equal((await db.documents.get('realdoc')).contract_id, null, 'the real document no longer names the test contract');
});

test('unticking a record keeps it, and its link to the deleted ones is cleared', async () => {
  const g = await ld.gatherLinked('contacts', 'tc');
  const picked = g.items.filter((i) => i.ticked && i.id !== 'pup');
  await ld.runLinkedDelete(picked);
  const pup = await db.dogs.get('pup');
  assert.ok(pup, 'the unticked pup stays');
  assert.equal(pup.litter_id, null, 'its deleted litter is cleared');
  assert.ok(await db.events.get('ev'), 'and its own history stays with it');
});

test('a real dam is never pulled in, even when her only other users are in the set', async () => {
  // A dam made long ago whose only litter and pup are the test ones.
  await db.dogs.add(row('olddam', OLD, { call_name: 'Old Rose' }));
  await db.litters.update('lit', { dam_id: 'olddam' });
  const g = await ld.gatherLinked('litters', 'lit');
  assert.ok(!ticked(g).includes('dogs:olddam'));
  assert.ok(offered(g).includes('dogs:olddam:time'));
});

test('only offered kinds can start it', async () => {
  await assert.rejects(ld.gatherLinked('kennels', 'k1'), /doesn't start/);
});
