# KennelOS — Reports & Analytics Plan

Status: **Phases 1–4 built** — every report in this plan exists. The code map is the
End-State guide §31; this doc is the plan and the decisions behind it.

## Decided (2026-10-09)

- **Charts: our own SVG** (`shared/assets/chartView.js`), not a vendored charting library.
  Same reasoning as the pedigree tree: works offline, prints crisp, a few KB instead of
  ~200 KB of canvas. Three forms cover every planned report: columns (one / grouped /
  stacked / signed), lines (category or numeric x), and ranked horizontal bars; KPI tiles
  for headline numbers.
- **PDF: the browser's print dialog** ("Print / PDF" button → "Save as PDF"), with a print
  stylesheet and a letterhead (kennel logo + name, report title, date range and filters,
  date generated). Not jsPDF: drawing each report by hand would double every report's
  code, and Save as PDF gives a real PDF everywhere. (Invoices and puppy records keep jsPDF
  / their own print pages.)
- **Grouped hub.** Reports are bucketed — Money / Breeding / Puppies / Sales & Waitlist /
  Shows & Stud / Dogs & Operations — as segment tabs, the same toggle the Financials hub
  uses. Year in Review is featured above them.
- **Reports stay Pro-only.** Lite's two shared report pages (Active Roster, Live-Birth
  Summary) get the upgraded screen for free, since the screen is shared.
- **Derived only.** No report stores anything or needs a schema change.

## Phase 1 — done

- The report screen: date range, KPI tiles, totals row, charts from the visible rows, Print.
- Existing reports upgraded: Litters Over Time, Live-Birth Summary, Placements, Litter P&L,
  Stud Services, Health-Test Events, Active Roster.
- New: **Profit & Loss by Month**, **Year in Review**.
- Hub regrouped.

## Phase 2 — done

The Puppy Growth sample data gained weekly weigh-ins for the Autumn litter (Cedar runs
small, so the flag shows).

1. **Dam & Sire Production** (Breeding) — per breeding dog: litters, average litter size,
   live %, sex ratio, age at each litter; flags back-to-back litters and lifetime litter
   count (a welfare check).
2. **Pairing Success** (Breeding) — conception / whelp rate by method (natural, AI fresh,
   chilled, frozen, surgical) and by sire; progesterone at breeding where recorded.
3. **Puppy Growth** (Puppies) — weight-check curves, one line per pup per litter; flags a
   pup falling behind its littermates. Printable for buyers.
4. **Waitlist Funnel** (Sales & Waitlist) — applied → approved → fee paid → offered →
   placed; drop-off per step; pass and removal reasons; time on the list.
5. **Demand vs Supply** (Sales & Waitlist) — what waiting families want (sex, breed,
   purposes → registration) against pups available or expected.

## Phase 3 — done

The report screen gained `rowsFor` for summary reports (Expenses by Category, Lead
Sources): the filters pick records, then rows group them. Receivables ages only a due
date she set (`balance_due_date`); anything without one is "No due date".


6. **Expenses by Category** (Money) — year × category, a printable tax-time summary.
7. **Receivables** (Money) — balances due, pending deposits, stud fees owed, foster
   costs owed back; aged.
8. **Pricing** (Money) — average price by sex, registration, breed, year vs the litter's
   expected price (is the Full surcharge being realized?).
9. **Breeding-Dog Return** (Money) — per dam/sire: litters, pups sold, revenue from their
   pups vs their own lifetime costs.
10. **Heat Cycles** (Breeding) — intervals per female, last heat, predicted next (derived).
11. **Health-Testing Gaps** (Breeding) — planned vs recorded tests per breeding dog, a grid.
12. **Lead Sources & Referrers** (Sales & Waitlist).
13. **Returns & Voids** (Sales & Waitlist) — by end reason.
14. **Show Record** (Shows & Stud) — points by dog and track, wins, judges, titles.
15. **Stud Results** (Shows & Stud) — outgoing services → litters → fees and pick value.

## Phase 4 — done (2026-10-15)

Waitlist and applications, three new Sales & Waitlist reports. **Decided:** removals the
list's rules make (second pass, no check-in answer, no ready-check answer, fee not received)
are grouped as "Didn't follow the list's rules", apart from removals she makes; no new
removal reason.

16. **Applications** — how often families apply (average and median days between
    applications), approved of those decided, approved → on the list, days to approve and
    to the fee, by month, by sex wanted and program.
17. **Waitlist Today** — a snapshot: who's waiting now in list order, for a girl / boy /
    either, by program and breed, how long (under 3 months … a year or more), passes used,
    paused; families not on the list yet (to review, fee due).
18. **Offers & Removals** — accepted / passed / no-response as shares of closed offers,
    passes that counted, families who passed at least once, why they passed, why families
    left (rules / by you / declined / withdrew), which rules, by month.
