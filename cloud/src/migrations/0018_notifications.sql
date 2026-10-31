-- Notifications for the breeder (docs/KennelOS_Notifications_Plan.md): app alerts
-- (web push) and the email digest. Additive only.
--
-- notify_settings: one row per program, made the first time she saves either.
-- digest_email is her readable address, kept ONLY while the digest is on (her
-- separate opt-in; the rest of the schema keeps email hashes). pending_email waits
-- for its code, then moves to digest_email; both are cleared when she turns the
-- digest off, and the row goes with the account.
CREATE TABLE IF NOT EXISTS notify_settings (
  program_id          TEXT PRIMARY KEY REFERENCES programs(id),
  push_kinds          TEXT NOT NULL DEFAULT '[]',
  hide_names          INTEGER NOT NULL DEFAULT 0,
  digest_email        TEXT,
  digest_frequency    TEXT NOT NULL DEFAULT 'daily',
  digest_kinds        TEXT NOT NULL DEFAULT '[]',
  digest_tz           TEXT,
  digest_last_sent_at TEXT,
  pending_email       TEXT,
  pending_code_hash   TEXT,
  pending_expires_at  TEXT,
  pending_attempts    INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL
);

-- One row per device that turned alerts on. The endpoint is the push service's
-- opaque URL; auth_secret is the subscription's own secret, which only that
-- browser and this table know: the service worker proves itself with it when it
-- asks what an alert should say (sends carry no text). Sent only while the
-- device has a live session.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint_hash  TEXT PRIMARY KEY,
  program_id     TEXT NOT NULL REFERENCES programs(id),
  user_id        TEXT NOT NULL,
  device_id      TEXT NOT NULL,
  endpoint       TEXT NOT NULL,
  auth_secret    TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  last_sent_at   TEXT,
  last_shown_seq INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_program ON push_subscriptions (program_id);

-- What happened, for alerts and the digest: the kind, the family's listed name
-- (first name + last initial), the kennel's name. Never what a family wrote.
-- Kept 8 days (a weekly digest's worth); ephemeral, not in the D1 export.
CREATE TABLE IF NOT EXISTS notify_items (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id   TEXT NOT NULL REFERENCES programs(id),
  kind         TEXT NOT NULL,
  what         TEXT NOT NULL,
  name         TEXT,
  kennel       TEXT,
  entry_id     TEXT,
  at           TEXT NOT NULL,
  digested_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_notify_items_program ON notify_items (program_id, at);
