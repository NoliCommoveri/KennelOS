// carePlanRepo.js — FAMILY-AUTHORED schedule items ("the vet said every 6 weeks").
// Universal and breeder-pack schedule items are CONTENT (careLibrary.js /
// content_packs), not rows; this table is only the cadences the family adds
// themselves. Each row's id becomes the plan_item_id a logged actual references,
// and the referential guard (CARE_PLAN_REFERENCES) protects a plan that has
// history against hard delete.
//
// Anchor default is 'start_date' (schema doc §5): a mid-life regimen anchors to
// when it begins, not the pet's DOB. A family plan may still anchor to 'dob' if
// the user wants an age-based item.
import { db } from './db.js';
import { makeRepo } from './repoBase.js';
import { CARE_PLAN_REFERENCES } from './referenceRegistry.js';

const base = makeRepo('care_plans', CARE_PLAN_REFERENCES);

const REQUIRED_FIELDS = ['pet_id', 'label', 'category'];

function validateCarePlan(candidate) {
  for (const f of REQUIRED_FIELDS) {
    if (candidate[f] == null || candidate[f] === '') {
      throw new Error(`Care plan: "${f}" is required.`);
    }
  }
  const anchor = candidate.anchor || 'start_date';
  if (anchor === 'start_date' && !candidate.start_date) {
    throw new Error('Care plan: a start_date is required when the anchor is a start date.');
  }
  const cadence = candidate.cadence || {};
  if (cadence.kind === 'recurring' && !(cadence.interval > 0 && cadence.unit)) {
    throw new Error('Care plan: a repeating plan needs an interval and a unit.');
  }
}

export const carePlanRepo = {
  ...base,

  create(data) {
    const withDefaults = { anchor: 'start_date', cadence: { kind: 'once' }, ...data };
    validateCarePlan(withDefaults);
    return base.create(withDefaults);
  },

  async update(id, changes) {
    const existing = await db.care_plans.get(id);
    if (!existing) throw new Error(`care_plans: no record with id ${id}`);
    validateCarePlan({ ...existing, ...changes });
    return base.update(id, changes);
  },

  // A pet's family-authored plans (the active-pet scope's custom schedule).
  async getByPet(petId, { includeArchived = false } = {}) {
    const rows = await db.care_plans.where('pet_id').equals(petId).toArray();
    return includeArchived ? rows : rows.filter((p) => !p.is_archived);
  }
};

export { ReferenceBlockedError } from './repoBase.js';
