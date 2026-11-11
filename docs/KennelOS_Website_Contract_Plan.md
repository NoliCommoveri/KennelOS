# Website contract plan: sending raw data to KennelPort

A plan from the review of the KennelOS ↔ KennelPort contract (2026-11-10). Nothing here
is built. This is KennelOS's half; the whole plan, with KennelPort's rules, blocks and
build order, is KennelPort's `docs/plans/kennelos-contract.md`. What is built today is
End-State guide §35.

## Why

Breeders want more say over their websites: dog cards split by colour or titles, a
status for pups born but not yet open for deposits, more kinds of accounts, pedigrees, a
sire's or dam's best offspring, tags for imports and import-descended dogs.

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
| C1 | `pup_disposition` | `puppyStatus()` maps disposition to a site word | On each litter puppy: `disposition` as she set it, null when none is set (the existing `disposition` section, on a marked puppy-status dog, sends `undecided` instead) |
| C2 | `litter_status` | Status becomes dates only (`born = status !== 'expected'`) | On each litter: `status` (`expected`, `whelped`, `weaning`, `ready`) |
| C3 | `titles_detail` | `titlesByDog`: the abbreviation only | `titles` as `[{ abbr, organization, date }]`, from the `title_earned` events |
| C4 | `origin` | Nothing | On a dog, and on each C7 ancestor: `imported` and `import_country`, as she set them. KennelPort works out import-descended from the ancestors |
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

| Field | On | Kind | Sync class (proposed) |
|---|---|---|---|
| `imported` | Dog | boolean, default false | cloud: a fact about the dog, like `registry` |
| `import_country` | Dog | text, optional; empty unless `imported` | cloud, the same |

**Making a field `cloud` is a privacy decision** and is the owner's to confirm for each
row above before it is built. Cloud fields changing means regenerating
`cloud/src/lib/cloudFields.js`.

Import-descended is never stored or sent: KennelPort works it out from the C7 ancestors
(four generations), so C4 goes out with C7.

The Dog form gains an **Imported** tick beside the registry fields. Ticked, it shows
**Country of origin**; unticked, the country is hidden and cleared when the dog is saved
(the owner, 2026-11-11). Kels's Update my website asks about nothing new: these aren't
gaps.

Featured offspring (a sire's or dam's best pups) is KennelPort's own, kept and typed on
the website; nothing for it comes from KennelOS (the owner, 2026-11-11).

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
over any field, picks, the Featured block) need nothing from KennelOS. KennelOS's one change
before then goes with KennelPort's step 1:

0. **`reserved` out:** `siteExport.js` drops `reserved` from `PUPPY_WORDS`, with its
   tests. No new section: `reserved` was never sent.

The rest starts at KennelPort's step 4:

1. **C1, C2, C5, C6:** values KennelOS already holds. `siteExport.js`, its tests, guide §35.
2. **C3:** titles with organization and date.
3. **C4, C7:** the two new Dog fields, the pedigree walk, origin and lineage. C4 goes
   with C7.
4. **C9:** waitlist facts.

Each batch: `node --check`, `node --test`, `node build/assemble.mjs`; a new app file goes
in `PRECACHE_URLS`; ask before the SW cache bump.

## Open questions (the owner's)

Answered 2026-11-11: Imported is a tick that shows Country of origin, cleared when
unticked; import-descended is KennelPort's (3 generations by default, her override per
dog there); featured offspring is KennelPort's, not KennelOS's; colours are picked on the
website from what KennelOS sends, so KennelOS keeps no colour list.

Still open:

1. The sync class of `imported` and `import_country`, above (both proposed `cloud`).
2. Kels's list of what an update changes calls a placed pup "Spoken for"
   (`PUPPY_WORDS.placed`), while the website's default for placed reads "Reserved". Keep
   them different, or match one to the other?
