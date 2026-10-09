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
import { assertMailAvailable, familyFooter, familySender, sendFamilyMessage } from './mail.js';
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
  // Picked pups are held only until her device has applied the pick (Plan §6): it
  // says how far through the events it got, and holds up to there are released.
  const eventsThrough = Number.isInteger(projection.events_through) && projection.events_through >= 0 ? projection.events_through : 0;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO wl_projection (public_id, program_id, version, body, device_id, published_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (public_id) DO UPDATE SET version = excluded.version, body = excluded.body,
         device_id = excluded.device_id, published_at = excluded.published_at`,
    ).bind(publicId, auth.programId, version, text, auth.deviceId, at),
    // A new application's link isn't in her projection until her device has read
    // it from the inbox, so its token stays until then.
    env.DB.prepare(
      `DELETE FROM wl_tokens WHERE public_id = ? AND token NOT IN (SELECT value FROM json_each(?))
         AND entry_id NOT IN (SELECT id FROM wl_inbox WHERE public_id = ? AND kind = 'application' AND acked_at IS NULL)`,
    ).bind(publicId, JSON.stringify(tokens.map((t) => t.token)), publicId),
    env.DB.prepare(
      `DELETE FROM wl_holds WHERE public_id = ? AND EXISTS (
         SELECT 1 FROM wl_events e WHERE e.public_id = wl_holds.public_id AND e.entry_id = wl_holds.entry_id
            AND e.kind = 'pick' AND json_extract(e.payload, '$.dog_id') = wl_holds.dog_id AND e.seq <= ?)`,
    ).bind(publicId, eventsThrough),
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
// public list, every status link, signed-in browser and hold go; the inbox and events stay
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
    env.DB.prepare('DELETE FROM wl_family_codes WHERE public_id = ? AND program_id = ?').bind(publicId, auth.programId),
    env.DB.prepare('DELETE FROM wl_family_sessions WHERE public_id = ? AND program_id = ?').bind(publicId, auth.programId),
  ]);
  return { ok: true };
}

// GET /waitlist/inbox: unacknowledged applications and messages, oldest first.
// Only CONFIRMED applications (the applicant typed the emailed code, step 4) are
// ever returned. An application carries its status-page token, so her device's
// entry keeps the link the applicant already has.
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
    `SELECT i.id, i.public_id, i.kind, i.entry_id, i.name, i.email, i.key_id, i.blob, i.created_at, i.acked_at,
            (SELECT t.token FROM wl_tokens t WHERE t.public_id = i.public_id AND t.entry_id = i.id) AS status_token
       FROM wl_inbox i
      WHERE i.program_id = ? AND (? = 1 OR i.acked_at IS NULL) AND i.confirmed_at IS NOT NULL
        AND (i.created_at > ? OR (i.created_at = ? AND i.id > ?))
      ORDER BY i.created_at, i.id LIMIT ${WAITLIST_LIMITS.inboxPage + 1}`,
  ).bind(auth.programId, all ? 1 : 0, afterAt, afterAt, afterId).all();
  const page = results.slice(0, WAITLIST_LIMITS.inboxPage);
  const items = page.map((r) => ({
    id: r.id, publicId: r.public_id, kind: r.kind, entryId: r.entry_id, name: r.name, email: r.email,
    keyId: r.key_id, blob: r.blob, createdAt: r.created_at, acked: r.acked_at !== null, statusToken: r.status_token ?? null,
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

// --- Emails to families (W2 Plan §8, step 6) ---------------------------------------
//
// POST /waitlist/messages {id, public_id, entry_id, kind, subject, body}: her
// device wrote the email (from her templates, every fact from her records) and
// the server sends it in the kennel's name. The ADDRESS is never the device's to
// choose: it's the family's email in the projection already published, so this
// can't mail anyone who isn't on her list. The server adds the footer with the
// family's status-page link. `id` is the device's, so a retry never sends twice:
// a message already sent answers with its first result; a failed one is tried again.
export const EMAIL_KINDS = ['approved', 'on_list', 'declined', 'offer', 'pass_recorded', 'deadline_passed', 'almost_turn',
  'review_prefs', 'litter_born', 'request_approved', 'request_declined', 'status_link', 'note'];
export const MESSAGE_LIMITS = { perHour: 300, subjectMax: 200, bodyMax: 8000 };
const MESSAGE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendMessage(env, auth, payload, { origin }, now = new Date()) {
  await herSide(env, auth);
  const { id, public_id: publicId, entry_id: entryId, kind, subject, body } = payload || {};
  checkPublicId(publicId);
  if (typeof id !== 'string' || !MESSAGE_ID.test(id)) fail(400, 'bad_message');
  if (typeof entryId !== 'string' || !ENTRY_ID.test(entryId)) fail(400, 'bad_message');
  if (!EMAIL_KINDS.includes(kind)) fail(400, 'bad_message');
  if (typeof subject !== 'string' || !subject.trim() || subject.length > MESSAGE_LIMITS.subjectMax || /[\r\n]/.test(subject)) fail(400, 'bad_message');
  if (typeof body !== 'string' || !body.trim() || body.length > MESSAGE_LIMITS.bodyMax) fail(400, 'bad_message');
  await requireBacking(env, auth);

  const before = await env.DB.prepare('SELECT program_id, status, sent_at FROM wl_messages WHERE id = ?').bind(id).first();
  if (before && before.program_id !== auth.programId) fail(409, 'id_taken');
  if (before && before.status === 'sent') return { status: 'sent', sentAt: before.sent_at };
  await limitBucket(env, `wl-mail:${auth.programId}`, MESSAGE_LIMITS.perHour);
  assertMailAvailable(env);

  // Only this family's part of the projection is read (entry ids are [A-Za-z0-9_-]).
  const row = await env.DB.prepare(
    "SELECT program_id, json_extract(body, ?) AS entry, json_extract(body, '$.kennel.name') AS kennel_name FROM wl_projection WHERE public_id = ?",
  ).bind(`$.entries."${entryId}"`, publicId).first();
  if (row && row.program_id !== auth.programId) fail(409, 'kennel_taken');
  if (!row || !row.entry) fail(409, 'not_published');
  let to = null;
  try { to = JSON.parse(row.entry).email; } catch { /* not an object */ }
  to = typeof to === 'string' ? to.trim() : '';
  if (!EMAIL.test(to)) fail(409, 'no_email');

  const token = await env.DB.prepare('SELECT token FROM wl_tokens WHERE public_id = ? AND entry_id = ?').bind(publicId, entryId).first();
  const link = token ? `${origin}/s/${token.token}` : `${origin}/list/${publicId}`;
  const kennelName = typeof row.kennel_name === 'string' ? row.kennel_name : '';
  const status = await sendFamilyMessage(env, {
    id, programId: auth.programId, publicId, entryId, kind, to,
    subject: subject.trim(), text: body.replace(/\s+$/, ''),
    from: await familySender(env, { programId: auth.programId, publicId, kennelName }, now),
    footer: familyFooter(link, kennelName || 'the kennel'),
  }, now);
  return { status, sentAt: status === 'sent' ? now.toISOString() : null };
}

// The emails a family's status page lists (newest first), sent ones only. A body
// retention has dropped (90 days) shows as its subject alone.
export async function sentEmailsFor(env, publicId, entryId, limit = 20) {
  const { results } = await env.DB.prepare(
    `SELECT subject, body, sent_at FROM wl_messages
      WHERE public_id = ? AND entry_id = ? AND status = 'sent' AND kind IN (SELECT value FROM json_each(?))
      ORDER BY sent_at DESC LIMIT ?`,
  ).bind(publicId, entryId, JSON.stringify(EMAIL_KINDS), limit).all();
  return results.map((r) => ({ at: r.sent_at, subject: r.subject, body: r.body ?? null }));
}

// Account deletion (program.js) removes every waitlist row of the program.
export const deleteWaitlistStatements = (env, programId) => [
  'wl_projection', 'wl_tokens', 'wl_inbox', 'wl_events', 'wl_holds', 'wl_messages', 'wl_family_codes', 'wl_family_sessions', 'wl_senders',
].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE program_id = ?`).bind(programId));
