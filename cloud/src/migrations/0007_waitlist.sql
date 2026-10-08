-- The waitlist online, W2 (docs/KennelOS_Waitlist_W2_Plan.md §4). Additive only.
--
-- Her device computes everything and publishes an allow-listed projection per
-- own kennel; the server displays it, records family responses as events, and
-- (later steps) sends her emails and makes the narrow automatic moves she
-- ticked. Every row belongs to one cloud program (the account's data set) and
-- one kennel, named by its portable public_id ('kos1_<uuid>').

-- One published projection per kennel. `body` is the JSON her device sent,
-- minus the status-page tokens (they live in wl_tokens). `version` counts up on
-- every publish; events and server moves record the version they were based on.
CREATE TABLE IF NOT EXISTS wl_projection (
  public_id     TEXT PRIMARY KEY,
  program_id    TEXT NOT NULL REFERENCES programs(id),
  version       INTEGER NOT NULL,
  body          TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  published_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wl_projection_program ON wl_projection (program_id);

-- A family's status-page link: the token is the bearer secret for that one
-- family's page. Her device knows every token (Copy status link) and sends them
-- with each projection; a token missing from a later projection is revoked.
CREATE TABLE IF NOT EXISTS wl_tokens (
  token         TEXT PRIMARY KEY,
  program_id    TEXT NOT NULL REFERENCES programs(id),
  public_id     TEXT NOT NULL,
  entry_id      TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_wl_tokens_kennel ON wl_tokens (public_id, entry_id);

-- Applications and family messages, encrypted in the sender's browser to her
-- form key. Only an application's name and email are readable (Spec §8.1, Q11).
-- Acknowledged items are purged 30 days later.
CREATE TABLE IF NOT EXISTS wl_inbox (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  public_id   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('application', 'message')),
  entry_id    TEXT,
  name        TEXT,
  email       TEXT,
  key_id      TEXT NOT NULL,
  blob        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  acked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_wl_inbox_program ON wl_inbox (program_id, acked_at, created_at);

-- Family responses and the server's own moves, append-only. Each of her
-- devices reads after its own cursor (seq); nothing is consumed by a read.
-- No free text: messages go to the inbox. Trimmed after 90 days.
CREATE TABLE IF NOT EXISTS wl_events (
  seq               INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id        TEXT NOT NULL REFERENCES programs(id),
  public_id         TEXT NOT NULL,
  entry_id          TEXT,
  kind              TEXT NOT NULL,
  payload           TEXT NOT NULL DEFAULT '{}',
  based_on_version  INTEGER,
  made_by           TEXT NOT NULL CHECK (made_by IN ('family', 'server')),
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wl_events_program ON wl_events (program_id, seq);

-- A pup a family picked on their status page, held until her device creates
-- the Sale, so no second family can take it in the meantime.
CREATE TABLE IF NOT EXISTS wl_holds (
  public_id   TEXT NOT NULL,
  dog_id      TEXT NOT NULL,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  entry_id    TEXT NOT NULL,
  offer_id    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (public_id, dog_id)
);

-- Emails to families, queued by her device, the server's own moves and the
-- form, sent from the kennel's name. Readable (Spec §8.1, Q11); no money
-- details. A sent message's body is dropped 90 days later.
CREATE TABLE IF NOT EXISTS wl_messages (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  public_id   TEXT NOT NULL,
  entry_id    TEXT,
  kind        TEXT NOT NULL,
  to_email    TEXT,
  subject     TEXT NOT NULL,
  body        TEXT,
  send_after  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  sent_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wl_messages_due ON wl_messages (status, send_after);
CREATE INDEX IF NOT EXISTS idx_wl_messages_program ON wl_messages (program_id);
