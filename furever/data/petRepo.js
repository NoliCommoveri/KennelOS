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
    // The pup's identity (name, sex, breed, birthday, photo) is the breeder's on
    // the first packet, then the family's: their Edit form and Add picture write
    // the same fields. So a resend (K14-1) takes the breeder's new value only
    // where the family hasn't changed what the last packet set, and never blanks
    // a value the new packet leaves out. `pet.seed` keeps what the breeder sent.
    const identity = {
      name: seedIdentity(existing, 'name', 'name', seed.name, 'Puppy'),
      sex: seedIdentity(existing, 'sex', 'sex', seed.sex),
      breed: seedIdentity(existing, 'breed', 'breed', seed.breed),
      date_of_birth: seedIdentity(existing, 'date_of_birth', 'dob', seed.dob),
      photo_url: seedIdentity(existing, 'photo_url', 'photoUrl', seed.photoUrl)
    };
    const seedFields = {
      source: 'seeded',
      pup_id: seed.pupId,
      breeder_id: breederId || null,
      ...identity,
      species: (existing && existing.species) || seed.species || 'dog',
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

// One identity field on a resend: the family's value when they changed it from
// what the last packet set, else the new packet's value, else what's there.
// Pure; exported for the tests.
// `fallback` is what a packet without the field set (the name's 'Puppy').
export function seedIdentity(existing, field, seedKey, incoming, fallback = null) {
  const next = incoming || null;
  if (!existing) return next || fallback;
  const current = existing[field] ?? null;
  const lastSent = (existing.seed && existing.seed[seedKey]) || fallback;
  const familyChanged = current !== null && current !== lastSent;
  if (familyChanged) return current;
  return next || current || fallback;
}

export { ReferenceBlockedError } from './repoBase.js';
