# KennelOS — Lite / Pro / Demo editions

Local-first, static, multi-page dog-breeding records app (no backend, no build
step), split into editions. One shared core; thin editions on top..

```
shared/   The database, repos, vocab, shared pages (Dogs, Breeding, Sales,
          Today, …), assets, vendor, and editionConfig.js (the per-edition
          injection point — this copy is the Pro/no-op default).
lite/     Lite (free): shared pages only + a soft cap + archive-on-departure.
pro/      Pro (paid): the full app; holds the Pro-only pages + license gate.
demo/     Pro with demo mode on: seeded, read-only showcase.
site/     The public marketing WEBSITE at the apex domain (kennelos.app) — who we
          are, the editions comparison, a page per edition, Furever, FAQ, and the
          Lite→Pro upgrade landing page. Plain HTML/CSS, deliberately NOT a PWA
          (no manifest, no service worker); every "Get the app" button links out
          to an edition's own origin. See site/README.md.
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
    enter key + optionally name this device), a **renewal wall** (lapsed past grace: re-check /
    renew / use a different key), and a dismissible **grace banner**. Invoked from `app.js`'s
    `boot()` before the app renders.
  - **Activation slots are releasable.** Lemon Squeezy counts *activations* against the
    variant's activation limit — a plain counter, not device detection; nothing anywhere reads
    the machine. `deactivate()` hands a slot back, surfaced two ways: **Import/Export → "This
    device's license"** (`releaseThisDevice()`, the deliberate "I'm done with this device"
    action — clears the local record **only** if the release succeeded, so a failed call never
    costs the owner both the device and the slot), and the renewal wall's *use a different key*
    (`resetLicense()`, best-effort, since an already-walled owner must not be trapped). Without
    this, every cleared browser and replaced laptop consumed a slot permanently, so an owner
    could reach "no activations left" through ordinary browser hygiene with no in-app fix.
    Each activation is named `"<owner's label> · <8 chars of a random per-browser id>"`
    (`kennelOS.deviceId`, excluded from Reset App) — it used to be the app's own hostname,
    identical for every buyer, which made "which slot do I release?" unanswerable.
    `recordFromPayload()` also lets an explicit `valid:false` downgrade an otherwise-`active`
    key to `inactive`, so a released or de-authorized device actually walls (a more specific
    `expired` is preserved — it earns its grace window).
  - **One flag, Pro-only** — `editionFlags.licenseGate` is true only in `pro/editionConfig.js`;
    Lite is free and Demo is a public showcase, so the gate is inert there (verified: Lite/Demo
    render with no wall). The Lemon Squeezy checkout URL lives in Pro's `licenseConfig`.
- **Marketing site — built (`site/`).** The public website that advertises the product
  and sends visitors to the right edition: home, editions comparison, a page each for
  Lite / Pro / Demo / Furever, About, FAQ, and `/upgrade` (the landing page Lite's
  "Upgrade to Pro →" button already points at). It borrows the app's design tokens but
  is a **plain website, not a PWA** — no manifest, no service worker, so it never
  competes with the apps' install prompt and is exempt from the `PRECACHE_URLS` /
  `CACHE_NAME` rules. `node build/assemble.mjs site` copies it to `dist/site/`; the
  deploy workflow publishes it to `NoliCommoveri/kennelos-site` at `kennelos.app`.
  Content placeholders still to fill (checkout URLs, support email, the "who we are"
  story) are listed in `site/README.md`.
- **Multi-kennel scope, Phase 1 — done & browser-verified (headless Chromium, all three
  editions, no console errors).** Kennel becomes a real scope rather than a lookup. Design +
  the remaining phases: `docs/KennelOS_Multi_Kennel_Scope_Spec.md`.
  - **Schema (pre-launch, deliberately now)** — `kennel_id` added to `pairings`/`litters`/
    `sales`/`stud_services`/`contracts`/`documents` in the still-editable `version(1)` block,
    with the six matching `KENNEL_REFERENCES` entries. Doing this after the first release would
    mean a versioned migration plus a backfill over live data. A new test parses `db.js` and
    fails if a declared `*kennel_id` index has no registry entry.
  - **Every scoped create is stamped** by inheriting from its parent — a sale from its dog, a
    contract from its sale, a puppy from its litter, a litter/pairing from its dam then sire —
    falling back to the active/sole kennel (`data/kennelScope.js`). `kennel_id` is **required**
    on `owned`/`co_owned` dogs and must be an own kennel; `external`/`leased_in` dogs keep an
    optional, outside-pointing kennel and are scope-transparent.
  - **First-run kennel setup is now a MANDATORY gate** — no "Skip for now" (the skip flag is
    gone entirely), no Cancel, no Escape, no backdrop close, and it re-fires on every load until
    an own kennel exists, so reloading can't escape it. Import/Export's deliberate reopen keeps a
    Cancel. Demo stays exempt. **Skipping the tour** now ends it the same way finishing does:
    the seed is cleared immediately and setup follows.
  - **Pro-only** (`editionFlags.multiKennel`): Lite is single-kennel, renders no kennel picker,
    and auto-stamps its one kennel. A new test asserts every edition config declares every shared
    flag — the gap that first shipped `multiKennel` missing from `pro/` and `demo/`.
- **Multi-kennel scope, Phase 2 — done & browser-verified (headless Chromium, all three
  editions, no console errors).** The scope goes live: one switcher, and every list, hub, and
  report segmented by it.
  - **The switcher** — `shared/assets/kennelScopeUI.js` holds all three pieces of scope UI:
    the nav's active-kennel `<select>` (an empty `#nav-kennel-scope` slot `nav.js` renders
    edition-agnostically), the **"kennel only" chip** a scoped list/report carries in its
    toolbar with a one-click "Show all", and the **out-of-scope banner** on a detail page.
    Switching reloads — pages build their view models once at load, so one repaint of the
    truth beats a partial re-render.
  - **One lever for every list screen** — `listView.js` and `reportView.js` both take a
    `scope` predicate, applied before search/filters (so CSV exports the scoped set). Callers
    pass `inScope` (stamped record), `dogInScope` (dogs — external/leased stay transparent),
    or `subjectInScope` (a polymorphic Event, scoped through its subject). Everything off
    those frameworks — Today, dashboard, breeding, sales, financials (income AND the
    polymorphic expense ledger), nudges, the away board, and all ten reports — is hand-scoped.
  - **What is deliberately NOT scoped is the load-bearing half**, each with a comment at its
    call site: **pedigree/lineage** (a truncated pedigree is the worst regression available
    here), **detail pages reached by id** (a direct link must always resolve — the record
    renders in full above a "belongs to <kennel>" banner with a one-click switch, never a
    404), **external/leased dogs**, and the **contact pool** (a buyer who bought from two of
    your kennels is one person).
  - **Pickers are scoped by default with an escape** (spec §9) — sire/dam, the linked-pairing
    picker, the sold dog, our stud, and the expense subject each gain a "show all my kennels"
    checkbox beside the existing "include archived" one, because co-breeding across your own
    kennels and stud services are intentionally cross-kennel.
  - **Kennel is a hub now** — `kennel.html` gained roster counts, active litters, recent
    placements, and that kennel's P&L, all reporting on the kennel you *opened* rather than
    the active scope; `kennels.html` gained a portfolio of your own kennels with live counts
    and the switch into each (silent until a second own kennel exists).
  - **Tested** — the pure predicates moved into a db-free `shared/data/scopePredicates.js`
    (the split spec §16 held in reserve) with 12 unit tests pinning the two directions that
    matter: nothing hidden when unscoped, nothing scope-transparent ever hidden.
- **Multi-kennel scope, Phase 3 — done & browser-verified (headless Chromium, no console
  errors).** The trailing identity/import/seed assumptions from Phases 1-2. Design +
  full status: `docs/KennelOS_Multi_Kennel_Scope_Spec.md` §15.
  - **Own-kennel identity** — `invoice.js`/`puppy-record.js` no longer resolve "which own
    kennel" as `kennels.find(k => k.is_own_kennel)` (first match, wrong the moment a second
    own kennel exists). Both now try the record's own `kennel_id` (a Sale/StudService always
    carries one), then the dog's, then the **active kennel scope**
    (`kennelScope.getActiveKennel()`), then the sole own kennel — so a document for a
    kennel-B sale carries kennel B's name/logo regardless of which kennel the app happens to
    be scoped to.
  - **CSV kennel column** — Dog, Pairing, Litter, Sale, and StudService all take an
    optional `kennel_name` column, resolved the same way as every other relationship column:
    case-insensitive/trimmed against existing kennels, own-kennel-only for the four scoped
    tables (Dog only when `owned`/`co_owned`), and **flagged to review** — never silently
    invented, never silently defaulted — when a named kennel doesn't resolve. A blank column
    still falls back to the active/sole kennel at commit, same as before this column existed.
  - **Sample seed's second own kennel** — Briar Hollow Kennels (Cassius × Opal, Golden
    Retrievers — a third breed line makes it visually distinct from Thornfield's Bostons/
    Boxers) with its own litter, placed pup, and delivered sale. Meadow Ridge stays Dana's
    *outside* kennel (the external-ownership demo) and was never a scope; this is the first
    seed record the switcher actually segments. Verified in a headless-Chromium seed run: 3
    kennels (2 own), the nav switcher lists both, no console errors.
  - **Companion/Furever settings stay global — owner decision.** Weighed per-kennel keying
    against staying one shared identity/template set across all your own kennels, and staying
    global won: it's simpler, and per-kennel keying would also have touched the Furever
    identity block's entanglement with the Drive content-pack pointers and the `breederKey`
    dedup, where a wrong call risked breaking already-sent packets. A multi-kennel breeder
    swaps the kennel name/tagline by hand before sending if they want per-send branding.
  - `editionFlags.multiKennel` needed no new work — it already existed everywhere Phase 1
    put it.
- **Kennel identity & Kennel Cards — done & browser-verified (headless Chromium, all three
  editions, no console errors).** The first half of "an enforceable source of truth for
  cross-kennel references", built **without a backend**. Design + full detail:
  `docs/End_State_Design_and_Maintenance_Guide.md` §28.
  - **The problem** — every cross-kennel reference (a stud service with an outside dog, a
    dog's `breeder_kennel_id`, a foster partner's kennel) is a Kennel row that exists only
    in *your* IndexedDB. The breeder on the other side has their own unrelated row for the
    same real-world kennel, and nothing ever reconciles the two.
  - **`kennels.public_id` (schema, pre-launch, deliberately now)** — a portable
    `kos1_<uuid>` identity, indexed, minted once for an **own** kennel and immutable
    thereafter. An **outside** kennel is never minted one locally; it can only ever be
    *received*, because minting one would be inventing somebody else's identity. It rides
    the JSON backup, the Lite→Pro bridge, and Dropbox sync for free (`importExport.js` is
    table-generic) — which is exactly why doing it before the first release is nearly free
    and doing it after would be a versioned migration plus a backfill over live data.
  - **Kennel Cards** (`data/kennelCard.js` + Pro-only `assets/kennelCardUI.js`) — a small
    lz-string payload, sent as a link or a copyable code, that lands in another breeder's
    app as a Kennel record carrying your `public_id`. Peer-to-peer: **no registry, no
    directory, no lookup, no server, no network call.** Same named-copy allow-list posture
    as `companionExport.js` (identity only — never the kennel's program config, logo, or
    anything about dogs, people, or money), and the same dry-run-preview-before-commit rule
    every import in the app follows.
  - **The load-bearing rule** — a received card can never set `is_own_kennel`, and a card
    naming one of your own kennels is refused with nothing written. An imported kennel in
    your own-kennel set would enter your scope switcher, portfolio, test vocabulary, and
    (in Lite) cap accounting.
  - **Reconciliation, offered not automatic** — match-or-create keys on `public_id`; on a
    create the preview additionally *offers* any unlinked same-name kennel you typed in
    yourself, so linking keeps everything already pointing at it instead of stranding it on
    a duplicate. A name is not a key, so it is never auto-matched.
  - **Not multi-device.** A card carries identity, not records; a second device restores a
    backup or syncs via Dropbox, and the import preview says so when fed your own card.
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
- Companion share-out, the Furever seed-link generator, Feeding Schedules
  (per-breed feeding grids fed into the Furever seed packet), Assistant,
  Documents + file storage.
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
- **Litter form's "Feeding schedule override" field** is hidden entirely in Lite
  (Pro-only) — the per-litter override for the Feeding Schedules feature.
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
