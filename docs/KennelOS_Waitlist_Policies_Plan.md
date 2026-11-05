# KennelOS — Waitlist Policies: plan

> Status: **built** (2026-11-05): KennelOS (End-State guide §29, *Her waitlist policies*) and
> KennelPort's side (section 4, its BUILD_LOG). Not built: Kels Layer 1 entries (the Family
> Help plan's Layer 1 isn't built yet). Where a breeder's waitlist policies live in KennelOS, how she writes them,
> where families read them (the public list, the application, their status page, her
> KennelPort website), and the application's "I've read the policies" box. Decisions
> are recorded in section 6.

## 1. What this is

Her **waitlist policies**: the rules of how her list runs, in plain words. The application
fee is non-refundable; what happens when it's your turn and you pass; what gets a family
removed from the list. Not her general puppy policies (health guarantee, spay/neuter):
those belong on her website (section 4).

Families need them before they apply and again at the moments that cost money (their turn,
the deposit, backing out). Today the pieces are scattered across settings that each answer
one moment:

| Today | Where she sets it | Where families see it |
|---|---|---|
| Application FAQ (`waitlist_config.application_faq`) | Application form page | The application only (`/f/form`, apply page) |
| Fee refund / credit (`fee_credit_policy`, `fee_credit_toward`) | Waitlist settings › Fees & payment | Their fee and deposit lines |
| Back-out text (`back_out_policy_text`) | Waitlist settings › Backing out | Their **Need to back out?** card only |
| Payment instructions, extras intro | Fees & payment; Public list & family pages | The cards that use them |

Nothing gathers the rules into one place a family reads and agrees to. This plan adds **one
ordered list of waitlist policies per kennel**, shown on every family page and on her
website, with a box on the application that says the family read them. The existing
moment-specific texts stay where they are (decided, Q4).

## 2. Where it lives

**Data:** `Kennel.waitlist_config.policies`, an ordered list `[{ id, heading, body, topic? }]`
(`topic`: the starter topic it came from, optional, 2.1),
default `[]`, plus `policies_updated` (`YYYY-MM-DD`, set when she saves a change).

- Same shape as `application_faq`, so the list editor, validation (heading and body both,
  or neither) and the families' expander look are shared, not rebuilt.
- In `waitlist_config` because everything the family pages show is set there, per kennel
  (each kennel its own policies), and the projection already reads it. A new key inside
  `waitlist_config` needs **no schema block, no table, no FK**; missing keys read from
  `WAITLIST_CONFIG_DEFAULTS`, so older backups and builds are fine.
- `waitlist_config` is already a `cloud` field (`syncRegistry.js`); policies are public text
  meant for families. Surfaced here as a privacy note: this text leaves her device on every
  publish, like the FAQ.

**Where she edits it:** a new group, **Policies**, in **Kennel › Waitlist settings**,
between *Fees & payment* and *Turns & offers*. Shown only while the waitlist is online
(`isWaitlistOnlineOffered()`), like *Backing out*: without the online list there's no page
to show it on, and no online application to agree on.

- Rows: heading + body, up/down, delete, **+ Add a policy**: the FAQ editor's controls,
  pulled out of `pages/waitlist-form.js` into a shared asset (`assets/qaListEditor.js`) and
  used in both places.
- **Start from common topics** (while the list is empty): adds section 2.1's five topics
  with suggested wording from her own settings, all editable, nothing published until she
  saves.
- Under the list: *"Your contract is the final word. Keep these in step with it."* and
  *"Applicants tick that they've read these (Application form)."*

### 2.1 The common topics: how her waitlist runs (the owner's, 2026-11-05)

**Start from common topics** adds these six, each with **suggested wording built from her
own waitlist settings**, read at the moment she taps it, for her to edit. Nothing is
published until she saves, and nothing is said that her settings don't do: a sentence
whose setting is off or blank is left out. `[Kennel]` is her kennel's name; `{…}` is read
from `waitlist_config`. Business days are her open days (`open_days`, `closed_dates`);
with every day open the wording says "days".

**1. Applications.** Approval is at her discretion; with a fee, no name shows on the list
until the fee is marked received.

> Every application is reviewed, and approval is at [Kennel]'s discretion.
> *With a fee (`fee_amount` > 0):* Once you're approved, your ${fee_amount} application fee
> *(`fee_due_days` set:)* is due within {fee_due_days} days, and it must be received and
> marked received by us before your name appears on the waitlist. Your place in line counts
> from the day your fee is received.
> *No fee:* Your place in line counts from the day you're approved.

**2. Preferences.** Families whose preferences match no available pup in a litter are
skipped for it, without an offer, so every eager family is offered as quickly as possible.

> So that every family on our list gets their offer as quickly as possible, a family whose
> preferences don't match any available puppy in a litter is skipped for that litter. You
> won't be offered a puppy from it, and being skipped this way never counts as a pass.
> Please choose your preferences carefully: a preference that rules out most puppies can
> mean a long wait. You can ask to change them from your status page.
> *(`color_matching` on:)* Color preferences count too.

**3. Passes and not responding.** How many passes, what happens at each, and a missed
deadline.

> When it's your turn, you can pass on a litter and keep your place.
> *(`max_passes` = 1:)* Passing removes you from the waitlist.
> *(`max_passes` ≥ 2:)* You can pass {max_passes − 1} time(s); your {max_passes}th pass
> removes you from the waitlist.
> *(`no_response_counts_as_pass` on:)* Not responding by your deadline counts as a pass.
> *(off:)* If you don't respond by your deadline, the turn moves to the next family and
> [Kennel] will be in touch.
> When a family is removed, any application fee is not returned and re-joining means a
> new application. *(Only when `fee_credit_policy` is non-refundable; otherwise the fee
> sentence is left out, since her fee setting says otherwise.)*

**4. Picking your puppy.** One deadline covers both the pick and the deposit; what happens
if it's missed.

> When it's your turn you'll have {respond_days} business days, until the end of the day
> on your deadline ({time zone} time), to choose your puppy **and** have your deposit
> received by [Kennel]. Choosing without the deposit received by then doesn't hold the
> puppy.
> *(`no_response_counts_as_pass` on:)* If both aren't done by your deadline, it counts as a
> pass and the turn moves to the next family.
> *(off:)* If both aren't done by your deadline, the turn moves to the next family.

**5. Pausing.** A paused family is not offered pups and is skipped, even if they change
their mind, unless they tell her before their turn; the "When will you be ready?" answer
works as a pause.

> You can pause from your status page when you're not ready for a puppy. While you're
> paused you will **not** be offered puppies: every litter that comes up during your pause
> skips you, and you keep your place. If you change your mind, you must let [Kennel] know
> and have your pause ended **before** your turn comes up. A litter that has already
> skipped you won't be offered to you afterwards.
> Your answer to "{ready_timing question's label}" works the same way: anything but
> "ASAP" pauses you until then.

The fourth sentence is the owner's default (no going back once skipped); the hint under
it says *"If you allow a skipped family back in after their pause, say so here."*

**6. Business days and closed dates.** Which days count toward a deadline, and that her
closed dates don't.

> Deadlines on our waitlist count only the days we're open for business:
> *(`open_days` set:)* {Monday through Friday}. *(Weekdays are named as a range where they
> run together, else listed: "Monday, Wednesday and Friday".)*
> *(every day open:)* every day of the week, including weekends.
> We also close for holidays and other dates through the year; those days don't count
> either, so a deadline that would land on one moves to our next open day. Your status
> page always shows your exact deadline.

- **Her closed dates aren't written into the text** (they change through the year and the
  words would go stale). On the family pages, a policy started from this topic shows a
  live line under her words: *"Upcoming closed dates: Dec 24–26, Jan 1"*, from the
  projection's `closed_dates` (already published), shown while any are ahead and left out
  when none are.
- To know which policy that is, a row added from a topic keeps `topic: 'days'` (each
  starter row keeps its topic id; an optional field, ignored when absent). If she deletes
  that row, no closed-dates line shows anywhere.
- Hint: *"From your settings: open Monday–Friday; 3 closed dates ahead. Change them in
  Turns & offers."*

**Not in the starter set**, though she can add any heading: backing out (her own
**Backing out** text, Q4), the fee's refund (her **Fees & payment** settings, Q4), and the
public list.

**Hint wording** (grey, under each body while she edits): what families most often ask
about it, and the settings it read, e.g. *"From your settings: 3 business days, 2 passes,
no response counts as a pass."* If she later changes a setting the text quoted, the group
shows *"Your settings changed since you wrote this: passes are now 3"* beside that
policy, without changing her words.

## 3. Where families read it

**Published:** `projection.kennel.policies` (and `policies_updated`) when the list is
non-empty, absent otherwise; also in the form section, for the application. The server
(`familyPages.js`) passes it on unchanged to:

1. **Public list** (`/list/<public_id>`): a collapsible card **Our policies** (`id="policies"`)
   under the intro and Apply button, before Available / Upcoming and the list, closed,
   each policy its own expander. Visitors see it without signing in.
2. **Application** (`/f/form`, apply page): **Our policies** (`id="policies"`) after the FAQ,
   same expanders, and the box in section 3.1.
3. **Status page, My page**: a **Policies** card, closed, near the end (after Pickup /
   Extras / Need to back out?, before Messages), with *"Updated Nov 5"* when
   `policies_updated` is set. Short links at the moments that cost money open that card at
   the matching policy: their turn and pick, the deposit card, and **Need to back out?**
   (its own `back_out_policy_text` stays first, then *"Our full policies"*). Matched by
   heading words (`turn`, `deposit`, `back`); none matched = the card's top.
   **When she's changed them** (decided, Q3): a banner at the top of My page, *"[Kennel]
   updated their waitlist policies on Nov 5. Read what changed."*, the link opening the
   Policies card. Shown while `policies_updated` is later than both the family's
   `applied_date` (they agreed to today's wording) and the date this browser last opened
   the card (`localStorage` `kos-policies-seen:<public_id>`, wrapped in try/catch: with
   storage blocked the banner just stays). Opening the card, or **Got it** on the banner,
   records it. Not on the public list (visitors haven't agreed to anything).
4. **Her website feed** (`/f/site`): included (section 4).
5. **Kels (Family Help plan):** each policy a searchable help entry, `when: anyone`, after
   the cheat sheet and her FAQ, so "is the fee refundable?" finds it.

**Not shown:** `back_out_policy` rows (her private outcome rules) never leave her device.

### 3.1 "I've read the policies" on the application (decided)

A **locked question**, `policies_read`, added by the form itself, like City / state under
her distance rule (`LOCATION_LOCK`, `locationRuleOn`):

- **Present only while she has at least one policy.** `formQuestions(config)` appends it
  when `waitlistPolicies(config).length > 0` and leaves it out otherwise. A form she saved
  before this existed gets it the moment she adds her first policy; deleting every policy
  takes it away again. **With no policies, applicants never see it, nothing requires it,
  and every form, old or new, works exactly as today.** A stored copy of it in
  `form_questions` with no policies is dropped on read, so nothing can leave a required
  box with nothing to read behind it.
- **Type `checkboxes`, one option, required:** *"I've read and agree to the policies."* Both
  application renderers already draw `checkboxes` (the apply page and KennelPort's
  `kosQuestion`), so an older KennelPort build still shows a working box, just without the
  link. Its answer is kept in `entry.application.policies_read` with the wording in
  `application_questions`, as every answer is.
- **The word "policies" is a link** back up to the **Our policies** section on the same
  page (`#policies`, which opens it). The question carries `link: 'policies'`; a renderer
  that knows it wraps the first "policies" in the label (or the option) in that link; one
  that doesn't shows plain text. She may reword the label; if her wording drops the word,
  *"Read our policies"* is added after it as the link.
- **Placed last**, after the public-list notice, just above Send.
- **Her own typed-in applications** (Waitlist › Add, `waitlist-entry`): shown, **not
  required** (she's entering for them); CSV import never requires it.
- On her side the answer shows on the family's application as **Read the policies ✓** with
  the date it was sent.

### 3.2 A nudge on Today (decided)

For each of her kennels with the waitlist online and **no policies**, Today's **Nudges**
shows *"Add your waitlist policies"*, with *"Applicants will tick that they've read them.
Until you add one, your application doesn't ask."* Its link opens Kennel › Waitlist
settings › Policies.

- Built in `shared/data/nudges.js` (`computeNudges`), key `waitlist-policies:<kennel id>`,
  so **Dismiss** and **Snooze** work as they do for every nudge (`nudgeState.js`).
- It goes away by itself once a policy exists; it never blocks anything.
- Kels's *Set up my waitlist* gets a Policies step later (not this build).

## 4. KennelPort (decided)

Her KennelOS **waitlist policies are used on her website**, and she can **add her own
policies there beyond them** (health guarantee, spay/neuter, take-back…).

- The website feed (`/f/site`) carries `policies`. KennelPort's **Policies** page shows two
  parts: **her website's own policies** (the `expanders` she edits in the Site Manager, as
  today) and **Waitlist policies** (from KennelOS, in the same expander look, under their
  own heading).
- In the Site Manager the waitlist part shows read-only with *"From KennelOS. Change them
  in KennelOS › Waitlist settings › Policies"*; her own part stays fully editable. One
  source for each, so nothing drifts.
- KennelPort's waitlist page draws the application from the feed; its **policies** link
  goes to the waitlist part of the Policies page (or an expander on the waitlist page; the
  KennelPort side decides). Sites without KennelOS keep only their own list.
- Built on the KennelPort side after KennelOS publishes them (KennelPort plan 3.8 /
  `feed.js`); a Policies page change is a site template change there (`ASSET_VERSION`,
  ask first).

## 5. Build steps (KennelOS)

1. `WAITLIST_CONFIG_DEFAULTS.policies = []`, `policies_updated: null`;
   `waitlistPolicies(config)` and `validatePolicies` in `waitlistForm.js` beside `formFaq`;
   `POLICY_TOPICS` and `policyStarter(topic, config, kennel)` (2.1), pure, one test per
   setting branch (fee or none, 1 pass or more, no-response on or off, open days or all,
   weekdays as a range or a list).
   Tests: cleaning, validation, defaults on an old config.
2. The locked `policies_read` question in `formQuestions` (3.1): present only with a policy,
   dropped otherwise, last, `link: 'policies'`. Tests: old saved forms with and without
   policies; deleting the last policy; a stored copy with no policies; required online,
   not on her typed-in form or CSV.
3. Shared editor (`assets/qaListEditor.js`) out of `waitlist-form.js`; the FAQ uses it
   unchanged. New file → `shared/sw.js` `PRECACHE_URLS`.
4. Kennel › Waitlist settings › **Policies**: editor, Start from common topics with the
   starter wording, the hints and *"Your settings changed since you wrote this"*,
   `policies_updated` on save. Kels knowledge entry.
5. Today nudge (3.2) in `nudges.js`, with its test.
6. Projection: `kennel.policies`, `policies_updated` (absent when empty), and in the form
   section. Test: shape, absent when empty, kennels kept apart.
7. Family pages: list card, apply section with the linked box, status card with its
   three links and the "updated" banner, and the live closed-dates line under a `days`
   policy. Browser-test with the local Worker (`cloud/tests/helpers/serve.mjs`) at phone
   width, with and without policies.
8. `/f/site` feed: `policies`; Kels Layer 1 entries.
9. Docs: End-State guide §29 (the field, the locked question, the group, the nudge, the
   pages), Waitlist spec cross-reference, `cloud/README.md` if it lists the feed shape,
   BUILD_LOG. Ask before the SW cache bump.

No migration and no new page.

## 6. Decisions

Decided 2026-11-05 (owner): **Q3** a banner on families' pages when she changes them (3,
status page). **Q4** the fee refund line and the back-out text stay their own settings.
**Q5** Pro only (Lite has no online waitlist pages). Also: **Q1** use them on her KennelPort website, and let her add more
there (section 4). **Q2** a box on the application, "policies" linking back to them, never
shown or required until a policy exists, and a dismissible nudge on Today (3.1, 3.2). The
common topics are about how her waitlist runs, not general puppy policies (2.1).
