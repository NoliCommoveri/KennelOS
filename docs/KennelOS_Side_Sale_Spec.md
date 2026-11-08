# KennelOS — Side Sale Spec

> **Status: decided, nothing built.** Asked by the owner (2026-11-08). The breeder sells a pup
> to a family on her list outside the turn order: a panicked buyer who changes their mind, an
> older pup she wants in front of someone now. To the family it looks exactly like a turn pick.
> To the turn rules it doesn't exist. Every decision is in §9. Pro only (the waitlist is Pro).
> Companion spec: `KennelOS_Picks_Preview_Spec.md` (side sales show there, its §5.3).

## 1. Why

- **One family at a time** (Waitlist Spec §16.1) is the owner's rule, and it stays: it stops two
  families picking the same pup and makes sure every turn shows every pup.
- But when a second litter opens, the next turns go back up the list (`nextTurn`), and a family
  above who passed on Litter A gets a turn on Litter B only. A's older pups sit in front of
  nobody during those turns, and older pups are harder to sell.
- Today she can offer a family a turn out of order (`offerTo`) and record their pick
  (`recordPick`), but only when **no** turn is open, and only on a pup that matches their answers.

## 2. What a side sale is

- **Started by her, never a turn.** It doesn't block, open, close, extend or move on a real
  turn. It never counts as a pass. `openTurns`, `nextTurn`, `turnSpent`, `joinsOpenTurn`,
  `hasOpenOffer`, automatic offers and pass counting all ignore it.
- **To the family it's a turn pick, with no difference anywhere** (§6): "You picked Willow, deposit
  $X due Nov 12", the same deposit-request message and reminders, their number shown as
  "It's your turn!". No family-facing word says "side" or anything unusual.
- **The pup, until the deposit is in:**
  - **was Available:** still offered: the current turn family and those after them see it and
    can pick it (which raises the two-claims warning, §5);
  - **was Undecided, Keeping or Health hold** (she pulled it for this family): **held** for this
    family, like a turn pick, off everyone else's turns and online lists.
- **Deposit received:** an ordinary sale. Pup sold, family placed. The turn is **not** moved on
  (there wasn't one).

## 3. Starting one

- **Family page:** **Record a side sale…** (families on the list only, `status: 'active'`).
- **A pup** (Litter page Waitlist picks panel, dog page, picks preview): **Sell to a waitlist
  family…**, choosing the family.
- **Refused** when the family holds the real turn: "They hold the turn now. Use Picked a pup… on
  their turn."

The form:
1. **Pup.** Any pup **except** disposition Placed, external, deceased, gone home or archived.
   (A pup with a live sale is allowed, with the two-claims warning, §5.)
2. **What doesn't match**, each said plainly, then allowed:
   - the pup's disposition: "Willow is on a health hold." Recording sets her **Available**, and
     says so;
   - the family's answers (sex, breed, looking for, colors): "They asked for a male; Willow is
     female." Checkbox **Also update their answers to match**: logged in `pref_change_log` with
     `by: 'breeder'`. Unticked, their answers stay;
   - listen-only, paused or readiness hold: said, not blocking.
3. **Selling at** (required): the registration. Default: the pup's `intended_registration`, else
   the first the family's purposes fit (`registrationsForPurposes`), else Limited. Priced with
   `expectedPricing(dog, litter, registration)` like a turn pick. If it differs from the pup's
   intended registration: **Also set Willow's intended registration to Full**.
4. **Deposit due:** defaults to `respondByDate(today, config, program)` (her open days and
   closed dates, the program's longer window). She can change it.

## 4. What it records

- A **Sale**, `status: 'deposit_pending'`, `lead_source: 'Waitlist'`, priced as a turn pick, with
  new optional fields (plain fields, no schema block):
  - `side_entry_id`: the waitlist entry (FK → `waitlist_entries`; `referenceRegistry`);
  - `side_deposit_due`: `YYYY-MM-DD`;
  - `side_holds_pup`: boolean, true when the pup wasn't Available before;
  - `side_prior_disposition`: what the disposition was, to restore on cancel.
  All four are classified `cloud` in `syncRegistry` (synced between her devices with the rest of
  the sale; owner approved 2026-11-08) and regenerate `cloud/src/lib/cloudFields.js`. Backups:
  optional, default empty.
- The pup's disposition set to Available (when it wasn't), the family's answers and the pup's
  intended registration when she ticked those.
- A line in the family's activity for her.

**`isPupAvailable`:** a sale with `side_entry_id` still at `deposit_pending` does **not** take
the pup, unless `side_holds_pup`. Once its deposit is in it counts like any sale.

**Deposit received** (`confirmSideDeposit`): sale `deposit_paid`, pup placed, family placed
(`placed_sale_id`), the same writes as `confirmDeposit` **without** `moveTurnOn`.

**Cancel** (her button, or the family passing/backing out on their card, §6): sale cancelled,
`side_*` left for history; the pup back to `side_prior_disposition` when it held it ("Willow is
back on Health hold"). Never a pass; the family keeps their place.

**Deposit deadline passes:** nothing automatic. Today flags it (a nudge with **Cancel side
sale** / **Give more time**).

## 5. Two claims on one pup

One shared pure check, **`pupClaims(dogId, { sales, offers })`**, counts the live claims on a
pup: live sales (side or not) and open turn picks (`chosen_dog_id`). Two or more is a conflict.
She's warned:
- **recording a side sale on a pup the turn family picked:** "Family X picked Willow in their turn,
  deposit due Nov 10. Record a second sale anyway?";
- **recording a turn pick (Picked a pup… / Change pup) on a pup with a side sale pending:** the
  same, the other way;
- **the turn family picks it online:** their pick goes through as normal (they're told nothing).
  When it reaches her device, Today shows **Two sales on Willow** with links to both;
- **any other way** (a hand-made sale on the Sale page, an import): the same Today alert.
- Badges on the pup, both sales, the Waitlist picks panel and the picks preview until one claim
  is resolved.

**When one deposit arrives on a pup with two claims**, the Deposit received step warns and then
resolves the other claim:
- the other is a **side sale**: cancelled; that family keeps their place;
- the other is a **turn pick**: their pick is let go (`releasePick`); their turn stays open on what's
  left, with **Give more time** offered. With no pups left for them, the turn ends without
  counting as a pass (voided).

## 6. Family pages (her device and the Worker)

- **Projection** (`waitlistProjection.js`): a pending side sale goes into the family's `offers`
  in the exact shape of an open turn row with a pick: `id` (the sale id), `turn_id`, `litter_id`,
  `offered_date` (the sale date), `respond_by_date` (`side_deposit_due`), `eligible_dog_ids`
  (just the pup), `picked_dog_id`, `deposit_amount`, `picked_pup`, `deposit_instructions`, and
  credits as for a turn pick. `place_hidden: { reason: 'turn' }` as in a turn. The status page
  draws it with the turn card it already has. **No family-facing wording changes.**
- **One neutral server-only marker** on that row (e.g. `direct: true`) that the family page
  never shows. The Worker uses it to:
  - leave the row out of "who holds a turn" for automatic offers and `serverMoves` (a side
    row never blocks or triggers a turn);
  - leave the family off the public list's **Currently deciding** (`familyPages.publicRows`):
    on the public list they're a normal row with their number;
  - treat a **pass** on that row as a request her device applies as **cancel the side sale**
    (never counted). The family sees the normal pass confirmation.
- Reminder emails for the deposit go as for a turn pick.
- **Holds:** an unheld side sale's pup stays in other families' `eligible_dog_ids` (it's still
  available); a held one drops out, because `isPupAvailable` says so. No `wl_holds` change.
- Older Workers ignore the marker and would show the family as deciding. Ship the Worker change
  first (no migration needed).

## 7. Picks preview

A pending unheld side sale's pup shows **Offered · side sale pending: Family Z, deposit due
Nov 12**. A held one shows as Not offered for that family. Conflicts show in red
(Picks Preview Spec §5.3).

## 8. How it's built (outline)

- `shared/data/waitlistActions.js`: `recordSideSale(entryId, { dogId, registration, depositDue,
  updateAnswers, updateRegistration })`, `confirmSideDeposit(saleId, …)`,
  `cancelSideSale(saleId, …)`, and the conflict resolution in `confirmDeposit` /
  `confirmSideDeposit`.
- `shared/data/waitlistRules.js`: `isPupAvailable` side rule, `pupClaims`, `sideSaleOf`.
- Pages: `waitlist-entry.js` (Record a side sale…, cancel, deposit received),
  `waitlistPicksPanel.js` and `dog.js` (Sell to a waitlist family…), Today nudges (overdue
  side deposit, two sales on one pup), sale page badge.
- Projection and Worker (§6), with tests in `tests/` and `cloud/tests`.
- Registries and guide: `referenceRegistry`, `syncRegistry` + `cloudFields.js`, End-State guide
  (Sale fields, the side sale, the claims check).

## 9. Decisions (owner, 2026-11-08)

1. Side sales are allowed any time, outside the turn rules, and never affect real turns.
2. Family-facing: identical to a turn pick. No mention of a side sale anywhere.
3. Deposit deadline defaults to her days to pick and pay (open days counted), editable. On lapse,
   nothing automatic; Today flags it and she cancels (never a pass).
4. Families on the list only.
5. Any pup except Placed, external (or gone/deceased/archived). Tell her what doesn't match,
   let her do it anyway, make the updates. Ask which registration she's selling at.
6. Refused while the family holds the real turn (use their turn).
7. The turn family picking a side-sale pup online is told nothing; she's warned.
8. Other claim on deposit: side sale cancelled (family keeps place), or turn pick let go (turn
   stays open on what's left).
9. New Sale fields synced like the rest of the sale: fine.
10. Public list: the side-sale family is a normal row.
11. A pup pulled from Undecided / Keeping / Health hold is held from other families until the
    deposit or cancel, then goes back to what it was if cancelled.
