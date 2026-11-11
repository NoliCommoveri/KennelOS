# K06b — Picks preview, side sales and the undo windows

Reviewed: `shared/data/picksPreview.js` (309), `shared/assets/picksPreviewModal.js` (457),
`shared/assets/sideSaleUI.js` (180); what `4dfe76f..0328a3f` added to
`shared/data/waitlistRules.js` (side sales `:485–600`, undo windows `:1374–1425`),
`shared/data/waitlistActions.js` (undos `:179–360`, side sales `:880–1032`, `openPicks`
`:615`), `shared/data/waitlistProjection.js` (`:528–560`), `shared/data/nudges.js` (the
waitlist block), `shared/pages/waitlist-entry.js` (side-sale card `:2003–2075`, undo
buttons), `shared/pages/waitlist.js`, `shared/assets/waitlistPicksPanel.js`,
`shared/assets/litterCheckinUI.js`, `shared/pages/today.js`; the Worker's side
(`cloud/src/serverMoves.js` 100–300, `cloud/src/familyPages.js` `publicRows` and
`statusView`, `cloud/src/familyActions.js` `checkAction` / `handleAct`). For the turn rules
the spec didn't list: `tidyRules.js` / `tidyUpUI.js`, `rosterCount.js`, `waitlistReview.js`,
`reportSources.js`, `waitlistEvents.js` (`planFamilyEvent`, `planServerEvent`),
`familyExtras.familySale`, `waitlistFeePay.js`, `waitlistFeeLinks.js`.
· Contract read: `docs/KennelOS_Picks_Preview_Spec.md` (all, §9), `docs/KennelOS_Side_Sale_Spec.md`
(all, §9 and "Modified"), guide §29 "Undo windows" and "Leaving releases turns".

Verified by: **reading only.** This session could not attach KennelOS (the `add_repo` call
was refused) and running anything from the read-only clone was refused too, so no
`node --test`, no scratch harness and no browser run. The baseline is therefore **not
re-checked** here (last recorded green: 1649 / 303 at `f4411bf`, K06). Every finding below
is traced line by line through the code and labelled **verified (code)**, the label K09 and
K12 use for the same thing, or **suspected** where it depends on timing or on Stripe's
behaviour. Code reviewed at `3d184c8` (main on 2026-11-11). None of the files above changed
between `0328a3f` and `3d184c8`.

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S2 | shared/data/waitlistActions.js:268, :303, :313 | A family that leaves the list keeps its pending side sale: the pup stays held and the deposit still places them | verified (code) |
| 2 | S2 | shared/data/waitlistActions.js:1003 | A side sale's deposit can empty another family's open turn, which then lapses as a counted pass | verified (code) |
| 3 | S2 | shared/data/tidyRules.js:165 | Kels's Tidy up offers to mark a side-sale pup Placed, which takes it off every turn and cancelling can't put it back | verified (code) |
| 4 | S2 | shared/data/waitlistRules.js:1403 | "Undo fee received" is offered while a side sale is pending, so an unpaid family can be placed | verified (code) |
| 5 | S2 | shared/data/waitlistActions.js:229 | Undoing a fee paid through Stripe doesn't stick: the next payment check records it again | verified (code); refund case suspected |
| 6 | S3 | shared/assets/picksPreviewModal.js:262 | The preview's "When it ends, next in line" sentence changes with the Either switch and the view | verified (code) |
| 7 | S3 | shared/data/waitlistActions.js:74 | Undoing a decline can't see that the family re-applied, so the same family ends up with two open applications | verified (code) |
| 8 | S3 | shared/data/waitlistFeePay.js:58 | After "Reopen application", a fee they paid online meanwhile is stranded, and the page tells her to refund it | verified (code) |
| 9 | S3 | shared/assets/picksPreviewModal.js:77 | A tap outside the preview drops unsaved settings without asking; no Escape, no focus handling | verified (code); phone layout suspected |
| 10 | S4 | shared/data/waitlistEvents.js:300 | A server-made turn can land on a family with a pending side sale; their side deposit then voids it and nothing moves on | suspected |

---

## Side sales and the turn rules: the proof

What I traced for item 1 of the session. "Offers only" means the rule reads
`waitlist_offers` rows, and a side sale never writes one (`recordSideSale`,
`waitlistActions.js:888`, writes a Sale, the dog and an activity line).

| Rule | How it treats a pending side sale | Where |
|---|---|---|
| `openTurns` | offers only: invisible ✓ | `waitlistRules.js:1111` |
| `nextTurn` | the family: skipped (exception 1). An **unheld** pup stays available; a **held** one is off, as the spec says ✓ | `:1145`, `:946–951`, `:493` |
| `turnSpent` | offers only ✓ | `:1024` |
| `joinsOpenTurn` | the family is skipped like an ineligible one (exception 1), so a new litter can join a lower holder's turn while they wait. Once the side sale ends they're first for that litter, because their turn on it was never spent. Consistent ✓ | `:1159` |
| `hasOpenOffer`, `nextFamilyForLitter` | offers only ✓ | `:975`, `:1028` |
| Automatic offers | no side-sale path calls `moveTurnOn`: `confirmSideDeposit` passes `moveOn: false`; `cancelSideSale` and `resolveOtherClaims`' cancel don't move on ✓ | `waitlistActions.js:965`, `:973` |
| Pass counting | offers only; a cancel writes no offer row ✓ | `:1356–1372` |
| `litterQueue`, `soonFamiliesForLitter` | exception 1. An unheld side pup still counts as a slot, so "almost your turn" can reach one family more than will get a pup if the side sale completes (a note) | `:958`, `:1216` |
| `autoOfferSummary` | wording only ✓ | `:250` |
| `waitlistReview`, `rosterCount` | don't read sales ✓ | — |
| **`tidyRules` pup-placed** | **sees it**: **finding 3** | `tidyRules.js:165` |
| Reports | `isPlacedSale` counts a pending side sale as placed, as it already does a pending turn pick (a note; K10's area) | `reportSources.js:36` |
| Today | overdue side deposit and "Two sales" nudges; Open picks via `depositsDueLitters` (`isPupAvailable`) ✓ | `nudges.js` |
| Kels's check-in, Today's Open picks, Review my waitlist | all through `openPicksFromCheckin` → the preview ✓ | `waitlistPicksPanel.js:102` |
| Worker `openTurns` / `nextFromQueue` / deadline close | skip `direct` rows. `nextFromQueue` also skips any family with a row, and `turn_queue` leaves them out ✓ | `serverMoves.js:108`, `:139`, `:266` |
| Worker reminders | include `direct` rows (`includeDirect`), as the spec says ✓ | `serverMoves.js:289` |
| Public list "Currently deciding" | ignores `direct` rows ✓ | `familyPages.js:298` |
| `direct` reaching a family | `statusView` copies offer rows field by field and `direct` isn't one of them ✓ | `familyPages.js:653–681` |

**The two deliberate exceptions are the only ones**, apart from Tidy up (finding 3) and the
gap in finding 2 (a side sale ending another family's turn). **"Pending" doesn't end on
every path:**

- It ends on: the deposit (`confirmSideDeposit`), a cancel (hers, or Today's nudge), the
  other claim winning (`resolveOtherClaims`), a back-out (`approveBackOut` cancels it through
  `ownSale`).
- It doesn't end on: a withdrawal, a removal, an archive or a no-answer removal
  (**finding 1**), or an undone fee (**finding 4**).

**"No difference anywhere" to the family:** the projection row has the turn row's shape
(`waitlistProjection.js:551–556`) and `place_hidden: turn`. The Worker never shows `direct`.
Reminders go out as for a pick, and the deposit-request message comes from the same
`openPickToSend`. Nothing leaks. In the other direction, her own record keeps that the sale
was out of order: the side-sale card, `side_*` on the sale, and the activity lines from
record and cancel. A deposit leaves no activity line, but the sale keeps `side_entry_id`.

---

## 1. A family that leaves the list keeps its pending side sale  (S2, verified (code))

**Where** `withdraw` (`waitlistActions.js:268`), `removeForNoReadyAnswer` (`:294`),
`removeByBreeder` (`:303`) and `archiveEntry` (`:313`) all end through `releaseOpenOffers`
(`:686`). That function looks only at `waitlist_offers`, and a side sale has none.
`confirmSideDeposit` (`:954–966`) loads the entry without checking its status.
`sideSaleHtml` (`waitlist-entry.js:2003`) draws the side-sale card whatever the status.

**Scenario** She records a side sale of Willow to the Parks. Willow was on Keeping, so the
sale holds her (`side_holds_pup: true`). Two days later the Parks tap **Leave the list** on
their status page. The Worker records a `leave`; `serverMoves` finds no turn of theirs (it
skips `direct` rows), so nothing moves. Her device applies it as `withdraw`. The Parks are
`withdrawn`, but the sale is still `deposit_pending`, and Willow is still Available and held:
`isPupAvailable` says no, so she's on nobody's turn and on no online list. The same happens
when she taps **Remove them from the list** herself, or archives the entry. Nothing tells her
until the deposit date passes and the overdue nudge appears (`nudges.js`, which still counts
withdrawn entries). If she taps **Deposit received…** on the card that's still showing, a
withdrawn family becomes `placed`.

**Why it matters** For a turn pick the same moment cancels the pick's sale (`releasePick`), so
the pup comes back at once. A side sale held this way keeps a pup off every family's turn for
days, and it's the pup she pulled from Keeping to sell, the one she most wants sold.

**What I'd do** Have `releaseOpenOffers`' four callers also cancel the family's pending side
sale (`cancelSideSale`, which already puts a held pup back). Have `confirmSideDeposit` refuse
an entry that isn't `active`.

## 2. A side sale's deposit can empty another family's open turn  (S2, verified (code))

**Where** `resolveOtherClaims` (`waitlistActions.js:996–1031`) ends only **picks** on the pup
(`o.chosen_dog_id === dogId`, `:1003`). It never re-checks an open turn that lists the pup but
hasn't picked yet.

**Scenario** Litter B has one available pup, Max. The Ortegas hold the turn on B, with
`eligible_dog_ids: [Max]`. Before they pick, she records a side sale of Max to the Parks; Max
was Available, so the sale doesn't hold him, as §2 says. The Parks pay first.
`confirmSideDeposit` places Max. `resolveOtherClaims` finds no pick and does nothing. The
Ortegas' turn stays open with no pup in it; this is K06 finding 1's empty turn. At the
deadline it closes as no response. That is a pass by default (`no_response_counts_as_pass:
true`), and the Worker closes it by itself when `no_response` is ticked. Either way their
turn on B is spent, although they never had a pup to choose.

**Why it matters** K06 finding 1 is the general bug. Side sales are a new way into it, and
this way is **designed**: §2 keeps an unheld pup in the turn family's list while a side sale
is pending. Spec §5 decided what happens to a turn **pick** in this race, and
`resolveOtherClaims` already holds the void-with-no-pass logic. It just only runs for picks.

**What I'd do** In `resolveOtherClaims`, also walk open turns whose `eligible_dog_ids`
include the pup, and run the same "anything left?" check (`:1012–1019`) for them. Report it
in `resolved` so the deposit dialog can tell her.

## 3. Kels's Tidy up offers to mark a side-sale pup Placed  (S2, verified (code))

**Where** `pupPlacedFindings` (`tidyRules.js:165–170`) flags every puppy whose disposition
isn't `placed` and that has any unreleased sale, so a `deposit_pending` side sale counts.
`tidyUpUI.pupPlaced` (`tidyUpUI.js:258`) asks "Mark them Placed?" with **Yes, mark Placed** as
the primary button. `cancelSideSale` (`waitlistActions.js:981–986`) restores the old
disposition only when the dog still reads `available`.

**Scenario** Willow is Available with an unheld side sale to the Parks, and still on the
Ortegas' turn. Kels's Tidy up says *"Willow has a sale to the Parks (Deposit pending), but
their plan says Available. Mark them Placed?"* She taps yes. Willow is `placed`, so
`isPupAvailable` drops her from the Ortegas' turn and every online list. The turn rules now
**see** the side sale, the one thing the spec says must not happen. If the Parks then back
out and she cancels, the sale ends but Willow stays `placed` with no live sale. The
waitlist never offers her again and `sideSaleBlocker` refuses another side sale on her. If
the pup was held from Keeping, the same tap loses the "goes back to Keeping" restore.

**Why it matters** The spec named `tidyRules` as one of the rules that must ignore side
sales. A pending turn pick hits the same prompt, but a pick lasts days; a side sale's
deposit date is hers to set, so the prompt has longer to come up.

**What I'd do** Skip pups whose only live sale is `deposit_pending` (side or pick) in
`pupPlacedFindings`, or ask only once the deposit is in.

## 4. "Undo fee received" is offered while a side sale is pending  (S2, verified (code))

**Where** `canUndoFeeReceived` (`waitlistRules.js:1401–1406`) blocks the undo only on an
**offer** row. The entry page offers the button from it (`waitlist-entry.js:2094`).
`confirmSideDeposit` (`waitlistActions.js:958`) doesn't check the entry's status.

**Scenario** She marks the Parks' fee received on Monday and records a side sale of Willow
to them on Tuesday. On Wednesday she taps **Undo fee received…** ("Fee marked received by
mistake? You can undo it … until they're offered a turn"). They are `approved` again, with
no fee received, while the side-sale card still shows. Their status page still shows the
turn card, because `live` in `buildProjection` (`waitlistProjection.js:472`) is every entry
and `statusView` shows offers to `approved`. When their deposit arrives, **Deposit
received…** places a family who never paid the application fee and was never on the list.

**Why it matters** The rule says "not once the list has acted on their place". A side sale
is the list acting on it. K10 noted the money side of this undo ("allowed while a side sale
waits on its deposit, since a side sale has no offer") and found the money right. The list
status is what goes wrong.

**What I'd do** Add `!sideSaleOf(entry, sales)` (and any sale with `side_entry_id ===
entry.id`) to `canUndoFeeReceived`, and pass the sales from the page.

## 5. Undoing a fee paid through Stripe doesn't stick  (S2, verified (code); refund case suspected)

**Where** `checkFeePayments` (`waitlistFeeLinks.js:62–87`) records an online fee through
`feeReceived`, which sets `fee_received_manual: true`. That is exactly the flag
`canUndoFeeReceived` treats as "she marked it by hand". `undoFeeReceived`
(`waitlistActions.js:229`) clears `fee_payment_reference`. That field is `planFeePayment`'s
only "already recorded" key for an approved entry (`waitlistFeePay.js:58`). `paidSessions`
lists the link's recent paid sessions every time it runs.

**Scenario** A family pays the $100 fee by her Stripe link. On the next app load
`checkFeePayments` puts them on the list. Their entry now shows **Undo fee received…**
("marked received by mistake?"), although nobody marked anything. Say she undoes it because
the application was a duplicate and she refunded it in Stripe. They're `approved`, the
reference is gone, and the next boot check (`bootStripeCheck`) sees the same paid session.
`planFeePayment` finds no matching reference, returns `received`, and they are back on the
list at their old place with a fresh 7-day undo. Whether a refunded Checkout Session still
reads `payment_status: 'paid'` I couldn't check here (suspected; I believe Stripe leaves it
`paid`). Without a refund, the undo is undone on the next check anyway.

**Why it matters** She is told she can undo, and the undo quietly reverses itself. That is
the "history saying something that didn't stick" case.

**What I'd do** Don't offer the fee undo when the fee came from Stripe (set
`fee_received_manual` only from the hand-entered paths, or check `fee_paid_via_account_id`).
Or keep the reference through the undo (e.g. in `fee_paid_online`) so the next check skips it.

## 6. The preview's "next in line" sentence changes with the Either switch and the view  (S3, verified (code))

**Where** `actionHtml`'s `nextAfterHolder` (`picksPreviewModal.js:262–266`) builds the top
sentence for `wait` and `held` from `p.turnOrder`. `turnOrder` is computed from `seen =
withEitherAs(entries, eitherAs)` and from `shown`, which is only this litter in the `alone`
view (`picksPreview.js:192`, `:200–211`).

**Scenario** The Ortegas hold the turn on Litter A. She previews opening Litter B, whose only
pups are male. The top line says *"This litter waits. … When it ends, next in line: #1 the
Lees (B only), then #2 the Parks (A and B)"*. The Lees said Either. She taps **Take females**
to see the Either split, and the top line now says *"next in line: #2 the Parks"*. The Lees
have vanished from what will actually happen. Tapping **If earlier litters finish first**
changes the same sentence again. Separately, a family whose only litters are ones they said
"Not this litter" to is listed as next with an empty list, *"#3 the Kims ()"*, though their
turn would be passed at once.

**Why it matters** Spec §5.4: "The §5.1 sentence is always 'as they said' (it's what will
actually happen)." `action` itself is computed correctly (`simulateOpen` never sees the
switch). Only this follow-on sentence borrows the display-only order. Every other
preview/`openPicks` comparison I built agrees; see the table below.

**What I'd do** Compute the "next after the holder" list inside `simulateOpen` (combined,
stated), or from `previewPicks(data, { litterId, today })` with the defaults. Leave out
families whose `litters` is empty, or name them as auto-passed.

## 7. Undoing a decline can't see that the family re-applied  (S3, verified (code))

**Where** `assertNotReapplied` (`waitlistActions.js:73–79`) returns at once when the entry
has no `contact_id`. A contact is only created or linked at `approve` (`:108`), so a declined
application, and a withdrawn `applied` one, normally has none.

**Scenario** She declines the Kims' application on the 1st. On the 3rd they apply again
through her form (a new entry, also with no contact). On the 5th she taps **Undo decline** on
the old one. The check passes, and both applications are `applied` side by side. If she
approves both, the same family is on the list twice. Guide §29 says each undo "is refused once
they've re-applied".

**What I'd do** When there's no contact, match on the application's email
(`entryEmail`), the way the do-not-sell check matches.

## 8. After "Reopen application", a fee they paid online meanwhile is stranded  (S3, verified (code))

**Where** `planFeePayment` (`waitlistFeePay.js:58–68`) stores a fee paid on an `expired`
entry as `fee_paid_online` (op `prepaid`), and from then on skips that session as `already`.
`undoExpire` (`waitlistActions.js:256`) reopens to `approved`, but only `approve` (`:132`)
ever applies `fee_paid_online`. The entry page (`waitlist-entry.js:220–222`) then says
*"Fee paid online … They aren't on the list: refund it in your payment service if it's owed."*

**Scenario** She marks the Lees' fee not received in time on Monday. They pay by the link
that evening. On Tuesday she taps **Reopen application**. The Lees are `approved` with their
fee sitting on the entry. Nothing puts them on the list, Today soon asks her to mark them
expired again (the pay-by date is past), and the page advises a refund to a family she just
reopened.

**What I'd do** In `undoExpire`, apply `fee_paid_online` the way `approve` does. At least,
word the line for `approved` as "mark the fee received".

## 9. A tap outside the preview drops unsaved settings without asking  (S3, verified (code); phone layout suspected)

**Where** `picksPreviewModal.js:77` closes on any overlay tap, and `state.draft` goes with
it. There is no Escape handler and no focus moved into or back out of the dialog. Every
settings change redraws the whole modal (`changed` → `draw`, `:114–120`, `innerHTML`), which
also drops keyboard focus. The tables (`table.data`, three columns, a line per family under
every pup) aren't wrapped in a scrolling box.

**Scenario** On her phone she changes days to pick and pay from 3 to 5. The preview marks it
**Unsaved settings**. She scrolls up to look at the turn order and her thumb lands on the dim
edge. The modal closes, the change is gone, and nothing said so. Save and Cancel both work as
the spec says: Save writes at once and survives Cancel, and an unsaved draft disables **Open
picks now**. Only this third way out loses work. With 12 pups and 60 families, the pups
section repeats up to 60 names under each pup. I couldn't open it at 320 px (see the top of
this file).

**What I'd do** Ask before closing when `state.draft` is set. Add Escape. Wrap each table in
the app's scroll box.

## 10. A server-made turn can land on a family with a pending side sale  (S4, suspected)

**Where** `planServerEvent`'s `server_offer` branch (`waitlistEvents.js:294–318`) checks
status, open turns and pup availability, but not `sideSaleOf`. `confirmSideDeposit`
(`waitlistActions.js:965`) calls `releaseOpenOffers(…, { moveOn: false })`.

**Scenario** She records a side sale for the Parks while her phone is offline. The published
`turn_queue` still lists them. The family holding the turn passes online, `passed` is ticked,
and the Worker offers the Parks the next turn. Her device applies it, so the Parks hold a turn
and a side sale at once, the state the "Modified" note rules out. When their side deposit
arrives, their turn is voided (not a pass) and **nothing moves on**, so with automatic offers
on, nobody holds the turn and nobody is told.

**What I'd do** Refuse the server offer in `planServerEvent` when `sideSaleOf(entry, sales)`
(it becomes a line for her). In `confirmSideDeposit`, move on when `releaseOpenOffers` voided
anything.

---

## The picks preview against `openPicks`: what I built

Each case traced through `simulateOpen` (`picksPreview.js:120`) and through
`openPicks` → `offerNextTurn` / `joinsOpenTurn` (`waitlistActions.js:540`, `:615`).

| Case | Preview | `openPicks` | Agree? |
|---|---|---|---|
| A paused family at #1 (by her, or a readiness hold) | `nextTurnOn` → `turnLittersFor` → `eligiblePupsFor` → skipped | same functions | ✓ |
| A listen-list family who doesn't listen for this sire | `isListeningFor` in `eligiblePupsFor` | same | ✓ |
| #1 pre-passed on everything open | auto-passed, counted on row 0, removed at the limit, list goes on | `autoPassTurn` the same, reloading each loop | ✓ (the sim keeps the prepasses on the entry; `turnSpent` on the passed rows has the same effect) |
| Pre-passed split (offer A, prepass B) | `offer` with `prepassed: [B]` | `makeTurn` with the same split | ✓ |
| A side sale in flight (family) | excluded (`sideSaleOf`) | excluded | ✓ (both read every sale for this kennel's pups) |
| A side sale in flight (unheld pup) | offered, with a **Side sale pending** line | offered | ✓ |
| A turn open, holder top for B | `join`, restarts the deadline | the same, overwriting an extension | ✓ agree (K06 finding 2 is the overwrite) |
| A turn open, holder pre-passed B | `wait`, `prepass_blocked` | returns null | ✓ |
| Settings changed in the modal, then Cancel | the draft only feeds the preview; **Open picks now** is disabled while there's a draft | never sees it | ✓ (but see finding 9 for losing it) |
| Settings saved in the modal, then Cancel | written by `kennelRepo.update` at **Save** | the next Open picks reads them | ✓ kept, as §5.7 says |
| Records changed on another device | **Open picks now** recomputes `action` on fresh data and stops if it differs | — | ✓ |
| "Next in line" after the holder | from the Either- and view-dependent order | — | ✗ **finding 6** |

## The five undos, after the world moved on

| Undo | Restores | Can't restore | Window | Notes |
|---|---|---|---|---|
| Removal (`undoRemoval`) | `active`, same anchor; a second pass forgives one counted pass; no-answer asks again from today | a voided turn's pick (its sale was cancelled); turns given to others meanwhile. They're just next again (one turn at a time), so no place that was given away comes back | `removed_date` + 7, inclusive | a pending side sale survives removal (**finding 1**) |
| Withdrawal she entered (`undoWithdrawal`) | `withdrawn_from` | same as removal | `withdrawn_date` + 7 | an `applied` one has no re-apply check (**finding 7**) |
| Decline (`undoDecline`) | `applied` | — | `declined_date` + 7 | **finding 7** |
| Fee expired (`undoExpire`) | `approved`, the old pay-by date (past) | a fee paid online meanwhile (**finding 8**) | `expired_date` + 7 | Today asks to expire again, as documented |
| Fee received (`undoFeeReceived`) | `approved`, fee fields cleared | a Stripe fee (**finding 5**) | `fee_received_at` (a UTC timestamp, sliced) + 7 vs local `today`: up to a day longer in the Americas (a note) | blocked by an offer but not by a side sale (**finding 4**) |

Undoing an undo: each undo clears the date it counts from, so doing it again starts a fresh
window. No undo writes an activity line, and none of the undone actions wrote one, so no
history line is left saying something that didn't stick. Finding 5 is the one where the
**record** reverts by itself. After a sync, every `canUndo*` is worked out from fields on the
entry, so it follows whatever sync last wrote.

## Notes, not findings

- **A back-out on a side sale** (`approveBackOut`) cancels it through `ownSale`, but doesn't
  put a held pup back to its `side_prior_disposition` (only the Available / Health hold
  choice), and **Move** sends the family to the end of the line (`position_anchor_date:
  date`). The spec's §4 says "the family keeps their place". The "Modified" note says
  back-outs work as after a turn pick, so this is as built, but the two spec lines now
  disagree.
- **`offerTo`** (`waitlistActions.js:586`) still opens picks on an unopened litter without
  the preview. She chose the family, so it's arguably fine, but it is a way past "every Open
  picks goes through the preview".
- **The preview captures `today` when it opens.** Opened at 23:58 and tapped at 00:01, it
  stamps yesterday as `picks_opened_date` and counts the respond-by from yesterday.
- **`soonFamiliesForLitter`** counts an unheld side-sale pup as a slot while the side family
  isn't in the queue, so "almost your turn" may go to one family too many.
- **The website seam** (one line, per the plan): under the new contract ("an open sale is
  Placed"), an unheld side-sale pup will read Placed on her website while the turn family can
  still pick it on their status page.
- Answers changed by **Also update their answers to match** are logged: `waitlistEntryRepo.update`
  writes `pref_change_log` by itself (`:110`).
- `sideSaleDialog` warns about a second claim inline ("What doesn't fit") rather than with
  the spec's separate confirm. That's fine; the warning is there before she records it.

## Coverage gaps I found (tests that should exist)

- `withdraw` / `removeByBreeder` / `archiveEntry` on a family with a pending side sale (held
  and unheld): the sale cancelled, the pup restored.
- `confirmSideDeposit` on a pup listed in another family's open, unpicked turn, with it as
  that turn's only pup.
- `pupPlacedFindings` skipping a `deposit_pending` side sale.
- `canUndoFeeReceived` with a pending side sale; `checkFeePayments` after `undoFeeReceived`.
- `undoDecline` after a re-application with no contact.
- `picksPreview`: the `wait` follow-on list unchanged across `eitherAs` and `view`.
- `planServerEvent('server_offer')` for a family with a pending side sale.

## What I did not get to

- **Anything that runs**: the baseline, the existing `picksPreview` / `waitlistSideSale` /
  `waitlistUndo` suites, scratch harnesses, and the modal and side-sale dialog at 320 px with
  12 pups and 60 families. Each finding above names the exact path, so a session that can run
  code can turn every "verified (code)" into a run in a few minutes, starting with 1, 2 and 3.
- The page recipe (§0a) on the side-sale card and dialogs past the escaping, which I checked:
  every user value goes through `esc()`.
