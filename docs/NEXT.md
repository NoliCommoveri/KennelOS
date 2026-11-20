# KennelOS — the next release (`next` branch)

What's on the `next` branch that `main` doesn't have yet. `next` publishes the test build
at **next-pro.kennelos.app** (Pro only; staging servers; no license gate; see
`build/README.md` "Next channel"). Work for the next release is recorded **here**, not in
`docs/BUILD_LOG.md` or the End-State guide, until it's brought in (CLAUDE.md "Next
release"). The copy of this file on `origin/next` is the one that counts:
`git show origin/next:docs/NEXT.md`.

## On next now

Rewrite this list as work lands or changes (a snapshot, like README's Status).

- Docs only so far: the UI redesign's plan and prototype (`docs/KennelOS_UI_Redesign_Plan.md`,
  `docs/design/forest-look-prototype.html`), with the prototype's placeholder screens being
  drawn in, a batch at a time, for the owner to approve (Home's screens and Dogs so far).

Candidates, from the plans: Line Management Phase 1 (relationships, COI and pairing
warnings; no schema change), the UI redesign (`docs/KennelOS_UI_Redesign_Plan.md`; the
prototype is `docs/design/forest-look-prototype.html`), program types.

## Log

Append one entry per batch merged into `next`, newest last, in the build log's format
(`## YYYY-MM-DD: title`, what changed, files, tests, service worker). At bring-in these
entries move to `docs/BUILD_LOG.md` and this section is emptied.

## 2026-11-19: The UI redesign's plan, and the prototype in the repo

- The forest-look prototype (the owner's artifact "KennelOS Forest Look", 2026-11-18) is
  copied to `docs/design/forest-look-prototype.html`, so builds are checked against a
  fixed copy.
- `docs/KennelOS_UI_Redesign_Plan.md`: what moves where, phases 0–9, and the fidelity
  rule (every style value comes from the prototype; departures need the owner's yes and
  go in `docs/design/departures.md`), checked by a token test and a Playwright style
  comparison. The owner took every recommendation for D1–D7 (dark mode built, one page
  per hub, fonts after first paint, no planned placeholders, released together, family
  pages keep their themes, synced settings listed for her before Setup).
- README's doc map gains the plan's row. Docs only: no code, tests or service-worker
  change.

## 2026-11-19: D8, one person, one page

- `docs/KennelOS_UI_Redesign_Plan.md` §8 gains **D8** (the owner's): no applicant page apart
  from the person's page; one set of name, email, phone and address, shown once and changed
  where she is; never a second set that looks editable but isn't; no screen explains how
  records are stored. The prototype's separate Waitlist family and People screens are an
  approved departure (`docs/design/departures.md`). The live-app stopgap is on `main`.
- Docs only: no code, tests or service-worker change.

## 2026-11-19: The prototype draws D8

- `docs/design/forest-look-prototype.html` is the owner's prototype with D8 drawn in, in its
  own styles (hub head, tiles, rows, the `.dates`-style inputs as `.form-stack`): one person
  page from the Waitlist, People, a sale or search; details once at the top; **Edit** →
  **Their details**; the application as answers only; every waitlist family and client in
  People; search finds people by email and phone; a Design notes section. Published as the
  artifact `KCfKzER1Fo7aEYd7idfpS4`. Since the prototype now has it, it's no longer listed
  in `docs/design/departures.md`.
- Docs only: no code, tests or service-worker change.

## 2026-11-19: D9, Pricing and schedules

- The owner's D9 in `docs/KennelOS_UI_Redesign_Plan.md` §8: usual prices (male and female,
  full registration), deposit, when payments are due, ways families pay, and saved payment
  schedules on one screen, Business › Pricing and schedules; Setup's row opens it.
- The prototype (`docs/design/forest-look-prototype.html`, artifact `KCfKzER1Fo7aEYd7idfpS4`
  version 2) draws it in its own styles: "A usual sale" card, question rows (now one shared
  `qRow`), saved schedules; Setup's Payments & invoices becomes Invoices & receipts; search
  finds each question.
- Docs only: no code, tests or service-worker change.

## 2026-11-19: D10, her own answers; the prototype's icons built in

- The owner's D10 in `docs/KennelOS_UI_Redesign_Plan.md` §8: amounts, times and lists end in
  a + to add her own, which becomes one of her choices; fixed questions keep their choices.
- The prototype (artifact `KCfKzER1Fo7aEYd7idfpS4` version 3, `docs/design/forest-look-prototype.html`):
  the + on Setup's and Pricing and schedules' questions; **New schedule** moved onto the Saved
  schedules heading; the 126 Lucide 0.460.0 icons it uses built into the page (they didn't
  draw in the phone app when loaded from unpkg).
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype draws Home's screens

- `docs/design/forest-look-prototype.html` draws five screens that were `stub:` placeholders,
  in its own components and tokens: **Reminders** (Overdue / Next 7 days / Later, a row opens
  to Done and Snooze, a Done tab, the filter sheet), **Coming up** (from today on, by week,
  filterable), **Calendar** (month grid with dots on a phone and names on desktop, a day's
  list, Add to Google Calendar, the planned calendar feed), **Notifications** (the bell: new,
  then earlier; the dot clears once seen) and **Kennels** (hers, the switch when More than one
  kennel is on, outside kennels). One agenda feeds the first three. Search finds them; a
  Design notes section explains them. Not yet seen by the owner.
- `docs/KennelOS_UI_Redesign_Plan.md` notes that the repo copy now draws screens beyond the
  artifact, each a proposal until she approves it.
- Docs only: no code, tests or service-worker change.

## 2026-11-20: The prototype draws the Dogs screens

- `docs/design/forest-look-prototype.html` draws six more `stub:` placeholders in its own
  components and tokens, sharing one set of form parts (titled cards over the `.form-stack`
  look, chips with D10's + where she'd name her own): **Add dog** (what kind of dog first; a
  puppy starts from its litter; papers and ownership on request; a duplicate name warns),
  **Edit dog** (every question open, status, the puppy's plan, ownership, online, Archive),
  **Add event** (the types she uses most, then by kind, only the ones that fit the dog or
  litter; each type's own questions from today's event types; cost becomes an expense; Remind
  me feeds Reminders), **Log a test** (still-to-do tests first, filed by name, result chips,
  Overall, certificate, what families see), **Pedigree** (3–5 generations, tap to re-center,
  + adds a missing parent) and **Dog card** (who it went to, what travels and what never does,
  send again as a link, code or file; live updates still planned). Saving updates the
  prototype's sample data. A Design notes section explains them. Not yet seen by the owner.
- Docs only: no code, tests or service-worker change.

## Guide changes waiting

End-State guide (`docs/End_State_Design_and_Maintenance_Guide.md`) edits that work on
`next` needs, written out here instead of in the guide: section, and what to add or change.
Applied to the guide at bring-in.

(none yet)

## Bringing it in

When the owner says to release what's on `next`:
1. A PR from `next` into `main`.
2. In that PR: move the Log entries above into `docs/BUILD_LOG.md`; apply the guide changes
   above; update README Status; ask about the service-worker cache bump (CLAUDE.md).
3. After it merges: reset this file to "Nothing yet", and merge `main` back into `next`.
