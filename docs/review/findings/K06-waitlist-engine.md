# K06 — The waitlist engine: positions, turns, offers, passes

Reviewed: `shared/data/waitlistRules.js` (1,656), `waitlistActions.js` (1,734),
`waitlistEvents.js` (319), `waitlistEntryRepo.js` (151), `waitlistOfferRepo.js` (91),
`waitlistProgramRepo.js` (63), `waitlistReview.js` (132), `rosterCount.js` (59),
`shared/pages/waitlist-entry.js` (2,188), `pages/waitlist.js` (303),
`pages/waitlist-programs.js` (188), `shared/data/dateUtils.js` (91); the position and
turn readers in `assets/waitlistUI.js`, `assets/waitlistReviewUI.js` (1,078),
`assets/waitlistPicksPanel.js` (421), `assets/guidedPeopleUI.js`,
`data/waitlistProjection.js` (the ranking and turn-queue halves), `data/waitlistOutbox.js`,
`data/reportSources.js`, `data/nudges.js` (the waitlist block, 975–1060),
`data/referenceRegistry.js`, `data/csvImport.js` (`WAITLIST_MAPPING`); and, for the clock
seam only, `cloud/src/serverMoves.js` (1–310) and `cloud/src/familyPages.js` (the offer
and litter views).
· Contract read: `docs/KennelOS_Waitlist_Spec.md` §0, §4.2–§4.6, §6.1–§6.5, §7, §15.6,
§15.7, §16.1–§16.5, §16.9, §16.11; `docs/KennelOS_Waitlist_W2_Plan.md` §6 step 7;
guide §29 (Model, Rules engine, Turns, Passes, Public list) and §16 invariants.
· **Left to K6b:** side sales, the picks preview and the five 7-day undo windows. Where one
of them is the symptom of something K6 found (finding 7), it is named and handed over.

Verified by: green baseline at `f4411bf` — `node --test` **1649 pass**, `cd cloud && npm test`
**303 pass**, `node build/assemble.mjs` succeeds (precache 451, `kennelos-pro-shell-v113`).
Then, in my scratchpad (nothing in the repo):

- **four action-layer suites, seven cases**, on the `tests/support/memoryDb.js` harness (the
  `tests/waitlistTurns.test.js` pattern), driving the real repos and the real
  `waitlistActions`: a turn extended and then joined by a second litter; `extendTurn` given
  a Sunday and a closed date; `openPicks` run twice on one litter; a litter row's "first in
  line" against what `openPicks` actually offered; a turn whose only pup she then keeps,
  carried through `buildProjection` to see what the family's own page would show, and on to
  `recordOutcome('no_response')`; a prepassed litter carried through
  `offerNextTurn` → `recordOutcome('passed')` → `undoPass`; and two litters whose only pups
  are of opposite sexes, to separate what `nextTurn` says from what the entry page's litter
  rows say and then put `offerTo` through it;
- **a position-stability probe** over `compareEntries` / `rankedList` / `overallPositions` /
  `publicList`: 2,000 shuffles of a record set with three tied anchors and no
  `fee_received_at`, plus the same records read through an archived-program map and a
  dropped-program map;
- **a date-arithmetic sweep**: `addDaysToYMD` stepped over every day of 2026–2028 and
  compared against UTC day counting under `TZ=UTC`, `America/New_York`, `America/Santiago`,
  `America/Havana`, `Australia/Lord_Howe`, `Pacific/Apia`, `Asia/Beirut` and
  `Antarctica/Troll` — the zones whose DST change lands at or near local midnight — with
  `addMonthsToYMD` and `addOpenDays` at each month end;
- **eight Chromium runs** against the repo served over HTTP (`python3 -m http.server`, never
  `file://`): the three waitlist pages loaded empty (no page or console errors), then seeded
  with `sampleData.seedSampleData()` and re-measured at a 320 × 760 viewport, with a
  screenshot of the Litters card and a `getBoundingClientRect` check on its **Open picks**
  button; plus one run that tapped that button to see what the picks preview says.

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S2 | `shared/data/waitlistActions.js:1098` | A turn whose pups all go stays open and ends as a counted pass | verified |
| 2 | S3 | `shared/data/waitlistActions.js:629` | A litter joining a turn takes back the extension she granted, calling it a restart | verified |
| 3 | S2 | `shared/data/waitlistRules.js:327`, `:1171` | Every deadline is kept on the device's clock, never the kennel's time zone | verified |
| 4 | S3 | `shared/data/waitlistActions.js:1040` | Undoing a pass reopens litters the family said "Not this litter" to | verified |
| 5 | S3 | `shared/assets/waitlistReviewUI.js:169` | Kels ranks the list from a program map that drops archived programs | verified |
| 6 | S2 | `shared/pages/waitlist-entry.js:1400` | The out-of-turn guard asks the pre-turns rule, so it stays quiet when she jumps the queue | verified |
| 7 | S3 | `shared/pages/waitlist-entry.js:1381` | "Offer their turn" offers litters the family pre-passed, and mis-explains a side sale | verified |
| 8 | S3 | `shared/data/waitlistActions.js:563` | "Give them more time" ignores her open days and closed dates | verified |
| 9 | S3 | `shared/assets/waitlistUI.js:115` | The Paused and Not-ready badges print a raw `2027-01-20` beside formatted dates | verified |
| 10 | S3 | `shared/pages/waitlist.js:47` | The Waitlist page's five tables have no `.table-scroll`, so they run out of their cards on a phone | verified |
| 11 | S4 | `shared/data/waitlistActions.js:616` | Opening picks a second time overwrites `picks_opened_date` | verified |
| 12 | S4 | nine places (listed) | Nine rules implemented twice, engine and page | verified |
| 13 | S4 | `shared/data/waitlistActions.js` (whole file) | No waitlist multi-step write runs in a transaction | verified |

---

## Position is derived, never stored — and it is stable

The session's first job. Taking it in order:

- **Nothing stores it.** `grep -rn "position" shared/data` finds `position_anchor_date` (her
  manual override, a real stored field by design, Spec §6.1), the projection's published
  `position` / `pref_places` (a snapshot for the family's page, recomputed on every publish),
  and nothing else. No entry field, no offer field and no index holds a rank.
  `waitlistEntryRepo.js:6` says so and the code keeps the promise.
- **The comparator is a total order.** `compareEntries` (`waitlistRules.js:362`) ends in
  `String(a.id).localeCompare(String(b.id))`, so there is no pair it calls equal. I shuffled a
  record set with three entries sharing an anchor date and carrying no `fee_received_at`
  (the "imported, or recorded before it existed" case the comment names) 2,000 times and
  ranked each shuffle: **0 orders differed**. Two entries added in the same second are split
  by `created_at` and then by `id`; `chosenOrderChanges` (`:378`) additionally stamps
  `fee_received_at` a second apart for families she adds in a chosen order.
- **Every reader derives it the same way.** All eleven production callers of `rankedList` /
  `overallPositions` / `prefPlaces` / `publicList` / `litterQueue` pass the kennel id and let
  the engine do the filtering, so passing more entries than needed cannot change the order.
  Ten of the eleven build the program map with `waitlistProgramRepo.getMapForKennel`, which
  deliberately keeps archived programs (`waitlistProgramRepo.js:57`). **The eleventh is
  finding 5.**
- **Paused and resumed does not move anyone.** A pause is `paused_until` on an `active`
  entry; it touches no anchor. `publicList` (`:1512`) numbers from `rankedList` *before* it
  filters paused rows out, so their numbers are skipped, not reused — the public number is the
  real §6.1 number either way, and a pause ending shifts nobody.
- **A program changing does not move anyone silently.** `priorityGroup` (`:351`) reads the
  linked program whether or not it is archived; `waitlistProgramRepo.hardDelete` is blocked
  by `WAITLIST_PROGRAM_REFERENCES` while any family is in it, so a program cannot vanish
  under the ranking. Re-pointing a family at an `ahead` program does move them, which is the
  point.
- **A listen-list entry matching two litters** gets one `litterPosition` per litter from
  `litterQueue` (`:958`), each derived from the same `rankedList`; the family's own page is
  told only their overall number and a per-litter yes/no (Spec §16.9), so there is no
  second number to disagree with.

So: **position is stable across reads, with one exception, finding 5, which is her screen
rather than a family's.** The families' numbers — the status page, the public list, the
reminder emails (`waitlistOutbox.js:97`), the reports — all come off the same map.

## The turn clock, taken apart

What each deadline is, and which clock sets it:

| Moment | Date written | By | Clock |
|---|---|---|---|
| Turn opened (`openPicks`, `offerNextTurn`, `offerTo`) | `respond_by_date = respondByDate(today, …)` | `waitlistActions.js:515` | device `todayYMD()`, then her open days / closed dates |
| A litter joins an open turn | every open row restarted to `respondByDate(today, …)` | `:629` | same — **finding 2** |
| Extended | `respond_by_date = until`, as typed | `:563` | none — **finding 8** |
| Passed / no response | `outcome_date = date` | `:1098` | device |
| Expired (deadline gone by) | nothing written; it becomes a Today nudge | `overdueTurns` `:1171` → `nudges.js:987` | device — **finding 3** |
| Expired, server side | `server_close` event when `today > respondBy` | `cloud/src/serverMoves.js:267` | `localNow(now, kennel.time_zone)` |
| Reopened (`undoPass`) | fresh `respondByDate(today, …)` | `:1068` | device |
| Reopened (lost pup) | fresh `respondByDate(date, …)` | `:1233` | device |
| Fee pay-by | `feeDueDate(approved, config)` | `:297` | device, open days |

**DST and month end are sound, and worth recording as such.** `dateUtils.addDaysToYMD`
builds a local `Date` from calendar components and steps `setDate`; a skipped local midnight
normalises *forward* (so the day never slips) and a repeated one stays on its own day. I
stepped every day of 2026–2028 against UTC day counting in eight zones, including
`America/Santiago` and `America/Havana`, whose DST change is at local midnight, and
`Pacific/Apia` and `Antarctica/Troll`: **no mismatches in any zone**. `addMonthsToYMD` pins
Jan 31 + 1 month to Feb 28 (Feb 29 in 2028) instead of spilling into March, and `addOpenDays`
walks day by day through the same helper, so a window never lands on a closed weekday or one
of her closed dates. `cloud/src/serverMoves.addOpenDays` is an acknowledged second copy, and
both copies are pinned to the same cases (`cloud/tests/serverMoves.test.js:246` and
`tests/waitlistProjection.test.js:438`). Nothing here is a finding.

**Passes stay honest.** `passesUsed` counts frozen `counts_as_pass` flags on the entry's
offers (`:1365`), `countsAsPass` is read once at the outcome and never recomputed, and a
turn passed in full counts on exactly one row (`:1120`, `counts && o.id === offer.id`).
A litter cannot be hard-deleted out from under the count: `waitlist_offers.litter_id` is in
`referenceRegistry.js:67`. A merged contact moves entries, not offers, and `entryOffers`
keys on `entry_id`. `waitlistConfig` treats a stored `null`/`''` as unset, so a blanked
`max_passes` falls back to 2 rather than to `Number(null) === 0`, which would remove a family
on their first outcome — that is a good guard and I checked it specifically.

---

## 1. A turn whose pups all go stays open, and ends as a counted pass  (S2, verified)

**Where** `shared/data/waitlistActions.js:1098` (`recordOutcome`), with nothing upstream:
the only code that ever voids an emptied turn is `resolveOtherClaims` (`:1010`), which runs
only when two claims on one pup are resolved.

**Scenario** Litter Juniper × Ash has one available pup, Pip. She taps **Open picks**; the
turn goes to the Lees with until the 11th to pick and pay. The next morning she decides to
keep Pip after all (or Pip dies, or goes on a health hold, or she sells him off-app and marks
him `placed`). Nothing touches the Lees' turn. I ran exactly this: the offer row stays
`open` with `respond_by_date: 2026-10-11`, `eligiblePupsFor` now returns **0 pups**, and
`buildProjection` publishes `litters[A].pups: []` while the offer row it publishes beside
it still carries `respond_by_date`. The Lees' status page therefore draws a live turn card
with a deadline counting down and **no puppies in it** (the Worker builds the card's pups
from the projection's litter, intersected with `eligible_dog_ids` —
`cloud/src/familyPages.js:681`; I read that rather than opening the page). The only thing
they can do with it is pass, which is a pass, or let the deadline go by, which Today then
offers her as "Record no response" and which `no_response_counts_as_pass` makes a pass too. The run ends `{"used":1,"max":2,"counted":true}`. Two of these and the
family is removed from the list for a turn that never had a puppy in it.

**Why it matters** Spec §6.4 is explicit that **"a turn that reaches them with no pup
matching their preferences"** is never a pass — "it's skipped, not offered". The rule is
enforced at the moment the turn is made (`nextTurn` requires a non-empty `turnLittersFor`)
and nowhere after, so a turn that *becomes* empty walks straight through it. Her side of it is
no better: Today tells her the Lees "didn't respond", which is not what happened, and
`describeOfferChanges` will report a pass she has no reason to question.

**What I'd do** Give the open turn the same treatment `resolveOtherClaims` already gives it:
when a pup leaves the available set, re-check every open turn row that listed it and void the
turn (`counts_as_pass: false`, with the note it already writes) once nothing is left anywhere
in it. The natural hooks are `dogRepo.update` of `disposition`/`status` and sale creation —
or, if a hook in the data layer is unwelcome, a Today nudge (`overdueTurns`' neighbour) for
"the Lees' turn has no pups left" plus a guard in `recordOutcome` that refuses to count a
pass on a turn with no available pup in any of its rows.

## 2. A litter joining a turn takes back the extension she granted, calling it a restart  (S3, verified)

**Where** `shared/data/waitlistActions.js:629` — `openPicks` recomputes
`respondBy = respondByDate(date, config, program)` from **today** and writes it over every
open row of the turn it joins, with no comparison against what each row already holds.

**Scenario** The Lees hold the turn on Litter A, due the 11th. They phone: the grandmother
is in hospital, can they have a fortnight. She opens Kels, **Review my waitlist → Give them
more time**, and sets the 25th; `extendTurn` writes the 25th on the row and notes it, and
Kels emails the family "you have until the 25th". Next day Litter B's picks open and B joins
the Lees' turn because they are its top family. I ran it: the joined turn comes back
`respond_by_date: 2026-10-12`, and **both** rows now read `2026-10-12`, with a note that says
"Respond-by date restarted on 2026-10-09: another litter joined this turn." The fortnight is
gone, replaced by three days. Eleven days before she thinks it is due, their turn is overdue
on Today and one tap records a pass.

**She is told, but not in a way that reads as a loss.** Every path to `openPicks` goes
through the picks preview (`assets/picksPreviewModal.js:181` is the only caller of
`actions.openPicks`, and the Litters card, the picks panel, the litter check-in, Today and
Kels all reach it through `openPicksPreview`). I ran `previewPicks` on the extended turn and
it does carry both dates — `{ kind: 'join', respond_by: '2026-10-12', was_respond_by:
'2026-10-25' }` — which the modal words as *"Their deadline **restarts** for the whole turn:
Oct 25, 2026 → **Oct 12, 2026**."* (`picksPreviewModal.js:272`). So this is an S3 and not an
S2: she can catch it. She has to notice that the arrow points backwards in a sentence whose
verb is "restarts", on a screen whose job is to tell her who gets the turn, having set the
25th herself on a different screen on a different day.

**Why it matters** Restarting the window when a litter joins is deliberate (guide §29, "the
respond-by date restarts for the whole turn") and right when the restart *lengthens* it,
which is the usual case. It is wrong when it shortens it, and the only way it can shorten it
is by discarding something she entered by hand for a reason.

**What I'd do** Keep the later of the two: a turn-wide
`respondBy = [respondByDate(date, …), ...open.offers.map((o) => o.respond_by_date || '')]
.sort().reverse()[0]` before the loop, so every row still ends up equal (duplicate 3 of
finding 12 depends on that). Then the preview's `was_respond_by === respond_by` branch fires and it
says "Their deadline stays Oct 25, 2026", which is the truth. If a shortening restart is ever
wanted, it needs her say-so, not a sentence she has to read twice.

## 3. Every deadline is kept on the device's clock, never the kennel's time zone  (S2, verified)

**Where** `shared/data/waitlistRules.js:327` (`respondByDate`) and `:1171`
(`overdueTurns`), both fed `todayYMD()` from `shared/data/dateUtils.js:15`, which is
deliberately the **device's** local calendar date. `grep -rn "time_zone" shared/data
shared/pages shared/assets` shows `Kennel.time_zone` reaching exactly four things —
`waitlistInbox.arrivalDate` (dating an incoming application), `portalFeed`, the Stripe
session date, and what gets published — and **no** deadline path. The server's half does use
it: `cloud/src/serverMoves.js:235` takes `localNow(now, projection.kennel?.time_zone)` and
closes a turn when `today > t.respondBy` (`:267`).

**Scenario** She sets the kennel's time zone when she puts the list online; the picker
prefills the device's zone and the hint under it reads *"Offer deadlines end at 11:59 pm
here."* (`shared/assets/waitlistSetupUI.js:274`). Say that is `America/Chicago`. In March she
takes her phone to a show in London. The Okonkwos' turn is due the 14th. At 09:00 London on
the 15th — 03:00 the 14th in Chicago, nearly a whole day inside the family's window —
`todayYMD()` on her phone is `2026-03-15`, `overdueTurns` returns their turn, Today offers
**"The Okonkwos' offer deadline passed — record no response"**, and one tap closes the turn
as `no_response`, cancels the deposit-pending Sale holding their pick, counts a pass, and (with
`auto_offer_on`) offers the pup to the next family. Meanwhile the server, on Chicago time,
has not closed anything, and the Okonkwos' own status page still shows a live deadline. The
mirror case is as bad: a turn she opens at 22:00 Pacific while the kennel is Central gets a
window one day short of what the family is promised, because `respondByDate` starts counting
from her device's yesterday.

**Why it matters** Spec §6.5 fixes the contract — "**date-only, end of day in the kennel's
time zone**… The time zone is a new kennel setting" — and the setup card repeats it to her in
those words. Her own device is the one place that does not honour it, and it is the device
that writes the deadlines and prompts her to act on them. This does not need travel: a phone
whose zone is set wrong, a move, a kennel whose zone she set once for a co-owner's location,
or a tablet left on UTC all produce it. For a kennel that went online before `time_zone`
existed, `localNow` falls back to UTC, and then the *server* is the one that is hours early
— a US kennel's 11:59 pm deadline is closed by the cron at 19:00 Eastern on the deadline day.

**What I'd do** Make the kennel's zone the engine's clock, not the device's: one
`kennelToday(kennel)` in `dateUtils` (the `Intl.DateTimeFormat('en-CA', { timeZone })` shape
`waitlistInbox.arrivalDate:54` and `serverMoves.localNow:30` already use twice), and pass it
wherever a waitlist page currently calls `todayYMD()`. It is a bigger change than it looks
because `todayYMD()` is the app's one definition of today, so the narrow version is to use it
for the three waitlist deadline comparisons (`overdueTurns`, `overdueFees`,
`readyCheckOverdue`) and for `respondByDate` / `feeDueDate`, and to leave everything else
alone. Separately, the Worker should refuse to run `serverMoves` against a kennel with no
stored `time_zone` rather than assume UTC — that part is K4's.

## 4. Undoing a pass reopens litters the family said "Not this litter" to  (S3, verified)

**Where** `shared/data/waitlistActions.js:1040` — `undoPass` gathers the rows to reopen by
`o.outcome === offer.outcome && o.outcome_date === offer.outcome_date`, not by what was
actually open when the pass was recorded. The prepassed rows `recordPrepassed` (`:472`)
writes are `outcome: 'passed'` with `outcome_date` = the day the turn was made.

**Scenario** The Lees say "Not this litter" to Litter B on their status page. Both litters
already have picks open when the turn comes round to them (in my run I held them with a
one-day pause while the two litters opened, then lifted it and called `offerNextTurn`).
`splitPrepassed` does the right thing: the turn is offered on **A only**, and B is written as
a `passed` row with `counts_as_pass: false` and the note "Passed ahead of time… recorded when
their turn came", and their prepass is cleared off the entry. That same day she records their
pass on A. Now A and B are both `passed` with the same `outcome_date`. She changes her mind —
they called, they do want a pup — and taps **Undo the pass**. I ran it:
`after Undo the pass: B=open A=open`. Litter B, which the family explicitly asked to be left
out of, is open to them again, and because `recordPrepassed` already consumed the prepass,
nothing re-blocks it. The entry page then announces *"Their turn is back (Litter A, Litter
B)"* and queues an `offer` email listing both litter ids (`waitlist-entry.js:1534`–`:1535`).
`undoPass` also voided the current holder's turn to make room for it.

**Why it matters** §16.2 is the family's own instruction about a specific litter. An undo
should put back what it closed, not more. It also means the Lees' history now shows B as
"Not this litter" (the original note), then offered, then whatever happens next — which does
not read as anything a person would recognise.

**What I'd do** Narrow the gather to rows that were open: either match on the note/outcome
pair only for rows without a prepass note, or — better, since it is also what makes the match
fragile — stamp the turn's closing with its own marker (a `closed_turn_seq`, or simply skip
rows whose `notes` carry the prepass line) and reopen only those. Re-adding the prepass to
the entry when its row is not reopened would also keep the family's instruction alive for the
next turn.

## 5. Kels ranks the list from a program map that drops archived programs  (S3, verified)

**Where** `shared/assets/waitlistReviewUI.js:169` keeps
`programs: programs.filter((p) => !p.is_archived)` from a `waitlistProgramRepo.getByKennel(k.id)`
call (`:152`) that already excludes archived programs, and `:883` turns that into the map it
hands `rankedList` and `overallPositions` at `:884` / `:886`. Every other reader uses
`getMapForKennel`, which keeps them on purpose — the comment at
`waitlistProgramRepo.js:56` says "a program keeps applying to the families already in it
after it's archived", and `waitlistRules.js:348` repeats it: "archiving a program must not
silently reorder the families already in it".

**Scenario** She ran a *Repeat buyers* program that put those families ahead, closed it to
new families last spring, and archived it; Ms Ng is still in it. Her waitlist page, Ms Ng's
entry page, the public list and Ms Ng's own status page all say **#1**. She then opens Kels
→ **Review my waitlist**, reaches "Who should have it?", and the same list is drawn from the
filtered map: I ran both maps over the same three records and got
`#1 ng  #2 lee  #3 kim` everywhere else against `#1 lee  #2 kim  #3 ng` in Kels — Ms Ng is
offered **last**, labelled `#3`. Picking the name at the top of Kels's list is picking out of
order, and the `#3` beside Ms Ng's name contradicts the `#1` on the page she just left.

**Why it matters** This is the one place where position is not stable across reads, and it is
the screen designed for her to act on the order. She has no way to tell which number is right.
It is not a family's number, so it is S3 and not S1 — but the same map is also used for the
`eligiblePupsFor` pass at `:884`, which means Kels will happily offer the turn to a family the
engine would have put second.

**What I'd do** `waitlistProgramRepo.getMapForKennel(k.id)` in `load()`, and keep the
non-archived list separately if the step that offers her a program to assign needs one.

## 6. The out-of-turn guard asks the pre-turns rule, so it stays quiet when she jumps the queue  (S2, verified)

**Where** `shared/pages/waitlist-entry.js:1400` and `shared/pages/waitlist.js:176` both
call `nextFamilyForLitter` (`waitlistRules.js:1028`), the per-litter rule from before turns
existed: it looks at **one litter's** offers, returns `null` only if that litter has an open
offer, and knows nothing about a turn open elsewhere in the kennel, about `picks_opened_date`,
or about prepasses. The write path beside it goes through `nextTurn` (`:1145`), which is
kennel-wide and prepass-aware. On the entry page that answer is what decides the badge and
the confirm: `:1413`–`:1415` shows a green **"They're next"** when `!c.next || c.next.entry.id === e.id`,
and `:1435`–`:1436` only raises **"Offer out of turn?"** when `c.next` names somebody else.

**Scenario** Litter L has one male pup, Litter M one female; picks are open on both and
nobody holds a turn (automatic offers are off, the default). The Joneses paid in January and
want a female — so they match M only. The Smiths paid in June and want a male — M only for
them is L. §16.1 gives the turn to the Joneses: highest-ranked family with an eligible pup in
an open litter. I ran it, and `nextTurn` agrees. Then I asked the entry page's question for
the Smiths on Litter L:

```
the kennel's real turn order (rankedList): Jones then Smith
§16.1 says the next turn goes to: Jones
Smith's page, Litter L row, says first in line is: Smith
→ badge shown: "They're next" (green)
→ "Offer out of turn?" confirm shown: NO
offerTo went through for: Smith — note recorded: ""
Jones now: waits for Smith's turn to settle
```

She opens the Smiths' page, sees a green **They're next** against Litter L, taps **Offer the
turn**, and is asked nothing. `offerTo` does not object either — it refuses only when a turn
is already *open* (`waitlistActions.js:598`). The Joneses, who had the turn, are behind the Smiths until the
Smiths settle, and because the confirm never fired, `note` is empty: the offer row carries
**no record that it was out of order**, so neither her History tab nor
`describeOfferChanges` can tell her later.

**Why it matters** Guide §29 ends on "**no offer is ever made silently**", and `offerTo`'s
own comment says "Offering out of order is allowed: the page confirms it with her first and
passes `note` saying who was next." Both are true only when the two rules happen to agree.
This is the duplicate the plan predicted, and it has already cost the guard its purpose.

**The same divergence on the Waitlist page is caught before it writes.** There the
`nextFamilyForLitter` answer appears only on a litter whose picks are not open yet
(`:176` → the `else if (next)` branch at `:205`), and that button goes through the picks
preview, which simulates with the real turn rule. I ran a prepass case directly against
`openPicks`, bypassing the preview: the Litters card said "First in line: Lee" and `openPicks`
offered the turn to **Kim**, recording a counted pass against the Lees on the way
(`auto_passed: ["Lee (a pass recorded)"]`). Through the preview she would be told that first
(`picksPreview.js:146`, `kind: 'offer'` with `auto_passed`). So the Waitlist page's label is
wrong but harmless; the entry page's is not gated by anything.

**What I'd do** Take the entry page's `next` from the kennel-wide rule —
`nextTurn(...)` once in `litterChoices`, with `litterQueue(...)[0]` only where she genuinely
wants "first in line *for this litter*" as a separate number (a real concept, Spec §6.1), and
then labelled as that and not sitting next to the offer button. Better still, move the guard
into `offerTo`: have it compute `nextTurn` itself and refuse without an explicit
`outOfOrder: true` from the caller, so the note can never be lost again.
`nextFamilyForLitter` would then be left with its one honest use, `prefChangeEffect`
(`:1344`).

## 7. "Offer their turn" offers litters the family pre-passed, and mis-explains a side sale  (S3, verified)

**Where** `shared/pages/waitlist-entry.js:1381` (`litterChoices`) builds its own ladder of
blocked reasons — `openTurns`, `turnSpent`, `isReadyHeld`, `isManuallyPaused`,
`isListeningFor`, "no pups available", "no pup matches" — and then calls `eligiblePupsFor`
for the pups. It never calls `prepassFor`, and it reaches `!eligible.length` for cases
`eligiblePupsFor` rejects for a different reason.

**Scenario, prepass** The Lees said "Not this litter" to Litter A. **Interact → Offer
pups** lists Litter A as selectable, pre-checked, with a green **"They're next"** badge and
"pups for them: Pip (Male)". She taps **Offer the turn** and gets
*"They said 'Not this litter' to Litter A on their status page. Undo that on their page
first if they've changed their mind."* — `offerTo`'s throw (`waitlistActions.js:605`). A dead
end with a next step, but reached after she chose.

**Scenario, side sale** A family with a pending side sale is excluded by
`eligiblePupsFor` (`waitlistRules.js:950`, `sideSaleOf`), so `eligible` is empty and the ladder falls through
to its last rung: every litter reads **"No available pup matches what they want."** That is
not why. The right sentence ("they're buying a pup from you already") exists on the same page
in the side-sale card. *(Side sales are K6b's; the duplicated reason ladder that produces the
wrong sentence is K6's, which is why it is here.)*

**Why it matters** Two branches of the same question — "can this family be offered this
litter, and if not why" — live in `eligiblePupsFor`/`splitPrepassed` and again in a ladder
on the page, and the page's copy is behind on two cases. The second is worse than the first:
a wrong explanation sends her looking at the family's preferences for a problem that isn't
there.

**What I'd do** Have `litterChoices` take its reason from the engine. The smallest version
is one exported `offerBlocker(entry, litter, …)` in `waitlistRules` that returns the reason
string or `''`, built from the same checks `eligiblePupsFor` and `offerTo` already make
(prepass and side sale included), with `offerTo` throwing on the same function so the dialog
and the action can never disagree again.

## 8. "Give them more time" ignores her open days and closed dates  (S3, verified)

**Where** `shared/data/waitlistActions.js:563` — `extendTurn` validates only
`until > date` and writes `until` straight onto every open row. Its dialog
(`shared/assets/waitlistReviewUI.js:769`) prefills
`addDaysToYMD(this.today, config.respond_days)` — plain calendar days, not `addOpenDays`.

**Scenario** She does business Monday to Friday and has blacked out 26 November for
Thanksgiving. Every other deadline in the app honours that: `respondByDate` →
`addOpenDays(…, businessDays(config))`, and I confirmed Thu + 3 open days with Saturday
closed comes out Tuesday the 13th, not Sunday the 11th. `extendTurn` took **2026-10-25, a
Sunday**, and then **2026-10-26, her own closed date**, without a word. The prefilled default
does the same thing: `today + respond_days` lands on a weekend roughly two days in seven.
The family is told to pick and pay by a day she isn't reading messages, and the deposit lands
when she's away.

**Why it matters** Guide §29 lists the five deadlines her open days govern and names
`respondByDate` as one of them; an extension is the same deadline, set by hand. One path
through the rule applies her calendar and the other doesn't.

**What I'd do** Push `until` through `addOpenDays(until, 0, businessDays(config))`-style
normalisation (or refuse it with "you're closed that day — the next open day is the 27th"),
and prefill the dialog with `respondByDate(this.today, this.config, program)` so the default
is the same date the engine would have produced.

## 9. The Paused and Not-ready badges print a raw `2027-01-20`  (S3, verified)

**Where** `shared/assets/waitlistUI.js:115` and `:118` — `entryFlags` builds
`Paused to ${esc(entry.paused_until)}` and `Not ready until ${esc(readyFromDate(entry))}`.
`fmtDate` is imported on line 13 of the same file and used correctly eleven lines below at
`:129`.

**Scenario** I seeded the sample packet in Chromium and opened Mia Torres's entry at 320px.
Her status card reads *"On the list — #1 of 5 on the list. **In line since Apr 8, 2026**.
Passes used: 0 of 2."* and then, immediately beside it, an amber badge reading
**"Paused to 2027-01-20"** — which at 320px wraps mid-date, breaking across the hyphen as
`2027-` / `01-20`. The same badge is on every paused row of the Waitlist page's rolling list,
next to an "In line since" column that *is* formatted.

**Why it matters** It is the only ISO date a breeder is shown anywhere in the waitlist's
own screens, sitting a centimetre from two formatted ones, and `paused_until` is exactly the
date she is looking for when she checks whether someone is still on hold. The wrap makes it
worse on a phone.

**What I'd do** `fmtDate(entry.paused_until)` and `fmtDate(readyFromDate(entry))`, both
already available in the file.

## 10. The Waitlist page's tables run out of their cards on a phone  (S3, verified)

**Where** `shared/pages/waitlist.js:47` — the page's own `table()` helper emits a bare
`<table class="data">` with no wrapper. `app.css:455` defines `.table-scroll { overflow-x:
auto; -webkit-overflow-scrolling: touch; }` for exactly this, and `pages/dog.js`,
`kennels.js`, `dog-cards.js` and `breed-feeding-schedules.js` all use it. On the Waitlist
page it is **0 of 5 tables**.

**Scenario** At 320 × 760 with the sample packet, `document.documentElement.scrollWidth`
is 320, so the *page* does not scroll sideways — but five elements are wider than their box
with `overflow-x: visible`: the New applications table (299 > 288), the rolling list's card
body (252 > 246), and the Litters card (298 > 286) and its body (278 > 246). The screenshot
shows the result: the Litters table's grey header band and every row rule run **past the
card's right border** and are cut off at the viewport edge, and the **Open picks** button
straddles the border (its box is 216.5 → 309.4 against a card that ends at 304). The button
is still inside the viewport and tappable — I measured it, so this is not an unreachable
control — but the card looks broken and the four-column table has nowhere to go.

**Why it matters** Recipe item 7: "a table that must scroll inside its own box, not the
page". This one does neither — it spills out of its box and the page can't scroll to reach
what spilled. The four columns (Litter, Pups available, Picks, Turn) each wrap to three or
four lines to fit, so "Meadow Ridge foster litter" becomes four lines and "Open since Nov 8,
2026" becomes five.

**What I'd do** Wrap the helper's output: `<div class="table-scroll">…</div>`, which is one
line in `table()` and fixes all five at once. The Litters card's Turn column would also read
better as a stacked block below the row on narrow screens, but the wrapper is the fix.

## 11. Opening picks a second time overwrites `picks_opened_date`  (S4, verified)

**Where** `shared/data/waitlistActions.js:616` — `openPicks` begins with an unconditional
`litterRepo.update(litterId, { picks_opened_date: date })`.

**Scenario** Picks have been open on Litter A since 8 October; the card reads "Open since
Oct 8". She taps **Open picks** again on 1 November — from the Litters card, from the picks
panel, or through the picks preview, all of which reach `openPicks` — perhaps because a turn
closed and she wants the next one. I ran it: `picks_opened_date 2026-10-08 -> 2026-11-01`.
The date she has been reading as "when this litter's picks opened" is gone, and with it the
only record of when the litter started being offered.

**Why it matters** It is cosmetic today — the projection publishes only
`picks_open: Boolean(...)` (`waitlistProjection.js:514`), so no family sees the date, and no
rule reads it beyond a truthiness test. It is an S4 because the field is the obvious anchor
for the next thing anyone wants ("pups have been available for three weeks", the automatic
`auto_offer_on` trigger at N weeks that Spec §6.5 Q8 still holds open), and by then the value
will quietly be wrong on any litter she has re-opened.

**What I'd do** `if (!litter.picks_opened_date)` around the stamp, and let `closePicks` /
re-open be the only thing that clears it.

## 12. Nine rules implemented twice, engine and page  (S4, verified)

The full register, as the plan asks. Three have *already* drifted and have their own
findings above: the program map behind the ranking (finding 5), `nextFamilyForLitter`
against `nextTurn` (finding 6), and the blocked-reason ladder (finding 7). The remaining six
are fine today and each becomes a defect the next time the rule it copies changes.

1. **The live litter and pairing stages.** `shared/pages/waitlist-entry.js:90-91` declares
   `LIVE_PAIRING = ['planned', 'bred', 'confirmed_pregnant']` and
   `LIVE_LITTER = ['expected', 'whelped', 'weaning', 'ready']` — character-for-character
   `LISTEN_LIVE_PAIRING` / `LISTEN_LIVE_LITTER` at `waitlistRules.js:845-846`, from a module
   the page already imports eighteen other names from. Used six times on the page
   (`:1102`, `:1103`, `:1109`, `:1110`, `:1386`, `:1828`) and six times in the engine. Add a
   litter stage to `vocab.LITTER_STATUS` and half the app sees it.
   `shared/pages/waitlist.js:43` declares a third copy of `LIVE_LITTER`, used at `:170`
   and `:291`.
2. **`overdueOffers` is a dead second implementation of `overdueTurns`.**
   `waitlistRules.js:1427` filters open offers one row at a time; `:1171` groups them into
   turns and is what `nudges.js:987` actually uses. `overdueOffers` has **no production
   caller** — and is exercised by `tests/waitlistRules.test.js:359`, so it will keep passing
   while the real rule moves. Either delete it or make `overdueTurns` call it.
3. **A turn's deadline is derived four ways.** `openTurns` takes the latest of its rows
   (`:1122`, `sort().reverse()[0]`); `turnView` repeats that expression
   (`waitlistActions.js:465`); `waitlist-entry.js:299` and `:332` do it a third way
   (`.filter(Boolean).sort().pop()`); and `cloud/src/serverMoves.js:114` takes **row 0's**
   date. All four agree only because every writer keeps the open rows in step — which
   finding 2's fix must preserve. The server's version is the one that would break first.
4. **"Is this turn overdue" is inlined twice.** `waitlist-entry.js:1628` and
   `waitlist.js:187` both write `o.outcome === 'open' && o.respond_by_date &&
   o.respond_by_date < today` rather than asking `overdueTurns`, which is where finding 3's
   fix would have to land.
5. **A third litter queue.** `waitlistReviewUI.js:884` rebuilds `litterQueue` as
   `rankedList(...).filter((x) => eligiblePupsFor(...).length)`. That is what `litterQueue`
   (`:958`) is, minus its `litterPosition` — and it is the copy that carries finding 5's bug.
6. **"Does this family hold the turn."** `waitlistActions.js` asks
   `openTurns(c.offers, c.kennel.id).some((t) => t.entry_id === entry.id)` (`:898`);
   `waitlist-entry.js:1938` and `:2093` ask
   `ctx.offers.some((o) => o.outcome === 'open' && !o.is_archived)`. There is no engine
   helper for it, which is why the page wrote its own.

## 13. No waitlist multi-step write runs in a transaction  (S4, verified)

**Where** `shared/data/waitlistActions.js` throughout. `confirmDeposit` (`:852`) performs
six sequential awaited writes — sale, dog disposition, offer outcome, other claims, entry
status, the other offers released — then calls `finishTurn`, which loads the whole kennel and
may write a fresh turn. `recordOutcome`'s pass branch (`:1113`–`:1127`) loops `waitlistOfferRepo.update`
over a turn's rows and only then counts the passes and removes the entry. None of it is inside
`db.transaction`, although the data layer uses transactions in five other places
(`importExport.js:179`, `recordMerge.js:305`, `pedigreeImport.js:285`, `appReset.js:26`,
`assistantStore.js:36`).

**Scenario** She taps **Deposit received** on a phone that is about to lose the tab (iOS
reclaiming a backgrounded Safari, a reload, a crash, a sync-triggered `versionchange`). The
sale is `deposit_paid` and the pup is `placed`, but the offer is still `open` and the entry
still `active`. The family's status page shows a live turn on a pup that is no longer
available; `isAwaitingDeposit` is still true, so **Deposit received** offers itself again;
Today will eventually offer "record no response", which would cancel the paid sale through
`releasePick` — except `releasePick`'s `strict` guard catches that one and throws
*"Their sale already shows the deposit as received."* The pass branch is less lucky: a turn
left half `passed` and half `open` reads as an open turn to `openTurns`, blocks the next turn
indefinitely, and gives `serverMoves`' row-0 deadline reading (duplicate 3 of finding 12) a row whose
outcome no longer matches its siblings.

**Why it matters** These are the writes most likely to be interrupted — she is on a phone,
and the actions are the long ones. Guide §29 says `waitlist_offers` rows of a turn "share
`turn_id`", which is the invariant a partial write breaks. Nothing detects or repairs a
half-applied turn.

**What I'd do** Wrap each action's writes in one `db.transaction('rw', …)` — the repos all
go through `db.*` so they nest cleanly — and keep `finishTurn`'s re-read outside it, since
offering the next turn is a separate decision. Failing that, a consistency check over turns
(rows of one `turn_id` with mixed outcomes, an `accepted` offer whose entry is not `placed`)
in `tidyRules` or as a Today nudge.

---

## Notes, not findings

- **Date arithmetic across DST and month ends is correct**, in every zone I could think of
  to break it (see "The turn clock" above). Recording it because the plan names timezones as
  the recurring hazard and because the next person to touch `addOpenDays` should know the
  sweep exists; it took ten minutes to write and is in my scratchpad, not the repo.
- **Positions are stable** (see the opening section). `publicList` numbers before filtering
  paused rows, so a paused family's number is a gap and nobody shifts when their pause ends.
- **Events.** The plan's item 5 asks for "every waitlist action writing its `HistoryEvent`".
  That is not how the feature is built, and the guide is explicit about it (§29 Rules engine:
  "Nothing it computes is stored"; `eventRepo` is used by `waitlistActions` only for pickup,
  drop-off and boarding events on a dog, `:1524`, `:1581`, `:1591`). A family's story is
  reconstructed from the offer rows (`outcome`, `outcome_date`, `counts_as_pass`,
  `picked_date`, `restored_date`, `lost_*`, and a free-text `notes` each action appends to),
  the entry's dated fields, `pref_change_log`, and `messages`. The entry page's Timeline
  (`waitlist-entry.js:1665`) renders all of it. I checked each action against that: every one
  writes either a dated field or an offer row plus a note, so there is no action whose effect
  leaves no trace. The two gaps are the half-applied writes of finding 13 and `autoPassTurn`
  (`:492`), which writes the pass rows and the family-facing activity line but no line in the
  entry's own `notes` — the removal is still visible through `removed_date` /
  `removed_reason`, so it is reconstructable, just thinner than the paths she drives herself.
  **The plan's item 5 should be reworded** for K16, or it will be re-found as a finding by
  someone reading the plan rather than the guide.
- **"Place them with the Smiths" gives the same date, not a later one.** Spec §6.1 describes
  the override as "the app converts that to a date just after the Smiths' anchor";
  `setPositionAnchor` (`:385`) copies the other entry's anchor exactly, and the tie is then
  broken by `fee_received_at`. The dialog is honest about it — *"Families on the same date are
  ordered by when their fee was recorded, so they may land just before or after"*
  (`waitlist-entry.js:1065`) — and the result is deterministic, so this is a departure the
  build improved on rather than a defect. It wants the **Modified:** note CLAUDE.md asks for:
  neither the spec nor guide §29's position bullet mentions `position_anchor_date` taking
  another entry's date. One ragged edge: if the family she picks has no anchor at all,
  `anchorDate(other) || null` silently *clears* the override instead of moving them.
- **An `active` entry with no anchor date at all sorts to #1.** `anchorDate` falls back
  `position_anchor_date → fee_received_date → approved_date → ''`, and `''` sorts before every
  date. `validateEntry` (`waitlistEntryRepo.js:35`) requires a status, a contact and a listen
  mode but no date. I could not reach it from the app: `approve` always stamps `approved_date`,
  the CSV importer only ever creates `applied` rows (`csvImport.js:1669`), and the edit form
  refuses to blank the fee date (`waitlist-entry.js:1343`). A JSON restore or a sync apply of
  a row written by something else would do it, and the result is a family at the top of the
  public list with a blank "in line since". Worth a guard in `validateEntry` (an `active`
  entry needs one of the three) more than a finding; the restore side is K2's.
- **`max_passes: 0`** survives `waitlistConfig` (0 is a real value) and makes
  `shouldRemoveForPasses` true on the first recorded outcome. `waitlistConfigProblem` rejects
  it on save, so only a restore or an edited backup gets there, and "0 passes allowed" is
  arguably what it means. Mentioning it because the same shape (`Number(v)` over a config
  value that could be 0) is how a null `max_passes` would have removed everyone, and that one
  *is* guarded.
- **Layering and escaping are clean** on the three pages in scope. No `from '../data/db.js'`
  and no `localStorage` in `waitlist-entry.js`, `waitlist.js`, `waitlist-programs.js`,
  `waitlistRules.js`, `waitlistActions.js`, `waitlistUI.js` or `waitlistReviewUI.js`. The
  derived strings that look unescaped at the point they are built — `prefPlacesText`'s labels
  (`:186`), `pupLabel` (`:1370`), the Timeline's sentences (`:1677`) — are all escaped at the
  render site (`esc(label[k])`, `esc(c.eligible.map(pupLabel).join(', '))`, `esc(t)`), and
  `o.notes`, the one free-text field on an offer, goes through `esc` at `:1657`.
- **Nudge details print raw `YYYY-MM-DD`.** `nudges.js:997` ("they had until 2026-10-11"),
  `:1022` and `:1033` interpolate the date string where the rest of the app uses `fmtDate`.
  Consistent within `nudges.js`, so it reads as a house style rather than a slip — K9 owns
  Today and should decide.
- **The two `addOpenDays` implementations are both pinned.** `cloud/src/serverMoves.js:54`
  is a declared copy of `dateUtils.addOpenDays`, and `cloud/tests/serverMoves.test.js:246-253`
  and `tests/waitlistProjection.test.js:438-440` assert the same cases on each. Good practice;
  noting it so finding 12's register isn't read as including it.
- **`waitlist-entry.js` at 2,188 lines** holds its state in one module-level `ctx` that
  `reload()` refreshes wholesale before each redraw, which is why I found no panel-to-panel
  staleness: every panel reads the same object, rebuilt from the repos after every action
  (`afterAction` → `reload` → render). The risk the plan anticipated is real but mitigated by
  that discipline; the thing to protect is `reload()` being called after *every* write, and
  `onMove` (`:1078`) is the one action that calls `afterAction()` without the `&&` guard the
  others use — harmless today because `formModal` resolves falsy on cancel, but it reads
  differently from its nine neighbours.

## Coverage gaps I found (tests that should exist)

- **A turn that empties while it is open** (finding 1). `tests/waitlistTurns.test.js`
  covers a litter getting *smaller* only through a pick; nothing marks the last matching pup
  `keeping` or `health_hold` under an open turn. The assertion to add is that the resulting
  outcome is **not** counted as a pass.
- **`extendTurn` followed by `openPicks`** (finding 2). `waitlistTurns` tests the join and
  `waitlistReview` tests the extension, never in that order. One test: extend, join, assert
  the deadline did not go backwards.
- **Any test at all that `respond_by_date` respects her calendar on an extension**
  (finding 8). `tests/waitlistRules.test.js` covers `respondByDate` with open days and closed
  dates thoroughly; `extendTurn` has no such case.
- **`undoPass` on a turn that carried prepassed rows** (finding 4). `waitlistTurns` covers
  undoing a plain turn pass and `waitlistRules` covers `splitPrepassed`; the combination is
  untested, which is why the row-matching heuristic at `:1040` has survived.
- **A position test that two readers agree.** Nothing asserts that the program map every
  position reader uses includes archived programs (finding 5). A small suite that calls each
  of the eleven call sites' loader and asserts the resulting map has the archived program
  would have caught it; failing that, a test on `waitlistReviewUI.load()` directly.
- **A turn-shape invariant.** No test asserts that the rows of one `turn_id` share an outcome
  and a `respond_by_date`, which is the invariant findings 2, 12.3 and 13 all bear on.
- **The out-of-turn guard** (finding 6). `tests/waitlistTurns.test.js` covers `offerTo`
  succeeding and its three refusals, but never asks whether the family it offered was the one
  `nextTurn` would have picked. The test to add is the two-litter, two-sex shape in my
  scratchpad: assert that `nextFamilyForLitter` for the litter and `nextTurn` for the kennel
  name the same family, or that the caller was told they didn't.

## What I did not get to

- **K6b's three features**, by instruction: side sales, the picks preview and the five
  7-day undo windows. I read `canUndoRemoval`/`canUndoWithdrawal`/`canUndoDecline`/
  `canUndoExpire`/`canUndoFeeReceived` only far enough to be sure they do not feed the turn
  clock (they don't — they read `removed_date`, `withdrawn_date`, `declined_date`,
  `expired_date` and `fee_received_at` against `today`, and nothing in the turn path reads
  them back), and `sideSaleOf` only where it changes `eligiblePupsFor`.
- **`tidyRules.js` (428)** — plan item 6. I did not open it. Nothing else in this session
  touches it, so it is wholly outstanding and K16 should re-assign it.
- **`assets/waitlistUI.js` (688) and `waitlistPicksPanel.js` (421) in full.** I read their
  position and turn readers and `restoreLostPupDialog`, and traced the picks panel's
  `litterQueue` and `nextTurn` calls, but did not walk either module by the page recipe.
  `waitlistReviewUI.js` (1,078) I read in the same partial way — the loader, the turn steps
  and the out-of-order offer — not the other dozen steps of the review.
- **The entry page's panels at 320px, beyond the Details tab.** I did drive the three pages
  in Chromium with the sample packet and measured them at 320 × 760 (findings 9 and 10 came
  out of it), but only in the state the sample data puts them in: nobody mid-pick, no family
  with twelve offers in their History tab, no dialog open. The entry page's Interact and
  History tabs and every modal on it (`pickDialog`, `depositDialog`, `changePickDialog`,
  `undoPassDialog`, `restoreLostPupDialog`, `creditDialog`, the Move-place dialog) are
  unmeasured, and those are where the long content is.
- **The 5,000-character paste and the apostrophe pass** of recipe item 3. I read every
  `esc()` site on the three pages and found them sound, but I did not type a hostile value
  into a live form; K15's multi-line scanner is the right place for that.
- **The server half of finding 3.** `serverMoves`' UTC fallback for a kennel with no stored
  `time_zone` is named above because it is the other end of the same clock, but the Worker is
  K4's and I did not run it.
- **`waitlistEvents.js` beyond the turn-related ops.** I read `planFamilyEvent`'s pass, pick
  and prepass branches and `planServerEvent`'s `server_close` / `server_offer`, because those
  are the clock; the request-shaped ops (pause, pref change, listen, extras, pickup,
  back-out) are K7's and K8's and I left them.
