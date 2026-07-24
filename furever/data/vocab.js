// vocab.js — Furever's controlled vocabularies, each value carrying a human label
// and a badge color class. Dropdowns and badges both read from here so they never
// drift. Badge class names mirror the breeder app's palette so a shared stylesheet
// can be reused.

// Pet origin — which data layer created this pet (schema doc §pets). Drives the
// "from your breeder" vs "pets you added" split and whether a resend can touch it.
export const PET_SOURCE = [
  { value: 'seeded', label: 'From your breeder', badge: 'badge-blue' },
  { value: 'self',   label: 'Added by you',      badge: 'badge-green' }
];

// Species — dog-first: a dog gets the full care library + schedule; other species
// are records-only until a content pack exists (brief §Multi-pet).
export const SPECIES = [
  { value: 'dog',   label: 'Dog',   badge: 'badge-blue' },
  { value: 'cat',   label: 'Cat',   badge: 'badge-purple' },
  { value: 'other', label: 'Other', badge: 'badge-gray' }
];

export const SEX = [
  { value: 'male',    label: 'Male',    badge: 'badge-blue' },
  { value: 'female',  label: 'Female',  badge: 'badge-purple' },
  { value: 'unknown', label: 'Unknown', badge: 'badge-gray' }
];

// Care-event types — the family's append-only log. Every logged actual carries
// one of these (schema doc §care_events). These are the ACTUALS, distinct from
// the schedule categories a plan item is filed under (CARE_CATEGORY below).
export const CARE_EVENT_TYPE = [
  { value: 'vaccination',  label: 'Vaccination',  badge: 'badge-green' },
  { value: 'deworming',    label: 'Deworming',    badge: 'badge-green' },
  { value: 'preventative', label: 'Preventative', badge: 'badge-green' },
  { value: 'medication',   label: 'Medication',   badge: 'badge-amber' },
  { value: 'vet_visit',    label: 'Vet visit',    badge: 'badge-blue' },
  { value: 'weight_check', label: 'Weight',       badge: 'badge-neutral' },
  { value: 'milestone',    label: 'Milestone',    badge: 'badge-purple' },
  { value: 'note',         label: 'Note',         badge: 'badge-gray' }
];

// Care-plan categories — how a schedule item (universal, breeder-pack, or a
// family-authored care_plan) is filed. Broader than event types: one category
// (e.g. 'vaccination') is satisfied by a matching care_event.
export const CARE_CATEGORY = [
  { value: 'vaccination',  label: 'Vaccination',  badge: 'badge-green' },
  { value: 'deworming',    label: 'Deworming',    badge: 'badge-green' },
  { value: 'preventative', label: 'Preventative', badge: 'badge-green' },
  { value: 'medication',   label: 'Medication',   badge: 'badge-amber' },
  { value: 'exam',         label: 'Exam',         badge: 'badge-blue' },
  { value: 'other',        label: 'Other',        badge: 'badge-gray' }
];

// Where a schedule item's clock starts. Universal/breeder items anchor to the
// pet's DOB; a family-authored plan defaults to its own start_date, because DOB
// rarely means anything for a mid-life regimen (design decision, schema doc §5).
export const PLAN_ANCHOR = [
  { value: 'dob',        label: 'Age (from birth)', badge: 'badge-blue' },
  { value: 'start_date', label: 'A start date',     badge: 'badge-neutral' }
];

// Cadence kind for a plan item — a one-time due, or a repeating interval whose
// NEXT due is computed from the latest logged actual (never a stored future row).
export const CADENCE_KIND = [
  { value: 'once',      label: 'One time',  badge: 'badge-neutral' },
  { value: 'recurring', label: 'Repeating', badge: 'badge-blue' }
];

// Family-owned contact roles (schema doc §contacts). The breeder + breeder's vet
// live in the seed layer (breeders table), NOT here — this table is the family's.
export const CONTACT_TYPE = [
  { value: 'vet',           label: 'Vet',           badge: 'badge-blue' },
  { value: 'emergency_vet', label: 'Emergency vet', badge: 'badge-amber' },
  { value: 'groomer',       label: 'Groomer',       badge: 'badge-purple' },
  { value: 'trainer',       label: 'Trainer',       badge: 'badge-green' },
  { value: 'other',         label: 'Other',         badge: 'badge-gray' }
];

// Document vault types (schema doc §documents).
export const DOC_TYPE = [
  { value: 'contract',     label: 'Contract',     badge: 'badge-neutral' },
  { value: 'registration', label: 'Registration', badge: 'badge-blue' },
  { value: 'microchip',    label: 'Microchip',    badge: 'badge-purple' },
  { value: 'insurance',    label: 'Insurance',    badge: 'badge-green' },
  { value: 'vet_record',   label: 'Vet record',   badge: 'badge-amber' },
  { value: 'other',        label: 'Other',        badge: 'badge-gray' }
];

// Potty-log outcomes (schema doc §potty_events). A successful outside potty vs an
// indoor accident — the two things the Potty page records, one tap each.
export const POTTY_OUTCOME = [
  { value: 'success',  label: 'Went outside', badge: 'badge-green' },
  { value: 'accident', label: 'Accident',     badge: 'badge-amber' }
];

// Training tracks — the dropdown on the Training page (schema §training_skills).
export const TRAINING_PROGRAM = [
  { value: 'akc_timeline', label: 'AKC Age-Based Timeline', badge: 'badge-blue' },
  { value: 'akc_star_puppy', label: 'AKC S.T.A.R. Puppy', badge: 'badge-green' },
  { value: 'kc_good_citizen', label: 'Good Citizen Dog Training Scheme (UK)', badge: 'badge-purple' }
];

// Training skill categories (trainingContent.js's CATEGORIES ids).
export const TRAINING_CATEGORY = [
  { value: 'socialization', label: 'Socialization', badge: 'badge-blue' },
  { value: 'handling_grooming', label: 'Handling & Grooming', badge: 'badge-purple' },
  { value: 'house_training', label: 'House Training', badge: 'badge-green' },
  { value: 'crate_confinement', label: 'Crate & Confinement', badge: 'badge-green' },
  { value: 'impulse_control', label: 'Impulse Control', badge: 'badge-amber' },
  { value: 'polite_play_bite_inhibition', label: 'Polite Play & Bite Inhibition', badge: 'badge-amber' },
  { value: 'leash_walking', label: 'Leash Walking', badge: 'badge-blue' },
  { value: 'recall', label: 'Recall', badge: 'badge-blue' },
  { value: 'basic_cues', label: 'Basic Cues', badge: 'badge-purple' },
  { value: 'distraction_proofing', label: 'Distraction Proofing', badge: 'badge-amber' },
  { value: 'alone_training', label: 'Alone Training', badge: 'badge-neutral' },
  { value: 'public_manners', label: 'Public Manners', badge: 'badge-blue' },
  { value: 'advanced_control', label: 'Advanced Control', badge: 'badge-purple' }
];

// A skill's "mark it learned" status (skill_progress.status). Not a locked state
// machine — a family can move backward without friction.
export const SKILL_STATUS = [
  { value: 'not_started', label: 'Not started', badge: 'badge-gray' },
  { value: 'in_progress', label: 'Practicing', badge: 'badge-amber' },
  { value: 'learned', label: 'Learned', badge: 'badge-green' }
];

// Lookup helper: the {label, badge} for a value in one of the vocabs above.
export function labelFor(vocab, value) {
  const hit = vocab.find((v) => v.value === value);
  return hit ? hit.label : (value || '');
}
