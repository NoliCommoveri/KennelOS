# K10 — Money: sales, invoices, contracts, expenses, reports

Reviewed: `shared/data/incomeView.js` (537, all of it), `litterFinances.js` (88), `moneyReport.js`
(221), `yearReview.js` (64), `reportMath.js` (218), `reportSources.js` (327, the money loaders),
`reportFigures.js` (151, the money figures), `receivedCredits.js` (74), `processingFees.js` (92),
`integrationEvents.js` (the payment and fee half), `stripeLinks.js` (123), `paymentLinks.js`
(103, `paymentOptions`), `contractSend.js` (98), `contractForms.js` (the money prefill),
`jotformSigned.js` (124), `saleRepo.js` (102), `saleDefaults.js` (38), `expenseRepo.js` (the
amount rules), `companionExport.js` (the family's sale facts, 320–410), `familyExtras.js`
(`familySale` / `creditSale`), `waitlistActions.js` (`feeReceived`, `undoFeeReceived`,
`recordSideSale`, `confirmSideDeposit`); assets `invoiceDoc.js` (273), `invoiceGenerator.js`
(287), `invoicePdf.js` (249), `paymentRequestUI.js` (the owed figure), `waitlistUI.js`
(`depositDialog`); pages `sale.js` (the read view, the fee preview, the save), `invoice.js` +
`invoice.html`, `financials.js` (the Overview, Income boxes, Adjust), `litter.js` (Sales &
Income), `year-review.js`, `receivables-report.js`, `waitlist-entry.js` (Documents);
`companion-view.html` (the family's facts).
Contract read: Review Plan §0, §0a, K10; guide §21 (with §21.1 and §21.2), §22, §23, §24;
`KennelOS_Side_Sale_Spec.md` §2–§5.
Verified by: baseline at `3d0f610` — `node --test` **1649 pass**, 0 fail; `cd cloud && npm test`
**305 pass**; `node build/assemble.mjs` succeeds (green). The money test files (15 of them)
re-run under `TZ=Pacific/Kiritimati` and `TZ=Pacific/Pago_Pago`: 139 pass each. Scratch suites
on the in-memory Dexie (`tests/support/memoryDb.js`) driving the real repos, in my scratchpad:
`k10_trace.test.mjs` (the one sale, traced through every surface: Sale page figure, invoice and
receipt both by the generator's prefill and by the default link, `getIncomeRows` / `summarize`,
`getLitterFinances`, `loadProfitLoss`, `loadReceivables`, `yearSummary`, `balanceDueOn`,
`buildFamilyBundle`; at deposit paid, paid in full, refunded, cancelled, returned, and with the
fee toward the deposit), `k10_side.test.mjs` (a side sale with the fee received, undone, received
again, then its deposit, for both `fee_credit_toward` settings), `k10_fee.test.mjs` (deposit by
Stripe, balance by Zelle, through `planIntegrationEvent`), `undated.test.mjs`, `credit.mjs`
(three credits on one sale), `pdf.mjs` (a 17-line invoice with a long kennel name and a broken
logo through the vendored jsPDF, rasterised with `pdftoppm`). In Chromium: `invoice.html` at 320
and 390 px (scroll width and the overflowing element), and a Pixel 7 emulation pressing
**Download PDF** on a receipt (the file downloads; its text read back with `pdftotext`).

**The scenario.** Price $3,000, deposit $500 (paid 3/1), a $150 photo package, a $90 processing
fee, a $100 application fee credited to the purchase, a $200 credit for funds already received;
then paid in full, then refunded (the back-out "refund": voided, buyer backed out). Every
*ledger* surface agrees at each step: Financials Overview, the Income view, the Litter P&L
report, Profit & Loss, Year in Review, the invoice's balance and the contract's "Balance still
due" ($585.25 earned / $2,474.75 anticipated / $2,550 due at deposit paid; $3,060 / $0 / $0
when paid in full; $100 after the refund). The same holds for the side sale and for a fee
received then undone: everything is derived live, so every derived figure follows the undo at
once. **The disagreements are in the documents and pages that work the money out on their
own:** the receipt (#1), the family's Companion page (#2), the litter page's total (#3), and
the Sale page's "You net" (#10).

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S1 | shared/assets/invoiceDoc.js:139, :173 | Every sale receipt prints the paid lines as $0 and the unpaid lines as paid: a family who paid a $500 deposit gets "Total paid $2,500.00"; paid in full gets "Total paid $0.00" | verified |
| 2 | S1 | shared/data/companionExport.js:369 | The family's Companion page shows "Remaining balance" as if nothing past the deposit were paid: a paid-in-full family is told they owe the whole balance | verified |
| 3 | S2 | shared/pages/litter.js:953 | The litter's Sales & Income total adds voided, cancelled and returned sales at full value; the Litter P&L counts them as puppies sold | verified |
| 4 | S2 | shared/data/incomeView.js:170 | The processing fee is spread over every part of the sale, not put on the payment that paid it: earned is overstated after a Stripe deposit, a cancelled sale keeps a fraction of the fee, a refunded sale drops the fee Stripe kept | verified |
| 5 | S2 | shared/data/incomeView.js:217 | A sale or stud fee with no dates counts in the Overview but in no report: P&L, Year in Review and Kels say $0 for it | verified |
| 6 | S3 | shared/data/reportSources.js:123 | Profit & Loss with a custom range takes a month only if its 1st is in range: Mar 15–Apr 10 shows all of April and none of March, and disagrees with Expenses by Category for the same range | verified (code) |
| 7 | S3 | shared/data/incomeView.js:326 | Every credited line is dated the family's *oldest* credit: a credit received in June is filed in January, and Deposit received prefills January | verified |
| 8 | S3 | shared/data/incomeView.js:493 | While a pick's sale or a side sale waits on its deposit, the credited application fee is taken off the sale but isn't on the litter: the Litter P&L is short by the fee | verified |
| 9 | S3 | shared/pages/invoice.html:73 | On a phone the invoice's button row doesn't wrap: "← Back to Financials" is cut off the left edge (no way to scroll to it) and "Send payment link" off the right | verified |
| 10 | S3 | shared/pages/sale.js:456 | The Sale page's "You net" is price − fee, leaving out the extras (the fee charged back included) and transport, so it disagrees with the ledger | verified (code) |
| 11 | S3 | shared/data/incomeView.js:103 | A returned pup with a partial refund has nowhere to go: the sale keeps everything paid as earned, and there's no refund field or expense category | verified (code) |
| 12 | S3 | shared/data/contractForms.js:251 | A contract sent at the pick says Price $3,000.00, Deposit $500.00, Balance still due $3,150.00: the "balance" includes the unpaid deposit and the extras, so the three don't add up | verified (code) |
| 13 | S3 | shared/assets/ui.js:72 | Every amount is printed in US dollars, while Stripe can be connected in CAD, GBP or EUR: a UK kennel's invoice says "US$3,000.00" and its Stripe link charges £3,000 | verified (code) |
| 14 | S3 | shared/pages/financials.js:411 | Financials' Adjust sets Voided / Returned with no reason and none of the Sale page's follow-ups; Voided (pup died) → Returned there fails with a repo error she can't fix in that dialog | verified (code) |

---

## 1. Sale receipts invert what was paid  (S1, verified)

**Where** `shared/assets/invoiceDoc.js:139` (the default config: a line already paid starts as
`collected` = its whole amount), `:173` (a receipt's Full line prints `base − collected`);
`shared/assets/invoiceGenerator.js:216` (the generator prefills the same way, for invoices and
receipts alike); `shared/pages/waitlist-entry.js:1763` (the family page's one-tap **Puppy
receipt**, View and Download PDF, with no config).

**Scenario** A waitlist family's $500 deposit is in (sale Deposit paid, deposit date 3/1).
She opens their page → Documents → **Puppy receipt** → Download PDF (the generator's Receipt
gives the same). The PDF, read back from the file the Pixel 7 emulation downloaded:

```
RECEIPT                                   PAID
Deposit (balance)                        $0.00
Remaining Purchase Price             $2,500.00
                       Total paid    $2,500.00
Payment date 03/01/2026
```

They paid $500; the receipt says they paid the $2,500 they still owe. Once she marks them paid
in full, the same receipt says **Total paid $0.00** under a PAID stamp. A cancelled sale whose
deposit she kept: "Total paid $0.00". With the full scenario (credit and extra) at deposit
paid: "Deposit (balance) $200 … Photo package $150 … Total paid $2,550". The invoice is right
(the prefill means "already collected, take it off"); the receipt reads the same number as
"already collected *before this receipt*, leave it off". `tests/pickToSend.test.js` checks only
the invoice.

**Why it matters** A receipt is the family's proof of payment. This one is wrong in every
state once anything is paid, and it's the default document on the family's own page.

**What I'd do** Give receipts their own default: a paid line prints what was paid on it, an
unpaid line is left out (or the generator asks which payment this receipt is for). Add a test
for the receipt at deposit paid and at paid in full.

## 2. The Companion page tells a paid family they still owe the balance  (S1, verified)

**Where** `shared/data/companionExport.js:369` (`remainingBalance` = price + transport +
boarding + extras − deposit − fee credit − credits beyond the deposit; it never reads
`balance_paid_date`, the status, or a paid extra step), shown as **Remaining balance** by
`shared/companion-view.html:453`. The family bundle carries every open sale, and Paid in full
is open (`vocab.isOpenSale`).

**Scenario** The scenario sale marked Paid in full on 4/20. `buildFamilyBundle` → the pup's
`saleStatus: 'paid_in_full'`, `remainingBalance: 2550`. The family's page says "Status Paid in
full … Remaining balance $2,550.00" until the pup is Delivered. A paid payment-plan step on an
extra is never taken off either. (While the deposit is still pending, the figure already
subtracts the unpaid deposit: it's "the balance after the deposit", not what's owed.)

**Why it matters** A wrong amount owed, shown to the family, in the week between paying and
pickup.

**What I'd do** Work it out the way `contractSend.balanceDueOn` does (invoice lines minus
`paidOnSale` with credits), which the ledger and the invoice already agree with.

## 3. The litter's Sales & Income counts sales that fell through  (S2, verified)

**Where** `shared/pages/litter.js:953` (`total` sums `saleValue` over every non-archived sale
of the litter's pups, any status); `shared/data/litterFinances.js:46` (`puppiesSold` += 1 for
every sale income row, including a cancelled sale with a kept deposit and a returned one).

**Scenario** Cedar's $3,150 sale is refunded (voided, buyer backed out) and Cedar is sold again
for $3,000. The litter page's Sales & Income header says **$6,150** (both sales, the voided one
with its grey badge). The Litter P&L report says $3,100 earned (the new sale plus the kept fee).
A sale cancelled with the deposit kept, then the pup resold: Litter P&L "Puppies sold 2" for one
pup. Its hint says "Total sale value"; nothing says ended sales are in it.

**Why it matters** The litter page is where she looks at a litter's money; it overstates by
every sale that fell through, and the P&L's pups-sold count (and any per-pup figure built on it)
is high.

**What I'd do** Leave released sales out of the litter page's total (show them, struck or
apart); count a pup once, and only for a placed sale, in `puppiesSold`.

## 4. The processing fee isn't on the payment that paid it  (S2, verified)

**Where** `shared/data/incomeView.js:170` (`feeComponents` spreads `processing_fee_amount` over
the sale's cash parts in proportion to their size); the per-payment fees are on the sale
(`processing_fee_reports`, each with its `component`, `integrationEvents.js:89`) but unused.

**Scenario** (`k10_fee.test.mjs`) Price $3,000, deposit $500 paid through Stripe (2.9% +
$0.30), the rest and $300 transport via Zelle (no fee). Stripe reports $14.80 on the deposit;
`processing_fee_amount` becomes $14.80. The ledger files $2.24 of it against the deposit (earned
3/2: **$497.76**, she received $485.20) and $12.56 as anticipated against the balance and
transport. She cancels (the family backed out, deposit kept): earned stays **$497.76** for good,
$12.56 of what Stripe kept has gone from the books. Refunded (voided): the sale counts nothing
and the whole fee disappears, though Stripe keeps its fee on a refund.

**Why it matters** Earned income and the P&L month of the deposit are overstated whenever the
two parts go through different accounts, permanently once the sale ends early.

**What I'd do** Put each reported (or estimated) part's fee on that part
(`processing_fee_reports[].component`, `saleFeeEstimate().parts`), and keep the fee of a payment
actually taken as a cost when the sale is released.

## 5. Undated money is in the Overview and in no report  (S2, verified)

**Where** `shared/data/incomeView.js:217` (a sale component's date falls back to the sale,
deposit or balance-paid date, else `''`); a stud fee's `when` is `returned_date || sent_date ||
''` (`:459`); `shared/data/moneyReport.js:61` drops an entry whose month isn't a period.

**Scenario** (`undated.test.mjs`) A sale made on the Sale page with a price and status Paid in
full and no dates (sale date is optional and starts blank). Overview: earned **$3,000**. Profit
& Loss, all time: **$0**. Year in Review and Kels's "You made …" read the same months: $0. A
completed stud service with a fee and no dates (both are optional): the same.

**Why it matters** The two halves of the app disagree with no hint why; an older sale typed in
from paper is exactly the one without dates.

**What I'd do** File undated money somewhere visible (its `created_at` month, or an "Undated"
row the report and the year review show), or ask for a date on a paid sale.

## 6. P&L's custom range is whole months by their 1st  (S3, verified (code))

**Where** `shared/data/reportSources.js:123` (`date: (m) => \`${m.period}-01\``, "a month is in
a range when its 1st is"), read by `reportMath.inView`.

**Scenario** Custom range Mar 15 – Apr 10. March's 1st is before the range: March is left out.
April's 1st is in it: all of April (to Apr 30) is in. The printed label says "Mar 15, 2026 – Apr
10, 2026". Expenses by Category for the same range sums the expenses dated Mar 15–Apr 10, so
the two reports' "spent" differ. The presets (whole years, last 12 months) are unaffected.

**What I'd do** Snap a custom range to whole months on this report and say so in the label, or
build the P&L rows from the entries in range.

## 7. Credits are all dated the oldest credit's date  (S3, verified)

**Where** `shared/data/incomeView.js:326` (`familyCredit`'s `date` = `credits[0].date`, the
oldest; every credited line is earned on it, `:125`); `shared/assets/waitlistUI.js:427` (Deposit
received prefills that date when credits cover the deposit).

**Scenario** (`credit.mjs`) Credits of $200 (Jan 15), $300 (Mar 1), $400 (Jun 1) on a $500
deposit / $3,000 sale: `byKey { deposit: 500, balance: 400 }`, `date: '2026-01-15'`. The ledger
files the $400 that came in June under January; Deposit received offers Jan 15 as the deposit
date though the last $300 of it arrived Mar 1. The P&L for months she has already looked at
changes when the pick is made.

**What I'd do** Date each credited share by the credit that paid it (`allocateCredits` already
knows `perCredit`); prefill the latest of the credits that cover the deposit.

## 8. The litter loses a credited fee until the deposit is in  (S3, verified)

**Where** `shared/data/incomeView.js:493` (a fee row is put on the pup's litter only through
`placed_sale_id`), while `feeCreditsBySale` (`:283`) also credits the pick's sale or a side sale
through `creditSale`.

**Scenario** (`k10_side.test.mjs`) Fee $100 credited to the purchase; a side sale of Willow
($3,000) waiting on its deposit. The sale's anticipated is $2,900 (fee taken off); the fee row
has no litter. Litter P&L: $0 earned, $2,900 anticipated, against $3,000 of real value; the
Overview has $100 + $2,900. Confirming the deposit sets `placed_sale_id` and the litter shows
$3,000. Same for a turn pick awaiting its deposit.

**What I'd do** Put the fee row on the litter of the sale `feeCreditsBySale` used.

## 9. The invoice page's buttons run off a phone  (S3, verified)

**Where** `shared/pages/invoice.html:73` (`.inv-actions { display:flex; justify-content:center }`,
no wrap).

**Scenario** Chromium at 390 px: the row is 437 px wide; centred, it overflows both sides.
"← Back to Financials" is cut at the left (an overflow to the left of a centred flex row can't
be scrolled to) and "Send payment link" at the right; the page scrolls sideways (`scrollWidth`
437 at 390, 402 at 320). At 320 px the items table is 7 px too wide too. On a receipt (no
payment-link button) the row fits at 390.

**What I'd do** `flex-wrap: wrap`.

## 10. "You net" on the Sale page isn't what she nets  (S3, verified (code))

**Where** `shared/pages/sale.js:456` (`netOf(price, fee)`; also the form's preview, `:237`).

**Scenario** The scenario sale: "You net $2,910.00". The ledger has $2,960 for the sale plus the
$100 fee credit on the waitlist row. Worse with a fee charged back: PayPal took $17.94 on the
deposit, she added "PayPal fee $17.94" as an extra so the family pays it, and the Sale page still
says she nets price − $17.94.

**What I'd do** Label it "Price after the fee", or compute it from the ledger's components.

## 11. A partial refund on a returned pup can't be recorded  (S3, verified (code))

**Where** `shared/data/incomeView.js:103` (a returned sale keeps everything paid as earned;
`returned` + `health_problem` drops it all); no refund amount on a Sale, no refund category in
`EXPENSE_CATEGORIES`, and `expenseRepo` refuses a negative amount.

**Scenario** A pup comes back after 3 months (Buyer's choice); she refunds $1,000 of $3,000.
Status Returned: income stays $3,000. Her only routes: lower the sale's price (rewrites the
invoice and the deposit history) or an "Other" expense (counted as a cost of the business, in
the wrong category). Kels's answer on returns doesn't mention refunds.

**What I'd do** A refunded amount and date on a released sale, taken off its earned parts.

## 12. The contract's money fields don't add up  (S3, verified (code))

**Where** `shared/data/contractForms.js:251` (`price` = `s.price`, `depositAmount` =
`s.deposit_amount`, `balanceDue` = `contractSend.balanceDueOn`: every invoice line minus what's
paid).

**Scenario** A contract sent with the deposit request (the form ranking prefers one "while the
deposit is pending"): Price 3000.00, Deposit 500.00, Balance still due 3150.00 (the unpaid
deposit + rest of the price + a $150 extra). A family reads the balance as what's left after the
deposit and the numbers add to $3,650. With a fee credit toward the deposit, Deposit 500.00 is
also not what they send.

**What I'd do** Prefill the balance as what's due after the deposit (or name the field "Total
still owed"), and the deposit net of credits.

## 13. Everything is in US dollars, whatever Stripe charges  (S3, verified (code))

**Where** `shared/assets/ui.js:72` (`fmtMoney`, currency USD); `shared/assets/invoicePdf.js:47`
(the same); `shared/data/stripeApi.js:20` offers USD, CAD, GBP, EUR on the connect form.

**Scenario** A UK breeder connects Stripe in GBP. Her invoice and its PDF say "US$3,000.00"
(that's what `toLocaleString` gives on an en-GB phone; "$3,000.00" on en-US), and the payment
link the invoice sends charges £3,000.00.

**What I'd do** One kennel currency (defaulting to the Stripe one), passed to every formatter.

## 14. Financials' Adjust skips the Sale page's rules  (S3, verified (code))

**Where** `shared/pages/financials.js:411` (writes status, price, dates straight through
`saleRepo.update`).

**Scenario** From the Income list she sets a sale to Voided: no reason asked (the Sale page
requires one), so the pup isn't offered Deceased/Health hold and a waitlist family isn't put back
in line, and the processing fee doesn't follow a changed price (the Sale page moves a fee still
at its filled value). A sale Voided as "Pup died" set to Returned here fails with `Sale:
"pup_died" isn't a reason for a returned sale.` and the dialog has no reason field.

**What I'd do** Leave status out of Adjust (send her to the Sale page for it), or clear the
reason and run the same prompts.

---

## Notes, not findings

- **Every ledger number agreed.** For the scenario at each state, Overview = Income view =
  Litter P&L (bar #8) = P&L = Year in Review = invoice balance = contract balance = the payment
  link's owed figure. A fee received then undone (allowed while a side sale waits on its deposit,
  since a side sale has no offer) drops out of every derived surface at once, and comes back on
  re-receipt. What doesn't follow it: an email already sent with the deposit after credit, and a
  Stripe link already made for that amount (a new link replaces it only when one is made).
- **Receivables "owed" is gross, Anticipated and P&L "still to come" are net of fees** ($2,550 vs
  $2,474.75 in the scenario). Both are right for what they are; nothing on either page says so.
- A deposit owed has no due date in Receivables (`incomeView.js:430`) even on a side sale with
  `side_deposit_due` or a turn pick with its own due date: always "No due date".
- A refunded (voided) sale's credited application fee stays on the pup's litter: the Litter P&L
  shows $100 earned, 0 pups sold, for a litter whose only sale fell through.
- `saleFeeEstimate` estimates the balance's fee on price − deposit, leaving out the extras and
  transport the balance payment carries and the credits it doesn't; a reported fee replaces it.
- The invoice page shows a broken-image icon and "<kennel> logo" when the stored logo won't
  decode (the PDF leaves it off cleanly). The PDF's second page has no column headings or page
  numbers. Otherwise the PDF held up: 17 long lines spill cleanly, long names wrap, nothing
  collides.
- `summarize` and the report sums add floats without rounding; every display rounds, and I found
  no figure that lands a cent apart in two places. `feeComponents` corrects its last cent only
  when the whole sale counts (a cancelled sale's kept share can be a cent off its "real" share).
- The Sale page's read view formats with its own `$${toFixed(2)}` while every other money screen
  uses `fmtMoney` (no thousands separator on the Sale page).
- Report date ranges are inclusive at both ends and compare `YYYY-MM-DD` strings; `last_12` is
  whole months to today. Nothing timezone-dependent in the money path (Stripe dates are local).
- `jotformSigned`: an unexpected payload (no `answers`, no `created_at`) finds no reference or
  falls back to today's date; a signed contract is never re-signed or overwritten (`planIntegration
  Event` skips it; Send again only offers draft/sent/declined).

## Coverage gaps I found (tests that should exist)

- A sale receipt (default and generator) at deposit paid and at paid in full: "Total paid" equals
  what was paid (#1).
- `buildFamilyBundle` for a paid-in-full sale: remaining balance 0 (#2).
- One end-to-end money test that builds the scenario above and asserts every surface's figure is
  the same (the harness in this review is ~120 lines).
- `feeComponents` with deposit and balance through different accounts, and on a cancelled sale (#4).
- P&L / Year in Review with an undated paid sale (#5).
- `familyCredit` with several credits: dates per credit (#7).

## What I did not get to

- `chartView.js`, `reportView.js` (only through the report loaders), `priceListEditor.js`,
  `expensePanel.js`, `salePrompts.js`: not walked through the page recipe.
- `breedingReports.js`, `kennelInsights.js` (only its money sentences), the applications and
  offers-and-removals reports, `dashboard.js`, `sales.js`: read for money figures only (they
  hold none of their own).
- `contract.js` (612) beyond the status and Jotform check; `contractRepo.js`, `stripeApi.js`
  (the HTTP half), `pdfBuild.js` (photo-to-PDF for documents; no money in it), `puppy-record.js`
  (no money in it).
- PDFs on a real iPhone (Safari's download of a blob from a home-screen app): only Chromium's
  Pixel 7 emulation, where the download works.
