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
| `showPoints.test.js` | The derived show-points engine (Show Tracking Spec §4) — per-show cap, majors under distinct judges, ignored events (not shown / wrong track / archived), string-point coercion, GCH counting only after CH (logged title or completed track) with `notCounted`, champion defeats, the completing-win date. |
| `eventRepo.test.js` | `testTokensOf` — the health-test name derivation across the three test-bearing event types. |
| `editionConfig.test.js` | The shared (Pro/Demo) config stays a no-op so no cap logic runs in those builds. |
| `csvImport.test.js` | The match-or-create engine's `classify()` for all 8 entity mappings — natural-key formation (case-insensitive+trimmed names, exact dates), keyless/unresolved-relationship rows forced to review, and each mapping's quirks (Sale/StudService inline-contact auto-create, Event's title tiebreak, StudService's always-ambiguous repeat-arrangement rule, Expense's mileage/receipt-number/subject rules). Bypasses `loadExisting()` (real Dexie) by seeding each mapping's private `this._foo` caches directly and driving `buildIndex()`/`classify()`, the same DB-free seam `scopePredicates.test.js` uses. `buildPlan`/`commitPlan`/`stampKennelScope` stay out of scope (real repo writes). |
| `waitlistForm.test.js` | Her application form (`data/waitlistForm.js`, Waitlist Spec §15.1): locked questions always restored and never retyped, no program question, answers keeping the wording they were given under, CSV question import (map / new / skip, type guessing, re-import maps everything), plus the public list (`waitlistRules.publicList`, §15.3): allow-listed fields only, real positions with paused families' numbers skipped. |
| `invoicePdf.test.js` | The jsPDF renderer behind Download PDF (`assets/invoicePdf.js`, §15.2), run through the vendored UMD build itself: a real PDF carrying the document's text, page overflow, and text the standard fonts can't draw made safe. |

## Adding tests

Name files `*.test.js` under `tests/`. Import app modules by relative path
(`../shared/data/<module>.js`). Keep them dependency-free and independent of
IndexedDB/DOM — if a module only pulls those in lazily (inside functions), it's
importable here; if it touches them at module top level, it isn't.
