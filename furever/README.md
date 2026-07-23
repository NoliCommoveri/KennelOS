# furever/

**KennelOS Furever** — the free, family-facing pet-care app a puppy family installs
at pickup and keeps for years. A **separate app** from the breeder app and from the
Companion share-out: its own origin, its own IndexedDB (`KennelOSFurever`), its own
data model.

- **Develop here, in the main KennelOS repo.** This folder is the source of truth.
- **Deploys to `NoliCommoveri/KennelOS-Furever`** at `furever.kennelos.app`, published
  from `main` the same way the breeder-app editions ship. Wired: `assemble.mjs` builds
  it via a standalone path (`node build/assemble.mjs furever`) and
  `.github/workflows/deploy.yml` publishes `dist/furever/`. Live-deploy prerequisites
  (the `EDITIONS_DEPLOY_PAT` covering this repo, Pages + DNS for the domain) are noted
  in `build/README.md`.

## Status: data layer + first UI slice (app shell + core pages)
The data layer (schema, repos, referential-integrity registry, controlled
vocabularies, universal care content, derived-reminder engine) is complete, and the
**first working UI** now sits on top of it: an app shell (nav + active-pet picker)
and three core pages — **Today** (the family-wide due-soon feed), **Pets** (roster +
add-a-pet + set-active), and **My Pet** (the active pet's derived schedule with a
one-tap "log done", plus care history). Browser-verified (headless Chromium: add a
dog → its schedule projects from DOB → checking an item off logs an actual and the
item clears/rolls forward → Today's cross-pet feed updates; no console errors).

Still to build (each a later step): the **breeder seed-link decoder** (lz-string) so
a texted link seeds a pup, the **content-pack fetch**, the **document/photo/contact**
pages, **import-export/backup**, the **pre-pickup countdown card**, and the
**service worker / PWA / manifest** (offline + install). The app runs online today;
the offline layer is deliberately deferred until the page set settles.

```
furever/
  index.html             — front door: redirects to Today (carries any #hash for the
                           future seed-link decoder)
  app.js                 — shared boot: renders nav, requests persistent storage once
  nav.js                 — top nav + the app-wide active-pet picker
  assets/
    app.css              — the single stylesheet (warm palette; badge-* match vocab)
    ui.js                — esc()/badge()/showError() + small date/age helpers
    petSchedule.js       — assembles a pet's schedule sources and evaluates them
                           (shared by Today + My Pet)
    bootcheck.js         — classic (non-module) guard: surfaces a fatal module-load
                           failure instead of a page stuck on "Loading…"
  pages/
    today.html + .js     — the family-wide due-soon feed (the one cross-pet view)
    pets.html  + .js      — roster (seeded vs. self) + add-a-pet form + set active
    pet.html   + .js      — the active pet: derived schedule, log-done, care history
  vendor/
    dexie.min.mjs        — vendored Dexie, COMMITTED (like shared/vendor/) so the
                           folder is directly servable — no build step to run it
  data/
    db.js                — Dexie schema (KennelOSFurever), the two-layer model
    repoBase.js          — thin repo factory (no editions/cap/demo coupling)
    referenceRegistry.js — every FK, drives hard-delete blocking
    dateUtils.js         — YYYY-MM-DD arithmetic + offsets
    vocab.js             — controlled vocabularies (badges + dropdowns)
    settings.js          — active pet (app-wide scope) + UI prefs, localStorage
    careLibrary.js       — universal dog schedule + feeding/safety content (shipped)
    schedule.js          — the DERIVED reminder engine (stores nothing)
    petRepo.js           — top-level entity; seed upsert by pup_id
    breederRepo.js       — seed-layer breeder identity (upsert by breeder_key)
    contactRepo.js       — family's own contacts (vet, groomer, …)
    careEventRepo.js     — append-only actuals log ("what happened")
    carePlanRepo.js      — family-authored cadences
    documentRepo.js      — document vault (owns a file)
    photoRepo.js         — gallery (owns a file)
    fileRepo.js          — blob archive behind documents/photos
    contentPackRepo.js   — fetched-once breeder overlay cache
  README.md
```

## Read these
- `docs/KennelOS_Furever_Schema.md` — the data-model spec this code implements
  (the two design decisions: pet-as-scope and derived reminders).
- `docs/KennelOS_Furever_Family_App_Brief.md` — the starter brief / product intent.

## Conventions
Same as the breeder core (`CLAUDE.md`): pages → repos → Dexie; UUID ids; soft
delete only; date-only fields are `YYYY-MM-DD`; one thin repo per entity; referential
integrity via `referenceRegistry.js`. Serve over HTTP, never `file://`.
No build step for the app itself; verify touched modules with `node --check`.

## Local dev
Serve the `furever/` folder directly and open Today — Dexie is committed under
`vendor/`, so no build is needed to run it:

```
python3 -m http.server 8000 --directory furever   # then open /pages/today.html
```

The `node build/assemble.mjs furever` path is only for producing the deployable
`dist/furever/` (it re-copies the same vendored Dexie). **If pages render but stay
stuck on "Loading…" with an empty nav, a module failed to load** — almost always a
missing `vendor/dexie.min.mjs`; `bootcheck.js` now turns that silent hang into a
visible error.
