-- Deleted accounts, and assisted setup (below).
--
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

-- Assisted setup and help from KennelOS support (docs/KennelOS_Assisted_Setup_Plan.md).
--
-- A helper session is an ordinary session on her account with role 'helper': support's
-- device, signed in through a one-time assist link. Owner-only routes refuse it.
ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'owner';

-- One row per program support has set up or helped. `label` is the name support typed
-- (never her email). `state`: 'setup' (support is setting it up; she hasn't taken it
-- over), 'idle' (hers, no help on), 'requested' (she pressed Get help), 'helping'.
CREATE TABLE IF NOT EXISTS assist_programs (
  program_id  TEXT PRIMARY KEY REFERENCES programs(id),
  label       TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('setup', 'idle', 'requested', 'helping')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- A one-time link that signs the device that opens it in as a helper. 15 minutes.
CREATE TABLE IF NOT EXISTS assist_links (
  token_hash  TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  expires_at  TEXT NOT NULL
);

-- What the manager app shows and pushes: kinds only, no record content.
CREATE TABLE IF NOT EXISTS assist_events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assist_events_program ON assist_events (program_id, seq);

-- The manager app's push subscriptions (payload-free pushes, like notify.js's).
CREATE TABLE IF NOT EXISTS assist_push (
  endpoint_hash   TEXT PRIMARY KEY,
  endpoint        TEXT NOT NULL,
  last_shown_seq  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

-- A vault pairing that approves itself (support and her devices, by her choice): the
-- asking device posts its code too, and only the other side of an assisted program
-- is shown it. See vault.js.
ALTER TABLE vault_pairings ADD COLUMN auto_code TEXT;
ALTER TABLE vault_pairings ADD COLUMN asker_role TEXT;
