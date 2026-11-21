# KennelOS — Program types: the breeder's kind of program drives her view (plan)

> Status: **plan only, nothing built** (2026-11-18). Every breeder sees the same app today,
> with features turned on or off one by one. This plan has her say what kind of program
> she runs, once at setup, and lets that set her tabs, Home, which features are on, and the
> order of a dog's sections. She can change any of it after. It goes with the UI redesign
> (the forest-look prototype) and with `docs/KennelOS_Line_Management_Plan.md` (§3.6
> there: who gets the line tools).
>
> **Decisions:** the owner's direction (2026-11-18) is that the type of program drives the
> view: a breeder who shows a lot needs show information close; one not breeding
> registered dogs doesn't need it at all; stud services may be absent or a main income;
> show breeders would use the line tools and large commercial kennels likely wouldn't.
> D1 is the owner's too: large kennels stay a type, with none of their gaps built yet. The
> rest (§6) wait on the owner.
>
> Prototype: Setup › How you breed, and "View as" in the prototype bar, switch the sample
> program between types.

## 1. The six types

Grouped from how breeders describe their own programs. Each lists the six things that
matter most to that breeder and where KennelOS stands today (**Built**, **Partly**, **Gap**).

### 1.1 Show / preservation breeder
One breed, 1–3 litters a year, conformation shows and a breed club; keeps show prospects,
sells pets on limited registration, often co-owns.

| # | Priority | Today |
|---|---|---|
| 1 | Show entries, results, points and titles | Partly: AKC CH/GCH only |
| 2 | Health testing to the breed club's standard, and what's due | Built |
| 3 | Pedigree, COI and pairing decisions | Planned: Line Management Plan |
| 4 | Co-owns and contracts (limited vs full, spay/neuter, breeding rights) | Built |
| 5 | Waitlist with careful review, show homes vs pet homes | Built |
| 6 | Titles across the pedigree, shared with co-owners | Built: titles, Dog Cards |

### 1.2 Family pet breeder (registered, not showing)
2–6 litters a year, raised at home, registered pets. Her day is the waitlist and families.

| # | Priority | Today |
|---|---|---|
| 1 | Waitlist: offers, picks, turn order | Built |
| 2 | Deposits, balances, payment schedules, receipts | Built |
| 3 | Go-home: pickup times, transport, contract, puppy pack | Partly: a go-home checklist is in the prototype |
| 4 | Puppy care schedule: weights, deworming, vaccines, milestones | Partly: no schedule template |
| 5 | Updates to families: photos, status pages, puppy portal | Built |
| 6 | Heat → breeding → whelping timeline with reminders | Built |

### 1.3 Doodle and mixed-breed program
Not registered or an alternative registry; many litters; usually guardian homes (her
breeding dogs live with families).

| # | Priority | Today |
|---|---|---|
| 1 | Guardian homes: where each dog lives, litters owed, return dates, retirement | Gap |
| 2 | Waitlist and reservations across many litters | Built; not tested at this volume |
| 3 | Generations (F1, F1B, multigen) and coat genetics | Gap; coat genes planned (Line Management) |
| 4 | Delivery: flight nannies, ground transport, meeting points | Partly |
| 5 | Marketing: available-puppy listing, website feed | Partly |
| 6 | Parents' genetic panels shown to families | Built |

### 1.4 Working, sporting and performance breeder
Field and hunt lines, herding, protection, sport; some sell started or trained dogs.

| # | Priority | Today |
|---|---|---|
| 1 | Performance titles and trial results (hunt tests, field trials, herding, IGP, agility) | Gap |
| 2 | Matching buyers by drive and purpose | Partly: placement purpose |
| 3 | Training records and started-dog sales | Partly: training stay as an extra only |
| 4 | Pedigree showing working titles | Partly |
| 5 | Stud services with proven working males | Built |
| 6 | Hips/elbows plus an injury and conditioning log | Built |

### 1.5 Stud-focused program
Stud fees are a main income; she may breed her own litters too.

| # | Priority | Today |
|---|---|---|
| 1 | Bookings: outside female, owner, fee terms (cash or pick puppy) | Built |
| 2 | Timing to the female's progesterone, shipping dates | Partly |
| 3 | Semen: collections, chilled shipments, frozen straws by tank, reservations | Gap |
| 4 | Results and guarantees (confirmed, litter size, repeat if it doesn't take) | Partly |
| 5 | Marketing each stud: health tests, titles, offspring | Partly |
| 6 | Money per male | Built |

### 1.6 Large or licensed kennel
Many dogs, sometimes several breeds, staff, a state or USDA license.

| # | Priority | Today |
|---|---|---|
| 1 | Compliance: vet program, care logs, inspections, license renewals | Gap |
| 2 | Many litters at once: whelping board, a whole litter weighed or vaccinated in one pass | Partly |
| 3 | Staff on several devices, and who did what | Partly: live sync, no roles |
| 4 | More than one breed or kennel | Built |
| 5 | Financials and taxes | Built |
| 6 | Selling at volume | Built |

It stays a type, and none of its gaps are built until a real user asks (D1, owner). Its
biggest needs are new (compliance, staff roles), and it is the type least likely to use
the line tools.

## 2. Questions that cut across the types

Asked on their own, not folded into a type:
- **Registered or not.** Not registered hides registration numbers, titles and show screens.
- **First litter or experienced.** A first litter gets Kels's step-by-step guidance.
- **Litters a year.** Changes how dense Home and the lists are.
- **Waitlist online or offline.** **Modified:** replaced by *How connected* (UI Redesign Plan
  D29), which picks between each local feature and its cloud twin, the waitlist among them.

## 3. How a type drives the view

At setup (Kels's first questions) and in Setup › How you breed she picks **one main type**
and **up to two others** ("show breeder who also stands studs" is common).
- **Features on** (Setup › What you use): the union of her types' defaults. Her own
  switches always win afterwards; picking a type again asks before resetting them.
- **Tabs and their order:** from the main type. Six at most; whatever drops off a tab is
  still a row in Business or More.
- **Home tiles:** the main type's six, in order. **Modified:** a tile never repeats a tab, and
  half the tiles follow the kennel's stage (UI Redesign Plan D28); the table's tiles are the
  type's choices for the slots that stay.
- **A dog's sections:** reordered for the main type (Shows first for a show breeder, Stud
  services first for a stud program); sections that don't apply stay hidden as today.
- **Line tools** (Line Management Plan §3.6): see the table.

| Type | Tabs (after Home) | Home tiles | Turned on | Line tools |
|---|---|---|---|---|
| Show / preservation | Waitlist, Dogs, Litters, Business, More | Waitlist, Litters, Dogs, Shows, Lines, Financials | Shows, contracts, co-owns, waitlist | **On** |
| Family pet | Waitlist, Dogs, Litters, Business, More | Waitlist, Litters, Dogs, Sales, Financials, People | Waitlist, payments, family pages | Warnings and relatives only |
| Doodle / mixed-breed | Waitlist, Litters, Dogs, Business, More | Waitlist, Litters, Guardian homes, Sales, Financials, People | Waitlist, delivery; registration and shows off | Warnings, relatives, colors |
| Working / performance | Dogs, Litters, Waitlist, Business, More | Litters, Dogs, Trials, Lines, Waitlist, Financials | Stud services, shows (trials later) | **On** |
| Stud-focused | Studs, Dogs, Litters, Business, More | Studs, Dogs, Lines, Litters, Financials, People | Stud services, contracts | **On** |
| Large / licensed | Litters, Dogs, Business, More | Litters, Dogs, Sales, Financials, Care logs, Waitlist | Multi-kennel, invoicing | **Off** (warnings stay) |

Pairing warnings and a dog's Relatives are never switched off by a type.

## 4. Gaps by type (each needs its own plan before it's built)
- Guardian homes (doodle).
- Performance titles and trials (working).
- Semen collections and inventory (stud).
- Compliance records and staff roles (large kennel).
- Generation labels F1/F1B (doodle; Line Management leaves room).
- A puppy care schedule template (family pet).

## 5. Data and code
- `Kennel.program_types` `{ main, also[] }` (program-wide; syncs) and the cross-cutting
  answers beside it. Classified in `syncRegistry.js` when built.
- The defaults live in `data/programTypes.js` (pure): per type, the features, tab order,
  Home tiles and section order. `editionConfig.js` still decides what an edition can show;
  a type only chooses among what the edition has, so the shared core stays edition-agnostic.
- `nav.js` reads the tab order; Home reads its tiles; the dog hub sorts its sections.

## 6. Decisions

| # | Question | Recommendation | Status |
|---|---|---|---|
| D1 | Serve large or licensed kennels | Yes, as a type; build none of its gaps yet; line tools off by default | **Owner, 2026-11-18** |
| D2 | One type or several | One main plus up to two others | Open |
| D3 | What a type sets | Features, tabs, Home tiles, section order; never locks anything | Open |
| D4 | Changing type later | Asks before resetting her own switches | Open |
| D5 | Lite | Lite asks the same question; tabs come from what Lite has | Open |
| D6 | Names shown to her | "Show / preservation", "Family pet", "Doodle or mixed-breed", "Working / performance", "Stud services", "Large or licensed kennel" | Open |
