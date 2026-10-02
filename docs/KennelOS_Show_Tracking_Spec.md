# KennelOS — Show Tracking Slice Spec (Pro)

> **Status: planned — not built.** This is the authoritative target for tracking
> conformation show history, current championship points, and the
> location / handler / schedule of upcoming shows. Read alongside
> `docs/End_State_Design_and_Maintenance_Guide.md` (the map of the `shared/` code
> this touches — §8 Event model, §13 pages, §19 nudges & away board, §21 Financials)
> and `docs/KennelOS_Lite_Pro_Editions_Plan.md` (the edition rules §7 depends on).
>
> **No schema change.** Everything here rides the existing polymorphic `events`
> table, its existing indexes, and its existing `related_contact_id` FK — so this
> slice is not time-boxed by the pre-release `db.version(1)` window.

---

## 1. Decisions

**Locked (owner-confirmed):**

1. **Pro-only.** Lite ships none of it — no Shows page, no `show` event type in the
   event form or CSV importer, no points card, no Today card or nudge.
2. **AKC first.** The only title tracks at launch are AKC Champion (CH) and AKC Grand
   Champion (GCH). UKC/CKC/FCI and the GCH levels (Bronze and up) come later as
   additional `TITLE_TRACKS` rows (§4) — no structural change needed.
3. **One record per dog per show day.** AKC awards points per show, so an event per
   show day is the unit that makes points correct. A four-day cluster with two dogs
   is eight events.

**Defaults taken (pushback welcome before build):**

4. **Away board — no automatic rows in v1.** A dog travelling with a handler is
   logged the way any other stay is: a `boarding` event. This slice only adds
   `'With handler / show circuit'` to `BOARDING_REASON_SUGGESTIONS`. Deriving away
   rows from show events is an open door (§11).
5. **One cost per show event.** The existing event→Expense link (guide §21: one
   Expense carrying `event_id`) holds the entry fee *or* the per-show handling fee.
   Weekend handler invoices are logged as ordinary expenses against the dog. A split
   entry-fee/handler-fee pair per event is an open door (§11).

**Settled by existing rules (not re-litigated here):**

- Show history goes in the one `events` table — **no** `shows` / `show_entries` /
  `show_results` table (CLAUDE.md: "One Event table for all dated history … no
  per-type tables").
- **Points are derived, never stored** (guide §4.2). There is no `Dog.points`,
  `Dog.titles`, or "is major" field anywhere; see §4.
- The handler is the canonical top-level `events.related_contact_id` FK, never a
  `details` value (guide §8).

---

## 2. The `show` event type

One new entry in `EVENT_TYPES` (`shared/data/vocab.js`):

```js
{ value: 'show', label: 'Show', badge: 'badge-purple', subjects: ['dog'],
  duration: 'instant', relatedContact: true, editionFlag: 'shows',
  fields: [ /* table below */ ] }
```

- `duration: 'instant'` — one show day. This is also what makes upcoming shows
  appear on `upcoming.html` with **no code change** (it lists instant events with
  `event_date >= today`).
- `relatedContact: true` — the event form's contact picker becomes the **Handler**
  (see §2.2 for the label).
- `editionFlag: 'shows'` — new, generic descriptor key: "this type exists only when
  `editionFlags[editionFlag]` is true." See §7. The shared core never checks
  "is this Pro"; it reads a flag.

### 2.1 Top-level fields (existing Event columns)

| Field | Meaning for a show |
|---|---|
| `event_date` | The show day (`YYYY-MM-DD`). |
| `title` | Auto-filled to `"<show_name>"` (falls back to `"Show"`), editable. Matters for CSV natural-key collisions on same-day double-headers (§8). |
| `related_contact_id` | The **handler** (a Contact). Blank = owner-handled. |
| `reminder_date` | **Entries close** date. Drives the existing reminders engine — no new reminder code. |
| Cost (→ Expense) | Entry fee or handling fee, category `show` (§5.6). |
| `notes` | Free text. |

### 2.2 `details{}` fields (in form order)

| Key | Label | Type | Notes |
|---|---|---|---|
| `entry_status` | Entry status | `select` | Enforced — `SHOW_ENTRY_STATUS` (§3). Default `planned`. |
| `show_name` | Show | `text` | e.g. "Greater Example KC — Show 2". |
| `club` | Club | `combobox` | Suggestions = distinct `club` values already on show events (same pattern as the test vocabulary, guide §8). |
| `organization` | Organization | `select` | Enforced — `SHOW_ORGANIZATIONS`; v1 = `AKC` (+ `Other`). Defaults to `AKC`. |
| `location` | Location | `text` | Venue / city. Plain string, same posture as boarding's `location`. |
| `ring` | Ring | `text` | Inert display string. |
| `ring_time` | Ring time | `text` | Inert display string — never parsed or compared (same posture as boarding's times). |
| `judge` | Judge | `combobox` | Suggestions = distinct `judge` values already logged. Free text, **not** a Contact FK. Normalized (trim + case-fold) when counting distinct judges (§4). |
| `class` | Class | `combobox` | Suggestions = `AKC_SHOW_CLASSES` (Puppy 6–9, Puppy 9–12, 12–18 Months, Bred-by-Exhibitor, Amateur-Owner-Handler, American-Bred, Open, Best of Breed, …). |
| `placement` | Award | `combobox` | Suggestions = `AKC_SHOW_AWARDS` (1st–4th, WD, WB, RWD, RWB, BOW, BOB, BOS, Select Dog, Select Bitch, BOB Owner-Handler, Group 1–4, BIS, RBIS). Suggest-not-enforce. |
| `points` | Points | `number` | 0–5. Points earned *at this show* toward `points_toward`. |
| `points_toward` | Points toward | `select` | Enforced — `TITLE_TRACKS` values for the chosen organization (`akc_ch`, `akc_gch`), plus blank. |
| `defeated_champion` | Defeated a champion of record? | `select` | `Yes` / `No`. Only meaningful for GCH points (§4). |

The handler picker's label reads **"Handler"** for this type. That needs one small
generalization in `eventForm.js`: `relatedContact` may be `true` (label "Related
contact", as today) **or** a string used as the label (`relatedContact: 'Handler'`).
Boarding/placement are unchanged.

### 2.3 Soft checks (page-level, never repo-level — guide §6)

On save, `eventForm.js` raises a **soft confirm** (never a hard block), like the
weight-regression warning:

- `points` > 5 ("AKC caps points at 5 per show — save anyway?").
- `points` > 0 while `entry_status` ≠ `shown`.
- Results (`placement`/`points`) filled in on a future `event_date`.
- `points` > 0 with no `points_toward` (the points won't count toward any track).

`eventRepo` validation is unchanged — `details` stays free-form at the repo layer.

---

## 3. Entry lifecycle

The same record runs from "planning to enter" to "results recorded" — a status
update on one record, never a second record (same spirit as the Dog life-stage rule).

```js
export const SHOW_ENTRY_STATUS = [
  { value: 'planned',   label: 'Planned',   badge: 'badge-gray' },
  { value: 'entered',   label: 'Entered',   badge: 'badge-blue' },
  { value: 'shown',     label: 'Shown',     badge: 'badge-green' },
  { value: 'absent',    label: 'Absent',    badge: 'badge-amber' },
  { value: 'scratched', label: 'Scratched', badge: 'badge-gray' },
  { value: 'excused',   label: 'Excused / DQ', badge: 'badge-red' }
];
```

Not a locked state machine (same posture as `CONTRACT_STATUS`): moves any direction,
no confirmation dialogs. Only `shown` events count toward points (§4).

---

## 4. Current points — the derived engine

### 4.1 Track rules are data (`vocab.js`)

```js
export const SHOW_ORGANIZATIONS = [
  { value: 'AKC',   label: 'AKC' },
  { value: 'other', label: 'Other' }
];

// Requirements per title track. The engine reads these; it never hardcodes a number.
export const TITLE_TRACKS = [
  { value: 'akc_ch',  label: 'AKC Champion (CH)',        organization: 'AKC', title: 'CH',
    points: 15, majorMin: 3, majors: 2, distinctMajorJudges: 2, distinctJudges: 3,
    perShowMax: 5 },
  { value: 'akc_gch', label: 'AKC Grand Champion (GCH)', organization: 'AKC', title: 'GCH',
    points: 25, majorMin: 3, majors: 3, distinctMajorJudges: 3, distinctJudges: 4,
    perShowMax: 5, championDefeats: 3, requires: 'akc_ch' }
];
```

AKC rules these encode:

- **CH:** 15 points, including 2 majors (a 3-, 4- or 5-point win) under 2 different
  judges, and at least one more point under a third judge.
- **GCH:** 25 points, including 3 majors under 3 different judges, at least one more
  judge beyond those, and having defeated a champion of record at 3 shows. The dog
  must already be a CH.

### 4.2 A major is derived, not stored

A win is a major when `points >= track.majorMin`. There is deliberately **no**
`major` field — a stored flag could disagree with the points beside it.

### 4.3 Module: `shared/data/showPoints.js` (Pro-used, shared-resident)

Split the same way as `scopePredicates.js`: a **db-free pure core** that is
unit-testable, plus a thin loader.

```js
// Pure. events = one dog's non-archived 'show' events.
export function trackProgress(events, track) → {
  points,              // sum of min(points, perShowMax) over counting events
  majors,              // count of counting events with points >= majorMin
  majorJudges,         // distinct normalized judges among majors
  judges,              // distinct normalized judges among point-earning events
  championDefeats,     // count with defeated_champion === 'Yes' (GCH only)
  complete,            // every requirement on the track satisfied
  missing: [ '…' ]     // human-readable gaps, e.g. "1 more major (new judge)"
}

// Loader. One index probe: events where event_type = 'show' (already indexed),
// filtered to the dog, then trackProgress per TITLE_TRACKS row the dog has events for.
export async function getShowRecord(dogId) → { tracks: [...], history: [...] }
```

**Counting event** = `event_type === 'show'`, not archived, `details.entry_status
=== 'shown'`, `details.points_toward === track.value`, `points > 0`.

`requires` (GCH needs CH) is satisfied by either a completed `akc_ch` track **or** a
`title_earned` event with `title_abbreviation` = `CH` (case-insensitive) — so a dog
that finished before the owner used KennelOS still unlocks GCH progress.

Track completion **never writes anything.** It feeds the nudge in §5.4.

---

## 5. Surfaces

### 5.1 Dog profile — "Show record" card (`shared/pages/dog.js`)

A new collapsible card (`renderShowRecordSection`), placed after Health tests,
gated like the stud-services card:

```js
if (!editionFlags.shows) { els.showRecord.innerHTML = ''; return; } // Pro-only
```

Contents:

- One progress row per track the dog has events for: `11 / 15 pts · majors 1 / 2 ·
  judges 3 / 3`, plus the `missing` text, or "Complete" with the `title_earned` date
  if one exists.
- Show history table, newest first: date, show, award, points, judge, handler.
  Rows link to the event's edit modal.
- "Add show" button → event form pre-set to `event_type: 'show'`.

The card renders only when the dog has at least one show event — no empty card on
every pet puppy. The first show is logged from the timeline's existing "Add event"
(or the Shows page), after which the card appears.

### 5.2 New page: `shared/pages/shows.html` + `shows.js` (Pro-only)

Two seg-tabs:

- **Upcoming** (`event_date >= today`, status not `scratched`): date, dog, show,
  location, ring / ring time, handler, entry status badge, entries close
  (`reminder_date`, flagged amber within 7 days, red when past and still `planned`).
  Grouped by date so a cluster weekend reads as a block.
- **Results** (`event_date < today`): date, dog, show, judge, class, award, points,
  track. Filters: dog, organization, date range, track. CSV export comes from
  `reportView` for free.

Both are `reportView`-based and take the standard `scope` predicate
`subjectInScope`, so the active kennel scope applies like every other list (Multi-Kennel
Scope Spec §7).

**"Add entries" (multi-dog × multi-day).** A modal on the Upcoming tab: pick dogs
(scoped picker with the usual "show all my kennels" escape), pick one or more dates,
then fill the shared fields once (show name, club, location, handler, entries close,
entry status). It creates one `show` event per dog per date through `eventRepo.create`
— the same shape `openEventForm`'s litter cascade produces. No cost field in the bulk
modal; fees are added per entry afterwards.

**Navigation.** Add `{ label: 'Shows', path: 'pages/shows.html' }` to `moreItems` in
the shared, Pro and Demo `editionConfig.js`. Lite's `moreItems` doesn't get it.

### 5.3 Today — "Upcoming shows" card (`shared/pages/today.js`)

`renderShows()`, gated on `editionFlags.shows`: show events in the next 14 days,
grouped by date, with dog · show · location · handler · ring time. Silent when empty.
Entries-close alerts need **no new code** — they are ordinary reminders via
`reminder_date`.

### 5.4 Nudge — "Log the title?" (`shared/data/nudges.js`)

A ninth rule, appended to guide §19's list, gated on `editionFlags.shows`:

- **Track complete → title.** For each in-scope dog and each `TITLE_TRACKS` row where
  `trackProgress(...).complete` is true and **no** `title_earned` event with
  `title_abbreviation` = `track.title` exists for that dog, suggest logging it. The
  action opens the event form pre-filled with `event_type: 'title_earned'`,
  `title_abbreviation: track.title`, `organization: track.organization`, and
  `event_date` = the date of the completing win.
- Key: `show-title:<dogId>:<track.value>`. Auto-dismisses once the `title_earned`
  event exists (the event is the done-signal — no ledger entry needed).
- Decide-not-auto: never creates the title on its own.

### 5.5 Upcoming page

No change — `show` is an instant type, so it already appears in
`shared/pages/upcoming.html`, and the type filter there can narrow to it. In Lite the
type doesn't exist, so it can't appear.

### 5.6 Vocab additions

- `CONTACT_TYPE` += `{ value: 'handler', label: 'Handler', badge: 'badge-purple' }`.
  The event form's inline "+ new contact" adds the `handler` role when a contact is
  created from a show event's Handler picker (`contactRepo` already has the
  add-a-role helper).
- `EXPENSE_CATEGORIES` += `{ value: 'show', label: 'Shows & handling', badge:
  'badge-purple' }`; `defaultExpenseCategoryFor('show')` → `'show'`.
- `BOARDING_REASON_SUGGESTIONS` += `'With handler / show circuit'` (decision 4).
- `AKC_SHOW_CLASSES`, `AKC_SHOW_AWARDS` (suggestion lists, §2.2),
  `SHOW_ENTRY_STATUS` (§3), `SHOW_ORGANIZATIONS` and `TITLE_TRACKS` (§4).

`handler`, `show` category and the boarding suggestion are harmless in Lite (Lite has
no Contacts pages and no show events), so they stay shared and ungated.

---

## 6. Data model impact

| Area | Change |
|---|---|
| `db.js` tables / indexes | **None.** `events.event_type` (index) finds all show events; `[subject_type+subject_id]` gives a dog's. |
| Foreign keys | **None new.** Handler = existing `events.related_contact_id`. |
| `referenceRegistry.js` | Label only: `'contact on a boarding event'` → `'contact on a boarding, placement, or show event'` (already stale — placement uses it). Blocking behavior unchanged. |
| JSON backup / Dropbox sync | Free — events ride both already. |
| KennelAssistant | Unchanged — `show` is **not** added to `ASSISTANT_EVENT_TYPES`. |
| Companion / Puppy Record / Furever | Unchanged in v1 (open door, §11). |

---

## 7. Edition gating

| Piece | Mechanism |
|---|---|
| `shows.html` / `shows.js` | `PRO_ONLY_PAGES` in `shared/data/proPages.js` → physically absent from the Lite build. |
| `showPoints.js` | Stays in `shared/` (imported by shared `dog.js`/`today.js`/`nudges.js`, like `companionExport.js`); every call site is behind the flag. |
| Flag | `editionFlags.shows` — `true` in `shared/`, `pro/`, `demo/` configs; `false` in `lite/editionConfig.js`. `tests/editionConfig.test.js` already fails if any edition omits a shared flag. |
| `show` event type | New generic descriptor key `editionFlag`. A tiny helper (e.g. `enabledEventTypes(subjectType)` in `eventForm.js`'s import surface, reading `editionFlags`) filters out any type whose flag is off. Used by the event form's type picker **and** by `csvImport.js`'s `event_type` resolution, so Lite rejects a `show` row as "Unrecognized event_type". |
| Dog card / Today card / nudge | `if (!editionFlags.shows) return` at each render/rule. |
| Lite → Pro bridge | Unaffected (Lite never has show events). |
| Demo | Gets the full feature plus sample data (§9); read-only mode applies as for every other page. |

The editions plan's Pro feature list gets a "Show tracking" line.

---

## 8. CSV import

No new importer. The existing dog-event import (`csvImport.js`) already takes
`event_type`, `event_date`, `title`, `related_contact_name`, `reminder_date` and a
`details_json` column, so past results import as `event_type = show` rows today once
the type exists.

Natural key = dog + `event_type` + `event_date`, `title` as tiebreak. That is
exactly "one per dog per show day." On an AKC double-header (two shows, same site,
same day) the two rows must have different titles — the auto-title from `show_name`
(e.g. "… Show 1" / "… Show 2") covers this; the doc string on the import page should
say so.

A purpose-built "show results" CSV with flat columns (`judge`, `points`, …) instead
of `details_json` is an open door (§11).

---

## 9. Sample data / Demo

`shared/data/sampleData.js` gains, for one existing adult show dog in the seed:

- ~6 past `shown` AKC events toward `akc_ch` totalling, say, 12 points with 1 major,
  across 3 judges — so the progress card shows real gaps ("3 more points, 1 more
  major under a new judge").
- 2 upcoming events on a cluster weekend with a handler contact (`contact_type:
  ['handler']`), one `entered`, one `planned` with a `reminder_date` a few days out —
  so Today's card, a reminder, and the Shows page Upcoming tab are populated.
- One entry fee expense via the event Cost link.

Lite's own seed (`lite/` tour package) is untouched.

---

## 10. Build phases

Each phase is shippable on its own; the `CACHE_NAME` bump is asked for once at the
end of the batch (CLAUDE.md), not per phase.

**Phase 1 — type + gating (no new pages).**
- `vocab.js`: `show` type, `SHOW_ENTRY_STATUS`, `SHOW_ORGANIZATIONS`, `TITLE_TRACKS`,
  `AKC_SHOW_CLASSES`, `AKC_SHOW_AWARDS`, the three vocab additions in §5.6.
- `eventForm.js`: `editionFlag` filtering, `relatedContact` label string, auto-title,
  club/judge suggestion comboboxes, soft checks (§2.3).
- `csvImport.js`: same `editionFlag` filter on `event_type`.
- All four `editionConfig.js`: `shows` flag.
- `referenceRegistry.js`: label.

**Phase 2 — points engine + dog card.**
- `shared/data/showPoints.js` (pure core + loader).
- `tests/showPoints.test.js`: CH incomplete/complete, perShowMax clamp, same-judge
  majors don't count twice, non-`shown` and wrong-track events ignored, GCH
  `requires` satisfied by a `title_earned` CH event, champion-defeat count.
- `dog.js`: Show record card.

**Phase 3 — Shows page.**
- `shared/pages/shows.html` + `shows.js` (Upcoming / Results + Add entries modal).
- `proPages.js`, `moreItems` (shared/pro/demo), `shared/sw.js` `PRECACHE_URLS`.

**Phase 4 — Today, nudge, sample data.**
- `today.js` Upcoming shows card; `nudges.js` track-complete rule; `sampleData.js`.

---

## 11. Open doors (deliberately not built)

- A `shows` table (one row per show weekend; venue, closing date, superintendent
  entered once, referenced by an indexed `events.show_id` FK + registry entry). The
  "Add entries" modal covers most of the retyping it would save.
- UKC / CKC / FCI tracks — new `SHOW_ORGANIZATIONS` + `TITLE_TRACKS` rows. UKC's
  competition-win rules need one more derived count, nothing structural.
- GCH Bronze / Silver / Gold / Platinum (100 / 200 / 400 / 800 GCH points beyond
  GCH) — points-only `TITLE_TRACKS` rows.
- Other AKC title types (obedience, rally, performance legs) — a separate "legs"
  model, not points.
- Automatic away-board rows from show events (`awayBoard.js` third source).
- Separate entry-fee and handler-fee per event (needs a second cost link from event to
  Expense, which guide §21 currently rules out).
- Judge as a Contact FK (would need a new `events` field + index + registry entry).
- Show record in Companion share-outs / the Puppy Record (sire/dam titles and
  points for buyers).
- A flat-column show results CSV importer.

---

## 12. Docs & housekeeping checklist (same change as the code)

- **End-State guide:** §4.1 / §8 (the `show` type, `editionFlag` and string
  `relatedContact` descriptor keys), new subsection for `showPoints.js`, §13 page
  catalog (`shows.html`), §19 (ninth nudge rule), §21 (`show` expense category), §15
  (move nothing — the open doors above go there if they're declined).
- **Editions plan:** Show tracking in the Pro feature list.
- **README.md:** build-status entry per phase.
- **`shared/sw.js`:** `PRECACHE_URLS` += `pages/shows.html`, `pages/shows.js`,
  `data/showPoints.js`; then **ask** before bumping `CACHE_NAME`.
- **Verification:** `node --check` every touched file; `npm test` (edition-flag,
  service-worker, CSV and new `showPoints` tests); `node build/assemble.mjs` for all
  editions and confirm `shows.html` is absent from `dist/lite/`; serve and exercise:
  plan an entry → reminder fires → mark shown with points → progress updates →
  completing win raises the title nudge → log title → nudge clears; Lite shows no
  trace of the feature.
