# KennelOS — Line management: plan

> Status: **plan only, nothing built** (2026-11-18). Today every dog is its own record: a
> pairing checks only that the sire is male, the dam female and that they aren't the same
> dog. Nothing works out how two dogs are related, a litter's COI, what a dog carries, or
> how a line has produced. This plan adds that, in five phases. Phase 1 (relationships,
> COI and pairing warnings) needs no schema change and is worth doing before the UI
> redesign; Phases 2–5 add four tables and are designed for the redesign's hub screens.
>
> **Decisions:** D4 and D5's "her own color list" are the owner's (2026-11-18). The rest
> (§5) carry a recommendation and wait on the owner.
>
> Prototype: the forest-look prototype (Design notes) draws Lines, a pair check, the
> pairing finder, a dog's Relatives, Traits and Genetics, a litter's Births and Score
> puppies, and Setup › Breeding program. Sample data only.

## 1. What the owner asked for (2026-11-18)

- **Every dog relates to every other dog in the program**, including the ancestors two dogs
  share, not a tree she has to read herself. The whole-kennel family tree (Pedigree ›
  Whole kennel) draws the links but evaluates nothing.
- **Basic warnings** for parent and child, siblings and other close pairings.
- **Traits graded as a long-lived view of the dog**, in their own tables, not dated events:
  back length, ear set, head and so on, used to drive pairing decisions.
- **Pairing recommendations** and a projection of **what the program is missing**.
- **Breeding outcomes as structure, not free text**, so they can be evaluated: colors
  (a sire never color-tested who throws reds every litter obviously carries red),
  abnormalities, emergency C-sections and the rest.
- **Her own color list** (not shipped lists per breed), enforced as a dropdown, asked for
  each pup at birth. The standard coat-color genes can be shipped.
- **Light trait scores on each pup before go-home.**

## 2. What's there today

| Thing | Where | Shape |
|---|---|---|
| Parents | `Dog.sire_id`, `Dog.dam_id` | Structured. `dogRepo` blocks cycles on write. |
| Family drawing | `data/kennelTree.js`, `assets/kennelTree.js`, Pedigree › Whole kennel | Layout only; no relationship or COI. Deliberately not kennel-scoped (lineage crosses kennels). |
| COI | `Dog.recorded_coi` `{ value, method }` | Typed in by her (`COI_METHOD_SUGGESTIONS`: genomic, pedigree, registry, other). Guide §15 lists computed COI as not built. |
| Pairing checks | `pages/pairing.js:230` `updateWarnings()` | Sire recorded female, dam recorded male, same dog, due before first date. |
| Color | `Dog.color_markings` | Free text ("BLK BRDL & WH"), cloud. Waitlist `pref_colors` is a free list too. |
| Litter outcome | `Litter.puppies_born_total/_alive/_deceased/_abnormalities`, `Litter.delivery_type` | Counts, and a structured delivery type (natural, assisted, planned or emergency C-section). |
| Whelping notes | `whelping_summary` event: `total_born`, `live_born`, `notes` | Reasons, complications and per-pup facts end up in `notes`. |
| Abnormalities | `abnormalities` event on a dog, `type` from `ABNORMALITY_TYPES` | Structured, but only on pups that became Dog records; a stillborn pup's is lost. |
| DNA results | `genetic_test` event: `panel_name`, `lab`, `result` (combobox: Clear, Carrier, Affected, N/N, grades) | One free result per test, not one per marker. |
| Breeding attempts | `Pairing.status` (planned, bred, confirmed, not pregnant, whelped, failed), `breeding_tie` and `progesterone_test` events (`value`, `lab`) | Conception is already derivable from status; ties and progesterone are events. |

## 3. Design

### 3.1 Every dog related to every other dog (derived, never stored)

A pure module, `data/kinship.js`, over every Dog's `sire_id`/`dam_id` (all kennels, all
statuses, archived included, external and pedigree-only ancestors included). Nothing is
stored: per the reference-registry principle, relationships are derived queries.

- **Kinship** `f(a, b)`, the standard recursive (tabular) method, memoised:
  `f(a, a) = ½(1 + f(sire(a), dam(a)))`; otherwise expand whichever dog has the deeper known
  ancestry (it can't be the other's ancestor): `f(a, b) = ½(f(sire(a), b) + f(dam(a), b))`;
  an unknown parent contributes 0. Cycle-safe like `kennelTree.js`.
- **A litter's COI** = `f(sire, dam)`; **a dog's COI** = `f(its sire, its dam)`.
- **Relationship coefficient** `r = 2f / √((1 + F_a)(1 + F_b))`, shown as "related 25%".
- **The relationship by name**, both directions and by sex: parent and child, full and half
  siblings, grandparent and grandchild, aunt/uncle and niece/nephew (and half-), first
  cousins; else "related through Thornfield Oak"; else "no shared ancestors recorded".
- **Shared ancestors**: every common ancestor with its position on each side ("sire's sire;
  dam's dam's sire"), the nearest ones first (a common ancestor whose own ancestors are
  also common is listed, not its ancestors).
- **Pedigree depth**: for each dog, the share of ancestors known per generation. Unknown
  ancestors count as unrelated, so a COI is a floor; every COI says what it's based on
  ("6.3%, 4 generations known, 75% of the 4th"), and a thin pedigree is flagged (D1).
- A **genomic COI** she typed in (`recorded_coi`, method genomic) is shown beside the
  pedigree one, never replaced.
- **Cost:** memoised `f` over a few hundred dogs is instant; views compute only the pairs
  they show (the Lines grid: her males × her females).

**Where it shows:**
- **Pairing form and every planned pairing:** relationship, COI, shared ancestors, and the
  warnings of D1/D2. Today's Pairings list and a dog's pairings carry the warning pill.
- **A dog's Relatives:** every dog in the program ranked by relationship; tapping one
  opens the pair check.
- **Pair check** (any two dogs; any male × female from her kennel, outside studs or the
  network): the above plus traits, colors and DNA (§3.2–3.4).
- **Lines** (the redesign's Litters › Lines): a grid of her males × her females shaded by
  the litter COI each would give, the warnings that apply now (planned pairings, past
  litters over her line), and the insights of §3.5.

### 3.2 Traits: their own tables, a long-lived view of the dog

Not events: a trait value is what she thinks of the dog now, revised when she changes her
mind, and it drives decisions. The dated record stays where it belongs (an `evaluation`
event can still note a mentor's or judge's visit).

- **`trait_definitions`** (program-wide, her own list, D3): `name`, `group` (head,
  structure, movement, coat, temperament, other), `scale`, `low_label`/`high_label`,
  `breed` (blank = every breed), `score_on_puppies` (boolean), `sort_order`, `is_archived`.
- **Two scales** (`TRAIT_SCALE`), because many traits aren't "more is better":
  - `quality`: 1 (poor) to 5 (excellent): head, movement, coat, temperament.
  - `deviation`: −2 to +2, 0 = correct to the standard: back length short ← correct → long,
    ear set low ← correct → high, rear angulation straight ← correct → over-angulated.
  Pairing advice reads the deviation scale: a long-backed bitch needs a dog that is correct
  for back length, not one with a high number, and two dogs off in the same direction
  double the fault.
- **`dog_traits`**: one row per dog and trait (`[dog_id+trait_id]`): `value`, `note`,
  `assessed_by` (text: her, a mentor, a judge), `assessed_on`, and the **puppy value**
  `puppy_value` + `puppy_assessed_on` (D4: both kept, so she can see how her puppy
  evaluations hold up).
- **Light puppy scores before go-home:** traits marked `score_on_puppies` (usually 4–6)
  get one tap each on three choices: below / good / strong (stored 2 / 3 / 4) or low /
  correct / high (stored −1 / 0 / +1), on the same scale as the adult value so the two
  compare. **Score puppies** goes pup by pup like Weigh puppies; it's raised in This week
  when a litter reaches about 7 weeks and is an item on each pup's go-home checklist. The
  scores feed the keep / show prospect / pet decision and the waitlist's show-prospect
  matching.

### 3.3 Colors: her own list, enforced; genes shipped

- **`colors`** (program-wide): `name`, `kind` (`color` or `marking`), `genotype[]`
  (optional links to the shipped genes, e.g. `{ locus: 'E', alleles: 'e/e' }` for Yellow,
  `{ locus: 'B', alleles: 'b/b' }` for Chocolate), `sort_order`, `is_archived`. It starts
  empty; Kels's setup asks "What colors do your dogs come in?"
- **Everywhere a color is entered is a dropdown of her list** (a dog, a pup's birth record,
  waitlist color preferences) ending in **+ Add a color**, which adds to the list, so it
  stays consistent without blocking her mid-whelp.
- **Dog** gains `color_id` and `marking_ids[]`. `color_markings` stays (shipped field,
  backups) as display text; a Kels tidy-up matches existing text to her list for her to
  confirm (D11). Waitlist entries gain `pref_color_ids[]` beside `pref_colors`.
- **Shipped reference** `COAT_LOCI` in `vocab.js`: E (Eᴹ > E > e), K (Kᴮ > kᵇʳ > kʸ),
  A (aʸ > aʷ > aᵗ > a), B (B > b), D (D > d), S (S > sᵖ), M (M, m; M/M flagged), each with
  what the genotypes look like. Breed-specific loci can be added later.
- When she adds a color the app suggests a link ("Yellow is usually e/e. Link it?"). Only
  linked colors feed the inference in §3.5.

### 3.4 Breeding outcomes as structure

- **`birth_records`**, one per pup born, stillborn included (D5): `litter_id`,
  `birth_order`, `birth_time` (display string, like `placement_time`), `sex`, `color_id`,
  `marking_ids[]`, `birth_weight`, `born_alive`, `dog_id` (once it's a Dog), `died_on` +
  `death_cause` (`PUP_DEATH_CAUSE`: fading, crushed, congenital, unknown, other),
  `abnormalities[]` (`ABNORMALITY_TYPES` values), `notes`. Asked per pup on the Litter's
  **Births**, in Kels's Record a litter, and one pup at a time while she whelps. A live pup
  becomes a Dog with its sex and color carried over. The litter's `puppies_born_*` counts
  are written from the records (older builds keep reading them).
- **Whelping:** `Litter.csection_reason` (`LITTER_CSECTION_REASON`: uterine inertia,
  malpresentation, oversized pup, obstruction, dam distress, other), shown when the
  delivery type is a C-section; `Litter.dam_complications[]` (`DAM_COMPLICATION`:
  eclampsia, mastitis, metritis, retained placenta, hemorrhage, other).
- **DNA per marker:** `genetic_test` details gain `markers[]`: `{ marker, result }` with
  `MARKER_RESULT` (clear, carrier, affected) for health markers, and `{ locus, alleles }`
  for color loci. The old free `result` stays for older entries and display.
- **Breeding attempts:** conception comes from `Pairing.status` as it is; progesterone and
  ties stay events. Nothing new.

### 3.5 What becomes visible (all derived)

- **What each dog carries** (`data/coatGenetics.js`), never stored, so it follows every new
  litter: tested genotypes from DNA markers; then from her color links (a Yellow dog is
  e/e; a Black dog is at least E_ B_); then from relatives: a pup showing a recessive color
  means both parents carry it ("Ash carries yellow: 4 yellow pups in 3 litters"); a parent
  showing it means the dog carries it ("Titan carries yellow: his dam Fawn is yellow").
  **Contradictions** are flagged (a sire tested E/E with a yellow pup means a parentage or
  record error).
- **Possible colors for a pairing**, with the condition when a gene is unknown ("Yellow,
  if Titan carries e. A color test would tell you").
- **Carrier × carrier** for the same marker on a pairing (25% of pups affected on average).
- **Production per sire, dam and line:** litters, born, alive %, C-sections (with reasons),
  abnormalities, colors, conception rate. Always counts, never a bare percentage
  ("emergency C-section in 2 of Ivy's 3 litters"), and a pattern is raised only from two
  occurrences (D10). Repeats across dams are worded as something to look into ("cleft
  palate in 2 litters by Ash, with different dams"), never as proof of inheritance.
- **The program view** (Lines): trait averages across her breeding dogs and how many are
  off the standard per trait, trends by generation, diversity (average litter COI, how
  related her breeding dogs are to each other), the pipeline (females by age, who retires
  within two years, replacements kept), carrier frequency per marker, and gaps in plain
  words ("No male in your kennel is under 6.25% with Juniper; outside, Cassius is 0% with
  2 generations known").
- **Pairing finder** (`data/pairingFinder.js`): for one female, her males, outside studs
  and network dogs ranked by litter COI against D1, deviation traits corrected vs doubled,
  quality strengths where she's weak, carrier × carrier, pedigree depth and proven
  fertility. Every rank shows its reasons. It says a male *complements* her, never what the
  pups will look like.

### 3.6 Who sees what (program types)

Set by her program type (`docs/KennelOS_Program_Types_Plan.md` §3), never locked:
- **Show / preservation, working / performance and stud programs:** everything, Line
  tools on. These are the breeders who will use grading, the finder and line insights.
- **Family pet breeders:** warnings, Relatives, colors and birth records; Line tools
  (traits, puppy scores, insights, finder) off by default in Setup › What you use.
- **Doodle and mixed-breed programs:** as family pet, with colors and coat genes to the
  front; generation labels (F1, F1B, multigen) are a later addition Lines leaves room for.
- **Large or licensed kennels:** Line tools off by default (the owner's read, 2026-11-18:
  they are unlikely to use them); warnings and Relatives stay.

Pairing warnings and Relatives are never switched off.

## 4. Data model

| Change | Detail |
|---|---|
| New tables (a new `db.version(N)` block, only these) | `trait_definitions: 'id, breed, is_archived'`, `dog_traits: 'id, dog_id, trait_id, [dog_id+trait_id], is_archived'`, `colors: 'id, kind, is_archived'`, `birth_records: 'id, litter_id, dog_id, is_archived'`. Phases 2 and 3 ship them; if they ship apart, each its own version block. |
| New plain fields (no block) | Dog `color_id`, `marking_ids[]`; Litter `csection_reason`, `dam_complications[]`; WaitlistEntry `pref_color_ids[]`; `genetic_test` details `markers[]`. |
| Vocab (`data/vocab.js`) | `TRAIT_SCALE`, `COAT_LOCI`, `MARKER_RESULT`, `LITTER_CSECTION_REASON`, `DAM_COMPLICATION`, `PUP_DEATH_CAUSE`. |
| Repos (one thin repo each) | `traitDefinitionRepo`, `dogTraitRepo` (upsert by dog + trait), `colorRepo`, `birthRecordRepo`; writes call `settings.markDataChanged()`. |
| `referenceRegistry.js` | `dog_traits.dog_id` → dogs, `dog_traits.trait_id` → trait_definitions, `birth_records.litter_id` → litters, `birth_records.dog_id` → dogs, `birth_records.color_id` / `marking_ids` → colors, `dogs.color_id` / `marking_ids` → colors, `waitlist_entries.pref_color_ids` → colors. |
| `syncRegistry.js` | Every new field `pending` until D6; then `node cloud/scripts/cloud-fields.mjs > cloud/src/lib/cloudFields.js` and the live-sync table list. |
| Backups | New tables in the JSON export, optional on import (an older file has none). Check that older builds skip an unknown table, not only unknown fields, before Phase 2 ships. |
| Pure modules | `data/kinship.js`, `data/coatGenetics.js`, `data/lineInsights.js`, `data/pairingFinder.js`; no DOM, no db. |
| Guide | §15 loses "computed COI or relatedness" and "genotype or carrier-risk analysis" as each is built; data-model rows, invariants and vocab per phase. |

## 5. Decisions

| # | Question | Recommendation | Status |
|---|---|---|---|
| D1 | What warns | Parent and child, full siblings, half siblings; a litter COI over 12.5%; carrier × carrier on the same marker; a pedigree under 4 known generations flagged as thin. All set in Setup › Breeding program › Warnings. | Open |
| D2 | Warn or block | Warn, never block (linebreeding is a deliberate choice). Parent and child and full siblings ask her to confirm before the pairing saves. | Open |
| D3 | Trait lists | Her own list, like colors. Kels offers a starter of common structural traits she edits. No breed standards shipped. | Open |
| D4 | One value or puppy + adult | Both: an adult value and a puppy value per trait. | **Owner, 2026-11-18** |
| D5 | Pups who die | Birth records are their own table; only live pups become Dogs. Colors: her own list, enforced, asked at birth (**owner, 2026-11-18**). | Table: open |
| D6 | Privacy | Colors, trait definitions, dog traits and birth records are her program's own facts about her dogs, not other people's details: `cloud`, like most Dog fields, so her devices agree. | Open (a privacy decision) |
| D7 | Shared outward | Not on Dog Cards, the website or family pages at first; colors only where `color_markings` goes today. | Open |
| D8 | Inferred genetics | Derived each time, never stored; tested genotypes are stored (DNA markers). | Open |
| D9 | Editions | Warnings, Relatives, colors and birth records in every edition (safety, and Lite's litters need them); traits, puppy scores, Lines insights and the finder Pro-only (`proPages.js`). | Open |
| D10 | Small numbers | Always show counts; a pattern needs two occurrences; under three litters a rate reads "too few to say". | Open |
| D11 | Old color text | `color_markings` stays as display text; a Kels tidy-up maps it to her list for her to confirm. | Open |
| D12 | COI depth | Every known generation (no cap), with depth shown. | Open |

## 6. Phases

### Phase 1 — Relationships, COI and warnings (no schema)
- `data/kinship.js`: kinship, COI, relationship coefficient, relationship name, shared
  ancestors, pedigree depth. Tests: `tests/kinship.test.js` (parent/child = 25% litter
  COI, full siblings 25%, half siblings 12.5%, first cousins 6.25%, an inbred common
  ancestor, unknown parents, a cycle in imported data).
- Pairing form: relationship, COI and D1/D2 warnings in `updateWarnings()`; the Pairings
  list and a dog's pairings show the warning pill; Today raises a planned pairing over the
  line.
- Dog page: a Relatives section (every program dog ranked). A pair-check page for any two
  dogs. New page → `PRECACHE_URLS`.
- Docs: guide (kinship module, the warnings), this plan's status.

### Phase 2 — Colors and birth records
- Tables `colors`, `birth_records`; Dog `color_id`, `marking_ids[]`; Litter
  `csection_reason`, `dam_complications[]`; vocab; repos; registries.
- Color dropdown with + Add a color on the Dog form, birth records and waitlist
  preferences; Setup › Breeding program › Colors with the gene links and `COAT_LOCI`.
- The Litter's Births (record, edit, a live pup becomes a Dog); Kels's Record a litter asks
  per pup; counts written from records; the tidy-up for old color text.
- Tests: repos, counts from records, the dropdown's add, import/export round trip.

### Phase 3 — Traits and puppy scores
- Tables `trait_definitions`, `dog_traits`; Setup › Breeding program › Traits (her list,
  scale, Score on puppies); a dog's Traits (edit in place); Score puppies; the go-home
  checklist item; the This week nudge at about 7 weeks.
- Tests: upsert by dog + trait, puppy and adult values, scale mapping.

### Phase 4 — DNA markers and what dogs carry
- `genetic_test` `markers[]` entry (rows per marker; older results untouched);
  `data/coatGenetics.js` (tested → color links → relatives; contradictions; possible
  colors); carrier × carrier on the pair check and pairing form. A dog's Genetics.
- Tests: obligate carriers from offspring and parents, contradictions, unknowns.

### Phase 5 — Insights, Lines and the pairing finder
- `data/lineInsights.js` (production, line rates, trait averages and trends, diversity,
  pipeline, gaps) and `data/pairingFinder.js`; the Lines view; the finder from a female's
  hub and the pair check.
- Tests: counts and the D10 rules, ranking reasons.

## 7. Not in this plan
- Predicting how puppies will look, or estimated breeding values (polygenic traits need far
  more data than one program has).
- Shipping breed standards or color lists per breed.
- Importing lab files (Embark and others): a later integrations item; markers are typed in.
- Photos of dogs for grading.
- Generation labels for doodle programs (F1, F1B, multigen): Lines leaves room for them.
