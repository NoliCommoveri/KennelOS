# KennelOS Cloud — Phase 2 build plan: live multi-device sync (DRAFT)

> Parent design: `docs/KennelOS_Cloud_Accounts_Proposal.md` §5 ("Sync model") and §9 Phase 2
> (cited as "Proposal §N").
> Builds on: `docs/KennelOS_Cloud_Phase1_Plan.md` ("Phase 1 §N"), the private vault
> (`docs/KennelOS_Private_Vault_Plan.md`, "Vault §N"), the Pro license link
> (`docs/KennelOS_License_Link_Plan.md`) and the waitlist online (`docs/KennelOS_Waitlist_W2_Plan.md`,
> "W2 §N").
> **Status: being built.** The §12 decisions were all taken as recommended (2026-10-10), and
> JSON backups stay backward compatible throughout (`CLAUDE.md`). Progress is under §8.
> The server migration is **`0014_sync`**, not `0012` as first drafted (`0012` and `0013`
> went to changing and recovering the account's email).

## 1. Scope

**The goal (Proposal §9):** the same person's phone and laptop stay in step. An edit on one
shows up on the other within a minute while both are online, and an edit made offline
arrives when the device reconnects. No more "one backup device" (Phase 1 §3.4) for a
program that syncs.

**In Phase 2:**
- **Pro only** (Proposal §10, decided: "Pro's paid additions are multi-device live sync,
  team members, transfers, and linked dogs"). Lite keeps Phase 1 backup and the vault,
  unchanged. Demo gets nothing. `cloudUrl: null` makes no request, as everywhere.
- **Opt-in per program**, on top of cloud backup: **Keep my devices in step**, offered once
  backup and Sensitive records are on (§12 decision 1).
- **Every table that rides the JSON backup syncs**, both tiers: the cloud tier readable as
  today, and the whole row encrypted with the vault key (§4), so prices, contacts' details
  and Financials stay in step too.
- **Files** (documents, receipts) sync through the existing content-addressed `/files`
  store.
- **Snapshots, history and "Restore as of…" keep working**, made by any device that's
  caught up (§6.4), so the 30-day undo still covers a mistake that has already synced
  everywhere (Proposal §5).
- **The waitlist online** keeps one device at a time doing its server work, by a short lease
  instead of the backing device (§7).

**Not in Phase 2:** other people (teams and roles are Phase 3; one account, one person, many
devices here), per-field merging (Proposal §5 calls it "a possible later refinement"),
syncing device settings in `localStorage` (they don't ride the JSON backup either; §3.6),
KennelAssistant's retirement (Phase 3), transfers and connections (Phase 4).

## 2. What the user sees

### 2.1 Turning it on
- **Where:** the Cloud card on Import / Export (`assets/cloudBackupUI.js`), Pro only, under
  Sensitive records: **Keep my devices in step: Off ▾**, with **Turn on…**.
- **Needs:** signed in, backup on and not paused, Sensitive records on and unlocked here,
  and Pro on this account (the license link's `requirePro`). Anything missing is named,
  with its fix ("Turn on Sensitive records first").
- **The first device** uploads every record (§6.2) behind a progress bar ("Getting your
  records ready to sync: 1,240 of 3,100"). This device becomes the program's starting point;
  the backing-device rule stops applying to this program (§6.4).
- **Every other device** signs in and unlocks Sensitive records as today (passkey, recovery
  code, or another device, Vault §2.3–§2.4). If the program syncs, that device is offered
  **Keep this device in step** instead of the Phase 1 choice between "restore that backup"
  and "replace it" (Phase 1 §3.4). Accepting merges: the server's records come down, newer
  wins per record (§5.3), and this device's records the server doesn't have go up. Nothing
  is deleted on either side.

### 2.2 While it's on
- **The status line** reads "In step · 2 devices · synced a minute ago" (or "3 changes
  waiting: offline"). The device list (Phase 1 §2.5) gains "last synced" per device.
- **Edits made here** go up about 10 seconds after the last change (§5.1), at once when the
  page is hidden or closed.
- **Edits made elsewhere** come down when the app opens, when it comes back to the front,
  every 60 seconds while it's open and visible, and straight after each push (§5.2). A
  later step adds a server nudge so it's seconds rather than a minute (§8, step 7).
- **An open page whose record changed underneath it** shows a one-line notice ("Updated on
  Jen's laptop. Reload to see it") instead of silently re-rendering under her hands. Lists
  and Today refresh on their own.
- **Offline** is unchanged: everything works, and changes wait their turn.

### 2.3 When two devices change the same record
Rare for one person (Proposal §5), and handled without asking: **the change the server
receives last wins, for the whole record** (§12 decision 3). The overwritten version is not
lost: it's in that day's snapshots, so "Restore as of…" brings it back, and the activity
list on Import / Export notes "Kept the version from Jen's laptop for Birch (yours was
older)" for the past 30 days. Deleting is softer still: a hard delete that arrives on a
device where something now points at the record becomes an archive (§5.4).

### 2.4 Turning it off
**Turn off on this device** stops syncing here; the device keeps its records and goes back to
being an ordinary backup device, which means the Phase 1 one-backup-device rule applies
again if it pushes. **Turn off for every device** (typed confirm) stops sync for the
program: the server keeps the records for 30 days (so turning it back on is quick) and then
deletes them; snapshots carry on as in Phase 1. A lapsed Pro license pauses sync with
"Renew Pro to keep your devices in step" and leaves every device's records alone (§12
decision 6).

## 3. Client design (`shared/`)

### 3.1 New modules

| File | Role |
|---|---|
| `data/cloud/syncRecords.js` | Pure. Builds the wire form of one record (§4.1) from a Dexie row: the cloud part through `syncRegistry.projectRow` / `keepsRow`, the sealed part through `vaultCrypto`. Reads the wire form back into a local row. Hashes a row for change detection (§3.3). No db, no network; unit-tested. |
| `data/cloud/syncState.js` | The device-only `sync_meta` table (§3.4): the server seq of each record this device last saw, and the hash it had then. The only reader/writer of that table. |
| `data/cloud/cloudSync.js` | The flows: `enableSync()`, `joinSync()`, `syncNow()` (push, then pull), `pullChanges()`, `disableSync()`, `syncStatus()`, and the scheduler (§5). Network only through `cloudApi`; local writes for pulled records through `syncApply.js`. Every entry point checks `isCloudAvailable()` and `editionFlags.liveSync` first. |
| `data/syncApply.js` | Writes pulled records into Dexie in one transaction per page (§5.3, §5.4). Lives in `data/` beside `importExport.js` because it's a direct writer of every table: it calls no repo (pulled rows keep their own `updated_at`) and does **not** call `markDataChanged()` for pulled rows, since they mustn't go back up (listed in `tests/cloudDirty.test.js`'s exemptions with that reason). |
| `assets/cloudSyncUI.js` | §2's card section, status line, join prompt and "updated elsewhere" notice. Imported dynamically from `cloudBackupUI.js` only when the edition has a server and `editionFlags.liveSync` is on. Pro-only behavior, but not a Pro page: it isn't in `proPages.js`, because the flag (not file absence) gates it, the way the waitlist card does. |

`cloudApi.js` gains the `/sync/*` calls (§6.1). `cloudBackup.js` changes in two places: a
syncing program's snapshot push uses the caught-up rule instead of the backing device (§6.4),
and its 5-minute scheduler leaves pushing records to `cloudSync`.

### 3.2 Edition wiring
- New flag **`editionFlags.liveSync`**: `true` in Pro, absent (false) in Lite and Demo. The
  every-flag-declared test (`tests/editionConfig.test.js`) gains it.
- The server checks Pro itself (`requirePro` on every `/sync` route), so a Lite build that
  somehow called it gets `403 pro_required`.

### 3.3 Knowing what changed: a scan, not an outbox (§12 decision 2)
Proposal §5 sketched a `sync_outbox` table appended to by every repo write. This plan
recommends a **scan** instead, because every write already ends in `markDataChanged()`
(Phase 1 §3.2), but not every write goes through a repo:
- **When the dirty flag is set**, `cloudSync` reads every syncing table (as
  `exportAll({ encodeBlobs: false })` already does for each backup push), hashes each row
  (`syncRecords.rowHash`, SHA-256 of its canonical JSON) and compares with `sync_meta`:
  - a row whose hash differs, or that `sync_meta` doesn't know, is a **put**;
  - a `sync_meta` entry whose row is gone is a **delete** (a hard delete, or a row removed by
    a replace-restore).
- **Why a scan:** it catches every writer, including `restoreBackup` (file restore, cloud
  merge, vault merge), `assistantSync`, `fileRepo` and `expenseRepo`, with no hook to forget.
  An outbox would need one in each, and a missed hook silently stops a record syncing, the
  failure Phase 1's dirty-signal test exists to prevent. Repeated edits to one record
  collapse into one push for free.
- **Cost:** a large Pro program is a few thousand rows; hashing them is tens of milliseconds,
  and it runs only after a change, debounced (§5.1). Files are hashed by their stored
  `sha256` (a `files` row gains it on first sync, cached like the push's `shaCache`), never
  by re-reading the blob each time.

### 3.4 Device-only state
- **`sync_meta`** (new Dexie table, `'[tbl+id], seq'`): `{ tbl, id, seq, hash }` per synced
  record. Like `device_secrets` it is **never** in `exportAll`, a file or Dropbox backup, a
  snapshot, the sample-data manifest or a re-seed, and Reset App and remote erase clear it.
  `referenceRegistry` and `syncRegistry` gain no entry for it; `tests/syncRegistry.test.js`'s
  "every table has an entry" list exempts device-only tables by name.
- **`cloudSyncState`** (settings key, through `settings.js`): `{ enabled, cursor, lastPushAt,
  lastPullAt, lastError, pending }`. `cursor` is the highest server seq this device has
  applied.
- **Schema version (§12 decision 4):** `sync_meta` is the first table added since real users
  started keeping records in production (2026-10-07). This plan recommends it go in a new
  additive **`db.version(2)`** block, the first one, and that `version(1)` be frozen from then
  on, as `CLAUDE.md` says happens "at the first real release".

### 3.5 Sample data and the guided tour
Sample rows never sync, as they're never backed up (Phase 1 §4.1): the scan skips rows in the
sample-data manifest, and clearing sample data sends no deletes (they were never sent). The
Pro tour's seed on a syncing device stays on that device.

### 3.6 What doesn't sync
- **Device settings** in `localStorage` (nav state, dashboard choices, mileage defaults, the
  Dropbox link, the waitlist-online state, the cloud session itself). None of them ride the
  JSON backup either. If one turns out to be kennel-level (something she'd expect on every
  device), it moves into a table, the usual way, as its own change.
- **`device_secrets`, `sync_meta`**: device-only by design.
- **Lite devices** on a syncing program: a Lite device can't sync. Its backup push gets the
  409, and it shows the existing "Your records moved to KennelOS Pro" state (Editions Plan,
  "The Lite device afterwards"), which already fits.

## 4. Record format

### 4.1 One record on the wire
```
{ tbl: 'dogs', id: '…uuid…', op: 'put' | 'delete',
  base_seq: 1203,                    // the server seq this device last saw for it (0 = new)
  cloud: { …allow-listed fields… } | null,
  sealed: '<base64 v1 envelope>' | null,
  key_id: 'vault key id' | null,
  updated_at: '…' }                  // the row's own, carried for display only
```
- **`cloud`** is exactly the row the Phase 1 snapshot would hold (`syncRegistry.projectRow`,
  checked by `assertCloudRow` before upload). `null` when the row rule keeps nothing
  (`expenses`, `accounts`, contract/other documents and their files).
- **`sealed`** is the **whole row**, JSON, encrypted with the vault key: AES-GCM, a fresh
  random IV, the same `{ v, key_id, iv, ciphertext }` shape as the vault payload (Vault §4.1).
  Whole rows, not the private complement, for the reason Vault §10 decision 1 gives: the
  complement would have to track `syncRegistry.js` forever, and any drift loses data.
- **`files` rows** carry `sha256` in `cloud` (cloud-tier files) or inside `sealed` (private
  files, whose blob is the deterministic vault encryption of Vault §4.2). The blob itself
  goes through `HEAD/PUT /files/:sha256` first, exactly as a backup push does, so an
  unchanged document is never re-uploaded.
- **A record whose classification depends on another** (a file is cloud only while a
  cloud-type document points at it, Phase 1 §5) is re-sent when that changes: the scan
  includes the derived classification in the hash input.
- **Size:** a record over 1 MB on the wire is refused by the server (`413 record_too_large`)
  and shown as a sync error naming it. The one realistic case is a kennel's
  `logo_data_url`; the logo picker already downscales, and this plan checks its ceiling in
  step 1.

### 4.2 What the server can read
The same cloud tier it already holds in every snapshot (Phase 1 §6.4), now as rows instead
of a file, plus ciphertext it can't open. No new readable field. The posture test
(`tests/syncRegistry.test.js`) gains a case: every `cloud` part `syncRecords` builds over the
sample packet passes `assertCloudRow`, and no `sealed` part decrypts without the key.

### 4.3 The vault key and sync
- **Sync needs the vault unlocked** on each syncing device (§12 decision 1). A device that is
  signed in but locked (restored with "Not now") pauses sync with "Unlock Sensitive records to
  keep this device in step", like the push pause of Vault §3.4. It never sends a record
  without its sealed part, and the server refuses one (`409 vault_required`) while the
  program's vault is on, so a stale client can't strip it.
- **A re-keyed vault** (turned off and on, Vault §2.5): every record's `key_id` goes stale.
  The device that re-keys re-seals and re-sends every record (the same path as §6.2); other
  devices see `vault_key_stale` and unlock with the new key. Turning the vault **off** turns
  sync off for the program, with a confirm saying so.

## 5. The sync loop (`cloudSync.js`)

### 5.1 Push
1. Debounce: 10 seconds after the latest `markDataChanged()`, at once on `visibilitychange`
   to hidden and on `pagehide` (best effort), and at most once every 5 seconds.
2. Scan (§3.3) → changed records. Upload any new file blobs.
3. `POST /sync/push` in pages of 200 records or 2 MB.
4. For each accepted record, write its new `seq` and hash to `sync_meta`. Clear the dirty
   flag only if nothing changed since the scan started (`clearCloudDirty(ifAt)`, as now).
5. Then pull (§5.2), so this device sees anything that arrived meanwhile.

One push at a time across tabs, through `navigator.locks` (`kennelos-cloud-sync`), the way
`pushIfDirty` already serializes.

### 5.2 Pull
`GET /sync/pull?since=<cursor>&limit=500` until `more` is false. Each page is applied in one
Dexie transaction (§5.3), then `cursor` moves to the page's last seq. A page that fails to
apply leaves the cursor where it was, so the next pull retries it. When: on start-up,
`visibilitychange` to visible, every 60 seconds while visible, and after each push. A cheap
`GET /sync/head` (`{ seq }`) lets the 60-second poll skip the pull when nothing changed.

### 5.3 Applying a pulled record (`syncApply.js`)
- **Its own echo** (a record this device pushed, same seq as `sync_meta`): skipped.
- **A put:** decrypt `sealed` → the whole row. If the local row has **unpushed changes** (its
  hash differs from `sync_meta`'s), the server's version still wins (§2.3), the local version
  is noted in the activity list, and the local edit is dropped. Otherwise the row is written
  as received. `sync_meta` takes the record's seq and the new row's hash, so the scan won't
  push it back.
- **Applied in table order with FKs first** (kennels, contacts, dogs, then the rest), inside
  one transaction per page, so a page never leaves a dangling reference for longer than the
  page. Dexie doesn't enforce FKs, so order only matters for anything reading mid-page; the
  transaction hides that anyway.
- **Pulled rows bypass the repos:** they keep their own `updated_at` and `created_at`, and no
  Lite cap hook runs (sync is Pro only; Pro's hooks are no-ops). `assertWritable()` is
  irrelevant: Demo never syncs.
- **Events to pages:** after a page is applied, a new `SYNC_APPLIED_EVENT` fires with the
  tables and ids touched, which drives §2.2's list refresh and "updated elsewhere" notice.
  It is deliberately not `CLOUD_DATA_CHANGED_EVENT` (`settings.js`), the local-write signal,
  so a pulled change never looks like an edit to the backup or waitlist schedulers. (The
  waitlist lease holder, §7, also listens for it, since a pulled change can alter what it
  publishes.)

### 5.4 Deletes
- A hard delete pushes `op: 'delete'`; the server keeps a **tombstone** (§6.2).
- **On a receiving device**, the registry check runs again (`findBlockingReferences`): if
  something there now points at the record (another device added a litter for that dog in
  the meantime), the delete becomes an **archive** of the local row, which is then pushed as a
  normal put. Proposal §5's "the registry-driven reference check still runs locally first"
  covers the sender; this covers the race.
- **Archive** is just an update and syncs like one.

### 5.5 Joining and catching up
- **Join (§2.1):** pull everything (`since=0`), applying with "newer `updated_at` wins" for
  rows this device already has (the `'merge'` rule a vault restore uses, Vault §4.4), then
  push whatever is left that the server doesn't have. Only the join uses `updated_at`; after
  that, server order decides (§12 decision 3).
- **A faster first pull** (later, if pulls of large programs are slow): start from the latest
  snapshot, which records the seq it was made at (§6.4), and pull only after it.
- **Too far behind:** tombstones are kept 90 days (§6.3). A device whose cursor is older than
  the oldest kept tombstone gets `410 resync_required` and re-joins (a full pull, then a
  delete of any local row the server has never had and no `sync_meta` entry vouches for, after
  a confirm naming how many).

## 6. Server (`cloud/`)

### 6.1 API (bearer token; `requirePro`; behind the maintenance gate)

| Route | Does |
|---|---|
| `POST /sync/enable` | Turns sync on for the program (`programs.sync_enabled_at`). `409 vault_required` without a vault. The caller then uploads with `/sync/push`. |
| `DELETE /sync {email?, code?}` | Turns it off for every device. Needs a fresh sign-in (as `signout-others`). Records are deleted after 30 days (§6.3). |
| `POST /sync/push {records: […]}` | Validates each record (size, `tbl` in a known list, `cloud` keys against the server's copy of the allow-list, `key_id` = the vault's current key), then in **one D1 batch** bumps `programs.sync_seq` by the count and upserts each record with its new seq. Returns `{ seq, accepted: [{ tbl, id, seq }], superseded: [{ tbl, id, seq }] }`, where `superseded` lists records whose `base_seq` was older than the server's (accepted anyway; the client notes it, §2.3). |
| `GET /sync/pull?since=&limit=` | Records (and tombstones) with `seq > since` in seq order: `{ records, seq, more }`. `410 resync_required` when `since` is older than the tombstone horizon. |
| `GET /sync/head` | `{ seq }` for the poll. Cheap: one indexed read. |
| `POST /sync/cursor {seq}` | Records this device's applied cursor (`sync_devices`), for the device list and the tombstone horizon. Sent after each pull, at most once a minute. |

**Why a server allow-list check:** the client already refuses to send a non-cloud key
(`assertCloudRow`). The server keeps a generated copy of the cloud field names
(`cloud/src/lib/cloudFields.js`, built from `shared/data/syncRegistry.js` by a test that fails
when they differ) and drops any record that carries another key in `cloud`, so a buggy or old
client can't widen what the server holds.

### 6.2 Migration `0014_sync.sql` (additive; its line in `cloud/src/migrations/index.js`)
```sql
ALTER TABLE programs ADD COLUMN sync_enabled_at TEXT;
ALTER TABLE programs ADD COLUMN sync_seq INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS sync_records (
  program_id  TEXT NOT NULL REFERENCES programs(id),
  tbl         TEXT NOT NULL,
  id          TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  cloud_json  TEXT,            -- the cloud tier (readable, allow-listed)
  sealed      TEXT,            -- base64 vault envelope of the whole row
  key_id      TEXT,
  device_id   TEXT NOT NULL,   -- who sent this version
  received_at TEXT NOT NULL,
  PRIMARY KEY (program_id, tbl, id)
);
CREATE INDEX IF NOT EXISTS idx_sync_records_seq ON sync_records (program_id, seq);
CREATE TABLE IF NOT EXISTS sync_devices (
  program_id  TEXT NOT NULL REFERENCES programs(id),
  device_id   TEXT NOT NULL,
  cursor_seq  INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT NOT NULL,
  PRIMARY KEY (program_id, device_id)
);
ALTER TABLE snapshots ADD COLUMN sync_seq INTEGER;  -- the seq a caught-up device made it at
```
- **One row per record**, not a change log: the latest version is all a pull needs, and a
  record's history is what snapshots are for. A delete keeps the row with `deleted = 1` and
  the payloads nulled (the tombstone).
- **D1, not a Durable Object, holds the records (§12 decision 5).** Proposal §3 sketched a
  Durable Object per program. D1 does the job at this scale: writes to one database are
  serialized, a batch is one transaction, so `sync_seq` can't hand out the same number twice.
  It also keeps one migration runner, one `/ops` export and the node:sqlite test shim the
  server already has. A Durable Object arrives only for the live nudge (step 7), and holds
  no data.
- **D1's parameter limit** (about 100 bound parameters, Phase 1 §6.2): a push upserts with a
  `db.batch()` of single-row statements, never a multi-row insert.

### 6.3 Retention, account deletion, `/ops`
- **Tombstones** older than 90 days are deleted by the daily retention run, and the horizon
  (the oldest kept tombstone's seq) is what `410 resync_required` checks.
- **Sync turned off:** the program's `sync_records` and `sync_devices` go after 30 days.
- **Account deletion** removes both tables' rows with everything else.
- **`/ops`:** counts only ("programs syncing: N, records: N, pushes in the last hour: N").
  Never a record, a payload or a key. The D1 export skips `sync_records` (the snapshots in R2
  are the recovery copy, Phase 1 §6.3) but includes `sync_devices`.
- **Rate limits:** `limitBucket` per program: 1,200 sync calls an hour, plus the body caps of
  §5.1.

### 6.4 Snapshots and the backing device, for a syncing program
- **Who pushes snapshots:** any syncing device that is **caught up** (its cursor equals
  `sync_seq` and it has nothing waiting) on the existing hourly-at-most cadence. The server's
  `canPush` (`cloud/src/snapshots.js`) gains a second rule: for a program with
  `sync_enabled_at`, accept a snapshot from any of the program's devices whose
  `base_snapshot_id` is the latest **and** whose stated `sync_seq` equals the program's.
  Otherwise the Phase 1 backing-device rule applies, unchanged.
- **`backing_device_id`** stays in place for Lite programs and for a program that turns sync
  off; a syncing program ignores it.
- **"Restore as of…"** works as now: it's local writes, which the next scan pushes as
  ordinary changes, so every device rolls back with it. Its confirm screen says so ("This
  rolls back your other devices too").

## 7. The waitlist online on a syncing program

Today the server accepts waitlist writes (projection publish, inbox ack, events) only from
the backing device (`cloud/src/waitlist.js`, W2 §11 step 1). On a syncing program there is
no backing device, and two devices doing that work at once would take in the same
application twice or answer the same family event twice. So:
- **A lease:** `POST /waitlist/lease` grants the calling device the program's waitlist work
  for 2 minutes, renewed on each publish or poll while it's open; another device gets
  `409 lease_held` with the holder's label and expiry. The device in front of her (open,
  visible) takes it; one in a background tab lets it lapse.
- **Routes:** the backing-device check in `waitlist.js` becomes "holds the lease" for a
  syncing program, and stays "is the backing device" otherwise.
- **The work itself is unchanged:** the lease holder takes in applications, applies family
  and server events and publishes the projection, all through repos, so the results reach
  her other devices by sync. The publish guard (`409 events_pending`, W2 §11 step 7) still
  stops a publish that would undo a server move.
- **Settings card:** "This device is handling your online list" or "Handled by Jen's laptop
  (open now)", replacing today's `'not-backing'` message.

## 8. Build order (each a reviewable PR; nothing visible until step 6)

1. **Built 2026-10-10.** As built: `sync_meta` is `'id, tbl'` with `id = '<table>:<row id>'`
   (one string key, so the Node test shim needs nothing new) in `db.version(2)`, the first
   block after the frozen `version(1)`; a real upgrade of a v1 database keeps its records, and
   a page still on v1 code opens the upgraded database (headless Chromium). `syncRecords.js`
   (`buildPutRecord`, `buildDeleteRecord`, `readRecord`, `rowHash`, `prepareFileRow`,
   `sealFileRow`, `cloudFileIds`, `APPLY_ORDER`), `syncState.js` (`readSyncRows`,
   `diffSyncRows`, `scanLocalChanges`, the sync_meta read/write). A record's sealed body is
   `{ f: 1, t: table, r: row }`, so a record can't be replayed as another row. Tests:
   `tests/syncRecords.test.js`. **The logo check found a problem:** a 480 px PNG photo logo
   can be about 1.2 MB as a data URL and an SVG has no cap, and the record carries it twice
   (cloud + sealed) against D1's ~2 MB row. **Decided 2026-10-10:** logo uploads are capped
   at about 300 KB (PNG redrawn smaller until it fits, an oversized SVG refused); a 1200 px
   noise photo stores at 244 KB (headless Chromium). Step 2 keeps the 1 MB record limit; a
   kennel still holding an older, larger logo is the one record that can hit it, shown by
   name as §11 says, until the logo is replaced.
   Originally: **Record format and change detection** (client, pure). `syncRecords.js` (wire form,
   `rowHash`, derived file classification), `sync_meta` in `db.version(2)` (§12 decision 4),
   `syncState.js`, the scan. Tests: `tests/syncRecords.test.js` (round trip, no private key
   in `cloud`, sealed opens only with the key, the scan finds puts and deletes and ignores
   sample rows), and the `cloudDirty` / `syncRegistry` exemptions for the device-only
   table. Check the logo size ceiling (§4.1).
2. **Built 2026-10-10.** As built (where it differs from §6, this wins): `cloud/src/sync.js`,
   migration `0014_sync`, `cloud/src/lib/cloudFields.js` (generated by
   `cloud/scripts/cloud-fields.mjs` from `syncRegistry.cloudFieldManifest()`; drift test
   `cloud/tests/cloudFields.test.js`). Differences: a `files` record carries `file`, its
   `/files` id (a hash of ciphertext for a private file, as `snapshot_files` already shows),
   stored as `sync_records.file_sha256`, so **retention keeps a synced document's bytes while
   its record lives** (the first draft would have deleted them after a day); a push
   **drops** a record whose cloud part carries a key outside the allow-list (or is over
   1 MB) and reports it in `dropped`, the rest go through; `programs.sync_purged_seq` is the
   highest tombstone seq retention has deleted, and `410 resync_required` means
   `0 < since < sync_purged_seq`; when sync has been off 30 days the wipe also moves the
   counter one past every cursor, so a device that comes back re-joins and re-sends; a
   pull returns `through` and a `seq` read before the query (cursor may move to `seq` when
   `more` is false; a full pull leaves tombstones out); `GET /sync/head` also returns
   `enabled` and `keyId`; `DELETE /sync` needs no Pro, so a lapsed license can still turn
   it off; a syncing program's snapshot carries `sync_seq` and commits only while no record
   arrived since it was described (`409 not_caught_up`), leaving `backing_device_id`
   alone; a Phase 1 push (no `sync_seq`) on a syncing program gets the 409 with
   `syncing: true`. The test D1 shim's `batch` now returns rows for a SELECT, as D1 does.
   Tests: `cloud/tests/sync.test.js`. **Apply pending `0014` on staging (and production)
   after the merge.**
   Originally: **Server.** Migration `0014` (+ its `index.js` line), `cloud/src/sync.js` (§6.1),
   `cloudFields.js` and its drift test, `canPush`'s caught-up rule (§6.4), retention, account
   deletion, `/ops` counts, rate limits. Tests: `cloud/tests/sync.test.js` (seq order under
   concurrent batches, superseded reporting, tombstones and the horizon, `vault_required`,
   `key_id` checks, `pro_required`, the allow-list drop). Staging: Apply pending.
3. **Built 2026-10-10.** As built: `data/cloud/cloudSync.js` (`pushChanges`, `pullChanges`,
   `syncNow`, `pullIfBehind`, `syncStatus`, `startSyncScheduler`, lock
   `kennelos-cloud-sync`), `data/syncApply.js` (`applyPulledRecords`,
   `SYNC_APPLIED_EVENT`), `syncState.syncRowFor` (the one hashing path, so a pulled row's
   meta matches the next scan), `cloudApi`'s `/sync/*` calls, `editionFlags.liveSync`, and
   `settings.getCloudSyncState` (`kennelOS.cloudSyncState`: enabled, cursor, times, lastError,
   `rejected`, `activity`; Reset App clears it). As decided here: a record the server drops
   is remembered by hash and not resent until it changes; a pulled file whose bytes can't
   be fetched lands without them (`missing_file` in the activity list) with a meta hash that
   won't push it back blobless; the shrink guard runs on the scan; the scheduler isn't
   started anywhere yet (step 6). Tests: `tests/cloudSync.test.js` (two devices against the
   real Worker: full round trip with private fields, edits and deletes both ways, both
   editing one record, a delete racing a new reference, private and cloud files, a dropped
   record, the shrink guard, every pause, its own echo vs a newer local edit; the echo
   test was checked by breaking the skip). The page transaction was checked in real
   IndexedDB (headless Chromium).
   Originally: **Client sync loop.** `cloudSync.js` (push, pull, scheduler, locks), `syncApply.js`
   (transactional pages, echo skip, delete-to-archive, `SYNC_APPLIED_EVENT`),
   `cloudApi`'s `/sync/*` calls, `editionFlags.liveSync`. Tests: `tests/cloudSync.test.js`
   against a fake server (two simulated devices editing, offline then reconnecting, the same
   record edited on both, a delete racing a new reference, a re-keyed vault, resync).
4. **Join and leave.** Enable, join with the `updated_at` merge, turn off here / for every
   device, the lapsed-license pause (§12 decision 6), the locked-vault pause, the vault-off
   confirm.
5. **Waitlist lease.** `POST /waitlist/lease`, the route check in `waitlist.js`, the client's
   lease handling in `cloudWaitlist.js`, the settings card wording. Tests in
   `cloud/tests/waitlist.test.js` and `tests/cloudWaitlist.test.js`.
6. **UI and release.** `cloudSyncUI.js` (§2), the device list's "last synced", the "updated
   elsewhere" notice, the activity list. Browser checks in headless Chromium at phone width
   with two browser contexts as two devices against `wrangler dev`, then two real devices on
   staging. Privacy policy paragraph (no new readable data, §4.2). Release switch
   `SYNC_RELEASED`, flipped after the real-device checks, with the `CACHE_NAME` bump (asked
   first) and the precache entries for the new files.
7. **The live nudge** (optional, after release). A Durable Object per program with the
   WebSocket Hibernation API: devices connect while visible; after a push the Worker tells
   the program's object, which sends `{ seq }` to the other sockets; they pull. No data goes
   through it, and the 60-second poll stays as the fallback.

Each step: `node --check` on touched files, `node --test` from the root and `cd cloud && npm
test`, the precache check, and the docs in the same change (§9).

## 9. Docs to update as it's built (`CLAUDE.md` rule)
- **End-State guide:** the new tables (`sync_meta`, the `db.version(2)` block), the sync
  modules, the "pulled rows bypass repos" exception to the layering rule, and the changed
  meaning of the backing device.
- **`CLAUDE.md`:** the second direct writer of every table (`syncApply.js`) and its reason;
  `db.version(2)` and the frozen `version(1)`.
- **Editions Plan:** live sync under Pro's additions; the Lite device on a syncing program.
- **Phase 1 plan §3.4** and **W2 plan §11** step 1: a pointer to §6.4 and §7 here.
- **`cloud/README.md`:** the new routes, migration `0014`, and the `cloudFields.js` drift
  test.
- **`README.md`** build status, and **`LAUNCH_CHECKLIST.md`**: Apply pending for `0014`, the
  two-device checks.

## 10. Testing
- **Pure:** wire format, hashing, the scan, classification changes, merge rules.
- **Two-device simulations** in Node (`fake-indexeddb` isn't used anywhere in this repo, so
  the simulated devices run `syncApply`'s merge logic over plain in-memory tables, and the
  Dexie transaction wrapper is exercised in the browser checks).
- **Server:** concurrency of `sync_seq` (many batches interleaved on the shim), tombstone
  horizon, allow-list drop, every refusal.
- **Browser:** two contexts as two devices against local `wrangler dev`: edit on one, see it
  on the other within the poll; offline edit on both; a document upload; a delete racing a
  reference; the waitlist lease moving when one device closes.
- **Real devices on staging:** an iPhone home-screen app and a laptop, with the phone
  backgrounded and killed between edits (Safari's background limits are the realistic way a
  push gets lost; the scan re-finds anything not acknowledged).

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| A pulled record silently overwrites an edit made offline on another device | Rare for one person; noted in the activity list; the overwritten version is in that day's snapshots (§2.3). Per-field merge stays available as a later refinement (Proposal §5). |
| A bug syncs a bad state (a wrong bulk import, a half-cleared browser) to every device | The shrink guard (Phase 1 §3.5) runs on the scan too: a push that would delete more than half the records (with at least 10 before) stops and asks, as backup does. "Restore as of…" rolls back every device. |
| A record pushes forever (it fails server validation) | It's shown by name as a sync error, the rest of the page still goes through, and it's retried only after it changes again. |
| The sealed part of every record roughly doubles stored size | Records are small; at a few thousand rows a large program is a few MB in D1. Files, the big part, are unchanged. |
| A device stays offline for months | `410 resync_required` and a confirmed re-join (§5.5). |
| Safari kills a backgrounded tab before its push | Nothing is lost: the scan finds anything without an acknowledged seq on the next open. |
| D1 write contention with many kennels syncing at once | Writes are small batches; D1 serializes them per database. If it ever shows, the record store moves into a Durable Object per program (Proposal §3's original shape) behind the same routes. |

## 12. Decisions (all taken as recommended, 2026-10-10)

1. **Does sync require Sensitive records (the vault)?** *Recommended: yes.* Without it,
   private fields (prices, contacts' details, Financials, notes) stay on the device that
   typed them, and the other device shows blanks that it may then overwrite. Requiring it
   keeps "in step" true. The cost: one more thing to turn on first, offered in the same flow.
2. **Find changes by scan or by outbox (§3.3)?** *Recommended: scan.* It can't miss a writer,
   and it's cheap at kennel scale. The outbox in Proposal §5 would need hooks in every direct
   writer.
3. **Conflicts: server receive order or `updated_at`?** *Recommended: server receive order,
   per record* (Proposal §5's decision), with `updated_at` used only when a device first
   joins (§5.5). Device clocks can be wrong, and receive order can't be.
4. **Schema version:** *recommended: `sync_meta` goes in a new `db.version(2)` block,* and
   `version(1)` is frozen from now on, because production has had real records since
   2026-10-07. The alternative (one more edit to `version(1)`) relies on every installed
   device reconciling by Reset App, which real users can't be asked to do.
5. **D1 or a Durable Object for the records?** *Recommended: D1* (§6.2), with a Durable
   Object only for the live nudge.
6. **A lapsed Pro license:** *recommended: sync pauses (records stay on every device), and
   each device falls back to Phase 1 backup,* with the backing-device rule applying again
   when it next pushes a snapshot. The alternative (read-only pulls continue) is kinder but
   gives a lapsed license the paid feature's main value.
7. **The "updated elsewhere" behavior on an open form:** *recommended: a notice with Reload,*
   never a live re-render under her typing.
