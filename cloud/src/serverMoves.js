// The server's own moves on a published waitlist (docs/KennelOS_Waitlist_W2_Plan.md
// §6, step 7): what happens while her phone is off.
//
// Her device stays the source of truth. The server only acts where she said it may:
//  - a turn whose respond-by date has passed (the end of that day in the kennel's
//    time zone) is closed as no response, ONLY when she ticked that moment in
//    `auto_offer_on` (`no_response`, or `no_deposit` when the family had picked);
//  - after such a close, or a family's own Pass / Leave the list when she ticked
//    `passed` / `left`, the next family in her published `turn_queue` is offered a
//    turn (one turn at a time, as on her device);
//  - reminders (when `kennel.reminders` is on): halfway through a turn and on the
//    morning of its last day; the day before an unpaid fee is due; and "Ready now?"
//    when her device has asked it. Each one is sent once.
// Every move is an event (`made_by: 'server'`) her device applies on its next sync
// (data/waitlistEvents.js), and the stored projection is updated so the status
// pages show it now. Emails use the templates her device published (her wording);
// the server only fills in the placeholders.
//
// Runs from the hourly cron (index.js), and for one kennel right after a family
// passes or leaves (familyActions.js). Never logged: a projection, an email, a name.
import { sendFamilyMessage, familySender, familyFooter, mailMode } from './mail.js';

const OPEN = ['applied', 'approved', 'active'];
// Reminders and the "Ready now?" email go out from this hour, kennel time.
export const MORNING_HOUR = 8;

// --- Dates in the kennel's time zone (pure) ------------------------------------------

// → { date: 'YYYY-MM-DD', hour } for `now` in `timeZone` (UTC when it isn't one).
export function localNow(now, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return localNow(now, 'UTC');
  }
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

export function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// --- Her templates (pure) -----------------------------------------------------------
// The same filling as her device's data/waitlistEmails.js (a test pins the two).

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function longDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : String(ymd ?? '');
}
const joinNames = (xs) => (xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function fillTemplate(template, { kennelName, family, litters = [], respondBy = null, payBy = null }) {
  const values = {
    'kennel name': kennelName || 'Our kennel',
    family: family || 'there',
    litter: joinNames(litters.filter(Boolean)) || 'our litter',
    'respond by': respondBy ? longDate(respondBy) : 'the date on your status page',
    position: 'on the list',
    'pay by': payBy ? ` by ${longDate(payBy)}` : '',
    request: '',
  };
  const fill = (text) => String(text ?? '').replace(/\[([^\]\n]{1,40})\]/g, (whole, name) => {
    const k = name.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : whole;
  });
  return {
    subject: fill(template.subject).replace(/\s+/g, ' ').trim().slice(0, 200),
    body: fill(template.body).replace(/[ \t]+\n/g, '\n').trim().slice(0, 8000),
  };
}

// --- The projection, as the server reads and changes it (pure) -----------------------

// Every open turn in a projection: [{ entryId, turnId, offers, respondBy, offeredDate, picked }].
export function openTurns(projection) {
  const out = new Map();
  for (const [entryId, e] of Object.entries(projection.entries || {})) {
    for (const o of e.offers || []) {
      const turnId = o.turn_id || o.id;
      if (!out.has(turnId)) out.set(turnId, { entryId, turnId, offers: [], respondBy: o.respond_by_date, offeredDate: o.offered_date, picked: null });
      const t = out.get(turnId);
      t.offers.push(o);
      if (o.picked_dog_id) t.picked = o.picked_dog_id;
    }
  }
  return [...out.values()];
}

// Close one family's turn in the projection (their status page stops offering it).
export function closeTurn(projection, entryId, turnId) {
  const e = projection.entries?.[entryId];
  if (!e) return projection;
  e.offers = (e.offers || []).filter((o) => (o.turn_id || o.id) !== turnId);
  // No turn left: their number shows again (§16.9), and their public row is theirs.
  if (!e.offers.length && e.place_hidden?.reason === 'turn') e.place_hidden = null;
  for (const l of Object.values(projection.litters || {})) if (l.open_offer_entry_id === entryId) l.open_offer_entry_id = null;
  return projection;
}

// The next family in her published order who can be offered a turn now, or null.
// `skip`: entry ids not to offer (the family whose turn just closed, anyone with a
// pending pass or leave); `held`: pups another family picked. A family holding a
// turn means nobody is offered (one turn at a time).
export function nextFromQueue(projection, { skip = new Set(), held = new Set() } = {}) {
  if (openTurns(projection).length) return null;
  const litters = projection.litters || {};
  for (const q of projection.turn_queue || []) {
    const e = projection.entries?.[q.entry_id];
    if (!e || e.status !== 'active' || skip.has(q.entry_id) || (e.offers || []).length) continue;
    const rows = [];
    for (const [litterId, dogIds] of Object.entries(q.litters || {})) {
      const l = litters[litterId];
      if (!l || !l.picks_open) continue;
      const available = new Set((l.pups || []).map((d) => d.id));
      const ids = (dogIds || []).filter((id) => available.has(id) && !held.has(id));
      if (ids.length) rows.push({ litter_id: litterId, dog_ids: ids });
    }
    if (rows.length) return { entryId: q.entry_id, rows, respondDays: Number(q.respond_days) || Number(projection.kennel?.respond_days) || 3 };
  }
  return null;
}

// Give a family a turn in the projection.
export function giveTurn(projection, entryId, turn) {
  const e = projection.entries[entryId];
  e.offers = turn.rows.map((r) => ({
    id: r.offer_id, turn_id: turn.turn_id, litter_id: r.litter_id, offered_date: turn.offered_date,
    respond_by_date: turn.respond_by_date, eligible_dog_ids: [...r.dog_ids], picked_dog_id: null,
  }));
  // During their turn a family sees "It's your turn!" for their number (§16.9), and
  // the public list shows their row as "Currently deciding" (familyPages.listView,
  // by their position), as her device publishes it.
  e.place_hidden = { reason: 'turn' };
  for (const r of turn.rows) if (projection.litters?.[r.litter_id]) projection.litters[r.litter_id].open_offer_entry_id = entryId;
  projection.turn_queue = (projection.turn_queue || []).filter((q) => q.entry_id !== entryId);
  return projection;
}

// --- Running it ----------------------------------------------------------------------

const autoOn = (projection, trigger) => (projection.kennel?.auto_offer_on || []).includes(trigger);

async function insertEvent(env, row, { entryId, kind, payload }, at) {
  const res = await env.DB.prepare(
    `INSERT INTO wl_events (program_id, public_id, entry_id, kind, payload, based_on_version, made_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'server', ?)`,
  ).bind(row.program_id, row.public_id, entryId, kind, JSON.stringify(payload), row.version, at).run();
  return res.meta?.last_row_id ?? null;
}

// One email from her published template, once (`id` decides "once"). Skipped
// quietly when email isn't set up, the family has no address, or she published
// no template for it.
async function emailOnce(env, row, projection, { id, entryId, kind, facts, origin }, now) {
  if (!mailMode(env)) return 'off';
  const e = projection.entries?.[entryId];
  const template = projection.kennel?.email_templates?.[kind];
  const to = typeof e?.email === 'string' ? e.email.trim() : '';
  if (!template || !to) return 'skipped';
  const before = await env.DB.prepare('SELECT status FROM wl_messages WHERE id = ?').bind(id).first();
  if (before && before.status === 'sent') return 'had';
  const kennelName = projection.kennel?.name || '';
  const { subject, body } = fillTemplate(template, { kennelName, family: e.name, ...facts });
  if (!subject || !body) return 'skipped';
  const token = await env.DB.prepare('SELECT token FROM wl_tokens WHERE public_id = ? AND entry_id = ?').bind(row.public_id, entryId).first();
  const link = token ? `${origin}/s/${token.token}` : `${origin}/list/${row.public_id}`;
  return sendFamilyMessage(env, {
    id, programId: row.program_id, publicId: row.public_id, entryId, kind, to, subject, text: body,
    from: await familySender(env, { programId: row.program_id, publicId: row.public_id, kennelName }, now),
    footer: familyFooter(link, kennelName || 'the kennel'),
  }, now);
}

const litterLabels = (projection, litterIds) => litterIds.map((id) => projection.litters?.[id]?.label || '').filter(Boolean);

// Offer the next family a turn, if one can be. → the event seq, or null.
async function offerNext(env, row, projection, { today, skip, held, cause, causeSeq, origin, at, now }) {
  const next = nextFromQueue(projection, { skip, held });
  if (!next) return null;
  const turn = {
    turn_id: crypto.randomUUID(), offered_date: today, respond_by_date: addDays(today, next.respondDays),
    rows: next.rows.map((r) => ({ offer_id: crypto.randomUUID(), ...r })),
  };
  const seq = await insertEvent(env, row, { entryId: next.entryId, kind: 'server_offer', payload: { ...turn, cause, cause_seq: causeSeq } }, at);
  giveTurn(projection, next.entryId, turn);
  await emailOnce(env, row, projection, {
    id: `srv-offer-${turn.turn_id}`, entryId: next.entryId, kind: 'offer', origin,
    facts: { litters: litterLabels(projection, turn.rows.map((r) => r.litter_id)), respondBy: turn.respond_by_date },
  }, now);
  return seq;
}

// Everything due for one published kennel now. → { closed, offered, reminders }
export async function runKennel(env, row, { now = new Date(), origin } = {}) {
  const projection = JSON.parse(row.body);
  const counts = { closed: 0, offered: 0, reminders: 0 };
  const { date: today, hour } = localNow(now, projection.kennel?.time_zone);
  const at = now.toISOString();
  const through = Number(projection.events_through) || 0;
  const pending = (await env.DB.prepare(
    `SELECT seq, entry_id, kind, payload FROM wl_events WHERE public_id = ? AND made_by = 'family' AND seq > ? ORDER BY seq`,
  ).bind(row.public_id, through).all()).results;
  const handled = new Set((await env.DB.prepare(
    `SELECT json_extract(payload, '$.cause_seq') AS c FROM wl_events
      WHERE public_id = ? AND made_by = 'server' AND kind = 'server_offer' AND seq > ?`,
  ).bind(row.public_id, through).all()).results.map((r) => r.c));
  // Families waiting on her device for something they did: never moved around by the server.
  const busy = new Set(pending.filter((p) => ['pick', 'pass', 'leave'].includes(p.kind)).map((p) => p.entry_id));
  const held = new Set((await env.DB.prepare('SELECT dog_id FROM wl_holds WHERE public_id = ?').bind(row.public_id).all()).results.map((r) => r.dog_id));
  let changed = false;

  // 1. A family passed or left on their page, and she ticked that moment.
  for (const p of pending) {
    if (!['pass', 'leave'].includes(p.kind) || handled.has(p.seq)) continue;
    if (!autoOn(projection, p.kind === 'pass' ? 'passed' : 'left')) continue;
    const mine = openTurns(projection).filter((t) => t.entryId === p.entry_id);
    let payload = {};
    try { payload = JSON.parse(p.payload); } catch { /* none */ }
    const closing = p.kind === 'pass' ? mine.filter((t) => t.turnId === payload.turn_id || t.offers.some((o) => o.id === payload.offer_id)) : mine;
    if (!closing.length) continue; // nothing of theirs is open: nothing moves on
    for (const t of closing) closeTurn(projection, p.entry_id, t.turnId);
    changed = true;
    const seq = await offerNext(env, row, projection, { today, skip: new Set([...busy]), held, cause: p.kind === 'pass' ? 'passed' : 'left', causeSeq: p.seq, origin, at, now });
    if (seq) counts.offered++;
  }

  // 2. Deadlines she lets the server close.
  for (const t of openTurns(projection)) {
    if (!t.respondBy || today <= t.respondBy || busy.has(t.entryId)) continue;
    const trigger = t.picked ? 'no_deposit' : 'no_response';
    if (!autoOn(projection, trigger)) continue;
    const seq = await insertEvent(env, row, {
      entryId: t.entryId, kind: 'server_close',
      payload: { turn_id: t.turnId, offer_ids: t.offers.map((o) => o.id), litter_ids: t.offers.map((o) => o.litter_id), respond_by_date: t.respondBy, trigger, picked_dog_id: t.picked },
    }, at);
    await env.DB.prepare('DELETE FROM wl_holds WHERE public_id = ? AND entry_id = ?').bind(row.public_id, t.entryId).run();
    if (t.picked) held.delete(t.picked);
    closeTurn(projection, t.entryId, t.turnId);
    changed = true;
    counts.closed++;
    await emailOnce(env, row, projection, {
      id: `srv-closed-${t.turnId}`, entryId: t.entryId, kind: 'deadline_passed', origin,
      facts: { litters: litterLabels(projection, t.offers.map((o) => o.litter_id)), respondBy: t.respondBy },
    }, now);
    const offered = await offerNext(env, row, projection, { today, skip: new Set([...busy, t.entryId]), held, cause: 'deadline', causeSeq: seq, origin, at, now });
    if (offered) counts.offered++;
  }

  // 3. Reminders, each once.
  if (projection.kennel?.reminders !== false && hour >= MORNING_HOUR) {
    for (const t of openTurns(projection)) {
      if (busy.has(t.entryId) || !t.respondBy || !t.offeredDate || today > t.respondBy) continue;
      const span = daysBetween(t.offeredDate, t.respondBy);
      const facts = { litters: litterLabels(projection, t.offers.map((o) => o.litter_id)), respondBy: t.respondBy };
      const when = today === t.respondBy ? 'last' : (span >= 2 && today >= addDays(t.offeredDate, Math.floor(span / 2)) ? 'half' : null);
      if (!when) continue;
      const r = await emailOnce(env, row, projection, { id: `srv-remind-${t.turnId}-${when}`, entryId: t.entryId, kind: 'offer_reminder', facts, origin }, now);
      if (r === 'sent') counts.reminders++;
    }
    for (const [entryId, e] of Object.entries(projection.entries || {})) {
      if (!OPEN.includes(e.status)) continue;
      const due = e.fee_due?.due_date;
      if (due && today === addDays(due, -1)) {
        const r = await emailOnce(env, row, projection, { id: `srv-fee-${entryId}-${due}`, entryId, kind: 'fee_reminder', facts: { payBy: due }, origin }, now);
        if (r === 'sent') counts.reminders++;
      }
      const rc = e.ready_check;
      if (rc && rc.asked && !rc.answer && today >= rc.asked) {
        const r = await emailOnce(env, row, projection, { id: `srv-ready-${entryId}-${rc.asked}`, entryId, kind: 'ready_check', facts: {}, origin }, now);
        if (r === 'sent') counts.reminders++;
      }
    }
  }

  if (changed) {
    // Only if her device hasn't published since this run read the row.
    await env.DB.prepare('UPDATE wl_projection SET body = ?, version = version + 1 WHERE public_id = ? AND version = ?')
      .bind(JSON.stringify(projection), row.public_id, row.version).run();
  }
  return counts;
}

// One kennel now (after a family's pass or leave). Errors stay here: the family's
// action is already recorded, and the hourly run tries again.
export async function runKennelNow(env, publicId, { now = new Date(), origin } = {}) {
  try {
    const row = await env.DB.prepare('SELECT public_id, program_id, version, body FROM wl_projection WHERE public_id = ?').bind(publicId).first();
    if (row) return await runKennel(env, row, { now, origin });
  } catch (err) {
    console.error('waitlist moves failed', String(err?.message ?? err));
  }
  return null;
}

// The hourly run: every published kennel. → totals.
export async function runWaitlistMoves(env, { now = new Date() } = {}) {
  const origin = env.FAMILY_PAGES_ORIGIN || '';
  const totals = { kennels: 0, closed: 0, offered: 0, reminders: 0, failed: 0 };
  const { results } = await env.DB.prepare('SELECT public_id, program_id, version, body FROM wl_projection').all();
  for (const row of results) {
    totals.kennels++;
    try {
      const c = await runKennel(env, row, { now, origin });
      totals.closed += c.closed;
      totals.offered += c.offered;
      totals.reminders += c.reminders;
    } catch (err) {
      totals.failed++;
      console.error('waitlist moves failed', String(err?.message ?? err));
    }
  }
  return totals;
}
