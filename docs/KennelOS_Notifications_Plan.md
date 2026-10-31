# KennelOS Notifications — plan: app alerts and email digests

Two ways for the breeder to hear that something happened on her waitlist without opening
KennelOS: **app alerts** (web push to her installed app on Android and iPhone) and an
**email digest**. Each is its own opt-in, per account, and both are off until she turns
them on. Neither replaces anything: Today's nudges stay the place where everything is
handled, and an alert or digest only says "go look".

Modeled on the MCCE plan (MCCE `docs/architecture-v3.md` §19, `docs/open-decisions.md`
D30–D33), which is planned there but not built. KennelOS reuses its shape: the installed app
first, then payload-free sends, best-effort delivery, a catalog ruled on purpose.

Edition: **Pro with cloud** (both need the waitlist online). `cloudUrl: null` → no
requests, no UI. Lite has no waitlist online; the Demo never subscribes or stores an address.

## 0. Privacy line

- **App alerts store nothing personal.** A push subscription is an opaque endpoint URL plus
  keys, made by her browser. Sends carry **no payload**: the phone is told "something's
  new" and the service worker writes the words (§2.3). Nothing she or a family wrote crosses
  Apple's or Google's servers.
- **The email digest stores her readable address.** Today the server keeps only
  `email_hash` (HMAC) for her account (`0001_schema.sql`: "Nothing here holds a readable
  email"). A digest needs an address the server can read, so it is a **separate opt-in**
  with its own consent text, and the address is deleted when she turns it off or deletes
  her account. It is never logged (CLAUDE.md, cloud rules). Family emails already live on
  the server for the waitlist (`0007_waitlist.sql`); hers so far never have.
- **Content.** Neither ever includes what a family wrote (messages are sealed to her key
  and the server can't read them anyway), amounts, or contact details. See D2.

## 1. What triggers a notification (the catalog — D1)

All are events the server already sees as they happen (`familyActions.js`, `waitlist.js`
inbox writes, `serverMoves.js`).

| Event | Alert | Digest | Notes |
|---|---|---|---|
| A family sent a message | yes | yes | The one asked for. |
| A new application arrived | yes | yes | |
| A family accepted, picked a pup, or passed on their turn | yes | yes | The Integrations plan's open "being told when they pick" (D19). |
| A family asked for something (pause, preferences, listen-only, Companion link) | yes | yes | |
| "Ready now?" answered | no | yes | Low urgency. |
| A turn closed or moved on by itself (server moves while her phone was off) | yes | yes | She must contact the next family. |
| Fee paid online | no | yes | |

*Recommendation:* every row above, each with its own tick in a "Tell me about…" list
(defaults: all on for alerts except the two "no" rows; all on for the digest).

## 2. App alerts (web push)

### 2.1 What she does

Settings → Notifications (Pro, cloud signed in): **"Alerts on this device"** switch. Turning
it on asks the browser's permission and subscribes **this device**; each device is its own
row, so her phone and her tablet are turned on separately. Off unsubscribes this device.
A "Send a test" button.

- **iPhone:** iOS 16.4+ and only from KennelOS **added to the Home Screen**. In Safari
  the switch is replaced by how to install (Today's install tip already covers it). Apple
  drops the subscription when the app sits unopened for a long time; the app re-subscribes
  on open when the switch is on.
- **Android:** works in Chrome as a tab or installed; installed is recommended.
- Each edition is its own origin (Pro / Demo), so a subscription belongs to the Pro app.

### 2.2 Server

- **Migration `0018_push.sql`** (additive): `push_subscriptions (id, user_id, device_id,
  endpoint UNIQUE, p256dh, auth, kinds TEXT /*JSON*/, created_at, last_ok_at)`. Keyed to
  the existing device row, so revoking a device (cloudDevices) removes its alerts too.
- **Send at the moment of the event**, inside the request that recorded it
  (`ctx.waitUntil`), not on the hourly cron. Server moves made by the cron send from there.
- **Payload-free Web Push**: a POST to the endpoint with a VAPID JWT (ES256 via Web Crypto)
  and `TTL`; no body, so no message encryption is needed. `404`/`410` → delete the row.
- **Coalescing:** at most one alert per account per 2 minutes; later events in that window
  are folded into it (the worker shows the count).
- Endpoints: `POST /api/push/subscribe`, `POST /api/push/unsubscribe`,
  `POST /api/push/test`, `GET /api/push/pending` (below). Never log endpoints.

### 2.3 The service worker (`shared/sw.js`)

`push` event → `GET /api/push/pending` with the device's session (stored in IndexedDB so
the worker can read it; today it's in localStorage) → shows one notification, e.g.
"New message from Jane S." or "3 new things on your waitlist". `notificationclick` → opens
or focuses Today (or the family's page when it's one family). If the fetch fails, a plain
"Something new on your waitlist" so an alert is never lost.

### 2.4 Owner setup (once)

A VAPID key pair: `/ops` gets a **Generate push keys** button (Web Crypto) that shows the
private key to paste into the Worker's secrets as `VAPID_PRIVATE_JWK` and the public key
for `wrangler.toml` `[vars]` `VAPID_PUBLIC_KEY`. Until both are set, the switch says
"Alerts aren't available yet" and the health page says so.

## 3. Email digest

### 3.1 What she does

Settings → Notifications: **"Email me a digest"**, separate from alerts, with:

- **Consent text** at the switch: "To email you, KennelOS keeps this address on its
  server. It's used only for your digest, never shared, and deleted when you turn this
  off."
- **Address:** her sign-in email by default, editable; a new address is confirmed with a
  code first (as `emailChange.js` does), so nobody can sign another person up.
- **How often:** daily (default) or weekly; sent after 8 am in her kennel's time zone (the
  rule the family reminder emails already use).
- **Only when there's something:** no activity, no email.

### 3.2 What it says

Subject: "KennelOS: 2 messages and 1 application". Body: one line per event in the
catalog, with the family's listed name (first name + last initial) and when, then
"Open KennelOS" (the app's address). Plain text, no tracking. Never message text,
amounts or contact details (D2). Footer: why she's getting it and a one-click turn-off
link (signed token), which deletes the address.

### 3.3 Server

- **Migration (same `0018` or `0019`)**: `digest_settings (user_id PK, email, frequency,
  kinds, tz, last_sent_at, created_at)` and `digest_items (id, user_id, kind, entry_id,
  name, at)`. Items are written at the same point as push sends; the hourly cron sends due
  digests through `mail.js` (Resend) and deletes the items it sent. Items older than 8 days
  are deleted by the daily retention run.
- Turning it off or deleting the account deletes the row and its items.
- Never log the address; a failed send logs Resend's status only (as `mail.js` does).

## 4. Client (`shared/`, Pro only)

- `data/cloud/cloudApi.js`: the new endpoints (the only network code).
- `assets/notificationsUI.js` (new, Pro-only → `PRECACHE_URLS` and `proPages.js`): the
  two switches, catalog ticks, test, digest address/frequency.
- `sw.js`: `push` and `notificationclick` handlers.
- Gated on `cloudConfig.isCloudAvailable()`, signed in, and `editionFlags.waitlist`.
- Nothing synced: the switches live on the server (per account / per device), not in a
  backup. `syncRegistry` unchanged.

## 5. What this does not do

- Delivery is best-effort. Nothing depends on an alert or email arriving; Today stays
  the source of truth.
- A phone shows a lock-screen alert to whoever holds it, hence D2.
- No alerts or digests to families (they already get the W2 emails).
- No SMS.

## 6. Decisions

- **D1 — The catalog (§1).** *Recommendation:* all rows, per-kind ticks.
- **D2 — What an alert says.** Name the kind and the family's listed name ("New message
  from Jane S."), never the content. Alternative: no names ("New waitlist activity").
  *Recommendation:* kind + listed name, with a "Hide names on my lock screen" tick.
- **D3 — Digest frequency.** *Recommendation:* daily default, weekly option.
- **D4 — Digest address.** *Recommendation:* sign-in email by default, another address
  allowed after a code.
- **D5 — Kennels.** One account, several kennels. *Recommendation:* one setting for all her
  kennels; each line names the kennel when she has more than one.

## 7. Build order

1. Server: migration, subscribe/unsubscribe/test/pending, the payload-free sender, VAPID
   keys on `/ops`, health check. Tests in `cloud/tests`.
2. Client: Notifications card, sw.js handlers, session readable by the worker. Tested on a
   real Android phone and an iPhone with the app installed.
3. Event hooks: write alert/digest items where each catalog event is recorded.
4. Email digest: settings with consent and address confirmation, the hourly send, the
   turn-off link, retention.
5. End-State guide, `cloud/README.md`, SW cache bump.

## 8. As built (2026-10-31)

Decisions D1–D5 taken as recommended. Steps 1–4 built (server `cloud/src/notify.js`,
migration `0018_notifications.sql`; app `data/cloud/cloudNotify.js`,
`assets/notificationsUI.js` on Settings, `sw.js` handlers). **Modified:**
- **No fee-paid row.** The server never sees an online fee payment (Stripe reports it to
  her device), so it isn't in the catalog.
- **No 2-minute coalescing.** Every event sends; all alerts share one tag, so a newer one
  replaces the last on the phone, and the worker shows everything not yet shown on that
  device (by item sequence number, not time).
- **One secret.** `VAPID_PRIVATE_JWK` holds both halves; the public key is derived from it,
  so there's no `VAPID_PUBLIC_KEY` var to keep in step.
- **The worker's server address** is a note in Cache Storage (`kennelos-notify`), not
  IndexedDB; the session token never reaches the worker (the subscription's auth secret is
  its proof).
- A subscribe the browser's push service never answers gives up after 20 seconds with a
  message.
- Not yet checked on a real Android phone or an iPhone (step 2's device test).

