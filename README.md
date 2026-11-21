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
| One sale form for every buyer: the side sale's checks, deposit due date and waitlist link on every sale (plan) | `docs/KennelOS_Unified_Sale_Plan.md` |
| Waitlist, shows, reports, multi-kennel | `docs/KennelOS_Waitlist_Spec.md` (+ `_W2_Plan`), `docs/KennelOS_Show_Tracking_Spec.md`, `docs/KennelOS_Reports_Plan.md`, `docs/KennelOS_Multi_Kennel_Scope_Spec.md` |
| App alerts (web push) and email digests | `docs/KennelOS_Notifications_Plan.md` |
| Staying inside the email provider's daily limit on heavy weeks, loud failures, notifications on family pages, tap to text (plan) | `docs/KennelOS_Mail_Budget_Plan.md` |
| Voice: push-to-talk in the app, a calendar feed, an Alexa skill (weight checks, waitlist questions, actions confirmed on the phone, reminders), Google and other home assistants, Siri Shortcuts, an LLM fallback (leaning Claude Haiku) with costs (plan) | `docs/KennelOS_Voice_Plan.md` |
| Kels on the family pages (help, FAQ) | `docs/KennelOS_Family_Help_Plan.md` |
| Families asking for extras, pickup times, transport, backing out | `docs/KennelOS_Family_Requests_Plan.md` |
| Families changing their answers themselves before pups are born | `docs/KennelOS_Family_Free_Changes_Plan.md` |
| One family who applied twice to a waitlist (merging duplicate applications) | `docs/KennelOS_Duplicate_Applications_Plan.md` |
| Support helping a user in her own program (assisted setup, ongoing help, the manager app) | `docs/KennelOS_Assisted_Setup_Plan.md` |
| Furever | `docs/KennelOS_Furever_*.md`, `furever/README.md` |
| Kels (the guided-task helper): what's next | `docs/KennelOS_Kels_Roadmap.md` (built tasks: End-State guide §33) |
| Launch to-dos | `docs/LAUNCH_CHECKLIST.md` |
| Sending dogs between breeders (Dog Cards, live updates) | `docs/KennelOS_Shared_Dogs_Plan.md` |
| Breeder to breeder: stud services, co-owns and leases, and sales online; public profiles (plan) | `docs/KennelOS_Breeder_To_Breeder_Plan.md` |
| A review of the whole app, run over several sessions | `docs/KennelOS_Review_Plan.md` (findings in `docs/review/`) |
| Fixing the review's remaining findings (everything open outside K15), in nine batches (plan) | `docs/KennelOS_Review_Remainder_Plan.md` |
| Fixing what the waitlist reviews found, with Pup selected, Already Reserved and family pages without the list (plan) | `docs/KennelOS_Waitlist_Fixes_Plan.md` |
| Several due dates on a sale (payment schedules, payments received), and the invoices, receipts, contracts and family pages that use them (plan) | `docs/KennelOS_Payment_Schedule_Plan.md` |
| Sending raw data to her KennelPort website (plan) | `docs/KennelOS_Website_Contract_Plan.md` |
| One inbox: status-page, KennelPort and breeder messages in one place (plan) | `docs/KennelOS_One_Inbox_Plan.md` |
| A dog's titles as a field (bought champions, ancestors), with show tracking still working them out (plan) | `docs/KennelOS_Dog_Titles_Field_Plan.md` |
| The UI redesign to the forest look: what moves where, phases, and checking every screen against the approved prototype (plan) | `docs/KennelOS_UI_Redesign_Plan.md` (prototype: `docs/design/forest-look-prototype.html`) |
| Line management: how every dog relates to every other (COI, shared ancestors, pairing warnings), traits, her own colors, birth records, what dogs carry, the pairing finder (plan) | `docs/KennelOS_Line_Management_Plan.md` |
| Program types: the kind of program she runs (show, family pet, doodle, working, stud, large kennel) sets her tabs, Home and features; each type's top priorities (plan) | `docs/KennelOS_Program_Types_Plan.md` |
| Registry codes by country (FCI and others), how AKC records imports and foreign sires, AKC titles before and after the name (fact check) | `docs/KennelOS_Registry_Title_Facts.md` |
| Credits: one currency for passes, per-use services and add-ons, enforced on the server (plan) | `docs/KennelOS_Credits_Plan.md` |
| Pages that settle at once (nothing moving mid-tap), a lighter shell, fewer reads and checks per page, and a read-only tour whose sample data clears itself (plan) | `docs/KennelOS_Load_Performance_Plan.md` |
| Waitlist timers: turns in hours ending in families' waking hours, and countdowns to picks opening and a turn's deadline (the turn estimate was replaced by status page pop-ups, End-State guide §29) | `docs/KennelOS_Waitlist_Timers_Plan.md` |
| Stripe webhook for waitlist deposits: the turn runs its full time, and at the deadline a received deposit locks in the selected pup while KennelOS is closed (plan) | `docs/KennelOS_Stripe_Webhook_Plan.md` |
| Making KennelOS harder to copy: repo visibility, licenses, minified builds, hosting (plan) | `docs/KennelOS_Security_Hardening_Plan.md` |
| What's on the `next` branch (the next release, at next-pro.kennelos.app) and its log until it's brought in | `docs/NEXT.md` (the copy on `origin/next`) |
| What was built when, past fixes | `docs/BUILD_LOG.md` |

## Status (2026-11-17)

- **Live:** Lite with its cap, Pro with its license gate, Demo, front doors, guided tours, the
  marketing site, cloud backup, live sync, notifications, family requests, waitlist policies,
  the KennelPort website feed, the puppy portal (KennelOS's side), payment schedules, dog
  titles, and e-sign through Firma. Every deploy and migration is applied and the launch
  checklist is done. The Worker stays on Workers Free until a limit is hit
  (`docs/LAUNCH_CHECKLIST.md` §2).
- **In progress:**
  - The review's open findings are planned in `docs/KennelOS_Review_Remainder_Plan.md`
    (nine batches, owner decisions R1–R7 all made): all nine built. Left from the review:
    K15 (the UI redo, with group J) and K16 (the summary).
  - Shared dogs (`docs/KennelOS_Shared_Dogs_Plan.md`): Dog Cards (phase 1) built; its open
    questions are answered, and phases 2 (live updates) and 3 are plans.
  - KennelPort: the website raw-data sections and `origin_country` wait on KennelPort's own
    steps (`docs/KennelOS_Website_Contract_Plan.md`). A breeder's own domain is added by hand
    to `WEBSITE_ORIGINS` in `cloud/wrangler.toml`.
  - Duplicates: Kels's Tidy up checks only dogs, contacts and waitlist applications.
  - Load performance (`docs/KennelOS_Load_Performance_Plan.md`): Phases 0 (load budgets,
    `build/loadCheck.mjs`), 1 (nothing moves after first paint) and 2 (the read-only tour)
    built; next is Phase 3. Dog and Sale still shift as their sections fill in (no phase
    covers it).
  - Next release: the `next` branch publishes a Pro test build at next-pro.kennelos.app; what's
    on it is in `docs/NEXT.md` on that branch.
  - One sale form for every buyer (`docs/KennelOS_Unified_Sale_Plan.md`): Phase 1 (every
    sale's checks, held pup, deposit due date, two claims settled) built; Phases 2 (a buyer on
    the list, the side-sale dialog retired) and 3 (old sales) next.
  - Planned, not built: credits, security hardening, mail budget, voice, family help,
    duplicate applications, assisted setup, line management, program types, the Stripe
    webhook for waitlist deposits (owner questions open).

Add new history to `docs/BUILD_LOG.md`, not here. Keep this section to a few lines.

## Build, run, test

```sh
python3 -m http.server 8000      # then open http://localhost:8000/shared/  (never file://)
node --test                      # all tests, Node ≥ 22, no dependencies
node build/assemble.mjs          # → dist/{lite,pro,demo}/
node build/assemble.mjs pro --channel next   # → dist/next-pro/ (the test build; build/README.md)
```
