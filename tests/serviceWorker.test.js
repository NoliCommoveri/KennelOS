// serviceWorker.test.js — pins the service-worker precache to what's on disk.
// CLAUDE.md calls the precache the single most-forgotten step: cache.addAll is
// atomic, so ONE precache entry with no file on disk breaks offline install for
// the whole app, and one shipped app file missing from the precache silently
// breaks offline for whatever imports it. This is the Python sanity snippet from
// the End-State guide, promoted to an automated regression test over shared/sw.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'shared');

function precacheEntries() {
  const sw = readFileSync(join(SHARED, 'sw.js'), 'utf8');
  const m = sw.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(m, 'PRECACHE_URLS array not found in shared/sw.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((e) => e !== './');
}

function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(relative(SHARED, p).split('\\').join('/'));
  }
  return out;
}

const entries = precacheEntries();
const onDisk = new Set(walk(SHARED));

test('every precache entry maps to a real file in shared/', () => {
  const missing = entries.filter((e) => !onDisk.has(e));
  assert.deepEqual(missing, [], `precache lists files that don't exist: ${missing.join(', ')}`);
});

test('every shipped .html/.js/.css in shared/ is in the precache', () => {
  // sw.js itself is registered directly, never precached; everything else the app
  // serves must be, or it won't be available offline.
  const shippable = [...onDisk].filter((f) => /\.(html|js|css)$/.test(f) && f !== 'sw.js');
  const notPrecached = shippable.filter((f) => !entries.includes(f));
  assert.deepEqual(notPrecached, [], `app files missing from precache: ${notPrecached.join(', ')}`);
});

test('the precache has no duplicate entries', () => {
  const dupes = entries.filter((e, i) => entries.indexOf(e) !== i);
  assert.deepEqual(dupes, [], `duplicate precache entries: ${dupes.join(', ')}`);
});

test('the new rosterCount module is precached (regression for this change)', () => {
  assert.ok(entries.includes('data/rosterCount.js'), 'data/rosterCount.js must be in the precache');
});
