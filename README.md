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
| Her policies on the waitlist pages (plan) | `docs/KennelOS_Waitlist_Policies_Plan.md` |
| What opening picks will do (the picks preview), and selling a pup outside the turn order (side sales) | `docs/KennelOS_Picks_Preview_Spec.md`, `docs/KennelOS_Side_Sale_Spec.md` |
| Waitlist, shows, reports, multi-kennel | `docs/KennelOS_Waitlist_Spec.md` (+ `_W2_Plan`), `docs/KennelOS_Show_Tracking_Spec.md`, `docs/KennelOS_Reports_Plan.md`, `docs/KennelOS_Multi_Kennel_Scope_Spec.md` |
| App alerts (web push) and email digests | `docs/KennelOS_Notifications_Plan.md` |
| Kels on the family pages (help, FAQ) | `docs/KennelOS_Family_Help_Plan.md` |
| Families asking for extras, pickup times, transport, backing out | `docs/KennelOS_Family_Requests_Plan.md` |
| One family who applied twice to a waitlist (merging duplicate applications) | `docs/KennelOS_Duplicate_Applications_Plan.md` |
| Support helping a user in her own program (assisted setup, ongoing help, the manager app) | `docs/KennelOS_Assisted_Setup_Plan.md` |
| Furever | `docs/KennelOS_Furever_*.md`, `furever/README.md` |
| Kels (the guided-task helper): what's next | `docs/KennelOS_Kels_Roadmap.md` (built tasks: End-State guide §33) |
| Launch to-dos | `docs/LAUNCH_CHECKLIST.md` |
| Sending dogs between breeders (Dog Cards, live updates) | `docs/KennelOS_Shared_Dogs_Plan.md` |
| A review of the whole app, run over several sessions | `docs/KennelOS_Review_Plan.md` (findings in `docs/review/`) |
| Fixing what the waitlist reviews found, with Pup selected, Already Reserved and family pages without the list (plan) | `docs/KennelOS_Waitlist_Fixes_Plan.md` |
| Several due dates on a sale (payment schedules, payments received), and the invoices, receipts, contracts and family pages that use them (plan) | `docs/KennelOS_Payment_Schedule_Plan.md` |
| Sending raw data to her KennelPort website (plan) | `docs/KennelOS_Website_Contract_Plan.md` |
| A dog's titles as a field (bought champions, ancestors), with show tracking still working them out (plan) | `docs/KennelOS_Dog_Titles_Field_Plan.md` |
| Registry codes by country (FCI and others), how AKC records imports and foreign sires, AKC titles before and after the name (fact check) | `docs/KennelOS_Registry_Title_Facts.md` |
| What was built when, past fixes | `docs/BUILD_LOG.md` |

## Status (2026-10-15)

- **The editions are feature-complete and live:** Lite with its cap, Pro with its license gate
  on, Demo, front doors, guided tours, marketing site, and cloud backup (Phase 1).
- **In progress:**
  - Integrations: step 8, e-sign through Firma on KennelOS's own account with a monthly send
    limit (plan §2.3a): built, Worker and app. Next is the first run on production with the
    live key (`docs/LAUNCH_CHECKLIST.md`); its migrations `0022`–`0024` are applied.
    Jotform is retired; pasted contract-form links stay as the free fallback. Her
    countersignature (D32, before or after the buyer) and kept signed copies emailed to
    buyers (D33) are built, to be proven on the same run.
  - Cloud Phase 2 live sync: released. Next is checking it on real phones (iPhone and Android)
    on production; step 7, the live nudge, is optional. Production has every cloud migration
    through `0024` applied. Staging isn't in use, so deploys there aren't tracked.
  - Notifications (app alerts and the email digest): live.
  - Family requests (`docs/KennelOS_Family_Requests_Plan.md`): extras, transport suggestions,
    training stays, pickup and backing out are live, and Kels's Review my waitlist works through them.
  - KennelPort website (`docs/End_State_Design_and_Maintenance_Guide.md` §35): the feed and
    Connect / Update website are live. Raw data for it (`docs/KennelOS_Website_Contract_Plan.md`):
    all of KennelOS's side built (C1–C7, C9). KennelPort takes none of the new sections
    until its own steps 4 to 7. A breeder's own domain is added by hand to
    `WEBSITE_ORIGINS` in `cloud/wrangler.toml` (KennelPort Setup, Custom domains, step C).
  - Waitlist policies, the program suggested by an application answer, the do-not-sell list
    and transport accounts on the website: live.
  - Puppy portal (KennelPort's `docs/Puppy_Parent_Portal_Plan.md`, guide §35.1): KennelOS's
    side of phase 1 is live (the family feed sent on its own, the facts back, the status
    page's one-tap link).
  - Shared dogs (`docs/KennelOS_Shared_Dogs_Plan.md`): Dog Cards (phase 1) are built. Next:
    phase 2, live updates through the cloud, after owner decisions.
  - Waitlist fixes and three enhancements (`docs/KennelOS_Waitlist_Fixes_Plan.md`): steps
    1–4 are built (Pup selected, Already Reserved, family pages without the list, the puppy
    portal says only what's true); next is step 5 (money a family is shown; K8-1 and K8-10
    are built with Payment schedules step 6). Five
    decisions about the fixes are open (its §2).
  - Payment schedules (`docs/KennelOS_Payment_Schedule_Plan.md`): several due dates per sale,
    payments received, the per-family invoice/receipt generator and Firma fields per template.
    Steps 1–8 built (guide §21.3, §24 and the sections they name): every surface reads the
    statement. Open in step 5: proving the Firma relabel on a send (one field so far,
    `docs/LAUNCH_CHECKLIST.md`), the test-key check, per-template fields. §3.2a (lost-pup
    money as a credit, D20) is in no step yet.
  - Duplicates: Import/Export's Scan for duplicates covers every record type. Open: Kels's
    Tidy up checks only dogs, contacts and waitlist applications for duplicates.
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
