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
  comparison. Seven decisions (D1–D7) wait on the owner.
- README's doc map gains the plan's row. Docs only: no code, tests or service-worker
  change.

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
