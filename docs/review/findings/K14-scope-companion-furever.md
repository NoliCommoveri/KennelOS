# K14 — Multi-kennel, shows, kennel identity, Companion, Furever

Reviewed: `data/kennelScope.js` (174), `data/scopePredicates.js` (67), `data/kennelRepo.js`
(347), `pages/kennel.js` (1150, the hub and its totals), `pages/kennels.js` (262),
`data/kennelCard.js` (269), `data/kennelTree.js` (228, header and scope posture only),
`pages/shows.js` (359), `data/showPoints.js` (206), `data/companionExport.js` (554),
`assets/companionLink.js` (49), `shared/companion-view.html` (652), `pages/companion.js`
(450, membership and send path), `data/fureverSeedExport.js` (131),
`data/fureverContentPack.js` (215), `pages/furever.js` (936, identity card and publish
path), `data/settings.js` (958), `data/dogCard.js` (539, send side), `pages/dog-cards.js`
(send half). The scope callers: `data/incomeView.js`, `data/moneyReport.js`,
`data/reportSources.js`, `data/nudges.js`, `data/awayBoard.js`, `pages/financials.js`,
`pages/dashboard.js`, `pages/today.js`, and a sweep of all 87 page scripts for ones that
never import `kennelScope`. Furever (its own app): `data/db.js`, `seedLink.js`,
`petRepo.js`, `breederRepo.js`, `contentPackFetch.js`, `contentPackRepo.js`,
`documentRepo.js`, `importExport.js`, `app.js`, `pages/profile.js`, and an
escaping/layering grep plus a 320px sweep of all 13 pages.
Contract read: `KennelOS_Multi_Kennel_Scope_Spec.md` (all), Show Tracking spec §4 via
`TITLE_TRACKS`, guide §20/§27/§28 (Furever identity, `breederKey` "one per
installation"), `KennelOS_Furever_Schema.md` (pets / seed layer), `furever/README.md`,
the Content Package Fetch Mechanism doc (§3–§4 via the code's references).
Verified by: `node --test` → 1649 pass; `cd cloud && npm test` → 305 pass;
`node build/assemble.mjs` → all editions build. Baseline green. Scratch scripts (in my
scratchpad, not the repo): `showPoints` arithmetic in Node; four Playwright runs against
`python3 -m http.server` at the repo root — `companion-view.html` with a crafted hash,
Furever's content-pack fetch with `fetch` stubbed, a seed resend over a family's edits,
two Furever restores — and a 320px pass over every Furever page (no overflow, no console
errors).

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S1 | furever/data/petRepo.js:73,78 | A breeder's resend overwrites the family's own name, photo and breed on their pup (photo erased to null) | verified |
| 2 | S2 | shared/data/companionExport.js:235 | Prospective Companion bundle sends every own kennel's available pups under one kennel name; the "swap the name by hand" workaround can't fix it | verified (read) |
| 3 | S2 | shared/data/fureverContentPack.js:49; furever/data/contentPackFetch.js:62 | A litter pack puts every pup's documents in one public folder and lists them all in a manifest every family in the litter reads; the per-pup filter is display-only | verified (read) |
| 4 | S2 | furever/data/contentPackFetch.js:85 | Content-pack "already have it" cache is per pack, not per pet: a second pup from the same breeder never gets the kennel's (or its litter's) documents | verified |
| 5 | S2 | shared/data/settings.js:310; fureverSeedExport.js:115 | Furever identity and `breederKey` are device-local: a resend from her second device, a restored device or after Reset App forks the family's breeder card and drops tagline, vet and kennel pack | verified (read) |
| 6 | S2 | shared/pages/kennels.js:201; dogRepo.js:147 | Unticking "This is one of my own kennels" on a working kennel is allowed; afterwards every edit to its dogs and every new sale for them is refused | verified (read) |
| 7 | S2 | furever/data/importExport.js:151; db.js:133 | Furever Merge restore from a family's other phone fails outright with a raw `BulkError` when both fetched the same pack (`&pack_key`) | verified |
| 8 | S2 | shared/data/dogCard.js:536,480 | Dog Cards can send external / leased dogs and dogs of a different own kennel; the receiver files them as the "Send from" kennel's dogs | verified (read) |
| 9 | S3 | shared/pages/reminders.js:92 | Reminders page ignores the active kennel; the dashboard tiles that link to it are scoped, so the count and the list disagree | verified (read) |
| 10 | S3 | shared/pages/stud-services.js:69; documents.js:148 | Stud Services and Documents lists ignore the active kennel | verified (read) |
| 11 | S3 | shared/data/scopePredicates.js:65; pages/kennel.js:268 | Expenses on an external dog count in every kennel's P&L; the kennel hub leaves them out, so the hub and Financials give two expense totals for the same kennel | verified (read) |
| 12 | S3 | shared/data/showPoints.js:84 | Two majors with no judge typed reads "2 majors under 2 different judges" — she already has both majors | verified |
| 13 | S3 | shared/companion-view.html:202 | The Companion shell renders any hash on KennelOS's own domain: anyone can mint a "your balance" page for any kennel with their own pay/sign links | verified |
| 14 | S3 | furever/data/contentPackFetch.js:94–113 | One file that fails to download is never retried: the pack is cached as fetched at that version | verified (read) |
| 15 | S3 | shared/data/dogCard.js:69 | Allow-list privacy: a placed pet's (and every ancestor's) microchip number goes to another breeder by default | verified (read) |
| 16 | S3 | shared/pages/financials.js:169 (+4) | "Multi-Kennel Scope Spec §9" printed in five breeder-facing hints | verified |
| 17 | S4 | shared/companion-view.html:202,352; pages/dog.js:296 | No http(s) check on links from outside: `javascript:` URLs land in `href` (Chromium declines to run them today) | verified |
| 18 | S4 | furever/data/importExport.js:140 | Furever restore never migrates an older schema's rows: a v1 backup's contacts come back attached to no pet | verified |

## 1. A resend wipes the family's edits to their pup  (S1, verified)
**Where** `furever/data/petRepo.js:69–85` (`upsertSeededPet`): `name: seed.name || …`,
`breed: seed.breed || null`, `date_of_birth`, `sex` and `photo_url: seed.photoUrl || null`
are all rewritten on every resend. `pages/profile.js` lets the family edit exactly those
fields (Edit form at :231–259, the Add-Picture box writes `photo_url` at :315).
**Scenario** Pup arrives as "Blue Collar Boy". The family renames him Max, sets their own
photo and fixes the breed. Two days later the breeder moves pickup by a day and hits
Prepare link again (the console's normal resend). Playwright: before
`["Max","data:image/jpeg;base64,…","Labradoodle"]`, after the resend
`["Blue Collar Boy", null, null]` (the test packet had no breed or photo, so both went
to null). The photo they picked exists nowhere else in the app.
**Why it matters** The schema doc says the family "never edits" the seed layer, but the
UI puts those seed fields in the family's own edit form. Resends are routine before
pickup: every pickup tweak and every countdown update causes one.
**What I'd do** Keep the breeder's values in `pet.seed` only and copy them onto the pet
on create, or field by field only where the family hasn't changed them (compare with the
last `seed`). Never null a family's photo.

## 2. Prospective bundle: every kennel's pups under one name  (S2, verified by reading)
**Where** `shared/data/companionExport.js:233–235`: `dogRepo.getAll()` then
`status === 'puppy' && disposition === 'available'` — no kennel filter, no active scope.
`headerCopy` takes `kennelName` from the one global Companion blob.
**Scenario** Pro, two own kennels: Thornfield (Goldens) and Briar Hollow (Poodles), as in
the sample seed. She sends a prospective family Thornfield's update. They get
Thornfield's name and tagline over Briar Hollow's Poodle litters too, with prices. Spec
§10 says a multi-kennel breeder "can swap the kennel name/tagline by hand before
sending". If she does, the Briar Hollow update still lists Thornfield's pups, so the
swap only makes the mix-up worse. The guided litter flow's "Share the available pups"
(`companionLink.js` header) sends the same bundle.
**Why it matters** A family is shown the wrong kennel's litters and prices under her
name. Keeping Companion identity global was decided (spec §10, "do not re-litigate"), but
the decision didn't cover the bundle's contents, and the stated workaround depends on the
contents following the send.
**What I'd do** Filter `available` to the active kennel (or a "Send for" kennel picker
when there are 2+ own kennels), scope-transparent rules as elsewhere. This leaves the
global-identity decision alone. Surface it to the owner.

## 3. Litter packs make every pup's documents public to the whole litter  (S2, verified by reading)
**Where** `shared/data/fureverContentPack.js:40–59, 159` puts every chosen document into
one folder, shares it "anyone with the link" and writes a manifest listing each file's
Drive `fileId` with its `dogId`. Each family's seed carries that manifest pointer.
`furever/data/contentPackFetch.js:62–66` (`filesForThisPup`) then just doesn't *download*
the other pups' files.
**Scenario** A litter pack holds pup A's vet summary and registration papers and pup B's
the same. Family B's app reads `pack.json` (public: the fetch at :35 uses only the
API key) and every file id in it. Each id opens with the same public read
(`files/{id}?alt=media&key=…`, or simply drive.google.com/file/d/{id}). Family B can get
pup A's records. Only `contract` gets the "this becomes public" warning (`furever.js:775`);
`vet_summary`, `registration`, `health_test` and `other` go out with no warning.
**Why it matters** The code comment says the filter exists so that a family doesn't see
"every other pup's filed documents", but it is only a display filter: nothing stops the
access. A registration certificate or vet record can carry the other family's name and
address once the pup is registered.
**What I'd do** One manifest per pup (or a per-pup sub-folder and manifest) for
pup-specific documents, with only the sire/dam documents in the shared litter manifest.
Until then, show the public-by-link warning for every document type in a litter publish.

## 4. A second pup from the same breeder gets no documents  (S2, verified)
**Where** `furever/data/contentPackFetch.js:84–87`: `contentPackRepo.getByKey(packKey)`
holds one version per **pack** (`content_packs: 'id, &pack_key'`), but the documents it
gates are per **pet** (`replaceBreederLayer(petId, …)`, :108).
**Scenario** A household takes two pups from the same breeder: siblings, or a second pup
a year later. Pup 1's link fetches the kennel pack v3 and caches it as `PK@3`. Pup 2's
link carries the same pointer, and the fetch returns at :86 because "already have this
version". Playwright with `fetch` stubbed: `{"A":["Care guide"],"B":[]}`. For a litter
pack it's worse: siblings share the litter pack, so pup 2 never gets *its own* documents
either. Nothing tells the family anything is missing.
**What I'd do** Key the cache on `(pet_id, pack_key)`, or skip only when this pet
already has breeder documents for the pack at that version.

## 5. Furever identity lives on one device; a second device forks the breeder card  (S2, verified by reading)
**Where** `shared/data/settings.js:310–317` mints `breederKey` into localStorage on first
read. The whole Furever block (kennel name, tagline, contact, vet, the kennel
`contentPack` pointer) is localStorage only. It is not in `exportAll()`, not in cloud
backup, not in live sync (grep: no reader outside `settings.js` and the two exporters).
`fureverSeedExport.js:115` puts it in every packet. `furever/data/breederRepo.js:23–35`
upserts the breeder **by `breeder_key`**.
**Scenario** She sent Max's family their link from her laptop. Live sync is on, and next
week she resends from her phone to update the pickup plan. The phone mints a new
`breederKey`. The family's app creates a second breeder row and re-points Max at it
(`petRepo.upsertSeededPet` writes `breeder_id`). The new row has whatever the phone
prefilled: name and contact if `myKennelId` / `myContactId` are set there, but no
tagline, no vet unless she has exactly one vet contact, and no kennel pack pointer (so
the packet carries no kennel-wide documents). The same happens after Reset App, a
cleared browser, or restoring her backup onto a new computer. Guide §27 calls the key
"one per installation" but doesn't follow that through to a breeder with two devices,
which live sync now makes normal.
**What I'd do** Move `breederKey` (and probably the Furever and Companion identity blocks)
into program data that rides backup and sync. A kennel-row field fits, or the settings
record cloud backup already restores. Mint the key once per program, not once per
browser.

## 6. Unticking "own kennel" on a working kennel locks its dogs  (S2, verified by reading)
**Where** `shared/pages/kennels.js:201–206` saves `is_own_kennel` with no check on what
points at the kennel. `dogRepo.update` re-runs `validateDog` on the merged record
(`dogRepo.js:252`), which calls `assertOwnKennel` for owned / co-owned dogs (:147).
`saleRepo.create` (:54) and the other scoped repos assert it on create.
**Scenario** She has Briar Hollow with 8 dogs, 2 litters and open sales, and while tidying
the Kennels list she unticks "This is one of my own kennels". From then on: every save on
a Briar Hollow dog throws `Dog: "Briar Hollow" is not one of your own kennels.` That
includes automatic writes such as a status change when a sale is delivered or Kels's
promotions. A new sale for one of those pups throws the same `Sale:` error. The kennel
drops out of the scope switcher and the hub, so its records show only under All kennels.
In Lite, with one kennel, the mandatory setup gate fires again and makes her a second
kennel. The error doesn't mention the checkbox.
**What I'd do** Refuse the untick while any scoped record or owned dog points at the
kennel, and say how many and that archiving is the exit. The same rule the spec's §4.2
applies to hard delete.

## 7. Furever Merge restore fails on the family's other phone  (S2, verified)
**Where** `furever/data/importExport.js:146–153` `bulkPut`s every row by `id` inside one
transaction, and `content_packs` has a unique `&pack_key` (`db.js:133,157`).
**Scenario** Both parents opened the breeder's link on their own phones. Each fetched the
kennel pack, so the same `pack_key` sits under different row ids. One backs up and the
other chooses Restore → **Merge**. Playwright: `BulkError: content_packs.bulkPut(): 1 of
1 operations failed … ConstraintError: Unable to add key to index 'pack_key'`. The whole
transaction rolls back, so nothing merges, and the family sees that raw message. With no
`pack_key` clash, the same Merge still gives duplicate pets for one pup (two rows, one
`pup_id`, different ids). `getByPupId().first()` then picks one arbitrarily on the next
resend.
**What I'd do** Merge `content_packs` by `pack_key` and seeded pets by `pup_id`, the same
match-or-create-by-natural-key rule the breeder app's restore uses, and catch the error
into a sentence.

## 8. Dog Cards send dogs that aren't hers, under the wrong kennel  (S2, verified by reading)
**Where** `shared/data/dogCard.js:536–538` `sendableDogs()` = every non-archived,
non-pedigree-only dog: external, leased-in, and every own kennel's dogs.
`pages/dog-cards.js:56–60` lists them all under "All my dogs". The "Send from" kennel is
picked separately (defaulting to the active one). The receiver files a new dog as
`ownership_type: 'external', owner_contact_id: <sender>, kennel_id: <sender's kennel>`
(`dogCard.js:480`).
**Scenario** She ticks "Tick all shown" to send her program to a co-breeder. The card
includes the outside stud she used last year (another breeder's dog) and her Briar Hollow
dogs while "Send from" says Thornfield. On the co-breeder's side the outside stud becomes
a dog owned by her and living at Thornfield, and the Briar Hollow dogs are filed at
Thornfield. Their pedigrees, website and future cards then repeat that.
**Why it matters** This is wrong data in another breeder's records, which they may
publish on their website. The plan asked whether a whole-program card respects the
active kennel. It doesn't: the dog list is unscoped, and nothing ties a dog to the kennel
the card claims it's from.
**What I'd do** List only dogs she owns or co-owns (external and leased-in only as
ancestors), scoped to the "Send from" kennel (or carry each dog's own kennel on the
card). Seam, one line: on her website a co-owned dog is named with the kennel it lives
at, and the card should say the same thing about the same dog.

## 9. Reminders page isn't scoped; the tiles that open it are  (S3, verified by reading)
**Where** `shared/pages/reminders.js:92` lists `eventRepo.getReminders()` unfiltered.
`dashboard.js:94–96` and `today.js` count `reminders.filter(eventInScope)` and link to
`reminders.html`.
**Scenario** Scoped to Thornfield, the Dashboard says "2 overdue reminders". She taps it and
sees 6, including Briar Hollow's, with no "🏠 Thornfield only" chip to explain why.
**What I'd do** Apply `subjectInScope` with the page's existing maps (it already loads
dogs, pairings and litters at :147), and mount the scope chip.

## 10. Stud Services and Documents lists aren't scoped  (S3, verified by reading)
**Where** `shared/pages/stud-services.js:69–75` and `pages/documents.js:148–153` load
everything. Neither imports `kennelScope`, though both tables carry a stamped
`kennel_id`. Every other list built on `listView` or `reportView` is scoped.
**Scenario** Scoped to Briar Hollow, the Sales hub's Stud Services tab shows Thornfield's
stud services, and Storage → Documents shows Thornfield's health certificates, with no
chip. Spec §15.2 decision 5 says "there is no state in which records are missing and the
UI is silent", and these two pages break that in the other direction: records from
another kennel appear with no chip to explain why.
**What I'd do** `inScopeOnly` on the loaded rows, plus the chip. (The rest of the sweep
was clean: of the 55 page scripts without a `kennelScope` import, the others are
imports, contacts (deliberately unscoped), reports scoped in `reportSources`, or
per-kennel pages like Waitlist.)

## 11. Expenses on an outside dog count in every kennel's P&L  (S3, verified by reading)
**Where** `shared/data/scopePredicates.js:65` sends a dog-subject expense through
`dogInScopeOf`, which makes an external dog transparent, so it is in scope under every
kennel. Financials (`pages/financials.js:97`), `moneyReport.loadMoney` and every money
report use it. The kennel hub (`pages/kennel.js:257–268`) counts only its own roster's
dogs.
**Scenario** She pays $600 to board an outside stud for a breeding at Thornfield. Scoped
to Thornfield, the expense is $600. Scoped to Briar Hollow it is also $600. Summing the
two kennels' P&Ls overstates spend by $600. Thornfield's own hub (Kennel → Finances)
leaves it out, so "Expenses" on the hub and on Financials differ for the same kennel. The
hub's hint says it is "derived exactly as the Financials hub derives its own totals",
which is not true here.
**Why it matters** Transparency is right for a *list* (§7), but these are *totals*, which
the spec's own dashboard comment calls the place where "a count that silently mixed two
kennels together would be wrong in a way a list never is".
**What I'd do** For money, attribute an external-dog expense through what it's for (its
`stud_service_id`, a pairing or litter) and leave it unscoped only when nothing places
it. At least make the hub and Financials use one rule.

## 12. Majors with no judge typed are reported as missing  (S3, verified)
**Where** `shared/data/showPoints.js:84–90`. `majorsShort` takes the larger of majors
still needed and *distinct major judges* still needed, and a blank judge isn't counted
(`tally`, :62–66). The judge field isn't required (`vocab.js:805`).
**Scenario** 15 points, two 3- and 4-point majors with the judge left blank, three named
judges on the minors. Node: `missing: ["2 majors under 2 different judges"]`. She has
both majors. What's missing is the judges' names.
**What I'd do** When `t.majors >= track.majors` but judges are short, say "add the judge
to your majors so they can be checked" (and flag the rows). A small note on the same page:
a result logged on show day stays under Upcoming (`>= today`, :129) and only moves to
Results the next day.

## 13. Anyone can make a page on KennelOS's domain that looks like her update  (S3, verified)
**Where** `shared/companion-view.html` decodes whatever bundle the URL hash carries, with
no signature or origin marker. The shell is on the app's own domain
(`companionLink.js:22`).
**Scenario** A scammer copies a real Companion link from a puppy listing or a forwarded
text, or writes one from scratch: kennel name "Thornfield Kennels", `remainingBalance:
1800`, a contract link "View/sign contract here →" pointing at their own payment page.
It opens on her KennelOS address, looking exactly like her real updates. (Playwright
rendered a hand-built bundle the same way.) Puppy-deposit fraud is the commonest scam
families meet, and this gives it a trusted address.
**What I'd do** At least a visible line on the shell ("a snapshot sent by the kennel, not
checked by KennelOS: confirm payment details with them directly"). Better: sign bundles
with the kennel's key, or host the shell on a domain that isn't the app's.

## 14. A file that failed once is never fetched again  (S3, verified by reading)
**Where** `furever/data/contentPackFetch.js:94–113`. A failed file download is swallowed
(:104), then `replaceBreederLayer` and `contentPackRepo.upsert` record the pack as
fetched at that version.
**Scenario** The family opens the link on a weak signal at pickup. Four of five files
come down. The fifth (the health guarantee) never does: every later open sees "already
have v3" (:86) until the breeder republishes, and she has no reason to. Nothing tells the
family it's missing.
**What I'd do** Don't record the version unless every file arrived, or keep a
per-file retry list.

## 15. The Dog Card allow-list sends microchip numbers  (S3, verified by reading — an owner decision to surface)
**Where** `shared/data/dogCard.js:69` puts `microchipId` in `DOG_FIELDS`, for sent dogs
and every ancestor up to 4 generations.
**Scenario** She sends a co-breeder her program. The card carries the microchip of a
retired dam now living in a pet home, and of an outside sire whose number she recorded.
A microchip number is a lookup key into a pet-recovery registry, and some registries
show the registered owner's contact details. The co-owner's name is rightly left out,
but the chip number isn't.
**What I'd do** Take the decision to the owner: drop `microchipId` for ancestors and for
placed / pet-home dogs at least, or make it a per-send tick. Registration numbers on a
leased-in dog are a similar call.

## 16. Spec section numbers in breeder-facing hints  (S3, verified)
**Where** `pages/financials.js:169`, `litter.js:325`, `pairing.js:166`,
`stud-service.js:236`, `sale.js:529`: "… (Multi-Kennel Scope Spec §9)." These are
`field-hint` text she reads.
**What I'd do** Drop the parenthesis. The sentence before it already explains.

## 17. Links from outside aren't checked for http(s)  (S4, verified)
**Where** `companion-view.html:202,352,361,380` and `pages/dog.js:296` put
`esc(url)` into `href`. `esc` stops HTML injection but not a `javascript:` scheme. A
Dog Card's `photosUrl` lands in `dog.url` with no check (`dogCard.js:70`).
**Scenario** A crafted bundle with `photosUrl: "javascript:…"`. In Chromium (Playwright)
the `target="_blank" rel="noopener"` click opens a blank tab and the script doesn't run.
That depends on browser behaviour, not on the code. A future edit that drops
`target="_blank"`, or a browser that handles it differently, runs script on the app's
origin, next to her whole program in IndexedDB.
**What I'd do** One `safeHref()` (http/https/mailto only) in `ui.js` and the shell.

## 18. Furever restore doesn't migrate older backups  (S4, verified)
**Where** `furever/data/importExport.js:140–155` reads `schema_version` but ignores it,
and `bulkPut`s rows as they are. `db.js` v2 moved `contacts.pet_id` → `pet_ids` in an
`.upgrade()` that runs only on the live database.
**Scenario** A family restores a backup made before v2. Playwright: the contact comes back
with `pet_id: "p1"`, no `pet_ids`, and isn't found by the `pet_ids` index, so their vet is
gone from every pet page. Whether any v1 backups exist depends on when Furever went to
families. The risk is the next schema change: a restore never re-runs an `upgrade()`.
**What I'd do** Run per-version row migrations in `restoreBackup` for files whose
`schema_version` is below `db.verno` (v1→v2 is a few lines).

## Notes, not findings
- **The scope layer is solid.** `scopePredicates` and its bound forms are used
  consistently: reports through `reportSources`, the dashboard, Today, nudges, the away
  board, calendar, income at its source (`incomeView`, with `kennelId` for the hub), and
  every scoped repo's `assertOwnKennel`. The waitlist is per kennel by construction.
  Stamping by inheritance (`resolveKennelIdForWrite`) is correct: a sale for a kennel-B
  dog made while scoped to A files under B. Contacts, pedigree and the kennel tree stay
  deliberately unscoped, with comments at the call sites. No leak in a list *read by id*.
- **Kennel Card allow-list** (`kennelCard.js`) is tight: four fields, a positive check,
  and `is_own_kennel` is never settable from a card.
- **Companion allow-lists** hold up: no record spread, a positive `assertOnlyKeys` on
  every bundle, archived events excluded (`getForSubject`), event titles and per-type
  details only. One thing to watch: a `note` event's *title* is free text she typed, and
  it goes out whenever "Notes" is ticked.
- **A crafted Furever seed link can rewrite a breeder's card.** `breederKey` isn't
  secret (it's in every packet a family received), so a link carrying it can overwrite
  that breeder's phone number in another family's app. It needs the family to tap the
  link. Worth a line if seed links ever get signed.
- **Furever offline.** There is no service worker or manifest yet. `furever/README.md:159`
  lists that as still to build, so it isn't a finding, but an app "a family installs at
  pickup and keeps for years" doesn't work offline today, and the seed link needs a
  network on first open.
- **Companion and invoice settings are per device too** (`KEYS.companion`,
  `invoiceDefaults`, `mileageDefaults`). On her second device the Companion templates
  start blank. This is the same root cause as #5, with lower stakes.
- `dist/furever/README.md` is published with the Furever site (the build copies the
  folder). It's harmless but public.
- **Seam, one line:** the website's co-owned-dog wording and a Dog Card's "lives with"
  for the same dog come from different places (`siteExport` vs. the receiver's choice at
  `dogCard.js:481`). See #8.

## Coverage gaps I found (tests that should exist)
- `tests/companionExport` (or extend an existing suite): a prospective bundle with two own
  kennels and the active scope set, asserting only that kennel's pups.
- Furever: `upsertSeededPet` over a family-edited pet (name and photo survive);
  `fetchContentPackagesForPet` for two pets sharing a pack; Merge restore with a clashing
  `pack_key`; restore of a `schema_version: 1` file. None of Furever's data layer has a
  `node --test` suite, and it's all browser-verified by hand per its README.
- `kennelRepo.update` refusing `is_own_kennel: false` while records point at the kennel.
- `showPoints`: majors with blank judges.
- A source-level guard like `referenceRegistry.test.js`: every page that loads a table
  with a stamped `kennel_id` either uses a scope helper or carries a "deliberately
  unscoped" comment. It would have caught #9 and #10.

## What I did not get to
- **Furever stopped here:** reviewed the data layer that touches the breeder side (`db.js`,
  `seedLink`, `petRepo`, `breederRepo`, `contentPackFetch`, `contentPackRepo`,
  `documentRepo`, `importExport`, `app.js`) and `pages/profile.js`; grepped all pages for
  escaping and layering; ran a 320px and console-error pass over all 13 pages. **Not
  reviewed:** `schedule.js`, `careLibrary.js`, `trainingContent.js`, `ageBrackets.js`,
  the training/skill repos, `appReset.js`, and the page recipe in depth for today,
  health, potty, training, feeding, photos, documents, contacts, family. This is roughly
  3,500 of Furever's 6,900 lines, and a good split for a follow-up session.
- `pages/furever.js` beyond the identity card and the publish/confirm path (the per-pup
  rows, the Drive connect flow, `googleDrive.js`).
- `assets/pickToSend.js` (header only; it's money and waitlist, K8/K10 territory),
  `kennelCardUI.js`, `kennelSetupUI.js`, `kennelScopeUI.js` in detail, `pages/settings.js`.
- `pages/companion.js`'s recipient-membership predicates (read their comments, not
  their code) and the guided share step.
- Dog Cards' receiving side (K2's) and `coOwnedWebsite` (seam).
- A browser run with two own kennels switching scope across every page. The scope
  findings above come from reading the code and the sweep, not from clicking through.
