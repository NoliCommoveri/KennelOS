// photoRepo.js — a pet's photos, each backed by one stored `files` row. Family
// layer. Like documents, a photo OWNS its file and cleans it up on hard delete.
import { db } from './db.js';
import { makeRepo } from './repoBase.js';
import { PHOTO_REFERENCES } from './referenceRegistry.js';
import { fileRepo } from './fileRepo.js';

const base = makeRepo('photos', PHOTO_REFERENCES);

function validatePhoto(candidate) {
  if (candidate.pet_id == null || candidate.pet_id === '') {
    throw new Error('Photo: "pet_id" is required.');
  }
  if (!candidate.file_id) {
    throw new Error('Photo: "file_id" is required.');
  }
}

export const photoRepo = {
  ...base,

  create(data) {
    validatePhoto(data);
    return base.create(data);
  },

  // A pet's gallery, newest first.
  async getByPet(petId, { includeArchived = false } = {}) {
    const rows = await db.photos.where('pet_id').equals(petId).toArray();
    const filtered = includeArchived ? rows : rows.filter((p) => !p.is_archived);
    return filtered.sort((a, b) => (b.taken_date || '').localeCompare(a.taken_date || ''));
  },

  async hardDelete(id) {
    const existing = await db.photos.get(id);
    await base.hardDelete(id); // leaf; never blocked
    if (existing && existing.file_id) await fileRepo.hardDelete(existing.file_id);
  }
};

export { ReferenceBlockedError } from './repoBase.js';
