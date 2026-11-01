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
// Embedding (docs/KennelOS_Integrations_Plan.md §1): /apply and /list may be shown
// inside her own website, in a frame, only while her projection carries
// `kennel.embed` (she switched it on). `frame-ancestors` then names the site
// addresses she listed, or any site when she listed none. The status page never
// can be framed: it holds one family's private details.
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
import { notifyEvent } from './notify.js';
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
const pageCsp = (frameAncestors = "'none'") => `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${frameAncestors}`;
const PAGE_HEADERS = {
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'content-security-policy': pageCsp(),
};

// The form page also loads Cloudflare Turnstile (its spam check) when it's set up.
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const applyCsp = (frameAncestors = "'none'") => `default-src 'none'; script-src 'self' ${TURNSTILE_ORIGIN}; frame-src ${TURNSTILE_ORIGIN}; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${frameAncestors}`;

// Who may show a kennel's /apply and /list pages in a frame: `'none'` unless her
// projection switched embedding on (`kennel.embed`), then the site addresses she
// listed, or any site when she listed none. Each address is checked here, since it
// goes into a header: a scheme and host (and port), nothing else. A list with no
// valid address at all stays `'none'` rather than opening to every site.
export const EMBED_ORIGINS_MAX = 10;
const EMBED_ORIGIN = /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/;
export function frameAncestors(embed) {
  if (!embed || typeof embed !== 'object' || Array.isArray(embed)) return "'none'";
  const listed = Array.isArray(embed.origins) ? embed.origins : [];
  const valid = [...new Set(listed.filter((o) => typeof o === 'string' && EMBED_ORIGIN.test(o)))].slice(0, EMBED_ORIGINS_MAX);
  if (valid.length) return valid.join(' ');
  return listed.length ? "'none'" : '*';
}

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

// What a /list or /apply page needs from her projection before it's served: the
// kennel's name (for the link preview) and whether, and where, it may be framed.
async function kennelPageInfo(env, publicId) {
  const none = { name: '', embed: null };
  if (!env.DB || !PUBLIC_ID.test(publicId)) return none;
  try {
    const row = await env.DB.prepare("SELECT json_extract(body, '$.kennel.name') AS name, json_extract(body, '$.kennel.embed') AS embed FROM wl_projection WHERE public_id = ?").bind(publicId).first();
    let embed = null;
    try { embed = row?.embed ? JSON.parse(row.embed) : null; } catch { embed = null; }
    return { name: typeof row?.name === 'string' ? row.name : '', embed };
  } catch {
    return none; // schema not there yet (503 gate): the generic card, never framed
  }
}

async function withPreview(res, url, kind, kennelName) {
  if (!res) return res;
  const html = await res.text();
  if (!PREVIEW_MARK.test(html)) return new Response(html, { status: res.status, headers: res.headers });
  const { title, description } = previewText(kind, kennelName);
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
  if (LIST_PAGE.test(p)) {
    const info = await kennelPageInfo(env, p.match(LIST_PAGE)[1]);
    return withPreview(await fromAssets(env, request, '/family/list.html', { 'cache-control': 'public, max-age=300', 'content-security-policy': pageCsp(frameAncestors(info.embed)) }), url, 'list', info.name);
  }
  if (STATUS_PAGE.test(p)) return fromAssets(env, request, '/family/status.html', { 'cache-control': 'no-store' });
  if (APPLY_PAGE.test(p)) {
    const info = await kennelPageInfo(env, p.match(APPLY_PAGE)[1]);
    return withPreview(await fromAssets(env, request, '/family/apply.html', { 'cache-control': 'public, max-age=300', 'content-security-policy': applyCsp(frameAncestors(info.embed)) }), url, 'apply', info.name);
  }
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
// §16.9, decided 2026-10-10): their row keeps its number, sex preference and date
// added; only the name is replaced. Her device publishes the rows unmasked; the
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
    ? { ...r, name: DECIDING_LABEL, deciding: true }
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
// Her referral links and codes she shares with families, as her device published
// them: each field a short string, a link only when it's a web address; at most 20.
const REC_LINK = /^https?:\/\/[^\s"'<>]{1,500}$/i;
export function recommendedOf(projection) {
  const list = Array.isArray(projection.kennel?.recommended) ? projection.kennel.recommended : [];
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return list.slice(0, 20).map((r) => ({
    name: str(r?.name, 120),
    link: typeof r?.link === 'string' && REC_LINK.test(r.link) ? r.link : '',
    code: str(r?.code, 80),
    instructions: str(r?.instructions, 1000),
  })).filter((r) => r.name && (r.link || r.code));
}

// Her transport suggestions (Family Requests plan D8): flight nannies and ground
// transporters, as her device published them: a name, a web link (only a web
// address) and notes; at most 20. Shown only to a family with an open sale.
export function transportOf(projection) {
  const list = Array.isArray(projection.kennel?.transport) ? projection.kennel.transport : [];
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return list.slice(0, 20).map((t) => ({
    name: str(t?.name, 120),
    link: typeof t?.link === 'string' && REC_LINK.test(t.link) ? t.link : '',
    notes: str(t?.notes, 1000),
  })).filter((t) => t.name && (t.link || t.notes));
}

// A family's extras as her device published them, field by field (no prices
// ever pass). → { available, current, requests } or null.
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
export function extrasOf(x) {
  if (!x || typeof x !== 'object') return null;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const id = (v) => (typeof v === 'string' && v.length <= 80 ? v : '');
  const date = (v) => (typeof v === 'string' && YMD_RE.test(v) ? v : null);
  const arr = (v) => (Array.isArray(v) ? v.slice(0, 100) : []);
  const out = {
    available: arr(x.available).map((a) => ({ id: id(a?.id), name: str(a?.name, 120), group: str(a?.group, 80), description: str(a?.description, 300), open_from: date(a?.open_from), open_until: date(a?.open_until) })).filter((a) => a.id && a.name),
    current: arr(x.current).map((c) => ({ id: id(c?.id), list_id: id(c?.list_id) || null, name: str(c?.name, 120), group: str(c?.group, 80), can_cancel: c?.can_cancel === true, cancel_until: date(c?.cancel_until) })).filter((c) => c.id && c.name),
    requests: arr(x.requests).map((r) => ({ id: id(r?.id), kind: r?.kind === 'cancel' ? 'cancel' : 'add', list_id: id(r?.list_id) || null, charge_id: id(r?.charge_id) || null, name: str(r?.name, 120), requested_date: date(r?.requested_date), decided: ['approved', 'declined'].includes(r?.decided) ? r.decided : null, decided_date: date(r?.decided_date) })).filter((r) => r.id),
  };
  return out.available.length || out.current.length || out.requests.length ? out : null;
}

// A family's pickup section as her device published it, field by field. Her
// standard location and the mile limits never pass. → object or null.
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function pickupOf(x) {
  if (!x || typeof x !== 'object') return null;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const id = (v) => (typeof v === 'string' && v.length <= 80 ? v : '');
  const date = (v) => (typeof v === 'string' && YMD_RE.test(v) ? v : null);
  const time = (v) => (typeof v === 'string' && HM_RE.test(v) ? v : '');
  const place = (l) => ({ label: str(l?.label, 80), address: str(l?.address, 300), notes: str(l?.notes, 500) });
  const miles = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null);
  const slots = (Array.isArray(x.slots) ? x.slots.slice(0, 200) : []).map((sl) => ({
    id: id(sl?.id), date: date(sl?.date), start_time: time(sl?.start_time), end_time: time(sl?.end_time), left: Math.max(0, Math.round(Number(sl?.left) || 0)), location: place(sl?.location),
  })).filter((sl) => sl.id && sl.date && sl.start_time);
  // Rules on her dates: a package needed first (and whether they have it), or her
  // standard boarding. Never a price.
  const dates = (Array.isArray(x.dates) ? x.dates.slice(0, 100) : []).map((d) => (d?.requires
    ? { date: date(d.date), requires: str(d.requires, 120), has_it: d.has_it === true }
    : { date: date(d?.date), boarding: d?.boarding === true })).filter((d) => d.date && (d.requires || d.boarding));
  const b = x.booked && typeof x.booked === 'object' ? x.booked : null;
  const booked = b ? {
    kind: b.kind === 'address' ? 'address' : 'slot', date: date(b.date), start_time: time(b.start_time), end_time: time(b.end_time),
    place: str(b.place, 80), address: str(b.address, 300), change_until: date(b.change_until),
  } : null;
  const requests = (Array.isArray(x.requests) ? x.requests.slice(0, 20) : []).map((r) => ({
    id: id(r?.id), kind: ['slot', 'address', 'cancel'].includes(r?.kind) ? r.kind : 'slot', date: date(r?.date), start_time: time(r?.start_time),
    place: str(r?.place, 80), address: str(r?.address, 300), miles: miles(r?.miles), far: r?.far === true,
    requested_date: date(r?.requested_date), decided: ['approved', 'declined'].includes(r?.decided) ? r.decided : null, decided_date: date(r?.decided_date),
  })).filter((r) => r.id);
  const out = {
    ready_from: date(x.ready_from), slots, dates, booked, requests,
    own_place: x.own_place === true ? true : x.own_place === false ? false : null, ask_home: x.ask_home === true,
  };
  return out.slots.length || out.booked || out.requests.length || out.own_place || out.ask_home ? out : null;
}

// Her application fee paid online (docs/KennelOS_Integrations_Plan.md §4): the
// Pay link her device published, a web address only, with this family's id added
// as Stripe's client_reference_id when it's a Stripe link (so her device can tell
// who paid). → { url, amount, instructions } or null.
const STRIPE_HOST = /(^|\.)stripe\.com$/;
export function feePayFor(projection, entryId) {
  const f = projection.kennel?.fee_pay;
  if (!f || typeof f.url !== 'string' || !REC_LINK.test(f.url)) return null;
  let url = f.url;
  try {
    const u = new URL(f.url);
    if (f.ref_param && STRIPE_HOST.test(u.hostname) && /^[A-Za-z0-9_-]{1,64}$/.test(entryId)) {
      u.searchParams.set('client_reference_id', entryId);
      url = u.href;
    }
  } catch { return null; }
  const amount = Number(f.amount);
  return {
    url,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    instructions: typeof f.instructions === 'string' ? f.instructions.slice(0, 1000) : '',
  };
}

// A fee_due as published, its Pay link kept only when it's a web address.
function feeDueOf(d) {
  if (!d || typeof d !== 'object') return null;
  const out = { ...d };
  if (typeof out.pay_url !== 'string' || !REC_LINK.test(out.pay_url)) { delete out.pay_url; delete out.pay_amount; }
  return out;
}

export function statusView(projection, entryId) {
  const e = projection.entries?.[entryId];
  if (!e) return null;
  const kennel = {
    name: projection.kennel?.name ?? '', time_zone: projection.kennel?.time_zone ?? null,
    public_id: projection.kennel?.public_id ?? null, can_message: Boolean(projection.kennel?.message_key),
  };
  const family = { name: e.name ?? '', status: e.status };
  // Her recommended products (Integrations plan §3): for every family, placed ones
  // too (they're who it's for).
  const recommended = recommendedOf(projection);
  if (recommended.length) kennel.recommended = recommended;
  // Their Companion link request: only with an open sale, placed families too.
  if (e.companion) family.companion = e.companion;
  // Their extras (Family Requests plan §3): only with an open sale, names and dates
  // only, never a price; her message and her own page's link above them.
  const extras = e.companion?.available ? extrasOf(e.extras) : null;
  if (extras) {
    family.extras = extras;
    kennel.extras_intro = typeof projection.kennel?.extras_intro === 'string' ? projection.kennel.extras_intro.slice(0, 2000) : '';
    const url = projection.kennel?.extras_info_url;
    if (typeof url === 'string' && /^https:\/\/[^\s"'<>]{1,500}$/i.test(url)) kennel.extras_info_url = url;
  }
  // Pickup (Family Requests plan §4): their times, their booking and requests;
  // only with an open sale.
  const pickup = e.companion?.available ? pickupOf(e.pickup) : null;
  if (pickup) family.pickup = pickup;
  // Backing out (Family Requests plan §7): only with an open sale; her reasons and
  // what she wants them to read first.
  if (e.companion?.available && e.back_out?.available) {
    const r = e.back_out.request;
    const ymd = (v) => (typeof v === 'string' && YMD_RE.test(v) ? v : null);
    family.back_out = { available: true, request: r && typeof r === 'object' ? {
      reason: typeof r.reason === 'string' ? r.reason.slice(0, 200) : '', requested_date: ymd(r.requested_date),
      decided: ['approved', 'declined'].includes(r.decided) ? r.decided : null, decided_date: ymd(r.decided_date),
      outcome: ['keep', 'move', 'refund'].includes(r.outcome) ? r.outcome : null,
    } : null };
    kennel.back_out_reasons = (Array.isArray(projection.kennel?.back_out_reasons) ? projection.kennel.back_out_reasons : []).slice(0, 20)
      .map((x) => ({ id: typeof x?.id === 'string' ? x.id.slice(0, 40) : '', label: typeof x?.label === 'string' ? x.label.slice(0, 80) : '' })).filter((x) => x.id && x.label);
    kennel.back_out_policy_text = typeof projection.kennel?.back_out_policy_text === 'string' ? projection.kennel.back_out_policy_text.slice(0, 2000) : '';
  }
  // Getting your pup home: only for a family with an open sale (their pup is picked).
  const transport = e.companion?.available ? transportOf(projection) : [];
  if (transport.length) kennel.transport = transport;
  if (!OPEN_STATUSES.includes(e.status)) return { kennel, as_of: projection.as_of ?? null, family, offers: [], litters: [], upcoming: [], public_list: [] };

  for (const k of ['applied_date', 'approved_date', 'position', 'prefs', 'paused_until', 'ready_from', 'listen', 'passes', 'fee_received_date', 'fee_paid_online', 'fee_due', 'requests', 'prepasses', 'place_hidden', 'pref_places', 'spent_litter_ids', 'whelp_notes', 'ready_check', 'private_name']) {
    family[k] = e[k] ?? null;
  }
  family.fee_due = feeDueOf(family.fee_due);
  // Asked for at the end of the application: their Pay button until they've paid.
  if (e.status === 'applied' && !e.fee_paid_online) {
    const pay = feePayFor(projection, entryId);
    if (pay) family.fee_pay = pay;
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
      // The parents as Coming up and Available Puppies show them (call names and
      // earned titles), so a family can tell the litters of their turn apart.
      breed: l.breed ?? null,
      sire: parentOf(l.sire),
      dam: parentOf(l.dam),
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
// With her fee asked for at the end of the application, its Pay button too.
export function pendingView(projection, row, entryId = null) {
  const pay = entryId ? feePayFor(projection, entryId) : null;
  return {
    kennel: { name: projection.kennel?.name ?? '', time_zone: projection.kennel?.time_zone ?? null },
    as_of: projection.as_of ?? null,
    family: { name: row.name ?? '', status: 'applied', ...(pay ? { fee_pay: pay } : {}) },
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

// The same family's records on this kennel's list (one per time on it: a family
// back for a second pup has two), by the email on them. Each status page lists them
// so the family always knows which record it's acting on, and can open the others.
// [] unless there are two or more. Never another family's: same email only.
const RECORD_STATES = ['applied', 'approved', 'waiting', 'paused', 'turn', 'picked', 'chose', 'home', 'declined', 'left', 'backed_out', 'removed', 'expired'];

export function sameFamilyIds(projection, entryId) {
  const email = normalizeEmail(projection.entries?.[entryId]?.email);
  if (!email) return [];
  return Object.entries(projection.entries || {}).filter(([, e]) => normalizeEmail(e?.email) === email).map(([id]) => id);
}

async function familyRecords(env, projection, publicId, entryId) {
  const ids = sameFamilyIds(projection, entryId);
  if (ids.length < 2) return [];
  const ymd = (v) => (typeof v === 'string' && YMD_RE.test(v) ? v : null);
  const out = [];
  for (const id of ids) {
    const e = projection.entries[id];
    const token = id === entryId ? null : await statusTokenOf(env, publicId, id);
    if (id !== entryId && !token) continue;
    const state = RECORD_STATES.includes(e.record?.state) ? e.record.state : null;
    out.push({ current: id === entryId, state, until: state === 'paused' ? ymd(e.record.until) : null, since: ymd(e.since),
      pup: typeof e.pup === 'string' ? e.pup.slice(0, 80) : null, ...(token ? { token } : {}) });
  }
  // Newest first: the time on the list they're most likely asking about.
  return out.sort((a, b) => String(b.since || '').localeCompare(String(a.since || '')));
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
      if (pending) view = pendingView(found.projection, pending, t.entry_id);
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
      // Their other times on this list, linked, so they know which one this is.
      const records = await familyRecords(env, found.projection, t.public_id, t.entry_id);
      if (records.length) view.records = records;
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
    const confirmed = await env.DB.batch([
      env.DB.prepare('DELETE FROM wl_family_codes WHERE public_id = ? AND code_hash = ?').bind(publicId, hash),
      // The code an applicant typed confirms their application: now it reaches her.
      env.DB.prepare(
        "UPDATE wl_inbox SET confirmed_at = ? WHERE id = ? AND public_id = ? AND kind = 'application' AND confirmed_at IS NULL",
      ).bind(now.toISOString(), row.entry_id, publicId),
      env.DB.prepare(
        'INSERT INTO wl_family_sessions (token_hash, program_id, public_id, entry_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(await sha256Hex(session), row.program_id, publicId, row.entry_id, now.toISOString(), new Date(now.getTime() + FAMILY_SESSION_MS).toISOString()),
    ]);
    // A newly confirmed application: her alert and digest (Notifications plan §1).
    if (confirmed[1]?.meta?.changes === 1) {
      const app = await env.DB.prepare('SELECT name FROM wl_inbox WHERE id = ?').bind(row.entry_id).first();
      const found = await projectionOf(env, publicId);
      await notifyEvent(env, { programId: row.program_id, kind: 'application', what: 'application', name: app?.name, kennel: found?.projection.kennel?.name, entryId: row.entry_id });
    }
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
