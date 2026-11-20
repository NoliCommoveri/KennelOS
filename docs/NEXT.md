# KennelOS — the next release (`next` branch)

What's on the `next` branch that `main` doesn't have yet. `next` publishes the test build
at **next-pro.kennelos.app** (Pro only; staging servers; no license gate; see
`build/README.md` "Next channel"). Work for the next release is recorded **here**, not in
`docs/BUILD_LOG.md` or the End-State guide, until it's brought in (CLAUDE.md "Next
release"). The copy of this file on `origin/next` is the one that counts:
`git show origin/next:docs/NEXT.md`.

## On next now

Rewrite this list as work lands or changes (a snapshot, like README's Status).

- Docs only so far: the UI redesign's plan and prototype (`docs/KennelOS_UI_Redesign_Plan.md`,
  `docs/design/forest-look-prototype.html`), with the prototype's placeholder screens being
  drawn in, a batch at a time, for the owner to approve (Home's screens, Dogs, Litters and Waitlist so far).

Candidates, from the plans: Line Management Phase 1 (relationships, COI and pairing
warnings; no schema change), the UI redesign (`docs/KennelOS_UI_Redesign_Plan.md`; the
prototype is `docs/design/forest-look-prototype.html`), program types.

## Log

Append one entry per batch merged into `next`, newest last, in the build log's format
(`## YYYY-MM-DD: title`, what changed, files, tests, service worker). At bring-in these
entries move to `docs/BUILD_LOG.md` and this section is emptied.

## 2026-11-19: The UI redesign's plan, and the prototype in the repo

- The forest-look prototype (the owner's artifact "KennelOS Forest Look", 2026-11-18) is
  copied to `docs/design/forest-look-prototype.html`, so builds are checked against a
  fixed copy.
- `docs/KennelOS_UI_Redesign_Plan.md`: what moves where, phases 0–9, and the fidelity
  rule (every style value comes from the prototype; departures need the owner's yes and
  go in `docs/design/departures.md`), checked by a token test and a Playwright style
  comparison. The owner took every recommendation for D1–D7 (dark mode built, one page
  per hub, fonts after first paint, no planned placeholders, released together, family
  pages keep their themes, synced settings listed for her before Setup).
- README's doc map gains the plan's row. Docs only: no code, tests or service-worker
  change.

## 2026-11-19: D8, one person, one page

- `docs/KennelOS_UI_Redesign_Plan.md` §8 gains **D8** (the owner's): no applicant page apart
  from the person's page; one set of name, email, phone and address, shown once and changed
  where she is; never a second set that looks editable but isn't; no screen explains how
  records are stored. The prototype's separate Waitlist family and People screens are an
  approved departure (`docs/design/departures.md`). The live-app stopgap is on `main`.
- Docs only: no code, tests or service-worker change.

## 2026-11-19: The prototype draws D8

- `docs/design/forest-look-prototype.html` is the owner's prototype with D8 drawn in, in its
  own styles (hub head, tiles, rows, the `.dates`-style inputs as `.form-stack`): one person
  page from the Waitlist, People, a sale or search; details once at the top; **Edit** →
  **Their details**; the application as answers only; every waitlist family and client in
  People; search finds people by email and phone; a Design notes section. Published as the
  artifact `KCfKzER1Fo7aEYd7idfpS4`. Since the prototype now has it, it's no longer listed
  in `docs/design/departures.md`.
- Docs only: no code, tests or service-worker change.

## 2026-11-19: D9, Pricing and schedules

- The owner's D9 in `docs/KennelOS_UI_Redesign_Plan.md` §8: usual prices (male and female,
  full registration), deposit, when payments are due, ways families pay, and saved payment
  schedules on one screen, Business › Pricing and schedules; Setup's row opens it.
- The prototype (`docs/design/forest-look-prototype.html`, artifact `KCfKzER1Fo7aEYd7idfpS4`
  version 2) draws it in its own styles: "A usual sale" card, question rows (now one shared
  `qRow`), saved schedules; Setup's Payments & invoices becomes Invoices & receipts; search
  finds each question.
- Docs only: no code, tests or service-worker change.

## 2026-11-19: D10, her own answers; the prototype's icons built in

- The owner's D10 in `docs/KennelOS_UI_Redesign_Plan.md` §8: amounts, times and lists end in
  a + to add her own, which becomes one of her choices; fixed questions keep their choices.
- The prototype (artifact `KCfKzER1Fo7aEYd7idfpS4` version 3, `docs/design/forest-look-prototype.html`):
  the + on Setup's and Pricing and schedules' questions; **New schedule** moved onto the Saved
  schedules heading; the 126 Lucide 0.460.0 icons it uses built into the page (they didn't
  draw in the phone app when loaded from unpkg).
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype draws Home's screens

- `docs/design/forest-look-prototype.html` draws five screens that were `stub:` placeholders,
  in its own components and tokens: **Reminders** (Overdue / Next 7 days / Later, a row opens
  to Done and Snooze, a Done tab, the filter sheet), **Coming up** (from today on, by week,
  filterable), **Calendar** (month grid with dots on a phone and names on desktop, a day's
  list, Add to Google Calendar, the planned calendar feed), **Notifications** (the bell: new,
  then earlier; the dot clears once seen) and **Kennels** (hers, the switch when More than one
  kennel is on, outside kennels). One agenda feeds the first three. Search finds them; a
  Design notes section explains them. Not yet seen by the owner.
- `docs/KennelOS_UI_Redesign_Plan.md` notes that the repo copy now draws screens beyond the
  artifact, each a proposal until she approves it.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype draws the Dogs screens

- `docs/design/forest-look-prototype.html` draws six more `stub:` placeholders in its own
  components and tokens, sharing one set of form parts (titled cards over the `.form-stack`
  look, chips with D10's + where she'd name her own): **Add dog** (what kind of dog first; a
  puppy starts from its litter; papers and ownership on request; a duplicate name warns),
  **Edit dog** (every question open, status, the puppy's plan, ownership, online, Archive),
  **Add event** (the types she uses most, then by kind, only the ones that fit the dog or
  litter; each type's own questions from today's event types; cost becomes an expense; Remind
  me feeds Reminders), **Log a test** (still-to-do tests first, filed by name, result chips,
  Overall, certificate, what families see), **Pedigree** (3–5 generations, tap to re-center,
  + adds a missing parent) and **Dog card** (who it went to, what travels and what never does,
  send again as a link, code or file; live updates still planned). Saving updates the
  prototype's sample data. A Design notes section explains them. Not yet seen by the owner.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype draws the Litters screens

- `docs/design/forest-look-prototype.html` draws three more `stub:` placeholders with the
  Dogs batch's form parts: **Add litter** (from a pairing without a litter, or not planned
  here with a pair check; expected with bred or due date, or born with counts and delivery;
  usual prices or this litter's own; offered to the waitlist or not; opens the new litter,
  whose hub, Pregnancy and Pricing screens work for it), **Add pairing** (on Litters ›
  Pairings, where the header button becomes Add pairing, and from a pair check's "Plan this
  pairing"; warnings as soon as both dogs are picked; planned with her next heat offered, or
  bred with dates, method and the due date) and **Add expense** (from a litter's or dog's
  Expenses; amount, what for, category and who was paid with D10's +, shared across what it
  counts toward). Amounts with cents now show them. A Design notes section explains them.
  Not yet seen by the owner.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D11, filters as dropdowns; dam and sire

- The owner's D11 in `docs/KennelOS_UI_Redesign_Plan.md` §8: some filters as dropdowns, and
  litters filtered by dam and sire independently, any number of each.
- The prototype's one filter sheet (`docs/design/forest-look-prototype.html`): the date range
  is a dropdown; dams, sires, families, categories, event types and who was paid are
  multi-pick dropdowns (find box on long lists, a count per choice); short fixed choices stay
  chips. Dogs and Sales lose their Litter filter for Dam and Sire; Litters' Dam and Sire become
  dropdowns. Design notes' Filters section says so.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D12, smaller header titles, tighter back arrow

- The owner's D12 in `docs/KennelOS_UI_Redesign_Plan.md` §8 (and §3's table): header titles at
  the brand's 21px instead of 23px, and less space around the back arrow, on every screen of
  the prototype (`docs/design/forest-look-prototype.html`).
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype draws the Waitlist screens

- `docs/design/forest-look-prototype.html` draws the Waitlist batch, held to D8 (one person,
  one page; no screen shows or asks for a second set of details, and none explains how
  records are kept):
  - On a person's page, the tiles that were placeholders: **Offers & passes** (their place
    overall and for what they want, passes used, every turn with outcome and reason, and
    offer a turn, side sale, move place, pause, take off the list with 7-day undo), **Fee**
    (waived, due, or paid and counted toward the price; mark received with how they paid),
    **Messages** (one thread: theirs from the status page, hers, and each email sent, with
    Send again; write by email or copy for a text; their email shown with Change),
    **Status page** (what they see now, last opened, where codes go with Change, what they can
    do, copy link, see it as they do, new link) and **History** (everything, newest first;
    for care-team and network people, money paid to or by them).
  - **Add family**: who first, checked as she types against everyone she has (email, phone,
    name); "Is this the Okafor family?" adds that person back rather than a second one. Then
    wants, purposes, readiness, which dams and sires, program, fee, and the place they'll get.
  - **Side sale** (Side Sale spec): family and pup, each mismatch said plainly, the two-claims
    warning when another family holds the pup in their turn, Limited or Full, deposit due.
  - **Programs** list and a **program** screen: name, what it changes as question rows,
    what families see, families in it; New program in the header.
- Turns are recorded per family, so passes counted, the turn order and History agree; the
  turn order reads who took each pup from sales. A fee marked received now gives the right
  place (it counted the family twice).
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype: a litter's own prices

- The owner asked where to change a litter's expected price; the prototype had nowhere once
  the litter existed. A litter's **Pricing** screen (`docs/design/forest-look-prototype.html`)
  now has question rows for this litter only: male price, female price, deposit and full
  registration, each starting as her usual (marked "your usual"), with typical amounts and
  D10's + for her own; picking "Your usual" goes back. Sales already made keep their price.
  Born litters still selling (Willow × Ash) gain the Pricing tile they lacked, and the tile
  sums up this litter's prices. Add litter's "Different for this litter" fills the same rows.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D13, what the app fills in she can change; Side sale's price

- The owner's D13 in `docs/KennelOS_UI_Redesign_Plan.md` §8: every amount, date or choice a
  screen fills in is a starting point she can change there, for that record only.
- The prototype's **Side sale** (`docs/design/forest-look-prototype.html`): price and deposit
  are fields, filled from the pup's litter prices for its sex (plus full registration when
  picked) or her usual, with a line saying so; she can change either. Go-home date, which
  saved payment schedule follows the deposit, and notes join the deposit due date. Changing
  the registration refills the price only if she hasn't typed her own.
- At the owner's request the choice is labelled **Registration type**, its chips just
  **Limited** and **Full (+$1,000)**, so they sit side by side on a phone.
- Fields never run past their column (phones drew date boxes wider than the card), across
  every form. When she types her own price or deposit, the line under them says so, gives
  the litter's figure, and offers **Use the litter's**.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D14, short copy

- The owner's D14 in `docs/KennelOS_UI_Redesign_Plan.md` §8: hints are a few plain words.
- Side sale (`docs/design/forest-look-prototype.html`): under price and deposit, "Prefilled
  from the litter", or "Custom for this sale · Reset"; its intro, warnings and closing hint
  cut to a line each.
- The owner's first edits to the rest of the hint copy: Notifications' link reads **Change
  notification settings**; Add event drops its line about costs going into Financials; Log a
  test's "Overall" becomes **Normal or abnormal?** without its explaining line, and the line
  under who sees the results reads **Visible to others: normal only.** with **Change setting**.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype's copy, rewritten for a professional tone

- The owner: copy should read like it's for business owners. Every hint, label, button,
  empty state and confirmation drawn this session (`docs/design/forest-look-prototype.html`)
  is rewritten short and plain: field labels ("Date of birth", "Disposition", "Referral
  source", "Registration type"), statuses ("Position: #8", "Credited toward Poppy",
  "Requested Nov 14. Position begins on receipt."), errors ("Name is required"),
  confirmations ("Saved", "Pairing added"). Explanations of how things work are gone
  (pedigree tips, where costs go, what a program is). Log a test's category is a chip choice.
  D14 in the plan gains the tone rule.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D15, Add-ons

- The owner's D15 in `docs/KennelOS_UI_Redesign_Plan.md` §8, prototype only (the live app
  keeps "extras" for now).
- `docs/design/forest-look-prototype.html`: "Extra charges" is **Add-ons** everywhere.
  Business › Add-ons lists transport, boarding after go-home and her own add-ons with
  default price, flat / per day / per mile, note and offered on new sales; New add-on in the
  header; Setup › Go-home's Transport and Boarding rows open it. A sale gains **Add-ons**
  (from its Sale screen): each add-on to add, change or remove for that sale, boarding by
  days, one-time charges, and puppy / add-ons / total / paid. Side sale offers add-ons as
  it's recorded. Balances everywhere include add-ons (Fern's sample sale carries a starter
  kit and a photo session).
- Docs only: no code, tests or service-worker change.

## Guide changes waiting

End-State guide (`docs/End_State_Design_and_Maintenance_Guide.md`) edits that work on
`next` needs, written out here instead of in the guide: section, and what to add or change.
Applied to the guide at bring-in.

(none yet)

## Bringing it in

When the owner says to release what's on `next`:
1. A PR from `next` into `main`.
2. In that PR: move the Log entries above into `docs/BUILD_LOG.md`; apply the guide changes
   above; update README Status; ask about the service-worker cache bump (CLAUDE.md).
3. After it merges: reset this file to "Nothing yet", and merge `main` back into `next`.
