# KennelOS — Free Changes Before Pups Are Born (plan)

> **Status: built on `main` (2026-11-19).** Asked by the owner (2026-11-19). The breeder
> chooses, for each kind of change a family can make on their status page, whether it
> applies on its own or waits for her approval, once for **before pups are born** and once
> for **after pups are born**. The questions in §8 are decided (owner, 2026-11-19: the
> recommendations; Q6 has none, so colors stay hidden while color matching is off).
> **Modified:** the settings are a group in Waitlist settings (not a separate card), and
> the Today note for free changes returning shows for 14 days after the closing.

## 1. Where things are now

A family on the online waitlist asks for these changes on their status page. Each one is
stored as a request on their entry, and nothing changes until she taps **Approve** on Today
or on the entry page (`waitlistEvents.planFamilyEvent`, `waitlistActions`):

| Change | Event | Request on the entry | Approve |
|---|---|---|---|
| Sex | `pref_change` | `pref_change_request` | `approvePrefChange` |
| Breed | `pref_change` | same | same |
| Looking for (placement) | `pref_change` | same | same |
| Colors (only while color matching is on) | `pref_change` | same | same |
| Ready to buy | `pref_change` | same | same |
| Parents (which litters: All / Only these / Not these) | `listen` | `listen_change_request` | `approveListenChange` |
| Pause my place until a date | `pause_request` | `pause_request` | `approvePauseRequest` |

Families can't end a pause early. Approval exists because, once pups exist, a family could
narrow an answer just before their turn, get skipped with no pass counted, then change it
back (Spec §15.9, Q29). **With no pups on the ground there's nothing to dodge**: an offer
needs pups (`litterQueue` / `eligiblePupsFor`), so no turn can be open.

## 2. The rule: "pups on the ground"

Per kennel (the waitlist is per kennel): **pups are on the ground** while any non-archived
litter of that kennel has status `whelped`, `weaning`, `ready` or `sold` (born and not yet
`closed`). Otherwise the kennel is **before pups are born**, including while litters are
only `expected`.

- New pure helper in `waitlistRules.js`: `pupsOnGround(litters, kennelId)` → boolean, and
  `changePhase(litters, kennelId)` → `'before' | 'after'`.
- **Safety net:** a family with an open turn is always treated as `after`, whatever the
  litters say (a turn left open on a litter she has since closed, say).
- Whether `waitlist_off` litters count, and whether `sold` counts, are questions Q1 and Q2.

## 3. Her settings

A new `waitlist_config.family_changes` key (additive, read with defaults; no schema
change), one row per kind of change, `true` = auto-approved in that phase:

```js
family_changes: {
  pref_sex:      { before: false, after: false },
  pref_breed:    { before: false, after: false },
  pref_purposes: { before: false, after: false },
  pref_colors:   { before: false, after: false },
  ready_timing:  { before: false, after: false },
  listen:        { before: false, after: false },
  pause:         { before: false, after: false },
  unpause:       { before: false, after: false }   // §5
},
unpause_allowed: false   // families may ask to end a pause early (§5)
```

- `false` = the change is a request she approves, as today. `true` = it applies on its own
  ("free" below).
- **Defaults equal today's behaviour** (everything unticked, ending a pause early not
  offered), so nothing changes for anyone until she ticks something.
  `waitlistRules.WAITLIST_CONFIG_DEFAULTS` gets the defaults; `waitlistConfig()` fills in
  missing rows and turns anything but `true` into `false`.
- `syncRegistry.js`: `waitlist_config` is already classified, so these are sub-keys of an
  existing field. The device publishes only the result (§4), never the grid itself.

**Where she sets it:** Kennel › Waitlist settings › a new **Family changes** card (a card on
an existing page, no new header button):

> **Allow auto-approval of changes to the following preferences:**
>
> | | Before pups are born | After pups are born |
> |---|---|---|
> | Sex | ☐ | ☐ |
> | Breed | ☐ | ☐ |
> | Looking for | ☐ | ☐ |
> | Colors | ☐ | ☐ |
> | Ready to buy | ☐ | ☐ |
> | Parents | ☐ | ☐ |
> | Pausing their place | ☐ | ☐ |
> | Ending a pause early | ☐ | ☐ |
>
> ☐ Let families ask to end a pause early
>
> Right now: before pups are born (no litter is whelped).

- One checkbox per cell, each with an accessible label ("Auto-approve sex changes before
  pups are born"). On a phone the grid keeps its three columns; the row names wrap.
- The **Colors** row shows only while color matching is on (Q6).
- The **Ending a pause early** row is greyed out until **Let families ask to end a pause
  early** is ticked. That box decides whether the button exists at all; the row decides
  whether it needs her OK.
- Ticking any **After pups are born** box shows a one-line warning under the grid: "After
  pups are born, a family could change an answer to skip their turn without it counting as a
  pass." (Q3.)
- The last line names the current phase, so she knows which column is in force.

## 4. How a change flows

The server stays narrow (Family Requests plan §2): her device works out what's allowed and
publishes it, the server checks against that, and her device decides again when it applies.

1. **Her device publishes** per family `changes_free: { pref_sex: true, …, unpause: true }`
   in `waitlistProjection` (the phase applied to her settings, with the open-turn safety
   net), plus the kennel's `change_phase`.
2. **The status page** shows a free field as an ordinary editable answer with **Save** in
   place of **Ask to change**, and says "Saved. You can change this until pups are born."
   An approval field keeps **Ask to change**. One form can mix the two (§4.1).
3. **The server** (`familyActions.checkAction`) accepts `pref_change`, `listen`,
   `pause_request` and the new `unpause` as today, and marks each event
   `free: true | false` from the published `changes_free`. It refuses `unpause` with
   `not_allowed` unless the device published `unpause_allowed`.
4. **Her device applies it** (`planFamilyEvent`) and **checks the rule again against her
   records now**: a free change applies only if it's still free now. If a litter was marked
   whelped between the family's tap and her sync, the change becomes a request instead, and
   the family's page then shows "Waiting for [her name]". So the server's `free` mark is a
   hint for the family's page, never the decision.
5. **What she sees:** a free change is a line in the family's activity ("Changed their sex
   preference Male → Any on their status page, before pups were born") and in
   `pref_change_log` with `by: 'family'` (new value beside `breeder` / `request`), so the
   flip-flop history stays complete. No Today nudge. An optional digest/app alert line is
   Q4.

### 4.1 Mixed changes

One `pref_change` can carry several fields. Her device splits it: free fields apply and are
logged now, the rest become one `pref_change_request` holding only those fields. `listen`
and pause are their own events, so they're already separate.

### 4.2 When the phase flips

- **Pups born** (a litter set to `whelped`): every free change turns into approval (by her
  `after` settings) at the next projection push. Requests already waiting stay as they are.
  Free changes that already applied stand; the history shows them.
- **Last litter closed:** her `before` settings apply again at the next push. Requests still
  waiting stay waiting (she decides them); they aren't applied on their own.
- No Today nudge for a phase change. Her settings card says which phase it is (Q5 asks
  whether she wants a one-time note on Today).

## 5. New: ending a pause early

A family whose own pause is running (`paused_until` in the future) gets **End my pause** on
the status page when she has ticked **Let families ask to end a pause early**
(`unpause_allowed`). The grid's **Ending a pause early** row decides whether it applies on
its own or waits for her.

- New family action `unpause` (`FAMILY_ACTIONS`, `FAMILY_EVENT_KINDS`, `notify.ACTION_KINDS`
  as `request`).
- Free: her device sets `paused_until` to yesterday (in the kennel's day) and adds an
  activity line. Approval: an `unpause_request` on the entry, a Today nudge with Approve /
  Decline (`approveUnpauseRequest` / `declineUnpauseRequest`), on the entry page beside the
  others. New field `unpause_request` → `syncRegistry` **private**, like `pause_request`.
- It never touches a readiness hold. That ends by changing **Ready to buy** (its own row) or
  by answering "Ready now?".
- A pause request while paused (a new date) stays the `pause` row.

## 6. What families read

- **Policies** (`waitlistPolicies.js`): the Preferences and Pausing topics' default words say
  "Before pups are born you can change these yourself; once pups are born, [kennel] approves
  each change" (or today's words when nothing is free). `BASIS` for those topics gains the
  free/approval pattern, so changing the setting marks her policies changed, as other rule
  changes do.
- **Status page:** under the answers, one line naming the rule now ("Pups are on the ground,
  so changes need [kennel]'s OK").

## 7. Build steps, files and tests

1. `waitlistRules`: `pupsOnGround`, `changePhase`, `isChangeFree(config, kind, phase, entry,
   offers)`, defaults + `waitlistConfig` cleaning. Tests: phases for every litter status,
   archived, other kennel, open-turn safety net.
2. `waitlistProjection`: `changes_free`, `change_phase`. Tests in
   `tests/waitlistProjection.test.js`.
3. `cloud/src/familyActions.js` + `familyPages.js`: the `free` mark, `unpause`. Cloud tests.
4. `waitlistEvents` / `waitlistActions`: split free/approval, re-check now, `by: 'family'`,
   unpause and its request, approve/decline. Tests in `tests/waitlistEvents.test.js`,
   `tests/cloudWaitlist.test.js` (whelped between tap and sync → request).
5. `nudges.js` + `waitlist-entry.js`: the unpause request; the activity lines.
6. `kennel.js` Waitlist settings: the Family changes card.
7. `cloud/public/family/status.js`: Save vs Ask to change, End my pause, the rule line.
8. `waitlistPolicies.js`: words + `BASIS`.
9. Docs: End-State guide §29 (the config key, `unpause`, `unpause_request`, `by: 'family'`),
   Waitlist Spec §15.7/§15.9 **Modified** notes. `PRECACHE_URLS` only if a file is added
   (none planned).

**Built on `main`** (owner, 2026-11-19), then brought to `next` the usual way (merge `main`
into `next`). It needs a `CACHE_NAME` bump on `main` when it ships, asked for as usual.

## 8. Decisions (owner, 2026-11-19)

- **Q1. `sold` litters** count as pups on the ground; she closes the litter to reopen changes.
- **Q2. Litters off the waitlist** (`waitlist_off`) don't count.
- **Q3. Auto-approval after pups are born** is allowed, with the warning.
- **Q4. Hearing about free changes:** a digest line, no alert.
- **Q5. Phase change note:** a one-time Today line when the last litter closes.
- **Q6. Colors with matching off:** stay hidden (no recommendation was made; today's behaviour kept).
- **Q7. Per breed:** no; kennel-wide.
