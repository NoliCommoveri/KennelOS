// fileRepo.js — the blob archive backing `documents` and `photos`: the bytes of
// an uploaded PDF or an image. Never queried by anything but id, so only
// `created_at` (backup ordering) is indexed alongside it. A file is owned by
// exactly ONE document or photo and is deleted alongside its owner — so it is NOT
// a referenceRegistry target; the owning repo deletes it explicitly.
import { db } from './db.js';
import { newId, nowIso } from './repoBase.js';

export const fileRepo = {
  getById(id) {
    return db.files.get(id);
  },

  // Store a blob and return the new file row. `blob` is a Blob/File; name and
  // mime are captured for later download/preview.
  async create({ blob, name = '', mime = '' }) {
    const record = {
      id: newId(),
      blob,
      name,
      mime: mime || (blob && blob.type) || '',
      size: (blob && blob.size) || 0,
      created_at: nowIso()
    };
    await db.files.add(record);
    return record;
  },

  // Hard delete — called by the owning document/photo repo as it removes its row.
  async hardDelete(id) {
    await db.files.delete(id);
  }
};
