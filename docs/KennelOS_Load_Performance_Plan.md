# KennelOS — Load performance and the tour's sample data: plan

> Status: **Phases 0, 1 and 2 built** (2026-11-18; 1 and 2 first); Phases 3–6 not built. Pages were slow to settle: on load the nav, the website
> strip and Today's top cards appear late and push buttons down mid-tap. This plan fixes
> that first (Phase 1), then makes the tour's sample data unable to outlive the tour
> (Phase 2: a read-only tour with auto-clear). After that it trims what every page loads
> (Phase 3), reads each table once (Phase 4), throttles the checks every page open repeats
> (Phase 5), and builds and caches smarter (Phase 6). Phase 0 adds the measurements and
> guard tests first. No server change and no migration anywhere in the plan.
>
> **All decisions are made** (§2; the owner, 2026-11-18). Next: Phase 3.

## 1. What's slow today (measured on `main` at `69105af`)

### 1.1 What moves after the page appears
- **The nav, in every edition.** Pages paint their HTML before the module scripts run, and
  `#app-nav` has no height until `renderNav()` fills it (`assets/app.css:40`; the 52 px
  is on `.nav-inner`, which doesn't exist yet). Everything under it drops 52 px.
- **The nav, much later in Pro.** `app.js` `boot()` waits for `ensureLicensed()` before
  `renderNav()` (`app.js:157`). That posts to Lemon Squeezy on **every page load**, with
  no timeout (`data/license.js:148`, `:341`). Meanwhile the page script draws its content,
  so the nav lands after it: 1–2 s or more on a phone, and until the request fails on a
  connection that is up but not working. The wall is an overlay (`licenseGate.mountWall`),
  and page content already draws before the verdict. So drawing the nav first loosens
  nothing.
- **The KennelPort website strip.** It is scheduled 1.5 s after load (`CHECK_DELAY_MS`,
  `assets/websiteBanner.js:23`). Each time, it reads seven tables and rebuilds the whole
  site bundle to compare (`data/kennelportLink.js:271`). Then it is inserted under the nav
  (every page but Today) or into `#today-website`.
- **Today's top cards fill in late, all above Reminders.** In order:
  - `#today-cloud`, after a 60-module / 1 MB dynamic import of `cloudBackupUI.js`;
  - `#today-website`, after 1.5 s or more;
  - `#today-nudges`, after `computeNudges()`, which is slower than Reminders but sits above
    it (`pages/today.js:577`).
- **Smaller ones:**
  - the kennel name added to the nav brand after a database read (`renderKennelBanner`);
  - the kennel switcher;
  - the grace banner;
  - cloud service notices on the first page of a session;
  - "Updated on another device".

### 1.2 What every page loads before anything runs
Static import graphs, unminified:

| Entry | Modules | Size |
|---|---|---|
| `app.js` (every page) | 56 | 893 KB |
| Today | 98 | 1,684 KB |
| Dogs | 63 | 989 KB |
| Dog | 75 | 1,169 KB |
| Litter | 96 | 1,499 KB |
| Sale | 83 | 1,327 KB |
| Waitlist | 101 | 1,691 KB |
| Waitlist entry | 113 | 2,003 KB |
| Kels | 128 | 2,094 KB |

Today's graph is 7 imports deep. Each depth level waits for the one before it.

What the shell loads that most page loads never use:

| Module(s) | Size | Reached through | Needed for |
|---|---|---|---|
| `sampleData.js`, which also brings `waitlistRules.js` and 11 more | 264 KB | `sampleDataUI` | the tour |
| `wizardSteps.js` | 28 KB | `editionTour.js` | the tour |
| `papaparse` | 19 KB | `kennelSetupUI` → `seedImport` | the setup modal |
| `pedigreeParse` | 29 KB | `kelsChat` → `ui.js` → `dogRepo` | pedigree work |
| `licenseGate` + `license` | 32 KB | `app.js` | Pro only (also loaded in Lite) |
| `onboardingUI` | — | `app.js` | first run only |

`today.js` → `nudges.js` statically pulls in `waitlistActions` (132 KB),
`waitlistProjection`, `incomeView`, `paymentSchedule`, `contractForms`, `recordMerge`,
`restoreMatch`, `tidyRules` and `portalFeed`. Most of them are needed only when a nudge's
button is pressed.

### 1.3 Reading the same data again and again
- **On one Today load,** dogs, contacts and kennels are each read in full several times:
  - by `today.js` `main()`;
  - by `computeNudges()`, three or four times over (`data/nudges.js:263`, `:289`, `:456`,
    `:569`, `:793`, `:800`);
  - by the website compare and the portal feed;
  - by the kennel banner.
- **`computeNudges()` reads the whole events table** (`nudges.js:266`). It also filters
  every event once per pup inside a loop (`nudges.js:410`).
- **Every data change reruns** the nudges, the website compare and the portal feed.
- **`migrateStudTrips()` scans every stud service on every page load** before it checks its
  flag (`data/studServiceRepo.js:93`).

### 1.4 Network on every page open
Pro, signed in to the cloud. In a multi-page app, every tap to a new page reruns all of it.

| When | What | Throttled across pages? |
|---|---|---|
| 0 s | Lemon Squeezy validate (holds the nav) | No |
| 0 s | Live-sync pull | n/a (wanted) |
| 0 s | Assist state, then a 5 s loop | Cached per page only |
| 2 s | Waitlist online sync (application inbox) | Not found |
| 3 s | Integrations events check (Stripe / Firma) | Not found |
| 4 s | Portal feed: a server-work claim, and a **second** Lemon Squeezy validate (`kennelportLink.licenseOk`) | Link status hourly; the validate isn't |

The device check-in (15 min), the Stripe link check (15 min) and the push refresh (daily)
are already throttled.

### 1.5 The service worker
`PRECACHE_URLS` has 470 entries, about 15 MB: 6.6 MB of app code plus 8.5 MB of Tesseract
and pdf.js. All of it is fetched with `cache: 'reload'` at install and after every
`CACHE_NAME` bump. That download competes with the first page on a new version. Reads are
cache-first, which is right.

### 1.6 The tour's sample data
- **Leaving the tour any way except Finish or Skip keeps the seed.** That includes using
  the nav or closing the tab. While the seed is loaded, `shouldRequireKennelSetup()` is
  false (`data/kennelSetup.js:69`), so the breeder starts working inside Thornfield.
- **Once a real record points at a sample one, clearing is refused** ("contaminated"). The
  tour's exit then **archives** those sample records and drops the manifest
  (`assets/wizardUI.js:178`). From then on nothing can tell them from the breeder's own
  records. They go into cloud backup too, because `dropSampleRows` relies on the manifest.
- **A failed clear is swallowed silently** (`wizardUI.js:181`).
- **The 264 KB of sample code loads on every page forever,** long after the breeder has a
  real program.
- **The Demo edition is seeded from the same packet.** The seed stays; only the in-app tour
  changes.

## 2. Decisions

All decided by the owner on 2026-11-18: D1 as asked, and D2–D11 by taking each
recommendation below.

| # | Question | Decided |
|---|---|---|
| D1 | How the tour's sample data is kept from outliving it | The tour is read-only, and the seed is cleared automatically. |
| D2 | How long a seed may live | Only while the tour is active, and only in the browsing session it was seeded in. Any other page load clears it and goes to kennel setup. A tour left in a closed tab doesn't resume; it is retaken (D3). |
| D3 | Retaking the tour once there's a real program | "Take the tour" opens the Demo edition in a new tab (from Lite too, with a line saying Demo shows Pro). The alternative is no retake once set up. Re-seeding next to real data is not an option. |
| D4 | Old seeds that real records already point at (manifest still there) | Delete every sample record. A real record's link to a sample **kennel** moves to the breeder's own kennel. If there isn't one yet, the cleanup waits until kennel setup saves. Links to sample dogs, contacts, pairings, litters or sales are cleared. A one-time notice lists each link that was cleared. |
| D5 | Old leftovers already archived without a manifest | Kels's Tidy up offers "Leftover tour records". It finds them by the seed's fixed names (Thornfield Kennels, Meadow Ridge, Briar Hollow and their dogs and contacts), archived ones only, and the breeder confirms. Never deleted automatically. |
| D6 | How often Pro asks Lemon Squeezy | The nav always draws first. Ask at most once per browsing session and again after 6 hours, with a 5 s timeout. The portal feed uses the stored verdict. A refunded or released key then walls at the next session or within 6 h, instead of on the next page. |
| D7 | The website strip's timing | Keep it under the nav (the owner's 2026-11-18 decision), but draw it in the first paint from the last result. Rerun the compare only when data changed since the last compare, after first paint. |
| D8 | "On open" checks repeated by every page | The waitlist inbox and integrations checks run at most once a minute across pages. The 5-minute polls and the immediate run after a data change stay as they are. Assist state is cached for the session, and the 5 s loop runs only while help is requested or active. |
| D9 | The 8.5 MB of OCR and PDF code in the install precache | Cache it in the background after the first page has loaded, instead of at install. A page that needs it before then fetches it as usual. Offline OCR and PDF work arrive seconds to minutes later than today. |
| D10 | Minified builds | Phase 6 lands the minify step of the Security Hardening plan (S3, `docs/KennelOS_Security_Hardening_Plan.md` §4), because it roughly halves download and parse time. Its tool and source-map choices are S3's, made there. |
| D11 | How to stop the repeated table reads | Pass the data in: Today hands what it loaded to `computeNudges(snapshot)`, and the nudge rules share it. No cache inside the repos, so they stay one thin repo per entity. |

## 3. Phases

Each phase ships on its own. Each ends with the docs it touches, a BUILD_LOG entry and the
owner's go-ahead for one `CACHE_NAME` bump. A new or renamed app file goes into
`PRECACHE_URLS` in the same change. A Pro-only one also goes into `proPages.js`.

### Phase 0 — Measure first, and guard (no behaviour change)
- **`tests/loadBudget.test.js` (new):** walks the static graph from `app.js` and each page,
  the same way `tests/liteImportGraph.test.js` does. It asserts:
  - a size and module budget per entry, starting at today's numbers (§1.2) and lowered as
    each phase lands;
  - after Phase 3, a "never statically" list for `app.js`: `sampleData`, `sampleDataUI`,
    `wizardUI`, `wizardSteps`, `onboardingUI`, `kennelSetupUI`, `seedImport`,
    `papaparse`, `licenseGate`.
- **`build/loadCheck.mjs` (new, run by hand, not part of `node --test`):** Playwright against
  `dist/pro` and `dist/lite` at 390 px, with Lemon Squeezy delayed 3 s by a route. On Today,
  Dogs, Dog and Sale it records:
  - when the nav appears;
  - the layout shift after first paint (CLS);
  - each table's read count, through a wrapped Dexie.

  Documented in `build/README.md`.
- **Record** the baseline numbers in BUILD_LOG.
- **Modified:** built after Phases 1 and 2, so the budgets start at the numbers after them
  (each page about one module and 20–30 KB over §1.2), and the baseline in BUILD_LOG is
  `main` before them against this build, run the same way (`--root`). As built:
  - a page's graph is `app.js`'s plus its own script's, as §1.2 measured it;
  - the budgets have a little room (two modules, a few tens of KB), so unrelated work doesn't
    fail them by a file;
  - the "never statically" list is in the test now, as a to-do until Phase 3 (it reports
    what `app.js` still reaches without failing);
  - `loadCheck.mjs` serves `dist/` itself, gives the device the edition's sample packet as
    real records, counts reads under IndexedDB rather than in a wrapped Dexie (so it sees
    every reader), blocks every outside request but Lemon Squeezy's, and takes `--root`,
    `--settle` and `--json`.
  - Found by it: **Dog and Sale still shift** after first paint (about 0.1 in Pro: the
    profile, payments and timeline sections filling in one after another), less than before
    (0.31 and 0.16 on `main`) but not none, as Phase 1's check asked. They're the pages' own
    sections, which no phase here covers.

### Phase 1 — Nothing moves after the first paint
**Files:** `shared/app.js`, `shared/assets/app.css`, `shared/assets/licenseGate.js`,
`shared/data/license.js`, `shared/assets/kennelSetupUI.js`, `shared/assets/kennelScopeUI.js`,
`shared/assets/websiteBanner.js`, `shared/data/settings.js`, `shared/pages/today.js`,
`shared/assets/cloudBackupUI.js`.
- **The nav's space is reserved before any script runs:** `#app-nav { min-height }` that
  matches `.nav-inner` at each breakpoint.
- **`renderNav()` runs first in `boot()`**, before the license gate. The gate runs as now,
  and a wall is still an overlay. Validation follows D6: a stored "checked at" plus a
  session mark, and an `AbortSignal.timeout(5000)` on `postLicense`. When the gate is due
  to ask, it asks in the background against the cached verdict.
- **The kennel name and the switcher draw with the nav** from a stored name and own-kennel
  count in `settings.js`. Kennel setup and a rename write them; `renderKennelBanner`
  corrects them when they differ.
- **A new device-only setting, `dataChangedAt`.** `markDataChanged()` and a sync apply write
  it, and it is never cleared. (`cloudDirtyAt` can't serve here because a push clears it.)
- **The website strip (D7):** stores its last result and signature. It draws from them in
  the first paint, and reruns the compare only when `dataChangedAt` is later than the last
  compare, after first paint (`requestIdleCallback`, falling back to `setTimeout`).
  `CHECK_DELAY_MS` goes away for page opens and stays as the debounce after a change.
- **Today:**
  - the nudges and reminders cards paint together, once both are ready, in the order they
    have now;
  - the cloud card's choice of what to show moves into a small module that reads only
    settings, so the card draws in the first paint; `cloudBackupUI.js` loads when a button
    on it is pressed;
  - `#today-website` uses the stored result above.
- **Service notices** draw from their session cache at boot. The first page of a session
  still waits for its check-in.
- **Tests:** the license session/6 h/timeout rules (`tests/licenseRevalidate.test.js`).
  `websiteBanner` draws from the stored result and skips the compare when nothing changed.
  `dataChangedAt` moves on every `markDataChanged`.
- **Check:** `loadCheck.mjs` shows no shift after first paint on the four pages, with Lemon
  Squeezy delayed.
- **Docs:** guide §0.3 (Pro license gate), §3 (the `app.js` shell boot), §35 (website
  strip); editions plan §Licensing (when the store is asked).
- **Modified:** as built,
  - a stored verdict that walls (with a record) still asks the store before walling, with the
    5 s timeout, so a renewal unlocks on the next load; only a verdict that lets her in is
    checked in the background;
  - Today paints **every** card in one frame, not only nudges and reminders, and "Loading…" is
    its own element, shown once the top cards are drawn and removed in that frame (otherwise the
    lower cards and the placeholder moved);
  - the website strip also compares on a new day (its bundle counts from today's date) and when
    `kennelportLinkStore` links, sends, hears from the site or unlinks (which drop the kept
    answer), and Send now loads the kennel by its kept id. The strip's box is a CSS class
    (`website-banner-strip`) so the shell and the module draw the same one;
  - the cloud card is `assets/todayCloudCard.js` (new, in `PRECACHE_URLS`); the one database
    answer it needs (unsaved recovery code) is kept in settings from the last look;
  - live sync writes `dataChangedAt` through `noteDataChanged()`, which doesn't mark the backup
    dirty;
  - checked before `loadCheck.mjs` existed, with a one-off Playwright run against
    `dist/pro` at 390 px with Lemon Squeezy delayed 3 s on an empty program (Phase 0's
    numbers, on a full one, are in BUILD_LOG). Before → after: the nav appears at
    ~3.45 s → 0.14–0.26 s; the 52 px drop of the whole page when the nav arrived is gone; Today's
    layout shift 0.29 → 0.0004 (the kennel name's first ever draw); Lemon Squeezy calls over 4
    pages in one session 4 → 0 after the session's first. Dogs (0.03) and Dog (0.006) keep
    small shifts of their own page content, the same as before; not in this phase.

### Phase 2 — The tour's sample data can't outlive the tour (D1–D5)
**Files:** `shared/data/demoMode.js`, `shared/data/repoBase.js`, `shared/data/fileRepo.js`,
`shared/data/sampleData.js`, `shared/data/settings.js`, `shared/data/kennelSetup.js`,
`shared/data/wizardState.js`, `shared/assets/wizardUI.js`, `shared/assets/sampleDataUI.js`,
`shared/assets/onboardingUI.js`, `shared/app.js`, `shared/pages/import-export.js`,
`shared/data/importExport.js`, `shared/data/editionTour.js`, `lite/editionTour.js`,
`shared/data/wizardSteps.js`, `shared/pages/kels.js` (where a task starts).
- **Read-only while the seed is loaded.** `assertWritable()` also throws while sample data
  is present, outside the existing `withSeedAllowed()` window. The error is a new
  `TourModeError` with its own message: "This is the tour's sample kennel. Changes aren't
  saved. Finish or skip the tour to start your own." Pages already show caught repo errors,
  as they do in Demo. Seeding and clearing run inside the window.
- **Writes that bypass the repos:** check every direct `db` write in the data layer (the
  list in `tests/cloudDirty.test.js`). Each one either calls `assertWritable()` or is
  device-only and exempt, with a reason. Migrations (`migrateEventCosts`,
  `migrateStudTrips`) skip while the seed is loaded.
- **Kels's guided tasks don't start during the tour.** They say why instead of failing
  halfway. A JSON import, a restore, or "I already use KennelOS" clears the seed first, then
  goes ahead.
- **Auto-clear at boot (D2).** It runs in `app.js` before anything renders, like the Demo
  seed. It clears when the seed is loaded and either the tour isn't `active` or this
  browsing session didn't seed it (a `sessionStorage` mark set by `seedSampleData`). Then it
  reloads once, with a session guard against loops. With writes blocked, a new seed can't
  be contaminated, so the clear always succeeds. If it throws, a strip says "Couldn't
  remove the tour's sample kennel" with Try again, and the next load tries again. It is
  never silent.
- **The banner's "Clear Sample Data" becomes "Leave the tour"** (`endTour()`), as does the
  Import/Export control. The tour's copy that mentions the yellow banner is rewritten, in
  the shared and Lite catalogs.
- **Retake (D3):** after the clear, the More-menu entry and Import/Export's Guided tour
  section link to the Demo edition (`editionLinks.js`).
- **Old seeds (D4):** `clearSampleData()` gets a detach mode for the case where real records
  point at sample ones. It deletes every sample record, moves sample-kennel links to the
  breeder's own kennel and clears the other links. It returns what it changed, for the
  one-time notice. `archiveConflicting` is removed.
- **Archived leftovers (D5):** a Tidy up rule in `tidyRules.js`, shown in `tidyUpUI.js`.
- **Never looked at again:** `hasSampleData()` moves into `settings.js` (one `localStorage`
  read). Phase 3 makes `sampleData.js`, the tour and first-run code load only when they're
  needed.
- **Demo is unchanged.** It seeds and stays read-only through `isDemo()`, and auto-clear
  never runs there.
- **Tests (`tests/tourMode.test.js`, new):**
  - repo and file writes throw while the seed is loaded, and pass in the seed window;
  - auto-clear on a non-active tour and on a new session;
  - detach on an old contaminated seed (kennel links move, others clear, the notice lists
    them);
  - Kels refuses to start a task;
  - a restore clears the seed first;
  - the Tidy up rule finds archived leftovers by name.
- **Docs:** guide §11 (Sample data, First run, Guided tour) and §0 (the read-only guard now
  serves the tour as well as Demo); editions plan §"The Demo edition".
- **Modified:** as built,
  - the "Clear Sample Data" control and the Guided tour section are on **Settings**, not
    Import/Export (this plan's file list was out of date): Settings has Restart the guided
    tour, Leave the tour, and, once there's no seed, the Demo link;
  - read-only needed more than the guard: about fifteen places skipped a write or an outside
    action with `isDemo()` (Furever's prefill saved on page load, e-sign, Stripe connect,
    Google Drive, Companion templates, the picks preview, the waitlist tidy, the portal feed).
    They check `isReadOnly()` (Demo or tour) and say why with `readOnlyWhy()`. Connecting a
    website or Stripe also calls `assertWritable()`, so the sample kennel can't reach her
    real website or Stripe;
  - D3 needed its own setting, `editionConfig.tourUrl` (all four copies): Pro's `demoUrl`
    would have turned on Lite's outbound edition links in Pro's nav. The final build nulls it;
  - D2's session mark is set by `onboardingUI` after either edition's seed (Lite seeds with its
    own function), and holds the manifest's `seededAt`;
  - D4 is a generic `data/recordDetach.js` over the reference registries
    (`REFERENCES_BY_TABLE`, `findReferencingRows`), not a mode of the old check. The old check
    never looked at contacts (a real sale's sample buyer was deleted out from under it) and
    queried unindexed `scan` fields (it would have thrown on them). An event or expense about a
    sample record keeps its details, about nothing. D4's wait for a kennel: while a seed is
    loaded the setup gate is off, so the cleanup opens the required kennel setup itself, with a
    line saying why, and lets its save through the guard;
  - D5 also takes archived litters and breedings whose parents are both leftover dogs (else
    they'd be left pointing at nothing);
  - the tour no longer offers the old "Clear sample data" dry run: `promptClearSampleData` is
    gone with `archiveConflicting`.

### Phase 3 — A lighter shell
**Files:** `shared/app.js`, `shared/assets/ui.js`, `shared/assets/kennelSetupUI.js`,
`shared/pages/today.js`, `shared/data/nudges.js`, and possibly a new
`shared/data/nudgeActions.js` (into `PRECACHE_URLS`).
- **`app.js` imports statically only what every page uses:** nav, db, settings,
  `editionConfig`, `cloudConfig`, the Kels button. These load dynamically, and only when a
  settings-only check says they're needed:
  - `sampleDataUI`, `wizardUI`, `editionTour`: seed present;
  - `onboardingUI`: never-visited state;
  - `kennelSetupUI`: the gate's condition;
  - `licenseGate`: `isLicenseGated()`;
  - the two migrations: their flags unset.
- **`ui.js` stops importing `dogRepo`.** The helper that needs it moves to its caller, which
  takes `pedigreeParse` off every page.
- **`seedImport` and `papaparse`** load inside the setup modal when it opens.
- **Nudges are split.** `computeNudges` keeps the rules. Each action's `run()` imports what
  it needs (`waitlistActions`, `recordMerge`, `paymentSchedule` and the rest) when pressed.
- **Targets**, written into `loadBudget.test.js`:
  - `app.js` ≤ 550 KB (from 893);
  - Today ≤ 1,000 KB (from 1,684);
  - Dog ≤ 800 KB (from 1,169).

  Waitlist entry and Kels are measured and follow the same pattern in a later pass.
- **Checks:** `tests/liteImportGraph.test.js` and `build/checkImports.mjs` on every edition.
  A first run, a tour and a gated Pro still work in Chromium.
- **Docs:** guide §3 (what the shell boot loads) and §19 (nudges and their actions).

### Phase 4 — Read each table once per page (D11)
**Files:** `shared/data/nudges.js`, `shared/pages/today.js` (its only caller today),
`shared/data/studServiceRepo.js`.
- **`computeNudges(snapshot)`.** Today passes in the dogs, litters, pairings, sales and
  contacts it already loaded. The nudge rules (`waitlistNudges`, `followUpNudges`,
  `paymentDueItems` and the rest) take the snapshot instead of their own `getAll()`. A
  caller with no snapshot gets one loaded once.
- **Events:** only the types the rules use, through the `event_type` index, instead of the
  whole table. Events are grouped per dog once, which replaces the filter per pup
  (`nudges.js:410`).
- **The website compare and the portal feed** read nothing on a page open when
  `dataChangedAt` hasn't moved (Phase 1).
- **`migrateStudTrips()`** checks a flag first. The old direction fix gets a flag of its
  own.
- **Tests:** a counting stand-in for the test database asserts that one Today load reads
  each table in full at most once. The nudge results are unchanged on the sample packet.
- **Docs:** guide §19.

### Phase 5 — Checks on page open, once (D6, D8)
**Files:** `shared/data/kennelportLink.js`, `shared/data/portalFeedSync.js`,
`shared/data/cloud/cloudWaitlist.js`, `shared/data/cloud/cloudIntegrations.js`,
`shared/assets/cloudAssistUI.js`, `shared/data/cloud/cloudAssist.js`,
`shared/app.js`, `shared/assets/cloudBackupUI.js`.
- **`licenseOk()` uses the stored verdict** instead of calling `evaluateLicense()` again.
- **The waitlist and integrations checks on page open** run at most once a minute, through
  a timestamp in settings. The polls and the run after a data change are unchanged.
- **Assist state** is cached in `sessionStorage` for 60 s, and the 5 s loop runs only in the
  states that auto-approve.
- **After first paint:** everything not needed for it starts in idle time. That's the
  device check-in, the Stripe check, the portal feed, the tidy-ups and the push refresh. The
  sync pull stays first, so the breeder sees fresh records.
- **Tests:** the throttles with a fake clock, in the existing `cloudWaitlist`,
  `cloudIntegrations` and assist suites.
- **Docs:** guide §30 and §34 (what runs at start-up), §35.1.

### Phase 6 — Build and service worker (D9, D10)
**Files:** `build/assemble.mjs`, `build/README.md`, `shared/sw.js`.
- **Minify `dist/` per Security S3**, once its decision is made.
- **`modulepreload`:** `assemble.mjs` writes `<link rel="modulepreload">` for each page's
  static graph into the built HTML. Every module is then asked for at once instead of in
  7 rounds. `shared/` HTML is untouched, and `checkImports.mjs` covers the links.
- **Heavy vendor files after the first page (D9).** `PRECACHE_URLS` splits into the shell
  (cached at install, as now) and extras (Tesseract, pdf.js, jsPDF, `gsi`). The extras are
  cached after `activate`, in the background.
- **Later, not planned here:** a per-file revision list, so that a cache bump fetches only
  the files that changed instead of all 15 MB.
- **Docs:** guide §12, `build/README.md`.

## 4. Order at a glance

| Phase | What the breeder notices | Size | Decisions it carries out |
|---|---|---|---|
| 0 (built) | Nothing | Small | — |
| 1 (built) | Buttons stop moving; the Pro nav is there at once | Medium | D6, D7 |
| 2 (built) | The tour can't leave Thornfield behind; old leftovers are cleaned up | Medium | D1–D5 |
| 3 | Every page starts faster, Today most | Medium | — |
| 4 | Today and data changes are quicker on big programs | Small | D11 |
| 5 | Fewer requests per tap; less battery and data | Small | D6, D8 |
| 6 | Faster first load after an update; less download | Small–medium | D9, D10 (S3's choices pending there) |

Phases 1 and 2 are independent and can go in either order. Phase 3's "never statically"
list for the sample and tour code needs Phase 2's `hasSampleData()` move.
