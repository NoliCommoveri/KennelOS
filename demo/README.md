# demo/ — KennelOS Demo (seeded, read-only showcase)

Demo is the Pro feature set with **demo mode on**: pre-loaded with realistic sample
data, every write a friendly no-op ("changes aren't saved"), re-seeded clean each
visit. It's the "try before you buy" reachable from Lite's "See the full app →"
link. The save/export paths are stripped so an unlocked copy is a dead end
(editions plan §Demo).

**Deployment model:** a Demo origin serves `shared/` + `pro/`'s pages with this
dir's `editionConfig.js` (`demoMode: true`) at the shared fixed path.

## What's here (built & browser-verified)

- `editionConfig.js` — `demoMode: true`, full-feature flags, full nav **minus
  Import/Export** (the save/export path is stripped).
- **Read-only write short-circuit** — `shared/data/demoMode.js` is the one lever:
  `assertWritable()` is called at the top of every repo write (repoBase's
  `create`/`update`/`hardDelete`, and `fileRepo`), and it throws a friendly
  `DemoModeError` ("This is a demo — changes aren't saved") in demo. The sample-
  data seed writes through the same repos, so it runs inside `withSeedAllowed()`,
  a window user writes never get.
- **Auto-seed on load** — `app.js` seeds the sample packet when the DB is empty
  (through the seed window) and reloads once so the page renders against seeded
  data. Writes are blocked, so it stays pristine across visits without re-wiping.
  Demo also skips the first-run / kennel-setup / sample-data prompts and shows a
  persistent "read-only demo" banner instead.
- **Save/export stripped** — Import/Export is dropped from the nav *and* excluded
  from the demo build by `assemble.mjs` (a direct URL 404s, like a Pro page does
  in Lite). `restoreBackup()` also asserts writable as defense-in-depth.
- `sw.js` is generated per edition by `assemble.mjs` (demo cache name + precache
  filtered to what the demo build actually ships).
