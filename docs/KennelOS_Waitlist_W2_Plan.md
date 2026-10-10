# KennelOS Waitlist — build plan: W2, the waitlist online (DRAFT)

> Parent design: `docs/KennelOS_Waitlist_Spec.md` ("Spec §N"): §8 (the server side), §12
> (the W2 row), §15 (her requests whose server halves join W2), and her answers in §13.
> Builds on the Phase 1 Worker (`docs/KennelOS_Cloud_Phase1_Plan.md`, "Phase 1 §N"), the
> private vault (`docs/KennelOS_Private_Vault_Plan.md`) and the Pro license link
> (`docs/KennelOS_License_Link_Plan.md`).
> **Status: approved 2026-10-08, every §10 decision as recommended; building.** All three
> prerequisites are live. §11 is the build order, one reviewable PR per step.

## 1. Scope

**In (Spec §12's W2 row, plus her 2026-10-08 answers):**
- **The online application form** (her own questions, FAQ and public-list notice, Spec §15.1,
  §15.3, §15.8), encrypted in the applicant's browser to her form key, landing in an
  **encrypted inbox** her device reads (Spec §8.2). **Rotate form key.**
- **The family's status page** (Spec §8.3): status, position, passes, offers with the pups
  eligible to them, and the buttons **Accept a pup**, **Pass**, **Still interested**,
  **Request a pause** (with an end date; she approves, Q7), **Leave the list**; listen-only
  changes (Spec §15.7) and **Ask to change** for matching answers (Spec §15.9); an encrypted
  **message box**; the optional **Message us on Facebook** button; "Fee received".
- **The public list page** (Spec §15.3): every family on the list, however many, with a
  search box; also a tab on the status page.
- **Emails in the kennel's name**, no-reply (Spec §15.4): approval / fee request, fee
  received, offer, reminders, deadline passed, decline, "almost your turn" (Spec §15.5),
  request decisions, and the status-page link.
- **Family responses and server moves** as an event stream her devices read (Spec §8.4).
- **Server deadlines and automatic offers while she's offline**, only for the moments she
  ticked in `waitlist_config.auto_offer_on` (Spec §4.6, §8.4, Q13). Every window is hers
  (Q18).
- **Pro entitlement** (`requirePro`) on every route for her, **rate limits** everywhere.

**Out:** the assistant (W3: FAQ chat, check-ins, phrasing messages); payment collection
(Q6: fee received stays her tap); SMS / Messenger notifications; helpers on their own
devices (Proposal Phases 2–3); Lite and Demo (Spec §11: the waitlist is Pro-only, and Demo
has `cloudUrl: null`); **invoices and receipts on the status page** (Spec §15.2; dropped
2026-10-08, her decision: she downloads the PDFs and sends them herself, so no document
ever reaches the server).

## 2. How it fits together

```
 applicant / family browser            Worker (cloud/)                 her Pro device (backing device)
 ─────────────────────────            ───────────────                 ──────────────────────────────
 /apply/<kennel public_id>  ── form ─▶ wl_inbox (encrypted blob +   ◀── GET  /waitlist/inbox, ack
   encrypts to her form key            name + email readable)
 /s/<token>  status page   ◀─ reads ── wl_projection (her device's  ◀── PUT  /waitlist/projection
   buttons, message box    ── acts ──▶ allow-listed copy) + holds
                                       wl_events (seq)               ──▶ GET  /waitlist/events?since=
 /list/<kennel public_id>  ◀─ reads ── wl_projection (public part)
 email (no-reply)          ◀── sends ─ wl_messages ◀── hourly cron  ◀── POST /waitlist/messages
                                       (deadlines, reminders,
                                        auto offers if ticked)
```

- **Her device stays the single source of truth** (Spec §8.3). It computes every position,
  eligibility and offer with `waitlistRules.js` and publishes an allow-listed **projection**.
  The server only displays it, records family responses as events, and makes the narrow
  automatic moves of §6 below.
- **Only the backing device** (Phase 1 §3.4) publishes projections, reads the inbox into
  entries and applies events. Other devices get the results through backup and sync, so
  nothing is created twice. Any of her devices may **read** events (each keeps its own
  cursor) to show badges.

## 3. Hosting the family pages

**Recommended (D1):** the **same Worker** serves the family pages at
`https://apply.kennelos.app`, a second custom domain beside `api.kennelos.app`:
- static HTML/JS/CSS from a new `cloud/public/` through an `[assets]` block (the rule in
  `cloud/README.md` holds: never add `not_found_handling`);
- `/apply/<public_id>`, `/s/<token>`, `/list/<public_id>` are pages; their JSON routes sit
  under the same origin (`/f/…`), so **no CORS is opened** to them;
- staging serves the same pages from its `workers.dev` address.

These pages aren't an edition: no service worker, no Dexie, no `shared/` imports beyond
copied pure helpers (the projection is already computed). They're small, plain, and work on
a phone with no install. `shared/sw.js` is untouched by them.

## 4. Server data (migration `0007_waitlist.sql`, additive)

All keyed by the account's `program_id` (the cloud data set, not a waitlist program) and the
kennel's `public_id`. One program can have several own kennels, each with its own list
(Spec §0).

| Table | Holds | Readable? |
|---|---|---|
| `wl_kennels` | `program_id`, `public_id`, form state (open/closed), current form public key + key id, Turnstile on, the kennel's IANA time zone | Yes (no personal data) |
| `wl_projection` | one row per kennel: `version`, the projection JSON (§5), `published_at` | Yes; it's allow-listed by her device |
| `wl_tokens` | status-page token → (`program_id`, `public_id`, `entry_id`), created / last used | Token is a bearer secret for one family's page |

**Where a token comes from.** Her device needs every family's link (Copy status link, §8), so
the token is stored on the entry, `waitlist_entries.status_token` (private tier: it opens that
family's page). An online application gets its token from the server at submission (the
confirmation email carries the link) and the inbox item hands it to her device with the
application. A family she typed in gets one minted on her device (256 random bits) and
published with the projection. **New link** on the entry replaces a token that was shared
too widely; the old link stops working at the next publish.
| `wl_inbox` | applications and family messages: encrypted blob, key id, and for applications the readable **name + email**; `acked_at` | Blob no; name + email yes (Q11) |
| `wl_events` | `seq`, kind, `entry_id`, payload (button pressed, pick, pause-until date, requested answers), `based_on_version`, made by (`family` / `server`) | Yes; no free text (messages go to the inbox) |
| `wl_holds` | a pup held by a family's **Accept a pup** until her device creates the Sale | Yes |
| `wl_messages` | queued and sent emails: to, kind, subject, body, `send_after`, sent / failed | Yes (Q11: outbound text is readable) |

Retention (the daily cron, `retention.js`): an inbox item is only the server's delivery
copy; the application itself lives on her device for as long as the family is on the list.
The copy is purged once her device has it **and** it's safe in a private backup: acknowledged
30+ days ago and a committed snapshot with a vault part made after the acknowledgement
(her request, 2026-10-08). Without private backup it stays; an unread item never goes. A
reset or replacement phone can fetch acknowledged items again (`GET /waitlist/inbox?all=1`).
Then:
`wl_events` older than 90 days trimmed, sent `wl_messages` bodies dropped after 90 days
(subject and date kept for her log), tokens of entries no longer in any projection expired.
Account deletion removes all of it. `/ops` gains counts (never contents) and export.

## 5. The projection (her device → server)

A new pure module, `shared/data/waitlistProjection.js`, built field by field from
allow-lists like `companionExport.js`'s prospective bundle, unit-tested the same way. One
document per own kennel with the waitlist in use:

- **`kennel`:** name, logo, time zone, form questions + FAQ + public-list notice (her
  wording), fee policy wording, Facebook Page link if switched on, `auto_offer_on`, email
  templates (§8).
- **`public_list`:** exactly `waitlistRules.publicList` (Spec §15.3): position, first name +
  last initial (or "A***** K" for a family she let list privately), sex preference, date added; paused and readiness-held families left out,
  numbers skipped.
- **`entries[entry_id]`:** what that family's status page shows: status, overall and
  per-litter position, passes used / max, listen-only choice and the parents she offers,
  readiness, pause (and a pending pause request), pending answer-change request, open offers
  with respond-by date and the pups eligible to them (call name, sex, color, photo if she
  shares one), fee amount + payment instructions **while approved and unpaid only**, fee
  received + date (Q11), her outbound messages log, the family's **email +
  name** (for the server's emails; Q11).
- **`litters[litter_id]`:** label, expected/whelp month, picks open, and **every eligible
  family in order, however many** (Q13), with the pups each is eligible for. This is the list
  the server walks for automatic offers (§6).

**Never in it:** contact details beyond the family's own email and name, other answers,
programs, notes, money other than the unpaid fee, prices she hasn't published, private
fields. `tests/waitlistProjection.test.js` pins the allow-list the way
`tests/syncRegistry.test.js` pins backup.

**When it's published:** by the backing device, debounced after any waitlist write (and on
opening the app), only when the JSON changed. Each publish bumps `version`. While signed out,
offline or not Pro, nothing is published and her app says the online list is paused.

## 6. Events and the server's own moves (Spec §8.4)

**Family actions → events.** Each button on the status page writes one `wl_events` row and,
where the page must show the result at once, updates the projection copy server-side:
- **Accept a pup** (a pick): a `wl_holds` row so nobody else can take that pup; her device
  then runs `recordPick` (deposit-pending Sale). The deposit stays her tap (`confirmDeposit`).
- **Pass**, **Still interested**, **Leave the list**: recorded; her device runs
  `recordOutcome(…, 'passed')` / logs it / `withdraw`.
- **Request a pause (until a date)**: recorded; her device stores it as a request on the entry
  and Today gets **Approve** / **Decline** (Q7). Nothing changes until she taps.
- **Listen-only:** a **wider** change is applied by her device on sync without asking; a
  **narrower** one becomes a request she approves (Spec §15.7 item 6).
- **Ask to change** a matching answer: a request, exactly Spec §15.9.

**The server's own moves**, only for moments ticked in `auto_offer_on` (none by default):
- the hourly cron finds offers past their **cutoff instant** (respond-by date, end of day in
  the kennel's time zone, Spec §6.5). If that moment (`no_response`, or `no_deposit` when
  the family had picked) isn't ticked, it records nothing and offers nobody; the offer waits
  for her device's suggested action. Ticked: it records the outcome as an event, releases any hold, and
  offers the turn to the **next family on that litter's published list** who isn't already
  holding or spent there, sending the offer email (§8);
- a family's **Pass** or **Leave the list** with `passed` / `left` ticked: the same next
  offer;
- if the published list runs out, it stops and waits for her device.

**Her device applies events** (new `shared/data/waitlistEvents.js`: a pure reducer from an
event + current records to the `waitlistActions` call to make, unit-tested; plus the fetch
loop). A server move applies automatically only when nothing it touches (that entry, that
litter's offers, those pups) changed locally since `based_on_version`; otherwise it becomes a
Today suggestion she confirms or discards (Spec §8.4). Each device keeps its read cursor in
`settings.js`.

**Reminders** (hourly cron): halfway through an offer window and the morning of the deadline;
before a fee window closes. Sent only for windows she set (Q18); a blank `fee_due_days`
means no fee reminder ever.

## 7. Encryption

- **Form key (Spec §8.2, D3):** an ECDH P-256 key pair made on her device. Applicants'
  browsers encrypt each application to it (ephemeral ECDH → HKDF → AES-GCM, WebCrypto only,
  sharing `vaultCrypto.js`'s primitives). The private key lives in a new **private** table,
  `waitlist_form_keys` (`id`, `kennel_id`, `public_key`, `private_key`, `created_at`,
  `retired_at`), so it rides the private vault and file backups but never cloud backup.
  **Rotate form key** adds a row and retires the old one; old keys stay so old applications
  open. If private backup is off, the setup screen says plainly that losing this phone loses
  unread applications (the Vault Plan's decision 6: strongly suggested, not a gate).
- **Family messages:** encrypted to the same key by the status page, into `wl_inbox`.

## 8. Email

- **From:** `<Kennel Name> <<slug>@mail.kennelos.app>` (Spec §15.4 a), no Reply-To. A new
  Resend sending domain, `mail.kennelos.app`, so the sign-in address keeps its own
  reputation.
- **Templates:** each email kind has a default text with placeholders (`[Kennel Name]`,
  `[Family]`, `[Litter]`, `[Pups]`, `[Respond by]`, `[Position]`, `[Status link]`) and her
  edited version in `waitlist_config.email_templates` (cloud tier, like `soon_notice_text`;
  edited in Waitlist settings). **Every fact comes from the rules engine**; the server only
  substitutes placeholders from the projection, never decides anything. No money details in
  any email (Spec §5.3).
- **Who queues:** her device for everything her taps cause (`POST /waitlist/messages`), the
  server for its own moves and reminders (§6), the form for the applicant's confirmation.
- **Status link:** every email ends with "Reply or take action on your status page:
  <link>". Families she typed in by hand get their link with the first email she sends them,
  or from **Send status link** on their entry.
- **Copy status link (her request, 2026-10-08):** wherever a family has an open offer (the
  family's entry page and the Litter page's picks panel), and on the entry page generally,
  **Copy status link** puts the family's status-page link on the clipboard so she can send
  it through Messenger or a text herself. For this her device always knows each family's
  link: see the token below.
- **No-reply auto-answer (D8):** a reply gets one automatic answer pointing back to the
  status page and is neither stored nor read. Needs Cloudflare Email Routing on
  `mail.kennelos.app` into the Worker's `email` handler; last step, optional at launch.
- Sent mail and family messages show on the family's entry (Spec §10.4) from a new private
  table, `waitlist_messages` (`entry_id` FK, direction, date, subject, body, status).

## 9. Client changes (`shared/`, Pro only)

- **New modules:** `waitlistProjection.js`, `waitlistEvents.js`, `data/cloud/cloudWaitlist.js`
  (the only caller of the new `cloudApi.js` functions; checks `isCloudAvailable()` and the
  release flag first), `waitlistFormKeys.js`. All Pro-only in `proPages.js`, all in
  `PRECACHE_URLS`.
- **New fields and tables:** `Kennel.time_zone` (IANA; defaults to the device's zone the
  first time the list goes online; cloud); `waitlist_form_keys` and `waitlist_messages`
  (private, each with its FK in `referenceRegistry.js`); `waitlist_entries.pause_request`
  (private, like `pref_change_request`); `waitlist_entries.status_token` (private, §4).
  `waitlist_config` gains `email_templates` and
  `online_form_open`. Each lands in `syncRegistry.js`, `db.js` and the End-State guide in the
  same change (CLAUDE.md).
- **Waitlist settings:** **Put the list online** (form open/closed, the three links to copy,
  time zone, Rotate form key), email templates, the Facebook switch.
- **Copy status link** and **New link** on the family's entry page, and **Copy status
  link** beside an open offer on the Litter page's picks panel (§8). Hidden until the list
  is online.
- **Today:** new applications from the inbox, family messages, pause requests, answer-change
  requests, server moves needing a look, and "the online list is paused" when publishing
  can't run.
- **Release flag:** `WAITLIST_ONLINE_RELEASED` in `cloudConfig.js`, false until step 8, like
  `VAULT_RELEASED`; staging can turn it on with the test switch.

## 10. Decisions (all taken as recommended, 2026-10-08)

1. **D1, hosting:** the family pages on the same Worker at `apply.kennelos.app`
   (recommended: one deploy, same-origin JSON, no new CORS) or a separate static site on
   GitHub Pages calling the API cross-origin.
2. **D2, documents: dropped from W2** (her decision, 2026-10-08). She sends invoices and
   receipts herself; the status page has no documents list, so neither the `#` link key of
   Spec §15.2 nor per-browser keys are built.
3. **D3, the form key:** a private `waitlist_form_keys` table riding the vault (recommended)
   or the device-only `device_secrets` table (then a new phone can't read the inbox).
4. **D4, server-sent emails use her templates with plain placeholder substitution**
   (recommended) rather than her device pre-writing every possible future email.
5. **D5, applications become entries with the inbox item's id as the entry id**
   (recommended), so a retried fetch can't create the same family twice.
6. **D6, the outbound message log** is a new private table on her device (recommended)
   rather than kept only on the server.
7. **D7, release** behind `WAITLIST_ONLINE_RELEASED` (recommended), so steps 1–7 merge with
   nothing visible.
8. **D8, the no-reply auto-answer:** build it last (recommended), or drop it and let replies
   bounce.
9. **Still open in the spec, not blocking W2:** Q4 (colors decide eligibility? today it's her
   `color_matching` switch), Q8 (picks open on her tap, as built, or automatically at an age),
   Q9 (one family at a time, as built), Q10 (her programs). W2 keeps today's behavior for
   each unless she says otherwise. Q15–Q16 are W3.

## 11. Build order (each a reviewable PR)

> **Before step 6 (2026-10-08):** her requests in Spec §16 change the offer model (one turn
> per family across every open litter, §16.1, which settles Q9) and add to the status page
> (passing ahead of time, listen-only "except", pass reasons, early litters, "Review your
> preferences", "Ready now?"). They rework W1c's offers and step 5's offer handling, and steps
> 6–7 build on the result, so they're planned and built first, as **step 5c** (below, between
> steps 5 and 6). Q30–Q34 answered 2026-10-08.

1. **Server foundation.** Migration `0007` (+ its `index.js` line), `cloud/src/waitlist.js`
   (projection PUT/GET with `requirePro`, events read, inbox fetch/ack, messages queue),
   rate limits (`limitBucket`), retention, `/ops` counts + export, account deletion, the
   hourly cron entry beside the daily one, tests (`cloud/tests/waitlist.test.js`). Staging:
   Apply pending.
   **Built 2026-10-08.** Where it differs from the above, this wins:
   - **Routes:** `PUT` / `GET` / `DELETE /waitlist/projection/:publicId`, `GET /waitlist/inbox`,
     `POST /waitlist/inbox/ack {ids}`, `GET /waitlist/events?since=`. Every one runs
     `requirePro` and a per-program limit (600 calls an hour); publish, take offline and ack
     need the backing device (`409 not_backing_device`, with `backingInfo`).
   - **Tokens:** each `entries[id].status_token` (64 hex) is stripped from the stored body into
     `wl_tokens`; a token missing from a later publish is revoked (New link). Two entries can't
     share one, and a token another program holds is refused (`409 token_taken`), never
     repointed. A `public_id` belongs to the first program to publish it (`409 kennel_taken`).
   - **Size:** a projection is capped at 1.5 MB (D1's row limit is 2 MB).
   - **The inbox is a mailbox, not storage (2026-10-08):** an acknowledged item stays until a
     private backup made after the ack exists (and at least 30 days); `?all=1` re-fetches
     acknowledged items still held, paged with `after`/`next`, each item carrying `acked`.
   - **Taking a list offline** removes its projection, tokens and holds; the inbox and events
     stay until her device reads them.
   - **Deferred:** `POST /waitlist/messages` moves to step 6 (nothing sends yet) and the hourly
     cron to step 7 (nothing to run yet). Migration `0007` already holds every W2 table
     (`wl_projection`, `wl_tokens`, `wl_inbox`, `wl_events`, `wl_holds`, `wl_messages`), so
     W2 needs no further migration as planned.
2. **Device: publishing.** `Kennel.time_zone`, `waitlistProjection.js` + tests, the
   debounced publish from the backing device, `cloudWaitlist.js`, the settings card's
   "Put the list online" (behind the flag). Registries, schema, End-State guide.
   **Built 2026-10-08.** As built:
   - `shared/data/waitlistProjection.js` (pure; `tests/waitlistProjection.test.js` pins the
     allow-list and that it agrees with the rules engine). A family whose time on the list
     ended keeps only `{ name, email, status }` (and its token), so an old link still says
     what happened. Every eligible family per live litter, however many.
   - `shared/data/cloud/cloudWaitlist.js`: hash-compare and publish per online kennel,
     unpublish when taken offline; 20 s debounce on data changes, on load, on reconnect.
     Started by `cloudBackupUI.bootCloud()` (Pro, offered only). Settings key
     `kennelOS.waitlistOnline`. `tests/cloudWaitlist.test.js` runs it against the real Worker.
   - `waitlist_config.online` and `Kennel.time_zone` (cloud tier). The **Online list** card on
     the Kennel page (`assets/waitlistOnlineUI.js`, Pro-only) with a **Preview** badge.
   - `cloudConfig.WAITLIST_ONLINE_RELEASED = false`: offered on localhost and with
     `?cloud=staging` only.
3. **The public list and status page, read-only.** `cloud/public/` pages, `apply.kennelos.app`
   on staging, "See Your Details" (6-digit code), the search box, phone-width checks.
   `status_token` on entries, **Copy status link** / **New link** (§8, §9).
   **Built 2026-10-08.** As built:
   - **Server** (`cloud/src/familyPages.js`): `/list/<public_id>` and `/s/<token>` serve
     `public/family/list.html` / `status.html` through the `ASSETS` binding (`[assets]` in
     `wrangler.toml` with `run_worker_first` and `html_handling = "none"`, inherited by
     production; checked with `wrangler deploy --dry-run` for both); `/family/*` serves their
     files. Pages get `no-referrer`, `noindex` and a strict CSP (no inline script or style,
     nothing from elsewhere). JSON is same-origin: `GET /f/list/:publicId`,
     `GET /f/status/:token` (`statusView`: the family's own entry minus their email, their
     offers with the pups each lists, every live litter with only THEIR place, the public
     list), and See Your Details below. 600 reads an hour per IP.
   - **See Your Details (her wording and design, 2026-10-08; replaced "Email me my link").**
     On the public list page: *"Access your private waitlist status page by entering your
     verification code below. A new verification code can be generated by entering the
     email address used on your waitlist application."* A code box (**View my details**) and
     an email box (**Send me a new code**). `POST /f/code {public_id, email}` emails a 6-digit
     code if that address is a family on that list with a link (always `{ok:true}`; 3 an hour
     per address, 20 per IP; `503` before any lookup when email is down); the code alone
     names the family (unique among the kennel's live codes), lasts 15 minutes, works once,
     and a new one replaces the old. `POST /f/verify {public_id, code}` → the family's status
     link and a **family session** (64 hex, stored hashed, 90 days); guessing is cut off at 10
     tries an hour per IP and 300 per kennel. **Every device signs in on its own and stays
     signed in** (a family session per browser; a new code never ends one), so two people in
     a family can both follow it. The page keeps the session in that browser
     (`public/family/session.js`) and next time shows **Open my page** / **Sign out**;
     `POST /f/session` turns it into the current link (it survives New link). Status links
     still open the page directly, read-only; **step 5's buttons will need a family
     session**, so a forwarded link can look but not act. Migration `0008`
     (`wl_family_codes`, `wl_family_sessions`); taking the list offline, account deletion
     and retention clear them. Emails go through `mail.sendFamilyMessage` from `MAIL_FROM`
     until step 6, recorded in `wl_messages` (staging's outbox mode records without
     delivering).
   - **Pages** (`cloud/public/family/`): the public list with a search box (a number finds
     that position; anything else the name, any case or accent, or the date), the gap note,
     See Your Details; the status page with My page / Public list tabs (their own row
     highlighted), the offer card with the respond-by time in the kennel's zone, the fee
     card while unpaid, their place, litters ("#2 in line" / "Not a match for you" / "No pups
     yet"), what they asked for; light and dark. The copied vocab labels are pinned to
     `vocab.js` by `tests/familyPages.test.js`.
   - **Device:** `waitlist_entries.status_token` is **cloud tier** (the server already holds
     every token, so backup tells it nothing new, and a restore without private backup must
     not change every family's link). `cloudWaitlist.ensureStatusTokens` mints one per entry
     of an online kennel before each publish; `replaceStatusToken` is **New link**.
     `cloudConfig.familyPagesUrl()` / `statusPageLink()` / `publicListLink()`: production →
     `https://apply.kennelos.app`, staging → its own address. **Copy status link** + **New
     link** on the family's page, **Copy status link** beside an open offer on the picks
     panel, **Copy public list link** on the Online list card (`waitlistUI.copyLink`; falls
     back to showing the link where the clipboard is blocked).
   - `cloud/tests/helpers/serve.mjs` runs the real Worker locally on the test database with
     the pages, to look at them in a browser.
4. **The online form and inbox.** Form key table + Rotate, the form page (her questions,
   FAQ, notice, Turnstile), encryption, confirmation email, the inbox → `applied` entries on
   the backing device.
   **Built 2026-10-08.** As built (where it differs from §4, §7 and §9, this wins):
   - **Form keys live on the kennel, not in a table:** `Kennel.waitlist_form_keys`
     (`[{ id, public_key, private_key (JWK), created_at, retired_at }]`), **private** in
     `syncRegistry.js` (vault and file backups only), so no schema change. Made on the
     backing device the first time **Take applications online** (`waitlist_config.online_form`)
     is on (`cloudWaitlist.ensureFormKey`); **Rotate form key…** adds one and retires the
     rest (`rotateFormKey`); old keys stay so earlier applications open.
   - **Crypto:** `shared/data/waitlistCrypto.js` opens, `cloud/public/family/seal.js` seals
     (ECDH P-256, a fresh key pair per application, HKDF-SHA-256, AES-GCM-256 with the key id
     bound in). `tests/waitlistCrypto.test.js` seals with one and opens with the other.
   - **Projection:** `kennel.form` (only while online_form is on): her questions as
     `formQuestions` gives them, FAQ, breeds, matching keys and notice, color matching, and the
     PUBLIC key.
   - **Server:** `GET /f/form/:publicId`; `POST /f/apply/:publicId {key_id, sealed, name,
     email, turnstile}` (96 KB; 5 an hour per IP, 3 per address per kennel; `409
     form_changed` after a rotation; Turnstile when `TURNSTILE_SECRET` is set, skipped on
     staging's outbox, and `503 form_unavailable` on production without it). The application
     is stored **unconfirmed** with its status-page token and the applicant is emailed a code;
     typing it (`/f/verify`) confirms it and signs that browser in. Unconfirmed applications
     never reach her and go after two days (migration `0009`: `wl_inbox.confirmed_at`). A new
     try from the same address replaces an unconfirmed one; See Your Details also finds an
     application not yet taken in. A publish keeps the token of an application her device
     hasn't taken in. The applicant's page says "Application received" until then.
   - **Taking it in** (`cloudWaitlist.takeInApplications`, before each publish, and every 5
     minutes while the app is open and in front): each confirmed application is opened and
     becomes an `applied` entry with the inbox id as its id, the applicant's status token and
     `source: 'online_form'`, through `shared/data/waitlistInbox.js` (pure; nothing
     unchecked: only her questions, her choices, the vocab and her breeds, cut to size;
     `tests/waitlistInbox.test.js`). A device that never fetched before asks for everything
     the server still holds (`?all=1`) and fills in answers a restore without private backup
     left out. One it can't open (a key it doesn't have) stays in the inbox and the card says
     so.
   - **The form page** (`/apply/<public_id>`, `cloud/public/family/apply.*`): her FAQ, her
     questions in order (choices for the preferences, her breeds, the readiness question
     required), the matching notice before the first matching question, the public-list
     notice with **I understand**, required-field checks, Turnstile when configured, then
     "Check your email" with the code box and **send a new code**; the code opens their status
     page. Copy application form link is on the Online list card.
   - Families' own messages (also sealed to this key) are step 5.
5. **Family actions.** Buttons → events, holds, `waitlistEvents.js` + tests, Today
   requests (pause, answer changes, listen-only narrowing), the encrypted message box.
   **Built 2026-10-08.** As built (where it differs from §4, §6, §8 and §9, this wins):
   - **Server** (`cloud/src/familyActions.js`): `POST /f/act {session, status_token, action,
     …}` for `pick`, `pass`, `still_interested`, `pause_request {until, note}`, `leave {note}`,
     `listen {mode, sire_ids, dam_ids}`, `pref_change {changes, note}`. Every one needs a
     **family session** for that same family (`401 signed_out`, `403 other_family`), is
     checked against the published projection and the family's actions not yet applied, and
     is written as one `wl_events` row (`made_by: 'family'`); 60 an hour per family. A pick
     also writes a `wl_holds` row (`409 pup_taken` for another family; the pup drops off their
     offer at once). `POST /f/message {session, status_token, key_id, sealed}` (10 an hour,
     32 KB) puts a message sealed to `kennel.message_key` into `wl_inbox` as `kind: 'message'`.
     `GET /f/status` adds `pending` (the family's actions her device hasn't applied) and the
     editors' choices. A publish carries `events_through`; holds for picks up to there go.
   - **Projection:** `kennel.message_key` (the current form key's public half; **every online
     kennel now gets a form key**, not only one taking applications), `kennel.parents` (the
     listen-only choices, `waitlistRules.listenParentChoices`, the same as her Edit form plus
     any parent a family already picked; call names only), `kennel.breeds`,
     `kennel.color_matching`, each open entry's `requests` (`pause` / `pref_change` / `listen`:
     what was asked and her decision, shown 30 days after she decides; never the family's
     note), and `events_through`.
   - **The status page** (`cloud/public/family/status.js`): signed in, the offer's pups become
     **Choose …** buttons with **Pass on this litter**; **Your place** has **Still interested**,
     **Request a pause** (a date, an optional note) and **Leave the list**; **Which litters you
     wait for** (All / these sires and dams); **Ask to change** under What you asked for (sex,
     breed, placement, readiness, and colors only while color matching is on); **Send … a
     message** (sealed in the browser). What's waiting for her shows until her device applies
     it. With the link alone, a **Respond on this page** card points to See Your Details.
   - **Her device** (`data/waitlistEvents.js`, pure; `cloudWaitlist.applyFamilyEvents`;
     `waitlistActions.applyFamilyPlan`): after taking in the inbox and before publishing, the
     **backing device** (checked with `GET /program` before any write) reads the events after
     its cursor (`waitlistOnline.eventsCursor` in settings; a device without one starts at the
     highest published `events_through`, so nothing is applied twice) and checks each against
     her records now: pick → `recordPick`; pass → `recordOutcome(…, 'passed')`; leave →
     `withdraw`; a wider listen-only change → applied; a pause, a narrower listen-only change or
     an answer change → `pause_request` / `listen_change_request` / `pref_change_request` on the
     entry. An action that no longer fits (the offer closed, the pup was sold) is never forced:
     it becomes a line for her. Server moves (step 7) are skipped until step 7 exists.
   - **Messages and activity live on the entry, not in a table:** `waitlist_entries.messages`
     (`{ id, at, from, kind: 'message' | 'action', body, read }`, the newest 500), **private**,
     like step 4's form keys, so no schema change. Step 6 adds her outbound emails to the same
     list (`from: 'breeder'`) instead of §8's `waitlist_messages` table.
   - **Her decisions:** Today (`nudges.js`) shows each pending request with **Approve** /
     **Decline** (an answer change with what narrowing would skip, its open offers, the change
     history and their note) and unread messages with **Open** / **Mark read**; the family's page
     has a **From their status page** card with the same buttons. A decision is kept on the
     request (`decided`, `decided_date`); an approved or declined answer change is logged
     `by: 'request'` (declined with `declined: true`). Nothing is sent to the family yet
     (step 6).
5c. **Her 2026-10-08 requests (Spec §16)**, in six reviewable parts. **No schema or index
   change:** every new field is plain and unindexed, and no FK is added (the referenceRegistry
   is untouched apart from label wording). No server migration: events carry new kinds and
   payloads in the existing JSON columns.
   1. **One turn per family across open litters (§16.1).** The largest part: W1c's offer flow
      and step 5's offer handling are reworked; the rest of 5c builds on it.
      - **Data:** `waitlist_offers.turn_id` (plain, cloud): one row per litter in the turn,
        sharing `turn_id` and `respond_by_date`. An offer without one (made before 5c) is its
        own turn (`turn_id ?? id`), so nothing is migrated.
      - **Rules** (`waitlistRules.js`, pure, tested): `openTurn(offers, kennelId)`;
        `nextTurn(entries, offers, litters, pups, sales, opts)` → `{ entry, litters: [{ litter,
        eligibleDogs, prepassed }] }`: the highest-ranked family with an eligible, available
        pup in an open-picks litter they haven't spent a turn on (spent stays per litter, as
        `turnSpent` today); `joinsOpenTurn(…)` for a litter opening mid-turn (rule 5);
        `passesUsed` unchanged (one row of a passed turn carries `counts_as_pass`).
      - **Actions** (`waitlistActions.js`): `offerNext` / `openPicks` / `offerTo` make a turn
        (all its rows at once; `offerTo` still allows out-of-order with her confirmation, and
        refuses while another turn is open); `recordPick` / `changePick` / `confirmDeposit` per
        row, and confirming closes the turn's other rows as `voided` (never a pass);
        `recordTurnOutcome(turnId, 'passed' | 'no_response')` closes every row, counting once;
        `undoPass` restores the whole turn; automatic offers (`auto_offer_on`) move per turn.
      - **Pages:** the Litter page's picks panel shows that litter's row with the family's whole
        turn summarized ("also offered: Willow × Ash"); the family page and Today's overdue
        nudge act on the turn.
      - **Online:** the projection's `offers` gain `turn_id`; `litters[].queue` becomes one
        kennel-wide `turn_queue` (each family with its eligible pups per litter), which step 7
        walks. Server `checkAction`: `pass` takes `{ turn_id, reason }` and passes every row;
        `pick` is unchanged (a row and a pup). The status page shows one "It's your turn!" card
        listing every litter's pups, with one **Pass on all of these**.
      **Built 2026-10-08.** As planned, with: `litters[].queue` is gone from the projection
      (`turn_queue` replaces it: `[{ entry_id, litters: { [litter_id]: dog_ids } }]`); a family
      can pick once per turn online (switching litters goes through her); the server's `pass`
      takes `{ turn_id }` (or any one row's `offer_id`) and records `{ turn_id, offer_ids,
      litter_ids }`; the status view's offers carry `turn_id` and the page groups them into one
      card. Tests: `waitlistTurns` (the actions on the in-memory database), `waitlistRules`,
      `waitlistProjection`, `waitlistEvents`, `cloud/tests/familyActions`.
   2. **Pass reasons and passing ahead of time (§16.2, §16.5).**
      - `waitlist_config.pass_reasons` (`[{ id, label, message }]`, cloud; default four:
        timing, finances, not the right pup, other) and `pass_other` (bool, default on), edited
        in Waitlist settings; published in the projection (labels and messages only).
      - `waitlist_offers.pass_reason` (`{ id, label, text }`, **private**): on a family's pass;
        none when she records one; none for no response.
      - `waitlist_entries.prepasses` (`[{ litter_id | pairing_id, reason, date }]`,
        **private**; the projection publishes the ids only, for step 7). Status page **Not this
        litter** / **Undo**, both requiring a reason; new event kinds `prepass` / `unprepass`.
        A pairing's prepass carries over to the litter born of it (`Litter.pairing_id`).
      - `nextTurn` leaves prepassed litters out of the offer; when every litter in a turn is
        prepassed, the action records the turn `passed` at once (counting once, with the
        prepass reason) and goes on to the next family. Consumed prepasses are removed.
      - Server: `pass` and `prepass` require a published reason id (or `other` + text ≤ 200);
        the page shows that reason's message after submitting.
      **Built 2026-10-08.** As planned, with: the default reasons are timing, finances and
      "not the right fit" (plus Other); a pending "Not this litter" on a litter is recorded,
      when the turn comes, as a passed row of that turn (never counted by itself), so the
      turn's history shows it; her app lists them on the family's page ("Not this litter",
      with the reason) and the pass reason beside each passed offer. Server: `pass`,
      `prepass` take `reason_id` (+ `reason_text` for `other`; `400 reason_required`);
      `prepass` refuses a litter in their open turn (`in_your_turn`) or not published
      (`not_listed`); `unprepass` (`not_prepassed`). Tests: `waitlistTurns`, `waitlistEvents`,
      `waitlistProjection`, `cloudWaitlist`, `cloud/tests/familyActions`.
   3. **Listen-only "except" (§16.3).** `WAITLIST_LISTEN_MODE` gains `except`;
      `isListeningFor` skips a litter or pairing when either parent is listed;
      `listenChangeKind` treats more parents (or All → except) as narrower, fewer (or → All)
      as wider, and `selected` ↔ `except` as narrower. Edit form, status page editor, server
      `checkAction('listen')`, the projection and the registry labels' wording.
      **Built 2026-10-08.** As planned, with: an `except` with nobody listed skips nothing, so
      it counts as All litters (`waitlistRules.isListenOnly`; `listenChangeKind` treats it so);
      the server refuses it like an empty `selected` (`400 no_parents`). The projection
      already carried `listen.mode` as-is. Her app: the Edit form's third option, the family
      page's summary ("All except …", with the litters and pairings it skips right now), the
      list badge "Skips some litters", Today's and the family page's request wording, and the
      Offer button's reason. Registry labels: "sire/dam in a waitlist family's listen-only
      choice". Fixed on the way: the Edit form's parent picks never hid on "All litters"
      (`.field`'s `display: flex` beat `[hidden]`; `app.css` now has `.field[hidden]`, which
      also hides the sale's owner field as intended). Tests: `waitlistRules`,
      `waitlistEvents`, `cloudWaitlist`, `cloud/tests/familyActions`.
   4. **Pairings and early litters online, and the deposits nudge (§16.4, §16.8).**
      - `waitlist_config.show_upcoming` (`{ planned_pairings, pairings, early_litters }`, each
        `{ public, family }`, all false; cloud). The settings card warns that the public list
        shows her breeding plans.
      - Projection `upcoming[]`: `{ id, kind: 'planned_pairing' | 'pairing' | 'early_litter',
        sire, dam }` with each parent's call name and titles (her logged `title_earned`
        abbreviations, via `eventRepo`), `expected_whelp_date` for a pairing, `whelp_date` and
        `picks_expected_date` (= `accept_deposits_date`) for an early litter; plus `public` /
        `family` flags. Per entry: whether they're waiting for each one (listen-only) and their
        place for an early litter. `listView` serves the public ones; `statusView` the family
        ones, with **Not this litter** (part 2).
      - Today (`nudges.js`): a whelped litter whose `accept_deposits_date` has come, picks not
        open, pups available → **Open picks**.
      **Built 2026-10-08.** As planned, with (her answers, 2026-10-08): the switches govern
      family pages too, so the status page's Litters card lists only litters with open picks
      (or in their turn) and everything earlier is in a **Coming up** card when she shows it;
      an `expected` litter is a `pairing` item keyed by its pairing (so "Not this litter" on it
      carries over). Items: `waitlistRules.upcomingItems` (all stages) filtered by
      `showUpcoming`; each `{ id, kind, label, pairing_id, litter_id, sire, dam,
      expected_whelp_date (= Pairing.expected_due_date), whelp_date, picks_expected_date,
      public, family }`, parents as `{ name, titles }` (`titlesByDog`, the oldest title
      first); `litters[]` gain `pairing_id`; per entry `upcoming: { [id]: { waiting, position
      } }`. Server: `listView.upcoming` (public ones, without where they show), `statusView`
      (family ones, merged with the entry's flags); `prepass` only on a litter with open picks
      or a shown item (`not_listed` otherwise). Public list page: a **Coming up** card. The
      settings live in Waitlist settings, shown where the waitlist online is offered, with
      the public-list warning. The nudge (`depositsDueLitters`) shows only for a kennel with
      families on its list. Tests: `waitlistRules`, `waitlistProjection`, `cloudWaitlist`,
      `cloud/tests/familyPages`, `cloud/tests/familyActions`.
   4b. **What number a family sees (§16.9, decided 2026-10-08).** **Built 2026-10-08.**
      `waitlistRules.placeHidden` (pure, tested); the projection drops `litter_positions` (and
      the early-litter place) for `matching_litter_ids` and `upcoming[id].match`, and sets
      `position: null` + `place_hidden` (`{ reason: 'turn' }` or `{ reason: 'passed', litters:
      [{ litter_id, label, outcome }] }`); `publicList({ hidden })` leaves those families off
      the public list (online and her Copy public list). Server `statusView` passes
      `place_hidden` through and gives each litter `match` instead of `your_position`. Status
      page: no "#n in line" anywhere; "Your place" says why there's no number; a passed
      litter says "You passed" with no "Not this litter". Tests: `waitlistRules`,
      `waitlistProjection`, `cloud/tests/familyPages`.
   5. **"Review your preferences" and "A litter you match was born" (§16.6).** Pure rule
      `whelpNotes(entries, litter, pups, …)`: for each active, not paused or held family, `match`
      if eligible, else `review` with why (`listen`, `sex`, `breed`, `placement`, `colors`)
      when the family would be eligible with All litters and open answers. Derived (nothing
      stored) while the litter is whelped and picks aren't open; published per entry; the
      status page shows a card with **Review your preferences** opening the listen-only and
      Ask-to-change editors (changes go through the usual rules; Q26). The email half joins
      "It's almost your turn" in step 6. Shown whatever the early-litters switch says (Q34).
      **Built 2026-10-08 (status page).** As planned, with: `whelpNotes(entries, litter, pups,
      sales, { today, config })` covers a litter `whelped` / `weaning` / `ready`, picks not
      open, a pup available (`isWhelpNoteLitter`); `why` lists what narrows them, `listen`
      first, then each answer that on its own rules out one of these pups (if none does
      alone, each answer that rules one out with the rest left open). Projection: per entry
      `whelp_notes: [{ litter_id, pairing_id, label, kind, why }]`; server `statusView` passes
      it through. Status page: a **Review your preferences** card (or **A litter was born**
      when they match every one) after Your place, with **Change which litters you wait for**
      and **Ask to change your answers**, each opening that editor; a litter they said "Not
      this litter" to gets no note. Her app shows nothing new. Tests: `waitlistRules`,
      `waitlistProjection`, `cloud/tests/familyPages`.
   6. **"Ready now?" (§16.7).** `waitlist_config.ready_no_answer` (`keep_paused` default |
      `unpause` | `remove_after`) and `ready_answer_days` (14), cloud.
      `waitlist_entries.ready_check` (`{ answer: 'yes' | 'no', answered_date, until, reason }`,
      **private**). `isReadyHeld` extends the hold past `readyFromDate` while unanswered under
      `keep_paused` / `remove_after` (still pure: entry + config + today). Status page: **Ready
      now?** with Yes / No (No: a date and a required reason, which becomes a `pause_request`
      carrying the reason); event kind `ready`. Under `remove_after`, her device removes the
      family when the window passes (`removed_reason: 'no_ready_answer'`, new vocab value,
      7-day undo like a second-pass removal) and Today reports it; Today also lists families
      unanswered for more than `ready_answer_days` under `keep_paused`.
      **Built 2026-10-08 (status page).** As planned, with (her answers, 2026-10-08): online
      lists only, and only holds ending from `waitlist_config.online_since` (set when the
      list goes online; backfilled to the sync's day for a list already online). Rules:
      `readyCheck` → `{ asked, answer_by, answer }`, `readyCheckLapsed`, `readyCheckOverdue`;
      `isReadyHeld(entry, today, config)` / `isPaused(…, config)` (config optional; every
      eligibility call passes it). A No holds them while its pause request waits for her.
      Actions: `recordReadyAnswer` (`by: 'family' | 'breeder'`), `removeForNoReadyAnswer`;
      `undoRemoval` of one sets `ready_check: { ask_from: today }`. Device:
      `cloudWaitlist.sweepReadyChecks` after the family events (backing device only). Server:
      `ready` action (`409 not_asked` / `already_answered`, `400 bad_date` /
      `reason_required`). Projection: `ready_check` per active entry (never the reason).
      Status page: a **Ready now?** card with **Yes, I'm ready** / **Not yet** (date and
      reason), and the answer-by warning under `remove_after`. Her app: settings (rule +
      days, where online is offered), the list badge, the family page's line and **They
      told me they're ready**, Today. Tests: `waitlistRules`, `waitlistEvents`,
      `cloudWaitlist`, `waitlistProjection`, `cloud/tests/familyActions`.
5d. **Companion link requests (Spec §16.10). Built 2026-10-08.** No schema change. Event kind
   `companion_request {note}` (server: `checkAction` before the open-status check, since a
   placed family may ask; `409 no_sale` without `entry.companion.available`, `409
   already_requested` while one waits). Projection: `entries[id].companion = { available:
   true, request }` only for a family whose contact has an open sale (`vocab.isOpenSale`, now
   shared by `saleRepo.isOpenSale`); `statusView` passes it through for every status.
   Device: `planFamilyEvent` → op `companion_request` (a note instead when the sale has
   closed since); `waitlist_entries.companion_request` (private); `markCompanionLinkSent` /
   `declineCompanionRequest` (`decided: 'sent' | 'declined'`); Today nudge and the family
   page's card (**Open Companion**, **Mark sent**, **Decline**). Status page: a **Your
   Companion page** card (placed families included) with the request form and its state.
   Tests: `waitlistEvents`, `waitlistProjection`, `cloudWaitlist`, `cloud/tests/familyActions`.
   Each part: `node --check`, `node --test` and `cd cloud && npm test`, the precache check,
   syncRegistry entries for every new field, the End-State guide in the same change, and the
   flow in headless Chromium at phone width.
6. **Email.** `mail.kennelos.app`, templates + Waitlist settings editor, kennel-name sender,
   every kind in §8, the messages log on the entry, "almost your turn" sent for her.
   **Built 2026-10-09.** Decided with her the same day (all as recommended): the sender is the
   kennel's name made into an address; every email shows her a preview first, ticked; the
   status page lists the emails sent; Spec §5.2's "Ask a question" stays out (Email them…
   and the message box cover it). As built (where it differs from §4, §8 and §9, this wins):
   - **Server:** `POST /waitlist/messages {id, public_id, entry_id, kind, subject, body}`
     (`cloud/src/waitlist.js` `sendMessage`): Pro, backing device, 300 an hour per program,
     subject ≤ 200 on one line, body ≤ 8,000. The address is the family's `email` in the
     published projection (`409 not_published` / `no_email` otherwise), never the device's.
     The server adds the footer (their status-page link on `FAMILY_PAGES_ORIGIN`, else the
     request's own origin; "This address doesn't receive replies…") and records the row in
     `wl_messages` with the device's id as its id, so a retry never sends twice (a sent one
     answers from the row; a failed one is tried again). `kind` is one of `EMAIL_KINDS`:
     `approved`, `on_list`, `declined`, `offer`, `pass_recorded`, `deadline_passed`,
     `almost_turn`, `review_prefs`, `litter_born`, `request_approved`, `request_declined`,
     `status_link`, `note`.
   - **Sender** (`mail.familySender`): `"<Kennel Name>" <<base>@mail.kennelos.app>`, base from
     the name (`thornfield-kennels`); the first kennel to use a base keeps it, another gets
     4, 8 or 12 characters of its public id added; reserved names (support, admin, …) are
     never handed out; a renamed kennel gets a new address. Claimed in a new table,
     **`wl_senders`**, migration **`0010_family_email`** (which also indexes `wl_messages`
     by family for the status page), so step 6 does need **Apply pending**. The family
     sign-in and application codes now come from the kennel's address too. No Reply-To.
   - **Status page:** `GET /f/status` adds `emails` (sent ones, newest 20: date, subject,
     body; a body retention dropped shows the subject only), shown as **Emails from …**.
   - **Device:** `data/waitlistEmails.js` (pure: kinds, default templates, placeholders
     `[Kennel Name]` `[Family]` `[Litter]` `[Respond by]` `[Position]` `[Pay by]` `[Request]`,
     `draftEmail`; `tests/waitlistEmails.test.js` pins the kinds and limits to the server's
     and no money in any default), `data/waitlistOutbox.js` (draft from her records, queue,
     retry; only where `kennelEmailsOn`), `assets/waitlistEmailUI.js` (the preview), and
     `cloudWaitlist.sendQueuedEmails` after each publish. Outbound emails live in the entry's
     `messages` (`from: 'breeder'`), as step 5 said, not a `waitlist_messages` table. Her
     templates: `waitlist_config.email_templates` (cloud, like `soon_notice_text`), edited
     under **Emails to families** in Waitlist settings. Where each email is offered: End-State
     guide §29, "Emails to families". `[Pups]` from §8 isn't a placeholder: the status page
     lists the pups.
   - **Left for step 7:** reminders, "deadline passed" from the server's own moves, the
     "Ready now?" email, and the server's templates (her wording travels in her projection
     then). Tests: `cloud/tests/waitlistMessages.test.js`, `tests/waitlistEmails.test.js`,
     email cases in `tests/cloudWaitlist.test.js`.
7. **Deadlines and automatic offers.** Cutoff instants, reminders, the `auto_offer_on` moves
   (§6), version checks and Today suggestions on her device.
   **Built 2026-10-09.** As built (where it differs from §6 and §8, this wins):
   - **Server** (`cloud/src/serverMoves.js`), on a new hourly cron (`7 * * * *` beside the
     daily `17 3 * * *`; `index.js` tells them apart by `DAILY_CRON`) over every published
     kennel, and for one kennel right after a family's **Pass** or **Leave the list**
     (`familyActions.js`):
     - **A deadline:** a turn whose respond-by date is before today in the kennel's time zone
       (so it ends at midnight after its last day) is closed only when she ticked that moment
       (`no_response`, or `no_deposit` when the family had picked): event `server_close {
       turn_id, offer_ids, litter_ids, respond_by_date, trigger, picked_dog_id }`, the
       family's holds released, their `deadline_passed` email.
     - **Moving on:** after such a close, or a family's pass / leave with `passed` / `left`
       ticked, the first family in her published `turn_queue` who is active, holds no turn,
       has nothing of theirs waiting on her device (a pick, pass or leave) and still has an
       available, unheld pup in a litter with open picks is offered a turn: event
       `server_offer { turn_id, offered_date, respond_by_date, rows: [{ offer_id, litter_id,
       dog_ids }], cause: 'deadline' | 'passed' | 'left', cause_seq }`, with their own window
       (`turn_queue[].respond_days`, a program's override included) and the `offer` email.
       One turn at a time, as on her device; nobody if the queue runs out.
     - **The stored projection is updated** (`closeTurn`, `giveTurn`), so the status pages
       show it at once and the new family can pick; its version goes up, unless her device
       published in between.
     - **Reminders**, when `kennel.reminders` is on, each once (the email id is the key),
       from 8 am kennel time: halfway through a turn of two days or more and on its last day
       (`offer_reminder`); the day before an unpaid fee is due (`fee_reminder`; none without
       a due date); "Ready now?" once her device has asked it (`ready_check`).
     - **The publish guard:** `PUT /waitlist/projection` answers `409 events_pending` while
       a server move after its `events_through` exists, so a publish never undoes a move
       her device hasn't seen. Her device then applies the events and publishes again.
     - Emails use the templates she publishes (`kennel.email_templates`); the server only
       fills `[Kennel Name]`, `[Family]`, `[Litter]`, `[Respond by]`, `[Pay by]`
       (`fillTemplate`, pinned to her device's filling by `tests/waitlistEmails.test.js`).
       No server migration: events and messages use the existing tables.
   - **Device:** `waitlistEvents.planServerEvent` checks each move against her records now:
     `server_close` → `recordOutcome(…, 'no_response')`; `server_offer` →
     `waitlistActions.applyServerOffer` (the server's ids, the pups still available) when no
     other turn is open and the family is still on the list. A move that no longer fits (she
     recorded the outcome herself, another turn is open, the pups were sold) becomes a line
     on the family's entry (`from: 'server'`, "KennelOS, while your phone was off"), which
     Today's unread nudge shows. When a `server_offer` names an event as its `cause_seq`,
     that event is applied with `moveOn: false` (`recordOutcome`, `withdraw`), so her device
     never offers a second family. The projection gains `kennel.email_templates` (her
     wording for the five server kinds), `kennel.reminders`
     (`waitlist_config.email_reminders`, default on, a switch under **Emails to families**)
     and `turn_queue[].respond_days`. **Left as is:** a family's passes count is updated by
     her device, not the server; a Today suggestion is the activity line, not a new nudge.
   - Tests: `cloud/tests/serverMoves.test.js`, `tests/waitlistEvents.test.js` (server
     moves), `tests/cloudWaitlist.test.js` (the server's close and offer applied once, with
     no second offer), `tests/waitlistProjection.test.js`.
8. **Release.** Facebook button, privacy policy (`site/privacy.html`: what the server reads,
   Q11; applicants' data; the public list), `README.md`, Spec §12 status,
   `LAUNCH_CHECKLIST.md` section, real-phone checks, then `WAITLIST_ONLINE_RELEASED = true`
   and the `CACHE_NAME` bump (asked first). D8's auto-answer here or after.

Each step: `node --check` on touched files, `node --test` from the root and `cd cloud && npm
test`, the precache check, and the flow in headless Chromium at phone width.

## 12. Operator setup (dashboard, not code)

- **Workers Paid plan** before families use it (`LAUNCH_CHECKLIST.md` §3a): hourly cron,
  public form traffic.
- **`apply.kennelos.app`** as a custom domain on the production Worker.
- **Resend:** verify `mail.kennelos.app` (DKIM + SPF in Cloudflare DNS).
- **Turnstile:** a site for `apply.kennelos.app` (and staging); its secret as the Worker
  secret `TURNSTILE_SECRET`, site key in `[vars]`.
- **Email Routing** on `mail.kennelos.app` into the Worker (only for D8's auto-answer).
- **Apply pending** (`0007`, `0008`, `0009`) on staging's and production's `/ops` after each merge
  that carries a migration.
