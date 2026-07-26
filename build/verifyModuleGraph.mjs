// build/verifyModuleGraph.mjs — static link-check of an assembled edition.
//
// Why this exists: the browser resolves ES modules at load time, and a single
// unresolvable binding kills the WHOLE graph, not just the one import. A page
// script that imports a name its edition's editionConfig doesn't export never
// evaluates at all, so every element it was going to fill stays on its
// placeholder text and every button it was going to wire stays dead — the page
// looks "loaded" and is completely inert. That is exactly how a missing
// `enforceImportDogCap` in pro/ and demo/ shipped a Pro build whose Import /
// Export page sat on "Checking…" with Reset and Set-up-your-kennel doing
// nothing, and an offline-first service worker then pinned that brick into
// every installed client's cache until the next CACHE_NAME rollover.
//
// Nothing caught it, because each edition config was independently valid —
// the break only exists in the SEAM between a shared importer and an overlaid
// edition file, which only closes in an assembled dist/<edition>/. So this runs
// over the assembled tree, per edition, as part of every build.
//
// It is a linker, not a type checker. Two questions only, both fatal:
//   1. does every imported module file exist in this edition's artifact?
//      (catches a Lite build still importing a page the exclude step deleted)
//   2. does every named import actually appear as an export of that file?
//      (catches the editionConfig-overlay seam above)
//
// Deliberate limits: vendored bundles under vendor/ are minified third-party
// code, so they're existence-checked but never parsed for exports. Imports are
// matched line-anchored (`^import`), which is how every module in this repo is
// written and keeps the regex off `import` inside prose comments and strings.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

// --- parsing ----------------------------------------------------------------

// Static imports, anchored to the start of a line so commented-out or quoted
// text can't match. Covers all five forms: bare side-effect, default, namespace,
// named, and default-plus-named — including the multi-line brace lists this
// codebase uses.
const STATIC_IMPORT = /^import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/gm;
// Dynamic import with a literal specifier. Existence-only: the binding names
// live in a destructure on the left of the await, which isn't worth parsing.
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

// The names a clause binds, ignoring `* as ns` (a namespace object is valid
// whatever the module exports) and mapping `a as b` back to the exported `a`.
function boundNames(clause) {
  const names = [];
  const braces = clause.match(/\{([\s\S]*)\}/);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const p = part.trim();
      if (!p) continue;
      names.push(p.split(/\s+as\s+/)[0].trim());
    }
  }
  // A default binding is anything before the brace/namespace clause.
  const head = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s+as\s+[\w$]+/, '').replace(/,/g, '').trim();
  if (head) names.push('default');
  return names;
}

function parseImports(src) {
  const out = [];
  for (const m of src.matchAll(STATIC_IMPORT)) {
    out.push({ spec: m[2], names: m[1] ? boundNames(m[1]) : [] });
  }
  for (const m of src.matchAll(DYNAMIC_IMPORT)) {
    out.push({ spec: m[1], names: [] });
  }
  return out;
}

// Every name a module exports. `export * from './x'` is followed one level deep
// per call and resolved recursively by the caller.
function parseExports(src) {
  const names = new Set();
  const reExports = [];
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\s*\*?\s*([\w$]+)|class\s+([\w$]+)|(?:const|let|var)\s+([\w$]+))/gm)) {
    names.add(m[1] || m[2] || m[3]);
  }
  // `export { a, b as c }` and the re-export form `export { a } from './x'`.
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/gm)) {
    for (const part of m[1].split(',')) {
      const p = part.trim();
      if (!p) continue;
      const pieces = p.split(/\s+as\s+/);
      names.add((pieces[1] || pieces[0]).trim());
    }
  }
  for (const m of src.matchAll(/^export\s*\*\s*from\s*['"]([^'"]+)['"]/gm)) {
    reExports.push(m[1]);
  }
  if (/^export\s+default\b/m.test(src)) names.add('default');
  return { names, reExports };
}

// --- the walk ---------------------------------------------------------------

function isVendor(file, root) {
  return relative(root, file).split(/[\\/]/)[0] === 'vendor';
}

function htmlEntryPoints(root) {
  const entries = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.html')) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/g)) {
          entries.push({ from: p, spec: m[1] });
        }
      }
    }
  };
  walk(root);
  return entries;
}

/**
 * Link-check every module reachable from an assembled edition's HTML pages.
 * @param {string} root absolute path to dist/<edition>/
 * @returns {{problems: string[], moduleCount: number}}
 */
export function verifyModuleGraph(root) {
  const problems = [];
  const cache = new Map();   // file -> source text (null when absent)
  const exportCache = new Map();
  const visited = new Set();

  const read = (file) => {
    if (!cache.has(file)) {
      cache.set(file, existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : null);
    }
    return cache.get(file);
  };

  // Exported names, following `export * from` chains. Vendored bundles return
  // null, meaning "unknown — don't check names against this".
  const exportsOf = (file, seen = new Set()) => {
    if (isVendor(file, root)) return null;
    if (exportCache.has(file)) return exportCache.get(file);
    const src = read(file);
    if (src === null) return new Set();
    seen.add(file);
    const { names, reExports } = parseExports(src);
    for (const spec of reExports) {
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      if (seen.has(target)) continue;
      const inherited = exportsOf(target, seen);
      if (inherited) for (const n of inherited) names.add(n);
    }
    exportCache.set(file, names);
    return names;
  };

  const rel = (f) => relative(root, f).split('\\').join('/');

  const walkModule = (file, importedBy) => {
    if (visited.has(file)) return;
    visited.add(file);
    const src = read(file);
    if (src === null) {
      problems.push(`${importedBy} imports "${rel(file)}", which does not exist in this build`);
      return;
    }
    if (isVendor(file, root)) return; // minified third-party: existence is the contract
    for (const { spec, names } of parseImports(src)) {
      if (!spec.startsWith('.')) {
        problems.push(`${rel(file)}: bare specifier "${spec}" — the app loads over plain HTTP with no bundler or import map`);
        continue;
      }
      const target = resolve(dirname(file), spec);
      if (read(target) === null) {
        problems.push(`${rel(file)} imports "${spec}", which does not exist in this build`);
        continue;
      }
      const available = exportsOf(target);
      if (available) {
        for (const n of names) {
          if (!available.has(n)) {
            problems.push(`${rel(file)}: "${spec}" does not export "${n}" — this breaks the whole module graph for every page that loads it`);
          }
        }
      }
      walkModule(target, rel(file));
    }
  };

  for (const { from, spec } of htmlEntryPoints(root)) {
    walkModule(resolve(dirname(from), spec), rel(from));
  }

  return { problems, moduleCount: visited.size };
}
