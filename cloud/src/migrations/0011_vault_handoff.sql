-- Handoff codes (docs/KennelOS_Private_Vault_Plan.md §5.4). Additive only.
--
-- An unlocked device (Lite, during the upgrade to Pro) makes a one-hour code
-- the owner pastes into another device signed in to the same account. The
-- server keeps the vault key wrapped under a KEK derived from the code, and a
-- SHA-256 of a separate proof derived from it, so it can hand the wrap to
-- whoever shows the proof, once, without ever being able to open it.
CREATE TABLE IF NOT EXISTS vault_handoffs (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  device_id   TEXT NOT NULL,
  key_id      TEXT NOT NULL,
  wrapped     TEXT NOT NULL,
  proof_hash  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_handoffs_proof ON vault_handoffs (program_id, proof_hash);
