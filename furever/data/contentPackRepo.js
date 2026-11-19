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
  //
  // The documents a pack gates are PER PET (two pups from one breeder share the
  // kennel pack, siblings share the litter pack), so `pets` (unindexed) keeps
  // each pet's own fetch: `{ [petId]: { version, complete, pupManifest? } }` (K14-4;
  // pupManifest: the pup's own manifest id it was fetched with, K14-3).
  // `complete` is false when a file didn't come down (K14-14); the app retries
  // that pet's pack on the next open (contentPackFetch.retryIncompletePacks).
  async upsert({ pack_key, kennel_name = '', scope = '', version = 1, pet_id = null, complete = true, pup_manifest = null }) {
    if (!pack_key) throw new Error('contentPackRepo.upsert: pack_key is required.');
    const existing = await contentPackRepo.getByKey(pack_key);
    const now = nowIso();
    const pets = { ...((existing && existing.pets) || {}) };
    if (pet_id) pets[pet_id] = { version, complete: complete === true, ...(pup_manifest ? { pupManifest: pup_manifest } : {}) };
    if (existing) {
      const record = { ...existing, kennel_name, scope, version: Math.max(version, existing.version || 0), fetched_at: now, pets };
      await db.content_packs.put(record);
      return record;
    }
    const record = { id: newId(), pack_key, kennel_name, scope, version, fetched_at: now, pets };
    await db.content_packs.add(record);
    return record;
  },

  // This pet's fetch of the pack: { version, complete }, or null when it has none
  // recorded (never fetched for it, or a row from before `pets`).
  petState(row, petId) {
    return (row && row.pets && row.pets[petId]) || null;
  },

  async getAll() {
    return db.content_packs.toArray();
  },

  async hardDelete(id) {
    await db.content_packs.delete(id);
  }
};
