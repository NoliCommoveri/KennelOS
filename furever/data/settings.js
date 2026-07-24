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
  addToHomeScreenDismissed: 'furever.addToHomeScreenDismissed',
  theme: 'furever.theme',
  trainingContentVersion: 'furever.trainingContentVersion'
};

// The palette ids the switcher offers. 'warm' is the default (no data-theme
// attribute); the rest map to the :root[data-theme=…] blocks in app.css.
export const THEMES = [
  { value: 'warm',   label: 'Warm',   swatch: '#b06a4f' },
  { value: 'ocean',  label: 'Ocean',  swatch: '#2f7ca8' },
  { value: 'forest', label: 'Forest', swatch: '#4c8a5d' },
  { value: 'berry',  label: 'Berry',  swatch: '#a6518f' },
  { value: 'slate',  label: 'Slate',  swatch: '#5b6b86' }
];

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

// --- Theme (palette) -------------------------------------------------------
// Stored in localStorage (a UI pref, not a record) so bootcheck.js can apply it
// synchronously in <head> and avoid a flash of the default palette.
export function getTheme() {
  return localStorage.getItem(KEYS.theme) || 'warm';
}

export function setTheme(theme) {
  const value = theme || 'warm';
  localStorage.setItem(KEYS.theme, value);
  applyTheme(value);
  return value;
}

// Reflect a palette onto <html> (warm = no attribute, the base :root palette).
export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (!theme || theme === 'warm') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
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

// --- Training content version-gate (trainingSkillRepo.ensureTrainingSkillsSeeded) --
// A plain "have we caught up to trainingContent.js's version" flag — the same
// small synchronous-state role this file plays for lastBackupDate.
export function getTrainingContentVersion() {
  const raw = localStorage.getItem(KEYS.trainingContentVersion);
  return raw == null ? null : Number(raw);
}

export function setTrainingContentVersion(version) {
  localStorage.setItem(KEYS.trainingContentVersion, String(version));
}

// --- Full reset ------------------------------------------------------------
// Remove every localStorage key this app owns, so a hard reset lands back on the
// exact first-run state a never-visited browser would see (active pet, theme,
// persist/backup/nudge bookkeeping — all of it). Paired with clearing the tables
// in appReset.js.
export function clearAllSettings() {
  for (const key of Object.values(KEYS)) localStorage.removeItem(key);
}
