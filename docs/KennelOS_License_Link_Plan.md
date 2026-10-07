# KennelOS Cloud — build plan: the server-side Pro license link (DRAFT)

> Parent design: `docs/KennelOS_Cloud_Accounts_Proposal.md` §4 ("Licensing stays
> browser-to-Lemon-Squeezy… an optional add-on: Lemon Squeezy webhooks to the Worker") and §9
> Phase 5, **brought forward** for one job only.
> Needed by: the waitlist's W2 (`KennelOS_Waitlist_Spec.md` §8.5, §12): every `/waitlist/*`
> route for the breeder needs a signed-in account **the server knows is Pro**.
> Status: **§10 step 1 (the server) built 2026-10-07**, with every §9 decision taken as
> recommended. Next: the operator's staging setup (§7 steps 1–2), then the client (step 3).
> §10's step 1 entry is the as-built record.

## 1. Scope

**In:**
- A Lemon Squeezy (LS) **webhook** into the Worker that records Pro purchases and their
  status changes, matched to accounts by the **keyed email hash** the server already uses
  (Proposal §4). No readable email and no license key is stored.
- An **entitlement** the server computes for a signed-in account: Pro or not, which plan, until
  when. A `requirePro()` guard for W2's routes, and one read route so the app can show it.
- **Linking a purchase made with another email** to the account, proven by a code sent to
  that email (the same machinery as sign-in).
- `/ops` visibility, the export, tests and docs. **No privacy-policy change** (the
  owner's decision, 2026-10-07).

**Not in (stays Proposal Phase 5 proper):** the license key following the account to a new
device, any change to the browser's activation or grace logic, and any gate on the app
itself. **The browser-side license check stays the only gate on the Pro app** (Proposal §2a):
this link decides only what the *server* does for an account. With `cloudUrl: null`, or the
Worker gone, Pro runs exactly as today.

**The governing rules still hold:** cloud is opt-in (nothing here runs for someone who never
signs in); only `cloudApi.js` touches the network; the server never logs an email, a code, a
token or a request body (`cloud/README.md`); the license key never reaches our server
(`site/privacy.html` says so today).

## 2. How a purchase reaches an account

1. The breeder buys Pro on Lemon Squeezy (the checkout links on `site/pro.html`).
2. LS POSTs signed webhooks to `https://api.kennelos.app/webhooks/lemonsqueezy` (staging:
   the staging Worker, with the LS store in **test mode**).
3. The Worker checks the signature, keeps only KennelOS Pro products, hashes the purchase's
   `user_email` with `EMAIL_HMAC_KEY` exactly as sign-in does (`emailHash`), discards the
   address, and upserts one row per subscription or order (§4).
4. When she signs in to cloud backup with **the same email**, her account's `email_hash`
   already matches: she's Pro on the server, with no step for her.
5. **Different email** (she bought with her business address, signs in with her personal
   one): the app's account section says "Your Pro purchase isn't linked to this account" with
   **Link a purchase email…** (§5). A code goes to the purchase email; typing it adds that
   email's hash to her account.

The order doesn't matter: a purchase made before the account exists is waiting when she
signs up, and an account made first picks the purchase up when the webhook lands.

## 3. The webhook

**Route:** `POST /webhooks/lemonsqueezy`. Server to server: no CORS, no bearer token, never
answered to a browser origin. It sits **behind the maintenance gate** like the API: while a
migration is pending it answers 503 and LS retries (§9 decision 5).

**Signature:** LS sends `X-Signature`, the hex HMAC-SHA256 of the **raw body** under the
webhook's signing secret. The Worker reads the body as bytes, computes the HMAC with the new
secret `LEMONSQUEEZY_WEBHOOK_SECRET`, compares in constant time (`lib/crypto.timingSafeEqual`)
and only then parses JSON. Missing or wrong → 401, nothing parsed, nothing logged but the
fact ("webhook: bad signature").

**Filter:** `data.attributes.store_id` must equal `LS_STORE_ID`, the product must be one of
`LS_PRO_PRODUCT_IDS` (wrangler vars), and `data.attributes.test_mode` must be `true` on
staging and `false` on production (`LS_TEST_MODE` var). Anything else → 200 and ignored, so LS
doesn't retry it.

**Events subscribed** (set in the LS dashboard):

| Event | Use |
|---|---|
| `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_resumed`, `subscription_expired`, `subscription_paused`, `subscription_unpaused` | Upsert the subscription row: status, plan, `renews_at`/`ends_at` |
| `order_created`, `order_refunded` | Upsert the order row. Only a **lifetime** order grants Pro by itself; a subscription's first order is recorded but its subscription row decides |

**Not subscribed:** `license_key_created` / `license_key_updated`. Their payload carries the
**full license key**, and the promise is that it never reaches us. Nothing here needs it:
subscription and order events carry status and the purchase email.

**Ordering and repeats:** LS gives no event id, and retries can arrive out of order. Each row
keeps the payload's own `updated_at`; an event older than the stored one is ignored. So the
handler is idempotent and replays are harmless.

**What's read from a payload, and nothing more:** `data.id`, `data.type`, `store_id`,
`product_id`, `variant_id`, `variant_name` (plan detection), `status`, `renews_at`, `ends_at`,
`trial_ends_at`, `refunded`, `test_mode`, `updated_at`, and `user_email` (hashed, then
dropped). Not stored: names, the customer id, card details, URLs, `custom_data`.

## 4. Server data (migration `0006_license_link.sql`, additive)

```sql
-- One row per LS subscription or order for a KennelOS Pro product. Keyed by
-- the keyed hash of the purchase email; the address itself is never stored.
CREATE TABLE IF NOT EXISTS pro_purchases (
  id                 TEXT PRIMARY KEY,      -- 'sub:<ls id>' or 'order:<ls id>'
  email_hash         TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('subscription', 'order')),
  plan               TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly', 'lifetime')),
  status             TEXT NOT NULL,         -- LS's own status string
  access_until       TEXT,                  -- ISO; null = no end (active sub, lifetime order)
  source_updated_at  TEXT NOT NULL,         -- the payload's updated_at (ordering)
  received_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pro_purchases_email ON pro_purchases (email_hash);

-- Extra purchase emails an account has proven it owns (§5).
CREATE TABLE IF NOT EXISTS license_links (
  user_id     TEXT NOT NULL REFERENCES users(id),
  email_hash  TEXT NOT NULL,
  linked_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, email_hash)
);
CREATE INDEX IF NOT EXISTS idx_license_links_email ON license_links (email_hash);
```

Plus `rate_limits` buckets for the link codes (the existing per-address and per-IP code limits
apply as-is) and a `login_codes`-style row for a pending link code. Whether that reuses
`login_codes` with a purpose prefix in the code hash, or gets its own small table, is a
build-time choice; either way the code is hashed, single-use and expires in 10 minutes.

**Retention:** a purchase row whose access has ended (expired, refunded) is deleted 90 days
after `access_until` (§9 decision 2). **Account deletion** removes that user's
`license_links`; `pro_purchases` are the store's facts about an email hash, not the account's
data, and stay until they age out (so a breeder who deletes her account and signs up again is
still Pro). **Export** (`/ops` D1 export) gains both tables. **`/ops`** shows counts only:
purchases by plan and status, linked accounts, and "last webhook received" (a time, no
content).

## 5. Entitlement

`entitlementFor(env, userId)` → `{ pro, plan, until, source: 'email' | 'linked' | null }`,
over the purchase rows of the account's own `email_hash` plus its `license_links` hashes (one
`json_each(?)` parameter, per the `cloud/README.md` rule).

A row grants Pro **now** when:

| Kind / status | Pro until |
|---|---|
| subscription `active`, `on_trial` | no end while active (`renews_at` is informational) |
| subscription `past_due`, `unpaid` | `renews_at` + the app's grace (yearly 7 days, monthly 3) |
| subscription `cancelled` | `ends_at` (paid to the end of the period) |
| subscription `paused`, `expired` | not Pro |
| order, plan `lifetime`, not refunded | no end |
| order, refunded; any other order | not Pro (a subscription's order defers to its subscription row) |

Several rows → the best one wins. The grace mirrors `license.js` so the app and the server
don't disagree about a lapsed card for days. **Plan detection** uses explicit variant ids
(`LS_LIFETIME_VARIANT_IDS`, `LS_YEARLY_VARIANT_IDS` vars; anything else is monthly), not the
app's name patterns, because a wrong guess here gates server features (§9 decision 7).

**`requirePro(env, auth)`** throws `403 pro_required` (with `{ linked: bool }`, so the app can
say "buy Pro" vs "link your purchase") unless `entitlementFor` says Pro. Only W2's routes call
it; nothing existing changes. Computed per request (two indexed reads); no cache to go stale.

### Linking another purchase email

| Route | Does |
|---|---|
| `GET /account/entitlement` | `{ pro, plan, until, source, linkedEmails: n }`. Bearer, behind the gate |
| `POST /account/license-links/start {email}` | Sends a 6-digit code to that address, which is used and dropped. Same limits as `/auth/start`; always `{ok:true}` for a well-formed address, so it can't be used to test which emails bought Pro |
| `POST /account/license-links/verify {email, code}` | Adds that email's hash to `license_links` → the new entitlement |
| `DELETE /account/license-links` | Removes every link (fresh sign-in, the Phase 1 §2.5 rule) |

The code email says plainly what it's for ("to link the KennelOS Pro purchase made with this
address to your cloud account"), so a code sent to someone else's address is noticed rather
than typed in. A link doesn't move the purchase: the purchase email can still sign in to its
own account and be Pro there too. One purchase linked to several accounts is allowed (her own
two accounts) and visible on `/ops` as a count of hashes linked more than once, in case it's
abused.

## 6. Client (`shared/`)

| File | Change |
|---|---|
| `data/cloud/cloudApi.js` | `getEntitlement`, `startLicenseLink`, `verifyLicenseLink`, `removeLicenseLinks` |
| `data/cloud/cloudEntitlement.js` (new) | `entitlement()` (checks `isCloudAvailable()` and the session first), `linkPurchaseEmail` start/finish, `unlinkPurchaseEmails`. Network only through `cloudApi` |
| `assets/cloudBackupUI.js` | In the card's **Account** section, only where `isLicenseGated()` (Pro): "Pro on this account: yearly, renews …" or "Your Pro purchase isn't linked to this account" + **Link a purchase email…** (a two-step email → code modal, as sign-in) |
| `shared/sw.js` | `cloudEntitlement.js` in `PRECACHE_URLS`; `CACHE_NAME` bump asked first |

Lite and Demo show nothing (Lite has no server-side Pro features; Demo has no cloud). The
check is `isLicenseGated()`, the existing edition switch, so the shared core hardcodes no
edition. W2 adds its own "link your purchase" prompt where a `/waitlist/*` call answers
`pro_required`.

Optional, small: when the Pro app sends someone to checkout while signed in to cloud backup,
append `checkout[email]=<account email>` so the purchase email matches by default. The
checkout links are on `site/pro.html` today, so this only covers the app's own buttons.

## 7. Operator setup (dashboard, not code)

1. **Staging:** in the LS store's **test mode**, add a webhook → the staging Worker's
   `/webhooks/lemonsqueezy`, the events in §3, a generated signing secret. Set
   `LEMONSQUEEZY_WEBHOOK_SECRET` on the staging Worker; set `LS_STORE_ID`,
   `LS_PRO_PRODUCT_IDS`, the variant-id vars and `LS_TEST_MODE = "true"` in `wrangler.toml`.
2. Make a test-mode purchase with a test card; `/ops` shows the purchase count and the last
   webhook time; sign in to staging with that email and check `GET /account/entitlement`.
3. **Production:** the same webhook in live mode → `https://api.kennelos.app/…`, its own
   secret on the production Worker, `LS_TEST_MODE = "false"` under `[env.production.vars]`.
   Apply pending (`0006`) on both `/ops` pages.
4. **Backfill:** only if Pro has been sold before the production webhook exists (§9 decision
   6). **One exists (noted 2026-10-07):** the owner's own production Pro license, bought
   before the webhook. The store is live, but the owner is the only user and holds only test data.
   That one purchase needs backfilling (decision 6).

## 8. Testing

- `cloud/tests/license.test.js` (the node:sqlite shim): signature good / bad / missing /
  computed over different bytes; wrong store, product or test mode ignored with 200; each
  subscription status and the lifetime and refunded orders → the §5 table, at the boundaries
  (grace end, `ends_at`); an older `updated_at` doesn't overwrite a newer one; the same event
  twice is a no-op; purchase before account and account before purchase; linking by code
  (wrong code, expired, rate-limited, the start answer identical for any address);
  `requirePro` 403 with `linked`; account deletion removes links but not purchases; retention
  ages rows out; the export carries both tables; a grep-style check that no handler logs the
  body or an email (as the existing tests do).
- Client: `tests/cloudClient.test.js`-style end to end against the Worker in-process
  (entitlement read; the link flow with the dev outbox code).
- Staging: §7 step 2 with a real test-mode purchase, in the Pro build.

## 9. Decisions needed before building

1. **Match by email hash, plus proven extra emails (recommended, and what Proposal §4
   decided).** The alternative is linking through the device's LS **activation id**, which the
   server already stores (`devices.js`): the server would look the instance up with the LS API.
   That fixes mismatched emails with no extra step, but it needs the store's **full-access LS
   API key** in the Worker (it can read every customer and change the store), and LS's
   license-key responses include **the full key**, breaking the promise above. Not
   recommended.
2. **Keep purchase rows for emails with no account (recommended).** Without them, a breeder
   who buys first and signs up later isn't Pro on the server until LS sends another event,
   which could be a year. The cost: the server holds a keyed hash, plan and status for every
   Pro buyer, account or not. Aged out 90 days after access ends. (The privacy policy is
   not being changed for this: the owner's decision, 2026-10-07.)
3. **Grace matches the app (recommended):** `past_due`/`unpaid` stay Pro for 7 days (yearly)
   or 3 (monthly), as `license.js` does, so W2's emails don't stop the day a card fails while
   her app still works.
4. **Who may link an email:** any signed-in account that can receive the code (recommended),
   or only accounts whose devices hold a Pro activation (`license_instance_id` set). The
   second is tighter but fails for a breeder whose only Pro device is offline or reset.
5. **Webhooks during maintenance:** 503 and rely on LS's retries (recommended; simple, and a
   migration window is minutes), or exempt the webhook from the gate (it would have to cope
   with missing tables). Check LS's retry schedule and whether its dashboard can resend a
   failed delivery before relying on it.
6. **Backfill:** if Pro sells before the production webhook exists, either resend those
   events from the LS dashboard (if it allows), have those buyers use **Link a purchase
   email**, or a one-off `/ops` import that takes a short-lived LS API key, pages through the
   store's subscriptions and orders, and stores nothing but §4's rows (the key is not kept).
   Simplest: put the webhook live before the store opens.
7. **Plan detection by variant ids** (recommended) rather than the app's name patterns.
8. **The checkout email prefill** (§6, optional): do it or skip it.

## 10. Build order (each a reviewable PR)

1. **Server:** migration `0006` (+ its `index.js` line), `cloud/src/license.js` (verify,
   upsert, entitlement, `requirePro`, the link routes), the webhook route in `index.js`
   (behind the gate, no CORS headers), `/ops` counts + health shows the secret present, export, retention,
   account deletion, tests. Staging: set the secret and vars, Apply pending.
   **Built 2026-10-07.** Where it differs from §3–§5 above, this wins:
   - **Rows:** only subscriptions and **lifetime** orders are stored (a subscription's own
     orders change nothing, so they're dropped). `access_until` is computed when the event
     lands, grace included; an ended purchase (paused, expired, refunded) gets the earlier of
     LS's `updated_at` and the Worker's clock, so it ends at once even when LS's clock runs
     ahead.
   - **Link codes** have their own table, `license_link_codes` (one per account, hashed with
     the account and address, 10 minutes, 5 tries), so linking an address never disturbs a
     sign-in to it. Start is rate-limited by the sign-in limits for that address and IP plus
     10 an hour per account, answers `{ok:true}` for any well-formed address, and refuses the
     account's own (`own_email`). The code email (`mail.linkCodeMessage`) says what it links.
   - **`requirePro`** → `403 pro_required` with `{ lapsed, linkedEmails }` (`lapsed`: a
     purchase exists but has ended), so W2 can say renew, link or buy. `GET
     /account/entitlement` returns `{ pro, plan, until, source, lapsed, linkedEmails }`.
     `DELETE /account/license-links` returns the entitlement after.
   - **Config:** `LS_STORE_ID`, `LS_PRO_PRODUCT_IDS`, `LS_YEARLY_VARIANT_IDS`,
     `LS_LIFETIME_VARIANT_IDS` (comma-separated) and `LS_TEST_MODE` (`"true"` on staging,
     `"false"` on production) in `wrangler.toml`, empty until the store exists. Until the
     secret, the store and a product are set, the webhook answers 503 and `/ops` Health says
     which is missing.
   - **`/ops`:** a Pro license link section with purchases by plan and active/ended, the time
     of the last purchase update, accounts with a linked email, and emails linked to more than
     one account. Health counts the three new tables.
   - **Retention** deletes link codes once expired and purchases 90 days after
     `access_until`. **Export** carries `pro_purchases` and `license_links`. **Account
     deletion** removes the account's links and pending code; purchases stay.
   - Tests: `cloud/tests/license.test.js`.
   **Merging this to `main` puts production into maintenance** (503) until `0006` is applied
   on production's `/ops`, as with every migration.
2. **Operator, staging:** §7 steps 1–2 with a test-mode purchase.
3. **Client:** `cloudApi` additions, `cloudEntitlement.js`, the Account-section line and the
   link modal (Pro only); `PRECACHE_URLS`; browser-verified against the Worker in-process and
   then on staging.
4. **Docs, production:** `cloud/README.md` (route, secret, vars, migration,
   the no-key rule for webhooks), End-State guide §30, Proposal §4 and §9 (Phase 5: the link
   built, the rest still later), Waitlist Spec §8.5 and §12 (prerequisite met), README build
   status, `LAUNCH_CHECKLIST.md` (§7 steps 3–4); then §7 step 3
   on production, and the `CACHE_NAME` bump (asked first).
