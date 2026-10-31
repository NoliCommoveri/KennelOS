# KennelOS — Family Requests Plan (extras, pickup, transport, backing out)

> **Status: draft, nothing built.** Asked by the owner (2026-10-31). Families whose pup is
> picked can ask for extras (photo and training packages), book a pickup time and place, see
> her transport suggestions, and tell her they're backing out, all from their status page.
> Decisions are in §8; nothing is built until they're answered.

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
   worked out (never the pup's birth date, never sale amounts unless D1 says so).
2. **The family taps** on their status page (signed in, as every action). The server checks
   it against what was published and stores a **pending event** (`familyActions.js`).
3. **Her device applies it** at the next sync as a request on the entry, shown on Today
   (`waitlist-*` nudge), the entry page and Kels's Review my waitlist (step 1).
4. **She approves or declines** (or, per D2, some are approved automatically); the change
   lands on the sale / events through the repos, and the page shows the result after the
   next projection push.

New `FAMILY_ACTIONS`: `extra_request`, `extra_cancel`, `pickup_book`, `pickup_cancel`,
`back_out`. Each is allowed only while her device says the family has an open sale (the
`companion.available` rule).

## 3. Extras with groups and age windows

**Price list rows grow** (all optional, additive, read with defaults):

| Field | Meaning |
|---|---|
| `group` | Her group name, e.g. "Photo packages", "Training". The list is shown grouped; she can rename a group (renames every row in it). |
| `family_can_request` | Shown on the status page (default off, so today's lists stay private). |
| `request_from_weeks` / `request_until_weeks` | Age of the pup (from the litter's birth date) when a family may ask. Blank = no limit. |
| `cancel_until_weeks` | Last age at which a family may cancel it themselves; after that only she can. |
| `boarding_days` | A package that needs the pup to stay (training): how many days of boarding it adds (§6). |
| `description` | A line the family sees. |

Her example "under 6 weeks they can do X; over 7 weeks they can do Y" is two rows:
X with `request_until_weeks: 6`, Y with `request_from_weeks: 7`.

**Proposed:** windows are per row, with an optional **group default** she sets once
(`Kennel.extra_charge_groups[]` = `{ name, request_from_weeks, request_until_weeks,
cancel_until_weeks }`) that rows without their own window follow. See D3.

**On the sale**, `Sale.extra_charges[]` rows gain `list_id` (the price-list row it came from),
`group`, `status` (`requested` / `confirmed`; a cancelled one is removed, D2) and
`requested_date`. Only `confirmed` rows count as income and print on invoices; `requested` rows
show on the Sale page with **Confirm** / **Decline**.

**Published per family:** the rows they may ask for now, each with its `open_until` date
(her device turns weeks into dates from the litter's birth date), plus the extras already on
their sale with `can_cancel_until`. The server only compares dates to today.

## 4. Pickup scheduler

- **Her locations:** `Kennel.pickup_locations[]` = `{ id, label, address, lat?, lng?, notes }`
  (home, a meetup spot, the airport). One is her **standard location** (`is_home`).
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
- **Their own spot instead** (optional, D5): "None of these work: suggest a place" with an
  address; she accepts it with a price (§5) or answers with a message.
- **Cancel / rebook** until a cutoff she sets (`pickup_change_days`, default 2 days before).

## 5. Mileage and transport fee

Three levels, cheapest first (D4):
1. **A directions link** (no service): every location and a family's suggested spot gets
   **Open in Maps** from her standard location; she reads the miles and types them.
2. **Straight-line estimate** (offline): from the lat/lng saved on each location (she pastes
   them, or taps **Use my location** at the spot), haversine × 1.25 for roads, shown as
   "about 48 miles". Good enough to quote; not for exact billing.
3. **Driving distance** through a routing service (OpenRouteService has a free tier; Google's
   Distance Matrix is paid): a call through `cloudApi.js` and the Worker, so it needs the
   cloud, a key and an outbound call carrying both addresses to that service.

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
    for a cancelled sale too) to their next pick; they go back in line (their old place, or
    the end, D7) or are offered a pup now.
  - **Refund:** sale `voided`, end reason `buyer_backed_out` (a new reason, so the deposit
    isn't income).
- The family sees the result on their page and gets an email (her template).

## 8. Decisions needed

- **D1. Prices on the server.** Requesting extras needs names, descriptions and prices on the
  status page, which today carries no money details (§5.3). Proposed: publish her
  `family_can_request` rows' prices (she's choosing to show them, like a public price list);
  never the sale's totals, deposit or balance.
- **D2. Automatic or approved.** Proposed: extra requests and cancellations inside the window,
  and slot bookings, apply automatically; backing out always waits for her.
- **D3. Windows per row, per group, or both** (proposed both, row wins).
- **D4. Mileage level** to build first (proposed 1 + 2; 3 later, only if she asks).
- **D5. Family-suggested meetup spots** in the first version, or slots only.
- **D6. Training ↔ boarding link** on the event (proposed) or on the sale's extra row.
- **D7. Moved deposit, place in line:** their old place, the end, or her choice each time.
- **D8. Transport suggestions:** reuse her recommended list (`Kennel.recommended`) with a
  **Getting your pup home** group (flight nannies, their sites, notes), shown to picked
  families; optionally only when their area is over her `far_miles` setting.
- **D9. Edition:** all of this Pro (it rides the online waitlist).

## 9. Proposed build order

1. Price list groups, windows and `family_can_request` (her side only; no server).
2. Transport suggestions on the status page (D8: smallest server change).
3. Extra requests and cancellations (status page, pending events, Sale page Confirm).
4. Training packages ↔ boarding.
5. Pickup locations and slots, booking, then mileage (level 1 + 2).
6. Backing out with her deposit policy.
7. Kels: Review my waitlist picks these up in step 1 (requests) and step 2 (backing out).
