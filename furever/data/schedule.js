// schedule.js — the DERIVED reminder engine. This is the module that makes the
// "no stored reminders" model real (schema doc §reminder model). It stores
// nothing: it takes a pet, the schedule items that apply to it, and the pet's
// logged care_events, and computes what is due right now.
//
// Three sources feed the schedule for a pet, all with stable item ids:
//   1. Universal library items (careLibrary.js) — for dogs.
//   2. A breeder content pack's overrides/additions (content_packs) — optional.
//   3. Family-authored care_plans rows — the family's own cadences.
// They are normalized to ONE item shape here so the "is it due?" math is uniform.
//
// The pairing rule (the whole point): an item is satisfied by a care_event whose
// `plan_item_id === item.id`. A one-time item is done once any such event exists.
// A recurring item's NEXT due is (latest matching event's date) + interval, or the
// first due date if nothing is logged yet. Nothing is ever written to mark an item
// due; correcting a DOB just recomputes due dates and never touches a logged actual.
import { addOffset, daysBetween, todayYMD } from './dateUtils.js';

// How many days ahead counts as "due soon" (vs "upcoming").
export const DUE_SOON_DAYS = 14;

// Normalize a universal/breeder-pack library item to the common schedule shape.
// `source` is 'universal' or 'pack' for display/debug; the id is used verbatim.
export function fromLibraryItem(item, source = 'universal') {
  return {
    itemId: item.id,
    source,
    label: item.label,
    category: item.category,
    anchor: item.anchor || 'dob',
    offset: item.offset || { unit: 'day', value: 0 },
    cadence: item.cadence || { kind: 'once' },
    note: item.note || ''
  };
}

// Normalize a family-authored care_plans row to the common schedule shape. Its
// own row id becomes the itemId (so logged actuals reference it, and the referential
// guard in referenceRegistry.js protects it).
export function fromCarePlan(plan) {
  return {
    itemId: plan.id,
    source: 'family',
    label: plan.label,
    category: plan.category,
    anchor: plan.anchor || 'start_date',
    offset: plan.offset || { unit: 'day', value: 0 },
    cadence: plan.cadence || { kind: 'once' },
    note: plan.note || ''
  };
}

// The anchor date an item's clock starts from: the pet's DOB, or the plan's
// start_date. Returns null when the needed anchor is missing (e.g. a DOB-anchored
// item on a pet with no DOB) — such an item simply can't be scheduled yet.
function anchorDate(item, pet) {
  if (item.anchor === 'dob') return pet.date_of_birth || null;
  if (item.anchor === 'start_date') return item.start_date || null;
  return null;
}

// The most recent logged actual (by event_date) that satisfies an item, or null.
function latestCompletion(itemId, events) {
  let best = null;
  for (const e of events) {
    if (e.is_archived) continue;
    if (e.plan_item_id !== itemId) continue;
    if (!e.event_date) continue;
    if (!best || e.event_date > best.event_date) best = e;
  }
  return best;
}

// Bucket a due date relative to today.
function statusFor(dueDate, asOf) {
  if (!dueDate) return 'unscheduled';
  const days = daysBetween(asOf, dueDate);
  if (days < 0) return 'overdue';
  if (days <= DUE_SOON_DAYS) return 'due_soon';
  return 'upcoming';
}

// Compute the live state of ONE normalized item for a pet, given the pet's logged
// care_events. Returns a plain object the UI renders directly:
//   { itemId, label, category, source, cadence, dueDate, lastDone, status }
// status ∈ 'overdue' | 'due_soon' | 'upcoming' | 'done' | 'unscheduled'.
export function evaluateItem(item, pet, events, asOf = todayYMD()) {
  const anchor = anchorDate(item, pet);
  const last = latestCompletion(item.itemId, events);
  const base = {
    itemId: item.itemId,
    label: item.label,
    category: item.category,
    source: item.source,
    cadence: item.cadence,
    note: item.note,
    lastDone: last ? last.event_date : null
  };

  if (item.cadence.kind === 'once') {
    // One-time: done forever once a matching actual exists; otherwise due at
    // (anchor + offset). No anchor → can't schedule yet.
    if (last) return { ...base, dueDate: last.event_date, status: 'done' };
    const dueDate = anchor ? addOffset(anchor, item.offset) : null;
    return { ...base, dueDate, status: statusFor(dueDate, asOf) };
  }

  // Recurring: next due = last actual + interval, or the first due (anchor + offset)
  // when nothing is logged yet. It never shows 'done' — it always rolls forward.
  const step = { unit: item.cadence.unit, value: item.cadence.interval };
  let dueDate;
  if (last) dueDate = addOffset(last.event_date, step);
  else dueDate = anchor ? addOffset(anchor, item.offset) : null;
  return { ...base, dueDate, status: statusFor(dueDate, asOf) };
}

// Evaluate a whole pet's schedule. `items` is the normalized, combined list
// (universal ∪ pack ∪ family) the caller assembled; `events` is the pet's
// care_events. Returns evaluated items sorted by due date (unscheduled/done last).
export function evaluateSchedule(items, pet, events, asOf = todayYMD()) {
  const evaluated = items.map((it) => evaluateItem(it, pet, events, asOf));
  const rank = { overdue: 0, due_soon: 1, upcoming: 2, done: 3, unscheduled: 4 };
  return evaluated.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return a.dueDate ? -1 : b.dueDate ? 1 : 0;
  });
}

// The family-wide due-soon feed — the ONE cross-pet page (schema doc §active-pet
// scope). `perPet` is [{ pet, items, events }] the caller gathered across all
// active pets. Returns overdue + due-soon rows only, each tagged with its pet,
// sorted by urgency then date.
export function familyDueSoon(perPet, asOf = todayYMD()) {
  const out = [];
  for (const { pet, items, events } of perPet) {
    for (const ev of evaluateSchedule(items, pet, events, asOf)) {
      if (ev.status === 'overdue' || ev.status === 'due_soon') {
        out.push({ ...ev, petId: pet.id, petName: pet.name || '' });
      }
    }
  }
  const rank = { overdue: 0, due_soon: 1 };
  return out.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return (a.dueDate || '').localeCompare(b.dueDate || '');
  });
}
