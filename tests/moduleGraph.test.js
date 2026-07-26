// moduleGraph.test.js — every assembled edition must be link-clean.
//
// The failure this exists to prevent: an ES module whose import can't be
// resolved doesn't fail alone, it takes down the entire graph that reaches it.
// The page's HTML still renders, so it looks fine — but nothing its script was
// going to fill gets filled and nothing it was going to wire gets wired. Pro
// shipped exactly this once: pro/editionConfig.js was missing the
// `enforceImportDogCap` that shared/data/importExport.js imports, so the Import /
// Export page sat on "Checking…" with Reset and Set-up-your-kennel inert, and
// the offline service worker cached that brick into installed clients until the
// next CACHE_NAME rollover.
//
// It survived review because every file was individually fine — the break lives
// in the seam between a shared importer and a per-edition overlay, and that seam
// only exists in an assembled dist/<edition>/. So this test assembles, then
// link-checks the artifact, which is the only place the whole truth is visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyModuleGraph } from '../build/verifyModuleGraph.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDITIONS = ['lite', 'pro', 'demo'];

test('all editions assemble (the build link-checks each one and throws on a break)', () => {
  // assemble.mjs itself calls verifyModuleGraph and refuses to emit a broken
  // edition, so a clean exit here is the same guarantee CI's deploy step gets.
  execFileSync('node', [join(ROOT, 'build', 'assemble.mjs')], { cwd: ROOT, stdio: 'pipe' });
});

for (const edition of EDITIONS) {
  test(`dist/${edition}: every import resolves to a file that exports it`, () => {
    const { problems, moduleCount } = verifyModuleGraph(join(ROOT, 'dist', edition));
    assert.ok(moduleCount > 50, `sanity: expected to walk a real graph, got ${moduleCount} modules`);
    assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
  });
}

// --- the checker's own regression tests -------------------------------------
// A link-checker that silently passes everything is worse than none at all: it
// converts "nobody is looking" into "something is looking, and it's happy". So
// prove it still reports each break it's meant to catch.

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'kennelos-graph-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}

const PAGE = '<script type="module" src="./page.js"></script>';

test('a named import the target does not export is reported', () => {
  const dir = fixture({
    'index.html': PAGE,
    'page.js': "import { present, absent } from './config.js';\nexport const x = [present, absent];\n",
    'config.js': 'export const present = 1;\n'
  });
  try {
    const { problems } = verifyModuleGraph(dir);
    assert.equal(problems.length, 1, `expected exactly one problem, got: ${problems.join(' | ')}`);
    assert.match(problems[0], /does not export "absent"/);
    assert.doesNotMatch(problems.join(), /present/, 'a name that IS exported must not be flagged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an import of a file the edition excluded is reported', () => {
  // The Lite shape: a page survives the exclude step but still imports a module
  // that didn't. Nothing on disk contradicts itself until you follow the edge.
  const dir = fixture({
    'index.html': PAGE,
    'page.js': "import { gone } from './pro-only.js';\nexport const x = gone;\n"
  });
  try {
    const { problems } = verifyModuleGraph(dir);
    assert.equal(problems.length, 1, `expected exactly one problem, got: ${problems.join(' | ')}`);
    assert.match(problems[0], /does not exist in this build/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('names re-exported through `export *` and `export { x } from` count as present', () => {
  // editionTour.js is built entirely out of re-exports, so treating a re-exported
  // name as missing would make this checker cry wolf on a correct build.
  const dir = fixture({
    'index.html': PAGE,
    'page.js': "import { viaStar, viaNamed } from './barrel.js';\nexport const x = [viaStar, viaNamed];\n",
    'barrel.js': "export * from './a.js';\nexport { viaNamed } from './b.js';\n",
    'a.js': 'export function viaStar() {}\n',
    'b.js': 'export const viaNamed = 2;\n'
  });
  try {
    assert.deepEqual(verifyModuleGraph(dir).problems, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a bare specifier is reported (no bundler or import map at runtime)', () => {
  const dir = fixture({
    'index.html': PAGE,
    'page.js': "import Dexie from 'dexie';\nexport const x = Dexie;\n"
  });
  try {
    const { problems } = verifyModuleGraph(dir);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /bare specifier/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('vendored bundles are existence-checked but never parsed for exports', () => {
  // Minified third-party code doesn't match the repo's line-anchored export
  // style, so parsing it would produce phantom failures on every build.
  // Laid out like the real artifact: the importer sits under pages/, so the
  // '../vendor/…' specifier resolves inside the edition root rather than above it.
  const dir = fixture({
    'pages/dog.html': '<script type="module" src="./dog.js"></script>',
    'pages/dog.js': "import Dexie from '../vendor/lib.min.mjs';\nexport const x = Dexie;\n",
    'vendor/lib.min.mjs': 'var a=1;export{a as default};\n'
  });
  try {
    assert.deepEqual(verifyModuleGraph(dir).problems, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
