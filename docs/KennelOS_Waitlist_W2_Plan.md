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
  last initial, sex preference, date added; paused and readiness-held families left out,
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
3. **The public list and status page, read-only.** `cloud/public/` pages, `apply.kennelos.app`
   on staging, "Email me my link" (6-digit code), the search box, phone-width checks.
   `status_token` on entries, **Copy status link** / **New link** (§8, §9).
4. **The online form and inbox.** Form key table + Rotate, the form page (her questions,
   FAQ, notice, Turnstile), encryption, confirmation email, the inbox → `applied` entries on
   the backing device.
5. **Family actions.** Buttons → events, holds, `waitlistEvents.js` + tests, Today
   requests (pause, answer changes, listen-only narrowing), the encrypted message box.
6. **Email.** `mail.kennelos.app`, templates + Waitlist settings editor, kennel-name sender,
   every kind in §8, the messages log on the entry, "almost your turn" sent for her.
7. **Deadlines and automatic offers.** Cutoff instants, reminders, the `auto_offer_on` moves
   (§6), version checks and Today suggestions on her device.
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
- **Apply pending** (`0007`) on staging's and production's `/ops` after each merge that
  carries a migration.
