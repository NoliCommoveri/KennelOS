// The waitlist online, her side (docs/KennelOS_Waitlist_W2_Plan.md §2, §4–§6).
// Every route here needs a signed-in account the server knows is Pro
// (license.js requirePro), and is rate-limited per program.
//
// Her device is the single source of truth: it publishes an allow-listed
// projection per own kennel, and the server only stores and serves it. Only the
// BACKING device (Phase 1 §3.4) writes: it publishes, takes a list offline and
// acknowledges the inbox, so two devices never turn one application into two
// families. Any of her devices may read the inbox and the events (each keeps its
// own events cursor; nothing is consumed by a read).
//
// Never logged: a projection, a token, an inbox item, an email (plan §6.4).
import { requirePro } from './license.js';
import { limitBucket } from './ratelimit.js';
import { backingInfo } from './snapshots.js';
import { fail } from './lib/http.js';

// A kennel's portable public identity, as shared/data/kennelRepo.js mints it.
export const PUBLIC_ID = /^kos1_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A status-page token: 256 random bits, hex.
export const STATUS_TOKEN = /^[0-9a-f]{64}$/;
const ENTRY_ID = /^[A-Za-z0-9_-]{1,64}$/;

// D1 caps a row at 2 MB; this leaves room. About a thousand families.
export const PROJECTION_MAX_BYTES = 1_500_000;
export const WAITLIST_LIMITS = { callsPerHour: 600, inboxPage: 100, eventsPage: 500 };

async function herSide(env, auth) {
  await requirePro(env, auth);
  await limitBucket(env, `wl:${auth.programId}`, WAITLIST_LIMITS.callsPerHour);
}

async function requireBacking(env, auth) {
  const program = await env.DB.prepare('SELECT id, backing_device_id, latest_snapshot_id FROM programs WHERE id = ?')
    .bind(auth.programId).first();
  if (program.backing_device_id !== auth.deviceId) fail(409, 'not_backing_device', await backingInfo(env, program));
}

function checkPublicId(publicId) {
  if (!PUBLIC_ID.test(publicId)) fail(400, 'bad_public_id');
}

// Pure: the stored body and the tokens it carried. Each `entries[id].status_token`
// moves out of the body into wl_tokens, so a token is stored in one place only.
export function splitTokens(projection) {
  const body = { ...projection };
  const tokens = [];
  if (projection.entries !== undefined) {
    if (!projection.entries || typeof projection.entries !== 'object' || Array.isArray(projection.entries)) fail(400, 'bad_projection');
    body.entries = {};
    for (const [entryId, entry] of Object.entries(projection.entries)) {
      if (!ENTRY_ID.test(entryId) || !entry || typeof entry !== 'object' || Array.isArray(entry)) fail(400, 'bad_projection');
      const { status_token: token, ...rest } = entry;
      if (token !== undefined && token !== null) {
        if (typeof token !== 'string' || !STATUS_TOKEN.test(token)) fail(400, 'bad_status_token');
        tokens.push({ token, entryId });
      }
      body.entries[entryId] = rest;
    }
  }
  if (new Set(tokens.map((t) => t.token)).size !== tokens.length) fail(400, 'bad_status_token');
  return { body, tokens };
}

async function ownedProjection(env, auth, publicId) {
  const row = await env.DB.prepare('SELECT program_id, version, body, published_at FROM wl_projection WHERE public_id = ?')
    .bind(publicId).first();
  if (row && row.program_id !== auth.programId) fail(409, 'kennel_taken');
  return row;
}

// PUT /waitlist/projection/:publicId {projection}. → {version, publishedAt}.
// A token in no family's entry any more is revoked: that's "New link".
export async function publishProjection(env, auth, publicId, payload, now = new Date()) {
  await herSide(env, auth);
  checkPublicId(publicId);
  await requireBacking(env, auth);
  const projection = payload.projection;
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) fail(400, 'bad_projection');
  const { body, tokens } = splitTokens(projection);
  const text = JSON.stringify(body);
  if (text.length > PROJECTION_MAX_BYTES) fail(413, 'too_large');

  const existing = await ownedProjection(env, auth, publicId);
  // A token another program already holds (vanishingly unlikely, 256 bits) is refused,
  // never repointed.
  const { results: clash } = await env.DB.prepare(
    'SELECT token FROM wl_tokens WHERE token IN (SELECT value FROM json_each(?)) AND (program_id != ? OR public_id != ?) LIMIT 1',
  ).bind(JSON.stringify(tokens.map((t) => t.token)), auth.programId, publicId).all();
  if (clash.length) fail(409, 'token_taken');

  const version = (existing?.version ?? 0) + 1;
  const at = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO wl_projection (public_id, program_id, version, body, device_id, published_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (public_id) DO UPDATE SET version = excluded.version, body = excluded.body,
         device_id = excluded.device_id, published_at = excluded.published_at`,
    ).bind(publicId, auth.programId, version, text, auth.deviceId, at),
    env.DB.prepare('DELETE FROM wl_tokens WHERE public_id = ? AND token NOT IN (SELECT value FROM json_each(?))')
      .bind(publicId, JSON.stringify(tokens.map((t) => t.token))),
    ...tokens.map((t) => env.DB.prepare(
      `INSERT INTO wl_tokens (token, program_id, public_id, entry_id, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (token) DO UPDATE SET entry_id = excluded.entry_id`,
    ).bind(t.token, auth.programId, publicId, t.entryId, at)),
  ]);
  return { version, publishedAt: at };
}

// GET /waitlist/projection/:publicId: what's published now (tokens not included).
export async function readProjection(env, auth, publicId) {
  await herSide(env, auth);
  checkPublicId(publicId);
  const row = await ownedProjection(env, auth, publicId);
  if (!row) fail(404, 'not_found');
  return { version: row.version, publishedAt: row.published_at, projection: JSON.parse(row.body) };
}

// DELETE /waitlist/projection/:publicId: take this kennel's list offline. The
// public list, every status link and every hold go; the inbox and events stay
// until her device has read them.
export async function unpublishProjection(env, auth, publicId) {
  await herSide(env, auth);
  checkPublicId(publicId);
  await requireBacking(env, auth);
  await ownedProjection(env, auth, publicId);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM wl_projection WHERE public_id = ? AND program_id = ?').bind(publicId, auth.programId),
    env.DB.prepare('DELETE FROM wl_tokens WHERE public_id = ? AND program_id = ?').bind(publicId, auth.programId),
    env.DB.prepare('DELETE FROM wl_holds WHERE public_id = ? AND program_id = ?').bind(publicId, auth.programId),
  ]);
  return { ok: true };
}

// GET /waitlist/inbox: unacknowledged applications and messages, oldest first.
// `?all=1` also returns ones already acknowledged that the server still keeps
// (retention keeps them until a private backup made after the ack exists), so a
// reset or replacement phone can fetch again what its predecessor took in but
// never backed up. Her device creates an entry with the item's id as the entry
// id (plan D5), so fetching an item twice never makes two families. Paged with
// `after` = the previous page's `next`.
export async function readInbox(env, auth, url) {
  await herSide(env, auth);
  const all = url?.searchParams.get('all') === '1';
  const after = url?.searchParams.get('after') ?? '';
  let afterAt = '';
  let afterId = '';
  if (after) {
    const m = /^([0-9T:.Z-]{20,30})\|([^|]{1,64})$/.exec(after);
    if (!m) fail(400, 'bad_after');
    [, afterAt, afterId] = m;
  }
  const { results } = await env.DB.prepare(
    `SELECT id, public_id, kind, entry_id, name, email, key_id, blob, created_at, acked_at FROM wl_inbox
      WHERE program_id = ? AND (? = 1 OR acked_at IS NULL) AND (created_at > ? OR (created_at = ? AND id > ?))
      ORDER BY created_at, id LIMIT ${WAITLIST_LIMITS.inboxPage + 1}`,
  ).bind(auth.programId, all ? 1 : 0, afterAt, afterAt, afterId).all();
  const page = results.slice(0, WAITLIST_LIMITS.inboxPage);
  const items = page.map((r) => ({
    id: r.id, publicId: r.public_id, kind: r.kind, entryId: r.entry_id, name: r.name, email: r.email,
    keyId: r.key_id, blob: r.blob, createdAt: r.created_at, acked: r.acked_at !== null,
  }));
  const more = results.length > WAITLIST_LIMITS.inboxPage;
  const last = page[page.length - 1];
  return { items, more, next: more ? `${last.created_at}|${last.id}` : null };
}

// POST /waitlist/inbox/ack {ids}: the backing device has turned these into
// entries (or messages on an entry). Acked items are purged 30 days later.
export async function ackInbox(env, auth, payload, now = new Date()) {
  await herSide(env, auth);
  await requireBacking(env, auth);
  const ids = payload.ids;
  if (!Array.isArray(ids) || ids.length > WAITLIST_LIMITS.inboxPage || ids.some((id) => typeof id !== 'string' || id.length > 64)) {
    fail(400, 'bad_ids');
  }
  const res = await env.DB.prepare(
    'UPDATE wl_inbox SET acked_at = ? WHERE program_id = ? AND acked_at IS NULL AND id IN (SELECT value FROM json_each(?))',
  ).bind(now.toISOString(), auth.programId, JSON.stringify(ids)).run();
  return { acked: res.meta?.changes ?? 0 };
}

// GET /waitlist/events?since=<seq>: everything after this device's cursor.
export async function readEvents(env, auth, url) {
  await herSide(env, auth);
  const raw = url.searchParams.get('since') ?? '0';
  if (!/^\d{1,15}$/.test(raw)) fail(400, 'bad_since');
  const since = Number(raw);
  const { results } = await env.DB.prepare(
    `SELECT seq, public_id, entry_id, kind, payload, based_on_version, made_by, created_at FROM wl_events
      WHERE program_id = ? AND seq > ? ORDER BY seq LIMIT ${WAITLIST_LIMITS.eventsPage + 1}`,
  ).bind(auth.programId, since).all();
  const page = results.slice(0, WAITLIST_LIMITS.eventsPage);
  return {
    events: page.map((r) => ({
      seq: r.seq, publicId: r.public_id, entryId: r.entry_id, kind: r.kind, payload: JSON.parse(r.payload),
      basedOnVersion: r.based_on_version, madeBy: r.made_by, createdAt: r.created_at,
    })),
    last: page.length ? page[page.length - 1].seq : since,
    more: results.length > WAITLIST_LIMITS.eventsPage,
  };
}

// Account deletion (program.js) removes every waitlist row of the program.
export const deleteWaitlistStatements = (env, programId) => [
  'wl_projection', 'wl_tokens', 'wl_inbox', 'wl_events', 'wl_holds', 'wl_messages',
].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE program_id = ?`).bind(programId));
