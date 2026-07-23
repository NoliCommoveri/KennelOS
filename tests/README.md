# tests/ — regression suite

Zero-dependency regression tests using Node's built-in test runner (`node:test` +
`node:assert`). No framework, no `npm install`, nothing vendored — the same spirit
as the app itself. Requires Node ≥ 18 (CI uses 20).

```sh
node --test      # or: npm test  (auto-discovers tests/*.test.js)
```

The repo's root `package.json` exists only to mark the tree as ES modules for Node
(so it can import the app's `.js` files) and to provide the `test` script. It is
**not** part of any edition artifact — `build/assemble.mjs` only copies `shared/`.

## What's covered (and why these)

These target the **pure, invariant-critical logic** — the parts where a silent
regression would corrupt data or misgate an edition. Anything that needs a live
IndexedDB (repo CRUD, referential *counting*, end-to-end restore) is out of scope
here (it would need a fake-IndexedDB dependency); those stay on the manual
serve-and-exercise verification in `CLAUDE.md` / the End-State guide.

| File | Pins |
| --- | --- |
| `rosterCount.test.js` | The active-roster classification + the import-cap set math behind the Lite dog cap and the JSON-restore cap (cap spec §2/§9). |
| `license.test.js` | The Pro license verdict state machine — interval detection and the grace windows (**yearly 7d, monthly 3d**), lifetime/expired/revoked branches. |
| `importExport.test.js` | The Blob ⇄ base64 marker round-trip that keeps documents/receipts durable across backup + Dropbox sync. |
| `serviceWorker.test.js` | The precache ↔ disk bijection (CLAUDE.md's most-forgotten step), promoted from the End-State guide's Python snippet. |
| `referenceRegistry.test.js` | Structural integrity of the FK registry that drives hard-delete blocking. |
| `dateUtils.test.js` | The date-only (YYYY-MM-DD, local) helpers the repos and nudges build on. |
| `eventRepo.test.js` | `testTokensOf` — the health-test name derivation across the three test-bearing event types. |
| `editionConfig.test.js` | The shared (Pro/Demo) config stays a no-op so no cap logic runs in those builds. |

## Adding tests

Name files `*.test.js` under `tests/`. Import app modules by relative path
(`../shared/data/<module>.js`). Keep them dependency-free and independent of
IndexedDB/DOM — if a module only pulls those in lazily (inside functions), it's
importable here; if it touches them at module top level, it isn't.
