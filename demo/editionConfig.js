// demo/editionConfig.js — Demo edition config.
//
// Demo is the Pro feature set with "demo mode" on: seeded sample data, all
// writes are friendly no-ops, re-seeded clean each visit (editions plan §Demo).
// The cap is irrelevant here (writes are blocked upstream by demo mode), so the
// cap hooks are no-ops like Pro's. `demoMode` is the flag the shared write layer
// will read to short-circuit create/update/archive into a "changes aren't saved"
// notice — that wiring lands with the Demo build, not in this foundation pass.

export const edition = 'demo';

// No in-app upgrade CTA in this edition (Pro is already the full app; Demo is a
// read-only showcase). Exported so shared code that reads it always resolves.
export const upgradeUrl = null;

// No outbound edition links from Demo (Lite is the hub that links out; Demo is
// itself the target of Lite's "See the full app" link). Null so hasEditionLinks()
// is false and nothing renders.
export const demoUrl = null;

// License gate config (data/license.js). Demo is a public read-only showcase and
// must NEVER be walled, so the gate stays off (no licenseGate:true in editionFlags
// below). Exported only so license.js's named import resolves in the Demo build.
export const licenseConfig = { checkoutUrl: null, portalUrl: null, yearlyVariantPattern: 'year|annual' };

export async function enforceDogCap(/* { candidate, existing, id } */) {
  // no-op: writes are blocked by demo mode, not the cap.
}

export async function enforceLitterCap(/* { candidate } */) {
  // no-op: writes are blocked by demo mode, not the cap.
}

// Read by dog.js's "New Dog" page for its cap-status banner. Null means
// uncapped, so Demo shows nothing (Demo mirrors the Pro feature set).
export async function dogCapStatus() {
  return null;
}

export const editionFlags = {
  manualDogArchive: true,
  includeArchivedToggles: true,
  archivedDogLinks: true,
  fullDogStatuses: true,
  demoMode: true, // read by demoMode.js — every user write becomes a no-op
  // Pro-only feature gates — all on in Demo (shows the whole Pro app).
  contactsSection: true,
  studServices: true,
  contracts: true,
  documents: true,
  companion: true,
  reports: true,
  invoicing: true,
  puppyRecord: true,
  fosterArrangement: true,
  receiptAttach: true,
  externalOwnership: true,
  assistant: true,
};

// Full nav bar (Demo shows the whole Pro app, read-only).
export const navItems = [
  { label: 'Today',    path: 'pages/today.html' },
  { label: 'Dogs',     path: 'pages/dogs.html' },
  { label: 'Breeding', path: 'pages/breeding.html' },
  { label: 'People',   path: 'pages/contacts.html' },
  { label: 'Placements & Contracts', path: 'pages/sales.html' },
  { label: 'Financials', path: 'pages/financials.html' },
];

// Import/Export is omitted — the demo strips the save/export paths (editions plan
// §Demo hardening #8); the page files are excluded from the demo build too, so a
// direct URL 404s just like a Pro-only page does in Lite.
export const moreItems = [
  { label: 'Reports',       path: 'pages/reports.html' },
  { label: 'Documents',     path: 'pages/documents.html' },
  { label: 'Companion',     path: 'pages/companion.html' },
];
