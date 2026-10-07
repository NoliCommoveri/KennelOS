-- The private vault (docs/KennelOS_Private_Vault_Plan.md §6.2). Additive only.
--
-- Nothing here opens anything: a wrap is the vault key encrypted under a key
-- the server never sees (the recovery code's, or a passkey's PRF output); a PRF
-- salt and a credential id are public by design; a pairing holds ECDH PUBLIC
-- keys and a wrap the server can't open without the code the user typed.

-- One row per program whose owner turned the vault on. key_id names the
-- current vault key; every wrap and every snapshot's vault part carries it.
CREATE TABLE IF NOT EXISTS vaults (
  program_id  TEXT PRIMARY KEY REFERENCES programs(id),
  key_id      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- The ways to unlock: exactly one 'recovery' wrap per vault, plus any passkeys.
-- (A device unlocked by another device holds the key locally; it needs no wrap.)
CREATE TABLE IF NOT EXISTS vault_wraps (
  id             TEXT PRIMARY KEY,
  program_id     TEXT NOT NULL REFERENCES programs(id),
  kind           TEXT NOT NULL CHECK (kind IN ('recovery', 'passkey')),
  label          TEXT,
  key_id         TEXT NOT NULL,
  credential_id  TEXT,  -- passkey only: which passkey to ask for
  prf_salt       TEXT,  -- passkey only: the PRF input
  wrapped        TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_wraps_program ON vault_wraps (program_id);

-- A new device asking an unlocked one for the key (plan §5.3). Short-lived:
-- retention drops expired rows, and the new device's read of an approved one
-- deletes it.
CREATE TABLE IF NOT EXISTS vault_pairings (
  id            TEXT PRIMARY KEY,
  program_id    TEXT NOT NULL REFERENCES programs(id),
  device_id     TEXT NOT NULL,
  device_label  TEXT,
  public_key    TEXT NOT NULL,
  approver_key  TEXT,
  wrapped       TEXT,
  key_id        TEXT,
  approved_at   TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_pairings_program ON vault_pairings (program_id, expires_at);

-- A snapshot's encrypted vault part: its declared size and key, and whether the
-- bytes have landed (they must, before the body PUT commits the snapshot).
-- NULL size = no vault part. The R2 object sits beside the body as
-- snapshots/<program>/<id>.vault.
ALTER TABLE snapshots ADD COLUMN vault_size INTEGER;
ALTER TABLE snapshots ADD COLUMN vault_key_id TEXT;
ALTER TABLE snapshots ADD COLUMN vault_landed INTEGER NOT NULL DEFAULT 0;
