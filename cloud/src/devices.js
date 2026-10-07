// The account's devices: the check-in, the list, erasing a lost one and the
// bookkeeping for freeing its Pro license (plan §2.5, §6.1).
//
// Erasing only lands when the lost device next opens the app online: the
// server can't reach a device, it can only answer it. So an erase is a flag
// that every later request from that device meets as 401 device_erased
// (auth.js), and the device wipes itself and acknowledges.
import { activeNotices } from './notice.js';
import { SESSION_MS, requireFreshSignIn } from './auth.js';
import { fail } from './lib/http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INSTANCE_ID = /^[A-Za-z0-9-]{1,100}$/;

// POST /devices/check-in {licenseInstanceId}: once in a while from every
// signed-in device, whether or not it has anything to back up, so an erase can
// reach it. Records the Pro activation it holds and answers the service
// notices, which a signed-in device would otherwise fetch on its own.
export async function checkIn(env, auth, body) {
  const raw = body.licenseInstanceId;
  const instanceId = typeof raw === 'string' && INSTANCE_ID.test(raw) ? raw : null;
  // Also the sliding expiry (auth.js), moved here to the minute, so the device
  // list's "last seen" is exact for a phone that went missing.
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .bind(new Date(now).toISOString(), new Date(now + SESSION_MS).toISOString(), auth.tokenHash),
    env.DB.prepare('UPDATE sessions SET license_instance_id = ? WHERE user_id = ? AND device_id = ?').bind(instanceId, auth.userId, auth.deviceId),
  ]);
  return { ok: true, notices: await activeNotices(env) };
}

// GET /devices: every device with a session the server still holds, plus any
// erase on record. A device's state comes from its newest session.
//   status: 'signed-in' | 'signed-out-here' (it signed itself out: an erase
//           can't reach it) | 'signed-out' (signed out from another device, or
//           expired: it still has its token, so an erase reaches it)
export async function listDevices(env, auth) {
  const [{ results: sessions }, { results: erasures }, program] = await Promise.all([
    env.DB.prepare(
      `SELECT device_id, device_label, last_seen_at, expires_at, revoked_at, revoked_reason, license_instance_id
         FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC`,
    ).bind(auth.userId).all(),
    env.DB.prepare('SELECT device_id, device_label, requested_at, confirmed_at FROM device_erasures WHERE user_id = ?').bind(auth.userId).all(),
    env.DB.prepare('SELECT backing_device_id FROM programs WHERE id = ?').bind(auth.programId).first(),
  ]);
  const now = Date.now();
  const byId = new Map();
  for (const s of sessions) {
    const live = !s.revoked_at && Date.parse(s.expires_at) > now;
    let d = byId.get(s.device_id);
    if (!d) {
      d = {
        id: s.device_id, label: s.device_label, lastSeenAt: s.last_seen_at,
        status: s.revoked_reason === 'self' ? 'signed-out-here' : 'signed-out',
        licenseInstanceId: s.license_instance_id ?? null, erase: null,
      };
      byId.set(s.device_id, d);
    }
    if (live) d.status = 'signed-in';
  }
  for (const e of erasures) {
    let d = byId.get(e.device_id);
    if (!d) {
      d = { id: e.device_id, label: e.device_label, lastSeenAt: null, status: 'signed-out', licenseInstanceId: null, erase: null };
      byId.set(e.device_id, d);
    }
    d.erase = { requestedAt: e.requested_at, confirmedAt: e.confirmed_at ?? null };
  }
  const devices = [...byId.values()].map((d) => ({
    ...d, thisDevice: d.id === auth.deviceId, backing: d.id === program?.backing_device_id,
  }));
  devices.sort((a, b) => (b.thisDevice - a.thisDevice) || String(b.lastSeenAt ?? '').localeCompare(String(a.lastSeenAt ?? '')));
  return { devices };
}

function deviceIdFrom(raw) {
  const id = String(raw ?? '').toLowerCase();
  if (!UUID.test(id)) fail(404, 'not_found');
  return id;
}

async function requireOwnDevice(env, auth, deviceId) {
  const known = await env.DB.prepare(
    `SELECT device_label FROM sessions WHERE user_id = ? AND device_id = ? ORDER BY last_seen_at DESC LIMIT 1`,
  ).bind(auth.userId, deviceId).first();
  if (!known) fail(404, 'not_found');
  return known;
}

// POST /devices/:id/erase {email?, code?}: signs that device out and flags it
// to erase itself. If it was the backup device, it stops being one, so it can
// never push again and the owner's next device doesn't meet its 409.
export async function requestErase(env, auth, rawId, body) {
  const deviceId = deviceIdFrom(rawId);
  if (deviceId === auth.deviceId) fail(400, 'this_device');
  const known = await requireOwnDevice(env, auth, deviceId);
  await requireFreshSignIn(env, auth, body);
  const nowIso = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO device_erasures (user_id, device_id, device_label, requested_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, device_id) DO NOTHING`,
    ).bind(auth.userId, deviceId, known.device_label, nowIso),
    env.DB.prepare("UPDATE sessions SET revoked_at = ?, revoked_reason = 'erase' WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL")
      .bind(nowIso, auth.userId, deviceId),
    env.DB.prepare('UPDATE programs SET backing_device_id = NULL WHERE id = ? AND backing_device_id = ?').bind(auth.programId, deviceId),
  ]);
  return { ok: true };
}

// DELETE /devices/:id/erase: the device turned up before it erased itself. Its
// sign-in stays revoked: it signs in again with a code and keeps its records.
// Too late once the device has confirmed.
export async function cancelErase(env, auth, rawId) {
  const deviceId = deviceIdFrom(rawId);
  const res = await env.DB.prepare('DELETE FROM device_erasures WHERE user_id = ? AND device_id = ? AND confirmed_at IS NULL')
    .bind(auth.userId, deviceId).run();
  if (res.meta.changes !== 1) fail(409, 'not_pending');
  return { ok: true };
}

// POST /devices/erase-ack {licenseReleased}: from the erased device itself,
// after it has wiped. Its token is otherwise dead (authenticate's allowErased).
// licenseReleased: it also freed its own Pro activation, so the list stops
// offering to.
export async function ackErase(env, auth, body) {
  if (!auth.erased) fail(400, 'not_erased');
  const statements = [
    env.DB.prepare('UPDATE device_erasures SET confirmed_at = COALESCE(confirmed_at, ?) WHERE user_id = ? AND device_id = ?')
      .bind(new Date().toISOString(), auth.userId, auth.deviceId),
  ];
  if (body.licenseReleased === true) {
    statements.push(env.DB.prepare('UPDATE sessions SET license_instance_id = NULL WHERE user_id = ? AND device_id = ?').bind(auth.userId, auth.deviceId));
  }
  await env.DB.batch(statements);
  return { ok: true };
}

// POST /devices/:id/license-released: the owner's browser released that
// device's Lemon Squeezy activation (with the key, which never comes here), so
// the list stops offering it.
export async function licenseReleased(env, auth, rawId) {
  const deviceId = deviceIdFrom(rawId);
  await requireOwnDevice(env, auth, deviceId);
  await env.DB.prepare('UPDATE sessions SET license_instance_id = NULL WHERE user_id = ? AND device_id = ?')
    .bind(auth.userId, deviceId).run();
  return { ok: true };
}
