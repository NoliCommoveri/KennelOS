-- Lost device: erase it remotely, and free its Pro license (plan §2.5). Additive only.
--
-- revoked_reason says who ended a session: 'self' (signed out on that device),
-- 'others' (signed out from another device) or 'erase'. NULL for sessions
-- revoked before this column, and for live ones. The device list uses it to say
-- whether an erase can still reach a device: one that signed itself out has
-- dropped its token and never asks the server anything again.
ALTER TABLE sessions ADD COLUMN revoked_reason TEXT;

-- The Lemon Squeezy activation ("instance") id a Pro device holds, reported at
-- check-in. Not a secret: releasing an activation also needs the license key,
-- which the server never sees. NULL for Lite, and once released.
ALTER TABLE sessions ADD COLUMN license_instance_id TEXT;

-- One row per device the owner asked to erase. While confirmed_at is NULL the
-- device's sessions are kept past retention, so the erase still lands however
-- long the device stays away. device_label is copied so the list can still name
-- the device after its sessions are pruned.
CREATE TABLE IF NOT EXISTS device_erasures (
  user_id       TEXT NOT NULL REFERENCES users(id),
  device_id     TEXT NOT NULL,
  device_label  TEXT,
  requested_at  TEXT NOT NULL,
  confirmed_at  TEXT,
  PRIMARY KEY (user_id, device_id)
);
