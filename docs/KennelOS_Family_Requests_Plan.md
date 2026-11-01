# KennelOS — Family Requests Plan (extras, pickup, transport, backing out)

> **Status: draft, nothing built.** Asked by the owner (2026-10-31). Families whose pup is
> picked can ask for extras (photo and training packages), book a pickup time and place, see
> her transport suggestions, and tell her they're backing out, all from their status page.
> Decisions are in §8 (D1, D2, D4's provider, D5 and D7 decided 2026-11-01); nothing is
> built until the rest are answered.

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

**Proposed:** windows are per row, with an optional **group default** she sets once
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
- **Their own address instead** (D5, decided): "None of these work for us" → they type an
  address (and the date they'd like). The server measures driving miles from her standard
  location with Mapbox (§5) as they submit, and the request reaches her with the miles and
  the suggested transport fee.
  - **Within her range** (`transport_far_miles`, a Waitlist setting, e.g. 150): the page says
    "That's about 48 miles from us. [Her name] will confirm the time and any transport fee."
  - **Over it:** the page says "That's about 340 miles from us. [Her name] will be in touch
    about whether she'll bring your puppy herself or you'll need a flight nanny." and the
    server sends the new **transport options** email (§5.1) right away.
  - Either way it's a request: she approves with a date, time and transport fee (the drop-off
    event is created, method Ground transport or Flight nanny), or declines with a note.
- **Cancel / rebook** until a cutoff she sets (`pickup_change_days`, default 2 days before).

## 5. Mileage and transport fee

Three levels, cheapest first (D4):
1. **A directions link** (no service): every location and a family's suggested spot gets
   **Open in Maps** from her standard location; she reads the miles and types them.
2. **Straight-line estimate** (offline): from the lat/lng saved on each location (she pastes
   them, or taps **Use my location** at the spot), haversine × 1.25 for roads, shown as
   "about 48 miles". Good enough to quote; not for exact billing.
3. **Driving distance** through **Mapbox** (decided 2026-11-01): road miles and drive time,
   only with the cloud on (details below).

**Level 3 with Mapbox.** One key covers geocoding (address → point) and the Matrix API
(miles and minutes); a quote is one matrix element, so her volume sits far inside the free
tier (about 100,000 elements and 100,000 geocodes a month at the time of writing).
- **Key:** a Worker secret (`MAPBOX_TOKEN`), never in the app.
- **Server:** `POST /geo/distance` `{ from, to }` (addresses) → `{ miles, minutes }`: geocode
  both, then one Matrix call. Signed-in accounts only, rate-limited per account, addresses
  never logged (cloud rules). No key set → `503 geo_off`, and the app falls back to levels 1–2.
- **For a family's own address** the server measures it itself when they submit (same code,
  rate-limited per family, a few a day), so the page can answer at once. That needs her
  **standard location's address on the server**: her device publishes it in a server-only
  part of the projection that no family view ever includes. That's a privacy step (her home
  address, held readable by our server) she agrees to once when she turns on "families can
  give their own address"; without it, families can only pick her listed spots.
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

`transport_options` joins `EMAIL_KINDS` and `SERVER_EMAIL_KINDS` (the server sends it while
her phone is off), with a default template she can edit in Waitlist settings like the others.
New placeholders: `{distance}` ("about 340 miles") and `{transport_options}`, filled from her
recommended list's **Getting your pup home** group (D8): each one's name, link and notes.
Default wording:

> Thanks for letting us know where you are. You're about {distance} from us, so we'll be in
> touch soon about whether we can bring your puppy to you or you'll need a flight nanny. In
> the meantime, here are the transport options our families have used:
>
> {transport_options}

Sent once per address request, logged in the family's Messages and emails like the others,
and shown on their status page.

With miles known: `Kennel.mileage_rate` (per mile, optionally a round-trip switch and free
miles) suggests `Sale.transport_fee`, which she can change.

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
  outcome: **keep the deposit**, **move it to another pup** (back in line or a pup now), or
  **refund**. Example: "changed our mind, under 6 weeks → move it; over 6 weeks → keep it";
  "pup's health, any age → move it or refund". Plus **policy text** families see before
  sending.
- **Her side:** the request shows the outcome her policy suggests for that reason and age,
  and her buttons are that outcome plus the others (she can always choose differently):
  - **Keep the deposit:** sale `cancelled` (today's rule: deposit stays earned).
  - **Move the deposit:** sale `cancelled`, deposit carried (`carried_payment`, now allowed
    for a cancelled sale too) to their next pick; they go to **the end of the line** (D7,
    decided), on their existing entry (§7.1).
  - **Refund:** sale `voided`, end reason `buyer_backed_out` (a new reason, so the deposit
    isn't income).
- The family sees the result on their page and gets an email (her template).

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

## 8. Decisions needed

- **D1. Prices on the server. Decided (2026-11-01): no.** The status page shows extras by
  name, grouped, under her message and a link to her own page with the prices (§3).
- **D2. Automatic or approved. Decided (2026-11-01): every request waits for her**, with an
  app alert, a digest line, a Today nudge, and one tap on Approve to make every change (§2).
- **D3. Windows per row, per group, or both** (proposed both, row wins).
- **D4. Mileage.** **Decided (2026-11-01):** level 3 uses Mapbox (§5). Still open: build 1 + 2
  first and add Mapbox after, or all three together.
- **D5. Meetup spots. Decided (2026-11-01):** her listed locations (one standard), plus a
  family's own address measured with Mapbox; over her mile limit, the "be in touch" answer
  and the new transport options email (§4, §5.1). Open: her standard address held on the
  server to measure from (§5): agree, or measure only after she approves (no instant answer).
- **D6. Training ↔ boarding link** on the event (proposed) or on the sale's extra row.
- **D7. Moved deposit, place in line. Decided (2026-11-01): the end of the line**, on their
  existing entry, reopened (§7.1).
- **D8. Transport suggestions:** reuse her recommended list (`Kennel.recommended`) with a
  **Getting your pup home** group (flight nannies, their sites, notes), shown to picked
  families; optionally only when their area is over her `far_miles` setting.
- **D9. Edition:** all of this Pro (it rides the online waitlist).

## 9. Proposed build order

1. Price list groups, windows and `family_can_request` (her side only; no server).
2. Transport suggestions on the status page (D8: smallest server change).
3. Extra requests and cancellations (status page, pending events, Sale page Confirm).
4. Training packages ↔ boarding.
5. Pickup locations and slots, booking; families' own addresses with Mapbox miles and the
   transport options email.
6. Backing out with her deposit policy.
7. Kels: Review my waitlist picks these up in step 1 (requests) and step 2 (backing out).
