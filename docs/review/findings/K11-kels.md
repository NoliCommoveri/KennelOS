# K11 — Kels and the guided tasks

Reviewed: `shared/pages/kels.js` (500, the menu, doors, Save for later / Cancel, handoffs),
`assets/kelsChat.js` (300), `kelsSteps.js` (378, the step engine), `kelsFindings.js` (82),
`kelsSetupUI.js` (623), `kelsApplicant.js` (84), `kelsBackupSteps.js` (56, skimmed),
`kelsFindUI.js` / `kelsUnderstandUI.js` / `kelsInsightsUI.js` (read-only halves: their writes
and doors only); data `guidedLitter.js` (722: steps, checks, the save), `guidedDogs.js` (617:
the save, the draft), `guidedPeople.js` (412: the save, the vet rule), `guidedForm.js` (166),
`kelsSetup.js` (119), `kelsFavorites.js` (48, skimmed), `wizardState.js` (79), `wizardSteps.js`
(the header); assets `guidedLitterUI.js` (728: the draft and save paths), `guidedDogsUI.js`
(714: the same), `guidedPeopleUI.js` (593: the save, then the waitlist), `guidedFormUI.js`
(380), `guidedShareUI.js` (89), `wizardUI.js` (404: state, the tour's end), `tidyUpUI.js` (724:
every fix's write), `shared/assistant.js` (429, skimmed), `data/assistantStore.js` (186),
`data/assistantSync.js` (173), `pages/assistant.js` (187). For the plan's item 7 and the
"Demo" pass, also the write paths of `litterCheckinUI.js` (`offerPicks`, `deliver`,
`setStatus`), `waitlistReviewUI.js` (`runNudgeAction`), `waitlistPicksPanel.openPicksFromCheckin`
and `websiteUpdateUI.noteWebsiteBaseline` / `offerWebsiteCheck`.
Contract read: Review Plan §0, §0a, K11; `docs/KennelOS_Kels_Roadmap.md` §1, §2 (the rules),
§4, §5; guide §33 (Kels: the menu, Getting Started, Record a new litter, Add dogs, Add people,
Check in on a litter); CLAUDE.md.
Verified by: baseline at `07634db`: `node --test` **1649 pass**, 0 fail (the plan's 1639 is the
2026-11-08 count); `node build/assemble.mjs` succeeds (lite / pro / demo / furever / site).
`cd cloud && npm test` not re-run (no cloud code in scope). Scratch harness in my scratchpad
(`k11/`): the repo's `tests/support/memoryDb.js` pointed at any build root, so the **real Lite
build** (`dist/lite`, its cap hooks) runs under it: `lite_litter*.test.mjs` (the litter task at
the litter cap and one under the dog cap), `stale_draft.test.mjs` (a litter draft across Clear
sample data), `dup_litter.test.mjs` (a draft resumed after the litter was recorded on its page),
`assist_reimport.test.mjs` (KennelAssistant entries imported twice). Real pages in Chromium
(Playwright, 390 px) against `dist/` served on localhost: the Doing Something menu in Lite and
Demo; **Add dogs driven end to end in the Demo**; `?task=add-people` in Lite and
`?task=get-started` in the Demo.

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S2 | shared/data/guidedLitter.js:617 | In Lite, Record a new litter makes the new mom and dad before the litter: at the litter cap both dogs are made (2 of her 6) and the litter refused; near the dog cap the mom takes the last slot and the dad is refused. Nothing checks either cap before 15 screens of questions | verified |
| 2 | S2 | shared/data/sampleData.js:1336 | A Kels draft outlives Clear sample data (and the tour's own clear): resumed, it writes a litter and breeding whose mom and dad no longer exist, then stops at the first puppy, half-made | verified |
| 3 | S2 | shared/assets/kelsSteps.js:205 | A resumed litter draft never looks again for a litter recorded since: she adds it on the Litter page, taps the dot's "Finish recording Bella's litter", and Kels builds a second litter with a second set of puppies | verified |
| 4 | S2 | shared/data/assistantSync.js:166 | KennelAssistant: entries shown as "Already imported" are imported again on every check until she sends her helper a fresh copy, overwriting her corrections and bringing back entries she removed | verified |
| 5 | S2 | shared/pages/kels.js:163 | The Demo offers 12 tasks that save; each runs to its last screen, then says "Hmm, that didn't save: This is a demo… fix it and try again", keeps the draft and the dot forever | verified (browser) |
| 6 | S2 | shared/assets/litterCheckinUI.js:212 | The check-in's "Yes, mark the sale delivered" writes outside any catch: a refused write (every one in the Demo) ends the whole chat with "Sorry, something went wrong", no menu | verified (code) |
| 7 | S2 | shared/data/guidedForm.js:160 | A resumed application-form draft saves the copy of her questions and FAQ it took when she started, over any change she made on the Application form page since | verified (code) |
| 8 | S3 | shared/assets/kelsChat.js:31 | Tidy up, Check in on a litter, Pups are going home, Check account health and Set up my waitlist open with "I'll build the records for you to approve… I'll save what we've got so far", but save every tap at once and keep nothing on a reload | verified (code) |
| 9 | S3 | shared/pages/kels.js:462 | Save for later during the intro or a task's first question ("Which kennel?") says "Saved! I'll keep what we've got" with no draft made: nothing to finish later | verified (code) |
| 10 | S3 | shared/pages/kels.js:471 | Cancel (or a task's own link out: the check-in's "the litter's page") skips the website check, and the next task's baseline then hides those changes from every later check | verified (code) |
| 11 | S3 | shared/assets/kelsSetupUI.js:286 | Getting Started's Puppy Record part always says "Right now they show everything"; its primary button then clears the fields she left off last time | verified (code) |
| 12 | S3 | shared/assets/kelsSetupUI.js:87 | Getting Started keeps no place: left at part 7, it starts again from the logo, and it sits at the top of her menu until she has a dog | verified (code) |
| 13 | S3 | shared/assets/guidedPeopleUI.js:419 | Add people's waitlist step tags a person Buyer before their application is asked; "Not now" leaves the tag | verified (code) |
| 14 | S3 | shared/assets/guidedFormUI.js:364 | A family she types in herself is approved in Add people, but left "ready for you to approve" from Set up my waitlist and Set up my application form, so Review my waitlist asks her again | verified (code) |
| 15 | S3 | shared/data/guidedPeople.js:95 | "No vet to add, don't ask again" in Tidy up doesn't reach Add people, which asks "Do you have a vet?" on every run | verified (code) |
| 16 | S4 | shared/assets/guidedLitterUI.js:577 | A `DRAFT_VERSION` bump throws an unfinished draft away without a word, even one whose save stopped partway (its records made, now no way to finish them); it has happened once | verified (code) |
| 17 | S4 | shared/pages/kels.js:492 | `?task=` starts a task without asking `available()`: Lite `?task=add-people` dies on a missing module; the Demo runs Getting Started, which it excludes | verified (browser) |
| 18 | S4 | shared/data/wizardState.js:24 | The tour remembers its place as an index into this release's step list, not a step id | verified (code) |

## 1. Lite: the litter task makes the parents first, then hits the cap  (S2, verified)
**Where** `guidedLitter.saveGuidedLitter` (`shared/data/guidedLitter.js:617-618`) makes new
parents (`createParent`) before `litterRepo.create` (:626). Guide §33 says "In Lite the litter
is written first so the cap refuses before anything else is made"; the code's own comment
(:606) says the litter comes before the *breeding*, which is true but not the parents. The task
itself (`kels.js:163`, `available: () => true`; `runLitterTask`) never asks `dogCapStatus()` or
the litter count before the questions, unlike Add dogs (`guidedDogsUI.js:440`).
**Scenario** (real Lite build, `lite_litter.test.mjs`): 10 litters on file, 2 dogs. Record a new
litter, typing a new mom and a new dad of hers. On **Yes, build it**: `CapExceededError: 10/10
litters`, and the dogs table now holds NewMom and NewDad: two of her six slots gone, no litter.
Second run (`lite_litter2.test.mjs`): 5 dogs, new mom and dad: NewMom is made (6/6), the dad is
refused (`6/6 dogs`), no litter. Either way she has answered every screen (parents, breeding,
birth, each puppy, plans, prices, dates) before the upgrade notice appears under the review,
with **Try again** and the draft kept, so the dot stays until she cancels; the dogs stay too.
Lite's sample data sits at 6/6 dogs, so a breeder trying Kels on it meets the second case on
her first try with a new parent.
**Why it matters** Roadmap rule 3: at the cap Kels shows the notice and moves on; she never
works the cap around, and here the cap eats slots for a litter that doesn't exist.
**What I'd do** In Lite, check the litter count (and room for each new parent) up front, as Add
dogs does; and write the litter before the parents where the cap can refuse, or make the
parents only once the litter is accepted. Fix the guide's sentence either way.

## 2. A draft outlives Clear sample data, and builds on records that are gone  (S2, verified)
**Where** `clearSampleData` (`shared/data/sampleData.js:1336`) and the tour's
`clearSeedForHandoff` (`assets/wizardUI.js`) delete the seed but leave `kennelOS.guided*Draft`;
a Replace restore (`importExport.js`) leaves them too (by code). `remapStoredIds` follows a
*merge*, not a deletion. On resume, `StepConversation.start` (`kelsSteps.js:205`) goes straight
to `draft.step`; nothing re-checks `damId` / `sireId`, and the review step has no check
(`stepProblem` default → null).
**Scenario** (`stale_draft.test.mjs`): a new breeder tries **Record a new litter** on the
Thornfield sample (the tour's whole point), picks a sample mom and dad, gets to the review, and
closes the tab. She clears the sample data (or finishes the tour, which clears it for her). The
dot on Ask Kels still says she has something to finish: "Finish recording Bella's litter".
Resumed at the review (the parents show as "the mom" / "the dad"), **Yes, build it** writes a
Whelped litter and a Whelped breeding whose `dam_id` / `sire_id` point at nothing, then throws
`Dog: "breed" is required.` on the first puppy (the breed comes from the missing mom). She sees
"Hmm, that didn't save: Dog: "breed" is required. Your answers are kept, so you can fix it and
try again." There's nothing to fix; Cancel leaves the litter and the breeding in her real data.
**Why it matters** A half-written litter, with parents that don't exist, in the first records
of a brand-new program.
**What I'd do** Clear the four drafts wherever the records they name go away wholesale (Clear
sample data, the tour's end, Replace restore); and on resume, re-check the ids a draft holds
and send her back to the step whose answer is gone.

## 3. A resumed litter draft builds a second copy of a litter recorded since  (S2, verified)
**Where** `kelsSteps.js:205` (resume to `draft.step`); `guidedLitter.stepsFor` only adds
`match-litter` when `litterCandidates` finds a litter **with no puppies** (`:211`); the review
has no check.
**Scenario** (`dup_litter.test.mjs`): Monday she gets to Kels's review for Bella × Duke and
stops. Tuesday she records the litter on the Litter page with its three pups. Wednesday the dot
asks her to finish Bella's litter; she does: `litterCandidates` offers nothing (the page's litter
has pups), so Kels builds **a second litter, born the same day, with three more puppies**, and a
breeding. Her litters list and Today show two litters; in Lite it burns a litter slot. The same
happens with a draft started on one device and the litter typed on another (live sync).
**Why it matters** Duplicate litters and pups are the mess Tidy up exists to find; here Kels
makes them.
**What I'd do** On resume (and before the save), look for a litter of these parents born within
a few days of `whelpDate`, with or without pups, and ask "Is this the litter?" again.

## 4. KennelAssistant: re-imported entries overwrite her edits  (S2, verified)
**Where** `assistantSync.importAssistantEvents` (`shared/data/assistantSync.js:166`): rows marked
`update` ("Already imported" in the preview, `pages/assistant.js`) are `bulkPut` whole over the
record, with `is_archived: rest.is_archived ?? false`. The comment at :120 calls it harmless.
**Scenario** (`assist_reimport.test.mjs`): her helper logs a weight "12 lb 0 oz" and sends it;
she imports it, sees it should be 2 lb 1 oz, corrects it with a note. Her helper logs something
else and sends again: the first entry still rides the outbox, because their phone clears it only
when it syncs a feed she has pushed, and importing doesn't push one. She taps **Check for
entries**, sees "New" and "Already imported", taps **Import 2 entries**: the weight is back to 12
lb 0 oz and her note is gone. An entry she archived comes back (`is_archived = false`); one she
deleted is "New" again.
**Why it matters** Her corrections to a dog's health record are silently undone by a routine
tap, and the preview says the row is harmless.
**What I'd do** Skip `update` rows unless the helper's copy is newer than hers (`updated_at`), or
leave them out of the import and say they're already in; and push a fresh feed after an import
so the helper's phone clears them.

## 5. The Demo runs every saving task to the end, then refuses it  (S2, verified)
**Where** `kels.js` `TASKS`: only Getting Started, Set up my accounts and Update my website check
`editionFlags.demoMode`; Record a new litter, Add dogs, Add people, Tidy up, both check-ins, Log
health test results, Pups are going home, Set up my waitlist, Review my waitlist and Set up my
application form are offered (the menu in the Demo build lists 12). The drafted tasks' save
catches the error with "Your answers are kept, so you can fix it and try again"
(`guidedDogsUI.js:512`, `guidedLitterUI.js:676`, `guidedPeopleUI.js:338`, `guidedFormUI.js:276`).
**Scenario** (browser, `dist/demo`): Doing Something → Add dogs → every screen (roster, details,
parents, breeder, review) → **Yes, build it** → "Hmm, that didn't save: This is a demo — changes
aren't saved. Your answers are kept, so you can fix it and try again." with **Try again**. The
draft stays in localStorage: every later visit opens with "Finish adding Test0" and the dot. A
visitor trying the Demo's headline helper gets a wall at the end and advice that can't work.
**Why it matters** The Demo exists to show Kels off; the banner says changes aren't saved, but
Kels promises "the records for you to approve" and then blames the visitor.
**What I'd do** In the Demo, either end each drafted task at its review with a Demo line ("This
is where I'd build it. In your own KennelOS, I would.") and drop the draft, or say up front that
she'll walk through it without saving. Whatever the choice, don't keep a Demo draft.

## 6. The check-in's Delivered write can throw the whole chat away  (S2, verified (code))
**Where** `litterCheckinUI.deliver` (`shared/assets/litterCheckinUI.js:212`, `saleRepo.update`;
:227 `dogRepo.update`) runs outside any try; its callers don't catch, so a refusal propagates to
`kels.js` `main().catch` ("Sorry, something went wrong: …", `kels.js:500`) or, from a menu reached
through Save for later / Cancel, an unhandled rejection with the chat simply stopped. Compare
`setStatus` (:341), which catches.
**Scenario** In the Demo, a litter with a pickup that's passed: "Did they go home?" → **Yes, mark
the sale delivered** → "Sorry, something went wrong: This is a demo — changes aren't saved." and
no buttons at all; only Cancel in the header. In Pro, any refusal of the ownership update after
the sale is saved Delivered ends the chat the same way, the roster question never asked.
**What I'd do** Catch around each of the check-in's writes as `setStatus` does (or one catch in
the decisions loop, as `FindingsTask.loop` has), so a refusal is said and the visit goes on.

## 7. A resumed form draft overwrites the form she edited on its page  (S2, verified (code))
**Where** `guidedForm.emptyDraft` / `startFrom` copy `form_questions` and `application_faq`
when she starts; `saveGuidedForm` (`shared/data/guidedForm.js:160`) writes the draft's copy over
the kennel's config; nothing compares it with what's saved now.
**Scenario** She starts Set up my application form in Kels, gets halfway, and puts it off. Later
she adds a question and fixes an FAQ answer on the Application form page (or on her other
device). Weeks on, the dot says "Finish Briar Hollow's application form"; she finishes and taps
**Yes, build it**: her page edits are gone, and with her list online families now see the older
wording. The review shows the whole form, but not that it differs from the one saved.
**What I'd do** Keep the config's `updated_at` (or a hash) in the draft; on resume, if the saved
form changed, say so and offer "start from what's saved now" or "keep my draft".

## 8. The standard intro promises a draft and an approval the task doesn't have  (S3, verified (code))
**Where** `KELS_INTRO` (`shared/assets/kelsChat.js:31`), the default `how` of `chat.intro`, is
said by Tidy up my records, Check in on a litter, Pups are going home, Check account health and
Set up my waitlist (`tidyUpUI.js:62`, `litterCheckinUI.js`, `prepPupsUI.js`, `accountHealthUI.js`,
`waitlistSetupUI.js`): "once I'm done collecting the information, I'll build the records for you
to approve. If you get stuck or need to save and come back, I'll save what we've got so far".
**Scenario** In Tidy up, she taps **Change the count to 5**: the litter is changed that moment,
with no plan to approve. Midway through the check-in she closes the tab, trusting "I'll save what
we've got": the weights she saved stay, but there's no "Pick up where we left off", no Save for
later button, and the next check-in starts over.
**Why it matters** The plan's question 2 (nothing written without her saying so) turns on her
knowing each tap saves; here she's told the opposite.
**What I'd do** A second intro for the save-as-you-go tasks ("I'll save each thing as you
approve it…"), as Getting Started already has `SETUP_HOW`.

## 9. "Save for later" before there's anything to save  (S3, verified (code))
**Where** `kels.js:462`. The button shows as soon as a resumable task starts (`running(task)`
before `task.run`), but the drafts are written only from the first step's `ask`
(`kelsSteps.js:216`); Set up my application form also asks "Which kennel?" before making its
draft.
**Scenario** She opens Record a new litter, sees the intro, gets a phone call and taps **Save
for later**: "Saved! I'll keep what we've got until you're ready to continue. Just tap me any
time." Next time there's no "Finish recording…" and no dot.
**What I'd do** Show Save for later only once the task's draft exists (or make the draft at
start).

## 10. Cancel skips the website check, and the next task's baseline hides it  (S3, verified (code))
**Where** The check runs only from `onExit` (`kels.js:373`); Cancel (`:471`) and Save for later
(`:462`) go straight to the menu, and a task ending in its own link (the check-in's "the
litter's page", `litterCheckinUI.js:373`; prep pups, `prepPupsUI.js:424`) leaves the page.
`startTask` then calls `noteWebsiteBaseline` (`:399`), so the next check counts only from there
(`websiteUpdateUI.js:342-344`: nothing new, nothing asked).
**Scenario** In the check-in she sets two pups' plans to Available and marks the litter Ready,
then taps **Cancel** ("Anything already saved to your records stays"). Kels doesn't offer the
website check. She runs Log health test results next: it changes nothing the site shows, so
Kels asks nothing, though her website still shows the old plans. (Plan item 7: a task that
changed nothing website-facing does skip a check that was needed, the one the cancelled task
owed.)
**What I'd do** Run the check from Cancel too (for a non-resumable task, or whenever something
was saved), and take the next baseline only after it.

## 11. Getting Started's Puppy Record part wipes her choices  (S3, verified (code))
**Where** `kelsSetupUI.js:286`: "Right now they show everything. Want to keep it that way…" is
said whatever `kennel.puppy_record_fields` holds; the primary **Show everything** then writes
`puppy_record_fields: null` (:289).
**Scenario** She left the price and her notes off the puppy records last week. She runs Getting
Started again (it sits at 95 until she has a dog, #12): Kels says they show everything, she taps
the highlighted **Show everything** to "keep it that way", and the next families' puppy records
print the price.
**What I'd do** Say what's left off now, and make the primary choice "Keep it as it is".

## 12. Getting Started starts over every time  (S3, verified (code))
**Where** `Setup.start` (`kelsSetupUI.js:87`) runs every part of `setupParts` in order with no
note of which she has done; `setupPriority` keeps it at 95 while `isNewProgram` (no dog record).
**Scenario** Pro, a new kennel: she does the logo, nudges, tests, Puppy Record, extras and
accounts, then stops at Another kennel to look something up. Next time it opens at the logo
again ("Keep it"), the nudge form, the tests list, the Puppy Record question (#11)… six answers
to get back to where she was. The plan's question 1: resuming starts again.
**What I'd do** Remember the parts answered on this device and offer "pick up at Another
kennel" (each part still re-runnable from the menu).

## 13. Add people tags someone Buyer before she adds their application  (S3, verified (code))
**Where** `guidedPeopleUI.js:419`: `contactRepo.ensureType(contact.id, 'buyer')` runs before
`askApplicant`; **Not now** (`:424`) leaves them off the list but keeps the type.
**Scenario** She ticks her groomer by mistake under "Do any of these need to go on your
waitlist?", then taps **Not now** on the application. The groomer is now a Buyer in her contacts
(and in every buyer picker, buyers first).
**What I'd do** Add the type once the application is saved.

## 14. A family she types in herself: approved in one task, "to approve" in two others  (S3, verified (code))
**Where** Add people approves at once (`guidedPeopleUI.approveApplicant`, guide §33 "She added
them herself, so it's then approved"); Set up my waitlist's families she already has
(`waitlistSetupUI.js:397`) and Set up my application form's **Add a family**
(`guidedFormUI.js:364`, "ready for you to approve") save the same applicant step's entry as
`applied` and stop.
**Scenario** She enters her six existing families through Set up my waitlist. Review my waitlist
(priority 58 with applications waiting) then asks her to approve each of the six, and to settle
each fee, questions Add people would have asked once, in the chat, as she entered them.
**What I'd do** One rule for "she typed this family in herself", in the applicant step, used by
all three.

## 15. The vet question: declined in one task, asked again in the other  (S3, verified (code))
**Where** `guidedPeople.asksVet` (`shared/data/guidedPeople.js:95`) asks whenever her contacts
have no vet; the answer lives only in that draft. Tidy up's "No vet to add, don't ask again"
(`tidyUpUI.js:639`) dismisses `tidy:no-vet` in the nudge ledger only.
**Scenario** A breeder whose vet is her husband (or who keeps no vet in contacts) tells Tidy up
not to ask again; every Add people run still opens a "Do you have a vet you'd like to add?"
step, and "Not now" there is forgotten by the next run.
**What I'd do** One remembered answer for both (the ledger key Tidy up already writes).

## 16. A draft-version bump silently throws away unfinished work  (S4, verified (code))
**Where** `pendingLitterDraft` (`guidedLitterUI.js:577`) and `pendingDogsDraft`
(`guidedDogsUI.js:418`) clear a draft whose `v` isn't `DRAFT_VERSION`; `pendingPeopleDraft` /
`pendingFormDraft` ignore it (it lingers, and `app.js:28` still shows the dot for it).
`guidedLitter.js:41`: version 2 already dropped every version-1 draft once.
**Scenario** The next release that adds a litter step bumps the version. A breeder whose litter
save had stopped partway (a refused pup, a lost connection to nothing, a Lite cap) has its
litter and some pups already made, with their ids only in the draft; after the update the draft
is gone with no word, and so is the retry that wouldn't duplicate them.
**What I'd do** Migrate a draft forward where possible; where not, say so ("I couldn't keep your
unfinished litter after the update"), and never drop one that holds saved ids without telling
her what was already made.

## 17. `?task=` ignores whether the task is available  (S4, verified (browser))
**Where** `kels.js:492-497`: `taskById(param('task'))` runs with no `available(state)` check.
**Scenario** Lite, `pages/kels.html?task=add-people`: Kels greets, echoes "Add people", then
"Sorry, something went wrong: Failed to fetch dynamically imported module: …/assets/guidedPeopleUI.js"
(the file isn't in the Lite build). Demo, `?task=get-started`: "Which kennel are we setting up?",
a task the Demo excludes because it saves. No Lite or Demo door links these today; the next
shared page that adds one (a Pro page's door copied into a shared one) will.
**What I'd do** Fall back to the menu when the asked task isn't available.

## 18. The tour's place is an array index  (S4, verified (code))
**Where** `wizardState.getWizardStepIndex` (`shared/data/wizardState.js:24`), stored by
`setWizardStepIndexRaw`; `wizardSteps.js` says steps have "stable string ids (never array
position)", but the state is a position.
**Scenario** A release adds or removes a stop before hers; "🧭 Resume tour" lands on a
different step (or the last, clamped), possibly on another page.
**What I'd do** Store the step id; find its index at load.

## Notes, not findings

- **Abandonment, task by task** (plan question 1). *Drafted* (Record a new litter, Add dogs, Add
  people, Set up my application form): every answer and the chat are kept after each step;
  nothing is written before **Yes, build it**; a save that stops partway keeps the ids it made,
  so a retry makes nothing twice (tested). A reload resumes at the step she was on, with the chat
  replayed. *Save as you go* (both check-ins, Log health test results, Tidy up, Pups are going
  home, Check account health, Set up my waitlist, Review my waitlist, Set up my accounts):
  each approved thing is saved at once; a reload starts the task over and "Not now" answers are
  forgotten (by design: once per visit). *Getting Started*: starts over (#12). *Find, Understand,
  How my business is doing*: read-only. *The tour*: its index is kept. *KennelAssistant*: each
  entry saved at once, pending until acknowledged.
- **Add people → the waitlist** isn't resumable: once the people are saved the draft is cleared,
  so a reload during the applicants leaves those she ticked but hadn't reached off the list,
  with nothing to remind her. Each saved application stands on its own, so it's untidy, not
  broken.
- **Cancel during "Building…"**: the save's `onProgress` rewrites the draft after each record,
  so a Cancel confirmed mid-save is undone by the next write. Narrow (the modal is in the way).
- **Lite, Add dogs at the cap**: the dog that hits the cap has its typed parents (pedigree-only)
  made before the refusal, so they're left over; harmless (they don't count) but untidy. The dogs
  not made are dropped with the draft, as rule 3 says.
- **Picks preview handoff** (plan item 7): the litter check-in passes its own litter
  (`litterCheckinUI.js:288`) and Review my waitlist the nudge's litter id
  (`waitlistReviewUI.js:297`); closing the preview says "Okay, picks aren't open" and both carry
  on. Fine.
- **Merge and drafts**: `recordMerge` → `settings.remapStoredIds` follows merged ids into all
  four drafts. Good; the gap is deletion (#2), not merging.
- **`kelsSteps.back()`** removes "the last three rows" of the chat; after a Change from the plan
  ("Let me change something.") or a moved lead line it can take off the wrong bubbles. Cosmetic.
- **Tidy up's merge** deletes the other record on the second tap of "Which record should I
  keep?" when the two don't disagree; there's no final "Merge" button in that case. The lead
  line says so; worth a confirm given it can't be undone.
- **Check in on my dogs** with no Active breeding dog: the intro is said and agreed to, then
  "nothing to check". The Dogs page's door shows to everyone.

## Coverage gaps I found (tests that should exist)

- `saveGuidedLitter` under the Lite cap hooks (the assembled `dist/lite` editionConfig, or a
  stub cap): nothing made when the litter is refused (#1). `tests/guidedDogs.test.js` stubs the
  cap; the litter suite doesn't.
- Clear sample data / Replace restore clear (or invalidate) `kennelOS.guided*Draft` (#2).
- A resumed litter draft with a matching litter recorded since (#3).
- `importAssistantEvents` with an `update` row whose local copy was edited or archived (#4).
- `kels.js`: no test at all. A `?task=` for an unavailable task; the Demo's menu.
- Getting Started's Puppy Record part with fields already left off (#11).

## What I did not get to

- The Kels tasks the plan's K11 list doesn't name were read only where noted:
  `waitlistSetupUI.js`, `waitlistReviewUI.js`, `accountHealthUI.js`, `prepPupsUI.js`,
  `dogCheckinUI.js`, `healthTestsUI.js`, `waitlistFeeStep.js`, `vendorKeyUI.js` (their writes
  before a confirm, and their Demo behaviour, are unreviewed beyond #5, #6, #8 and #10).
- `tidyRules.js`'s rules themselves (K6 / K9 read the ones they own).
- Kels's words (plan question 6) were read for the intros, Getting Started and the Demo error,
  not swept step by step across every script.
- Phone layout of the chat at 320 px (K15), and a real-device run of the tour.
- The KennelAssistant helper app's own screens (`shared/assistant.js`): read for its writes only.
