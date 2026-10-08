-- "See Your Details": families sign in with a code (docs/KennelOS_Waitlist_W2_Plan.md
-- step 3, revised 2026-10-08). Additive only.
--
-- A family types the email they applied with; a 6-digit code goes to it. Typing the
-- code on the kennel's page opens their status page and remembers that browser
-- for 90 days (a family session). The code alone names the family: it's unique
-- among a kennel's live codes, single use, 15 minutes. Guessing is stopped by rate
-- limits (familyPages.js), since a wrong guess matches no row.

CREATE TABLE IF NOT EXISTS wl_family_codes (
  public_id   TEXT NOT NULL,
  code_hash   TEXT NOT NULL,            -- HMAC of the kennel and the code
  program_id  TEXT NOT NULL REFERENCES programs(id),
  entry_id    TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (public_id, code_hash)
);

-- A browser a family signed in on. The token is returned once and stored hashed.
-- Step 5's buttons (accept, pass, leave, pause request) will need one.
CREATE TABLE IF NOT EXISTS wl_family_sessions (
  token_hash  TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  public_id   TEXT NOT NULL,
  entry_id    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wl_family_sessions_kennel ON wl_family_sessions (public_id, entry_id);
