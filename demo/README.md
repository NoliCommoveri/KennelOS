# demo/ — KennelOS Demo (seeded, read-only showcase)

Demo is the Pro feature set with **demo mode on**: pre-loaded with realistic sample
data, every write a friendly no-op ("changes aren't saved"), re-seeded clean each
visit. It's the "try before you buy" reachable from Lite's "See the full app →"
link. The save/export paths are stripped so an unlocked copy is a dead end
(editions plan §Demo).

**Deployment model:** a Demo origin serves `shared/` + `pro/`'s pages with this
dir's `editionConfig.js` (`demoMode: true`) at the shared fixed path.

## What's here today (foundation)

- `editionConfig.js` — no-op cap hooks + a `demoMode` flag placeholder.

## Not built yet

- The demo-mode write short-circuit in the shared repo layer, auto-seed-on-load,
  the stripped save/export paths, and its own `sw.js`.
