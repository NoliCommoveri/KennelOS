# KennelOS — Payment schedules on a sale (plan)

> Not every program takes "a deposit now, the rest at pickup". A sale can now have a
> **payment schedule**: one or more due dates, each for some or all of its charges, as a
> percent or a dollar amount. It also keeps a list of **payments received**. One calculation
> works out what's paid, what's owed by each date and what's left, and **every place money is
> shown uses it**: the Sale and applicant pages, invoices and receipts (generator and
> applicant page), contracts, the family's status page, Companion, messages, Financials and
> Today. A sale with no schedule works exactly as it does today. The scheduler is general:
> the app ships no kennel-specific names or schedules.

---

## 1. Where things are now

- **Sale money:** `price`, `deposit_amount` / `deposit_date`, one `balance_due_date`, one
  `balance_paid_date` (all or nothing), `transport_fee`, deferred boarding, `extra_charges[]`.
- **Extras can be paid in steps** (`extra_charges[].payments`): percents of that extra, each
  with its own due rule and paid date.
- **A sale can't take part payments toward the price.** Waitlist credits for funds received
  (`WaitlistEntry.received_credits`, `allocateCredits`) are the nearest thing.
- **Generator:** picks **one record** (a sale, a stud service or a fee). So the application
  fee can never go on the same document as the deposit or the payments.
- **Bugs this plan fixes (found in the code):**
  - **A receipt for a paid deposit comes out $0** in Full mode. A receipt prints "line total −
    already collected", and a paid line is pre-filled as fully collected
    (`invoiceDoc.js`, receipt branch). Only Partial lets her type the real amount.
  - **The deposit receipt disappears on the applicant page.** With the application fee
    credited toward the deposit, the deposit line is deposit − fee. At $0 or below it's
    skipped (`base <= 0 → continue`). The applicant page's Documents card always uses the
    default document, with no Partial option, so the deposit never shows.

## 2. What a schedule has to handle

| Pattern | As a schedule |
|---|---|
| Everything at pickup (today's default) | One due date: everything, at pickup. |
| Everything by an age (e.g. a transported pup) | One due date: everything, at 7 weeks. |
| A percent of some charges by an age, the rest at pickup (a longer stay) | 50% of the price plus that extra, at 8 weeks; then everything, at pickup. |
| The price by an age, a fee still adding up at pickup (boarding by the day) | Price, transport and extras at 9 weeks; then everything, at pickup. |
| A dollar payment by a date | $500 on Dec 1; then everything, at pickup. |
| Families pay any amount early | Payments are amounts on dates, counted toward every due date ahead. |
| A date she agrees to move | She edits the due date. |
| Extras on their own dates, outside any schedule (e.g. photo packages) | The extra's own steps, untouched by the schedule. |

---

## 3. Data

No new tables or indexes, so no `db.version` block. Every field below is a new plain field,
optional, read as "not set" from older backups.

### 3.1 `Sale.payment_schedule`: the due dates

```
[{ id, label?,
   due: 'at_weeks' | 'on_date' | 'before_pickup' | 'at_pickup',
   n?,             // weeks old (at_weeks) or days before pickup (before_pickup)
   due_date?,      // set = this is the date (typed, or a renegotiated one)
   covers: ['all'] | ['price','transport','boarding','extras','extra:<id>', …],
   percent?, basis?: 'total' | 'remaining',             // with percent
   amount?,  prior_funds?: 'count' | 'dont_count' }]    // with amount; exactly one of percent / amount
```

- **Dates recalculate** from the pup's birth date and pickup date until she types one.
  Typing a date sets `due_date`, and that date wins from then on.
- **Four kinds of due date**, each set on its own row in the editor:

  | Kind | Means | Earlier money counts toward it? |
  |---|---|---|
  | **Percent of total** (`basis: 'total'`) | At least X% of what it covers, paid in total by this date | Yes: everything paid so far |
  | **Percent of remaining** (`basis: 'remaining'`) | A new payment of X% of what's still left of what it covers, after the earlier due dates | No |
  | **Amount, earlier money counts** (`prior_funds: 'count'`) | A payment of $X on top of the earlier due dates; anything paid early beyond those covers it | Yes |
  | **Amount, earlier money doesn't count** (`prior_funds: 'dont_count'`) | A payment of $X that only money received for it can cover | No |

- **How it's worked out:** money is filled into the due dates in order, oldest money first.
  - A "counts" due date takes any money, including money paid early.
  - A "doesn't count" due date (percent of remaining, or an amount set that way) never takes
    **earlier money**:
    - the application fee received (credited toward the sale),
    - the deposit,
    - credits for funds received: the part left over after covering the fee and deposit,
      or the whole credit when it isn't covering those.

    Earlier money skips it and goes to the next due date that can take it, and finally to
    the last. Only **payments received** (Record a payment, an invoice marked paid, a Stripe
    payment) fill a "doesn't count" due date, including any part of an earlier payment
    beyond what the earlier due dates asked for.
  - "Remaining" is measured against what the earlier due dates asked for, not against what
    happened to be paid, so the amount doesn't move when a family pays early.
- **Owed by a due date** = what it asks for − the money it has taken. "Money" means the
  deposit, payments received, credits used and application fees credited toward the sale,
  each on its own date.
- **`all`** = every charge on the sale except extras on their own dates (§3.3), including
  charges added later.
- **The last due date always covers `all` at 100%.** The editor locks it. Saving adds one at
  pickup if it's missing.
- **No schedule stored** = one due date, `all`, 100%, on `balance_due_date` (else at
  pickup). That's exactly today's behavior.
- `balance_due_date` stays and mirrors the last due date (written when the schedule is
  saved, when that date is known), so existing readers keep working. On the Sale form, a
  sale with a schedule shows the final payment's date in place of the Balance due date box
  (D24); dates are changed in the schedule.

### 3.2 `Sale.payments`: payments received

```
[{ id, amount, date, method?, account_id?, reference?, note?, toward? }]
```

- Money beyond the deposit. The deposit keeps its own fields.
- **`toward`:** blank = the schedule, the normal case. `extra:<id>:<step id>` = one of an
  own-dated extra's steps, which also sets that step's `paid_date` as today.
- **Which charge a payment pays** is worked out, never stored: oldest first over price →
  boarding → extras → **transport, always last**. Transport is the last step of the handoff,
  and it's collected then even when other fees were due earlier. Credits for funds received
  use the same allocator, so every surface agrees.
- `balance_paid_date` still means "paid in full". Set by hand, it still covers whatever is
  left, as today. Nothing sets it on its own (D22): when recorded payments cover everything,
  one prompt offers to set the paid-in-full date (the last payment's) and the status Paid in
  full.
- `account_id` → Account: added to `referenceRegistry.js`.

### 3.2a Money carried from a lost pup (D20)

- **Today:** `restoreAfterLostSale(…, { carry })` stores `entry.carried_payment = { amount,
  date, from_sale_id }`, and the next pick's sale takes the **whole amount as its deposit**,
  paid on the original date (`recordPick`). A carry above the deposit shows as an inflated
  "Deposit"; one below it leaves the rest of the deposit never asked for.
- **Instead:** carrying adds a **credit for funds received** to the family's entry
  (`received_credits`): amount and date as paid, note "Carried over from *pup*'s sale",
  `from_sale_id` kept. The new sale keeps its normal deposit and price.
- The credit pays like any credit: deposit, then price, boarding, extras, transport last.
  It labels "Deposit (credited)" etc., counts as earlier money (D18), and prints on receipts
  as credited money, never as a new payment.
- **Income (D21):** a credit is the family's money, held. It is never income itself; the
  charges it covers are. A covered charge is expected income until **its due date** (the
  deposit's: when it was asked for; the purchase price's and other charges': the due date
  of the payment it covers, or the balance due date / pickup without a schedule), then
  earned on that date. Financials shows it like any other line, with no credit label.
  Leftover credit counts nowhere. A covered charge that's removed, or a lost sale, puts the
  credit back to held. Today's code dates credited income by the family's oldest credit
  (`credits[0].date`); this replaces that.
- **Deposit dates never come from a credit.** The deposit date is when it was asked for or
  marked received. Today three places use a credit's date instead, and all three change:
  - the "deposit received" dialog (`waitlistUI.js`): "Date received" defaults to the carried
    money's or the covering credit's date → defaults to the sale's `deposit_date`, else today;
  - a pick with carried money (`recordPick`, `paidDate: carried.date`) → the pick date;
  - a side sale with carried money (`waitlistActions.js`, `paidDate: carried.date`) → the
    side sale's date.

  Credits only lower what the family sends. Test: no deposit prompt or action ever sets
  `deposit_date` from a credit or carried date.
- **Existing data:** an entry holding a `carried_payment` reads as one credit. The field
  stays readable (backups); new carries no longer write it.
- Waitlist (Pro) only, like the lost-pup flow and credits.

### 3.3 Extras on their own dates

- **`own_due_dates: true`** on a price-list extra (`Kennel.extra_charge_list[]`) and on a
  group (`Kennel.extra_charge_groups[]`, the default for its extras). Copied onto the sale's
  charge when it's added.
- An own-dated extra is **never part of the schedule**: not in `all`, and it can't be ticked in
  a due date's covers. It keeps its own steps. With no steps, it's due with the final payment
  but shown as its own line.
- **An extra a due date names** (`extra:<id>`) is paid through the schedule, and its own steps
  aren't copied onto the sale.
- **A sale with no schedule:** every extra keeps its own steps, exactly as today.
- **Modified:** as built, any extra not flagged `own_due_dates` is on the schedule once a
  sale has one (covered by `extras`, `all` or its name), whether or not a due date names it;
  its own steps aren't used for dates, and anything already paid on them still counts.

### 3.4 Kennel

- `payment_schedules: [{ id, name, steps }]`: her saved schedules. The steps have the same
  shape, without dates. Choosing one copies it onto the sale, like the price list.
- No default (D23): no new sale starts with a schedule. Every schedule is added on purpose,
  from scratch or from a saved one.
- `final_payment_methods`: text, e.g. "Cash or Zelle only". Printed on anything for the
  final payment. Earlier payments follow her regular payment instructions.

### 3.5 Privacy and sync

- **Private (never cloud):** `payment_schedule`, `payments`, `payment_schedules`,
  `final_payment_methods`, like `price` and `extra_charges`.
- **`own_due_dates`** sits inside the price list, which is already private.
- No change to `cloudFields.js`.

### 3.6 Editions

All editions, Lite included. The schedule lives in the shared core, with no edition checks.

---

## 4. The one calculation: `data/paymentSchedule.js` (pure)

```
paymentStatement(sale, { birthDate, pickupDate, feeCredit, credits, today }) →
{ charges:   [{ key, label, amount, ownDates }],
  total, paid, remaining,
  received:  [{ kind: 'fee'|'deposit'|'payment'|'credit', id, date, amount, method?,
                label, pays: [{ key, amount }] }],
  dueDates:  [{ id, date|null, label, covers, coveredTotal, threshold, owed,
                status: 'met'|'upcoming'|'due_soon'|'not_received'|'no_date' }],
  next:      { id, date, owed, label, isFinal } | null,
  ownDated:  [{ chargeKey, steps: [{ id, amount, date, paid_date? }] }] }
```

- Every surface reads this and nothing else: no screen or message does its own sum.
- **Labels:** a line paid by a credit keeps its own name with "(credited)" after it, e.g.
  "Deposit (credited)", "Application fee (credited)".
- **Text helpers in the same module:**
  - `scheduleSummary(statement)`: "$1,150 by Dec 4 (50% of price and Extra); the rest at
    pickup". Used by the fee-added prompt and messages.
  - `nextPaymentText(statement)`: the next due date and its amount.
- **`incomeView.saleComponents` calls it:**
  - Paid money is earned on each payment's date.
  - The unpaid part of each charge is anticipated on the date of the first due date that
    needs it.
  - Processing fees follow, as now.

---

## 5. Surfaces

### 5.1 Shared UI: `assets/paymentScheduleUI.js`

| Piece | What it does |
|---|---|
| **Schedule card** | Each due date: date, what it covers, its kind, owed now, a status badge (Met / Coming up / Due soon / Not received / Date not known yet). Then Payments received, Remaining, Next payment. Own-dated extras below, with their steps. |
| **Schedule editor** (modal) | One row per due date: **When** (an age · a date · days before pickup · at pickup), **Covers** (tick chips, own-dated extras left out), **Percent of total / Percent of remaining / Amount** (an amount with **Earlier money can cover it** on or off). Each row previews live "payment $X · $Y paid by then" and its date. Add / remove a row; **Use a saved schedule**; the last row locked to Everything. |
| **Record a payment** (modal) | Amount (pre-filled with the next amount owed), date (today), method, account, reference, note, and **Toward** (the schedule, or an own-dated extra's step). |
| **Fee-added prompt** | **Every time** a transport fee, boarding or an extra is added to a sale, schedule or not. The most common case is a sale with everything due at pickup, where the new fee is what makes a schedule necessary. "Your current payment schedule is: *summary* (e.g. everything due at pickup, Dec 20). Do you need to make any adjustments to schedule the new fees?" **Adjust the schedule** / **Keep it**. An own-dated extra says it's paid on its own dates. Never changes anything by itself. |

### 5.2 Where the pieces appear

| Surface | Change |
|---|---|
| **Applicant (waitlist entry) page**, her main path | The schedule card, editor and Record a payment, for the sale they're placed with or a pick waiting on its deposit. The fee-added prompt fires here when she approves an extra, a transport fee or a pickup with boarding. |
| **Sale page** | Same card, editor and Record a payment. |
| **Kennel page** | **Saved payment schedules** (the editor without typed dates or single extras) and the final-payment methods. Pro (the Kennel page is Pro); in Lite a schedule is built on the sale. Price list **Details**: "Paid on its own dates, never on the sale's schedule" for each extra and group. |
| **Financials / money report / receivables** | One row per unpaid due date, with its own Due by. "No due date" only for a due date that can't be dated yet. |
| **Today** | `payment-due`: from 7 days before a due date until it's met. `payment-missed`: "A scheduled payment was not marked received: *Family*, $X due Dec 4." → **Open sale**. On the sale she records the payment, types a new date, or cancels. No back-out suggestion. Replaces the balance part of today's go-home nudges. |
| **Kels** (Pups are going home, Review my waitlist) | Asks about the next payment, not "the balance". |

---

## 6. Invoices and receipts

### 6.1 The generator works per family, not per record

- **Pick a family**, or a stud service, which stays its own kind. It lists everything for
  that family across records.
- **Charges:** application fee, deposit, purchase price, transport, boarding, each extra or
  extra step.
- **Received:** the fee, the deposit, each payment, credits used.
- **Invoice** = charges ticked.
  - Each line defaults to what's still owed on it.
  - Lines are grouped by due date.
  - A typed partial amount is still allowed.
  - **Next payment** ticks exactly what's owed by the next due date.
  - Ends with the account summary: total, paid to date, this invoice, still owed after it.
- **Receipt** = money received ticked: any mix of fee, deposit, payments and credits.
  - Each prints its own amount, date, method and what it paid toward. A credit prints as the
    line it covered, with "(credited)".
  - Ends with the account summary.
- **A receipt can only show recorded money.** No Full/Partial for receipts. The generator has
  **Record a payment** inline, so new money is recorded first, then receipted.
- **Final-payment methods** print on an invoice for the final payment, and on anything for it.
- **Number and notes:** one number for the whole document, built as today (default
  `INV-/RCT-<date>-<id>`, or typed). A typed number and notes are saved on the sale, or on the
  waitlist entry when there's no sale yet. That's today's rule, extended to a document that
  covers both.

**Modified:** a family is a waitlist entry and the one sale it goes toward (the family
page's sale), or a sale no entry claims (D25). Due dates on a document are the schedule's;
the generator no longer edits a line's Due by (D27). An invoice line prints its whole amount
for that due date, then takes off what was paid and credited, as before. A due date covering
more than one charge prints as one line, "Combined Price (Payment 1)", not one per charge.

### 6.2 The applicant page's Documents card

One invoice and one receipt per charge, with no setup:
- Application fee invoice / receipt.
- Deposit invoice / receipt. It always shows, with "(credited)" when credits or the fee
  covered it.
- A receipt for each payment received.
- An invoice for the next payment.
- **Make a combined invoice or receipt** → the generator, with that family picked.

### 6.3 Testing: every combination

One generated test crosses:
- **Fee credit:** none · toward the balance · toward the deposit, less than / equal to / more
  than the deposit.
- **Credits for funds received:** none · less than the deposit · covering the deposit and
  part of the price · more than everything.
- **Deposit:** unpaid · paid · carried over from a lost pup.
- **Payments:** none · one · several · an overpayment.
- **Schedule:** none · one due date · several; percent · dollar · mixed; covering all · some
  charges.
- **Extras:** none · in the schedule · own-dated with steps · own-dated without steps; one
  step paid.
- **Other charges:** transport · boarding · a fee charged back.
- **Status:** deposit pending · deposit paid · paid in full · delivered · cancelled · lost.

**Checked on every combination:**
- A receipt's lines equal exactly the money ticked. Each line is never $0 and never missing.
- The receipts for every payment add up to paid to date.
- Paid + remaining = total. Each due date's owed = what it asks for − the money it took.
- Money received before a "doesn't count" due date never reduces it.
- Transport is always the last charge paid.
- The generator's default document equals the applicant page's documents.
- The invoice, contract fields, family page, Companion and messages show the statement's
  numbers.

**Named regression tests:** the deposit receipt at $0, and the deposit receipt missing from
the applicant page.

---

## 7. Everywhere else money is shown

| Surface | Change |
|---|---|
| **Family's status page / portal feed** | A Payments card: the due dates as a short timeline (met / next / later), what's paid (with "(credited)" where it applies) and what's left. Built with Waitlist Fixes step 5 ("money a family is shown"). |
| **Companion** | Same as the family's page. |
| **Messages** (deposit request, payment-link and payment-request texts, pick and side-sale texts, waitlist emails / outbox, pickup and go-home messages, Kels's messages) | Amounts and dates from the statement. A payment request asks for the next amount by its date; the deposit message says what follows and when; a pickup message states what's owed at pickup plus the final-payment methods. |
| **Stripe payment links** | A link can be for the next payment. The payment comes back as a `payments` row through `integrationEvents`. |

---

## 8. Contracts

### 8.1 Prefills: 8 new ones, shared by every sale contract type

| Field | Fills |
|---|---|
| `totalCharges` | Everything on the sale |
| `paidToDate` | Everything paid: deposit, payments, credits used, application fees credited |
| `payment1Amount` / `payment1Due` | First due date: **what's still owed by it**, after the deposit, credits and fees received (where that due date lets earlier money count); and its date |
| `payment2Amount` / `payment2Due` | Second |
| `finalPaymentAmount` / `finalPaymentDue` | The last (everything) |

- **Existing fields that cover the rest:** `price`, `depositDue`, `extraPrice`, `boardingRate`,
  `pickupDate`.
- **Nothing is removed.** Templates already use the old names.

**Modified (as built, D29, D31):** `payment1` / `payment2` are the first two due dates
**before** the final one, so nothing prints twice: a sale with no schedule fills only
`finalPayment…`, and a third earlier due date has no slot. A met due date prints `0.00`; a
date not known yet is left out. On a sale with a schedule, an extra agreement for an extra
paid through it prints its share of each due date from the statement (its own steps aren't
used), and `transportDueDate` is the final payment's date (D16). Without a schedule both are
as before.

### 8.2 Firma: only that template's type in the editor

What Firma's docs show:
- Templates have their own custom fields (`POST /templates/{id}/custom-fields`:
  `field_label` up to 100, `field_name` up to 50; 409 on a duplicate name).
- The embedded editor has **no option** to filter or group fields.
- A workspace field's **label can be changed, its name can't**.

Plan:
1. **Relabel her existing workspace fields with a group prefix** ("Buyer · Email", "Pup ·
   Microchip", "Sale · Deposit", "Payment · 1st due date"). Names don't change, so nothing
   placed breaks. First relabel one, and check it still fills on a test send.
2. **Test with her test API key** (free, watermarked), on a throwaway template with three
   template fields:
   - Does the editor show workspace fields beside template fields?
   - What name does a placed template field carry on send?
3. **Place fields → that template's own fields:** KennelOS adds that contract type's fields
   (`fieldGroupsFor(type)`) to that template only, labelled by **contract type** ("Pet sale ·
   Buyer's name").
   - Two passes if a type has more than 40 (the Worker's outbound cap).
   - The server matches placed fields whether they're workspace or template fields.
4. **If workspace fields also show in the editor,** move existing templates over one at a
   time, checking each still fills, before any workspace field is removed.
5. **Editor display:** pass `autoFit` / `initialZoom` so it opens fitted to the page on a
   phone.

**Modified (as built, D30):** step 1 is built, unproven: every fact has a grouped label
(`contractForms.FIRMA_LABELS`); new fields are made with it, and the Worker relabels the
existing fields the device names (`cloudEsign.RELABEL_FIELDS`, `buyerEmail` only for now) by
a best guess at Firma's call (`PATCH …/custom-fields/{id}`, else `PUT`), never fatal. Firma's
docs weren't reachable when it was built. Next: one Place fields, then a test send that
`Buyer · Email` still fills (`docs/LAUNCH_CHECKLIST.md`), then every name in
`RELABEL_FIELDS`. Steps 2–5 (the test-key check, per-template fields, moving templates,
`autoFit`) are not built: step 3 waits on what step 2 finds.

---

## 9. Rules that keep it safe

- **Additive only.** Older backups read as no schedule and no payments, which is today's
  behavior.
- **A schedule never moves money between sales,** and never cancels or ends a sale.
- **Released and lost sales keep today's rules:** what was paid is what was paid.
- **One statement function, one allocator.** Credits move onto the same allocator.
- **Registries:** `syncRegistry.js` (all new fields private), `referenceRegistry.js`
  (`payments[].account_id`).
- **Not in CSV import/export,** like extra charges. The JSON backup carries everything.

---

## 10. Decisions (all decided with the owner, 2026-11-13)

| # | Decision |
|---|---|
| D1 | A payments list on the sale. |
| D2 | The schedule wins for extras it names. Extras flagged `own_due_dates` stay outside it, on their own steps. No schedule = every extra keeps its own steps. |
| D3 | General scheduler, no kennel-specific names, never switched by itself. Adding a fee shows the current schedule and asks whether to adjust it (D17). |
| D4 | A missed date: flagged, plus "A scheduled payment was not marked received" → Open sale. No back-out suggestion. |
| D5 | Private. |
| D6 | The deposit stays separate. |
| D7 | Age-based dates recalculate until she types one. |
| D8 | Lite gets schedules. |
| D9 | Accepted methods only on the final payment. Earlier ones follow her regular payment instructions. |
| D10 | Four kinds per due date: percent of total (earlier money counts), percent of remaining (it doesn't), amount with earlier money counting, amount without. |
| D11 | Contract payment amounts are what's still owed after the deposit, credits and application fees received. |
| D12 | Credits show once used, labelled as what they covered, with "(credited)". |
| D16 | Money pays price → boarding → extras → transport. Transport is always last. |
| D18 | "Earlier money" = application fee received, deposit, and credits (what's left after covering those, or the whole credit). A "doesn't count" due date only takes payments recorded on the sale, including an earlier payment beyond what earlier due dates asked for. |
| D19 | "Remaining" is measured against what earlier due dates asked for, so paying early doesn't shrink it. |
| D20 | Money carried from a lost pup becomes a credit for funds received, not the new sale's deposit. |
| D21 | A credit is held money, never income itself. A charge it covers is expected until that charge's due date, then earned on it. No credit label in Financials. A deposit date never comes from a credit's date. |
| D22 | Nothing is marked paid on its own. When payments cover everything, one prompt offers the paid-in-full date and status. |
| D23 | No default schedule: no new sale starts with one; every schedule is added on purpose. |
| D24 | With a schedule, the Sale form's Balance due date box is replaced by the final payment's date. |
| D17 | The fee-added prompt shows every time a transport fee, boarding or an extra is added, schedule or not. |
| D13 | The generator works per family. Receipts print only recorded money. The applicant page gets one invoice and one receipt per charge. The application fee joins the generator. |
| D14 | One number per document, as today. A typed one is saved on the sale, else on the waitlist entry. |
| D15 | Firma: group prefixes on workspace fields now. Per-template fields with type prefixes after the test-key check. |
| D25 | A family in the generator is a waitlist entry and its one sale, or a sale no entry claims. Two pups bought separately are two families. |
| D26 | The part of a charge a credit covers is not in Receivables (nothing is owed on it); it stays Anticipated in Financials until its due date. One whose due date can't be known yet is earned once the deposit is received (the deposit) or the sale is paid in full (the rest). |
| D27 | The generator doesn't edit a line's Due by; due dates come from the schedule. |
| D28 | "What was paid on a sale" (`paidOnSale`: the lost-pup carry-over, a contract's balance due) counts recorded payments now, ahead of steps 5 and D20. |
| D29 | Contract `payment1` / `payment2` are the due dates before the final one; `finalPayment` is the last. Nothing prints twice. |
| D30 | Firma relabel: built on a best guess at Firma's call, never fatal, one field (`buyerEmail`) first, proven on a send before the rest. |
| D31 | An extra agreement for an extra paid through the schedule prints its share of each due date from the statement. |
| D32 | Step 6 takes only the Waitlist Fixes step 5 items it overlaps: K8-1 (the deposit email from the statement) and K8-10 (the fee card's two prices). K8-2, K8-3, K8-4, K8-13, K6b-5, K6b-8 stay in Waitlist Fixes step 5. |
| D33 | The portal feed to KennelPort stays amount-free. Families reach their payments through the status-page link the portal already shows. |
| D34 | A paid non-deposit Stripe link becomes a row in `Sale.payments`, never paid in full by itself (D22). The prompt: the sale's Payments card shows **Mark paid in full** whenever everything is paid and the sale isn't marked (any path), and a Stripe payment that covers everything also leaves a Today item. |
| D35 | On the family's Payments card, a due date gone by without the payment marked received reads "Was due *date*" with what's still owed: no Overdue badge. |

---

## 11. Build order

**Modified:** §3.2a (D20: carried money becomes a credit; deposit dates never from a credit's
date) belongs to no step below; it's still to build. Until then a credited deposit's income
is dated by `deposit_date`, which those three places can still set from a credit's date.

1. **`data/paymentSchedule.js` + the combination test** (§6.3), tests first. Credits move onto
   the shared allocator.
2. **Sale and Kennel fields;** the schedule card, editor, Record a payment and fee-added
   prompt on the **applicant page** and the Sale page; saved schedules and `own_due_dates` on
   the Kennel page.
3. **Income, Financials, money report, receivables.**
4. **Invoices and receipts:** the per-family generator, the applicant page's Documents, the
   two regression tests.
5. **Contract prefills;** the Firma relabel, then the test-key check, then per-template fields.
   **Built:** the prefills (§8.1) and the relabel (§8.2 step 1, one field, unproven). Open:
   proving the relabel on a send, then relabelling every field; the test-key check;
   per-template fields.
6. **Family status page, portal feed, Companion** (with Waitlist Fixes step 5); **every
   message**; Stripe payment links and integration payments.
   **Built (D32–D35):** the status page's **Your payments** card (`familyPaymentsView`,
   the projection's `payments`, Worker `paymentsOf`), Companion's Payments section, Send
   payment link's options from the statement (deposit owed / next payment / everything
   owed, final-payment methods on the final one), the deposit request from the statement
   (K8-1), the fee card's two prices (K8-10), Stripe links for a payment (component
   `payment`, a `payments` row once per reference, never paid in full), D34's **Mark paid
   in full** and Today item. **Modified:** pickup and go-home messages and Kels's messages
   still read `balanceDueOn` (step 7, with Kels); the portal feed stays amount-free (D33).
7. **Today nudges, Kels.**
8. **Docs:** End-State guide (§4, §13, §21, §24, §29, §32, §33, §35), editions docs if Lite's
   surface changes, BUILD_LOG.
