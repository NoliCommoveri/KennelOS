// petRepo.js — the top-level entity. Every other family record hangs off a pet,
// and the whole app is scoped to one active pet at a time (settings.getActivePetId).
//
// Two kinds of pet, same shape (brief §Multi-pet):
//   - SEEDED  — arrived in a breeder's link, carries `pup_id`, its seed fields
//     refresh on a resend. Never edited destructively by the seed after the
//     family takes over: only the `seed` side is replaced.
//   - SELF    — a future dog, a rescue, the cat. Family-created; no `pup_id`; a
//     resend can never touch it.
import { db } from './db.js';
import { makeRepo, nowIso } from './repoBase.js';
import { PET_REFERENCES } from './referenceRegistry.js';

const base = makeRepo('pets', PET_REFERENCES);

const REQUIRED_FIELDS = ['name', 'species', 'source'];

function validatePet(candidate) {
  for (const f of REQUIRED_FIELDS) {
    if (candidate[f] == null || candidate[f] === '') {
      throw new Error(`Pet: "${f}" is required.`);
    }
  }
  if (candidate.source === 'seeded' && !candidate.pup_id) {
    throw new Error('Pet: a seeded pet must carry a pup_id.');
  }
}

export const petRepo = {
  ...base,

  create(data) {
    validatePet({ source: 'self', ...data });
    return base.create({ source: 'self', ...data });
  },

  async update(id, changes) {
    const existing = await db.pets.get(id);
    if (!existing) throw new Error(`pets: no record with id ${id}`);
    validatePet({ ...existing, ...changes });
    return base.update(id, changes);
  },

  // Pets the family added themselves vs. pets that came from a breeder.
  async getBySource(source, { includeArchived = false } = {}) {
    const all = await base.getAll({ includeArchived });
    return all.filter((p) => p.source === source);
  },

  // Find a seeded pet by its breeder-assigned pup id — the key a resend upserts on.
  async getByPupId(pupId) {
    if (!pupId) return null;
    return db.pets.where('pup_id').equals(pupId).first();
  },

  // --- Seed upsert (the refresh contract, schema doc §seed layer) -----------
  // Apply an incoming breeder packet's SEED side. Keyed on pup_id: if the pet
  // already exists, ONLY its seed-owned fields are refreshed and the family's
  // records (care_events, plans, contacts, documents, photos) are untouched; if
  // it's new, a seeded pet is created. Returns { pet, created }.
  //
  // `seed` is the packet's per-pup seed object; `breederId` links the (separately
  // upserted) breeder row. Seed-owned identity fields are derived from the seed
  // here — those DO refresh on resend; everything the family owns lives in other
  // tables and is never named here.
  async upsertSeededPet(seed, breederId) {
    if (!seed || !seed.pupId) throw new Error('upsertSeededPet: seed.pupId is required.');
    const existing = await petRepo.getByPupId(seed.pupId);
    const seedFields = {
      source: 'seeded',
      pup_id: seed.pupId,
      breeder_id: breederId || null,
      name: seed.name || (existing && existing.name) || 'Puppy',
      species: seed.species || 'dog',
      sex: seed.sex || null,
      breed: seed.breed || null,
      date_of_birth: seed.dob || null,
      photo_url: seed.photoUrl || null,
      content_pack_key: seed.contentPackKey || null,
      // The full seed snapshot rides along unindexed, so "what did the breeder
      // send" (incl. pickupPlan + personal note) stays separable from any family edit.
      seed: { ...seed, receivedAt: nowIso() }
    };
    if (existing) {
      const pet = await base.update(existing.id, seedFields);
      return { pet, created: false };
    }
    const pet = await base.create(seedFields);
    return { pet, created: true };
  }
};

export { ReferenceBlockedError } from './repoBase.js';
