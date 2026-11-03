# Session prompts

One block per review session. Paste a block as the session's task. Each block is
self-contained apart from the plan, which it tells the session to read first.

Every block assumes `/home/user/KennelOS` is attached, ends with a findings file committed
and pushed to that session's own branch, and forbids changing code, tests or
`CACHE_NAME`.

---

**K1 — schema, repos, registries, referential integrity**

> Read `docs/KennelOS_Review_Plan.md` (section 0, 0a and "Session K1") and follow it. You
> are reviewing the data foundation: `shared/data/db.js`, `repoBase.js`, every entity repo,
> `eventRepo.js`, `referenceRegistry.js`, `syncRegistry.js`, `kennelScope.js`,
> `scopePredicates.js`, `recordMerge.js`, `duplicateScan.js`, `vocab.js`, `dateUtils.js`.
> Write scripts rather than eyeballing: one comparing every schema FK against
> `referenceRegistry`, one comparing every field in use against `syncRegistry`, one finding
> queries with no index. Then the blocked-upgrade hand-off on every entry point. Write
> `docs/review/findings/K01-data-foundation.md`, add your INDEX row, commit docs only, push.

---

**K2 — backup, restore, CSV import**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K2") and follow it. You are
> reviewing the data-loss surface: `importExport.js`, `restoreMatch.js`, `csvImport.js`
> (1,947 lines), `csvBatch.js`, the pedigree importers, `documentRepo.js`, `fileRepo.js`,
> `dropbox.js`, `googleDrive.js`, `ocr.js` and the import/export pages. Start with the
> question of whether a restore can destroy existing records before the incoming file is
> known-good, and whether `device_secrets` / `sync_meta` are provably absent from every
> file. Then a 10,000-row CSV on a phone: time it and measure memory. Write
> `docs/review/findings/K02-backup-import.md`, add your INDEX row, commit docs only, push.

---

**K3 — cloud client: backup, sync, conflicts**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K3") and follow it. You are
> reviewing `shared/data/cloud/*` and the two cloud UIs (2,100 lines between them). Pin down
> the actual conflict-resolution rule by reading the code, then build the scenarios that
> break it: two devices offline, one archiving while the other edits, a wrong clock, a
> table missing on the other device. Prove `cloudUrl: null` makes no request in the
> assembled Lite and Demo builds, and trace one `private`-tier field from the form to the
> request body. Write `docs/review/findings/K03-cloud-client.md`, add your INDEX row, commit
> docs only, push.

---

**K4 — the cloud Worker**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, "Session K4") and follow it. You are
> reviewing `cloud/src/*` (7.3k lines), its migrations and `cloud/wrangler.toml`. First
> question: production has migrations through `0016` applied and `0017`/`0018`/`0019`
> waiting on a deploy — does the current Worker code read anything those three add, and what
> does a breeder see in the window between deploy and apply? Then logging (no emails, codes,
> tokens or bodies), auth and recovery, the crons and sweeps, `/ops`'s destructive actions,
> and `serverMoves.js`. Run `cd cloud && npm test`. Write
> `docs/review/findings/K04-cloud-worker.md`, add your INDEX row, commit docs only, push.

---

**K5 — vault, licence, account identity**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K5") and follow it. You are
> reviewing the private vault (`vaultCrypto.js`, `vaultPasskey.js`, `vaultKeyStore.js`,
> `cloudVault.js`, `cloud/src/vault.js`), the licence gate (`license.js`, `licenseGate.js`,
> `cloud/src/license.js`) and account identity (recovery, email change, devices). Judge the
> crypto, then every way a breeder can lose access and what path back exists, then whether a
> lapsed licence can ever stand between her and her own local data or an export. Write
> `docs/review/findings/K05-vault-licence.md`, add your INDEX row, commit docs only, push.

---

**K6 — the waitlist engine**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K6") and follow it. You are
> reviewing the engine: `waitlistRules.js` (1,508), `waitlistActions.js` (1,488),
> `waitlistEvents.js`, the three waitlist repos, `waitlistReview.js`, and
> `pages/waitlist-entry.js` (1,956). Prove position is stable across reads, then take the
> turn clock apart (opened, passed, expired, extended, reopened, DST, month end), then hunt
> for rules implemented twice in the engine and on the page. ~6,500 lines: if you run out of
> room, finish the clock and the duplicates and say where you stopped. Write
> `docs/review/findings/K06-waitlist-engine.md`, add your INDEX row, commit docs only, push.

---

**K7 — the waitlist online**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K7") and follow it. You are
> reviewing applications, the public list and the family pages: `waitlistForm.js`,
> `waitlistCrypto.js`, `waitlistProjection.js`, `cloudWaitlist.js`, `cloud/src/waitlist.js`,
> `cloud/src/familyPages.js`, `familyActions.js` and `cloud/public/family/*`. Go field by
> field through the projection asking whether a stranger should see it, then check every
> surface that draws from it shows the same thing, then walk apply → code → status page → a
> change request on a phone. The KennelPort-facing half of these endpoints belongs to the
> KennelPort review — note and skip. Write `docs/review/findings/K07-waitlist-online.md`,
> add your INDEX row, commit docs only, push.

---

**K8 — family requests, pickup, transport, fees, emails**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K8") and follow it. You are
> reviewing what a family asks for and pays: extras, pickup slots, transport miles, backing
> out, fees and processing fees, the email outbox. Follow one family's money end to end and
> check the number she is shown equals the number recorded. `MAPBOX_TOKEN` is not set yet —
> say exactly what the transport suggestion does without it. Write
> `docs/review/findings/K08-family-requests.md`, add your INDEX row, commit docs only, push.

---

**K9 — dogs, litters, pairings, events, nudges, Today**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K9") and follow it. You are
> reviewing the daily app: `pages/dog.js` (1,619), `litter.js`, `pairing.js`, `today.js`,
> and `nudges.js` (1,236) with the check-in and prep-pups flows. Walk one Dog record through
> every life stage looking for a second record or a stuck state; audit date-only strings for
> `new Date` timezone shifts; then the nudges — one that can never be satisfied, one that
> never fires, and a missed whelping or health deadline. Write
> `docs/review/findings/K09-dogs-litters-nudges.md`, add your INDEX row, commit docs only,
> push.

---

**K10 — money**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K10") and follow it. You are
> reviewing every number: sales, invoices, receipts, contracts, expenses, credits, extra
> charges, processing fees and the reports. Build one sale with a deposit, an extra, a
> processing fee, a credit and a refund, and follow its amount through the sale page, the
> invoice, the receipt, the litter's finances, the income view, the report and the year
> review — any disagreement is the headline finding. Then rounding, refunds, PDFs on a
> phone, and report date-range boundaries. Write `docs/review/findings/K10-money.md`, add
> your INDEX row, commit docs only, push.

---

**K11 — Kels and the guided tasks**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K11") and follow it. You are
> reviewing Kels and the guided flows (`kels*`, `guided*`, `wizard*`, `tidyUpUI`,
> `assistant*`). For every task: abandon it halfway and say what was written and what was
> lost; find any write that happens before a confirm; find questions asked twice; check
> wizard state survives a reload and a schema upgrade; run each task in Demo and in Lite.
> Write `docs/review/findings/K11-kels.md`, add your INDEX row, commit docs only, push.

---

**K12 — integrations, accounts, notifications**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K12") and follow it. You are
> reviewing Jotform, Stripe, the Accounts page, `accountHealth`, and notifications (push and
> the email digest, server side in `cloud/src/notify.js`). Prove vendor keys never leave
> `device_secrets`; then read the unproven Jotform paths for what fails on first contact
> with a real account (renamed field, replayed webhook, unmatched submission); then the push
> flow with no VAPID key and migration `0018` unapplied. Write
> `docs/review/findings/K12-integrations-notifications.md`, add your INDEX row, commit docs
> only, push.

---

**K13 — editions, build, first run, PWA, marketing site**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K13") and follow it. You are
> reviewing the gates: the Lite cap, Demo's read-only, the Pro-only surface,
> `build/assemble.mjs` (and `--release`), `shared/sw.js`, first run and sample data, and
> `site/`. Headline task: enumerate **every** path that creates a dog or a litter — import,
> restore, cloud restore, sample data, Kels, merge, Furever seed — and say which walk past
> the cap hooks. Then find a write that gets through in Demo. Assemble and actually serve
> all three builds. Write `docs/review/findings/K13-editions-build.md`, add your INDEX row,
> commit docs only, push. Do not bump `CACHE_NAME`.

---

**K14 — multi-kennel, shows, identity, Companion, Furever**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K14") and follow it. You are
> reviewing scope and the share-outs: `kennel.js`, `kennelRepo`, `kennelScope`,
> `kennelCard`, `kennelTree`, `shows.js` + `showPoints`, `companionExport` and
> `companion-view.html`, the Furever seed and content packs, `settings.js`, and `furever/`
> (6,000 lines, its own app). Hunt scope leaks first — a second own kennel seeing the
> first's records, or appearing in its totals. Furever is the likeliest thing to run out of
> room on; review it last and say where you stopped. Write
> `docs/review/findings/K14-scope-companion-furever.md`, add your INDEX row, commit docs
> only, push.

---

**K15 — the UI layer: escaping, accessibility, phone, offline**

> Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K15") and follow it. Your
> first deliverable is a scanner: extract multi-line template literals assigned to
> `innerHTML` (or passed to the modal and list builders) across `shared/pages` and
> `shared/assets`, list every `${…}` expression, and flag any that is not `esc(...)`, a
> number, a safe constant or a nested builder — the single-line surface is already cleared,
> so this is the real one. Paste the scanner into your findings file. Then accessibility
> basics on real pages, the ten busiest pages at 320px in Playwright with screenshots, the
> charts, and offline behaviour with the service worker serving. Write
> `docs/review/findings/K15-ui-layer.md`, add your INDEX row, commit docs only, push.

---

**K16 — consolidation** (only after the others)

> Read `docs/KennelOS_Review_Plan.md` (sections 0 and "Session K16") and every file in
> `docs/review/findings/`. Produce `docs/review/SUMMARY.md`: de-duplicated findings ranked
> S1 → S4, the repeated themes, a fix order that puts lost records, leaked family data and
> wrong money first, the collected test gaps, and what no session reached. Reconcile with
> the KennelPort review's summary if that round has run. Do not re-review; if a finding looks
> wrong, check it and say so in one line. Commit docs only, push.
