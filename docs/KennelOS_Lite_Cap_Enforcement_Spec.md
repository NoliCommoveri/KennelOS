# KennelOS Lite — Cap Enforcement Spec

> **Status: IMPLEMENTED & browser-verified (Lite + Pro, headless Chromium, no console
> errors).** Everything below is now built. The three enforcement call sites
> (`dogRepo.create`, `dogRepo.update`, `litterRepo.create`) `await` the real
> `enforceDogCap` / `enforceLitterCap` hooks from Lite's `editionConfig.js` (the shared/Pro
> copy stays a no-op, so no cap logic ships in Pro). `CapExceededError` lives in
> `shared/data/repoBase.js`; the shared archived-dog-link rule is `dogRefHtml` in
> `shared/assets/ui.js`; the upgrade nudge is `shared/assets/upgradeNudge.js`. Paths below
> are under `shared/` (e.g. `shared/data/dogRepo.js`, `shared/assets/pedigree.js`). See the
> top-level `README.md` for progress.
>
> **One launch-config placeholder:** `lite/editionConfig.js` exports `upgradeUrl` — the
> checkout link the "Upgrade to Pro →" CTA opens after exporting the backup. It's a
> placeholder (`https://kennelos.app/upgrade`) pending the real Lemon Squeezy URL; a
> one-line swap.

*Implementation-grade companion to `KennelOS_Lite_Pro_Editions_Plan.md`. This is the Lite-only
cap: what counts, where it's enforced, how a slot is freed, and how the "archive = departed"
mechanism is hidden so it can't be reverse-engineered into a bypass.*

*Keyed to the real code: `data/dogRepo.js`, `data/litterRepo.js`, `data/repoBase.js`,
`data/vocab.js`, `assets/pedigree.js`, `pages/sale.js`.*

---

## 0. Two numbers still open (the only unresolved knob)

```js
const CAP_DOGS    = 6;   // locked for launch — counting dogs
const CAP_LITTERS = 2;   // locked for launch — litters
```

Kept as named constants so they're a one-line change later, but **6 / 2 is decided** — no open
knobs remain. The rest of this spec is locked.

---

## 1. Ownership vocab is restricted in Lite

External and leased dogs are **Pro-only**. In Lite the dog form's ownership picker offers **only**
`owned` and `co_owned`; `external`, `leased_in`, `leased_out` are never selectable. Consequences:

- `OWNER_REQUIRED_TYPES = ['external', 'leased_in']` in `dogRepo.js` never fires in Lite — no
  ownership reason ever forces `owner_contact_id`.
- Every dog in a Lite database is `owned`/`co_owned`, so the ownership half of the count is always
  true. We still test it (below) for robustness, but it never excludes anything in practice.
- **`co_owned` counts toward the cap** (excluding it would be a one-click "mark it co-owned"
  loophole). This is the resolution of the old open-decision on co-ownership.

---

## 1a. Status vocab is restricted in Lite

Lite's dog form Status picker offers only **Puppy, Active breeding, Retired breeding, Deceased**.
`pet_home`, `for_sale`, and `external_reference` are never selectable — `external_reference` doesn't
apply (Lite has no external ownership, §1); `pet_home`/`for_sale` are Pro's more granular disposition
tracking, not needed once archive-on-departure is the single Lite exit (§5: a dog that's placed or
sold just departs, it doesn't pass through an intermediate status first).

- The counting predicate (§2) still checks `CAP_ADULT_STATUS` against `pet_home`/`for_sale`
  **defensively** — bulk import bypasses the interactive guard (§7), so a Pro backup imported into
  Lite could carry a dog already in one of those statuses, and it must still count toward the cap
  rather than slip through as a bypass.
- A Lite user can never manually create or transition a dog into `pet_home`/`for_sale`/
  `external_reference` — those values only ever arrive pre-existing via import.

---

## 2. What counts — `countsTowardDogCap(dog)`

```js
const CAP_OWNERSHIP   = new Set(['owned', 'co_owned']);
const CAP_ADULT_STATUS = new Set(['active_breeding', 'retired_breeding', 'pet_home', 'for_sale']);

const countsTowardDogCap = (dog) =>
  !dog.is_archived &&
  CAP_OWNERSHIP.has(dog.ownership_type) &&
  CAP_ADULT_STATUS.has(dog.status);
```

- **`is_archived` is now IN the predicate** — an archived dog is a *departed* dog and does not
  count. (This reverses the earlier plan draft, where archived counted. See §4 for why it's safe.)
- **Excluded automatically:** `puppy`, `deceased`, `external_reference` (never adult stages) — so a
  whole kept litter never trips the cap, and selling puppies (they stay `status: 'puppy'`, with a
  separate Sale record) never counts.
- `for_sale` counts only for an **adult** listed for sale; a puppy can't be `for_sale` (vocab
  invariant), so pup sales are unaffected.
- `pet_home`/`for_sale` are counted defensively but not reachable from Lite's own UI — see §1a.

---

## 3. Where it's enforced — exactly three call sites

All interactive dog/litter writes funnel through the repos, so the guard is complete for the UI:

| Repo method | Guard |
|---|---|
| `dogRepo.create` | after `validateDog`, before `base.create` |
| `dogRepo.update` | after building `merged`, before `base.update` |
| `litterRepo.create` | after `validateLitter`, before `base.create` |

Bulk import (`importExport.js`) bypasses these deliberately — see §7.

---

## 4. The block rule — create vs. transition-in

The rule is **not** "block while over cap." It's **"block a write that adds a *new* counting dog
while already at the cap."** Editing a dog that already counts is never blocked.

**Dog create:**
```js
if (countsTowardDogCap(candidate)) {
  const current = await countCountingDogs();               // predicate over all dogs
  if (current >= CAP_DOGS) throw new CapExceededError('dogs', current, CAP_DOGS);
}
```

**Dog update** — compare the same record before/after:
```js
const was  = countsTowardDogCap(existing);
const will = countsTowardDogCap(merged);
if (will && !was) {                                        // transition INTO the counting set
  const current = await countCountingDogsExcluding(id);
  if (current >= CAP_DOGS) throw new CapExceededError('dogs', current, CAP_DOGS);
}
```

Truth table (note `is_archived` is part of "counts"):

| was | will | example | action |
|---|---|---|---|
| — | ✓ (create) | add a new adult owned dog | **block at cap** |
| ✗ | ✓ | puppy matures to `pet_home`/`active_breeding` | **block at cap** |
| ✓ | ✓ | edit a counting dog's other fields | always allow (even if legacy-over-cap) |
| ✓ | ✗ | **depart** (archive), or mark deceased | always allow — frees a slot |
| ✗ | ✗ | edit a puppy / an already-departed dog | always allow |

- **Maturing kept puppy** is the `✗→✓` row → blocked at cap (no grandfather), surfaced as the
  upgrade nudge (§6).
- **Departure** is the `✓→✗` row, triggered by archiving (§5) — the honest slot-free.

**Litter create** (no status/archive dimension to transition):
```js
const current = (await litterRepo.getAll({ includeArchived: true })).length;
if (current >= CAP_LITTERS) throw new CapExceededError('litters', current, CAP_LITTERS);
```
`litterRepo.update` is never capped. Litters have no "departure," so **archived litters still
count** (there won't normally be any — Lite has no manual litter-archive either).

---

## 5. The exit: "this dog left my program" = archive + hide

Archiving is the **only** way a dog (or a sold puppy) leaves the active roster in Lite, and it is
always a deliberate, confirmed action.

- **No manual "Archive" button on dogs in Lite**, and **no "include archived" toggle** on the dog
  list or in pickers. If a user could freely archive, archive-doesn't-count would be a one-click
  cap bypass. Removing the manual path is what makes §4 safe: the only archive is a declared
  departure, and faking a departure hides a dog you still own (pillar 4 in the plan).
- **The departure action** (from the dog profile and from the sale-delivery flow) sets
  `is_archived: true` (via `dogRepo.archive`) and, optionally, `status_date`. It replaces the
  current `sale.js` "update ownership → external/external_reference" prompt (`sale.js:361`), which
  is Pro-only behavior now.
- **Sold puppies are archived too.** When a puppy's sale is delivered, the pup departs the roster
  the same way (it never counted toward the cap — this is roster tidiness, and it keeps the
  archived-dog handling uniform). Its Sale record survives.
- **Every archive action is gated by a blocking "this is permanent" confirm the user must accept**
  — no silent archive, no transient auto-undo (the confirm *is* the safety, and an undo would
  contradict the message). Honest wording, because the app is soft-delete-only and never destroys
  history:
  > *"Remove [dog] from your program? This can't be undone here — [dog] leaves your roster and you
  > won't be able to edit it or bring it back. It stays in your dogs' pedigrees for lineage.
  > \[Cancel] \[Remove permanently]"*

  This applies to **every** archive entry point that exists in Lite, not just dogs.
- **Pedigree/history stay intact:** archived dogs are soft-deleted rows, so an offspring's pedigree
  still renders the departed parent, and Sale records still show who bought what. Nothing is
  destroyed — the dog is hidden and can't be brought back *in Lite*, which is what "permanent"
  means to the user.

---

## 6. Repo throws, UI nudges (a repo can't prompt)

Mirror the existing `ReferenceBlockedError` pattern in `repoBase.js`:

```js
class CapExceededError extends Error {
  constructor(kind, current, limit) {
    super(`Lite limit reached: ${current}/${limit} ${kind}.`);
    this.name = 'CapExceededError';
    this.kind = kind; this.current = current; this.limit = limit;
  }
}
```

The repo hard-throws (un-bypassable by any interactive writer). The dog form / puppy-record /
litter form catch it and render the **upgrade nudge** — never a raw error — with a **"Upgrade to
Pro →"** CTA wired to the export→checkout→import bridge:

> *"You're at your Lite limit of 6 adult dogs. To mark this pup grown, upgrade to Pro — or archive
> a dog you no longer keep."*

Wording varies by `err.kind` and by create-vs-mature, but it's one catch site per form.

**Proactive counterpart:** the New Dog page (`dog.js`) also shows a plain "Creating x/6 available
dogs" line under the title, reading `editionConfig.dogCapStatus()` — a side-effect-free read of the
same `countsTowardDogCap`/`CAP_DOGS` used to enforce the cap, so the number always matches what
would actually block the save. Pro/Demo's `dogCapStatus()` resolves `null` (uncapped), so nothing
renders there.

---

## 7. Hiding the mechanism (so it can't be reverse-engineered)

"Archived = departed and uncounted" only holds if the user never sees or reaches the archive
machinery. In Lite:

- **No "include archived" toggles** anywhere (dog list, pickers, reports).
- **No archived-count tiles either** — the dashboard's "Kennel overview" card drops its
  "Archived (any status)" stat tile in Lite (`dashboard.js`, gated on `includeArchivedToggles`).
  A raw count is still a reveal of the mechanism, even without a toggle or a link.
- **No view links to an archived dog's `dog.html`.** The name still renders (for lineage/history),
  but as **plain text, never a link**, and no "arch" badge advertises the state. Apply everywhere a
  dog name is otherwise clickable:
  - **Pedigree** (`assets/pedigree.js`, `nodeHtml`, lines 71–73): for an archived node, drop the
    `<a data-nav>` name link (render a static span so `onNavigate` can't fire), **omit** the
    `badge badge-gray ped-arch` "arch" badge, and **omit** the `ped-open` `↗` `dog.html` link. Also
    exclude archived dogs from the root picker (`pedigree.js` `fillPicker`) so the tree can't be
    centered on a departed dog.
  - **Sale** (`pages/sale.js`): once the dog is archived, its name in the sale view is plain text,
    not a link into the record.
  - **Audit the rest:** litter roster, event log, dashboard/today cards, reports — any surviving
    `dog.html?id=` link to an archived dog is a back-door; give them all the same treatment.
- **Rationale:** these paths would otherwise let a curious user open a departed dog, notice it's
  merely "archived," and infer that a manual un-archive (via import/devtools) frees a slot. Closing
  the links keeps the mechanism invisible; the honest departure UX is all the user ever sees.

---

## 8. Edition wiring — shared code stays edition-agnostic

The repos live in `/shared`, so the cap can't be hardcoded there. Inject it via an
`editionConfig.js` shipped **differently per edition** at a fixed shared path:

- **Lite:** real `enforceDogCap` / `enforceLitterCap` (the numbers + predicate above), plus the
  Lite UI flags (no manual archive, no include-archived toggles, archived-dog links disabled).
- **Pro / Demo:** **no-ops** — Pro is unlimited; Demo blocks all writes upstream via demo mode.

Shared repos call `await enforceDogCap({ candidate, existing, id })` at the §3 hook points. Pro's
no-op returns immediately: zero runtime cost, and **no cap logic ships in the Pro download**.

---

## 9. Import / backup / upgrade-bridge interaction

Bulk import bypasses the repo guards. Stance:

- **Lite import may exceed the cap** — restoring a legitimate backup never fails and never silently
  drops dogs. The user then lands in the over-cap `✓→✓` state where *edits* work but new *adds* are
  blocked (§4) — consistent with "existing dogs grandfathered, you just can't grow."
- The residual loophole (hand-edit a Lite JSON and reimport to overfill) is the accepted
  "technical user in devtools" caveat; not worth defending for this audience.
- Lite still needs export+import for backups and for the upgrade bridge, so import can't be
  cap-gated without breaking those.

---

## 10. Verification (no test runner — per CLAUDE.md)

- `node --check` on `dogRepo.js`, `litterRepo.js`, `editionConfig.js`, `assets/pedigree.js`.
- Serve locally and exercise, in a **Lite** build:
  1. Create 6 counting dogs → 7th (create) blocked with the nudge.
  2. Keep a litter, mature a pup at cap → blocked (`✗→✓`), nudge shown.
  3. Depart one dog → the **"this is permanent" confirm** appears and must be accepted; on accept
     the count drops and the pup now matures (`✗→✓`, under cap). Cancelling the confirm leaves
     everything unchanged.
  4. Confirm the departed dog is **gone from the list**, has **no include-archived toggle** to
     bring it back, and its name in the **pedigree** and in its **Sale** is **not clickable** and
     shows **no "arch" badge**.
  5. Deliver a puppy sale → the pup is archived (departs the roster) and its Sale record remains.
  6. Import a 10-dog backup into Lite → succeeds; a subsequent new adult add is blocked.
- In a **Pro** build (no-op config): none of the above blocks; archived dogs remain clickable with
  the "arch" badge (existing behavior).

---

## 11. Open items to confirm before build

None. Cap numbers are locked at **6 / 2** (§0); sold puppies **are** archived on departure (§5);
every archive action is confirm-gated (§5). This spec is build-ready.
