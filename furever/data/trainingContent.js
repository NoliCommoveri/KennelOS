// trainingContent.js — the UNIVERSAL puppy training curriculum that ships INSIDE
// the app, compiled from AKC and The Kennel Club (UK) — see
// docs/Puppy_Training_Guide_Content_Brief.md for sourcing notes. Same posture as
// careLibrary.js: this is CONTENT, not family data. It is seeded wholesale into
// the `training_skills` table by trainingSkillRepo.ensureSeeded() (version-gated,
// blind replace on a content bump — same discipline as documentRepo's breeder-pack
// replace), so the Training page can query it with Dexie like any other table.
//
// Every skill has a STABLE `id`. A family's practice_logs.skill_id references it,
// so ids here must never be reused or renumbered once shipped.
//
// skill_concept_id is the cross-program equivalence key (NOT in the source brief —
// added so the Training page's track dropdown can port progress: AKC's "Sits on
// cue" and the Kennel Club's "Reliable sit & down, and a settled stay" both teach
// the same underlying behavior, so they share a concept id and skill_progress
// (keyed on pet_id + skill_concept_id, not skill_id) shows "learned" under either
// track. This is a curated best-fit grouping, not a certification equivalence —
// a bundled skill (e.g. "sit, down & a stay") maps to ONE primary concept even
// though it touches more than one behavior. Like skill ids, concept ids must stay
// stable once shipped.
export const TRAINING_CONTENT_VERSION = 1;

export const SOURCES = [
  { id: 'akc', name: 'American Kennel Club (AKC)', url: 'https://www.akc.org' },
  { id: 'kennel_club_uk', name: 'The Kennel Club (UK)', url: 'https://www.thekennelclub.org.uk' },
  { id: 'avsab', name: 'American Veterinary Society of Animal Behavior (AVSAB)', url: 'https://avsab.org' }
];

export const PROGRAMS = [
  {
    id: 'akc_timeline',
    source_id: 'akc',
    name: 'AKC Age-Based Timeline',
    structure_type: 'age_stage',
    official_url: 'https://www.akc.org/expert-advice/training/puppy-training-timeline-teaching-good-behavior-before-its-too-late/'
  },
  {
    id: 'akc_star_puppy',
    source_id: 'akc',
    name: 'AKC S.T.A.R. Puppy (self-tracking overview)',
    structure_type: 'flat_checklist',
    official_url: 'https://www.akc.org/products-services/training-programs/canine-good-citizen/akc-star-puppy/'
  },
  {
    id: 'kc_good_citizen',
    source_id: 'kennel_club_uk',
    name: 'Good Citizen Dog Training Scheme (UK)',
    structure_type: 'level',
    official_url: 'https://www.thekennelclub.org.uk/dog-training/good-citizen-dog-training-scheme/'
  }
];

export const CATEGORIES = [
  { id: 'socialization', label: 'Socialization' },
  { id: 'handling_grooming', label: 'Handling & Grooming' },
  { id: 'house_training', label: 'House Training' },
  { id: 'crate_confinement', label: 'Crate & Confinement' },
  { id: 'impulse_control', label: 'Impulse Control' },
  { id: 'polite_play_bite_inhibition', label: 'Polite Play & Bite Inhibition' },
  { id: 'leash_walking', label: 'Leash Walking' },
  { id: 'recall', label: 'Recall' },
  { id: 'basic_cues', label: 'Basic Cues (Sit/Down/Stay)' },
  { id: 'distraction_proofing', label: 'Distraction Proofing' },
  { id: 'alone_training', label: 'Alone Training' },
  { id: 'public_manners', label: 'Public Manners' },
  { id: 'advanced_control', label: 'Advanced Control' }
];

// AKC Timeline stages — min/max in WEEKS of age, used to auto-expand the pet's
// current stage the same way ageBrackets.js drives Health's bucketing.
export const STAGES = [
  {
    id: 'akc_stage_8_16w', program_id: 'akc_timeline', order: 1,
    label: '8–16 weeks — Build Trust & Explore the World',
    min_weeks: 8, max_weeks: 16,
    developmental_note: "Falls inside AVSAB's critical socialization window (roughly the first three months of life). AVSAB's position is that safe, controlled socialization should begin before the vaccine series is complete, since waiting for full vaccination typically means missing most of this window."
  },
  {
    id: 'akc_stage_6mo', program_id: 'akc_timeline', order: 2,
    label: 'By 6 months — Manners, Independence, and Recall',
    min_weeks: 17, max_weeks: 26, developmental_note: null
  },
  {
    id: 'akc_stage_1yr', program_id: 'akc_timeline', order: 3,
    label: 'By 1 year — Reliable Basics',
    min_weeks: 27, max_weeks: 52, developmental_note: null
  }
];

export const LEVELS = [
  {
    id: 'kc_puppy_foundation', program_id: 'kc_good_citizen', order: 1, label: 'Puppy Foundation',
    typical_age_display: '8 weeks – 12 months', prerequisite_level_id: null,
    notes: 'Minimum four-week course. Aim is socialization and a foundation for later training, not formal obedience.'
  },
  {
    id: 'kc_bronze', program_id: 'kc_good_citizen', order: 2, label: 'Bronze',
    typical_age_display: 'from ~20 weeks', prerequisite_level_id: 'kc_puppy_foundation',
    notes: 'First formal obedience level. Follows Puppy Foundation or equivalent puppy classes.'
  },
  {
    id: 'kc_silver', program_id: 'kc_good_citizen', order: 3, label: 'Silver',
    typical_age_display: 'after Bronze', prerequisite_level_id: 'kc_bronze',
    notes: 'Adds real-world public-access skills: greetings, road walking, vehicle control.'
  },
  {
    id: 'kc_gold', program_id: 'kc_good_citizen', order: 4, label: 'Gold',
    typical_age_display: '12+ months', prerequisite_level_id: 'kc_silver',
    notes: 'Highest level. Requires the dog be at least 12 months old and hold a Silver award.'
  }
];

// The cross-program equivalence groups (see header). Label is shown wherever a
// family might want to know "this is the same skill as X on another track."
export const SKILL_CONCEPTS = [
  { id: 'env_exposure', label: 'Environmental exposure (sounds & surfaces)' },
  { id: 'people_comfort', label: 'Comfort around people' },
  { id: 'dog_to_dog_greeting', label: 'Dog-to-dog greetings' },
  { id: 'transport_vet_normalcy', label: 'Car rides & vet visits' },
  { id: 'body_handling', label: 'Body handling & grooming tolerance' },
  { id: 'equipment_acceptance', label: 'Collar/harness acceptance' },
  { id: 'sit_cue', label: 'Sit on cue' },
  { id: 'down_cue', label: 'Down on cue' },
  { id: 'name_recognition', label: 'Name recognition' },
  { id: 'house_training', label: 'House training' },
  { id: 'crate_training', label: 'Crate training' },
  { id: 'bite_inhibition', label: 'Bite inhibition' },
  { id: 'drop_it', label: 'Drop it / leave it' },
  { id: 'alone_training', label: 'Comfortable time alone' },
  { id: 'recall', label: 'Recall (coming when called)' },
  { id: 'polite_waiting', label: 'Polite waiting / impulse control' },
  { id: 'sit_down_stay_reliability', label: 'Sit/down/stay reliability' },
  { id: 'loose_leash_walking', label: 'Loose-leash walking' },
  { id: 'environmental_distraction_tolerance', label: 'Distraction tolerance' },
  { id: 'brief_stay_with_stranger', label: 'Brief stay with a stranger present' },
  { id: 'owner_responsibilities', label: 'Owner responsibilities' },
  { id: 'vehicle_manners', label: 'Vehicle manners' },
  { id: 'extended_settle_away', label: 'Extended settle away from handler' },
  { id: 'send_away_stop', label: 'Send-away & stop' },
  { id: 'place_cue', label: 'Place / send to bed' }
];

const A = 'akc', K = 'kennel_club_uk';
const AKC_TIMELINE_URL = PROGRAMS[0].official_url;
const AKC_STAR_URL = PROGRAMS[1].official_url;
const KC_URL = PROGRAMS[2].official_url;

export const SKILLS = [
  // --- Track A: AKC Timeline, Stage 1 (8-16 weeks) --------------------------
  { id: 'akc_t1_s1', program_id: 'akc_timeline', stage_id: 'akc_stage_8_16w', level_id: null, category_id: 'socialization', skill_concept_id: 'env_exposure', order: 1,
    title: 'Positive exposure to everyday sounds & surfaces',
    summary: 'Build comfort with ordinary household and outdoor sounds/textures before they become a source of fear.',
    steps: [
      'Expose gradually to things like the vacuum, traffic, or a doorbell from a distance where the puppy stays relaxed.',
      'Pair each new sound or surface with treats and calm praise.',
      'Increase intensity or proximity only after the puppy shows comfort.',
      'Keep sessions short and end on a success.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t1_s2', program_id: 'akc_timeline', stage_id: 'akc_stage_8_16w', level_id: null, category_id: 'socialization', skill_concept_id: 'people_comfort', order: 2,
    title: 'Meet people of all kinds',
    summary: "Build comfort around a wide variety of people while it's still easy.",
    steps: [
      'Invite calm friends or family over.',
      'Let visitors offer a treat only if the puppy approaches on their own.',
      'Vary ages, appearances, hats, and uniforms gradually.',
      'Never force contact — let the puppy retreat if unsure.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t1_s3', program_id: 'akc_timeline', stage_id: 'akc_stage_8_16w', level_id: null, category_id: 'socialization', skill_concept_id: 'transport_vet_normalcy', order: 3,
    title: 'Car rides & vet visits as normal life',
    summary: 'Make transportation and veterinary settings feel routine, not scary.',
    steps: [
      'Take short, reward-filled car rides to fun destinations.',
      'Make "happy visits" to the vet clinic lobby with treats and no exam involved.',
      'Practice calm handling of paws/ears/mouth at home, mirroring what a vet would do.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t1_s4', program_id: 'akc_timeline', stage_id: 'akc_stage_8_16w', level_id: null, category_id: 'handling_grooming', skill_concept_id: 'body_handling', order: 4,
    title: 'Body handling practice',
    summary: 'Build tolerance for the kind of handling grooming and vet care require.',
    steps: [
      'Touch paws, ears, mouth, and tail briefly while feeding treats.',
      'Gradually increase duration.',
      'Introduce grooming tools (brush, nail clipper) nearby without using them at first.',
      'Stop before the puppy gets uncomfortable.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t1_s5', program_id: 'akc_timeline', stage_id: 'akc_stage_8_16w', level_id: null, category_id: 'impulse_control', skill_concept_id: 'sit_cue', order: 5,
    title: 'Sit before good things happen',
    summary: 'The first layer of impulse control: sit as a polite way to ask for things.',
    steps: [
      'Lure into a sit before every meal, before the leash clips on, before a toy is thrown.',
      'Mark and reward the instant the rear touches the floor.',
      'Fade the lure once reliable and add the word "sit."'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t1_s6', program_id: 'akc_timeline', stage_id: 'akc_stage_8_16w', level_id: null, category_id: 'basic_cues', skill_concept_id: 'name_recognition', order: 6,
    title: 'Name recognition',
    summary: 'The foundation cue everything else builds on.',
    steps: [
      "Say the puppy's name in an upbeat tone.",
      'Mark and reward instant eye contact.',
      'Practice in different rooms and with mild distractions.',
      'Never use the name for corrections.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t1_s7', program_id: 'akc_timeline', stage_id: 'akc_stage_8_16w', level_id: null, category_id: 'house_training', skill_concept_id: 'house_training', order: 7,
    title: 'Potty training foundation',
    summary: 'Establish the schedule and cues that make housetraining predictable.',
    steps: [
      'Take outside on a schedule: on waking, after meals, after naps, after play.',
      'Use the same door and a consistent cue word.',
      'Reward within seconds of elimination outdoors.',
      'Supervise indoors or use a crate/pen to prevent unsupervised accidents.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t1_s8', program_id: 'akc_timeline', stage_id: 'akc_stage_8_16w', level_id: null, category_id: 'crate_confinement', skill_concept_id: 'crate_training', order: 8,
    title: 'Crate as a safe space',
    summary: "Build a positive association with the crate before it's needed for confinement.",
    steps: [
      'Toss treats inside with the door open.',
      'Feed meals inside the crate.',
      'Add a cue word ("kennel"/"crate") as the puppy walks in.',
      'Close the door for a few seconds at a time before naps, then build duration gradually.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  // --- Track A: AKC Timeline, Stage 2 (by 6 months) -------------------------
  { id: 'akc_t2_s1', program_id: 'akc_timeline', stage_id: 'akc_stage_6mo', level_id: null, category_id: 'polite_play_bite_inhibition', skill_concept_id: 'bite_inhibition', order: 1,
    title: 'Bite inhibition & polite mouthing',
    summary: 'Teach a soft mouth before adult jaw strength arrives.',
    steps: [
      'Yelp or say "ouch" and stop play the instant teeth touch skin.',
      'Disengage for 10–15 seconds.',
      'Resume calmly.',
      'Redirect onto an appropriate chew toy the moment teeth touch skin again.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t2_s2', program_id: 'akc_timeline', stage_id: 'akc_stage_6mo', level_id: null, category_id: 'impulse_control', skill_concept_id: 'drop_it', order: 2,
    title: 'Drop it',
    summary: 'Teach that giving something up is never a loss.',
    steps: [
      'Trade a low-value item for a higher-value treat.',
      'Say "drop it" as they release.',
      'Give the item back (or something better) so dropping never means losing something good for good.',
      'Practice with toys before valuables.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t2_s3', program_id: 'akc_timeline', stage_id: 'akc_stage_6mo', level_id: null, category_id: 'house_training', skill_concept_id: 'house_training', order: 3,
    title: 'Extending potty reliability',
    summary: 'Stretch intervals as bladder control matures.',
    steps: [
      'Gradually stretch the interval between trips outside.',
      'Keep a consistent feeding schedule to make elimination more predictable.',
      'Continue rewarding outdoor success.',
      'Treat accidents as a supervision gap, not a training failure.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t2_s4', program_id: 'akc_timeline', stage_id: 'akc_stage_6mo', level_id: null, category_id: 'alone_training', skill_concept_id: 'alone_training', order: 4,
    title: 'Comfortable time alone',
    summary: 'Build tolerance for being left, in small increments.',
    steps: [
      'Start with the puppy behind a gate or in a crate in the same room.',
      'Gradually leave the room for a few seconds at a time.',
      'Extend absences slowly over days and weeks.',
      'Keep departures and returns low-key.',
      'Leave a stuffed food toy as a positive association.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t2_s5', program_id: 'akc_timeline', stage_id: 'akc_stage_6mo', level_id: null, category_id: 'recall', skill_concept_id: 'recall', order: 5,
    title: 'Coming when called',
    summary: 'The first real recall, built from very short distances.',
    steps: [
      'Start close, in a low-distraction area.',
      'Say the puppy\'s name plus "come."',
      'Reward enthusiastically every single time they arrive.',
      'Gradually add distance and mild distractions.',
      'Use a long line outdoors before ever trusting off-leash recall.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t2_s6', program_id: 'akc_timeline', stage_id: 'akc_stage_6mo', level_id: null, category_id: 'impulse_control', skill_concept_id: 'polite_waiting', order: 6,
    title: 'Sit/wait for everything',
    summary: 'Generalize polite waiting beyond mealtime.',
    steps: [
      'Extend "sit before good things" to doors, greetings, and toy retrieval.',
      'Ask for eye contact before releasing the puppy through a door or to greet someone.',
      'Reward calm waiting over pushiness.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  // --- Track A: AKC Timeline, Stage 3 (by 1 year) ---------------------------
  { id: 'akc_t3_s1', program_id: 'akc_timeline', stage_id: 'akc_stage_1yr', level_id: null, category_id: 'basic_cues', skill_concept_id: 'sit_down_stay_reliability', order: 1,
    title: 'Sit, down & stay with distractions',
    summary: 'Proof the basic cues against real-world distraction.',
    steps: [
      "Practice each cue in new locations (yard, park, a friend's house).",
      'Add distance and duration gradually.',
      'Introduce mild distractions (a dropped toy, someone walking by) only once the cue is solid in a quiet room.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t3_s2', program_id: 'akc_timeline', stage_id: 'akc_stage_1yr', level_id: null, category_id: 'recall', skill_concept_id: 'recall', order: 2,
    title: 'Reliable, off-leash-ready recall',
    summary: 'Build toward trustworthy recall in a controlled off-leash setting.',
    steps: [
      'Continue long-line practice in increasingly distracting environments.',
      'Only move to a fenced off-leash area once recall is consistent on the line.',
      'Recall should always be the best-paying cue in the toolkit.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t3_s3', program_id: 'akc_timeline', stage_id: 'akc_stage_1yr', level_id: null, category_id: 'leash_walking', skill_concept_id: 'loose_leash_walking', order: 3,
    title: 'Loose-leash walking',
    summary: 'Walking near you without pulling, as a habit rather than a fight.',
    steps: [
      'Reward the dog for staying near your side.',
      'Stop moving the instant the leash goes tight.',
      'Change direction to keep them checking in.',
      'Reward frequently at first and stretch the intervals as the habit builds.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  { id: 'akc_t3_s4', program_id: 'akc_timeline', stage_id: 'akc_stage_1yr', level_id: null, category_id: 'impulse_control', skill_concept_id: 'drop_it', order: 4,
    title: 'Leave it & drop it under distraction',
    summary: 'Take impulse control from easy setups to real-world temptation.',
    steps: [
      'Practice "leave it" with a treat in a closed fist, then under a foot, then in the open — rewarding from the other hand each time.',
      'Extend "drop it" to higher-value items once the foundation is solid.'
    ], source_id: A, source_url: AKC_TIMELINE_URL },

  // --- Track B: AKC S.T.A.R. Puppy (flat checklist) -------------------------
  { id: 'akc_star_1', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'socialization', skill_concept_id: 'people_comfort', order: 1,
    title: 'Comfortable around unfamiliar people',
    summary: 'Tolerates petting and brief handling from a stranger without fear or aggression.',
    steps: ['Practice in short, low-pressure encounters with new people, rewarding calm behavior throughout.'],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_2', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'socialization', skill_concept_id: 'dog_to_dog_greeting', order: 2,
    title: 'Comfortable around other puppies',
    summary: 'Calm, non-aggressive behavior in a group class or play setting.',
    steps: ['Practice in a controlled group setting (a puppy class is ideal), rewarding calm engagement or disengagement.'],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_3', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'handling_grooming', skill_concept_id: 'equipment_acceptance', order: 3,
    title: 'Accepts collar/harness',
    summary: 'Tolerates wearing normal walking equipment without fighting it.',
    steps: ['Let the puppy wear the collar/harness for short, positive periods indoors before ever attaching a leash.'],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_4', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'handling_grooming', skill_concept_id: 'body_handling', order: 4,
    title: 'Tolerates being hugged or held',
    summary: 'Stays relaxed during brief, gentle restraint.',
    steps: ['Practice brief, gentle holds paired with treats, releasing before any sign of discomfort.'],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_5', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'impulse_control', skill_concept_id: 'drop_it', order: 5,
    title: 'Releases an item on cue',
    summary: 'An early "drop it" — gives up a toy or treat when asked.',
    steps: ["Use the trade-up game: offer a higher-value item in exchange for the one in the puppy's mouth."],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_6', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'impulse_control', skill_concept_id: 'polite_waiting', order: 6,
    title: 'Waits calmly for a treat or toy',
    summary: "Doesn't grab or mob the hand holding it.",
    steps: ['Hold a treat out of reach and reward calm waiting rather than jumping or pawing.'],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_7', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'handling_grooming', skill_concept_id: 'body_handling', order: 7,
    title: 'Tolerates a brief handling exam',
    summary: 'Ears, feet, and mouth checked without struggling.',
    steps: ['Practice a short mock exam (ears, feet, mouth) regularly, pairing each step with a treat.'],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_8', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'leash_walking', skill_concept_id: 'loose_leash_walking', order: 8,
    title: 'Walks on a loose leash',
    summary: 'Follows the owner in a reasonably straight line without constant pulling.',
    steps: ['Reward frequent check-ins and stop moving the instant the leash tightens.'],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_9', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'basic_cues', skill_concept_id: 'sit_cue', order: 9,
    title: 'Sits on cue',
    summary: 'A reliable sit on a single verbal cue.',
    steps: ['Lure into position, mark and reward, then fade the lure and add the verbal cue.'],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_10', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'basic_cues', skill_concept_id: 'down_cue', order: 10,
    title: 'Lies down on cue',
    summary: 'A reliable down on a single verbal cue.',
    steps: ['Lure from a sit into a down, mark and reward, then fade the lure and add the verbal cue.'],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_11', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'recall', skill_concept_id: 'recall', order: 11,
    title: 'Comes when called',
    summary: 'From a short distance (~5 ft), with a mild distraction present.',
    steps: ['Practice at short distances first, rewarding generously, before adding distance or distraction.'],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_12', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'distraction_proofing', skill_concept_id: 'environmental_distraction_tolerance', order: 12,
    title: 'Reacts calmly to a mild distraction',
    summary: 'Something happening ~15 ft away (a dropped object, another dog on leash).',
    steps: ['Start with distractions far enough away that the puppy stays relaxed, and close the distance gradually.'],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_13', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'public_manners', skill_concept_id: 'brief_stay_with_stranger', order: 13,
    title: 'Holds a brief stay on leash',
    summary: 'While a stranger holds the leash or the owner steps a few paces away.',
    steps: ['Build stay duration and distance separately, with a trusted helper holding the leash before a stranger does.'],
    source_id: A, source_url: AKC_STAR_URL },

  { id: 'akc_star_14', program_id: 'akc_star_puppy', stage_id: null, level_id: null, category_id: 'socialization', skill_concept_id: 'owner_responsibilities', order: 14,
    title: 'Owner responsibilities',
    summary: 'Current ID tag, waste bags on hand, up to date on vaccination/wellness care.',
    steps: ['A checklist item for the human half of the program — not a trainable puppy skill.'],
    source_id: A, source_url: AKC_STAR_URL },

  // --- Track C: Kennel Club (UK) Good Citizen — Puppy Foundation ------------
  { id: 'kc_pf_1', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_puppy_foundation', category_id: 'socialization', skill_concept_id: 'people_comfort', order: 1,
    title: 'Calm greetings with people & other puppies',
    summary: 'Short, controlled introductions that stay positive.',
    steps: [
      'Practice short, calm introductions with one new person or puppy at a time in a controlled space.',
      'Reward calm behavior.',
      'End the interaction before the puppy gets overstimulated.',
      'Never force contact.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_pf_2', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_puppy_foundation', category_id: 'polite_play_bite_inhibition', skill_concept_id: 'bite_inhibition', order: 2,
    title: 'Bite inhibition through structured play',
    summary: 'A soft mouth, taught through play rather than punishment.',
    steps: [
      'Use play sessions to teach a soft mouth.',
      'Pause play the instant teeth touch skin.',
      'Reward gentle mouthing or toy engagement.',
      'Keep sessions short and positive.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_pf_3', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_puppy_foundation', category_id: 'impulse_control', skill_concept_id: 'polite_waiting', order: 3,
    title: 'Basic self-control games',
    summary: 'The earliest layer of "ask politely" behavior.',
    steps: [
      'Practice "wait" before a toy is thrown.',
      'Reward calm behavior instead of jumping or grabbing.',
      'Build duration a second or two at a time.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_pf_4', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_puppy_foundation', category_id: 'handling_grooming', skill_concept_id: 'body_handling', order: 4,
    title: "Accepting handling from the owner",
    summary: "Comfort with the owner's own hands-on care.",
    steps: [
      'Touch ears, paws, mouth, and collar briefly while feeding treats.',
      'Build toward being able to check or groom the puppy calmly.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_pf_5', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_puppy_foundation', category_id: 'basic_cues', skill_concept_id: 'name_recognition', order: 5,
    title: 'Responding to name & a beginner cue',
    summary: 'Attention and a first cue, kept short and successful.',
    steps: [
      'Reward attention to name and a beginner "sit" or "come" using food lures.',
      'Keep sessions short, end on success.'
    ], source_id: K, source_url: KC_URL },

  // --- Track C: Kennel Club (UK) Good Citizen — Bronze ----------------------
  { id: 'kc_bz_1', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_bronze', category_id: 'leash_walking', skill_concept_id: 'loose_leash_walking', order: 1,
    title: 'Controlled walking on a lead',
    summary: 'Walking near the handler without pulling, in busier settings than Foundation level.',
    steps: [
      'Reward the dog for walking near your side without pulling.',
      'Stop when the lead tightens.',
      'Reward check-ins.',
      'Practice in increasingly busy environments.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_bz_2', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_bronze', category_id: 'basic_cues', skill_concept_id: 'sit_down_stay_reliability', order: 2,
    title: 'Reliable sit & down, and a settled stay in one position',
    summary: 'The core obedience trio, made reliable.',
    steps: [
      'Build sit/down with a lure, then fade it.',
      'Ask for a short stay while standing still nearby.',
      'Add duration before adding distance.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_bz_3', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_bronze', category_id: 'handling_grooming', skill_concept_id: 'body_handling', order: 3,
    title: 'Calm inspection & grooming',
    summary: 'A mock vet-style check the dog tolerates calmly.',
    steps: [
      'Practice a mock grooming/vet-style check (ears, mouth, paws, coat) with the dog standing calmly.',
      'Reward stillness throughout.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_bz_4', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_bronze', category_id: 'recall', skill_concept_id: 'recall', order: 4,
    title: 'Recall on lead / long line',
    summary: 'A dependable recall while still under physical control.',
    steps: [
      "Call the dog's name plus a recall cue with high-value rewards.",
      'Practice with mild distractions.',
      'Reward arrival generously, every time.'
    ], source_id: K, source_url: KC_URL },

  // --- Track C: Kennel Club (UK) Good Citizen — Silver ----------------------
  { id: 'kc_sv_1', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_silver', category_id: 'public_manners', skill_concept_id: 'dog_to_dog_greeting', order: 1,
    title: 'Controlled greeting of another dog & handler',
    summary: 'A calm, brief greeting that ends on cue.',
    steps: [
      'Practice a calm approach and brief on-lead greeting with a training partner.',
      'Reward disengaging on cue rather than prolonged fixation.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_sv_2', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_silver', category_id: 'public_manners', skill_concept_id: 'loose_leash_walking', order: 2,
    title: 'Road walk under control',
    summary: 'Attention to the handler even with real street distraction.',
    steps: [
      'Practice walking past passing traffic and street distractions on a loose lead.',
      'Reward attention to the handler over the environment.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_sv_3', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_silver', category_id: 'public_manners', skill_concept_id: 'vehicle_manners', order: 3,
    title: 'Calm behavior around a vehicle',
    summary: 'Getting in, out, and waiting by a car under control.',
    steps: [
      'Practice getting in and out of a car under control, waiting calmly before exiting.',
      'Reward settled behavior once inside.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_sv_4', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_silver', category_id: 'distraction_proofing', skill_concept_id: 'sit_down_stay_reliability', order: 4,
    title: 'Extended stay with a distraction',
    summary: 'Holding position through movement, sound, or another dog nearby.',
    steps: ['Build on the Bronze stay by adding movement, sound, or another dog at a distance while the dog holds position.'],
    source_id: K, source_url: KC_URL },

  // --- Track C: Kennel Club (UK) Good Citizen — Gold ------------------------
  { id: 'kc_gd_1', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_gold', category_id: 'advanced_control', skill_concept_id: 'extended_settle_away', order: 1,
    title: 'Relaxed settle away from the handler',
    summary: 'Settling for extended periods with the handler at a distance or briefly out of sight.',
    steps: [
      'Practice the dog settling on a mat/bed for extended periods while the handler moves progressively further away, eventually briefly out of sight.',
      'Build duration and distance gradually, one small step at a time.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_gd_2', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_gold', category_id: 'advanced_control', skill_concept_id: 'send_away_stop', order: 2,
    title: 'Send-away & stop on cue',
    summary: 'Moving away on cue, and stopping mid-movement on a second cue.',
    steps: [
      'Teach the dog to move away from the handler toward a target/spot on cue.',
      'Teach a clear stop/wait cue mid-movement.',
      'Build each half of the skill separately before combining them.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_gd_3', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_gold', category_id: 'advanced_control', skill_concept_id: 'place_cue', order: 3,
    title: 'Send to a place/bed',
    summary: 'A "place" cue: go to a designated spot and settle.',
    steps: [
      'Teach a "place" cue where the dog moves to and settles on a designated mat or bed on command.',
      'Reward calm settling there, gradually adding duration and distraction.'
    ], source_id: K, source_url: KC_URL },

  { id: 'kc_gd_4', program_id: 'kc_good_citizen', stage_id: null, level_id: 'kc_gold', category_id: 'recall', skill_concept_id: 'recall', order: 4,
    title: 'Reliable recall away from strong distractions',
    summary: 'The most demanding recall test: real distraction, real reliability.',
    steps: [
      'Practice recall around other dogs, food distractions, and busy environments.',
      'Reward generously.',
      'Use a long line for safety until it\'s reliable off-leash.'
    ], source_id: K, source_url: KC_URL }
];

// Convenience lookups (mirror the read-only content-module helpers elsewhere,
// e.g. careLibrary.js/vocab.js's labelFor).
export function programById(id) {
  return PROGRAMS.find((p) => p.id === id) || null;
}

export function stagesForProgram(programId) {
  return STAGES.filter((s) => s.program_id === programId).sort((a, b) => a.order - b.order);
}

export function levelsForProgram(programId) {
  return LEVELS.filter((l) => l.program_id === programId).sort((a, b) => a.order - b.order);
}

export function conceptLabel(conceptId) {
  const hit = SKILL_CONCEPTS.find((c) => c.id === conceptId);
  return hit ? hit.label : conceptId;
}
