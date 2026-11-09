# K03 — Cloud client: backup, live sync, conflicts

Reviewed: `shared/data/cloud/cloudSync.js` (523), `syncApply.js` (167), `syncRecords.js` (150),
`syncState.js` (112), `syncActivity.js` (59), `cloudBackup.js` (842), `cloudApi.js` (358),
`cloudAuth.js` (188, sign-in/out only), `cloudConfig.js` (163), `cloudEntitlement.js` (64),
`serverWork.js` (55), `syncRegistry.js` (665, client half), `cloudDevices.js` (214, skimmed);
`assets/cloudSyncUI.js` (471), `assets/cloudBackupUI.js` (1680: status line, push results,
Restore as of…, sign-out); the server half of the rule in `cloud/src/sync.js` (push, pull).
· Contract read: Phase 2 Sync plan §2.3, §3, §5.1–§5.5, §12 decision 3, risk table; guide §30.

Verified by: baseline at `cdc3550` — `node --test` 1649 pass, `cd cloud && npm test` 305 pass,
`node build/assemble.mjs` succeeds. Seven scratch suites (in my scratchpad, not the repo) that
drive the **real** `cloudSync` / `syncApply` / `cloudBackup` against the **real** Worker
in-process, two or three simulated devices each, copied from `tests/cloudSync.test.js`:
conflicts, poll-before-push, lost push answer, missing file, account switch, Back up now while
paused, Restore as of… on a syncing program. A request-capture harness for the private tier.
A Playwright crawl of the assembled `dist/demo` (87 pages) and `dist/lite` with `cloudUrl` and
`devCloudUrl` set to null (33 pages), each fresh, with a planted signed-in + sync-on + test-switch
state, and (Lite) with records.

**The rule, as built.** Normal sync: **the push the server receives last wins, for the whole
row** (`cloud/src/sync.js:195-205` upserts whatever `base_seq` says; `base_seq` is used only
to report `superseded`, `:218`). On the client, a pull overwrites any row whose server seq is
newer than `sync_meta`'s, and notes `kept_theirs` only if the local row differed from what it
last synced (`syncApply.js:115-120`). Which device's edit "arrives last" depends on which code
path runs first: `syncNow` pushes then pulls (`cloudSync.js:286-288`), the 60-second poll pulls
without pushing (`:293-311`). A join (first time, or after `resync_required`) is the only place
`updated_at` decides, compared as strings with the device's own clock (`syncApply.js:97`).

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S1 | cloud/src/sync.js:195 · shared/data/syncApply.js:116 | Field-disjoint offline edits: the device that pushed first loses its edit and is told nothing | verified |
| 2 | S1 | shared/data/cloud/cloudSync.js:293 | The 60 s poll pulls before pushing: an unpushed, newer edit is discarded for an older one, and the note says hers was older | verified |
| 3 | S2 | shared/data/syncApply.js:83 · cloudSync.js:121 | A record for a table this build lacks stops every future pull; nothing is recorded, status still says "synced" | verified |
| 4 | S2 | shared/data/cloud/cloudAuth.js:157 | Sign-out keeps sync state and `sync_meta`: on another account the device is "On" but uploads nothing and pulls from the old cursor | verified |
| 5 | S2 | shared/data/syncApply.js:111 | A file whose download fails once is never fetched again; the note says "next time it changes" (files never change) | verified |
| 6 | S2 | shared/assets/cloudBackupUI.js:680 · cloudSyncUI.js:374 | The recovery the activity list points to ("Restore as of…") rolls back every record on every syncing device | verified |
| 7 | S2 | shared/assets/cloudBackupUI.js:678 | Restore as of… says "Nothing to restore" when only sensitive fields differ, so a lost note/price/phone can't be got back from the UI | verified |
| 8 | S2 | shared/data/syncApply.js:97 | Join decides by device clock, as strings: a fast clock's old edit beats a real newer one; the loser isn't told | verified |
| 9 | S3 | shared/data/cloud/cloudBackup.js:343 · cloudBackupUI.js:495 | "Back up now" on a syncing device that's behind or paused does nothing and says nothing; the line then blames the internet | verified |
| 10 | S3 | shared/data/cloud/syncActivity.js:36 | Activity wording is wrong under the real rule ("the change here was older", "a moment before", names this device as "another") | verified |
| 11 | S4 | shared/data/cloud/cloudSync.js:134 · :161 · :185 | Client-before-Worker deploy: dropped rows are never resent after the Worker catches up; a new table fails every push | verified |

---

## 1. Field-disjoint offline edits: the first pusher loses, silently  (S1, verified)
**Where** `cloud/src/sync.js:195-205` (upsert regardless of `base_seq`), `shared/data/syncApply.js:115-120`
(the note only fires when the local row has unpushed changes), `shared/data/cloud/cloudSync.js:188`
(`replaced_theirs` goes to the *winning* device only).
**Scenario** Both devices synced. Offline, phone A adds Birch's microchip; laptop B (offline)
adds a note on Birch. A reconnects first and pushes (seq 4). B reconnects, pushes its whole row
(`base_seq` 3, no microchip): accepted, `superseded`. A pulls B's row: its local row equals what it
last pushed, so no `kept_theirs`. **A's microchip is gone on every device; A's activity list is
empty** (harness: `A activity []`). B's says "Your change to d1 replaced one made on another device
a moment before." — the edit lost wasn't even on the same field, and the person reading it is
on the other device. The same holds for archive-vs-edit (A archives a dog, B edits it offline,
B pushes last → the dog is un-archived on A, A told nothing) and edit-vs-hard-delete (B edits and
pushes, A hard-deletes without having pulled → B's row deleted on pull, B told nothing).
**Why it matters** The plan's mitigation (§2.3: "noted in the activity list; the overwritten
version is in that day's snapshots") holds for neither device here: the losing device gets no note,
the server keeps one version per record, and a snapshot holds A's microchip only if one ran in the
minutes between A's push and A's pull (backups wait 5 min, a syncing device backs up only when
caught up — `cloudBackup.js:297-303`). Even then, see 6 and 7.
**What I'd do** Let the pull carry what a version overwrote (`superseded` already knows; store
`overwrote_seq`/`base_seq` on the row) so a device whose own pushed version was replaced notes
`replaced_mine` and keeps the lost row locally for 30 days. Field-disjoint edits are detectable
client-side (both versions are in hand on the superseding device) if a per-field merge is ever wanted.

## 2. The poll pulls before it pushes: a newer edit is thrown away  (S1, verified)
**Where** `cloudSync.js:293-311` (`pullIfBehind`: head, then pull, no push), triggered every 60 s
(`:521`) and on becoming visible (`:516`); the push is a 10 s debounce (`:513`) or `online` (`:520`);
`syncApply.js:115-120` (unpushed local loses); `syncActivity.js:36`.
**Scenario A (verified)** B edits Birch at 09:00 and pushes. A, whose push hasn't run yet (the
10 s debounce, or the push failed offline and connectivity came back without an `online` event —
barn Wi-Fi with a dead uplink keeps `navigator.onLine` true), edits Birch at 12:00. The poll fires
first: A's 12:00 edit is overwritten by B's 09:00 one and is never pushed (`pushChanges` →
`nothing`). The activity line: "Kept the version of Birch from Laptop B (the change here was older)."
— it was newer. Had `syncNow` run first, A would have won: the outcome is decided by a timer.
**Scenario B (verified)** A pushes edit 1, the server commits, the answer is lost (offline
flicker) so `sync_meta` isn't updated; she types edit 2; the poll pulls the server's copy of
**her own edit 1**, which isn't recognised as an echo (`syncApply.js:82` compares seqs that were
never written) and overwrites edit 2; activity names *this* device as the other one.
**Why it matters** Data loss of the most recent work, with wording that tells her nothing of value
was lost.
**What I'd do** Make every pull go through push first (have `pullIfBehind` call `pushChanges` when
the scan has changes), and never overwrite a row with unpushed changes in a plain pull without
keeping the local version.

## 3. A table this build doesn't have stops sync for good, silently  (S2, verified)
**Where** `syncApply.js:83` (`db.table(r.tbl)` throws `InvalidTableError` in real Dexie —
`vendor/dexie.min.mjs`, `table()`), `:149`; `cloudSync.js:121` (`fromError` rethrows anything
unknown); `:513`, `:516-522` (scheduler calls aren't awaited or caught).
**Scenario** Her laptop is on the current build; her phone still runs a cached build from before
`db.version(7)`. She adds a do-not-sell listing on the laptop. Every pull on the phone now throws
on that page: the cursor stays put (harness: cursor stuck at 3 across runs), so **every later
change from every device never arrives**, `lastError` stays `null` (harness), the status line keeps
saying "On · synced 3 days ago", nothing says why, and the phone's backups stop too (a syncing
device backs up only when caught up: `cloudBackup.js:469` → `skipped`). Each run is an unhandled
promise rejection.
**What I'd do** In `applyPulledRecords`, skip records for tables this build doesn't know (keep them
for later, or pause with a code such as `update_needed`: "Update KennelOS on this device to keep in
step"); have `fromError` record any unexpected error in `lastError` instead of throwing.

## 4. Sign-out keeps the device's sync position  (S2, verified)
**Where** `cloudAuth.js:157-164` (`signOut` clears the session and backup state, not
`cloudSyncState` or `sync_meta`); `:42-47` (a different program on sign-in resets backup state only).
Compare `cloudVault.js:478-482`, which does clear both.
**Scenario** A syncs program 1 (cursor 4). She signs out, then signs in with another email whose
program syncs (5 dogs on it) and unlocks it. Sync state is still `enabled: true, cursor: 4`. The
first run: push `nothing` (her 4 records are "already synced" per program 1's `sync_meta`), pull
from seq 4 → she gets only the 5th dog. Server for program 2 never receives her records; the
field says "On · synced just now".
**What I'd do** Clear `cloudSyncState` and `sync_meta` on sign-out and when the program changes
(as `disableVault` does), so the device joins afresh.

## 5. A file that fails to download once never comes down  (S2, verified)
**Where** `syncApply.js:111-113` (any `fetchFile` error → the row lands without `blob`), `:138-139`
(`sync_meta` stores the hash of the bytes-less row, so the scan sees nothing to do);
`syncActivity.js:42`.
**Scenario** A contract PDF syncs to the laptop while the connection drops mid-pull. The files row
lands without bytes; three more syncs later it is still missing (harness), and push is `nothing`.
The activity says "The file for … couldn't be downloaded yet. It comes down the next time it
changes." — a file row is written once and never changes, so it never comes down (a re-join is the
only repair). Suspected follow-on: that device's backups now carry the row without the file.
**What I'd do** Don't record `sync_meta` for a row whose bytes are missing (or record a marker
the next pull/scan retries), and reword the note.

## 6. "Restore as of…" rolls back every syncing device  (S2, verified)
**Where** `cloudSyncUI.js:374` (the activity list's recovery advice), `cloudBackupUI.js:680-696`
(the confirm), `cloudBackup.js:661-679`; the scan in `syncState.js:262-273` pushes every row whose
hash now differs.
**Scenario** To get back a lost value on one dog she rolls back to this morning's backup on A.
Every record changed since is rolled back on A, then pushed (harness: 2 records), and B's two
unrelated edits from this afternoon are gone on B too, with nothing in B's activity. The confirm
says "N record(s) will be rolled back" and nothing about her other devices.
**What I'd do** On a syncing program, say it in the confirm ("on all your devices"), and offer a
per-record restore (the snapshot already holds the row) for the activity list's case.

## 7. Restore as of… can't roll back sensitive fields alone  (S2, verified)
**Where** `cloudBackupUI.js:669` (preview = `planCloudMerge`, the cloud tier only), `:678` (exit when
nothing cloud-tier differs).
**Scenario** The lost edit in 1 or 2 is a note, a price or a phone number (all `private`, carried
only in the vault part). The preview counts 0 updated, 0 inserted (harness: `restoreSnapshot`
summary `unchanged: 2` while the vault part did roll both notes back), so the UI stops at "Nothing
to restore: Your records already match the backup from …" — the vault restore that would bring the
value back is never reached.
**What I'd do** Count the vault part's differences in the preview when this device is unlocked.

## 8. A join trusts the device clock  (S2, verified)
**Where** `syncApply.js:97` (`String(local.updated_at) > String(row.updated_at)`).
**Scenario** Laptop B's clock is a year fast; it edited Birch once, then stopped syncing (or was
away past the 90-day horizon and is told "Catch up…"). A edits Birch today. B joins: B's
`updated_at` of 2027 wins (`keptOurs: 1`), is pushed, and A's newer edit is replaced on A with no
note on A (harness). String comparison also misorders mixed formats: `…T10:00:00Z` sorts after
`…T10:00:00.900Z`.
**What I'd do** Compare with `Date.parse`, and treat a stamp in the future (beyond a small skew)
as suspect: prefer the server's version and note it.

## 9. "Back up now" while syncing-and-behind is a silent no-op  (S3, verified)
**Where** `cloudBackup.js:343`, `:469` (→ `skipped`, `sync_behind`), `cloudBackupUI.js:495`
(`skipped` returns without a word), `:92-98` (status line).
**Scenario** Sync is paused (`resync_required`, `vault_key_stale`, `shrink`, or stuck as in 3). She
taps Back up now: a progress modal flashes, then nothing (harness: `skipped/sync_behind`). A day
later the card reads "Not backed up for 3 days: no internet?" — it isn't the internet.
**What I'd do** Treat `sync_behind` as a result with words ("Backups wait until this device is in
step: …" with the sync fix), and let the status line name a paused sync.

## 10. The activity list's wording contradicts the rule  (S3, verified)
**Where** `syncActivity.js:36` ("the change here was older" — under arrival order it may have been
newer, finding 2), `:38` ("a moment before" — the replaced edit may be days old, finding 1), `:42`
(finding 5); `kept_theirs` can carry this device's own id (finding 2B) so it reads "from Phone A"
on Phone A.
**What I'd do** Say what happened, not why: "Birch was changed on Laptop B after your change here
was made but before it was sent; Laptop B's version was kept."

## 11. Deploying the client before the Worker loses records quietly  (S4, verified)
**Where** `cloudSync.js:134` (puts whose hash is in `rejected` are skipped), `:185` (a server
`dropped` → `rejected`), `:121` (a 400 `bad_table` rethrows); `cloud/src/sync.js:123-124`.
`tests/cloudSync.test.js:209` already proves "not resent unchanged" with an old server.
**Scenario** The next release classifies a new field as `cloud` (or adds a table) and the pages
deploy before the Worker. Every row carrying the field is `dropped: cloud_key:…` and remembered;
once the Worker catches up those rows are still never sent until each is edited, so other devices
never get them (not even sealed). A new table is worse: the server answers 400 `bad_table` for the
whole page, `fromError` rethrows, and no push of any table succeeds until the Worker ships.
`cloud/README.md` says nothing about deploy order.
**What I'd do** Clear `rejected` when the server's field list changes (send a fields version on
`/sync/head`), and write the order (Worker first) next to the cloudFields rule in CLAUDE.md /
`cloud/README.md`.

## Notes, not findings
- **`cloudUrl: null` is inert — proven.** Structurally: every request goes through `cloudApi.send`,
  which throws `CloudUnavailableError` before `fetch` when `cloudBaseUrl()` is null
  (`cloudApi.js:94-95`); no other module fetches the cloud (the other `fetch` calls are OCR,
  KennelPort, Stripe, Dropbox, Drive, Jotform, license, seed — not this session's); both schedulers
  return early (`cloudBackup.js:798`, `cloudSync.js:507`); `app.js:146`, `:230` gate the cloud UI.
  In the assembled builds: `dist/demo` 87 pages × 2 passes and `dist/lite` (null variant) 33 pages
  × 3 passes — **zero requests off-origin, zero page errors, no cloud wording**, after waiting 65 s
  for debounces/polls and firing `online`, `visibilitychange` and `kennelos:datachanged` on each
  page, including with a planted session, backup on, sync on and the `?cloud=staging` switch set.
- **The shipped Lite is not `cloudUrl: null`:** it has `cloudUrl = https://api.kennelos.app` (cloud
  backup is a Lite feature) with `liveSync: false`; so the null proof for Lite is of a build variant,
  and Lite's live-sync inertness rests on `isSyncAvailable()` (`cloudSync.js:66-68`). Only Demo
  ships null.
- **Private tier — traced clean.** `contacts.phone` / `notes` / `email`: `pages/contact.js:185`
  (`readForm`) → `contactRepo.create`/`update` (`contact.js:379-383`) → Dexie → scan
  (`syncState.js:238`) → `buildPutRecord` (`syncRecords.js:387-406`: cloud part via `projectRow`,
  allow-list by name; whole row sealed) and the backup snapshot (`filterCollectionsForCloud`) +
  sealed vault part. Captured every body of a sync push and a full backup (5 requests, gzip bodies
  unpacked): the contact's name appears, the phone, note and email appear in **none**.
- **`cloud/src/lib/cloudFields.js` has no drift**: regenerated output is byte-identical, and
  `cloud/tests/cloudFields.test.js` guards it.
- Partial push is safe (meta written per accepted page); an interrupted pull is safe (one
  transaction per page, cursor after). A lost push answer makes the retry report a false
  `replaced_theirs` on itself (cosmetic, beside 2B).
- A record page that showed "Updated on another device" and is then saved overwrites the pulled
  change with no note anywhere (whole-row save of a stale draft). The notice is the design's
  answer; mentioned so K9/K15 know saves aren't guarded.
- The same real dog added on two already-syncing devices becomes two records with no notice; the
  join's pairing doesn't run after joining. Scan for duplicates exists (Import/Export).
- While a `shrink` pause waits for her, the poll keeps pulling: a row she deleted locally that
  another device edits comes back (suspected; follows from `syncApply.js:84-121`).
- Clock moved backwards: `relativeTime` clamps to "just now" until the clock passes the stamp.

## Coverage gaps I found (tests that should exist)
- Two devices edit **different fields** of one record offline; assert the losing device is told
  (finding 1 — today's test at `tests/cloudSync.test.js:147` only covers an unpushed loser).
- `pullIfBehind` with an unpushed local edit and a remote edit to the same row (finding 2).
- A pulled record for a table not in `db` (finding 3).
- `signOut` then sign-in to another program: sync state and `sync_meta` cleared (finding 4).
- A failed `getFile` during pull is retried later (finding 5).
- Restore as of… preview counts a private-only difference (finding 7).

## What I did not get to
- The full 0a recipe on the 1,680-line backup UI (320 px, every dialog, the first backup on a
  throttled connection, the quota/`too_large` path, restore-from-cloud onto a device with records in
  a real browser). I read the status line, push results, Restore as of… and sign-out only.
- `cloudDevices.js` beyond a skim; `cloudVault.js` / `cloudWaitlist.js` / account deletion /
  assisted setup (K5, K7).
- The entitlement lapse end to end in a browser (read: `pro_required` pauses sync, backups fall
  back to Phase 1 per `snapshotSyncSeq`, export unaffected — no finding).
