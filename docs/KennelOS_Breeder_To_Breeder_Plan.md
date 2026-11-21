# KennelOS — Breeder to breeder: studs, co-owns and leases, and sales online (plan)

> Status: **plan only, nothing built** (the owner, 2026-11-21). Work goes on `next`. Builds on
> stud services (`StudService`, End-State guide §4's entity table), co-own and lease contracts (`Contract`
> types `co_own` / `lease`, `OWNERSHIP_TYPE`), sales, the waitlist online (§29) and Dog Cards
> (`docs/KennelOS_Shared_Dogs_Plan.md`, whose phases 2 and 3 this plan leans on). The prototype
> draws it for the owner's review (`docs/design/forest-look-prototype.html`).

## 1. What it's for

Breeders deal with each other all the time: they stand studs for each other's females, co-own
and lease dogs, and buy pups from each other. Today each side keeps its own notes, and the other
breeder hears about it by text.

The owner's direction:
- **A stud service works like the waitlist, for semen instead of pups:** an application, a
  list, and a status page.
- **A co-own or lease is a standing status page:** what's agreed and what's due, always current.
- **A sale to another breeder hands the dog over:** it arrives in their KennelOS with everything,
  the step Dog Cards started.
- **Breeders want to be found.** Many of the other breeders will become KennelOS users, so this is
  also how KennelOS connects them.

## 2. Three shares, two ways each

A **share** is one dealing between two breeders: a stud booking, a co-own or lease, or a sale.
Each is delivered one of two ways, depending on the other breeder:

| | The other breeder isn't on KennelOS | They are |
|---|---|---|
| **What they get** | A status page (no account; signed in by a code to their email, as families are) | Records in their own KennelOS: the booking on their female, the co-owned dog kept matched, the bought pup |
| **Messages** | The status page's message box | The same thread, in both breeders' Messages (`docs/KennelOS_One_Inbox_Plan.md`) |
| **The invitation** | The page says "Track this in your own KennelOS" | n/a |

Each breeder keeps her own copy, notes, contacts and money (Shared Dogs §5, decision 2). Nothing
is two people editing one record: each share has one sender per kind of fact (below).

## 3. Stud services online

- **Her stud's page** (from her public profile, §6, or a link she sends): the stud's card (photos,
  tests and titles from her records), the fee and its structure, how he's available (natural,
  fresh chilled, frozen), and **Apply**.
- **The application:** the female's owner and kennel, the female (registered name and number,
  breed, date of birth, tests, with a Dog Card import when they have one), her expected heat, and
  the answers she asks for. Her own questions, as the waitlist form has (Waitlist Spec's form
  builder).
- **The list:** applications to review (approve, decline, ask a question), then **bookings** in
  expected-heat order, each a `StudService` once approved (`direction` from how it's done:
  shipped for chilled or frozen).
- **The status** the other breeder sees, as steps: Applied → Approved → Booked (expected heat) →
  Semen shipped or Bred (dates) → Confirmed (ultrasound) → Whelped → Paperwork (litter
  registration signed, the stud fee or the pick settled). She moves a step from the stud service,
  as she does today; the page follows.
- **Into their KennelOS:** the booking appears on their female as a planned pairing with an
  outside sire, filled from the stud's card. The dates and steps follow hers. The litter is theirs:
  when they record it, the whelped step and the count come back to her stud service.

## 4. Co-owns and leases

- **One standing page per co-owned or leased dog** for the other party, from the `co_own` or
  `lease` contract: the dog's card, the terms in plain words (breeding rights, litters owed, a
  pick back, lease dates, who the dog lives with), **what's due next** (the next litter owed, a
  lease end, a payment), and updates.
- **Into their KennelOS:** the dog is kept matched (Shared Dogs phase 2: the keeper sends), and
  with breeding rights, heats and breedings travel (phase 3, already decided). What's owed shows
  on both sides' Home when it comes due.
- **This replaces Companion's partner bundle** for co-owners and stud clients once built (UI
  Redesign Plan D29's exception). Until then the partner bundle stays.

## 5. Sales between breeders

- **The seller sells to a KennelOS user** from the same Add sale screen (D21): picking a buyer who
  is a connected breeder, or entering their KennelOS code, offers **Send them the dog**.
- **The buyer accepts on their side.** The pup arrives with the full Dog Card (parents and
  grandparents, tests, titles), plus vaccines and microchip (Shared Dogs §8 answer 2), the breeder
  filled in as the seller, and the registration transfer as a task.
- **The seller keeps the same dog record.** Its status changes to sold; it stays on her books like
  any sale (CLAUDE.md: one Dog table, a status change, never a new record).
- **Sold on co-own terms:** accepting opens the co-own share (§4), so the standing page or the
  matched records start there, with no second setup.
- **Not on KennelOS yet:** they get the status page and the Dog Card, with the invitation to
  import it.
- **The hand-off moment.** Accepting plays a short hand-off: the pup's card lifts off the seller's
  kennel crest, travels a path of paw prints and lands on the buyer's ("Hazel joined Thornfield
  Kennels"). Each breeder sees their half. It's KennelOS's own design, about 1.5 seconds; a tap
  skips it, and reduced motion shows the end state only. It's also used when a co-own starts.

## 6. Being found: her public profile

Breeders spend time and money to be found, so discovery is part of the product. What has to be
protected is narrower: a kennel's address is usually her home, with valuable dogs in it, and who
deals with whom is private.

- **Opt-in, off until she turns it on.** She picks what shows: kennel name, breeds, region (city or
  state, **never an address**), studs at public stud, upcoming litters, Apply and Contact.
- **Verified from records.** Health tests and titles on a profile carry **Verified from records**
  when they come from her KennelOS records (a result logged with its certificate, a title with its
  organization and date), not a typed claim.
- **Search:** by breed, region, studs available, upcoming litters. Families find breeders; breeders
  find studs.
- **Her KennelPort site is the full version.** A profile links to her site when she has one, and
  sends visitors there.
- **Private dealings are never listed.** Co-owns, stud clients, buyers and contract terms show only
  to the two parties of a share. A share starts only from a booking, a sale, an invite or a request
  from a profile.

## 7. Editions, cloud and privacy

- **Pro with cloud** (`cloudConfig.isCloudAvailable()`; `cloudUrl: null` shows none of it). Lite
  and the Demo don't send shares; the Demo can show a sample.
- **What goes to the server is a privacy decision for each field** (CLAUDE.md, sync registry):
  stud cards and profiles are public by her choice; a share's status steps, dates, terms summary
  and amounts are sealed between the two parties, as status-page data is today. To surface field
  by field when each phase is written up for building.
- **Server:** new tables for profiles, stud applications and shares. At most one migration per
  branch or merge (`next` counts as one), so each phase below is its own release.
- **Worker cost:** a status page and a profile are cached reads; a share updates when one side
  changes it, never per page open.

## 8. Phases

| Phase | What | Needs |
|---|---|---|
| **1. Stud services online** | §3 with the status page only | One migration (applications, bookings' published steps) |
| **2. Co-own and lease pages** | §4 with the status page only | Contract terms published, sealed |
| **3. Into their KennelOS** | Shares delivered as records; Shared Dogs phase 2 and 3; §5's sale hand-off | Shared Dogs phase 2's migration |
| **4. Public profiles** | §6 | One migration (profiles, search index) |

Each phase ships on its own; the prototype draws all four for the owner's review.

## 9. Open questions (the owner's)

1. Does a stud application have a fee (like the waitlist fee), or is the stud fee the only money?
   Recommended: her choice per stud, off by default.
2. Can a connected breeder skip the application (an existing client)? Recommended: yes, she can
   book them directly.
3. Is the public profile search inside KennelOS only, or also a public web page families can find?
   Recommended: a public page, since that's what gets breeders found.
4. Which tests and titles count as **Verified from records**: anything logged in KennelOS, or only
   results with a certificate attached? Recommended: a certificate or an official lookup link.
5. Who sends co-own updates when the dog moves between homes? Recommended: the keeper, as Shared
   Dogs §4 decided.
