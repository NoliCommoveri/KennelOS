-- Signed copies KennelOS keeps (docs/KennelOS_Integrations_Plan.md §2.3a, D33). Additive only.
--
-- A send from a template she ticked "Email the buyer the signed copy" is marked
-- keep_copy. Once Firma reports it completed, the hourly cron copies the signed
-- PDF to R2 (esign/<program>/<send id>.pdf) and emails the buyer a link to it.
-- The buyer's email is read from Firma at that moment and never stored here.
-- kennel_name is hers, for the email's wording. A row with a kept copy stays as
-- long as the account (retention.js), since the buyer's link reads it.
ALTER TABLE esign_sends ADD COLUMN keep_copy INTEGER NOT NULL DEFAULT 0;
ALTER TABLE esign_sends ADD COLUMN kennel_name TEXT;
-- NULL (not asked, or not signed yet) | pending (to copy) | kept (copied, to email) |
-- emailed | no_email (Firma gave no buyer email) | unsent (copied; the email gave up) |
-- failed (never copied)
ALTER TABLE esign_sends ADD COLUMN copy_status TEXT;
ALTER TABLE esign_sends ADD COLUMN copy_key TEXT;
ALTER TABLE esign_sends ADD COLUMN copy_bytes INTEGER;
ALTER TABLE esign_sends ADD COLUMN copy_tries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE esign_sends ADD COLUMN copied_at TEXT;
ALTER TABLE esign_sends ADD COLUMN emailed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_esign_sends_copy ON esign_sends (copy_status) WHERE copy_status IN ('pending', 'kept');
