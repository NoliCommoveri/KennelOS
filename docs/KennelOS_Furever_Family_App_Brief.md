# KennelOS Furever (starter brief)

> **Starter, not a spec.** This sketches a free, buyer-facing app — branded **KennelOS
> Furever**, a distinct app from the existing **Companion** share-out feature (the
> prospective/family/partner links Pro sends from `shared/data/companionExport.js` +
> `shared/companion-view.html`) — that a puppy family installs at pickup and keeps for
> years. Everything here is a starting point and open to change — treat the choices as
> leanings, not decisions. Furever builds on the existing Companion machinery rather than
> replacing it, so the two overlap in mechanism but not in name — say "Companion" for the
> share-out links, "Furever" for this app. A couple of small measurements back the
> delivery notes (appendix).

---

## The idea

Two days before pickup the breeder sends one warm text: *"Your pup is arriving soon —
download this app to get a jumpstart on caring for him."* One tap opens an app already
seeded with **this** puppy (name, DOB, pickup) and everything a new owner needs — care
guide, a vaccination/deworming schedule, the breeder's contact. From then on it's the
family's, and it grows into their **pet-care home for the next five years**.

The breeder's involvement is the one send. The long-term value comes from the *family*
using it.

**The countdown moment.** In the days before pickup, the breeder can send a short,
personal message that's entirely their own words and their own photo: a picture of the
pup with *"It's almost time for [puppy name] to come home!"* plus the scheduled pickup
date, time, and place. This is the emotional lead-in to the app link (often riding in the
same send) — see "Pre-pickup countdown message" below.

## Pre-pickup countdown message

- **Fully authored by the breeding kennel** — the breeder supplies the photo, the pup's
  name (fills the template), and the pickup date/time/place; nothing here is generic
  content.
- **Leaning:** fold it into the same seed send as the rest of the packet rather than a
  separate message — a small `pickupPlan: { photoUrl, date, time, place }` alongside the
  existing seed fields — so the family gets one link that opens to this countdown card
  first, then the rest of the app underneath. Copy stays visually distinct from the
  kennel's general `announcement` (brief decision precedent in `companionExport.js`'s
  `headerCopy`) so it reads as personal to *this* pup, not a canned blast.
  - Note this makes the photo a **URL reference, not inline image data** — consistent
    with how the existing Companion bundles carry `photosUrl` today. A real embedded
    photo won't fit the ~1.7K compressed hash-link budget (appendix); a link to a hosted
    image will.
- **Open question:** does a changed pickup time (common — logistics slip) simply
  re-trigger a resend (same upsert-by-`pupId` behavior as the rest of the seed), or does
  the countdown message want its own lighter re-send path since it's more time-sensitive
  than the rest of the packet?

## What the family gets

- **A puppy that's already set up** — name, DOB, pickup, breeder contact, **the breeder's
  own vet's contact** (for a referral or if something comes up before the family has their
  own vet lined up), a personal note.
- **A lifelong care calendar** — the schedule template anchored to the pup's DOB, starting
  with the arrival-week items (e.g. **schedule a well-visit exam within 72 hours of
  pickup**), running from the puppy shot series into adult recurring care (annual exam,
  boosters, monthly preventatives), so it keeps surfacing "due soon" for years.
- **A feeding and safety reference** — a recommended feeding schedule and a list of foods
  that are poisonous to dogs, so day one doesn't start with a guessing game.
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
  the family adds — this is where the default vaccine/deworming schedule, the recommended
  feeding schedule, and the poisonous-foods safety list live, so every dog in the app has
  them even if the breeder never customizes anything.
- Your **own program's care content** (authored in Pro) overlays your seeded pups when you want
  your words instead of the defaults — e.g. your own feeding guidance if it differs from the
  universal default, on top of things that are inherently yours and never generic: your
  contact info, your vet's contact, your personal note, and the countdown photo/message.

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
- Whether the pre-pickup countdown message (photo + "it's almost time" + pickup
  date/time/place) is its own lightweight send or a field on the same seed packet — see
  "Pre-pickup countdown message" above.
- Whether the breeder's vet contact is a fixed field on the kennel (same for every pup) or
  something that can vary per litter/pup.
- How much of the arrival-week schedule (the 72-hour well-visit item, others like it) is a
  fixed universal default versus something the breeder can retime or relabel per program.

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
