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
- **Choosing a pup says it isn't final (2026-11-01).** Asked by the owner: the status page's
  "Choose [pup]?" dialog now reads "Your selection isn't final until [kennel] receives your
  deposit (of $N, her listed deposit for that pup's sex when shown). Deadline to send the
  deposit: [the offer's respond-by date, from her days to accept and pay, as the turn card
  shows it]." Checked in the browser.
- **Sending your deposit on the turn card (2026-11-01).** Asked by the owner: between a
  family's pick and her deposit request they were told to send a deposit with no amount
  or way to pay. Once they pick, the turn card shows just their pick (its price for its sex),
  "Your selection isn't final until [kennel] receives your deposit", and a Sending your
  deposit block: the deposit (on their sale, else her listed one), the deadline, her payment
  instructions (already on their page for the fee), and that she'll send the contract and
  invoice. Found while screenshotting: the picked pup dropped out of the card (it's no
  longer available), so the offer now carries `picked_pup`. Payment links still come only in
  her deposit request. Needs a Worker deploy. Checked in the browser.
- **Days she does business (2026-11-01).** Asked by the owner (a breeder closed on
  Saturdays): Waitlist settings → Turns & offers → Days you do business, all ticked by
  default. Decided by the owner: closed days are skipped when counting (Fri + 3 days with
  Saturday closed = Tuesday), for every deadline from her day counts: the deposit /
  respond-by (also when the server offers a turn), the application fee, "Ready now?", the
  pickup change cutoff, and extras plan steps after approval / before pickup. New
  `dateUtils.addOpenDays`, `waitlistRules.openDays`, `open_days` in the projection's kennel,
  `serverMoves.addOpenDays` (the fee reminder goes on the open day before). Dates already
  set keep theirs. The turn-prices setting's hint updated to match what it now shows.
  Needs a Worker deploy. Checked in the browser.
- **Closed dates (2026-11-01).** Asked by the owner: a blackout list of any dates she's
  closed, for any reason, under Days you do business (date picker, Add date, ✕ to remove).
  Deadlines skip them like a closed weekday, on her device and for turns the server offers
  (`closed_dates` in the projection's kennel). A date drops off by itself a week after it
  passes: on save, and `waitlistActions.tidyClosedDates` when the app loads. Tests:
  `tests/closedDates.test.js`, `tests/waitlistProjection.test.js`,
  `cloud/tests/serverMoves.test.js`. Needs a Worker deploy. Checked in the browser.
- **SW cache bumped to `kennelos-shell-v89` (2026-11-01).** All of this session's app
  changes ride it (styled family dialogs and the modal rules, Open kennel settings, folded
  Waitlist settings, the own-place dropdown, the entry Timeline, records per pup and their
  links, turn prices and deposits, Sending your deposit, open days and closed dates). The
  family pages and server changes need a Worker deploy.
- **Planned heats on Coming up (2026-11-01).** Asked by the owner: future-dated heat cycles
  show as coming up on the public list and family status pages, month and year only, with an
  "estimated around" disclaimer. A fourth `show_upcoming` stage, `planned_heats` (off by
  default, a Public list and a Family pages switch like the others). `plannedHeats` in
  `waitlistRules.js` (active breeding females of the kennel, event after today, once per dam
  per month); the projection publishes `expected_month` (`YYYY-MM`) and never the day;
  `projectionFor` now also reads `heat_cycle` events. The Worker passes `expected_month`
  through only as `YYYY-MM`, gives heats no waiting, and refuses a prepass on one. Family
  pages: "Upcoming heat · estimated around March 2027" under the dam's name, and "Heat dates
  are estimates: the month shown is approximate and can shift." under the list. Tests in
  `waitlistRules`, `waitlistProjection`, cloud `familyPages` and `familyActions`.
- **Public list: more under Wants, date added as a bubble (2026-11-01).** Asked by the owner.
  Copy the list as text drops "added <date>". Online, the Added column is gone; each row ends
  with an ⓘ whose bubble says "Added <date>" on hover, focus or tap (one document click
  listener in `common.js`; CSS in `family.css`). "Wants" adds, after the sex, only what a
  family narrowed (`publicWantsMore`, a row's `wants_more`): breed when the kennel has more
  than one, "Full registration" when their purposes rule out Limited (show, breeding),
  colors with color matching on, and listen-only parents ("Only from …" / "Not from …").
  Same in the copied text; the publish page's hint says so. The Worker keeps `wants_more`
  to 6 short strings. Tests in `waitlistForm`, `familyPages` (root and cloud). Needs a
  Worker deploy for the online list.
- **/ops: emails sent month to date, and the Mapbox key (2026-11-01).** Asked by the owner.
  Migration `0019_mail_counts` (month UTC, kind, sent, failed, first_at; counts only, not in
  the D1 export). Every Resend send now goes through `mail.resendSend`, which counts it by
  kind (code, family, digest, notice, test); a count never fails a send. /ops shows the
  month's total, failures and a row per kind, and from when counting began (nothing before
  `0019` was counted). Health has **Driving miles (Mapbox)**: off, working (a live geocode of
  Denver and one Matrix element to Boulder, no one's address) or not working with Mapbox's
  HTTP status and message and what to do. Tests in cloud `mail` and `ops-sections`.
- **Public list tightened (2026-11-01).** Asked by the owner: the list's card has less padding
  (6px 10px) and the number column sits close to the name, sized to fit "#999" in bold on one
  line (checked at 320px and 390px wide: no wrap, no spill, no sideways scroll).
- **CSV import guide fits a phone (2026-11-01).** Asked by the owner: the "What should my file
  look like?" table no longer scrolls sideways. Column names wrap after underscores; the
  "Required for new records" pill is "New records" (the key under the table explains it);
  the header reads Need. At 640px and under, each column is one block: name and pill on one
  line, what goes in it full width below (`table.ih-cols` in `app.css`).
- **CSV import guide tightened (2026-11-01).** Asked by the owner: on a phone, table.data's own
  cell padding was doubling each block's; those cells now have none, and each block is 6px
  8px with the description right under the name (about a third shorter overall).
- **Family pages: less space outside the cards on phones (2026-11-01).** Asked by the owner: at
  520px and under, the page's side margin is 8px (was 16px) and cards are 10px apart (was 14px).
- **Logging completed health tests (2026-11-01).** Asked by the owner. New pure
  `data/healthTestLog.js` (test type from past use or the name, the event, a dog's unlogged
  planned tests via `testGapRows`). Dog page: each unlogged planned test has **Log result**,
  opening the event form with the type, today, title and name field filled in; saved, the
  row leaves the card. Kels: **Log health test results** (`assets/healthTestsUI.js`, all
  editions): dog → planned test or another → test, kind, date, result, lab (Genetic only),
  saved at once; ticks the plan. Both new files precached. Tests:
  `tests/healthTestLog.test.js`; both checked in the browser on the sample data. Seen while
  checking: the Dog page throws a Dexie `SchemaError` on load with the sample data, before
  this change too (not looked into).
- **SW cache bumped to `kennelos-shell-v90` (2026-11-01).** This session's app changes ride it:
  planned heats on Coming up (the projection side), the public list's narrowed Wants and
  copied text, the CSV import guide on phones, and logging completed health tests (Log
  result on planned tests, Kels's Log health test results). The family pages and /ops
  changes need a Worker deploy, then Apply pending (`0017`, `0019`) on /ops.
- **Planned tests also match on the event title (2026-11-01).** A planned test left Planned
  only when its name was in the type's name field (OFA: Method + Joint), so a hand-added
  "OFA Patella" result with Joint "Patella" stayed Planned. New `eventRepo.testMatchTokensOf`
  (name tokens + title) drives the Dog page's Planned Tests card, Health-Testing Gaps and
  Kels's Log health test results; the test vocabulary still reads `testTokensOf`. No new
  files. Tests: `tests/eventRepo.test.js`, `tests/healthTestLog.test.js`.
- **Puppy Record prints parents' OFA / PennHIP results (2026-11-01).** The sire/dam test line
  took only Genetic and Breed-specific results; it now takes OFA / PennHIP too (rating), named
  by the test's name field (OFA: Method + Joint) else the title. The field is now labelled
  **Health test results** (key `parentTests` unchanged, so saved picks keep). Checked in the
  browser on the sample data (Juniper's OFA Hips prints).
- **Parents' health tests on waitlist family pages (2026-11-01, draft).** New Waitlist setting
  `waitlist_config.parent_tests` (default off; Waitlist settings → Public list & family
  pages, offered with the list online): every parent the family pages show (Coming up, a
  planned heat's dam, Available Puppies, whelp notes, a turn's litters) carries `tests`
  (`[{ name, result }]`), folded under the parents line as **Health testing**. Per-dog
  override `Dog.waitlist_tests` (`PARENT_TESTS_ONLINE`: Always show / Never show; null =
  follow), on the Dog page's Health-Test Summary card as **On family pages**. New pure
  `healthTestLog.completedTestsByDog` (latest result per test name; OFA named Method + Joint;
  never lab, notes or dates); the projection reads it through `showsParentTests`;
  `cloudWaitlist` now also loads the three test event types. Worker: `familyPages.parentOf`
  copies `tests` by name (80 characters, at most 20); `common.parentTestsHtml` + a few lines
  of `family.css`. `waitlist_tests` classified `cloud` (a display choice the publishing
  device must see); `cloudFields.js` regenerated. Waitlist Spec §8.1 gets a Modified row
  (results readable on the server, public with the public list). No new files. Tests:
  `tests/healthTestLog.test.js`, `tests/waitlistProjection.test.js`,
  `tests/familyPages.test.js`, `cloud/tests/familyPages.test.js`. Needs a Worker deploy for
  the family pages to show them.
- **Health test events get a Normal / abnormal flag; family pages can show Normal only
  (2026-11-01, draft).** Genetic, OFA / PennHIP and Breed-specific events carry an optional
  **Normal or abnormal** select (`details.outcome`, `vocab.TEST_OUTCOME`, stored as the label)
  beside her own result wording; offered in the event form and Kels's Log health test
  results (`testEvent` takes `outcome`); a cloud details key like `result` (`cloudFields.js`
  regenerated). The parents' health tests setting became three levels
  (`PARENT_TESTS_SHOWN`: Don't show / Normal results only / All results; `parent_tests`
  default `'off'`), and `Dog.waitlist_tests` takes the same values (null = follow).
  Normal only = the latest result per test marked Normal; unmarked results aren't shown;
  the flag isn't published. Replaces the draft's checkbox and Always / Never show (never
  shipped). Tests: `tests/healthTestLog.test.js`, `tests/waitlistProjection.test.js`.
- **Suggestions for test results (2026-11-01).** Genetic / Breed-specific `result` and OFA
  `rating` are now comboboxes: `vocab.TEST_RESULT_SUGGESTIONS` (Clear, Carrier, Affected,
  N/N, Grade 1–4, Grade I–VI) followed by every result she's already typed on any of the
  three types (new `eventRepo.getTestResultValues`, pooled; `healthTestLog.
  testResultSuggestions` merges, deduped any case). The event form now merges a combobox's
  logged values for these fields with its options; Kels's Log health test results gets the
  same list. Free text, nothing enforced. Test: `tests/healthTestLog.test.js`. Screenshots
  checked at phone width on the sample data.
- **Check in on my dogs: health test results and any other events; own dogs only
  (2026-11-01).** Owner decision: Kels logs other events only inside this check-in, not as a
  separate Add new events task (Kels Roadmap §3.10 / §3.7 Modified). Two new last steps:
  "Do you need to log any new health test results?" runs Log health test results' own loop
  (`healthTestsUI.logHealthTests`, now exported, with an `only` dog filter), and "Any other
  events that need logging?" (a kind from `dogCare.otherEventTypes`, everything but the
  check-in's own types and `acquisition` / `placement`; one form with the type's fields,
  date / end, a cost per dog as linked expenses, and the dogs). Shared rather than copied:
  `dogCare.dogEvents` builds one event per dog (the litter check-in's `careEvents` now calls
  it), and `litterCheckinUI.eventFieldInput` (was `careInput`; combobox options now
  suggested, select defaults honoured) renders a type's fields in both. The whole check-in
  now loads only her own dogs (`dogCare.ownDogs`: owned / co-owned, not archived, deceased or
  pedigree-only): heats are her own active breeding females, preventatives her own active
  breeding dogs only (the form no longer adds her other dogs at home), and the two new steps
  list `checkinDogs` (her own dogs, puppies only when Keeping). Today's nudges and reports
  keep `breedingDogs` on every dog. Kels menu card's subtitle and keywords updated. Tests:
  `tests/dogCare.test.js`. Driven end to end in the browser on the sample data (lists
  checked against each dog's ownership and status; a vet visit for two dogs with $85 saved
  two events and two veterinary expenses).
- **All dogs ordered by status, sex, name (2026-11-01).** The Dogs page's All dogs list had
  no default order; it now uses `vocab.dogListOrder`: status in `DOG_STATUS` order (Puppy,
  Active breeding, Retired breeding, Pet home, For Sale, Deceased, External reference), then
  Male / Female / Unknown, then name A→Z (call name, else registered name), anything
  missing last at its level so no dog drops off. The Status and Sex columns now sort in
  vocab order too (were alphabetical by stored value). Other tabs unchanged. Test:
  `tests/vocab.test.js`; checked in the browser on the sample data.
- **Check in on my dogs leaves out Pet home dogs (2026-11-01).** Owner decision: the health
  test and "any other events" steps' list (`dogCare.checkinDogs`) no longer includes dogs
  with status Pet home. Test: `tests/dogCare.test.js`.
- **One rule for the dogs she looks after (2026-11-01).** Owner decision: new
  `dogCare.isCareDog` = owned, co-owned, leased in or leased out, and never External, an
  External reference, Deceased or Pet home dog, archived or pedigree-only. `breedingDogs` and
  `homeDogs` now read it, so Today's heat and preventative reminders, the Dogs page's Log for
  several dogs, Log health test results' "at home" list and Check in on my dogs agree; the
  Heat Cycles report lists only these females. Check in on my dogs now includes leased-in /
  leased-out dogs (`ownDogs` = `isCareDog`; `checkinDogs` adds kept puppies). Tests:
  `tests/dogCare.test.js` (fixtures now carry an ownership).
- **Health test results take the certificate (2026-11-01).** Asked by the owner. Log health
  test results' form (and so Check in on my dogs' health-test step) has **Certificate or
  report (optional)** with Documents (Pro): a PDF or photos, filed on the dog as a Health
  test document titled and dated as the test, with its lab and result. The file picker is
  now one shared piece, `kelsSteps.filePicker` / `wireFilePicker`, which Add dogs' document
  form uses too (its own copy removed). `documentModal.js` stays Pro-only, loaded only when
  a file is picked. Checked in the browser on the sample data (a PDF on Juniper's OFA Elbows
  filed one document and one event); Lite's `documents: false` hides the field.
- **Vet summary document type (2026-11-01).** Asked by the owner. `DOC_TYPES` gains
  `vet_summary` (Vet summary, 🏥; field: Registry / vet / lab), offered wherever a document
  type is picked (Documents, Add dogs, Furever uploads). It stays out of cloud backup for
  now (`CLOUD_DOC_TYPES` unchanged, like Contract and Other): a privacy call left to the
  owner. No new files.
- **Check in on my dogs: a vet visits step with the vet summary; Vet summary to the cloud
  (2026-11-01).** Owner decisions. Before "Any other events", "Any vet visits to log?" uses
  the same event form for a `vet_visit` plus (Documents, Pro) **Vet summary (optional)**:
  filed on each ticked dog as a `vet_summary` document, its own copy of the file (a
  document's delete removes its file), titled and dated as the visit, the vet as issuer.
  `vet_visit` joins `dogCare.CHECKIN_OWN_TYPES`, so "Any other events" no longer offers it.
  `vet_summary` joins `syncRegistry.CLOUD_DOC_TYPES` (backed up like Health test). Kels menu
  card updated. Tests: `tests/dogCare.test.js`. Browser: a visit for two dogs with a PDF and
  $120 filed two vet summaries (separate files) beside the events and expenses.
- **Kels: Review my waitlist (2026-11-01).** Roadmap §3.16, all of it (owner's choice over an
  applicants-only slice). New `assets/waitlistReviewUI.js` (Pro, `proPages.js`) and shared
  `data/waitlistReview.js` (`readNudgeKey`, `STEP_OF`, `REVIEW_STEPS`, `reviewSummary`,
  `readinessProblems`, `outcomeReport`); both precached. Opens by checking the list is set up,
  online and publishing, and her own form takes applications online, handing her to Set up
  my waitlist / Set up my application form with buttons (asked by the owner), or Keep going.
  Then "Here's what's waiting on you" and the eight steps (requests and messages; backing out
  and any sale to cancel or void; offers past their deadline; picks to open; a turn to offer;
  new applications; fees and extras payments due; "Ready now?" and removals), each item with
  Skip for now, each step rechecked as it comes. Shared rather than copied: the items are
  Today's waitlist nudges (`nudges.waitlistNudgeItems`, `extraDueItems`); Today's
  overdue-offer report now comes from `outcomeReport`; the Sale page's Paid on box and Kels's
  Paid share `extraCharges.stepWithPaidDate` / `chargesWithStepPaid`; the family page's
  dialogs are reused (communicate, pick, deposit, sale prompts, restore). Added:
  `waitlistActions.previewNextTurn`, `extendTurn`, `approveBackOut({ told })`, and
  `nudgeState.snooze` / `snoozedUntil` (Today honours a snooze). Kels menu: "Review my
  waitlist", priority 58 while anything waits. Tests: `tests/waitlistReview.test.js`. Driven
  in the browser on the sample data plus seeded requests: readiness (not online), message
  (Write back, Mark read), pause approved, a pass then the freed turn offered, more time,
  open picks (joined the open turn) and snooze, an application approved then its fee
  received, a back-out kept with the pup back, a sale voided (pup died). Not driven in the
  browser: extra and pickup requests, own-address set-up, "Ready now?"/removals, extras due,
  the pick/deposit dialogs.
- **SW cache bumped to `kennelos-shell-v91` (2026-11-01).** This session's app changes ride it:
  parents' health tests on family pages (setting, per-dog override, Normal/abnormal flag on
  test events, result suggestions), Check in on my dogs' new steps (health test results with
  the certificate, vet visits with the vet summary, any other events) and its one rule for
  the dogs she looks after, the Vet summary document type (backed up), All dogs ordered by
  status / sex / name, and Kels's Review my waitlist (two new precached files). The family
  pages' health tests need a Worker deploy.
- **Driving miles fixed: Directions API, not Matrix (2026-11-01).** /ops showed "Driving
  miles (Mapbox): not working (HTTP 422: … only 1 matrix element; minimum number of matrix
  elements is 2)". The Matrix API refuses a request for a single distance, and both
  `geo.drivingDistance` (her Get driving miles, a family's own address) and the /ops check
  asked for exactly one. Both now ask Mapbox's Directions API for one route
  (`routes[0].distance` / `duration`), same token. Tests' Mapbox stubs updated
  (`cloud/tests/familyActions`, `ops-sections`, `tests/cloudWaitlist`). Needs a Worker deploy.
- **Planned tests for kept pups, and for every new dog (2026-11-01).** Marking a pup Keeping
  now offers her kennel's planned tests for its breed that it doesn't have yet (new
  `assets/keeperTests.js`, precached): a modal on the Dog page save, Add Puppies, the Sale
  page's disposition prompt and a pup brought back as a puppy; a chat question in Kels's
  Prep pups and litter check-in plans and at the end of Record a litter. New dogs are now
  seeded with the kennel's planned tests on every path, not just the Dog page and Kels's Add
  dogs: CSV dog import, Tidy up's missing parent, Record a litter's new parent
  (`kennelRepo.seedTestsFor` / `withSeededTests` / `testsToPlan`). Tests:
  `tests/keeperTests.test.js`. Driven in the browser: Fern (sample data) set to Keeping on
  the Dog page, the prompt listed her seven Boston Terrier tests, Add the tests saved them.
  Not driven in the browser: the Kels and Litter page prompts.
- **Credits for funds already received (2026-11-01).** A breeder who used to collect small
  deposits before litters were born (and now collects a larger deposit around four weeks)
  needed those early payments to count as part of a family's deposit, not all of it. Each
  waitlist entry can hold credits (`received_credits`: amount, date, method, note, and what
  it can pay toward: application fee, deposit, rest of the purchase price, extras/transport/
  boarding, all ticked by default). New `data/receivedCredits.js` (precached) works out,
  every time, how the credits are used: oldest first, fee → deposit → price → extras. Taken
  off on the family's status page (fee and deposit; needs a Worker deploy for the page), the
  invoice/receipt generator and default documents ("already collected" prefilled), payment
  requests, contract balance due, the Companion balance and Financials (credited part
  earned on the credit's date). Entry page Credits card; Fee received records the credit's
  share (`fee_credit_amount`); pick/deposit dialogs say what it covers; lost-pup and
  back-out carry-overs leave the credit on the entry. Both new fields private in
  `syncRegistry`. Tests: `tests/receivedCredits.test.js`. Driven in the browser on the
  sample data: the Credits card, the fee covered in full and in part, the family projection's
  `fee_due`, a $200 credit on a $500 deposit (invoice: $200 already collected; ledger: $200
  earned + $300 anticipated; balance due). Not driven: the family status page itself (server
  render), the invoice generator modal, payment requests, the Kels paths.
- **SW cache bumped to `kennelos-shell-v92` (2026-11-01).** This session's app changes ride
  it: the Keeping prompt for planned tests and planned-test seeding on every way a dog is
  added (new `assets/keeperTests.js`), and credits for funds already received (new
  `data/receivedCredits.js`). The family status page's credit lines need a Worker deploy.
- **Credits on receipts (2026-11-01).** Receipts used to fold a credit into "already
  collected" and just print the line smaller. A cfg line now carries `credit` (the credit's
  share of `collected`; the generator and the default document set it), printed as **Less
  credit for funds already received** in the totals: a receipt shows the line whole,
  Subtotal, the credit, then Total paid; an invoice shows it apart from any other amount
  already collected. Old links without `credit` print as before. Checked in the browser: a
  deposit receipt ($500 − $200 credit = $300 paid), an application fee receipt ($300 −
  $100 = $200) and the invoice. Rides `kennelos-shell-v92`.
- **Application fee credited toward the deposit (2026-11-01).** New waitlist setting
  `fee_credit_toward` (Waitlist settings → Fees & payment, and Kels's fee step): a fee
  credited to the purchase price counts toward the remaining balance (default, as before)
  or the deposit (families send the deposit less their fee; any of the fee beyond the deposit
  comes off the balance). The fee credit is now `{ amount, toward }` (`incomeView.feeCreditOf`
  / `feeCreditSplit`), and it applies from the family's pick (deposit pending), not only once
  they're placed, so it comes off the deposit before it's paid (balance mode now nets the
  balance from the pick too). Follows through invoices (line label), the deposit dialog, the
  family's deposit block and fee card (`deposit_fee_credit`, `credit_toward`; needs a Worker
  deploy), the Companion balance, and the received-credits allocation. Checked in the
  browser: $500 deposit, $300 fee toward it and a $200 credit → nothing more to send on the
  invoice, the deposit dialog and the family page. Rides `kennelos-shell-v92`.
- **Kels: the new settings in the waitlist flows, and pickup and transport set-up
  (2026-11-01).** Set up my waitlist gets a **Pickup and transport** screen (new
  `assets/pickupTransportStep.js`, Pro-only, precached): standard pickup location, fee per
  mile, one way / round trip, no charge under, how far a family must live to suggest their
  own meetup place, the "you'll be in touch" distance, pickup changes, boarding rate, then a
  worked example. It's in the walk-through (after offers) and the change menu, and Kels's
  summary gains a pickup/transport line (`waitlistRules.transportSummary`). Review my
  waitlist offers it when a meetup request comes in with no standard location or rate. The
  fee step asks where a credited fee counts. The applicant step (Add people, Set up my
  waitlist's Add one by hand) takes **Money they've already paid you** as a credit, and Add
  people's fee question uses it (covered in full → on the list from the credit's date). The
  waitlist CSV import gains `already_paid` / `already_paid_date`. Tests: CSV, summary line.
  Driven in the browser: the transport screen saved and its example, the applicant form's
  new box. Not driven: Add people's covered-fee question, Review my waitlist's offer.
  Rides `kennelos-shell-v92`.
- **A carried-over deposit is paid at the pick; Send and the invoice stop asking for a paid
  deposit (2026-11-01).** Reported: a family carrying $500 from a lost pup picked again, and
  Review sale & send asked for the $500 "due by" their deadline while the invoice showed it
  due Immediately with the full balance. `recordPick` now gives a family with
  `carried_payment` a deposit-paid sale and goes on to `confirmDeposit` (new `paidDate`:
  `deposit_date` is when they paid it; the turn ends on the pick date), returning
  `depositDone: true`; `recordOutcome('accepted')` and the family's own pick online go the
  same way, and the pick dialog drops its "deposit is already in" box for them. The family
  page then offers **Send contract & invoice** (also a button on a placed family's pick still
  at deposit paid and not yet sent); for a pick already pending with a carried deposit, the
  send first offers to mark it received. `depositRequestMessage` gains `depositPaid` (a
  thank-you, no due date, no payment or Stripe link). Invoices: a sale's paid lines print
  "Paid" and start as collected in full (default and Financials generator), so the balance
  nets them out. Tests: carried pick through both paths, the paid message, the paid invoice;
  `waitlistLostPup` updated for the one-step placement. Smoke-loaded the family and invoice
  pages; the dialogs weren't driven in the browser. No new files; no cache bump yet.
- **Photos links on waitlist pages, in emails, and on litters (2026-11-02).** Her request:
  photo links wherever a dog shows on the waitlist pages, parents' photos on current and
  upcoming litters, a litter-wide photos link, and every email to a family with a sale
  carrying their pup's link. Decided with her: a dog's link is published only when she ticks
  the new **Dog.photos_online** (Dog form, with the waitlist; cloud), then on the public list
  and family pages; a litter's new **Litter.photos_url** (cloud) is published when set
  (Litter page edit + view, a Photos column in Litters, Kels's Add a litter extras step);
  emails get the line automatically whenever the pup has a link. Projection
  (`photoLink`, `dogPhotosLink`, `publicPup`, `parentView`, litter views, Coming up),
  Worker (`familyPages.photosOf` on parents, litter cards, Coming up, a turn's litter and
  pups), pages (`common.photosLink`; links only, the CSP allows no outside images).
  Emails: `waitlistOutbox.salePupPhotos` + `draftEmail`'s `pupPhotos` (also "almost your
  turn" and the deposit request). `listView` rows no longer open when a link inside is
  clicked. Waitlist Spec §8.1 gains the row. Tests: projection gating, Worker pass-through,
  page links and escaping, email line and its cut, the sale lookup. Checked in the browser:
  the Litters column, the Litter page row, the Dog page badge; the family pages and emails
  weren't driven live. Needs a Worker deploy for the family pages. No new files; no cache
  bump yet.
- **Available Puppies names the pups, in Males / Females columns (2026-11-02).** At her
  request (reversing 2026-10-10's counts-only rule), the public list and status pages'
  Available Puppies show each litter's available pups by call name: Males left, Females
  right, the label once above each, a name its photos link where she shows one, instead of
  "1 male remaining". Worker `litterCard` gains `pups` (`cardPups`: name, sex, photos link,
  by name); page `common.pupColumnsHtml` (+ `.pup-cols` CSS). A turn's pick buttons are
  unchanged. Waitlist Spec §8.1 and the Available Puppies note marked Modified. Tests:
  Worker shapes, the columns and escaping. Rendered at phone width. Needs a Worker deploy.
- **Public list: Available Puppies and Coming up centered (2026-11-02).** Her request: the
  text in those cards centered as on a family's status page (`family.css`
  `#available, #upcoming`, summary marker inside). Rendered at phone width. Needs a Worker
  deploy.
- **Parents' registered name, pedigree and health testing in an info popup (2026-11-02).**
  Her request: every parent's registered name where recorded; its own sire's and dam's
  registered names behind a new setting (`waitlist_config.parent_pedigree`, off by default,
  Waitlist settings beside the health-test one); all three behind an ⓘ by the call name,
  shown only when one of them exists, opening a popup in her order (Registered name,
  Pedigree, Health testing). The inline "Health testing" fold is gone
  (`parentTestsHtml` removed). Projection `parentView` / `parentPedigree`, Worker
  `parentOf` (`regOf`, `pedigreeOf`), pages `dogInfo` / `infoBubble` / `dogInfoDialog`.
  Waitlist Spec §8.1 row added (modifies Q32). Tests: projection, Worker, bubble and popup
  (escaping, order, no bubble without data). Rendered and opened/closed in the browser at
  phone width. Needs a Worker deploy.
- **Fix: every Dog page threw a console error ("r") (2026-11-02).** The reference registry
  listed `waitlist_offers.lost_dog_id` (lost-pup history) without `scan: true`, but the field
  isn't indexed, so the Dog page's reference check (and a dog's hard delete) hit a Dexie
  `SchemaError` (minified to "r"). Marked it a scan. New test: every registry entry is
  indexed in `db.js`, a scan, or on a compound index. Checked: the Dog page loads with no
  error. Also confirmed every photos link opens in a new tab (family pages, Litters,
  Litter, Dog, Companion).
- **SW cache bumped to `kennelos-shell-v93` (2026-11-02)** for this session's batch: the
  carried-deposit fixes (pick, Send, invoice), photos links (Dog.photos_online,
  Litter.photos_url, emails), and the Dog page fix. The family-page changes (photos links,
  Available Puppies names in columns, centered cards, the parent info bubble) ship with the
  Worker deploy.
- **Fix: pedigree-only dogs missing from the parent popup (2026-11-02).** `projectionFor`
  read dogs through `dogRepo.getAll()`, which leaves pedigree-only dogs out, so a parent's
  sire and dam recorded only for its pedigree never showed (and a pedigree-only litter parent
  read "Unknown"). They now go in as `ancestors`, looked up by id only; a dog with no call
  name goes by its registered name. Test added. Merged after the v93 bump; ships in
  `kennelos-shell-v94`.
- **The waitlist feed for KennelPort websites (2026-11-02).** KennelPort plan decision 21:
  a KennelPort site draws the public list in its own style. New `waitlist_config.website_feed`
  (off by default), switched on the Online list card ("Let my KennelPort website show my
  list in its own style") and in Set up my waitlist's Your website group; the projection
  carries `kennel.website_feed` only while it's on. The Worker serves
  `GET /f/site/<public_id>` (`familyPages.siteView`): the public list exactly, plus paths
  for the list, sign-in and form; 404 `not_shared` when off; cached five minutes; its own
  per-address read bucket; no CORS. The Online list card shows the feed address to copy
  (`cloudConfig.websiteFeedLink`) once published. No new fields leave her device; no
  migration. Tests: default, projection, link, the route on and off. Needs a Worker
  deploy. Not driven in the browser.
- **Dog: additional registrations (2026-11-02).** A dog registered with more than one
  registry (AKC and UKC, CKC…) had room for one. New plain field
  `Dog.additional_registrations[]` (`{ registry, registration_number, registered_name }`; no
  schema block; old backups read fine without it), normalized by
  `dogRepo.normalizeRegistrations`. The Dog form edits it as rows under Registration # (+ Add
  registration / Remove); the view shows Other registrations. Classified **cloud** in
  `syncRegistry` (same kind of data as `registry`/`registration_number`, already cloud);
  `cloudFields.js` regenerated. Search: `dogSearch.dogRegistrationNumbers` feeds Find and
  Kels's dog matching. Merge keeps every registration either dog held. Sample Juniper
  carries a UKC number. Tests: `tests/dogRegistrations.test.js`. Checked in the browser
  (demo view; add/remove rows on the form, phone width).
- **One rule for "the same dog?" everywhere (2026-11-02).** New identity helpers in
  `dogSearch.js` (`dogRegKeys`, `dogNameKeys`, `dogRegisteredNames`, `sameRegistration`,
  `sameRegisteredName`, `registrationsConflict`) over every number and registered name a dog
  holds, additional registrations included. Used by the duplicate scan (buckets and the
  shared-details line), the tidy-up's duplicate dogs, backup restore matching
  (`MATCH_RULES.dogs`, `dogNever`), the CSV import's dog index, the pedigree import, Kels's
  dog matching and Find. Numbers now rule a pair out only when they could be the same
  registry's (same registry, or one not given): an AKC number on one and a UKC number on the
  other no longer do. Registered names compare by `dogSearch.nameKey` everywhere (the tidy-up
  used `normName`, the pedigree import its own titles-off key). Tests added (shared rules,
  tidy-up, scan, restore, Kels, CSV, pedigree).
- **SW cache bumped to `kennelos-shell-v94` (2026-11-02)** for this session's batch: Dog
  additional registrations (form, view, search, merge, cloud backup) and uniform dog matching
  over every registration and registered name (duplicate scan, tidy-up, restore, CSV and
  pedigree import, Kels, Find). Also carries the two app changes merged after v93: the
  pedigree-only parents fix in the waitlist projection (PR #145/#146) and the KennelPort
  website feed's app side (Online list and Set up my waitlist switch, `websiteFeedLink`;
  PR #147). No new app files; `PRECACHE_URLS` unchanged.
- **Owner contact repair (2026-11-02).** A breeder whose owner contact was deleted, who then
  made a new contact and linked it to her kennel, still had none on invoices: only the setup
  wizard writes `myContactId`, and the wizard, finding the stored id dead, created a
  duplicate instead of matching by name. Added `kennelSetup.resolveMyContactId()` (mirrors
  `resolveMyKennelId`: adopts the sole live contact linked to her kennel when the setting is
  missing, deleted or archived); invoices/receipts, Furever, Kels's Add dogs and the wizard
  prefill read through it, and the nav banner runs it on every page. The wizard now falls
  back to the name match whenever the stored contact isn't live. Tests added
  (`kennelSetupRepair.test.js`). No new files; `PRECACHE_URLS` unchanged.
- **SW cache bumped to `kennelos-shell-v95` (2026-11-02)** for the owner contact repair
  (`resolveMyContactId`, wizard no longer duplicates a deleted owner contact). No new app
  files; `PRECACHE_URLS` unchanged.
- **Her application form on her KennelPort website (2026-11-02).** KennelPort plan 3.8: the
  website feed (`/f/site`) carries her form while she takes applications online
  (`formView`'s form, `FORM_CHOICES` for the preference questions, `turnstile_site_key`), so
  her website draws it in its own style. Answers are sealed in the visitor's browser to her
  form key and sent straight to `/f/apply`, then `/f/verify`; those and `/f/code` now answer
  `https://<label>.kennelport.com` (and KennelPort staging) cross-origin
  (`lib/cors.js` `WEBSITE_PATHS`, `websiteCors`, `websitePreflight`); every other route is
  unchanged. Setup: add `kennelport.com` to the Turnstile widget's hostnames. Server only:
  no app files, no SW bump. Tests added (`cloud/tests/application.test.js`).
- **No status link for her website (2026-11-02).** `/f/verify` asked from a KennelPort site
  (`isWebsiteOrigin`) confirms the application and returns `{ confirmed, signin }` only: no
  status token, and no family session is made. Her own pages get what they always did.
  Tests added.
- **Undecided pups aren't for sale (2026-11-02).** KennelPort plan decision 10:
  `waitlistRules.isPupAvailable` now offers only an `available` pup; unset reads as
  `undecided` and, like Undecided, Keeping, Placed and Health hold, is held back. So the
  waitlist, its public list's Available Puppies, turn prices and the reports agree with the
  website. Companion already listed only Available pups. Kels's Tidy up asks about an
  `owned` pup with no disposition and no sale going ahead (`tidyRules.pupNoPlanFindings`,
  kind `pup-no-plan`): Available, Keeping or Still deciding. Test fixtures that relied on
  unset pups being offered now mark them Available; two cloud waitlist tests that shared
  the seed's families now clear the family's earlier passes and lines first. Waitlist Spec
  and End-State guide (§29 Available pup, §33 Tidy up) updated. No new files;
  `PRECACHE_URLS` unchanged.
- **SW cache bumped to `kennelos-shell-v96` (2026-11-02)** for Undecided pups not being
  offered and Tidy up's pups with no plan. No new app files; `PRECACHE_URLS` unchanged.
- **Her KennelPort website: Connect website and Update website (2026-11-03).** KennelPort
  plan 5.5, the KennelOS side of its phase 4. The four marks (`Dog.show_on_website`,
  `Dog.heats_online`, `Pairing.show_on_website`, `Litter.show_on_website`; cloud, classified
  in `syncRegistry.js`, `cloudFields.js` regenerated) on the Dog, Pairing and Litter forms.
  New: `data/siteExport.js` (the allow-listed bundle, format 1; checked against KennelPort's
  `cleanBundle`), `data/kennelportApi.js` (the only module that talks to KennelPort),
  `data/kennelportLinkStore.js` (the token in `device_secrets`), `data/kennelportLink.js`
  (connect, update, disconnect; the license check; filling `dog.url`, `photos_url`, the
  kennel's `website`, `extras_info_url`, `website_feed`, `embed_origins`),
  `assets/websiteCard.js` (Settings → Your website) and `assets/websiteUpdateUI.js` (Kels's
  Update my website). `kennelportUrl` / `devKennelportUrl` and `editionFlags.websiteLink` in
  all four `editionConfig.js` (Pro on; Lite and Demo off and null). Prompts: Active breeding
  → show on website; leaving Expected with no deposits date; Sold or Closed → off the
  website, with kept pups offered their own page. `completedTestsByDog` now carries each
  result's `date`. `PRECACHE_URLS` gets the six files (the two `assets/` ones Pro-only in
  `proPages.js`). Tests: `tests/siteExport.test.js`. SW cache not bumped yet.
  Not built: the custom-domain origin in `cloud/src/lib/cors.js` (the cloud has no record of
  her domain yet), Kels's Record a new litter asking about the website (its litter follows
  the pairing's mark), and the deposit's How to pay (KennelOS has no deposit instructions).
- **The kennel record's website, asked (2026-11-03).** When the kennel record already has a
  website she typed (her own homepage), connecting no longer leaves it unmentioned: the
  Your website card, and Kels after Update my website, offer the KennelPort address in its
  place (Use / Keep mine; `kennelportLink.websiteOffer`, `useSiteAsKennelWebsite`,
  `keepKennelWebsite`). Keep mine is kept on this device per site address
  (`kept_website` on the link row), so moving to her own domain asks again. Tests added.
- **Breeders' own domains for her application form (2026-11-03).** `lib/cors.js`
  `isWebsiteOrigin` also takes the origins in the `WEBSITE_ORIGINS` setting (comma-separated,
  kept by hand in `cloud/wrangler.toml`, like KennelPort's own custom domains; the owner
  expects about a dozen breeders). Production lists `https://www.akbostonterriers.com`. Each
  needs its bare domain in the Turnstile widget's hostnames too (KennelPort Setup, Custom
  domains, step C). Server only. Tests added (`cloud/tests/application.test.js`).
- **Recommended products on her website from her Accounts (2026-11-03).** KennelPort's new
  Recommended products page fills from Accounts she marks **Show on website**
  (`Account.show_on_website`, cloud; the Accounts form beside Share with families, Pro with
  a KennelPort address; a **Shown on website** badge). `siteExport.websiteProducts`: name,
  referral link (else website), code, and the instructions when they fit KennelPort's
  120-character note; never logins, notes, fees or payment details; transport accounts
  never. Sent only when the site's answer lists `products` in `sections`. The Your website
  card and Kels count them. `cloudFields.js` regenerated. Tests added. No new files.
- **SW cache bumped to `kennelos-shell-v97` (2026-11-03)** for her KennelPort website:
  Connect / Update website, the Show on website marks (dogs, pairings, litters, accounts),
  the website prompts and Kels's Update my website. `PRECACHE_URLS` already carries the six
  new files.
- **Website puppy statuses are her disposition (2026-11-03).** `siteExport.puppyStatus`
  sends the disposition as set: Available, Placed (spoken for: an open sale, still here),
  Keeping (staying), Undecided, Health hold (hidden). Sales and waitlist picks no longer
  change it, so a pick with its deposit still owed stays Available, and a delivered pup has
  gone External and isn't sent. Her status field isn't read: a litter closes at about 9 weeks, long
  before a kept pup moves on from Puppy. The bundle no longer
  reads sales or waitlist offers. KennelPort shows Placed as "Spoken for".
- **The hand-over starts ticked (2026-11-03).** Closing a marked litter lists each pup
  marked Keeping, with "keep her on the site" ticked; she unticks any she doesn't want
  there. Tests updated.
- **SW cache bumped to `kennelos-shell-v98` (2026-11-03)** for the website puppy statuses
  (her disposition, as set) and the hand-over starting ticked. No files added or renamed.
- **Kels's Update my website asks first (2026-11-03).** Before sending, groups with tick
  boxes (`siteExport.websiteGaps`): her adults not on the website, kept pups whose litter
  has left it, litters and pairings not listed, and her girls' heats (unticked). Then a
  deposits date for any shown, born litter without one, then her settings: Use my KennelOS
  prices (new `kennelportApi.setSiteSettings`, KennelPort's `POST /v1/settings`), her
  waitlist online, and the kennel record's website (moved before the send). The Settings
  card's Update website still sends straight away. Rides `kennelos-shell-v98`; no files
  added. Tests added.
- **Kels links the website too (2026-11-03).** Not connected on this device, Update my
  website asks whether she has a KennelPort website (yes / no / not sure). On a yes: which
  kennel, KennelPort Site Manager's Link KennelOS in a new tab
  (`kennelportApi.kennelportLinkCodeUrl`, KennelPort's `/link-kennelos`), then the code
  and a device name typed into Kels, the same link as Settings' Your website card; then
  on to the update.
- **Adding with Kels asks about the website (2026-11-03).** With the website linked, Kels's
  Add dogs and Record a new litter end by offering the new records for it, ticked (a
  litter's parents too, when hers and not shown), with the deposits date check for a born
  litter (`websiteUpdateUI.offerWebsiteFor`). Pro with a KennelPort address only.
- **Kels checks for website updates after a task (2026-11-03).** With a website linked on
  the device, any Kels task that changed what it shows (selling pups, the waitlist's picks,
  check-ins, health tests, adding dogs or litters…) ends with "Want me to check for website
  updates?", then the changes in words and Update website. Each Update website now keeps
  the bundle it sent (`sent` on the device-only link row) for `pendingWebsiteChanges` and
  `siteExport.bundleChanges`. The add flows' website question now asks only when a website
  is linked (`anyWebsiteLink`). Tests added.
- **Accounts and the website with Kels (2026-11-03).** Update my website asks about
  accounts with a referral link, code or instructions not on the website (Recommended
  products; `siteExport.websiteGaps` `accounts`, `hasReferral`). Set up my accounts takes a
  referral link and code, and with a website linked offers an account that has any for
  the website. Tests added.
- **SW cache bumped to `kennelos-shell-v99` (2026-11-03)** for accounts and the website
  with Kels (Update my website's Recommended products group; Set up my accounts' referral
  fields and website question). No files added or renamed.
- **Unmarked health tests show on the website (2026-11-03).** `siteExport` sends a test's
  `normal` as null when its Normal or abnormal is not marked (was false), so KennelPort's
  Normal results only keeps off only results marked Abnormal. The Health tests form's hint
  says so. Test updated.
- **Registration wherever family pages show a pup (2026-11-03).** Available Puppies
  (public list, status pages, the embed) shows each pup's registration after its name
  (`cardPups` now passes `registration`); a turn's pup labels end with it, prices or not,
  and after the pick; with prices, pups are always in registration sections, even all
  Limited. A pup with none set reads, and groups, as Limited. Tests updated.
- **Undecided registration, and pups link to their website pages (2026-11-03).** A pup
  with no registration set (she'd sell it either way) shows none where no prices show;
  where they do, it's under Limited reading "Limited ($3,700 for full)" (their pick: "Price:
  $3,000 ($3,700 for full)"), `litterPrices` adding Full's prices for it. A pup whose `url`
  is a page on her KennelPort site links there without the photos_online tick
  (`page: true`; "On our website: Opal's page"). `isWebsiteAddress` moved to the new pure
  `data/websiteAddress.js` (in PRECACHE_URLS) so the projection can use it. Tests added.
- **A turn links the litter, not each pup (2026-11-03).** On a turn a pup's name is a pick
  button, which can't hold a link, so the per-pup "On our website: Opal's page" line under
  the buttons is gone: a pup's page sits under its litter's (`/litters/<litter>/<pup>`), so
  the litter's own line above the buttons is the link to give and now reads "View litter on
  our website" where it is that page. A litter's `photos_url` carries `page: true` the way a
  pup's does (`waitlistProjection.litterLink`, through the Worker's `pageOf`). Pup pages
  still stand in under the buttons where that litter has no page of its own, so a turn is
  never left without a link; a pup whose link is only photos keeps its own "Photos: Rue".
  The two decisions moved out of `status.js` into `common.litterLinkHtml` /
  `common.pupLinksHtml`, where they're tested. Tests added.
- **A pairing names the heat it uses (2026-11-03).** For a website whose Worker lists the
  `heat_id` section, a pairing's bundle entry carries `heat_id` (the heat it uses, by the
  website's heat rules), and a litter's carries its pairing's, so KennelPort turns the
  website litter made from that heat into the pairing's (or the litter's, when the pairing
  never showed) instead of hiding it and making a new one. `websiteHeats` now reads its
  pairing match from the new `heatUse`. The link isn't listed as a change in Kels's
  Update my website. Tests added.
- **Kels's website check asks only about what the task changed (2026-11-03).** After
  every task Kels compared the website bundle with the last one sent, so once she said
  Not now, each later task (even one touching nothing on the website) put the same old
  changes to her again. Kels now keeps a snapshot as a task starts
  (`noteWebsiteBaseline`, `kennelportLink.websiteSnapshot`) and asks only when the task
  changed what the website would show, listing only those changes and counting the
  earlier ones still waiting (`pendingWebsiteChanges` `since` → `fresh`). Tests added.
- **Assisted setup planned (2026-11-04).** `docs/KennelOS_Assisted_Setup_Plan.md`: a user
  lets KennelOS support work in her program as a helper device (a help code made on her
  device carries her vault key, redeemed only with an `/ops` session), with owner-only
  routes refused to helpers, Pro without a license seat, her list of the helper's changes,
  and **Remove access**, which revokes the session, blocks new codes and wipes the helper's
  copy. Nothing built.
- **Delete an account from /ops, and its passkeys with it (2026-11-04).** For a user who
  made two accounts and wants to start over: `/ops` → Delete an account looks an account up
  by email (devices, backups, vault and passkeys shown; the address never echoed) and
  deletes it after a typed DELETE, optionally erasing its devices. `program.removeAccount`
  is now shared by `DELETE /account` and ops, and records each session's token hash in
  `account_deletions` (migration 0020, pruned after 90 days), so a device that turns up
  later hears `401 account_deleted {erase}` instead of a plain sign-out. The app
  (`CloudAccountDeletedError`, `cloudDevices.accountDeleted`) then tells the password
  manager to drop the program's passkeys (`vaultPasskey.forgetAllPasskeys`, WebAuthn
  `signalAllAcceptedCredentials`) and, with `erase`, wipes itself and frees its Pro
  activation as a remote erase does. Deleting your own cloud data also drops the passkeys,
  and only your other devices are told. Tests added (cloud and client).
- **Assisted setup, Get help and the manager app (2026-11-04).** Support makes a user's
  account in a new installable manager app (`/manager/` on the cloud Worker, ops-token
  cookie, web push), opens a one-time link in KennelOS Pro and becomes a **helper** on her
  account (`sessions.role`, owner-only routes refused). The helper device turns on the vault
  and sync and sets her program up; her first sign-in is `assisted`, and "I already use
  KennelOS" runs her takeover: the vault key from support's device by an **automatic
  pairing** (owner's choice: no typed code; the server shows the code only to the other side
  in the states that allow it), the join, her own recovery code, then support is signed out
  (`401 helper_removed` → the device erase). Later **Get help** in Settings → Account
  notifies the manager app and lets support back in until either side ends it. Migration
  0020 gains the assist tables. `docs/KennelOS_Assisted_Setup_Plan.md` rewritten to the
  built flow. Tests added (cloud and client).
- **The manager app's scripts run after deploy (2026-11-04).** Wrangler bundles with
  esbuild's keepNames, which wraps the page script's and service worker's named
  functions in a `__name` helper that only exists in the Worker; sent to the browser as
  their source, both stopped at their first line ("Loading…" forever). Each now starts
  with a one-line `__name` stand-in. Test added.

- **Credit-covered deposits keep the credit's date (2026-11-04).** When a family's credit
  for funds already received (e.g. an early deposit taken before the litter was born)
  covers the whole deposit, Deposit received prefills the credit's date and saves it as
  the sale's `deposit_date` (`confirmDeposit`'s `paidDate`), matching the date the
  ledger files the credited deposit under; the offer, placement and next family's turn
  stay dated today so a back-dated deposit can't start the next turn already overdue.
- **Program badges on the public list (2026-11-04).** New Waitlist setting "Show program
  badges on the public list" (`waitlist_config.public_show_programs`, off by default):
  a family in an `ahead` program that has a description for families shows the program's
  name as a badge by theirs, online and in the copied text, and tapping it shows the
  description, so families see why someone who joined later is ahead. Standard programs
  and ones without a description stay private. The Worker caps the badge's strings.
  Waitlist Spec's privacy table gains the row. Tests added (client and cloud).
- **Program icons instead of badges (2026-11-04).** Asked by the owner: the public list
  shows no program names. A program gains an optional `public_icon` (new vocab
  `WAITLIST_PROGRAM_ICON`, cloud field; drawings in new `assets/programIcons.js`, a copy
  in the family pages), picked on the Programs page (a description for families is then
  required). With the setting (renamed "Show program icons on the public list") on, any
  program with an icon shows it left of the family's number; tapping it shows the
  description. The copied text uses the icon's emoji with a key below the list. The
  Worker passes on only a known icon and the description.
- **Program icons on her own pages (2026-11-04).** The waitlist's program badge and a
  family's Program row show the program's icon; the row says whether it shows on the
  public list, or why not (setting off, or no description). `programIconHtml`.
- **SW cache bumped to `kennelos-shell-v103` (2026-11-04)** for this batch (credit-dated
  deposits, program icons on the public list and her pages).
- **Co-owned dogs on her website (2026-11-04).** For KennelPort's co-owned dogs plan
  (KennelPort `docs/Co_Owned_Dogs_Plan.md`). `Dog.lives_with_contact_id` (cloud): which
  co-owner a co-owned dog lives with now, empty meaning with her; no history. **Lives
  with** on the Dog form (Me or one of the co-owners chosen above), shown on the profile;
  `dogRepo.livesWithOk` clears it once it isn't one of the dog's co-owners or the dog isn't
  co-owned. Registered as a contact reference (scan). `Kennel.name_on_website` (cloud): an
  outside kennel her website may name, ticked on the Kennels list's Edit row and badged
  Named on website. `siteExport` sends, to a Worker that lists `partner_kennels`, each
  dog's `co_owned`, `lives_away`, `lives_with_kennel_id`, `co_owner_kennel_ids`, and the
  ticked kennels as `{ id, name, website }` (`coOwnership`, `namedKennelOf`, `webAddress`);
  never a co-owner as a person. Kels's Update my website asks about unticked kennels and
  names dogs living with a co-owner who has no kennel; the change list says "Nova: now
  living with Oakridge". `cloudFields.js` regenerated. Tests added (`coOwnedWebsite`).
  SW cache bumped with the batch below.
- **Puppy portal: the family feed, KennelOS's side (2026-11-04).** For KennelPort's
  `docs/Puppy_Parent_Portal_Plan.md` phase 1 (§3.4; build chunk 3's KennelOS half).
  `data/portalFeed.js` builds the feed, format 1: each family from their signed contract
  on (Sale contract Signed with its date), their placements (pup, go-home, pickup time in
  her time zone, microchip, registration number, a voided sale's reason, shots, deworming
  and vet visits, extras by price-list id), her vet (the Vet contact on most of her dogs'
  visits), and `removed`. `data/portalFeedSync.js` sends it on its own (a page load at most
  hourly, and 20 s after a change that alters it) to a linked site whose facts say
  `portal_feed: 1`; `kennelportApi.sendFamilyFeed`. The answer's portal and one-tap key go on
  `Kennel.kennelport_portal` (cloud, owner decision); its facts are applied once each: real
  pickup time on the pickup event and the sale Delivered, the microchip, a death after
  pickup, and who is handed over. Status page: **Open your puppy portal** (server
  `/f/portal` signs KennelPort's one-tap token), only **Your puppy portal** once handed
  over, Delivered or past pickup (also on the server); Companion link request off.
  Furever lists none of her pups. `cloudFields.js` regenerated; tests added
  (`portalFeed`, cloud `familyPortal`).
- **SW cache bumped to `kennelos-shell-v104` (2026-11-04)** for this batch (co-owned dogs on
  her website, the puppy portal's family feed).
- **Dog Cards, Shared Dogs Plan phase 1 (2026-11-04).** `docs/KennelOS_Shared_Dogs_Plan.md`
  written (Dog Cards, then live updates through the cloud, then heats and two-way questions).
  Built phase 1 (guide §36): `dogs.public_id` (`db.version(6)`, write-once, `kosd1_` ids minted
  on first send), `data/dogCard.js` (build, decode, preview, apply, the allow-list),
  `events.shared_ref` for tests and titles sent again, `pages/dog-cards.html` under Sharing
  (send several dogs by co-owner, link / code / file; receive with a preview, co-owned or
  outside, link to a dog she typed in, lives with), **Send a dog card** on each dog's page and
  **Add dogs from a card** on Dogs. `editionFlags.dogCards` (Pro; Lite and Demo off), Pro-only
  page in `proPages.js`, precache entries, both fields cloud with `cloudFields.js` regenerated.
  Tests added (`dogCard`); `cloudBackup`'s schema version is 6. Tried end to end in two browser
  profiles (three co-owned dogs and their sire).
- **SW cache bumped to `kennelos-shell-v105` (2026-11-04)** for Dog Cards.

- **Clearable dates on the dog form.** Date of birth and Date of death get a **Clear** button:
  Safari on iPhone/iPad gives a date input no way to empty it, so a date of death entered by
  mistake on a living dog was stuck. Saving an empty date already worked; only the input couldn't
  be emptied.
- **SW cache bumped to `kennelos-shell-v106` (2026-11-04)** for the clearable dog-form dates.
- **7-day undo on a withdrawal she enters.** "They withdrew" on a family's page now keeps the
  status they left (`withdrawn_from`, new optional field, cloud like `removed_reason`, so a
  restore inside the window can still undo it; `cloudFields.js` regenerated) and offers
  **Undo withdrawal** for 7 days, back to that status at their old place (anchor untouched; no
  offers made; refused once they've re-applied). Withdrawals from the family's status page and
  back-outs stay final. Tests added (`waitlistWithdrawUndo`). Rides `kennelos-shell-v106`.
- **7-day undos for a mistap on the waitlist.** Her own removal ("Remove them from the list"),
  a decline, "The fee wasn't received in time" and "Fee received" can each be undone for 7
  days from the family's page (Undo removal / Undo decline / Reopen application / Undo fee
  received…). New optional fields `expired_date` and `fee_received_manual` (cloud, like the
  other waitlist dates; `cloudFields.js` regenerated). Every undo keeps the family's place,
  makes no offers and is refused once they've re-applied; the fee undo also stops once they've
  been offered a turn. Today still notices only automatic removals. Tests in `waitlistUndo`
  (renamed from `waitlistWithdrawUndo`). Rides `kennelos-shell-v106`.

- **Pedigree import reads AKC Certified Pedigrees.** `pedigreeParse.js` now takes the
  Certified layout (the dog's box between its sire's and dam's in the first column, under
  "Sire"/"Dam" labels, with a "BREED SEX COLOR" line, "Date Whelped:" and "Breeder:" under its
  name), unslashed AKC numbers with a bracketed date (`NP80670402 (05-24)`, stored as
  `NP806704/02 05-24`; `normReg` already matched both), details run on across lines (OFA, CHIC,
  country, `AKC DNA`), and abbreviated colors spelled out (`BLK BRDL & WH` → Black Brindle &
  White). Research Pedigrees read as before. Tests added (`pedigreeParse`).
- **Kels's Next button below the fold on a phone.** The chat card was a fixed `100vh − 96px`:
  on Android Chrome `100vh` is the screen without the address bar, and on support's device
  the "helping … / Hand back" bar (sticky, in the page flow, two lines on a phone) pushed it
  further down, so Back/Next at the foot of her panel sat off-screen, and the chat's own
  scrolling couldn't reach them. The card is now `100dvh` (`100vh` fallback) less
  `--assist-bar-h`, which `renderHelperBar` sets from the bar's measured height.
- **Pedigree import saves the chart's breeder as a contact** (editions with contacts). Each
  file card has Breeder (read from the chart, all caps put in name case) and **Save the breeder
  as**: the contact of that name on file, a new contact, or none. The contact is tagged Breeder;
  if it has a kennel, that becomes the chart's dog's breeder kennel when it has none. No new
  fields. Tests added (`pedigreeImport`); tried in the browser on the Adore Mi'Amor chart (a
  new contact, then matched on a second import).
- **SW cache bumped to `kennelos-shell-v107` (2026-11-04)** for AKC Certified Pedigree import,
  the breeder contact on pedigree import and Kels's Next button on a phone.
- **Pedigree import: names with digits, and the breeder's honorific.** An all-caps name with
  digits ("MRF WIGGLES BLUE 17 50-3") read as a detail line and merged into the box above,
  dropping dogs without a warning; a line after a gap wider than a line space now always starts
  the next box as its name. The breeder's "Mr./Mrs./Ms./Miss/Dr." is dropped from the contact
  name. Tests added. Rides `kennelos-shell-v107`.
- **Pedigree import reads the dog's microchip.** A Certified Pedigree's "Microchip:" line (or
  a header's) is saved as the chart dog's `microchip_id`, filling a blank one only. Tests
  added. Rides `kennelos-shell-v107`.
- **One order for every dog picker.** Your dogs (owned, co-owned), then Other dogs, then
  Pedigree only, A–Z within each (titles in front ignored, numbers in order), as labelled
  groups: `dogRepo.pickerGroups` + `ui.dogOptgroups`. Applied to sire/dam on Dog, Litter and
  Pairing, Contract, Sale, the stud-service partner, the heat-cycle dam, the expense dog, the
  Documents filter and upload, the pedigree pickers, and Kels's tidy-up and Add-dogs parent
  pickers (their "same breed first" order dropped). The stud-service "our dog" list keeps
  males first; the waitlist's parent checkboxes are unchanged. Tests added
  (`dogPickerOrder`). Rides `kennelos-shell-v107`.
- **Fix a spot in a pedigree.** On the Pedigree page and a dog's Pedigree card, every ancestor
  box has a ✎ and every Unknown box a "+ Add": put a dog on file there, type in a new one (made
  pedigree-only, or the dog already holding that registration number), or clear the spot. Never
  a loop; a misplaced pedigree-only dog's sex is corrected when moved to a spot of the other sex
  (refused while it still holds the other role). New `data/pedigreeEdit.js` (precached). Tests
  added (`pedigreeEdit`). For charts the importer misread before the names-with-digits fix.
- **SW cache bumped to `kennelos-shell-v108` (2026-11-04)** for pedigree import's names with
  digits, breeder honorific and microchip, the one dog-picker order, and fixing a spot in a
  pedigree.

## 2026-11-05: Waitlist policies, planned

- `docs/KennelOS_Waitlist_Policies_Plan.md`: one ordered list of her policies per kennel
  (`waitlist_config.policies`), edited in a new **Policies** group in Kennel › Waitlist
  settings with the FAQ's editor, shown on the public list, the application and the status
  page (with links at the turn, the deposit and backing out), in the website feed, and to
  Kels. Five questions open for the owner. Nothing built.
- Revised with the owner's answers: the common topics are about how her waitlist runs (the
  fee, turns, passing, removal…), with hints from her own settings; her KennelPort website
  shows them beside policies of its own; an "I've read the policies" box on the
  application, a locked question present only while she has a policy, "policies" linking
  back to them; a dismissible Today nudge for kennels without any. Q3–Q5 still open.

## 2026-11-05: The public list's See Your Details stands out

- On the public waitlist page, **Current Applicants: See Your Details** (the card families
  need most, among several folded cards) is tinted in the soft accent with an accent edge
  and heading; its inputs stay on the plain surface. Uses the page's own colour tokens, so
  light, dark and a forced theme all follow (`cloud/public/family/family.css`).
- Policies plan: every question answered. A banner on a family's page when she changes her
  policies after they applied (until they open them); the fee and back-out texts stay
  separate; Pro only. The common topics list is the owner's to adjust.
- Policies plan §2.1 rewritten to the owner's five topics (applications and the fee before a
  name shows, preferences that match no pup are skipped, passes and not responding, one
  deadline for the pick and the deposit, pausing with no going back once skipped), each with
  suggested wording built from her own settings and a note when those settings change.
- A sixth starter topic: business days and closed dates (her open days in words; her
  closed dates shown live under it on the family pages rather than written into the text).

## 2026-11-05: Waitlist policies (KennelOS side)

- `waitlist_config.policies` and `policies_updated` (defaults `[]`, `null`); edited in Kennel ›
  Waitlist settings › **Policies**, between Fees & payment and Turns & offers, only while the
  list can go online. The FAQ's row editor moved to `assets/qaListEditor.js` and is shared.
- **Start from common topics**: the owner's six (applications, preferences, passes and not
  responding, picking your puppy, pausing, business days and closed dates), worded from her
  settings by `data/waitlistPolicies.js`; each row notes when a setting it quoted changes.
- The locked application question `policies_read` ("Please read our waitlist policies.", one
  required box), on the form only while she has a policy; "policies" links up to them.
- Today nudge *"Add your waitlist policies"* for kennels with the list online and none.
- Published (`kennel.policies`, the form question's `link`), allow-listed by the Worker
  (`policiesOf`) for the public list, status pages and the form; shown on all three: a
  folded card, links at the turn, the deposit and backing out, an "updated" banner for
  families who applied before her last change, and her upcoming closed dates under a
  business-days policy.
- Tests: `waitlistPolicies.test.js` (new), additions to `waitlistProjection` and the Worker's
  `familyPages`. Checked in a browser at phone width: Today, the Policies group (starter,
  hints, changed-setting note), the form editor, and the three family pages.
- Precache: `data/waitlistPolicies.js`, `assets/qaListEditor.js` (and `app.css` changed).
  SW cache bump not done: asked.
- The Policies group says when its list isn't saved: after Start from common topics,
  *"Suggestions only until you tap Save below: nothing is on your application or shown to
  families yet"*; after any other edit, *"Not saved yet…"*. Cleared on Save.

- **Pedigree import: a parent named "DAM …".** The Certified layout's "Sire"/"Dam" label was
  stripped from any parent name starting with that word ("DAM PRESTIGE TINA" read as "PRESTIGE
  TINA"); only the label as printed ("Dam", then an all-caps name) comes off now. Test added.

## 2026-11-05: Programs suggested by an answer; the do-not-sell list

- **A question that suggests a program.** Her own yes/no or choice question can name one of
  her programs and the answers that suggest it (form editor, "Suggest a program";
  `program_link` on the question, never published). The application then asks **"Add to
  [program]?"** with a Yes / No dropdown on the family's page, in the Approve dialog (Yes fills
  its Program) and as a badge on the Waitlist page, while it's open and while its fee is due;
  gone once the fee is received. Yes on an approved family takes the program's fee (a waived
  fee puts them on the list); No is kept in `program_suggestions_declined` (private).
  `data/programSuggest.js`, `addSuggestedProgram` / `declineSuggestedProgram`. Tests
  `programSuggest`.
- **Do-not-sell list.** New table `do_not_sell` (`db.version(7)`; every field private, sealed
  like expenses; registered on contacts and waitlist entries; restore match by contact, else
  the contacts rule). New page Contacts › **Do not sell** (Pro): add by hand, move a contact
  (it leaves the Contacts list), or add from an application; edit, take off (archive). New
  applications are matched on name, email or phone (and the listing's contact) and warned
  about on the family's page, the Approve dialog and the Waitlist page; never declined.
  `data/doNotSell.js`, `data/doNotSellRepo.js`. `cloudFields.js` regenerated: the Worker must
  be deployed before this app build, or live sync refuses the new table (`bad_table`).
  Tests `doNotSell`, plus `referenceRegistry`, `syncRegistry`, `cloudBackup` (snapshot
  schema 7).
- Precache: `data/programSuggest.js`, `data/doNotSell.js`, `data/doNotSellRepo.js`,
  `pages/do-not-sell.html` / `.js` (`app.css` changed). Checked in a browser at 390px: the form
  link, the family page before and after approval, Yes changing the fee, the Approve dialog,
  the Waitlist badges, a contact moved to the list and hidden from Contacts, the list page.
  SW cache bump not done: asked.

## 2026-11-05: Transport accounts on her website's Getting your pup home page

- `siteExport.websiteProducts(accounts, { transport })`: an account marked Show on website
  goes when it has a referral link, code or instructions, or is a transport account (owner
  rule). Transport accounts go only to a Worker listing the new `transport` section, with
  `transport: true` and `website` (every product carries both then; `PRODUCT_TRANSPORT_KEYS`);
  an older Worker gets the old keys and no transport. A marked account with nothing to share
  is no longer sent (its product leaves the site on the next Update website).
  `websiteGaps.accounts` offers transport accounts with a website too. The Accounts card's
  badge and the Show on website hint say where each goes. Tests in `siteExport`.

- **SW cache bumped to `kennelos-shell-v109` (2026-11-05)** for the waitlist policies, See Your Details tint, the "DAM" pedigree fix, programs suggested by an answer, the do-not-sell list and transport accounts on the website.

## 2026-11-05: Update website from support's helper device

- `kennelportLink.licenseOk` passes on a helper device (cloud session `role: 'helper'`), as
  the app's license gate already did, so support can Update website and send the puppy
  portal's feed while setting her up; before, it refused with "license has lapsed". Connect
  website had no license check. Test in `siteExport`. Assisted setup plan §3 and the guide
  say so. KennelPort now lets a site's editor make the link code. SW cache bump not done: asked.

## 2026-11-05: Marketing site brought up to date

- `site/index.html`: three new feature cards (the waitlist, devices in step, Kels), the
  "where your data lives" line names every opt-in that sends data, the Pro card's list, Kels
  in Getting started, and a KennelPort website callout. `pro.html`: five new cards (devices
  in step and Get help, the KennelPort website and portal, alerts and the digest, Jotform
  and Stripe, shows and more kennels), the waitlist card's policies, family requests and
  do-not-sell list, Dog Cards and KennelAssistant in Share-out. `editions.html`: rows for
  each of those, and Kels in both editions. `lite.html`: Kels included, the new Pro features
  under What's not in Lite. `faq.html`: the phone-and-computer and two-people answers rewritten
  for sync; new questions on updating a website and getting help. `about.html`: the service's
  list, and the digest's readable email. README Status: the deployed features marked live.
  Not done: `privacy.html` / `terms.html` (asked).

## 2026-11-05: Privacy policy and terms for the newer features

- `site/privacy.html` (last updated 5 November 2026): scope (§1); the digest's readable email
  and support's access in the short version (§2); Dog Cards and the website link (§4); §9
  rewritten for what the online waitlist now holds (policies, shared accounts, prices,
  deposits, credits, pickup times and places, extras, a family's pickup location and its
  90 days); new §9a (what goes to KennelPort, website and puppy portal), §9b (alerts and the
  digest), §9c (help from support, with the automatic key hand-over's trade-off); emails (§11);
  Apple/Google/Mozilla and KennelPort as providers (§12); retention (§13); choices (§15).
- `site/terms.html` (last updated 5 November 2026): scope (§1); device sync and support's
  access (§6); the breeder's responsibility for policies, prices, extras and pickup (§8); new
  §8a (the KennelPort website); other services (§12); alerts aren't a guarantee (§13).
- Wording approved by the owner. KennelPort is run by KennelOS.

- **SW cache bumped to `kennelos-shell-v110` (2026-11-05)** for Update website from support's helper device.

## 2026-11-06: a puppy's disposition to the website

- The website bundle sends a puppy-status dog's `disposition` (keeping, available,
  placed, health_hold; `undecided` when none is set), only to a Worker whose answer
  lists the `disposition` section (KennelPort adds it in the same change), so an older
  Worker is never sent a field it would refuse. Nothing else about which dogs go
  changes: still those marked Show on website. KennelPort's owner now picks, per site,
  which dispositions go on the site (From KennelOS, "Which puppy dogs go on the site");
  the website shows none of them as words. Grown dogs never carry it.
- Why: puppies marked Show on website stay marked when their disposition changes, so a
  pup no longer kept still showed under Up and coming.
- Tests: `siteExport.test.js` (sent only with the section, only on puppies, undecided
  when unset).
- **SW cache bumped to `kennelos-shell-v111` (2026-11-06)**, the owner's go-ahead.

## 2026-11-08: Picks preview, and the side sale spec

- **Specs:** `docs/KennelOS_Picks_Preview_Spec.md` (built here) and
  `docs/KennelOS_Side_Sale_Spec.md` (decided, not built), both from the owner's decisions of
  2026-11-08. README doc map and Status updated.
- **Picks preview:** `shared/data/picksPreview.js` (pure, shared) and
  `shared/assets/picksPreviewModal.js` (Pro-only; `proPages.js`). Every Open picks (the Litter
  page's picks panel, the Waitlist page's litter rows) shows it first and opens picks only on
  **Open picks now**, after a fresh recheck. With picks open, the panel has **Who's in line…**.
  It shows the action `openPicks` will take (offer, join with the deadline restart, wait,
  "Not this litter" passes), the turn order across every open litter plus this one (or this
  litter alone), every pup with why it isn't offered or its setup flags, who qualifies per pup in
  order, within reach per sex, an **Either** switch (Either families as female / male), every
  family left out with every reason, families not on the list yet, soft checks, and her turn
  settings, edited and saved in place (previewed live as a draft). A pup's disposition,
  intended registration and sex save from its row. `?preview=<litter id>` reopens it after a
  family or pup link.
- `app.css`: `.modal.modal-wide`. `sw.js` `PRECACHE_URLS`: both new files.
- Tests: `tests/picksPreview.test.js` (its action matches the real `openPicks` for offer, join,
  wait, "Not this litter" passes and none; the line equals `litterQueue`; every reason given; the
  Either switch; the alone view; a settings draft writes nothing; checks).
- End-State guide §29: the picks preview.
- SW cache not bumped (asked).

## 2026-11-08: Side sales; Open picks from Kels and Today through the preview

- **Picks preview everywhere:** Kels's litter check-in, Today's Open picks nudge and Kels's
  Review my waitlist open picks through the preview (`waitlistPicksPanel.openPicksFromCheckin`;
  the nudge returns `{ openPicks }` for the page to open it). Owner kept the pup inline edits.
- **Side sales** (`docs/KennelOS_Side_Sale_Spec.md`, built): new Sale fields `side_entry_id`,
  `side_deposit_due`, `side_holds_pup`, `side_prior_disposition`, `side_request_sent_date`
  (cloud; `cloudFields.js` regenerated; `side_entry_id` in `referenceRegistry`).
  `waitlistRules`: the `isPupAvailable` side rule, `isSideSalePending`, `sideSaleOf`,
  `pupClaims`, `sideSaleBlocker`, `sideSaleIssues`, `answersToFit`; a family with a pending side
  sale gets no turns. `waitlistActions`: `recordSideSale`, `confirmSideDeposit`,
  `cancelSideSale`, and the other claim resolved on any deposit. Projection: the side sale in
  the family's `offers` as a turn row with a pick, `direct: true` for the Worker only. Worker:
  `serverMoves.openTurns` skips direct rows except for reminders; the public list doesn't mask
  them. UI: `assets/sideSaleUI.js` (Pro-only; `sw.js`, `proPages.js`), the family page's
  Record a side sale… and Side sale card, the picks panel's Sell to a waitlist family…, the
  second-claim warning in the pick / switch / deposit dialogs, `pickToSend` for side sales,
  Today nudges (overdue side deposit, two sales on a pup), the preview's side-sale lines.
- Tests: `tests/waitlistSideSale.test.js`; cloud `serverMoves` and `familyPages` tests for
  direct rows.
- End-State guide §29: the side sale.

- **SW cache bumped to `kennelos-shell-v112` (2026-11-08)**, the owner's go-ahead, for the picks
  preview and side sales.

## 2026-11-08: Review plan brought up to date

- `docs/KennelOS_Review_Plan.md` takes in the 57 commits since it was written (2026-11-03):
  a "New since the first draft" table in §0 mapping each new feature to a session; new
  evaluate items in K1, K2, K4, K5, K7–K15 for `version(6)`/`version(7)`, Dog Cards,
  pedigree import and editing, account deletion and migration `0020`, assisted setup,
  waitlist policies, programs suggested by an answer, the do-not-sell list, the puppy portal
  feed's KennelOS side (K7 owns it; it postdates both review plans) and the rewritten privacy
  policy and terms; a new session **K6b** (picks preview, side sales, the 7-day undos).
  Pending-deploy list, line counts, guide section lines and the baseline refreshed
  (1639 / 303 pass, build succeeds). `docs/review/INDEX.md` gains the K6b row;
  `docs/review/SESSION_PROMPTS.md` updated to match. No session has run yet.

## 2026-11-09: Credits on the family status page

- Bug: a family who picked a pup on their status page saw the full deposit ($400) although
  their $50 application fee (credited toward the deposit) and their $200 remaining credit
  should have come off it. The projection published `deposit_fee_credit` / `deposit_credit`
  only once her device recorded the pick and made the sale; while the pick waited, the
  deposit block had nothing to subtract.
- Fix: each family's projection carries `credits` (`creditsView`: credited fee, what their
  credits can pay toward the pup and toward a deposit); the Worker passes it through
  (`familyPages.creditsOf`, amounts only); the deposit block falls back to it until the pick
  is recorded. Their Current Position card gains a "Credited" row (before and while picks
  are open). Before they pick, the turn card's deposit line adds what they'd send after
  their credits, and the "Choose <pup>?" dialog says it too (`depositAfterCredits` in
  status.js, shared with the deposit block). Needs a Worker deploy for the page, and her
  device to republish.
- Tests: `tests/waitlistProjection.test.js` (credits), cloud `familyPages` (allow-list).

## 2026-11-09: A released Pro device asks for its key again

- Found on assisted setup: support deleted a user's account with **erase its devices**; her
  phone erased itself and released its Lemon Squeezy activation (0/5), but reopened without
  the key screen. Two causes in `data/license.js`: the gate's `validate` was in flight when
  the boot check-in's erase wiped the record, and its answer wrote the record back; and on the
  next load the store's "activation not found" (a 4xx with `valid:false`) read as offline, so
  the cached lifetime record kept the device running for its 90-day offline window.
- `validate` now clears the record on that answer (`isGoneAnswer`: 4xx except 429, JSON
  `valid:false`) and caches an answer only while the device still holds the same record
  (`stillHeld`); `evaluateLicense` returns `unactivated` when the record is gone. The renewal
  wall's Check again goes to the activation wall in that case.
- Tests: `tests/licenseRevalidate.test.js`. End-State guide §0.3.

- **SW cache bumped to `kennelos-shell-v113` (2026-11-09)**, the owner's go-ahead, for the
  family credits in the waitlist projection and the released-device license fix above.

## 2026-11-09: /ops shows emails sent yesterday and the 30-day daily average

- Migration `0021_mail_daily` (day UTC, sent, failed, first_at; counts only, all kinds
  together, not in the D1 export, not pruned: one row a day). `countMail` adds to it beside
  `mail_counts`, each in its own try so a missing table never stops the other count or a send.
- `/ops` Emails sent section gains two totals (`mail.mailDailySummary`): sent yesterday, and
  the average per day over the 30 UTC days ending yesterday. Before 30 days have been counted,
  the average is over the counted days and says so; before `0021` is applied it says that.
- Tests: cloud `mail` (daily row), `ops-sections` (yesterday, average, partial window).
  Needs a Worker deploy, then Apply pending (`0021`) on /ops. README Status marks every
  migration through `0021` applied (`0017`, `0019`, `0020` confirmed by the owner; `0021` on merge).

## 2026-11-10: the website contract reviewed; a plan to send raw data

- Reviewed `shared/data/siteExport.js` against KennelPort's `kennelos/bundle.js` and rules:
  where a value is worked out or worded before it is sent (a puppy's status, a litter's
  status, titles, the How it works steps, an account's type), and what isn't sent (parents,
  breed, test type, sold litters).
- Plan written: `docs/KennelOS_Website_Contract_Plan.md` (KennelOS's half; the whole plan is
  KennelPort's `docs/plans/kennelos-contract.md`). New optional sections that send her own
  values, and four proposed Dog fields (`imported`, `import_country`, `feature_offspring`,
  `featured_offspring_ids`) whose sync class is the owner's to confirm.
- The owner's decision the same day: no `reserved` status; a pup with an open sale is marked
  Placed. End-State guide §35's line on `puppyStatus` said a live sale or open pick sent
  reserved, which the code never did; corrected to what is built.
- Docs only: no code, no schema, no app file changed. README's doc map gains the plan.

## 2026-11-11: a plan for the waitlist reviews' fixes and three enhancements

- Plan written: `docs/KennelOS_Waitlist_Fixes_Plan.md`. It lists all 52 findings of reviews
  K6, K6b, K7 and K8 with a fix and a build step each, and designs three requests from the
  owner: a placed family stays on the list as **Pup selected**; its pup stays on the
  Available Puppies card under **Already Reserved**; and a family of a litter sold before
  the app gets a status page without being on the list (`WaitlistEntry.off_list`,
  `Litter.waitlist_off`, both proposed, sync class the owner's to confirm).
- Twelve decisions are the owner's (the plan's §2), each with a recommendation.
- Docs only: no code, no schema, no app file changed. README's doc map and Status gain the plan.

## 2026-11-11: the owner's decisions on the waitlist fixes plan

- `docs/KennelOS_Waitlist_Fixes_Plan.md` §2 records them: a family with a pup selected
  **keeps its number** until the pup goes home (Delivered or External), so a lost pup's
  family coming back never pushes anyone down; Already Reserved shows pups whose disposition
  is Placed, the website's rule (`siteExport.puppyStatus`); family-page-only families get
  their own section on the Waitlist page; `off_list` and `waitlist_off` are `cloud`; such a
  family backing out gets Keep or Refund only.
- §3.1 is redesigned for held numbers: `rankedList` stays waiting-only for the turn rules, a
  new numbering over waiting and holding families feeds every reader of a number, and
  `sales` and `dogs` become required there. Five decisions about the fixes stay open.
- Docs only.


## 2026-11-11: Waitlist fixes, step 1: a pup leaving a turn, and side sales that outlive their family

`docs/KennelOS_Waitlist_Fixes_Plan.md` step 1 (K6-1, K6b-1, K6b-2, K6b-3, K6b-4, K6b-10). Each
finding was first reproduced against the real actions, then fixed. The owner chose: check after
every save, move the turn on as for a family leaving (`left`), and have the Worker skip emptied
turns too.
- **A turn left with no pup ends, never as a pass (K6-1, K6b-2).** `waitlistRules.turnIsEmpty` /
  `emptiedTurns` (no pick waiting on its deposit, none of the listed pups still available;
  `resolveOtherClaims` now uses it too). `waitlistActions.endEmptiedTurns` voids the rows with a
  note, adds a family activity line and moves the turn on as `left`. Called from
  `confirmDeposit` and `confirmSideDeposit` (returned as `ended`), and by
  `watchEmptiedTurns`, which `app.js` starts on every page (Pro, not Demo): it runs shortly after
  each data change and once on load, waits while a dialog is open, and the page reports it
  (`waitlistUI.reportEmptiedTurns`). `recordOutcome` never counts a pass or no response on an
  emptied turn (`passes.empty`). Worker: `serverMoves.turnIsEmpty`; the deadline close and the
  reminders skip such a turn, so no "your turn closed" email goes out for it.
- **Leaving the list cancels a pending side sale (K6b-1).** `releaseOpenOffers` cancels it
  (`cancelSideSale` with `leaving`: a held pup goes back; no "keeps their place" line) and
  returns `side_released`; `describeOfferChanges` says so. `confirmSideDeposit` refuses a family
  that isn't `active`.
- **Tidy up (K6b-3):** `pupPlacedFindings` skips sales still at Deposit pending.
- **Undo fee received (K6b-4):** `canUndoFeeReceived(entry, offers, today, sales)`; sales
  required; false once the family has any side sale.
- **Server turns (K6b-10):** `planServerEvent` notes, and doesn't record, a server offer to a
  family with a pending side sale; `confirmSideDeposit` moves the turn on (`accepted`) when it
  voided their own turn.
- Tests: `tests/waitlistEmptiedTurns.test.js` (22), one in `cloud/tests/serverMoves.test.js`;
  `waitlistUndo.test.js` passes the sales. `node --test` 1672 pass; `cd cloud && npm test` 306
  pass; `node build/assemble.mjs` succeeds. Checked in a browser: keeping a turn's only pup
  ends the turn and the page says whose and who's next.
- Docs: End-State guide §29 (rules, side sales, undo windows, leaving, Tidy up); Side Sale
  spec **Modified** notes. No new file, no schema, no new field. Service-worker cache bumped to `v114`.

## 2026-11-11: Waitlist fixes, step 2: Pup selected and Already Reserved

`docs/KennelOS_Waitlist_Fixes_Plan.md` step 2 (E1, E2, K6-12 item 1, K8-12, K8-7, K7-12, K7-8,
K6-9, K6-10). The open decisions it touches were built as the plan recommends (D3: the row
shows the listed name and "Pup selected", her own page names the pup; D12: public names from
the application's name).
- **E1, Pup selected.** `waitlistRules.holdsPlace` (placed, open sale, pup not gone, not
  `off_list`) and `numberedList` (waiting + holding families, one order). `rankedList` stays
  waiting-only for the turn rules. `overallPositions`, `prefPlaces`, `publicList` and the new
  `publicSelected` number from `numberedList` and throw without `{ sales, dogs }`; every
  caller passes them (status page projection, emails, Kels, picks panel and preview, side-sale
  dialog, lost-pup dialog, Kels's Add people, Waitlist Today report, the family's page). The
  projection publishes `public_selected`; the Worker serves it as `listView.selected` /
  `statusView.public_selected`; `common.publicListHtml` puts the rows in at their numbers
  with a ✓ and "Pup selected"; `publicListText` gains "✓ #3 … · Pup selected". Her Waitlist
  page's On the list card shows them with a "Pup selected: [pup]" badge, not in Closed.
- **E2, Already Reserved.** `isPupReserved` (disposition Placed; the website's rule, pinned
  by a test). Projection litters gain `reserved`; `pups` stays available-only, so no turn,
  automatic offer or price reads a reserved pup. `litterCard` passes it through; the family
  pages' card shows Still Available and Already Reserved, Males and Females columns each,
  stacked on a phone. Her Litters card gains a Reserved count.
- **One rule for the waitlist's litters (K6-12 item 1):** `isWaitlistLitter` / `waitlistLitters`;
  the copies on the Waitlist, entry and side-sale pages, Today and the projection now use it.
- **Placed family (K8-12):** `isPlacedFamily`; the funnel, days to placement and Offers &
  Removals count a back-out as Backed out, never Placed.
- **A decided back-out (K8-7)** stays on the family's page for 30 days without a sale, saying
  what happened to the deposit; three new email kinds (`backed_out_keep|move|refund`, also in
  the Worker's `EMAIL_KINDS`) replace "request approved" for it.
- **Policies banner (K7-12):** the applied date is published for a placed family with an
  open sale; the banner's button reads "Read our policies".
- **Public names (K7-8):** `publicNameParts`, `publicSourceName`; "Smith, John" → John S., "The
  Smith Family" → S. Family; the Approve dialogs always show the public form.
- **Waitlist page:** tables scroll in their cards (K6-10); Paused / Not ready badges format
  their dates (K6-9).
- Tests: `tests/waitlistPupSelected.test.js` (21); older tests pass `{ sales, dogs }` and pin
  the new projection keys. `node --test` 1693 pass; `cd cloud && npm test` 306 pass;
  `node build/assemble.mjs` succeeds. Checked in a browser at 390px: her Waitlist page and
  the family pages' list and card.
- Docs: guide §29 (Pup selected, placed family, waitlist litters, reserved pups, public
  names, Available Puppies, Backing out, policies banner, reports); Waitlist Spec §15.3 and
  Family Requests plan §7 **Modified** notes. No new file, no schema, no new stored field.
  Release: Worker and family pages first, then the app. Service-worker cache rides `v114`.

## 2026-11-11: Waitlist fixes, step 3: family pages without the list

`docs/KennelOS_Waitlist_Fixes_Plan.md` step 3 (E3, K7-9, K8-8), built as the owner decided
(D6 their own section, D7 both fields `cloud`, D8 Keep or Refund only).
- **Two plain fields** (no schema block; absent reads as off): `WaitlistEntry.off_list` (a
  family page only) and `Litter.waitlist_off` (kept off the waitlist), both `cloud` in
  `syncRegistry.js`; `cloud/src/lib/cloudFields.js` regenerated.
- **Rules:** `isWaitlistLitter` leaves out `waitlist_off`; `isPicksOpen` (the turn rules,
  the projection's turn queue, the server's queued turns and the picks preview never see such
  a litter as open); `isFamilyPageOnly` / `listRecords`; `familyPageBlocker`,
  `familyPagePlan`; `lostSaleFamily` and `deriveContactWaitlistStatus` skip family pages.
- **Actions:** `addFamilyPage(saleId)`, `soldBeforeWaitlist(litterId)` (+ `…Plan`),
  `putLitterOnWaitlist`, `setFamilyPageOnly(entryId, on)`; `openPicks`, `offerNext`,
  `offerTo` refuse a `waitlist_off` litter; `approveBackOut` refuses Move for a family page.
- **K8-8:** a back-out closes the waiting pickup and extras requests (`closeRequests`,
  `decided: 'closed'`); `slotBookings` takes a `live` test and skips a record with no open
  sale (Litter page's Pickup times and the family's page); closed requests aren't published.
- **K7-9:** the Sale form's Buyer and the Side sale dialog warn about her do-not-sell list,
  as does "Sold before the waitlist…" and "Give this family a status page".
- **Pages:** Waitlist page **Family pages only** section (out of Closed); Litter page
  waitlist panel **Sold before the waitlist…** and a kept-off view (family pages, Make more,
  Put back on the waitlist); Sale page **Give this family a status page** / link to it; the
  family's page says "Family page only", hides the public name and Move the deposit, offers
  **Apply to the list…**, **Keep off the list (family page only)…** and its undo. Reports
  (funnel, Applications, Waitlist Today pipeline, Offers & Removals), the year review and
  Kels's Review my waitlist read `listRecords`.
- **Online:** projected entries carry `page_only`; the Worker passes it as
  `statusView.family.page_only`; the status page drops the waitlist wording for them.
- Tests: `tests/waitlistFamilyPages.test.js` (14). `node --test` 1707 pass; `cd cloud && npm
  test` 306 pass; `node build/assemble.mjs` succeeds. Checked in a browser at 390px: Sold
  before the waitlist on a litter, the Waitlist page's section, the family's page, the Sale
  page's button with a do-not-sell warning; no console errors.
- Docs: End-State guide §29 (fields, rules, actions, surfaces, online); **Modified** notes in
  the Fixes plan, Side Sale spec and Family Requests plan. No new file, no schema block.
  Release: Worker and family pages first, then the app. Service-worker cache bumped to `v115`.

## 2026-11-11: Waitlist fixes, step 4: the puppy portal says only what's true

`docs/KennelOS_Waitlist_Fixes_Plan.md` step 4 (K7-1, K7-2, K7-3, K7-14).
- **K7-1:** `portalFeed.voidedOf` sends a returned sale as voided (`other`); a released
  sale's health stops at its end day (`saleEndDay`), so a re-sold pup's next home's records
  never reach the first family; a released placement that has aged out goes in `removed`
  instead of resting in the portal.
- **K7-2:** `applyPortalFacts` applies a fact only for a placement the feed carries (now or
  before), on a sale not released, with dates in bounds (pickup from the sale date or birth
  to tomorrow; a death on or before today, not before birth), and a handover only for the
  sale's buyer; the rest come back as `refused`. Each applied fact writes a Note on the pup
  (`details.portal_fact`), and Today shows it for 14 days (`nudges.portalFactNudges`).
- **K7-3:** Disconnect this device (and a stopped link on Update website or prices) turns
  the portal off on the kennel (`kennelportLink.turnPortalOff`, keeping `home` and `facts`);
  a device still linked turns it back on with its next send. The card's confirm says so.
- **K7-14:** the feed goes only from the device doing the cloud program's server work
  (`portalFeedSync.mayFeedHere`); with no cloud session, as before.
- Tests: 5 new in `tests/portalFeed.test.js` (two older ones now pick up and die on past
  days). `node --test` 1712 pass; `cd cloud && npm test` 306 pass; `node build/assemble.mjs`
  succeeds. Docs: End-State guide §35.1; plan status and a **Modified** note. No new file, no
  schema. Service-worker cache rides `v115`.

## 2026-11-11: "Non-Waitlist Sales"

The owner renamed step 3's "Sold before the waitlist…" to **Non-Waitlist Sales…** (the Litter
page's button and dialog, the kept-off panel, the Waitlist page's empty Family pages only
line, and the refusals that name it). Wording only. Service-worker cache rides `v115`.

## 2026-11-11: Family pages' Available Puppies card, aligned

- Public list: the Available Puppies and Coming up headings sit left like the page's other
  folded cards; only what's inside them stays centered. The status page (all centered) was
  checked and needed no change.
- Both pages: **Still Available** / **Already Reserved** lose the all-caps, letter-spaced
  style for the cards' own bold title case; "None left" / "None" (`.pup-col-empty`) line up
  with the pup names beside them.
- `cloud/public/family/common.js`, `family.css`; one regex in `tests/familyPages.test.js`.
  `node --test` 1712 pass; `cd cloud && npm test` 306 pass. Docs: End-State guide (public
  list cards). No new file; service-worker cache rides `v115`.

## 2026-11-11: Pickup times at seven weeks; a time with their own meetup place

Traced from a report: a family (a non-waitlist sale, far enough away to suggest a meetup
place) saw "hasn't posted pickup times yet" although the litter had times. They were dated
before the ready date (whelp + 56 days), which a family's page never listed.
- Families now see her times from `PICKUP_EARLY_DAYS` (7) before the ready date
  (`familyPickup.pickupFrom(…, { earlyDays })`, used by `familyPickupView`); a training
  stay's end still wins when later. Standard boarding (`approvePickupRequest`) and the
  portal feed still count from the ready date, so a time before it has no boarding charge.
  Their page reads "Times from <date>." (only while that date is still ahead).
- "None of these work for us" asks **What time works?** (optional) beside the day. The
  Worker checks it (`HH:MM`, else `bad_time`) and passes `time`; her device keeps it as the
  request's `start_time`. It shows on their page's Requested line, her entry's request card
  and history, Today's nudge (`requestText`), and prefills Time in both approve screens
  (entry page, Review my waitlist).
- Tests: a new seven-weeks test and the time in `tests/familyPickup.test.js`,
  `tests/cloudWaitlist.test.js` (end to end) and `cloud/tests/familyActions.test.js`.
  `node --test` 1713 pass; `cd cloud && npm test` 306 pass. Docs: End-State guide §29
  Pickup; Family Requests plan §4 **Modified** notes. No new file, field or schema
  (`start_time` was already a request key).

## 2026-11-11: Pickups she logs start with the family's time

Every pickup event made from a family's choice now carries their time:
- Approving their own place without a time uses the time they asked for
  (`approvePickupRequest`'s `time` now defaults to the request's; '' still means none).
  Approving one of her times already wrote the slot's time.
- While a family's time or own place still waits, a pickup she logs another way starts
  with it: `familyPickup.pickupWish` (their newest waiting slot or address: day, time, place,
  Local pickup for a slot) and `waitlistActions.pickupWishesFor(sales)`. Today's
  **Schedule pickup** / **No, new pickup date** open the event form with that day,
  `placement_time`, `location` and method (titled drop-off for their own place) and say
  so in the detail; Kels's **When's the drop-off?** (`pickupsForm`, Litter check-in and
  Pups are going home) fills in the row and saves the place as the event's `location`
  (`goHome.pickupEvent` takes an optional `location`). Their request still waits for her.
- Tests: `pickupWish` in `tests/familyPickup.test.js`, the Today action's link in
  `tests/linkedStatusNudges.test.js`, `pickupWishesFor` and the approval's time in
  `tests/cloudWaitlist.test.js`; `pickupsForm` checked in the browser (prefill and the saved
  event). `node --test` 1715 pass; `cd cloud && npm test` 306 pass. Docs: End-State guide
  §19 nudges, §29 Pickup, §33 Kels (Pups are going home). No new file or field.

Service-worker cache bumped to `v116` for this session's pickup changes (seven weeks, the
meetup time, and pickups that start with the family's time).

## 2026-11-11: A family-page-only entry's header on a phone

Its subtitle ("<kennel> family page (not on the waitlist)") filled the header row, so the
⋯ menu wrapped onto its own line. The subtitle is now "<kennel> family page" (the Details
card's **Family page only** badge says they aren't on the list), and the entry page's
header keeps ⋯ beside the title at any width (title block `flex: 1 1 0; min-width: 0`,
actions `flex: none`). Checked at phone width (Pixel 5). `waitlist-entry.html` / `.js`;
no new file. Service-worker cache rides `v116`.

## 2026-11-11: Firma chosen for e-sign (plan only)

Researched firma.dev for step 8 of `docs/KennelOS_Integrations_Plan.md` and wrote it up as
§2.3a. The owner decided **D25**: KennelOS holds the Firma account, with one workspace per
cloud program and the master key as the Worker secret `FIRMA_API_KEY`. That supersedes D5's
SignWell / BoldSign. **D26**: 10 sends per program per calendar month, reset the 1st (UTC),
with the default set in `/ops`. Step 8's row, the plan status and the README Status are
updated. No code yet; four Firma details are to be proven on a test key before the build.

## 2026-11-11: Firma e-sign, step 8: the Worker

`docs/KennelOS_Integrations_Plan.md` §2.3a (D25–D26).
- **New `cloud/src/firma.js`:**
  - Connect makes a Firma workspace per program, with its webhook and the webhook switch on.
    Her workspace key and webhook secret are sealed in her connection.
  - Workspace custom fields come from her device's fact list.
  - Templates and Firma's editor token.
  - `POST /integrations/esign/send` reserves a row in `esign_sends` under the monthly limit
    before calling Firma.
  - The signed-PDF link.
  - The `/hooks/firma/<secret>` adapter: an HMAC check, with Firma's id mapped to her
    contract.
- **Migration `0022_esign`:** `esign_sends`, `ops_config`, `esign_limits`.
- **`/ops`:** an "E-sign (Firma)" section with the default limit (10), credits left and sends
  this month. Account find shows the account's count and its own limit.
- **`integrations.js`:** `contract.expired` and `contract.cancelled` events. `toEvents` gets
  `env` and may be async.
- **Elsewhere in the Worker:** health (the `FIRMA_API_KEY` secret, `esign_sends` counted),
  export (the three tables), retention (sends kept 400 days), account deletion, and staging's
  `FIRMA_TEST_MODE`.
- **Fixed during the build:** an unset default limit read as 0. A test caught it.
- **Modified from the plan:** her workspace's key does her calls (the master key only sets
  up). Firma has no API to delete a workspace, so disconnect and deletion stop only the
  webhook.
- **Tests:** 12 new in `cloud/tests/esign.test.js`. `cd cloud && npm test` 318 pass;
  `node --test` 1724 pass; `node build/assemble.mjs` succeeds.
- **Docs:** the plan's §2.3a "As built", `cloud/README.md`, README Status. No app file, so
  no service-worker change.

## 2026-11-12: Jotform retired (D27–D30)

The owner decided to shut down Jotform (`docs/KennelOS_Integrations_Plan.md` D27–D30).
- **Removed:**
  - Connect Jotform: her API key, picking forms, matching fields (`jotformApi.js`,
    `jotformConnect.js`, `jotformMatch.js`, the Accounts page's modals).
  - The signed-form check: `jotformSigned.js`, the app-open check, and the Contract page's
    **Check for signature**.
  - Jotform from account health's key check and Kels's "replace a key" flow (now Stripe
    only).
  - Their tests.
- **Kept:**
  - Pasted contract-form links on a Form service account, as the free fallback beside Firma
    (D28).
  - Jotform data already saved stays read-only (D29). A form's `form_id` / `field_map` are
    shown ("n fields matched"), saved unchanged and still used in its link. A contract sent
    through Jotform keeps its label and link.
  - No field leaves the schema or backups.
- **New:** `jotformKeyStore.forgetJotformKeys`, run on app open, deletes any `jotform:`
  device secret. One new test.
- **Site:**
  - pro, lite, editions and FAQ name Firma e-signing.
  - Privacy: a new §9d (contracts sent for e-signature), a Firma row in the providers table,
    a retention line and a "stop it" line. Jotform is gone.
  - Terms: a new §8b (the monthly allowance, contracts are hers, keep a copy), and §12 names
    Firma.
  - Both pages are dated 12 November 2026, for the owner's review.
- **Docs:** End-State guide §32 and the device-secrets lines, the editions plan, the launch
  checklist (a Firma test-key run; removing a deleted account's workspace by hand), the Kels
  roadmap, README Status.
- **Precache:** four files removed from `shared/sw.js` `PRECACHE_URLS`; service-worker cache bumped to `v117`.

## 2026-11-12: Firma e-sign, step 8: the app

`docs/KennelOS_Integrations_Plan.md` §2.3a (D30, and a new **D31**: Firma's template editor runs
in its own tab, on a sandboxed page of the Worker).
- **Contract templates** on the Contracts page (`assets/esignUI.js`, Pro-only):
  - Set up e-signing makes her workspace and sends the fact names as its fields.
  - She uploads a PDF and picks its kind of contract.
  - **Place fields** opens Firma's editor in a new tab.
- **New `data/cloud/cloudEsign.js`:** the client for the Firma routes, `sendBody`,
  `sendForEsign` (marks the contract Sent), the signed-copy link, and `esignProblem` for her
  messages. Plus eight `cloudApi` wrappers.
- **New `data/esignTemplates.js`:** each template's kind is a `contract_forms` row
  `{ provider: 'firma', template_id }` on an "E-sign (Firma)" Form service account, made on
  first use. `contractForms.cleanForms` keeps such rows without a link.
- **Send for signature:**
  - The Contract page offers her templates (marked E-sign). Firma emails the signer, or she
    sends the link herself.
  - Pick to send sends a template on step 2, and its link goes in her message.
  - **Signed copy** on the Contract page.
- **Events:** `contract.expired` and `contract.cancelled` become Today reviews.
- **New field `esign_ref`** on Contract (cloud tier; `cloudFields.js` regenerated).
- **Accounts page:** a Firma row's type and label can be edited. It shows **Manage**, and no
  link.
- **Worker:** `/esign/editor` (+ `.js`, `.css`) from `public/esign/`, sandboxed with no
  `allow-same-origin`. The page stands in memory storage and Locks for Firma's script (it
  needs them, and a sandboxed page refuses them). Checked in a browser that the script loads
  and calls Firma inside the sandbox.
- **Fixed in passing:** Pick to send's Continue re-enabled its button through
  `e.currentTarget` after an await (always null by then).
- **Tests:** `tests/esign.test.js` (7: the rows, the reviews, and end to end against the
  Worker with a fake Firma: set up, upload, type, send, send again, signed back, the limit),
  and one Worker test for the editor page.
  - `node --test` 1716 pass. `cd cloud && npm test` 319 pass. `node build/assemble.mjs`
    succeeds.
  - Checked in a browser: Contract templates signed out, set up, the list, typing a template
    and the Accounts card.
- **Docs:** End-State guide §32 "E-sign through Firma", plan §2.3a "As built: the app" and
  D31, `cloud/README.md`, the launch checklist (the production run), README Status.
- **Precache:** `assets/esignUI.js`, `data/cloud/cloudEsign.js` and `data/esignTemplates.js`
  added to `shared/sw.js` (`esignUI.js` also to `proPages.js`). Service-worker cache bumped to `v118`.

## 2026-11-12: Firma countersign and signed PDFs (plan only)

`docs/KennelOS_Integrations_Plan.md` §2.3a "Planned: her countersignature and the signed PDFs",
new **D32–D33**. Nothing built.
- **D32:** she signs second in the same Firma request, at no extra credit, from a Countersign
  button on the Contract page. This applies to templates marked as needing her signature.
- **D33:** KennelOS copies the signed PDF to R2 when Firma reports completion and makes it
  available to buyers. This replaces the on-demand fetch proposal.
- Open: her signing email, and whether Firma's emails and events can be set per signer. Also
  open: how buyers reach the PDF and how long it's kept. docs.firma.dev wasn't reachable from
  the session, so the Firma questions wait for the docs or a test send on staging.
- README Status updated.

## 2026-11-12: Firma countersign (D32)

`docs/KennelOS_Integrations_Plan.md` §2.3a "As built: her countersignature". Owner decisions:
she signs as her cloud account's email; buyers will get the signed PDF as an emailed link
(D33, not built).
- **Contract templates:** an **I countersign** tick per template, stored as `countersign: true`
  on its `contract_forms` row (`contractForms.cleanForms` keeps it, and a retype keeps it).
- **Send:** `cloudEsign.sendBody` adds `countersigner { name, email }` (her account email,
  named for her kennel). The send dialog says she countersigns, and refuses with no account
  email on the device.
- **Worker:** `POST /integrations/esign/send` puts her as the second Signer (`order: 2`) of the
  same request, so it's one credit. It refuses her email as the buyer's.
- **Worker:** new `GET /integrations/esign/countersign?ref=` returns her own signing link from
  Firma's recipient list, never kept.
- **Contract page:** **Countersign** while Sent on a contract with the new field
  `esign_countersign` (cloud tier; `cloudFields.js` regenerated). It stays Sent until Firma's
  completed event, which comes once both have signed.
- **Tests:** Worker `esign.test.js` +1. App `tests/esign.test.js` +2: the row flag, and end
  to end with her as second signer, her link, refusals, and Signed.
  - `node --test` 1719 pass. `cd cloud && npm test` 320 pass. `node build/assemble.mjs`
    succeeds. Not checked in a browser: the button needs a signed-in Pro cloud session with
    Firma.
- **To prove on the first production run:** how Firma maps the two recipients to the
  template's signer roles, and its per-signer email and events (docs.firma.dev unreachable).
- **Docs:** End-State guide §32, plan §2.3a and D32–D33, `cloud/README.md`, the launch
  checklist, README Status. No new files, so no precache change.

## 2026-11-12: Firma signed copies kept and emailed to buyers (D33)

`docs/KennelOS_Integrations_Plan.md` §2.3a "As built: the signed copies". Owner decisions: a
tick box per template; buyers get an emailed link.
- **Contract templates:** an **Email the buyer the signed copy** tick beside I countersign,
  stored as `keep_copy: true` on the `contract_forms` row. `sendBody` sends `keepCopy` and her
  kennel's name, and the send dialog and the after-send note say so.
- **Worker, migration `0023_esign_copies`:** new `esign_sends` columns `keep_copy`,
  `kennel_name`, `copy_status`, `copy_key`, `copy_bytes`, `copy_tries`, `copied_at` and
  `emailed_at`.
- **Worker:** Firma's completed webhook queues a kept copy.
- **Worker, `runEsignCopies` (hourly cron):** copies the PDF to R2
  (`esign/<program>/<id>.pdf`), then emails the buyer a link (new `mail.js`
  `sendSignedCopyMail`, mail kind `esign`). The buyer's email is read from Firma's recipient
  list and never stored. A failed step is retried hourly for two days.
- **Worker:** `GET /signed/<id>/<mac>` serves the copy. The mac is an HMAC of the id, so
  nothing more is stored. `/integrations/esign/document` returns that link when a copy is
  kept, so her Signed copy opens the same one.
- **Worker:** retention keeps rows with a kept copy, and account deletion removes
  `esign/<program>/`.
- **Privacy policy:** `site/privacy.html` §9d and the retention list name the kept copies and
  the email, for the owner to review.
- **Tests:** Worker `esign.test.js` +2: the whole path; no buyer email; partial PDFs; giving
  up. App `tests/esign.test.js` +2.
  - `node --test` 1723 pass. `cd cloud && npm test` 322 pass. `node build/assemble.mjs`
    succeeds. Not checked in a browser (it needs a signed-in Pro cloud session with Firma).
- **To prove on the first production run:** Firma's recipient list carries `email`; the
  download link is fetchable without a key; whether Firma's own completion email can be
  turned off.
- **Docs:** End-State guide §32, plan §2.3a and D33, `cloud/README.md`, the launch checklist,
  README Status. No new app files, so no precache change.
- **Service-worker cache bumped to `v119`** (countersign and kept copies ride it).

## 2026-11-12: Set up e-signing named a linked outside kennel

- **Bug:** Contract templates' **Set up e-signing** prefilled the first kennel on record with
  a name. For a breeder whose linked outside kennel sorts first, that was the other kennel's
  name (seen during a support session).
- **Fix:** new `esignTemplates.signingKennel` picks the kennel she's working in, else My
  kennel, else any own kennel that isn't archived. It never picks an outside kennel.
- Sends were never affected: they take the contract's own kennel.
- **Tests:** `tests/esign.test.js` +1. `node --test` 1724 pass.
- **Service-worker cache bumped to `v120`:** `v119` had already shipped without this fix.

## 2026-11-12: Contracts fill an estimated pickup date

- **Asked:** a breeder looked for an estimated pickup date among her Firma template's fields.
  There wasn't one.
- **Added:** the `pickupDate` fact for sale forms, used by Firma templates and pasted form
  links alike. It's `goHome.expectedPickupDate`: the pup's next pickup for that family on the
  calendar, else its latest, else the litter's ready date (whelp + 56 when no estimate).
  `contractSend.gatherContractFacts` reads the pup's events and litter for it.
- Firma's editor offers it the next time she opens **Place fields**, which re-syncs the custom
  fields. The Accounts page's field list shows it too.
- **Tests:** `goHome.test.js` +1, `pickToSend.test.js` +1, `contractForms.test.js` (one more
  assertion). `node --test` 1726 pass.
- **Docs:** End-State guide §32 (Contract forms and e-signature). No new files, so no precache change.
- **Service-worker cache bumped to `v121`** (the pickup date rides it).

## 2026-11-12: A Firma refusal showed "Cloud request refused (esign_refused)."

- **Bug:** the Worker sends Firma's reason as the body's `code` beside `error: 'esign_refused'`.
  `CloudError` copied the body over its own `code`, so `esignProblem` never matched and showed
  the raw message, without Firma's reason (seen on a countersigned Boarding Clause send).
- **Fix:** `CloudError` keeps a body's `code` as `providerCode` and never lets it replace the
  Worker's code. `esignProblem` names Firma's code, mentions the countersigner's signature
  field, and words `RECIPIENT_EMAIL_SUPPRESSED` on its own. App-only: no Worker change.
- **Tests:** `tests/esign.test.js` +1 (the fake Firma refuses). `node --test` 1727 pass,
  `cd cloud && npm test` 322 pass.
- **Service-worker cache bumped to `v122`:** `v121` had already shipped without this fix.

## 2026-11-12: Firma templates' prefilled fields came out empty

- **Seen (first real sends):** fields placed with Prefilled Data set to a KennelOS fact
  stayed empty. A template with a second signer and prefilled fields was refused, whether
  or not "I countersign" was ticked.
- **Firma's docs (Field Prefilling):** a field fills from `format_rules.prefilledData`, a key
  of the assigned recipient's `custom_fields`, matched case-insensitively. A required,
  read-only custom-field prefill blocks the send when its recipient lacks the key. Fields made
  from a template custom field carry an internal identifier.
- **Likely cause:** the editor stores Firma's own id for the custom field, not the
  `field_name` KennelOS sends. Firma keeps our `field_name`: re-syncing never duplicated a
  label.
- **Change (Worker):** `sendForSignature` reads the workspace's custom fields and sends each
  fact under every id its row carries as well (`firma.withFieldAliases`). The countersigner
  gets the same values. The log now names a refusal's Firma code, and the keys (no values)
  of prefilled fields a sent request left empty (`firma.emptyPrefills`). That confirms the
  cause on the next send if the guess is wrong.
- **Tests:** `cloud/tests/esign.test.js` +2. `cd cloud && npm test` 324 pass, `node --test`
  1729 pass.
- **Docs:** End-State guide §32, Integrations plan §2.3a (a **Modified:** note).
- **Not proven yet:** which identifier the editor stores. Needs a real send and the Worker log.
- Worker only. The app is unchanged, so no service-worker bump.

## 2026-11-12: Firma's editor names a custom field `custom_workspace_<id>`

- **Seen (production log after #198):** `firma: prefilled fields left empty
  custom_workspace_aecb2afb-…`. The editor stores the workspace custom field's id with a
  `custom_workspace_` prefix. #198 sent the bare id, so the field still came out empty.
- **Change (Worker):** `firma.withFieldAliases` also sends each fact as
  `custom_workspace_<id>` (`WORKSPACE_FIELD_PREFIX`). The empty-prefill log now marks each key
  "sent" (sent, still empty: no value, or a Firma-side issue) or "not sent" (a name KennelOS
  doesn't know).
- **Tests:** `cloud/tests/esign.test.js` (the production key). `cd cloud && npm test` 324 pass.
- Worker only, so no service-worker bump.

## 2026-11-12: A template deleted in Firma stops being offered

- **Seen:** a template deleted in Firma's editor left Contract templates but was still offered
  by Send for signature (the Contract page and Pick to send). The list in Contract templates
  comes from Firma; the send pickers read the template's saved `contract_forms` row, which
  nothing removed.
- **Change (Worker):** `GET /integrations/firma/templates` adds `complete` (fewer than its
  page of 100). `POST /integrations/esign/send` reads the template with her key first: a 404
  is `404 template_missing`, before a place in the month's count is reserved. A 404 from
  Firma's send frees the place and answers the same.
- **Change (app):** `contractSend.loadContractForms` asks `cloudEsign.liveTemplateIds` (a
  complete list only, else null) and drops the missing templates, forgetting their rows
  (`esignTemplates.forgetMissingTemplates`). Contract templates does the same when it opens.
  A `template_missing` refusal forgets that template (`forgetTemplate`) and says so.
- **Tests:** `tests/esign.test.js` +1, `cloud/tests/esign.test.js` +1 (the fakes treat a
  template as there unless deleted). `node --test` 1731 pass, `cd cloud && npm test` 325 pass.
- **Docs:** End-State guide §32, Integrations plan §2.3a.
- Worker and app. No new files. SW cache not bumped yet.

## 2026-11-12: Her signature name, and a contract's payment table

- **Signature name (owner decision: cloud tier).** `Kennel.esign_signer_name` (one per own
  kennel, **Your signature name** in Contract templates) and a template's own **Signs as**
  (`signer_name` on its `contract_forms` row, shown when I countersign is ticked).
  `esignTemplates.signerNameFor`: the template's, else the kennel's, else the contact linked
  to the kennel, else the kennel's name. Before this she always signed as the kennel's name.
  The Send dialog shows the name. `cloud/src/lib/cloudFields.js` regenerated.
- **Payment table fields** (sale contracts): `waitlistFeePaid` (the fee actually received
  from the family on this sale, each entry's own amount; 0 outside the waitlist),
  `waitlistFeeCredit`, `otherPaymentsReceived` (a paid balance, or received funds left
  after the deposit: never counted twice), `purchaseBalanceDue` (the price only).
  `incomeView.priceTable` / `getPriceTable`; `contractSend.gatherContractFacts` adds
  `priceTable`. `price` already carries the Full surcharge (it's in the sale's price).
- **Open:** her sister to confirm Balance Due is the price only, and how the table should
  read when the waitlist fee is credited toward the deposit.
- **Tests:** `tests/priceTable.test.js` (new, 6), `tests/esign.test.js` +1. `node --test`
  1738 pass, `cd cloud && npm test` 325 pass.
- **Docs:** End-State guide §2 (Kennel), §32; Integrations plan §2.1a, §2.3a.

## 2026-11-12: A sale's separate agreements: transport, delayed pickup, one per extra

- **Asked:** her sister sends a separate agreement for transport, for delayed pickup, and
  for each extra she sells (her extras are training packages, boarded in place of standard
  boarding, with their stay logged as a linked boarding event).
- **Change:** `CONTRACT_FORM_TYPE` gains `transport`, `boarding`, `extra` (`addOn`). An Extra
  agreement's row names its price-list extra (`extra_list_id`), picked beside the type on the
  Accounts page and in Contract templates. New pure `data/contractAddOns.js` (`addOnFacts`,
  `extraFor`, `extraPayments`, `extraChoices`, `extraOptionsHtml`); `gatherContractFacts`
  adds `addOns`; `prefillValues` takes the form. `rankForms` offers a separate agreement
  first only when the sale has its charge. 34 new field names (84 in all; a send carries at
  most about 61).
- **Tests:** `tests/contractAddOns.test.js` (new, 4); `tests/esign.test.js` updated.
  `node --test` 1742 pass, `cd cloud && npm test` 325 pass. Checked in a browser: the
  Accounts page's form row shows Which extra with the saved one.
- **Not checked:** the Contract templates window in a browser (needs a cloud sign-in).
- **Docs:** End-State guide §32, Integrations plan §2.1a. New file in `PRECACHE_URLS`.

## 2026-11-12: Preview a Firma contract before sending

- **Asked:** a preview against the real template with the fields filled in.
- **Change (Worker):** `POST /integrations/esign/preview` (the send's body, `parseSend`, shared
  with `sendForSignature` along with `requestBody` and `templateThere`): a draft signing
  request and a `/jwt/generate-signing-request` token; nothing stored or counted.
  `DELETE /integrations/esign/preview?id=` deletes it only while Firma says it's a draft.
  The editor page opens `#t=…&sr=…` in Firma's signing request editor, read-only.
- **Change (app):** the Send dialog's **Preview** (`cloudEsign.previewLink`, opened in a new
  tab); its drafts are discarded when the dialog closes (`discardPreview`).
- **Unproven** (Firma's docs unreachable from the session; owner pasted the embed guide): a
  draft is free, the read-only editor shows prefilled values, DELETE on a draft. On the
  launch checklist.
- **Tests:** `cloud/tests/esign.test.js` +1, `tests/esign.test.js` +1. `cd cloud && npm test`
  326 pass, `node --test` 1744 pass.
- **Docs:** End-State guide §32, Integrations plan §2.3a, launch checklist.

## 2026-11-12: Deposit due (less application fee)

- **Asked:** her sister's table is now Total purchase, Deposit, Deposit due (less application
  fee), additional credits, Balance due at pickup (the waitlist fee rows go).
- **Change:** `depositDue` (`incomeView.priceTable`): the deposit less the fee credited toward
  it and the received funds the allocation puts on it (each credit's Applies to). The fee
  comes off the deposit only with her waitlist setting "A credited fee counts toward:
  Deposit". `otherPaymentsReceived` is relabelled "credits and payments toward the balance".
  With the fee toward the deposit the table adds up: price = deposit + credits on the balance
  + balance due.
- **Tests:** `tests/priceTable.test.js` +1. `node --test` 1745 pass.
- **Docs:** End-State guide §32, Integrations plan §2.1a.

## 2026-11-12: A fee not on the deposit is an additional credit

- **Change:** `incomeView.priceTable`'s `otherPaid` (`otherPaymentsReceived`) adds the credited
  fee's part not taken off the deposit (her setting toward the balance, or a fee above the
  deposit). Her table now adds up in every case: price = deposit + additional credits +
  balance due. A credit that paid the fee counts once, as the fee (the allocation spends that
  share on it; `fee_credit_amount`).
- **Tests:** `tests/priceTable.test.js` +1 (six cases). `node --test` 1746 pass.

## 2026-11-12: Contract sending made simpler: fewer fields, one home per setting, a record per agreement

- **Asked (owner, after a review of the six commits above):** users struggle with settings in
  many places that touch automatic logic they can't see. Simplify through the backend, labels
  and consolidation, not explanatory copy. Drop `waitlistFeePaid`, `waitlistFeeCredit`,
  `transportMethod`, `deliveryTime`, `goHomeFrom`. Boarding and training agreements use
  `pickupDate`; prompt for a pickup when one isn't logged.
- **Fields:** the five are gone (80 fact names). `priceTable` returns `{ depositDue,
  otherPaid, balanceDue }` and no longer reads entries; `getPriceTable` is gone
  (`gatherContractFacts` reads the sale's credits once for it and `balanceDueOn`).
  `depositDue` now reads the same before and after the deposit is marked paid (it used the
  ledger's unpaid-only credit marker, so a credit on the deposit vanished once it was paid).
  Its label is under Firma's 100 characters.
- **Pickup date:** `contractAddOns.pickupToSet`: a boarding agreement, or an extra the pup
  stays for, sent with no pickup on the calendar asks for the date (the day after the
  boarding or last stay ends offered), and `contractSend.logPickup` logs it. Contract page
  and Pick to send.
- **A record per agreement:** `contractSend.contractForForm` (`contractForms.agreementKey`).
  Sending a second agreement from one contract record used to need "Send it again?", and the
  first one signed marked the record Signed. Each agreement now goes out on its own record,
  made when needed.
- **One home, one pick:**
  - A form's kind is one dropdown: her types, and each extra by name
    (`formKindOptionsHtml` / `readFormKind`), in place of a type and a second "which extra".
  - E-sign template rows are display-only on the Accounts page; saving there keeps them as
    stored. It used to drop `countersign` and `keep_copy` (so on `main` too).
  - The per-template `signer_name` is gone (never on `main`): one **Countersign as** per own
    kennel (`Kennel.esign_signer_name`).
  - `extraCharges.chargeFromPriceList` builds a price-list charge for the Sale page, Kels's
    Prep pups and a family's approved request. Prep pups copied only the name and price, so
    its extras had no stay nudge and no Extra agreement offered.
  - `addOnApplies` matches an extra the way the form fills (`extraFor`), given the sale's
    `addOns`; the picker lists the sale's own contract forms before its separate agreements.
- **Labels:** "Boarding agreement", "Extra agreement" (the bracketed note reached a buyer's
  deposit-request message).
- **Worker:** a send read the template from Firma twice (a leftover of the preview refactor);
  once now.
- **Preview:** a draft that comes back after the Send dialog closed is discarded at once.
- **Left open:** the preview token isn't read-only (Firma's `readOnly` is an editor option),
  and drafts left by a closed tab aren't swept; the template list's `complete` trusts a page
  of 100. Firma's docs weren't reachable from the session.
- **Checked in a browser** (sample data): the Accounts form's rows and save, the picker's
  order, the pickup prompt and its event. Contract templates needs a cloud sign-in: not
  opened.
- **Tests:** `tests/priceTable.test.js` rewritten (7), `tests/contractAddOns.test.js` +3,
  `tests/esign.test.js` +1, `tests/extraCharges.test.js`, `cloud/tests/esign.test.js`.
  `node --test` 1748 pass, `cd cloud && npm test` 326 pass.
- **Docs:** End-State guide §21.2, §32; Integrations plan §2.1a, §2.3a.

## 2026-11-12: A preview holds a place in the month; cache v123

- **Why:** a preview's token isn't read-only (Firma's `readOnly` is an editor option), so for
  7 days it could send the draft from Firma's own editor, outside her count; and a draft left
  by a closed tab was never discarded.
- **Change (Worker, no migration):** a preview is an `esign_sends` row with status `preview`.
  `usage` and `/ops` leave it out; a new preview and a send's reservation count it (`HELD`),
  so sends plus open previews never pass her limit. `settlePreview` deletes the draft and
  frees the place, or counts a draft found sent; an unknown answer keeps the place until the
  token is dead (8 days). It runs before each preview and send (one preview at a time), on
  the device's discard, and hourly for previews over an hour old (`runEsignPreviews`).
  `discardPreview` only touches a preview this program made.
- **Unproven:** Firma's status words (`draft`; a sent request's). An unknown word is logged
  and never counted. On the launch checklist.
- **Service worker:** `CACHE_NAME` v123 (owner asked), for the app changes since v122.
- **Tests:** `cloud/tests/esign.test.js` +3. `cd cloud && npm test` 329 pass, `node --test`
  1751 pass.
- **Docs:** End-State guide §32, Integrations plan §2.3a, launch checklist.

## 2026-11-12: She can sign first

- **Why (owner):** one breeder signs her contracts before sending them. The template's
  **I countersign** tick becomes one choice of three: **I sign first / I sign last / I don't
  sign**. A new template starts with her last choice (owner decision), else I don't sign.
- **App:** a Firma `contract_forms` row adds `countersign_first: true` (only with
  `countersign`; a row without it reads as last, so older builds read a first-signing row as
  last). `esignTemplates.signsOf` / `signsDefault` / `SIGNS`; `withTemplateRow` and
  `setTemplateType` take `signs` (the older `countersign` still works). The choice is kept on
  the E-sign (Firma) account as `esign_signs_default` (cloud tier). `countersignerFor` adds
  `first`; the contract keeps `esign_countersign_first` (cloud tier) and shows **Sign first**
  instead of **Countersign**. Send dialog, sent message and composer hint say so.
- **Worker (migration 0024):** `esign_sends.countersign_first`. Signing first, she is
  `order: 1` and the buyer `order: 2` (`firma.signerOrders`), recipients sent in order. The
  buyer's link returned is the buyer's place (not Firma's `first_signer`); her link
  (`/integrations/esign/countersign`) and the kept copy's buyer email find each by place.
- **Unproven:** that Firma holds the buyer until she has signed, and when it emails the
  buyer. On the launch checklist.
- **Tests:** `tests/esign.test.js` +3, `cloud/tests/esign.test.js` +1. `node --test` 1755
  pass, `cd cloud && npm test` 330 pass.
- **Docs:** End-State guide §5 (Account), §32; Integrations plan §2.3a, D32; launch
  checklist; README Status; `cloud/README.md`.
- **Service worker:** `CACHE_NAME` v124 (owner asked). Migrations `0022`–`0024` applied on
  production (owner).

## 2026-11-12: Kels's defects from the review, and what her forms didn't ask

- **From the review (`docs/review/findings/`; K11, Kels's own session, hasn't run):**
  - **K6-5:** Review my waitlist ranks and numbers families from `getMapForKennel`, archived
    programs included, as every other reader; its program picker still offers live ones only.
  - **K8-5 (Kels's part):** her drop-off address form has **Open in Maps**, and a failed
    measure says to use it.
  - **K9-3 (Kels's part):** Record the birth on an Expected litter no longer prefills its
    placeholder whelp date as the birth date; a ready date that was just whelp + 8 weeks
    follows the real birth (`guidedLitter.refreshReadyDate`). The litter check-in's picker
    shows an Expected litter as due on its breeding's due date. The root (litter.js dating
    a litter made from its pairing today) is not in this batch.
  - **K9-4:** a heat with no end date counts as over 21 days after it started
    (`nudges.HEAT_OPEN_DAYS`) for `heatpair`.
  - **K9-12:** Prep pups' "add them as a co-owner" makes the pup Co-owned too
    (`goHome.deliveredOwnershipChanges`).
  - **K12-10:** the Stripe key steps always open Stripe's API keys page; her saved website,
    made a full address, is a second link.
  - **K13-7:** Lite's Live-Birth Summary imported two Pro-only modules. It reads only shared
    ones now (its own loader; `liveBirthFigures` moved to `reportMath.js`, re-exported by
    `reportFigures.js`) and hides ← All reports in Lite. Kept in Lite, as guide §31 says.
    New `tests/liteImportGraph.test.js`: no page Lite keeps reaches a Pro-only file by a
    static import (it fails on the old page).
  - **K13-8:** Kels's Find in Demo leaves out the pages the Demo build drops.
    `DEMO_EXCLUDED_PAGES` moved to `proPages.js` (`isDemoExcludedPage`); `assemble.mjs` reads it.
  - **K13-14:** Record a litter checks Lite's litter cap before writing anything, so a refused
    litter no longer leaves a new parent behind (no test: the cap hook is Lite's module).
  - Already fixed before this batch: K6b-3 (waitlist fixes step 1).
- **Asked (owner):**
  - **Add dogs** asks what the Dog page needs: statuses are the Dog page's by edition
    (Puppy added everywhere, External reference in Pro). A puppy is asked its plan
    (disposition, required; Placed comes from a sale) and intended registration. An external
    reference is asked its owner (picking it sets whose dog to External; one marked hers is
    refused). A co-owned dog is asked its co-owner (a contact or a new name, required) and
    Lives with. Saved as `co_owner_contact_ids` / `lives_with_contact_id` /
    `disposition` / `intended_registration`. Contacts load in Lite too (co-owners).
  - **Logging forms:** the litter check-in's care forms (shots, deworming, medication, vet
    visit; also Prep pups') and the dog check-in's preventatives ask a title of their own
    beside the named thing (a blank title still takes the name). A type with a related
    contact (vet visit, surgery, boarding, show) picks it from her contacts, those with the
    role first (`vocab.RELATED_CONTACT_ROLE`, moved from `eventForm.js`), or **Someone
    new…**, made with the role, in place of the typed vet name, as the event form does. The
    dog check-in's event form adds Notes and Remind me on.
- **Found looking for more:** Kels's add-a-family (`kelsApplicant`) never checked the
  do-not-sell list; it now warns first, and a second tap adds them anyway.
- **Tests:** `guidedDogs` +2 (and the edition statuses), `guidedLitter` +1, `dogCare` +1,
  `litterCheckin` +1, `linkedStatusNudges` +1, `kelsFind` +1, `liteImportGraph` (new).
  `node --test` 1759 pass; `node build/assemble.mjs` succeeds. Checked in a browser (sample
  data): Add dogs' puppy, external reference and co-owned answers, and the vet visit form's
  vet picker.
- **Docs:** End-State guide §0 table, §31, §33 (Add dogs, Record a new litter, Check in on my
  dogs, the applicant step, Prep pups' registration, Review my waitlist). No new app files,
  no schema or field changes. SW cache not bumped.

## 2026-11-12: Screening tests, and Kels's care step (enter it once, for every dog)

- **Includes** the unmerged `claude/kels-scripts-defects-mmhmwz` batch above (owner asked),
  squashed into this one commit.
- **Why (owner):** a routine fecal or heartworm test had nowhere to go but a vet visit's
  free text, and Kels's health flows asked for each kind of care, dog by dog, one form at a time.
- **New event type `screening_test`** (vocab): `test` (suggests `SCREENING_TESTS`: Fecal,
  Heartworm, 4Dx, Giardia, Brucellosis, Bloodwork, Urinalysis), `result` (Negative /
  Positive), Normal or abnormal, the vet (`relatedContact`, role vet). Not a health test
  type (planned tests, waitlist results, Dog Cards stay breeding clearances). Veterinary
  expense; on the Puppy Record (own toggle); Kels's "<dog> vet" answer. Not on family pages
  or the portal (open question for the owner). Event `details` keys classify from vocab:
  `cloudFields.js` regenerated.
- **The care step** (`assets/careVisitUI.js` + `data/careVisit.js`, new): "What did they
  have?" ticks (a vet visit, shots, screening tests, deworming or flea & tick, other
  medication) with one date, the dogs and the vet; the visit saves there (cost, vet summary),
  then each ticked kind's form arrives filled in. **Shots** are a checklist
  (`VACCINE_CHOICES` + Other, each with next due, `VACCINE_NEXT_DUE`) → one vaccination per
  shot per dog, reminders on. **Screening tests**: ticks with a result for all and
  **Different for each dog**.
- **Where:** Check in on my dogs' step 2 (replaces Vet visits, now before the preventatives,
  so one given at the vet counts); vaccinations and medication leave its "Any other events"
  list. Check in on a litter's **Health care** runs it (pups ticked, shots due in 3 weeks).
  Pups are going home's shots fix uses the shots checklist. Log health test results offers
  **A screening test** for the dog. `litterCheckin.CARE_KINDS` keeps only preventative and
  medication; `careForm` moved to the care step.
- **Tests:** `tests/careVisit.test.js` (new); `dogCare`, `litterCheckin` updated. Checked in
  Chromium at phone width: the dog check-in (visit + shots + per-dog fecal + preventative for
  two dogs), the litter's Health care, Log health test results' screening test.
- **Titles kept apart from the named thing** (the batch above's logging-forms fix): the
  care step's vet visit and each ticked shot and screening test ask an optional title of
  their own beside the reason, vaccine or test; blank takes that name (`dogEvents`,
  `NAME_KEYS.screening_test = 'test'`). Preventative and medication forms keep theirs.
- **Docs:** End-State guide §(event types), §33 (the care step, Check in on my dogs, Log
  health test results, Check in on a litter, Pups are going home, Kels's shots and vet).
  New app files in `PRECACHE_URLS`.
- **Service worker:** `CACHE_NAME` v125 (owner asked), for this batch and the one above.

## 2026-11-13 — Payment schedules on a sale (plan only)

- **New plan:** `docs/KennelOS_Payment_Schedule_Plan.md`, nothing built. A sale gets a general
  `payment_schedule` (due dates by age, a typed date, before pickup or at pickup; each covers
  some or all charges as percent of total, percent of remaining, or an amount that earlier
  money can or can't cover) and `payments[]`. One pure statement (`data/paymentSchedule.js`)
  feeds every money surface: Sale and applicant pages, invoices and receipts, contracts, the
  family's page, Companion, messages, Financials, Today. No schedule = today's behavior.
- **Found while planning:** a receipt for a paid deposit prints $0 in Full mode, and the
  deposit receipt is missing from the applicant page when the application fee is credited
  toward the deposit. The plan's receipts print only recorded money, with regression tests.
- **Owner decisions D1–D19** (plan §10), among them: extras can be flagged to keep their own
  dates outside the schedule; money pays price → boarding → extras → transport (always last);
  the "adjust the schedule?" prompt shows every time a fee is added; credits label as
  "Deposit (credited)"; the generator works per family and includes the application fee;
  8 new contract prefills; Firma fields relabelled by group now and created per template,
  labelled by contract type, after a test-key check.
- **D20:** money carried from a lost pup becomes a credit for funds received instead of the
  next sale's whole deposit. **D21:** a credit is held money; a charge it covers is earned on
  that charge's due date (today's code dates it by the family's oldest credit).
  Found: the deposit-received dialog, picks and side sales with carried money set the
  deposit date from the credit's date; the plan has them use the ask/received date.

## 2026-11-13 — Payment schedules, step 1: the calculation

- **`data/paymentSchedule.js` (new, pure):** cleans a sale's `payment_schedule`, dates due
  dates (birth date, pickup, typed), lists the sale's charges in pay order (transport last),
  spreads money over charges (fee credit, credits, deposit, own-dated steps, payments, paid in
  full) and over due dates (the four kinds; "doesn't count" ones take only payments), and
  returns one statement. Not wired to any page yet; no sale stores the new fields.
- **Credits on the shared allocator:** `receivedCredits.allocateCredits` now calls
  `allocateMoney`; `incomeView.saleCreditCharges` orders charges deposit, price, boarding,
  extras, transport (D16; transport was second after the price before).
- `extraCharges.saleExtraCharges` keeps `own_due_dates`. Vocab `SCHEDULE_DUE`,
  `SCHEDULE_COVERS`, `SCHEDULE_BASIS`, `SCHEDULE_PRIOR_FUNDS`.
- **Tests:** `tests/paymentSchedule.test.js` (new): 24 tests, one a 40,320-combination check
  that the statement adds up. Full suite 1,791 passing; editions build.
- **Docs:** guide §21.2 (own-dated flag), §21.3 (new), §29 credits (order, shared allocator).
- **Service worker:** `data/paymentSchedule.js` in `PRECACHE_URLS`. No `CACHE_NAME` bump.

## 2026-11-13 — Payment schedules, step 2: the sale's Payments card, editor and payments

- **Owner decisions D22–D24** (plan §10): nothing is marked paid on its own (one question
  offers the paid-in-full date and status); no default schedule, every schedule added on
  purpose; with a schedule, the Sale form shows the final payment's date in place of the
  Balance due date box.
- **Data:** Sale `payment_schedule`, `payments`; Kennel `payment_schedules`,
  `final_payment_methods`; `own_due_dates` on price-list rows (true/false) and groups (true),
  copied onto a sale's charge by `chargeFromPriceList`; all private. `payments[].account_id`
  guards an Account (`referenceRegistry` scans now step into a list: `list[].key`).
  `paymentSchedule.js`: `scheduleProblem`, `readSchedule`, `savedSchedules`,
  `readSavedSchedules`, `scheduleFromSaved`, `newPayment`, `paymentsWith`, `addedFees`,
  `paidInFullOffer`, `finalDueDate`; payments toward an own-dated step are paid before the
  step's own paid date, so one that also marked it counts once. `incomeView.getSaleStatement`
  loads a sale's statement with its dates and credits.
- **UI (`assets/paymentScheduleUI.js`, new, all editions):** the Payments card, the schedule
  editor (rows by age, date, before pickup, at pickup; covers; four kinds; live previews;
  start from a saved schedule; remove), Record a payment (Edit, Remove), the paid-in-full
  question, and the new-fees question after any save that adds a transport fee, boarding or
  an extra.
- **Pages:** Sale page (Payments section; the form's final payment date), waitlist family
  page (Details tab card; every action there checks for new fees), Kennel page (Payment
  schedules section; price list "Paid on its own dates").
- **Sample data:** Cedar's sale has a two-date schedule; Thornfield has a saved schedule,
  final-payment methods, and Photo packages paid on their own dates.
- **Fixed while checking:** the schedule vocab sat between `INVOICE_LINE_LABELS` and its
  comment (step 1); picking a saved schedule wired the editor twice; a new schedule's final
  row started at pickup instead of the sale's balance due date, replacing her date on save.
- **Checked** in Chromium at phone width, Pro and Lite: the card, editor, previews and
  errors, payments, paid in full, the new-fees question on the Sale and family pages (extras
  approved), saved schedules and the price list choice. No console errors.
- **Tests:** `tests/paymentScheduleData.test.js` (new), `paymentSchedule` and `extraCharges`
  added to. Full suite 1,805 passing; editions build.
- **Docs:** guide §4.1 (Sale, Kennel), §0, §21.2, §21.3; Editions plan (Lite scope); plan D22–D24.
- **Service worker:** `assets/paymentScheduleUI.js` in `PRECACHE_URLS`. `CACHE_NAME` v126
  (owner asked, to merge steps 1–2), for this batch and step 1.

## 2026-11-13 — View their page (a family's live status page, as they see it)

- **Owner asked** for a button on each family's page showing what their status page shows
  them; both phases at once, on the Interact tab, publishing first (forced).
- **App:** Interact's **View their page ↗** (`waitlist-entry.js`, shown with
  `statusLinkFor`), `waitlistUI.openStatusPage` (tab opened at the tap, then pointed at the
  page; notes for a publish that didn't work or a plain link), `cloudWaitlist.statusPagePreview`,
  `syncWaitlistOnline({ asked })` (publishes from a tab that just went behind the new one),
  `cloudApi.previewWaitlistPage`.
- **Worker:** `POST /waitlist/preview` (`waitlist.previewStatusPage`, `previewUntil`,
  `PREVIEW_MS`): a signed, hour-long preview per status token, no table, no migration.
  `GET /f/status` adds `preview: { until }` for a live one and doesn't stamp `last_used_at`.
- **Family page:** `status.js` reads `#preview=` and sends it as `x-status-preview`; with it
  the page draws signed in under a Preview note and every send stops at "nothing was sent";
  an ended one says so. `common.fetchJson` takes `headers`.
- **Checked** in Chromium on the local Worker (`cloud/tests/helpers/serve.mjs`): the signed-in
  turn card, Choose → "nothing was sent" with no event on the server, an ended preview.
- **Tests:** `cloud/tests/familyPages.test.js` (preview signed per page, ended, forged, not a
  visit, never acts; who may ask), `tests/cloudWaitlist.test.js` (forced publish then
  preview; not online, signed out, background tab). Cloud 332, app 1,809 passing; editions build.
- **Docs:** guide §29 (Surfaces, Online), `cloud/README.md`.
- **Service worker:** no app file added or renamed. `CACHE_NAME` v127 (owner asked).

## 2026-11-13 — Payment schedules, steps 3–4: Financials and invoices on the statement

- **Owner decisions D25–D28** (plan §10): a family in the generator is a waitlist entry and
  its one sale, or a sale no entry claims; credit-covered money isn't in Receivables
  (anticipated in Financials until its due date; undated, earned once received / paid in
  full); no per-line Due by edit; `paidOnSale` counts recorded payments now.
- **Pieces:** `paymentSchedule.chargePieces(statement)` splits each charge by due date with
  the money on it and what's owed; due dates keep `from` (which money filled them), the
  deposit `asked`.
- **Step 3 (income):** `incomeView.ledgerComponents` reads each sale's statement:
  money earned on its own date (payments on theirs), what's owed anticipated on the due date
  that needs it (`due`, `due_id`); a credit's share earned on the covered charge's due date,
  never the credit's date (D21). `getIncomeRows` loads the statement's inputs once for all
  sales (`statementOpts`, shared with `getSaleStatement`). Receivables: one row per sale
  and due date, credited money left out, "For" lists what it's for. Financials' Anticipated
  box: one row per due date with a Due by column.
- **Fixed:** `paidOnSale` ignored recorded payments (the lost-pup carry-over and a
  contract's balance due were short since step 2); found while testing, a kept extra with
  nothing paid on a released sale would have dropped out of income.
- **Changed on purpose:** a sale with a balance paid date and the deposit never marked
  received now reads paid in full, deposit included (as its Payments card already did);
  anticipated money without a balance due date is filed under the pickup date, not the
  sale date.
- **Step 4 (invoices and receipts):** `data/familyMoney.js` (new, Pro-only): the family's
  account (fee and sale pieces, money, total / paid / owed, next), picks, document lines and
  the applicant page's documents. `invoiceDoc` builds a family's documents (older `sale` /
  `waitlist` links read as the family's) with the account summary, a Received column on
  receipts, the final payment's methods (D9); the stud path unchanged. Generator per family:
  lines grouped by due date with Next payment / Everything owed / Bill part of it; receipts
  of recorded money with Record a payment. The family page's Documents: fee, deposit (always,
  "(credited)"), each payment's receipt, the next payment's invoice, a combined one.
  `WaitlistEntry.invoice_number` / `invoice_notes` (private) for a family with no sale.
  Regression tests for the $0 deposit receipt and the missing deposit receipt.
- **Not built (no build step):** plan §3.2a / D20. Flagged: Financials' Adjust modal can raise
  a transport fee without the new-fees question (D17).
- **Checked** in Chromium at phone width on the Demo build: Financials (Anticipated by due
  date), Receivables, a family's Documents and their documents, the generator (invoice and
  receipt). No console errors.
- **Tests:** `tests/paymentScheduleIncome.test.js`, `tests/familyMoney.test.js` (new);
  `paymentSchedule`, `paymentScheduleData`, `invoicePdf` added to. Full suite 1,824 passing;
  editions build.
- **Docs:** guide §4 aggregators, §21, §21.3, §24, §29, §31; plan D25–D28 and Modified notes.
- **Service worker:** `data/familyMoney.js` in `PRECACHE_URLS` and `proPages.js`. `CACHE_NAME` v127 (owner asked, at the end of the batch). Merged with View their page,
  which also bumped to v127 from v126: one bump carries both batches.

## 2026-11-13 — Payment schedules, step 5: contract prefills and Firma field labels

- **Owner decisions D29–D31** (plan §10): `payment1` / `payment2` are the due dates before the
  final one; the Firma relabel is built on a best guess at Firma's call, never fatal, one field
  first; an extra agreement for an extra paid through the schedule reads the statement.
- **Contracts (`contractForms.js`, `contractSend.js`):** 8 new sale prefills from the sale's
  payment statement (`gatherContractFacts` loads it with `getSaleStatement`):
  `totalCharges`, `paidToDate`, `payment1Amount/Due`, `payment2Amount/Due`,
  `finalPaymentAmount/Due`. Amounts are what's still owed by each due date (0.00 once met).
  `paidToDate` counts only money on the sale: the credited fee and the part of credits for
  funds received spent on the sale, not credit spent on the fee itself or left over.
- **Extra and transport agreements:** with a schedule, an extra paid through it prints its share
  of each due date (`contractAddOns.extraPayments` + `chargePieces`), and `transportDueDate` is
  the final payment's date. Unchanged without a schedule and for own-dated extras.
- **Firma labels:** `contractForms.FIRMA_LABELS` (a group prefix per fact); `factFields` uses
  them. Worker `syncFirmaFields` takes `relabel` and updates an existing field's label
  (`PATCH …/custom-fields/{id}`, else `PUT`), never fatal, within 45 outbound calls; the app
  asks only for `buyerEmail` (`cloudEsign.RELABEL_FIELDS`) until a send proves it. Firma's docs
  weren't reachable from the build session, so the call is unproven (launch checklist).
- **Found while testing:** what a due date covers sets how much it asks, not which charge pays
  it: money pays the price before extras (D16), so a due date covering only an extra is filled
  by the price on invoices, Financials and now the extra agreement. Left as built (steps 1–4).
- **Checked:** the existing `balanceDue` equals the statement's `remaining` on every open-sale
  combination, so `totalCharges − paidToDate = balanceDue`. Over the sample data in Chromium,
  every sale's fields match its Payments card; the contract pages load with no errors.
- **Tests:** `tests/contractSchedule.test.js` (new: the fields, credits, D18, ended sales,
  extras, transport, a 5,000+ combination check against the statement and `balanceDue`);
  `esign.test.js` (labels, the real `gatherContractFacts`); `priceTable.test.js` (88 facts);
  `cloud/tests/esign.test.js` (relabel: asked only, PATCH, PUT fallback, failures, the
  42-call worst case). `node --test` 1,841 pass; `cd cloud && npm test` 334 pass.
- **Docs:** End-State guide §21.3, §32; plan §8.1, §8.2, §10, §11; Integrations plan routes;
  launch checklist; README status.
- **Service worker:** no new files. `CACHE_NAME` v128 (owner asked).

## 2026-11-13 — An extra set "No, with the sale's schedule" now goes on the schedule

- **Bug:** an extra set to *No, with the sale's schedule* that had a payment plan (its own or
  its group's) was copied onto the sale with its plan's steps. `saleCharges` treated any
  extra with steps that no due date named as on its own dates, so the No was ignored. The
  schedule editor only offers the Extras tick (and a tick per extra) for extras already on
  the schedule, so it couldn't be named, and a saved schedule's Extras cover was dropped
  when loaded. The invoice showed the extra's step and the schedule's due date as two lines
  on the same date.
- **Fix:** on a sale with a schedule stored, only `own_due_dates: true` keeps an extra apart.
  Every other extra is on the schedule (`extras`, `all` or its name), its steps not used for
  dates. Money already paid on those steps still counts: a payment `toward` a step pays the
  extra, and a step marked paid covers what's left of its share, never twice. With no
  schedule, stepped extras keep their steps as before (D2). The schedule editor works out its
  tick choices as they'll be once a schedule exists, so *Add a payment schedule* offers the
  Extras tick. `addedFees` says "paid on its own dates" only when that's true.
- **Tests:** `tests/paymentSchedule.test.js`: two new cases (a saved schedule's Extras
  cover takes a stepped extra, flagged still apart, `addedFees`; old step payments counted
  once). The combination check counts a step marked paid as money received. `node --test`
  1,843 pass.
- **Docs:** End-State guide §21.3; plan §3.3 (**Modified:**).
- **Service worker:** no new files. `CACHE_NAME` v129 (owner asked).

## 2026-11-13 — Invoices: one "Combined Price" line per due date that covers several charges

- **Bug:** an invoice printed one line per charge and due date (`chargePieces`), so a due date
  covering the price and an extra printed as "Remaining Purchase Price" lines plus the extra's
  own line: the final payment came out as two lines on one date ($300 price + $1,400 stay),
  and Payment 1 was called "Remaining Purchase Price" though it asks 50% of price and extras.
- **Fix (`familyMoney.js`):** `combinedDueIds(statement)` names the schedule due dates whose
  covers take in more than one schedule charge; `familyAccount` flags their pieces `combined`,
  and `documentLines` prints each such due date as one line, **Combined Price (<due label>)**,
  its pieces added (a partial among them marks it "(partial)"). A due date covering one charge
  keeps that charge's name. Totals, credits and the account summary are unchanged. The
  generator still lists the pieces under their due date.
- **Tests:** `tests/familyMoney.test.js`: the owner's sale as a regression case; the partial
  transport line on a combined final payment now prints combined. `node --test` 1,844 pass.
- **Docs:** End-State guide §24 invoice; plan §6.1 Modified note.
- **Service worker:** no new files. `CACHE_NAME` v130 (owner asked).

## 2026-11-13 — Payment schedules step 6: family pages, Companion, messages, Stripe payments

- **Family status page (Payment Schedule plan §7, D32–D35):** `paymentSchedule.familyPaymentsView`
  (the statement as the family sees it, field by field) and `nextPaymentText`;
  `incomeView.getSaleStatements` (many sales at once, exactly as `getSaleStatement`); the
  projection's `payments` and the turn card's deposit credits from the statement; Worker
  `familyPages.paymentsOf`; `status.js` **Your payments** ("Was due …", never Overdue, D35).
  The portal feed stays amount-free (D33).
- **K8-10:** the application fee card's headline is the fee; "Paying by card adds $X" beside
  the button when the link charges more.
- **Companion:** `remainingBalance` and `balanceDueDate` (the final due date) from the
  statement; new per-pup `payments` (with her final-payment methods), drawn as a Payments
  section in `companion-view.html`.
- **K8-1, the deposit request:** `depositRequest.depositMessageMoney`: the deposit after
  credits ("after $50 already credited"), the Stripe link for that amount, what's owed after
  the deposit (no longer the deposit taken off twice), with a schedule the schedule in words,
  her final-payment methods.
- **Send payment link:** `paymentLinks.paymentOptions(statement)`: deposit owed / next payment /
  everything owed, each once; the message gives the due date or "at pickup" and, on the final
  payment, her final-payment methods.
- **Stripe (D34):** links beyond the deposit have component `payment` (named by the option).
  Paid, `integrationEvents.planSalePayment` records a `payments` row (once per reference; the
  deposit owed marked received first on a deposit-pending sale), never paid in full; a
  payment that covers everything leaves a Today review (`integrationApply.COVERS_ALL_REASON`).
  Old `balance` links read the same way. The Worker accepts `payment` as a component.
  The sale's Payments card shows **Mark paid in full** whenever everything is paid and it
  isn't marked.
- **Left for step 7:** pickup and go-home messages and Kels still read `balanceDueOn`.
- **Tests:** `tests/familyPayments.test.js` (view, projection, Companion, K8-1), `cloud/tests/
  familyPayments.test.js`, `tests/paymentLinks.test.js` (options from the statement, the final
  payment's message), `tests/cloudIntegrations.test.js` (payment rows), `tests/stripePayments.test.js`
  (a payment link end to end, D34's Today item). `node --test` 1,859 pass; `cd cloud && npm test`
  337 pass; `node build/assemble.mjs` builds.
- **Docs:** End-State guide §20, §21.3, §29, §32; Waitlist Spec §8.1 (a Modified row); Waitlist
  Fixes plan step 5 (Modified); plan step 6; README Status.
- **Service worker:** no new files. `CACHE_NAME` v131 (owner asked).

## 2026-11-13 — Payment schedules step 7: Today nudges, Kels, the pickup message

- **Decided with the owner (plan D36):** Today's payment nudges cover every open sale (no
  schedule = its one due date); Pups are going home's Balance item becomes Payments, done
  when nothing is owed; Review my waitlist takes payments due; Pups are going home offers a
  pickup message. Today had no balance nudge to replace, so the payment nudges are new.
- **Today (all editions):** `nudges.paymentDueNudges` / `paymentDueItems` over
  `incomeView.getSaleStatements`: `payment-due` from 7 days before a due date through the
  day, `payment-missed` once it's gone by ("A scheduled payment was not marked received: …"
  → Open the sale; no back-out suggestion, D4). Keyed by sale, due date and date. Not the
  deposit, not own-dated extras. `extra-due` now skips extras on a sale's schedule (they were
  nudged by their unused steps' dates).
- **Pups are going home:** the readiness item `balance` is **Payments** (`prepPups.readiness({
  statement })`, the Puppy Record cover page too): done when nothing is owed; the fix records
  payments in the chat (an amount per pup, prefilled with the next due date's ask), then
  offers Mark paid in full. Money still owed reads the statement (what's owed in all and the
  next payment), no longer `contractSend.balanceDueOn`. New step: a pickup message per family
  (`goHome.pickupMessage`, `paymentSchedule.owedBy`), written in the composer for her to send.
  Kels's menu says payments.
- **Review my waitlist step 7:** scheduled payments due or not marked received on waitlist
  families' sales → Received (a payment toward the schedule, then the paid-in-full question)
  / Not yet / Open the sale; counted in the opening line.
- **Shared:** `paymentSchedule.paidInFullChanges` (the Payments card and Kels write the same
  thing), `owedBy`.
- **Tests:** `tests/paymentNudges.test.js` (new), `tests/prepPups.test.js` (Payments).
  `node --test` 1,869 pass; `node build/assemble.mjs` builds. Checked in the browser on the
  sample data: Today shows a missed and a due payment; Pups are going home and Review my
  waitlist record a payment and write the pickup message, no console errors.
- **Docs:** End-State guide §19, §21.3, §33; plan step 7 (Built, Modified), D36; README Status.
- **Service worker:** no new files. `CACHE_NAME` v132 (owner asked).

## 2026-11-13 — Website contract plan: the owner's answers

- **Docs only.** `docs/KennelOS_Website_Contract_Plan.md` brought in line with KennelPort's
  `docs/plans/kennelos-contract.md` and the owner's answers: featured offspring is
  KennelPort's own (C8 `offspring`, `feature_offspring` and `featured_offspring_ids`
  dropped); C4 sends `imported` / `import_country` on a dog and each C7 ancestor, with
  import-descended worked out by KennelPort; no colour list in KennelOS (KennelPort builds
  one per website from the free-text colours sent); `imported` and `import_country` are
  cloud, like the Dog's other registration facts. Open questions marked answered.

## 2026-11-13 — Website contract step 1: raw disposition, litter status, test type, account type

- **`siteExport.js`:** four new optional sections, each sent only to a Worker whose answer
  lists it: `pup_disposition` (a litter puppy's `disposition` as set, null when none or
  unknown), `litter_status` (a litter's `status`), `health_detail` (a health result's event
  `type`), `account_type` (a product's `account_type`, null when unknown). `status` and
  `transport` still go. `PUPPY_WORDS` loses `reserved`; `bundleChanges` doesn't list a
  puppy's disposition apart from its status line.
- **`healthTestLog.completedTestsByDog`:** each result carries its `type`.
- **Not built:** `verify_url` (C5). KennelOS holds no verification link on a test; noted in
  the plan as Modified, for the owner.
- **Tests:** `tests/siteExport.test.js` (two new), `tests/healthTestLog.test.js`.
  `node --test` 1,871 pass; `node build/assemble.mjs` builds.
- **Docs:** End-State guide §35; plan step 1 (Built, Modified); README Status.
- **Service worker:** no new files; no cache bump yet.

## 2026-11-13 — Website contract step 2: titles with organization and date

- **`siteExport.js`:** the `titles_detail` section. With it, a dog's `titles` is
  `[{ abbr, organization, date }]` (`titleDetailsByDog`, `TITLE_KEYS`): her `title_earned`
  events in the order earned; the same title from the same organization once, at its
  first date. Without it, the abbreviations as before.
- **Tests:** `tests/siteExport.test.js` (one new). `node --test` 1,872 pass;
  `node build/assemble.mjs` builds.
- **Docs:** End-State guide §35; plan step 2 (Built); README Status.

## 2026-11-13 — Website contract step 3: Imported, origin and lineage

- **Dog fields:** `imported` (boolean) and `import_country` (text), both cloud like
  `registry` (owner decision). Dog form: Imported tick beside the registrations; Country of
  origin only while ticked, cleared on unticking; the view reads "Yes, from …".
  `syncRegistry.js`, `cloud/src/lib/cloudFields.js` regenerated.
- **`data/pedigreeWalk.js` (new, precached):** `ancestorsOf`, four generations, nearest
  first, sire's side first, a loop stops its line.
- **`siteExport.js`:** `origin` (`imported`, `import_country` only while imported) and
  `lineage` (`breed`, `sire_id`, `dam_id`, `ancestors` by name and titles only, with the
  origin facts on each when both go). `bundleChanges` words for the new keys.
- **Tests:** `tests/pedigreeWalk.test.js` (new), `tests/siteExport.test.js` (one new).
  `node --test` 1,876 pass; `cd cloud && npm test` 337 pass; `node build/assemble.mjs`
  builds. Dog form checked in the browser on the sample data: tick, save, untick clears
  the country; no console errors.
- **Docs:** End-State guide Dog entity and §35; plan step 3 (Built); README Status.
- **Service worker:** `data/pedigreeWalk.js` added to `PRECACHE_URLS`. `CACHE_NAME` v133
  (owner asked), covering steps 1 to 3.

## 2026-11-13 — Website contract step 4: waitlist facts

- **`siteExport.js`:** the `waitlist_facts` section (`waitlistFacts`, `WAITLIST_FACT_KEYS`):
  `{ online_form, has_fee, fee_due_days, respond_days, max_passes }` once her waitlist is
  set up; never the fee amount. `steps` and `payment` still go. `bundleChanges` names it
  Waitlist details.
- **Not sent:** `open_days` (deadlines count only her business days); noted in the plan.
- **Tests:** `tests/siteExport.test.js` (one new). `node --test` 1,877 pass;
  `node build/assemble.mjs` builds.
- **Docs:** End-State guide §35; plan step 4 (Built); README Status.
- **Service worker:** no new files; rides v133.

## 2026-11-13 — Payment schedules step 8: the docs, checked against the code

- **Checked:** every guide section the plan names (§4, §13, §21, §24, §29, §32, §33, §35) and
  the ones steps 1–7 touched, against `paymentSchedule.js`, `paymentScheduleUI.js`,
  `familyMoney.js`, `invoiceGenerator.js`, `incomeView.js`, `contractForms.js`, `nudges.js`,
  `integrationApply.js`, `waitlist-entry.js`, `kennel.js`, `referenceRegistry.js` and the
  family status page. §4, §21.2, §24 and §33 already matched.
- **End-State guide:** §7 (unindexed paths: `list[].key`, a sale's `payments[].account_id`;
  "the one today" was stale), §13 Components (`paymentScheduleUI.js`, `invoiceGenerator.js`),
  §16 invariant 10 (a sale's money from its statement, one allocator), §19 `int-review`
  (D34's covers-everything review), §21 (which helpers still read whole lines; the "until
  steps 5–6" note was stale), §21.3 (`schedule` in the statement, `scheduleFromSaved`, not in
  CSV, the JSON backup carries them), §29 Surfaces (the family page's Payments card and
  `afterAction`'s new-fees question; Documents rewritten from the old fee/invoice/receipt
  line), §32 (the price table and recorded payments; an ended sale's two fields named),
  §35.1 (once the portal takes over the status page, Your payments goes with the rest).
- **Editions plan:** a tiers row for a sale's payments (all editions; Pro adds saved
  schedules, final-payment methods, Paid via, documents); Pups are going home's row says
  Payments and the pickup message (final-payment methods Pro only: Lite has no Kennel page).
- **Found, not fixed (owner to decide):** `incomeView.priceTable` (contract fields
  `otherPaymentsReceived`, `purchaseBalanceDue`) reads `saleComponents`, which knows no
  recorded payments: a $3,000 sale with its $500 deposit and a $1,000 payment prints
  `otherPaymentsReceived` 0.00 and `purchaseBalanceDue` 2,500.00, while `balanceDue` and the
  schedule fields say 1,500.00 owed. Right again once marked paid in full. The status page
  hiding Your payments once the portal takes over (pickup day passed, Delivered, or home) is
  as built; worth a look if money can still be owed then.
- **Docs:** plan step 8 (Built, Found); README Status.
- **Tests:** none changed (docs only).
- **Service worker:** no app files changed, so no `CACHE_NAME` bump.

## 2026-11-13 — A contract's price table counts payments recorded on the sale

- **Bug (found in step 8):** `incomeView.priceTable` read whole lines (`saleComponents`),
  which know no recorded payments, so `otherPaymentsReceived` and `purchaseBalanceDue`
  ignored `Sale.payments` until the sale was marked paid in full ($3,000 sale, $500 deposit
  paid, $1,000 recorded: 0.00 received and 2,500.00 due, against 1,500.00 owed everywhere
  else).
- **Fix:** the payments' share of the price comes from the payment statement (after the
  credited fee; payments pay the price first, D16) and moves from `purchaseBalanceDue` to
  `otherPaymentsReceived`, capped at what credits for funds received left of the price, so
  nothing counts twice and price = deposit + received + balance due still holds. A
  returned or cancelled sale keeps what was paid; a lost one counts nothing, as before.
- **Owner:** the status page showing only the portal link once the portal takes over is
  right: a pup isn't released until everything is paid, and it only applies to a kennel
  with the portal on.
- **Tests:** `tests/priceTable.test.js` (payments, several, beyond the price, with the
  credited fee, with credits, with paid in full, toward an own-dated extra, on a schedule;
  ended and lost sales). Checked over 20,000 random open sales (fee credit, credits, deposit,
  payments, transport) that `purchaseBalanceDue` equals what the statement has owed on the
  price and the table adds up to the price. `node --test` 1,871 pass.
- **Docs:** End-State guide §16, §21, §32; plan step 8; README Status.
- **Service worker:** no files added or renamed. `CACHE_NAME` v134 (owner asked for the bump if needed): main's website work had already shipped v133.

## 2026-11-14 — Plan: a dog's titles as a field

- **Plan only:** `docs/KennelOS_Dog_Titles_Field_Plan.md`. It adds a `Dog.titles` field for
  titles typed in by hand (bought champions, pedigree ancestors), and the shown and sent
  titles become the field and `title_earned` events together. The show engine reads the field
  (an undated CH unlocks GCH, and the title nudge is skipped) but never writes it. It takes in
  KennelPort's hand-over on ancestors' titles: the chart import keeps titles as data, existing
  `Titles:` notes are read in once, and the lineage feed sends them. No contract change. Owner
  decisions D1 to D6 are open. README doc map updated.
- **Revised (owner):** existing `Titles:` notes lines are now moved only when she says
  yes, as two new checks in Kels's existing Tidy up my records (no new task or nudge), never a silent back-fill. The
  chart import now also sets Imported and the country of origin from a foreign registry,
  pre-ticked on its review screen for her to confirm (D7).
- **Revised (owner), D8:** country of origin is its own fact, apart from Imported, because
  a Serbian ancestor still in Serbia isn't an import. A new `Dog.country_of_origin` field;
  `imported` and `import_country` stay as shipped. The chart import fills the country from
  a foreign registry and suggests Imported only on the line's boundary dog: pre-ticked when
  it's dual-registered, unticked otherwise (frozen semen, in-utero). A note for KennelPort
  asks for an optional `origin_country` section and two tag conditions: Import-descended
  and Foreign bloodlines.
- **Revised after a web check (D7, D8):** AKC gives a foreign frozen-semen sire an AKC
  number through foreign registration, so having both a home and a foreign number doesn't
  prove a dog was imported. The chart import now only ever offers Imported unticked, at
  the boundary dog. It keeps a second registration, which gives the country of origin.
  `REGISTRY_COUNTRIES` is to come from the FCI's list of studbook initials. JR, MET and LOE
  are still to confirm, and fci.be and akc.org aren't reachable from the session.
- **Revised after the FCI/AKC fact check** (`docs/KennelOS_Registry_Title_Facts.md`, added):
  - JR (Serbia), MET (Hungary) and LOE (Spain) are confirmed. `REGISTRY_COUNTRIES` takes
    studbook, appendix and older codes from the FCI list, and leaves CKC, KCSB and the
    rows that couldn't be placed off the map.
  - AKC doesn't register a foreign frozen-semen sire who never came over. So Imported is
    suggested from the parents' registrations: pre-ticked when both parents are
    foreign-only (or the dog is dual-registered), unticked when one parent is foreign.
  - D3 is flipped to a prefix list. AKC puts most titles after the name, championship
    titles before it.
  - Chart titles on an AKC pedigree get organization AKC.
- **Decided and split into phases (owner):** D1–D7 as recommended. §8 of the plan now has
  six build phases with a "findings from reading the code" section to carry between
  sessions. In short:
  - AKC Certified Pedigrees bracket a foreign-born dog's country ("(SRB)"), so a bracketed
    country on an AKC dog pre-ticks Imported.
  - KSS also maps to Serbia.
  - The registry map goes in a new pure module, `registryCountries.js`, because
    `pedigreeParse.js` is import-free.

  No code yet.

## 2026-11-08: duplicate applications ("Same family")

- Plan: `docs/KennelOS_Duplicate_Applications_Plan.md` (owner's answers in its section 7:
  the kept entry keeps its own place; a fee paid on the deleted one becomes a credit; their
  contact cards merge in the same confirm; Kels's Tidy up raises them too).
- One family on one waitlist twice, maybe spelled differently: suggested by email, phone or
  name (`data/applicationDuplicates.js`, pure) on the family's page (a card), the Waitlist
  page (a badge), Today (a nudge), Kels's Review my waitlist and Tidy up, and Import/Export's
  Scan for duplicates (which before never compared open applications: they have no contact).
  Or marked by hand: ⋯ **Same family as another application…** with a searchable picker.
- One dialog (`assets/applicationMergeUI.js`, Pro-only): which to keep, which answers win,
  whether to merge their contact cards, and what will happen; **Merge and delete the other**.
  `waitlistActions.mergeApplications` writes it; `recordMerge.replaceAndDelete` (split out of
  `mergeDuplicate`) moves the other's offers and deletes it. New private field
  `merged_applications` (the Timeline's line).
- Tests: `applicationDuplicates.test.js` (matching, suggested keep, refusals, answers, fee
  credit, the merge with offers and with two contacts, a refused merge changes nothing).

- **SW cache bumped to `kennelos-shell-v112` (2026-11-08)** for duplicate applications, the owner's go-ahead.

## 2026-11-14: duplicate applications brought up to main; SW cache v135

- PR 168 merged with main (161 commits behind). Conflicts were mechanical: imports in
  `waitlistActions.js`, the handler map in `waitlist-entry.js` (main's new handlers plus
  `wireDuplicates`), the cache name, this log. Main's side sales (`sales.side_entry_id`) are
  in the reference registry, so a merge moves them to the kept entry.
- The v112 bump above never shipped. **SW cache bumped to `kennelos-shell-v135`** for the
  duplicate-applications files on top of main's v134. Other sessions' unmerged branches were
  checked first: their app changes (Kels's review defects, the "DAM" pedigree fix, waitlist
  policies, the public list's See Your Details tint) are already on main.
- Review K11's findings (`docs/review/findings/K11-kels.md`, the `INDEX.md` row) brought in
  from `claude/kennelos-k11-kels-review-6ys8tj`.

## 2026-11-14: session-start check for unmerged work

- `CLAUDE.md` gains "Session start": before replying to the first request, check open PRs and
  branches with commits main lacks, give a one-sentence summary and offer to bring them in.

## 2026-11-14: dog titles as a field, phase 1 (core and data layer)

- Plan: `docs/KennelOS_Dog_Titles_Field_Plan.md` §8 phase 1. No UI yet.
- New pure modules: `data/registryCountries.js` (`REGISTRY_COUNTRIES`, `countryOfRegistry`,
  ISO-3 `countryName`, `homeCountry`; KSS → Serbia; the ambiguous codes left off) and
  `data/dogTitles.js` (`titlesOf` merging the field, `title_earned` events and name titles;
  `normalizeTitles`, `displayName`, `feedOrder`, `holdsTitle`, `abbrKey`, `sameTitle`).
- `pedigreeParse.js`: `TITLE_PREFIXES` exported (the old `TITLES` plus AKC's prefix lists);
  `splitTitles` takes a repeat number (GCHP2, MACH3).
- New plain fields `Dog.titles` and `Dog.country_of_origin`, both cloud (D2, D8):
  `dogRepo` normalizes / trims them on every write that carries them; `syncRegistry` and
  the regenerated `cloud/src/lib/cloudFields.js` list them.
- Dog Card: `titles` (a new `titles` kind, field only) and `countryOfOrigin`; old cards read
  both as empty. CSV dog import: `titles` (add-only on an update) and `country_of_origin`
  columns, with help lines.
- `PRECACHE_URLS` gains both modules. No cache bump.
- KennelPort's reply on titles and `origin_country` recorded in the plan's §6.1.
- Tests: `registryCountries.test.js`, `dogTitles.test.js`, plus prefix/repeat-number cases in
  `pedigreeParse.test.js`, a card round trip in `dogCard.test.js`, the CSV columns in
  `csvImport.test.js`.

## 2026-11-14: dog titles as a field, phase 2 (readers and display)

- Plan: `docs/KennelOS_Dog_Titles_Field_Plan.md` §8 phase 2.
- `dogTitles.js` gains `titlesByDogId` and `titleAbbrs`. `waitlistProjection.titlesByDog`
  and `siteExport.titleDetailsByDog` now take `(events, dogs)` and go through `titlesOf`, so
  waitlist parent cards and the website feed (dogs and C7 ancestors) carry Titles-field and
  name titles as well as logged ones: KennelPort's ask 1. Bare abbreviations go in display
  order, once each (was: the order earned, by exact spelling); `titles_detail` in
  `feedOrder`, a held title with null date and organization.
- D5a: the feed's `registered_name` (dogs and ancestors) goes without its front titles.
- New optional section `origin_country` (Website Contract Plan C10): `country_of_origin` on
  each dog and ancestor, else `import_country` while imported. KennelPort's side is on its
  branch, unmerged, so nothing new goes until its Worker lists it.
- `showPoints`: `trackProgress` `requiredHeld`; `showRecordFrom(events, tracks, { held })`
  reads `Dog.titles` (a dated held CH gates like a logged one, an undated one unlocks GCH
  with every win counting) and gives each row `heldTitle`. `getShowRecord(id, { held })`.
- `nudges.js`: no "log the title?" when the title is on the dog's Titles.
- Dog page: the header subtitle (or the title, with no call name) is `displayName`; the
  Show Record card says "CH Held" / "CH earned …" for a held title. Pedigree tree boxes
  show the registered name with titles.
- Tests: held-title cases in `showPoints.test.js`; titles from the field and name, D5a,
  the KennelPort grandsire case and `origin_country` in `siteExport.test.js`; field and
  name titles in `waitlistProjection.test.js`. Two siteExport expectations changed for the
  new order and the stripped name.

## 2026-11-14: dog titles as a field, phase 3 (Dog form)

- Plan: `docs/KennelOS_Dog_Titles_Field_Plan.md` §8 phase 3.
- Dog form, a **Titles** row: field titles as chips (abbreviation; organization and
  earned-on date behind "details"; × removes), logged `title_earned` titles as read-only
  chips that open their event in place, and "in the registered name" chips that follow the
  Registered name box. The Add box takes several at once ("GCH CH") with suggestions from
  `TITLE_PREFIXES` plus AKC's suffix list.
- `dogTitles.js` gains `TITLE_SUFFIXES`, `titleSuggestions`, `splitTitleInput` and
  `formTitleChips`.
- **Country of origin** is one row, always shown next to Imported (was: a box only while
  Imported was ticked, writing `import_country`). It saves `country_of_origin`, and while
  Imported is ticked the same country goes into `import_country`. An older record's
  `import_country` fills the row on edit. The view shows Imported "Yes" and Country of
  origin on its own row.
- Chip styles in `app.css`. No new files, so `PRECACHE_URLS` is unchanged; no cache bump.
- Tests: suggestions, the Add box split and the chip split in `dogTitles.test.js`. Checked
  in the browser at phone width: add, edit details, remove, save, view, re-edit, and a
  logged GCH opening its event.

## 2026-11-14: dog titles as a field, phase 4 (pedigree chart import)

- Plan: `docs/KennelOS_Dog_Titles_Field_Plan.md` §8 phase 4.
- `pedigreeParse.js` now imports `registryCountries.js`. A chart box's prefix titles go
  into `titles` (organization AKC on an AKC Certified Pedigree, `header.certified`) and the
  `Titles:` notes line is no longer written. The `Registered in …` note stays.
- `isOtherReg` and `parseDetails` read every code on the registry map: as printed or in
  capitals, dots optional, accented letters, trailing hyphen, longest first (`KSS JR`).
  Numbers are kept as printed. A line led by another mapped registry isn't read as an
  unslashed AKC number (`KC AV01234501`), and `DNA`/`CHIC`/`OFA` lines are never
  registrations. A second registration goes into `additional_registrations`.
- New `originSuggestions(dogs, home)`: each dog's country (bracketed country, else a
  non-home registry) and the Imported suggestion over the chart's tree (pre-ticked,
  offered unticked, or none, D8).
- `pedigreeImport.planImport` carries titles, second registrations, country and Imported
  per row (home = `homeCountry(existing)`), and matches a dog she has by a second number
  too. A matched dog's row offers only what it lacks, each unticked (`row.fill`).
  `commitImport` saves them; new `originFields`.
- Review screen: Titles chips (remove, add with suggestions), an Origin column (country
  box, Imported tick), "also <number>" under a second registration, and the unticked
  fill-ins for matched dogs.
- Tests: §8.1 step 4's list plus "(SRB) on an AKC dog → Serbia, pre-ticked", "KSS JR →
  Serbia", every map code read as a registration, the KC/AKC look-alike, and the
  fill-in, edit and save cases in `pedigreeImport.test.js`. Checked in the browser with a
  generated chart PDF: review, tick Imported, add a title, import.

## 2026-11-14: dog titles as a field, phase 5 (Tidy up my records)

- Plan: `docs/KennelOS_Dog_Titles_Field_Plan.md` §8 phase 5.
- `tidyRules.js`: `dog-titles-in-notes` and `dog-titles-in-name` after `dog-no-parents`, in
  every edition. `titlesInNotesFindings` (a `Titles: …` notes line naming titles `titlesOf`
  lacks; words like "none" skipped) and `titlesInNameFindings` (titles on the front of the
  registered name) each give one grouped finding, keyed by a hash of the dogs and titles.
  `titlesFix` is the write. `tidyFindings` takes `titleEvents`.
- `tidyUpUI.js`: one list with a tick per dog and per title, Add to titles or Skip (then
  Not now / Don't ask me again / Stop for now). Writes through `dogRepo.update`. The name
  finding also takes the titles off the name; the notes line stays (D4). Each kind is
  raised once a visit, so an unticked title waits for the next one.
- Kels's Tidy up task: its description and search words now cover titles (`pages/kels.js`;
  the plan named `kelsKnowledge.js`, noted as **Modified** there).
- `CACHE_NAME` bumped to `kennelos-shell-v136` for phases 3–5. No new files.
- Tests in `tidyRules.test.js`. Checked in the browser: Kels's tidy-up with two notes dogs
  and one name dog, a title unticked, both lists saved.

## 2026-11-14: dog titles as a field, phase 6 (docs and close)

- Plan: `docs/KennelOS_Dog_Titles_Field_Plan.md` §8 phase 6. Docs only, no app files changed.
- Show Tracking Spec §1 and §4: **Modified** notes (D6). Titles a dog holds are stored on
  `Dog.titles`; points and track progress stay derived; a held title satisfies `requires`
  (dated like an event, or undated and unlocking every aimed win). The guide's Shows
  paragraph says the same. (The plan said "guide §4.2", which is Relationship direction;
  the derived-not-stored rule the change touches is in the Shows paragraph, §8.)
- Editions: guide §0 and the Editions Plan's feature table say Titles and Country of origin
  are in every edition (Dog form, pedigree import, Kels's tidy-up of titles in notes and
  names); show points and the "Log the title?" nudge stay Pro.
- The plan's status → built; README Status. The Website Contract Plan already says C10
  (`origin_country`) waits on KennelPort's branch.
- `node build/assemble.mjs`, `node --test` (1943 pass) and `cd cloud && npm test` (337
  pass). Checked in the browser (`/shared/`): the dog page (name with titles, Country of
  origin), the Dog form's title chips, the pedigree page with a titled ancestor, the
  pedigree import page, and Kels's tidy-up finding titles in notes and in names. No
  console errors.
- No `CACHE_NAME` bump: no app file changed since v136.

## 2026-11-14: Firma preview: why its fields show empty (diagnosis)

- **Seen (owner):** the live Preview has never shown the contract's details filled in.
- **Read:** Preview makes a draft (`POST /signing-requests`) and opens it in Firma's signing
  request editor, read-only; a send uses `create-and-send`. Firma's Field Prefilling guide:
  prefill "happens at field-creation time once the recipient record exists" and "is re-checked
  when the signing request is actually sent"; with create-and-send "the field's value is
  populated immediately in the response". It says nothing about drafts or what the editor
  shows. The API spec's field `value` is the "final signed value". A field belongs to one
  recipient (`recipient_id`) and fills from that recipient's `custom_fields`; KennelOS sends
  the same facts to both signers.
- **Change (Worker):** after a preview's draft is made, `logPreviewPrefills` reads its fields
  and users and logs `firma: preview prefills N, filled M (signer 1: …, signer 2: …); empty:
  …` (`firma.prefillReport`; keys and counts only). `emptyPrefills` also reads a `results`
  list and counts `final_value` / `read_only_value` as filled. Best effort, never fatal.
- **Next:** one Preview after the deploy; the log line tells a draft without values from an
  editor that doesn't show them (`docs/LAUNCH_CHECKLIST.md`).
- **Tests:** `cloud/tests/esign.test.js` +2. `cd cloud && npm test` 339 pass.
- Worker only, so no service-worker bump.

## 2026-11-14: Firma preview: name the empty field; What goes in on the Send dialog

- **Seen (production log):** `firma: preview prefills 5, filled 4 (signer 1: 5); empty:
  custom_workspace_370f5600-…`. The draft holds the values; Firma's read-only signing request
  editor draws each field as a "TEXT" box, not its value (owner's photo). All five belong to
  the buyer (signer 1). One field is empty, unnamed.
- **Worker:** `firma.prefillFields` names each prefilled field by the workspace custom field
  it reads (`fact`, `label`, `filled`, `sent`, `signer`; never a value). The preview log line
  names an empty field `<label> [<fact>, sent|not sent]`, and the preview's response carries
  the list as `fields`. `requestBody` returns the workspace rows it read.
- **App:** the Send dialog's **What goes in (N)** lists every detail the send fills, by its
  label, with its value from the device (`cloudEsign.sendDetails`). After Preview it says how
  many of the template's detail fields are filled and why each empty one is
  (`cloudEsign.previewNotes`: blank on this contract and where to add it, a detail KennelOS
  doesn't fill on that kind of template, not a KennelOS detail, or sent but left empty).
- **Tests:** `cloud/tests/esign.test.js` (prefillFields, the preview's log and `fields`),
  `tests/esign.test.js` +2. Checked in Chromium at phone width: the dialog's list, values
  escaped.
- No new files. `CACHE_NAME` bumped to `kennelos-shell-v137`. Needs the Worker deploy too.

## 2026-11-14: Preview's "doesn't fill" notes case aside; Other templates fill the sale

- **Seen (owner):** after a Preview, details a template's kind does fill (Breeder · Address on
  breeding rights, buyer details on pet home) were named "KennelOS doesn't fill this detail".
- **Why:** the Worker names each field by her workspace field's `field_name` as Firma holds
  it, and fills it case aside (`withFieldAliases`), but `cloudEsign.previewNotes` checked that
  name against the kind's facts exactly. A blank detail under a differently-cased name fell
  through to "doesn't fill" instead of "Blank on this contract: add it on …".
- **Change (app):** `previewNotes` compares fact names lower-cased (the kind's facts, the
  facts sent) and reads the field's label and where to fill it from KennelOS's own spelling.
- **Change (owner's call):** an **Other** template fills the sale fields as well as the dog's
  (`fieldGroupsFor('other')` = `['sale', 'dog']`, as co-own); the dog's other party only when
  there's no sale. The Accounts page's field-name groups say so.
- **Tests:** `tests/esign.test.js` +1, `tests/contractForms.test.js` +1. `node --test` 1950 pass.
- **Docs:** End-State guide §32 (which groups each kind fills; case aside).
- No new files; no Worker change.

## 2026-11-14: A preview's held place lets go; cache v138

- **Seen (owner):** a preview took one of the month's e-sign places and didn't give it back
  after closing the preview without sending.
- **Change (Worker, no migration):** `requestState` takes any status word that isn't a sent
  one (`SENT_STATES`), on a request with no sent date (`SENT_DATES`), as not sent: its draft
  is deleted and the place freed (the word is logged). Firma refusing the delete still keeps
  the place; no answer, or no status, still holds until the token is dead. `usage` adds
  `held` (her open previews, `previewsHeld`), never in `used`.
- **Change (app):** the Send dialog discards its previews on `pagehide` too (reload, another
  page, closing the app), with `keepalive` (`cloudApi.send` option, `cloudEsign.discardPreview`).
  Not on hidden: the preview's own tab hides the app. The usage line says "…, 1 held by an
  open preview"; a limit refusal with one held says so (`cloudEsign.heldText`); after Preview
  the dialog says the preview holds a place until it closes.
- **Tests:** `cloud/tests/esign.test.js` (the sweep: an unknown word freed, with a sent date
  counted, no status held), `tests/esign.test.js` +1. `cd cloud && npm test` 340 pass,
  `node --test` 1951 pass.
- **Docs:** End-State guide §32, Integrations plan §2.3a, launch checklist.
- No new files. `CACHE_NAME` bumped to `kennelos-shell-v138` (owner asked), also covering the
  preview-notes batch above. Needs the Worker deploy too.

## 2026-11-14: Firma labels for every field; step 2 by preview (Payment schedules step 5)

- **Seen (owner):** `buyerEmail` read **Buyer · Email** in Firma's editor after Place fields and
  still filled on a preview, so a relabelled field keeps working. The owner also decided (last
  session, recorded now as D37) that plan §8.2 step 2 is checked with a preview, not with her
  Firma test API key.
- **Change (app):** `cloudEsign.RELABEL_FIELDS` is every fact name (`factFields()`), so the next
  Place fields (or Set up) brings every existing workspace field to its grouped label; names
  never change. No Worker change: it already relabels up to 40 a call within its outbound cap.
- **Tests:** `tests/esign.test.js`: the label test checks every fact is relabelled; +1 (an old
  workspace's fields all relabelled on the next sync, names unchanged, no calls once right; the
  fake answers PATCH). `node --test` and `cd cloud && npm test` pass.
- **Docs:** Payment Schedule plan §8.2 (Modified note, step 2), D15 Modified, D37, build order
  step 5; End-State guide §32; launch checklist (first field ticked, every-field check added);
  README Status.
- No new files. `CACHE_NAME` bumped to `kennelos-shell-v139` (owner asked).

## 2026-11-14: Firma fields never made twice (paged list)

- **Seen (owner):** after every field was relabelled, Firma's editor showed every field twice.
- **Cause (likely; Firma's docs weren't reachable):** the Worker read `GET …/custom-fields`
  without paging, so only Firma's first page. Every field past it looked missing and was added
  again on each sync. The extra copies carried the grouped labels and the originals the old
  ones, so they didn't look alike until the relabel.
- **Change (Worker, no migration):** `firma.workspaceFields` reads the list page by page
  (`page`, `page_size=100`, at most 4 pages, inside the 45-call budget). A field is added only
  when the list is known whole (a short last page); a repeated page or the cap means none is
  added, with a log line. A name already there twice keeps its first copy (the one relabelled).
  A 409 on add counts as already there.
- **Cleanup (owner):** no contract template is in use, so the owner deletes the templates and
  the duplicate fields in Firma; the next Set up or Place fields makes each field once.
- **Tests:** `cloud/tests/esign.test.js` +2 (150 fields over two pages: nothing added, 40
  relabelled; a name there twice; paging not honoured adds nothing; 409), the fake pages
  like Firma (20 without `page_size`). `cd cloud && npm test` 342 pass, `node --test` 1954 pass.
- **Docs:** End-State guide §32.
- No new files; no app change, so no cache bump. Needs the Worker deploy.

## 2026-11-14: Firma's doubled fields removed by the sync

- **Seen (owner):** still every field twice in the editor's prefilled-field list, one copy right
  below the other. The paged list stopped new copies; the old ones were still there, and the
  owner had no way to find them in Firma. No contract template is in use, so nothing needs them.
- **Change (Worker, no migration):** `firma.removeCopies`: a field name in her workspace more
  than once loses its later copies (`DELETE /workspace/{ws}/custom-fields/{id}`, the relabel's
  path; not proven against Firma's docs), the first copy kept. Within the 45-call budget, so one
  Place fields (three sync calls) clears 88 doubles; a refusal is logged (fact name, status) and
  stops the deletes for that request, never fatal. The sync answers `removed` too.
- **Tests:** `cloud/tests/esign.test.js` +1 (88 doubles removed, first copies kept; a refusal
  answers 200), the paging test's doubled name now loses its copy; results carry `removed`.
  `cd cloud && npm test` 343 pass, `node --test` 1955 pass.
- **Docs:** End-State guide §32.
- No app change, so no cache bump. Needs the Worker deploy; then one Place fields.

## 2026-11-14: A Firma workspace deleted in Firma's dashboard can be set up again

- **Seen (owner):** removing the doubled fields didn't work, so the owner deleted the whole
  Firma workspace. KennelOS then said it couldn't reach Firma (`GET /integrations/firma/templates`
  502): her connection still held the deleted workspace's key, and the app has no Disconnect.
- **Change (Worker, no migration):** `firma.failFirma`: her key refused (401/403, or 404 on the
  templates or fields list) → `GET /workspaces/{id}` with the master key. Gone (404/410, or a
  deleted flag) → the webhook stopped, the connection dropped, 409 `esign_workspace_gone`;
  else 502 as before. Used by the templates list, the fields list and template upload.
- **Change (app):** Contract templates shows Set up e-signing on `esign_workspace_gone`, with
  "Your Firma workspace is gone (deleted in Firma). Set up e-signing again to make a new one."
- **Tests:** `cloud/tests/esign.test.js` +1 (a refused key on a live workspace keeps the
  connection; a deleted one drops it, status not connected, Set up makes `ws_2`). `cd cloud &&
  npm test` 344 pass, `node --test` 1956 pass.
- **Docs:** End-State guide §32.
- No new files. `CACHE_NAME` bumped to `kennelos-shell-v140` (owner asked) for the app's message.

## 2026-11-14: Deposit still due is 0 once the deposit is received

- **Asked (owner):** Deposit Still Due should treat a deposit date as all of that deposit
  received, while still taking the credits counted toward it off before then.
- **Change:** `incomeView.priceTable`: `depositDue` is 0 once `depositPaid(sale)` (a deposit
  date, or a status past it); while it's owed, the deposit less the fee credited toward it and
  the received funds allocated to it, as before. `otherPaid` / `balanceDue` unchanged, so
  price = deposit + `otherPaymentsReceived` + `purchaseBalanceDue` still holds. This replaces
  "the same before and after the deposit is marked paid" (2026-11-12). The `depositDue` fact's
  description (Accounts page) says "0 once received"; its Firma label is unchanged.
- **Credits traced (owner):** a family's credits for funds received (`received_credits` on their
  waitlist entry, `getSaleCredits` → `familyCredit`, the fee first, then the sale's lines in
  credit order) reach `depositDue` / `purchaseBalanceDue` alongside recorded payments, matching
  what the Payments card's statement has left on the deposit and the price.
- **Tests:** `tests/priceTable.test.js` (the before/after case now expects 0 after, by date,
  by status, and both; paid-deposit cases expect 0; +1: credits, with and without a credited fee or
  a recorded payment, match the payment statement), `tests/esign.test.js` (a `deposit_paid` sale's
  facts). `node --test` 1957 pass.
- **Docs:** End-State guide (the sale's payment table).
- No new files, no schema change. `CACHE_NAME` bumped to `kennelos-shell-v141` (owner asked).

## 2026-11-15: Payment schedules step 5 (D38): the preview lists every field and its value

- **Decided (owner, D38):** no per-template Firma fields (plan §8.2 step 3 dropped); the grouped
  workspace labels stay. Step 4 (moving templates) isn't needed: no template was in use and the
  workspace is new. Step 2 is the preview's list of every placed field with the value sent.
- **Seen (owner), traced in Firma's script (reachable this session):** on a phone the template
  editor opens zoomed in and fields can't be placed. Its fit (`autoFit`, already on by default)
  measures the page area beside a fixed 320 px field sidebar, about 70 px on a phone, so it
  skips the fit and stays at 100%. Placing a field is an HTML drag from the sidebar or a
  right-click on the page, with no touch path. Still open (plan §8.2 step 5).
- **Change (app):** `cloudEsign.previewNotes` returns `rows`: every prefilled field on the
  template in Firma's order, `{ label, value, filled }`, the value from this device
  (`prefillValues`, matched case aside), never from the Worker. After Preview the Send dialog
  shows **On your template (N)**: each field by its label with what was sent, "(Firma left it
  blank)" when sent but empty, "Nothing sent: left blank" when KennelOS had nothing for it. The
  blank-with-why warning stays above it.
- **Tests:** `tests/esign.test.js` (the previewNotes test checks `rows`). `node --test` 1957 pass.
- **Docs:** Payment Schedule plan §8.2 (Modified, D38), D38, build order step 5; End-State guide
  §32 (the preview); launch checklist (the preview check); README Status.
- No new files, no Worker change. Cache not bumped yet.

## 2026-11-15: Place fields is computer only (Payment Schedule plan §8.2 step 5)

- **Decided (owner):** Place fields stays on a computer for now (Firma's editor can't place a
  field by touch and opens zoomed in on a phone; see the entry above).
- **Change (app):** `esignUI`: on a device with no mouse (`(any-pointer: fine)` false), Place
  fields says placing fields needs a computer and doesn't open the editor; sending still works.
  The Contract templates hint says "on a computer".
- **Docs:** plan §8.2 (Modified), build order step 5; End-State guide §32; README Status.

## 2026-11-15: Money carried from a lost pup is a credit (Payment Schedule plan §3.2a, D20)

- **Asked (owner):** build §3.2a, keeping the money right. Money becomes a credit only when she
  puts the family back on the list; a straight refund writes nothing.
- **Change (data):** a carry (a lost pup's **Carry it to their next pup**, a back-out's Move the
  deposit) adds a credit for funds received to the entry (`receivedCredits.carriedCredit`:
  every use ticked, dated by the lost sale's `deposit_date` else that day, "Carried over from
  *pup*'s sale", `from_sale_id`), never `carried_payment`. The next sale keeps its own price and
  deposit (no more inflated or short deposit). `recordPick` / `recordSideSale` still place the
  family at once when their credits leave nothing of the deposit to send (the sale's
  statement), the deposit received on the pick's / side sale's date, never the credit's;
  otherwise the rest is asked for. Placement no longer clears the carried money (that would
  have dropped the credit). An older `carried_payment` reads as one credit
  (`creditsWithCarried`) and moves into `received_credits` on the next credit write or
  placement. `from_sale_id` added to `referenceRegistry.js` (`SALE_REFERENCES`, scans).
- **Change (app):** the pick dialog, deposit dialog, family page status line and "deposit is
  already in" prompt, side-sale message, status-page pick note and lost-pup dialog say the
  carried money is a credit. Deposit received prefills the sale's `deposit_date`, else today:
  never a credit's date (the credit-covered `paidDate` split is gone).
- **Tests:** `tests/waitlistLostPup.test.js` (rewritten for the credit; +5: above, below, refund,
  side sale, a second lost pup), `tests/cloudWaitlist.test.js` (the back-out's moved deposit is
  a credit). `node --test` 1962 pass.
- **Found:** a back-out's Move the deposit counted that deposit twice in Financials: the
  cancelled sale kept it as earned and the next sale earned it again through the credit (the
  same before this change). Fixed in the next entry.
- **Docs:** plan §3.2a (Built), §11; End-State guide (credits, picks, lost pup, back-out,
  reference scans); Waitlist Spec §16.11 step 5 (Modified); Family Requests plan §7; README.
- No new files, no schema change (new fields sit inside `received_credits`, already private).

## 2026-11-15: A moved deposit isn't income on the cancelled sale

- **Decided (owner):** credits are funds held for the buyer to pay a future charge, not income
  until that charge is satisfied, so a deposit moved off a cancelled sale isn't income there.
- **Change (data):** `incomeView.ledgerComponents` takes `carriedOut`: on a released (not lost)
  sale, that much of what was paid is taken off its earned lines, the deposit first, then the
  rest in order. `carriedOutBySale(entries)` sums every entry's credits naming the sale
  (`from_sale_id`, an older `carried_payment` too), archived entries included;
  `getIncomeRows` loads archived entries for it (fee income and credits still skip them).
  It's earned on the sale the credit pays, once. Extras she kept and was paid for still count.
- **Tests:** `tests/waitlistLostPup.test.js` +3 (a moved deposit: 0 on the cancelled sale, 500 on
  the next, kept training still earned; Keep the deposit still earns it; an older
  carried_payment). `node --test` 1965 pass.
- **Docs:** End-State guide (sale income); plan §3.2a (Modified); Family Requests plan §7; README.
- `CACHE_NAME` bumped to `kennelos-shell-v142` (owner asked), covering this session's batch: the
  preview's field list, Place fields computer only, the lost-pup credit and this.

## 2026-11-15: Review fixes ranked (plan only)

- **New:** `docs/review/FIX_PRIORITIES.md`, nothing built. Each K1–K14 finding checked against
  `main` (`0abf39b`): files touched since its review, the build log's finding ids, the code
  where those disagreed. Already fixed: Waitlist Fixes steps 1–4, the Kels batch (K6-5,
  K8-5, K9-3/4/12, K12-10, K13-7/8/14), K10-1/2/12 via Payment schedules (to confirm with
  tests). Gone with Jotform: K12-2 and the Jotform halves of K12-3/6.
- **Order:** K03 (sync conflicts, untouched, released) first; K13's privacy policy and
  deploy gate alongside; then Waitlist Fixes step 5, K02+K01, K05, K09, K10's remainder.

## 2026-11-15: Live sync's conflicts, stuck states and restore (K03 review fixes)

- **From the review** (`docs/review/findings/K03-cloud-client.md`, all eleven). The rule is
  unchanged (the version the server receives last wins, whole record, plan §12 decision 3);
  what changed is that nothing is lost by timing and both devices are told.
  - **K3-1:** each version keeps its `base_seq` (Worker migration `0025_sync_base_seq`); a
    pull hands it on. `sync_meta` marks this device's own pushes (`mine`), so a pulled
    version built without seeing one is noted `replaced_mine` (an edit or a delete). A push's
    `superseded` names `overwrote_device`; a device's own version whose answer was lost is
    no one's loss.
  - **K3-2:** the 60-second poll (`pullIfBehind`) pushes before it pulls, as `syncNow` does.
  - **K3-3:** a record for a table this build lacks is set aside (`waiting`, one activity
    line, "some changes need an update" on the status line) and everything else still
    arrives; once the table exists the pull goes back for it. `fromError` records any other
    error as the stop `error` instead of throwing; the scheduler catches every run.
  - **K3-4:** sign-out, and signing in to another account, clear the sync state and
    `sync_meta`.
  - **K3-5:** a file that came down without its bytes keeps `missing_file` on its
    `sync_meta` row; `syncApply.retryMissingFiles` fetches it after each pull.
  - **K3-6:** Restore as of…'s confirm says the roll back reaches every syncing device; the
    activity list's advice says the same.
  - **K3-7:** `previewRestore` plans the vault part too when unlocked (`counts`), so a change
    to private fields alone can be rolled back.
  - **K3-8:** a join compares `updated_at` as times, and a date more than a day in the future
    never wins (`syncApply.joinKeepsLocal`), noted `clock`. A join that replaces a different
    local version notes it.
  - **K3-9:** Back up now on a syncing device that isn't in step says why; the status line
    blames the paused sync, not the internet (`getBackupStatus().syncWaiting`).
  - **K3-10:** every activity line says what happened, never that a version was "older".
  - **K3-11:** the Worker drops an unknown table per record (`unknown_table`) instead of a
    400 for the whole push; `GET /sync/head` carries a `fields` fingerprint, and a change
    clears `rejected`. Deploy order (Worker first) written in `cloud/README.md` and guide §34.
- **Not built in this entry:** keeping a lost version, and a per-record restore (the next
  entry). A version pushed before `0025` is never reported.
- **Release:** deploy the Worker, Apply pending (`0025`), then the app. Each half works with
  the other's older version (an older app ignores `base_seq` and `fields`; a newer app with
  an older Worker reports as before).
- **Tests:** `tests/cloudSync.test.js` +13 (each finding, two devices against the real
  Worker), `tests/syncActivity.test.js`, `cloud/tests/sync.test.js` +2. `node --test` 1980
  pass, `cd cloud && npm test` 346 pass, `node build/assemble.mjs` succeeds; Import/Export
  loads with no console errors in Pro and Lite.
- **Docs:** guide §34 and the cloud screens; Phase 2 plan §2.3, §5.2 (Modified); settings.js's
  sync state; `cloud/README.md`; README Status (`0025` to apply); `FIX_PRIORITIES.md`.
- No new app files, no Dexie schema change (`mine` and `missing_file` are unindexed fields on
  the device-only `sync_meta`), no syncRegistry change.

## 2026-11-15: Put mine back, and restoring chosen records from a backup

- **Asked (owner):** both follow-ups from the K03 batch above.
- **Put mine back:** new device-only table `sync_lost` (`db.version(8)`, in
  `DEVICE_ONLY_TABLES`, never in a file, a snapshot or sync). When a pull replaces or deletes
  a version this device loses (`kept_theirs`, `replaced_mine`, a join's older version; files
  rows aside), `syncApply` keeps the row as it was, in the page's transaction, and the
  activity line carries its id (`lost`). New `data/cloud/syncLost.js`: what differs from
  the record now, `putMineBack` (the kept row dated now, `markDataChanged()`, so the next
  push sends it to every device), `forgetLostVersion`, a 30-day sweep after each pull,
  cleared on sign-out, another account and turning sync off here. The activity list shows
  "Your version is kept on this device until …. It differs … in: …" with **Put mine back**
  and **Forget it**; Clear the list keeps those lines.
- **Choose records…:** Restore as of… offers Roll back everything or Choose records…, a
  ticked list (with a filter past 8) of what the backup would change or add back
  (`previewRestore().records`, one line per record, the vault part's whole row when it has
  one). `restoreSnapshot({ only })` restores just those, from both parts, pairing nothing;
  a chosen document or expense brings its file. `planCloudMerge` / `planVaultMerge` and
  their restores take `only`.
- **Tests:** `tests/cloudSync.test.js` +4 (a lost sent version put back reaches the other
  device; an unsent edit and a deleted record kept and put back; Clear the list and the
  30-day sweep; restoring two of three changed records with a document's file);
  `cloudDirty` (the new write sites), `cloudBackup` (schema 8), `syncRegistry` (device-only).
  `node --test` 1984 pass, `cd cloud && npm test` 346 pass, editions build. In Chromium, Pro
  and Lite open the database at version 8 with `sync_lost`, and Import/Export loads with no
  console errors. The two dialogs weren't driven in a browser (they need a signed-in,
  syncing device against a live Worker); their data paths are the tested ones.
- **Docs:** guide §5 (schema, device-only tables), §34, the cloud screens; Phase 2 plan §2.3
  (Modified); `FIX_PRIORITIES.md`.
- **Service worker:** `data/cloud/syncLost.js` in `PRECACHE_URLS`. `CACHE_NAME` bumped to
  `kennelos-shell-v143` (owner asked), covering this entry and the K03 batch above.

## 2026-11-15: The privacy policy says what's sent, and nothing deploys untested (K13 review fixes)

- **Asked (owner):** step 2 of `docs/review/FIX_PRIORITIES.md`. For K13-1, K13-2 and K13-3
  the owner chose to change the policy's words, not what the app sends. No `syncRegistry`
  change.
- **K13-1:** `site/privacy.html` §2 and §4 no longer say nothing reaches us without cloud
  backup: a linked KennelPort website sends what §9a lists either way.
- **K13-2:** §6 "What we keep" adds a sale's open Stripe payment link (and that opening it
  shows its amount), the business accounts table (name, type, website, referral
  link/code/instructions, the published fee rate, contract forms' labels and links, her
  payment link and instructions; never logins, her notes or the fee charge-back), vet
  summaries in Documents, and the waitlist preferences the form asks (sex, breed, colours,
  purposes, ready timing). "What we can never read" now excepts those.
- **K13-3:** §4 gets a Google Drive bullet (Furever content packs to her own Drive,
  `drive.file`, readable by anyone with the folder's link, unticked files trashed on the
  next publish) and §12 a Google Drive row. Terms §12 names Google Drive too. Both pages
  last updated 15 November 2026.
- **K13-12:** the upgrade dialog on `site/editions.html` leads with the backup file, and
  says cloud backup alone doesn't carry the private details without private backup (the
  caveat `site/upgrade/` already had).
- **K13-15:** new `build/checkImports.mjs`: `assemble.mjs` fails any target (every build,
  not only `--release`) whose `dist/` has a relative static import, inline-module import or
  `<script src>` naming a file it doesn't ship. `deploy.yml` gets a `test` job (Node 22,
  `node --test`, which covers `cloud/tests` too) that the publish matrix `needs`, and the
  build legs move from Node 20 to 22.
- **Tests:** new `tests/checkImports.test.js` (a complete build passes; dropped imports,
  `export … from`, inline modules and a `?v=` script src are reported; dynamic `import()`
  and absolute URLs are skipped). `node --test` passes; all five targets build with the
  check on. Deleting a file from `dist/lite/` made the check list its 62 importers.
- **Docs:** guide §0 and §3, `build/README.md`, `FIX_PRIORITIES.md`.
- **Service worker:** no app file added or changed; no bump needed.

## 2026-11-15: Money a family is shown (Waitlist Fixes plan step 5; D9 decided)

- **Decided (owner), D9:** nothing is refunded when a family backs out (breeders' contracts
  make every payment non-refundable on a back-out); she chooses how much of what they paid
  to apply as a credit. D8 follows: a family page only is Keep only.
- **K8-2 (S1):** `approveBackOut` takes `outcome` `keep` or `move` and, for `move`, `credit`
  (0 up to what they paid beyond their credits; left out, the deposit they paid). `refund`
  is refused; a refund decided before still reads. The amount is stored on the decided
  `back_out_request` (private) and written as the usual carried credit (none at 0), so
  Financials keeps only the rest as income. New `backOutMoney(entry, sale)` (`parts`, `paid`,
  `suggested`) and `incomeView.paidOnSaleByPart` (what was paid, line by line, from the
  statement; `paidOnSale` now sums it). The family page's back-out buttons are **Keep what
  they paid** / **Back in line with a credit** / **Decline** (More options… and its REFUND
  confirm are gone); the confirm says "They've paid $X on this sale: deposit …, balance …,
  transport …", "Nothing is refunded", and asks the credit's amount. Kels's Review my
  waitlist and its "the family backed out" path do the same (and Kels no longer offers a
  credit to a family page only; its policy suggestion read the wrong field and always said
  keep). Policy labels, the Kennel page hint, the timeline line, both emails' default words
  and the family page's line ("You have a $X credit toward your next puppy", from their
  published credits) follow. The refund email is no longer one she edits or is offered.
- **K8-3:** `cleanSteps` keeps a paid step's stored amount and spreads the rest over the
  unpaid steps; `readExtraCharges` refuses an amount below what's paid, or any change to an
  extra paid in full. New `chargePaid`. The Sale page's hint says so. `backOutItems` reads
  amounts, not percents.
- **K8-4:** already true since the lost-pup credit (the carried amount is a published
  credit); now a test (the family's view after a back-out has `credits.received` 500).
- **K8-13:** "a pup they lost" → "an earlier sale" in the pick dialog, the picks panel's
  message, the pick's activity line and an older carried payment's note; a kept, paid extra
  says "paid", not "still owed"; "to back out of your puppy's sale"; "driving miles aren't
  available right now" (entry page and Kels).
- **K6b-5:** a fee recorded from her Stripe link (`checkFeePayments` → `feeReceived` with
  `manual: false`) no longer sets `fee_received_manual`, so it offers no undo that the next
  check would reverse.
- **K6b-8:** `undoExpire` applies a fee they paid online meanwhile (`fee_paid_online`) as
  `approve` does (shared `onlineFeeReceived`): on the list from the day they paid.
- **Tests:** `backOut.test.js` (summary with credit and kept money, paid by part, "paid"
  extras), `waitlistLostPup.test.js` +2 (a credit above the deposit, capped at what they
  paid, the rest income; back in line with no credit), `cloudWaitlist.test.js` (refund
  refused, keep; K8-4's published credit), `waitlistFamilyPages.test.js` (D8 with D9),
  `waitlistPupSelected.test.js` (emails), `extraCharges.test.js` +2 (K8-3),
  `waitlistUndo.test.js` +2 (K6b-5, K6b-8). `node --test` passes; editions build. In
  Chromium the waitlist, family, kennel, sale and Kels pages load with no console errors;
  the back-out dialog itself wasn't driven with data.
- **Docs:** Waitlist Fixes plan (D9 decided, D8 modified, step 5 built), Family Requests
  plan §7 and D13 (Modified), End-State guide (income, extra steps, credits, undo windows,
  backing out, family pages, Kels), README, `FIX_PRIORITIES.md`.
- **Service worker:** no file added or renamed.
- **Then (owner):** putting a family back in line asks first. **Put them back in line**
  (was "Back in line with a credit") → "Credit what they paid toward their next pup?"
  **Yes**, with the amount prefilled as all they paid beyond their credits and editable, or
  **No, keep what they paid**. `backOutMoney.suggested` and a missing `credit` are now all
  they paid, not the deposit. Kels asks the same. Tests follow (`waitlistLostPup`,
  `cloudWaitlist`: the back-out without a named credit credits the 800 paid).
- **Then (owner):** the family-facing words. Their status page and the Keep email now say
  "Per your contract terms, all monies paid related to this sale are non-refundable and are
  forfeit upon sale cancellation." (back in line with nothing credited too); the back-in-line
  email says any monies not credited are non-refundable and forfeit. Only the default
  templates change: a breeder's own reworded email stays hers.
- **Then (owner):** the Keep email no longer ends "If you'd like to talk it over, send us a message from your status page."

## 2026-11-15: Every back-out she records goes through the back-out confirm

- **Asked (owner):** a walkthrough of a back-out found End the sale… → "They backed out
  (Cancelled)" and Cancelled on the Sale page only cancelled the sale: the family stayed
  Placed on a cancelled sale, nothing recorded the back-out, and they never left the list.
  Only Kels's path was right. The owner: most back-outs forfeit everything and leave the list.
- **Change:** new `waitlistUI.backOutDialog({ entryId, outcome?, note? })`, the one confirm
  (moved out of the family's page): what they paid, then, without an outcome, "What happens
  to *family*?" with **The sale is cancelled and they leave the list (keep what they paid)**
  first and **Put them back in line** (not for a family page only), the credit question for
  back in line, what comes off, the pup back to Available, the summary, Approve →
  `approveBackOut` (their request, else `told` with End the sale's note), then the outcome's
  email. New `waitlistActions.backOutEntryFor(saleId)`. End the sale… → They backed out opens
  it (no bare status change); the Sale page saves her other changes with the old status, then
  opens it, and if she cancels it says the sale wasn't cancelled. The family's page buttons
  open it with their outcome.
- **Also:** the Today nudge says "cancel the sale and keep what they paid, or put them back
  in line"; her status card says "Backed out of *pup* *date*; what they paid was kept", not
  "Withdrew".
- **Tests:** `waitlistLostPup.test.js` +1 (`backOutEntryFor`: the family, nobody for a
  walk-in buyer, nobody once cancelled; told recorded as hers). `node --test` passes. In
  Chromium, against the real pages: their request → Keep; End the sale… → They backed out →
  Keep; Sale page → Cancelled → Keep: each leaves the family Withdrawn, the sale Cancelled,
  the pup Available. Sale page → Cancelled → Cancel leaves the sale Deposit paid and the
  family Placed, with the "Not cancelled" note. No console errors.
- **Docs:** End-State guide (backing out), Waitlist Spec §16.11 and Family Requests plan §7
  (Modified).

## 2026-11-15: Restore, import and identity matching (review K02 + K01, fix priorities step 4)

- **K2-1 (S1):** backups now carry `app: 'kennelos'` (`BACKUP_APP`; optional, no format bump:
  older builds ignore it). `inspectBackup` refuses another app's file (Furever's says so by
  name) and a file with no KennelOS records, before Merge or Replace can run; it returns
  `records`. The unknown-tables line says what it is ("this version of KennelOS doesn't
  have… If you didn't make this backup with KennelOS, don't restore it"), and Replace's
  confirm names both counts (`countRecords()`).
- **K1-1 (S1):** `dogSearch.nameKey` keeps a short bare number ("Thornfield Blue 1" ≠ "Blue 2");
  a registration-like run of digits is still dropped. Littermates by registered name alone
  are only `possible` in the tidy-up and Scan for duplicates, and asked about (never paired
  by themselves) in a backup merge.
- **K1-6:** one Dog Card id is one dog: `RULES.dogs` pairs on `public_id` first;
  `compareDogs` makes it `certain` ("KennelOS ID"); both scanners bucket on it and
  Scan for duplicates shows it as shared. A card whose dog two of hers hold is refused,
  naming both, until she merges them.
- **K1-3:** a dog merge never copies `public_id` (it was refused as taken by the duplicate
  still holding it); the kept dog takes the dropped one's id after the delete.
- **K2-5:** `applyDogCard` writes in one transaction (an `async` callback: a bare promise
  ended it early in Chromium, PrematureCommitError, caught by the browser check), leaves out a
  dog the repo would refuse (`cardDogProblem`, named in the preview and the result), and
  reuses a contact of the same name rather than adding one per retry.
- **K2-6:** an update row lists each change `from → to`, has Update from the card / Keep mine
  (`skip` honoured for updates: `kept`), and starts on Keep mine when her copy changed after
  the card was made (`mineIsNewer`). The footer says which fields an update sets.
- **K2-2:** `markRepeatedRows` with dog and contact `batchKeys`: the same record on several
  rows of one CSV is one; later rows wait for review naming the first.
- **K2-3:** `detectDateOrder`; `normDate` reads the file's order; `buildPlan` takes
  `{ dateOrder }` and returns `dates`; the preview offers month/day first when unsure and shows
  each row's dates as read.
- **K2-4:** the CSV preview's update rows list `field: old → new`.
- **Tests:** `importExport.test.js` (+1 K2-1), `cloudVault.test.js` (the `app` stamp),
  `tidyRules.test.js` (+2), `restoreMatch.test.js` (+2), `recordMerge.test.js` (+1),
  `dogCard.test.js` (+3), new `csvImportPlan.test.js` (3). `node --test` 2007 pass. In
  Chromium: a Furever backup at Restore is refused; a CSV with Juno twice and an either-way
  date previews as one update (status and colour from → to), one review naming row 2, and
  Wren's date flipping to 5 January on "day first"; a Dog Card with Duke's 2047 birthday adds
  Star and names Duke left out; the same card resent after her edit starts on Keep mine with
  both changes from → to. No console errors.
- **Docs:** End-State guide §9, §10 (backup, merge rules, duplicates), dog identity, Dog Cards;
  `FIX_PRIORITIES.md`.
- **Service worker:** no app file added or renamed.
- `CACHE_NAME` bumped to `kennelos-shell-v144` (owner asked), covering this session's batches:
  the K13 policy and deploy gate, Waitlist Fixes step 5 and the back-out flow, and fix step 4.

## 2026-11-15: K5-3 decided (plan only)

- **Decided (owner):** the licence wall offers **export only**: a "Download a backup of this
  device" control on every wall, no read-only access to her records behind it. Recorded in
  `docs/review/FIX_PRIORITIES.md` §4 for step 5 (K05), which is next. Nothing built.
- **Then (owner):** `FIX_PRIORITIES.md` §1 and §2 brought up to date: what steps 1–4 and the
  Waitlist Fixes step 5 built, and what's still open in K13 (K13-4 to -6, -9 to -11, -13),
  K02 (K2-7 to K2-14), K01 (K1-2, -4, -5, -7 to -10) and the Waitlist Fixes plan.

## 2026-11-15: Fix step 5, K05 (assisted setup, the licence wall, the vault)

From `docs/review/findings/K05-vault-licence.md`, with K04-6 (the `/ops` delete).
- **K5-1 (S1):** `cloudAssist.redeemAssistLink` refuses a link for another program on a device
  holding any record (`AssistDeviceInUseError`, `deviceHoldsRecords`); the session the link
  made is signed out before anything is stored, so Dana's records can't sync into Mia's account.
- **K5-2 (S1) + K4-6:** Delete an account is two steps on both doors. `program.accountSummary`
  (moved out of `ops.js`), `summaryFingerprint`, `maskEmail`. `/ops` shows the masked address,
  the newest backup (date, size, counts), devices to the minute and support's involvement, and
  refuses a delete whose fingerprint changed. The manager app has `api/delete-lookup` → a
  ten-minute HMAC token for that account; `api/delete` needs it (`look_up_first`,
  `lookup_expired`, `account_changed`). Erase is off by default on both.
- **K5-3:** every licence wall offers "Download a backup of this device" once the device
  holds a record; the renewal wall gains "Free a lost device's slot".
- **K5-4:** Settings → Account offers *End support's access* in setup once her device holds
  the vault key; her End help in setup sets the program `idle` (the Worker's `endHelp`).
  The setup line and the "Later" confirm say support stays signed in until she finishes or ends it.
- **K5-5:** `unlockAutomatically` waits on an open automatic request (`auto` kept on the
  pending pairing row) instead of asking on every page load; pairing errors have their own
  wording, and `too_many_pairings` is in `errorText`.
- **K5-6:** the two account-recovery messages swapped to their real cases, each with a next step.
- **K5-7:** `setUpForHer` checks `entitlement()` before turning anything on; `pro_required`
  has wording in `errorText`.
- **K5-8:** Hand back wipes the device even offline; End help is kept as
  `kennelOS.assistEnd` and sent by `cloudDevices.finishAssistEnd` (boot, online, after an
  erase). Her End help wording says the wipe happens when support's device next opens.
- **K5-9:** wider default variant patterns (`DEFAULT_LIFETIME_PATTERN`,
  `DEFAULT_YEARLY_PATTERN`); Pro's config uses the same; the shared, Lite and Demo configs
  no longer carry an old yearly pattern of their own.
- **K5-10:** `/ops` and the manager say a device away more than 90 days keeps its copy.
- **K5-12:** `POST /vault/wraps` is owner-only.
- **K5-14:** Pro's config comment on the lifetime check-in, and the guide's "Pro on the
  server" (it gates sync, alerts and integrations too).
- **Left open:** K5-11 (the helper exemption is a `localStorage` flag) and K5-13 (the manager
  cookie can't be revoked: needs a table, so a migration).
- **Tests:** cloud `assist.test.js` (+2, two changed), `accountDeletion.test.js` (+1, the
  fingerprint); `cloudClient.test.js` (+5: the link guard, a same-program link, the reused
  pairing, an offline hand back); `license.test.js` (+2). `cd cloud && npm test` 349 pass,
  `node --test` 2016 pass, the build succeeds. In Chromium on the built Pro edition: an empty
  device's activation wall offers no backup; a lapsed monthly with one dog gets the renewal
  wall with "This device holds 1 record" and a working download, at 320 px.
- **Docs:** End-State guide §0.3 and the cloud section (deleted accounts, assisted setup,
  Pro on the server); `KennelOS_Assisted_Setup_Plan.md` §1–§3; `FIX_PRIORITIES.md`.
- **Service worker:** no app file added or renamed. `CACHE_NAME` not bumped.

## 2026-11-15: Fix step 6, K09 (breeding reminders)

From `docs/review/findings/K09-dogs-litters-nudges.md`. K9-4 (an open heat counts as over
after `HEAT_OPEN_DAYS`) was already on `main`.
- **K9-1 (S1):** an Expected litter no longer silences the due-date nudges. `pairingduesoon`
  and `pairingoverdue` count only litters past Expected; with an Expected one on file they say
  "get ready for the pups" / "has she whelped?" and offer **Record the birth** (Kels's
  `record-litter` on it). New `litteroverdue`: an Expected litter past its date (its pairing's
  due date, else its whelp date) that no pairing nudge covers.
- **K9-2:** the Pairing page's due date follows a corrected first date while it's still the
  63-day prefill.
- **K9-3 (root):** a litter made from its pairing is dated the pairing's due date (else first
  date + 63, else blank), with the ready date 56 days on, not today.
- **K9-5:** `dogCare.damIsBusy`; `heatForecast(…, { pairings, litters })` leaves out a dam
  bred, expecting or nursing (litter under 56 days). Today and Kels's check-in count pass them.
- **K9-6:** `dogCare.livesHere`: the heat watch and this month's preventatives leave out a
  leased-out dog and a co-owned dog living with its co-owner.
- **K9-10:** `promote` ages a kept pup from her litter's whelp date when her DOB is blank.
- **K9-13 (folded in):** `linkedStatusNudges.test.js` builds local dates, not UTC.
- **Tests:** `linkedStatusNudges.test.js` (+3, one changed), `dogCare.test.js` (+2).
  `node --test` 2021 pass; the two files also under `TZ=Pacific/Pago_Pago` and
  `Pacific/Kiritimati`. In Chromium: the pairing's due date moves 05-03 → 05-24 with the first
  date and keeps a typed 05-30; a litter from a pairing due 12-01 opens Expected, 12-01, ready
  2027-01-26. No console errors.
- **Docs:** End-State guide (Pairing and Litter fields, the dogs she looks after, §19's table).
- **Service worker:** no app file added or renamed.
- `CACHE_NAME` bumped to `kennelos-shell-v145` (owner asked), covering fix steps 5 (K05) and 6 (K09).

## 2026-11-15: Fix step 7, K10 remainder and K12's Stripe items (money in her own books)

From `docs/review/findings/K10-money.md` and `K12-integrations-notifications.md`.
- **Decided (owner):** K10-4: each payment's processing fee is on the payment that paid it, and
  stays a cost when a sale ends, a refund included. Breeders charge back the fee of a payment
  made through an account like PayPal business, collected with the final payment, which is always
  cash or Zelle (no fee of its own). The fee built into the price (`fee_passed_to_buyer`) is for
  marketplaces like GoodDog that forbid a separate fee; both are needed. K10-13: currency is out
  of scope unless KennelOS goes international.
- **Fees charged back on the final payment:** `extraCharges` `paymentFeeChargeBack`,
  `feeChargeBackOffers`, `chargesWithPaymentFee`; `paymentSchedule.saleCharges` puts every
  `fee_for` charge on the last due date only (`finalOnly`, `coveredTotal({ final })`). Record a
  payment asks to charge a payment's fee back; an edit moves it, removing the payment removes it;
  Kels's Pups are going home offers every fee not charged back yet. Never on a sale whose fee is
  in the price. `addedFees` and the schedule editor's cover choices leave them out.
- **K10-4:** `incomeView.feeComponents` puts the deposit's part (`depositFeePart`: Stripe's
  report, else the paid-via estimate) on the deposit and the rest on the other parts; a released
  sale keeps the fee of money taken, a voided one included. `getIncomeRows` loads accounts.
- **K10-1, K10-2, K10-12:** fixed by Payment Schedules; regression tests with the reviewer's
  scenarios.
- **K10-3:** the Litter page's total leaves out ended sales (listed, struck through);
  `litterFinances` counts only sales still going as puppies sold.
- **K10-5:** undated sale and stud income is filed under the day the record was entered.
- **K10-6:** P&L's `rowsIn(range)` counts only money dated inside a custom range.
- **K10-7:** `familyCredit`'s date is the latest credit it used.
- **K10-8:** a credited fee is on the litter of the sale `feeCreditsBySale` credits.
- **K10-14 (and the D17 gap):** Financials' Adjust no longer changes a sale's status (a link to
  the Sale page); a fee still at its estimate follows a price change; a new transport fee or
  boarding asks about the schedule.
- **K12-1:** `makeSaleLink` asks Stripe about the open link first; paid, it records the payment
  and throws `LinkAlreadyPaidError` (Send payment link says so; nothing is sent).
- **K12-3 (Stripe half):** `checkStripePayments` catches per sale, keeps `stripeErrors` per
  account, and still checks the others; the Accounts card and account health show it; connecting
  a new key clears it.
- **Tests:** `paymentSchedule.test.js` (+1), `processingFees.test.js` (+1, one changed: a voided
  sale keeps its deposit's fee as a cost), new `litterFinances.test.js` (4), `familyMoney` (+1),
  `familyPayments` (+2), `contractSchedule` (+1), `stripePayments.test.js` (+2, one changed).
  `node --test` 2033 pass. In Chromium: a $1,000 PayPal payment on a 50%/final schedule asks to
  charge back $35.39, which goes on the final payment ($1,535.39; Payment 1 stays $1,000);
  Adjust shows the status with a link. No console errors.
- **Docs:** End-State guide §21 (Financials, per litter, §21.1, §21.2), the reports, §32 Stripe;
  `KennelOS_Payment_Schedule_Plan.md` (Modified note); `FIX_PRIORITIES.md`.
- **Service worker:** no app file added or renamed. `CACHE_NAME` not bumped.
- `CACHE_NAME` bumped to `kennelos-shell-v146` (owner asked), covering fix step 7.

## 2026-11-15: Fix step 8, edition gates (review K13 + K11)

Owner's decisions: Demo blocks the Companion and Furever saves and Google Drive (K13-6); Kels in
the Demo walks a task to its review, then says so and keeps nothing (K11-5); Lite's CSV refuses
leased ownerships, restores aren't changed for them (K13-4); a restore over the litter cap is
refused all or nothing (K13-5).
- **K13-4:** `csvImport` dog rows: with `externalOwnership` off, a leased row, an external row
  with an owner, or an update to either goes to review ("isn't available in this edition"). A new
  external row with no owner still lands pedigree-only.
- **K13-5:** new edition hook `enforceImportLitterCap({ incomingLitters, mode })` (no-op in
  shared/Pro/Demo; Lite counts the raw litters after the restore). File Replace and Merge, cloud
  and vault restores await it beside the dog hook. Import/Export and cloud restore messages name
  litters when that's the cap.
- **K13-6:** Companion's template Save and Furever's kennel-identity Save are replaced by a demo
  line; Furever's prefill shows without being kept; Furever's Drive card (Connect, Publish) isn't
  drawn in the Demo.
- **K13-9:** `dogRepo.update(id, changes, { capExcludeIds })`, passed by `mergeDuplicate` for the
  duplicate it deletes next; Lite's `enforceDogCap` leaves those out. Scan for duplicates and
  Tidy up show the upgrade nudge on a cap refusal.
- **K13-11:** the welcome card's sales, documents and dogs lines follow `editionFlags`.
- **K11-1 (dog-cap half):** `litterCapStatus()` (new read, all four configs). Record a litter
  stops before any question at the litter cap; "A dog that isn't in KennelOS yet" shows the
  nudge with no room (`roomForNewParent`); `saveGuidedLitter` checks room for every new parent
  (`newParentsToMake`) before making any.
- **K11-5:** `StepConversation.demoEnd` (Yes, build it in the Demo); the four drafted tasks
  don't store a draft in the Demo; Save for later says it can't keep one there.
- **K11-17:** `?task=` opens the menu when the task isn't `available()`.
- **Tests:** new `tests/liteCap.test.js` (12) on the real Lite config through new
  `tests/support/liteHarness.js` (`installMemoryDb` takes a `dbUrl`); `editionConfig.test.js`
  checks the two new hooks. `node --test` 2045 pass; `node build/assemble.mjs` (and `--release`)
  green. In Chromium on `dist/demo`: Companion and Furever show the demo lines, no Drive card, no
  `furever` key stored; Add dogs runs to its review and ends with the demo line, no draft;
  `?task=get-started` opens the menu. On `dist/lite`: the welcome card says "buyers and
  deposits", no documents line; `?task=add-people` opens the menu. No page errors.
- **Docs:** End-State guide §0, §0.1, §0.2, the restore section, §33 (Kels's voice, the menu,
  the litter save); cap spec §1 and §9 (Modified notes); `FIX_PRIORITIES.md`.
- **Service worker:** no app file added or renamed. `CACHE_NAME` not bumped.

## 2026-11-15: What "lifetime" means, and the end-of-life build

The owner asked whether "lifetime" commits KennelOS to hosting forever. Nothing promised that,
but nothing defined "lifetime" either, the Pro page said lifetime keys need "no re-validation,
works offline indefinitely" (they check in every 90 days), and a shutdown would have walled
every lifetime owner within four months, because the key's check needs Lemon Squeezy. The owner
chose a final build, and Mississippi law.
- **Build:** `build/finalRelease.mjs` + `node build/assemble.mjs --final`: each edition's
  config nulls `cloudUrl`, `devCloudUrl`, `kennelportUrl`, `devKennelportUrl`, `upgradeUrl` and
  `demoUrl`; Pro's `licenseGate` is `false`; `CACHE_NAME` gets `-final`. Throws on a missing
  anchor. The deploy passes `--final` while the repository variable `KENNELOS_FINAL_RELEASE` is
  `true`. The shutdown order (notice, final build, then the Worker and the store) is in
  `build/README.md`.
- **Terms:** §9 defines lifetime (the life of KennelOS Pro, not the buyer's; no promise to run
  anything for a set time) and says the final version makes no checks; §14 adds "If KennelOS
  ends" (90 days' notice in the app, a final Lite and Pro with no key and no server, kept online
  at least 12 months, no updates promised after); §18 is Mississippi law and courts. Privacy
  §18 says 90 days and that the final version sends nothing.
- **Site:** the Pro page's lifetime card says "for as long as Pro is offered" and "3 months
  offline between check-ins", with a "What lifetime means" link (also on the upgrade page, the
  home page and the editions page); a new FAQ, "What does lifetime mean?".
- **Tests:** new `finalRelease.test.js` (6). `node --test` 2039 pass. In Chromium, the final Pro
  opens to Today with no key, Dogs, Waitlist, Settings and Reports render, and no request leaves
  the origin; the normal Pro build still walls.
- **Docs:** End-State guide §0, §0.3, §3; Editions Plan "Licensing"; Cloud Accounts Proposal
  (Modified note); `build/README.md`; `tests/README.md`.
- **Service worker:** no app file added or renamed (the site isn't a PWA). `CACHE_NAME` not bumped.

## 2026-11-15: Fix step 9, K04 (Worker resilience)

Owner's decisions: an orphaned migration doesn't gate (9-A); support's helper device may take
over backing up, named as support (9-B); K5-13 rides this branch's migration (9-C).
- **K4-3:** `scheduled` runs each job (retention; waitlist moves, email changes, digests, both
  e-sign jobs) in its own `try`, logging `<job> failed`. `runWaitlistMoves` reads the kennels'
  ids a page at a time (`MOVES_PAGE`), then one projection body at a time.
- **K4-4:** `runRetention` runs its D1 purge first; the R2 sweep runs last in its own `try`
  (`r2SweepError`), and R2 deletes after their rows went are caught (`r2DeleteError`). /ops's
  Retention done line says either.
- **K4-12:** `fetch` is one `try` around a `route()`; CORS is filled in as soon as it's known.
- **K4-1:** `runKennel` queues its events, hold deletes and projection write and sends them in
  one `db.batch`, each conditional on the version it read (`AT_VERSION`), the projection last;
  a deadline's offer takes the close's seq inside the batch (`json_set … MAX(seq)`). A lost
  race writes nothing, sends nothing and returns `lost: true`. Notifications and emails go only
  after the batch lands; a send that throws is recorded `failed` (`emailOnce`). The offer email
  keeps its `turn_id` id: with the batch only the run that landed sends it.
- **K4-7:** the fee reminder goes from the open day before through the due day; the default
  `fee_reminder` subject names the date (`[Pay by]`). The turn's last-day reminder stays on its
  day (after it the turn has ended); the halfway one already caught up.
- **K4-2:** `schemaIsCurrent` counts an orphan as current; /ops says what an orphan means and
  that the API still serves; a drift still gates.
- **K4-5:** `headFile` / `putFile` ask R2 (`FILES.head`) as well as the `files` row, so a row
  whose object is gone reads 404 and a PUT stores the bytes again; `GET /snapshots` leaves out
  a backup whose body R2 doesn't have. `latestSnapshot` is left as the push base.
- **K4-8:** migration `0026` adds `email_changes.failed_at` / `failed_reason`. A waiting change
  whose address was taken is kept, marked failed, never retried; `emailChangeState` returns
  `failed`; a new request clears it; retention clears it after 30 days. The app keeps it as
  `emailChangeFailed` and the Account card and Today say "Your email change didn't happen" with
  OK (which dismisses it on the server).
- **K5-13:** `0026` adds `manager_sessions`. A manager sign-in is a random id, signed with
  `OPS_TOKEN` and stored as a hash; Log out deletes it; /ops's **Sign every manager app out**
  ends them all; retention clears expired ones. Existing manager cookies stop working (sign in
  again).
- **K4-10:** /ops pages send a CSP that allows no script (`default-src 'none'`, inline style,
  `form-action 'self'`, `frame-ancestors 'none'`), with `nosniff` and `no-referrer`.
- **K4-13 (9-B):** left open on purpose and said beside `OWNER_ONLY`; `backingInfo` and the
  device list mark a helper device `helper: true` (its label already reads "KennelOS support").
- **Tests:** cloud: new `cronResilience.test.js` (5); `serverMoves` (+4), `backup-api` (+2),
  `migrate` (+1), `emailChange` (+1), `assist` (+2), `ops` (+1); the R2 stand-in has `head`.
  App: `cloudClient` (+1). `cd cloud && npm test` 365 pass; `node --test` 2068 pass;
  `node build/assemble.mjs` green.
- **Docs:** `cloud/README.md`; End-State guide §29 (the fee reminder, server moves), §30
  (files, the email change, the helper backing); Cloud Phase 1 plan, Assisted Setup plan, W2
  plan (Modified notes); README Status (`0026` to apply); `FIX_PRIORITIES.md`.
- **Deploy:** the Worker, then Apply pending on /ops for `0026`, before the app (its Account
  card reads the new `failed` field, and ignores it when absent).
- **Service worker:** no app file added or renamed. `CACHE_NAME` not bumped.
- `CACHE_NAME` bumped to `kennelos-shell-v147` (owner asked), covering fix steps 8 and 9 and the lifetime / end-of-life build batch.

## 2026-11-15: Contract field: the price plus one extra (`priceWithExtra`)
- **Why:** an extra's own agreement (an extended-stay package) prints a "Combined Total": the
  pup's price plus that package's fee, nothing paid subtracted. No field held it
  (`totalCharges` is everything on the sale; `balanceDue` has payments taken off).
- **Built:** `contractForms.PREFILL_FIELDS.extra` gains `priceWithExtra` (the sale's `price`, with
  any Full surcharge, plus the extra's amount); Firma label "Extra · Price + sale price".
- **Tests:** `contractAddOns` (+1 assert); `priceTable` field count 88 → 89. `node --test` 2068 pass.
- **Docs:** End-State guide (the extra agreement's fields).
- **Service worker:** no app file added or renamed. `CACHE_NAME` not bumped.
- `CACHE_NAME` bumped to `kennelos-shell-v148` (owner asked), covering the `priceWithExtra` contract field.

## 2026-11-15: Transport and boarding fields fill on every contract on a sale
- **Why:** the editor offers every field on every template (D38), but a send filled only the
  form type's groups, so Transport · Fee placed on a sales contract came out blank. Owner:
  her sister sends four contracts, but someone else may want one sales contract that lists
  transport and boarding.
- **Built:** `contractForms.fieldGroupsFor`: every kind on a sale fills `sale`, `transport`
  and `boarding`; `extra` stays on the Extra agreement (its row names the extra); stud
  service, lease and foster unchanged. Transport fills on a kind other than a Transport
  agreement only when the sale has a transport fee (boarding already needs deferred
  boarding). The Send preview's "doesn't fill on this kind" note follows (`previewNotes`).
- **Tests:** `contractAddOns` (+1; the Extra agreement now carries the sale's transport and
  boarding); `contractForms` (co-own and Other groups). `node --test` 2069 pass.
- **Docs:** End-State guide (the field groups); Integrations plan (Modified note).
- **Service worker:** no app file added or renamed; rides `kennelos-shell-v148`.

## 2026-11-15: Field guide for placing fields in Firma's editor
- **Why (owner):** a reference that helps people pick the right prefill, with every label,
  how it's worked out and an example, A–Z or by type, that stays up while they're in Firma's
  editor; and general help on the workspace (a second signer, Text type for every prefill).
- **Built:** `data/prefillGuide.js` (pure: `guideRows`, `GUIDE_GROUPS`, `EXAMPLE_STORY`; the
  examples are `prefillValues` on made-up records). `assets/fieldGuideUI.js`
  (`openFieldGuide`): a Picture-in-Picture window, else a pop-up, else an on-page panel; tabs
  Fields (by type / A–Z, filter, Copy) and Using Firma's editor. Contract templates gains a
  **Field guide** button and offers it again after Place fields opens the editor; its hint
  there now says a Text field with Prefilled Data set to the label.
- **Tests:** new `prefillGuide.test.js` (3). `node --test` 2072 pass; `node build/assemble.mjs`
  green (Lite drops `fieldGuideUI.js`).
- **Docs:** End-State guide (Contract templates: the Field guide).
- **Service worker:** `assets/fieldGuideUI.js` and `data/prefillGuide.js` added to
  `PRECACHE_URLS`; `fieldGuideUI.js` in `proPages`. Rides `kennelos-shell-v148`.

## 2026-11-15: Field guide: Sample sales tab, tabs reordered
- **Why (owner):** show, on sample sales set up different ways (with and without a plan;
  transport, boarding, an extra; credits or money already in, and none), which money detail
  to place on each line of a contract to get each figure, with red boxes on where it comes
  from; and put the Firma help first.
- **Built:** `data/prefillSamples.js` (pure: `SAMPLE_SALES`, `sampleSale`, `saleFacts`): six
  samples, each the sale's parts and a sample contract's price section (lines with the
  detail, value or why it's blank, how it's worked out, and the sale parts it comes from;
  an "adds up" check per section). `fieldGuideUI`: tabs Using Firma's editor (first, the
  default), Fields, Sample sales (picker; a line outlines its sources in red; the sale card
  sticks). The Contract templates button opens the first tab; after Place fields, Fields.
- **Tests:** new `prefillSamples.test.js` (3). `node --test` 2075 pass.
- **Docs:** End-State guide (Field guide).
- **Service worker:** `data/prefillSamples.js` added to `PRECACHE_URLS`. Rides `kennelos-shell-v148`.

## 2026-11-15: Stay and pickup, Add charges, contact → waitlist page
- **Why (owner):** adding a staying extra on the Sale page offered neither the stay nor the
  pickup; a contact needed a way to its waitlist page; the family's page needed a way to add
  an extra, transport or boarding to their sale (with or without a request; no email).
- **Built:**
  - `goHome.stayPickupPlan` / `addedStays` / `afterStays` (pure) and `assets/stayPickupUI.js`
    (shared): one dialog for the stay(s), boarding and the pickup the day after (an earlier
    pickup moved), every date editable. After the Sale page's save (after the schedule
    question), after approving a family's stay extra (replacing the stay-only prompt), after
    Add charges. Today: `training-stay` adds **Log the stay and the pickup**; the go-home
    pickup nudge defaults to the day after any stay still to end.
  - `waitlistActions.addSaleCharge` and Interact's **Add charges…** (Extra from the price
    list or typed / Transport with the quote and Get driving miles / Boarding from the
    standard rate); an address request gains **Add transport…**.
  - `waitlistRules.entryForContact` and the Contact page's **Waitlist page →** button (one
    not closed, else the most recent; placed with an open sale counts as not closed).
- **Tests:** `goHome` (+3), `waitlistRules` (+1), `cloudWaitlist` (+1). `node --test` 2080 pass; `node build/assemble.mjs` green.
- **Docs:** End-State guide (training stays, Stay and pickup, the nudges, Add charges, the
  Contact page); Family Requests plan §6 (Modified note).
- **Service worker:** `assets/stayPickupUI.js` added to `PRECACHE_URLS` (shared). Rides
  `kennelos-shell-v148`.

## 2026-11-16: Fix step 10, K14 (multi-kennel scope, Companion, Furever)

Owner's decisions: the Furever identity rides on her own kennel, cloud tier (K14-5); a litter
publish warns on every pup's document, per-pup packs later (K14-3); a Dog Card's microchip only
for a sent dog still in her program (K14-15); an outside dog's expense goes under its stud
service's kennel, else All kennels only (K14-11).
- **K14-6:** `kennelRepo.update` refuses unticking an own kennel while owned or co-owned dogs,
  pairings, litters, sales, stud services, contracts, documents or waitlist rows (archived too)
  are filed under it (`ownKennelHolds`); the message counts them and points to archiving.
- **K14-9, K14-10:** Reminders, Stud Services and Documents follow the active kennel, with the
  scope chip (Documents opened for one dog stays unscoped).
- **K14-11:** `scopePredicates.expenseInScopeOf` / `isUnplacedExpenseOf`, bound as
  `kennelScope.expenseInScope`: Financials, `moneyReport.loadMoney` and the kennel hub use it;
  a scoped Financials notes how many outside-dog expenses count only under All kennels.
- **K14-2:** `buildProspectiveBundle(contact, { kennelId })`: the guided litter flow's kennel,
  else the active one; refuses under All kennels with pups at two kennels.
- **K14-8, K14-15:** `dogCard.canSendFrom` (her own dogs at the Send-from kennel; the list
  follows the kennel picker; `buildDogCard` checks too) and `sendsMicrochip`.
- **K14-12:** a major with no judge asks for "the judge on N majors" instead of more majors.
- **K14-13:** every Companion page ends with KennelOS-didn't-check-this and confirm payment
  with the kennel. **K14-17:** `data/safeHref.js` (re-exported by `ui.js`) on the dog page's
  link; the shell has its own copy on every bundle link. **K14-16:** spec numbers out of five hints.
- **K14-5:** `data/fureverIdentity.js` keeps `furever_identity` (cloud, `syncRegistry`;
  `cloudFields.js` regenerated) on the first own kennel carrying it, else My kennel; the
  console and `buildSeedPacket` load through it; this device's key moves onto the kennel once.
- **K14-3:** a litter publish asks the public-by-link confirmation for every pup's own document.
- **Furever:** K14-1 (`petRepo.seedIdentity`: a resend keeps the family's name, photo, breed,
  sex and birthday edits and never blanks one); K14-4 / K14-14 (`content_packs.pets[petId]`,
  a failed file keeps the old copy, `retryIncompletePacks` on each open); K14-7 (`planMerge`
  by `pup_id`, `breeder_key`, `pack_key`; breeder documents deduped; a failure in a sentence);
  K14-18 (`migrateCollections`, v1 contacts); K1-2 (the `blocked` / `versionchange` notices).
- **Tests:** new `kennelScopeFixes.test.js` (14), `fureverData.test.js` (9),
  `fureverIdentity.test.js` (4). `node --test` 2107 pass; `cd cloud && npm test` 365 pass;
  `node build/assemble.mjs` green.
- **Docs:** End-State guide (§4 scope, Kennel fields, shows, §20, §27, §27.1, §28.1, §36,
  escaping); Multi-Kennel Scope spec, Furever schema doc, Shared Dogs plan (Modified notes);
  `furever/README.md`; this review's `FIX_PRIORITIES.md`.
- **Service worker:** `data/safeHref.js` and `data/fureverIdentity.js` added to
  `PRECACHE_URLS`. Rides `kennelos-shell-v148`.

## 2026-11-16: Fix step 11, K11 (Kels and the guided tasks)

No owner decisions needed; each fix follows the review's suggestion.
- **K11-2:** `settings.clearGuidedDrafts` on Clear sample data (so the tour's end too) and a
  Replace restore. Resuming a litter draft, `guidedLitter.goneDraftRefs` /
  `clearGoneDraftRefs` clear an answer naming a record that's gone and ask it again; a record
  the save had already made that's gone ends the draft, said.
- **K11-3:** before Yes, build it, `litterRecordedSince` (same parents, made after the draft
  began, born within 3 days) asks "Is this that litter?"; Yes builds nothing.
- **K11-4:** `assistantSync.outboxStatus`: an entry already in is `already`, left as she has
  it; one she deleted is `removed` (`settings.assistantImported`); only new and helper-changed
  entries are written; the page pushes a fresh feed after an import.
- **K11-6:** the check-in's writes go through `safely`: a refusal is said, the visit goes on.
- **K11-7:** a form draft keeps `basis`; `formChangedSince` on resume and on save offers
  Start from what's saved now / Keep my draft.
- **K11-8:** `KELS_AS_YOU_GO_INTRO` for Tidy up, the litter check-in, Pups are going home,
  Check account health and Set up my waitlist.
- **K11-9:** Save for later says it kept a draft only when this run has one (`hasDraft`).
- **K11-10:** Cancel and Save for later run the website check; a page's baseline is kept until
  a check moves it on, and a page opened while one is owed takes none.
- **K11-11, K11-12:** Getting Started says what the puppy records leave off
  (`puppyRecordLeftOff`) with Keep it as it is first; it notes each part done
  (`settings.kelsSetupDone`), offers Pick up at …, and drops to 15 once all are done.
- **K11-13, K11-14, K11-15:** Buyer is tagged after the application is saved;
  `kelsApplicant.approveTypedFamily` (moved from Add people) also approves the families typed
  in from Set up my waitlist and Set up my application form; "No vet to add, don't ask again"
  is one key (`tidy:novet`) for Tidy up and Add people, which now offers it too.
- **K11-16:** `settings.retireDraft` lets go a draft an update can't carry on, with a notice
  Kels says once on the menu (`takeKelsDraftNotice`); people and form drafts included.
- **K11-18:** the tour keeps `wizardStepId` beside its index, read first.
- **Tests:** new `kelsFixes.test.js` (12). `node --test` 2119 pass; `node build/assemble.mjs`
  green. In Chromium: a litter draft whose mom and dad are gone resumes asking for them again.
- **Docs:** End-State guide (§26 the outbox, §33: intros, Save for later / Cancel, drafts,
  the litter draft on resume and before the save, the vet step, applicants, the form, Getting
  Started, the website check, the tour); this review's `FIX_PRIORITIES.md`.
- **Service worker:** no app file added or renamed; rides `kennelos-shell-v148`.

## 2026-11-16: The template library (Integrations plan §2.3b, D39–D41)
- **Why (owner):** build contract templates with their details already placed, for chosen
  breeders to pull into their own templates, without support being in their program
  (assisted setup). Firma's prefills name a workspace's own custom-field id, so a plain
  copy leaves them empty in another workspace.
- **Found:** Firma's `POST /templates/{id}/copy` (company key) deep-copies a template into
  another workspace of the company. Every KennelOS workspace has the same custom fields by
  `field_name` (one fact list), so each prefill can be pointed at the breeder's field of the
  same name after the copy (`PATCH /templates/{id}` with one `field`).
- **Built:**
  - Worker: `src/esignLibrary.js` (`prefillRemap`, pure; the manager app's library routes;
    `GET /integrations/firma/library`, `POST /integrations/firma/library/add`, resumable
    within the 45-call budget), migration `0027_esign_library` (offers, named breeders, who
    may add what, copies), account deletion and `/ops` export. `firma.js` exports the helpers
    it shares.
  - Manager app: a Templates tab (link the library account, name breeders by email, per
    template its name, line, who signs and who may add it: no one, every breeder, or chosen
    breeders).
  - App: Contract templates' **From KennelOS** (`cloudEsign.libraryTemplates` /
    `addFromLibrary`, `cloudApi.listFirmaLibrary` / `addFirmaLibraryTemplate`);
    `setTemplateType` takes `remember: false` so a library add keeps her own last signs choice.
- **Decided (owner):** D39 the library is the owner's test account's workspace, linked in
  the manager app; D40 access per template and per breeder. **Proposed, built:** D41 support
  sets who signs, the breeder picks the kind; a one-time copy, its origin kept.
- **Tests:** new `cloud/tests/esignLibrary.test.js` (7); `tests/esign.test.js` (+1).
  `node --test` 2088 pass; `cd cloud && npm test` 372 pass. Manager app and Contract
  templates checked in a browser (phone and desktop) against a fake Firma.
- **To prove on production:** `docs/LAUNCH_CHECKLIST.md` (the template library, first run).
- **Docs:** Integrations plan §2.3b and D39–D41; End-State guide (From KennelOS); Assisted
  Setup plan §2; `cloud/README.md`; launch checklist; README status.
- **Service worker:** no app file added or renamed. Cache bumped to `kennelos-shell-v149` (covers the template-library app changes and the v148 batch before it).

## 2026-11-16: Reservation agreements before a sale (Contract type Reservation)

- **Why (owner):** a breeder sends a reservation/deposit agreement before a pup is picked,
  often without the KennelOS waitlist. Typing litter, sex and deposit into Firma's fields on
  a phone while signing is miserable, so the details are picked in the app and prefilled.
- **Built:**
  - `vocab.CONTRACT_TYPE` adds `reservation`; the Deposit form type serves it.
  - `contractRepo`: `BUYER_LINK_TYPES` (a reservation's buyer is `related_contact_id`, kept
    out of `CONTACT_LINK_TYPES` so it's never a Companion partner) and `RESERVATION_FIELDS`
    (`reservation_litter_id`, `_pref_sex`, `_pref_color`, `_deposit_amount`), tidied on save
    and nulled on other types. `referenceRegistry`: the litter FK (scan). `syncRegistry`:
    the four fields pending (device-only until decided).
  - `saleDefaults.reservationDeposit`; `contractSend` gathers the buyer and litter
    (`reservationLitterName`, `NEXT_AVAILABLE_LITTER`); `contractForms` adds the
    `reservation` prefill group (4 new facts with Firma labels "Reservation · …"), filled on a
    Deposit form or any form on a reservation; Field guide and Accounts list the group.
  - Contract page: the Reservation fields as dropdowns (buyer, litter or Next available,
    Either/Male/Female, color with suggestions, deposit from the litter); shortcuts on the
    contact's Sales card and the waitlist family's ⋯ menu.
- **Open (owner):** whether the four reservation fields go to the cloud (pending now).
- **Tests:** new `tests/reservationContract.test.js` (8); `prefillGuide` (+1), field count
  89 → 93. `node --test` all pass. Contract page checked in a browser at phone width.
- **Docs:** End-State guide (Contract row, prefill groups, Reservation agreements).
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-16: Fix step 12, part 1: Waitlist Fixes plan step 6 (one turn rule each)

- **Why:** K06's S2 (K6-6: the out-of-turn guard asked the per-litter rule, so she could jump
  the queue with a green "They're next" and no note) and the turn-rule S3s/S4s beside it.
  `docs/review/FIX_PRIORITIES.md` step 12; `docs/KennelOS_Waitlist_Fixes_Plan.md` step 6.
- **Built:**
  - **K6-6:** `waitlistRules.nextOfferedTurn(..., { opening })` (nextTurn's rule, the litter
    being offered counted as open, skipping a family whose whole turn is "Not this
    litter"). `offerTo` asks it and refuses another family unless `outOfOrder: true`
    (`err.code 'out_of_turn'`, `err.nextEntry`); an out-of-order turn always gets a note
    naming who was next. The Offer pups… dialog's badge and confirm, and the Waitlist page's
    not-yet-open litters ("Opening picks offers the turn to …"), use it; Kels's Offer someone
    else passes `outOfOrder` and lets `offerTo` write the note.
  - **K6-7:** one `offerBlocker(entry, litter, …)` for the dialog and `offerTo` ("Not this
    litter" and a pending side sale now say so before she picks).
  - **K6-2:** `joinRespondBy`: a litter joining a turn never shortens its deadline.
  - **K6-8:** `extendTurn` moves a closed day to her next open day (`onOpenDay`,
    `moved_from`); Kels prefills `respondByDate` and says when the date moved.
  - **K6-11:** `openPicks` keeps the first `picks_opened_date`.
  - **K6-4:** `undoPass` reopens only the rows the pass closed, never a "Not this litter"
    row; a turn passed in full ahead of time has no turn to give back.
  - **K6-12:** `turnRespondBy`, `isTurnOverdue`, `holdsTurn` replace the page copies (entry
    page, Waitlist page, picks panel, `recordSideSale`); the Worker's `openTurns` takes the
    latest row's date; dead `overdueOffers` deleted; Kels uses `litterQueue`. (Item 1, the
    live stages, was built in step 2.)
  - **K6b-6:** the preview's "When it ends, next in line" comes from `simulateOpen`
    (`action.next_after`, stated answers, every open litter, full prepasses left out), not
    from the view or the Either switch.
  - **Notes:** an `active` record with no date sorts last, not #1 (an ordering rule instead
    of the plan's `validateEntry` guard: Modified); "Place them with…" a family with no date
    refuses instead of clearing the override; the Waitlist spec's `position_anchor_date`
    Modified note.
  - **K6-5** was already built (Kels review-defects batch).
- **Tests:** new `tests/waitlistTurnRules.test.js` (14); `waitlistTurns.test.js` marks its
  deliberate out-of-order offers; `waitlistRules.test.js` reads `overdueTurns`;
  `cloud/tests/serverMoves.test.js` (+1). `node --test` 2142 pass; `cd cloud && npm test`
  373 pass; `node build/assemble.mjs` succeeds. Waitlist, family and litter pages load
  without errors in a browser.
- **Docs:** End-State guide §29 (position, turns, one rule per question, the offer flow,
  Kels, the picks preview); Waitlist spec §6.1 and §16.1 rule 5 (Modified); Waitlist Fixes
  plan (status, step 6 Modified); FIX_PRIORITIES; README Status.
- **Service worker:** no app file added or renamed; cache not bumped yet.
- **Follow-up (owner's question, same day):** a family who takes back a "Not this litter"
  after their turn used it up. **Changed their mind…** on that row (`undoPrepass`): the row
  is voided (never a pass; a pass it counted is forgiven), so the litter is theirs to be
  offered again; while they hold a turn it joins it at the turn's deadline. `isPrepassedRow`
  and `PREPASSED_NOTE` moved to `waitlistRules`. Tests: `waitlistTurnRules.test.js` (+2).

## 2026-11-16: Fix step 12, part 2: Waitlist Fixes plan step 7 (the clock, D11)

- **Decided (owner):** D11, the kennel's time zone for the waitlist's deadlines only; D10, no
  (nothing sealed into an application; K7-5 not built).
- **Built:**
  - `dateUtils.dayInZone(tz)` and `kennelToday(kennel)` (no zone, or an unknown one: the
    device's date); `ui.js` re-exports it.
  - **K6-3, her device:** every `waitlistActions` action given no date takes the kennel's
    (`kennelDay`): offers, picks, deposits, outcomes, undos, side sales, approvals (the fee's
    pay-by date), back-outs, requests. The Waitlist and family pages, the picks panel, Kels's
    Review my waitlist and the pick and deposit dialogs' prefills use it; Today's waitlist
    nudges read each kennel's date (`overdueTurns` / `overdueFees` take a date or a
    `(kennelId) =>` function; a kennel with no zone keeps Today's date);
    `sweepReadyChecks` per kennel.
  - **K6-3, the Worker:** `serverMoves.isTimeZone`; a projection with no valid `time_zone`
    has no deadline closed or reminded (logged without names). **Modified:** the plan said
    "refuses"; nothing is refused, the server just leaves those to her device.
  - **K8-9:** `familyActions.checkAction` reads the kennel's day (`familyPages.localDay`)
    for extras, pickup and pause dates; the family page's `status.js` shows them on it
    (and the pause picker's earliest day).
- **Tests:** `tests/waitlistTurnRules.test.js` (+3); `cloud/tests/serverMoves.test.js` (+1),
  `cloud/tests/familyActions.test.js` (+1). `node --test` 2149 pass; `cd cloud && npm test`
  375 pass; `node build/assemble.mjs` succeeds; waitlist, family and litter pages load
  without errors.
- **Release:** Worker and family pages first (the server reads the same `time_zone` the
  projection already carries), then the app. No migration.
- **Docs:** End-State guide (dateUtils, data conventions, §29 Whose clock, Changed their
  mind); Waitlist Fixes plan (D10, D11, step 7, K7-5); `cloud/README.md`; FIX_PRIORITIES;
  README Status.
- **Service worker:** no app file added or renamed; cache not bumped yet.

## 2026-11-16: One release for the reservation agreements and fix step 12

- Folded onto one branch: Reservation agreements before a sale, and fix step 12 parts 1
  and 2 (one turn rule each; the kennel's clock), cherry-picked from
  `claude/fix-priorities-review-j6pq83`. The build log's two entries were kept side by side.
- **Tests:** `node --test` 2158 pass; `cd cloud && npm test` 375 pass; editions build.
- **Service worker:** no app file added or renamed. Cache bumped to `kennelos-shell-v150`
  (covers all three).

## 2026-11-16: Folded contract pickers; pickers A–Z

- **Contract pickers fold by kind, nothing picked:** Send for signature (Contract page) and
  Review sale & send's step 2 show one closed card per kind of contract she has a form of
  (`contractForms.formTypeGroups`: kinds A–Z by label, forms A–Z inside). No form is
  picked to start, so Continue stays off until she picks one (or No contract). The Show
  all forms split for forms that don't fit the contract stays. Asked for because the first
  form kept going out by accident.
- **Pickers A–Z:** `contactRepo`, `kennelRepo` and `waitlistProgramRepo` `getAll` sort by
  name (as `accountRepo` already did), so buyer, referrer, vet, owner, kennel and program
  pickers everywhere read alphabetically. Litter and pairing pickers keep their date order;
  dogs were already sorted.
- **Add event:** the Type picker lists types A–Z; the default type is unchanged.
- **Tests:** `tests/pickerOrder.test.js` (+2). `node --test` 2160 pass; editions build;
  Send for signature checked in the Pro build.
- **Evening test fix:** three tests (`cloud/tests/familyActions.test.js` pause request and
  Ready now?, `tests/cloudWaitlist.test.js` backing out) took today from UTC while the
  app and Worker use the kennel's clock (fix step 12 part 2), so they failed in US
  evenings once UTC was on tomorrow. They now take the fixture kennel's day
  (`familyPages.localDay` / `dateUtils.dayInZone`, America/Chicago). Tests only.
  `cd cloud && npm test` 375 pass.
- **Docs:** End-State guide (§6 repo layer, contract forms, eventForm).
- **Service worker:** no app file added or renamed. Cache bumped to `kennelos-shell-v151`.

## 2026-11-17: Credits plan and security hardening plan (docs only)

- **`docs/KennelOS_Credits_Plan.md`:** one currency (1 credit = $0.35, fixed) bought in packs
  and spent on Lite passes for Pro features, items moved to credits in both editions (payment
  schedules, extra waitlist programs), per-use server services and add-ons. Lite and Pro stay
  two apps. Enforcement is on the server: a ledger, signed entitlement tokens, and feature
  packs served by the Worker only to entitled programs. Manual payment first (support marks
  it received in the manager app); Lemon Squeezy as the future state. Decisions D1–D19.
- **`docs/KennelOS_Security_Hardening_Plan.md`:** the source repo is public; plan to make it
  private, add licenses and a terms section, minify `dist/`, optionally move hosting off
  public repos, and keep what matters on the server. Decisions S1–S6.
- README doc map: both plans added.
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-17: Credits plan, how a pack's code leaves a device (docs only)

- `docs/KennelOS_Credits_Plan.md` §7.3: one cache per pack, the service worker checks the
  signed token on every pack request (offline too), cleanup after the view-only window, why
  the rows can stay without their screens, and app updates: new pack versions are fetched
  during install so a device with an active pass is never left without it (the activate step
  in `shared/sw.js` deletes every non-current cache).
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-17: Mail budget plan (docs only)

- **`docs/KennelOS_Mail_Budget_Plan.md`:** staying inside the email provider's daily limit when
  several kennels have a heavy week at once. A daily budget for the whole account (a reserve
  for sign-in codes, a guaranteed floor per program, a shared pool), emails ranked by urgency
  with non-urgent ones held to the next day, loud failures (`daily_email_limit` banner for
  manual sends, `email_held` alerts for server sends), no deadline started before its email
  goes out, notifications on the families' status pages (installable, payload-free push) to
  take non-urgent mail off email, tap to text from her own phone, and an optional second
  provider (Bird Startup or SES). Decisions M1–M10.
- `docs/KennelOS_Credits_Plan.md` §4.5: emails added as a later candidate, priced only once
  there's a real per-email cost.
- README doc map: the plan added.
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-17: Mail budget plan, text the family from her notification (docs only)

- `docs/KennelOS_Mail_Budget_Plan.md` §5.1: a "<Family>'s turn — text them" push for the
  breeder. Android gets a Text them button that opens `sms:` via a tiny page (or directly,
  if a real-phone test shows a service worker can); iPhone opens a one-button page. The
  phone number stays on her device; the page reads it through the repos. Decision M11.
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-17: Mail budget plan, offer and text from the deadline alert (docs only)

- `docs/KennelOS_Mail_Budget_Plan.md` §5.1 rewritten: breeders run turns by hand with one-day
  deadlines, so the trigger is a turn's deadline ending. The cron raises a `turn_ended` alert
  (no move) for kennels without auto-offer; tapping it opens `next-turn.html`, where one
  button records no response, offers the next turn and opens the prefilled text. Decisions
  M11 (reworded) and M12.
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-17: Mail budget plan, texts in the status page history (docs only)

- `docs/KennelOS_Mail_Budget_Plan.md` §5.2: a text she confirms ("Sent? → Yes") is recorded as
  a `wl_messages` row (`channel` `text`, sent at the moment she tapped, nothing sent by the
  server) and listed on the family's status page beside the emails, labelled as her record.
  The phone number stays off the server (Waitlist Spec §8.1, Q11): last 2 digits at most.
  Decision M13.
- §3.1 corrected: `wl_messages.status` has a CHECK (`queued | sent | failed`), so held emails
  are `queued` with `send_after` at the reset plus a `hold_reason` column, not a new status.
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-17: Mail budget plan, messages posted to the status page (docs only)

- `docs/KennelOS_Mail_Budget_Plan.md` §4.5: she can post a message to a family's status page
  instead of, or as well as, emailing it. A per-kennel setting (`waitlist_config.
  family_delivery`: `email`, `page_notify`, `page_only`) plus a per-message choice; codes and
  the first status link are always emailed. Decision M14 decided by the owner: page only is
  allowed, even for families without notifications.
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-17: Mail budget plan, chaining a second provider (docs only)

- `docs/KennelOS_Mail_Budget_Plan.md` §6: the chain lives in `mail.js` (`sendMail`: Resend,
  then Bird or SES), Bird free behind Resend for the family domain (about 150 a day at $0),
  and what Bird's terms say about its wallet (stays on downgrade, lapses a year after each
  deposit, no refunds), with two questions to ask Bird. M7 updated.
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-17: Voice plan (docs only)

- **`docs/KennelOS_Voice_Plan.md`:** a calendar subscription feed any assistant can read; an
  Alexa skill that logs quick records (weight checks first) through a Worker outbox her device
  folds in like the KennelAssistant outbox, answers waitlist questions from the projection,
  starts waitlist actions she confirms on her phone, and sets Echo reminders; Siri Shortcuts
  on the same routes. Decisions V1–V6.
- Credits plan's voice assistant row points to it. README doc map: the plan added.
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-17: Voice plan, update the website by voice (docs only)

- `docs/KennelOS_Voice_Plan.md` §5.1: "Alexa, update my website" pushes to a device linked to
  her KennelPort website with Update website ready (the bundle is built on her device), and
  "…and publish it" with Update and publish. Publishing straight live needs KennelPort to
  accept `publish: true` on an update (its own change) and her site to allow it; Update and
  publish is then offered on the Your website card and in Kels too. Decision V7.
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-17: Voice plan widened: in the app, Google, a Claude Haiku fallback (docs only)

- `docs/KennelOS_Voice_Plan.md`: new §8 push-to-talk in the app (browser speech recognition
  or an opt-in on-device model; a command list with names matched against her records and
  "Flowers' litter or Founder's?" questions; a read-back card; a typed command bar on the
  same parser), §9 Google and other home assistants (no third-party actions in Gemini for
  Home as of Nov 2026; calendar feed and Android shortcuts; HomePod, Home Assistant), §10
  an LLM on the Worker (to be compared; leaning Claude Haiku 5.5) as a fallback returning the same structured commands, with
  a per-call and monthly cost estimate. Old §8–§11 renumbered §11–§14. New sections left
  unranked on purpose. Decisions V8–V13.
- README doc map row updated.
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-17: Waitlist decisions D3 and D12 confirmed; launch checklist closed; Workers Free (docs only)

- `docs/KennelOS_Waitlist_Fixes_Plan.md` §2: D3 (a Pup selected row shows the listed name and
  Pup selected, nothing about the pup) and D12 (public names from the application's own name
  for households and "Last, First"; the Approve dialog shows the public form) confirmed as
  built. `docs/review/FIX_PRIORITIES.md` step 12 row updated.
- `docs/LAUNCH_CHECKLIST.md`: every deploy and launch item ticked (owner: all done), Firma
  verified on production. Open only: the template library's copy down to a breeder. A deleted
  account's Firma workspace moved to §5 Recurring.
- Workers plan: the owner stays on Workers Free until a limit is hit (three real programs and
  one test account). The checklist names the signs to watch; **Modified:** notes in the W2
  plan §12 and the Cloud Phase 1 plan §6.
- README Status rewritten.
- **Service worker:** no app file added or renamed; cache not bumped.

## 2026-11-17: Waitlist Fixes plan step 8 (applying and signing in); Saved on Kennel settings

- **K7-4:** `waitlistForm.POLICY_LIMITS` (30 policies, heading 200, body 5,000), equal to the
  Worker's `familyPages.POLICY_LIMITS` (a test holds them); `validatePolicies` refuses past
  them; `qaListEditor` `aMax`/`bMax` live counts (the heading's only once over).
- **K7-6:** the application page catches a failed `seal` and says so, answers kept.
- **K7-7:** **Wrong address? Change it** on the code step (form back, answers kept, Turnstile
  reset); **Already applied? Enter your code** on the form (a code, or a new one to an
  address they type); the application-code email says how to find it. Confirm handlers wired
  once (`wireConfirm`).
- **K7-10:** `waitlist.signedOutEntries`: a publish with a new token or a changed email
  deletes that entry's `wl_family_sessions`. New link's confirm says so.
- **K7-11 (part):** the kennel-wide verify limit answers `429 busy` ("This waitlist is busy
  right now"); 20 applications an hour per connection (was 5). Counting wrong guesses per
  code is left for the owner (plan D13: a migration and a cheap way to burn every live code).
- **K7-13:** `POST /waitlist/inbox/drop` (any of her devices) forgets deleted applications
  and their links; `cloudWaitlist.forgetApplication` from the entry's Delete, queued in the
  `waitlistOnline` setting's `droppedInbox` until sent, skipped by take-ins meanwhile.
  **Modified:** instead of a dismissed-ids list in the backup.
- **K6b-7:** `assertNotReapplied` also matches by email (contact's or application's).
- **K7-5:** not built (D10).
- **Kennel settings Saved:** `kennel.js` `flashSaved` on the six settings cards' Save.
- Tests: `waitlistPolicies`, `waitlistUndo`, `cloudWaitlist` (app); `familyActions`,
  `application` (cloud). Guide (Kennel page, §29 undo, family pages), Waitlist Spec route
  table, plan step 8 and D13, `FIX_PRIORITIES.md` step 12.
- **Service worker:** no app file added or renamed; cache not bumped. No cloud migration.
  Release: deploy the Worker (new route, family pages) before or with the app.

## 2026-11-17: Waitlist Fixes plan step 9 (pickup, miles and queued emails); cache v152

- **K8-15:** Copy to another litter takes each copied date's rule along
  (`pickupSlots.copyDateRules`; a date with its own rule there keeps it), and says so.
- **K8-14:** `approvePickupRequest` refuses a time whose places are all booked by other
  families' confirmed pickups.
- **K8-11:** `sendQueuedEmails` holds an email queued more than a day (`isStaleEmail`,
  `EMAIL_STALE_MS`) as `failed`/`stale`: **Waiting for you** on the entry and a Today card,
  **Send as written** (`retryEmail` now sets `requeued_at`) or **Don't send** (`dropEmail`).
  Counts gain `held`. **Modified:** by age only.
- **K8-5:** `geo.js` tells failures apart (`geo_failed` key/quota/outage, `geo_unreachable`
  network/timeout 10 s/not JSON, another 4xx is that address's `not_found`); her app words
  them (`transportFee.milesErrorText`) on the entry page's two forms and Kels's; a home said
  while Mapbox was down isn't stamped measured, and `measureHomes` measures `home_place`
  first; the family-side measuring limit no longer refuses their request.
- **K8-6:** the family's address is geocoded with `proximity` (her point); `roughMatch`
  (region/country, or low confidence) → `422 imprecise`. **Modified:** no `country`; needs a
  live Mapbox check.
- Tests: `familyPickup`, `waitlistUndo`, `cloudWaitlist` (app); `familyActions` (cloud).
  Guide (pickup, emails), `cloud/README.md` geo line, plan step 9, `FIX_PRIORITIES.md`.
- **Service worker:** no app file added or renamed. Cache bumped to `kennelos-shell-v152`
  (carries step 8, the Kennel settings Saved indicator, and this batch). No cloud migration;
  deploy the Worker with or before the app.

## 2026-11-17: Waitlist Fixes plan step 10 (holding together): the plan is done

- **K6-13:** every exported waitlist action that writes is wrapped in `atomic`, one
  `db.transaction('rw', dataTables(), async () => …)` (71 actions; six read-only helpers left
  out). Found in Chromium: a plain-arrow scope loses the transaction after a write returned
  through another async function (PrematureCommitError), invisible to the tests' memory
  database; the scope is `async`. Checked against real IndexedDB: approve, decline/undo,
  fee received, expire/undo, remove/undo, withdraw, archive, open/close picks, pick, deposit,
  pass/undo, next turn, a family plan; a failed write rolls back. Nothing reachable from the
  actions awaits the network, a timer or Web Crypto. `tests/waitlistAtomic.test.js` holds new
  exports to it. **Modified:** the next turn is inside the transaction.
- **K6b-9:** the picks preview asks **Leave without saving?** on a tap outside, Escape, Close
  or Cancel while settings are unsaved; focus returns after a redraw and on close; its
  tables scroll in `.table-scroll`. Checked at 320 px.
- Guide (Actions, Picks preview), plan step 10, `FIX_PRIORITIES.md`, README Status.
- **Service worker:** no app file added or renamed; rides `kennelos-shell-v152`.

## 2026-11-17: Add a library template again, for another kind

- Owner: one library agreement should serve two of a breeder's extras. `POST
  /integrations/firma/library/add` takes `another: true` (one more copy beside a ready one;
  a copy in progress is carried on) and `name`; From KennelOS shows **Add again for this
  kind** on an added template, naming the copy "<template> (<kind>)". A plain add still
  answers the copy she has. Test in `cloud/tests/esignLibrary.test.js`.
- Guide (From KennelOS), Integrations plan §2.3b **Modified**, `cloud/README.md`.
- **Service worker:** no app file added or renamed; rides `kennelos-shell-v152`. No migration.

## 2026-11-18: Contract alerts; integration events reach a device that didn't connect

- Owner: push notifications for contracts signed. New notify kind `contract` (alerts and
  digest, on by default): Firma's webhook for a request signed by everyone, declined, or
  expired records an item once per new `int_events` row (a redelivery is silent; a cancel,
  hers, isn't one). Lines carry no name (the server never knows the buyer); `entry_id` holds
  the contract id and a tap opens `pages/contract.html`. A grouped title with a contract drops
  "on your waitlist". Migration 0028 adds the kind to settings still at the old defaults.
  Settings card: "A contract sent for e-signature is signed, declined or expires".
- Owner (assist test): a contract signed while support's helper had set up Firma never turned
  Signed on her device. Her device's integrations state counted no connection (only the
  device that ran the connect flow did), so it never read events. `syncOnOpen`: a device
  counting none asks `GET /integrations/connections` once per app open, then reads; the
  backlog applies from cursor 0.
- Stripe payments: no alert yet. Payments are seen only by her device's own Stripe check
  (`stripeLinks.js`); a server push needs a server-side Stripe webhook (decision pending).
- Tests: `cloud/tests/notify.test.js`, `cloud/tests/esign.test.js`, `tests/cloudIntegrations.test.js`.
- Guide (Notifications, §32), Notifications plan §1 **Modified**, Integrations plan §0
  **Modified**, `cloud/README.md`.
- **Service worker:** no app file added or renamed; `CACHE_NAME` → `kennelos-shell-v153`.

## 2026-11-18: A link for each extras group on the status page

- Owner: link the status page's extras to her own custom pages, a different page per group,
  set where the group is, not in a hidden setting.
- Each group on the Kennel page's **Extra charges price list** has **Details/marketing
  URL (optional)** under its name (with the waitlist on): an https link, kept as
  `Kennel.extra_charge_groups[].info_url` (`extraCharges.groupInfoLink`; `readChargeGroups`
  refuses a non-https one). No new table, index or synced field: it rides the private
  `extra_charge_groups`.
- `familyExtrasView` adds `links: [{ group, url }]` for the groups with extras on the family's
  page; the Worker's `extrasOf` passes them field by field (https only, at most 30), and the
  status page's Extras card shows **See details and pricing** (new tab) under that group's
  extras. The kennel-wide **See our extras and prices** button stays.
- Tests: `tests/extraCharges.test.js`, `cloud/tests/familyPages.test.js`.
- Guide §21.2 and the family-requests part, Family Requests plan **Modified**.
- **Service worker:** no app file added or renamed; `CACHE_NAME` not bumped (ask).
- Cloud: no migration. `cloud/public/family/status.js` changes, so it reaches families when
  the Worker deploys.
- Then, the owner: the field is **Details/marketing URL**, and each group may word its own
  link, **Custom hyperlink display phrase** (`extra_charge_groups[].info_label`, up to 80
  characters; blank = "See details and pricing"), carried in `links[].label`.

## 2026-11-18: Status page links to her website: litters, dams and sires, a featured pup; no extras prefill

- Owner: she's hiding her site's extras page and splitting it in two, so the extras link is
  never filled from the site; litters prefill; link dam/sire pages; a featured pup page.
- `kennelportLink.kennelChanges` no longer sets `waitlist_config.extras_info_url`. A value it
  filled before stays until she clears it (Waitlist settings).
- A dam's or sire's `url` that is its page on her website is its link on family pages,
  tick or not, `page: true` (`parentView` now uses `pupLink`), shown as "(Their page)" and,
  on a heat, "See Juniper on our website". An early litter under Coming up uses
  `litterLink`, so its page reads **View litter on our website**, as Available Puppies now
  does too (`litterHtml` takes `page`). The Worker passes `page` on parents and Coming up.
- **Featured pup page URL** and **Custom hyperlink display phrase** in Waitlist settings
  (`waitlist_config.featured_url` / `featured_label`, https only; blank phrase = "Meet our
  featured pup"). Only when the URL is filled in: `kennel.featured` in the projection, sent
  by the Worker only to families still waiting, drawn as its own **Featured pup** card before
  Available Puppies.
- Tests: `tests/siteExport.test.js`, `tests/waitlistProjection.test.js`,
  `cloud/tests/familyPages.test.js`. Guide §29 and §35.
- **Service worker:** no app file added or renamed; `CACHE_NAME` not bumped (ask). Cloud: no
  migration; `cloud/public/family/common.js` and `status.js` change.
- Then, the owner: a parent's name is its link, not "(Their page)" or "(Photos)" after it
  (her photos link is the dog's page anyway); a planned heat's dam name too, in place of
  "Photos of Juniper" (`common.js` `nameLink`, `litterHtml` `nameHtml`).
- Checked in a browser (the status page with sample data, 390px and desktop): every parent
  name links to its dog page. Found and fixed: the Worker dropped `page` on an Available
  Puppies card (`familyPages.js` litter card), so it read "See the litter's photos".
- Checked the Extras card in a browser with two groups (Training, Photo/video add-ons), each
  with its link: both open their pages. Each group is now a `.xgroup` with 24px before the
  next, so a group's link no longer sits against the next heading (`family.css`).
- Then, the owner: a divider between groups (`.xgroup + .xgroup`: a 2px line, heavier than
  the 1px lines between extras, with room above and below).

## 2026-11-18: The family status page's look: panels, section icons, three palettes

- Owner: an extras group should clearly be its own thing with its link going to all of
  them; litters in one section should read apart; a softer, more intentional look
  (ChatGPT's mock as direction: icons by headings, softer cards, sparing paws), matching
  the waitlist side, with a choice of three palettes for families.
- Each extras group is a panel: its name, its link right under it (› to all of them), then
  its extras. Each litter in Available Puppies, and each pairing or heat in Coming up, is
  its own panel (`ul.plain.segs`; the public list too). A litter's name is in the heading
  face (`.litter-name`).
- `cloud/public/family/icons.js` (new): line icons drawn in-house, `sectionIcon(title)` →
  icon and kind; `card` / `openCard` put it in a tinted chip by the heading, chevron right.
  Softer cards (12–14px corners, a light shadow), a paw ornament under the greeting
  (`status.html`), a faint paw on Current Position.
- `cloud/public/family/theme.js` (new): Classic (default, the app's colours), Ivory, Blush,
  each light and dark (`html[data-theme]`), picked under **Colors** at the status page's
  foot and kept in localStorage; `list.js` applies it too. Embed mode keeps its own colours.
- Checked in a browser: both a waiting and a placed family's page in all three palettes,
  light and dark, at 390px, and at desktop width.
- Tests: no new ones (look only); the suites pass. One run had `the sealed part opens only
  with the vault key it was made with` fail once and pass on rerun (unrelated, flaky).
- Cloud: no migration; the Worker deploy carries it. **Service worker:** `CACHE_NAME` →
  `kennelos-shell-v154` (the owner said bump), for the session's app changes (the price
  list's group link and phrase, the featured pup settings).

## 2026-11-18: Her logo on the family pages; the extras message points at the group links

- Owner: yes to both.
- The extras message's default is now "We offer several paid extras to our families. Each
  group below links to its details and prices, so have a look before you choose."
  (`EXTRAS_INTRO_DEFAULT`). A saved copy of the old default reads as the new
  (`EXTRAS_INTRO_OLD_DEFAULT`, in the projection and the settings box). The settings hint
  says each group can link to its own page.
- Her logo (`Kennel.logo_data_url`, already `cloud` in the sync registry) goes out with her
  waitlist as `kennel.logo` (base64 image data URL, at most 300,000 characters,
  `familyLogo`), the Worker passes it to the status page and the public list (`logoOf`), and
  it sits above the greeting, on a small light card in dark mode. The pages' CSP already
  allows `img-src data:`; an SVG in an `<img>` never runs script.
- Tests: `tests/waitlistProjection.test.js`, `cloud/tests/familyPages.test.js`.
- Checked in a browser: a sample logo in Classic light and Ivory dark at 390px.
- **Service worker:** rides `kennelos-shell-v154` (bumped this session, not yet on `main`).

## 2026-11-18: The status page stays with the portal until the sale closes

- Owner: families need pickup, extras and payments on their status page while the sale is
  open, portal or not. Recommendations taken: Delivered counts as closed (payments go then,
  owed or not); backing out stays wherever it was offered.
- `portalFeed.portalEntryView`: `only` is now `!isOpenSale(sale)` (Delivered). The portal
  taking the family over (`home`, `portal_only`) and a passed pickup day no longer switch
  their page; `home` is still kept. `pickup_on` is no longer published.
- Worker `familyPages.portalOf`: no date switch; only the device's `only`. A `pickup_on` from
  an older device is ignored.
- `cloud/public/family/status.js`: the portal card says to keep using the page for pickup,
  extras and payments until the sale is complete.
- Tests: `tests/portalFeed.test.js` (handed over and past pickup stay full while open;
  Delivered goes portal-only), `cloud/tests/familyPortal.test.js` (no date switch).
- Docs: End-State guide §35.1.
- Cloud: no migration; the Worker deploy carries it. **Service worker:** no file added;
  `CACHE_NAME` → `kennelos-shell-v155` (the owner said bump).

## 2026-11-18: from her puppy portal to the status page, signed in

- KennelPort's portal now opens a family's status page signed in, before pickup, so
  payments, extras and pickup need no code: `/s/<token>#from=<t>`, a one-time 10-minute
  link in KennelPort's handoff format, signed with the shared portal key over
  `to-status:` and the body (so it never works the other way).
- `cloud/public/family/status.js` reads `#from=`, takes it off the address and posts
  `/f/from-portal` (`familyActions.handleFromPortal`): this page's family only, unexpired,
  once, her portal on; it starts the same 90-day family session as a typed code.
- **Cloud migration 0029** (`wl_portal_handoffs`: the hashes of used links; retention
  drops them after a day; deleted with the account). Additive.
- Tests: `cloud/tests/familyPortal.test.js` (two new). Docs: End-State guide §35.1.
- Service worker: no app file changed (`status.js` is the cloud Worker's page), no bump.
## 2026-11-18: Plan for the review's remaining findings

- New `docs/KennelOS_Review_Remainder_Plan.md`: 32 open findings (K12-4, K14-3, K1-4 the S2s)
  in nine batches A–I, each with its files, fixes, failing tests to write first and docs.
  Seven owner decisions (R1–R7) with recommendations: `status_date` and `furever_pack` sync
  tier, the saved-logins wording, a co-own's life stage on Delivered, refund fields on a Sale,
  an update notice, the per-pup pack layout, a re-runnable chunked recovery restore.
- Rechecked against `main` at `6aacb16`: K6-13, K7-13, K7-10 and K6b-9 are already built;
  K13-13 is partly covered by Kels's account health check.
- README doc map and Status, `FIX_PRIORITIES.md` pointer. No code changed.
- **Service worker:** no app file added or changed.

## 2026-11-18: Review remainder batch A: alerts that land where they point, the Accounts page

- **K12-4:** a family's alert opens `waitlist-entry.html?id=…&from=alert` (`notify.js`
  `pushText`). Opened that way, the page runs `syncWaitlistOnline({ asked: true })` before it
  draws (at most 5 s, "Checking for anything new…"). On a device that doesn't take family
  events in, it says where they land (`cloudNotify.takeInHere` / `takeInHereText`: the
  backing device by name, or "keep in step"), and an entry not here yet reads "This family
  isn't on this device yet" instead of "not found". The open page redraws on
  `CLOUD_DATA_CHANGED_EVENT` (600 ms debounce), waiting while she edits, a dialog is open or
  a field has focus. The Notifications card shows the same where-note under "Alerts are on".
- **K12-8:** the `kennelos-notify` note records the owner's `programId`; `refreshAlertsHere`
  re-subscribes only for her (an old note without one is adopted by the owner signed in;
  never by a helper). `forgetAlertsHere` (server row, browser subscription, note) runs on
  `cloudAuth.signOut` and every erase (`cloudDevices.doErase`, so support's hand-back too).
  `OWNER_ONLY` gains `PUT /notify`, `POST /notify/push/subscribe`, `POST /notify/push/test`
  and the three digest writes; a helper may still read them and turn its own alerts off. The
  card tells a helper the alerts are hers to set.
- **K12-7 (card half):** `alertsLiveHere` checks the permission and the browser's
  subscription before the card says "on"; blocked or dropped shows a warning with Turn off
  (and Turn on again). **K12-13:** Turn on alerts asks the permission straight from the tap.
- **K12-9 (R2, the recommended wording):** the saved-logins hint says they ride backup files
  and Dropbox pushes, and reach KennelOS's cloud only encrypted inside the vault.
- **K12-11:** `.acct-grid` uses `minmax(min(320px, 100%), 1fr)`: no sideways scroll at 320 px.
- **K12-12:** `referralShare.referralLinkInput`: a referral link typed without `https://`
  gets it; one that can't be a web address is refused at save.
- Left for batch A2: K12-5, K12-6, K12-7's `sw.js` half, K12-14 (plan).
- Tests: `tests/cloudNotify.test.js` (new), `tests/referralShare.test.js`,
  `cloud/tests/assist.test.js`, `cloud/tests/notify.test.js`. Checked in Chromium: the entry
  page redraws on a data change; Accounts at 320 px has no overflow.
- Docs: guide (§30 notifications and assisted setup, §32 Accounts), Notifications plan and
  Assisted Setup plan (**Modified**), `cloud/README.md`, Remainder plan, `FIX_PRIORITIES.md`.
- **Service worker:** no app file added or renamed (`PRECACHE_URLS` unchanged).

## 2026-11-18: Website changes from anywhere, publish on send, puppy portals started early

- **Owner's request:** an easier way to send website changes than Settings, a publish-now,
  and puppy portals before the contract is signed. Decided with the owner: a strip on every
  page plus a Today card; every send publishes (a setting can keep sends in the draft); early
  portals are her choice per family, skipping only the signed contract.
- **The website strip** (`assets/websiteBanner.js`, new, Pro-only: `proPages.js`,
  `PRECACHE_URLS`): under the nav on every page but Today (a card there,
  `#today-website`), whenever `pendingWebsiteChanges` has something: the first three
  changes, Send and publish / Send to draft, See changes, Later (until the changes differ;
  `settings.get/setWebsiteLaterFor`). Covers everything the bundle carries, extras and
  recommended products included; portal updates send themselves and the list says so.
- **Publish on send:** `kennelportApi.publishSite` (KennelPort's new `POST /v1/publish`)
  after each bundle unless **Publish what I send straight away** is off on the Your website
  card (`settings.get/setWebsitePublishOnSend`, device-only, default on). A refused or
  missing publish leaves the send in the draft and says so. Kels no longer adds "It's in your
  website's draft" after a send; the result line says which.
- **Early puppy portal:** `Sale.portal_early_on` (new optional field, `syncRegistry` cloud,
  `cloudFields.js` regenerated). `portalFeed.portalSales` carries an early sale while it's
  open (or once sent), `contract_signed_on: null`; `earlyPortalState` drives **Start puppy
  portal now** on the Sale page and the waitlist family's Interact tab
  (`assets/portalEarlyUI.js`, new, shared, in `PRECACHE_URLS`).
- **KennelPort, same day (its branch `ccr-1cb5defd-uvpej2`):** `POST /v1/publish`, and the
  feed's `contract_signed_on` optional. **Merge KennelPort first:** until it's deployed, a
  feed with an early family is refused whole by KennelPort, and publish falls back to the
  draft.
- Tests: `tests/websiteBanner.test.js` (new), `tests/siteExport.test.js`,
  `tests/portalFeed.test.js`. Checked in Chromium at 390 px: the strip on a dog page after an
  edit, Send and publish, the Today card; Start puppy portal now on a sale.
- Docs: guide §35, §35.1 and the Sale row.
- **Service worker:** two files added to `PRECACHE_URLS`; `CACHE_NAME` → `kennelos-shell-v156`
  (owner's go-ahead), which also carries batch A and the merged `ccr-763e73db-r0a3qt` work.

## 2026-11-18: Plan for load performance and the tour's sample data

- **Owner's request:** pages take up to two seconds to settle, and a late banner moves buttons
  mid-tap; and the tour's sample data must not outlive the tour. Decided with the owner
  (D1): the tour is read-only and its seed clears itself.
- New `docs/KennelOS_Load_Performance_Plan.md`: what's slow, measured on `main` at `69105af`
  (§1). That covers: the nav with no reserved height, held in Pro behind a Lemon Squeezy
  validate on every page; the website strip at 1.5 s; Today's late cards above Reminders;
  `app.js` at 56 modules / 893 KB and Today at 98 / 1,684 KB; repeated full-table reads in
  `computeNudges`; per-page network checks; the 15 MB precache; and how the seed outlives
  the tour. Seven phases (0–6), each with files, tests and docs. Decisions D2–D11: the owner
  took every recommendation, so all are made; next is Phase 0. No server change, no migration.
- README doc map and Status. No code changed.
- **Service worker:** no app file added or changed.

## 2026-11-18: Load performance Phases 1 and 2 — nothing moves after first paint; a read-only tour

Built from `docs/KennelOS_Load_Performance_Plan.md` (owner's request: review the plan, then
build Phases 1 and 2). Where the build departed from the plan, its **Modified:** notes say
so. No server change, no migration, no schema change, no new record field.

- **Phase 1 (D6, D7):**
  - `#app-nav` reserves its 52 px (`app.css`). `app.js` draws the nav first, before the
    license gate and every wait. The kennel name and switcher draw from a stored copy
    (`settings.navKennels`), corrected after their reads.
  - The Pro gate decides from the stored verdict (`license.cachedLicense`) and asks Lemon
    Squeezy in the background at most once a session and every 6 h (`licenseCheckDue`,
    `askLicenseStore`), with a 5 s timeout (`LICENSE_TIMEOUT_MS`). A walling verdict still asks
    first.
  - New `settings.dataChangedAt` (`markDataChanged`, and live sync's `noteDataChanged`).
  - The website strip keeps its last compare (`settings.websiteStrip`), is drawn from it in the
    first paint by `app.js` / `today.js`, and compares again only when records changed, the day
    turned, or `kennelportLinkStore` dropped it.
  - Today paints every card in one frame. Its cloud card is new `assets/todayCloudCard.js`
    (settings only; `cloudBackupUI` loads on a press). Service notices already fetched this
    session draw at boot.
- **Phase 2 (D1–D5):**
  - `demoMode.assertWritable` throws `TourModeError` (a `DemoModeError`) while the tour's seed
    is loaded; `isTourMode` / `isReadOnly` / `readOnlyWhy`. The `isDemo()` write-skips became
    `isReadOnly()`. Website and Stripe connects are guarded too.
  - `settings.hasSampleData` (moved from `sampleData.js`, which re-exports it).
  - The seed lives only while the tour is active, in its own session
    (`markTourSeededThisSession`, `tourSeedExpired`). `app.js` clears it otherwise
    (`sampleDataUI.autoClearTourSeed`) and reloads once; a failed clear shows a strip with
    Try again.
  - The banner says "Leave the tour". Finish and Skip clear and reload into kennel setup. Kels
    doesn't start tasks during the tour. A restore, an import, a sync join or a vault merge
    clears the seed first (`importExport.leaveTourFirst`). The migrations wait until the seed
    is gone.
  - New `editionConfig.tourUrl` (all four; nulled by the final build): "Take the tour ↗" in
    the More menu and in Settings opens the Demo once there's no seed.
  - New `data/recordDetach.js` (`planDetach`, `removeDetaching`, `detachRow`) over new
    `referenceRegistry.REFERENCES_BY_TABLE`, `refIdsOf` and `findReferencingRows`.
    `clearSampleData` uses it (D4): kennel links move to her kennel, waiting for kennel setup
    when there's none; other links are cleared; a one-time notice lists them.
    `archiveConflicting` and `promptClearSampleData` are gone.
  - Kels's Tidy up gets **Leftover tour records** (`tidyRules.tourLeftoverFindings`, D5).
  - The tour's intro copy (shared and Lite) no longer mentions the yellow banner.
- **Found and fixed on the way:**
  - the old clear never checked contacts (a real sale's sample buyer was deleted out from
    under it);
  - it queried unindexed `scan` registry fields, which throws, and the tour's exit swallowed
    that;
  - the strip's inline `display:flex` beat `hidden`, so a hidden strip stayed as an empty
    padded bar.
- **Tests:**
  - new `tests/tourMode.test.js`;
  - additions to `tests/licenseRevalidate.test.js` and `tests/websiteBanner.test.js`;
  - `tests/cloudDirty.test.js`: `recordDetach.js` marked, `sampleData.js` no longer writes
    directly;
  - `memoryDb` compound `anyOf`;
  - four suites that used the seed as a fixture drop its manifest (or open the seed window)
    before writing beside it;
  - 2,221 pass.
- **Checked in Chromium** at 390 px against `dist/pro` with Lemon Squeezy delayed 3 s:
  - the nav lands in 0.14–0.26 s (was ~3.45 s); the page no longer drops when it arrives;
  - Today's layout shift 0.29 → 0.0004;
  - no store calls after the session's first;
  - a released key walls in the background;
  - Lite's tour refuses writes, keeps its seed across pages in its own session, and clears in
    a new tab into kennel setup, then the menu links to the Demo;
  - Pro's Skip clears and shows kennel setup;
  - an old contaminated seed asks for a kennel, moves her dog to it, clears the sample sire
    and shows the notice;
  - the Demo is unchanged.
- Docs: guide §0, §0.2 (now "Read-only: the Demo, and the guided tour"), §0.3, §11 (Settings,
  Sample data, First run, Guided tour), §30, §33 (Tidy up), §35; editions plan §Licensing and
  §"The guided tour is per-edition"; the plan's status and Modified notes; README Status.
- **Service worker:** `assets/todayCloudCard.js` and `data/recordDetach.js` added to
  `PRECACHE_URLS`; `CACHE_NAME` → `kennelos-shell-v157` (owner's go-ahead, after Phase 0),
  which carries Phases 0–2.

## 2026-11-18: Load performance Phase 0 — load budgets and the load check

Built after Phases 1 and 2 (the owner's go-ahead the same day). See the plan's Phase 0
**Modified:** note.

- **New `tests/loadBudget.test.js`** (in `node --test`): each entry's static graph (`app.js`'s
  plus the page's script) stays within a module and KB budget. Measured now:
  - app.js 57 / 918 KB;
  - Today 100 / 1,723;
  - Dogs 64 / 1,014;
  - Dog 76 / 1,194;
  - Litter 97 / 1,525;
  - Sale 84 / 1,353;
  - Waitlist 102 / 1,721;
  - Waitlist entry 114 / 2,034;
  - Kels 129 / 2,129.

  Budgets are those plus a little; Phase 3 lowers them. The "never statically from app.js"
  list is a to-do test until Phase 3 (today `app.js` still reaches `sampleData.js`, the tour,
  first run, the setup modal and its parser, and the license gate).
- **New `build/loadCheck.mjs`** (by hand; `build/README.md`): Playwright on `dist/pro` and
  `dist/lite` at 390 px, with the sample packet as her own records and Lemon Squeezy answered
  3 s late. It reports, per page: nav time, first paint, layout shift and what moved, tables
  read in full more than once, and store calls. `--root` measures another checkout.
- **Baseline**, `main` (`5f73da0`, before Phases 1–2) → this branch, the same run
  (`--root`), Pro / Lite:
  - **Nav drawn (ms):** Pro ~3,100 → 100–130 on every page; Lite ~100 both.
  - **Layout shift:**

    | Page | Pro (main → now) | Lite (main → now) |
    |---|---|---|
    | Today | 0.68 → 0.0004 | 0.99 → 0.0004 |
    | Dogs | 0.10 → 0.03 | 0.04 → 0 |
    | Dog | 0.31 → 0.11 | 0.15 → 0.02 |
    | Sale | 0.16 → 0.12 | 0.08 → 0.06 |

    Run to run they vary by a few hundredths. What's left on Dog and Sale is their own
    sections filling in.
  - **Lemon Squeezy calls over the four pages:** 4 → 1.
  - **Full table reads, Pro, watched 9 s** (Phases 3–4's work):
    - Today: 47 → 47 (kennels ×11, contacts ×6, sales ×6, dogs ×5, litters ×4…);
    - Dogs: 16 → 15;
    - Dog: 23 → 22;
    - Sale: 27 → 26.

    With the default 2 s window `main` looks lower on Today (44), only because its background
    checks start after the 3 s license wait and finish outside the window.
- Docs: `build/README.md` (Load check), the plan's status and Phase 0 note, README Status.
- **Service worker:** no app file added or changed (a test and a build script).

## 2026-11-18: Dogs page — Puppies grouped by disposition; Website ✓ column
- **Puppies tab** is sectioned by disposition, in order Available, Placed, Undecided (incl.
  unset), Health hold, Keeping; within each section sex then name A→Z (`dogListOrder`,
  replacing the newest-first DOB sort).
- **All tabs:** Disposition is now plain text (no badge) and a `collapse` column, so on a phone
  it moves into the row's details. A new always-visible **Website** column shows ✓ when
  `show_on_website` is set; it renders only where `websiteLinkOffered()` (as the dog page does).
- The ✓ is centered under its header: a listView column's `className` now also goes on its `<th>`, with a `col-center` class.
- Docs: End-State guide (Dogs page order). **Service worker:** no file added or renamed.

## 2026-11-18: Dogs page — More ▾ menu; a three-button rule
- Dogs page header now shows ✨ Add your dogs with Kels, + Add Dog and **More ▾**. More holds,
  in groups: Log events for several dogs (renamed from "Log for several dogs"), ✨ Check in on
  my dogs | Family tree | Add dogs from a card (Pro), Import pedigrees.
- `.action-menu-list > [hidden]` so an edition-hidden menu item stays hidden.
- Shared `.action-menu`: items stay on one line; `wireActionMenu` opens the list left-aligned when right-aligned would run off the screen (a wrapped button on a phone).
- New app-wide rule (owner's): no more than 2–3 buttons in view; extra actions go in a dropdown.
  Recorded in the End-State guide §13 and CLAUDE.md.
- **Service worker:** no file added or renamed.
- **Service worker:** `CACHE_NAME` bumped to `kennelos-shell-v158` for this session's Dogs page batch.

## 2026-11-18: Line management plan (docs only)

- **Owner's request:** every dog related to every other dog in the program, with the
  ancestors they share; warnings for close pairings (today's pairing form checks only sex
  and same dog); traits graded in their own tables as a long-lived view of the dog, not as
  events; pairing recommendations and what the program is missing; breeding outcomes as
  structure (colors, abnormalities, C-sections) so they can be evaluated, including what an
  untested dog must carry from the colors it throws; her own color list as an enforced
  dropdown asked at birth, with the standard coat genes shipped; light trait scores on pups
  before go-home.
- New `docs/KennelOS_Line_Management_Plan.md`: what's there today (§2), the design (§3:
  derived kinship, COI, relationship names, shared ancestors and pedigree depth; tables
  `trait_definitions`, `dog_traits`, `colors`, `birth_records`; DNA per marker; derived
  coat genetics; production and line insights; the pairing finder), the data model (§4),
  decisions D1–D12 (D4, and her own color list in D5, are the owner's; the rest have a
  recommendation and are open), and five phases. Phase 1 needs no schema change.
- README doc map and Status. No code changed.
- **Service worker:** no app file added or changed.

## 2026-11-18: Program types plan (docs only)

- **Owner's request:** the type of program a breeder runs should drive her view: a breeder
  who shows needs show information close, one not breeding registered dogs doesn't need it,
  stud services may be absent or a main income. Show breeders would use the line tools;
  large commercial kennels likely wouldn't.
- New `docs/KennelOS_Program_Types_Plan.md`: six types with each one's top six priorities
  and where KennelOS stands (§1), the questions that cut across them (§2), what a type sets
  (features, tabs, Home tiles, a dog's section order, line tools; one main type plus up to
  two others; never locked) (§3), the gaps by type (§4), data and code (§5), decisions
  D1–D6 (§6).
- `docs/KennelOS_Line_Management_Plan.md` §3.6 now follows the types: Line tools on for
  show, working and stud programs, off by default for family pet, doodle and large kennels;
  warnings and Relatives always on.
- README doc map and Status. No code changed.
- **Service worker:** no app file added or changed.

## 2026-11-18: Line management and program types: owner decisions (docs only)

- **Program types D1 (owner):** large or licensed kennels stay a type; none of their gaps
  (compliance, staff roles) are built yet.
- **Line management D13 (owner):** a COI she knows overrides the calculated one: a dog's
  `recorded_coi` (genomic test, registry, full pedigree) for that dog and in the kinship,
  and a new `Pairing.recorded_coi` (a trial-mating figure) for the litter, used by the
  warnings; the calculated figure stays visible and a wide gap is pointed out. §3.1, §4,
  §5 and Phase 1 updated.
- **Recorded as a consideration, not a requirement** (Line Management §8.1): traits and
  production facts of outside parents and ancestors (a dam's litter sizes, a sire's adult
  weight), raised by a breeder buying a pup from a dam with several large litters. Options
  noted: a `measured` trait scale; traits on pedigree-only Dog rows or a separate
  pedigree-traits table; hand-entered production facts for outside dogs.
- No code changed. **Service worker:** no app file added or changed.

## 2026-11-18: The next channel: a test build of Pro at next-pro.kennelos.app

- **Owner's request:** a segregated next release to see and test what's being built without
  touching production. Decided with the owner: Pro only, license gate off, `next-` names,
  no banner (the nav's edition tag reads "Next" instead).
- New `build/nextChannel.mjs` and `node build/assemble.mjs pro --channel next` (→
  `dist/next-pro/`): staging cloud and KennelPort URLs, the license gate off, the "Next" tag,
  the name "KennelOS Pro Next", a `-next` cache name, `robots.txt`. Fails the build if the
  config would still name a production server.
- New `.github/workflows/deploy-next.yml`: pushes to the `next` branch run the tests and
  publish to `NoliCommoveri/kennelos-next-pro` (`next-pro.kennelos.app`). `deploy.yml` is
  unchanged.
- Cloud: `lib/cors.js` takes `env` and allows `EXTRA_APP_ORIGINS` (comma-separated), set in
  the staging Worker's `[vars]` only, to `https://next-pro.kennelos.app`.
- Tests: `tests/nextChannel.test.js`; `cloud/tests/config.test.js` (staging lists next-pro
  and matches deploy-next.yml, production never sets it); `cloud/tests/worker.test.js`
  (the preflight with and without it). `node --test`: 2238 pass.
- Docs: `build/README.md` "Next channel" (setup steps for the owner, test data, what still
  reaches real services, schema on next, releasing), `cloud/README.md`, README build line.
- App source unchanged. **Service worker:** no app file added or changed.

## 2026-11-19: The next release's own record; the next build refreshes per commit

- **Owner's request:** a new session should know what's on `next`, and next-release work
  stays out of the build log and the End-State guide until it's brought in.
- New `docs/NEXT.md` (the copy on `origin/next` counts): what's on `next` now, its log, the
  guide changes waiting, and the bring-in steps.
- CLAUDE.md: a "Next release" section (which work goes on `next`, branching and PRs into
  `next`, records only in `docs/NEXT.md`, no cache bumps on `next`, schema and migrations on
  `next`, bringing it in), and session start leaves `next` out of the unmerged-work count.
- README: doc map row and a Status line pointing at `docs/NEXT.md`.
- `build/nextChannel.mjs`: the next build's cache name is `-next-<commit>` (GITHUB_SHA in
  CI, `local` otherwise), so each deploy refreshes testers' caches. `tests/nextChannel.test.js`
  updated; `build/README.md` "Next channel".
- **Service worker:** no app file added or changed.

## 2026-11-19: Review batch C: the duplicate scan at scale, and big, repeated and non-UTF-8 imports

Review Remainder plan batch C (K1-4, K2-7, K2-11, K2-12). No owner decision needed.
- **K1-4, the duplicate scan froze the page** (`data/tidyRules.js`, `data/duplicateScan.js`,
  `data/dogSearch.js`, `data/recordMerge.js`): each dog's keys are built once per scan
  (`dogIdentity`), call names are bucketed with the birthday (`eachDogPair`; an undated dog
  is compared with every birthday of its name), `compareIdentities` rules a pair out before
  building any label, and the scan makes one pass over dog pairs for a file Merge's rules and
  the tidy-up's instead of comparing them twice. `findDuplicatesAsync` gives the page a turn
  between tables so "Scanning…" paints; the card uses it. 4,000 dogs in 8 call names: the scan
  5.7 s → 0.05 s and the tidy-up 4.4 s → 0.03 s (Node); with no birthdays, 5.3 s → 0.7 s and
  4.1 s → 0.6 s, and under 1 s on the page in Chromium. Results checked identical to main's
  over 3,000 random programs for both.
- **K2-7, a 10,000-row import** (`data/csvImport.js`, `assets/importView.js`,
  `data/settings.js`): the preview draws the first 200 rows and every review row
  (`previewRows`) with "Showing N of M"; the Match existing list is filled only when used;
  `commitPlan` writes 200 rows per transaction with `onProgress`, the view shows "Imported
  2,400 of 10,000…", and `settings.setImportProgress` keeps how far it got, so an import cut
  off part-way says on the next visit where it stopped.
- **K2-11, a re-import rewrote every record** (`markUnchanged`): an update keeps only the
  fields that differ; one that changes nothing is `unchanged`, counted and never written. Rows
  linked to a parent in the file or creating a contact at commit stay updates. The expense
  import, which has its own commit, opts out.
- **K2-12, non-UTF-8 files** (`parseCsv`, `decodeCsvFile`): bytes decoded as UTF-8, else
  Windows-1252 with the warning in the preview, the several-file import and the expense
  import.
- Tests: `tests/duplicateScan.test.js` (4,000 dogs both ways, under a generous bound, and
  the async scan), `tests/csvImportPlan.test.js` (unchanged re-import keeps `updated_at`, only
  differing fields, the opt-out, chunked progress, Windows-1252 "Zoë", the 10,000-row
  preview); `tests/csvImport.test.js` and `tests/keeperTests.test.js` stub the transaction
  where they stub the repo. `node --test`: 2246 pass, 1 todo (Load Performance Phase 3).
- Docs: End-State guide §9 (reading the file, big files, only what differs is written) and
  the duplicates card (dogs at scale); Review Remainder plan status; `FIX_PRIORITIES.md`.
- **Service worker:** no app file added, renamed or removed.

## 2026-11-19: Review batch B: per-pup Furever packs, and two fields to the cloud

Review Remainder plan batch B (K14-3, K1-5). **Owner decisions** (2026-11-19, as
recommended): R1, `litters.furever_pack` and `dogs.status_date` are cloud fields; R6, the next
publish moves every pup to its own pack and trashes the old shared files.
- **Publish** (`data/fureverContentPack.js`): a litter's folder and manifest hold only the
  sire's and dam's documents. Each pup's own go in its own folder (`Litter — <nickname> —
  <pup>`), beside the litter's under the unshared root, with its own `pack.json` (scope `pup`)
  at the litter's version; pointers in `furever_pack.pupManifests`. A pup document from before
  (no `folderId`) is uploaded again into its pup's folder and the old copy trashed, and the
  console then says to send each family its Furever link again. **Modified** from the plan:
  the pup folders aren't inside the litter's (a sub-folder inherits its link share), and
  `pupManifests` is on the pointer and in each seed, not in the litter manifest.
- **Seed** (`data/fureverSeedExport.js`, `packagePointer` exported): a litter pointer carries
  only this pup's `pupManifestFileId` / `pupManifestResourceKey`.
- **Furever** (`furever/data/contentPackFetch.js`, `contentPackRepo.js`): reads the pup's own
  manifest beside the litter's; skips a fetch only at the same version and pup manifest, so a
  resend that adds one fetches again; an older litter pack is still filtered to this pup.
- **Console** (`pages/furever.js`): the confirmation covers the sire's and dam's documents and
  contracts; a pup's own other documents need none. The litter card's hint says a pup's
  documents go in a pack only its family is sent.
- **Cloud fields:** `furever_pack` (litters) and `status_date` (dogs) in `syncRegistry.js`;
  `cloud/src/lib/cloudFields.js` regenerated.
- Tests: new `tests/fureverPupPacks.test.js` (a fake Google Drive: the litter manifest holds
  only the parents', family B's seed and the litter manifest hold no id of pup A's, pup
  folders aren't in the shared one, a republish over an old pack moves and trashes, an empty
  pup manifest, the kennel pack unchanged); `tests/fureverData.test.js` (own pack plus the
  parents', a resend adding the pup pack, an old-shape pack, an unreachable pup pack).
  `node --test`: 2256 pass, 1 todo; `cd cloud && npm test`: 390 pass.
- Docs: End-State guide §27.1 and the Dog and Litter field rows, the Content Package Fetch
  Mechanism (**Modified**), Review Remainder plan, `FIX_PRIORITIES.md`, README Status.
- **Service worker:** no app file added, renamed or removed (KennelOS or Furever).

## 2026-11-19: Review batch D: Worker reads that grow with programs, and a restore that can finish

Review Remainder plan batch D (K4-11, K4-14). Worker only. R7 (chunk the restore and make it
re-runnable, giving up "lands whole or not at all") is built as recommended and waits on the
owner's confirmation.
- **K4-11** (`src/retention.js`, `src/notify.js`): retention reads committed snapshots a page of
  200 programs at a time and stops once a run's 1,000 deletes are full; the pending read has a
  `LIMIT`. `runDigests` pages `notify_settings` by program (200). `syncCounts` is unchanged: three
  `COUNT(*)`s, one row each.
- **K4-14** (`src/backup.js`, `src/ops.js`): `exportAll` reads each table 1,000 rows a page and
  leaves out the restore's own note. `importAll` checks everything first as before, then writes
  200 rows a batch in `EXPORT_TABLES` order with `INSERT OR IGNORE`; `ops_config`
  `restore_in_progress` (the file's `exported_at`) lets that file, and only it, carry on over a
  partly-restored database, and is removed when it finishes. /ops says "Restored N of 33 tables
  (…). Run it again with the same file to finish." **Modified** from the plan: `OR IGNORE`, not
  `OR REPLACE`, since a replace deletes first and a cascading foreign key would take children.
- **Measured** locally (node:sqlite, not D1) at 2,000 programs, 108,000 snapshots, 100,000
  `wl_events`, 4,000 `sync_devices`: retention 0.8 s, export 0.8 s (55 MB), import 3.6 s in 1,104
  batches. A run against a copy of production is still to do.
- Tests: new `cloud/tests/scale.test.js`, with reads capped by row count the way D1 caps a
  response: retention over more programs than a page keeps its cap and reaches them all, the
  digests reach programs past the first page, the export pages, and a restore failed on its third
  batch and run again ends identical to a clean one (another file refused meanwhile). All four
  fail on the code before. `cd cloud && npm test`: 394 pass; `node --test`: 2256 pass, 1 todo.
- Docs: `cloud/README.md` (retention, backup, the measured run), Cloud Phase 1 plan §6.3
  (**Modified**), Review Remainder plan, `FIX_PRIORITIES.md`, README Status.
- **Service worker:** no app file touched. No migration.
- **Service worker:** `CACHE_NAME` bumped to `kennelos-shell-v159` for review batches B, C and D
  (owner's go-ahead), so installed copies pick up the import, duplicate-scan and Furever changes.


## 2026-11-19: One person, one set of details on the waitlist family page

The owner's rule: a family's name, email, phone and address are one set, edited where she
works with them, the same everywhere, with nothing on screen about where it's stored. Before
this, Edit on a linked family's page changed the application's copy, which nothing reads once a
contact exists: a corrected email still had the next "It's your turn" and sign-in codes going to
the old address, with no warning.
- **The family page** (`pages/waitlist-entry.js`): once linked, Details shows Name (to their
  contact page), Email, Phone and Address from the contact, and Edit opens with **Their
  details**, saved by the new `waitlistActions.saveEntryEdits` (contact and entry in one
  transaction, only what changed). The application's name, email and phone answers aren't shown
  or offered then; the "Name, email and phone are what they applied with" hint is gone.
- **Joining the person they already are:** `waitlistRules.contactForEmail` links a new
  application to the one live contact with exactly that email, online (`cloud/cloudWaitlist.js`),
  typed in (New application) and CSV import (`csvImport.js`). **Modified:** Waitlist Spec §5.2
  ("never automatic") for an exact email.
- **Old addresses stop working:** the portal feed's `emails` is the family's current address only
  (`portalFeed.emailsOf`), not every address they ever applied with. Status-page codes already
  went to the current one (`entryEmail`).
- Tests: new `tests/familyDetails.test.js`; `csvImport` and `cloudWaitlist` (an email she already
  has joins that person), `portalFeed` (one address). `node --test`: 2267 pass, 1 todo. Checked in
  Chromium: Edit on a linked family saves the new email to the contact and the page shows one set.
- Docs: End-State guide §29 (actions, the rule) and §35.1 (`emails`), Waitlist Spec §5.2.
- **Service worker:** no file added or renamed; `CACHE_NAME` bumped to `kennelos-shell-v160`
  (owner's go-ahead), so installed copies pick up the family page change.

## 2026-11-19: Plan for the Stripe webhook on waitlist deposits

- New `docs/KennelOS_Stripe_Webhook_Plan.md`, for `main`. It writes down the promise to
  families: a turn runs its full scheduled time, and the family can switch pups until the
  deadline. At the deadline, a received deposit locks in the pup selected then; with no
  deposit, the pup is released to the next family. Today the hourly server moves close a
  picked turn at its deadline as `no_deposit` even when it was paid, because only her open
  device sees Stripe payments. The webhook records the payment on the server so the deadline
  check (and the family's page) can see it. Her own Stripe account holds the endpoint, and the
  Worker keeps only its sealed signing secret. O1–O7 are open.
- README: doc map row and Status line. Docs only: no code, tests or service-worker change.

## 2026-11-19: Waitlist timers, Phase 1: turns in hours, deadlines at a time of day

- New `docs/KennelOS_Waitlist_Timers_Plan.md` (on `main`, ahead of the Stripe webhook plan): the
  three timers she asked for (picks open in…, your turn could come by…, your turn ends in…), with
  the owner's T1–T4 and T5–T9 as recommended. Phase 1 built; Phases 2–3 (the countdowns, the
  planned opening time, the estimate) planned.
- **Turns in hours:** Waitlist settings → Turns & offers, **How long a turn lasts** (days, as
  before, or hours) and **Families' waking hours** (`waitlist_config.turn_hours`,
  `awake_from`, `awake_until`). A turn ends that many hours after it's offered, counted on her
  open days, rounded up to the half hour, and moved into waking hours
  (`waitlistRules.respondBy` / `hoursDeadline`). Unset, nothing changes.
- **A deadline's time:** `waitlist_offers.respond_by_time` ('HH:MM' kennel time, cloud; null =
  11:59 pm), written by every turn writer; `extendTurn` takes `untilTime`. Overdue, Today's
  nudges, the picks panel, the Waitlist page, a family's page, Kels's Review, the picks preview
  and her emails read the time (`kennelNow`, `isTurnOverdue(turn, now)`, `deadlineLabel`,
  `turnLengthText`).
- **Worker:** `serverMoves` mirrors the rule, closes a turn at its time, gives the turns it offers
  a time, and sends a timed turn's last reminder 3 hours before its deadline. The waitlist moves'
  cron is `0,30 * * * *` (was `7 * * * *`, both environments); email changes, digests and e-sign
  jobs run on the :00 run only. The family's page prints the deadline's real time.
- Tests: new `tests/waitlistTimers.test.js` (the rule, closed days, programs, overdue, device and
  Worker agree, the actions, the projection); `cloud/tests/serverMoves.test.js` (closed on the
  7:00 pm run, the 3-hours-before reminder, rounding); `config.test.js` (the cron);
  `cronResilience.test.js` (the :30 run is the moves only). `node --test`: 2283 pass, 1 todo;
  `cd cloud && npm test`: 399 pass. Checked in Chromium: the setting switches
  and saves.
- Docs: End-State guide §29 (Turns in hours, `waitlist_offers`), `cloud/README.md`, README.
- **Service worker:** no file added or renamed (new test file only); `CACHE_NAME` not bumped yet.
- **Deploy:** the Worker change (cron and serverMoves) ships with Workers Builds on merge; no
  migration.

## 2026-11-19: Waitlist timers, Phases 2–3: the planned opening, countdowns, the turn estimate

- **The planned opening:** Litter `picks_open_time` (cloud; **Picks open at** on the Litter
  page, Pro) and her usual `waitlist_config.picks_open_time` (Turns & offers). Today's
  Open-picks nudge comes at that time (`plannedOpening`, `isOpeningDue`, `depositsDueLitters`
  with a now), and the Worker sends her one alert then (`picks_due`, scheduled runs only).
  Kels's litter questions don't ask for the time (a **Modified:** note in the plan).
- **Countdowns:** `dateUtils.zonedInstant` / `countdownText`, `ui.countdownHtml` /
  `startCountdowns`, and the family pages' copies. "Picks open in …" on a born litter's Coming
  up card (status page and public list, where she shows it) and on her picks panel; "Your turn
  ends in …" on the family's turn card and deposit block, and "ends in …" on her panel. The
  Worker adds `respond_by_at` and `picks_expected_at`.
- **The turn estimate:** the projection's `next_opening` (the one turn order with her soonest
  planned litter counted open); `serverMoves.turnEstimate` on the Worker; `family.turn_estimate`
  (a time, never a count) on the status page's Current Position card. Owner, 2026-11-19: open
  litters share one turn order, so it counts the families ahead in that order, not a litter's
  own line.
- Tests: `tests/waitlistTimers.test.js` (planned opening, countdown moments and words, the
  projection, the estimate through `statusView`); `cloud/tests/serverMoves.test.js` (moments
  across DST, the estimate in days, hours and from a planned opening, the alert once);
  `familyPages.test.js` (the new moments). `node --test`: 2291 pass, 1 todo; `cd cloud && npm
  test`: 404 pass. Checked in Chromium: the Litter page's planned time and countdown, an open
  turn's "ends in", Lite's Litter page unchanged; no console errors.
- Docs: End-State guide §29 (Countdowns and the planned opening, The turn estimate; Litter's
  `picks_open_time`), the plan (all three phases built), README.
- **Service worker:** no file added or renamed; `CACHE_NAME` bumped to `kennelos-shell-v161`
  (owner's go-ahead), so installed copies pick up the timers. The family pages ship with the
  Worker (Workers Builds).

## 2026-11-19: The turn estimate only for families who could get a pup

- Owner: don't tell #100 their turn could come in 100 days when there are 6 pups.
  `serverMoves.turnEstimate` now walks the turn order with the pups this family wants (available
  now): the turn holder's pick (or one of their pups) and each family ahead who'd take one of
  them takes one, and a family left with none gets no estimate. Worked out when the page loads,
  so it follows every turn and pick. `next_opening.queue` rows carry `dog_ids` (was a count);
  the "Puppies may be chosen before your turn" line and `short` are gone.
- Tests: `serverMoves.test.js` (6 pups and 100 families: the sixth hears, the seventh doesn't; a
  pick taking the last pup), `waitlistTimers.test.js` (one pup, two families). `node --test`: 2291
  pass, 1 todo; `cd cloud && npm test`: 404 pass. Screenshots in Chromium of the family turn
  card, the estimate, Coming up's "Picks open in", the public list and her picks panel.
- Docs: the plan and End-State guide §29. **Service worker:** rides `kennelos-shell-v161`.

## 2026-11-19: Each family's estimate counts to their own next chance

- Owner's example: litter A opens Jan 4, litter B Jan 10; a family who passed on all of A should
  count down to B while a family still waiting on A counts to A. The projection's
  `next_opening` (her soonest planned litter only) becomes `openings` (every planned litter,
  soonest first, at most six, each walked with the ones before it counted open).
  `serverMoves.turnEstimate` counts a family not in line on the open litters to the first
  planned one they'd get a turn on, and names it; families ahead who wait only on earlier
  litters count only while their own turn would still be running (memoized). The status page
  adds "Picks open on [litter] in …" above the estimate.
- Tests: `serverMoves.test.js` (her example; two planned litters with "Not this litter" on the
  first; the page names the litter). `node --test`: 2294 pass, 1 todo; `cd cloud && npm test`:
  407 pass. A list of 200 families and 6 planned litters takes about 5 ms a page.
- Docs: the plan and End-State guide §29. **Service worker:** rides `kennelos-shell-v161`.

## 2026-11-19: Review batch G: money on the Sale and invoice pages

Review Remainder plan batch G (K10-9, K10-10, K10-11), on `main`. Each finding rechecked on
the code first: all three still stood. R4 (two refund fields) is built as recommended and waits
on the owner's confirmation.
- **K10-9** (`pages/invoice.html`): `.inv-actions` wraps. In Chromium the invoice was 437 px
  wide at 390 and 402 at 320 (Back cut off on the left, Send payment link on the right); now
  390 and 320. The items table no longer overflowed at 320 px, even with five-figure amounts
  and long extra names, so nothing else changed.
- **K10-11 (R4)** (`data/vocab.js`, `data/saleRepo.js`, `data/incomeView.js`,
  `pages/sale.js`): `Sale.refund_amount` / `refund_date`, optional, private like `price`
  (`syncRegistry`; `cloudFields.js` unchanged). `vocab.canRecordRefund`: Returned or Cancelled
  and not a lost sale. `saleRepo` refuses a negative amount or a malformed date and clears both
  on any other status. `incomeView.refundComponents` takes the refund off as one negative
  `refund` line (new `INCOME_COMPONENTS` entry, **Refunds**) on its date, capped at what the
  sale earned. The Sale form shows **Refunded** and **Refund date** (the date required with an
  amount); the view shows Refunded. Kels's answer on cancelled and returned sales says where a
  refund goes. **Modified** from the plan: Cancelled rather than Voided (a voided sale already
  counts nothing).
- **K10-10** (`data/incomeView.js`, `pages/sale.js`): **You net** on the Sale page is
  `getSaleNet`, the sale's ledger row (`getIncomeRows({ saleId })`) plus the credited
  application fee: the review's sale reads $3,060, not $2,910. The form's live line is now
  "Price after the fee".
- Tests: new `tests/saleRefunds.test.js` (10 of its 11 failed before). `node --test`: 2278
  pass, 1 todo. `node build/assemble.mjs` builds every edition. Checked in Chromium at 390 px:
  the invoice has no sideways scroll; on the Sale page the refund fields come and go with the
  status and reason, a refund without a date is stopped, and You net reads $3,060 and then
  $2,060 after a $1,000 refund.
- Docs: End-State guide (Sale fields, sale status rules, §21 income, §21.1 You net), Payment
  Schedule plan §7 (**Modified**), Review Remainder plan, `FIX_PRIORITIES.md`, README Status.
- **Service worker:** no app file added or renamed (`PRECACHE_URLS` unchanged).

## 2026-11-19: Review batch F: pedigrees and a delivered pup's life stage

Review Remainder plan batch F (K9-7, K9-8, K9-9, K9-11), on `main`. Each finding rechecked on
the code first: all four still stood. R3 (ask the life stage on Delivered, and a six-month
nudge) is built as recommended and waits on the owner's confirmation.
- **K9-7 (R3)** (`data/goHome.js`, `pages/sale.js`, `data/nudges.js`): the Delivered prompt
  asks **What is Ruby now?** (Leave as Puppy, Pet home, Active breeding) unless External;
  `deliveredOwnershipChanges` takes `stage` and writes it with `status_date`. New nudge
  `delivered-still-puppy` (`deliveredStillPuppyNudges`): a dog still Puppy more than 180 days
  after delivery (its last pickup logged, else the sale's balance paid date, else its sale date),
  offering Pet home or Active breeding. It covers Lite, the check-in and a skipped prompt.
- **K9-8** (`data/pedigreeEdit.js`, `assets/pedigree.js`, `pages/dog.js`, `pages/litter.js`):
  a chart fix that disagrees with the pup's litter asks the whole litter (the litter and every
  pup still on the old parent) or just this pup; Cancel writes nothing. The Dog form warns about
  a sire or dam that isn't its litter's (Use the litter's / Change the litter's). A Litter page
  sire or dam edit offers to move the pups still on the old one; a split pup is left alone.
- **K9-9** (`pedigreeEdit.nameMatches`, `addNewParent`): a typed name already on a live
  pedigree-only dog (`nameKey`: titles, case, punctuation aside) asks "Use CH Briar Ace already
  on file?" before writing; a different registration number keeps them apart.
- **K9-11**: a registration number on an archived dog is refused with its name, not reused.
  `spotFixable`: in Lite an archived ancestor's own spot keeps its ✎; its sire and dam get no ✎
  or + Add.
- Tests: new `tests/pedigreeLifeStage.test.js` (8 of its 10 failed before). `node --test`: 2288
  pass, 1 todo. `node build/assemble.mjs` builds every edition. Checked in Chromium: the litter
  question (whole litter moves Blue too; Cancel leaves Ruby on Rocco), the same ancestor typed for
  Rocco and Hazel is one record, the Dog form's warning, the Delivered prompt at 390 px (Co-owned
  plus Active breeding), and in the built Lite edition an archived ancestor with nothing to add
  under it.
- Docs: End-State guide (Delivered, the nudge table, fixing a spot in a pedigree), Review
  Remainder plan (**Modified**), `FIX_PRIORITIES.md`, README Status.
- **Service worker:** no app file added or renamed (`PRECACHE_URLS` unchanged).

## 2026-11-19: Review batches F and G brought onto the waitlist timers branch

- Batches F and G (`ccr-dca01807-5vxcg1`) cherry-picked onto the timers branch so they ship in one
  PR; the only conflicts were this log and the End-State guide's Litter and Sale rows (both
  kept).
- `tests/loadBudget.test.js`: the Dog page's budget 1220 → 1240 KB. With both branches the page
  loads 1,221 KB (the timers' additions to `waitlistRules.js` and batch F's Dog changes), one
  over; each alone was under.
- `node --test`: 2315 pass, 1 todo; `cd cloud && npm test`: 407 pass.

## 2026-11-19: Status page pop-ups replace the turn estimate

- The owner withdrew the Waitlist Timers plan's Phase 3. "Your turn could come by…" is gone
  (`serverMoves.turnEstimate`, `family.turn_estimate`, the Current Position card's estimate).
- A pop-up on opening the status page, one per visit, closed with **Got it**; her preview shows
  it too. `familyPages.statusPopup` picks it: `turn` ("Choose your pup! Time left to pick and
  pay:" in big bold words, "Thanks for choosing! Time left to pay:" after a pick, "Time's up.
  Waiting on [kennel]." at zero), `open`, `soon`, `open_far`, `soon_far`, `skipped`. None while
  paused or held, with no litter, for a side sale, or with her box empty. Decided with the owner:
  skipped includes families who match no pup; a new "may" message (`soon_far`) before picks
  open; `open` also between turns; the turn pop-up changes after a pick.
- Her words: `waitlist_config.status_popups` (Waitlist settings → Messages to families →
  Status page pop-ups; `waitlistRules.STATUS_POPUP_DEFAULTS`, `statusPopupTexts`), published
  as the projection's `kennel.status_popups`; the Worker fills [Kennel] and [opening soon/open].
- `serverMoves.turnReach` replaces the estimate's pup walk. Testing several litters at once
  found three faults, all fixed: a family ahead was counted taking a pup from each litter
  (now one walk, one pup per family, litters in opening order), "Not this litter" on a born
  litter was ignored, and a family who'd said "Not this litter" to every open litter read as
  in line.
- Tests: new `tests/statusPopupScenarios.test.js` (11 layouts: litters weeks apart, close
  together, overlapping, three litters, passes, no response, no match, listen-only, days and
  hours), the pop-up and reach tests in `cloud/tests/serverMoves.test.js`,
  `tests/waitlistTimers.test.js`, `tests/waitlistProjection.test.js`. The Litter page's load
  budget 1560 → 1570 KB (the default words, 1,561). `node --test`: 2324 pass, 1 todo;
  `cd cloud && npm test`: 404 pass. Checked in Chromium at 390 px: the turn pop-up before and
  after a pick, `open`, `open_far`, Got it closing it.
- Docs: End-State guide §29, the Timers plan (**Modified**), README doc map.
- **Service worker:** `CACHE_NAME` v161 → v162 (Waitlist settings' pop-up words reach devices); no app file added or renamed (`PRECACHE_URLS` unchanged).


## 2026-11-19: Every listen-only change waits for her

- Owner's decision: a family's change to which litters they wait for (listen-only: All /
  Only these parents / Not these parents) now always becomes a request she approves or
  declines, wider or narrower. Before, a wider change (back to All, adding a parent to
  "only", removing one from "not") applied at once.
- `waitlistEvents.planFamilyEvent` `listen`: any real change → `listen_request`; the
  `listen_apply` op is gone (`waitlistActions.applyFamilyPlan`). The Today nudge and the
  entry page's request line say Wider or Narrower (`listenChangeKind`), with a "wait for all
  litters again" title for a change back to All. `approveListenChange` already kept earlier
  picks when going back to All. Status page: the Parents help line and the sent message now
  say she approves each change.
- Tests: `tests/waitlistEvents.test.js` (wider changes are requests), `tests/cloudWaitlist.test.js`
  (approving back to All keeps the picks). `node --test`: 2324 pass, 1 todo;
  `cd cloud && npm test`: 404 pass.
- Docs: Waitlist Spec Q29, §15.7 item 6, §16.3, §16.6 (**Modified**); End-State guide (family
  actions); tests README.
- **Service worker:** no `CACHE_NAME` bump yet; no app file added or renamed.

## 2026-11-19: Plan: families change their answers themselves before pups are born

- New `docs/KennelOS_Family_Free_Changes_Plan.md` (owner's request): a per-change setting
  (sex, breed, looking for, colors, ready to buy, parents, pause, and a new "end my pause
  early"), each set separately for before and after pups are born ("pups on the ground" =
  any litter of the kennel whelped and not closed). Defaults keep today's behaviour.
  Seven open questions (§8). Nothing built. README doc map gains the plan.
- Same day: the settings became the owner's checkbox grid, "Allow auto-approval of changes
  to the following preferences:" with Before / After pups are born columns
  (`family_changes` booleans), plus "Let families ask to end a pause early"
  (`unpause_allowed`). Q3 settled by the grid (warning kept).

## 2026-11-19: Families change their answers themselves before pups are born (built)

- Built `docs/KennelOS_Family_Free_Changes_Plan.md` on `main` with the owner's decisions
  (the recommendations; colors stay hidden while color matching is off).
- Rules (`waitlistRules`): `FAMILY_CHANGE_KINDS`, `familyChanges`, `PUPS_ON_GROUND_STATUSES`,
  `pupsOnGround`, `changePhase`, `freeChanges`; config keys `family_changes` (null = all off)
  and `unpause_allowed` (false).
- Waitlist settings → **Family changes** (online lists): "Allow auto-approval of changes to the
  following preferences:" grid, Before / After pups are born, plus "Let families ask to end a
  pause early"; a warning while any After box is ticked; the phase now.
- Projection: per family `changes: { free, phase, unpause_offered }` and `requests.unpause`.
  Server: `familyPages.changesOf`, `familyActions.freeMark` (stamps `free` on change events),
  new action `unpause`; `notifyEvent` `push: false` and `…_free` lines (digest only, kept out of
  later alerts).
- Device: `planFamilyEvent` decides free vs request with her records now (`pref_apply`,
  `listen_apply`, `pause_apply`, `unpause_apply`, `unpause_request`; "Not yet" pauses at once);
  `applyFamilyPlan` and new `approveUnpauseRequest` / `declineUnpauseRequest`;
  `pref_change_log` `by: 'family'`. New entry field `unpause_request` (private in
  `syncRegistry`). Today: the unpause request nudge and "families can change their answers
  themselves again" (14 days after the last born litter closes). Entry page: the unpause
  request and history. Status page: Change / Save, End my pause, marked answers, saved lines.
  Policies: the Preferences and Pausing starters follow the setting (`BASIS`).
- Tests: new `tests/familyFreeChanges.test.js`; `tests/cloudWaitlist.test.js` (applying free
  changes, approving an early end), `tests/waitlistProjection.test.js`,
  `cloud/tests/familyActions.test.js`, `cloud/tests/notify.test.js`. Load budgets: today and
  waitlist 1760 → 1770 KB, dogs 1040 → 1050, sale 1380 → 1390 (the rules). `node --test`:
  2337 pass, 1 todo; `cd cloud && npm test`: 408 pass. Checked in Chromium at 390 px: the
  Family changes group saves its boxes, the warning and the phase line. The family status
  page wasn't opened in a browser (it needs the cloud server).
- Docs: End-State guide §29 (Free changes, family actions, answer log, notifications, Today
  table), Waitlist Spec §15.9 (**Modified**), the plan (status, decisions, **Modified**),
  README doc map, tests README.
- **Service worker:** `CACHE_NAME` v162 → v163 (this session's batch: the listen-only lock and
  free changes reach devices); no app file added or renamed (`PRECACHE_URLS` unchanged).

## 2026-11-19: Review batch H: updates reaching open pages, storage asked when there's something to keep, the helper gate on the server's word

Review Remainder plan §3 H (K13-10, K13-13, K5-11). The owner also confirmed R3, R4 and R7 as
built, and the local measurement for R7 (no run against a production copy).
- **K13-10 (R5):** new `shared/assets/appShell.js`, loaded lazily by `app.js`. On
  `controllerchange` a page with no open modal and no typing since it loaded reloads itself;
  otherwise a strip says "KennelOS was updated. Save anything you're working on, then Reload".
  The first install claiming a page is ignored. `app.js`'s lazy imports (Stripe links, Jotform
  keys, portal feed, website banner, waitlist actions) and Today's website banner end in
  `moduleFailed`, which shows the same strip for a module error while online.
- **K13-13:** `navigator.storage.persist()` is asked once her first record is saved
  (`CLOUD_DATA_CHANGED_EVENT`), or at once on a load that already holds a kennel or dog; never
  in the Demo or the tour (`askPersistenceWhenKept`).
- **K5-11:** the Pro licence gate skips only for a confirmed helper session
  (`settings.isConfirmedHelperSession`: token, `role: 'helper'`, `helperConfirmedFor` =
  `programId`). `setHelperSession` stores the redeem answer; `assistState()` stores a
  `role: 'helper'` answer; `cloudAssist.helperSkipsLicenseGate` asks `GET /assist/state` once
  for a session without it, and fails closed. `kennelportLink.licenseOk` uses the same check
  (it had the same bypass).
- Tests: new `tests/appShell.test.js` (idle reload, typed or modal → strip, first claim
  ignored, module errors only, persistence not before the first record / once / at once with
  records); `tests/cloudClient.test.js` (forged sessions walled, a real helper passes with no
  request, an older helper session asks once and keeps the answer, an owner never skips);
  `tests/siteExport.test.js` (a role alone no longer passes `licenseOk`). `node --test`: 2345
  pass, 1 todo. Checked in Chromium: a first visit to `/shared/` doesn't call `persist()`, the
  first data change does; a typed page shows the strip on `controllerchange`; on the built Pro
  edition a forged `role: 'helper'` session with the network blocked paints the wall (before
  the fix it didn't). The app.js load budget holds at 940 KB with no room left.
- Docs: End-State guide §12 (updates reaching open pages, durable storage), §30 (assisted
  setup's gate), the KennelPort link's licence check; Review Remainder plan (status, H
  **Modified**); Assisted Setup plan (**Modified:** K05-11); `FIX_PRIORITIES.md` K05 and K13
  rows; README Status.
- **Service worker:** `assets/appShell.js` added to `PRECACHE_URLS` (not Pro-only); no
  `CACHE_NAME` bump yet.
