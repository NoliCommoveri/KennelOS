# KennelOS — Lite / Pro / Demo editions

Local-first, static, multi-page dog-breeding records app (no backend, no build
step), split into editions. One shared core; thin editions on top.

```
shared/   The database, repos, vocab, shared pages (Dogs, Breeding, Sales,
          Today, …), assets, vendor, and editionConfig.js (the per-edition
          injection point — this copy is the Pro/no-op default).
lite/     Lite (free): shared pages only + a soft cap + archive-on-departure.
pro/      Pro (paid): the full app; holds the Pro-only pages + license gate.
demo/     Pro with demo mode on: seeded, read-only showcase.
furever/  KennelOS Furever — a SEPARATE family-facing pet-care app (its own origin
          + IndexedDB, not an edition of the breeder core). Data layer + first UI
          slice: app shell (nav + active-pet picker) and the Today / Pets / My Pet
          pages (derived care schedule with log-done). Deploys to
          NoliCommoveri/KennelOS-Furever at furever.kennelos.app (standalone build
          path). See furever/README.md.
```

Each edition deploys to **its own origin** (a subdomain) so its IndexedDB stays
isolated; JSON export/import is the Lite→Pro upgrade bridge. See
`docs/KennelOS_Lite_Pro_Editions_Plan.md` and `KennelOS_Lite_Cap_Enforcement_Spec.md`
(carried over from the original repo) for the full design.

## Build status

- **Foundation — done (branch `claude/editions-foundation`):** the app is relocated
  into `shared/`; the editionConfig injection point is wired (no-op) into
  `dogRepo.create/update` and `litterRepo.create`; `lite/pro/demo/` exist as config
  skeletons; docs + CLAUDE.md carried over and marked for the editions architecture.
  **No behavior change yet.**
- **Step 2 — partition, chosen approach = Option B (single `pages/` root; Pro-only
  pages excluded from the Lite *build*, not physically moved).** Every page stays in
  `shared/pages/`, so all existing relative links keep working; Lite ships fewer files.
  - **Done & browser-verified (headless Chromium, both editions, no console errors):**
    edition-driven nav (Lite = Today/Dogs/Breeding/Sales/Financials + Import-Export);
    Pro-only `editionFlags`; within-page gating so Lite hides the in-page doors to Pro
    features (Dog profile stud/contract/documents; Sale buyer/referred-by links +
    Contracts panel; Financials invoice button + expense receipt-attach; Sales contract
    block + seg-tabs; Pairing stud panel; Litter foster-partner link; Dashboard waitlist
    tile; Dog ownership picker → owned/co_owned only).
  - **Lite build mechanics — done & browser-verified against the built artifacts:**
    `shared/data/proPages.js` (canonical Pro-only page list); `build/assemble.mjs`
    (copies `shared/` → `dist/<edition>/`, overlays the edition config, excludes the
    Pro-only files for Lite, regenerates `sw.js` with an edition cache name + filtered
    precache); Import/Export page gated too (Pro CSV options + Dropbox/Assistant section).
    Confirmed on `dist/lite`: Pro pages return **404**, no console errors. See `build/README.md`.

  **Step 2 is complete — the partition (nav + gating + Lite build) is done.**
- **Step 3 — the Lite cap, done & browser-verified (headless Chromium, both editions,
  no console errors).** The full `KennelOS_Lite_Cap_Enforcement_Spec.md` is now
  implemented:
  - **Real cap** in `lite/editionConfig.js` — `enforceDogCap`/`enforceLitterCap` with the
    6/2 caps and the `countsTowardDogCap` predicate (owned/co-owned live adults;
    `is_archived` counts as departed). Block rule is transition-in only (create or a
    ✗→✓ maturing pup); editing a counting dog and departing one are never blocked.
    `CapExceededError` lives in `shared/data/repoBase.js` beside `ReferenceBlockedError`.
  - **Upgrade nudge** — the three write forms (dog, litter, and the Today promote-pup
    nudge) catch `CapExceededError` and render `shared/assets/upgradeNudge.js` (a friendly
    prompt + "Upgrade to Pro →" CTA that exports a JSON backup then heads to checkout),
    never a raw error.
  - **Archive-on-departure** — Lite has no free Archive button; a dog leaves via a
    confirmed "Remove from program" departure (dog profile + sale-delivery flow, replacing
    Pro's ownership→External prompt). Sold pups depart the same way.
  - **Hidden archive machinery** — `editionFlags` (`manualDogArchive`,
    `includeArchivedToggles`, `archivedDogLinks`) hide the mechanism: no "Show archived"
    toggle (listView) or picker toggle, and a departed dog's name renders as plain text
    (no link, no "arch" badge, no ↗) everywhere it appears — pedigree tree + offspring,
    the pedigree root picker, dog/litter/pairing/sale references (shared `dogRefHtml`).
  - Pro/Demo keep the shared no-op config, so **no cap logic ships in the Pro download**
    and Pro's archive UX is unchanged.
- **Step 4 — edition front doors + in-Lite Demo/Pro links, done & browser-verified
  (headless Chromium, both editions, no console errors).**
  - **Per-edition PWA identity** — `build/assemble.mjs` now stamps each artifact's
    `manifest.json` (`name`/`short_name`) and root `index.html` `<title>` to
    `KennelOS Lite` / `Pro` / `Demo`, so an installed edition reads as its own app.
  - **In-Lite outbound links** — `shared/assets/editionLinks.js` renders Lite's
    **"See the full app ↗"** (→ the Demo origin) and **"Upgrade to Pro →"** in **two
    spots**: the nav "More" menu (every page) and a footer on Today. Driven entirely by
    `demoUrl`/`upgradeUrl` in `editionConfig` — both `null` in Pro/Demo, so nothing
    renders there (`hasEditionLinks()` false). The Upgrade CTA runs the shared
    export-first bridge (`runUpgradeBridge`, now shared with the cap upgrade nudge):
    export the JSON backup, then head to checkout. `demoUrl` (Lite) points at the Demo
    origin — placeholder until the domain is live.
- **Step 5 — Demo mode (read-only, seeded showcase), done & browser-verified (headless
  Chromium, all three editions, no console errors).**
  - **One-lever read-only** — `shared/data/demoMode.js`: `assertWritable()` is called at
    the top of every repo write (`repoBase` create/update/hardDelete, and `fileRepo`) and
    throws a friendly `DemoModeError` ("This is a demo — changes aren't saved") in demo.
    Pages surface it the same way they already surface cap/reference errors. The sample
    seed writes through those same repos, so it runs inside `withSeedAllowed()` — a window
    user writes never get. `isDemo()`/the guard are no-ops in Lite/Pro (verified: Lite
    writes still work), so no demo wording ships in those builds.
  - **Auto-seed on load** — `app.js` seeds the sample packet when the DB is empty (through
    the seed window) then reloads once so the page renders against seeded data; blocked
    writes keep it pristine across visits. Demo skips the first-run/kennel-setup/sample
    prompts and shows a persistent "read-only demo" banner.
  - **Save/export stripped** — Import/Export removed from demo nav *and* excluded from the
    demo build (`assemble.mjs`; a direct URL 404s). `restoreBackup()` also asserts writable.
- **Step 6 — per-edition guided tour, done & browser-verified (headless Chromium, Lite build,
  no console errors).** The tour + its sample data are now injected per edition via
  `shared/data/editionTour.js` (a second injection point beside `editionConfig.js`; the shared
  copy re-exports the full Thornfield seed + `WIZARD_STEPS`, and `build/assemble.mjs` overlays
  `<edition>/editionTour.js` when present — only Lite ships one).
  - **The bug it fixes:** the shared Thornfield packet (21 dogs / 5 litters) run through Lite's
    repos tripped the cap mid-seed (`litterRepo.create` threw on the 3rd litter) *before* the
    manifest was written — leaving orphan dogs with no "Clear Sample Data" banner — and the
    shared tour then walked to Pro-only pages that 404 in Lite.
  - **`lite/editionTour.js`** — a smaller packet sized to exactly the 6-dog / 2-litter cap (so
    the seed completes *and* the kennel reads as "at the cap", teeing up the upgrade pitch), no
    Pro-only entities, plus a Lite step catalog that visits only Lite's pages and folds in
    `pro-promo` upsell cards (a new centered step kind, Lite-only). Finishing still clears the
    seed and hands off to kennel setup. Demo has no tour (its boot returns before the wizard),
    so it's unaffected; Pro is unchanged.
- **Step 7 — Pro license gate, done & browser-verified (headless Chromium, all three
  editions, no console errors).** Pro is a Lemon Squeezy subscription unlocked by a
  browser-validated license key — no backend, per the plan's §Licensing.
  - **The gap it closes:** before this, `pro.kennelos.app` unlocked the full app for anyone
    who opened it — there was no key check anywhere. Selling a sub for something already free
    to any visitor was the real blocker between "I have a store" and "I can charge".
  - **`shared/data/license.js`** — `activate()`/`validate()` call Lemon Squeezy's
    browser-callable `POST /v1/licenses/activate` + `/validate` (license key in the body, no
    store secret), and a verdict state machine applies an **interval-scaled offline grace
    window** (yearly 7d, monthly 3d; unknown → the shorter). Interval is inferred from the
    returned `variant_name` against a configurable pattern. (Windows: yearly 7d, monthly 3d — see
    `data/license.js`'s `GRACE_MS` and the plan's §Licensing.) The cached activation lives under
    its own `settings.js` key, **excluded from Reset App** (entitlement isn't program data).
  - **`shared/assets/licenseGate.js`** — the UI: a full-screen **activation wall** (first run,
    enter key), a **renewal wall** (lapsed past grace: re-check / renew / use a different key),
    and a dismissible **grace banner**. Invoked from `app.js`'s `boot()` before the app renders.
  - **One flag, Pro-only** — `editionFlags.licenseGate` is true only in `pro/editionConfig.js`;
    Lite is free and Demo is a public showcase, so the gate is inert there (verified: Lite/Demo
    render with no wall). The Lemon Squeezy checkout URL lives in Pro's `licenseConfig`.
- **Next:** the editions build is now feature-complete (Lite cap, Pro + license gate, Demo,
  front doors, tour). Remaining before launch is deploy-time config, not code: buy the domain,
  wire the three publish repos + `EDITIONS_DEPLOY_PAT` (see `build/README.md`), swap the Lemon
  Squeezy `upgradeUrl` / Demo-origin `demoUrl` placeholders in `lite/editionConfig.js`, and
  swap Pro's `licenseConfig.checkoutUrl` (+ tune `yearlyVariantPattern`) in `pro/editionConfig.js`.

## Build & deploy

`node build/assemble.mjs` → `dist/{lite,pro,demo}/`, each a servable/deployable tree
(deploy each to its own origin). Details in `build/README.md`.

## Lite scope (decided)

What Lite ships, versus Pro-only. Pro-only *pages* live in `pro/` (physically absent
from Lite); a few Lite-kept *shared* pages render with pieces gated off via
`editionFlags`.

**Lite keeps (shared pages):** Dogs, Breeding (pairings/litters/puppies), Sales
(self + inline add-buyer), Today/dashboard, Import/Export, kennel setup (startup
selections), **Financials — the expense ledger + sales→income** ✅.

**Pro-only (absent from Lite):**
- People / Contacts section, full Kennel management, Stud services, Contracts.
- Companion share-out, the Furever seed-link generator, Assistant, Documents + file storage.
- External / leased dogs (Lite ownership picker = `owned` / `co_owned` only).
- **All Reports** (Reports hub + every report page).
- **Invoice / receipt generation** — the `pages/invoice.html` print doc.
- **Puppy Record generation** — the `pages/puppy-record.html` print doc.

**Shared pages that render differently in Lite (edition-flag gates, NOT omissions):**
- **Financials (`financials.js`)** — kept for expense tracking, but the **"Invoice /
  Receipt" generator button is hidden** in Lite.
- **Expense form** — kept, but the **"attach a receipt photo" widget is hidden**
  (receipts & file storage are Pro).
- **Dog Status picker** — reduced to Puppy / Active breeding / Retired breeding / Deceased;
  Pet home, For Sale, and External reference are Pro-only (cap spec §1a).
- **New Dog page** — shows a "Creating x/6 available dogs" counter under the title
  (cap spec §6), reading the same predicate the cap enforces.
- **Sale form's inline "＋ New" contact** (`contactPicker.js`) — the Contact type list
  drops to just Buyer, since full Contacts (People section) is Pro-only.
- **Sale form's "Referred by"** field/link is hidden entirely — it's a Buyer-referrer
  Contacts feature, Pro-only.
- **Litter form's "Foster arrangement" section** is hidden entirely in Lite (Pro-only).
  In Pro/Demo it's a `<details>` disclosure, collapsed by default and open only when
  the litter already has foster data.
- **Dashboard "Archived (any status)" tile** is hidden in Lite — archive counts are
  part of the hidden archive machinery (cap spec §7), not just the toggles/links.

(The cap itself — 6 counting dogs, 2 litters — and archive-on-departure are separate
from this page partition; see the cap spec.)

## Resuming in a new session

A new session starts cold (no memory of prior chats) but inherits this repo. To
continue: open a Claude Code session on `nolicommoveri/kennelos`, then:

> Continue the KennelOS editions build. Read `README.md` and `CLAUDE.md` first.
> Foundation is done. Do Step 2 — the shared↔Pro page partition — using the "Lite
> scope (decided)" section above. Go slow; surface any judgment calls before coding.

## Local dev

Serve the repo over HTTP (never `file://`): `python3 -m http.server 8000`, then open
an edition. Full app today lives under `shared/` (`shared/index.html`).
