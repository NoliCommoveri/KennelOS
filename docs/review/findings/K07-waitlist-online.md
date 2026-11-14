# K07 — The waitlist online: applications, the public list, family pages

Reviewed: `shared/data/waitlistProjection.js` (745), `waitlistForm.js` (465), `waitlistCrypto.js` (77),
`cloud/cloudWaitlist.js` (655; take-in, events, publish), `waitlistInbox.js` (98),
`waitlistPolicies.js` (181), `programSuggest.js` (76), `doNotSell.js` (81) + `doNotSellRepo.js`,
`portalFeed.js` (339), `portalFeedSync.js` (254), the portal parts of `kennelportLink.js` /
`kennelportLinkStore.js`, `cloud/src/familyPages.js` (1046), `cloud/src/familyActions.js` (auth
and pending, 1–80), `cloud/public/family/` `apply.js`, `list.js`, `status.js` (policies, errors,
load), `common.js` (policies, loadError), `seal.js`, `embed.js`, `apply.html`; the do-not-sell
surfaces in `pages/waitlist-entry.js`, `waitlist.js`, `contact.js`, `contacts.js`,
`do-not-sell.js`; the policies save in `pages/kennel.js`; `qaListEditor.js`; `waitlist-form.js`
(program links); `cloud/src/retention.js` (inbox rows).
Contract read: Review Plan §0, §0a, K7; Waitlist Policies Plan §2–§3; the module headers above
(which carry the W2 / Spec decisions they implement).
Verified by: baseline at `58244f2` — `node --test` **1649 pass**, `cd cloud && npm test` **305 pass**,
`node build/assemble.mjs` succeeds (green; counts up from the plan's 1639 / 303). Scratch scripts in
my scratchpad: `feed-returned.mjs` (the portal feed across a sale's return and re-sale);
`server.mjs`, a mock of the family Worker that serves `cloud/public/family/*` and answers `/f/*`
from the real `buildProjection` → `listView` / `statusView` / `formView`; Playwright walks of
`/list`, `/apply` and `/s/` at 320 px and on an emulated iPhone SE (apply → code → status page →
Ask to change), plus one run against a malformed form key (sealing failure). Name-masking checked
with `publicName` / `privateName` directly.

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S1 | shared/data/portalFeed.js:153 | A **returned** sale stays a live placement in the portal feed, collects the pup's next home's health records, and is never retracted | verified |
| 2 | S2 | shared/data/portalFeedSync.js:85 | Portal "facts" rewrite her records with no validation and no word to her: any sale of the kennel → Delivered, a dog → deceased on any date | verified |
| 3 | S2 | shared/data/kennelportLink.js:213 | Disconnecting her last linked device leaves `kennelport_portal` on the kennel forever: status pages keep offering a portal and withhold Companion | verified (code) |
| 4 | S3 | cloud/src/familyPages.js:375 | A policy over 5,000 characters (or past the 30th) is silently cut on every family surface; her editor has no limit | verified |
| 5 | S3 | cloud/public/family/apply.js:254 | An application records nothing about which policies it agreed to; she can't show a family the wording they ticked | verified |
| 6 | S3 | cloud/public/family/apply.js:269 | When sealing fails the applicant sees nothing: the button resets, no message | verified |
| 7 | S3 | cloud/public/family/apply.html:37 | The code step lives only in the open tab: no way to fix a mistyped email, and a phone that reloads the tab leaves the "enter this code on the application page" email with nowhere to go | verified |
| 8 | S3 | shared/data/waitlistRules.js:1470 | "Smith Family" lists publicly as **Smith F.**; "Smith, John" as **Smith, J.**: the masking shows the surname | verified |
| 9 | S3 | shared/pages/sale.js:65 | The do-not-sell warning is missing where she sells: the Sale form and Side sale | verified |
| 10 | S3 | cloud/src/familyPages.js:977 | A family session survives **New link** and an email change; `/f/session` hands the new link to every browser already signed in | verified (code) |
| 11 | S3 | cloud/src/familyPages.js:60 | Shared limits: one kennel-wide verify bucket that strangers can drain (and the 429 blames "your connection"); 5 applications per IP per hour at a puppy event | suspected |
| 12 | S3 | cloud/public/family/status.js:839 | "Read what changed" shows the whole policies with nothing marked; families past `active` (a placed family with an open sale) never get the banner | verified |
| 13 | S3 | shared/data/cloud/cloudWaitlist.js:175 | Applications she deleted come back on a new device: acked inbox rows live until a vault-keyed backup (forever without a vault) and first take-in recreates them | verified (code) |
| 14 | S4 | shared/data/portalFeedSync.js:152 | Each linked device sends its own feed from its own records every hour; a device that is behind re-sends what another device voided or removed | suspected |

Counts: S1 1 · S2 2 · S3 10 · S4 1.

---

## 1. A returned sale stays live in the puppy portal, and inherits the next home's vet visits  (S1, verified)

**Where** `portalFeed.js:153-156` (`voidedOf` knows `voided` and `cancelled`, not `returned`),
`:252-253` (`keep` for 60 days after the sale's last edit), `:279` (a family not kept is skipped),
`:296` (`removed` only lists what is no longer in `now`), and `:163` (`healthOf(pup.id)` reads the
dog's events, not the sale's period).

**Scenario** (`feed-returned.mjs`) The Ables sign for Biscuit; the feed sends their placement. On
Oct 1 Biscuit comes back and she marks the sale **Returned**. On Oct 5 she sells him to the Bakers
and on Oct 6 logs *"Vet visit: ear infection"* on him. The next feed carries:

```
Bo Baker  [{"id":"sB","voided":null,"health":["Vet visit: ear infection"]}]
Ann Able  [{"id":"sA","voided":null,"health":["Vet visit: ear infection"]}]
removed: []
```

The Ables' placement is still live (`voided: null`), and their portal now shows Biscuit's vet visit
at his new home. Seventy-five days on, the Ables are simply no longer sent (`fam.keep` false) — but
`placement:sA` and `family:cA` are still in `now`, so nothing goes in `removed` either. The portal
keeps the Ables' last copy: a pup that is not theirs, shown as theirs, indefinitely.

**Why it matters** Wrong data shown to a family (the S1 line), and one family seeing records made
for another. Returns are the case where the breeder most needs the portal to stop talking.

**What I'd do** Treat `returned` like `voided` in `voidedOf` (KennelPort's reasons have `other`),
cut `healthOf` at the sale's end date for a released sale, and put a released placement in
`removed` once it ages out instead of leaving it. A test with a return and a re-sale of one pup.

## 2. Facts from the portal rewrite her records unchecked and unseen  (S2, verified)

**Where** `portalFeedSync.js:85-133` (`applyPortalFacts`), called at `:199-203`; the result of
`syncPortalFeeds` is dropped at `app.js:223` (`.catch(() => {})`, nobody reads `applied`).

**Scenario** The answer to a feed send carries `facts: [{ id, picked_up_at, microchip, died_on,
portal_only, family_id }]`. For each, the only check is that `id` is a sale of this kennel —
not that it was ever in the feed, not its status, not who the buyer is:
- `picked_up_at` (anything `Date.parse` accepts, past or future) rewrites or **creates** a pickup
  event on the pup and sets the sale **Delivered** — on a `deposit_pending` sale with no signed
  contract just the same. For a *returned* sale (finding 1) the Delivered step is skipped but the
  pickup event is still written, now on a pup that belongs to someone else.
- `died_on` (any `YYYY-MM-DD`, future or before birth) marks the dog **deceased**.
- `microchip` overwrites `microchip_id`.
- `family_id` (any string) is pushed onto `home`, which switches that family's status page to
  "portal only" (`portalEntryView`).

None of it makes an event, an activity line or a toast; she finds a dog marked deceased and no
trace of why. The header says these are facts "she made", but they arrive over the network and
are applied on the next page load of any device linked to the site.

**Why it matters** The plan asks whether a bad or hostile answer can overwrite her records: it
can, and silently. A bug on the KennelPort side (an off-by-one sale id, a test fact) changes a
pup's life status and a sale's money state in KennelOS.

**What I'd do** Apply a fact only for a placement this device sent (`portal_known`) and whose sale
is in a state the fact fits; bound the dates (`died_on` ≤ today and ≥ birth, `picked_up_at` within
the sale's window); write a history line per fact; and show `applied` once (a Today line or
toast) so she can see and undo.

## 3. Disconnecting the last device leaves the portal on the kennel  (S2, verified from code)

**Where** `disconnectWebsite` (`kennelportLink.js:213-223`) and the `not_linked` handlers at
`:186`, `:290` clear the device link only; `dropPortal` (`portalFeedSync.js:139`) is called only
from `sendPortalFeed`, which never runs again once no device is linked. `kennelport_portal` is a
cloud field (`syncRegistry.js:105`) read by `portalOn` → `waitlistProjection.js:600-605, 735-742`.

**Scenario** She disconnects KennelOS from her website on her one linked device (the card's
**Disconnect**; KennelPort treats the last device's stop as an Unlink). `kennel.kennelport_portal`
stays. Every publish keeps `server.portal` and each signed family's `portal` view, so their status
pages keep **Open your puppy portal** (for a family past pickup, *only* that link,
`statusView` → `portal.only`), and Companion link requests stay hidden (`companionView` returns
`link: false`). Whether the one-tap link still lands anywhere is KennelPort's side; on this side
nothing will ever take it off.

**What I'd do** On Disconnect of the last linked device for a kennel, clear `kennelport_portal`
(or have the portal ask the site's facts from any device that publishes the waitlist). Say on the
card that the families' portal button goes away.

## 4. A long policy is cut short for families, silently  (S3, verified)

**Where** `familyPages.js:375-380` (`policiesOf`: 30 policies, heading 200, body 5,000 characters);
the editor (`qaListEditor.js:26`, a textarea with no `maxlength`) and `validatePolicies`
(`waitlistForm.js`) impose nothing.

**Scenario** She pastes her refund policy, 6,200 characters, whose last sentence promises refunds
within 7 days. On `/f/list`, `/f/form` and the status page (mock server, real `policiesOf`) the body
is 5,000 characters and the last sentence is gone. The application asks the family to tick "I've
read and agree" to the cut version; she sees the whole text in her app. Same for a 31st policy.

**What I'd do** Enforce the server's limits in the editor (a counter, refuse Save past them), or
raise them; never cut in silence.

## 5. Which policies did this family agree to?  (S3, verified)

**Where** `apply.js:254` seals `{ answers, prefs, private_request?, sent_at }` — no
`policies_updated`; `policies_read`'s answer is the option text and `application_questions` keeps
the label (`waitlistForm.js` `snapshotQuestions`), never the policy wording. `kennel.js:754` keeps
one `policies_updated` day, overwritten on each save.

**Scenario** A family applies Nov 5 morning; she rewrites the deposit policy Nov 5 afternoon and
again Nov 20. In March they back out and dispute the deposit. On her side the application says
*Read the policies ✓* and a date; nothing says which text, and the only date she has is Nov 20.
An applicant on her KennelPort site's form (fed from `/f/site`, cached 5 minutes here plus the
site's own cache) can tick a version she replaced minutes earlier.

**What I'd do** Seal the `policies_updated` (or a short hash of the policies) the page showed into
the application and show it on the family's page; keep earlier wordings when she saves a change.
A design decision for the owner — surfaced, not prescribed.

## 6. A sealing failure is invisible to the applicant  (S3, verified)

**Where** `apply.js:250-271`: `seal()` runs inside `try { … } finally { … }` with no `catch`.

**Scenario** Run against a malformed form key (the mock's first run): the applicant fills the
form, taps **Send my application**, the button reads *Sending…*, then *Send my application* again.
No message; the console has `InvalidCharacterError: Failed to execute 'atob'`. The same happens in
any browser where `crypto.subtle` is missing (an old in-app browser) or the key import fails.
Nothing reached the server, so she never knows either.

**What I'd do** Catch around the seal and say so in `form-problems` ("Your browser couldn't lock
your answers; please try another browser"), keeping the answers on screen.

## 7. The confirmation step can't be corrected or recovered from the form  (S3, verified)

**Where** `apply.html:37-46`, `apply.js:164-200` (`showConfirm`).

**Scenario** On a phone, Dana types `dana@exmaple.com`, writes three long answers and sends. The
confirm card says *"We sent a 6-digit code to dana@exmaple.com"* — there is no way back to fix it:
**send a new code** goes to the same wrong address, and the form is hidden. The only path is to
reload and retype everything; the unconfirmed copy is dropped after two days
(`retention.js:153-156`). Separately: she switches to her mail app, iOS discards the Safari tab,
and the email says *"enter this code on the application page"* — which now shows a blank form,
no code box. (The list page's **See Your Details** would confirm it, `familyPages.js` `/f/code`
finds the unconfirmed row, but nothing tells her that.)

**What I'd do** A **Wrong address? Change it** link that shows the form again with the answers
kept; and on `/apply`, a small "Already applied? Enter your code" box (or point the email at the
list page's sign-in).

## 8. Public names show the surname for common contact-name shapes  (S3, verified)

**Where** `waitlistRules.js:1470` (`publicName`: first word + initial of the last word) and
`privateName` below it; `entryName` uses the contact's name once she links one.

```
"Smith Family"       → Smith F.        | private: S**** F
"Smith, John"        → Smith, J.       | private: S***** J
"Ortiz-Lopez Family" → Ortiz-Lopez F.
"The Smith Family"   → The F.
"Dr. Jane Smith"     → Dr. S.
```

**Scenario** Breeders often name contacts "Smith Family" or "Last, First". The application's
notice tells families only their first name and last initial appear; the public list (and the
embed, and the website feed, which all use the same rows) shows the full surname to anyone. A
family who asked to list privately and was approved still shows the initial of what is in fact
"Family".

**What I'd do** Build the public name from the application's own name when the contact name
looks like a household or "Last, First", or show her the public form of the name when she links
the contact (the approve dialog already renders `publicName`; it could always render it).

## 9. No do-not-sell warning where she actually sells  (S3, verified)

**Where** The warning (`doNotSellWarning`) appears on the waitlist list (`waitlist.js:97`), the
family's page and its Approve dialog (`waitlist-entry.js:810-891`), and the contact page. It is
absent from the **Sale** form (`sale.js:65` loads every contact, listed ones included, with no
flag) and from **Side sale** (`sideSaleUI.js:26-37`, no listing read).

**Scenario** She lists Jane Doe after Jane was approved (or Jane is a contact who never applied).
Months later she opens Sale › New, picks Jane from the buyer list — Jane is hidden from Contacts
but present here — and saves. No warning anywhere on that path. Same for Sell to a waitlist
family.

**What I'd do** Run `doNotSellMatches` on the chosen buyer (contact id, email, phone) in the Sale
form and the Side sale modal, with the same "only a warning" line. The "possible" wording
("May be on your do-not-sell list … (similar name)") reads as a caution, not an accusation — fine
as is.

## 10. A family's signed-in browsers outlive New link and an email change  (S3, verified from code)

**Where** `/f/session` (`familyPages.js:977-987`) returns the entry's **current** token;
`familyFor` (`familyActions.js:44-60`) authorises by the session's entry. Sessions are deleted only
by expiry (90 days) or unpublishing the whole list (`waitlist.js:198`). `replaceStatusToken`
(`cloudWaitlist.js:113`) changes only the token; the confirm says *"Their current link stops
working"*.

**Scenario** A couple on her list separate; she changes the entry's contact email to one partner
and taps **New link**. The other partner, signed in on their phone last month, opens the list page:
`/f/session` gives them the new link, and they can still Pass, Leave the list or Back out for up to
90 days. Nothing in her app can sign them out.

**What I'd do** New link (and a change of the family's email) should end that entry's sessions —
or offer "Sign them out everywhere" beside New link — and the confirm should say what it does.

## 11. The verify and apply limits are shared in ways families pay for  (S3, suspected)

**Where** `familyPages.js:58-61, 937-941, 1012-1014`; `common.js:98`.

**Scenario** (a) `verifyPerHourPerKennel: 300` is one bucket for every visitor to a kennel. Thirty
addresses × 10 wrong codes an hour exhaust it, and every real family signing in that hour gets
*"Too many requests from your connection"* — not their connection. (b) The same bucket is the guess
budget: someone who knows one family's email can request a code every 20 minutes
(`codesPerHourPerEmail: 3`) to keep one live ~75% of the time, and at 300 guesses an hour has about
a 16% chance a month of landing it — a session that can Pass or Leave for that family (who would,
to be fair, receive 72 code emails a day). (c) `applicationsPerHourPerIp: 5`: at a puppy event with
one Wi-Fi (or a carrier NAT), the sixth family gets the same "your connection" message.

**What I'd do** Count wrong guesses per code (burn a code after N wrong tries at its kennel) rather
than leaning on a kennel-wide bucket; word a kennel-wide 429 as "busy, try again shortly"; raise
or reshape the per-IP apply limit.

## 12. The policies banner can't say what changed, and skips placed families  (S3, verified)

**Where** `status.js:839-843`; `familyPages.js:629-631` returns before `applied_date` is copied for
any status outside applied/approved/active.

**Scenario** The banner's **Read what changed** opens the whole Policies card (my mock: two
policies, nothing marked). A family placed with a deposit paid (status `placed`, open sale, the
one most affected by a back-out policy change) never sees the banner, because `f.applied_date` is
absent from their view. Two edits on the same day as an application don't show either (`at <=
f.applied_date`, day granularity).

**What I'd do** Mark the policies whose wording changed since the family's date (her device knows
the old text at save time), call the button "Read our policies" until it can, and pass the date
through for placed families with an open sale.

## 13. Deleted applications come back on a new device  (S3, verified from code)

**Where** `cloudWaitlist.js:148-189` (`takeInApplications`: a device with `inboxFetchedAll` unset
reads every confirmed inbox row, acked too, and creates an entry for any id it doesn't have);
`retention.js:142-146` deletes acked rows only after 30 days **and** a committed snapshot with a
`vault_key_id` created after the ack.

**Scenario** Three spam applications arrive; she deletes them (entry › Delete, allowed with no
blockers). She has backups but no private vault. Next spring she sets up KennelOS on a new phone
(or a reset browser): the first take-in recreates all three as `applied`, along with every other
application she ever hard-deleted. With a vault the window is 30 days plus the next backup.

**What I'd do** Remember deletions (a small "dismissed inbox ids" list riding the backup), or have
Delete on an online application tell the server to drop the row.

## 14. Two linked devices send two feeds  (S4, suspected)

**Where** `portalFeedSync.js:152-182`: each device keeps its own `portal_known` / `portal_sent`
(`kennelportLinkStore.js`, device-only) and force-sends once an hour on opening.

**Scenario** Her phone and laptop are both linked; live sync is off (or the laptop hasn't pulled
yet — the first send is 4 seconds after load). She voids a sale on the phone; the phone sends it
voided. The laptop opens, still holding the open sale, and force-sends it as live; the portal
flips back until the phone's next send. I did not confirm how KennelPort merges two feeds, so this
is suspected.

**What I'd do** Send the feed only from the device that does the waitlist's server work (the same
rule `serverWork.js` already applies), or wait for a sync pull before the opening send.

---

## Notes, not findings

- **Item 1, field by field.** The projection is allow-listed throughout, and the public list,
  the embed (`embed.js` frames `/list` and `/apply`, CSP-gated by `frameAncestors`) and the website
  feed (`siteView` = `listView` + the form) all draw from `publicRows`/`policiesOf`/`formView`, so
  no surface shows more than another. The status page adds only the family's own entry; `email`
  is never in it; `sameFamilyIds` links records by email only. Things a breeder may not expect,
  each by her own switch and so not findings: `skipped_until` (a paused family's end date) on the
  public list with `public_show_paused`; listen-only parents by call name in "Wants" ("Not from
  Juniper"); "A***** K" giving away first-name length; the "Currently deciding" row keeping its
  number, sex and date, so yesterday's list names today's decider (decided 2026-10-10).
- **Program links never leave her device.** `formSection` maps questions field by field
  (`waitlistProjection.js:315-318`), so `program_link` and `source_header` are dropped; the public
  row carries only `{icon, about}` and the server re-checks both (`familyPages.js:303-309`).
  An archived or deleted program is skipped by `programSuggestions`; the editor keeps an archived
  one selectable and labelled. The "No" (`program_suggestions_declined`) is a private field that
  rides live sync sealed, so it follows her across synced devices.
- **Do-not-sell never reaches a projection, a family page, the portal feed or the website**: no
  module on those paths imports it; `syncRegistry` has it `rows: NONE`; it is in her own backup
  file like every table. A merge (`recordMerge.js`) re-points `contact_id`, so merging a listed
  contact into an unlisted one hides the kept contact from Contacts without a word — worth one line
  in the merge preview.
- **Portal feed allow-list holds.** No amount, family phone or postal address leaves
  (`feed-returned.mjs` checks every family object for price/deposit/amount/phone/address keys: none);
  the vet's phone and address go, as intended. A vet visit's *title* goes as its name — free text
  she may have used for more than "Vet visit".
- **K1 asked** what a family's page does with an `eligible_dog_ids` entry for a hard-deleted pup:
  `statusView` filters the offer's pups against the litter's available pups, so it simply drops
  out (mock: a `deleted-pup` id in the offer, two pups shown). If every eligible pup were deleted
  the turn card would say "Below are the puppies available" over an empty list.
- **Key rotation mid-form** gets a clear message (`form_changed`, "copy any long answers first"),
  but the family must reload and retype; re-fetching `/f/form` and re-sealing the answers already
  on screen would spare them.
- **Phone.** `/list`, `/apply` and `/s/` at 320 px and iPhone SE: no sideways scroll, no console
  errors, a 60-character kennel name and a 46-character family name wrap cleanly; the Ask to
  change form and an unchanged submit ("That's the same as your answers now.") work.
- On staging without Turnstile, `globalThis.turnstile` is the `<div id="turnstile">` (named window
  access), so `apply.js:268`'s `turnstile.reset` throws after an error message is shown. Harmless
  in production, where the script defines it.
- `/f/list` is cached 60 s and `/f/site` 300 s, so after a policy edit the public list can lag a
  minute and her website five-plus; the application (`/f/form`, no-store) and the status page are
  current as soon as her backing device publishes.

## Coverage gaps I found (tests that should exist)

- `portalFeed`: a sale **returned** after being sent, and the same pup re-sold — the old placement
  should be voided/removed and must not carry the new home's health records (finding 1).
- `portalFeedSync.applyPortalFacts`: a fact for a sale never in the feed, a future `died_on`, a
  `picked_up_at` on a deposit-pending sale — all refused (finding 2).
- Disconnecting the last linked device clears `kennelport_portal` (finding 3).
- `policiesOf` vs the editor: a policy past 5,000 characters is either refused at Save or published
  whole (finding 4).
- `apply.js` submit with `seal` rejecting shows a message (finding 6).
- `publicName` on "Smith Family" / "Last, First" (finding 8).
- `takeInApplications` with `all` set must not recreate an entry she deleted (finding 13).

## What I did not get to

- `pages/waitlist-publish.js`, `applications-report.js`, `assets/waitlistSetupUI.js`,
  `waitlistOnlineUI.js`, `waitlistApplicationForm.js`, `jotformMatch.js`, `companion-view.html`:
  not read.
- `cloud/src/waitlist.js` beyond the inbox read/ack and the publish's token handling, and
  `familyActions.js` beyond `familyFor` / `pendingFor`: the per-action validation of the 18 family
  actions is unreviewed (much of it is K6/K8's turn and request logic).
- Item 5 (her inbox): the approve dialog's contact choice and decline (a status change, never a
  delete) were read; an application matching two contacts was not exercised.
- Item 7's "starter wording that contradicts her policy": `basisChanges` covers the six starter
  topics; whether `backOutPolicyText` (shown first on Need to back out?) can contradict a
  back-out policy she wrote was not checked.
- The KennelPort half of `/f/site`, `/f/apply`, `/f/verify` from her website, and the portal's
  handling of `removed` / `voided`: the KennelPort review's.
