-- Contract alerts (docs/KennelOS_Notifications_Plan.md §1): a new kind, 'contract'
-- (an e-sign request signed by everyone, declined, or expired). On by default for
-- alerts and the digest. A program still on the old defaults (never changed which
-- kinds it gets) gets it too; one she chose herself is left as she set it.
UPDATE notify_settings SET push_kinds = '["message","application","turn","request","server_move","contract"]'
  WHERE push_kinds = '["message","application","turn","request","server_move"]';
UPDATE notify_settings SET digest_kinds = '["message","application","turn","request","ready","server_move","contract"]'
  WHERE digest_kinds = '["message","application","turn","request","ready","server_move"]';
