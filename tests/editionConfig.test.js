// editionConfig.test.js — guards the SHARED editionConfig (the Pro/Demo default
// that ships in shared/). Its whole job is to be a no-op so no cap logic runs in
// Pro/Demo; a regression that made a default hook throw would brick those builds.
// (Lite's real cap lives in lite/editionConfig.js, which can't be imported here —
// its relative imports only resolve inside an assembled dist/ — so the Lite cap
// math is covered by rosterCount.test.js instead.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
