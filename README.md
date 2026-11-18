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
| Staying inside the email provider's daily limit on heavy weeks, loud failures, notifications on family pages, tap to text (plan) | `docs/KennelOS_Mail_Budget_Plan.md` |
| Voice: push-to-talk in the app, a calendar feed, an Alexa skill (weight checks, waitlist questions, actions confirmed on the phone, reminders), Google and other home assistants, Siri Shortcuts, an LLM fallback (leaning Claude Haiku) with costs (plan) | `docs/KennelOS_Voice_Plan.md` |
| Kels on the family pages (help, FAQ) | `docs/KennelOS_Family_Help_Plan.md` |
| Families asking for extras, pickup times, transport, backing out | `docs/KennelOS_Family_Requests_Plan.md` |
| One family who applied twice to a waitlist (merging duplicate applications) | `docs/KennelOS_Duplicate_Applications_Plan.md` |
| Support helping a user in her own program (assisted setup, ongoing help, the manager app) | `docs/KennelOS_Assisted_Setup_Plan.md` |
| Furever | `docs/KennelOS_Furever_*.md`, `furever/README.md` |
| Kels (the guided-task helper): what's next | `docs/KennelOS_Kels_Roadmap.md` (built tasks: End-State guide §33) |
| Launch to-dos | `docs/LAUNCH_CHECKLIST.md` |
| Sending dogs between breeders (Dog Cards, live updates) | `docs/KennelOS_Shared_Dogs_Plan.md` |
| A review of the whole app, run over several sessions | `docs/KennelOS_Review_Plan.md` (findings in `docs/review/`) |
| Fixing the review's remaining findings (everything open outside K15), in nine batches (plan) | `docs/KennelOS_Review_Remainder_Plan.md` |
| Fixing what the waitlist reviews found, with Pup selected, Already Reserved and family pages without the list (plan) | `docs/KennelOS_Waitlist_Fixes_Plan.md` |
| Several due dates on a sale (payment schedules, payments received), and the invoices, receipts, contracts and family pages that use them (plan) | `docs/KennelOS_Payment_Schedule_Plan.md` |
| Sending raw data to her KennelPort website (plan) | `docs/KennelOS_Website_Contract_Plan.md` |
| A dog's titles as a field (bought champions, ancestors), with show tracking still working them out (plan) | `docs/KennelOS_Dog_Titles_Field_Plan.md` |
| Registry codes by country (FCI and others), how AKC records imports and foreign sires, AKC titles before and after the name (fact check) | `docs/KennelOS_Registry_Title_Facts.md` |
| Credits: one currency for passes, per-use services and add-ons, enforced on the server (plan) | `docs/KennelOS_Credits_Plan.md` |
| Making KennelOS harder to copy: repo visibility, licenses, minified builds, hosting (plan) | `docs/KennelOS_Security_Hardening_Plan.md` |
| What was built when, past fixes | `docs/BUILD_LOG.md` |

## Status (2026-11-17)

- **Live:** Lite with its cap, Pro with its license gate, Demo, front doors, guided tours, the
  marketing site, cloud backup, live sync, notifications, family requests, waitlist policies,
  the KennelPort website feed, the puppy portal (KennelOS's side), payment schedules, dog
  titles, and e-sign through Firma. Every deploy and migration is applied and the launch
  checklist is done. The Worker stays on Workers Free until a limit is hit
  (`docs/LAUNCH_CHECKLIST.md` §2).
- **In progress:**
  - Template library (Integrations plan §2.3b): proven on production except the copy down
    (a breeder's From KennelOS → Add, and Place fields / Preview on the copy). D41 (support
    sets who signs, the breeder the kind) is for the owner to confirm.
  - Waitlist fixes (`docs/KennelOS_Waitlist_Fixes_Plan.md`): all ten steps built. Open: D13
    (counting wrong code guesses per code) and one live Mapbox try of the address checks.
    The review's other open findings are planned in `docs/KennelOS_Review_Remainder_Plan.md`
    (nine batches, seven owner decisions R1–R7); none built yet.
  - Shared dogs (`docs/KennelOS_Shared_Dogs_Plan.md`): Dog Cards (phase 1) built; phase 2
    (live updates) waits on owner decisions.
  - KennelPort: the website raw-data sections and `origin_country` wait on KennelPort's own
    steps (`docs/KennelOS_Website_Contract_Plan.md`). A breeder's own domain is added by hand
    to `WEBSITE_ORIGINS` in `cloud/wrangler.toml`.
  - Duplicates: Kels's Tidy up checks only dogs, contacts and waitlist applications.
  - Planned, not built: credits, security hardening, mail budget, voice, family help,
    duplicate applications, assisted setup.

Add new history to `docs/BUILD_LOG.md`, not here. Keep this section to a few lines.

## Build, run, test

```sh
python3 -m http.server 8000      # then open http://localhost:8000/shared/  (never file://)
node --test                      # all tests, Node ≥ 22, no dependencies
node build/assemble.mjs          # → dist/{lite,pro,demo}/
```
