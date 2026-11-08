# K01 — Schema, repos, registries, referential integrity

Reviewed: `shared/data/db.js` (274), `repoBase.js` (130), `referenceRegistry.js` (237),
`syncRegistry.js` (665), `kennelScope.js` (174), `scopePredicates.js` (67),
`recordMerge.js` (372), `duplicateScan.js` (199), `vocab.js` (978), `dateUtils.js` (91),
`eventRepo.js` (274), every entity repo (`dogRepo` 336, `kennelRepo` 347, `expenseRepo` 233,
`waitlistEntryRepo` 151, `contractRepo` 149, `documentRepo` 139, `studServiceRepo` 111,
`saleRepo` 102, `litterRepo` 95, `waitlistOfferRepo` 91, `fileRepo` 70, `pairingRepo` 66,
`contactRepo` 64, `waitlistProgramRepo` 63, `accountRepo` 55, `doNotSellRepo` 52,
`breedFeedingScheduleRepo` 47), plus `dogSearch.js` (306), `contactSearch.js` (66),
`restoreMatch.js` (416), `tidyRules.js` (dog/contact duplicate rules only), `findRecords.js` (145),
`appReset.js` (59), `demoMode.js` (56), `syncApply.js`, `cloud/syncRecords.js`, and
`furever/data/db.js` (202) for the blocked-upgrade hand-off.
Contract read: End-State guide §4–§8, §14, §16; CLAUDE.md (schema, registries, cloud);
Multi-Kennel Scope Spec §3–§7, §12; Shared Dogs Plan §3.1/§3.5; Cloud Phase 1 §5, Phase 2 §3–§5.

Verified by: the full baseline green at `facb760` — `node --test` 1639 pass,
`cd cloud && npm test` 303 pass, `node build/assemble.mjs` succeeds. Nine throwaway scripts in my
scratchpad (schema-restatement diff, field-use → `syncRegistry` comparison, query → index
comparison, schema-FK → `referenceRegistry` comparison, vocab-label leakage scan, four
behaviour harnesses on `tests/support/memoryDb.js`), plus Chromium runs against
`python3 -m http.server 8000` → `/shared/pages/today.html` for the real Dexie schema, the
db-blocked banners, and a CPU-throttled timing of the duplicate scan.

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S1 | shared/data/dogSearch.js:100 | `nameKey` drops any all-digit word, so "Thornfield Blue 1" and "Thornfield Blue 2" are one dog: a backup Merge pairs them with no question | verified |
| 2 | S2 | furever/data/db.js:145 | Furever has no `blocked`/`versionchange` hand-off at all, and already has two schema versions | verified |
| 3 | S2 | shared/data/recordMerge.js:98 | Merging a dog that has a Dog Card id into one that doesn't dead-ends: "Another dog on this device already has that public ID" | verified |
| 4 | S2 | shared/data/tidyRules.js:350 | The duplicate scan is quadratic in dogs sharing a call name: 49 s of frozen main thread at 4,000 dogs on a phone-class CPU | verified |
| 5 | S3 | shared/data/syncRegistry.js:47 | `dogs.status_date` and `litters.furever_pack` are in no bucket, so a cloud sync carries a dog's new status with its old "since" date | verified |
| 6 | S3 | shared/data/restoreMatch.js:78 | `dogs.public_id` is not an identity signal for restore matching or the duplicate scan, so two dogs can share one Dog Card id invisibly | verified |
| 7 | S3 | shared/pages/dog.js:694 | A refused Delete explains itself only in a `title=` tooltip on a disabled button — nothing at all on a phone | verified |
| 8 | S4 | shared/data/db.js:23 | Dead indexes, and db.js comments that name readers which don't exist (`is_archived` on 18 tables can never be queried at all) | verified |
| 9 | S4 | shared/data/waitlistReports.js:73 | Offer-outcome and other vocab labels written out as literals in the reports instead of coming from `vocab.js` | verified |
| 10 | S4 | shared/data/referenceRegistry.js:53 | `waitlist_offers.eligible_dog_ids` is an unguarded dog FK, beside `chosen_dog_id` and `lost_dog_id` which are both guarded | verified |

All ten are **verified**: each was reproduced by running the real module, or read off the real
schema in Chromium, as each entry below says. Nothing is filed as suspected.

---

## 1. Two dogs whose registered names differ only by a trailing number are "the same dog"  (S1, verified)

**Where** `shared/data/dogSearch.js:100` (`nameKey`), consumed by `dogNameKeys`
(`dogSearch.js:72`) → `sameRegisteredName` (`:80`) → `restoreMatch.js:78` (`RULES.dogs`) and
`tidyRules.js:366` (`compareDogs`).

`nameKey` drops every word that is only digits:

```js
.split(' ').filter((w) => w && !isNumberish(w) && !/^\d+$/.test(w)).join(' ');
```

`isNumberish` is the deliberate part — it strips a registration number typed into a name box
("SR123456"). The `/^\d+$/` clause is not: it strips a bare number of any length, including a
single digit that is the only thing telling two registered names apart.

```
"Thornfield Blue 1"    -> "thornfield blue"
"Thornfield Blue 2"    -> "thornfield blue"
"CH Thornfield Blue 7" -> "thornfield blue"
```

**Scenario** Two same-sex littermates registered "Thornfield Blue 1" and "Thornfield Blue 2",
with different call names ("Blue" and "Ozzy"). They share a litter, a breed, a birthday and a
sex, which is normal for littermates, and neither has a microchip or a registration number
typed in yet, which is normal for pups.

- `dogNever` (`restoreMatch.js:160`) does not rule them out: sexes agree, no registration
  numbers conflict, no chips, the same date of birth, neither is the other's parent.
- `RULES.dogs` returns **`'same'`** on `sameRegisteredName`, so `planMatches` pairs them
  **automatically, with no question asked** (`pairs=[{table:'dogs', localId:'A', fileId:'F-B',
  asked:false}]`). A file / Dropbox Merge then re-keys one dog's id to the other
  (`importExport.js:339`), merges the two rows, and deletes one. Ozzy's record — his events,
  his sale, his place in a pedigree — is gone, folded into Blue, and she is never asked.
- On one device, the same comparison makes them a **`certain`** duplicate in Scan for
  duplicates, shown as "These look like the same dog. They have the same registered name,
  breed, birthday and litter." That reads as overwhelming evidence for a merge that destroys a
  record.
- Control: the same two dogs named "Thornfield Blue Boy" / "Thornfield Ozzy Boy" correctly
  return `null`.

Run: `v11-namekey.mjs` in my scratchpad.

**Why it matters** This is the only rule in the whole matching layer that returns `'same'`
without her confirmation on nothing but a name, and the key it compares is lossy in exactly
the way breeders use numbers — to distinguish. `nameKey` is also the key used by the CSV
importer, the pedigree importer and Kels's dog matching (`findDogMatches`), so the same
collision reaches those paths; a CSV of a litter registered "<Kennel> Blue 1…8" resolves every
row onto one dog. The newest pedigree-import work ("a name with digits starts its own box",
`8a66e56`) is evidence that registered names carrying digits do arrive in real files.

**What I'd do** Keep `isNumberish` (it earns its place) and drop the `/^\d+$/` clause, or keep
the digit word in the key and only ignore it for the *fuzzy* `nameHit` path, never for the
exact `sameRegisteredName` identity test. Either way, add a littermate guard to the
`sameRegName` branch of `compareDogs` to match the one the `sameCall` branch already has, so
two pups of one litter are never `certain` on a name alone.

---

## 2. Furever has no blocked-upgrade hand-off, on the device class where the freeze was found  (S2, verified)

**Where** `furever/data/db.js` — `db.version(1)` at :121 and `db.version(2)` at :145, with no
`db.on('blocked')`, no `db.on('versionchange')`, no `isDbUpgradeBlocked()` and nothing in
`furever/app.js` to surface them. `grep -rn "blocked\|versionchange" furever/ --include=*.js`
returns only unrelated hits (reference-blocked hard deletes, a storage-blocked try/catch).

**Scenario** The failure `shared/data/db.js:205–216` records verbatim: a phone has the
installed app frozen in Recents holding the old database; a new version can't install; the
upgrade waits with no error; every read hangs, so pages show "Loading…" or no table at all
(seen 2026-10-12 on the `version(4)` rollout). Furever is the app that lives on a *family's*
phone, installed at pickup and used for years — the exact device class. Its next additive
`version(3)` reproduces that bug for them, with no banner, no instruction, and no way to tell
it from a broken app. `version(2)` already shipped, so any family still on `version(1)`
is exposed now.

I confirmed the shared side works: dispatching the three events on
`/shared/pages/today.html` renders `#db-blocked-notice` (`role="alert"`, "KennelOS is updating
its storage. Close every other KennelOS tab or window…"), clears it on `DB_READY_EVENT`, and
renders `#db-closed-notice` on `DB_VERSIONCHANGE_EVENT`. The only shared HTML files without
`app.js` are `shared/index.html` and `furever/index.html` (one-line redirects, no db) and
`shared/companion-view.html` (no Dexie, no IndexedDB, no `localStorage` — checked). So
`shared/` is complete; Furever is the gap.

**Why it matters** Two separate apps, one documented failure mode, one fix applied. The next
Furever schema change is an ordinary additive change — nobody will think to add the hand-off
at that moment, which is precisely when it is needed.

**What I'd do** Copy the fifteen lines from `shared/data/db.js:217–233` into
`furever/data/db.js` and surface them from `furever/app.js` the way `shared/app.js:124–129`
does, with Furever's own wording. Do it before the next version block, not with it.

---

## 3. Merging a dog that carries a Dog Card id into one that doesn't dead-ends  (S2, verified)

**Where** `shared/data/recordMerge.js:98` (`NEVER_COPY`) vs `:231` (`ANY_NEVER_COPY`), and
`dogRepo.js:238–248`.

`ANY_NEVER_COPY` — the list used for every table except dogs and contacts — contains
`public_id`, and its comment explains exactly why ("a kennel's permanent public ID (the kept
kennel's stays; the other's goes with it into the archive)"). `NEVER_COPY` — the list the
dog and contact merge uses — does not. `dogs.public_id` arrived in `version(6)` on 2026-11-04;
the dog list was not updated.

**Scenario** She has Zara twice: the record she typed in two years ago (registered name,
registration number, birthday, colour, her notes, a link) and a second one created when a
co-owner's Dog Card arrived, which carries a `kosd1_` public id. Scan for duplicates — or
Kels's "Tidy up my records" — raises them as a possible duplicate (shared: call name, breed).

- `suggestKeep` scores the record she typed as the fuller one, so **the default the UI offers
  is to keep it**.
- `duplicateConflicts('dogs', keep, drop)` shows her **no conflicts at all** — `public_id` is
  not in `MERGE_SPEC.dog.fields`, so she is never asked about it.
- `mergedChanges` nonetheless copies it, because the kept record's is blank:
  `{"public_id":"kosd1_fb12ca33-…"}`.
- `mergeDuplicate` calls `repo.update(keepId, changes)` → `dogRepo.update` →
  `assertDogPublicIdFree` → the dropped dog *still exists* (it is deleted later, at
  `deleteDuplicate`) and holds that id → it throws
  **"Another dog on this device (“Zara”) already has that public ID."**

Nothing merges. Both Zaras remain. The message names a field she has never seen in the app and
reads like corruption. Verified both with the default `suggestKeep` choice and with her
choosing the typed record explicitly (`v1-merge-publicid.mjs`, `v1b-merge-default.mjs`).

The failure is at least clean: the throw happens before `repointEverywhere`, so nothing is
half-written.

**Why it matters** This is the merge the Dog Cards feature creates — a card arriving for a dog
she already has by hand is the common case, and `dogCard.js:299` only offers an automatic link
for a matching registration number or registered name. Tidying up after it is the one thing
she cannot do.

**What I'd do** Add `public_id` to `NEVER_COPY`, and have `mergeDuplicate` carry the dropped
dog's public id onto the kept one *after* `deleteDuplicate` (a mint, not a copy) so the Dog
Card link survives the merge rather than being thrown away with the duplicate.

---

## 4. The duplicate scan freezes the page: quadratic in dogs sharing a call name  (S2, verified)

**Where** `shared/data/tidyRules.js:350` (`compareDogs`) and `:385–397`
(`duplicateDogFindings`), reached from `duplicateScan.js:178` and from
`tidyRules.js:424` (`tidyFindings`, Kels's tidy-up). Driven by
`assets/duplicateScanUI.js:78`.

`duplicateDogFindings` buckets by call name, registered-name key and registration-number key,
then calls `compareDogs` on every pair inside each bucket. `compareDogs` has no early-out: on
every pair it calls `sameRegistration`, `sameRegisteredName` and `dogRegKeys` (each rebuilding
key arrays with `new Set`) and builds three label arrays (`differs`, `matches`, `unknown`,
each a `filter` + `map` over `DOG_CONTRADICTIONS`) **before** testing any of them.

**Scenario** Her pups get collar-colour call names, reused litter after litter — "Blue boy",
"Pink girl", "Green boy"… Over ten years and 500 litters, 4,000 dogs sit in eight call-name
buckets of ~500, which is ~1,000,000 pairs. She taps **Scan for duplicates** on
Import/Export. Measured in Chromium against the served app:

| dogs | Chromium, no throttle | Chromium, 4× CPU throttle (a mid-range phone) |
|---|---|---|
| 1,000 | 0.7 s | 2.9 s |
| 2,000 | 2.2 s | 11.2 s |
| 4,000 | 11.0 s | **48.6 s** |

`findDuplicates` is synchronous and never yields, so that is the main thread blocked solid:
the "Scanning…" label is frozen, nothing scrolls, nothing can be tapped, and a mobile browser
offers to close the unresponsive page. For the same 4,000 dogs with unique call names it takes
118 ms, so the entire cost is that one bucket. And it finds **nothing** — every pair is
rejected at the last moment on a differing birthday. Kels's tidy-up pays the identical cost
through `tidyFindings`.

Runs: `v13-scale-final.mjs` (Node) and `v14-browser-scan.mjs` (Chromium + CDP throttling).

**Why it matters** A 4,000-dog program is the plan's own yardstick, and reusing eight call
names is not an edge case — it is how most litters are named before the family renames the
pup. The page offers no way out once it starts, and on a phone the likely outcome is a killed
tab.

**What I'd do** Short-circuit `compareDogs`: test the cheap disqualifiers (sex, birthday,
microchip, sire/dam, parent/child, same litter) and return `null` before building any label
array; only compute `matches`/`unknown` for a pair that actually survives. Bucket dogs by
`call name + birthday` rather than call name alone, since a differing birthday is already
fatal. Precompute each dog's name and registration keys once instead of per comparison. Then
yield between tables so the page can paint, and note that `findDuplicates` already compares
every dog pair twice — its own `ruleLevel` pass and `duplicateDogFindings` — which the first
pass could feed to the second.

---

## 5. Two fields are in no `syncRegistry` bucket, and one of them shows a wrong date  (S3, verified)

**Where** `shared/data/syncRegistry.js:47` (the `dogs` entry) and `:152` (the `litters`
entry). The fields: `dogs.status_date`, written by `pages/dog.js:779`/`:786` and
`data/nudges.js:339` and `data/goHome.js:147`; `litters.furever_pack`, written by
`pages/furever.js:814`.

I compared every field the app actually writes against the registry by scanning every
`<entity>Repo.create/update` and direct `db.<table>.put/add/update` call under `shared/` for
its object-literal keys (`s2-syncfields.mjs`). Two unclassified fields on shared tables, both
real; the other hits were `furever/`'s own separate database or parser noise.

**Scenario** `dogs.status_date` is the "since" date under a dog's status — the Dog page renders
`Status  Active breeding  since 1 Mar 2025` from it (`dog.js:307`). It is not in `cloud`, so
rule zero makes it private, so it is not in the snapshot:

```
snapshot keys for a dog: id, is_archived, created_at, updated_at, call_name, status
after overlayCloudFields: { status: "active_breeding", status_date: "2025-03-01", … }
```

On her phone she taps **Promote** on the Today nudge: status becomes `active_breeding`,
`status_date` becomes today. Her tablet pulls the change (or is restored from the backup) and
shows **"Active breeding since 1 March 2025"** — twenty months wrong — and keeps showing it,
because `dog.js:780` only re-stamps the date when the status itself changes. Verified by
running `projectRow` and `overlayCloudFields` directly.

This only bites without the private vault: `syncRecords.js` seals the *whole* row, so a vault
program carries both fields. That is also why the existing guard did not catch either field —
`tests/syncRegistry.test.js`'s coverage test only sees fields the Thornfield sample packet
writes, and the sample seed writes neither.

`litters.furever_pack` is the published FurEver content-pack pointer. Off a non-vault cloud
restore it is absent, so `publishedFureverDocIds` (`documentRepo.js:38`) is empty, so
`isFureverShareable` falls back to "not shareable" for every document that had no explicit
`furever_shareable` boolean — and `documents.furever_shareable` *is* cloud, so the explicit
ones survive and the implicit ones silently don't. Re-publishing from the restored device then
builds a pack missing those documents and orphans the old one on Drive.

**Why it matters** CLAUDE.md makes classifying a new field a required step precisely so the
decision gets made; here it wasn't, and for `status_date` the safe default produces visibly
wrong data. The privacy promise itself holds — rule zero means neither field leaked.

**What I'd do** Classify both: `status_date` as `cloud` (it is the other half of `status`,
which is already cloud, and it is not personal data), `furever_pack` as the decision its
contents deserve. Then close the hole in the guard: have the coverage test build its field set
from a static scan of the data layer's writes, not only from the sample packet, so the next
unclassified field fails the test instead of a review.

---

## 6. `dogs.public_id` is not an identity signal, so two dogs can share one Dog Card id invisibly  (S3, verified)

**Where** `shared/data/restoreMatch.js:78` (`RULES.dogs`) and `:85` (`RULES.dogs_late`);
`duplicateScan.js:65` (`BUCKETS.dogs`) and `:81` (`SHARED.dogs`); `dogCard.js:358` and `:427`.

`RULES.kennels` matches on `public_id` first (`eqSet(l.public_id, f.public_id) → 'same'`), and
`BUCKETS.kennels` buckets on it, and `SHARED.kennels` reports it as "KennelOS ID". The dog
rules, added five months later, do none of those things.

**Scenario** Both her devices receive the same Dog Card from a co-owner, so the same dog
carries the same `kosd1_` id on each — on different row ids. She renames him on one device
("Ranger" → "Rangey"), which is ordinary. She then merges that device's backup into the other:

```
identical apart from ids:              pairs=0 asks=1   (she is asked a question both rows already answer)
she renamed it on one device:          pairs=0 asks=0   -> not paired, not asked: the merge keeps BOTH
```

Two dogs, one Dog Card id, and nothing on the device will ever say so:

```
duplicate scan, same call name:        raised (possible)
duplicate scan, different call names:  NOTHING RAISED
sharedDetails for a dog pair:          []            (public id is not a detail)
sharedDetails for a kennel pair:       ['KennelOS ID']
```

The next card from that co-owner then updates **one of the two at random**: `previewDogCard`
and `applyDogCard` both build `Map(public_id → dog)`, so the last row in table order wins,
while `dogRepo.getByPublicId` uses `.first()` on the index, i.e. the other one. She is told
"Updated 1 dog" either way; the twin keeps its stale tests, titles and parents for good, and
`assertDogPublicIdFree` will refuse any later legitimate mint with a message about a dog she
can't find. Run: `v2-publicid-identity.mjs`.

I also audited every write path for the write-once rule, which otherwise holds well:
`dogRepo.update:238–248` refuses a change or a clear and validates the format;
`ensurePublicId` mints at most once; `dogCard.updateFrom` only fills a blank one;
`dogCard.js:475` refuses a manual link to a dog that already has one; no form field writes it
(`pages/dog.js:70`); `csvImport` never touches it. The only writers that bypass the guard are
the replication paths — `importExport.js` `bulkPut` and `syncApply.js:151` `put` — which is
right for replication but means the guard covers interactive edits only, and nothing
re-validates uniqueness after a restore.

**What I'd do** Add `if (eqSet(l.public_id, f.public_id)) return 'same';` as the first line of
`RULES.dogs`, add a `p:${r.public_id}` bucket and a "KennelOS ID" shared detail to
`BUCKETS.dogs` / `SHARED.dogs`, and make the Dog Card lookups refuse to guess: if two live
dogs hold one public id, say so and ask her to merge them first, rather than picking one.

---

## 7. A refused Delete explains itself only in a tooltip  (S3, verified)

**Where** `shared/pages/dog.js:694`, and the same shape at `litter.js:510`, `contact.js:298`,
`pairing.js:269`, `sale.js:690`, `kennels.js:162` and `waitlist-entry.js:1883` (a Contract is a
leaf, so `contract.js:360` is always deletable and has no blocker list to show):

```js
<button class="btn btn-danger btn-sm" id="btn-delete"${blockers.length ? ' disabled' : ''} title="${esc(delTitle)}">Delete</button>
```

**Scenario** She declines a waitlist application and adds the applicant to her do-not-sell
list — the flow at `pages/waitlist-entry.js:874`. She then tries to delete the application.
`WAITLIST_ENTRY_REFERENCES` holds `do_not_sell.source_entry_id`, so Delete is correctly
refused. On a desktop, hovering the greyed-out button reveals "Referenced as application a
do-not-sell listing came from (1) — archive instead." On a phone there is no hover, and a
`disabled` button does not fire pointer events, so the tooltip is unreachable: she sees a
greyed-out Delete and no reason, anywhere on the page. The same is true of every blocked
delete in the app — a dam with litters, a contact with a sale, a kennel with anything.

`accounts.js:347–351` already does the right thing: it reads the blockers and puts them in a
visible message, including what archiving gets her instead. The detail pages don't.

**Why it matters** The referential guard is the app's main protection against orphaned
records, and `referenceRegistry` goes to real trouble to produce sentences a breeder can act
on ("sire of another dog", "pup chosen on a waitlist offer"). All of that work is invisible on
the device most likely to be in her hand. The fallback `showError(e.message)` path
(`dog.js:992`) is worse: `ReferenceBlockedError` builds its message from the raw table name,
so she'd read "Cannot delete waitlist_entries: …".

**What I'd do** Render the blockers as visible text beside the disabled button (accounts.js's
wording is already right), and give `ReferenceBlockedError` a human entity label instead of
`tableName`.

---

## 8. Dead indexes, and db.js comments naming readers that don't exist  (S4, verified)

**Where** `shared/data/db.js:23–128` (the index notes) against the real queries.

I compared every `where(...)`/`orderBy(...)` on a table in `shared/` against the effective
schema (`s3b-indexes.mjs`): **49 resolved calls, none missing an index** — that half is clean,
and `referenceRegistry`'s probes are all safe too (`s4-fkregistry.mjs`: every non-`scan` entry
names an existing index, every `compoundIndex` entry's table has it). The reverse direction is
not clean. Indexes with no reader anywhere in `shared/`:

```
dogs      status, ownership_type, sex, breed        litters   status, whelp_date
expenses  category, expense_date                    sales     status, registration_type
contacts  waitlist_status                           contracts contract_type, status
documents doc_type, doc_date                        stud_services direction, status
pairings  status, pairing_type                      waitlist_entries status
files     created_at                                waitlist_offers outcome
breed_feeding_schedules breed                       sync_meta tbl
is_archived — on all 18 data tables
```

Three of those are contradicted by db.js's own comments:

- `:102` "Indexed on breed (`breedFeedingScheduleRepo.getByBreed` is a probe, not a scan)" —
  `getByBreed` (`breedFeedingScheduleRepo.js:39`) does `base.getAll()` and `.find()` in JS.
- `:93` "Indexed on dog_id …, doc_type (the type filter chips), and doc_date (newest-first
  sort)" — `documentRepo.js:106`/`:118` sort in JS and the chips filter in JS.
- `:82` "Indexed on event_id …, category (report filter), and expense_date (report range)" —
  neither is queried.

And `is_archived` cannot be queried *at all*, which I confirmed in Chromium against the real
database:

```
DB KennelOSBreedingApp at version 7 with 20 tables      (every index exactly as declared)
dogs.where("is_archived").equals(false)
  -> DataError: Failed to execute 'bound' on 'IDBKeyRange': The parameter is not a valid key.
```

A boolean is not a valid IndexedDB key, which `repoBase.js:60` already knows and says. So 18
index declarations can never serve a read.

**Why it matters** Low cost per write, but db.js opens with "Only fields we actually
query/filter on are indexed" and then lists reasons that aren't true any more. The next person
adding an index will read those comments as the rule and copy a pattern that doesn't work;
worse, someone trimming "unused" indexes has no way to tell the three genuinely dead ones from
the ones `referenceRegistry` probes dynamically.

**What I'd do** Nothing to the shipped `version(1)` block — it is frozen, and a new block that
re-lists a table without these would be a bigger risk than leaving them. Fix the comments
instead: mark each index with what reads it, and say plainly that `is_archived` is indexed only
because `version(1)` shipped that way and is filtered in JS. If `doc_type`/`doc_date`/
`category`/`expense_date` were meant to be used, use them in the repos; that is the cheaper
half of the fix.

Also worth recording from the same scripts, as the clean results: all six schema restatements
(`v3`/`v4` `sales`, `v4` `waitlist_entries`, `v4` `kennels`, `v5` `expenses`, `v6` `dogs`) are
exactly the old string plus the new index, in order, with nothing dropped; and every FK-shaped
indexed field is guarded in `referenceRegistry` except `dogs.public_id` and
`kennels.public_id`, which db.js:62 explains are not foreign keys.

---

## 9. Vocab labels written out as literals in the reports  (S4, verified)

**Where** `shared/data/waitlistReports.js:73`:

```js
const label = { accepted: 'Accepted', passed: 'Passed', no_response: 'No response' }[o.outcome] || o.outcome;
```

a private re-implementation of `WAITLIST_OFFER_OUTCOME` (`vocab.js:223–229`). The same three
words again, hardcoded, in `pages/offers-removals-report.js:52–54` (KPI labels), `:67–68`
(chart series) and `:73` (chart rows).

**Scenario** The owner rewords an outcome — "Passed" is repo-ish for what a family did, and
"No response" could become "Didn't reply". `vocab.js` changes, every badge and status chip in
the app follows, and these three places keep the old word, so the Offers & removals report and
the waitlist reports disagree with the pages they summarise.

I scanned all 242 `{value,label}` vocab labels for verbatim occurrences elsewhere
(`s5-vocab.mjs`): 80 labels appear as literals somewhere. Most are coincidence — "Date" as a
form label, "Kennel" as a heading — but the status/outcome words in the reports are genuine
duplication of the vocabulary: `offers-removals-report.js`, `litter-finances-report.js`
('Anticipated', 'Sold', 'Foster'), `stud-results-report.js` ('Sent', 'Whelped'),
`pairing-success-report.js` ('Bred', 'Planned'), `production-report.js`, `pricing-report.js`.
Status **values** used as literals in logic (`status === 'active_breeding'`) are everywhere and
are fine — that is what a value is for.

**What I'd do** Route these through `descriptor(WAITLIST_OFFER_OUTCOME, value).label` (and the
matching vocab list for each report) the way the pages already do. `exitLabel`
(`waitlistReports.js:58`) is deliberately different wording from her side and should stay as
it is.

---

## 10. `waitlist_offers.eligible_dog_ids` is an unguarded dog FK  (S4, verified)

**Where** `shared/data/referenceRegistry.js:53–55` guards `waitlist_offers.chosen_dog_id`
(indexed probe) and `waitlist_offers.lost_dog_id` (`scan: true`, with a comment explaining the
choice), but not `eligible_dog_ids` — the list of pups an open offer put in front of a family
(`waitlistActions.js:477`, `:526`, `:636`, `:1164`, `:1242`).

**Scenario** Picks are open; a family is looking at four pups. She realises one of the four was
entered by mistake and hard-deletes it from its dog page. Nothing blocks her:
`chosen_dog_id` is null until the family picks, there is no sale yet, and `litter_id` is a
litter reference, not a dog one. The offer keeps a dangling id. In the app the pup simply drops
out of the choices (`waitlistActions.js:1016` resolves ids against live pups), which is
arguably right — but the same array is cloud-tier (`syncRegistry.js:418`) and is copied
straight into the family-facing projection (`waitlistProjection.js:283`), so what the family's
page does with an id it cannot resolve is decided elsewhere. Flagging for **K7** to answer on
the family side.

Found by comparing every FK-shaped field the app writes against the registry
(`s4-fkregistry.mjs`, block C). The other unguarded ones there are fine and I checked each:
`documents.contract_id` is deliberately unguarded and cleared by `contractRepo` on delete
(`:91`, `documentRepo.js:121`); `expenses.receipt_file_id` and `documents.file_id` are owned
files deleted with their owner; `waitlist_entries.soon_notified_litter_ids` and
`waitlist_offers.turn_id` are memos where a stale id is harmless; `dogs.microchip_id`,
`accounts.customer_id`, `dogs.public_id` and `kennels.public_id` are not foreign keys.

**What I'd do** Add `{ table: 'waitlist_offers', field: 'eligible_dog_ids', label: 'a pup offered
to a waitlist family', multiEntry: false, scan: true }` to `DOG_REFERENCES` — a scan, like
`lost_dog_id` beside it, since only a delete asks.

---

## Notes, not findings

- **Baseline is green** at `facb760`: `node --test` 1639 pass, `cd cloud && npm test` 303 pass,
  `node build/assemble.mjs` succeeds (lite 303 precache, pro 451, demo 445, all `…-v112`) —
  exactly the plan's figures, so this session did not start red. The real Dexie database opens
  at `version(7)` with 20 tables and exactly the indexes `db.js` declares, and
  `/shared/pages/today.html` loads with no console or page errors.
- **`do_not_sell` parity is complete** except for the duplicate scan. It is in
  `referenceRegistry` on both FKs (`contact_id` indexed, `source_entry_id` as a scan),
  `syncRegistry` (`rows: NONE`, all seven fields private, with the owner decision dated),
  `syncRecords.SYNC_TABLES` and `APPLY_ORDER`, `restoreMatch.RULES`/`MATCH_ORDER`/
  `describeRecord`, `syncApply`'s registry map, `syncActivity`'s words, `sw.js`'s precache,
  `appReset` (which clears every table generically), and `recordMerge.repointEverywhere`
  (which iterates `dataTables()`, so a contact merge does repoint it). Sample data never
  creates a row, so there is nothing for `clearSampleData` to remove. It is *not* in
  `duplicateScan.SCAN_TABLES`, `RECORD_WORDS` or `recordMerge.REPOS`/`REGISTRY`, so the
  on-device scan ignores it even though a restore Merge can pair it. `doNotSellRepo`'s
  `alreadyListed` guard covers the common case; I'd still add it to the scan for symmetry.
- **No cascades, soft delete only** checks out at the data layer. Pages resolve parent names
  from `includeArchived: true` loads in 100 places; the only four unqualified
  `dogRepo.getAll()` calls (`breeding.js:140`, `dogs.js:145`, `kennel.js:1134`,
  `furever.js:865`) are live pickers where excluding archived dogs is correct. Nothing
  disappears from a list because its parent was archived.
- **Kennel scope.** `scopePredicates`' three rules are right and their "an unresolvable
  subject is in scope" choice is the safe one. Every `inScopeOnly`/`dogsInScope` call site I
  found filters a genuinely scoped table (litters, sales, pairings, stud services, contracts,
  waitlist entries and offers) — none filters `contacts`, whose `kennel_id` is an affiliation
  and not a scope, which is the mistake this would have shown. `accounts`, `files`,
  `breed_feeding_schedules` and `do_not_sell` are program-wide on purpose, each documented in
  `db.js`, so a second own kennel does see the first's — intended.
- **`markDataChanged()`** holds. `tests/cloudDirty.test.js` pins a per-file write-site count
  across `shared/`, `lite/`, `pro/`, `demo/`, and I checked `importExport.js`'s five write
  paths individually (`:190`, `:349`, `:423`, `:559`, `:690`) — each marks dirty. The test's
  weakness is that it only requires the call to appear *somewhere* in the file, and exempt
  files are count-pinned only, so `syncApply`'s "an archive-instead does call
  markDataChanged" claim is unguarded; see coverage gaps.
- **A merge runs in three transactions, not one.** `mergeDuplicate` (`recordMerge.js:345`)
  does `repo.update` → `repointEverywhere` (its own `db.transaction`) → `deleteDuplicate` →
  `remapStoredIds`. A tab closed between the second and third leaves the dropped record in
  place with nothing pointing at it; the scan will raise it again, so it is recoverable, but
  the window exists. I could not construct a case where `deleteDuplicate`'s guard fires after
  a successful repoint (`rekey` handles nested paths, and `files` — the one table
  `repointEverywhere` skips — stores no FKs), so this stays a note.
- **`dateUtils.monthsFromToday`** (`:27`) uses `Date.setMonth`, which spills: 31 January + 1
  month is 3 March. `addMonthsToYMD` just below it exists specifically to avoid that and says
  so. Only `sampleData.js:326`/`:475` call it, so the effect is a sample dog's birthday being
  a couple of days off — cosmetic, but the two functions disagreeing is a trap.
- **`dateUtils.addOpenDays`** loops until it has counted `n` open days and would spin forever
  on a calendar whose weekday list contains no value in 0–6. Not reachable today:
  `waitlistRules.openDays` (`:320`) sanitises to 0–6 and falls back to all seven. A cheap
  bound on the loop would make it safe against a future caller.
- **`events.cost`** is gone from `syncRegistry` but `expenseRepo.migrateEventCosts` (`:203`,
  `:217`) writes `cost: null` rather than deleting the key, so a migrated device carries an
  unclassified `cost: null` on every event that ever had one. Harmless — `projectRow` builds
  from the cloud list by name, so it never leaves — but it is why a static field scan reports
  it.
- **Furever's `version(2)`** re-lists every table from `version(1)` and genuinely drops an
  index (`contacts.pet_id` → `*pet_ids`). That is the documented migration at
  `furever/data/db.js:140–144` with an upgrade function behind it, not an accident.
- `undefined/r1-signout-others.png` is still there, as the plan already records.

## Coverage gaps I found (tests that should exist)

- **`tests/support/memoryDb.js` answers `where()` on any field**, indexed or not
  (`memoryDb.js:65`). A query against an unindexed field passes every suite and throws
  `DataError` in a browser. Worth making the stand-in reject an index the schema doesn't
  declare — it would have been the cheapest possible guard for finding 8's `is_archived`
  result and for any future `referenceRegistry` entry that forgets `scan: true`.
- **`tests/syncRegistry.test.js`'s coverage test** derives its field set from the Thornfield
  sample packet, so a field the sample never writes is never classified (finding 5). A static
  scan of the data layer's writes would close it; my `s2-syncfields.mjs` is a working
  prototype.
- **The FK → registry tests cover only part of the surface.**
  `tests/referenceRegistry.test.js` is better than I expected: `:157` already asserts every
  non-`scan`, non-compound entry is indexed (so the probe-safety half is guarded, and my
  `s4-fkregistry.mjs` block A agreed with it), `:130` asserts every `*kennel_id` index is in
  `KENNEL_REFERENCES`, and `:88` pins a hand-written list of waitlist FKs. What none of them
  does is go the other way for FKs that carry *no index* — a field like
  `waitlist_offers.eligible_dog_ids` (finding 10) appears in no index string and in no
  hand-written list, so nothing notices it is unguarded. Block C of `s4-fkregistry.mjs`
  derives the candidate set from `syncRegistry` plus a scan of what the repos write, which
  catches that shape.
- **No test covers `dogs.public_id` through a merge.** `tests/recordMerge.test.js` has no case
  where one side carries a public id; finding 3 would have failed on the day `version(6)`
  landed.
- **No scale test anywhere.** `duplicateScan`/`tidyRules` have correctness tests but nothing
  pins cost, so finding 4 shipped silently. A test asserting `findDuplicates` over 2,000 dogs
  in eight call-name buckets stays under a budget would hold the line.
- **`tests/cloudDirty.test.js` can't see which write forgot the call** — it checks that the
  file mentions `markDataChanged` and pins a count. Exempt files are not checked at all, so
  the reason strings (e.g. `syncApply`'s archive-instead) are documentation, not assertions.
- **`nameKey` has no test for a name ending in a digit** (finding 1), nor does
  `tests/restoreMatch.js` have one for two littermates registered with trailing numbers.

## What I did not get to

- I did not time a real 4,000-record program through Dexie in a browser (item 2's "measure the
  worst page's reads"). I measured the pure-function costs instead, which is where the
  quadratic turned out to be; the IndexedDB read cost of a big program is still unmeasured.
- I did not drive a genuine blocked `version(8)` upgrade end to end. Dexie maps `version(7)`
  to IDB version 70, so my raw `indexedDB.open(…, 8)` returned `VersionError` rather than
  blocking. The wiring is proven by dispatching the three events on a real page; the live
  rollout path is not.
- `recordMerge` across *every* type (item 8) — I covered dogs in depth and read the generic
  `duplicateChanges`/`duplicateConflicts` path, but did not exercise a merge of each of the
  sixteen tables, nor time `repointEverywhere` (which rewrites every row of every table) on a
  big program.
- `vocab.js` itself (978 lines) I read only as the source of truth for the leakage scan, not
  field by field for wrong `badge` colours, missing `descriptor` entries or edition filtering.
- `findRecords.js`, `demoMode.js` and `kennelRepo.js`'s kennel-card half I read but found
  nothing worth a scenario; `kennelRepo` at 347 lines deserves more than I gave it.
- The family-facing consequence of finding 10 (a dangling `eligible_dog_ids` in the
  projection) is for **K7**. `tidyRules.compareDogs` and Kels's tidy-up belong to **K11** —
  finding 4 lands in their file as well as mine. Furever's own data layer is **K14**'s;
  finding 2 is only the hand-off. The CSV and restore reach of finding 1 is **K2**'s to
  confirm.
