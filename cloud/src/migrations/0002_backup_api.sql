-- Step 3b: what the backup API needs beyond 0001. Additive only.
--
-- A snapshot is created in two requests: the small JSON description first (so a
-- 409 or a missing file is refused before megabytes move), then its gzipped body.
-- `status` says which half has landed; `base_snapshot_id` is what the push was
-- based on, re-checked at commit; `device_label` names the device in the 409.
ALTER TABLE snapshots ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE snapshots ADD COLUMN base_snapshot_id TEXT;
ALTER TABLE snapshots ADD COLUMN device_label TEXT;
CREATE INDEX IF NOT EXISTS idx_snapshots_status ON snapshots (status, created_at);

-- Sign-in rate limits, one row per bucket per UTC hour. A bucket is an email
-- hash or an HMAC of the caller's IP: never the address or the IP itself.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket        TEXT NOT NULL,
  window_start  TEXT NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- Staging only (DEV_OUTBOX = "1"), while no email provider is connected: the
-- code that would have been emailed, shown on /ops. Holds the email HASH, never
-- the address. Retention empties it after an hour.
CREATE TABLE IF NOT EXISTS dev_outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash  TEXT NOT NULL,
  code        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Service notices for GET /notice (plan §2.1, Proposal §2a), set from /ops.
CREATE TABLE IF NOT EXISTS notices (
  id          TEXT PRIMARY KEY,
  level       TEXT NOT NULL CHECK (level IN ('info', 'warning', 'shutdown')),
  message     TEXT NOT NULL,
  until       TEXT,           -- ISO instant; NULL = until removed
  created_at  TEXT NOT NULL
);
