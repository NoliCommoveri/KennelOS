# KennelOS — Companion Family App (free buyer-facing edition)

> **Status: PROPOSAL / design brief.** Nothing here is built yet. This captures the intent
> for a new, free, buyer-facing surface that families of KennelOS-bred puppies install and
> keep. Read it as the target; the README tracks build progress. It reuses the existing
> **Companion** machinery (`shared/data/companionExport.js` + `shared/companion-view.html`)
> rather than replacing it. Two small spikes back the delivery choices — the numbers are in
> the appendix, and where a claim is unverified it says so.

*Design brief, plain-English throughout; the precise rules are called out where they matter.*

---

## The decision in one line

Ship a **fourth surface** — a free, installable **Companion family app** that a puppy buyer
uses long-term — which fuses a **breeder-configured content library** (care guides + a
recommended schedule template, authored once per program in Pro) with a **small per-pup
packet** (delivered by a texted link) into a personalized, checkable, plan-and-track app
that has both *immediate* ("what do I do today?") and *long-term* ("track my pup's
development and schedule") value.

---

## Why this exists

A buyer who just paid $2,000 for a puppy goes home with a **multi-page paper packet** — care
instructions, feeding notes, a recommended vaccine/deworming schedule, the breeder's contact
info. Paper is static, gets lost, and can't remind you the next booster is due. This replaces
it with an attractive interactive app the family actually opens, because it answers today's
question *and* plans the months ahead.

The breeder half already exists. The Companion feature (`companionExport.js`) already emits a
security-hardened, per-family bundle over a URL hash, and `companion-view.html` already renders
it offline with no backend. What's missing is the **receiving app** — persistent, accumulating,
and able to layer the family's own tracking on top — and a place for the breeder to **author
the reference content KennelOS doesn't hold today.**

---

## Three content scopes (who owns what)

The content splits three ways, and conflating them is the classic mistake:

1. **Per-program library** — *your* new-puppy care guide, *your* feeding/socialization advice,
   *your* recommended vaccine + deworming **schedule template**, your kennel name/logo/colors.
   **Same for every buyer of yours, different between kennels.** This is the "configure it for
   my program" layer. Authored once, reused for every puppy you place.
2. **Per-pup packet** — this specific pup's facts, shots-so-far, date of birth, contract link,
   photos link, your personal note. **Unique per family, changes over time.** This is (largely)
   the existing `family` bundle from `companionExport.js`.
3. **Shipped starter templates** — a sensible default vaccine schedule and a generic care
   article that KennelOS ships and the breeder **adopts and edits** rather than authoring from a
   blank page. (Nobody wants to retype a vaccine schedule.)

---

## The fusion — what makes it an app, not a prettier PDF

A schedule stored as a **weeks-relative template**:

> `6–8 wks: DHPP #1 · 10–12 wks: DHPP #2 · 12–16 wks: Rabies · 14–16 wks: DHPP #3 …`

becomes a **personalized, dated, checkable timeline** the instant the family app anchors it to
*this pup's* date of birth (carried in the packet). That single mechanism delivers both halves:

- **Immediate** — "what's due this week?" surfaces the item + the matching care-guide section.
- **Long-term** — a real schedule the family checks off, with reminders for the next booster,
  growing as the breeder pushes updates.

Family-authored data (their own vet contact, their own reminders, their checkmarks) lives only
on the family's device and never travels back to the breeder.

---

## Delivery — the physics, and how the app is hosted

Delivery is governed by two hard facts, both measured (appendix):

- **The app itself doesn't ship in the link.** The renderer (HTML/CSS/JS) is a normal hosted
  static file, loaded once and service-worker-cached like any PWA. **Only *data* rides the hash.**
- **The per-pup packet is tiny (~1,700 hash chars) → it texts reliably, forever. The per-program
  library is big (a 15-page handout ≈ ~23K chars) → it will never fit in a text and must not try.**

### Hosting: a new GitHub Pages sub-origin so the link is textable

The Companion app deploys to **its own origin (a subdomain) on GitHub Pages**, exactly like the
Lite/Pro/Demo editions each deploy to their own origin. Two reasons this matters:

- **A short base URL keeps the texted link short.** Every character counts in SMS. A tidy base
  like `https://companion.kennelos.app/v/#<packet>` spends ~34 chars before the payload, leaving
  the budget for the packet. (The exact subdomain is TBD — see open decisions.)
- **Own origin = isolated IndexedDB**, same rationale as the other editions: the family app's
  stored library + tracking data stay separate from anything else.

The service worker precaches the app shell so it works offline after first load, and it is
**the shell that is universal** — the per-program *content* is data loaded at runtime and cached
in the family's IndexedDB, **not** baked into the build (because it differs per kennel).

### Two payloads, two channels

| Payload | Size | Channel | Notes |
|---|---|---|---|
| **Per-pup packet** (facts, shots, DOB, contract link, personal note, + a pointer to the library) | ~1.7K chars | **Texted hash link** | Bulletproof SMS zone; carries a *reference* to the library, not the library itself. |
| **Per-program library** (care guides + schedule template + branding) | ~10–30K chars | **Fatter one-time channel** (see fork) | Too big for SMS; also breeder-specific, so it can't be baked into the shared app. |

Because the library is delivered once and cached, **every later update link the breeder texts
stays tiny** — it only carries the packet plus a pointer to the already-loaded library.

### The library-delivery fork (this is the open product decision)

- **Cloud (Google Drive path — confirmed in the spike):** the breeder publishes the library once
  to Drive; every buyer's app fetches it on first open via the CORS-enabled Drive API
  (`googleapis.com`, verified to reflect arbitrary origins) using a public, HTTP-referrer-restricted
  API key; edits **auto-update** on everyone's app. Breeder does a one-time Drive connect; the
  **family needs no account.**
- **No-cloud (email / file handoff):** the breeder emails the full library-bearing link **once**
  (email tolerates far longer URLs than SMS) or hands over an import file at pickup. **Zero
  accounts, fully offline** — but revising the care guide means re-sending. Small pup-update links
  still go by text.

Recommendation: support the **no-cloud path as the baseline** (it needs no infrastructure and
matches the app's no-backend ethos) and **cloud as the "auto-updating library" upgrade.** The
product is never blocked on cloud.

> **Dropbox note.** The breeder side today integrates Dropbox, but Dropbox is the *weaker* fit
> for the anonymous family fetch: its no-account raw-link route (`dl.dropboxusercontent.com`) has
> unverified/unreliable CORS, and its reliable API route needs the breeder's Bearer token (which
> can't ship to families). The sandbox's egress policy blocked all Dropbox hosts, so this was **not
> confirmed** — verify with a real shared link before relying on Dropbox for library delivery.
> Google Drive is the confirmed cloud path.

---

## Configurability — yes, per program

Everything in scope 1 is **configured per KennelOS breeder**:

- **Where:** a new **"Companion content" authoring surface in KennelOS Pro** — write/edit care
  guides (rich text / markdown), edit the schedule template, set branding. Consistent with
  Companion share-out already being **Pro-only** (Lite excludes it). A Lite breeder does not get
  this; it is a Pro capability.
- **What the breeder controls:** the care articles, the recommended schedule (adopted from a
  shipped default, then edited), kennel identity/branding, and which per-pup fields the packet
  includes (the existing Companion include-flags already do this).
- **The family app is the free consumer** of that configuration — it is not itself configurable
  by the breeder beyond what the library + packet carry.

---

## How it fits the editions architecture

- **A free, fourth surface**, deployed to its own origin, built from the shared core the same way
  Lite/Pro/Demo are (`build/assemble.mjs`). It is a *consumer* of the Companion bundle schema,
  not the full breeding DB.
- **Its own thin repos + IndexedDB** on the family side for: the cached per-program library, the
  latest per-pup packet(s), and family-authored data (vet contact, reminders, checkmarks). Family
  data never leaves the device and never re-enters a breeder bundle.
- **The security invariant is untouched.** `companionExport.js`'s positive allow-list (a family can
  only ever receive its own data, never another family's, never breeder-private notes) stays exactly
  as-is. The library adds a *new* content type authored deliberately by the breeder for broadcast —
  it carries no per-family private data by construction.

---

## Open decisions (need the owner's call before building)

1. **Library delivery:** ship the **no-cloud (email/file) baseline first**, with **Google Drive
   auto-update as a later upgrade** — confirm this ordering.
2. **Family self-tracking scope:** just checkmarks + reminders + a vet contact to start, or also
   let families log their own weights/notes (which begins to mirror the breeder event model)?
3. **Reference-content authoring format:** rich-text editor vs. markdown vs. pick-and-edit from
   shipped templates (or all three).
4. **Subdomain name** for the Companion origin (e.g. `companion.kennelos.app`, `puppy.…`, `family.…`).
5. **Bundle version bump:** the packet gains a **DOB** (for schedule anchoring) and a **library
   pointer**; both are additive — `COMPANION_BUNDLE_VERSION` bumps only if the shape breaks.
6. **Pro vs. free line:** confirmed — authoring is Pro, the family app is free. Does the Companion
   family app get folded into the existing `build/assemble.mjs` edition matrix as a fourth target?

---

## Appendix — spike results (measured, not estimated)

### A. CORS / cloud-fetch feasibility (family app, no backend, no family account)

Tested by probing each host with a cross-origin `Origin:` header and inspecting the response for
`access-control-allow-origin` (the header a browser `fetch()` requires).

- **`www.googleapis.com` (Drive API `files/{id}?alt=media&key=…`): CONFIRMED CORS-open** — reflects
  arbitrary origins (`access-control-allow-origin: <origin>`, `vary: Origin`). A backend-less family
  app can fetch a publicly-shared Drive file with a public, referrer-restricted API key. ✅
- **All Dropbox hosts + `drive.google.com`: BLOCKED by the test environment's egress policy** (403
  CONNECT). Not confirmable in-sandbox; must be verified on real infrastructure before use.
- **`content.dropboxapi.com` (`get_shared_link_file`):** supports CORS but requires the breeder's
  Bearer token → no anonymous family path regardless. ❌ for the no-account goal.

### B. Hash-link payload size (lz-string `compressToEncodedURIComponent`, vendored 1.5.0)

Realistic payload = a family packet (pup facts, this pup's shots, schedule template) + N care-guide
pages of prose (~2,600 raw chars each). Round-trip verified at every size.

| Content in the link | Raw JSON | Encoded hash chars |
|---|---:|---:|
| Pup packet only (facts + shots + schedule) | ~2.0 KB | **~1,700** |
| + 1 care-guide page | ~3.9 KB | ~3,150 |
| + 3 pages | ~7.8 KB | ~5,500 |
| + 8 pages | ~17 KB | ~10,200 |
| + 20 pages | ~41 KB | ~18,900 |
| + 40 pages | ~80 KB | ~29,900 |

- Compression ≈ 2.5×. **Caveat:** the test articles are near-identical, so lz-string dedupes them
  and the table is *optimistic* past the first page. Distinct real prose won't dedupe — budget
  **~1,500 hash chars per unique printed page** (a 15-page packet ≈ ~23K chars).

**SMS delivery tiers** (the browser is never the limit — Chrome takes ~2 MB URLs; the *text message*
is the limit):

- **≤ ~2,000 chars — bulletproof** on every phone/carrier, incl. legacy SMS gateways. The pup packet
  lives here.
- **~2K–8K — fine on modern smartphones** (iMessage / Android RCS), but trusting the delivery path.
- **> ~8K — don't text it.** Works in a browser if it arrives intact, but SMS truncation, link
  auto-detection failure, and an alarming wall of characters all bite. The library lives here, which
  is exactly why it goes by a different channel.
