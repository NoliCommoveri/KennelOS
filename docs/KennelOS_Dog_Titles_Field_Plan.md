# KennelOS — A dog's titles as a field (plan)

> **Status: plan, not built.** Open decisions are in §7 (D1 to D8); nothing is built until they're answered.
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
  - **Country of origin (D8):** when the registry the chart gives a dog is a foreign one
    (a new `REGISTRY_COUNTRIES` map in `vocab.js`, e.g. RKF → Russia, JR → Serbia, PKR →
    Poland, KCSB → United Kingdom), its review row shows the country filled in. She can
    edit or clear it before pressing Import (D7).
  - **Imported, suggested at the boundary (D8):** on each line of the chart, the dog
    nearest the subject that holds a home registration (her home registry, D7) but whose
    parent is foreign-registered is the likely import. Its review row offers "Imported
    from Serbia?":
    - **always unticked**, even when the chart shows both a home and a foreign number for
      that dog. AKC gives a foreign frozen-semen sire its own AKC number too, so having
      both numbers doesn't prove the dog came over (D8)
    - a home-registered pup of a foreign parent may also be from a frozen-semen or in-utero
      litter, so the offer explains what Imported means ("came to live in the US")
    - never offered on a dog with only a foreign registration: a chart can't say it left
      its country
  - **Existing dogs:** a row that matches a dog already in the app only offers what it
    doesn't have yet: missing titles, a blank country of origin, an unticked Imported. All
    three start unticked, and it never overwrites what she set.
- **The dog CSV import/export** gains a `titles` column, space-separated abbreviations
  (round-trips `GCH CH`).
- **Dog Card send/receive:** `titles` joins `DOG_FIELDS` as a new list kind. Old cards
  without it read as `[]`.

## 5. Existing data: part of Kels's Tidy up my records

This is KennelOS asking her, inside the existing **Tidy up my records** task (guide §33,
`tidyRules.js` + `tidyUpUI.js`). It isn't done at send time and it isn't done for
KennelPort. Nothing is written until she says yes. There's no new task, no new nudge and no
Today card: tidy-up checks run only inside Kels.

- **Two new finding kinds in `TIDY_KINDS`,** placed after `dog-no-parents`, both in every
  edition:
  - `dog-titles-in-notes`: a dog (pedigree-only included) whose notes have a `Titles: …`
    line holding an abbreviation that isn't already in `titlesOf` for that dog.
  - `dog-titles-in-name`: a dog whose registered name starts with titles ("GCH A-K Bella",
    D5).
- **One finding per kind for all the dogs, not one per dog.** A chart import can leave
  dozens of ancestors, and asking about them one at a time would be tedious. This works the
  way `event-no-vet` groups its events.
- **What the finding shows:** each dog, the titles as they'd be saved, ticked. She can untick
  a dog or a title, then answer **Add to titles** or **Not now**, or **Don't ask again**
  (the usual `tidy:` key).
- **The finding key** comes from the dogs and titles in it, so a new import raises it again.
- **Saving** writes through `dogRepo.update`, so `markDataChanged` fires and it syncs. For
  the name finding, the titles also come off the front of the name. Entries are deduped,
  so answering on a second device adds nothing.
- **The rules are pure functions in `tidyRules.js`** (`titlesInNotesFindings`,
  `titlesInNameFindings`), using `dogTitles.js`, and they join `tidyFindings`.
  Tests go in the tidy-up's suite.
- **The notes line is left as it is** (D4).

## 6. KennelPort's asks → this plan

| KennelPort ask | Covered by |
|---|---|
| 1. Every ancestor's `titles` filled, abbreviations or `{abbr, organization, date}` (nulls allowed) | `lineageOf`, `titlesByDog` and `titleDetailsByDog` read `titlesOf`. A field-only title is sent with `date: null` (`ymd` already gives null). |
| 2. Titles stored as data, not just in notes | `Dog.titles` (§2), written by chart import (§4) |
| 3. Existing chart imports, once | §5: two new checks in Kels's Tidy up my records, which she confirms. KennelPort plays no part. |
| 4. Registered names that still carry titles | D5, and the same tidy-up |
| 5. Offer Imported for a foreign registry | §4 chart import: country of origin from a foreign registry, and Imported suggested only at the boundary dog (D7, D8), which she confirms |

The titles work needs **no contract change**: same sections, same keys, and KennelPort
needs no release first. **Country of origin does need one** (D8, §6.1).

### 6.1 Note for KennelPort: country of origin

To send to KennelPort with this plan.

- **What changes in KennelOS.** A dog gains a country of origin that stands on its own,
  without Imported. A Serbian ancestor that never left Serbia has country Serbia and
  `imported: false`. Today C4 sends `import_country` only while `imported` is ticked, so
  that ancestor goes out with no country.
- **The contract ask.** A new optional section, `origin_country`, adds `country_of_origin`
  (text or null) to each dog and each C7 ancestor.
  - `imported` and `import_country` stay exactly as C4 has them.
  - A Worker that doesn't take the section gets what it gets now.
- **What "Import-descended" should mean, as the owner defines it:** the dog itself is born
  in her country, some ancestor was imported, and the bloodlines beyond that ancestor are
  foreign. Breeders advertise both, so KennelPort could offer two tag conditions:
  - **Import-descended:** an ancestor within the owner's generations has
    `imported: true`.
  - **Foreign bloodlines:** an ancestor within the owner's generations has a
    `country_of_origin` other than the breeder's own.
- **Still KennelPort's to work out.** KennelOS keeps sending facts as she set them. It
  never sends a worked-out "import-descended".

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
  - **Source the map from the FCI's published list of studbook initials**
    (`FCI-LDO-23747.pdf` on fci.be), plus the non-FCI registries (KC/KCSB United Kingdom,
    CKC Canada is ambiguous, ANKC Australia, NZKC New Zealand, JKC Japan), not from
    memory.
    - Confirmed by search 2026-11-14: VDH Germany, LOF France, RKF Russia, LOI Italy
      (with an appendix code), PKR Poland (with an older code beside it).
    - **Not yet confirmed:** JR Serbia, MET Hungary, LOE Spain.
    - fci.be and akc.org aren't reachable from the build session's network, so the list
      needs either those hosts allowed or the PDF supplied.
  - Ambiguous codes like CKC stay off the map, so they never fill in a country.
  - A registry not on the map leaves the country blank. She can still type one.
- **D6. The show-tracking design rule** (Show Tracking Spec §4, guide §4.2: "no
  `Dog.titles` field"). **Recommended:** keep it for points and majors, and relax it for
  titles. The guide and spec get a **Modified:** note: titles held are stored, progress is
  derived.
- **D8. Country of origin as its own fact, apart from Imported.** **Agreed with the owner
  2026-11-14:** an ancestor from Serbia that's still in Serbia isn't an import, but it does
  have a country of origin.
  - **A new plain field `Dog.country_of_origin`** (text, optional; cloud, a fact like
    `registry`). The Dog form always shows it as **Country of origin**, beside the registry
    fields.
  - **`imported` keeps its meaning:** brought into her country. While it's ticked, the form
    also writes the country into the shipped `import_country`, so older builds and the C4
    feed work unchanged. No shipped field is renamed or given a new meaning.
  - **Reading a dog's country:** `country_of_origin`, else `import_country` when
    `imported`. That covers the dogs she has already marked imported, with no migration.
  - **The chart import** fills in the country from the registry and suggests Imported only
    at the boundary dog (§4).
  - **The boundary rule is a likely sign, not a fact.** The first home-registered dog on a
    line whose parent is foreign is usually the import, but not always:
    - **Frozen semen.** AKC registers a litter by a foreign sire only once the sire has
      been through its foreign registration. So a sire that never left Serbia can still
      have an AKC number, and his pups are born in the US.
    - **In-utero imports.** The dam is imported in whelp, and the pups are born and
      registered in the US.
    - **What AKC's own rules confirm (checked 2026-11-14):** an imported dog is registered
      under the name on its foreign certificate, from a pedigree issued in its country of
      birth. The FCI's rules have the new studbook's number written onto the export
      pedigree, so an import usually carries both numbers.

    Imported is therefore only ever offered unticked, at the boundary dog, and she
    decides. Country of origin, which a foreign registry does establish, is filled in.
  - **Worth keeping a second registration:** `parseDetails` keeps the first registration
    it finds and may put a second one in notes. Keeping both (the second into
    `additional_registrations`) means a dual-registered dog gets both numbers and its
    foreign registry gives its country of origin. That's a fact worth having even though
    it doesn't settle Imported.
  - **Website:** the new `origin_country` section, which needs KennelPort (§6.1).

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
   - The review screen gets the titles chips, the country of origin and the boundary
     Imported suggestion (§4, D7, D8), with `REGISTRY_COUNTRIES` added to `vocab.js`.
   - `parseDetails` keeps a second registration into `additional_registrations`.
   - Tests:
     - a JR-registered ancestor gets country Serbia and `imported: false`
     - an AKC dog with JR parents is offered Imported unticked
     - an AKC + JR dual-registered dog keeps both numbers, gets country Serbia, and is
       still offered Imported unticked
     - an AKC line gets neither
4a. **Country of origin (D8):**
   - the field in `dogRepo`, `syncRegistry` (cloud, regenerate `cloudFields.js`), backup,
     CSV and Dog Card
   - the Dog form row, with `import_country` kept in step while Imported is ticked
   - the `origin_country` website section once KennelPort takes it (§6.1)
5. **UI:** the dog form's Titles row and the dog page header.
6. **The tidy-up (§5):**
   - the `dog-titles-in-notes` and `dog-titles-in-name` kinds and their rules
   - the finding screen in `tidyUpUI.js`
   - Kels's knowledge text for the tidy-up
7. **Docs:**
   - End-State guide: the Dog fields, a `dogTitles.js` entry, §35 website feed, Show
     Tracking **Modified:** note
   - editions doc: titles in all editions
   - `shared/sw.js` `PRECACHE_URLS` gains `data/dogTitles.js`
