-- Fix step 9 (review K04 finding 8, K05 finding 13). Additive only.
--
-- An email change whose new address was taken while it waited is kept, marked
-- failed, instead of deleted, so every signed-in device can say it didn't happen.
-- Retention clears it after 30 days, or she dismisses it (DELETE /account/email).
ALTER TABLE email_changes ADD COLUMN failed_at TEXT;
ALTER TABLE email_changes ADD COLUMN failed_reason TEXT;

-- The manager app's sign-ins, one row each (only a hash of the cookie's id is
-- kept), so Log out ends that cookie for good and /ops can end them all without
-- rotating OPS_TOKEN.
CREATE TABLE IF NOT EXISTS manager_sessions (
  id_hash     TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manager_sessions_expires ON manager_sessions (expires_at);
