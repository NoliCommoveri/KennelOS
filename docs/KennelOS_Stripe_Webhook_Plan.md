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

## Decisions (owner, 2026-11-19)

- **S1. A paid deposit keeps the turn open.** A signed contract does not, since a signature
  without money can still pass to the next family. Contracts are sent by hand and are **not**
  part of this work.
- **S2. Her own Stripe account does the setup and storage.** KennelOS makes no Stripe
  account or platform (D22 stands). The webhook endpoint is on her Stripe account. The Worker
  keeps only that endpoint's signing secret (`whsec_…`), sealed like Firma's token, to check
  the signature. Her `rk_` key stays on her device.
- **S3. What the webhook does:** it records the payment, holds the pup from later applicants,
  and the sale's deposit becomes paid so the status page shows it as **received**.
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

### 3. Holding the pup and showing "received" (Worker, no device needed)

**What links a turn to the payment:** the projection's offers don't carry the sale id today
(side-sale rows use the sale id as the offer id). Add `sale_id` to each open offer in
`waitlistProjection.js` entryView, as a **server-only** field like `direct`. `familyPages.js`
must not pass it to the family's page (its offer mapper is an allow-list: check it stays one).
A sale UUID is opaque. This is the one new thing her device publishes; the owner agreed to
the webhook design, so call it out in the BUILD_LOG entry.

**The source of truth on the server is `int_events`**, not the projection. Her next publish
can't erase it, and no new table is needed. Add a helper in `integrations.js`:
`paidDepositSales(env, programId, saleIds) → Map(saleId → { date, amount })`, reading
`kind = 'payment.paid' AND json_extract(payload,'$.component') IN ('deposit','payment')` for
those `record_id`s. Optional migration: an index on `int_events (program_id, record_id)` (at
most one migration on this branch).

Use it in three places:

1. **`serverMoves.js` step 2 (deadlines).** Before closing a picked turn, check its offers'
   `sale_id`s. If any is paid, **skip** it: no `server_close`, no hold delete, no next offer.
   Because `nextFromQueue` offers nobody while a turn is open, the next family waits until her
   device applies the deposit (S4). The pup was never in the litter's available `pups` while
   picked, so no other family can choose it.
2. **`serverMoves.js` step 1 (a family's own Pass / Leave after paying).** Same check: don't
   auto-close or offer next on a paid turn. Leave it to her device (a Today review).
3. **`familyPages.js`, the family's turn card.** When the offer's sale has a paid deposit, send
   `deposit_received: { date, amount }`, and have the page say **Deposit received** with the
   date instead of the deposit instructions and amount due. Their Payments card
   (`paymentsFor`, `familyPaymentsView`) shows deposit state `paid` the same way until her
   device republishes.

Also in `handleHook`: when a `payment.paid` lands (`meta.changes`), call `notifyEvent` with a
payment kind, so she gets "Deposit paid: <family>" as a push or digest. Use payload-free push,
the same pattern as `CONTRACT_EVENT_WHATS`. A new notification kind needs its line in
`notify.js` and the Notifications plan.

### 4. Her device on next open

- **Order:** integration events must be applied **before** the waitlist publishes. In
  `cloudBackupUI.bootCloud`, `startIntegrationsScheduler`'s first run is at 3 s and the waitlist
  scheduler starts separately (`cloudWaitlist.startWaitlistScheduler`). Make
  `syncWaitlistOnline`'s run on open await `syncIntegrationEvents()` first (when the account
  has connections). Even if the order slips, the server reads `int_events`, so a publish
  can't undo the hold (§3). This just keeps the page and device in step sooner.
- **Applying a waitlist deposit** (`integrationEvents.planPayment` and `integrationApply.js`):
  - Turn pick (an open offer with this `sale_id`, `isAwaitingDeposit`): a new plan op
    `{ op: 'waitlist_deposit', offerId }`. `applyIntegrationEvent` calls
    `waitlistActions.confirmDeposit(offerId, { paidDate: date })`. That moves the sale to
    deposit paid, places the pup, accepts the offer, places the family and moves the turn on
    by her `auto_offer_on`. Then it writes `paidBy` and the fee report onto the sale (`withFee`).
  - Side sale (`isSideSalePending(sale)`): `confirmSideDeposit(sale.id, { paidDate: date })`,
    then the same. Today a side-sale deposit takes the plain path and marks the sale paid
    **without** placing the family. Fix that here.
  - Paid amount less than the deposit owed (after credits), the offer no longer open, or the
    sale cancelled: a Today review as now (never place on partial money).
  - A `'payment'` link on a deposit-pending waitlist pick: deposit part through
    `confirmDeposit`, the rest as a `payments` row (as `planSalePayment` does).
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
- Server moves: a picked turn past its deadline with a paid deposit is **not** closed, nobody
  is offered, the hold stays; an unpaid one still closes as before; pass/leave after paying
  doesn't auto-move.
- Family page: `deposit_received` shown from `int_events`; `sale_id` never reaches the page.
- Device: a webhook `payment.paid` for a turn pick runs `confirmDeposit` (sale deposit paid,
  pup placed, family placed); side sale runs `confirmSideDeposit`; partial → review; the
  device's own later check adds only the fee; order on open (integration events before
  publish).
- `node --test`, `cd cloud && npm test`, `node build/assemble.mjs`.

## Open (ask the owner before building)

- **O1.** Existing Stripe keys lack Webhook Endpoints: Write. Is asking her to replace the key
  (Kels's flow) fine, or offer only the paste-the-`whsec_` fallback for old keys?
- **O2.** A family who paid and then taps Pass or Leave before she opens the app: hold it for
  her review (recommended), or let it close?
- **O3.** Waitlist **application fee** links through the same webhook: later, or in this
  batch?
- **O4.** The "Deposit paid" alert to her: push and digest (recommended), or digest only?
