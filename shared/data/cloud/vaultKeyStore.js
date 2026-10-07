// vaultKeyStore.js — this device's unlocked private-vault key (Private Vault
// Plan §3.3). The ONLY reader/writer of the `device_secrets` table (db.js).
//
// The key is stored as a CryptoKey object, which IndexedDB keeps as-is and
// localStorage (settings.js) can't hold. One row, tagged with the program it
// belongs to, so signing in to a different account never uses the wrong key.
// Extractable, because approving another device has to wrap it; that adds no
// exposure, since the same IndexedDB already holds the private data in the clear.
//
// Never in exportAll, a backup, a snapshot or a restore (db.dataTables()); Reset
// App and remote erase clear it with every other table. Not kennel data, so
// writing it doesn't mark the cloud backup dirty (tests/cloudDirty.test.js).
import { db } from '../db.js';

const ROW_ID = 'vault-key';

// → { key: CryptoKey, keyId } for `programId`, or null (locked on this device,
// or the stored key belongs to another program).
export async function getVaultKey(programId) {
  if (!programId) return null;
  const row = await db.device_secrets.get(ROW_ID);
  if (!row || row.program_id !== programId || !row.key || !row.key_id) return null;
  return { key: row.key, keyId: row.key_id };
}

export async function setVaultKey(programId, { key, keyId }) {
  await db.device_secrets.put({ id: ROW_ID, program_id: programId, key, key_id: keyId, stored_at: new Date().toISOString() });
}

// Forget the key on this device (the vault was turned off or re-keyed). The
// cloud copy and the other devices are untouched.
export async function clearVaultKey() {
  await db.device_secrets.delete(ROW_ID);
}
