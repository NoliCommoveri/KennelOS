# CLAUDE.md — KennelOS (Lite / Pro / Demo editions)

Local-first, static, multi-page dog-breeding records app. No backend, no build step;
GitHub Pages hosting; all data lives in the browser (IndexedDB via Dexie). **This repo
builds the app as three editions off one shared core** — Lite (free), Pro (paid), Demo
(seeded read-only). See the top-level `README.md` for the layout and current build status.

The full feature set (Dogs, Contacts, Kennels, Pairings, Litters, Sales, Contracts,
Stud Services, a polymorphic event log, reminders, dashboard, reports, CSV/JSON
import-export, Companion share-out, Dropbox sync + KennelAssistant) already exists — it
is the code now under **`shared/`**, and it is what **Pro** ships. The editions work is
splitting that core, adding Lite's cap + reduced surface, and Demo's read-only mode.

## Read first, every session

1. **`README.md`** (repo root) — the editions layout + build status. Start here.
2. **`docs/KennelOS_Lite_Pro_Editions_Plan.md`** + **`docs/KennelOS_Lite_Cap_Enforcement_Spec.md`**
   — the authoritative design + target for Lite / Pro / Demo. This is current-state intent.
3. **`docs/End_State_Design_and_Maintenance_Guide.md`** — **REFERENCE ONLY.** The detailed
   map of the pre-editions single app, which is the code now under `shared/`. Everything
   in it about the data model, Dexie schema, repos, referential integrity, the Event
   model, escaping, and the change recipes still applies to `shared/` code; wherever it
   says `KennelOS/…` or a bare `data/…` / `assets/…` / `pages/…` / `sw.js`, read it as
   `shared/…`. It is NOT a description of the repo as a whole.

Undocumented decision → ask, don't invent. Design-decision-adjacent change → surface it
and invite pushback before implementing.

## ⚠️ Keep the docs true when you change the app

Two things must stay true: the **editions docs** (`README.md` + the Lite/Pro plan &
cap spec) for anything edition-shaped, and the **End-State guide** as the map of the
`shared/`/Pro code. **After any structural change, update the relevant doc(s) in the
same change** so the next session starts from the truth. Update the End-State guide
(§ paths translate to `shared/…`) when you:

- add/remove/rename a table, index, or field in `shared/data/db.js`;
- add or change a foreign key or a `shared/data/referenceRegistry.js` entry (this is the
  one that gets forgotten — a new FK must land in **both** the registry and the guide's
  data-model + schema sections);
- add or change an entity, repo, page, event type, or controlled vocabulary;
- change a documented invariant, relationship direction, or a component's behavior.

Doc-only edits and pure-internal refactors that leave every stated fact true don't
need a guide edit — but **if in doubt, update it.** Keep the guide's field tables,
schema block, and section prose all consistent with each other and with the code.

## ⚠️ Service-worker cache — never skip this

This is the single most-forgotten step. The app is an offline PWA with a **cache-first**
service worker, so an installed client only picks up changed files when the cache name
changes. **There is one service worker per edition, but you only maintain ONE:**
`shared/sw.js`. Each edition's `dist/<edition>/sw.js` is **generated** by
`build/assemble.mjs` — it copies `shared/sw.js`, gives it an edition-specific
`CACHE_NAME`, and filters the precache to the files that edition actually ships (Lite
drops the Pro-only pages from `shared/data/proPages.js`). **Never hand-edit a
`dist/*/sw.js`** — edit `shared/sw.js` and re-assemble. **Whenever you add, rename, or
remove any app file** (`.html`/`.js`/`.css`, an icon, a `vendor/` or `resources/` asset):

1. Update the `PRECACHE_URLS` list in `shared/sw.js` (the one source) to match
   (add/rename/remove the entry). `cache.addAll` is atomic — one missing or misnamed
   path fails the whole install and silently breaks offline. (If the new file is
   Pro-only, also add it to `shared/data/proPages.js` so the Lite build excludes it.)
2. **Bump `CACHE_NAME`** in that `sw.js` (e.g. `kennelos-shell-vN` → `vN+1`).
   Without this, clients keep serving the old cache and never see your change.
   **Never bump on your own initiative — ASK the user to confirm they're done, and
   bump only after they say so.** One rollover per shippable batch, not per edit.
   Concretely:
   - Do all the file/content edits first, leaving `CACHE_NAME` untouched, and when you
     think the batch is complete **ask** ("Ready to bump the SW cache, or more changes
     coming?") rather than assuming. We run long multi-turn sessions and a bump per turn
     churns through versions for no benefit.
   - Once bumped **within a session, that version stands** — further edits in the same
     session ride the *same* pending version (it hasn't shipped to clients yet, so it
     still correctly represents the new file set). Do **not** keep incrementing
     `vN → vN+1 → vN+2` across turns of one session; re-bump only after a deploy has
     actually gone out, or the user asks for a fresh rollover.
   - (`PRECACHE_URLS` edits in step 1 are not optional and still land with the edit
     that changes the file set — this ask-first rule is about `CACHE_NAME` only.)

There is a sanity check (a short Python snippet) in the End-State guide's invariants
section that lists any app file missing from the precache and any precache entry with
no file on disk — run it if you touched the file set. Editing an *existing* file's
contents still needs a `CACHE_NAME` bump so clients re-fetch it — but the same ask-first,
one-bump-per-batch rule applies.

## Architecture non-negotiables
- Multi-page static: one `.html` per section, shared JS (`nav.js`/`db.js`/repos). No SPA router.
- ES modules over HTTP(S). Serve via `python3 -m http.server` or `npx serve` — never `file://` (CORS-blocks module imports).
- No CDN deps — vendor everything into `shared/vendor/`, load by relative path. Must work offline after first load.
- Strict layering: pages → repos → Dexie. Pages never call `db.*` directly, and never touch `localStorage` (go through a repo / `settings.js`).
- One thin repo per entity: `getById`, `getAll({includeArchived})`, `create`, `update`, `archive`, `hardDelete`. New entity = new repo + page; don't reshape existing ones.
- **Editions layering:** the shared core stays edition-agnostic — it never hardcodes a
  cap or a Pro/Lite check. Anything edition-specific goes through a per-edition **injection
  point**: `shared/data/editionConfig.js` (cap hooks, flags, nav) and
  `shared/data/editionTour.js` (the guided-tour package — sample seed + step catalog). Each
  edition ships its own copy at that fixed shared path; `build/assemble.mjs` overlays it (Lite
  supplies both overrides; Pro/Demo use the shared defaults). Pro-only *pages* live in `pro/`,
  not `shared/`, so they're physically absent from the Lite download (that absence IS the
  paywall).

## Two decisions — do not re-litigate
- One `Dog` table for breeding stock, puppies, external dogs. Life-stage change = `status` update on the same record, never a new record.
- One `Event` table for all dated history (polymorphic `subject_type`/`subject_id`), no per-type tables. Its JS module is named `HistoryEvent`/`eventRepo` — **never a bare `Event`** (DOM collision).

## Data conventions
- `id`: `crypto.randomUUID()`, client-side. No auto-increment.
- Soft delete only (`is_archived`). Never cascades, never destroys history.
- Date-only fields (`date_of_birth`, `event_date`, …) are `YYYY-MM-DD` strings, compared lexicographically. Only `created_at`/`updated_at` are full ISO.
- **Schema versioning:** all tables currently live in one collapsed `db.version(1)` block. It is still editable **only because nothing has shipped that needs migration** — reconcile any change with Reset App + re-seed. At the first real release this changes permanently: from then on schema changes are **additive only** — new tables/indexes go in a new `db.version(N).stores({...})` block and shipped blocks are never edited again.
- Only fields you query/filter/sort on are indexed; every other field still persists and rides the JSON backup. Pickers exclude archived by default (toggle to include). Status/type = colored badges sourced from `data/vocab.js` (dropdowns and badges both read from it, so they never drift).
- Escaping: `reportView` `value` functions return plain text (framework escapes); `listView` `cell` functions and any hand-built innerHTML must `esc()` every user value.

## Referential integrity
- Driven by `referenceRegistry.js` (a declared list of every FK pointing **at** each entity). **When you add an FK anywhere, add its line to the registry** or hard-delete will silently allow orphaning.
- Hard delete is blocked if any reference exists — archive only. The blocking message is generated entirely from the registry, so it always matches whatever tables currently exist; no hand-maintained carve-out.
- One canonical direction per relationship; the reverse is **always a derived query, never a stored back-pointer**. Need the reverse of X? Write a query — don't add a mirror field.

## CSV import
- Match-or-create by natural key, never UUID. Every import is a dry-run preview (create/update/needs-review) before commit.
- Keyless/partial-key rows → always "needs review," never auto-matched or silently created. Name match is case-insensitive + trimmed; dates exact. Relationship columns resolve against existing records only — an unresolved name is flagged, never invented.

## Local dev & verification
- Serve the repo root: `python3 -m http.server 8000` (or `npx serve`), never `file://`.
  The full app today is under `shared/` — open `http://localhost:8000/shared/`. (Edition
  front doors under `lite/`/`pro/`/`demo/` are not wired yet — see `README.md`.)
- No build, test runner, or linter. Verification = `node --check <file>.js` on anything you touched, serving locally and exercising the flow in a browser, and the precache sanity check above. State resets via **Reset App to Start**; sample data via the first-run prompt or Import/Export.
