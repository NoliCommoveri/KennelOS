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
  drawn in, a batch at a time, for the owner to approve (Home's screens, Dogs, Litters, Waitlist,
  Sales and Financials, and More's Backup & Restore, Import / Export, Danger zone, Sharing, Storage,
  Documents and Kels so far), plus D28's stage-aware Home and D29's How connected for her review.
- Plans, nothing built: breeder to breeder (`docs/KennelOS_Breeder_To_Breeder_Plan.md`) and one
  inbox (`docs/KennelOS_One_Inbox_Plan.md`).

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

## 2026-11-20: Add-on groups and rules

- The owner: the add-on fields D15 left out are back, in the new style (D15 note in
  `docs/KennelOS_UI_Redesign_Plan.md` §8). Prototype only.
- `docs/design/forest-look-prototype.html`: Business › Add-ons lists add-ons by group. A
  group's screen (`S.addongroup`, New group under the list) holds its name, status-page
  details link and link text, request-from / until / cancel-by ages, when it's paid (with the
  balance or a payment plan of percent steps: at age, on approval, before pickup, with the
  balance; must total 100%) and due dates (sale schedule or own dates); deleting it leaves
  its add-ons ungrouped with its rules. An add-on gains group, description shown to families,
  requestable on the status page with its own ages, when it's paid and due dates (each "Same
  as group" or its own), and boarding days for any flat add-on. Transport and boarding are in
  a fixed Go-home group. Pricing and schedules gains Add-on payments; a sale's Add-ons is
  grouped.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: Transport and pickup places

- The owner's D16 in `docs/KennelOS_UI_Redesign_Plan.md` §8, prototype only.
- `docs/design/forest-look-prototype.html`: Transport (`S.transport`, from Add-ons'
  Transport row and Setup › Go-home) is priced per mile like live (rate, round trip / one
  way, no charge under, offered to families at least so far away, in touch past a limit),
  starts from the standard pickup place, checks a distance (Get driving miles / Open in
  Maps, with the working), and shows what the status page says. New: Handled by (kennel or
  third party, partner or unknown) as the default for new sales; Referral partners
  (`S.partner`, a Transport account with a reward per booking or percent) with expected and
  received rewards. A sale's Transport is the kennel's (miles, Get driving miles, fee from
  her rate) or a third party's (partner, charged on the sale, reward expected / received);
  Hazel's sample sale uses Sky Paws. Pickup places (`S.pickupplaces`, `S.place`): places,
  the standard one, shown or hidden, the change cutoff. A placed family's status preview
  shows pickup eligibility and Getting your pup home.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: Transport flat fee

- D16's same-day note. Prototype: Transport's Fee card chooses Per mile or Flat fee (flat
  hides the mileage fields; a sale's kennel-handled transport then prefills the flat fee,
  no miles needed). A sale's Transport row links to Transport settings and Pickup places.
  Who it's offered to stacks its two fields (they misaligned at phone width).
- Docs only: no code, tests or service-worker change.

## 2026-11-20: Price rules

- The owner's D17 in `docs/KennelOS_UI_Redesign_Plan.md` §8, prototype only.
- `docs/design/forest-look-prototype.html`: Pricing and schedules gains Price rules (New rule
  on the heading); a rule (`S.pricerule`) is a breed with its own male and female prices,
  an imported parent, or parent trait scores, adding an amount or a percent, on or off, with
  the open litters it fits. A litter's Pricing shows the working from the rules, and Side
  sale prefills from it. Sample: Golden Retriever prices, imported parent +$500 (Titan is
  imported), Movement average 4.5+ +$300.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: Pricing and sales field coverage

- Traced Pricing and schedules, a litter's Pricing, Side sale and the Sale screen against
  live (plan §8 "Field coverage: Pricing and sales"). Prototype gains the saved schedule
  editor (`S.schedule`), payment instructions and final payment rows, deposit and full
  registration by sex and the litter's dates, Sale details (`S.saleedit`, Edit on a sale),
  Side sale's Co-own / None and set-registration option, and boarding per day, week or
  month. Three questions for the owner are listed there.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: More price rules

- D17's same-day note. Prototype: rule kinds A parent, Parent title (any or CH, GCH, CGC,
  MH) and Registry (AKC, CKC, UKC, not registered), by either, dam, sire or both; imported
  parent takes Both; rules add or subtract. Samples: Ash as a parent +$250, GCH either
  parent +$400 (Titan), CKC both parents −$300. Color rules waiting on the owner.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: Price rule change on one line

- Owner: a rule's change is one line, no words: two segmented toggles, [+ | −] and
  [$ | %], the selected side highlighted, then the amount.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D18, shared components

- The owner's D18 in `docs/KennelOS_UI_Redesign_Plan.md` §8. Prototype: a price rule's
  [+ | −] [$ | %] toggles use `.seg`; Transport's distance result uses `.stub-note`; a
  duplicate `.f-hint` rule added this session (it overrode every hint's size and color) and
  `.label-note` are removed in favor of `.f-hint`.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: Component list (§3.1)

- `docs/KennelOS_UI_Redesign_Plan.md` §3.1: the display components by job (helper and
  class, use it for, not for), the four-step check every new field or piece goes through,
  and two duplicates found to resolve (payment steps drawn two ways; Yes / No chips vs the
  switch). D18 points to it.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D19, two-option toggles and one step component

- The owner's D19. Prototype: `fChips()` draws two required options as a `.seg`, and Yes / No
  as a switch (`fSwitch`, `.f-switch`), everywhere it's used; the price rule's + / − and
  $ / % use the same `fSeg()`. An add-on's payment plan and a saved schedule both use
  `stepCards()` (one card per payment, Remove in the head, Add and the total below); the
  old `.plan-steps` styles are gone. §3.1's table and its duplicates list are updated.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D20, parent or pup rules; radio list trial

- The owner's D20. Prototype: a price rule's When card is Looks at (Parent / Pup), then a
  radio list of Name, Breed, Registry, Title, Imported, Scores (the parents-only ones
  disabled for a pup), then that kind's fields. Pup rules adjust each pup's price: a
  litter's Pricing lists each pup's adjustment and Side sale prefills with it (sample: Pup
  temperament 5+ +$200, Cedar). New `fRadio()` component, also on an add-on's Payment card.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: Radio lists for phrase questions; dogs by Sires, then Dams

- Prototype: `qRow()` with fixed answers (no + of her own) opens to `radioList()`; so does a
  litter's "Deposit and full registration". `fSel()` takes option groups; a price rule's
  Name lists Sires, then Dams, alphabetical.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype draws the Sales and Financials screens

- `docs/design/forest-look-prototype.html` draws the Sales and Financials placeholders, traced
  against live's Sale, Contact, DoNotSell, Contract, Account and payments fields, in the
  existing components (D18):
  - **Add sale** (Sales & Placements, a pup's empty Sale): the dog (puppies, then adults), the
    buyer (someone she has, or new, checked as she types against People and Do not sell),
    registration, price and deposit prefilled as on Side sale (one shared `salePrices`),
    deposit received or due, go-home, schedule, add-ons, sold through, lead source, referred
    by, notes. A buyer outside the waitlist is a client (in People, never on the list).
  - **Add person** (People › Add): details with the same checks, contact types, kennel, first
    contact source, notes. **Do not sell**: the list, each row opens to Take off the list;
    Add from People or someone new, with a reason. Add family now warns on the list too.
  - A sale's **Payments**: total, paid, remaining, next; the deposit and each due date (her
    schedule's, or one balance) with Paid / Due soon / Overdue / Coming up; money received,
    each opening to change or remove; Record a payment (amount, date, method, paid via,
    reference, note); Mark paid in full. Linked from the Sale, Sale details and the person.
  - **Contracts**: Open / Signed / All, grouped waiting, drafts, signed, ended; a **contract**
    (signers, then send, remind, copy link, mark signed, or the signed copy; reservation
    facts); **Send for signature** (forms by kind, fitting ones first; the buyer's email with
    Change; you sign too; message); **Contract details** by type (sale, reservation's litter,
    sex, color and deposit, who it's with, lease dates).
  - **Financials**: the year opens a list of her years, and Overview, Income, Expenses and
    Entries follow it (2025 sample entries added). **Add entry**: an expense, or money
    received, which lists what's owed (sales, stud fees, waitlist fees) and opens each where
    it's recorded, since live works income out from them.
  - **Accounts** by type (transport partners among them) and an **account**: name, type,
    website, login (private), processing fee, payment link and instructions, referral
    (shared with families, on her website), contract forms, e-sign signer, this year's
    expenses (opening Entries filtered), Archive.
- `srow()` takes an optional tone and end value (plan §3.1). Design notes gain "Sales,
  contracts and money". Not yet seen by the owner. Proposals for her: a waitlist family
  picked on Add sale goes to Side sale; Add sale starts on the usual schedule like Side sale
  (§8's open question 1); Add entry records no income directly.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype published where the owner sees it

- The prototype had stopped reaching the owner: the docs named artifact `KCfKzER1Fo7aEYd7idfpS4`,
  which her account can't open, and the one in her list (`Qon8foccjzDmQc4ssLcua1`) was still the
  Nov 18 copy. The repo copy is now published as "KennelOS Forest Look",
  https://claude.ai/artifact/1fhGXn25fAQVyJjcXSUxLa, and CLAUDE.md says every session that changes
  the prototype publishes it there. The plan's header points to it.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: Add sale and Side sale: add-ons by +, prices that follow

- The owner's review of Add sale (`docs/design/forest-look-prototype.html`, published to the
  artifact): add-ons are no longer every add-on as chips. **Add** opens her add-ons by name
  (and a one-time charge); each one added shows its amount and **Edit amounts**: transport
  (handled by, partner, miles, fee) and boarding (per day, week or month, rate, length) just
  change, since they're the sale's own; an add-on from her list at another price asks "Your
  usual is $150. Add $120 as a one-time charge?" Same on Side sale (`addonPicker`).
- A registration change now moves a price she typed by the full registration difference
  (`prefillPrice`, shared by both). The line under price and deposit follows once she leaves
  the box. The waitlist family note on Add sale no longer explains why.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: One sale screen; one list of people

- The owner: a sale to a waitlist family shouldn't go to a different screen or be named
  differently; she shouldn't see a difference because of how records are kept. In the
  prototype (`docs/design/forest-look-prototype.html`, published to the artifact) the Side sale
  screen is gone: **Add sale** is the one sale screen, opened from Sales, a pup, the turn order
  or a family's page (**Sell them a pup**). With a buyer on the list it says what doesn't
  match what they asked for (Update their answers to match), a pup another family has in their
  turn, a pup held for them, and their open turn; saving keeps their place and passes, or
  records their turn when they hold it (the Side Sale spec's rules, never named on screen).
- The owner: no "Waitlist" and "People" groups when picking a person; waitlist families are
  people too. `personPicker`: one list searched by name, email or phone as she types, each
  with a badge (#2 on the list, Fee due, Applied, Client, Care team), families on the list
  first; a name nobody has is someone new, with email, phone and address, checked against
  everyone and Do not sell. Used on Add sale and Do not sell.
- Fixed: email and phone typed backwards on Add family and the new forms (each keystroke
  redrew the page and the cursor jumped to the start); they're now checked when she leaves
  the box.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: Plan: one sale, whoever's buying

- `docs/KennelOS_Unified_Sale_Plan.md` (new): the owner wants every sale to do what a side
  sale does, since live's Sale page predates the waitlist. One sale form from every entry
  point; the buyer from one list; the checks (another claim at recording time, what doesn't
  match, a held pup), registration defaults and a deposit due date (new `Sale.deposit_due_date`)
  on every sale; saving decides turn pick, side-sale shape or ordinary sale from the buyer.
  Owner questions U1–U8; three phases. README's doc map gains its row. Same day, the owner:
  the buyer needn't be on the waitlist; the pup and deposit rules (another family holds it, a
  held pup, deposit due, settling two claims) apply to every sale, the plan's §2.2.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D21 and D22: one sale screen, people as one list, sorts

- `docs/KennelOS_UI_Redesign_Plan.md` §8 records D21 (one sale screen; people as one list,
  drawn earlier today) and D22: Sort joins the shared filter sheet as its first dropdown
  (single pick, like the date range), with a chip when changed and the button reading **Sort &
  filter**. §3.1 lists Sort and Choose a person (`personPicker`, `personBadge`).
- Prototype (`docs/design/forest-look-prototype.html`, published): the person picker uses the
  shared filter bar (its box is also the new person's name), sorts Waitlist first / Name A–Z /
  Name Z–A and filters by Application (On the list, Fee due, Applied, Haven't applied); People
  gets the same sorts and the Application filter.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: A new person's checks; taps and typing not lost

- Prototype (`docs/design/forest-look-prototype.html`, published): the person picker's New
  person details check the typed name, email and phone against everyone she has, contacts and
  applicants alike, and say which matched ("Same phone as the Ito family", Use them or Create
  new); saving checks all three too.
- Fixed: leaving a box by tapping a button (Save) redrew the page first and the tap was lost;
  moving to another box lost focus and could scramble what she typed next. Redraws now wait
  for a button's own redraw, and keep her in the box she moved to.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D23, a sale's Add-ons and one-off add-ons

- The owner's D23 in `docs/KennelOS_UI_Redesign_Plan.md` §8. Prototype
  (`docs/design/forest-look-prototype.html`, published): a saved sale's **Add-ons** uses Add
  sale's picker (only its add-ons, + Add, Edit amounts; transport keeps partner, their price,
  reward, Get driving miles and the settings links; boarding its duration note). A list add-on
  at another price makes a **one-off add-on** (prefilled, never offered), or uses the one-off
  that already has those values. Business › Add-ons › One-off add-ons lists them, with the
  sales using each.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype draws More's screens

- Prototype (`docs/design/forest-look-prototype.html`, published): More's stubs drawn in its own
  components, from what the live app's pages hold. **Backup & Restore**: Back up / Restore tabs,
  then Cloud, This device or Dropbox; cloud status and Back up now; a file backup with a warning
  past two weeks; restore from the cloud's 30 days of backups or a file, showing what's in it,
  Merge, or Replace all after a second confirm. **Import / Export**: import by type (kennels
  first) or several files at once, blank templates, Find duplicates, Export everything.
  **Danger zone**: what's on this device, then Reset KennelOS (type RESET, sign out of cloud
  backup, Delete everything). **Sharing**: for families (Companion messages, Furever), your
  helper, other breeders (dog cards). **Storage**: Documents, Shows; Accounts point to Business.
  **Kels**: an unfinished task, Finding / Understanding something, and every task with search
  and stars. Design notes gain a "More" section; the plan's status lists them. The Lucide
  `star` icon is built in.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D24, possible duplicates on the hubs

- The owner's D24 in `docs/KennelOS_UI_Redesign_Plan.md` §8, drawn for her review. Prototype
  (`docs/design/forest-look-prototype.html`): Dogs, People, Litters, Sales and Financials show
  one row when they have possible duplicates ("1 person and 1 kennel may be entered twice"; Sales
  has none, so no row), opening **Possible duplicates** for that kind: each pair side by side
  with differences marked, Not the same, or Merge (keep which, which value wins). Import /
  Export's Find duplicates lists every kind. Design notes gain "Possible duplicates".
- For the build (in D24): counts worked out on the device after a data change, read by the hub,
  never sent to the server.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D24, a certain match leads with Use

- The owner's answer, in D24 (`docs/KennelOS_UI_Redesign_Plan.md` §8): on an add form a certain
  match leads with **Use [name]**. Prototype: one shared match note for Add dog (same registered
  name; as sire or dam from a pedigree), Add person, Add family and the person picker (same
  email or phone): an amber note with **Create new** and **Use [name]**; a name alone stays a
  "Possible match" line. The Marsh family's sample details in Possible duplicates now match
  their person page.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: Carry-over note C1, pedigree import and call names

- `docs/KennelOS_UI_Redesign_Plan.md` gains §9 *Carry-over notes* (live gaps to close when a
  screen is rebuilt) with the owner's **C1**: a sire or dam typed through Kels by call name only
  isn't matched when the same dog arrives on a pedigree chart (the import matches by number and
  registered name only), so it becomes a second dog. When pedigree import is brought over: also
  compare call-name-only dogs, by position first, in review; fill blanks on a match; offer the
  registered name and number when adding an outside parent; and raise already-split pairs in
  Possible duplicates.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype draws Documents

- Prototype (`docs/design/forest-look-prototype.html`): More › Storage › **Documents**, from the
  live page: every document under its dog (newest first), type chips with counts (pedigree,
  health test, vet summary, registration, contract, other), search over titles, labs and
  results, the shared filter for date and dog; each dog's name opens the dog. Storage's line
  for it now names what it holds. Design notes and the plan's status updated.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: Documents where she looks for them

- Prototype (`docs/design/forest-look-prototype.html`): screens already drawn that should show
  documents now do. Every dog gets a **Documents** tile (its documents, newest first, Add, All
  documents); a health test names its certificate, or says none is attached and opens Log a test;
  a contract's signed copy says it's in the pup's documents, and **Attach signed contract** (or
  another copy) files a scan with the dog, as live's contract page does; search has a Documents
  group; More's Storage line is "Documents and shows". Sample documents gain Hazel's contract and
  the Clover × Titan stud contract.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: D25, documents for more than a dog; smaller files (planned)

- `docs/KennelOS_UI_Redesign_Plan.md` §8 gains **D25** (asked by the owner; planned, not built):
  a document belongs to a dog, the kennel, a litter, a person, a sale or a stud service
  (additive `owner_type` / `owner_id`, `dog_id` kept), types by owner, Documents grouped by owner
  with tiles on the litter, person and sale pages and Setup › Your kennel. Smaller files: scanned
  PDFs compressed like photos (vendored pdf.js on that path only), text and signed PDFs never
  touched, one copy per file on the phone by SHA-256, storage use shown. Three open questions.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: No plumbing copy (D8, every screen)

- The owner: no copy exists to tell her about the plumbing. D8's "her terms, not ours" in
  `docs/KennelOS_UI_Redesign_Plan.md` §8 now says it applies to every screen, with what counts.
- Prototype: removed "in Poppy's documents" and "filed in … documents" (contracts), "stored on
  this device, and in your cloud backup" (Documents), what moves where on a merge (now "Willow
  keeps everything from both"), "your helper's app reads it from there" and "through your
  Dropbox" (Backup, Sharing), "Everything stays on this device" (Kels), "on this device" on
  Find duplicates, the Accounts-are-in-Business row (Storage), "never stored" (relationships),
  the private vault wording on What gets backed up (now what it means for her), and Danger
  zone's "On this device" heading (now "Your records").
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype: one Sale screen, and her go-home checklist

- The owner: a sale was spread over about six screens that repeated each other (the Sale's
  summary card, its Payments, Add-ons, Go-home weekend and family rows, and the family page's
  Sale, Payments, Go-home and Contract tiles, with a balance bar that led back to the sale).
  The go-home date belongs on the sale screen but stays a pickup on the calendar. She wants a
  go-home checklist of her own, each item linked to what checks it off; likely a new table.
- `docs/design/forest-look-prototype.html`: a pup's **Sale** is one screen: the family (opens
  their page) and when it goes home, with Change for date, time and place in place (saved as
  the pickup: calendar and go-home lists follow); **Money** (puppy, each add-on, total, paid,
  balance; due dates with Change for the schedule or due date in place; money received and
  Record a payment; Send invoice / receipt and Payment link; what she nets after a fee); the
  contract; and "Before <pup> goes home". The old Payments address opens the sale. Sale details
  loses its Balance card. The family page has one Sale tile (pup, amount due, go-home) and no
  balance bar; the dog's tile is **Sale**. A litter's **Go-home** opens with its ready date
  (Change in place; Pricing's Dates points there) and each sold pup's checklist in go-home order.
  **Go-home checklist** (Setup › Go-home): her items in her order, each ticked by hand or linked
  to a vet visit, vaccination or dewormer on the pup, its microchip, the contract signed, the
  balance paid, Print puppy records or Send Furever link; an item not done opens what does it
  (Add event opens with the type picked). Design notes: Sales, contracts and money; new Go-home.
- Live check (owner asked): live already has everything the sale's money needs (schedule,
  payments, extras, refunds, payment links, net). Not in live: third-party transport partners,
  a microchip-registered or go-home-pack field, and the checklist (a new table when built).
- Then (owner): tiles were never the problem, tiles repeating each other were. The Sale is a
  hub again: status, registration, the family and go-home (Change in place) at the top, then
  one tile per thing: **Payments** (all the money, the screen above), **Add-ons**, **Contract**,
  **Go-home** (that pup's checklist, `S.salegh`). Payments follows the tab it's opened from.
- Docs only: no code, tests or service-worker change.

## 2026-11-21: D26, hubs built one way, with a stage bar (prototype)

- The owner: tiles weren't the problem, tiles repeating each other were. Dogs, litters,
  pairings and sales should be built and changed the same way, with everything live lets her
  change reachable in sensible groups; rows in lists open to edit; a litter's header should
  move its status in one touch, since that status drives so much. Recorded as D26 in
  `docs/KennelOS_UI_Redesign_Plan.md` §8.
- `docs/design/forest-look-prototype.html`: a stage bar under the header on a puppy (its plan),
  a litter, a pairing and a sale, each with its next step and every stage one tap away; the
  steps follow live's status rules (litter births, ready, sold and close; pairing bred,
  confirmed adds the expected litter, ended takes it off; a sale's money stages follow
  payments and Mark delivered asks live's delivery questions). Headers lose Add event and Edit.
  **Details** on every hub, with Edit: Litter Details' Edit is new (whelp or breeding dates,
  delivery, litter registration, website, foster, nickname, notes, Archive). A pairing has its
  own hub (`S.pairing`): Details and Edit (dam, sire, dates, method, website, notes, Delete),
  Pairing check, Breeding (the dam's breeding events), Litter; pairing rows open it; a
  Breeding logged on a dam with a planned pairing marks it Bred. A sale: Details (buyer,
  stage, date, registration, source, notes; Edit changes the buyer) and **Price & payments**
  (Edit: price, deposit, channel). Events (History, Breeding), expenses, Entries and documents
  open to edit or delete; money received points to where it was recorded.
- Then (owner): Record the birth had no way to finish. Births, on an expected litter with a pup
  recorded, ends with "Is that all of them?": delivery, then Done whelping, which marks the
  litter and its pairing whelped and returns to the litter, now showing its whelped tiles.
- Docs only: no code, tests or service-worker change.

## 2026-11-21: The prototype: a litter's pups are its own; Puppy care

- The owner: a litter's Puppies didn't list the pups just recorded; she needs one entry for
  the whole litter (weights, vet visit, deworming, vaccines) saved on each pup; pups need an ID
  at birth, since "puppy 1" means nothing the next morning; and anything else live does for a
  litter (litter page, Kels) should have a place on its tiles.
- `docs/design/forest-look-prototype.html`: Births asks each pup's **ID collar** (next free
  color, live's `guidedLitter.COLLAR_COLORS`) and an optional name, and saving makes the puppy
  record ("Red collar"), with its own history from birth. **Puppies** lists the litter's own
  pups. **Puppy care** replaces Weigh puppies: Weigh, Vet visit, Shots, Deworming, Screening
  test, Medication, Microchips and Something else, typed once and saved as one event per pup
  ticked (live's `cascadeTargets` and the care visit), with one entry shown for the litter.
- Then (owner): weights in pounds and ounces, with AM / PM at the top (live's check-in
  weighs the same way); shown everywhere as "9 lb 10 oz".
- Docs only: no code, tests or service-worker change.

## 2026-11-21: The prototype: puppy plans and puppy records on the litter

- The owner: each pup's plan (disposition) and registration set from the litter, and puppy
  records, which go to the top once the litter is Ready.
- `docs/design/forest-look-prototype.html`: a litter's **Puppies** is a card per pup with its
  plan (Undecided, Available, Keeping, Health hold; Placed shows its family) and registration
  (Limited, Full, Co-own, None: live's `intended_registration`); Add sale starts from it, and a
  sale at another registration says so. **Puppy records**: each pup's record from its history
  (parents, birth, microchip, registration, family, shots, deworming, vet visits, weights),
  printed or not, Print all, Send to families, and one record to Print or Send; printing ticks
  the go-home checklist's Print puppy records. From Ready it is the litter's first tile.
- Then (owner): no Births tile (it led where Puppies does) and no Pairing check tile on a
  litter. Puppies opens with the birth (born, alive, delivery, stillborn, Add a pup you
  missed) and each pup's birth order, time and weight; Record the birth stays on the stage
  bar; Births records a missed pup on any litter not closed.
- Docs only: no code, tests or service-worker change.

## 2026-11-21: Waitlist review against live; same-screen duplicates

- The owner asked for the waitlist checked against live (same rules, what's missing, what's
  duplicated), then set the duplicate rule: second ways in are wanted; two ways into the same
  place on the same screen are not (added to D26).
- `docs/design/forest-look-prototype.html`: the Waitlist hub drops the Applications, Fees due
  and Family requests tiles (Needs you opens them); a family's Offers & passes has Sell them a
  pup once; a pairing with warnings shows them without a Pairing check tile beside them;
  Willow × Ash drops the Go-home weekend row beside its Go-home tile.
- Missing against live, for the owner to order: open / close picks from the preview, every
  open litter selling at once with Offer to them, Review sale & send after a pick, backing
  out, re-apply, the Ready now? check, turn timing (open days, closed dates, hours,
  countdowns), automatic offers, family pages without the list, a lost pup's family back in
  line with a credit, the answer-change log, Almost your turn / Communicate, fee paid online
  and a family's invoices, the application form editor and import, waitlist import, the
  public list, waitlist policies.
- Docs only: no code, tests or service-worker change.

## 2026-11-21: The redesign plan lists this review's screens and the waitlist still to draw

- The owner: put everything from this review in the plan, drawn or proposed.
- `docs/KennelOS_UI_Redesign_Plan.md`: §5's Dogs, Litters, Waitlist, Business and Setup
  phases name the new screens; §5.1 lists what was drawn (hubs and stage bars, the pairing
  hub, the litter's Puppies, Births, Puppy care, Puppy records and Go-home, the sale hub and
  Price & payments, the go-home checklist and the data it needs, rows that open to edit);
  §5.2 lists the 16 live waitlist features the prototype doesn't draw yet, each with its
  source plan and proposed place, first six first.
- Docs only: no code, tests or service-worker change.

## 2026-11-21: D27, a day's events grouped in a history (proposed, drawn)

- The owner: a go-home-ready visit fills a pup's history with separate events from one hour;
  they must stay separate in the data but be grouped on screen.
- `docs/KennelOS_UI_Redesign_Plan.md`: D27 (three or more events on a date show as one card,
  titled by the day's vet visit, kinds counted, costs summed, opening to each event; no new
  data) and a §5.1 line. `docs/design/forest-look-prototype.html`: the timeline groups them;
  Hazel's history has a go-home exam day (vet visit, fecal, giardia, DHPP #2, Bordetella,
  dewormer) to show it.
- Then (owner): date grouping for now; later a grouping id on events, stamped by whatever
  saves several events as one job, which grouping prefers (D27, needs its own plan).
- Docs only: no code, tests or service-worker change.

## 2026-11-21: D28 stage-aware Home, D29 How connected; breeder-to-breeder and one-inbox plans

- The owner: Home's tiles shouldn't repeat the tab bar, and should follow the kennel's stage.
  `docs/KennelOS_UI_Redesign_Plan.md` §8 gains **D28**: no tile repeats a tab (tabs get count
  badges), three tiles follow the stage of each litter or pairing (between litters, planning,
  expecting, newborns, picks open, going home, after go-home), three stay (the type's, plus
  Website while a KennelPort site is linked and Messages while a channel is on), and a line
  under Today names the stage. The Website tile reads `pendingWebsiteChanges` on the device.
- **D29**: first-run setup asks How you breed and How connected (on my devices / the cloud),
  which picks one of each twin (Companion or the waitlist online; Dropbox and KennelAssistant or
  live sync; Furever or the puppy portal), read from use for existing breeders. Exceptions:
  Companion's partner bundle stays; the portal follows a linked site. Program Types plan §2 and
  §3 gain **Modified:** notes.
- `docs/KennelOS_Breeder_To_Breeder_Plan.md` (new): stud services as application, list and
  status; co-own and lease standing pages; sales between breeders with the hand-off; each
  delivered as a status page or into the other breeder's KennelOS; an opt-in public profile
  (region, never an address; Verified from records). Four phases, five open questions.
- `docs/KennelOS_One_Inbox_Plan.md` (new): KennelPort forwards contact-form and portal messages,
  sealed to her key, into the inbox status-page messages already use; replies go back the way
  they came; a brief for KennelPort's contract plan. README's doc map gains both rows.
- Docs only: no code, tests or service-worker change.

## 2026-11-21: The prototype draws D28, D29, breeder to breeder and Messages

- `docs/design/forest-look-prototype.html` (published to the artifact), for the owner's review:
  - **Home:** a pill per litter or pairing stage under Today; three stage tiles (each stage gets
    one before any gets a second), then Website, Messages and the type's tiles, never a tab;
    Litters gets a badge while pups are going home or newborn. The bar gains **Stage** (from the
    sample, or any one stage), **Connected** and **Website** to compare.
  - **Website** (from its tile): the changes waiting, Update website, then rows. **Messages**:
    one list marked Status page, Website, Puppy portal or Breeder; a thread replies the way the
    message came.
  - **First run** (in the bar): How you breed, then How connected. What you use gains How
    connected at the top and, when a twin is turned on, offers to stop the other. Sharing shows
    one of each twin; on the device answer, co-owners and stud clients keep Companion links.
  - **Breeder to breeder:** Studs gains Applications, Your stud page and each booking's steps
    (status page or in their KennelOS); Sharing gains Co-owns & leases (a page each), Sell to a
    breeder (with the hand-off, `.handoff`, skipped by a tap, still under reduced motion) and
    Your public profile (region, never an address; Verified from records).
- §3.1 lists the stage pills and the hand-off. Design notes gain four sections; search finds the
  new screens.
- Docs only: no code, tests or service-worker change.

## 2026-11-21: The prototype's sample, by stage

- The owner: the sample was crowded on every screen. `docs/design/forest-look-prototype.html`
  (published): the bar's **Stage** now opens on Picks open and shows one part of the year at a
  time; **Everything** is the old full sample. A table of tags (`SCENE_TAGS`) says which stages,
  connection and website each sample record belongs to, and how a record differs by stage
  (pups' plans, Willow × Ash's status, sales paid in full after go-home, Cedar sold to the Reyes
  family). Changing Stage, Connected or Website rebuilds the sample lists in place from a master
  copy, so screens read them as before. Home's This week and Coming up rows follow it.
- Fixed: the Puppies list left out undecided pups; Dogs opens on Breeding when there are no
  puppies; a trait screen threw on a puppy score without a label (on `main` too).
- Checked by following every link from every hub in eleven scenes (each stage, plus device-only
  and no-website), up to 900 screens each: no errors.
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
