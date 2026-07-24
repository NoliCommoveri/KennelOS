// app.js — Furever's shared shell bootstrap, imported by every page. Consumes a
// breeder seed link if one rode in on the URL hash, renders the top nav (with the
// active-pet picker), and on first run asks the browser to keep this origin's data
// durable — this app is meant to last years on a family's phone, so eviction is
// the real risk (brief §"Keeping five years of records safe").
//
// No service worker yet: Furever's PWA/offline layer is a later step (schema doc
// §"Not built yet"). Pages import their own repos; this only wires the chrome.
import { renderNav } from './nav.js';
import { requestPersistentStorage } from './data/db.js';
import { wasPersistRequested, markPersistRequested, setActivePetId } from './data/settings.js';
import { consumeSeedLink, SeedLinkError } from './data/seedLink.js';
import { showError } from './assets/ui.js';

async function firstRunPersistence() {
  if (wasPersistRequested()) return;
  markPersistRequested(); // record the attempt so we only prompt once
  await requestPersistentStorage();
}

// index.html forwards its whole hash to pages/today.html, so "#seed=…" always
// lands here first regardless of which page the family's link actually opens.
// Consuming it before renderNav() means the sidebar already shows the new pet on
// first paint. Returns true when it triggered a redirect (so boot() skips the
// rest of this page's setup — it's being replaced).
async function consumeSeedLinkIfPresent() {
  if (!location.hash) return false;
  const hash = location.hash;
  history.replaceState(null, '', location.pathname); // never let the payload linger/re-fire on reload or share
  try {
    const result = await consumeSeedLink(hash);
    if (!result) return false;
    setActivePetId(result.pet.id);
    // Land the family on their pup's Profile, not wherever the link happened to open.
    if (!location.pathname.endsWith('/profile.html')) {
      location.replace('profile.html');
      return true;
    }
    return false;
  } catch (err) {
    showError(err instanceof SeedLinkError ? err.message : 'This link could not be read. Please ask your breeder for a fresh one.');
    return false;
  }
}

async function boot() {
  const redirecting = await consumeSeedLinkIfPresent();
  if (redirecting) return;
  await renderNav();
  await firstRunPersistence();
}

boot();
