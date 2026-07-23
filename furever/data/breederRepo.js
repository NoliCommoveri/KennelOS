// breederRepo.js — the SEED-layer breeder identity: the "call us anytime" card
// that sits one tap away for years (brief §Why it's good for the breeder). Holds
// the breeder's own contact and their VET's contact (the seed layer; the family's
// own vet lives in `contacts`, the family layer). Refreshes on a resend, keyed on
// `breeder_key` so two pups from the same kennel share one row and don't drift.
import { db } from './db.js';
import { makeRepo } from './repoBase.js';
import { BREEDER_REFERENCES } from './referenceRegistry.js';

const base = makeRepo('breeders', BREEDER_REFERENCES);

export const breederRepo = {
  ...base,

  async getByKey(breederKey) {
    if (!breederKey) return null;
    return db.breeders.where('breeder_key').equals(breederKey).first();
  },

  // Upsert the breeder identity from an incoming packet. Keyed on breeder_key;
  // seed-owned fields refresh in place. Returns the breeder row so petRepo can
  // link a seeded pet to it.
  async upsertFromSeed(seed) {
    if (!seed || !seed.breederKey) throw new Error('breederRepo.upsertFromSeed: seed.breederKey is required.');
    const fields = {
      breeder_key: seed.breederKey,
      kennel_name: seed.kennelName || '',
      tagline: seed.tagline || '',
      breeder_contact: seed.breederContact || null, // { name, phone, email }
      vet_contact: seed.breederVet || null          // { name, phone, address }
    };
    const existing = await breederRepo.getByKey(seed.breederKey);
    if (existing) return base.update(existing.id, fields);
    return base.create(fields);
  }
};

export { ReferenceBlockedError } from './repoBase.js';
