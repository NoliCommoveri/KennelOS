// petSchedule.js — assembles a pet's schedule from its sources and evaluates it.
// schedule.js is the pure engine (stores nothing); the caller is responsible for
// gathering the item sources and the pet's logged actuals. This helper is that
// caller, shared by the pages so Today and the pet page agree on what's due.
//
// Sources combined (schema doc §schedule engine):
//   1. Universal library (careLibrary.js) — dogs only (content is dog-first).
//   2. Family-authored care_plans rows.
//   3. Breeder content packs — DEFERRED (fetch not built yet); no rows contribute.
import { careEventRepo } from '../data/careEventRepo.js';
import { carePlanRepo } from '../data/carePlanRepo.js';
import { petRepo } from '../data/petRepo.js';
import { DOG_SCHEDULE } from '../data/careLibrary.js';
import { fromLibraryItem, fromCarePlan, evaluateSchedule, familyDueSoon } from '../data/schedule.js';
import { CARE_CATEGORY, CARE_EVENT_TYPE } from '../data/vocab.js';

// The normalized schedule items that apply to a pet: universal dog items (if the
// pet is a dog) plus the family's own plans.
export async function itemsForPet(pet) {
  const universal = pet.species === 'dog' ? DOG_SCHEDULE.map((it) => fromLibraryItem(it, 'universal')) : [];
  const plans = await carePlanRepo.getByPet(pet.id);
  const family = plans.map(fromCarePlan);
  return [...universal, ...family];
}

// The evaluated, sorted schedule for one pet (overdue → done), plus the raw
// events so a caller can also render history without a second load.
export async function evaluatedForPet(pet, asOf) {
  const [items, events] = await Promise.all([itemsForPet(pet), careEventRepo.getByPet(pet.id)]);
  return { schedule: evaluateSchedule(items, pet, events, asOf), events };
}

// The family-wide due-soon feed across every pet (the one cross-pet view).
export async function familyFeed(asOf) {
  const pets = await petRepo.getAll();
  const perPet = await Promise.all(pets.map(async (pet) => {
    const [items, events] = await Promise.all([itemsForPet(pet), careEventRepo.getByPet(pet.id)]);
    return { pet, items, events };
  }));
  return { feed: familyDueSoon(perPet, asOf), petCount: pets.length };
}

// Map a schedule item's CARE_CATEGORY to the CARE_EVENT_TYPE recorded when the
// family checks it off. Most categories share a code with an event type; 'exam'
// logs as a vet visit and 'other' as a note (the two that don't line up 1:1).
const CATEGORY_TO_EVENT_TYPE = { exam: 'vet_visit', other: 'note' };
export function eventTypeForCategory(category) {
  if (CATEGORY_TO_EVENT_TYPE[category]) return CATEGORY_TO_EVENT_TYPE[category];
  return CARE_EVENT_TYPE.some((t) => t.value === category) ? category : 'note';
}

// Guard used by the log-done action: the category must be a known vocab value.
export function isKnownCategory(category) {
  return CARE_CATEGORY.some((c) => c.value === category);
}
