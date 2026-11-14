# KennelOS — A dog's titles as a field (plan)

> **Status: plan, not built.** Open decisions are in §7 (D1 to D7); nothing is built until they're answered.
> This plan also covers KennelPort's hand-over "send pedigree-only ancestors' titles (and
> their import)" (2026-11-14). Its five asks are acceptance criteria here (§6).

## 1. The problem

A dog's titles exist today only as **`title_earned` events**. Each one is dated:
`event_date` is required by `eventRepo`. The show engine (`shared/data/showPoints.js`) works
out CH and GCH progress from `show` events, and the "Log the title?" nudge
(`nudges.js`, Show Tracking Spec §5.4) asks her to log a dated `title_earned` event when a
track completes.

That doesn't cover most of the titles a breeder actually has to record:

- **A dog bought already finished.** She knows it's "GCH CH", but not the date or the show.
- **Ancestors.** A pedigree-only grandsire is "GCHB CH" on the chart, and nobody is going to
  look up a show from 2012 to record that.
- **Titles the engine doesn't calculate** (CGC, JH, RN, foreign titles such as RKF or JR).

What happens today because of this:

- A pedigree chart import takes the titles off each name (`pedigreeParse.splitTitles`) and
  puts them only into notes as `Titles: GCHB CH`. No title data is stored.
- Some registered names still have their titles on the front ("GCH A-K Bella").
- KennelPort's `ancestors[].titles` (contract C7) comes from `titlesByDog`, which reads only
  `title_earned` events. So it's `[]` for almost every ancestor, and KennelPort can't work
  out whether a dog is Champion-descended.

## 2. The model: a field, plus the dated events feeding into it

**New plain field `Dog.titles`:** an ordered array of
`{ abbr, organization?, earned_on? }`.

- `abbr` is required. It's trimmed, with case and dots kept as she typed them.
- `organization` is optional, e.g. `AKC`.
- `earned_on` is optional, `YYYY-MM-DD`.
- The default is `[]`. There's no index (nothing queries it) and no schema block.
- It's on every dog, pedigree-only dogs included, in **every edition** (titles aren't a
  Pro-only feature; only show tracking is).

**The `title_earned` event is unchanged.** It stays the dated record ("earned CH at
Westminster, 3 Oct"), on the timeline, in reports and in the year summary.

**The dog's titles as shown and sent** come from one pure function,
`titlesOf(dog, events)` in a new `shared/data/dogTitles.js`:

- It's the union of `Dog.titles` and the dog's non-archived `title_earned` events.
- Two entries are the same title when their `abbr` matches (case and dots ignored) and
  their organizations match, or either organization is blank. The two are merged, and the
  merged entry takes the earlier known date.
- Order: dated titles by date, then undated ones in the order she listed them.

Every reader goes through `titlesOf`, so no data has to be copied:

- the dog page
- `titlesByDog` and `titleDetailsByDog` (the website, waitlist parent cards, the KennelPort
  feed)
- `lineageOf` (ancestors)
- the Dog Card
- the nudge check

Why a union at read time and not "an event writes the field":

- Nothing to back-fill for titles that are already logged as events.
- No two-way sync between two stores, so they can never disagree.
- An older build that has never heard of the field still shows its events.

The field holds what she typed. The events hold what was logged with a date. She sees
both as one list.

## 3. How the calculation updates or prompts the field

The calculation logic doesn't change. It reads the field in two places and writes nothing:

1. **Unlocking GCH.** `showRecordFrom`'s required-title date also looks at the dog's
   `titlesOf(...)`. A CH in the field with an `earned_on` counts like a logged CH event. A
   CH with **no date** unlocks GCH with `since = null`: every show aimed at GCH counts. A
   dog bought as a champion and shown for GCH then tracks correctly with no CH date.
2. **The "Log the title?" nudge** is suppressed when `titlesOf` already holds the track's
   title. Today only the event suppresses it. If she has typed "CH" on the dog, she isn't
   asked again.
3. **The nudge's action is unchanged.** It opens the `title_earned` form, pre-filled with
   the completing win's date. That event then shows up in the titles through the union.
   It never saves anything by itself (the decide-not-auto rule from spec §5.4 stays).

## 4. Where she fills it in

- **Dog form, a Titles row.** Chips she can add and remove. Each chip has an abbreviation,
  plus an optional organization and date behind a small "details" disclosure. Abbreviations
  are suggested from a list (`TITLE_SUGGESTIONS` in `vocab.js`, seeded from
  `pedigreeParse`'s `TITLES` set plus common suffix titles), but she can type anything.
- **Chips that come from an event** are shown read-only, with a link to that event. To
  remove one, she archives the event.
- **Dog page header and pedigree tree:** titles shown with the name, e.g. "GCH CH Bella"
  (display rule in §7, D3).
- **Pedigree chart import** collects two things for each dog it reads:
  - **Titles:** `splitTitles` output goes into `titles` on each dog it creates. It stops
    writing the `Titles:` notes line. On the review screen, each row shows its titles as
    chips she can edit before importing.
  - **Imported and country of origin:** when the registry the chart gives a dog is a
    foreign one (a new `REGISTRY_COUNTRIES` map in `vocab.js`, e.g. RKF → Russia, PKR →
    Poland, KCSB → United Kingdom), its review row shows "Imported from Russia" ticked,
    with the country editable. She sees it and can untick it before pressing Import, so
    it's never set without her (D7).
  - **Existing dogs:** a row that matches a dog already in the app only offers to add
    titles it doesn't have, and to tick Imported if it isn't ticked. Both are off by
    default. It never overwrites what she set.
- **The dog CSV import/export** gains a `titles` column, space-separated abbreviations
  (round-trips `GCH CH`).
- **Dog Card send/receive:** `titles` joins `DOG_FIELDS` as a new list kind. Old cards
  without it read as `[]`.

## 5. Existing data: a prompt she confirms, never a silent write

This is KennelOS asking her, in KennelOS. It isn't done at send time and it isn't done for
KennelPort. Nothing is written until she says yes.

- **Finding the dogs.** A pure check, `titlesWaitingInNotes(dogs, events)` in
  `dogTitles.js`, picks out every dog whose notes have a `Titles: …` line holding any
  abbreviation that isn't already in `titlesOf` for that dog. It also picks out any dog
  whose registered name starts with titles ("GCH A-K Bella", D5).
- **The nudge.** "Titles in notes (N dogs)." Key `titles-in-notes`, every edition. It
  clears itself once nothing is left to move. Its action opens the Kels task.
- **The Kels task, "Tidy up titles".** It's on the Kels menu and also reached from the
  nudge. One screen lists each dog, its titles as they'd be saved, and where they came from
  (notes, or the front of its name). She can untick a dog or a title. **Save** writes
  through `dogRepo.update` (so `markDataChanged` fires and it syncs). A name she ticks also
  has its titles taken off the front. Entries are deduped, so running it again, or on a
  second device, adds nothing.
- **The dog page:** a one-line "Titles in notes: GCHB CH. Add to titles?" with Add and
  Not now, for that one dog.
- **The notes line is left as it is** (D4).

## 6. KennelPort's asks → this plan

| KennelPort ask | Covered by |
|---|---|
| 1. Every ancestor's `titles` filled, abbreviations or `{abbr, organization, date}` (nulls allowed) | `lineageOf`, `titlesByDog` and `titleDetailsByDog` read `titlesOf`. A field-only title is sent with `date: null` (`ymd` already gives null). |
| 2. Titles stored as data, not just in notes | `Dog.titles` (§2), written by chart import (§4) |
| 3. Existing chart imports, once | §5: a KennelOS nudge plus a Kels task she confirms. KennelPort plays no part. |
| 4. Registered names that still carry titles | D5, and the same Kels task |
| 5. Offer Imported for a foreign registry | §4 chart import: pre-ticked on the review screen, which she confirms (D7) |

There's **no contract change**: same sections, same keys. KennelPort needs no release first.

## 7. Decisions for the owner

- **D1. A field, not undated `title_earned` events.** KennelPort's hand-over allows either.
  **Recommended: the field.** An event needs a date. An undated one would break timeline
  sorting, date-range reports and "titles earned this year", and it would be an event
  that records no occurrence.
- **D2. Sync class `cloud`.** **Recommended.** Titles are facts about the dog, like
  `registry`, and `title_earned` events already go to the cloud. This is a privacy call,
  so it needs your yes.
- **D3. Display order.** AKC puts titles before the name (CH, GCH) and some after it (CGC,
  JH). **Recommended:** a built-in suffix list (CGC, TKN, JH, RN, …), so a title on it goes
  after the name and every other title goes before it. There would be no per-title setting
  for her.
- **D4. The `Titles:` notes line after the back-fill.** **Recommended: leave it.** It's her
  note, and the hand-over says to keep it if she relies on it. New imports stop writing it.
- **D5. "GCH A-K Bella"-style names.**
  - **(a)** Split them when sending to the website (non-destructive).
  - **(b)** Also offer to clean the name in the §5 tidy-up ("Move GCH to titles?").
  - **Recommended: (a) + (b).** It never silently rewrites a registered name.
- **D7. Which registries count as foreign.** A chart only gives a registry code, and some
  codes are ambiguous: CKC is both the Canadian and the Continental Kennel Club. UKC,
  CKC-Continental and AKC are home registries to a US breeder.
  - **Recommended:** a registry counts as foreign only when it's in `REGISTRY_COUNTRIES` and
    isn't the registry most of her own (non-pedigree-only) dogs use.
  - Ambiguous codes like CKC stay off the map, so they're never pre-ticked.
  - A registry not on the map leaves the box unticked. She can still tick it.
- **D6. The show-tracking design rule** (Show Tracking Spec §4, guide §4.2: "no
  `Dog.titles` field"). **Recommended:** keep it for points and majors, and relax it for
  titles. The guide and spec get a **Modified:** note: titles held are stored, progress is
  derived.

## 8. Steps

1. **Pure core:** `dogTitles.js` (`titlesOf`, `normalizeAbbr`, the merge), plus
   `tests/dogTitles.test.js`.
2. **Data layer:**
   - accept and validate `titles` in `dogRepo`
   - add `titles` to `syncRegistry` (regenerate `cloud/src/lib/cloudFields.js`)
   - backup import/export (an optional field defaulting to `[]`, so no format bump)
   - CSV column
   - Dog Card list kind
3. **Readers:**
   - `titlesByDog`, `titleDetailsByDog` and `lineageOf` through `titlesOf`
   - `showRecordFrom` required-title date
   - nudge suppression
   - display name with titles (D3)
4. **Pedigree chart import:**
   - It writes `titles`, plus the KennelPort test: grandsire "GCH CH X" → `ancestors` at
     `sire.sire` has `titles: ["GCH", "CH"]`.
   - The review screen gets the titles chips and the Imported and country choice (§4,
     D7), with `REGISTRY_COUNTRIES` added to `vocab.js`.
   - Tests: a foreign-registry ancestor comes through pre-ticked, an AKC one doesn't, and
     unticking it saves `imported: false`.
5. **UI:** the dog form's Titles row and the dog page header.
6. **The tidy-up (§5):** `titlesWaitingInNotes`, the `titles-in-notes` nudge, the Kels task
   "Tidy up titles", and the dog page's one-line offer.
7. **Docs:**
   - End-State guide: the Dog fields, a `dogTitles.js` entry, §35 website feed, Show
     Tracking **Modified:** note
   - editions doc: titles in all editions
   - `shared/sw.js` `PRECACHE_URLS` gains `data/dogTitles.js`
