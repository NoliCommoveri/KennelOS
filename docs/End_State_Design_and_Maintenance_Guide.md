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
  personal note and pickup plan persist as plain Sale fields (`furever_note`,
  `furever_pickup_date`/`_time`/`_place`/`_photo_url`), so a resend starts from them. Furever
  shows them as a pre-pickup countdown card.

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
Every multi-step write: approve (links a contact she picks from `contactMatches`, never
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
  **Manage**), `waitlist-entry` (one family: Details / Interact / History tabs),
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
rows only in "All time"), `kpis`, `charts`, column `total`, `rowsFor` (summary reports
grouping the filtered records), and always **Print / PDF**. All follow the visible rows.

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
Live-Birth Summary, Health-Test Events, Dam & Sire Production (flags litters under
`BACK_TO_BACK_DAYS` apart and at `LIFETIME_LITTERS_FLAG`, prompts only), Pairing Success,
Heat Cycles, Health-Testing Gaps; Puppy Growth (flags a pup under 85% of its littermates'
median); Placements, Scheduled Placements, Waitlist Funnel, Demand vs Supply, Lead Sources &
Referrers, Returns & Voids; Stud Services, Stud Results, Show Record; Active Roster; Year in
Review (prints on one page).

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
