-- An account deleted on purpose (DELETE /account by its owner, or /ops for a user
-- who asked): the hash of every session token it had. A device that turns up later
-- hears 401 account_deleted instead of a plain sign-out, so it can tell its password
-- manager to drop the account's passkeys, and, when erase = 1 (/ops asked for a
-- fresh start), wipe itself as an erased device does. Additive only.
--
-- Token hashes only: no user, email or program is kept. Pruned after 90 days by
-- retention. Server state, not in the D1 export.
CREATE TABLE IF NOT EXISTS account_deletions (
  token_hash  TEXT PRIMARY KEY,
  erase       INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT NOT NULL
);
