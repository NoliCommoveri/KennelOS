# KennelOS — Payment schedules on a sale (plan)

> Not every program takes "a deposit now, the rest at pickup". Some want the rest earlier
> when a pup is transported, part of it by a set age when the pup stays longer, or the price
> by one date and boarding at pickup. This plan gives every sale a **payment schedule**: one
> or more due dates, each for some or all of the sale's charges. It also gives every sale a
> list of **payments received**, and works out what's owed by each date from the two. Those
> figures are used **everywhere money is shown**: contracts, invoices, receipts, the family's
> status page, Companion, and every message. A sale with no schedule works exactly as it does
> today.

## 1. Where things are now

- **Sale money:** `price`, `deposit_amount` / `deposit_date`, one `balance_due_date`, one
  `balance_paid_date` (the whole balance, all or nothing), `transport_fee`, deferred boarding
  (`deferred_boarding_amount` × count), `extra_charges[]` (guide §21.2).
- **Extras can be paid in steps** (`extra_charges[].payments`, Family Requests plan §3.1):
  each step is a percent of *that extra*, with its own due rule and paid date.
- **A sale can't take part payments toward the price.** The nearest thing is a waitlist
  family's credits for funds already received (`WaitlistEntry.received_credits`,
  `data/receivedCredits.js`). `allocateCredits` spreads them oldest first over fee →
  deposit → price → transport, boarding, extras. Credits are Pro only, waitlist only.
- Income (`incomeView.saleComponents`) dates every unpaid part to `balance_due_date`. The
  invoice prefills one Due by. Contracts have one `balanceDue` and one `transportDueDate`.

## 2. What a schedule has to handle

Patterns breeders use, all of which one schedule must be able to express:

| Pattern | As a schedule |
|---|---|
| Everything at pickup (today's default) | One due date: everything, at pickup. |
| Everything by an age when the pup is transported | One due date: everything, when the pup is 7 weeks old. |
| A percent of some charges by an age, the rest at pickup (a longer stay) | 50% of the price plus that extra, at 8 weeks. Then everything, at pickup. |
| The price by an age, a fee that's still adding up at pickup (boarding by the day) | The price, transport and extras, at 9 weeks. Then everything, at pickup. |
| Families may pay any amount early | Payments are amounts on dates, counted toward every due date still ahead. |
| A date she agrees to move | She edits the due date on the sale. |

So:
1. A due date is a **cumulative target**: by this date, at least this much of these charges,
   counting everything paid so far (deposit included). A family who paid early owes less,
   or nothing, at the next date.
2. A target can cover **some of the charges**, not just all of them.
3. Payments are **amounts on dates**, not "step 2 paid".
4. The last target is always **everything**, so nothing is left without a due date.

## 3. The model

### 3.1 The schedule: `Sale.payment_schedule`

`[{ id, label?, due, n?, due_date?, covers, percent }]`, kept in date order.
- `due` (vocab `SCHEDULE_DUE`): `at_weeks` (the pup is n weeks old, dated from its birth
  date), `on_date` (a date she types), `before_pickup` (n days before the pickup date, read
  live), `at_pickup` (read live). A live one is dated the way `extraCharges.stepDueDate` dates
  steps today. A target whose date can't be known yet shows "Date not known yet".
- `due_date` set on any target is the date, whatever its rule: that's how she enters a
  negotiated date.
- `covers`: what counts toward this target, any of `price`, `transport`, `boarding`, `extras`
  (every extra), or single extras by id (`extra:<id>`). `all` = everything on the sale,
  including charges added later.
- `percent`: of what it covers (100 = all of it).
- **Owed by a target** = max(0, percent × its covered total − everything paid so far).
  Because targets are cumulative, a later one never asks again for money an earlier one took.
- The last target must cover `all` at 100%. Saving adds one (at pickup) if it's missing.
- **No schedule stored = today's behavior:** one target, everything, due on
  `balance_due_date`, else at pickup. Every existing sale reads exactly as it does now.
- `balance_due_date` stays and mirrors the last target's date, so code and backups that read
  it keep working.

### 3.2 Payments received: `Sale.payments`

`[{ id, amount, date, method?, account_id?, reference?, note? }]`: money toward the sale
beyond the deposit, recorded when it comes in (the Sale page, an invoice marked paid, a
Stripe payment through `integrationEvents`, Kels).
- The deposit keeps its own fields. Nothing is renamed or moved.
- `balance_paid_date` still means "paid in full". It's set when payments cover everything.
  She can still set it by hand, as now: it then covers whatever is left.
- **Which charge a payment pays** is worked out, never stored, oldest first over price →
  transport → boarding → extras. One allocator (`data/paymentSchedule.js`) serves payments
  and the waitlist's credits for funds received, so income, invoices, the family's page and
  contracts agree.
- **Extras with their own steps (D2):** an extra that a target names in `covers` is paid
  through the schedule, and its own steps aren't copied onto the sale. An extra that no
  target names except through `all` keeps its own steps, as today.

### 3.3 Saved schedules (optional): `Kennel.payment_schedules[]`

`[{ id, name, steps }]`: schedules she names and saves herself, each step a target without
a date. Choosing one on a sale copies its steps there (dated where they can be), so changing
a saved schedule never rewrites an old sale, the same way the price list works.
`Kennel.default_payment_schedule_id` (optional) is what a new sale starts with. With none
saved, a new sale starts with no schedule (today's behavior). The app ships no saved
schedules and no names of its own.

### 3.4 When fees are added to a sale (D3)

Adding a transport fee, boarding or an extra to a sale that has a schedule with more than
one target asks:

> Your current payment schedule is: 50% of price and *Extra name* by Dec 4; everything at
> pickup. Do you need to make any adjustments to schedule the new fees?
> **Adjust the schedule** · **Keep it**

**Keep it** leaves the schedule alone, so the new fee falls under the targets that cover
`all` (at least the last one). **Adjust the schedule** opens the schedule editor. Nothing is
ever changed without her. A sale with no schedule, or a one-target schedule, isn't asked:
the new fee is simply due with everything else.

## 4. What changes, surface by surface

| Surface | Change |
|---|---|
| Sale page | A **Payment schedule** card: each target with its date, what it covers, owed now, and Met, Coming up or Not received. **Payments received** rows (amount, date, method, account) and **+ Record a payment**. Edit the schedule: add, remove or change a target, change a date, choose a saved schedule. |
| Kennel page | **Saved payment schedules**: name, targets, the default. |
| Income (`incomeView`) | Paid money is earned on each payment's date, split over charges by the allocator. The unpaid rest of each charge is anticipated **on the date of the first target that needs it**. Processing fees follow, as now. |
| Money report / Financials | Due by per target. "No due date" only for a target that can't be dated yet. |
| Invoice | Default Due by per line from the schedule. **Invoice the next payment:** one line for what's owed by the next target ("Due by Dec 4: $1,150, after $500 paid"). |
| Receipt | Prints the payment it's for, everything paid so far, and **what's still owed and by when**: the next target's date and amount, then the rest. A receipt for a payment that meets a target says it's met. |
| Messages (`depositRequest`, `paymentLinks` / `stripeLinks`, `assets/paymentRequestUI.js`, `pickToSend`, waitlist-entry texts, `sideSaleUI`, Kels's go-home messages, `waitlistEmails` / outbox) | Every message that states money takes its figures from the schedule: the deposit message says what follows and when; a payment request asks for the next target's amount by its date; a pickup message states what's still owed at pickup. No message does its own sum. |
| Stripe payment link | A link can be for the next payment, and the payment comes back as a `payments` row. |
| Contracts (`contractForms`) | New placeholders: total of all charges, payments received so far, and each target's date and amount by its place (`[Payment 1 Due Date]`, `[Payment 1 Amount]`, …, `[Final Payment Due]`). |
| Family's status page / portal feed | Their next due date and amount, what's paid, and what's left. This is Waitlist Fixes step 5 ("money a family is shown"), so the two are built together. |
| Companion | Same as the family's page. |
| Today nudges | `payment-due`: from 7 days before a target's date until it's met. `payment-missed`: the date has passed and it isn't met. "A scheduled payment was not marked received: *Family*, $X due Dec 4." → **Open sale**. On the sale she records the payment, enters a new due date, or cancels. Replaces the balance part of today's go-home nudges. |
| Kels (Pups are going home, Review my waitlist) | Ask about the next payment, not "the balance". |
| CSV import / export | Not carried (like extra charges). The JSON backup carries the new fields. |
| Sync | `payment_schedule`, `payments` and `Kennel.payment_schedules` are **private** (D5). |

## 5. Rules that keep it safe

- **Additive only:** new plain fields on Sale and Kennel. No new table, no index, no
  `db.version` block. Older backups read as no schedule and no payments, which is today's
  behavior.
- A schedule never moves money between sales and never cancels or ends a sale.
- A released or lost sale keeps today's rules: what was paid is what was paid.
- One pure module (`data/paymentSchedule.js`) does dating, covered totals, the allocator and
  owed-by-target. Every surface calls it, so no screen does its own sums.
- Shared core, edition-agnostic: the schedule and payments are in every edition. Saved
  schedules on the Kennel page follow the same edition gate as the price list if one is
  needed (to confirm when building).

## 6. Decisions

- **D1. A payments list on the sale. Decided (2026-11-13):** yes (§3.2).
- **D2. Extras with their own payment steps. Decided (2026-11-13):** the sale's schedule
  wins for any extra it names. Other extras keep their own steps (§3.2).
- **D3. How schedules reach a sale. Decided (2026-11-13):** a general scheduler with no
  kennel-specific names. The app never switches a schedule on its own. When she adds a fee
  to a sale with a schedule, it shows the current schedule and asks whether to adjust it
  (§3.4).
- **D4. A missed date. Decided (2026-11-13):** flagged on the sale and in Financials, plus
  the `payment-missed` nudge ("A scheduled payment was not marked received") → Open sale.
  It makes no suggestion to back out or cancel. She decides on the sale.
- **D5. Privacy. Decided (2026-11-13):** private, like `extra_charges` and `price`.
- **D6. Payment method at pickup.** Not enforced. A payment's method is recorded. An invoice
  can already print the accepted methods per document. Open: whether a target should carry
  its own accepted methods.

## 7. Build order

1. `data/paymentSchedule.js` (pure): dating, `covers` totals, the shared allocator (credits
   move onto it), owed-by-target, "next payment". Tests first, with every §2 pattern as a
   fixture, and a sale with no schedule giving today's numbers.
2. Sale fields, the Sale page card and editor, Record a payment, the §3.4 prompt. Saved
   schedules on the Kennel page.
3. Income, money report, Financials, invoice and receipt, payment links, integration payments.
4. Contract placeholders. The family page, portal feed and Companion (with Waitlist Fixes
   step 5). Every message that states money (§4 Messages).
5. Nudges, Kels.
6. The guide (§4, §21, §24, §29, §32, §33), `syncRegistry.js`, `referenceRegistry.js`
   (`payments[].account_id` → Account).
