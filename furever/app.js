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
import { fetchContentPackagesForPet } from './data/contentPackFetch.js';
import { petRepo } from './data/petRepo.js';
import { showError } from './assets/ui.js';

async function firstRunPersistence() {
  if (wasPersistRequested()) return;
  markPersistRequested(); // record the attempt so we only prompt once
  await requestPersistentStorage();
}

// Content Package Fetch Mechanism §4.4: "fetch on first open AND every resend" —
// i.e. exactly the moments a seed link was just consumed, never on an ordinary
// return visit. consumeSeedLinkIfPresent() often redirects to profile.html
// straight after (a real navigation, which would cancel an in-flight fetch), so
// the pet id hands off through sessionStorage rather than being awaited inline —
// it's picked up by boot() on whichever page load lands next, redirect or not.
const PENDING_FETCH_KEY = 'furever.pendingContentFetch';

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
    sessionStorage.setItem(PENDING_FETCH_KEY, result.pet.id);
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

// Best-effort, never awaited by boot() — runs after the app is already usable,
// never blocking first paint (§4.4 step 6). Any failure (offline, unpublished
// pack, malformed manifest) is swallowed inside fetchContentPackagesForPet.
async function runPendingContentPackFetch() {
  const petId = sessionStorage.getItem(PENDING_FETCH_KEY);
  if (!petId) return;
  sessionStorage.removeItem(PENDING_FETCH_KEY);
  const pet = await petRepo.getById(petId);
  if (pet) fetchContentPackagesForPet(pet);
}

async function boot() {
  const redirecting = await consumeSeedLinkIfPresent();
  if (redirecting) return;
  await renderNav();
  await firstRunPersistence();
  runPendingContentPackFetch();
}

boot();
