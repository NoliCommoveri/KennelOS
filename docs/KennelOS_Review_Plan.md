# KennelOS: a review of the whole app, run over several sessions

A read-only review of KennelOS against its plans and specs. Seventeen sessions (K1–K15,
K6b, then K16), because the app is about 120,000 lines: `shared/` ~90k of JavaScript (data
43k, pages 22k + 87 HTML files, assets 25k), `cloud/src` 8.2k, `furever/` 6.9k, `site/`
3.4k, with 21k lines of tests in `tests/` and 6k in `cloud/tests`.

> **Modified (2026-11-08):** brought up to date with the 57 commits that landed after the
> plan was first written (2026-11-03): assisted setup and account deletion, Dog Cards, the
> puppy portal feed, waitlist policies, the do-not-sell list, programs suggested by an
> answer, the 7-day undos, the picks preview and side sales, pedigree import and chart
> editing. Each is placed in a session below (see "New since the first draft" in §0), the
> baseline and the pending-deploy list are refreshed, and **K6b** is added for the picks
> preview, side sales and undos so K6 doesn't grow past what one session can hold.

**The seam with KennelPort is already planned separately** —
`Kennelport/docs/KennelPort_Review_Plan.md`, ten sessions, which cover `siteExport.js`,
`kennelportApi.js`, `kennelportLink*.js`, `websiteCard.js`, `websiteUpdateUI.js`, the
sealed application form and the three `/f/` endpoints a KennelPort site calls. Sessions
here do **not** re-review those files. Where your area feeds the website, note it in one
line and move on. One exception: the puppy portal feed (`portalFeed.js`,
`portalFeedSync.js`) arrived after both plans were written and sends family data from her
device by itself, so **K7** reviews its KennelOS side (what leaves, when, and what comes
back and is written without asking her); the KennelPort side stays with that plan.

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

**Green baseline (2026-11-08, `0328a3f`).** `node --test` in `/home/user/KennelOS` → 1639
pass. `cd cloud && npm test` → 303 pass. `node build/assemble.mjs` → succeeds. If your
session starts red, that is finding number one.

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
  migrations `0017`/`0019`/`0020` waiting to be applied after the next Worker deploy,
  real-phone checks for live sync, assisted setup not yet tried with a real user, Shared
  Dogs phases 2–3 (plans only), Kels's Tidy up covering only dogs and contacts.
  "Needs a deploy" is not a defect — but **code that cannot work once that deploy happens,
  or in the window before its migration is applied, is**, and that is exactly worth
  finding now. Notifications (VAPID, `0018`), `MAPBOX_TOKEN` and the KennelPort feed are
  **live** now: they are in scope like any other code.
- `docs/LAUNCH_CHECKLIST.md` items marked `[!]` (placeholders to swap at launch), and the
  open launch items in README Status (`yearlyVariantPattern` / `lifetimeVariantPattern`).
- Anything in the KennelPort seam (another plan).

**Already checked, don't spend a session on it** (done while writing this plan):
- `PRECACHE_URLS` is complete (451 entries at `kennelos-shell-v112`), and
  `tests/serviceWorker.test.js` guards it and passes. Spot-check only if your area adds files.
- The single-line `innerHTML` surface is clean: of 608 assignments, 26 interpolate without
  `esc(` on the same line and all 26 pass pre-escaped fragments or `.map(esc)`. The
  **unchecked** surface is multi-line template literals — see session K15, which writes a
  proper scanner for them.
- `shared/data/db.js` is at `version(7)` (`6` adds `dogs.public_id`, `7` adds
  `do_not_sell`), with the blocked-upgrade hand-off
  (`DB_BLOCKED_EVENT` / `DB_READY_EVENT` / `DB_VERSIONCHANGE_EVENT`) in place.
- `undefined/r1-signout-others.png` — a stray directory named `undefined` holding one
  committed screenshot. Repo hygiene, S4 at most; it is already reported here, so no
  session needs to re-find it.

**New since the first draft** (2026-11-03 → 2026-11-08, `4dfe76f..0328a3f`). The newest
code is the least reviewed, and most of it shipped in a day or two. Each item belongs to one
session; that session treats it as a first-class part of its scope, not a footnote.

| Feature | Main files | Session |
|---|---|---|
| Schema `version(6)` (`dogs.public_id`) and `version(7)` (`do_not_sell`) | `db.js`, `dogRepo.js`, `doNotSellRepo.js`, `referenceRegistry.js`, `syncRegistry.js` | K1 |
| Dog Cards: send dogs to another breeder's KennelOS, matched by `public_id` | `dogCard.js` (539), `pages/dog-cards.*` (393) | K2 (receiving side), K14 (the allow-list) |
| Pedigree import: AKC Certified Pedigrees, breeder as a contact, microchip | `pedigreeImport.js`, `pedigreeParse.js`, `pages/pedigree-import.js` | K2 |
| Pedigree chart: fix any spot in place; dog-picker order | `pedigreeEdit.js`, `assets/pedigree.js`, `dogRepo.js` | K9 |
| Account deletion (with erase), `account_deleted` on her devices, migration `0020` | `cloud/src/ops.js`, `auth.js`, `retention.js`, `cloudAuth.js`, `cloudDevices.js` | K4 (server), K5 (identity) |
| Assisted setup, Get help, the helper device, the KennelOS Assist manager app | `cloud/src/assist.js` (388), `assistApp.js` (253), `cloudAssist.js`, `cloudAssistUI.js` | K5 |
| Waitlist policies, the application's locked box, the policies nudge | `waitlistPolicies.js`, `assets/qaListEditor.js`, `waitlistForm.js`, `cloud/src/familyPages.js` | K7 |
| A question that suggests a program; program icons on the public list | `programSuggest.js`, `assets/programIcons.js`, `cloud/public/family/*` | K7 |
| Do-not-sell list, matched against applications | `doNotSell.js`, `pages/do-not-sell.*`, `contacts.js` | K7 (K1 for the table) |
| Puppy portal family feed: sent by itself, facts applied back | `portalFeed.js` (339), `portalFeedSync.js` (254), `kennelportLink*.js` | K7 |
| 7-day undo windows (removal, withdrawal, decline, fee expired, fee received) | `waitlistActions.js`, `waitlistRules.js`, `pages/waitlist-entry.js` | K6b |
| Picks preview before Open picks | `picksPreview.js` (309), `assets/picksPreviewModal.js` (457) | K6b |
| Side sales: a pick outside the turn order | `waitlistRules.js`, `waitlistActions.js`, `assets/sideSaleUI.js`, `waitlistProjection.js` | K6b |
| Website: co-owned dogs, transport accounts, a pup's disposition, the heat a pairing uses | `siteExport.js` | KennelPort plan (seam) — one line only |
| Marketing site, privacy policy and terms rewritten for sync, waitlist, website, alerts, support help | `site/*` | K13 |
| Pro-only additions: `dogCards` flag, `dog-cards.html`, `do-not-sell.html`, three assets | `editionConfig.js` ×4, `proPages.js` | K13 |

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
| How `shared/` works: data model, schema, repos, invariants, recipes | `docs/End_State_Design_and_Maintenance_Guide.md` — §4 data model (197), §5 schema (262), §6 repos (303), §7 referential integrity (359), §8 events (391), §14 conventions (981), §15 not built (997), §16 invariants (1009) |
| Editions, caps, licensing | `docs/KennelOS_Lite_Pro_Editions_Plan.md`, `docs/KennelOS_Lite_Cap_Enforcement_Spec.md`, guide §0 (16) |
| Import, export, backup | guide §9 (459), §10 (526), §26 (1463), §26.1 (1519) |
| First run, sample data, settings | guide §11 (677) |
| SW / PWA, UI layer | guide §12 (830), §13 (847) |
| Nudges and the away board | guide §19 (1062) |
| Companion share-out, Furever seed, kennel identity | guide §20 (1144), §27 (1551), §28 (1626) |
| Money: financials, referrals, puppy record, invoices | guide §21 (1200), §22 (1350), §23 (1361), §24 (1398) |
| Waitlist | `docs/KennelOS_Waitlist_Spec.md` (1681), `_W2_Plan.md` (755), `_Waitlist_Policies_Plan.md`, guide §29 (1671) |
| Picks preview, side sales | `docs/KennelOS_Picks_Preview_Spec.md`, `docs/KennelOS_Side_Sale_Spec.md` (decisions in each §9), guide §29 |
| Cloud backup, live sync, account deletion, assisted setup | `docs/KennelOS_Cloud_Phase1_Plan.md`, `_Phase2_Sync_Plan.md`, `docs/KennelOS_Assisted_Setup_Plan.md`, guide §30 (2324; assisted setup at 2354), §34 (3630), `cloud/README.md` |
| Vault, license link, integrations | `docs/KennelOS_Private_Vault_Plan.md`, `_License_Link_Plan.md`, `_Integrations_Plan.md` |
| Reports, shows, multi-kennel | `docs/KennelOS_Reports_Plan.md`, `_Show_Tracking_Spec.md`, `_Multi_Kennel_Scope_Spec.md` |
| Dog Cards | `docs/KennelOS_Shared_Dogs_Plan.md` (phase 1 only is built), guide §36 (3895) |
| The website and the puppy portal (seam) | guide §35 (3689), §35.1 (3823) |
| Kels | `docs/KennelOS_Kels_Roadmap.md`, guide §33 (2597) |
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
K3–K5 hold other people's data and her money's audit trail; K6–K8 (with K6b) are the
largest feature and the one families touch; K9–K12 are the daily app; K13–K15 are breadth, gating and
polish. K16 consolidates.

---

### Session K1 — Schema, repos, registries, referential integrity ★ start here

**Read** `shared/data/db.js` (274), `repoBase.js` (130), the per-entity repos
(`dogRepo` 336, `litterRepo`, `pairingRepo`, `contactRepo`, `kennelRepo` 347, `saleRepo`,
`studServiceRepo`, `contractRepo`, `expenseRepo` 233, `documentRepo`, `fileRepo`,
`accountRepo`, `breedFeedingScheduleRepo`, `waitlist*Repo`, `doNotSellRepo` 52),
`eventRepo.js` (274), `referenceRegistry.js` (237), `syncRegistry.js` (665),
`kennelScope.js` (174), `scopePredicates.js` (67), `recordMerge.js` (372),
`duplicateScan.js` (199), `vocab.js` (978), `dateUtils.js` (91), `findRecords.js`,
`dogSearch.js` (306), `contactSearch.js`, `appReset.js`, `demoMode.js`.
Tests: `referenceRegistry`, `syncRegistry`, `eventRepo`, `recordMerge`, `duplicateScan`,
`scopePredicates`, `vocab`, `dateUtils`, `rosterCount`, `cloudDirty`, `doNotSell`.
Contract: guide §4–§8, §14, §16.

**Evaluate**
1. **Additive-only schema.** All seven `version(N)` blocks against the rule: does each list
   only what it adds, and does any shipped block show signs of being edited? Index strings
   repeated across versions (version 3 and 5 both restate `expenses`; version 6 restates
   the whole `dogs` string from version 1) — is each restatement exactly the old string
   plus one index? A dropped index is a silent full-table scan.
   **New:** `dogs.public_id` is "write-once after it's minted" — find every path that could
   write it again or clear it (an edit form, a merge, a restore, a CSV update, a sync
   apply), and what two dogs with the same `public_id` do to Dog Cards. And `do_not_sell`:
   is it in `referenceRegistry` (`contact_id`, `source_entry_id`), `syncRegistry`, backups,
   `appReset`, and sample-data removal like every other table?
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
`csvImport.js` (1947), `csvImportHelp.js` (255), `csvBatch.js`, `pedigreeImport.js` (352),
`pedigreeParse.js` (377), `pedigreeReader.js`, `documentRepo.js`, `fileRepo.js`,
`dropbox.js` (234), `googleDrive.js` (226), `ocr.js`, `receiptCapture.js`,
`dogCard.js` (539, the receiving side; K14 owns what leaves),
pages `import-export.js` (447), `import-batch.js`, `expense-import.js`,
`kennel-tests-import.js`, `pedigree-import.js`, `dog-cards.js` (344), assets
`importView.js`, `importHelp.js`, `documentModal.js`, `mergeQuestions.js`.
Tests: `importExport`, `csvImport`, `csvImportHelp`, `csvBatch`, `restoreMatch`,
`restoreMyKennel`, `pedigreeImport`, `pedigreeParse`, `pedigreeOnly`, `fileMerge`,
`duplicateScan`, `recordMerge`, `dogCard`, `seedImport` coverage.
Contract: guide §9, §10, §26, §26.1, §36 (Dog Cards), the Shared Dogs plan §3 and §5, and
the backup-compatibility rules in CLAUDE.md.

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
8. **Dog Cards, received** (new). A card is another breeder's data landing in her records.
   Sent twice, it must update the same dogs, never duplicate them: try a card whose dog she
   already typed in by hand (no `public_id`), a card naming an ancestor she has under a
   different spelling, a card that changes a dog she has since edited herself (whose edit
   wins, and is she told?), a card from a newer build with fields this one doesn't know, a
   tampered or truncated card, and a whole-program card that fails halfway. Does applying a
   card ever overwrite her own notes, status, ownership or a sire/dam she set? The Shared
   Dogs plan §5 says each breeder keeps her own say — check the code keeps it.
9. **Pedigree import** (recent, three fixes in a week): AKC Certified Pedigrees, the
   chart's breeder saved as a contact (a duplicate contact on every import?), the
   microchip number (overwriting one she had?), names with digits and honorifics, and a
   pedigree whose dogs half-match her own.

---

### Session K3 — Cloud client: backup, live sync, conflicts

**Read** `shared/data/cloud/cloudBackup.js` (839), `cloudSync.js` (523),
`syncRecords.js` (149), `syncApply.js` (167), `syncState.js`, `syncActivity.js`,
`cloudApi.js` (358), `cloudDevices.js` (214), `cloudEntitlement.js`, `cloudConfig.js` (163),
`serverWork.js`, `syncRegistry.js` (665, the client half),
assets `cloudBackupUI.js` (1680), `cloudSyncUI.js` (471). (Account deletion, the
`account_deleted` answer and assisted setup are K5's; note where they touch sync and move on.)
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

**Read** `cloud/src/*`: `index.js`, `api.js` (214), `auth.js` (183), `sync.js` (310),
`backup.js`, `snapshots.js` (239), `files.js`, `retention.js` (236), `ops.js` (497),
`mail.js` (285), `notify.js` (571), `geo.js`, `ratelimit.js`, `gate.js`, `notice.js`,
`program.js`, `devices.js` (160), `recovery.js` (139), `emailChange.js` (130),
`health.js`, `serverMoves.js` (352), `migrate.js`, `migrations/*.sql` (0001–0020) and
`migrations/index.js`, `lib/*`, `cloud/wrangler.toml`, `cloud/README.md`.
(`assist.js` and `assistApp.js` are K5's; read them here only for logging and the
maintenance gate.)
Tests: everything under `cloud/tests` (303 pass) — read `worker`, `auth`, `sync`,
`retention`, `ops`, `migrate`, `mail`, `notify`, `devices`, `recovery`, `serverMoves`,
`accountDeletion`.
Contract: Cloud Phase 1 §6–§9, Phase 2 Sync, `cloud/README.md`, the server rules in
CLAUDE.md (new migration = new file + its line in `index.js`; never edit an applied one;
never log emails, codes, tokens or bodies).

**Evaluate**
1. **Migrations.** `0001`–`0020` in order, each listed in `index.js`, none edited after
   being applied. README says production has through `0016` (plus `0018`, notifications,
   which are live), with `0017` (R2 orphan sweep state), `0019` (mail counts) and `0020`
   (`account_deletions`) waiting to be applied from `/ops` after the next deploy. So: does
   the Worker's current code read or write tables or columns those three add? If yes, the
   next deploy breaks before the migration is applied — walk that order and say what a
   breeder sees in the window between. `0020` is the sharp one: if `auth.js` checks
   `account_deletions` on every request, a missing table could turn every sign-in into an
   error. That is this session's first question.
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
   is anything irreversible without a confirmation that names what will go? **New:**
   deleting an account (with or without "erase its devices") is now one of them — the
   wrong account picked from a list, a delete retried, and whether `account_deletions`
   (token hashes, pruned after 90 days by `retention.js`) can ever match a live session.
7. **Mail and notify.** `notify.js` (571) and `mail.js` are live: read for what happens when
   a push subscription is dead, when a send fails, when a digest has nothing in it, and
   whether a failed email is retried, dropped silently, or reported. Per-account send counts
   (`0019`, not yet applied) and what the code does until they exist.
8. **`serverMoves.js`** (348): the server-side record moves — the riskiest write the server
   does. Idempotency and what happens on a retry.

---

### Session K5 — The vault, the licence, and account identity

**Read** `shared/data/cloud/vaultCrypto.js` (323), `vaultPasskey.js` (180),
`vaultKeyStore.js`, `cloudVault.js` (525), `cloud/src/vault.js` (343),
`shared/data/license.js` (319), `assets/licenseGate.js` (228), `cloudVaultUI.js` (665),
`cloud/src/license.js` (329), `shared/data/cloud/cloudAuth.js` (188), `cloud/src/recovery.js`,
`assets/vendorKeyUI.js`, `shared/data/*KeyStore.js`; and the new identity surface:
`cloud/src/assist.js` (388), `cloud/src/assistApp.js` (253, the manager app),
`shared/data/cloud/cloudAssist.js` (117), `assets/cloudAssistUI.js` (265), the
`?assist=` hand-off in `shared/app.js`, and the `account_deleted` / erase path in
`cloudAuth.js` and `cloudDevices.js`.
Tests: `vaultCrypto`, `vaultPasskey`, `cloudVault`, `license`, `cloudEntitlement`,
`cloud/tests/vault`, `license`, `recovery`, `assist`, `accountDeletion`.
Contract: `docs/KennelOS_Private_Vault_Plan.md`, `docs/KennelOS_License_Link_Plan.md`,
`docs/KennelOS_Assisted_Setup_Plan.md` (its §4 names what the no-code key move trades
away), guide §0 (licence gate), §30 (account deletion at 2345, assisted setup at 2354).

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
6. **Assisted setup and Get help** (new, not yet tried with a real user). A third party's
   device holds her vault key and signs in as her. Judge it as an access-control design:
   the one-time link (15 minutes, single use, what a leaked or forwarded link grants, a
   link opened in the wrong browser profile); the helper session's 90-day lifetime and
   what it can do that she can't see; the vault key moving between her devices and
   support's with no typed code (plan §4 — is the trade the plan describes the one the code
   makes?); whether help really ends when either side ends it (sessions revoked, key
   dropped from the helper, pushes stopped); the helper skipping the licence gate (can a
   non-helper reach that path?); and the manager app's own auth (`OPS_TOKEN`-signed cookie,
   same-origin, its service worker and pushes). Anything that lets support's device keep
   access after "End help" is S1.
7. **Account deletion reaching her devices** (new). A device that was offline for months
   comes back after its account was deleted, with and without erase: does it wipe only
   when it should, does it ever wipe on a plain sign-out or a 401 for another reason, and
   does an erase without a recent backup warn anyone first? The passkey clean-up on each
   platform (iOS, Android, desktop password managers) and what happens where it isn't
   supported.

---

### Session K6 — The waitlist engine: positions, turns, offers, passes

**Read** `waitlistRules.js` (1656), `waitlistActions.js` (1734), `waitlistEntryRepo.js`,
`waitlistOfferRepo.js`, `waitlistProgramRepo.js`, `waitlistEvents.js` (319),
`waitlistReview.js`, `rosterCount.js`, `tidyRules.js` (428),
pages `waitlist-entry.js` (2188), `waitlist.js`, `waitlist-programs.js`,
assets `waitlistUI.js` (688), `waitlistReviewUI.js` (1078), `waitlistPicksPanel.js` (421).
**Leave to K6b:** side sales, the picks preview and the 7-day undos. Those three grew
`waitlistRules`, `waitlistActions` and the entry page by about 700 lines; K6 reviews the
turn engine as it stood, K6b reviews what was bolted onto it.
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
4. **The five and a half thousand lines** of rules + actions + entry page. Look for the
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

### Session K6b — Picks preview, side sales and the undo windows (new since the first draft)

**Read** `picksPreview.js` (309), `assets/picksPreviewModal.js` (457),
`assets/sideSaleUI.js` (180), and the parts of `waitlistRules.js`, `waitlistActions.js`,
`waitlistProjection.js`, `nudges.js`, `pages/waitlist-entry.js`, `pages/waitlist.js`,
`assets/waitlistPicksPanel.js` and `assets/litterCheckinUI.js` that the three features
added (`git log -p 4dfe76f..0328a3f -- <file>` shows exactly which; search for `side`,
`undo`, `REMOVAL_UNDO_DAYS`, `canUndo`, `preview`). The Worker's side-sale change is in
`cloud/src/familyPages.js` / `familyActions.js`.
Tests: `picksPreview`, `waitlistSideSale`, `waitlistUndo`, `waitlistRules`,
`waitlistTurns`, `waitlistProjection`.
Contract: `docs/KennelOS_Picks_Preview_Spec.md`, `docs/KennelOS_Side_Sale_Spec.md` (every
decision is in each §9), guide §29 (Rules engine, Actions, "Undo windows").

**Evaluate**
1. **Side sales are invisible to the turn rules — prove it.** The spec lists what must
   ignore them: `openTurns`, `nextTurn`, `turnSpent`, `joinsOpenTurn`, `hasOpenOffer`,
   automatic offers and pass counting. Check each, then look for the ones the spec didn't
   list (`litterQueue`, `autoOfferSummary`, `waitlistReview`, `tidyRules`, `rosterCount`,
   reports, Today's nudges, Kels's check-in). A side sale that a turn rule *sees* can skip
   or block a family's real turn — S1. Two exceptions are deliberate (guide §29, the side
   sale): a family with a **pending** side sale gets no turns, and the projection marks the
   row `direct: true` for the Worker only (`serverMoves.openTurns` skips it except for
   reminders). Check those two are the *only* exceptions, that "pending" ends on every path
   (deposit, cancel, the other claim resolved), and that `direct` never reaches a family's
   page.
2. **The pup itself.** A side sale and a turn pick on the same pup at the same time; a side
   sale started while a turn on that litter is open (the spec's "one family at a time"
   rule); a side sale declined, expired, or voided — is the pup offered again, and to whom?
   A pup sold twice is S1.
3. **"To the family it's a turn pick, with no difference anywhere."** Walk the projection,
   the status page, the deposit-request message and the reminders for a side sale: does
   anything leak the word, a flag, or a different deadline? And the reverse: does anything
   the breeder needs to know (it was out of order) disappear from her own history?
4. **The picks preview must agree with Open picks.** It is a second implementation of
   "who qualifies, in what order, and why not" over the same rules. Build litters where
   the preview's answer and what `openPicks` actually does could differ (a paused family,
   a listen-list family, a pre-passed split, a side sale in flight, a setting she changes
   inside the preview then cancels). Any difference means she is told one thing and the
   app does another — S1. Settings changed inside the modal: saved when, and does closing
   it without opening picks keep or drop them?
5. **The undo windows.** Each of the five (removal, withdrawal she entered, decline, fee
   expired, fee received): what it restores, what it can't (an offer that went to the next
   family meanwhile, a fee refunded by Stripe, a position that moved), the 7-day boundary
   (date-only vs timestamp, timezone), an undo after a sync from another device, and an
   undo of an undo. An undo that restores a family to a place that was since given away is
   S1; one that leaves a `HistoryEvent` saying something that didn't stick is S3.
6. **The new screens by the page recipe** (§0a): the 457-line preview modal especially —
   a litter with 12 pups and 60 families on a phone, focus and escape, a slow read.

---

### Session K7 — The waitlist online: applications, the public list, family pages

**Read** `waitlistForm.js` (465), `waitlistCrypto.js`, `waitlistProjection.js` (724),
`cloud/cloudWaitlist.js` (655), `cloud/src/waitlist.js` (352),
`cloud/src/familyPages.js` (1035), `cloud/src/familyActions.js` (403),
`cloud/public/family/*` (`status.js` alone is 1,375), `shared/companion-view.html` (652)
if it overlaps, pages `waitlist-form.js`, `waitlist-publish.js`, `applications-report.js`,
assets `waitlistApplicationForm.js`, `waitlistOnlineUI.js`, `waitlistSetupUI.js` (416),
`shared/data/waitlistInbox.js`, `jotformMatch.js`.
**New since the first draft:** `waitlistPolicies.js` (181), `assets/qaListEditor.js`,
`programSuggest.js` (76), `assets/programIcons.js`, `doNotSell.js` (81),
`pages/do-not-sell.*` (192), the do-not-sell tab in `pages/contacts.js`, and the KennelOS
side of the puppy portal: `portalFeed.js` (339), `portalFeedSync.js` (254), and what they
add to `kennelportLink.js` / `kennelportLinkStore.js`.
Tests: `waitlistForm`, `waitlistCrypto`, `waitlistProjection`, `waitlistEmbed`,
`cloudWaitlist`, `waitlistInbox`, `waitlistPolicies`, `programSuggest`, `doNotSell`,
`portalFeed`, `cloud/tests/waitlist`, `familyPages`, `familyPortal`, `application`,
`familyActions`.
Contract: Waitlist Spec (the online half), W2 plan, `docs/KennelOS_Family_Help_Plan.md`,
`docs/KennelOS_Waitlist_Policies_Plan.md`, guide §29 (including "Her waitlist policies",
"A question that suggests a program", "Do-not-sell list"), §35.1 (the portal feed).

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
7. **Waitlist policies** (new). The policies are published to the public list, the
   application, the status page and her website, and the application now has a locked
   "I've read the policies" box. Check the four surfaces show the *same* version after an
   edit (a cached page, a republish she hasn't done), what an application records about
   which version the family agreed to, the allow-list on what's published, the starter
   wording drawn from her settings (a fee or back-out text that contradicts the policy she
   wrote), and the "suggestions aren't saved until Save" behaviour.
8. **A question that suggests a program** (new). The link lives on her current form and
   is never published — prove the projection and the family pages can't reveal a
   program's name or the link (the public list shows only an icon); then a program
   archived or deleted after the link was made, an answer edited after applying, and a
   "No" that must stay remembered across devices.
9. **The do-not-sell list** (new). A listing is a private judgement about a named person —
   confirm it never reaches a projection, a family page, a backup she shares, the cloud
   in plain form unless `syncRegistry` says so on purpose, or her website. Then the match:
   it only warns, so check the warning shows where she decides (the inbox, approve, a
   side sale, a sale) and that a "possible" name match doesn't read as an accusation. A
   listed contact hidden from Contacts: can she still find it, and what does a merge do?
10. **The puppy portal feed, KennelOS's side** (new). It sends family records **by
    itself** shortly after opening and after changes. Field by field against
    `portalFeed.js`'s allow-list: anything a family shouldn't see of another family, of the
    breeder's money (the comment says never an amount or a phone — prove it), or of a
    voided sale. Then the send: a lapsed licence (must not send), two devices both sending,
    a kennel unlinked from the site, a family whose sale was voided (does "what has gone"
    retract it?). Then the facts that come back and are written without asking her: what
    fields, what validation, and whether a bad or hostile response can overwrite her
    records.

K7 grew by about 1,500 lines with these four. If it runs out of room, do the privacy
questions first (1, 9, 10, then 8) and say where you stopped; 6 and 7 can go to a
follow-up.

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
2. **Driving miles** (`MAPBOX_TOKEN` is live now): what the transport suggestion does when
   Mapbox is down, over quota, the token is revoked (`503 geo_off`), or an address doesn't
   geocode — a blank mile count, a thrown error, a silent zero fee? Does the UI degrade
   honestly? Also the transport accounts now shown on her website's Getting your pup home
   page (note the seam in one line).
3. **Pickup slots.** Double-booking, timezones, a slot the breeder removes after a family
   took it, a family in another timezone reading a time.
4. **Backing out.** What is refunded, what is kept, what the records say afterwards, and
   whether the puppy returns to the right place in the queue (cross-check K6).
5. **Email and the outbox.** A send that fails, a queued message after days offline,
   duplicate sends on a retry, and the words themselves — these emails are the kennel's
   voice to a family.

---

### Session K9 — Dogs, litters, pairings, events, nudges, Today

**Read** pages `dog.js` (1651), `litter.js` (1083), `pairing.js` (557), `breeding.js`,
`dogs.js`, `today.js` (585), `calendar.js`, `reminders.js`, `shows.js` is K14;
`pedigree.js` + `assets/pedigree.js` (323) and `pedigreeEdit.js` (103, new: fix any spot
in the chart in place);
data `nudges.js` (1284), `nudgeState.js`, `awayBoard.js`, `calendarMath.js`,
`dogCare.js`, `prepPups.js`, `litterCheckin.js` (266), `goHome.js`, `keeperTests.js`,
`healthTestLog.js`, `studRules.js`, `dogRegistrations` coverage, `puppyDefaults.js`,
`eventRepo.js` (if K1 didn't finish it), `kennelTree.js`,
assets `eventForm.js` (663), `dogCheckinUI.js`, `litterCheckinUI.js` (678),
`prepPupsUI.js` (766), `healthTestsUI.js`, `puppyForm.js`, `keeperTests.js`, `timeline.js`.
Tests: `dogCare`, `dogRegistrations`, `dogSearch`, `goHome`, `keeperTests`,
`healthTestLog`, `litterCheckin`, `prepPups`, `studRules`, `linkedStatusNudges`,
`calendarMath`, `closedDates`, `eventRepo`, `kennelTree`, `saleStatus`, `pedigreeEdit`,
`dogPickerOrder`.
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
   many panels. The dog form's new Clear buttons for date of birth and death: what a
   cleared date does to age-based nudges, the life stage, and a deceased dog's status.
7. **Fixing the pedigree in place** (new). `pedigreeEdit` changes a child's `sire_id` /
   `dam_id`. Check the loop guard (a dog made its own ancestor through a chain, not just
   directly), a parent of the wrong sex, a spot fixed on a dog that has litters (do the
   litter's `dam_id`/`sire_id` and the dog's now disagree?), a pedigree-only dog added
   twice, and that "a dog taken out of a spot stays on file" doesn't leave an orphan the
   breeder can't find.
8. **New nudges** (policies not written, picks due, side sales): each one's done-condition
   is reachable, and none repeats what another already says on Today.

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
   and whether anything can go negative that shouldn't. Include a sale that began as a
   **side sale** (K6b) and a fee whose "received" was **undone** within its 7-day window:
   does every money surface follow the undo, or does a receipt or report keep the old
   figure? And the new prefill: "Deposit received" fills a credit's date when the credit
   covers the whole deposit — a partial credit, a credit edited later.
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
7. **Recent changes to Kels's tasks:** the litter check-in and Review my waitlist now open
   picks through the picks preview (the preview itself is K6b — check only that Kels hands
   it the right litter and resumes correctly after it closes), and Kels's website check now
   asks only about what a task changed (does a task that changed nothing website-facing
   ever skip a check it needed?).

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
4. **Notifications** (live: VAPID key and `0018` are in place). Push: permission, a dead
   subscription, iOS's installed-app requirement, a key rotated on `/ops`. Email digests:
   an empty digest, a daily digest after a week offline, unsubscribe, and the send counts
   `0019` adds (not yet applied — what the code does meanwhile). A notification that
   promises something the app can't show when tapped is S2. The new waitlist Today nudges
   (a removal's undo window, side sales, picks due, policies): does each reach push and
   the digest when it should, and does a tap land on the right family?

---

### Session K13 — Editions, the build, first run, PWA, the marketing site

**Read** `shared/data/editionConfig.js` (149, the Pro default), `lite/editionConfig.js` and
the rest of `lite/` (714), `pro/` (140), `demo/` (112), `editionTour.js`, `proPages.js` (144),
`assets/editionLinks.js` (248), `upgradeBridge.js`, `assets/upgradeNudge.js`,
`demoMode.js`, `appReset.js`, `build/assemble.mjs` (+ `build/README.md`),
`shared/sw.js` (563), `shared/app.js` (239), `shared/nav.js`, `shared/index.html`,
`sampleData.js` (1436), `seedImport.js`, `kennelSetup.js`, `kennelSetupRepair.js`,
`assets/onboardingUI.js`, `assets/sampleDataUI.js`, `assets/licenseGate.js`,
`site/*` (16 files, 3.4k; `privacy.html` and `terms.html` were rewritten for sync, the
waitlist, the website, alerts and support's help), `.github/workflows/deploy.yml`.
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
   it). New Pro-only entries since the first draft: the `dogCards` flag (false in Lite and
   Demo — Demo can't write, Lite's cap would half-fail a bulk add), `dog-cards.html`,
   `do-not-sell.html`, `programIcons.js`, `picksPreviewModal.js`, `sideSaleUI.js`. Check a
   Lite page never imports one of them (a dropped file is a broken module graph offline),
   and that `dogCard.js` / `picksPreview.js`, kept shared, can't be reached in Lite.
5. **The service worker.** 563 lines: what is cached, what is network-first, what happens on
   a `CACHE_NAME` change (the user-visible update path — does she get a prompt, a silent
   swap, or a half-old app?), a failed precache entry, and the app running from cache against
   a newer cloud API.
6. **First run.** A fresh origin: onboarding, kennel setup, sample data in and out
   (`sampleData.js` is 1,436 lines — does removing it leave anything behind?),
   `kennelSetupRepair`, and `requestPersistentStorage` being asked at the right moment.
7. **The marketing site.** Every page loads, the nav works on a phone, the six checkout
   links are present (clicking them is a launch step, not a review one), and nothing
   contradicts what the editions actually do.
8. **The privacy policy and terms against the code** (both rewritten since the first
   draft). Every claim about what leaves her device — live sync, the waitlist's family
   pages, her website and the puppy portal feed, alerts, support's helper device, account
   deletion — checked against what the code actually sends and keeps (`syncRegistry`'s
   `cloud` fields, the projection, `portalFeed.js`, `account_deletions`' 90 days). A
   promise the code doesn't keep is S1, whichever side is wrong.

---

### Session K14 — Multi-kennel, shows, kennel identity, Companion, Furever

**Read** page `kennel.js` (1150), `kennels.js`, `kennelRepo.js` (347), `kennelScope.js`,
`assets/kennelScopeUI.js`, `kennelCard.js` + `kennelCardUI.js`, `kennelTree.js` +
`assets/kennelTree.js`, `assets/kennelSetupUI.js`, `kennelSettingsFields.js`,
page `shows.js` (359) + `showPoints.js` (206), `companionExport.js` (554),
page `companion.js` (450), `shared/companion-view.html` (652), `assets/companionLink.js`,
`assets/pickToSend.js` (379), `fureverSeedExport.js`, `fureverContentPack.js` (215),
`page furever.js` (936), all of `furever/` (65 files, 6.9k),
`shared/data/settings.js` (958), `shared/pages/settings.js`,
and `dogCard.js` (539) for what leaves (K2 owns the receiving side).
Tests: `kennelCard`, `kennelTree`, `kennelInsights`, `rosterCount`, `showPoints`,
`fureverShareable`, `fureverPickup`, `pickToSend`, `scopePredicates`, `dogCard`,
`coOwnedWebsite`.
Contract: `docs/KennelOS_Multi_Kennel_Scope_Spec.md`,
`docs/KennelOS_Show_Tracking_Spec.md`, guide §20, §27, §28, §36,
`docs/KennelOS_Shared_Dogs_Plan.md` §3 and §5,
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
6. **`settings.js`** (958 lines): what is per-device vs per-program, what syncs, what a
   missing setting defaults to, and whether any page bypasses it for `localStorage`
   (invariant 1).
7. **Dog Cards, sent** (new). Same posture as Kennel Cards and Companion: an allow-list
   with `assertOnlyKeys`. Read the allow-list as a privacy decision: should every listed
   field go to another breeder (a microchip number, a co-owner's name, a dog's
   registration on a dog she only leases)? Then a whole-program card: does it respect the
   active kennel, or send dogs of a second own kennel too? And co-owned dogs: the
   "who it lives with" and naming-its-kennel rules on her website (seam, one line) must
   agree with what a card says about the same dog.

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
7. **The newest screens get the full recipe** (§0a), since nobody has looked at them
   twice: `do-not-sell`, `dog-cards`, the picks preview modal, the side-sale dialog, the
   program badge bubble on the public list (it was moved twice to stay on screen at phone
   width — check 320px), the policies editor (`qaListEditor`), and the "Helping …" bar a
   helper device shows. Run the escaping scanner over them by name.

---

### Session K16 — Consolidation (after K1–K15 and K6b)

Read every findings file. Produce `docs/review/SUMMARY.md`:
- de-duplicated findings ranked S1 → S4, each with its one-line scenario;
- **themes** — the repeated shapes across sessions (a rule implemented twice and drifted;
  a derived number computed two ways; a date-only string through `new Date`; a gate checked
  on the screen but not in the write; a limit with no message; a pending deploy step with
  no in-app degradation);
- a **fix order** that puts anything losing her records, leaking a family's data, or
  misstating money first, and groups the rest so one change closes several findings;
- the collected **test gaps**, as a short list of suites to write;
- what no session reached — Furever and the 87 HTML page shells are the likeliest
  leftovers;
- for each item in §0's "New since the first draft" table, one line saying which
  findings it produced, or that it came through clean. That table is the list of features
  added fastest; the summary should say plainly whether they left gaps.

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
| 3 | **K6**, **K6b**, **K7**, **K8** | The biggest feature, the newest rules bolted onto it, and the only part families touch. |
| 4 | **K9**, **K10** | The daily app and every number in it. |
| 5 | **K11**, **K12**, **K13** | Guided flows, outside services, and the edition gates that hold the first two in. |
| 6 | **K14**, **K15** | Scope, the second app, and the surface a person actually looks at. |
| 7 | **K16** | Consolidate. |

Sessions within a wave are independent and can run in parallel (K6b reads K6's engine but
doesn't need its findings). If only a handful ever run: **K1, K2, K5, K6b, K7, K10, K13**,
then K16. If the aim is only the newest work (§0's "New since the first draft"): **K6b,
K7** (items 7–10), **K5** (items 6–7), **K2** (items 8–9), **K13** (item 8), then K16.

The fattest sessions are K6 (≈7,000 lines), K7 (≈8,000), K9 (≈7,500), K10 (≈7,500) and
K14 (≈12,000 with Furever). Each names where to split if it runs out of room — split rather than skim,
and say in "what I did not get to" exactly where the line fell.

## 3. Index of findings

`docs/review/INDEX.md` — one row per session: number, title, branch, date, counts by
severity, link to the findings file. Each session adds its own row; nobody edits another's.
