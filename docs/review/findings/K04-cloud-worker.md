# K04 — The cloud Worker

Reviewed: `cloud/src/index.js` (123), `api.js` (214), `auth.js` (183), `gate.js` (27),
`migrate.js` (98), `program.js` (94), `devices.js` (160), `recovery.js` (139),
`emailChange.js` (130), `retention.js` (236), `snapshots.js` (239), `files.js` (50),
`backup.js` (71), `health.js` (58), `notice.js` (34), `ratelimit.js` (40), `mail.js` (321),
`notify.js` (571), `ops.js` (508), `serverMoves.js` (352), `geo.js` (87), `sync.js` (310),
`lib/*` (crypto, http, cors, sql, html), `migrations/0001`–`0021` + `migrations/index.js`,
`cloud/wrangler.toml` (134), `cloud/README.md`. Read for the maintenance gate and logging
only, as the plan says: `assist.js` (388), `assistApp.js` (253); for one route each:
`waitlist.js` (`publishProjection`), `familyPages.js` (`serveFamilyPage`), `integrations.js`
(`handleHook`).
· Contract read: Cloud Phase 1 plan §6–§9, Phase 2 Sync §5–§6, §12, `cloud/README.md`,
CLAUDE.md's Cloud and server rules, README Status.

Verified by: green baseline at `24d84b1` — `node --test` **1649 pass**, `cd cloud && npm test`
**305 pass**, `node build/assemble.mjs` succeeds (the plan's 1639/303 are from `0328a3f`; two
cloud and ten app tests have landed since). Four scratch suites (in my scratchpad, not the
repo) driving the **real** Worker in-process through `cloud/tests/helpers/env.js`:
two concurrent `runKennel` passes on one projection; a publish landing inside the run's window;
a Resend network error mid-run; the database held at `0019` with `0020`/`0021` bundled (every
route, the family pages and both crons); `account_deletions` dropped with the gate forced open;
a rolled-back migration list; an R2 object deleted under a live `files` row and under a
committed snapshot; a `wl_projection` read made to fail inside the hourly cron; `FILES.list`
made to fail inside retention.

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S2 | cloud/src/serverMoves.js:316 | Events and family emails are committed before the one optimistic projection write; a lost race, a second run or a failed email repeats the whole close-and-offer with a new turn id, and emails the next family again | verified |
| 2 | S2 | cloud/src/migrate.js:43,55 · gate.js:14 | Rolling the Worker back after a migration reads it as `orphaned`, so the schema is never "current": the entire API answers 503 for good, and nothing on /ops can clear it | verified |
| 3 | S2 | cloud/src/index.js:116-120 · serverMoves.js:338 | The hourly cron's three jobs are one unguarded sequence, and the first starts with an unbounded read of every kennel's projection: one oversized read ends that hour's email changes and digests, with nothing logged | verified |
| 4 | S2 | cloud/src/retention.js:120 | The R2 orphan sweep runs before every D1 purge and is not isolated: one failed `FILES.list` skips the whole day's retention (codes, limits, sessions, inbox, tombstones) | verified |
| 5 | S2 | cloud/src/files.js:31 · snapshots.js:230 | A D1 row whose R2 object is gone can never be repaired through the API: HEAD says 200, PUT says `existed: true`, GET 404s, and a new snapshot is accepted naming it | verified |
| 6 | S2 | cloud/src/ops.js:322 | Delete an account identifies the account only by created-at, counts and device labels — the one case it is built for (two accounts of the same person) is the case it cannot tell apart | verified |
| 7 | S3 | cloud/src/serverMoves.js:293,302 | The last-day and fee reminders fire on exactly one day: if that day's runs are skipped (a maintenance window, a failed cron) the family is never told, and nothing records that | verified |
| 8 | S3 | cloud/src/emailChange.js:32 | An email change dropped at apply time (the address was taken meanwhile) disappears from the Account card with nothing said; she goes on signing in with the old address | verified |
| 9 | S3 | README.md:60 vs docs/BUILD_LOG.md:3025 | Status says every migration through `0021` is applied; the same batch's log says `0021` still needs a deploy then Apply pending. One of those means the whole API is in maintenance right now | verified |
| 10 | S4 | cloud/src/ops.js:46 | /ops is the only HTML this Worker serves with no Content-Security-Policy; `/manager`, `/notify/off` and the family pages all have one | verified |
| 11 | S4 | cloud/src/retention.js:77 | The daily run reads every committed snapshot of every program in one unlimited query before it caps anything | verified |
| 12 | S4 | cloud/src/index.js:52-60 | `serveFamilyPage`, the preflight and `corsHeaders` run before the router's `try`, so a throw there is a bare Worker exception, not a JSON error | verified |
| 13 | S4 | cloud/src/api.js:37 | `POST /program/backing-device` is not owner-only: support's helper device can make itself the backing device and stop her own device backing up | verified |
| 14 | S4 | cloud/src/backup.js:69 | The documented disaster recovery puts every row of every table in one `db.batch()`, unchunked and never tried at production size | suspected |

---

## 0. The first question: `0017` / `0019` / `0020` / `0021` and the window

**Short answer: no. Nothing the Worker runs outside the maintenance gate reads anything those
migrations add, and the window is a clean, full-service 503 — not a half-working server.**
`0020`'s `account_deletions` in particular cannot turn a sign-in into an error, because sign-in
never happens in that window at all.

**But the plan's premise has moved under it, and the new sharp one is `0021`.** As of
`9252111` (2026-11-09) README Status says production has every migration through `0021`
applied; the owner confirmed `0017`, `0019` and `0020`, and `0021` was marked applied "on
merge" (see finding 9 — the BUILD_LOG entry for that same batch still says it needs a deploy
then Apply pending). So the window the plan asked about has passed for three of the four, and
`0021` (`mail_daily`) is now the one sitting in it.

**What the code does read.** `auth.js:120` selects `s.role` (added by `0020`) on **every**
authenticated request, and `auth.js:126` queries `account_deletions` on every request whose
token matches no session row. `retention.js:213` reads `r2_sweep` (`0017`) on every daily run.
`mail.js:36,44` write `mail_counts` (`0019`) and `mail_daily` (`0021`) on every send. `ops.js`
reads `mail_counts` and `mail_daily`. So the plan's hypothesis was right about the reads — what
makes it harmless is where they sit.

**Why the window is safe.** `gate.js:17` caches "current" only when it is *true*, and
`schemaIsCurrent` (`migrate.js:55`) demands every bundled migration applied, none drifted, none
orphaned. `index.js:74` puts that check in front of every API route, `index.js:50` in front of
`/manager/api/`, and `index.js:112` in front of both crons. I held the database at `0019` with
`0020` and `0021` bundled and drove the real Worker:

| | in the window |
|---|---|
| `GET /health` | `200 {"ok":false,"maintenance":true}` |
| `GET /notice` | `200 {"notices":[]}` — the shutdown channel still works |
| `POST /auth/start`, `/auth/verify` | `503 {"maintenance":true}` |
| `GET /program`, `/devices`, every other API route | `503 {"maintenance":true}` |
| `GET /f/list/…`, `/f/status/…` (the family JSON) | `503 {"maintenance":true}` |
| `/list/…`, `/apply/…`, `/s/…` (the family **pages**) | served from ASSETS; `kennelPageInfo` catches and falls back to the generic link preview (`familyPages.js:160`) |
| both crons | `cron skipped: migrations pending`, nothing run |
| `/ops` | the migration table and **Apply pending (2)**; every other section withheld (`ops.js:162`) |

And with the gate forced open and `account_deletions` dropped, `authenticate` throws a raw
`ERR_SQLITE_ERROR` → `index.js:101` → `500 {"error":"internal"}` for any token the server does
not hold. That is the failure the plan feared; the gate is the only thing between it and the
users, which is why finding 2 (a rollback defeating the gate in the other direction) matters.

**What a breeder and a family see.** Both sides handle it well, which is worth recording:
`shared/data/cloud/cloudApi.js:86` turns `503 {maintenance}` into `CloudOfflineError`, and
`cloudBackup.js:248` treats offline as "retried later, never shown as a failure" — so her app
says nothing alarming and quietly retries. A family on a status page gets
`public/family/common.js:97`: *"This page is down for a few minutes of maintenance. Please try
again shortly."* Nobody sees a stack trace or a spinner that never ends.

**What the window still costs**, for as long as nobody presses Apply pending: no sign-in on a
new device, no backup, no live sync, no application can be submitted, no family can answer a
turn, and **both crons do nothing** — so turns are not closed, automatic offers are not made,
due email changes are not applied, and digests are not sent. Nothing pages the operator: the
only trace is one `cron skipped` line in the Worker log and a `/health` that says `ok: false`.
Findings 7 and 9 are the two sharp edges of that: a reminder whose single day falls inside the
window is lost for good, and the only record of whether production is in the window at all is
a README line that currently contradicts the build log.

---

## 1. `runKennel` commits its events and emails before its one write, and repeats everything if that write is lost  (S2, verified)

**Where** `cloud/src/serverMoves.js:316` (the write), `:270-285` (the close), `:215-229` (the
offer), `:198-209` (the email, deduped on `wl_messages.id`).

**Scenario** `runKennel` reads the projection row at version *V*, then, one statement at a
time: inserts `server_close` into `wl_events`, deletes the family's `wl_holds`, emails the
family *"your turn has closed"*, inserts `server_offer`, emails the **next** family *"It's your
turn!"* — and only then, at `:316`, writes the new projection with
`WHERE … AND version = ?`. If that `WHERE` matches nothing the result is discarded in silence
and `counts` is returned as though it all landed. Nothing takes a lock; `wl_leases`
(migration `0016`) exists but only `waitlist.js` uses it, for her devices.

Three ways it goes wrong, all verified against the real Worker:

- **Two runs read the same row.** The hourly cron fires at :07; `familyActions.js` calls
  `runKennelNow` the moment a family presses Pass on their phone. Both read version 1. Result:
  `wl_events` holds `server_close(t1)`, `server_offer(bo, turn=e887…)`, `server_close(t1)`,
  `server_offer(bo, turn=3b49…)` — and `wl_messages` holds **two** offer emails to Bo, because
  `emailOnce`'s id is `srv-offer-${turn_id}` and each run mints a fresh `turn_id`. (Only the
  close email deduped, on the stable `srv-closed-t1`.)
- **Her device publishes inside the window.** `publishProjection` (`waitlist.js:134`) refuses a
  publish that has not applied the server's events — but in the gap between the run's `SELECT`
  and its first event INSERT there are no such events yet, so her publish is accepted and
  becomes version 2. The run's write at `:316` then matches nothing. I confirmed the stored
  projection still shows Ann's turn open, and the next hourly run closed it again and offered
  Bo again.
- **An email throws.** `resendSend` (`mail.js:62`) rethrows a network error and nothing between
  `:270` and `:316` catches it, so the run dies after the `server_close` is already in. I made
  `fetch` throw: one `server_close`, projection untouched at version 1, and the next run
  produced a second `server_close` and then the offer.

**Why it matters** Bo is emailed his turn twice. On the same hour the two emails are identical;
an hour or a day apart (the `respond_by_date` is computed from that run's `today`) the second
carries a **later deadline than the first**, and the family has two answers to the same
question. On her side `planServerEvent` is defensive but not silent: the duplicate
`server_close` becomes *"You'd already recorded how it ended, so nothing changed here"*, and
the duplicate `server_offer` becomes *"KennelOS offered them their turn … and emailed them, but
another turn is open on your records, so it wasn't recorded here. Their status page showed the
offer until your next update: let them know where things stand."*
(`shared/data/waitlistEvents.js:299`). So she is told to go and sort out a mess the server made,
with no way to see that the family got two emails.

**What I'd do** Hold the kennel for the run (the `wl_leases` row, or a conditional
`version = version + 1` bump taken *before* any event or email, so a second caller finds the
row moved and exits). Failing that, make the repeat cheap rather than visible: give
`server_close` the same `cause_seq`-style dedupe `server_offer` already has, and key the offer
email on something stable (the entry and the offered date) instead of a fresh `turn_id`.

---

## 2. A Worker rollback after a migration puts the whole API into permanent maintenance  (S2, verified)

**Where** `cloud/src/migrate.js:43` (`orphaned`), `:55` (`schemaIsCurrent` wants every row
`applied`), `gate.js:14`, `ops.js:141` ("It is shown, never fixed automatically").

**Scenario** `0021` is applied. The next deploy turns out to be bad — a KennelPort origin typo,
a bug in `serverMoves`, anything — and the operator does what one does: rolls the Worker back
one version in the Cloudflare dashboard. That build's `MIGRATIONS` list stops at `0020`, so
`migrationStatus` finds `0021` in `_migrations` with no file and marks it **orphaned**;
`schemaIsCurrent` returns false; `schemaReady` never caches true; **every** API route, the
family JSON and both crons answer 503 maintenance. I ran it: with the database at `0021` and
the older list, `schemaIsCurrent` → `false`, and `applyPending` on that list returns zero
entries — so /ops's **Apply pending** is disabled and does nothing. The dashboard prints
*"A migration has drifted or is orphaned"* and offers no action.

**Why it matters** The cure for a bad deploy becomes a worse outage than the bad deploy, and
there is no way out through the product: `ops.js` has no SQL box, and the only fix is deleting
the `_migrations` row with `wrangler d1 execute` from a terminal — which is precisely what
`ops.js:1` says never happens ("never in a terminal"). Meanwhile her app is offline-but-quiet
and every family's status page says "down for a few minutes of maintenance", indefinitely.

**What I'd do** Treat an orphan as forward-compatible, since the schema is additive-only by
rule: `schemaIsCurrent` should require no `pending` and no `drifted`, and report orphans
loudly on /ops without gating. If an orphan must gate, give /ops a one-click "forget orphaned
migration `NNNN`" that names the id and what it dropped.

---

## 3. One oversized read ends the hour's email changes and digests, silently  (S2, verified)

**Where** `cloud/src/index.js:116-120`; `serverMoves.js:338`
(`SELECT public_id, program_id, version, body FROM wl_projection` — no `LIMIT`);
`waitlist.js:30` (`PROJECTION_MAX_BYTES = 1_500_000`).

**Scenario** The hourly cron body is three awaited calls in one `async` IIFE with no `try`.
`runWaitlistMoves` guards each **kennel** (`:341-349`) but not the read that fetches them, and
that read pulls every published kennel's whole projection body — up to 1.5 MB each — into one
D1 response and one Worker isolate. A few dozen busy kennels is a response D1 will refuse (and
a few hundred is a Worker out of memory). I replaced that one query with a thrower: the cron
produced **no log line at all** (not even `console.error`), and a due `email_changes` row was
still pending afterwards. `runDigests` never ran either.

**Why it matters** Three unrelated jobs share one failure. A size problem in the waitlist means
a breeder's email change silently misses its 24-hour effective time and her digest does not
arrive, and the only signal is Cloudflare's own cron-error count — nothing in the logs the
operator actually reads (`wrangler.toml:15` says the logs are the only place they can see why
something failed). It is also the one place in this Worker where growth alone breaks a feature:
every other list read is capped or per-program.

**What I'd do** Wrap each of the three in its own `try`/`console.error` so one cannot take the
others down. Page the projections (`SELECT public_id` first, then one body at a time, or
`LIMIT`/`OFFSET` by `published_at`) instead of reading the table.

---

## 4. The R2 sweep runs before every D1 purge, so one R2 blip skips the day's retention  (S2, verified)

**Where** `cloud/src/retention.js:120` (`await sweepR2Orphans(env, nowMs)`), before the
`env.DB.batch([...])` at `:122-161`.

**Scenario** `sweepR2Orphans` calls `env.FILES.list()` up to ten times. R2 is briefly
unavailable, or the bucket errors; the call throws, `runRetention` throws, and the whole batch
at `:122` never runs. I made `FILES.list` throw with an expired `login_codes` row in place:
`runRetention` threw `R2 unavailable` and the expired code was still there. The daily cron is
never retried (`index.js:108`), so that is a whole day with no purge of login codes, rate
limits, expired sessions, confirmed erasures, `account_deletions` past 90 days, vault pairings
and handoffs, `wl_family_sessions`, `wl_inbox`, `wl_events`, `int_events`, sync tombstones or
message bodies.

**Why it matters** The sweep is the least important thing retention does — the comment at
`:170` says its objects "can't be reached through the API" — and it is the thing that can stop
everything else. Nothing says so afterwards: the cron's one log line never appears, so the
operator does not learn that a day's retention was skipped, only that disk and row counts keep
creeping up.

**What I'd do** Move the sweep after the D1 batch and give it its own `try`/`catch` that folds
the error into `summary` (e.g. `r2SweepError: true`) so /ops's "Retention done" line can say it
was skipped. The same `try` belongs around `scheduled`'s `runRetention` call.

---

## 5. A D1 row whose R2 object is gone can never be repaired through the API  (S2, verified)

**Where** `cloud/src/files.js:31` (`existed: true` on the D1 row alone), `:27`
(`fileExists` reads D1, never R2), `snapshots.js:111` (the missing-files check reads `files`),
`snapshots.js:230` and `:238` (`getSnapshot` streams whatever `r2_key` says).

**Scenario** I uploaded a document, deleted its R2 object under it, and asked the Worker:
`HEAD /files/:sha` → **200**; `PUT /files/:sha` with the real bytes → **200
`{"ok":true,"existed":true}`** (so the client is told the upload succeeded and never sends the
body); `GET /files/:sha` → **404 `not_found`**. `POST /snapshots` naming that file → **200**,
because the reference check consults `files`. The same for a committed snapshot: with its body
deleted, `GET /snapshots` still lists it with its size, `GET /program` still reports it as
`latestSnapshot`, and the download 404s.

How a row gets ahead of its object: retention deletes rows then objects (`:24` — the safe
direction), but `/ops`'s D1 import exists precisely to put D1 "back over an R2 bucket that
still holds the objects" (`backup.js:5`), and `backup.js:4` records that R2 has no time travel.
So after any incident where the bucket lost objects, the restored index permanently claims
bytes that are not there — and there is no API call that can correct it.

**Why it matters** At the moment she needs it, Restore reads a snapshot that 404s, or applies a
snapshot whose documents cannot be fetched (K03 finding 5 notes the client gives up on a file
after one failed download). The server's own view says the backup is complete. The repair the
client would naturally make — upload it again — is the one thing the API refuses.

**What I'd do** Make `putFile` trust R2, not D1: `HEAD` the object (an R2 head is cheap) and
re-upload if it is missing, or drop the `existed` shortcut and let R2's content-addressed `put`
be the idempotent operation it already is. `GET /snapshots` could likewise mark a snapshot
whose object is missing, rather than offering it.

---

## 6. /ops's Delete an account cannot distinguish the case it is built for  (S2, verified)

**Where** `cloud/src/ops.js:322` (`findAccountPage`), `:300-318` (`accountSummary`),
`:356-368` (`deleteAccountByOps`), `program.js:60` (`removeAccount`).

**Scenario** The section's own words are *"for a user who asked, for example one who made two
accounts and wants to start over"*. The operator types an address and gets a confirm page
showing: created-at, counts of backups / synced records / vault passkeys / waitlist, and a
device table of labels and last-seen times. **The address is never echoed** — it cannot be,
since the server keeps only `HMAC(EMAIL_HMAC_KEY, email)` (`auth.js:25`), which is the right
privacy call. But that leaves nothing on the page that tells one of her two accounts from the
other: both were made by the same person, within days, from the same phone, so both show the
same device label ("Kels's iPhone") and similar dates. The operator confirms by typing DELETE
and `removeAccount` runs at once: snapshots and their vault parts, files, the vault's wraps
and pairings, sync records, the published waitlist and its tokens, inbox, events, holds,
emails, integration connections, notify settings and subscriptions, every session, the program
and the user. There is no undo, no soft delete, and no record of what went beyond the flash
message's device count.

Two smaller edges in the same path: the user id travels in a hidden form field and nothing
re-checks that it is still the account that was summarised (a stale tab deletes whatever that
id now names); and if the user somehow has no `programs` row, `:363` passes
`programId: ''`, so `deletePrefix(env.FILES, 'snapshots//')` and every `WHERE program_id = ''`
match nothing while the user and sessions go — an orphaned program nobody can reach.

**Why it matters** The one irreversible, total action in the product is confirmed against
fields that are identical in its main use case. If the wrong one goes, the breeder loses the
cloud copy of the program she is actually using — and if "Also erase its devices" was ticked
(it is **checked by default**, `:347`), the devices wipe their local records too, which turns
a wrong click into real data loss rather than a cloud-only one.

**What I'd do** Put something only the right account has on the confirm page: the newest
snapshot's date, size and counts, the kennel name from `wl_projection`, the last-seen time to
the minute. Echo back a masked form of what was typed (the operator typed it; showing
`k•••s@g•••.com` leaks nothing the server stored). Carry a hash of the summary in the form and
refuse if it changed. And default "Also erase its devices" to **off** — erasing devices is a
second, larger decision than deleting a cloud account.

---

## 7. The single-day reminders are lost for good if that day is missed  (S3, verified)

**Where** `cloud/src/serverMoves.js:293` (`today === t.respondBy` → the `last` reminder),
`:302` (`today === addOpenDays(due, -1, …)` → the fee reminder), `:288`
(`hour >= MORNING_HOUR`).

**Scenario** Both reminders fire only on an exact calendar day in the kennel's time zone. If
every hourly run that day is skipped — the maintenance window of §0, a D1 wobble, finding 3's
read failure, a Cloudflare cron miss — the day passes and the condition is never true again. I
ran the moves on the three days after a fee's single day and on the two days after a turn's
last day: **zero** reminders, where running on the day itself produces `srv-remind-t1-last`.
The `half` reminder recovers (`today >= offeredDate + span/2`), so the asymmetry is easy to
miss while reading.

**Why it matters** The family who most needed the nudge — "your turn ends today", "your fee is
due tomorrow" — is the one who does not get it, and the turn then closes as no response on
`:268`. Neither she nor the family is told the reminder was skipped; the activity line she
eventually reads says the turn closed, not that nobody warned them.

**What I'd do** Make both catch up rather than match: send while `today <= respondBy` and no
`srv-remind-<turn>-last` row exists yet, and while `today <= due` for the fee. The `wl_messages`
id already makes "once" safe, so a window instead of an equality costs nothing.

---

## 8. An email change dropped at apply time says nothing  (S3, verified)

**Where** `cloud/src/emailChange.js:32-35` (`applyChange`: taken → `DELETE FROM email_changes`,
return false), `:187-191` (`applyDueEmailChange`, called from every check-in via
`emailChangeState`), `:194-199` (`applyDueEmailChanges` returns `{applied, dropped}`).

**Scenario** She asks to move the account to `new@example.com` from a signed-in device without
the old inbox, so it waits 24 hours and her Account card shows "pending until …" with Cancel.
Inside that day someone signs up for cloud backup with `new@example.com` — which the API
cheerfully allows; the taken check at `:231` only ran at request time. When the wait is over,
`applyChange` finds the hash taken, deletes the pending row and returns false. Her next
check-in gets `pending: null`, `changedAt` unchanged. The card simply stops showing the
pending change. Nothing anywhere says the change was abandoned or why; the `dropped` count goes
into the hourly cron's log line, which she never sees.

**Why it matters** She believes her account moved, tries to sign in on a new phone with the new
address — and gets a brand-new empty account with a code of its own (`/auth/start` always
succeeds). Her program is still on the old address, which she may by then have lost; the
recovery flow in `recovery.js` is the only way back, and it needs a vault recovery code.

**What I'd do** Keep the row with a `failed_reason` instead of deleting it, and surface it in
`emailChangeState` so the Account card can say "That address was taken while the change was
waiting, so nothing changed. Your account is still <old>." The same wording covers the
`recovery.js:118` path, which has the same race.

---

## 9. README Status and the build log disagree about `0021`, and the difference is "is the API up?"  (S3, verified)

**Where** `README.md:58-61` ("Production has every cloud migration through `0021` applied")
vs `docs/BUILD_LOG.md:3025` for the same batch ("Needs a Worker deploy, then Apply pending
(`0021`) on /ops"); commit `9252111`'s message records `0017`, `0019`, `0020` as
owner-confirmed and `0021` as "on merge".

**Scenario** Because of §0, this is not a bookkeeping detail: if `0021` is bundled but not
applied, `schemaIsCurrent` is false and **every** API route, the family JSON and both crons
answer 503 — sign-in, backup, sync, applications, turns, digests, all of it. The two documents
say opposite things about whether production is in that state right now, and the plan's own
"not findings" list still describes `0017`/`0019`/`0020` as pending, so a reader has three
versions of the truth.

**Why it matters** This is the repo's only record of what the live database is at, and it is
what the next session (and the owner, mid-incident) will reason from. `/ops` is the ground
truth and takes ten seconds to read — but nothing in the docs says that is where to look.

**What I'd do** Settle it from `/ops` and rewrite the Status line to match, and add one
sentence to `cloud/README.md`'s migration rules: after a deploy that adds a migration, the API
is in maintenance until Apply pending is pressed, so `/ops` — not this file — says what is
applied. The review plan's "not findings" list wants the same correction.

---

## 10. /ops serves HTML with no Content-Security-Policy  (S4, verified)

**Where** `cloud/src/ops.js:46-70` (`page()` sets only `content-type` and `cache-control`).
Every other HTML this Worker serves has one: `assist.js:340` for `/manager`,
`notify.js:454` for `/notify/off`, `familyPages.js:81,186,191` for the family pages.

**Scenario** Nothing is injectable today — I checked every interpolation in `ops.js` and all 40
either escape with `esc()` or interpolate a boolean, a literal or an already-escaped fragment;
the values that come from users (notice messages, device labels, Resend's refusal text, D1
error text) are all escaped. So this is depth, not a hole: the page that renders operator-typed
notice text, device labels pushed by any signed-in device, and third-party error strings is the
one page with no second line of defence, while the pages that render only their own assets have
one.

**Why it matters** The next person to add an /ops section — the Delete an account page is three
weeks old — has no backstop. An `/ops` XSS runs with the ops cookie and the Delete an account
form on the same origin.

**What I'd do** Give `page()` the same header `/manager` already carries:
`default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'`.
The page has no scripts and no images, so it is a one-line change with nothing to adjust.

---

## 11. The daily run reads every committed snapshot in the database at once  (S4, verified)

**Where** `cloud/src/retention.js:76-78` — `SELECT id, program_id, created_at, r2_key FROM
snapshots WHERE status = 'committed'` with no `LIMIT` and no `program_id`; `MAX_PER_RUN` is
applied at `:83`, *after* every row is already in memory. `:79-81` does the same for `pending`.

**Scenario** The keep policy holds roughly 24 hourly plus 30 daily snapshots per program, so
each program contributes ~54 rows of ~150 bytes. The query is fine at today's size and grows
strictly with the number of programs; somewhere in the low thousands it meets D1's response
cap, and then `runRetention` throws on its first statement and the day's retention does not
run (finding 4's failure mode, from a different cause).

**Why it matters** It is a growth cliff with no warning before it: the first symptom is
retention silently stopping, which shows up as storage cost and as rows nobody purges, not as
an error anyone sees.

**What I'd do** Iterate by program (`SELECT DISTINCT program_id`, then one program at a time
with its own cap), or page the snapshot read by `created_at`. The same applies to
`sync.js syncCounts` and `notify.js runDigests`'s `SELECT *`, both of which are small today.

---

## 12. The pre-gate part of the router has no `try`  (S4, verified)

**Where** `cloud/src/index.js:52` (`serveFamilyPage`), `:58` (`preflight` / `websitePreflight`),
`:60` (`corsHeaders`) — all before the `try` at `:62`. `handleOps` wraps its own router
(`ops.js:375`) and `handleManager` wraps everything after its static files (`assist.js:356`), so
`/ops` and `/manager` are covered.

**Scenario** `serveFamilyPage` is defensive where it reads D1 — `kennelPageInfo` catches
(`familyPages.js:160`) — but `fromAssets` and `withPreview` are not wrapped, and neither is the
`new URL` / regex work in the preflight path. Anything that throws there escapes the handler,
so Cloudflare answers with its own "Worker threw exception" page instead of the Worker's
`500 {"error":"internal"}` — with no CORS headers, so a browser reports it as a network
failure rather than a server error.

**Why it matters** A family opening her list gets a Cloudflare error page with Cloudflare's
branding on it, and her app's `cloudApi` cannot tell the difference between that and no
internet. It also means the one `console.error('unhandled', …)` the operator relies on
(`index.js:101`) never fires for anything in this section.

**What I'd do** Move the `try` up to the top of `fetch`, keeping the CORS computation inside
it with a `{}` fallback, so every path answers JSON.

---

## 13. `POST /program/backing-device` is not owner-only  (S4, verified)

**Where** `cloud/src/api.js:37-47` (`OWNER_ONLY` and `ownerOnly()`), `:100` (the route),
`program.js:22` (`takeOver` sets `backing_device_id` to the caller's device unconditionally).

**Scenario** A helper session is an ordinary session with `role = 'helper'`
(`0020`), and `api.js:82` refuses it on twelve owner-only routes. `POST
/program/backing-device` is not among them, so support's device can make itself the backing
device. Her own device then meets `409 not_backing_device` on its next push
(`snapshots.js:103`) and stops backing up until she notices the status line and presses "Back
up from this device instead".

**Why it matters** Assisted setup plausibly *wants* support to push the first snapshot, so this
may well be deliberate — but nothing says so, and it is the one non-owner-only route that can
quietly stop her backups. The same list also lets a helper call `PUT /notify` and `DELETE
/notify/digest` (changing her alert settings and deleting her digest address) and `POST
/devices/:id/license-released`; those look intended, but the set deserves a sentence in the
plan either way.

**What I'd do** K5 owns assisted setup — this is a flag for that session, not a patch. If it is
deliberate, say so beside `OWNER_ONLY`, and have `takeOver` record who took it so her device
list can name support rather than an unlabelled device.

---

## 14. The restore path batches the whole database in one call  (S4, suspected)

**Where** `cloud/src/backup.js:52-69` — one `statements` array over all 26 `EXPORT_TABLES`,
one row per `INSERT`, then a single `db.batch(statements)`; `exportAll` at `:39` likewise does
`SELECT *` per table with no paging.

**Scenario** This is the documented way back from a D1 loss, and it is all-or-nothing by
design ("All rows go in one batch, so it lands whole or not at all"). At production size that
is every user, session, snapshot row, `wl_event`, `wl_message`, `sync_device`, push
subscription and integration event in one request. I have not run it at scale — the tests use
a handful of rows — so I am labelling it suspected rather than verified; but nothing in the
code chunks it, and the export side has the same shape. If it fails, it fails at the worst
possible moment, with a D1 error in `errorPage` and no partial progress.

**Why it matters** It is the one procedure that is only ever exercised in an emergency, and the
only one in this Worker with no per-run cap anywhere in it.

**What I'd do** Chunk the import (a few hundred statements per batch, in `EXPORT_TABLES` order
so parents still land first) and say in the flash how far it got; chunk `exportAll`'s reads the
same way. Then run it once against a copy with realistic row counts and write down what it
took — the point of a recovery path is that someone has done it before.

---

## Notes, not findings

- **Logging is clean.** All 24 `console.*` calls carry a status code, a count, a provider name
  or an error *message* — no address, code, token, body or record. `readJson`
  (`lib/http.js:37`) swallows the `JSON.parse` error rather than logging it, which matters:
  V8's parse messages quote the input. `integrations.js:203` logs `m[1]`, the provider slug,
  not `m[2]`, the hook secret. `index.js:101` logs `err.message` only. The cron lines
  (`index.js:115-119`) stringify summaries that are counts throughout
  (`retention.js:74`, `serverMoves.js:337`, `emailChange.js:198`, `notify.js:517`).
- **Where readable personal data does sit on the server**, by design and documented in each
  module: `notify_settings.digest_email` / `pending_email`, `wl_messages.to_email` and `body`
  (90 days), `push_subscriptions.endpoint` and `auth_secret`, `wl_inbox` applications. All four
  are in `/ops/export.json` (`backup.js:22`). The page calls it "Backup of this database · D1
  rows only" — true, but it is also every family's address and the text of every email sent in
  the last 90 days, and the page does not say so. Worth one sentence there.
- **Auth reads well.** 10-minute codes burned on first use with a `changes !== 1` re-check
  (`auth.js:65`), 5 attempts, 90-day sliding sessions, `timingSafeEqual` everywhere a secret is
  compared, email and IP both HMAC'd before storage (`ratelimit.js:31`), `randomCode` with
  modulo bias removed (`crypto.js:39`), and `/auth/start` answering `{ok: true}` for any
  well-formed address so the API never says whether an account exists. `recovery.js`'s stand-in
  wrap (`:60`) is a nice touch: an address with no account gets a deterministic wrap-shaped
  value, so "doesn't match" means the same thing either way.
- **The two account-handover flows both have the owner's veto.** `requestRecoveryEmail` needs
  the 120-bit recovery code *and* a code sent to the new address, waits 24 hours, and emails
  the old address with a working cancel path (sign in there, `DELETE /account/email`, which is
  owner-only). `requestEmailChange` without the old inbox does the same. The notice wording at
  `recovery.js:100` matches what the product actually allows. Both consume the new address's
  code only after the taken-check, so a taken address does not burn one.
- **`account_deletions` cannot match a live session.** Its rows are `sha256` of 32 fresh random
  bytes, and `auth.js:126` consults the table only when no `sessions` row matched — and
  `removeAccount` deletes the session rows in the same batch that writes the hashes
  (`program.js:83-85`). Signing up again on the same address mints a new token. The 90-day
  prune (`retention.js:135`) only shortens how long an old device hears `account_deleted`
  rather than a plain sign-out.
- **`removeAccount` is not atomic across R2 and D1**: `revokeAllConnections` and the two
  `deletePrefix` calls run before the batch (`program.js:62-64`). If the batch then fails, the
  bytes are gone and the rows remain — a snapshot list pointing at nothing, which is finding
  5's shape. Low concern (everything there was going anyway), but it is the one place the code
  deletes R2 before D1, against the ordering `retention.js:24` sets out.
- **`wl_senders` is race-safe**: `local_part` is `UNIQUE` (`0010_family_email.sql:13`), so
  `familySender`'s `catch` at `mail.js:208` really does fall through to the next candidate
  rather than two kennels sharing a sending address.
- **The ops cookie** is `HttpOnly; Secure; SameSite=Strict; Path=/ops` with a 12-hour HMAC'd
  expiry — CSRF is covered. There is no revocation short of rotating `OPS_TOKEN`, which is fine
  at this size but worth knowing.
- **Mis-click distance on /ops**, since the plan asks: *Apply pending* and *Run retention now*
  are single unconfirmed clicks. Retention is idempotent and only drops what the policy already
  says to drop, so that is defensible. *Apply pending* is irreversible by the project's own
  rules, but that is the button's whole job. *Import* refuses unless every target table is
  empty. *Generate push keys* only shows a key, never stores it. Only *Delete an account* is
  both irreversible and unrecoverable, and it is the one with two steps and a typed DELETE —
  the right shape; finding 6 is about what the second step shows, not that it exists.
- **`mailCountsThisMonth` has no `try`** where `mailDailySummary` has one (`mail.js:100`), so
  `0019`'s reader would throw if the table were ever missing while `0021`'s returns null. Not
  reachable today (the gate means `currentSections` only runs when nothing is pending), but the
  asymmetry is the kind of thing that bites on the next rollback.
- **`verifyCode` assumes the program row exists**: `auth.js:89` reads it and `:103` uses
  `program.id` with no null check. Unreachable today — `:85` creates one with every user and
  `removeAccount` deletes both in one batch — but `deleteAccountByOps` can pass
  `programId: ''` (finding 6), which is the one path that could leave the pair out of step.
- **`checkIn`'s sliding expiry** pushes `expires_at` 90 days out on every call
  (`devices.js:121`), so a device that merely checks in never expires. That is deliberate
  (the comment says so, for "last seen" accuracy) and it is why `requestErase` revoking
  sessions matters more than expiry does.
- **The gate's isolate cache is sound.** `current` is only cached when true, and a deploy means
  a new isolate, so it cannot outlive its own migration list (`gate.js:6-11`). Finding 2 is the
  one way the cache's assumption is defeated, and it is defeated in the safe-but-useless
  direction.
- **KennelPort seam**, one line as the plan asks: `WEBSITE_PATHS` (`lib/cors.js:55`) opens
  exactly `/f/apply/:id`, `/f/verify` and `/f/code` to a KennelPort site or a hand-added
  `WEBSITE_ORIGINS` entry, with no cookie and no session, so CORS grants nothing a script
  could not already do — the real guard is Turnstile and the per-address limits. Left to the
  KennelPort plan.

## Coverage gaps I found (tests that should exist)

- **Two `runKennel` passes on one projection row** (finding 1). `serverMoves.test.js` covers
  every move once; nothing covers the same move twice, which is the only way the dedupe design
  is checked. A test that runs the hourly pass and `runKennelNow` against the same version and
  asserts one `server_offer` and one offer email would have caught it.
- **A `runKennel` whose write loses the version race**, asserting the projection is either
  updated or the events are not written.
- **A rollback**: `migrate.test.js` covers drifted and orphaned states but never asserts what
  `schemaIsCurrent` does with an orphan, which is the whole of finding 2.
- **Cron containment**: `worker.test.js` covers "no D1 answers 503" and the migrations-pending
  skip, but nothing asserts that a failure in one hourly job leaves the other two running, or
  that `runRetention` still purges when the R2 sweep fails.
- **R2/D1 divergence**: `retention.test.js` exercises the sweep thoroughly in the
  object-without-row direction. Nothing covers row-without-object — `PUT` answering
  `existed: true` over a missing object deserves a test whichever way it is resolved.
- **A reminder day skipped**: `serverMoves.test.js:168` asserts each reminder goes once on its
  day; a companion asserting what happens when that day's runs are missed would have made
  finding 7 a decision rather than an accident.
- **`applyChange` dropping a change**: `emailChange.test.js` covers the taken-at-request-time
  409; the taken-at-apply-time drop (`:32`) has no test and no user-visible outcome to assert,
  which is the finding.

## What I did not get to

- **`sync.js` beyond push/pull validation.** I read it end to end and checked the push batch's
  seq arithmetic, the allow-list check against `CLOUD_FIELDS`, and the table/op/size guards
  (an unknown table is a clean 400 at `:122`, not the `spec.keys` crash it first looks like).
  K03 reviewed the rule itself from both ends; I did not re-run its conflict scenarios.
- **`vault.js`, `license.js`, `assist.js`, `assistApp.js`** — K5's, read here only for logging
  and the gate, as the plan directs. Finding 13 is a flag for K5, not a review of it.
- **`waitlist.js`, `familyPages.js`, `familyActions.js`** — K6/K7's. I read `publishProjection`
  and `serveFamilyPage` because findings 1 and 12 turn on them, and nothing else.
- **`geo.js`** — read; `MAPBOX_TOKEN` is a secret, addresses are not stored or logged, `/ops`
  checks it live. Nothing to report, but I did not exercise it against Mapbox.
- **Load and size behaviour measured rather than reasoned.** Findings 3, 11 and 14 are about
  reads with no cap; I argued them from the code and the stated limits rather than from a
  loaded D1, which is why 14 is labelled suspected.
- **`/ops` in a real browser.** I read the HTML and checked every interpolation, but did not
  serve the page and click through it at 320px.
