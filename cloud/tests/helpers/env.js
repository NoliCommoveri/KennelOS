// A migrated staging-shaped environment, and a signed-in device, for API tests.
import { createHash } from 'node:crypto';
import { worker, migrate, gate } from './worker.js';
import { makeDb, makeBucket } from './d1.js';

export const ORIGIN = 'https://lite.kennelos.app';

export async function makeEnv(extra = {}) {
  gate.resetGateCache();
  const env = { DB: makeDb(), FILES: makeBucket(), EMAIL_HMAC_KEY: 'test-hmac-key', DEV_OUTBOX: '1', OPS_TOKEN: 'ops', ...extra };
  await migrate.applyPending(env.DB);
  return env;
}

export function call(env, method, path, { body, token, headers = {}, ip = '203.0.113.1' } = {}) {
  const h = { Origin: ORIGIN, 'cf-connecting-ip': ip, ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof Uint8Array) {
    payload = body;
    h['content-length'] ??= String(body.length);
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['content-type'] = 'application/json';
  }
  return worker.fetch(new Request(`https://api.example${path}`, { method, headers: h, body: payload }), env);
}

export const lastCode = (env) => env.DB.raw.prepare('SELECT code FROM dev_outbox ORDER BY id DESC LIMIT 1').get()?.code;

export async function signIn(env, email = 'breeder@example.com', { deviceId, deviceLabel = 'Test phone' } = {}) {
  const start = await call(env, 'POST', '/auth/start', { body: { email } });
  if (start.status !== 200) throw new Error(`start ${start.status}`);
  const res = await call(env, 'POST', '/auth/verify', { body: { email, code: lastCode(env), deviceId, deviceLabel } });
  if (res.status !== 200) throw new Error(`verify ${res.status} ${await res.text()}`);
  return res.json();
}

export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const bytes = (text) => new TextEncoder().encode(text);

// A whole backup: upload files, describe the snapshot, upload its body.
export async function push(env, session, { base = null, files = [], payload = 'snapshot-bytes' } = {}) {
  for (const f of files) await call(env, 'PUT', `/files/${sha(f)}`, { token: session.token, body: f });
  const body = bytes(payload);
  const created = await call(env, 'POST', '/snapshots', {
    token: session.token,
    body: { base_snapshot_id: base, size: body.length, counts: { dogs: 3 }, files: files.map(sha) },
  });
  if (created.status !== 200) return created;
  const { snapshotId } = await created.json();
  return call(env, 'PUT', `/snapshots/${snapshotId}/body`, { token: session.token, body });
}
