// contactRepo.js — the FAMILY's own contacts (their vet, emergency vet, groomer,
// trainer). Family layer: a resend never touches these. The breeder + breeder's
// vet are NOT here — they live in the seed layer (breederRepo).
//
// `pet_id` is nullable: null = a family-wide contact (one vet for every pet); set
// = specific to one pet. The active-pet scope shows a pet's own contacts plus the
// family-wide (null) ones.
import { db } from './db.js';
import { makeRepo } from './repoBase.js';
import { CONTACT_REFERENCES } from './referenceRegistry.js';

const base = makeRepo('contacts', CONTACT_REFERENCES);

const REQUIRED_FIELDS = ['name', 'contact_type'];

function validateContact(candidate) {
  for (const f of REQUIRED_FIELDS) {
    if (candidate[f] == null || candidate[f] === '') {
      throw new Error(`Contact: "${f}" is required.`);
    }
  }
}

export const contactRepo = {
  ...base,

  create(data) {
    validateContact(data);
    return base.create(data);
  },

  async update(id, changes) {
    const existing = await db.contacts.get(id);
    if (!existing) throw new Error(`contacts: no record with id ${id}`);
    validateContact({ ...existing, ...changes });
    return base.update(id, changes);
  },

  // Contacts visible for the active pet: the pet's own plus family-wide (pet_id
  // null). Archived excluded.
  async getForPet(petId, { includeArchived = false } = {}) {
    const all = await base.getAll({ includeArchived });
    return all.filter((c) => c.pet_id === petId || c.pet_id == null);
  }
};

export { ReferenceBlockedError } from './repoBase.js';
