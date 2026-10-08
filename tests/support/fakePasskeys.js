// fakePasskeys.js — a stand-in WebAuthn authenticator with the PRF extension,
// for the vault's passkey tests (Private Vault Plan §5.2). Installs
// globalThis.PublicKeyCredential and navigator.credentials. Each credential has
// a random secret; its PRF output for a salt is HMAC-SHA256(secret, salt), so it
// is stable per credential and salt, as a real authenticator's is.
//
//   const pk = installFakePasskeys({ prf: true, prfAtCreate: false });
//   pk.creates / pk.gets      the options each call was given
//   pk.cancelNext = true      the next call rejects with NotAllowedError
//   pk.store                  credential id (base64url) → { secret, rpId }
const b64url = (u8) => Buffer.from(u8).toString('base64url');

function domError(name) {
  const e = new Error(name);
  e.name = name;
  return e;
}

async function prf(secret, salt) {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, salt)).buffer;
}

export function installFakePasskeys({ prf: prfSupported = true, prfAtCreate = false } = {}) {
  const state = { creates: [], gets: [], store: new Map(), cancelNext: false, prfSupported, prfAtCreate };
  const credential = (id, results) => ({
    rawId: new Uint8Array(Buffer.from(id, 'base64url')).buffer,
    getClientExtensionResults: () => results
  });
  const takeCancel = () => { if (state.cancelNext) { state.cancelNext = false; throw domError('NotAllowedError'); } };

  const fake = {
    async create({ publicKey }) {
      state.creates.push(publicKey);
      takeCancel();
      for (const ex of publicKey.excludeCredentials || []) {
        if (state.store.has(b64url(ex.id))) throw domError('InvalidStateError');
      }
      const id = b64url(crypto.getRandomValues(new Uint8Array(16)));
      const secret = crypto.getRandomValues(new Uint8Array(32));
      state.store.set(id, { secret, rpId: publicKey.rp.id });
      if (!state.prfSupported) return credential(id, {});
      const first = publicKey.extensions?.prf?.eval?.first;
      return credential(id, state.prfAtCreate && first ? { prf: { enabled: true, results: { first: await prf(secret, first) } } } : { prf: { enabled: true } });
    },
    async get({ publicKey }) {
      state.gets.push(publicKey);
      takeCancel();
      const id = (publicKey.allowCredentials || []).map((c) => b64url(c.id))
        .find((cid) => state.store.get(cid)?.rpId === publicKey.rpId);
      if (!id) throw domError('NotAllowedError'); // "no passkey here", as browsers say it
      if (!state.prfSupported) return credential(id, {});
      const salt = publicKey.extensions?.prf?.evalByCredential?.[id]?.first;
      return credential(id, salt ? { prf: { results: { first: await prf(state.store.get(id).secret, salt) } } } : {});
    }
  };
  globalThis.PublicKeyCredential = class PublicKeyCredential {};
  Object.defineProperty(globalThis.navigator, 'credentials', { value: fake, configurable: true });
  return state;
}

export function uninstallFakePasskeys() {
  delete globalThis.PublicKeyCredential;
  Object.defineProperty(globalThis.navigator, 'credentials', { value: undefined, configurable: true });
}
