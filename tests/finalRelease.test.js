// The end-of-life build (build/finalRelease.mjs, terms §14 "If KennelOS ends"): each
// edition's config loses every server URL and Pro loses its license gate, and nothing else
// changes. A config that moved must fail the build rather than ship a final Pro that walls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { finalizeEditionConfig, finalizeServiceWorker, FINAL_NULLED_EXPORTS } from '../build/finalRelease.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

for (const edition of ['lite', 'pro', 'demo']) {
  test(`${edition}: the final config calls no server and has no license gate`, () => {
    const before = read(`${edition}/editionConfig.js`);
    const after = finalizeEditionConfig(before, edition);
    for (const name of FINAL_NULLED_EXPORTS) {
      assert.match(after, new RegExp(`^export const ${name} = null;`, 'm'), name);
    }
    assert.doesNotMatch(after, /^\s*licenseGate:\s*true/m);
    assert.doesNotMatch(after, /https:\/\/[^'"\s]*(kennelos|kennelport|workers\.dev)[^'"\s]*['"];/);
    // Only those lines change: every Pro feature flag, the nav and the cap hooks stay.
    const changed = before.split('\n').filter((line, i) => line !== after.split('\n')[i]);
    assert.ok(changed.every((l) => /^export const \w+ = |^\s*licenseGate:/.test(l)), changed.join('\n'));
    assert.equal(after.split('\n').length, before.split('\n').length);
  });
}

test('pro: the final config switches the license gate off', () => {
  const after = finalizeEditionConfig(read('pro/editionConfig.js'), 'pro');
  assert.match(after, /^\s*licenseGate: false,/m);
});

test('a config the final build cannot read fails the build', () => {
  const pro = read('pro/editionConfig.js');
  assert.throws(() => finalizeEditionConfig(pro.replace(/licenseGate:\s*true/, 'licenseGate: 1'), 'pro'), /licenseGate/);
  assert.throws(() => finalizeEditionConfig(pro.replace(/^export const cloudUrl = .*$/m, ''), 'pro'), /cloudUrl/);
  assert.throws(() => finalizeEditionConfig(pro, 'lite'), /license gate is still on/);
});

test('the final service worker takes a new cache name, once', () => {
  const sw = read('shared/sw.js');
  const { text, cacheName } = finalizeServiceWorker(sw, 'pro');
  assert.match(cacheName, /^kennelos-shell-v\d+-final$/);
  assert.equal(finalizeServiceWorker(text, 'pro').cacheName, cacheName);
});
