// vaultPasskey.test.js — Private Vault Plan §5.2: the WebAuthn/PRF wrapper on its
// own (the end-to-end passkey flows are in cloudVault.test.js).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePasskeys, uninstallFakePasskeys } from './support/fakePasskeys.js';
import {
  passkeyRpId, passkeySupported, createPasskey, getPrfOutput, toBase64Url, fromBase64Url, PasskeyError
} from '../shared/data/cloud/vaultPasskey.js';
import { newPrfSalt } from '../shared/data/cloud/vaultCrypto.js';

afterEach(() => uninstallFakePasskeys());

test('RP ID: kennelos.app on the product origins (Lite and Pro share passkeys), the host elsewhere', () => {
  assert.equal(passkeyRpId('lite.kennelos.app'), 'kennelos.app');
  assert.equal(passkeyRpId('pro.kennelos.app'), 'kennelos.app');
  assert.equal(passkeyRpId('kennelos.app'), 'kennelos.app');
  assert.equal(passkeyRpId('localhost'), 'localhost');
  assert.equal(passkeyRpId('notkennelos.app'), 'notkennelos.app');
});

test('base64url round-trips', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(37));
  assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
  assert.ok(!/[+/=]/.test(toBase64Url(new Uint8Array([251, 255, 254]))));
});

test('no WebAuthn: not supported, and making one says so', async () => {
  uninstallFakePasskeys();
  assert.equal(await passkeySupported(), false);
  await assert.rejects(createPasskey({ userId: 'p', userName: 'a@b', prfSalt: newPrfSalt() }), { name: 'PasskeyError', code: 'unsupported' });
});

test('a browser that says PRF is missing is not offered passkeys', async () => {
  installFakePasskeys();
  globalThis.PublicKeyCredential.getClientCapabilities = async () => ({ 'extension:prf': false });
  assert.equal(await passkeySupported(), false);
});

test('the PRF output is stable per passkey and salt, whether or not it came at creation', async () => {
  for (const prfAtCreate of [false, true]) {
    const pk = installFakePasskeys({ prfAtCreate });
    const prfSalt = newPrfSalt();
    const made = await createPasskey({ userId: 'program-1', userName: 'a@b.c', prfSalt, rpId: 'kennelos.app' });
    assert.equal(made.prfOutput.length, 32);
    assert.equal(pk.gets.length, prfAtCreate ? 0 : 1, 'one more touch only when creation gave no output');
    assert.equal(pk.creates[0].rp.id, 'kennelos.app');
    assert.equal(pk.creates[0].authenticatorSelection.userVerification, 'required');
    const again = await getPrfOutput([{ credentialId: made.credentialId, prfSalt }], { rpId: 'kennelos.app' });
    assert.equal(again.credentialId, made.credentialId);
    assert.deepEqual(again.prfOutput, made.prfOutput);
    const other = await getPrfOutput([{ credentialId: made.credentialId, prfSalt: newPrfSalt() }], { rpId: 'kennelos.app' });
    assert.notDeepEqual(other.prfOutput, made.prfOutput);
  }
});

test('a passkey without PRF is refused at creation; cancel and duplicates map to their codes', async () => {
  installFakePasskeys({ prf: false });
  await assert.rejects(createPasskey({ userId: 'p', prfSalt: newPrfSalt() }), (e) => e instanceof PasskeyError && e.code === 'unsupported');

  const pk = installFakePasskeys();
  const prfSalt = newPrfSalt();
  const made = await createPasskey({ userId: 'p', prfSalt });
  await assert.rejects(createPasskey({ userId: 'p', prfSalt, exclude: [made.credentialId] }), { code: 'exists' });
  pk.cancelNext = true;
  await assert.rejects(getPrfOutput([{ credentialId: made.credentialId, prfSalt }]), { code: 'cancelled' });
  await assert.rejects(getPrfOutput([{ credentialId: toBase64Url(new Uint8Array(16)), prfSalt }]), { code: 'cancelled' }, 'no matching passkey here');
  await assert.rejects(getPrfOutput([]), { code: 'cancelled' });
});
