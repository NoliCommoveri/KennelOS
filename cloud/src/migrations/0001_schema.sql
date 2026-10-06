-- The Phase 1 server schema (docs/KennelOS_Cloud_Phase1_Plan.md §6.2).
--
-- Pre-launch this file may be edited on staging; /ops then shows it as drifted.
-- From the first real sign-in on production it is frozen, and every change is a
-- new numbered, additive file (plan §6.6).
--
-- Timestamps are ISO-8601 UTC strings. Nothing here holds a readable email
-- address, a plaintext token or a plaintext code.

-- One row per person. email_hash = HMAC-SHA256(EMAIL_HMAC_KEY, trimmed lower-cased email).
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

-- At most one live sign-in code per email hash; a new request replaces it.
CREATE TABLE IF NOT EXISTS login_codes (
  email_hash  TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  device_id     TEXT NOT NULL,
  device_label  TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- One program per user in Phase 1. latest_snapshot_id carries no foreign key on
-- purpose: snapshots reference programs, and a cycle would make deleting an
-- account an ordering puzzle.
CREATE TABLE IF NOT EXISTS programs (
  id                  TEXT PRIMARY KEY,
  owner_user_id       TEXT NOT NULL REFERENCES users(id),
  backing_device_id   TEXT,
  latest_snapshot_id  TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_programs_owner ON programs (owner_user_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id           TEXT PRIMARY KEY,
  program_id   TEXT NOT NULL REFERENCES programs(id),
  device_id    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  size         INTEGER NOT NULL,
  counts_json  TEXT NOT NULL,  -- {"<table>": <row count>, ...}
  r2_key       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_program ON snapshots (program_id, created_at);

-- The R2 index (plan §6.2): upload-if-missing, the snapshot reference check and
-- the retention GC read this instead of calling R2 once per file.
CREATE TABLE IF NOT EXISTS files (
  program_id  TEXT NOT NULL REFERENCES programs(id),
  sha256      TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (program_id, sha256)
);

-- Which files each retained snapshot references, for the GC.
CREATE TABLE IF NOT EXISTS snapshot_files (
  snapshot_id  TEXT NOT NULL REFERENCES snapshots(id),
  sha256       TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_snapshot_files_sha ON snapshot_files (sha256);
