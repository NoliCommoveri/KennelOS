# KennelOS — Multi-Kennel Scope Spec

> **Status: design, not yet built.** This is the authoritative target for making
> Kennel a true top-level view — a scope every list, hub, and report is segmented
> by — rather than the reference lookup it is today. Read alongside
> `docs/End_State_Design_and_Maintenance_Guide.md` (the map of the `shared/` code
> this changes) and `docs/KennelOS_Lite_Pro_Editions_Plan.md` (the edition rules
> §12 depends on).
>
> **Timing matters.** Per CLAUDE.md the Dexie schema is still one collapsed
> `db.version(1)` block, editable in place **only because nothing has shipped**.
> `docs/LAUNCH_CHECKLIST.md` puts the repo at code freeze. The schema half of this
> spec (§4) is cheap now — a Reset App + re-seed — and expensive after the first
> release, when it becomes an additive `version(2)` block plus a backfill over
> live user data. If this feature is happening, §4 lands before launch.

---

## 1. What "top-level view" means here

Three separable changes, in dependency order:

1. **Put a kennel on the entities that don't have one.** Today only Dog and
   Contact carry a kennel; litters, pairings, sales, stud services, contracts,
   and documents carry nothing, so there is nothing to segment by.
2. **Add a scope every read path honors** — one active-kennel selector in the
   shell, not N per-page filters.
3. **Make `kennel.html` a per-kennel hub** rather than the config-plus-expenses
   page it is now.

## 2. Where Kennel stands today (the starting point)

- `kennels` is indexed on `id, is_archived` only (`shared/data/db.js:94`) — no
  query surface beyond a full scan.
- Exactly **three** FKs point at a kennel — `contacts.kennel_id`,
  `dogs.kennel_id`, `dogs.breeder_kennel_id` (`referenceRegistry.js:96-104`) —
  plus the polymorphic `expenses` rows with `subject_type='kennel'`.
- The table is **dual-purpose**: it holds the user's own kennels *and* other
  people's (breeder-of-record, a contact's affiliation, an external dog's home).
  `is_own_kennel` is the only discriminator.
- The app assumes **one** kennel. `settings.myKennelId` is a single id;
  `kennelSetup.js` creates/updates exactly one; and `invoice.js:102`,
  `puppy-record.js:225`, `companion.js`, `furever.js` all resolve "my kennel"
  with `kennels.find(k => k.is_own_kennel && !k.is_archived)` — first match wins,
  which silently misbehaves the moment a second own kennel exists.
- Multi-kennel is already half-anticipated: `dog.js:169`'s `soleOwnKennelId()`
  prefills `kennel_id` only when exactly one own kennel exists, and deliberately
  leaves it blank at 0 or 2+.

## 3. Decisions (locked)

| # | Decision | Resolution |
|---|---|---|
| 1 | Stamped or derived scope? | **Stamped.** A real, indexed `kennel_id` on the scoped tables. Not derived through the dog/dam. |
| 2 | Segment over own kennels only? | **Yes.** The scope picker lists `is_own_kennel` kennels; outside kennels stay pure reference data and are never a scope. The dual-purpose table stays as-is. |
| 3 | Global scope or per-list filter? | **Global.** One active-kennel switcher in the shell, persisted in `settings.js`, with an "All kennels" option. |
| 4 | Unassigned records? | **No such thing.** There is no live data and no users, so there is no backfill and no "Unassigned" bucket. `kennel_id` becomes **mandatory on new dogs** (§3.1a), and **kennel setup at first launch becomes mandatory** (§3.2) so a kennel always exists to stamp. |
| 5 | Edition posture? | **Pro-only.** `editionFlags.multiKennel`; Lite keeps exactly one kennel and today's behavior verbatim. |

Decision 1 is what makes the rest work: deriving a sale's kennel through its dog
is ambiguous the moment the dam is external or co-owned, the dog is transferred
between the user's own kennels, or the dog is sold and no longer owned — and it
is unindexable. Stamping costs six index entries and survives all three.

### 3.1 Two consequences of "mandatory kennel" that need stating

Decision 4 removes the migration work but creates two edges the implementation
must close deliberately.

**(a) External dogs cannot carry an own-kennel scope.** An external dog's
`kennel_id` today points at *someone else's* kennel — `sampleData.js:235` has
Gunnar at Meadow Ridge, which is exactly the intended use. So the mandatory rule
is scoped by ownership, not blanket:

- `ownership_type` ∈ `owned` / `co_owned` → `kennel_id` is **required** and
  **must be one of the user's own kennels**. This is the scoping population.
- `ownership_type` ∈ `external` / `leased_in` → `kennel_id` stays **optional**
  and may name an outside kennel (unchanged from today).
- External/leased dogs are **scope-transparent**: they appear under every scope.
  They are reference records — an outside stud used by two of your kennels
  belongs to neither — and hiding them under a scope would break pedigree and
  stud-service workflows.

This only bites in Pro: Lite has no external ownership at all
(`editionFlags.externalOwnership: false`).

**(b) A dog with no kennel to point at.** With a required `kennel_id`, a user who
skips kennel setup is dead-ended at the first dog they try to create — in **both**
editions. Resolved by §3.2: setup stops being skippable.

## 3.2 Kennel setup at first launch becomes mandatory

**Decision: the first-run kennel setup is a hard gate.** No "Skip for now". The
app is not usable until one own kennel exists, because from §3.1(a) onward every
owned dog needs one to point at.

### 3.2.1 Retire the skip

Delete the skip path outright rather than hiding its button:

- `settings.js` — `KEYS.myKennelSetupSkipped`, `wasMyKennelSetupSkipped()`,
  `markMyKennelSetupSkipped()`.
- `kennelSetup.js` — `skipKennelSetup()`, and the `wasMyKennelSetupSkipped()`
  term in `shouldOfferKennelSetupPrompt()`.
- `kennelSetupUI.js` — the `skippable` branch at line 52 and the
  `if (skippable) skipKennelSetup()` at line 92.

### 3.2.2 `showKennelSetupModal` grows a third posture

Today's `skippable` boolean is really two modes, and it needs to become three —
minus the one being retired, that leaves two:

| Mode | Dismiss control | Used by |
|---|---|---|
| `required` | **none** — no Skip, no Cancel, no backdrop close, no Escape | the three first-run call sites below |
| `cancellable` | Cancel (closes, changes nothing) | `import-export.js:168` — a deliberate reopen to *edit* an existing kennel, which must stay dismissible |

`required` is the posture `onboardCard()` in `onboardingUI.js` already implements
for the Welcome card — a dimmed, non-dismissible overlay whose only exit is the
button. Reuse that behavior rather than inventing a second one.

The three call sites that become `required`:

- `onboardingUI.js:105` — the "I'll explore" branch.
- `wizardUI.js:167` — the guided tour's finish handoff.
- `kennelSetupUI.js:15` (`maybeShowKennelSetupPrompt`, called from `app.js`) —
  the catch-all that fires on the load after sample data is cleared.

### 3.2.3 The gate re-fires until satisfied — mostly for free

The "user reloads to escape the modal" hole is already closed by existing logic,
which is worth knowing before anyone adds new machinery for it:

`declineSampleData()` calls `markSampleDataCleared()` (`sampleData.js:61-63`). So
on the explore branch, a reload makes `shouldOfferFirstRunPrompt()` return false
(the cleared flag is set — `sampleData.js:51`) and `app.js` falls through to
`maybeShowKennelSetupPrompt()`, whose `shouldOfferKennelSetupPrompt()` is then
true: no sample data, cleared flag set, not set up. **The only thing suppressing
that re-fire today is the skip flag.** Removing it (§3.2.1) turns the existing
fall-through into the mandatory gate, with no new state to track.

### 3.2.4 The gate's condition is "an own kennel exists", not "myKennelId is set"

The guided-tour branch seeds Thornfield with `is_own_kennel: true`
(`editionTour.js:46`) but never sets `myKennelId` — only `completeKennelSetup()`
does. Both the shared and Lite seeds do this. So the gate must be satisfied by the
sample data (as `shouldOfferKennelSetupPrompt`'s `hasSampleData()` term already
arranges) and fire at the tour's finish handoff, which is exactly where
`wizardUI.js:167` already calls it.

### 3.2.5 Demo stays exempt

`app.js`'s `boot()` returns inside the `isDemo()` branch before the first-run flow
(`app.js:96-104`), so the gate never runs in Demo — and must not be moved ahead of
that return. Demo is a seeded, read-only showcase; its writes throw `DemoModeError`
anyway, so a mandatory setup modal there would be an unclosable dialog over a
read-only app. **Any refactor that relocates the gate has to preserve this
ordering.**

### 3.2.6 Two hazards this creates

- **Abandoning the tour mid-way.** Sample data stays present, so the gate stays
  satisfied and the user can create real dogs stamped into the *sample* Thornfield
  kennel — which `clearSampleData()` later deletes, orphaning a real dog's
  `kennel_id`. This hazard exists today in a milder form; a mandatory `kennel_id`
  makes it likely rather than theoretical. Clearing sample data must refuse (or
  re-home) when a non-seeded record points at a seeded kennel.
- **`is_own_kennel` is not enforced on create.** The Kennels page checkbox
  (`kennels.js:145`) defaults unchecked, so a Pro user can make a kennel that is
  invisible to the scope picker. The required dog-form picker lists own kennels
  only, so any inline "+ New kennel" it offers must force `is_own_kennel: true`.

### 3.2.7 The dog form's inline create is now optional, not load-bearing

With setup mandatory, an inline **"+ New kennel"** on the dog form is no longer
needed to prevent a dead-end — a kennel always exists. It stays worth having in
**Pro** as a convenience for adding a *second* kennel without leaving the form
(the pattern `contactPicker.js` already uses for contacts), but it is no longer
required for correctness, and **Lite doesn't need it at all** (single kennel,
field hidden and auto-stamped — §12).

## 4. Data model

### 4.1 Schema (`shared/data/db.js`)

Add an indexed `kennel_id` to the six scoped tables:

```
pairings:      'id, kennel_id, sire_id, dam_id, status, pairing_type, is_archived',
litters:       'id, kennel_id, pairing_id, sire_id, dam_id, status, whelp_date, foster_partner_contact_id, is_archived',
sales:         'id, kennel_id, dog_id, buyer_contact_id, referred_by_contact_id, status, placement_type, is_archived',
stud_services: 'id, kennel_id, our_dog_id, partner_dog_id, partner_contact_id, referred_by_contact_id, direction, status, pairing_id, is_archived',
contracts:     'id, kennel_id, contract_type, status, related_sale_id, related_stud_service_id, related_dog_id, related_contact_id, is_archived',
documents:     'id, kennel_id, dog_id, doc_type, doc_date, is_archived',
```

`dogs.kennel_id` and `contacts.kennel_id` already exist and are already indexed —
no change. Edited **in place in the `version(1)` block**, per the pre-release rule
in CLAUDE.md; reconcile via Reset App + re-seed.

**Not stamped, and why:**

- `events` and `expenses` — already polymorphic (`[subject_type+subject_id]`).
  Their scope derives from the subject they hang off. Adding a second scope field
  would create two sources of truth for the same fact.
- `files` — owned by exactly one document/expense, never queried except by id.
- `breed_feeding_schedules` — a per-breed lookup keyed by free-text breed, shared
  across the whole program. Kennel-scoping it would mean duplicating the same
  grid per kennel for no gain.

### 4.2 Referential integrity (`shared/data/referenceRegistry.js`)

Six new lines in `KENNEL_REFERENCES` — one per stamped table. Per CLAUDE.md this
is the step that gets forgotten, and skipping it would let a kennel be
hard-deleted out from under its own litters and sales.

```js
{ table: 'pairings',      field: 'kennel_id', label: 'kennel of a pairing' },
{ table: 'litters',       field: 'kennel_id', label: 'kennel of a litter' },
{ table: 'sales',         field: 'kennel_id', label: 'kennel of a sale' },
{ table: 'stud_services', field: 'kennel_id', label: 'kennel of a stud service' },
{ table: 'contracts',     field: 'kennel_id', label: 'kennel of a contract' },
{ table: 'documents',     field: 'kennel_id', label: 'kennel of a document' },
```

**Visible behavior change:** a kennel in real use becomes effectively
undeletable — hard delete is blocked while anything points at it, so the Kennels
page's Delete button will be disabled for any working kennel, with the blocker
list naming litters/sales/etc. That is correct (archive is the intended exit) but
it is a user-facing change from today and should read as intentional in the UI
copy, not as a bug.

### 4.3 Repos

- `dogRepo.validateDog` — enforce §3.1(a): `kennel_id` required when
  `ownership_type` ∈ `owned`/`co_owned`, and (Pro) validated to be an own kennel.
  This is a hard block in the repo, matching how `owner_contact_id` is already
  required for `external`/`leased_in` (`dogRepo.js:58`).
- `pairingRepo` / `litterRepo` / `saleRepo` / `studServiceRepo` / `contractRepo` /
  `documentRepo` — validate `kennel_id` present on create.
- `kennelRepo` — add `getOwn()` (active, non-archived, `is_own_kennel`) so the
  scope service and every picker share one definition instead of re-filtering.

## 5. The scope service — `shared/data/kennelScope.js` (new)

One module owns the active scope; **no page reads the setting directly** (same
layering rule as `settings.js`). API:

```js
getActiveKennelId()          // id | null (null === "All kennels")
setActiveKennel(id | null)   // persists; caller reloads/re-renders
getActiveKennel()            // the record, or null
ownKennels()                 // kennelRepo.getOwn(), memoized per page load
isScoped()                   // false when "All kennels" or single-kennel edition
inScope(record)              // the predicate every read path uses
resolveKennelIdForWrite()    // what a new record stamps (§6)
```

`inScope(record)` is the whole contract, and it has to encode three cases:

1. Not scoped (All kennels, or Lite) → always `true`.
2. Record carries `kennel_id` → match against the active id.
3. Record is **scope-transparent** (external/leased dog, per §3.1a) → `true`
   regardless of scope.

New settings key `kennelOS.activeKennelId` in `settings.js`'s `KEYS` map, so it
rides `clearAllSettings()` (Reset App) like everything else.

**Stale-scope guard:** the active kennel can be archived or deleted from under the
setting. `getActiveKennel()` returning null for a set id must fall back to "All
kennels" and clear the key, never render an empty app with no explanation.

## 6. Write paths

Every create stamps the kennel. `resolveKennelIdForWrite()` centralizes the rule:
**inherit from the parent record when there is one, else the active kennel, else
the sole own kennel.**

| Created from | Stamps |
|---|---|
| Dog form (`dog.js`) | Required picker; defaults to active kennel. Generalizes today's `soleOwnKennelId()` (`dog.js:169`). |
| `puppyForm.js` | Inherits from the **litter**, not the dam — the litter is the thing that belongs to a kennel. (Note: `breeder_kennel_id` inheritance at `puppyForm.js:30` is a *different* field and stays as-is.) |
| Pairing / Litter | Active kennel; picker when >1 own kennel. |
| Sale (`sale.js`) | Inherits from the dog being placed. |
| Stud service | Inherits from **our** dog (`our_dog_id`), never the partner's. |
| Contract | Inherits from its linked sale / stud service / dog. |
| Document | Inherits from its dog. |

Forms show a kennel picker only when >1 own kennel exists — the same silence rule
`soleOwnKennelId()` already applies, generalized rather than replaced.

## 7. Read paths

The bulk of the work. `shared/assets/listView.js` is the big lever: one
scope-aware clause in `visibleRecords()` (alongside the existing `baseFilter` /
archived / search / filters chain, `listView.js:119-131`) covers every list
screen built on it at once.

Everything **not** on listView needs individual treatment:

- `today.js` + `dashboard.js` — every tile, plus reminders, upcoming, away-board.
- `breeding.js`, `sales.js` — the card hubs.
- `financials.js` — all three views (expenses, income, litter finances). Note it
  already has kennel-aware expense subjects (`financials.js:102`).
- `data/nudges.js` — already reads `kennel.promote_nudge_enabled` per dog
  (`nudges.js:119-125`); needs the surrounding derivation scoped too.
- `data/awayBoard.js`.
- Every Pro report page (`*-report.js` + `reports.html`).

**Deliberately NOT scope-filtered** — this list is as load-bearing as the one
above, and each entry needs a comment at the call site saying so:

- **Pedigree and lineage** (`pedigree.js`, `assets/pedigree.js`, `dogRepo`'s
  ancestor walk) — ancestry crosses kennels by definition. Scoping it would
  silently truncate pedigrees, the single most damaging possible regression here.
- **Any detail page reached by id** (`dog.html?id=…`, `litter.html?id=…`, …) — a
  direct link must always resolve. If the record is out of scope, show a
  "this belongs to <kennel>" affordance with a one-click scope switch; never 404
  and never silently redirect.
- **External / leased dogs** — scope-transparent per §3.1(a).
- **Contacts** — buyers, vets, and partners are program-wide. Scope the *lists*
  that hang off a kennel (a kennel's affiliated contacts) but never the contact
  pool itself; a buyer who bought from two of your kennels is one person.

## 8. Kennel as a hub (`kennel.html`, `kennels.html`, `nav.js`)

- `kennel.html` becomes a real per-kennel dashboard — roster counts, active
  litters, recent placements, that kennel's P&L, plus the existing config
  (preferred tests, promote nudges, logo) and kennel-wide expense ledger it
  already hosts.
- `kennels.html` becomes the portfolio view: one row per own kennel with live
  counts, and the entry point to switching.
- `nav.js` gains the active-kennel indicator + switcher. It renders from
  `editionConfig` today and must stay edition-agnostic — the switcher is driven
  by `editionFlags.multiKennel`, so Lite renders nothing (§12).

## 9. Pickers and cross-kennel work

Sire/dam pickers, `contactPicker.js`, and the expense subject pickers become
**scoped by default with a "show all kennels" escape** — the same shape as the
existing "include archived" toggle.

Two workflows are *intentionally* cross-kennel and must not be over-filtered:
**stud services** (the whole point is a dog from elsewhere) and **co-breeding
between the user's own kennels** (a sire at kennel A over a dam at kennel B). If
the picker hides the other kennel's dogs by default, both break — hence the
escape toggle rather than a hard filter.

## 10. Un-single-kennel-ing the identity assumptions

The four `find(k => k.is_own_kennel)` sites — `invoice.js:102`,
`puppy-record.js:225`, plus the companion and furever equivalents — become
**"the record's own kennel, falling back to the active kennel."** An invoice for a
sale from kennel B must carry kennel B's name and logo, not whichever own kennel
happens to sort first.

`settings.myKennelId` keeps its meaning as the *default/primary* kennel (it drives
the nav banner and first-run) and is no longer treated as "the" kennel anywhere
else.

**The awkward one:** Companion messaging settings (`KEYS.companion`) and the
Furever kennel-identity block (`KEYS.furever`) are **global localStorage blobs**
holding per-kennel identity — kennel name, tagline, logo, breeder contact. With
two kennels these are wrong. They need per-kennel keying, which is its own small
(settings-only, no IndexedDB) migration. `getFureverSettings().breederKey` is
deliberately independent of `myKennelId` and must stay stable per kennel, or
already-sent Furever packets stop deduping into their breeder row.

## 11. Import / export & CSV

- **JSON backup** — shape is unchanged; `exportAll()` iterates whatever tables
  exist and the new fields ride along for free (`importExport.js:74`). No
  `BACKUP_FORMAT_VERSION` bump: nothing about the on-disk shape changes.
- **CSV import** (`csvImport.js`) — a kennel column that resolves by name against
  existing own kennels (case-insensitive + trimmed, like every other relationship
  column), defaulting to the active scope when absent. Per CLAUDE.md an
  unresolved name is **flagged, never invented**, and the dry-run preview should
  show which kennel each row lands in.
- `csvImport.js:1127` already collects own kennels — extend, don't duplicate.

## 12. Editions (decision 5 — Pro-only)

`kennels.html`, `kennel.html`, and `kennel-tests-import.html` are **already**
Pro-only pages (`shared/data/proPages.js`), and Lite's nav already omits them —
so this is an extension of the existing partition, not a new gate.

- New `editionFlags.multiKennel` — `true` in `shared/` (Pro/Demo default),
  `false` in `lite/editionConfig.js`.
- **Lite:** exactly one own kennel. No switcher, no picker, no scope UI anywhere.
  Writes auto-stamp the single kennel; `isScoped()` returns false, so `inScope()`
  is a constant `true` and Lite's read paths behave exactly as they do today. The
  mandatory-kennel rule is satisfied silently, with no picker and no inline create.
- **The mandatory setup gate (§3.2) is NOT Pro-only** — it ships in both editions,
  because both need a kennel to stamp. It is the one piece of this spec Lite users
  will actually see.
- **The cap is unaffected.** Lite is single-kennel, so "is the 6-dog cap per
  kennel or global?" never arises. `rosterCount.js` needs no change, and no cap
  logic becomes kennel-aware.
- **Multi-kennel becomes a Pro sales lever** — worth a line in Lite's
  `pro-promo` tour cards (`lite/editionTour.js`) and the upgrade nudge copy.

## 13. Sample data & the tour

`sampleData.js` has Thornfield and Meadow Ridge, but **Meadow Ridge is an outside
kennel** — it exercises `breeder_kennel_id` and external ownership, not
segmentation. Demonstrating scope needs a **second own kennel** with its own dogs,
litters, and sales, or the Demo edition shows a switcher with one entry in it.

`lite/editionTour.js` is unaffected beyond the promo copy (Lite is single-kennel).

## 14. Docs & service-worker obligations

Same-change work per CLAUDE.md, not follow-up:

- **End-State guide** — §4 (field tables: the six new FKs), §5 (the schema
  block), §7 (registry — the new `KENNEL_REFERENCES` lines), **§11 (first-run,
  sample data, settings — the retired skip flag and the mandatory gate)**, §13 (UI
  layer: the scope service + switcher), §19 (nudges), §21 (financials). The
  guide's field tables, schema block, and prose all have to agree with each other
  and the code.
- **README.md** — a build-status entry for the feature.
- **`shared/sw.js`** — `kennelScope.js` (and any new page) added to
  `PRECACHE_URLS`; `cache.addAll` is atomic, so one missing path breaks offline
  entirely. Run the precache sanity check from the guide's invariants section.
- **`CACHE_NAME`** — bumped **once** for the whole feature, and only after
  confirming the batch is complete. Never per-commit.

## 15. Phasing

**Phase 1 — schema + writes + the setup gate (pre-launch).** §3.2, §4, §5, §6.
Records start carrying a kennel; nothing filters yet. Two visible changes: the
required kennel field on the dog form, and first-run setup no longer offering
"Skip for now". This is the piece that gets expensive after release — it should
land before the first deploy regardless of when Phases 2-3 happen.

§3.2 belongs in Phase 1 rather than later precisely because it is what makes the
required `kennel_id` safe: shipping the required field without the gate is the
dead-end described in §3.1(b).

**Phase 2 — the scope.** §7, §8, §9. The switcher and the kennel hub go live.
This is the long pole: it touches most of the ~11k lines of page code, and every
non-listView page is hand work.

**Phase 3 — the trailing assumptions.** §10, §11, §12, §13. Identity, import,
editions, seed.

Rough sizing: Phase 1 is small and mechanical. Phase 2 is the bulk. §10 and the
§7 "NOT scoped" list carry the real correctness risk — a truncated pedigree or a
silently hidden record is far worse than a missing filter.

## 16. Verification

Per CLAUDE.md there is no build or linter, so verification is:

- `node --check` on every touched `.js`.
- `node --test` green — `tests/referenceRegistry.test.js` and
  `tests/serviceWorker.test.js` both directly cover things this spec changes, and
  `kennelScope.js` should ship with its own pure unit test (it is db-free by
  design, like `rosterCount.js`).
- The precache sanity check from the guide's invariants section.
- Served locally (never `file://`) and exercised in a browser **per edition** —
  Pro with two own kennels, Lite with one — with no console errors.
