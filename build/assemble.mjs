// build/assemble.mjs — assemble a per-edition artifact under dist/<edition>/.
//
// This is the "tiny file-exclude step at deploy" that Option B trades for keeping a
// single pages/ root (no cross-directory link rewrites). It is NOT a compiler — just
// copy + overlay + delete + a service-worker rewrite. Run it, then serve/deploy the
// resulting dist/<edition>/ directory (each edition to its own origin).
//
//   node build/assemble.mjs            # all editions
//   node build/assemble.mjs lite       # just one
//
// What it does per edition:
//   1. copy shared/ -> dist/<edition>/           (the artifact is shaped like the app,
//                                                  so every existing relative path works)
//   2. overlay <edition>/editionConfig.js -> dist/<edition>/data/editionConfig.js
//   3. (lite only) delete the Pro-only page files listed in shared/data/proPages.js
//   4. regenerate dist/<edition>/sw.js: edition-specific CACHE_NAME + a precache list
//      filtered to the files that actually exist in the artifact (so cache.addAll,
//      which is atomic, can never fail on a missing/excluded path).

import { existsSync, rmSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRO_ONLY_PAGES, PRO_ONLY_STANDALONE } from '../shared/data/proPages.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDITIONS = ['lite', 'pro', 'demo'];
// Standalone apps are NOT editions of the shared core — they build off their own
// folder, so they take a separate assembly path (assembleStandalone) with none of
// the editionConfig / manifest / service-worker rewriting below.
const STANDALONE_APPS = ['furever'];

// --- Launch placeholder guard ---------------------------------------------
// Values in the edition configs that are stand-ins until launch: Lite's upgrade
// CTA and Pro's checkout URL. Shipping one means a live store with a dead
// "buy/upgrade" link, so a RELEASE build (CI / `--release`) refuses to assemble
// an edition whose overlaid editionConfig still contains one. A plain dev build
// only warns, so building editions to test locally still works while these are
// unset. Trim an entry once its real value lands (and it no longer matches).
const LAUNCH_PLACEHOLDERS = [
  'https://kennelos.app/upgrade',               // lite/editionConfig.js  upgradeUrl
  'https://kennelos.lemonsqueezy.com/checkout', // pro/editionConfig.js   licenseConfig.checkoutUrl
];

// Scan an assembled edition's editionConfig for any unresolved placeholder.
// In release mode a hit throws (fails the build/deploy); otherwise it warns.
function checkLaunchPlaceholders(destDir, edition, release) {
  const text = readFileSync(join(destDir, 'data', 'editionConfig.js'), 'utf8');
  const hits = LAUNCH_PLACEHOLDERS.filter((p) => text.includes(p));
  if (!hits.length) return;
  const detail = `${edition}: editionConfig still has launch placeholder(s): ${hits.join(', ')}`;
  if (release) throw new Error(`${detail}\nReplace them (see docs/LAUNCH_CHECKLIST.md) or build without --release for local testing.`);
  console.warn(`⚠️  ${detail} (dev build — would FAIL a --release/CI build)`);
}

// Per-edition PWA identity, stamped into the copied manifest.json (and the root
// index.html <title>) so an installed edition reads as its own app rather than a
// generic "KennelOS". Each edition already deploys to its own origin, so this is
// purely how it's LABELLED (installer name, tab title), not scoping.
const EDITION_NAMES = {
  lite: 'KennelOS Lite',
  pro:  'KennelOS Pro',
  demo: 'KennelOS Demo',
};

function stemJs(htmlBasename) {
  return htmlBasename.replace(/\.html$/, '.js');
}

// Pages excluded from the Demo build: the save/export surface is stripped so an
// unlocked copy is a dead end (editions plan §Demo hardening #8). Excluded like a
// Pro-only page is from Lite — the file simply isn't there, so a direct URL 404s.
const DEMO_EXCLUDED_PAGES = ['import-export.html'];

// Files excluded from an edition. Lite drops the Pro-only pages; Demo drops the
// save/export page; Pro ships everything.
function exclusionsFor(edition) {
  const files = [];
  if (edition === 'lite') {
    for (const html of PRO_ONLY_PAGES) {
      files.push(join('pages', html));
      files.push(join('pages', stemJs(html))); // .js sibling, if it exists
    }
    for (const f of PRO_ONLY_STANDALONE) files.push(f);
  } else if (edition === 'demo') {
    for (const html of DEMO_EXCLUDED_PAGES) {
      files.push(join('pages', html));
      files.push(join('pages', stemJs(html)));
    }
  }
  return files;
}

// Rewrite a copied sw.js: edition cache name + precache filtered to existing files.
function rewriteServiceWorker(destDir, edition) {
  const swPath = join(destDir, 'sw.js');
  let text = readFileSync(swPath, 'utf8');

  // Carry the shared cache version (kennelos-shell-vN in shared/sw.js) into the
  // edition name, so the one CLAUDE.md bump rolls every edition's cache over on
  // the next deploy. Falls back to v1 if the shared name isn't in the expected shape.
  const ver = text.match(/const CACHE_NAME = 'kennelos-shell-v(\d+)';/)?.[1] ?? '1';
  text = text.replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = 'kennelos-${edition}-shell-v${ver}';`);

  const m = text.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  if (!m) throw new Error(`${edition}: could not find PRECACHE_URLS in sw.js`);
  const entries = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const kept = entries.filter((e) => e === './' || existsSync(join(destDir, e)));
  const dropped = entries.filter((e) => !kept.includes(e));
  const rebuilt = 'const PRECACHE_URLS = [\n' + kept.map((e) => `  '${e}',`).join('\n') + '\n];';
  text = text.replace(/const PRECACHE_URLS = \[[\s\S]*?\];/, rebuilt);

  writeFileSync(swPath, text);
  return { precache: kept.length, droppedFromPrecache: dropped.length, cacheName: `kennelos-${edition}-shell-v${ver}` };
}

// Stamp the edition's name into manifest.json (name + short_name) so the PWA
// installs as "KennelOS Lite/Pro/Demo". Parse/serialize as JSON so we touch only
// those two keys and leave icons/colors/etc. intact.
function rewriteManifest(destDir, edition) {
  const p = join(destDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(p, 'utf8'));
  manifest.name = EDITION_NAMES[edition];
  manifest.short_name = EDITION_NAMES[edition];
  writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
}

// Stamp the edition name into the root index.html <title> (the front door). Only
// the root redirect page is edition-labelled here; per-page titles stay generic.
function rewriteIndexTitle(destDir, edition) {
  const p = join(destDir, 'index.html');
  const text = readFileSync(p, 'utf8').replace(/<title>[^<]*<\/title>/, `<title>${EDITION_NAMES[edition]}</title>`);
  writeFileSync(p, text);
}

function assemble(edition, release) {
  const dest = join(ROOT, 'dist', edition);
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(ROOT, 'shared'), dest, { recursive: true });

  // Overlay the edition's config at the fixed shared path.
  cpSync(join(ROOT, edition, 'editionConfig.js'), join(dest, 'data', 'editionConfig.js'));

  // Fail a release build (never a dev build) if launch placeholders remain.
  checkLaunchPlaceholders(dest, edition, release);

  // Overlay the edition's guided-tour package (sample seed + step catalog) if it
  // ships one — only Lite does; Pro/Demo keep the shared default (the full
  // Thornfield packet + full step catalog). Same fixed-path overlay as the config.
  const tourOverlay = join(ROOT, edition, 'editionTour.js');
  if (existsSync(tourOverlay)) cpSync(tourOverlay, join(dest, 'data', 'editionTour.js'));

  // Exclude Pro-only files (Lite).
  const excluded = [];
  for (const rel of exclusionsFor(edition)) {
    const p = join(dest, rel);
    if (existsSync(p)) { rmSync(p); excluded.push(rel); }
  }

  rewriteManifest(dest, edition);
  rewriteIndexTitle(dest, edition);

  const sw = rewriteServiceWorker(dest, edition);
  console.log(`✅ ${edition}: dist/${edition}/  (excluded ${excluded.length} files, precache ${sw.precache}, cache ${sw.cacheName})`);
}

// --- Standalone app assembly (Furever) ------------------------------------
// Furever is a SEPARATE app (its own origin + IndexedDB), built off furever/ not
// shared/. Its vendored Dexie is COMMITTED at furever/vendor/dexie.min.mjs (like
// shared/vendor/), so the source folder is directly servable and the copy below is
// just a belt-and-suspenders refresh from shared to keep the two dexie copies in
// lockstep. No editionConfig overlay, no manifest/index restamping, no
// service-worker rewrite (Furever ships none yet). The --release flag has no launch
// placeholders to guard here, so it's a no-op.
function assembleStandalone(app) {
  const dest = join(ROOT, 'dist', app);
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(ROOT, app), dest, { recursive: true });
  const vendorDir = join(dest, 'vendor');
  mkdirSync(vendorDir, { recursive: true });
  cpSync(join(ROOT, 'shared', 'vendor', 'dexie.min.mjs'), join(vendorDir, 'dexie.min.mjs'));
  console.log(`✅ ${app}: dist/${app}/  (standalone app; vendored dexie)`);
}

// Args: an optional edition name (or 'all') plus an optional --release flag that
// turns the launch-placeholder check from a warning into a hard failure (used by
// the deploy workflow, which ships to the live origins).
const args = process.argv.slice(2);
const release = args.includes('--release');
const positional = args.filter((a) => !a.startsWith('--'));
const arg = positional[0];
const ALL_TARGETS = [...EDITIONS, ...STANDALONE_APPS];
const targets = !arg || arg === 'all' ? ALL_TARGETS : [arg];
for (const t of targets) {
  if (STANDALONE_APPS.includes(t)) { assembleStandalone(t); continue; }
  if (!EDITIONS.includes(t)) { console.error(`unknown target: ${t}`); process.exit(1); }
  assemble(t, release);
}
