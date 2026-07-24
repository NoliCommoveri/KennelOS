// householdRepo.js — the family's own identity, a SINGLETON (one row, fixed id).
// App-wide, not pet-scoped: this is "whose app is this" — the family name shown in
// the banner (e.g. "Carson" → "Carson Family Pets"), with room to grow (address,
// phone) later. The family's vet and other contacts live in `contacts` (family-
// wide rows, pet_id null), NOT here.
//
// A singleton doesn't fit the UUID create/update repo shape, so this is a thin
// get/save pair over the one row (like fileRepo talks to Dexie directly).
import { db } from './db.js';
import { nowIso } from './repoBase.js';

const SINGLETON_ID = 'household';

export const householdRepo = {
  // The household row, or null if the family hasn't set anything up yet.
  async get() {
    return (await db.household.get(SINGLETON_ID)) || null;
  },

  // The family's display name, or '' if unset — the banner's convenience read.
  async getFamilyName() {
    const row = await db.household.get(SINGLETON_ID);
    return (row && row.family_name) || '';
  },

  // Upsert the singleton, merging `changes` over whatever exists.
  async save(changes) {
    const existing = await db.household.get(SINGLETON_ID);
    const now = nowIso();
    const record = existing
      ? { ...existing, ...changes, id: SINGLETON_ID, updated_at: now }
      : { id: SINGLETON_ID, created_at: now, updated_at: now, ...changes };
    await db.household.put(record);
    return record;
  }
};
