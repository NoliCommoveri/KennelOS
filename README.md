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
cloud/    The cloud backup API: one Cloudflare Worker + D1 + R2, deployed by
          Workers Builds (root directory cloud/), NOT by deploy.yml and not part of
          any edition build. The editions stay on GitHub Pages and call it
          cross-origin. See cloud/README.md and docs/KennelOS_Cloud_Phase1_Plan.md.
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
    6/10 caps and the `countsTowardDogCap` predicate (owned/co-owned live adults;
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
    bridge (`runUpgradeBridge`, now shared with the cap upgrade nudge): export the JSON
    backup, then head to checkout (or, since the vault, cloud first; see "Lite → Pro
    bridge, cloud first" below). `demoUrl` (Lite) points at the Demo
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
  - **`lite/editionTour.js`** — a smaller packet sized to exactly the 6-dog cap, with 2 litters
    (under the litter cap, which was 2 at the time and is now 10) (so
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
  - **Lifetime keys check in too.** A perpetual key never expires, but it is not exempt from
    offline re-validation: 90 days of full access from the last successful `/validate`, then 30
    days of a reconnect banner, then a wall — all reset by a single successful validate, so it
    only ever reaches a device that has been off the internet for a season. The exemption it
    replaces let one activated lifetime key run indefinitely on any number of machines without
    contacting the store again. A lifetime key blocked on staleness gets a **reconnect** wall,
    never the renewal wall (`isStaleLifetime`) — there is nothing to renew, and offering a
    checkout there would read as being asked to pay twice.
  - **`shared/assets/licenseGate.js`** — the UI: a full-screen **activation wall** (first run,
    enter key + optionally name this device), a **renewal wall** (lapsed past grace: re-check /
    renew / use a different key), and a dismissible **grace banner**. Invoked from `app.js`'s
    `boot()` before the app renders.
  - **Activation slots are releasable.** Lemon Squeezy counts *activations* against the
    variant's activation limit — a plain counter, not device detection; nothing anywhere reads
    the machine. `deactivate()` hands a slot back, surfaced two ways: **Settings → "This
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
- **Marketing site: official privacy policy + terms of use — built (2026-10-10).**
  `site/privacy.html` is rewritten as a full policy covering the whole backend as built: the
  apps, cloud backup, private backup, Pro purchases (the Lemon Squeezy webhook's hashed
  purchase email), the online waitlist for breeders and for applicants/families (W2 Plan
  step 8), the emails we send, providers, retention, security, rights, transfers, children.
  New `site/terms.html` (data ownership and backups, the cloud service, the waitlist, Pro
  licenses / payment / refunds, acceptable use, disclaimers, liability, governing law), linked
  from every footer, the sitemap and next to the checkout buttons. The other pages now
  describe private backup and Pro's online waitlist. Operator "KennelOS", governed by United
  States law (`terms.html` §18). Site only, so no `CACHE_NAME` bump.
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
- **Show tracking (Pro) — all 4 phases done (type + gating; points engine + dog card; Shows page; Today, nudge, sample data).** Building
  `docs/KennelOS_Show_Tracking_Spec.md`. No schema change — it rides the `events` table.
  - **`show` event type** in `vocab.js` plus `SHOW_ENTRY_STATUS`, `SHOW_ORGANIZATIONS`,
    `TITLE_TRACKS`, `AKC_SHOW_CLASSES`, `AKC_SHOW_AWARDS`; `handler` contact role, `show`
    expense category, and a "With handler / show circuit" boarding reason.
  - **Edition gating in one place** — new `editionFlags.shows` (on in shared/pro/demo, off in
    Lite) and the generic `editionFlag` descriptor key; `vocab.js` `enabledEventTypes()` feeds
    `eventTypesFor()`, so the event form, CSV import and assistant drop `show` in Lite, and
    Upcoming's Type filter reads it too.
  - **Event form** — value/label select options, field `default`, `titleFrom` auto-title,
    string `relatedContact` label ("Handler"), `prefill.event_date`, handler role tagging on
    save, club/judge suggestions from logged values, and the show soft checks.
  - **CSV** — `show` rows always match on title too, so a double-header's Show 2 lands in
    review instead of overwriting Show 1.
  - Browser-verified (headless Chromium): Pro form end-to-end; Lite build has no trace (type
    picker, Upcoming filter, CSV import).
  - **Phase 2 — points engine + dog card.** `shared/data/showPoints.js`: a db-free pure core
    (`trackProgress`, `showRecordFrom`) that derives points / majors / distinct judges /
    champion defeats per `TITLE_TRACKS` row, the completing-win date, human-readable gaps,
    and GCH's after-CH cut-off (from a logged CH `title_earned` or the completed CH track),
    plus the `getShowRecord(dogId)` loader; pinned by `tests/showPoints.test.js`. The dog
    page's **Show Record** card (Pro-only, appears once the dog has a show event) shows each
    track's progress and a clickable history; `timeline.js` gained an `onChange` hook so the
    card stays in step with Event History edits. Browser-verified (headless Chromium): card
    tallies + gaps, row edit and timeline archive both refresh it, no card on a dog without
    shows, none in the Lite build.
  - **Phase 3 — Shows page.** `shared/pages/shows.html` + `shows.js` (Pro-only via
    `PRO_ONLY_PAGES`; a tab of the Storage hub for shared/Pro/Demo, not Lite). **Upcoming**
    tab grouped by show day with entries-close flags (amber ≤ 7 days, red when past and still
    planned); **Results** tab with Dog / Organization / Period / Track filters + CSV export;
    rows open the event's edit modal. **+ Add entries** creates one show event per dog per
    day (scoped dog picker, "+ Next day" for clusters, skips entries already on file, tags the
    handler). Supporting generic pieces: `eventRepo.getByType()`, and `reportView`'s column
    `tone` + view `groupBy`. Browser-verified (headless Chromium): both tabs, tone flags,
    bulk create 2 dogs × 2 days, duplicate re-run skipped, handler tagged, row → edit modal;
    `shows.*` absent from `dist/lite/`.
  - **Phase 4 — Today, nudge, sample data.** Today's **Upcoming shows** card (next 14 days,
    grouped by day; shows leave the "Due outs & upcoming" card while the flag is on, so each
    is listed once). Ninth nudge, **"log the title?"** — a completed track with no matching
    `title_earned` deep-links to a prefilled title form (new generic `logDate` / `logTitle` /
    `logDetails` params on `openEventFromQuery`); it clears once the title is logged.
    Thornfield seed: Birch's CH campaign (12 pts, 1 major, 3 judges), handler Lauren Pike, an
    upcoming cluster weekend with an entry fee and an entries-close reminder. Browser-verified
    (headless Chromium): Today card + no double listing, reminder fires, card gaps, completing
    win → nudge → prefilled form → title saved → nudge gone; Lite shows no card / nudge and
    seeds no show events. Service-worker cache rolled to `kennelos-shell-v32`.
- **Next:** the editions build is now feature-complete (Lite cap, Pro + license gate, Demo,
  front doors, tour). Remaining before launch is deploy-time config, not code: buy the domain,
  wire the three publish repos + `EDITIONS_DEPLOY_PAT` (see `build/README.md`), and confirm the
  Demo-origin `demoUrl` in `lite/editionConfig.js`.
  The store URLs are all real now: `site/`'s **six per-tier checkout links** carry their own
  Lemon Squeezy variant (Monthly / Yearly / Lifetime, on both `pro.html` and `upgrade/`), Lite's
  `upgradeUrl` **stays** `https://kennelos.app/upgrade`, and Pro's `licenseConfig.checkoutUrl`
  points at `https://kennelos.app/pro.html#pricing` — the all-tiers section rather than one
  variant, because that single slot feeds both "Buy Pro →" and "Renew Pro →" and a direct
  variant link is right for at most one of them. `LAUNCH_PLACEHOLDERS` is therefore empty and
  **`--release` is restored in `deploy.yml`** (all five matrix legs verified passing). Still
  open: confirm `yearlyVariantPattern` / `lifetimeVariantPattern` against the store's real
  variant names (a miss silently gives a yearly key the 3-day monthly grace window), and note
  the six site links are **not** guarded by `--release` — click them after a deploy.
- **Pro's pay gate is ON** (`editionFlags.licenseGate: true`), restored after the temporary
  live-testing window in which Pro shipped fully unlocked to any visitor. Lite and Demo declare
  no `licenseGate` at all and carry a null `licenseConfig` — they are structurally ungatable,
  not merely switched off (browser-verified: wall in Pro only).
- **Waitlist, W1a — data layer built, no UI yet** (`docs/KennelOS_Waitlist_Spec.md` §0
  decisions, §14 plan; End-State guide §29). Three per-kennel tables (`waitlist_entries`,
  `waitlist_offers`, `waitlist_programs`), their repos (the entry repo keeps
  `Contact.waitlist_status` in step), every FK registered, and the pure rules engine
  `shared/data/waitlistRules.js` (position, eligibility including breed, passes, removal +
  undo) with `tests/waitlistRules.test.js`. Repos exercised against a real IndexedDB in
  headless Chromium.
- **Waitlist, W1b — intake + list pages built & browser-verified** (headless Chromium, no
  console errors; phone width without horizontal scroll). Pro-only `waitlist` /
  `waitlist-entry` / `waitlist-programs` pages (absent from `dist/lite`, 404 there), the
  `data/waitlistActions.js` step layer (approve with offered contact match, fee received,
  withdraw, remove, undo, re-apply, move), the Kennel page's Waitlist settings card, Dog
  `intended_placement` (since replaced by `intended_registration`: Limited / Full / Co-own /
  None, matched against the family's `pref_purposes`), the contact page's Waitlist panel (its waitlist dropdown goes
  read-only once entries exist), and per-kennel dashboard tiles. New flag
  `editionFlags.waitlist` (off in Lite).
- **Waitlist, W1c — offers built & browser-verified** (headless Chromium, Pro and Lite, no
  console errors). The Litter page's Pro-only **Waitlist picks** panel (open/close picks,
  one open offer at a time in list order, Accepted… / Passed / No response / Void, next up,
  the litter queue, offer history); accepting creates the Sale (prefilled via the new
  shared `data/saleDefaults.js`) and places the family; a second counted pass removes them
  with a 7-day undo; Today gains four waitlist nudges (new applications, offer deadline
  passed, fee past due, undo a removal). The Lite litter page never requests the panel.
- **Waitlist, W1d — W1 complete, browser-verified** (headless Chromium, Pro and Demo, no
  console errors). A seven-family sample waitlist on Thornfield (program family paused, open
  offer on the Autumn litter, a pass, listen-only, fee due, new application, a placed run) in
  the shared seed — so Demo and the Pro tour show it (two new tour stops); clear-sample-data
  removes it. CSV import of applications (`waitlist-import`, matched on email per kennel,
  Google Form timestamps understood). Received application fees are Financials income; a fee
  credited to the purchase nets off that family's Sale balance (ledger, Litter P&L, invoice
  line, Companion remaining balance). Service-worker cache rolled to `kennelos-shell-v33`
  for all of W1.
- **Waitlist, W1e — built & browser-verified** (Waitlist Spec §15 + §14 "W1e choices"; End-State
  guide §24, §29; headless Chromium, no console errors, no horizontal scroll at phone width). Her
  requests after trying W1, the local half: her own **application form** (new Pro page
  `waitlist-form`: reword/retype/reorder/add/delete, locked questions for name, email, the four
  preferences and the public-list notice; **import questions from her old form's CSV**, which the
  application importer then reads), **offering from the waitlist** (Offer a litter… and outcome
  buttons on the family's page, a Litters card with who's next on the Waitlist page),
  **invoice/receipt PDFs** (vendored jsPDF; one document model for the page and the PDF; an
  application-fee receipt source), and **Copy public list** (first name + last initial, sex
  preference, date added; paused families hidden with their number skipped). Programs are hers
  alone: `applicable_on_form` dropped. Tests: `waitlistForm.test.js`, `invoicePdf.test.js`. Still
  W2: the public list page, kennel-name (no-reply) email, and the
  online form itself. Next: W2 (needs the cloud Worker, vault and server-side license link;
  the link's plan is `docs/KennelOS_License_Link_Plan.md`: server and client are built
  (cloud migration `0006`, `cloud/src/license.js`; `shared/data/cloud/cloudEntitlement.js`
  and Pro's "Pro on this account" line and **Link a Pro purchase email…** in the cloud
  card's Account section; `cloudEntitlement.js` added to the precache, cache rolled to `kennelos-shell-v46`);
  operator setup, including the owner's own license backfill, in `LAUNCH_CHECKLIST.md` §3c,
  **done 2026-10-08**). **All three W2 prerequisites are now live**, and her answers to
  Waitlist Spec Q5–Q7, Q11, Q13, Q18 are recorded (the server advances only for her automatic-offer moments, pause
  requests she approves, the full public list with search). **Automatic offers are now per
  moment** (`waitlist_config.auto_offer_on`: accepted / passed / no response / picked but no deposit /
  left the list, none by default; replaces `auto_offer_next`, whose old "on" still reads as all five), which
  the W2 server will follow while she's offline. Browser-verified (Kennel page settings
  save; only ticked moments offer). Service-worker cache rolled to `kennelos-shell-v48` for
  this batch. **W2 build plan approved:** `docs/KennelOS_Waitlist_W2_Plan.md` (every §10
  decision as recommended; invoice/receipt PDFs dropped, she sends them herself). **W2 step 1,
  the server foundation, is built:** cloud migration `0007` (every W2 table) and
  `cloud/src/waitlist.js` (publish / read / take offline a kennel's projection, status-page
  tokens, the encrypted inbox, the events stream; Pro and backing device only; an
  application's server copy stays until a private backup made after her phone took it in
  exists, and a reset phone can fetch it again), with
  `cloud/tests/waitlist.test.js`. Apply `0007` on staging and production after the merge
  (`LAUNCH_CHECKLIST.md` §3d). **W2 step 2, publishing from her device, is built &
  browser-verified** (behind `WAITLIST_ONLINE_RELEASED = false`, so only against staging):
  `data/waitlistProjection.js` (the allow-listed online view), `data/cloud/cloudWaitlist.js`
  (publish when it changes, from the backing device), `Kennel.time_zone`,
  `waitlist_config.online`, and the Kennel page's **Online list** card. Tests:
  `waitlistProjection.test.js`, `cloudWaitlist.test.js`. Rides the pending
  `kennelos-shell-v48`. **W2 step 3, the family pages, is built & browser-verified:** the
  Worker serves the public list (with search and **See Your Details**: sign in with a code
  emailed to the application address, remembered 90 days; migration `0008`) and each family's
  read-only status page (`cloud/src/familyPages.js`, `cloud/public/family/`), and the app
  has **Copy status link** / **New link** on the family's page, **Copy status link** beside an
  open offer, and **Copy public list link** (`waitlist_entries.status_token`, cloud tier).
  **W2 step 4, the online application form, is built & verified end to end in the browser:**
  **Take applications online** publishes her form with a form key made on her device
  (`Kennel.waitlist_form_keys`, private); applicants fill it in at `/apply/<public_id>`, their
  answers sealed in their browser (`cloud/public/family/seal.js`); it reaches her once they
  type the code we email; her device opens it (`data/waitlistCrypto.js`) and adds it as a new
  application (`data/waitlistInbox.js`, `source: 'online_form'`). Rotate form key, Copy
  application form link. Migration `0009`; Turnstile needed on production. Tests:
  `waitlistCrypto`, `waitlistInbox`, `cloudWaitlist`, `cloud/tests/application`.
  **W2 step 5, family actions, is built & browser-verified:** signed in on their status page
  (See Your Details), a family can choose a pup, pass, say they're still interested, ask for a
  pause, change which litters they wait for, ask to change a matching answer, leave the list,
  and send a sealed message (`cloud/src/familyActions.js`, `cloud/public/family/status.js`).
  Her backing device applies each action (`data/waitlistEvents.js`,
  `cloudWaitlist.applyFamilyEvents`): a pick makes the deposit-pending Sale, a pass or leave
  is recorded, and a pause, a narrower listen-only change or an answer change waits for her
  **Approve** / **Decline** on Today or the family's page, where their messages and activity
  show too (`waitlist_entries.pause_request` / `listen_change_request` / `messages`, private).
  Tests: `waitlistEvents`, `waitlistProjection`, `cloudWaitlist`, `cloud/tests/familyActions`.
  **Step 5c part 1, one turn per family across open litters (Waitlist Spec §16.1), is built &
  browser-verified:** one family holds a turn at a time across the kennel's open litters,
  seeing every pup they match in every open litter; only passing on all of it counts, once
  (`waitlist_offers.turn_id`; `waitlistRules.nextTurn`; tests `waitlistTurns`). **Part 2, pass
  reasons and "Not this litter" (§16.2, §16.5), is built & browser-verified:** her reasons
  (each with its message) in Waitlist settings; every pass a family makes needs one; "Not this
  litter" waits until their turn, leaves that litter out of it, and a turn of nothing else is
  passed at once. **Part 3, listen-only "except" (§16.3), is built:** a family can wait for
  every litter except those from parents they list; removing a parent (or going back to All)
  applies at once, adding one or switching between "only" and "except" waits for her OK.
  **Part 4, pairings and early litters online and the deposits nudge (§16.4, §16.8), is
  built:** three stages (planned pairings, pairings, born litters before picks open), each
  switchable for the public list and family pages (all off); Today suggests Open picks when a
  litter's deposits date comes. **What number a family sees (§16.9) is built:** only their
  overall place, hidden during their turn and after a pass until that litter closes (and off
  the public list meanwhile); no per-litter numbers. **Part 5, "Review your preferences"
  (§16.6), is built on the status page:** when a litter is born, families who match it are
  told, and families kept out by their listen-only choice or answers are told why, with
  buttons to change them (the email half comes with step 6). **Part 6, "Ready now?" (§16.7), is built:** when a readiness hold ends on
  an online list, the family is asked on their status page; Not yet sends her a pause request
  with their reason; no answer follows her setting (keep paused, unpause, or remove after N
  days with a 7-day undo). Step 5c is complete; next is step 6, email. Service-worker cache
  rolled to `kennelos-shell-v49` for step 5c (parts 3–6 and §16.9).
  **Companion link requests (§16.10) are built & browser-verified:** a family with an open
  sale (from a pick held by a deposit-pending sale until the pup goes home), placed or not,
  can ask for their Companion link on their status page, with an optional note. It waits on
  the entry (`waitlist_entries.companion_request`, private) as a Today nudge and a card on the
  family's page; she sends the link from the Companion page as before and taps **Mark sent**
  (or **Decline**), which their page then shows. The link never goes through the server.
  **Waitlist online is released (2026-10-08), ahead of steps 6 and 7:**
  `WAITLIST_ONLINE_RELEASED = true`, so the Online list card, status / public list / form
  links and family actions are offered wherever cloud backup is. Production has migrations
  `0007`–`0009`, `apply.kennelos.app` and Turnstile. Since then step 7 (the server's
  deadlines and automatic offers while her phone is off, 2026-10-09), the privacy policy's
  waitlist-online section and the "Message us on Facebook" button (step 8, 2026-10-10) are
  built; only D8, the no-reply auto-answer, is left. Service-worker cache rolled to `kennelos-shell-v50`.
  **Step 6, emails to families, is built (2026-10-09; W2 Plan step 6, End-State guide §29):**
  after each action a family should hear about (approve, decline, fee received, every turn
  offered, a pass or no response, her decision on a request, Send status link, Email them…,
  Almost your turn's **Send from KennelOS**, and the new-litter emails) she sees the email
  from her templates (**Emails to families** in Waitlist settings) and sends, edits or skips
  it. It's queued on the entry and sent after the next publish from the kennel's name
  (`mail.kennelos.app`, verified in Resend), with their status-page link; the family page
  and the status page both list it. New cloud migration `0010_family_email`: **Apply
  pending on staging and production after the merge.**
  **Step 7, deadlines and automatic offers while her phone is off, is built (2026-10-09;
  W2 Plan step 7):** an hourly server run closes a turn whose last day has passed and offers
  the next family (and a family's pass or leave moves the turn on at once), only for the
  moments she ticked under "Offer the next family automatically when…", emailing both; it
  also sends reminders (halfway through a turn and its last morning, the day before a fee is
  due, "Ready now?"), each once, unless she switches them off. Her phone applies each move at
  its next sync, or notes it on the family's page if her records moved on. No migration;
  the hourly cron deploys with the Worker. Step 8's privacy-policy section is written (see
  "Marketing site: official privacy policy + terms of use" below). Service-worker cache rolled to `kennelos-shell-v54` for steps 6 and 7 (v53 went to the reports work merged first).
  Service-worker cache rolled to `kennelos-shell-v34` for W1e.
- **Waitlist, W1e follow-up — built & browser-verified** (Waitlist Spec §6.5, §15.5; End-State
  guide §29). A family leaving the list (withdrew, removed, archived, accepted, second-pass
  removal) voids its other open offers (never a pass) and those litters move on. Fee received, a
  fee-waived approval and an undo no longer make offers; the family page says which litters
  they're next for. Every offer made on her behalf is shown by name (family page, picks panel,
  Today). **"Almost your turn…"** on the Waitlist page and picks panel: one family per available
  pup in line order; families with an open offer anywhere count but aren't told; editable
  wording (Waitlist settings, her default); opens her email with everyone BCC'd or copies the
  addresses, and records `soon_notified_date` + litters (never used to skip a family).
  Service-worker cache rolled to `kennelos-shell-v35`.
- **Waitlist fixes from her testing + sale invoicing — built & browser-verified** (Waitlist
  Spec §15.6; End-State guide §24, §29). Same-day fees keep the order they were paid
  (`fee_received_at`). Accepting is pick + deposit: a pick holds the pup with a deposit-pending
  Sale and the list doesn't move until **Deposit received**; no deposit by the deadline = no
  response (Sale cancelled). **Undo…** a pass / no response (that family is next again).
  Automatic offers are a setting, **off** by default. **Change pup…** before the deposit, or
  after it until the next family is offered. Breed preference is a dropdown of the kennel's
  breeds. Invoices read the sale's due date live, and a Sale's page has its own **Invoice /
  Receipt** button (`assets/invoiceGenerator.js`, Pro-only). Service-worker cache rolled to
  `kennelos-shell-v36`.
- **Waitlist: listen-only by sire/dam, readiness hold, application FAQ — built & browser-verified**
  (Waitlist Spec §15.7–§15.8). Listen-only families pick sires and dams (either side
  matches) once approved; the litters and pairings that covers are derived. A locked,
  required readiness question ("What is the soonest you are able to commit…", ASAP / 1 / 3 /
  6+ months) puts anything but ASAP on an automatic hold from the fee date (or approval):
  no offers, no passes, off the public list. Her FAQ heads the application (edited on the
  Application form page). The old "When are you hoping…" default question is gone.
  Service-worker cache rolled to `kennelos-shell-v37`.
- **Cloud Phase 1, step 3a: the `cloud/` Worker skeleton is built**
  (`docs/KennelOS_Cloud_Phase1_Plan.md` §6, §6.6, §9). It has `wrangler.toml` (staging), CORS for
  `lite.`/`pro.kennelos.app` plus localhost, the 503 maintenance gate, `/health`, and `/ops` behind
  `OPS_TOKEN` with MCCE's migration runner (applied/pending/drifted/orphaned, Apply pending, health
  check). `0001_schema.sql` holds the §6.2 tables, including the `files` index. 20 tests run on
  node:sqlite (`cd cloud && npm test`; a bare `node --test` from the root also runs them), and it
  was checked end to end in local `wrangler dev`. **Staging is live** at
  `kennelos-api-staging.admin-kennelos.workers.dev`, deployed by Workers Builds, with both
  secrets set. `0001` was applied from `/ops` on 2026-10-06, and D1 and R2 report bound and
  reachable. No edition file changed, so there's no
  service-worker bump.
- **Cloud Phase 1, step 3b: the backup API is built** (plan §6.1–§6.6), in migration `0002` and
  `cloud/src/`:
  - sign-in by 6-digit code, rate-limited, with codes shown on `/ops` on staging (no email
    provider yet);
  - bearer sessions with 90-day sliding expiry, sign out, and sign out other devices;
  - content-addressed file upload/HEAD/GET, with R2 verifying the hash;
  - two-step snapshots (describe, then upload the body) with the one-backing-device 409 enforced
    at both steps, plus list and download;
  - takeover, account deletion, and public service notices set from `/ops`;
  - a daily retention cron, plus Run retention now, and D1 export/import, on `/ops`.

  65 tests, plus an end-to-end pass in local `wrangler dev`. **Deploying it needs Apply pending
  on staging's `/ops`** for `0002`; the API answers 503 until then. Sign-in codes are sent through
  **Resend**, and staging's `/ops` has a "Send a test email" button.
- **Cloud Phase 1, step 6: done (2026-10-06).**
  - `kennelos.app` DNS is on Cloudflare (shared account), and the GitHub Pages records are
    DNS-only.
  - The domain has no email of its own; Namecheap forwarding was removed.
  - Resend is verified for `kennelos.app` (DKIM, SPF CNAMEs, DMARC).
  - The staging Worker has `RESEND_API_KEY`, `0002` is applied, and a test email from
    `signin@kennelos.app` arrived.

  **The staging server side is complete.**
- **Cloud Phase 1, §9 step 1: `shared/data/syncRegistry.js` is built, for field-by-field
  review** (plan §5; Waitlist Spec §9 for the three waitlist tables). It is the per-table,
  per-field cloud allow-list plus row rules, as pure data and pure functions. Nothing imports
  it yet, so there is no behavior change.
  - **Rule zero:** a field not listed as cloud is private. Each table also lists its known
    `private` fields, and its `pending` ones (treated as private until decided).
  - **Pure functions** for step 2 to build on: `filterCollectionsForCloud` (row rules, then a
    by-name projection), `filterEventDetails` (derived from `vocab.js`: `textarea` and
    undeclared keys are private), and `assertCloudRow`/`assertCloudCollections` (the positive
    check before upload).
  - **`tests/syncRegistry.test.js`** (10 tests) runs the **real** Thornfield seed through the
    real repos against an in-memory table stand-in (`tests/support/memoryDb.js`). It fails on
    any sample field that isn't classified, on any private key in the projection, and on a
    `db.js` table with no entry.
  - **Five fields plan §5 didn't classify were decided on 2026-10-06:** `dogs.dob_is_estimated`,
    `dogs.recorded_coi` and `litters.picks_opened_date` are cloud; `kennels.waitlist_config`
    and `litters.feeding_schedule_override` are private.
  - **Merging main's waitlist work (2026-10-07)** added waitlist fields, classified by the
    Waitlist Spec where it says:
    - cloud: `listen_sire_ids`/`listen_dam_ids` (renamed from the pairing/litter lists),
      `soon_notified_date`, `fee_received_at` (the same-day tie-breaker of the list order),
      and offers' `picked_date` and `sale_id`;
    - private: `pref_change_log`/`pref_change_request` ("private tier like application").
  - **Privacy vs. recoverability, decided 2026-10-07** (Cloud plan §5.1, Proposal §6/§9/§10,
    Waitlist Spec §9):
    - the line is drawn by whose data it is;
    - her waitlist setup (`kennels.waitlist_config`: rules, form, FAQ, fee, payment
      instructions) and the list's running state (`ready_timing`,
      `soon_notified_litter_ids`, `application_questions`) are cloud;
    - of each `application`, **only name and email** are cloud. That's enforced by a new
      `partial` rule in `syncRegistry.js`, and a restore merges by key, so the device keeps
      the full answers;
    - family fees, payment details and every other answer stay private, for the vault;
    - **the private vault moves to right after Phase 1**, with a second-device unlock, and is
      required before the waitlist's W2. **Built (all 7 steps), not yet released:**
      `docs/KennelOS_Private_Vault_Plan.md` (Phase 2b; decisions in its §10). Step 1, the
      vault's cryptography (`shared/data/cloud/vaultCrypto.js`, `tests/vaultCrypto.test.js`),
      step 2, the server (`cloud/src/vault.js`, cloud migration `0005`,
      applied on staging and production), step 3, the client modules
      (`vaultKeyStore.js`, `cloudVault.js`, the vault half of `cloudBackup.js`, a new
      `'vault-merge'` restore mode and the device-only `device_secrets` table;
      `tests/cloudVault.test.js`), step 4, unlocking from another device (client
      flows in `cloudVault.js`), step 5, the UI (`shared/assets/cloudVaultUI.js`,
      the card's two lines, the restore unlock step, the record-page hint), step 6,
      **passkeys** (WebAuthn PRF in `shared/data/cloud/vaultPasskey.js`; add / unlock /
      remove in `cloudVault.js`; offered after turning it on, first in the unlock modal, and
      under Private backup → Passkeys…; `tests/vaultPasskey.test.js` and passkey cases in
      `tests/cloudVault.test.js`; browser-verified with Chromium's virtual PRF authenticator
      in Pro and Lite), and step 7, the docs and the privacy policy (`site/privacy.html`: the
      encrypted tier), are built. **Released 2026-10-08** (`VAULT_RELEASED = true` in
      `cloudConfig.js`; cache rolled to `kennelos-shell-v47`), without the real-phone checks
      in `LAUNCH_CHECKLIST.md` §3b. Service-worker cache rolled to `kennelos-shell-v44` for this
      batch (the kennel-setup "Sign in to existing account" button, and `vaultCrypto.js` in
      the precache). Steps 3 and 5 add `cloudVault.js`, `vaultKeyStore.js` and
      `cloudVaultUI.js` to the precache, rolled to `kennelos-shell-v45`; step 6 adds
      `vaultPasskey.js`, and the license link's client `cloudEntitlement.js`; rolled to
      `kennelos-shell-v46` for that batch;
    - no readable private data on our server stays the default, with a per-user
      opt-in recovery switch as a fallback only if lock-outs show up in support.

    The "What gets backed up" screen says so. Nothing is pending.

- **Cloud Phase 1, §9 step 2: snapshot, `'cloud-merge'` restore, shrink guard and the dirty
  signal are built** (plan §3.2, §3.5, §4.1, §4.3). There's still no network and no UI.
  Nothing calls the new paths yet, apart from the dirty flag, which every write now sets.
  - **`shared/data/cloud/cloudBackup.js`:**
    - `buildCloudSnapshot()` drops sample rows (by the manifest), projects through
      `syncRegistry.js`, swaps each kept file's blob for its `sha256` (returning the bytes,
      deduped, for a separate upload), runs the positive key check and builds the
      envelope;
    - `gzipJson`/`gunzipJson`;
    - `checkShrink()`: fewer than half the dogs or total records, each measure only when
      its previous count was at least 10.
  - **`importExport.restoreBackup(snapshot, 'cloud-merge', { overwrite, fetchFile })`:**
    - it overlays only cloud fields, so private fields on the device survive, and
      `events.details` merges by key;
    - newer-wins by default, or a rollback with `overwrite: true`; `planCloudMerge()`
      previews the counts;
    - missing rows are inserted, missing files are fetched by sha256, and nothing is
      ever deleted;
    - the Lite cap is checked against the merged dogs.
  - **Dirty signal:** `settings.markDataChanged()` sets `kennelOS.cloudDirtyAt` from
    `repoBase` and the direct writers (`fileRepo`, `expenseRepo`, `assistantSync`, every
    restore). `clearCloudDirty(pushedValue)` keeps a change made mid-push.
    `tests/cloudDirty.test.js` pins every direct `db` write site. Clearing sample data and
    Reset App are exempt, with reasons.
  - `exportAll({ encodeBlobs: false })` lets the snapshot hash raw file bytes.
  - 18 new tests (`cloudBackup.test.js`, `cloudDirty.test.js`). Browser smoke test in
    headless Chromium: a real write sets the flag, a snapshot builds and gzips in the page
    with the contact's email stripped, and there are no console errors.

- **Cloud Phase 1, §9 step 4: the client cloud modules are built** (plan §2–§4, §7), in
  `shared/data/cloud/`. There is still no UI, and no page starts the scheduler (that's step
  5), so nothing is user-visible.
  - **`cloudConfig.js`:** the API base URL. Every edition config now exports `cloudUrl` and
    `devCloudUrl`:
    - `cloudUrl` is `null` everywhere for now. Lite and Pro get `https://api.kennelos.app`
      at step 6.
    - `devCloudUrl` is the staging Worker for shared, Lite and Pro, and applies **only when
      served from localhost**. Demo has neither.
  - **`cloudApi.js`:** the only network module. It has one function per Worker route,
    bearer tokens, timeouts, and typed errors (Offline, which covers the 503 maintenance
    answer, plus Auth, Conflict and Request with the server's code).
  - **`cloudAuth.js`:** email + 6-digit code sign-in, sign out (revokes server-side), and
    sign out other devices. The device keeps its own `cloudDeviceId` across sign-ins.
  - **`cloudBackup.js`:**
    - `pushIfDirty` uploads missing files first, then runs the two-step snapshot, and
      skips a push whose cloud tier is unchanged;
    - one push at a time across tabs (`navigator.locks`);
    - a conflict, shrink or auth result pauses automatic pushes until the user acts;
    - `enableBackup`/`disableBackup`, `restoreLatestAndTakeOver` and
      `replaceCloudWithThisDevice` (the §3.4 choices);
    - `listSnapshots`/`downloadSnapshot`/`previewRestore`/`restoreSnapshot`,
      `deleteCloudData`, and `getBackupStatus` for the step-5 card;
    - `startBackupScheduler()` (§2.2): five minutes from the first unpushed change, on
      going to the background at most once a minute, at the first page of a browsing
      session, and when the browser comes back online.
  - **Reset App** now always turns backup off and forgets the backup position, so turning
    it back on goes through the restore-or-replace choice. The sign-in is kept.
  - **`tests/cloudClient.test.js` (20 tests)** drives all of this end to end against the
    **real Worker code** in-process, using the cloud tests' node:sqlite D1 and in-memory R2.
    It covers sign-in, push, unchanged/offline/maintenance/auth, the shrink guard, the
    two-device 409 → restore → takeover → replace sequence, Reset App, "restore as of",
    files, delete, turn off, and the scheduler.
  - Headless Chromium on localhost: the modules load with no console errors and resolve the
    staging URL. This environment's network policy blocks the staging host, so the live
    call came back as a quiet `CloudOfflineError`. A live run against staging is still to
    do, from a machine that can reach it.

- **Cloud Phase 1, §9 step 5: the cloud backup UI is built and browser-verified** (plan §2,
  §3.4, §3.5), in `shared/assets/cloudBackupUI.js`. It's loaded only when the edition has a
  server, so an edition with `cloudUrl: null` shows nothing new and loads none of it.
  - **First run:**
    - a third choice, "I already use KennelOS → sign in and restore", which skips kennel
      setup;
    - after the first kennel is saved, a one-time, skippable "Protect your records: turn on
      free cloud backup";
    - the Welcome card's "no account, no cloud" line becomes "free cloud backup is optional,
      and off unless you turn it on".
  - **Sign-in:** email, then the 6-digit code ("We use your email to send your code. We
    don't keep it."), with resend, a spam hint, and a name for this device. Then the "What
    gets backed up" screen before the first backup, which shows progress.
  - **Import/Export card (reworked 2026-10-08):** Cloud is the first destination on the
    Backup & restore card, on both the Back up and Restore sides: Last backup, Back up now,
    the backups to roll back to as a dropdown on the page, the **Sensitive records** dropdown
    (the encrypted tier, formerly "private backup"), and an on/off strip at the foot. Sign
    out, sign out other devices, Your devices and delete my cloud data are on **Settings →
    Account**. A one-time "sensitive records aren't in cloud backup" hint shows after a restore.
  - **Dialogs:**
    - 409: "Backups for Oak Hill Kennels are coming from Laptop B (last backup just now)",
      with Restore that backup here / Replace it (typed REPLACE) / Not now;
    - shrink guard: Restore from backup instead / Upload anyway / Not now.
    Either "Not now" leaves backup paused, which the card and Today both show, with a
    Resolve.
  - **Today:** a nudge while backup is off ("Not now" snoozes it for 30 days), or a
    "paused" line.
  - **Reset App:** "Also sign out of cloud backup on this device", ticked by default. Backup
    is turned off either way.
  - **Every page:** the backup scheduler, and service notices (fetched only for a signed-in
    device).
  - **Verified in headless Chromium**, against the real Worker code served locally on its
    in-memory D1/R2 (the staging host is blocked from this environment). Two devices ran
    first-run → kennel → offer → sign in → turn on → back up; then new device → sign in and
    restore (dogs and contact names come back, emails and notes don't, no kennel-setup gate);
    then the old device → 409 → paused on card and Today → Resolve → Replace; then restore as
    of an earlier snapshot (status rolled back, private note kept); then Reset App (stays
    signed in when unticked, backup off). The assembled Lite build ran too. No console
    errors. With no server: no card, no offer, no nudge, the original welcome text, and zero
    API requests.
  - **Not done:** the per-record "private details aren't in cloud backup" hint on record
    pages (plan §2.3). For now it's one hint on the Import/Export card after a restore.

- **Cloud backup test switch — built & browser-verified** (Cloud plan §4.5). Testing needs
  only a browser: open the deployed Lite or Pro with **`?cloud=staging`** on any page (e.g.
  `https://pro.kennelos.app/?cloud=staging`) and that browser backs up to the staging server.
  A "Cloud backup: TEST SERVER" strip shows on every page with a Turn off link
  (`?cloud=off`). Nobody else is affected; switching forgets the device's cloud sign-in.
  Headless Chromium on a `lite.kennelos.app` hostname: strip and backup card appear, off
  removes both, no console errors.

- **Lite → Pro with cloud backup — built & browser-verified** (Editions Plan, "Converting
  Lite → Pro" › "With cloud backup"). Pro can restore a Lite program by signing in with the
  same email. Until the private vault, the file is still the complete path, so the Upgrade
  button still downloads it; when the Lite device is signed in, it also backs up unsaved
  changes and explains the sign-in-and-restore route plus merging the file for private
  details. Snapshots now record their edition (**cloud migration `0003`: Apply pending on
  staging's `/ops` after this deploys**; the API answers 503 until then), so a Lite device
  whose program is backed up from Pro says "Your records moved to KennelOS Pro" with Turn off
  backup here, instead of the two-device conflict. Headless Chromium (Lite build, server
  replies stubbed): dialog, card line, no Today nudge after turning off, and the upgrade note
  after the file download; no errors beyond the stubbed 409s.
  Service-worker cache rolled to `kennelos-shell-v40` for this and the test switch.
- **A lost device: remote erase + free its Pro license — built & browser-verified** (Cloud
  plan §2.5). Settings → Account → **Your devices…** lists the account's
  devices. **Erase…** (typed ERASE; needs a sign-in from the last 15 minutes or an emailed
  code) wipes that device the next time it opens KennelOS online: every table, the
  KennelAssistant database and every `kennelOS.*` key. **Free its Pro license** releases its
  Lemon Squeezy activation from the owner's browser (the key never reaches our server), also
  reachable from the activation wall ("Free a lost device's slot"). Signed-in devices now
  check in (`POST /devices/check-in`, which also carries the service notices), started before
  the license gate so a walled device still hears an erase. New module
  `shared/data/cloud/cloudDevices.js`; **cloud migration `0004`: Apply pending on staging's
  `/ops` after this deploys**. Tests: `cloud/tests/devices.test.js` and new
  `tests/cloudClient.test.js` cases. Headless Chromium against the real Worker locally (Pro
  and Lite builds, Lemon Squeezy stubbed): free a slot from the wall, erase from a laptop, the
  walled phone wiped on reopening with the erase confirmed, the code prompt for an older
  sign-in; no page errors. Only devices that had cloud backup on are covered. **Sign out
  other devices** and **Delete my cloud data** now need the same fresh sign-in, so a stolen
  phone that's still signed in can't use them (browser-verified in the Lite build).
- **Cloud Phase 1, §9 step 6: the repo half is done** (plan §9 step 6). The §8 docs
  (CLAUDE.md's cloud rules, the Editions Plan tier table, End-State guide §30), the
  production Worker as `[env.production]` in `cloud/wrangler.toml` (`kennelos-api` on
  `api.kennelos.app`, its own D1/R2, no `DEV_OUTBOX`), the operator's production steps in
  `docs/LAUNCH_CHECKLIST.md` §3a, and the SW cache rolled to `kennelos-shell-v41` for the
  lost-device work. **Not live yet:** Lite and Pro still ship `cloudUrl: null`. The go-live
  change (set `cloudUrl`, rewrite the site's "no accounts, no cloud" claims, add the
  privacy policy page) is a separate change to merge once production's `/ops` shows no
  pending migration (checklist §3a).

- **Cloud Phase 1 go-live change — built** (plan §9 step 6). Lite and Pro point at
  `https://api.kennelos.app`; the marketing site no longer claims "no accounts, no cloud, no
  server" (every footer now reads "No account needed", and Home, About, Compare, FAQ, Lite, Pro
  and Upgrade describe the optional backup and what it never holds, including the one
  exception: Pro waitlist applicants' name and email); the new privacy policy page
  `site/privacy.html` (operator "KennelOS", admin.kennelos@gmail.com), linked from every
  footer; the guided tour's backup step changes its wording when a server exists.
  Service-worker cache rolled to `kennelos-shell-v42`. **Merge only after checklist §3a**,
  since the merge deploys the editions and the site together.

  Production was set up on 2026-10-07 (checklist §3a): `kennelos-api` deployed on
  `api.kennelos.app`, migrations through `0004` applied, D1/R2 reachable, the secrets set,
  and a test sign-in email delivered through Resend.

- **Go-live follow-up: service worker installs fetch fresh.** After the go-live merge, a
  phone that already had Lite installed kept the old `editionConfig.js` (no cloud backup
  card) while a fresh browser showed it. `shared/sw.js`'s install now requests every
  precached file with `cache: 'reload'`, so a new version can't save a stale copy from
  the browser's HTTP cache. Service-worker cache rolled to `kennelos-shell-v43`, which
  also replaces any stale v42 copy. Browser-checked: Lite's v43 cache holds all 160 files,
  with the production `cloudUrl`.

  Next: the smoke test on the real origins (checklist §3a). That's the docs (§8: CLAUDE.md, the Editions Plan, the End-State guide's
  §29 section), the privacy policy page, the SW bump, and production. A live check against
  staging from a machine that can reach it should come first.

- **Reports & analytics, phase 1 — done & browser-verified** (`docs/KennelOS_Reports_Plan.md`,
  End-State guide §31). The shared report screen gained a date range, KPI tiles, a totals
  row, charts drawn from the visible rows (our own SVG, `assets/chartView.js`) and a
  **Print / PDF** button with a print-only letterhead (`assets/printView.js`; the browser's
  Save as PDF makes the file). Existing reports upgraded; new **Profit & Loss by Month**
  and **Year in Review**; the hub is grouped into segment tabs (`data/reportCatalog.js`).
  **Phase 2** added Dam & Sire Production, Pairing Success, Puppy Growth, Waitlist Funnel
  and Demand vs Supply; **phase 3** Expenses by Category, Receivables, Pricing,
  Breeding-Dog Return, Heat Cycles, Health-Testing Gaps, Lead Sources & Referrers, Returns
  & Voids, Show Record and Stud Results — the plan is complete.
  Service-worker cache rolled to `kennelos-shell-v53` (this batch plus the registration /
  purposes / Full-surcharge / puppy-form changes before it).

- **Lite → Pro bridge, cloud first — built & browser-verified (2026-10-10;** Editions Plan,
  "After the vault"). When this Lite device is signed in to cloud backup with Sensitive
  records on and unlocked, and a last push leaves nothing unsaved
  (`cloudBackup.holdsEverything`), **Upgrade to Pro →** (and the cap nudge) skips the file
  and says how to sign in and unlock in Pro, with **Save a backup file too** as the
  secondary button and **Not now**. Anything else (no cloud, backup off or paused, Sensitive
  records off or locked, offline) keeps the file-first flow, whose note now suggests
  turning on Sensitive records. Test: `tests/upgradeBridge.test.js`. Headless Chromium
  (Lite, cloud API mocked, phone width): all three paths reach checkout, no console errors.

- **Vault handoff codes — built & browser-verified (2026-10-10;** Private Vault Plan §5.4).
  Lite's upgrade dialog makes a one-hour, single-use unlock code (Copy, and copied again on
  Continue to Pro); Pro's **Use another device** screen has a box to paste it (the recovery
  code works there too). Any unlocked device can make one from **Unlock another device… →
  Make an unlock code instead**. The server stores the vault key wrapped under the code and a
  hash of a second value derived from it, never the code. **New cloud migration
  `0011_vault_handoff`: Apply pending on staging and production after the merge.** Tests:
  `cloud/tests/vault.test.js`, `tests/vaultCrypto.test.js`, `tests/cloudVault.test.js`.

- **Simpler way in — built & browser-verified (2026-10-10).** First run is one Welcome card
  (**Start my kennel** / **Take the tour** / **I already use KennelOS**); the backups note card
  is gone and "install as an app" is a dismissible Today card. Kennel setup has an optional
  **Email for free cloud backup** (the opt-in), so turning backup on is: code → first backup →
  **Protect your sensitive records too?** with **Turn on with passkey** (Face ID; the recovery
  code then waits on a Today card until saved). The sign-in screen no longer asks to name the
  device, and "What gets backed up" is a link, not a step. Dialog buttons wrap instead of
  overflowing. Tests: `tests/cloudVault.test.js` (passkey first).

- **Changing the account's email — built & browser-verified (2026-10-10;** Cloud Phase 1
  plan §2.6). **Change email…** on the Account card: the new address and its code, then
  "Can you still get email at <current>?" Yes → a code there too, changed at once. No → it
  waits 1 day, shown on every signed-in device (Account card and Today) with **Cancel it**.
  The old address stays a linked purchase email, so Pro purchases made with it still count.
  **New cloud migration `0012_email_change`: Apply pending on staging and production after the
  merge.** Recovering with no signed-in device (case 2) followed; see below.
  Service-worker cache rolled to `kennelos-shell-v65` for this batch (the Lite → Pro bridge,
  vault handoff codes, the simpler way in, dialog button wrapping and changing the email).

- **Recovering the account with no signed-in device — built & browser-verified (2026-10-10;**
  Cloud Phase 1 plan §2.7). **Lost access to your email?** under the sign-in email box: the
  account's email + the recovery code (it opens the vault's recovery wrap, and a check value
  derived from the vault key, which every unlocked device now saves, proves the account), then
  a new address and its code. The change waits 1 day, shown on any device still signed in with
  **Cancel it** ("Requested with your recovery code"), and the old address gets a notice. No
  account enumeration: an unknown address gets a stand-in wrap that no code opens. Accounts
  without Sensitive records have no recovery code and can't use it. **New cloud migration
  `0013_account_recovery`: Apply pending on staging and production after the merge.** Tests:
  `cloud/tests/recovery.test.js`, `tests/cloudVault.test.js`, `tests/vaultCrypto.test.js`.
  Also fixed: a taken address in **Change email…** said "Another device is backing up this
  program." instead of its own message.

- **"Message us on Facebook" — built & browser-verified (2026-10-10;** Waitlist Spec §11, W2
  step 8). At the bottom of Waitlist settings (where the list can go online): **Show "Message us
  on Facebook" on status pages** and **Your Facebook Page link** (facebook.com or m.me; the
  switch needs a link). Status pages of families on the list then show the button, opening
  `m.me/<page>`, with "To answer an offer or a check-in, use the buttons on this page.
  Messenger is for questions." Nothing about the conversation comes back to KennelOS. No
  migration (`waitlist_config` is already cloud tier). Tests: `tests/waitlistProjection.test.js`,
  `cloud/tests/familyPages.test.js`.

- **Cloud Phase 2, live multi-device sync — being built** (`docs/KennelOS_Cloud_Phase2_Sync_Plan.md`;
  every §12 decision taken as recommended, 2026-10-10). Pro only: both tiers per record (cloud
  fields readable as today, the whole row sealed with the vault key), a change scan instead of
  an outbox, server-order wins per record, D1 for the records, snapshots from any caught-up
  device, and a lease for the waitlist's server work. **Step 1 (record format and change
  detection) is built:** `data/cloud/syncRecords.js`, `data/cloud/syncState.js`, and the
  device-only `sync_meta` in **`db.version(2)`, the first block after `version(1)`, which is
  frozen from now on** (`CLAUDE.md`, End-State guide §5). Nothing is visible yet.

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
  Documents + file storage, **Accounts** (business logins + referral links/codes, and which
  account an expense was paid through).
- External / leased dogs (Lite ownership picker = `owned` / `co_owned` only).
- **All Reports** (Reports hub + every report page).
- **Invoice / receipt generation** — the `pages/invoice.html` print doc.
- **Puppy Record generation** — the `pages/puppy-record.html` print doc.

**Shared pages that render differently in Lite (edition-flag gates, NOT omissions):**
- **Financials (`financials.js`)** — kept for expense tracking, but the **"Invoice /
  Receipt" generator button is hidden** in Lite.
- **Expense form** — kept, but the **"attach a receipt photo" widget is hidden**
  (receipts & file storage are Pro), and so is the **Account** picker (Accounts is Pro).
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

(The cap itself — 6 counting dogs, 10 litters — and archive-on-departure are separate
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
