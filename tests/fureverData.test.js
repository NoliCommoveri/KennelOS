// fureverData.test.js — Furever's data layer against review K14 (step 10b): a
// resend keeps the family's edits (K14-1), the content-pack cache is per pet
// (K14-4), a file that didn't come down is retried (K14-14), Merge restore matches
// by natural key (K14-7) and an older backup's rows are migrated (K14-18).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, petRepo, seedIdentity, fetchMod, documentRepo, contentPackRepo, ie;

before(async () => {
  ({ tables } = await installMemoryDb({ dbUrl: '../../furever/data/db.js' }));
  ({ petRepo, seedIdentity } = await import('../furever/data/petRepo.js'));
  fetchMod = await import('../furever/data/contentPackFetch.js');
  ({ documentRepo } = await import('../furever/data/documentRepo.js'));
  ({ contentPackRepo } = await import('../furever/data/contentPackRepo.js'));
  ie = await import('../furever/data/importExport.js');
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
});

// --- K14-1 ---------------------------------------------------------------------

const seed = (over = {}) => ({ pupId: 'pup1', name: 'Blue Collar Boy', sex: 'male', breed: 'Labradoodle', dob: '2026-08-01', photoUrl: 'https://x/blue.jpg', ...over });

test('a resend keeps the name, photo and breed the family changed', async () => {
  const { pet } = await petRepo.upsertSeededPet(seed(), 'b1');
  await petRepo.update(pet.id, { name: 'Max', photo_url: 'data:image/jpeg;base64,AAA', breed: 'Goldendoodle' });
  const { pet: after, created } = await petRepo.upsertSeededPet(seed({ photoUrl: null, breed: null }), 'b1');
  assert.equal(created, false);
  assert.deepEqual([after.name, after.photo_url, after.breed], ['Max', 'data:image/jpeg;base64,AAA', 'Goldendoodle']);
  assert.equal(after.seed.name, 'Blue Collar Boy', 'what the breeder sent is still kept');
});

test('a resend still corrects what the family left as the breeder sent it', async () => {
  await petRepo.upsertSeededPet(seed(), 'b1');
  const { pet } = await petRepo.upsertSeededPet(seed({ dob: '2026-08-03', name: 'Blue' }), 'b1');
  assert.equal(pet.date_of_birth, '2026-08-03');
  assert.equal(pet.name, 'Blue');
  assert.equal(pet.photo_url, 'https://x/blue.jpg', 'a value the packet leaves out is never blanked');
});

test('seedIdentity: the first packet without a name sets Puppy, and a later name replaces it', () => {
  assert.equal(seedIdentity(null, 'name', 'name', '', 'Puppy'), 'Puppy');
  const pet = { name: 'Puppy', seed: {} };
  assert.equal(seedIdentity(pet, 'name', 'name', 'Blue', 'Puppy'), 'Blue');
});

// --- K14-4, K14-14 ---------------------------------------------------------------

const manifest = (version, files) => ({ packKey: 'PK', version, scope: 'kennel', kennelName: 'Thornfield', files });
const pointer = { packKey: 'PK', manifestFileId: 'MAN' };
function stubDrive(m, failing = new Set()) {
  globalThis.fetch = async (url) => {
    const id = decodeURIComponent(String(url).split('/files/')[1].split('?')[0]);
    if (id === 'MAN') return { ok: true, json: async () => m };
    if (failing.has(id)) return { ok: false, status: 503 };
    return { ok: true, blob: async () => new Blob([id], { type: 'application/pdf' }) };
  };
}
const titles = async (petId) => (await documentRepo.getBreederDocsForPack(petId, 'PK')).map((d) => d.title).sort();

test('a second pup from the same breeder gets the kennel pack too', async () => {
  stubDrive(manifest(3, [{ fileId: 'F1', title: 'Care guide' }]));
  await fetchMod.fetchOnePackage('A', pointer, 'pupA');
  await fetchMod.fetchOnePackage('B', pointer, 'pupB');
  assert.deepEqual(await titles('A'), ['Care guide']);
  assert.deepEqual(await titles('B'), ['Care guide']);
});

test('a file that failed keeps the old copy and is fetched on the next open', async () => {
  stubDrive(manifest(1, [{ fileId: 'F1', title: 'Care guide' }, { fileId: 'F2', title: 'Guarantee' }]));
  await fetchMod.fetchOnePackage('A', pointer, 'pupA');
  stubDrive(manifest(2, [{ fileId: 'F1', title: 'Care guide' }, { fileId: 'F2', title: 'Guarantee' }]), new Set(['F2']));
  await fetchMod.fetchOnePackage('A', pointer, 'pupA');
  assert.deepEqual(await titles('A'), ['Care guide', 'Guarantee'], 'the guarantee from v1 stays');
  assert.equal(contentPackRepo.petState(await contentPackRepo.getByKey('PK'), 'A').complete, false);

  tables.pets.rows.set('A', { id: 'A', pup_id: 'pupA', is_archived: false, seed: { contentPackages: [pointer] } });
  stubDrive(manifest(2, [{ fileId: 'F1', title: 'Care guide' }, { fileId: 'F2', title: 'Guarantee v2' }]));
  await fetchMod.retryIncompletePacks();
  assert.deepEqual(await titles('A'), ['Care guide', 'Guarantee v2']);
  assert.deepEqual(contentPackRepo.petState(await contentPackRepo.getByKey('PK'), 'A'), { version: 2, complete: true });
});

test('a whole fetch at the same version is not fetched again', async () => {
  let calls = 0;
  stubDrive(manifest(1, [{ fileId: 'F1', title: 'Care guide' }]));
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { if (!String(url).includes('MAN')) calls++; return real(url); };
  await fetchMod.fetchOnePackage('A', pointer, 'pupA');
  await fetchMod.fetchOnePackage('A', pointer, 'pupA');
  assert.equal(calls, 1);
});

// --- K14-7, K14-18 ----------------------------------------------------------------

const T1 = '2026-10-01T00:00:00.000Z';
const T2 = '2026-10-02T00:00:00.000Z';

test('Merge from the other phone matches the pup, breeder and pack instead of doubling them', async () => {
  tables.breeders.rows.set('b-mine', { id: 'b-mine', breeder_key: 'BK', kennel_name: 'Thornfield', updated_at: T1 });
  tables.pets.rows.set('p-mine', { id: 'p-mine', pup_id: 'pup1', name: 'Max', breeder_id: 'b-mine', updated_at: T1, is_archived: false });
  tables.content_packs.rows.set('cp-mine', { id: 'cp-mine', pack_key: 'PK', version: 2, pets: { 'p-mine': { version: 2, complete: true } } });
  const file = {
    app: 'furever', schema_version: 2, format_version: 1,
    collections: {
      breeders: [{ id: 'b-theirs', breeder_key: 'BK', kennel_name: 'Thornfield', updated_at: T1 }],
      pets: [{ id: 'p-theirs', pup_id: 'pup1', name: 'Maxie', breeder_id: 'b-theirs', updated_at: T2, is_archived: false }],
      content_packs: [{ id: 'cp-theirs', pack_key: 'PK', version: 3, pets: { 'p-theirs': { version: 3, complete: true } } }],
      care_events: [{ id: 'e1', pet_id: 'p-theirs', event_type: 'vet_visit', event_date: '2026-10-02', is_archived: false }],
      contacts: [{ id: 'c1', pet_ids: ['p-theirs'], contact_type: 'vet', is_archived: false }]
    }
  };
  await ie.restoreBackup(file, 'merge');
  assert.equal(tables.pets.rows.size, 1);
  const pet = tables.pets.rows.get('p-mine');
  assert.equal(pet.name, 'Maxie', 'the newer copy wins');
  assert.equal(pet.breeder_id, 'b-mine');
  assert.equal(tables.breeders.rows.size, 1);
  assert.equal(tables.content_packs.rows.size, 1);
  assert.equal(tables.content_packs.rows.get('cp-mine').version, 3);
  assert.equal(tables.care_events.rows.get('e1').pet_id, 'p-mine');
  assert.deepEqual(tables.contacts.rows.get('c1').pet_ids, ['p-mine']);
});

test('an older backup’s contacts come back attached to their pets', async () => {
  const file = {
    app: 'furever', schema_version: 1,
    collections: {
      pets: [{ id: 'p1', name: 'Max', is_archived: false }, { id: 'p2', name: 'Bella', is_archived: false }],
      contacts: [{ id: 'vet', pet_id: 'p1', contact_type: 'vet' }, { id: 'sitter', pet_id: null, contact_type: 'other' }]
    }
  };
  await ie.restoreBackup(file, 'replace');
  assert.deepEqual(tables.contacts.rows.get('vet').pet_ids, ['p1']);
  assert.equal('pet_id' in tables.contacts.rows.get('vet'), false);
  assert.deepEqual(tables.contacts.rows.get('sitter').pet_ids, ['p1', 'p2']);
});

test('a restore that fails says so in a sentence', async () => {
  const real = tables.pets.bulkPut;
  tables.pets.bulkPut = async () => { throw new Error('ConstraintError'); };
  try {
    await assert.rejects(ie.restoreBackup({ app: 'furever', collections: { pets: [{ id: 'p1' }] } }, 'merge'), /couldn’t be merged, so nothing was changed/);
  } finally {
    tables.pets.bulkPut = real;
  }
});
