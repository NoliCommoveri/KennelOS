-- The R2 orphan sweep's place in the bucket (src/retention.js sweepR2Orphans).
-- Additive only.
--
-- Retention deletes D1 rows first, then R2 objects; an R2 delete that fails
-- leaves objects nothing tracks. The daily run walks the bucket a few pages at a
-- time and deletes those; this one row remembers where the last run stopped
-- (R2's list cursor, null between passes) so every run carries on from there.
-- Server state only: no user data, not in the D1 export.
CREATE TABLE IF NOT EXISTS r2_sweep (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  cursor           TEXT,
  pass_started_at  TEXT,
  last_pass_at     TEXT
);
