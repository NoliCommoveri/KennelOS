# KennelOS: the review's remaining findings (plan)

> **Status: batches A and C built** (`docs/BUILD_LOG.md`, 2026-11-18 and 2026-11-19); B waits on R1 and R6; D–I not started. Written 2026-11-18 against `main` at `6aacb16`. It covers
> every finding still open in `docs/review/FIX_PRIORITIES.md` except K15 (the UI redo) and K16
> (the summary), which stay where that file puts them. Each finding below was rechecked in the
> code on this commit and still stands, unless §1 says otherwise. Seven owner decisions shape
> the batches (§2). Each has a recommendation, and the plan assumes it until she answers.

## 1. What this plan covers

**Open, and planned here (32 findings):**

| Severity | Findings |
|---|---|
| S2 | K12-4 (an alert opens a page that can't show what it said), K14-3 (per-pup packs), K1-4 (the duplicate scan freezes the page) |
| S3 | K1-5, K1-7, K2-7 to K2-12, K9-7 to K9-9, K10-9 to K10-11, K12-8, K12-9, K12-11, K13-10, K13-13 |
| S4 | K1-8 to K1-10, K2-13, K2-14, K4-11, K4-14, K5-11, K9-11 |

**Already built since `FIX_PRIORITIES.md` §2 was written** (left out): K6-13 (each waitlist
action is one transaction), K7-13 (`POST /waitlist/inbox/drop`), K7-10 (New link ends a
family's sessions), K6b-9 (the picks preview asks before it drops changes). K14-3's warning half
is built. This plan builds its per-pup packs.

**Partly covered:** K13-13. Kels's account health check (`storage-persist`) asks the browser
again while `persisted()` is false. Only the first-run ask in `app.js:33` is still at the
wrong moment.

**Not here:** K10-13 (currency: out of scope, owner 2026-11-15). K13-10's wider question of
how a deploy reaches an open tab is solved in step H, not redesigned. The phone and wording
items in group J that aren't one-liners stay with K15.

## 2. Decisions

| # | Finding | Question | Recommendation (assumed) |
|---|---|---|---|
| R1 | K1-5 | `dogs.status_date` and `litters.furever_pack` are in no `syncRegistry` bucket, so both are private by rule zero. Which tier? | **`status_date` → `cloud`.** It's the other half of `status`, which is already cloud, and it isn't personal data. **`furever_pack` → `cloud`** too. It holds Drive folder and file ids, and since those files are public by link, an id gives access. But the KennelOS server already holds the documents' `furever_shareable` flags, and without the pointer a non-vault restore drops documents from her next publish and orphans the old pack. Making a field `cloud` is a privacy decision, so the owner confirms both. |
| R2 | K12-9 | The Accounts form says saved logins "never go to cloud backup unencrypted", but a Dropbox push carries them in plain JSON. Do we change the words or the Dropbox copy? | **Change the words**, in line with the documented private-tier rule (backup files carry private fields): "Kept on this device and in backup files you save or push to Dropbox. Never sent to KennelOS's cloud unless your private vault is on." The other option, a Dropbox copy without private-tier fields, would make a Dropbox restore lose her passwords silently. |
| R3 | K9-7 | A pup placed on a co-own stays a Puppy for life. Where should she be asked for its life stage? | **On Delivered, beside the ownership choice**: when she picks Co-owned (or leaves an owned pup owned), "What is Ruby now?" with Pet home, Active breeding, or "leave as Puppy". Also a Today nudge for a delivered dog still `puppy` six months after its sale's delivery. |
| R4 | K10-11 | A partial refund on a returned pup can't be recorded. Add fields? | **Two fields on Sale: `refund_amount`, `refund_date`**, offered only on a Returned or Voided sale and taken off its earned income. They get the same `syncRegistry` tier as `price`. No expense category for refunds. |
| R5 | K13-10 | A new service worker takes over open pages silently. Reload the page, or show a notice? | **A notice, "KennelOS was updated. Reload", on `controllerchange`.** It reloads by itself only when the page has no open form or modal. Never reload over unsaved work. |
| R6 | K14-3 | Per-pup packs: what changes for families already on an old litter pack? | **The next publish moves every pup to its own sub-folder and manifest.** The litter manifest keeps only the sire's and dam's documents and gets a `pupManifests` map (pup id → that pup's manifest pointer, given only in that family's seed). The old shared files go to the trash in the same publish, so families holding the old `pack.json` can no longer open them. Furever reads both shapes. |
| R7 | K4-14 | Chunking the disaster-recovery import gives up "lands whole or not at all". Is that acceptable? | **Yes. Chunk it, and make the restore re-runnable** (`INSERT OR REPLACE`, parents first in `EXPORT_TABLES` order) so a failure part-way is finished by running it again, and the flash says how far it got. Before building, measure one run against a copy of production at real row counts. |

The other findings have one obvious fix and need no decision. K2-14's open question (Shared
Dogs plan §4 against §5) belongs to Shared Dogs phase 2, which already waits on the owner. Step
E builds only the version gate.

## 3. Build order

Nine batches, each one shippable. A and B come first: they hold the two remaining S2s that
reach families, and B must ship before Furever's origin goes live. C holds the third S2. The
rest can go in any order. Two batches can run at once in separate sessions whenever their
files don't overlap (the **Files** line in each).

Rules for every batch:
- Turn each finding into a failing test first (`tests/` or `cloud/tests/`), then fix it.
- `node --check` touched files, `node --test`, `node build/assemble.mjs`. For any batch
  touching `cloud/`, run `cd cloud && npm test`.
- No batch here needs a cloud migration. If one turns out to, the branch's one migration rule
  applies.
- Adding a file means adding it to `PRECACHE_URLS` (and `proPages.js` if it's Pro-only). Ask
  about the `CACHE_NAME` bump at the end of the batch, never bump on our own.
- Every batch adds an entry to `docs/BUILD_LOG.md` and its row in `FIX_PRIORITIES.md` §1.

### A. Alerts that land where they point, and the Accounts page (K12-4, K12-8, K12-9, K12-11)

**Files:** `shared/pages/waitlist-entry.js`, `shared/data/cloud/cloudNotify.js`,
`shared/data/cloud/cloudAuth.js`, `shared/data/appReset.js`, the assist hand-back,
`shared/assets/cloudBackupUI.js` (Notifications card), `cloud/src/api.js`,
`shared/pages/accounts.html`, `shared/pages/accounts.js`.

- **K12-4 (a), stale page:** `waitlist-entry.js` redraws on `CLOUD_DATA_CHANGED_EVENT`, as
  `today.js:255` does, keeping any open composer or form (redraw the read-only panels only, or
  defer while a form is dirty). When the page is opened from an alert (`?from=alert`, added to
  the URL `notify.js:349` builds), take in first: call `syncWaitlistOnline({ force: true })`
  before the first render, with a short "Checking for new messages…" line, and render
  anyway after 5 s.
- **K12-4 (b), a device that can't take in:** on a device that is neither the backing device
  nor the lease holder (`serverWorkClaim` false), the Notifications card says so when alerts
  are turned on: "This device shows the alert, but the message arrives on <backing device>.
  Open it there, or make this device the one that backs up." The entry page opened from an
  alert says the same, and on "Waitlist entry not found" it says the entry is on another
  device instead of being a dead end.
- **K12-8:** `cloudAuth.signOut`, `appReset` and the assist hand-back clear the
  `kennelos-notify` note and unsubscribe this device. `refreshAlertsHere` re-subscribes only
  when the note's account id equals the session's (store the id in the note when alerts are
  turned on). `PUT /notify` and the `/notify/push/subscribe` and `/notify/digest` writes join
  `OWNER_ONLY`, so a helper session can read the settings but not change them or subscribe.
- **K12-9:** the hint wording from R2.
- **K12-11:** `.acct-grid` → `minmax(min(320px, 100%), 1fr)`.
- **Tests:** an entry page that receives `CLOUD_DATA_CHANGED_EVENT` shows the new message.
  `?from=alert` takes in before it renders. Sign-out clears the note. A helper `PUT /notify`
  gets 403 (`cloud/tests`). At 320 px the Accounts page has no `scrollWidth` overflow
  (Playwright).
- **Docs:** End-State guide §30 (notifications), Notifications plan (**Modified:** helper
  sessions can't change alerts), `cloud/README.md` (owner-only routes).
- **Built with it:** K12-7's card half (blocked or dropped alerts aren't called "on"),
  K12-12 (a referral link without `https://`) and K12-13 (permission asked from the tap).
  `FIX_PRIORITIES.md` had never listed these.
- **Still open from K12:** K12-5 (a burst of alerts ends on the generic line: `pendingPush`
  should keep the informative lines), K12-6 (unmatched or duplicate vendor events dropped
  without a word, for Firma and Stripe now Jotform is gone), K12-7's other half
  (`pushsubscriptionchange` in `sw.js`, which needs a way to re-subscribe without a session
  token) and K12-14 (the /ops wording on rotating the push key, and dropping endpoints that
  answer 401/403). They're small, all in `notify.js` and `sw.js`: a batch **A2**.

### B. Per-pup Furever packs (K14-3, and `furever_pack` from K1-5)

**Files:** `shared/data/fureverContentPack.js`, `shared/pages/furever.js`,
`furever/data/contentPackFetch.js`, `shared/data/syncRegistry.js`,
`cloud/src/lib/cloudFields.js` (regenerated).

- **Publish (R6):** a litter publish writes the sire's and dam's documents to the litter
  folder and manifest. Each pup's own documents go into `<litter folder>/<pup id>/` with
  that pup's own `pack.json`. The litter manifest gains `pupManifests: { [pupId]: { fileId,
  resourceKey } }`, but each family's seed carries only its own pup's entry, so no family is
  ever handed another pup's manifest id. Files a pup had in the old shared layout are trashed
  in the same publish, as `removedKeys` are today (`publishPack` step 0).
- **Furever:** `contentPackFetch` reads the litter manifest, then the seed's pup manifest.
  `filesForThisPup` stays as a filter for old packs only.
- **Warning:** the warning for every document in a litter publish stays for the sire's and
  dam's documents (shared by the whole litter). A pup's own documents get the ordinary wording
  ("public to anyone with this pup's link").
- **R1 half:** classify `litters.furever_pack` (assumed `cloud`), then run
  `node cloud/scripts/cloud-fields.mjs > cloud/src/lib/cloudFields.js`.
- **Tests:** in a two-pup litter, family B's seed and the litter manifest together hold no
  file id of pup A's. A republish over an old shared pack trashes pup A's shared copies.
  Furever still reads an old-shape pack.
- **Docs:** guide (FurEver content pack), the Furever plan's pack section (**Modified**),
  `FIX_PRIORITIES.md` (K14-3 done, Furever origin unblocked).

### C. The duplicate scan and the import preview (K1-4, K2-7, K2-11, K2-12)

**Files:** `shared/data/tidyRules.js`, `shared/data/duplicateScan.js`,
`shared/assets/duplicateScanUI.js`, `shared/data/csvImport.js`,
`shared/assets/importView.js`.

- **K1-4:** `compareDogs` tests the cheap disqualifiers (sex, birthday, microchip, sire and
  dam, parent and child, same litter) and returns `null` before building any label array.
  Buckets become call name + birthday. Each dog's name and registration keys are built once
  per scan, not once per pair. `findDuplicates` yields between tables (`await` a macrotask)
  so the "Scanning…" line paints, and its first pass hands its dog pairs to
  `duplicateDogFindings` instead of comparing them a second time. **Target:** 4,000 dogs in 8
  call names in under 1 s unthrottled (review measured 11 s), and the same in Kels's tidy-up.
- **K2-7:** `renderPreview` draws the first 200 rows plus every review row, with "Showing 200
  of 10,000. All 10,000 will be imported". The review row's existing-record picker is one
  shared `<datalist>`, or is filled on focus, never one `<option>` list per row. The commit
  writes in chunks of 200 inside `db.transaction`, with a progress line ("Imported 2,400 of
  10,000…"), and records the last committed row so an interrupted import says where it
  stopped.
- **K2-11:** `buildDogChanges(record, matched)` keeps only the fields that differ. An empty
  diff becomes a new plan action, `unchanged`, shown as "40 unchanged" and never written.
  Apply the same to each entity's `build*Changes`.
- **K2-12:** `parseCsv` reads the bytes and decodes with `TextDecoder('utf-8', { fatal: true })`.
  On a decode error it falls back to `windows-1252`, and the preview says "This file isn't
  UTF-8, so it was read as Windows-1252. Check the names below."
- **Tests:** the review's scale runs as a test with a time bound (kept generous for CI). The
  preview's DOM node count stays bounded at 10,000 rows with one bad status. Re-importing an
  unchanged file gives `updated: 0` and leaves `updated_at` as it was. A Windows-1252 "Zoë"
  imports as "Zoë" with the warning.
- **Docs:** guide (CSV import, duplicates).

### D. Worker reads that grow with programs (K4-11, K4-14)

**Files:** `cloud/src/retention.js`, `cloud/src/backup.js`, `cloud/src/sync.js`
(`syncCounts`), `cloud/src/notify.js` (`runDigests`). Worker only, so it can run alongside any
app batch.

- **Measure first.** Seed a local D1 at 2,000 programs × 54 snapshots, plus realistic
  `wl_event` and `sync_device` counts, and time `runRetention`, `exportAll` and the restore.
  Record the numbers in `cloud/README.md`. Whatever the measurement shows, the fixes below
  still go in, because they remove the cliff.
- **K4-11:** retention pages its snapshot reads by program (`SELECT DISTINCT program_id …
  LIMIT`, then each program's snapshots), keeping `MAX_PER_RUN` as the cap on deletes. Page
  `syncCounts` and `runDigests`'s `SELECT *` the same way.
- **K4-14 (R7):** `exportAll` reads each table in pages of 1,000. The restore batches 200
  statements at a time in `EXPORT_TABLES` order with `INSERT OR REPLACE`, and the flash
  reports "Restored 14 of 26 tables (users, sessions, …). Run it again to finish" on a
  failure.
- **Tests:** retention with more programs than one page handles them all and keeps the
  per-run cap. A restore made to fail on the third batch, then run again, ends identical to
  one clean run.
- **Docs:** `cloud/README.md` (retention, disaster recovery and its measured run), Cloud
  Phase 1 plan's recovery section (**Modified:** not one batch).

### E. Files, Dropbox and Dog Cards (K2-8, K2-9, K2-10, K2-13, K2-14)

**Files:** `shared/assets/documentModal.js`, `shared/data/pedigreeImport.js`,
`shared/data/documentRepo.js` (`assertOwnKennel`), `shared/data/dropbox.js`,
`shared/pages/import-export.js`, `shared/data/dogCard.js`, the Dog Card preview UI.

- **K2-8:** resolve and assert the kennel before the blob is written. Store the file and write
  the document in one `db.transaction`. Remove the old file only after the update succeeds.
  `assertOwnKennel`'s message becomes "Pick one of your kennels at the top first, then save
  again." A new Duplicates-card check, **Files nothing uses**, lists any `files` row no
  document or expense points at, with its size and a Remove.
- **K2-9:** a failed refresh grant (`invalid_grant`, 400 or 401) calls `disconnectDropbox()`
  and re-renders the card as not connected: "Your Dropbox connection has expired. Connect
  again." When "Last backup" is older than the reminder window, the card says so.
- **K2-13:** keep the `rev` from the last download or upload in `settings`. Push with
  `mode: { '.tag': 'update', update: rev }`. On a conflict: "A newer backup is already in
  Dropbox. Pull it first, or push anyway" (push anyway overwrites). The restore preview warns
  when the file's `exported_at` is older than her newest record's `updated_at`.
- **K2-10:** a card ancestor whose registered name (titles stripped, whitespace collapsed)
  matches one of hers with no registration number is counted apart ("1 ancestor looks like one
  you already have") and offered the `lookalikes` link picker the dogs sent already use. The
  automatic match stays strict.
- **K2-14:** `decodeDogCard` refuses a `cardVersion` above `DOG_CARD_VERSION` with
  `inspectBackup`'s sentence.
- **Tests:** three failed saves leave no `files` rows. A failed edit keeps the old file. A
  revoked token shows Connect. A stale `rev` gets the conflict message. A hand-typed
  "Ashvale  Granite" is offered as a lookalike. A v2 card is refused.
- **Docs:** guide (documents and files, Dropbox, Dog Cards), Shared Dogs plan (**Modified:**
  the lookalike picker for ancestors).

### F. Pedigrees and life stage (K9-7, K9-8, K9-9, K9-11)

**Files:** `shared/data/goHome.js`, `shared/pages/sale.js`, `shared/data/nudges.js`,
`shared/data/pedigreeEdit.js`, `shared/assets/pedigree.js`, `shared/pages/dog.js`,
`shared/pages/litter.js`.

- **K9-7 (R3):** the Delivered prompt gets a life-stage question when the pup stays in her
  records (Co-owned, or left owned). `deliveredOwnershipChanges` takes the answer. A new nudge,
  `delivered-still-puppy`, fires for a dog whose status is `puppy`, with a Delivered sale more
  than 180 days old, and offers Pet home or Active breeding. Add it to the guide's nudge
  table.
- **K9-8:** `setParent` on a dog with a `litter_id`, when the new parent differs from the
  litter's, asks "Change the litter's sire too (every pup), or just Red's (a split litter)?".
  The Dog page warns about a sire or dam mismatch the way it warns about DOB against the
  whelp date. A sire or dam edit on the Litter page offers to update its pups.
- **K9-9:** `addNewParent` first matches the typed registered name (titles stripped, the way
  `pickerGroups` normalises) against pedigree-only dogs and asks "Use CH Briar Ace already on
  file?".
- **K9-11:** reuse by registration number skips archived dogs and says "That number is on Old,
  archived". An archived node's spot always gets its ✎, even where its own links are hidden.
  Unknown boxes under a node that can't be edited get no "+ Add".
- **Tests:** a co-own Delivered with Active breeding gives `active_breeding`. The nudge fires
  at day 181. A chart parent fix offers the litter change. Typing the same name twice reuses
  the first dog. An archived dog's number isn't reused.
- **Docs:** guide (go home, nudges, pedigree editing).

### G. Money on the Sale and invoice pages (K10-9, K10-10, K10-11)

**Files:** `shared/pages/invoice.html`, `shared/pages/sale.js`, `shared/data/incomeView.js`,
`shared/data/saleRepo.js`, `shared/data/syncRegistry.js`, the Kels returns answer.

- **K10-9:** `.inv-actions { flex-wrap: wrap }`, and check the items table at 320 px.
- **K10-10:** "You net" is computed from the ledger's parts for the sale (`incomeView`): price,
  extras, fees charged back, fee credits. If a part can't be known on the form preview, the
  label there becomes "Price after the fee".
- **K10-11 (R4):** `refund_amount` (optional, default 0) and `refund_date` on Sale, editable
  only on a Returned or Voided sale. `incomeView` takes the refund off the sale's earned
  income on its date. Classify both in `syncRegistry` (same tier as `price`, so this needs
  R4's confirmation) and regenerate `cloudFields.js` if `cloud`. Backups stay backward
  compatible: both fields are optional. Update Kels's answer on returns.
- **Tests:** the invoice has no overflow at 390 or 320 px. "You net" matches the ledger in the
  review's scenario. A $1,000 refund on a $3,000 returned sale reports $2,000 earned, with the
  refund on its date.
- **Docs:** guide (Sale fields, income rules), the Payment Schedule plan (**Modified:**
  refunds).

### H. The app shell: updates, storage, the helper gate (K13-10, K13-13, K5-11)

**Files:** `shared/app.js`, `shared/sw.js` (only if the message needs it),
`shared/data/db.js`, `shared/data/cloud/cloudAuth.js`, `shared/assets/cloudAssistUI.js`
(`bootstrapHelper`).

- **K13-10 (R5):** `app.js` listens for `controllerchange`. If the page has no open modal and
  no dirty form, it reloads. Otherwise a strip says "KennelOS was updated. Reload", with a
  button. Lazy `import()`s that end in `.catch(() => {})` now show the same strip on a module
  error instead of failing silently.
- **K13-13:** move `firstRunPersistence` from first load to after the first record is saved
  (a `markDataChanged` listener, once). Kels's account health already handles the re-ask.
- **K5-11:** `isHelperDevice()` requires a session token plus a role the server confirmed:
  `bootstrapHelper`'s `GET /assist/state` answer is cached with the session, and the gate
  skips only on that cached answer, failing closed to the ordinary gate. A role set by hand in
  `localStorage` no longer lifts the wall.
- **Tests:** a simulated `controllerchange` with a dirty form shows the strip and doesn't
  reload. `persist()` isn't called before the first record. A forged `role: 'helper'` with no
  server answer still paints the wall (on the built Pro edition).
- **Docs:** guide (app shell, licence gate), editions plan if the gate's wording changes.

### I. The data layer's small ones (K1-5's `status_date`, K1-7, K1-8, K1-9, K1-10)

**Files:** `shared/data/syncRegistry.js`, `tests/syncRegistry.test.js`,
`shared/data/referenceRegistry.js`, the detail pages' Delete buttons (`dog.js`, `litter.js`,
`contact.js`, `pairing.js`, `sale.js`, `kennels.js`, `waitlist-entry.js`), `shared/data/db.js`
(comments only), `shared/data/waitlistReports.js`, the reports pages.

- **K1-5 (R1):** `dogs.status_date` → `cloud`, then regenerate `cloudFields.js`. The coverage
  test gets its field set from a static scan of every `create`/`update`/`put`/`add` object
  literal under `shared/data` and `shared/pages`, not only from the sample packet, so the next
  unclassified field fails a test.
- **K1-7:** a refused Delete shows its blockers as visible text under the button, using
  `accounts.js:347`'s wording and saying what archiving gives her instead. A shared helper
  (in `assets/`) means each page doesn't build its own. `ReferenceBlockedError` names the
  entity ("this application"), never the table.
- **K1-8:** `db.js` comments only (shipped version blocks stay as they are). Each index is
  marked with what reads it. Say plainly that `is_archived` can't be queried as a boolean key
  and is filtered in JS. Delete the three wrong claims.
- **K1-9:** the reports take labels from `descriptor(<vocab>, value).label`:
  `waitlistReports.js:73`, `offers-removals-report.js`, `litter-finances-report.js`,
  `stud-results-report.js`, `pairing-success-report.js`, `production-report.js`,
  `pricing-report.js`. `exitLabel` stays as it is.
- **K1-10:** add `waitlist_offers.eligible_dog_ids` to `DOG_REFERENCES` as a `scan`, with the
  guide's FK table updated.
- **Tests:** a phone-width page shows the blocker text. The static-scan coverage test fails if
  the `status_date` entry is removed. Deleting a pup offered on an open turn is refused.
- **Docs:** guide (sync tiers, reference registry and its FK table, deletes).

## 4. Order and pairing at a glance

| Order | Batch | Severity | Can run beside |
|---|---|---|---|
| 1 | A. Alerts, Accounts | S2 + S3 | D |
| 2 | B. Per-pup packs | S2 (before Furever's origin) | D |
| 3 | C. Scan and import | S2 + S3 | D |
| 4 | D. Worker scale | S4 (a growth cliff) | any app batch |
| 5 | E. Files, Dropbox, Dog Cards | S3 + S4 | F, G |
| 6 | F. Pedigrees, life stage | S3 + S4 | E, G |
| 7 | G. Money pages | S3 | E, F |
| 8 | H. App shell | S3 + S4 | E, F, G |
| 9 | I. Data layer | S3 + S4 | anything except C (both touch the reports and repos lightly). Run it last so the static scan sees every new field from the other batches. |

After I, `FIX_PRIORITIES.md` has no open findings outside K15. K15 is redone with group J, then
K16 writes `SUMMARY.md`.
