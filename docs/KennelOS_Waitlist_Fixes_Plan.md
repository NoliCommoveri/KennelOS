# KennelOS — Waitlist fixes and three enhancements (plan)

> **Status: steps 1–3 built** (`docs/BUILD_LOG.md`, 2026-11-11); steps 4–10 not started. Written 2026-11-11 from the four waitlist reviews (K6, K6b,
> K7, K8: `docs/review/findings/`) and three requests from the owner the same day. It lists
> every finding with what happens to it, designs the three enhancements, and puts both into
> one build order. The owner answered the decisions that shape the enhancements the same day
> (§2); five about the fixes are still open, each with a recommendation the plan assumes.
> Baseline when written (`dac8d17`): `node --test` 1649 pass, `node build/assemble.mjs` succeeds.

## 1. What this plan covers

**The three enhancements** (the urgent part):

- **E1. "Pup selected".** A family that had its turn, picked a pup and paid the deposit stays
  on the list where it was, marked **Pup selected**, and keeps its number until the pup goes
  home, so nobody behind it is ever pushed back when a pup is lost.
- **E2. "Already Reserved".** The pup they bought stays on the litter's Available Puppies card,
  on the public list page and on every family's status page, in a second section,
  **Already Reserved**, under **Still Available**. Both sections show Males and Females in
  columns. A reserved pup never appears where a family on its turn picks.
- **E3. A family page without the list.** For a litter sold before she used the app: its
  families get a status page (pickup times, the puppy portal link, extras, her messages)
  without ever being on the waitlist. They show on no list. The litter shows on no waitlist
  page. Only those families know it's there.

**The findings:** 52 across the four reviews (S1: 3, S2: 12, S3: 30, S4: 7), plus the notes
worth acting on. §5 lists every one.

**How they meet.** The enhancements change four rules the reviews looked at: what happens
when a pup leaves the available set (K6-1, K6b-2), who counts as placed (K8-12, K8-7), which
litters the waitlist shows (K6-12, three copies of one list), and how a family's number is
worked out (K6 found it stable across every reader but one, K6-5). Those fixes go first or
in the same step, so the new features are built on one rule each, not on a fourth copy.

## 2. Decisions

**Decided by the owner (2026-11-11):**

| # | Question | Decision |
|---|---|---|
| D1 | E1: does a "Pup selected" family keep its number? | **Yes: the number is held.** Her worry is a family told "you're #5" who becomes #6 when a pup dies or goes on Health hold and its family comes back into line. So a family with a pup selected keeps its place and its number, and everyone behind is numbered after it. When the lost-pup family comes back, nobody's number changes. A tick may show with the number or in its place. |
| D2 | E1: how long does it hold? | **Until the pup has safely gone home:** the sale is marked Delivered (picked up) or the pup is turned External. Then the row goes and the families behind move up one. |
| D4 | E2: which pups show under Already Reserved? | **Pups whose disposition is Placed.** A waitlist deposit sets that by itself (`confirmDeposit`, `confirmSideDeposit`). A sale made by hand on the Sale page only asks ("Update this dog's disposition?", defaulting to Placed), and Tidy up asks again later, so there it is her answer. |
| D5 | E2: the same rule as her website? | **Yes.** The website also works from the pup's disposition (`siteExport.puppyStatus`: Placed → placed), not from the sale. Family pages use the same rule, worded **Already Reserved**. As on the website, a pup that has died or gone home (External) isn't listed. |
| D6 | E3: where does she find these families? | **Their own section on the Waitlist page**, with the other sections, not inside Closed. |
| D7 | E3: do the two new fields sync between her devices? | **Yes: `cloud`** for `WaitlistEntry.off_list` and `Litter.waitlist_off`. |
| D8 | E3: a family page family backs out, or loses its pup | **Keep or Refund only**, never "Move the deposit", and no "put them back in line". To join the list they apply. (Read from the owner's last answer, "Yes".) |

**Still open** (each is assumed as recommended until the owner says otherwise):

| # | Question | Recommendation |
|---|---|---|
| D3 | E1: what does the row show? | The name as it was listed (private names stay masked) and **Pup selected** in the Wants column. Never the pup's name, the date or the price. Her own Waitlist page may name the pup. |
| D9 | K8-2: a family backs out after paying more than the deposit. Today Move carries only the deposit and Refund erases everything. | Show what was paid by part, and let her tick what carries or is refunded. The policy (carry, keep, refund in part) is hers. |
| D10 | K7-5: which policies did a family agree to? | Seal the `policies_updated` day into each application and keep earlier wordings when she saves. Needs her yes: it stores more. |
| D11 | K6-3: whose clock ends a deadline? The setup card says "11:59 pm in the kennel's time zone"; her device uses its own clock. | The kennel's time zone for the waitlist's deadlines only (turns, fees, ready checks). Everything else keeps the device's date. |
| D12 | K7-8: public names. "Smith Family" lists as "Smith F.". E1 keeps names on the public list longer, so this matters more. | Build the public name from the application's own name when the contact's name is a household or "Last, First", and always show her the public form in the Approve dialog. |

## 3. The enhancements

### 3.1 E1 — "Pup selected": the family keeps its place and its number

**Who holds a place.** One rule, `holdsPlace(entry, { sales, dogs })` in `waitlistRules.js`:
a record with status `placed`, not archived, not `off_list` (E3), whose `placed_sale_id` sale
is still open (`vocab.isOpenSale`: not Delivered, returned, cancelled or voided), and whose
pup hasn't gone (status not deceased, pet home or External). A family placed through a side
sale holds its place the same way. A family between pick and deposit is still on its turn and
still reads **Currently deciding**, so a row goes Currently deciding → Pup selected with no
gap.

**Numbering.** Today a family's number is its rank among the families still waiting. It
becomes its rank among **waiting families and families holding a place**, in the same order
(`compareEntries`: program, date in line, fee time).

- `rankedList` stays as it is, waiting families only. The turn rules read it (`nextTurn`,
  `litterQueue`, `joinsOpenTurn`, the turn queue, the picks preview), and a family with a pup
  selected must never be offered a turn.
- A new `numberedList(entries, kennelId, programsById, { sales, dogs })` adds the holders.
  `overallPositions`, `prefPlaces` ("#2 for a female") and `publicList` number from it.
- **`sales` and `dogs` are required** by those three: a call without them throws. There are
  about twenty callers (the status page, the public list, reminder emails, the entry page,
  Kels, the picks panel and preview, the side-sale dialog, reports). One that kept numbering
  the old way would show a family a different number on a different screen, which K6 checked
  never happens today. A test calls every reader on one record set and asserts one answer.
- "#5 of 7" totals count holders too, so the two numbers agree.

**What moves a number, after this.**

| Event | Today | After |
|---|---|---|
| A family ahead pays its deposit | everyone behind moves up | nobody moves |
| That pup goes home | nothing | everyone behind moves up one |
| That pup is lost (died, Health hold) and the family is put back in line | everyone behind moves **down** one | nobody moves: the family takes back the number it held |
| That family backs out | nothing | everyone behind moves up one |

So a number only ever goes down toward #1, except for the two things that are her own
choice and already move families today: adding a family to a program that goes ahead, and
moving a family by hand.

**How it is published.** Additive, so nothing that reads today's list breaks:

- `public_list` keeps its row shape. Its numbers are the new ones, so it has gaps where the
  holders are. An older page script, and her KennelPort website (`/f/site`), then show the
  gaps with the note they already carry: "some applicant names may not be displayed… Their
  place is being held". That is true of these families.
- A new `public_selected: [{ position, name, added, program? }]` beside it, names unmasked
  as `public_list` is. `listView` returns it as `selected`, `statusView` as `public_selected`.
- Family pages: `publicListHtml` (`cloud/public/family/common.js`) puts each selected row at
  its number, with a tick, the name, and *Pup selected* in Wants. The "names may not be
  displayed" note is worked out after the selected rows are in, so they don't trigger it.
  Search by name or number finds them.
- The Worker finds who is "Currently deciding" by number, and each waiting family's number
  is published the new way, so that still matches.
- Her app: the Waitlist page's **On the list** card shows the same rows at their numbers,
  with a **Pup selected** badge and the pup's name. `publicListText` (the copy-as-text list)
  gains "✓ #3 Smith J. · Pup selected".

**Not changed.** Who gets the next turn, passes, automatic offers, and the count of families
waiting.

### 3.2 E2 — "Already Reserved" on the Available Puppies card

**Which pups.** One rule, `isPupReserved(dog)` beside `isPupAvailable`: disposition Placed,
not archived, not deceased and not gone home (D4, D5). It is the website's rule
(`siteExport.puppyStatus`), kept in step by a test. A pup is never both available and
reserved, since Available and Placed are two values of one field.

What follows from that rule:

- A waitlist pick with its deposit still owed is Available with a held sale: it is in
  neither section, as today, until the deposit lands (then Placed) or the pick lapses.
- A sale made on the Sale page shows under Already Reserved once she answers the
  disposition prompt with Placed. If she doesn't, the pup is in neither section until Tidy up
  asks. Step 1 changes Tidy up to ask only once the deposit is in (K6b-3).
- A pup she's Keeping, Undecided or on Health hold is in neither section.
- When the pup goes home it leaves the section, and its family's row leaves the list (D2), at
  the same moment.

**How it is published.** Each litter in the projection gains `reserved: [pup]`, the same
allow-listed pup (`publicPup`: call name, sex, colour, registry, link). **`pups` is left
exactly as it is**: only available pups. That is what keeps a reserved pup off a turn:

- a turn card's pups are `l.pups` ∩ the turn's `eligible_dog_ids` (`familyPages.js:681`);
- the Worker's automatic offers read `l.pups` as "available" (`serverMoves.js:148`);
- prices on a turn come from available pups only (`litterPrices`).

None of the three reads `reserved`. A test builds a litter with a reserved pup and asserts its
id is in no offer's pups, no `eligible_dog_ids`, and not in the Worker's available set.

**How it shows.** `litterCard` (Worker) passes `reserved` through `cardPups`.
`pupColumnsHtml` draws, when a litter has any reserved pup:

```
Still Available            Already Reserved
Males      Females         Males      Females
Pip        Poppy           Max        Willow
```

(stacked on a phone: Still Available, then Already Reserved, each with its two columns). A
litter with no reserved pup looks as it does today, with no heading. A litter with nothing
left reads "No puppies remaining" over its Already Reserved columns. One function draws the
card on the public list page and the status page, so both change together. Nothing says who
reserved a pup.

**Her app.** The Waitlist page's Litters card gains a **Reserved** count and keeps a litter's
row while it has reserved pups (today a litter with nothing available drops off the card).

### 3.3 E3 — A family page without the list

**Why the side sale went wrong.** A side sale needs a family that is on the list
(`status: 'active'`), so she had to put each buyer on it first. They landed at the end, in
public, and with E1 they would now stay there as "Pup selected". The use is different: these
families were never in line.

**Two new plain fields** (no schema block; optional, default false, so older backups read):

- `WaitlistEntry.off_list`: this record is a family page only. Always `status: 'placed'` with
  a `placed_sale_id` (the existing rule for placed records).
- `Litter.waitlist_off`: this litter is kept off the waitlist.

Both are classified `cloud` in `syncRegistry.js` (D7), and `cloud/src/lib/cloudFields.js` is
regenerated.

**Starting it.**

- **Litter page: "Sold before the waitlist…"** One action for her case: sets `waitlist_off`,
  and for each live sale of a pup in the litter with a buyer, makes that buyer a family page.
  It lists what it will do first (which pups, which buyers, any pup with no sale) and warns
  about a buyer on her do-not-sell list (K7-9).
- **Sale page: "Give this family a status page"**, for one sale at a time.
- **A placed family's page: "Keep off the list (family page only)"**, for the families she
  already put through a side sale. Once their deposit is recorded, one tap takes them off
  every list. Undoable.
  **Modified (built):** the undo, **Put back on the list…**, is offered only to a family that
  was on the list (fee received), so a record made as a family page never jumps to #1.
  "Sold before the waitlist…" lives in the Litter page's waitlist panel (its own small card
  when the panel would otherwise be empty).

`addFamilyPage(saleId)` in `waitlistActions.js` creates the record: the sale's buyer as its
contact, `placed`, `off_list`, no application, no fee, no place. It refuses a released sale, a
sale with no buyer, and a sale another record already claims. Publishing mints its link as for
any record (`ensureStatusTokens`).

**What these families get** (all of it exists today for a placed family with an open sale):
the pup's card, pickup times and requests, extras, transport, backing out, the puppy portal
link or the Companion link, her policies and recommended products, and her emails and
messages from their page in her app. Their page's opening line changes from "Your time on the
waitlist is complete" to one that doesn't mention a waitlist (`page_only` on the published
record).

**What never shows them:** the public list, its numbering and its Pup selected rows (E1: they
hold no place, so nobody is numbered after them), the Closed section and its count, the
funnel, exits and days-to-placement reports, the year review's waitlist count, Kels's Review
my waitlist. A lost pup or a back-out never puts them in line (D8). **Apply again** makes an
ordinary application.

**Where she finds them (D6).** Their own section on her Waitlist page, **Family pages only**,
beside New applications, Fee due, On the list, Litters and Closed: the family, their pup, and
whether the pup has gone home. Each row opens the family's page. The Sale and the contact
link to it too.

**What a `waitlist_off` litter is left out of.** One helper, `waitlistLitters(kennel, litters)`
(§3.4), so every reader agrees: Available Puppies (and Already Reserved), Coming up, "a
litter you match was born", the turn queue, Open picks and Offer the turn (refused, with the
reason), the picks preview, Almost your turn, the deposits-planned nudge, and her Waitlist
page's Litters card. The Litter page keeps its **Pickup times** panel, which is what these
families book from.

### 3.4 One rule for "a litter the waitlist shows"

The list of live litter stages exists three times on the waitlist's pages and again in the
engine and the projection (K6-12). E2 and E3 both need the same answer, so step 2 makes it
one exported function in `waitlistRules.js` and points all of them at it:
live stage, not archived, this kennel, not `waitlist_off`.

## 4. Build order

Each step is one shippable batch with its tests. Steps 1–3 are the emergency. Steps 4 and 5
touch other files and can be built at the same time as 1–3 by another session; step 4 must be
live before she sends E3 families to the portal.

| Step | What | Findings in it |
|---|---|---|
| **1** | **A pup leaving the available set, and side sales that outlive their family.** One check, run when a deposit lands, a side sale resolves, or a pup's disposition or status changes: any open turn left with no pup is ended without a pass. Leaving the list cancels a pending side sale. | K6-1, K6b-2, K6b-1, K6b-3, K6b-4, K6b-10 |
| **2** | **E1 and E2**, with the rules they rest on: one numbering every reader shares, one "litter the waitlist shows", one "placed family". The Waitlist page's tables scroll in their cards and its badges format dates, since the page is being changed anyway. | E1, E2, K6-12 (item 1), K8-12, K8-7, K7-12, K7-8, K6-9, K6-10 |
| **3** | **E3.** | E3, K7-9, K8-8 |
| **4** | **The puppy portal says only what's true.** A returned sale is retracted; facts from the portal are checked and shown to her; disconnecting takes the portal button off. | K7-1, K7-2, K7-3, K7-14 |
| **5** | **Money a family is shown.** The deposit email, backing out after paying more, a paid step that changes, a carried deposit, the fee card, the wording. | K8-1, K8-2, K8-3, K8-4, K8-10, K8-13, K6b-5, K6b-8 |
| **6** | **One turn rule each.** The out-of-turn guard asks the real rule; one reason for "can't offer"; Kels ranks from the same map; an extension is never shortened and honours her open days; undo puts back only what it closed. | K6-6, K6-7, K6-5, K6-2, K6-8, K6-4, K6-11, K6-12 (rest), K6b-6 |
| **7** | **The clock.** The kennel's time zone ends deadlines on her device, on the Worker and on the family's page. | K6-3, K8-9 |
| **8** | **Applying and signing in.** | K7-4, K7-5, K7-6, K7-7, K7-10, K7-11, K7-13, K6b-7 |
| **9** | **Pickup, miles and queued emails.** | K8-5, K8-6, K8-11, K8-14, K8-15 |
| **10** | **Holding together.** Each action's writes in one transaction; the preview modal asks before dropping changes. | K6-13, K6b-9 |

**Releasing steps 2 and 3.** Deploy the Worker and family pages first, then the app. An older
app with the new Worker publishes no new fields and looks as today. The new app with an older
Worker is also safe (the new fields are ignored), but the pages wouldn't show the new rows.
No cloud migration: the projection is stored whole. KennelPort's website gets `selected` and
`available[].reserved` in `/f/site` and ignores them until it's taught to draw them; that is
a KennelPort change, noted in §7.

**For each step** (CLAUDE.md): new fields classified in `syncRegistry.js` and
`cloud/src/lib/cloudFields.js` regenerated (step 3); guide §29 and §35.1 updated to what is
built; a **Modified:** note in the Waitlist, Side Sale and Family Requests specs where the
build departs; `PRECACHE_URLS` (and `proPages.js`) for any new file; `docs/BUILD_LOG.md`;
`node --test`, `cd cloud && npm test`, `node build/assemble.mjs`. The service-worker cache is
bumped once, when the owner says the batch is done.

## 5. Every finding, and what happens to it

Fix summaries are the reviewers' unless marked. "Test" names the case the review said was
missing.

### K6 — the waitlist engine

| # | Sev | Finding | Fix | Step |
|---|---|---|---|---|
| 1 | S2 | A turn whose pups all go stays open and ends as a counted pass | Re-check open turns when a pup leaves the available set; end an emptied turn without a pass; `recordOutcome` refuses to count a pass on a turn with no pup. Test: last pup marked Keeping under an open turn | 1 |
| 2 | S3 | A litter joining a turn takes back an extension she granted | Keep the later of the two dates for the whole turn | 6 |
| 3 | S2 | Deadlines run on the device's clock, not the kennel's time zone | `kennelToday(kennel)` for turn, fee and ready-check deadlines (D11); the Worker refuses to close turns for a kennel with no time zone | 7 |
| 4 | S3 | Undoing a pass reopens litters the family said "Not this litter" to | Reopen only rows that were open; put the prepass back | 6 |
| 5 | S3 | Kels ranks from a program map that drops archived programs | `getMapForKennel` in `waitlistReviewUI.load()`. Test: every position reader gets the archived program | 6 |
| 6 | S2 | The out-of-turn guard asks the pre-turns rule and stays quiet | The entry page asks `nextTurn`; `offerTo` checks it too and needs `outOfOrder: true`, so the note can't be lost | 6 |
| 7 | S3 | "Offer their turn" lists pre-passed litters and mis-explains a side sale | One `offerBlocker(entry, litter, …)` in the engine, used by the dialog and by `offerTo` | 6 |
| 8 | S3 | "Give them more time" ignores open days and closed dates | Normalise the date through her calendar; prefill with `respondByDate` | 6 |
| 9 | S3 | Paused and Not-ready badges print a raw date | `fmtDate` on both | 2 |
| 10 | S3 | The Waitlist page's tables run out of their cards on a phone | Wrap `table()` in `.table-scroll` | 2 |
| 11 | S4 | Opening picks again overwrites `picks_opened_date` | Stamp only when empty | 6 |
| 12 | S4 | Nine rules implemented twice | Item 1 (live litter stages) in step 2, as §3.4. The rest in step 6: delete `overdueOffers`, one turn-deadline helper, one "is overdue", `litterQueue` in Kels, one `holdsTurn` | 2, 6 |
| 13 | S4 | No waitlist write runs in a transaction | One `db.transaction` per action; the next turn's offer stays outside it | 10 |

Notes acted on: an `active` record with no date at all sorts to #1 (a guard in
`validateEntry`, step 6); "Place them with…" on a family with no anchor clears the override
(step 6); the **Modified:** note for `position_anchor_date` (step 6, docs). The plan's "every
action writes a `HistoryEvent`" line is reworded in K16, not here.

### K6b — picks preview, side sales, undo windows

| # | Sev | Finding | Fix | Step |
|---|---|---|---|---|
| 1 | S2 | A family that leaves the list keeps its pending side sale | The four leaving paths cancel it (`cancelSideSale` puts a held pup back); `confirmSideDeposit` refuses a record that isn't `active` | 1 |
| 2 | S2 | A side sale's deposit can empty another family's open turn | The same emptied-turn check as K6-1, run from `resolveOtherClaims`, reported to her in the deposit dialog | 1 |
| 3 | S2 | Tidy up offers to mark a side-sale pup Placed | Skip pups whose only live sale is Deposit pending | 1 |
| 4 | S2 | "Undo fee received" offered while a side sale is pending | `canUndoFeeReceived` reads the sales too | 1 |
| 5 | S2 | Undoing a Stripe fee doesn't stick | No undo for a fee that came from Stripe (the refund case is unconfirmed: check against Stripe first) | 5 |
| 6 | S3 | The preview's "next in line" changes with the Either switch | Work it out inside `simulateOpen`, as stated; leave out families with nothing to offer | 6 |
| 7 | S3 | Undo decline can't see a re-application | Match on the application's email when there's no contact | 8 |
| 8 | S3 | After Reopen application, a fee paid online is stranded | `undoExpire` applies `fee_paid_online` as `approve` does | 5 |
| 9 | S3 | A tap outside the preview drops unsaved settings | Ask first; Escape; tables in the scroll box | 10 |
| 10 | S4 | A server-made turn can land on a family with a pending side sale | `planServerEvent` refuses it; `confirmSideDeposit` moves on when it voided a turn | 1 |

K6b ran nothing (it could only read). Step 1 starts by turning findings 1–4 into failing
tests, which also confirms them. Notes acted on: a back-out on a held side sale puts the pup
back to what it was (step 5, with K8-2); the two Side Sale spec lines that disagree get a
**Modified:** note.

### K7 — the waitlist online

| # | Sev | Finding | Fix | Step |
|---|---|---|---|---|
| 1 | S1 | A returned sale stays live in the portal and shows the next home's vet visits | `returned` treated as voided; health cut at the sale's end; an aged-out placement goes in `removed`. Test: return, then re-sale | 4 |
| 2 | S2 | Facts from the portal rewrite her records unchecked and unseen | Only for a placement this device sent, in a fitting state, with bounded dates; a history line each; shown to her once | 4 |
| 3 | S2 | Disconnecting the last device leaves the portal on | Clear `kennelport_portal` on the last disconnect; say so on the card | 4 |
| 4 | S3 | A long policy is cut short for families | The editor enforces the server's limits | 8 |
| 5 | S3 | Nothing records which policies a family agreed to | D10 | 8 |
| 6 | S3 | A sealing failure shows the applicant nothing | Catch and say so, keeping their answers | 8 |
| 7 | S3 | The code step can't be corrected or recovered | "Wrong address? Change it"; "Already applied? Enter your code" | 8 |
| 8 | S3 | Public names show the surname for common shapes | D12. Before E1 ships, because E1 keeps names up longer | 2 |
| 9 | S3 | No do-not-sell warning on the Sale form or Side sale | `doNotSellMatches` on the chosen buyer, there and in E3's two actions | 3 |
| 10 | S3 | A family's signed-in browsers outlive New link | New link and an email change end that record's sessions | 8 |
| 11 | S3 | Shared limits that families pay for (suspected) | Count wrong guesses per code; reword the kennel-wide 429; reshape the per-IP limit | 8 |
| 12 | S3 | The policies banner skips placed families | Pass the date through for a placed family with an open sale. E3's families are exactly these | 2 |
| 13 | S3 | Deleted applications come back on a new device | Remember dismissed inbox ids in the backup | 8 |
| 14 | S4 | Two linked devices send two feeds (suspected) | Send from the device that does the waitlist's server work | 4 |

### K8 — family requests, pickup, transport, fees, emails

| # | Sev | Finding | Fix | Step |
|---|---|---|---|---|
| 1 | S1 | The deposit email takes the deposit off twice and states the wrong deposit | Deposit and balance from the invoice's own lines; the Stripe link for the deposit part. Test: the message beside the invoice | 5 |
| 2 | S1 | Backing out with more than the deposit paid | D9 | 5 |
| 3 | S2 | Changing an extra's amount rescales paid steps | Freeze a paid step; spread the change over unpaid ones | 5 |
| 4 | S2 | A moved deposit is asked for again | Publish the carried amount with the family's credits | 5 |
| 5 | S3 | Mapbox failures: jargon, no Open in Maps in Kels, a home never measured again | Plain sentences; the link in Kels's form; a failed measure isn't remembered as done | 9 |
| 6 | S3 | Geocoding takes the first match anywhere (suspected) | `proximity` and country; refuse a low-quality match. Needs a live Mapbox check | 9 |
| 7 | S3 | The family never sees what happened to their deposit | The decided back-out stays on their view for 30 days; its own email per outcome. With E1: they stop holding their place at the same moment | 2 |
| 8 | S3 | A back-out leaves pickup and extras requests open | Close them in `approveBackOut`; `slotBookings` skips a record with no open sale | 3 |
| 9 | S3 | Pickup and extras dates are UTC on the family's side | The kennel's time zone on the Worker and the page | 7 |
| 10 | S3 | Two prices on the fee card | "paying by card adds $2.07"; the plain fee as the headline | 5 |
| 11 | S3 | A queued email goes out however old | Hold one more than a day old, or past its respond-by, for her say-so | 9 |
| 12 | S3 | Reports count a backed-out family as Placed | One `isPlacedFamily(entry, sales)`, which `holdsPlace` (E1) builds on; an offer with `backed_out_date` is its own outcome | 2 |
| 13 | S3 | Words | As listed in the finding | 5 |
| 14 | S4 | The last place in a time (suspected) | `approvePickupRequest` checks the room | 9 |
| 15 | S4 | Copy to another litter drops the date rules | Copy the rules too | 9 |

## 6. What each enhancement must not break (tests to write first)

- **E1.** Every reader of a family's number gives the same answer on one record set, and a
  reader called without `sales` and `dogs` throws. A deposit ahead of a family doesn't change
  its number; the pup going home moves it up one; a lost pup's family put back in line takes
  the number it held and moves nobody. A backed-out or returned sale holds no place. An
  `off_list` record holds no place. A family holding a place is never in `rankedList`, the
  turn queue or `nextTurn`. A private name stays masked. `public_list`'s row shape is
  unchanged.
- **E2.** `isPupReserved` and `siteExport.puppyStatus` agree on every disposition and status.
  No pup is in both `pups` and `reserved`. A reserved pup is in no turn's pups, no
  `eligible_dog_ids`, and not in `serverMoves`' available set. A pick awaiting its deposit is
  in neither list. A pup that has gone home, or been set back to Available after a returned
  sale, leaves `reserved`.
- **E3.** An `off_list` record never ranks, never appears in `public_list`, `public_selected`,
  the funnel or the year review. A `waitlist_off` litter is in no `litters`, `upcoming`,
  `turn_queue` or nudge, and `openPicks` on it throws. Its families' status views still carry
  pickup, extras and the portal link. A backup without the two fields restores with both off.

## 7. Outside this repo, or not decided here

- **KennelPort:** drawing `selected` and `reserved` from `/f/site`; how the portal handles
  `removed` and two feeds (K7-1, K7-14). Their review's, with a pointer to this plan.
- **Unconfirmed:** K6b-5 (a refunded Stripe session), K7-11, K7-14, K8-6, K8-14. Each is
  checked before its fix is written.
- **Left for K15 / K16:** the page recipe on the entry page's dialogs at 320 px, `tidyRules`
  beyond K6b-3, and the review plan's own wording.
