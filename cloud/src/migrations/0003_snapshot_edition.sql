-- Which edition (lite / pro) made each snapshot. Additive only.
--
-- A 409 names the backing device's edition, so a Lite device whose program was
-- restored into Pro can say "your records moved to KennelOS Pro" instead of
-- reading the upgrade as a conflict (Editions Plan, "Converting Lite → Pro").
-- NULL for snapshots made before this column, and from a client that doesn't
-- send it.
ALTER TABLE snapshots ADD COLUMN edition TEXT;
