// A file / Dropbox Merge (importExport.restoreBackup 'merge', planFileMerge): adds
// what's new, updates with the file's newer copies, and leaves a record this device
// changed after the file's copy as it is when she chooses to keep her edits.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, ie;

before(async () => {
  ({ tables } = await installMemoryDb());
  ie = await import('../shared/data/importExport.js');
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
});

const OLD = '2026-01-01T00:00:00.000Z';
const NEW = '2026-02-01T00:00:00.000Z';
const kennel = (id, name, updated_at, extra = {}) => ({ id, kennel_name: name, is_own_kennel: false, is_archived: false, created_at: OLD, updated_at, ...extra });
const backup = (kennels) => ({ schema_version: 1, collections: { kennels } });

async function seed(rows) {
  for (const r of rows) tables.kennels.rows.set(r.id, { ...r });
}
const nameOf = (id) => tables.kennels.rows.get(id)?.kennel_name;

const file = backup([
  kennel('new', 'Only in the file', OLD),
  kennel('stale', 'File is newer', NEW),
  kennel('edited', 'File is older', OLD)
]);

test('planFileMerge counts adds, updates and records changed here since the file', async () => {
  await seed([kennel('stale', 'Here is older', OLD), kennel('edited', 'Edited here', NEW)]);
  const { added, updated, newerHere, matched, asks } = await ie.planFileMerge(file);
  assert.deepEqual({ added, updated, newerHere, matched, asks }, { added: 1, updated: 1, newerHere: 1, matched: 0, asks: [] });
});

test('keepNewer leaves her newer edit and takes everything else', async () => {
  await seed([kennel('stale', 'Here is older', OLD), kennel('edited', 'Edited here', NEW), kennel('mine', 'Not in the file', OLD)]);
  const result = await ie.restoreBackup(file, 'merge', { keepNewer: true });
  assert.equal(nameOf('new'), 'Only in the file');
  assert.equal(nameOf('stale'), 'File is newer');
  assert.equal(nameOf('edited'), 'Edited here');
  assert.equal(nameOf('mine'), 'Not in the file');
  assert.deepEqual(result, [{ name: 'kennels', count: 2 }]);
});

test('without keepNewer the file\'s copy wins, as before', async () => {
  await seed([kennel('edited', 'Edited here', NEW)]);
  await ie.restoreBackup(file, 'merge');
  assert.equal(nameOf('edited'), 'File is older');
});

test('a row with no updated_at on either side takes the file\'s copy', async () => {
  await seed([kennel('edited', 'Edited here', undefined)]);
  assert.equal((await ie.planFileMerge(file)).newerHere, 0);
  await ie.restoreBackup(file, 'merge', { keepNewer: true });
  assert.equal(nameOf('edited'), 'File is older');
});

// --- Records each device entered on its own (two ids for one dog) ----------------

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [K_HERE, K_FILE, D_HERE, D_FILE, E_HERE, E_FILE, PUP_HERE, PUP_FILE, L_HERE, L_FILE] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(U);
const row = (id, extra) => ({ id, is_archived: false, created_at: OLD, updated_at: OLD, ...extra });
const ownKennel = (id, extra = {}) => row(id, { kennel_name: 'Thornfield Kennels', is_own_kennel: true, ...extra });
const dog = (id, extra = {}) => row(id, { call_name: 'Zoey', sex: 'female', breed: 'Golden Retriever', ownership_type: 'owned', status: 'active_breeding', ...extra });

function seedAll(collections) {
  for (const [name, rows] of Object.entries(collections)) for (const r of rows) tables[name].rows.set(r.id, structuredClone(r));
}
const all = (name) => [...tables[name].rows.values()];

test('the same kennel and dog entered on each device become one, under the backup\'s ids, everywhere', async () => {
  seedAll({
    kennels: [ownKennel(K_HERE)],
    dogs: [dog(D_HERE, { kennel_id: K_HERE, registered_name: 'Thornfield Zoey Mae', color_markings: 'red', updated_at: NEW })],
    events: [row(E_HERE, { subject_type: 'dog', subject_id: D_HERE, event_type: 'vaccination', event_date: '2026-03-01', title: 'DHPP', details: { vaccine: 'DHPP' } })],
    device_secrets: [{ id: `jotform:${K_HERE}`, account_id: K_HERE }]
  });
  localStorage.setItem('kennelOS.myKennelId', K_HERE);
  localStorage.setItem('kennelOS.nudgeDismissals', JSON.stringify({ [`promote:${D_HERE}`]: OLD }));
  const fileDoc = { schema_version: 1, collections: {
    kennels: [ownKennel(K_FILE, { location: 'Ohio' })],
    dogs: [dog(D_FILE, { kennel_id: K_FILE, registered_name: 'GCH CH Thornfield Zoey-Mae', microchip_id: '985 112', color_markings: 'gold' })],
    events: [row(E_FILE, { subject_type: 'dog', subject_id: D_FILE, event_type: 'vaccination', event_date: '2026-03-01', title: 'DHPP shot', details: { vaccine: 'DHPP', lot_number: 'A1' } })]
  } };

  const plan = await ie.planFileMerge(fileDoc);
  assert.equal(plan.matched, 3);
  assert.deepEqual(plan.asks, []);
  await ie.restoreBackup(fileDoc, 'merge');

  assert.deepEqual(all('kennels').map((k) => k.id), [K_FILE]);
  assert.equal(all('kennels')[0].location, 'Ohio');
  const [z] = all('dogs');
  assert.equal(all('dogs').length, 1);
  assert.equal(z.id, D_FILE);
  assert.equal(z.kennel_id, K_FILE);
  assert.equal(z.microchip_id, '985 112', 'a blank fills from the other copy');
  assert.equal(z.color_markings, 'red', 'the newer copy wins a clash');
  assert.equal(z.registered_name, 'Thornfield Zoey Mae', 'a name clash with no choice: the newer copy');
  const [e] = all('events');
  assert.equal(all('events').length, 1);
  assert.equal(e.subject_id, D_FILE);
  assert.equal(e.details.lot_number, 'A1');
  assert.deepEqual(all('device_secrets').map((r) => r.id), [`jotform:${K_FILE}`]);
  assert.equal(localStorage.getItem('kennelOS.myKennelId'), K_FILE);
  assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem('kennelOS.nudgeDismissals'))), [`promote:${D_FILE}`]);
});

test('with cloud backup on, this device keeps its ids and the backup\'s copy takes them', async () => {
  localStorage.setItem('kennelOS.cloudBackupState', JSON.stringify({ enabled: true }));
  seedAll({ kennels: [ownKennel(K_HERE)], dogs: [dog(D_HERE, { kennel_id: K_HERE, registration_number: 'SR12345601' })] });
  await ie.restoreBackup({ schema_version: 1, collections: {
    kennels: [ownKennel(K_FILE)], dogs: [dog(D_FILE, { kennel_id: K_FILE, registration_number: 'sr 123456/01', date_of_birth: '2024-01-02' })]
  } }, 'merge');
  assert.deepEqual(all('kennels').map((k) => k.id), [K_HERE]);
  assert.deepEqual(all('dogs').map((d) => [d.id, d.kennel_id, d.date_of_birth]), [[D_HERE, K_HERE, '2024-01-02']]);
});

test('a name or parent clash follows her choice', async () => {
  seedAll({ dogs: [dog(D_HERE, { registered_name: 'Thornfield Zoey', call_name: 'Zoey', updated_at: NEW })] });
  const fileDoc = { schema_version: 1, collections: { dogs: [dog(D_FILE, { registered_name: 'Thornfield Zoey', call_name: 'Zoe' })] } };
  const plan = await ie.planFileMerge(fileDoc);
  assert.deepEqual(plan.clashes.map((c) => [c.label, c.local, c.file]), [['Call name', 'Zoey', 'Zoe']]);
  await ie.restoreBackup(fileDoc, 'merge', { clashChoices: { [plan.clashes[0].key]: 'file' } });
  assert.equal(all('dogs')[0].call_name, 'Zoe');
});

test('a pup pairs once its litter does, and a dog she says isn\'t the same stays two', async () => {
  seedAll({
    dogs: [dog(D_HERE, { call_name: 'Bella' }), dog(PUP_HERE, { call_name: 'Pink', status: 'puppy', litter_id: L_HERE })],
    litters: [row(L_HERE, { dam_id: D_HERE, sire_id: null, status: 'whelped', whelp_date: '2026-05-01' })]
  });
  const fileDoc = { schema_version: 1, collections: {
    dogs: [dog(D_FILE, { call_name: 'Bella' }), dog(PUP_FILE, { call_name: 'Pink', status: 'puppy', litter_id: L_FILE })],
    litters: [row(L_FILE, { dam_id: D_FILE, sire_id: null, status: 'whelped', whelp_date: '2026-05-01' })]
  } };
  // Bella matches only by call name: a question. Nothing hanging off her pairs yet.
  let plan = await ie.planFileMerge(fileDoc);
  assert.deepEqual(plan.asks.map((q) => q.key), [`dogs:${D_FILE}`]);
  assert.equal(plan.matched, 0);
  // Yes: her litter, and then the pup, pair too.
  plan = await ie.planFileMerge(fileDoc, { answers: { [`dogs:${D_FILE}`]: D_HERE } });
  assert.equal(plan.matched, 3);
  assert.deepEqual(plan.asks, []);
  // No: three dogs... two each side, kept apart.
  await ie.restoreBackup(fileDoc, 'merge', { answers: { [`dogs:${D_FILE}`]: 'none' } });
  assert.equal(all('dogs').length, 4);
  assert.equal(all('litters').length, 2);
});

test('a record the backup also has by id is never absorbed into another', async () => {
  seedAll({ dogs: [dog(D_HERE, { registered_name: 'Thornfield Zoey' })] });
  await ie.restoreBackup({ schema_version: 1, collections: {
    dogs: [dog(D_HERE, { registered_name: 'Thornfield Zoey' }), dog(D_FILE, { registered_name: 'Thornfield Zoey' })]
  } }, 'merge');
  assert.deepEqual(all('dogs').map((d) => d.id).sort(), [D_HERE, D_FILE].sort());
});
