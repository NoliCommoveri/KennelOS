# KennelOS — One sale, whoever's buying (plan)

> Status: **plan only, nothing built** (2026-11-20). An enhancement to live's sales, drawn in the
> UI redesign's prototype (`docs/design/forest-look-prototype.html`, Add sale) and built with
> or after it. Owner questions U1–U7 (§6) are open.
>
> The owner (2026-11-20): a sale shouldn't go a different way, or look different, because the
> buyer is on the waitlist. Everything the side sale does should happen on every sale. Live's
> regular sales were built before the waitlist existed.

## 1. Why

There are two ways to sell a pup today, and which one she uses changes what the app knows:

- **The Sale page** (`pages/sale.js`, every edition) is the older one. It picks a buyer from
  Contacts and checks only her Do not sell list (K7-9).
- **Record a side sale…** (`assets/sideSaleUI.js`, `waitlistActions.recordSideSale`, Pro with the
  waitlist; `docs/KennelOS_Side_Sale_Spec.md`) only takes a family on the list. It names what
  doesn't fit, warns about a second claim, holds a pulled pup, sets a deposit due date, and
  keeps the family's place right.

So a sale made on the Sale page to a family on the list:
- isn't linked to their place: their entry stays `active` (`placed_sale_id` is only set by the
  waitlist's own actions), so they can still be offered turns and picks;
- isn't on their status page;
- says nothing about a pup another family holds in their turn; Today's "two sales on one pup"
  (`nudges.js`, `pupClaims`) finds it only afterwards;
- has no deposit due date (only a side sale has `side_deposit_due`), so no reminders and no
  overdue flag;
- doesn't hold a pup she pulled from Keeping, Undecided or Health hold.

She shouldn't have to know any of that. One sale form, whose behavior follows from who is
buying and which pup, never from which button she pressed.

## 2. What every sale does

The one form (the Sale page; in the redesign, Add sale) is opened from everywhere: Sales, a
pup, a litter's picks panel, the picks preview, a family's page. Each entry point only fills
in the pup or the buyer.

1. **The buyer** is picked from one list of everyone she has (the prototype's `personPicker`):
   searched by name, email or phone, each with a badge for where they stand (#2 on the list, Fee
   due, Applied, Client), families on the list first, with no headings by kind of record. A name
   nobody has is someone new, checked against everyone and her Do not sell list.
2. **Checks, each said plainly, none blocking** (the side sale's `sideSaleIssues`, for every
   sale):
   - her Do not sell list (as today);
   - the pup: its disposition ("Wren is on a health hold"), and a pup already placed or gone
     home refused as today (`sideSaleBlocker`);
   - **another claim on the pup at the time of recording**: another live sale, or a family with it
     in their turn ("Also offered to the Reyes family, due Nov 20. First deposit received takes
     him."), not only Today's alert afterwards;
   - for a buyer with a place on the list: what doesn't match their answers (sex, breed,
     purposes, colors) with **Update their answers to match** (`answersToFit`), listening for
     other litters only, paused.
3. **Registration** defaults the way the side sale's does: the pup's intended registration, else
   the first the family's purposes fit, else Limited; priced by `expectedPricing`, a typed
   price moving with the registration (prototype `prefillPrice`); **Also set the pup's
   registration** when they differ.
4. **Deposit**: received now (date, paid via), or due by a date: **a deposit due date on every
   sale** whose deposit isn't in. For a family on the list it defaults to her answer window
   (`respondByDate`, the program's own); for anyone else, to Pricing's deposit due rule (U3).
   Reminders and Today's overdue flag work for every sale.
5. **What saving does** follows from the buyer:
   - **holds the current turn** → the sale is their turn pick, as if recorded on their turn
     (`confirmDeposit` / the turn's pick), whatever pup she chose (U2);
   - **on the list, not holding the turn** → recorded as a side sale is today (`side_entry_id`,
     `side_deposit_due`, the pup held when it wasn't Available), shown to them as a turn pick
     on their status page; their place and passes unchanged;
   - **applied or fee due, not on the list yet** → U1;
   - **never on the list** → an ordinary sale; Give this family a status page (E3) stays on the
     sale.
6. **Deposit received**, on any sale linked to a family: the family is placed (`placed_sale_id`),
   the pup is placed, and a second claim is settled as the Side Sale spec's §5 says.
7. **Cancelled**: a linked family's sale is their back-out, as the Sale page already does for
   an open sale (`backOutEntryFor`); a pending side-sale-shaped one keeps their place and
   restores a held pup's disposition.

None of the screen's words name a path: no "side sale", "turn pick" or "off the list" in
labels, buttons or hints (redesign plan D14, D8).

## 3. Editions

- **Lite** (no waitlist): one buyer list (contacts), the pup checks, another live sale on the
  pup, registration defaults, the deposit due date and its reminders. Nothing waitlist-shaped.
- **Pro**: all of §2. Do not sell stays Pro with the waitlist.
- Shared core stays edition-agnostic: the waitlist parts load behind `editionFlags.waitlist`, as
  the Sale page's family-page button does today.

## 4. Data

- **New plain field** `Sale.deposit_due_date` (`YYYY-MM-DD`, optional, no index): the deposit's
  due date on any sale. A side sale keeps writing `side_deposit_due` too (never renamed or
  dropped: backups and older builds read it); readers take `deposit_due_date ?? side_deposit_due`.
  Sync class: `cloud` like the other `side_*` fields (owner approved those 2026-11-08); a
  privacy decision to confirm (U3). Regenerate `cloud/src/lib/cloudFields.js`.
- **No new tables.** The link to a family stays `side_entry_id` (pending) and the entry's
  `placed_sale_id` (once placed). The field names keep "side" in the data only.
- `referenceRegistry`, `syncRegistry`, tests for `cloudDirty`: as for any new field.
- Backups: the new field optional; older files have none.

## 5. Where it's built

- `shared/pages/sale.js`: the buyer list, the checks (moved from `sideSaleUI.js` into a shared
  `assets/saleChecks.js`), registration defaults, the deposit due date, and saving through
  `waitlistActions` when the buyer has an entry.
- `shared/data/waitlistActions.js`: one `recordSale(draft, { entryId })` that chooses the turn
  pick, the side-sale shape or an ordinary sale; `recordSideSale` stays as its inner step.
- Every "Sell to a waitlist family…" and "Record a side sale…" opens the Sale page with the pup
  or family filled in; `sideSaleUI.js` is retired (its `PRECACHE_URLS` and `proPages.js` lines
  removed in the same change).
- Today: the overdue deposit nudge reads `deposit_due_date` for every sale; "two sales on one
  pup" stays for claims made outside the form (imports, the family's own pick online).
- Docs: End-State guide (Sale fields, §29's side sale, §21.3), the Side Sale spec gets a
  **Modified:** note pointing here.

## 6. Questions for the owner

| # | Question | Recommendation |
|---|---|---|
| U1 | A buyer who has applied or owes the fee, not yet on the list | Allowed. Selling places them: their application is closed as placed with this sale, and their fee (if paid later) is still theirs to credit. |
| U2 | The buyer holds the current turn | The sale is their turn pick, whichever pup (live refuses today: Side Sale D6). |
| U3 | Deposit due on a sale to someone not on the list | Pricing's "Deposit due" rule (the redesign's D9 question 2 asks whether that's the same setting as the answer window). |
| U4 | A status page for a buyer never on the list | Unchanged: Give this family a status page stays on the sale (E3). |
| U5 | Two claims at recording time | A warning on the form for every sale; settled on the first deposit as Side Sale §5, for any two claims. |
| U6 | Lite | §3: everything without a waitlist. |
| U7 | Sales already made on the Sale page to families still on the list | Today raises each once ("The Haddad family bought Fern and is still on the list"), with **Link them** (places the family with that sale) or **Not the same family**. No automatic change to her data. |

## 7. Phases

1. **Every sale's checks** (all editions): the claims warning at recording time, registration
   defaults, `deposit_due_date` with reminders and the overdue flag.
2. **One form for every buyer** (Pro): the buyer list, the family checks, saving through
   `recordSale`; the side-sale dialog retired; every entry point opens the Sale page.
3. **Old sales** (Pro): U7's Today item.

Tests: `recordSale` for each buyer kind (turn holder, on the list, applied, never listed),
deposit received and cancel for each, two claims, the deposit due date in the statement and
nudges, the field's sync class, and an import of an older backup.
