# Website contract plan: sending raw data to KennelPort

A plan from the review of the KennelOS ↔ KennelPort contract (2026-11-10). All four steps are
built (below). This is KennelOS's half; the whole plan, with KennelPort's rules, blocks and
build order, is KennelPort's `docs/plans/kennelos-contract.md`. What is built today is
End-State guide §35.

## Why

Breeders want more say over their websites: dog cards split by colour or titles, a
status for pups born but not yet open for deposits, more kinds of accounts, pedigrees,
tags for imports and import-descended dogs.

Two of the asks need nothing new from KennelOS. A sire's or dam's best offspring
(featured offspring) is KennelPort's own: she makes and picks those records in the Site
Manager. Colour already goes out as her free text (`color`); KennelPort builds each
website's colour list from what that site has been sent.

Several of these can't be done on the website because `shared/data/siteExport.js` works
a value out, or writes it as words, before sending. The fix is the same each time:
**KennelOS sends the fact, KennelPort's rules decide how a site shows it.** She still
only marks records and presses Update website.

## What stays

- Format 1, the allow-lists and `assertOnlyKeys` on every object.
- Only records she marked Show on website; a heat as a month only; prices only with Use
  my KennelOS prices.
- Sections: a new key goes only to a Worker whose answer lists its section, so either
  side can be released first.
- Nothing from a buyer, contact, note, contract or sale.
- Pro only, and no request without a linked website.

## What changes in `siteExport.js`

Each row is a new optional section. Today's keys keep going out until KennelPort has
moved to the new one.

| # | Section | Today | Sent raw |
|---|---|---|---|
| C1 | `pup_disposition` | `puppyStatus()` maps disposition to a site word | On each litter puppy: `disposition` as she set it, null when none is set |
| C2 | `litter_status` | Status becomes dates only (`born = status !== 'expected'`) | On each litter: `status` (`expected`, `whelped`, `weaning`, `ready`) |
| C3 | `titles_detail` | `titlesByDog`: the abbreviation only | `titles` as `[{ abbr, organization, date }]`, from the `title_earned` events |
| C4 | `origin` | Nothing | On a dog, and on each C7 ancestor: `imported` and `import_country` (only while Imported is ticked), as she set them. Nothing worked out: KennelPort works out import-descended from the C7 ancestors |
| C5 | `health_detail` | `completedTestsByDog`: name, result, outcome, date | Also `type` (the event type) and `verify_url` where one is held |
| C6 | `account_type` | The type becomes one `transport` yes or no | On a product: `account_type`; which accounts go is unchanged for now |
| C7 | `lineage` | No parents, no breed | On a dog: `breed`, `sire_id`, `dam_id`, and `ancestors` to four generations: `[{ id, path, call_name, registered_name, titles }]`, pedigree-only dogs included, by name only |
| C9 | `waitlist_facts` | `waitlistSteps` and `applicationFeePay` write whole sentences | `{ online_form, has_fee, fee_due_days, respond_days, max_passes }`; `steps` and `payment` still go to a Worker without the section |

All of it stays pure: plain records in, one object out. C7 walks `sire_id` /
`dam_id` over the dogs `kennelportLink.js` already gathers; a helper for the walk goes in
its own pure module with a depth cap and a guard against a loop in the data.

`bundleChanges` and `FIELD_WORDS` gain each new key, so Kels's list of what an update
would change stays in her words.

## New fields in KennelOS

These are structural changes. Each needs the End-State guide (§35 and the Dog entity),
`syncRegistry.js`, and, for an FK, `referenceRegistry.js`, in the same change. No new
table or index is needed, so no new `db.version` block. All are optional with defaults,
so backups stay backward compatible.

| Field | On | Kind | Sync class |
|---|---|---|---|
| `imported` | Dog | boolean, default false | cloud: a fact about the dog, like `registry` |
| `import_country` | Dog | text, optional | cloud, the same |

Both are classed as the Dog's other registration facts are (`registry`,
`registration_number`, `additional_registrations`): cloud, the owner's decision
(2026-11-13). No FK, so `referenceRegistry.js` is unchanged. Adding them regenerates
`cloud/src/lib/cloudFields.js`.

Import-descended isn't stored or sent: KennelPort works it out from the C7 ancestors
(within 3 generations by default) and she can untick it on one dog there.

The Dog form gains Imported beside the registry fields. Ticked, it shows Country of
origin; unticked, the country is cleared. Kels's Update my website asks about nothing
new: these aren't gaps.

## Privacy

- C7 names dogs that aren't on her website and may not be hers. They go by call
  name, registered name and titles only. Never an owner, a contact, a kennel she hasn't
  ticked Name this kennel on my website for, or a date of birth for a dog that isn't
  hers.
- Picks and sales don't go, and there is no `reserved` status (the owner's decision,
  2026-11-10): a pup with an open sale is marked Placed and follows the placed rules.
  `siteExport.js` drops the unused word from `PUPPY_WORDS`, and KennelPort stops taking it.

## Editions

The shared core stays edition-agnostic. The new fields are plain Dog fields in every
edition; sending them is behind `editionFlags.websiteLink`, as the bundle is now. Lite
and Demo make no request.

## Building it, in steps

KennelPort's steps 1 to 3 (her health order kept, the born-not-yet-open status, blocks
over any field, picks, the Featured block) need nothing from KennelOS. KennelOS's work
starts at KennelPort's step 4:

1. **C1, C2, C5, C6:** values KennelOS already holds. `siteExport.js`, its tests, guide §35.
   **Built 2026-11-13.** **Modified:** C5 sends `type` only. KennelOS holds no
   verification link on a health result, so there is no `verify_url` to send; adding
   one would be a new event field (owner's decision). Sent only to a Worker that lists
   each section; KennelPort's `SECTIONS` doesn't list them yet (its step 4).
2. **C3:** titles with organization and date.
   **Built 2026-11-13:** with the section, `titles` itself carries the objects (an older
   Worker still gets the abbreviations). The same title from the same organization goes
   once, at its first date.
3. **C4, C7:** the new Dog fields, the pedigree walk, origin, lineage.
   **Built 2026-11-13:** `data/pedigreeWalk.js` for the walk; an ancestor's `path` is the
   key named `path` (KennelPort's plan calls it "role path"); its `titles` follow the
   dog's (`titles_detail` or not). At most 30 ancestors (four full generations).
4. **C9:** waitlist facts.
   **Built 2026-11-13** (`waitlistFacts`): a top-level `waitlist_facts` object, sent once
   her waitlist is set up. `online_form` is true only while her list is online, as the
   worded steps read it. Not sent: `open_days`, so a template can't yet say "business
   days" where she counts only the days she does business (the worded steps don't either).

Each batch: `node --check`, `node --test`, `node build/assemble.mjs`; a new app file goes
in `PRECACHE_URLS`; ask before the SW cache bump.

## Open questions (the owner's)

All answered:

1. **Imported** (2026-11-11): a tick, and Country of origin while it's ticked. Import-
   descended is KennelPort's: within 3 generations by default, and she can untick it on
   one dog in the Site Manager (C4).
2. **Featured offspring** (2026-11-11): picked on the website, KennelPort's own. No
   offspring section and no Dog fields for it here.
3. **Colour** (2026-11-13): no tidy list in KennelOS. KennelPort builds each website's
   list from the free-text colours that site has been sent.
4. **Sync classes** (2026-11-13): as the Dog's other registration facts, cloud (above).
