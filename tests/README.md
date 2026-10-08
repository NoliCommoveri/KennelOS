# tests/ — regression suite

Zero-dependency regression tests using Node's built-in test runner (`node:test` +
`node:assert`). No framework, no `npm install`, nothing vendored — the same spirit
as the app itself. Requires Node ≥ 18, and Node ≥ 22 for anything that loads the cloud Worker (`node:sqlite`): `cloudClient.test.js` and `cloud/tests`.

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
| `syncRegistry.test.js` | The cloud-backup allow-list (Cloud Phase 1 plan §5): every `db.js` table has an entry; each field sits in one bucket; **coverage**: every key the real Thornfield seed writes is classified; the cloud projection of that packet carries no private/pending key and passes `assertCloudRow`; the event-details filter matches `vocab.js`; documents/files/expenses row rules. Runs the real seed through the real repos against `support/memoryDb.js`, an in-memory stand-in for the Dexie tables (the one place IndexedDB is faked, so it's kept to the API slice the repos use). |
| `cloudBackup.test.js` | Cloud Phase 1 §9 step 2: `buildCloudSnapshot` (sample rows dropped, cloud-tier projection, file bytes deduped by sha256 with the blob out of the JSON, the envelope), gzip round trip, the shrink-guard thresholds, and the `'cloud-merge'` restore (private fields survive, missing rows inserted, newer-wins vs `overwrite`, `events.details` merged by key, files fetched by sha256, never deletes, format check), plus the `cloudDirtyAt` signal. On `support/memoryDb.js`. |
| `cloudDirty.test.js` | Every direct `db` write site in the app, counted per file: each writer calls `markDataChanged()` or is exempted with a reason (sample-data clear, Reset App). A new write site fails it. |
| `cloudClient.test.js` | Cloud Phase 1 §9 step 4: the client modules (`data/cloud/cloudConfig`, `cloudApi`, `cloudAuth`, `cloudBackup`) end to end against the **real Worker code** (`cloud/src`) in-process, on the cloud tests' node:sqlite D1 + in-memory R2 (`cloud/tests/helpers`), with `fetch` routed to `worker.fetch`. Sign-in by code, push / unchanged / offline / maintenance / expired session, files uploaded once and first, the shrink guard, two simulated devices through the 409 → restore → takeover → replace sequence, Reset App, restore as of, delete, turn off, and the scheduler's timing. Also: no request at all when there's no server. Lost device (plan §2.5, `cloudDevices`): the check-in and its throttle, a remote erase landing at the check-in or at any other request (every table and every `kennelOS.*` key gone, the device's own activation released, the server told, with a retry when that fails), the fresh-sign-in code, cancel, and freeing a device's Pro license with Lemon Squeezy stubbed (the key never reaches our server). Needs Node ≥ 22 (`node:sqlite`). |
| `cloudEntitlement.test.js` | License Link Plan step 3: `data/cloud/cloudEntitlement` end to end against the real Worker code: Pro by the purchase email, the cache, linking another purchase email by code (and unlinking), a new sign-in never seeing the old answer, and `cloudUrl: null` making no request. |
| `waitlistProjection.test.js` | Waitlist W2 Plan step 2: `data/waitlistProjection.js`, one kennel's waitlist as published online — its allow-list (nothing private: other answers, phone, address, programs, notes, payment details), the unpaid fee shown only while approved and unpaid, closed entries reduced to their outcome, archived and other kennels left out, positions / litter queues / the public list straight from the rules engine, every eligible family per litter, and a stable result in any input order. |
| `cloudWaitlist.test.js` | Waitlist W2 Plan step 2: `data/cloud/cloudWaitlist` end to end against the real Worker code with the real seed: no request when nothing is online or it isn't offered, publish once then only after a change, unpublish when taken offline, the recorded reasons (signed out, backup off, not the backing device, not Pro), a status link minted for every family and **New link** replacing only theirs, the online form end to end (form key made and published, an application sealed, confirmed by code and taken in as an applied family with its link, a reset phone filling in answers, rotation), and where links point (staging itself, production `apply.kennelos.app`). Step 5: a signed-in family's pick, pause request, still interested and sealed message reach her device (the Sale made, the pause waiting, the message on the entry, the server's hold released by the next publish), Today's Approve / Mark read, each event applied once, a new backing device starting where the last got to, a non-backing device applying nothing, her request decisions (logged as theirs; a decline logged too), and a refused action becoming a line for her. Needs Node ≥ 22. |
| `waitlistTurns.test.js` | Waitlist Spec §16.1 (W2 step 5c part 1): the offer flow as turns through the real actions on the in-memory database: one family at a time across the open litters, a turn covering every open litter they match, only a pass on all of it counting (once), a pick moving between a turn's litters, the deposit ending the whole turn, a litter joining a turn mid-way, no response / void / undo on the whole turn, and leaving the list moving the kennel on once. Part 2 (§16.2, §16.5): "Not this litter" pending until the turn, left out of it, a turn of nothing else passed at once (counting once) and the list moving on, the family's pass reason saved, none on hers. |
| `waitlistEvents.test.js` | Waitlist W2 step 5: `data/waitlistEvents.js` plans a family's status-page action against her records now: a pick or pass that still fits is recorded and one that doesn't becomes a line for her, leave → withdraw, still interested → a line, a pause / answer change / narrower listen-only change → a request she decides, a wider listen-only change applied; server moves (step 7) skipped. Plus `waitlistRules.listenChangeKind` and `listenParentChoices`. |
| `waitlistCrypto.test.js` | Waitlist W2 step 4: an application sealed by the family page (`cloud/public/family/seal.js`) opens with her form key (`data/waitlistCrypto.js`) and only that key; tampering, relabelling and junk are refused; rotation keeps old keys working; long applications. |
| `waitlistInbox.test.js` | Waitlist W2 step 4: `data/waitlistInbox.js` turns an opened application into an `applied` entry, dropping anything off her form, off her choices, oversized or outside the vocab (a breed only one of hers), with the arrival day in the kennel's time zone. |
| `familyPages.test.js` | Waitlist W2 Plan step 3: the family pages' copied labels match `vocab.js`; their search (a number is a position; otherwise name, any case or accent, or date), dates, possessives and escaping; and no inline script/style or outside URL in `cloud/public/family/` (the pages' CSP forbids them). |
| `vaultCrypto.test.js` | Private Vault Plan §9 step 1: the vault's WebCrypto (codes, wraps, payload and deterministic file ciphertext; a wrong secret or tampered bytes fail). |
| `cloudVault.test.js` | Private Vault Plan §9 steps 3–6: the vault's client flows end to end against the real Worker code (as `cloudClient.test.js`): turning it on, the leak test, unlock by recovery code, by another device and by **passkey** (a fake PRF authenticator, `support/fakePasskeys.js`), the locked pause, re-keying, restore. |
| `vaultPasskey.test.js` | Private Vault Plan §5.2: the WebAuthn/PRF wrapper (`data/cloud/vaultPasskey.js`): the `kennelos.app` RP ID, support detection, a stable PRF output per passkey and salt, and the unsupported / cancelled / duplicate cases. |
| `csvImport.test.js` | The match-or-create engine's `classify()` for all 8 entity mappings — natural-key formation (case-insensitive+trimmed names, exact dates), keyless/unresolved-relationship rows forced to review, and each mapping's quirks (Sale/StudService inline-contact auto-create, Event's title tiebreak, StudService's always-ambiguous repeat-arrangement rule, Expense's mileage/receipt-number/subject rules). Bypasses `loadExisting()` (real Dexie) by seeding each mapping's private `this._foo` caches directly and driving `buildIndex()`/`classify()`, the same DB-free seam `scopePredicates.test.js` uses. `buildPlan`/`commitPlan`/`stampKennelScope` stay out of scope (real repo writes). |
| `waitlistForm.test.js` | Her application form (`data/waitlistForm.js`, Waitlist Spec §15.1): locked questions always restored and never retyped, no program question, answers keeping the wording they were given under, CSV question import (map / new / skip, type guessing, re-import maps everything), plus the public list (`waitlistRules.publicList`, §15.3): allow-listed fields only, real positions with paused families' numbers skipped. |
| `invoicePdf.test.js` | The jsPDF renderer behind Download PDF (`assets/invoicePdf.js`, §15.2), run through the vendored UMD build itself: a real PDF carrying the document's text, page overflow, and text the standard fonts can't draw made safe. |

## Adding tests

Name files `*.test.js` under `tests/`. Import app modules by relative path
(`../shared/data/<module>.js`). Keep them dependency-free and independent of
IndexedDB/DOM — if a module only pulls those in lazily (inside functions), it's
importable here; if it touches them at module top level, it isn't. The one exception
is `support/memoryDb.js`, which stands in for the Dexie tables when a test needs the
real sample seed (`syncRegistry.test.js`, `cloudBackup.test.js`), and
`support/fakePasskeys.js`, a stand-in WebAuthn authenticator for the passkey tests.
