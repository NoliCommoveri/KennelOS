// The JSON API the editions call (plan §6.1). Everything here sits behind the
// maintenance gate in index.js, and every response carries the CORS headers.
import { authenticate, signOut, signOutOthers, startSignIn, verifyCode } from './auth.js';
import { getFile, headFile, putFile } from './files.js';
import { createSnapshot, getSnapshot, listSnapshots, uploadSnapshotBody } from './snapshots.js';
import { deleteAccount, getProgram, takeOver } from './program.js';
import { ackErase, cancelErase, checkIn, licenseReleased, listDevices, requestErase } from './devices.js';
import { fail, json, readJson } from './lib/http.js';

const FILE = /^\/files\/([^/]+)$/;
const SNAPSHOT = /^\/snapshots\/([0-9a-f-]{36})$/;
const SNAPSHOT_BODY = /^\/snapshots\/([0-9a-f-]{36})\/body$/;
const DEVICE_ERASE = /^\/devices\/([^/]+)\/erase$/;
const DEVICE_LICENSE = /^\/devices\/([^/]+)\/license-released$/;

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
  if (p === '/auth/signout-others' && m === 'POST') return json(await signOutOthers(env, auth), 200, cors);

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

  const snap = SNAPSHOT.exec(p);
  if (snap && m === 'GET') {
    const object = await getSnapshot(env, auth, snap[1]);
    if (!object) fail(404, 'not_found');
    return stream(object, 'application/gzip', cors);
  }

  fail(404, 'not_found');
}
