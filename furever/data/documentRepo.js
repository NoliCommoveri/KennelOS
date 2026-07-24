// documentRepo.js — the document vault: a filed document (contract, registration,
// microchip, insurance, vet record, other) belonging to exactly one pet and
// pointing at exactly one stored `files` row. Two sources share this one table
// (Content Package Fetch Mechanism §3.3): family uploads (`source:'self'`,
// default) via the Documents page, and breeder-published docs (`source:'breeder'`,
// `pack_key`, `drive_file_id`) landed by `contentPackFetch.js`. `source`/`pack_key`/
// `drive_file_id` are plain, unindexed fields — no schema change. The family never
// edits or removes a breeder row directly; a pack republish blindly replaces them
// (replaceBreederLayer, below).
//
// A document OWNS its file: hardDelete removes the `files` row too. `documents` is
// a leaf (nothing points at it), so its own hard delete is never blocked — but it
// must clean up its file, which the shared base hardDelete doesn't know about, so
// this repo overrides it.
import { db } from './db.js';
import { makeRepo } from './repoBase.js';
import { DOCUMENT_REFERENCES } from './referenceRegistry.js';
import { fileRepo } from './fileRepo.js';

const base = makeRepo('documents', DOCUMENT_REFERENCES);

const REQUIRED_FIELDS = ['pet_id', 'doc_type'];

function validateDocument(candidate) {
  for (const f of REQUIRED_FIELDS) {
    if (candidate[f] == null || candidate[f] === '') {
      throw new Error(`Document: "${f}" is required.`);
    }
  }
}

export const documentRepo = {
  ...base,

  create(data) {
    const withSource = { source: 'self', ...data };
    validateDocument(withSource);
    return base.create(withSource);
  },

  async update(id, changes) {
    const existing = await db.documents.get(id);
    if (!existing) throw new Error(`documents: no record with id ${id}`);
    validateDocument({ ...existing, ...changes });
    return base.update(id, changes);
  },

  // A pet's filed documents, newest first (the active-pet scope's vault).
  async getByPet(petId, { includeArchived = false } = {}) {
    const rows = await db.documents.where('pet_id').equals(petId).toArray();
    const filtered = includeArchived ? rows : rows.filter((d) => !d.is_archived);
    return filtered.sort((a, b) => (b.doc_date || '').localeCompare(a.doc_date || ''));
  },

  // Hard delete the document AND its owned file (the bytes have no other owner).
  async hardDelete(id) {
    const existing = await db.documents.get(id);
    await base.hardDelete(id); // documents is a leaf; never blocked
    if (existing && existing.file_id) await fileRepo.hardDelete(existing.file_id);
  },

  // This pet's breeder-published docs for one pack (in-memory filter on the
  // pet_id index — pack_key/source are plain, unindexed fields).
  async getBreederDocsForPack(petId, packKey) {
    const rows = await db.documents.where('pet_id').equals(petId).toArray();
    return rows.filter((d) => d.source === 'breeder' && d.pack_key === packKey);
  },

  // Blind wholesale replace of one pack's breeder-sourced docs for a pet
  // (Content Package Fetch Mechanism §3.3/§4.4 step 3-4): every version bump
  // re-fetches every listed file, so the prior rows + blobs for this pack_key are
  // dropped and replaced fresh rather than diffed — same discipline as
  // petRepo.upsertSeededPet's blind seed-side replace. `entries` are
  // `{ file_id, drive_file_id, title, doc_type, doc_date }`, file bytes already
  // landed in `files` by the caller (contentPackFetch.js).
  async replaceBreederLayer(petId, packKey, entries) {
    const existing = await documentRepo.getBreederDocsForPack(petId, packKey);
    for (const doc of existing) await documentRepo.hardDelete(doc.id);
    const created = [];
    for (const entry of entries) {
      created.push(await documentRepo.create({
        pet_id: petId,
        doc_type: entry.doc_type || 'other',
        doc_date: entry.doc_date || '',
        title: entry.title || '',
        file_id: entry.file_id,
        source: 'breeder',
        pack_key: packKey,
        drive_file_id: entry.drive_file_id
      }));
    }
    return created;
  }
};

export { ReferenceBlockedError } from './repoBase.js';
