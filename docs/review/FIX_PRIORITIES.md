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

| Doc | Area | Found (S1/S2/S3/S4) | Fixed or gone since | Open S1 · S2 | Since the review |
|---|---|---|---|---|---|
| **K03** | Cloud client: sync, conflicts | 2/6/2/1 | **All eleven built** (build log, 2026-11-15). Migration `0025` to apply | 0 · 0 | Follow-ups built too: Put mine back (30 days) and Choose records… in Restore as of…. |
| **K13** | Editions, build, privacy policy | 3/4/7/1 | K13-7, -8, -14 (Kels batch, 11-12) | **3 · 3** | `privacy.html` was edited twice for Firma, but its three false statements are unchanged. The deploy still runs no tests. |
| **K02** | Backup, restore, CSV import | 1/5/6/2 | none | **1 · 5** | `importExport.js`, `importView.js` and `dropbox.js` are untouched. `csvImport` and `dogCard` got only the titles phases. |
| **K01** | Schema, repos, identity matching | 1/3/3/3 | none | **1 · 3** | `dogSearch.nameKey` still drops all-digit words (line 104). Furever's `db.js` still has no `blocked` handler. |
| **K05** | Vault, licence, assisted setup | 2/5/3/4 | none | **2 · 5** | Only Jotform's retirement touched `cloudAssistUI.js`. |
| **Waitlist Fixes plan** (K6, K6b, K7, K8) | Waitlist engine, online, family requests | 3/12/30/7 | Steps 1–4, K8-1, K8-10, K6-5, K8-5 (Kels part) | **1 · 5** | It has its own plan (`docs/KennelOS_Waitlist_Fixes_Plan.md`). Steps 5–10 remain. |
| **K09** | Dogs, litters, pairings, nudges | 1/2/7/3 | K9-4, K9-12, K9-3 (Kels part) | **1 · 2** | `pairingIdsWithLitter` still counts an Expected litter, so both due-date nudges stay off (`nudges.js:288`). `pairing.js` and `litter.js` are untouched. |
| **K10** | Money: sales, invoices, reports | 2/3/9/0 | K10-1, K10-2, K10-12: Payment Schedules rebuilt receipts, Companion and contract prefills (*recheck* with a test) | **0 · 3** | `incomeView` changed 12 times, but the fee is still spread across components (`feeComponents`). `litter.js` is untouched. |
| **K04** | The cloud Worker | 0/6/3/5 | K4-9 (README drift, resolved) | **0 · 6** | The hourly cron is still one unguarded sequence, and is now **five** jobs: e-sign copies and previews were added behind it. |
| **K12** | Integrations, notifications | 0/4/9/1 | K12-10. Jotform is retired, so K12-2 and the Jotform halves of K12-3 and K12-6 are gone | **0 · 3** | `makeSaleLink` still deactivates the open link without asking whether it was paid (`stripeLinks.js:69`). |
| **K14** | Multi-kennel, shows, Companion, Furever | 1/7/8/2 | none | **1 · 7** | Furever isn't live yet ("in active development"). The scope items (K14-6, -9, -10, -11) hit multi-kennel Pro users today. |
| **K11** | Kels and the guided tasks | 0/7/8/3 | Litter-cap half of K11-1 (via K13-14) | **0 · 7** | K11's baseline is from *before* the Kels batch, but only K11-1 overlapped it. The dog-cap half is still open: `guidedLitter.js` checks only `enforceLitterCap` up front. |

---

## 2. The open findings by kind

These are the same open findings, grouped by what goes wrong, so batches can be cut by
theme as well as by document. Bold marks an S1.

| Kind | Open findings | Why it matters |
|---|---|---|
| **A. Her records silently lost or overwritten** | **K3-1**, **K3-2**, K3-3, K3-5, K3-8, **K1-1**, **K2-1**, K2-5, K2-6, K2-11, K11-4, K11-7, K7-13, **K14-1**, K14-5 | The worst kind: nothing tells her, and by the time she notices, the backup holds the damage too. |
| **B. Money shown wrong** (to a family, in a report, or by Stripe) | **K8-2**, K8-3, K8-4*, K8-13*, K6b-5, K6b-8, K10-3, K10-4, K10-5, K10-6–8, K10-10, K10-11, K10-13, K10-14, K12-1, K12-3 (Stripe half) | Families are told the wrong amount, or her P&L and Year in Review disagree with her ledger. |
| **C. Privacy and the policy's promises** | **K13-1**, **K13-2**, **K13-3**, K14-3, K14-13, K14-15, K12-9, K7-10, K14-17 | The published privacy policy says things that aren't true. The fix is mostly text, but each one is a privacy decision. |
| **D. Support, account and licence safety** | **K5-1**, **K5-2**, K5-3–7, K5-8–13, K4-6, K4-13, K12-8 | A support device can carry one kennel into another account, a typo can erase a stranger, and the licence wall has no way out to her records. |
| **E. Edition gates leak or dead-end** (Lite cap, Demo read-only) | K13-4, K13-5, K13-6, K13-9, K13-11, K11-1 (dog cap), K11-5, K11-17 | Lite takes more than its cap through import, restore and Kels. Demo saves things it says it won't. |
| **F. Server resilience** | K4-1, K4-2, K4-3, K4-4, K4-5, K4-7, K4-11, K4-12, K4-14, K3-11 | These are rare events with large effects: a family emailed twice, a Worker rollback that leaves the API on 503 for good, a missed day of retention or digests. |
| **G. Breeding dates and the clock** | **K9-1**, K9-2, K9-3 (root), K9-5, K9-6, K9-7, K9-10, K6-3, K8-9 | A missed whelping reminder, due dates that don't follow a corrected first date, and deadlines kept on the device's clock instead of the kennel's. |
| **H. Half-applied writes and stale drafts** | K2-5, K2-8, K11-2, K11-3, K11-6, K6-13, K14-6, K14-7, K1-3 | A retry duplicates records, or a draft resumes over newer work. |
| **I. Slow at scale** | K1-4, K2-7, K4-3, K4-11 | 49 s of frozen page for the duplicate scan at 4,000 dogs, and a 10k-row import preview that never renders. |
| **J. Phone, wording, layout** | K1-7, K10-9, K12-11, K6b-9, K14-16, K3-10, and most S3s | Overlaps K15. Fold these in when K15 is redone, unless one is a one-liner beside a fix you're already making. |
| **K. Latent** (build, tests, docs) | **K13-15** (no tests before deploy), K13-10, K1-8–10, K11-16, K11-18, K9-13, K5-14 | K13-15 is cheap and protects every later batch. |

\* *recheck:* the 11-15 lost-pup credit work (money carried as a credit, "Carried over from
*pup*'s sale") may already cover K8-4 and K8-13. K8-2's core problem remains: Move carries
only the deposit, and Refund wipes everything.

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
2. **K13 quick batch: the privacy policy and the deploy gate.**
   - **Batch:** K13-1, K13-2 and K13-3 (the policy says three things that aren't true:
     KennelPort sends without cloud sign-in, backups hold more than §6 lists, and Furever
     publishes to Google Drive), plus K13-15 (the deploy runs `node --test` and the build
     check before publishing), plus K13-12 (the upgrade dialog).
   - **Why:** S1 and legal exposure, at small cost. Most of it is text and one workflow step.
   - **Owner decision first:** for each statement, does the policy change, or does the app
     change to match the policy? K13-2 in particular is a `syncRegistry` cloud/private
     question, which CLAUDE.md says to surface.
3. **Waitlist Fixes plan, step 5 (money a family is shown).** K8-2 (S1), K8-3, K6b-5,
   K6b-8, and K8-4 and K8-13 if the *recheck* shows they're still open.
   - **Why:** families see the wrong money, the plan for it already exists, and it sits on
     the statement that Payment Schedules just built.
   - **Blocked on D9**, still open: on a back-out after paying more than the deposit, she
     ticks what carries over and what's refunded. The lost-pup credit (D20) that just
     shipped makes the carried part easy.

### Tier 2: next

4. **K02 + K01 together: restore, import and identity matching.** K2-1 (S1: a non-KennelOS
   JSON empties her program on Replace), K1-1 (S1: "Blue 1" and "Blue 2" merge as one dog),
   K2-5 and K2-6 (Dog Cards: no transaction, and her corrections reverted), K2-2, K2-3 and
   K2-4 (CSV duplicates, ambiguous dates, a preview that never says what changes), K1-3,
   and K1-6. Both docs share `restoreMatch` and `dogSearch`, so one batch avoids fixing the
   matching twice. Leave K1-4 and K2-7 (performance) for their own batch.
5. **K05: assisted setup, the licence wall, the vault.** K5-1 and K5-2 (S1), then K5-3 (the
   licence wall has no export, though the editions plan promises one), K5-4 to K5-7, and
   K5-9 (a lifetime key treated as monthly). **Move this to Tier 1 if support is already
   running assisted setups for real breeders:** K5-1 carries a whole kennel into the next
   user's account. K4-6 (/ops "Delete an account") belongs in this batch.
6. **K09: breeding reminders.** K9-1 (S1: an Expected litter silences both due-date
   nudges), K9-2, K9-3's root (`litter.js` dates a litter made from its pairing today), K9-5,
   K9-6, K9-10. Small, contained fixes in `nudges.js`, `dogCare.js`, `pairing.js` and
   `litter.js`. A missed whelping is the cost of waiting.
7. **K10 remainder + K12's Stripe items: money in her own books.**
   - First turn K10-1, K10-2 and K10-12 into tests to confirm Payment Schedules fixed them.
   - Then K10-3 (voided and returned sales in the litter total), K10-4 (the processing fee
     belongs on the payment that paid it), K10-5 (undated income missing from reports),
     K10-6 to K10-8, K10-14 (and the flagged D17 gap in the same Adjust modal), K12-1 (a
     new link replaces a paid one), and the Stripe half of K12-3.
   - K10-13 (currency) is a design decision. Surface it; don't build it inside this batch.

### Tier 3: after that

8. **Edition gates.** K13-4 (leased dogs and the Lite cap), K13-5 (restore and the litter
   cap), K13-6 (Demo isn't read-only), K13-9, K13-11, K11-1's dog-cap half, K11-5, K11-17.
   One pass over every write path that the Lite cap and the Demo flag must see.
9. **K04: Worker resilience.** K4-3 first: isolate each hourly job, now that e-sign copies
   and previews ride behind the waitlist moves. Then K4-1 (one write, then the emails),
   K4-2 (rollback reads as orphaned), K4-4, K4-5, K4-7. The cloud tests cover this well.
10. **K14: scope, Companion and Furever.** The scope items first, because they hit Pro
    multi-kennel users today: K14-6, K14-9, K14-10, K14-11, K14-2, K14-8. **The Furever
    items (K14-1 S1, K14-3, K14-4, K14-5, K14-7) must be fixed before Furever's origin goes
    live.** K14-3 is a privacy problem: every pup's documents sit in one folder that every
    family in the litter can read. K14-13 (anyone can mint a Companion page on our domain)
    belongs here too. Put K1-2 (Furever's missing `blocked` handler) in the Furever half.
11. **K11: Kels and the guided tasks.** K11-2, K11-3, K11-4 (KennelAssistant re-imports over
    her corrections), K11-6, K11-7, then the S3s.
12. **Waitlist Fixes plan, steps 6–10.** The turn rules (K6-6 S2), the clock (K6-3 S2 and
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
| 5 | K5-3: what the licence wall offers (read-only access to her records, or export only). |
| 7 | K10-4: which payment carries the processing fee. K10-13: is currency in scope at all? |
| 8 | K13-6: Demo's Companion and Furever saves: block them, or say they won't keep. |
| 12 | Waitlist Fixes D10, D11, D12. |

## 5. Not reviewed here

Branch `ccr-851139a8-181hty` holds a K15 draft (2026-11-11). It is kept off `main` on
purpose, pending the redo.
