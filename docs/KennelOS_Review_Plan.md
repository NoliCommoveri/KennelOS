# KennelOS: a review of the whole app, run over several sessions

A read-only review of KennelOS against its plans and specs. Sixteen sessions, because the
app is about 110,000 lines: `shared/` ~86k (data 39k, pages 21k + 85 HTML files, assets
23k), `cloud/src` 7.3k, `furever/` 6k, `site/` 3.2k, with 18.8k lines of tests in `tests/`
and 5.5k in `cloud/tests`.

**The seam with KennelPort is already planned separately** —
`Kennelport/docs/KennelPort_Review_Plan.md`, ten sessions, which cover `siteExport.js`,
`kennelportApi.js`, `kennelportLink*.js`, `websiteCard.js`, `websiteUpdateUI.js`, the
sealed application form and the three `/f/` endpoints a KennelPort site calls. Sessions
here do **not** re-review those files. Where your area feeds the website, note it in one
line and move on.

We are **not** hunting for departures from the plans. The specs are older than the code and
the code often improved on them. We are hunting for:

- **Defects** — code that does the wrong thing, loses data, or fails on real input.
- **Pitfalls** — works today, breaks on the next schema version, edition build, deploy,
  second device, second kennel, or 4,000-record program.
- **Poor user experience** — a breeder or a family hits a dead end, a silent failure, a
  spinner that never resolves, a word nobody outside this repo understands, a screen that
  does not fit a phone.
- **Doc drift** — only where the drift will cause one of the above (a future change made
  against a statement that is no longer true).

---

## 0. Ground rules for every session

**Repos.** `/home/user/KennelOS` is the subject. `/home/user/Kennelport` is usually
attached too; you need it only for the seam, which is another plan's job.

**Read-only.** Change no code, no tests, no docs other than your own findings file and the
index. In particular: never bump `CACHE_NAME` in `shared/sw.js` (the repo rule is to ask
the owner, once per shippable batch, and a review is not a batch); never hand-edit
`dist/*/sw.js` or `cloud/src/lib/cloudFields.js` (both generated); never touch the README's
Status. Prove things with throwaway scripts in your scratchpad directory, not in the repo.

**Green baseline (2026-11-03).** `node --test` in `/home/user/KennelOS` → 1490 pass.
`cd cloud && npm test` → 279 pass. `node build/assemble.mjs` → succeeds. If your session
starts red, that is finding number one.

**Evidence standard.** Every finding carries `file:line`, a concrete failure scenario (the
records, the taps, the sequence — and what the breeder or family sees or loses), and a
**verified** / **suspected** label. No scenario, no finding; put the rest in "notes, not
findings".

**Severity.**
- **S1** — data loss, or wrong data shown to a family / used for money.
- **S2** — a flow dead-ends, a write half-applies, a limit or gate refuses something
  legitimate, a page throws.
- **S3** — works, but confusing, silent, slow, or broken on a phone.
- **S4** — latent: fine today, breaks on the next ordinary change.

**Not findings.**
- Guide §15 "Deliberately NOT built" (computed COI, carrier-risk analysis, recurring
  events, photo galleries, pairing/litter CSV subjects).
- README Status's in-progress list: an e-sign provider, the unproven Jotform steps, cloud
  migrations `0017`/`0019` waiting on a deploy, the VAPID secret and migration `0018`, the
  `MAPBOX_TOKEN`, real-phone checks, Kels's Tidy up covering only dogs and contacts.
  "Needs a deploy or a secret" is not a defect — but **code that cannot work once that
  deploy happens is**, and that is exactly worth finding now.
- `docs/LAUNCH_CHECKLIST.md` items marked `[!]` (placeholders to swap at launch), and the
  open launch items in README Status (`yearlyVariantPattern` / `lifetimeVariantPattern`).
- Anything in the KennelPort seam (another plan).

**Already checked, don't spend a session on it** (done while writing this plan):
- `PRECACHE_URLS` is complete: 431 entries against 412 app files, nothing stale, and
  `tests/serviceWorker.test.js` guards it. Spot-check only if your area adds files.
- The single-line `innerHTML` surface is clean: of 608 assignments, 26 interpolate without
  `esc(` on the same line and all 26 pass pre-escaped fragments or `.map(esc)`. The
  **unchecked** surface is multi-line template literals — see session K15, which writes a
  proper scanner for them.
- `shared/data/db.js` is at `version(5)`, with the blocked-upgrade hand-off
  (`DB_BLOCKED_EVENT` / `DB_READY_EVENT` / `DB_VERSIONCHANGE_EVENT`) in place.
- `undefined/r1-signout-others.png` — a stray directory named `undefined` holding one
  committed screenshot. Repo hygiene, S4 at most; it is already reported here, so no
  session needs to re-find it.

**Output.** One file per session: `docs/review/findings/KNN-<slug>.md`, then your row in
`docs/review/INDEX.md`. Commit docs only; push to your session's own branch. Shape:

```markdown
# KNN — <session title>

Reviewed: <files, with line counts>  ·  Contract read: <doc sections>
Verified by: <tests run, scripts written, pages opened in a browser>

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S1  | shared/data/foo.js:412 | one-line claim | verified |

## 1. <title>  (S1, verified)
**Where** … **Scenario** … **Why it matters** … **What I'd do** (a line or two, no patch)

## Notes, not findings
## Coverage gaps I found (tests that should exist)
## What I did not get to
```

**Tooling.** `grep`/`rg`, `node --test`, `node --check`, `node build/assemble.mjs`
(add `--release` to see the launch gate), `cd cloud && npm test`,
`python3 -m http.server 8000` then `http://localhost:8000/shared/` (never `file://`).
Chromium and Playwright are pre-installed: use them for real-page checks, 320px widths and
phone emulation. For data-layer work, drive Dexie in a browser page rather than guessing —
several suites under `tests/` already stub it; copy their approach
(`tests/support/`, and read one existing suite before writing a scratch harness).

**The contract.**

| Area | Read |
|---|---|
| How `shared/` works: data model, schema, repos, invariants, recipes | `docs/End_State_Design_and_Maintenance_Guide.md` — §4 data model (196), §5 schema (260), §6 repos (300), §7 referential integrity (356), §8 events (388), §14 conventions (953), §15 not built (964), §16 invariants (976) |
| Editions, caps, licensing | `docs/KennelOS_Lite_Pro_Editions_Plan.md`, `docs/KennelOS_Lite_Cap_Enforcement_Spec.md`, guide §0 (16) |
| Import, export, backup | guide §9 (456), §10 (523), §26 (1486), §26.1 (1486) |
| First run, sample data, settings | guide §11 (674) |
| SW / PWA, UI layer | guide §12 (827), §13 (844) |
| Nudges and the away board | guide §19 (1029) |
| Companion share-out, Furever seed, kennel identity | guide §20 (1111), §27 (1518), §28 (1593) |
| Money: financials, referrals, puppy record, invoices | guide §21 (1167), §22 (1317), §23 (1323), §24 (1365) |
| Waitlist | `docs/KennelOS_Waitlist_Spec.md` (1677), `_W2_Plan.md` (755), guide §29 (1638) |
| Cloud backup, live sync | `docs/KennelOS_Cloud_Phase1_Plan.md`, `_Phase2_Sync_Plan.md`, guide §30 (2140), §34 (3418), `cloud/README.md` |
| Vault, license link, integrations | `docs/KennelOS_Private_Vault_Plan.md`, `_License_Link_Plan.md`, `_Integrations_Plan.md` |
| Reports, shows, multi-kennel | `docs/KennelOS_Reports_Plan.md`, `_Show_Tracking_Spec.md`, `_Multi_Kennel_Scope_Spec.md` |
| Kels | `docs/KennelOS_Kels_Roadmap.md`, guide §33 (2386) |
| Family requests, family help | `docs/KennelOS_Family_Requests_Plan.md`, `_Family_Help_Plan.md` |
| Notifications | `docs/KennelOS_Notifications_Plan.md` |
| Furever | `docs/KennelOS_Furever_*.md`, `furever/README.md` |

Don't read `docs/BUILD_LOG.md` by default. Do run `git log --oneline -40`: the newest work
is the least reviewed.

---

## 0a. The page recipe (for every session that reviews pages or UI)

Most sessions below include pages. Don't reinvent the questions — walk this list per page,
and only write up what fails:

1. **Empty, loading, error.** No records; one record; a record whose FK target was
   archived; the fetch/read throwing. Does every state say something, or does a spinner
   sit forever? Is the db-upgrade-blocked banner (`isDbUpgradeBlocked`) reachable here?
2. **Layering** (invariant 1). Does the page import `db.js` or touch `localStorage`
   directly instead of a repo / `settings.js`? `grep -n "from '\.\./data/db.js'\|localStorage"`.
3. **Escaping** (invariant 4). Every user value in hand-built HTML and every `listView`
   `cell`. Apostrophes in a kennel name, `<` in a note, a 5,000-character paste.
4. **Scope.** Multi-kennel: does the page respect the active kennel (`kennelScope`,
   `scopePredicates`), and does it do the right thing with a program that has several own
   kennels, or none?
5. **Editions.** Lite's cap and reduced surface, Demo's read-only, Pro-only features — via
   `editionFlags` / the cap hooks, never a hardcoded check (invariant 7). Does a blocked
   save explain itself and offer the next step?
6. **Writes.** Soft delete only; no cascades; `markDataChanged()` on any direct `db` write
   (invariant 3); a half-finished multi-record write; a double submit; a save on a record
   someone archived in another tab.
7. **Phone.** 320px with no sideways scroll; tap targets; a long name in a header; a table
   that must scroll inside its own box, not the page.
8. **Words.** Read every sentence as a breeder. Flag repo jargon (`projection`,
   `dirty`, `subject_type`), dead ends with no next step, and numbers with no unit.

---

## 1. The sessions

**Waves by harm, not by size.** K1–K2 are the foundation every other finding stands on;
K3–K5 hold other people's data and her money's audit trail; K6–K8 are the largest feature
and the one families touch; K9–K12 are the daily app; K13–K15 are breadth, gating and
polish. K16 consolidates.

---

### Session K1 — Schema, repos, registries, referential integrity ★ start here

**Read** `shared/data/db.js` (258), `repoBase.js` (130), the per-entity repos
(`dogRepo` 248, `litterRepo`, `pairingRepo`, `contactRepo`, `kennelRepo` 347, `saleRepo`,
`studServiceRepo`, `contractRepo`, `expenseRepo` 233, `documentRepo`, `fileRepo`,
`accountRepo`, `breedFeedingScheduleRepo`, `waitlist*Repo`), `eventRepo.js` (274),
`referenceRegistry.js` (227), `syncRegistry.js` (621), `kennelScope.js` (174),
`scopePredicates.js` (67), `recordMerge.js` (372), `duplicateScan.js` (199),
`vocab.js` (964), `dateUtils.js` (91), `findRecords.js`, `dogSearch.js` (306),
`contactSearch.js`, `appReset.js`, `demoMode.js`.
Tests: `referenceRegistry`, `syncRegistry`, `eventRepo`, `recordMerge`, `duplicateScan`,
`scopePredicates`, `vocab`, `dateUtils`, `rosterCount`, `cloudDirty`.
Contract: guide §4–§8, §14, §16.

**Evaluate**
1. **Additive-only schema.** All five `version(N)` blocks against the rule: does each list
   only what it adds, and does any shipped block show signs of being edited? Index strings
   repeated across versions (version 3 and 5 both restate `expenses`) — is each restatement
   exactly the old string plus one index? A dropped index is a silent full-table scan.
2. **Index coverage vs real queries.** For every `where(...)`/`orderBy(...)` in the data
   layer, is there an index? And the reverse: indexes nothing queries (dead weight on every
   write). Measure the worst page's reads on a 4,000-dog program if you can.
3. **The blocked upgrade.** `DB_BLOCKED_EVENT` / `DB_VERSIONCHANGE_EVENT` are announced —
   prove `shared/app.js` surfaces both on **every** page (including the family/companion
   views and Furever), and that a late reader gets `isDbUpgradeBlocked()`. The comment says
   a frozen background copy once made every read hang with no error; that is an S2 if any
   entry point still misses the banner.
4. **Referential integrity.** Every FK in the schema has a `referenceRegistry` entry
   (write a script that compares the two, don't eyeball it) — the multi-entry waitlist
   listen lists included. Then the hard-delete guard: what a breeder sees when a delete is
   refused, and whether any path hard-deletes without consulting it.
5. **No cascades, soft delete only.** Archive a dam with live litters, a contact with a
   sale, a kennel with everything. What breaks on the pages that read them, and does
   anything silently vanish from a list because its parent went?
6. **`syncRegistry` completeness.** Every field of every data table classified
   `cloud`/`private`/`pending` — compare against the real field names in use (another
   script), and flag anything that defaults to the wrong side. Making a field `cloud` is a
   privacy decision, so an unclassified field reaching the cloud is S1.
7. **`markDataChanged()`** on every direct `db` write in the data layer, or an exemption
   with a reason in `tests/cloudDirty.test.js`. An unflagged write means a change that
   never syncs or never backs up — S1.
8. **Merge and duplicate scan.** `recordMerge` across every type: which fields win, what
   happens to events, FKs, both records' archive flags; a merge that half-applies; a
   duplicate scan on a big program (time it).
9. **Kennel scope.** `scopePredicates` and `kennelScope` against every "program-wide"
   table (`accounts`, `files`, `breed_feeding_schedules`): is program-wide intended
   everywhere it happens, and does a second own kennel ever see the first one's records?
10. **`vocab.js`** as the single source of status/type words: any hardcoded status string
    elsewhere (`grep` for the literal values) is an S4 waiting for a vocab change.

---

### Session K2 — Backup, restore, CSV import: the data-loss surface

**Read** `importExport.js` (703), `restoreMatch.js` (416), `seedImport.js`,
`csvImport.js` (1947), `csvImportHelp.js` (255), `csvBatch.js`, `pedigreeImport.js` (301),
`pedigreeParse.js` (300), `pedigreeReader.js`, `documentRepo.js`, `fileRepo.js`,
`dropbox.js` (234), `googleDrive.js` (226), `ocr.js`, `receiptCapture.js`,
pages `import-export.js` (447), `import-batch.js`, `expense-import.js`,
`kennel-tests-import.js`, `pedigree-import.js`, assets `importView.js`, `importHelp.js`,
`documentModal.js`, `mergeQuestions.js`.
Tests: `importExport`, `csvImport`, `csvImportHelp`, `csvBatch`, `restoreMatch`,
`restoreMyKennel`, `pedigreeImport`, `pedigreeParse`, `pedigreeOnly`, `fileMerge`,
`duplicateScan`, `recordMerge`, `seedImport` coverage.
Contract: guide §9, §10, §26, §26.1, and the backup-compatibility rules in CLAUDE.md.

**Evaluate**
1. **Backward compatibility, both directions.** A file from an older build restored into
   this one (unknown fields skipped, new fields defaulted) **and** today's file restored
   into an older build. Which format versions exist, when were they bumped, and is any bump
   missing where an older build genuinely could not read the file?
2. **Device-only tables never in a file.** `device_secrets` and `sync_meta` out of
   `exportAll`, the JSON file, the Dropbox backup, the cloud snapshot and the sample
   manifest. Prove it from the code paths, not from the comment.
3. **A restore that goes wrong.** Half-applied restore, a file that fails validation at
   record 9,000, a browser tab closed mid-restore, a restore into a program that already has
   records (`restoreMatch`: what matches, what duplicates, what the breeder is asked).
   Is her existing data ever destroyed before the new file is known-good? That is the S1 to
   rule out.
4. **CSV import** (1,947 lines, the single biggest module): header detection, encodings and
   BOM, Excel's date formats, blank-vs-missing columns, duplicate rows, FK resolution by
   name, the per-row error report, partial commit, and a 10,000-row file on a phone (memory
   and time — measure it). Does the preview tell her exactly what will happen before it
   happens?
5. **Documents and files.** `files` is an unindexed blob store: what deletes a file row when
   its owner goes, what happens to a 20MB PDF on a phone, and does any export carry files
   (size!) or silently drop them?
6. **Dropbox and Google Drive** (`dropbox.js`, `googleDrive.js`): the OAuth redirect rule
   (`origin + pathname`), a revoked token, a quota error, a half-uploaded backup, two
   devices writing the same app-folder file, and what she is told in each case.
7. **OCR / receipt capture:** a photo that yields nothing, a huge image, and whether a
   failure ever loses the receipt she just photographed.

---

### Session K3 — Cloud client: backup, live sync, conflicts

**Read** `shared/data/cloud/cloudBackup.js` (839), `cloudSync.js` (523),
`syncRecords.js` (149), `syncApply.js` (167), `syncState.js`, `syncActivity.js`,
`cloudApi.js` (323), `cloudDevices.js` (191), `cloudEntitlement.js`, `cloudConfig.js` (163),
`serverWork.js`, `syncRegistry.js` (621, the client half),
assets `cloudBackupUI.js` (1654), `cloudSyncUI.js` (471).
Tests: `cloudBackup`, `cloudClient`, `cloudSync`, `syncRecords`, `syncActivity`,
`cloudEntitlement`, `cloudDirty`, `syncRegistry`.
Contract: Cloud Phase 1 plan, Phase 2 Sync plan, guide §30 and §34.

**Evaluate**
1. **`cloudUrl: null` is inert.** No request, no UI, no timer, in Demo and in a Lite build
   — check the assembled editions, not just `shared/`. Every entry point guarded by
   `isCloudAvailable()` (invariant 8).
2. **Conflicts.** Two devices edit the same record offline; one archives while the other
   edits; a record created on both (the same `crypto.randomUUID()` can't collide, but the
   same *real* dog can). What wins, what is told to her, and can an edit be lost with no
   trace? S1 territory — be specific about the resolution rule you find, not the one the
   plan describes.
3. **Partial sync.** A push that fails halfway, a pull interrupted, a device whose clock is
   wrong (every `updated_at` comparison), a record whose table didn't exist in the other
   device's schema version.
4. **The private tier.** `private` fields must never reach the server in plain form: trace
   one (an account password, a contract note) from the form to the request body. Cross-check
   `cloud/src/lib/cloudFields.js` against `syncRegistry` — it is generated, so drift means
   somebody edited one side only.
5. **What the breeder sees.** 1,654 lines of backup UI: the first backup on a slow
   connection, a quota or entitlement refusal, a restore-from-cloud onto a device with
   records, sign-out with unsynced changes, "last synced" wording when it is stale or
   unknown. Any screen that can leave her unsure whether her data is safe is at least S3.
6. **Entitlement and the lapsed subscription:** what sync does, what she can still get out
   (an export must always work), and whether anything silently stops.

---

### Session K4 — The cloud Worker

**Read** `cloud/src/*`: `index.js`, `api.js` (190), `auth.js` (173), `sync.js` (310),
`backup.js`, `snapshots.js` (239), `files.js`, `retention.js` (231), `ops.js` (403),
`mail.js` (285), `notify.js` (571), `geo.js`, `ratelimit.js`, `gate.js`, `notice.js`,
`program.js`, `devices.js` (160), `recovery.js` (139), `emailChange.js` (130),
`health.js`, `serverMoves.js` (348), `migrate.js`, `migrations/*.sql` (0001–0019) and
`migrations/index.js`, `lib/*`, `cloud/wrangler.toml`, `cloud/README.md`.
Tests: everything under `cloud/tests` (279 pass) — read `worker`, `auth`, `sync`,
`retention`, `ops`, `migrate`, `mail`, `notify`, `devices`, `recovery`, `serverMoves`.
Contract: Cloud Phase 1 §6–§9, Phase 2 Sync, `cloud/README.md`, the server rules in
CLAUDE.md (new migration = new file + its line in `index.js`; never edit an applied one;
never log emails, codes, tokens or bodies).

**Evaluate**
1. **Migrations.** `0001`–`0019` in order, each listed in `index.js`, none edited after
   being applied. README says production has through `0016`, with `0017` (R2 orphan sweep
   state), `0018` (notifications) and `0019` (mail counts) waiting on a deploy. So: does the
   Worker's current code read tables or columns those three add? If yes, the next deploy
   breaks before the migration is applied from `/ops` — walk that order and say what a
   breeder sees in the window between. That is this session's first question.
2. **Logging.** Grep every `console.*` for an email, a code, a token, a body or a record.
   One leak is S1.
3. **Auth.** Code TTLs, attempt limits, `ratelimit.js` buckets and their keys, session
   lifetimes, device rows, `recovery.js` and `emailChange.js` (the two flows that can hand
   an account to the wrong person — check every step for a confirmation the real owner must
   pass).
4. **Retention and the sweeps.** `retention.js`, the R2 orphan sweep, the crons in
   `wrangler.toml`: idempotency, a skipped week, a run that dies halfway, per-run caps and
   whether a backlog ever drains. Does any sweep delete something a live program still
   points at?
5. **Snapshots and files.** Size caps, how many are kept, what a restore reads, partial
   uploads, and R2/D1 pairs that can fall out of step (which side leaks).
6. **`/ops`.** Auth, CSP, and every destructive action: how far is it from a mis-click, and
   is anything irreversible without a confirmation that names what will go?
7. **Mail and notify.** `notify.js` (571) and `mail.js`: the VAPID key and migration `0018`
   are not in place yet, so read for what happens when a push subscription is dead, when a
   send fails, when a digest has nothing in it, and whether a failed email is retried,
   dropped silently, or reported. Per-account send counts (`0019`) and their limits.
8. **`serverMoves.js`** (348): the server-side record moves — the riskiest write the server
   does. Idempotency and what happens on a retry.

---

### Session K5 — The vault, the licence, and account identity

**Read** `shared/data/cloud/vaultCrypto.js` (323), `vaultPasskey.js` (166),
`vaultKeyStore.js`, `cloudVault.js` (523), `cloud/src/vault.js` (331),
`shared/data/license.js` (319), `assets/licenseGate.js` (228), `cloudVaultUI.js` (665),
`cloud/src/license.js` (329), `shared/data/cloud/cloudAuth.js`, `cloud/src/recovery.js`,
`assets/vendorKeyUI.js`, `shared/data/*KeyStore.js`.
Tests: `vaultCrypto`, `vaultPasskey`, `cloudVault`, `license`, `cloudEntitlement`,
`cloud/tests/vault`, `license`, `recovery`.
Contract: `docs/KennelOS_Private_Vault_Plan.md`, `docs/KennelOS_License_Link_Plan.md`,
guide §0 (licence gate).

**Evaluate**
1. **The crypto.** Key derivation, salts, IV reuse, AES-GCM usage, where keys live
   (`device_secrets` as a `CryptoKey`, never exported), what a wrapped key's envelope
   carries, and whether any plaintext of a private field can reach the server or a log.
2. **Losing access.** Forgotten passphrase, lost passkey, a new phone, a passkey the
   platform refuses, a device wiped. Is there always a path back that does not destroy her
   vault, and is it explained *before* she locks something away?
3. **Passkeys on real platforms.** iOS/Safari vs Android/Chrome quirks (user-verification,
   discoverable credentials, conditional UI), and the fallback when WebAuthn is unavailable.
4. **The licence gate.** Activation, the grace period and its banner, a failed check while
   offline, a key used on too many devices, a refund/expiry, and — critically — whether a
   lapse can ever lock her away from her **own local data** or an export. It must not.
5. **Variant patterns.** `yearlyVariantPattern` / `lifetimeVariantPattern` are open launch
   items: what happens today when a real variant name doesn't match (silently treated as
   monthly? no entitlement?). Say exactly what the breeder experiences.

---

### Session K6 — The waitlist engine: positions, turns, offers, passes

**Read** `waitlistRules.js` (1508), `waitlistActions.js` (1488), `waitlistEntryRepo.js`,
`waitlistOfferRepo.js`, `waitlistProgramRepo.js`, `waitlistEvents.js` (319),
`waitlistReview.js`, `rosterCount.js`, `tidyRules.js` (428),
pages `waitlist-entry.js` (1956), `waitlist.js`, `waitlist-programs.js`,
assets `waitlistUI.js` (644), `waitlistReviewUI.js` (1071), `waitlistPicksPanel.js`.
Tests: `waitlistRules`, `waitlistTurns`, `waitlistEvents`, `waitlistReview`,
`waitlistLostPup`, `waitlistPrivateListing`, `waitlistInbox`, `tidyRules`, `rosterCount`.
Contract: `docs/KennelOS_Waitlist_Spec.md` §4 onward, `_W2_Plan.md`, guide §29.

**Evaluate**
1. **Position is derived, never stored.** Prove it everywhere, and check the derivation is
   stable: two entries added the same second, an entry paused and resumed, a program
   changed, a listen-list entry that matches two litters. If position can flicker between
   two reads, families see different numbers on two screens — S1.
2. **Turns and deadlines.** The whole clock: a turn opened, passed, expired, extended,
   reopened; a deadline crossing a DST boundary or a month end; a turn on a litter that got
   smaller; two offers for one puppy; an offer to an entry that left. Timezones are the
   recurring hazard — pin down which clock each deadline uses.
3. **Passes and their count.** Derived from offers: does every path that creates or voids an
   offer keep that count honest, including a deleted litter and a merged contact?
4. **The three-and-a-half thousand lines** of rules + actions + entry page. Look for the
   same rule implemented twice (the engine and the page), which is where the two drift.
   Name every duplicate you find; each is an S4 that becomes an S1 on the next rule change.
5. **Events.** Every waitlist action writing its `HistoryEvent`, so the family's story is
   reconstructable; an action that half-applies leaving an event with no effect, or an
   effect with no event.
6. **Tidy up** (`tidyRules`): what it offers to change, and whether anything it does is
   irreversible or surprising. README notes it covers only dogs and contacts for duplicates
   — that is known, not a finding.
7. The entry page by the **page recipe** (§0a), with extra attention to its length: 1,956
   lines on one screen means state that can get out of step between panels.

---

### Session K7 — The waitlist online: applications, the public list, family pages

**Read** `waitlistForm.js` (402), `waitlistCrypto.js`, `waitlistProjection.js` (677),
`cloud/cloudWaitlist.js` (652), `cloud/src/waitlist.js` (352),
`cloud/src/familyPages.js` (960), `cloud/src/familyActions.js` (380),
`cloud/public/family/*`, `shared/companion-view.html` (652) if it overlaps,
pages `waitlist-form.js`, `waitlist-publish.js`, `applications-report.js`,
assets `waitlistApplicationForm.js`, `waitlistOnlineUI.js`, `waitlistSetupUI.js` (416),
`shared/data/waitlistInbox.js`, `jotformMatch.js`.
Tests: `waitlistForm`, `waitlistCrypto`, `waitlistProjection`, `waitlistEmbed`,
`cloudWaitlist`, `waitlistInbox`, `cloud/tests/waitlist`, `familyPages`, `application`,
`familyActions`.
Contract: Waitlist Spec (the online half), W2 plan, `docs/KennelOS_Family_Help_Plan.md`,
guide §29.

**Evaluate**
1. **What is public.** Walk the projection field by field and ask of each: would a breeder
   expect a stranger to see this? Names and masking ("A***** K"), the gap note for paused
   families, dates, wants, breeds, prices, puppy availability. Then check the *same* rules
   hold on every surface that draws from it (the public list, the status page, the embed,
   the website feed) — one surface showing more than the others is S1.
2. **The sealed application.** `waitlistCrypto` / `seal.js`: key handling, rotation, a
   stale public key in a cached page, what a family sees when sealing fails, and whether an
   application can be lost between "sent" and "in the breeder's inbox".
3. **Verification and sessions.** The emailed code, its TTL and limits, the status-page
   token, sign-in on a new device, and whether any link or token in an email grants more
   than the family's own entry.
4. **Limits and abuse.** Turnstile, per-address and per-email limits, a duplicate
   application, a flood. What a legitimate family sees when it trips a limit.
5. **The breeder's inbox.** An application that doesn't match an existing contact, one that
   matches two, the accept/decline flow, and whether declining ever silently deletes what
   the family wrote.
6. **The family's experience**, end to end, on a phone: apply → code → status page → a
   change request → a message. The Family Help plan is the contract for the words. Every
   dead end here is at least S3, and families are the least forgiving audience in the app.

---

### Session K8 — Family requests, pickup, transport, fees, emails

**Read** `familyExtras.js`, `familyPickup.js`, `pickupSlots.js` (149),
`transportFee.js`, `backOut.js`, `depositRequest.js`, `waitlistFeeLinks.js`,
`waitlistFeePay.js`, `waitlistEmails.js` (237), `waitlistOutbox.js` (185),
`waitlistReports.js` (350), `extraCharges.js` (369), `processingFees.js`,
assets `pickupTimesPanel.js`, `pickupTransportStep.js`, `waitlistFeeStep.js`,
`waitlistEmailUI.js`, `messageComposer.js`, `paymentRequestUI.js`,
`cloud/src/notify.js` where it serves these, `cloud/src/geo.js` (driving miles).
Tests: `familyPickup`, `fureverPickup`, `extraCharges`, `processingFees`, `backOut`,
`depositRequest` coverage, `waitlistEmails`, `waitlistMessages`, `feePay`.
Contract: `docs/KennelOS_Family_Requests_Plan.md`, Waitlist Spec's money sections,
guide §29.

**Evaluate**
1. **Money in a family-facing flow.** Fees, deposits, processing fees, extras, transport per
   mile: every rounding, every currency assumption, every place a number is shown to a
   family and a different number is recorded for the breeder. An inconsistency here is S1.
2. **`MAPBOX_TOKEN` is not set yet** (README): what the transport suggestion does with no
   token — a blank mile count, a thrown error, a silent zero fee? The deploy is coming, so
   the question is whether the code is ready and whether the UI degrades honestly.
3. **Pickup slots.** Double-booking, timezones, a slot the breeder removes after a family
   took it, a family in another timezone reading a time.
4. **Backing out.** What is refunded, what is kept, what the records say afterwards, and
   whether the puppy returns to the right place in the queue (cross-check K6).
5. **Email and the outbox.** A send that fails, a queued message after days offline,
   duplicate sends on a retry, and the words themselves — these emails are the kennel's
   voice to a family.

---

### Session K9 — Dogs, litters, pairings, events, nudges, Today

**Read** pages `dog.js` (1619), `litter.js` (1083), `pairing.js` (557), `breeding.js`,
`dogs.js`, `today.js` (578), `calendar.js`, `reminders.js`, `shows.js` is K14;
data `nudges.js` (1236), `nudgeState.js`, `awayBoard.js`, `calendarMath.js`,
`dogCare.js`, `prepPups.js`, `litterCheckin.js` (266), `goHome.js`, `keeperTests.js`,
`healthTestLog.js`, `studRules.js`, `dogRegistrations` coverage, `puppyDefaults.js`,
`eventRepo.js` (if K1 didn't finish it), `kennelTree.js`,
assets `eventForm.js` (663), `dogCheckinUI.js`, `litterCheckinUI.js` (678),
`prepPupsUI.js` (766), `healthTestsUI.js`, `puppyForm.js`, `keeperTests.js`, `timeline.js`.
Tests: `dogCare`, `dogRegistrations`, `dogSearch`, `goHome`, `keeperTests`,
`healthTestLog`, `litterCheckin`, `prepPups`, `studRules`, `linkedStatusNudges`,
`calendarMath`, `closedDates`, `eventRepo`, `kennelTree`, `saleStatus`.
Contract: guide §4, §8, §19 (nudges and the away board), §25 (foster whelps), §33 where
Kels touches these.

**Evaluate**
1. **One Dog record for a whole life** (CLAUDE.md "decided"): every status transition —
   puppy → active breeding → retired → deceased, kept pup, sold pup, foster in/out,
   co-ownership. Does any path create a second record, or leave a dog in two states?
2. **The polymorphic Event.** `subject_type`/`subject_id` on every write, no bare `Event`
   module, archived subjects, an event whose subject was merged, and the timeline's
   behaviour with 500 events on one dog (time it).
3. **Nudges** (1,236 lines, the most-read screen's brain): a nudge that fires forever
   because its "done" condition can't be met; a nudge that never fires; the away-board
   union; `nudgeState` persistence and a dismissal that doesn't stick; the same nudge in two
   voices on Today and in Kels. Today is where a breeder starts her day — a wrong nudge is
   S3 but a *missed* whelping or health deadline is S1.
4. **Dates.** Date-only fields are `YYYY-MM-DD` strings; only `created_at`/`updated_at` are
   ISO. Grep for a `new Date(...)` on a date-only string (timezone shift → a whelp date off
   by one day) and for any place a date-only string is compared to a timestamp.
5. **Litter arithmetic.** Puppy counts, sexes, weights, going-home dates, a pup removed, a
   stillborn, a fostered litter, a litter with no pairing, a pairing with two litters.
6. **The two big pages** by the page recipe, with attention to partial saves across their
   many panels.

---

### Session K10 — Money: sales, invoices, contracts, expenses, reports

**Read** pages `sale.js` (1159), `sales.js`, `financials.js` (680), `contract.js` (612),
`invoice.js`, `puppy-record.js` (428), `year-review.js`, `offers-removals-report.js`,
`applications-report.js`, `dashboard.js`;
data `incomeView.js` (537), `expenseRepo.js`, `extraCharges.js`, `processingFees.js`,
`receivedCredits.js`, `litterFinances.js`, `moneyReport.js`, `reportMath.js` (218),
`reportSources.js` (327), `reportCatalog.js`, `reportFigures.js`, `breedingReports.js`,
`kennelInsights.js` (391), `yearReview.js`, `saleRepo.js`, `saleDefaults.js`,
`contractForms.js` (297), `contractRepo.js`, `contractSend.js`, `jotformSigned.js`,
`paymentLinks.js`, `stripeLinks.js`, `stripeApi.js`, `pdfBuild.js`, `puppyRecordFields.js`,
assets `expensePanel.js`, `invoiceDoc.js`, `invoiceGenerator.js`, `invoicePdf.js`,
`reportView.js`, `chartView.js`, `priceListEditor.js`, `salePrompts.js`.
Tests: `extraCharges`, `processingFees`, `receivedCredits`, `saleDefaults`, `saleStatus`,
`reports`, `breedingReports`, `reportMath` coverage, `invoicePdf`, `contractForms`,
`paymentLinks`, `stripePayments`, `puppyRecordFields`, `kennelInsights`, `yearReview`.
Contract: guide §21 (financials), §22 (referrals), §23 (puppy record), §24 (invoices),
§31 (reports), `docs/KennelOS_Reports_Plan.md`.

**Evaluate**
1. **Every number that appears twice.** A sale's total on the sale page, the invoice, the
   receipt, the litter's finances, the income view, the report and the year review. Build
   one scenario (a sale with a deposit, an extra, a processing fee, a credit and a refund)
   and follow its amount through all seven. Any disagreement is S1 — this is the single
   most valuable exercise in this session.
2. **Rounding and currency.** Where money is a float, where it is cents, where a percentage
   is applied, and whether a half-cent ever lands differently in two places.
3. **Refunds, credits, cancelled sales, a pup returned.** What the ledger says afterwards,
   and whether anything can go negative that shouldn't.
4. **Invoices and PDFs.** `pdfBuild` / `invoicePdf` on a phone, a long kennel name, a
   15-line item list, a logo that fails to load, print vs screen, and whether a generated
   document ever shows a stale figure.
5. **Contracts.** `contractForms` field mapping, a contract sent then edited, `jotformSigned`
   (the Jotform steps are unproven per README — read for what happens on an unexpected
   payload), and whether a signed document is ever overwritten.
6. **Reports.** `reportSources`/`reportMath`: date-range boundaries (inclusive ends,
   timezones), archived records in or out, an empty range, a 10-year range, and whether two
   reports that should agree do.

---

### Session K11 — Kels and the guided tasks

**Read** `shared/pages/kels.js` (495), `assets/kelsSteps.js` (378), `kelsChat.js` (300),
`kelsFindUI.js`, `kelsUnderstandUI.js`, `kelsInsightsUI.js`, `kelsSetupUI.js` (623),
`kelsApplicant.js`, `kelsFindings.js`, `kelsBackupSteps.js`, `kelsFavorites.js`;
data `kelsAbout.js` (249), `kelsFind.js` (233), `kelsUnderstand.js` (276),
`kelsKnowledge.js` (198), `kelsSetup.js`, `kelsFavorites.js`,
`guidedDogs.js` (617), `guidedLitter.js` (722), `guidedPeople.js` (412),
`guidedForm.js`, `wizardSteps.js` (422), `wizardState.js`, `tidyRules.js` (if K6 left it),
assets `guidedDogsUI.js` (715), `guidedLitterUI.js` (728), `guidedPeopleUI.js` (593),
`guidedFormUI.js`, `wizardUI.js` (404), `tidyUpUI.js` (725), `guidedShareUI.js`,
`shared/assistant.js` (429), `assistantStore.js`, `assistantSync.js`.
Tests: `guidedDogs`, `guidedLitter`, `guidedPeople`, `guidedForm`, `kelsAbout`,
`kelsFind`, `kelsSetup`, `kelsUnderstand`, `kelsFavorites`, `tidyRules`.
Contract: `docs/KennelOS_Kels_Roadmap.md`, guide §33.

**Evaluate**
1. **Abandonment.** Every task, left halfway: a closed tab, a phone call, a back button, a
   reload. What is already written, what is lost, and does resuming land her where she was
   or start again? Half-written records with no way back are S2.
2. **Nothing written without her saying so.** Walk each task for a write that happens before
   a confirm, a pre-ticked box that changes data, or a default that commits.
3. **Asked twice.** The same question from Kels and from a page; the same offer after it was
   declined; a task that reopens what a previous one settled.
4. **Wizard state.** Where it lives (`wizardState`, `assistantStore` — `localStorage`?),
   whether it survives a schema upgrade, and whether stale state can drive a task into a
   record that no longer exists.
5. **Demo and Lite.** Kels in Demo (read-only) and in Lite (capped, reduced surface): does
   any task offer what the edition can't do, or hit the cap mid-flow with no way out?
6. **The words.** Kels is the app's voice; read every step aloud. A step that asks for a
   decision without the information to make it is S3.

---

### Session K12 — Integrations, accounts and notifications

**Read** `jotformApi.js`, `jotformConnect.js`, `jotformMatch.js` (193),
`jotformSigned.js`, `jotformKeyStore.js`, `stripeApi.js` (156), `stripeLinks.js`,
`stripeKeyStore.js`, `integrationEvents.js` (142), `integrationApply.js`,
`cloud/cloudIntegrations.js`, `cloud/src/integrations.js` (229),
page `accounts.js` (682), `accountHealth.js` (173), `assets/accountHealthUI.js` (400),
`referralShare.js`, `assets/vendorKeyUI.js`, `assets/notificationsUI.js`,
`cloud/src/notify.js` (571), `shared/data/cloud/cloudNotify.js`.
Tests: `jotformConnect`, `jotformSigned`, `cloudIntegrations`, `accountHealth`,
`referralShare`, `stripePayments`, `paymentLinks`, `cloud/tests/integrations`, `notify`.
Contract: `docs/KennelOS_Integrations_Plan.md`, `docs/KennelOS_Notifications_Plan.md`,
guide §32.

**Evaluate**
1. **Keys.** Jotform and Stripe keys in `device_secrets`, never in a backup, the cloud or a
   log; what happens when a key is revoked, wrong, or belongs to another account; whether a
   key is ever sent anywhere but its own vendor.
2. **Unproven flows** (README: the Jotform steps still need a real account). Read them for
   what happens on an unexpected payload, a renamed field, a form the breeder edited, a
   webhook replay, and a submission that matches no entry. The deploy is coming — say which
   of these would fail on first contact with a real account.
3. **Accounts page** (682 lines) by the page recipe, plus: private-tier fields
   (`username`, `password`, `customer_id`) never leaving plain, referral fields being the
   shareable half, and `accountHealth`'s judgements being right rather than alarming.
4. **Notifications.** Push: permission, a dead subscription, iOS's installed-app
   requirement, the VAPID key not being set yet (what the UI does meanwhile), migration
   `0018` pending. Email digests: an empty digest, a daily digest after a week offline,
   unsubscribe, and the send counts added by `0019`. A notification that promises something
   the app can't show when tapped is S2.

---

### Session K13 — Editions, the build, first run, PWA, the marketing site

**Read** `shared/data/editionConfig.js` (145, the Pro default), `lite/editionConfig.js` and
the rest of `lite/` (714), `pro/` (140), `demo/` (112), `editionTour.js`, `proPages.js` (144),
`assets/editionLinks.js` (248), `upgradeBridge.js`, `assets/upgradeNudge.js`,
`demoMode.js`, `appReset.js`, `build/assemble.mjs` (+ `build/README.md`),
`shared/sw.js` (544), `shared/app.js` (214), `shared/nav.js`, `shared/index.html`,
`sampleData.js` (1436), `seedImport.js`, `kennelSetup.js`, `kennelSetupRepair.js`,
`assets/onboardingUI.js`, `assets/sampleDataUI.js`, `assets/licenseGate.js`,
`site/*` (21 files, 3.2k), `.github/workflows/deploy.yml`.
Tests: `editionConfig`, `serviceWorker`, `upgradeBridge`, `kennelSetupRepair`,
`restoreMyKennel`, and `node build/assemble.mjs --release`.
Contract: `docs/KennelOS_Lite_Pro_Editions_Plan.md`,
`docs/KennelOS_Lite_Cap_Enforcement_Spec.md`, guide §0, §11, §12,
`docs/LAUNCH_CHECKLIST.md`.

**Evaluate**
1. **The cap, at every door.** The spec names three call sites (`dogRepo.create`,
   `dogRepo.update`, `litterRepo.create`). Enumerate **every** path that can create a dog or
   a litter — CSV import, JSON restore, cloud restore, sample data, Kels's Add dogs,
   guided litter, a Furever seed, a merge — and say which ones can walk past the cap. A Lite
   program that silently exceeds its cap, or a restore that half-imports and stops, is S2.
2. **Demo is read-only.** Find a write that gets through: a direct repo call, a settings
   write, a cloud request, a Kels task, an import. Each is S2.
3. **Lite → Pro.** The handoff (`upgradeBridge`), an export from Lite restored into Pro with
   records already there, the archive-on-departure behaviour Lite adds, and whether a Lite
   file ever loses the fields Pro would have kept.
4. **The build.** `assemble.mjs`: every overlaid file, `proPages.js` completeness (a
   Pro-only file left in the Lite build, or a shared file wrongly dropped), `--release`'s
   placeholder gate, and whether the three `dist/` builds actually run (serve each and open
   it).
5. **The service worker.** 544 lines: what is cached, what is network-first, what happens on
   a `CACHE_NAME` change (the user-visible update path — does she get a prompt, a silent
   swap, or a half-old app?), a failed precache entry, and the app running from cache against
   a newer cloud API.
6. **First run.** A fresh origin: onboarding, kennel setup, sample data in and out
   (`sampleData.js` is 1,436 lines — does removing it leave anything behind?),
   `kennelSetupRepair`, and `requestPersistentStorage` being asked at the right moment.
7. **The marketing site.** Every page loads, the nav works on a phone, the six checkout
   links are present (clicking them is a launch step, not a review one), and nothing
   contradicts what the editions actually do.

---

### Session K14 — Multi-kennel, shows, kennel identity, Companion, Furever

**Read** page `kennel.js` (1083), `kennels.js`, `kennelRepo.js` (347), `kennelScope.js`,
`assets/kennelScopeUI.js`, `kennelCard.js` + `kennelCardUI.js`, `kennelTree.js` +
`assets/kennelTree.js`, `assets/kennelSetupUI.js`, `kennelSettingsFields.js`,
page `shows.js` (359) + `showPoints.js` (206), `companionExport.js` (554),
page `companion.js` (450), `shared/companion-view.html` (652), `assets/companionLink.js`,
`assets/pickToSend.js` (379), `fureverSeedExport.js`, `fureverContentPack.js` (215),
`page furever.js` (926), all of `furever/` (65 files, 6k),
`shared/data/settings.js` (946), `shared/pages/settings.js`.
Tests: `kennelCard`, `kennelTree`, `kennelInsights`, `rosterCount`, `showPoints`,
`fureverShareable`, `fureverPickup`, `pickToSend`, `scopePredicates`.
Contract: `docs/KennelOS_Multi_Kennel_Scope_Spec.md`,
`docs/KennelOS_Show_Tracking_Spec.md`, guide §20, §27, §28,
`docs/KennelOS_Furever_*.md`, `furever/README.md`,
`docs/KennelOS_Content_Package_Fetch_Mechanism.md`.

**Evaluate**
1. **Several own kennels.** Scope on every list, report, nudge, total and export; a record
   created while one kennel is active and read while another is; a kennel archived with
   records; "program-wide" tables appearing in the wrong kennel's figures. Multi-kennel
   leaks are quiet and S1 when money or a family is involved.
2. **Companion share-out.** What leaves (an allow-list?), what a buyer or partner can see,
   a link that outlives the relationship, and whether `companion-view.html` can ever be
   pointed at someone else's package.
3. **Furever seed packets and content packs.** What personal data travels into a family's
   app, the Google Drive publish path, a pack that fails to fetch, and version skew between
   a published pack and the app reading it.
4. **Furever itself** (6,000 lines, its own Dexie db): review it as its own small app
   against `furever/README.md` and the briefs — schema, import/export, offline, and the page
   recipe on its eight pages. If the session runs short, this is the part to hand to a
   follow-up; say so.
5. **Shows** against the Show Tracking spec: points arithmetic, a show with no result, a
   title earned (which feeds dog titles elsewhere — cross-check K9).
6. **`settings.js`** (946 lines): what is per-device vs per-program, what syncs, what a
   missing setting defaults to, and whether any page bypasses it for `localStorage`
   (invariant 1).

---

### Session K15 — The UI layer: escaping, accessibility, phone, offline

**Read** `shared/assets/ui.js` (280), `listView.js` (276), `chartView.js` (394),
`reportView.js` (331), `printView.js`, `timeline.js`, `pedigree.js` (233),
`assets/app.css`, `shared/nav.js`, `shared/app.js`, `shared/index.html`,
plus whatever your scanners point you at across `shared/pages` and `shared/assets`.
Contract: guide §13 (the UI layer), invariant 4, the dataviz guidance for charts.

**Evaluate**
1. **Write the escaping scanner.** The single-line surface is already clean (§0); the
   unchecked surface is multi-line template literals assigned to `innerHTML` or passed to
   the modal/list builders. Extract each template literal, list its `${…}` expressions, and
   flag any that is not `esc(...)`, a number, a known-safe constant or a nested builder.
   Report the real misses with a proof string (a kennel name containing `"><img src=x
   onerror=...>`), and say how many expressions you cleared. The scanner itself is a
   deliverable — paste it into your findings file so a future session can re-run it.
2. **`listView` cells** specifically: the rule names them, and they are the densest
   user-value path in the app.
3. **Accessibility basics**, judged on real pages: a modal that traps focus and returns it,
   `aria-modal` with a real label, keyboard reachability of every control, form labels, a
   table with headers, focus visibility, and the "role=dialog with no reachable close"
   pattern. Dark text on the accent colours (contrast) if the app has a dark mode.
4. **Phones.** Open the ten busiest pages at 320px and at a real phone size in Playwright.
   No sideways scroll; tables scroll in their own box; a modal fits; the nav works; a long
   kennel name doesn't push the header off. Screenshot anything you report.
5. **Charts** (`chartView`): colour choices that survive colour-blindness and dark mode,
   axes with units, an empty series, a single data point, and a chart that is really a
   table.
6. **Offline and slow.** With the SW serving and the network off: which pages work, which
   say so, which spin forever. Then the db-blocked banner, and a page opened while a schema
   upgrade waits.

---

### Session K16 — Consolidation (after K1–K15)

Read every findings file. Produce `docs/review/SUMMARY.md`:
- de-duplicated findings ranked S1 → S4, each with its one-line scenario;
- **themes** — the repeated shapes across sessions (a rule implemented twice and drifted;
  a derived number computed two ways; a date-only string through `new Date`; a gate checked
  on the screen but not in the write; a limit with no message; a pending deploy step with
  no in-app degradation);
- a **fix order** that puts anything losing her records, leaking a family's data, or
  misstating money first, and groups the rest so one change closes several findings;
- the collected **test gaps**, as a short list of suites to write;
- what no session reached — Furever and the 85 HTML page shells are the likeliest
  leftovers.

Also reconcile with the KennelPort review's `SUMMARY.md` if that round has run: anything
the two rounds both touch (the waitlist projection, the cloud family endpoints, the four
website marks) should appear once, with both references.

Do not re-review. If a finding looks wrong, check it and say so in one line.

---

## 2. Suggested order

| Wave | Sessions | Why |
|---|---|---|
| 1 | **K1**, **K2** | The schema, the registries and the restore path: every other finding stands on these, and this is where data is lost outright. |
| 2 | **K3**, **K4**, **K5** | Other people's data, her backups, her money's keys. |
| 3 | **K6**, **K7**, **K8** | The biggest feature, and the only one families touch. |
| 4 | **K9**, **K10** | The daily app and every number in it. |
| 5 | **K11**, **K12**, **K13** | Guided flows, outside services, and the edition gates that hold the first two in. |
| 6 | **K14**, **K15** | Scope, the second app, and the surface a person actually looks at. |
| 7 | **K16** | Consolidate. |

Sessions within a wave are independent and can run in parallel. If only a handful ever run:
**K1, K2, K3, K6, K10, K13**, then K16.

The fattest sessions are K6 (≈6,500 lines), K9 (≈7,000), K10 (≈7,500) and K14 (≈11,000
with Furever). Each names where to split if it runs out of room — split rather than skim,
and say in "what I did not get to" exactly where the line fell.

## 3. Index of findings

`docs/review/INDEX.md` — one row per session: number, title, branch, date, counts by
severity, link to the findings file. Each session adds its own row; nobody edits another's.
