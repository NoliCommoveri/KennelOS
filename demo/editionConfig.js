// demo/editionConfig.js — Demo edition config.
//
// Demo is the Pro feature set with "demo mode" on: seeded sample data, all
// writes are friendly no-ops, re-seeded clean each visit (editions plan §Demo).
// The cap is irrelevant here (writes are blocked upstream by demo mode), so the
// cap hooks are no-ops like Pro's. `demoMode` is the flag the shared write layer
// will read to short-circuit create/update/archive into a "changes aren't saved"
// notice — that wiring lands with the Demo build, not in this foundation pass.

export const edition = 'demo';

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
};
