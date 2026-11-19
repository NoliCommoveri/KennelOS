# KennelOS — Waitlist Timers Plan

> **Status: built (2026-11-19), all three phases.** Asked by the owner for a breeder (2026-11-19), for
> her current litter, ahead of the Stripe webhook plan. It goes on `main`, not `next`.
> Pro only, like the rest of the waitlist.

## 1. What she asked for

1. **Picks open in…**: a countdown to when picks open on a litter.
2. **Your turn could come by…**: an estimate of when a family's turn arrives, from their place
   in line and her turn length.
3. **Your turn ends in…**: a countdown to the deadline for the family holding the turn.

To support these, she sets a **time** as well as a day: when picks open, and how long a turn
lasts in **hours** (e.g. 24 hours later). That way turns open and close while families are awake,
not at midnight.

## 2. Where things are now (checked in code)

- **Deadlines are dates only.** Every open offer row has `respond_by_date` (YYYY-MM-DD).
  `waitlistRules.respondByDate(offeredDate, config, program)` counts `respond_days` (or the
  program's `respond_days_override`) of her open days (`addOpenDays` with
  `businessDays(config)`: `open_days`, `closed_dates`). A turn's deadline is the latest row's
  (`turnRespondBy`). A turn is overdue once the kennel's date is past that date
  (`isTurnOverdue(turn, today)`), so every turn really ends at **midnight** in the kennel's zone.
- **Writers of `respond_by_date`** in `shared/data/waitlistActions.js`: `makeTurn`,
  `recordPrepassed`, `autoPassTurn`, `extendTurn` (by hand, `onOpenDay`), a litter joining a
  turn (`joinRespondBy`), restore/re-open (`respondByDate`), undo "Not this litter", applying the
  server's turn (`applyServerTurn` via `waitlistEvents`), and a side sale's deposit due.
- **The Worker** (`cloud/src/serverMoves.js`) mirrors the rule: `addOpenDays` with the
  projection's `kennel.open_days` / `closed_dates`, the queue's `respondDays`. On the hourly cron
  at :07 (`wrangler.toml`), it closes a turn when `today > respondBy`, but only if she ticked that
  moment in `auto_offer_on`, and then offers the next family. Reminders go out from
  `MORNING_HOUR` (8 am): halfway through the turn and on its last day.
- **The family's page** (`cloud/public/family/status.js`) shows "Deadline: Friday, Nov 21
  @11:59 pm CST" (`common.js` `deadlineText`).
- **Picks open only on her tap** (`openPicks`; Waitlist spec Q8). `Litter.accept_deposits_date`
  ("planned to start taking deposits") only raises a Today nudge
  (`depositsDueLitters`). It already reaches the family pages as an early litter's
  `picks_expected_date` (`waitlistProjection.upcomingSection`).
- **Place in line**: families see `#position` and `pref_places`, but no times.

## 3. Decisions

Decided by the owner (2026-11-19):

- **T1, the turn model: hours, kept in waking hours.** A turn lasts `turn_hours` hours from
  when it's offered. A deadline that would land outside her **families' waking hours**
  (`awake_from`–`awake_until`, kennel time) moves to the start of waking hours. With
  `turn_hours` unset, today's model (days, ending 11:59 pm) is kept, so nothing changes for
  anyone until she turns this on.
- **T2, opening picks: countdown + nudge.** Phase 2 adds the planned opening time, its
  countdown and a nudge and push at that time; she still taps Open picks. Picks opening by
  themselves on the Worker stays Q8 and comes later.
- **T3, closing on time: crons on :00 and :30.** The waitlist-moves cron moves from
  `7 * * * *` to `0,30 * * * *`, and hours deadlines are **rounded up to the next half hour**.
  A 7:00 pm deadline closes at the 7:00 pm run, so the countdown and the close agree.
  The other jobs that shared the hourly cron (email changes, digests, e-sign) run only on
  the :00 run, so the Worker keeps the same number of cron triggers. A
  kennel in a zone offset by :45 (Nepal, Chatham) is 15 minutes late.
- **T4, the estimate: shown once a litter matches.** It's shown only when a planned or open
  litter has a pup that matches the family, and it's worded as the latest likely time.

Taken as recommended (the owner can change any of these; each is one place in code):

- **T5, closed days don't count.** Turn hours tick only on her open days, as day counts
  already do. A 24-hour turn offered at 7 pm Saturday, with Sunday closed, ends at 7 pm Monday.
- **T6, a program's longer window** (`respond_days_override`) counts as that many × 24 hours
  in the hours model. No new program field.
- **T7, defaults:** waking hours are 8:00 am–9:00 pm, and times are chosen in 30-minute steps.
- **T8, wall-clock arithmetic.** Hours are counted on the kennel's clock face: across a
  daylight-saving change a turn gets an hour more or less. The device and the Worker count the
  same way, so they never disagree.
- **T9, reminders in the hours model:** one at the halfway point, and a last one 3 hours before
  the deadline (never before waking hours start). The days model keeps today's reminders.

## 4. The deadline rule (hours model)

`respondBy(at, config, program)` with `at = { date, time }` (kennel-local; `time` 'HH:MM'):

1. With no `turn_hours`, return `{ date: respondByDate(at.date, …), time: null }` (today's model).
2. Hours = the program's `respond_days_override × 24`, else `turn_hours`.
3. Counting starts at `at` if `at.date` is an open day, else at 00:00 on the next open day. The
   hours run through open days only (T5).
4. Round the end up to the next :00 or :30. An end at 24:00 is past waking hours.
5. If the end is before `awake_from`, move it to `awake_from` that day. If it's after
   `awake_until`, move it to `awake_from` on the next open day.

`time: null` on a row means 11:59 pm, as every row made today is read. Rows are compared by
`deadlineKey(date, time)` = `'YYYY-MM-DDTHH:MM'`, with `24:00` for no time, against the
kennel's now (`kennelNow(kennel)` = `{ date, time }`). An overdue check given only a date (an
old caller) treats it as that day's 00:00, so it never closes anything early.

## 5. Data (additive; no index, so no `db.version` block)

| Where | Field | Meaning | Sync |
|---|---|---|---|
| `waitlist_offers` | `respond_by_time` | 'HH:MM' kennel time, or null = 11:59 pm | cloud (families see their deadline) |
| `Kennel.waitlist_config` | `turn_hours` | null = days model; whole hours ≥ 1 | inside `waitlist_config` (cloud) |
| `Kennel.waitlist_config` | `awake_from`, `awake_until` | 'HH:MM', defaults 08:00 / 21:00 | inside `waitlist_config` |
| `Litter` (Phase 2) | `picks_open_time` | 'HH:MM' on `accept_deposits_date` | cloud |
| `Kennel.waitlist_config` (Phase 2) | `picks_open_time` | her usual opening time, prefilled on a litter | inside `waitlist_config` |

Backups: optional fields, read with defaults, so old files and old builds are unaffected (an
old build ignores `respond_by_time` and reads the day). The projection carries
`respond_by_time` on each offer and `turn_hours`, `awake_from`, `awake_until` on its kennel
and queue entries.

## 6. Phases

### Phase 1: deadlines at a time (built)

- `dateUtils.kennelNow`, `timeInZone`. In `waitlistRules`: `respondBy`, `hoursDeadline`,
  `deadlineKey`, `turnDeadline`; `isTurnOverdue` / `overdueTurns` / `joinRespondBy` take a now;
  `fmtDeadline` for display; config validation of the new fields.
- `waitlistActions`: every writer above also writes `respond_by_time`. `extendTurn` takes
  `untilTime` (default: the turn's own time, else `awake_until`). `kennelNow` is used where a turn
  starts.
- Waitlist settings → Turns & offers: **How long a turn lasts**, in days (as now) or hours, with
  **Families' waking hours** shown for hours.
- Her side shows the time wherever the respond-by date shows: the picks panel, a family's page,
  Kels's Review, Today's overdue nudges (on `kennelNow`), and emails' `[Respond by]`
  ("November 21, 2026 at 7:00 pm").
- Worker: `serverMoves` mirrors `respondBy`, closes on `now ≥ deadline`, and sends the T9
  reminders. The crons become `0,30 * * * *` in both environments, and the reminders' once-each
  ids keep the twice-hourly runs from sending twice. `familyPages` passes `respond_by_time`, and
  the family page's deadline line shows the real time.

### Phase 2: the planned opening time and the two countdowns (built)

- Litter `picks_open_time` ('HH:MM', cloud), the **Picks open at** select beside **Accept
  deposits date** on the Litter page (Pro), and her usual time,
  `waitlist_config.picks_open_time` (Waitlist settings → Turns & offers, **Usual time picks
  open**). `waitlistRules.plannedOpening(litter, config)` → `{ date, time }` (the litter's
  time, else her usual one, else none = the start of that day); `isOpeningDue`.
  **Modified:** Kels's litter questions don't ask for the time; a litter made there takes
  her usual time.
- Today's Open-picks nudge (`depositsDueLitters(..., now, { configFor })`) comes at the date
  and time on the kennel's clock, and says the time.
- The Worker sends her one alert at the planned time (`notify` kind `turn`, line
  `picks_due`: "It's time to open picks: see Today"). It goes from the scheduled run whose half
  hour holds the planned time (`runKennel(..., { cron: true })`), only for a litter with a time,
  pups and picks not open (the projection's `litters[id].planned_open`). Opening picks stays hers.
- **Picks open in…**: on a born litter's Coming up card on the family's status page and the
  public list (`picks_expected_time`; the server adds `picks_expected_at`), and on her picks
  panel ("Planned to open Nov 22, 7:00 pm (in 3 days 5 hr)"). The family pages show it only
  where she shows that litter ("Whelped litters, picks not open yet", Spec §16.4).
- **Your turn ends in…**: under the deadline on the family's turn card and deposit block (the
  server adds each offer's `respond_by_at`). At zero it reads "Time's up. Waiting on [kennel]."
  Her picks panel shows "ends in …" beside the deadline.
- Countdowns tick toward an absolute moment (`zonedInstant(date, time, tz)`, the device's in
  `dateUtils`, the Worker's in `serverMoves`, pinned by a test), every second, in place, with
  tabular digits (`.countdown`), so nothing moves on the page: '2 days 4 hr', '5 hr 12 min',
  '12:04' in the last hour (`countdownText`; `ui.countdownHtml` / `startCountdowns`, and the
  family pages' copies in `common.js`).

### Phase 3: the turn estimate (built)

- Open litters share one turn order, and a litter that opens joins it (§16.1), so the estimate
  counts the families ahead of this one in that order. Open now: the projection's
  `turn_queue`. Her next planned litter: the projection's `next_opening` (`{ litter_id, date,
  time, queue: [{ entry_id, dog_ids, planned }] }`), the same walk with that litter counted open.
- On the Worker, `serverMoves.turnEstimate(projection, entryId, now)`: starting at the end of the
  turn open now (or now, or when picks open), each family ahead uses its full time, one
  `turnDue` after another (hours and waking hours, or days, with closed days). → `{ at, next,
  opening, opens_at }`. `familyPages.statusView` gives the page `family.turn_estimate`
  (`at`, `next`, `opens_at`): a time, never who is ahead or how many.
- **Only for a family who could get a pup** (owner, 2026-11-19: don't tell #100 their turn
  could come when there are 6 pups): walking the order, the turn holder's pick (or one of
  their pups) and then each family ahead who'd take one of the pups this family wants (still
  available now) takes one; a family left with none gets no estimate. It's worked out from the
  projection as it is when the page loads, so it changes with every turn and every pick.
- The status page's Current Position card shows "Your turn could come by about Tue, Nov 25,
  7:00 PM CST (in 6 days 2 hr)" with "If every family ahead of you uses their full time; it comes
  sooner when families pass. … An estimate, not a promise." It shows "You're next in line" when
  nobody is ahead and no turn is open, "Your turn could start when picks open" when they're
  first for the planned litter.
- No estimate while their own turn is open, for a family not in either order (paused, not
  listening, "Not this litter" to all of it, no matching pup), for a planned litter she doesn't
  show on family pages (T4), past 200 families ahead, or for a kennel with no time zone.

## 7. Tests

`tests/waitlistTimers.test.js` covers the rule (rounding, waking hours, closed days, program
override, the days model unchanged), overdue at a time, writers storing the time, and the
Worker's mirror agreeing with the device across a table of cases. The `serverMoves` tests
cover the close at the deadline and the hours reminders; Phases 2–3 add the planned opening and
its alert, the moments (`zonedInstant`) and words of the countdowns, `next_opening` in the
projection, and the estimate in days, in hours and from a planned opening. Existing suites are
unchanged with no `turn_hours`.

## 8. Docs on build

End-State guide §29 (deadlines, whose clock), a README doc-map row, and a `docs/BUILD_LOG.md`
entry per phase.
