# lite/ — KennelOS Lite (free edition)

Lite is the free front door. It ships **only the shared pages** (Dogs, Breeding,
Sales, Today, …) plus a soft cap (6 counting dogs, 2 litters) and the
archive-on-departure exit. Pro-only sections (Contacts, Stud services, Contracts,
Companion, Assistant, Documents/receipts) are **physically absent** — they live in
`pro/`, so there's nothing to unlock here.

**Deployment model:** a Lite origin serves `shared/` + `lite/`, with this dir's
`editionConfig.js` placed at the shared fixed path so the cap is active. See
`docs/KennelOS_Lite_Pro_Editions_Plan.md` and `KennelOS_Lite_Cap_Enforcement_Spec.md`.

## What's here today (foundation)

- `editionConfig.js` — Lite's config slot. **Still a no-op** — the cap enforcement
  and the archive-hiding flags are the next pass ("layer cap logic on top").

## Not built yet

- The Lite home page + reduced nav.
- Its own `sw.js` precache list + cache name.
- Real cap enforcement, archive-on-departure, hidden-archive links, ownership-vocab
  restriction, upgrade nudges, and the export→checkout→import upgrade bridge.
