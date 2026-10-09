-- Emails to families in the kennel's name (docs/KennelOS_Waitlist_W2_Plan.md
-- step 6). Additive only.
--
-- Each kennel sends from its own address on the family mail domain,
-- `<local_part>@mail.kennelos.app`, made from its name the first time it emails.
-- The first kennel to use a name keeps it; another with the same name gets a
-- few characters of its public id added. `base` is the name-made part, so a
-- renamed kennel gets a new address and keeps the old one otherwise.
CREATE TABLE IF NOT EXISTS wl_senders (
  public_id   TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  base        TEXT NOT NULL,
  local_part  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wl_senders_program ON wl_senders (program_id);

-- A family's status page lists the emails sent to them (newest first), so a
-- page read looks them up by family.
CREATE INDEX IF NOT EXISTS idx_wl_messages_entry ON wl_messages (public_id, entry_id, sent_at);
