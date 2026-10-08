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
//   GET  /f/form/<public_id>   her application form, if she accepts applications online
//   POST /f/apply/<public_id>  a sealed application; held until the applicant types
//                              the code emailed to them (then it reaches her inbox)
//   POST /f/act, /f/message    what a signed-in family does on their page (familyActions.js)
//
// Everything a family sees is cut from what her device published, field by field
// (statusView, listView). The server never computes a position or an offer.
// Never logged: a token, an email, a request body (plan §6.4).
import { limitBucket, ipKey } from './ratelimit.js';
import { normalizeEmail, emailHash } from './auth.js';
import { hmacHex, sha256Hex, randomCode, randomHex } from './lib/crypto.js';
import { assertMailAvailable, sendFamilyMessage } from './mail.js';
import { PUBLIC_ID, STATUS_TOKEN } from './waitlist.js';
import { handleAct, handleMessage, pendingFor, heldByOthers } from './familyActions.js';
import { fail, json, readJson } from './lib/http.js';

export const FAMILY_LIMITS = {
  readsPerHourPerIp: 600,
  codesPerHourPerIp: 20, codesPerHourPerEmail: 3,
  // Guessing a live code: 10 tries an hour from one connection, 300 an hour at one
  // kennel from everywhere. Against a handful of live 6-digit codes that each last
  // 15 minutes and work once, that's hopeless. (A wrong guess matches no code, so
  // these limits, not a per-code count, are what stop guessing.)
  verifyPerHourPerIp: 10, verifyPerHourPerKennel: 300,
  applicationsPerHourPerIp: 5, applicationsPerHourPerEmail: 3,
  applicationBytes: 96 * 1024,
};
export const FAMILY_CODE_MS = 15 * 60 * 1000;
export const FAMILY_SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const SESSION_TOKEN = /^[0-9a-f]{64}$/;

const LIST_PAGE = /^\/list\/([^/]+)$/;
const STATUS_PAGE = /^\/s\/([^/]+)$/;
const APPLY_PAGE = /^\/apply\/([^/]+)$/;
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

// The form page also loads Cloudflare Turnstile (its spam check) when it's set up.
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const APPLY_CSP = `default-src 'none'; script-src 'self' ${TURNSTILE_ORIGIN}; frame-src ${TURNSTILE_ORIGIN}; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

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
  if (APPLY_PAGE.test(p)) return fromAssets(env, request, '/family/apply.html', { 'cache-control': 'public, max-age=300', 'content-security-policy': APPLY_CSP });
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
  const kennel = {
    name: projection.kennel?.name ?? '', time_zone: projection.kennel?.time_zone ?? null,
    public_id: projection.kennel?.public_id ?? null, can_message: Boolean(projection.kennel?.message_key),
  };
  const family = { name: e.name ?? '', status: e.status };
  if (!OPEN_STATUSES.includes(e.status)) return { kennel, as_of: projection.as_of ?? null, family, offers: [], litters: [], public_list: [] };

  for (const k of ['applied_date', 'approved_date', 'position', 'prefs', 'paused_until', 'ready_from', 'listen', 'passes', 'fee_received_date', 'fee_due', 'requests', 'prepasses']) {
    family[k] = e[k] ?? null;
  }
  // What the page's editors offer: her parent dogs (listen-only) and her breeds.
  if (e.status === 'active') {
    kennel.parents = projection.kennel?.parents ?? { sires: [], dams: [] };
  }
  kennel.breeds = projection.kennel?.breeds ?? [];
  kennel.color_matching = Boolean(projection.kennel?.color_matching);
  kennel.message_key = projection.kennel?.message_key ?? null;
  kennel.pass_reasons = projection.kennel?.pass_reasons ?? [];
  const litters = projection.litters || {};
  const offers = (e.offers || []).map((o) => {
    const l = litters[o.litter_id] || {};
    const eligible = new Set(o.eligible_dog_ids || []);
    return {
      id: o.id,
      turn_id: o.turn_id ?? o.id,
      litter_id: o.litter_id ?? null,
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

// Her application form as the form page needs it, or null when she isn't taking
// applications online. Everything here is hers to publish: questions, FAQ, notices,
// her breeds, and the PUBLIC half of the form key.
export function formView(projection) {
  const f = projection.kennel?.form;
  if (!f || !f.open || !f.key_id || !f.public_key) return null;
  return {
    kennel: { name: projection.kennel?.name ?? '' },
    form: {
      key_id: f.key_id, public_key: f.public_key,
      questions: Array.isArray(f.questions) ? f.questions : [],
      faq: Array.isArray(f.faq) ? f.faq : [],
      breeds: Array.isArray(f.breeds) ? f.breeds : [],
      matching_keys: Array.isArray(f.matching_keys) ? f.matching_keys : [],
      matching_notice: f.matching_notice ?? '',
      color_matching: Boolean(f.color_matching),
    },
  };
}

// A new application her device hasn't taken in yet: the applicant's page says it
// arrived (once confirmed) and nothing else.
export function pendingView(projection, row) {
  return {
    kennel: { name: projection.kennel?.name ?? '', time_zone: projection.kennel?.time_zone ?? null },
    as_of: projection.as_of ?? null,
    family: { name: row.name ?? '', status: 'applied' },
    offers: [], litters: [], public_list: [],
  };
}

// --- Routes ------------------------------------------------------------------------

async function readsLimit(env, request) {
  await limitBucket(env, `wl-read:${await ipKey(env, request)}`, FAMILY_LIMITS.readsPerHourPerIp);
}

async function projectionOf(env, publicId) {
  const row = await env.DB.prepare('SELECT program_id, version, body FROM wl_projection WHERE public_id = ?').bind(publicId).first();
  return row ? { programId: row.program_id, version: row.version, projection: JSON.parse(row.body) } : null;
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

// A fresh code for one family, emailed. Unique among the kennel's live codes, so
// the code alone names the family; replaces that family's earlier codes.
async function issueCode(env, { publicId, programId, entryId, email, kennelName, forApplication = false }) {
  const now = Date.now();
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
    ).bind(publicId, hash, programId, entryId, new Date(now + FAMILY_CODE_MS).toISOString(), new Date(now).toISOString()),
  ]);
  await sendFamilyMessage(env, forApplication ? {
    programId, publicId, entryId, kind: 'application_code', to: email,
    subject: `Confirm your application to ${kennelName}: ${code}`,
    text: `Thank you for applying to ${kennelName}'s waitlist. To send your application, enter this code on the application page:\n\n${code}\n\n`
      + 'It works for 15 minutes. Your application reaches the breeder only once the code is entered.\n\n'
      + 'If you did not apply, you can ignore this email: nothing will be sent.\n',
  } : {
    programId, publicId, entryId, kind: 'verification_code', to: email,
    subject: `Your ${kennelName} waitlist code: ${code}`,
    text: `Your verification code for ${kennelName}'s waitlist is ${code}\n\n`
      + 'Enter it on the waitlist page within 15 minutes to see your details.\n\n'
      + 'If you did not ask for this code, you can ignore this email.\n',
  });
}

// Is this request a person? Cloudflare Turnstile when it's set up; on staging
// (the outbox) without it, yes; on production without it the form is closed.
async function turnstileOk(env, token, request) {
  if (!env.TURNSTILE_SECRET) {
    if (env.DEV_OUTBOX === '1') return true;
    fail(503, 'form_unavailable');
  }
  if (typeof token !== 'string' || !token || token.length > 4096) return false;
  const res = await fetch(`${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`, {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: request.headers.get('cf-connecting-ip') ?? '' }),
  });
  try { return (await res.json()).success === true; } catch { return false; }
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
    let view = found && statusView(found.projection, t.entry_id);
    if (found && !view) {
      const pending = await env.DB.prepare(
        "SELECT name FROM wl_inbox WHERE id = ? AND public_id = ? AND kind = 'application' AND confirmed_at IS NOT NULL",
      ).bind(t.entry_id, t.public_id).first();
      if (pending) view = pendingView(found.projection, pending);
    }
    if (!view) fail(404, 'not_found');
    // What they've sent that her device hasn't answered yet, and pups another
    // family picked in the meantime (no longer offered to them).
    if (found.projection.entries?.[t.entry_id]) {
      view.pending = await pendingFor(env, t.public_id, t.entry_id, found.projection.events_through);
      const held = await heldByOthers(env, t.public_id, t.entry_id);
      for (const o of view.offers) o.pups = o.pups.filter((d) => !held.has(d.id) || d.id === o.picked_dog_id);
    } else {
      view.pending = [];
    }
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
    if (!found) return json({ ok: true });
    // A family on her list, or an application she hasn't taken in yet (so an
    // applicant who lost their code can still finish).
    let entryId = entryForEmail(found.projection, email);
    if (!entryId) {
      entryId = (await env.DB.prepare(
        "SELECT id FROM wl_inbox WHERE public_id = ? AND kind = 'application' AND acked_at IS NULL AND lower(email) = ? ORDER BY created_at DESC LIMIT 1",
      ).bind(publicId, email).first())?.id ?? null;
    }
    if (!entryId || !(await statusTokenOf(env, publicId, entryId))) return json({ ok: true });
    await issueCode(env, { publicId, programId: found.programId, entryId, email, kennelName: found.projection.kennel?.name || 'the kennel' });
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
      // The code an applicant typed confirms their application: now it reaches her.
      env.DB.prepare(
        "UPDATE wl_inbox SET confirmed_at = ? WHERE id = ? AND public_id = ? AND kind = 'application' AND confirmed_at IS NULL",
      ).bind(now.toISOString(), row.entry_id, publicId),
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

  const form = /^\/f\/form\/([^/]+)$/.exec(p);
  if (form && m === 'GET') {
    await readsLimit(env, request);
    if (!PUBLIC_ID.test(form[1])) fail(404, 'not_found');
    const found = await projectionOf(env, form[1]);
    const view = found && formView(found.projection);
    if (!view) fail(404, 'not_found');
    return json({ ...view, turnstile_site_key: env.TURNSTILE_SITE_KEY || null }, 200, { 'cache-control': 'no-store' });
  }

  // A sealed application. Held unconfirmed (her device never sees it) until the
  // applicant types the code emailed to the address they gave; retention drops it
  // after two days otherwise. The server reads only name and email (Spec §8.1).
  const apply = /^\/f\/apply\/([^/]+)$/.exec(p);
  if (apply && m === 'POST') {
    const publicId = apply[1];
    if (!PUBLIC_ID.test(publicId)) fail(404, 'not_found');
    const body = await readJson(request, FAMILY_LIMITS.applicationBytes + 8 * 1024);
    const email = normalizeEmail(body.email);
    const name = String(body.name ?? '').trim();
    if (!email) fail(400, 'bad_email');
    if (!name || name.length > 200) fail(400, 'bad_name');
    if (typeof body.sealed !== 'string' || !body.sealed || body.sealed.length > FAMILY_LIMITS.applicationBytes) fail(400, 'bad_application');
    assertMailAvailable(env);
    await limitBucket(env, `wl-apply-ip:${await ipKey(env, request)}`, FAMILY_LIMITS.applicationsPerHourPerIp);
    await limitBucket(env, `wl-apply-email:${publicId}:${await emailHash(env, email)}`, FAMILY_LIMITS.applicationsPerHourPerEmail);
    const found = await projectionOf(env, publicId);
    const view = found && formView(found.projection);
    if (!view) fail(404, 'form_closed');
    if (body.key_id !== view.form.key_id) fail(409, 'form_changed'); // she rotated her key: reload the form
    if (!(await turnstileOk(env, body.turnstile, request))) fail(400, 'not_verified');

    const id = crypto.randomUUID();
    const token = randomHex(32);
    const at = new Date().toISOString();
    await env.DB.batch([
      // A second try from the same address replaces an earlier unconfirmed one.
      env.DB.prepare(
        "DELETE FROM wl_tokens WHERE entry_id IN (SELECT id FROM wl_inbox WHERE public_id = ? AND kind = 'application' AND confirmed_at IS NULL AND lower(email) = ?)",
      ).bind(publicId, email),
      env.DB.prepare("DELETE FROM wl_inbox WHERE public_id = ? AND kind = 'application' AND confirmed_at IS NULL AND lower(email) = ?").bind(publicId, email),
      env.DB.prepare(
        `INSERT INTO wl_inbox (id, program_id, public_id, kind, entry_id, name, email, key_id, blob, created_at, acked_at, confirmed_at)
         VALUES (?, ?, ?, 'application', ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      ).bind(id, found.programId, publicId, id, name, email, body.key_id, body.sealed, at),
      env.DB.prepare('INSERT INTO wl_tokens (token, program_id, public_id, entry_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(token, found.programId, publicId, id, at),
    ]);
    await issueCode(env, { publicId, programId: found.programId, entryId: id, email, kennelName: view.kennel.name || 'the kennel', forApplication: true });
    return json({ ok: true });
  }

  if (p === '/f/act' && m === 'POST') return handleAct(env, request);
  if (p === '/f/message' && m === 'POST') return handleMessage(env, request);

  fail(404, 'not_found');
}
