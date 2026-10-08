// waitlistCrypto.test.js — sealing an application in the applicant's browser
// (cloud/public/family/seal.js) and opening it on her device
// (shared/data/waitlistCrypto.js), W2 Plan §7. The two files are separate (the
// family pages can't import the app), so this proves they agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal } from '../cloud/public/family/seal.js';
import { generateFormKey, currentFormKey, rotateFormKeys, openSealed, SealError } from '../shared/data/waitlistCrypto.js';

const application = { answers: { name: 'Ann Lee', email: 'ann@example.com', about: 'We love Bostons 🐶' }, prefs: { pref_sex: 'female' } };

test('an application sealed in the browser opens on her device, and only there', async () => {
  const key = await generateFormKey();
  assert.match(key.id, /^fk_/);
  assert.equal(key.retired_at, null);
  const sealed = await seal(key.public_key, key.id, application);
  assert.equal(sealed.includes('Ann'), false);
  assert.equal(atob(sealed).includes('Bostons'), false, 'nothing readable in the sealed text');
  assert.deepEqual(await openSealed([key], sealed), application);

  const other = await generateFormKey();
  await assert.rejects(openSealed([other], sealed), SealError, 'a different key can\'t open it');
  const twice = await seal(key.public_key, key.id, application);
  assert.notEqual(twice, sealed, 'a fresh key pair each time');
});

test('tampering, a wrong key id or junk is refused', async () => {
  const key = await generateFormKey();
  const sealed = await seal(key.public_key, key.id, application);
  const env = JSON.parse(atob(sealed));
  const flipped = { ...env, ct: btoa(String.fromCharCode(...Uint8Array.from(atob(env.ct), (c, i) => (i === 3 ? c.charCodeAt(0) ^ 1 : c.charCodeAt(0))))) };
  await assert.rejects(openSealed([key], btoa(JSON.stringify(flipped))), SealError);
  await assert.rejects(openSealed([{ ...key, id: 'fk_other' }], btoa(JSON.stringify({ ...env, kid: 'fk_other' }))), SealError,
    'the key id is bound in: relabelling fails');
  await assert.rejects(openSealed([key], 'not sealed'), SealError);
  await assert.rejects(openSealed([key], btoa(JSON.stringify({ ...env, v: 9 }))), SealError);
});

test('rotating keeps old keys so earlier applications still open; new ones use the new key', async () => {
  const first = await generateFormKey({ now: new Date('2026-10-01T00:00:00Z') });
  const before = await seal(first.public_key, first.id, application);
  const keys = await rotateFormKeys([first], { now: new Date('2026-10-08T00:00:00Z') });
  assert.equal(keys.length, 2);
  assert.equal(keys[0].retired_at, '2026-10-08T00:00:00.000Z');
  const current = currentFormKey(keys);
  assert.notEqual(current.id, first.id);
  assert.deepEqual(await openSealed(keys, before), application);
  assert.deepEqual(await openSealed(keys, await seal(current.public_key, current.id, application)), application);
  assert.equal(currentFormKey([]), null);
  assert.equal(currentFormKey([{ ...first, retired_at: 'x' }]), null);
});

test('a long application (well past argument limits) seals and opens', async () => {
  const key = await generateFormKey();
  const big = { answers: { about: 'x'.repeat(200000) } };
  assert.deepEqual(await openSealed([key], await seal(key.public_key, key.id, big)), big);
});
