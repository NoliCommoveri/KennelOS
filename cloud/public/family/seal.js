// Sealing an application (or, later, a family message) to the breeder's form key
// in the applicant's own browser, before anything is sent (Waitlist Spec §8.2;
// W2 Plan §7). The server stores the sealed text and can't read it; only her
// devices hold the private key.
//
// ECDH P-256 with a fresh key pair per message, HKDF-SHA-256 (salt = the fresh
// public key, info names the purpose), AES-GCM-256 with the key id as additional
// data. WebCrypto only.
//
// Kept in step with shared/data/waitlistCrypto.js, which opens what this seals
// (tests/waitlistCrypto.test.js seals with this file and opens with that one).
export const SEAL_FORMAT = 1;
const INFO = 'kennelos-waitlist/seal/v1';
const enc = new TextEncoder();

// In chunks: spreading a long application into one call would exceed argument limits.
function toB64(bytes) {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const aad = (keyId) => enc.encode(`kennelos-waitlist/v1/${keyId}`);

// `publicKey` is her form key (base64 raw P-256 point), `keyId` its id. → the
// sealed text to send.
export async function seal(publicKey, keyId, value) {
  const subtle = crypto.subtle;
  const theirs = await subtle.importKey('raw', fromB64(publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const mine = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const epk = new Uint8Array(await subtle.exportKey('raw', mine.publicKey));
  const shared = await subtle.deriveBits({ name: 'ECDH', public: theirs }, mine.privateKey, 256);
  const hkdf = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: epk, info: enc.encode(INFO) }, hkdf,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(keyId) }, key, enc.encode(JSON.stringify(value)));
  return btoa(JSON.stringify({ v: SEAL_FORMAT, kid: keyId, epk: toB64(epk), iv: toB64(iv), ct: toB64(ct) }));
}
