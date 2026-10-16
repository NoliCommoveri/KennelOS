# KennelOS — App Design & Maintenance Guide

The map of the whole KennelOS app: what it does, how the code is built, and how to change it
safely. It covers every edition. The code all lives in **`shared/`**, Pro ships all of it,
and §0 says what Lite and Demo leave out or change. Each feature section names its edition
gate where there is one.

- **Paths** are relative to `shared/` (`data/db.js` = `shared/data/db.js`) unless they start
  with `cloud/`, `build/`, `tests/`, `docs/`, `lite/`, `pro/`, `demo/`, `site/` or `furever/`.
- **The code is authoritative.** Where this guide and the code disagree, fix the guide.
- **Why things are the way they are** lives in the plans and specs in `docs/`, which each
  section links. History is in `docs/BUILD_LOG.md`.

---

## 0. Editions — Lite, Pro, Demo

One codebase, three builds. `node build/assemble.mjs` copies `shared/` to
`dist/<edition>/`, overlays that edition's `editionConfig.js` (and Lite's `editionTour.js`)
at the shared path, drops files the edition doesn't ship, and generates its `sw.js`
(`build/README.md`). Each edition deploys to its own origin, so their IndexedDBs never mix.
The shared core never checks which edition it is: it reads the two injection points.

- **`data/editionConfig.js`** holds `editionFlags`, the cap hooks (`enforceDogCap`,
  `enforceLitterCap`), `navItems`, `cloudUrl` and `licenseConfig`. The `shared/` copy is
  the Pro-semantics default. Source copies are in `lite/`, `pro/` and `demo/`.
- **`data/editionTour.js`** holds the guided-tour package (sample seed + step catalog, §11).
  Lite supplies its own; Pro and Demo use the shared default.
- **A new flag goes in all four copies** (`shared/`, `lite/`, `pro/`, `demo/`
  `editionConfig.js`): the build overlays an edition's file whole, with no merge.
- **`data/proPages.js`** lists the Pro-only files. The Lite build leaves them out (a direct
  URL 404s), and Lite-kept pages use it to hide links to them.

| | Lite (free) | Pro (paid) | Demo |
|---|---|---|---|
| Pages | Shared pages only: no `PRO_ONLY_PAGES` / `PRO_ONLY_STANDALONE` | All | All but Import/Export, Settings and the Assistant console (`DEMO_EXCLUDED_PAGES` in `build/assemble.mjs`) |
| Feature flags (contacts, stud services, contracts, documents, companion, furever, reports, invoicing, puppy record, foster, receipts, external ownership, assistant, feeding schedules, accounts, shows, waitlist, multi-kennel) | all `false` | all `true` | all `true` |
| Cap | 6 counting dogs, 10 litters | none (no-op hooks) | none |
| Archive | No Archive button, no "include archived" toggles, departed dogs shown as plain text; a dog leaves by "Remove from program" | Normal | Normal |
| Dog statuses | puppy / active / retired breeding / deceased (`fullDogStatuses: false`) | All | All |
| Writes | Normal | Normal | Blocked (`demoMode`) |
| License gate | No | Yes (`licenseGate`) | No |
| Cloud backup | Yes | Yes | No (`cloudUrl: null`) |
| Live sync | No (`liveSync: false`) | Yes | No |

The shared pages Lite keeps hide their Pro-only parts with the same flags: the invoice
button, receipt attach, the Account picker, a sale's "Referred by", the litter foster and
feeding-schedule fields, and the Dashboard's Archived tile. The full list is in the Editions
Plan's "Lite scope" section.

**Details live in:** `docs/KennelOS_Lite_Pro_Editions_Plan.md` (tiers, licensing, the Lite→Pro
bridge, Demo), `docs/KennelOS_Lite_Cap_Enforcement_Spec.md` (the cap, precisely),
`build/README.md` (build + deploy).

### 0.1 The Lite cap
`dogRepo.create`/`update` and `litterRepo.create` call the edition's cap hooks. Lite's hooks
(`lite/editionConfig.js`) throw `CapExceededError` (`data/repoBase.js`) when a write would
bring a dog **into** the counted set (owned / co-owned live adults; `rosterCount.js`), or
would add an 11th litter. Editing a counted dog, or a dog leaving, is never blocked. The dog
form, the litter form and Today's promote-pup nudge catch the error and show
`assets/upgradeNudge.js` (export a backup, then go to checkout). The New Dog page shows a
"Creating x/6" counter from the same predicate. Pro and Demo's hooks are no-ops, so no cap
logic ships in Pro.

### 0.2 Demo mode
`data/demoMode.js`: every repo write (`repoBase` create/update/hardDelete, `fileRepo`,
`restoreBackup`) calls `assertWritable()`, which throws a friendly `DemoModeError` when
`editionFlags.demoMode` is on. The sample seed runs inside `withSeedAllowed()`. `app.js`
seeds an empty database on load, skips first-run prompts, and shows a read-only banner.

### 0.3 Pro license gate
- **Boot gate** (`data/license.js` + `assets/licenseGate.js`): in the Pro edition only (`editionConfig.editionFlags.licenseGate`),
  `app.js`'s `boot()` calls `ensureLicensed()` before rendering — a Lemon Squeezy
  key is browser-validated (activate/validate, no backend) with an interval-scaled
  offline grace window (monthly/yearly subscriptions); a one-time **Lifetime** key is
  perpetual — it never expires, but it still has to **re-validate online**: 90 days of
  full access from the last successful `/validate`, then 30 days of a reconnect banner,
  then a wall, all reset by one successful validate. A lifetime key blocked on staleness gets a
  *reconnect* wall, never the renewal wall — `licenseGate.js`'s `isStaleLifetime`.
  An unlicensed load is walled. The cached activation lives
  under its own `settings.js` key (`kennelOS.proLicense`) that is deliberately **excluded
  from `clearAllSettings()`**, so Reset App keeps paid entitlement. It also keeps how many
  activations the key is using and allows (`activationUsage` / `activationLimit`, from the
  last validate; null until then), which Kels's account health reports. Inert in Lite/Demo.
- **Activations are a countable, releasable resource.** Lemon Squeezy counts
  *activations* ("instances") against the variant's activation limit — it knows nothing
  about the machine, and neither do we. Three rules make that counter survivable:
  `deactivate()` hands a slot back (`releaseThisDevice()` from Settings → *This
  device's license*, which clears the local record **only** if the release succeeded;
  `resetLicense()` on the renewal wall, which is best-effort so a walled owner is never
  trapped); each activation is named `"<owner's label> · <8 chars of kennelOS.deviceId>"`
  so slots are distinguishable in the store dashboard; and `recordFromPayload()` lets an
  explicit `valid:false` downgrade an otherwise-`active` key to `inactive`, so a released
  or de-authorized device actually stops working (a more specific `expired` is preserved,
  because it earns its grace window). `kennelOS.deviceId` is a random per-browser UUID
  used only for that label — no fingerprinting, no system data — and, like the license
  record, it sits outside `KEYS` so Reset App leaves it alone.

**Details:** Editions Plan "Licensing", `docs/KennelOS_License_Link_Plan.md`.


Where a field-level or rule-level detail matters, the **code is authoritative** — where a
doc and the code disagree, the code wins and the doc is what gets fixed.

---

## 1. What the app is

A **local-first, static, multi-page web app** for running a dog-breeding program: dogs and
pedigrees, contacts, kennels, pairings, litters (incl. foster, §25), sales, stud services,
contracts, a polymorphic event log, money (§21), reminders and nudges (§19), reports (§31), a
per-kennel waitlist (§29), shows, business accounts (§32), CSV/JSON import-export, and
share-outs to families (Companion §20, Furever §27).

- **No required backend, no build step.** Plain ES modules served over HTTP. Hosted on
  GitHub Pages; all data lives in the browser (IndexedDB via Dexie). The one server is the
  **opt-in** cloud backup API (§30); with it off, or in an edition with no server, the app
  runs exactly the same.
- **Single user, single device** is the design centre. Data moves between devices through
  explicit JSON backup/restore, CSV import/export, Dropbox (§26), or (opted in) a cloud
  backup restored on the new device (§30). Pro can also turn on live multi-device sync
  (§34).
- **Offline-capable PWA.** A service worker precaches the app shell so it works offline
  after the first load.

---

## 2. Architecture non-negotiables

These are load-bearing. Changing any of them is a design decision, not a routine edit.

1. **Multi-page static, no SPA router.** One `.html` per screen, each pulling in shared
   JS. Navigation is real links between pages.
2. **Strict layering: pages → repos → Dexie.** Pages never import `db.js` and never
   call `db.*`. Only the repo modules in `data/` touch Dexie. Two data-layer modules write
   every table directly, by design: `importExport.js` (restores) and `syncApply.js` (rows
   pulled by live sync, which keep their own timestamps and must not be marked as local
   edits; Cloud Phase 2 plan §5.3).
3. **ES modules over HTTP.** Must be served (`python3 -m http.server`, `npx serve`, or
   GitHub Pages) — never opened as `file://`, which CORS-blocks module imports.
4. **No CDN.** Everything third-party is vendored under `vendor/` and loaded by relative
   path; the app works fully offline after first load. The online-only, opt-in exceptions
   each have one module that makes the calls: cloud backup and sync (`data/cloud/cloudApi.js`,
   §30), Dropbox (`data/dropbox.js`, §26), Google Drive (`data/googleDrive.js`, §27), Jotform
   (`data/jotformApi.js`) and Stripe (`data/stripeApi.js`) (§32).
5. **One thin repo per entity**, uniform surface (see §6). New entity = new repo + new
   page; you don't reshape existing ones.

---

## 3. Directory layout

```
CLAUDE.md, README.md         Session brief; summary + doc map
docs/                        Plans, specs, BUILD_LOG.md, this guide
build/assemble.mjs           Edition builds → dist/<edition>/ (§0)
lite/ pro/ demo/             Each edition's editionConfig.js (+ Lite's editionTour.js) (§0)
cloud/                       Cloud backup / sync Worker (§30, §34; cloud/README.md)
furever/, site/              Family app; marketing site (separate, not editions)
tests/                       node --test suites
shared/                      The app
  index.html, app.js         Landing page; the shell boot (nav, PWA, first run, license gate)
  nav.js, sw.js, manifest.json
  companion-view.html        Companion recipient page (§20): standalone, read-only, precached
  assistant.html/.js         KennelAssistant helper app (§26): standalone, read-write
  pages/                     One .html + .js per screen (catalog: §13)
  assets/                    UI: app.css, ui.js, listView/reportView frameworks (§13),
                             modals, pickers, feature UI modules
  data/                      The data layer: db.js, repos, vocab, rules engines, import/export
    cloud/                   Cloud backup, vault and live sync modules (§30, §34)
  vendor/                    Dexie, PapaParse, lz-string, jsPDF (§24), Tesseract (OCR),
                             PDF.js (pedigree import), gsi (Google Drive sign-in, Furever packs §27)
  resources/                 common_tests_by_breed_seed.csv (breed → test seed, §11)
```

Every module opens with a comment saying what it is; feature sections (§19–§34) name the
modules they use. The core data-layer modules:

| Module | Role |
|---|---|
| `db.js` | The Dexie schema, the only one (§5) |
| `repoBase.js` | `makeRepo` factory, `CapExceededError`, `ReferenceBlockedError` (§6) |
| `referenceRegistry.js` | Every FK and the hard-delete guard (§7) |
| `syncRegistry.js` | Per-field cloud allow-list; unlisted = private (§30) |
| `vocab.js` | Controlled vocabularies and the event-type catalog (§8) |
| `importExport.js`, `syncApply.js` | The two direct writers of every table: restore (§10), live sync (§34) |
| `csvImport.js` | CSV match-or-create engine and mappings (§9) |
| `kennelScope.js` / `scopePredicates.js` | Active-kennel scope: bound read predicates and write stamp / their pure half |
| `editionConfig.js`, `editionTour.js`, `proPages.js`, `demoMode.js` | Edition injection points and gates (§0) |
| `settings.js`, `nudgeState.js` | Device-local `localStorage` settings; nudge dismissals (§19) |
| `dateUtils.js` | `todayYMD()`, the single "what is today" |
| `appReset.js`, `sampleData.js` | Reset App / remote erase; the sample kennel seed (§11) |

---

## 4. Data model

### 4.1 Entities

Every record carries `id` (UUID), `is_archived`, `created_at`, `updated_at`. Dates are
`YYYY-MM-DD` except those two timestamps. "Required" is enforced by the repo's validator.
Field lists below are the ones that carry rules; the repo's `normalize`/`validate` is the
full truth, and `data/syncRegistry.js` says which fields are **private tier** (never sent
to the cloud unsealed).

| Entity | Required | Key fields and rules |
|---|---|---|
| **Dog** | `call_name`, `sex`, `breed`, `ownership_type`, `status`; `kennel_id` when `owned`/`co_owned` (an own kennel) | `sire_id`, `dam_id`, `litter_id`, `breeder_kennel_id` (who produced it; prefilled from an owned dam's kennel) vs `kennel_id` (who has it now; an outside kennel for `external`/`leased_in`), `owner_contact_id` (required for `external`/`leased_in`), `co_owner_contact_ids[]`, `registered_name`, `registration_number`, `microchip_id`, `planned_tests[]`, `recorded_coi`, `url`. `disposition` (`undecided`/`keeping`/`available`/`placed`/`health_hold`) is **puppy-only**: forced null unless `status='puppy'`. `intended_registration` (`REGISTRATION_TYPE`) prefills a sale's registration and limits waitlist matches (§29); never cleared on growing up. `pedigree_only` = a lineage-only ancestor: no owner needed, `call_name` may be blank if `registered_name` is set (`dogRepo.dogName`); every one is made by `dogRepo.createPedigreeOnly` (the pedigree import, Kels's tidy-up and Add dogs), named by its registered name, `external`, `external_reference`. |
| **Contact** | `name` | `contact_type[]`, `email`, `phone`, `facebook_profile`, `address` (also the away-board location, §19), `kennel_id` (affiliation, not scope), `waitlist_status` (kept by `waitlistEntryRepo`), `first_contact_source`, `companion_note` (shown to the recipient, §20; `notes` is private). Buyers are Contacts; there is no Buyer table. |
| **Kennel** | `kennel_name` | `is_own_kennel`, `public_id` (identity, not an FK, §28), `prefix`, `location`, `website`, `logo_data_url` (kept under ~300 KB, `assets/kennelSettingsFields.js` `LOGO_MAX_CHARS`), `preferred_tests[]`, `preferred_breeds[]`, `preferred_test_breeds`, promote-nudge settings (§19), `puppy_record_fields` (§23), `time_zone`, `waitlist_form_keys` (private), `waitlist_fee_account_id` (FK → Account), `waitlist_config` (all waitlist settings; missing keys read from `waitlistRules.WAITLIST_CONFIG_DEFAULTS`, §29). |
| **Pairing** | `sire_id`, `dam_id`, `pairing_type`, `status`, `kennel_id` | `method`, `planned_date`, `last_observed_date`, `expected_due_date` (prefilled 63 days after `planned_date` when empty). Sire ≠ dam. |
| **Litter** | `dam_id`, `sire_id`, `status`, `kennel_id` | `nickname`, `pairing_id`, `whelp_date`, `accept_deposits_date`, `estimated_ready_date` (prefilled whelp + 56 days; follows a whelp change while still the prefill), `litter_registration_number`, `puppies_born_*` counts, `delivery_type` (`LITTER_DELIVERY_TYPE`: natural, assisted, planned or emergency C-section; cloud; shown and asked only once the litter is Whelped or later, see Litter delivery below), per-sex `expected_price_*` / `expected_deposit_*` / `full_reg_surcharge_*` (private; `saleDefaults.expectedPricing`), `picks_opened_date` (§29), foster fields (§25), `feeding_schedule_override` (§27). Its puppies are derived (`Dog WHERE litter_id`). |
| **Sale** | `dog_id`, `buyer_contact_id`, `registration_type`, `status`, `kennel_id` | `sale_date`, `price`, `deposit_amount`/`_date`, `balance_due_date`, `balance_paid_date`, `transport_fee`, deferred boarding (`deferred_boarding_amount`/`_frequency`/`_duration_days`, the last a count of frequency units, §21), `end_reason`/`end_note` (voided/returned only), `lead_source`, `referred_by_contact_id` (§22), invoice fields (§24), `sales_channel_account_id`, `deposit_paid_via_account_id`, `balance_paid_via_account_id`, `processing_fee_amount` (a stored snapshot, §21.1), `fee_passed_to_buyer`, payment-link fields and `processing_fee_reports` (§32), `integration_reviews` (§19). Changing `registration_type` asks whether the Full surcharge follows (`saleDefaults.priceForRegistrationChange`). |
| **Contract** | `contract_type`, `kennel_id` | `status` (default `draft`), `related_sale_id`, `related_stud_service_id`; `related_dog_id` and `related_contact_id` only for `lease`/`co_own`/`foster`/`other` (forced null otherwise, `contractRepo.normalizeLinks`), `document_url`, `signed_date`, lease dates, e-sign fields and `integration_reviews` (§32), `title`, `terms_summary`. |
| **StudService** | `direction`, `our_dog_id`, `partner_dog_id`, `partner_contact_id`, `status`, `kennel_id` | `direction` is **who travels** (`STUD_SERVICE_DIRECTION`: `to_partner` our dog goes to them, `to_us` their dog comes to us, `shipped` no one / AI). Whether our dog is the stud or the dam isn't stored: it's our dog's sex, else the partner's opposite (`studRules.ourRole`; `STUD_SERVICE_ROLE` for badges and filters). `sent_date` / `returned_date` are the service's two dates, labelled **Begins / Ends**. `type` (`in_person`/`ai`) is set by the repo from `direction` (shipped → ai), never asked. `pairing_id`, `fee_amount`, `fee_structure`; `pick_status` and `pick_value_amount` only for pick fee structures (forced null otherwise; with our stud the pick is our puppy, and `pick_status` claimed / waived ends Today's `studpick`, §19), `referred_by_contact_id`, invoice fields (our stud only, §24). |
| **Event** | `subject_type`, `subject_id`, `event_type`, `event_date`, `title` | `event_end_date`, `reminder_date`, `reminder_dismissed`, `related_dog_id`, `related_contact_id`, `details{}`. No cost field: a cost becomes an Expense with `event_id` (§8, §21). |
| **Expense** | `subject_type` (`dog`/`litter`/`pairing`/`kennel`), `subject_id`, `amount`, `category`, `expense_date` | `event_id`, `stud_service_id` (indexed; the stud service whose fee it records, in `STUD_SERVICE_REFERENCES`; private like every expense field), `miles` × `mileage_rate` (then `amount` is derived), `vendor`, `receipt_number` (CSV re-import key, §9), `account_id`, `receipt_file_id` (deleted with the expense, §26.1), `reimbursable`/`reimbursed_date` (§21, §25). |
| **Document** | `dog_id`, `doc_type`, `file_id` | `title`, `doc_date`, `issuer_or_lab`, `result`, `registry`, `registration_number`, `contract_id` (optional, unindexed, not in the registry), `furever_shareable` (§27). Fields shown per type: `vocab.documentFieldsFor`. `hardDelete` removes its file. |
| **File** (`files`) | `blob`, `mime`, `filename`, `size` | `thumbnail`. Always a PDF. Owned by its one Document or Expense; fetched by id only (§26.1). |
| **WaitlistEntry**, **WaitlistOffer**, **WaitlistProgram** | see §29 | One entry per family per time on a kennel's list; position and passes are derived, never stored. |
| **Account** (`accounts`) | `name` | `account_type`, login fields (private), referral fields, fee rate, `contract_forms[]`, `payment_link`, `payment_instructions` (§32). Program-wide, no `kennel_id`. API keys live in `device_secrets`, never on the record. |

**Litter delivery.** `Litter.delivery_type` is asked only once the litter is Whelped or
later (`vocab.WHELPED_OR_LATER`). The Litter page hides the field before that, so a status
change redraws the form with it, and keeps a stored value hidden rather than clearing it.
When a litter is created at Whelped or later, or first gets there, with none recorded, the
page asks for it ("How was this litter delivered?", **Save** / **Not now**) before its
linked-pairing prompt. Kels's Record a new litter asks it after the counts; the tidy-up
raises a whelped litter without it (§33); the litter CSV import takes a `delivery_type`
column (labels, or words like "elective c-section"). A dog's Litters list shows it as a pill
after the status, by its `short` label (Natural, Assisted, Planned C-sec, Emergency C-sec;
the full name on hover).

**Kennel scope.** `Pairing`, `Litter`, `Sale`, `Contract`, `StudService`, `Document`, and
owned dogs carry a required own-kennel `kennel_id`, **stamped on create** from the parent (a
sale from its dog, a puppy from its litter…), else the active kennel, and never derived at
read time. Every list, hub and report filters on it (`data/kennelScope.js`). Not filtered,
each with a comment at its call site: pedigree/lineage walks, detail pages reached by id
(an out-of-scope record shows a "belongs to <kennel>" banner), external/leased dogs, and
the contact pool. `Event` and `Expense` take their subject's scope (`subjectInScope`).
Choosing among several own kennels is Pro only (`editionFlags.multiKennel`). Spec:
`docs/KennelOS_Multi_Kennel_Scope_Spec.md`.

### 4.2 Relationship direction

**Every relationship has one stored side; the reverse is a derived query, never a second
pointer.** For example: `Litter.pairing_id` (reverse `litterRepo.getForPairing`),
`StudService.pairing_id` (`studServiceRepo.getByPairing`), a Contract's `related_*` links
(`contractRepo.getBySale`/`getByStudService`/`getByDog`/`getByContact`), `Expense.event_id`
(`expenseRepo.getByEvent`). Need a reverse? Write a query; don't add a mirror field.

### 4.3 Settled — do not re-litigate

- **One `Dog` table** for breeding stock, puppies and external dogs; a life-stage change is
  a `status` update.
- **One polymorphic `Event` table** for all dated history.

---

## 5. Dexie schema (`data/db.js`)

`db.js` is the schema (DB name `KennelOSBreedingApp`); read its `version(N)` blocks for the
index strings. `version(1)` holds every kennel table and is **frozen**. Later blocks add
only what's new: `version(2)` the device-only `sync_meta` (§34), `version(3)`/`(4)` the
account FKs on sales, waitlist entries and kennels (§21.1, §32), `version(5)`
`expenses.stud_service_id` (our dam's stud fee, §21).

**The versioning rule.** Schema changes are additive: a new table or index goes in a new
`db.version(N).stores({...})` block listing only what it adds, and a shipped block is never
edited. A new plain field needs no block. JSON backups stay backward compatible (see
`CLAUDE.md`).

**Index rules:**
- Index only what you query, filter or sort on. Every canonical FK is indexed so reverse
  lookups and the hard-delete guard are probes. Exceptions, plain and unindexed by design:
  `expenses.receipt_file_id`, `documents.contract_id` (fetched by id or scanned).
- `events` and `expenses` use the **compound** `[subject_type+subject_id]`. Don't split it.
- `*co_owner_contact_ids`, `*listen_sire_ids`, `*listen_dam_ids` are multi-entry.
- `kennels.public_id` is plain, not unique (`&`): `kennelRepo` enforces uniqueness so a clash
  reads as a sentence, not a `DexieError`. It isn't an FK, so no registry entry.
- `is_archived` is filtered in JS (IndexedDB can't key booleans).
- `files.blob` is the only binary field. `importExport.js` base64-tags it on export and
  rehydrates it on restore (`BACKUP_FORMAT_VERSION` 2). Any future Blob field must do the
  same, or `JSON.stringify` silently turns it into `{}`.

**Device-only tables** (`db.DEVICE_ONLY_TABLES`): `device_secrets` (the unlocked vault key,
an open unlock request, and her Jotform and Stripe API keys, each read and written only by
its key-store module) and `sync_meta` (§34). They're not kennel data: no registry entries,
never in a backup. Code that means "the records" iterates `db.dataTables()`. Reset App and
remote erase still clear them.

**A version bump waits on every other open copy.** IndexedDB installs a new version only once
every other connection on the device closes. A frozen background copy can block it, and
then every read hangs. `db.js` fires `DB_BLOCKED_EVENT` / `DB_READY_EVENT` (and
`isDbUpgradeBlocked()`) and `DB_VERSIONCHANGE_EVENT`; `app.js` shows "close every other
KennelOS tab" while blocked and "updated in another tab, reload" on a closed copy.

---

## 6. The repo layer

`repoBase.js`'s `makeRepo(tableName, references)` gives every entity one surface; each
entity repo wraps it with validation and derived queries:
`getById`, `getAll({ includeArchived })`, `create` (id, `is_archived=false`, timestamps),
`update` (merges; keeps `id`/`created_at`), `archive`/`unarchive`, `getDeleteBlockers`,
`hardDelete` (throws `ReferenceBlockedError` if anything points at the record, §7).
Every write calls `assertWritable()` first (Demo, §0.2) and marks the cloud backup dirty
(`settings.markDataChanged()`).

**Conventions:**
- `create`/`update` run `validate<Entity>` on the **merged** record.
- Repos hold only hard, non-interactive rules (required fields, pedigree cycles, sire ≠ dam).
  Soft warnings (sex mismatch, date order, weight drop) are the page's job; a repo can't
  prompt.
- Reverse lookups live on the repo (`dogRepo.getChildren`, `contractRepo.getBySale`…).
- The Event repo is `HistoryEvent`/`eventRepo`, **never a bare `Event`** (DOM global).

**Repo specifics:**
- **dogRepo**: cycle check in `validateDog`; `addPlannedTests` (dedupe on write);
  `getBreeds`; `getAll({ includePedigreeOnly = false })`.
- **Pedigree-only dogs** (`pedigree_only: true`): lineage-only ancestors, always
  `external`. `dogRepo.getAll()` leaves them out by default, which keeps them out of every
  roster, list, picker, report, Today, the waitlist, Companion/Furever and the Lite cap
  (`rosterCount.isActiveRosterDog` refuses them too, since the cap reads `db.dogs`). Only
  pedigree building opts in: `assets/pedigree.js`, `pages/pedigree.js`, `pages/dog.js`'s
  sire/dam pickers, and the dog CSV mapping's `loadExisting`. Their dog page hides the
  kennel sections. **Bring into use** clears the flag on the same record and runs full
  validation and the Lite cap. `pedigree_only` is a cloud field, or a cloud restore would
  turn every ancestor into an ordinary external dog.
- **Sale status rules** (`vocab.js`, re-exported by `saleRepo`): `isOpenSale` = not archived
  and not in `TERMINAL_SALE_STATUSES` (`delivered` + the released ones). Released
  (`returned`/`cancelled`/`voided`) frees the pup (`isPupAvailable`). **Cancelled** = the
  buyer backed out (a paid deposit stays earned); **voided** = it fell through on the
  kennel's side, so nothing on it is income (§21). `end_reason` must fit the status and is
  cleared unless voided/returned. `isLostSale` (voided, or returned for `health_problem`)
  is shared by Financials and the waitlist's restore (§29).
- **contractRepo**: `governingContract` (latest signed, derived) and
  `isLivePartnerContract` (drives partner Companion membership, §20).
- **kennelRepo**: preferred tests/breeds (dedupe on write; removing never purges a token
  an event uses); `addPreferredTest`'s breed tag, read by `testBreedsFor`/`testsForBreed`;
  `renamePreferredTest` (in place, breed tags kept; renamed to another test in the panel,
  the two become one with both tests' tags, untagged if either was; panel only, never a
  dog's planned tests or past events; Kels's Getting Started).
- **contactRepo.ensureType(id, type)** adds a role tag; sale, stud service and event saves
  use it (`buyer_referrer`, `stud_referrer`, `handler`, `vet`).
- **waitlistEntryRepo** keeps `Contact.waitlist_status` in step after every write
  (`waitlistRules.deriveContactWaitlistStatus`). **waitlistOfferRepo** checks entry, litter
  and offer share a kennel (§29).

**Derived aggregators** (no table): `incomeView.js` (income rows per Sale / our stud's
StudService component, earned vs anticipated; `incomeLineItems` feeds invoices, §21, §24)
and `litterFinances.js` (per-litter P&L, §21).

---

## 7. Referential integrity (`data/referenceRegistry.js`)

Archive is the normal remove and **never cascades**. Hard delete is for undoing a mistake,
and it is blocked while anything points at the record.

- Each entity has an array of every FK pointing at it (`DOG_REFERENCES`,
  `CONTACT_REFERENCES`…). `findBlockingReferences` counts them and returns `{label, count}`
  blockers; the blocking message is built entirely from the registry.
- Polymorphic Event/Expense subjects match through the compound index plus a
  discriminator. Every subject entity's array includes `expenses.subject_id`.
- The guard skips tables not in the current schema, so adding one is one appended line.
- **Leaves** (empty arrays): Contract, Expense, Document, WaitlistOffer,
  BreedFeedingSchedule.
- **Outside the registry on purpose:** a `files` row belongs to one Document or Expense and
  is deleted with it; `documents.contract_id` is cleared by `contractRepo.hardDelete`
  (`documentRepo.unlinkContract`). Neither ever blocks.
- `KENNEL_REFERENCES` includes every kennel-scope `kennel_id`, so a kennel in use can only
  be archived. `tests/referenceRegistry.test.js` checks every indexed `*kennel_id` and the
  waitlist FKs have entries.
- A waitlist listen-only choice naming a sire or dam blocks that dog's hard delete.

**When you add an FK anywhere, add its line to the registry**, or hard delete will silently
orphan rows, and a merge (§33, `data/recordMerge.js`) will leave rows pointing at the archived
duplicate. Merge moves every `DOG_REFERENCES` / `CONTACT_REFERENCES` field, plus its own
`EXTRA_REFERENCES` for unindexed id lists that can't block a delete
(`waitlist_offers.eligible_dog_ids`). A merge of any other kind of record (Scan for
duplicates, §10) doesn't read the registry: it replaces the other record's id in every field
of every record.

---

## 8. The Event model

One polymorphic table for all dated history: `subject_type ∈ {dog, pairing, litter}` +
`subject_id`. The type catalog is `vocab.js` `EVENT_TYPES`. Each type has:

- `subjects[]` — who can log it (`eventTypesFor(subjectType)`).
- `editionFlag` (optional) — exists only when that flag is on (`show` → `shows`).
  `enabledEventTypes()` filters every picker in one place; `EVENT_TYPES` stays complete so
  a backup from another edition still renders.
- `duration` — `instant`, or `span` (`event_end_date`): `medication`, `heat_cycle`,
  `boarding`.
- `badge`, and `fields[]` written to `details{}` (`text`, `textarea`, `number`, `date`,
  `combobox` = suggest, `select` = enforced; options are strings or `{value,label}`;
  `default` applies on create only).
- `relatedContact` — shows the `related_contact_id` picker (a string is its label: show →
  "Handler", vet_visit/surgery → "Vet"). Contacts on events are always the FK, never a
  `details` value. `contactFallback` keeps a typed vet name only where no contact is linked
  (KennelAssistant has no pickers).
- `titleFrom` — a `details` key that auto-fills the title until it's hand-edited.

**Cost lives in the ledger.** The event form's Cost field upserts an Expense with
`event_id` = the event; clearing it removes that expense (§21).

**Shows** (Pro, `docs/KennelOS_Show_Tracking_Spec.md`): one `show` event per dog per show
day. Points, majors and titles are **derived, never stored**: `data/showPoints.js`
(`trackProgress`, `showRecordFrom`, `getShowRecord`) tallies counting events (`entry_status`
`shown`, `points_toward` set, points > 0) against `vocab.TITLE_TRACKS`. A track with
`requires` (GCH → CH) counts only wins after the required title. Saving odd results raises
a soft confirm, never a block.

**Litter-wide logging** (`litter.js` → `openEventForm`'s `cascadeTargets`) writes one event
per checked puppy with the same `details`, except fields in `eventForm.js`
`PER_TARGET_CASCADE_FIELDS` (`weight_check` weights) which are per puppy. Saving a weight
below that dog's previous weigh-in (same-day AM/PM aware) asks to confirm.

Test-bearing types (`genetic_test`, `breed_specific_test`, `ofa_pennhip`) feed the test
vocabulary through `testTokensOf(event)`.

**eventRepo reads** (separate on purpose):
- `getForSubject(type, id)` — a timeline, newest first.
- `getBoardRows()` — dogs away on boarding now; the Away board's only source (`awayBoard.js`,
  §19; stud-service trips are boarding events too).
- `getUpcoming()`, `getScheduledPlacements()`, `getInRange(from, to)` (Calendar),
  `getByType(type)` (Shows page), `getDetailValues(type, key)` (suggestions).
- `getReminders()` / `getDismissedReminders()`. `reminder_date` is the app's **one**
  future-dated mechanism; snooze edits it, dismiss sets `reminder_dismissed`. Saving the
  next one through a reminder's Log new on Today dismisses it too (`fromReminder`).
- The 30-day "due soon" window (`DUE_SOON_DAYS`) is repeated in `reminders.js`,
  `dashboard.js` and `today.js`; keep them equal.

---

## 9. CSV import (`data/csvImport.js`)

A generic match-or-create engine. Every import is a **dry-run preview** (create / update /
needs review) before any write. Flow: `parseCsv` (headers → lower_snake_case, values
trimmed) → `buildPlan(entity, rows)` → the user reviews → `commitPlan`. The shared UI is
`assets/importView.js`.

**Rules:**
- **Natural key must be non-empty.** Keyless or partial-key rows always need review; they're
  never auto-matched or silently created.
- Names match case-insensitively and trimmed; dates exactly. A present but unrecognised
  enum or date is flagged.
- Relationship columns resolve against **existing** records only. An unresolved name is
  flagged, never invented. Two deliberate exceptions create a Contact at commit: Sale
  `buyer_name` and StudService `partner_contact_name` (each mapping's `prepareRecord`).
- **`kennel_name`** (Dog, Pairing, Litter, Sale, StudService; `resolveKennelColumn`) must be
  an own kennel, except on an external/leased dog. Blank = the active/sole kennel at commit;
  with several own kennels and "All kennels" showing, kennel-needing creates go to review
  (`flagMissingKennel`). Dogs also take `breeder_kennel_name` (any kennel).
- **Dog owner** (`owner_name`) resolves against Contacts. An external dog that would lack
  an owner goes to review, except a **new** external dog with no owner, which is created
  pedigree-only. An update never makes a dog pedigree-only.
- **Parents in the same file:** a sire/dam naming another row of the dogs file previews as
  resolved; `commitPlan` writes every row, then `linkBatchParents` sets the links.
- **Previewed = committable.** When a repo gains a required field, its mapping must fill it
  or send rows without it to review.
- **Column guide:** `data/csvImportHelp.js` (rendered by `assets/importHelp.js`, with a
  blank-template download). `tests/csvImportHelp.test.js` pins it to each mapping's
  `templateHeaders`, so **a new column needs its help line**.
- Kennels import first (other files point at them), so Import / Export lists Kennels, then
  Contacts, then Dogs.

**Natural keys:** Kennel = name (a new one is always an outside kennel; an update never
changes `is_own_kennel` or `public_id`); Dog = name + DOB **or** registration number
(`normReg`, shared with Pedigree Import); Contact = name; Pairing = sire + dam + planned
date; Litter = dam + sire + whelp date; Sale = dog + buyer + sale date; Event (dog subject)
= dog + type + date (title breaks ties; for `show` the title always counts); StudService =
our dog + partner dog + direction (always review on a match); Expense = `receipt_number` if
present, else subject + date + amount + category + vendor (re-import updates in place;
only non-archived rows not linked to an event are matched).

**Expense import** (`pages/expense-import.js`) uses the engine but its own review screen,
so each row gets an **Attach to** control (any dog, litter, pairing or kennel). A row with
`miles` is a mileage expense: category forced to `mileage`, rate defaulted from
`settings.getMileageDefaults()`, amount derived. No images cross over (§26.1 attaches
receipts).

**Waitlist application import** (Pro, `waitlist-import`; Waitlist Spec §5.1): each row is an
`applied` entry on one own kennel's list, keyed by email per kennel. Only a still-`applied`
match updates (answers and preferences only). Answers map to that kennel's form questions
(`waitlistForm.columnsFor`) and the entry keeps the wording it was imported under.

**Import several files** (`pages/import-batch.html`, `data/csvBatch.js`, every edition):
`detectEntity` guesses each file's importer from its column names (weighted by how
distinctive each column is), the user can change or skip any file, and `orderFiles` runs
files after the ones they link to (each mapping declares `links`). Each file then goes
through the normal preview. Expense and waitlist files hand off to their own screens
(`HANDOFF_ENTITIES`). Lite only guesses among its own importers.

**Adding an importer:** write one mapping object (`entity, label, templateHeaders,
requiredForCreate, loadExisting, buildIndex, classify, describe, repo, prepareRecord?,
links`), register it in `MAPPINGS`, and add its column guide. Keep `csvImport.js` clean
UTF-8 (no BOM).

---

## 10. JSON backup / restore (`data/importExport.js`)

The cross-device data path, and one of the two modules that write tables directly.

- `exportAll()` iterates every data table (no hardcoded list) → `{ schema_version,
  format_version, exported_at, collections }`. `downloadBackup()` saves it and stamps
  `lastBackupDate`. `{ encodeBlobs: false }` keeps Blobs for the cloud snapshot builder.
- `inspectBackup(obj)` validates shape and reports counts and unknown tables before writing.
- `restoreBackup(obj, mode)` sees only `db.dataTables()`:
  - `'replace'` clears every table first, so the result is exactly the file.
  - `'merge'` upserts by id. With `opts.keepNewer`, a row whose local `updated_at` is later
    than the file's is left as it is (a row missing `updated_at` on either side takes the
    file's copy). `planFileMerge()` counts `{ added, updated, newerHere }` without writing;
    the Import/Export page asks "Keep my newer edits / Take the backup's copy" only when
    `newerHere` > 0, and otherwise merges with `keepNewer`. Records with different ids are
    matched by content first (below).
  - `'cloud-merge'` restores a cloud snapshot: overlays only `syncRegistry` cloud fields, so
    private fields on the device survive; newer `updated_at` wins unless `overwrite`
    ("Restore as of…"); never deletes; missing files via `opts.fetchFile(sha256)`.
    `planCloudMerge()` counts without writing.
  - `'vault-merge'` restores a decrypted private-vault payload (whole rows). A locally newer
    row keeps its edits and gets its blank private fields filled. `planVaultMerge()` counts.
  - Unknown tables and fields are skipped. Every restore calls `markDataChanged()`.
  - A file restore points the `myKennelId` setting at the restored own kennel if it's unset
    or stale.
  - Before writing it awaits the edition hook `enforceImportDogCap` (Lite refuses a restore
    that would exceed its cap, all or nothing; cap spec §9).
- Bump `BACKUP_FORMAT_VERSION` only when an older build couldn't read the new file, and keep
  reading every older version.

**Matching records across devices (file / Dropbox Merge, and a device joining live sync;
`data/restoreMatch.js`, pure).** The same dog typed on two devices has two ids, so a Merge
would keep both. Before writing, the restore pairs such records by content, gives each pair
one id, and merges their fields. A sync join runs the same rules between this device's records
and the cloud's (`importExport.planJoinMatches` / `mergeJoinMatches`, §34), asking the same
questions (`assets/mergeQuestions.js`).

- **Only unclaimed records.** A record is eligible only if its id isn't on the other side:
  a backup record whose id isn't on this device, paired with a device record whose id isn't
  in the backup. An id match is never re-matched by content. Two records from the same side
  are never combined by a restore, however alike (that's Tidy up's job, in person). Pairs
  are one to one; a record with more than one candidate is asked about, never guessed.
- **Three levels.** *Same*: paired automatically. *Ask*: shown to her in the restore
  preview ("Are these the same?", with Not the same), before anything is written. *Never*:
  kept as two. Tables are matched in order (kennels, accounts, contacts, waitlist programs,
  feeding schedules, dogs, pairings, litters, pups, sales, stud services, contracts, events,
  expenses, documents and their files, waitlist entries, offers), each comparing foreign
  keys through the pairs found so far; so a dog she says isn't the same leaves everything
  hanging off it unmatched. The preview re-plans after each answer, since a Yes can make
  new pairs (a litter once its dam is paired).
- **The rules.**
  - *Own kennel*: Same on the same public id, or the same name (case and spacing ignored);
    Ask when each side has exactly one own kennel and the names differ. *Outside kennel*:
    Same on the same name; Ask when the website or location differs.
  - *Account*: Same on name and type. *Waitlist program*: Same on kennel and name.
    *Feeding schedule*: Same on breed.
  - *Contact*: Same on name plus a shared email or phone (last 10 digits). Ask on a shared
    email or phone with a different name, or the same name with nothing to compare. Never
    when the emails and the phones both differ.
  - *Dog*: Same on the same registered name (`dogSearch.nameKey`: titles, case,
    punctuation and spacing ignored), registration number (`normReg`) or microchip; or a
    pup of a paired litter with the same call name and sex. Ask on the same call name, breed
    and sex (two pups pair only through their litters, never by name alone). Never,
    whatever else agrees: known sexes differ; both have a registration number, microchip or
    birthday and it differs; one is the other's parent.
  - *Pairing*: Same on dam, sire and planned date. Ask on dam and sire with dates within 21
    days or blank on one side. Never across heats.
  - *Litter*: Same on the same paired breeding, or dam, sire and whelp date (the sire blank
    on both sides counts: a dam whelps once a day). Ask on dam and whelp date with the sire
    blank on one side, or both Expected for the same dam and sire
    with no breeding.
  - *Sale*: Same on pup and buyer. Ask when both have sale dates that differ and exactly one
    of the two has ended (Returned, Cancelled, Voided): a pup sold to the same family again.
    Several each side pair by closest sale date. Never on a different buyer. Price, deposit
    and status never tell two sales apart.
  - *Stud service*: Same on our dog, the partner dog and the begin date. Ask on the same
    dogs with dates within 21 days or blank on one side.
  - *Contract*: Same on type and the same paired sale or stud service; a lease, co-own,
    foster or other contract on type, dog and contact.
  - *Event*: Same on subject, type and date, where the type's short detail fields (vaccine,
    product, weight, AM/PM, result…; not long notes) agree wherever both have them. Never
    when one differs: two weight checks on one day are two events.
  - *Expense*: Same when it hangs off a paired event or stud service, on the same receipt
    number, or on subject, date, amount and category.
  - *Document*: Same on dog, type, date and title; its file goes with it (as does an
    expense's receipt file). *Waitlist entry*: Same on kennel and contact when both are
    open, or both closed with the same application date. *Offer*: Same on entry, litter
    and offer date.
- **Which id survives.** The backup's, so two devices that restore each other's files
  converge on one set of ids, unless this device has cloud backup (or live sync) on: then
  this device keeps its ids, so its cloud copy never sees records vanish and reappear. In a
  sync join it's always the cloud's, since the other devices already have it; the merged
  record is stamped now, so the join keeps it and pushes it up. A
  re-key replaces the old id everywhere on this device: every field of every record
  (nested ones included), device-only rows (`device_secrets`), and this app's settings
  (dismissals, drafts, My kennel, the active kennel).
- **Merging a pair.** A field blank on one side fills from the other. Where both have a
  value and they differ, the newer record (`updated_at`) wins, except a dog's call name,
  registered name, sex, sire and dam, which she chooses in the preview (a registered name
  that differs only in titles, case or punctuation isn't a clash). Lists of plain
  values (co-owners, tests, contact types) are joined; notes keep both. `created_at` is
  the earlier one.
- The Lite cap is checked against the dogs as they'll be after the whole merge.

**Duplicates on this device (the Import/Export "Duplicates" card; `data/duplicateScan.js`,
pure, and `assets/duplicateScanUI.js`).** **Scan for duplicates** runs the matching rules
above between two records on this device instead of across two devices, and adds the
tidy-up's duplicate dogs and contacts (§33), so anything either would call the same is raised.
- **Every kind of record the edition has** (`scanTables(flags)`): kennels (outside kennels need
  `contactsSection`), accounts, contacts, waitlist programs, feeding schedules, dogs,
  breedings, litters, sales, stud services, contracts, events, expenses, documents, waitlist
  families and offers; Lite scans its own kennels, dogs, breedings, litters, sales, events
  and expenses. Live records only. Demo has no Import/Export page.
- **Nothing merges by itself.** A rule's *Same* is "These look like the same…", its *Ask*
  "These might be the same…", with what the two have in common; she decides each pair. Two
  pups of one litter by call name are only ever *Ask*. Foreign keys compare as stored, so the
  card scans again after every merge: merging two records for one dam makes her two litters a
  pair. Records are bucketed by what a rule compares first, so a scan never compares every
  pair.
- **Not the same** is remembered on this device in the nudge ledger under `dup:<table>:<ids>`
  (dogs and contacts also under the tidy-up's key, so Kels doesn't ask either).
- **Merge…** (`recordMerge.mergeDuplicate(table, keepId, dropId, choices)`): she picks the
  record to keep (`suggestKeep`) and, where both have a value and they differ, which one wins
  (`duplicateConflicts`; dogs and contacts as the tidy-up, §33). Blank fields fill from the
  other, lists join, detail objects fill their blank keys, notes keep both; a kennel's public
  ID is never copied (the kept kennel's carries on). Dogs and contacts merge through
  `mergeRecords`; any other record has the other's id replaced in every field of every record
  (nested ones included; `files` aren't read), each stamped now. The other record is archived,
  never deleted, so live sync and cloud backup see an ordinary edit. Then this app's settings
  follow (`settings.remapStoredIds`). Refused: her kennel with someone else's, and the
  tidy-up's refusals for dogs and contacts.

**The Import/Export "Backup & restore" card** is *what* (Back up / Restore) × *where* (This
device / Dropbox, §26). A Dropbox push is a backup and a pull is a restore through the same
functions. **Every restore source lands in the one preview** with the same Merge/Replace
choice; a new source feeds that preview. Lite has no Dropbox axis.

---

## 11. First-run, sample data, seed, settings

### Settings (`data/settings.js`)
The only `localStorage` user besides `nudgeState.js`; pages never touch `localStorage`.
Every key is in its `KEYS` table (`kennelOS.*`), each with a getter/setter, and
`clearAllSettings()` (Reset App) drops them all. Notable ones:
- `cloudDirtyAt` / `cloudDirtySince`: the cloud backup's dirty signal. `markDataChanged()` is
  called by every write path (repos, `fileRepo`, `assistantSync`, every restore);
  `tests/cloudDirty.test.js` pins every direct writer. A push clears it only if nothing
  changed mid-push.
- `activeKennelId`: the kennel scope, read and written only through `kennelScope.js`.
- `myKennelId` / `myContactId`: the user's own kennel and contact.
- `guidedLitterDraft`, `guidedDogsDraft`, `guidedPeopleDraft`, `guidedFormDraft` and
  `prepChecks`: Kels's unfinished litter, her unfinished Add dogs, Add people and
  application form, and the optional checks ticked
  last time in Pups are going home (§33). Device-only.
- `meetKelsPending`: the Meet Kels card waits for the next page load (set by the first-run
  kennel setup's save, cleared when shown; First run, below). Device-only.
- `kelsFavorites`, `kelsTaskUse`, `kelsNoPromote`: her starred Kels tasks, when she started
  each (the last 60 days), and the ones she said not to move up (§33, Favorites). Device-only.
- `studTripsMigrated`: the stud-trip migration has run on this device (§19, Away board).

**Kept outside `KEYS` on purpose**, so Reset App leaves them: the Pro license record and
`deviceId` (§0.3); cloud `cloudSession`, `cloudBackupState`, `cloudDeviceId` (Reset App
turns backup off but keeps the sign-in, `appReset.stopCloudBackupAfterReset`); `eraseAck`
(the dead token after a remote erase, until the server acknowledges); `cloudTestServer`
(`?cloud=staging` / `?cloud=off` switch the edition to its staging server on a deployed
origin, shown by a TEST SERVER strip). `nudgeState.js` keeps dismissals under one key that
`appReset` clears itself; it's device UI state, never in a backup.

### Sample data (`data/sampleData.js`)
The "Thornfield Kennels" packet, seeded **through the repos** (same validation as real
data), with created ids tracked in one manifest setting (no `is_sample` flag), so clearing
is a lookup. It's broad on purpose: every hub has a live example for the tour, including a
second own kennel (Briar Hollow) for the kennel switcher, and, in Pro/Demo only, a show
record and a sample waitlist. When the user's own records point at sample ones, `clearSampleData()` reports them
(`contaminated`) and deletes nothing; `{ archiveConflicting: true }` archives those sample
records instead of deleting them, so the user's links keep resolving, and clears the rest. **Editing the seed changes a
shipped file, so it needs the usual cache bump.**

### Seed import (`data/seedImport.js`)
An optional breed → test vocabulary seed (`resources/common_tests_by_breed_seed.csv` or a
user file). It appends to `Kennel.preferred_tests` / `preferred_breeds` and tags each test
with its breed (`preferred_test_breeds`), creating no records. Both wizards (kennel tests
import page and kennel setup) use `assets/breedTestPicker.js`. Breed-scoped consumers read
`kennelRepo.testsForBreed`, so a dog only inherits tests for its breed plus untagged ones.

### Kennel setup (`data/kennelSetup.js`)
A **mandatory gate**: the app isn't usable until an own kennel exists
(`shouldRequireKennelSetup()`), and `app.js` reopens the modal on every load until then.
Demo is exempt. The owner Contact is always saved linked to that kennel.
`resolveMyKennelId()` repairs a missing or stale `myKennelId` when exactly one own kennel
exists (never while sample data is loaded). `showKennelSetupModal({ mode })` is
`required` (no way out; first run) or `cancellable` (editing from Import/Export).

### Reset and erase (`data/appReset.js`)
`resetApp()` clears every table and setting, leaving a never-visited state.
`eraseThisDevice()` (remote erase, §30) also clears KennelAssistant's database and every
`kennelOS.*` key, including the ones a reset keeps.

### First run (`app.js` → `assets/onboardingUI.js`)
On a fresh install, one Welcome card offers:
- **Start my kennel** → no sample data, then kennel setup (`required`). With a cloud server,
  its optional email field turns on cloud backup after the kennel is saved.
- **Take the tour** → seed Thornfield and start the tour. The only path that seeds.
- **I already use KennelOS** (cloud editions only) → sign in and restore the latest
  snapshot (`cloudBackup.restoreOnNewDevice`), which skips kennel setup.

Both ways out of the tour (finished or skipped) also end in the required kennel setup. Its
save sets `meetKelsPending`, and the page that loads next shows **Introducing Kels**
(`onboardingUI.maybeMeetKels`, once, never on Kels's own page): "Meet Kels, your KennelOS
guru! She's a sweet, fun-loving pup who can help simplify your kennel management and teach
you how to use KennelOS. To test her out, try the Getting Started flow now!", with **Try
Getting Started** (`kels.html?task=get-started`) and **Maybe later**. Nothing starts on
its own. A reopen of kennel setup from Settings doesn't set it.

Installing as an app is a dismissible Today card. Cloud UI in the shell (device check-in,
the backup scheduler, Today's backup nudges, the Import/Export Cloud backup card) is
described in §30; none of it loads when `cloudUrl` is null.

### Guided tour
A spotlight tour of the seeded packet. It reads records and never writes app data; its
progress lives in settings (`wizardStatus`, `wizardStepIndex`).
- `data/wizardState.js` (state machine, `isTourAvailable()` = sample data present),
  `data/wizardSteps.js` (the full step catalog, data only), `assets/wizardUI.js` (overlay,
  cards, nav entry, Resume pill). `app.js` calls `runWizardStep()` on every page; no page
  knows about the tour.
- The catalog and seed come from **`data/editionTour.js`**: the shared copy re-exports the
  full Pro/Demo tour; Lite's own copy has a smaller seed (within the cap, no Pro-only
  records) and Lite pages, plus `pro-promo` cards.
- Step kinds: `tour-intro` / `hub-intro` (centered card), `pro-promo` (Lite, centered), and
  highlight steps (spotlight with a card pinned top or bottom). Detail-page steps use an
  `anchor` slug resolved through the seed manifest's `named` map.
- **Finish** and **Skip tour** both go through `endTour()`: clear the sample data (with
  `archiveConflicting`), then the required kennel setup, so nobody files real
  dogs into a sample kennel.
- Restartable from Import / Export's "Guided tour" section while sample data is present.

---

## 12. Service worker / PWA (`sw.js`)

A cache-first app-shell service worker, so the app installs and works offline.

- **Edit only `shared/sw.js`.** `build/assemble.mjs` generates each `dist/<edition>/sw.js`
  with its own cache name and a precache filtered to that edition's files (Lite drops
  `proPages.js`'s files; Demo drops `DEMO_EXCLUDED_PAGES`).
- `PRECACHE_URLS` lists **every** app file. `cache.addAll` is atomic: one missing path fails
  the whole install. Files are fetched with `cache: 'reload'`, so a new version never
  precaches a stale copy. `activate` deletes old caches.
- An installed client sees changes only when `CACHE_NAME` changes. Add/rename/remove a file
  → update `PRECACHE_URLS` in the same edit. Bump `CACHE_NAME` once per shippable batch,
  **after asking the user** (the rule is spelled out in `CLAUDE.md`).
  `tests/serviceWorker.test.js` checks the precache against the files on disk.

---

## 13. UI layer

### The two list frameworks — different escaping contracts

- **`assets/reportView.js`**: a column's `value:(r)=>string` returns **plain text**; the
  framework escapes it. Also `badge` columns, `tone` (badge a value), `groupBy`, CSV export,
  and the report extras (`dateRange`, `kpis`, `charts`, column `total`, Print/PDF), all
  computed from the visible rows (§31).
- **`assets/listView.js`**: a column's `cell:(r)=>html` is injected **raw**, so **the caller
  must `esc()` every user value**. Sortable columns, filters, "show archived", grouping, CSV.

Both take an optional `scope:(record)=>bool` (the kennel-scope predicate: `inScope`,
`dogInScope` or `subjectInScope`), applied before search and filters, which also shows the
"🏠 <kennel> only" chip. A list that omits it says why in a comment (Contacts).

When in doubt: `value` = text (escaped for you), `cell` = HTML (you escape).

### Shared helpers (`assets/ui.js`)
`esc` (use on every user value in hand-built HTML), `badge`/`badges`, `fmtDate`, `param`,
`confirmAction` and the modal dialogs, `wireActionMenu`. `todayYMD` is re-exported from
`data/dateUtils.js`.

### Components
- **timeline.js** — a subject's events with add/edit/archive/delete; `onChange` lets a page
  redraw derived panels.
- **pedigree.js** — ancestor tree from `sire_id`/`dam_id`, depth-capped (default 3, so
  cycle-safe), plus a derived Offspring section.
- **kennelTree.js** — the Pedigree page's Whole kennel view; layout is the pure
  `data/kennelTree.js` (families, generations, sire × dam unions, lanes so lines never run
  behind cards). Archived dogs included; pedigree-only ancestors behind a checkbox; not
  kennel-scoped.
- **eventForm.js** — the event modal (§8). Event has no page of its own, so
  `openEventFromQuery` lets a subject page open one: `openEvent=<id>`, or
  `logEvent=<type>` with optional `logDate`, `logTitle`, `logEnd` (a span's end),
  `logContact` (related contact id), `logDetails` (JSON), `fromReminder` (an event id:
  saving dismisses that reminder when its subject and type match; Today's Log new).
- **contactPicker.js** — `attachNewContactButton(select, {onCreated, defaultType,
  defaultName})` adds an inline "＋ New" contact; `onCreated` runs before the `change` event.
  In Lite the type list is Buyer only.
- **kennelScopeUI.js** — the nav switcher, the list chip, and the out-of-scope banner on
  detail pages (`#scope-notice`). Inert unless `editionFlags.multiKennel`. Switching scope
  reloads the page.
- **cloudBackupUI.js** / **cloudVaultUI.js** — every cloud screen (§30). Imported only
  dynamically and only when `isCloudAvailable()`; the vault UI only by the backup UI.
- **expensePanel.js** (§21), **puppyForm.js**, **importView.js** (§9),
  **onboardingUI.js**, **sampleDataUI.js**, **kennelSetupUI.js** (§11).

### Navigation (`nav.js`)
Hubs come from the edition's `navItems`: Pro/Demo **Today / Dogs / Breeding / People /
Placements & Contracts / Financials / Storage / Sharing**; Lite **Today / Dogs / Breeding /
Sales / Financials**. A "More" menu holds Reports, Import/Export and Settings. Some hubs are
one page with `seg-tabs` to its siblings: Placements & Contracts (sales, stud services,
contracts), Sharing (companion, furever, assistant), Storage (documents, shows, accounts —
all Pro, so Lite has no Storage hub), People (contacts, waitlist). `HUB_CHILDREN` maps
detail and sibling pages to the tab that lights up. Links are root-relative and prefixed
at render time, so they work from any GitHub Pages sub-path. The brand line shows the
edition and, underneath, the kennel name. The kennel switcher sits before "More".

### Pages (`pages/`, one `.html` + `.js` each)
Pro-only pages are listed in `data/proPages.js`; everything else ships in every edition.
- **Hubs:** `today`, `dogs`, `breeding`, `contacts`, `sales`, `financials` (§21), `reports`
  (§31), `companion` (§20), `furever` (§27), `assistant` (§26), `documents` (§26.1),
  `shows`, `accounts` (§32), `import-export`, `settings`.
- **Records:** `dog` (includes the Show Record card when the dog has shows), `roster`,
  `pedigree`, `pairing(s)`, `litter(s)`, `active-breeding`, `live-births`, `contact`,
  `kennels` / `kennel` (§28), `sale(s)`, `stud-service(s)`, `contract(s)`, `waitlist*` (§29),
  `breed-feeding-schedules` (§27).
- **Today cluster:** `dashboard`, `reminders`, `upcoming`, `board`, `scheduled-placements`,
  `calendar`.
- **Print docs:** `invoice` (§24), `puppy-record` (§23).
- **Imports:** `*-import` per entity, `import-batch` (§9), `pedigree-import` (below).
- **Reports:** every `*-report` page (§31).

**The Kennel page** (`kennel.html`) shows one section card at a time, chosen from a
**Section** dropdown (`SECTIONS` in `kennel.js`) or `#<section>` in the URL; cards for this
kennel's own data filter on its id, not the active scope. An outside kennel gets only
Kennel expenses, Logo and Kennel card. The Logo, Lifecycle nudges and Puppy Record fields
cards build their fields from `assets/kennelSettingsFields.js` (`fileToLogoDataUrl`,
`logoPreview`, `nudgeFields` / `readNudgeFields`, `puppyRecordFieldsHtml` /
`wirePuppyRecordFields` / `readPuppyRecordFields`; Pro-only, in `proPages.js`), which Kels's
Getting Started uses too.

**The Calendar** (`calendar.html`, every edition): a month grid of `eventRepo.getInRange`
plus reminders, scoped by `subjectInScope`. Open-ended spans draw on their start day only
(`calendarMath.eventSpan`). A day's modal has an **Add to Google Calendar** link
(`calendarMath.googleCalendarUrl`: an all-day prefill, never notes). Nothing leaves the
device until it's clicked.

**The Shows page** (Pro): Upcoming and Results tabs over `eventRepo.getByType('show')`;
**+ Add entries** creates one event per picked dog × day, skipping duplicates.

**Pedigree import** (`pedigree-import.html`, every edition): PDFs or images are read in the
browser, nothing uploaded. `data/pedigreeReader.js` uses the PDF.js text layer, or renders
and OCRs the page. `data/pedigreeParse.js` (pure) turns positioned words into dogs by path
(`''`, `s`, `d`, `sd`…). `data/pedigreeImport.js` plans with the CSV rules: a registration
number (`normReg`) is the key and merges automatically; a name alone never matches (same
name → review); an existing dog only has blanks filled and keeps its parents. New dogs are
saved pedigree-only. In Pro a chart can also be filed as a `pedigree` Document.

---

## 14. Data conventions (quick reference)

- `id` = `crypto.randomUUID()`. Soft delete only; never cascades.
- Date-only fields are `YYYY-MM-DD`, compared lexicographically; "today" is local
  (`todayYMD`). Only `created_at`/`updated_at` are full ISO.
- Money is decimal, never cents.
- Pickers exclude archived by default. Vocabularies live only in `vocab.js`; dropdowns and
  badges both read it.

---

## 15. Deliberately NOT built

Don't assume these exist:
- Computed COI or relatedness (only the user-entered `Dog.recorded_coi`).
- Genotype or carrier-risk analysis; a test-completeness audit.
- Recurring events (`reminder_date` is the only future-dated field).
- Photo galleries on dogs or litters. Files exist only as Document and receipt PDFs (§26.1)
  and the kennel logo.
- Pairing- or litter-subject events in the CSV importer (dog only).

---

## 16. Invariants checklist (before you commit)

1. **Layering:** no page imports `db.js` or touches `localStorage`.
2. **Reverse relationships** are queries, not mirror fields.
3. **New FK** → `referenceRegistry.js` line (hard-delete guard and merge both read it). **New field** → classified in `syncRegistry.js`
   (`tests/syncRegistry.test.js`); a cloud field also regenerates
   `cloud/src/lib/cloudFields.js`. **New direct `db` write** → `markDataChanged()` or an
   exemption in `tests/cloudDirty.test.js`.
4. **Escaping:** `esc()` every user value in hand-built HTML and `listView` cells.
5. **File set changed** → `PRECACHE_URLS` (and `proPages.js` if Pro-only); `CACHE_NAME`
   bumped once per batch after asking.
6. **Schema:** additive `version(N)` blocks only; backups stay backward compatible (§5).
7. **Edition-agnostic core:** no hardcoded cap or edition check; use `editionFlags` or the
   cap hooks (§0).
8. **Cloud:** nothing runs before `isCloudAvailable()`; `cloudUrl: null` makes no request.
9. Clean UTF-8, no BOM. `node --check` touched files; `node --test` passes.

---

## 17. Local development

```bash
python3 -m http.server 8000   # repo root; open http://localhost:8000/shared/ (never file://)
node --test                   # tests/ + cloud/tests, Node ≥ 22, no dependencies
node build/assemble.mjs       # edition builds → dist/ (serve dist/<edition>/ to try one)
```

No bundler or linter. Reset state with **Reset App to Start**; get sample data from the
first-run tour.

---

## 18. Common maintenance recipes

**Add a field:** form/detail page; an index in a new `version(N)` block only if you query
on it; a repo rule only if it's hard; a registry line if it's an FK; classify it in
`syncRegistry.js`; CSV mapping, column guide and sample data if relevant.

**Add an event type:** one `EVENT_TYPES` entry in `vocab.js` (add `editionFlag` if Pro-only).
The form, timeline, badges and importer pick it up.

**Add a report:** a page calling `createReportView`, with pure math in a tested `data/`
module; list it in `reportCatalog.js`, `proPages.js` and `sw.js` (`tests/reports.test.js`
checks all three).

**Add an entity:** a table in a new `version(N)` block, a `makeRepo` repo with a validator,
its registry array and lines, sync registry entries, list/detail pages, a CSV mapping if it
imports, nav wiring, sample data, and precache entries.

**Add a page:** precache it (and `proPages.js` if Pro-only).

---

## 19. Derived nudges & the away-board union

**Editions:** All editions. Show, waitlist and vendor nudges are Pro (their flags). In Lite
the dead-puppy nudge offers **Remove from program** instead of Archive.

### Nudges (`data/nudges.js`)
`computeNudges()` reads current records only and returns
`{ key, title, detail, subjectHref, actions: [{ label, run }] }`. It never changes anything
by itself: every action is a button. Each `key` is stable, so a dismissal survives
recomputing. Rules iterate the **kennel-scoped** records, but their "already handled?"
checks use the unscoped set, so an answer one kennel over still counts.

`pages/today.js` renders them: it filters out dismissed keys (`nudgeState.isDismissed`),
wires each action, and adds one Dismiss button per row. Dismissals are device-local
(`nudgeState.js`), never in a backup.

| Key prefix | Fires when | Offers |
|---|---|---|
| `studboard` | a stud service's boarding (`studRules.studBoardingFor`: a `boarding` event on the dog that travels, reason "Stud service", dates overlapping the service's) ended before today, and the service's dates differ or it's still arranged / in progress (`boardingEndedUpdate`) | **Update it**: its dates from the stay, Completed. Stands in for `studstatus` on that service |
| `studstatus` | a stud service's sent/returned date passed but status lags | `in_progress` / `completed` |
| `promote` | a kept puppy is past its kennel's promote age (opt-in per kennel) | promote to active breeding |
| `studpair` | a finished stud service has no `pairing_id` | create the pairing |
| `heatpair` | a heat cycle ended with no pairing for that dam since | create a pairing |
| `pairingduesoon` | a bred/confirmed pairing is due within 3 days, no litter | create the litter |
| `studpick` | a completed stud service of our stud with a pick in its fee (`pick_of_litter` / `flat_plus_pick`), 63 + 56 days after it (returned, else sent; `studRules.pickDue`), no pup of that stud out of that dam born since on file, `pick_status` not settled (claimed / received / picked / done / waived) | **Add the puppy** (`dog.html?new=1&pick=<id>`) / **Not getting one** (`pick_status: 'waived'`) |
| `pairingoverdue` | a pre-whelp pairing is past due, no litter | mark whelped / create litter |
| `litterpairing` | a whelped-or-later litter's pairing isn't `whelped` | mark it whelped |
| `pairingended` | an ended pairing still has an `expected` litter | archive the litter |
| `pairingnolitter` | a `whelped` pairing has no litter (not for external dams or pairings over 180 days old) | create the litter |

**Our stud's outside breedings.** A pairing linked to a live stud service where our dog is
the stud (`studRules.ourStudPairingIds`: our stud, somebody else's dam) can be recorded like any
other, but its litter is the dam's owner's: `pairingduesoon`, `pairingoverdue` and
`pairingnolitter` skip it, the Pairing page's "Record the litter now?" doesn't ask, and
Kels's tidy-up doesn't suggest recording it. Its pick puppy, when the fee has one, is
`studpick` above.
| `deceased-sale`, `deceased-pairing` | a deceased dog has an open sale or a pending pairing | end the sale / cancel or fail the pairing |
| `deceased-archive` | a puppy died in its first year (last 90 days) | Archive (Lite: Remove from program) |
| `littersold` / `litterreopen` | a `ready` litter's roster is all placed/keeping/health hold with one placed (and it can't close yet) / a sold or closed litter has a pup available again | change litter status |
| `litterclose` | `litterCheckin.litterCloseDue`: a born litter at any status but `closed`, no live pup `available` or `undecided` (blank = undecided; keeping, health hold and grown-up pups don't count), no open sale on any of its pups (`isOpenSale`), and one `delivered` sale. Sales come from every pup of the litter, archived ones included (`litterSalesOf`), and it's checked even when no live pup is left | close the litter |
| `gohome-schedule` / `gohome-boarding` / `gohome-overdue` | `goHome.goHomeIssue` for a pup with a sale at `deposit_paid`/`paid_in_full`: from 7 days before the ready date, no pickup (`placement` event for that buyer, or with no contact) today or later and no boarding running / the sale has a `deferred_boarding_amount` and no boarding logged from 7 days before the ready date on / the latest pickup date has passed | the pup's event form prefilled (pickup or boarding) / `sale.html?id=…&deliver=1` |
| `show-title` | a show track is complete with no `title_earned` event | prefilled title event |
| `int-review` | a vendor event wasn't applied (`integration_reviews`, §32) | open the record; Done removes it |
| `follow-up` | a pup went home 7–60 days ago (`referralShare`) | write a thank-you note |
| `waitlist-*` | new applications, an offer or fee past due, a removal's undo window, planned deposit date reached (`open-picks`), "Ready now?" unanswered, family messages, and family requests (pref, pause, listen, Companion link) | the matching waitlist action (§29) |

Litter-lifecycle rules ignore deceased pups. The same close rule runs on the Sale page: a
save that moves a sale into delivered / returned / cancelled / voided asks **Close the
litter?** when `litterCloseDue` holds (`sale.js` `promptCloseLitter`, last of the post-save
prompts). `sale.html?id=…&deliver=1` opens an open sale in edit with Delivered chosen, so her
Save runs delivery's prompts. The linked-status rules back up prompts the
litter, pairing, dog and sale pages show on the edit itself, for changes made elsewhere
(import, sync, another device).

**Today's "Upcoming shows" card** (Pro): `show` events in the next 14 days; Today's
"Due outs" list leaves shows out so each appears once.

### Away board (`data/awayBoard.js`)
`getAwayBoardRows()` turns the boarding events running now (`eventRepo.getBoardRows`) into one
row shape, used by `board.js`, Today and the dashboard tile. A stud service's trip is a
boarding event like any other; the service's own dates never make a row. Saving a stud
service where someone travels (new, or its dates or who travels changed, and no stud
boarding yet, `studRules.studBoardingFor`) asks **Log the boarding?** and opens the event form
prefilled (`studBoardingPrefill`: the dog that travels, the two dates, reason "Stud service",
the partner, where they stay: the partner's address, or "With us"). On boot,
`studServiceRepo.migrateStudTrips` reads a pre-"who travels" `direction` (outgoing /
incoming) as `shipped` for AI, else `to_partner`, and (once per device, `settings.
studTripsMigrated`) gives every in-person, not-cancelled service with a start date and no
stud boarding its boarding event. Kennel scope is applied inside `getAwayBoardRows`, through
the away dog, so the three can't disagree.

---

## 20. Companion share-out (buyers & partners)

**Editions:** Pro and Demo only (`editionFlags.companion`; `companion.html` and
`companion-view.html` are in `proPages.js`). `data/companionExport.js` still ships to Lite
because shared code imports it.

A **one-way, point-in-time snapshot** of a recipient's own slice of the data, sent as a
no-account, read-only link. Not sync, not a login, not a live view.

### Bundle types (all anchored on a Contact)
- **`prospective`** (a contact with `waitlist_status === 'active'`): available pups, one card
  per litter, with parents' cards (`dogCard`: names, photos link, completed tests) and each
  pup's per-sex list price and deposit. The same for every prospect: nothing private.
- **`family`** (a buyer with an open sale, `isOpenSale`): one card per pup on an open sale:
  names, parents, computed age (never the DOB), placement or ready date, their own sale's
  money with a computed remaining balance (net of a credited waitlist fee, §21), contracts
  as `{signedDate, documentUrl}`, and a curated event history (one safe field per type for
  vaccination, preventative, weight, milestone, note; never `notes`, never
  illness/injury/evaluation).
- **`partner`** (the partner on a current stud service, or the counterparty on a live
  lease/co-own/other contract): stud/dam cards, agreement terms, and the live contract per
  agreement (`contractRepo.isLivePartnerContract` + `governingContract`). The same predicate
  drives partner membership, so who appears and what they see can't drift.

### The console (`pages/companion.*`)
One tab per bundle type (`?type=`); the tab is the type. Each recipient row expands to the
`companion_note` editor, **Preview** (the real `companion-view.html` in an iframe, sending
nothing) and **Prepare link**. Both use `buildSendArtifacts`, so the preview can't differ
from the send.

**Messaging:** per-type template copy (kennel name, tagline, intro, announcement, closer) in
`settings.js` `companion`, plus the per-recipient `Contact.companion_note`. **What to
include:** per-type boolean flags (`companion[type].include`, all default on, deep-merged so
new flags default on). Flags **only subtract**: a disabled part is emitted empty, never as a
new key. Master flags (`parents`, `pricing`, `studServices`) gate their children.

### The load-bearing invariant: the allow-list builder
`data/companionExport.js` builds each bundle **field by field**, reading through repos, with
no record spread. `assertOnlyKeys()` checks the top level against `PROSPECTIVE_KEYS` /
`FAMILY_KEYS` / `PARTNER_KEYS` and **aborts the send** on anything extra. A new field on a
source table never reaches a bundle until someone adds it here by name. Money is only ever
the recipient's own.

### Transport and the shell
- The bundle rides the URL fragment: JSON → lz-string (vendored) →
  `companion-view.html#<hash>`, built by `assets/companionLink.js` (shared with Kels's share
  step, §33). Send is a real `sms:`/`mailto:` anchor the user taps. SMS is blocked above
  `MAX_SMS_HASH_LEN` (1800); email warns above `MAX_EMAIL_HASH_LEN` (12000).
- `companion-view.html` is a standalone, read-only page with lz-string inlined. **It must read
  every `bundleVersion` ever sent** (`COMPANION_BUNDLE_VERSION`, currently 1): bundles evolve
  additively, and a shell fix must not break last month's links.
- **No revocation or expiry.** Documents are never in the link, only `document_url` (her Drive
  sharing controls access). The "snapshot as of" date shows prominently.

---

## 21. Financials — income & the Expense ledger

**Editions:** All editions. Lite hides the invoice/receipt button (`invoicing`), receipt
attach (`receiptAttach`) and the Account picker (`accounts`). Waitlist fees and processing
fees from Accounts are Pro only.

The Financials hub (`pages/financials.*`) has three views
(`?view=overview|income|expenses`): **Expenses** (the ledger, with one tab per
`EXPENSE_CATEGORIES` value via `&bucket=`), **Income** (derived, Earned and Anticipated
boxes; a row opens an **Adjust** modal that writes back to the sale or stud service), and
**Overview** (earned / anticipated / spent / **Net = earned − spent** tiles and breakdowns).

### Expenses — the one home for money spent
- `expenses` is polymorphic (`dog`/`litter`/`pairing`/`kennel`). Overhead goes on your own
  kennel; there is no "general" subject and never a null `subject_id`. Revenue is never
  stored here.
- **Mileage** is a repo rule: when `miles` is set, `expenseRepo.normalize` derives
  `amount = round(miles × mileage_rate, 2)` and the category is `mileage`. Both expense
  forms share `buildMileageFields`/`wireMileageMode` and preview with `mileageAmount`.
- Buying a dog is an **expense** (`dog_purchase`), never a Sale.
- **Event ↔ cost:** `Expense.event_id` is the only link. The event form's Cost field upserts
  or deletes its expense; its category defaults from `defaultExpenseCategoryFor(event_type)`
  (`veterinary` only for real vet care; tests → `testing`; `show` → `show`; …). An unlinked
  expense on a dog/litter/pairing offers **Log event →**, which back-fills `event_id`.
- **Foster and reimbursables (§25):** the partner's cut is a real `foster_split` expense; a
  reimbursed `reimbursable` expense drops out of litter cost, and a pending one shows as
  "Owed back".
- `assets/expensePanel.js` is the per-subject ledger on dog, litter, pairing and kennel pages.

### Income — derived, never stored (`data/incomeView.js`)
There is no income table and no `is_earned` field. `getIncomeRows()` reads Sales, our stud's
StudServices and (Pro) waitlist fees, and classifies each money component on every load.
Kennel scope applies to the source records here, so every money screen agrees; a
`kennelId` argument overrides it for the kennel page. Expenses are scoped through their
subject (`financials.js` `expenseInScope`).
- **Sale:** deposit, balance (price − deposit), transport and deferred boarding (amount ×
  count). A part is **earned** once its paid date is set or the status has passed it, else
  **anticipated**. Returned/cancelled keeps only what was paid. A **lost** sale
  (`vocab.isLostSale`) counts nothing: it's refunded or carried to another pup (§29).
  `paidOnSale()` reads what was paid regardless of status.
- **Our stud's fee** (`studRules.ourRole` = stud): earned when `completed`, anticipated while arranged/in progress.
- **Our dam's stud fee** is money paid, so it's an Expense, never income. Saving a stud service
  of our dam that's Completed with a fee and no linked expense (new, just Completed, or the
  fee changed; `studRules.studFeeExpenseDue`) asks **Log the stud fee as an expense?**: a
  `stud_fee` Expense for the fee, on the linked breeding (else our dam), dated the service's
  end (else start), the partner as vendor, `stud_service_id` set so it's asked once
  (`studFeeExpense`).
  `pick_value_amount` is a separate non-cash `pick` line, outside the cash totals and Net.
- **Waitlist application fee** (Pro): one earned row per entry with a received fee above 0.
  When `fee_credit_policy` is `credited_to_purchase` and the family is placed, the fee comes
  off that sale's balance (`saleComponents(sale, feeCredit)`, `getSaleFeeCredit`) so it isn't
  counted twice; invoices and the Companion balance show the credit.
- Vocab: `INCOME_STATES`, `INCOME_SOURCE_TYPES`, `INCOME_COMPONENTS`.

**Per litter:** the Litter page shows a simple Sales & Income panel (each sale's total and
status). The **Litter P&L** report (`data/litterFinances.js`) is the full picture: income vs
the litter's expenses plus its puppies' expenses.

### 21.1 Processing fees — `docs/KennelOS_Integrations_Plan.md` §5
A sale through a marketplace or payment service loses a fee (percent + fixed). The **price
stays gross and income is price − fee.**
- The rate lives on the Account (`fee_percent`, `fee_fixed`, `fee_passed_to_buyer_default`).
  The Sale stores `processing_fee_amount` as a **snapshot**: filled from the rate on the
  price, followed by price changes only while it's still the filled value, never re-derived.
  Deposit/balance paid-via accounts estimate it per payment, and a processor's reported fee
  replaces the estimate (§32).
- "Price that nets you $X" (`data/processingFees.js`, pure): `price = (net + fixed) ÷
  (1 − percent)`, rounded up. In Lite (no Accounts) she types the rate.
- Income takes the fee off as negative `processing_fee` components, split pro rata across
  the cash components, so earned is what she actually received.
- **Never buyer-facing:** invoices and Companion use `saleComponents`, which leaves the fee out.

---

## 22. Referral tracking (Sale / StudService "Referred by")

**Editions:** Pro and Demo only. Lite hides a sale's "Referred by" field and has no stud
services or Contacts section.

`Sale.referred_by_contact_id` and `StudService.referred_by_contact_id` are indexed FKs to the
referring Contact (`CONTACT_REFERENCES`). Saving tags that contact `buyer_referrer` /
`stud_referrer` (`contactRepo.ensureType`). A contact's referrals are a query.

---

## 23. Puppy Record (print-only PDF)

**Editions:** Pro and Demo only (`editionFlags.puppyRecord`; `puppy-record.html` and
`data/puppyRecordFields.js` are in `proPages.js`).

`pages/puppy-record.html?sale=<id>` is a printable record for a puppy being sold: puppy
info, sire and dam with their test results, a **Health History** grid (one card per
health-relevant event type; identical entries fold into one line with their dates; vet
visits print the linked vet's name, phone and address), and the buyer. Empty rows are
omitted. Read-only, through the repos.

- **Several pups in one file:** `?dogs=<id>,<id>…` renders each pup's record in its own
  `<section class="pr-pup">`, each after the first starting a new page (`break-before:
  page`). Each pup's sale is found from the dog (`prepPups.pupSale`: its newest open sale,
  else its delivered one); a pup with no sale prints without the buyer block. The kennel's
  field picks are the first pup's kennel's and apply to every pup. `?sale=` still prints one.
- **Cover page** (`&cover=1`): a page for the breeder, not the families, before the
  records: the litter, today, and per pup its family, drop-off date, and what's done and
  missing (`prepPups.readiness`, the same rules as Kels's Pups are going home, §33). `&checks=`
  limits the optional items to the ones listed (Kels passes hers); without it, all are shown.
  Field picks don't apply to it.
- **Download = the browser's Print → Save as PDF** (`window.print()` with an `@media print`
  block). Opened from a sale's page, the Sales page's Print Puppy Record picker (a litter
  with pups at home, then tick pups, ticked by default with a sale at Deposit paid or later;
  **Other puppies with a sale** for pups with a sale in progress on no such litter; an
  optional **Start with my readiness cover page**, off by default), or Kels's Pups are going home
  (`?autoprint=1`).
- **Fields per kennel:** the Kennel page's **Puppy Record fields** card saves
  `Kennel.puppy_record_fields` (only what's off). `data/puppyRecordFields.js` is the one list
  and `puppyRecordShows(kennel)` the read rule; anything not stored shows. A new printed field
  must be added to the list **and** gated with `shows(key)` in `puppy-record.js`.
- **Whose kennel:** the puppy's `kennel_id`, else the active kennel, else the sole own
  kennel; its name and logo head the record.

---

## 24. Invoice & Receipt (page + PDF)

**Editions:** Pro and Demo only (`editionFlags.invoicing`; `invoice.html` and the PDF modules
are in `proPages.js`).

`pages/invoice.html?source=sale|stud|waitlist&id=<id>&doc=invoice|receipt&cfg=<json>` is a
one-page invoice or receipt for one income record. **Nothing about an invoice is stored**
except the fields the generator saves on the record (`invoice_number`, `invoice_notes`, and
for receipts `payment_method`/`payment_reference`); everything is rebuilt on each view.

- **One model, two renderers:** `assets/invoiceDoc.js` `buildInvoiceDoc()` decides all the
  text; `invoice.js` draws HTML and `assets/invoicePdf.js` draws a PDF with vendored jsPDF
  (`vendor/jspdf.umd.min.js`, loaded only when a PDF is made; `pdfText()` keeps text
  Latin-1).
- **Lines** come from `incomeView.incomeLineItems` (§21): Deposit, Remaining Purchase Price,
  Transport Fee, Boarding Fee, Stud Fee, or the waitlist application fee. Never `pick`, never
  processing fees, and net of a credited waitlist fee.
- **Per-line choices ride `cfg`:** `{ key, mode: 'full'|'partial', collected, dueDate? }`.
  Partial prints the collected amount; Full prints the whole amount and treats `collected`
  as already paid (an invoice subtracts it, a receipt prints the remaining balance).
- **Invoice:** per-line Due by (prefilled from the sale's balance due date or scheduled
  placement, read live unless she changed it; Deposit is always "Immediately"), sale
  disclaimers as footnotes, and accepted payment methods
  (`settings.getInvoiceDefaults().acceptedMethods`, editable per document).
  **Receipt:** a Payment received box and a Paid stamp.
- **Issuer:** the record's kennel, else the dog's, else the active, else the sole own kennel,
  with its logo and the owner contact. Number defaults to `INV-/RCT-<yyyymmdd>-<id>`.
- **Generator** (`assets/invoiceGenerator.js`): opened from Financials and a Sale's page, both
  importing it only when `editionFlags.invoicing` is on. It opens the new tab **blank,
  synchronously in the click**, then navigates after saving, or iOS Safari blocks the pop-up.
  `onClose` runs whenever the modal closes (Kels's Pups are going home waits on it).
  A sale's invoice also has **Send payment link** (§32).

---

## 25. Foster whelps (foster-in & foster-out)

**Editions:** Pro and Demo only (`editionFlags.fosterArrangement`). Lite hides the litter
form's Foster section; the fields still ride every backup.

A litter raised under an arrangement where the dam's owner and the caretaker differ.

- **Foster is a litter fact, not a dog fact.** `Litter.foster_direction`
  (`foster_in`/`foster_out`), `foster_partner_contact_id` (indexed FK, `CONTACT_REFERENCES`)
  and the compensation terms (`foster_comp_model`: `income_split` with `foster_our_share_pct`
  + `foster_split_basis`, or `flat_per_pup` with `foster_flat_fee_per_pup`;
  `foster_split_notes`). A foster puppy is an ordinary `puppy` Dog; its foster-ness is
  derived from its litter.
- **Whoever holds the puppies records the Sales; the other party's cut is an Expense**
  (`foster_split`, "Foster compensation"). So foster needs no income machinery of its own.
  Reimbursable rearing costs use the expense's `reimbursable`/`reimbursed_date` (§21).
  Not modelled: a hands-off foster-out where we never see the sales.
- `litterRepo` hard-checks only known direction and model, a 0–100 share and a non-negative
  fee.
- A `foster` contract links the dam and the partner like a lease does (`DOG_LINK_TYPES` /
  `CONTACT_LINK_TYPES`) and makes the partner a Companion partner.
- Companion shows a foster-in litter's owner kennel as "Bred by" (`breederKennel`, behind the
  `fosterOwnerKennel` flag).

---

## 26. Dropbox sync & KennelAssistant

**Editions:** Pro (`editionFlags.assistant`; both `assistant.html` files are in
`proPages.js`). Demo leaves out the owner console and Import/Export, where Dropbox sync
lives; the helper app still ships. Lite has no Dropbox.

Two opt-in, online-only features over the backup engine: **push/pull between the owner's
phones through her own Dropbox**, and **KennelAssistant**, a tiny read-write app for a
helper's phone (log events against a synced dog list).

### Dropbox transport (`data/dropbox.js`)
- Plain `fetch` to the Dropbox HTTP API; OAuth2 + PKCE entirely in the browser. The public
  app key is `APP_KEY` in the file (a PKCE client id isn't a secret). App-folder scope, so
  tokens only see `/Apps/KennelOS/`. Tokens live in the `dropbox` setting.
- `assets/dropboxConnectUI.js` `mountDropboxConnect(host, { onChange })` is the one connect
  control and completes the OAuth round-trip itself. **Every page that mounts it needs its
  URL registered as a Redirect URI** (list in `docs/LAUNCH_CHECKLIST.md`).
- Dropbox calls are cross-origin, so the service worker never caches them.

### Three files, one writer each (`data/assistantSync.js`, `DROPBOX_PATHS`)
Keep this invariant; it's what makes the scheme conflict-free.

| File | Writer | Reader |
|---|---|---|
| `kennelos-backup.json` | owner (push) | owner's other phone (pull) |
| `assistant-feed.json` | owner (push, or `pushAssistantFeed`) | helper |
| `assistant-outbox.json` | helper ("Send my updates") | owner (import) |

- **Push/pull are Import/Export's backup and restore with Dropbox as the place** (§10); a
  pull goes through the normal restore preview. Don't edit the same record on both phones
  between a push and a pull.
- **The feed is an allow-list** (`ASSISTANT_DOG_FIELDS`: names, breed, sex, status, dates,
  markings, url, plus derived litter and parent names) and dog events of
  `vocab.ASSISTANT_EVENT_TYPES` only. The same list gates the helper's log form. Contacts,
  money, kennels and contracts never reach the helper's device; that, not UI hiding, is
  the boundary. `pushAssistantFeed()` doesn't stamp `lastBackupDate` (the feed isn't a
  backup).
- **Outbox import** previews `new` / `update` / `no_dog` (skipped) / `invalid`, then upserts
  by id, so re-importing is a no-op. It writes `db` directly, so it calls `assertWritable()`
  and `markDataChanged()` itself.

### Owner console (`pages/assistant.*`)
Connection, Your helper's copy (send the feed), Their entries (import the outbox), and what
the helper can see (rendered from `ASSISTANT_EVENT_TYPES`).

### KennelAssistant (`assistant.html`, `assistant.js`, `data/assistantStore.js`)
- Standalone page (no nav/app boot) with its **own Dexie database `KennelOSAssistant`**
  (`dogs`, `events`). Its log form is built from `EVENT_TYPES`.
- **Get latest dogs** replaces the synced data, keeping pending events; logged events are
  `pending: 1` until **Send my updates**. Dogs are grouped by litter, with **Weigh litter**.
- Its weight-drop warning mirrors `eventForm.js`'s rule; keep the two in step.
- A pending event clears when a later feed brings its id back.
- `ASSISTANT_FORMAT_VERSION` / `ASSISTANT_OUTBOX_FORMAT_VERSION` (1) bump only on an
  incompatible shape change.


## 26.1 Documents & receipt attachments — local file storage

**Editions:** Pro and Demo only (`editionFlags.documents`, `receiptAttach`; `documents.html`
and `assets/documentModal.js` are in `proPages.js`).

Local, offline file storage behind three surfaces:
- **Documents** (`pages/documents.*`, the Storage hub's first tab, and a button on the dog
  page): file a document against a dog, by type.
- **Contract documents:** the Contract page's **Attach signed contract** opens the same
  modal set to Type = Contract and that contract's dog, and stamps `documents.contract_id`.
  The contract lists its filed documents (`documentRepo.getByContract`). The contract's
  `document_url` is a separate link field.
- **Expense receipts:** `assets/receiptCapture.js` on both expense forms (§21).

`assets/documentModal.js` is the shared add/edit and view dialog. Its `storeDocumentFile`
(a PDF as-is, photos built into one PDF) and `createDocument` (filed under the dog's
kennel) are the save, used by Kels's Add dogs too (§33).

**Storage:** `documents` (metadata, `dog_id`, `file_id`) and `files` (one row per stored PDF:
`blob`, `thumbnail`, meta; `data/fileRepo.js`). A file belongs to exactly one Document or
Expense and is deleted with it (§7). **Every file is a PDF:** photos are downscaled and
wrapped into a PDF by `data/pdfBuild.js` (no library; JPEG via `DCTDecode`), which also
makes the thumbnail. Viewing goes through `ui.viewPdfModal`.

**Receipt OCR:** a newly picked photo is scanned offline by `data/ocr.js` (vendored
Tesseract, loaded on first use) to fill amount, date, vendor and receipt number, **only where
the field is still blank**. Any failure falls back to typing.

Blobs survive JSON backup and Dropbox sync through base64 tagging (§5).

---

## 27. Furever seed-link generator (breeder side)

**Editions:** Pro and Demo only (`editionFlags.furever`, `feedingSchedule`; their pages are
in `proPages.js`).

**KennelOS Furever** (`furever/`, a separate app at `FUREVER_APP_URL`,
`https://furever.kennelos.app/`; see `furever/README.md`) is the family's pet-care app. A
**texted link** seeds it; this section is the breeder-side encoder.

**The console** (`pages/furever.*`, a Sharing tab beside Companion):
- **Setup nudges** above it: no vet contact on file; breeds of current buyers' pups with no
  feeding schedule. Neither blocks sending.
- **Kennel identity** in the `furever` setting: kennel name, tagline, breeder and vet
  contacts, and a generated `breederKey`. Prefilled from her records (blanks only; any
  `vet`-tagged contact can be picked); independent of `myKennelId`.
- **Recipients:** pups on an open sale (`isOpenSale`, as Companion's family bundle). A
  personal note and pickup photo persist as plain Sale fields (`furever_note`,
  `furever_pickup_photo_url`), so a resend starts from them. Furever shows the pickup plan as
  a pre-pickup countdown card.
- **Pickup date/time/place follow the pup's Placement / drop-off event**, so a drop-off
  moved on the timeline reaches the family on the next resend.
  `pickupEventFor(sale, events)` picks from the pup's drop-off events for the sale's family
  (`goHome.pickupFor`, as Kels and Today): the soonest from today on, else the latest past one.
  `pickupPlanFor(sale, event)` sends its `event_date`, `details.placement_time` and
  `details.location` (blank stays blank). The card shows it read-only with **Edit
  drop-off** (the shared event modal). Only a pup with **no** drop-off event shows the
  typed `furever_pickup_date`/`_time`/`_place` Sale fields, which the packet then uses,
  plus **Add a drop-off event** (the modal, prefilled from what's typed). Those fields stay
  and are still read as that fallback (older sales and backups carry them).

**`data/fureverSeedExport.js`** `buildSeedPacket` (async) copies named fields only (the
Companion allow-list discipline, §20), matching what `furever/data/seedLink.js` reads:
`pupId`, `breederKey`, `name`, `species`, `sex`, `breed`, `dob`, `photoUrl`, `note`,
`pickupPlan`, `kennelName`, `tagline`, `breederContact`, `breederVet`, `contentPackages`,
`feedingSchedule`. lz-string compressed into `FUREVER_APP_URL#seed=<payload>`, sent with
real `mailto:`/`sms:` anchors and the same size ceilings as Companion. No preview: Furever
has no local read-only shell.

### 27.1 Content packs on Google Drive — `docs/KennelOS_Content_Package_Fetch_Mechanism.md`
The console publishes documents to her Google Drive for the family app to fetch; KennelOS
does every Drive step.
- **`data/googleDrive.js`**: Google Identity Services token model, `drive.file` scope,
  public `CLIENT_ID`. The token is in memory for the tab only; `ensureAccessToken` re-requests
  silently first. GIS is vendored (`vendor/gsi/client.js`), loaded as a classic script in
  `furever.html`. Multipart uploads are hand-built (`multipart/related`).
- **`data/fureverContentPack.js`** builds `pack.json` by name and runs one publish: ensure
  folders → upload each source, **reusing its Drive file id** when the same record was
  published before (`selection.driveFileIds`, keyed `doc:<id>` / `upload:<id>`) → share the
  folder by link → write the manifest with a bumped `version`. Items removed since the last
  publish are trashed in Drive first (`removedKeys`).
- **Pointers:** the kennel-wide pack is `settings.furever.contentPack`; a litter's pack is the
  plain `Litter.furever_pack` field.
- **Kennel-wide pack** = uploads only. **Litter packs** pick from the documents of the
  litter's pups and its sire and dam. Each manifest file carries its `dogId`, and the family
  app (`contentPackFetch.filesForThisPup`) keeps only its own pup's and the parents'.
  Documents not marked `furever_shareable` are disabled. `contract` documents
  (`SENSITIVE_DOC_TYPES`) need an explicit "this becomes public" confirmation.
- Not built: the manual (no-OAuth) fallback.

### 27.2 Feeding schedules
Per-breed feeding grids (weight rows × age columns, free text, plus food brand and notes)
that ride into a pup's seed packet.
- Table `breed_feeding_schedules` (`breed` is a lookup key matched case-insensitively
  against `Dog.breed`, not an FK; a leaf). Shape: `{ breed, food_brand, age_columns[],
  weight_rows: [{ label, amounts[] }], notes }`. `breedFeedingScheduleRepo.getByBreed`.
- `pages/breed-feeding-schedules.*` (from the Kennel page's Feeding schedules card): one card
  per breed among the kennel's dogs (`dogRepo.getBreeds()`).
- `Litter.feeding_schedule_override` (free text) wins over the breed default. On the shared
  litter page it's gated by `editionFlags.feedingSchedule`, and kept from the stored value
  when the field isn't rendered.
- The packet's `feedingSchedule: { litterOverride, breedSchedule }` is `null` when neither
  exists; Furever's feeding page shows it as a reference card.

---

## 28. Kennel identity & Kennel Cards

**Editions:** Kennel identity (`public_id`) is in every edition and rides the Lite→Pro
bridge. Kennel Cards and the Kennels pages are Pro and Demo only (`proPages.js`). Several own
kennels is Pro only (`editionFlags.multiKennel`; `docs/KennelOS_Multi_Kennel_Scope_Spec.md`).

Without this, an outside kennel is a row each breeder typed into their own database, and
nothing ties the two together. Two separate pieces fix that: a portable identity, and a
card that hands it to another breeder. There is **no registry, directory or network call**;
a card goes only where the breeder sends it. (A future registry would sit on top: kennels
would claim the `public_id` they already have.)

### 28.1 `kennels.public_id`
- Format `kos1_<uuid>` (`kennelRepo.newPublicId` / `isPublicId`); the prefix makes a mis-paste
  fail loudly. Not the row `id`, which dies with the record.
- **Own kennels only:** minted on create, or when a kennel becomes own (which also heals
  older ones). An outside kennel's id can only be **received** from its card.
- **Write-once:** changing a set `public_id` throws; blanking it is ignored.
- Unique by a repo guard (`assertPublicIdFree`), not a unique index.
- Rides backups, the Lite→Pro bridge and sync with no code of its own.
- Separate from Furever's `breederKey` (one per installation, §27) on purpose; don't merge.

### 28.2 The Kennel Card
`data/kennelCard.js` (every edition) and `assets/kennelCardUI.js` (Pro, `PRO_ONLY_STANDALONE`).
- **Allow-list:** `buildKennelCard` copies `CARD_KEYS` only (`cardVersion`, `publicId`,
  `kennelName`, `prefix`, `location`, `website`, `issuedAt`), checked by `assertOnlyKeys`.
  The kennel's program settings and logo never travel. `tests/kennelCard.test.js` pins it.
- **A card can never set `is_own_kennel`.** Import creates an outside kennel and never touches
  the flag on update. A card carrying one of **your own** ids is refused with nothing
  written.
- **Transport:** lz-string JSON as a link (`kennels.html#kennelcard=…`, same origin only;
  also handled on `hashchange`) or a copyable code (works anywhere). Offline.
- **Preview first** (`previewKennelCard`, then `applyKennelCard`): `create` (new outside
  kennel, or link to an existing one), `update` (identity fields, shown as a diff),
  `unchanged`, or `own` (refused). Matching is by `public_id`. On a create, an unlinked
  outside kennel with the same name (`kennelRepo.findUnlinkedByName`) is **offered** for
  linking, so existing references stay attached; "Add as a new kennel" is the default.
- **Surfaces:** share from the Kennel page (own kennels); "Add from a card" on the Kennels
  list, which badges card-linked kennels **linked**.
- **Changing it:** a new card field goes in `CARD_KEYS` (and `CARD_FIELDS` if it writes on
  receipt), and must be identity, not program, money, dogs or people.
  `KENNEL_CARD_VERSION` bumps only on a breaking change; unknown keys are dropped on decode.

---

## 29. Waitlist (per kennel) — `docs/KennelOS_Waitlist_Spec.md`

**Editions:** Pro and Demo only (`editionFlags.waitlist`; its pages and UI modules are in
`proPages.js`). The tables, repos, rules and actions are in `shared/data`, so a Pro backup
restored into Lite keeps its waitlist rows, dormant.

**Design:** `docs/KennelOS_Waitlist_Spec.md` (decisions §0, §15–16); online parts
`docs/KennelOS_Waitlist_W2_Plan.md`.

### Model
- **One list per kennel:** every row has a required own-kennel `kennel_id`. Contacts stay
  program-wide (one Contact, an entry per kennel).
- **`waitlist_entries`:** one row per family per time on the list. Status `applied →
  approved → active → placed`, exits `declined`/`expired`/`withdrawn`/`removed`. **Pause and
  listen-only are flags on an `active` entry**, never statuses, so narrowing never costs a
  place. Many plain fields hold family requests, messages, prepasses, the "Ready now?"
  answer, a carried payment from a lost pup and the answer-change log; see
  `waitlistEntryRepo` and `syncRegistry.js` for each one's tier.
- **`waitlist_offers`:** one row per family per litter in a turn (rows of a turn share
  `turn_id`). `counts_as_pass` is decided once, when the outcome is recorded, so later rule
  or program changes can't rewrite history.
- **`waitlist_programs`:** her named adjustments (fee override, `ahead` priority, pauses
  allowed, passes not counted, longer response window). Only she assigns them.
- **Settings** live in `Kennel.waitlist_config` (missing keys from
  `WAITLIST_CONFIG_DEFAULTS`), so they ride backups, including her application form
  (`form_questions[]`) and FAQ (`application_faq[]`).

### Rules engine (`data/waitlistRules.js`)
Pure: no Dexie, no clock (callers pass `today`); `tests/waitlistRules.test.js`. **Nothing
it computes is stored.**
- **Position** among `active` entries: `ahead` program first, then `position_anchor_date`,
  else `fee_received_date` (else `approved_date` when the fee was waived), then
  `fee_received_at` (same-day order of payment), `approved_date`, `created_at`, `id`.
- **Available pup:** not archived, not deceased / pet home / external reference,
  disposition not `keeping`/`placed`/`health_hold`, and no live Sale.
- **Match:** sex, breed (case-insensitive), purposes (`pref_purposes` → registrations, must
  include the pup's `intended_registration`), and color only with `color_matching`. Unset
  on either side matches.
- **Eligible** for a litter: on the list, same kennel, not paused (`isPaused`: her pause, or
  the **readiness hold** until `readyFromDate`), listening for it (`isListeningFor`:
  `selected` parents, or `except` parents), and at least one available matching pup.
- **Turns:** one family holds a turn at a time across the kennel's open litters, covering
  every pup they're eligible for. `nextTurn` picks the top family with an eligible pup in an
  open litter they haven't spent a turn on (`turnSpent`, per litter; a voided offer gives it
  back), recalculated each time. A litter opening mid-turn joins it only if the holder is
  that litter's top family (`joinsOpenTurn`). A pass closes the whole turn and counts
  **once**. "Not this litter" (`prepasses`) leaves a litter out when their turn comes; a
  turn made only of those is passed at once and reported (`auto_passed`).
- **Passes:** at `max_passes` (default 2) the entry is removed (`second_pass`), with a 7-day
  undo that forgives the latest pass.
- **No silent expiry:** overdue offers and fees become Today nudges (`overdueTurns`,
  `overdueFees`).
- **Answer changes:** every change to `PREF_CHANGE_FIELDS` after `applied` is logged in
  `pref_change_log`. A narrower answer that would affect an open offer or next-in-line
  litter asks to confirm (`prefChangeEffect`).
- **Public list** (`publicList`): `{ position, name, pref_sex, added }` only. Names are
  "First L." (`publicName`) or masked "A***** K" (`privateName`) when `private_listing`.
  **Paused families are left out and their numbers skipped**, and no family count is shown.
  The turn holder's row reads `DECIDING_LABEL` ("Currently deciding"). `publicListText`
  is the copyable text version.
- **"Almost your turn"** (`soonFamiliesForLitter` / `soonFamiliesForKennel`): the queue, one
  family per available pup; a family mid-turn elsewhere holds room but isn't notified.
- `describeOfferChanges` turns any action's result into the lines every screen shows, so
  **no offer is ever made silently.**
- `deriveContactWaitlistStatus` keeps `Contact.waitlist_status` (via the entry repo).

### Application form (`data/waitlistForm.js`, pure)
Questions `{ id, label, type, required, help, options[], source_header?, key? }`. **Locked**
questions (with a `key`) can only be reworded: `name`, `email`, the preference questions
(answers go to `pref_*`), `ready_timing` (required; drives the readiness hold) and the
public-list notice. `formQuestions(config)` supplies defaults and restores missing locked
questions. Each entry stores `application_questions`, the wording it was answered under.
**Question import** (`proposeQuestionImport` / `applyQuestionImport`) turns an old form's
CSV columns into questions and stamps `source_header`, so the application importer (§9) can
then bring in the answers.

### Actions (`data/waitlistActions.js`)
Every multi-step write: approve (links a contact she picks from `contactMatches`, §33's
one contact rule: the same email or phone first, then the same or a near name; never
automatically; a fee of 0 goes straight to `active`), decline, fee received (sets the place
in line), fee expired, withdraw, remove, undo removal, undo pass, re-apply, move place
(`setPositionAnchor`).
- **Leaving releases turns:** withdraw, remove, archive, a deposit or a second-pass removal
  void the family's open offers (never a pass; a held pick's Sale is cancelled) and move
  those litters on.
- **Automatic offers are off by default**, per moment: `waitlist_config.auto_offer_on`
  lists the closings that offer the next family by themselves (`accepted`, `passed`,
  `no_response`, `no_deposit`, `left`, `restored`). Otherwise the next family comes back in
  `waiting` and she offers by hand (**Open picks**, **Offer to them**, **Offer pups…**).
  Actions on one family (approve, fee received, undo removal) never make offers.
- **The offer flow:** `openPicks` / `closePicks` (`Litter.picks_opened_date`), `offerNext`,
  `offerTo` (out of turn, with a note; nobody's place changes). **Accepting is pick +
  deposit:** `recordPick` creates a `deposit_pending` Sale (registration and price from the
  pup and `saleDefaults.expectedPricing`) and the offer stays open; `changePick` moves it to
  another pup; `confirmDeposit` marks the sale paid, the pup placed, the entry placed, and
  moves on. `recordOutcome` handles passed / no response (lets go of a held pick, counts the
  pass, removes at the limit) and voided (never a pass, doesn't move on). `undoPass` reopens a
  pass.
- **A lost pup** (`vocab.isLostSale`): `restoreAfterLostSale(saleId, { carry })` puts a placed
  family back in their **original place** (the accepted offer voided, passes unchanged), or
  refreshes an open turn without the lost pup; `carry` keeps what they paid for their next
  pick (`carried_payment`). Never automatic: the Sale page (and the family page's **End the
  sale…**) asks, through `waitlistUI.restoreLostPupDialog`, after the pup-settling prompts in
  `assets/salePrompts.js`.

### Surfaces
- **Pages** (`proPages.js`): `waitlist` (one kennel: new applications, fee due, the ranked
  list, Litters with "Next: <family>" and **Offer to them**, Closed; everything else under
  **Manage**), `waitlist-entry` (one family: Details / Interact / History tabs; its
  application fields come from `assets/waitlistApplicationForm.js`, shared with Kels),
  `waitlist-programs`, `waitlist-form`, `waitlist-publish`, `waitlist-import`. A page shows
  one kennel (`?kennel=`, else scope, else busiest; `waitlistUI.resolveWaitlistKennel`).
- **Litter page:** the **Waitlist picks** panel (`assets/waitlistPicksPanel.js`, loaded only
  with the flag): picks open/closed, the open turn and its actions, next up, the litter's
  queue, history. It re-reads the litter after each write.
- **Kennel page:** the Waitlist settings card. **Contact page:** the family's entries (and the
  waitlist status becomes read-only). **Dashboard:** application and list tiles. **Today:**
  waitlist nudges (§19).
- **"Almost your turn…"** (`waitlistUI.openSoonNotice`): the families and her editable
  message, sent by `mailto:` BCC or copied addresses (stamping `soon_notified_*`), or from
  KennelOS when the list is online.
- **Communicate…** (`waitlistEmailUI.communicateDialog`): emails that fit now, or a suggested
  message to share from her phone. KennelOS itself sends only the queued emails below.
- **Documents:** fee receipt, puppy invoice and receipt as PDFs (§24).
- **Fee paid online** (Pro with Accounts; Integrations plan §4): **Fee paid online via** a
  Payment service account (`kennels.waitlist_fee_account_id`), asked for at application or
  once approved (`fee_link_when`). Reusable Stripe links per fee amount
  (`waitlistFeeLinks.ensureFeeLinks` → `fee_links`; the charge includes a passed-on card
  fee). Her device's check (`checkFeePayments` / `planFeePayment`) records **fee received**
  for an approved family, or `fee_paid_online` for one not yet approved.
- **Review sale & send** (`assets/pickToSend.js`, with contracts + invoicing; Integrations
  plan §2.6): on a pick awaiting its deposit, edit the sale (incl. channel and fee), choose a
  contract form, and send one deposit-request message with the invoice PDF via the share
  sheet or email. It marks the contract sent and stamps `deposit_request_sent_date`.

### Online (W2)
- **Her device is the source of truth.** `data/waitlistProjection.js` builds one kennel's
  online view, field by field from allow-lists: the public list (unmasked; the server masks
  the turn holder when serving), and per family their status, place (`pref_places` for
  narrowed answers), prefs, pauses, open offers, matching litters (yes/no, never a place in a
  litter's line), and the fee if unpaid. Never other answers, phone, address, programs,
  notes or payment details. `as_of` = today, so it republishes daily.
- **Publishing** (`data/cloud/cloudWaitlist.js`): each own kennel with `online` and a
  `public_id` is hashed and `PUT` when changed (`DELETE` when taken offline), 20 s after a
  data change, on load, and back online. Needs a sign-in, cloud backup, a server-known Pro
  account, and the **server-work device** (§34: the backing device, or on a syncing program
  the lease holder, `serverWork.js`). Why it stopped is kept in the `waitlistOnline` setting.
- **Family pages** are the Worker's (`cloud/public/family/`, `cloud/src/familyPages.js`): the
  public list, the status page (`/s/<token>`; `status_token` minted by
  `ensureStatusTokens`, **New link** replaces it), and the online form. A family signs in
  with an emailed code. While it's their turn, their number is hidden (`placeHidden`).
- **Online form:** a form key per kennel (`waitlist_form_keys`, private;
  `data/waitlistCrypto.js`). The applicant's browser seals the answers to it;
  `takeInApplications` opens them on the server-work device and makes `applied` entries
  through `data/waitlistInbox.js`.
- **Family actions:** a family can pick a pup, pass a turn (with one of her reasons), say
  "Not this litter", ask for a pause, change listen-only or answers, leave, answer "Ready
  now?", ask for their Companion link, and message her (sealed). The server stores each as an
  event; `cloudWaitlist.applyFamilyEvents` plans each against her records **now**
  (`data/waitlistEvents.js`) and applies it (`applyFamilyPlan`): picks, passes, leaving and
  wider listen changes apply; pauses, narrower changes and answer changes become requests
  she approves or declines (Today and the family page). Anything her records no longer allow
  becomes a message line, never forced.
- **Emails** (`data/waitlistEmails.js` templates, `data/waitlistOutbox.js` queue): after an
  action a family should hear about, she's offered a drafted email (`waitlistEmailUI.offerEmails`)
  to edit or skip. Queued on the entry and posted after the publish (`sendQueuedEmails`);
  the server sends from the kennel's name at `mail.kennelos.app`, to the address in the
  projection, never one from the device.
- **While her phone is off** (`cloud/src/serverMoves.js`): for the moments in
  `auto_offer_on`, the server closes expired turns and offers the next family from her
  published `turn_queue`, and sends reminders (with `email_reminders`). Each move is an event
  her device applies next sync (`planServerEvent`). A publish that hasn't seen them is
  refused (`409 events_pending`).
- **"Ready now?"** (`readyCheck`): for holds ending while online; `sweepReadyChecks` removes
  non-answerers under `remove_after`, Today lists them under `keep_paused`.
- **Before picks open:** `show_upcoming` switches publish pairings and early litters
  (`upcomingItems`); a born litter gives each family a match / review note (`whelpNotes`).
  Today suggests **Open picks** when a litter's `accept_deposits_date` arrives
  (`depositsDueLitters`).
- **On her website** (Integrations plan §1): with `waitlist_config.embed`, the projection
  carries `kennel.embed.origins` and the Worker sets `frame-ancestors` for `/apply` and
  `/list` (`familyPages.frameAncestors`; status pages are never framable). The loader
  `cloud/public/family/embed.js` inserts and sizes the iframe. Snippets:
  `cloudConfig.embedSnippet` / `applyButtonSnippet`.
- `/list` and `/apply` carry Open Graph previews from the kennel name only
  (`familyPages.withPreview`).

---

## 30. Cloud backup — `docs/KennelOS_Cloud_Phase1_Plan.md`

**Editions:** Lite and Pro. Never Demo (`cloudUrl: null`). Live sync is Pro only (§34).

Design: `docs/KennelOS_Cloud_Phase1_Plan.md` (backup), `docs/KennelOS_Private_Vault_Plan.md`
(vault), `docs/KennelOS_License_Link_Plan.md` (Pro on the server). Server map:
`cloud/README.md`.

### What it does
- **Opt-in account:** email + a 6-digit emailed code (`cloudAuth.js`); the server keeps
  only a keyed hash of the email. Backs up the **cloud tier** as whole snapshots, keeps 30
  days of history, and restores onto a new or reset device or "as of" a date.
- **Private fields never go up unsealed.** `data/syncRegistry.js` is the per-field
  allow-list (unlisted = private). A cloud restore is a field merge (`'cloud-merge'`, §10),
  so private fields on the device survive it.
- **One backup device** per program: another device gets a 409 and chooses to restore that
  backup or replace it. A **shrink guard** refuses an upload that looks half-empty. Reset
  App turns backup off.
- **A lost device** (`cloudDevices.js`): from another device, erase it (it wipes itself
  next time it's online: `appReset.eraseThisDevice`) and, in Pro, free its license slot.
  `app.js` runs the device check-in first thing in `boot()`, before the license gate.
- **The vault ("Sensitive records" in the UI; `vault` in code):** an opt-in, end-to-end
  encrypted copy of the **complete** records. One AES-GCM key per program, kept unlocked on
  each device in `device_secrets` (`vaultKeyStore.js`); the server holds only wraps of it
  (recovery code, each passkey) and ciphertext. Unlock with the recovery code, a passkey
  (`vaultPasskey.js`, WebAuthn PRF, RP ID `kennelos.app`, never used to sign in), or another
  unlocked device (ECDH relayed by the server, salted with a code the user types; or a
  one-hour single-use code, `createHandoffCode`). With it on, every push also uploads the
  sealed part and the hash covers private rows; **locked, pushes pause** (`vault_locked`).
  A restore merges it with `'vault-merge'` (§10) when unlocked. `cloudConfig.VAULT_RELEASED`
  (true) offers it everywhere cloud backup is.
- **Pro on the server** (`cloudEntitlement.js`): the server learns of purchases from Lemon
  Squeezy's webhook by email hash and answers `GET /account/entitlement`. It gates only
  server features (the online waitlist); `license.js` still gates the app.

### Where it lives
- **Server:** `cloud/` — one Cloudflare Worker + D1 + R2, deployed by Workers Builds (not
  `deploy.yml`, not an edition), run from its `/ops` page.
- **Client:** `data/cloud/*` (only `cloudApi.js` touches the network) and
  `assets/cloudBackupUI.js` / `assets/cloudVaultUI.js`, imported dynamically and only when
  `isCloudAvailable()`. `editionConfig` supplies `cloudUrl` and `devCloudUrl` (staging, for
  localhost and `?cloud=staging`).
- **Screens:** Import/Export's **Backup & restore** card has destinations **Cloud | This
  device | Dropbox** (Cloud first when available; Dropbox Pro only), with Back up now,
  Restore as of…, and a Sensitive records dropdown (Off / Locked / On with its actions). The
  **Settings** page's Account card has sign-in, Change email…, Pro on this account, Your
  devices, sign out, delete cloud data. Today shows turn-on, paused and "save your recovery
  code" nudges (none while sample data is loaded). The 409 and shrink dialogs need typed
  confirmation; erase, sign out others and delete need a fresh sign-in (`withFreshSignIn`).
- **Scheduler:** `cloudBackupUI.bootCloud()` starts it after first run; it pushes when
  `cloudDirtySince` is five minutes old.

### Rules that keep it safe
- `cloudUrl: null` boots with no request and no cloud UI (`tests/cloudClient.test.js`).
- A new field is private until classified (`tests/syncRegistry.test.js`); a new direct `db`
  write calls `markDataChanged()` (`tests/cloudDirty.test.js`).
- Server migrations are new files, never edits; after a deploy that adds one the API answers
  503 until **Apply pending** on `/ops`. Nothing logs an email, code, token or body.


## 31. Reports — `docs/KennelOS_Reports_Plan.md`

**Editions:** Pro and Demo only (`editionFlags.reports`; every `*-report` page is in
`proPages.js`). Lite keeps the shared Active Roster and Live-Birth Summary pages, with their
charts and Print.

The hub (`pages/reports.*`) lists `data/reportCatalog.js` in tabs (Money / Breeding /
Puppies / Sales & Waitlist / Shows & Stud / Dogs & Operations; `?group=`), with **Year in
Review** featured. **Every report is derived** on load; nothing is stored.

**`assets/reportView.js` extras:** `dateRange` (presets via `reportMath.rangeFor`; undated
rows only in "All time"; `rowsIn(range)` instead of `date` rebuilds a per-dog report's
rows for the range), `kpis`, `charts`, column `total`, `rowsFor` (summary reports
grouping the filtered records), and always **Print / PDF**. All follow the visible rows.
A report opens on a range from its link: `?range=<preset>` (`&from=&to=` for custom).

**What a report reads (`data/reportSources.js`):** one loader per report Kels quotes,
`load<Name>(today)` → `{ href, rows, scope?, date?, rowsIn?, …lookups }`: its records
loaded and scoped, its rows built (by the pure `data/` modules), and the scope and date
the page hands reportView. `reportMath.inView(rows, { scope, date }, range)` is how
reportView and Kels both cut rows to a range. The tiles' figures for those reports are
`data/reportFigures.js` (pure, tested), which the page tiles and Kels both call. So a
report page and Kels's kennel check-up (§33) can't disagree. A new figure Kels says goes
into `reportFigures.js` and onto the report's tiles first. Both modules are Pro-only.

**Charts (`assets/chartView.js`)** are the app's own SVG (bar, grouped/stacked/diverging;
line; ranked horizontal bar), pure render functions plus `mountChart`. Colors come from
`SERIES_COLORS` in **fixed order** (a series keeps its slot; vocab-colored charts use the
vocab index). Two or more series get a legend; count axes have whole ticks; user strings
are escaped.

**Print (`assets/printView.js`):** the browser's print dialog. On pages with a letterhead,
print CSS hides the app chrome and prints the kennel logo and name, the title, range,
filters, and the date.

**Money by period (`data/moneyReport.js`):** reads the same scoped rows as the Financials
Overview, so they always agree. Cash basis: each income component has `when`
(`incomeView.saleComponentDate`) and `due` (only a due date she set; Receivables ages by
it). Anticipated income never enters Net; pick value is never money in.

**The reports** (each page's math is in a pure, tested `data/` module): P&L by Month, Litter
P&L, Expenses by Category, Receivables, Pricing, Breeding-Dog Return; Litters Over Time,
Live-Birth Summary, Health-Test Events, Dam & Sire Production (by whelp-date range,
`breedingReports.productionRowsIn`; flags litters under `BACK_TO_BACK_DAYS` apart and at
`LIFETIME_LITTERS_FLAG`, prompts only; plus a row for each live, owned or co-owned female
at Active breeding, of her kennel's female promote age (12 months by default) by the range's
end, with no litter in the range, said as `IDLE_TEXT`: expecting, bred and waiting, bred and
didn't take, not bred), Pairing Success,
Heat Cycles, Health-Testing Gaps; Puppy Growth (flags a pup under 85% of its littermates'
median); Placements, Scheduled Placements, Waitlist Funnel, Demand vs Supply, Applications, Waitlist
Today, Offers & Removals, Lead Sources & Referrers, Returns & Voids; Stud Services, Stud Results, Show Record; Active Roster; Year in
Review (prints on one page).

**Registration split:** Placements counts pups placed, sale value and average price per
registration (`moneyReport.byRegistration`, every type in vocab order, "Not set" last), and
Year in Review's Placements tile reads `registrationSummary` ("2 Limited · 1 Full").

**The waitlist reports** (`data/waitlistReports.js`): **Applications** (by applied date: days
between applications, approved of those decided, approved → on the list, median days to
approve and to the fee, and every answer that decides which pup they're offered: sex,
purposes (each picked counts, `purposesWanted`), parents (any / only certain / any but
certain, and the dogs named, `parentsWanted`, `parentsNamed`), breed when more than one is
named, color when one of her kennels matches on it). **Waitlist Today** (a snapshot, no range:
active entries in list order per kennel from `overallPositions`, paused by `isPaused`,
waiting since `listedSince`: anchor, else fee, approval, application). **Offers & Removals**
(one row per closed offer and per family that left, by when: accepted / passed / no-response
shares of closed offers, families who passed at least once, and exits by `EXIT_GROUPS`;
`RULE_REMOVAL_REASONS` (second pass, no check-in answer, no ready-check answer, fee not
received, and a fee that expired before listing) are "Didn't follow the list's rules",
apart from removals she made).

---

## 32. Accounts (business logins & referral codes)

**Editions:** Pro and Demo only (`editionFlags.accounts`). The vendor features hanging off
Accounts (payment links, Stripe, Jotform) are Pro too. Design:
`docs/KennelOS_Integrations_Plan.md`.

`pages/accounts.*` (the Storage hub's third tab) keeps her business accounts (AKC, Good Dog,
Chewy…) in the `accounts` table via `data/accountRepo.js`. A table of its own, not Contacts,
and **program-wide** (not kennel-scoped).
- **Your login** (`username`, `password` masked until Show, `customer_id`, `notes`):
  **private tier**, so they reach the cloud only inside the vault; they do ride file backups.
- **Referral — to share** (`referral_link`, `referral_code`, `referral_instructions`): cloud
  tier, meant to be handed out.
- **Expenses** may name the account paid through (`expenses.account_id`; the Account picker
  on both expense forms, Pro only). The card totals them, and **View expenses →** opens
  `financials.html?view=expenses&account=<id>`.
- **Processing fee** rate (§21.1). Every FK pointing at an account is in
  `ACCOUNT_REFERENCES`, so an account in use can only be archived.
- Sample accounts (AKC, Good Dog, Chewy) have obviously fake credentials; clearing sample
  data treats a real expense naming one as contamination (§11).

### Shared with families (plan §3)
Referral programs don't report which buyer used a code, so nothing detects use. Instead:
`share_with_families` on an account puts it in `referralShare.sharedReferrals` (the one list:
switched on, not archived, a web link or a code), which feeds the family Companion bundle's
`recommended[]`, every waitlist status page (projection `kennel.recommended`, re-checked by
the Worker's `familyPages.recommendedOf`), the go-home **follow-up** nudge (§19), and
**Send a thank-you** on a Contact. Sending is always hers through
`assets/messageComposer.js` (`mailto:` / `sms:` / copy); nothing goes to a server.

### Contract forms and e-signature (plan §2.1)
- A **Form service** account (`form_service`, e.g. Jotform) holds `contract_forms[]`
  (`{ id, form_type, label, url, form_id?, field_map? }`; types from
  `vocab.CONTRACT_FORM_TYPE`, each serving certain `CONTRACT_TYPE`s and ranked for a sale's
  registration by `contractForms.rankForms`).
- **Send for signature** (Contract page): picks a form, builds a prefilled link
  (`contractForms.prefillValues`, an allow-list that never includes notes or terms;
  `prefillUrl` uses the form's URL prefill, no API call), and opens the composer. Using it
  marks the contract `sent` with the `esign_*` fields. The breeder details come from the
  contact linked to the contract's kennel (`contractSend.breederFor`).
- **Connect Jotform** (a key per account, **this device only**: `jotformKeyStore` in
  `device_secrets`, never in a backup, sync or the cloud). `jotformApi.js` is the only
  module calling Jotform, straight from the browser. Connected, she can add forms from her
  Jotform account and **match fields** (`jotformMatch.suggestFieldMap` → `field_map`), so
  the link carries only matched facts under her field names (`contractForms.mapValues`).
- **Signed comes back** (`data/jotformSigned.js`): on app open (at most every 15 minutes,
  Pro) or **Check for signature**, her device finds each Sent Jotform contract's submission by
  its `contractRef` and applies `contract.signed` through `integrationApply`. A contract she
  changed meanwhile becomes a Today review. Nothing else from the submission is kept.

### Payment services (plan §4–§5)
- A **Payment service** account (`payment_service`) holds `payment_link` and/or
  `payment_instructions` (cloud tier: written for buyers).
- A Sale's **Deposit paid via** / **Balance paid via** name payment accounts (beside **Sold
  through**, a marketplace). The fee is estimated per payment from them
  (`processingFees.saleFeeEstimate`).
- **Send payment link** (`assets/paymentRequestUI.js`, an open Sale and its invoice): pick
  what for (`paymentLinks.paymentOptions`) and the account; with Stripe connected, a
  **one-time Stripe link** for exactly that amount (`stripeLinks.makeSaleLink`), else the
  account's own link and instructions.
- **Connect Stripe:** a **restricted key** only (`rk_…`; `sk_` refused), per account, this
  device only (`stripeKeyStore`). `stripeApi.js` is the only module calling Stripe, from the
  browser; nothing goes through the Worker and the money goes to her account.
- **Paid, by itself:** on app open (at most every 15 minutes) or **Check now**,
  `checkStripePayments` applies a paid link through `integrationApply.js`: deposit or paid in
  full with the date and reference, and the fee Stripe kept into `processing_fee_reports` /
  `processing_fee_amount` (a fee she typed stays; the difference is a Today review). A sale
  that moved on becomes a review.
- Vendor events from the Worker (`cloudIntegrations.js`, server work only) go through the
  same `integrationApply` / `integrationEvents.planIntegrationEvent`.
- The waitlist application fee: §29.


## 33. Kels — guided tasks

**Editions:** All editions. Steps for Pro features (outside dogs, stud service, sharing,
waitlist picks, contacts and kennels) are gated by their flags.

**Kels** (she/her) is a **scripted** helper shown as a chat, not a model: every line is written in the
task scripts, and nothing leaves the device. Who she is lives in `kelsChat.KELS` (`name`,
`tagline`, `title`, `assistLabel`, `photo`: `assets/kels.png`, 256 px, precached; null shows her
initial); pages read it through `kelsHello()`, `kelsAvatar()` and `kelsPhotoUrl()` (resolved
from the module's own URL, so it works from any page). A floating **Ask Kels** button
(`kelsChat.renderAssistButton`, from `app.js`; her photo above the label, and a dot while a
litter draft is unfinished) opens `pages/kels.html`. Every write is an ordinary repo write.

Modules: `assets/kelsChat.js` (identity, the transcript — `say`, `you`, `panel`,
`choose(choices, { search?, confirmHint? })` (buttons two across; a choice with a `sub` opens
on the first tap to show it and is chosen on the second; `search` adds a box that filters as
she types, every word matching the start of a word in a choice's label, sub or `keywords`,
Enter picks the first match), and `form({ title, html, submit, reply })`, where `submit` returns a string to show as a
problem and stay, anything else to finish — and the button), `pages/kels.*` (the menu),
`assets/kelsSteps.js` (`StepConversation`, the step engine the two draft-keeping tasks
share: a step list worked out from the draft, one screen per step with tiles, Back and
Next, her answers left in the chat and in `draft.history` to replay a resumed draft, and a
review whose Change links come straight back to it; plus the screens' HTML helpers, and
the add-a-kennel / add-a-person fields every task asks with, `kennelNameField` and
`contactFields` + `readContactFields`; the outside-kennel picker, `kennelPicker` +
`wireKennelPicker` + `readKennelPicker` (one she has, or a new name: the litter task's
outside owner's kennel, Add dogs' breeder, Add people's breeders); `addContactInChat` (a
new contact in a chat form, someone she may have asked about once by `contactSearch`: the
tidy-up's "Add a contact" and its vet's); `VET_WHY` / `VET_NAME_HINT` (how she asks for a vet,
the tidy-up's and Add people's); and the breed picker, `breedPicker` +
`wireBreedPicker` + `readBreedPicker` (her breeds, `dogSearch.breedChoices`, as one-tap
choices, and **➕ A new breed** opening a box, so a breed she has is never retyped; Add dogs'
"in common" and each dog, the litter task's new mom or dad): the tidy-up's "Add their kennel" and "Add a
contact", the litter task's outside parent's owner and kennel, Add dogs' breeder),
`assets/guidedLitterUI.js` + `data/guidedLitter.js` (the litter task), `assets/guidedDogsUI.js`
+ `data/guidedDogs.js` (add dogs), `assets/guidedPeopleUI.js` (Pro-only) + `data/guidedPeople.js`
(add people), `assets/kelsApplicant.js` (Pro-only, the applicant step below),
`data/contactSearch.js` (`findContactMatches`, the one way every place asks whether a person
is already in her contacts: the same email or phone is `certain`; the same name, or a near
one by `dogSearch`'s word match (a slip, or one name's words all in the other when both have
two or more; a lone first name never), only `possible`, a "maybe this is them" that's
offered, never applied; Add people, the waitlist's approval through
`waitlistRules.contactMatches`, and the tidy-up's name / email / phone keys; `hasVet`, the
tidy-up's "no vet" rule and Add people's vet question), `data/dogSearch.js` (`findDogMatches`, the one way every
task looks for a dog on file before making one, written for how people type: each typed
name, call or registered, against both names of every dog, both ways and forgiving (titles,
case, spacing, punctuation ignored; run-together names; a slip or two per word, a swapped
pair counting as one; sound-alikes, "Zoie" / "Zoey"; "Zoey" finds "GCH Thornfield Zoey Mae");
numbers wherever they were typed, a name box included, on both sides; then the same number
is `certain` unless the sex or breed doesn't fit (then it's shown, saying so, as `possible`,
so nothing takes it without her say: a mom is never filled in with a male), one slip off
"nearly the same" and a breed spelled near enough or a birthday the same, a few days off or
day and month swapped make it `likely`; a different breed (not just misspelled) or sex is a
different dog, never offered; a clearly different number only lowers it to `possible`;
`normReg`, a registration number's key everywhere (spaces, slashes, dashes and a leading
"AKC" never count; also the CSV import's, the pedigree import's and the tidy-up's
duplicates'); `similarNamed`, the same name match for kennels and contacts; `breedChoices`, the
breeds to offer: her dogs' breeds, then her kennels' `preferred_breeds` (first-run setup or
a kennel tests import, so they're there before her first dog), one per breed whatever the
case or spacing, the spelling her dogs use most winning; the Dog page's breed suggestions
too;
`looksLikeNumber`; nothing typed is changed as stored), `assets/litterCheckinUI.js`
+ `data/litterCheckin.js` + `data/goHome.js` (the check-in), `assets/tidyUpUI.js` +
`data/tidyRules.js` + `data/recordMerge.js` (the tidy-up), `assets/accountHealthUI.js` +
`data/accountHealth.js` (account health), `assets/waitlistSetupUI.js` (set up my waitlist,
Pro-only), `assets/guidedFormUI.js` (Pro-only) + `data/guidedForm.js` (set up my application
form), `assets/waitlistFeeStep.js` (Pro-only: the application fee and its payment account,
both waitlist tasks), `assets/kelsBackupSteps.js` (`offerCloudBackup`, `offerSensitiveRecords`,
`VAULT_WHY`, `cloudBackupOn`: turning on cloud backup and Sensitive records backup in the
chat; the waitlist tasks, Getting Started and account health's wording), `assets/kelsSetupUI.js` +
`data/kelsSetup.js` (Getting Started), `assets/vendorKeyUI.js` (`vendorKeyFlow`: a Stripe or Jotform key connected or
replaced in the chat; account health and the waitlist setup), `assets/kelsFindings.js` (`FindingsTask`, the
look → raise one at a time → fix → look again loop the tidy-up and account health share:
"Not now", a remembered "Don't ask me again" under `<prefix>:<key>` in the nudge ledger,
"Stop for now"), `assets/prepPupsUI.js` +
`data/prepPups.js` (prep pups; it reuses the check-in's exported `chipsForm`, `careForm`
and `pickupsForm`). The data modules are tested; all but `recordMerge.js` are pure.

**People, not forms:** wherever a near-miss would make a duplicate or a slip (a parent
on file typed again, a kennel or contact like one she has, a breed spelled unlike her
other dogs', a registration number in a name box), the step's check is one she can tap
past: `{ key, message }` from `problem()`, shown once by `kelsSteps` ("If it's right as you
typed it, tap Next again") and then skipped while `draft.warned[key]`; changing what she
typed asks again. The tidy-up's add-a-kennel / add-a-contact forms ask the same way (Add
again keeps hers). Only a missing answer, or one that can't be saved, stops her.

**Her voice:** every message carries a couple of warm words, aimed at the breeder (her
work, her pups), never more than one phrase or sentence of it; the rest is the task. Sent
straight to a task (`?task=`), she still greets with her first message (`kelsWelcome`),
and the task is the breeder's answer. **Every new task** (not a resumed draft) then starts
with `chat.intro(opener)`: the task's own line ("Sure thing, let's get those pups ready to
go home!"), then `kelsChat.KELS_INTRO` ("I'll ask you some questions; once I'm done
collecting the information, I'll build the records for you to approve. If you get stuck or
need to save and come back, I'll save what we've got so far…  Sound good?"), answered
**Sounds great, let's start!** or **Never mind** (back to the menu). Openers: record a litter
"Absolutely, let's get those puppies added!", check-in "Of course, let's check in on your
litter!", add dogs "Wonderful, let's get your dogs added!", add people "Of course! Let's get your
people added.", application form "Yes! Let's make your application form just right.", tidy up "Love it, let's get your
records tidy!", account health "Good idea, let's make sure everything's safe and sound!", Getting
Started "Welcome aboard! Let's get KennelOS set up just the way you like it." Getting Started says
`kelsSetup.SETUP_HOW` in place of `KELS_INTRO` ("I'll go through your kennel's settings with
you one at a time and save each one as we go…"), since it keeps no draft and builds nothing
to approve.

**The top** (`kels.js` `menu`): her first message, `kelsChat.kelsWelcome` ("Hi, I'm Kels, your
personal KennelOS agent! I'm here to help you manage your kennel :) What do you need help
with first?"), then an unfinished draft (if any, first), **Finding Something**, **Doing
Something** (the task menu below, after "Love it! Here's what we can do together.") and
**Understanding Something** (below). After a task, a find or an answer: "What else can I help
you with?" and the same buttons.

**Favorites** (`data/kelsFavorites.js`, pure, tested; `kels.js` `doMenu`): the Doing
Something list is ordered unfinished draft → starred → used often → `priority` (priority
decides within each). Every task but a resumed draft has a ☆ in its corner (`chat.choose`'s
`star` / `onStar`: its own tap target, never opens or starts the task) that toggles
`settings.kelsFavorites`. Each start but a resumed draft is logged (`kelsTaskUse`: id →
start dates in the last 60 days); more than 3 makes it "You use this often" (a `note` on the
button), and opening it shows **Don't move this up** (`noteAction`), which adds it to
`kelsNoPromote` until she stars it. All three are device-only settings, in `KEYS` (Reset
App clears them), never in a backup or synced.

**The menu** (`kels.js` `TASKS`): a task is `{ id, label, sub, keywords, available, priority,
run, resumable?, beforeStart? }`, highest priority first, with a search box above it;
`keywords` are the other words a breeder might search with ("add puppies" finds Record a new
litter). The page header shows her photo and `KELS.title` ("Kels, the KennelOS whiz") on one line, sized to fit a phone. Order: an unfinished litter (100), unfinished dogs (99), the
check-in (60 while a litter has pups at home, else 40), a new litter (50), prep pups (45,
while a litter has pups at home), add dogs (35), add people (33, Pro), tidy up (30), set up
my waitlist (25, Pro), set up my application form (24, Pro), account health (20), Getting Started
(95 while she's new, else 15: `kelsSetup.setupPriority`); unfinished
people sit at 98, an unfinished form at 97. The header's **Save for later** shows only while a `resumable` task
runs; its **Cancel** shows while any task runs and, after an "Are you sure?" (`confirmModal`),
drops the open question, discards a resumable task's draft (its `discard`) and returns to the
menu (records already saved stay), and the floating button's dot shows while any draft is unfinished. `beforeStart`
can redirect a start (a new litter, dogs, people or form while one is unfinished asks "Finish that
one / Start fresh"); `handoff(taskId, opts)`
moves her to another task (an Expected litter in the check-in → its birth).

**Doors:** the floating button; the Breeding page (`kels.html?task=record-litter`); an
expected litter's page (`&litter=<id>`, parents and litter preset); a born litter's page that
isn't closed (**Check in with Kels**, `kels.html?task=checkin&litter=<id>`); the first-run
Meet Kels card (**Try Getting Started**, `kels.html?task=get-started`).

### "Finding Something"
`assets/kelsFindUI.js` + `data/kelsFind.js` (the engine) + `data/kelsKnowledge.js` (the cheat
sheet) + `data/findRecords.js` (her records as candidates); the three data modules are pure
and tested (`tests/kelsFind.test.js`). Reads only. It opens with `chat.intro('Absolutely!',
KELS_FIND_INTRO)`: "I'll look through the app and try to find what you're looking for. I'll
search app features and your existing records. If I find several matches, I'll ask you to
choose one or ask follow-up questions. Sound good?" (in place of `KELS_INTRO`, since it
builds nothing), then a search box.
- **Candidates:** `{ id, group, title, sub, where, href | taskId, boost, levels, numbers?,
  facets? }`. **Places:** `kelsKnowledge.PLACES`, written by us, each with the sentence she
  says (`where`, naming hubs by this edition's menu labels) and a link (a tab in its query
  where the page reads one: `dogs.html?bucket=&disposition=` (a starting Disposition filter), `contacts.html?group=`,
  `financials.html?view=&bucket=&dog=` (`dog`: only that dog's costs, kept across the category tabs); `kennel.html?id={kennel}#<section>` with her active
  kennel), plus every report (`reportCatalog.REPORTS`) and expense category. A place whose
  page is Pro-only isn't offered in Lite, nor one whose `flag` is off. **Records:** dogs
  (archived only where `archivedDogLinks`), litters, and in Pro contacts and kennels.
  **Tasks:** each available task (label, `keywords`), a little behind a page of the same words;
  choosing one starts it (`handoff`).
- **A dog and a word about it** (`data/kelsAbout.js`, tested in `tests/kelsAbout.test.js`):
  when every word is a dog's name or a `DOG_TOPICS` word, with at least one of each ("Zeus
  puppies", "JJ litters", "Zeus sales"), Kels works out what the dog has (`factsOf`: its
  puppies by sire/dam, its litters, its puppies' sales, how many sold and for how much) and
  opens with it ("I found a lot about Zeus. He has sired 8 puppies across 2 litters, and 5
  have sold for $12,400."). Topics: `pups` (each puppy, asked by litter then sex; plus "All
  of Zeus's puppies", `dog.html?id=…#offspring`, the Offspring list under the pedigree,
  which dog.js scrolls to once drawn), `litters` (each litter), `sales` (each sale of a
  puppy, with buyer, price and status; plus Breeding-Dog Return where reports are). She asks
  which topic only when two or more have something; one goes straight to its results; none
  says so and offers the dog's page. Two dogs by that name with something on record: she
  asks which first. "Something else" is always the ordinary search. Sales and contacts
  (for buyer names) are loaded in every edition.
  **Shots and vet** ("JJ shots", "JJ vet", "JJ health" = both): `shots` lists the dog's
  vaccination and preventative events, `vet` its vet visits, illnesses, medications,
  surgeries and injuries, each opening the event on the dog's page (`?openEvent=`). Kels
  says the last one ("JJ's last shot was DHPP on Mar 1, 2026, and DHPP is due Mar 1, 2027";
  the due date is each vaccine's latest shot's `next_due`, the soonest, "overdue" when
  past). Both topics can `add`: "Add a shot for JJ" / "Add a health event for JJ"
  (`dog.html?id=…&logEvent=vaccination|vet_visit`), always first in the list, the first
  choice when nothing is on record, and what she leads with when an add word was typed
  (`ADD_WORDS`: add, log, new, enter, gave, give, got, track — "log a shot for JJ", "JJ got
  sick"), with what's on record one tap away. `vet` also says who saw the dog last (the
  newest shot or vet event with a vet: its `related_contact_id` contact, or `details.vet`)
  and its Veterinary expenses this year ("JJ was last seen by Dr. Nguyen on Aug 3, 2026
  (Ear infection). She has $300 in vet expenses logged this year."), and lists after its
  events each vet contact linked (Pro, `contact.html`) and "JJ's vet expenses"
  (`financials.html?view=expenses&bucket=veterinary&dog=<id>`). Expenses are loaded for it.
- **Levels:** 1 = names, numbers (`normReg`, typed any way), a place's title and keywords;
  2 = secondary details (a dog's breed, color, status, ownership, sex, kennel, bred-by
  kennel; a contact's types, email, phone, kennel; a litter's parents, status, year); 3 =
  notes and a dog's or litter's events (titles, details, notes), labelled so she says where
  ("I found "rabies" in Vaccination, Mar 1, 2026").
- **Passes** (`search`): her words themselves (or a word's start) at levels 1, 2, 3; then
  with synonyms (`SYNONYM_GROUPS`) at each level; then with slips and sound-alikes
  (`dogSearch.wordHit`). The first pass where some candidate matches every word is used;
  if none does, the pass with the most words matched. Only the candidates matching the most
  words are shown. Little words (`STOP_WORDS`) are dropped; "show" counts unless it's "show
  me". Scores: the word 3, its start 2.5, a synonym 1.5, a slip 1.2; level 2 ×0.8, level 3
  ×0.6; +0.5 for a word in the title; ties go to the shorter title. **Look deeper**: level 3
  with every reach, the ones not already shown.
- **Answering:** a clear winner (alone, or 1.5 ahead and 1.5× the next) is said with **Take
  me there** / **Let's do it** and **Not it**. Otherwise, more than four: up to two questions
  (`narrow`: which kind, then the kind's facets that actually split them: a dog's whose /
  sex / breed, a contact's type, a kennel's own or not, a litter's year), then **Do you
  want…** four at a time (each opens its `where` on the first tap), **Show more**, **Look
  deeper**. Nothing matched: "I couldn't find anything for "…". Here are a couple of things
  people often look for. If none of them are right, feel free to give me new words and I'll
  search again!" with **View your dogs**, **Manage your litters**, **See your finances**,
  **See your contacts**, **Sharing your pups** (the Sharing hub's Companion page; each only
  where the edition has it) and **Try new words**. Going
  there opens the page in this tab.

### "Understanding Something"

`assets/kelsUnderstandUI.js`. Two halves, each `{ id, label, opener, how, flag?, run }` in
`HALVES`, offered when its flag is on: **How KennelOS works** (every edition, below) and
**How my business is doing** (`reports`: Pro and Demo, below). With more than one she asks
"Yes, absolutely! Which is your question about?"; with one (always in Lite) it starts
straight away. Each half's intro (`chat.intro(opener, how)`) is said the
first time it's picked in a visit; **Something else** after an answer returns to the
question when there is one. How KennelOS works opens "I'm on it!" +
`kelsChat.KELS_UNDERSTAND_INTRO`, which names nothing Lite lacks.

**How KennelOS works** is an FAQ (`data/kelsUnderstand.js`, pure, tested in
`tests/kelsUnderstand.test.js`). Read-only: it reads none of her records and changes nothing.

- **What's in it:** only the rules a breeder who knows dogs and has used other apps would
  still get wrong here, never what any app does or what a screen already says. Each entry
  is `{ id, section, q, a, keywords, href?, show?, flag?, when? }`: the question as she'd
  ask it, the answer in a few plain sentences (no field names; a string, or `(ctx) =>` one
  where the edition changes it), and a **Show me** button to where it lives. `ctx` is
  `{ edition, flags, cloud, vault, online, page(href) }` (`online`: the online waitlist is
  offered, `isWaitlistOnlineOffered`). An answer is written from the rule as
  built, so a change to the rule changes its answer in the same edit.
- **Topics** (`SECTIONS`): The Today hub, Dogs and puppies, Archiving and deleting (Removing
  and deleting in Lite, which never says archive), Breedings and litters, Money, The
  waitlist, Your data and devices. A topic with no entry in this edition isn't
  offered (`understandSections`).
- **Edition-honest:** an entry with a `flag` the edition lacks, or whose `when(ctx)` is
  false, isn't there; a sentence about such a feature is left out of the answer; a Show me
  whose page is Pro-only isn't offered in Lite (the answer stays). Lite gets its own
  entries where its rules differ (a dog leaving the program, a gone-home pup removed from
  it, a parent kept for the pedigree). Lite's limit isn't a topic. Cloud entries need
  `isCloudAvailable()`, the online waitlist entry `isWaitlistOnlineOffered()`, the Sensitive
  records sentence `isVaultOffered()`.
- **The chat:** **Search the questions**, the topics, **Something else** (only when there's
  a question to go back to) and **I'm all set**. A topic lists its questions. The search is
  `kelsFind.search` over these entries only (`understandCandidates`: the question and
  keywords at level 1, the answer at level 2), never pages, records or tasks: one clear
  match is answered at once, else the questions four at a time with **Show more**; nothing
  found offers other words or the topics. After an answer: **Show me** (opens its page),
  **More about <topic>**, **Something else** (the question, else the topics), **I'm all set**.
- **Adding an entry:** a line in `ENTRIES`. The tests check unique ids, a known section and
  a real edition flag, a sentence in every edition with no field names, and that every Show
  me page exists and is precached.

**How my business is doing** (`assets/kelsInsightsUI.js` + `data/kennelInsights.js`, both
Pro-only; the UI is imported when the half is picked). It opens "Ready when you are!" +
`KELS_BUSINESS_INTRO` ("I can tell you how your business is doing, like who your most
productive dam is or how your money did this year…"). Read-only.
- **The chat:** a topic (`insightTopics`: **My dogs**, **Money**, **Litters & pups**,
  **Sales** / **Sales & the waitlist** (`waitlist`), **Shows & stud** / **Shows** / **Stud
  services** where `shows` / `studServices` are, **The whole picture**), then a range
  (**This year**, **The last 12 months**, **Last year**, **All time**). She loads that
  topic's reports (`topicSources` → `reportSources.load<Name>`), says a warm lead line and
  the first `FIRST_SHOWN` (4) sentences as a list, then **Tell me more**, **See <report>**
  for each report those sentences came from (in this tab, on her range when the report
  has one), **Another topic**, **Different dates**, **Something else** and **I'm all set**.
  Nothing in the range: `nothingText`, with **Yes, all time** where it wasn't.
- **The sentences** (`insightsFor(topic, loaded, ctx)`): each `{ id, topic, text, tone,
  value, dogIds, source: { href, title, range } }`, cut to the range as the report cuts it
  (`rowsOf`: `inView`, or the report's `rowsIn`) and worked from the report's rows and
  `reportFigures`, never a figure of its own. Reports with no range (Breeding-Dog Return,
  lifetime; Heat Cycles, Health-Testing Gaps, Receivables, Waitlist Today, Demand vs
  Supply, Puppy Growth's flags, as of today) say "so far" or "now", and their button opens
  them plain.
  - *My dogs:* most prolific dam and sire (puppies born; only dogs with `MIN_LITTERS` (2)
    litters in the range ranked; under it, "too early to say"; a tie said as a tie); the
    best live-birth rate (two or more dams past the minimum); the breeding girls with no
    litter, as production's idle rows say it (never "failed"); who's expecting; how many
    breedings took (`MIN_BREEDINGS`, 3 decided), and of two or more sires past it the one
    whose took least often; the highest-earning dam and sire and the dog furthest in the red
    (Breeding-Dog Return); back-to-back and 6+ litter flags, as prompts; heats due within a
    month or overdue; health tests planned and not logged.
  - *Money:* net with money in and out (P&L); the best month (two or more months with
    money); the biggest cost and its share; the most and least profitable litter (Litter
    P&L, two or more); what's owed now and how much is overdue (and over 90 days); sale
    value by registration (Placements); Full against Limited average price (Pricing,
    `MIN_SALES`, 3 each; under it, "too early to compare").
  - *Litters & pups:* litters and puppies born; the average litter (2 or more with counts);
    the live-birth rate; each pup flagged by Puppy Growth in a litter whelped in the range
    and not closed, linked to that litter.
  - *Sales & the waitlist:* pups placed, sale value and (3 or more priced) the average;
    the count on each registration; the top lead source and referrals; sales that ended, or
    that none did (3 or more sales); then, with `waitlist`: applications, how often (a mean
    over 2 or more gaps) and approvals; what families asked for; the parent named most by
    families who chose only some; who's waiting now, for what, paused, and the median wait;
    applications to review and fees due; offers accepted (a rate past 3 closed, else plain
    counts); the kind of pup most short of supply (Demand vs Supply).
  - *Shows & stud:* points, results and majors; the dog with the most points (two or more
    shown); titles earned in the range; stud fees earned and paid (completed services);
    litters stud services produced.
  - *The whole picture:* the first two from My dogs and Money and the first from each other
    topic, then Year in Review.
- **Tested** in `tests/kennelInsights.test.js` (topics per edition, the minimums, ties, the
  idle wording, each topic's sentences from fake loaders, every source in the catalog).

### "Getting Started"
A new breeder's first run through her kennel's settings, after the first-run kennel setup
(§0): `assets/kelsSetupUI.js` + `data/kelsSetup.js` (pure, tested in
`tests/kelsSetup.test.js`). Every edition but the Demo (which saves nothing). It keeps no
draft: each part saves through `kennelRepo` as she answers it, and every part can be
skipped. **New** (`isNewProgram`): not one dog record on file, of any kind, archived ones
included (pedigree-only ancestors don't count); then it sits at 95 in her menu, however often she has run it, else 15.

With more than one own kennel she picks which (My kennel first); then the parts, in
`setupParts(editionFlags, { kennelPage })` order, each only where the edition has what it
sets up. The kennel's own settings need its Kennel page (Pro-only), so Lite gets the backup
part alone, then her dogs.

| Part | Where | What |
|---|---|---|
| `logo` | the Kennel page, and something prints it (`logoUses`: invoices, receipts, puppy records, printed reports) | Upload (a file box in the chat, scaled by `fileToLogoDataUrl`, previewed, saved on **Use this logo**); one on file is shown with **Keep it** / **Change it** |
| `nudges` | the Kennel page | The Lifecycle nudges fields in one form, suggested on when never set (`promote_nudge_enabled`, the two promote ages) |
| `tests` | the Kennel page | Her preferred tests listed (with their breed tags), then **Add tests** (one per line, optionally for some of her `preferred_breeds`: `addPreferredTest`), **Remove tests** (ticked: `removePreferredTest`), **Rename a test** (`renamePreferredTest`), round after round until **That's all**. Panel only: dogs on file keep their planned tests |
| `puppy-record` | Pro (`puppyRecord`) | **Show everything** (clears `puppy_record_fields`) or **Let me choose** (the Puppy Record fields' boxes) |
| `kennels` | Pro (`multiKennel`) | Another own kennel, for a separate side of the business (two breeds with their own waitlists, a pet side and a show side); with the waitlist she adds that a program per breed may be enough. Name (checked by `newKennelNameProblem`: required; one like a kennel on file asked about once), prefix, location; created with `is_own_kennel` and `settingsToCopy` (the nudge settings and Puppy Record fields, nothing else); then its logo (upload, the first kennel's, or not now). As many as she likes |
| `furever` | Pro (`furever`) | Google Drive for Furever's content packages: Google's sign-in script (`vendor/gsi/client.js`) is loaded on demand, then a form whose **Connect** calls `googleDrive.connectDrive()` from the tap (so the window isn't blocked) and sets `driveConnected` |
| `assistant` | Pro (`assistant`) | Dropbox for KennelAssistant. Dropbox returns to the page that asked, and only registered pages may ask, so it connects on the KennelAssistant page: announced, opened in a new tab on **Okay, open it**, then **I'm back, check it now** reads `isDropboxConnected()`. Already connected: she says so |
| `backup` | every edition | Cloud backup on: she says so. Cloud offered and off: `offerCloudBackup`. Otherwise, with no backup file in `EXPORT_MAX_DAYS` (14): **Download a backup now** (`importExport.downloadBackup`) |

Then **Add my dogs** / **Add my people** (Pro, `contactsSection`) / **I'm all set for now**:
a pick is `handoff('add-dogs' | 'add-people')`, so an unfinished draft of that task still
asks Finish / Start fresh.

### "Record a new litter"
`stepsFor`: mom and dad (own dogs, all dogs, or a new one; a typed name is first checked
against existing dogs, `dogSearch.findDogMatches` with its names and breed, pedigree-only
dogs included, so nobody is entered twice; "Yes, that's her" on a pedigree-only one brings
it into use with her answers (`spec.bringInId`: updated, not made; the pedigree's names and
breed stay, hers fill only blanks); outside dogs only in Pro) →
the matching litter (`litterCandidates`) → the matching breeding (`pairingCandidates`) or when
she was bred → the stud service (Pro, outside dad) → birth date and counts → how they were
delivered (`delivery`: a tile per `LITTER_DELIVERY_TYPE`, or "I'll add it later", which saves
nothing; skipped when the chosen litter already has one) → kennel (only if
it can't be worked out) → one screen per puppy → plans (disposition, intended registration) →
prices (prefilled from her last priced litter of that breed, previewed with the
`expectedPricing` rule) → dates → extras → review with Change links.

**The save** (`saveGuidedLitter`) writes in order: new parents → litter → breeding (marked
`whelped`, due = bred + 63) → stud service → puppies (`puppyDefaults.baseFromLitter`, as Add
Puppies) → a "Birth weight" `weight_check` per weighed pup. In Lite the litter is written
first so the cap refuses before anything else is made. **Resumable:** each new id goes back
on the draft as it's made, so a retry never duplicates.

**The draft:** `settings.guidedLitterDraft` (answers plus `history` to replay the chat;
`DRAFT_VERSION`). Device-only, cleared by Reset App, one at a time.

**After the save** (Pro, `assets/guidedShareUI.js`, loaded only with `waitlist` or
`companion` and an available pup): tell the waitlist (the litter page's notice) or share the
available pups with prospective families via Companion links. It **never opens picks**.

### "Add dogs"
One dog or several in one go, the way the litter task takes several puppies. `stepsFor`:
1. **Who are we adding?** (`roster`): a row per dog, its name and **♂ Boy** / **♀ Girl**,
   with **+ Another dog** (up to `maxDogs`: `MAX_DOGS`, 20, or in Lite the room left under
   the cap, `dogCapStatus()`, shown as "You have room for 2 more dogs") and ✕ to take a row
   off. Names must differ; an empty row is dropped. In Lite with no room left, she shows
   the upgrade notice in place of the task's questions.
2. **What do they have in common?** (`common`, only with two or more dogs): breed, status,
   whose dog, the owner (someone else's) and the kennel (with more than one own kennel; the
   active one suggested). `fillFromCommon` fills each dog's blank fields, and any still
   holding the last common answer; her own change on a dog is kept. A lone dog gets the
   defaults (Active breeding, Owned).
3. **Each dog** (`dog:<i>`, "Tell me about Daisy (2 of 3)"): breed (required), date of birth,
   registered name and number, color and markings, microchip, status (`statusChoices`:
   Active / Retired breeding, Pet home, For sale, Deceased; Lite: Active / Retired breeding,
   Deceased; a puppy belongs to a litter), whose dog (`ownershipChoices`: Owned, Co-owned,
   and someone else's only with `externalOwnership`), the owner for someone else's (a
   contact, or a name that becomes a new contact), the kennel with several own kennels.
   Checks she can tap past: a breed spelled unlike one her dogs have ("Did you mean Golden
   Retriever?"), a registration number in the registered-name box, a new owner like a
   contact she has. On save, a breed matching hers but for case or spacing takes her
   dogs' spelling. (The breeder step asks the same of a kennel or contact like one on file.)
4. **Is this her?** (`match:<i>`, only when `findMatchesFor` finds dogs on file it may be:
   `dogSearch.findDogMatches` over every dog not archived, pedigree-only and outside ones
   included, with its call and registered names, number, breed, birthday and sex; up to six,
   surest first, each showing why, "Same breed and birthday" / "Different breed"; a dog
   another one on the roster already is isn't offered). The same number titles it "That
   registration number is Daisy's". **Yes, that's her** on one of hers **fills in** that
   record: only what's blank on it is written, its parents and breeder are the starting
   answers, and nothing is made. On a pedigree-only dog it's **brought into use** (the Dog
   page's bring-in: updated with her answers, `pedigree_only` false). **No, a different dog**
   makes a new one. Changed details ask again.
5. **Their parents** (`parents:<i>`, optional: "If you don't know yet, leave them as Not
   known"): mom and dad each **Not known**, one of the dogs being added, a dog on file of
   that sex (same breed first), or one typed in, made pedigree-only: its **registered name**
   (required, as the pedigree reads), registration number and call name (optional). It's
   looked up with `findDogMatches`: its number on a dog on file is that dog, picked for her
   (`resolveTypedParents`); the same name (call or registered, titles ignored, misspelled
   or not) with nothing different, or a near one with something agreeing, gets "Is that …,
   already in KennelOS? Pick her from the list if so" once, a check she can tap past; one
   of the batch is refused. Littermates with the same typed mom share one record.
6. **Who bred it?** (`breeder:<i>`): **I did** (her kennel is its `breeder_kennel_id`), **Another
   breeder** (Pro, `contactsSection`: their kennel, one on file or a new name, required, and
   optionally the breeder, a contact picked (one with a kennel fills the kennel) or a new
   name, phone and email), or **Not sure**. Lite offers **I did** / **Someone else** / **Not
   sure**, and someone else saves nothing. Each dog starts with the dog before's answer
   (`breederDefault`), so dogs from one breeder take one tap each.
7. **Review** (`reviewSections`): a section per dog with **Parents**, **Breeder** and **Change**, the dogs
   already in KennelOS, and **Add or take off a dog** (back to the roster).

**The save** (`saveGuidedDogs`), per dog: its owner (one new contact per typed name, typed
Breeder), its typed parents (one pedigree-only dog per name and sex, so littermates share
it), then the dog: owned or co-owned in her kennel (`resolveKennelIdForWrite` when not
asked), its breeder kennel (`saveBreeder`: hers; or another breeder's, a typed name
through `kennelRepo.findOrCreateOutside`, the outside kennel on file by that name (trimmed,
any case, not archived) or else a new one, as every Kels add-a-kennel does (the tidy-up,
the litter task's outside parent); the breeder a
contact typed Breeder linked to it by `contacts.kennel_id`, one she picked gaining the
kennel if it had none; one new kennel and one new contact per name across the batch, the
owner's included), an owned dog's owner her own contact (the Dog page's prefill), and her kennel's
planned tests for the breed (`kennelRepo.seedTestsKennel` + `testsForBreed`, the Dog page's
seeding). Then each parent from the same batch is linked. **Resumable:** each id goes back on
the draft as it's made. **Lite:** the cap (`CapExceededError`) stops the save; the dogs made
so far are kept and linked, the rest aren't made, and she says who she added and shows
`renderUpgradeNudge`.

**The draft:** `settings.guidedDogsDraft` (`DRAFT_VERSION`), as the litter's: device-only,
cleared by Reset App, one at a time.

**After the save, when she got them** (all editions, the dogs made that are owned or
co-owned and she didn't breed, `canBeBought`): "Did you buy any of them? I can add when you got them and who from. A rough
date is fine if it's hard to remember." **Yes, let's add that** opens one form, a block per
dog (ticked; untick any she didn't buy): the date (required), who from (starting as the
breeder kennel's name), the price.
`saveAcquisitions` makes each an `acquisition` event (titled "Purchased from <seller>",
`details.source`), and a price an expense linked to it (`expenseRepo.createForEvent`,
category `dog_purchase`), exactly as the event form's Cost does.

**Their shots** (the same dogs): "Do you have their shots on record?" **Yes, let's add
them** asks one form per dog over `vocab.VACCINE_CHECKLIST` (Rabies, DHPP, Bordetella,
Leptospirosis): the date given (blank = skip; a rough date is fine) and how long it's good
for (`VACCINE_GOOD_FOR`: 1, 3 or 5 years, or Lifetime; 1 year suggested), and **Remind me on
Today when they're due** (ticked). `saveShots` makes each dated row a `vaccination` event
titled "Rabies (3-year)" / "DHPP (lifetime)", `details.vaccine`, `details.next_due` = the
date plus its years, and with the reminder that date as `reminder_date`, so Today's
Reminders card brings it up like any other reminder. Lifetime has no due date or
reminder. She names the next one due.

**Then** (Pro, `editionFlags.documents`): "Do you have any papers to file for
them?" **Yes, let's file them** asks which dog (with several), then a form in the chat: the
type (`DOC_TYPES`), a PDF or photos (taken or chosen, built into one PDF), a title, a date,
and the type's fields (`documentFieldsFor`; a registration's number prefilled from the dog).
It's filed through the Documents modal's own `storeDocumentFile` + `createDocument` (§26.1;
`documentModal.js` is imported only then). **Another for Daisy** / **One for another dog** /
**That's all for now**. Then **See Daisy** (or **See my dogs**), **Help me with something
else**, **Back to Today**.

### "Add people"
**Editions:** Pro (`editionFlags.contactsSection`; Lite has no Contacts pages). The script,
`assets/guidedPeopleUI.js`, is in `proPages.js` and `kels.js` imports it on start; its data
half, `data/guidedPeople.js`, is shared like every data module. Several people in one go,
on the step engine, the way Add dogs takes dogs. `stepsFor(draft, { contacts })`:
1. **Who are we adding?** (`roster`): a row per person, their name and what they are to her
   (`ROSTER_TYPES`: `CONTACT_TYPE` but Handler, which a show event tags), **+ Another
   person** (up to `MAX_PEOPLE`, 20) and ✕. A name twice on the list is refused. The type
   picked here joins their types (`afterRoster`; changing it there replaces it).
2. **Her vet** (`vet`, `asksVet`: nobody on the list is a vet and `contactSearch.hasVet` finds
   none in her contacts; once answered it stays): "Do you have a vet you'd like to add?" with
   `VET_WHY`. **Yes, add my vet** (a name, `VET_NAME_HINT`) puts the vet on the list, last,
   typed Vet, and they get a details step (`afterVet`); **They're in my contacts** picks one,
   tagged Vet on save; **Not now**.
3. **How did you meet them?** (`common`, two or more people, optional):
   `first_contact_source` (her earlier answers suggested), filled in on each as Add dogs'
   "in common" is (`fillFromCommon`).
4. **Each person** (`person:<i>`): what they are (checkboxes, at least one), phone, email (one
   that doesn't look like an address is a check she can tap past), address, Facebook, met
   through, notes: the Contact page's fields.
5. **Is this them?** (`match:<i>`, when `findMatchesFor` finds someone with
   `contactSearch.findContactMatches`; up to six, surest first, each with why: "Same email",
   "Similar name"; someone another person on the list already is isn't offered). **Yes**
   fills in that contact: only what's blank on it is written, its name kept, their types
   added; its kennel is their kennel. **No, someone new** makes one. Changed details ask again.
6. **Their kennel** (`kennel:<i>`, a breeder, unless the contact they are on file has one):
   **Yes** (`kelsSteps.kennelPicker`: an outside kennel she has, or a new name, with "Is that
   Elmwood Kennels, already in your kennels?" once) or **No, or not sure**.
7. **Breeders already in her contacts with no kennel** (`breeders`, `breedersWithoutKennel`,
   not anyone on the list): a picker each, optional.
8. **Review** (`reviewSections`): a section per person (**Kennel**, **Change**), then "In your
   contacts already": her vet and the breeders' kennels; **Add or take off someone**.

**The save** (`saveGuidedPeople`): each person made through `contactRepo` (or filled in), a
breeder's kennel through `kennelRepo.findOrCreateOutside` (one kennel per name across the
run) as their `kennel_id`; her vet on file `ensureType('vet')`; each breeder on file linked
to their kennel if they still have none. **Resumable:** each id goes back on the draft.
Returns the contacts and `kennelIds`, the kennels made or linked in this run.

**The draft:** `settings.guidedPeopleDraft` (`DRAFT_VERSION`), as Add dogs': device-only,
cleared by Reset App, one at a time.

**After the save, the dogs they bred** (when this run made or linked a kennel and she has
dogs with none: owned or co-owned, not pedigree-only, not archived, no `breeder_kennel_id`,
`dogsWithoutBreeder`): "Do you want to link any kennels to dogs you own as the kennel who bred
it?" **Yes** opens one form, a picker per dog: **Not this one**, the kennels from this run
("Just added"), then her other outside kennels (`breederKennelChoices`; never her own, which
the litter task sets). `breederLinks` keeps only dogs still without one and outside kennels,
saved through `dogRepo.update`.

**Then, the waitlist** (`editionFlags.waitlist`, a buyer among them, and an own kennel with
its waitlist set up, `waitlistIsSetUp`): "Would you like to put them on your waitlist?" Each
one she picks (and the kennel, with several) runs the applicant step,
`kelsApplicant.askApplicant` (imported only then), with that contact: its name, email and
phone fill in the form's, and the application is saved **linked to the contact**
(`contact_id`) at once. Then **See Pat** (or **See my contacts**), **Help me with something
else**, **Back to Today**.

**The applicant step** (`assets/kelsApplicant.js`, Pro-only): her application in the chat (her
questions, preferences and readiness, `assets/waitlistApplicationForm.js`), then the
program, when they applied and her notes, saved as an application (`applied`), as the
Waitlist entry page saves one. Set up my waitlist's **Add one by hand** and Add people both
run it; without a contact it's linked at approval, as ever.

### "Check in on a litter"
Each thing she approves is saved at once; there is no draft.
1. **Which litter:** `checkinLitters` — every litter not closed or archived, in kennel scope
   (pups at home first, newest born first; then Expected; then Sold). An Expected litter
   offers **Yes, record the birth** (hands off to the litter task).
2. **Where it stands:** age (`ageText`), status, the roster by plan (`dispositionSummary`;
   `rosterOf` drops archived and deceased pups, in the order added) and how many went home.
   Pups **at home** (`homePups`: `status: 'puppy'`, no delivered sale) are the ones weighed
   and treated.
3. **Decisions**, one at a time, each once per visit (`checkinSuggestions`, then each home
   pup's `goHome.goHomeIssue`):
   - When the litter can close (`litterCloseDue`, §19), that is the only litter question.
   - **Open picks** (Pro, `editionFlags.waitlist`, active families in the kennel,
     `waitlistRules.depositsDueLitters`): `waitlistPicksPanel.openPicksFromCheckin` (Pro-only,
     imported dynamically; the panel's `openPicks` and "Email the family?"), or **move the
     deposit date** (a date after today, default a week out), or **Not now**.
   - **Weaning** at 4 weeks while Whelped; **Ready** at the ready date while Weaning
     (`goHome.readyDateOf`: `estimated_ready_date`, else whelp + 56); **Sold** / **Reopen to
     Ready** (§19).
   - Per pup with a sale in progress: **log the boarding** its sale charges for (start = the
     ready date or today, end from the charge, `boardingEnd`: the count × Day/Week/Month);
     **When is the pickup?** (a `placement` event, "Puppy pickup", the buyer as related
     contact); **Did they go home?** after the pickup date — **Yes, mark the sale
     delivered** saves it Delivered in the chat, then asks what the Sale page's Delivered save
     asks: Pro (`externalOwnership`), how the pup shows on her roster (the family owns it now,
     we co-own, or leave it; `goHome.deliveredOwnershipChanges`, the Sale page's rule too);
     Lite, whether it leaves the program (archived, permanent). Closing the litter, when due,
     comes up with the litter questions after. "The pickup moved" asks a new date.
4. **"What are we doing first?"** until **That's all for now**:
   - **Record weights:** date, AM/PM, pounds + ounces per home pup beside its last weight; one
     `weight_check` "Weight check" per pup entered (`weightDetails`). Kels compares each with
     its last (`weightReport`) and names pups down or flat.
   - **Health care** → "What did they receive?" → **Deworming or flea & tick**, **Shots**,
     **Other medication**, **A vet visit** (`CARE_KINDS` → `preventative` / `vaccination` /
     `medication` / `vet_visit`): the type's vocab fields, a date (medication also an optional
     last dose = `event_end_date`), and which pups. One event per pup, titled by the named
     product / vaccine / drug / reason, else the kind's `title`. A vet visit's vet is the
     plain-text `vet` field.
   - **Something else:** puppy plans (disposition per pup; Placed is shown, not editable),
     microchips (`microchip_id`), the deposit and ready dates, the litter's status (any but
     Expected), the litter's page.
   After each, the records reload and new decisions come up.

### "Pups are going home"
The run-up to go-home day for one litter. Each fix is saved when approved; there is no draft.
1. **Which litter:** `prepLitters` — born litters (Whelped, Weaning, Ready, Sold) not
   archived, in kennel scope, with a pup at home (`homePups`), newest born first. One such
   litter is chosen for her.
2. **Which pups:** the litter's pups at home, each with its sale's status and family, or
   "No sale". Ticked by default: a sale at Deposit paid or later (`pickedByDefault`); any pup
   can be ticked.
3. **Optional checks:** "Want me to check any of these too?" — the `optional` items this
   edition has (`optionalItems`: microchip numbers, the litter's registration number, each
   pup's registered name and number, a feeding schedule). Unticked the first time, then as
   she left them on this device (`settings.prepChecks`). Only ticked ones are checked
   (`readiness({ checks })`).
4. **A plan with no sale** (`planWithoutSale`, every pup at home, chosen or not): a pup
   marked Available or Placed with no sale going ahead (none, or only a returned /
   cancelled / voided one). **Record the sale** (several: tick which) asks, per pup, the
   family (one she has, buyers first, or a new one: name, email, phone, typed Buyer), where
   it's at (Deposit Pending / Deposit paid / Paid in full, and the date paid: `deposit_date`,
   and `balance_paid_date` too for Paid in full), the registration (from
   `intended_registration`), and the price and deposit (`expectedPricing`; the price follows
   the registration until she types her own); the pup becomes Placed and joins the chosen
   pups. **Change the plan** sets any plan but Placed. Placed pups left without a sale are
   offered the plan change after.
5. **Where they stand:** per pup, "n of m done" and what's missing.
6. **One thing at a time**, in `READY_ITEMS` order, each once per visit, for every chosen
   pup missing it (**Not now**, or **That's enough for now** to skip to the end):

   | Item | Done when | Fix |
   |---|---|---|
   | Microchip (optional) | `microchip_id` set | the check-in's microchip form |
   | Litter registration number (optional) | the litter's `litter_registration_number` | one number for the litter, typed in the chat |
   | Registered name and number (optional) | the pup's `registered_name` and `registration_number` both set | both per pup, typed in the chat; a blank leaves that field as it was |
   | Shots | a `vaccination` logged | the check-in's care form (Shots) |
   | Deworming | a `preventative` logged | the check-in's care form |
   | Drop-off date (sale) | a `placement` event for the sale's family (`goHome.pickupFor`) today or later | **When's the drop-off?**: date, time, how (`PLACEMENT_METHODS`) per pup; `goHome.pickupEvent` (titled "Puppy drop-off" unless Local pickup) |
   | Balance (sale) | Paid in full / Delivered, a `balance_paid_date`, or a `balance_due_date` | a due date per pup (`saleRepo.update`) |
   | Contract signed (sale, Pro `contracts`) | a signed contract on the sale | **Where are the contracts at?**: a status per pup (`CONTRACT_STATUS`), and the signed date when Signed; saved on the sale's first live contract, or a new `sale` contract (title "<pup> sale contract", kennel from the sale) when it has none; "No contract yet" skips it |
   | Registration type (sale) | `registration_type` set | **How is each puppy registered?**: a `REGISTRATION_TYPE` per pup (prefilled from `intended_registration`); then, as the Sale page does, the price change for the litter's Full surcharge (`saleDefaults.priceForRegistrationChange`, asked first; a fee that was the estimate follows the price) and, for Co-own, adding the family as the pup's co-owner (asked) |
   | Feeding schedule (Pro `feedingSchedule`, optional) | the litter's `feeding_schedule_override`, or a breed schedule for the pup's breed | **Just this litter**: the litter's feeding note typed in the chat; **For the breed**: the Feeding schedules page (a table editor) |

   The `placement` event ("Placement / drop-off") is the only go-home date the app keeps;
   Furever's pickup plan reads it too (§27). The typed Furever pickup fields on the Sale are
   only Furever's fallback for a pup with no drop-off event, and don't count. Every fix but
   the breed feeding schedule happens in the chat; that one leaves Kels, and she says to
   start Pups are going home again after.
7. **Balances still owed** (Pro: `accounts` or `invoicing`): chosen pups whose sale is at
   Deposit Pending or Deposit paid, with no `balance_paid_date` and a balance
   (`contractSend.balanceDueOn`) above zero, listed with the amount and due date, then **Yes,
   let's do it**. Each family in turn gets both, one after the other, each with **Skip**:
   **Send a payment request** (`paymentRequestUI.openPaymentRequest`, the Sale page's;
   offered only when a Payment service takes payments, `paymentAccounts`, or has her Stripe
   key here; otherwise she says to add one on the Accounts page), then **Make an invoice**
   (`openInvoiceGenerator({ preselect, onClose })`, said first to open in a new tab; Kels
   waits for the modal to close).
8. **The end:** all done, or what's still missing per pup. Pro: the **Furever link** is
   offered (`furever.html`) when a chosen pup has an open sale; it isn't tracked, so it's
   never an item. Pro (`puppyRecord`): **Print puppy records** opens
   `puppy-record.html?dogs=…&cover=1&autoprint=1&checks=…` (the optional checks she ticked) in a new tab (a link if the tab is
   blocked). Both tabs are announced first ("Of course! I'll have to open a new tab to
   print from. Once you print, you can close that tab and come back here; I'll be
   waiting.") and open only on **Okay, open it** (`openTab`). Lite runs the same check without Furever or the print, and its menu entry
   neither mentions nor searches either.

### "Set up my waitlist"
**Editions:** Pro (`editionFlags.waitlist`); the script is in `proPages.js` and `kels.js`
imports it on start. The kennel's waitlist settings, its online list and its programs, for a
breeder starting from nothing. Related settings are one screen each, the on/off ones as
checkboxes, never a question apiece:
1. **The fee:** the shared fee step (`waitlistFeeStep.askWaitlistFee`, under "Set up my
   application form"): amount, refund policy, days to pay, how families pay, and with
   `accounts` the payment account (one she has, Stripe connected in the chat, or another
   payment service she names) and when it's asked for.
2. **Offers:** days to accept and pay, passes before removal, then checkboxes: no response
   counts as a pass, color matching, and every `WAITLIST_AUTO_OFFER_TRIGGER` moment (All /
   None).
3. **Going online** (only where `isWaitlistOnlineOffered()`): asked first. It publishes
   through this device's cloud backup, so when that's off or signed out she offers **Turn on
   cloud backup** (`kelsBackupSteps.offerCloudBackup`, with the `CLOUD_OFF_FORM` warning:
   no link, each applicant typed in by hand) and goes on only once it's on. Then one screen:
   list online, applications online, reminder emails; what shows before picks open
   (`UPCOMING_STAGES` × public / family pages); "Ready now?" unanswered and its days; the
   Facebook button and Page; her website (`embed`, addresses); the public list's message;
   the time zone. Saved by `cloudWaitlist.saveWaitlistOnline` (the Online list card's save),
   then the public list and form links.
4. **Programs:** as many as she likes (name, place in line, fee, days to accept, passes not
   counted, pause allowed, a description), through `waitlistProgramRepo`.
5. **Families she already has:** **Add one by hand** runs the applicant step
   (`kelsApplicant.askApplicant`, under "Add people"); **Add another family** repeats. **Import a list** opens the waitlist import (a page of its own; leaves Kels).

Every config save is checked by `waitlistRules.waitlistConfigProblem`, the Kennel page's
settings card's check too. **Re-runnable:** on a kennel already set up
(`waitlistIsSetUp`) she says what's set (`waitlistSummaryLines`) and asks which part to
change. The emails, pass reasons and "Almost your turn" message keep the standard wording;
she says where to change them. At the end she offers **Set up my application form**, handing
it the kennel (`handoff('form-setup', { kennelId })`).

### "Set up my application form"
**Editions:** Pro (`editionFlags.waitlist`). The script, `assets/guidedFormUI.js`, is in
`proPages.js` and `kels.js` imports it on start; its data half, `data/guidedForm.js`, is
shared. The Waitlist form page (`waitlist-form`) as a conversation, for one kennel (asked
with several; Set up my waitlist hands its kennel over), on the step engine, with the page's
own rules (`waitlistForm.formQuestions`, `validateQuestions`, `validateFaq`, `newQuestion`,
`LOCKED_TYPE_LABEL`). `stepsFor`:
1. **Where shall we start?** (`start`, only when she has saved a form or FAQ of her own,
   `hasOwnForm`): **Keep my form and change it** or **Start over from the standard form**
   (`startFrom`; her FAQ stays either way).
2. **The locked questions** (`locked`): name, email, the preferences, readiness and the
   public-list notice, shown together, each with what it does ("decides which pups they're
   offered"); only the wording changes (the notice's text too).
3. **Her own questions** (`questions`): each with its wording, answer type
   (`WAITLIST_QUESTION_TYPE`; a choice type shows its choices, one per line), help text and
   "Required on the online form", ✕ to take one off, **+ Add a question** (just above the
   notice, `addQuestion`).
4. **The order** (`order`): every question with ↑ / ↓ (`move`).
5. **Her FAQ** (`faq`, optional): her questions and answers, with `FAQ_STARTERS` to start
   from (price, going home, the fee, how the waitlist works, delivery) and **+ My own question**.
6. **Review:** the FAQ and the whole application as a family sees it (`applicationFields`,
   disabled), with buttons back to each part.

**The save** (`saveGuidedForm`): one write of `form_questions` and `application_faq`, cleaned
by the page's rule (`finalForm`), over the kennel's latest config. Nothing is written before
it, so a half-made form never goes online. **The draft:** `settings.guidedFormDraft`
(`DRAFT_VERSION`), as the others: device-only, cleared by Reset App, one at a time.

**After the save:**
- **Sensitive records** (`kelsBackupSteps.offerSensitiveRecords`, only where
  `isVaultOffered()`): "Applications hold families' phone numbers, addresses and notes."
  Cloud backup first if it's off on this device (`offerCloudBackup` → `turnOnFlow`), then,
  if the vault is off, **Turn it on** (`turnOnVaultFlow`). Nothing is said when it's on.
- **The fee and how families pay:** what's set ("a $300.00 application fee, paid online
  through Stripe") with **Change the fee** / **It's right**, or "Do you charge an
  application fee?". It's the shared fee step, `assets/waitlistFeeStep.js`
  (`askWaitlistFee`, Set up my waitlist's too): amount, refund policy, days to pay, payment
  instructions, and with `accounts` the Payment service it's paid through: one she has,
  **Stripe (I'll connect it now)** (a new Payment service account, then **Connect Stripe**
  in the chat, `vendorKeyFlow`), or **Another payment service…** (its name and payment link,
  made as a Payment service account), and when the fee is asked for.
- **The link to share** (where `isWaitlistOnlineOffered()`): her form is online only while
  her list is online taking applications (`online_form`). Already so: it publishes now
  (`cloudWaitlist.syncWaitlistOnline`). Otherwise "Want families to apply online?" (or, with
  the list online, "take applications online?"); **Yes, take applications online** asks for
  cloud backup first if it's off (`offerCloudBackup`, warning with `CLOUD_OFF_FORM` that
  without it there's no link and she'll type each applicant in herself; **Not now** says so
  again), then `saveWaitlistOnline(kennelId, { online: true, online_form: true })`. Then
  "Your form is live! Families apply at <link>" with **Copy the link** (`waitlistUI.copyLink`,
  a box to copy from where the clipboard is refused), or what's stopping it
  (`onlineProblemText`).
- **"Do you have a family to put on the list now?"**: the applicant step (under "Add
  people"), asked with the new form; **Add a family** repeats.
- Then **See my form** (the Waitlist form page), **Help me with something else**, **Back to Today**.

### "Check account health"
One look at whether her program is safe and working: her KennelOS account and this device,
never the business Accounts page. All editions; each check only where its feature is.
`gatherHealthFacts()` reads what the checks need, each part `null` when it can't be read
(offline), so its checks are skipped, never guessed; `accountHealth.healthFindings(facts)`
(pure) decides; the findings loop (`kelsFindings.js`, prefix `health`) raises them in
`HEALTH_KINDS` order, records at risk first:

| Finding | When | Fix |
|---|---|---|
| `storage-persist` | `navigator.storage.persisted()` is false | `db.requestPersistentStorage()`; if the browser declines, she says so |
| `backup-paused` | cloud backup on and paused (`isBackupBlocked`) | Back up now (below) |
| `backup-off` | cloud available, backup off (not "moved to Pro") | `cloudBackupUI.turnOnFlow()` |
| `backup-behind` | on, never backed up, or changes waiting more than a day | Back up now: `pushIfDirty({ force: true })` → `handlePushResult` (its conflict / shrink / unlock dialogs) |
| `export-old` | no working cloud backup, and the last JSON backup file (`getLastBackupDate`) is over 14 days old or never | `importExport.downloadBackup()` |
| `vault-locked` | Sensitive records on, not unlocked here | `cloudVaultUI.unlockModal()` |
| `recovery-unsaved` | an unsaved recovery code, or none | `saveRecoveryCodeFlow()` / `newRecoveryCodeFlow()` |
| `license-grace` | Pro gate on, license in grace | **Check it again now** (`evaluateLicense`), **Renew my subscription** (the checkout in a new tab, announced, then checked again), or **Use a different key** (pasted in the chat, `license.activate`) |
| `update` | a new service worker is installing or waiting, or took over since the page loaded | reload |
| `device-lost` | another device on the account (not erasing, not signed out on its own) unseen 60+ days | `cloudBackupUI.devicesModal()`; "It's fine, I still use it" is remembered |
| `key-rejected` | Pro `accounts`: a Stripe / Jotform key on this device that its vendor refuses (`stripeCheckKey` / `jotformUser`, one call each, skipped offline) | **Help me replace it**, all in the chat: the steps to make a new key in a new tab (Stripe's from `stripeLinks.STRIPE_KEY_PERMISSIONS`, the list the Accounts page shows too), a link to the vendor (the account's `website`, else its API page), the account's saved username and password when it has them (the password masked until **Show**; **Copy** for each), then the new key and currency / region pasted in and checked and saved by `connectStripe` / `connectJotform`, as the Accounts page connects. "I'll do it later" leaves it for the next visit |
| `waitlist-signed-out` / `waitlist-error` | Pro `waitlist`: a kennel's list is online, and this device isn't signed in / its last update failed | signed out: **Sign in now** (`cloudBackupUI.signInModal`); failed: why (`waitlistOnlineUI.onlineProblemText`), **Turn on cloud backup** when that's the reason, or **Try again now**. Either way she publishes at once (`syncWaitlistOnline({ force: true })`) and says how it went |
| `vault-off` | Sensitive records offered and off | `turnOnVaultFlow()` |
| `passkey-none` | on, passkeys supported, none added | `passkeysModal()` |
| `storage-full` | 80%+ of the browser's quota used | none; she says so |

Right after she looks, a **status report** (`healthReport`), one line per area she could
read, good or not: this device (kept safe or not, space used of the quota), cloud backup
(on and when, paused, off) or the last backup file, the Pro license (state, plan, renewal
or due date, on n of m devices: Lemon Squeezy's `activation_usage` / `activation_limit`,
kept on the cached record as `activationUsage` / `activationLimit`), devices signed in
(by name), Sensitive records (backed up, unlocked here, recovery code, passkeys), each
vendor connection, each online waitlist. Then the findings, or **All good**. She closes with
what's still worth a look. Sync isn't checked. Every fix
happens in the chat or a dialog over it.

### "Tidy up my records"
She finds places two records disagree, says how many of each kind, then raises them one at
a time; each fix is saved when approved, and she looks again after every one. **Kels only:**
none of these are Today nudges. Every finding offers **Not now** (this visit) and an answer
remembered on this device in the nudge ledger under `tidy:<key>` ("Don't ask me again", "Not
the same dog", "Unknown"…). A key carries the values it was raised on (a count, the parents),
so a record that changes again is asked about again.

The checks (`data/tidyRules.js` `tidyFindings`, in `TIDY_KINDS` order; litters, sales, stud
services and her dogs are kennel-scoped, duplicates, contacts and kennels program-wide):
- **Litter count:** `puppies_born_alive` (else total less deceased) ≠ the litter's pup
  records, departed and deceased pups counted. Fix the count (`countFix`; the total follows
  when it no longer adds up), or, when pups are missing, **Add the missing puppies** in the
  chat: a name and boy or girl each, the rest from the litter (`puppyDefaults.baseFromLitter`,
  as the Litter page's Add puppies; undecided). A dam with no breed is said, not worked around.
- **Delivery:** a live litter at Whelped or later with no `delivery_type`
  (`tidyRules.deliveryFindings`, newest first) → one tap per delivery type; "I don't remember"
  is the remembered answer.
- **Puppy plan:** a pup with a sale not returned, cancelled or voided whose disposition isn't
  Placed → Placed.
- **Went home:** an `owned` dog with a Delivered sale (and no newer sale going) → Pro: the
  buyer owns it (`external`, `external_reference`) or co-owns it
  (`goHome.deliveredOwnershipChanges`, as the Sale page and the check-in); Lite: leave the
  roster (archive). Co-owned dogs aren't asked about.
- **Litter vs. breeding:** a litter's sire/dam ≠ its pairing's → fix either side.
- **Pups vs. litter:** a litter's pups with a blank sire/dam (fill from the litter) or a
  different one (use the litter's).
- **No parents:** her own dog (owned, co-owned, leased in) not from one of her litters with a
  blank sire/dam → pick a dog already on file (right sex, same breed first), or add one: hers
  (owned, in the dog's kennel; at Lite's cap she shows the usual upgrade notice, `renderUpgradeNudge`, and skips that parent) or somebody else's as a
  pedigree-only dog, asked by its registered name (required) and registration number (no
  call name). Either is looked up first with `dogSearch.findDogMatches` (both names, its
  number, the dog's breed, the sex): the same number is that dog (she says so and uses
  it); the others are offered with why, before a new one is made.
- **Stud service** (`studServices`): past its date (returned, else sent; or Completed), not
  cancelled or failed, no `pairing_id` → link a breeding of the same two dogs opened from two
  weeks before it was sent that no other service claims, or **Record the breeding** in the
  chat: the parents from the stud service (`studRules.studParents`: ours is the sire or the
  dam by its sex), the first date (default: sent) and how it went (any status but Planned); an
  `actual` pairing, due 63 days on, kennel from the dam then sire, and the stud service's
  `pairing_id` set. Whelped says to record the litter with her next, except when our dog is
  the stud (the litter is the dam's owner's).
- **Breeder without a kennel** (`contactsSection`): a Breeder contact with no `kennel_id` →
  pick or add the kennel.
- **Kennel without a contact** (`contactsSection`): an outside kennel no contact belongs to →
  pick a contact (tagged Breeder) or add one; archive it when no dog names it.
  Picking and adding a contact are one pair of chat forms (`pickContact`, `addContact`) the
  kennel and vet findings share.
- **Vet not in contacts** (`contactsSection`): vet visits and surgeries (`VET_EVENT_TYPES`,
  the types whose `relatedContact` is 'Vet') with the vet typed as a name (`details.vet`) and
  no `related_contact_id`, one finding per name however it's typed (named by her most-used
  spelling), program-wide → link them all to the likely contact (the same name, a vet
  first, else `similarNamed`), one she picks (vets first), or one she adds (prefilled with
  the name). The contact is tagged Vet and replaces the typed name (`vetLinkFix`, as the
  event form clears it).
- **No vet** (`contactsSection`): she has a dog and no live contact is tagged Vet → add her
  vet, or tag one of her contacts. Comes after the one above, which usually settles it.
- **Duplicate dogs:** missing details are unknown, never a difference. *Certain:* the same
  registration number, or the same registered name with no differing number. *Possible:* the
  same call name and breed with nothing contradicting (registration number, birthday,
  microchip, sire, dam differ only when both have them). Never: a known sex that differs,
  littermates by name, a dog and its own parent or child. Archived dogs are skipped;
  pedigree-only ones are included.
- **Duplicate contacts** (`contactsSection`): the same name (case, spacing and punctuation
  ignored) plus one shared email, phone (last 10 digits), address, Facebook, or kennel.

**Merge** (`data/recordMerge.js` `mergeRecords(kind, keepId, dropId, choices)`): she picks the
record to keep (`suggestKeep`: in use over pedigree-only, then fuller, then older), then
which value wins where both have one and they differ (`mergeConflicts`; a dog's ownership,
status, kennel and owner are one choice). Blank fields fill from the other, lists join, notes
keep both. The kept record is updated through its repo, then every row pointing at the other
(§7) is repointed in one transaction, then the other is archived; a contact's
`waitlist_status` is recomputed. Refused: dogs of a known different sex or in each other's
pedigree; contacts who both hold a live (applied, fee due, on the list) place on one kennel's
waitlist.

---

## 34. Live sync (Cloud Phase 2) — `docs/KennelOS_Cloud_Phase2_Sync_Plan.md`

**Editions:** Pro only (`editionFlags.liveSync`, and `isCloudAvailable()`). Lite and Demo
never sync.

The plan is the detailed design. This is the shape of what's built.

- **Where she turns it on:** Import / Export → Backup & restore → Cloud, **Keep my devices in
  step**, a dropdown under Sensitive records (`assets/cloudSyncUI.js`, loaded only when
  shown). It's offered where `cloudConfig.isSyncOffered()`: Pro, a server, and the release
  switch `SYNC_RELEASED` (true; false would offer it only against staging, localhost or
  `?cloud=staging`). A device that already syncs keeps syncing whatever the switch says;
  `bootCloud` starts the scheduler only on such a device. The dropdown reads Off / Off on this
  device (the program syncs: **Keep this device in step…**) / On · 2 devices · synced just
  now / Paused (the reason, and its fix) / Joining…. A backup refused because the program
  syncs offers the join in place of Phase 1's restore / replace. Turning it on names what's
  missing first (`syncReadiness`); a backup paused as a second device doesn't count, since
  joining fixes it.
- **The activity list** (Recent activity…): what sync decided by itself in the last 30 days,
  one sentence each (`data/cloud/syncActivity.js`).
- **An open page when records arrive** (`SYNC_APPLIED_EVENT`, relayed to other tabs by
  `BroadcastChannel`): a record page whose record changed shows "Updated on another device"
  with Reload; a list page or Today reloads itself unless she's typed there or a dialog is
  open, else it gets the same notice. The device list shows each device's "last synced".

- **Needs Sensitive records (the vault).** Each record goes up in both tiers: its cloud
  fields readable as in backups, and the whole row sealed with the vault key. Turning the
  vault off ends sync.
- **Changes are found by a scan, not an outbox.** `data/cloud/syncState.js` keeps a hash
  per row in the device-only `sync_meta` table (`db.version(2)`, in `DEVICE_ONLY_TABLES`,
  never in a backup). Any write that changes a syncing row gets found, so **no write path
  needs a sync hook.** `data/cloud/syncRecords.js` is the wire format (pure).
- **Server order wins per record.** Records live in D1 (`cloud/src/sync.js`, migration
  `0014`). The server keeps only fields on its allow-list, `cloud/src/lib/cloudFields.js`,
  which is generated from `data/syncRegistry.js` (`node cloud/scripts/cloud-fields.mjs`).
- **`data/syncApply.js` is the second direct writer of every table**, beside
  `importExport.js`. Pulled rows skip the repos so they keep their own timestamps, and they
  don't call `markDataChanged()`, or they'd be pushed straight back. The one local change it
  makes, turning a delete into an archive, does mark dirty. Pages listen for
  `SYNC_APPLIED_EVENT` and never treat it as a local edit. 
- **The loop:** `data/cloud/cloudSync.js` does push then pull, the lock, the scheduler and
  pauses. A lapsed license pauses sync. Joining a program: first every cloud record is read
  and paired by content with this device's (§10's rules; the pair keeps the cloud's id;
  `joinSync` answers `{ status: 'ask' }` while there's something to ask), then the newer
  `updated_at` wins and nothing gets deleted.
- **A new device on a syncing program** (Sign in and restore, first-run's "I already use
  KennelOS") joins instead of restoring the latest backup, once Sensitive records are
  unlocked there (`cloudBackup.prepareDirectJoin`); not unlocked, it restores as before.
- **Backups on a syncing program:** a snapshot states the `sync_seq` it has applied and goes
  only while the device is caught up (else it's skipped as `sync_behind`, still dirty). Any
  caught-up device may make the latest one, so a refusal that shows this device is caught up
  but its base is older takes the server's latest as its base and tries once more. While
  Pro has lapsed (sync paused `pro_required`) backups follow the Phase 1 backing-device rule.
- **Server work on a syncing program** (waitlist intake, family and vendor events, emails)
  runs on one device at a time under a two-minute lease (`data/cloud/serverWork.js`,
  migration `0016`).
