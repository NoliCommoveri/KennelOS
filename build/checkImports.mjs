// checkImports.mjs — after a target is assembled, every relative static import in its
// .js files, and every relative <script src> and inline module import in its .html
// files, must name a file that exists in that dist folder. Lite drops Pro-only files
// and Demo drops Import/Export, so a shared file that still imports one of them is a
// 404 in that edition and its page never runs (review K13-7, K13-15).
//
// Dynamic import()s are left out on purpose: they're gated by an edition flag at the
// call site. Specifiers that aren't relative ('/x', 'https://…', bare names) are
// skipped; the app has none it relies on (no CDN).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, normalize, sep } from 'node:path';

const STATIC = /^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
const SCRIPT_SRC = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
const SCRIPT_BODY = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'vendor' || name === 'node_modules') continue;
      walkFiles(p, out);
    } else if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.html')) out.push(p);
  }
  return out;
}

// A module specifier is relative only with ./ or ../ (a bare name is a package).
function isRelative(spec) {
  return spec.startsWith('./') || spec.startsWith('../');
}

// An HTML src is relative unless it has a scheme or starts at the root.
function isRelativeUrl(src) {
  return src !== '' && !/^([a-z][a-z0-9+.-]*:|\/)/i.test(src);
}

// Returns a list of "from → missing" strings; empty when every import resolves.
export function findMissingImports(destDir) {
  const missing = [];
  for (const file of walkFiles(destDir)) {
    const text = readFileSync(file, 'utf8');
    const html = file.endsWith('.html');
    // An .html file's imports are in its inline <script> bodies.
    const code = html ? [...text.matchAll(SCRIPT_BODY)].map((m) => m[1]).join('\n') : text;
    const specs = [...code.matchAll(STATIC)].map((m) => [m[1] || m[2], isRelative]);
    if (html) specs.push(...[...text.matchAll(SCRIPT_SRC)].map((m) => [m[1], isRelativeUrl]));
    for (const [raw, relativeTest] of specs) {
      const spec = raw.split(/[?#]/)[0];
      if (!relativeTest(spec)) continue;
      const target = normalize(join(dirname(file), spec));
      if (!target.startsWith(destDir + sep) || !existsSync(target)) {
        missing.push(`${relative(destDir, file)} → ${raw}`);
      }
    }
  }
  return missing;
}

export function assertImportsResolve(destDir, label) {
  const missing = findMissingImports(destDir);
  if (missing.length) {
    throw new Error(`${label}: ${missing.length} import(s) name a file this build doesn't have:\n  ${missing.join('\n  ')}`);
  }
}
