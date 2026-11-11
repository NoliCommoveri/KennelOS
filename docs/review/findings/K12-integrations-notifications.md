# K12 — Integrations, accounts and notifications

Reviewed: `jotformApi.js` (81), `jotformConnect.js` (50), `jotformMatch.js` (193),
`jotformSigned.js` (124), `jotformKeyStore.js` (28), `stripeApi.js` (156), `stripeLinks.js`
(123), `stripeKeyStore.js` (28), `integrationEvents.js` (142), `integrationApply.js` (44),
`cloud/cloudIntegrations.js` (114), `cloud/src/integrations.js` (229), `pages/accounts.js`
(682) + `.html` (83), `accountHealth.js` (173), `assets/accountHealthUI.js` (400),
`referralShare.js` (122), `assets/vendorKeyUI.js` (88), `assets/notificationsUI.js` (136),
`cloud/src/notify.js` (571), `data/cloud/cloudNotify.js` (148), the `push` /
`notificationclick` handlers in `sw.js`, `cloud/src/mail.js` (counting, digest send),
migrations `0015`, `0018`, `0019`, `0021`; read where they lead: `waitlistFeeLinks.js`,
`waitlistFeePay.js`, `contractForms.js` (prefill), `paymentRequestUI.js`, `pickToSend.js`,
`contract.js` (Check for signature), `sale.js` (Check now), `serverWork.js`,
`cloudWaitlist.js` (scheduler, take-in), `today.js` (redraw), `importExport.js`,
`syncRegistry.js` (accounts), `api.js` (`OWNER_ONLY`), `ops.js` (push keys, mail counts).
· Contract read: `docs/KennelOS_Integrations_Plan.md` (keys, §2.1b, §4, §6 step 7),
`docs/KennelOS_Notifications_Plan.md` (whole, incl. §8 As built), guide §29 notifications
(2421–2448), §32.

Verified by: baseline at `07634db` — `node --test` **1649 pass**, `cd cloud && npm test`
**305 pass**, `node build/assemble.mjs` succeeds (green; more than the plan's 1639 / 303).
Four scratch suites in my scratchpad, on the repo's own harnesses
(`tests/support/memoryDb.js`, `cloud/tests/helpers/env.js`), with Stripe, Jotform and the
push service stubbed: a paid link replaced by a new one (finding 1); one refused key
stopping every other check (3); a renamed Jotform field (2); three queued alerts handled by
the Worker's real `/notify/push/pending` (5). Playwright at 320 px on
`/shared/pages/accounts.html` with a real account saved through the form (11, 12).

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S2 | shared/data/stripeLinks.js:67 | Making a new payment link replaces the sale's open one without asking Stripe whether it was paid: a deposit paid before her device checked is never recorded, and the new "everything owed" link asks the family for it again | verified |
| 2 | S2 | shared/data/jotformMatch.js:178 · jotformSigned.js:110 · contractForms.js:79 | A Jotform field she renames (or deletes and re-adds) after matching silently breaks both ways: the link prefills names the form no longer has, the signed form is never found, and the contract page says "Not signed yet" | verified |
| 3 | S2 | shared/data/stripeLinks.js:89 · jotformSigned.js:106 · accountHealthUI.js:103 | One refused key or missing permission stops the whole Stripe or Jotform check for every other account, sale and fee link, records nothing, and account health still says "connected and working" | verified |
| 4 | S2 | shared/pages/waitlist-entry.js (no redraw) · cloudWaitlist.js:646 | A one-family alert opens the family's page before the message or pick is taken in, and the page never redraws; on a phone that isn't the backing device it is never taken in at all | verified (code) |
| 5 | S3 | cloud/src/notify.js:321, :334 · sw.js:515 | Queued or close-together alerts: the first shows everything, each later one shows "Something new on your waitlist." (or only the newest line) and replaces it | verified |
| 6 | S3 | jotformSigned.js:110 · waitlistFeeLinks.js:72 · waitlistFeePay.js:65 | A signed form with no contract reference, a fee paid without the family's reference, and a family paying the fee twice are all dropped without a word | verified (code) |
| 7 | S3 | shared/assets/notificationsUI.js:56, :112 | "Alerts are on for this device" and "Sent. It should appear" while the phone has notifications blocked; nothing ever corrects it | verified (code) |
| 8 | S3 | shared/data/cloud/cloudNotify.js:134 · cloud/src/api.js:37 | The alert switch outlives sign-out and Reset: a day later the device subscribes, unasked, to whichever account is signed in, support's helper session included; no `/notify` route is owner-only | verified (code) |
| 9 | S3 | shared/pages/accounts.js:404 | "These never go to cloud backup unencrypted" — but Dropbox backup uploads every saved login and password as plain JSON | verified (code) |
| 10 | S3 | shared/assets/vendorKeyUI.js:12, :24 | Kels's "Open Stripe in a new tab" uses the account's website as typed: `stripe.com` opens a KennelOS 404; a full address opens the vendor's home page, not the API keys | verified (code) |
| 11 | S3 | shared/pages/accounts.html:16 | Account cards have a 320 px minimum: at 320 px the page scrolls sideways by 16 px | verified |
| 12 | S3 | shared/data/referralShare.js:23 · accounts.js:114 | A referral link typed without `https://` is silently not shown to families, while her card shows it under "Shown to families" | verified |
| 13 | S3 | shared/assets/notificationsUI.js:105 · cloudNotify.js:91, :136 | iPhone: the permission prompt is asked only after a network round trip, and the daily re-subscribe runs with no tap at all; both may be refused by WebKit | suspected |
| 14 | S4 | cloud/src/ops.js:190 · notify.js:281 | Rotating the push key: /ops says devices stay silent "until each turns alerts on again" (they re-subscribe by themselves a day later); old-key endpoints are never pruned, and each event logs a failure per device | verified (code) |

**The keys (Evaluate 1): proven.** Jotform and Stripe keys live only in `device_secrets`
rows `jotform:<account>` / `stripe:<account>` (`jotformKeyStore.js:23`,
`stripeKeyStore.js:23`). `DEVICE_ONLY_TABLES` (`db.js:248`) keeps the table out of
`dataTables()`, which every export, backup, snapshot, Dropbox push and restore iterates
(`importExport.js:85`, `:178`, …); the merge paths that touch the table only re-key its ids
in place (`importExport.js:337`, `:409`); `syncRegistry` has no entry for it, and
`tests/stripePayments.test.js:161` already proves `exportAll` lacks the key. The only
readers are `jotformApi.call` (to the three Jotform hosts in `JOTFORM_REGIONS`, `credentials:
'omit'`, `no-referrer`), `stripeApi.call` (`Authorization` to `api.stripe.com` only) and
account health's check, which passes the key to those same two. No `console.*` in any of the
files; Kels's chat keeps no transcript; the cross-origin calls bypass the service worker's
cache. Nothing in `cloud/src` takes or stores a vendor key (`int_connections.token_sealed`
is for future OAuth adapters, and none is registered). The private-tier login fields
(`username`, `password`, `customer_id`, `notes`, `fee_note`, `fee_charge_back`) are
`private` in `syncRegistry.js:325`; the referral and payment fields are the shareable
half. The one leak of the *login* is finding 9.

---

## 1. Replacing an open Stripe link loses a payment made on it  (S2, verified)

**Where** `stripeLinks.js:62-79` (`makeSaleLink`), called from
`paymentRequestUI.js:180-181` (Send payment link) and `pickToSend.js:277`.

**Scenario** She sends Maple's buyer the one-time deposit link ($500). The buyer pays it that
evening. Before her device's next 15-minute check (or on her laptop, which has the key, while
the check is not yet due), she opens Maple's sale and taps **Send payment link**, choosing
"everything owed" ($3,000) — a different amount, so `reuse` is false and `makeSaleLink`
deactivates the old link and writes the new one over `payment_link_ref`. The check only ever
asks Stripe about the link the sale names now (`stripeLinks.js:98`), so the paid deposit
session is never read again. Scratch run: deposit link `plink_2` paid, new link `plink_4`
made, then `checkStripePayments({ force: true })` → `{ checked: 1, applied: 0 }`, sale still
`deposit_pending`, no deposit date, and the family now holds a $3,000 link for a sale they
have paid $500 on. Nothing tells her; the money is in her Stripe account only.

**Why it matters** The one path that can lose a payment record is the one she reaches for
when a family says "I paid" and the app disagrees.

**What I'd do** Before deactivating, ask Stripe for the old link's paid sessions (the same
`paidSessions` call) and apply them first; or keep superseded link refs on the sale until a
check has seen them.

## 2. A renamed Jotform field breaks prefill and signature-finding, silently  (S2, verified)

**Where** `jotformConnect.js:48` (a re-match keeps `current` as it is), `jotformMatch.js:174-179`
(`matchWarnings` checks only that `contractRef` *is mapped*, not that the field still
exists), `contractForms.js:79` (`mapValues` puts values under the stored names),
`jotformSigned.js:69-75`, `:110` (matches answers by the stored name), `contract.js:173`.

**Scenario** She connects Jotform, picks "Pet Home Contract" and accepts the matches
(`contractRef → ref12`, `buyerEmail → email3`, price, pup…). A month later she tidies the form
in Jotform: renames the hidden field's Unique Name to `contractReference` (or deletes it and
adds a new hidden field, which Jotform names afresh). Scratch run, with her form's real
questions after the edit: `matchWarnings(...)` → `[]`; the link sent to the next buyer is
`…?ref12=c-1&email3=…` — Jotform ignores `ref12`, so the reference (and any other renamed
detail: price, pup's name) arrives blank in the form the buyer signs. When the buyer signs,
`checkJotformSignatures` → `{ checked: 1, signed: 0 }` and the contract stays Sent; **Check for
signature** says "Not signed yet — Jotform has no submission of this form for this contract
yet", which is false. The only place the drift shows is the **Fields…** dialog, which marks
the old name "(not on the form now)" — if she happens to open it.

**Why it matters** Editing her own form is the most ordinary thing she will do with Jotform,
and this is the step the README says still needs a real account; it will meet this on first
contact. She chases a family for a signature they gave, and sends contracts with blank terms.

**What I'd do** When a matched form is sent or checked (both already call Jotform with the
key), compare the `field_map` names with `formFields(questions)` and say which details no
longer have a field; have `matchWarnings` flag mapped names that aren't on the form.

## 3. One failing call stops every check, and nothing records it  (S2, verified)

**Where** `stripeLinks.js:85-111`, `jotformSigned.js:94-117`, `app.js:214-217`
(`bootStripeCheck` / `bootJotformCheck` swallow the error), `accountHealthUI.js:84-110`.

**Scenario** She has two Payment service accounts with Stripe keys (her old Stripe account,
whose key she rolled, and the current one) or two Jotform accounts. Sales A (old key) and B
(current key, deposit paid) both have open links. Scratch run: the check stamps
`stripeCheckedAt`, asks about A, gets 401, throws — B is never asked, the waitlist
fee links after the loop are never asked, and `localStorage['kennelOS.integrations']` holds
`lastError: null`. Same for Jotform: a refused form first in the list leaves a contract on
another account, signed in Jotform, at Sent. The boot check runs again only after 15 minutes
and fails the same way, forever. Account health would not catch the real cases either: it
tests a Stripe key with `GET /payment_links` and a Jotform key with `GET /user`
(`accountHealthUI.js:103-104`), so a restricted key missing *Checkout Sessions: Read*, or a
Jotform key belonging to a different Jotform account than the forms, reads "connected and
working" while every paid-check fails with a permission or not-authorised error.

**Why it matters** A key going bad on one account quietly switches off automatic
deposit-received and contract-signed for **all** of them, with no line anywhere.

**What I'd do** Catch per sale / per form, keep a per-account last error in the
integrations state, show it on the Accounts card and Today; let health reuse the error the
last real check got instead of a narrower test call.

## 4. Tapping a family's alert opens a page that can't show what the alert said  (S2, verified (code))

**Where** `notify.js:339` (one family → `pages/waitlist-entry.html?id=<entry>`);
`cloudBackupUI.js:1655` starts the waitlist scheduler, whose first take-in is
`schedule(2000)` (`cloudWaitlist.js:646`); `waitlist-entry.js` has no listener for
`CLOUD_DATA_CHANGED_EVENT` (only `today.js:255` redraws on it); `serverWork.js:44-46`.

**Scenario** (a) Her phone is the backing device. The app is closed; "New message from Jane
S." arrives; she taps it. The service worker opens Jane's page, which renders from the
records on the phone; two seconds later `syncWaitlistOnline` takes the message in and writes
it, but the page never redraws. She sees no new message (or, for "Bo P. picked a pup", the
turn still open with its action buttons) until she leaves and comes back. (b) Her laptop
backs up; alerts are on her phone, which doesn't keep in step (Phase 1 only). Family events
are taken in only by the backing device or the lease holder, so on the phone the message
never arrives at all, and for a family whose entry was created on the laptop since the phone
last restored, the tap lands on "Waitlist entry not found." The Notifications card turns
alerts on for any device without a word about this.

**Why it matters** The plan's own test: an alert that promises something the app can't show
when tapped.

**What I'd do** Have the entry page redraw on `CLOUD_DATA_CHANGED_EVENT` as Today does
(or take in before the first render when opened from an alert); on a device that can't take
in, say so on the card and in the page the alert opens.

## 5. Later alerts in a burst wipe out the informative one  (S3, verified)

**Where** `notify.js:304-323` (`pendingPush` marks everything it returns as shown),
`notify.js:331-334` (nothing new → the generic line), `sw.js:513-517` (one tag,
`renotify: true`); plan §8 "No 2-minute coalescing".

**Scenario** Her phone is in airplane mode overnight; three families act. The push service
delivers three queued pushes in the morning. Scratch run against the Worker:
push 1 shows "KennelOS: 3 new on your waitlist — New message from Ann L. / Bo P. picked a pup /
New message from Cy D."; push 2 and push 3 each show "Something new on your waitlist." with
the same tag, so the lock screen ends on the generic line. When events come seconds apart
while she's online, each alert replaces the last with only the newest line, so "New message
from Ann L." is gone once Bo picks.

**Why it matters** The names were the point of D2; she now has to open the app to learn what
the three were.

**What I'd do** When nothing is new for the device, return the last shown set (or have the
worker re-show the open notification) instead of a generic one; or show the unseen-since-
opened count rather than the unseen-since-last-push one.

## 6. Unmatched and duplicate vendor events are dropped without a word  (S3, verified (code))

**Where** `jotformSigned.js:110` (a submission without this contract's reference is
skipped), `stripeApi.js:126-129` and `waitlistFeeLinks.js:72` (a fee session without a
valid `client_reference_id` is skipped), `waitlistFeePay.js:65` (`fee_already_received` →
`skipped`), `checkFeePayments` counts.

**Scenario** The buyer opens the bare form link she texted earlier, or a spouse fills a fresh
copy: Jotform holds a signed contract the app never connects to anything, and **Check for
signature** says there is no submission. A family pays the application fee twice (a double
tap, or online after she marked a check received): the second payment is `skipped` and
nothing tells her a refund is owed. A fee paid through the link without the family's
reference (sent by hand) is ignored.

**Why it matters** The integrations' promise is "Today tells you"; for these cases the only
record is in the vendor's dashboard.

**What I'd do** Keep these as reviews on Today ("Jotform has a signed Pet Home form from
ann@… that names no contract"; "Stripe took a second application fee from the Lees").

## 7. The alerts card says "on" when the phone has them blocked  (S3, verified (code))

**Where** `notificationsUI.js:56-58` (`push.thisDevice` is tested before `pushSupport()`),
`:112`; `cloudNotify.js:132` (`refreshAlertsHere` returns `'off'` when permission isn't
granted, leaving the server row); `sw.js` has no `pushsubscriptionchange` handler.

**Scenario** She turns KennelOS notifications off in iPhone Settings (or Android's). The card
still says "Alerts are **on** for this device"; **Send a test** answers "Sent. It should appear
in a few seconds" (the push service accepted it) and nothing appears. The `denied` help text
is never shown because the "on" branch wins. A browser that rotates its subscription
(Firefox does) loses alerts until the next daily refresh.

**What I'd do** Check `Notification.permission` and `pushManager.getSubscription()` before
saying "on"; handle `pushsubscriptionchange` in `sw.js`.

## 8. The alert switch outlives sign-out; `/notify` isn't owner-only  (S3, verified (code))

**Where** `cloudNotify.js:129-141` (`refreshAlertsHere` re-subscribes whenever the Cache
Storage note says `on` and *any* session exists), nothing in `cloudAuth.signOut`,
`appReset.js` or the assist hand-back clears `kennelos-notify` or unsubscribes;
`api.js:37-41` `OWNER_ONLY` has no `/notify` route.

**Scenario** Support's device uses KennelOS Pro with alerts on for support's own account.
It opens a breeder's assist link (helper session). A day after its last refresh,
`bootCloud` → `refreshAlertsHere` → `POST /notify/push/subscribe` with the helper session:
the support device now gets the breeder's families' names on its lock screen ("Jane S.
picked a pup") until the helper session ends, and the breeder's card counts "2 devices".
The helper can also change her alert kinds and start her digest at another address
(confirmed by a code sent to that address). Same on a shared family tablet after
sign-out → sign-in as someone else.

**What I'd do** Clear the note and unsubscribe on sign-out, reset and hand-back; refresh only
for the account that turned alerts on; put the `/notify` writes in `OWNER_ONLY`.

## 9. Saved logins go to Dropbox in plain text, against the form's promise  (S3, verified (code))

**Where** `accounts.js:404` ("These never go to cloud backup unencrypted — only inside your
private vault"); `import-export.js:67` and `importExport.js:27` (a Dropbox push is the full
`exportAll`), which includes `accounts.password`, `username`, `customer_id`.

**Scenario** She saves her AKC and Chewy passwords on the strength of that line, then uses
Import/Export → Dropbox ("Uploads a full backup to your own Dropbox"). `/Apps/KennelOS/
kennelos-backup.json` in her Dropbox now holds every password in clear JSON. (The downloaded
JSON file does too — that is the documented private-tier rule, but the hint doesn't say so.)

**What I'd do** Say exactly where they go ("in backup files and Dropbox backups as you save
them; never to KennelOS's cloud unless your vault is on"), or leave private-tier fields out
of the Dropbox copy.

## 10. Kels's "Open Stripe/Jotform in a new tab" goes to the wrong place  (S3, verified (code))

**Where** `vendorKeyUI.js:12`, `:24` (`site: a.website || …`), rendered at `:44`.

**Scenario** Her Stripe account's Website field holds `stripe.com` (the form's own example is
`chewy.com`, no scheme). "Help me replace it" offers **Open Stripe in a new tab** →
`href="stripe.com"` → `/shared/pages/stripe.com`, a 404 inside KennelOS. With
`https://stripe.com` it opens Stripe's marketing page, not Developers → API keys, which the
fallback would have opened.

**What I'd do** Always open the vendor's key page; offer her website as a second link, made
absolute the way `accounts.js` `hrefFor` does.

## 11. The Accounts page scrolls sideways at 320 px  (S3, verified)

**Where** `accounts.html:16` — `.acct-grid { grid-template-columns: repeat(auto-fill,
minmax(320px, 1fr)) }`.

**Scenario** At 320 px (iPhone SE 1st gen, small Androids) the card is 320 px inside 16 px
padding: Playwright measures `scrollWidth` 336 with the one account card as the only
overflowing element. Every viewport under 352 px scrolls.

**What I'd do** `minmax(min(320px, 100%), 1fr)`.

## 12. A referral link without `https://` is dropped but shown as shared  (S3, verified)

**Where** `referralShare.js:21-24` (`safeLink` needs a scheme), `:32-42`; `accounts.js:114`
(the "Shown to families" badge), `accounts.js:412` (a plain text input, no check).

**Scenario** She types `chewy.com/r/abc` and code `THORN30`, ticks Share with families, saves.
Her card shows "REFERRAL — TO SHARE · Shown to families · Link chewy.com/r/abc · Code THORN30"
(screenshot); families get the code only. `sharedTransport` already rescues a schemeless
website; referral links get no such help.

**What I'd do** Normalise or refuse a schemeless link at save, as the payment link is
(`paymentLink`, `accounts.js:644`).

## 13. iPhone alerts: permission and subscribe may run without a tap  (S3, suspected)

**Where** `notificationsUI.js:103-107` (**Turn on alerts** awaits `saveSettings` — a
network call — before `enableAlertsHere` calls `Notification.requestPermission()`);
`cloudNotify.js:136`, `:101` (the daily refresh unsubscribes and re-subscribes on page load, with no
user gesture, after a key change).

**Scenario** WebKit asks web apps to request notification permission (and subscribe) from a
user gesture; after an awaited fetch the tap may no longer count, so on a slow connection the
prompt may never show and the card reports "Alerts weren't allowed…". Plan §8 says alerts
were never tried on a real iPhone. Not verifiable here.

**What I'd do** Request permission first, synchronously in the click handler, then save; try
both paths on an installed iPhone app.

## 14. Rotating the push key: wording and stale endpoints  (S4, verified (code))

**Where** `ops.js:188-191`; `notify.js:271-283`.

**Scenario** The owner rotates `VAPID_PRIVATE_JWK`. /ops says every device stays silent "until
each turns alerts on again"; in fact each re-subscribes by itself on its first open after 24
hours (`enableAlertsHere`'s `sameKey` check), and the card meanwhile still says "on". Until
then every event posts to every old endpoint, gets 401/403, keeps the row and logs
`push send failed` per device; only 404/410 prune. Harmless now; misleading the day the key
is rotated in earnest.

**What I'd do** Correct the /ops sentence; treat a 401/403 after a key change as "re-subscribe
needed" (drop the row) so the card shows the truth.

---

## Notes, not findings

- **`0019` / `0021` before they're applied:** fine. `countMail` swallows a missing table
  (`mail.js:32-49`), so sends never fail for it; /ops shows the mail sections only once
  nothing is pending (`ops.js:162`), and `mailDailySummary` has its own catch. The cron skips
  everything while migrations are pending (`index.js:112`), so no digest goes out during a
  pending window and none is lost (items keep 8 days). README says every migration through
  `0021` is applied.
- **A dead subscription** (404/410) is deleted at once (`notify.js:275`) and the device
  re-subscribes on its next daily refresh; an expired session silences and deletes in
  `pendingPush`. Good.
- **The digest:** empty → no email; a week offline (her device) changes nothing, the server
  digests daily; unsubscribe is a GET page with a POST button and deletes the address. One
  edge: a weekly digest whose Monday send fails all day waits a week, and retention drops
  items older than 8 days first — the older half of that week is never sent.
- **The new waitlist Today nudges** (a removal's undo window, side sales, picks due,
  policies) reach neither alerts nor the digest: by design, the catalog is server-seen
  events only (plan §1, §8). Worth a line on the card ("Alerts cover what families do; Today
  has your own deadlines").
- **Webhook replay** is not reachable yet: no adapter is registered (`registerAdapter` has no
  caller), so every `/hooks/` call is 404 and the integrations scheduler asks nothing. When
  one is added, `UNIQUE (connection_id, provider_event_id)` plus the device's "already"
  skips make a replay harmless. Jotform has no webhook in this design: her device polls, and
  only Sent contracts are read, so a submission seen twice changes nothing.
- **Jotform on first contact, other risks:** CORS from a browser and the EU/HIPAA hosts are
  marked unverified in the code; a pasted form link with a custom slug
  (`form.jotform.com/thornfield/pet-home`) has no numeric id, so it is never checked and the
  "Can't check this one" text blames the reference field. A contract re-sent after a buyer
  already submitted is marked Signed from the *oldest* submission inside the window.
- **Stripe on first contact:** the expand path is three levels (within Stripe's four); the
  permission list on the form (`Balance: Read`) and the comment in `stripeApi.js`
  ("Balance transaction sources / Balance") disagree — check which one the fee expand needs.
- **Orphaned keys:** deleting an account on another device (or changing its type) leaves its
  `stripe:` / `jotform:` row on this device, where no screen can show or disconnect it; the
  Stripe check still uses it for sales paid via that id.
- **Account health's judgements** are otherwise right and not alarming: "export-old" is
  waived while cloud backup runs and counts Dropbox pushes; storage and passkey findings
  offer "don't ask again"; a key it can't reach is "couldn't check", never "refused".
- **Accounts page recipe:** escaping is clean throughout (cards, field-map JSON in
  `data-` attributes, Jotform titles and statuses); only repos are imported; Demo hides
  Connect; delete is blocked by every account FK in `referenceRegistry` and forgets both keys.

## Coverage gaps I found (tests that should exist)

- `makeSaleLink` replacing a link that has a paid session (finding 1).
- `checkStripePayments` / `checkJotformSignatures` with one account refused and another
  paid/signed (finding 3).
- `matchWarnings` / the send path with a `field_map` naming a field the form no longer has
  (finding 2).
- `pendingPush` called twice for one burst; the second result (finding 5).
- `waitlist-entry.js` redrawing after a take-in (finding 4).
- `refreshAlertsHere` after sign-out and sign-in to another account (finding 8).

## What I did not get to

- A real Jotform or Stripe account (none reachable from here), and a real phone for push.
- `waitlistFeeStep.js` and Kels's "Set up my accounts" task (K11's), beyond the key paths.
- `paymentLinks` and `referralShare` tests were read for their contract only; I did not
  re-derive every message's wording.
