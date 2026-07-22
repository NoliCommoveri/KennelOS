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

import { existsSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRO_ONLY_PAGES, PRO_ONLY_STANDALONE } from '../shared/data/proPages.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDITIONS = ['lite', 'pro', 'demo'];

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

// Files excluded from an edition (Lite excludes the Pro-only pages; Pro/Demo exclude nothing).
function exclusionsFor(edition) {
  if (edition !== 'lite') return [];
  const files = [];
  for (const html of PRO_ONLY_PAGES) {
    files.push(join('pages', html));
    files.push(join('pages', stemJs(html))); // .js sibling, if it exists
  }
  for (const f of PRO_ONLY_STANDALONE) files.push(f);
  return files;
}

// Rewrite a copied sw.js: edition cache name + precache filtered to existing files.
function rewriteServiceWorker(destDir, edition) {
  const swPath = join(destDir, 'sw.js');
  let text = readFileSync(swPath, 'utf8');

  text = text.replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = 'kennelos-${edition}-shell-v1';`);

  const m = text.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  if (!m) throw new Error(`${edition}: could not find PRECACHE_URLS in sw.js`);
  const entries = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const kept = entries.filter((e) => e === './' || existsSync(join(destDir, e)));
  const dropped = entries.filter((e) => !kept.includes(e));
  const rebuilt = 'const PRECACHE_URLS = [\n' + kept.map((e) => `  '${e}',`).join('\n') + '\n];';
  text = text.replace(/const PRECACHE_URLS = \[[\s\S]*?\];/, rebuilt);

  writeFileSync(swPath, text);
  return { precache: kept.length, droppedFromPrecache: dropped.length };
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

function assemble(edition) {
  const dest = join(ROOT, 'dist', edition);
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(ROOT, 'shared'), dest, { recursive: true });

  // Overlay the edition's config at the fixed shared path.
  cpSync(join(ROOT, edition, 'editionConfig.js'), join(dest, 'data', 'editionConfig.js'));

  // Exclude Pro-only files (Lite).
  const excluded = [];
  for (const rel of exclusionsFor(edition)) {
    const p = join(dest, rel);
    if (existsSync(p)) { rmSync(p); excluded.push(rel); }
  }

  rewriteManifest(dest, edition);
  rewriteIndexTitle(dest, edition);

  const sw = rewriteServiceWorker(dest, edition);
  console.log(`✅ ${edition}: dist/${edition}/  (excluded ${excluded.length} files, precache ${sw.precache}, cache kennelos-${edition}-shell-v1)`);
}

const arg = process.argv[2];
const targets = !arg || arg === 'all' ? EDITIONS : [arg];
for (const e of targets) {
  if (!EDITIONS.includes(e)) { console.error(`unknown edition: ${e}`); process.exit(1); }
  assemble(e);
}
