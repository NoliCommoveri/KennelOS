// lite/editionConfig.js — Lite edition config.
//
// This is the injection point the assembler overlays onto the fixed shared path
// dist/lite/data/editionConfig.js (build/assemble.mjs step 2), so its relative
// imports resolve as if it sat in shared/data/ — './db.js', './repoBase.js' are
// its siblings in the assembled artifact.
//
// It carries Lite's real cap enforcement (KennelOS_Lite_Cap_Enforcement_Spec.md):
// the 6/2 caps, the counting predicate, the transition-in block rule, and the
// UI flags that strip the archive machinery so the cap can't be reverse-
// engineered into a bypass. Pro/Demo ship the shared no-op copy instead, so no
// cap logic lands in the Pro download.
import { db } from './db.js';
import { CapExceededError } from './repoBase.js';

// --- The two numbers (cap spec §0) — locked for launch ---------------------
const CAP_DOGS = 6; // counting dogs
const CAP_LITTERS = 2; // litters

export const edition = 'lite';

// Where the "Upgrade to Pro →" CTA sends the owner AFTER their backup export
// runs (upgrade bridge — editions plan §"Converting Lite → Pro"). The bridge is
// export-in-Lite → checkout → import-in-Pro; this is the checkout step's URL.
// PLACEHOLDER — swap for the real Lemon Squeezy checkout link (with its
// post-purchase redirect set to the Pro origin) at launch. One-line change here.
export const upgradeUrl = 'https://kennelos.app/upgrade';

// --- The counting predicate (cap spec §2) ----------------------------------
// A dog counts toward the Lite cap only when it is a live, owned/co-owned adult.
// - is_archived is IN the predicate: an archived dog is a *departed* dog and
//   does not count (that departure is the honest slot-free — §4/§5).
// - Only adult stages count, so a whole kept litter (status 'puppy') never trips
//   the cap, and puppies/deceased/external_reference are excluded automatically.
// - co_owned counts (excluding it would be a one-click "mark it co-owned" bypass).
const CAP_OWNERSHIP = new Set(['owned', 'co_owned']);
const CAP_ADULT_STATUS = new Set(['active_breeding', 'retired_breeding', 'pet_home', 'for_sale']);

const countsTowardDogCap = (dog) =>
  !dog.is_archived &&
  CAP_OWNERSHIP.has(dog.ownership_type) &&
  CAP_ADULT_STATUS.has(dog.status);

// Count the current counting dogs, optionally excluding one id (an update
// compares the record against everyone *else*).
async function countCountingDogs(excludeId = null) {
  const all = await db.dogs.toArray();
  let n = 0;
  for (const d of all) {
    if (d.id === excludeId) continue;
    if (countsTowardDogCap(d)) n++;
  }
  return n;
}

// --- Cap hooks (cap spec §3/§4) --------------------------------------------
// The rule is NOT "block while over cap"; it is "block a write that adds a *new*
// counting dog while already at the cap." Editing a dog that already counts is
// never blocked, and departing (archive / deceased) always frees a slot.
export async function enforceDogCap({ candidate, existing /*, id */ }) {
  const will = countsTowardDogCap(candidate);
  if (!will) return; // result doesn't count (departure, puppy, deceased…) — never blocked
  const was = existing ? countsTowardDogCap(existing) : false;
  if (was) return; // ✓→✓: already counted — editing other fields is always allowed
  // create (no existing) or a ✗→✓ transition-in (e.g. a kept puppy maturing).
  const current = await countCountingDogs(existing ? existing.id : null);
  if (current >= CAP_DOGS) throw new CapExceededError('dogs', current, CAP_DOGS);
}

// Litter create is capped on the raw litter count (archived included — Lite has
// no manual litter-archive, so there won't normally be any). Litter update is
// never capped (§4).
export async function enforceLitterCap(/* { candidate } */) {
  const current = (await db.litters.toArray()).length;
  if (current >= CAP_LITTERS) throw new CapExceededError('litters', current, CAP_LITTERS);
}

// --- UI capability flags ---------------------------------------------------
// Lite hides the archive machinery (cap spec §5/§7) so "archived = departed and
// uncounted" can't be reverse-engineered into a bypass, and turns off every
// in-page door to a Pro-only feature (the pages themselves are excluded from the
// Lite build — Option B).
export const editionFlags = {
  // Archive-mechanism flags — OFF in Lite.
  manualDogArchive: false,       // departure is the only exit; no free Archive/Unarchive button
  includeArchivedToggles: false, // no "include archived" toggle anywhere (list, pickers)
  archivedDogLinks: false,       // archived dog names render as plain text, never links; no "arch" badge

  // Pro-only feature gates — OFF in Lite.
  contactsSection: false,
  studServices: false,
  contracts: false,
  documents: false,
  companion: false,
  reports: false,
  invoicing: false,
  receiptAttach: false,
  externalOwnership: false,
  assistant: false,
};

// --- Navigation (Lite — reduced) -------------------------------------------
// Pro-only hubs are omitted: People (Contacts), Reports, Documents, Companion.
// The "Placements & Contracts" hub is relabeled "Sales" since Contracts and
// Stud services are Pro-only — only Sales remains in Lite.
export const navItems = [
  { label: 'Today',    path: 'pages/today.html' },
  { label: 'Dogs',     path: 'pages/dogs.html' },
  { label: 'Breeding', path: 'pages/breeding.html' },
  { label: 'Sales',    path: 'pages/sales.html' },
  { label: 'Financials', path: 'pages/financials.html' },
];

export const moreItems = [
  { label: 'Import/Export', path: 'pages/import-export.html' },
];
