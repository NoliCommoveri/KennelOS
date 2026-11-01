# KennelOS — Family Requests Plan (extras, pickup, transport, backing out)

> **Status: decided, nothing built.** Asked by the owner (2026-10-31). Families whose pup is
> picked can ask for extras (photo and training packages), book a pickup time and place, see
> her transport suggestions, and tell her they're backing out, all from their status page.
> Every decision is in §8 (all made 2026-11-01).

## 1. Where things are now

- **A picked family's status page** (`cloud/src/familyPages.js` `statusView`) shows only their
  status, her recommended products, **Request my Companion link** (while a sale is open) and
  the message box. Waitlist buttons stop at the pick. Sale and money details never go to the
  server (Waitlist Spec §5.3, §8.1).
- **Extras:** `Kennel.extra_charge_list[]` = `{ id, label, amount }` (a price list) and
  `Sale.extra_charges[]` = `{ id, label, amount, fee_for? }`, copied from the list
  (guide §21.2). No grouping, no rules, nothing a family sees.
- **Pickup:** a `placement` event on the pup (method from `PLACEMENT_METHODS`: Flight nanny,
  Ground transport, Local pickup, Other; a free-text time and location), driven by
  `goHome` and Kels's Pups are going home. No slots, no saved locations.
- **Boarding:** a `boarding` event on the dog (span, reason, contact); a sale's deferred
  boarding fields price it. Nothing ties a boarding stay to an extra.
- **Transport:** `Sale.transport_fee`; `Kennel.location` is free text. Nothing computes miles.
- **Backing out:** she cancels the sale herself (status `cancelled`, deposit stays earned).
  `carried_payment` moves money to a next pup only for a **lost** sale (pup died, failed a
  health check, health return: `restoreAfterLostSale`), never a cancelled one.

## 2. How every family request works

The same path as pause requests and the Companion link request today, so the server stays
narrow:
1. **Her device publishes** what a family may do now, as dates and choices it has already
   worked out (never the pup's birth date, never a price or a sale amount: D1).
2. **The family taps** on their status page (signed in, as every action). The server checks
   it against what was published and stores a **pending event** (`familyActions.js`).
3. **She hears about it** the way she hears about family actions today: an app alert
   (`notify.js` `notifyEvent`, a new `ACTION_KINDS` entry per request) and a line in her email
   digest, if she has those on. Her device applies it at the next sync as a request on the
   entry, shown as a Today nudge (`waitlist-request`, one per request, with **Approve** /
   **Decline** on the nudge itself), on the entry page and in Kels's Review my waitlist
   (step 1).
4. **Nothing changes until she taps Approve** (D2): every request waits for her. Approve does
   the whole job in one tap: adds or removes the charge on the sale, creates or removes the
   boarding or drop-off event, cancels the sale, and so on, through the repos. The family's
   page shows "Waiting for [her name]" until then, and the result after the next projection
   push. Decline asks for an optional note to the family.

New `FAMILY_ACTIONS`: `extra_request`, `extra_cancel`, `pickup_book`, `pickup_cancel`,
`back_out`. Each is allowed only while her device says the family has an open sale (the
`companion.available` rule).

## 3. Extras with groups and age windows

**Price list rows grow** (all optional, additive, read with defaults):

| Field | Meaning |
|---|---|
| `group` | Her group name, e.g. "Photo packages", "Training". The list is shown grouped; she can rename a group (renames every row in it). |
| `family_can_request` | Shown on the status page by name (never its price; default off, so today's lists stay private). |
| `request_from_weeks` / `request_until_weeks` | Age of the pup (from the litter's birth date) when a family may ask. Blank = no limit. |
| `cancel_until_weeks` | Last age at which a family may cancel it themselves; after that only she can. |
| `boarding_days` | A package that needs the pup to stay (training): how many days of boarding it adds (§6). |
| `description` | A line the family sees under the name (optional). |

Her example "under 6 weeks they can do X; over 7 weeks they can do Y" is two rows:
X with `request_until_weeks: 6`, Y with `request_from_weeks: 7`.

**Decided (D3):** windows are per row, with an optional **group default** she sets once
(`Kennel.extra_charge_groups[]` = `{ name, request_from_weeks, request_until_weeks,
cancel_until_weeks }`) that rows without their own window follow. See D3.

**On the sale**, `Sale.extra_charges[]` rows gain `list_id` (the price-list row it came from)
and `group`. A request isn't a charge: it lives on the waitlist entry (`requests`, as pause
requests do) until she approves, and **Approve** adds the row (name and amount copied from her
price list, as today) or, for a cancellation, removes it. So nothing about income or invoices
changes.

**Her extras page settings** (Waitlist settings, per kennel, in `waitlist_config`; D1):
- `extras_info_url`: a link to her own web page with the packages and prices. It must be an
  `https://` address. The status page shows it as **See our extras and prices**, opening in
  a new tab (`target="_blank" rel="noopener noreferrer"`).
- `extras_intro_text`: her message above the list, e.g. "We offer several paid extras to our
  families. Please click the link below to see the details before making your selection
  below." Blank = that sentence as the default.

**What the family sees** (only with an open sale and at least one requestable extra): her
message, the link, then the extras they may ask for **now**, grouped under each `group` as a
heading, names only (plus `description`), each with **Request**; and the ones already on
their sale or requested, with **Cancel** while `can_cancel_until` hasn't passed.

**Published per family:** those names and groups, each with its `open_until` date (her device
turns weeks into dates from the litter's birth date), plus their current extras with
`can_cancel_until`. No prices, no amounts. The server only compares dates to today.

### 3.1 When extras are paid: due dates and part payments

Today every extra is paid with the balance. An extra can instead carry a **payment plan**:
steps that each take a percent of its amount and a due date worked out from a rule.

- **On the price list** (per extra, or as the group default, as D3's windows):
  `payment_plan: [{ percent, due, n? }]`, the percents adding to 100. `due` is one of:
  - **at the pup's age**: `at_weeks`, `n` weeks old (from the litter's birth date);
  - **when she approves it**: `on_approval`, optionally `n` days after;
  - **before pickup**: `before_pickup`, `n` days before (from the pup's drop-off event);
  - **with the balance**: `with_balance` (today's behaviour, and the default when an extra
    has no plan).

  Her training example: 50% at 8 weeks, 50% with the balance. Editing the plan in the price
  list changes only extras approved afterwards.
- **On the sale**, approving the extra copies the plan as dated steps:
  `Sale.extra_charges[].payments = [{ id, percent, amount, due_date, paid_date }]` (amounts to
  the cent, the last step taking any rounding). A step "with the balance" or "before pickup"
  whose date isn't known yet keeps `due_date` blank and is read live (the balance due date,
  the drop-off event) until then. She can change any date or amount on the Sale page.
- **Income:** each step is earned on its own `paid_date`; a step without one is earned with
  the balance, as extras are today (`incomeView`: one `extra` component per step, keyed
  `extra:<id>:<step>`). Financials still files them all under **Extra charges**.
- **Invoices:** the invoice generator offers each unpaid step as its own line, named "Puppy
  training, 50% (due Nov 21)", prefilled with that step's amount and Due by date (the
  existing `cfg` `mode: 'partial'`, `collected`, `dueDate`). Marking the invoice paid (the
  receipt, or a payment-link payment through an integration) sets that step's `paid_date`.
  A sale's **Send payment link** works the same way.
- **Reminders:** a Today nudge, `extra-due`, from 7 days before a step's due date until it's
  paid: "The Lees' 50% for Puppy training is due Nov 21" → **Make the invoice**. Kels's Pups
  are going home lists unpaid steps with the balance.
- **The family's page** shows no amounts or dates (D1); they get the invoice or payment link
  by email from her, as today.

## 4. Pickup scheduler

- **Her locations:** `Kennel.pickup_locations[]` = `{ id, label, address, notes,
  is_standard }` (home, a meetup spot, the airport). Exactly one is her **standard location**,
  the start of every mileage figure. Each location has a **Show to families** switch: her
  standard location can be her home address, which she may not want listed.
- **Her times:** a new table `pickup_slots` (`id`, `kennel_id`, `litter_id?`, `date`,
  `start_time`, `end_time`, `location_id`, `capacity` default 1, `is_archived`), indexed on
  `kennel_id`, `litter_id`, `date`. Made on a new **Pickup times** section of the Litter page
  (or the kennel's, for all litters): **Add times** (a date, a time range, slot length,
  locations) makes the slots in one go.
- **The family books one** (`pickup_book`): the page lists open slots from the pup's ready
  date on, with location and address. Booking holds the slot on the server (like an accept
  holds a pup) so two families can't take the last place; her device then creates the pup's
  `placement` event (method Local pickup, the slot's time and location), which is what
  `goHome`, Today, Furever and the Companion page already read.
- **Only for families who live far enough away** (decided 2026-11-01): her setting
  `transport_min_home_miles` ("Families can suggest their own meetup place only if they live
  at least __ miles from me"). Closer families see only her listed places and times. That
  needs where they live (§4.1).
- **Their own address instead** (D5, decided), for an eligible family: "None of these work
  for us" → they type an address (and the date they'd like). The server measures driving miles from her standard
  location with Mapbox (§5) as they submit, and the request reaches her with the miles and
  the suggested transport fee.
  - **Within her range** (`transport_far_miles`, a Waitlist setting, e.g. 150): the page says
    "That's about 48 miles from us. [Her name] will confirm the time and any transport fee."
  - **Over it:** the page says "That's about 340 miles from us. [Her name] will be in touch
    about whether she'll bring your puppy herself or you'll need a flight nanny." Nothing is
    sent automatically: the request shows her the miles and offers the new **transport
    options** email (§5.1) to send with a tap.
  - Either way it's a request: she approves with a date, time and transport fee (the drop-off
    event is created, method Ground transport or Flight nanny), or declines with a note.
- **Cancel / rebook** until a cutoff she sets (`pickup_change_days`, default 2 days before).

### 4.1 Where the family lives (eligibility)

Two different distances, two map lookups, both from her standard location:
1. **Their home** (city and state is enough): decides whether they may suggest a place of
   their own at all. Measured **once per family** and remembered.
2. **The place they suggest:** prices the trip (§5). Measured per request.

Each is one Mapbox lookup (geocode the place, then one Matrix element); a city and state
geocodes to the town's center, which is close enough for "lives at least 200 miles away".

**Where their home comes from**, first found wins:
- their application's **City / state** answer, or the contact's address. While her
  `transport_min_home_miles` setting is above 0, **City / state is a locked, required
  question** on her application form (D17c, decided): it gets a `key` (`location`), she
  can reword it but not remove it or make it optional, and Set up my application form says
  why. Turning the setting back to 0 unlocks it;
- otherwise (applications from before the rule, families she added by hand) the status page
  asks once, when they first open the pickup section: "Where do
  you live? City and state is enough." (`home_location`, a new family action).

**Who measures** (D17a, decided): applications and contacts are encrypted to her device, so
the server can't read them.
- **From the application or contact:** her device measures (`cloudApi.getDistance`) once,
  when the family's sale opens, stores `home_miles` on the entry (a number, not their
  address), and publishes only `own_place_allowed: true/false`.
- **Asked on the status page:** the server measures as they submit, answers at once, and
  passes the city/state and miles to her device as a pending event, like any request.

Either way it's self-reported; she sees the city and the miles on the entry and can switch
`own_place_allowed` by hand (**Allow their own place** / **Listed places only**).

## 5. Mileage and transport fee

Two ways (D4, D4b decided):
1. **Driving distance through Mapbox:** road miles and drive time, with the cloud on
   (details below).
2. **An Open in Maps link** (no service) on every location and every family's suggested
   place, from her standard location: a check on Mapbox's figure, and how she gets miles
   when Mapbox isn't available (she types them in).

There's no offline straight-line estimate.

**Mapbox.** One key covers geocoding (address → point) and the Matrix API
(miles and minutes); a quote is one matrix element, so her volume sits far inside the free
tier (about 100,000 elements and 100,000 geocodes a month at the time of writing).
- **Key:** a Worker secret (`MAPBOX_TOKEN`), never in the app.
- **Server:** `POST /geo/distance` `{ from, to }` (addresses) → `{ miles, minutes }`: geocode
  both, then one Matrix call. Signed-in accounts only, rate-limited per account, addresses
  never logged (cloud rules). No key set → `503 geo_off`, and the app falls back to the Open in Maps link.
- **For a family's own address** the server measures it itself when they submit (same code,
  rate-limited per family, a few a day), so the page can answer at once. Her **standard
  location's address is on the server** for that: her device publishes it in a server-only
  part of the projection that no family view includes. **Decided (2026-11-01):** fine to
  hold, since her standard location is a public place near home (a store, a library), not
  her house; the settings screen says so in one line ("Use a public place near you, not your
  home address").
- **App:** `cloudApi.getDistance(from, to)`, the only network call, made when she taps
  **Get driving miles** (never automatically), gated by `cloudConfig.isCloudAvailable()`.
- **Stored:** only the miles and minutes (on the request or the sale, for the fee). The
  geocoded points and route are not kept: Mapbox's free (temporary) geocoding doesn't allow
  storing results.
- **Privacy:** both addresses go to Mapbox on each lookup; the privacy policy says so.
- **Why Mapbox:** one key for both steps, a generous free tier, no traffic needed for a
  quote. Google works too but needs a billing account and its Distance Matrix is now legacy
  (Routes API); OpenRouteService's free-plan commercial terms weren't clear.

### 5.1 The "transport options" email (new kind)

`transport_options` joins `EMAIL_KINDS` (not `SERVER_EMAIL_KINDS`: **she sends it, the server
never does**). It's a standard email like the status link email: one of the choices in the
family's **Communicate…** (`emailChoices`) whenever they have an open sale, and a **Send
transport options** button on an over-the-limit address request (and its Today nudge), both
opening the usual preview to edit before sending. A default template she can edit in Waitlist
settings like the others.
New placeholders: `{distance}` ("about 340 miles") and `{transport_options}`, filled from her
recommended list's **Getting your pup home** group (D8): each one's name, link and notes.
Default wording:

> Thanks for letting us know where you are. You're about {distance} from us, so we'll be in
> touch soon about whether we can bring your puppy to you or you'll need a flight nanny. In
> the meantime, here are the transport options our families have used:
>
> {transport_options}

Logged in the family's Messages and emails like the others, and shown on their status page.
`{distance}` comes from their latest address request; without one, that sentence is left out.

With miles known, her **transport fee settings** (Waitlist settings, per kennel) suggest
`Sale.transport_fee`, which she can change:
- **Fee per mile** (`mileage_rate`).
- **Calculate from:** radio buttons, **One way** / **Round trip** (`mileage_basis`; decided
  2026-11-01: a setting, not a fixed rule). Round trip doubles the miles before the rate.
- **No charge under** (`mileage_free_under`, default 0 = always charge): a trip shorter than
  this is free; at or over it, **every mile** is charged, from the first (decided
  2026-11-01: not subtracted). Compared against the miles being charged, i.e. after round
  trip doubles them (D11d).

The request shows the working: "340 miles one way × 2 (round trip) = 680 × $1.50 = $1,020",
or "18 miles: under your 25, no charge".

## 6. Training packages tied to boarding

- A price-list row with `boarding_days` is a **staying** package. Confirming it on a sale
  offers **Log the boarding?**: a `boarding` event on the pup, reason "Training", starting at
  the ready date (or her chosen date), for that many days, with `details.extra_charge_id`
  and `details.sale_id`.
- The pickup scheduler then lists only slots after the stay ends for that family, and the
  `gohome-boarding` nudge stops asking for boarding already covered.
- Cancelling the extra asks whether to remove the stay; moving the stay leaves the charge.
- New FK pair (`boarding.details.sale_id`) goes in `referenceRegistry.js` (D6: on the event,
  derived the other way, per the "no back-pointers" rule).

## 7. Backing out and moving a deposit

- **Back out** (`back_out`) on the status page for a family with an open sale: their reason
  (her list, `Kennel.waitlist_config.back_out_reasons`, default: changed our mind, family or
  money circumstances, the pup's health or temperament, timing, other) and a note. It's a
  request, not a cancellation: the sale stays as it is until she decides.
- **Her deposit policy**, set in Waitlist settings: rows of reason × pup age, each with an
  outcome: **keep the deposit** or **move it to another pup** (to the end of the line).
  Example: "changed our mind, under 6 weeks → move it; over 6 weeks → keep it"; "pup's
  health, any age → move it". Plus **policy text** families see before sending.
- **Her side:** the request shows the outcome her policy suggests for that reason and age,
  and her buttons are that outcome plus the others (she can always choose differently):
  - **Keep the deposit:** sale `cancelled` (today's rule: deposit stays earned).
  - **Move the deposit:** sale `cancelled`, deposit carried (`carried_payment`, now allowed
    for a cancelled sale too) to their next pick; they go to **the end of the line** (D7,
    decided), on their existing entry (§7.1).
  - **Refund** (D13, decided): sale `voided`, end reason `buyer_backed_out` ("Buyer backed
    out, refunded"), so the deposit isn't income. She doesn't plan to refund, so it's built
    so it can't be tapped by accident: not one of the main buttons, only under **More
    options…**, and it opens a confirm that says what it does ("Their $500 deposit won't
    count as income. Record that you refunded it?") with the Refund button off until she
    types **REFUND**. Her deposit policy (above) can't make it the suggested outcome.
- The family sees the result on their page and gets an email (her template).

### 7.2 Approving a back-out: she ticks what goes

Approve opens one confirm listing everything tied to that pup's sale, each with a tick box:
- **Extras**, with where each stands: "Puppy training: 50% paid, 50% due Nov 21",
  "Photo package: not started". **Ticked to remove** only when nothing on it is paid and its
  work hasn't started; anything paid or marked done starts **unticked (kept)**, since she's
  owed it. Each extra gets a **Done** tick on the Sale page (`completed_date`) so she can mark
  work finished, e.g. two weeks of training already given.
- **A boarding stay** not started yet: ticked to remove. One under way or finished: unticked.
- **A booked drop-off or pickup time**: ticked to remove (the time slot opens again).

What a **kept** extra means after the sale is cancelled:
- It stays on the sale with its payment steps, still **owed**: invoiceable from the Sale page,
  with its `extra-due` reminder, and counted as anticipated income until paid. (Today a
  cancelled sale drops everything unpaid; a kept extra is the exception, marked
  `kept_after_cancel` by this confirm.)
- With **Move the deposit**, kept extras stay on the old sale (that pup's work), never move to
  the next pup's sale; the confirm says so.
- With **Refund** (voided), a kept extra is still owed the same way, the one exception to a
  voided sale counting nothing.

The confirm ends with the outcome she chose ("Cancel the sale, keep the $500 deposit, keep
Puppy training (50% still due), remove the drop-off on Dec 2") and **Approve**.

### 7.1 Moving a deposit: reopen their entry, not a new application

Reasoning for reopening the family's existing entry (`placed` → `active`) rather than a new
application (`reapply`):
- **Their sign-in and link keep working.** The status page, its link and their 90-day
  sign-in are tied to the entry. A new entry means a new link, a new code and an email
  explaining why.
- **Nothing needs doing again.** A new application starts at `applied`: she'd review it,
  approve it and wait for a fee, for a family she just agreed to keep. `reapply` exists for a
  family coming back after a closed run (new fee, new place), which this isn't.
- **The history stays in one place:** their application, messages, passes, the offer they
  took and why they backed out, on one entry page.
- **It's how a lost sale already works** (`restoreAfterLostSale` reopens the entry), so the
  move reuses that path with one difference: the place.

What reopening does:
- **The end of the line:** `position_anchor_date` = the day she approves the move, so they
  sort after everyone already on the list (and among anyone else placed that day).
- **The offer they took** is closed with a new outcome, `backed_out`: not a pass (it doesn't
  use up a pass or trigger the two-pass removal) and not voided (it stays in their history).
  That litter goes on their `spent_litter_ids`, so it isn't offered to them again unless she
  offers it by hand.
- **Their application fee stays received**; `fee_credit_policy` still credits it to the sale
  that finally goes through, alongside the carried deposit.
- **Their preferences stay** as they were; they can ask to change them from the status page
  as any family can.

She can still choose **Keep the deposit** and let them reapply later (a new application, a
new fee, the usual path) when she'd rather start over.

## 8. Decisions

- **D1. Prices on the server. Decided (2026-11-01): no.** The status page shows extras by
  name, grouped, under her message and a link to her own page with the prices (§3).
- **D2. Automatic or approved. Decided (2026-11-01): every request waits for her**, with an
  app alert, a digest line, a Today nudge, and one tap on Approve to make every change (§2).
- **D4. Mileage provider. Decided (2026-11-01):** Mapbox (§5).
- **D5. Meetup spots. Decided (2026-11-01):** her listed locations (one standard), plus a
  family's own address measured with Mapbox; over her mile limit, the "be in touch" answer
  and the transport options email she sends with a tap (§4, §5.1). Her standard location
  (a public place) is held on the server to measure from (§5).
- **D7. Moved deposit, place in line. Decided (2026-11-01): the end of the line**, on their
  existing entry, reopened (§7.1).
- **D14. What approving a back-out also undoes. Decided (2026-11-01): she ticks which go**
  (§7.2), since some extras are already done and still owed.
- **D13. A refund on the books. Decided (2026-11-01):** the sale is voided ("Buyer backed out,
  refunded"), behind **More options…** and a typed confirm, since she doesn't plan to use it
  (§7).

- **D3. Age windows. Decided (2026-11-01):** both: a group default she sets once, and an extra
  with its own window overrides it (§3).
- **D4b. Fallback. Decided (2026-11-01):** Open in Maps links kept; no offline straight-line
  estimate (§5).
- **D6. Training ↔ boarding link. Decided (2026-11-01):** stored on the boarding event
  (`details.sale_id`, `details.extra_charge_id`); the sale finds its stays by query (§6).
- **D8. Transport suggestions. Decided (2026-11-01):** a **Getting your pup home** list,
  always shown to families with a picked pup under its own heading, and pulled into the
  transport options email. **Modified (built):** "her recommended list" is her Accounts marked
  Share with families, so the list is her accounts of the new **Transport** type.
- **D9. Edition. Decided (2026-11-01):** Pro only (it needs the online waitlist).
- **D10. Pickup times. Decided (2026-11-01):** per litter, with **Copy to another litter**;
  1 family per time by default (her choice per time); changes up to 2 days before (her
  setting, `pickup_change_days`).
- **D11. Transport fee. Decided (2026-11-01):** fee per mile with **One way** / **Round trip**
  radio buttons; **No charge under X miles** (every mile charged at or over it), compared
  against the miles charged (after round-trip doubling); "she'll be in touch" over
  `transport_far_miles`, default 150 (§5).
- **D12. Backing out. Decided (2026-11-01):** reasons (editable): changed our mind; family or
  money circumstances; the pup's health or temperament; timing; other. Her policy as rows of
  reason × pup age → keep / move (refund is never suggested, D13); families see her policy
  text before sending (§7).
- **D15. A family's own address. Decided (2026-11-01):** kept on the request and the drop-off
  event only, not added to their contact.
- **D16. Extras payment plans. Decided (2026-11-01):** all four due rules (at an age, on
  approval + days, before pickup, with the balance); set per extra with a group default;
  the `extra-due` reminder from 7 days before (§3.1).
- **D17. Where the family lives. Decided (2026-11-01):** her device measures from the
  application's City / state or the contact, else the status page asks and the server
  measures; City / state is a locked, required form question while the distance rule is on;
  `transport_min_home_miles` defaults to 0 (§4.1).

Every decision is made; the plan is ready to build in the order below.

## 9. Build order

1. Price list groups, windows, `family_can_request`, boarding days and payment plans (her
   side only; no server). **Built 2026-11-01** (guide §21.2).
2. Transport suggestions on the status page (D8: smallest server change). **Built
   2026-11-01** (guide §32 "Shared with families"): her recommended list is her Accounts
   marked Share with families, so transport is a new account type, **Transport (flight nanny,
   ground)**, shown under Getting your pup home and never with her recommended products.
3. Extra requests and cancellations (status page, pending events, Approve), with payment
   plans, part-payment invoices and the `extra-due` reminder. **Built 2026-11-01** (guide
   §29 "Extras", §21.2). Marking a step paid is a **Paid on** date on the Sale page; a
   receipt or a payment-link payment doesn't set it by itself yet.
4. Training packages ↔ boarding. **Built 2026-11-01** (guide §21.2, §7): the stay is logged
   with one tap (Today, or the entry page's confirm after Approve) rather than through the
   event form, so the link can't be lost; the pickup scheduler's "slots after the stay" waits
   for step 5.
5. Pickup locations and slots, booking; where families live and who may suggest a place;
   their own addresses with Mapbox miles and the transport options email. **Built
   2026-11-01** (guide §29 Pickup). **Modified:** times are stored on the litter
   (`Litter.pickup_slots`), not in a table of their own; a time's room on the server is
   counted from the family events her device hasn't applied, with no holds table; the fee
   settings sit on the Kennel page's Pickup & transport card with her places; the email's
   placeholders are `[Distance]` and `[Transport Options]`, in the templates' own style.
   **Added (2026-11-01, asked by the owner):** a rule per pickup date (not per time): it
   requires one of her extras (the date's times can't be chosen until the family has it;
   decided: block, not auto-request), or her standard boarding applies (decided: charged per
   day at her rate from when the pup could go home, and logged as a stay, on approval).
6. Backing out with her deposit policy. **Built 2026-11-01** (guide §29 Backing out).
   **Modified:** the offer keeps its outcome and gets `backed_out_date` (not a new
   `backed_out` outcome); a turn's litter backed out of counts as spent through it. Keep
   and refund close the family's run on the list (withdrawn).
7. Kels: Review my waitlist picks these up in step 1 (extras, pickup times, own-address
   pickups, with their follow-ups: training stays, boarding, a leftover transport fee, the
   transport options email) and step 2 (backing out, with the items and the pup back);
   extras payments due in step 7. Planned in `docs/KennelOS_Kels_Roadmap.md` §3.16, with
   three open questions there.
