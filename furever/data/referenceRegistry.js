// referenceRegistry.js — the single declared list of every foreign key that
// points AT each Furever entity, plus the generic guard that drives hard-delete
// blocking. Same design as the breeder app: one canonical stored side per
// relationship, the reverse is always a derived query, and adding a new FK means
// appending ONE line here (or hard delete silently allows orphaning).
//
// Entry shape: { table, field, label }. Furever has no polymorphic subject_type
// tables, so there are no compound/discriminator entries — every FK is a plain
// single-field index.
import { db, existingTableNames } from './db.js';

// --- Pet: what can point at a Pet -------------------------------------------
// The whole family layer hangs off the pet, so a pet can't be hard-deleted while
// any of its records survive — archive it (which the active-pet menu hides).
export const PET_REFERENCES = [
  { table: 'care_events',  field: 'pet_id', label: 'a logged care entry' },
  { table: 'care_plans',   field: 'pet_id', label: 'a custom care plan' },
  { table: 'feeding',      field: 'pet_id', label: 'a feeding plan' },
  { table: 'potty_events', field: 'pet_id', label: 'a potty log entry' },
  { table: 'contacts',     field: 'pet_id', label: 'a saved contact' },
  { table: 'documents',    field: 'pet_id', label: 'a filed document' },
  { table: 'photos',       field: 'pet_id', label: 'a photo' }
];

// --- Breeder: what can point at a Breeder -----------------------------------
// A seeded pet names the breeder it came from; the breeder card ("call us
// anytime") must not vanish out from under it.
export const BREEDER_REFERENCES = [
  { table: 'pets', field: 'breeder_id', label: "a pet from this breeder" }
];

// --- CarePlan: what can point at a CarePlan ---------------------------------
// A logged actual references the schedule item it satisfied via plan_item_id.
// When that item is a FAMILY plan (care_plans.id), a logged event blocks the
// plan's hard delete — archive it so the history keeps its anchor. (Universal /
// breeder-pack item ids also live in plan_item_id but point at CONTENT, not a
// row here, so they never match this guard — exactly the intended behavior.)
export const CARE_PLAN_REFERENCES = [
  { table: 'care_events', field: 'plan_item_id', label: 'a logged entry against this plan' }
];

// --- Leaf entities — nothing points at them. Their own FKs point OUTWARD and
// are guarded on those targets above. `files` rows are owned by exactly one
// document/photo and deleted alongside it (fileRepo), never guarded here.
export const CONTACT_REFERENCES = [];
export const CARE_EVENT_REFERENCES = [];
export const FEEDING_REFERENCES = [];
export const POTTY_EVENT_REFERENCES = [];
export const DOCUMENT_REFERENCES = [];
export const PHOTO_REFERENCES = [];
export const CONTENT_PACK_REFERENCES = [];

// Count rows matching one registry entry for the given target id.
async function countReferences(ref, id) {
  return db.table(ref.table).where(ref.field).equals(id).count();
}

// Generic guard: the list of human-readable blockers ({ label, count }) for `id`
// against `registry`, skipping any table not present in the current schema.
// Empty array => hard delete is allowed.
export async function findBlockingReferences(registry, id) {
  const existing = new Set(existingTableNames());
  const blockers = [];
  for (const ref of registry) {
    if (!existing.has(ref.table)) continue;
    const count = await countReferences(ref, id);
    if (count > 0) blockers.push({ label: ref.label, count });
  }
  return blockers;
}
