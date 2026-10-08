# KennelOS Cloud — Phase 1 build plan: opt-in accounts + cloud backup (DRAFT)

> Parent design: `docs/KennelOS_Cloud_Accounts_Proposal.md` (cited below as "Proposal §N").
> Status: **in progress.** Built so far: §9 steps 1–5 (the registry; snapshot, `'cloud-merge'`
> restore and dirty signal; the staging Worker; the client cloud modules in
> `shared/data/cloud/`; the UI in `shared/assets/cloudBackupUI.js`), plus the lost-device
> erase and Pro-license release (§2.5, added 2026-10-07), and step 6 (§9): the repo half, then
> the go-live change. **Live once the go-live change is merged** (after the operator's
> production setup, `docs/LAUNCH_CHECKLIST.md` §3a). The README's build status is the
> live record. Decisions it relies on are recorded in Proposal §10. The ones it raises are in
> §11 below.

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
- **A lost device** (§2.5): erase it from another device, and free its Pro license slot.

**Not in Phase 1:** the private vault (Phase 2b), live multi-device sync (Phase 2), teams,
connections, transfers, `dogs.public_id`/`contacts.public_id`, and any licensing change.
Phase 1 does nothing to the Lemon Squeezy gate itself. The one licensing touch is §2.5's
"free a lost device's license": the server stores each Pro device's activation id (not a
secret), and the owner's own browser releases it with the key, which never reaches our server.

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
     records, contacts' **names**, and your waitlist (its order, settings, application form,
     and each applicant's **name and email**). What stays only on this phone: contacts'
     phone, email and address, prices and payments (including waitlist fees paid),
     Financials, contracts, receipts, the rest of each application's answers, and your
     private notes." It links to the existing file backup for those. (Waitlist wording
     added by §5.1's decisions.)
  4. Tap "Turn on". The first backup runs immediately with a progress bar (files can take
     a minute).
- **Why a typed code and not a magic link:** an iPhone home-screen PWA has *separate storage
  from Safari*, and a tapped email link opens Safari. A link would sign in the wrong copy of
  the app. A typed code always lands in the app the user is looking at.
- **The server doesn't keep her email address (decided).** It stores only a keyed hash of it
  (§6.2), enough to find her account when she types the address again, and never the
  readable address. Each code goes to the address she has *just typed*, which is used for
  that one send and then discarded. A breach therefore yields no list of breeders' emails.
  The sign-in screen says so in one line: "We use your email to send your code. We don't
  keep it." (The email provider does see the address for each send; §6.5.)
- **Consequence: we never email her unprompted.** There are no newsletters, no "your backup
  is failing" emails, and the shutdown warning is **in-app only** (the `/notice` channel,
  §6.1; Proposal §2a). Someone who has stopped opening the app won't hear about a shutdown,
  but their local data and file backups are untouched either way.

### 2.2 While it's on
- **A status line** on the Import/Export card: "Backed up 4 minutes ago". If it's falling
  behind: "Not backed up for 3 days: no internet?"
  With the private vault offered (Private Vault Plan §2.2, built), the card shows two lines:
  "Kennel records: backed up 4 minutes ago" and "Private info: encrypted backup, 4 minutes
  ago" (or "only on this device · last file backup …", or "locked on this device").
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
  details aren't in cloud backup" hint, pointing at the file backup. The vault (Phase 2b,
  built 2026-10-07: `KennelOS_Private_Vault_Plan.md`) closes this gap once it's turned on.

### 2.4 Turning it off / leaving
- **"Turn off backup on this device"** stops pushing; the cloud copy stays.
- **"Delete my cloud data"** deletes snapshots, files, and the account server-side after a
  typed confirmation. The local data is untouched.
- **Reset App** also stops backup on this device (§3.5), so a reset can't overwrite the cloud
  copy with an empty program.

### 2.5 A lost device: erase it, free its Pro license (added 2026-10-07)
For a lost or stolen phone, from any other signed-in device (a new phone, or a laptop
browser): **Import/Export → Cloud backup → Account → Your devices…**
- **The list** shows every device with a session the server still holds: its label, when it
  was last used, "this device", and which one backs up the records. A device that signed
  itself out shows "can't be erased from here" (it dropped its token, so it never asks the
  server anything again). One signed out from elsewhere ("Sign out other devices") or whose
  sign-in expired still holds its token, so an erase still reaches it.
- **Erase…** (typed `ERASE`) signs that device out and flags it. The next time it opens
  KennelOS online, it deletes everything: every table, KennelAssistant's separate database,
  and every `kennelOS.*` key in both storages, including the ones Reset App deliberately
  keeps (the license record, the cloud sign-in and ids). Then it releases its own Pro
  activation (best effort), tells the server, and reloads onto first run. If it was the
  backup device, it stops being one, so the owner's next device doesn't meet its 409.
- **The honest limit, in the confirmation:** nothing happens until that device opens
  KennelOS with an internet connection. A phone in a drawer, offline, or never reopened keeps
  its records; the phone's own Find My / Find My Device is the real protection. And private
  details aren't in cloud backup (§5), so if the lost device holds the only copy, erasing it
  loses them unless a file backup has them.
- **Found it?** "Found it: cancel the erase" works until the device has confirmed. The
  device stays signed out (it signs in again with a code and keeps its records).
- **A fresh sign-in is required to erase**, and also for **Sign out other devices** and
  **Delete my cloud data** (decided 2026-10-07, §11 item 6): a session from the last 15
  minutes, or a code emailed to the account just now (the existing `/auth/start` code).
  Otherwise a stolen phone that's still signed in could erase its owner's other devices
  (which hold the only copy of the private tier), sign the owner out everywhere, or delete
  the cloud copy.
- **Free its Pro license** (Pro only) releases the lost device's Lemon Squeezy activation, so
  its slot comes back now, whether or not the lost device ever reopens. The device reported
  its activation id at check-in; the owner's browser calls Lemon Squeezy's `deactivate` with
  that id and the key (this device's own key, or typed). **The key never goes to our
  server.** Erase does this too when the device has an activation. The lost device, once
  released, walls on its next online license check (offline, it keeps its grace window), and
  the erase still reaches it: the check-in runs before the license gate.
- **From the activation wall.** A new Pro device whose key is out of slots can't reach
  Import/Export, so the wall has "Lost a device? Free a lost device's slot": sign in to cloud
  backup, then the same list, using the key typed on the wall.
- **Only devices that had cloud backup on** (signed in, and checked in at least once since
  this shipped) can be erased or have their license freed this way. Any other device still
  needs the owner to contact support to release its slot.
- **The check-in.** A signed-in device sends `POST /devices/check-in` whether or not it has
  anything to back up: on the first page of a browsing session and when it comes back to the
  foreground or online (each at most once a minute), and otherwise at most every 15 minutes
  across page loads. `app.js` starts it **before** the license gate. It carries the service
  notices, so a signed-in device still makes one request per browsing session for those
  (§4.6). Any request that meets `401 device_erased`, not only the check-in, erases the
  device (`cloudApi.setErasedHandler`).

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
- `cloudBackupState.lastCheckInAt` (§2.5), and `eraseAck`: after a remote erase, the dead
  token alone, kept until the server has heard the erase happened.
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

### 4.4 As built (§9 step 2)
- **Module split.** `buildCloudSnapshot`, gzip and the shrink guard are in
  `data/cloud/cloudBackup.js` now. Its network half (`pushIfDirty`, `listSnapshots`,
  `restoreSnapshot`, the scheduler) arrives in step 4. `buildCloudSnapshot` takes the
  server-issued `deviceId` as an option and returns `{ envelope, files }`; `files` is one
  `{ sha256, size, mime, blob }` per distinct content, for upload-if-missing (§6.1).
- **`exportAll({ encodeBlobs: false })`** feeds it raw Blobs. The file backup's base64
  markers would only be decoded again for hashing.
- **`'cloud-merge'`** is `restoreBackup(snapshot, 'cloud-merge', { overwrite, fetchFile })`.
  - **Files:** network stays out of `importExport.js`. Step 4 passes
    `fetchFile(sha256) → Blob`, and a file it can't get is skipped and returned in
    `missingFiles`. An existing local file row is never touched.
  - **Preview:** `planCloudMerge()` returns the per-table
    `{ inserted, updated, keptLocal, unchanged }` counts without writing. `updated` under
    `overwrite: true` is the confirmation screen's "N records will be rolled back".
  - **Absent fields:** a cloud field missing from a newer snapshot row is removed locally,
    since the snapshot says it was absent at the source.
  - **`events.details`** keeps the device's private keys and takes the snapshot's cloud
    keys (`syncRegistry.overlayCloudFields`).
- **Shrink guard reading.** "The last had ≥ 10" is applied to each measure separately:
  the dog check runs when the last snapshot had at least 10 dogs, and the total check when
  it had at least 10 records.
- **Dirty signal.** `settings.markDataChanged()` / `getCloudDirtyAt()` /
  `clearCloudDirty(ifAt)`. Exempt writers, pinned in `tests/cloudDirty.test.js`: clearing
  sample data (those rows are never in a snapshot) and Reset App (plan §3.3).
  - **Sample seed:** the seed writes through the repos, so seeding marks the flag even
    though every seeded row is filtered out. The resulting push is harmless but empty.
    Step 4's `pushIfDirty` can skip a snapshot identical to the last one.

### 4.5 As built (§9 step 4: the client modules)
- **URL wiring (§7).** Every edition config exports `cloudUrl` and `devCloudUrl`.
  `cloudUrl` stays `null` in Lite and Pro until production is live (step 6), so a deploy
  before then can't point at a server that doesn't exist. `devCloudUrl` is the staging
  Worker in shared, Lite and Pro. `cloudConfig` uses it **only** when the page's host is
  `localhost`/`127.0.0.1`, or in a browser that has turned on the **test-server switch**
  (below). Demo has neither. `tests/editionConfig.test.js` pins this.
- **Test-server switch (added 2026-10-07).** So the owner can test with only a browser,
  before production exists: visiting any page of the deployed Lite or Pro with
  `?cloud=staging` points that browser at `devCloudUrl`, and `?cloud=off` turns it back.
  It's a `settings.js` key (`cloudTestServer`), so it affects nobody who doesn't visit such
  a link. Switching forgets this device's cloud sign-in and backup position (they belong to
  one server), and every page shows a "Cloud backup: TEST SERVER" strip while it's on.
  Staging already allows the `lite.`/`pro.` origins (§6.4). It stays after launch as a way
  to check a server release from a real origin. Pinned in `tests/cloudClient.test.js`.
- **Lite → Pro (added 2026-10-07; Editions Plan, "Converting Lite → Pro").** Each push sends
  its `edition`, and a 409's `backingDevice` carries the edition of the backing device's
  latest snapshot. When a **Lite** device finds its program backed up from **Pro**, the push
  result carries `movedToEdition: 'pro'` and the UI says "Your records moved to KennelOS Pro"
  instead of the two-device conflict. Turning backup off there records
  `cloudBackupState.movedToEdition`, which keeps Today's turn-on nudge quiet until backup is
  turned on again. The Upgrade button also explains the sign-in-and-restore route when the
  Lite device is signed in. Pinned in `tests/cloudClient.test.js` and
  `cloud/tests/backup-api.test.js`.
- **Device identity.** The server accepts a client-supplied device id on `/auth/verify`.
  The client mints `cloudDeviceId` once and sends it on every sign-in, so signing in again
  on the backing device doesn't make it a stranger. It's a separate key from the license's
  `deviceId`.
- **Settings (§3.3).** `cloudSession`, `cloudBackupState` and `cloudDeviceId` sit outside
  `clearAllSettings()`'s keys. Reset App calls `appReset.stopCloudBackupAfterReset()`:
  backup off, and `lastSnapshotId`/`lastCounts` forgotten, so re-enabling meets a 409
  (`ownDevice: true`) and goes through §3.4's choice. The sign-out question stays with the
  UI (step 5).
- **Push results** are a status, never a thrown error: `pushed`, `unchanged`, `skipped`,
  `offline`, `conflict`, `shrink`, `auth` or `error`. `conflict`, `shrink` and `auth`
  **pause** automatic pushes (`lastError`) until the user acts, so the scheduler doesn't
  retry them every five minutes. A push the user starts (`force`) goes ahead.
- **"Unchanged" skip.** A dirty push whose cloud-tier content hashes the same as the last
  push sends nothing and clears the flag. That covers a private-only edit (a note, a price)
  and the sample seed, which writes through the repos.
- **One push at a time** across tabs via `navigator.locks`. The state is re-read inside
  the lock, so a second tab sees the first tab's push and doesn't 409 against itself.
- **Scheduler and the multi-page app.** Every navigation is a page load, so "at app start"
  means the **first page of a browsing session** (a `sessionStorage` mark): it pushes
  immediately if dirty. Later pages resume the five-minute timer from `cloudDirtySince`,
  the first unpushed change. A push also never starts sooner than five minutes after the
  last attempt. Background pushes (`visibilitychange` → hidden) are at most once a minute.
  The scheduler also re-arms when the browser comes back online.
- **The §3.4 choices.** `restoreLatestAndTakeOver()` restores the latest snapshot with
  newer-wins, takes over, then pushes. It is also `restoreOnNewDevice` for first-run.
  `replaceCloudWithThisDevice()` takes over and pushes with the shrink guard waived (the
  user chose it). The UI supplies the typed confirmation.
- **Tests** drive the client against the real Worker code in-process
  (`tests/cloudClient.test.js`). The fetch stand-in adds `Content-Length` as a browser
  does for a Blob body.

### 4.6 As built (§9 step 5: the UI)
- **Loading.** `cloudBackupUI.js` is imported dynamically, and only when
  `isCloudAvailable()`, by `app.js` (`bootCloud`), `today.js`, `import-export.js` and the
  first-run restore button. With `cloudUrl: null`, no cloud UI loads, renders, or makes a
  request (browser-verified, §7's "no-server boot test").
- **The post-setup offer** is armed when the first kennel is saved (`required` kennel-setup
  save) and shown on the reload after it. It isn't shown with sample data loaded, to a
  signed-in device, or while another modal is open. "Skip for now" also snoozes Today's
  nudge for its 30 days.
- **The Today nudge** only renders without sample data. "Not now" snoozes it for 30 days
  (`nudgeState.dismissedAt`). The same slot shows "Cloud backup is paused" while a
  conflict, shrink or expired sign-in is waiting.
- **Service notices** are fetched only by a device signed in to cloud backup, once per
  browsing session (cached in `sessionStorage`). Someone who never opted in sends the
  server nothing at all. They render as a strip at the top of every page. Since §2.5 they
  ride the device check-in (`POST /devices/check-in`); a device whose sign-in expired still
  reads the public `GET /notice`.
- **Restore on a new device** also records the first-run choice and sets `myKennelId` to
  the restored own kennel (settings aren't in the snapshot), so the kennel-setup gate
  doesn't fire.
- **Reset App's question** is a checkbox in the existing typed-RESET modal, ticked by
  default (§3.3: the reset follows a typed confirmation).
- **Restore as of…** labels a snapshot "Today 9:14" / "Yesterday …" / "Tue Sep 29 …". When
  two backups fall in the same minute, they get seconds too.
- **Deferred, then built with the vault UI** (Private Vault Plan §9 step 5): the "private
  details aren't in cloud backup" hint (§2.3) is a strip on the record pages that hold
  private details, beside the one on the Import/Export card.

## 5. The classification (`syncRegistry.js`)

**Rule zero:** a field not listed as cloud is private. The registry lists **cloud** fields, so
the default is safe. Every record's `id`, `is_archived`, `created_at`, `updated_at` are
implicitly cloud.

| Table | Row rule | Cloud fields | Private (everything else, notably) |
|---|---|---|---|
| **dogs** | all | `call_name`, `registered_name`, `sex`, `breed`, `status`, `ownership_type`, `kennel_id`, `breeder_kennel_id`, `sire_id`, `dam_id`, `litter_id`, `owner_contact_id`, `co_owner_contact_ids`, `date_of_birth`, `date_of_death`, `color_markings`, `registry`, `registration_number`, `microchip_id`, `url`, `planned_tests`, `disposition` | `notes` |
| **events** | all | `subject_type`, `subject_id`, `event_type`, `event_date`, `event_end_date`, `title`, `reminder_date`, `reminder_dismissed`, `related_dog_id`, `related_contact_id`, `details` **filtered** (below) | `notes`; `details` keys of type `textarea` |
| **kennels** | all | `kennel_name`, `prefix`, `public_id`, `is_own_kennel`, `location` (**decided**), `website`, `logo_data_url`, `preferred_tests`, `preferred_breeds`, `preferred_test_breeds`, `promote_nudge_enabled`, `promote_age_male_months`, `promote_age_female_months`, `waitlist_config` (**decided** 2026-10-07, §5.1) | none |
| **waitlist_entries / _offers / _programs** | all | see `KennelOS_Waitlist_Spec.md` §9, as revised by §5.1: the order and running state, her form wording, and of each `application` **only `name` and `email`** | each family's fee money and payment details, the other application answers, `pause_reason`, notes, the change history |
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

**As built (§9 step 1).** `shared/data/syncRegistry.js` follows the table above, and adds:
- **The three waitlist tables**, classified as in `KennelOS_Waitlist_Spec.md` §9, plus
  `dogs.intended_placement` (cloud). "Every field except" rows (`waitlist_offers`,
  `breed_feeding_schedules`) are written out field by field, so a field added later still
  starts private.
- **A `pending` bucket per table** for fields not yet decided, private (rule zero) until moved.
  It is empty now. Five fields this table didn't cover were **decided on 2026-10-06**:
  - **cloud:** `dogs.dob_is_estimated` (it qualifies the birth date), `dogs.recorded_coi`
    (genetic data, like the health tests), `litters.picks_opened_date` (a waitlist date;
    the auto-offer flow needs it after a restore);
  - **private:** `litters.feeding_schedule_override` (free text). `kennels.waitlist_config`
    was private here at first; §5.1's decision 1 (2026-10-07) moved it to cloud.
- **Readings of the table:** `litters.foster_comp_model` and `foster_split_basis` count as
  foster-money fields (private). `documents.contract_id` is private, because it only appears
  on contract-type documents, which never leave. `files.blob` is never in the snapshot JSON;
  `sha256` is a declared *derived* key that the snapshot builder adds in its place (§4.1).
- **Merging main's waitlist W1e work (2026-10-07):** the new waitlist fields follow
  `KennelOS_Waitlist_Spec.md` §9 where it decides them:
  - cloud: `listen_sire_ids`/`listen_dam_ids` (`listen_*`; the old pairing/litter lists are
    gone), `soon_notified_date` and `fee_received_at` ("every date field"; the latter is the
    same-day tie-breaker of the list order), and offers' `picked_date` and `sale_id`
    ("every field except notes");
  - private: `pref_change_log`/`pref_change_request` (§15.9: "private tier like
    `application`").
  `ready_timing` and `soon_notified_litter_ids` were pending at the merge, then decided cloud
  by §5.1 (2026-10-07). The `pending` bucket is empty again.
- **Not in this table but present in data:** the sample packet's `heat_cycle` event still
  writes the retired `details.cycle_start` key. It is undeclared, so it stays private.

### 5.1 Privacy vs. recoverability: decisions (2026-10-07)

**The question.** Merging the waitlist work showed that, under §5 and the Waitlist Spec as
first written, a cloud restore brought back a waitlist in the right order that couldn't be
run. Her form, rules and fee settings were private, applicants who weren't approved yet came
back nameless, and readiness holds were dropped. Holding less on the server protects other
people's privacy. Holding more protects users from losing work they can't get back. The
decisions below set where that line sits.

**The principle: split by whose data it is, not by table.**
- **Two harms, borne by different people.** A breach of readable personal data hurts *her
  buyers and applicants*: people who never agreed to us holding their details, and the
  exposure can't be undone. Data loss hurts *the breeder*, and only when several things fail
  together: every device lost, no file backup, and (with the vault) no passkey *and* no
  recovery code. So third-party personal details and money are held to the stricter
  standard. The breeder's **own business setup** is not.
- **Most "lost my data" anger comes from expectations**, not lost keys: people believing
  "cloud backup" covered everything, or never turning on the vault. The fixes for that are
  honest wording and an easy vault, not weaker encryption.

**Decision 1: her own waitlist setup and the list's running state are cloud (readable).**
`kennels.waitlist_config` goes to cloud: rules, application form questions, FAQ, the fee she
charges, payment instructions, pass and response settings, and the notice wording. Those are
her business settings, much of it shown publicly on the status page anyway. So are
`waitlist_entries.ready_timing` (the readiness hold), `soon_notified_litter_ids` and
`application_questions` (her form's wording, snapshotted per entry). Built in
`syncRegistry.js` on 2026-10-07.

**Decision 2: waitlist applicants' name and email are cloud (readable). Nothing else from
an application is.** `waitlist_entries.application` is a *partial* cloud field: only `name`
and `email` leave the device (the registry's `partial` rule, enforced by the pre-upload
check). Phone, address, household and every other answer stay private. A restore merges by
key, so a device that still has the full answers keeps them. Why this doesn't break the
line: W2's server will hold applicants' name and email readable anyway, because they give
them to the service directly under its privacy policy (Waitlist Spec §8.1). This decision
only brings that forward for backup. Each family's **fee amount and payment details** stay
private. Built 2026-10-07.

**Decision 3: the private vault is scheduled right after Phase 1, with a second-device
unlock.** **Built 2026-10-07** (`KennelOS_Private_Vault_Plan.md` §9 steps 1–7: recovery code,
second-device unlock and passkeys; released behind `VAULT_RELEASED`, `LAUNCH_CHECKLIST.md` §3b). It previously sat after Phases 2–4 (Proposal §9). It moves to directly after
Phase 1, because the waitlist depends on it: W2 needs it, and until it exists the only copy
of contact details, family fees and full applications is the device plus file backups. Its
design gains a **third unlock path**: any of the owner's devices that's already unlocked can
unlock a new one. That's alongside the passkey (which syncs through iCloud and Google, so a
lost phone isn't a lost key) and the recovery code. Vault UX requirements, recorded with the
design in Proposal §6.3:
- It's offered inside "Turn on cloud backup", strongly suggested for anyone using the
  waitlist, and **required before W2**.
- The status card shows two lines: "Kennel records: backed up 4 minutes ago" and
  "Private info: only on this device · last file backup 40 days ago" (or "encrypted backup,
  4 minutes ago" once the vault is on).
- After a restore without the vault, blank private fields are labelled and explained on
  the record (the per-record hint deferred in §4.6).
- Turning it on says plainly: "If you lose your passkey **and** this code, we can't open
  your private backup. Your devices and file backups are unaffected."

**Decision 4: no readable private data on our server stays the default.** Backing up
private data readable (or encrypted with a key we hold) is still not offered. The fallback,
**considered only if support requests show real users locked out despite passkey sync, the
recovery code and second-device unlock**, is a per-user opt-in: "Let KennelOS help me recover
my private info (less private)". It's recorded here so the trigger and the shape are decided
in advance. It isn't planned.

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

**Hosting shape (decided).** The editions and the marketing site **stay on GitHub Pages**,
deployed by `deploy.yml` exactly as today. The server is **one separate Worker**, `cloud/`,
at `api.kennelos.app`, and it is the only thing that can reach D1 and R2 (through its
bindings). The editions call it cross-origin with `fetch`, so it answers CORS preflights
and authenticates by bearer token, never a cookie (Safari blocks cross-site cookies). It is
a **Worker, not Cloudflare Pages**: Pages has no Cron Triggers, and §6.3's retention needs one.

- **Account:** a shared Cloudflare account under the KennelOS email address, owning the
  Worker, D1, R2 and the `kennelos.app` zone. A Worker Custom Domain needs its zone in the
  same account.
- **Deploy:** Cloudflare **Workers Builds**, connected to this repo with its **root directory
  set to `cloud/`** (it looks for `wrangler.toml` there, not at the repo root). That way no
  `CLOUDFLARE_API_TOKEN` is stored in GitHub. `deploy.yml` stays the editions' deploy and
  never touches `cloud/`.
- **Staging first:** a staging Worker with its own D1 and R2 runs on its free
  `*.workers.dev` address, so the server can be built and exercised before the domain is on
  Cloudflare. Production (§9 step 6) gets a separate D1 and R2 and the custom domain.
- **Plan tier:** staging fits the free tier. Production needs the $5/month Workers plan
  (Proposal §3): free-tier CPU (10 ms per request) and subrequest (50) limits are too small
  for 25 MB file uploads.
- **DNS:** when `kennelos.app` moves to Cloudflare DNS, the GitHub Pages records (`lite.`,
  `pro.`, `demo.`, `furever.`, and the apex's `A`/`AAAA`) stay **DNS-only (grey cloud)**, so
  GitHub keeps issuing their certificates.

### 6.1 API (all JSON; bearer token except `/auth/*` and `/notice`)

| Route | Does |
|---|---|
| `POST /auth/start {email}` | Emails a 6-digit code (valid 10 min) to the address in the request, then discards the address; only its keyed hash is kept (§6.2). Rate-limited per email hash and per IP. Always returns 200, so it can't be used to test which emails have accounts. |
| `POST /auth/verify {email, code, deviceLabel}` | Max 5 attempts per code. Looks the account up by email hash; creates the user + program on first sign-in. Returns `{token, programId, deviceId}`. |
| `POST /auth/signout` | Revokes this token. |
| `POST /auth/signout-others {email?, code?}` | Revokes every other session on the account ("Sign out other devices" on the Import/Export card). Needs a fresh sign-in (§2.5): a session under 15 minutes old, or `{email, code}` from `/auth/start`; else `403 reauth_required`. |
| `GET /program` | Program name, backing device (label + last push), latest snapshot meta. |
| `HEAD /files/:sha256` · `PUT /files/:sha256` · `GET /files/:sha256` | Upload-if-missing, answered from D1's `files` table (§6.2), not by asking R2. `PUT` streams the body straight into R2 with `put(key, body, { sha256 })`, so **R2 verifies the hash** and rejects a mismatch. The Worker never buffers or re-hashes the file itself, which would blow the CPU and memory limits at 25 MB. On success it writes the `files` row. 25 MB cap per file, checked against `Content-Length` before streaming. `GET` is for restore. |
| `POST /snapshots` | **Step one of two:** a small JSON description, `{base_snapshot_id, size, counts, files: [sha256…], edition}` (`edition`, `lite` or `pro`, since migration `0003`; anything else is stored as null). Refuses before any bytes move: a 409 per §3.4 (naming the backing device and its last push), or a 400 naming any referenced file the server doesn't have, checked in one query (§6.2). Returns `{snapshotId}`; the row is `pending`. |
| `PUT /snapshots/:id/body` | **Step two:** the gzipped envelope (`Content-Length` must equal the described `size`), streamed to R2. Commits only if the §3.4 rule still holds at that moment (one conditional batch), so two devices racing can't both win; the loser's row and object are removed and it gets the 409. An upload abandoned between the steps is removed by retention after a day. |
| `GET /snapshots` · `GET /snapshots/:id` | The history list and one snapshot. |
| `POST /program/backing-device` | Takeover (§3.4). |
| `DELETE /account {confirm: "DELETE", email?, code?}` | Deletes the account's rows, snapshots and files, and revokes tokens. Needs a fresh sign-in, as `signout-others`. |
| `POST /devices/check-in {licenseInstanceId}` | §2.5. Records this device's Pro activation id (or null) and refreshes `last_seen_at` and the sliding expiry. Returns `{ok, notices}`. |
| `GET /devices` | §2.5. `{devices: [{id, label, lastSeenAt, status, licenseInstanceId, erase, thisDevice, backing}]}`; `status` is `signed-in`, `signed-out` or `signed-out-here`; `erase` is `null` or `{requestedAt, confirmedAt}`. |
| `POST /devices/:id/erase {email?, code?}` | §2.5. Needs a session under 15 minutes old, or `{email, code}` from `/auth/start` (else `403 reauth_required`). Revokes that device's sessions (`revoked_reason = 'erase'`), records the erase, and clears the backing device if it was this one. `400 this_device` for the caller itself. |
| `DELETE /devices/:id/erase` | §2.5. Cancels an erase the device hasn't confirmed (`409 not_pending` otherwise). |
| `POST /devices/erase-ack {licenseReleased}` | §2.5. The one route an erased device's token may call. Marks the erase confirmed; `licenseReleased` clears its activation id. |
| `POST /devices/:id/license-released` | §2.5. Bookkeeping after the owner's browser released that device's activation with Lemon Squeezy. |
| `GET /notice` | Service notices (`{ level, message, until }`) for the sunset path (Proposal §2a). Public and cacheable. |
| `/ops/*` | The operator's page (§6.6). Same-origin HTML, behind `OPS_TOKEN`, never in the CORS allow-list. Service notices are added and removed here. |

**Maintenance answer.** While any migration is pending or drifted (§6.6), every API route
except `/ops`, `/notice` and `/health` returns **`503 {maintenance: true}`**. `cloudApi` treats it like
being offline: backup retries later and nothing is shown as an error. This covers the window
between a deploy and **Apply pending**, when the code is newer than the database. Breeders'
apps push in the background, so without this every sign-in or push in that window would
fail. The check compares the newest applied id with the newest bundled one, cached per
isolate.

### 6.2 D1 schema (sketch)
```
users(id, email_hash UNIQUE, created_at)
login_codes(email_hash, code_hash, expires_at, attempts)
sessions(token_hash PRIMARY KEY, user_id, device_id, device_label, created_at, last_seen_at, expires_at, revoked_at)
programs(id, owner_user_id, backing_device_id, latest_snapshot_id, created_at)
snapshots(id, program_id, device_id, created_at, size, counts_json, r2_key)
snapshot_files(snapshot_id, sha256)        -- for GC
files(program_id, sha256, size, created_at, PRIMARY KEY (program_id, sha256))
_migrations(id, name, applied_at, checksum) -- the runner's own table (§6.6)
-- 0002 adds:
snapshots + status ('pending' | 'committed'), base_snapshot_id, device_label
rate_limits(bucket, window_start, count)   -- per email hash / HMAC'd IP, per UTC hour
dev_outbox(id, email_hash, code, created_at) -- staging only, while no email provider exists
notices(id, level, message, until, created_at)
-- 0003 adds:
snapshots + edition ('lite' | 'pro' | NULL)  -- named in a 409's backingDevice (Lite → Pro, §4.5)
-- 0004 adds (§2.5):
sessions + revoked_reason ('self' | 'others' | 'erase' | NULL), license_instance_id
device_erasures(user_id, device_id, device_label, requested_at, confirmed_at, PRIMARY KEY (user_id, device_id))
```
- **An erased device's token** answers `401 device_erased` on every route, checked before
  revoked and expired (the erase revokes it, and a phone that stays away past its expiry
  must still hear it). Retention keeps a device's sessions for as long as its erase is
  pending, and drops a confirmed erase after 30 days.
- **Rate limits:** 5 codes an hour per address and 30 an hour per IP. The limit applies to
  any address, so a 429 says nothing about whether an account exists. The IP is HMAC'd
  like the email, never stored as-is.
- **Codes on staging:** with no email provider connected, staging sets `DEV_OUTBOX = "1"`
  and the code is shown on `/ops` instead of emailed, keyed by the email hash, never the
  address. Production never sets it, and with no provider it refuses sign-in (503
  `email_unavailable`) rather than pretending a code was sent.
- **`files` is the R2 index.** Upload-if-missing, the snapshot's reference check and the
  retention GC all read it instead of calling R2 per file. One R2 call per file would exceed
  the free tier's 50 subrequests on a program with a real document library, and would be slow
  on any tier.
- **D1 allows about 100 bound parameters per query**, and the local test shim (node:sqlite)
  doesn't enforce that, so a test would never catch it. A list of sha256s is therefore never
  bound as `IN (?, ?, …)`: it goes in as **one JSON parameter** read through
  `json_each(?)`, and multi-row inserts are a `db.batch()` of single-row statements.
- **Hashing:** tokens and codes are stored hashed (SHA-256), never in plain text.
- **Email hash:** `email_hash = HMAC-SHA256(server secret, normalized email)`, where
  normalized means trimmed and lower-cased. The secret lives in a Worker secret, not in D1,
  so a leaked database can't be reversed by hashing a list of known emails. The readable
  address is never written to D1, R2, or logs. (Rotating that secret would orphan every
  account, so it's treated like a root key: set once, backed up offline.)
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
  A daily cron (03:17 UTC) prunes snapshots, then deletes files no retained snapshot
  references. A file gets a day's grace, so one uploaded just before its snapshot is
  committed is never collected. The same run clears abandoned uploads, expired codes,
  old rate-limit windows, outbox rows and dead sessions. D1 rows go before R2 objects, so a
  failure leaves unreferenced objects, never rows pointing at nothing.
- **The cron is a backstop, never the only path.** Cron Triggers run in UTC and are not
  retried if a run fails, so the prune is idempotent: it recomputes what to keep from the
  stored rows on every run, and a missed day just leaves more to delete next time. `/ops`
  has a **Run retention now** button (§6.6), because a cron can't be fired from a browser.
- **Recovery, honestly:** D1 Time Travel (30 days) exists, but as far as we know it's run
  from the CLI/API, not a dashboard button. Check that before relying on it. **R2 has no
  time travel at all**, so rolling D1 back would leave snapshot rows pointing at objects the
  prune has already deleted. The real recovery path is `/ops`'s **export/import of the D1
  metadata** (§6.6). The breeders' own devices remain the primary copy of their data either
  way; the cloud is the backup.

### 6.4 Security & privacy posture
- **What the server holds** is the cloud tier only (§5), plus a keyed hash of the account
  email (§6.2), not the address itself. There are no buyer phone numbers, addresses, or
  payments. Since §5.1, it does hold the breeder's own waitlist settings (including the fee
  she charges and her payment instructions) and waitlist applicants' **names and emails**,
  and nothing else from their applications. This posture is pinned on the client by
  `assertSnapshotKeys`. The server doesn't parse record contents at all; it stores the blob.
- **CORS:** only the origins that actually run Lite and Pro, per `build/README.md`'s deploy
  map: `https://lite.kennelos.app`, `https://pro.kennelos.app`, plus `localhost` for dev.
  The apex `kennelos.app` is the marketing site and makes no API calls.
  Demo is excluded (`cloudUrl: null`). The list is read from one shared editions-origins
  constant that the Worker and the build both use, so a domain change can't leave the API
  blocking an edition.
- **Lost devices (§2.5).** The server holds each Pro device's Lemon Squeezy activation id.
  It isn't a secret: releasing one also needs the license key, which never reaches the
  server. Erasing a device, signing out the others and deleting the account need a fresh
  sign-in, so a stolen phone that is still signed in can't do any of them.
- **No request bodies in logs, and never an email address.** `[observability]` is on (it is
  the only place the operator can see why something failed), so the code never
  `console.log`s an email, a code, a token or a body. Cloudflare encrypts R2 and D1 at rest.
- **Privacy policy page** on `site/` before launch. It covers what's stored (§5's table in
  plain English), retention (30 days), how to delete, and what happens on shutdown.

### 6.5 Email (decided: Resend)
Sign-in codes are sent through **Resend**'s HTTP API from `signin@kennelos.app`, plain text,
with no links or tracking. That's its only use. It's the one third-party dependency.
- **Setup:** the `kennelos.app` domain is verified in Resend; its records (DKIM, plus SPF and
  bounce MX on the `send.` subdomain) and a `_dmarc` TXT record live in Cloudflare DNS. The API
  key is a Worker secret, `RESEND_API_KEY`, with sending access only, restricted to that domain.
- **Privacy:** Resend sees each recipient address for the send it makes. The privacy policy names
  it. Its log retention is checked and kept as short as the account allows.
- **Failure:** a send Resend refuses is a `502 email_failed` to the app, and the log records
  Resend's status code, never the address.
- **Staging before the key:** `DEV_OUTBOX` puts codes on `/ops` (§6.2). Production has neither
  the outbox nor, until the key is set, any way to send, so sign-in answers 503.

### 6.6 Operations from the browser (`/ops`)
**Constraint:** no step in setup, migration, or recovery needs a terminal. This is the same
rule MCCE and Heritage Hooves run on, and the runner is ported from MCCE (`src/migrate.js`,
`src/lib/sql.js`), not Heritage Hooves, whose splitter breaks on a `;` inside a string and
whose page is open to anyone until the first account exists.

- **Access:** a Worker secret, `OPS_TOKEN`, entered on `/ops` and held in a short-lived,
  same-origin cookie. `/ops` refuses everything until the secret is set: it never falls
  open. Breeder accounts have no admin role and never reach it.
- **Migrations:** `.sql` files in `cloud/migrations/`, bundled as text by a `[[rules]]` entry
  whose glob must be `**/*.sql` (wrangler matches the import string, so
  `migrations/*.sql` misses). A `_migrations` table records id, name, applied_at and a
  checksum, and the page lists each migration as **applied / pending / drifted /
  orphaned**. Drift is shown and never fixed automatically. **Apply pending** runs each
  migration's split statements plus its tracking row as one `db.batch()`, so a migration
  lands whole or not at all. It halts on the first failure and prints the error with the
  numbered statements, because D1 doesn't say which statement failed. `db.exec()` is never
  used: it needs one statement per line.
- **While anything is pending or drifted,** the page shows only the migration table and
  Apply pending, and the API answers 503 (§6.1).
- **Migration rules:**
  - pre-launch, `0001` may be squashed and edited on staging;
  - from the first real sign-in on production, files are **forward-only, additive**, and an
    applied file is never edited;
  - `PRAGMA foreign_keys=OFF` is a no-op inside a batch and D1 enforces foreign keys, so
    rebuilding a table that something references means moving the child table out first
    (Heritage Hooves migration `0064`);
  - keep `LIKE`/`GLOB` patterns under 50 characters (MCCE §4).
- **Also on the page:** a health check (D1 and R2 bound, row counts, schema version,
  orphaned R2 keys), **Run retention now**, and **export/import of the D1 metadata** (the
  import fills only an empty database). Every destructive control has a restore beside it.
- **Tests:** `node --test` with MCCE's node:sqlite D1 shim, matching the repo's existing
  runner, so there's no vitest dependency. The shim doesn't enforce D1's limits (§6.2), so
  those rules are kept by design and code review, not by tests.

### 6.7 What the operator sets up in the dashboard (once per environment)
1. The shared Cloudflare account under the KennelOS email address, with each maintainer
   invited as a member.
2. A D1 database and an R2 bucket (staging: `kennelos-api-staging` /
   `kennelos-files-staging`; production without the suffix). The D1 `database_id` goes into
   `cloud/wrangler.toml`.
3. The Worker via **Workers Builds**, connected to this repo, root directory `cloud/`.
4. Two secrets under the Worker's **Settings → Variables and Secrets**:
   - `OPS_TOKEN`;
   - `EMAIL_HMAC_KEY` (§6.2). A Cloudflare secret can't be read back after it's saved, so
     this one is generated first, stored in the password manager, then pasted in.
     Production's key is permanent.
5. Resend: the domain verified (its DNS records added in Cloudflare), and its API key as a
   third secret, `RESEND_API_KEY`.
6. Production only: the `kennelos.app` zone on Cloudflare DNS (GitHub Pages records
   DNS-only), the `api.kennelos.app` Custom Domain on the Worker, and the Workers Paid plan.

## 7. Editions & build wiring
- **`editionConfig` gains `cloudUrl`:**
  - `lite/` and `pro/`: `https://api.kennelos.app`;
  - `demo/`: `null`;
  - `shared/` (the default): `null`.
  This keeps the shared core inert. A local-dev override lives in `editionConfig` too, and
  it's how a dev build points at the staging Worker's `*.workers.dev` address (§6).
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
3. **`cloud/` Worker**, in two PRs (both built; staging is live):
   - **3a, the skeleton:** `wrangler.toml`, the router, CORS, `/ops` with the ported
     migration runner, health check, and `0001` (§6.2).
   - **3b, the API:** auth, snapshots, files, notice, the 503 maintenance answer, the
     retention cron plus Run retention now, and the D1 export/import.

   Tests run on `node --test` with the node:sqlite D1 shim (§6.6). Staging is deployed to its
   `*.workers.dev` address by Workers Builds after the operator's dashboard steps 1–4 (§6.7).
   This can run in parallel with steps 1–2.
4. **Client cloud modules** (`cloudConfig`, `cloudApi`, `cloudAuth`, `cloudBackup`) against
   staging.
5. **UI:** the Import/Export card, first-run offer and restore-on-new-device, the Today nudge,
   and the 409/takeover and shrink-guard dialogs. Browser-verified in Lite and Pro, plus the
   Demo/no-server checks.
6. **Docs (§8), privacy policy page, `PRECACHE_URLS`, and the SW bump** (asked first). Then
   production: dashboard step 6 (§6.7), Apply pending on production's `/ops`, then the
   editions deploy with `cloudUrl` set.
   **As built (2026-10-07):** the §8 docs (CLAUDE.md, the Editions Plan's tier table, the
   End-State guide's §1, §2, §16 and new §30; the plan said "§29", which the waitlist took),
   the production Worker as `[env.production]` in `cloud/wrangler.toml` (pinned by
   `cloud/tests/config.test.js`), the operator's steps as `docs/LAUNCH_CHECKLIST.md` §3a, and
   the SW bump to `kennelos-shell-v41`. Decided with the owner: the go-live is **one
   separate change**, merged only after production's `/ops` shows no pending migration. It
   sets `cloudUrl: 'https://api.kennelos.app'` in Lite and Pro, rewrites the marketing
   site's "no accounts, no cloud, no server" claims, and adds the privacy policy page
   (`site/privacy.html`, operator "KennelOS", contact admin.kennelos@gmail.com), so the
   site never describes a service that isn't live.
   **The go-live change (2026-10-07):** `cloudUrl: 'https://api.kennelos.app'` in `lite/` and
   `pro/editionConfig.js`; the marketing site rewritten ("No account needed" in every
   footer; Home, About, Compare, FAQ, Lite, Pro and Upgrade describe the optional backup and
   what it never holds; FAQ gains "What if my phone is lost or stolen?"); the new
   `site/privacy.html` (linked from every footer and About, in the sitemap); the guided
   tour's Import/Export step no longer says "there's no cloud storage" where there is one
   (`cloudBody`, picked by `wizardUI`); SW cache `kennelos-shell-v42`.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| A private field leaks to the server via a new field | Rule zero (unlisted = private), the coverage test, and `assertSnapshotKeys` at upload |
| A wiped or half-empty device overwrites a good backup | Shrink guard, Reset App disabling backup, 30-day history |
| A second device clobbers the first | One backing device, with 409 → explicit choice |
| iPhone PWA / Safari storage split breaks sign-in | Typed code, not a link |
| Email codes land in spam | SPF/DKIM on kennelos.app; "Didn't get it? Resend / check spam" |
| A phone is lost or stolen with the app signed in | Erase it from another device (§2.5): lands when it next opens the app online; the phone's own Find My is the real protection |
| A lost Pro device holds a license slot | Free its Pro license from another device or from the activation wall (§2.5) |
| A breach exposes breeders' email addresses | Only a keyed hash is stored (§6.2); the address is used per send and discarded |
| A user who stopped opening the app misses a shutdown notice | Their data is local and untouched; the notice shows the next time they open the app |
| We stop hosting | `cloudUrl: null` release, local data untouched, file backups still there (Proposal §2a) |
| Large document libraries are slow on first backup | Content-addressed, upload-once files; progress bar; resumable because each file is independent |
| A deploy lands before its migration is applied | API answers 503 maintenance until Apply pending (§6.1); the client retries quietly |
| A per-file R2 call or an `IN (…)` list hits a D1/Workers limit that tests can't see | D1 `files` index and `json_each` (§6.2) |
| The operator can't recover without a terminal | Everything on `/ops`, with export/import beside every destructive control (§6.6) |

## 11. Questions this plan raises
1. **Email provider:** decided: Resend (§6.5).
2. **API domain:** decided 2026-10-07: `api.kennelos.app`. (The owning account: a shared
   Cloudflare account under the KennelOS email address; see §6.)
3. **Free-tier limits:** cap Lite cloud storage (e.g., 1 GB of documents)? Cost at Lite's
   6-dog / 2-litter size is negligible, but a cap protects against abuse.
4. **Retention:** is 30 days right? Longer costs little for the JSON; files dominate.
5. **Who runs it:** still open (Proposal §10). Phase 1 is low-maintenance (no live sync),
   but somebody gets the email if the Worker errors.
6. **A stolen phone that is still signed in:** decided 2026-10-07: **Sign out other
   devices** and **Delete my cloud data** need a fresh sign-in, like Erase (§2.5).
