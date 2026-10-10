-- Live sync (docs/KennelOS_Cloud_Phase2_Sync_Plan.md §6.2). Additive only.
--
-- One row per record, not a change log: the latest version is all a pull needs,
-- and a record's history is what snapshots are for. A delete keeps the row with
-- deleted = 1 and its payloads nulled (the tombstone). `seq` comes from
-- programs.sync_seq, bumped in the same batch, so no two versions share one.
-- cloud_json is the readable cloud tier (allow-listed, as in a snapshot); sealed
-- is the whole row under the vault key, which the server can't open.
-- file_sha256 is the /files id a `files` record's bytes are stored under (a
-- hash of ciphertext for a private file), so retention keeps them.
ALTER TABLE programs ADD COLUMN sync_enabled_at TEXT;
ALTER TABLE programs ADD COLUMN sync_disabled_at TEXT;
ALTER TABLE programs ADD COLUMN sync_seq INTEGER NOT NULL DEFAULT 0;
-- The highest seq of a tombstone retention has deleted: a device whose cursor is
-- below it may have missed a delete, so it must re-join (410 resync_required).
ALTER TABLE programs ADD COLUMN sync_purged_seq INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS sync_records (
  program_id   TEXT NOT NULL REFERENCES programs(id),
  tbl          TEXT NOT NULL,
  id           TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  deleted      INTEGER NOT NULL DEFAULT 0,
  cloud_json   TEXT,
  sealed       TEXT,
  key_id       TEXT,
  file_sha256  TEXT,
  device_id    TEXT NOT NULL,
  received_at  TEXT NOT NULL,
  PRIMARY KEY (program_id, tbl, id)
);
CREATE INDEX IF NOT EXISTS idx_sync_records_seq ON sync_records (program_id, seq);
CREATE INDEX IF NOT EXISTS idx_sync_records_file ON sync_records (program_id, file_sha256);
CREATE TABLE IF NOT EXISTS sync_devices (
  program_id    TEXT NOT NULL REFERENCES programs(id),
  device_id     TEXT NOT NULL,
  cursor_seq    INTEGER NOT NULL DEFAULT 0,
  last_sync_at  TEXT NOT NULL,
  PRIMARY KEY (program_id, device_id)
);
-- The seq a caught-up device made a snapshot at (plan §6.4).
ALTER TABLE snapshots ADD COLUMN sync_seq INTEGER;
