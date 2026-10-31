# KennelOS — Lite / Pro / Demo editions

A local-first dog-breeding records app: static, multi-page, no build step, hosted on GitHub
Pages. All data lives in the browser (IndexedDB via Dexie). It covers dogs, contacts, kennels,
pairings, litters, sales, contracts, stud services, waitlists, shows, financials, reports,
CSV/JSON import and export, and family share-out. One shared core is built into three editions.
The opt-in cloud backup and sync server is separate, and the app runs without it.

## Layout

```
shared/   The core: database, repos, vocab, pages, assets, vendor, sw.js. What Pro ships.
lite/     Lite (free): fewer pages + a soft cap (6 dogs / 10 litters) + archive-on-departure.
pro/      Pro (paid): the full app + license gate (Lemon Squeezy). Pro-only files stay in
          shared/, listed in shared/data/proPages.js so the Lite build drops them.
demo/     Pro in seeded, read-only demo mode.
build/    assemble.mjs: shared/ + edition overlay → dist/<edition>/.  See build/README.md.
cloud/    Opt-in cloud backup + live sync API (Cloudflare Worker + D1 + R2), deployed
          separately by Workers Builds.  See cloud/README.md.
site/     Marketing website at kennelos.app (plain HTML, not a PWA).  See site/README.md.
furever/  KennelOS Furever: a separate family-facing pet-care app.  See furever/README.md.
tests/    node --test suites (plus cloud/tests).
docs/     Plans, specs, the code map, and the build log (below).
```

Each edition deploys to its own origin so its IndexedDB stays isolated. A JSON export, or cloud
backup, carries a program from Lite to Pro.

## Where to look

| You need… | Read |
|---|---|
| Edition design, tiers, licensing, Lite scope | `docs/KennelOS_Lite_Pro_Editions_Plan.md` |
| Lite cap rules | `docs/KennelOS_Lite_Cap_Enforcement_Spec.md` |
| How the `shared/` code works: data model, schema, repos, invariants, change recipes | `docs/End_State_Design_and_Maintenance_Guide.md` |
| Cloud backup / live sync | `docs/KennelOS_Cloud_Phase1_Plan.md`, `docs/KennelOS_Cloud_Phase2_Sync_Plan.md`, `cloud/README.md` |
| Vault, license link, integrations | `docs/KennelOS_Private_Vault_Plan.md`, `docs/KennelOS_License_Link_Plan.md`, `docs/KennelOS_Integrations_Plan.md` |
| Waitlist, shows, reports, multi-kennel | `docs/KennelOS_Waitlist_Spec.md` (+ `_W2_Plan`), `docs/KennelOS_Show_Tracking_Spec.md`, `docs/KennelOS_Reports_Plan.md`, `docs/KennelOS_Multi_Kennel_Scope_Spec.md` |
| App alerts (web push) and email digests | `docs/KennelOS_Notifications_Plan.md` |
| Kels on the family pages (help, FAQ) | `docs/KennelOS_Family_Help_Plan.md` |
| Families asking for extras, pickup times, transport, backing out | `docs/KennelOS_Family_Requests_Plan.md` |
| Furever | `docs/KennelOS_Furever_*.md`, `furever/README.md` |
| Kels (the guided-task helper): what's next | `docs/KennelOS_Kels_Roadmap.md` (built tasks: End-State guide §33) |
| Launch to-dos | `docs/LAUNCH_CHECKLIST.md` |
| What was built when, past fixes | `docs/BUILD_LOG.md` |

## Status (2026-10-15)

- **The editions are feature-complete and live:** Lite with its cap, Pro with its license gate
  on, Demo, front doors, guided tours, marketing site, and cloud backup (Phase 1).
- **In progress:**
  - Integrations: next is step 8, an e-sign provider (SignWell / BoldSign). The Jotform steps
    still need proving against a real account.
  - Cloud Phase 2 live sync: released. Next is checking it on real phones (iPhone and Android)
    on production; step 7, the live nudge, is optional. Production has every cloud migration
    through `0016` applied; `0017` (the R2 orphan sweep's state) is waiting to be applied from
    /ops after the next Worker deploy. Staging isn't in use, so deploys there aren't tracked.
  - Notifications (app alerts and the email digest): built. Next: generate the push key on
    /ops and add it as the `VAPID_PRIVATE_JWK` secret, apply migration `0018` after the
    Worker deploy, then check alerts on a real Android phone and an iPhone.
  - Duplicates: Import/Export's Scan for duplicates covers every record type. Open: Kels's
    Tidy up still checks only dogs and contacts for duplicates.
- **Open launch items:** confirm `yearlyVariantPattern` / `lifetimeVariantPattern` against
  the store's real variant names. Click the six site checkout links after each deploy
  (`--release` doesn't check them). See `docs/LAUNCH_CHECKLIST.md`.

Add new history to `docs/BUILD_LOG.md`, not here. Keep this section to a few lines.

## Build, run, test

```sh
python3 -m http.server 8000      # then open http://localhost:8000/shared/  (never file://)
node --test                      # all tests, Node ≥ 22, no dependencies
node build/assemble.mjs          # → dist/{lite,pro,demo}/
```
