# KennelOS — Picks Preview Spec

> **Status: built (2026-11-08).** Asked by the owner (2026-11-08). Before picks open on a
> litter, she sees what will happen: which pups are offered, who qualifies for each in order,
> who is left out and why, and her main waitlist settings, which she can change right there.
> It's how she learns that disposition, intended registration and a family's answers drive
> her list. Every decision is in §9. Pro only (the waitlist is Pro).
> Companion spec: `KennelOS_Side_Sale_Spec.md` (side sales show in this preview, §5.3).

## 1. Where things are now

- **Open picks** is a button on the Litter page's Waitlist picks panel
  (`shared/assets/waitlistPicksPanel.js`) and on the Waitlist page's litter rows
  (`shared/pages/waitlist.js`, `data-offer-litter`). Both call `waitlistActions.openPicks`
  straight away. Kels's litter check-in also opens picks (`openPicksFromCheckin`), and Today
  suggests Open picks for litters whose deposit date has come (`depositsDueLitters`).
- The panel's "In line for this litter" table shows the first few families who qualify
  (`litterQueue`) and the pups each matches. It shows nobody who is left out, no reasons,
  no pup that isn't offered, and nothing about other open litters.
- Every rule the preview needs is already pure, in `shared/data/waitlistRules.js`:
  `isPupAvailable`, `pupMatchesPrefs`, `eligiblePupsFor`, `isPaused` / `pausedUntil`,
  `isListeningFor`, `turnSpent`, `litterQueue`, `nextTurn`, `turnLittersFor`,
  `joinsOpenTurn`, `splitPrepassed` / `prepassFor`, `countsAsPass`, `passesUsed`,
  `respondByDate`, `autoOfferSummary`, `waitlistConfigProblem`.

## 2. How turns behave (what the preview has to show)

The preview explains the existing turn rules (Waitlist Spec §6, §16.1). Nothing here changes
them.

- **One family holds a turn at a time** across all of the kennel's open litters. A turn lists
  every pup they qualify for in every open litter. They pick one pup or pass on all of them.
- **There is no "where the list stopped".** Each next turn is worked out from #1 again:
  the highest-ranked family on the list who qualifies for a pup in an open litter they haven't
  had a turn on (`nextTurn`).
- **A turn is used up per litter** (`turnSpent`). A family who passed on Litter A isn't
  offered A again, but they are offered Litter B when B opens, ahead of anyone below them.
- **Opening B while a family holds a turn:** B joins that turn only if the holder is the
  highest-ranked family who qualifies for B (`joinsOpenTurn`). Then the deadline restarts for
  the whole turn. Otherwise B waits. When the turn ends, the next turn goes back up the list
  (example: #1 passed on A, #2 passed on A, #3 holds A. Open B. B waits. Next turns: #1 for B
  only, #2 for B only, #4 for A and B).
- **"Not this litter"** recorded ahead of time becomes a pass when their turn comes. A turn
  of nothing but such litters is passed at once (§16.2).

## 3. When it shows

- **Every Open picks goes through the preview first** (Litter panel and Waitlist page litter
  rows). The modal ends with **Open picks now** / **Cancel**. Open picks now reruns the
  preview against fresh records first. If the result changed (sync, another tab), it shows the
  new one and asks again rather than opening on a stale view.
- **While picks are already open** the panel button reads **Who's in line…** and opens the
  same modal without the Open picks now button (what happens next, from where the list is).
- **Not in scope now:** Kels's litter check-in and Today's Open picks suggestion keep their
  current path (see §9, open item). Kels gets no new task for this.
- **Demo:** the preview works. Editing and Open picks now are disabled.

## 4. The two views

A litter isn't a silo. The default view is the kennel's picks **with this litter added**.

- **Add this litter to picks** (default). Starts from where the list is now: the turn held, who
  has used a turn on which litter, what's still available in every open litter. In memory only,
  this litter is treated as opened today (`picks_opened_date = today` on a copy).
- **If earlier litters finish first** (a toggle). This litter as the only one with open picks,
  still counting turns already used on it. A family who also qualifies in another open litter
  is marked *"Also in line for Litter A, may be placed there first."* That's a fact, not a
  guess.

The preview never guesses which pup a family will choose. Pups can come off as earlier
families choose, so per-family lists are labelled "qualifies for, with pups as they are now".

## 5. What the modal shows

### 5.1 What happens when you open (top line)

One plain sentence, from the same rules `openPicks` runs, so it can't disagree with it:
- **No turn open:** "Family X gets the next turn: Litter A (Bella, Rosie) and Litter B (Max).
  Pick and pay by Nov 12." The date comes from `respondByDate`: her open days, closed dates,
  and the program's longer window if it has one.
- **A turn is open and this litter joins it:** "This litter joins Family Y's turn. Their
  deadline restarts for the whole turn: Nov 10 → Nov 12."
- **A turn is open and this litter waits:** "This litter waits. Family Y holds the turn
  (Litter A) until Nov 10. When it ends, #1 is next (B only), then #2 (B only), then #4 (A and B)."
- **Passes recorded on the way:** each family whose turn would be only "Not this litter"
  litters is named, with whether it counts and what it does to their passes ("1 of 2 used;
  their next pass removes them", or "removes them").
- **Nobody qualifies:** said plainly, pointing at the excluded list.

### 5.2 Turn order

Families in list order who'd get a turn, each with:
- overall number and an "ahead" program badge;
- the pups they qualify for, grouped by litter, across every open litter plus this one;
- litters they've already had a turn on ("Passed on Litter A");
- passes used ("1 of 2"), when they have any;
- a link to their entry (§7).

### 5.3 Pups, by litter

Every pup in every open litter plus this one: **Offered** or **Not offered**, with the reason:
- disposition Undecided (or unset), Keeping, Placed, Health hold;
- deceased, gone home, external, archived;
- a live sale (with a link). A pending side sale on an Available pup shows as
  **Offered · side sale pending: Family Z, deposit due Nov 12**. A held side sale shows as
  Not offered, for the same family (Side Sale Spec §4).
- **two claims on one pup** (two live sales, or a sale and a turn pick) in red.

Setup flags on offered pups, the things that quietly change who matches:
- **No intended registration:** matches every family, whatever they're looking for.
- **Color matching on, no color/markings:** rules out every family who named colors.
- **No sex recorded:** only families who said Either match.

Under each offered pup: the families who qualify for it, in order, with their place for it.

**Within reach**, per sex: with N pups of a sex offered, the first N families in line for that
sex are marked. A count, not a prediction.

### 5.4 The "Either" switch

A three-way switch over §5.2–§5.3: **As they said** / **Either families take females** /
**Either families take males**. Most "Either" families really want a female. The switch
recomputes the per-pup lines, the counts and within reach with every `pref_sex: 'any'` family
treated as that sex. Example line: *"Females: 4 pups, 11 families in line. Males: 3 pups,
2 families in line if Either families take females (9 as they said)."* The §5.1 sentence is
always "as they said" (it's what will actually happen).

### 5.5 Left out

Everyone on this kennel's list who doesn't qualify, with **every** reason that applies (not
the first), per litter where it differs:
- paused by her until a date;
- readiness hold until a date, or "Ready now?" not answered;
- listening only for certain sires/dams, or skipping some;
- no matching pup, broken down by which answer rules out which pups (sex, breed, looking for,
  colors);
- already had their turn on that litter (passed / no response / picked);
- said "Not this litter" (and that a pass will be recorded);
- holds the turn now.

A second group: **not on the list yet**: applied but not approved, and approved with the fee
not recorded. This is the usual "why isn't this hand-entered family showing up".

### 5.6 Checks on families on the list

Soft warnings on every family on the list, in line or left out, each linking to the entry:
- looking for left blank: they match any registration;
- breed not in her breed list (`resolveBreed` → null): they'll match nothing;
- no email: they can't be emailed their turn;
- fee date missing: their place falls back to their approval date;

### 5.7 Settings (edited in place)

The settings that decide what happens, in one card, **editable and saved here**:
- days to pick and pay (`respond_days`);
- open days and closed dates (`open_days`, `closed_dates`), with the real respond-by date
  shown live ("offered today → due Nov 12");
- passes before removal (`max_passes`) and whether no response counts
  (`no_response_counts_as_pass`);
- automatic offers (`auto_offer_on`);
- color matching (`color_matching`).

Changes preview live, marked **Unsaved**, before saving. **Save** checks with
`waitlistConfigProblem` and writes through the same repo path as the Waitlist settings card,
then redraws. Read-only lines link to where they're changed: programs that go ahead, change
the window or don't count passes (Programs page), whether the list is online and reminder
emails are on (Online list / Waitlist settings).

## 6. Fixing things from the preview

- **Families:** every family name links to their entry, to correct the application.
- **Pups:** each pup row has a small inline edit for **disposition, intended registration and
  sex**. It saves through `dogRepo.update` and redraws.
- **Coming back:** leaving to edit returns to the same page with the preview reopened
  (`?preview=<litter id>` is kept in the address while the preview is open, so Back returns to
  it, on the Litter page and the Waitlist page alike).

## 7. How it's built

- **`shared/data/picksPreview.js`** (new, pure; shared like the rest of the waitlist data layer): `previewPicks({ kennel, config,
  entries, offers, litters, pups, sales, programsById, contacts, today, addLitterId,
  view: 'combined' | 'alone', eitherAs: 'stated' | 'female' | 'male', configDraft })` →
  `{ action, turnOrder, pupsByLitter, excluded, notOnList, checks, settings }`. Uses only the
  rules in §1. Adds **`exclusionReasons(entry, litter, pups, sales, opts)`**, which follows
  `eligiblePupsFor` step by step and returns every reason.
- **`shared/assets/picksPreviewModal.js`** (new, Pro-only): the modal, the settings form, the
  pup inline edits. Every user value through `esc()`.
- **Entry points:** `waitlistPicksPanel.js` (Open picks → modal; Who's in line… while open)
  and `waitlist.js` (litter-row Open picks → modal). Reopen on `?preview=<litter id>`.
- **Service worker:** both new files in `PRECACHE_URLS` (`shared/sw.js`); the modal also in
  `shared/data/proPages.js` (`PRO_ONLY_STANDALONE`), in the same change.
- **No schema, field, vocab or registry changes.** Display and existing writes only.
- **Docs:** End-State guide waitlist section (the preview, the new module, the entry points).

## 8. Tests

`tests/picksPreview.test.js`:
- in the combined view with **As they said**, `action` matches what `openPicks` does on the
  same records, for: no turn open, join (with deadline restart), wait, "Not this litter"
  auto-passes, nobody qualifies;
- the qualifying families equal `litterQueue` / `nextTurn` on the same records;
- every excluded family has at least one reason, and a family with two reasons gets both;
- the Either switch moves `any` families between sexes and leaves the action line unchanged;
- the alone view drops other litters and marks "also in line for";
- a config draft changes the respond-by date and the action without writing.

## 9. Decisions (owner, 2026-11-08)

1. Open picks shows the preview first, with Open picks now at the bottom. Yes.
2. No guessing at outcomes. Do show the Either switch (Either taking females vs males).
3. Settings are edited and saved in the modal. Families link to their entries.
4. The Waitlist page's litter rows get it too, since they can open picks.
5. No Kels task now.
6. Combined view by default (litters aren't silos); "If earlier litters finish first" toggle.
- **Open:** whether Kels's litter check-in and Today's Open picks suggestion should also go
  through the preview (suggested yes, so picks never open unseen). They don't yet.
- **Built, to confirm:** the pup inline edits (disposition, intended registration, sex); each
  pup's name also links to its dog page.
- **Modified:** no "No breed recorded" pup flag (a dog's breed is required). The checks of §5.6
  cover every family on the list, not only those in line (a misspelled breed is usually why a
  family is left out). The side-sale lines of §5.3 wait for the side sale.
