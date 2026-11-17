# KennelOS — Mail budget: plan

> Status: **plan, nothing built.** How KennelOS stays inside its email provider's daily limit
> when several kennels have a heavy week at once, and fails loudly (never quietly) when an
> email can't go out. Four layers: notifications on the families' status pages take
> non-urgent mail off email (§4); a daily budget shared fairly between programs (§2);
> urgent mail first, the rest held to the next day (§3); and "tap to text" from her own
> phone when an urgent email is held (§5). A second sending provider for heavy days is
> optional (§6). Emails are **not** a credits item yet (§7). Open decisions are in §10.

## 1. Why

- **The limit that bites is the daily one, not the monthly one.** Resend's free tier is about
  3,000 emails a month but about **100 a day** for the whole account (verify on Resend before
  relying on the numbers). Breeding is bursty: two quiet weeks, then seven heavy days. Four
  kennels running picks in the same week can use up a day's 100 before lunch.
- **One kennel can starve the rest today.** The 100 a day is shared by every program and by
  KennelOS's own sign-in codes. A heavy kennel can block other kennels' families **and
  everyone's sign-in**.
- **Today's limits don't cover it.** Her manual sends to families have a per-program limit of
  300 an hour (`MESSAGE_LIMITS.perHour`, `cloud/src/waitlist.js`); the server's own emails
  (offer and fee reminders, ready checks, `serverMoves.js`), signed copies, digests and family
  codes have none. `mail_daily` counts all programs together, not per program.
- **Automatic failures are quiet today.** `emailOnce` (`serverMoves.js`) records a failed send
  as a `wl_messages` row with status `failed`, and nobody is told.
- **Paying for the next tier doesn't fit four users.** Resend's paid plan is about $20 a month.
  Charging a credit ($0.35) for a block of emails that pushes the account over the free tier
  loses about $19.65 (§7).

## 2. The daily budget

One budget per UTC day for the **whole account**, set a little under the provider's daily
limit, split three ways:

| Share | Who | Proposed (on a 100-a-day provider) |
|---|---|---|
| **Account reserve** | Sign-in codes, account notices, "credits added", lapse warnings | 15 a day, only these can use it |
| **Program floor** | Each program's own guaranteed share | 15 a day per program; nobody else can take it |
| **Common pool** | Whatever's left after the reserve and the floors | Any program, once its floor is used, first come first served |

- A quiet kennel's floor is always there for it; a busy kennel borrows from the pool.
- **Codes families request** (verification and application codes) come out of their
  program's floor and pool like any family email, but with their **own** small cap per
  program per day (proposed 10), so strangers on the waitlist page can't use up her budget.
  Turnstile and the existing rate limits still apply first.
- **Signed contract copies** count against the program like any family email, ranked
  time-critical (§3).
- The budget is a Worker setting, not code: `MAIL_DAILY_BUDGET` (the account total),
  `MAIL_DAILY_RESERVE`, `MAIL_DAILY_FLOOR`. The floor scales down automatically if
  `reserve + programs × floor` would go over the budget (the pool is then empty, and the floors
  share what's left evenly). Support can raise one program's floor from the manager app (M6).
- **The day** is the UTC day, the same one the provider resets on. The app shows the reset in
  her local time.

### 2.1 Counting it (server)
- One migration adds `mail_budget`: `day`, `program_id` (`''` for the account reserve),
  `sent`, `held`, `refused`, `codes`. Primary key (`day`, `program_id`). Counts only: no
  address, subject or body. Old days are deleted by retention after 60 days.
- `mail.js` gains `reserveMail(env, { programId, rank, kind })`. It decides reserve / floor /
  pool and adds to the count **in one conditional statement**, so two sends at the same moment
  can't both slip past the limit. → `'ok'` | `'hold'` | `'refuse'`. Every Resend send already
  goes through `resendSend`, so this is one place.
- A send that the provider then refuses gives its slot back.
- `mail_counts` and `mail_daily` stay as they are (they feed /ops).

## 3. Urgent first, the rest the next day

Every email gets a **rank** from its kind:

| Rank | Kinds | When the day is full |
|---|---|---|
| **1. Account** | Sign-in and link codes, account notices | Uses the reserve; never held |
| **2. Family codes** | Verification and application codes | Refused with a clear message on the family's page ("Too many codes today; try again tomorrow") |
| **3. Time-critical** | Offers (`offer`, `offer_reminder`), `deadline_passed`, `almost_turn`, signed contract copies | **Refused, loudly** (§3.2) |
| **4. Can wait** | Approvals, declines, notes, `litter_born`, `fee_reminder`, `ready_check`, requests, transport, back-outs, `status_link`, `review_prefs` | **Held** until the next day (§3.1) |
| **5. Digest** | Her email digest | Held; never counted against her floor (it's often the alert about the limit itself) |

### 3.1 Held emails
- A held email is a `wl_messages` row with the new status `held` (an additive value; the table
  is server-side, no app field changes). Its `id` already makes the send happen once, so
  sending it later is safe.
- The first cron run after the UTC reset sends held emails oldest first, against the new
  day's budget, rank 3 before rank 4.
- Held for more than 3 days → it becomes `refused` with the same loud alert (M4).
- Her app shows them (§3.2) with **Send now** (tries again against today's budget) and
  **Don't send**.

### 3.2 Failing loudly
**When she sends by hand** (`POST /waitlist/messages`):
- The server answers `429 daily_email_limit` with `{ limit, used, resetsAt, held: true|false }`.
  The `rate_limited` answer from the hourly limit keeps its own wording.
- The app (`cloudWaitlist.sendQueuedEmails`, `waitlistOutbox`) shows a **banner**, not a
  quiet Retry badge: "Daily email limit reached (15 of 15 today, plus the shared pool). This
  email is held and goes out after 5:00 PM." Rank 3: "…This email was **not** sent. Text them
  instead?" (§5).
- Queued emails on her device stop trying until the reset instead of failing one by one.

**When the server sends by itself** (server moves, signed copies):
- The row is marked `held` or `refused`, and the server raises a new notification kind,
  `email_held` (push, and the digest, which doesn't count against her floor). One alert per
  program per day, not one per email: "3 emails held until tomorrow (daily limit)."
- On her next sync the app pulls held and refused emails (a new `GET /waitlist/messages/held`)
  and shows a **dashboard banner**, plus a flag on each family's entry, with Send now / Text
  them / Don't send.
- /ops lists programs that hit their floor today, with held and refused counts, and the
  account's **most sent in one day** over the last 30 days (§9).

### 3.3 A deadline never starts before its email goes out
- **Server moves:** before a run gives a family their turn (`offerNext` in `serverMoves.js`),
  it checks that the offer email can go out (`reserveMail` with rank 3). If it can't, the run
  stops before the batch and tries again on the next cron run. Nothing about the turn has
  happened yet, so nothing is undone. If the family has no email and no notifications
  (§4), the run goes ahead as today (her nudge covers it).
- **Offers she makes by hand:** the respond-by date is counted from when the offer email was
  actually sent, or from when she marked the offer as given in person or by text (§5) (M5).

## 4. Notifications on the families' status pages

The family status page (`/s/<token>`, served by the Worker, `cloud/src/familyPages.js`)
becomes an installable web app that can receive notifications. For families who turn them on,
the "can wait" messages stop being email.

### 4.1 What's built for it
- **A manifest per family** (`GET /s/<token>/manifest.webmanifest`): name "<Kennel> waitlist",
  `start_url` and `scope` `/s/<token>`, the kennel's icon if it has one, else KennelOS's.
  The installed app opens *their* page.
- **A small service worker** served at `/s/sw.js` with scope `/s/`, so it never touches the
  manager app, /ops or anything else on that origin. It caches nothing but an offline note,
  and handles push the same way as hers (§4.2).
- **"Get notifications" on the status page:** shown only where the browser can do it. On
  iPhone outside the installed app it shows a short "Share → Add to Home Screen" guide
  instead (iOS 16.4+ allows web push only from home-screen apps). Android works from the
  browser tab.
- **Turning them off:** a switch on the same page, and a page they've lost access to drops
  its subscription.

### 4.2 Privacy and the server
- Reuses the breeder's design (`cloud/src/notify.js`, `docs/KennelOS_Notifications_Plan.md`
  §0): **payload-free** pushes. The phone is told "something's new"; the service worker asks
  `POST /s/push/pending`, proving itself with its subscription's auth secret, and shows the
  words. Nothing a family or the breeder wrote crosses Apple's or Google's servers.
- The words are generic and short: "<Kennel>: update on your waitlist", "<Kennel>: it's your
  turn to pick". Opening it opens their status page.
- **New table** `wl_family_push` (same migration as §2.1): `program_id`, `public_id`,
  `entry_id`, `endpoint`, `p256dh`, `auth`, `created_at`, `last_ok_at`, `failures`. A
  subscription is personal data: deleted with the family's entry, in
  `deleteWaitlistStatements` (account deletion), when the push service says it's gone, and
  by retention after 120 days without a successful push.
- Never logged: an endpoint, a key, a token (`cloud/README.md`).
- Same VAPID keys as hers.

### 4.3 What goes where

| Message | Family has notifications on | Family doesn't |
|---|---|---|
| Rank 3 (time-critical) | Push **and** email | Email |
| Rank 4 (can wait) | **Push only** | Email |
| Rank 2 (codes), the first status link | Email | Email |

- **Fallback:** a push the service refuses (expired, gone), or one the family's service worker
  hasn't fetched within 24 hours, falls back to email (rank 4, so it can be held).
- The status page's activity list shows every message either way, so nothing lives only in a
  notification.
- **Her side:** the family's entry shows "Notifications on" so she knows a note will reach
  them without email. Her outbox records the delivery (`push`, `email`, or both).

### 4.4 What to expect
- Maybe a third to half of families will install the page and turn notifications on (more on
  Android than iPhone). That's the share of rank-4 mail taken off the daily budget on a heavy
  week. Email stays the way families first reach their page, and the backstop for deadlines.
- **KennelPort's puppy portal** is also becoming a family-facing home. Notifications are built
  on KennelOS's status page (the token, sessions and push code are here); the portal links to
  it (M8).
- A family on two kennels' waitlists installs two apps, one per status page.

## 5. Tap to text, from her own phone

US carriers treat any text sent by software as business texting at any volume (10DLC brand
and campaign registration, or toll-free verification, plus consent and STOP handling). For a
couple dozen urgent texts a month that isn't worth it, and consumer texting apps have no API
and forbid automating them. Texts come from **her own phone** instead, which KennelOS already
does: `shared/assets/messageComposer.js` opens a real `sms:` link with the family's number and
the message filled in.

- **When a turn's deadline ends:** one notification that closes the turn, offers the next
  family and opens the text, in one button (§5.1).
- **On the loud alert for a held or refused email** (§3.2): "Text them instead" beside Send
  now.
- Marking the offer as texted counts as delivered for §3.3.
- No new provider, no registration, no phone numbers on the server, no cost. The family gets a
  text from the number they already know.
- **Later, only if one tap isn't good enough:** one KennelOS toll-free number with toll-free
  verification (about $2 a month plus about 1¢ a text; families' agreement, STOP replies and
  their numbers on the server). Not planned.

### 5.1 "Time's up — offer the next family and text them" from one notification

In practice breeders run their turns by hand (no `auto_offer_on` moments ticked) with
one-day deadlines. So the moment that matters is **a turn's deadline ending**, and the
notification does the whole next step: closes the turn, offers the next family, and opens the
text, in one button.

**The trigger (server).**
- The hourly cron already reads each published kennel (`runKennel`, `serverMoves.js`). When a
  turn's deadline has passed in the kennel's time zone and the kennel has **not** ticked
  auto-offer for it, the cron makes **no move**; it raises one alert for her,
  `turn_ended` (a `what` under the existing `turn` kind, `notify.js`), once per turn.
- The pending answer carries the turn id, the family whose time ran out, and the server's
  guess at who's next (`nextFromQueue` on the published projection), so the notification can
  read "The Smiths' time is up. Offer the Joneses?"
- No time zone published → no alert (the server can't tell when her day ends), as with
  server moves today. Today's nudge ("…offer deadline passed") stays either way.
- Kennels that did tick auto-offer keep today's server move; their alert becomes "The Smiths'
  time ran out; the Joneses were offered", with **Text them** (below, without the offer step).

**The tap (her device).**
- Tapping the notification (iPhone and Android) opens one small page,
  `shared/pages/next-turn.html?turn=…`. A notification button can't make the offer itself:
  writing records is the app's job, through the repos, never the service worker's.
- The page works out the next family **on her device** (`previewNextTurn`); the server's guess
  is only the notification's wording, and the page shows if they differ. It shows: the Smiths'
  turn closes (no response, or no deposit if they had picked); the Joneses get the litter(s),
  respond by tomorrow (her kennel's turn length, counted from **now**); and the text to send.
- **One button, "Offer & text the Joneses":**
  1. records the outcome (`recordOutcome(…, 'no_response', { moveOn: false })`),
  2. gives the next turn (`offerNextTurn`; any families it passes on the way because they'd
     passed ahead of time are shown after, as `auto_passed` requires),
  3. opens `sms:` with the Joneses' number and her offer wording (her offer email template,
     no footer, plus their status-page link), built with `messageComposer.js`'s helper.
  The tap is a real tap, so `sms:` opens on iPhone as well as Android. Two taps in all
  (notification, button), then Send in Messages.
- **Order:** the records are written first (local, fast), `sms:` opens inside the same tap,
  and the publish (so the status page shows the offer) runs when she comes back to the app.
  Waiting for the publish before opening `sms:` would lose the tap on iPhone. A family that
  opens the link in the first seconds may see the page a moment behind; it catches up on the
  publish.
- **Secondary choices on the page:** **Offer & email** (the existing preview), **Offer
  someone else** (opens the litter's picks), **Extend the Smiths** (`extendTurn`), **Not
  now**.
- **No phone number** on the Joneses' contact: the button reads "Offer & email the Joneses"
  instead.
- **Coming back** from Messages: "Sent?" → **Yes** marks the offer texted (it reached the
  family, §3.3 and M5) and skips the offer email unless she asks for it too; **Not now**
  leaves the offer email in her outbox, ready.
- **The phone number never goes to the server**: the page reads it from her contact through the
  repos. The service worker only opens the page.
- **Android:** a notification button could save the first tap only for the auto-offer case
  (Text them, nothing to write). Not worth a second path at first; the two-tap page is the
  same on both phones.

**Rules.** `next-turn.html` and its script go into `PRECACHE_URLS` in `shared/sw.js` and into
`shared/data/proPages.js` (waitlist is Pro). `turn_ended` joins the notification catalog
(guide, Notifications plan). No new server table, no new synced field (the texted mark rides
the offer's existing records; any new field is classified `private`).

## 6. Optional: a second provider for heavy days

Only if §2–§5 together still hold too much on real heavy weeks (§9 shows it).

| | Monthly | Per 1,000 | Daily limit | Notes |
|---|---|---|---|---|
| **Resend free** (today) | $0 | — | ~100 | ~3,000 a month |
| **Resend paid** | ~$20 | included up to ~50k | none at this size | Unused emails are lost each month |
| **Bird Startup** | $15, added to a balance that carries forward | $0.40 | none listed (30 send requests a minute) | Balance also pays for SMS; ask about ramp-up for a new account |
| **Bird free** | $0 | — | 50 | 1,000 a month; too small to help |
| **Amazon SES** | $0 | ~$0.10 | high once out of its sandbox | More setup: leaving the sandbox, its domain records |

- Recommendation: keep Resend as the main provider. If needed, add **Bird Startup or SES as
  overflow**: `reserveMail` sends past Resend's day to the second provider instead of holding
  rank 3–4 mail. Every send already goes through one function in `mail.js`, so adding a
  provider stays there. The family sending domain needs its records on the second provider.
- The prices are as checked on 2026-11-17 and from memory; check before deciding (M7).

## 7. Credits

Emails are **not** a credits item yet. Past the free tier, one email costs a tiny fraction of
a cent; what costs money is the step to a paid plan (about $15–20 a month), which four programs
can't cover by buying blocks of emails at $0.35 a credit. `docs/KennelOS_Credits_Plan.md` §4.5
lists emails as a later candidate, to price once there's a real per-email cost (enough
programs sharing a paid plan, or SES).

## 8. Rules this touches

- **Migration:** one new `.sql` (`mail_budget`, `wl_family_push`) with its line in
  `cloud/src/migrations/index.js`; the only migration on its branch.
- **No app schema change:** held and refused emails are server rows; the app's outbox messages
  already have `status` and `error`. A delivery field on outbox messages (`push`/`email`), if
  added, is classified `private` in `shared/data/syncRegistry.js`.
- **Notification catalog:** `email_held` added to `NOTIFY_KINDS` in `notify.js` and the
  Notifications plan / End-State guide.
- **Service worker:** the family-page service worker is the Worker's, not `shared/sw.js`. Any
  new app file (a held-emails banner module) goes into `PRECACHE_URLS`, and into
  `shared/data/proPages.js` if Pro-only (waitlist emails are Pro).
- **Cloud off** (`cloudUrl: null`): nothing here runs; no banner, no requests.
- **Docs when built:** End-State guide (waitlist emails, notifications, family pages),
  `docs/KennelOS_Notifications_Plan.md`, `cloud/README.md` (the new settings), BUILD_LOG.
- **Tests** (`cloud/tests`): the budget split, two sends at the same moment, the pool and the
  floor scaling, family-code cap, held and released next day, a server run that waits instead
  of offering, push-or-email routing and fallback; the app's mapping of `daily_email_limit`.

## 9. Measuring first

/ops shows yesterday's total and the 30-day average (`mailDailySummary`), which hides the
heavy day. Step 1 adds **most sent in one day (last 30 days)**, by program and in total, from
`mail_daily` and then `mail_budget`. The reserve, floor and budget are set from the real heavy
week, not guessed.

## 10. Build order

1. **Measure:** most sent in one day on /ops (§9).
2. **Budget and ranks:** the migration, `reserveMail`, the reserve / floor / pool, ranks,
   held emails and their release, the family-code cap (§2–§3.1).
3. **Loud failures:** `daily_email_limit` and the app banner; `email_held` alerts, the held
   list in the app and on /ops; the server run that waits instead of offering (§3.2–§3.3).
4. **Time's up → offer & text** (§5.1): the `turn_ended` alert from the cron, `next-turn.html`;
   then "Text them instead" on held emails (§5). This step doesn't depend on steps 2–3 and can
   go first.
5. **Family notifications:** manifest, service worker, subscribe on the status page, routing
   and fallback (§4).
6. **Optional:** a second provider for overflow (§6).

## 11. Decisions

| # | Question | Status |
|---|---|---|
| M1 | The account budget, reserve and floor | Proposed: budget 90, reserve 15, floor 15 on Resend's free tier; set from §9 |
| M2 | Codes families request: own cap per program per day | Proposed: 10, out of the program's floor and pool |
| M3 | The ranks (§3), especially `fee_reminder` and signed copies | Proposed as in the table |
| M4 | How long a held email waits before it's refused | Proposed: 3 days |
| M5 | Respond-by counted from when the offer actually reached the family (email sent or texted) | Proposed |
| M6 | Support can raise one program's floor | Proposed: yes, from the manager app |
| M7 | A second provider, and which | Open: only if §9 shows it's needed; Bird Startup or SES |
| M8 | Family notifications on KennelOS's status page, not KennelPort's portal | Proposed |
| M9 | Rank 4 goes push-only for families with notifications on | Proposed |
| M10 | Automatic SMS (toll-free number) | Not planned; tap to text instead |
| M11 | The `turn_ended` alert for kennels running turns by hand | Proposed: on by default inside the `turn` kind she already ticks for push |
| M12 | After "Offer & text", the offer email too? | Proposed: skipped once she says the text was sent; one tap to send it as well |
