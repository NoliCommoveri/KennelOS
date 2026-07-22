// lite/editionConfig.js — Lite edition config.
//
// FOUNDATION STATUS: still a no-op. This file exists so the edition set is
// uniform and so the deploy-swap shape is real, but the actual cap enforcement
// and the flag flips below are DELIBERATELY not wired yet — they're the "layer
// cap logic on top" pass that follows this foundation. Nothing imports this file
// yet (shared code imports shared/data/editionConfig.js), so it is inert today.
//
// WHAT THIS FILE WILL BECOME (per KennelOS_Lite_Cap_Enforcement_Spec.md):
//   - enforceDogCap:   throw CapExceededError when a *new* counting dog would be
//                      added (create) or a dog transitions ✗→✓ into the counting
//                      set (update) while already at CAP_DOGS (6). §3/§4.
//   - enforceLitterCap: throw when creating a litter at CAP_LITTERS (2). §4.
//   - editionFlags:    manualDogArchive=false, includeArchivedToggles=false,
//                      archivedDogLinks=false — hide the archive mechanism so it
//                      can't be reverse-engineered into a cap bypass. §5/§7.
// The counting predicate (countsTowardDogCap) and CAP_DOGS / CAP_LITTERS = 6 / 2
// live in §0/§2 of that spec and will move in with the enforcement.

export const edition = 'lite';

export async function enforceDogCap(/* { candidate, existing, id } */) {
  // no-op for foundation — real enforcement lands in the cap pass.
}

export async function enforceLitterCap(/* { candidate } */) {
  // no-op for foundation — real enforcement lands in the cap pass.
}

export const editionFlags = {
  // Left at Pro defaults for foundation; the cap pass flips these to false.
  manualDogArchive: true,
  includeArchivedToggles: true,
  archivedDogLinks: true,
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
