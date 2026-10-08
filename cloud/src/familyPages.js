// The waitlist's family pages (docs/KennelOS_Waitlist_W2_Plan.md §3, §5, §8):
// the public list and each family's status page, read-only in this step.
//
// Pages: GET /list/<kennel public_id> and GET /s/<token> serve static files from
// public/family/ (the ASSETS binding), and /family/* serves their scripts and
// styles. Their JSON is same-origin under /f/, so no CORS is opened:
//   GET  /f/list/<public_id>   the public list (her allow-list, Spec §15.3)
//   GET  /f/status/<token>     one family's own view, cut from the projection
//   POST /f/code               "See Your Details", part 1: {public_id, email} → a
//                              6-digit code to that address, if it's on the list
//   POST /f/verify             part 2: {public_id, code} → their status link and a
//                              session that remembers this browser for 90 days
//   POST /f/session            {session}: a remembered browser's current status link
//
// Everything a family sees is cut from what her device published, field by field
// (statusView, listView). The server never computes a position or an offer.
// Never logged: a token, an email, a request body (plan §6.4).
import { limitBucket, ipKey } from './ratelimit.js';
import { normalizeEmail, emailHash } from './auth.js';
import { hmacHex, sha256Hex, randomCode, randomHex } from './lib/crypto.js';
import { assertMailAvailable, sendFamilyMessage } from './mail.js';
import { PUBLIC_ID, STATUS_TOKEN } from './waitlist.js';
import { fail, json, readJson } from './lib/http.js';

export const FAMILY_LIMITS = {
  readsPerHourPerIp: 600,
  codesPerHourPerIp: 20, codesPerHourPerEmail: 3,
  // Guessing a live code: 10 tries an hour from one connection, 300 an hour at one
  // kennel from everywhere. Against a handful of live 6-digit codes that each last
  // 15 minutes and work once, that's hopeless. (A wrong guess matches no code, so
  // these limits, not a per-code count, are what stop guessing.)
  verifyPerHourPerIp: 10, verifyPerHourPerKennel: 300,
};
export const FAMILY_CODE_MS = 15 * 60 * 1000;
export const FAMILY_SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const SESSION_TOKEN = /^[0-9a-f]{64}$/;

const LIST_PAGE = /^\/list\/([^/]+)$/;
const STATUS_PAGE = /^\/s\/([^/]+)$/;
const ASSET = /^\/family\/[A-Za-z0-9_-]+\.(js|css|svg|png)$/;
const OPEN_STATUSES = ['applied', 'approved', 'active'];

// Pages carry a bearer token in their address: no referrer, no indexing, nothing
// but this origin's own files.
const PAGE_HEADERS = {
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

async function fromAssets(env, request, path, extra = {}) {
  if (!env.ASSETS) return null;
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url), { method: 'GET' }));
  if (!res.ok) return null;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries({ ...PAGE_HEADERS, ...extra })) headers.set(k, v);
  return new Response(res.body, { status: 200, headers });
}

// A family page or one of its files, or null when the path isn't one. Served
// whatever state the schema is in: the page then shows the API's answer.
export async function serveFamilyPage(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const p = url.pathname;
  // Browsers ask for this on every page; nothing to show.
  if (p === '/favicon.ico') return new Response(null, { status: 204, headers: { 'cache-control': 'public, max-age=86400' } });
  if (LIST_PAGE.test(p)) return fromAssets(env, request, '/family/list.html', { 'cache-control': 'public, max-age=300' });
  if (STATUS_PAGE.test(p)) return fromAssets(env, request, '/family/status.html', { 'cache-control': 'no-store' });
  if (ASSET.test(p)) return fromAssets(env, request, p, { 'cache-control': 'public, max-age=300' });
  return null;
}

// --- What a family sees (pure) ------------------------------------------------------

// The public list: the kennel's name and the rows her device published.
export function listView(projection) {
  return {
    kennel: { name: projection.kennel?.name ?? '' },
    as_of: projection.as_of ?? null,
    rows: Array.isArray(projection.public_list) ? projection.public_list : [],
  };
}

// One family's own page. Their entry as published (minus their email: the page
// doesn't need it and a forwarded link shouldn't show it), their offers with the
// pups each lists, every live litter with their place in it (never anyone
// else's), and the public list for its tab. A family whose time on the list ended
// sees only that.
export function statusView(projection, entryId) {
  const e = projection.entries?.[entryId];
  if (!e) return null;
  const kennel = { name: projection.kennel?.name ?? '', time_zone: projection.kennel?.time_zone ?? null };
  const family = { name: e.name ?? '', status: e.status };
  if (!OPEN_STATUSES.includes(e.status)) return { kennel, as_of: projection.as_of ?? null, family, offers: [], litters: [], public_list: [] };

  for (const k of ['applied_date', 'approved_date', 'position', 'prefs', 'paused_until', 'ready_from', 'listen', 'passes', 'fee_received_date', 'fee_due']) {
    family[k] = e[k] ?? null;
  }
  const litters = projection.litters || {};
  const offers = (e.offers || []).map((o) => {
    const l = litters[o.litter_id] || {};
    const eligible = new Set(o.eligible_dog_ids || []);
    return {
      id: o.id,
      litter: l.label ?? '',
      offered_date: o.offered_date ?? null,
      respond_by_date: o.respond_by_date ?? null,
      picked_dog_id: o.picked_dog_id ?? null,
      pups: (l.pups || []).filter((d) => eligible.has(d.id) || d.id === o.picked_dog_id),
    };
  });
  const positions = e.litter_positions || {};
  const litterList = Object.entries(litters).map(([id, l]) => ({
    id,
    label: l.label ?? '',
    status: l.status ?? null,
    whelp_date: l.whelp_date ?? null,
    ready_date: l.ready_date ?? null,
    picks_open: Boolean(l.picks_open),
    pups_available: (l.pups || []).length,
    your_position: positions[id] ?? null,
  }));
  return { kennel, as_of: projection.as_of ?? null, family, offers, litters: litterList, public_list: listView(projection).rows };
}

// --- Routes ------------------------------------------------------------------------

async function readsLimit(env, request) {
  await limitBucket(env, `wl-read:${await ipKey(env, request)}`, FAMILY_LIMITS.readsPerHourPerIp);
}

async function projectionOf(env, publicId) {
  const row = await env.DB.prepare('SELECT program_id, body FROM wl_projection WHERE public_id = ?').bind(publicId).first();
  return row ? { programId: row.program_id, projection: JSON.parse(row.body) } : null;
}

const familyCodeHash = (env, publicId, code) => hmacHex(env.EMAIL_HMAC_KEY, `family-code:${publicId}:${code}`);

// Which of a kennel's families an email belongs to: one still on the list (or on
// its way) first, else the latest. null when it isn't on this kennel's list.
export function entryForEmail(projection, email) {
  const ids = Object.entries(projection.entries || {})
    .filter(([, e]) => normalizeEmail(e.email) === email)
    .sort(([a, x], [b, y]) => (OPEN_STATUSES.includes(y.status) - OPEN_STATUSES.includes(x.status)) || a.localeCompare(b))
    .map(([id]) => id);
  return ids[0] ?? null;
}

async function statusTokenOf(env, publicId, entryId) {
  return (await env.DB.prepare('SELECT token FROM wl_tokens WHERE public_id = ? AND entry_id = ?').bind(publicId, entryId).first())?.token ?? null;
}

function readKennelBody(body) {
  if (typeof body.public_id !== 'string' || !PUBLIC_ID.test(body.public_id)) fail(400, 'bad_request');
  return body.public_id;
}

export async function handleFamilyApi(request, env, url) {
  const p = url.pathname;
  const m = request.method;

  const list = /^\/f\/list\/([^/]+)$/.exec(p);
  if (list && m === 'GET') {
    await readsLimit(env, request);
    if (!PUBLIC_ID.test(list[1])) fail(404, 'not_found');
    const found = await projectionOf(env, list[1]);
    if (!found) fail(404, 'not_found');
    return json(listView(found.projection), 200, { 'cache-control': 'public, max-age=60' });
  }

  const status = /^\/f\/status\/([^/]+)$/.exec(p);
  if (status && m === 'GET') {
    await readsLimit(env, request);
    if (!STATUS_TOKEN.test(status[1])) fail(404, 'not_found');
    const t = await env.DB.prepare('SELECT public_id, entry_id FROM wl_tokens WHERE token = ?').bind(status[1]).first();
    const found = t && await projectionOf(env, t.public_id);
    const view = found && statusView(found.projection, t.entry_id);
    if (!view) fail(404, 'not_found');
    await env.DB.prepare('UPDATE wl_tokens SET last_used_at = ? WHERE token = ?').bind(new Date().toISOString(), status[1]).run();
    return json(view, 200, { 'referrer-policy': 'no-referrer' });
  }

  // "See Your Details", part 1. Always {ok: true} for a well-formed request,
  // whether or not that address is on the list, so it can't be used to find out
  // who is. A new code replaces that family's earlier ones.
  if (p === '/f/code' && m === 'POST') {
    const body = await readJson(request, 4 * 1024);
    const publicId = readKennelBody(body);
    const email = normalizeEmail(body.email);
    if (!email) fail(400, 'bad_email');
    assertMailAvailable(env); // before any lookup, so a 503 says nothing about the address
    await limitBucket(env, `wl-code-ip:${await ipKey(env, request)}`, FAMILY_LIMITS.codesPerHourPerIp);
    await limitBucket(env, `wl-code-email:${await emailHash(env, email)}`, FAMILY_LIMITS.codesPerHourPerEmail);
    const found = await projectionOf(env, publicId);
    const entryId = found && entryForEmail(found.projection, email);
    if (!entryId || !(await statusTokenOf(env, publicId, entryId))) return json({ ok: true });

    const now = Date.now();
    // Unique among this kennel's live codes, so the code alone names the family.
    let code;
    let hash;
    for (let i = 0; i < 20; i++) {
      code = randomCode();
      hash = await familyCodeHash(env, publicId, code);
      const taken = await env.DB.prepare('SELECT 1 FROM wl_family_codes WHERE public_id = ? AND code_hash = ? AND expires_at > ?')
        .bind(publicId, hash, new Date(now).toISOString()).first();
      if (!taken) break;
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM wl_family_codes WHERE public_id = ? AND (entry_id = ? OR code_hash = ?)').bind(publicId, entryId, hash),
      env.DB.prepare(
        'INSERT INTO wl_family_codes (public_id, code_hash, program_id, entry_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(publicId, hash, found.programId, entryId, new Date(now + FAMILY_CODE_MS).toISOString(), new Date(now).toISOString()),
    ]);
    const kennelName = found.projection.kennel?.name || 'the kennel';
    await sendFamilyMessage(env, {
      programId: found.programId, publicId, entryId, kind: 'verification_code', to: email,
      subject: `Your ${kennelName} waitlist code: ${code}`,
      text: `Your verification code for ${kennelName}'s waitlist is ${code}\n\n`
        + 'Enter it on the waitlist page within 15 minutes to see your details.\n\n'
        + 'If you did not ask for this code, you can ignore this email.\n',
    });
    return json({ ok: true });
  }

  // "See Your Details", part 2: the code → their status link, and a session that
  // remembers this browser. A wrong code says nothing about which codes exist.
  if (p === '/f/verify' && m === 'POST') {
    const body = await readJson(request, 4 * 1024);
    const publicId = readKennelBody(body);
    const code = String(body.code ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) fail(400, 'bad_code');
    await limitBucket(env, `wl-verify-ip:${await ipKey(env, request)}`, FAMILY_LIMITS.verifyPerHourPerIp);
    await limitBucket(env, `wl-verify-kennel:${publicId}`, FAMILY_LIMITS.verifyPerHourPerKennel);
    const now = new Date();
    const hash = await familyCodeHash(env, publicId, code);
    const row = await env.DB.prepare(
      'SELECT program_id, entry_id, expires_at FROM wl_family_codes WHERE public_id = ? AND code_hash = ?',
    ).bind(publicId, hash).first();
    if (!row || row.expires_at <= now.toISOString()) fail(400, 'invalid_code');
    const statusToken = await statusTokenOf(env, publicId, row.entry_id);
    if (!statusToken) fail(400, 'invalid_code');
    const session = randomHex(32);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM wl_family_codes WHERE public_id = ? AND code_hash = ?').bind(publicId, hash),
      env.DB.prepare(
        'INSERT INTO wl_family_sessions (token_hash, program_id, public_id, entry_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(await sha256Hex(session), row.program_id, publicId, row.entry_id, now.toISOString(), new Date(now.getTime() + FAMILY_SESSION_MS).toISOString()),
    ]);
    return json({ status_token: statusToken, session, expires_at: new Date(now.getTime() + FAMILY_SESSION_MS).toISOString() });
  }

  // A remembered browser: its family's current status link (it changes with New
  // link; the session doesn't). 401 once the session is gone or expired.
  if (p === '/f/session' && m === 'POST') {
    const body = await readJson(request, 4 * 1024);
    await readsLimit(env, request);
    if (typeof body.session !== 'string' || !SESSION_TOKEN.test(body.session)) fail(401, 'signed_out');
    const row = await env.DB.prepare('SELECT public_id, entry_id, expires_at FROM wl_family_sessions WHERE token_hash = ?')
      .bind(await sha256Hex(body.session)).first();
    if (!row || row.expires_at <= new Date().toISOString()) fail(401, 'signed_out');
    const statusToken = await statusTokenOf(env, row.public_id, row.entry_id);
    if (!statusToken) fail(401, 'signed_out');
    return json({ public_id: row.public_id, status_token: statusToken });
  }

  fail(404, 'not_found');
}
