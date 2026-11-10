# K08 — Family requests, pickup, transport, fees, emails

Reviewed: `shared/data/familyExtras.js` (116), `familyPickup.js` (115), `pickupSlots.js` (149),
`transportFee.js` (51), `backOut.js` (112), `depositRequest.js` (66), `waitlistFeeLinks.js` (88),
`waitlistFeePay.js` (70), `waitlistEmails.js` (237), `waitlistOutbox.js` (185),
`waitlistReports.js` (350, the funnel and exits), `extraCharges.js` (369), `processingFees.js` (92);
assets `pickupTimesPanel.js` (118), `pickupTransportStep.js` (97), `waitlistFeeStep.js` (123, skimmed),
`waitlistEmailUI.js` (134), `messageComposer.js` (64), `paymentRequestUI.js` (204); and where they
lead: `waitlistActions.js` (`feeReceived`, `approveExtraRequest`, `approvePickupRequest`,
`applyPickupBoarding`, `approveBackOut`, `recordPick`'s carried deposit), `pages/waitlist-entry.js`
(the address approval and the back-out confirm), `assets/waitlistReviewUI.js` (Kels's address
form), `assets/pickToSend.js` (Review sale & send), `contractSend.balanceDueOn`, `incomeView.js`
(sale components, application fees, `paidOnSale`), `stripeLinks.js` / `integrationEvents.js` (the
payment-link half only), `nudges.js` (the request nudges), `cloud/cloudWaitlist.js`
(`sendQueuedEmails`, `measureHomes`, `drivingMiles`), `cloudApi.js` (errors, `getDistance`);
`cloud/src/geo.js` (87), `cloud/src/familyActions.js` (the extras / pickup / back-out checks,
`withMiles`, `handleAct`), `cloud/src/notify.js` (`ACTION_KINDS`, lines), `cloud/src/waitlist.js`
(`sendMessage`), `cloud/src/familyPages.js` (the pickup / back-out views),
`cloud/public/family/status.js` (fee, deposit, extras, pickup, back-out cards).
Contract read: Review Plan §0, §0a, K8; `docs/KennelOS_Family_Requests_Plan.md` (all); guide §21.1,
§21.2, §29 (Extras, Pickup, Backing out, Transport options email, Emails).
Verified by: baseline at `ff2ad6d` — `node --test` **1649 pass**, `cd cloud && npm test` **305 pass**,
`node build/assemble.mjs` succeeds (green; up from the plan's 1639 / 303). Two scratch suites in my
scratchpad on the in-memory Dexie (`tests/support/memoryDb.js`) driving the real repos and actions:
`k8_deposit_msg.test.mjs` (Review sale & send's message against `balanceDueOn` and the invoice lines)
and `k8_backout.test.mjs` (`approveBackOut` on paid-in-full and unpaid sales, the requests a back-out
leaves, a paid step rescaled). Mapbox was **not** called: its failure modes are traced through the
code (`geo.js` → `index.js` error handler → `cloudApi.readError` → the two forms' catch blocks).
No pages opened in a browser this session.

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S1 | shared/assets/pickToSend.js:290 | The deposit-request email's balance takes the deposit off twice once it's in, and says "Deposit: $500" when the family's page and the invoice say $450 | verified |
| 2 | S1 | shared/data/waitlistActions.js:1646 | Backing out of a sale with more than the deposit paid: Move carries only the deposit and keeps the rest as income, Refund wipes it all; the confirm names only "$500 deposit" | verified |
| 3 | S2 | shared/data/extraCharges.js:85 | Changing an extra's amount rescales its **paid** steps: the recorded payment changes and the last invoice under-asks | verified |
| 4 | S2 | cloud/public/family/status.js:281 | A family whose deposit moved is asked for the whole deposit again on their next turn: the carried payment never reaches their page | verified (code) |
| 5 | S3 | cloud/src/geo.js:32 | When Mapbox fails or refuses: what each path does (table), with jargon errors, no Open in Maps in Kels's form, and a home that's never measured again | verified (code) |
| 6 | S3 | cloud/src/geo.js:30 | Geocoding takes Mapbox's first match anywhere in the world, no country or nearby bias: a wrong town's miles go to the family and into the fee box | suspected |
| 7 | S3 | cloud/public/family/status.js:869 | After she decides a back-out the family never sees what happened to their deposit; the email sends them to a page that doesn't say | verified |
| 8 | S3 | shared/data/waitlistActions.js:1681 | A back-out leaves the family's waiting pickup and extras requests open: the time stays held, Today's Approve throws | verified |
| 9 | S3 | cloud/src/familyActions.js:39 | Pickup and extras dates are checked in UTC on the family page and the Worker; her dates are local. US evenings lose the last day | verified (code) |
| 10 | S3 | cloud/public/family/status.js:1037 | The application fee card shows two prices ($50 headline, "Pay $52.07 now") and never says the difference is a card fee | verified (code) |
| 11 | S3 | shared/data/cloud/cloudWaitlist.js:365 | A queued email goes out however old it is: an offer queued offline arrives days later with its old respond-by | verified (code) |
| 12 | S3 | shared/data/waitlistReports.js:26 | Reports count a family who backed out (keep / refund) as **Placed**, and their offer as Accepted | verified (code) |
| 13 | S3 | shared/data/waitlistActions.js:794 | Words: a moved back-out deposit reads "carried over from a pup they lost"; "still owed" on a paid, finished extra | verified |
| 14 | S4 | cloud/src/familyActions.js:322 | Booking the last place is a count then an insert with no hold; approving a time never re-checks its room | suspected |
| 15 | S4 | shared/assets/pickupTimesPanel.js:99 | Copy to another litter copies the times but not their date rules (Requires training, Standard boarding) | verified (code) |

## One family's money, end to end

The trail I followed, with what the family is shown at each step against what her records hold
(price $3,000, deposit $500, application fee $50 credited to the purchase, transport $200):

| Step | Family is shown | Recorded | Same? |
|---|---|---|---|
| Fee card, approved (`status.js:1037`) | **$50.00**, button **Pay $52.07 now** (card fee passed on) | `fee_amount` 50; paid online → `fee_paid_amount` 52.07, `fee_processing_amount` from Stripe; income = paid − kept | yes, but two numbers with no word (10) |
| Turn card / Sending your deposit (`status.js:278`) | deposit less credits: **$450** when the fee goes toward the deposit | sale deposit component 450 (`feeCreditSplit`) | yes |
| Review sale & send email (`pickToSend.js:293`) | **"Deposit: $500"**, balance **$2,450** | invoice: deposit $450, balance $2,500 | **no** (1) |
| Same email once the deposit is in | balance **$2,200** | invoice owed $2,700 | **no** (1) |
| Extras approved (`approveExtraRequest`) | name only (D1), price on her own web page | price list's price **at approval**, plan steps to the cent, last takes the rounding | by design; see notes |
| Own address approved (`approvePickupRequest`) | "about 48 miles", no fee (D1) | the fee box → `Sale.transport_fee`; on the invoice | yes |
| Standard boarding date | "Will result in boarding charges", no amount | rate × days from `pickupFrom` → deferred boarding, per Day | yes |
| Payment link (`paymentRequestUI.js`) | the owed amount less credits | Stripe one-time link for exactly that; fee from the report | yes |
| Backed out, Move | "Your request to back out of your puppy is approved" | `carried_payment` = deposit only | **no** when more was paid (2, 7) |
| Next turn after a Move | full deposit to send | the pick places them with the carried amount | **no** (4) |

## 1. The deposit-request email states the wrong balance, and the wrong deposit beside a credit  (S1, verified)

**Where** `shared/assets/pickToSend.js:290-302`:

```js
const balance = await balanceDueOn(sale);            // everything owed, less what's PAID
const rest = Math.max(0, balance - (Number(sale.deposit_amount) || 0));
… deposit: fmtMoney(sale.deposit_amount), … balance: rest > 0 ? fmtMoney(rest) : ''
```

`contractSend.balanceDueOn` (`contractSend.js:27`) already subtracts what's paid, the deposit
included, and already applies the fee credit to the deposit component. Taking `deposit_amount` off
again is right only when no deposit is in and no credit touches it.

**Scenario** (scratch `k8_deposit_msg.test.mjs`, the same three lines over the real repos):
- *The deposit is already in* — the usual case for a family whose deposit carried over (a lost pup
  or a back-out Move: `recordPick` → `confirmDeposit` places them at once), or when she taps Deposit
  received before Review sale & send. Price $3,000, deposit $500 paid, transport $200. The email:
  "Your deposit of $500 is already in, thank you. … **The balance of $2200 is due** when you pick up
  your puppy." The invoice PDF attached to the same email says $2,700 is owed. She is $500 short at
  pickup unless someone notices the two disagree.
- *Her application fee is credited toward the deposit* (`fee_credit_toward: 'deposit'`), $50. The
  family's status page has told them to send **$450** (`depositAfterCredits`). The email says
  "**Deposit: $500**, due by …" and "The balance of $2450". The ledger and invoice say deposit $450,
  balance $2,500. The totals agree; the deposit the family is told to send doesn't, and a Stripe
  link in the same email (`paymentAccount`, `pickToSend.js:274`) is made for `sale.deposit_amount`,
  so they're charged $500 for a $450 deposit and the $50 over is recorded nowhere.
- A credit for funds already received toward the deposit takes the same path (the deposit line is
  `sale.deposit_amount` whatever the credit), though I didn't run that one.

**Why it matters** This is the one message every family gets after picking, with the money in it,
and she sends it as written. The plan's rule makes a family-facing number that differs from the
record S1.

**What I'd do** Take the deposit and balance lines from `incomeLineItems` / `paidOnSale` the way the
invoice does (deposit = the deposit component's amount, balance = owed after it), and make the Stripe
link for the deposit component, not `deposit_amount`. A test that renders this message beside the
invoice's owed total for paid / unpaid / credited sales.

## 2. Backing out of a sale with more than the deposit paid  (S1, verified)

**Where** `shared/data/waitlistActions.js:1643-1646` (`depositIn`, `movedDeposit`), `:1661-1664`
(the status), `:1685` (`carried_payment`); the confirm in `pages/waitlist-entry.js:561-583` and
`backOut.js:105-108` (`backOutSummary`), both fed `Number(sale.deposit_amount)`.

**Scenario** (scratch `k8_backout.test.mjs`, real `approveBackOut`). Back out is offered for any
open sale (`isOpenSale`), and `paid_in_full` is open until delivery — a family usually pays in full
before pickup, which is when backing out over the pup's health or timing happens.
- Paid in full ($3,000 price, $500 deposit, $200 transport, balance paid). She taps **Move the
  deposit**. The confirm: "Cancel the sale and move their $500 deposit to another pup (they go to
  the end of the line)". Recorded: `carried_payment.amount` **500**; the cancelled sale keeps
  deposit 500 + balance 2,500 + transport 200 **earned** (`saleComponents`, a released sale keeps
  what was paid). Her Financials books $3,200 from a family whose next pup gets $500 of it. Nothing
  on the screen mentions the $2,700.
- Same sale, **More options… → Refund**. The confirm: "Their $500 deposit won't count as income.
  Record that you refunded it?" Recorded: voided, so `isLostSale` drops **all $3,200**; earned 0.
- Deposit **never paid** (`deposit_pending`), **Move**: the confirm still says "move their $500
  deposit … What they paid as a deposit goes toward their next pup." Nothing is carried
  (`depositIn` false) — the record is right, the screen isn't. Keep and Refund say the same about a
  deposit that was never received.

**Why it matters** Money she received is either silently kept as income or silently erased, while
the one line she reads before Approve names a different amount. With Move it's also what the family
will be told they have toward their next pup (finding 4).

**What I'd do** Work the confirm from what was actually paid (`paidOnSale` by component): "They've
paid $3,200: deposit $500, balance $2,500, transport $200", and let Move carry what she ticks (the
plan only ever discussed a deposit, so a paid balance is a decision for the owner: carry, keep, or
refund in part). Say "no deposit was paid" when none was.

## 3. Changing an extra's price rescales the steps already paid  (S2, verified)

**Where** `shared/data/extraCharges.js:85-90` (`cleanSteps`: every step's amount = percent × the
charge's amount); read on every load by `saleExtraCharges` → `cleanList`, and on the Sale page
(`pages/sale.js:351`), whose hint says "Changing an amount rescales its payments" (`:342`).

**Scenario** (scratch, `cleanSteps` + `incomeLineItems`). Puppy training $1,000, 50% at 8 weeks,
50% with the balance. The family pays the first $500 on Oct 28 (Paid on). In November she raises
the training to $1,200 on the Sale page (the family added a week). Now the paid step reads
**$600 earned on Oct 28** and the open step **$600 anticipated**. She received $500 and is owed
$700; the invoice's step line asks for $600 and her October income is $100 too high. Nothing warns
her. The family-facing invoice under-asks by $100.

**Why it matters** A payment that's been received has a fixed amount; the plan's "she can change any
date or amount" is about steps still to come.

**What I'd do** Freeze a step's amount once it has a `paid_date` and spread the change over the
unpaid steps only (refuse, with a sentence, when nothing is unpaid). A test that a paid step survives
an amount change.

## 4. A moved deposit is asked for again on the family's next turn  (S2, verified (code))

**Where** `carried_payment` is on the entry (`waitlistActions.js:1685`) but nowhere in the
projection (`waitlistProjection.js:278-301` publishes `deposit_amount` / `deposit_credit` /
`deposit_fee_credit` only; no `carried` anywhere in `waitlistProjection.js`, `familyPages.js` or
`status.js`). The family's turn card and **Sending your deposit** block (`status.js:278-296`) take
the deposit from the pup's listed deposit less `family.credits`.

**Scenario** The Lees back out at 5 weeks; her policy says Move; $500 carries. Months later their
turn comes. The offer email says "Please choose your puppy and send your deposit by …". The turn
card shows "Deposit: $600". They tap a pup on their page; until her device applies the pick the
page shows **Sending your deposit $600** with her payment instructions and the deadline. Her device,
on applying the pick, places them with the $500 carried (`recordPick`, `:792-801`) — by then they
may have sent $600. Same for a family whose pup was lost (`restoreAfterLostSale`), which shares the
field.

**What I'd do** Publish the carried amount as part of the family's credits (`creditsView`) so
`depositAfterCredits` subtracts it, and say on the turn card "Your $500 deposit from before goes
toward this pup".

## 5. When Mapbox fails or refuses: what the transport suggestion does  (S3, verified (code))

Driving miles are measured in three places. Every one degrades without throwing at the family and
without inventing a fee — **there is no silent zero**: no miles means no suggestion, never $0. But
the words she gets are repo jargon, Kels's form has no way to get the miles, and one path never
retries.

**How each failure reaches the code.** `geo.js` `geocode` / `drivingDistance`:
- no `MAPBOX_TOKEN` → `503 geo_off` (`:41`, `:58`);
- Mapbox answers non-2xx — token revoked (401), over quota / rate-limited (429), a query it refuses
  (4xx), Mapbox down (5xx) — → `502 geo_failed` (`:32`, `:45`), all one code;
- Mapbox unreachable (DNS, connection reset) or a 200 that isn't JSON → the `fetch` / `res.json()`
  throws a plain error → `index.js:102` answers `500 internal` (and logs the message);
- Mapbox hangs → no timeout in the Worker; her app gives up at 30 s (`JSON_TIMEOUT_MS`);
- the address geocodes to nothing, or there's no road (Directions answers 200 with no route, e.g.
  Hawaii) → `null` → `422 not_found`;
- her 61st lookup in an hour → `429 rate_limited` (`GEO_LIMITS.perHourPerProgram`).

**What each place does:**

| Place | No key (`geo_off`) | Revoked / quota / Mapbox 5xx (`geo_failed`) | Unreachable (500) or hang | Not found / no road (422) |
|---|---|---|---|---|
| **Family types their own address** (`familyActions.js:304-314`, `withMiles`) | not asked; request goes on with no miles | caught; no miles | caught; a hang holds their Send until the Worker gives up | no miles |
| …their page then says (`status.js:732`) | "[Kennel] will confirm the time and any transport fee." | same | same | same |
| …her Today nudge (`nudges.js:1240-1262`) | "Approve on their page with the day, time and transport fee"; **no Send transport options** (`far` unknown) | same | same | same |
| **Entry page, Get driving miles** (`waitlist-entry.js:669`) | "Couldn't measure: miles aren't switched on for KennelOS yet. Use Open in Maps and type the miles." | "Couldn't measure: **Cloud request refused (geo_failed).**. Use Open in Maps…" | "Couldn't measure: **Cloud backup answered 500.**. …" / "Could not reach cloud backup.." | "…the address wasn't found…" (also for "no road") |
| **Kels's Review my waitlist** (`waitlistReviewUI.js:533`) | "…miles aren't switched on yet. Type the miles instead." | "…Cloud request refused (geo_failed).. Type the miles instead." | same as the entry page | "…the address wasn't found…" |
| **Her device measures homes** during sync (`cloudWaitlist.js:399-427`) | stops for this sync; tried again next sync | stops; tried again next sync | stops | remembered as unmeasured (`home_measured_date`): never tried again |
| **Family says where they live** (`home_location`) | applied with `miles: null` → `home_measured_date` set (`waitlistEvents.js:251`, `setHomeLocation`) | same | same | same |

What's wrong in that table:
- **Jargon and a double stop.** `CloudRequestError`'s message is "Cloud request refused
  (geo_failed)." and the forms append ". Use…", so she reads "refused (geo_failed).. Use Open in
  Maps". A revoked token or a quota is the case most likely in practice now that the key is live, and
  it's the one with the worst words. "Cloud backup answered 500" talks about backups. Map
  `geo_failed`, `rate_limited`, `bad_address` and the offline errors to sentences ("The map service
  didn't answer. Use Open in Maps and type the miles.").
- **Kels's form has no Open in Maps** (`waitlistReviewUI.js:501-545`): D4b's fallback is "Open in
  Maps links on every … family's suggested place", and the entry page has one (`:628`), but in Kels
  she's told "Type the miles instead" with nothing to get them from.
- **A home answered while Mapbox is down is never measured.** The family answers "Where do you
  live?" during an outage; the event applies with no miles and sets `home_measured_date`, so
  `measureHomes` skips them for good and their page stops asking (`ask_home` needs no `home_place`).
  `ownPlaceAllowed` stays null: the family sees only her listed times, with no "Suggest a meetup
  place" and no explanation, until she opens their entry and picks by hand. What she's told is an
  activity line, "Said they live in Dallas, TX, on their status page." — not "couldn't measure".
  A failed measurement should leave `home_measured_date` empty (or be retried by `measureHomes`) and
  the activity line should say the miles are missing.
- **One outage code for all of Mapbox's refusals.** `geo_failed` lumps a refused query with a dead
  key, so `measureHomes` stops the whole sync at one family whose contact address Mapbox won't take
  (I believe Mapbox's forward geocoder refuses long queries; `cleanAddress` lets 300 characters
  through — suspected, not checked against Mapbox) and every later family waits behind them.
- The family-side rate limit (`wl-geo:<entry>`, 6 an hour) runs **before** their request is stored,
  so a 429 there refuses the request itself, not just the measuring (`familyActions.js:308`). Hard to
  reach, since one address request waits at a time; it would read as an error to them.

The "far" line has an edge: the Worker compares one-decimal miles (`d.miles > far_miles`), her quote
compares rounded miles (`transportQuote`: `m > far`), so a 150.4-mile address tells the family "will
be in touch about … a flight nanny" while her working says it's within range. S4 at most.

**Seam (one line):** her Transport accounts also feed the website's Getting your pup home page
through `siteExport.js` — the KennelPort plan's.

## 6. Geocoding takes the first match anywhere  (S3, suspected)

**Where** `cloud/src/geo.js:30`: `forward?q=…&limit=1`, no `country`, no `proximity`, no check of
Mapbox's match quality; the first feature's point is used.

**Scenario** A family types "Springfield" or "123 Main St" (the form asks for "an address, or a place
with its city", but nothing enforces the city). Mapbox returns its best guess, which can be another
state. The family's page says "That's about 1,240 miles from us. [Kennel] will be in touch about …
a flight nanny." Her form opens with 1,240 miles and, with no fee on the sale yet, the box prefilled
with the quote ($3,720 at $1.50 round trip); she approves unless she checks Open in Maps. I could not
run this against Mapbox, so it's suspected; the code takes whatever comes first.

**What I'd do** Pass `proximity` (her standard location's point, already geocoded in the same call)
and `country=us` or her country; ignore a match below "address"/"place" quality for an address, and
show "we couldn't place that exactly" instead of a number.

## 7. The family is never shown what happened to their deposit  (S3, verified)

**Where** `cloud/public/family/status.js:869-872` writes "Your puppy's sale is cancelled and your
deposit moves to another puppy…", but `back_out` exists only while the family has an open sale
(`waitlistProjection.js:189-191`, `familyPages.js:614`), and every approval cancels or voids that
sale. So the decided card is unreachable. After Keep or Refund their page says "You left the
waitlist. Contact the breeder if you would like to apply again." (`status.js:62`); after Move, the
ordinary waiting page. The email she's offered (`request_approved`) reads "We've approved your
request to back out of your puppy. Your status page shows the change." — whether the $500 was kept,
moved or refunded appears nowhere, and "approved your request" reads oddly when the answer is
"you forfeit".

**What I'd do** Carry the decided back-out on the family view for the 30 days the other decided
requests stay (as `requestView` already shapes it) whatever the sale's status; give the back-out its
own email wording per outcome.

## 8. A back-out leaves the family's waiting pickup and extras requests open  (S3, verified)

**Where** `approveBackOut` (`waitlistActions.js:1632-1696`) decides `back_out_request` only;
`pickup_requests` and `extra_requests` keep their undecided rows. `slotBookings`
(`pickupSlots.js:94`) counts every entry's undecided slot request against a time's room, and Today
lists every entry's pending requests (`nudges.js:1135`, `1208`, `1240`).

**Scenario** (scratch): the Lees asked for Dec 1, 10:00 (capacity 1), then backed out; she approved
Keep. Their entry is withdrawn, the request still waits. The Litter page's Pickup times shows the
time as **Requested** with no ✕ (`pickupTimesPanel.js:53`); every other family sees one less place
(no place at all for capacity 1). Today still shows "The Lees asked for 2026-12-01, …"; its
**Approve** throws "They have no open sale with a pup, so there's no pickup to plan." She has to
Decline, which offers a "We weren't able to approve your request" email to a family who's gone.

**What I'd do** Decline (silently, or as "closed when you backed out") the family's waiting pickup
and extras requests in `approveBackOut`, and skip them in `slotBookings` for an entry with no open sale.

## 9. Pickup and extras dates are UTC on the family's side  (S3, verified (code))

**Where** `cloud/src/familyActions.js:39` (`todayUtc`) used by the extras and pickup checks
(`:127`, `:164`, `slot.date > today`, `today <= change_until`, `open_until`); the family page's own
`todayUtc` (`status.js:680`) hides the buttons the same way. Her device works the dates out in her
local days (`changeUntil`, `requestWindow`), and the projection already carries
`kennel.time_zone`, which the turn deadlines use (`serverMoves.js:235`, `deadlineText`).

**Scenario** Her cutoff is 2 days: their Nov 30 pickup can change until Nov 28. At 5 p.m. Pacific on
Nov 28 it is Nov 29 in UTC: **Change time** and **Cancel pickup** are gone and the Worker answers
`too_late`. Tomorrow's pickup times disappear from every US family's page from late afternoon, and an
extra "available until Nov 21" can't be asked for on the evening of Nov 21. A family in the same town
as her reads a different day than she set.

**What I'd do** Use `localDay(projection.kennel.time_zone, now)` (familyPages already has it) in the
Worker and the kennel's zone on the page, as the turn deadlines do. A family in another zone reading
a pickup time: the times carry no zone ("10:00 AM"), which is right for a pickup at her place; worth
"(your breeder's time)" only on a drop-off far away.

## 10. Two prices on the application fee card  (S3, verified (code))

**Where** `status.js:1037-1041`: the headline is `fee.amount` ($50.00), the button
`Pay ${pay_amount}` ($52.07, `feeCharge` grossing up for "usually pass the fee on",
`waitlistFeePay.js:20`). At the end of the application (`fee_link_when: 'apply'`, `:1019-1023`) the
headline is the grossed **$52.07**, followed by "Or pay another way" with her instructions — where
the fee is $50.

**Scenario** A family sees "$50.00" in large type and a button "Pay $52.07 now", with no line saying
$2.07 is the card fee, and either thinks they're being overcharged or pays $52.07 by Zelle. When the
account's own payment link is a fixed-price Stripe link (no key on this device, so `feePay` falls back
to `account.payment_link`), the button says $52.07 and Stripe charges whatever that link is set to
(suspected).

**What I'd do** "Application fee $50.00 · paying by card adds $2.07" next to the button, and the
plain fee as the headline in both cards.

## 11. A queued email goes out however old it is  (S3, verified (code))

**Where** `waitlistOutbox.queuedEmails` / `cloudWaitlist.sendQueuedEmails` (`:362-391`) send every
`queued` message, oldest first, with the body as written when she approved it. Nothing compares its
age or its facts with the records now.

**Scenario** Monday she offers the Lees a turn and approves the "It's your turn! … send your deposit
by Wednesday, November 18" email; her phone has no signal for the next few days. Thursday it syncs:
the publish goes up, then the offer email — "respond by Wednesday" — arrives the day after the
deadline (whether the turn has closed by then is K6's clock). Same for a "request approved" about a
time she changed again before syncing. Duplicates are not a risk: the server keys sends by the
message id (`waitlist.js:308`), so a lost answer never sends twice.

**What I'd do** At send time, hold any email more than a day old (or whose `respond_by` has passed)
as "waiting for you: still send?" on the family's page instead of sending it.

## 12. Reports count a family who backed out as Placed  (S3, verified (code))

**Where** `approveBackOut` keeps `placed_sale_id` on a withdrawn entry (Keep, Refund:
`waitlistActions.js:1690`); `waitlistReports.funnelStage` returns Placed for any `placed_sale_id`
(`:26`); `daysToPlacement` counts it; the offer keeps `outcome: 'accepted'` with `backed_out_date`,
and `offerOutcomes` counts it Accepted.

**Scenario** Ten families placed this year, two backed out: the funnel says 10 placed, exits say 2
withdrew, and the same two are in both. Days-to-placement averages in sales that were cancelled.

**What I'd do** Treat an entry whose placed sale is cancelled/voided by a back-out as an exit
("Backed out") in the funnel, and an offer with `backed_out_date` as its own outcome.

## 13. Words  (S3, verified)

- A Move puts "Deposit: $500 carried over from a **pup they lost**" on the new sale
  (`waitlistActions.js:794`, `:935`) and "the deposit they carried over from a pup they lost" in
  the pick's activity line (`waitlistEvents.js:113`). For a back-out the pup wasn't lost; the
  breeder reading the sale later will think it was.
- The back-out confirm says "keep Puppy training (**still owed**)" for every unticked extra
  (`backOut.js:109`), including one fully paid and marked Done.
- "Couldn't measure: … miles aren't switched on **for KennelOS** yet" (finding 5): a breeder can't
  switch it on; say "Driving miles aren't available right now."
- `requestPhrase('back_out_request')` → "to back out **of your puppy**".

## 14. The last place in a time: a count, then an insert  (S4, suspected)

**Where** `familyActions.js:322-334` counts other families' unapplied `pickup_book` events, then
`:349` inserts; nothing holds the time in between (the plan's hold became "counted from the family
events", **Modified** in §9 step 5). `approvePickupRequest` (`waitlistActions.js:1561-1585`) creates
the placement without checking the time still has room.

**Scenario** Two families tap the last 10:00 within the same moment; both counts see 0; both are
stored. Both arrive on her Today as normal requests, and Approve on each puts two pups on one
capacity-1 time; the Litter page then shows both names on it. Rare, but nothing tells her.

**What I'd do** Check the room in `approvePickupRequest` (it has the litter and the events) and say
"this time is full: decline one or raise its places".

## 15. Copy to another litter drops the date rules  (S4, verified (code))

**Where** `pickupTimesPanel.js:99-100` copies `pickup_slots` with fresh ids; `pickup_date_rules`
stay on the first litter.

**Scenario** Her Dec 12 times require the Training package. She copies them to the sister litter;
there, Dec 12 is "Nothing extra", and any family can book it without the package.

**What I'd do** Copy each copied date's rule along, or say in the Copied message that the rules didn't.

## Notes, not findings

- **Extras are priced at approval.** `approveExtraRequest` copies the price list's amount on the day
  she approves (`waitlistActions.js:1463`), not the day the family asked from her web page's prices.
  That's the plan's ("copied from her price list, as today"), and D1 keeps prices off the server;
  worth one line in her price-list editor that a change reaches requests still waiting.
- **No silent zero fee.** `transportQuote` with no rate returns `fee: null` and "Set a fee per mile in
  Waitlist settings…"; with no miles neither form fills the box. The box value is what's saved, and a
  blank box leaves the sale's fee as it was (`waitlistActions.js:1596`).
- **Rounding is consistent.** `transportQuote` rounds the miles before the rate, so the working always
  adds up and the fee equals the text; `cleanSteps` and `planSteps` give the last step the rounding;
  `priceToNet` rounds up with an epsilon; `standardBoarding` is whole days × rate. Every amount is
  USD, formatted `en-US`, with no currency field anywhere in this area — fine while the app is US-only.
- **The outbox's duplicates and failures** are handled: one id per message, the server answers a resend
  with its first result, a 400/`not_published`/`no_email` marks that one failed with a sentence
  (`emailErrorText`) and **Retry** re-queues the same id; a 503/429 waits for the next sync.
- **A slot she removes after it's booked** can't be removed (the ✕ is hidden while it has a booking
  or a waiting request); one removed before an unapplied booking reaches her device is caught at
  Approve ("That pickup time isn't on the litter any more. Decline it…"). A removed or hidden
  *place* leaves a booked family's card with the time and the address from the event, no place name.
- `paymentRequestUI` for "both" makes a Stripe link marked `balance` for deposit + balance; the
  `reuse` test compares against `balance` so an open "both" link is reused correctly, and
  `planPayment` fills the deposit date when a balance payment lands first. Fine.
- `mailto:` bodies from `messageComposer` / Review sale & send can pass 2,000 characters with a
  contract link and photos; some desktop mail apps cut long `mailto:` URLs. Copy is there.
- `cloud/src/notify.js` has a line for every new action kind (`ACTION_KINDS`, `LINES`); nothing missing.
- A family's own address is never added to their contact (D15): kept on the request and the drop-off
  event only. Checked.

## Coverage gaps I found (tests that should exist)

- Review sale & send's message beside the invoice: deposit pending, deposit paid, fee credited toward
  the deposit, a received credit. (`tests/pickToSend.test.js` passes `balance` in as a string: the wording is covered, the number `pickToSend.js:291` works out is not.)
- `approveBackOut` on a `paid_in_full` sale and on a `deposit_pending` one, asserting what's carried,
  what's earned, and the confirm's summary. `cloudWaitlist.test.js:670` covers deposit_paid only.
- A paid step surviving an amount change (`extraCharges.test.js`).
- The family view after a back-out is approved (any outcome): today nothing asserts what they see.
- `withMiles` / `handleGeoDistance` with Mapbox answering 401, 429, 500, a thrown fetch and a 200
  with no route; and the app-side sentence for each (`cloud/tests/familyActions.test.js:303` covers
  no key, success and "nowhere" only).
- `slotBookings` after a back-out; the Worker's date checks at 23:30 in the kennel's zone.

## What I did not get to

- No browser walk this session: the family cards (fee, pickup, extras, back-out) at 320 px and the
  entry page's address dialog on a phone are unchecked; the findings above are from code and
  in-memory runs.
- Mapbox itself: no live call. Finding 6 and the "long query" note in 5 are what the code allows,
  not observed.
- `waitlistReports.js` beyond the funnel, exits and offers (Demand vs Supply, wait buckets).
- `waitlistFeeStep.js` read only for how it saves the account; the Stripe fee-link creation path
  (`ensureFeeLinks`, `checkFeePayments`) read, not run.
- Training stays ↔ pickup (`pickupFrom` after a stay) and the `training-stay` / `extra-due` nudges:
  read in passing, not exercised.
