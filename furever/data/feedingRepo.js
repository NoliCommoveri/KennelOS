// feedingRepo.js — the pet's feeding setup: ONE row per pet (food brand + the
// chosen feeding schedule). The schedule is either an age-bracket preset the
// family accepted (`schedule_choice` = an AGE_BRACKETS value, portions come from
// careLibrary.FEEDING_PLAN) or their own words (`schedule_choice` = 'custom',
// text in `custom_schedule`). The age→portion presets are CONTENT, not stored
// here — only the family's brand + choice persist (schema doc §feeding).
import { db } from './db.js';
import { makeRepo } from './repoBase.js';
import { FEEDING_REFERENCES } from './referenceRegistry.js';

const base = makeRepo('feeding', FEEDING_REFERENCES);

export const feedingRepo = {
  ...base,

  // The pet's feeding row, or null. One-per-pet, so this is the whole record.
  async getForPet(petId) {
    if (!petId) return null;
    const rows = await db.feeding.where('pet_id').equals(petId).toArray();
    return rows.find((r) => !r.is_archived) || null;
  },

  // Upsert the pet's feeding setup (create on first save, update thereafter).
  // `fields` = { brand, schedule_choice, custom_schedule }.
  async saveForPet(petId, fields) {
    if (!petId) throw new Error('feedingRepo.saveForPet: a pet id is required.');
    const existing = await feedingRepo.getForPet(petId);
    if (existing) return base.update(existing.id, fields);
    return base.create({ pet_id: petId, ...fields });
  }
};

export { ReferenceBlockedError } from './repoBase.js';
