# Review fixes: where to start

Written 2026-11-15 against `main` at `0abf39b`, from the fourteen findings files in
`docs/review/findings/` (K1–K14, K6b). K15 (UI layer) is held back on purpose until the
app settles, and K16 (consolidation) hasn't run. This file ranks the **documents**, not
every finding, and says which batch to build first.

**How "still open" was decided.** For every finding, `git log` on the files it names since
that review's commit. If a file is untouched, the finding is taken as standing. If it
changed, the build log was searched for the finding's id and the code was read where the
id wasn't there. Items marked *recheck* changed shape since the review. Turn them into a
failing test before writing the fix.

Severity is the review plan's: **S1** data loss, or wrong data shown to a family or used
for money; **S2** a dead end, a half-applied write, or a gate that refuses or leaks; **S3**
confusing, silent, slow, or broken on a phone; **S4** latent.

---

## 1. Where each document stands

*Updated 2026-11-16 after steps 1–11, step 3 (Waitlist Fixes step 5) and Waitlist Fixes
steps 6 and 7 (step 12's first part) were built. Rows not touched by those steps are as first written.*

| Doc | Area | Found (S1/S2/S3/S4) | Fixed or gone since | Open S1 · S2 | Since the review |
|---|---|---|---|---|---|
| **K03** | Cloud client: sync, conflicts | 2/6/2/1 | **All eleven built** (build log, 2026-11-15). | 0 · 0 | Follow-ups built too: Put mine back (30 days) and Choose records… in Restore as of…. |
| **K13** | Editions, build, privacy policy | 3/4/7/1 | K13-7, -8, -14 (Kels batch, 11-12). **Step 2 (11-15):** K13-1, -2, -3 (the policy's words, owner's choice), K13-12, K13-15. **Step 8 (11-15):** K13-4, -5, -6, -9, -11 | 0 · 0 | Open: K13-10 and K13-13 (S3), group J/K. K13-4 closed for CSV only (owner): a restored Pro backup can still bring leased dogs, which don't count. |
| **K02** | Backup, restore, CSV import | 1/5/6/2 | **Step 4 (11-15):** K2-1 to K2-6 | 0 · 0 | Open: K2-7 (S3, the 10k-row preview: step 13), K2-8 to K2-12 (S3) and K2-13, K2-14 (S4). Not yet in a step. |
| **K01** | Schema, repos, identity matching | 1/3/3/3 | **Step 4 (11-15):** K1-1, K1-3, K1-6. **Step 10 (11-16):** K1-2 | 0 · 1 | Open: K1-4 (the duplicate scan's speed, step 13), K1-5, K1-7 (S3) and K1-8 to K1-10 (S4). |
| **K05** | Vault, licence, assisted setup | 2/5/3/4 | **Step 5 (11-15):** K5-1 to K5-10, K5-12, K5-14. **Step 9 (11-15):** K5-13 (migration `0026`) | 0 · 0 | Open: K5-11 (S4). Not yet in a step. |
| **Waitlist Fixes plan** (K6, K6b, K7, K8) | Waitlist engine, online, family requests | 3/12/30/7 | Steps 1–4, K8-1, K8-10, K6-5, K8-5 (Kels part). **Its step 5 (11-15):** K8-2 (D9: nothing refunded on a back-out, her credit), K8-3, K8-4, K8-13, K6b-5, K6b-8; and every back-out she records goes through one confirm. **Its step 6 (11-16):** K6-2, K6-4, K6-5 (already built), K6-6, K6-7, K6-8, K6-11, K6-12, K6b-6. **Its step 7 (11-16, D11):** K6-3, K8-9. K7-5 not built (D10: no) | 0 · 0 | Its steps 8–10 remain (S3/S4 only). |
| **K09** | Dogs, litters, pairings, nudges | 1/2/7/3 | K9-4, K9-12, K9-3 (Kels part). **Step 6 (11-15):** K9-1, K9-2, K9-3, K9-5, K9-6, K9-10, K9-13 | 0 · 0 | Open: K9-7, K9-8, K9-9 (S3) and K9-11 (S4). Not yet in a step. |
| **K10** | Money: sales, invoices, reports | 2/3/9/0 | K10-1, K10-2, K10-12 by Payment Schedules (confirmed by tests in step 7). **Step 7 (11-15):** K10-3 to K10-8, K10-14 | 0 · 0 | Open: K10-9, K10-10, K10-11 (S3). K10-13 (currency): out of scope unless KennelOS goes international (owner, 11-15). |
| **K04** | The cloud Worker | 0/6/3/5 | K4-9 (README drift, resolved). **Step 5 (11-15):** K4-6. **Step 9 (11-15):** K4-1, -2, -3, -4, -5, -7, -8, -10, -12, -13 | 0 · 0 | Open: K4-11 and K4-14 (S4), step 13. Production needs `0026` applied after the deploy. |
| **K12** | Integrations, notifications | 0/4/9/1 | K12-10. Jotform is retired, so K12-2 and the Jotform halves of K12-3 and K12-6 are gone. **Step 7 (11-15):** K12-1, K12-3 | **0 · 1** | Open S2: K12-4 (an alert opens a page that can't show it). Not yet in a step. |
| **K14** | Multi-kennel, shows, Companion, Furever | 1/7/8/2 | **Step 10 (11-16):** K14-1, -2, -4 to -18; K14-3 by its warning only (owner) | **0 · 1** | Open: K14-3's per-pup packs (each pup's documents in their own folder and manifest), wanted before Furever's origin goes live; until then a litter publish warns that every family in the litter can open each pup's files. |
| **K11** | Kels and the guided tasks | 0/7/8/3 | Litter-cap half of K11-1 (via K13-14). **Step 8 (11-15):** K11-1 (dog-cap half), K11-5, K11-17. **Step 11 (11-16):** K11-2 to -4, K11-6 to -16, K11-18 | 0 · 0 | All eighteen built. K11-2's resume check covers the litter draft; the other drafts rely on being cleared with the records (Clear sample data, Replace restore). |

---

## 2. The open findings by kind

These are the same open findings, grouped by what goes wrong, so batches can be cut by
theme as well as by document. Bold marks an S1.

| Kind | Open findings | Why it matters |
|---|---|---|
| **A. Her records silently lost or overwritten** | K2-11, K7-13 *(built: K3-1, -2, -3, -5, -8; K1-1; K2-1, -5, -6; K14-1, -5; K11-4, -7)* | The worst kind: nothing tells her, and by the time she notices, the backup holds the damage too. |
| **B. Money shown wrong** (to a family, in a report, or by Stripe) | K10-3, K10-4, K10-5, K10-6–8, K10-10, K10-11, K10-13, K10-14, K12-1, K12-3 (Stripe half) *(built: K8-2, -3, -4, -13; K6b-5, -8)* | Families are told the wrong amount, or her P&L and Year in Review disagree with her ledger. |
| **C. Privacy and the policy's promises** | K14-3 (per-pup packs; warned meanwhile), K12-9, K7-10 *(built: K13-1, -2, -3; K14-13, -15, -17)* | The published privacy policy says things that aren't true. The fix is mostly text, but each one is a privacy decision. |
| **D. Support, account and licence safety** | K5-11, K12-8 *(built: step 5, K5-1 to K5-10, K5-12, K4-6; step 9, K5-13, K4-13)* | A support device can carry one kennel into another account, a typo can erase a stranger, and the licence wall has no way out to her records. |
| **E. Edition gates leak or dead-end** (Lite cap, Demo read-only) | none open *(built in step 8: K13-4, -5, -6, -9, -11; K11-1, -5, -17)* | Lite takes more than its cap through import, restore and Kels. Demo saves things it says it won't. |
| **F. Server resilience** | K4-11, K4-14 *(built: K3-11; step 9: K4-1, -2, -3, -4, -5, -7, -12)* | These are rare events with large effects: a family emailed twice, a Worker rollback that leaves the API on 503 for good, a missed day of retention or digests. |
| **G. Breeding dates and the clock** | K9-7 *(built: K9-1, -2, -3, -5, -6, -10; K6-2, K6-8; K6-3, K8-9)* | A missed whelping reminder, due dates that don't follow a corrected first date, and deadlines kept on the device's clock instead of the kennel's. |
| **H. Half-applied writes and stale drafts** | K2-8, K6-13 *(built: K2-5, K1-3; K14-6, -7; K11-2, -3, -6)* | A retry duplicates records, or a draft resumes over newer work. |
| **I. Slow at scale** | K1-4, K2-7, K4-3, K4-11 | 49 s of frozen page for the duplicate scan at 4,000 dogs, and a 10k-row import preview that never renders. |
| **J. Phone, wording, layout** | K1-7, K10-9, K12-11, K6b-9, and most S3s *(built: K3-10, K14-16)* | Overlaps K15. Fold these in when K15 is redone, unless one is a one-liner beside a fix you're already making. |
| **K. Latent** (build, tests, docs) | K13-10, K1-8–10 *(built: K11-16, K11-18; K13-15, the deploy runs the tests; K5-14 and K9-13, steps 5 and 6)* | Small, and best folded into the batch that touches the same files. |

Rechecked and built (11-15): K8-4 was already covered by the lost-pup credit (now held by a
test); K8-13's wording and K8-2 (D9) are built with Waitlist Fixes step 5.

---

## 3. The order to fix them

Each step is one shippable batch. Steps 1 and 2 touch different files (`shared/data/cloud`
and the Worker's `sync.js`, versus `site/` and the deploy workflow), so they can run at the
same time in two sessions.

### Tier 1: start here

1. **K03, the cloud client (sync conflicts).** *Built 2026-11-15; release the Worker and `0025` first.*
   - **Why:** two S1s and six S2s, every one still open, in a feature that is released and
     being checked on real phones right now. K3-1 and K3-2 lose an edit on an ordinary day
     (two devices offline, or the 60-second poll pulling before pushing) and tell her the
     wrong story. Each day it stays live, more programs pick up silent losses.
   - **Batch:** the merge rules first (K3-1, K3-2, K3-8, with K3-10's wording that describes
     them), then the stuck states (K3-3, K3-4, K3-5, K3-11), then the restore UI (K3-6,
     K3-7, K3-9).
   - **Note:** K3-1 has a Worker half (`cloud/src/sync.js`), so `cd cloud && npm test` is in
     scope. A new cloud migration is unlikely, but CLAUDE.md allows at most one per branch.
2. **K13 quick batch: the privacy policy and the deploy gate.** *Built 2026-11-15 (owner: fix the policy's words for all three).*
   - **Batch:** K13-1, K13-2 and K13-3 (the policy says three things that aren't true:
     KennelPort sends without cloud sign-in, backups hold more than §6 lists, and Furever
     publishes to Google Drive), plus K13-15 (the deploy runs `node --test` and the build
     check before publishing), plus K13-12 (the upgrade dialog).
   - **Why:** S1 and legal exposure, at small cost. Most of it is text and one workflow step.
   - **Owner decision first:** for each statement, does the policy change, or does the app
     change to match the policy? K13-2 in particular is a `syncRegistry` cloud/private
     question, which CLAUDE.md says to surface.
3. **Waitlist Fixes plan, step 5 (money a family is shown).** *Built 2026-11-15 (D9: nothing is refunded on a back-out; she chooses the credit).* K8-2 (S1), K8-3, K6b-5,
   K6b-8, and K8-4 and K8-13 if the *recheck* shows they're still open.
   - **Why:** families see the wrong money, the plan for it already exists, and it sits on
     the statement that Payment Schedules just built.
   - **Blocked on D9**, still open: on a back-out after paying more than the deposit, she
     ticks what carries over and what's refunded. The lost-pup credit (D20) that just
     shipped makes the carried part easy.

### Tier 2: next

4. **K02 + K01 together: restore, import and identity matching.** *Built 2026-11-15.* K2-1 (S1: a non-KennelOS
   JSON empties her program on Replace), K1-1 (S1: "Blue 1" and "Blue 2" merge as one dog),
   K2-5 and K2-6 (Dog Cards: no transaction, and her corrections reverted), K2-2, K2-3 and
   K2-4 (CSV duplicates, ambiguous dates, a preview that never says what changes), K1-3,
   and K1-6. Both docs share `restoreMatch` and `dogSearch`, so one batch avoids fixing the
   matching twice. Leave K1-4 and K2-7 (performance) for their own batch.
5. **K05: assisted setup, the licence wall, the vault.** *Built 2026-11-15 (K5-3: export only). Next is step 6.* K5-1 and K5-2 (S1), then K5-3 (the
   licence wall has no export, though the editions plan promises one), K5-4 to K5-7, and
   K5-9 (a lifetime key treated as monthly). **Move this to Tier 1 if support is already
   running assisted setups for real breeders:** K5-1 carries a whole kennel into the next
   user's account. K4-6 (/ops "Delete an account") belongs in this batch.
6. **K09: breeding reminders.** *Built 2026-11-15.* K9-1 (S1: an Expected litter silences both due-date
   nudges), K9-2, K9-3's root (`litter.js` dates a litter made from its pairing today), K9-5,
   K9-6, K9-10. Small, contained fixes in `nudges.js`, `dogCare.js`, `pairing.js` and
   `litter.js`. A missed whelping is the cost of waiting.
7. **K10 remainder + K12's Stripe items: money in her own books.** *Built 2026-11-15 (K10-4: each fee on its payment, kept as a cost; with it, fees charged back ride on the final payment). Next is step 8.*
   - First turn K10-1, K10-2 and K10-12 into tests to confirm Payment Schedules fixed them.
   - Then K10-3 (voided and returned sales in the litter total), K10-4 (the processing fee
     belongs on the payment that paid it), K10-5 (undated income missing from reports),
     K10-6 to K10-8, K10-14 (and the flagged D17 gap in the same Adjust modal), K12-1 (a
     new link replaces a paid one), and the Stripe half of K12-3.
   - K10-13 (currency) is a design decision. Surface it; don't build it inside this batch.

### Tier 3: after that

8. **Edition gates.** *Built 2026-11-15 (Demo blocks the outside-the-repo saves; Kels in the Demo ends at the review; Lite's CSV refuses leased; restores refused over the litter cap). Next is step 9.* K13-4 (leased dogs and the Lite cap), K13-5 (restore and the litter
   cap), K13-6 (Demo isn't read-only), K13-9, K13-11, K11-1's dog-cap half, K11-5, K11-17.
   One pass over every write path that the Lite cap and the Demo flag must see.
9. **K04: Worker resilience.** *Built 2026-11-15 (9-A orphans don't gate; 9-B the helper may take backing and is named; 9-C K5-13 rode `0026`). Next is step 10.* K4-3, K4-1, K4-2, K4-4, K4-5,
   K4-7, K4-8, with the S4s that sit in the same files (K4-10, K4-12, K4-13). The cloud tests
   cover this well.

#### Step 9 plan (checked against `main` at `874df97`, 2026-11-15)

Since the review (`24d84b1`) 33 commits touched `cloud/src`, but none of them fixes a K04
finding except K4-6 (step 5). The hourly cron is now five jobs. The two e-sign jobs added
behind it (`firma.js` `runEsignPreviews`, `runEsignCopies`) read in `LIMIT`ed pages, so they
add no new unbounded read. Each sub-step starts with the failing test the review's
"Coverage gaps" names, in `cloud/tests/`, and ends with `cd cloud && npm test` and
`node --test`. Ship 9a–9e as one batch, or 9a–9c first if 9d's decision is slow.

**9a. The crons can't take each other down (K4-3, K4-4, K4-12).** `index.js`, `retention.js`,
`serverMoves.js`.
- `scheduled`: each of the five hourly jobs, and the daily `runRetention`, in its own
  `try`/`console.error('<job> failed', …)`, so one throw neither hides the others nor ends the
  log. *Test:* make the projection read throw; email changes, digests and both e-sign jobs
  still run and log.
- `runWaitlistMoves`: read `public_id` only (paged by `public_id`), then one row's body at a
  time, so the read never holds every kennel's 1.5 MB projection at once. Totals unchanged.
- `runRetention`: the D1 purge batch first, then `sweepR2Orphans` in its own `try`, its error
  folded into `summary` (`r2SweepError`) so /ops's "Retention done" line says it was skipped.
  *Test:* `FILES.list` throws; the expired `login_codes` row is still purged.
- `fetch`: move the `try` to the top, so `serveFamilyPage`, the preflights and `corsHeaders`
  answer JSON 500 with CORS (`{}` when CORS itself threw) instead of Cloudflare's page.

**9b. A waitlist move happens once (K4-1, K4-7).** `serverMoves.js`. The riskiest part.
- The rule to hold: a run's events, hold deletes and projection write land together or not at
  all, and an email goes only for a move that landed. Today the events and emails go one at a
  time before the one guarded `UPDATE … WHERE version = ?`, and a lost race is silent.
- Build: `runKennel` works out every change in memory, then commits it in one `db.batch`
  whose writes all depend on the projection still being at the version it read (the batch's
  first statement takes the row; the event and hold statements are conditional on that, or the
  run takes the kennel first through a short server claim the publish path respects). Only
  after it commits are the emails sent, each with an id that doesn't change between runs:
  the offer keyed on the entry and its offered date, not on a fresh `turn_id`. A lost race
  writes nothing and sends nothing; the next run starts clean. An email that throws after the
  commit is logged and retried by `emailOnce` on the next run, never re-doing the move.
- *Built as the conditional batch.* The offer email keeps its `turn_id` key: with the batch,
  only the run whose writes landed sends it, so the key is already stable. The turn's
  last-day reminder stays on its day (after it the turn has ended); the fee reminder catches
  up, and its default subject names the date instead of "tomorrow".
- Pick between the conditional batch and the claim with the two tests first: two passes on one
  version (hourly and `runKennelNow`) give one `server_offer` and one offer email; a publish
  landing inside the run's window leaves no `server_*` events behind and no email sent.
- K4-7: the `last` reminder goes while `today <= respondBy` and its `srv-remind-<turn>-last`
  row doesn't exist; the fee reminder while `today <= due`. A late one says what's true on the
  day it goes ("ends today", "is due today"), never a date already past. *Test:* skip the
  reminder's day; the next run sends it, once.

**9c. Migrations and files (K4-2, K4-5).** `migrate.js`, `gate.js`, `ops.js`, `files.js`,
`snapshots.js`.
- K4-2 (**decision 9-A**): with the schema additive only, an orphaned migration (applied, not
  in this build's list, as after a rollback) doesn't gate. `schemaIsCurrent` wants no
  `pending` and no `drifted`; /ops shows orphans in red with what to do. *Test:* the database at
  `0025` with the list stopping at `0024` is current; a pending one still gates.
- K4-5: `putFile` and `headFile` ask R2 (`FILES.head`), not just the `files` row: a row
  whose object is gone answers 404 to HEAD, and a PUT stores the bytes again (`existed:
  false`). `GET /snapshots` and `GET /program`'s `latestSnapshot` skip a committed snapshot
  whose object is gone, and the snapshot reference check counts only files R2 has. *Test:*
  delete an object under its row; HEAD 404, PUT 200 `existed:false`, GET 200.

**9d. An email change that couldn't happen says so (K4-8).** `emailChange.js`,
`recovery.js`, the app's Account card and Today notice (`shared/assets/cloudBackupUI.js`
`emailChangeNoticeHtml`), and **migration `0026`** (this branch's one): `email_changes` keeps a
dropped row with `failed_at` / `failed_reason` instead of deleting it. `emailChangeState`
returns it once; the card says "That address was taken while the change was waiting, so
nothing changed. Your account is still on your old address." Retention clears a failed row
after `KEEP_DAYS`. Same for the race at `recovery.js`. New fields: classify in
`syncRegistry.js` only if any reach the app's tables (they don't: server-only).

**9e. Small ones in the same files (K4-10, K4-13).**
- K4-10: /ops sends a Content-Security-Policy like `/manager`'s (inline style and its own
  form posts only).
- K4-13 (**decision 9-B**): `POST /program/backing-device` from support's helper device.
  Recommended: owner-only, added to `OWNER_ONLY`, since support pushing her first backup
  doesn't need to take the role from her device for good. If kept open, say why beside
  `OWNER_ONLY` and have `takeOver` record who took it, so her device list names support.

**Optional in the same batch (decision 9-C):** K5-13, the manager app's cookie can't be
revoked. It's Worker-only and needs a migration, so it fits `0026` beside 9d (a
`manager_sessions` table checked on each request; Log out deletes its row). Left out, it
waits for a later branch's migration.

**Left for later, on purpose:** K4-11 (retention's unpaged snapshot read) and K4-14 (the
disaster-recovery restore in one batch, *suspected*): step 13, measured against a loaded D1
before anything changes. K4-14 trades all-or-nothing for size, which is its own decision.

**Docs with it:** `cloud/README.md` (crons, the orphan rule, the new migration),
End-State guide (the cloud sections that describe the crons, files and the waitlist moves),
Cloud Phase 1 plan §7–§9 where it says orphaned gates (Modified note), `BUILD_LOG.md`, this
file. Production needs `0026` applied after the deploy (README Status, `LAUNCH_CHECKLIST.md`).
10. **K14: scope, Companion and Furever.** *Built 2026-11-16 (K14-5: on her own kennel, cloud; K14-3: the warning only, per-pup packs still to build; K14-15: no chip for ancestors or placed dogs; K14-11: placed by the stud service, else All kennels only). Next is step 11.* The scope items first, because they hit Pro
    multi-kennel users today: K14-6, K14-9, K14-10, K14-11, K14-2, K14-8. **The Furever
    items (K14-1 S1, K14-3, K14-4, K14-5, K14-7) must be fixed before Furever's origin goes
    live.** K14-3 is a privacy problem: every pup's documents sit in one folder that every
    family in the litter can read. K14-13 (anyone can mint a Companion page on our domain)
    belongs here too. Put K1-2 (Furever's missing `blocked` handler) in the Furever half.
11. **K11: Kels and the guided tasks.** *Built 2026-11-16 (K11-4: an entry already in is left as she has it, a deleted one isn't New again, and the feed is pushed after an import; K11-14: one approve step for a family she types in; no owner decisions needed). Next is step 12.* K11-2, K11-3, K11-4 (KennelAssistant re-imports over
    her corrections), K11-6, K11-7, then the S3s.
12. **Waitlist Fixes plan, steps 6–10.** *Its step 6 built 2026-11-16 (the turn rules: K6-6's guard now asks the kennel-wide rule and `offerTo` needs `outOfOrder`; one `offerBlocker`; deadlines never shortened by a join and moved off closed days). Its step 7 built the same day (D11: the kennel's clock for the waitlist's deadlines, on her device, the Worker and the family's page). D10 decided no (K7-5 not built). Next is its step 8.* The turn rules (K6-6 S2), the clock (K6-3 S2 and
    K8-9: decision D11), applying and signing in (K7-4 to K7-13), pickup and queued emails,
    and transactions (K6-13). Step 7 is the largest risk among these. D10, D11 and D12 are
    still open.
13. **Performance:** K1-4, K2-7, K4-11.
14. **K15** redone once the UI settles, taking group J with it. Then **K16** writes
    `SUMMARY.md` from what's left.

---

## 4. Decisions to get from the owner before the batch that needs them

| Batch | Decision |
|---|---|
| 2 | K13-1/2/3: change the policy's words, or change what is sent? (K13-2 is a `syncRegistry` privacy call.) |
| 3 | Waitlist Fixes D9: what a back-out after paying more than the deposit carries over or refunds. |
| 5 | K5-3: what the licence wall offers. **Decided 2026-11-15: export only** (a "Download a backup of this device" control on every licence wall; no read-only access behind it). |
| 7 | **Decided 2026-11-15:** K10-4: each payment's fee is on the payment that paid it, and stays a cost when a sale ends (a refund too). Fees charged back go on the final payment, which is always cash or Zelle. K10-13: currency is out of scope unless KennelOS goes international. |
| 8 | **Decided 2026-11-15:** K13-6: block them (and Furever's Drive). K11-5: Kels walks a Demo task to its review, then says so and keeps nothing. K13-4: Lite's CSV refuses leased types (restores unchanged). K13-5: a restore over the litter cap is refused, all or nothing. |
| 9 | **Decided 2026-11-15:** **9-A** (K4-2): an orphaned migration no longer gates the API; /ops shows it. **9-B** (K4-13): support's helper device may take over backing up; it's named as support (its label, and `helper: true`). **9-C**: K5-13 (revocable manager sessions) rides migration `0026`. |
| 10 | **Decided 2026-11-16:** K14-5: the Furever identity rides on her own kennel, cloud tier. K14-3: warn on every pup's document in a litter publish for now; per-pup packs later. K14-15: a Dog Card's microchip only for a sent dog still in her program. K14-11: an outside dog's expense goes under its stud service's kennel, else only All kennels. |
| 12 | **Decided 2026-11-16:** D10 no (no policy wording sealed into applications). D11: the kennel's time zone for the waitlist's deadlines only. D3 and D12 confirmed as built (owner, 2026-11-17). |

## 5. Not reviewed here

Branch `ccr-851139a8-181hty` holds a K15 draft (2026-11-11). It is kept off `main` on
purpose, pending the redo.
