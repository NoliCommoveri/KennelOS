// contentPackRepo.js — the MANIFEST CACHE for a breeder's published document
// packs (Content Package Fetch Mechanism §3.3, §4.4). Repurposed from an earlier
// "custom care overlay" design (dropped — documents-only, per the owner's 2026-07-24
// decision): this table no longer holds a `payload`, only "which version of which
// pack have we already fetched" — `contentPackFetch.js` reads it to skip an
// unchanged pack, and the actual bytes live in `files`, referenced from `documents`
// rows tagged `pack_key` + `drive_file_id`.
//
// One row per pack (kennel-wide or one per litter), keyed on `pack_key` (a stable
// UUID minted breeder-side). A re-fetch UPSERTS on pack_key (unique index),
// refreshing version/fetched_at in place.
import { db } from './db.js';
import { newId, nowIso } from './repoBase.js';

export const contentPackRepo = {
  getById(id) {
    return db.content_packs.get(id);
  },

  getByKey(packKey) {
    if (!packKey) return null;
    return db.content_packs.where('pack_key').equals(packKey).first();
  },

  // Record that pack `pack_key` has been fetched at `version`. `scope` is
  // 'kennel' | 'litter' (manifest §3.1), carried through for display only.
  // Upserts on pack_key.
  async upsert({ pack_key, kennel_name = '', scope = '', version = 1 }) {
    if (!pack_key) throw new Error('contentPackRepo.upsert: pack_key is required.');
    const existing = await contentPackRepo.getByKey(pack_key);
    const now = nowIso();
    if (existing) {
      const record = { ...existing, kennel_name, scope, version, fetched_at: now };
      await db.content_packs.put(record);
      return record;
    }
    const record = { id: newId(), pack_key, kennel_name, scope, version, fetched_at: now };
    await db.content_packs.add(record);
    return record;
  },

  async hardDelete(id) {
    await db.content_packs.delete(id);
  }
};
