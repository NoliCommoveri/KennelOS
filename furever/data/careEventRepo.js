// careEventRepo.js — the family's append-only care log. Every row is an ACTUAL:
// something that happened, on its real date. This is the ONLY place "done" is
// recorded — there are no future/planned event rows (schema doc §reminder model).
//
// A row optionally carries `plan_item_id`, the stable id of the schedule item it
// satisfies (a universal careLibrary item, a breeder-pack item, or a care_plans
// row). That link is what clears the derived reminder and, for a recurring item,
// seeds the next due date. A freeform note has no plan_item_id.
import { db } from './db.js';
import { makeRepo } from './repoBase.js';
import { CARE_EVENT_REFERENCES } from './referenceRegistry.js';

const base = makeRepo('care_events', CARE_EVENT_REFERENCES);

const REQUIRED_FIELDS = ['pet_id', 'event_type', 'event_date'];

function validateCareEvent(candidate) {
  for (const f of REQUIRED_FIELDS) {
    if (candidate[f] == null || candidate[f] === '') {
      throw new Error(`Care entry: "${f}" is required.`);
    }
  }
}

export const careEventRepo = {
  ...base,

  create(data) {
    validateCareEvent(data);
    return base.create(data);
  },

  async update(id, changes) {
    const existing = await db.care_events.get(id);
    if (!existing) throw new Error(`care_events: no record with id ${id}`);
    validateCareEvent({ ...existing, ...changes });
    return base.update(id, changes);
  },

  // A pet's full history, newest actual first. The active-pet scope's timeline.
  async getByPet(petId, { includeArchived = false } = {}) {
    const rows = await db.care_events.where('pet_id').equals(petId).toArray();
    const filtered = includeArchived ? rows : rows.filter((e) => !e.is_archived);
    return filtered.sort((a, b) => (b.event_date || '').localeCompare(a.event_date || ''));
  },

  // Log an actual that satisfies a schedule item — the "check it off" action. It
  // is a fresh append, never an edit of a planned row, so a corrected DOB later
  // can't disturb it. `planItemId` is the schedule item's stable id.
  logForPlanItem(petId, planItemId, { event_type, event_date, title = '', details = null }) {
    return careEventRepo.create({
      pet_id: petId,
      plan_item_id: planItemId,
      event_type,
      event_date,
      title,
      details
    });
  }
};

export { ReferenceBlockedError } from './repoBase.js';
