# KennelOS — Build log

Chronological record of what was built, decided and fixed, moved here from the top-level
`README.md` (2026-10-15). Not required reading: consult it when you need the history of a
feature. Current design lives in the plans/specs in `docs/`; the `shared/` code map lives in
`End_State_Design_and_Maintenance_Guide.md`. New entries go at the bottom.


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

- **"Not this litter" on the next turn is said out loud (fix, 2026-10-10).** A family who
  had said "Not this litter" to every litter of their coming turn showed as "Next turn" with
  no hint, and "Offer to them" quietly recorded their pass and offered the next family. Now
  the "Next turn" line (Waitlist page and the Litter page's picks panel) carries a **Not this
  litter** note saying "Offer to them" records a pass (pass N of M), and every result message
  names each family passed that way, including when nobody was left to offer (that case
  used to drop them silently). Tests: `tests/waitlistTurns.test.js`.

- **Logo uploads capped at about 300 KB (2026-10-10).** A photo is redrawn smaller until it
  fits; an oversized SVG gets "That logo is too large. Try a smaller image." For live sync's
  record size (Cloud Phase 2 plan §4.1). Older larger logos still restore.

- **Integrations — plan approved, being built** (`docs/KennelOS_Integrations_Plan.md`; every §8
  decision taken as recommended, 2026-10-10). Waitlist embed on breeders' own sites, contracts
  out for signature (Jotform first, then SignWell / BoldSign), referral share-out + go-home
  thank-yous, payment links through her own Stripe / Square, and processing fees on sales
  (gross-up pricing, net income). Build order is the plan's §6. **Step 1 (processing fees)
  is built:** a fee rate (percent + fixed) on each Account, the channel, fee and passed-on
  flag on each Sale, a "price that nets you $X" helper, and the fee netted out of earned
  income (End-State guide §21.1, `data/processingFees.js`). Lite records the fee with no
  channel. `db.version(3)` indexes `sales.sales_channel_account_id`. **Step 2 (waitlist on
  her own website) is built:** "On your website" on the Online list card (a switch, her
  site addresses, the script and button to paste), `cloud/public/family/embed.js` and the
  frame mode in `embedded.js`, and the Worker's per-kennel `frame-ancestors` from the
  projection's `kennel.embed`. No migration. **Step 3 (referrals) is built:** "Share with
  families" on Accounts shows those links and codes on the family Companion page and every
  waitlist status page; a Today nudge a week after a pup goes home opens a thank-you note,
  and a Contact has "Send a thank-you". Both open `assets/messageComposer.js`
  (`data/referralShare.js`). **Step 4, Jotform half, is built (2026-10-11):** contract forms
  on Accounts (type from `CONTRACT_FORM_TYPE`, her label, the link; as many as she likes) and
  (only on an account of the new **Form service** type), and **Send for signature** on a Contract, which offers the matching forms and builds the link
  with the details prefilled on her device (`data/contractForms.js`, plan §2.1a). **The
  payment link half is built too (Pro only):** any Account can hold her own payment link and
  instructions, and **Send payment link** on a Sale or its Invoice sends them with the amount
  owed, starting from the sale's Sold / paid through account; picking an account on a sale
  with none fills it in (`data/paymentLinks.js`, `assets/paymentRequestUI.js`, plan §4). **Step 4c (waitlist pick → send) is built:**
  **Review sale & send…** on a family's turn edits the pick's sale in a modal, picks the
  contract form, and builds one message (deposit, payment instructions, contract link) that
  goes out with the invoice PDF through the share sheet, or by email + download
  (`assets/pickToSend.js`, `data/contractSend.js`, `data/depositRequest.js`, plan §2.6); the
  message carries the paid-through account's payment link. **Step 4b (Connect Jotform)
  is built:** on a Form service account she connects a Jotform API key kept on that device
  only (`device_secrets`, D16), picks forms from her Jotform account and confirms which of
  her fields each detail fills (`field_map`; `data/jotformMatch.js`, `data/jotformApi.js`,
  `data/jotformConnect.js`). Still to prove against a real Jotform account (Jotform must
  answer browser calls). **Step 5 (integration plumbing) is built (2026-10-12):** the
  Worker's vendor connections (tokens sealed with the new `INT_TOKEN_KEY` secret), the
  allow-listed event stream and `/hooks/<provider>/<secret>` webhooks
  (`cloud/src/integrations.js`, migration `0015`), and on the device
  `data/integrationEvents.js` + `data/cloud/cloudIntegrations.js`: the backing device
  applies a vendor's "signed" / "paid" to the contract or sale, or leaves a review on Today.
  The `INT_TOKEN_KEY` secret is set (2026-10-12); no provider is registered on the Worker yet. **Step 6 (Stripe) is built (2026-10-12), with
  her own restricted key on her device, no KennelOS Stripe platform:** a new **Payment
  service** account type holds payment links and the Stripe key; a sale's deposit and balance
  each name the account they're paid via (`db.version(4)`), and the fee is estimated and,
  from Stripe, captured per payment; one-use Stripe links from Send payment link and Review
  sale & send, checked from her device when the app opens (`data/stripeApi.js`,
  `data/stripeLinks.js`); and the **waitlist application fee online**: the kennel's fee
  account, a Pay button at the end of the application or once approved, recorded when Stripe
  says it's paid (`data/waitlistFeePay.js`, `data/waitlistFeeLinks.js`). **Step 7 (Jotform signed → Contract signed) is built (2026-10-12), from
  her device:** a Sent contract's form submission carrying its `contractRef` marks it Signed
  on the submission's date, checked when the app opens (at most every 15 minutes) and by
  **Check for signature** on the contract (`data/jotformSigned.js`); a contract she changed
  meanwhile gets a Today review. Still to prove against a real Jotform account, like 4b.
  **Next: step 8**, an e-sign API provider (SignWell / BoldSign).

- **Cloud Phase 2, live multi-device sync — being built** (`docs/KennelOS_Cloud_Phase2_Sync_Plan.md`;
  every §12 decision taken as recommended, 2026-10-10). Pro only: both tiers per record (cloud
  fields readable as today, the whole row sealed with the vault key), a change scan instead of
  an outbox, server-order wins per record, D1 for the records, snapshots from any caught-up
  device, and a lease for the waitlist's server work. **Step 1 (record format and change
  detection) is built:** `data/cloud/syncRecords.js`, `data/cloud/syncState.js`, and the
  device-only `sync_meta` in **`db.version(2)`, the first block after `version(1)`, which is
  frozen from now on** (`CLAUDE.md`, End-State guide §5). **Step 2 (the server) is built:**
  `cloud/src/sync.js` (enable / off / head / push / pull / cursor), the snapshot rule for a
  syncing program (any caught-up device), retention (tombstones 90 days, synced documents'
  bytes kept), `/ops` counts, and the generated server allow-list
  `cloud/src/lib/cloudFields.js`. **New cloud migration `0014_sync`: Apply pending on staging
  and production after the merge.** **Step 3 (the app's loop) is built:**
  `data/cloud/cloudSync.js` (push, pull, the lock, the scheduler, pauses and the activity
  list) and `data/syncApply.js` (pulled records in one transaction per page), gated by the
  new `editionFlags.liveSync` (Pro). Tested with two simulated devices against the real
  Worker. Nothing is visible yet: the scheduler starts nowhere until step 6. **Step 4 (join
  and leave) is built (2026-10-12):** turning it on (the first device uploads everything),
  joining (newer `updated_at` wins, nothing deleted, resumable), off here / for every device,
  the vault off ending it, and backups on a syncing program (a caught-up device states its
  `sync_seq`; a lapsed license backs up the Phase 1 way, a server change in `snapshots.js`).
  **Step 5 (the waitlist lease) is built (2026-10-12):** on a syncing program one device at a
  time does the server work (waitlist intake, family and vendor events, publishing, emails)
  by a two-minute lease, taken only by a syncing device in front of her
  (`data/cloud/serverWork.js`, `cloud/src/waitlist.js`). **New cloud migration
  `0016_waitlist_lease`: Apply pending on staging and production after the merge.** **Next:
  step 6, the UI and release.**
- **Kennels CSV import + a dog's breeder kennel on import — built (2026-10-14).** New Pro-only
  `pages/kennel-import.html` (mapping `kennel` in `data/csvImport.js`, matched on kennel name;
  a new kennel is always an outside kennel, an update never changes `is_own_kennel` or
  `public_id`). The dog importer gains `breeder_kennel_name` (any kennel on file, unknown →
  review). Import / Export now lists Kennels first, then Contacts and Dogs, so contacts'
  and dogs' kennel columns find the kennels they name. End-State guide §9.
  Same day: the dog import matches on registration number as well as name + date of birth,
  saves a new External dog with no owner as **pedigree-only**, and takes parents in the same
  file as their pups (a link pass after every row is written sets sire/dam). End-State §9.
- **Import several files — built (2026-10-14).** `pages/import-batch.html` (every edition,
  button under CSV import on Import / Export) + `data/csvBatch.js`: pick every CSV at once;
  each file's importer is guessed from its columns (changeable), files run in the order the
  mappings' new `links` declarations need (kennels → contacts → dogs → events…), each
  through the usual preview and commit. Expense and Waitlist files hand off to their own
  screens. Cache rolled to `kennelos-shell-v77` for this batch and the two above.
- **Ken + guided "Record a new litter" — built & browser-verified (2026-10-14).** A floating
  **Ask Ken** button on every page opens **Ken** (`pages/ken.html`), a scripted helper shown
  as a chat (not a model; nothing leaves the device): he greets her, offers his tasks, and asks
  each question as a chat message, her answers left as replies, ending with "Here's what I'll
  create:" to approve. Also opened from the Breeding page and an Expected litter's page. The
  litter task, for breeders who find the full forms hard: the mom, then
  the dad (either can be a new dog; a typed name is checked against every dog on file,
  outside and pedigree-only included — "We found Nell. Is this the mom?"), then an existing
  litter of that pair with no pups, then an existing breeding, else the breeding questions;
  the stud service for an outside stud (Pro); the birth, each puppy, plans, prices, dates,
  and one review before anything is saved. Answers are kept as a draft after every step
  (Ken offers "Finish recording …" first), and the save is resumable. Pro then offers "Let
  families know" (the waitlist's litter notice, or the Companion page one family at a
  time); it never opens picks. New `data/guidedLitter.js` (+ `tests/guidedLitter.test.js`),
  `data/puppyDefaults.js`, `assets/guidedLitterUI.js`, `assets/kenChat.js`, `pages/ken.*`,
  Pro-only `assets/guidedShareUI.js`
  and `assets/companionLink.js` (the console's link builder, moved out of
  `pages/companion.js`). No schema change. End-State guide §33; editions plan tier table.
  Cache rolled to `kennelos-shell-v78` for this batch.
- **Kels (renamed from Ken) + "Check in on a litter" — built & browser-verified
  (2026-10-14).** The helper is **Kels**, "your personal KennelOS agent" (she/her); her name, line,
  button label and a future photo live in `kelsChat.KELS`, and the files became `kels*`
  (`pages/kels.html` replaced `pages/ken.html`). The menu takes tasks generically (priority,
  resumable, `beforeStart`, `handoff`), and `kelsChat` gained `form()`. The weekly check-in:
  pick a litter, a summary, then what's waiting (open picks or move the deposit date,
  Weaning, Ready, Sold / reopen / close), then weights, health care (deworming or flea &
  tick, shots, other medication, a vet visit) or something else (plans, microchips, dates,
  status). Door on a born litter's page. Today's sold / reopen / close rules moved into
  `data/litterCheckin.js` so Today and Kels share them. New `data/litterCheckin.js`
  (+ tests), `assets/litterCheckinUI.js`, `waitlistPicksPanel.openPicksFromCheckin`.
  End-State guide §33.
- **Closing a litter — decided & built (2026-10-14).** Closing no longer waits for the
  litter to be marked Sold or for every Placed pup to have a delivered sale: a litter at any
  born status closes when no pup is Available or Undecided, no sale on it is open (each
  delivered, returned, cancelled or voided) and one went home. Kept, Health-hold and
  grown-up pups don't hold it up (decided: Health hold doesn't block). Sales of departed
  (archived) pups count, which fixes Lite, where the old rule never fired. The Sale page asks
  "Close the litter?" right after the sale that finishes it. End-State guide §19.
- **Go home — decided & built (2026-10-15).** For a pup with a sale at Deposit paid or Paid
  in full (`data/goHome.js`, + tests): from a week before the ready date (decided: a week,
  not on the day), schedule the pickup if none is on the calendar and no boarding is
  running; log the boarding a sale charges for; and once the pickup date passes without
  Delivered, ask whether the pup went home (Yes opens `sale.html?…&deliver=1` so the Sale
  page's delivery prompts run). Today nudges (`gohome-*`; event-form deep links gained
  `logEnd` / `logContact`) and Kels's check-in. Decided: no nudge for now for pups still
  Available or Undecided past 8 weeks. End-State guide §19, §33.
  Precache updated; `CACHE_NAME` not bumped.
- **Kels's photo (2026-10-15).** A Boston terrier at a laptop, `assets/kels.png` (256 px,
  resized from the 1254 px original; precached), as her avatar in the chat and the Kels page
  header, and on the floating **Ask Kels** button in place of the ✨.
- **Kels's "Tidy up my records" + merging duplicates — built & browser-verified
  (2026-10-15).** A fourth Kels task that finds records that disagree and raises them one at a
  time: litter counts vs. pup records; pups with a sale not marked Placed; delivered dogs
  still owned (Pro: buyer owns / co-owns; Lite: leave the roster); a litter's parents vs. its
  breeding's and its pups'; her dogs with no parents (pick one on file or add one, hers or
  pedigree-only); stud services past their date with no breeding (Pro); breeders without a
  kennel and outside kennels without a contact (Pro); duplicate dogs and duplicate contacts
  (Pro), with a merge that repoints every registry FK and archives the other record.
  Decided: Kels only, never Today nudges; Lite never checks or shows features it lacks;
  duplicate dogs treat a missing birthday or registration number as unknown, never as a
  difference; "don't ask again" answers are device-local (the nudge ledger). New
  `data/tidyRules.js`, `data/recordMerge.js` (+ tests), `assets/tidyUpUI.js`;
  `waitlistEntryRepo.syncContactWaitlistStatus` exported. No schema change. End-State guide
  §7, §16, §33; editions plan tier table. CLAUDE.md: README is a snapshot, history only here.
  Precache updated; `CACHE_NAME` not bumped.
- **Kels's chat, tighter and searchable (2026-10-15).** Less padding throughout the chat;
  reply buttons two across; a choice's description stays hidden until the first tap, and the
  second tap chooses it; her menu has a search box that filters as you type, matching each
  task's `keywords` too ("add puppies" → Record a new litter). The page header drops her
  tagline (her first message says it). Decided: in Lite, adding a parent at the cap shows the
  usual upgrade notice and skips that parent; Kels never suggests a way around the cap.
  End-State guide §33. No new files.
- **Kels's page header (2026-10-15).** A bigger photo (52 px) and her title, "Kels, the KennelOS
  whiz" (`KELS.title`), on one line sized to the phone's width, in the same header height; no
  gap above the chat on phones.
- **Kels roadmap written (2026-10-15).** `docs/KennelOS_Kels_Roadmap.md`: the rules every
  task follows (including: in Lite, the cap is never worked around) and the next tasks in
  build order: prep pups for leaving (with one Puppy Record file for chosen pups, a page
  break between pups), check account health, set up my waitlist, set up another device,
  then record a sale, log a heat or breeding, check in on a dog, add a dog. Listed in the
  README's doc map.
- **Kels roadmap: decisions (2026-10-15).** Prep pups prints pups without a sale (no buyer
  block); account health is the KennelOS account and device; only we add search keywords;
  set up another device ships before live sync (restore and unlock only until step 6); the
  waitlist stays ahead of a sale task; Add dogs takes several in a row; starred tasks and
  ones used more than 3 times in 60 days move up the menu (device-local).
- **Kels roadmap: cover page, 60 days (2026-10-15).** Prep pups' print opens with a readiness
  cover page for the breeder; "frequent" tasks are those started more than 3 times in 60 days.
- **Kels's "Pups are going home" — built & browser-verified (2026-10-15).** Roadmap §3.1
  ("Prep pups for leaving" in the plan; renamed when built).
  A fifth Kels task: pick a litter with pups at home and the pups leaving (ticked: a sale at
  Deposit paid or later), see each pup's readiness, fix what's missing one thing at a time,
  then (Pro) the Furever link and one printed file of puppy records. New pure
  `data/prepPups.js` (readiness, read by Kels and the Puppy Record's cover page) and
  `assets/prepPupsUI.js`; the check-in's microchip, care and pickup forms are now exported
  (`chipsForm`, `careForm`, `pickupsForm`) and shared. Puppy Record: `?dogs=` prints several
  pups, a page each, pups with no sale without the buyer block; `&cover=1` adds the
  breeder's readiness cover page. The Sales page's Print Puppy Record is the same picker,
  with an optional cover page. Decided: the Furever link isn't tracked (offered, never an
  item); the go-home date is the `placement` ("Placement / drop-off") event, scheduled from
  the task with its method (`goHome.pickupEvent` takes one; not Local pickup → "Puppy
  drop-off"); the Sales cover page is off by default. Kels now greets with "What can I help
  you do today?" when sent straight to a task too. Roadmap §2.7: her voice, a couple of
  warm words per message, never more than one phrase or sentence.
- **Kels's intro on every task (2026-10-15).** The record-a-litter opener's "I'll ask you some
  questions… Sound good?" with **Sounds great, let's start!** / **Never mind** is now
  `kelsChat.KELS_INTRO` + `chat.intro(opener)`, said at the start of every new task (record a
  litter, check in, tidy up, pups are going home) after the task's own opener; a resumed
  draft still opens with "Welcome back!".
- **Kels's "Check account health" — built & browser-verified (2026-10-15).** Roadmap §3.2. A
  sixth Kels task: storage kept safe and how full, an update waiting, cloud backup (off,
  paused, behind) or, without it, the age of the last backup file, the Pro license in grace,
  lost devices, Sensitive records (off, locked, recovery code, passkey), Stripe / Jotform
  keys still accepted, and the online waitlist; each with the app's own screen as the fix,
  ending with "All good" and what's fine. Pure `data/accountHealth.js` (tested) +
  `assets/accountHealthUI.js`. The tidy-up's findings loop moved to
  `assets/kelsFindings.js` (`FindingsTask`), shared by both. Decided: 14 days for the
  backup file without cloud backup, 60 days for a lost device, vendor keys tested live once
  per run.
- **Account health: status report (2026-10-15).** After she looks, Kels now reports every area
  she checked, good or not (`accountHealth.healthReport`): space used, cloud backup or the
  backup file, the Pro license (state, plan, renewal, "on 3 of 3 devices"), devices signed in
  by name, Sensitive records, each connection, each online waitlist; then the findings. The
  cached license record keeps Lemon Squeezy's `activation_usage` / `activation_limit`
  (`activationUsage` / `activationLimit`). Browser-verified on the Pro build with a simulated
  signed-in account (license, devices, Sensitive records, a refused Stripe key).
- **Account health: replace a refused key in the chat (2026-10-15).** A refused Stripe or
  Jotform key no longer sends her to Accounts: **Help me replace it** gives the steps for a
  new key in a new tab, shows the login saved on that account (password masked until Show,
  Copy for each), and takes the new key in the chat, checked and saved through
  `connectStripe` / `connectJotform`. The Stripe permission list is now one constant,
  `stripeLinks.STRIPE_KEY_PERMISSIONS`, read by the Accounts page too. Browser-verified with a
  simulated Stripe that refuses the old key and accepts the new one.
- **Kels roadmap: three more (2026-10-15).** Add dogs (§3.8, now **M**) offers each new dog's
  documents (Pro) and its history; new §3.9 Add my other accounts (the business Accounts page
  as a conversation, several in a row, Stripe / Jotform connected in the chat); new §3.10 Add
  new events (any dog event type, for one or several dogs, several in a row; also how Add dogs
  brings in history).
- **Kels's "Set up my waitlist" — built (2026-10-15).** Roadmap §3.3, Pro. Grouped screens:
  the fee (paid online through a Payment service, Stripe connected in the chat), offers (the
  on/off rules and every automatic-offer moment as checkboxes), going online (offers to turn
  on cloud backup first, then the list, applications, reminders, what shows before picks
  open, "Ready now?", Facebook, her website, the time zone in one screen), programs, and the
  families she already has. Re-runnable, with a summary of what's set. Shared, so nothing is
  copied: `waitlistRules.waitlistConfigProblem` (now the Kennel page's checks too),
  `onlineConfig`, `waitlistSummaryLines`, `waitlistIsSetUp`, and
  `cloudWaitlist.saveWaitlistOnline` (now the Online list card's save). The Stripe / Jotform
  key steps moved to `assets/vendorKeyUI.js` for account health and this task.
- **Kels roadmap: Help me find / do / understand (2026-10-15).** New §3.11: Kels as a
  knowledge base and navigator, with keyword search across where things are, what she can do
  (starting a task or giving a button to the right page) and what things mean, with one
  short clarifying question when the words fit several things. Built on a catalog
  (`data/kelsKnowledge.js`).
- **Set up my waitlist: copy links, offline until asked (2026-10-15).** A successful publish
  ends with **Copy list link** (and **Copy application form link** when applications are
  online). The list stays offline until she says "Yes, put it online", from the menu too.
  Cache rolled to `kennelos-shell-v79` for this batch (Pups are going home, account health,
  set up my waitlist).
- **FurEver pickup plan follows the drop-off event (2026-10-15).** The seed link's pickup
  date, time and place now come from the pup's Placement / drop-off event (the same event
  test Kels and Today use, `goHome.pickupFor`), so a moved drop-off reaches the family on
  the next resend. The console shows it with **Edit drop-off**; a pup with no drop-off keeps
  the typed Sale fields (still the fallback) plus **Add a drop-off event**. The editions plan
  gained rows for Kels's Pups are going home, Set up my waitlist and Check account health.
- **Pups are going home: fixes in the chat, tabs announced (2026-10-15).** The contract
  (status and signed date, or a new sale contract), the registration type (with the Full
  price change and the Co-own co-owner offer the Sale page asks) and the litter's feeding
  note are now done in the chat; only the breed feeding schedule still opens its page.
  Printing the puppy records and opening Furever now say a new tab is coming and wait for
  **Okay, open it**. Kels roadmap rules 8 and 9 record both.
- **Pups are going home: optional checks, unsold pups, balances (2026-10-15).** Microchips,
  the litter's registration number (new item) and the feeding schedule are now "want me to
  check these too?" tick boxes at the start, unticked. Pups marked Available or Placed with
  no sale get **Record the sale** (family, status, registration, price and deposit, in the
  chat; the pup becomes Placed) or **Change the plan**. Balances still owed get a payment
  request or an invoice (Pro). The cover page takes `&checks=`; the invoice generator takes
  `onClose`.
- **Pups are going home: registered names, remembered checks, request then invoice
  (2026-10-15).** New optional check: each pup's registered name and number (for breeders
  who register pups before they go), filled in the chat. The ticked checks are remembered on
  the device (`settings.prepChecks`). Each family owing a balance now gets a payment request
  and then an invoice, one after the other, each skippable.
- **Kels: the exits brought into the chat (2026-10-15).** Check in on a litter marks a sale
  Delivered in the chat and asks the ownership (Pro) or roster (Lite) question; the rule
  moved to `goHome.deliveredOwnershipChanges`, which the Sale page now uses too. Tidy up adds
  a litter's missing puppies and records a stud service's breeding in the chat. Account
  health checks or renews the license or takes a new key, and signs in to or retries the
  online waitlist, in the chat. Set up my waitlist adds a family by hand in the chat, its
  application fields moved from the Waitlist entry page to the shared
  `assets/waitlistApplicationForm.js` (Pro-only, precached). Left as pages on purpose: the
  CSV import, the breed feeding schedule (a table editor), and "see the litter" choices.
- **Our stud's outside breedings (2026-10-15).** A breeding linked to an outgoing stud
  service is still recorded, but nothing asks for its litter: Today's due-soon / overdue /
  whelped-no-litter nudges, the Pairing page's "Record the litter now?" and Kels's tidy-up
  skip it (`data/studRules.js`, new). A pick-of-litter fee on an outgoing service gets
  Today's "Ready to add your pick puppy?" 63 + 56 days after the service: **Add the puppy**
  opens a new dog prefilled from the stud service (`dog.html?new=1&pick=`; saving marks the
  pick claimed), or **Not getting one**.
- **Stud services: direction is who travels (2026-10-15).** `direction` now means who
  travels (our dog goes to them / their dog comes to us / no one, AI), with `type` set from
  it; whether our dog is the stud or the dam comes from its sex (`studRules.ourRole`), never
  stored. Every reader moved over (income, invoices, contracts, Companion, the Pairing
  page, both stud reports, the litter flow, tidy-up, nudges, CSV import, sample data); the
  form asks our dog, the partner (the other sex), then who travels, and labels the two
  dates to fit. The Away board shows the dog that travels, a visitor as "staying with us".
  Decided with the owner: no stud service records exist yet that used the old meaning.
- **Stud service boarding (2026-10-15).** Saving a stud service where someone travels asks
  **Log the boarding?** and opens the boarding form prefilled for the dog that travels. The
  Away board shows one row per trip (the boarding event replaces the service's own row).
  When that boarding ends, Today asks to update the stud service's dates and mark it
  Completed (`studboard`, in place of the status nudge). The match between the two is
  derived (dog, reason "Stud service", overlapping dates), no stored link.
- **Stud trips are boarding events (2026-10-15).** A stud service's dates no longer make an
  Away-board row; the board reads boarding events only. On boot, `migrateStudTrips` reads any
  outgoing / incoming direction as who travels and gives every in-person service's trip a
  boarding event (once per device, and never a second one for the same trip). The two dates
  are labelled Begins / Ends. Sample data's Birch trip is a boarding event.
- **Our dam's stud fee as an expense (2026-10-15).** Saving a stud service of our dam that's
  Completed with a fee asks **Log the stud fee as an expense?** and creates a Stud fee
  Expense on the breeding (else the dam), linked by the new indexed `expenses.stud_service_id`
  (`db.version(5)`, in `STUD_SERVICE_REFERENCES`, private like every expense field) so it's
  asked once. Our stud's fee stays income.
- **Kels: Add dogs (2026-10-15).** Roadmap §3.8, built the litter task's way at the owner's
  call: one roster of names (boy / girl, "+ Another dog") instead of "Add another?" after
  each, then a found name asked about first (a pedigree-only one is brought into use), what
  they have in common asked once and filled in on each, each dog's details and parents (a
  dog on file, one of the batch, or a typed name made pedigree-only), one review, a
  resumable save (`data/guidedDogs.js`, `assets/guidedDogsUI.js`, `settings.guidedDogsDraft`).
  Pro files each dog's papers in the chat after, through the Documents modal's own save,
  now exported (`storeDocumentFile`, `createDocument`). Lite's cap stops the save with the
  upgrade notice, keeping the dogs made so far. The litter task's step engine moved to
  `assets/kelsSteps.js` (`StepConversation`) so both tasks share it; the Dog page's
  planned-test seeding moved to `kennelRepo.seedTestsKennel` so Kels seeds the same way.
  Not yet: the pedigree photo, and the history step (waits for Add new events, §3.10).
- **Kels Add dogs: Lite room and purchases (2026-10-15).** In Lite the roster has only as
  many rows as she has room for (`dogCapStatus()`, "You have room for 2 more dogs"), and at
  the cap she shows the upgrade notice before any questions. After the save, "Did you buy
  any of them?" asks, in one form, each owned dog's purchase date (a rough date is fine),
  seller and price: an `acquisition` event and a linked `dog_purchase` expense. The event
  form's linked-expense write moved to `expenseRepo.createForEvent` so both share it.
- **Kels Add dogs: their shots (2026-10-15).** After the purchase question, "Do you have
  their shots on record?" asks one form per dog over a fixed checklist (`VACCINE_CHECKLIST`:
  Rabies, DHPP, Bordetella, Leptospirosis), each with its date and how long it's good for
  (`VACCINE_GOOD_FOR`: 1 / 3 / 5 years, lifetime), and "Remind me on Today when they're
  due". Each is a `vaccination` event with `next_due`, and the reminder the existing
  `reminder_date`, so Today's Reminders card shows it; the reminder logic is unchanged.
  Kels only: the event form's Vaccination type is as it was. Test support: memoryDb's
  collections gained `.and`.
- **Kels Add dogs: who bred them (2026-10-15).** A "Who bred Daisy?" step after each dog's
  parents: I did (her kennel as `breeder_kennel_id`), another breeder (Pro: their kennel,
  on file or new, and the breeder as a contact linked to it, picked or new), or not sure;
  Lite asks I did / someone else / not sure. Each dog starts with the one before's answer.
  No new fields: the breeder is a contact on the kennel (`contacts.kennel_id`), as the
  tidy-up expects. Dogs she bred skip the purchase question; "Bought from" starts as the
  breeder kennel's name.
- **Kels: one add-a-kennel (2026-10-15).** The tidy-up's "Add their kennel" / "Add a
  contact", the litter task's outside parent and Add dogs' breeder now share the fields
  (`kelsSteps.kennelNameField`, `contactFields`, `readContactFields`) and the save
  (`kennelRepo.findOrCreateOutside`: the outside kennel on file by that name, else a new
  one), so a kennel name typed in any of them never makes a second kennel. The tidy-up's
  own copy of `field()` went too.
- **Kels: ancestors by registered name, one way (2026-10-15).** A pedigree-only dog is now
  made one way, `dogRepo.createPedigreeOnly` (pedigree import, tidy-up, Add dogs), and a
  typed ancestor is matched one way, the pedigree import's rule as
  `pedigreeImport.ancestorMatches` (a number is that dog; a registered name, titles
  ignored, is asked about; never a call name). Add dogs' typed parent and the tidy-up's
  "just for the pedigree" now ask the registered name (required) and number, not a call
  name; Add dogs uses a dog on file by number without asking. The parents step says
  they're optional ("If you don't know yet, leave them as Not known").
- **Kels: one dog search (2026-10-15).** `data/dogSearch.js` `findDogMatches` replaces
  `guidedLitter.dogMatches` and `pedigreeImport.ancestorMatches` everywhere Kels looks for
  a dog on file (the litter task's new mom or dad, the tidy-up's parents, Add dogs and its
  typed parents): every typed name, call or registered, against both names of every dog,
  fuzzy and both ways; then the number (certain, or a different dog), breed and birthday
  (likely) and sex. Add dogs now asks "Is this her?" after each dog's details, with the
  reasons shown, and "Yes" on one of hers fills in only what's blank on it instead of
  leaving it out. Sample data's registration numbers lost their typed "AKC " prefix (the
  registry stays in `registry`); nothing in the app adds one.
- **Kels: forgiving of how people type (2026-10-15).** The dog search tolerates typos (a
  swapped pair is one slip; two for long words), sound-alikes, run-together names, numbers
  typed in name boxes on either side, a number one slip off ("nearly the same"), breeds
  spelled near enough, and birthdays a few days off or with day and month swapped; a
  clearly different number or breed now lowers a match instead of hiding it. Near-misses no
  longer block: `kelsSteps` takes a `{ key, message }` check, said once, then Next again
  keeps what she typed (`draft.warned`). Used for a typed parent like one on file, a new
  kennel or contact like one she has (Add dogs, the litter task, the tidy-up), a breed
  spelled unlike her dogs', and a registration number in a name box. Add dogs saves a breed
  in her dogs' spelling when it differs only in case or spacing.
- **Kels: breed and numbers, and the litter task's ancestors (2026-10-15).** A different
  breed (not a misspelling) is a different dog: never offered, unless the registration
  number is the same. `normReg` moved to `dogSearch.js`, and the tidy-up's duplicates use
  it too, so a number's spaces, slashes, dashes and a leading "AKC" never count anywhere;
  a number typed with spaces is read as one number. Record a new litter now looks at
  pedigree-only dogs for a new mom or dad and brings the one she picks into use instead of
  making a second (`newDogSpec.bringInId`).
- **Kels: end-to-end fixes (2026-10-15).** Running every touched flow in a browser found
  two bugs. The tidy-up's five chat forms that end in a record (pick a parent, pick or add
  a kennel, pick or add a contact) returned its id as a string, which `chat.form` shows as
  a problem: picking or adding did nothing, since the forms were written. They return
  `{ id }` now. And a same-number match of the wrong sex was `certain`, so a typed sire
  could be filled in with a female; a sex or breed that doesn't fit now keeps it
  `possible` (shown, saying why, never taken without her say).
- **Kels roadmap rule 10 (2026-10-15).** "Reuse before writing, and share what's
  repeated": a new step first looks for the same job in other Kels scripts and pages, and
  anything that would exist twice becomes one shared function with the copies removed; the
  rule lists the shared pieces so far.
- **Kels: a breed picker (2026-10-15).** The Dog page's breed suggestions (her dogs'
  breeds + her kennels' `preferred_breeds` from first-run setup) moved into the shared,
  pure `dogSearch.breedChoices` (one per breed whatever the case or spacing, her most-used
  spelling winning). Kels offers them as one-tap choices with **➕ A new breed**
  (`kelsSteps.breedPicker`), in Add dogs ("in common" and each dog) and the litter task's
  new mom or dad; a new breed typed near one she has still gets "Did you mean…?" (the
  litter task now asks it too).
- **Service worker v80 (2026-10-15).** Cache bumped for the Kels Add dogs batch (new
  `assets/guidedDogsUI.js`, `assets/kelsSteps.js`, `data/guidedDogs.js`, `data/dogSearch.js`).
- **Kels tidy-up: vets (2026-10-15).** Two Pro checks (`contactsSection`). Vet visits and
  surgeries with a typed vet name and no linked contact, one finding per name, are linked
  to the likely contact, one she picks, or one she adds; the contact is tagged Vet and
  replaces the typed name (`tidyRules.vetContactFindings`, `vetLinkFix`). And no vet in her
  contacts at all → add her vet or tag one. The kennel finding's pick and add contact forms
  became `pickContact` / `addContact`, shared with the vet findings. "vet" and
  "veterinarian" find the tidy-up in Pro. A browser run found that a tie picked the name
  shown by the order the event types loaded; it's now her most-used spelling, capitals
  winning a tie.
- **Kels: Finding Something (2026-10-15).** Her first message is now "…I'm here to help you
  manage your kennel :) What do you need help with first?" with **Finding Something** /
  **Doing Something** (the task menu), an unfinished draft first. Find searches the cheat
  sheet (`data/kelsKnowledge.js`: hand-written places, plus every report and expense
  category), her dogs, litters, people and kennels, and her tasks, with `data/kelsFind.js`:
  three levels (names; details; notes and events), each tried with her words before
  synonyms, and synonyms before slips; then one answer, or a question that splits them,
  or a short list, and a button that opens the page. Nothing found offers the common
  places or new words. `dogSearch.wordHit` is exported for it. Browser runs found: the
  search form returned a string (shown as a problem); synonyms pulled in every expense
  page for "receipts"; "rabies" stopped at "babies"; a tie picked "Litter P&L" over
  "Litters"; questions were asked with an obvious answer; a doubled "litter" in titles;
  the cheat sheet needed "puppy payments", "stud my dog", "people on waitlist". All fixed.
  The tidy-up's "contact", "breeder", "kennel" and "stud" keywords are now Pro-gated
  (Lite's Find offered the tidy-up for "contacts").
- **Kels Find intro (2026-10-15).** Finding Something opens like every task, with `chat.intro`: "Absolutely!" and its own how-it-works line (`KELS_FIND_INTRO`; `intro(opener, how)` takes it), answered Sounds great, let's start! / Never mind. The no-match places add Sharing your pups (Pro).
- **Kels: favorites (2026-10-15).** The Doing Something list puts unfinished work first, then starred tasks, then ones used often, then the usual priority (`data/kelsFavorites.js`). A ☆ in each task button's corner stars it (its own tap target; `chat.choose` `star`/`onStar`). More than 3 starts in 60 days shows "You use this often", with **Don't move this up** when opened (undone by starring). Kept on the device in `settings.js` (`kelsFavorites`, `kelsTaskUse`, `kelsNoPromote`), never backed up or synced.
- **Kels roadmap: Add people, Set up my application form (2026-10-15).** Proposed as §3.12 (contacts as a roster, each checked against what's on file, then optionally put on the waitlist) and §3.13 (the Waitlist form page as a conversation: start from the standard form, hers, or an old form's spreadsheet; locked questions reworded only; FAQ; review and one save). §4 adds "Adding a person": one contact-fields helper, one contact match rule (`data/contactSearch.js`, replacing `contactMatches` and the tidy-up's duplicate rule), and the applicant step lifted out of Set up my waitlist so all three tasks share it. Four open questions in §5.
- **Kels roadmap: Add people, breeders and vets (2026-10-15).** §3.12 now asks about a vet when she has none, links breeder contacts (new or on file without one) to an outside kennel, and ends by offering to set the breeder kennel on her dogs that have none. One more open question in §5 (which kennels that step offers).
- **Kels roadmap: decisions (2026-10-15).** Add people is Pro only; an applicant from Add people is linked to the new contact at once; one contact match rule (email or phone is a match, a name alone is a "maybe"); Set up my application form leaves the old-form spreadsheet import to the Waitlist form page for now.
- **Kels: Add people (2026-10-15).** Pro (contacts). A roster of names and what each is to her; "Do you have a vet you'd like to add?" when nobody listed or on file is a vet; how she met them (two or more); each person's details, then "Is this them?" for someone in her contacts (filled in where blank, never overwritten); each breeder's kennel (one she has or a new outside kennel); breeders on file with no kennel; review; a resumable draft (`data/guidedPeople.js`, `assets/guidedPeopleUI.js`, `settings.guidedPeopleDraft`). After the save, "Do you want to link any kennels to dogs you own as the kennel who bred it?" (this run's kennels first, never her own, only dogs with none), then buyers onto the waitlist where one is set up, linked to their new contact. Shared in the same change: `data/contactSearch.js` (one contact rule: email or phone is certain, a same or near name only "maybe"; `waitlistRules.contactMatches` now uses it, so the approval also offers phone and near-name matches; `hasVet`; the tidy-up's normalizers), `assets/kelsApplicant.js` (Set up my waitlist's "Add one by hand", now shared), and in `kelsSteps` `kennelPicker` (was copied in the litter task and Add dogs) and `addContactInChat` + `VET_WHY` (from the tidy-up). Browser run: the whole task on the sample data, no console errors.
- **Kels: Set up my application form (2026-10-15).** Pro (waitlist). The Waitlist form page as a conversation: which kennel, her form or the standard one (asked only when she has one), the locked questions' wording, her own questions (wording, type, choices, help, required; add / take off), their order, an FAQ (with common ones to start from), then the form as families see it and one save; a resumable draft so a half-made form never goes online (`data/guidedForm.js`, `assets/guidedFormUI.js`, `settings.guidedFormDraft`). After the save: the form's link when the list is online (published then), Sensitive records backup if it's off (cloud backup first), the application fee and how families pay with its payment account, and an applicant. Shared in the same change: `assets/waitlistFeeStep.js` (Set up my waitlist's fee screen and Stripe connect, now also "Another payment service…" by name and payment link), `assets/kelsBackupSteps.js` (turning on cloud backup and Sensitive records in the chat; Set up my waitlist's going online and account health's wording use it), `waitlistForm.LOCKED_TYPE_LABEL` (from the form page). Set up my waitlist's end offers this task with its kennel. Browser run on the sample data, every screen, no console errors; it caught the fee reply leaving out a payment account made in the same step (fixed).
- **Kels: the application form's link (2026-10-15).** After the save, Set up my application form offers the link families apply at, with **Copy the link**; when the form isn't online she first offers to take applications online (`saveWaitlistOnline`, cloud backup turned on first if it's off). Every offer to turn on cloud backup for the online form or list now warns that without it there's no link and each applicant is typed in by hand (`kelsBackupSteps.CLOUD_OFF_FORM`; Set up my waitlist's going online too), and "Not now" says so again. Browser run with a stand-in cloud server: the form goes online and offers its apply link to copy.
- **Waitlist reports (2026-10-15).** Three new Sales & Waitlist reports (Reports plan phase
  4), Pro: **Applications** (days between applications, approval and listing rates, days to
  approve and to the fee, what sex they ask for), **Waitlist Today** (who's waiting now in
  list order: girl / boy / either, program, breed, time waiting, passes, paused) and
  **Offers & Removals** (accepted / passed / no-response shares, families who passed, why
  families left, with removals by the list's rules grouped as "Didn't follow the list's
  rules"). Math in `data/waitlistReports.js` (`exitReasons` now reads `exitLabel`).
- **Applications report: what families asked for (2026-10-15).** Beside boy or girl, every
  answer that decides which pup a family is offered: what the pup is for (each purpose
  picked), which parents (any / only certain / any but certain, and the dogs they named or
  would skip), breed when families named more than one, color when a kennel matches on it.
  Charts, columns and For / Parents filters.
- **Placements by registration (2026-10-15).** Placements gains Pups placed by registration
  (count and share), Sale value by registration, and a Limited tile beside Full; Year in
  Review's Placements tile says "2 Limited · 1 Full" (`moneyReport.byRegistration`,
  `registrationSummary`). The Kels roadmap's kennel check-up (§3.14) now names the new
  waitlist reports and the registration split as its sources.
- **Kels finds litters by "puppies" (2026-10-15).** The Litters place's keywords gain
  puppies / pups and unsold / available puppies / pups, so "unsold puppies" or "available
  pups" goes straight to Litters, and plain "puppies" lists it (5th, behind the
  puppy-titled places).
- **Kels: Available puppies (2026-10-15).** A new place, Available puppies, links to
  `dogs.html?bucket=puppies&disposition=available`: the Dogs page now reads `?disposition=`
  as its starting Disposition filter (listView filters take an `initial` value, used only
  when it's one of the options). "unsold" / "available" (with or without puppies / pups)
  now offers both it and Litters.
- **Kels: "Zeus puppies" (2026-10-15).** Each dog with offspring is a second Find
  candidate, "<name>'s puppies", opening `dog.html?id=…#offspring` (the Offspring list
  under the pedigree; `pedigree.js` gives it `id="offspring"`, and dog.js scrolls to it once
  it draws). Its words are the dog's names plus puppies / pups / offspring / babies…, and it
  `requires` the dog's name (a new candidate field in `kelsFind`), so "puppies" alone lists
  no sires and "Zeus" alone is still Zeus.
- **Kels: "Zeus puppies" asks what about Zeus (2026-10-15).** Replaces the "<name>'s
  puppies" candidate (and kelsFind's `requires`) from earlier the same day. New
  `data/kelsAbout.js`: a dog's name plus topic words gives Kels the dog's facts and three
  topics (one of its puppies, its litters, what its puppies sold for). She asks only when
  two or more topics have something (decided), with counts on each choice and "Something
  else" for the ordinary search; a choice lists only that dog's records (sales as each
  sale, plus Breeding-Dog Return). `offer`/`list` in kelsFindUI take `extras` (places
  under the list). Precached `data/kelsAbout.js`.
- **Kels: shots and vet for a dog (2026-10-15).** `kelsAbout` gains `shots` (vaccination,
  preventative) and `vet` (vet visit, illness, medication, surgery, injury): each of the
  dog's events opens on its page (`?openEvent=`); Kels says the last one and the next shot
  due (overdue when past). Both offer adding one ("Add a shot for JJ", "Add a health event
  for JJ" → `?logEvent=`), first in the list; an add word (log, add, gave, got…) makes
  Kels lead with it, since she may be adding, not finding. Filler words (her, last, next,
  history…) are ignored in "<dog> <topic>".
- **Kels: "JJ vet" names her vet and her vet costs (2026-10-15).** The vet topic says who
  saw the dog last (linked vet contact, or the event's plain-text vet) and its Veterinary
  expenses this year, and offers each linked vet contact (Pro) and "JJ's vet expenses".
  Financials → Expenses reads `?dog=<id>` (only that dog's costs, "Show every dog →", kept
  across the category tabs), like `?account=`.
- **Kels: Understanding Something (2026-10-15).** A third button on Kels's first screen:
  how the app works, as an FAQ (roadmap §3.14 A, step 1). New `data/kelsUnderstand.js`
  (pure: `SECTIONS`, `ENTRIES`, `understandEntries` per edition, `understandSections`,
  `understandCandidates`) and `assets/kelsUnderstandUI.js` (topics → questions → answer with
  Show me; a search over the entries only, through `kelsFind.search`);
  `kelsChat.KELS_UNDERSTAND_INTRO`. 39 entries across six topics, chosen as only what a
  breeder who has used other apps would still get wrong here (a kept pup stays a Puppy;
  what keeps a litter open; who needs an owner; a delivered pup goes External, or leaves
  the program in Lite; archiving a sale takes its money out; when a payment is earned; a
  cancelled sale keeps only dated payments; waitlist place, turns, passes, picks; local
  data, Merge vs Replace…). Lite gets its own entries where its rules differ, and no limit
  topic. Precached both modules; `tests/kelsUnderstand.test.js`. Roadmap §3.14 marked.
- **Kels: Understanding Something's two halves (2026-10-15).** The button now runs a list of
  halves (`kelsUnderstandUI.HALVES`): How KennelOS works today, How my business is doing
  (reports) when built. With two, she asks "Yes, absolutely! Which is your question
  about?"; Lite, with one, goes straight in. Each half has its own intro, said once a
  visit; How KennelOS works's is now "I'm on it! I can explain the rules KennelOS follows
  behind the scenes…" with examples Lite has too. Something else after an answer returns
  to the question. Roadmap §3.14 records B's approved intro and the Lite decision (no B).
- **Kels FAQ checked against the code; Merge keeps newer edits (2026-10-15).** Answers
  corrected where they disagreed with the rules as built: a record's kennel comes from its
  dogs, not the kennel being viewed; who needs an owner is External / Leased in; an
  unfinished sale keeps a litter open; "Not this litter" on a whole turn counts as a pass,
  as does no response by default, and a program can exempt passes; a pick can switch after
  the deposit until the next family is offered; a released sale frees a pup; earned covers
  stud and waitlist fees; income lines name the waitlist family; boarding only when paid;
  Companion link types; the public list shows the date a place counts from; the online
  waitlist entry gated by `isWaitlistOnlineOffered` (new `online` in ctx). File / Dropbox
  Merge: `planFileMerge` and `restoreBackup(obj, 'merge', { keepNewer })`; Import/Export
  asks keep-mine / take-the-file when this device has newer edits (it used to overwrite
  them silently). `tests/fileMerge.test.js`. Open: matching records across devices whose
  ids differ (same dog typed on two devices), proposed as a restore-time match + id remap.
- **File Merge pairs what each device entered on its own (2026-10-15).** New
  `data/restoreMatch.js` (pure): per-table rules (Same / Ask / Never) for kennels, accounts,
  contacts, waitlist programs, feeding schedules, dogs (registered name with titles
  ignored, registration number, microchip; pups through their litter; call name asked),
  pairings, litters, sales, stud services, contracts, events, expenses, documents and
  their files, waitlist entries and offers; only records whose id isn't on the other
  side; one to one, ambiguity asked. `planFileMerge` now plans the pairs, the open
  questions and a paired dog's clashes (name, sex, sire, dam); `restoreBackup('merge',
  { keepNewer, answers, clashChoices })` gives each pair the backup's id (this device's
  when cloud backup or live sync is on), re-keys every record, `device_secrets` and the
  app's settings (`settings.remapStoredIds`), and merges fields (blanks fill, newer wins,
  lists join, notes keep both). Lite's cap is checked on the merged dogs. Import/Export
  asks "Are these the same?" and "Which should I keep?" before writing. Guide §10 holds
  the rules. `tests/restoreMatch.test.js`, more in `tests/fileMerge.test.js`; memoryDb's
  localStorage gained `key()`/`length`. Next: the same rules for on-device duplicates
  (Tidy up for every record type, kennels included, and a Scan for duplicates card on
  Import/Export).
- **Kels FAQ: Lite never says archive (2026-10-15).** "Why did a sale's money disappear"
  is Pro only (`manualDogArchive`); Lite gets "I entered a sale or an expense by mistake. How
  do I take it out?" (Delete; end a sale that fell through with a status). The deceased
  answer drops "rather than archiving it" in Lite. Test: no Lite question or answer says
  archive.
  The topic is "Removing and deleting" in Lite (`labelNoArchive`; `understandSections` /
  `understandCandidates` take the edition's flags).
- **Kels FAQ: the pregnant-dog walkthrough (2026-10-15).** "Do I record the breeding or the
  litter?" (`pairing-litter`) is now "My dog is pregnant or had puppies. How do I enter this
  so I can sell them?", answered as four steps: the pairing, its litter (Expected until
  born), the puppies once Whelped, and each pup's plan (Available / Keeping / Undecided),
  with Record a litter with Kels as the guided route. Keywords widened so "pregnant",
  "puppies born", "sell puppies" and "record the litter" all find it.
- **Kels FAQ: the outside-stud answer (2026-10-15).** `our-stud` now asks "Should I record
  the litter?" and says where the stud service goes (Placements & Contracts, Stud Services
  tab) and that its terms and fee structure are what make the fee income.
- **Kels FAQ: whole-litter logging (2026-10-15).** `litter-logging` now asks why a
  whole-litter entry isn't on the litter page, and answers that each pup gets its own entry
  so its history runs for life, found in the pup's Event History.
- **Kels FAQ: the go-home date (2026-10-15).** `go-home-day` now says what follows the
  drop-off entry: once its date has passed, Today asks whether the pup went home and offers
  Delivered, and Delivered asks about External (Pro) or removing the pup (Lite).
- **Kels FAQ: no "Today" in answers (2026-10-15).** Every answer that sent her to Today now
  says "you'll be prompted" or "the app" instead (kept-pup age reminder, an open litter, a
  dog that died, pairing ↔ litter, the stud pick, the go-home date, waitlist offers, a
  dismissed prompt).
- **Kels FAQ: The Today hub (2026-10-15).** A new first topic explaining what's on Today
  and the rules behind each card: nudges (derived suggestions; nothing changes until she
  acts; Dismiss is per device), reminders (any event's reminder date; Overdue / Due soon /
  Upcoming; logging the next one doesn't clear the old one), what an active litter is (one
  or more Available pups), Due outs & upcoming (one-day events from today on; shows apart
  in Pro), and Away from home (Boarding entries not yet ended; a stud trip in Pro).
- **Log new clears its reminder (2026-10-15).** A reminder's Log new on Today now carries
  `fromReminder=<event id>`; `eventForm.openEventFromQuery` dismisses that reminder once the
  new event saves (same subject and type only; cancelling leaves it). The Kels reminders
  answer says so. Checked in the browser: logging the next vaccination from its reminder
  leaves no reminder pending.
- **Service worker v81 (2026-10-15).** Cache bumped once for everything since v80: PRs
  #124–#129 merged to main without a bump (Kels Add people / application form, Find,
  Understanding Something, waitlist reports) and this branch (the Kels FAQ rework and Today
  hub topic, Log new clearing its reminder, file Merge pairing). New precached files since
  v80: `assets/guidedFormUI.js`, `guidedPeopleUI.js`, `kelsApplicant.js`,
  `kelsBackupSteps.js`, `kelsFindUI.js`, `kelsUnderstandUI.js`, `waitlistFeeStep.js`;
  `data/contactSearch.js`, `findRecords.js`, `guidedForm.js`, `guidedPeople.js`,
  `kelsAbout.js`, `kelsFavorites.js`, `kelsFind.js`, `kelsKnowledge.js`, `kelsUnderstand.js`,
  `restoreMatch.js`; the Applications, Offers & removals and Waitlist today reports. All 394
  precache paths checked present, and every app file is in the list.
- **Kels: Get set up (2026-10-15).** A new task for a new breeder's first run through her
  settings (`assets/kelsSetupUI.js`, pure rules in `data/kelsSetup.js`, tested): her logo
  (where something prints it), lifecycle nudges, Puppy Record fields (Pro), another own
  kennel for a separate side of the business with this kennel's nudge and Puppy Record
  settings copied (Pro, multi-kennel), Google Drive for Furever connected in the chat (GIS
  loaded on demand, the window opened from her tap), Dropbox for KennelAssistant (the
  KennelAssistant page in a new tab, since Dropbox only returns to registered pages), then
  cloud backup or a backup file; then Add dogs or Add people. Each part saves as answered
  and can be skipped. Lite (no Kennel page) gets the backup part and Add dogs; not in the
  Demo. Menu priority 95 until she has her first dog record (of any kind), else 15. The Kennel page's logo resize, nudge fields and Puppy
  Record boxes moved into `assets/kennelSettingsFields.js` (Pro-only) so Kels and the page
  share one copy; `kelsBackupSteps` exports `cloudBackupOn`. Precached: the three new
  files. Checked in the browser (Pro and the Lite build): the whole run, the saved kennels,
  the Google window and the KennelAssistant tab opening, the low menu spot afterwards, and
  the Kennel page's three cards still saving.
- **Kels Get set up: preferred tests (2026-10-15).** A part after lifecycle nudges (where
  the Kennel page is, so not Lite): her preferred tests listed with their breed tags, then
  add (one per line, optionally for some of her breeds), remove, or rename, round after
  round. New `kennelRepo.renamePreferredTest` (in place with its breed tags; renamed onto
  another test, the two merge; panel only), tested in `tests/preferredTestRename.test.js`.
  The task also now leads the menu until her first dog record, however often she's run it
  (the unreleased `kelsSetupDone` flag removed). Checked in the browser: add three, rename
  one, remove one, saved as shown.
- **Meet Kels card; Getting Started (2026-10-16).** Kels's setup task is renamed Getting
  Started. Decided: it never starts on its own. Instead, the first page after the first-run
  kennel setup saves (which both the tour's end and Start my kennel reach) shows a one-time
  Meet Kels card with her photo, **Try Getting Started** (opens the task) and **Maybe later**
  (`onboardingUI.maybeMeetKels`, device-only `meetKelsPending` set by the required kennel
  setup's save). Checked in the browser on both paths: shown once, gone on reload, never on
  Kels's page, and Try opens the task.
  The card is titled **Introducing Kels**, with the Meet Kels line as its first paragraph.
- **Kels: How my business is doing (2026-10-16).** The second half of Understanding
  Something (roadmap §3.14 B, steps 3–4), Pro: a topic (My dogs, Money, Litters & pups,
  Sales & the waitlist, Shows & stud, The whole picture) and dates, then a few plain
  sentences from her reports, Tell me more, and a button to each report quoted, opened on
  the same range (`assets/kelsInsightsUI.js`, pure `data/kennelInsights.js`, tested). To
  keep her and the reports from ever disagreeing, the 23 reports she quotes now load
  through `data/reportSources.js` and their tiles' figures come from
  `data/reportFigures.js`, both shared with the pages; `reportMath.inView` cuts rows to a
  range for both. Reports open on `?range=`. Dam & Sire Production gained a date range and
  a row per breeding female of breeding age with no litter, said as what happened.
  Decided with the owner: rank only past 2 litters / 3 decided breedings / 3 sales,
  "no litter" means Active breeding females of breeding age, the comparison with the range
  before comes after the first release, Lite has no B. Checked in the browser: every report
  page's rows and tiles against the commit before (only production's new row and the link
  range differ), each topic's sentences on the sample data, the empty-range offer, a report
  link on its range, and Lite's Understanding Something unchanged.
- **Litter delivery type (2026-10-16).** New optional `Litter.delivery_type`
  (`vocab.LITTER_DELIVERY_TYPE`: Natural, Natural assisted, Planned C-section, Emergency
  C-section), synced (cloud; `cloudFields.js` regenerated). The Litter page shows it only
  once the litter is Whelped or later and asks for it when a litter first gets there (or is
  created there) without one; Kels's Record a new litter asks it after the counts ("I'll add
  it later" saves nothing); the tidy-up raises each whelped litter without it, newest first
  ("I don't remember" is remembered); the litter CSV import takes a `delivery_type` column.
  No schema block (a plain field). Tested: the repo's value check, the guided step and save,
  the tidy finding, the import's words. Checked in the browser: hidden while Expected, shown
  on Whelped, the prompt on save, and the tidy-up fix.
  A dog's Litters list shows it as a pill after the status, by a short label (Natural,
  Assisted, Planned C-sec, Emergency C-sec).
- **Kels: Cancel a task (2026-10-16).** A **Cancel** button in Kels's header beside Save for
  later, shown while any task runs. It asks "Are you sure?" (Yes, cancel / Keep going); yes
  drops the open question, throws away a resumable task's draft (each resumable task names
  its `discard`), says "Okay, I've stopped." and goes back to the menu. Records already saved
  stay. Checked in the browser at phone width: both buttons fit, Keep going leaves the task
  as it was, Yes ends it and hides both buttons.
- **Live sync: the UI (Cloud Phase 2 step 6, 2026-10-16).** **Keep my devices in step** on
  Import / Export → Cloud, under Sensitive records (`assets/cloudSyncUI.js`): turn on (what's
  missing named first), join (offered in place of restore / replace wherever a backup gets
  the syncing 409, and after Sign in and restore), catch up, each pause with its fix, turn off
  here / for every device (typed, fresh sign-in), and the activity list in words
  (`data/cloud/syncActivity.js`). `bootCloud` starts the scheduler on a device that syncs.
  An open record page whose record arrives shows "Updated on another device" with Reload; a
  list or Today reloads itself (keeping scroll) unless she's typed there or a dialog is open;
  other tabs hear by `BroadcastChannel`. Server: `/sync/head` counts devices in step (cursor
  in the last 30 days) and `GET /devices` gives `lastSyncAt`; no migration. A backup paused
  as a second device no longer blocks joining, and a finished join clears it. Behind
  `cloudConfig.SYNC_RELEASED = false` (offered only against staging). Privacy policy: the
  paragraph and retention line. Tested: the release switch, the activity sentences, the
  readiness rule, the head count and `lastSyncAt`. Checked in headless Chromium, two
  profiles as two devices against the real Worker run locally: turn on, restore and join on
  the second, an edit reaching the other's open dog page and its Dogs list tab, the device
  list, the activity list, off here and back, a lapsed license, off everywhere and on again.
  Still to do: two real devices, then the release with the `CACHE_NAME` bump.
- **Live sync: joining dedupes, a new device joins directly, a stale backup base (2026-10-16).**
  A join now pairs records entered on both sides with a file Merge's rules before it pulls
  (`importExport.planJoinMatches` / `mergeJoinMatches`, `restoreMatch` unchanged), asking
  "Are these the same?" and a paired dog's clashes (moved from the Import/Export page into
  `assets/mergeQuestions.js`, shared); a pair keeps the cloud's id, re-keyed everywhere on
  this device. Sign in and restore on a syncing program joins instead of restoring, once
  Sensitive records unlock (`cloudBackup.prepareDirectJoin`, `adoptOwnKennel`). Fixed: a
  syncing device's backups were skipped for good once another device made the latest
  snapshot; a caught-up refusal now adopts the server's latest as the base, once. Tested:
  a join pairing a kennel and two dogs (one asked, one clash), the event and setting re-keyed,
  no second Birch on either device; backups from both devices in turn (fails without the
  fix). Checked in headless Chromium: a second device with its own Birchie, Willow and Maple
  signing in → the two questions → one of each everywhere, under the cloud's ids, both
  devices' notes kept; both devices' backups pushed.
- **Live sync released (2026-10-16).** `cloudConfig.SYNC_RELEASED = true` and the service
  worker cache to `kennelos-shell-v82`. Decided with the owner: released to production ahead
  of the real-device checks (iPhone and Android home-screen apps and a laptop), which follow
  there (LAUNCH_CHECKLIST).
- **Scan for duplicates on Import/Export (2026-10-16).** A **Duplicates** card between Backup
  & restore and CSV import (`assets/duplicateScanUI.js`). New `data/duplicateScan.js` (pure)
  runs a file Merge's matching rules (`restoreMatch.MATCH_RULES`, now exported with `dogNever`)
  between two records on this device, plus the tidy-up's duplicate dogs and contacts, over every
  record type the edition has (Lite: its own kennels, dogs, breedings, litters, sales, events,
  expenses). Each pair is raised with what they share, certain or possible, and nothing merges
  by itself; two littermates by name are only possible. "Not the same" is remembered (`dup:`,
  plus the tidy-up's key for dogs and contacts). New `recordMerge.mergeDuplicate`: dogs and
  contacts through `mergeRecords`; any other record merged field by field
  (`duplicateConflicts` / `duplicateChanges`), its id replaced in every field of every record,
  the other archived, then settings re-keyed; a kennel's public ID never copied, and her
  kennel never merged with someone else's. `describeRecord` now names every record type (the
  file Merge's questions too). Tested: every table found, Lite's subset, the never-pairs, a
  dismissed pair, a litter merge moving pups / events / expenses / a setting, event details,
  the kennel refusals, a dog merge then a clean rescan. Checked in headless Chromium at phone
  width: two Bellas and a doubled weight check found; merging the Bellas raised their two
  litters next; Lite's card lists only its record types.
- **Every merge gets rid of the duplicate (2026-10-16).** Decided with the owner: wherever two
  records are merged, all keys and history move to the kept one and the duplicate is deleted,
  never archived (an archived copy still counted: a departed dog in Lite, an extra pup in a
  litter count). `recordMerge.mergeDuplicate` is now the one on-device merge (Kels's
  `mergeRecords` calls it): the kept record through its repo, then the duplicate's id replaced
  in every field of every record (lists de-duplicated, owner never also co-owner), then the
  duplicate deleted once its registry array is clear, its own file with it unless the kept
  record took it over, then settings re-keyed. `EXTRA_REFERENCES` and `MERGE_SPEC.references`
  are gone (the sweep covers them). Cloud restore (new device, take over, Restore as of) now
  pairs records entered on both sides before its overlay, as a file Merge and a sync join do
  (`importExport.cloudSnapshotRows` + `planJoinMatches` / `mergeJoinMatches`; the backup's id
  wins), asking "Are these the same?" through `restoreSnapshot`'s `ask` (cancel writes
  nothing). File / Dropbox Merge and the sync join already left no duplicate. Tested: dogs,
  contacts, litters and documents deleted after a merge with files kept or removed, a list
  naming both; a cloud restore on a second device pairing its own kennel and two dogs (one
  asked), the duplicates gone, its private notes and litter and My kennel moved, and a
  cancelled question writing nothing.
- **R2 orphan sweep (2026-10-16).** Retention deletes D1 rows before R2 objects, so a failed
  R2 delete left objects nothing tracked and nothing found again. `retention.sweepR2Orphans`,
  run at the end of every retention, walks the bucket ten pages (10,000 objects) a run from
  where the last stopped (new migration `0017_r2_sweep`: one row, R2's list cursor and when
  the pass began / last finished) and deletes `files/<program>/<sha256>` with no `files` row and
  `snapshots/<program>/<id>.json.gz|.vault` with no `snapshots` row. Never: other key shapes, a
  program D1 doesn't know (an emptied or re-imported D1 deletes nothing), objects uploaded in
  the last day; and a run finding over 1,000 deletes none and stays put, reported as
  `r2SweepHalted` on /ops and in the cron log. The test bucket's `list` now gives `uploaded`.
  Tested: the leftovers deleted and everything else kept, a bucket walked over three runs, the
  halt. Production needs `0017` applied from /ops after deploy (the cron skips retention while
  a migration is pending).
- **Extra charges (2026-10-30).** Decided with the owner: a breeder sells photo and video
  packages, several to one family, each on its own invoice line, always with a puppy sale,
  paid with the balance, Pro only. A fixed column like `transport_fee` couldn't itemize, so a
  sale now carries `extra_charges[]` (`{ id, label, amount, fee_for? }`) and each kennel a price
  list (`extra_charge_list[]`, the Kennel page's new **Extra charges price list** section);
  picking one on the sale copies its name and price. New module `data/extraCharges.js`; each
  charge is an `extra` income component keyed `extra:<id>`, so the invoice, generator, receipt,
  PDF and payment link print one line per charge, and Financials, Receivables and the P&L file
  them under **Extra charges**. The Companion balance and the litter's sale totals include
  them. Also decided: PayPal / Zelle sent as business is charged back as an extra charge, not a
  new kind of fee. A Payment service account's new **Charge this fee back to the buyer**
  (`fee_charge_back`) makes the Sale page, once the deposit is paid through it, offer to add
  `<account> fee` (the account's rate on the deposit) to the balance; the fee the processor
  kept stays `processing_fee_amount`, so the two cancel in earned income. A fee on the balance
  payment itself isn't handled (option A): she adds it before invoicing. All three fields are
  private. Flag `extraCharges` (Lite false). Sample data: Thornfield's price list and a photo
  package on Cedar's sale. Tested: the list rules, the charge-back offer, per-charge lines and
  keys, paid with the balance, dropped on a cancelled sale; in the browser, the form, price list,
  offer and invoice. Service worker cache bumped to `kennelos-shell-v83`.
- **Kels: extras and how families pay (2026-10-30).** Decided with the owner: Getting
  Started gets two Pro parts after Puppy Record fields. `extra-charges` lists or sets up the
  kennel's extras price list. `accounts` ("vendor and third-party accounts", the owner's
  name for it) lists every account and adds or changes them in rounds: name, type, website,
  a marketplace's or payment service's fee, a payment service's link and (with
  `extraCharges`) "Only some families pay this way, and I charge them the fee"; logins stay
  on the Accounts page. A new Stripe one offers Connect Stripe (`waitlistFeeStep.offerStripe`,
  now exported). Pups are going home's balances step asks
  each family, before the payment request, to add the deposit's charged-back fee (catching
  deposits the Sale page never saw) and any extras from the price list, then says the new
  balance. `kelsSetup.accountLine` and `FEE_ACCOUNT_TYPES` are new. Tested: the part lists and the line; in the
  browser, Getting Started through both parts (price list changed, PayPal (business) added
  as a payment service with its fee and charge-back) and Pups are going home adding the fee and an extra.
- **Application answers blank on phones (2026-10-30).** A waitlist entry's Application
  section showed its question labels with tall empty gaps and no answers on a phone. The
  `.dl-meta` grid sized its label column `max-content`, so a long question ("What are you
  looking for in a puppy? Choose all that apply.") took the whole width and squeezed the
  answer column to 0px, where each answer wrapped a letter per line off the card's edge.
  The label column is now `fit-content(40%)` with `minmax(0, 1fr)` values, and labels wrap.
  Tested: at 390px the answers sit beside their wrapped labels; `node --test` passes. SW cache bumped to v84.
- **Set up my accounts (2026-10-30).** The owner couldn't find the accounts setup inside
  Getting Started, so it's also its own Kels menu task now, **Set up my accounts** (Pro,
  `accounts`, priority 22, not in the Demo): `kelsSetupUI.runAccountsTask` runs the same
  `accounts` part with its own opener (`kelsSetup.ACCOUNTS_HOW`); searchable by vendor,
  marketplace, PayPal, Zelle, Stripe, fees and the like. The owner declined a separate
  extras price list task. Tested in the browser: the tile, a search for "paypal", the task.
- **Help text on the matching questions (2026-10-30).** The owner asked for hints under
  application questions. Every question's Help text was saved and published, but the
  online application page (`cloud/public/family/apply.js` `prefHtml`) drew the five
  matching questions (male or female, breed, looking for, colors, soonest) without it; it
  now prints her help text under each, below the page's own note where there is one
  (colors, looking for). Ships with the Worker's static files. Tested in the browser with a
  stubbed form: every help text shows. Service worker cache bumped to `kennelos-shell-v85`
  for this batch (Set up my accounts).
- **More "with Kels" buttons (2026-10-31).** Asked by the owner, beside the Breeding page's
  Record a litter with Kels: **Set up your waitlist with Kels** (Waitlist), **Set up your
  application form with Kels** (Application form), **Set up your accounts with Kels**
  (Accounts, hidden in the Demo), **Add your dogs with Kels** (Dogs) and **Add your people
  with Kels** (Contacts). `kels.html` now passes `&kennel=<id>` to the task, and Set up my
  waitlist uses it (the form task already did), so both open on the page's kennel. Tested
  in the browser with two kennels: every button, and both waitlist tasks starting on the
  second kennel without asking.
- **Add people → the waitlist, ticked (2026-10-31).** Asked by the owner: after the save,
  Add people now asks "Do any of these need to go on your waitlist?" with a box for
  everyone just added who isn't already on one (it offered only people typed Buyer, one
  at a time). Then the kennel once (with several waitlists), then each ticked person's
  application in turn, linked to their contact (`kelsApplicant.askApplicant`); Not now on
  one skips to the next. Tested in the browser: two people added, both ticked, both
  applications saved linked to their contacts.
- **Add people → waitlist, with the fee and the order (2026-10-31).** Decided with the owner:
  a person she ticks for the waitlist gets Buyer added to their types (never replacing one)
  and is **approved**, since she added them herself. With a fee Kels asks: paid (when, how;
  on the list from that day), not yet (fee due), or not charging (a waived program she has,
  a new program through `waitlistSetupUI.askNewProgram`, now shared with Set up my
  waitlist's program step, or waived for just them). Then the ones now on the list, numbered
  in their order among themselves; a change uses `waitlistRules.chosenOrderChanges` (new,
  tested): `fee_received_at` a second apart, and a moved-by-breeder date only for someone put
  after a later payer. Then each one's place on the list. With no waitlist set up, Set up my
  waitlist and Set up my application form run inside Add people first (`within` on both: no
  families step, no "add a family"/"anything else?"). Tested in the browser: paid and
  waived applicants, a reorder, places #6 and #7, and the no-waitlist path end to end.
- **Paused families on the public list, by choice (2026-10-31).** Asked by the owner: a new
  Waitlist settings box, "Show paused families on the public list" (`waitlist_config
  .public_show_paused`, off by default). On, paused families keep their row at their number
  on the online list and the copied text, with "Skipped until <date>" in place of their sex
  preference (`waitlistRules.pausedUntil`: their `paused_until`, or the readiness hold's
  ready date, the later when both; "Skipped for now" while "Ready now?" is unanswered). No
  sex preference or pause reason is published for them. The online table's renderer
  (`cloud/public/family/common.js`) ships with the Worker's static files. Tests in
  `tests/waitlistForm.test.js`. Service worker cache bumped to `kennelos-shell-v86`.
- **Today shows a family's message as it arrives (2026-10-31).** Asked by the owner. The
  "A message from …" nudge existed, but Today drew its nudges once on load, and the waitlist
  inbox takes messages in a moment after the app opens (and every 5 minutes), so a new
  message only showed after leaving and coming back. Today now redraws its nudges on
  `CLOUD_DATA_CHANGED_EVENT` (debounced 1.5 s). Tested in the browser: a message added with
  Today open shows within seconds; without the change it showed only after a reload. Rides
  the `kennelos-shell-v86` cache bump.
- **Notifications plan drafted (2026-10-31).** Asked by the owner: app alerts on Android and
  iPhone for family messages and other waitlist activity, and an opt-in email digest
  (separate, since it means the server keeps her readable address). Draft in
  `docs/KennelOS_Notifications_Plan.md`, modeled on the MCCE repo's §19 push plan. Nothing
  built; decisions D1–D5 open.
- **Notifications built (2026-10-31).** Asked by the owner, decisions D1–D5 as recommended
  (`docs/KennelOS_Notifications_Plan.md` §8 has what changed from the plan). Server:
  `cloud/src/notify.js`, migration `0018_notifications.sql` (`notify_settings`,
  `push_subscriptions`, `notify_items`), hooks in familyActions (messages, picks, passes,
  requests, leaving, "Ready now?"), familyPages (a confirmed application) and serverMoves
  (turns closed or offered); payload-free web push with VAPID (one secret,
  `VAPID_PRIVATE_JWK`, generated on /ops); the email digest (her address kept only while on,
  another address confirmed by code, hourly cron, `/notify/off` page); retention and account
  deletion cover all three tables. App: Settings → Notifications (`assets/notificationsUI.js`,
  Pro-only), `data/cloud/cloudNotify.js`, `sw.js` `push`/`notificationclick`, a daily
  re-subscribe on open. Tests: `cloud/tests/notify.test.js` (14) and one in
  `serverMoves.test.js`. Tested in the browser against the local Worker: the card, the
  digest turned on, and an alert shown by the worker on a delivered push; subscribing
  itself couldn't be tested here (the sandbox can't reach Google's push service), so the
  20-second give-up message was. Not yet tried on real phones.
- **Heats, monthly preventatives, and Check in on my dogs (2026-10-31).** Asked by the owner.
  `data/dogCare.js` (pure, `tests/dogCare.test.js`): the next heat is 6 months after a single
  heat, else the last start plus her average interval (`heatRows` and the Heat Cycles report now
  use it too, so one heat gets a prediction); `preventativeGaps` for the month. Today: the
  `heatwatch` nudge ("…is expected to go into heat soon — keep an eye out" from 30 days before,
  "…was expected to cycle recently — has that happened?" after; a logged heat, future too,
  moves it) and `preventatives` (from the 1st until every active breeding dog has a
  preventative dated this month). The Dogs page's **Log for several dogs** (the litter's
  cascade event form, `cascadeTitle`/`cascadeSelected`). Kels's **Check in on my dogs**
  (`assets/dogCheckinUI.js`). Main had taken v86 (PR #138), so the notifications batch and this
  one ride `kennelos-shell-v87`. Tested in the browser: both nudges and their wordings, Log
  to the form and back to Today with the nudge gone, and the Kels flow end to end.
- **Multi-dog forms tick only active breeding dogs (2026-10-31).** Asked by the owner: Log for
  several dogs and Kels's preventatives form list the dogs at home (`dogCare.homeDogs`: active
  breeding, retired breeding, for sale), with only active breeding dogs ticked (from the
  preventatives nudge, only those still missing this month's). Checked in the browser.
- **Family Help plan drafted (2026-10-31).** Asked by the owner: Kels on the public list and
  status pages answering families' common questions from a KennelOS cheat sheet (the owner
  writes it) and the breeder's FAQ, with her intro decided by the owner; an optional Claude
  Haiku 5.5 "ask in your own words" layer (about $0.0002–0.0007 a question). Draft in
  `docs/KennelOS_Family_Help_Plan.md`; nothing built.
- **Family Help plan: decisions (2026-10-31).** D2 (each breeder turns Layer 2 on), D3 (the cheat sheet format) and D5 (20 questions per family a day) decided by the owner; D4 (Layer 2 after Layer 1 has been used) still open.
- **Family Help plan: D4 decided (2026-10-31).** Layer 2 (Haiku) is a second version, after Layer 1 has been used.
- **Kels preventatives: log more than one (2026-10-31).** Asked by the owner: Check in on my
  dogs' preventatives step asks "Any other preventatives to log?" after each product
  (**Log another** / **No, that's all**), each later form ticking the dogs picked last time,
  so heartworm, flea & tick and a dewormer are each logged in turn. With none missing it asks
  first. Also drafted **Review my waitlist** (Kels Roadmap §3.16, proposed): the order and
  wording for messages, requests, overdue offers, open picks, turns, applications, fees,
  "Ready now?" and lost or cancelled sales. Nothing of it built.
- **Review my waitlist: sales step reworked (2026-10-31).** Asked by the owner: the "lost and
  cancelled sales" report step is dropped; step 2 now asks whether she needs to cancel or void
  any sales (backed out, pup died, failed a health check, returned) and runs the Sale page's
  follow-ups. Still a proposal; nothing built.
- **Family Requests plan drafted (2026-10-31).** Asked by the owner: price-list groups with
  age windows for families requesting and cancelling extras (training packages too), pickup
  slots and locations booked from the status page, mileage from her standard location,
  transport (flight nanny) suggestions, training packages tied to boarding, and backing out
  with a deposit policy by reason and age. Draft in `docs/KennelOS_Family_Requests_Plan.md`
  with decisions D1–D9; nothing built.
- **Family Requests plan: D4 provider decided (2026-11-01).** Asked by the owner: driving
  miles come from Mapbox (geocoding + Matrix) through a Worker endpoint, `POST /geo/distance`,
  storing only miles and minutes. Whether levels 1–2 ship first is still open.
- **Family Requests plan: D1, D2, D5, D7 decided (2026-11-01).** Asked by the owner: no prices
  on the server (a link to her own page, opened in a new tab, and her message above the extras
  listed by name under group headings); every request waits for her approval (alert, digest,
  nudge, one-tap Approve); families can give their own address, measured with Mapbox, with a
  "she'll be in touch" answer and a new `transport_options` email over her mile limit; a moved
  deposit puts them at the end of the line on their existing entry, reopened. Still a plan.
- **Family Requests plan: transport email and standard address (2026-11-01).** Asked by the
  owner: the `transport_options` email is one she sends with a tap (Communicate… and the
  address request), never automatically; her standard location is a public place, so it's
  held on the server to measure families' addresses from. Open questions listed in full
  (D3, D4b, D6, D8–D15).
- **Family Requests plan: mileage basis, refunds, extras payment plans (2026-11-01).** Asked
  by the owner: one way / round trip is a radio-button setting beside the fee per mile; a
  refund on a back-out voids the sale but sits under More options with a typed confirm; extras
  get payment plans (percent steps due at an age, on approval, before pickup or with the
  balance), each step its own invoice line and income part, with an `extra-due` reminder.
- **Family Requests plan: D14 decided (2026-11-01).** Asked by the owner: approving a back-out
  lists the pup's extras, boarding and drop-off with tick boxes; paid or finished extras start
  kept and stay owed (invoiceable, reminded, anticipated income) on the cancelled sale.
- **Family Requests plan: free miles and home distance (2026-11-01).** Asked by the owner:
  "no charge under X miles", every mile charged at or over it; families may suggest their own
  meetup place only if they live at least X miles away, measured once per family from their
  City / state (application, contact, or asked on the status page) with Mapbox (D17 open).
- **Family Requests plan: every decision made (2026-11-01).** Asked by the owner: City / state
  is a locked, required application question while the home-distance rule is on (D17c); the
  rest follow the plan's recommendations (D3, D4b, D6, D8–D12, D15, D16, D17). Ready to build.
- **Review my waitlist: open questions decided (2026-11-01).** On the owner's word ("use your
  recommendations"): messages lead; "remind me in a few days" on open picks only snoozes.
  This session's app change (the preventatives loop) rides `kennelos-shell-v88`.
- **Family Requests step 1: the price list's groups, rules and plans (2026-11-01).** The
  Kennel page's Extra charges price list (`assets/priceListEditor.js`, new, precached) shows
  her extras in groups, each group with its rules (ages families can ask and cancel, when
  they're paid) and each extra with Details (group, description, families can ask, its own
  ages, boarding days, its own plan). `extraCharges.js`: the new price-list fields,
  `Kennel.extra_charge_groups` (private in `syncRegistry`), `PLAN_DUE`, `chargeRules`,
  `requestWindow`, `planProblem` / `planText`, `readPriceList` (merges by id, so Kels's form
  keeps the rest) and `readChargeGroups`. The Sale page's extra charge picker groups them.
  Sample data gains Photo packages and Training groups. Stored only for now; family requests
  use them from step 3. Rides `kennelos-shell-v88`. Checked in the browser at phone width.
- **Family Requests step 2: Getting your pup home (2026-11-01).** A new account type,
  Transport (flight nanny, ground). Shared transport accounts (`referralShare.sharedTransport`:
  name, link or website, notes) go in the waitlist projection as `kennel.transport`, separate
  from recommended products; the Worker (`familyPages.transportOf`) shows them only to a family
  with an open sale, as a Getting your pup home card on the status page. The account form's
  share hint and the card's badge follow the type. Tests in `tests/referralShare.test.js` and
  `cloud/tests/familyPages.test.js`; the card checked in the browser with a mocked response.
  Needs a Worker deploy for the status page.
- **Family Requests step 3: extras requests and payment plans (2026-11-01).** Families with an
  open sale see an Extras card on their status page: her message (Waitlist settings, default
  in the owner's words), See our extras and prices (her https page, new tab), and the extras
  she marked "families can ask" by name under her group headings, inside their age window,
  with Request, and Cancel on theirs while allowed. No price reaches the server
  (`data/familyExtras.js`, projection `entry.extras`, Worker `extrasOf` and
  `extra_request` / `extra_cancel` checks, alerts and digest as requests). Each request
  waits for her: a Today nudge and a Waiting for you row on the entry, Approve adds the
  charge at her price with its payment plan as dated steps (or removes it; refused while
  part is paid), then the request email. Payment steps: their own income parts, invoice
  lines with their own due dates, a Paid on date on the Sale page, an `extra-due` nudge 7
  days before. A charge picked from the price list on the Sale page gets its plan too.
  Tests: `tests/extraCharges.test.js`, an end-to-end one in `tests/cloudWaitlist.test.js`,
  `cloud/tests/familyActions.test.js`, `cloud/tests/familyPages.test.js`. Checked in the
  browser (status page card with a mocked response; approve on the entry page; steps and
  Paid on on the Sale page). Needs a Worker deploy; rides `kennelos-shell-v88`.
- **Family Requests step 4: training packages and boarding (2026-11-01).** A price-list
  extra's boarding days ride onto the sale's charge (approval, or picking it on the Sale
  page). Its stay is a boarding event on the pup, reason Training (added to the
  suggestions), linked by `details.sale_id` / `details.extra_charge_id`
  (`goHome.trainingStayEvent`, `trainingStaysFor`, `orphanTrainingStays`). Approving it on
  the waitlist entry offers Log the stay; approving its cancel offers Remove the stay; Today
  has `training-stay` (one-tap log) and `training-stay-orphan` (remove) for every other
  path. The event form keeps the link through an edit. `referenceRegistry` gains `scan`
  entries (an unindexed dotted path), used for the stay's `details.sale_id`, so a sale with
  a stay can't be hard-deleted. Tests in `tests/extraCharges.test.js`; the event-form edit
  checked in the browser. Rides `kennelos-shell-v88`.
- **Family Requests step 5: pickup places, times, own addresses, Mapbox (2026-11-01).** Her
  pickup places and transport fee settings (Kennel page, Pickup & transport); pickup times per
  litter (Litter page, `assets/pickupTimesPanel.js`, Pro); City / state locked and required on
  her form while a minimum home distance is set. Families with an open sale get a Pickup card:
  choose a time (from the ready date, or after a training stay), change or cancel until her
  cutoff, suggest their own address (when allowed), or say where they live (when asked).
  The Worker measures an address or home with Mapbox (`cloud/src/geo.js`, `MAPBOX_TOKEN`,
  `POST /geo/distance`), counts unapplied bookings against a time's room, and keeps her
  standard location server-only. Her device applies requests (`familyPickup.js`), measures
  homes once during sync, and approves: a time → the pickup event; an address → day, time,
  method, miles and the suggested fee (`transportFee.js`, working shown) → a drop-off and the
  sale's transport fee. Today nudges, the entry page's Pickup card and override, and the
  `transport_options` email (her Transport accounts, the miles). Privacy policy lists
  Mapbox. Tests: `tests/familyPickup.test.js`, an end-to-end test in
  `tests/cloudWaitlist.test.js` (Mapbox stubbed), `cloud/tests/familyActions.test.js`,
  `cloud/tests/familyPages.test.js`. Checked in the browser (status page card, Kennel card,
  Litter times, the approve form). Needs a Worker deploy and the `MAPBOX_TOKEN` secret.
- **Pickup date rules (2026-11-01).** Asked by the owner: each pickup date on a litter can
  require one of her extras (families see "Requires 10 week training" and can't choose that
  day's times until it's on their sale; the Worker refuses `needs_extra`) or apply her
  standard boarding (new `boarding_rate` setting; families see "Will result in boarding
  charges"; approving a time that day sets the sale's deferred boarding per day from when the
  pup could go home and logs the stay, both removed if they move to another date or cancel).
  `Litter.pickup_date_rules`, `pickupSlots.dateRules` / `standardBoarding`, `Sale.boarding_from_pickup`.
  Also: the event form now keeps a pickup's `pickup_slot_id` (and the boarding marker) through
  an edit. Tests extended; checked in the browser.
- **Pickup charges never overwrite hers (2026-11-01).** Asked by the owner: the pickup flow
  fills the sale's existing `transport_fee` and deferred boarding fields (there was no other
  boarding default; `boarding_rate` is the only one). The address approval form starts with
  the fee already on the sale ("On the sale now: $250.00") and offers **Use $588.00** for the
  suggestion; after a time or a cancel, a transport fee still on the sale is offered for
  removal; on a boarding date, a boarding charge she typed is kept and **Use standard
  boarding** is offered instead (Today says both in its message). `applyPickupBoarding`,
  `clearTransportFee`; the end-to-end test covers both.
- **Family Requests step 6: backing out (2026-11-01).** Families with an open sale can ask to
  back out from their status page (her reasons, "Something else", a note; her policy text
  first). Her Waitlist settings: reasons, deposit policy rows (reason × pup age → keep or
  move), the text. Today and the entry page show the request with her policy's suggestion;
  Keep / Move / More options (refund, typed REFUND) / Decline, each with a confirm that lists
  extras, stays and pickups ticked or kept (part-paid or Done extras kept, still owed) and a
  summary. Move reopens their entry at the end of the line with the deposit carried; keep and
  refund withdraw them; refund voids the sale ("Buyer backed out, refunded"). Kept extras
  keep their income on a released sale; the offer gets `backed_out_date` (cloud date field,
  `cloudFields.js` regenerated) and that litter counts as spent. New `data/backOut.js`; the
  Sale page's Done tick. Tests: `tests/backOut.test.js`, an end-to-end test in
  `tests/cloudWaitlist.test.js`, cloud action and page tests. Checked in the browser.
- **Backing out: one text for every family (2026-11-01).** Asked by the owner: families never
  see her deposit policy (they never did; now a test pins that it isn't published). They all
  read the same text she can edit, defaulting to the owner's wording (deposits are
  non-refundable; [Kennel Name] reviews the reason for backing out and reaches out if any of it can apply to a
  future litter), with [Kennel Name] filled in. The settings box starts with that text.
- **Backing out puts the pup back (2026-11-01).** Asked by the owner: the back-out confirm has
  "Put [pup] back to Available" (Health hold when their reason is the pup's health), ticked,
  so the pup can be offered to the next family, as the Sale page asks when a sale ends. All
  of this session's app changes ride `kennelos-shell-v88`.
- **Styled dialogs on the family pages, and the modal rules everywhere (2026-11-01).** Asked
  by the owner: the status page's six `window.confirm` prompts (choose a pup, ask for or
  cancel a pickup time, ask for or cancel an extra, back out) showed the bare browser box
  ("apply.kennelos.app says"). They now use `confirmDialog` (family `common.js` + `.modal`
  in `family.css`), shaped like the app's `confirmModal`: a title, a message, a primary and a
  cancel button; cancel, a backdrop tap and Escape all say no. The app had no native dialogs
  left; the audit found modals that ignored Escape (including `ui.js`'s own confirm, alert,
  prompt and select) and seven with no backdrop close. The rules are now written at the top
  of `ui.js`'s modal block, with one Escape handler there (Escape = a backdrop tap on the top
  overlay, unless its own handler already closed it, or it carries `data-no-dismiss`: the
  required kennel setup and `openModal({ dismissible: false })`). The seven now press their
  Cancel on a backdrop tap. Checked in the browser.
- **Open kennel settings from Settings (2026-11-01).** Asked by the owner: Settings → Your
  kennel has **Open kennel settings →**, straight to the kennel's Overview and Settings page,
  so it isn't reached only through People → Kennels. Not in Lite (no `kennel.html`).
- **Waitlist settings folded into groups (2026-11-01).** Asked by the owner: the card had
  grown to ~25 fields in one column. It's now six folded groups under the one Save (Fees &
  payment; Turns & offers; Passing & readiness; Public list & family pages; Messages to
  families; Backing out), closed at first, with the open ones kept open across Save. Same
  fields and ids, so saving is unchanged. New `.settings-group` style in `app.css`. Checked
  in the browser.
- **Review my waitlist plan brought up to date with family requests (2026-11-01).** Asked by
  the owner. Kels Roadmap §3.16 now covers every request that waits on her: extras asked
  for and cancelled (with the training stay to log or remove), pickup times and cancels
  (with the boarding and leftover transport fee follow-ups), own-address pickups (set up in
  the conversation, or the transport options email when far), and backing out as step 2's
  first part (keep / move / refund, the items that come off, the pup back, then offer the
  next family). Extras payments due join step 7. Three questions are left open there. Plan
  only; nothing built.
- **Review my waitlist: three questions decided (2026-11-01).** The owner took all three
  proposals: a back-out with no request takes the full back-out path; own-address pickups
  are set up in the conversation; extras payments due are in step 7.
- **"Where do you live?" no longer asked over and over (2026-11-01).** Found while checking
  the owner's report that the question never appeared (it shows only with the distance rule
  on, i.e. a "live at least N miles away" figure above 0 on Pickup & transport, for a signed-in
  family with an open sale and a pup, whose home wasn't measured from the application or
  contact). Traced end to end: it does ask, but an answer the server couldn't measure (no
  Mapbox key, or a place it can't find) left the distance unknown, so the page asked again
  at every update. `ask_home` now needs no `home_place` on file; with an unmeasured place the
  entry's Pickup card says the distance couldn't be measured and she chooses. Test in
  `tests/familyPickup.test.js`.
- **Own meetup place: a dropdown, in plain words (2026-11-01).** Asked by the owner: the
  entry's Pickup card had three buttons (Allow their own place / Listed places only / Follow
  my rule) that read unclearly. It's now one dropdown, **Can they suggest their own meetup
  place?**, showing only the choice in force: **Use my distance rule** (default) / **Let them
  suggest a place** / **Only my pickup times**, with a hint saying what it means for this
  family (under the rule: what the rule decides and why). Same `own_place_override` values.
  Checked in the browser.
- **A family's Timeline shows offers and requests (2026-11-01).** Asked by the owner: the
  entry's History timeline had only applied / approved / fee and status dates. It now adds
  each offer (offered, picked, deposit request sent, how it ended, backed out), a placement
  with no offer on this device ("Placed with [pup]", from the sale), and every status-page
  request with her decision (pause, litters, Companion link, answers, backing out, extras,
  pickups), newest first including within a day. Checked in the browser.
- **A family back on the list: each record its own pup, records linked, lost-pup history
  kept (2026-11-01).** Found by the owner: Ray had a placed record (offer, sale, a pickup
  request) and a re-applied one; signing in by email landed on the new one with no sign of
  the other, and both pages showed the first pup's Pickup, Extras and Need to back out
  (backing out from the new page, with Keep, would have withdrawn the new place). Now
  `familySale` takes the record's own pup (placed sale, else its open offer's pick, else an
  unclaimed open sale to the contact, given to one record), everywhere it's used (the
  projection, the event planner, approvals, measuring homes, the entry page). The projection
  publishes `since` and `pup` per record; the Worker adds `records` to each status page by
  the same email ("This page is about: Placed with Hazel", links to the others) and lets one
  sign-in act on any of them, on the page's own record. The entry page's status card says
  how many times the family has been on the list and links the others. A lost pup's restore
  keeps the offer's history (`restored_date`, `lost_dog_id`, `lost_picked_date`,
  `lost_accepted_date`, synced like the offer's other dates), so the Timeline shows the
  pick, the acceptance and going back in line. Tests: `tests/extraCharges.test.js`,
  `tests/waitlistLostPup.test.js`, an end-to-end test in `tests/cloudWaitlist.test.js`.
  Needs a Worker deploy. Checked in the browser.
- **Family records card reworded; parents on the turn card (2026-11-01).** Asked by the
  owner: the records card read like the app ("Placed with Hazel (since…)", "Everything you
  do here is for this one"). It's now "You have more than one waitlist record with
  [kennel]. Choose the one you want to see below.", one row per record (date, then the
  family's own words, Viewing or Switch), with wording the owner approved: Applied: waiting
  for [kennel] to review / Approved: application fee to pay / Waiting for my turn for a (new)
  puppy / On hold until [date] / **My turn to choose a puppy** / Chose [pup]: deposit to send
  / Chose [pup] / Brought [pup] home / Application not accepted / Left the waitlist / Backed
  out of [pup] / No longer on the waitlist / Application closed: fee not received. Each entry
  publishes `record` ({ state, until }) for it. Also asked: a family's turn now shows each
  litter's breed and parents with their titles, as Coming up does. Needs a Worker deploy.
  Checked in the browser.
- **Expected prices on a family's turn (2026-11-01).** Asked by the owner (for a breeder):
  a family holding a turn couldn't tell what a pup would cost. Each litter of a turn now
  shows her expected prices from the Litter page (males / females), and when any pup is
  planned for Full registration the pups are sectioned by registration with the surcharge
  shown ("+$1,000 males · +$1,500 females"), marked as her estimates. Her asking prices
  only, never a deposit or a sale's amount; on by default with a switch in Waitlist settings
  → Turns & offers (`turn_prices`). Published pups carry their intended registration.
  Needs a Worker deploy. Tests in `tests/waitlistProjection.test.js` and
  `cloud/tests/familyPages.test.js`. Checked in the browser.
- **Turn prices: deposits, totals only, her notice (2026-11-01).** Asked by the owner: each
  litter of a turn also shows the deposit for males and females; Full registration shows
  its total price only (no "+$1,000" surcharge split, and the surcharge isn't published);
  the note reads "Listed prices are intended base purchase price and may not include
  additional fees; all prices are subject to change prior to contract signing." Screenshots
  made from the real path (projection → statusView → status page).
- **Turn litters set apart (2026-11-01).** Asked by the owner: each litter of a turn is its
  own block with a line and space above it (`.turn-litter`); "The wait is over!" and each
  litter's name are a couple of points larger.
