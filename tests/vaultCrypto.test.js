// vaultCrypto.test.js — the private vault's cryptography (shared/data/cloud/
// vaultCrypto.js; Private Vault Plan §3.2, §4, §5). Pins:
//   - codes: length, alphabet, forgiving typing (case, dashes, O/I/L);
//   - every unlock path round-trips (recovery code, PRF output, device pairing
//     from both sides), and the wrong secret, kind or keyId fails to open;
//   - payloads round-trip with a fresh IV each time; tampering and a stale keyId
//     fail;
//   - private files encrypt deterministically per key (so /files dedups), differ
//     across keys, and check their plaintext hash on the way back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../shared/data/cloud/vaultCrypto.js';

const bytes = (s) => new TextEncoder().encode(s);
const text = (b) => new TextDecoder().decode(b);
const rawOf = async (key) => Buffer.from(await crypto.subtle.exportKey('raw', key)).toString('hex');

test('codes: length, alphabet and forgiving typing', () => {
  const r = v.newRecoveryCode();
  const p = v.newPairingCode();
  assert.equal(r.length, v.RECOVERY_CODE_LENGTH);
  assert.equal(p.length, v.PAIRING_CODE_LENGTH);
  assert.match(r, /^[0-9A-HJKMNP-TV-Z]+$/);
  assert.notEqual(v.newRecoveryCode(), r);
  assert.equal(v.formatCode('ABCDEFGHJKMN'), 'ABCD-EFGH-JKMN');

  assert.equal(v.normalizeRecoveryCode(v.formatCode(r).toLowerCase()), r);
  assert.equal(v.normalizePairingCode(' 0o1i-l2ab cdef '), '001112ABCDEF');
  assert.equal(v.normalizePairingCode('0O1IL2ABCDEF'), '001112ABCDEF');
  assert.equal(v.normalizePairingCode('ABC'), null);
  assert.equal(v.normalizePairingCode('ABCDEFGHJKMU'), null, 'U is not in the alphabet');
  assert.equal(v.normalizeRecoveryCode(null), null);
});

test('recovery code: wrap and unwrap the vault key', async () => {
  const { key, keyId } = await v.generateVaultKey();
  assert.match(keyId, /^[0-9a-f]{32}$/);
  const code = v.newRecoveryCode();
  const wrapped = await v.wrapVaultKey(key, await v.kekFromRecoveryCode(code), { keyId, kind: 'recovery' });

  // Typed differently, same code.
  const back = await v.unwrapVaultKey(wrapped, await v.kekFromRecoveryCode(v.formatCode(code).toLowerCase()), { keyId, kind: 'recovery' });
  assert.equal(await rawOf(back), await rawOf(key));

  await assert.rejects(v.unwrapVaultKey(wrapped, await v.kekFromRecoveryCode(v.newRecoveryCode()), { keyId, kind: 'recovery' }), v.VaultLockedError);
  await assert.rejects(v.kekFromRecoveryCode('too-short'), v.VaultLockedError);
});

test('a wrap is bound to its kind and keyId', async () => {
  const { key, keyId } = await v.generateVaultKey();
  const kek = await v.kekFromRecoveryCode(v.newRecoveryCode());
  const wrapped = await v.wrapVaultKey(key, kek, { keyId, kind: 'recovery' });
  await assert.rejects(v.unwrapVaultKey(wrapped, kek, { keyId, kind: 'passkey' }), v.VaultLockedError);
  const other = (await v.generateVaultKey()).keyId;
  await assert.rejects(v.unwrapVaultKey(wrapped, kek, { keyId: other, kind: 'recovery' }), v.VaultLockedError);
  await assert.rejects(v.unwrapVaultKey('not base64!', kek, { keyId, kind: 'recovery' }), v.VaultLockedError);
  await assert.rejects(v.unwrapVaultKey(v.toBase64(new Uint8Array(5)), kek, { keyId, kind: 'recovery' }), v.VaultLockedError);
});

test('passkey PRF output: wrap and unwrap; a different output fails', async () => {
  const { key, keyId } = await v.generateVaultKey();
  const prf = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await v.wrapVaultKey(key, await v.kekFromPrf(prf.buffer), { keyId, kind: 'passkey' });
  const back = await v.unwrapVaultKey(wrapped, await v.kekFromPrf(prf), { keyId, kind: 'passkey' });
  assert.equal(await rawOf(back), await rawOf(key));
  await assert.rejects(
    v.unwrapVaultKey(wrapped, await v.kekFromPrf(crypto.getRandomValues(new Uint8Array(32))), { keyId, kind: 'passkey' }),
    v.VaultLockedError
  );
  await assert.rejects(v.kekFromPrf(new Uint8Array(8)), v.VaultLockedError);
  assert.equal(v.fromBase64(v.newPrfSalt()).length, 32);
});

test('device pairing: both sides derive the same KEK; a wrong code or swapped key fails', async () => {
  const { key, keyId } = await v.generateVaultKey();
  const code = v.newPairingCode();

  // New device posts its public key; the approver answers with an ephemeral one.
  const newDevice = await v.generatePairingKeyPair();
  const approver = await v.generatePairingKeyPair();
  const newPub = await v.exportPublicKey(newDevice.publicKey);
  const approverPub = await v.exportPublicKey(approver.publicKey);

  const wrapped = await v.wrapVaultKey(key, await v.kekFromPairing(approver.privateKey, newPub, code), { keyId, kind: 'device' });
  const back = await v.unwrapVaultKey(wrapped, await v.kekFromPairing(newDevice.privateKey, approverPub, v.formatCode(code)), { keyId, kind: 'device' });
  assert.equal(await rawOf(back), await rawOf(key));

  // Wrong code typed on the approver.
  const wrongCode = await v.wrapVaultKey(key, await v.kekFromPairing(approver.privateKey, newPub, v.newPairingCode()), { keyId, kind: 'device' });
  await assert.rejects(v.unwrapVaultKey(wrongCode, await v.kekFromPairing(newDevice.privateKey, approverPub, code), { keyId, kind: 'device' }), v.VaultLockedError);

  // A relay that swaps in its own key: without the code it can't derive the KEK
  // the approver used (it would need the code as the HKDF salt).
  const relay = await v.generatePairingKeyPair();
  const swapped = await v.wrapVaultKey(key, await v.kekFromPairing(approver.privateKey, await v.exportPublicKey(relay.publicKey), code), { keyId, kind: 'device' });
  await assert.rejects(
    v.unwrapVaultKey(swapped, await v.kekFromPairing(relay.privateKey, approverPub, v.newPairingCode()), { keyId, kind: 'device' }),
    v.VaultLockedError
  );

  await assert.rejects(v.kekFromPairing(newDevice.privateKey, 'AAAA', code), v.VaultLockedError);
  await assert.rejects(v.kekFromPairing(newDevice.privateKey, approverPub, 'short'), v.VaultLockedError);
});

test('handoff code: wrap and unwrap; the proof is stable, separate from the KEK, and code-specific', async () => {
  const { key, keyId } = await v.generateVaultKey();
  const code = v.newHandoffCode();
  assert.equal(code.length, v.RECOVERY_CODE_LENGTH);
  const wrapped = await v.wrapVaultKey(key, await v.kekFromHandoffCode(code), { keyId, kind: 'handoff' });
  const typed = v.formatCode(code).toLowerCase(); // pasted with dashes, any case
  const back = await v.unwrapVaultKey(wrapped, await v.kekFromHandoffCode(typed), { keyId, kind: 'handoff' });
  assert.deepEqual(new Uint8Array(await crypto.subtle.exportKey('raw', back)), new Uint8Array(await crypto.subtle.exportKey('raw', key)));

  const proof = await v.handoffProof(code);
  assert.match(proof, /^[0-9a-f]{64}$/);
  assert.equal(await v.handoffProof(typed), proof);
  assert.notEqual(await v.handoffProof(v.newHandoffCode()), proof);
  // Not interchangeable with a recovery wrap of the same code.
  await assert.rejects(v.unwrapVaultKey(wrapped, await v.kekFromRecoveryCode(code), { keyId, kind: 'handoff' }), v.VaultLockedError);
  await assert.rejects(v.unwrapVaultKey(wrapped, await v.kekFromHandoffCode(code), { keyId, kind: 'recovery' }), v.VaultLockedError);
  await assert.rejects(v.kekFromHandoffCode('short'), v.VaultLockedError);
});

test('payload: round-trips, fresh IV each time, header readable', async () => {
  const { key, keyId } = await v.generateVaultKey();
  const plain = bytes(JSON.stringify({ contacts: [{ id: 'c1', phone: '555-0100' }] }));
  const a = await v.encryptPayload(key, keyId, plain);
  const b = await v.encryptPayload(key, keyId, plain);
  assert.notDeepEqual(a, b, 'random IV');
  assert.equal(text(await v.decryptPayload(key, keyId, a)), text(plain));
  assert.deepEqual(v.readVaultHeader(a), { version: v.VAULT_FORMAT, keyId });
  assert.equal(v.readVaultHeader(plain), null);
  assert.ok(!Buffer.from(a).includes(Buffer.from('555-0100')), 'no plaintext in the ciphertext');
});

test('payload: tampering, a stale keyId or the wrong key fail', async () => {
  const { key, keyId } = await v.generateVaultKey();
  const sealed = await v.encryptPayload(key, keyId, bytes('secret'));

  const flipped = sealed.slice();
  flipped[flipped.length - 1] ^= 1;
  await assert.rejects(v.decryptPayload(key, keyId, flipped), v.VaultLockedError);

  const headerFlip = sealed.slice();
  headerFlip[4] = 9; // version
  await assert.rejects(v.decryptPayload(key, keyId, headerFlip), v.VaultLockedError);

  const other = await v.generateVaultKey();
  await assert.rejects(v.decryptPayload(key, other.keyId, sealed), v.VaultLockedError);
  await assert.rejects(v.decryptPayload(other.key, keyId, sealed), v.VaultLockedError);
});

test('files: deterministic per key, different across keys, hash-checked', async () => {
  const { key, keyId } = await v.generateVaultKey();
  const pdf = bytes('%PDF-1.4 a signed contract');
  const a = await v.encryptFile(key, keyId, pdf);
  const b = await v.encryptFile(key, keyId, pdf);
  assert.deepEqual(a.bytes, b.bytes);
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.sha256, await v.sha256Hex(a.bytes));
  assert.equal(a.plainSha256, await v.sha256Hex(pdf));
  assert.notEqual(a.sha256, a.plainSha256, 'the /files id is the ciphertext hash, not the plaintext one');

  const otherFile = await v.encryptFile(key, keyId, bytes('%PDF-1.4 a receipt'));
  assert.notDeepEqual(otherFile.bytes.subarray(21, 33), a.bytes.subarray(21, 33), 'different files, different IVs');

  const otherKey = await v.generateVaultKey();
  const c = await v.encryptFile(otherKey.key, otherKey.keyId, pdf);
  assert.notEqual(c.sha256, a.sha256);

  assert.equal(text(await v.decryptFile(key, keyId, a.bytes, { plainSha256: a.plainSha256 })), text(pdf));
  await assert.rejects(v.decryptFile(key, keyId, a.bytes, { plainSha256: otherFile.plainSha256 }), v.VaultLockedError);
  await assert.rejects(v.decryptFile(otherKey.key, keyId, a.bytes), v.VaultLockedError);
  // A file can't be opened as a payload (different subkey).
  await assert.rejects(v.decryptPayload(key, keyId, a.bytes), v.VaultLockedError);
});

test('base64 round-trips large buffers', () => {
  const big = new Uint8Array(100000).map((_, i) => (i * 7919) & 255); // past the 0x8000 chunk
  assert.deepEqual(v.fromBase64(v.toBase64(big)), big);
});

test('accountCheck: fixed for one key and keyId, different for another key or keyId (Phase 1 plan §2.7)', async () => {
  const c = await import('../shared/data/cloud/vaultCrypto.js');
  const a = await c.generateVaultKey();
  const b = await c.generateVaultKey();
  const one = await c.accountCheck(a.key, a.keyId);
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.equal(await c.accountCheck(a.key, a.keyId), one);
  assert.notEqual(await c.accountCheck(b.key, a.keyId), one);
  assert.notEqual(await c.accountCheck(a.key, b.keyId), one);
});
