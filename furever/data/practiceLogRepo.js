// practiceLogRepo.js — the family's append-only "I practiced this" log. Same
// append-only spirit as careEventRepo, kept as its own table because a training
// session isn't scheduled/derived the way vaccines are (schedule.js's due-date
// engine has no opinion on training) — this is purely a history of real sessions.
import { db } from './db.js';
import { makeRepo } from './repoBase.js';
import { PRACTICE_LOG_REFERENCES } from './referenceRegistry.js';

const base = makeRepo('practice_logs', PRACTICE_LOG_REFERENCES);

const REQUIRED_FIELDS = ['pet_id', 'skill_id', 'session_date'];

function validatePracticeLog(candidate) {
  for (const f of REQUIRED_FIELDS) {
    if (candidate[f] == null || candidate[f] === '') {
      throw new Error(`Practice log: "${f}" is required.`);
    }
  }
}

export const practiceLogRepo = {
  ...base,

  create(data) {
    validatePracticeLog(data);
    return base.create(data);
  },

  // A pet's full practice history, newest first.
  async getByPet(petId, { includeArchived = false } = {}) {
    const rows = await db.practice_logs.where('pet_id').equals(petId).toArray();
    const filtered = includeArchived ? rows : rows.filter((r) => !r.is_archived);
    return filtered.sort((a, b) => (b.session_date || '').localeCompare(a.session_date || ''));
  },

  // The latest practice date for one skill, or null — used to show "last
  // practiced" without a stored/duplicated field (schedule doc's "derive, don't
  // duplicate" principle).
  async lastPracticedFor(petId, skillId) {
    const rows = await practiceLogRepo.getByPet(petId);
    const hit = rows.find((r) => r.skill_id === skillId);
    return hit ? hit.session_date : null;
  }
};

export { ReferenceBlockedError } from './repoBase.js';
