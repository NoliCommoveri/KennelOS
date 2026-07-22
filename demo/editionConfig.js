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

export async function enforceDogCap(/* { candidate, existing, id } */) {
  // no-op: writes are blocked by demo mode, not the cap.
}

export async function enforceLitterCap(/* { candidate } */) {
  // no-op: writes are blocked by demo mode, not the cap.
}

export const editionFlags = {
  manualDogArchive: true,
  includeArchivedToggles: true,
  archivedDogLinks: true,
  demoMode: true, // placeholder — read by the shared write layer in the Demo pass
  // Pro-only feature gates — all on in Demo (shows the whole Pro app).
  contactsSection: true,
  studServices: true,
  contracts: true,
  documents: true,
  companion: true,
  reports: true,
  invoicing: true,
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

export const moreItems = [
  { label: 'Reports',       path: 'pages/reports.html' },
  { label: 'Documents',     path: 'pages/documents.html' },
  { label: 'Companion',     path: 'pages/companion.html' },
  { label: 'Import/Export', path: 'pages/import-export.html' },
];
