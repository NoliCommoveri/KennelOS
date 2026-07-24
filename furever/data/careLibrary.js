// careLibrary.js — the UNIVERSAL dog care content that ships INSIDE the app
// (brief §Content). This is CONTENT, not data: it is a static module, never a
// table, so every dog the family adds has a sensible lifelong schedule even if
// the breeder never customizes anything. A breeder's own program can OVERLAY
// these items via a fetched content pack (see content_packs / schedule.js).
//
// Each schedule item has a STABLE `id`. That id is what a logged actual stores in
// care_events.plan_item_id to satisfy the item — so ids here must never be reused
// or renumbered once shipped (a family's logged history references them).
//
// Item shape:
//   id        — stable slug, unique across the library
//   category  — a CARE_CATEGORY value (vocab.js)
//   label     — what the family sees
//   anchor    — 'dob' for every universal item (age-based care)
//   offset    — { unit, value } from the anchor to the FIRST due date
//   cadence   — { kind:'once' } OR { kind:'recurring', interval, unit }
//   arrivalWeek?  — true for the pickup-week items surfaced first (brief §care calendar)
//   note?     — one-line guidance shown with the item
//
// This is a representative starter set, not a vet-authoritative protocol; the real
// content is a fill-in-the-blanks task for launch. The SHAPE is what the schema
// and schedule engine are built against.
export const CARE_LIBRARY_VERSION = 1;

export const DOG_SCHEDULE = [
  // --- Arrival week (surfaced first, brief §lifelong care calendar) ---------
  {
    id: 'well_visit_72h',
    category: 'exam',
    label: 'First well-visit exam',
    anchor: 'dob',
    offset: { unit: 'week', value: 8 },
    cadence: { kind: 'once' },
    arrivalWeek: true,
    note: 'Schedule a wellness exam within 72 hours of bringing your puppy home.'
  },

  // --- Puppy vaccine series (age-anchored, one-time each) -------------------
  { id: 'dhpp_6wk',  category: 'vaccination', label: 'DHPP vaccine (1st)', anchor: 'dob', offset: { unit: 'week', value: 6 },  cadence: { kind: 'once' } },
  { id: 'dhpp_9wk',  category: 'vaccination', label: 'DHPP vaccine (2nd)', anchor: 'dob', offset: { unit: 'week', value: 9 },  cadence: { kind: 'once' } },
  { id: 'dhpp_12wk', category: 'vaccination', label: 'DHPP vaccine (3rd)', anchor: 'dob', offset: { unit: 'week', value: 12 }, cadence: { kind: 'once' } },
  { id: 'dhpp_16wk', category: 'vaccination', label: 'DHPP vaccine (4th)', anchor: 'dob', offset: { unit: 'week', value: 16 }, cadence: { kind: 'once' } },
  { id: 'rabies_1',  category: 'vaccination', label: 'Rabies vaccine',     anchor: 'dob', offset: { unit: 'week', value: 16 }, cadence: { kind: 'once' } },

  // --- Puppy deworming (age-anchored, one-time each) -----------------------
  { id: 'deworm_6wk',  category: 'deworming', label: 'Deworming (6 wk)',  anchor: 'dob', offset: { unit: 'week', value: 6 },  cadence: { kind: 'once' } },
  { id: 'deworm_8wk',  category: 'deworming', label: 'Deworming (8 wk)',  anchor: 'dob', offset: { unit: 'week', value: 8 },  cadence: { kind: 'once' } },
  { id: 'deworm_12wk', category: 'deworming', label: 'Deworming (12 wk)', anchor: 'dob', offset: { unit: 'week', value: 12 }, cadence: { kind: 'once' } },

  // --- Recurring lifelong care (next due computed from the last logged actual) --
  {
    id: 'preventative_monthly',
    category: 'preventative',
    label: 'Monthly flea / tick / heartworm preventative',
    anchor: 'dob',
    offset: { unit: 'week', value: 8 },
    cadence: { kind: 'recurring', interval: 1, unit: 'month' },
    note: 'Give on the same day each month.'
  },
  {
    id: 'annual_exam',
    category: 'exam',
    label: 'Annual wellness exam',
    anchor: 'dob',
    offset: { unit: 'year', value: 1 },
    cadence: { kind: 'recurring', interval: 1, unit: 'year' }
  },
  {
    id: 'rabies_booster',
    category: 'vaccination',
    label: 'Rabies booster',
    anchor: 'dob',
    offset: { unit: 'year', value: 1 },
    cadence: { kind: 'recurring', interval: 1, unit: 'year' }
  },
  {
    id: 'dhpp_booster',
    category: 'vaccination',
    label: 'DHPP booster',
    anchor: 'dob',
    offset: { unit: 'year', value: 1 },
    cadence: { kind: 'recurring', interval: 1, unit: 'year' }
  }
];

// --- Feeding plan (brief §feeding and safety reference) ---------------------
// The age-driven feeding presets the Feeding page offers as radio options, keyed
// to the life-stage brackets in ageBrackets.js (`bracket` matches an AGE_BRACKETS
// value). Each is a portion + meals-per-day the family can accept as-is or replace
// with a Custom schedule. This is placeholder CONTENT — real portions are
// breed/food specific and will be pulled from the breeder's own feeding guidance
// (a fetched content pack, brief §Delivery) later; a Custom entry always overrides.
// `portionText` is the amount per meal; the schedule string the page shows is
// `${portionText}, ${mealsPerDay}× per day`.
export const FEEDING_PLAN = [
  { bracket: 'baby',   portionText: '½ cup',      mealsPerDay: 4, note: 'Small, frequent meals of a quality puppy food.' },
  { bracket: 'puppy',  portionText: '¾ cup',      mealsPerDay: 3, note: 'Three meals a day as the puppy grows.' },
  { bracket: 'junior', portionText: '1 cup',      mealsPerDay: 2, note: 'Transition toward twice-daily feeding.' },
  { bracket: 'adult',  portionText: '1–1½ cups',  mealsPerDay: 2, note: 'Twice-daily adult feeding; adjust portions to body condition.' }
];

// A FEEDING_PLAN row's human schedule string, e.g. "½ cup, 3× per day".
export function feedingScheduleText(plan) {
  if (!plan) return '';
  return `${plan.portionText}, ${plan.mealsPerDay}× per day`;
}

// --- Safety reference: foods poisonous to dogs (brief §day one) -------------
export const POISONOUS_FOODS = [
  'Chocolate', 'Grapes and raisins', 'Onions and garlic', 'Xylitol (sugar-free gum/candy)',
  'Macadamia nuts', 'Alcohol', 'Caffeine', 'Avocado', 'Cooked bones', 'Raw bread dough'
];
