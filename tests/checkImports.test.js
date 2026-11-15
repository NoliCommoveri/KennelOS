// checkImports.test.js — the build's import check (build/checkImports.mjs) finds a
// static import or <script src> that names a file the build doesn't have, and
// leaves dynamic import()s and non-relative specifiers alone (review K13-15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findMissingImports, assertImportsResolve } from '../build/checkImports.mjs';

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'kos-imports-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

test('a complete build passes', () => {
  const dir = fixture({
    'data/a.js': "export const a = 1;\n",
    'pages/p.js': "import {\n  a\n} from '../data/a.js';\nconst later = () => import('../data/gone.js');\n",
    'pages/p.html': '<script type="module" src="./p.js"></script><script src="https://example.com/x.js"></script>'
  });
  try {
    assert.deepEqual(findMissingImports(dir), []);
    assert.doesNotThrow(() => assertImportsResolve(dir, 'fixture'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a dropped file that is still imported is reported', () => {
  const dir = fixture({
    'pages/p.js': "import { a } from '../data/gone.js';\nexport * from './also-gone.js';\nimport './side.js';\n",
    'pages/side.js': '',
    'pages/q.html': '<script type="module">import { b } from "../data/b.js";</script><script type="module" src="q.js?v=2"></script>'
  });
  try {
    assert.deepEqual(findMissingImports(dir).sort(), [
      'pages/p.js → ../data/gone.js',
      'pages/p.js → ./also-gone.js',
      'pages/q.html → ../data/b.js',
      'pages/q.html → q.js?v=2'
    ]);
    assert.throws(() => assertImportsResolve(dir, 'fixture'), /4 import\(s\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
