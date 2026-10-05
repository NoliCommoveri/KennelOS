# KennelOS Cloud — Phase 1 build plan: opt-in accounts + cloud backup (DRAFT)

> Parent design: `docs/KennelOS_Cloud_Accounts_Proposal.md` (cited below as "Proposal §N").
> Status: **plan for review, nothing built.** Decisions it relies on are recorded in Proposal
> §10. The ones it raises are in §11 below.

## 1. Scope

**In Phase 1:**
- **Opt-in** account (email + 6-digit code), in **Lite and Pro**; Demo has none (Proposal §2a, §10).
- **Automatic cloud backup of the kennel-records tier only** (Proposal §6): a filtered snapshot
  pushed after changes, with 30 days of dated history.
- **Restore** on a new or reset device, and "restore as of <date>" for undoing mistakes.
- `syncRegistry.js`, the per-field cloud allow-list. It is the safety foundation every later
  phase reuses.
- Shutdown readiness: `cloudUrl: null` behaves exactly like today, plus a server-sent
  service-notice channel.

**Not in Phase 1:** the private vault (Phase 2b), live multi-device sync (Phase 2), teams,
connections, transfers, `dogs.public_id`/`contacts.public_id`, and any licensing change.
Phase 1 does nothing to the Lemon Squeezy gate.

**Shape:** Phase 1 backs up **whole snapshots** (the existing `exportAll` shape, filtered),
not per-record sync. That's deliberately simpler: there's no outbox and no conflict
resolution. One device per program is the **backup device** at a time (§3.4). Phase 2 replaces
snapshots with record-level sync and keeps this plan's auth, server, and registry.

## 2. What the user sees

### 2.1 Turning it on
- **Where it's offered:**
  - a card in **first-run** after kennel setup ("Protect your records: turn on free cloud
    backup"), skippable;
  - a **Cloud backup** card on Import/Export (shared, not Pro-gated; Proposal §10);
  - a gentle **Today nudge** while it's off, which can be dismissed for 30 days using the
    existing `nudgeState`.
- **Flow:**
  1. Enter email.
  2. Type the 6-digit code from the email.
  3. Read one plain screen: "What gets backed up: your dogs, litters, pairings, health
     records, contacts' **names**. What stays only on this phone: contacts' phone, email and
     address, prices and payments, Financials, contracts, receipts, and your private notes."
     It links to the existing file backup for those.
  4. Tap "Turn on". The first backup runs immediately with a progress bar (files can take
     a minute).
- **Why a typed code and not a magic link:** an iPhone home-screen PWA has *separate storage
  from Safari*, and a tapped email link opens Safari. A link would sign in the wrong copy of
  the app. A typed code always lands in the app the user is looking at.

### 2.2 While it's on
- **A status line** on the Import/Export card: "Backed up 4 minutes ago". If it's falling
  behind: "Not backed up for 3 days: no internet?"
- **When backups run** (only if something changed since the last push):
  - after a change, **at most once every 5 minutes** (the first change starts a 5-minute
    timer; more changes ride the same push);
  - when the app goes to the background (`visibilitychange` → hidden), but no more than
    once a minute, since a phone hides the app constantly;
  - at app start.
  No network → silently retried later. Nothing ever blocks a page. The status line still
  reads "backed up minutes ago" for an active user.

### 2.3 New phone / reset / restore as of a date
- **First-run gains a third choice:** "I already use KennelOS → sign in and restore". It sits
  next to sample data and kennel setup. Restoring skips kennel setup, because the snapshot
  has the kennel.
- **"Restore as of…"** on the Import/Export card lists dated snapshots ("Today 9:14",
  "Yesterday", "Tue Sep 29"…). Choosing one asks for confirmation, then does a **field-merge
  restore** (§4.3), so private data on this device is never wiped by a cloud restore.
- **Private fields after a new-phone restore** are blank. Records show a quiet "private
  details aren't in cloud backup" hint, pointing at the file backup. The vault (Phase 2b)
  removes this gap later.

### 2.4 Turning it off / leaving
- **"Turn off backup on this device"** stops pushing; the cloud copy stays.
- **"Delete my cloud data"** deletes snapshots, files, and the account server-side after a
  typed confirmation. The local data is untouched.
- **Reset App** also stops backup on this device (§3.5), so a reset can't overwrite the cloud
  copy with an empty program.

## 3. Client design (`shared/`)

### 3.1 New modules

| File | Role |
|---|---|
| `data/syncRegistry.js` | The per-table, per-field **cloud allow-list** plus per-row rules (§5). Pure data and pure functions, unit-tested. |
| `data/cloud/cloudConfig.js` | Reads `cloudUrl` from `editionConfig`. `isCloudAvailable()` is false when it's `null`. **Every other cloud module and UI checks this first.** |
| `data/cloud/cloudApi.js` | `fetch` wrapper: base URL, bearer token, JSON, timeouts, and typed errors (`CloudOfflineError`, `CloudAuthError`, `CloudConflictError`). The only module that talks to the network. |
| `data/cloud/cloudAuth.js` | `startSignIn(email)`, `verifyCode(email, code)`, `signOut()`, `currentAccount()`. The session lives in a `settings.js` key. |
| `data/cloud/cloudBackup.js` | `buildCloudSnapshot()` (§4.1), `pushIfDirty()`, `listSnapshots()`, `restoreSnapshot(id)`, plus the scheduler (debounce, visibility, start-up). |
| `assets/cloudBackupUI.js` | The Import/Export card, the first-run sign-in/restore steps, and the status line. **Not** in `proPages.js`. |

**Layering holds:** pages call `cloudBackup`/`cloudAuth`. Those call `importExport`/repos and
`cloudApi`. Only the data layer touches `db`, as `importExport.js` already does.

### 3.2 Knowing something changed (the dirty signal)
- **The flag:** a `settings.js` value `cloudDirtyAt` (an ISO timestamp), set by one helper,
  `markDataChanged()`.
- **Who calls it:**
  - `repoBase` create/update/hardDelete, right beside the existing `assertWritable()` hook;
  - the direct writers: `fileRepo` (3 sites), `expenseRepo` (2), `assistantSync` (1), and
    `importExport.restoreBackup`.
  - `sampleData` does **not** (sample data is never backed up; §4.1).
- **Coverage test:** a test greps `shared/data` for `db.<table>.(put|add|update|delete|bulk*|clear)`
  outside an allow-listed set of files. A new direct writer must either call
  `markDataChanged()` or be consciously added to the exempt list.
- `expenses` are private-only, so marking them dirty is harmless (the snapshot is unchanged).
  It's kept for Phase 2's outbox.

### 3.3 Settings keys (all through `settings.js`; pages never touch `localStorage`)
- `cloudSession` — `{ token, email, programId, deviceId }`.
- `cloudBackupState` — `{ enabled, lastPushedAt, lastSnapshotId, lastError }`.
- `cloudDirtyAt`.
- **Reset App:** `cloudBackupState.enabled` is always set to `false`. Reset App also asks
  **"Also sign out of cloud backup on this device?"**:
  - **yes** (the default when the reset follows the typed "erase" confirmation, i.e. the
    phone may be changing hands) clears `cloudSession` and revokes the token server-side;
  - **no** keeps `cloudSession`, so the user stays signed in and can restore straight away.
  Turning backup back on after a reset goes through the restore-or-overwrite prompt (§3.4).

### 3.4 One backup device at a time
- **The server tracks** `backing_device_id` per program. Each push carries `device_id` +
  `base_snapshot_id`.
- **Normal case:** a push from the backing device whose base is the latest is accepted.
- **Otherwise → 409:** the app says "Backups for Thornfield are coming from *Jen's iPhone*
  (last backup 2 hours ago)." The two choices:
  1. **Restore that backup here** (field-merge, newer-wins: §4.3), then this device takes
     over.
  2. **Replace it with this device's records** (typed confirm). The old backup is still in
     the 30-day history.
- **In practice** this is the "new phone" case, and it's exactly what Phase 2's real sync
  removes.

### 3.5 Shrink guard (protects the cloud copy from a bad local state)
Before uploading, compare record counts against the last snapshot. If the new one has
**fewer than half** the dogs or total records (and the last had ≥ 10), don't push. Show:
"This device has far fewer records than your last backup. Upload anyway / Restore from
backup instead." This catches the realistic disasters: a half-cleared browser, a wrong
"replace" import, and Reset App on a forgotten second device.

## 4. Snapshot format and restore

### 4.1 Building a snapshot (`buildCloudSnapshot`)
1. `exportAll()` → the existing full backup object.
2. **Drop sample data:** skip any row listed in the sample-data manifest.
3. For each table, keep only rows the registry's row rule accepts. For each kept row, build a
   **new object by name** from the registry's cloud fields. No spreads, the same posture as
   `companionExport.js`.
4. **Pull file blobs out:** each kept `files` row's blob is uploaded separately (§6.3), and the
   snapshot carries `{ sha256, size, mime }` in its place.
5. `assertSnapshotKeys()` runs a positive check over every row before upload. An unexpected
   key aborts the push and records `lastError`. Silence is the safe default.
6. gzip with `CompressionStream` and upload.

**Envelope:** `{ snapshot_format: 1, schema_version, created_at, device_id, edition,
counts: {table: n}, collections }`.

### 4.2 Expected size
Without blobs, a large Pro program (hundreds of dogs, thousands of events) is a few MB of JSON
and well under 1 MB gzipped. Files (health-test PDFs, pedigrees) dominate, which is why they're
content-addressed and uploaded once (§6.3).

**Per-user storage, worst case:** with the cadence in §2.2 and the retention in §6.3, a user
keeps at most 24 hourly + 29 daily ≈ **53 snapshots**. At a large program's ~1 MB gzipped
that's ~50 MB of snapshot JSON, and a typical Lite program (well under 100 KB) is a few MB.
Files are stored once regardless of how many snapshots reference them. Uploads are bounded
by the 5-minute cadence: at most ~12 an hour for someone editing non-stop, most of which are
superseded by the hourly retention.

### 4.3 Restore: a new `restoreBackup` mode, `'cloud-merge'`
The existing `'merge'` mode uses `bulkPut` on whole rows, which would **blank every private
field** on a device that has them. So we add a third mode, with one switch, `overwrite`:
- **Existing local row:** overlay only the *registry's cloud fields* from the snapshot and leave
  every other field as it is.
  - **Default (`overwrite: false`), used by new-device restore and the §3.4 takeover:**
    overlay only when the snapshot row's `updated_at` is **newer** than the local row's.
    A local row edited after the snapshot keeps its own values, so a record never ends up
    with an old status next to a new price.
  - **`overwrite: true`, used only by "Restore as of…":** a deliberate rollback, overlaid
    regardless of `updated_at`. Before it runs, the confirmation screen says how many
    records will be rolled back and that **their private fields keep their current
    values** (private fields aren't in the snapshot, so they can't roll back).
- **Missing local row:** insert the snapshot row as-is; its private fields are simply absent.
- **Local rows not in the snapshot** are left alone. Restore never deletes; soft-delete
  history is preserved, as everywhere else.
- **Files:** fetch each referenced sha256 not already present locally.
- **Lite cap:** `enforceImportDogCap` runs exactly as for a file restore. It's a no-op for a
  Lite program's own backup, which already fits.
- **"Restore as of a date"** uses the same mode with `overwrite: true`. To *undo* an
  addition, a user archives the record by hand. A Phase 1 restore never removes records (it's deliberately conservative;
  revisit in Phase 2).

## 5. The classification (`syncRegistry.js`)

**Rule zero:** a field not listed as cloud is private. The registry lists **cloud** fields, so
the default is safe. Every record's `id`, `is_archived`, `created_at`, `updated_at` are
implicitly cloud.

| Table | Row rule | Cloud fields | Private (everything else, notably) |
|---|---|---|---|
| **dogs** | all | `call_name`, `registered_name`, `sex`, `breed`, `status`, `ownership_type`, `kennel_id`, `breeder_kennel_id`, `sire_id`, `dam_id`, `litter_id`, `owner_contact_id`, `co_owner_contact_ids`, `date_of_birth`, `date_of_death`, `color_markings`, `registry`, `registration_number`, `microchip_id`, `url`, `planned_tests`, `disposition` | `notes` |
| **events** | all | `subject_type`, `subject_id`, `event_type`, `event_date`, `event_end_date`, `title`, `reminder_date`, `reminder_dismissed`, `related_dog_id`, `related_contact_id`, `details` **filtered** (below) | `notes`; `details` keys of type `textarea` |
| **kennels** | all | `kennel_name`, `prefix`, `public_id`, `is_own_kennel`, `location` (**decided**), `website`, `logo_data_url`, `preferred_tests`, `preferred_breeds`, `preferred_test_breeds`, `promote_nudge_enabled`, `promote_age_male_months`, `promote_age_female_months` | none |
| **contacts** | all | `name` (**decided**), `contact_type`, `kennel_id`, `waitlist_status` | `email`, `phone`, `address`, `notes`, `companion_note`, `first_contact_source` |
| **pairings** | all | `kennel_id`, `sire_id`, `dam_id`, `pairing_type`, `status`, `method`, `planned_date`, `last_observed_date`, `expected_due_date` | `notes` |
| **litters** | all | `kennel_id`, `pairing_id`, `sire_id`, `dam_id`, `status`, `nickname`, `whelp_date`, `accept_deposits_date`, `estimated_ready_date`, `litter_registration_number`, `puppies_born_*` counts, `foster_direction`, `foster_partner_contact_id` | every price/deposit/foster-money field, `foster_split_notes`, `notes` |
| **sales** | all | `kennel_id`, `dog_id`, `buyer_contact_id`, `status`, `placement_type`, `sale_date`, `deposit_date`, `balance_due_date`, `balance_paid_date` | `price`, `deposit_amount`, `transport_fee`, `deferred_boarding_*`, `invoice_*`, `payment_*`, `lead_source`, `referred_by_contact_id`, `notes` |
| **stud_services** | all | `kennel_id`, `direction`, `type`, `our_dog_id`, `partner_dog_id`, `partner_contact_id`, `pairing_id`, `status`, `fee_structure`, `pick_status`, `sent_date`, `returned_date` | `fee_amount`, `pick_value_amount`, `result_notes`, `invoice_*`, `payment_*`, `referred_by_contact_id` |
| **contracts** | all | `kennel_id`, `contract_type`, `status`, `title`, `related_sale_id`, `related_stud_service_id`, `related_dog_id`, `related_contact_id`, `signed_date`, `lease_start_date`, `lease_end_date` | `document_url`, `terms_summary`, `notes` |
| **documents** | `doc_type` ∈ {`health_test`, `pedigree`, `registration`} | `kennel_id`, `dog_id`, `doc_type`, `file_id`, `title`, `doc_date`, `issuer_or_lab`, `result`, `registry`, `registration_number` | `notes`; whole rows of type `contract`/`other` |
| **files** | only files referenced by a **kept** document | `mime`, `filename`, `size`, `thumbnail`, blob → R2 by sha256 | receipt files, contract/other document files |
| **expenses** | **none** | none | the whole table (Financials) |
| **breed_feeding_schedules** | all | every field except → | `notes` |

**Event `details` filter:** each event type's fields are already declared in `vocab.js`
(`EVENT_TYPES[].fields`). Keys whose field `type` is `textarea` (free text: treatment,
findings, temperament notes, `notes`/`note`) are private, and every other declared key is cloud.
An **undeclared** key in `details` is private. So the rule is derived from the vocab that
already drives the forms, and it can't drift.

**Why `referred_by_contact_id` and `lead_source` are private:** they're sales-funnel
information about other people, not kennel records, and nothing in Phase 1 needs them.

**Tests (`tests/syncRegistry.test.js`):**
- Every table in `db.js` has a registry entry, even if that entry is "none".
- **Coverage:** every key present in the full Thornfield sample packet is either cloud or
  listed in an explicit `KNOWN_PRIVATE` set. An unclassified field fails the test, so a new
  field is a conscious decision rather than a silent backup gap.
- `buildCloudSnapshot()` over the sample packet contains **no** private key anywhere, and
  `assertSnapshotKeys` throws on an injected one.
- `'cloud-merge'` restore preserves a pre-existing private field, and inserts a missing row.
- `'cloud-merge'` with `overwrite: false` leaves a locally newer row untouched; with
  `overwrite: true` it overlays it.
- Shrink-guard thresholds.

## 6. Server (`cloud/`)

Phase 1 needs **Workers + D1 + R2 only.** No Durable Objects yet; they arrive with Phase 2 sync.

### 6.1 API (all JSON; bearer token except `/auth/*` and `/notice`)

| Route | Does |
|---|---|
| `POST /auth/start {email}` | Emails a 6-digit code (valid 10 min). Rate-limited per email and per IP. Always returns 200, so it can't be used to test which emails have accounts. |
| `POST /auth/verify {email, code, deviceLabel}` | Max 5 attempts per code. Creates the user + program on first sign-in. Returns `{token, programId, deviceId}`. |
| `POST /auth/signout` | Revokes this token. |
| `POST /auth/signout-others` | Revokes every other session on the account ("Sign out other devices" on the Import/Export card). |
| `GET /program` | Program name, backing device (label + last push), latest snapshot meta. |
| `HEAD /files/:sha256` · `PUT /files/:sha256` | Upload-if-missing. The server re-hashes and rejects a mismatch. 25 MB cap per file. |
| `POST /snapshots` | Body: gzipped envelope + `base_snapshot_id`, `device_id`. Returns 409 per §3.4. The server checks every referenced sha256 exists. |
| `GET /snapshots` · `GET /snapshots/:id` | The history list and one snapshot. |
| `POST /program/backing-device` | Takeover (§3.4). |
| `DELETE /account` | Deletes the account's rows, snapshots and files, and revokes tokens. |
| `GET /notice` | Service notices (`{ level, message, until }`) for the sunset path (Proposal §2a). Public and cacheable. |

### 6.2 D1 schema (sketch)
```
users(id, email UNIQUE, created_at)
login_codes(email, code_hash, expires_at, attempts)
sessions(token_hash PRIMARY KEY, user_id, device_id, device_label, created_at, last_seen_at, expires_at, revoked_at)
programs(id, owner_user_id, backing_device_id, latest_snapshot_id, created_at)
snapshots(id, program_id, device_id, created_at, size, counts_json, r2_key)
snapshot_files(snapshot_id, sha256)        -- for GC
```
- **Hashing:** tokens and codes are stored hashed (SHA-256), never in plain text.
- **Session expiry:** sliding 90 days. Each authenticated request that lands more than a day
  after `last_seen_at` pushes `expires_at` out to 90 days from now. An expired or revoked
  token gets `401` → `CloudAuthError`, and the app asks for a new code; backup pauses until
  then, and local data is untouched.
- **One program per user in Phase 1.** Phase 3 (teams) adds `memberships`.

### 6.3 R2 layout and retention
- **Paths:** `snapshots/<program>/<snapshot_id>.json.gz` and `files/<program>/<sha256>`.
  Files are scoped per program, so one program's upload never answers another's `HEAD` and
  can't be used to probe whether someone else has a file.
- **Retention:** for the last 24 h, at most one snapshot per hour (the latest in each hour);
  then one per day to 30 days; then deleted. The newest snapshot is always kept, whatever
  its age. (Together with the §2.2 cadence that's at most ~53 snapshots per program; §4.2.)
  A daily cron Worker prunes snapshots, then deletes files no retained snapshot references.
- **Backstop:** D1's own Time Travel (30 days) covers the metadata tables.

### 6.4 Security & privacy posture
- **What the server holds** is the cloud tier only (§5), plus the account email. There are no
  buyer phone numbers, addresses, or money. This posture is pinned on the client by
  `assertSnapshotKeys`. The server doesn't parse record contents at all; it stores the blob.
- **CORS:** only the origins that actually run Lite and Pro, per the Editions Plan's domain
  map: `https://kennelos.app` (Lite), `https://pro.kennelos.app`, plus `localhost` for dev.
  Demo is excluded (`cloudUrl: null`). The list is read from one shared editions-origins
  constant that the Worker and the build both use, so a domain change can't leave the API
  blocking an edition.
- **No request bodies in logs.** Cloudflare encrypts R2 and D1 at rest.
- **Privacy policy page** on `site/` before launch. It covers what's stored (§5's table in
  plain English), retention (30 days), how to delete, and what happens on shutdown.

### 6.5 Email
A transactional email provider is needed for the codes (Cloudflare Email Service, Resend,
Postmark…). It's the one third-party dependency (see Q1). The sender domain is
`kennelos.app`, with SPF/DKIM set up so codes don't land in spam.

## 7. Editions & build wiring
- **`editionConfig` gains `cloudUrl`:**
  - `lite/` and `pro/`: `https://api.kennelos.app`;
  - `demo/`: `null`;
  - `shared/` (the default): `null`.
  This keeps the shared core inert; a local-dev override lives in `editionConfig` too.
  `tests/editionConfig.test.js` today only checks that every edition declares every
  `editionFlags` key, so it gets extended to cover `cloudUrl` too.
- **No-server boot test:** with `cloudUrl: null`, no cloud module makes a request and no cloud
  UI renders. A headless-Chromium browser check exercises every page, alongside the existing
  edition checks.
- **New files** go in `shared/sw.js` `PRECACHE_URLS`, plus a `CACHE_NAME` bump when the batch is
  done (asked first, per CLAUDE.md). API calls are cross-origin, so the cache-first handler
  already ignores them. Nothing is added to `proPages.js`.
- **Demo** also never imports the cloud UI (`cloudUrl: null`), so no account wording appears.

## 8. Docs to update in the same change (CLAUDE.md rule)
- **CLAUDE.md:** "No backend" becomes "No *required* backend". Add the cloud non-negotiables:
  - the opt-in rule;
  - `cloudUrl: null` must work;
  - a new field is private until classified in `syncRegistry.js`, with that file named
    alongside `referenceRegistry.js` as the second registry to keep current.
- **README** build status; **Editions Plan** (Lite gains an optional account + backup + vault).
- **End-State guide:** §2 (architecture), §5/§10 (the `'cloud-merge'` restore mode), §11 (new
  settings keys, first-run choice), and a new **§29 Cloud backup** section. §16's invariants gain
  the registry coverage test.

## 9. Build order (each a reviewable PR; nothing user-visible until step 5)
1. **`syncRegistry.js` + tests.** Pure data, no network, no UI. Review this one field by field
   with your sister; it *is* the privacy promise.
2. **`buildCloudSnapshot` + `'cloud-merge'` restore + shrink guard + `markDataChanged` hooks +
   the direct-writer coverage test.** Still no network.
3. **`cloud/` Worker:** auth, snapshots, files, notice, D1 migrations, and the retention cron,
   with tests using Miniflare/`vitest` (dev-only, like today's `package.json`). Deployed to a
   staging subdomain.
4. **Client cloud modules** (`cloudConfig`, `cloudApi`, `cloudAuth`, `cloudBackup`) against
   staging.
5. **UI:** the Import/Export card, first-run offer and restore-on-new-device, the Today nudge,
   and the 409/takeover and shrink-guard dialogs. Browser-verified in Lite and Pro, plus the
   Demo/no-server checks.
6. **Docs (§8), privacy policy page, `PRECACHE_URLS`, and the SW bump** (asked first). Then
   production deploy.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| A private field leaks to the server via a new field | Rule zero (unlisted = private), the coverage test, and `assertSnapshotKeys` at upload |
| A wiped or half-empty device overwrites a good backup | Shrink guard, Reset App disabling backup, 30-day history |
| A second device clobbers the first | One backing device, with 409 → explicit choice |
| iPhone PWA / Safari storage split breaks sign-in | Typed code, not a link |
| Email codes land in spam | SPF/DKIM on kennelos.app; "Didn't get it? Resend / check spam" |
| We stop hosting | `cloudUrl: null` release, local data untouched, file backups still there (Proposal §2a) |
| Large document libraries are slow on first backup | Content-addressed, upload-once files; progress bar; resumable because each file is independent |

## 11. Questions this plan raises
1. **Email provider:** is any preference? Cloudflare Email Service keeps it all on one bill;
   Resend/Postmark have better deliverability tooling.
2. **API domain:** is `api.kennelos.app` okay? And whose Cloudflare account owns it (ideally
   your sister's, with you as a member)?
3. **Free-tier limits:** cap Lite cloud storage (e.g., 1 GB of documents)? Cost at Lite's
   6-dog / 2-litter size is negligible, but a cap protects against abuse.
4. **Retention:** is 30 days right? Longer costs little for the JSON; files dominate.
5. **Who runs it:** still open (Proposal §10). Phase 1 is low-maintenance (no live sync),
   but somebody gets the email if the Worker errors.
