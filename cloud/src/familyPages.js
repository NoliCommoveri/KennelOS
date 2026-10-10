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
// A status view also lists the emails she sent that family (`emails`, step 6).
//
// Everything a family sees is cut from what her device published, field by field
// (statusView, listView). The server never computes a position or an offer.
// Never logged: a token, an email, a request body (plan §6.4).
import { limitBucket, ipKey } from './ratelimit.js';
import { normalizeEmail, emailHash } from './auth.js';
import { hmacHex, sha256Hex, randomCode, randomHex } from './lib/crypto.js';
import { assertMailAvailable, familySender, sendFamilyMessage } from './mail.js';
import { PUBLIC_ID, STATUS_TOKEN, sentEmailsFor } from './waitlist.js';
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

// --- Link previews ------------------------------------------------------------------
// A /list or /apply link pasted into Facebook (or a text, Slack, …) shows a card
// built from the page's Open Graph tags; the crawler doesn't run the page's script,
// so the Worker writes them into the HTML, at the page's <!--preview…--> marker,
// with the kennel's name. That name is already public on her list; nothing else of
// the projection is read. An unknown or unpublished kennel gets the generic card.
const PREVIEW_MARK = /<!--preview:[^>]*-->/;
const PREVIEW_IMAGE = '/family/share.png';

const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function previewText(kind, kennelName) {
  const name = String(kennelName || '').trim().slice(0, 120);
  if (kind === 'apply') {
    return name
      ? { title: `Apply to the ${name} Waitlist`, description: `Apply to join the ${name} puppy waitlist.` }
      : { title: 'Waitlist Application', description: 'Apply to join this kennel\'s puppy waitlist.' };
  }
  return name
    ? { title: `${name} Waitlist`, description: `See the ${name} puppy waitlist, and check your place in line.` }
    : { title: 'Puppy Waitlist', description: 'See this kennel\'s puppy waitlist, and check your place in line.' };
}

export function previewTags({ title, description, url, image }) {
  const meta = (attr, key, value) => `<meta ${attr}="${key}" content="${escHtml(value)}">`;
  return [
    meta('property', 'og:type', 'website'),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:width', '1200'),
    meta('property', 'og:image:height', '630'),
    meta('name', 'description', description),
    meta('name', 'twitter:card', 'summary_large_image'),
  ].join('\n');
}

async function kennelNameOf(env, publicId) {
  if (!env.DB || !PUBLIC_ID.test(publicId)) return '';
  try {
    const row = await env.DB.prepare("SELECT json_extract(body, '$.kennel.name') AS name FROM wl_projection WHERE public_id = ?").bind(publicId).first();
    return typeof row?.name === 'string' ? row.name : '';
  } catch {
    return ''; // schema not there yet (503 gate): the generic card
  }
}

async function withPreview(res, env, url, kind, publicId) {
  if (!res) return res;
  const html = await res.text();
  if (!PREVIEW_MARK.test(html)) return new Response(html, { status: res.status, headers: res.headers });
  const { title, description } = previewText(kind, await kennelNameOf(env, publicId));
  const tags = previewTags({ title, description, url: url.origin + url.pathname, image: url.origin + PREVIEW_IMAGE });
  const out = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)}</title>`).replace(PREVIEW_MARK, tags);
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(out, { status: res.status, headers });
}

// A family page or one of its files, or null when the path isn't one. Served
// whatever state the schema is in: the page then shows the API's answer.
export async function serveFamilyPage(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const p = url.pathname;
  // Browsers ask for this on every page; nothing to show.
  if (p === '/favicon.ico') return new Response(null, { status: 204, headers: { 'cache-control': 'public, max-age=86400' } });
  if (LIST_PAGE.test(p)) return withPreview(await fromAssets(env, request, '/family/list.html', { 'cache-control': 'public, max-age=300' }), env, url, 'list', p.match(LIST_PAGE)[1]);
  if (STATUS_PAGE.test(p)) return fromAssets(env, request, '/family/status.html', { 'cache-control': 'no-store' });
  if (APPLY_PAGE.test(p)) return withPreview(await fromAssets(env, request, '/family/apply.html', { 'cache-control': 'public, max-age=300', 'content-security-policy': APPLY_CSP }), env, url, 'apply', p.match(APPLY_PAGE)[1]);
  if (ASSET.test(p)) return fromAssets(env, request, p, { 'cache-control': 'public, max-age=300' });
  return null;
}

// --- What a family sees (pure) ------------------------------------------------------

// A pairing or early litter as a page shows it (Spec §16.4): parents' call names
// and titles, and her dates. Never where it shows or which dogs.
// A parent as a page shows one: call name and titles.
const parentOf = (d) => ({ name: d?.name ?? '', titles: Array.isArray(d?.titles) ? d.titles : [] });

function upcomingRow(u) {
  const parent = parentOf;
  return {
    id: u.id, kind: u.kind, label: u.label ?? '', breed: u.breed ?? null, sire: parent(u.sire), dam: parent(u.dam),
    expected_whelp_date: u.expected_whelp_date ?? null, whelp_date: u.whelp_date ?? null,
    picks_expected_date: u.picks_expected_date ?? null,
  };
}
const upcomingOf = (projection, where) => (Array.isArray(projection.upcoming) ? projection.upcoming : []).filter((u) => u && u[where] === true);

// Who holds a turn shows on the public list as "Currently deciding" (Waitlist Spec
// §16.9, decided 2026-10-10): their row keeps its number, and the name, sex
// preference and date are blanked. Her device publishes the rows unmasked; the
// mask is worked out here, from who holds a turn now, so a turn the server opens
// or closes while her phone is off shows at once. Copied from
// shared/data/waitlistRules.js (DECIDING_LABEL); tests/familyPages.test.js in the
// repo root fails if they drift.
export const DECIDING_LABEL = 'Currently deciding';

function publicRows(projection) {
  const rows = Array.isArray(projection.public_list) ? projection.public_list : [];
  const deciding = new Set(Object.values(projection.entries || {})
    .filter((e) => e && e.status === 'active' && (e.offers || []).length && Number.isInteger(e.position))
    .map((e) => e.position));
  return rows.map((r) => (deciding.has(r.position) || r.deciding
    ? { position: r.position, name: DECIDING_LABEL, pref_sex: null, added: null, deciding: true }
    : r));
}

// A litter with open picks as the pages show it (Available Puppies): her nickname,
// breed, parents, dates, and how many pups are still available by sex.
function litterCard(id, l) {
  const pups = l.pups || [];
  return {
    id,
    label: l.label ?? '',
    status: l.status ?? null,
    whelp_date: l.whelp_date ?? null,
    ready_date: l.ready_date ?? null,
    picks_open: Boolean(l.picks_open),
    pups_available: pups.length,
    pups_female: pups.filter((d) => d.sex === 'female').length,
    pups_male: pups.filter((d) => d.sex === 'male').length,
    nickname: l.nickname ?? null,
    breed: l.breed ?? null,
    sire: parentOf(l.sire),
    dam: parentOf(l.dam),
  };
}

// The public list: the kennel's name, the rows her device published (the one
// holding a turn masked), the litters with open picks (Available Puppies, as on a
// family's page: counts by sex, never a pup's name; decided 2026-10-10), and the
// pairings and early litters she shows publicly.
export function listView(projection) {
  return {
    // apply_open: she takes applications online, so the list links to her form.
    // intro: her message under the page's heading, as her device rendered it.
    kennel: { name: projection.kennel?.name ?? '', intro: typeof projection.kennel?.intro === 'string' ? projection.kennel.intro.slice(0, 2000) : '', apply_open: Boolean(formView(projection)) },
    as_of: projection.as_of ?? null,
    rows: publicRows(projection),
    available: Object.entries(projection.litters || {}).filter(([, l]) => l && l.picks_open).map(([id, l]) => litterCard(id, l)),
    upcoming: upcomingOf(projection, 'public').map(upcomingRow),
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
  // Their Companion link request: only with an open sale, placed families too.
  if (e.companion) family.companion = e.companion;
  if (!OPEN_STATUSES.includes(e.status)) return { kennel, as_of: projection.as_of ?? null, family, offers: [], litters: [], upcoming: [], public_list: [] };

  for (const k of ['applied_date', 'approved_date', 'position', 'prefs', 'paused_until', 'ready_from', 'listen', 'passes', 'fee_received_date', 'fee_due', 'requests', 'prepasses', 'place_hidden', 'pref_places', 'spent_litter_ids', 'whelp_notes', 'ready_check', 'private_name']) {
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
  // "Message us on Facebook" (Waitlist Spec §11): a Messenger link to her own Page, nothing else.
  const messenger = projection.kennel?.messenger;
  if (typeof messenger === 'string' && /^https:\/\/m\.me\/[A-Za-z0-9._-]{1,100}$/.test(messenger)) kennel.messenger = messenger;
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
  // Whether they match a litter's available pups now: a yes/no, never a place in
  // its line (decided 2026-10-08: a family sees only its overall place).
  const matching = new Set(Array.isArray(e.matching_litter_ids) ? e.matching_litter_ids : []);
  // Litters with open picks, and any in their turn. Before picks open a litter
  // shows only as one of her `upcoming` items, when she switched that stage on
  // for family pages (Spec §16.4; all off by default).
  const inTurn = new Set(offers.map((o) => o.litter_id));
  const litterList = Object.entries(litters).filter(([id, l]) => l.picks_open || inTurn.has(id)).map(([id, l]) => ({
    ...litterCard(id, l), pairing_id: l.pairing_id ?? null, match: matching.has(id),
  }));
  const mine = e.upcoming || {};
  const upcoming = e.status === 'active' ? upcomingOf(projection, 'family').map((u) => ({
    ...upcomingRow(u), pairing_id: u.pairing_id ?? null, litter_id: u.litter_id ?? null,
    waiting: mine[u.id]?.waiting !== false, ...(u.kind === 'early_litter' ? { match: mine[u.id]?.match === true } : {}),
  })) : [];
  return { kennel, as_of: projection.as_of ?? null, family, offers, litters: litterList, upcoming, public_list: listView(projection).rows };
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
    offers: [], litters: [], upcoming: [], public_list: [],
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
  // In the kennel's name, like every email to a family (step 6).
  const from = await familySender(env, { programId, publicId, kennelName });
  await sendFamilyMessage(env, forApplication ? {
    from, programId, publicId, entryId, kind: 'application_code', to: email,
    subject: `Confirm your application to ${kennelName}: ${code}`,
    text: `Thank you for applying to ${kennelName}'s waitlist. To send your application, enter this code on the application page:\n\n${code}\n\n`
      + 'It works for 15 minutes. Your application reaches the breeder only once the code is entered.\n\n'
      + 'If you did not apply, you can ignore this email: nothing will be sent.\n',
  } : {
    from, programId, publicId, entryId, kind: 'verification_code', to: email,
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
      // The emails she sent them (step 6), so one lost to spam is still read here.
      view.emails = await sentEmailsFor(env, t.public_id, t.entry_id);
    } else {
      view.pending = [];
      view.emails = [];
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
