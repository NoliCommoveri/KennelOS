# Session prompts

One prompt per review session. Each prompt is in its own code block: use the copy button at
the block's top-right corner, then paste it as the session's task. Each prompt is
self-contained apart from the plan, which it tells the session to read first.

Every prompt assumes `/home/user/KennelOS` is attached, ends with a findings file committed
and pushed to that session's own branch, and forbids changing code, tests or `CACHE_NAME`.
Sessions K1–K6 have run (see `INDEX.md`); their prompts are not repeated here.

## K6b — picks preview, side sales, undo windows

```text
Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K6b") and follow it. You are reviewing the three newest additions to the waitlist engine: the picks preview (`picksPreview.js`, `assets/picksPreviewModal.js`), side sales (`assets/sideSaleUI.js` and what `waitlistRules` / `waitlistActions` / `waitlistProjection` / the Worker added), and the 7-day undos. `git log -p 4dfe76f..0328a3f` on those files shows exactly what was added. First prove side sales are invisible to every turn rule (including the ones the spec didn't list); then build litters where the preview and `openPicks` could disagree; then undo each of the five things after the world moved on. Specs: `docs/KennelOS_Picks_Preview_Spec.md`, `docs/KennelOS_Side_Sale_Spec.md`. Write `docs/review/findings/K06b-picks-side-sales-undo.md`, add your INDEX row, commit docs only, push.
```

## K7 — the waitlist online

```text
Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K7") and follow it. You are reviewing applications, the public list and the family pages: `waitlistForm.js`, `waitlistCrypto.js`, `waitlistProjection.js`, `cloudWaitlist.js`, `cloud/src/waitlist.js`, `cloud/src/familyPages.js`, `familyActions.js` and `cloud/public/family/*`. Go field by field through the projection asking whether a stranger should see it, then check every surface that draws from it shows the same thing, then walk apply → code → status page → a change request on a phone. Then the newest pieces: waitlist policies on four surfaces, a question that suggests a program (never revealing the program), the do-not-sell list (never leaving her hands), and the KennelOS side of the puppy portal feed (`portalFeed.js`, `portalFeedSync.js`: what it sends by itself, and what it writes back without asking). The KennelPort-facing half of these endpoints belongs to the KennelPort review — note and skip. Write `docs/review/findings/K07-waitlist-online.md`, add your INDEX row, commit docs only, push.
```

## K8 — family requests, pickup, transport, fees, emails

```text
Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K8") and follow it. You are reviewing what a family asks for and pays: extras, pickup slots, transport miles, backing out, fees and processing fees, the email outbox. Follow one family's money end to end and check the number she is shown equals the number recorded. Driving miles are live now — say exactly what the transport suggestion does when Mapbox fails or refuses. Write `docs/review/findings/K08-family-requests.md`, add your INDEX row, commit docs only, push.
```

## K9 — dogs, litters, pairings, events, nudges, Today

```text
Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K9") and follow it. You are reviewing the daily app: `pages/dog.js` (1,651), `litter.js`, `pairing.js`, `today.js`, and `nudges.js` (1,284) with the check-in and prep-pups flows, plus the new in-place pedigree fix (`pedigreeEdit.js`, `assets/pedigree.js`). Walk one Dog record through every life stage looking for a second record or a stuck state; audit date-only strings for `new Date` timezone shifts; then the nudges — one that can never be satisfied, one that never fires, and a missed whelping or health deadline. Write `docs/review/findings/K09-dogs-litters-nudges.md`, add your INDEX row, commit docs only, push.
```

## K10 — money

```text
Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K10") and follow it. You are reviewing every number: sales, invoices, receipts, contracts, expenses, credits, extra charges, processing fees and the reports. Build one sale with a deposit, an extra, a processing fee, a credit and a refund (then the same with a side sale, and with a fee received then undone), and follow its amount through the sale page, the invoice, the receipt, the litter's finances, the income view, the report and the year review — any disagreement is the headline finding. Then rounding, refunds, PDFs on a phone, and report date-range boundaries. Write `docs/review/findings/K10-money.md`, add your INDEX row, commit docs only, push.
```

## K11 — Kels and the guided tasks

```text
Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K11") and follow it. You are reviewing Kels and the guided flows (`kels*`, `guided*`, `wizard*`, `tidyUpUI`, `assistant*`). For every task: abandon it halfway and say what was written and what was lost; find any write that happens before a confirm; find questions asked twice; check wizard state survives a reload and a schema upgrade; run each task in Demo and in Lite. Write `docs/review/findings/K11-kels.md`, add your INDEX row, commit docs only, push.
```

## K12 — integrations, accounts, notifications

```text
Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K12") and follow it. You are reviewing Jotform, Stripe, the Accounts page, `accountHealth`, and notifications (push and the email digest, server side in `cloud/src/notify.js`). Prove vendor keys never leave `device_secrets`; then read the unproven Jotform paths for what fails on first contact with a real account (renamed field, replayed webhook, unmatched submission); then push and the digest, which are live now (a dead subscription, a rotated key, `0019` not yet applied). Write `docs/review/findings/K12-integrations-notifications.md`, add your INDEX row, commit docs only, push.
```

## K13 — editions, build, first run, PWA, marketing site

```text
Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K13") and follow it. You are reviewing the gates: the Lite cap, Demo's read-only, the Pro-only surface, `build/assemble.mjs` (and `--release`), `shared/sw.js`, first run and sample data, and `site/`. Headline task: enumerate **every** path that creates a dog or a litter — import, restore, cloud restore, sample data, Kels, merge, Furever seed — and say which walk past the cap hooks (Dog Cards included — it's Pro-only for exactly that reason). Then find a write that gets through in Demo. Assemble and actually serve all three builds. Then hold the rewritten `site/privacy.html` and `site/terms.html` against what the code really sends. Write `docs/review/findings/K13-editions-build.md`, add your INDEX row, commit docs only, push. Do not bump `CACHE_NAME`.
```

## K14 — multi-kennel, shows, identity, Companion, Furever

```text
Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K14") and follow it. You are reviewing scope and the share-outs: `kennel.js`, `kennelRepo`, `kennelScope`, `kennelCard`, `kennelTree`, `shows.js` + `showPoints`, `companionExport` and `companion-view.html`, the Furever seed and content packs, `settings.js`, the Dog Card allow-list (what leaves, `dogCard.js`), and `furever/` (6,900 lines, its own app). Hunt scope leaks first — a second own kennel seeing the first's records, or appearing in its totals. Furever is the likeliest thing to run out of room on; review it last and say where you stopped. Write `docs/review/findings/K14-scope-companion-furever.md`, add your INDEX row, commit docs only, push.
```

## K15 — the UI layer: escaping, accessibility, phone, offline

```text
Read `docs/KennelOS_Review_Plan.md` (sections 0, 0a, "Session K15") and follow it. Your first deliverable is a scanner: extract multi-line template literals assigned to `innerHTML` (or passed to the modal and list builders) across `shared/pages` and `shared/assets`, list every `${…}` expression, and flag any that is not `esc(...)`, a number, a safe constant or a nested builder — the single-line surface is already cleared, so this is the real one. Paste the scanner into your findings file. Then accessibility basics on real pages, the ten busiest pages at 320px in Playwright with screenshots, the newest screens (do-not-sell, dog cards, the picks preview, the side-sale dialog, the program badge bubble, the policies editor, the helper bar), the charts, and offline behaviour with the service worker serving. Write `docs/review/findings/K15-ui-layer.md`, add your INDEX row, commit docs only, push.
```

## K16 — consolidation (only after the others)

```text
Read `docs/KennelOS_Review_Plan.md` (sections 0 and "Session K16") and every file in `docs/review/findings/`. Produce `docs/review/SUMMARY.md`: de-duplicated findings ranked S1 → S4, the repeated themes, a fix order that puts lost records, leaked family data and wrong money first, the collected test gaps, what no session reached, and one line per row of the plan's "New since the first draft" table saying whether that feature left gaps. Reconcile with the KennelPort review's summary if that round has run. Do not re-review; if a finding looks wrong, check it and say so in one line. Commit docs only, push.
```
