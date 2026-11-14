# KennelOS — A dog's titles as a field (plan)

> **Status: decided, not built.** All decisions made (§7). The build runs in six phases (§8); see its Status line.
> The registry codes, AKC import rules and AKC title lists it relies on are in
> `docs/KennelOS_Registry_Title_Facts.md` (a fact check against FCI and AKC sources,
> 2026-11-14).
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
  are suggested from a list (`TITLE_SUGGESTIONS` in `vocab.js`: AKC's published prefix and
  suffix titles, plus `pedigreeParse`'s `TITLES` set), but she can type anything.
- **Chips that come from an event** are shown read-only, with a link to that event. To
  remove one, she archives the event.
- **Dog page header and pedigree tree:** titles shown with the name, e.g. "GCH CH Bella"
  (display rule in §7, D3).
- **Pedigree chart import** collects two things for each dog it reads:
  - **Titles:** `splitTitles` output goes into `titles` on each dog it creates. It stops
    writing the `Titles:` notes line. On the review screen, each row shows its titles as
    chips she can edit before importing.
    - `TITLES` (the prefixes `splitTitles` strips) gains AKC's full prefix list, so more
      of a chart's titles are caught.
    - On an AKC Certified Pedigree the titles' organization is AKC: AKC prints no foreign
      titles on its documents. On any other chart the organization is left blank.
  - **Country of origin (D8):** when the registry the chart gives a dog is a foreign one
    (`REGISTRY_COUNTRIES`, D7, e.g. JR or JUR → Serbia, RKF → Russia, MET → Hungary), its
    review row shows the country filled in. She can edit or clear it before pressing
    Import.
  - **Imported, suggested by the parents' registrations (D8).** For each dog the chart
    gives a home registration (her home registry, D7), look at its parents:
    - **Both parents have only foreign registrations:** the dog is the likely import.
      Its review row shows "Imported from Serbia" **pre-ticked**, with the country
      editable. She can untick it before pressing Import.
    - **One parent is foreign, the other home-registered:** the dog was most likely born
      at home, from frozen semen, a mating abroad or a dam imported in whelp. Imported is
      offered, **unticked**. The home-registered parent is checked on its own line.
    - **A dog with only a foreign registration:** never offered Imported, because a chart
      can't say it left its country. It only gets its country of origin.
    - **A dog with a home and a foreign number** (dual-registered): treated like "both
      parents foreign", so pre-ticked.
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
| 5. Offer Imported for a foreign registry | §4 chart import: country of origin from a foreign registry, and Imported suggested from the parents' registrations (D7, D8), which she confirms on the review screen |

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
- **D3. Display order.** AKC: "Most titles go at the end of a dog's registered name. The
  exceptions are championship titles."
  - **Recommended:** a built-in **prefix** list, `TITLE_PREFIXES` in `vocab.js`: AKC's
    published prefix titles (CH, GCH/B/S/G/P, DC, FC, AFC, MACH, OTCH, …) plus the
    championship and show-win abbreviations charts print in front (INT, MBIS, BIS, …,
    from `pedigreeParse`'s `TITLES`). A title on the list goes before the name; every
    other title goes after it, AKC's default.
  - A repeat number stays on the title (GCHP2, UDX2). It counts as the same title as
    GCHP when matching, e.g. for the nudge.
  - Within each side, titles keep her order (or the chart's). AKC publishes no rule for
    ordering several titles on one side.
  - There's no per-title setting for her.
- **D4. The `Titles:` notes line after the back-fill.** **Recommended: leave it.** It's her
  note, and the hand-over says to keep it if she relies on it. New imports stop writing it.
- **D5. "GCH A-K Bella"-style names.**
  - **(a)** Split them when sending to the website (non-destructive).
  - **(b)** Also offer to clean the name in the §5 tidy-up ("Move GCH to titles?").
  - **Recommended: (a) + (b).** It never silently rewrites a registered name.
- **D7. Which registries count as foreign.** A chart gives only a registry code.
  - **`REGISTRY_COUNTRIES` in `vocab.js`** maps each code to a country, from the FCI's list
    of studbook initials (footer 28-09-26) and the non-FCI registries in the fact check
    (§1a and §1b of `docs/KennelOS_Registry_Title_Facts.md`). It includes:
    - every **studbook and appendix code**: an appendix-registered dog is still from that
      country (JR and JUR → Serbia, RKF and RKF R. → Russia, LOE and RRC → Spain)
    - **older codes still seen on pedigrees**: Italy LOI/LIR, Poland PKR/KW, Sweden S,
      Slovakia SHPK, Israel ISBR
    - the main non-FCI registries: KC → United Kingdom, ZA → South Africa, ANKC → Australia,
      NZKC → New Zealand, UKC and AKC → United States
  - **Off the map on purpose:**
    - **CKC**, which is both the Canadian and the Continental Kennel Club
    - **KCSB**, which is a third-party abbreviation, not the Kennel Club's own
    - the few FCI rows the fact check couldn't place for certain: Bahrain/Bolivia KCB,
      Costa Rica ACC/CR, Cuba FCC/LGC

    An unmapped registry leaves the country blank, and she can type one.
  - **Matching** is on the whole code as printed, ignoring case and a trailing dot. KC
    doesn't match KCC (Chile) or KCU (Uruguay).
  - **Foreign** means mapped to a country other than her home country. Her home country is
    the country of the registry most of her own (non-pedigree-only) dogs use, else the
    United States.
  - **The chart reader's code pattern needs widening.** `isOtherReg` only takes 2 to 5
    plain capital letters. Codes like ÖHZB, ČLP, CMKU, AESKC, LOMAD, K.C.B., KIF- and
    NIC-F need accented letters, dots and hyphens, and the full list's codes go in its
    tests.
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
  - **The chart import** fills in the country from the registry and suggests Imported from
    the parents' registrations (§4).
  - **Why the parents' registrations are the sign** (fact check §2):
    - An imported dog is registered with AKC under the name on its foreign certificate,
      from the pedigree of its country of birth, so it has a home number and foreign-only
      parents.
    - A **foreign sire used by frozen semen who never came to the US is not registered**:
      "We will not register the sire, but we will use the information provided to
      register the litter." His pups have a home number, one foreign parent and one home
      parent.
    - A sire whose semen was collected in the US must be AKC-registered first. Such a dog
      was here, so dual-registered counts as a likely import.
    - A **dam imported in whelp** must be AKC-registered before her litter. She's the
      import (home number, foreign parents), and her US-born pups have one foreign
      parent (the sire), so they aren't flagged.
  - **It's still a sign, not a proof.** Whether AKC pedigrees print an import's foreign
    number, and how they show foreign ancestors, is unconfirmed. So every suggestion shows
    on the review screen for her to confirm or untick, and nothing is set behind her back.
  - **Keeping a second registration:** `parseDetails` keeps the first registration it
    finds and may put a second one in notes. It now keeps the second too, in
    `additional_registrations`, which is how a dual-registered dog is spotted.
  - **Website:** the new `origin_country` section, which needs KennelPort (§6.1).

## 8. Build phases

**All decisions are made:** D1–D7 as recommended (owner, 2026-11-14), and D8 as agreed.
The build runs in six phases, each one a session's worth of work.

Each phase:
- ends with `node --check` on the touched files, `node --test` passing, and a
  `docs/BUILD_LOG.md` entry
- is committed and pushed, then this section's **Status** line is updated
- updates the End-State guide for what it built, in the same change (CLAUDE.md)
- adds any new file to `PRECACHE_URLS` in `shared/sw.js` in the same edit

No phase bumps `CACHE_NAME`. Ask the owner once the batch is ready to ship.

**Status:** no phase started. Nothing was coded before this split.

### 8.0 Findings from reading the code (carry into every phase)

- **AKC Certified Pedigrees already mark foreign-born dogs.** The detail line of an
  AKC-registered dog born abroad carries the country in brackets, e.g. "(SRB)" or
  "(Canada)", usually next to an AKC DNA number (AKC requires DNA for imports). See
  `tests/pedigreeParse.test.js`, "certified details".
  - `parseDetails` and `parseRunOn` currently turn it into a notes line, `Registered in SRB`.
  - It's the best country-of-origin source on an AKC chart.
  - A home-registered dog with a bracketed country is the strongest Imported sign there
    is, so it's **pre-ticked** (§4), next to "both parents foreign-only" and
    "dual-registered".
- **Serbian charts print `KSS JR 71592 BST`** (the test fixture): KSS (the Serbian kennel
  union) comes before the JR studbook code. Map **KSS → Serbia** as well as JR and JUR.
- **`pedigreeParse.js` is deliberately import-free.** Where things go:
  - **The prefix-title list** (D3) lives there: its `TITLES` set, exported as
    `TITLE_PREFIXES` and extended with AKC's full prefix list (fact check §3).
    `splitTitles` also accepts a repeat number (GCHP2, MACH3).
  - **The registry map** goes in a new pure, import-free module,
    **`shared/data/registryCountries.js`**, not `vocab.js`. `pedigreeParse.js` and
    `dogTitles.js` both import it. It holds:
    - `REGISTRY_COUNTRIES` (country → codes)
    - `countryOfRegistry(code)`, which uppercases, drops dots and a trailing hyphen,
      and matches the whole code
    - an ISO alpha-3 → country name map for the bracketed codes ("SRB" → Serbia)
    - `countryName(text)` (an ISO-3 code → its name, else the text as printed)
    - `homeCountry(dogs)` (D7)
  - **Ambiguous codes are left out:** CKC, KCSB, KCB / K.C.B., FCG / F.C.G. (Georgia and
    Guatemala), ACC/CR, FCC/LGC, LPB, and single letters other than S.
- **What `dogTitles.js` does:**
  - **`abbrKey`** uppercases and drops dots and spaces, so `H.CH` = `HCH`.
  - **Two entries are the same title** when their keys match and their organizations
    match, or either organization is blank.
  - **`titlesOf(dog, events)`** merges three sources, each entry tagged with where it
    came from:
    - `field`: `Dog.titles`
    - `event`: non-archived `title_earned` events (`event_id`)
    - `name`: titles on the front of `registered_name` (D5a)

    A matching event merges into the field entry and gives it the earliest known date.
  - **Display order:**
    - The field's own order comes first. That's the order she or the chart arranged,
      e.g. "GCHB CH".
    - Event-only **prefix** titles are put in front of the field's prefixes, newest
      first. So a bought CH that later logs a GCH shows as "GCH CH".
    - Event-only **suffix** titles go after the field's suffixes, oldest first.
  - **`displayName(dog, titles)`** gives `prefixes + name without its front titles +
    suffixes`.
  - **Feed order** (`titles_detail`): dated titles by date, then undated ones in display
    order.
  - **`holdsTitle(list, 'GCH')`** also accepts a repeat number (GCH2), for the show
    engine and the nudge only.
  - **`normalizeTitles(list)`** stores `{ abbr, organization, earned_on }`:
    - `''` for any blank part
    - `abbr` trimmed and at most 30 characters, organization at most 60
    - `earned_on` kept only if it's `YYYY-MM-DD`
    - blank abbreviations dropped and duplicates merged

    `dogRepo` runs it on every write that carries `titles`, like
    `normalizeRegistrations`.
- **The show engine:**
  - `trackProgress` takes a `requiredHeld` option, so a held, undated CH unlocks GCH
    with every GCH-aimed show counting.
  - `showRecordFrom(events, tracks, { held })` also takes `Dog.titles`. A held entry
    with `earned_on` counts like a logged event. Each row gets `heldTitle`.
- **No dog CSV export exists.** Only the CSV *import* gains columns. The backup already
  copies dog rows whole, so it needs nothing beyond the fields defaulting when missing.

### Phase 1: Core and data layer (no UI)

- `registryCountries.js` and `dogTitles.js` (§8.0), plus
  `tests/registryCountries.test.js` and `tests/dogTitles.test.js`.
- `pedigreeParse.js`: `TITLE_PREFIXES` (the extended `TITLES`), with repeat numbers in
  `splitTitles`. Extend `tests/pedigreeParse.test.js`.
- `dogRepo`: normalize `titles` and trim `country_of_origin` on every write that carries
  them.
- `syncRegistry` dogs.cloud: add `titles` and `country_of_origin` (D2 and D8, both
  agreed). Then run
  `node cloud/scripts/cloud-fields.mjs > cloud/src/lib/cloudFields.js` and
  `cd cloud && npm test`.
- Dog Card `DOG_FIELDS`:
  - `titles` (a new `titles` kind, compared through `normalizeTitles`; supplied when
    non-empty), from the field only, since events already travel as events
  - `countryOfOrigin` (text)
  - Old cards read both as empty.
- CSV dog import:
  - `titles`: space- or comma-separated abbreviations. On update it's add-only, so it
    never drops a title she has.
  - `country_of_origin`
  - Add both to `csvImportHelp.js`.
- `PRECACHE_URLS`: `data/dogTitles.js` and `data/registryCountries.js`.
- Guide: the Dog row in the data model (both fields), the module entries.

### Phase 2: Readers and display

- `waitlistProjection.titlesByDog(events, dogs)` and
  `siteExport.titleDetailsByDog(events, dogs)` go through `titlesOf`. Update every caller
  (siteExport `buildSiteBundle`, waitlist `parentView`) and their tests.
- `lineageOf`: ancestors' titles go through the same maps, which is KennelPort's ask 1.
  Add the KennelPort test: chart grandsire "GCH CH X" → `ancestors` at `sire.sire` has
  `["GCH", "CH"]`.
- D5a: `registered_name` is sent without the titles on its front, on dogs and
  ancestors; those titles go into `titles`.
- The `origin_country` section: `country_of_origin` (`country_of_origin`, else
  `import_country` when imported) on each dog and ancestor, sent only when the site's
  Worker lists the section. Update the Website Contract Plan (a new C-row) and guide §35.
- `showPoints`: the `held` and `requiredHeld` options (§8.0), plus tests (an undated
  held CH unlocks GCH, a dated one gates like an event).
- `nudges.js`: pass `d.titles`, and skip when `titleEvent || heldTitle`.
- `dog.js` (dog page): show the header name with titles (`displayName`). The show
  record card says "Held" for a field title with no date.
- The pedigree tree and pedigree page show names with titles, where they show a name.
- `dogCard.js` and the Dog Card page: nothing more than phase 1.

### Phase 3: Dog form

- **A Titles row of chips:**
  - **Field titles** can be added and removed, each with an abbreviation and, behind a
    "details" disclosure, an organization and an earned-on date.
  - **Event titles** are read-only, each linking to its event.
  - **Name titles** say "in the registered name".
  - **Suggestions** come from `TITLE_PREFIXES` plus a suffix suggestion list in
    `dogTitles.js` (AKC's suffix list, fact check §3), via `<datalist>`.
- **A Country of origin row:**
  - always shown, next to Imported
  - shown on the view as "Country of origin"
  - while Imported is ticked, the form writes the same country into `import_country`
  - the existing "Country of origin" box shown only while Imported is ticked becomes
    this one row
- Every user value goes through `esc()`.

### Phase 4: Pedigree chart import

- `toDog` gives `titles` (from `splitTitles`) and stops writing the `Titles:` notes line.
  On an AKC Certified Pedigree (the header says so) the organization is AKC; otherwise
  it's blank.
- Country of origin comes from the bracketed country first (`countryName`), then the
  registry code (`countryOfRegistry`), then blank. Remove the `Registered in …` notes
  line once that's in the field? **No: keep it** (it's her chart's text, D4's
  reasoning).
- Widen `isOtherReg` (and the registry capture in `parseDetails`) to every code on the
  map, and keep a second registration in `additional_registrations`.
- Imported, as worked out over the chart's tree:
  - **pre-ticked:** home registry plus a bracketed foreign country, or both parents
    foreign-only, or dual-registered
  - **unticked offer:** home registry with one foreign parent
  - **none:** foreign-only, or an all-home line

  "Home" is `homeCountry(dogs)`.
- Review screen (`pedigree-import.js`): titles chips, the country and the Imported tick
  for each new dog.
  - For a match to an existing dog, it only offers what that dog lacks (missing titles,
    a blank country, an unticked Imported), each unticked.
  - `pedigreeImport.js` saves them.
- Tests: §8 step 4's list, plus "(SRB) on an AKC dog → Serbia, pre-ticked" and
  "KSS JR → Serbia".

### Phase 5: Tidy up my records

- `tidyRules.js`: the `dog-titles-in-notes` and `dog-titles-in-name` kinds after
  `dog-no-parents`, with `titlesInNotesFindings` and `titlesInNameFindings`. One grouped
  finding each, keyed by its dogs and titles, joined into `tidyFindings`, in every
  edition.
- `tidyUpUI.js`: the finding screen. One list with ticks, then Add to titles, Not now,
  or Don't ask again. The name finding also takes the titles off the front of the name.
  Writes go through `dogRepo.update`.
- Kels's knowledge text (`kelsKnowledge.js`) for what the tidy-up now checks.
- Tests in the tidy-up suite.

### Phase 6: Docs and close

- Show Tracking Spec §4 and guide §4.2: a **Modified:** note (D6). Titles held are stored;
  points and progress stay derived.
- The editions doc and guide §0: titles and country of origin are in every edition. The
  show nudge stays Pro.
- This plan's status → built. Update the README Status line (and the Website Contract
  Plan if `origin_country` is waiting on KennelPort).
- Run `node build/assemble.mjs`, `node --test`, and `cd cloud && npm test`. Check the dog
  page, Dog form, pedigree import and tidy-up in the browser (`/shared/`).
- Ask the owner about the `CACHE_NAME` bump.

### 8.1 Earlier step list

These are kept for the test lists phase 4 refers to.

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
   - The review screen gets the titles chips, the country of origin and the Imported
     suggestion (§4, D7, D8). `REGISTRY_COUNTRIES` and `TITLE_PREFIXES` are added to
     `vocab.js`, and `TITLES` is extended.
   - `isOtherReg` is widened to every code on the map (D7).
   - `parseDetails` keeps a second registration in `additional_registrations`.
   - Tests:
     - a JR ancestor gets country Serbia and `imported: false`, and is never offered
       Imported
     - a JUR (appendix) ancestor also gets Serbia
     - an AKC dog with two JR parents is offered Imported pre-ticked
     - an AKC dog with a JR sire and an AKC dam is offered it unticked
     - an AKC + JR dual-registered dog keeps both numbers, gets Serbia, and is pre-ticked
     - an all-AKC line gets nothing
     - a CKC dog gets no country
     - KC doesn't match KCC
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
