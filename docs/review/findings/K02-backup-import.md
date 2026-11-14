# K02 — Backup, restore, CSV import: the data-loss surface

Reviewed: `shared/data/importExport.js` (703), `restoreMatch.js` (424), `csvImport.js` (1,947),
`csvImportHelp.js` (255), `csvBatch.js` (94), `seedImport.js` (118), `dogCard.js` (539, the
receiving side), `pedigreeImport.js` (352), `pedigreeParse.js` (377), `pedigreeReader.js` (77),
`documentRepo.js` (139), `fileRepo.js` (70), `dropbox.js` (234), `googleDrive.js` (226),
`ocr.js` (173), `assistantSync.js` (173, the Dropbox push/pull), `cloud/cloudBackup.js` (the
snapshot and vault builders, as backup producers only — K3 owns the rest);
pages `import-export.js` (447), `import-batch.js` (159), `expense-import.js` (211),
`kennel-tests-import.js` (200), `pedigree-import.js` (363), `dog-cards.js` (344); assets
`importView.js` (232), `importHelp.js` (61), `documentModal.js` (316),
`mergeQuestions.js` (86), `receiptCapture.js` (188); plus `furever/data/importExport.js`
(the sibling app's own guard).

Contract read: End-State guide §9, §10, §26, §26.1, §36; `docs/KennelOS_Shared_Dogs_Plan.md`
§3.2–§3.6, §4, §5, §7; CLAUDE.md (backup compatibility, additive schema, registries);
`docs/KennelOS_Lite_Cap_Enforcement_Spec.md` §9.

Verified by: the baseline green at `7680974` — `node --test` **1647 pass**,
`cd cloud && npm test` **303 pass**, `node build/assemble.mjs` succeeds. (The plan's
baseline of 1639 was taken at `0328a3f`; the eight extra tests come from the commits that
landed since.) Then sixteen throwaway scripts in my scratchpad: three on
`tests/support/memoryDb.js` (a device-only-table canary sweep over every file producer, the
reverse direction, and the zero-record replace), and thirteen driving the **real modules
against real Dexie in Chromium** over `python3 -m http.server 8000` — restore rollback at
10,000 rows, the cross-app restore both ways, the backward/forward-compatibility matrix, the
Dog Card scenarios of plan §3.4/§3.5, the pedigree/document file paths, a CPU-throttled
(4×, 390×844) 10,000-row CSV with memory read off CDP `Performance.getMetrics`, the CSV
date/encoding/duplicate-row edge cases, a Tesseract run on a 12 MP photo, and a 320px pass
over all seven pages in scope.

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S1 | shared/data/importExport.js:122 | Nothing checks a file is a *KennelOS* backup, and Replace clears every table first: a Furever backup (or any JSON with a `collections` object) empties her program and files the other app's rows in her tables | verified |
| 2 | S2 | shared/data/csvImport.js:1833 | The same dog on three rows of one CSV creates three dogs — the natural key is never checked within the file | verified |
| 3 | S2 | shared/data/csvImport.js:91 | `5/1/2021` is silently read as 1 May; the preview never shows the date it read, and date of birth is part of the match key | verified |
| 4 | S2 | shared/assets/importView.js:146 | The dry-run preview never says what an update will change: `r.changes` is computed and thrown away, so "40 update" can mean 40 retired dogs | verified |
| 5 | S2 | shared/data/dogCard.js:393 | `applyDogCard` runs in no transaction: a 30-dog card that fails at dog 16 leaves 15 dogs, the kennel and the contact, and every retry adds another duplicate contact | verified |
| 6 | S2 | shared/data/dogCard.js:437 | A re-sent card reverts her own corrections — no newer-wins rule, field *labels* only in the preview, and `skip` is ignored on an update row, so she cannot decline | verified |
| 7 | S3 | shared/assets/importView.js:156 | The 10,000-row preview: 10.6 s on the happy path; one unrecognised word in one column → 104 s, 2.16 M DOM nodes, +281 MB heap; with 1,000 dogs on file it never renders at all | verified |
| 8 | S3 | shared/assets/documentModal.js:233 | A file blob is stored before its document row, so a refused document leaves an orphan blob nothing ever sweeps; on an edit the old file is deleted before the update | verified |
| 9 | S3 | shared/data/dropbox.js:149 | A revoked refresh token is never cleared: the page still says "Dropbox connected", "Last backup" stays reassuring, and every push fails forever with `invalid_grant` | verified |
| 10 | S3 | shared/data/dogCard.js:317 | An ancestor she typed in without a registration number can never match, so every card duplicates her hand-typed ancestors; the preview reports only a count | verified |
| 11 | S3 | shared/data/csvImport.js:471 | `buildDogChanges` returns the whole record, not a diff, so re-importing an unchanged file rewrites all 40 rows and bumps every `updated_at` | verified |
| 12 | S3 | shared/data/csvImport.js:42 | A Windows-1252 CSV (Excel's default on Windows) imports as mojibake with no warning, poisoning the name that is the match key | verified |
| 13 | S4 | shared/data/dropbox.js:198 | `mode: 'overwrite'` with no rev check: two phones pushing to the same app folder silently clobber each other's backup | verified |
| 14 | S4 | shared/data/dogCard.js:275 | `cardVersion` is read but never gate-checked, unlike the backup's `format_version` — and phase 2 plans to apply cards "without asking", which turns finding 6 into silent loss | verified |

All fourteen are **verified**: each was reproduced by running the real module against real
Dexie in Chromium, or against `tests/support/memoryDb.js`, as each entry below says. Nothing
is filed as suspected.

**The two questions I was asked to settle first.**

- **Can a restore destroy existing records before the incoming file is known-good?** Yes, but
  not the way I expected. The write itself is properly atomic: I fed `restoreBackup(…,
  'replace')` a 10,000-row file broken at row 9,000 four different ways (no `id`, a `null`
  row, a corrupt base64 blob marker, an un-indexable `id`) and in every case the Dexie
  transaction aborted and all 52 of her records were still there. The hole is a file that
  **validates and carries nothing** — `inspectBackup` is satisfied by any object with a
  `collections` object — and that is finding 1.
- **Are `device_secrets` / `sync_meta` provably absent from every file?** Yes. See
  "Device-only tables: clean" below; proved from the code paths and by canary, in both
  directions.

---

## 1. A restore accepts any JSON with a `collections` object, and Replace clears first  (S1, verified)

**Where** `shared/data/importExport.js:122` (`inspectBackup`), reached from
`shared/pages/import-export.js:120` (`showRestorePreview`) and `:256` (the Replace confirm).

`inspectBackup` asks three things of a file: that `collections` is an object, that each of its
values is an array, and that `format_version` is not newer than 2. It does **not** ask whether
the file is a KennelOS backup, nor whether it carries a single KennelOS row. `restoreBackup`
then does this:

```js
if (mode === 'replace') {
  for (const table of tables) await table.clear();
}
for (const [name, rows] of entries) {
  if (rows.length) await db.table(name).bulkPut(rows.map(decodeRowBlobs));
}
```

`entries` is `knownEntries(obj)` — the file's collections **intersected with this schema's
table names**. A file whose collections are all unknown yields an empty `entries`, so the
clear runs and nothing replaces it.

**Scenario** The concrete, in-house trigger is a **Furever** backup. Furever is the sibling
family app in this same repo; its `exportAll` emits the same `{ schema_version,
format_version, exported_at, collections }` envelope, and its own code says why that matters
(`furever/data/importExport.js:63`):

> `app: 'furever'` guards against restoring a breeder-app backup here (**or vice versa**) —
> the shapes look similar enough at a glance to invite that mistake.

The "vice versa" half was never built. Furever checks `obj.app` (`:112`); KennelOS writes no
`app` field and checks for none. So I seeded a 16-record program (12 dogs, a kennel, a litter,
a sale, a buyer) and handed KennelOS a realistic `furever-backup-….json`:

```
KennelOS before: {"dogs":12,"contacts":1,"kennels":1,"litters":1,"sales":1}
inspectBackup  : ACCEPTED
  preview counts: {"pets":1,"breeders":1,"household":1,"contacts":1,"care_events":1,
                   "documents":1,"photos":1,"files":1}
  unknownTables : ["pets","breeders","household","care_events","photos"]
restore result : [{"name":"contacts","count":1},{"name":"documents","count":1},{"name":"files","count":1}]
KennelOS after : {"contacts":1,"documents":1,"files":1}
contacts now holds: [{"id":"fc1","contact_type":"vet","name":"Riverside Vets","pet_ids":["p1"]}]
```

Every dog, the kennel, the litter and the sale are gone, and because the two apps **share
three table names** (`contacts`, `documents`, `files`) it is not even a clean wipe: Furever's
vet, its document row and its file row are now in her records. The page then reports
`Restore complete (replace) — 3 record(s) loaded. Reloading…`.

What she saw beforehand was the ordinary preview: a counts table listing `pets`, `breeders`,
`household`, and an `inline-warn` reading *"Ignoring unknown tables not in this app version:
pets, breeders, household, care_events, photos."* That sentence actively points the wrong way
— it says **version**, so it reads as a forward-compatibility note about her own data, not as
"this is the wrong app's file". Then the red button and *"Replace ALL current records with the
file's contents? This cannot be undone."*

The other end of the same hole, same module, no Furever needed: `{"collections":{}}` passes
`inspectBackup`, and Replace empties all 18 tables and returns `[]`.

The reverse direction is only accidentally safe. Furever refused today's KennelOS file — but
on `format_version` (KennelOS is at 2, Furever at 1), not on the `app` guard, which cannot
fire against a file that declares no app. The day Furever bumps its own
`BACKUP_FORMAT_VERSION` to 2, that protection disappears.

**Why it matters** This is the one unrecoverable action in the app. Replace exists precisely
for the moment she has no other copy — a new phone, a new web address — and it is the moment
she is most likely to be picking a file out of a crowded Downloads folder. The atomic
transaction protects her from a *corrupt* file and not at all from a *wrong* file, which is
the far likelier mistake.

**What I'd do** Three cheap, independent guards. (a) Stamp `app: 'kennelos'` in `exportAll`
and have `inspectBackup` refuse a file whose `app` is present and different — that closes the
sibling-app case in both directions and matches what Furever already does. (b) Refuse a file
whose known collections hold **zero rows**: there is no legitimate Replace from an empty file.
(c) Re-word the unknown-tables warning so it distinguishes "a table from a newer KennelOS"
from "none of these are KennelOS tables", and have the Replace confirm state the numbers —
"this replaces 16 records with 3" — rather than naming no quantity at all.

---

## 2. The same dog on three rows of one CSV becomes three dogs  (S2, verified)

**Where** `shared/data/csvImport.js:1833` (`buildPlan`).

`buildPlan` builds its index from `mapping.loadExisting()` and classifies each row against
**that** index. `mapping.indexBatch` exists, but for dogs it only populates `batchByName` so a
pup can name a sire on another row; nothing adds a row's own natural key to the index as it
goes, and nothing compares rows to each other.

**Scenario** A CSV with the same dog three times — the ordinary result of sorting and
re-pasting in a spreadsheet, or of two exports concatenated:

```
Juno,Thornfield Juno,female,2021-07-07,Labrador Retriever,owned,puppy
Juno,Thornfield Juno,female,2021-07-07,Labrador Retriever,owned,active_breeding
Juno,Thornfield Juno,female,2021-07-07,Labrador Retriever,owned,pet_home
```

Measured: `{"create":3,"update":0,"review":0,"skip":0}`, all three rows `create/create`, **no
reason text on any row**, commit `{created: 3}`, and three Junos in the database with statuses
`pet_home`, `puppy`, `active_breeding`. The preview offered her nothing to notice.

**Why it matters** The module header states the governing rule — "a natural key is only valid
if it is NON-EMPTY… keyless / partial-key rows are never auto-matched and never silently
created" — and the whole engine is a match-or-create. A perfectly good key, repeated, is the
one case that slips through. She then has three of each dog, each carrying a different status,
and no indication which the app will show; the Duplicates scan is the only way back, and
`dogSearch.nameKey` has its own trouble with near-identical names (K01 finding 1).

**What I'd do** Add each classified row's natural key to the index as the plan is built, so
row 2 onward matches row 1 and classifies as `update` (or `review` with "this dog is also on
row 2") rather than `create`. The within-file parent machinery already proves rows can see
each other.

---

## 3. `5/1/2021` is silently read as 1 May, and the preview never shows the date  (S2, verified)

**Where** `shared/data/csvImport.js:91` (`normDate`), consumed by every mapping's `classify`.

```js
else if ((hit = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/))) { [, m, d, y] = hit; } // US M/D/Y
```

**Scenario** I ran nine spellings of 7 July 2021 through a real dog import:

| given | read as | what she's told |
|---|---|---|
| `2021-07-07` | `2021-07-07` | — |
| `7/7/2021` | `2021-07-07` | — |
| **`5/1/2021`** | **`2021-05-01`** | **nothing** |
| **`05/01/2021`** | **`2021-05-01`** | **nothing** |
| `2021/07/07` | none | review: "Unrecognized date_of_birth" |
| `7/7/21` | none | review: "Unrecognized date_of_birth" |
| `44384` (Excel's serial) | none | review: "Unrecognized date_of_birth" |
| `07-Jul-2021` | none | review: "Unrecognized date_of_birth" |
| `July 7, 2021` | none | review (and the commas shift every later column) |

The six formats the parser cannot read all land in review with a clear reason — that half is
handled well. The damage is confined to the one shape that is **parseable but ambiguous**:
every day-first date whose day is 12 or less is accepted as a month, silently.

In fairness, `csvImportHelp.js:36` does say *"Dates can be written 2024-03-15 or 3/15/2024
(month first)"*. But that sentence is inside the on-page help disclosure, and it is advice
about a column her spreadsheet has already filled. The preview is where she would catch it,
and the preview row shows only `r.display` (the dog's name) and a status badge — **it never
shows the date it read**.

**Why it matters** Date of birth is half the dog natural key (`nk(name, dob)`), so a
misread date does not just store a wrong birthday: it changes what the row matches, so a
re-import later creates a second dog. The same `normDate` serves `whelp_date`,
`planned_date`, `sale_date` and `event_date`, so a litter import from a UK or Australian
breeder can land a whelping four months out, which then drives every age, nudge and go-home
date downstream.

**What I'd do** Scan the file once before classifying: if any date cell's first number
exceeds 12 the file is day-first, so either read the whole file that way or ask once ("Are
these dates day-first or month-first?"). Either way, print the interpreted `YYYY-MM-DD` in the
preview row next to the dog's name, so an ambiguous file is visibly wrong before commit.

---

## 4. The dry run never says what an update will change  (S2, verified)

**Where** `shared/assets/importView.js:146` (`noteCell`) and `:156` (`renderPreview`).

```js
function noteCell(r) {
  if (r.status === 'update' && r.matchLabel) {
    return `<span class="muted">Matches existing: <strong>${esc(r.matchLabel)}</strong></span>`;
  }
  if (r.reasons.length) { … }
  return '<span class="faint">—</span>';
}
```

`r.changes` holds exactly the field-by-field truth and is never rendered. The card above the
table promises *"Nothing is saved yet. Review each row's action, then commit."*

**Scenario** She has Juno as `active_breeding`, colour `yellow`. A CSV from her breed club's
spreadsheet carries `retired_breeding` and `chocolate`. The plan says:

```
status: 'update', decision: 'update', matchLabel: 'Thornfield Juno', reasons: [],
changes: { status: 'retired_breeding', color_markings: 'chocolate', … }
```

The row she sees is: **Thornfield Juno · `update` · "Matches existing: Thornfield Juno" ·
[Update match ▾]**. Scaled up, a 300-row file that retires her whole roster shows "300
update" and three hundred identical rows saying each one matches itself.

**Why it matters** This is the single screen standing between a spreadsheet and her records,
and for the update half it conveys only *that* something will change, never *what*. It is the
same shape as finding 6 on the Dog Card side, and together they mean neither of the app's two
"nothing is written until you accept" previews actually shows the before-and-after it already
has in hand.

**What I'd do** Render `r.changes` in the Notes cell as `Field: old → new`, collapsed behind a
count when there are more than three ("4 changes ▾"). Nothing needs computing; the data is
already there.

---

## 5. A Dog Card that fails part-way leaves half a program, and every retry duplicates the contact  (S2, verified)

**Where** `shared/data/dogCard.js:393` (`applyDogCard`).

Unlike `pedigreeImport.commitImport`, which wraps its whole write in
`db.transaction('rw', [db.dogs, db.kennels, db.documents, db.files, db.contacts], …)`,
`applyDogCard` is a bare sequence: `applyKennelCard`, then `contactRepo.create`, then one
`dogRepo.createPedigreeOnly` per ancestor, then one `dogRepo.create`/`update` per dog sent,
then `applyEvents`, then a final parent-linking pass. Any throw stops it where it stands.

**Scenario** A whole-program card of 30 dogs. Dog 16 carries `dateOfBirth: '2047-01-01'` — a
sender's typo, which `dogRepo.validateDog` rightly refuses. Measured:

```
preview said: 30 create, nothing flagged on the bad dog
apply error : "Dog: date_of_birth cannot be in the future."
dogs landed : 15   (Ashvale Prog 0 … Prog 14)
kennels     : 2    (the sending kennel was created)
contacts    : 1    (the contact was created)
result      : null (it threw, so the page has no counts to show)
```

She then retries, which is the only thing the screen offers — the error box fills in, the
button is re-enabled, and the preview is still sitting there. On each retry `newDogs` is still
non-empty (15 dogs remain), so `contactRepo.create` runs again:

```
2nd attempt: same error, dogs 15, contacts 2  ("Ashvale Kennels", "Ashvale Kennels")
3rd attempt: same error, dogs 15, contacts 3
```

The message she gets is the raw repo string. It names no dog, no row, no count — not "15 of 30
were added, then Ashvale Prog 15's date of birth reads 2047". And the preview never warned,
because `previewDogCard` classifies against the card's own shape and never asks the repos
whether a row would validate.

**Why it matters** The Shared Dogs plan §3.4 opens with "**Nothing is saved until the preview
is accepted**", and §7 names "a big program on one link" as the known risk, answered with "use
the file". The file transport does not help here: the failure is in the apply, and a bulk add
is exactly where a single bad row is likeliest. She is left with a half-received program she
cannot tell apart from a whole one, and a contacts list quietly growing a duplicate per tap.

**What I'd do** Three things, smallest first. (a) Wrap the apply in one `db.transaction` over
dogs/kennels/contacts/events, as `commitImport` already does, so a failure leaves nothing.
(b) Failing that, make the dog loop per-row tolerant like `commitPlan` — collect failures,
import the rest, and report "27 added, 3 could not be added: …" with the dog named. (c) Either
way, make the contact creation idempotent (reuse a contact matching the name, the way
`pedigreeImport`'s `matchBreederContacts` already does) so a retry is free.

---

## 6. A re-sent card reverts her own corrections, and she cannot decline  (S2, verified)

**Where** `shared/data/dogCard.js:437` (`updateFrom`), `:286` (`dogChanges`),
`shared/pages/dog-cards.js:230` (`changeText`) and `:240` (`rowChoice`).

Three things compound:

1. **No newer-wins anywhere.** `dogCard.js` contains no `updated_at` comparison at all. Every
   other import path in the app has one — `restoreFileMerge` has `localIsNewer` plus a
   `keepNewer` choice, `planCloudMerge` compares `updated_at`, `planVaultMerge` compares
   `updated_at`. The card's value wins unconditionally.
2. **The preview shows labels, not values.** `dogChanges` returns
   `{field, label, from, to}` per change. `changeText` keeps only `c.label`.
3. **`skip` is honoured only for new dogs.** `applyDogCard:468`:
   `if (pick.skip && (p.action === 'create' || p.action === 'adopt')) continue;` — and
   `rowChoice` returns `''` for any row that is not `create`/`adopt`, so an update row has no
   control rendered at all.

**Scenario** Ashvale sends Star's card; Thornfield accepts it. Over the next week she notices
the registered name is spelled wrong, writes down the colour as she sees it, and enters the
microchip off the dog's paperwork. Ashvale re-sends the **same, unchanged** card — which §4
of the plan says is about to happen automatically, on every change, in phase 2.

```
her edits   : registered_name "Ashvale Northern Starr", color "light yellow / cream",
              microchip "999999999999999"   (updated_at a week after the card)
preview says: Update — "Registered name, Colour and markings, Microchip"
after apply : registered_name "Ashvale Northern Star", color "yellow",
              microchip "981000111222333"
her edit survived: false
```

The preview *had* `"Ashvale Northern Starr" → "Ashvale Northern Star"` in hand and printed the
word "Registered name". And the footer under the table reads:

> Your own notes, plans and ownership of dogs you already have are never changed.

Which is true of the fields it lists, and reads as a blanket assurance. I confirmed she has no
way out: setting `{ skip: true }` on that dog's publicId changed nothing (`updated: 1`, name
back to the card's). Her only options are to accept the whole card or not open it.

**Why it matters** §3.5 is carefully written about what a card must not touch, and the code
honours all of it — notes, ownership, kennel, co-owners, lives-with, plans, and a sire/dam she
set are all genuinely safe (I checked each). But §5 decision 2 says "**Each breeder keeps her
own say**", and on the fields a card *does* carry she has none. Today the preview at least
lists the field names, so a careful reader can cancel. Under phase 2 as planned — "applies
changes with §3.5's rules, **without asking**" — the same code silently reverts her
corrections on every sync, with no preview at all. That is finding 14's other half, and the
cheapest moment to fix it is before phase 2 is built.

**What I'd do** Give `dogCard.js` the newer-wins rule the rest of the app has: compare the
card dog's `issuedAt` (or a per-dog stamp) against her row's `updated_at` and default to
keeping hers, exactly as `restoreFileMerge`'s `keepNewer` does. Show `from → to` in the
preview instead of the bare label, and render the per-row select on update rows too, so
"Leave out" works. Then re-word the footer to say which fields the card *does* set.

---

## 7. The 10,000-row preview: 104 seconds, 2.16 million DOM nodes, +281 MB  (S3, verified)

**Where** `shared/assets/importView.js:156` (`renderPreview`), `:139` (`actionCell` →
`existingOptions`).

`renderPreview` builds the whole table as one `innerHTML` string, one `<tr>` per row, with a
`<select>` per row — and for a needs-review row, a **second** `<select>` holding an `<option>`
for every existing record (`existingOptions`). There is no cap, no paging, no virtualisation,
and the commit (`csvImport.js:1891`) is one awaited `repo.create`/`update` per row with no
progress indicator.

**Scenario** Measured in Chromium at CPU throttle 4× (mid-range phone), viewport 390×844, with
a 1.68 MB 10,000-row dog CSV:

| | parse | plan | **render preview** | **commit** | DOM | heap |
|---|---|---|---|---|---|---|
| all 10,000 Create, 200 dogs on file | 238 ms | 574 ms | **10.6 s** | **40.2 s** | 120 k nodes | +8 MB |
| one wrong word in `status`, 200 dogs on file | 127 ms | 449 ms | **104.1 s** | — | **2,160,212 nodes**, 2,040,000 `<option>` | **+281 MB** |
| the same, 1,000 dogs on file | — | — | **never rendered** (gave up at 340 s) | — | — | — |

Parsing and planning are fast and fine. Everything else is the DOM.

The second row is not a contrived input: my first attempt at a realistic CSV used
`status=active`, which is the word any breeder would write, and `DOG_STATUS` has no `active`
— it has `active_breeding`. One unrecognised word in one column sends all 10,000 rows to
needs-review, and each review row then renders a picker listing every dog she owns. The cost
is rows × existing dogs; at the 4,000-dog program the review plan asks about elsewhere, that
is 40 million `<option>` elements.

On the happy path it is still 10.6 s of frozen tab to draw the preview and 40 s to commit,
with nothing on screen moving and no indication the app is working rather than hung.

**Why it matters** The import screens are how a breeder arrives from a spreadsheet, so the
first 10,000-row file is a first-run experience. 2.16 M nodes and +281 MB is past what a phone
tab survives; a tab the OS kills mid-commit stops at whatever row it reached, and nothing
records where (see "partial commit" in the notes). The 1,000-dog case is the ordinary one for
anyone importing *into* an existing program, and there the preview simply never appears.

**What I'd do** Cap what is drawn: render the first ~200 rows plus every review row, with
"showing 200 of 10,000". Build the review picker's options once (or on focus) instead of per
row — that one change removes the 2 M nodes by itself. Give the commit a progress line and
batch the writes. If a hard ceiling is wanted, say so at parse time rather than after the
plan.

---

## 8. A document's file is stored before its row, and deleted before its update  (S3, verified)

**Where** `shared/assets/documentModal.js:233`, `:235`; the same order at
`shared/data/pedigreeImport.js:344`.

```js
let fileId = existing?.file_id || null;
if (pendingFiles) {
  fileId = await storeDocumentFile(pendingFiles, …);              // blob written
  if (isEdit && existing.file_id && existing.file_id !== fileId) {
    await fileRepo.remove(existing.file_id);                      // OLD FILE DELETED
  }
}
…
if (isEdit) doc = await documentRepo.update(existing.id, payload); // if this throws…
else doc = await createDocument(payload);
```

`fileRepo.create` is not in a transaction with the document write, and nothing in the app
sweeps a `files` row that no document or expense points at (`grep -rn orphan shared/` finds
only training-stay nudges).

**Scenario** The failure is routine, and the pedigree importer's own comment predicts it: a
`documents` row needs one of her own kennels, and "a pedigree-only dog lends none". So — two
own kennels, "All kennels" showing, a pedigree PDF filed on an imported ancestor:

```
attempt 1: "Document: \"kennel_id\" is required."   files 1, documents 0
attempt 2: "Document: \"kennel_id\" is required."   files 2, documents 0
attempt 3: "Document: \"kennel_id\" is required."   files 3, documents 0
→ 6 MB of blobs, 0 documents pointing at them, nothing that will ever remove them
```

Each retry adds another copy. The blobs count against her IndexedDB quota and ride **every
backup** from then on, base64-encoded at 1.33× (measured: 20 MB of PDFs → 26.7 MB of JSON).

Two smaller edges in the same lines. On an **edit**, the old file is removed before
`documentRepo.update` runs, so a throw there leaves the document pointing at a file that no
longer exists. And the message she reads, `Document: "kennel_id" is required.`, names an
internal field and offers no next step — the fix is "switch the app to one kennel first", which
nothing says.

**Why it matters** Documents are scans she may not have anywhere else, and `files` is the one
table whose rows are measured in megabytes. A store that only ever grows, on a device with a
quota, eventually refuses the next write — and the backup she would restore from carries the
waste with it.

**What I'd do** Resolve and assert the kennel *before* writing the blob (or wrap both writes
in one transaction, as `commitImport` does), and do the `fileRepo.remove` of the old file only
after the document write succeeds. Add an orphan check to the Import/Export page's Duplicates
card — a `files` row no document and no expense references, with its size — so the ones
already stranded can be cleared. And give `assertOwnKennel` a message a breeder can act on.

---

## 9. A revoked Dropbox token leaves the app saying "connected" forever  (S3, verified)

**Where** `shared/data/dropbox.js:149` (`getAccessToken`), `:128` (`tokenRequest`).

```js
const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: APP_KEY });
```

`tokenRequest` throws `Dropbox sign-in failed: ${detail}` on a non-OK response and **nothing
clears the stored refresh token**. `isDropboxConnected()` only checks that
`s.refreshToken` is present, so it keeps returning true.

**Scenario** She removes KennelOS from her Dropbox account's connected apps — or Dropbox
expires the grant, which it does. From then on:

- the Import/Export card's connection strip still says Dropbox is connected, and both
  "⬆ Push to Dropbox" and the fetch button stay enabled (`renderBackupRestore` gates them on
  `isDropboxConnected()`);
- every push fails with `Dropbox sign-in failed: invalid_grant` — OAuth jargon, no next step;
- `setLastBackupDate` is only called *after* a successful push (`assistantSync.js:100`), so
  "Last backup" keeps showing the last date that worked, which is the one number on the page
  she would use to check she is safe;
- the fix — Disconnect, then Connect — is never suggested, and there is no reason she would
  guess that a button labelled Disconnect helps something that claims to be connected.

**Why it matters** Dropbox is a backup destination. The failure mode is the worst kind: the
app's own reassurance (connected, last backup recent) is exactly inverted from the truth, for
as long as she doesn't read the error text closely.

**What I'd do** On a `tokenRequest` failure from the refresh grant specifically, clear the
stored tokens (`disconnectDropbox()`) and re-render, so the card honestly says "not
connected" with the Connect button. Keep the raw detail out of her way and say "Your Dropbox
connection has expired — connect again." And when "Last backup" is older than the reminder
window, say so on the card rather than printing a date with no judgement attached.

---

## 10. Every card duplicates the ancestors she typed in by hand  (S3, verified)

**Where** `shared/data/dogCard.js:317` (`sameRegistration`), used by `previewDogCard:376` and
`applyDogCard:454`.

```js
const sameRegistration = (cardDog, d) => !d.public_id && text(cardDog.registry) && text(cardDog.registrationNumber)
  && lower(d.registry) === lower(cardDog.registry) && lower(d.registration_number) === lower(cardDog.registrationNumber);
```

An ancestor matches only by public id, or by registry **and** registration number present and
equal on both sides. A pedigree ancestor she typed in from a paper chart usually has a name
and little else.

**Scenario** She has `"Ashvale  Granite"` as a pedigree-only dog, no registry, no number — the
normal shape of a hand-entered ancestor. A card arrives whose ancestor Granite carries
`AKC / SR900001`:

```
preview ancestors: { total: 2, added: 2, matched: 0 }
after apply      : "Ashvale Granite"  [ped-only, public_id]
                   "Ashvale  Granite" [ped-only, no public_id]
```

Two Granites. Per plan §3.4 the preview gives ancestors "a count", so all she is told is
"2 ancestors: 2 added for pedigrees, 0 you already have" — and there is no picker for
ancestors the way there is for dogs sent, by design.

**Why it matters** Ancestors are the one part of a card that arrives with no question asked,
and they are also the part most likely to collide with hand-typed records. Every card from
every breeder adds its own copy, so the pedigree chart fills with near-duplicate boxes and a
dog's grandparents stop being one dog. §7 of the plan says "ancestors link only by public ID
or an exact registry and registration number" as a *safety* property, which it is — the cost
is that the common case can never link at all.

**What I'd do** Keep the automatic match strict, but surface the near-misses: when a card
ancestor's registered name matches one of hers that has no number, count it separately
("1 ancestor looks like one you already have") and offer the same link picker the dogs sent
already get. The `lookalikes` helper right above it does exactly this job and is only wired to
sent dogs.

---

## 11. Re-importing an unchanged CSV rewrites every row it matches  (S3, verified)

**Where** `shared/data/csvImport.js:471`.

```js
function buildDogChanges(record) {
  return { ...record };
}
```

The changeset is the whole parsed record, not a diff against the matched dog, so
`commitPlan` calls `repo.update` with every present field whether or not any differs.

**Scenario** Import a 40-dog CSV; then import the **same file** again, nothing edited:

```
plan     : { create: 0, update: 40, review: 0, skip: 0 }
committed: { created: 0, updated: 40 }
updated_at bumped: 40 of 40   (…T03:12:59.845Z → …T03:13:01.021Z)
changes planned for an unchanged row:
  [call_name, registered_name, sex, date_of_birth, breed, ownership_type, status]
```

**Why it matters** More than churn. `updated_at` is the tie-breaker for every merge in the
app — `localIsNewer` in `restoreFileMerge`, the newer-wins overlay in `planCloudMerge`, the
live-sync pull. So a re-import on the phone makes all 40 dogs newer than the laptop's copies,
and a genuine edit made on the laptop *before* the re-import is now the "older" one and loses.
It also pushes 40 unchanged records through the next cloud sync, and shows her "40 update"
for a file that changes nothing.

**What I'd do** Diff `record` against the matched record and keep only the fields that
actually differ; drop the row to `unchanged` when the diff is empty. That fixes the sync
hazard and makes finding 4's preview honest at the same time.

---

## 12. A Windows-1252 CSV imports as mojibake with no warning  (S3, verified)

**Where** `shared/data/csvImport.js:42` (`parseCsv`), reached with the raw `File` from
`shared/assets/importView.js:95`.

Nothing anywhere names an encoding. `parseCsv` hands the `File` straight to PapaParse, which
reads it with `FileReader.readAsText` and no `encoding` set — that is UTF-8. Excel's
"CSV (Comma delimited)" on Windows writes the ANSI codepage instead, which for Western
European installs is Windows-1252.

**Scenario** A dog called Zoë, exported from Excel on Windows. I built the Windows-1252
bytes, decoded them as UTF-8 (what both `readAsText` with no encoding and `File.text()` do),
and fed the result to the real `parseCsv` and `buildPlan`:

```
BOM + UTF-8  : headers clean, call_name "Zoë", status create        ✓
Windows-1252 : call_name "Zo�", status create, warned: (nothing)
```

A UTF-8 BOM is handled correctly, incidentally — `transformHeader`'s `.trim()` strips
U+FEFF, since JS treats it as whitespace, so `call_name` resolves rather than
`﻿call_name`. The byte-level encoding is the gap.

**Why it matters** The dog is created with a broken name, silently. And because the name is
the match key, re-importing a corrected UTF-8 file later creates a **second** dog rather than
updating the first — finding 2's problem arriving by a different road. Any breeder outside
plain-ASCII names hits this on their first Excel export.

**What I'd do** Decode as UTF-8 with `fatal: true` first; on a decode error (or on finding
U+FFFD in the text), fall back to `windows-1252` and say so in the preview — "This file
isn't UTF-8; I read it as Windows-1252. Check the names below." `TextDecoder` supports both,
no dependency needed.

---

## 13. Two phones pushing to Dropbox silently clobber each other  (S4, verified)

**Where** `shared/data/dropbox.js:198`.

```js
const res = await contentCall('upload', { path, mode: 'overwrite', mute: true }, JSON.stringify(obj, null, 2));
```

`mode: 'overwrite'` with no `rev`, so Dropbox never reports a conflict. Dropbox's own
`update` mode exists for this and takes the rev the previous download returned.

**Scenario** The two-phone workflow the feature is built for (`BLURBS`: "Pull it on your other
phone to catch up"). Phone A pushes in the morning. Phone B — which has not pulled, and is a
week behind — pushes in the afternoon. A's backup is gone with no trace, and the app-folder
file is now the older program. Phone A later pulls and is offered a Replace from it.

Replace is the live hazard; Merge is mostly protected, because `localIsNewer` keeps the
newer local copy — except where finding 11 has just bumped the wrong side's `updated_at`.

**Why it matters** S4 rather than S2 because it needs an out-of-order push to bite, and
because `exportAll` is a full snapshot, so the loss is bounded by whatever phone B lacks. But
nothing anywhere tells her a push replaced a newer file, and the one page that could — the
restore preview — shows the file's `exported_at` without comparing it to her own data.

**What I'd do** Keep the rev from the last download/upload and push with
`mode: {'.tag': 'update', update: rev}`; on a conflict, say "a newer backup is already in
Dropbox — pull it first, or push anyway". At minimum, warn in the restore preview when the
file's `exported_at` is older than her newest record's `updated_at`.

---

## 14. A card's `cardVersion` is read but never checked — and phase 2 plans to apply cards without asking  (S4, verified)

**Where** `shared/data/dogCard.js:275`.

```js
cardVersion: Number(parsed.cardVersion) || 1, issuedAt: text(parsed.issuedAt), from: from.ref, kennels, dogs
```

Compare `inspectBackup` (`importExport.js:133`), which refuses a file whose `format_version`
exceeds this build's and says why, and `assertCloudSnapshot`/`assertVaultPayload`, which do the
same. The card has the field and no gate.

**Scenario** I confirmed the forward-compatible half works: a card with `cardVersion: 2`, a new
top-level key, two new dog fields and a new kennel field decoded fine with every unknown key
dropped, because `decodeDogCard` rebuilds each object by name. That is the right behaviour for
*additive* change.

The risk is a **semantic** change. §3.5's central rule is that a blank field on a card means
"not supplied, never clear mine". If a v2 card ever distinguishes "blank" from "cleared" — the
natural next step, since phase 3 is listed as handling removals — a v1 build will read those
cards and apply the old meaning, silently. Nothing stops it.

This matters now rather than later because of where phase 2 is heading. Plan §4: her device
"checks it at each sync and applies changes with §3.5's rules, **without asking**, since she
accepted those dogs and those fields once". Combine that with finding 6 — no newer-wins rule,
no per-field decline — and the preview that is today her only protection disappears. The
decision in §5 that "each breeder keeps her own say" and the design in §4 are in tension, and
the code currently implements §4's half.

**What I'd do** Refuse a card whose `cardVersion` exceeds `DOG_CARD_VERSION` with the same
sentence `inspectBackup` uses ("made by a newer version of KennelOS… update the app"). And
settle the §4-vs-§5 tension before phase 2 is built: either phase 2 applies only to fields
she has not touched since the last card, or it reports what it changed somewhere she will see
it, rather than only a Today count.

---

## Device-only tables: clean

The plan asked for this proved from the code paths, not the comment. Both directions hold.

**Out.** Every file or payload that can carry a record is built from `exportAll`
(`importExport.js:80`), which iterates `dataTables()` — `db.tables` minus
`DEVICE_ONLY_TABLES` (`db.js:248`). I confirmed the only other `db.tables` reader in `shared/`
is `db.js` itself, then put unmistakable canaries in both tables
(`device_secrets.key = 'CANARY_VAULT_KEY_8f3a'`, `sync_meta.cursor =
'CANARY_SYNC_CURSOR_11b7'`) and serialised every producer:

```
db.tables 20 · dataTables() 18 · excluded ['device_secrets','sync_meta']
clean  exportAll()                       (the JSON file, downloadBackup, the Dropbox backup)
clean  exportAll({encodeBlobs:false})    (the source of both cloud payloads)
clean  buildAssistantFeed()              (the Dropbox assistant feed)
clean  buildCloudSnapshot().envelope     (the cloud snapshot)
clean  buildVaultPayload().envelope      (the private-vault payload)
clean  getSampleDataManifest()           (the sample manifest)
```

No canary, and no table name, in any of them; `collections` has exactly 18 keys.

**In.** A hand-made or hostile file carrying `device_secrets` and `sync_meta` collections
cannot write them either: `knownEntries` filters by `dataTables()`, so both are dropped in
`merge` **and** `replace`, and `replace`'s clear loop runs over `dataTables()` too, so her
real vault key and sync cursors are left alone.

```
mode=merge   → [{"dogs":1}]  device_secrets MY_REAL_KEY, sync_meta MY_REAL_CURSOR
mode=replace → [{"dogs":1}]  device_secrets MY_REAL_KEY, sync_meta MY_REAL_CURSOR
```

The two places that *do* open `device_secrets` (`mergeJoinMatches`, `restoreFileMerge`) only
rewrite the ids of rows already there, never insert from a file. `tests/cloudVault.test.js:332`
already guards part of this: it asserts `device_secrets` is absent from `exportAll` and that a
`'replace'` restore carrying one "neither imports nor clears it". What no test covers is
`'merge'` mode, or `sync_meta` in either mode (see coverage gaps).

## Notes, not findings

- **Backward compatibility is in good shape, both directions.** A v1 file (no
  `format_version`, written before the `files` table existed) merges cleanly into this build.
  A file from a newer build is refused with a sentence that says what to do. Today's file read
  by an older build loses only `do_not_sell` — the one table added in `version(7)` — which is
  skipped by name and flagged in the preview, so no `BACKUP_FORMAT_VERSION` bump is owed under
  CLAUDE.md's rule ("only when an older build couldn't read the file"). Better than the rule
  requires: an unknown **field** on a row is kept verbatim rather than stripped, so a
  round-trip through an older build doesn't lose it. The only nit is the warning's wording,
  which names the raw table (`do_not_sell`) rather than "the people you've marked
  do-not-sell"; that is the same sentence as finding 1's.
- **The restore transaction really is atomic.** Worth recording since it is the thing finding 1
  might be mistaken for. Four ways of breaking row 9,000 of a 10,000-row replace — missing
  `id`, a `null` row, a corrupt base64 marker, an object as `id` — all aborted the Dexie
  transaction and left all 52 seeded records in place. `decodeRowBlobs` and `markerToBlob` are
  synchronous, so nothing in the callback can let the transaction auto-commit early. A tab
  closed mid-restore gets the same protection from IndexedDB itself.
- **OCR and receipt capture are solid.** A receipt photo is never lost by a failed scan:
  `runScan` touches only the status line, and `pending` is saved on submit regardless
  (`receiptCapture.js:108`). A photo that yields nothing says "Couldn't read the details —
  enter them by hand." Timing was a non-issue: at CPU throttle 4×, a 12 MP (4032×3024) receipt
  took **1.0 s** and read amount, date, vendor and receipt number correctly — same as a
  1200×900 version. Caveat worth stating: my test image was synthetic (clean printed text on
  white), so a real photo with background and texture will be slower; there is no size cap, no
  timeout and no cancel on `ocr.scan`, and it fires automatically on every photo picked. I
  found no evidence of a problem, so this is a note, not a finding.
- **The microchip does not overwrite hers.** The plan asked. `commitImport`'s existing-dog path
  is `if (v && !ex[f]) changes[f] = v` (`pedigreeImport.js:294`), so every pedigree field —
  microchip included — fills a blank and never replaces a value. Correct.
- **The pedigree importer's breeder-as-contact does not duplicate on re-import.**
  `breederChoice` (`pages/pedigree-import.js:77`) pre-selects `contact:<id>` whenever
  `matchBreederContacts` finds one, so a second chart from the same breeder defaults to the
  existing contact; `commitImport`'s `made` map covers two charts in one run. `breederName`'s
  name-casing does mangle `MCDONALD` → `Mcdonald` (the `'`/`-`/`&` separators are handled, but
  not the Mc/Mac prefix) — cosmetic, and she can edit the field before importing.
- **`pedigreeImport.commitImport` is the model the Dog Card should copy.** Dogs, kennels,
  documents, files and contacts all in one `db.transaction`, parents ordered before children,
  and the kept PDFs filed afterwards with per-file errors reported. Finding 5 is only a finding
  because this exists two files away.
- **Escaping and layering are clean across the whole area.** No page or asset in scope imports
  `data/db.js` or touches `localStorage`. I scanned every multi-line template literal in the
  seven pages and five assets for interpolated user text: every candidate is pre-escaped at
  the top of its function (`fileCard`'s `const name = esc(f.file.name)`) or escaped inside a
  helper (`pedigree-import.js`'s `opt(v, label)`), and `importView`'s `noteCell` uses
  `r.reasons.map(esc)`.
- **Phone, 320px.** No page in scope has sideways page scroll: `import-export`,
  `import-batch`, `dog-import`, `expense-import`, `kennel-tests-import`, `pedigree-import`,
  `dog-cards` all measured `scrollWidth === clientWidth`. The wide tables are correctly inside
  their own scroll boxes (`.table-scroll`, `importView`'s `overflow-x:auto`). Tap targets are
  the weak spot: the Import/Export card's buttons run 25–30 px tall and `dog-cards`'s
  send-list checkboxes are 13×13 — both under any touch guideline. The send screen is K14's
  and the UI layer broadly is K15's, so I am leaving these here rather than filing them.
- **Partial CSV commit is by design, but unrecoverable by hand.** `commitPlan`'s per-row
  try/catch is deliberate and documented ("Rows are independent: one failure is recorded and
  the rest still import"), and the result screen lists every failure with its row number. What
  is missing is the case where the *tab* goes away mid-commit — likely at finding 7's 40
  seconds. There is no record of how far it got, and re-running the same file re-imports the
  rows that landed (as updates, via finding 11) with no way to tell which those were.
- **`csvBatch.js` is clean.** The scoring (1 / how many importers read each column, with a
  two-column and one-third floor) and the stable topological order over `links` both read
  correctly and are well tested. `orderFiles`'s cycle fallback (`i = 0`) would reorder
  silently rather than stall, but the comment says so and today's `links` have no cycle.
- **Blank cells do not erase, exactly as documented.** An update row whose `color_markings`,
  `microchip_id` and `notes` columns were present but empty left all three of her values
  intact, matching `csvImportHelp.js:38`.
- **Google Drive is not a backup path.** The plan groups `googleDrive.js` with `dropbox.js`
  under "the OAuth redirect rule (`origin + pathname`)", but Drive is only the "Publish to
  Furever" content-pack uploader and uses the GIS **token** model, which registers no redirect
  URIs at all (`googleDrive.js:15`). Its tokens are in-memory only by design, so a page reload
  mid-publish loses the connection — handled with a clear sentence at `:99`. Dropbox's rule is
  implemented correctly; the deploy-side cost is that **every page offering Connect needs its
  own registered URI** — today `/pages/import-export.html` and `/pages/assistant.html`, per
  edition origin. Worth a line in `LAUNCH_CHECKLIST.md` if it isn't there.
- **The Dropbox push's "Last backup" is stamped last.** `pushToDropbox` uploads the backup,
  then the assistant feed, then calls `setLastBackupDate` (`assistantSync.js:96-102`). If the
  feed upload fails, the backup *did* land but the date is not updated and she sees only the
  error — she will think the backup failed. Also, Dropbox's `/files/upload` endpoint caps at
  150 MB (above that it needs upload sessions), which at the measured 1.33× JSON blow-up means
  roughly 113 MB of stored documents makes her Dropbox backup start failing with a raw
  `error_summary`.
- **The backup carries file blobs, and the cost is 1.33×.** Measured: 20 MB of stored PDFs →
  26.7 MB of JSON, `exportAll` 264 ms, `JSON.stringify` 69 ms (unthrottled); one 20 MB PDF
  base64-encodes in 208 ms. Nothing is silently dropped — blobs are tagged and round-trip
  byte-exact, which `tests/importExport.test.js` already guards. The structural note is that
  `downloadBackup` holds the row data, the full JSON string and the `Blob` copy at once, so
  peak memory is several times the stored size; at 20 MB that is comfortable, and I did not
  find the cliff.
- **`replace` empties tables the file omits, including `kennels`.** Documented behaviour, and
  `pointMyKennelAtRestoredKennel` repairs the "my kennel" setting when the file carries an own
  kennel. When it doesn't (a partial file), the setting is left pointing at a kennel the
  restore just deleted — a loose end of finding 1 rather than its own problem.

## Coverage gaps I found (tests that should exist)

- `tests/importExport.test.js` is 73 lines, all of it the blob round-trip plus three
  `inspectBackup` cases. **Nothing tests that a non-KennelOS file is refused**, and nothing
  tests a zero-record `replace` — finding 1 would have been caught by either. (`replace`
  itself is exercised, but only incidentally, by `restoreMyKennel.test.js` and
  `cloudVault.test.js`.)
- `cloudVault.test.js:332` covers `device_secrets` against `exportAll` and a `'replace'`
  restore, which is the important half. Untested: the same two assertions for `'merge'` mode,
  and `sync_meta` in either mode — it is the newer of the two device-only tables and has no
  guard of its own anywhere.
- No within-file duplicate-row case in `csvImport.test.js` (1,208 lines), and no
  ambiguous-date case — `5/1/2021` asserting what it should mean would pin finding 3 either
  way.
- Nothing asserts that `buildDogChanges` produces a diff, so finding 11 can't regress visibly.
- `tests/dogCard.test.js:125` is titled "sent again: the same dogs update, her own fields stay"
  — and the fields it checks are the ones a card never carries. The missing case is a **carried**
  field she corrected herself, which is finding 6.
- No test of a Dog Card that fails part-way (finding 5), so the absence of a transaction in
  `applyDogCard` is invisible to the suite while `pedigreeImport`'s transaction is implied by
  its own tests.
- Nothing covers an orphaned `files` row, in either the document modal's path or
  `commitImport`'s.

## What I did not get to

- `seedImport.js` and the kennel-tests seed import I read but did not exercise; the
  bundled `common_tests_by_breed_seed.csv` round-trip is untested by me.
- `restoreMatch.js` I read in full and used through `planFileMerge`/`restoreFileMerge`, but
  did not probe its pairing rules directly — K01 already filed `restoreMatch.js:78`
  (`public_id` is not an identity signal), and `tests/restoreMatch.test.js` plus
  `fileMerge.test.js` cover the rest.
- `mergeQuestions.js`'s ask/clash dialogs I read but did not drive in a browser, so the
  multi-round "Are these the same?" loop in `askMerge` is unverified by me.
- The real `files` cliff: I measured the backup at 20 MB of documents and found it
  comfortable, but did not find the size at which `downloadBackup` dies on a phone.
- OCR on a real photograph rather than a synthetic one (see the note above).
- The cloud snapshot and vault restore paths (`restoreCloudMerge`, `restoreVaultMerge`) I read
  closely as backup *producers* and as the place the app's newer-wins rules live — which is
  what findings 6 and 11 lean on — but their restore behaviour is K3's.
