// skillProgressRepo.js — the "mark it learned" state, one row per pet × training
// concept (see trainingContent.js's header on skill_concept_id). Deliberately NOT
// built on repoBase's makeRepo: the table's primary key is the compound
// `[pet_id+skill_concept_id]`, not a UUID id, so there is no single-id
// get/update/archive to reuse. Status is not a locked state machine — un-marking
// a learned skill is just another setStatus call, same posture as Dog/Pairing
// status fields elsewhere in KennelOS.
import { db } from './db.js';
import { nowIso } from './repoBase.js';

const VALID_STATUS = new Set(['not_started', 'in_progress', 'learned']);

export const skillProgressRepo = {
  // One pet's progress across every concept they've touched, as a Map keyed by
  // skill_concept_id — the shape the Training page wants to look status up by,
  // regardless of which track's skill row is on screen.
  async statusMapForPet(petId) {
    const rows = await db.skill_progress.where('pet_id').equals(petId).toArray();
    return new Map(rows.map((r) => [r.skill_concept_id, r]));
  },

  getForConcept(petId, conceptId) {
    return db.skill_progress.get([petId, conceptId]);
  },

  // Upsert the status for one pet × concept. `status` drives date_learned:
  // set on the transition INTO 'learned', left alone otherwise, cleared on the
  // transition OUT of it (an un-mark should not leave a stale learned-on date).
  async setStatus(petId, conceptId, status) {
    if (!VALID_STATUS.has(status)) throw new Error(`Skill progress: unknown status "${status}".`);
    const existing = await skillProgressRepo.getForConcept(petId, conceptId);
    const now = nowIso();
    const record = {
      pet_id: petId,
      skill_concept_id: conceptId,
      status,
      date_learned: status === 'learned'
        ? (existing && existing.status === 'learned' ? existing.date_learned : now.slice(0, 10))
        : null,
      created_at: existing ? existing.created_at : now,
      updated_at: now
    };
    await db.skill_progress.put(record);
    return record;
  }
};
