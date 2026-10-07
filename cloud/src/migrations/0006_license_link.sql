-- The server-side Pro license link (docs/KennelOS_License_Link_Plan.md §4).
-- Additive only.
--
-- Lemon Squeezy's webhook tells the Worker about each KennelOS Pro purchase.
-- The server keeps the keyed hash of the purchase email (the same HMAC as
-- users.email_hash), never the address, and never the license key.

-- One row per LS subscription, or per lifetime order. access_until is when
-- Pro on the server ends for this purchase (grace already applied); NULL means
-- no end (an active subscription, a lifetime order). An ended purchase keeps a
-- past access_until, and retention deletes it 90 days later.
CREATE TABLE IF NOT EXISTS pro_purchases (
  id                 TEXT PRIMARY KEY,  -- 'sub:<ls id>' or 'order:<ls id>'
  email_hash         TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('subscription', 'order')),
  plan               TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly', 'lifetime')),
  status             TEXT NOT NULL,     -- LS's own status ('active', 'cancelled', 'paid', 'refunded', ...)
  access_until       TEXT,
  source_updated_at  TEXT NOT NULL,     -- the payload's updated_at: an older event never overwrites a newer one
  received_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pro_purchases_email ON pro_purchases (email_hash);

-- Extra purchase emails an account has proven it owns, by a code sent to
-- that address (plan §5). Deleted with the account.
CREATE TABLE IF NOT EXISTS license_links (
  user_id     TEXT NOT NULL REFERENCES users(id),
  email_hash  TEXT NOT NULL,
  linked_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, email_hash)
);
CREATE INDEX IF NOT EXISTS idx_license_links_email ON license_links (email_hash);

-- A link code waiting to be typed: one per account at a time, hashed, single
-- use, ten minutes. Kept apart from login_codes so linking an address never
-- disturbs a sign-in to it.
CREATE TABLE IF NOT EXISTS license_link_codes (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  email_hash  TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
