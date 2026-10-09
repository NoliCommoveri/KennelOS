// What a family does on their status page (docs/KennelOS_Waitlist_W2_Plan.md §6,
// step 5): accept a pup (a pick), pass, still interested, request a pause, leave
// the list, change listen-only, ask to change a matching answer, ask for their
// Companion link (a family with an open sale, placed or not), and send her a
// message.
//
// Every one needs a FAMILY SESSION (See Your Details: a code typed in that
// browser), so a forwarded status link can look but not act. The server checks
// each action against what her device published, records it as an event her
// backing device applies, and decides nothing itself: the only thing it holds on
// its own is a picked pup (wl_holds), so a second family can't pick the same one
// before her device catches up. Messages are sealed in the family's browser to
// her form key and go to the encrypted inbox, never into an event.
//
// Never logged: a session, a token, a message, a request body (plan §6.4).
import { limitBucket } from './ratelimit.js';
import { sha256Hex } from './lib/crypto.js';
import { STATUS_TOKEN } from './waitlist.js';
import { fail, json, readJson } from './lib/http.js';

export const ACTION_LIMITS = { perHourPerSession: 60, messagesPerHourPerSession: 10, messageBytes: 32 * 1024, noteChars: 500, maxPauseDays: 731 };
export const FAMILY_ACTIONS = ['pick', 'pass', 'still_interested', 'pause_request', 'leave', 'listen', 'pref_change', 'prepass', 'unprepass', 'ready', 'companion_request'];

const OPEN_STATUSES = ['applied', 'approved', 'active'];
// Copies of the app's vocab (shared/data/vocab.js); tests/familyPages.test.js in
// the repo root fails if they drift.
const SEX = ['any', 'male', 'female'];
const PURPOSE = ['pet', 'performance', 'show', 'breeding', 'co_own'];
const READY = ['asap', '1_month', '3_months', '6_plus_months'];
export const ACTION_VOCAB = Object.freeze({ SEX, PURPOSE, READY });
const SESSION = /^[0-9a-f]{64}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const todayUtc = (now) => now.toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// The family a request acts for: a live session, on the page whose link it came
// from (a browser signed in as one family can't act on another family's page).
async function familyFor(env, body) {
  if (typeof body.session !== 'string' || !SESSION.test(body.session)) fail(401, 'signed_out');
  const s = await env.DB.prepare('SELECT program_id, public_id, entry_id, expires_at FROM wl_family_sessions WHERE token_hash = ?')
    .bind(await sha256Hex(body.session)).first();
  if (!s || s.expires_at <= new Date().toISOString()) fail(401, 'signed_out');
  if (typeof body.status_token !== 'string' || !STATUS_TOKEN.test(body.status_token)) fail(400, 'bad_request');
  const t = await env.DB.prepare('SELECT public_id, entry_id FROM wl_tokens WHERE token = ?').bind(body.status_token).first();
  if (!t || t.public_id !== s.public_id || t.entry_id !== s.entry_id) fail(403, 'other_family');
  const row = await env.DB.prepare('SELECT version, body FROM wl_projection WHERE public_id = ?').bind(s.public_id).first();
  if (!row) fail(404, 'not_found');
  const projection = JSON.parse(row.body);
  const entry = projection.entries?.[s.entry_id];
  if (!entry) fail(409, 'not_yet'); // a new application her device hasn't taken in
  return { ...s, version: row.version, projection, entry, eventsThrough: Number(projection.events_through) || 0 };
}

// The family's actions her device hasn't applied yet: events after the last one
// her backing device says it applied (`events_through` in its projection).
// → [{ kind, payload, at }]
export async function pendingFor(env, publicId, entryId, eventsThrough = 0) {
  const { results } = await env.DB.prepare(
    `SELECT kind, payload, created_at FROM wl_events
      WHERE public_id = ? AND entry_id = ? AND made_by = 'family' AND seq > ? ORDER BY seq`,
  ).bind(publicId, entryId, Number(eventsThrough) || 0).all();
  return results.map((r) => ({ kind: r.kind, payload: JSON.parse(r.payload), at: r.created_at }));
}

// Pups another family has picked and her device hasn't settled yet.
export async function heldByOthers(env, publicId, entryId) {
  const { results } = await env.DB.prepare('SELECT dog_id FROM wl_holds WHERE public_id = ? AND entry_id != ?').bind(publicId, entryId).all();
  return new Set(results.map((r) => r.dog_id));
}

const cleanNote = (v) => String(v ?? '').trim().slice(0, ACTION_LIMITS.noteChars);
const REASON_TEXT_MAX = 200;

// A pass needs one of her reasons (Waitlist Spec §16.5), from the list she
// published; "other" needs a few words. → { id, text }
function checkReason(body, projection) {
  const list = Array.isArray(projection.kennel?.pass_reasons) ? projection.kennel.pass_reasons : [];
  const id = String(body.reason_id ?? '');
  if (!list.some((r) => r && r.id === id)) fail(400, 'reason_required');
  const text = String(body.reason_text ?? '').trim().slice(0, REASON_TEXT_MAX);
  if (id === 'other' && !text) fail(400, 'reason_required');
  return { id, text: id === 'other' ? text : '' };
}

// A litter (or an upcoming pairing) a family may say "Not this litter" to: one she
// published to them. → { litter_id } | { pairing_id }
// "Not this litter" works on what the family's page shows them: a litter with
// open picks, or a pairing or early litter she shows on family pages (§16.4).
function checkTarget(body, projection) {
  const shown = (projection.upcoming || []).filter((u) => u && u.family === true);
  if (typeof body.litter_id === 'string' && body.litter_id && projection.litters?.[body.litter_id]
    && (projection.litters[body.litter_id].picks_open || shown.some((u) => u.litter_id === body.litter_id))) return { litter_id: body.litter_id };
  if (typeof body.pairing_id === 'string' && body.pairing_id
    && shown.some((u) => u.id === body.pairing_id && u.kind !== 'early_litter')) return { pairing_id: body.pairing_id };
  return fail(409, 'not_listed');
}

// Pure: is `body` a valid `action` for this family, given what she published?
// → the event payload, or throws (via fail) with the reason.
export function checkAction(action, body, { entry, projection, pending, now = new Date() }) {
  if (!FAMILY_ACTIONS.includes(action)) fail(400, 'bad_action');
  const already = (kind, test = () => true) => pending.some((p) => p.kind === kind && test(p.payload));
  // Their Companion link (Spec §8.3): only while her device says they have an open
  // sale, whatever their list status (a placed family too), and one at a time. Her
  // device builds and sends the link; the server only passes the request on.
  if (action === 'companion_request') {
    if (!entry.companion?.available) fail(409, 'no_sale');
    if ((entry.companion.request && !entry.companion.request.decided) || already('companion_request')) fail(409, 'already_requested');
    return { note: cleanNote(body.note) };
  }
  if (!OPEN_STATUSES.includes(entry.status)) fail(409, 'not_on_list');
  // A family's turn (Waitlist Spec §16.1) is one offer row per litter sharing a
  // turn_id (an offer from before turns is its own turn). They pick ONE pup from
  // any litter of it, or pass on ALL of it.
  const offers = entry.offers || [];
  const offer = (id) => offers.find((o) => o.id === id) || fail(409, 'offer_closed');
  const turnOf = (o) => o.turn_id || o.id;
  const rowsOf = (turnId) => offers.filter((o) => turnOf(o) === turnId);
  const inTurn = (turnId) => (p) => p.turn_id === turnId || rowsOf(turnId).some((o) => o.id === p.offer_id);
  const settled = (turnId) => {
    if (rowsOf(turnId).some((o) => o.picked_dog_id) || already('pick', inTurn(turnId))) fail(409, 'already_picked');
    if (already('pass', inTurn(turnId))) fail(409, 'already_passed');
  };
  switch (action) {
    case 'pick': {
      const o = offer(body.offer_id);
      settled(turnOf(o));
      if (!(o.eligible_dog_ids || []).includes(body.dog_id)) fail(409, 'pup_not_offered');
      return { offer_id: o.id, turn_id: turnOf(o), litter_id: o.litter_id, dog_id: body.dog_id };
    }
    case 'pass': {
      // By turn (`turn_id`), or by any one of its rows (`offer_id`, as before turns).
      const turnId = typeof body.turn_id === 'string' && offers.some((o) => turnOf(o) === body.turn_id) ? body.turn_id
        : turnOf(offer(body.offer_id));
      settled(turnId);
      const rows = rowsOf(turnId);
      return { turn_id: turnId, offer_ids: rows.map((o) => o.id), litter_ids: rows.map((o) => o.litter_id), reason: checkReason(body, projection) };
    }
    case 'prepass': {
      // "Not this litter" (Spec §16.2): pending until their turn comes; never on a
      // litter in their open turn (they pass on the turn instead).
      if (entry.status !== 'active') fail(409, 'not_on_list');
      const target = checkTarget(body, projection);
      if (target.litter_id && offers.some((o) => o.litter_id === target.litter_id)) fail(409, 'in_your_turn');
      return { ...target, reason: checkReason(body, projection) };
    }
    case 'unprepass': {
      const target = body.litter_id ? { litter_id: String(body.litter_id) } : body.pairing_id ? { pairing_id: String(body.pairing_id) } : fail(400, 'bad_request');
      const key = (x) => (target.litter_id ? x.litter_id === target.litter_id : x.pairing_id === target.pairing_id);
      if (!(entry.prepasses || []).some(key) && !already('prepass', key)) fail(409, 'not_prepassed');
      return target;
    }
    case 'still_interested':
      return {};
    case 'pause_request': {
      if (entry.status !== 'active') fail(409, 'not_on_list');
      const until = String(body.until ?? '');
      const today = todayUtc(now);
      if (!YMD.test(until) || until <= today || until > addDays(today, ACTION_LIMITS.maxPauseDays)) fail(400, 'bad_date');
      return { until, note: cleanNote(body.note) };
    }
    case 'leave':
      return { note: cleanNote(body.note) };
    case 'ready': {
      // "Ready now?" (Spec §16.7): only while her device asks it, once.
      if (entry.status !== 'active' || !entry.ready_check || entry.ready_check.answer) fail(409, 'not_asked');
      if (already('ready', () => true)) fail(409, 'already_answered');
      if (body.answer === 'yes') return { answer: 'yes' };
      if (body.answer !== 'no') fail(400, 'bad_request');
      const until = String(body.until ?? '');
      const today = todayUtc(now);
      if (!YMD.test(until) || until <= today || until > addDays(today, ACTION_LIMITS.maxPauseDays)) fail(400, 'bad_date');
      const reason = cleanNote(body.reason);
      if (!reason) fail(400, 'reason_required');
      return { answer: 'no', until, reason };
    }
    case 'listen': {
      if (entry.status !== 'active') fail(409, 'not_on_list');
      const mode = ['all', 'selected', 'except'].includes(body.mode) ? body.mode : fail(400, 'bad_request');
      const parents = projection.kennel?.parents || { sires: [], dams: [] };
      const pick = (ids, list) => {
        const allowed = new Set((list || []).map((d) => d.id));
        const out = [...new Set(Array.isArray(ids) ? ids : [])];
        if (out.some((id) => !allowed.has(id))) fail(400, 'bad_parent');
        return out;
      };
      const sireIds = mode !== 'all' ? pick(body.sire_ids, parents.sires) : [];
      const damIds = mode !== 'all' ? pick(body.dam_ids, parents.dams) : [];
      if (mode !== 'all' && !sireIds.length && !damIds.length) fail(400, 'no_parents');
      return { mode, sire_ids: sireIds, dam_ids: damIds };
    }
    case 'pref_change': {
      const c = body.changes && typeof body.changes === 'object' && !Array.isArray(body.changes) ? body.changes : fail(400, 'bad_request');
      const breeds = projection.kennel?.breeds || [];
      const out = {};
      if (c.pref_sex !== undefined) out.pref_sex = SEX.includes(c.pref_sex) ? c.pref_sex : fail(400, 'bad_value');
      if (c.pref_breed !== undefined) out.pref_breed = c.pref_breed === '' || breeds.includes(c.pref_breed) ? c.pref_breed : fail(400, 'bad_value');
      if (c.pref_purposes !== undefined) {
        if (!Array.isArray(c.pref_purposes) || c.pref_purposes.some((p) => !PURPOSE.includes(p))) fail(400, 'bad_value');
        out.pref_purposes = PURPOSE.filter((p) => c.pref_purposes.includes(p));
      }
      if (c.ready_timing !== undefined) out.ready_timing = READY.includes(c.ready_timing) ? c.ready_timing : fail(400, 'bad_value');
      if (c.pref_colors !== undefined) {
        if (!Array.isArray(c.pref_colors)) fail(400, 'bad_value');
        out.pref_colors = c.pref_colors.slice(0, 10).map((x) => String(x).trim().slice(0, 60)).filter(Boolean);
      }
      if (!Object.keys(out).length) fail(400, 'nothing_to_change');
      return { changes: out, note: cleanNote(body.note) };
    }
    default:
      return fail(400, 'bad_action');
  }
}

// POST /f/act {session, status_token, action, …}
export async function handleAct(env, request) {
  const body = await readJson(request, 8 * 1024);
  const fam = await familyFor(env, body);
  await limitBucket(env, `wl-act:${fam.entry_id}`, ACTION_LIMITS.perHourPerSession);
  const pending = await pendingFor(env, fam.public_id, fam.entry_id, fam.eventsThrough);
  const action = String(body.action ?? '');
  const payload = checkAction(action, body, { entry: fam.entry, projection: fam.projection, pending });
  const at = new Date().toISOString();
  const statements = [];
  if (action === 'pick') {
    const held = await env.DB.prepare('SELECT entry_id FROM wl_holds WHERE public_id = ? AND dog_id = ?').bind(fam.public_id, payload.dog_id).first();
    if (held && held.entry_id !== fam.entry_id) fail(409, 'pup_taken');
    statements.push(env.DB.prepare(
      `INSERT INTO wl_holds (public_id, dog_id, program_id, entry_id, offer_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (public_id, dog_id) DO NOTHING`,
    ).bind(fam.public_id, payload.dog_id, fam.program_id, fam.entry_id, payload.offer_id, at));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO wl_events (program_id, public_id, entry_id, kind, payload, based_on_version, made_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'family', ?)`,
  ).bind(fam.program_id, fam.public_id, fam.entry_id, action, JSON.stringify(payload), fam.version, at));
  await env.DB.batch(statements);
  return json({ ok: true, pending: await pendingFor(env, fam.public_id, fam.entry_id, fam.eventsThrough) });
}

// POST /f/message {session, status_token, key_id, sealed}: sealed in the family's
// browser to her current form key; lands in the encrypted inbox, already
// confirmed (the session is the proof).
export async function handleMessage(env, request) {
  const body = await readJson(request, ACTION_LIMITS.messageBytes + 4 * 1024);
  const fam = await familyFor(env, body);
  await limitBucket(env, `wl-msg:${fam.entry_id}`, ACTION_LIMITS.messagesPerHourPerSession);
  const key = fam.projection.kennel?.message_key;
  if (!key) fail(409, 'messages_off');
  if (body.key_id !== key.key_id) fail(409, 'form_changed');
  if (typeof body.sealed !== 'string' || !body.sealed || body.sealed.length > ACTION_LIMITS.messageBytes) fail(400, 'bad_message');
  const at = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO wl_inbox (id, program_id, public_id, kind, entry_id, name, email, key_id, blob, created_at, acked_at, confirmed_at)
     VALUES (?, ?, ?, 'message', ?, ?, NULL, ?, ?, ?, NULL, ?)`,
  ).bind(crypto.randomUUID(), fam.program_id, fam.public_id, fam.entry_id, fam.entry.name ?? '', key.key_id, body.sealed, at, at).run();
  return json({ ok: true });
}
