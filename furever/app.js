// app.js — Furever's shared shell bootstrap, imported by every page. Renders the
// top nav (with the active-pet picker) and, on first run, asks the browser to
// keep this origin's data durable — this app is meant to last years on a family's
// phone, so eviction is the real risk (brief §"Keeping five years of records safe").
//
// No service worker yet: Furever's PWA/offline layer is a later step (schema doc
// §"Not built yet"). Pages import their own repos; this only wires the chrome.
import { renderNav } from './nav.js';
import { requestPersistentStorage } from './data/db.js';
import { wasPersistRequested, markPersistRequested } from './data/settings.js';

async function firstRunPersistence() {
  if (wasPersistRequested()) return;
  markPersistRequested(); // record the attempt so we only prompt once
  await requestPersistentStorage();
}

async function boot() {
  await renderNav();
  await firstRunPersistence();
}

boot();
