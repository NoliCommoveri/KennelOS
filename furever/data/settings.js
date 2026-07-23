// settings.js — tiny localStorage-backed settings for Furever. The small,
// synchronous "UI state / last backup" use case localStorage is right for;
// records live in IndexedDB, never here.
//
// The ACTIVE PET lives here, not in a table: the whole app is scoped to one pet
// at a time (pick from the menu → every page shows that pet). This is nav state,
// so it belongs with UI prefs, and it survives reloads.

const KEYS = {
  activePetId: 'furever.activePetId',
  persistRequested: 'furever.persistRequested',
  lastBackupDate: 'furever.lastBackupDate',
  addToHomeScreenDismissed: 'furever.addToHomeScreenDismissed'
};

// --- Active pet (app-wide scope) ------------------------------------------
export function getActivePetId() {
  return localStorage.getItem(KEYS.activePetId); // pet id or null
}

export function setActivePetId(petId) {
  if (petId) localStorage.setItem(KEYS.activePetId, petId);
  else localStorage.removeItem(KEYS.activePetId);
  return petId || null;
}

export function clearActivePet() {
  localStorage.removeItem(KEYS.activePetId);
}

// --- Storage durability ----------------------------------------------------
export function wasPersistRequested() {
  return localStorage.getItem(KEYS.persistRequested) === '1';
}

export function markPersistRequested() {
  localStorage.setItem(KEYS.persistRequested, '1');
}

// --- Backup bookkeeping ----------------------------------------------------
export function getLastBackupDate() {
  return localStorage.getItem(KEYS.lastBackupDate); // ISO string or null
}

export function setLastBackupDate(iso = new Date().toISOString()) {
  localStorage.setItem(KEYS.lastBackupDate, iso);
  return iso;
}

// --- Add-to-Home-Screen nudge (eviction defense, brief §five years) --------
export function wasAddToHomeScreenDismissed() {
  return localStorage.getItem(KEYS.addToHomeScreenDismissed) === '1';
}

export function markAddToHomeScreenDismissed() {
  localStorage.setItem(KEYS.addToHomeScreenDismissed, '1');
}
