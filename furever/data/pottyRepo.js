// pottyRepo.js — the Potty page's log: one append-only row per potty event, each
// carrying the day it happened (`occurred_date`, YYYY-MM-DD), a time-of-day label
// for ordering within the day, and an outcome (POTTY_OUTCOME: 'success' |
// 'accident'). Deliberately its OWN table, not care_events: potties are
// high-frequency and unscheduled, and keeping them out preserves care_events as
// the scheduled-care actuals log (schema doc §potty_events). A leaf — nothing
// points at a potty row, so it hard-deletes freely (used by the "remove" action).
import { db } from './db.js';
import { makeRepo, nowIso } from './repoBase.js';
import { POTTY_EVENT_REFERENCES } from './referenceRegistry.js';

const base = makeRepo('potty_events', POTTY_EVENT_REFERENCES);

const OUTCOMES = ['success', 'accident'];

export const pottyRepo = {
  ...base,

  // All of a pet's potty entries for ONE calendar day, earliest first (the Potty
  // page shows a single day at a time). `date` is a YYYY-MM-DD string.
  async getByPetAndDate(petId, date, { includeArchived = false } = {}) {
    if (!petId || !date) return [];
    const rows = await db.potty_events.where('pet_id').equals(petId).toArray();
    return rows
      .filter((r) => r.occurred_date === date && (includeArchived || !r.is_archived))
      .sort((a, b) => (a.occurred_time || '').localeCompare(b.occurred_time || '') ||
                      (a.created_at || '').localeCompare(b.created_at || ''));
  },

  // Record one potty event. `outcome` ∈ POTTY_OUTCOME; `date` defaults to today at
  // the call site. `occurred_time` is a HH:MM stamp captured now, for ordering.
  async log(petId, { outcome, occurred_date, occurred_time, notes = '' }) {
    if (!petId) throw new Error('pottyRepo.log: a pet id is required.');
    if (!OUTCOMES.includes(outcome)) throw new Error(`pottyRepo.log: unknown outcome "${outcome}".`);
    if (!occurred_date) throw new Error('pottyRepo.log: a date is required.');
    return base.create({
      pet_id: petId,
      outcome,
      occurred_date,
      occurred_time: occurred_time || nowIso().slice(11, 16),
      notes
    });
  }
};

export { ReferenceBlockedError } from './repoBase.js';
