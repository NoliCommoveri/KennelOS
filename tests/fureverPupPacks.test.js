// fureverPupPacks.test.js — per-pup Furever packs (review K14-3, Review Remainder
// batch B, R6): a litter publish puts each pup's own documents in that pup's own
// folder and manifest, the litter's manifest keeps only the sire's and dam's, and a
// family's seed names only its own pup's manifest. A republish over a pack from
// before moves the pups' documents and trashes the old shared copies. Furever reads
// both shapes. Google Drive is a fake in memory.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, publishPack, packagePointer;
before(async () => {
  ({ tables } = await installMemoryDb());
  ({ publishPack } = await import('../shared/data/fureverContentPack.js'));
  ({ packagePointer } = await import('../shared/data/fureverSeedExport.js'));
});

// --- A fake Drive: files by id, with parents, trashed flags and public shares ---
let drive;
function fakeDrive() {
  drive = { files: new Map(), shared: new Set(), n: 0 };
  globalThis.google = { accounts: { oauth2: { initTokenClient: () => ({
    callback: null,
    requestAccessToken() { this.callback({ access_token: 'T', expires_in: 3600 }); }
  }) } } };
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const metaOf = async (blob) => JSON.parse((await blob.text()).split('\r\n\r\n')[1].split('\r\n--')[0]);
  const contentOf = async (blob) => (await blob.text()).split('\r\n\r\n')[2].split('\r\n--')[0];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || 'GET';
    const path = u.pathname;
    if (path.endsWith('/permissions')) { drive.shared.add(path.split('/files/')[1].split('/')[0]); return json({}); }
    if (method === 'GET' && path.endsWith('/files')) {
      const q = u.searchParams.get('q');
      const parent = q.match(/'([^']+)' in parents/)[1];
      const name = q.match(/name='((?:[^'\\]|\\.)*)'/)[1].replace(/\\'/g, "'");
      return json({ files: [...drive.files.values()].filter((f) => f.folder && !f.trashed && f.name === name && f.parent === parent) });
    }
    if (method === 'POST' && path.endsWith('/files') && !path.includes('/upload/')) {
      const meta = JSON.parse(opts.body);
      const id = `FOLDER${++drive.n}`;
      drive.files.set(id, { id, name: meta.name, parent: (meta.parents || ['root'])[0], folder: true });
      return json({ id });
    }
    if (method === 'PATCH' && !path.includes('/upload/')) {
      drive.files.get(path.split('/files/')[1]).trashed = true;
      return json({});
    }
    // An upload: POST creates, PATCH /upload/.../files/<id> overwrites.
    const meta = await metaOf(opts.body);
    const content = await contentOf(opts.body);
    if (method === 'PATCH') {
      const id = decodeURIComponent(path.split('/files/')[1]);
      Object.assign(drive.files.get(id), { name: meta.name, content });
      return json({ id });
    }
    const id = `FILE${++drive.n}`;
    drive.files.set(id, { id, name: meta.name, parent: meta.parents[0], content });
    return json({ id });
  };
}
const manifestIn = (fileId) => JSON.parse(drive.files.get(fileId).content);
const live = (id) => drive.files.has(id) && !drive.files.get(id).trashed;

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
  fakeDrive();
});

// A two-pup litter: sire S, dam D, pups A and B, one document each.
function litterDocs() {
  const docs = [];
  for (const dog of ['S', 'D', 'A', 'B']) {
    tables.files.rows.set(`file-${dog}`, { id: `file-${dog}`, blob: new Blob([`${dog} bytes`], { type: 'application/pdf' }), mime: 'application/pdf' });
    docs.push({ id: `doc-${dog}`, dog_id: dog, file_id: `file-${dog}`, title: `${dog} health`, doc_type: 'health_test' });
  }
  return docs;
}
const litterPublish = (pointer, documents, removedKeys = []) => publishPack({
  scope: 'litter', kennelName: 'Thornfield', litterNickname: 'Spring', pointer, documents, removedKeys,
  sireId: 'S', damId: 'D', pupNames: { A: 'Ash', B: 'Birch' }
});
// Every Drive id pup A's documents or pack sit under.
const pupAIds = (pointer) => [pointer.pupManifests.A.manifestFileId, pointer.pupManifests.A.folderId,
  ...pointer.pupManifests && manifestIn(pointer.pupManifests.A.manifestFileId).files.map((f) => f.fileId)];

test('the litter manifest holds only the sire\'s and dam\'s documents; each pup has its own', async () => {
  const pointer = await litterPublish({}, litterDocs());
  assert.deepEqual(manifestIn(pointer.manifestFileId).files.map((f) => f.dogId).sort(), ['D', 'S']);
  for (const pup of ['A', 'B']) {
    const m = manifestIn(pointer.pupManifests[pup].manifestFileId);
    assert.equal(m.scope, 'pup');
    assert.equal(m.version, pointer.version);
    assert.deepEqual(m.files.map((f) => f.dogId), [pup]);
  }
});

test('family B\'s seed and the litter manifest together hold no id of pup A\'s', async () => {
  const pointer = await litterPublish({}, litterDocs());
  const seedB = packagePointer(pointer, 'litter', 'B');
  assert.equal(seedB.pupManifestFileId, pointer.pupManifests.B.manifestFileId);
  const visible = JSON.stringify([seedB, manifestIn(pointer.manifestFileId)]);
  for (const id of pupAIds(pointer)) assert.ok(!visible.includes(id), `${id} is visible to family B`);
});

test('a pup\'s folder is not inside the shared litter folder', async () => {
  const pointer = await litterPublish({}, litterDocs());
  const litterFolder = drive.files.get(pointer.folderId);
  const pupFolder = drive.files.get(pointer.pupManifests.A.folderId);
  assert.equal(pupFolder.parent, litterFolder.parent, 'both under the KennelOS Furever root');
  assert.ok(!drive.shared.has(litterFolder.parent), 'the root is never shared');
  assert.ok(drive.shared.has(pupFolder.id));
  assert.equal(pupFolder.name, 'Litter — Spring — Ash');
});

test('a republish over an old shared pack moves the pups\' documents and trashes the old copies', async () => {
  // The old layout: every document in the litter folder, keyed without a folder.
  const docs = litterDocs();
  const old = await litterPublish({}, docs.filter((d) => ['S', 'D'].includes(d.dog_id)));
  const oldA = `FILE${++drive.n}`;
  drive.files.set(oldA, { id: oldA, name: 'A health', parent: old.folderId, content: 'A bytes' });
  const legacy = { ...old, pupManifests: undefined,
    selection: { ...old.selection, documentIds: docs.map((d) => d.id), driveFileIds: { ...old.selection.driveFileIds, 'doc:doc-A': { fileId: oldA } } } };
  delete legacy.pupManifests;

  const pointer = await litterPublish(legacy, docs);
  assert.equal(pointer.moved, 1);
  assert.ok(!live(oldA), 'the old shared copy is trashed');
  const newA = manifestIn(pointer.pupManifests.A.manifestFileId).files[0].fileId;
  assert.notEqual(newA, oldA);
  assert.equal(drive.files.get(newA).parent, pointer.pupManifests.A.folderId);
  // The sire's and dam's stay where they were, reused.
  assert.deepEqual(manifestIn(pointer.manifestFileId).files.map((f) => f.fileId).sort(),
    manifestIn(old.manifestFileId).files.map((f) => f.fileId).sort());
});

test('a pup with nothing ticked any more gets an empty manifest at the new version', async () => {
  const docs = litterDocs();
  const first = await litterPublish({}, docs);
  const second = await litterPublish(first, docs.filter((d) => d.dog_id !== 'A'), ['doc:doc-A']);
  const m = manifestIn(second.pupManifests.A.manifestFileId);
  assert.deepEqual([m.version, m.files.length], [2, 0]);
  assert.equal(second.pupManifests.A.manifestFileId, first.pupManifests.A.manifestFileId, 'the same manifest file, rewritten');
});

test('the kennel-wide pack is unchanged: no pup manifests', async () => {
  const pointer = await publishPack({ scope: 'kennel', kennelName: 'Thornfield', uploads: [{ id: 'u1', title: 'Care', blob: new Blob(['x']) }] });
  assert.equal(pointer.pupManifests, undefined);
  assert.equal(manifestIn(pointer.manifestFileId).files[0].dogId, undefined);
});
