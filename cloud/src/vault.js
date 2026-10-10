// The private vault's routes (docs/KennelOS_Private_Vault_Plan.md §5, §6.1).
//
// The server holds wraps, PRF salts, credential ids and ECDH public keys. It
// never sees a vault key, a recovery code, a PRF output or a pairing code, so
// nothing here can open anything: it stores and hands back opaque strings, and
// enforces who may read or change them.
//
//   GET    /vault                         state + wrap metadata (no wrapped bytes)
//   POST   /vault                         turn on {keyId, recoveryWrap}
//   DELETE /vault                         turn off (fresh sign-in): wraps + pairings go
//   GET    /vault/wraps/:id               one wrap, with its bytes (rate-limited)
//   POST   /vault/wraps                   add a passkey wrap
//   PUT    /vault/wraps/recovery          replace the recovery wrap (fresh sign-in)
//   DELETE /vault/wraps/:id               remove a passkey (fresh sign-in)
//   POST   /vault/pairings                a new device asks {publicKey}
//   GET    /vault/pairings                open requests, for an unlocked device to approve
//   POST   /vault/pairings/:id/approve    {approverKey, wrapped, keyId}
//   GET    /vault/pairings/:id            the asking device polls; an approved read deletes it
//   POST   /vault/handoffs                an unlocked device makes a one-hour code {keyId, wrapped, proof}
//   POST   /vault/handoffs/redeem         another device shows the code's proof; the wrap, once
//
// Nothing here logs a wrap, a key or a request body (cloud/README.md).
import { fail } from './lib/http.js';
import { requireFreshSignIn } from './auth.js';
import { limitBucket, VAULT_LIMITS } from './ratelimit.js';

export const KEY_ID = /^[0-9a-f]{32}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
// A wrap is base64(12-byte IV + 32-byte key + 16-byte tag) = 80 characters;
// leave room for a future format without accepting anything large.
const MAX_WRAP = 256;
const MAX_CREDENTIAL_ID = 1400;
// An uncompressed P-256 public key is 65 bytes = 88 base64 characters.
const P256_PUBLIC = /^[A-Za-z0-9+/]{86}[AEIMQUYcgkosw048]=$/;
export const MAX_PASSKEYS = 10;
export const PAIRING_MS = 10 * 60 * 1000;
const MAX_OPEN_PAIRINGS = 5;
export const HANDOFF_MS = 60 * 60 * 1000;
const MAX_OPEN_HANDOFFS = 5;
const PROOF = /^[0-9a-f]{64}$/;

const nowIso = () => new Date().toISOString();

function wrapString(value, field = 'wrapped') {
  if (typeof value !== 'string' || value.length > MAX_WRAP || !B64.test(value)) fail(400, `bad_${field}`);
  return value;
}

function keyIdOf(value) {
  if (typeof value !== 'string' || !KEY_ID.test(value)) fail(400, 'bad_key_id');
  return value;
}

const label = (raw) => String(raw ?? '').trim().slice(0, 60) || null;

export async function loadVault(env, programId) {
  return env.DB.prepare('SELECT key_id, created_at FROM vaults WHERE program_id = ?').bind(programId).first();
}

async function requireVault(env, auth) {
  const vault = await loadVault(env, auth.programId);
  if (!vault) fail(404, 'no_vault');
  return vault;
}

function checkKeyMatches(vault, keyId) {
  if (keyIdOf(keyId) !== vault.key_id) fail(409, 'vault_key_stale', { keyId: vault.key_id });
}

// --- The vault itself ----------------------------------------------------------
export async function getVault(env, auth) {
  const vault = await loadVault(env, auth.programId);
  if (!vault) return { enabled: false };
  const { results } = await env.DB.prepare(
    `SELECT id, kind, label, credential_id, prf_salt, created_at FROM vault_wraps
      WHERE program_id = ? ORDER BY kind DESC, created_at`,
  ).bind(auth.programId).all();
  return {
    enabled: true,
    keyId: vault.key_id,
    createdAt: vault.created_at,
    wraps: results.map((w) => ({
      id: w.id, kind: w.kind, label: w.label, createdAt: w.created_at,
      ...(w.kind === 'passkey' ? { credentialId: w.credential_id, prfSalt: w.prf_salt } : {}),
    })),
  };
}

// POST /vault {keyId, recoveryWrap}. The recovery wrap is required: the plan
// makes saving the code a condition of turning the vault on (§2.1).
export async function enableVault(env, auth, body) {
  const keyId = keyIdOf(body.keyId);
  const wrapped = wrapString(body.recoveryWrap, 'recovery_wrap');
  if (await loadVault(env, auth.programId)) fail(409, 'vault_exists');
  const at = nowIso();
  const wrapId = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO vaults (program_id, key_id, created_at) VALUES (?, ?, ?)').bind(auth.programId, keyId, at),
      env.DB.prepare(
        `INSERT INTO vault_wraps (id, program_id, kind, key_id, wrapped, created_at) VALUES (?, ?, 'recovery', ?, ?, ?)`,
      ).bind(wrapId, auth.programId, keyId, wrapped, at),
    ]);
  } catch (err) {
    // Two devices turning it on at once: the primary key lets one win.
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(err?.message ?? err))) fail(409, 'vault_exists');
    throw err;
  }
  return getVault(env, auth);
}

// DELETE /vault {email?, code?}: nobody can unlock it again. The encrypted
// snapshot parts age out on retention (§10 decision 7); they can't be opened.
export async function disableVault(env, auth, body) {
  await requireFreshSignIn(env, auth, body);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM vault_wraps WHERE program_id = ?').bind(auth.programId),
    env.DB.prepare('DELETE FROM vault_pairings WHERE program_id = ?').bind(auth.programId),
    env.DB.prepare('DELETE FROM vault_handoffs WHERE program_id = ?').bind(auth.programId),
    env.DB.prepare('DELETE FROM vaults WHERE program_id = ?').bind(auth.programId),
  ]);
  return { ok: true };
}

// --- Wraps ---------------------------------------------------------------------------
// GET /vault/wraps/:id. The only route that hands out wrapped bytes, so it is
// the one rate-limited.
export async function getWrap(env, auth, id) {
  await requireVault(env, auth);
  await limitBucket(env, `vault-wrap:${auth.programId}`, VAULT_LIMITS.wrapReads);
  const w = await env.DB.prepare(
    'SELECT id, kind, key_id, wrapped, credential_id, prf_salt FROM vault_wraps WHERE id = ? AND program_id = ?',
  ).bind(id, auth.programId).first();
  if (!w) fail(404, 'not_found');
  return {
    id: w.id, kind: w.kind, keyId: w.key_id, wrapped: w.wrapped,
    ...(w.kind === 'passkey' ? { credentialId: w.credential_id, prfSalt: w.prf_salt } : {}),
  };
}

// POST /vault/wraps {kind: 'passkey', keyId, wrapped, credentialId, prfSalt, label?}
export async function addWrap(env, auth, body) {
  const vault = await requireVault(env, auth);
  if (body.kind !== 'passkey') fail(400, 'bad_kind');
  checkKeyMatches(vault, body.keyId);
  const wrapped = wrapString(body.wrapped);
  const credentialId = String(body.credentialId ?? '');
  if (!credentialId || credentialId.length > MAX_CREDENTIAL_ID || !B64URL.test(credentialId)) fail(400, 'bad_credential_id');
  const prfSalt = wrapString(body.prfSalt, 'prf_salt');
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM vault_wraps WHERE program_id = ? AND kind = 'passkey'`)
    .bind(auth.programId).first('n');
  if (count >= MAX_PASSKEYS) fail(400, 'too_many_passkeys');
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO vault_wraps (id, program_id, kind, label, key_id, credential_id, prf_salt, wrapped, created_at)
     VALUES (?, ?, 'passkey', ?, ?, ?, ?, ?, ?)`,
  ).bind(id, auth.programId, label(body.label), vault.key_id, credentialId, prfSalt, wrapped, nowIso()).run();
  return { ok: true, id };
}

// PUT /vault/wraps/recovery {keyId, wrapped, email?, code?}: a new recovery
// code; the old one stops working. Fresh sign-in, so a stolen phone can't
// quietly swap the owner's code.
export async function replaceRecoveryWrap(env, auth, body) {
  const vault = await requireVault(env, auth);
  checkKeyMatches(vault, body.keyId);
  const wrapped = wrapString(body.wrapped);
  await requireFreshSignIn(env, auth, body);
  await env.DB.prepare(`UPDATE vault_wraps SET wrapped = ?, created_at = ? WHERE program_id = ? AND kind = 'recovery'`)
    .bind(wrapped, nowIso(), auth.programId).run();
  return { ok: true };
}

// DELETE /vault/wraps/:id {email?, code?}: passkeys only; the recovery wrap is
// replaced, never removed.
export async function removeWrap(env, auth, id, body) {
  await requireVault(env, auth);
  const w = await env.DB.prepare('SELECT kind FROM vault_wraps WHERE id = ? AND program_id = ?').bind(id, auth.programId).first();
  if (!w) fail(404, 'not_found');
  if (w.kind !== 'passkey') fail(400, 'cannot_remove_recovery');
  await requireFreshSignIn(env, auth, body);
  await env.DB.prepare('DELETE FROM vault_wraps WHERE id = ? AND program_id = ?').bind(id, auth.programId).run();
  return { ok: true };
}

// --- Pairing: unlocking from another device (§5.3) -------------------------------------
// POST /vault/pairings {publicKey, label?} from the device that wants the key.
export async function createPairing(env, auth, body) {
  await requireVault(env, auth);
  const publicKey = String(body.publicKey ?? '');
  if (!P256_PUBLIC.test(publicKey)) fail(400, 'bad_public_key');
  await limitBucket(env, `vault-pair:${auth.programId}`, VAULT_LIMITS.pairings);
  const at = Date.now();
  const open = await env.DB.prepare('SELECT COUNT(*) AS n FROM vault_pairings WHERE program_id = ? AND expires_at > ?')
    .bind(auth.programId, new Date(at).toISOString()).first('n');
  if (open >= MAX_OPEN_PAIRINGS) fail(429, 'too_many_pairings');
  const id = crypto.randomUUID();
  const expiresAt = new Date(at + PAIRING_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO vault_pairings (id, program_id, device_id, device_label, public_key, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, auth.programId, auth.deviceId, label(body.label) ?? auth.deviceLabel, publicKey, new Date(at).toISOString(), expiresAt).run();
  return { pairingId: id, expiresAt };
}

// GET /vault/pairings: what an unlocked device can approve. Not its own, not
// expired, not already approved.
export async function listPairings(env, auth) {
  await requireVault(env, auth);
  const { results } = await env.DB.prepare(
    `SELECT id, device_label, public_key, created_at, expires_at FROM vault_pairings
      WHERE program_id = ? AND device_id <> ? AND approved_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`,
  ).bind(auth.programId, auth.deviceId, nowIso()).all();
  return {
    pairings: results.map((p) => ({
      id: p.id, deviceLabel: p.device_label, publicKey: p.public_key, createdAt: p.created_at, expiresAt: p.expires_at,
    })),
  };
}

// POST /vault/pairings/:id/approve {approverKey, wrapped, keyId}
export async function approvePairing(env, auth, id, body) {
  const vault = await requireVault(env, auth);
  checkKeyMatches(vault, body.keyId);
  const approverKey = String(body.approverKey ?? '');
  if (!P256_PUBLIC.test(approverKey)) fail(400, 'bad_public_key');
  const wrapped = wrapString(body.wrapped);
  const p = await env.DB.prepare('SELECT device_id, approved_at, expires_at FROM vault_pairings WHERE id = ? AND program_id = ?')
    .bind(id, auth.programId).first();
  if (!p || p.expires_at <= nowIso()) fail(404, 'not_found');
  if (p.device_id === auth.deviceId) fail(400, 'own_device');
  // Conditional, so two approvers racing can't both land.
  const res = await env.DB.prepare(
    `UPDATE vault_pairings SET approver_key = ?, wrapped = ?, key_id = ?, approved_at = ?
      WHERE id = ? AND program_id = ? AND approved_at IS NULL`,
  ).bind(approverKey, wrapped, vault.key_id, nowIso(), id, auth.programId).run();
  if (res.meta.changes !== 1) fail(409, 'already_approved');
  return { ok: true };
}

// GET /vault/pairings/:id: only the device that asked. Approved → the answer,
// once (the row is deleted as it's read).
export async function pollPairing(env, auth, id) {
  const p = await env.DB.prepare(
    'SELECT device_id, approver_key, wrapped, key_id, approved_at, expires_at FROM vault_pairings WHERE id = ? AND program_id = ?',
  ).bind(id, auth.programId).first();
  if (!p || p.device_id !== auth.deviceId) fail(404, 'not_found');
  if (!p.approved_at) {
    if (p.expires_at <= nowIso()) fail(404, 'not_found');
    return { status: 'waiting', expiresAt: p.expires_at };
  }
  await env.DB.prepare('DELETE FROM vault_pairings WHERE id = ?').bind(id).run();
  return { status: 'approved', approverKey: p.approver_key, wrapped: p.wrapped, keyId: p.key_id };
}

// --- Handoff codes (§5.4) ------------------------------------------------------------
// The reverse of pairing, for a device that's about to be left (Lite, upgrading
// to Pro): the unlocked device makes the code, the owner pastes it into the
// other one. The code is 120 bits, so the stored wrap and proof hash can't be
// guessed from; the redeeming device must also be signed in to this account.

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function proofOf(value) {
  if (typeof value !== 'string' || !PROOF.test(value)) fail(400, 'bad_proof');
  return value;
}

// POST /vault/handoffs {keyId, wrapped, proof}. A device's new code replaces
// its open one, so only the code it last showed works.
export async function createHandoff(env, auth, body) {
  const vault = await requireVault(env, auth);
  checkKeyMatches(vault, body.keyId);
  const wrapped = wrapString(body.wrapped);
  const proofHash = await sha256Hex(proofOf(body.proof));
  await limitBucket(env, `vault-handoff:${auth.programId}`, VAULT_LIMITS.handoffs);
  const at = Date.now();
  const now = new Date(at).toISOString();
  await env.DB.prepare('DELETE FROM vault_handoffs WHERE program_id = ? AND (device_id = ? OR expires_at <= ?)')
    .bind(auth.programId, auth.deviceId, now).run();
  const open = await env.DB.prepare('SELECT COUNT(*) AS n FROM vault_handoffs WHERE program_id = ?')
    .bind(auth.programId).first('n');
  if (open >= MAX_OPEN_HANDOFFS) fail(429, 'too_many_handoffs');
  const id = crypto.randomUUID();
  const expiresAt = new Date(at + HANDOFF_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO vault_handoffs (id, program_id, device_id, key_id, wrapped, proof_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, auth.programId, auth.deviceId, vault.key_id, wrapped, proofHash, now, expiresAt).run();
  return { handoffId: id, expiresAt };
}

// POST /vault/handoffs/redeem {proof} → {keyId, wrapped}, and the code is used
// up (deleted in the same statement, so two devices can't both redeem it).
export async function redeemHandoff(env, auth, body) {
  const vault = await requireVault(env, auth);
  const proofHash = await sha256Hex(proofOf(body.proof));
  await limitBucket(env, `vault-wrap:${auth.programId}`, VAULT_LIMITS.wrapReads);
  const h = await env.DB.prepare(
    `DELETE FROM vault_handoffs WHERE program_id = ? AND proof_hash = ? AND expires_at > ?
      RETURNING key_id, wrapped`,
  ).bind(auth.programId, proofHash, nowIso()).first();
  if (!h) fail(404, 'not_found');
  if (h.key_id !== vault.key_id) fail(409, 'vault_key_stale', { keyId: vault.key_id });
  return { keyId: h.key_id, wrapped: h.wrapped };
}
