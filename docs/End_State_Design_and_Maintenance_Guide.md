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
  from `clearAllSettings()`**, so Reset App keeps paid entitlement. Inert in Lite/Demo.
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
4. **No CDN / no network deps.** Everything third-party is vendored under
   `vendor/` and loaded by relative path (Dexie, PapaParse, lz-string). The
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
| **Dog** | `call_name`, `sex`, `breed`, `ownership_type`, `status`; `kennel_id` when `owned`/`co_owned` (an own kennel) | `sire_id`, `dam_id`, `litter_id`, `breeder_kennel_id` (who produced it; prefilled from an owned dam's kennel) vs `kennel_id` (who has it now; an outside kennel for `external`/`leased_in`), `owner_contact_id` (required for `external`/`leased_in`), `co_owner_contact_ids[]`, `registered_name`, `registration_number`, `microchip_id`, `planned_tests[]`, `recorded_coi`, `url`. `disposition` (`undecided`/`keeping`/`available`/`placed`/`health_hold`) is **puppy-only**: forced null unless `status='puppy'`. `intended_registration` (`REGISTRATION_TYPE`) prefills a sale's registration and limits waitlist matches (§29); never cleared on growing up. `pedigree_only` = a lineage-only ancestor: no owner needed, `call_name` may be blank if `registered_name` is set (`dogRepo.dogName`). |
| **Contact** | `name` | `contact_type[]`, `email`, `phone`, `facebook_profile`, `address` (also the away-board location, §19), `kennel_id` (affiliation, not scope), `waitlist_status` (kept by `waitlistEntryRepo`), `first_contact_source`, `companion_note` (shown to the recipient, §20; `notes` is private). Buyers are Contacts; there is no Buyer table. |
| **Kennel** | `kennel_name` | `is_own_kennel`, `public_id` (identity, not an FK, §28), `prefix`, `location`, `website`, `logo_data_url` (kept under ~300 KB, `pages/kennel.js` `LOGO_MAX_CHARS`), `preferred_tests[]`, `preferred_breeds[]`, `preferred_test_breeds`, promote-nudge settings (§19), `puppy_record_fields` (§23), `time_zone`, `waitlist_form_keys` (private), `waitlist_fee_account_id` (FK → Account), `waitlist_config` (all waitlist settings; missing keys read from `waitlistRules.WAITLIST_CONFIG_DEFAULTS`, §29). |
| **Pairing** | `sire_id`, `dam_id`, `pairing_type`, `status`, `kennel_id` | `method`, `planned_date`, `last_observed_date`, `expected_due_date` (prefilled 63 days after `planned_date` when empty). Sire ≠ dam. |
| **Litter** | `dam_id`, `sire_id`, `status`, `kennel_id` | `nickname`, `pairing_id`, `whelp_date`, `accept_deposits_date`, `estimated_ready_date` (prefilled whelp + 56 days; follows a whelp change while still the prefill), `litter_registration_number`, `puppies_born_*` counts, per-sex `expected_price_*` / `expected_deposit_*` / `full_reg_surcharge_*` (private; `saleDefaults.expectedPricing`), `picks_opened_date` (§29), foster fields (§25), `feeding_schedule_override` (§27). Its puppies are derived (`Dog WHERE litter_id`). |
| **Sale** | `dog_id`, `buyer_contact_id`, `registration_type`, `status`, `kennel_id` | `sale_date`, `price`, `deposit_amount`/`_date`, `balance_due_date`, `balance_paid_date`, `transport_fee`, deferred boarding (`deferred_boarding_amount`/`_frequency`/`_duration_days`, the last a count of frequency units, §21), `end_reason`/`end_note` (voided/returned only), `lead_source`, `referred_by_contact_id` (§22), invoice fields (§24), `sales_channel_account_id`, `deposit_paid_via_account_id`, `balance_paid_via_account_id`, `processing_fee_amount` (a stored snapshot, §21.1), `fee_passed_to_buyer`, payment-link fields and `processing_fee_reports` (§32), `integration_reviews` (§19). Changing `registration_type` asks whether the Full surcharge follows (`saleDefaults.priceForRegistrationChange`). |
| **Contract** | `contract_type`, `kennel_id` | `status` (default `draft`), `related_sale_id`, `related_stud_service_id`; `related_dog_id` and `related_contact_id` only for `lease`/`co_own`/`foster`/`other` (forced null otherwise, `contractRepo.normalizeLinks`), `document_url`, `signed_date`, lease dates, e-sign fields and `integration_reviews` (§32), `title`, `terms_summary`. |
| **StudService** | `direction`, `our_dog_id`, `partner_dog_id`, `partner_contact_id`, `status`, `kennel_id` | `pairing_id`, `fee_amount`, `fee_structure`; `pick_status` and `pick_value_amount` only for pick fee structures (forced null otherwise), `type` (`in_person`/`ai`; in-person dates feed the away-board, §19), `referred_by_contact_id`, invoice fields (outgoing only, §24). |
| **Event** | `subject_type`, `subject_id`, `event_type`, `event_date`, `title` | `event_end_date`, `reminder_date`, `reminder_dismissed`, `related_dog_id`, `related_contact_id`, `details{}`. No cost field: a cost becomes an Expense with `event_id` (§8, §21). |
| **Expense** | `subject_type` (`dog`/`litter`/`pairing`/`kennel`), `subject_id`, `amount`, `category`, `expense_date` | `event_id`, `miles` × `mileage_rate` (then `amount` is derived), `vendor`, `receipt_number` (CSV re-import key, §9), `account_id`, `receipt_file_id` (deleted with the expense, §26.1), `reimbursable`/`reimbursed_date` (§21, §25). |
| **Document** | `dog_id`, `doc_type`, `file_id` | `title`, `doc_date`, `issuer_or_lab`, `result`, `registry`, `registration_number`, `contract_id` (optional, unindexed, not in the registry), `furever_shareable` (§27). Fields shown per type: `vocab.documentFieldsFor`. `hardDelete` removes its file. |
| **File** (`files`) | `blob`, `mime`, `filename`, `size` | `thumbnail`. Always a PDF. Owned by its one Document or Expense; fetched by id only (§26.1). |
| **WaitlistEntry**, **WaitlistOffer**, **WaitlistProgram** | see §29 | One entry per family per time on a kennel's list; position and passes are derived, never stored. |
| **Account** (`accounts`) | `name` | `account_type`, login fields (private), referral fields, fee rate, `contract_forms[]`, `payment_link`, `payment_instructions` (§32). Program-wide, no `kennel_id`. API keys live in `device_secrets`, never on the record. |

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
account FKs on sales, waitlist entries and kennels (§21.1, §32).

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
  an event uses); `addPreferredTest`'s breed tag, read by `testBreedsFor`/`testsForBreed`.
- **contactRepo.ensureType(id, type)** adds a role tag; sale, stud service and event saves
  use it (`buyer_referrer`, `stud_referrer`, `handler`, `vet`).
- **waitlistEntryRepo** keeps `Contact.waitlist_status` in step after every write
  (`waitlistRules.deriveContactWaitlistStatus`). **waitlistOfferRepo** checks entry, litter
  and offer share a kennel (§29).

**Derived aggregators** (no table): `incomeView.js` (income rows per Sale / outgoing
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
orphan rows.

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
- `getBoardRows()` — dogs away on boarding now; `awayBoard.js` unions it with in-person stud
  services (§19).
- `getUpcoming()`, `getScheduledPlacements()`, `getInRange(from, to)` (Calendar),
  `getByType(type)` (Shows page), `getDetailValues(type, key)` (suggestions).
- `getReminders()` / `getDismissedReminders()`. `reminder_date` is the app's **one**
  future-dated mechanism; snooze edits it, dismiss sets `reminder_dismissed`.
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
  - `'merge'` upserts by id.
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
  `logEvent=<type>` with optional `logDate`, `logTitle`, `logDetails` (JSON).
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
Kennel expenses, Logo and Kennel card.

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
3. **New FK** → `referenceRegistry.js` line. **New field** → classified in `syncRegistry.js`
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
| `studstatus` | a stud service's sent/returned date passed but status lags | `in_progress` / `completed` |
| `promote` | a kept puppy is past its kennel's promote age (opt-in per kennel) | promote to active breeding |
| `studpair` | a finished stud service has no `pairing_id` | create the pairing |
| `heatpair` | a heat cycle ended with no pairing for that dam since | create a pairing |
| `pairingduesoon` | a bred/confirmed pairing is due within 3 days, no litter | create the litter |
| `pairingoverdue` | a pre-whelp pairing is past due, no litter | mark whelped / create litter |
| `litterpairing` | a whelped-or-later litter's pairing isn't `whelped` | mark it whelped |
| `pairingended` | an ended pairing still has an `expected` litter | archive the litter |
| `pairingnolitter` | a `whelped` pairing has no litter (not for external dams or pairings over 180 days old) | create the litter |
| `deceased-sale`, `deceased-pairing` | a deceased dog has an open sale or a pending pairing | end the sale / cancel or fail the pairing |
| `deceased-archive` | a puppy died in its first year (last 90 days) | Archive (Lite: Remove from program) |
| `littersold` / `litterreopen` / `litterclose` | a litter's roster is all resolved with one placed / a pup is available again / every placed pup's sale is delivered | change litter status |
| `show-title` | a show track is complete with no `title_earned` event | prefilled title event |
| `int-review` | a vendor event wasn't applied (`integration_reviews`, §32) | open the record; Done removes it |
| `follow-up` | a pup went home 7–60 days ago (`referralShare`) | write a thank-you note |
| `waitlist-*` | new applications, an offer or fee past due, a removal's undo window, planned deposit date reached (`open-picks`), "Ready now?" unanswered, family messages, and family requests (pref, pause, listen, Companion link) | the matching waitlist action (§29) |

Litter-lifecycle rules ignore deceased pups. The linked-status rules back up prompts the
litter, pairing, dog and sale pages show on the edit itself, for changes made elsewhere
(import, sync, another device).

**Today's "Upcoming shows" card** (Pro): `show` events in the next 14 days; Today's
"Due outs" list leaves shows out so each appears once.

### Away board (`data/awayBoard.js`)
`getAwayBoardRows()` unions boarding events (`eventRepo.getBoardRows`) and in-person stud
services now in their sent/returned window (`studServiceRepo.getBoardRows`) into one row
shape. Used by `board.js`, Today and the dashboard tile. Kennel scope is applied inside it,
through the away dog, so the three can't disagree.

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
  `companion-view.html#<hash>`, built by `assets/companionLink.js` (shared with Ken's share
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
There is no income table and no `is_earned` field. `getIncomeRows()` reads Sales, outgoing
StudServices and (Pro) waitlist fees, and classifies each money component on every load.
Kennel scope applies to the source records here, so every money screen agrees; a
`kennelId` argument overrides it for the kennel page. Expenses are scoped through their
subject (`financials.js` `expenseInScope`).
- **Sale:** deposit, balance (price − deposit), transport and deferred boarding (amount ×
  count). A part is **earned** once its paid date is set or the status has passed it, else
  **anticipated**. Returned/cancelled keeps only what was paid. A **lost** sale
  (`vocab.isLostSale`) counts nothing: it's refunded or carried to another pup (§29).
  `paidOnSale()` reads what was paid regardless of status.
- **Outgoing stud fee:** earned when `completed`, anticipated while arranged/in progress.
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

- **Download = the browser's Print → Save as PDF** (`window.print()` with an `@media print`
  block). Opened from a sale's page or the Sales page's Print Puppy Record picker
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

`assets/documentModal.js` is the shared add/edit and view dialog.

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

**Editions:** Pro and Demo only (`editionFlags.furever`, `feedingSchedule`; their pages are in `proPages.js`).

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
  decision 6): unchecking a previously-published litter document, or clicking Remove on a
  kennel-wide upload, also trashes the file in Drive, so it doesn't stay shared there. `googleDrive.js`'s `trashFile(fileId)` PATCHes
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
- **Per-pup privacy within a litter pack** (mechanism doc §7 decision 4): a litter pack is one
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
  implicit in the data. A document not marked shareable (`furever_shareable`, §26.1 field
  table) is listed greyed out with its box disabled, skipped by the bulk
  selectors and filtered out again at publish.

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
- **`data/fureverSeedExport.js`** — `buildSeedPacket` fetches the pup's litter once (shared by `contentPackages` and `feedingSchedule`)
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

**Editions:** Kennel identity (`public_id`) is in every edition and rides the Lite→Pro bridge. Kennel Cards and the Kennels pages are Pro and Demo only (`proPages.js`). Several own kennels is Pro only (`editionFlags.multiKennel`; `docs/KennelOS_Multi_Kennel_Scope_Spec.md`).

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

**Editions:** Pro and Demo only (`editionFlags.waitlist`; its pages and UI modules are in `proPages.js`). The data layer ships to every edition.

**Details:** the spec's §0 (decisions) and §15 (application form, offers from a family's
page, invoice/receipt PDFs, the list as text); online parts (form, status page, server) in
`docs/KennelOS_Waitlist_W2_Plan.md` and **Online (W2)** below.

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
  `pref_breed`, `pref_purposes` (a choose-all checkbox list from `PLACEMENT_PURPOSE`; a form saved with
  the retired `pref_placement` key reads as it), `pref_colors` — answers go to the entry's `pref_*` fields, not
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
`waitlistRules.publicList(entries, kennelId, programsById, { today, nameOf, deciding })` returns only
`{ position, name, pref_sex, added }` (a row for which `deciding(entry)` is true, the family
holding a turn, has `name: DECIDING_LABEL` ("Currently deciding") and `deciding: true`, its
sex preference and date kept): the real §6.1 position, `publicName` (first word + last
word's initial; for an entry with `private_listing`, `privateName` instead: "A***** K", one
asterisk per hidden letter, via `listedName`; she answers the applicant's `private_request` in
the Approve dialog), sex preference, and the anchor date. **Paused families are left out and their
numbers skipped** (#1, #2, #4), so no public number moves when a pause ends; listen-only
families show with no marker; a family who passed or let a turn lapse shows as usual;
programs, contact details, notes and money never appear. **No family count** is shown, online
or in the text: paused families are left off, so a row count never says
how many are on the list. No opt-out
— every applicant is told by the locked notice — but they can ask to list privately (above). `publicListText` is the text the
Publish list page's **Copy the list as text** produces for Facebook/her website (the W1 stand-in for
W2's public link).

### The rules engine (`data/waitlistRules.js`)
Pure functions, no Dexie, no clock (callers pass `today`); pinned by
`tests/waitlistRules.test.js`. **Nothing it computes is stored.**
- **Position** = order among the kennel's `active`, non-archived entries: `ahead` program
  first → `position_anchor_date` if set, else `fee_received_date` (else `approved_date`, the
  fee-waived anchor) → `fee_received_at` (same-day fees in the order they were recorded) →
  `approved_date` → `created_at` → `id`.
- **Available pup**: not archived, `status` not `deceased`/`pet_home`/`external_reference`
  (died or gone home — a returned pup is made a puppy again on the Sale page first),
  `disposition` not `keeping`/`placed`/`health_hold` (unset/`undecided` count as available), and no non-archived Sale whose status isn't
  `returned`/`cancelled`/`voided` (`vocab.RELEASED_SALE_STATUSES`).
- **Preference match**: sex (unless `any`), **breed** (unless blank; case-insensitive,
  trimmed, against `Dog.breed`), purposes (the registrations `pref_purposes` map to must include
  `Dog.intended_registration`), and color only
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
- **Turns** (Waitlist Spec §16.1):
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
  else is passed at once by `offerNextTurn`, which goes on to the next family. **She always
  sees it:** the "Next turn" line on the Waitlist page and the Litter
  page's picks panel carries a **Not this litter** note (`nextTurnPrepassNote`: which litters,
  and that "Offer to them" records a pass, with its count); `offerNextTurn` returns every such
  family as `auto_passed` (`{ entry_id, litter_ids, counted, used, max, removed }`), or
  `{ none: true, auto_passed }` when nobody was left to offer, and `moveTurnOn` /
  `finishTurn` / `releaseOpenOffers` carry them into the action's result, so
  `describeOfferChanges` (`autoPassedLine`) names each pass in the result message. A family
  who is only "next" (automatic offers off) gets `waiting.prepassed_litter_ids`.
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

**Automatic offers are a setting, OFF by default, per moment:** `waitlist_config.auto_offer_on`, a list of the closings that offer by
themselves (`accepted`, `passed`, `no_response`, `no_deposit`, `left`, `restored`; ticked on the Kennel page's Waitlist
settings section). `moveTurnOn(litterId, { trigger })` calls **offerNext** only when
`waitlistRules.autoOffers(config, trigger)` is true (`confirmDeposit` passes `accepted`,
`recordOutcome` `closingTrigger(offer, outcome)`, `releaseOpenOffers` `left`, `restoreAfterLostSale` `restored`); otherwise nothing is offered and the family who's next is returned in `waiting`
(`[{ litter_id, entry_id }]`), which `describeOfferChanges` turns into "X is next in line.
No offer was made…". Every offer is then made by her (**Open picks**, **Offer to them**,
**Offer pups…**). (Unarchive goes straight to the repo and makes no offers.)

**Which writes make offers:** only an offer on that same litter closing
(deposit received / passed / no response, or the family leaving as above) moves the turn on
by itself, and only for a moment ticked in `auto_offer_on`. Actions on one family — **approve** (fee-waived), **feeReceived**, **undoRemoval** —
make **no** offers; the family page then says which litters they're next for, and she offers
from **Offer pups…** / **Offer to them**. Every offer made on her behalf is returned and
shown (`describeOfferChanges`).

**The offer flow (W1c):**
- **openPicks** stamps `Litter.picks_opened_date` and calls **offerNext**; **closePicks** clears
  it (an open offer stays open until resolved).
- **offerTo(litterId, entryId, { note })** (W1e) — the family's page's **Offer pups…** (Interact tab):
  opens picks if needed, then offers that family the litter even if they aren't next. Refused
  when another offer is open on the litter, the family's turn on it is spent (`turnSpent`), or
  no available pup matches them. Out of turn, the page confirms first and `note` records who
  was next; nobody's place changes and the next family still gets their turn afterwards.
- **offerNext(litterId)** — only while picks are open and no offer is open on the litter:
  `nextFamilyForLitter` picks the family, and the offer is written with `respond_by_date`
  (`respondByDate`, program window first) and an `eligible_dog_ids` snapshot.
- **Accepting is pick + deposit.** The respond-by window is the time to
  accept AND pay; a pup is only theirs once the deposit is in.
  - **recordPick(offerId, { chosenDogId })** creates the **Sale** (`deposit_pending`, buyer =
    the family's contact, `registration_type` = the pup's `intended_registration` → the first
    registration the family's purposes fit → `limited`, `lead_source: 'Waitlist'`, price/deposit from
    `saleDefaults.expectedPricing` for that registration) and stamps `chosen_dog_id`/`picked_date`/`sale_id` on the
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
- **undoPass(offerId)** — undo a `passed`/`no_response`: that family is
  next in line for the litter again. Allowed while the family is `active`, or `removed` for
  `second_pass` within the 7-day window (`undoPassBlocker`; they go back on the list). The
  offer reopens (`open`, `counts_as_pass: false`, a fresh `respond_by_date`, a new
  `eligible_dog_ids` snapshot, a note). A family holding the litter's open offer meanwhile has
  it **voided** (never a pass, so they're next again after) — refused if that family has
  already picked a pup. Refused if the family can no longer be offered the litter. Makes no
  other offer. Returns `{ offer, voided, restored }`.
- **A lost pup (Waitlist Spec §16.11).** `waitlistRules.restoresFamily(sale)`
  (= `vocab.isLostSale`, not archived) and `lostSaleFamily(sale, entries, offers)` →
  `{ kind: 'placed' | 'picked', entry, offer }`; `waitlistActions.lostSaleFamilyFor(saleId)`
  loads it. **restoreAfterLostSale(saleId, { date, carry })** — `placed`: the accepted offer
  goes `voided` (never a pass, so `turnSpent` no longer blocks that litter; `sale_id` kept),
  the entry goes back to `active` with `placed_sale_id: null` and its own fee date — its
  **original place**, passes unchanged; `picked` (their turn still open): the pick is cleared
  (`chosen_dog_id`/`picked_date`/`sale_id`) and every open row of the turn gets a fresh
  `respond_by_date` and `eligible_dog_ids` (never the lost pup), a row with no pup left being
  voided. `carry: { amount }` sets `entry.carried_payment`; none = she's refunding it. A note
  goes on the entry and offer. Then the turn moves on with trigger `restored` (the picked case
  only when its turn ended): offered now only with `restored` in `auto_offer_on` and no turn
  open; otherwise who's next is returned. Another family holding a turn keeps it. Never runs
  by itself: **sale.js** asks as she saves a sale into a lost status (after settling the pup —
  record the death for `pup_died`, Health hold for a health reason, or bring a returned
  Pet-home/External pup back as a puppy), via `waitlistUI.restoreLostPupDialog`, imported
  dynamically only when `editionFlags.waitlist`; the family's page shows **Pup lost** with
  **Put back in line…** / **Give their turn back…** until she does. The pup-settling prompts
  live in `assets/salePrompts.js` (`promptReleasedPup`, `promptDisposition`), shared by
  **sale.js** and the family's page: its **End the sale…** button (shown
  for the sale they're placed with, or the sale holding their open-turn pick, while it hasn't
  ended) runs `waitlistUI.endSaleDialog` — the sale becomes Voided with a reason (Pup died /
  Failed a health check / Other), Cancelled ("they backed out", placed families only), or
  Returned with a reason when it was delivered — then the same settle-the-pup prompts and
  `restoreLostPupDialog` the Sale page asks.

### Surfaces (W1b)
- **W1e (the waitlist as the main workflow, Spec §15.2):** the Waitlist page gains a
  **Litters** card (each live litter with pups to offer: picks state, the open offer or
  "Next: <family>" with **Offer to them**, which opens picks first if needed), **Application
  form** and **Copy public list** buttons (under Manage, the copy on the
  Publish list page). The family page gains **Offer pups…** on an
  active entry, outcome buttons on an open offer in its Offers card (Picked a pup… / Passed /
  No response / Void; once picked: Deposit received… / Change pup… / Passed / No deposit /
  Void — and first, where contracts and invoices are on, **Review sale & send…**, below),
  **Change pup…** on an accepted offer until the next family is offered, **Undo…** on a
  pass / no response, and a **Documents** card (application fee receipt once a fee is received;
  puppy invoice + receipt once placed) with View and Download PDF (§24). New applications are
  typed in on her form, in her order and wording, with the public-list notice shown.
- **Fee paid online (Integrations plan §4).** In Waitlist settings (Pro,
  `editionFlags.accounts`), **Fee paid online via** names a Payment service account
  (`kennels.waitlist_fee_account_id`) and **Ask for the fee** says when: at the end of the online
  application (`waitlist_config.fee_link_when` `apply`, the default) or once approved. The
  family's Pay button links to a reusable **Stripe link per fee amount**, made on a device
  holding that account's Stripe key when the list is published (`waitlistFeeLinks.ensureFeeLinks`
  → `waitlist_config.fee_links`), else to the account's own payment link. With the account's "I
  usually pass this fee on", the link charges the fee plus the card fee
  (`waitlistFeePay.feeCharge`, `priceToNet`) so she nets her fee. The projection carries
  `kennel.fee_pay { url, amount, ref_param, instructions }` (for `apply`) and, on an approved
  family's `fee_due`, their own `pay_url` / `pay_amount`; the Worker adds each family's id as
  Stripe's `client_reference_id` to a Stripe link (`familyPages.feePayFor`; an application's id
  is its entry's id), so the status page (and the page an applicant lands on after confirming
  their application) shows **Pay the application fee** until they've paid. Her device's Stripe
  check (`waitlistFeeLinks.checkFeePayments`, with the sale check) reads each fee link's paid
  checkouts and, per family (`waitlistFeePay.planFeePayment`): approved → **fee received** on the
  payment's date (`feeReceived`) with `fee_paid_via_account_id`, `fee_paid_amount`,
  `fee_processing_amount`; not approved yet → `fee_paid_online`, shown on their page ("Fee paid
  online"), and **Approve** puts them on the list from that date. Income shows the fee net of
  what the payment service kept (§21). With a non-Stripe link she records the fee herself, as
  before.
- **Review sale & send (Integrations plan §2.6).** On a turn with a pick waiting
  for its deposit (`editionFlags.contracts` + `invoicing`), the first button opens
  `assets/pickToSend.js`: **1. Sale** (registration, which moves a price still at its
  `expectedPricing` amount, price, deposit with its due date = the offer's
  `respond_by_date`, read-only, transport fee, **Sold / paid through** (any account, with its
  rate) + **Processing fee** (suggested from the channel's rate and following the price
  until she types her own, §21.1's rule) + "passed to the buyer" (defaults from the account)
  + "You net …" + **Price that nets you $…** (`processingFees.priceToNet`), balance due date,
  notes; **Open the full sale** for the rest), saved through `saleRepo`; **2. Contract** (her contract forms ranked
  for the sale, or "No contract in this message"; reuses the sale's newest sendable contract,
  `contractSend.openContractForSale`, else creates a `sale` contract titled "<form label>:
  <pup>"); **3. Send** (`depositRequest.depositRequestMessage`, editable: deposit and due
  date, the payment link + instructions of the account step 1 says it's sold / paid
  through (`paymentLinks.saleChannelPayAccount`, §32; a hint when it has none), then her
  waitlist `payment_instructions` ("Or pay: …"), the contract link, "Your invoice is attached",
  the balance; **Share with invoice** where `navigator.canShare({ files })` (the invoice PDF
  from `invoicePdf.invoicePdfFile`, made on the device), else **Email** (mailto, text only) +
  **Download invoice** + **Copy message**). The first Share / Email / Copy marks the contract
  sent (`contractSend.markContractSent`), stamps `deposit_request_sent_date` and logs the
  message (`logOwnMessage`); the turn shows **Deposit request sent <date>** and the button
  becomes **Review sale & send again…**. Recording a pick by hand now offers it straight
  away. Nothing goes to a server. Not built (plan D19): an email to her when a family picks.
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
- **Dog form**: `intended_registration` for a puppy (every edition: it also prefills a Sale).
- **Contact page**: a Waitlist panel listing the family's entries, and the waitlist dropdown
  becomes read-only (a badge) once any entry exists, since `waitlistEntryRepo` keeps it.
- **Dashboard**: "New waitlist applications" and "Families on the waitlist" tiles, counting
  entries under the active kennel scope.
- All of the above outside the pages check `editionFlags.waitlist` (false in Lite).

### Online (W2, `docs/KennelOS_Waitlist_W2_Plan.md`)
- **Her device is the source of truth.** `data/waitlistProjection.js` builds one kennel's
  online view from the same rules-engine calls the pages use, field by field from
  allow-lists: the public list (unmasked: the server masks the turn holder, below); per family (by entry id) name, email, status, place
  (`position`, published during a turn too), their place for what they want (`pref_places`,
  below), the litters with open picks whose turn they passed on or let lapse
  (`spent_litter_ids`, so their page offers no "Not this litter" there), prefs,
  pause / readiness hold, listen-only, passes, open offers, which live litters they match
  (`matching_litter_ids`, a yes/no, never a place in a litter's line), the unpaid
  fee and her payment instructions (approved and unpaid only), and the fee-received date; a
  family whose time on the list ended gets only its outcome; per live litter its label,
  available pups (call name, sex, color) and **every** eligible family in order. Never:
  other answers, phone, address, programs, notes, payment details. `as_of` is today, so it
  republishes at least daily (pauses and holds end by date).
- **What number a family sees** (Waitlist Spec §16.9): their overall place, never a per-litter one, except during their turn:
  `waitlistRules.placeHidden(entry, offers)` → `{ reason: 'turn' }` while they hold one (their
  page says "The wait is over!" instead), else null. A pass or a lapsed turn hides nothing.
  On the public list the turn holder's row keeps its number and reads **Currently deciding**,
  highlighted, with its sex preference and date added (only the name is replaced), so the family next in line can't tell whom to
  press. Her device publishes the rows unmasked; `cloud/src/familyPages.js` `listView`
  masks the row whose `position` belongs to an active entry holding offers at the moment it
  serves the page, so a turn the server opens or closes (serverMoves) shows at once. Her
  **Copy public list** masks the same way (`publicList({ deciding })`). `DECIDING_LABEL` is
  copied in `familyPages.js`; `tests/familyPages.test.js` pins the two equal.
- **Place for what they want**: under the overall number, the status
  page shows `pref_places` from `waitlistRules.prefPlaces`: for each matching answer the
  family narrowed (`narrowedPrefFields`: sex, breed, purposes, and colors only with
  color matching on), their place counting only the families ahead who want the same or
  wider on it (`prefCovers`), and `all` (every narrowed answer at once) when they narrowed
  two or more. All open → `{}`; the page skips any number already shown above it.
- **Available Puppies on the public list**: `listView.available` is
  every litter with open picks, as the status page shows it (label, nickname, breed,
  parents, dates, pups remaining by sex; never a pup's name).
- **Ready now?** (Waitlist Spec §16.7; online lists only, and only holds ending while the
  list is online): `waitlistRules.readyCheck(entry, today, config)`;
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
  backup on; the server also needs the **backing device** (on a syncing program, the
  **lease holder**: below) and a server-known Pro account,
  and the reason it stopped (`signed-out`, `backup-off`, `not-backing`, `lease-held` with
  the holder's label and expiry, `not-syncing`, `pro-required`,
  `kennel-taken`, `offline`, `failed`) is kept in the `waitlistOnline` settings key for the
  card.
- **On a syncing program (Cloud Phase 2 plan §7):** there's no backing device,
  so the server work goes to one device at a time by a **lease** (`wl_leases`, migration
  `0016`): two minutes, taken or renewed by `POST /waitlist/lease` and by every waitlist
  write; another device gets `409 lease_held { holder: { label, until } }`. The device claims
  it once per run, lazily, right before its first write (`data/cloud/serverWork.js`
  `claimServerWork`; an idle poll asks nothing more), and only a device that syncs
  (`not-syncing` otherwise: its writes would stay on that device) and is in front of her (a
  syncing device in a hidden tab skips the run, `background`); a closing page lets go
  (`DELETE /waitlist/lease`). A device that takes it over from another first pulls sync and
  restarts its events cursor from the published `events_through`, so no family event is
  applied twice. The card says "This device is handling your online list" while it holds
  it, or "Handled by Jen's laptop (open now)". Vendor events (`cloudIntegrations.js`) follow
  the same rule. Nothing is sent where it isn't offered (`isWaitlistOnlineOffered()`).
- **The card:** Waitlist → Manage → **Publish list** → **Online list**
  (`assets/waitlistOnlineUI.js`): put this
  kennel's list online, its time zone, the status line, **Publish now**, **Copy public
  list link** and **Copy application form link**. The buttons always show; one that can't
  work yet is greyed out with a line saying why (not online yet / not published yet / the
  form isn't open).
- **On your website (Integrations plan §1):** the Online list card's **On your
  website** section. Its parts:
  - **The switch and addresses:** "Let my own website show my application form and list"
    (`waitlist_config.embed`) and her website's addresses (`embed_origins`, optional, one per
    line, each cleaned to an origin by `waitlistRules.embedOrigin`; an address it can't read
    stops the save with a message). The section has its own Save, which is the card's.
  - **What to paste**, once the list is published, each with Copy:
    `cloudConfig.embedSnippet(publicId, 'apply' | 'list')` (a `<script async
    src=…/family/embed.js data-kennel data-view>` with a `<noscript>` link) and
    `cloudConfig.applyButtonSnippet` (a styled link to the form, which works anywhere and
    without the switch). A "Where to paste it" note covers WordPress, Wix, Squarespace,
    GoDaddy/Weebly and no-script places.
  - **Wix:** Wix shows pasted code from its own address, so there she must leave the address
    list blank.
  - **The projection** carries `kennel.embed: { origins }` only while the switch is on.
  - **The Worker** (`familyPages.frameAncestors`) turns that into the `frame-ancestors` of
    `/apply` and `/list`: `'none'` without it, the listed origins (re-checked, at most 10), `*`
    when none are listed, and `'none'` when every listed one is invalid. `/s/<token>` is never
    framable. The pages are cached for 5 minutes, so a change shows within about that.
  - **The loader** (`cloud/public/family/embed.js`, on her page) inserts one iframe of
    `/<view>/<id>?embed=1&frame=<id>&theme=…&accent=…` after itself and sets its height from
    `kennelos:height` messages, accepted only from that frame on the script's own origin.
    `data-theme` is `light` (default) / `dark` / `auto`; `data-accent` is a `#rgb`/`#rrggbb`
    color.
  - **In the frame** (`cloud/public/family/embedded.js`): no title, footer or background; the
    theme forced by class (outranking `prefers-color-scheme`); her accent with white or black
    text picked from its lightness; the height reported via a `ResizeObserver`. Anything that
    leaves goes to a new tab: a confirmed application shows "Your application is in" with
    **Open my status page**, the list's Apply and Open my page links, and a sign-in. The sign-in
    on the list isn't read back from storage, since a framed page's storage may be blocked.
- **Link previews:** a shared public list or application link shows a card on
  Facebook and in texts: the Worker (`cloud/src/familyPages.js` `withPreview`) writes Open
  Graph tags with the kennel's name ("Thornfield Kennels waitlist" / "Apply to the Thornfield
  Kennels waitlist") into `/list` and `/apply`, read from the published projection's
  `kennel.name` only, and a generic image (`cloud/public/family/share.png`). Status pages
  get none (they're private).
- **Communicate…:** on
  the family page's Interact tab (`waitlistEmailUI.communicateDialog`). A **How** dropdown:
  **Send email** (only where `kennelEmailsOn` and they have an address) lists the emails that
  fit now — their status page link, a note from you, the fee request while approved, "on the
  list" once on it, "It's your turn" again during an open turn — with the drafted email
  (`waitlistOutbox.draftFor`, her templates) below to edit before Send; emails tied to a
  moment (a pass, a decision, a closed turn) still come up right after that action.
  **Message via…** (`waitlistUI.messageViaHtml` / `wireMessageVia`): a suggested message
  from where they stand (their turn and its respond-by date, a pup held for their deposit,
  a fee due with her payment instructions, or their place) plus their status link when
  online, editable, with **Share…** (the phone's share sheet: Google Voice, Messenger, any
  app), **Copy message** and **Copy number**. The Google Voice and `sms:` buttons are gone.
  The phone is the contact's, else the application's. KennelOS sends nothing. The message
  box grows to fit its text, so the status link (its last line) is always in view.
- **Editing a family's dates:** the family page's Edit form has **Applied**
  (`applied_date`, any status) and, once a fee date exists, **Fee received**
  (`fee_received_date`). The fee date is the position anchor, so correcting it can move the
  family in line (not when she moved them herself: `position_anchor_date` still wins), and it
  moves the end of a readiness hold and the day the fee counts as income. It can be changed
  but not blanked there; `fee_received_at` (the same-day tie-break) is left as recorded.
- **Import/Export and Settings pages:** `import-export.html` keeps
  **Backup & restore**, **CSV import** and the **Danger zone**. `settings.html` /
  `pages/settings.js` (More menu, after Import/Export; in the precache; excluded from Demo
  with `import-export.html`) holds **Account** (`cloudBackupUI.mountCloudAccountCard`: the
  cloud sign-in, **Change email…** (Cloud Phase 1 plan §2.6: at once with the old inbox, else after a day with Cancel on every device; a change asked for with the recovery code from the sign-in screen's **Lost access to your email?** (§2.7) shows as "Requested with your recovery code"), Pro on this account, Your devices, sign out, delete cloud data), **Your
  kennel**, **Guided tour** and **This device's license**.
  The Backup & restore card's destinations are **Cloud | This device | Dropbox** on both the
  Back up and Restore sides (Cloud first and the default when the edition has a cloud server;
  Dropbox Pro only; with neither, the row goes). The Cloud pane (`#br-cloud`,
  `cloudBackupUI.mountCloudPane`) follows the other destinations' shape: a blurb, **Last
  backup**, **Back up now** or, on the Restore side, the cloud backups as a dropdown on the
  page (choosing one loads it and asks before rolling back), and a strip at the foot (Cloud
  backup on/off, with Turn on / Turn off / Sign in again / Sign in and restore). Each
  destination's strip shows only with that destination. The encrypted tier is called
  **Sensitive records** in every screen (formerly "private backup" / "private info"; code
  names keep `vault`/`private`): one dropdown reading Off, Locked or On, whose other entries
  (Turn on…, Unlock…, Unlock another device…, Passkeys…, New recovery code…, Turn off…) open
  their dialog as soon as they're chosen. **Unlock another device…** also offers **Make an
  unlock code instead**: a one-hour, single-use code to paste into the other device's **Use
  another device** screen (`cloudVault.createHandoffCode` / `unlockWithHandoffCode`; Private
  Vault Plan §5.4). Lite's upgrade dialog makes one as it opens. Links into the card use `#backup-restore`.
- **Contacts page layout:** **+ Add Contact** comes before **Manage kennels**,
  and the bucket row (Clients / Network / Care team / Other / All, `#contacts-group-tabs`) is
  moved by `contacts.js` to sit under the list's search bar and filters, apart from the
  People hub's Contacts | Waitlist tabs.
- **Current Applicants: See Your Details** (so visitors who haven't applied can skip it) and **Coming up** (pairings and early litters) on the public list page
  are collapsed `<details>` cards, and its title reads "<Kennel> Waitlist".
- **A family's status page:** everything centered; no badge for a family on the
  list; **Current Position** (the number, then the kennel's name, **Added** and passes used).
  Sections that ask them to act stay open (their turn, Ready now?, Review your preferences,
  the fee, Thank you for applying); every other titled section folds away and starts folded,
  and one they opened stays open while they use it (`state.opened`).
  Their turn's card reads **The wait is over!** / "Below are the puppies available for
  selection.", one button per pup (its name, sex and color), one **Pass on turn** button in
  the warning tint with "N of M passes used" under it (a turn is passed once, whatever
  litters it covers), and at the bottom "Deadline: Saturday, 10/10/2026 @11:59 pm CDT"
  (`common.deadlineText`, the kennel's zone abbreviation for that day).
  "Ready now?" (§16.7) reads **Alert: Pause Ending** / "Your scheduled pause is ending.
  Please confirm that you are now ready to receive offers for upcoming puppies.", with Yes /
  Not yet, and, when her rule removes families who don't answer, at the bottom "Deadline for
  response: 10/26/2026" and the removal warning.
  **Review Your Preferences** (§16.6): "With new pups upcoming, please take a moment to
  confirm your preferences." and two lists, litters matching and not matching their
  answers; no buttons (they ask for changes under What you asked for). **Available
  Puppies** (was Litters: litters with open picks, or in their turn) and **Coming up** (no
  badges) lay every litter out the same way (`common.litterHtml`): breed, its name, "Dam:
  Juniper CGC · Sire: Ash CH", dates as MM/DD/YYYY ("Planned offering" for picks expected to
  open), and for Available Puppies "2 females and 1 male remaining". Review Your Preferences
  lists its litters the same way, without dates. The projection's open litters, whelp notes
  and upcoming items carry `breed` (the dam's, else the sire's) and `sire` / `dam` as
  `{ name, titles }`; `/f/status` adds `pups_female` / `pups_male`. Current Position shows
  "Added 03/07/2026" and "Passes 1 of 2 used".
  Which litters they wait for (listen-only) has no card of its own: it's the **Parents** line
  of What you asked for ("Any", "Ash, Juniper only", "Not Willow"), and its choices sit at
  the bottom of the Ask to change form; one Send sends a `listen` action and/or a
  `pref_change`, whichever changed (a wider listen change still applies at her next update;
  a narrower one still waits for her OK).
  A family who opened their link without signing in gets one **Sign In** button in the
  page header (no card), to `/list/<public_id>#signin`, where the list page opens its
  sign-in and focuses the code box.
- **Message on your public list:** `waitlist_config.public_intro_text` (blank =
  `waitlistRules.PUBLIC_INTRO_DEFAULT`), edited on the Publish list page; `publicIntroText`
  fills in `[Kennel Name]`, the projection publishes it as `kennel.intro`, and `/f/list`
  passes it to the page, which shows it as plain text under the heading.
- **Apply from the public list:** while she takes applications online, the
  public list page shows **Apply to join the waitlist** under its heading, linking to
  `/apply/<public_id>`; `/f/list` says so with `kennel.apply_open` (= `formView` would serve
  her form), nothing else of the form.
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
  written; on a syncing program, the lease holder, `serverWork.js`), `cloudWaitlist.applyFamilyEvents` reads the events after its cursor
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
- **Emails to families** (W2 step 6; Waitlist Spec §15.4): wherever the list is online
  (`waitlistOutbox.kennelEmailsOn`) and the family has an address (the one their projection
  carries), each action a family should hear about is followed by **Email … ?**
  (`assets/waitlistEmailUI.offerEmails`): the email drafted from her templates
  (`data/waitlistEmails.js`; every name, date, litter and place filled in from her records,
  never by the server; no money in any default), ticked, for her to edit, untick or skip.
  Where: approve (`approved`, or `on_list` when the fee is waived), decline, fee received
  (`on_list` with their place), every turn offered (`offer`: Offer pups…, Offer to them,
  Open picks, an undone pass, and each turn an outcome moved on, via
  `waitlistOutbox.offerSpecs`), a pass and a no-response she records (`pass_recorded`,
  `deadline_passed`; a void sends nothing), her decision on a request (`request_approved` /
  `request_declined`), from the family page **Send status link** and **Email them…** (a
  `note`), and from Today's nudges (a nudge action returns `emails`, and `today.js` offers
  them). **Almost your turn…** gains **Send from KennelOS** (one `almost_turn` email per
  ticked family, recording them as told) and, for litters born before picks open
  (`whelpNotes`), **Email them about the new litter…** (`review_prefs` for families kept out
  only by their preferences, `litter_born` for those who match and aren't mid-turn). Sending
  queues the email on the entry (`messages`, `from: 'breeder'`, `status: 'queued'`) and
  starts a sync; `cloudWaitlist.sendQueuedEmails` posts each one after the publish
  (`POST /waitlist/messages`, its id making a retry the same email), and records `sent` or
  `failed` with a reason. Offline, email down or rate-limited, they wait for the next sync.
  The server picks the address from the published projection (never the device), sends from
  the kennel's name (`"Thornfield Kennels" <thornfield-kennels@mail.kennelos.app>`) with no
  Reply-To, and adds the footer with the family's status-page link. The family page lists
  them under **Status page and emails** (a failed one with **Retry**); the status page lists
  the sent ones under **Emails from …**. Her wording: **Emails to families** in Waitlist
  settings.
- **While her phone is off** (W2 step 7; `cloud/src/serverMoves.js`): for the moments she
  ticked in `auto_offer_on`, the server closes a turn whose last day has passed (kennel time)
  and, after that or a family's pass / leave on their page, offers the next family in her
  published `turn_queue`, emailing both from her templates; with `email_reminders` on it also
  sends a reminder halfway through a turn and on its last morning, one the day before an
  unpaid fee is due, and "Ready now?" — each once. Each move is an event `made_by: 'server'`
  (`server_close`, `server_offer`) that her backing device applies at its next sync through
  `waitlistEvents.planServerEvent` → `waitlistActions.applyFamilyPlan` (`recordOutcome` with
  `moveOn: false` where the server already moved on, `applyServerOffer` with the server's
  offer ids), or, if it no longer fits her records, records as a `from: 'server'` line on the
  family's entry. The server refuses a publish that hasn't seen its moves (`409
  events_pending`); `cloudWaitlist` then applies them and publishes again.
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
Pro-only *surfaces* (pages in `PRO_ONLY_PAGES`, `assets/waitlistUI.js` and
`assets/waitlistEmailUI.js` in `PRO_ONLY_STANDALONE`, in-page doors behind `editionFlags.waitlist`); the tables, repos,
rules and actions live in `shared/data` like every other repo, so a Pro backup restored
into Lite keeps its waitlist rows dormant. Demo gets a seeded list in W1d.

---

## 30. Cloud backup — `docs/KennelOS_Cloud_Phase1_Plan.md`

**Editions:** Lite and Pro. Never Demo (`cloudUrl: null`). Live sync is Pro only (§34).

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
  **Release switch:** `cloudConfig.VAULT_RELEASED`, **true**, so
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

## 31. Reports — `docs/KennelOS_Reports_Plan.md`

**Editions:** Pro and Demo only (`editionFlags.reports`; every report page is in `proPages.js`).

The Reports hub (`pages/reports.html` + `reports.js`, Pro-only) lists every report from
`data/reportCatalog.js`, bucketed into **Money / Breeding / Puppies / Sales & Waitlist /
Shows & Stud / Dogs & Operations**. Each bucket is a segment tab (the Financials hub's pill
toggle); the chosen one rides the URL (`?group=money`) and each report's "← All reports"
link returns to its own bucket. A bucket with no reports yet has no tab. **Year in Review**
is featured above the tabs.

**Every report is derived** — computed on load from the existing tables, nothing stored, no
schema of its own. Totals, rates and chart series are figures for what's on screen, never
persisted aggregates.

**The report screen (`assets/reportView.js`)** adds, when a page asks:
- `dateRange: { label, date:(r)=>YMD, initial? }` — a preset menu (All time / This year /
  Last year / Last 12 months / Custom From–To; `data/reportMath.js` `rangeFor`/`inRange`).
  An undated row is only in "All time".
- `kpis:(rows, ctx)=>[{ label, value, hint? }]` — a stat strip above the table.
- `charts:(rows, ctx)=>[chartSpec]` — charts above the table, redrawn from the same visible
  rows (so they follow every filter); `ctx` = `{ range, preset, records }`.
- a column's `total:(rows)=>string` — a Total row under the table, over the visible rows.
- `rowsFor:(records, ctx)=>rows` — a **summary** report: the filters, search and range pick
  records, then this groups them (one row per category, source…); the table, totals and CSV
  show its rows while `kpis`/`charts` still get the records (Expenses by Category, Lead
  Sources).
- always: **🖨 Print / PDF** and a letterhead that only prints (below).

**Charts (`assets/chartView.js`)** are the app's own SVG — no vendored library, so they
work offline and print crisp. `renderBarChart` (one, grouped, stacked, or a signed
`diverging` series — blue above zero, red below), `renderLineChart` (category or numeric x;
2px lines, a ringed end dot, direct end labels up to four series), `renderHbarChart`
(ranked; past `max` rows the rest fold into "Other"). Render functions are pure (spec +
width → HTML; `tests/reports.test.js`); `mountChart` draws at the container's width, redraws
on resize and for print, and wires the hover tooltip. Rules: categorical colors come from
`SERIES_COLORS` in **fixed order** (validated for colour-vision deficiency on white; a
series keeps its slot even when it has nothing to show, and a chart that colors by a vocab —
registration, stud direction — passes each value its vocab-index slot so the color follows
the entity); two or more series always get a legend; count axes never show fractional
ticks; every user string is escaped; the table under each chart is its accessible view.

**Print / PDF (`assets/printView.js`)** goes through the browser's own print dialog ("Save
as PDF" makes the file). The print stylesheet (`app.css`, `@media print`) hides the nav,
banners, toolbar and page header **only on pages with a letterhead**, so printing any other
page is unchanged; it keeps charts and table rows whole across pages. The letterhead shows
the active kennel's logo + name (or the only own kennel's), the report title, the date range,
filters and search in effect, and the date generated.

**Money by period (`data/moneyReport.js`)** — `loadMoney()` reads the same scoped income
rows and expenses as the Financials Overview, so the reports always agree with it.
Cash basis: every income component carries `when` (`incomeView.saleComponentDate`: a
deposit on `deposit_date`, the balance and what rides with it on `balance_paid_date`,
unpaid money on `balance_due_date`, each falling back to the sale's own date; stud fees on
`returned_date`/`sent_date`; application fees on `fee_received_date`) and `due` — only a due
date she set (an unpaid balance's `balance_due_date`, else blank), which Receivables ages by
so nothing is called overdue off a fallback date. `plByPeriod` files
earned income and expenses into months; anticipated income is shown when due and never in
Net; non-cash pick value is never money in.

**Reports today**
- Money: **Profit & Loss by Month** (`pl-report`), **Litter P&L**, Financials (link).
- Breeding: **Litters Over Time**, **Live-Birth Summary**, **Health-Test Events**;
  **Dam & Sire Production** (`production-report`, `breedingReports.productionRows`): one row
  per dog that parented a whelped litter in scope (the LITTER's kennel scopes it, so an
  outside stud shows for litters he sired here) — litters, born, alive, live %, average
  litter, the sex split of the puppies on record, first/last whelp, age at each litter;
  dams flagged for litters whelped under `BACK_TO_BACK_DAYS` (240) apart and at
  `LIFETIME_LITTERS_FLAG` (6) lifetime litters — prompts to look, nothing enforced. Totals
  count each litter once. **Pairing Success** (`pairing-success-report`): one row per
  pairing that was bred; outcome `success` (confirmed pregnant, whelped, or a litter's
  `pairing_id` points at it) / `failed` (not pregnant, failed) / `pending` (bred) — never-bred
  (planned, cancelled) pairings are left out; rate = success ÷ (success + failed), by method
  and by sire; the dam's last `progesterone_test` reading on or within 7 days before
  `planned_date`.
- Puppies: **Puppy Growth** (`puppy-growth-report`, `?litter=`): pick a litter; each pup's
  `weight_check` events (lbs + oz/16) by age in days from its DOB (else the whelp date), one
  line per pup (past eight pups the rest draw in gray); a pup under 85% of the median of its
  littermates' weights within ±2 days of its latest weigh-in is flagged
  (`growthFlags`, needs two littermates weighed then).
- Sales & Waitlist: **Placements** (price column + total; placements by month stacked by
  registration; average price by registration), **Scheduled Placements**;
  **Waitlist Funnel** (`waitlist-funnel-report`, `waitlistReports`): one row per entry, by
  applied date; furthest stage of applied → approved → on the list (fee in, active, or
  removed after listing) → offered (any offer) → placed; why families left (declined,
  withdrew, fee expired, each removal reason), how offers ended, pass reasons (a pass with no
  family reason is "Recorded by you"), median days applied → placement sale date.
  **Demand vs Supply** (`demand-supply-report`): families = entries `active` on the list,
  counted by `waitlistRules.pupMatchesPrefs` against a stand-in pup of each kind (breed × sex
  × intended registration; listen-only parent choices aren't applied); pups =
  `isPupAvailable` puppies. A kind shows only when it has pups or a family ticked a purpose
  that maps to its registration, and a breed only when it has pups or a family named it, so a
  no-preference family (which counts everywhere) doesn't list every combination.
- Money, phase 3: **Expenses by Category** (`expenses-report`, summary by category, This
  year by default — the tax-time page); **Receivables** (`receivables-report`,
  `moneyReport.receivableRows`: every anticipated component + foster costs owed back
  (`litterFinances.reimbursablePending`), aged Not due / 1–30 / 31–60 / 61–90 / 90+ / No due
  date); **Pricing** (`pricing-report`: placed priced sales against
  `expectedPricing(dog, litter, sale.registration_type)`, averages by sex × registration,
  "Full over Limited"); **Breeding-Dog Return** (`dog-return-report`,
  `moneyReport.dogReturnRows`: per parent, earned income on its litters' rows + its own stud
  fees − expenses on the dog; a litter counts for both parents, so no Total row).
- Breeding, phase 3: **Heat Cycles** (`heat-cycles-report`, `breedingReports.heatRows`:
  distinct `heat_cycle` start dates per female, average interval, predicted next = last +
  average (two heats needed), due soon ≤ 30 days / overdue); **Health-Testing Gaps**
  (`health-gaps-report`, `testGapRows`: adult dogs' `planned_tests` vs their test events'
  `testTokensOf` names, the dog page's advisory match).
- Sales, phase 3: **Lead Sources & Referrers** (`lead-sources-report`, summary of placed
  sales by `lead_source`, grouped case-insensitively; top `referred_by_contact_id`s);
  **Returns & Voids** (`returns-report`: released sales by `end_reason`, share of all sales
  in range).
- Shows & Stud: **Stud Services** (sent date, fee; by month by direction); **Stud Results**
  (`stud-results-report`, `studResultRows`: the litter whose `pairing_id` is the service's,
  puppies born, fee, terms); **Show Record** (`show-record-report`: `show` events with
  `entry_status: 'shown'`, points by `showPoints.eventPoints`, judges grouped by
  `normalizeJudge`, majors = 3+ points, titles = `title_earned` events in range).
- Dogs & Operations: **Active Roster**, **Dashboard** (link).
- Featured: **Year in Review** (`year-review`, `data/yearReview.js`): one calendar year —
  litters whelped (expected ones left out), puppies born/alive, placements (released sales
  counted apart), money in/out/net (= P&L by Month), titles earned, waitlist applied / on
  the list now — with four charts and the year's litters and titles; laid out to print on
  one page.

Lite keeps Active Roster and Live-Birth Summary (shared pages), so it gets their tiles,
charts and Print button too; every other report is Pro-only.

---

## 32. Accounts (business logins & referral codes)

**Editions:** Pro and Demo only (`editionFlags.accounts`). The Integrations plan's vendor features (payment links, Stripe, Jotform) hang off Accounts and are Pro only too: `docs/KennelOS_Integrations_Plan.md`.

`pages/accounts.html`/`.js` (Pro-only: `proPages.js`, `editionFlags.accounts`; the **Storage**
hub's third tab, beside Documents and Shows) keeps the breeder's own accounts with registries,
vendors and services — AKC, Good Dog, Chewy, Embark… — in the `accounts` table through
`data/accountRepo.js` (`makeRepo` + a required `name`; `getAll` sorts by name). A table of its own, not Contacts (these are businesses she has a login with, not
people) and **program-wide**, not kennel-scoped (one list whatever kennel is active).

Each account card shows two groups, each value with a **Copy** button:
- **Your login** — `username`, `password` (masked until **Show**), `customer_id`. For her
  alone: these and `notes` are **private tier** in `syncRegistry.js` — they reach the cloud
  only inside the encrypted private vault (§30), never in the plain snapshot. They do ride
  the local JSON export and Dropbox backup files, like every other private field.
- **Referral — to share** — `referral_link`, `referral_code`, and `referral_instructions`
  (free text written for the families who'll use them, e.g. "use code at checkout for 30%
  off"). These exist to be handed out, so they are cloud tier.

**Expenses.** An expense may name the account it was paid through
(`expenses.account_id`). Both expense forms — the per-subject panel (`expensePanel.js`) and
the Financials hub's **+ Add Expense** — show an **Account** picker in Pro (shared helpers
`loadAccountChoices` / `buildAccountField` / `wireAccountField` in `expensePanel.js`; no field
at all in Lite, and an absent field leaves a stored `account_id` alone). Archived accounts are
left out of the picker unless already chosen. Picking one fills an empty Vendor with its name.
The ledger shows it: an **Account** column, search and filter on the Financials Expenses view,
and "Account: X" on a panel row when it differs from the vendor. Each account card totals its
active expenses (program-wide, not kennel-scoped) with **View expenses →**, which opens
`financials.html?view=expenses&account=<id>`: like `bucket`, that param narrows the whole
view (summary heading "Total spent — Chewy", with a "Show every account" link back).
Expense CSV import doesn't read an account column yet.

Add/Edit is a modal; Archive/Unarchive and Delete as for any entity. Delete is blocked while
an expense names the account (`getDeleteBlockers` → "archive it instead"). Search covers name, website, username, customer ID, referral link/code and
notes; a type filter reads `vocab.ACCOUNT_TYPE`. A `website` typed without a scheme opens
as `https://…`.

**Processing fee (§21.1).** The Add/Edit modal has a **Processing fee** group
(percentage, fixed amount, "I usually pass this fee on to the buyer", and a private note),
and a card with a rate shows it. A sale sold through the account names it
(`sales.sales_channel_account_id`, in `ACCOUNT_REFERENCES`), so delete is blocked while one
does. The sample Good Dog account carries a sample rate (6.25% + $5), and Cedar's sample sale
went through it ($180 fee, passed on).

**Shared with families (Integrations plan §3).** No referral program reports
*which* buyer used a link or code (Amazon's terms even forbid per-person tags), so nothing
detects a use. Instead:
- **The switch.** "Share with families" (`share_with_families`) in the Referral section of the
  Add/Edit modal; a shared account with a link or code gets a **Shown to families** badge.
  `referralShare.sharedReferrals` is the one list everything reads: switched on, not
  archived, a web-address link or a code, name / link / code / instructions only, by name.
- **Where families see it:** the family Companion bundle's `recommended[]` (include flag
  `recommended`, §20), and every waitlist status page, placed families included. The
  projection carries `kennel.recommended` (built from `accountRepo` in `cloudWaitlist.
  projectionFor`), the Worker re-checks it in `familyPages.recommendedOf` (strings capped, a
  link only when it's a web address, at most 20), and the page shows a **Recommended for your
  puppy** card with a Copy button for a code.
- **The follow-up a week after going home:** the Today nudge in §19, whose note lists them.
- **Send a thank-you** on a Contact (Pro): she picks what they used (one of the shared
  accounts) or "Recommending us to someone", and `referralShare.referralThanksMessage` opens
  in the composer, signed with the kennel of their latest sale, else her own kennel.
- **Sending is hers:** the composer (`assets/messageComposer.js`) builds real `mailto:` /
  `sms:` links from the edited text, or copies it. Nothing goes to a server (plan D7).

**Contract forms (Integrations plan §2.1a, step 4).** An account of type **Form
service** (`ACCOUNT_TYPE` `form_service`, e.g. Jotform) holds her signable contract forms
(`contract_forms`, e.g. her pet home and breeding rights contracts). Its Add/Edit modal shows
a **Contract forms** section right under Name / Type / Website, only while the type is Form
service; with any other type the section is hidden, and saving leaves stored forms untouched
(never offered, back if the type is switched back). The section has one row per form (a **type**
from the fixed `vocab.CONTRACT_FORM_TYPE` list, her **label**, the form's **link**) with ✕ and
**+ Add another contract form**; a blank row is dropped, a half-filled one is an error. A
**Field names KennelOS fills in** panel lists `contractForms.PREFILL_FIELDS` per group with
Copy: she sets each Jotform field's Unique Name to one (fixed names, plan D14). The card lists
the forms with **Open**.
- **Form types → contracts.** Each type names the `CONTRACT_TYPE`(s) it serves
  (`contractTypes`). Pet home, breeding rights and deposit are all `sale`; pet home ranks first
  for a `limited`/`none` registration, breeding rights for `full`, deposit while the sale is
  `deposit_pending`, co-own for a `co_own` registration (and for a `co_own` contract).
- **Send for signature** (Contract page, Pro: `editionFlags.accounts`; on a `draft`, `sent` or
  `declined` contract; **Save & send for signature** on a new one, which reopens with
  `?send=1`): picks from `contractForms.allForms` (non-archived Form service accounts) ranked by
  `rankForms` (matching type first, **Show all forms** for the rest; all of them when none
  match), shows every prefilled value, offers **Preview form**, and warns past 2,000
  characters. `prefillValues` (the allow-list: never notes, terms or end reasons) reads the
  contract's sale + buyer + pup + sire/dam + balance due, or stud service (stud and dam by
  `direction`) + partner, or dog + counterparty, plus the kennel and her own name / email /
  phone / address as `breeder…` (the contact whose `kennel_id` is the contract's kennel,
  `contractSend.breederFor`: a contact typed Breeder first, then the oldest; none → left out,
  with a note in the send dialog to set her contact's Kennel); `prefillUrl` adds them as
  query parameters (Jotform's URL prefill — no API call, no server). It opens the composer
  (`signatureMessage`) to Email / Text / Copy; once used, the contract becomes `sent` (a
  `sent` one stays `sent`) with `esign_provider`, `esign_url`, `esign_sent_date`,
  `esign_form_label`. The view shows **Sent for signature** (label · date) with **Copy link
  again**, and the button becomes **Send again**. She marks it Signed herself; marking it
  signed by itself is plan step 7 (her device checks Jotform first, a
  server webhook only later).
- **Connect Jotform (plan §2.1b, step 4b; D16 decided: the key stays on the
  device).** On a saved Form service account (never in the Demo), the Contract forms
  section has a **Connect Jotform** box: her API key (the box asks for a **Read Access**
  key and says any key can read all her submissions) and which Jotform (standard / EU /
  HIPAA). **Connect** checks the key with Jotform (`GET /user`) before
  `jotformKeyStore` keeps it in `device_secrets`: on this device only, never in a backup,
  sync or the cloud, so each device connects on its own; **Disconnect** forgets it here
  (forms and matches stay), and deleting the account forgets it too. Calls go straight
  from her browser to Jotform (`jotformApi.js`, the key as the `apiKey` query parameter so
  each call is a plain GET, no cookies, no referrer); a blocked call says so, and pasting
  links keeps working. Connected: **+ Add from Jotform** lists her forms (`GET
  /user/forms`, deleted ones left out) with a type guessed from the title
  (`jotformMatch.guessFormType`); **Add** reads the form's fields (`GET
  /form/{id}/questions`; a Full Name field as `name[first]` / `name[last]`, an Address
  field as `name[addr_line1]`, *Jotform's prefill naming, unverified*) and opens **Match
  fields**: one row per fact the type fills (`factsFor`), preset by `suggestFieldMap`
  (our fixed name, then field type, then label words; each of her fields fills one fact;
  her own `breeder…` details only go to a field whose label says Seller / Breeder / Kennel,
  and a bare Name / Email field stays the buyer's),
  with warnings for no signature field, no email or no contract reference
  (`matchWarnings`). Her confirmed matches become the row's `field_map`; the row shows
  "Picked from Jotform · N fields matched" with **Fields…** to match again. A mapped
  form's link carries **only** the matched facts, under her field names
  (`contractForms.mapValues`, used by `contractSend.buildSignatureLink`); a pasted form
  keeps the fixed names. The card shows the matched count.
- **Signed forms come back (plan §6 step 7; `data/jotformSigned.js`).** A
  contract that is **Sent** on a Jotform form (`esign_provider = 'jotform'`) is marked
  **Signed** by her device once the form's submission carrying its reference turns up. When
  the app opens (at most every 15 minutes, `bootJotformCheck` from `app.js`, Pro), or when
  she taps **Check for signature** beside **Copy link again** on the contract, the device
  finds the form each Sent contract went out on (the saved form whose link, without its
  query, matches `esign_url`), and, when that form's Form service account is connected on
  this device, reads its submissions since a day before the earliest sent date (`GET
  /form/{id}/submissions` with a `created_at:gt` filter, `jotformApi.jotformSubmissions`).
  The form's id is its `form_id`, else the number its link ends in; the reference is read
  from the `contractRef` field (a pasted form) or the field matched to `contractRef` (a
  matched form; matched with none → it can't be found). The oldest submission for a
  contract is applied as a `contract.signed` event (`jotform-<submission id>`) through
  `integrationApply`, so a Sent contract becomes `signed` with `signed_date` = the
  submission's date, an already-signed one is skipped, and one she changed meanwhile gets a
  Today review. Nothing else from the submission is kept (the buyer's answers stay in
  Jotform); no KennelOS server is involved. Not connected on this device → nothing is
  asked, and the button says to connect or mark it Signed by hand. The check's last time is
  `jotformCheckedAt` in `settings.getIntegrationsState()`.

**Payment services (Integrations plan §4–§5).** An account of
type **Payment service** (`ACCOUNT_TYPE` `payment_service`: Stripe, Square, PayPal, Venmo,
Zelle…) holds her own **payment link** (`payment_link`, a web address) and/or **payment
instructions** (`payment_instructions`) in a **Payment link** group of the Add/Edit modal
(only while the type is Payment service; another type hides it and saving leaves what's stored
alone); the card shows them under **Payment link — to send buyers** with Copy. Both are cloud
tier (written to be sent to buyers; plan D9).
- **Connect Stripe (own key, step 6).** A saved Payment service account
  (never in the Demo) has a **Connect Stripe** box: her **restricted key** (`rk_live_` /
  `rk_test_`; a full `sk_` key is refused) with the permissions it lists (Products, Prices and
  Payment Links write; Checkout Sessions, PaymentIntents, Charges and Balance read), and the
  currency. **Connect** checks it with Stripe; `stripeKeyStore` keeps it in `device_secrets`,
  on this device only; Disconnect and deleting the account forget it. `stripeApi.js` is the
  only module that calls Stripe (straight from her browser, *CORS unverified until the real
  flow*); nothing goes through the Worker and the money goes to her Stripe account.
- **How a sale is paid.** A sale's **Deposit paid via** and **Balance paid via** (the rest of the
  price, transport and boarding; blank = the deposit's) are Payment service accounts, beside
  **Sold through** (a marketplace that handles the whole sale, Good Dog). The fee is estimated
  per payment (`processingFees.saleFeeEstimate`): each payment at its paid-via account's rate
  (percentage and fixed), else Sold through's; with neither paid-via set, Sold through's rate
  on the whole price, as before. The Sale form and Review sale & send (which gains **Deposit
  paid via**) suggest it and follow price, deposit and account changes until she types her own.
- **Send payment link** (`assets/paymentRequestUI.js`, Pro; an open Sale's header and a
  sale's Invoice): she picks what for (`paymentOptions`: the unpaid deposit, the rest, or
  everything owed) and the account it's paid via (that part's account first;
  `paymentLinks.salePaidVia`). Picking fills that part's paid-via when empty (`paidViaChanges`,
  moving the fee estimate when the fee is still at it); a different one asks first. With
  Stripe connected for the account on this device she can tick **Make a one-time Stripe
  link**: `stripeLinks.makeSaleLink` makes a one-use payment link for exactly that amount with
  the sale's id in Stripe's metadata (an unpaid earlier link is deactivated, the same one is
  reused), and the message carries it. Else the account's own link and instructions.
- **Paid, by itself.** When she opens KennelOS (at most every 15 minutes, `bootStripeCheck`) or
  taps **Check now** on the Sale page's **Payment link** row, `checkStripePayments` asks Stripe
  about each sale's open link, with the key of the account that part is paid via, and applies a
  paid one through `integrationApply.js` (the planner of §19's reviews): Deposit paid / Paid in
  full with the date, "Credit/debit card" and the payment reference, the fee Stripe kept into
  `processing_fee_reports` and `processing_fee_amount` (replacing that part's estimate; a fee
  she typed stays, and the difference is a Today review), and the link cleared. A sale that had
  moved on, or a waitlist pick's deposit (recorded on the family's page), is a Today review.
- **The waitlist application fee** (§29): see "Fee paid online" there.

The sample Chewy account is shared, so Maple's sale (delivered 30 days ago, Briar Hollow)
shows the follow-up on Today.

The sample seed (`editionFlags.accounts`) adds AKC, Good Dog and Chewy with obviously fake
credentials (the Demo is public), before the sample expenses so the Chewy and AKC costs
name their account; `manifest.accounts` lists them. Clear Sample Data deletes them — or, when
a real expense names one, treats it as contamination like a sample dog or kennel (`account`
in `ENTITY_REGISTRIES`): reported on the dry run, archived on the archive-conflicting pass.
They're never in a cloud snapshot, like all sample rows.

## 33. Ken — guided tasks ("Record a new litter")

**Editions:** All editions. Steps for Pro features (outside dogs, stud service, sharing) are gated by their flags, as noted in the steps.

### What it is
**Ken** (placeholder name; `kenChat.KEN_NAME`) is a scripted helper presented as a chat: a
floating **Ask Ken** button (`kenChat.ASSIST_LABEL`; bottom right on every page, fixed while
scrolling, a dot while a task is unfinished — rendered by `app.js` via
`kenChat.renderAssistButton`) opens `pages/ken.html`. He is **not a model**: every line he
"types" is written in the task scripts, and nothing leaves the device. On the page Ken shows a
typing indicator, says "Hi, I'm Ken! What can I help you do today?", and his tasks fade in one
at a time (`pages/ken.js` `TASKS`, each with a `priority(state)` hook — an unfinished task
first — so more scripts can be ordered as they're added). Picking a task: Ken explains what
will happen and offers **Sounds great, let's start!** / **Never mind**; then every question is a
Ken message, her answer panel sits under it, and her answer stays in the chat as her reply,
all in one transcript box that scrolls itself to the newest message. At the end Ken says "I
think I got it all. Here's what I'll create:" and shows the plan (each section with a Change
link; a change asks that question again and returns to the plan), then **Yes, build it**.
No new table, field, index, FK or vocabulary: every write is an ordinary repo write.

Modules: `assets/kenChat.js` (the transcript: `createChat(box)` → `ken(html)` with typing,
`you(text)`, `panel(html)`, `choose(choices)`; and the floating button), `pages/ken.*` (the
page and Ken's menu), `assets/guidedLitterUI.js` (the litter task: its question screens, her
replies — `answerFor` — and the conversation runner `runLitterTask`).

**Doors:** the floating button; the Breeding page header (**Record a litter with Ken** →
`ken.html?task=record-litter`); an Expected litter's page header (**Record the birth with Ken**
→ `&litter=<id>`, which starts with that litter's parents and litter already chosen). A header
**Save for later** button while a task runs says the answers are kept and returns to the menu.

### The order (`data/guidedLitter.js` `stepsFor`)
1. **Who is the mom?** then **Who is the dad?** Her own dogs as tiles, "Show all" for outside
   dogs, and **A dog that isn't in KennelOS yet**. A new dog asks name, breed, registered name
   and (Pro, `editionFlags.externalOwnership`) **Mine / Someone else's**; someone else's asks
   the owner (a contact picked, or a new one's name/phone/email) and, optionally, the owner's
   kennel (an outside kennel picked, or a new one by name). **Before a new dog is made**, the
   typed name is looked up (`dogMatches`: same sex or unknown, call or registered name equal or
   one containing the other; every non-archived dog, outside and pedigree-only ones included):
   any found are offered first — "We found Nell. Is this the mom?" — so a dog is never entered
   twice. Lite records only her own dogs (no outside dogs there).
2. **Is this the litter?** — litters of those two parents with no puppies yet
   (`litterCandidates`), only when both parents are dogs on file.
3. **Is this the breeding?** — open breedings of the pair with no litter linked
   (`pairingCandidates`; not `not_pregnant`/`failed`/`cancelled`), asked when no litter was
   picked or the picked litter has no breeding linked. Picking one fills the bred date and
   method and skips the next step.
4. **When was she bred?** (dates optional, method tiles) — only when no breeding exists.
5. **Record the stud service?** (Pro, `editionFlags.studServices`) — when the dad is somebody
   else's and the breeding has none: fee structure, fee, in person / shipped.
6. The birth date, the counts (born alive / not alive / abnormalities), the kennel (only when
   `resolveKennelIdForWrite` can't work it out), **one screen per puppy** (name — starts as a
   collar color — Boy/Girl, color & markings, birth weight in ounces), **plans** (disposition +
   intended registration per pup, with "Set all to"), **prices** (the litter's per-sex price,
   deposit and Full surcharge, prefilled from her newest priced litter of the dam's breed, with
   a live "how families will see the available puppies" preview using `pupPriceText` — the
   same sex + Full-surcharge rule as `saleDefaults.expectedPricing`), **dates** (accept-deposits
   date; ready date defaulting to whelp + 56 days), **extras** (litter nickname, per-pup
   microchip and photo link), then the **review**, each section with a Change link.

### The save (`saveGuidedLitter`)
Order: new parents (an own dog is `owned`/`active_breeding` in the litter's kennel; an outside
one is `external` with its new kennel and owner contact made first) → the litter (created
`whelped`, or the picked one updated) → the breeding (the litter's own or the picked one marked
`whelped` and linked to the litter, or a new `actual` one created `whelped` with
`expected_due_date` = bred + 63) → the `incoming` stud service (`partner_contact_id` = the
dad's owner) → each puppy (`puppyDefaults.baseFromLitter`, exactly as Add Puppies; a pup
already on the litter is updated, and given the birth date if it had none) → a `weight_check`
event titled "Birth weight" per weighed pup. In Lite the litter is the first write, so the
litter cap refuses with nothing made (a new own mom counts toward the dog cap and is made
first). **Resumable:** every record's id goes back on the draft (`draft.saved`, `pup.id`) the
moment it's made and the draft is re-saved after each write, so a save that stops partway
(an error, a closed tab) retries without making anything twice; changing an answer after
such a stop clears `saved.litterUpdated` / each pup's `saved` so the retry writes the new
values.

### The draft
`settings.js` `guidedLitterDraft` (`kennelOS.guidedLitterDraft`): her answers, kept after
every step, plus `history` (each answered question and her reply, so the chat is replayed when
she comes back), versioned by `DRAFT_VERSION` (an older version is dropped). Device-only — it
isn't program data until saved — and in `KEYS`, so Reset App clears it. One at a time: Ken's
menu offers **Finish recording X's litter** first, and starting a new litter with one pending
asks "Finish that one / Start fresh".

### After the save: "Let families know" (Pro)
`assets/guidedShareUI.js` (Pro-only; imported only when `editionFlags.waitlist` or
`editionFlags.companion` and a pup is Available), as Ken's "Want to tell people about the new
pups?" with its panel in the chat. **Tell my waitlist they were born** opens
the litter page's own "It's almost your turn" / "a litter you match was born" notice
(`waitlistPicksPanel.openLitterWaitlistNotice`) to review and send. **Share the available
pups** walks the active waitlist contacts (the Companion console's prospective membership) one
family per screen with real Email / Text anchors built by `companionLink.js`. It **never opens
picks**: offers stay hers to make from the litter page, which the Done
screen says.


---

## 34. Live sync (Cloud Phase 2) — `docs/KennelOS_Cloud_Phase2_Sync_Plan.md`

**Editions:** Pro only (`editionFlags.liveSync`, and `isCloudAvailable()`). Lite and Demo
never sync.

There's no sync UI yet and nothing starts the scheduler, so nothing syncs on its own. The
plan is the detailed design. This is the shape of what's built.

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
  pauses. A lapsed license pauses sync. Joining a program: the newer `updated_at` wins and
  nothing gets deleted.
- **Server work on a syncing program** (waitlist intake, family and vendor events, emails)
  runs on one device at a time under a two-minute lease (`data/cloud/serverWork.js`,
  migration `0016`).
