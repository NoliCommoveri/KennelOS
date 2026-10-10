-- Changing the account's email (docs/KennelOS_Cloud_Phase1_Plan.md §2.6).
-- Additive only.
--
-- The account is its email's keyed hash (users.email_hash), so a change swaps
-- that hash. With proof of the old inbox (a code sent there, or a sign-in less
-- than 15 minutes old) it happens at once; without it, it waits a day in
-- email_changes, shown on every signed-in device with Cancel. Neither table
-- holds a readable address.
ALTER TABLE users ADD COLUMN email_changed_at TEXT;
CREATE TABLE IF NOT EXISTS email_changes (
  user_id         TEXT PRIMARY KEY REFERENCES users(id),
  new_email_hash  TEXT NOT NULL,
  device_id       TEXT NOT NULL,
  device_label    TEXT,
  requested_at    TEXT NOT NULL,
  effective_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_changes_due ON email_changes (effective_at);
