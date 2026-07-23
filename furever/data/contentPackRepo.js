// contentPackRepo.js — the persisted home for a breeder's CUSTOM care overlay,
// fetched ONCE on first open and then available offline (brief §Content,
// §Delivery). Too big to ride the texted link (~23K vs the ~1.7K text budget —
// brief appendix), so it is fetched from a host (e.g. a public Google Drive file)
// keyed by `pack_key` and cached here.
//
// A seeded pet points at its pack by `content_pack_key` (pets.content_pack_key).
// The overlay's own schedule items carry stable ids used as plan_item_id, exactly
// like universal library items, so schedule.js treats all three sources uniformly.
// A re-fetch UPSERTS by pack_key (unique index), refreshing version/payload.
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

  // Store or refresh a fetched pack. `payload` holds the care-guide prose,
  // schedule overrides/additions, and feeding guidance. Upserts on pack_key.
  async upsert({ pack_key, kennel_name = '', version = 1, payload = null }) {
    if (!pack_key) throw new Error('contentPackRepo.upsert: pack_key is required.');
    const existing = await contentPackRepo.getByKey(pack_key);
    const now = nowIso();
    if (existing) {
      const record = { ...existing, kennel_name, version, payload, fetched_at: now };
      await db.content_packs.put(record);
      return record;
    }
    const record = { id: newId(), pack_key, kennel_name, version, payload, fetched_at: now };
    await db.content_packs.add(record);
    return record;
  },

  async hardDelete(id) {
    await db.content_packs.delete(id);
  }
};
