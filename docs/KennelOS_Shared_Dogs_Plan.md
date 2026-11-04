# KennelOS — Shared Dogs Plan (Dog Cards, then live updates)

> **Status: phase 1 built (Dog Cards, §3; End-State guide §36). Phases 2 and 3 are plans.**
> Written 2026-11-04 for the first real case: a second breeder setting up KennelOS whose
> program is mostly dogs co-owned with an existing KennelOS breeder. Builds on Kennel
> Cards (End-State guide §28) and the dog transfers and connections sketched in
> `KennelOS_Cloud_Accounts_Proposal.md` §7–§8, which this replaces for co-owned dogs.

## 1. What it's for

Two breeders co-own dogs. Each keeps the dog in her own KennelOS, and today each types it in
by hand: names, registrations, birthday, parents, health tests, titles. The two copies drift
the day one of them adds a test result.

The goal, in order:

1. **Bring a dog (or a whole program of them) from one breeder's KennelOS into another's**
   without typing, with its parents and grandparents, its tests and its titles.
2. **Keep the two copies matched:** sending again updates the same dogs, never duplicates.
3. **Later, keep them matched on their own** (phase 2), from the breeder the dog lives with.

What it is not: a shared database, or two people editing one record. Each breeder keeps her
own copy, her own notes, her own contacts and money, and her own say over what she does with
the dog (§5).

## 2. Phases

| Phase | What | Needs |
|---|---|---|
| **1. Dog Cards** (built) | Pick dogs, send a card (link, code or file); the other breeder previews and adds or updates them. Every dog gets a permanent public ID. | Nothing new on any server. Pro. |
| **2. Live updates** | A card she sends can be **followed**: the receiving app keeps pulling the sender's changes for those dogs through the cloud, on its own. | Both on the cloud (Phase 1 accounts); one server migration. Pro. |
| **3. More of the dog** | Heats and breedings (opt-in per share), removals, the receiver's say flowing back (a test she recorded while the dog was with her). | Owner decisions (§8). |

Each phase ships on its own and the next builds on it: phase 2 sends phase 1's card, through
the cloud instead of by hand.

## 3. Phase 1: Dog Cards

### 3.1 The dog's public ID

- `dogs.public_id`, format `kosd1_<uuid>` (`dogRepo.newDogPublicId` / `isDogPublicId`): a
  different prefix from a kennel's `kos1_` so the two can't be confused.
- **Minted when a dog is first put on a card** (the dogs sent and every ancestor sent with
  them), never before, and **write-once** after that. Unlike a kennel's, an outside dog may be
  given one: a dog's ID is only a matching key, not an identity claim on anyone's behalf, and
  the ancestors need one or the same grandsire arriving on two cards is two dogs.
- A received dog keeps the sender's ID, so from then on both apps name the dog the same way.
- Indexed (`db.version(6)`), since every card looks dogs up by it. Cloud field (it's a random
  id, nothing personal), so it rides sync, backups and restores.

### 3.2 What a card carries (the allow-list)

`data/dogCard.js` builds it by name and checks every key, the same way as Kennel Cards and
Companion. Nothing travels unless it's listed here.

- **From:** the sender's kennel card (public ID, name, prefix, location, website). A card can
  only be sent from one of her own kennels.
- **Kennels named by the dogs:** the breeder kennel of each dog (its public ID if it has one,
  else name only).
- **Each dog:** public ID, call name, registered name, sex, breed, status, birthday (and
  whether it's estimated), date of death, colour and markings, registry and registration
  number, other registrations, microchip, photos link, recorded COI, sire and dam (by public
  ID), breeder kennel, and whether it's one she sent or an ancestor.
- **Its health tests and titles:** genetic tests, OFA / PennHIP and breed-specific tests, and
  titles earned, each with its date, title and its type's named detail fields (panel, lab,
  result, joint, rating, title, organisation…), and a reference so a re-send updates it.
- **Ancestors:** up to four generations above each dog sent, with the same dog fields and no
  events.

**Never on a card:** notes (on the dog or any event), contacts (owners, co-owners, buyers),
sales, prices and money, litters, pairings, heats and breedings, vaccinations and every other
event type, documents and files, planned tests, disposition, website and waitlist settings,
and every row id.

### 3.3 Sending (Sharing → Dog cards)

1. Tick the dogs. A filter shows only the dogs co-owned with one contact, and **Tick all**.
2. The card appears as a **link** (same KennelOS edition), a **code** (any install) and a
   **file** to save and send (for a big program, which may be too long for a message).
   What's on it is listed under **What's on the card**.
3. Sending mints the missing public IDs; nothing else on her dogs changes.

### 3.4 Receiving (Sharing → Dog cards, or Dogs → Add dogs from a card)

Paste the link or code, or open the file. **Nothing is saved until the preview is accepted.**

The preview:

- **The kennel it's from,** matched by public ID or added as an outside kennel, with the Kennel
  Card rules: never one of hers; a card from one of her own kennels is refused.
- **How she holds the dogs** (one answer for the card, changeable per dog):
  - **Co-owned with** a contact: one she picks, or a new contact (name prefilled with the
    sending kennel's, affiliated with it). The dogs go in one of her own kennels (picked when
    she has more than one). **Lives with** them or with her, per dog; default them.
  - **Owned by** that contact: outside dogs she refers to (studs, dams she leases).
- **Each dog:** New, Update (with what changes), Up to date, or **Link to** one of her dogs
  that looks like the same dog (same registration number, else same registered name, else same
  call name, sex and breed). Linking is offered, never automatic: a name is not a key.
- **Ancestors:** a count. Matched by public ID, else by the same registry and registration
  number; the rest are added as pedigree-only dogs.
- **Tests and titles:** how many are new or changed.

### 3.5 Updating: what a card may change on a dog she already has

A card sent again (or any card naming a dog she has by its public ID) updates only the fields
it carries (§3.2), and a blank one on the card is "not supplied", never "clear mine". It never
touches her side: ownership, her kennel, co-owners and lives with, notes, planned tests,
disposition, website and waitlist settings, or events she recorded herself. Status follows the
card only to Deceased.

Tests and titles are matched by their reference (`events.shared_ref`, `<dog public ID>:<the
sender's event id>`), so a re-send updates them in place. One the sender deleted stays on hers
(removals are phase 3).

### 3.6 Editions and limits

- Pro and Demo (`editionFlags.dogCards`); Lite can't send or receive. Lite's dog cap would make
  a bulk add half-fail, and Lite has no kennels pages to name the sending kennel.
- Offline: no network call, no server, like Kennel Cards.

## 4. Phase 2: live updates (plan)

- **Follow this card.** The sender ticks **Keep them up to date** when sending (cloud on). Her
  device puts the card on the server under a share ID and, from then on, sends it again on its
  own whenever one of its dogs, tests or titles changes (the portal feed's way: 20 seconds
  after a change, and when KennelOS opens). The link carries the share ID and a read key.
- **The receiver follows it.** Accepting a followed card stores the share on her kennel record
  (cloud, so every device of hers follows it). Her device checks it at each sync and applies
  changes with §3.5's rules, **without asking**, since she accepted those dogs and those fields
  once; Today says what changed ("3 of Thornfield's dogs were updated").
- **One direction per share; the keeper sends.** Whoever the dog lives with is its keeper. When a
  dog moves, the new keeper sends her own card for it; the receiving app skips updates for a dog
  that now lives with her.
- **Stopping:** either side can stop a share. The dogs and everything already received stay.
- **Server:** one migration: `dog_shares` (owner account, read-key hash, the card's encrypted
  payload, updated at). The payload is the card encrypted with a key in the link, so the
  server stores it but can't read it. Never logged.
- **Build chunks:** server endpoints and migration; sending on its own; following and applying;
  Today and the stop controls.

## 5. Decisions made for phase 1 (to confirm)

1. One direction at a time, from the breeder the dog lives with (§4). No two-way editing.
2. Each breeder keeps her own notes, contacts, money and plans; none of them travel.
3. Phase 1 is by hand and offline; live updates come with phase 2.

## 6. Data model (phase 1)

| Change | Where |
|---|---|
| `dogs.public_id` (indexed, `db.version(6)`; cloud; write-once) | `db.js`, `dogRepo.js`, `syncRegistry.js` |
| `events.shared_ref` (plain field, unindexed; cloud) | `eventRepo` writes through `dogCard.js`; `syncRegistry.js` |
| `editionFlags.dogCards` (Lite false) | `editionConfig.js` per edition |
| `pages/dog-cards.html` / `.js` (Pro only) | `proPages.js`, `sw.js` |
| `data/dogCard.js` (shared data layer) | `sw.js` |

Backups: both new fields are optional with no default; an older build skips them.

## 7. Risks

- **A big program on one link.** A message app may cut a long link: the file is the safe
  path for more than a few dogs, and the screen says so.
- **The wrong dog linked.** Linking is only ever her pick in the preview; ancestors link only
  by public ID or an exact registry and registration number.
- **A card from a stranger.** It can only add outside or co-owned dogs and an outside kennel,
  after a preview; it can never change her own kennel, contacts or money.

## 8. Open questions

1. Phase 3: should heats and breedings travel, opt-in per share, for co-owns with breeding
   rights?
2. Should vaccinations travel too (useful when the dog moves between the two homes)?
3. A test the receiver records while the dog lives with her: send it back to the keeper
   (phase 3), or leave each breeder's own records her own?
4. Should a sender see which dogs she has sent, and to whom, on the dog's page?
