# KennelOS: Stripe webhook for waitlist deposits (plan)

> Plan, not built. Goes on **`main`** (owner, 2026-11-19), not `next`.
> Builds on the Integrations plan (`docs/KennelOS_Integrations_Plan.md` §0 step 5 plumbing,
> §4 step 6 her own Stripe key) and the W2 server moves (`cloud/src/serverMoves.js`).

## The problem

A family picks a pup, and she sends a one-use Stripe deposit link (`stripeLinks.makeSaleLink`,
with `kennelos_sale_id` and `kennelos_component` in the metadata). Today her **device**
finds out the link was paid only when KennelOS is open (`checkStripePayments`, at most every
15 min). With the app closed:

- The hourly cron (`serverMoves.js` step 2, ~line 324) closes a picked turn whose respond-by
  date passed as `no_deposit` (when she ticked that in `auto_offer_on`), removes the pup's
  hold and offers the next family, **even if the family already paid**.
- The family's status page keeps showing the deposit as due.
- Even with the app open, a waitlist pick's deposit is **not recorded automatically**:
  `integrationEvents.planPayment` turns it into a Today review ("record the deposit on the
  family's page") because `confirmDeposit` is what places the family.

## The promise (owner, 2026-11-19): this is the rule, word for word in effect

When a family's turn opens, they have the scheduled time (24 hours) to select a pup and pay
the deposit. They can switch their selected pup up until the deadline. When the deadline
passes:
- **deposit received** → the pup selected at the deadline is locked in for them;
- **deposit not received** → their pup is released and available to the next family.

So, with auto offers on, the turn **stays open for exactly its scheduled time**. Nothing
closes it early, and a payment doesn't close it. **At the deadline** the server checks the
payment: if it was received, it takes the pup selected at that moment, reserves it, and opens
the next family's turn. If it wasn't, the turn closes as today (`no_deposit`): the pup is
released and the next family's turn opens.

## Decisions (owner, 2026-11-19)

- **S1. The promise above.** Only a received deposit counts, never a signed contract.
  Contracts are sent by hand and are **not** part of this work.
- **S2. Her own Stripe account does the setup and storage.** KennelOS makes no Stripe
  account or platform (D22 stands). The webhook endpoint is on her Stripe account. The Worker
  keeps only that endpoint's signing secret (`whsec_…`), sealed like Firma's token, to check
  the signature. Her `rk_` key stays on her device.
- **S3. What the webhook does:** it records the payment, so the family's status page shows the
  deposit as **received**, and the deadline check can see it. At the deadline, the selected pup
  is reserved from later families and the sale's deposit becomes paid.
- **S4. Her device may catch up on next open.** The sale, offer and family records update
  when she opens KennelOS, **as long as the paid-for pup can't be picked by the next family in
  the meantime.**

## Design

### 1. Connecting the webhook (her device, her key)

On a Payment service account with Stripe connected (`assets/vendorKeyUI.js` / the Accounts
page), add **Get payments while KennelOS is closed** to that page's dropdown (CLAUDE.md
button rule). Pro + cloud only (`cloudConfig.isCloudAvailable()`).

1. Device → Worker: `POST /integrations/stripe/connect` (her session; `herSide`). The Worker
   calls `createConnection(env, programId, { provider: 'stripe', accountRef: <KennelOS account
   id> })` and returns `{ id, hookPath }`.
2. Device → Stripe with her key (`stripeApi.js`, the only Stripe caller): `POST
   /v1/webhook_endpoints` with `url = cloudUrl + hookPath`, `enabled_events[] =
   checkout.session.completed` and `checkout.session.async_payment_succeeded`. Stripe returns
   `secret` (`whsec_…`) **once**, plus the endpoint id `we_…`.
3. Device → Worker: `POST /integrations/stripe/secret { connectionId, secret, endpointId }`.
   The Worker seals `secret` into `int_connections.token_sealed` (`sealToken`) and stores
   `we_…` in `scopes` (or a JSON in `account_ref`). The secret is never logged and never sent
   back. **No migration is needed**, because the columns exist.
4. Device keeps `{ connectionId, endpointId }` per account in integrations state (settings,
   like `stripeErrors`), and calls `refreshConnections()` so `syncIntegrationEvents` starts
   reading.

- **Permission:** the restricted key needs **Webhook Endpoints: Write**. Add it to
  `STRIPE_KEY_PERMISSIONS`, marked as needed only for this feature. An older key without it
  gets the existing "missing a permission" message and Kels's "Help me replace it".
- **Fallback if the browser can't create endpoints** (CORS is *unverified*, as for the rest of
  `stripeApi.js`): show the hook URL to copy into Stripe → Developers → Webhooks, and a field
  to paste the `whsec_…`. Same step 3.
- **Disconnect:** the device deletes the endpoint at Stripe with her key (`DELETE
  /v1/webhook_endpoints/:id`, best effort), then `DELETE /integrations/connections/:id`. The
  adapter has no `revoke`, since the Worker holds no Stripe key. Disconnecting Stripe on the
  account (`disconnectStripe`) does both.

### 2. The Stripe adapter (Worker)

New `cloud/src/stripe.js`, which registers itself like `firma.js` does (`registerAdapter`), and
is imported where `firma.js` is.

- **`verify`:** parse `Stripe-Signature` (`t=…,v1=…[,v1=…]`). Compute HMAC-SHA256 with key =
  the opened `whsec_…` string (as bytes, prefix included) over `` `${t}.` + raw body ``.
  Compare to any `v1` in constant time. Reject when `|now − t| > 300 s`. False without a
  sealed secret (connect step 3 not done).
- **`toEvents`:** only `checkout.session.completed` with `payment_status === 'paid'`, and
  `checkout.session.async_payment_succeeded`. Map `data.object` through the same rules as
  `stripeApi.sessionPayment` (move that pure function somewhere both sides can import, or copy
  it with a test that pins them equal). The result is one `payment.paid` event, `recordType:
  'sale'`, `recordId = metadata.kennelos_sale_id`, `providerEventId = event.id`, with payload
  component, amount, currency, date, method and reference (the PaymentIntent id). The webhook
  has **no fee** (the PaymentIntent isn't expanded); see §4. Waitlist **fee** links
  (`kennelos_purpose: 'waitlist_fee'`) return nothing for now.
- Everything else is accepted and dropped (200), as `handleHook` already does.

### 3. The deadline check, the reserved pup, "received" (Worker, no device needed)

**What links a turn to the payment:** the projection's offers don't carry the sale id today
(side-sale rows use the sale id as the offer id). Add `sale_id` to each open offer in
`waitlistProjection.js` entryView, as a **server-only** field like `direct`. `familyPages.js`
must not pass it to the family's page (its offer mapper is an allow-list: check it stays one).
A sale UUID is opaque. This is the one new thing her device publishes; call it out in the
BUILD_LOG entry.

**The record of the payment on the server is `int_events`**, not the projection, so her next
publish can't erase it. No new table is needed. Add a helper in `integrations.js`:
`paidDepositSales(env, programId, saleIds) → Map(saleId → { date, amount })`, reading
`kind = 'payment.paid' AND json_extract(payload,'$.component') IN ('deposit','payment')` for
those `record_id`s. Optional migration: an index on `int_events (program_id, record_id)` (at
most one migration on this branch).

**When the payment arrives (before the deadline):** the hook only records it. The turn stays
open, and the family can still switch pups until the deadline (the deposit stays on the turn's
sale; her device moves the sale to the new pup as `switchPick` does today). Their turn card
shows **Deposit received** with the date (`familyPages.js`, from `paidDepositSales` for the
turn's `sale_id`), in place of the deposit instructions and amount due.

**At the deadline: `serverMoves.js` step 2, changed.** Step 2 already closes a turn whose
respond-by date has passed (in the kennel's time zone). For a turn with a picked pup:

- **Deposit received** (`paidDepositSales` has the turn's `sale_id`):
  1. **The pup selected at the deadline** is the projection's `picked_dog_id`, or, when the
     family switched while her device was closed, their latest pending `pick` event's
     `dog_id`. Today step 2 skips every family with a pending pick, pass or leave (`busy`,
     ~line 301). A paid turn with only a pending **pick** must still be closed at its deadline,
     using that pick.
  2. Queue a server event `deposit_locked` (`made_by: 'server'`) with `{ turn_id, offer_ids,
     offer_id, sale_id, dog_id (the pup selected at the deadline), respond_by_date, paid: {
     date, amount } }`. Her device applies it (§4).
  3. `closeTurn` in the projection, with **no pass**, and the family's public row shows they
     chose a pup.
  4. **Reserve the pup:** it's kept out of every later family's offer and selectable pups
     until her device has applied `deposit_locked` (then the pup is placed and no longer
     published as available). Don't use a `wl_holds` row, because the publish's hold cleanup
     (`waitlist.js`, the `DELETE FROM wl_holds … kind = 'pick'` statement) would drop it.
     Instead, `nextFromQueue`'s `held`, `heldByOthers` (`familyActions.js`) and the family
     page's selectable pups all add "the pup of every `deposit_locked` event her device hasn't
     applied yet" (`events_through` in her projection, as `pendingFor` reads family events).
  5. Open the next family's turn (`offerNext`) with the reserved pup excluded.
- **Deposit not received:** unchanged from today. Close as `no_deposit`, release the pup,
  open the next family's turn.

This runs only when auto offers are on, as step 2 does today (`autoOn(projection, trigger)`).
**Which tick covers the paid case** is O5 below; it isn't decided here.

Also in `handleHook`: when a `payment.paid` lands (`meta.changes`), call `notifyEvent` with a
payment kind, so she gets "Deposit paid: <family>" as a push or digest. Use payload-free push,
the same pattern as `CONTRACT_EVENT_WHATS`. A new notification kind needs its line in
`notify.js` and the Notifications plan.

### 4. Her device on next open

- **The server's `deposit_locked` event** (`data/waitlistEvents.js`, beside `server_close`):
  if the offer's pick isn't the event's `dog_id`, her device switches it first (`switchPick`).
  Then `waitlistActions.confirmDeposit(offerId, { paidDate: paid.date })` moves the sale to
  deposit paid, places the pup, accepts the offer and places the family, **without** opening
  the next turn again (the server already did, as with `server_close`). If the offer is no
  longer open on her device, it becomes a Today review instead.
- **Order:** integration events must be applied **before** the waitlist publishes. In
  `cloudBackupUI.bootCloud`, `startIntegrationsScheduler`'s first run is at 3 s and the waitlist
  scheduler starts separately (`cloudWaitlist.startWaitlistScheduler`). Make
  `syncWaitlistOnline`'s run on open await `syncIntegrationEvents()` first (when the account
  has connections). Even if the order slips, the server reads `int_events`, so a publish
  can't undo the hold (§3). This just keeps the page and device in step sooner.
- **The `payment.paid` event for a waitlist pick, before the deadline**
  (`integrationEvents.planPayment` and `integrationApply.js`): record the money on the sale
  (deposit date, how it was paid, reference, the fee report), so her Sale and the family's
  page show the deposit as received. **Don't** run `confirmDeposit`, which would accept the
  offer and end the turn before the deadline. Check that `switchPick`, `releaseOpenOffers`
  and the projection all accept an open pick whose sale already says deposit paid. If any
  don't, keep the sale `deposit_pending` with the payment recorded on it, and show "received"
  from that.
- **When her device is open at the deadline:** whatever closes deadlines on her device must
  follow the same promise (paid → lock the pup selected then, unpaid → release). Find that
  path and line it up with step 2.
- **Side sale** (`isSideSalePending(sale)`): today a side-sale deposit takes the plain path and
  marks the sale paid **without** placing the family. A side sale isn't a turn, so call
  `confirmSideDeposit(sale.id, { paidDate: date })` when its payment arrives.
- **Paid less than the deposit owed** (after credits): not received in full. Record the money,
  and add a Today review. At the deadline it counts as not received (O6).
- **The fee:** the webhook event has none. Leave `payment_link_ref` on the sale when a webhook
  event applies (today `applyLinkPayments` clears it). The device's own `checkStripePayments`
  then finds the same session. Make `planPayment` record a **fee report** for an
  already-applied payment (same reference, no report yet) instead of skipping it, then clear
  the link fields. If no device has her key, the fee stays at its estimate.
- **Dedup:** the webhook (`evt_…`) and the device's own check (`stripe-<session>`) report the
  same payment. Planning must key on the payment **reference** (PaymentIntent id) and the
  offer or sale state, so the second one is a skip or fee-only, never a second placement.

## Files

- New: `cloud/src/stripe.js` (adapter, connect and secret routes), `cloud/tests/stripeHook.test.js`.
- Cloud: `integrations.js` (`paidDepositSales`, payment notify), `serverMoves.js`,
  `familyPages.js`, `index.js` (routes, import), `notify.js`, `cloud/README.md` (routes, the
  sealed `whsec_` rule).
- Device: `data/stripeApi.js` (webhook endpoint create/delete), `data/stripeLinks.js`
  (connect/disconnect webhook, permissions, keep link ref), `data/cloud/cloudApi.js` (two
  calls), `data/cloud/cloudIntegrations.js`, `data/integrationEvents.js`,
  `data/integrationApply.js`, `data/waitlistProjection.js` (`sale_id`),
  `data/cloud/cloudWaitlist.js` (order on open), the Accounts / Stripe UI
  (`assets/vendorKeyUI.js`), the family status page script (Deposit received).
- If a file is added on the app side: `PRECACHE_URLS` in `shared/sw.js` and
  `shared/data/proPages.js`.
- Docs in the same change: End-State guide §32 (Payment services: webhook), §29 (server moves
  and the deposit), `docs/KennelOS_Integrations_Plan.md` §4 **Modified:** note,
  `docs/KennelOS_Notifications_Plan.md` (the new kind), BUILD_LOG.

## Tests

- Adapter: signature good/bad/stale/missing secret; event mapping (paid, unpaid, async
  success, fee link ignored, bad metadata); redelivery inserts once.
- Server moves: a payment before the deadline closes nothing. At the deadline, a paid turn
  gets `deposit_locked` with the pup selected at that moment (including a pending switch),
  the pup is kept out of the next family's offer and picks even after her device republishes
  without having applied the event, and the next turn opens. An unpaid turn still closes as
  `no_deposit` and releases the pup.
- Family page: Deposit received shown from `int_events` during the turn; the family can still
  switch; `sale_id` never reaches the page.
- Device: `payment.paid` before the deadline records the money without ending the turn;
  `deposit_locked` runs `confirmDeposit` (switching first when the event says so); side sale
  runs `confirmSideDeposit`; partial → review; the device's own later check adds only the fee;
  order on open (integration events before publish).
- `node --test`, `cd cloud && npm test`, `node build/assemble.mjs`.

## Open (ask the owner before building)

- **O1.** Existing Stripe keys lack Webhook Endpoints: Write. Is asking her to replace the key
  (Kels's flow) fine, or offer only the paste-the-`whsec_` fallback for old keys?
- **O2.** A deposit paid after the deadline, when the turn was already closed as
  `no_deposit` and the pup released: what should happen? (Not decided.)
- **O3.** Waitlist **application fee** links through the same webhook: later, or in this
  batch?
- **O4.** Email the family "deposit received" by itself (with her wording), or leave that to
  her? And the "Deposit paid" alert to her: push and digest (recommended), or digest only?
- **O5.** `auto_offer_on` has a tick per moment (`accepted`, `passed`, `no_response`,
  `no_deposit`, `left`). Which tick should cover "the deadline passed and the deposit was
  received", `no_deposit` (the same deadline tick) or `accepted`?
- **O6.** A family who switches to a pup with a different deposit after paying, or who paid
  less than the deposit: does that count as "deposit received" at the deadline?
- **O7.** When she records a deposit by hand before the deadline (`confirmDeposit` on the
  family's page), the turn ends at once today. Under the promise, the family could still
  switch. Should that change too, or stay as is for hand-recorded deposits?
