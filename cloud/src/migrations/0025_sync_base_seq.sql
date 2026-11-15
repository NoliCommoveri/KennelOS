-- Live sync: which version each pushed version was built on (K03 review,
-- findings 1 and 2). Additive only.
--
-- A pull hands it to every device, so a device whose own pushed version was
-- replaced by one that never saw it can say so ("replaced_mine"). NULL for
-- versions pushed before this column: those are never reported.
ALTER TABLE sync_records ADD COLUMN base_seq INTEGER;
