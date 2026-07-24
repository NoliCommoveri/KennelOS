> **Implementation status (furever/, built):** this content is live —
> transcribed into `furever/data/trainingContent.js` (the seed source for the
> `training_skills` table; see `furever/README.md`'s Training paragraph and
> `furever/data/db.js`'s index notes). Two deltas from §4/§6 below, both by
> deliberate choice, not oversight:
> - Table names are the snake_case `training_skills` / `practice_logs` /
>   `skill_progress` (Furever's actual naming convention), not §6's illustrative
>   camelCase.
> - `skill_progress` is keyed on `[pet_id+skill_concept_id]`, not `[puppy_id+
>   skill_id]`. `skill_concept_id` is a curated cross-program equivalence id
>   (added in `trainingContent.js`, not in the JSON below) so that marking a
>   skill learned under one track (AKC Timeline / S.T.A.R. / Kennel Club) shows
>   the equivalent skill on another track as learned too — the three programs
>   cover a lot of the same ground under different wording, and the Training
>   page's track dropdown would otherwise make a family re-mark the same
>   behavior three times.
>
> The raw `puppy_training_seed_data.json` this brief was paired with is not
> checked in separately — its content lives transcribed in
> `trainingContent.js`, which is the source of truth going forward. Treat this
> file as the human-readable rationale/sourcing record, per its own §0 below.

# Puppy Training Guide — Content Brief
### For the Family/Puppy-Parent Companion App

**How to use this doc:** this is the human-readable version of `puppy_training_seed_data.json` — the same content, organized for reading rather than importing. Hand the JSON file to whatever seeding routine loads reference content into the app; use this doc to review, edit, or extend that content before it ships.

**What this is not:** a build brief. It doesn't specify screens, validation rules, or a Dexie schema for the whole app — just the training content itself, plus one suggested section (§4) on how the "log a practice session / mark it learned" feature could store data, written in a style that should slot in next to kennelos's existing conventions if useful.

---

## 1. Sources

Two national kennel-club training frameworks, chosen because they're the two most-cited English-language "official" (non-commercial) programs, plus one veterinary-behavior source used only for developmental context, not as a training curriculum of its own:

| Source | What it contributes | Official link |
|---|---|---|
| **American Kennel Club (AKC)** | An age-staged training timeline (8–16 weeks / by 6 months / by 1 year), plus the **S.T.A.R. Puppy** program — a structured, checklist-style graduated curriculum usable up to 12 months old | akc.org/expert-advice/training/puppy-training-timeline-teaching-good-behavior-before-its-too-late/ ; akc.org/products-services/training-programs/canine-good-citizen/akc-star-puppy/ |
| **The Kennel Club (UK)** | The **Good Citizen Dog Training Scheme** — a level-based (not strictly age-based) progression: Puppy Foundation → Bronze → Silver → Gold | thekennelclub.org.uk/dog-training/good-citizen-dog-training-scheme/ |
| **American Veterinary Society of Animal Behavior (AVSAB)** | Developmental/scientific context only — the critical socialization window and vaccine-timing guidance that explains *why* the age staging above looks the way it does | avsab.org, Position Statement on Puppy Socialization |

**A note on the steps:** AKC's and the Kennel Club's own published materials describe *what* a puppy should learn at each stage/level in fairly general terms (e.g., "loose lead walking," "recall," "handling and grooming"). The specific step-by-step teaching mechanics under each skill below are standard, widely-taught positive-reinforcement technique — not reproduced from either organization's proprietary text — written out so the app has something concrete to show a user, not just a skill name. Both organizations' own class curricula and official guides go into more depth than a checklist app can carry; the app should link out to them rather than try to replace them.

---

## 2. Track A — AKC Age-Based Timeline

### Stage 1: 8–16 weeks — "Build Trust & Explore the World"
*AKC's framing: this is the critical socialization window. Priority is environmental exposure and the very first layer of impulse control — not formal obedience.*

**Socialization**
- **Positive exposure to everyday sounds & surfaces** — Expose gradually to things like the vacuum, traffic, or a doorbell from a distance where the puppy stays relaxed. Pair each new sound/surface with treats and calm praise. Increase intensity or proximity only after the puppy shows comfort. Keep sessions short and end on a success.
- **Meet people of all kinds** — Invite calm friends or family over. Let visitors offer a treat only if the puppy approaches on their own. Vary ages, appearances, hats, and uniforms gradually. Never force contact — let the puppy retreat if unsure.
- **Car rides & vet visits as normal life** — Take short, reward-filled car rides to fun destinations. Make "happy visits" to the vet clinic lobby with treats and no exam involved. Practice calm handling of paws/ears/mouth at home, mirroring what a vet would do.
- **Body handling practice** — Touch paws, ears, mouth, and tail briefly while feeding treats. Gradually increase duration. Introduce grooming tools (brush, nail clipper) nearby without using them at first. Stop before the puppy gets uncomfortable.

**Impulse control / basic cues**
- **Sit before good things happen** — Lure into a sit before every meal, before the leash clips on, before a toy is thrown. Mark and reward the instant the rear touches the floor. Fade the lure once reliable and add the word "sit."
- **Name recognition** — Say the puppy's name in an upbeat tone. Mark and reward instant eye contact. Practice in different rooms and with mild distractions. Never use the name for corrections.

**House training / crate**
- **Potty training foundation** — Take outside on a schedule: on waking, after meals, after naps, after play. Use the same door and a consistent cue word. Reward within seconds of elimination outdoors. Supervise indoors or use a crate/pen to prevent unsupervised accidents.
- **Crate as a safe space** — Toss treats inside with the door open. Feed meals inside the crate. Add a cue word ("kennel"/"crate") as the puppy walks in. Close the door for a few seconds at a time before naps, then build duration gradually.

### Stage 2: By 6 months — "Manners, Independence, and Recall"
*AKC's framing: polite play, continued housetraining progress, comfort being alone, an early recall, and impulse control applied more broadly.*

- **Bite inhibition & polite mouthing** — Yelp or say "ouch" and stop play the instant teeth touch skin. Disengage for 10–15 seconds. Resume calmly. Redirect onto an appropriate chew toy the moment teeth touch skin again.
- **Drop it** — Trade a low-value item for a higher-value treat. Say "drop it" as they release. Give the item back (or something better) so dropping never means losing something good for good. Practice with toys before valuables.
- **Extending potty reliability** — Gradually stretch the interval between trips outside. Keep a consistent feeding schedule to make elimination more predictable. Continue rewarding outdoor success. Treat accidents as a supervision gap, not a training failure.
- **Comfortable time alone** — Start with the puppy behind a gate or in a crate in the same room. Gradually leave the room for a few seconds at a time. Extend absences slowly over days and weeks. Keep departures and returns low-key. Leave a stuffed food toy as a positive association.
- **Coming when called** — Start close, in a low-distraction area. Say the puppy's name plus "come." Reward enthusiastically every single time they arrive. Gradually add distance and mild distractions. Use a long line outdoors before ever trusting off-leash recall.
- **Sit/wait for everything** — Extend "sit before good things" to doors, greetings, and toy retrieval. Ask for eye contact before releasing the puppy through a door or to greet someone. Reward calm waiting over pushiness.

### Stage 3: By 1 year — "Reliable Basics"
*AKC's framing: mastery of sit/down/stay with distractions, recall (especially off-leash), loose-leash walking, and drop it/leave it.*

- **Sit, down & stay with distractions** — Practice each cue in new locations (yard, park, a friend's house). Add distance and duration gradually. Introduce mild distractions (a dropped toy, someone walking by) only once the cue is solid in a quiet room.
- **Reliable, off-leash-ready recall** — Continue long-line practice in increasingly distracting environments. Only move to a fenced off-leash area once recall is consistent on the line. Recall should always be the best-paying cue in the toolkit.
- **Loose-leash walking** — Reward the dog for staying near your side. Stop moving the instant the leash goes tight. Change direction to keep them checking in. Reward frequently at first and stretch the intervals as the habit builds.
- **Leave it & drop it under distraction** — Practice "leave it" with a treat in a closed fist, then under a foot, then in the open — rewarding from the other hand each time. Extend "drop it" to higher-value items once the foundation is solid.

---

## 3. Track B — AKC S.T.A.R. Puppy (checklist program, usable 8 weeks – 1 year)

*Unlike the timeline above, this isn't staged by age — it's a flat checklist meant to be worked through over a 6-week class (or informally at home) any time before the puppy turns one. Good fit for a "mark off once learned" UI. AKC's own certified test has 20 specific items administered by an approved evaluator; the list below is a paraphrased overview of the skill categories it covers, grouped for a self-tracking app — not the official test wording. Link out to AKC for the certified version.*

- **Comfortable around unfamiliar people** — Tolerates petting and brief handling from a stranger without fear or aggression.
- **Comfortable around other puppies** — Calm, non-aggressive behavior in a group class setting.
- **Accepts collar/harness** — Tolerates wearing normal walking equipment without fighting it.
- **Tolerates being hugged or held** — Stays relaxed during brief, gentle restraint.
- **Releases an item on cue** — An early "drop it" — gives up a toy or treat when asked.
- **Waits calmly for a treat or toy** — Doesn't grab or mob the hand holding it.
- **Accepts petting from a stranger** — In any relaxed position.
- **Tolerates a brief handling exam** — Ears, feet, mouth checked without struggling.
- **Walks on a loose leash** — Follows the owner in a reasonably straight line without constant pulling.
- **Sits on cue.**
- **Lies down on cue.**
- **Comes when called** — From a short distance (~5 ft), with a mild distraction present.
- **Reacts calmly to a mild distraction** — Something happening ~15 ft away (a dropped object, another dog on leash).
- **Holds a brief stay on leash** — While a stranger holds the leash or the owner steps a few paces away.
- **Owner responsibilities** — Current ID tag, waste bags on hand, up to date on vaccination/wellness care, familiar with basic responsible-ownership practices.

---

## 4. Track C — The Kennel Club (UK) Good Citizen Dog Training Scheme

*Level-based rather than strictly age-based. Levels are meant to be taken in order; each builds on the last. Rough age guidance is added below for the app's benefit — the Kennel Club itself doesn't gate levels by exact age, only by prerequisite level (except Gold, which requires the dog to be 12+ months old).*

### Puppy Foundation (typical age: 8 weeks – 12 months; minimum 4-week course)
- **Calm greetings with people & other puppies** — Practice short, calm introductions with one new person or puppy at a time in a controlled space. Reward calm behavior. End the interaction before the puppy gets overstimulated. Never force contact.
- **Bite inhibition through structured play** — Use play sessions to teach a soft mouth. Pause play the instant teeth touch skin. Reward gentle mouthing or toy engagement. Keep sessions short and positive.
- **Basic self-control games** — Practice "wait" before a toy is thrown. Reward calm behavior instead of jumping or grabbing. Build duration a second or two at a time.
- **Accepting handling from the owner** — Touch ears, paws, mouth, and collar briefly while feeding treats, building toward being able to check or groom the puppy calmly.
- **Responding to name & a beginner cue** — Reward attention to name and a beginner "sit" or "come" using food lures. Keep sessions short, end on success.

### Bronze (typical age: from ~20 weeks, after Puppy Foundation or equivalent puppy classes)
- **Controlled walking on a lead** — Reward the dog for walking near your side without pulling. Stop when the lead tightens. Reward check-ins. Practice in increasingly busy environments.
- **Reliable sit & down, and a settled stay in one position** — Build sit/down with a lure, then fade it. Ask for a short stay while standing still nearby. Add duration before adding distance.
- **Calm inspection & grooming** — Practice a mock grooming/vet-style check (ears, mouth, paws, coat) with the dog standing calmly. Reward stillness throughout.
- **Recall on lead / long line** — Call the dog's name plus a recall cue with high-value rewards. Practice with mild distractions. Reward arrival generously, every time.

### Silver (after Bronze)
- **Controlled greeting of another dog & handler** — Practice a calm approach and brief on-lead greeting with a training partner. Reward disengaging on cue rather than prolonged fixation.
- **Road walk under control** — Practice walking past passing traffic and street distractions on a loose lead. Reward attention to the handler over the environment.
- **Calm behavior around a vehicle** — Practice getting in and out of a car under control, waiting calmly before exiting. Reward settled behavior once inside.
- **Extended stay with a distraction** — Build on the Bronze stay by adding movement, sound, or another dog at a distance while the dog holds position.

### Gold (typical age: 12+ months; requires Silver)
- **Relaxed settle away from the handler** — Practice the dog settling on a mat or bed for extended periods while the handler moves progressively further away, eventually briefly out of sight. Build duration and distance gradually, one small step at a time.
- **Send-away & stop on cue** — Teach the dog to move away from the handler toward a target/spot on cue, then teach a clear stop/wait cue mid-movement. Build each half of the skill separately before combining them.
- **Send to a place/bed** — Teach a "place" cue: the dog moves to and settles on a designated mat or bed on command. Reward calm settling there, gradually adding duration and distraction.
- **Reliable recall away from strong distractions** — Practice recall around other dogs, food distractions, and busy environments. Reward generously. Use a long line for safety until it's reliable off-leash.

---

## 5. Developmental Context (not a curriculum — background for the "by age" framing)

Per AVSAB's Position Statement on Puppy Socialization: the single most important socialization window is roughly the **first three months of life**, a period during which puppies are unusually receptive to new people, animals, and environments and unusually resistant to developing fear responses. AVSAB's position is that this window matters enough that controlled, safe socialization should begin **before** the vaccine series is finished, not after — waiting until full vaccination is typically too late to make good use of the window. This is the scientific reasoning behind why both tracks above front-load exposure work into the earliest stage/level, and it's worth surfacing to users as a short "why now" note attached to Stage 1 / Puppy Foundation rather than as its own trainable skill.

---

## 6. Suggested Tracking Schema (for "log a session" / "mark it learned")

Content above is reference data — shipped with the app, not user-generated. Tracking what a specific puppy has practiced or learned is a separate, small, user-generated layer. In keeping with kennelos's own conventions (one generic log table rather than one per skill type, UUID ids, `YYYY-MM-DD` date-only fields, `is_archived` never a hard delete), a natural fit:

```js
// Suggested Dexie addition — illustrative, not prescriptive
db.version(1).stores({
  puppyProfiles: 'id, is_archived',
  trainingSkills: 'id, program_id, stage_id, level_id, category_id',   // seeded from puppy_training_seed_data.json, read-only at runtime
  practiceLogs:   'id, puppy_id, skill_id, session_date',              // one row per practice session — the "log a session" action
  skillProgress:  '[puppy_id+skill_id], status'                        // one row per puppy×skill — the "mark it learned" state
});
```

- `practiceLogs`: `{ id, puppy_id, skill_id, session_date (YYYY-MM-DD), duration_minutes?, went_well? (enum: struggled/ok/good), notes?, created_at }` — append-only, mirrors kennelos's Event philosophy (a dated thing that happened).
- `skillProgress`: `{ puppy_id, skill_id, status (enum: not_started/in_progress/learned), date_learned? (YYYY-MM-DD), last_practiced_at? }` — this is what "mark it off once learned" writes to; `last_practiced_at` and a practice count can be derived from `practiceLogs` rather than duplicated, same "derive, don't duplicate" principle as kennelos's puppy roster.
- Status is not a locked state machine, same posture as kennelos's Dog/Pairing status fields — a family should be able to un-mark something as "learned" without friction if the dog backslides.

*(See the implementation-status note at the top of this file for how the shipped schema in `furever/` actually differs: snake_case table names, and `skill_progress` keyed on a cross-program `skill_concept_id` rather than the per-track `skill_id`, so progress ports between the three tracks below.)*

---

## 7. What's Deliberately Left Out

- Exact reproduction of AKC's 20-item S.T.A.R. Puppy test or the Kennel Club's official exercise-by-exercise assessment sheets — both are proprietary evaluator materials behind their own certification programs. The app's checklist is a paraphrased, self-tracking version; link out to the official programs for anyone who wants the certified title.
- Breed-specific training variation — this is a general-purpose family-pet curriculum, not tuned per breed.
- Anything past Gold / past 1 year — both tracks stop at "reliable adult basics"; advanced obedience, sport-specific work, or behavior rehabilitation are out of scope for a new-puppy-parent app.
