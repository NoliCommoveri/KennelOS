// contactRepo.js — the FAMILY's own contacts (their vet, emergency vet, groomer,
// trainer). Family layer: a resend never touches these. The breeder + breeder's
// vet are NOT here — they live in the seed layer (breederRepo).
//
// `pet_ids` is an array of the specific pets a contact applies to — never null,
// never empty. A contact meant for every pet just lists all of them; there's no
// dynamic "every pet, including future ones" sentinel, so a newly added pet is
// not automatically covered by an existing contact.
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
  if (!Array.isArray(candidate.pet_ids) || candidate.pet_ids.length === 0) {
    throw new Error('Contact: pick at least one pet.');
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
  }
};

export { ReferenceBlockedError } from './repoBase.js';
