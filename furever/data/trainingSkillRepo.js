// trainingSkillRepo.js — read access to the training_skills table PLUS the
// version-gated seeder that fills it from trainingContent.js. Unlike every other
// repo in this app, there is no create/update/archive/hardDelete here: the table
// holds CONTENT, not family data (db.js's index-notes explain why it's a table at
// all), so the only writes are ensureSeeded()'s wholesale replace.
import { db } from './db.js';
import { SKILLS, TRAINING_CONTENT_VERSION } from './trainingContent.js';
import { getTrainingContentVersion, setTrainingContentVersion } from './settings.js';

// Bulk-load the current content into the table if the shipped version has moved
// past what's stored. Cheap no-op on every boot after the first (or after any
// boot that already caught up) — a plain localStorage read, no Dexie touch.
export async function ensureTrainingSkillsSeeded() {
  if (getTrainingContentVersion() === TRAINING_CONTENT_VERSION) return;
  await db.training_skills.clear();
  await db.training_skills.bulkPut(SKILLS);
  setTrainingContentVersion(TRAINING_CONTENT_VERSION);
}

export const trainingSkillRepo = {
  getById(id) {
    return db.training_skills.get(id);
  },

  async getByProgram(programId) {
    const rows = await db.training_skills.where('program_id').equals(programId).toArray();
    return rows.sort((a, b) => a.order - b.order);
  },

  getAll() {
    return db.training_skills.toArray();
  }
};
