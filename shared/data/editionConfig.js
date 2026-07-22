// editionConfig.js — the per-edition injection point (Lite / Pro / Demo).
//
// WHY THIS FILE EXISTS: the repos live in /shared and must stay edition-agnostic,
// so the Lite cap can't be hardcoded here. Instead every edition ships its OWN
// editionConfig.js at this fixed shared path (KennelOS_Lite_Cap_Enforcement_Spec
// §8). Shared code imports from here; the edition supplies the behavior.
//
// THIS COPY is the default shipped in /shared: **Pro semantics** — no cap, full
// features. Pro and Demo use it as-is (no cap logic ships in the Pro download).
// Lite replaces it with a version whose hooks actually enforce the cap and whose
// flags strip the archive machinery.
//
// FOUNDATION STATUS: no-op only. The three repo call sites already await these
// hooks, but the default implementations do nothing, so behavior is unchanged.
// Lite's real cap logic + UI flags are a later pass.

export const edition = 'pro';

// --- Cap hooks -------------------------------------------------------------
// The interactive dog/litter writers await these before persisting (the three
// sites in the cap spec §3: dogRepo.create, dogRepo.update, litterRepo.create).
// A repo can't prompt the user, so the Lite version THROWS a CapExceededError
// the forms catch and turn into an upgrade nudge. The default here does nothing.

export async function enforceDogCap(/* { candidate, existing, id } */) {
  // no-op: Pro/Demo are unlimited.
}

export async function enforceLitterCap(/* { candidate } */) {
  // no-op: Pro/Demo are unlimited.
}

// --- UI capability flags ---------------------------------------------------
// Read by shared UI to gate the edition-specific behaviors described in the cap
// spec. Pro defaults = everything on; Lite will flip these to hide the archive
// mechanism (no manual dog-archive, no include-archived toggles, archived-dog
// names render as plain text rather than links).
export const editionFlags = {
  manualDogArchive: true,        // Lite: false — departure is the only exit
  includeArchivedToggles: true,  // Lite: false — no way to surface departed dogs
  archivedDogLinks: true,        // Lite: false — archived dog names aren't clickable
};

// --- Navigation ------------------------------------------------------------
// nav.js renders from these. This default (Pro/shared) is the full bar. Lite
// ships a reduced list (its own editionConfig) that omits the Pro-only hubs.
export const navItems = [
  { label: 'Today',    path: 'pages/today.html' },    // dashboard + reminders + upcoming + board
  { label: 'Dogs',     path: 'pages/dogs.html' },
  { label: 'Breeding', path: 'pages/breeding.html' }, // pairings + litters + resulting puppies
  { label: 'People',   path: 'pages/contacts.html' }, // contacts + waitlist / buyers
  { label: 'Placements & Contracts', path: 'pages/sales.html' }, // sales + stud services + contracts
  { label: 'Financials', path: 'pages/financials.html' }, // the expense ledger — where the money lives
];

export const moreItems = [
  { label: 'Reports',       path: 'pages/reports.html' },
  { label: 'Documents',     path: 'pages/documents.html' },
  { label: 'Companion',     path: 'pages/companion.html' },
  { label: 'Import/Export', path: 'pages/import-export.html' },
];
