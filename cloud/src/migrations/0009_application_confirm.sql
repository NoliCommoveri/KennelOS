-- The online application form (docs/KennelOS_Waitlist_W2_Plan.md step 4). Additive.
--
-- An application reaches her inbox only once the applicant has typed the code
-- emailed to the address they gave (Spec §8.2's spam protection). Until then
-- `confirmed_at` is NULL: her device never sees it, and retention removes it
-- (and its status link) after two days. Family messages (step 5) are confirmed
-- by the sender's signed-in browser and stored with confirmed_at set.
ALTER TABLE wl_inbox ADD COLUMN confirmed_at TEXT;
