// documentRepo.js — the document vault: a filed document (contract, registration,
// microchip, insurance, vet record, other) belonging to exactly one pet and
// pointing at exactly one stored `files` row. Family layer.
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
    validateDocument(data);
    return base.create(data);
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
  }
};

export { ReferenceBlockedError } from './repoBase.js';
