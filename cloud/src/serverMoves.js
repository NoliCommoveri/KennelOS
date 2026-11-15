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
import { notifyEvent } from './notify.js';

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

// n of her OPEN days after (n < 0: before) a date: a copy of the app's
// dateUtils.addOpenDays, with her weekdays from the projection (kennel.open_days,
// 0 = Sunday; null = every day) and her closed dates (kennel.closed_dates), so a
// turn offered here is due the day her device would make it.
export function addOpenDays(ymd, days, openDays, closedDates = []) {
  let open = new Set(Array.isArray(openDays) ? openDays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : []);
  if (!open.size) open = new Set([0, 1, 2, 3, 4, 5, 6]);
  const closed = new Set(Array.isArray(closedDates) ? closedDates.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) : []);
  const n = Math.round(Number(days) || 0);
  if (!n || (open.size === 7 && !closed.size)) return addDays(ymd, n);
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  let at = ymd;
  while (left > 0) {
    at = addDays(at, step);
    if (open.has(new Date(`${at}T00:00:00Z`).getUTCDay()) && !closed.has(at)) left--;
  }
  return at;
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
// A row marked `direct` is a side sale (Side Sale Spec §6), not a turn: it never
// blocks, closes or moves a turn; only the reminders (`includeDirect`) see it, so the
// family hears about their deposit exactly as after a turn pick.
export function openTurns(projection, { includeDirect = false } = {}) {
  const out = new Map();
  for (const [entryId, e] of Object.entries(projection.entries || {})) {
    for (const o of e.offers || []) {
      if (o.direct && !includeDirect) continue;
      const turnId = o.turn_id || o.id;
      if (!out.has(turnId)) out.set(turnId, { entryId, turnId, offers: [], respondBy: o.respond_by_date, offeredDate: o.offered_date, picked: null });
      const t = out.get(turnId);
      t.offers.push(o);
      if (o.picked_dog_id) t.picked = o.picked_dog_id;
    }
  }
  return [...out.values()];
}

// A turn with no pup left in it: no pick, and none of the pups its rows listed is
// still among its litter's available pups. Her device ends such a turn, never as a
// pass (waitlistActions.endEmptiedTurns), so the server neither closes it at its
// deadline nor reminds the family about it. A litter missing from the projection
// says nothing about its pups, so it never makes a turn read as empty.
export function turnIsEmpty(projection, t) {
  if (t.picked || !t.offers.length) return false;
  return t.offers.every((o) => {
    const l = projection.litters?.[o.litter_id];
    if (!l) return false;
    const available = new Set((l.pups || []).map((d) => d.id));
    return !(o.eligible_dog_ids || []).some((id) => available.has(id));
  });
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

// --- One run's writes land together, or not at all (review K4-1) ------------------
// A run works its moves out in memory and queues every write. They go in one
// db.batch (a transaction), each conditional on the projection still being at the
// version the run read, with the projection's own write last. So a second run on
// the same version, or her device publishing in between, makes every statement a
// no-op: nothing lands, no email goes, and the next run starts from what's there.
// Emails and her notifications go only after the batch lands.
const AT_VERSION = 'EXISTS (SELECT 1 FROM wl_projection WHERE public_id = ? AND version = ?)';

function queueEvent(run, { entryId, kind, payload, causeFromLastEvent = false }) {
  const { row, at } = run;
  // An offer the run's own close caused names that close's seq, which is the last
  // event this batch wrote for the kennel.
  const payloadSql = causeFromLastEvent
    ? "json_set(?, '$.cause_seq', (SELECT MAX(seq) FROM wl_events WHERE public_id = ?))"
    : '?';
  const payloadBinds = causeFromLastEvent ? [JSON.stringify(payload), row.public_id] : [JSON.stringify(payload)];
  run.writes.push(run.env.DB.prepare(
    `INSERT INTO wl_events (program_id, public_id, entry_id, kind, payload, based_on_version, made_by, created_at)
     SELECT ?, ?, ?, ?, ${payloadSql}, ?, 'server', ? WHERE ${AT_VERSION}`,
  ).bind(row.program_id, row.public_id, entryId, kind, ...payloadBinds, row.version, at, row.public_id, row.version));
  // A move she must follow up (contact the family offered; Notifications plan §1).
  run.after.push(() => notifyEvent(run.env, { programId: row.program_id, kind: 'server_move', what: kind, name: run.projection.entries?.[entryId]?.name, kennel: run.projection.kennel?.name, entryId }));
}

// One email from her published template, once (`id` decides "once"). Skipped
// quietly when email isn't set up, the family has no address, or she published
// no template for it. A send that throws is logged and recorded as failed, so it
// never takes the rest of the run with it.
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
  try {
    const token = await env.DB.prepare('SELECT token FROM wl_tokens WHERE public_id = ? AND entry_id = ?').bind(row.public_id, entryId).first();
    const link = token ? `${origin}/s/${token.token}` : `${origin}/list/${row.public_id}`;
    return await sendFamilyMessage(env, {
      id, programId: row.program_id, publicId: row.public_id, entryId, kind, to, subject, text: body,
      from: await familySender(env, { programId: row.program_id, publicId: row.public_id, kennelName }, now),
      footer: familyFooter(link, kennelName || 'the kennel'),
    }, now);
  } catch (err) {
    console.error('waitlist email failed', kind, String(err?.message ?? err));
    const at = now.toISOString();
    await env.DB.prepare(
      `INSERT INTO wl_messages (id, program_id, public_id, entry_id, kind, to_email, subject, body, send_after, status, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', NULL, ?) ON CONFLICT (id) DO UPDATE SET status = 'failed'`,
    ).bind(id, row.program_id, row.public_id, entryId, kind, to, subject, body, at, at).run().catch(() => {});
    return 'failed';
  }
}

const litterLabels = (projection, litterIds) => litterIds.map((id) => projection.litters?.[id]?.label || '').filter(Boolean);

// Offer the next family a turn, if one can be: the event is queued and the email
// waits for the batch. → true when a turn was given.
function offerNext(run, { skip, cause, causeSeq = null }) {
  const { projection, today } = run;
  const next = nextFromQueue(projection, { skip, held: run.held });
  if (!next) return false;
  const turn = {
    turn_id: crypto.randomUUID(), offered_date: today, respond_by_date: addOpenDays(today, next.respondDays, projection.kennel?.open_days, projection.kennel?.closed_dates),
    rows: next.rows.map((r) => ({ offer_id: crypto.randomUUID(), ...r })),
  };
  queueEvent(run, {
    entryId: next.entryId, kind: 'server_offer',
    payload: { ...turn, cause, ...(causeSeq != null ? { cause_seq: causeSeq } : {}) },
    causeFromLastEvent: causeSeq == null,
  });
  giveTurn(projection, next.entryId, turn);
  // The offer's email is keyed on its turn: only the run whose batch landed sends it.
  run.emails.push({
    id: `srv-offer-${turn.turn_id}`, entryId: next.entryId, kind: 'offer',
    facts: { litters: litterLabels(projection, turn.rows.map((r) => r.litter_id)), respondBy: turn.respond_by_date },
  });
  return true;
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
  const run = { env, row, projection, today, at, held, writes: [], after: [], emails: [] };

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
    if (offerNext(run, { skip: new Set([...busy]), cause: p.kind === 'pass' ? 'passed' : 'left', causeSeq: p.seq })) counts.offered++;
    // A pass with nobody to offer still changed the projection (the turn closed).
    run.changed = true;
  }

  // 2. Deadlines she lets the server close.
  for (const t of openTurns(projection)) {
    if (!t.respondBy || today <= t.respondBy || busy.has(t.entryId) || turnIsEmpty(projection, t)) continue;
    const trigger = t.picked ? 'no_deposit' : 'no_response';
    if (!autoOn(projection, trigger)) continue;
    queueEvent(run, {
      entryId: t.entryId, kind: 'server_close',
      payload: { turn_id: t.turnId, offer_ids: t.offers.map((o) => o.id), litter_ids: t.offers.map((o) => o.litter_id), respond_by_date: t.respondBy, trigger, picked_dog_id: t.picked },
    });
    run.writes.push(env.DB.prepare(`DELETE FROM wl_holds WHERE public_id = ? AND entry_id = ? AND ${AT_VERSION}`)
      .bind(row.public_id, t.entryId, row.public_id, row.version));
    if (t.picked) held.delete(t.picked);
    closeTurn(projection, t.entryId, t.turnId);
    run.changed = true;
    counts.closed++;
    run.emails.push({
      id: `srv-closed-${t.turnId}`, entryId: t.entryId, kind: 'deadline_passed',
      facts: { litters: litterLabels(projection, t.offers.map((o) => o.litter_id)), respondBy: t.respondBy },
    });
    // The offer's cause is this close, the batch's last event so far.
    if (offerNext(run, { skip: new Set([...busy, t.entryId]), cause: 'deadline' })) counts.offered++;
  }

  if (run.changed) {
    // The projection's write is last, so every statement before it still sees the
    // version this run read.
    run.writes.push(env.DB.prepare('UPDATE wl_projection SET body = ?, version = version + 1 WHERE public_id = ? AND version = ?')
      .bind(JSON.stringify(projection), row.public_id, row.version));
    const results = await env.DB.batch(run.writes);
    if (!(results.at(-1)?.meta?.changes > 0)) {
      // Another run, or her device, moved the kennel since this run read it.
      console.log('waitlist moves: kennel moved on meanwhile, nothing written');
      return { closed: 0, offered: 0, reminders: 0, lost: true };
    }
    for (const notify of run.after) {
      try { await notify(); } catch (err) { console.error('waitlist notify failed', String(err?.message ?? err)); }
    }
    for (const m of run.emails) await emailOnce(env, row, projection, { ...m, origin }, now);
  }

  // 3. Reminders, each once (its id). They write nothing but the message.
  if (projection.kennel?.reminders !== false && hour >= MORNING_HOUR) {
    for (const t of openTurns(projection, { includeDirect: true })) {
      if (busy.has(t.entryId) || !t.respondBy || !t.offeredDate || today > t.respondBy || turnIsEmpty(projection, t)) continue;
      const span = daysBetween(t.offeredDate, t.respondBy);
      const facts = { litters: litterLabels(projection, t.offers.map((o) => o.litter_id)), respondBy: t.respondBy };
      // The halfway one catches up on any later day; the last-day one is only true
      // on its day (a turn past its last day has ended).
      const when = today === t.respondBy ? 'last' : (span >= 2 && today >= addDays(t.offeredDate, Math.floor(span / 2)) ? 'half' : null);
      if (!when) continue;
      const r = await emailOnce(env, row, projection, { id: `srv-remind-${t.turnId}-${when}`, entryId: t.entryId, kind: 'offer_reminder', facts, origin }, now);
      if (r === 'sent') counts.reminders++;
    }
    for (const [entryId, e] of Object.entries(projection.entries || {})) {
      if (!OPEN.includes(e.status)) continue;
      const due = e.fee_due?.due_date;
      // From the open day before it's due (her closed days skipped) through the due
      // day itself, so a day whose runs were all missed doesn't lose it (K4-7).
      if (due && today >= addOpenDays(due, -1, projection.kennel?.open_days, projection.kennel?.closed_dates) && today <= due) {
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
const MOVES_PAGE = 500;

export async function runWaitlistMoves(env, { now = new Date() } = {}) {
  const origin = env.FAMILY_PAGES_ORIGIN || '';
  const totals = { kennels: 0, closed: 0, offered: 0, reminders: 0, failed: 0 };
  // The ids first, a page at a time, then one kennel's body at a time: a projection
  // is up to 1.5 MB, so reading them all at once fails as the kennels grow (K4-3).
  const ids = [];
  for (let after = ''; ;) {
    const { results } = await env.DB.prepare('SELECT public_id FROM wl_projection WHERE public_id > ? ORDER BY public_id LIMIT ?')
      .bind(after, MOVES_PAGE).all();
    ids.push(...results.map((r) => r.public_id));
    if (results.length < MOVES_PAGE) break;
    after = results.at(-1).public_id;
  }
  for (const publicId of ids) {
    totals.kennels++;
    try {
      const row = await env.DB.prepare('SELECT public_id, program_id, version, body FROM wl_projection WHERE public_id = ?').bind(publicId).first();
      if (!row) continue; // unpublished since the ids were read
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
