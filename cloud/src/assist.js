// Assisted setup and help from KennelOS support (docs/KennelOS_Assisted_Setup_Plan.md).
//
// Support (the operator) sets a user's program up on a device of their own, signed in to
// her account as a *helper* through a one-time assist link, and hands it over: her first
// sign-in takes it over, her devices get the vault key from the helper device by an
// automatic pairing, and the helper is signed out. Later she can press Get help, which
// lets support make a new assist link and come back in until either of them ends it.
//
// Two halves:
//   - the editions' routes (handleAssistApi, behind the maintenance gate, CORS):
//       POST /assist/redeem   {token, deviceId, deviceLabel}  no bearer: the link is the proof
//       GET  /assist/state                                      any session
//       POST /assist/claimed                                    owner: she has the vault key
//       POST /assist/help                                       owner: Get help
//       POST /assist/end                                        owner or helper: end help
//   - the manager app (handleManager, /manager/*, same-origin, cookie signed with
//     OPS_TOKEN like /ops): the operator's installable page, its JSON and its pushes.
//
// Nothing here stores or logs an email: support types it once, to make the account, and
// it's hashed like every sign-in. The manager shows the label support typed.
import { emailHash, normalizeEmail } from './auth.js';
import { removeAccount } from './program.js';
import { sendPush, validEndpoint, vapidConfig } from './notify.js';
import { hmacHex, randomHex, sha256Hex, timingSafeEqual } from './lib/crypto.js';
import { fail, json, readCookie, readJson } from './lib/http.js';
import { MANAGER_FILES } from './assistApp.js';

export const LINK_MS = 15 * 60 * 1000;
const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const label = (raw, max = 60) => String(raw ?? '').trim().slice(0, max);

// Words for each event, as the manager's list and its notifications show them.
export const EVENT_TEXT = {
  setup_started: 'Setup started',
  helper_in: 'Your device joined',
  claiming: 'signed in on her device: keep your setup device open to hand over her private records',
  claimed: 'took over her account. Your access ended',
  help_requested: 'asked for help',
  help_ended: 'Help ended',
  help_ended_by_her: 'ended your access',
  deleted: 'Account deleted',
};
const PUSHED = new Set(['claiming', 'claimed', 'help_requested', 'help_ended_by_her']);

// --- shared state helpers ------------------------------------------------------------

async function assistRow(env, programId) {
  return env.DB.prepare('SELECT program_id, label, state, created_at, updated_at FROM assist_programs WHERE program_id = ?').bind(programId).first();
}

async function setState(env, programId, state) {
  await env.DB.prepare('UPDATE assist_programs SET state = ?, updated_at = ? WHERE program_id = ?').bind(state, iso(), programId).run();
}

async function ownerOf(env, programId) {
  return env.DB.prepare('SELECT owner_user_id FROM programs WHERE id = ?').bind(programId).first('owner_user_id');
}

// Ends every helper session on the program; those devices hear 401 helper_removed and
// wipe their copy (cloudAssist.js on the client).
async function removeHelpers(env, programId) {
  const owner = await ownerOf(env, programId);
  if (!owner) return 0;
  const res = await env.DB.prepare(
    "UPDATE sessions SET revoked_at = ?, revoked_reason = 'helper_removed' WHERE user_id = ? AND role = 'helper' AND revoked_at IS NULL",
  ).bind(iso(), owner).run();
  return res.meta.changes ?? 0;
}

// Records an event and, for the ones support needs to hear about, pushes every installed
// manager app (payload-free: the app asks /manager/api/pending what it was).
export async function assistEvent(env, programId, kind) {
  await env.DB.prepare('INSERT INTO assist_events (program_id, kind, at) VALUES (?, ?, ?)').bind(programId, kind, iso()).run();
  if (!PUSHED.has(kind) || !vapidConfig(env).ready) return;
  const { results } = await env.DB.prepare('SELECT endpoint_hash, endpoint FROM assist_push').all();
  for (const sub of results) {
    const status = await sendPush(env, sub.endpoint);
    if (status === 404 || status === 410) await env.DB.prepare('DELETE FROM assist_push WHERE endpoint_hash = ?').bind(sub.endpoint_hash).run();
  }
}

// --- for auth.js and vault.js -----------------------------------------------------------

// Her sign-in on a program support set up: the manager hears it, and the app runs the
// takeover (her device gets the vault key from support's, then POST /assist/claimed).
export async function assistedSignIn(env, programId) {
  const row = await assistRow(env, programId);
  if (!row || row.state !== 'setup') return false;
  await assistEvent(env, programId, 'claiming');
  return true;
}

// May this device ask for the vault key with an automatic pairing? Her device while
// support's holds the setup, support's while she has asked for help.
export async function autoPairingAllowed(env, auth) {
  const row = await assistRow(env, auth.programId);
  if (!row) return false;
  return auth.role === 'helper' ? (row.state === 'requested' || row.state === 'helping') : row.state === 'setup';
}

// May this device see (and so approve) the other side's automatic pairings?
export async function autoApprovalAllowed(env, auth) {
  const row = await assistRow(env, auth.programId);
  if (!row) return false;
  return auth.role === 'helper' ? row.state === 'setup' : (row.state === 'requested' || row.state === 'helping');
}

// --- the editions' routes ------------------------------------------------------------

// POST /assist/redeem {token, deviceId, deviceLabel}: the device that opened an assist
// link becomes a helper on her account. The link works once.
export async function redeemLink(env, body) {
  const token = String(body.token ?? '');
  if (!TOKEN.test(token)) fail(400, 'bad_link');
  const tokenHash = await sha256Hex(token);
  const link = await env.DB.prepare('SELECT program_id, expires_at FROM assist_links WHERE token_hash = ?').bind(tokenHash).first();
  const burned = await env.DB.prepare('DELETE FROM assist_links WHERE token_hash = ?').bind(tokenHash).run();
  if (!link || burned.meta.changes !== 1 || link.expires_at <= iso()) fail(400, 'link_expired');
  const row = await assistRow(env, link.program_id);
  const owner = await ownerOf(env, link.program_id);
  if (!row || !owner) fail(400, 'link_expired');
  if (row.state === 'idle') fail(409, 'help_not_requested');

  const deviceId = UUID.test(String(body.deviceId ?? '')) ? String(body.deviceId).toLowerCase() : crypto.randomUUID();
  const deviceLabel = `KennelOS support${label(body.deviceLabel, 40) ? ` (${label(body.deviceLabel, 40)})` : ''}`;
  const session = randomHex(32);
  const now = iso();
  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, device_id, device_label, created_at, last_seen_at, expires_at, role)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'helper')`,
  ).bind(await sha256Hex(session), owner, deviceId, deviceLabel, now, now, iso(Date.now() + SESSION_MS)).run();
  if (row.state === 'requested') await setState(env, link.program_id, 'helping');
  await assistEvent(env, link.program_id, 'helper_in');
  return { token: session, programId: link.program_id, deviceId, role: 'helper', label: row.label, state: row.state === 'requested' ? 'helping' : row.state };
}

// GET /assist/state → { role, state, label }. state null: support has never helped.
export async function getAssistState(env, auth) {
  const row = await assistRow(env, auth.programId);
  return { role: auth.role, state: row?.state ?? null, label: row?.label ?? null };
}

// POST /assist/claimed: her device has the vault key, so support's is no longer needed.
export async function markClaimed(env, auth) {
  if (auth.role !== 'owner') fail(403, 'helper_not_allowed');
  const row = await assistRow(env, auth.programId);
  if (!row || row.state !== 'setup') return { ok: true, state: row?.state ?? null };
  await removeHelpers(env, auth.programId);
  await setState(env, auth.programId, 'idle');
  await assistEvent(env, auth.programId, 'claimed');
  return { ok: true, state: 'idle' };
}

// POST /assist/help: her Get help button. A program support never touched gets a row,
// named by the device that asked, so the manager can list it.
export async function requestHelp(env, auth) {
  if (auth.role !== 'owner') fail(403, 'helper_not_allowed');
  const row = await assistRow(env, auth.programId);
  if (row?.state === 'setup') fail(409, 'still_in_setup');
  if (row?.state === 'helping') return { ok: true, state: 'helping' };
  if (row) await setState(env, auth.programId, 'requested');
  else {
    await env.DB.prepare('INSERT INTO assist_programs (program_id, label, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(auth.programId, label(auth.deviceLabel) || 'A KennelOS user', 'requested', iso(), iso()).run();
  }
  await assistEvent(env, auth.programId, 'help_requested');
  return { ok: true, state: 'requested' };
}

// POST /assist/end: either side ends help. In setup, support handing back leaves the
// program waiting for her takeover.
export async function endHelp(env, auth) {
  const row = await assistRow(env, auth.programId);
  if (!row) return { ok: true, state: null };
  await removeHelpers(env, auth.programId);
  if (row.state !== 'setup') await setState(env, auth.programId, 'idle');
  await assistEvent(env, auth.programId, auth.role === 'owner' ? 'help_ended_by_her' : 'help_ended');
  return { ok: true, state: row.state === 'setup' ? 'setup' : 'idle' };
}

export async function handleAssistApi(env, request, url, auth) {
  const p = url.pathname;
  const m = request.method;
  if (p === '/assist/state' && m === 'GET') return getAssistState(env, auth);
  if (p === '/assist/claimed' && m === 'POST') return markClaimed(env, auth);
  if (p === '/assist/help' && m === 'POST') return requestHelp(env, auth);
  if (p === '/assist/end' && m === 'POST') return endHelp(env, auth);
  return null;
}

// --- the manager app (/manager/*) --------------------------------------------------------

const COOKIE = 'assist_session';
const COOKIE_SECONDS = 60 * 24 * 60 * 60; // an installed app: 60 days

async function mintCookie(secret) {
  const expires = Math.floor(Date.now() / 1000) + COOKIE_SECONDS;
  return `${expires}.${await hmacHex(secret, `assist:${expires}`)}`;
}

async function cookieValid(secret, value) {
  if (!value) return false;
  const [expiresRaw, sig] = value.split('.');
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
  return timingSafeEqual(sig ?? '', await hmacHex(secret, `assist:${expires}`));
}

const appUrl = (env) => String(env.PRO_APP_URL || 'https://pro.kennelos.app').replace(/\/+$/, '');

async function newLink(env, programId) {
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO assist_links (token_hash, program_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), programId, iso(Date.now() + LINK_MS)).run();
  return { link: `${appUrl(env)}/?assist=${token}`, expiresAt: iso(Date.now() + LINK_MS) };
}

// Every program support has set up or helped, newest activity first, with whether a
// helper device is signed in now and the last few events.
async function listPrograms(env) {
  const { results } = await env.DB.prepare(
    `SELECT a.program_id, a.label, a.state, a.created_at, a.updated_at,
            (SELECT COUNT(*) FROM sessions s JOIN programs p ON p.owner_user_id = s.user_id
              WHERE p.id = a.program_id AND s.role = 'helper' AND s.revoked_at IS NULL AND s.expires_at > ?) AS helpers,
            (SELECT MAX(s.last_seen_at) FROM sessions s JOIN programs p ON p.owner_user_id = s.user_id
              WHERE p.id = a.program_id AND s.role = 'owner') AS her_last_seen
       FROM assist_programs a ORDER BY a.updated_at DESC`,
  ).bind(iso()).all();
  const out = [];
  for (const r of results) {
    const { results: ev } = await env.DB.prepare('SELECT kind, at FROM assist_events WHERE program_id = ? ORDER BY seq DESC LIMIT 5').bind(r.program_id).all();
    out.push({
      programId: r.program_id, label: r.label, state: r.state, createdAt: r.created_at, updatedAt: r.updated_at,
      helperSignedIn: r.helpers > 0, herLastSeen: r.her_last_seen ?? null,
      events: ev.map((e) => ({ kind: e.kind, text: EVENT_TEXT[e.kind] ?? e.kind, at: e.at })),
    });
  }
  return { programs: out, push: vapidConfig(env).ready ? vapidConfig(env).publicKey : null };
}

// Start: make her account with the email support typed, and a link for support's device.
// Refused when the address already has an account (delete it first, here or on /ops).
async function startSetup(env, body) {
  const email = normalizeEmail(body.email);
  if (!email) fail(400, 'bad_email');
  const name = label(body.label);
  if (!name) fail(400, 'label_required');
  const eh = await emailHash(env, email);
  if (await env.DB.prepare('SELECT id FROM users WHERE email_hash = ?').bind(eh).first()) fail(409, 'account_exists');
  const userId = crypto.randomUUID();
  const programId = crypto.randomUUID();
  const now = iso();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, email_hash, created_at) VALUES (?, ?, ?)').bind(userId, eh, now),
    env.DB.prepare('INSERT INTO programs (id, owner_user_id, created_at) VALUES (?, ?, ?)').bind(programId, userId, now),
    env.DB.prepare('INSERT INTO assist_programs (program_id, label, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(programId, name, 'setup', now, now),
  ]);
  await assistEvent(env, programId, 'setup_started');
  return { programId, ...(await newLink(env, programId)) };
}

// A link for a program in setup (support's device was wiped, or a second device) or one
// whose user has asked for help.
async function linkFor(env, body) {
  const row = await assistRow(env, String(body.programId ?? ''));
  if (!row) fail(404, 'not_found');
  if (row.state === 'idle') fail(409, 'help_not_requested');
  return newLink(env, row.program_id);
}

async function endFor(env, body) {
  const row = await assistRow(env, String(body.programId ?? ''));
  if (!row) fail(404, 'not_found');
  await removeHelpers(env, row.program_id);
  if (row.state !== 'setup') await setState(env, row.program_id, 'idle');
  await assistEvent(env, row.program_id, 'help_ended');
  return { ok: true };
}

// Delete an account by email (step 1 of a fresh start), as /ops does. Its devices erase
// themselves when they next open unless `erase` is false.
async function deleteFor(env, body) {
  if (String(body.confirm ?? '').trim() !== 'DELETE') fail(400, 'confirm_required');
  const email = normalizeEmail(body.email);
  if (!email) fail(400, 'bad_email');
  const user = await env.DB.prepare('SELECT id FROM users WHERE email_hash = ?').bind(await emailHash(env, email)).first();
  if (!user) fail(404, 'no_account');
  const program = await env.DB.prepare('SELECT id FROM programs WHERE owner_user_id = ?').bind(user.id).first();
  const devices = await env.DB.prepare('SELECT COUNT(DISTINCT device_id) AS n FROM sessions WHERE user_id = ?').bind(user.id).first('n');
  await removeAccount(env, { userId: user.id, programId: program?.id ?? '' }, { erase: body.erase !== false });
  return { ok: true, devices };
}

async function subscribe(env, body) {
  if (!validEndpoint(body.endpoint)) fail(400, 'bad_endpoint');
  const eh = await sha256Hex(body.endpoint);
  const last = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM assist_events').first('n');
  await env.DB.prepare(
    'INSERT INTO assist_push (endpoint_hash, endpoint, last_shown_seq, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (endpoint_hash) DO NOTHING',
  ).bind(eh, body.endpoint, last, iso()).run();
  return { ok: true };
}

// What a push was about, for the manager's service worker. → { title, body, tag }
async function pending(env, body) {
  const sub = validEndpoint(body.endpoint)
    ? await env.DB.prepare('SELECT endpoint_hash, last_shown_seq FROM assist_push WHERE endpoint_hash = ?').bind(await sha256Hex(body.endpoint)).first()
    : null;
  const since = sub?.last_shown_seq ?? 0;
  const { results } = await env.DB.prepare(
    `SELECT e.seq, e.kind, e.program_id, a.label FROM assist_events e LEFT JOIN assist_programs a ON a.program_id = e.program_id
      WHERE e.seq > ? ORDER BY e.seq`,
  ).bind(since).all();
  const items = results.filter((e) => PUSHED.has(e.kind));
  if (sub && results.length) await env.DB.prepare('UPDATE assist_push SET last_shown_seq = ? WHERE endpoint_hash = ?').bind(results[results.length - 1].seq, sub.endpoint_hash).run();
  if (!items.length) return { title: 'KennelOS Assist', body: 'Nothing new.', tag: 'assist' };
  const last = items[items.length - 1];
  const who = last.label || 'A user';
  return {
    title: items.length > 1 ? `${items.length} updates` : who,
    body: items.length > 1 ? items.map((i) => `${i.label || 'A user'} ${EVENT_TEXT[i.kind]}`).join('\n') : `${who} ${EVENT_TEXT[last.kind]}`,
    tag: `assist-${last.program_id}`,
  };
}

function staticFile(name) {
  const f = MANAGER_FILES[name];
  if (!f) return null;
  const body = f.base64 ? Uint8Array.from(atob(f.body), (c) => c.charCodeAt(0)) : f.body;
  return new Response(body, {
    headers: {
      'content-type': f.type,
      'cache-control': name === 'sw.js' || name === '' ? 'no-cache' : 'public, max-age=3600',
      ...(name === 'sw.js' ? { 'service-worker-allowed': '/manager/' } : {}),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...(name === '' ? { 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" } : {}),
    },
  });
}

const sameSite = { 'cache-control': 'no-store' };

export async function handleManager(request, env) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/^\/manager\/?/, '');
  if (!env.OPS_TOKEN) return new Response('Set OPS_TOKEN first (see /ops).', { status: 503 });

  if (request.method === 'GET' && !p.startsWith('api/')) {
    return staticFile(p === 'index.html' ? '' : p) ?? new Response('Not found', { status: 404 });
  }

  try {
    if (p === 'api/login' && request.method === 'POST') {
      const body = await readJson(request);
      if (!timingSafeEqual(String(body.token ?? ''), env.OPS_TOKEN)) fail(401, 'wrong_token');
      return json({ ok: true }, 200, {
        ...sameSite,
        'set-cookie': `${COOKIE}=${await mintCookie(env.OPS_TOKEN)}; Path=/manager; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_SECONDS}`,
      });
    }
    if (!(await cookieValid(env.OPS_TOKEN, readCookie(request, COOKIE)))) fail(401, 'signed_out');
    // A cookie only rides same-site requests (Lax), and every write is a JSON POST,
    // which a form on another site can't send; check Origin as well.
    const origin = request.headers.get('origin');
    if (request.method === 'POST' && origin && origin !== url.origin) fail(403, 'bad_origin');

    const body = request.method === 'POST' ? await readJson(request) : {};
    let out;
    if (p === 'api/logout' && request.method === 'POST') {
      return json({ ok: true }, 200, { ...sameSite, 'set-cookie': `${COOKIE}=; Path=/manager; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
    } else if (p === 'api/programs' && request.method === 'GET') out = await listPrograms(env);
    else if (p === 'api/start' && request.method === 'POST') out = await startSetup(env, body);
    else if (p === 'api/link' && request.method === 'POST') out = await linkFor(env, body);
    else if (p === 'api/end' && request.method === 'POST') out = await endFor(env, body);
    else if (p === 'api/delete' && request.method === 'POST') out = await deleteFor(env, body);
    else if (p === 'api/push' && request.method === 'POST') out = await subscribe(env, body);
    else if (p === 'api/pending' && request.method === 'POST') out = await pending(env, body);
    else fail(404, 'not_found');
    return json(out, 200, sameSite);
  } catch (err) {
    if (err?.status && err?.code) return json({ error: err.code, ...(err.extra ?? {}) }, err.status, sameSite);
    return json({ error: 'internal' }, 500, sameSite);
  }
}
