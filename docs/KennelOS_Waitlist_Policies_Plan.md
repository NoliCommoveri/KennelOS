# KennelOS — Waitlist Policies: plan

> Status: **plan, not built** (2026-11-05; revised the same day with the owner's answers to
> Q1 and Q2). Where a breeder's waitlist policies live in KennelOS, how she writes them,
> where families read them (the public list, the application, their status page, her
> KennelPort website), and the application's "I've read the policies" box. Decisions
> marked **Open** still need the owner.

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
moment-specific texts stay where they are (Q4).

## 2. Where it lives

**Data:** `Kennel.waitlist_config.policies`, an ordered list `[{ id, heading, body }]`,
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
- **Start from common topics** (while the list is empty): adds the headings in section 2.1,
  each with an empty body and a hint. Headings only; she writes every word, nothing is
  invented in her name.
- Under the list: *"Your contract is the final word. Keep these in step with it."* and
  *"Applicants tick that they've read these (Application form)."*

### 2.1 The common topics: how her waitlist runs

Each hint names what families ask and, where it applies, **her own setting**, read live, so
what she writes matches what KennelOS does:

| Heading | Hint (her settings filled in) |
|---|---|
| **Application fee** | Is it refundable? Does it come off the price? *(Your settings: $300, credited toward the deposit.)* |
| **Your place on the list** | How order is kept: approval date, fee received, programs first. |
| **When it's your turn** | How long they have to answer *(you give 3 days)*, how a pick is made, what happens with no answer. |
| **Passing** | How many litters they may pass *(you allow 2)* and what happens after the last one. |
| **Pausing and readiness** | Pausing keeps their place; a later readiness answer holds offers until then. |
| **Deposits** | When it's due after a pick, refundable or not, what it holds. |
| **Removal from the waitlist** | What removes a family: no answer to a turn, passes used up, false information, conduct. Whether fees are kept. |
| **Backing out** | What they can expect if they back out *(the full words on Need to back out? stay hers in Backing out)*. |
| **The public list** | What others see (first name, last initial, preferences) and that contact details never show. |

The fee hint reads `fee_amount`, `fee_credit_policy` and `fee_credit_toward`; the turn hint
`respond_days` (and her open days); passing `max_passes`. A setting she hasn't set leaves
its part of the hint out.

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
   `POLICY_TOPICS` (2.1). Tests: cleaning, validation, defaults on an old config.
2. The locked `policies_read` question in `formQuestions` (3.1): present only with a policy,
   dropped otherwise, last, `link: 'policies'`. Tests: old saved forms with and without
   policies; deleting the last policy; a stored copy with no policies; required online,
   not on her typed-in form or CSV.
3. Shared editor (`assets/qaListEditor.js`) out of `waitlist-form.js`; the FAQ uses it
   unchanged. New file → `shared/sw.js` `PRECACHE_URLS`.
4. Kennel › Waitlist settings › **Policies**: editor, Start from common topics with live
   hints, `policies_updated` on save. Kels knowledge entry.
5. Today nudge (3.2) in `nudges.js`, with its test.
6. Projection: `kennel.policies`, `policies_updated` (absent when empty), and in the form
   section. Test: shape, absent when empty, kennels kept apart.
7. Family pages: list card, apply section with the linked box, status card and its three
   links. Browser-test with the local Worker (`cloud/tests/helpers/serve.mjs`) at phone
   width, with and without policies.
8. `/f/site` feed: `policies`; Kels Layer 1 entries.
9. Docs: End-State guide §29 (the field, the locked question, the group, the nudge, the
   pages), Waitlist spec cross-reference, `cloud/README.md` if it lists the feed shape,
   BUILD_LOG. Ask before the SW cache bump.

No migration and no new page.

## 6. Open questions

- **Q3 — Changed policies:** when she edits them, tell families already on the list (*"Our
  policies were updated Nov 5"* on their page until they open the card), or only the date
  on the card? Families who agreed at apply agreed to the earlier wording.
- **Q4 — Fee and back-out wording:** keep the fee refund line and back-out text as their
  own settings (recommended: they're shown at specific moments), or replace them with links
  to the matching policies?
- **Q5 — Lite:** Lite has no online waitlist pages, so nothing to show. Confirm Pro only.

Decided 2026-11-05 (owner): **Q1** use them on her KennelPort website, and let her add more
there (section 4). **Q2** a box on the application, "policies" linking back to them, never
shown or required until a policy exists, and a dismissible nudge on Today (3.1, 3.2). The
common topics are about how her waitlist runs, not general puppy policies (2.1).
