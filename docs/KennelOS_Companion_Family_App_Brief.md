# KennelOS — Companion Family App (starter brief)

> **Starter, not a spec.** This sketches a free, buyer-facing app that a puppy family
> installs at pickup and keeps for years. Everything here is a starting point and open to
> change — treat the choices as leanings, not decisions. It builds on the existing Companion
> machinery (`shared/data/companionExport.js` + `shared/companion-view.html`) rather than
> replacing it. A couple of small measurements back the delivery notes (appendix).

---

## The idea

Two days before pickup the breeder sends one warm text: *"Your pup is arriving soon —
download this app to get a jumpstart on caring for him."* One tap opens an app already
seeded with **this** puppy (name, DOB, pickup) and everything a new owner needs — care
guide, a vaccination/deworming schedule, the breeder's contact. From then on it's the
family's, and it grows into their **pet-care home for the next five years**.

The breeder's involvement is the one send. The long-term value comes from the *family*
using it.

## What the family gets

- **A puppy that's already set up** — name, DOB, pickup, breeder contact, a personal note.
- **A lifelong care calendar** — the schedule template anchored to the pup's DOB, running
  from the puppy shot series into adult recurring care (annual exam, boosters, monthly
  preventatives), so it keeps surfacing "due soon" for years.
- **Their own records** — weight/growth, vet visits, meds, reminders, a document vault
  (contract, registration, microchip, insurance), photos, and their own vet's contact.
- **All their pets, not just yours** — see multi-pet below.

## Two data layers (this drives the refresh behavior)

1. **The breeder seed** — name, DOB, pickup, your contact, note. Yours; refreshable.
2. **The family's records** — everything they add over the years. Theirs; the seed never
   overwrites it.

A resend (say the pickup date slips) is an **upsert keyed on the pup's id (`pupId`)**:
the matching seeded pet's seed fields refresh in place, the family's history stays put, and
nothing else is touched. Practically, resends only happen in the pre-pickup window. Check-off
progress is tied to *which* schedule item is done, not to the date, so a corrected DOB doesn't
lose it.

## Multi-pet

The top-level entity is the **pet**, and there can be many. Two kinds, same shape:

- **Seeded pets** — came from your blob (carry a `pupId`, arrive pre-filled). A resend, or a
  second puppy from you, is just another blob → another seeded pet.
- **Self-added pets** — a future dog, a rescue, the cat. The family creates these; blobs never
  touch them, and this data stays private to the family.

**Leaning:** dog-first — full schedule + care content for dogs (seeded or self-added). Other
species can be added as a records container (weight, vet log, reminders, documents) without a
species-specific schedule yet; those could come later as content packs.

## Content — a shared backbone plus your overlay

- The app ships a **universal dog care library + default lifelong schedule**, used for any dog
  the family adds.
- Your **own program's care content** (authored in Pro) overlays your seeded pups when you want
  your words instead of the defaults.

Either way it becomes a live, checkable calendar per dog.

## Delivery

- **The app is hosted; only data rides the link.** The renderer is a normal static page; the
  texted link carries just the small per-pup packet (~1.7K compressed — texts reliably).
- **Its own GitHub Pages sub-origin** (e.g. `companion.kennelos.app`), like the other editions.
  A short base URL keeps the texted link short, and a separate origin keeps the family's stored
  data isolated.
- **The care library is bigger than a text can carry**, so it doesn't ride the link — it's
  either shipped in the app (universal content) or fetched **once** on first open for your
  custom content. Google Drive is a confirmed way to host that one-time fetch with no family
  account (appendix); other transports (email a file, etc.) are open too.
- The app needs a connection only when it actually reaches out — first load and any optional
  cloud fetch; day-to-day it works from what it already has.

## Keeping five years of records safe

Since this is meant to last, a few light options help the family not lose their data — all
negotiable, none required to start:

- Offering **Add to Home Screen** (and requesting persistent storage) so the browser is less
  likely to evict it.
- A one-tap **export/backup** file (reuses the app's existing export machinery).
- Optionally, their own cloud later.

## Why it's good for the breeder

The puppy is the doorway; the app becomes the family's everyday tool for **all** their pets.
Your name and "call us anytime" sit one tap away for years — a handoff packet gets read once, a
pet-care app gets lived in. No added infrastructure; it's all on the family's device.

## Open questions (all negotiable)

- How far the family's self-tracking goes (checkmarks + reminders + vet contact, or full
  weight/vet/med logging from day one).
- Dog-only vs. broader multi-species, and how far.
- How custom content is authored (rich text, markdown, edit-a-template) and how it's delivered.
- Whether/how the family can back up or sync their data.
- Subdomain name; and the small additive fields the packet gains (`pupId`, DOB, a content
  pointer).

---

## Appendix — quick measurements

**Hash-link size** (vendored lz-string). A per-pup packet (facts + shots + schedule) is
**~1,700 compressed chars** — well inside the "texts anywhere" range (≤ ~2K). Care-guide prose
adds ~1,500 chars per unique page, so a multi-page library (~15 pages ≈ ~23K) is too big to
text and is better shipped in the app or fetched once. Round-trip verified.

**Cloud fetch, no family account.** Google Drive's API host (`googleapis.com/.../alt=media`) is
CORS-open and reflects arbitrary origins — a backend-less app can fetch a publicly-shared Drive
file with a public, referrer-restricted key. Dropbox hosts were blocked in the test environment
and remain unverified; if Dropbox is wanted, confirm with a real shared link first.
