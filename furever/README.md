# furever/

**KennelOS Furever** — the free, family-facing pet-care app a puppy family installs
at pickup and keeps for years. A **separate app** from the breeder app and from the
Companion share-out: its own origin, its own IndexedDB (`KennelOSFurever`), its own
data model.

- **Develop here, in the main KennelOS repo.** This folder is the source of truth.
- **Deploys to `NoliCommoveri/KennelOS-Furever`** (a GitHub Pages repo), published
  from `main` the same way the breeder-app editions ship — see
  `.github/workflows/deploy.yml` for the pattern. That deploy wiring is **not yet
  added** (needs a buildable app + a domain).

## Status: data layer only
What exists so far is the schema, repos, referential-integrity registry, controlled
vocabularies, the universal care content, and the derived-reminder engine. No pages,
nav, service worker, or deploy target yet.

```
furever/
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
