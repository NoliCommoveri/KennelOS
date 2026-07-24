# KennelOS Furever — Data Model & Schema

Status: **data layer complete; first UI slice built.** This is the spec the code in
`furever/data/` is written against. It turns the starter brief
(`KennelOS_Furever_Family_App_Brief.md`) into a concrete Dexie schema, repos, and
a derived-reminder engine. The first pages now sit on top of it — an app shell
(nav + active-pet picker) and the Today / Pets / My Pet pages that exercise the
pet-as-scope and derived-schedule decisions end to end (see `furever/README.md`).
The remaining pieces are listed in § Not built yet; the deploy pipeline is wired.

Furever is a **separate app on its own origin** (deploy target
`NoliCommoveri/KennelOS-Furever`, a GitHub Pages repo, published from `main` the
same way the breeder-app editions are). Development happens **in the main KennelOS
repo** under `furever/`; the built app is pushed out to that deploy repo. It has
its **own IndexedDB** (`KennelOSFurever`) and shares no storage with the breeder
app.

---

## The two design decisions that drive everything

### 1. The pet is the app-wide scope
You pick a pet from the menu and from then on every page shows only that pet. The
active pet is **nav/UI state**, stored in `settings.js` (`furever.activePetId`),
not a table. Every family-layer row carries `pet_id`, so scoping a page is one
indexed query (`repo.getByPet(activePetId)`). The **one exception** is a
family-wide **due-soon page** that queries across all pets — a derived view
(`schedule.familyDueSoon`), not a table.

### 2. Reminders are derived, never authored
The breeder app's model — create a future-dated event, come back and edit it into
the actual — is deliberately **not** used. Instead:

- **"What's due" is computed, never stored.** A schedule item projects a due date
  from the pet's DOB (or a plan's start date). Nothing is written when it becomes
  due.
- **"What happened" is an append-only `care_events` row** with the real date and,
  optionally, the `plan_item_id` of the schedule item it satisfies.
- A reminder clears because a **matching actual was logged**, not because a future
  event was edited. Recurring items compute their next due from the latest logged
  actual. Correcting a DOB recomputes due dates and never disturbs a logged actual.

Consequences baked into the schema: **no `schedule_progress` table** and **no
`reminder_date` column anywhere.** The due-soon list is a pure query over
(schedule items) × (`care_events`), implemented in `schedule.js`.

### The two data layers (from the brief)
- **Seed layer** — breeder-provided, refreshable, upserted by `pup_id`. The family
  never edits it; a resend replaces it wholesale. Lives in `breeders` and in each
  seeded pet's unindexed `seed` object.
- **Family layer** — everything the family adds. Theirs; the seed never touches it.
  Lives in `care_events`, `care_plans`, `contacts`, `documents`, `photos`, `files`.

Because the layers are physically separate rows/fields, a resend is a blind
replace of the seed side (`petRepo.upsertSeededPet`) — no merge, no risk to family
history.

---

## Conventions (inherited from the breeder core)
Same as `CLAUDE.md`: pages → repos → Dexie (pages never touch `db.*` or
`localStorage`); `crypto.randomUUID()` ids; soft delete only (`is_archived`, never
cascades); date-only fields are `YYYY-MM-DD` strings compared lexicographically,
only `created_at`/`updated_at` are full ISO; one thin repo per entity
(`getById`, `getAll`, `create`, `update`, `archive`, `hardDelete`); referential
integrity via a declared `referenceRegistry`; badges/dropdowns both read `vocab.js`.

Furever's `repoBase.js` is intentionally simpler than the breeder app's: no
editions, no cap, no demo read-only mode, so none of that coupling is present.

---

## Tables

Dexie schema (`furever/data/db.js`, one collapsed `version(1)` — same
pre-first-release editing rule as the breeder app):

```js
db.version(1).stores({
  pets:          'id, pup_id, source, breeder_id, species, is_archived',
  breeders:      'id, breeder_key, is_archived',
  household:     'id',
  contacts:      'id, pet_id, contact_type, is_archived',
  care_events:   'id, pet_id, plan_item_id, event_type, event_date, is_archived',
  care_plans:    'id, pet_id, category, is_archived',
  documents:     'id, pet_id, doc_type, doc_date, is_archived',
  photos:        'id, pet_id, taken_date, is_archived',
  files:         'id, created_at',
  content_packs: 'id, &pack_key'
});
```

Indexed = queried/filtered/sorted on. Every other field still persists and rides
the JSON backup.

### pets — top-level entity
The active-pet scope's root. Two kinds, same shape.

| field | indexed | notes |
|---|---|---|
| `id` | ✓ (pk) | UUID |
| `pup_id` | ✓ | seed upsert key; **present only on seeded pets** (sparse). A resend does `where('pup_id').equals(pupId)`. |
| `source` | ✓ | `seeded` \| `self` (vocab `PET_SOURCE`) |
| `breeder_id` | ✓ | FK → `breeders`, seeded pets only |
| `species` | ✓ | `dog` \| `cat` \| `other`; dog-first content |
| `name` | | call name |
| `date_of_birth` | | `YYYY-MM-DD`; the anchor for age-based schedule items |
| `sex` | | vocab `SEX` |
| `breed` | | |
| `joined_family_date` | | family-entered, partial: `YYYY` or `YYYY-MM` (never a day) — when this pet joined the household, distinct from `date_of_birth` |
| `photo_url` | | seed-provided avatar (URL, not blob — brief) |
| `content_pack_key` | | which fetched pack overlays this pet (→ `content_packs.pack_key`) |
| `seed` | | **unindexed snapshot** of the last received packet: `{ pupId, name, dob, sex, breed, photoUrl, note, pickupPlan:{photoUrl,date,time,place}, breederKey, receivedAt }`. Keeps "what the breeder sent" separable from family edits; the seed-owned identity fields above are re-derived from it on each resend. |
| `is_archived` | ✓* | *filtered in JS |

### breeders — seed-layer breeder identity
The "call us anytime" card, refreshed on resend, keyed on `breeder_key` so two
pups from one kennel share a row.

| field | indexed | notes |
|---|---|---|
| `id` | ✓ (pk) | |
| `breeder_key` | ✓ | stable dedupe/upsert key from the packet |
| `kennel_name` | | |
| `tagline` | | |
| `breeder_contact` | | `{ name, phone, email }` (seed layer) |
| `vet_contact` | | the **breeder's vet** `{ name, phone, address }` — a referral before the family has their own vet |
| `is_archived` | ✓* | |

### household — the family's own identity (singleton)
Family layer. **One row, fixed id `household`** (a singleton, via `householdRepo`):
"whose app is this". App-wide, not pet-scoped, so it carries no `pet_id` and nothing
points at it (not a `referenceRegistry` target). The family's vet and other contacts
are **not** here — those are family-wide `contacts` rows (below).

| field | indexed | notes |
|---|---|---|
| `id` | ✓ (pk) | always the literal `'household'` |
| `family_name` | | shown in the app banner as “{name} Family Pets” (e.g. `Carson` → “Carson Family Pets”); nullable until set. Room to grow (address/phone) later |
| `created_at`, `updated_at` | | |

### contacts — family's own contacts
Family layer. **Not** the breeder/breeder-vet (those are seed-layer, above). The
family-wide vet (`pet_id` null, `contact_type` `vet`) is what the Family & Settings
page reads/writes.

| field | indexed | notes |
|---|---|---|
| `id` | ✓ (pk) | |
| `pet_id` | ✓ | **nullable**: null = family-wide (shows for every pet); set = one pet |
| `contact_type` | ✓ | `vet` \| `emergency_vet` \| `groomer` \| `trainer` \| `other` |
| `name`, `phone`, `email`, `address` | | |
| `is_archived` | ✓* | |

### care_events — the append-only actuals log
The only place "done" is recorded. No future/planned rows exist.

| field | indexed | notes |
|---|---|---|
| `id` | ✓ (pk) | |
| `pet_id` | ✓ | scope index |
| `plan_item_id` | ✓ | **nullable**: the schedule item this satisfies (universal id, pack id, or a `care_plans.id`). Null = freeform log. Drives the derived reminder. |
| `event_type` | ✓ | vocab `CARE_EVENT_TYPE` |
| `event_date` | ✓ | the **actual** date it happened |
| `title` | | |
| `details` | | unindexed, type-specific `{}` (e.g. `{ vaccine }`, `{ weight_lbs }`) |
| `is_archived` | ✓* | |

### care_plans — family-authored cadences only
Universal + breeder-pack schedule items are **content**, not rows. This table is
just the family's own (“vet said every 6 weeks”). Each row's `id` is the
`plan_item_id` a logged actual references.

| field | indexed | notes |
|---|---|---|
| `id` | ✓ (pk) | |
| `pet_id` | ✓ | scope index |
| `category` | ✓ | vocab `CARE_CATEGORY` |
| `label` | | |
| `anchor` | | `start_date` (default) \| `dob` (vocab `PLAN_ANCHOR`) — **decision: family plans anchor to their start date, not DOB** |
| `start_date` | | required when `anchor='start_date'` |
| `offset` | | `{ unit, value }` from the anchor to first due |
| `cadence` | | `{ kind:'once' }` or `{ kind:'recurring', interval, unit }` |
| `is_archived` | ✓* | |

### documents — the document vault
Family layer. Each owns exactly one `files` row.

| field | indexed | notes |
|---|---|---|
| `id` | ✓ (pk) | |
| `pet_id` | ✓ | scope index |
| `doc_type` | ✓ | `contract` \| `registration` \| `microchip` \| `insurance` \| `vet_record` \| `other` |
| `doc_date` | ✓ | newest-first sort |
| `title` | | |
| `file_id` | | FK → `files` (owned; deleted with the document) |
| `is_archived` | ✓* | |

### photos — the gallery
Family layer. Each owns one `files` row.

| field | indexed | notes |
|---|---|---|
| `id` | ✓ (pk) | |
| `pet_id` | ✓ | scope index |
| `taken_date` | ✓ | newest-first sort |
| `caption` | | |
| `file_id` | | FK → `files` (owned) |
| `is_archived` | ✓* | |

### files — the blob archive
Bytes behind `documents` and `photos`. Never queried but by id; owned by exactly
one row and deleted alongside it (so **not** a `referenceRegistry` target).

| field | indexed | notes |
|---|---|---|
| `id` | ✓ (pk) | |
| `created_at` | ✓ | backup ordering |
| `blob`, `name`, `mime`, `size` | | |

### content_packs — the fetched-once breeder overlay
Persisted cache of a breeder's custom care content (too big to text — brief
appendix), fetched once and used offline. `pack_key` unique; a re-fetch upserts.

| field | indexed | notes |
|---|---|---|
| `id` | ✓ (pk) | |
| `pack_key` | ✓ unique (`&`) | referenced by `pets.content_pack_key` |
| `kennel_name`, `version` | | |
| `fetched_at` | | |
| `payload` | | care-guide prose + schedule overrides/additions + feeding guidance |

---

## Referential integrity (`referenceRegistry.js`)
One declared list of every FK pointing **at** each entity; hard delete is blocked
whenever any reference exists (archive instead). Canonical direction only — the
reverse is always a derived query.

- **PET_REFERENCES** — `care_events.pet_id`, `care_plans.pet_id`, `contacts.pet_id`,
  `documents.pet_id`, `photos.pet_id`.
- **BREEDER_REFERENCES** — `pets.breeder_id`.
- **CARE_PLAN_REFERENCES** — `care_events.plan_item_id`. (A logged actual against a
  family plan blocks its delete. Universal/pack item ids also live in
  `plan_item_id` but point at content, not a row, so they never match this guard —
  intended.)
- **Leaves** (nothing points at them): `contacts`, `care_events`, `documents`,
  `photos`, `content_packs`. `files` is owned by one document/photo and deleted by
  it, never guarded.

**When you add an FK, add its line here** or hard delete will silently orphan.

---

## The schedule engine (`schedule.js`)
Stores nothing. Given a pet, its normalized schedule items, and its `care_events`,
it computes each item's live state:

- Items come from three sources, normalized to one shape: universal
  (`careLibrary.js`, dogs), a breeder pack (`content_packs`), and family
  `care_plans`. Each has a **stable id** = the `plan_item_id` a logged actual uses.
- **One-time item:** `done` once any matching actual exists; else due at
  `anchor + offset`.
- **Recurring item:** next due = latest matching actual `+ interval`, or the first
  due (`anchor + offset`) when nothing is logged. Never shows `done`; it rolls
  forward.
- Status buckets: `overdue` / `due_soon` (≤14 days) / `upcoming` / `done` /
  `unscheduled` (anchor missing, e.g. DOB unknown).
- `familyDueSoon(perPet)` is the cross-pet feed for the one family-wide page.

`careLibrary.js` ships a representative universal dog schedule (puppy vaccine +
deworming series, arrival-week well-visit, monthly preventative, annual exam/
boosters), a feeding guide, and a poisonous-foods list. It is a **shape-correct
starter, not a vet-authoritative protocol** — real content is a launch task.
Schedule item ids are shipped-stable (logged history references them).

---

## Decided
- **`breeder_key` is part of the packet.** The seed packet carries a stable
  `breederKey` (alongside the per-pup `pupId`) so the normalized `breeders` table
  can dedupe two pups from one kennel; `breederRepo.upsertFromSeed` keys on it.
- **Deploy domain: `furever.kennelos.app`.** Its own GitHub Pages origin (deploy
  repo `NoliCommoveri/KennelOS-Furever`), isolating the family's storage — wired in
  `.github/workflows/deploy.yml` + the `assemble.mjs` standalone build path.

## Open questions / decisions still to make
- **Snooze/dismiss a due item.** Deliberately **not** in v1: with no stored
  reminder rows there's nowhere to hang "remind me next week," and the due-soon
  list simply keeps showing an item until it's logged. Add a small per-item snooze
  row only if it turns out to nag.
- **Pickup countdown resend path.** Whether a changed pickup time re-triggers a
  full seed upsert (current assumption — it's just seed fields) or wants a lighter
  dedicated path (brief open question).
- **Multi-species depth.** Schema is species-agnostic; only the schedule/content is
  dog-first. Other species are records-only until a content pack exists.

## Deploy (wired)
Furever ships through the same pipeline as the editions, as a **standalone app**:
- `build/assemble.mjs` has a standalone path (`assembleStandalone`) that copies
  `furever/` → `dist/furever/`. Dexie is **committed** at `furever/vendor/dexie.min.mjs`
  (like `shared/vendor/`) so the source folder is directly servable with no build;
  the assembler re-copies the same file from `shared/vendor/` as a parity refresh.
  Run: `node build/assemble.mjs furever`.
- `.github/workflows/deploy.yml` has a matrix entry publishing `dist/furever/` to
  `NoliCommoveri/KennelOS-Furever` `main` with CNAME `furever.kennelos.app`.
- **Operational prerequisites (outside this repo):** the `EDITIONS_DEPLOY_PAT`
  secret must include `Contents: write` on `KennelOS-Furever`; that repo needs
  GitHub Pages enabled (source = `main`, custom domain `furever.kennelos.app`,
  Enforce HTTPS); and DNS for `furever.kennelos.app` must point at Pages.
- Until the app's pages exist, `furever/index.html` is a clean "coming soon"
  placeholder, so the live origin is a real page rather than a 404.

## Built (UI: left-sidebar shell + pet-scoped pages)
The app shell and pages now sit on the data layer (`furever/README.md` has the
file map):
- `app.js` / `nav.js` — shell boot + a **constant banner** (the app title "Furever /
  by KennelOS" left, the family's name "{name} Family Pets" right, linking to the
  Family page) over the **left sidebar** (`At A Glance`, one entry per pet, `Add New
  Pet`) which is also the **active-pet picker** (the pet-as-scope decision, made real:
  picking a pet re-scopes every page), plus the pet-scoped **top sub-nav** (Profile /
  Reminders / Log). The sidebar is an off-canvas drawer on mobile (opened from the ☰
  in the banner).
- `pages/family.*` — **Family & Settings**: the family name (→ `household` singleton,
  surfaced in the banner), the family-wide **vet** (→ a `contacts` row, `pet_id` null),
  and a simple **theme switcher** (Warm / Ocean / Forest / Berry / Slate — a
  localStorage pref applied to `<html data-theme>`, pre-paint via `bootcheck.js`).
- `pages/today.*` — **At A Glance**: the family-wide **due-soon feed**
  (`schedule.familyDueSoon`), the one cross-pet view; carries no sub-nav.
- `pages/profile.*` — a pet's landing page: an Add-Picture box (the chosen image is
  downscaled to a data URL and stored in `pet.photo_url`) plus the pet's details at a
  large size, with inline editing.
- `pages/reminders.*` — the active pet's **derived schedule** (`evaluateSchedule`)
  with a one-tap **log-done** that appends a `care_events` actual (the reminder clears
  / a recurring item rolls forward).
- `pages/log.*` — the active pet's **care history** (the logged `care_events` actuals).
- `pages/addpet.*` — the **Add New Pet** form (creates a self pet, then opens Profile).
- `assets/petSchedule.js` assembles a pet's schedule sources (universal library +
  family plans; packs deferred) so At A Glance and Reminders agree; `assets/ui.js`
  holds the shared `esc`/`badge` helpers and `imageFileToDataUrl` (profile-photo
  downscale).

## Built (seed-link decoder)
`furever/data/seedLink.js` decodes a breeder-sent `#seed=<lz-string-compressed
JSON>` link and applies it — no encoder/generator yet (that's a future breeder-side
step; a family can't currently receive a link, only an already-built test payload
can exercise this). `index.html` forwards its whole hash to `pages/today.html`
unchanged (already wired); `app.js`'s `boot()` calls `consumeSeedLinkIfPresent()`
**before** `renderNav()`, so the sidebar already reflects the new pet on first
paint. The packet is **one flat object** shaped to match what the two seed-layer
upserts already read by name — `breederRepo.upsertFromSeed` (`breederKey`,
`kennelName`, `tagline`, `breederContact`, `breederVet`) and
`petRepo.upsertSeededPet` (`pupId`, `name`, `species`, `sex`, `breed`, `dob`,
`photoUrl`, `contentPackKey`, plus `note`/`pickupPlan` which ride along unindexed
in `pet.seed`) — so decode is just decompress → parse → validate → upsert breeder
→ upsert pet.
- **Format decision:** `#seed=<payload>`, extracted with a plain string-prefix
  check, deliberately **not** `URLSearchParams` — lz-string's
  `compressToEncodedURIComponent` charset includes a raw `+`, and form-decoding's
  "+ → space" rule would silently corrupt it.
- **Landing + cleanup:** on success the family is redirected to that pet's Profile
  (`location.replace('profile.html')`, not wherever the link happened to open),
  and the hash is stripped via `history.replaceState` immediately on read —
  success or failure — so a reload/share/back-button can't re-seed or leak the
  packet.
- **Malformed link:** `SeedLinkError` with a friendly, family-facing message
  surfaced through the page's existing `#page-error` box; the rest of the app
  boots normally underneath (never a hard fail).
- **Resend = upsert, verified:** a second link with the same `pupId` updates the
  seed fields in place (name, DOB, etc.) — no duplicate pet, family-layer data
  untouched. Browser-verified (headless Chromium): fresh install via a seed link
  → lands on the new pet's Profile with the sidebar already showing it; a resend
  with the same `pupId` updates in place; a malformed `#seed=` shows the friendly
  error and Today still renders. No console errors from app code.

## Not built yet
The breeder-side **seed-link generator** (Pro authors and sends the link the
decoder above consumes — out of scope here), the **one-time content-pack fetch**,
the **document / photo / contact** pages, **import-export / backup**, the
pre-pickup **countdown card** (the packet already carries `pickupPlan`, but no
page renders it yet), and the **service worker / PWA / precache** (offline +
install). The app runs online today; the offline layer is deferred until the page
set settles. The deploy pipeline is ready to ship whatever `furever/` contains.
