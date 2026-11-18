-- From her puppy portal back to the status page, signed in (KennelPort's
-- family-portal plan 3.4): the portal's one-time links, each kept only as the hash
-- of its one-time value, so a link works once. Retention drops them after a day.
CREATE TABLE IF NOT EXISTS wl_portal_handoffs (
  nonce_hash  TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  public_id   TEXT NOT NULL,
  used_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wl_portal_handoffs_used ON wl_portal_handoffs (used_at);
