# KennelOS — Duplicate applications: plan

> Status: **built** (2026-11-08; End-State guide §29 *Duplicate applications*, §10, §33). One
> family applied twice to the same waitlist (maybe with a different spelling, email or phone).
> She marks the two as the same family, confirms, picks the one to keep, and the other is
> deleted. Nothing merges by itself. The owner's answers are in section 7.

## 1. The problem today

- An application that hasn't been approved has **no contact** (`contact_id` is null; the name,
  email and phone live in `entry.application`, guide §29). Import/Export's **Scan for
  duplicates** buckets waitlist families by `kennel_id|contact_id` (`duplicateScan.js`
  `BUCKETS.waitlist_entries`), so two open applications are never compared at all, and two
  approved ones only when they already share a contact.
- If both were approved, each got its own contact. Merging those contacts is refused
  (`recordMerge.mergeBlocker`: "Both of them have a place on the same waitlist…").
- The only tool on the entry page is ⋯ **Delete…**: it drops the second application's answers,
  any fee it paid online and its place, with no link to the first, and it's disabled once
  the entry has an offer.

So she has no way to say "these two are one family" from the waitlist itself.

## 2. What she sees

### 2.1 A suggestion (never acted on by itself)
- On the family's page (Details and Interact), a card: *"This may be the same family as
  **Jennifer Smyth** (applied Oct 3, approved): same phone."* with **Same family…** and
  **Not the same**.
- A badge on the Waitlist page's rows: **Maybe a duplicate**, like the do-not-sell badge.
- Kels's **Review my waitlist** asks it as one of its steps.
- **Not the same** is remembered in the nudge ledger under `dup:waitlist_entries:<ids>`, the
  key the Import/Export scan already uses, so neither asks again.

### 2.2 Marking it herself (the different-spelling case)
Matching can't catch every case: "Jen Smith, jen@gmail" and "Jennifer Smyth-Lee,
jsl@work.com" share nothing. So the entry page's ⋯ menu gets **Same family as another
application…**, whether or not anything was suggested:
- A picker of every other live entry (applied / approved / active) on **this kennel's** list,
  searchable by name, email or phone, each showing status, applied date and place in line.
  Suggested matches are listed first, marked with what they share.
- Entries on another kennel's list, and closed entries (placed, declined, withdrawn,
  removed, expired), aren't offered: a family on two of her lists or back for a second pup
  is two places on purpose (guide §29, *A family back on the list*).

### 2.3 Confirming and choosing which to keep
One dialog, both applications side by side:
- **Which one to keep?** A choice of the two, with the suggested one picked (2.4). She can
  switch it.
- **Where they differ**, one row per field, the kept one's value picked: name, email, phone,
  location, and each form answer that both answered differently. A field only one of them
  has is filled in, no question asked.
- **What happens** in plain words before she confirms:
  - *"[Kept name] keeps their own place: [its place]."* (section 7, Q1)
  - *"Jennifer Smyth's application (applied Oct 3) is deleted. This can't be undone."*
  - If the deleted one had a status-page link: *"The link we sent them for that application
    stops working. They keep using the link for the one you keep."*
  - If both paid an application fee: a warning (section 7, Q2).
- Buttons: **Cancel** / **Merge and delete the other** (danger style). Nothing is written
  until she taps it.

### 2.4 Which one is suggested to keep
The one further along (active, then approved, then applied); then the one with an open offer
or a sale; then the earlier place in line; then the one with more answers. Never just "the
newer one", which would usually be the duplicate.

## 3. What the merge does

New `waitlistActions.mergeApplications(keepId, dropId, choices)`, built on the existing
`recordMerge.mergeDuplicate('waitlist_entries', …)` (fill blanks, chosen values, repoint every
id, registry check, **delete, not archive**, settings remap, sync tombstone), plus the entry rules:

1. **Refused** (a sentence, as `duplicateBlocker` does) when: the two are on different kennels'
   lists; either is closed; both have an open offer in a turn; both have a pup (a
   `placed_sale_id` or an open sale `familySale` gives each). These need her to settle one on
   the Waitlist first, as merging contacts does today.
2. **The application** (`application` object): her chosen value per field; the rest filled
   from the other. The answer-change log of both is kept, oldest first.
3. **Money:** a fee received or paid online on only the deleted one moves to the kept one
   (`fee_received_*`, `fee_paid_online`, `fee_credit_amount`); `received_credits` lists are
   joined (each credit keeps its id). Both paid: section 7, Q2.
4. **Status** and anchor dates: the kept one's, unless Q1 says otherwise.
5. **Offers** and everything else naming the deleted entry follow it (the generic repoint:
   `waitlist_offers.entry_id`, `do_not_sell.source_entry_id`).
6. **Contacts:** if each had a different contact, the step ends with *"They also have two
   contact cards. Merge those too?"*, which opens the existing contact merge (now allowed,
   since only one place on that list is left). No contact is merged by itself.
7. **A line in the kept entry's activity:** *"Merged a duplicate application: Jennifer Smyth,
   applied Oct 3."* So the history says what happened after the other record is gone.
8. `syncContactWaitlistStatus` for both contacts; the next publish drops the deleted entry
   from the projection (its token with it).

## 4. Finding likely pairs (pure)

New `data/applicationDuplicates.js`, pure, no Dexie:
`applicationMatches(entry, entries, contactsById)` → `[{ entry, strength, reason }]`, using
`contactSearch`'s one rule on each entry's identity (its contact's name/email/phone, else
`application`'s): same email or phone = *certain*, same or near name = *possible*. Same kennel,
both live, not dismissed.

`duplicateScan.js`: the `waitlist_entries` bucket also keys on that identity (`n:`/`e:`/`p:`
per kennel), and its pair goes to `mergeApplications` instead of the generic merge, so the
Import/Export card and the waitlist agree.

## 5. Files

| File | Change |
|---|---|
| `shared/data/applicationDuplicates.js` (new, pure) | matching, suggested keep, conflicts, blocker |
| `shared/data/waitlistActions.js` | `mergeApplications` |
| `shared/data/recordMerge.js` | an entry-aware path for `waitlist_entries` (application by key, money, logs) |
| `shared/data/duplicateScan.js` | identity buckets for waitlist families |
| `shared/assets/applicationMergeUI.js` (new) | picker + confirm dialog |
| `shared/pages/waitlist-entry.js`, `waitlist.js` | the card, the ⋯ item, the row badge |
| `shared/assets/waitlistReviewUI.js` | Kels's step |
| `shared/sw.js` `PRECACHE_URLS`; `shared/data/proPages.js` | both new files; the UI module is Pro-only |
| `tests/applicationDuplicates.test.js`, `tests/recordMerge.test.js` | matching, keep order, refusals, money moves, offers repoint, delete |
| End-State guide §10, §29, §33; `BUILD_LOG.md` | as built |

No schema change, no new table or field (the activity line uses the existing log), so no
`syncRegistry` or `referenceRegistry` entry. Edition: Pro (the waitlist's edition); hidden in
Demo (read-only); Lite has no waitlist.

## 6. Out of scope

- Merging across two kennels' lists, or a closed entry into a live one.
- Anything automatic, including on the server when an application arrives.
- Telling the family; she can message them from the kept entry.

## 7. Decisions needed (owner)

Answered by the owner (2026-11-08):

- **Q1. Place in line:** the **kept entry's own** place, not the earlier of the two. The
  dialog's suggested keep (2.4) is the one further along, so the default keeps the better place.
- **Q2. Both paid a fee:** the second fee becomes a **credit** on the kept entry, with a line
  saying she may refund it and remove the credit instead. **Modified:** the same applies when
  only the deleted one paid (section 3, point 3 planned moving the fee fields): moving
  `fee_received_date` would have changed the kept one's place, against Q1, so any fee the
  deleted one paid is a credit, which pays the kept one's fee if that's still due.
- **Q3. Contacts:** merged **in the same confirm** ("Also merge their two contact cards", on
  by default), not as a follow-up step.
- **Q4. Kels's Tidy up:** **yes**, it raises duplicate applications too.

Also **Modified** from the plan: the Today nudge's **Compare** opens the family's page (the
card there merges) rather than the dialog itself, since nudges are a data module; and the
kept entry's history line is a new private field, `merged_applications`, shown in the
Timeline, rather than a line in the family's activity (which the family's page treats as
theirs).
