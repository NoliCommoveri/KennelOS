// Integration plumbing (docs/KennelOS_Integrations_Plan.md §0, step 5): what every
// vendor integration shares. Her device stays the source of truth; the Worker
// only holds the connection, receives the vendor's webhook, and keeps a small
// event for her devices to read and apply (shared/data/integrationEvents.js).
//
//   GET    /integrations/connections        her connections (never a token)
//   DELETE /integrations/connections/:id    disconnect: revoke at the vendor (best
//                                           effort), then delete the row
//   GET    /integrations/events?since=<seq> events after this device's cursor
//   POST   /hooks/<provider>/<secret>       a vendor's webhook (no CORS, no bearer)
//
// A provider is an ADAPTER registered here (steps 6 and 8 add Stripe, Square, an
// e-sign provider): { provider, verify, toEvents, revoke? }. With none
// registered, every /hooks/ call is 404 and nothing can be connected.
// A connection is made by the provider's own connect flow (createConnection);
// step 5 has no public route that makes one.
//
// Never logged: a token, a hook secret, a webhook body (cloud/README.md).
import { requirePro } from './license.js';
import { limitBucket } from './ratelimit.js';
import { randomHex, sha256Hex } from './lib/crypto.js';
import { fail, json } from './lib/http.js';

export const INTEGRATION_LIMITS = { callsPerHour: 600, hooksPerHour: 1200, eventsPage: 500, hookMaxBytes: 256 * 1024 };

// --- Adapters ---------------------------------------------------------------------

const ADAPTERS = new Map();

// adapter: {
//   provider: 'stripe',                                   // [a-z0-9]{2,20}
//   verify(request, raw: Uint8Array, connection, env) → Promise<boolean>   // the vendor's signature
//   toEvents(payload, connection) → [{ providerEventId, kind, recordType, recordId, data }]
//   revoke?(env, token, connection) → Promise<void>       // best effort, on disconnect
// }
export function registerAdapter(adapter) {
  if (!adapter || !/^[a-z0-9]{2,20}$/.test(adapter.provider || '') || typeof adapter.verify !== 'function' || typeof adapter.toEvents !== 'function') {
    throw new Error('bad adapter');
  }
  ADAPTERS.set(adapter.provider, adapter);
}
export const unregisterAdapter = (provider) => ADAPTERS.delete(provider);

// --- Events: what a provider may say, and nothing more ---------------------------------

const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const money = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e7 ? Math.round(v * 100) / 100 : undefined);
const short = (v, max, re = /^[\w .@:/#-]+$/) => (typeof v === 'string' && v.length <= max && re.test(v) ? v : undefined);
const ymd = (v) => (typeof v === 'string' && YMD.test(v) ? v : undefined);

// kind → { record: the record type it's about, fields: allowed payload keys → cleaner }
export const EVENT_KINDS = {
  'contract.signed': { record: 'contract', fields: { date: ymd } },
  'contract.declined': { record: 'contract', fields: { date: ymd } },
  'payment.paid': {
    record: 'sale',
    fields: {
      component: (v) => (['deposit', 'balance'].includes(v) ? v : undefined),
      amount: money, fee: money, currency: (v) => short(v, 3, /^[A-Z]{3}$/), date: ymd,
      method: (v) => short(v, 40), reference: (v) => short(v, 100, /^[\w.:-]+$/),
    },
  },
  'payment.refunded': { record: 'sale', fields: { amount: money, currency: (v) => short(v, 3, /^[A-Z]{3}$/), date: ymd, reference: (v) => short(v, 100, /^[\w.:-]+$/) } },
};

// Pure: one adapter event, checked and cut down to the allow-list, or null.
export function cleanEvent(e) {
  const spec = EVENT_KINDS[e?.kind];
  if (!spec || e.recordType !== spec.record || !RECORD_ID.test(String(e.recordId ?? ''))) return null;
  const id = String(e.providerEventId ?? '');
  if (!id || id.length > 200) return null;
  const payload = {};
  for (const [k, clean] of Object.entries(spec.fields)) {
    const v = clean(e.data?.[k]);
    if (v !== undefined) payload[k] = v;
  }
  return { providerEventId: id, kind: e.kind, recordType: spec.record, recordId: String(e.recordId), payload };
}

// --- Tokens, sealed with the Worker secret -----------------------------------------------

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const enc = new TextEncoder();

async function tokenKey(env) {
  if (!env.INT_TOKEN_KEY) fail(503, 'integrations_not_configured');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(env.INT_TOKEN_KEY));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const aad = (c) => enc.encode(`kennelos-int:${c.program_id}:${c.id}:${c.provider}`);

// → 'v1.<iv>.<ciphertext>' (base64), bound to this connection.
export async function sealToken(env, connection, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(connection) }, await tokenKey(env), enc.encode(token));
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

export async function openToken(env, connection) {
  const sealed = connection.token_sealed;
  if (!sealed) return null;
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) fail(500, 'bad_sealed_token');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: aad(connection) }, await tokenKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

// --- Connections ------------------------------------------------------------------------

// Made by a provider's connect flow (steps 6, 8). → { id, hookPath }: the
// webhook path to register with the vendor, shown this once (only its hash is kept).
export async function createConnection(env, programId, { provider, accountRef = null, token = null, scopes = null }, now = new Date()) {
  if (!ADAPTERS.has(provider)) fail(400, 'unknown_provider');
  const secret = randomHex(32);
  const row = { id: crypto.randomUUID(), program_id: programId, provider };
  const sealed = token ? await sealToken(env, row, token) : null;
  await env.DB.prepare(
    `INSERT INTO int_connections (id, program_id, provider, account_ref, token_sealed, scopes, hook_hash, connected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, programId, provider, accountRef, sealed, scopes, await sha256Hex(secret), now.toISOString()).run();
  return { id: row.id, hookPath: `/hooks/${provider}/${secret}` };
}

async function herSide(env, auth) {
  await requirePro(env, auth);
  await limitBucket(env, `int:${auth.programId}`, INTEGRATION_LIMITS.callsPerHour);
}

export async function listConnections(env, auth) {
  await herSide(env, auth);
  const { results } = await env.DB.prepare(
    'SELECT id, provider, account_ref, scopes, connected_at FROM int_connections WHERE program_id = ? ORDER BY connected_at',
  ).bind(auth.programId).all();
  return { connections: results.map((r) => ({ id: r.id, provider: r.provider, accountRef: r.account_ref, scopes: r.scopes, connectedAt: r.connected_at })) };
}

// Revoke at the vendor when it can, never letting that block the delete.
async function revokeQuietly(env, connection) {
  const adapter = ADAPTERS.get(connection.provider);
  if (!adapter?.revoke || !connection.token_sealed) return;
  try { await adapter.revoke(env, await openToken(env, connection), connection); } catch {
    console.error('integrations: revoke failed', connection.provider);
  }
}

// DELETE /integrations/connections/:id. Any of her signed-in devices may
// disconnect; its events stay until retention drops them.
export async function deleteConnection(env, auth, id) {
  await herSide(env, auth);
  const c = await env.DB.prepare('SELECT * FROM int_connections WHERE id = ? AND program_id = ?').bind(id, auth.programId).first();
  if (!c) fail(404, 'not_found');
  await revokeQuietly(env, c);
  await env.DB.prepare('DELETE FROM int_connections WHERE id = ?').bind(id).run();
  return { ok: true };
}

// GET /integrations/events?since=<seq>: everything after this device's cursor.
export async function readIntegrationEvents(env, auth, url) {
  await herSide(env, auth);
  const raw = url.searchParams.get('since') ?? '0';
  if (!/^\d{1,15}$/.test(raw)) fail(400, 'bad_since');
  const since = Number(raw);
  const { results } = await env.DB.prepare(
    `SELECT seq, provider, kind, record_type, record_id, payload, created_at FROM int_events
      WHERE program_id = ? AND seq > ? ORDER BY seq LIMIT ${INTEGRATION_LIMITS.eventsPage + 1}`,
  ).bind(auth.programId, since).all();
  const page = results.slice(0, INTEGRATION_LIMITS.eventsPage);
  return {
    events: page.map((r) => ({
      seq: r.seq, provider: r.provider, kind: r.kind, recordType: r.record_type, recordId: r.record_id,
      payload: JSON.parse(r.payload), createdAt: r.created_at,
    })),
    last: page.length ? page[page.length - 1].seq : since,
    more: results.length > INTEGRATION_LIMITS.eventsPage,
  };
}

// --- Webhooks -------------------------------------------------------------------------------

const HOOK = /^\/hooks\/([a-z0-9]{2,20})\/([0-9a-f]{64})$/;

// POST /hooks/<provider>/<secret>. The secret finds the connection; the adapter
// then checks the vendor's own signature over the raw bytes before anything is
// parsed. 404 for an unknown provider or secret, 401 for a bad signature, 200
// otherwise (an event that isn't ours is accepted and dropped, so the vendor
// doesn't retry it). A retried event is ignored (UNIQUE).
export async function handleHook(request, env, url, now = new Date()) {
  const m = HOOK.exec(url.pathname);
  const adapter = m && ADAPTERS.get(m[1]);
  if (!adapter) fail(404, 'not_found');
  const connection = await env.DB.prepare('SELECT * FROM int_connections WHERE hook_hash = ? AND provider = ?')
    .bind(await sha256Hex(m[2]), m[1]).first();
  if (!connection) fail(404, 'not_found');
  await limitBucket(env, `hook:${connection.id}`, INTEGRATION_LIMITS.hooksPerHour);

  const max = INTEGRATION_LIMITS.hookMaxBytes;
  if (Number(request.headers.get('content-length') ?? 0) > max) fail(413, 'too_large');
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.length > max) fail(413, 'too_large');
  if (!(await adapter.verify(request, raw, connection, env))) {
    console.error('hooks: bad signature', m[1]);
    fail(401, 'bad_signature');
  }
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { fail(400, 'bad_json'); }

  const events = (adapter.toEvents(payload, connection) || []).map(cleanEvent).filter(Boolean);
  if (events.length) {
    await env.DB.batch(events.map((e) => env.DB.prepare(
      `INSERT OR IGNORE INTO int_events (program_id, connection_id, provider, provider_event_id, kind, record_type, record_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(connection.program_id, connection.id, connection.provider, e.providerEventId, e.kind, e.recordType, e.recordId,
      JSON.stringify(e.payload), now.toISOString())));
  }
  return json({ ok: true, received: events.length });
}

// --- Account deletion ------------------------------------------------------------------------

// Before the rows go: revoke each token at its vendor (best effort).
export async function revokeAllConnections(env, programId) {
  const { results } = await env.DB.prepare('SELECT * FROM int_connections WHERE program_id = ?').bind(programId).all();
  for (const c of results) await revokeQuietly(env, c);
}

export const deleteIntegrationStatements = (env, programId) => ['int_events', 'int_connections']
  .map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE program_id = ?`).bind(programId));
