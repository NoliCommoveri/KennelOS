# K13 — Editions, the build, first run, PWA, the marketing site

Reviewed: `shared/data/editionConfig.js` (149), `lite/editionConfig.js` (187), `lite/editionTour.js`,
`pro/editionConfig.js` (144), `demo/editionConfig.js` (116), `editionTour.js`, `proPages.js` (155),
`assets/editionLinks.js` (248), `assets/upgradeNudge.js` (81), `demoMode.js` (56), `appReset.js` (59),
`build/assemble.mjs` (235) + `build/README.md`, `shared/sw.js` (563), `shared/app.js` (239),
`rosterCount.js`, `dogRepo.js` / `litterRepo.js` (the cap hooks), `importExport.js` (every restore mode),
`csvImport.js` (dog classify + commit), `recordMerge.js`, `guidedDogs.js`, `guidedLitter.js`,
`dogCard.js` (apply), `syncApply.js`, `cloudBackup.js` (restore), `sampleData.js` (seed + clear),
`seedImport.js`, `wizardUI.js` / `wizardState.js`, `assets/onboardingUI.js` (137),
`assets/sampleDataUI.js` (69), `license.js` (grace constants), `kelsKnowledge.js`, `portalFeed.js`
(payload), `syncRegistry.js` + `cloud/src/lib/cloudFields.js` (the readable tier), `googleDrive.js`,
`pages/companion.js` / `pages/furever.js` (their saves), `cloud/src/retention.js`, `integrations.js`,
the migrations' email columns, `site/*` (12 pages; `privacy.html` 443 and `terms.html` 331 read in
full), `.github/workflows/deploy.yml`.
· Contract read: `docs/KennelOS_Lite_Cap_Enforcement_Spec.md` (whole), the Review Plan's K13, guide §0
(through the configs), `docs/LAUNCH_CHECKLIST.md` (checkout links), `build/README.md`, `site/README.md`.

Verified by: baseline at `54ecfb5` — `node --test` **1649 pass**, `cd cloud && npm test` **305 pass**,
`node build/assemble.mjs` and `--release` both succeed (green). Then, all in my scratchpad:
- **A Lite cap harness on the assembled build**: the repo's `tests/support/memoryDb.js` pointed at
  `dist/lite/data/db.js`, so the real Lite `editionConfig.js` runs (the repo's own tests can't import
  it). It proves findings 4, 5 and 9, and that the 7th owned adult is refused.
- **Seed then clear** sample data through the real seeds of `dist/pro` and `dist/lite`: nothing is left
  in any table either way.
- **A module-graph walk** of each `dist/<edition>` (every static and literal dynamic `import`, every
  `<script src>`): Pro and Demo resolve completely; Lite has one broken static import (finding 7) and
  32 dynamic imports of dropped files, each of which I checked is behind an edition flag.
- **All three builds served** (`python3 -m http.server` on each `dist/<edition>`) and every page crawled
  in Chromium, logging page errors, 404s and any request leaving localhost: Lite 32 pages (the one
  error is finding 7), Pro 87, Demo 84 (clean, and no outside requests from any of them).
- **Demo writes in a real browser** (finding 6) and **Kels's Find list fetched page by page** in Demo
  and Lite (finding 8).
- **A service-worker update experiment** on a scratch copy of `dist/lite` (finding 10).
- **The site** at 320 px: 12 pages, no sideways scroll, the menu opens, no broken internal links, and
  the six checkout links are present (three on `pro.html`, three on `upgrade/`; not clicked, since
  that's a launch step).

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S1 | site/privacy.html:102, :122 · data/kennelportLink.js · data/portalFeedSync.js | "If you never sign in to cloud backup, we receive none of them" and "It is not sent to us". But a Pro breeder who links her KennelPort website (which "we also run") sends records with no cloud sign-in at all, and the puppy-portal feed sends families' names, emails and pups' microchips by itself | verified (code) |
| 2 | S1 | site/privacy.html:160–166 · data/syncRegistry.js:40, :194, :303–320, :341, :355 | Every cloud backup holds, readable, more than §6 lists or than §2/§6 say never goes: the application's preferences (sex, breed, purposes, colours, readiness) against "Nothing else from an application"; vet summaries against "health-test results, pedigrees and registration papers"; the whole Accounts table (payment instructions and links, referral codes, Jotform form ids and field names, fee rates); and each sale's Stripe payment link, which opens on the amount, against "prices … never readable" | verified (code) |
| 3 | S1 | site/privacy.html:138, §12 · data/googleDrive.js:163 · pages/furever.js:714 | Furever's "Publish to Furever" uploads her documents and photos to her Google Drive and shares the folder with anyone who has the link. The policy never mentions Google Drive, and Google isn't in the providers table, though §4 lists every outside service the apps contact | verified (code) |
| 4 | S2 | data/rosterCount.js:20 · csvImport.js:261 | Leased-in and leased-out adults never count toward Lite's cap, and Lite's CSV import takes `ownership_type` = `leased_out` without a question: at 6/6, a ten-row file lands 9 more working adults on the Dogs list | verified |
| 5 | S2 | data/importExport.js:176, :407, :551, :682 · litterRepo.js:71 | No restore checks the litter cap (file Replace, file Merge, cloud, vault). A Pro backup with 30 litters restores into Lite whole, and then every new litter is refused | verified |
| 6 | S2 | pages/companion.js:198 · pages/furever.js:165, :700, :714 · site/privacy.html:146 · site/terms.html:93 | Demo isn't read-only. Companion's template Save and Furever's kennel-identity Save say "Saved." and survive a reload, and Furever's Connect Google Drive + Publish uploads the demo's records to the visitor's Drive. Privacy says "nothing you do in it is saved"; terms say it "saves nothing" | verified (browser; Drive by code) |
| 7 | S2 | pages/live-births.js:7–8 · data/kelsKnowledge.js:77, :180 | In Lite, `live-births.html` imports two Pro-only modules the build drops, so the page throws and its report never draws. Kels's Find offers it in Lite ("born alive", "live births"), and its "← All reports" link is a 404 | verified (crawl) |
| 8 | S3 | data/kelsKnowledge.js:180 · build/assemble.mjs (`DEMO_EXCLUDED_PAGES`) | Kels's Find in Demo offers eight places the Demo build removed (Settings ×4, Import/Export ×3, KennelAssistant). Each one is a 404 | verified (browser) |
| 9 | S3 | data/recordMerge.js:359 · assets/duplicateScanUI.js:136 · tidyUpUI.js:713 | In Lite at 6/6, merging a puppy record with an adult copy of the same dog (taking the adult's status) is refused, though the merge leaves 6. She sees "I couldn't merge them: Lite limit reached: 6/6 dogs." with no nudge | verified |
| 10 | S3 | shared/sw.js:474, :484 · app.js:43 | A new version takes over open pages silently (`skipWaiting` + `clients.claim`, no reload, no notice). An open page's next lazy import loads new code against the old modules already in memory and throws "does not provide an export named …". Most of these imports end in `.catch(() => {})`, so a panel just doesn't appear | verified (experiment) |
| 11 | S3 | assets/onboardingUI.js:56, :58 | Lite's very first screen promises contracts, stud services, puppy records and invoices, all Pro-only in Lite | verified (code) |
| 12 | S3 | site/editions.html:198 | The upgrade dialog calls cloud backup "the easiest path" from Lite to Pro and doesn't mention private backup. Without it, Pro arrives with no prices, contact details, expense amounts or notes | verified (code) |
| 13 | S3 | app.js:33–37, :197 | Persistent storage is asked for on the first page load, before the welcome card is answered. It's marked as asked whatever the answer and never asked again, not even once she has records or installs the app | verified (code) |
| 14 | S3 | data/guidedLitter.js:616–626 · assets/guidedLitterUI.js:673 | Kels's Record a litter at Lite's 10-litter cap with a new dam of hers: the dam is saved (and takes one of her 6 dog slots), then the litter is refused | verified (code) |
| 15 | S4 | .github/workflows/deploy.yml · build/assemble.mjs (`LAUNCH_PLACEHOLDERS = []`) | Nothing between a merge to `main` and the five live origins runs a test or checks a build. `--release` guards an empty list, so finding 7 is already live | verified (code) |

---

## The cap, at every door

Every path that creates (or brings back) a dog or a litter, and whether Lite's hooks see it:

| Path | Writes through | Lite cap |
|---|---|---|
| Dog page, New Dog | `dogRepo.create` | ✓ hook, nudge, "x/6" line |
| A pup grown up, any status edit | `dogRepo.update` | ✓ ✗→✓ rule |
| Litter page | `litterRepo.create` | ✓ |
| Add Puppies, litter check-in, prep pups | `dogRepo.create` | ✓ (puppies don't count) |
| CSV import, dogs and litters | the repos, per row | ✓ per row, but leased dogs never count (**4**) |
| JSON restore, Replace and Merge | `bulkPut` | dogs ✓ before any write; **litters ✗ (5)** |
| Cloud restore (cloud-merge, then vault-merge) | `bulkPut` | dogs ✓; litters ✗ (5); see notes on pairing |
| Live sync, join or pull (`syncApply`) | `put` | no hook; unreachable in Lite (`liveSync` off, server checks Pro) |
| Sample data (Lite's own seed) | the repos | ✓; sized to sit exactly at 6 dogs and 2 litters |
| Kels's Add dogs | the repos | ✓; stops at the cap with the nudge (parents and breeders it made first stay; designed) |
| Kels's Record a litter | the repos | ✓; a new parent can be saved before the litter is refused (**14**) |
| Duplicate merge (Scan for duplicates, Kels's Tidy up) | `repo.update`, then delete | ✓, but refuses a merge that leaves the count unchanged (**9**) |
| Pedigree import, pedigree chart edits | `createPedigreeOnly` | not counted (pedigree-only), by design |
| Dog Cards | the repos | would hit the hooks; Pro-only (flag off and page dropped in Lite), and Lite has no link to it |
| Furever seed | nothing (export only) | n/a: creates no KennelOS dog |
| KennelPort link, portal feed | repo updates | Pro-only (`websiteLink` off in Lite) |

Archive-on-departure is one way: no Lite path unarchives a dog (`salePrompts.js`, `sale.js`), so a
cancelled sale can't push the roster past the cap behind her back.

---

## 1. "If you never sign in to cloud backup, we receive none of them" (S1, verified (code))
**Where** `site/privacy.html:102` (the short version) and `:122` ("Using the apps without cloud backup …
It is not sent to us"). The code: `kennelportLink.js` needs no cloud session (its only `getCloudSession`
use is the helper check at :240); `kennelportApi.js` sends to `api.kennelport.com`; `portalFeedSync.js`
sends the family feed by itself from a linked device (`app.js:222`).
**Scenario** A Pro breeder who never turns on cloud backup links her KennelPort website. Update website
sends her dogs, litters and prices to KennelPort. Once the portal is on, each placed family's name,
email addresses, pup's microchip and registration number, vaccinations and her vet's address go there
by themselves. §9a says KennelPort is "which we also run".
**Why it matters** The two sentences a breeder is most likely to read, and quote to her families, say
the opposite of what happens. §9a describes it correctly, so the policy contradicts itself.
**What I'd do** Make the short version and §4 say "unless you sign in to cloud backup **or link your
KennelPort website**".

## 2. The readable cloud tier holds more than the policy lists (S1, verified (code))
**Where** `site/privacy.html:160–166` against `syncRegistry.js` (what `cloudFields.js` is generated from):
- `waitlist_entries` (:341, :355): `pref_sex`, `pref_breed`, `pref_purposes`, `pref_colors`,
  `ready_timing`. §6 says "each applicant's name and email. Nothing else from an application".
- `CLOUD_DOC_TYPES` (:40) includes `vet_summary`. §6 lists "health-test results, pedigrees and
  registration papers" and says other documents stay on the device.
- `accounts` (:303–320): name, website, referral link, code and instructions, fee percent and fixed
  fee, `contract_forms` (her Jotform form ids and field names), `payment_link`, `payment_instructions`.
  This goes in every backup, in Lite and Pro alike. §6's "Your kennel records" doesn't mention business
  accounts at all. Only §9 (the online list) mentions accounts, and only the ones marked Share with families.
- `sales.payment_link_url` (:194). A Stripe payment link opens on its amount and her business name.
  §6 says "the prices, deposits, fees and payments on your sales … never leave your device" unless encrypted.
**Scenario** A breeder relies on §6's two lists to tell a family what the service can read about
them. The list leaves out what the family asked for in the application. Her own payment instructions,
referral codes and open payment links sit readable on the server.
**Why it matters** Each item is a recorded decision in the registry, and most are reasonable. But the
policy is the promise, and here it says less than the code sends. The plan's rule makes a gap in either
direction S1.
**What I'd do** Add the four items to §6's "What we keep" (vet summaries in Documents; the accounts
table; "the preferences asked on your form"; open payment links). Or move `payment_link_url` private
and let `payment_link_ref` do the matching.

## 3. Furever's Google Drive publish isn't in the policy (S1, verified (code))
**Where** `pages/furever.js:700` (Connect Google Drive), `:714` `doKennelPublish` → `fureverContentPack.publishPack`
→ `googleDrive.js:163` (`{ type: 'anyone', role: 'reader' }` on the folder). Also Kels's setup
(`kelsSetupUI.js:558`). Policy §4 (:138) only says "Companion and Furever links … carry what you chose
to share in the link itself". §12's providers table has no Google Drive.
**Scenario** A breeder publishes a litter's content pack, with its documents and her own uploads
(the page itself warns when a document type is sensitive). The files sit in her Drive, readable by
anyone who has the link. Nothing in the policy told her or her families that.
**Why it matters** §4 reads as the complete list of outside services the apps contact. This one is
missing, and it's the one that makes files public by link.
**What I'd do** Add a Google Drive bullet to §4 (her own Drive, `drive.file` scope, shared by link) and
a row to §12. Terms §12 needs the same.

## 4. Leased dogs are a way round Lite's cap (S2, verified)
**Where** `rosterCount.js:20` counts only `owned` / `co_owned`. Cap spec §1 relies on Lite's dog form
never offering the leased types. But `csvImport.js:261` normalises any `OWNERSHIP_TYPE` with no
edition check, and `leased_out` isn't owner-required (`csvImport.js:410`), so the row plans as a plain
Create.
**Scenario** (harness on `dist/lite`) At 6/6, a CSV of ten rows with `ownership_type` = `leased_out`
and `status` = `active_breeding` imports 9 dogs (the tenth had a bad date). All 15 are on her Dogs list,
and "Creating 6/6" still shows. Restoring a Pro backup with leased-in dogs does the same. The cap spec
(§1a) planned for statuses that slip in through import, but not for ownership types.
**Why it matters** It's a silent overfill the spec calls S2, through a front door (CSV import), with no
devtools needed. It also leaves dogs whose ownership Lite's own form can't show.
**What I'd do** Either count every live adult that isn't `external` / pedigree-only, or have Lite's CSV
mapping refuse the leased types the way its form does.

## 5. No restore checks the litter cap (S2, verified)
**Where** `enforceImportDogCap` is the only hook any restore calls (`importExport.js:176`, `:407`, `:551`,
`:682`); `enforceLitterCap` is reached only from `litterRepo.create` (:71). Cap spec §9 says "both bulk
paths are cap-gated", but its JSON-restore paragraph only covers dogs.
**Scenario** (harness) A file with 6 dogs and 30 litters restores into Lite with Replace: 30 litters are
written. Then `litterRepo.create` throws "Lite limit reached: 30/10 litters". From then on every new
litter shows the upgrade nudge, so a lapsed Pro program that "fits Lite's limits" (terms §9) on dogs
gets stuck on litters.
**Why it matters** The restore over-fills silently, and the refusal only comes later, at an unrelated
moment.
**What I'd do** Give the restore hook the incoming litters too (`enforceImportCap({ dogs, litters, mode })`),
or decide that restores may exceed the litter cap and say so in the spec and on the site.

## 6. Demo saves, and can publish to Google Drive (S2, verified (browser); Drive by code)
**Where** `pages/companion.js:198` and `pages/furever.js:165` write `settings.js` directly
(`setCompanionSettings`, `setFureverSettings`), outside the repos, so `assertWritable` never runs.
`furever.js:700` / `:714` (Connect Drive, Publish) run in Demo; `googleDrive.js:13` says the OAuth
client lists the Demo origin.
**Scenario** (Playwright on `dist/demo`) Companion → change the template's kennel name → Save →
"Saved." → reload: the new name is there. Furever's kennel identity behaves the same. On Furever,
Connect Google Drive and Publish upload the demo's sample documents to the visitor's own Drive and make
them public by link.
**Why it matters** Demo's whole promise is "Changes aren't saved" (its banner, privacy :146, terms :93).
These are the only writes I found that get past it. Each repo write, restore, merge and file write does
throw `DemoModeError`. I'm grading this S2, as the plan grades a Demo write, rather than S1 for the
policy wording: nothing leaves the visitor's own browser except to her own Drive.
**What I'd do** Hide those Save buttons and the Drive card when `isDemo()`, the way `accounts.js:481` does.
Or route the two settings writers through `assertWritable`.

## 7. Lite's Live-Birth Summary page is broken (S2, verified (crawl))
**Where** `pages/live-births.js:7–8` import `data/reportSources.js` and `data/reportFigures.js`, both in
`PRO_ONLY_STANDALONE`. `live-births.html` isn't Pro-only, so it ships in Lite; `kelsKnowledge.js:77`
lists it with no flag, and `placeCandidates` (:180) offers it in Lite.
**Scenario** In Lite she asks Kels "how many were born alive?". Kels links the Live-Birth Summary, which
shows its title and an empty area (two 404s, the module never runs). "← All reports" goes to
`reports.html`, which is a 404 in Lite.
**Why it matters** A page that throws, reached from a Lite helper. It's also exactly what a module-graph
check of `dist/lite` catches (my walk found it at once), and nothing runs one (finding 15).
**What I'd do** List `live-births.html` in `PRO_ONLY_PAGES`, or give the Lite page its own loader. Then
add the graph walk as a test.

## 8. Kels's Find in Demo sends visitors to 404s (S3, verified (browser))
**Where** `kelsKnowledge.js:180` filters Pro-only pages for Lite only. Demo drops
`import-export.html`, `settings.html` and `assistant.html` (`assemble.mjs` `DEMO_EXCLUDED_PAGES`).
**Scenario** On demo.kennelos.app, a visitor asks Kels "how do I back up?" or "settings". Eight
places (Back up and restore, Import from a spreadsheet, Reset the app, Settings, Cloud account and
sign-in, Your license, The guided tour, KennelAssistant) each open "File not found".
**What I'd do** Add `edition === 'demo' && DEMO_EXCLUDED…` to `offered`, or give each of those places
`flag: '!demoMode'`.

## 9. A merge that leaves the count unchanged is refused at Lite's cap (S3, verified)
**Where** `recordMerge.js:359` updates the kept record (through `dogRepo.update`, so the cap hook runs)
before the duplicate is deleted at :362. `enforceDogCap` counts the duplicate as one of the six.
**Scenario** (harness) She has five adults plus "Bonnie" twice: once as an adult (counted), once as
the puppy record from her own litter, which `suggestKeep` may well pick as the fuller one. She keeps
the puppy and takes the adult's Ownership & status. The merge stops with "I couldn't merge them: Lite
limit reached: 6/6 dogs." (`duplicateScanUI.js:136`, `tidyUpUI.js:716`), though afterwards she'd have
6. No upgrade nudge appears.
**What I'd do** Exclude `dropId` from the count for that one update (an `excludeIds` on the hook), or
delete the duplicate before writing the kept record. Catch `CapExceededError` in both UIs.

## 10. A new version silently takes over open pages (S3, verified (experiment))
**Where** `sw.js:474` `skipWaiting()`, `:484` `clients.claim()`. Nothing in `app.js` listens for
`controllerchange`, and there's no "a new version is ready" notice.
**Scenario** (scratch copy of `dist/lite`, Playwright) Today is open and controlled. A "deploy" adds an
export to `data/settings.js`, has `assets/messageComposer.js` use it, and bumps `CACHE_NAME`.
`registration.update()` → the new worker takes over the open page and nothing tells it. Three seconds
later, the page's next `import('../assets/messageComposer.js')` throws *"The requested module
'../data/settings.js' does not provide an export named 'K13_NEW'"*. In real use that's Today's Compose,
a Kels task or a lazily loaded panel, after a deploy, in a tab or installed app left open. Many such
imports end `.catch(() => {})` (`app.js:214–227`, `today.js:534`), so the panel just doesn't appear.
Any navigation cures it, since each page loads fresh.
**What I'd do** Reload a page on `controllerchange` when it's idle, or show "KennelOS updated —
reload". Either fits a multi-page app.

## 11. Lite's welcome promises Pro features (S3, verified (code))
**Where** `onboardingUI.js:56` "buyers, deposits, contracts and stud services" and `:58` "Generate
documents — puppy records, invoices and receipts". The card isn't edition-aware. In Lite, `contracts`,
`studServices`, `puppyRecord` and `invoicing` are all false.
**Scenario** A new Lite user's first screen lists four things she'll never find.
**What I'd do** Pick the two lines by `editionFlags`, as `kels.js:112` already does for its setup task.

## 12. The site's upgrade dialog oversells cloud backup (S3, verified (code))
**Where** `site/editions.html:198`: "The easiest path for upgrading is using our cloud backup option to
securely move your KennelOS Lite records to the Pro platform." `site/upgrade/index.html:61` has the
right caveat. Without private backup, the cloud tier has no prices, contacts' phone/email/address or
notes, and an expense row is only its id (`cloudFields.js`, `expenses`).
**Scenario** She follows the dialog. In Pro, her sales have no prices and Financials shows rows with no
amounts. Her data is still in Lite, and Pro shows the "private details are blank here" hint, but the
page that sent her there didn't say so.
**What I'd do** Copy upgrade/'s sentence into the dialog.

## 13. Persistent storage is asked for once, at the worst moment (S3, verified (code))
**Where** `app.js:197` → `firstRunPersistence` (:33): marks the request as made (:35), then calls
`navigator.storage.persist()`, on the first page load, before the welcome card is answered, and ignores
the result.
**Scenario** On first visit there are no records yet and no install. Chromium decides by how much the
site has been used, so a brand-new site is usually refused; Firefox asks with a permission prompt over
the welcome card. Either way it's never asked again, even once she has 200 dogs, so her records stay
"best effort" storage the browser may clear when space runs short.
**What I'd do** Ask after the first record is saved, or after kennel setup, and again (silently) while
`navigator.storage.persisted()` is false.

## 14. Record a litter at the litter cap still saves the new parent (S3, verified (code))
**Where** `guidedLitter.js:616–618` creates a new dam or sire before `litterRepo.create` at :626.
The comment at :606 puts the litter "before the breeding, so it refuses before that's made", but the
parents come before both.
**Scenario** Lite, 10 litters, 3 adults. Kels's Record a litter with a new dam of hers: the dam is
saved (4/6 now), then the upgrade nudge. The draft keeps the dam's id, so a retry won't duplicate her,
but she's on the roster though the litter she came in with was refused.
**What I'd do** Check `enforceLitterCap` up front when no litter exists yet (a `litterCapStatus` read,
like `dogCapStatus`), before any parent is made.

## 15. Nothing checks a build before it ships (S4, verified (code))
**Where** `deploy.yml` runs only `node build/assemble.mjs <edition> --release`, then publishes. It
runs no `node --test` and no cloud tests (it also sets up Node 20, though the suites need ≥ 22).
`LAUNCH_PLACEHOLDERS` is empty, so `--release` checks nothing either.
**Scenario** Finding 7 started when `ac7f44f` (2026-11-01) moved the report data modules into `PRO_ONLY_STANDALONE`. A red test
or a broken Lite graph goes straight to five live origins.
**What I'd do** Run `node --test` before the matrix, and add a small "each `dist/<edition>` resolves
its static imports" step. It's the 30-line walk I used.

---

## Notes, not findings
- **Sample data in and out is clean.** Seeding then clearing through the real Pro and Lite seeds
  leaves no rows in any table. What's left in `localStorage`: `cloudDirtyAt` / `cloudDirtySince`,
  `companion` (reset to defaults) and `sampleDataCleared`.
- **The tour's sample dogs fill Lite's six slots.** A Lite user who adds her own dogs mid-tour (before
  the tour clears the seed) is told she's at her Lite limit, though none of the six are hers. The
  upgrade nudge doesn't mention sample data. Tour exits always clear it.
- **Cloud restore in Lite, refused by the cap:** `restoreSnapshot` pairs first (`mergeJoinMatches`
  re-keys and removes this device's duplicates), then `cloud-merge` throws. The message says "nothing
  was restored", which is true of the backup, but the pairing has already happened.
- **The service worker's swap window:** between activation and the old cache's deletion, the new worker
  serves files from the *old* cache (`caches.match` looks in every cache). Seen in the experiment;
  harmless, and gone a moment later.
- **Demo is otherwise tight.** Every repo write, `restoreBackup`, `mergeDuplicate`, `fileRepo` and
  `assistantSync` asserts. Accounts hides Stripe/Jotform in Demo; `cloudUrl` and `devCloudUrl` are
  null, so no cloud request is possible; tours, migrations, Kels's setup and the portal feed are
  skipped. The crawl saw no request leave the Demo origin. Kels's guided drafts do persist in
  `localStorage` before the repo refuses (harmless). A demo seed that half-failed would never be
  retried (`ensureDemoSeed` skips once any dog exists).
- **Lite → Pro bridge:** `runUpgradeBridge` goes cloud-first only when the vault is on, unlocked and
  pushed, and saves a file otherwise. A Lite export keeps every field (Lite hides UI, never data), so
  nothing Pro would keep is lost.
- **Licence wording matches the code:** 3 / 7 days' grace, lifetime 90 days + 30 (`license.js:37–49`),
  "the name you give it" is `instance_name`.
- **Policy, small things** (no scenario worth a row): `account_deletions` keeps session-token hashes
  for 90 days after "deletes … account immediately" (no personal data). The portal feed also carries
  each family's status-page link, and a vet visit's `details.reason` when it has no title (§9a says
  "titles"). The seam's plan owns those two. Retention constants all match §13.
- **The Pro-only surface:** besides finding 7, every dropped Pro file a Lite module reaches is a
  flag-guarded dynamic import (checked all 32). `dogCard.js` and `picksPreview.js` are reachable only
  from dropped pages or flag-gated buttons (`dogs.js:165`, `dog.js:686`).
- Demo still ships the root `assistant.html` helper app; that decision is open in LAUNCH_CHECKLIST.
- The checkout links weren't clicked (a launch step, per the plan).

## Coverage gaps I found (tests that should exist)
- **The Lite cap against the real Lite config.** `tests/editionConfig.test.js` says Lite "can't be
  imported here". It can: install `memoryDb` against `dist/lite/data/db.js` after an assemble (my
  harness). That would cover findings 4, 5 and 9 and the spec's §10 list.
- **Each edition's module graph resolves** (finding 7), run on the assembled `dist/` builds.
- **Each edition's Kels places exist in that build** (findings 7–8). `kelsKnowledge.test.js` checks
  `shared/` only.
- **Demo's non-repo writers:** every `settings.js` setter a Demo page can reach is either harmless
  (UI state) or guarded (finding 6).
- **Restore + litters** and **CSV + ownership types** in Lite.

## What I did not get to
- `kennelSetupRepair` and `restoreMyKennel` beyond their passing suites. The licence gate's three
  walls in a browser (I had no key to activate). The app running from cache against a newer cloud API.
- The Furever app itself and `site/furever.html` against it (K14's), and `about.html` / `faq.html` beyond
  the edition claims (caps, cloud, upgrade) I checked.
- Terms' store-side claims (the yearly plan's 7-day trial, prices): those are Lemon Squeezy settings,
  not code.
