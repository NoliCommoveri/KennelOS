// editionConfig.test.js — guards the SHARED editionConfig (the Pro/Demo default
// that ships in shared/). Its whole job is to be a no-op so no cap logic runs in
// Pro/Demo; a regression that made a default hook throw would brick those builds.
// (Lite's real cap lives in lite/editionConfig.js, which can't be imported here —
// its relative imports only resolve inside an assembled dist/ — so the Lite cap
// math is covered by rosterCount.test.js instead.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cfg from '../shared/data/editionConfig.js';

test('the default edition is pro (the shared copy)', () => {
  assert.equal(cfg.edition, 'pro');
});

test('all cap hooks exist and are no-ops (Pro/Demo are uncapped)', async () => {
  for (const name of ['enforceDogCap', 'enforceLitterCap', 'enforceImportDogCap', 'dogCapStatus']) {
    assert.equal(typeof cfg[name], 'function', `${name} must be exported`);
  }
  // None of these throw, whatever you pass — that's the whole contract.
  await cfg.enforceDogCap({ candidate: {}, existing: null });
  await cfg.enforceLitterCap({ candidate: {} });
  const big = Array.from({ length: 500 }, (_, i) => ({ id: `d${i}`, ownership_type: 'owned', status: 'active_breeding' }));
  await cfg.enforceImportDogCap({ incomingDogs: big, mode: 'replace' }); // 500 dogs, no throw
  assert.equal(await cfg.dogCapStatus(), null, 'uncapped → no counter shown');
});

test('the Pro-only feature flags are all ON in the shared default', () => {
  for (const [flag, on] of Object.entries(cfg.editionFlags)) {
    assert.equal(on, true, `shared editionFlags.${flag} should default true (Pro = full app)`);
  }
});

// --- Per-edition flag parity ------------------------------------------------
// The editions each ship their OWN full editionConfig.js, overlaid by the build.
// They can't be imported here (their relative imports only resolve inside an
// assembled dist/), so this reads the source text instead.
//
// The invariant: an edition may ADD a flag of its own (Pro's licenseGate, Demo's
// demoMode), but it must never silently OMIT one the shared default declares —
// an absent flag reads as `undefined`, i.e. off, so a feature added to shared/
// and forgotten in pro/ ships turned off in the paid edition with nothing to
// catch it. (Exactly how multiKennel first landed: on in shared, missing in
// pro/ and demo/, so Pro rendered no kennel picker at all.)
function declaredFlags(path) {
  const src = readFileSync(new URL(path, import.meta.url), 'utf8');
  const start = src.indexOf('export const editionFlags = {');
  assert.ok(start !== -1, `${path}: no editionFlags block`);
  const block = src.slice(start, src.indexOf('\n};', start));
  return new Set(
    block
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/))
      .filter(Boolean)
      .map((m) => m[1])
  );
}

test('every edition declares all the shared editionFlags', () => {
  const shared = declaredFlags('../shared/data/editionConfig.js');
  assert.ok(shared.size > 10, 'sanity: the shared flag block parsed');
  for (const edition of ['lite', 'pro', 'demo']) {
    const theirs = declaredFlags(`../${edition}/editionConfig.js`);
    const missing = [...shared].filter((f) => !theirs.has(f));
    assert.deepEqual(missing, [], `${edition}/editionConfig.js is missing flag(s): ${missing.join(', ')}`);
  }
});

// --- Cloud backup URL (Cloud Phase 1 plan §7) ---------------------------------
// Every edition must export both names (cloudConfig.js imports them, and a
// missing named export is a module-load error that would brick the edition).
// The shared core and Demo stay inert: cloudUrl null; Demo has no dev override
// either. Lite/Pro's cloudUrl is null until production (§9 step 6), then the
// production API — never anything else.
function exportedValue(path, name) {
  const src = readFileSync(new URL(path, import.meta.url), 'utf8');
  const m = src.match(new RegExp(`^export const ${name} = (null|'[^']*');`, 'm'));
  assert.ok(m, `${path}: no "export const ${name} = …" (null or a string literal)`);
  return m[1] === 'null' ? null : m[1].slice(1, -1);
}

test('every edition declares cloudUrl and devCloudUrl; shared and Demo stay inert', () => {
  const PROD = 'https://api.kennelos.app';
  assert.equal(cfg.cloudUrl, null, 'the shared core never points at a server');
  assert.equal(exportedValue('../demo/editionConfig.js', 'cloudUrl'), null);
  assert.equal(exportedValue('../demo/editionConfig.js', 'devCloudUrl'), null, 'Demo has no cloud, even in dev');
  for (const edition of ['lite', 'pro']) {
    const url = exportedValue(`../${edition}/editionConfig.js`, 'cloudUrl');
    assert.ok(url === null || url === PROD, `${edition}: cloudUrl must be null or ${PROD}`);
  }
  for (const path of ['../shared/data/editionConfig.js', '../lite/editionConfig.js', '../pro/editionConfig.js']) {
    const dev = exportedValue(path, 'devCloudUrl');
    assert.ok(dev === null || /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(dev), `${path}: devCloudUrl must be a workers.dev staging address`);
  }
});
