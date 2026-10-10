-- Recovering an account with no signed-in device (docs/KennelOS_Cloud_Phase1_Plan.md
-- §2.7). Additive only.
--
-- The recovery code proves the account: whoever can open the vault's recovery
-- wrap holds the vault key, and from it derives a check value. Unlocked devices
-- save the SHA-256 of that check here (it never changes while the vault key
-- doesn't), so the server can compare without ever seeing the key or the code.
-- A recovery then asks for the new email through email_changes, with the same
-- one-day wait; `via` says how it was asked for, so devices can say so.
ALTER TABLE vaults ADD COLUMN recovery_check_hash TEXT;
ALTER TABLE email_changes ADD COLUMN via TEXT;
