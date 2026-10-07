// cloudVault.js — the private vault's flows (Private Vault Plan §2, §3, §5.1):
// turning it on with a recovery code, unlocking a device with that code,
// merging the private tier in after a "Not now" restore, a new recovery code,
// and turning it off. Passkeys (§5.2) and unlocking from another device (§5.3)
// come in their own build steps.
//
// The cryptography is vaultCrypto.js; the unlocked key lives in vaultKeyStore.js;
// pushing and restoring the encrypted part is cloudBackup.js. Network only
// through cloudApi. Every entry point checks isCloudAvailable() first, so
// `cloudUrl: null` never makes a request.
//
// Errors: the cloudApi errors, plus
//   VaultLockedError (vaultCrypto) — that recovery code doesn't open the vault;
//   VaultSetupError — code 'confirm_mismatch' (the typed-back group is wrong),
//     'no_vault' (nothing to unlock), 'locked' (this device has no key to
//     re-wrap), 'program_changed' (a draft from another sign-in).
import * as api from './cloudApi.js';
import { isCloudAvailable } from './cloudConfig.js';
import { currentAccount, sessionToken } from './cloudAuth.js';
import { getVaultKey, setVaultKey, clearVaultKey } from './vaultKeyStore.js';
import {
  generateVaultKey, newRecoveryCode, formatCode, normalizeRecoveryCode,
  kekFromRecoveryCode, wrapVaultKey, unwrapVaultKey
} from './vaultCrypto.js';
import { pushIfDirty, restoreSnapshotVault } from './cloudBackup.js';
import { getCloudBackupState, updateCloudBackupState } from '../settings.js';

export class VaultSetupError extends Error {
  constructor(code, message) {
    super(message || `Private backup: ${code}.`);
    this.name = 'VaultSetupError';
    this.code = code;
  }
}

function requireSession() {
  if (!isCloudAvailable()) throw new api.CloudUnavailableError();
  const token = sessionToken();
  const programId = currentAccount()?.programId;
  if (!token || !programId) throw new api.CloudAuthError({ status: 401, code: 'unauthorized' });
  return { token, programId };
}

// The vault as this device sees it now, and the pause it may lift.
function recordVaultState(vault) {
  const state = getCloudBackupState();
  const patch = { vault };
  if (vault !== 'locked' && state.lastError?.code === 'vault_locked') patch.lastError = null;
  updateCloudBackupState(patch);
}

// --- Status -------------------------------------------------------------------
// → { enabled, unlocked, keyId, createdAt, recovery: { createdAt } | null,
//     passkeys: [{ id, label, createdAt }] }. Asks the server (one request) and
// records 'on' / 'locked' / 'off' for getBackupStatus(). A key here that the
// server's vault no longer matches (re-keyed elsewhere) is forgotten.
export async function vaultStatus() {
  const { token, programId } = requireSession();
  const v = await api.getVault(token);
  let local = await getVaultKey(programId);
  if (local && (!v.enabled || local.keyId !== v.keyId)) {
    await clearVaultKey();
    local = null;
  }
  recordVaultState(!v.enabled ? 'off' : local ? 'on' : 'locked');
  const wraps = v.wraps || [];
  const recovery = wraps.find((w) => w.kind === 'recovery');
  return {
    enabled: !!v.enabled,
    unlocked: !!local,
    keyId: v.keyId || null,
    createdAt: v.createdAt || null,
    recovery: recovery ? { createdAt: recovery.createdAt } : null,
    passkeys: wraps.filter((w) => w.kind === 'passkey').map((w) => ({ id: w.id, label: w.label, createdAt: w.createdAt }))
  };
}

// --- Recovery-code drafts (§2.1 step 2) -------------------------------------------
// The code is shown once; nothing is sent until the user types its last group
// back, so the code can't be skipped. A draft lives only in memory (the UI
// holds it between the two screens).
//   { recoveryCode: 'XXXX-XXXX-…' (to show), lastGroup (what must be typed back), … }
function draft(extra = {}) {
  const code = newRecoveryCode();
  return { code, recoveryCode: formatCode(code), lastGroup: code.slice(-4), ...extra };
}

function checkConfirmation(d, typed) {
  const t = String(typed ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!d || !d.code || t !== d.lastGroup) throw new VaultSetupError('confirm_mismatch', 'That doesn\'t match the end of your recovery code.');
}

// Turning it on, part 1: a new vault key and its recovery code, for this
// signed-in program. Nothing is stored or sent yet.
export async function startVaultSetup() {
  const { programId } = requireSession();
  const vault = await generateVaultKey();
  return draft({ programId, vault });
}

// Turning it on, part 2: `confirmation` is the code's last group, typed back.
// Sends the recovery wrap, keeps the key on this device, and runs the first
// encrypted backup at once (when cloud backup is on). Returns the push result
// (cloudBackup statuses), or { status: 'skipped' } with backup off.
// A 409 'vault_exists' (CloudConflictError) means another device turned it on
// first: unlock with that device's recovery code instead.
export async function finishVaultSetup(setup, { confirmation, onProgress } = {}) {
  const { token, programId } = requireSession();
  checkConfirmation(setup, confirmation);
  if (setup.programId !== programId) throw new VaultSetupError('program_changed');
  const { key, keyId } = setup.vault;
  const kek = await kekFromRecoveryCode(setup.code);
  const recoveryWrap = await wrapVaultKey(key, kek, { keyId, kind: 'recovery' });
  await api.enableVault(token, { keyId, recoveryWrap });
  await setVaultKey(programId, { key, keyId });
  recordVaultState('on');
  if (!getCloudBackupState().enabled) return { status: 'skipped', reason: 'off' };
  return pushIfDirty({ force: true, onProgress });
}

// --- Unlocking this device (§2.3, §5.1) -------------------------------------------
// Opens the vault with the recovery code and keeps the key here. Then, unless
// `merge: false`, merges the latest backup's private tier in (the "Not now,
// unlock later" path; a restore that runs after this unlock merges it itself).
// Throws VaultLockedError for a code that doesn't open it, and
// VaultSetupError 'no_vault' when the program has no vault.
// → { merged: restoreSnapshotVault's result | null }
export async function unlockWithRecoveryCode(rawCode, { merge = true, onProgress } = {}) {
  const { token, programId } = requireSession();
  const code = normalizeRecoveryCode(rawCode);
  const kek = await kekFromRecoveryCode(code ?? rawCode); // a malformed code throws VaultLockedError here
  const v = await api.getVault(token);
  if (!v.enabled) throw new VaultSetupError('no_vault', 'Private backup isn\'t turned on for this account.');
  const recovery = (v.wraps || []).find((w) => w.kind === 'recovery');
  if (!recovery) throw new VaultSetupError('no_vault');
  const wrap = await api.getVaultWrap(token, recovery.id);
  const key = await unwrapVaultKey(wrap.wrapped, kek, { keyId: v.keyId, kind: 'recovery' });
  await setVaultKey(programId, { key, keyId: v.keyId });
  recordVaultState('on');
  return { merged: merge ? await mergeLatestVault({ onProgress }) : null };
}

// The latest backup's private tier, merged into this device (newer wins, blank
// private fields filled; importExport 'vault-merge'). null when there is no
// backup yet.
export async function mergeLatestVault({ onProgress } = {}) {
  const { token } = requireSession();
  const program = await api.getProgram(token);
  if (!program.latestSnapshotId) return null;
  return restoreSnapshotVault(program.latestSnapshotId, { overwrite: false, onProgress });
}

// --- A new recovery code (§2.2) ---------------------------------------------------
// Part 1: a draft code. Part 2 replaces the server's recovery wrap; the old code
// stops working. Needs this device unlocked, and a fresh sign-in (more than 15
// minutes old → CloudRequestError 'reauth_required'; send a code and pass
// { email, code } as `reauth`).
export function startNewRecoveryCode() {
  const { programId } = requireSession();
  return draft({ programId });
}

export async function finishNewRecoveryCode(d, { confirmation, reauth = {} } = {}) {
  const { token, programId } = requireSession();
  checkConfirmation(d, confirmation);
  if (d.programId !== programId) throw new VaultSetupError('program_changed');
  const vault = await getVaultKey(programId);
  if (!vault) throw new VaultSetupError('locked', 'Unlock your private info on this device first.');
  const kek = await kekFromRecoveryCode(d.code);
  const wrapped = await wrapVaultKey(vault.key, kek, { keyId: vault.keyId, kind: 'recovery' });
  await api.replaceRecoveryWrap(token, { keyId: vault.keyId, wrapped }, reauth);
}

// --- Turning it off (§2.5) ----------------------------------------------------------
// Deletes every wrap on the server (nobody can unlock it again) and the key
// here; encrypted uploads stop. Old encrypted parts age out on retention. Fresh
// sign-in, as above. The device's own data is untouched.
export async function disableVault({ reauth = {} } = {}) {
  const { token } = requireSession();
  await api.disableVault(token, reauth);
  await clearVaultKey();
  recordVaultState('off');
}
