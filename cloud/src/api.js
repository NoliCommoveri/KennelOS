// The JSON API the editions call (plan §6.1). Everything here sits behind the
// maintenance gate in index.js, and every response carries the CORS headers.
import { authenticate, signOut, signOutOthers, startSignIn, verifyCode } from './auth.js';
import { getFile, headFile, putFile } from './files.js';
import { createSnapshot, getSnapshot, getSnapshotVault, listSnapshots, uploadSnapshotBody, uploadSnapshotVault } from './snapshots.js';
import { deleteAccount, getProgram, takeOver } from './program.js';
import { ackErase, cancelErase, checkIn, licenseReleased, listDevices, requestErase } from './devices.js';
import {
  addWrap, approvePairing, createHandoff, createPairing, disableVault, enableVault, getVault, getWrap, listPairings,
  pollPairing, redeemHandoff, removeWrap, replaceRecoveryWrap,
} from './vault.js';
import { getEntitlement, removeLinks, startLink, verifyLink } from './license.js';
import { cancelEmailChange, getEmailChange, requestEmailChange } from './emailChange.js';
import { ackInbox, publishProjection, readEvents, readInbox, readProjection, sendMessage, unpublishProjection, PROJECTION_MAX_BYTES } from './waitlist.js';
import { fail, json, readJson } from './lib/http.js';

const FILE = /^\/files\/([^/]+)$/;
const SNAPSHOT = /^\/snapshots\/([0-9a-f-]{36})$/;
const SNAPSHOT_BODY = /^\/snapshots\/([0-9a-f-]{36})\/body$/;
const SNAPSHOT_VAULT = /^\/snapshots\/([0-9a-f-]{36})\/vault$/;
const VAULT_WRAP = /^\/vault\/wraps\/([0-9a-f-]{36})$/;
const VAULT_PAIRING = /^\/vault\/pairings\/([0-9a-f-]{36})$/;
const VAULT_APPROVE = /^\/vault\/pairings\/([0-9a-f-]{36})\/approve$/;
const DEVICE_ERASE = /^\/devices\/([^/]+)\/erase$/;
const DEVICE_LICENSE = /^\/devices\/([^/]+)\/license-released$/;
const WL_PROJECTION = /^\/waitlist\/projection\/([^/]+)$/;

function stream(object, contentType, cors) {
  return new Response(object.body, {
    headers: { ...cors, 'content-type': contentType, 'content-length': String(object.size), 'cache-control': 'no-store' },
  });
}

export async function handleApi(request, env, url, cors) {
  const { pathname: p } = url;
  const m = request.method;

  if (p === '/auth/start' && m === 'POST') return json(await startSignIn(env, request, await readJson(request)), 200, cors);
  if (p === '/auth/verify' && m === 'POST') return json(await verifyCode(env, await readJson(request)), 200, cors);

  // The one route an erased device may still call (plan §2.5).
  if (p === '/devices/erase-ack' && m === 'POST') {
    const erased = await authenticate(env, request, { allowErased: true });
    return json(await ackErase(env, erased, await readJson(request)), 200, cors);
  }

  const auth = await authenticate(env, request);

  if (p === '/auth/signout' && m === 'POST') return json(await signOut(env, auth), 200, cors);
  if (p === '/auth/signout-others' && m === 'POST') return json(await signOutOthers(env, auth, await readJson(request)), 200, cors);

  if (p === '/program' && m === 'GET') return json(await getProgram(env, auth), 200, cors);
  if (p === '/program/backing-device' && m === 'POST') return json(await takeOver(env, auth), 200, cors);
  if (p === '/devices/check-in' && m === 'POST') return json(await checkIn(env, auth, await readJson(request)), 200, cors);
  if (p === '/devices' && m === 'GET') return json(await listDevices(env, auth), 200, cors);
  const erase = DEVICE_ERASE.exec(p);
  if (erase && m === 'POST') return json(await requestErase(env, auth, erase[1], await readJson(request)), 200, cors);
  if (erase && m === 'DELETE') return json(await cancelErase(env, auth, erase[1]), 200, cors);
  const released = DEVICE_LICENSE.exec(p);
  if (released && m === 'POST') return json(await licenseReleased(env, auth, released[1]), 200, cors);

  if (p === '/account' && m === 'DELETE') return json(await deleteAccount(env, auth, await readJson(request)), 200, cors);

  // Changing the account's email (Phase 1 plan §2.6).
  if (p === '/account/email' && m === 'GET') return json(await getEmailChange(env, auth), 200, cors);
  if (p === '/account/email' && m === 'POST') return json(await requestEmailChange(env, auth, await readJson(request)), 200, cors);
  if (p === '/account/email' && m === 'DELETE') return json(await cancelEmailChange(env, auth), 200, cors);

  // The server-side Pro license link (License Link Plan §5).
  if (p === '/account/entitlement' && m === 'GET') return json(await getEntitlement(env, auth), 200, cors);
  if (p === '/account/license-links/start' && m === 'POST') return json(await startLink(env, auth, request, await readJson(request)), 200, cors);
  if (p === '/account/license-links/verify' && m === 'POST') return json(await verifyLink(env, auth, await readJson(request)), 200, cors);
  if (p === '/account/license-links' && m === 'DELETE') return json(await removeLinks(env, auth, await readJson(request)), 200, cors);

  // The private vault (Private Vault Plan §6.1).
  if (p === '/vault' && m === 'GET') return json(await getVault(env, auth), 200, cors);
  if (p === '/vault' && m === 'POST') return json(await enableVault(env, auth, await readJson(request)), 200, cors);
  if (p === '/vault' && m === 'DELETE') return json(await disableVault(env, auth, await readJson(request)), 200, cors);
  if (p === '/vault/wraps' && m === 'POST') return json(await addWrap(env, auth, await readJson(request)), 200, cors);
  if (p === '/vault/wraps/recovery' && m === 'PUT') return json(await replaceRecoveryWrap(env, auth, await readJson(request)), 200, cors);
  const wrap = VAULT_WRAP.exec(p);
  if (wrap && m === 'GET') return json(await getWrap(env, auth, wrap[1]), 200, cors);
  if (wrap && m === 'DELETE') return json(await removeWrap(env, auth, wrap[1], await readJson(request)), 200, cors);
  if (p === '/vault/pairings' && m === 'POST') return json(await createPairing(env, auth, await readJson(request)), 200, cors);
  if (p === '/vault/pairings' && m === 'GET') return json(await listPairings(env, auth), 200, cors);
  const approve = VAULT_APPROVE.exec(p);
  if (approve && m === 'POST') return json(await approvePairing(env, auth, approve[1], await readJson(request)), 200, cors);
  const pairing = VAULT_PAIRING.exec(p);
  if (pairing && m === 'GET') return json(await pollPairing(env, auth, pairing[1]), 200, cors);
  if (p === '/vault/handoffs' && m === 'POST') return json(await createHandoff(env, auth, await readJson(request)), 200, cors);
  if (p === '/vault/handoffs/redeem' && m === 'POST') return json(await redeemHandoff(env, auth, await readJson(request)), 200, cors);

  // The waitlist online, her side (Waitlist W2 Plan §2, §4–§6). Pro only.
  const projection = WL_PROJECTION.exec(p);
  if (projection && m === 'PUT') {
    return json(await publishProjection(env, auth, projection[1], await readJson(request, PROJECTION_MAX_BYTES + 64 * 1024)), 200, cors);
  }
  if (projection && m === 'GET') return json(await readProjection(env, auth, projection[1]), 200, cors);
  if (projection && m === 'DELETE') return json(await unpublishProjection(env, auth, projection[1]), 200, cors);
  if (p === '/waitlist/inbox' && m === 'GET') return json(await readInbox(env, auth, url), 200, cors);
  if (p === '/waitlist/inbox/ack' && m === 'POST') return json(await ackInbox(env, auth, await readJson(request)), 200, cors);
  if (p === '/waitlist/events' && m === 'GET') return json(await readEvents(env, auth, url), 200, cors);
  if (p === '/waitlist/messages' && m === 'POST') {
    // Links in the email open the family pages: apply.kennelos.app on production,
    // the same origin on staging.
    const origin = env.FAMILY_PAGES_ORIGIN || url.origin;
    return json(await sendMessage(env, auth, await readJson(request, 16 * 1024), { origin }), 200, cors);
  }

  const file = FILE.exec(p);
  if (file) {
    if (m === 'HEAD') return new Response(null, { status: (await headFile(env, auth, file[1])) ? 200 : 404, headers: cors });
    if (m === 'PUT') return json(await putFile(env, auth, file[1], request), 200, cors);
    if (m === 'GET') {
      const object = await getFile(env, auth, file[1]);
      if (!object) fail(404, 'not_found');
      return stream(object, object.httpMetadata?.contentType ?? 'application/octet-stream', cors);
    }
  }

  if (p === '/snapshots' && m === 'POST') return json(await createSnapshot(env, auth, await readJson(request, 1024 * 1024)), 200, cors);
  if (p === '/snapshots' && m === 'GET') return json(await listSnapshots(env, auth), 200, cors);

  const body = SNAPSHOT_BODY.exec(p);
  if (body && m === 'PUT') return json(await uploadSnapshotBody(env, auth, body[1], request), 200, cors);

  const vaultPart = SNAPSHOT_VAULT.exec(p);
  if (vaultPart && m === 'PUT') return json(await uploadSnapshotVault(env, auth, vaultPart[1], request), 200, cors);
  if (vaultPart && m === 'GET') {
    const object = await getSnapshotVault(env, auth, vaultPart[1]);
    if (!object) fail(404, 'not_found');
    return stream(object, 'application/octet-stream', cors);
  }

  const snap = SNAPSHOT.exec(p);
  if (snap && m === 'GET') {
    const object = await getSnapshot(env, auth, snap[1]);
    if (!object) fail(404, 'not_found');
    return stream(object, 'application/gzip', cors);
  }

  fail(404, 'not_found');
}
