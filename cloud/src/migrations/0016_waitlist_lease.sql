-- The waitlist lease (docs/KennelOS_Cloud_Phase2_Sync_Plan.md §7, build step 5).
-- Additive only.
--
-- A syncing program has no backing device, so its waitlist's server work (take
-- in applications, apply family events, publish, send her emails) goes to one
-- device at a time: whichever holds this lease, granted for two minutes and
-- renewed by every waitlist write and by POST /waitlist/lease. One row per
-- program; deleted with the account. Ephemeral: not in the D1 export.
CREATE TABLE IF NOT EXISTS wl_leases (
  program_id    TEXT PRIMARY KEY REFERENCES programs(id),
  device_id     TEXT NOT NULL,
  device_label  TEXT,
  until         TEXT NOT NULL
);
