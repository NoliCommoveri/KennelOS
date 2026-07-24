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

## Status: data layer + UI (banner + left-sidebar shell + pet-scoped pages)
The data layer (schema, repos, referential-integrity registry, controlled
vocabularies, universal care content, derived-reminder engine) is complete, and the
UI sits on top of it. A **constant banner** tops every page — the app title
(`Furever` / `by KennelOS`) on the left and the family's name (`Carson Family Pets`)
on the right, linking to Family & Settings. Below it, **navigation is a LEFT
SIDEBAR** — `At A Glance` (the family-wide due-soon feed), one entry per pet (which
doubles as the active-pet picker), and `Add New Pet`. It's a persistent rail on
desktop and an off-canvas drawer that slides in from the left on mobile (opened from
the ☰ in the banner). Selecting a pet re-scopes the app and opens its **Profile**;
the pet-scoped pages — **Profile** (an Add-Picture box plus the pet's details at a
large size), **Reminders** (the derived schedule with one-tap "log done"), and
**Log** (the care history) — sit under a top sub-nav in the content column.
`At A Glance` has no sub-nav. **Family & Settings** collects the family name (stored
in a `household` singleton, shown in the banner), the family-wide vet (a `contacts`
row), and a simple **theme switcher** (Warm / Ocean / Forest / Berry / Slate, applied
to `<html data-theme>` and remembered). Browser-verified (headless Chromium: add a dog
→ Profile → set a picture → Reminders projects the schedule from DOB → log an item →
it moves to the Log; set family name + vet + theme → banner shows "Carson Family Pets"
and the palette persists across reloads; no console errors).

**The breeder seed link is now built end to end.** The decoder (`data/seedLink.js`,
this app): a texted `#seed=<lz-string-compressed JSON>` link is decoded and applied
through the existing seed-layer upserts (`breederRepo.upsertFromSeed` +
`petRepo.upsertSeededPet`), landing the family on their new pup's Profile with the
sidebar already showing it. A resend (same `pupId`) upserts in place; a malformed
link shows a friendly error and the app still boots. The **generator** lives on the
breeder side, in the main KennelOS repo's `shared/` app (Pro-only): the **Furever
console** (`shared/pages/furever.*`, "More" menu) — a one-time "Kennel identity"
card (kennel name/tagline, the breeder's own contact, their vet's contact,
`shared/data/settings.js`'s `getFureverSettings`/`setFureverSettings`) plus one row
per pup with an open sale, each with a personal note + pickup-plan fields
(`sales.furever_note`/`furever_pickup_*` — plain Sale fields, no schema change) and
a **Prepare link** action (`shared/data/fureverSeedExport.js` builds the packet,
same allow-list-by-name discipline as `companionExport.js`) that hands off a real
email/SMS send, mirroring the Companion feature's send mechanics. Browser-verified
end to end (headless Chromium): built a link on the breeder console → opened it →
the pet, breeder identity, note, and pickup plan all decoded correctly on the
Furever side; no console errors on either side.

Still to build (each a later step): the **content-pack fetch**, the
**document/photo/contact** pages, **import-export/backup**, the **pre-pickup
countdown card** (the packet already carries `pickupPlan`, no page renders it yet),
and the **service worker / PWA / manifest** (offline + install). The app runs
online today; the offline layer is deliberately deferred until the page set
settles.

```
furever/
  index.html             — front door: redirects to Today (carries any #hash so a
                           "#seed=…" breeder link reaches app.js's decoder there)
  app.js                 — shared boot: consumes a "#seed=…" link if present
                           (data/seedLink.js) before rendering nav, then requests
                           persistent storage once
  nav.js                 — the CONSTANT BANNER (app title "Furever / by KennelOS" +
                           the family name "…Family Pets") over the LEFT SIDEBAR
                           (At A Glance / pets / Add New Pet, the active-pet picker,
                           mobile drawer) + the pet-scoped top sub-nav (Profile /
                           Reminders / Log)
  assets/
    app.css              — the single stylesheet (theme palettes via [data-theme];
                           badge-* match vocab)
    ui.js                — esc()/badge()/showError(), imageFileToDataUrl() (profile
                           photo downscale) + small date/age helpers
    petSchedule.js       — assembles a pet's schedule sources and evaluates them
                           (shared by At A Glance + Reminders)
    bootcheck.js         — classic (non-module) guard: surfaces a fatal module-load
                           failure; also applies the saved theme pre-paint
  pages/
    today.html    + .js  — At A Glance: the family-wide due-soon feed (one cross-pet
                           view; no sub-nav)
    profile.html  + .js  — a pet's landing page: Add-Picture box (saved to
                           pet.photo_url) + large-font details, with inline edit
    reminders.html + .js — the active pet's derived schedule + one-tap log-done
    log.html      + .js  — the active pet's care history (the logged actuals)
    addpet.html   + .js  — the Add New Pet form (creates a self pet, opens Profile)
    family.html   + .js  — Family & Settings: family name, family-wide vet, theme
  vendor/
    dexie.min.mjs        — vendored Dexie, COMMITTED (like shared/vendor/) so the
                           folder is directly servable — no build step to run it
    lz-string.min.mjs    — vendored lz-string (copy of shared/vendor/), COMMITTED;
                           powers the seed-link hash compress/decompress
  data/
    db.js                — Dexie schema (KennelOSFurever), the two-layer model
    repoBase.js          — thin repo factory (no editions/cap/demo coupling)
    referenceRegistry.js — every FK, drives hard-delete blocking
    dateUtils.js         — YYYY-MM-DD arithmetic + offsets
    vocab.js             — controlled vocabularies (badges + dropdowns)
    settings.js          — active pet (app-wide scope) + UI prefs incl. theme, localStorage
    careLibrary.js       — universal dog schedule + feeding/safety content (shipped)
    schedule.js          — the DERIVED reminder engine (stores nothing)
    seedLink.js          — decodes + applies a breeder "#seed=…" link (decompress →
                           parse → validate → upsert breeder → upsert pet); no DOM
    petRepo.js           — top-level entity; seed upsert by pup_id
    householdRepo.js     — the family's own identity (singleton: family_name)
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
