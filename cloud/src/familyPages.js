// The waitlist's family pages (docs/KennelOS_Waitlist_W2_Plan.md §3, §5, §8):
// the public list and each family's status page, read-only in this step.
//
// Pages: GET /list/<kennel public_id> and GET /s/<token> serve static files from
// public/family/ (the ASSETS binding), and /family/* serves their scripts and
// styles. Their JSON is same-origin under /f/, so no CORS is opened:
//   GET  /f/list/<public_id>   the public list (her allow-list, Spec §15.3)
//   GET  /f/status/<token>     one family's own view, cut from the projection
//   POST /f/link               "Email me my link": {public_id, email}
//
// Everything a family sees is cut from what her device published, field by field
// (statusView, listView). The server never computes a position or an offer.
// Never logged: a token, an email, a request body (plan §6.4).
import { limitBucket, ipKey } from './ratelimit.js';
import { normalizeEmail, emailHash } from './auth.js';
import { assertMailAvailable, sendFamilyMessage } from './mail.js';
import { PUBLIC_ID, STATUS_TOKEN } from './waitlist.js';
import { fail, json, readJson } from './lib/http.js';

export const FAMILY_LIMITS = { readsPerHourPerIp: 600, linkPerHourPerIp: 20, linkPerHourPerEmail: 3 };

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

const linkFor = (url, token) => `${url.origin}/s/${token}`;

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

  // Always {ok: true} for a well-formed request, whether or not that address is on
  // that list, so it can't be used to find out who is.
  if (p === '/f/link' && m === 'POST') {
    const body = await readJson(request, 4 * 1024);
    const email = normalizeEmail(body.email);
    if (!email || typeof body.public_id !== 'string' || !PUBLIC_ID.test(body.public_id)) fail(400, 'bad_request');
    assertMailAvailable(env); // before any lookup, so a 503 says nothing about the address
    await limitBucket(env, `wl-link-ip:${await ipKey(env, request)}`, FAMILY_LIMITS.linkPerHourPerIp);
    await limitBucket(env, `wl-link-email:${await emailHash(env, email)}`, FAMILY_LIMITS.linkPerHourPerEmail);
    const found = await projectionOf(env, body.public_id);
    if (!found) return json({ ok: true });
    const entryIds = Object.entries(found.projection.entries || {})
      .filter(([, e]) => normalizeEmail(e.email) === email)
      .map(([id]) => id);
    if (!entryIds.length) return json({ ok: true });
    const { results: tokens } = await env.DB.prepare(
      'SELECT token, entry_id FROM wl_tokens WHERE public_id = ? AND entry_id IN (SELECT value FROM json_each(?))',
    ).bind(body.public_id, JSON.stringify(entryIds)).all();
    const kennelName = found.projection.kennel?.name || 'the kennel';
    for (const t of tokens) {
      await sendFamilyMessage(env, {
        programId: found.programId, publicId: body.public_id, entryId: t.entry_id, kind: 'status_link', to: email,
        subject: `Your ${kennelName} waitlist page`,
        text: `Here is the link to your page on ${kennelName}'s waitlist:\n\n${linkFor(url, t.token)}\n\n`
          + 'It shows your place on the list and any puppy offered to you. Keep it to yourself: anyone with the link can see your page.\n\n'
          + 'If you did not ask for this, you can ignore this email.\n',
      });
    }
    return json({ ok: true });
  }

  fail(404, 'not_found');
}
