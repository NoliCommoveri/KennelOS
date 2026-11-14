// liteImportGraph.test.js — every page Lite keeps (and app.js) reaches no Pro-only
// file through its static imports. The Lite build drops those files
// (proPages.js), so such an import is a 404 there and the page never runs: the
// Live-Birth Summary did this (review K13-7). Dynamic import()s are left out on
// purpose: they're gated by an edition flag at the call site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRO_ONLY_PAGES, PRO_ONLY_STANDALONE } from '../shared/data/proPages.js';

const shared = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared');
const pro = new Set(PRO_ONLY_STANDALONE.map((f) => normalize(f)));
for (const p of PRO_ONLY_PAGES) { pro.add(join('pages', p)); pro.add(join('pages', p.replace(/\.html$/, '.js'))); }
const STATIC = /^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;

function proReached(start) {
  const bad = [];
  const seen = new Set();
  const walk = (file, chain) => {
    if (seen.has(file)) return;
    seen.add(file);
    const rel = relative(shared, file);
    if (pro.has(rel)) { bad.push([...chain, rel].join(' → ')); return; }
    if (!existsSync(file)) return;
    for (const m of readFileSync(file, 'utf8').matchAll(STATIC)) {
      const spec = m[1] || m[2];
      if (spec.startsWith('.')) walk(normalize(join(dirname(file), spec)), [...chain, rel]);
    }
  };
  walk(start, []);
  return bad;
}

test('no page Lite keeps imports a Pro-only file', () => {
  const pages = readdirSync(join(shared, 'pages')).filter((f) => f.endsWith('.js') && !pro.has(join('pages', f)));
  assert.ok(pages.includes('live-births.js'));
  const bad = [...pages.map((f) => join(shared, 'pages', f)), join(shared, 'app.js')].flatMap(proReached);
  assert.deepEqual(bad, []);
});
