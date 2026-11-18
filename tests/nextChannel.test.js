// The next channel (build/nextChannel.mjs): a test build of Pro on its own origin that must
// never talk to production. Pro's config gains the staging servers and loses its license
// gate, and nothing else changes; the other editions have no next build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextEditionConfig, nextServiceWorker, NEXT_EDITIONS } from '../build/nextChannel.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const exportValue = (text, name) => text.match(new RegExp(`^export const ${name} = '([^']+)';`, 'm'))?.[1];

test('pro: the next config talks only to staging and has no license gate', () => {
  const before = read('pro/editionConfig.js');
  const after = nextEditionConfig(before, 'pro');
  assert.equal(exportValue(after, 'cloudUrl'), exportValue(before, 'devCloudUrl'));
  assert.equal(exportValue(after, 'kennelportUrl'), exportValue(before, 'devKennelportUrl'));
  assert.match(after, /^export const editionLabel = 'Next';/m);
  assert.match(after, /^\s*licenseGate:\s*false,/m);
  assert.doesNotMatch(after, /^\s*licenseGate:\s*true/m);
  assert.doesNotMatch(after, /https:\/\/api\.kennelos\.app'/);
  assert.doesNotMatch(after, /https:\/\/api\.kennelport\.com'/);
  // Only those four lines change: every feature flag, the nav lists and the cap hooks stay.
  const a = after.split('\n'), b = before.split('\n');
  assert.equal(a.length, b.length);
  const changed = b.filter((line, i) => line !== a[i]);
  assert.equal(changed.length, 4, changed.join('\n'));
  assert.ok(changed.every((l) => /^export const (cloudUrl|kennelportUrl|editionLabel) = |^\s*licenseGate:/.test(l)), changed.join('\n'));
});

test('a config that moved fails the build instead of shipping a next build on production', () => {
  const pro = read('pro/editionConfig.js');
  assert.throws(() => nextEditionConfig(pro.replace(/^export const devCloudUrl = .*$/m, ''), 'pro'), /devCloudUrl/);
  assert.throws(() => nextEditionConfig(pro.replace(/^(\s*)licenseGate:\s*true,/m, '$1licenseGate: !!1,'), 'pro'), /licenseGate/);
});

test('only Pro has a next build', () => {
  assert.deepEqual(NEXT_EDITIONS, ['pro']);
  for (const edition of ['lite', 'demo']) {
    assert.throws(() => nextEditionConfig(read(`${edition}/editionConfig.js`), edition), /no next channel/);
  }
});

test('the next service worker gets its own cache name, once', () => {
  const sw = "const CACHE_NAME = 'kennelos-pro-shell-v157';\nself.addEventListener('install', () => {});";
  const { text, cacheName } = nextServiceWorker(sw, 'pro');
  assert.equal(cacheName, 'kennelos-pro-shell-v157-next');
  assert.equal(nextServiceWorker(text, 'pro').cacheName, 'kennelos-pro-shell-v157-next');
  assert.throws(() => nextServiceWorker('no cache here', 'pro'), /CACHE_NAME/);
});

test('deploy-next.yml builds the next channel from the next branch, to next-pro', () => {
  const wf = read('.github/workflows/deploy-next.yml');
  assert.match(wf, /branches:\s*\[next\]/);
  assert.match(wf, /--channel next/);
  assert.match(wf, /domain:\s*next-pro\.kennelos\.app/);
  assert.match(wf, /publish_dir:\s*dist\/next-\$\{\{ matrix\.edition \}\}/);
  // The live deploy never builds a next channel.
  assert.doesNotMatch(read('.github/workflows/deploy.yml'), /--channel/);
});
