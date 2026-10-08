# KennelOS — End-State Design & Maintenance Guide

> ## ⚠️ REFERENCE ONLY in this repo — not the current-state map
>
> This guide describes the **pre-editions, single-app KennelOS**. In *this* repo that
> whole app has been relocated under **`shared/`** (and is being split into
> `shared/` + `pro/`). So this document is now **reference material for the shared/Pro
> code**, not the authoritative description of the repo as a whole.
>
> - **Authoritative current-state architecture** = the editions model: the top-level
>   `README.md` (layout + build status) plus `docs/KennelOS_Lite_Pro_Editions_Plan.md`
>   and `docs/KennelOS_Lite_Cap_Enforcement_Spec.md`.
> - **Path translation:** wherever this guide says `KennelOS/…` or a bare `data/…`,
>   `assets/…`, `pages/…`, `sw.js`, read it as **`shared/…`** (e.g. `shared/data/db.js`,
>   `shared/sw.js`). The single service worker described in §12 is now the *shared
>   default*; each edition will get its own `sw.js` + cache name.
> - **Still true and still load-bearing:** everything about the data model, the Dexie
>   schema, the repo layer, referential integrity, the Event model, escaping contracts,
>   and the change recipes — that all applies unchanged to the code now under `shared/`.
>   The `data/editionConfig.js` injection point (Lite/Pro cap hooks) and the
>   `data/editionTour.js` injection point (per-edition guided-tour package: sample seed +
>   step catalog — see §11) are the additions not yet folded into the sections below.
> - **Pro license gate** (`data/license.js` + `assets/licenseGate.js`) is a boot-time
>   addition too: in the Pro edition only (`editionConfig.editionFlags.licenseGate`),
>   `app.js`'s `boot()` calls `ensureLicensed()` before rendering — a Lemon Squeezy
>   key is browser-validated (activate/validate, no backend) with an interval-scaled
>   offline grace window (monthly/yearly subscriptions); a one-time **Lifetime** key is
>   perpetual — it never expires, but it is **no longer exempt from offline
>   re-validation**: 90 days of full access from the last successful `/validate`, then 30
>   days of a reconnect banner, then a wall, all reset by one successful validate. (The
>   old exemption let an activated lifetime key run forever on any number of machines
>   without contacting the store again.) A lifetime key blocked on staleness gets a
>   *reconnect* wall, never the renewal wall — `licenseGate.js`'s `isStaleLifetime`.
>   An unlicensed load is walled. The cached activation lives
>   under its own `settings.js` key (`kennelOS.proLicense`) that is deliberately **excluded
>   from `clearAllSettings()`**, so Reset App keeps paid entitlement. Inert in Lite/Demo.
> - **Activations are a countable, releasable resource.** Lemon Squeezy counts
>   *activations* ("instances") against the variant's activation limit — it knows nothing
>   about the machine, and neither do we. Three rules make that counter survivable:
>   `deactivate()` hands a slot back (`releaseThisDevice()` from Import/Export → *This
>   device's license*, which clears the local record **only** if the release succeeded;
>   `resetLicense()` on the renewal wall, which is best-effort so a walled owner is never
>   trapped); each activation is named `"<owner's label> · <8 chars of kennelOS.deviceId>"`
>   so slots are distinguishable in the store dashboard; and `recordFromPayload()` lets an
>   explicit `valid:false` downgrade an otherwise-`active` key to `inactive`, so a released
>   or de-authorized device actually stops working (a more specific `expired` is preserved,
>   because it earns its grace window). `kennelOS.deviceId` is a random per-browser UUID
>   used only for that label — no fingerprinting, no system data — and, like the license
>   record, it sits outside `KEYS` so Reset App leaves it alone.
>
> Treat everything under this line as an accurate map of the shared/Pro **code**, with
> the caveats above.

---

The single current-state reference for the KennelOS dog-breeding records app. It
describes what the app **is today** and how to change it safely: architecture, data
model, module map, invariants, and the common "how do I change X" recipes. Read it
first.

Where a field-level or rule-level detail matters, the **code is authoritative** — where a
doc and the code disagree, the code wins and the doc is what gets fixed.

---

## 1. What the app is

A **local-first, static, multi-page web app** for managing a dog-breeding program:
dogs and pedigrees, contacts, kennels, pairings and litters (including **foster-in /
foster-out** litters, §25), sales/placements, stud services, contracts, a polymorphic
health/history event log, an expense/income ledger, reminders, a dashboard, analytics
reports, CSV/JSON import-export, and a read-only Companion share-out for buyers and
partners.

- **No required backend, no build step.** Plain ES modules served over HTTP. Hosted on
  GitHub Pages; all data lives in the browser (IndexedDB via Dexie). The one server is the
  **opt-in** cloud backup API (§30); with it off, or in an edition with no server, the app
  runs exactly the same.
- **Single user, single device** is the design centre. Data moves between devices through
  explicit JSON backup/restore, CSV import/export, Dropbox (§26), or (opted in) a cloud
  backup restored on the new device (§30). There is no live sync.
- **Offline-capable PWA.** A service worker precaches the app shell so it works offline
  after the first load.

---

## 2. Architecture non-negotiables

These are load-bearing. Changing any of them is a design decision, not a routine edit.

1. **Multi-page static, no SPA router.** One `.html` per screen, each pulling in shared
   JS. Navigation is real links between pages.
2. **Strict layering: pages → repos → Dexie.** Pages never import `db.js` and never
   call `db.*`. Only the repo modules in `data/` touch Dexie.
3. **ES modules over HTTP.** Must be served (`python3 -m http.server`, `npx serve`, or
   GitHub Pages) — never opened as `file://`, which CORS-blocks module imports.
4. **No CDN / no network deps.** Everything third-party is vendored under
   `KennelOS/vendor/` and loaded by relative path (Dexie, PapaParse, lz-string). The
   app must work fully offline after first load. The one deliberate exception is the
   **Dropbox sync feature set** (§26): those buttons talk to the Dropbox HTTP API with
   plain `fetch` (still no vendored/CDN code) and are online-only by design — every
   other part of the app keeps working offline. **Cloud backup** (§30) is the second:
   opt-in, online-only, and only `data/cloud/cloudApi.js` makes its requests.
5. **One thin repo per entity**, uniform surface (see §6). New entity = new repo + new
   page; you don't reshape existing ones.

---

## 3. Directory layout

```
CLAUDE.md                      Session brief (read first)
docs/                          Design docs (this file is the end-state map)
KennelOS/
  index.html                   App root / landing
  companion-view.html          Recipient-facing Companion share shell (§20) — a
                               self-contained, read-only static file; NOT part of
                               the app's page/nav set, but IS precached
  assistant.html               KennelAssistant shell (§26) — the junior-helper
                               mini-app; standalone like companion-view (no
                               nav/app.js boot), but read-write and precached
  assistant.js                 KennelAssistant page logic (§26)
  app.js                       Shared shell bootstrap (nav, PWA, first-run flow)
  nav.js                       Top-nav definition + rendering
  sw.js                        Service worker (app-shell precache, offline)
  manifest.json                PWA manifest
  vendor/                      Vendored deps: dexie.min.mjs, papaparse.min.mjs,
                               lz-string.min.mjs, jspdf.umd.min.js (the self-
                               contained UMD build of jsPDF, Pro-only, loaded on
                               demand by assets/invoicePdf.js, §24), tesseract/
  resources/
    common_tests_by_breed_seed.csv   Optional breed→test seed data. Columns:
                               `Breed Group,breed,test_name` (col A is for the
                               picker's "browse by breed group" dropdown only —
                               never stored)
  data/                        THE DATA LAYER (repos + shared data logic)
    db.js                      Dexie schema — the only schema definition
    repoBase.js                makeRepo factory (shared repo surface)
    referenceRegistry.js       FK declarations + hard-delete guard
    syncRegistry.js            Cloud-backup field allow-list + row rules (Cloud Phase 1
                               plan §5); unlisted = private. Pure functions, plus the
                               field overlay the 'cloud-merge' restore uses
    cloud/                     Opt-in cloud backup (Cloud Phase 1 plan). Every module
                               checks cloudConfig.isCloudAvailable() first, so an
                               edition with cloudUrl null never makes a request.
      cloudConfig.js           The API base URL from editionConfig (cloudUrl; devCloudUrl
                               on localhost, or anywhere once ?cloud=staging has
                               turned on the test-server switch), or null
      cloudApi.js              The ONLY network module: fetch, bearer token, timeouts,
                               typed errors (Offline / Auth / Erased / Conflict / Request);
                               a 401 device_erased calls the registered erase handler
      cloudAuth.js             Email + 6-digit code sign-in; the session in settings.js
      cloudBackup.js           Snapshot builder (sample rows dropped, registry
                               projection, file bytes by sha256, key check), gzip, shrink
                               guard; pushIfDirty, the one-backup-device choices, restore,
                               and the scheduler (started by cloudBackupUI.bootCloud)
      cloudDevices.js          A lost device (Cloud plan §2.5): the check-in (started by
                               app.js before the license gate), the device list, remote
                               erase + this device's self-wipe, freeing a device's Pro
                               license with Lemon Squeezy (the key never goes to our server)
      cloudEntitlement.js      Is this cloud account Pro on the server? (License Link Plan):
                               the entitlement (cached), linking another purchase email by
                               code. Gates only server features (W2); the app stays gated
                               by license.js
      cloudWaitlist.js         The waitlist online (W2): publish each online kennel's
                               projection when it changes, unpublish one taken
                               offline; its scheduler (started by bootCloud)
      vaultCrypto.js           The private vault's WebCrypto (Private Vault Plan §3.2):
                               codes, the vault key, KEKs, wraps, payload/file ciphertext
      vaultKeyStore.js         This device's unlocked vault key, and its open request to be
                               unlocked by another device, in device_secrets (§30)
      vaultPasskey.js          WebAuthn + PRF for passkey unlock (no db, no network): the
                               RP ID, support check, make a passkey / get its PRF output
      cloudVault.js            Vault flows: turn on with a recovery code, unlock (with the
                               code, a passkey, or from another unlocked device), merge the
                               private tier in, add/remove passkeys, new recovery code, turn off
    dogRepo / contactRepo / kennelRepo / pairingRepo / litterRepo /
      saleRepo / contractRepo / studServiceRepo / eventRepo / expenseRepo /
      documentRepo   Entity repos
    fileRepo.js                The file archive: one row per stored PDF (blob +
                               thumbnail + meta) backing Documents + expense receipts (§26.1)
    pdfBuild.js                Photo(s) -> compressed multi-page PDF, no library
                               (JPEG via DCTDecode); the compress step for a
                               camera/screenshot upload (§26.1)
    ocr.js                     Offline receipt OCR (vendored Tesseract) — pre-fills
                               amount/date/vendor/receipt # on the expense form (§26.1)
    incomeView.js              Derived income aggregator (Sale + outgoing StudService)
    litterFinances.js          Derived per-litter P&L (income vs cost)
    dateUtils.js               todayYMD / date helpers (single "what is today")
    vocab.js                   Controlled vocabularies + event-type catalog
    csvImport.js               Generic CSV match-or-create engine + mappings
    importExport.js            JSON backup / restore
    companionExport.js         Companion allow-list bundle builder (§20)
    dropbox.js                 Dropbox API client — PKCE OAuth + JSON up/download (§26)
    assistantSync.js           Owner-side Dropbox flows: backup push/pull,
                               assistant feed builder, outbox import (§26)
    assistantStore.js          KennelAssistant's OWN Dexie db + its data layer (§26)
    appReset.js                Full "reset to first run" teardown; eraseThisDevice() for
                               a remote erase (also the license, cloud keys, Assistant db)
    sampleData.js              "Thornfield Kennels" demo seed + generic clear (§11)
    seedImport.js              Optional breed+test vocabulary seed
    kennelSetup.js             First-run "your kennel/owner" wizard logic (a mandatory gate)
    kennelScope.js             Active-kennel scope: which own kennel the app is
                               narrowed to, the inScope()/dogInScope()/subjectInScope()
                               read predicates bound to it, and the
                               resolveKennelIdForWrite() stamp every scoped create uses
    scopePredicates.js         The PURE, db-free half of that scope — the record-shape
                               rules, taking the active id as an argument so they are
                               unit-testable in Node (tests/scopePredicates.test.js).
                               kennelScope.js re-exports them bound; pages import those
    showPoints.js              Derived championship-points engine (Show Tracking Spec §4):
                               a db-free pure core (trackProgress / showRecordFrom,
                               tests/showPoints.test.js) + the getShowRecord(dogId)
                               loader. Pro-used, shared-resident; callers gate on
                               editionFlags.shows (§8 "Show specifics")
    waitlistEntryRepo / waitlistOfferRepo /
      waitlistProgramRepo      The per-kennel waitlist's repos (§29)
    waitlistRules.js           The PURE waitlist rules engine — position, eligibility,
                               passes, removal/undo, contact matching, contact
                               status (§29; tests/waitlistRules.test.js)
    waitlistActions.js         The waitlist's multi-step writes — approve, decline,
                               fee received, withdraw, remove, undo, re-apply, move,
                               and the offer flow: open/close picks, offer next,
                               offer one family a litter, record an outcome (accept
                               creates the Sale) (§29)
    waitlistForm.js            PURE: her application form — default + locked
                               questions, answer snapshots, CSV question import
                               (§29; tests/waitlistForm.test.js)
    waitlistCrypto.js          Her form key: make, rotate, open an application sealed in the
                               applicant's browser (W2; tests/waitlistCrypto.test.js)
    waitlistInbox.js           PURE: an opened online application → an `applied` entry,
                               validated field by field (W2; tests/waitlistInbox.test.js)
    waitlistEvents.js          PURE: a family's action on their status page → what her
                               device does (pick, pass, leave, a request, or a line for
                               her) (W2 step 5; tests/waitlistEvents.test.js)
    waitlistProjection.js      PURE: one kennel's waitlist as published online (W2) —
                               allow-listed field by field from the rules engine
                               (§29; tests/waitlistProjection.test.js)
    saleDefaults.js            expectedPricing(dog, litter) — a new Sale's price/deposit
                               prefill, shared by sale.js and the waitlist accept flow
    wizardState.js             Guided-tour status/index state machine (§11)
    wizardSteps.js             Full (Pro/Demo) guided-tour step catalog — data only (§11)
    editionTour.js             Per-edition tour package (seed + steps) injection point;
                               shared copy re-exports the full seed + catalog (§11)
    settings.js                localStorage-backed UI prefs / identity keys
    nudgeState.js              Device-local dismissal ledger for derived nudges
    nudges.js                  Derived-nudge engine — computeNudges() (§19)
    awayBoard.js               "Away from home" union: boarding events + in-person
                               stud services, one view-model (§19)
  assets/                      Shared UI helpers + reusable components
    app.css                    All styles
    ui.js                      esc(), badge(), fmtDate(), param(), fillSelect()…
    listView.js                Reusable list screen (cells return HTML)
    reportView.js              Reusable report screen (values return text)
    timeline.js                Subject health/history timeline
    pedigree.js                Ancestor-tree + offspring renderer
    eventForm.js               Add/edit event modal
    puppyForm.js               Litter → puppy roster entry
    contactPicker.js           Inline "＋ New contact" decorator for pickers
    breedTestPicker.js         Search/browse-by-breed-group picker widget shared
                               by both seed-import wizards (kennel-tests-import
                               page + kennelSetupUI's prefill section)
    importView.js              Shared CSV import dry-run/commit UI
    onboardingUI.js            First-run Welcome → tour-offer → backups/install cards (§11)
    cloudBackupUI.js           Every cloud-backup screen: sign-in, the Import/Export card,
                               the Today nudge, the 409/shrink dialogs, restore as of…,
                               first-run restore, the post-setup offer, notices, and
                               "Your devices" (erase / free a Pro license) (§11), and the
                               record pages' "private details are blank here" hint.
                               Loaded only when the edition has a cloud server
    cloudVaultUI.js            The private vault's screens (§30): turn on + recovery code
                               (+ the passkey offer), unlock (passkey / code / another
                               device / not now), approve another device, passkeys, new
                               recovery code, turn off. Loaded by
                               cloudBackupUI.js only, on first use
    sampleDataUI.js            Sample-data banner + Clear-sample-data flow
    kennelSetupUI.js           Kennel-setup prompt/wizard + seed prefill
    wizardUI.js                Guided-tour overlay/spotlight/cards + resume pill (§11)
    expensePanel.js            Reusable per-subject expense ledger panel (§21)
    waitlistUI.js              Waitlist pages' helpers: which kennel's list, kennel
                               picker, preference summary, form dialog (§29; Pro-only,
                               PRO_ONLY_STANDALONE)
    waitlistPicksPanel.js      The Litter page's "Waitlist picks" panel (§29; Pro-only,
                               PRO_ONLY_STANDALONE, imported dynamically by litter.js
                               only when editionFlags.waitlist is on)
    waitlistOnlineUI.js        The Kennel page's "Online list" card (§29; Pro-only,
                               PRO_ONLY_STANDALONE, imported dynamically by kennel.js
                               only where the waitlist online is offered)
    invoiceDoc.js              The invoice/receipt DOCUMENT MODEL — what a document
                               says, for sale/stud/waitlist-fee sources (§24; Pro-only,
                               PRO_ONLY_STANDALONE)
    invoicePdf.js              Draws that model as a real PDF with vendored jsPDF
                               (§24; Pro-only, PRO_ONLY_STANDALONE;
                               tests/invoicePdf.test.js)
    invoiceGenerator.js        The Invoice / Receipt generator modal, opened from
                               Financials and preselected from a Sale's page (§24;
                               Pro-only, PRO_ONLY_STANDALONE; both import it
                               dynamically only when editionFlags.invoicing is on)
    receiptCapture.js          Shared "attach a receipt" widget for both expense
                               forms — photo/screenshot (OCR + compress) or PDF (§26.1)
    dropboxConnectUI.js        The one Dropbox connect/disconnect control + the
                               OAuth-completion boilerplate, mounted by every page
                               that needs the connection (§26)
  pages/                       One .js + .html per screen (see §13 catalog)
```

---

## 4. Data model

### 4.1 Entities and their required fields

Every record also carries `id` (UUID), `is_archived` (bool), `created_at`,
`updated_at`. Dates are `YYYY-MM-DD` strings except `created_at`/`updated_at` (full
ISO). Required = enforced in the repo's validator; everything else is optional and
commonly blank at entry time.

| Entity | Required | Notable other fields |
|---|---|---|
| **Dog** | `call_name`, `sex`, `breed`, `ownership_type`, `status`, plus `kennel_id` **when `ownership_type` is `owned`/`co_owned`** (the kennel scope — must be one of your own kennels; optional and free to name an outside kennel for `external`/`leased_in`) | `registered_name`, `date_of_birth`, `date_of_death`, `sire_id`, `dam_id`, `litter_id`, `breeder_kennel_id` (the kennel that *produced* this dog — own or an outside contact's; distinct from `kennel_id`, the kennel it belongs to *now* — the user's own for a dog they own, or an outside kennel for an external/leased dog (the form's Kennel picker offers every kennel, not just own ones); auto-prefilled from the litter's dam's own `kennel_id` when that dam is owned/co-owned), `owner_contact_id`, `co_owner_contact_ids[]`, `kennel_id`, `color_markings`, `registry`, `registration_number`, `microchip_id`, `url` (plain, unindexed — a link for this dog, e.g. a registry page or listing), `planned_tests[]`, `recorded_coi{value,method,source,as_of_date}`, `disposition` (`undecided`/`keeping`/`available`/`placed` — breeder intent; **puppy-only**, valid only while `status='puppy'` and forced null otherwise. Enforced in `dogRepo` create/update and mirrored in the UI: the dog form shows it only for a puppy, `sale.js` won't set one on a non-puppy, the profile hides the row otherwise. Feeds the Today "Active litters" card, the promote-lifecycle nudge, and the litter-lifecycle nudges, §19), `intended_placement` (plain, unindexed — nullable `PLACEMENT_TYPE` value: the placement this pup is meant for, which the waitlist matches a family's `pref_placement_type` against; unset = any placement. Read by `waitlistRules.pupMatchesPrefs`, §29. The Dog form shows it for a puppy only when `editionFlags.waitlist` is on, and only writes it when that field rendered, so a Lite edit or a status change never clears it), `notes`. Owner required when `ownership_type ∈ {external, leased_in}`. |
| **Contact** | `name` | `contact_type[]` (multi), `email`, `phone`, `address`, `kennel_id`, `waitlist_status`, `first_contact_source`, `notes`, `companion_note` (plain, unindexed — a per-recipient message **meant for the recipient's eyes**, shown on their companion share page; deliberately distinct from the private `notes`; §20). Buyers are Contacts — **there is no Buyer table**. `address` also resolves an in-person stud service's away-board location (§19). |
| **Kennel** | `kennel_name` | `public_id` (**indexed** — the kennel's portable PUBLIC IDENTITY, `kos1_<uuid>`; minted once for an **own** kennel and immutable thereafter, so the same real-world kennel keeps one identifier across a backup/restore, the Lite→Pro bridge, a Dropbox sync, and every kennel card it issues. An **outside** kennel never has one minted locally — it can only ever be *received* from a card its owner issued, so a blank value there means “I typed this kennel in myself”, not missing data. Not a foreign key: nothing points at it, so it carries **no** `referenceRegistry` entry. See §28), `is_own_kennel`, `prefix`, `location`, `website` (plain, unindexed — a link for this kennel, mirrors `Dog.url`), `waitlist_form_keys` (plain, unindexed — her application form's key pairs `[{ id, public_key, private_key, created_at, retired_at }]`, W2 step 4, §29; **private tier**: the private halves open every online application, so they ride the private vault and file backups only), `time_zone` (plain, unindexed — IANA name, e.g. `America/Chicago`; set on the Kennel page's **Online list** card, defaulting to the device's zone; the waitlist online's offer deadlines end at 11:59 pm there, Waitlist Spec §6.5; cloud tier), `logo_data_url` (plain, unindexed — a downscaled PNG/SVG **data URL** for the kennel's logo, uploaded/removed on the kennel detail page, rendered on its invoices/receipts (§24) and puppy records (§23); rides the JSON backup), `preferred_tests[]`, `preferred_breeds[]`, `preferred_test_breeds` (plain, unindexed — `{ [testKey]: breed[] }`; which breed(s) tagged each preferred test via the breed-seed import, keyed lowercase-trimmed; a test added by typing directly into the kennel's own "Add a test" field has no entry and stays breed-agnostic. Never edited directly — written by `kennelRepo.addPreferredTest`'s third arg, read via `testBreedsFor`/`testsForBreed`), `promote_nudge_enabled` (bool, default off), `promote_age_male_months`/`promote_age_female_months` (the promote-lifecycle nudge's per-kennel thresholds, §19), `waitlist_config` (plain, unindexed object — this kennel's waitlist settings: fee, credit policy, fee window, payment instructions, max passes, response days (`respond_days` — the days to accept AND pay the deposit), whether no response counts as a pass, color matching, `auto_offer_on` (which closings offer the next family by themselves: `accepted` / `passed` / `no_response` / `no_deposit` / `left`, from `vocab.WAITLIST_AUTO_OFFER_TRIGGER`; `no_deposit` is a no response on an offer whose family had picked a pup, per `waitlistRules.closingTrigger`; default **none**; replaced the boolean `auto_offer_next` 2026-10-08, and a stored `auto_offer_next: true` still reads as all five via `waitlistConfig`), check-in months, `online` (bool, default off — her list is published online, W2, §29; only acted on where the waitlist online is offered), `online_form` (bool, default off — she takes applications through the online form, W2 step 4), `pass_reasons` (`[{ id, label, message }]` — her reasons for a family's pass and the message each shows them, Waitlist Spec §16.5; null = `waitlistRules.DEFAULT_PASS_REASONS`; read through `passReasons`) and `pass_other` (bool, default on — also offer "Other" with a text box), `online_since` (the day the list last went online, set by the Online list card or backfilled by the sync; "Ready now?" covers holds ending from then), `ready_no_answer` (`keep_paused` default / `unpause` / `remove_after`, `vocab.WAITLIST_READY_NO_ANSWER`) and `ready_answer_days` (14), `show_upcoming` (`{ planned_pairings, pairings, early_litters }`, each `{ public, family }`, all false by default — what shows online before picks open, Waitlist Spec §16.4; read through `waitlistRules.showUpcoming`), `soon_notice_text` (her "It's almost your turn" wording; blank = `waitlistRules.SOON_NOTICE_DEFAULT`, §29), `form_questions[]`, her application form (§29; read through `waitlistForm.formQuestions`, which supplies the defaults and restores the locked questions), and `application_faq[]` (`{ id, question, answer }`, her FAQ shown at the top of the application; read through `waitlistForm.formFaq`). Kept on the kennel, not in `settings.js`, so it rides the JSON backup/Dropbox sync; missing keys fall back to `waitlistRules.WAITLIST_CONFIG_DEFAULTS`; edited on the Kennel page's **Waitlist settings** card, §29). Lightweight; added inline from the Contact form. |
| **Pairing** | `sire_id`, `dam_id`, `pairing_type`, `status`, `kennel_id` | `method`, `planned_date` (shown as "Planned first date" — the first planned/tie date), `last_observed_date` (plain, unindexed — a subsequent observed tie/breeding date), `expected_due_date` (prefilled on the detail page as 63 days after `planned_date` when still empty, never clobbering a deliberate edit), `notes`. Sire ≠ dam (hard block). |
| **Litter** | `dam_id`, `sire_id`, `status`, `kennel_id` | `nickname` (plain, unindexed — optional friendly label, e.g. "Party of Five"; when set it leads the detail-page title and shows as its own column on the Litters list and report, searchable across all three; falls back to `dam × sire` when blank), `pairing_id`, `whelp_date`, `accept_deposits_date` (plain, unindexed — when the breeder begins accepting deposits; on the detail page it sits between `whelp_date` and `estimated_ready_date`, and surfaces in the **prospective** companion bundle between "Born" and "Estimated ready" when set, §20), `estimated_ready_date` (plain, unindexed — prefilled as 8 weeks/56 days after `whelp_date` when still empty, never clobbering a deliberate edit), `litter_registration_number`, `picks_opened_date` (plain, unindexed — nullable `YYYY-MM-DD` set by the waitlist's **Open picks**; while set and pups remain, the next eligible family is offered as each offer closes — only for the closings ticked in the kennel's `waitlist_config.auto_offer_on`, §29), `puppies_born_total/alive/deceased/abnormalities` (the last a count, not mutually exclusive with alive/deceased), `expected_price_male`/`expected_price_female`/`expected_deposit_male`/`expected_deposit_female` (plain, unindexed — per-litter defaults, grouped by sex on the detail page; `sale.js` prefills a new Sale's `price` and `deposit_amount` from the matching-sex pair by the puppy's `sex`, only into fields still empty; the rule lives in `data/saleDefaults.js` `expectedPricing`, shared with the waitlist's accept flow, §29), `foster_direction` (plain, unindexed — nullable `foster_in`/`foster_out`; null = an ordinary litter. **Foster is a per-litter fact** (guide §25): the same dam can have foster and non-foster litters, so it can't live on the Dog. A foster puppy is distinguished from a plain "external" dog purely by DERIVATION of its litter's `foster_direction` — it stays a normal `status='puppy'` Dog we manage and sell), `foster_partner_contact_id` (**indexed FK → Contact**; the counterparty — the dam's owner for foster-in, the caretaker for foster-out — guarded in `CONTACT_REFERENCES`; its `kennel_id` is the owner/caretaker kennel a companion share can reveal), `foster_comp_model` (plain, unindexed — `income_split`/`flat_per_pup`; how the partner is paid), `foster_our_share_pct`/`foster_split_basis` (the income-split terms), `foster_flat_fee_per_pup` (the per-pup flat fee), `foster_split_notes` (all plain, unindexed — documentation of the terms for either model; the actual payout to the other party is a real `foster_split` ("Foster compensation") Expense, never a stored derived number), `notes`. The litter's own sire/dam are authoritative. Puppy roster is **derived** (`Dog WHERE litter_id`). |
| **Sale** | `dog_id`, `buyer_contact_id`, `placement_type`, `status`, `kennel_id` | `sale_date`, `price`, `deposit_amount`, `deposit_date`, `balance_due_date`, `balance_paid_date`, `transport_fee` (plain, unindexed — a flat delivery/transport charge, decimal), `deferred_boarding_amount`/`deferred_boarding_frequency`/`deferred_boarding_duration_days` (plain, unindexed — a boarding rate for a buyer who delayed pickup: decimal amount + `BOARDING_FREQUENCY_OPTIONS` Day/Week/Month + a free-text **count of frequency units** (despite the `_days` name, the value is the number of units — `2` with frequency `Week` means two weeks), rendered as "amount per frequency × count"; the family companion bundle multiplies `amount × count` into a deferred-pickup total feeding the computed remaining balance (§20); never cents, never an Expense — see §21), `lead_source`, `referred_by_contact_id` (indexed FK → the Contact who referred this buyer; `CONTACT_REFERENCES`; on save `saleRepo` auto-tags that contact `buyer_referrer` via `contactRepo.ensureType`), `payment_method`/`payment_reference`/`invoice_number`/`invoice_notes` (plain, unindexed — invoice/receipt document fields set from the Financials generator modal; §24), `notes`. On the detail page (`sale.js`) all fee fields render/edit above all date fields. Its own table (not a Dog field) so reserve/return/re-place stay distinct facts. |
| **Contract** | `contract_type`, `kennel_id` | `status` (defaults `draft`), `related_sale_id`, `related_stud_service_id`, `related_dog_id` (canonical Dog link, used only for `lease`/`co_own`/`foster`/`other` types — where no linked Sale/StudService reaches a dog; forced `null` for other types via `contractRepo.DOG_LINK_TYPES`/`normalizeLinks`), `related_contact_id` (canonical counterparty link — lessee/co-owner/partner/foster owner — for the same `lease`/`co_own`/`foster`/`other` types via `CONTACT_LINK_TYPES`; sale/stud contracts reach their counterparty through the linked Sale/StudService, so it stays `null` there; scopes a contract into the **partner** companion bundle, §20), `document_url` (plain, unindexed — a share link to the signed document, e.g. a Drive "anyone with the link" URL; carried as a *pointer* into the buyer bundle, §20), `signed_date`, `lease_start_date`/`lease_end_date` (lease type; UI shows them and hides Related sale/stud fields when `contract_type='lease'`), `title`, `terms_summary`, `notes`. Generic across sale/stud/co-ownership/lease. Leaf for its own hard-delete (nothing points *at* a contract), but it points *at* its Dog via `related_dog_id` (guarded under `DOG_REFERENCES`) and its counterparty via `related_contact_id` (guarded under `CONTACT_REFERENCES`). |
| **StudService** | `direction`, `our_dog_id`, `partner_dog_id`, `partner_contact_id`, `status`, `kennel_id` | `pairing_id`, `fee_amount`, `fee_structure`, `pick_status` (plain, unindexed — suggested `pending`/`claimed`, free text allowed; meaningful **only** when `fee_structure ∈ {pick_of_litter, flat_plus_pick}`, forced `null` otherwise; feeds the partner companion bundle's compensation, §20), `pick_value_amount` (plain, unindexed decimal — the breeder's own estimated dollar value of the pick puppy, for income tracking; gated the same way as `pick_status`; deliberately **separate** from `fee_amount` (the actual cash); internal only — never in the partner bundle), `result_notes`, `type` (`in_person`/`ai` — coarse physical-travel flag; `in_person` + `sent_date`/`returned_date` window feeds the away-board, §19), `referred_by_contact_id` (indexed FK → the referring Contact; `CONTACT_REFERENCES`; on save `studServiceRepo` auto-tags `stud_referrer` via `contactRepo.ensureType`), `payment_method`/`payment_reference`/`invoice_number`/`invoice_notes` (plain, unindexed — invoice/receipt document fields, mirroring Sale's; only the outgoing direction is invoiceable, since incoming stud is an expense; §24), plus optional logistics dates. Covers both `incoming` and `outgoing`. |
| **Event** | `subject_type`, `subject_id`, `event_type`, `event_date`, `title` | `event_end_date`, `reminder_date`, `reminder_dismissed`, `related_dog_id`, `related_contact_id`, `details{}`, `notes`. See §8. **No `cost` field** — a cost entered on the event form is written to the Expense ledger (`expenses.event_id` = the event) and read back via `expenseRepo.getByEvent`; see the Expense row and §21. |
| **Expense** | `subject_type` (`dog`/`litter`/`pairing`/`kennel`), `subject_id`, `amount`, `category`, `expense_date` | `event_id` (nullable FK → the Event a cost was captured from — the one canonical event↔cost link; reverse is `expenseRepo.getByEvent`), `miles`/`mileage_rate` (plain, unindexed — a **mileage** expense: when `miles` is set, `amount` is **derived** = `miles × mileage_rate` in `expenseRepo.normalize`, never entered directly; both null on a flat expense. Default rate prefilled from `settings.getMileageDefaults()`; §21), `vendor`, `receipt_number` (plain, unindexed — a human-facing receipt/reference number printed on the receipt, not an id of anything in KennelOS; auto-filled by OCR off a scanned receipt when found (§26.1) and editable, shown/edited on both expense forms and the Financials ledger, searchable there, and the idempotent key on CSV re-import when present, §9), `receipt_file_id` (plain, unindexed FK → the `files` row holding the attached receipt — a photo/screenshot compressed to PDF, or an uploaded PDF, attached via the receipt-capture widget; deleted with the expense in `expenseRepo.hardDelete`; §26.1), `reimbursable`/`reimbursed_date` (plain, unindexed — a cost owed back to you, e.g. a foster-in rearing cost the dam's owner reimburses; `reimbursed_date` records when it was settled, and a set date coerces `reimbursable=true`. Litter P&L nets a reimbursed reimbursable out of your cost and lists a pending one as a receivable — §21/§25. "Reimbursable to whom" is derived from the litter's foster partner, so no per-expense contact FK), `notes`. The Financials ledger: the single home for money spent. Polymorphic like Event; `kennel`-subject rows are kennel-wide overhead. Leaf entity (`EXPENSE_REFERENCES` empty). See §21. |
| **Document** | `dog_id`, `doc_type` (`pedigree`/`health_test`/`registration`/`contract`/`other`), `file_id` | `title`, `doc_date`, `issuer_or_lab`, `result`, `registry`, `registration_number`, `notes`. A filed document belonging to exactly one Dog (`dog_id`, guarded in `DOG_REFERENCES`) and pointing at exactly one stored `files` row (`file_id`) — the reverse "a dog's documents" is `documentRepo.getByDog`. Which optional fields show on the form is keyed by `doc_type` (`vocab.documentFieldsFor`). Leaf entity (`DOCUMENT_REFERENCES` empty); `hardDelete` also removes the linked file. See §26.1. |
| **File** (`files`) | `blob`, `mime`, `filename`, `size`, `created_at` | `thumbnail` (a small JPEG data-URL for photo-sourced files; blank for uploaded PDFs, which show a doc-type icon). The blob archive behind **both** Documents (`documents.file_id`) and expense receipts (`expenses.receipt_file_id`) — every file is a PDF (photos are compressed to PDF by `pdfBuild.js` before storage). Fetched by id only; not an orphan-guarded entity — a file is owned by its one Document/Expense and deleted with it. `blob` is base64-round-tripped through backups (§5). See §26.1. |
| **WaitlistEntry** (`waitlist_entries`) | `kennel_id` (own kennel), `status` (`WAITLIST_ENTRY_STATUS`), `listen_mode`, `pref_sex`; `contact_id` once `approved`/`active`/`placed`/`removed`; `application.name` when there's no contact yet; `placed_sale_id` when `placed` | `waitlist_program_id` (FK → WaitlistProgram), `applied_date`/`approved_date`/`declined_date`, `fee_amount`, `fee_due_date`, `fee_received_date` (the **position anchor**), `fee_received_at` (plain, unindexed — full ISO timestamp of when she recorded the fee (or the fee-waived approval); orders two families whose fee date is the same day, so they stay in the order they PAID, never the order they applied; absent on imported/older entries, which then sort first among their same-day peers), `fee_payment_method`/`fee_payment_reference`, `fee_credit_policy`, `position_anchor_date` (her manual override; replaces the fee date for ordering only), `pref_breed` (one of the kennel's breeds — picked from a dropdown of `waitlistRules.kennelBreeds` (the breeds of that kennel's non-archived dogs + its `preferred_breeds`), never typed; CSV import resolves it case-insensitively to the kennel's spelling and flags an unknown one, leaving it blank; a stored value outside the list shows an **Unknown breed** badge on the Waitlist list and family page; blank = any)/`pref_placement_type`/`pref_colors[]`, `ready_timing` (plain, unindexed — `WAITLIST_READY_TIMING`: `asap` / `1_month` / `3_months` / `6_plus_months`, the answer to her locked, required "soonest you can commit" question; anything but `asap` puts a DERIVED **readiness hold** on the entry (`waitlistRules.readyFromDate`): no offers until `hold_months` (1 / 3 / 6) after `fee_received_date`, or `approved_date` with no fee — treated exactly like a pause, including leaving them off the public list; blank on older entries = no hold), `listen_sire_ids[]`/`listen_dam_ids[]` (multi-entry FKs → Dog, used when `listen_mode='selected'`: the family is offered only litters whose `sire_id` is a picked sire OR whose `dam_id` is a picked dam; or `listen_mode='except'` (Waitlist Spec §16.3): every litter except those — an empty except list skips nothing — the litters/pairings covered are derived, never stored; picked on the Edit form only once the entry is `active` — on the list, fee received or waived; any number of each, Waitlist Spec §15.7), `paused_until`, `pause_reason`, `removed_date`/`removed_reason` (`WAITLIST_REMOVED_REASON`, which gained `no_ready_answer`: removed by her device for no answer to "Ready now?", with the same 7-day undo as `second_pass`), `withdrawn_date`, `soon_notified_date` + `soon_notified_litter_ids[]` (plain, unindexed — when she last sent this family the "It's almost your turn" notice and which litters it was about, stamped by `waitlistActions.markSoonNotified`; a record only, never used to skip a family; §29), `pref_change_log[]` (plain, unindexed — `{ date, field, from, to, by }`, one line per change to `pref_sex`/`pref_breed`/`pref_placement_type`/`pref_colors`/`ready_timing` (`waitlistRules.PREF_CHANGE_FIELDS`) once the entry is past `applied`; appended by `waitlistEntryRepo.update` from `prefChangeLines`, so her edits and CSV updates are both logged; `by` is `breeder`, or `request` for a family's status-page request she decided (W2 step 5; a declined one is logged too, with `declined: true`); shown newest first as **Answer changes** on the family page so changing an answer and back is visible, Waitlist Spec §15.9), `application{}` (the application answers, keyed by her form's question ids: `name` and `email` are locked; the default questions keep the W1 keys `phone`, `location`, `heard_from`, `household`, `other_pets`, `experience`, `about`; her own questions use `q_…` ids; a checkboxes answer is an array; an older answer under the retired `timing` key still shows), `application_questions[]` (plain snapshot `{ id, label, type, options? }` of the wording the answers were given under, so editing the form never scrambles an old application; absent on W1 entries, which show the current form), `source` (plain, unindexed — `'online_form'` when the application came through her online form, W2 step 4; absent otherwise), `status_token` (plain, unindexed — the family's status-page link token, 64 hex; minted when the kennel's list goes online, replaced by **New link**; cloud tier, since the waitlist server holds it anyway; §29 Online), `pref_change_request` / `pause_request` / `listen_change_request` (plain, unindexed, **private tier** — what the family asked for on their status page, W2 step 5: `{ requested_date, changes, note }` / `{ requested_date, until, note }` / `{ requested_date, listen_mode, listen_sire_ids, listen_dam_ids }`; one per kind, a new one replaces it; nothing changes until she taps Approve or Decline (`waitlistActions.approve…` / `decline…`), which keep the request marked `decided: 'approved' | 'declined'` + `decided_date` so the family's page can show the outcome for 30 days), `companion_request` (plain, unindexed, **private tier** — a family's request for their Companion link from their status page, Waitlist Spec §16.10: `{ requested_date, note }`, only accepted while their contact has an open sale (`isOpenSale`); a new one replaces it; she sends the link from the Companion page and taps **Mark sent** or **Decline** (`waitlistActions.markCompanionLinkSent` / `declineCompanionRequest`), which mark it `decided: 'sent' | 'declined'` + `decided_date`; the projection publishes `entries[id].companion = { available, request }` for a family with an open sale, never the note), `prepasses[]` (plain, unindexed, **private tier** — "Not this litter", Waitlist Spec §16.2: `{ litter_id | pairing_id, reason: { id, label, text }, date }`, one per litter; nothing counts until their turn comes, when the litter is left out of it (recorded as a passed, uncounted row of the turn) and the prepass is used up; a turn made only of such litters is passed at once, counting once (`waitlistActions.autoPassTurn`); the projection publishes the ids and dates, never the reason), `ready_check` (plain, unindexed, **private tier** — "Ready now?", Waitlist Spec §16.7: `{ answer: 'yes' | 'no', answered_date, until, reason, by: 'family' | 'breeder' }`, or `{ ask_from }` after she undoes a removal for no answer; written by `waitlistActions.recordReadyAnswer`, whose No also makes a `pause_request`), `messages[]` (plain, unindexed, **private tier** — the family's messages (sealed on their status page, opened on her device) and their status-page activity, `{ id, at, from: 'family', kind: 'message' | 'action', body, read }`, oldest first, the newest 500 kept; unread ones are a Today nudge; W2 step 5. Kept on the entry, not in W2 Plan §8's separate `waitlist_messages` table, so no schema change), `notes`. One row per family **per time on a kennel's list**. Position and passes are **derived**, never stored. See §29. |
| **WaitlistOffer** (`waitlist_offers`) | `entry_id`, `litter_id`, `kennel_id` (all the same kennel), `offered_date`, `outcome` (`WAITLIST_OFFER_OUTCOME`); `chosen_dog_id` when `accepted`, or on an `open` offer whose family has **picked** a pup and is sending the deposit (forced null on passed/no_response/voided) | `respond_by_date` (the deadline to pick AND pay the deposit), `eligible_dog_ids[]` (plain snapshot), `picked_date` (plain — when they picked; cleared with the pick), `sale_id` (**indexed FK → Sale** — the deposit-pending Sale created at the pick to hold the pup; kept after the offer closes, so a lapsed pick still records its cancelled Sale; guarded in `SALE_REFERENCES`), `outcome_date`, `counts_as_pass` (set once when the outcome is recorded; only the second-pass undo and **undoPass** later clear it; a turn passed in full sets it on one row only), `pass_reason` (plain, unindexed, **private tier** — `{ id, label, text }`, the family's own reason for a pass made on their status page, from her list, Waitlist Spec §16.5; none on a pass she records or a no response), `turn_id` (plain, unindexed — the turn this row belongs to, shared by every litter of one family's turn, Waitlist Spec §16.1; absent on offers made before turns, which are each their own turn; cloud tier), `notes`. Leaf for hard delete. See §29. |
| **WaitlistProgram** (`waitlist_programs`) | `kennel_id` (own kennel), `name`, `priority` (`standard`/`ahead`) | `public_description`, `fee_override` (null = normal fee, 0 = waived), `pause_allowed`, `passes_count` (default true), `respond_days_override`, `notes`. **Only she assigns a program** — families never pick one, so programs are never on the application form (decided 2026-10-06; the old `applicable_on_form` flag was dropped before anything shipped). See §29. |

**Kennel scope.** `Pairing`/`Litter`/`Sale`/`Contract`/`StudService`/`Document` each
carry a required `kennel_id` naming which of the user's **own** kennels the record
belongs to, and `Dog.kennel_id` is required for dogs the user owns. It is stamped on
create by inheriting from the record's parent, never derived at read time. Full rules
in `docs/KennelOS_Multi_Kennel_Scope_Spec.md`; the scope itself is resolved through
`data/kennelScope.js` and is Pro-only (`editionFlags.multiKennel`).

On the READ side every list, hub, and report filters by that stamp. What is
deliberately **not** filtered is as load-bearing as what is, and each exception
carries a comment at its call site: **pedigree/lineage** (`assets/pedigree.js`,
`pages/pedigree.js`, `dogRepo`'s ancestor/offspring walks — ancestry crosses kennels
by definition), **detail pages reached by id** (a direct link must always resolve;
an out-of-scope record renders in full above a "belongs to <kennel>" banner),
**external/leased dogs** (scope-transparent: their `kennel_id` names somebody
*else's* kennel), and the **contact pool** (program-wide; `Contact.kennel_id` is an
affiliation, not a scope). `Event` and `Expense` carry no `kennel_id` at all — being
polymorphic, their scope is their subject's, resolved by `subjectInScope`.

### 4.2 Relationship direction — the sixth design principle

**Every relationship has exactly ONE canonical stored side; the reverse is always a
derived query, never a second stored pointer.** So:

- Litter→Pairing is stored as `Litter.pairing_id`; a pairing's litter is
  `litterRepo.getForPairing`. There is no `Pairing.litter_id`.
- StudService→Pairing is stored as `StudService.pairing_id`;
  `studServiceRepo.getByPairing` is the reverse. There is no `Pairing.stud_service_id`.
- Contract→Sale / →StudService / →Dog / →Contact are stored on the Contract
  (`related_sale_id`, `related_stud_service_id`, `related_dog_id`,
  `related_contact_id` — the last two for `lease`/`co_own`/`other` contracts).
  Sales/stud-services/dogs/contacts carry no contract pointer;
  `contractRepo.getBySale`/`getByStudService`/`getByDog`/`getByContact` are the reverse.
- A Dog's children, a Contact's dogs, a Kennel's contacts — all derived queries over
  the indexed FK.
- Expense→Event is stored as `Expense.event_id` (the money owns the link); an event's
  cost is `expenseRepo.getByEvent`. There is no `Event.expense_id`/`Event.cost`.
  Expense→subject (dog/litter/pairing/kennel) is the polymorphic
  `[subject_type+subject_id]`; a subject's expenses are `expenseRepo.getForSubject`.

When you need "the reverse of X," write a query. Do not add a mirror field.

### 4.3 Two decisions that are settled — do not re-litigate

- **One `Dog` table** for breeding stock, puppies, and external dogs. A life-stage
  change is a `status` update on the same record, never a new row.
- **One `Event` table** for all dated history, polymorphic via
  `subject_type`/`subject_id`. No per-type event tables.

---

## 5. Dexie schema (`data/db.js`)

DB name: `KennelOSBreedingApp`. All sixteen tables live in a **single collapsed
`version(1)` block**. Indexes:

```
dogs:          id, sire_id, dam_id, litter_id, breeder_kennel_id,
               owner_contact_id, *co_owner_contact_ids, status, ownership_type,
               sex, breed, kennel_id, is_archived
events:        id, [subject_type+subject_id], event_type, event_date,
               reminder_date, related_dog_id, related_contact_id, is_archived
expenses:      id, event_id, [subject_type+subject_id], category,
               expense_date, is_archived
contacts:      id, kennel_id, waitlist_status, is_archived
kennels:       id, public_id, is_archived
pairings:      id, kennel_id, sire_id, dam_id, status, pairing_type, is_archived
litters:       id, kennel_id, pairing_id, sire_id, dam_id, status, whelp_date,
               foster_partner_contact_id, is_archived
sales:         id, kennel_id, dog_id, buyer_contact_id, referred_by_contact_id,
               status, placement_type, is_archived
contracts:     id, kennel_id, contract_type, status, related_sale_id,
               related_stud_service_id, related_dog_id, related_contact_id, is_archived
stud_services: id, kennel_id, our_dog_id, partner_dog_id, partner_contact_id,
               referred_by_contact_id, direction, status, pairing_id, is_archived
documents:     id, kennel_id, dog_id, doc_type, doc_date, is_archived
files:         id, created_at
breed_feeding_schedules: id, breed, is_archived
waitlist_entries:  id, kennel_id, contact_id, status, waitlist_program_id,
                   *listen_sire_ids, *listen_dam_ids, placed_sale_id, is_archived
waitlist_offers:   id, entry_id, litter_id, kennel_id, chosen_dog_id, sale_id, outcome, is_archived
waitlist_programs: id, kennel_id, is_archived
device_secrets:    id
```

`device_secrets` is a **device-only table** (`db.DEVICE_ONLY_TABLES`): this device's
unlocked private-vault key, stored as a `CryptoKey`, and any open request to be unlocked by
another device (§30, Private Vault Plan §3.3). It is not
kennel data, so it has no `syncRegistry`/`referenceRegistry` entry, and code that means "the
records" iterates `db.dataTables()`: `exportAll`, every restore mode, and Reset App's counts
leave it out. Reset App and remote erase still clear it.

Index notes:
- **`kennel_id` on `pairings`/`litters`/`sales`/`stud_services`/`contracts`/
  `documents` is the KENNEL SCOPE** (`docs/KennelOS_Multi_Kennel_Scope_Spec.md` §4.1):
  which of the user's own kennels the record belongs to. **Stamped on create** by
  inheriting from the record's parent (a sale from its dog, a contract from its sale,
  a puppy from its litter, a litter from its dam) and falling back to the active/sole
  kennel — never derived at read time, so moving a dog between the user's kennels can't
  retroactively rewrite the history of a litter or sale. `dogs.kennel_id` is the same
  scope for a dog, and is **required** for `owned`/`co_owned` dogs (`dogRepo.validateDog`);
  an `external`/`leased_in` dog's `kennel_id` still names somebody else's kennel and
  stays optional. Deliberately NOT scoped: `events`/`expenses` (polymorphic — scope
  derives from the subject), `files` (fetched by id only), and
  `breed_feeding_schedules` (a program-wide per-breed lookup).
- **`kennels.public_id` is an IDENTITY field, not a foreign key** (§28). It is indexed because the
  kennel-card import's match-or-create step probes it (`kennelRepo.getByPublicId`) on every apply, and
  because that lookup is the only thing standing between “link this card to the kennel I already
  have” and a duplicate. It gets **no `referenceRegistry` entry** — no table stores a pointer to it,
  so there is nothing to guard on hard delete (same posture as `breed_feeding_schedules.breed`).
  The index is deliberately **plain, not Dexie-unique (`&`)**: uniqueness is enforced in `kennelRepo`
  so a collision reaches the user as a sentence about kennels rather than a raw `DexieError`.
- `events.[subject_type+subject_id]` **and** `expenses.[subject_type+subject_id]` are
  **compound** indexes (fast per-subject timeline / ledger). Do not split them.
- `expenses.event_id` is indexed so `expenseRepo.getByEvent` is an index probe.
  `expenses.category`/`expense_date` back the Financials report's filters.
- `sales.referred_by_contact_id` and `stud_services.referred_by_contact_id` are the
  referral FKs, guarded in `CONTACT_REFERENCES`.
- `dogs.*co_owner_contact_ids` is a **multi-entry** index ("dogs co-owned by X").
- `documents` (§26.1) is indexed on `dog_id` (a dog's document list), `doc_type`
  (the type filter chips), and `doc_date` (newest-first sort). `files` — the blob
  archive backing both Documents and `expenses.receipt_file_id` — is fetched only by
  id, so only `created_at` (backup ordering) is indexed. `expenses.receipt_file_id`
  is a **plain, unindexed** FK into `files` (fetched by id only, never queried on).
  `documents.contract_id` (§26.1) is a **plain, unindexed** optional FK into
  `contracts` — the same posture — so the Contract page can surface its filed
  signed document(s). Its reverse (`documentRepo.getByContract`) is an in-memory
  scan, not an index probe, and it is deliberately **not** a `referenceRegistry`
  entry (cleared on the contract's `hardDelete` instead).
- `events.reminder_date` is indexed for the reminder engine's range probe. Every other
  canonical FK is indexed so reverse lookups are index probes, not scans.
- **Unindexed but persisted:** `events.event_end_date`, `events.reminder_dismissed`,
  `dogs.recorded_coi`, plus every non-indexed field. They persist and ride backups;
  they simply aren't queryable by key.
- **Binary, base64 in backups:** `files.blob` is a real `Blob` — the schema's only
  binary field. JSON can't hold a Blob, so `importExport.js` base64-tags it on export
  and rehydrates it on restore (`BACKUP_FORMAT_VERSION` 2). This is what keeps stored
  documents/receipts durable across the JSON backup **and** the Dropbox sync (both go
  through `exportAll`/`restoreBackup`). Any future Blob field must round-trip the same
  way — a plain `JSON.stringify` silently drops a Blob to `{}`.
- `is_archived` is filtered in JS, not by index (IndexedDB can't key on booleans;
  trivial at kennel scale).
- `breed_feeding_schedules` (§27.2) is indexed on `breed` — a free-text lookup
  key matched against `Dog.breed`, not a stored FK, so `breedFeedingScheduleRepo.
  getByBreed` is a probe rather than a scan. `litters.feeding_schedule_override`
  (§27.2) is plain and unindexed, same posture as the foster fields.
- The three **waitlist** tables (§29) index every FK so each `referenceRegistry` probe is a
  lookup — including the two **multi-entry** listen lists (`*listen_sire_ids`,
  `*listen_dam_ids`), which only the hard-delete guard queries by key. Their
  `kennel_id` is the kennel scope (one list per kennel). `Dog.intended_placement`,
  `Litter.picks_opened_date` and `Kennel.waitlist_config` are plain and unindexed.

Everything lives in that one `version(1)` block, including later additions like
`litters.foster_partner_contact_id` (§25, the referential guard for a foster partner
Contact) and the `documents`/`files` tables (§26.1) — `foster_direction`, the foster split
fields, and every other non-indexed field are plain unindexed and so are not in the strings.

### The versioning rule

The `version(1)` block is edited **in place**: add or change a table or index right in that
block, then reconcile the change with **Reset App to Start** + re-seed — schema and seed data
move together, and there is no separate migration path.

---

## 6. The repo layer

`repoBase.js`'s `makeRepo(tableName, references)` gives every entity the same thin
surface; each entity repo wraps it to add validation and derived queries.

Uniform surface:
- `getById(id)`
- `getAll({ includeArchived = false })` — archived filtered in JS
- `create(data)` — assigns `id` (UUID), `is_archived=false`, timestamps
- `update(id, changes)` — merges, preserves `id`/`created_at`, bumps `updated_at`
- `archive(id)` / `unarchive(id)` — soft delete (the normal "remove")
- `getDeleteBlockers(id)` — reference blockers without deleting (for UI)
- `hardDelete(id)` — blocked if any reference exists (throws `ReferenceBlockedError`)

`create`/`update`/`hardDelete` each call `assertWritable()` (`data/demoMode.js`) first — a
**no-op in this (Pro/shared) code**, but the single lever the Demo edition flips to make
every user write a friendly no-op (throws `DemoModeError`); the demo seed writes inside a
`withSeedAllowed()` window. `fileRepo` (which bypasses `makeRepo`) carries the same guard.
Edition machinery — see the editions README / cap spec, not this guide.

Conventions each entity repo follows:
- `create`/`update` run a `validate<Entity>` first, then delegate to base. Update
  validates the **merged** result so partial updates are checked as a whole.
- Only hard, non-interactive rules live in the repo (required fields, cycle prevention,
  sire≠dam). Soft/interactive warnings (sex mismatch, date ordering, "leaving
  deceased") belong to the page UI — a repo can't prompt.
- Derived reverse-lookup helpers live on the repo (e.g. `dogRepo.getChildren`,
  `contactRepo.getDogs`, `contractRepo.getBySale`).

Notable repo specifics:
- **dogRepo**: pedigree cycle prevention in `validateDog` (walks ancestors with a
  visited-set); `addPlannedTests` (additive, dedupe-on-write); `getBreeds`.
- **eventRepo** (exported as both `HistoryEvent` and `eventRepo`): see §8.
- **saleRepo.isOpenSale(sale)**: true when a sale is non-archived and its status is not
  in `{delivered, returned, cancelled}`. Drives family-companion membership (§20) and
  the "open sale" filter. The predicate and `TERMINAL_SALE_STATUSES` live in `vocab.js`
  (`isOpenSale`), so the pure waitlist modules (projection, family events) use the same rule
  for Companion link requests (Waitlist Spec §16.10); `saleRepo` re-exports them.
- **contractRepo.governingContract(contracts)**: derived "live contract" = most recent
  `signed` by `signed_date` (fallback `created_at`), or null. Never stored.
  **contractRepo.isLivePartnerContract(c, today)**: non-archived, counterparty set, not
  a terminal status (`declined`/`cancelled`/`void`), and — for a lease — not past
  `lease_end_date`. Drives partner-companion membership and the partner bundle's
  contract block (§20), so the two can't drift.
- **kennelRepo**: `preferred_tests`/`preferred_breeds` authoring (dedupe-on-write;
  remove drops membership only, never purges a token another event may need);
  `getVocabulary`/`getBreedVocabulary` union over own-kennels. `addPreferredTest`'s
  optional third arg tags the test with a contributing breed in
  `preferred_test_breeds`; `testBreedsFor(k, token)` reads that tag back sorted for
  display, `testsForBreed(k, breed)` filters the panel to one breed (a tagged test
  needs a match, an untagged one always passes) — see the seedImport.js bullet below
  and §8.
- **expenseRepo**: `getForSubject`, `getByEvent`/`getOneByEvent`, and `total(rows)`. See §21.
- **contactRepo.ensureType(id, type)**: adds a `contact_type` role if missing (no-op
  otherwise). `saleRepo`/`studServiceRepo` call it on save to auto-tag a
  `referred_by_contact_id` as `buyer_referrer`/`stud_referrer`.
- **waitlistEntryRepo**: after every create/update/archive/hardDelete it recomputes the
  family's `Contact.waitlist_status` (`waitlistRules.deriveContactWaitlistStatus`) and
  tags them `buyer` while approved/on the list/placed — so the field is kept in step, not
  hand-edited. `getByKennel`/`getByContact`/`getByProgram`. **waitlistOfferRepo** checks the
  entry, litter and offer share one kennel; `getByEntry`/`getByLitter`/`getByKennel`.
  **waitlistProgramRepo** `getByKennel`/`getMapForKennel` (archived included). See §29.

Two derived aggregators live in `data/` but are not repos and own no table:
- **incomeView** (`incomeView.js`): `getIncomeRows({includeArchived})` and
  `summarize(rows)` read Sale + outgoing StudService and classify each money component
  earned/anticipated for the Financials Income & Overview views. Each sale row also
  carries `dog_id`/`litter_id` (the puppy's litter) so income rolls up per litter. Also
  exports `incomeLineItems(sourceType, record)` — the cash line items (drops the
  non-cash `pick`, tags each with its label) the invoice/receipt generator builds from,
  so a document can't show a component the ledger wouldn't. Stores nothing; recomputed on
  every load. See §21 and §24.
- **litterFinances** (`litterFinances.js`): `getLitterFinances()` — one P&L row per
  litter for the **Litter P&L** report: puppy-sale income (earned/anticipated via
  incomeView, grouped by `litter_id`) vs the full litter cost (litter-subject expenses
  **plus** each puppy's dog-subject expenses) and the net. Stores nothing. See §21.

> Module naming trap: the Event repo's JS object is `HistoryEvent`/`eventRepo`, **never
> a bare `Event`** — that would collide with the DOM global.

---

## 7. Referential integrity (`data/referenceRegistry.js`)

Hard delete is the rare "undo a data-entry mistake" action; **soft delete (archive) is
the normal remove and never cascades**.

- Each entity has a declared array of every FK that can point at it (`DOG_REFERENCES`,
  `CONTACT_REFERENCES`, …). `findBlockingReferences(registry, id)` counts matching rows
  per entry and returns human-readable `{label, count}` blockers; `hardDelete` throws
  `ReferenceBlockedError` if any exist.
- `CONTACT_REFERENCES` covers owner/co-owner of a dog, buyer + referrer on a sale,
  partner + referrer on a stud service, contact on a boarding, placement, or show event, the
  lease/co_own/foster/other contract counterparty, and the **foster partner on a
  litter** (`litters.foster_partner_contact_id`, §25) — so a contact documented anywhere
  can't be hard-deleted out from under it.
- `EVENT_REFERENCES` is `[{ expenses.event_id }]`: an event carrying a linked expense is
  hard-delete-blocked (archive it, or clear the Cost first). `eventRepo` is
  `makeRepo('events', EVENT_REFERENCES)`.
- `DOG_/LITTER_/PAIRING_/KENNEL_REFERENCES` each carry an `expenses.subject_id` entry
  (compound-index + discriminator), so a subject can't be hard-deleted out from under its
  expenses.
- **`KENNEL_REFERENCES` also carries the six kennel-scope FKs** —
  `pairings`/`litters`/`sales`/`stud_services`/`contracts`/`documents` `.kennel_id`
  (§5, Multi-Kennel Scope Spec §4.2) — alongside `contacts.kennel_id`,
  `dogs.kennel_id`, and `dogs.breeder_kennel_id`. **Consequence:** a kennel in real
  use is effectively undeletable, because its own litters/sales/contracts block the
  delete. That is intended (archive is the exit), and the Kennels page's Delete
  button disables itself with the blocker list naming exactly what's holding it.
  `tests/referenceRegistry.test.js` parses `db.js`'s schema and asserts every
  declared `*kennel_id` index has a registry entry, so a seventh scoped table can't
  be added without one.
- `DOG_REFERENCES` also carries a `documents.dog_id` entry (§26.1), so a dog with filed
  documents can't be hard-deleted out from under them.
- **Waitlist FKs (§29):** `waitlist_entries.contact_id` (Contact), the three waitlist
  `kennel_id`s (Kennel), `waitlist_offers.litter_id` (Litter),
  `waitlist_entries.placed_sale_id` + `waitlist_offers.sale_id` (Sale), `waitlist_offers.chosen_dog_id`
  + the multi-entry `waitlist_entries.listen_sire_ids` / `listen_dam_ids` (Dog), plus the new `WAITLIST_ENTRY_REFERENCES` (`waitlist_offers.entry_id`) and
  `WAITLIST_PROGRAM_REFERENCES` (`waitlist_entries.waitlist_program_id`).
  `WAITLIST_OFFER_REFERENCES` is empty (a leaf). Consequence: an entry whose listen-only choice
  names a sire or dam (`selected` or `except`), even a withdrawn one, blocks that dog's hard delete — archive is
  the exit. `tests/referenceRegistry.test.js` pins each of these to an indexed field.
- `Contract`, `Expense`, `Document`, and `BreedFeedingSchedule` (§27.2) are leaves
  *for the registry* (empty `CONTRACT_REFERENCES` / `EXPENSE_REFERENCES` /
  `DOCUMENT_REFERENCES` / `BREED_FEEDING_SCHEDULE_REFERENCES` — nothing in the
  registry points *at* them, so none is ever a hard-delete blocker). The one exception
  that stays outside the registry: a Document may carry an **unindexed** `contract_id`
  back-link to a Contract (§26.1). Because it isn't a registry entry it never blocks the
  contract's delete; `contractRepo.hardDelete` clears it first (via
  `documentRepo.unlinkContract`) so no document is left pointing at a deleted contract —
  the same "owner clears its unregistered back-link on delete" shape as the `files` rule
  below. A `files` row is **not** in the registry: it is owned by exactly one Document
  (`documents.file_id`)
  or one Expense (`expenses.receipt_file_id`) and is deleted alongside its owner in that
  repo's `hardDelete`, never orphan-guarded.
- The guard **skips any table not present in the current schema** — so it can't rot;
  adding a referencing table later is one appended line.
- The polymorphic Event/Expense subject is matched via the compound index with a
  discriminator (`{compoundIndex:'[subject_type+subject_id]', discriminatorValue:'dog'|
  'pairing'|…}`).
- The blocking message is generated entirely from the registry, so it always matches the
  tables that actually exist — no hand-maintained carve-outs.

**When you add an FK anywhere, add its line to the registry** or hard-delete will
silently allow orphaning.

---

## 8. The Event model

One polymorphic table for all dated history. `subject_type ∈ {dog, pairing, litter}` +
`subject_id` say what it's attached to. The type catalog lives in `vocab.js`
`EVENT_TYPES`; each type carries:

> **Cost lives in the ledger, not on the Event.** The event form shows a "Cost" (+
> "Cost category") field, but on save it upserts an `Expense` carrying `event_id` = this
> event and the event's own subject; clearing the field removes that linked expense. The
> timeline reads the amount back via `expenseRepo.getByEvent`. See §21.
- `subjects[]` — which subject types may log it (`eventTypesFor(subjectType)` filters).
- `editionFlag` (optional) — the type exists only when `editionFlags[editionFlag]` is on.
  `enabledEventTypes()` = `EVENT_TYPES` minus types whose flag is off, and
  `eventTypesFor()` filters *that*, so every type picker (event form, CSV import, the
  assistant, Upcoming's Type filter) drops the type in one place. Flags are read at call
  time, never cached in a top-level const. `EVENT_TYPES` itself stays complete, so
  `descriptor()`/badges still resolve such an event arriving in a backup from another
  edition. (`show` carries `editionFlag: 'shows'` — Pro/Demo only.)
- `duration` — `'instant'` (single date) or `'span'` (`event_date` start, optional
  `event_end_date` end). Spans: `medication`, `heat_cycle`, `boarding`.
- `badge` — colour class.
- `fields[]` — the small type-specific form written into `details{}`. Field types:
  `text`, `textarea`, `number` (optional `step`), `date`, `combobox`
  (suggest-not-enforce), `select` (enforced, options[] only). Options are plain strings
  **or** `{ value, label }` vocab objects (the form stores `value`, shows `label`). A
  field may carry `default`, applied only when *creating* an event whose draft has no
  value for that key (a prefill wins).
- `relatedContact: true` — surfaces the top-level `related_contact_id` FK (boarding,
  placement, show). Contacts on events are the canonical FK, never a `details` value. A
  **string** value is the picker's label (`show` → "Handler"). `eventForm.js`'s
  `RELATED_CONTACT_ROLE` tags the saved contact with a role via `contactRepo.ensureType`
  (`show` → `handler`), whether picked or created inline.
- `titleFrom` (optional) — a `details` key that auto-fills the title (`show` →
  `show_name`): while the title is empty, the type label, or the last auto-filled value,
  typing in that field rewrites it; a hand-edited title is left alone.

`openEventForm`'s `prefill` may also carry `event_date` (seeds a new event's date; today
is the fallback).

**Show specifics** (`show`, Pro-only — `docs/KennelOS_Show_Tracking_Spec.md`): one
instant event per dog per show day. `related_contact_id` = handler; `reminder_date` =
entries close; Cost → a `show` ("Shows & handling") expense. `details{}`: `entry_status`
(`SHOW_ENTRY_STATUS`, default `planned`), `show_name`, `club`, `organization`
(`SHOW_ORGANIZATIONS`, default `AKC`), `location`, `ring`, `ring_time` (inert string),
`judge` (free text, not a Contact FK), `class` (`AKC_SHOW_CLASSES` suggestions),
`placement` (`AKC_SHOW_AWARDS` suggestions), `points` (number), `points_toward`
(`TITLE_TRACKS`), `defeated_champion` (Yes/No). Club and judge suggestions are the
distinct values already logged (`eventForm.js` `LOGGED_VALUE_FIELDS` →
`eventRepo.getDetailValues(type, key)`). Points/majors/titles are **derived, never
stored**. Saving raises one soft confirm (never a block) for: points over the track's
`perShowMax`, points while status ≠ `shown`, results on a future date, points with no
`points_toward`.

**Points engine (`data/showPoints.js`).** Title progress is derived on read from the
dog's `show` events against the `TITLE_TRACKS` rows (AKC CH / GCH) — no stored points,
majors or titles. A *counting* event is a non-archived `show` with `entry_status`
`shown`, `points_toward` = the track, and `Number(points) > 0` (CSV strings coerced;
blank/junk = 0). Per track: points = Σ min(points, `perShowMax`); a major = a win with
points ≥ `majorMin` (derived, never a flag); distinct judges are compared trimmed,
whitespace-collapsed and case-folded, and a blank judge never counts. Two majors under
one judge are one major judge, so the track still needs "1 more major under a new
judge". `trackProgress(events, track, {since})` returns the tally, `complete`,
`completedOn` (the first win that satisfied every requirement), human-readable
`missing[]`, and `notCounted`. A track with `requires` (GCH → CH) counts only wins dated
**after** the required-title date — the earliest of a non-archived `title_earned` event
whose `title_abbreviation` matches (case-insensitive) and the required track's
`completedOn`; earlier wins are reported in `notCounted`, and with no such date the track
is incomplete with "CH not yet earned". `showRecordFrom(dogEvents)` (pure) assembles one
row per track the dog has show events aimed at plus the newest-first history;
`getShowRecord(dogId)` is the one-query loader (`getForSubject`). Completion never writes
anything.

**Placement specifics:** `dropoff_method` (`select`, enforced choice from
`PLACEMENT_METHODS` — Flight nanny / Ground transport / Local pickup / Other) sits first
in the form, directly above `placement_time`. A deferred-pickup boarding rate lives on
**`Sale`**, not here — see §5's Sale row and §21's money note.

Test-bearing types (`genetic_test`, `breed_specific_test`, `ofa_pennhip`) feed the
shared test vocabulary; `testTokensOf(event)` derives the test-name token(s).

**Litter-wide cascade** (`litter.js`'s "Log event for whole litter" → `openEventForm`'s
`cascadeTargets`): normally every checked puppy gets one Event with the *same*
`details{}`. `weight_check` is the one exception — `eventForm.js`'s
`PER_TARGET_CASCADE_FIELDS` names `weight_lbs`/`weight_oz` as per-target, so each checked
puppy gets its own weight inputs while `time_of_day` stays a single shared field. Add a
type to that map to give any other field the same per-puppy treatment.

**Weight-regression warning** (`eventForm.js` `save()`): saving a `weight_check` whose
value is **below the same dog's previous weigh-in** raises a soft confirm ("Weight
decreased — Save anyway?"), never a hard block (soft/interactive checks are the page's job,
not the repo's, per §6). It's checked **per dog**, so a litter-wide bulk weight-add lists
exactly which puppies dropped (and by how much). Comparison is total ounces (`lbs×16 + oz`)
against the dog's **immediately preceding** `weight_check` (`findPriorWeighIn`, excluding the
event being edited); a weight with no prior to compare against, or one that held/rose, saves
silently. "Preceding" is a **same-day AM/PM-aware total order** (`weighKey`/`keyCmp`: date →
AM-before-PM via `time_of_day` → capture time), so two weigh-ins on one day sort correctly — a
PM compares against that morning's AM, and an AM compares against the prior day rather than a
later-in-the-day PM.

### eventRepo reads (all siblings — deliberately never fused)

- `getForSubject(type, id)` — the timeline, newest first (compound index).
- `getBoardRows()` — dogs currently away via boarding events: `event_type='boarding'`,
  not archived, not yet ended. Whereabouts only — **not** all spans. This is ONE half of
  the away-board; `data/awayBoard.js` `getAwayBoardRows()` unions it with
  `studServiceRepo.getBoardRows()` (in-person stud services) into one view-model — §19.
- `getUpcoming()` — instant-duration events at/after today, any subject ("Upcoming
  Deliverables").
- `getScheduledPlacements()` — future `placement` events only.
- `getByType(type, {includeArchived})` — every event of one type across all subjects,
  oldest first (one `event_type` index probe). The Shows page's read (`show`).
- `getReminders()` / `getDismissedReminders()` — events with a non-null `reminder_date`,
  not archived, split by `reminder_dismissed`. `reminder_date` is the app's **one**
  future-dated mechanism. Bucketing into overdue/due-soon/upcoming is a display concern
  (30-day window), computed in the page, not the repo.
- Reminder mutations: `dismissReminder`/`undismissReminder` (not archiving, not a status
  change) and `snoozeReminder` (snooze **is** a `reminder_date` edit — there is no
  separate snooze field).

The overdue/due-soon boundary (`DUE_SOON_DAYS = 30`) is duplicated as a UI constant in
`reminders.js` and `dashboard.js`; keep them equal if you change it.

---

## 9. CSV import (`data/csvImport.js`)

Generic, entity-agnostic match-or-create engine used through the shared
`assets/importView.js` UI (the **expense** importer is the one exception — it reuses this
engine for parsing/classification but renders its own subject-attach review screen; see the
Expense mapping below). Every import is a **dry-run preview** (create / update /
needs-review) before any write.

Flow: `parseCsv` (PapaParse; headers → lower_snake_case, values trimmed) →
`buildPlan(entity, rows)` → user reviews/adjusts decisions → `commitPlan`.

Rules that shape everything:
- **Natural key must be non-empty.** Keyless/partial-key rows are always "needs review" —
  never auto-matched, never silently created.
- Name match is case-insensitive + trimmed; dates exact. Enum/date cells normalize to a
  value, `''` (blank), or `null` (present but unrecognized → flagged).
- Relationship columns (sire/dam/dog names) resolve against **existing** records only; an
  unresolved name is flagged, never invented.
- **Kennel by name** (Multi-Kennel Scope Spec §11): Dog, Pairing, Litter, Sale, and
  StudService all accept an optional `kennel_name` column, resolved the same way as every
  other relationship column — case-insensitive/trimmed, against existing kennels only, via
  the shared `resolveKennelColumn()` helper. Pairing/Litter/Sale/StudService require the
  match to be one of the user's **own** kennels (they only ever carry an own-kennel scope);
  Dog requires it only when `ownership_type` is `owned`/`co_owned` — an external/leased dog
  may legitimately name an outside kennel here. Either way, a named kennel that fails to
  resolve routes the row to **review**, exactly like an unresolved sire/dam — it never falls
  through to commit and silently lands on whatever `stampKennelScope()` would otherwise
  default to. A blank column is not a failure: `commitPlan`'s `stampKennelScope()` fills it
  from the active/sole kennel at commit time, same as before this column existed.
- **Two deliberate exceptions** auto-create a Contact inline at commit (never a stall):
  Sale's `buyer_name` and StudService's `partner_contact_name`, via each mapping's
  `prepareRecord` hook.

Per-entity natural keys: Dog = name+DOB; Contact = name; Pairing = sire+dam+planned;
Litter = dam+sire+whelp; Sale = dog+buyer+sale_date; Event (dog-subject only) =
dog+type+date (title tiebreak — and for `show` rows the title **always** takes part: a
single same-day candidate with a different title goes to review, never a silent update,
so a double-header's "Show 2" can't overwrite "Show 1"); StudService = our_dog+partner_dog+direction (no date, so
any existing match is always routed to review); Expense = subject+expense_date+amount+
category+vendor (idempotent re-import — the same file updates, never duplicates).

**Expense mapping (the Receipts-app import path, §21).** The ledger's external-tool
in-road: a companion receipts/mileage app (or any spreadsheet) emits one row per cost and
this brings it into the Expense ledger with the same dry-run discipline. Columns:
`subject_type`, `subject_name`, `expense_date`, `amount`, `category`, `vendor`, `miles`,
`mileage_rate`, `receipt_number`, `notes`. **Subject resolution** covers the two subjects a
name-only tool can express: `subject_type='kennel'` (the default when blank — program
overhead) resolves by kennel name, or by the configured "my kennel" / sole own kennel when
`subject_name` is blank; `subject_type='dog'` resolves by registered/call name (an ambiguous
name is flagged, never guessed). `litter`/`pairing` subjects have no name key, so the CSV
can't name them — **but the expense importer's review UI lets you attach any row to a litter/
pairing (or reassign its dog/kennel) by hand before commit** (see below). **Mileage:** a row
with `miles` set is a mileage expense — `category` is forced to `mileage`, `mileage_rate`
falls back to `settings.getMileageDefaults().rate` when blank, and `amount` is left for
`expenseRepo` to derive (miles × rate), never taken from the file. **Idempotent key:** when a
row carries a `receipt_number`, that IS the natural key (`rcpt <n>`), so the same receipt
always maps to the same ledger row and re-import updates it in place even if amount/date/
subject changed; without one, the key is the composite subject+date+amount+category+vendor.
Either way the match index only considers **non-archived, non-event-linked** ledger rows, so
a re-import can never clobber a cost captured from the event form. The CSV import carries
**no image** — only the extracted money data (and the `receipt_number` back-pointer) crosses
over. To attach the receipt image itself to a ledger row, use the in-app receipt capture on
the expense form (§26.1); the importer doesn't touch files.

**The expense importer has its own review screen** (`pages/expense-import.js`) — the one
importer that does **not** use the shared `assets/importView.js`. Because an Expense is
polymorphic (every row must attach to a subject), it reuses the parse + `buildPlan('expense',…)`
engine for all field parsing / classification / receipt-number keying, but renders its own
table so each row gets an editable **"Attach to"** control (subject-type dropdown + subject
picker, prefilled from the CSV's name resolution, reassignable to any dog/litter/pairing/
kennel) before commit. Commit writes straight through `expenseRepo.create`/`update` with the
chosen subject. This is the "relate each imported expense to a dog or litter" surface.

**Waitlist application mapping** (`entity: 'waitlist'`, Waitlist Spec §5.1; Pro-only page
`waitlist-import`, reached from the Waitlist page's **Import CSV** and the Import/Export
dropdown). Each row becomes an `applied` entry on one own kennel's list — a `kennel_name`
column, else the kennel the import page picked (`mapping.preferredKennelId`, set from its
kennel picker), else the active/sole kennel; no kennel → needs review. **Natural key: email**
(per kennel). No email or no name → needs review (skip). An email matching a still-`applied`
entry on that kennel → **update**, which only refreshes the answers and preferences (never
status, kennel or dates); matching an approved/on-the-list entry (by application or contact
email) → needs review, skip. Contacts are never matched here — approval offers that match
(§29). Recognized columns include a Google Form `Timestamp` (date part kept) and common
question-style headers. **Answers follow that kennel's application form** (W1e, §29): each
question reads `waitlistForm.columnsFor(question)` — the column it was imported from
(`source_header`) first, then `IMPORT_ALIASES` — answers are keyed by question id (checkboxes
split into an array), and the entry stores `application_questions`, the wording it was imported
under. Unknown program/placement/kennel values are flagged, never invented.

To add an entity to the importer: write one mapping object (`{entity, label,
templateHeaders, requiredForCreate, loadExisting, buildIndex, classify, describe, repo,
prepareRecord?}`) and register it in `MAPPINGS`. Don't rebuild the engine.

> Keep this file clean UTF-8 (no BOM). It contains user-facing review strings.

---

## 10. JSON backup / restore (`data/importExport.js`)

The cross-device data path. This module may use `db` directly (it's in the data layer,
doing cross-table transaction work).

- `exportAll()` iterates **whatever tables exist** (no hardcoded list) → `{ schema_version,
  format_version, exported_at, collections }`. `downloadBackup()` saves it and stamps
  `lastBackupDate`. `exportAll({ encodeBlobs: false })` leaves file blobs as real Blobs, for
  the cloud snapshot builder, which hashes and uploads them itself.
- `inspectBackup(obj)` validates shape and reports counts + unknown tables before any
  write.
- `restoreBackup(obj, mode)` (all modes see only `db.dataTables()`, never the device-only
  `device_secrets`):
  - `'replace'` — clears **every** known table first, then loads the file's rows, so the
    result is exactly the backup (a table the file omits ends up empty).
  - `'merge'` — upserts the file's rows by id, leaving other records intact.
  - `'cloud-merge'` (with `opts`: `overwrite`, `fetchFile`) — restores a **cloud snapshot**
    (`data/cloud/cloudBackup.js`; Cloud Phase 1 plan §4.3). It overlays only the
    `syncRegistry.js` cloud fields onto an existing row, so private fields already on the
    device survive; `events.details` merges by key. With `overwrite: false` (new device,
    takeover) a row is overlaid only when the snapshot's `updated_at` is newer. With
    `overwrite: true` ("Restore as of…") it is overlaid regardless. A missing row is inserted;
    a local row the snapshot lacks is left alone (it never deletes). A missing file is
    fetched through `opts.fetchFile(sha256)`, or listed in `missingFiles`.
    `planCloudMerge()` gives the same per-table counts without writing, for the
    confirmation screen.
  - `'vault-merge'` (same `opts`) — restores a decrypted **private-vault payload** (§30;
    Private Vault Plan §4.4), which holds complete rows. A missing row is inserted; a vault
    row as new as the local one or newer (or any row, with `overwrite: true`) replaces it
    whole; a **locally newer** row is kept but its blank private fields, and the missing
    keys of its object fields, are filled from the vault row (cloud fields stay local). So a
    record edited while the device was locked keeps the edit and gets its private details
    back. `files` rows carry `vault_file` `{ sha256, plain_sha256, encrypted }` in place of
    the blob, fetched through `opts.fetchFile(vaultFile, row)`. `planVaultMerge()` counts
    without writing.
  - Unknown collections (tables not in this schema version) are skipped, not errors.
  - Every restore calls `markDataChanged()` (§11), so the cloud backup sees it.
  - Before any write it awaits the edition hook `enforceImportDogCap({ incomingDogs, mode })`
    (`data/editionConfig.js`; classification math in `data/rosterCount.js`). The shared/Pro
    default is a no-op, so Pro/Demo restore is exactly as above; the Lite override rejects a
    restore that would leave more than its dog cap (all-or-nothing — see the cap spec §9).

`BACKUP_FORMAT_VERSION` bumps only when the on-disk shape changes in a migration-requiring
way.

**The Import/Export page's "Backup & restore" card drives this on two independent axes:**
*what* (Back up / Restore — the seg-tabs) × *where* (This device / Dropbox — chosen per
run, §26). They compose freely because a Dropbox push **is** a backup and a Dropbox pull
**is** a restore, running the same `exportAll()` / `restoreBackup()` as the local paths.
The invariant to preserve: **every restore source lands in the one preview**, so nothing
is ever written without the same dry-run table and the same Merge/Replace choice — adding
a third source means feeding that preview, not building a parallel flow. In Lite the whole
Dropbox axis is removed (no destination row, no connect strip), leaving the card as
plain local backup/restore.

---

## 11. First-run, sample data, seed, settings

- **settings.js** — the primary `localStorage` user. Pages never touch `localStorage`
  directly. Keys (all under `kennelOS.*`): `lastBackupDate`, `persistRequested`,
  `cloudDirtyAt` (the cloud backup's dirty signal, Cloud Phase 1 plan §3.2: the time of the
  latest data change, set by `markDataChanged()` from every write path — `repoBase`
  create/update/hardDelete, `fileRepo`, `expenseRepo`'s cost migration, `assistantSync`,
  every `restoreBackup` — and cleared by a push with `clearCloudDirty(pushedValue)`, so a
  change made mid-push survives; `tests/cloudDirty.test.js` pins every direct writer),
  `sampleDataManifest`, `sampleDataCleared`, `myKennelId`, `myContactId`,
  `activeKennelId` (which own kennel the app is scoped to, or absent for "All
  kennels" — read/written only through `data/kennelScope.js`, never by a page),
  `companion` (the Companion feature's per-type message templates
  — Layer 1, §20 — one JSON object keyed by recipient type via
  `getCompanionSettings`/`setCompanionSettings`), `invoiceDefaults` (the invoice
  generator's default accepted payment methods, §24, via
  `getInvoiceDefaults`/`setInvoiceDefaults`), `mileageDefaults` (the add-expense form's
  default rate per mile for mileage entries, §21, via
  `getMileageDefaults`/`setMileageDefaults`), `dropbox` (the Dropbox connection blob —
  refresh token, cached access token, in-flight PKCE verifier; the app key itself is
  hardcoded in `data/dropbox.js`, not stored here — §26, via
  `getDropboxSettings`/`setDropboxSettings`/`clearDropboxSettings`), `assistantLastSync`
  (when the KennelAssistant page last pulled the dog feed, §26),
  `assistantFeedPushedAt` (the owner-side mirror: when THIS device last *uploaded* the
  feed — what the Assistant console's "Last sent" reads, since `assistantLastSync` is a
  read stamp written on the helper's phone and can't answer it here, §26), `furever` (the Furever
  seed-link generator's kennel-wide identity block — kennel name/tagline, breeder
  contact, breeder's vet, plus an auto-generated `breederKey` — §27, via
  `getFureverSettings`/`setFureverSettings`). `clearAllSettings()` drops them all (used
  by Reset App), including `cloudDirtyAt` and `cloudDirtySince` (the first unpushed change,
  which the cloud scheduler's five-minute timer runs from), `cloudOfferPending` (the
  one-time post-setup cloud offer) and `cloudRestoredAt` (when this device was last
  restored from the cloud, for the private-details hint).
- **Cloud backup keys outside `KEYS`** (Cloud Phase 1 plan §3.3), so `clearAllSettings()`
  doesn't touch them: `cloudSession` (`{ token, email, programId, deviceId }`; the email
  stays on this device, the server keeps only a keyed hash), `cloudBackupState`
  (`{ enabled, lastPushedAt, lastAttemptAt, lastSnapshotId, lastCounts, lastContentHash,
  lastError, movedToEdition, lastCheckInAt }`; `lastCheckInAt` is the last device check-in,
  Cloud plan §2.5; `movedToEdition` is `'pro'` once a Lite device turned backup
  off because its program moved to Pro, which keeps Today's turn-on nudge quiet until backup
  is turned on again), and `cloudDeviceId` (this browser's id on the cloud account, sent on every
  sign-in so the backing device stays recognisable; separate from the license
  `deviceId`). **Reset App** handles them explicitly in `appReset.stopCloudBackupAfterReset()`:
  backup is always turned off, and the device forgets which snapshot it was in step with,
  so turning backup back on meets the server's 409 and the restore-or-replace choice
  instead of pushing an emptied program. The sign-in itself is kept; signing out is a
  separate choice (`cloudAuth.signOut`).
- **`eraseAck`** (outside `KEYS`): after a remote erase wiped this device, the dead cloud
  token alone, kept until `POST /devices/erase-ack` lands (`cloudDevices.finishEraseAck`, on
  every page load and when the browser comes back online). It opens nothing else on the
  server.
- **`cloudTestServer`** (also outside `KEYS`, so Reset App keeps it): `'1'` while this
  browser uses the edition's staging server (`devCloudUrl`) on a deployed origin. Any page
  visited with `?cloud=staging` turns it on and `?cloud=off` turns it off
  (`cloudConfig.applyCloudTestSwitch()`, run as that module loads). Changing it forgets
  `cloudSession` and `cloudBackupState` on this device, because a sign-in and a backup
  position belong to one server. It does nothing in an edition with no `devCloudUrl`
  (Demo). While it's on, `app.js` shows a "Cloud backup: TEST SERVER" strip on every page
  with a Turn off link.
- **nudgeState.js** — a second, deliberately separate `localStorage` module (one key,
  `kennelOS.nudgeDismissals`): the derived-nudge dismissal ledger (§19). Kept out of
  `settings.js`/`clearAllSettings()` on purpose — `appReset.js` calls its own `clearAll()`
  directly — and never exported in JSON backups: dismissals are device-local UI state, not
  portable domain data.
- **sampleData.js** — the "Thornfield Kennels" demo. Seeds through the **repo layer** (same
  validation as real data) and tracks created IDs in one manifest object (not an
  `is_sample` schema flag), so clearing is a lookup, not a scan. Deliberately **broad**
  (Tutorial Sample-Data Coverage Spec §6, Phase 2) so a first-run tour can point at a live
  example on every hub: a two-breed program (Boston Terriers **and** Boxers), a priced,
  actively-selling **Autumn litter** with an open sale (transport fee + deferred-boarding
  balance math), an **expected** litter, a lease (leased-in Boxer + `lease` contract) and a
  `co_own` contract, an **incoming AI** stud service, and dates tuned so seven of the nine
  Today nudges (§19) are live on a fresh seed — the litter→**close** rule is intentionally
  not live (it needs a `sold` litter whose placed pups are all `delivered`, which conflicts
  with the reopen/sold anchors and the packet size, per the spec's §9.3), and the
  show-title rule is deliberately unfinished so the card shows real gaps (below).
  **Show tracking** (Show Tracking Spec §9; Pro/Demo only — Lite seeds from its own tour
  package): Birch is working toward his AKC CH with handler **Lauren Pike** (`handler`
  role) — 7 past results totalling 12 points, one major, 3 judges ("3 more points, 1 more
  major under a new judge"), then a Thistle Valley cluster weekend 9–10 days out (Sat
  `entered` with a $38 `show` entry-fee expense linked via `event_id`; Sun `planned` with
  entries closing in 3 days — a live reminder and an amber flag on the Shows page). Companion has ≥1
  recipient on all three tabs (prospective / current families / partners). Editing this file
  still bumps `CACHE_NAME` (§ service worker); it adds no new file or FK.
  - **Briar Hollow Kennels** (Multi-Kennel Scope Spec §13) is a SECOND own kennel —
    Meadow Ridge is Dana Ruiz's outside kennel (the breeder-of-record/external-ownership
    demo, never a scope), so it never exercised the kennel switcher. Briar Hollow is
    deliberately small — its own sire/dam (Cassius × Opal, Golden Retrievers — a third
    breed line makes "which kennel is this" obvious at a glance), one pairing, one litter,
    one placed pup (Maple), one delivered sale — just enough for the switcher to show two
    real entries, the kennel hub's roster/litters/P&L to have live cross-kennel content,
    and a manual QA pass to confirm a picker's "show all my kennels" escape actually
    surfaces something. All of it rides the same manifest/clear machinery as the rest of
    the seed.
  - **A sample waitlist** (Waitlist Spec §11, Pro/Demo only — gated on
    `editionFlags.waitlist`; Lite's own seed has none) on Thornfield, via
    `seedWaitlist()`: Thornfield's `waitlist_config` ($300 credited fee, 14 days to
    pay), a **Treatment family** program (ahead, fee waived, passes don't count),
    and eight entries — Mia (in the program, **paused**), Owen (an **open offer** on the
    Autumn litter, whose picks are open), Rachel (one counted pass on Fern), the Alders
    (**listen-only** for Juniper as dam, which covers the Winter litter), the Riveras (on the list but on a **readiness hold**, can't commit for 3 months), Hannah (approved, fee due), Leo (a new
    application with no contact), and Priya's past run **placed** with Hazel (its credited
    fee nets off her sale in Financials, §21). The manifest carries `waitlist_programs` /
    `waitlist_entries` / `waitlist_offers`; `clearSampleData` deletes them first (offers →
    entries → programs) and counts them as the seed's own references, not contamination.
    The Pro/Demo tour gains two stops for it (the Waitlist page and the Autumn litter's
    picks panel).
- **seedImport.js** — optional breed+test vocabulary seed (from
  `resources/common_tests_by_breed_seed.csv` or a user file). Rows carry an optional
  `Breed Group` column (col A) that `buildSeedGroups()` attaches to each group as
  `breedGroup`, purely to power the picker's "browse by breed group" dropdown — it is
  never stored on the kennel. `listBreedGroups()` returns the unique group names.
  Appends to `Kennel.preferred_tests` / `preferred_breeds`; creates **no** records.
  Deliberately **not** routed through the csvImport engine (different shape). Both
  wizards below render the same `assets/breedTestPicker.js` widget over these groups:
  a type-ahead search box plus the breed-group dropdown (which opens a checkbox
  modal for that group's breeds); either path checks the breed into a list at the
  bottom that both wizards read at commit/save time. Used by both the standalone
  import page and the kennel-setup wizard. `applySeedToKennel` passes each test's
  contributing breed into `kennelRepo.addPreferredTest`'s third arg, tagging it in
  `preferred_test_breeds` — this is what powers the breed-scoped consumers: the
  kennel detail page's `(Breed1, Breed2)` display, new-dog auto-fill on `dog.js`
  save, and both "copy/apply from kennel" actions (`dog.js`'s Copy plan from…,
  `kennel.js`'s Apply to dogs…) — each resolves through `kennelRepo.testsForBreed`
  instead of the raw flat list, so a dog only inherits tests tagged for its own
  breed (plus any untagged/breed-agnostic ones).
- **kennelSetup.js** — the "your kennel and owner name" wizard; creates real
  Kennel/Contact records and remembers them by id in settings. **It is a MANDATORY
  gate, not a prompt** (Multi-Kennel Scope Spec §3.2): every owned dog carries a
  required `kennel_id`, so the app isn't usable until one own kennel exists. There
  is no "Skip for now" and no skipped-flag setting — `shouldRequireKennelSetup()`
  tests whether an **own kennel exists** (deliberately not whether `myKennelId` is
  set: the guided tour seeds an own kennel without ever setting it), and `app.js`'s
  existing fall-through re-fires the modal on every load until it's satisfied, so
  reloading can't escape it. Demo is exempt — `boot()` returns inside its branch
  before the first-run flow, and a read-only edition could never satisfy the gate. The owner
  Contact is always saved with `kennel_id` set to the kennel just created/
  updated — this is definitionally the breeder's own contact at their own
  kennel, so it must never come out of the wizard unlinked (a Kennel's
  `getContacts()` and the Kennel detail page's own-kennel views both depend on
  this link existing).
- **appReset.js** — `resetApp()` clears every table + all settings → the exact blank slate
  a never-visited browser sees. `eraseThisDevice()` is the remote erase (Cloud plan §2.5):
  `resetApp()`, plus KennelAssistant's database and every `kennelOS.*` key in both storages,
  including the ones a reset deliberately keeps (`settings.clearAllAppStorage()`).

First-run flow (`app.js` → `runFirstRunOnboarding()` in **`assets/onboardingUI.js`**):
request durable storage once, then — on a genuinely fresh install (`shouldOfferFirstRunPrompt()`)
— show a short card sequence: a **non-dismissible Welcome** card (what the app is), then a
**tour offer** ("Show me around!" / "No thanks, I'll explore"). The two branches:
- **"Show me around!"** → seed the Thornfield sample data, `startWizard()`, and reload so the
  destination page's `runWizardStep()` picks the tour up. Sample data is seeded **only** on
  this path.
- **"No thanks…"** → `declineSampleData()` (a blank kennel, no sample data ever), a
  **backups + install-as-app** card, then the **New Kennel** kennel-setup modal, in its
  `required` posture.
- **"I already use KennelOS → sign in and restore"** (Cloud Phase 1 plan §2.3) — a third
  button, shown **only when the edition has a cloud server** (`cloudConfig.isCloudAvailable()`).
  It runs `cloudBackupUI.runSignInAndRestore()`: email + code, then
  `cloudBackup.restoreOnNewDevice()`, which restores the latest snapshot, takes over as the
  backing device, records the first-run choice (`markSampleDataCleared`), and points
  `myKennelId` at the restored own kennel. Restoring **skips kennel setup**, since the
  snapshot has the kennel. Backing out of sign-in returns to the choice. An account with no
  backup yet carries on to kennel setup with backup already on.

**Cloud backup in the shell** (only with a server; an edition with `cloudUrl: null` never
loads any cloud UI, and the Welcome card keeps saying "no account, no cloud"):
- `app.js`, **first thing in `boot()`, before the Pro license gate**, dynamically imports
  `cloudDevices.bootDeviceCheck()`: a signed-in device checks in (the first page of a
  browsing session and on returning to the foreground or online, each at most once a
  minute; other page loads at most every 15 minutes) so an erase sent from another device
  reaches it even when it's walled (Cloud plan §2.5).
- `app.js`, after the first-run flow, dynamically imports `cloudBackupUI.bootCloud()`.
  That starts the backup scheduler on every page, shows service notices for a signed-in
  device, and runs the **one-time offer** "Protect your records: turn on free cloud backup".
  The offer is armed by settings `cloudOfferPending` when the first kennel is saved in the
  `required` kennel-setup modal, and shown on the reload after it. "Skip for now" also
  snoozes Today's nudge.
- **Today** has a `#today-cloud` slot. While backup is off it shows "turn on free cloud
  backup", which "Not now" snoozes for 30 days via `nudgeState.dismissedAt`. While backup is
  paused (another device, the shrink guard, an expired sign-in) it shows a Resolve link to
  the Import/Export card. Nothing shows while sample data is loaded.
- **Import/Export** has a **Cloud backup** card (`#cloud-backup`):
  - turn on (sign in → "What gets backed up" → first backup with progress);
  - a status line ("Backed up 4 minutes ago" / "Not backed up for 3 days: no internet?");
  - Back up now, and Restore as of… (pick a snapshot → per-table preview → confirm → reload);
  - turn off, sign out, sign out other devices, and delete my cloud data (typed DELETE);
    the last two, like Erase below, need a fresh sign-in (one from the last 15 minutes, or a
    code emailed now: `withFreshSignIn` in `cloudBackupUI.js`);
  - **Your devices…** (Cloud plan §2.5): every device on the account; **Erase…** (typed
    ERASE, and a fresh sign-in: one from the last 15 minutes or an emailed code), cancel a
    pending erase, and in Pro **Free its Pro license**. The Pro activation wall links to the
    same list ("Free a lost device's slot"), after a cloud sign-in;
  - a one-time "private details aren't in cloud backup" hint after a cloud restore
    (settings `cloudRestoredAt`).
  The 409 dialog offers "Restore that backup here" or "Replace it…" (typed REPLACE); the
  shrink dialog offers "Restore from backup instead" or "Upload anyway".
- **Reset App** always turns cloud backup off (`appReset.stopCloudBackupAfterReset`). When
  the device is signed in, its modal adds **"Also sign out of cloud backup on this
  device"**, ticked by default.

`showKennelSetupModal({ mode })` has two postures: **`required`** (no Skip, no Cancel, no
backdrop close, no Escape — both ambient escapes are swallowed in the capture phase; used by
all three first-run call sites) and **`cancellable`** (a Cancel that changes nothing — used
*only* by Import/Export's deliberate reopen, which edits an existing kennel).

On a non-fresh load the onboarding no-ops and `app.js` falls through to
`maybeShowKennelSetupPrompt()` (gated by `shouldRequireKennelSetup()`, which fires on every
load until an own kennel exists). `sampleDataUI.js` owns only the
persistent banner + the shared Clear-sample-data flow.

**Guided tour.** A spotlight coach-mark tour of the seeded Thornfield packet — a pure
UI/state feature that reads existing records (never writes app data) and persists its own
progress in `localStorage` via `settings.js` (`wizardStatus` + `wizardStepIndex`), no Dexie
table, no schema, no `referenceRegistry.js` entry. Three modules: **`data/wizardState.js`**
(the status/index state machine, `isTourAvailable()` gating the tour on the seed
being active, `isIntroStep()`, and the `HIGHLIGHT_STEPS` list the "Step n of N" counter uses),
**`data/wizardSteps.js`** (the static ordered full `WIZARD_STEPS` catalog — data only, like
`vocab.js`; a step may also carry `cloudBody`, shown instead of `body` when the edition has a
cloud server, as the Import/Export step does), and **`assets/wizardUI.js`** (the box-shadow spotlight overlay, the cards, the
nav "Take the tour" entry, and the free-navigation "Resume tour" pill). **Editions note:**
`wizardState.js`/`wizardUI.js` import `WIZARD_STEPS`, and `onboardingUI.js`/`app.js` import the
`seedSampleData` seed, from the **`data/editionTour.js`** injection point — not from
`wizardSteps.js`/`sampleData.js` directly — so the tour and its seed vary together per edition.
The shared copy re-exports the full catalog + Thornfield seed (Pro/Demo); Lite overlays its own
`editionTour.js` (a smaller packet sized to the 6-dog/2-litter cap, no Pro-only entities, and a
step catalog scoped to Lite's pages with `pro-promo` upsell cards). `clearSampleData()` /
`hasSampleData()` stay in `sampleData.js` — manifest-driven and generic, so one copy clears
whichever packet was seeded. The tour can also be
relaunched from the **Import / Export** page's "Guided tour" section — a button that calls
`restartWizard()` + `runWizardStep()` (its opening card is a page-agnostic intro, so it appears
in place); it and the nav entry share the `isTourAvailable()` gate, so both hide once the sample
data is cleared. The catalog has three
step **kinds** (all three are centered/single-button except the last): an **intro** step
(`kind: 'tour-intro'` or `'hub-intro'`) is a centered, page-agnostic card with a single forward
button (`step.button`, e.g. "Explore Today Hub →") — one tour-intro leads the tour, and a
hub-intro precedes each hub's stops; a **`pro-promo`** step (Lite catalog only) is the same
centered single-button card with an accent + "KennelOS Pro" eyebrow, pitching a Pro feature
(`isIntroStep()` treats it like an intro, so it renders centered and is excluded from the
"Step n of N" count); a **highlight** step (no `kind`) spotlights a real element and pins a compact card to the **top** of the
viewport, scrolling its target to sit just below so the card never covers it (a target pinned
too high on its page to clear the top card flips the card to the **bottom** of the viewport
instead; a `ResizeObserver` re-positions the target as a content-heavy page's sections load in,
so a late reflow can't leave it off-screen; and it falls back to a centered card if the target
never appears). **Both ways out of the tour** — the last step's "Finish" and the per-step
**"Skip tour"** — go through one `endTour()` helper that mirrors the "I'll explore"
onboarding ending: an acknowledgement card, then `clearSampleData()` removes the
Thornfield seed, then the kennel-setup modal in its **`required`** posture
(clearing the seed just deleted the only own kennel that existed, so there is
nothing left to file a dog under). Skipping is deliberately *not* a quiet
dismissal: leaving Thornfield in place would hand the user a kennel full of
someone else's dogs and — because sample data satisfies the setup gate — let them
start filing real dogs into a sample kennel. The clear is also retried with
`{ archiveConflicting: true }` when it comes back `contaminated`, so a record the
user made mid-tour keeps resolving instead of the promised clear silently not
happening. `app.js`'s shared `boot()` calls `runWizardStep()`
unconditionally on every page — the only wizard hook; no page file is wizard-aware.
Detail-page highlight steps carry an `anchor` slug that `wizardUI.js` resolves to the current
seed's real id at runtime via the `manifest.named` map the seed writes (the seed uses runtime
`crypto.randomUUID()` ids, so links can only resolve per-seed). See
`docs/Wizard_Runtime_Spec_v1.md` for the original design (the first-run trigger and the
intro-card / pinned-top-card presentation postdate it).

---

## 12. Service worker / PWA (`sw.js`)

App-shell cache so the app installs and works offline after first load.

- `CACHE_NAME` (currently `kennelos-shell-v49`) + a `PRECACHE_URLS` list of **every** app
  file (html/js/css/icons/vendor/resources).
- `install` precaches the list (**`cache.addAll` is atomic** — one missing/renamed file
  fails the whole install). Each file is requested with **`cache: 'reload'`**, past the
  browser's HTTP cache, so a new version can never precache a stale copy of a file the
  browser still held (it did once: the cloud go-live left a browser on the old
  `editionConfig.js` until the next bump). `activate` deletes old caches. Fetch is **cache-first** for
  same-origin GETs, with runtime caching of anything new.

**The discipline that matters:** whenever you add, rename, or remove an app file — or edit
an existing one — you must (1) update `PRECACHE_URLS` and (2) bump `CACHE_NAME`. Because
fetch is cache-first, an installed client only picks up changes when `CACHE_NAME` changes.
Forgetting to precache a new module silently breaks offline for whatever imports it.

**Bump `CACHE_NAME` ask-first, once per shippable batch — not per edit.** `PRECACHE_URLS`
always tracks the file set as you go, but the `CACHE_NAME` bump is the *last* step and is
**not** something to do unprompted: make all the edits, then **ask the user to confirm the
batch is done** before bumping. In a long multi-turn session a bump every turn just churns
through versions — so once you've bumped within a session, that pending version **stands**
for further edits in the same session (it hasn't reached clients yet, so it still represents
the new set); only re-bump after a deploy actually ships or the user asks for a fresh
rollover. See CLAUDE.md for the same rule stated as the working checklist.

There is a maintenance check for this — see §16.

---

## 13. UI layer

### The two rendering frameworks — different escaping contracts

This distinction is the single easiest thing to get wrong. Learn it:

- **`assets/reportView.js`** — columns provide `value:(r)=>string` returning **plain text**;
  the framework escapes it (`esc`) before injecting. Return raw text; do not pre-escape.
  `badge` columns render a controlled-vocab badge. Has CSV export. A column's optional
  `tone:(r)=>badgeClass|null` wraps that row's (escaped) value in a badge of a class the
  page code picks (the Shows page's amber/red "entries close"); an optional view-level
  `groupBy:(r)=>string` inserts a full-width header row whenever consecutive rows change
  group (rows keep the caller's `load()` order; CSV is unaffected).
- **`assets/listView.js`** — columns provide `cell:(r)=>htmlString` returning **HTML**; the
  framework injects it **raw**. **The caller must `esc()` every user-controlled value inside
  `cell`.** Columns can be marked `sortable: true` with a `sortFn:(a,b)=>number` comparator
  to enable click-to-sort headers. Supports filters, "show archived", collapsible columns,
  grouping, optional CSV export.

Both also take an optional **`scope: (record) => bool`** — the active-kennel predicate
(Multi-Kennel Scope Spec §7). It is applied before search/filters (so a CSV export
exports the scoped set), and its presence is what makes the toolbar render the
"🏠 <kennel> only" chip. Each caller passes the right flavor — `inScope` for a record
with its own `kennel_id`, `dogInScope` for dogs, `subjectInScope` for a polymorphic
event — or omits it **with a comment saying why** (Contacts is the standing example).

When in doubt: `value` = text (auto-escaped), `cell` = HTML (you escape).

### Shared helpers (`assets/ui.js`)

`esc(s)` (HTML-escape — use it on every interpolated user value in hand-built innerHTML),
`badge`/`badges`, `fmtDate` (YYYY-MM-DD → localized), `param(name)` (read `?id=`),
`confirmAction` (and the styled modal dialogs). `todayYMD` is re-exported here but its one
implementation lives in `data/dateUtils.js`.

### Other components

- **timeline.js** — a subject's event list with add/edit/archive/delete; spans render as a
  date range; escapes all values. Optional `onChange` runs after any add/edit/archive/delete
  so a page can redraw panels derived from the same events (`dog.js` → Show Record card).
- **pedigree.js** — derived ancestor tree from `sire_id`/`dam_id`; SVG connectors over
  positioned nodes. Bounded by a `generations` depth cap (default 3), which makes it
  cycle-safe regardless of data. Below the tree it renders a derived **Offspring** section —
  dogs whose `sire_id`/`dam_id` is the root — grouped by litter, sorted, with per-pup sex
  indicators.
- **eventForm.js** — add/edit-event modal; renders the type's `fields` into `details`,
  handles spans/reminders, persists empty optional dates as `null` (keeps them out of the
  reminder index). Supports applying one payload to multiple subjects. Also exports
  `openEventFromQuery(subjectType, subjectId, onSaved)` — since Event has no standalone page
  (polymorphic subject, §2), this is how `pages/today.js`'s Reminders and Due outs rows
  deep-link "into" an event: each row's button navigates to the subject's own page
  (`dog.html`/`pairing.html`/`litter.html`) with an extra query param, and that page's
  `main()` calls this once after loading its record. `openEvent=<id>` opens that exact event
  in edit mode; `logEvent=<event_type>` opens a fresh event of that type, optionally
  prefilled by `logDate=<YYYY-MM-DD>`, `logTitle=<text>` and `logDetails=<URL-encoded JSON
  object>` (string/number values only; malformed JSON is ignored) — used by the show-title
  nudge (§19). Wired into
  `dog.js`/`pairing.js`/`litter.js` main() alongside their `new=1` prefill params.
- **puppyForm.js**, **importView.js**, **onboardingUI.js**, **sampleDataUI.js**,
  **kennelSetupUI.js** — roster entry, the CSV dry-run/commit UI, the first-run onboarding
  card sequence, the sample-data banner, and the kennel-setup modal.
- **cloudBackupUI.js** — every cloud-backup screen (§11's "Cloud backup in the shell").
  Imported only dynamically and only when `cloudConfig.isCloudAvailable()`, by `app.js`,
  `today.js`, `import-export.js` and `onboardingUI.js`. Every value it renders goes through
  `esc()`.
- **cloudVaultUI.js** — the private vault's screens (§30). Imported only dynamically, and
  only by `cloudBackupUI.js` (so `cloudUrl: null` never loads it). The card's second line
  ("Private info: encrypted backup, 4 minutes ago" / "locked on this device" / "only on this
  device · last file backup …") is rendered by `cloudBackupUI.privateLine`.
- **contactPicker.js** — `attachNewContactButton(selectEl, {onCreated})` decorates any
  contact `<select>` with a "＋ New" button: minimal inline-create modal (name required),
  creates via `contactRepo.create`, appends+selects the option, fires a native `change`
  event. `onCreated` runs **before** that dispatch so a caller that re-renders the select
  from its own in-memory contact list (e.g. `sale.js`) sees the new contact already there.
  Wired into sale (buyer), stud-service (partner), and `eventForm.js` (boarding/placement
  related contact).
- **expensePanel.js** — the reusable per-subject expense ledger panel (§21).
- **kennelScopeUI.js** — all three pieces of active-kennel UI, reading only
  `data/kennelScope.js`: `renderKennelSwitcher(host)` (the nav's indicator + switcher),
  `mountScopeChip(el)` (the toolbar chip a scoped list/report shows, with its "Show
  all" escape), and `renderScopeNotice(host, record, {kind})` /
  `renderDogScopeNotice(host, dog)` (the out-of-scope banner on a detail page). All
  three are inert unless `editionFlags.multiKennel`, and switching scope always
  **reloads** — pages compute their view models once at load, so one repaint of the
  truth beats a partial re-render. Wired into `nav.js`, both list frameworks, and the
  six record detail pages (dog/litter/pairing/sale/contract/stud-service, each with a
  `<div id="scope-notice">` under `#page-error`).

### Navigation (`nav.js`)

Organized **by job, not by table**: seven workflow hubs in the main bar — **Today / Dogs /
Breeding / People / Placements & Contracts / Financials / Sharing** — plus a "More" corner
menu for **Reports**, **Documents**, and **Import/Export**. Financials is a first-class hub,
not a report (money is operational; Reports are analytics queries). **Sharing** is the same
Sales/Stud-Services/Contracts trick applied to a second trio: its nav path is
`pages/companion.html` (the Companion Messaging console, §20), which carries a `seg-tabs`
row to its siblings `furever.html` (§27) and `assistant.html` (the owner console, §26) — all
three are otherwise unrelated tools, just reached through one top-level tab instead of three.
Detail/edit/import pages are not nav entries; `HUB_CHILDREN` maps them to the hub tab that
should light up (`pages/companion.html` → `furever.html`/`assistant.html`, same as
`pages/sales.html` → its two siblings). Links are stored app-root-relative and prefixed at
render time so they resolve from `index.html` or `/pages/` and any GitHub Pages sub-path.

The bar also carries the **active-kennel switcher** in a `#nav-kennel-scope` slot before
the "More" menu (Multi-Kennel Scope Spec §8). `nav.js` stays edition-agnostic: it renders
the empty slot and hands it to `renderKennelSwitcher`, which returns without touching it in
Lite and before the first own kennel exists — the CSS layout rules are keyed on
`.nav-scope:not(:empty)` so an edition without a scope lays out exactly as before.

### Page catalog (`pages/`, one `.js` + `.html` each)

Hubs & landing: `today`, `dogs`, `breeding`, `contacts`, `sales`, `financials` (the
Financials hub — Overview / Income / Expenses toggle, §21), `reports`, `companion` (the
Companion Messaging console, §20), `furever` (the Furever seed-link console, §27),
`import-export`, `assistant` (the KennelAssistant owner console, §26 — distinct from the
root-level `assistant.html` the helper opens), plus root `index.html`.
Dogs: `dog` (detail — includes the Pro-only **Show Record** card, gated on
`editionFlags.shows` and rendered only once the dog has a non-archived `show` event:
per-track progress from `showPoints.js` plus a clickable show history; its "+ Add Show"
opens the event form pre-set to `show`), `roster`, `pedigree`.
Breeding: `pairings`/`pairing`, `litters`/`litter`, `active-breeding`, `live-births`.
People: `contact`, `kennels` (two screens in one page: on top the **portfolio** — one card
per own kennel with live counts (roster / active litters / placements this year) and the
button that switches the active scope, rendered only once a *second* own kennel exists;
below it the original identity CRUD list over every kennel including outside ones —
name/prefix/location/own + archive/delete, add form collapsed behind **+ Add New Kennel**,
own kennels sorted first) / `kennel` (detail — a per-kennel **hub**: roster counts by status,
active litters, recent placements, and that kennel's P&L, all filtered on THIS kennel's id
rather than the active scope, plus a "scope the app to this kennel" action; below the hub,
that kennel's Expenses ledger and, for own kennels, its program configuration: the
preferred-tests panel, the lifecycle-nudge thresholds, a doorway card into Feeding
Schedules, §27.2, and the **Waitlist settings** card (`Kennel.waitlist_config`, deep-linked
as `#waitlist-settings`, §29)). Both map to the People hub in `HUB_CHILDREN`.
Waitlist (Pro-only, §29; reached from the People page's **Waitlist** button and the
dashboard tiles, mapped to the People hub in `HUB_CHILDREN`): `waitlist` (one kennel's
list — New applications, Fee due, the ranked **On the list** table with derived `#`, and
Closed), `waitlist-entry` (one family: `?new=1` application entry, or `?id=` with the status
card + step actions, edit-in-place details, offers with their outcome buttons, and
Documents), `waitlist-programs`, `waitlist-import`, `waitlist-form` (her application form
editor + CSV question import).
Placements/contracts: `sale`/`sales`, `stud-service`/`stud-services`, `contract`/`contracts`,
`puppy-record` (print-only puppy record, §23 — not a nav entry, reached from `sale`/`sales`).
Financials print docs: `invoice` (invoice/receipt view with Download PDF, §24 — not a nav
entry, reached from the "Invoice / Receipt" generator modal — on the Financials hub and on a
Sale's page — and a waitlist family's Documents card).
Documents: `documents` (filed dog documents — local file storage, in the "More" menu and
via a "📄 Documents" button on the dog page, §26.1).
Today cluster: `dashboard`, `reminders`, `upcoming`, `board`, `scheduled-placements`.
Shows: `shows` (Pro-only — `PRO_ONLY_PAGES`, a "More" menu entry in the shared/Pro/Demo
`moreItems`, never Lite's; Show Tracking Spec §5.2). Two link-style seg-tabs
(`?tab=upcoming|results`) over `eventRepo.getByType('show')`, both `reportView`s scoped
with `subjectInScope` through the event's dog: **Upcoming** (`event_date >= today`, not
`scratched`, grouped by date; entries close = `reminder_date`, amber within 7 days, red when
past while still `planned`) and **Results** (`event_date < today`, newest first; Dog /
Organization / Period — last 12 months or a year on file — / Track filters). Rows open the
event's own edit modal in place. **+ Add entries** (Upcoming) creates one `show` event per
picked dog × picked day via `HistoryEvent.create`, sharing show name (also the title),
club, organization, location, handler, entries close and entry status; no cost field. Dogs
are scoped with a "Show dogs from all my kennels" escape (archived/deceased left out); an
entry already on file for the same dog + day + title (case-insensitive) is skipped, not
duplicated; the handler is tagged `handler` via `contactRepo.ensureType`.
Reports: `litters-report`, `stud-services-report`, `placements-report`,
`health-tests-report`, `litter-finances-report` (Litter P&L; `data/litterFinances.js`).
Import pages: `dog-import`, `contact-import`, `pairing-import`, `litter-import`,
`sale-import`, `event-import`, `stud-service-import`, `expense-import`, `kennel-tests-import`,
`waitlist-import` (Pro-only, §9/§29).
`breed-feeding-schedules` (Feeding Schedules — per-breed feeding grids, §27.2 — Pro-only,
reached from the Kennel detail page, not a nav entry).

---

## 14. Data conventions (quick reference)

- `id` = `crypto.randomUUID()`, client-side. No auto-increment.
- Soft delete only (`is_archived`). Never cascades, never destroys history.
- Date-only fields are `YYYY-MM-DD` strings compared **lexicographically**. Only
  `created_at`/`updated_at` are full ISO. "Today" is local wall-clock (`todayYMD`).
- Money is the app's native **decimal, never cents** — the shell/documents format it.
- Pickers exclude archived by default (toggle to include). Status/type = colored badges
  sourced from `vocab.js`.
- Controlled vocabularies live only in `vocab.js`; dropdowns and badges both read from it so
  they never drift.

---

## 15. Deliberately NOT built

Don't assume these exist; several are explicitly deferred "open doors":

- App-computed COI / relatedness / pairing-COI prediction (only a user-recorded
  `Dog.recorded_coi` exists).
- Genotype / Mendelian carrier-risk analysis; test-completeness audit.
- A recurrence-rule engine (recurrence = the "log the next one" workflow on the event;
  `reminder_date` is the only future-dated field).
- Photo galleries / a Photos tab / per-record image thumbnails on dogs & litters.
  (Filed documents and expense receipts **do** store files — the `files`-table PDFs
  behind Documents and `expenses.receipt_file_id`, §26.1 — and `Kennel.logo_data_url`
  is still the one inline image field, §4; there is no general per-record photo store
  beyond those.)
- Pairing/litter-subject events in the CSV importer (dog-subject only).

---

## 16. Invariants checklist (before you commit)

1. **Layering:** no page imports `db.js` or calls `db.*`; no page touches `localStorage`
   (go through a repo / `settings.js`).
2. **One canonical direction:** you added a query for a reverse relationship, not a mirror
   field.
3. **New FK ⇒ registry line** in `referenceRegistry.js`. **New field ⇒ classified** in
   `syncRegistry.js` (cloud / private / pending); `tests/syncRegistry.test.js` fails on an
   unclassified field the sample packet writes. **New direct `db` write ⇒
   `markDataChanged()`** beside it (or a reasoned exemption); `tests/cloudDirty.test.js`
   pins every write site.
4. **Escaping:** every user value in hand-built innerHTML is `esc()`'d; `listView` `cell`
   functions escape; `reportView` `value` functions return plain text.
5. **New/renamed/removed/edited app file ⇒ update `sw.js` `PRECACHE_URLS` **and** bump
   `CACHE_NAME`.** Sanity check:
   ```bash
   # from KennelOS/ — lists any app file missing from the precache, and any
   # precache entry with no file on disk. Both lists should be empty.
   python3 - <<'PY'
   import re, os
   sw = open('sw.js').read()
   urls = re.findall(r"'([^']+)'", sw.split('PRECACHE_URLS')[1].split(']')[0])
   real = [os.path.join(r,f).replace('./','') for r,_,fs in os.walk('.') for f in fs
           if f.endswith(('.js','.html','.css')) and '/vendor' not in r]
   print("missing from precache:", sorted(set(real)-set(urls)-{'sw.js'}) or "OK")
   print("listed but absent   :", [u for u in urls if u!='./' and not os.path.exists(u)] or "OK")
   PY
   ```
6. **Schema:** pre-first-release you may edit `version(1)`; after real data ships, additive
   `version(N)` blocks only, never edit a shipped block.
7. **Encoding:** source files are clean UTF-8, no BOM (matters most for files with
   user-facing strings like `csvImport.js`).
8. `node --check <file>.js` parses everything you touched (no bundler to catch it).
9. **Cloud (§30):** nothing cloud runs before `isCloudAvailable()` and a sign-in;
   `cloudUrl: null` still boots with no request and no cloud UI. A server change is a new
   numbered migration (never an edit to an applied one) and `cd cloud && npm test` passes.

---

## 17. Local development

```bash
cd KennelOS
python3 -m http.server 8000      # or: npx serve
# open http://localhost:8000/  — never file://
```

There is no build, no test runner, and no linter wired in. Verification is: `node --check`
for syntax, serving locally and exercising the flow in a browser, and the precache sanity
check above. State resets via **Reset App to Start** (or clearing site data); sample data is
seeded by taking the first-run **guided tour** ("Show me around!"), or restored from a JSON
backup via Import/Export.

---

## 18. Common maintenance recipes

**Add a field to an existing entity** — add it to the entity's form/detail page and (if
you'll query/filter/sort on it) to that table's index string in `db.js`. Plain persisted
fields need no schema change. Add validation to the repo only if it's a hard rule. If it's
an FK, add a `referenceRegistry.js` line. Update CSV mapping + sample data if relevant.

**Add an event type** — add one entry to `EVENT_TYPES` in `vocab.js` (`value`, `label`,
`badge`, `subjects`, `duration`, `fields`, and `relatedContact` if it needs a contact FK).
The event form, timeline, badges, and (for dog-subject types) the event importer pick it up
automatically.

**Add a report** — build a page that loads records and calls `createReportView` with
`columns` (`value` returns text), `filters`, `search`, and `csvFilename`; link it from
`pages/reports.html`. Add the new page to `sw.js` (recipe §16.5).

**Add a new entity** — new `db.js` table (new version block if post-release), new
`<entity>Repo.js` via `makeRepo` with a validator, a `referenceRegistry.js` array (and lines
wherever it's referenced), list/detail pages, a CSV mapping if it imports, nav wiring if it
deserves a hub, sample-data coverage, and `sw.js` precache entries. Build order: schema →
repo → list/detail → events/relationships → completeness features.

**Add a new page** — always finish by adding it to `sw.js` `PRECACHE_URLS` and bumping
`CACHE_NAME`, or it won't work offline.

---

## 19. Derived nudges & the away-board union

Two small `data/` modules sit on top of the repos as pure composition — neither owns storage
beyond the one localStorage ledger below.

**`data/nudges.js`** — `computeNudges()` reads current record state ONLY (no ledger
awareness) and returns zero or more:
```
{ key, title, detail, subjectHref, actions: [{ label, run: async () => {} }] }
```
Every rule iterates the **active-kennel-scoped** set of whatever it nudges about (spec
§7) — you should not be prompted about the kennel you are not looking at. The unscoped
originals stay in play for every lookup and every "already handled?" dedup check
(`pairingExistsForDam`, `pairingIdsWithLitter`, the pups/sales indexes). That asymmetry
is deliberate: scoping a dedup check would resurrect a nudge whose answer already sits
one kennel over.

Nine rules (plus the four waitlist rules below), each producing its own stable `key` so a dismissal survives re-computation:
- **Stud-service status** — `sent_date` passed + `status='arranged'` → suggest
  `in_progress`; `returned_date` passed + `status ∈ {arranged, in_progress}` → suggest
  `completed` (never both; completed wins if both hold).
- **Promote-lifecycle** — opt-in per kennel (`Kennel.promote_nudge_enabled`): a
  `status='puppy'`, `disposition='keeping'` dog past its kennel's
  `promote_age_male_months`/`promote_age_female_months` (by sex) gets a "promote to active
  breeding?" suggestion. No kennel, disabled, or non-`keeping` disposition ⇒ silent —
  decide-not-auto-promote, never a mutation on its own.
- **Stud → pairing** — a stud service that's `completed` or overdue-returned with no
  `pairing_id` yet suggests creating one, deep-linking to
  `pairing.html?new=1&stud_service=<id>`. Auto-dismisses: once `pairing_id` is set the rule
  produces nothing — the link is the done-signal, no ledger entry needed.
- **Heat → pairing** — a concluded `heat_cycle` event (`event_end_date < today`) with no
  live pairing recorded for that dam since the heat started suggests creating one via
  `pairing.html?new=1&dam=<dogId>`.
- **Overdue pairing** — a pairing in a pre-whelp status
  (`planned`/`bred`/`confirmed_pregnant`) whose `expected_due_date` has passed, with no
  litter recorded against it (`litterRepo.getForPairing`), suggests either fix: mark the
  pairing `whelped` directly, or deep-link to `litter.html?new=1&pairing=<id>`.
- **Litter → sold** — a non-archived `ready` litter whose whole roster is resolved to
  `placed`/`keeping`, with **at least one** actually `placed` (an all-`keeping` litter sold
  nothing, so it never fires), suggests marking the litter `sold`.
- **Litter → reopen** — a `sold` or `closed` litter with any puppy back to `available`
  suggests reopening it to `ready`.
- **Litter → close** — a `sold` litter with no `available` puppy where **every** `placed`
  puppy has a `delivered` sale suggests marking it `closed`. A placed puppy with no delivered
  sale — including one with no sale row at all — blocks the nudge.
- **Show track complete → title** (Pro-only, gated on `editionFlags.shows`; Show Tracking
  Spec §5.4) — for each in-scope dog, `showPoints.showRecordFrom` over its `show` +
  `title_earned` events; a `TITLE_TRACKS` row whose progress is `complete` with **no**
  `title_earned` carrying `title_abbreviation = track.title` suggests logging it. Key
  `show-title:<dogId>:<track>`. The action deep-links to
  `dog.html?id=…&logEvent=title_earned&logTitle=<track label>&logDetails=<JSON
  {title_abbreviation, organization}>&logDate=<completedOn>` — a prefilled event form,
  never an auto-created title. Auto-dismisses once the `title_earned` event exists (the
  event is the done-signal).
- **Waitlist** (Pro-only, gated on `editionFlags.waitlist`; Waitlist Spec §6.5, §29) — four
  rules over the scoped `waitlist_entries`/`waitlist_offers`, each a one-tap suggestion
  because W1 has no server and nothing moves on its own: **new applications** (one per
  kennel queue, key `waitlist-applications:<kennelId>:<newestEntryId>` so a new
  application resurfaces a dismissed batch; action deep-links to the Waitlist page);
  **offer deadline passed** (`waitlist-offer-overdue:<offerId>`, action records
  `no_response` via `waitlistActions.recordOutcome`, which also moves the turn on; on an offer
  whose family picked a pup it reads **deposit didn't arrive / Record no deposit** and the held
  Sale is cancelled);
  **fee past its pay-by date** (`waitlist-fee-overdue:<entryId>`, action closes the
  application as `expired`); and **second-pass removal** while its 7-day undo lasts
  (`waitlist-removed:<entryId>:<removed_date>`, action `undoRemoval`). Each auto-dismisses
  when its condition clears.

The three litter-lifecycle rules are aggregate facts over a litter's derived roster (and, for
close, its sales), so `computeNudges()` groups the already-loaded `dogRepo.getAll()` result by
`litter_id` in one pass and adds `saleRepo.getAll()` to its parallel load rather than
re-scanning per record. Their actions mutate only `Litter.status` via `litterRepo.update`;
nothing auto-mutates. The stud→pairing and heat→pairing rules share one dedup helper
(`pairingExistsForDam`): a pairing counts as "already handled" if it's for the same dam, not
`cancelled`/`failed`, and opened (`planned_date`, falling back to `created_at`) on or after
the window in question.

**`data/nudgeState.js`** — the dismissal ledger (§11): `isDismissed`, `dismiss`, `clearAll`.
A computed nudge has no backing row to persist "dismissed" on, so dismissal is device-local UI
state, deliberately kept **out of** JSON backups.

**Today's "Upcoming shows" card** (`renderShows`, Pro-only via `editionFlags.shows`; Show
Tracking Spec §5.3): `show` events in the next 14 days, not `scratched`, grouped by date —
dog · show · status badge, then location · handler · ring · ring time, each row deep-linking
`openEvent=<id>`. Silent when empty. While the flag is on, `today.js` filters `event_type ===
'show'` **out** of the rows it passes to the "Due outs & upcoming" card, so a show is listed
once on Today; the filter lives in `today.js`, not `getUpcoming()`, so the Upcoming page still
lists shows. Entries-close alerts are ordinary reminders (`reminder_date`) — no new code.

**Rendering (`pages/today.js`)** owns the split: it calls `computeNudges()`, filters out
`isDismissed(key)` itself, renders what's left in a "Nudges" section (above Reminders), wires
each nudge's own action button(s), and adds one generic "Dismiss" button per row — the same
mechanism for every nudge, owned by the renderer.

**`data/awayBoard.js`** — `getAwayBoardRows()` unions two sources into one normalized
view-model (`{ dogId, location, reason, contactId, outDate, returnDate, dropoffTime,
pickupTime, sourceType, sourceId, href }`): `eventRepo.getBoardRows()` (boarding events) plus
`studServiceRepo.getBoardRows()` (stud services where `type='in_person'` and today falls in
`[sent_date, returned_date]`, open-ended if `returned_date` is null; away dog is always
`our_dog_id`; location resolves from the partner contact's `address`). Consumed by
`pages/board.js`, `pages/today.js` (`renderBoard`), and `pages/dashboard.js` (the away-count
tile). Boarding events still cover non-stud reasons (grow-out, foster, owner travel); a
stud-reason stay is authored on the StudService record itself, not duplicated as a boarding
event.

Active-kennel scope is applied **inside** `getAwayBoardRows()`, not in the three renderers,
so board/today/dashboard cannot disagree about who is away. Both row kinds normalize to a
`dogId` and the dog is what is physically away, so both scope through that dog (transparent
flavor — an outside stud boarding with you belongs to no kennel of yours and must not
vanish). It costs one extra `dogRepo` read, and only when there IS a scope.

`StudService.type` and the three `Kennel` nudge fields are plain unindexed fields (§5); the
stud→pairing nudge action reuses the existing `StudService.pairing_id` link. No schema, index,
or reference-registry change.

---

## 20. Companion share-out (buyers & partners)

A **one-way, point-in-time export** of a curated slice of a recipient's own data, delivered as
a **no-account, read-only link** — not sync, not a login, not a live view. The main app stays
single-user/offline/all-local; this adds *recipients*.

### What it is

**Three bundle types**, all **anchored on a Contact** (the recipient) and discriminated by
`bundleType`:

- **`prospective`** — a prospective family (a client/waitlister with no sale): current
  availability as **one card per litter with its available pups nested inside** (`litters[]`,
  each with `nickname`, `breed`, `whelpDate`, `acceptDepositsDate` (from
  `Litter.accept_deposits_date`, rendered between "Born" and "Estimated ready" only when
  set), `readyDate`, a `dogCard` for `sire`/`dam`, and `pups[]`). Each pup carries `sex`,
  `callName`, `markings`, and its **sex-keyed list `price` + `deposit`**
  (`Litter.expected_price_*`/`expected_deposit_*`). The availability is the same for every
  prospect — **no per-recipient private data**.
- **`family`** — a current family (a buyer with an **open** sale per `saleRepo.isOpenSale`):
  **one rich card per placed pup** (`pups[]`, from `saleRepo.getByBuyer` filtered by
  `isOpenSale` → dog — terminal sales `delivered`/`returned`/`cancelled` never appear,
  matching membership). Each pup carries `callName`, `sex`, `photosUrl` (`Dog.url`),
  `litterNickname` (when set), `sire`/`dam` (call + registered name), a **computed `age`
  `{ageWeeks, ageDays}`** as-of the generation date (**never the raw DOB**), a `placement`
  block or an `estimatedReadyDate`, sale facts (`placementType`/`saleStatus` sent as raw
  values, the shell maps them to their proper-cased vocab labels; `price`, `deposit`,
  `transportFee` (shown only when present), `deferredPickup` (shown only when a
  `deferred_boarding_amount` is present — `{total, amount, frequency, duration}`, where
  `total = amount × count`; the shell shows the total with the rate breakdown beneath it), a
  **computed** `remainingBalance` = `price + transportFee + deferredPickup.total − deposit`
  (absent parts count as 0; never stored), and `balanceDueDate` (`Sale.balance_due_date`)),
  and an `eventSections[]` **curated per-type event history**. When the sale carries a
  **complete** deferred pickup (amount + frequency + duration) a `deferred_pickup_boarding`
  section is **pinned to the top** of `eventSections`, listing the dog's `boarding` events as
  `{startDate, endDate}` scheduled ranges (only the two dates copied — never boarding notes).
  Plus top-level `contracts[]` = the sale's non-archived contracts as `{signedDate,
  documentUrl}` (shell shows the signed date or "Not Signed" + a "View/sign contract here"
  link). Event history
  surfaces a **title + one curated safe field per type** — `vaccination`→`vaccine`,
  `preventative`→`product`, `weight_check`→weight, `milestone`→`description`, `note`→title
  only — **never** the freeform top-level `notes`, and **never** illness/injury/evaluation or
  any type not on that list.
- **`partner`** — a stud/lease/co-own partner: `studServices` (labeled **Stud/Dam `dogCard`
  blocks** carrying registered/call name + completed tests, each followed by an **Agreement
  Details** section — the service `type` (`in_person`/`ai`, proper-cased), `sentDate`/
  `returnedDate` relabeled **Begins/Ends**, `fee_structure` as **Terms**, plus the
  native-decimal `fee_amount` when the structure includes a flat fee and the `pick_status`
  when it includes a pick of litter — and a **Contract** section carrying the service's own
  governing/most-recent contract as `contract` = `{signedDate, documentUrl}`), and the
  top-level `contracts` (lease/co_own/other contracts where `related_contact_id` = them). Each
  is **projected per type** by `projectContract()`: all carry `type`, `title`, `status`,
  `signedDate` (shown "Not Signed" when null), `terms`, and `document_url`; a **`lease`** also
  carries `startDate`/`endDate` and `dog` (the leased dog as `dogRef` = `{registeredName,
  callName}`); a **`co_own`** also carries `dog`. The shell titles the card by type when it
  holds a single type ("Lease agreement" / "Co-ownership"), else "Contracts". These are
  reduced to the **live contract per distinct agreement, not the full history**: only
  `contractRepo.isLivePartnerContract(c, today)` contracts survive, grouped by
  `(contract_type, related_dog_id)`, and each group collapses to `governingContract()` (most
  recent signed) or the most-recent-by-`created_at` fallback. The **same
  `isLivePartnerContract` predicate drives partner membership** in `companion.js`, so who
  appears and what their bundle shows can't drift.
- **`dogCard` / completed tests** (shared projection): prospective sire/dam and partner
  stud/dam use `dogCard(dog)` → `{registeredName, callName, photosUrl, tests}`, where `tests`
  is `completedTests(dogId)` reading `eventRepo.getForSubject('dog', …)` and projecting
  `breed_specific_test` (`test_name`:`result`), `ofa_pennhip` (`joint`:`rating`), and
  `genetic_test` (`panel_name`:`result`) **only when the result/rating is non-empty** (else
  `[]`, block omitted).

### Console — one package type at a time

The **Companion Messaging console** (`pages/companion.*`, the Sharing nav item's landing
page) is scoped by
`?type=` seg-tabs — one per `COMPANION_TYPES` value (Prospective families / Current families /
Partners), the same URL-param tab pattern as the Contacts group tabs; no param defaults to the
first type. The active tab drives the whole page: the single template card shown, a
plain-language **filter blurb** above it, the **recipients list** (only contacts that match
the type), and the bundle type "Prepare link" builds (there is no per-row type picker — the
tab **is** the type).

Each recipient row is **collapsed by default** to a one-line header (name + a `note` badge
when `companion_note` is set + email/phone); clicking the header reveals the note editor, Save
note / Preview / Prepare link actions, and the built link. **Preview** builds the same bundle
"Prepare link" would (persisting any unsaved note first) and opens a modal showing the channel
body text plus the real `companion-view.html` shell loaded in an iframe off that bundle's hash
— a byte-for-byte render of what the recipient will see, sending nothing. Both actions share
`buildSendArtifacts`, so the preview can never drift from the send.

**Membership predicates** (`companion.js`): a **prospective** is a Contact with
`waitlist_status === 'active'`; a **family** is a buyer with an **open** sale per
`saleRepo.isOpenSale(s)`; a **partner** is a Contact who is the `partner_contact_id` on a
non-archived StudService whose `returned_date` is empty or `>= today`, **or** the
`related_contact_id` on a `lease`/`co_own`/`other` contract that is live per
`contractRepo.isLivePartnerContract(c, today)`. A Contact can appear under more than one tab —
that's expected. The prospective filter is display-only, but the **family** and **partner**
predicates are shared with the bundle builder, so membership and bundle contents stay in
lockstep.

### Two-layer messaging

Layer 1 is per-type config (`kennelName`/`tagline`/`introText`/`announcement`/`closer`, plus
the `include` component map — below) in `settings.js` under the `companion` key, edited in the
console's template card. Layer 2 is **`Contact.companion_note`**, a per-recipient personal
line. Both are carried in the bundle **separately** — `announcement` (broadcast) and
`personalNote` (the note) — and the shell shows them **alongside each other**. The shell
**prepends the recipient's name** to the intro text ("Hi {name} — …"; there is no separate
greeting card), renders the personal note in the header card's accent box, the broadcast
announcement as its own card beneath, and the `closer` sign-off as the final card **just above
the snapshot date**. The bundle copies the resolved copy inline, so header/landing text updates
without a shell deploy.

### Per-type component allow-list (`include`)

A third piece of Layer-1 config: a flat map of boolean flags, one set per bundle type, stored
under `companion[type].include` and edited as the "What to include" checkboxes in each template
card. **All flags default `true`** — everything shows — and `getCompanionSettings` deep-merges
the map over the defaults so a flag the owner never set (or one added in a later version) falls
back to on, never silently hiding a component. Each builder reads its type's `include` and
**only ever subtracts**: a disabled component's field is emitted `null`/`''`/`[]` (or the
section is skipped), never a new key — so the allow-list invariant below is untouched and no
`COMPANION_BUNDLE_VERSION` bump is needed. **Master/child flags:** a master gates a group
(`parents`, `pricing`, `studServices`) and the builder ANDs each child with its master, so a
child only emits when both are on; the console greys out a child whose master is unchecked.

The flags, by type:
- **prospective:** `parents` (→ `parentRegisteredName`, `parentCallName`, `parentPhotos`,
  `parentTests`), `pricing` (→ `pricingPrice`, `pricingDeposit`), `litterDates` (born /
  accept-deposits / estimated-ready), `markings`, `fosterOwnerKennel` (the litter card's
  `breederKennel` — the foster dam's **owner kennel**, §25; emitted only for a foster litter,
  empty for every ordinary litter regardless of the flag). When every `dogCard` field is off the
  card is omitted entirely; when no pup carries a price/deposit the shell drops the deposit
  disclaimer.
- **family:** `age`, `parentage`, `photos`, `readyPlacement`, `financials` (price, deposit,
  transport, deferred-pickup, remaining balance — net of a credited waitlist application fee,
  §21 — balance-due — **not** placement type / sale
  status, which always show), the five history flags `histVaccination`/`histPreventative`/
  `histWeight`/`histMilestone`/`histNote`, `histBoarding` (deferred-pickup boarding section),
  `contract`, `fosterOwnerKennel` (the pup card's `breederKennel` — the owner kennel of a
  pup that came from a foster litter, §25; empty otherwise).
- **partner:** `studServices` (master → `studRegisteredName`, `studCallName`, `studPhotos`,
  `studTests` for the Stud/Dam cards, plus `studAgreement` for the Agreement Details/
  compensation and `studContract` for the per-service contract), and top-level `contracts`
  (lease / co-own / other).

### The load-bearing invariant: the allow-list builder

`data/companionExport.js` is the **security spine**. `importExport.js` deliberately iterates
whatever tables exist (a full backup); this builder does the **exact opposite**:
`buildProspectiveBundle`/`buildFamilyBundle`/`buildPartnerBundle(contact)` each **construct a
fresh object naming every field explicitly**, reading through repos (never `db.*`), copying
**only** listed fields — **no record spread, no filter-over-a-record**. After building,
`assertOnlyKeys()` runs a **positive** allow-list check and **aborts the send** if any
unexpected top-level key is present. A new field added to a source table does **not** appear in
a bundle until someone adds it here by name — including fields nested inside a pup/litter/
service, safe only because each is copied by name and the **top-level** `*_KEYS` allow-lists
stay exact. Money is limited to the recipient's **own** figures: a prospect sees the litter's
per-sex list price/deposit, a family sees their own sale price/deposit/balance, a partner sees
the one stud `fee_amount`.

### Transport & the shell

- The bundle rides the **URL fragment**: `JSON.stringify` → **lz-string**
  (`vendor/lz-string.min.mjs`, vendored + version-locked, v1.5.0) →
  `companion-view.html#<hash>`. Send is a **real `sms:`/`mailto:` anchor** the user taps (their
  tap is the activating gesture — never a post-async `window.location` assignment). **Channel
  by size:** email is the default; SMS is blocked above `MAX_SMS_HASH_LEN` and steered to
  email; email warns above `MAX_EMAIL_HASH_LEN` (the console's `prepareLink`).
- **`companion-view.html`** is the recipient shell — one self-contained, read-only static file
  at the app root (inlined, version-locked lz-string; branches on `bundleType` and
  `bundleVersion`; **tolerates additive fields**; theme-aware; shows a prominent "snapshot as
  of" line). It is **infrastructure**: it must stay **backward-compatible with every
  `bundleVersion` ever sent** — bundle evolution is additive, `bundleVersion` bumps only on a
  breaking shape change, and a shell fix must not break links sent last month.

### No revocation / no expiry

A hash-link, once sent, is permanent. The sensitive document is **never in the hash** — only
`document_url`, a pointer; access is governed by the owner's Drive sharing, which they revoke
independently. `updatedAt` renders prominently so a stale link is self-evident.

### Model touch-points (all covered in §4/§5/§7)

`Contract.related_contact_id` (indexed FK, `CONTACT_REFERENCES`, `getByContact`),
`Contract.document_url`, `StudService.pick_status`, `Contact.companion_note` — the last three
plain/unindexed. `companionExport.js` and the console/shell are pure composition + projection;
no two-way pointers, every reverse stays a query.

---

## 21. Financials — income & the Expense ledger

The Financials hub has **three views**, switched by a top toggle
(`financials.html?view=overview|income|expenses`; a bare URL opens Overview, a `?bucket=` link
still opens Expenses):

- **Expenses** — the Expense ledger (money spent).
- **Income** — a **derived** view of money coming in, sectioned earned vs anticipated.
- **Overview** — Earned income / Anticipated income / Total expenses / **Net (earned − spent)**
  tiles, plus a component breakdown of income beside a category breakdown of expenses.

### The Expense ledger (money spent)

The single home for money spent. One `expenses` table (§4/§5), polymorphic like Event:
`subject_type ∈ {dog, litter, pairing, kennel}` + `subject_id`. Kennel-wide overhead (facility,
bulk food, registration dues, marketing) lives on `subject_type='kennel'`; there is deliberately
**no `general` subject** — program overhead is logged against your own kennel, so there is never
a null `subject_id`. Revenue is **not stored** here (it stays on `Sale.price`/`deposit_amount`
and `StudService.fee_amount`); this table is costs only.

**Foster compensation & reimbursables (§25).** A foster litter needs no new income
machinery: whoever holds the puppies books the gross Sales, and the **other party's cut is a
real Expense** — the `foster_split` category ("Foster compensation", whether the terms are a %
split or a flat per-pup fee) — so it flows into the
Litter P&L as cost like any other spend. Owner-reimbursable rearing costs use the ledger's
`reimbursable`/`reimbursed_date` fields: `litterFinances.js` **excludes a reimbursed
reimbursable from your cost** (it washes out — someone paid you back) and tallies a
**still-pending** one as an outstanding receivable (`reimbursablePending`, the report's "Owed
back" column) while leaving it in cost until settled.

The ledger has a **CSV import path** (the `expense` mapping in `csvImport.js`, reached from
Import/Export → "Import expenses (CSV)"), so a companion receipts/mileage app — or any
spreadsheet — can feed it with the standard dry-run + match-or-create preview. See §9 for the
mapping (columns, subject resolution, mileage derivation, idempotent natural key). No photo
crosses over on import — to attach a receipt image to a ledger row, use the in-app receipt
capture on the expense form (§26.1).

### Mileage / transport costs

A cost you drive for (vet runs, delivering a puppy, hauling a dam to a stud) is captured as a
**mileage expense** — a normal ledger row whose dollar `amount` is **derived** from distance,
not typed. The add-expense form (both `assets/expensePanel.js` on every subject page and the
Financials hub's own modal in `financials.js`) carries a **Flat amount ↔ Mileage** toggle:
Mileage mode swaps the Amount box for **Miles** + **Rate / mile** (the rate prefilled from
`settings.getMileageDefaults()`, with a "Save this rate as my default" opt-in via
`setMileageDefaults`), shows a live `= $X (N mi × $R/mi)` preview, and locks the category to the
dedicated **`mileage`** ("Mileage / travel") `EXPENSE_CATEGORIES` value.

The math is a **repo rule, not a UI one**: `expenseRepo.normalize` computes `amount =
round(miles × mileage_rate, 2)` whenever `miles` is set (and stores `miles`/`mileage_rate` as
plain unindexed fields), so the amount is authoritative regardless of which modal — or a future
CSV/import — writes it; `validateExpense` requires a non-negative rate on any mileage entry, and
`create` normalizes **before** validating so the derived amount exists to check. A flat expense
leaves both fields null and keeps its entered amount. The pure helper `mileageAmount(miles,
rate)` is exported for the form's live preview so preview and stored value can't drift. Because
`mileage` is a real category, driving costs break out on their own Expenses seg-tab and in the
Overview category breakdown automatically (the seg-tabs are built from the vocab, never
hand-listed) — a clean deductible-mileage total. The two form modals share
`buildMileageFields`/`wireMileageMode` (exported from `expensePanel.js`) so they never diverge.
No new table, index, FK, or `referenceRegistry` entry — the fields are plain and the amount is
derived.

Buying a new dog is deliberately an **expense, never a Sale** — `Sale` and `StudService` stay
strictly income-side records (owner decision). `EXPENSE_CATEGORIES` carries a `dog_purchase`
("New dog purchase") category; the dog's own `acquisition` event type (dog-subject, instant,
`source` field for the seller) is an **option** on that dog's timeline, never auto-created, and
its default Cost category (`defaultExpenseCategoryFor`) is `dog_purchase` — logging one with a
Cost amount upserts the linked `Expense` the normal event↔cost way.

### The event↔cost link (one canonical direction)

`Expense.event_id` is the **only** stored link between an event and its cost:

- **Event form → ledger.** The event form's "Cost" (+ "Cost category") field is a convenience
  writer: on save (`assets/eventForm.js`) it upserts an `Expense` carrying `event_id` = the
  saved event and the event's own subject; clearing the Cost hard-deletes that linked expense.
  Cascade (litter-wide) events create one linked expense per created event. One expense per
  event is the **form's** limit, not the data model's — `expenses.event_id` allows several
  and `expenseRepo.getByEvent` returns them all. Event stores **no
  `cost` field**. The Cost category dropdown pre-selects `defaultExpenseCategoryFor(event_type)`
  (overridable before save). `veterinary` is reserved for genuine clinical vet care
  (`vaccination`, `illness`, `injury`, `surgery`, `vet_visit`, `ultrasound`) — **not** a catch-all;
  diagnostic panels (`genetic_test`/`ofa_pennhip`/`breed_specific_test`/`progesterone_test`) map to
  `testing`, `boarding`→`boarding`, `show`→`show` ("Shows & handling"), `acquisition`→`dog_purchase`, and everything else (including
  stockable products like `medication`/`preventative` and observation-only events like
  `abnormalities`) falls through to `other`.
- **Ledger → event (display).** `timeline.js` reads amounts back via `expenseRepo.getByEvent`
  and shows a `🔗 event` tag on linked ledger rows.
- **Ledger → event (create).** In `assets/expensePanel.js`, a dog/litter/pairing expense with
  no `event_id` offers "Log event →": it opens the event form for that subject and, on save,
  back-fills the new event's id onto the expense. No mirror field — the reverse is always the
  `getByEvent` query.

### Income (derived — `data/incomeView.js`)

There is **no income table and no `is_earned` field.** `data/incomeView.js` is a read-only
aggregator: it reads the Sale table and the **outgoing** StudService table — the only two places
money-in is recorded — and normalizes each into one view-model row per record, classifying every
money component as **earned** or **anticipated** on each load. Storing this (or a mirror flag)
would be a forbidden stored back-pointer (§7); it is always recomputed.

Active-kennel scope is applied here at the **source records**, so the Financials Overview
tiles, the Income view, the per-litter P&L, and the invoice/receipt generator's record
picker can never disagree about which money is yours right now. `getIncomeRows()` also
takes an optional `kennelId`, which overrides the active scope with one named kennel — the
per-kennel hub (`kennel.html`) needs it, because it reports on the kennel you opened rather
than the kennel you are scoped to. The Expense side is scoped separately in
`pages/financials.js` (`expenseInScope`): an Expense is polymorphic and carries no
`kennel_id`, so its scope is resolved through its subject.

Classification (owner decisions):

- **Sale.** `price` splits into a deposit portion (`deposit_amount`) and a balance portion
  (`price − deposit`); `transport_fee` and deferred-pickup boarding (`deferred_boarding_amount ×
  count`, the count in `deferred_boarding_duration_days`) ride with the balance. A component is
  **earned** once its paid-date is recorded (`deposit_date` / `balance_paid_date`) or the status
  has advanced past it (`deposit_paid`/`paid_in_full`/`delivered`), else **anticipated**. On a
  **returned/cancelled** sale only amounts already recorded as paid survive (as earned); the
  unpaid remainder is dropped, never anticipated. A part-paid open sale therefore appears in
  **both** the Earned and Anticipated boxes, each with its own portion.
- **StudService (outgoing only** — incoming is money *we* pay, an expense). `fee_amount` is
  **earned** when `completed`, **anticipated** while `arranged`/`in_progress`, dropped when
  `failed`/`cancelled`. `pick_value_amount` is a **non-cash estimate**, surfaced on its own
  `pick` line and kept **out** of the earned/anticipated cash totals and the Net figure.

- **Waitlist application fee** (Pro-only, `editionFlags.waitlist`; Waitlist Spec §5.3) — the
  third source, read from `waitlist_entries`: an entry with `fee_received_date` and a
  `fee_amount` above 0 is one row (`source_type: 'waitlist'`, component `application_fee`),
  always **earned**, scoped by the entry's `kennel_id`. A waived (0) or unpaid fee is no row.
  Refunds aren't tracked in W1. **Credit to purchase:** when the entry's
  `fee_credit_policy` is `credited_to_purchase` and it's `placed` (`placed_sale_id`), the fee
  was paid toward that pup's price, so `saleComponents(sale, feeCredit)` takes it off the
  Sale's **balance** (never below 0) — otherwise the money would count twice — and the fee
  row carries the pup's `dog_id`/`litter_id` so the Litter P&L (`litterFinances.js`, which
  now sums `sale` **and** litter-scoped `waitlist` rows, counting only sales as pups sold)
  keeps the full price. `getSaleFeeCredit(saleId)` exposes the credit: the invoice page and
  the generator pass it to `incomeLineItems(…, { feeCredit })`, and the invoice's balance
  line reads "Remaining Purchase Price (after $X application fee credit)"; the family
  Companion bundle's computed remaining balance subtracts it too (§20). A waitlist row in the
  Income boxes opens the family's waitlist entry instead of the Adjust modal; the generator
  never lists waitlist rows.

Vocabs (`vocab.js`): `INCOME_STATES` (earned/anticipated badges), `INCOME_SOURCE_TYPES`
(sale/stud/waitlist badges — the Source filter drops `waitlist` where the flag is off),
`INCOME_COMPONENTS` (deposit/balance/transport/boarding/stud_fee/pick/application_fee — the
summary's per-component breakdown, mirroring the expense category one).

Income surfaces (`pages/financials.js`): the Income view shows a summary card
(earned/anticipated totals + component breakdown) then **two grouped boxes** — **Earned** and
**Anticipated** — each a `reportView` table (one row per sale/stud, source/year filters, CSV
export). Clicking a row opens a compact **Adjust** modal that writes the money/status/paid-date
fields straight back through `saleRepo.update` / `studServiceRepo.update` (with an **Open full
record →** link), so an anticipated amount can be flipped to earned from the hub. No new FK,
table, or `referenceRegistry` entry — income is purely derived.

**Per-litter income** (sales reach a litter via the puppy's `dog.litter_id`): the **Litter
detail page** has a deliberately simple "Sales & Income" panel — each puppy sale's **total
value** (`price + transport + deferred boarding`) and status, with a total, and **no**
earned/anticipated split or net (owner decision — that detail lives only on the report). The
**Litter P&L report** (`litter-finances-report`, `data/litterFinances.js`) is the full picture:
earned/anticipated income vs the litter's own expenses **plus** each puppy's dog-subject
expenses, and the net.

### Surfaces

- **`assets/expensePanel.js`** — the reusable per-subject ledger panel (running total,
  add/edit/archive/delete, its own add-expense modal). Mounted on the dog, litter, pairing, and
  **kennel** detail pages (the last via `pages/kennel.*`, reached from the Kennels list's
  "Open →").
- **`pages/financials.*`** — the **Financials hub** (its own top-level nav tab, not a report),
  with the **Overview / Income / Expenses** top toggle. The **"+ Add Expense"** button (logs a
  cost against any dog / litter / pairing / kennel) shows only on the Expenses view.
  - **Expenses view:** a summary card (grand total + per-category breakdown) over the standard
    `reportView` ledger table (category/subject-type/year filters + CSV export). **Sectioned by
    category:** a `seg-tabs` row built from `EXPENSE_CATEGORIES` (never hand-listed), one tab per
    category via `financials.html?view=expenses&bucket=<value>` pre-filtering the loaded ledger,
    plus **All** (default, no `bucket`). The ledger loads newest-to-oldest by `expense_date`
    before any bucket filter.
  - **Income view:** summary card + two grouped Earned/Anticipated `reportView` boxes with the
    row-level Adjust modal.
  - **Overview view:** the Net tiles + income/expense breakdown.

### Safety

- **Companion export is safe by construction** — `companionExport.js` is a positive allow-list
  (§20), so `expenses` never appears in any bundle. Financials do not leak.
- **Hard-delete guards** (§7): an event with a linked expense, and a subject with any expense,
  are archive-only until the expense is removed.

---

## 22. Referral tracking (Sale / StudService "Referred by")

`Sale.referred_by_contact_id` and `StudService.referred_by_contact_id` are indexed FKs → Contact
(§4/§5), guarded in `CONTACT_REFERENCES`. Each page's form has a "Referred by" picker (any
contact; the stud page uses a general picker, not its breeder-only partner one). On save the repo
calls `contactRepo.ensureType` to auto-tag the referrer with the `buyer_referrer` /
`stud_referrer` role (`CONTACT_TYPE` vocab). The tag is a convenience label; the canonical link
stays the FK on the Sale/StudService, and a contact's referrals are the reverse query over the
indexed FK.

---

## 23. Puppy Record (print-only PDF)

`pages/puppy-record.html`/`.js` (`?sale=<id>`) is a printable, one-page-style record for a puppy
being sold: puppy info, sire/dam (with their genetic + breed-specific test results as a
pipe-separated line), a **Health History** grid — one card per health-relevant event type
(`vaccination`, `preventative`, `genetic_test`, `ofa_pennhip`, `breed_specific_test`, `illness`,
`medication`, `surgery`, `vet_visit`, `injury`, `abnormalities`, `weight_check` — deliberately
excludes admin/lifecycle types like `milestone`/`placement`/`note`) — and the buyer's contact
info off the Sale. Every row is omitted (not shown as a blank/"—") when its field is empty. Reads
only, through `saleRepo`/`dogRepo`/`contactRepo`/`litterRepo`/`eventRepo` (layering rule, §2) — no
new repo or table.

**"Download" is the browser's own Print → Save as PDF** (`window.print()`, gated by an `@media
print` block that hides nav/back/print-button), not a vendored PDF library. Entry points: a
"Puppy Record (PDF)" button on `sale.js`'s header actions, and a "Print Puppy Record" button on
`sales.js` that opens a modal — a dropdown of every **non-delivered** sale (`status !==
'delivered'`), ordered by dog name, buyer name shown alongside for disambiguation — whose Print
button opens the record in a new tab with `?autoprint=1`, which triggers `window.print()` itself
once rendered.

The header also renders the resolving own-kennel's `logo_data_url` (§24) above the kennel name
when one is set.

**Own-kennel resolution** (Multi-Kennel Scope Spec §10): the puppy's own `kennel_id`, else the
active kennel scope (`data/kennelScope.js`'s `getActiveKennel()`), else the sole own kennel on
record — never "whichever own kennel sorts first," so a Puppy Record for a kennel-B pup carries
kennel B's name/logo even while the app is scoped (or not scoped) to kennel A.

---

## 24. Invoice & Receipt (page + PDF)

`pages/invoice.html`/`.js` (`?source=sale|stud|waitlist&id=<id>&doc=invoice|receipt&cfg=<json>`) is a
printable one-page financial document for a single income record, covering **all five cash income
types** — **Deposit, Remaining Purchase Price, Transport Fee, Boarding Fee** (the four Sale
components) and **Stud Fee** (the outgoing StudService component; customer-facing labels from
`INVOICE_LINE_LABELS`, distinct from the Financials-view `INCOME_COMPONENTS` labels). Non-cash
`pick` value is never billable, so it never appears. Reads only, through
`saleRepo`/`studServiceRepo`/`waitlistEntryRepo`/`dogRepo`/`contactRepo`/`kennelRepo` (layering
rule §2) — no new repo or table.

**One model, two renderers.** `assets/invoiceDoc.js`'s `buildInvoiceDoc({ source, id, doc, cfg })`
decides everything the document says (issuer, recipient, rows, totals, payment box, notes,
footnotes, filename) as plain text; `invoice.js` draws it as HTML and `assets/invoicePdf.js` draws
the same model as a real PDF file with the vendored **jsPDF** (decided 2026-10-06, Waitlist Spec
§15.2), so page and file can't disagree. **Download PDF** (on the invoice page and on a waitlist
family's Documents card) saves `<Invoice|Receipt>-<number>-<name>.pdf`; **Print** is the browser's
own print (`@media print`). jsPDF is `vendor/jspdf.umd.min.js` — the self-contained UMD build (its
ES build needs a bundler), which sets `globalThis.jspdf` when imported as a module, loaded only
when a PDF is made. The standard PDF fonts are Latin-1, so `pdfText()` maps dashes/quotes to plain
equivalents and anything undrawable to "?". All three files are Pro-only (`PRO_ONLY_STANDALONE`)
and precached.

**The waitlist source** (`source=waitlist`, the entry id): one line, "Waitlist application fee"
(`fee_amount`). As a **receipt** it shows the entry's `fee_payment_method`/`fee_payment_reference`
and `fee_received_date`; as an **invoice** the line is due by `fee_due_date` and the payment box
shows the kennel's `waitlist_config.payment_instructions`. The recipient is the family's contact,
else the applicant's own name/email/phone; the "Re:" line names the kennel and the fee policy. The
fee isn't persisted back (no `invoice_number`); the number is the default `RCT-/INV-…`.

- **Line base amounts** come from `incomeView.incomeLineItems(source, record)` (§6/§21), so the
  document can never show a component the Income view wouldn't classify. The per-line **choices**
  ride the `cfg` param (a compact URL-encoded JSON the generator modal builds): each included line
  carries `{ key, mode: 'full'|'partial', collected, dueDate? }`. **Nothing about an invoice is
  stored** — the page and the PDF are rebuilt from the record on every view/download.
- **Full vs Partial** (per line, owner's model): **Partial** prints "<Name> (partial)" with the
  entered `collected` as its amount; **Full** prints the record's full base amount, and
  `collected` is treated as *already collected* — on an **invoice** it is subtracted in the totals
  (Subtotal → "Less amount already collected" → **Balance**), on a **receipt** the line shows the
  remaining `base − collected`, the collected figure is not printed, and the label reads "<Name>
  **(balance)**". There is no payment ledger, so `collected` defaults to 0 for manual entry.
- **Invoice specifics:** no Paid/Due status column; a per-line **Due by** date (the modal prefills
  the *soonest* of the sale's `balance_due_date` and any scheduled `placement` event date for the
  puppy — `invoiceDoc.saleDueDate` — still editable per line). That date is read **live**: a line
  with no `dueDate` in `cfg` (every line of a plain `invoice.html?source=…&id=…` link, e.g. the
  waitlist family's Documents card, and every generator line she left at the prefill) uses the
  record's current date, so editing the Sale's balance due date or pickup changes the next
  view/PDF; only a date she changed (or cleared) in the modal is written into `cfg`. A waitlist
  fee invoice uses the entry's `fee_due_date` the same way — **except Deposit, whose Due by is always "Immediately"**, so
  the modal shows a static "Due immediately" note for that line instead of a date picker; footnote
  markers on **sale** invoices (`*` on Deposit, `**` on Remaining Purchase Price / Transport /
  Boarding — stud fees carry neither) render the two standing disclaimers (deposit
  non-refundability; balance-due-date basis) in the footer; the payment block reads **"Payment may
  be made using one of the following methods:"** over a checkbox-style list of the **accepted
  methods** — a global default in `settings.getInvoiceDefaults().acceptedMethods`, editable per
  document in the modal (checkbox set from `PAYMENT_METHODS`) with a **Save as my default** button
  (`setInvoiceDefaults`).
- **Receipt specifics:** keeps the **Payment received** box (method used / reference / date) and
  stamps **Paid**; totals "Total paid".
- **Issuer** is the resolving own kennel — the record's own `kennel_id` (a Sale/StudService always
  carries one, §4), else the dog's own `kennel_id`, else the active kennel scope, else the sole own
  kennel (same fallback order as the Puppy Record, §23/§10) — with its `logo_data_url`, `location`,
  `website`, and the owner Contact's name/email/phone (via `getMyContactId`). **Recipient** is the
  sale's buyer or the stud partner contact. A document number defaults to a stable
  `INV-/RCT-<yyyymmdd>-<id>` when `invoice_number` is blank.
- **Persisted fields** (`invoice_number`, `invoice_notes`, and — for receipts —
  `payment_method`/`payment_reference`, §4) are written on the Sale / StudService by the generator
  modal so they prefill next time and ride backups. Everything else (Full/Partial, collected, due
  dates, accepted methods) is per-generation and rides `cfg` / `settings`. Nothing here is a new
  FK, table, or `referenceRegistry` entry — the fields are plain and the document is pure
  projection.

The generator modal (`assets/invoiceGenerator.js`, `openInvoiceGenerator({ preselect })`) opens
from the Financials hub (the "Invoice / Receipt" button on every view) and from a **Sale's page**
(an "Invoice / Receipt" header button that opens it already set to that sale, so a sale reached
from the waitlist needs no trip to Financials). Both callers `import()` it only when
`editionFlags.invoicing` is on, so Lite never requests the Pro-only module. It lists every income
record (from `getIncomeRows`; a preselected archived/unbillable one is added), and opens the print
page in a new tab. Because the record is persisted (an `await`) before navigating, the tab is opened **blank and
synchronously within the click handler** and only navigated afterward — opening it *after* the
await would let iOS Safari's pop-up blocker silently swallow it (the gesture is spent), so the
invoice/receipt would never appear on iPhone. The document **never prints itself** — the owner
uses the page's **Download PDF** or **Print** button.

---

## 25. Foster whelps (foster-in & foster-out)

Tracking a litter whelped/raised under a **caretaker↔owner arrangement** where the two parties
differ, with a contract and an income split. `foster_partner_contact_id` is indexed in the
collapsed `version(1)` block so the referential guard can protect the foster partner Contact
(§5).

### The two settling ideas

- **Foster is a per-litter fact, not a dog fact.** The same dam can have more than one foster
  litter (and non-foster litters), so foster lives on the **Litter** (`foster_direction` +
  `foster_partner_contact_id` + split terms), never on the Dog. A foster **puppy** is an ordinary
  `status='puppy'` Dog we manage and sell; its foster-ness is a **derived** read of its litter's
  `foster_direction` (badge only) — it is emphatically **not** an `external`/`external_reference`
  dog (that is a reference-only record we don't raise). The reverse of "is this puppy fostered?"
  is a query over the litter, per the one-canonical-direction rule (§4.2).
- **Whoever holds the puppies books the Sales; the other party's cut is an Expense.** Direction
  only decides who holds the Sales:
  - **foster-in** — an external dam's litter is raised in our care → **we** record the puppy
    Sales (full gross) and pay the **owner's** split out as a `foster_split` Expense;
  - **foster-out** — our dam's litter is raised elsewhere → the pups are still our Dog records; if
    we handle placement we record the Sales and pay the **caretaker's** cut as a `foster_split`
    Expense (identical shape, roles swapped).

  This is why foster needs **no new income machinery** — it rides the existing Sale → derived
  income path (§21), and the split-payout is a normal cost, exactly like an incoming stud fee we
  pay. (A fully hands-off foster-out where we never see the sales — just receive a check — is the
  one gap; it is deferred, not modeled.)

  The partner's compensation is one of two models (`foster_comp_model`, owner's choice per
  litter): an **income split** (`foster_our_share_pct` + `foster_split_basis`) or a **flat fee per
  pup** (`foster_flat_fee_per_pup`). Both document the terms only — the money is the same
  `foster_split` ("Foster compensation") Expense either way, so the P&L stays model-agnostic. The
  `litter.js` edit form swaps the share-% / basis fields for a per-pup fee field as the model
  changes.

### Model touch-points (all additive; all covered in §4/§5/§7/§20/§21)

- **Litter:** `foster_direction` (plain, nullable `foster_in`/`foster_out`),
  `foster_partner_contact_id` (**indexed FK → Contact**, the one added index —
  guarded in `CONTACT_REFERENCES`), `foster_comp_model` (`income_split`/`flat_per_pup`), and
  `foster_our_share_pct`/`foster_split_basis`/`foster_flat_fee_per_pup`/`foster_split_notes`
  (plain, documentation of the compensation terms; the real payout is the Expense). `litterRepo`
  hard-checks only a known direction, a known comp model, a 0–100 share %, and a non-negative flat
  fee; everything else is warn-only in `litter.js`.
- **Vocab:** `FOSTER_DIRECTION`, `FOSTER_COMP_MODEL`, `FOSTER_SPLIT_BASIS`, a `foster`
  `CONTRACT_TYPE`, and a `foster_split` ("Foster compensation") `EXPENSE_CATEGORIES` value.
- **Contract:** `foster` joins `contractRepo.DOG_LINK_TYPES`/`CONTACT_LINK_TYPES` — a foster
  contract reaches the fostered dam (`related_dog_id`) and the counterparty (`related_contact_id`)
  the same way a lease does, so **no new Contract FK**. It is also partner-facing
  (`isLivePartnerContract`), so a live foster contract confers Companion **Partner** membership.
- **Expense:** `reimbursable`/`reimbursed_date` plain fields (§21). Reimbursed costs wash out of
  the Litter P&L; pending ones surface as the "Owed back" receivable.
- **Companion (§20):** the owner/breeder **kennel** is revealed via a `breederKennel` field on
  the prospective litter card and the family pup card, sourced from the foster partner contact's
  `kennel_id`, allow-listed by name in `companionExport.js`, gated by the `fosterOwnerKennel`
  include flag, and emitted **only for a foster-IN litter** (on foster-out WE are the breeder, so
  there is nothing external to reveal; empty otherwise). `companion-view.html` renders it as a
  "Bred by" line (additive; older bundles omit it).

### Surfaces

`litter.js` (a "Foster arrangement" edit section + a read-only callout + a title badge),
`litters.js` (Foster filter + badge), `litter-finances-report.js` (Foster filter + "Owed back"
column), `expensePanel.js` (the Reimbursable toggle + Reimbursed-on date), the contract page (works
unchanged — it reads the link types from the repo), and the Companion console/shell. Sample data
seeds a full foster-in example (Meadow Ridge / Dana Ruiz: an external dam Marigold, a foster litter
with two available pups whose `breeder_kennel_id` is the owner kennel, a `foster` contract, a
`foster_split` payout, and one reimbursed + one pending reimbursable cost).

---

## 26. Dropbox sync & KennelAssistant

Two zero-cost, online-only features layered over the existing backup engine: **push/pull
between the owner's phones through the owner's own free Dropbox**, and **KennelAssistant**,
a deliberately tiny read-write mini-app for a junior helper's phone (log weight checks and
other events against a synced dog list — nothing else). Both are strictly opt-in buttons;
nothing syncs on its own, and the rest of the app stays fully offline-capable (§2.4).

### The Dropbox transport (`data/dropbox.js`)

- Talks straight to the Dropbox HTTP API with `fetch` — **no SDK, nothing vendored**.
- Auth is **OAuth2 + PKCE, entirely client-side** (no secret, no backend), against a
  Dropbox app registered once, by the developer, at dropbox.com/developers/apps:
  *Scoped access*, access type **App folder** (tokens can only ever see
  `/Apps/KennelOS/`), permissions `files.content.write` + `files.content.read`, and every
  connecting page's URL listed under **Redirect URIs** (`pages/import-export.html`,
  `pages/assistant.html`, and the root `assistant.html`, deployed + localhost variants —
  the exact list lives in `docs/LAUNCH_CHECKLIST.md`).
- The **app key itself is hardcoded** as `APP_KEY` in `data/dropbox.js` — same pattern as
  `KennelPapers/data/dropbox.js`. This is safe because a PKCE client id is a public
  identifier, not a secret: every install shares the one key, but each user still does
  their own "Connect" and signs into their **own** Dropbox account, landing in their own
  private `/Apps/KennelOS/` folder. The key grants no access by itself, so there's no
  per-device paste step and nothing for the user to register.
- `beginDropboxAuth()` redirects out; `completeDropboxAuth()` finishes the `?code=`
  round-trip, storing a long-lived refresh token
  (`token_access_type=offline`) and minting short-lived access tokens as needed. Tokens
  live in the `dropbox` settings blob (§11); `disconnectDropbox()` forgets them. The kid's
  phone signs into the **same Dropbox account** as the owner; the app-folder scope is
  what makes that acceptable.
- `dropboxUploadJson(path, obj)` / `dropboxDownloadJson(path)` (download returns `null`
  for a file that doesn't exist yet). One 401-retry with a forced token refresh.
- **The connect UI is a shared component, not per-page code:**
  `assets/dropboxConnectUI.js`'s `mountDropboxConnect(host, { onChange, onError })`
  renders the status/Connect/Disconnect strip into whatever element a page hands it,
  **and calls `completeDropboxAuth()` itself** before first paint — so a host page never
  hand-rolls the round-trip. `onChange(connected)` fires whenever the state actually
  changes, which is how a page re-renders everything gated on the connection.
  `dropboxRequiredNotice(where)` is the matching inline notice for a gated action.
  Because the redirect URI is derived from `location.pathname`, **every page that mounts
  this control needs its own URL registered under the app's Redirect URIs** — that
  registration list is the one manual step a new host page costs.

### The three files — one writer each (`data/assistantSync.js`)

All under the app folder, named in `DROPBOX_PATHS` (dropbox.js). **Each file has exactly
one writer**, which is what makes the scheme conflict-free — preserve that invariant:

| File | Writer | Reader | Contents |
|---|---|---|---|
| `/kennelos-backup.json` | owner (`pushToDropbox`) | owner's other phone | the full `exportAll()` backup |
| `/assistant-feed.json` | owner (`pushToDropbox`) | assistant | allow-listed dog fields + all dog-subject events |
| `/assistant-outbox.json` | assistant ("Send my updates") | owner | events the helper logged, with their own UUIDs |

- **Push and pull are not a separate feature — they are the Import/Export page's backup
  and restore with Dropbox chosen as the destination** (§13's Import/Export entry). Push
  uploads backup + a freshly rebuilt feed in one act (and stamps `lastBackupDate`); pull
  is `fetchDropboxBackup()` feeding the page's **normal restore preview**, so a Dropbox
  restore gets the same dry-run table and the same **Merge / Replace** choice a file
  restore gets, through the same `restoreBackup()` engine (§10). The documented
  discipline: don't edit the *same record* on both phones between push and pull — merge
  is a blind per-id upsert and the pulled copy wins.
- **Privacy is enforced at feed-build time**, same posture as `companionExport.js`:
  `ASSISTANT_DOG_FIELDS` is a positive allow-list (id, call/registered name, breed, sex,
  status, DOB/DOD, color/markings, url, is_archived — **no** microchip, registration,
  ownership, parentage, prices), plus four DERIVED display fields (`litter_id` as a
  grouping key, `litter_nickname`, `sire_name`/`dam_name` as call-name copies — named
  copies, never the litters table or parentage FKs). Only `subject_type === 'dog'`
  events whose type is in **`ASSISTANT_EVENT_TYPES`** (vocab.js — currently
  `weight_check`, `milestone`, `note`, `preventative`, `medication`) ride along; the same
  list gates the assistant's log form, so what the helper sees and what they can log
  never drift. `preventative` (product/dose) and `medication` (drug/dose/frequency,
  a span — the log form's end-date field shows automatically per `duration: 'span'`)
  reuse the main app's existing field defs as-is, no assistant-side field changes
  needed. Contacts, sales,
  financials, kennels, contracts never reach the assistant device at all — that, not UI
  hiding, is the security boundary (everything client-side is inspectable).
- **`pushAssistantFeed()`** uploads *only* the feed — the Assistant console's "send
  updates to my helper", so telling the helper about a dog added five minutes ago doesn't
  require a full backup round-trip. It stamps `assistantFeedPushedAt` but deliberately
  **not** `lastBackupDate`: the feed is an allow-listed slice, not a backup, and counting
  it as one would tell an owner they're safe when they aren't. `pushToDropbox()` calls it
  for the feed half of its work, so there is one uploader for that file.
- **Outbox import** (`fetchAssistantOutbox` → preview → `importAssistantEvents`) is the
  app's standard dry-run-then-commit posture: rows are annotated `new` / `update` /
  `no_dog` (unknown subject dog → **skipped, never invented**, per the import rule) /
  `invalid`, shown in a preview modal, then bulk-upserted by id — so re-importing the
  same outbox is a no-op. The assistant's local `pending` marker is stripped on import.
  It writes through `db` rather than a repo (cross-table data-layer work, like
  `importExport.js`), so it calls **`assertWritable()` itself** — repoBase's blanket demo
  guard never sees these rows.

### The owner console (`pages/assistant.html` + `pages/assistant.js`)

Same console/recipient split as Companion: the page that *configures and sends* lives in
`pages/`, the thing the recipient opens lives at the root (`assistant.html`, §26's
KennelAssistant shell below). Both share a basename, in `PRO_ONLY_PAGES` and
`PRO_ONLY_STANDALONE` respectively — different directories, and both Pro-only, so
`isProOnlyPage()`'s basename match is right either way.

Three cards, in the order an owner meets them: **Connection** (mounts the shared
`dropboxConnectUI` control — the same connection Import/Export uses, so connecting on
either page sets both), **Your helper's copy** (`assistantFeedPushedAt` + a live
`buildAssistantFeed()` count of what a send would include, then `pushAssistantFeed()`),
and **Their entries** (the outbox preview + import). Full backup push/pull is
deliberately absent — that is Import/Export's Dropbox destination (§10), and the page
links there rather than duplicating it. A fourth card explains what the helper can see,
rendered **from `ASSISTANT_EVENT_TYPES`** rather than a hand-written list so the promise
on screen can't drift from the allow-list that actually gates the feed.

Excluded from the **Demo** build alongside `import-export.html` (`DEMO_EXCLUDED_PAGES`):
a console whose job is pushing your records to a real Dropbox account is the opposite of
a sealed read-only showcase. The helper app at the root still ships to Demo.

### KennelAssistant (`assistant.html` + `assistant.js` + `data/assistantStore.js`)

- Standalone shell like `companion-view.html` (no nav.js/app.js boot), but read-write. It
  reuses `assets/app.css`, `assets/ui.js`'s `esc()`, `vocab.js` (the event-type catalog
  drives its log form: same fields, spans get an end date, `combobox` degrades to plain
  text, `relatedContact` pickers are omitted), `dateUtils.js`, and `data/dropbox.js`.
- Its data layer is `assistantStore.js` with its **own Dexie database
  (`KennelOSAssistant`)** — never the main `KennelOSBreedingApp` db — holding exactly two
  tables: `dogs: 'id'` and `events: 'id, [subject_type+subject_id], event_date'`. Same
  conventions as the main schema (UUID ids, YYYY-MM-DD dates, filter-in-JS flags).
- Flows: **Get latest dogs** replaces the synced slice from the feed (dogs wholesale;
  events except locally-pending ones) and stamps `assistantLastSync`; **tap a dog → log
  event** creates a local event with `pending: 1`; **Send my updates** uploads all pending
  events as the outbox (rewritten wholesale each send). Only pending events can be
  deleted on the device — synced history is the owner's.
- The dog list is **grouped by litter** (header: nickname + "Sire × Dam" from the derived
  feed fields) with a **⚖ Weigh litter** button per group: one date + AM/PM, a lbs/oz row
  per pup, one save → one pending `weight_check` per weighed pup (blank rows skipped).
  Both this and single weigh-ins reproduce the main app's **weight-drop soft warning**:
  `assistantStore.js` mirrors `eventForm.js`'s total-ounce comparison and
  date→AM/PM→capture-time ordering (`getPriorWeighIn` scans synced + pending entries),
  and a decrease prompts a collected "Save anyway?" confirm, never a hard block. Keep the
  two implementations semantically in step if the main app's rule ever changes.
- **Acknowledgment loop**: after the owner imports the outbox and later pushes a fresh
  feed, the feed carries those same event ids back; the feed sync's `bulkPut` overwrites
  the pending copies, clearing the flag. Until then pending events keep riding every
  send, which is harmless (owner-side import is an idempotent upsert).
- The feed/outbox shapes carry `format_version` (`ASSISTANT_FORMAT_VERSION` /
  `ASSISTANT_OUTBOX_FORMAT_VERSION`, both 1) — bump only on an incompatible shape change.

### Maintenance notes

- Widening/narrowing what the helper sees = edit `ASSISTANT_DOG_FIELDS` or add an
  event-type filter in `buildAssistantFeed()` — one place, and update this section.
- All five new files (`assistant.html`, `assistant.js`, `data/dropbox.js`,
  `data/assistantSync.js`, `data/assistantStore.js`) are in the sw.js precache; the
  Dropbox API calls are cross-origin, so the service worker's cache-first handler ignores
  them (§12) — sync is always live network.
- No new tables, FKs, or `referenceRegistry.js` entries in the **main** schema: imported
  assistant events are ordinary Event rows, and the assistant db is a separate database
  on a separate device.

## 26.1 Documents & receipt attachments — local file storage

Real, **local** file storage, entirely offline — no external app, no Dropbox connection.
Two surfaces share one storage stack:

- **Documents** — a "Documents" page (`pages/documents.html` + `pages/documents.js`, in the
  **More** menu, plus a "📄 Documents" button on the dog page) where you file a document
  against a dog (pedigree / health test / registration / contract / other), grouped by dog,
  with a type filter and search. Full CRUD, all local.
- **Contract documents** — the Contract detail page (`pages/contract.js`) files the signed
  contract PDF through the *same* Documents stack, without leaving the contract. An
  **"Attach signed contract"** button opens the add-document modal pre-filled with the dog
  the contract resolves to (`related_dog_id`, else the linked Sale's dog, else the linked
  StudService's our/partner dog) and **Type = Contract**, and stamps the saved document's
  `contract_id`. The contract then lists its filed document(s) with inline **View / Download**
  (`documentRepo.getByContract`). This is a plain, unindexed back-link — see the
  referential-integrity note in §7 / the index notes in §5. The Contract's own DocuSign-style
  `document_url` ("Document link") is a *separate* field and is unaffected.
- **Expense receipts** — the receipt-capture widget on both expense forms (§21): attach a
  receipt to any ledger row. See "Receipt capture" below.

The add/edit and view dialogs are the shared **`assets/documentModal.js`** (`openDocumentModal`
/ `openDocumentViewModal`) — one implementation driven by both the Documents page and the
Contract page, self-contained (each loads its own dogs/file and reports back through
`onSaved`/`onDeleted`/`onEdit` callbacks). It is Pro-only code (`PRO_ONLY_STANDALONE` in
`proPages.js`), since both its callers are Pro-only pages, so the Lite build drops it.

**Storage stack (shared by both).** Two Dexie tables (§4, §5): `documents` (metadata + a
`dog_id` and a `file_id`, via `data/documentRepo.js` on the standard `makeRepo` +
`referenceRegistry` pattern) and `files` (the blob archive, via `data/fileRepo.js` — one row
per stored PDF: `blob` + `thumbnail` + meta). `expenses.receipt_file_id` points a ledger row
at a `files` row the same way. A file is **owned by exactly one** Document or Expense: it is
deleted alongside its owner in that repo's `hardDelete`, and so is *not* a
`referenceRegistry` entry (§7). `documents.dog_id` **is** guarded, via a `documents.dog_id`
line in `DOG_REFERENCES` — a dog with filed documents can't be hard-deleted out from under
them.

**Every stored file is a PDF.** An uploaded PDF is stored as-is. A photo/screenshot (camera,
or picked from the library — multi-page allowed for documents) is converted client-side to a
compressed multi-page PDF by `data/pdfBuild.js` — **no library**: it downscales + JPEG
re-encodes each page and embeds the JPEG directly via the PDF `DCTDecode` filter, and yields
a small JPEG data-URL thumbnail for the list. `createImageBitmap` also normalizes iPhone
HEIC on the way in. Viewing/downloading goes through the shared `viewPdfModal` (`assets/ui.js`)
/ the Documents page's own `<embed>` viewer, off a throwaway object URL.

**Receipt capture (`assets/receiptCapture.js`).** One shared widget — built the same way
`buildMileageFields`/`wireMileageMode` are shared — wired into **both** expense forms (the
Financials hub's Add Expense modal and each subject's Expense panel), so there's one
implementation. Take/choose a photo or screenshot, or upload a PDF. A freshly picked photo is
auto-scanned offline by `data/ocr.js` (vendored Tesseract.js, LSTM core; lazy — the ≈7 MB
engine loads only on first scan and every failure path degrades to manual entry) to pre-fill
amount / date / vendor / receipt # **only when those fields are still blank/default** — never
overwriting what the user typed. `resolveFileId()` at save time builds/stores the file (or
reuses/removes the existing one) and returns the `receipt_file_id` to persist.

**Durability.** `files.blob` is the schema's only binary field; it is base64-tagged through
the JSON backup and the Dropbox sync (`importExport.js`, `BACKUP_FORMAT_VERSION` 2 — see §5),
so filed documents and receipts survive backup/restore and two-phone sync. A plain
`JSON.stringify` would silently drop a Blob to `{}`, so any future Blob field must
round-trip the same way.

- **Precache:** `pages/documents.html`, `pages/documents.js`, `data/documentRepo.js`,
  `data/fileRepo.js`, `data/pdfBuild.js`, `data/ocr.js`, `assets/receiptCapture.js`,
  `assets/documentModal.js` (the shared add/edit + view dialogs), and the four
  `vendor/tesseract/*` assets are in `sw.js` — scanning works with no network after
  first install. Bump `CACHE_NAME` on any change to that file set.

---

## 27. Furever seed-link generator (breeder side)

**KennelOS Furever** (`furever/`, this repo, a separate deployed app — see
`furever/README.md` and `docs/KennelOS_Furever_Schema.md`) is a free family-facing
pet-care app a puppy family installs at pickup. It's seeded by a **texted link**
whose payload the family app decodes and applies (`furever/data/seedLink.js`); this
section covers the **encoder side**, which lives here in the breeder app, Pro-only
(§13's Pro-only feature gates), same shape as Companion (§20) but for a different
destination — Furever is a **separate origin/app**, not the recipient-facing shell
Companion uses.

**The Furever console** (`pages/furever.*`, a Sharing seg-tab sibling of Companion, gated by
`editionFlags.furever` + `data/proPages.js`'s `PRO_ONLY_PAGES`) has two parts,
plus a **setup-nudges strip** above them (`#setup-nudges`, `renderSetupNudges`):
subtle, non-blocking reminders for the two furever-relevant things easy to
forget — "No vet contact on file. Add one now →" (`vets.length === 0` from the
identity load) and "No feeding schedule configured for `<breed(s)>`. Configure
now →" (breeds among today's open-sale recipients that have no
`breedFeedingScheduleRepo` row, §27.2) — each a plain link to fix it, nothing
blocks sending a link without either.

- **Kennel identity**, saved once via `settings.js`'s `getFureverSettings`/
  `setFureverSettings` (`localStorage`, key `kennelOS.furever`, cleared by Reset
  App like Companion's settings): kennel name, tagline, the breeder's own contact
  (`{name, phone, email}`), their vet's contact (`{name, phone, address}`) — the
  "inherently yours, never generic" fields the Furever brief calls for. `breederKey`
  is generated on first read (`crypto.randomUUID()`) and persisted — deliberately
  **not** tied to `myKennelId` (§11), so Furever works even when Kennel Setup was
  skipped. Copied into every packet sent from then on. **The card prefills from the
  breeder's existing records** so identity isn't retyped: kennel name from My Kennel
  (`getMyKennelId`), the breeder contact from their owner Contact (`getMyContactId`),
  and the vet from any Contact tagged `'vet'` — offered as a **picker** that fills
  the vet fields (and auto-filled when there's exactly one vet). Prefill is
  **non-binding and blanks-only** (it never overwrites a saved value and the Furever
  block stays its own store, consistent with the not-tied-to-`myKennelId` rule);
  filled blanks are persisted on load so a link can be prepared without a manual save.
- **Recipients** are pups with an **open sale** (`saleRepo.isOpenSale` — the exact
  membership predicate Companion's "family" package uses, §20), one card each. A
  personal note and pickup-plan fields (date/time/place/photo URL — the brief's
  pre-pickup countdown card content, rendered by Furever's Profile page as the
  countdown card, below) persist as **plain `sales` fields**, no schema/index change and no
  `referenceRegistry` entry needed (not FKs): `furever_note`,
  `furever_pickup_date`, `furever_pickup_time`, `furever_pickup_place`,
  `furever_pickup_photo_url`. Persisting them (rather than a one-shot form) means a
  resend starts from the last-sent details, same reasoning as Companion's
  `Contact.companion_note`.

**`data/fureverSeedExport.js`** builds the packet: named-copy-only from the dog +
the saved identity (same allow-list discipline `companionExport.js`'s header
explains, §20's "load-bearing security invariant" — no record spread), matching
exactly what the Furever-side decoder reads by name (`pupId`, `breederKey`, `name`,
`species`, `sex`, `breed`, `dob`, `photoUrl`, `note`, `pickupPlan`, `kennelName`,
`tagline`, `breederContact`, `breederVet`, `contentPackages`). Compressed with the
already-vendored `vendor/lz-string.min.mjs` into
`https://furever.kennelos.app/#seed=<payload>` (`FUREVER_APP_URL`, a fixed constant
— Furever is one app at one origin regardless of which edition sends the link,
unlike Companion's same-origin relative shell URL). `buildSeedPacket` is `async`
(it reads the dog's litter record for its content-pack pointer, below) — `furever.js`
awaits it. `furever.js`'s send mechanics (real `mailto:`/`sms:` anchors so the tap is
the activating gesture, a copy-link fallback, the same SMS/email payload-size
ceilings) mirror `companion.js`'s `prepareLink` pattern; there is no local preview
(Companion's iframe-preview trick needs a local read-only shell to render into —
Furever has none, and the real link would write into whatever browser opens it, so
previewing it isn't safe to fake).

**Rendered on the Furever side:** the seed's `pickupPlan` + `note` become the
**pre-pickup countdown card** at the top of a seeded pup's Profile
(`furever/pages/profile.js`, `countdownCardHtml`) — photo, "it's almost time…"
headline with a live "N days to go" badge, pickup date/time/place, and the personal
note; it retires once the pickup date passes.

### 27.1 Content-pack publish (breeder side) — `docs/KennelOS_Content_Package_Fetch_Mechanism.md`

The breeder-authored counterpart to Furever's content-pack fetch (schema doc's
"Built (content-pack fetch)" section): the Furever console publishes documents to
Google Drive so the family app can pull them in automatically, with KennelOS doing
every Drive-side step (create the folder, upload, share, write the manifest) —
the breeder never touches Drive directly.

- **`data/googleDrive.js`** — the Google Identity Services (GIS) **token-model**
  OAuth client (`drive.file` scope, non-sensitive → no Google verification review;
  `CLIENT_ID` const, same public-identifier posture as `dropbox.js`'s `APP_KEY`).
  `connectDrive()` is the interactive "Connect Google Drive" action; the token lives
  **in memory only** for the tab (no refresh token in this model, so nothing is
  persisted) and every Drive call goes through `ensureAccessToken`, which tries a
  SILENT re-request first and only surfaces a friendly "click Connect again" error
  rather than popping an unexpected consent dialog mid-publish. `driveFetch` retries
  once on a 401 with a forced token re-acquisition, mirroring `dropbox.js`'s
  `contentCall`. Also holds `ensureFolder` (find-or-create, safe under `drive.file`
  scope since `files.list` here can only ever see folders this app created),
  `shareFolderPublic` (`permissions.create {type:'anyone', role:'reader'}`), and
  `uploadFile`/`writeManifestFile` (hand-built `multipart/related` bodies — Drive's
  multipart upload endpoint does NOT accept `fetch`'s own `multipart/form-data`).
  The GIS library itself is **vendored** at `vendor/gsi/client.js` (no-CDN rule) and
  loaded as a plain `<script>` (not a module) in `pages/furever.html`, ahead of the
  module scripts, so `window.google` exists before any Drive call could run.
- **`data/fureverContentPack.js`** — builds `pack.json` (§3.1 of the mechanism doc)
  **by name** from the chosen sources (never a record spread, same discipline as
  `fureverSeedExport.js`) and orchestrates one Publish: ensure folders (reusing a
  cached `folderId`) → upload each source (a KennelOS `Document`'s file, or a
  kennel-level "Upload new" blob), **reusing the same Drive file id** when that
  exact source was published before (tracked in the pointer's cached
  `selection.driveFileIds`, keyed `doc:<id>` / `upload:<id>`) so a republish
  overwrites in place instead of accumulating duplicate Drive files → share the
  folder public-by-link → write/overwrite the manifest, bumping its `version` →
  return the new pointer for the caller to persist. Exports `SENSITIVE_DOC_TYPES`
  (`['contract']`) / `isSensitiveDocType` so the console's picker and any future
  check agree on which types need the "this becomes public" confirmation.
- **`settings.js`'s `getFureverSettings`/`setFureverSettings`** gained the
  **kennel-wide** pack pointer, nested under `contentPack`:
  `{ packKey, folderId, manifestFileId, manifestResourceKey, version, selection:
  { documentIds, uploads, driveFileIds } }`, plus `driveConnected` (UI-only — "has
  Connect ever succeeded," never the token itself). The **per-litter** equivalent is
  a plain, unindexed **`furever_pack`** field (same shape) directly on the litter
  record — additive, no `litterRepo` code change needed (its `update()` already
  merges arbitrary fields) and no `referenceRegistry` entry (it points *out* to
  Drive, not at a KennelOS entity).
- **Furever console UI** (`pages/furever.js`, new "Content packages" section below
  the existing recipients list): a **Connect Google Drive** button; a **kennel-wide
  pack** panel — **uploads only** ("Upload new" area for kennel-level files not
  filed on any dog; there is deliberately no per-dog document picker here, see
  mechanism doc §7 decision 5 — a per-dog document is dog/litter-scoped material and
  belongs in a litter pack, not the every-family kennel-wide one); one **collapsible
  panel per litter** (candidate pool = that litter's pups **and** `sire_id`/`dam_id`,
  each via `documentRepo.getByDog` — Data Model §5.4's "litter's own sire_id/dam_id
  are authoritative"), with **bulk selectors** — a master "select all," a
  **per-type** toggle per doc type present, and a **per-dog** "select all" — built as
  plain DOM checkbox manipulation (no separate JS selection model to keep in sync;
  the checked boxes ARE the state while a panel is open) and pre-checked from the
  pointer's cached `selection.documentIds`. Publish reads the checked boxes at click
  time; if any selected document's `doc_type` is sensitive (`isSensitiveDocType`), an
  inline confirmation (`sensitiveConfirmHtml`) lists exactly which titles are about
  to become publicly link-readable and requires an explicit "Yes, publish anyway"
  before the actual `publishPack` call runs. The kennel-wide panel also shows an
  **"Already published"** list (title, doc-type badge, a "View in Drive" link, a
  per-item Remove/Undo) sourced from `settings.contentPack.selection.uploads` — every
  publish re-sends that full carried-forward list plus whatever's newly staged, so
  `publishPack` can thread a no-longer-blob-holding prior upload into the new
  manifest by its already-known Drive file id instead of silently dropping it
  (mechanism doc §7 decision 5).
- **Removing a doc/upload from a pack trashes its Drive file** (mechanism doc §7
  decision 6, added post-launch — closes a real gap, not a nicety): unchecking a
  previously-published litter document, or clicking Remove on a kennel-wide
  upload, no longer just drops it from the next `pack.json` while the file keeps
  sitting shared in Drive. `googleDrive.js`'s `trashFile(fileId)` PATCHes
  `{trashed: true}` (Drive's own recoverable Trash — also drops "anyone with the
  link" access for non-owners); `publishPack` takes a `removedKeys` param
  (`driveFileIds` keys the console diffs "last-published selection" against
  "checked/staged now") and trashes + purges each one as step 0 of the publish,
  before anything else. Scoped per-pack — a `Document` filed on a dog that's a
  parent in multiple litters gets an independent Drive file (and `driveFileIds`
  entry) per litter's own publish, so trashing it out of one litter's pack never
  touches another litter's copy.
- **Overwrite is keyed by the KennelOS record id, not the filename** — a
  republish only PATCHes the same Drive file when the exact same `Document.id`
  or client-assigned upload id is sent again (mechanism doc §7 decision 7). A
  new "Upload new" item with a title matching something already published
  creates a second, separate file rather than replacing it; there's no in-place
  "replace this file's bytes" affordance today.
- **Not built:** the manual (no-OAuth) fallback (mechanism doc §7 decision 1 —
  documented, deliberately second-priority). **Not yet browser/round-trip
  verified** against a real Google account (no live consent/Drive round trip has
  been exercised) — verify Connect → Publish → a family device actually receiving
  the docs before relying on this in production.
- **Per-pup privacy within a litter pack** (mechanism doc §7 decision 4, added
  post-launch — fixes a real leak, not a design nicety): a litter pack is one
  shared Drive manifest for the whole litter, but a document filed on ONE pup
  must never appear in every OTHER pup's family's app. Each manifest file now
  carries the `dogId` it was filed on (`fureverContentPack.js`'s
  `loadDocumentSource`/`buildManifest`), and `doLitterPublish` (`pages/
  furever.js`) passes the litter's `sire_id`/`dam_id` into `publishPack` as
  `parentDogIds` — documents filed on the sire or dam are shared with the
  whole litter (relevant to every family), a pup's own documents are not.
  `furever/data/contentPackFetch.js`'s `filesForThisPup(manifest, pupId)`
  filters the fetched file list down to "this pup's own + the parents'"
  before writing the family's breeder-doc layer — `pupId` is the family's
  `pet.pup_id`. A `scope:'kennel'` pack carries no `dogId`/`parentDogIds` at
  all and is never filtered (deliberately identical for every family). The
  litter picker's checkbox groups (`dogGroupHtml`/`pickerHtml`) now label each
  group **(Sire)**/**(Dam)**/**(Pup)** and carry an explanatory line, so which
  documents go to everyone vs. one family is explicit in the UI, not just
  implicit in the data.

### 27.2 Feeding Schedules (breed default + litter override) — Pro-only

The breeder's own recommended feeding amounts, structured as a small
weight-band x age-column grid (both axes free text — a real breeder's printed
feeding guide rarely fits a fixed set of life-stage labels) plus a food brand
and notes. **Per breed**, not a kennel-wide default: a Boston Terrier's weight
bands top out around 60 lbs, a large breed's look nothing like that. Rides into
a placed pup's Furever seed packet so the family sees the breeder's own
guidance instead of Furever's generic age-bracket placeholder
(`furever/data/careLibrary.js` `FEEDING_PLAN`), which is untouched.

- **`data/db.js`** — new table `breed_feeding_schedules: 'id, breed, is_archived'`.
  `breed` is a free-text lookup key (matched case-insensitively/trimmed against
  `Dog.breed`, same posture as CSV import's name matching), not a stored FK —
  so it carries no `referenceRegistry` entry (`BREED_FEEDING_SCHEDULE_REFERENCES
  = []`, a leaf like `CONTRACT_REFERENCES`/`DOCUMENT_REFERENCES`). Record shape:
  `{ breed, food_brand, age_columns: string[], weight_rows: [{ label, amounts:
  string[] }], notes }` — `amounts[i]` aligns with `age_columns[i]` by index.
  `litters.feeding_schedule_override` is a plain, unindexed free-text field
  (filtered in JS like the foster fields) — the per-litter override that takes
  priority over the breed default; additive, no `litterRepo` code change needed
  (its `update()` already merges arbitrary fields).
- **`data/breedFeedingScheduleRepo.js`** — the standard thin repo
  (`makeRepo('breed_feeding_schedules', ...)`), `breed` required, plus
  `getByBreed(breed)` (case-insensitive/trimmed match, returns null when unset).
- **`pages/breed-feeding-schedules.*`** (not a nav entry — reached via a "Open
  Feeding Schedules →" doorway card on the own-kennel's Kennel detail page,
  `pages/kennel.js` `feedingScheduleCard()`, alongside Lifecycle nudges and
  Preferred tests; gated by `data/proPages.js`'s `PRO_ONLY_PAGES` the same as
  every other Pro-only page) — one collapsible card per breed **pulled from the
  kennel's own dogs**
  (`dogRepo.getBreeds()` — the existing distinct-breed query breed autocomplete
  already uses elsewhere, not a separate vocabulary), so a breeder only ever
  authors schedules for breeds they actually have. Each card is a food-brand
  input, an editable grid (add/remove weight row, add/remove age column, every
  cell free text), and a notes field. Cell/label edits mutate an in-memory
  draft directly (no re-render, so typing doesn't lose focus); add/remove
  re-renders just that card from the updated draft, mirroring the litter-form
  re-render pattern.
- **`pages/litter.js`** — a `feeding_schedule_override` textarea (view row +
  edit field), gated by `editionFlags.feedingSchedule` the same way the Foster
  arrangement section is gated by `editionFlags.fosterArrangement`: absent from
  the DOM in Lite, `readForm()` falls back to the stored draft value instead of
  being clobbered to `''`.
- **`data/fureverSeedExport.js`** — `buildSeedPacket` now also fetches the
  pup's litter once (shared by both `contentPackages` and the new
  `feedingSchedule` field, replacing two separate `litterRepo.getById` calls)
  and adds `feedingSchedule: { litterOverride, breedSchedule }` — named-copy-only
  like every other field here (never a record spread); `null` when neither a
  litter override nor a breed default exists, so an untouched pup's Furever app
  is unaffected.
- **Furever side (`furever/pages/feeding.js`)** — purely additive: reads
  `pet.seed.feedingSchedule` (already riding along unindexed in `pet.seed` —
  `petRepo.upsertSeededPet` copies the whole incoming packet by spreading `seed`
  into that one field, so **no `furever/` schema or repo change was needed** for
  this to arrive) and renders a reference card above the existing age-bracket
  radio presets: the litter override (if any) as a highlighted note, else the
  breed grid as a small table. The family's own save/radio flow (`feedingRepo`,
  `careLibrary.FEEDING_PLAN`) is completely untouched.
- **Editions** — Pro/Demo only (the page itself, and its `kennel.js` doorway
  card — `kennel.html` doesn't exist in the Lite build at all, so no extra
  edition-flag gate was needed on the card). The litter override field is the
  one piece that lives on a **shared** page (`litter.js`, kept in Lite), so
  *that* needs its own flag: `editionFlags.feedingSchedule` is `true` in
  `pro/editionConfig.js` and `demo/editionConfig.js`, `false` in
  `lite/editionConfig.js`; `shared/data/editionConfig.js` (the Pro-semantics
  default) also carries it — remember all **three edition copies plus the
  shared default** need updating together for a new flag, since each edition
  ships its own full `editionConfig.js` (`build/assemble.mjs` always overlays
  `<edition>/editionConfig.js` verbatim — there is no shared/edition merge at
  build time, despite `editionConfig.js`'s own header describing Pro/Demo as
  "using the shared defaults"; in practice each keeps its own synced copy).
  `breed-feeding-schedules.html` was added to `data/proPages.js`'s
  `PRO_ONLY_PAGES` (excluded from the Lite build, and gates any in-app link to
  it at runtime) — same mechanism as every other Pro-only page.

---

## 28. Kennel identity & Kennel Cards

**The problem this solves.** Every cross-kennel reference in the app is otherwise a
privately-typed string. When you record a stud service with an outside dog, set a dog's
`breeder_kennel_id` to the kennel that produced it, or name a foster partner's kennel, you
create a Kennel row that exists only in *your* IndexedDB. If the breeder on the other side
also runs KennelOS, they have their own unrelated row for the same real-world kennel, and
nothing will ever reconcile the two. Provenance across a kennel boundary is therefore
name-matching-by-memory.

Two pieces close that, and they are deliberately separate:

- **§28.1 — the identity** (`kennels.public_id`): a durable, portable identifier for a
  kennel. Ships in every edition.
- **§28.2 — the card** (`data/kennelCard.js`): the payload that hands that identity to
  another breeder, peer-to-peer. Pro-only UI.

**What is deliberately NOT here.** There is no registry, no directory, no lookup, no
server, and no network call of any kind — a card only goes where the breeder sends it.
Discovery ("find other breeders") is a genuinely different problem that cannot be solved
local-first, and nothing in this section pretends to solve it. This design is the piece
that has to exist *first* either way: whenever a registry does arrive, existing kennels
can **claim** an identifier they already have rather than being re-keyed. Nor does a card
solve multi-device — it carries identity, not records; a second device restores a JSON
backup or syncs via Dropbox (§10, §26), and the import preview says so in as many words
when you feed it your own card.

### 28.1 `kennels.public_id` — the portable identity

Format `kos1_<uuid>` (`kennelRepo.newPublicId` / `isPublicId`).

- **Not the row `id`.** The row id is a database key: it is recreated whenever the record
  is (a fresh install where the breeder retypes their kennel instead of restoring, a
  delete-and-re-add, a hand-edited backup), and it names nothing outside this database.
  The public id is what another breeder's copy points at, so it has to outlive all of that.
- **Why a prefix, when the codebase otherwise uses bare UUIDs.** This value is copied
  between apps and, some day, into a registry. A bare UUID pasted into the wrong field is
  indistinguishable from a right one; `kos1_` makes a mis-paste fail loudly, gives a
  registry a cheap format check, and gives us a version to migrate off.
- **Own kennels only.** Minted in `kennelRepo.create` when `is_own_kennel`, and on the
  update that *promotes* a kennel to own — which by the same line self-heals any own
  kennel predating the field. An outside kennel is **never** minted one locally: doing so
  would be inventing somebody else's identity, the same failure the CSV importer refuses
  (§9). Its `public_id` can only ever be *received*.
- **Write-once.** `kennelRepo.update` throws on any attempt to change a non-empty
  `public_id`, and silently ignores an attempt to blank one. Empty → set is allowed (that
  is exactly what linking a card does).
- **Uniqueness** is a repo-level guard (`assertPublicIdFree`), not a Dexie `&` index — see
  the §5 index note.
- **Portability is free**, and that is the point: `importExport.js` iterates whatever
  tables exist and copies whole rows, so the identity rides the JSON backup, the Lite→Pro
  bridge, and the Dropbox sync with no code of its own. Pinned by a browser check.

**Relationship to Furever's `breederKey` (`settings.js`, §27).** Different scopes,
deliberately not merged. `breederKey` identifies the *installation's breeder* to the family
app — one key shared across all of a user's own kennels, so every pup they place dedupes
into one `breeders` row — and re-keying it would break the dedup of packets already sent.
`public_id` identifies *one Kennel record*. **Not a gap to close.**

### 28.2 The Kennel Card

`data/kennelCard.js` (data layer, ships in every edition — reached through `kennelRepo`,
exactly as `data/companionExport.js` ships to Lite while `companion.html` does not) plus
`assets/kennelCardUI.js` (in `PRO_ONLY_STANDALONE`, so it is absent from the Lite build).

**The allow-list invariant**, same posture and same reasoning as `companionExport.js`
(§20): `buildKennelCard` names every field it copies and copies nothing else, then
`assertOnlyKeys` runs a **positive** check before the card can leave. A new Kennel field
does not ride along until someone adds it here by name. That matters more here than most
places — the Kennel record also carries the kennel's *program* (`preferred_tests`,
`preferred_breeds`, `preferred_test_breeds`, `promote_*`) and its `logo_data_url`, none of
which is identity and none of which is anyone else's business.

A card carries exactly: `cardVersion`, `publicId`, `kennelName`, `prefix`, `location`,
`website`, `issuedAt`. Pinned field-by-field in `tests/kennelCard.test.js`.

**The load-bearing rule on the receiving side: a card can never set `is_own_kennel`.** A
card names somebody else's kennel by definition, and an imported kennel landing in your
own-kennel set would enter your scope switcher (§Multi-Kennel), your portfolio, your shared
preferred-test vocabulary, and — in Lite — your cap accounting. Import forces
`is_own_kennel: false` on create and never touches the flag on update. A card whose
`publicId` matches one of *your own* kennels is refused outright with nothing written, so a
third party can never rewrite your kennel's name.

**Transport** mirrors the two mechanisms already in the repo — lz-string-compressed JSON,
carried either as a **link** (`kennels.html#kennelcard=…`, like Furever's seed link) or as
a copyable **code**. The link is the nicer path but is only correct when both breeders are
on the same origin — which is the common case, since every Pro user shares
`pro.kennelos.app`. The **code is the universal path** and is the one to hand someone whose
install you can't locate. Both are offline; nothing here makes a network call. The link
handler listens for `hashchange` as well as running at load, because pasting a card link
while already on the Kennels page is a same-document navigation that re-runs no module.

**Every import is a dry-run preview before a commit** (CLAUDE.md), and a payload that
arrived from another person is the last place to make an exception. `previewKennelCard`
writes nothing; four outcomes:

| Outcome | When | What commits |
|---|---|---|
| `create` | no local kennel carries this identity | a new **outside** kennel — or, if the user picks one, a *link* to an existing record (below) |
| `update` | a linked outside kennel exists and the card differs | the four identity fields, shown as a before/after diff first |
| `unchanged` | linked and nothing new | nothing; no commit button is rendered |
| `own` | the identity is one of *your* kennels | nothing, ever |

**Match-or-create is keyed on `public_id`, never the row id** (§9's rule). On a `create`,
the preview additionally *offers* any **unlinked, non-own kennel whose name matches**
case-insensitively (`kennelRepo.findUnlinkedByName`) — the real-world case where the
breeder typed "Thornfield Kennels" in by hand last year and is now receiving Thornfield's
actual card. Linking attaches the identity to that existing record, so everything already
pointing at it (dogs, stud services, contracts) keeps pointing at it instead of being
stranded on a duplicate. This is **offered and never automatic**: a name is not a key, and
auto-matching one would be exactly the "silently invented relationship" §9 forbids. "Add as
a new kennel" is the pre-selected default.

**Surfaces.** The share half is a card section on the Kennel hub (`kennel.html`, own
kennels only; an outside kennel that arrived via a card shows the ID it came with instead).
The receive half is "Add from a card" on the Kennels list (`kennels.html`), which also
badges a card-linked outside kennel as **linked** — the visible difference between a
cross-kennel reference that lines up with the other breeder's records and one typed from
memory. Both host pages are Pro-only, so no edition flag was needed.

### 28.3 Changing this

- Adding a field to the card means adding it to `CARD_KEYS` **and** (if it should write on
  the receiving side) to `CARD_FIELDS` — and asking first whether it is *identity*. Program
  config, money, and anything about dogs or people are all out of scope by design.
- `KENNEL_CARD_VERSION` bumps only on a breaking shape change. Adding an optional field is
  additive; `decodeKennelCard` already drops unknown keys so a card issued by a later
  version still imports its v1 identity.
- If a registry is ever built, it slots in **above** this, not instead of it: `public_id`
  becomes the thing a kennel claims, and a human-readable handle (which needs enforced
  uniqueness, and therefore a server) would be the new field. Nothing here has to change
  for that to happen — which is the whole reason it exists now.

---

## 29. Waitlist (per kennel) — `docs/KennelOS_Waitlist_Spec.md`

**Build status: W1 is complete** — W1a (data layer), W1b (intake + list pages), W1c
(offers), W1d (sample/Demo seed §11, CSV import of applications §9, application fees in
Financials §21) and **W1e** (her post-W1 requests, Spec §15: her own application form,
offering from the family's page, invoice/receipt PDFs, the public list as copyable text).
W2 (online: form, status page, server; `docs/KennelOS_Waitlist_W2_Plan.md`) is being built
behind its release switch (`cloudConfig.WAITLIST_ONLINE_RELEASED`, false: offered only
against staging); see **Online (W2)** below. W3 (assistant) is not started. The spec's §0
records the decisions, §14 the slices, §15 the W1e design.

### Model
- **One list per kennel.** Every waitlist row carries a required own-kennel `kennel_id`
  (`assertOwnKennel`). Contacts stay program-wide: a family on two kennels' lists is one
  Contact with two entries.
- **`waitlist_entries`**: one row per family per time on the list — a second puppy years
  later is a new entry. Lifecycle `applied → approved → active → placed`, with exits
  `declined`/`expired`/`withdrawn`/`removed`. **Pause and listen-only are flags on an
  `active` entry**, never statuses, so narrowing what a family wants never costs a place.
- **`waitlist_offers`**: one row per turn on a litter. `counts_as_pass` is decided once,
  when the outcome is recorded, via `waitlistRules.countsAsPass` — stored so a later rule
  or program change can't rewrite history.
- **`waitlist_programs`**: her own named adjustments (fee override, `ahead` priority, pause
  allowance, passes not counted, longer response window). A table, not a vocab list.
- **Settings** are `Kennel.waitlist_config` (§4.1), never `settings.js`/localStorage, so
  they survive a restore. That includes her **application form**, `form_questions[]`, and its FAQ, `application_faq[]`.

### The application form (`data/waitlistForm.js`, W1e)
Pure, pinned by `tests/waitlistForm.test.js`.
- **Questions** `{ id, label, type, required, help, options[], source_header?, key? }`. Types she
  can pick are `WAITLIST_QUESTION_TYPE` (short/long text, single choice, checkboxes, yes/no,
  number, date); `email`, `preference` and `notice` are locked-only.
- **Locked questions** carry a `key`: `name`, `email`, the four preferences (`pref_sex`,
  `pref_breed`, `pref_placement`, `pref_colors` — answers go to the entry's `pref_*` fields, not
  `application`), `ready_timing` (required; type `preference`, answer on `entry.ready_timing`,
  fixed answers from `WAITLIST_READY_TIMING`; enforced when she types a new application in), and `public_notice` (her public-list wording, `PUBLIC_LIST_NOTICE`, shown to
  every applicant; editable text, never removable). She can reword them only.
  **Matching notice** (`MATCHING_NOTICE`, her wording, fixed text): shown just above the first
  preference question that filters offers (`matchingPrefKeys(config)`: sex, breed, placement,
  plus colors when `color_matching` is on; readiness is a hold, not a match) on a new application.
  **FAQ** (`formFaq` / `validateFaq` / `newFaqItem`): her questions and answers, edited above the
  questions on the Application form page and shown at the top of a new application.
  `formQuestions(config)` returns the defaults for a kennel with no form, and always restores a
  missing locked question and its type/required flag. **No program question exists**: only she
  assigns programs.
- **Answers** are keyed by question id; each saved entry also stores `application_questions`
  (`snapshotQuestions`). `entryQuestions(entry, form)` is what to show/edit: the snapshot's
  wording first, then questions added since; a W1 entry shows the current form plus any stray
  answer keys. Typing an application in only requires the name (`missingRequired`); "Required"
  is for the online form (W2).
- **Question import**: `proposeQuestionImport(headers, rows, form)` turns each CSV column of
  her old form's responses into a proposal — **map** onto an existing question (a column it
  came from before, the `IMPORT_ALIASES`, or matching wording), **new** (type guessed by
  `guessType`: yes/no, number, date, ", "-joined checkboxes, few repeated values → single
  choice, long → paragraph) or **skip** (timestamps, kennel/program/notes, blank columns).
  `applyQuestionImport` stamps `source_header` (the normalized header) on mapped and new
  questions, and the **application CSV importer** (§9) reads each question from
  `columnsFor(question)` — its own column first, then the aliases — so the same file then
  imports the families' answers into those questions.

### The public list (W1e, Spec §15.3)
`waitlistRules.publicList(entries, kennelId, programsById, { today, nameOf })` returns only
`{ position, name, pref_sex, added }`: the real §6.1 position, `publicName` (first word + last
word's initial), sex preference, and the anchor date. **Paused families are left out and their
numbers skipped** (#1, #2, #4), so no public number moves when a pause ends; listen-only
families show with no marker; programs, contact details, notes and money never appear. No opt-in
or opt-out — every applicant is told by the locked notice. `publicListText` is the text the
Waitlist page's **Copy public list** produces for Facebook/her website (the W1 stand-in for
W2's public link).

### The rules engine (`data/waitlistRules.js`)
Pure functions, no Dexie, no clock (callers pass `today`); pinned by
`tests/waitlistRules.test.js`. **Nothing it computes is stored.**
- **Position** = order among the kennel's `active`, non-archived entries: `ahead` program
  first → `position_anchor_date` if set, else `fee_received_date` (else `approved_date`, the
  fee-waived anchor) → `fee_received_at` (same-day fees in the order they were recorded) →
  `approved_date` → `created_at` → `id`.
- **Available pup**: not archived, not deceased, `disposition` not `keeping`/`placed`
  (unset/`undecided` count as available), and no non-archived Sale whose status isn't
  `returned`/`cancelled`.
- **Preference match**: sex (unless `any`), **breed** (unless blank; case-insensitive,
  trimmed, against `Dog.breed`), placement (vs `Dog.intended_placement`), and color only
  when `waitlist_config.color_matching` is on. An unset fact on either side matches.
- **Changing the matching answers** (Waitlist Spec §15.9, W1): every change to the five
  `PREF_CHANGE_FIELDS` past `applied` is logged in `pref_change_log` (repo-side). Saving a
  NARROWER answer (`narrowedPrefs`: any → specific, one specific → another, a later readiness,
  dropping a color while color matching is on) asks her to confirm when `prefChangeEffect`
  finds an open offer (it stays open; a pass still counts) or a live litter they're next for
  that the change would skip them on. Widening never asks. From W2 step 5 the family asks on
  their status page (`pref_change_request`) and she approves or declines with one tap on Today
  or their page; see **Online (W2)**.
- **Eligible** for a litter: on the list, same kennel, not paused (`isPaused`: her own `paused_until >= today`, or the readiness hold `today < readyFromDate(entry)`),
  listening for it (`waitlistRules.isListeningFor` — listen-only `selected`: its sire is a picked sire OR its dam a picked dam; `except`, Waitlist Spec §16.3: neither parent is on their except list; an `except` with nobody listed is All litters, `isListenOnly`), and at least one available matching pup. Skipped families have nothing
  recorded against them.
- **Turns** (Waitlist Spec §16.1, decided 2026-10-08, replacing one open offer per litter):
  one family holds a turn at a time across the kennel's open litters, and the turn lists
  every pup they're eligible for in every litter with open picks. Stored as one
  `waitlist_offers` row per litter sharing `turn_id` and `respond_by_date` (an offer from
  before turns has none and is its own turn: `turnIdOf`). The next turn
  (`waitlistRules.nextTurn`) goes to the highest-ranked family with an eligible, available
  pup in an open litter they haven't spent a turn on (spent stays per litter: `turnSpent`; a
  `voided` offer gives it back), recalculated every time, so a family skipped on one litter
  comes first for a litter that opens later. A litter opening mid-turn joins it only when the
  holder is the top family for it (`joinsOpenTurn`; the deadline restarts), else waits.
  Actions: `offerNextTurn` / `offerNext` / `openPicks` / `offerTo` make turns; picks,
  deposits and pup switches act on one row (a pick on another litter of the same turn lets
  the first go); `recordOutcome` passed / no response / voided closes the whole turn, and a
  pass counts ONCE (`counts_as_pass` on one row) and only when the whole turn is passed; the
  deposit voids the turn's other rows (never a pass); `undoPass` gives the whole turn back.
  `nextFamilyForLitter` remains as "first in line for this litter" (the family page's
  out-of-turn check, `prefChangeEffect`). Today's overdue nudge is one per turn
  (`overdueTurns`). **Pass reasons and "Not this litter"** (Spec §16.2, §16.5): a family's
  pass on their status page needs one of her reasons (`passReasons` / `passReasonOf`; saved
  on the offer as `pass_reason`); "Not this litter" (`Entry.prepasses`) is pending until
  their turn: `splitPrepassed` leaves those litters out of the offer, and a turn of nothing
  else is passed at once by `offerNextTurn`, which goes on to the next family.
- **Passes**: counted from offers with `counts_as_pass === true`; at
  `waitlist_config.max_passes` (default 2) the entry should be removed. The **7-day undo**
  is derived from `removed_date`, and forgives the latest counted pass (`passToForgive`)
  so the family isn't removed again at once.
- **Deadlines** (W1, no server): `overdueOffers`/`overdueFees` feed one-tap suggestions; the
  app never expires anything silently.
- **`deriveContactWaitlistStatus`**: `active` while any entry is applied/approved/active,
  `fulfilled` when the latest ended `placed`, else `none` — applied by `waitlistEntryRepo`.
- **"Almost your turn"** (Spec §15.5): `soonFamiliesForLitter(entries, offers, litter, pups,
  sales, opts)` walks the litter queue in order, one family per available pup, leaving out
  families whose turn on that litter already closed (passed / no response). A family holding
  an open offer on **any** litter still takes a pup's worth of room but is marked `inFlight`
  and gets no notice (so a second litter never re-notifies a family mid-decision); an open
  offer on this litter whose family has dropped out of the queue still holds a pup.
  `offers` must be the whole kennel's. `soonFamiliesForKennel` is the union over live
  litters, one row per family in list order. `soonNoticeText(config, kennelName)` returns
  `{ subject, body, text }` from `soon_notice_text` (or the default), filling `[Kennel Name]`;
  the first line is the subject.
- **`describeOfferChanges(res, { nameOf, litterOf, fmtDate })`**: the plain-text lines every
  surface shows for offers an action voided or made, so no offer is made silently.

### Actions (`data/waitlistActions.js`)
Every multi-step write the pages make: **approve** (links the contact she picked from
`contactMatches` — offered, never automatic — or creates one from the application; stamps
`approved_date`, the fee from `feeForEntry`, `fee_due_date` from `fee_due_days`, the
credit policy; a fee of 0 goes straight to `active` anchored at the approval date),
**decline**, **feeReceived** (sets `fee_received_date` = the place in line, and
`fee_received_at` = now for same-day order; also the "Add to
the list" path when no fee is configured), **markFeeExpired**, **withdraw**
(`withdrawn_date`), **removeByBreeder** (final; coming back = re-apply), **archiveEntry**
(archives via the repo), **undoRemoval** (second-pass only, within 7 days, forgives the
pass), **undoPass** (below), **reapply** (a new `applied` entry for the same family/kennel with their preferences
copied), and **setPositionAnchor** (a date, another family's anchor, or `null` to clear). W1
sends nothing; she contacts families herself.

**Leaving the list releases the family's turns.** withdraw, removeByBreeder, archiveEntry, a
received deposit and a second-pass removal all run the internal `releaseOpenOffers`: each
open offer the family still holds is voided (`counts_as_pass: false`, a note saying why; a
held pick's deposit-pending Sale is cancelled) and that litter's turn moves on
(`moveTurnOn`). withdraw / removeByBreeder / archiveEntry return
`{ entry, voided, offered, waiting }`.

**Automatic offers are a setting, OFF by default (decided 2026-10-06), per moment since
2026-10-08:** `waitlist_config.auto_offer_on`, a list of the closings that offer by
themselves (`accepted`, `passed`, `no_response`, `no_deposit`, `left`; ticked on the Kennel page's Waitlist
settings card). `moveTurnOn(litterId, { trigger })` calls **offerNext** only when
`waitlistRules.autoOffers(config, trigger)` is true (`confirmDeposit` passes `accepted`,
`recordOutcome` `closingTrigger(offer, outcome)`, `releaseOpenOffers` `left`); otherwise nothing is offered and the family who's next is returned in `waiting`
(`[{ litter_id, entry_id }]`), which `describeOfferChanges` turns into "X is next in line.
No offer was made…". Every offer is then made by her (**Open picks**, **Offer to them**,
**Offer a litter…**). (Unarchive goes straight to the repo and makes no offers.)

**Which writes make offers (decided 2026-10-06):** only an offer on that same litter closing
(deposit received / passed / no response, or the family leaving as above) moves the turn on
by itself, and only for a moment ticked in `auto_offer_on`. Actions on one family — **approve** (fee-waived), **feeReceived**, **undoRemoval** —
make **no** offers; the family page then says which litters they're next for, and she offers
from **Offer a litter…** / **Offer to them**. Every offer made on her behalf is returned and
shown (`describeOfferChanges`).

**The offer flow (W1c):**
- **openPicks** stamps `Litter.picks_opened_date` and calls **offerNext**; **closePicks** clears
  it (an open offer stays open until resolved).
- **offerTo(litterId, entryId, { note })** (W1e) — the family's page's **Offer a litter…**:
  opens picks if needed, then offers that family the litter even if they aren't next. Refused
  when another offer is open on the litter, the family's turn on it is spent (`turnSpent`), or
  no available pup matches them. Out of turn, the page confirms first and `note` records who
  was next; nobody's place changes and the next family still gets their turn afterwards.
- **offerNext(litterId)** — only while picks are open and no offer is open on the litter:
  `nextFamilyForLitter` picks the family, and the offer is written with `respond_by_date`
  (`respondByDate`, program window first) and an `eligible_dog_ids` snapshot.
- **Accepting is pick + deposit (decided 2026-10-06).** The respond-by window is the time to
  accept AND pay; a pup is only theirs once the deposit is in.
  - **recordPick(offerId, { chosenDogId })** creates the **Sale** (`deposit_pending`, buyer =
    the family's contact, `placement_type` = the pup's `intended_placement` → the family's
    preference → `pet`, `lead_source: 'Waitlist'`, price/deposit from
    `saleDefaults.expectedPricing`) and stamps `chosen_dog_id`/`picked_date`/`sale_id` on the
    offer, which stays **open** (`isAwaitingDeposit`). The family stays `active`, nothing moves
    on, and the live Sale makes the pup unavailable to anyone else.
  - **changePick(offerId, { chosenDogId })** — they picked the wrong one: moves the same Sale to
    another available matching pup (`switchablePups`); price/deposit follow the new pup only
    where they still equal the old pup's expected amounts (a paid deposit is never touched).
    Allowed while the deposit is pending, and on an `accepted` offer while no later non-voided
    offer exists on the litter (`canSwitchAcceptedPick`) — then the dispositions swap too
    (new pup `placed`, old pup `available`).
  - **confirmDeposit(offerId, { date, amount })** — the Sale goes `deposit_paid` with
    `deposit_date`/`deposit_amount`, the pup `placed`, the offer `accepted`, the entry `placed`
    with `placed_sale_id`; the family's other open offers are released; the turn moves on.
- **recordOutcome(offerId, outcome)**:
  - `accepted` = recordPick (if not picked yet; or changePick if a different pup is passed)
    + confirmDeposit, for a pick and deposit that arrive together.
  - `passed`/`no_response` first lets go of a held pick (its Sale → `cancelled`, with a note;
    refused if the Sale already shows the deposit — record it with confirmDeposit instead),
    then freezes `counts_as_pass` (`countsAsPass`) and removes the entry (`second_pass`) once
    `shouldRemoveForPasses`, releasing its other open offers. No deposit by the deadline is
    recorded as `no_response` ("No deposit").
  - `voided` is never a pass, also cancels a held pick, and deliberately does **not** move the
    turn on (the same family would just be re-offered); she offers the next family by hand.
  - After passed/no_response the turn moves on (`moveTurnOn`). The result
    (`{ offer, sale, removed, passes, next, voided, offered, waiting }` — `voided`/`offered`
    are the family's other litters released above) drives the page's confirmation message.
- **undoPass(offerId)** (decided 2026-10-06) — undo a `passed`/`no_response`: that family is
  next in line for the litter again. Allowed while the family is `active`, or `removed` for
  `second_pass` within the 7-day window (`undoPassBlocker`; they go back on the list). The
  offer reopens (`open`, `counts_as_pass: false`, a fresh `respond_by_date`, a new
  `eligible_dog_ids` snapshot, a note). A family holding the litter's open offer meanwhile has
  it **voided** (never a pass, so they're next again after) — refused if that family has
  already picked a pup. Refused if the family can no longer be offered the litter. Makes no
  other offer. Returns `{ offer, voided, restored }`.

### Surfaces (W1b)
- **W1e (the waitlist as the main workflow, Spec §15.2):** the Waitlist page gains a
  **Litters** card (each live litter with pups to offer: picks state, the open offer or
  "Next: <family>" with **Offer to them**, which opens picks first if needed), **Application
  form** and **Copy public list** buttons. The family page gains **Offer a litter…** on an
  active entry, outcome buttons on an open offer in its Offers card (Picked a pup… / Passed /
  No response / Void; once picked: Deposit received… / Change pup… / Passed / No deposit /
  Void), **Change pup…** on an accepted offer until the next family is offered, **Undo…** on a
  pass / no response, and a **Documents** card (application fee receipt once a fee is received;
  puppy invoice + receipt once placed) with View and Download PDF (§24). New applications are
  typed in on her form, in her order and wording, with the public-list notice shown.
- **Pages** (Pro-only, `PRO_ONLY_PAGES`): `waitlist`, `waitlist-entry`, `waitlist-programs`,
  `waitlist-import`, `waitlist-form`
  (§13 page catalog). A page shows ONE kennel: `?kennel=` → the active scope → the first
  own kennel, with a kennel picker once a second own kennel exists (`waitlistUI.js`).
- **Kennel page**: the Waitlist settings card.
- **Litter page** (W1c): the **Waitlist picks** panel (`assets/waitlistPicksPanel.js`) —
  Open/Close picks, the open offer (family, respond-by with a "deadline passed" badge, the
  pups currently available to them) with Picked a pup… / Passed / No response / Void — or,
  once picked, the held pup with Deposit received… / Change pup… / Passed / No deposit /
  Void — "Next up"
  with a manual **Offer to them** (after a void, or when someone new becomes eligible),
  the litter queue (per-litter position, overall #, pups for them; spent turns hidden), and
  the offer history (with **Change pup…** on the last accepted pick and **Undo…** on a pass /
  no response; the dialogs live in `waitlistUI.js`). Hidden for a kennel that has never used the waitlist on that litter.
  After each write the page re-reads the litter so a later Edit → Save can't write back a
  stale `picks_opened_date`.
- **Today** (W1c): the four waitlist nudges (§19). A nudge action's `run` may resolve to
  `{ title, message }`, which Today shows after it runs: **Record no response** reports the
  pass and who the turn moved to; **Undo** says no offer was made.
- **"Almost your turn…"** (Spec §15.5): a button on the Waitlist page (every live litter of
  the kennel, `soonFamiliesForKennel`) and in the Litter page's picks panel (that litter,
  shown when anyone is in reach). `waitlistUI.openSoonNotice` lists the families (in-flight
  ones named but not included; no email → "tell them yourself"), the editable message, an
  **Open in my email** `mailto:` with everyone BCC'd (a warning past ~1800 characters), and
  **Copy email addresses**. Either of those stamps each ticked family with
  `soon_notified_date` / `soon_notified_litter_ids` (`markSoonNotified`; the mailto tap is
  not delayed by the write). Families told before still appear, ticked, with a "Told
  <date>" badge, since she may need them again (e.g. a "sorry, next time" note); the family
  page shows the date and litters. W2 delivers the same `{ subject, body, text, recipients }`
  to the status page and by email.
- **W1d:** the `waitlist-import` page (§9), application-fee income + the purchase credit
  (§21), and the sample/Demo seed (§11). A page with no `?kennel=` (dashboard tiles, the
  Import/Export dropdown) lands on the own kennel with the most open entries, then your
  own kennel from setup (`waitlistUI.resolveWaitlistKennel`).
- **Dog form**: `intended_placement` for a puppy.
- **Contact page**: a Waitlist panel listing the family's entries, and the waitlist dropdown
  becomes read-only (a badge) once any entry exists, since `waitlistEntryRepo` keeps it.
- **Dashboard**: "New waitlist applications" and "Families on the waitlist" tiles, counting
  entries under the active kennel scope (they replaced the old contact-based "Active
  waitlist" tile).
- All of the above outside the pages check `editionFlags.waitlist` (false in Lite).

### Online (W2, `docs/KennelOS_Waitlist_W2_Plan.md`)
- **Her device is the source of truth.** `data/waitlistProjection.js` builds one kennel's
  online view from the same rules-engine calls the pages use, field by field from
  allow-lists: the public list; per family (by entry id) name, email, status, place, prefs,
  pause / readiness hold, listen-only, passes, open offers, which live litters they match
  (`matching_litter_ids`, a yes/no, never a place in a litter's line), the unpaid
  fee and her payment instructions (approved and unpaid only), and the fee-received date; a
  family whose time on the list ended gets only its outcome; per live litter its label,
  available pups (call name, sex, color) and **every** eligible family in order. Never:
  other answers, phone, address, programs, notes, payment details. `as_of` is today, so it
  republishes at least daily (pauses and holds end by date).
- **What number a family sees** (Waitlist Spec §16.9, decided 2026-10-08): only their
  overall place, and not even that while it would mislead. `waitlistRules.placeHidden` →
  `{ reason: 'turn' }` while they hold a turn, or `{ reason: 'passed', offers }` after a
  turn they passed on or let lapse, until each of those litters closes (picks stopped,
  every pup spoken for, or sold/closed). Then `position` is null and `place_hidden` says
  why (with each litter's id, label and outcome), and `publicList({ hidden })` leaves them
  off the public list with their number skipped, online and in her **Copy public list**.
- **Ready now?** (Waitlist Spec §16.7; online lists only, and only holds ending while the
  list is online, decided 2026-10-08): `waitlistRules.readyCheck(entry, today, config)`;
  `isReadyHeld` / `isPaused` take the config as a third argument and, with it, keep a
  family held past `readyFromDate` while unanswered (unless `unpause`), or while a No's pause
  request waits for her; without it, the plain rule. Event kind `ready` (yes, or no with a
  date and a required reason → `recordReadyAnswer`). `cloudWaitlist.sweepReadyChecks` (the
  backing device, each sync) removes families past their window under `remove_after`
  (`readyCheckLapsed`); Today lists them under `keep_paused` after `ready_answer_days`
  (`readyCheckOverdue`) with **They're ready**, and reports a removal with its undo. The
  family's page shows the answer, or **They told me they're ready**.
- **A litter was born** (Waitlist Spec §16.6): `waitlistRules.whelpNotes` gives each active
  family not paused or held a `match` or a `review` (with `why`: `listen`, `sex`, `breed`,
  `placement`, `colors`) for a born litter before picks open with a pup available,
  published per entry as `whelp_notes` whatever her `show_upcoming` switches say; the status
  page's **Review your preferences** card opens the listen-only and Ask-to-change editors.
- **Publishing** (`data/cloud/cloudWaitlist.js`): for each own kennel with
  `waitlist_config.online` and a `public_id`, the projection is hashed and `PUT` when it
  changed; a kennel taken offline is `DELETE`d. 20 s after the last data change
  (`CLOUD_DATA_CHANGED_EVENT`), on load and when back online. It needs a session and cloud
  backup on; the server also needs the **backing device** and a server-known Pro account,
  and the reason it stopped (`signed-out`, `backup-off`, `not-backing`, `pro-required`,
  `kennel-taken`, `offline`, `failed`) is kept in the `waitlistOnline` settings key for the
  card. Nothing is sent where it isn't offered (`isWaitlistOnlineOffered()`).
- **The card:** Kennel page → **Online list** (`assets/waitlistOnlineUI.js`): put this
  kennel's list online, its time zone, the status line, **Publish now** and **Copy public
  list link**.
- **Status links:** every entry of an online kennel gets `status_token` (64 hex, minted by
  `cloudWaitlist.ensureStatusTokens` before a publish; cloud tier). The family's page has
  **Copy status link** and **New link** (`replaceStatusToken`: the old link stops working at
  the publish that follows); the picks panel has **Copy status link** beside an open offer.
  Links come from `cloudConfig.statusPageLink` / `publicListLink` (`apply.kennelos.app` for
  production, staging's own address otherwise); `waitlistUI.statusLinkFor` hides them while
  the list isn't online.
- **The family pages** themselves are the Worker's (`cloud/public/family/`, `cloud/README.md`):
  the public list with search and **See Your Details** (a family signs in with a code
  emailed to their application address; the browser stays signed in 90 days), the
  read-only status page, and the online application form.
- **The online form** (W2 step 4): **Take applications online** on the Online list card
  (`waitlist_config.online_form`) makes a form key on this device (`Kennel.waitlist_form_keys`,
  private; `data/waitlistCrypto.js`) and publishes her form with the public key. Applicants'
  browsers seal their answers to it; an application reaches her once they type the code
  emailed to them. `cloudWaitlist.takeInApplications` opens each one on the backing device
  and makes an `applied` entry through `data/waitlistInbox.js` (validated against her form
  and the vocab; the inbox id is the entry id; `source: 'online_form'`, shown on the family's
  page as "through your online form"). **Rotate form key…** retires the old key (kept).
- **Family actions** (W2 step 5): a family signed in on their status page can choose a pup
  (one per turn), pass (on the whole turn: `{ turn_id }`, with one of her reasons), say "Not
  this litter" ahead of time or take it back (`prepass` / `unprepass`), say they're still interested, ask for a pause (with an end date), change which
  litters they wait for, ask to change a matching answer, leave the list, and send her a
  message (sealed to the kennel's form key, which every online kennel now has; the
  projection publishes its public half as `kennel.message_key`, plus `kennel.parents` (the
  listen-only choices, `waitlistRules.listenParentChoices`), `kennel.breeds`,
  `kennel.color_matching`, each family's `requests`, offers with their `turn_id`, and the
  kennel-wide `turn_queue`: every family still to have a turn, in order, with their eligible
  pups per open litter, which W2 step 7 walks). The server records each action as
  an event; on the **backing device only** (checked with `GET /program` before anything is
  written), `cloudWaitlist.applyFamilyEvents` reads the events after its cursor
  (`waitlistOnline.eventsCursor`; a device with none starts at the published
  `events_through`), plans each with `data/waitlistEvents.js` against her records **now**
  and carries it out with `waitlistActions.applyFamilyPlan`: a pick → `recordPick` (the
  deposit stays her tap), a pass → `recordOutcome(…, 'passed')`, leaving → `withdraw`, a
  WIDER listen-only change → applied; a pause, a NARROWER listen-only change (`listenChangeKind`:
  leaving All, dropping a `selected` parent, adding an `except` one, or switching between
  `selected` and `except`) and an answer
  change → a request on the entry. An action her records no longer allow (the offer closed,
  the pup was sold) is never forced: it becomes a line in the family's `messages` for her.
  The next publish carries the cursor as `events_through`, and the server lets go of the
  pups it held for picks up to there. Today (`nudges.js`) shows each pending request with
  **Approve** / **Decline** and unread messages with **Mark read**; the family's page has a
  **From their status page** card with the same buttons. Server moves (deadlines, automatic
  offers) are step 7 and are skipped until then.
- **Before picks open** (Waitlist Spec §16.4, §16.8; W2 step 5c part 4): her
  `waitlist_config.show_upcoming` switches publish `upcoming[]` in the projection
  (`waitlistRules.upcomingItems`: a pairing without a litter as `planned_pairing` /
  `pairing`; an `expected` litter as a `pairing`, keyed by its pairing; a born litter with
  picks not open as `early_litter`), each with its parents' call names and titles
  (`waitlistProjection.titlesByDog`, from logged `title_earned` events), her dates and
  `public` / `family`; each active entry's `upcoming` says whether they're waiting for it
  (listen-only) and, for a born one, whether they match it (never a place). The server's `listView` shows the public ones,
  `statusView` the family ones; a family's Litters card lists only litters with open picks
  (or in their turn), so with every switch off a family sees a litter only once picks open.
  "Not this litter" works on what's shown (`checkTarget`). Today suggests **Open picks** for
  a born litter whose `accept_deposits_date` has come with picks closed and a pup available
  (`waitlistRules.depositsDueLitters`; only for a kennel with families on its list).

### Editions
Pro-only *surfaces* (pages in `PRO_ONLY_PAGES`, `assets/waitlistUI.js` in
`PRO_ONLY_STANDALONE`, in-page doors behind `editionFlags.waitlist`); the tables, repos,
rules and actions live in `shared/data` like every other repo, so a Pro backup restored
into Lite keeps its waitlist rows dormant. Demo gets a seeded list in W1d.

---

## 30. Cloud backup — `docs/KennelOS_Cloud_Phase1_Plan.md`

The plan is the detailed design; `cloud/README.md` is the server's map. This section is the
shape of it as built, for orientation.

### What it is
- An **opt-in** account (email + a 6-digit emailed code; the server keeps only a keyed hash
  of the email) that **backs up the kennel-records tier** as whole snapshots, keeps 30 days
  of dated history, and restores onto a new or reset device or "as of" a date. Lite and Pro
  alike; Demo never (its `cloudUrl` is `null`).
- **Private data never goes up.** `data/syncRegistry.js` is the per-field allow-list
  (unlisted = private): contacts' phone/email/address, prices, Financials, contracts and
  private notes stay on the device. A cloud restore is a field-merge (`'cloud-merge'`,
  §10), so private fields already on a device survive it.
- **Shape:** one **backup device** per program at a time (a second device gets a 409 and
  chooses: restore that backup here, or replace it); a shrink guard refuses an upload that
  looks like a half-empty device; Reset App turns backup off.
- **A lost device** (plan §2.5): from another signed-in device, erase it (it wipes itself
  the next time it opens the app online) and, in Pro, free its license slot.
- **The private vault** (`docs/KennelOS_Private_Vault_Plan.md`; built):
  an opt-in, end-to-end encrypted copy of the **complete** records beside the kennel tier.
  One AES-GCM key per program, held unlocked on each device in `device_secrets`
  (`vaultKeyStore.js`); the server keeps only wraps of it (one under the recovery code, one
  per passkey) and ciphertext. A **passkey** (`vaultPasskey.js`, WebAuthn PRF, RP ID
  `kennelos.app` so Lite and Pro share it) never signs in and is never verified by the
  server: its PRF output for a stored random salt is the key that opens its own wrap. Offered
  only where the browser can do PRF; the recovery code stays required. A device can also be unlocked by another, already
  unlocked one: the server relays an ECDH exchange salted with a 12-character code the
  user types on the approver, so it can't open what it relays. With it on and unlocked, every push
  also uploads the encrypted vault part (before the body) and the content hash covers the
  private rows, so private-only edits push. Files the cloud tier doesn't carry (contracts,
  "other" documents, receipts) go up encrypted deterministically, so they dedup. On but
  locked on a device, pushes **pause** (`lastError` `vault_locked`) until it is unlocked;
  the server refuses a vault-less snapshot anyway. A restore merges the same snapshot's
  vault part (`'vault-merge'`, §10) when the device is unlocked.
  **Release switch:** `cloudConfig.VAULT_RELEASED`, **true since 2026-10-08**, so
  `isVaultOffered()` shows the vault's screens wherever cloud backup is. Set false, they're
  offered only against staging (localhost, or `?cloud=staging`). The data layer ignores it.
  **UI:** offered right after the first backup in "Turn on cloud backup" and from the card;
  the recovery code is shown once (Print / Save to Files / Copy) and its last 4 characters
  typed back before anything is sent; then, where passkeys can work, "Unlock with a passkey
  next time?" (skippable). The card's Private backup section has Passkeys… (list, add on an
  unlocked device, remove with a fresh sign-in). The restore paths (first-run "sign in and restore",
  and the 409's "restore that backup here") ask to unlock first: passkey (when the vault
  has one and the browser can try), recovery code, another device, or Not now. After a restore that left private details blank (`cloudRestoredAt`),
  the record pages that hold them show a hint pointing at Unlock (or a file backup); an
  unlock that merges the private tier clears it.

- **The Pro license link** (`docs/KennelOS_License_Link_Plan.md`): the server learns of Pro
  purchases from Lemon Squeezy's webhook, by the keyed hash of the purchase email, and
  answers `GET /account/entitlement`. In Pro only (`isLicenseGated()`), the card's Account
  section shows whether this account is Pro on the server, with **Link a Pro purchase
  email…** (a code to that address) and **Unlink purchase emails**
  (`cloudEntitlement.js`). It gates the server's own features (the waitlist's W2), never the
  app: `license.js` still decides that, with or without a server.

### Where it lives
- **Server:** `cloud/` (one Cloudflare Worker + D1 + R2; staging and production are the
  top level and `[env.production]` of `cloud/wrangler.toml`). Deployed by Workers Builds,
  never by `deploy.yml`, and not part of any edition. Operated from its `/ops` page.
- **Client:** `data/cloud/` (`cloudConfig`, `cloudApi`, `cloudAuth`, `cloudBackup`,
  `cloudDevices`, `cloudEntitlement`, `cloudWaitlist` (§29), and the vault's `vaultCrypto`, `vaultKeyStore`, `vaultPasskey`, `cloudVault`; §3) and `assets/cloudBackupUI.js` +
  `assets/cloudVaultUI.js` (§3, §11). `editionConfig` supplies
  `cloudUrl` (production) and `devCloudUrl` (staging, for localhost and the
  `?cloud=staging` test switch).
- **Boot** (§11): `app.js` starts the device check-in before the license gate, and
  `cloudBackupUI.bootCloud()` (the scheduler, notices, the one-time offer) after first run.
- **Settings keys** (§11): `cloudSession`, `cloudBackupState`, `cloudDeviceId`,
  `cloudDirtyAt`/`cloudDirtySince`, `cloudOfferPending`, `cloudRestoredAt`, `eraseAck`,
  `cloudTestServer`, `waitlistOnline` (§29).

### Rules that keep it safe
- `cloudUrl: null` must boot with no request and no cloud UI (`tests/cloudClient.test.js`).
- A new field is private until classified (`tests/syncRegistry.test.js`); a new direct
  `db` write calls `markDataChanged()` (`tests/cloudDirty.test.js`).
- Server: migrations are additive and never edited once applied; after a deploy that adds
  one, the API answers 503 until **Apply pending** on `/ops`. Nothing logs an email, code,
  token or body.
- Erasing a device, signing out the others and deleting the account need a fresh sign-in.

