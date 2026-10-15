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
  assert.deepEqual(await ie.planFileMerge(file), { added: 1, updated: 1, newerHere: 1 });
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
