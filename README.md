# KennelOS — Lite / Pro / Demo editions

Local-first, static, multi-page dog-breeding records app (no backend, no build
step), split into editions. One shared core; thin editions on top.

```
shared/   The database, repos, vocab, shared pages (Dogs, Breeding, Sales,
          Today, …), assets, vendor, and editionConfig.js (the per-edition
          injection point — this copy is the Pro/no-op default).
lite/     Lite (free): shared pages only + a soft cap + archive-on-departure.
pro/      Pro (paid): the full app; holds the Pro-only pages + license gate.
demo/     Pro with demo mode on: seeded, read-only showcase.
```

Each edition deploys to **its own origin** (a subdomain) so its IndexedDB stays
isolated; JSON export/import is the Lite→Pro upgrade bridge. See
`docs/KennelOS_Lite_Pro_Editions_Plan.md` and `KennelOS_Lite_Cap_Enforcement_Spec.md`
(carried over from the original repo) for the full design.

## Build status

- **Foundation (in progress):** the app is relocated into `shared/`; the
  editionConfig injection point is wired (no-op) into `dogRepo.create/update` and
  `litterRepo.create`; `lite/pro/demo/` exist as config skeletons. **No behavior
  change yet.**
- **Next:** the shared↔Pro page partition, then Lite's real cap + archive-on-
  departure + hidden-archive links + reduced nav + per-edition service workers.

## Local dev

Serve the repo over HTTP (never `file://`): `python3 -m http.server 8000`, then open
an edition. Full app today lives under `shared/` (`shared/index.html`).
