# KennelOS — the next release (`next` branch)

What's on the `next` branch that `main` doesn't have yet. `next` publishes the test build
at **next-pro.kennelos.app** (Pro only; staging servers; no license gate; see
`build/README.md` "Next channel"). Work for the next release is recorded **here**, not in
`docs/BUILD_LOG.md` or the End-State guide, until it's brought in (CLAUDE.md "Next
release"). The copy of this file on `origin/next` is the one that counts:
`git show origin/next:docs/NEXT.md`.

## On next now

Rewrite this list as work lands or changes (a snapshot, like README's Status).

- Nothing yet: `next` is the same as `main`.

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
