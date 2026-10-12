-- Integration plumbing (docs/KennelOS_Integrations_Plan.md §0, step 5). Additive only.
--
-- A connection is one of her vendor accounts (Stripe, Square, an e-sign
-- provider…) linked to her cloud program. Its token, if the provider gave one,
-- is sealed with the Worker secret INT_TOKEN_KEY (AES-GCM, bound to the program,
-- connection and provider) and never sent back to a device. Its webhook URL is
-- /hooks/<provider>/<secret>; only the secret's SHA-256 is kept (hook_hash), so
-- a database copy can't post as the provider. Disconnect deletes the row.
CREATE TABLE IF NOT EXISTS int_connections (
  id            TEXT PRIMARY KEY,
  program_id    TEXT NOT NULL REFERENCES programs(id),
  provider      TEXT NOT NULL,
  account_ref   TEXT,
  token_sealed  TEXT,
  scopes        TEXT,
  hook_hash     TEXT NOT NULL UNIQUE,
  connected_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_int_connections_program ON int_connections (program_id);

-- What a provider told us, append-only, one row per provider event (a retried
-- webhook is ignored by the UNIQUE). Never names, emails or document contents:
-- the KennelOS record's id (from the link's metadata), a kind, and a small
-- allow-listed payload (status, amount, fee, date). Her devices read after
-- their own cursor, like wl_events; trimmed after 90 days.
CREATE TABLE IF NOT EXISTS int_events (
  seq                INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id         TEXT NOT NULL REFERENCES programs(id),
  connection_id      TEXT NOT NULL,
  provider           TEXT NOT NULL,
  provider_event_id  TEXT NOT NULL,
  kind               TEXT NOT NULL,
  record_type        TEXT NOT NULL,
  record_id          TEXT NOT NULL,
  payload            TEXT NOT NULL DEFAULT '{}',
  created_at         TEXT NOT NULL,
  UNIQUE (connection_id, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_int_events_program ON int_events (program_id, seq);
