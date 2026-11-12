-- E-sign through Firma (docs/KennelOS_Integrations_Plan.md §2.3a, step 8). Additive only.
--
-- KennelOS holds the Firma account (D25) and pays each send, so every send is
-- counted against a monthly limit (D26).
--
-- One row per send, made BEFORE Firma is called (status 'sending'), so the
-- limit holds under concurrent sends and a send whose outcome is unknown still
-- counts (its credit may be spent). Firma's id is filled in once Firma answers.
-- This is also the map from Firma's signing request back to the KennelOS
-- contract: Firma's webhook names only its own id. No names, emails or facts:
-- the contract's id, the template's id and times only.
CREATE TABLE IF NOT EXISTS esign_sends (
  id                  TEXT PRIMARY KEY,
  program_id          TEXT NOT NULL REFERENCES programs(id),
  connection_id       TEXT NOT NULL,
  contract_id         TEXT NOT NULL,
  template_id         TEXT,
  signing_request_id  TEXT UNIQUE,
  status              TEXT NOT NULL,
  sent_at             TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_esign_sends_month ON esign_sends (program_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_esign_sends_contract ON esign_sends (program_id, contract_id);

-- Settings the operator changes in /ops, by key (e.g. esign_monthly_limit).
-- A missing key reads as the code's default.
CREATE TABLE IF NOT EXISTS ops_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- One account's own monthly send limit, set in /ops (Account find), in place
-- of the default. Deleted with the account.
CREATE TABLE IF NOT EXISTS esign_limits (
  program_id     TEXT PRIMARY KEY REFERENCES programs(id),
  monthly_limit  INTEGER NOT NULL,
  updated_at     TEXT NOT NULL
);
