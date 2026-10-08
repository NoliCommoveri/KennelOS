// A family's signed-in browser (See Your Details): the session the server gave
// when they typed their code, and their status link, kept in this browser per
// kennel until the session's end (90 days). Nothing else is stored.
const key = (publicId) => `kennelos.family.${publicId}`;

export function rememberFamily(publicId, { session, statusToken, expiresAt }) {
  try { localStorage.setItem(key(publicId), JSON.stringify({ session, statusToken, expiresAt })); } catch { /* private mode: not remembered */ }
}

export function rememberedFamily(publicId, now = Date.now()) {
  try {
    const saved = JSON.parse(localStorage.getItem(key(publicId)) || 'null');
    if (!saved || !saved.session || !(Date.parse(saved.expiresAt) > now)) return null;
    return saved;
  } catch { return null; }
}

export function forgetFamily(publicId) {
  try { localStorage.removeItem(key(publicId)); } catch { /* nothing to forget */ }
}
