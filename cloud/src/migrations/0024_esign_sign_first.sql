-- She signs first (docs/KennelOS_Integrations_Plan.md §2.3a, D32). Additive only.
--
-- On a template set "I sign first" she is the request's first Signer and the
-- buyer its second. Firma's request doesn't say which signer is whose, so the
-- send remembers it: 1 = she signed first. Read to find her own signing link
-- (Countersign / Sign first) and the buyer's email for the kept copy (D33).
ALTER TABLE esign_sends ADD COLUMN countersign_first INTEGER NOT NULL DEFAULT 0;
