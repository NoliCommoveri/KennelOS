# K09 — Dogs, litters, pairings, events, nudges, Today

Reviewed: `shared/data/nudges.js` (1284, every rule; the waitlist rules only for the new
policies / open-picks / side-sale nudges, the rest are K6–K8's), `nudgeState.js` (70),
`dogCare.js` (174), `litterCheckin.js` (266), `prepPups.js` (128), `goHome.js` (154, the
delivery and ready-date helpers), `pedigreeEdit.js` (103), `dogRepo.js` (336), `pairingRepo.js`
(66), `litterRepo.js` (95, skimmed), `eventRepo.js` (274, the reads and validation),
`dateUtils.js`, `calendarMath.js` (83), `tidyRules.js` (the delivered-pup rule);
pages `today.js` (585), `dog.js` (1651: the form, save, status and Deceased prompts, warnings,
pedigree hook-up), `litter.js` (1083: new-litter prefill, whelp/ready dates, warnings, save
prompts), `pairing.js` (557: dates, warnings), `dogs.js` (167), `calendar.js` (196, dates only),
`sale.js` (the Delivered ownership prompt only); assets `pedigree.js` (323), `timeline.js`
(162), `litterCheckinUI.js` (682, the visit, the Expected branch, suggestions), `prepPupsUI.js`
(770, its writes), `dogCheckinUI.js` (334, the heat step), `eventForm.js` (663, the span/end-date
handling and query prefills), `salePrompts.js` (140), `guidedLitter.js` (the existing-litter
prefill), `tidyUpUI.js` (`deliveredOwned`).
Contract read: Review Plan §0, §0a, K9; guide §4.1, §4.3, §8, §19, §25; CLAUDE.md data conventions.
Verified by: baseline at `c152210` — `node --test` **1649 pass**, 0 fail (green; the plan's
1639 is the 2026-11-08 count). `cloud && npm test` and `node build/assemble.mjs` not re-run (no
cloud or build code in scope). Three scratch suites on the in-memory Dexie
(`tests/support/memoryDb.js`) driving the real repos and `computeNudges()`, in my scratchpad:
`k9_nudges.test.mjs` (an Expected litter around and past its due date; an open-ended heat;
heat predictions for a pregnant and a nursing dam), `k9_pedigree.test.mjs` (the loop guard
through a chain, a pup's parent fixed in the chart vs its litter, the same ancestor typed into
two spots, a reg number matching an archived dog, a sex correction), `k9_care.test.mjs`
(preventatives for a dog living with its co-owner and a leased-out dog; a kept pup's DOB
cleared). The date audit: a grep of every `new Date(` / `Date.parse(` / `.slice(0, 10)` in
`shared/{data,assets,pages}`, `addDaysToYMD` round-tripped over 800 days in six DST-shifting
zones (America/Santiago, Asia/Beirut, America/Havana, America/Sao_Paulo, Pacific/Apia,
America/Los_Angeles: clean), and the K9 test files run under `TZ=Pacific/Kiritimati` (UTC+14,
green) and `TZ=Pacific/Pago_Pago` (UTC−11, 3 fail: #13). No pages opened in a browser.

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S1 | shared/data/nudges.js:435 | An Expected litter on file switches off both due-date nudges: nothing on Today ever mentions the due date, or that it passed | verified |
| 2 | S2 | shared/pages/pairing.js:197 | A pairing's expected due date doesn't follow a corrected first date: due-soon and overdue fire weeks off, and families see the old date | verified (code) |
| 3 | S2 | shared/pages/litter.js:1045 | A litter made from its pairing is dated today, not the due date: its ready date, Kels's "due" line and the birth/ready prefills all come from the day she typed it in | verified (code) |
| 4 | S3 | shared/data/nudges.js:367 | A heat logged without an end date (the default in Kels and in Log heat) never asks "record a pairing?" | verified |
| 5 | S3 | shared/data/dogCare.js:66 | A pregnant or nursing dam is told her heat is coming, then that it's overdue | verified |
| 6 | S3 | shared/data/dogCare.js:29 | Monthly preventatives and heat watch name dogs living with a co-owner and leased-out dogs, which she can't treat; back every month | verified |
| 7 | S3 | shared/data/goHome.js:151 | A pup placed on a co-own stays a Puppy for life: the Delivered prompt and the tidy-up change ownership only, never the life stage | verified (code) |
| 8 | S3 | shared/data/pedigreeEdit.js:75 | Fixing a pup's sire or dam in the chart leaves its litter naming the other dog; no warning on either page | verified |
| 9 | S3 | shared/data/pedigreeEdit.js:92 | "Type it in" makes a second record for an ancestor already on file unless she types a reg number: line breeding splits one dog in two | verified |
| 10 | S3 | shared/data/nudges.js:324 | Clearing a kept pup's date of birth silently ends its promote nudge, though its litter's whelp date is on file | verified |
| 11 | S4 | shared/data/pedigreeEdit.js:92 | A typed reg number reuses an archived dog the picker hides; in Lite that departed dog's spot then has no ✎, while its own Unknown spots offer + Add | verified |
| 12 | S4 | shared/assets/prepPupsUI.js:537 | Prep pups' "add them as a co-owner" leaves the pup Owned with a co-owner: a state the rest of the app reads as her own dog | verified (code) |
| 13 | S4 | tests/linkedStatusNudges.test.js:29 | The nudge tests build dates in UTC against a local "today": 3 fail west of UTC in the evening | verified |

## 1. An Expected litter on file switches off both due-date nudges  (S1, verified)

**Where** `shared/data/nudges.js:435` (`pairingduesoon`) and `:456` (`pairingoverdue`) both
`continue` when `pairingIdsWithLitter.has(p.id)`; `litterpairing` (`:482`) needs the litter at
`WHELPED_OR_LATER`; no rule looks at a litter in `expected`. `litterCheckin.checkinSuggestions`
has nothing for an Expected litter either: Kels's check-in asks "Did the puppies arrive?" only
if she opens it on that litter.

**Scenario** Hazel × Rocco is Confirmed pregnant, due 2026-12-01. On 2026-11-02 she records
the litter as Expected (the pairing page's Create Litter, or Kels's Add a litter) so she can
set prices and a deposit date and put it on her website. From that moment Today never mentions
the due date: no "due in 3 days" on 11-28, no "past its expected due date" on 12-02, and
nothing at all 20 or 120 days later. Scratch test: a confirmed-pregnant pairing due in 2 days
shows `pairingduesoon`; recording the Expected litter removes it; moving the due date to 20
and then 120 days ago leaves Today with only the monthly preventatives nudge. An Expected
litter with no pairing, its projected whelp date 60 days gone, is equally silent.

**Why it matters** The plan's own rule: a missed whelping deadline is S1. Recording the
Expected litter early is what the app invites (prices, deposits, the website's Coming up, the
waitlist's live litters all read Expected litters), so the breeders who plan best lose the
only due-date reminder Today has. A litter left Expected also keeps showing families an
"expected" litter whose date has passed (`siteExport` / `waitlistProjection` read it as live).

**What I'd do** Drop the `pairingIdsWithLitter` skip for litters still `expected` (or add an
`expectedoverdue` rule on the litter: past its pairing's due date, else its whelp date, and
still Expected → "Has she whelped? Record the birth" opening Kels's record-litter).

## 2. A pairing's due date doesn't follow a corrected first date  (S2, verified (code))

**Where** `shared/pages/pairing.js:197`: the planned-date change handler fills
`expected_due_date` only `if (... !ctx.draft.expected_due_date)`. The litter page does the
better thing for its ready date (`litter.js:387`, "follows a whelp change while still the
prefill"); the pairing page doesn't. The only check (`:233`) warns when the due date is before
the first date.

**Scenario** She plans Hazel for her expected heat: first date 2026-03-01, due date fills in as
2026-05-03. The heat comes three weeks late; she changes the first date to 03-22 and saves. The
due date stays 05-03 (no warning: it's still after the first date). Today says "due in 3 days —
create the litter?" on 04-30 and "past its expected due date — Mark whelped" from 05-04, three
weeks before the pups can come. The other way (heat early) the due-soon nudge comes after the
pups are born. The waitlist and the website read `expected_due_date` (`waitlistProjection.js:426`,
`siteExport.js:277`), so families see the stale date.

**Why it matters** A wrong due date drives the whelping nudges (#1's only safety net when no
litter is recorded yet) and is shown to families.

**What I'd do** Follow the litter's pattern: refill the due date when it is empty or still
exactly 63 days after the old first date. Consider `last_observed_date` as the anchor when set.

## 3. A litter made from its pairing is dated today, not the due date  (S2, verified (code))

**Where** `shared/pages/litter.js:1045`: a new litter's `whelp_date` is set to today and its
`estimated_ready_date` to today + 56, before the pairing prefill (`:1048`) sets status
Expected without touching the dates. Kels's record-the-birth then reads them:
`guidedLitter.js:390` prefills the birth date from `litter.whelp_date` when it isn't in the
future, and `:394` keeps the stored `estimated_ready_date` (the `G.defaultReadyDate` fallback
at `guidedLitterUI.js:362` runs only when it's blank). Kels's litter picker labels an Expected
litter "due <whelp_date>" (`litterCheckinUI.js:115`). The Litter page's only date warning is a
future whelp date at Whelped or later (`:462`).

**Scenario** Confirmed pregnant, due 12-01. She taps Create litter on 11-02: the Expected
litter is "whelped" 11-02 and "ready" 12-28. Kels's picker shows it as "due Nov 2". The pups
come 12-01: Record the birth with Kels prefills "born Nov 2"; she corrects that, but the ready
date stays 12-28 (four weeks early), so the `gohome-schedule` nudges start a week before that
and the waitlist's ready date is wrong. If she instead just moves the status to Whelped on the
Litter page, the 11-02 whelp date stays with no warning, and every pup added after gets it as
its date of birth (`dog.js:471`, `puppyForm.js`).

**Why it matters** Wrong birth and ready dates drive every age-based rule (weaning at 28 days,
ready, go-home) and what families are told.

**What I'd do** For a litter made from a pairing, prefill `whelp_date` from the pairing's
`expected_due_date` (else leave it blank), and have the ready date follow it as it already does
on a whelp change. In Kels, refill the ready date when it is still the old whelp + 56.

## 4. A heat logged without an end date never asks for a pairing  (S3, verified)

**Where** `shared/data/nudges.js:367`: `heatpair` reads only heats with `e.event_end_date <
today`. Kels's heat step (`dogCheckinUI.js:113`) has "Ended (optional)" blank; Today's own
`heatwatch` action opens the event form with only `logDate`, and the form says "Leave blank for
an open-ended/ongoing stay."

**Scenario** Today says Hazel is expected in heat; she taps Log heat, picks the start, saves.
Nothing ever asks her to end it, so 40 days later there is still no "Hazel finished a heat —
record a pairing?". Scratch test: an open-ended heat 40 days old → no `heatpair`; give it an
end date → it appears. The timeline shows the heat as "– ongoing" for ever.

**Why it matters** The rule the guide lists (§19, `heatpair`) quietly doesn't fire for the
way the app's own forms log heats.

**What I'd do** Treat an open heat as ended after a typical length (say 21 days from its
start) for `heatpair`, or add a "is Hazel's heat over?" nudge that sets the end date.

## 5. A pregnant or nursing dam is told her heat is coming  (S3, verified)

**Where** `shared/data/dogCare.js:66` (`heatForecast`) looks only at heat starts; neither it
nor the `heatwatch` loop (`nudges.js:394`) knows about a pairing in progress or a litter at home.

**Scenario** Scratch test: heat 170 days ago, bred then, Confirmed pregnant → "Hazel is
expected to go into heat soon — keep an eye out". Heat 200 days ago, litter whelped 60 days
ago and Weaning → "Hazel was expected to cycle recently — has that happened?". The only ways
out are to dismiss it or log a heat that didn't happen.

**Why it matters** A wrong prompt on the screen she starts her day on; dismissing it trains
her to dismiss the real one.

**What I'd do** Skip (or push back) the forecast while she has a bred / confirmed pairing or a
litter under ~8 weeks old.

## 6. Preventatives and heat watch for dogs that live somewhere else  (S3, verified)

**Where** `shared/data/dogCare.js:29`: `CARE_OWNERSHIP` includes `co_owned` (whatever
`lives_with_contact_id` says) and `leased_out`; `breedingDogs` feeds `preventativeGaps` and
`heatForecast`.

**Scenario** Scratch test: an active-breeding stud co-owned with Pat and living with Pat
(`lives_with_contact_id` = Pat), and a leased-out female → "Not logged yet this month: AtPats,
Leased." She doesn't give either dog its heartworm pill, so the only way to clear it is to log
a dose she didn't give or dismiss it; the key is per month (`preventatives:YYYY-MM`), so it
comes back on the 1st, every month. The leased-out female also gets heat watch.

**Why it matters** A nudge she can't honestly satisfy, repeating forever, and an incentive to
log care that never happened (that history goes to families via Companion and the puppy
record).

**What I'd do** Leave out a co-owned dog whose `lives_with_contact_id` is set and leased-out
dogs from the routine-care lists (the guide §8 definition of "the dogs she looks after" would
change with it).

## 7. A pup placed on a co-own stays a Puppy for life  (S3, verified (code))

**Where** `shared/data/goHome.js:151` (`deliveredOwnershipChanges`, `co_owned`) sets only
ownership and co-owners; the External choice also sets `status: 'external_reference'`. The Sale
page's Delivered prompt (`sale.js:755`) offers External, Co-owned or "leave unchanged" (the
default), never a life stage. Kels's tidy-up catches a delivered dog still `owned`
(`tidyRules.js:187`) but leaves co-owned ones alone by design, and offers the same two changes.

**Scenario** Ruby goes home on a co-own (breeding rights retained). The sale is Delivered and
she picks Co-owned. Ruby is now Co-owned, status Puppy, disposition Placed, and stays so: on the
Puppies tab and the Kennel overview's Puppy tile at three years old, never in the breeding-dog
lists (no heat watch, no preventatives, not in Log for several dogs), and no rule or prompt ever
suggests Active breeding or Pet home. The same happens in Pro to an owned pup when she skips
the prompt and the tidy-up ("I still own them").

**Why it matters** The one-record-for-life rule holds, but the record is stuck at its first
stage. The dog she kept a share in for breeding falls out of every care and breeding list.

**What I'd do** Ask the life stage alongside the ownership on Delivered (Pet home for a pet
co-own, Active breeding for breeding rights), or a nudge for a delivered pup still Puppy past
~6 months.

## 8. Fixing a pup's parent in the chart leaves its litter disagreeing  (S3, verified)

**Where** `shared/data/pedigreeEdit.js:75`: `setParent` writes only the child's `sire_id` /
`dam_id` ("no other record changes"). The Dog page warns about DOB vs whelp date (`dog.js:609`)
but not about sire/dam vs the litter's; the Litter page compares itself with its pairing only
(`litter.js:256`). A Litter edit of sire or dam doesn't touch its pups either.

**Scenario** Scratch test: pup Red on the Hazel × Rocco litter; she fixes Red's sire in the
chart to Duke. Red's pedigree says Duke; the litter, Rocco's Litters list, the waitlist's
"litters from Rocco" listen choices and the website say Rocco. Neither page shows the
mismatch. The reverse (the litter's sire corrected) leaves every pup's pedigree on the old sire.

**Why it matters** Two places say who a puppy's father is and nothing keeps them together or
flags them. A family can be told one sire and handed a pedigree with another.

**What I'd do** When the child has a `litter_id` and the new parent differs from the litter's,
ask whether to change the litter too (or just this pup: a split litter), and show the mismatch
as a warning on the Dog page like the DOB one.

## 9. The same ancestor typed into two spots becomes two dogs  (S3, verified)

**Where** `shared/data/pedigreeEdit.js:92`: `addNewParent` reuses a dog only by registration
number; with none typed it always calls `createPedigreeOnly`. The dialog opens on "A dog not
in KennelOS — type it in…" for an empty spot (`assets/pedigree.js:282`), and the hint says only
that a matching reg number is reused.

**Scenario** Line breeding: CH Briar Ace is the sire of both Rocco and Hazel. From each
Unknown box she types "CH Briar Ace" with no number (often the case for older dogs). Scratch
test: two pedigree-only records, `reused` false both times. The chart looks right, but the
lineage now has two Aces: a recorded COI or a "who's related" check by id misses the shared
ancestor, and the Dogs pages' Duplicates scan is the only thing that will find it.

**Why it matters** A pedigree that looks complete but hides the inbreeding it was entered to show.

**What I'd do** Before creating, match the typed registered name (titles stripped, as
`pickerGroups` sorts) against pedigree-only dogs and offer "Use CH Briar Ace already on file?".

## 10. Clearing a kept pup's date of birth ends its promote nudge  (S3, verified)

**Where** `shared/data/nudges.js:324`: `promote` skips any pup with no `date_of_birth`, while
the deceased rule just above falls back to the litter's whelp date (`diedAsPuppyRecently`, `:177`).

**Scenario** Scratch test: kept male pup, 14 months, kennel promotes males at 10 months →
`promote` shows. She uses the new Clear button on Date of birth (to fix a typo, or because the
form shows the litter's date as a conflict) and saves → the promote nudge is gone, with the
litter's whelp date still on file. The pup stays a Puppy until she remembers.

**Why it matters** A nudge that silently never fires; the plan asked what the new Clear does to
age-based nudges.

**What I'd do** Use `date_of_birth || litter.whelp_date` here as the deceased rule does.

## 11. A reg number can put an archived dog in a spot the chart can't fix  (S4, verified)

**Where** `shared/data/pedigreeEdit.js:92` searches every dog, archived ones included, while
`spotCandidates` leaves archived dogs out of the picker. In `assets/pedigree.js:96` an archived
dog in Lite (`!editionFlags.archivedDogLinks`) has no ✎; but the Unknown boxes under it get
"+ Add" (`:78` has no such check), so its own sire and dam can be written.

**Scenario** Scratch test: Old (archived) has NP12345601; typing that number in a Sire spot
reuses Old (`reused: true`, still archived). In Lite, where archived means "departed, can't be
edited or brought back", Old now sits in that spot with no way to change it from the chart, and
she can set Old's own parents through the + Add boxes under it.

**Why it matters** Small today; it is the Lite cap spec's "can't edit a departed dog" promise
with a back door, and a spot that can't be fixed from the place that fixes spots.

**What I'd do** Skip archived dogs in the reg-number reuse (or say "that number is on Old,
archived") and give an archived node's spot a ✎ even when its own links are hidden.

## 12. Prep pups' co-owner leaves the pup Owned  (S4, verified (code))

**Where** `shared/assets/prepPupsUI.js:537` adds the buyer to `co_owner_contact_ids` on a
co-own registration but leaves `ownership_type` alone, and says "they're a co-owner now". The
Delivered prompt's Co-owned (`goHome.js:151`) changes both.

**Scenario** A pup sold as Co-own: Kels adds the family as co-owner. The pup is Owned with a
co-owner: the Dog page shows the co-owner but no Lives with (`dog.js:375` needs Co-owned), the
website reads co-owners only for Co-owned dogs (`siteExport.js:160`), and `tidyRules`
"delivered-owned" will later ask whether she still owns it.

**Why it matters** A dog in two states at once; each reader picks a different one.

**What I'd do** Set `ownership_type: 'co_owned'` in the same update, as the Delivered path does.

## 13. The nudge tests depend on the clock's time zone  (S4, verified)

**Where** `tests/linkedStatusNudges.test.js:29`: `daysAgo` is
`new Date(Date.now() - n*86400000).toISOString().slice(0, 10)` (a UTC date), compared with the
app's local `todayYMD()`.

**Scenario** `TZ=Pacific/Pago_Pago node --test tests/linkedStatusNudges.test.js` at 04:22 UTC
(17:22 local the day before): 3 fail ("is due tomorrow" for "due today"; the not-too-early
case; the stud pick). Anyone running the suite in the Americas in the evening sees red on a
green tree. (Eight test files use the same pattern; this is the one I ran.)

**Why it matters** A flaky baseline is how a real failure gets waved through.

**What I'd do** Build test dates with `addDaysToYMD(todayYMD(), -n)` from `dateUtils.js`.

## Notes, not findings

- **The date audit came out clean.** No date-only field goes through `new Date('YYYY-MM-DD')`
  in this area: `addDaysToYMD` / `addMonthsToYMD` / `monthsBetween` work on local components,
  `fmtDate` builds a local date, and `litterCheckin.daysBetween`, `dogCare`, `calendarMath` and
  `waitlistReviewUI.js:563` parse both sides as UTC, so they agree. Leftovers: CSV export file
  names use the UTC date (`dogs.js:122` and ~20 report pages: after ~4 pm in California the file
  is named tomorrow), and `created_at.slice(0, 10)` (a UTC day) stands in for a missing
  `planned_date` in `pairingExistsForDam` (`nudges.js:95`), `pairingnolitter` (`:524`),
  `tidyRules.js:216` and `breeding.js:31`: off by a day only for a pairing with no first date
  created near midnight UTC, and it errs toward "already handled" west of UTC.
- **One record for a whole life holds.** No path makes a second Dog row: promote, retire,
  Deceased (`dog.js:783`, `salePrompts.promptReleasedPup`), returned pups brought back as Puppy
  (`promptBackAsPuppy`), sold pups to External, pedigree-only "Bring into use" all update the
  same record; `dogRepo` nulls `disposition` off Puppy. The stuck states are #7 and #12.
  `promptReleasedPup` (pup died) and `deliveredOwnershipChanges('co_owned')` don't stamp
  `status_date`; the Deceased rule falls back to `date_of_death` so nothing breaks.
- **Pedigree loop guard is sound.** `wouldLoop` and `dogRepo.validateDog`'s `collectAncestors`
  both walk the whole chain, over archived and pedigree-only dogs (scratch test: a grandchild
  can't become its grandsire, and isn't offered). A dog taken out of its only spot stays
  findable (Kels's Find, the pedigree page's picker, the spot dialog, Duplicates), so no orphan.
  The sex correction checks other dogs' parent spots but not a litter or pairing that names the
  dog (a pedigree-only dog isn't offered in those pickers, so only an import could do it).
- `setParent` writes the child, then the parent's corrected sex, in two writes
  (`pedigreeEdit.js:75-76`); a failure on the second leaves the parent in a spot of the other
  sex. The repo validates the parent's merged record, so an old record that wouldn't pass
  today's rules would hit this.
- **`nudgeState` never forgets.** Every dismissed key stays in localStorage for good
  (per-month preventatives, per-message waitlist keys…), and `isDismissed` re-reads and parses
  the whole ledger for each nudge on every Today redraw (which now also runs on every cloud data
  change). Fine for years of ordinary use; worth pruning keys whose nudge no longer computes.
- `computeNudges` has no per-rule isolation: one rule throwing on an odd record (an imported or
  synced row) takes every nudge off Today, the whelping ones included, and Today shows only the
  error text. I didn't find a throw on real data; it is the failure mode to guard.
- The heat-watch `overdue` key includes the predicted date, so a dismissal holds until a heat
  is logged; good. `heatwatch`, `preventatives` and Kels's check-in use the same functions, so
  Today and Kels don't disagree.
- New nudges: `waitlist-policies` goes when a policy is added; `waitlist-open-picks` keys on the
  deposit date, so moving the date re-asks; `waitlist-side-overdue` keys on the due date;
  `pup-two-sales` has no action, only Dismiss (the done-condition is recording a deposit on one
  sale, reachable from the pup's page). All reachable; none repeats another Today nudge.
- Prep pups' "Shots" and "Deworming" are done with any one vaccination / preventative ever
  logged; a pup with only its 6-week shot reads "Shots ✓" at 8 weeks. A wording choice, but it
  is the closest thing to a health deadline the go-home flow has.
- `preventatives` covers active breeding dogs only; retired dogs at home get no monthly reminder.
  Per the guide (§19), so a design choice, but worth a look alongside #6.
- `dog.js:629`: the "Update litter's whelp date to match" button in the DOB warning writes the
  litter immediately, while the dog form is still unsaved; Cancel on the dog leaves the litter
  changed.

## Coverage gaps I found (tests that should exist)

- `computeNudges` with an Expected litter linked to a pairing, before and after the due date (#1).
- The pairing page's due-date prefill following a changed first date (#2) and a new litter's
  date prefills from a pairing (#3).
- `heatpair` for an open-ended heat (#4); `heatForecast` for a bred or nursing dam (#5);
  `preventativeGaps` for a co-owned dog living with its co-owner (#6).
- `setParent` on a pup with a `litter_id` (#8); `addNewParent` with a name already on file and
  no number (#9); with a number on an archived dog (#11).
- `promote` with a blank DOB and a litter whelp date (#10).
- A test-wide helper for "n days ago" in local time (#13).

## What I did not get to

- Timeline timing with 500 events on one dog in a browser (code read only: one pass, no
  per-event reads; contacts and expenses are loaded once). `calendar.js`, `reminders.js`,
  `breeding.js` beyond dates; `kennelTree.js`, `healthTestLog.js`, `healthTestsUI.js`,
  `keeperTests.js`, `studRules.js` (only `pickDue` / `boardingEndedUpdate` as called from
  nudges), `puppyDefaults.js`, `awayBoard.js`.
- The page recipe at 320 px and the escaping pass on `dog.js` / `litter.js` (layering grep
  clean: no `db.js` or `localStorage` in any K9 page or asset).
- Litter arithmetic beyond the lifecycle rules (born counts vs roster is the tidy-up's
  `litter-count`; weights only through `litterCheckin`'s pure helpers); foster litters (§25)
  read, not exercised.
- `eventForm.js`'s cascade writes (litter-wide logging) and the weight-drop confirm.
