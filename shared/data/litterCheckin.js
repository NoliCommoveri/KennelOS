// litterCheckin.js — Kels's "Check in on a litter" task, the data half (pure).
// Which litters she can check on, how old a litter is and where its pups stand,
// what Kels should bring up about it (move it to Weaning, open picks, mark it
// sold…), and how this week's weights compare with the last ones. No reads or
// writes here: assets/litterCheckinUI.js loads the records, asks her, and writes
// through the repos.
//
// The three litter-lifecycle rules (sold / reopen / close) are the same ones
// Today's nudges use (data/nudges.js imports them from here), so the two never
// disagree about when a litter is ready to move on.
import { LITTER_STATUS, DISPOSITION, descriptor } from './vocab.js';
import { addDaysToYMD } from './dateUtils.js';
import { depositsDueLitters } from './waitlistRules.js';

// A litter moves to Weaning from 4 weeks; Ready from its estimated ready date
// (or 8 weeks, when that's blank).
export const WEANING_AFTER_DAYS = 28;
export const READY_AFTER_DAYS = 56;
// Days ahead the "push the deposit date back" question suggests.
export const DEPOSIT_RESCHEDULE_DAYS = 7;

// The care Kels can record for the litter: event types from vocab, the field that
// names it (and becomes the event's title), and how he asks.
export const CARE_KINDS = Object.freeze({
  medication: { eventType: 'medication', nameKey: 'drug', label: 'Medication', ask: 'What medication are they on?', reply: 'Record medication' },
  preventative: { eventType: 'preventative', nameKey: 'product', label: 'Deworming or preventative', ask: 'What did they get?', reply: 'Record deworming or a preventative' },
  vaccination: { eventType: 'vaccination', nameKey: 'vaccine', label: 'Shots', ask: 'Which vaccine?', reply: 'Record shots' },
  vet_visit: { eventType: 'vet_visit', nameKey: 'reason', label: 'Vet visit', ask: 'Tell me about the vet visit', reply: 'Record a vet visit', optionalName: true }
});

const DAY_MS = 86400000;
export function daysBetween(fromYMD, toYMD) {
  if (!fromYMD || !toYMD) return null;
  return Math.round((Date.parse(`${toYMD}T00:00:00Z`) - Date.parse(`${fromYMD}T00:00:00Z`)) / DAY_MS);
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "5 days old", "3 weeks old", "3 weeks 2 days old"; from 16 weeks, months
// ("7 months old"). Null before birth.
export function ageText(days) {
  if (days == null || days < 0) return null;
  if (days < 14) return `${plural(days, 'day')} old`;
  if (days >= 112) return `${plural(Math.floor(days / 30.44), 'month')} old`;
  const w = Math.floor(days / 7);
  const d = days % 7;
  return `${plural(w, 'week')}${d ? ` ${plural(d, 'day')}` : ''} old`;
}

export const ageDays = (litter, today) => (litter?.whelp_date ? daysBetween(litter.whelp_date, today) : null);

// The litter's name: its nickname, else "Dam × Sire" (as the litter page titles it).
export function litterLabel(l, dogsById) {
  if (l.nickname) return l.nickname;
  const n = (id) => dogsById.get(id)?.call_name || dogsById.get(id)?.registered_name || '?';
  return `${n(l.dam_id)} × ${n(l.sire_id)}`;
}

// Litters she can check on: every one that isn't closed or archived. Litters
// with pups at home first (newest born first), then expected, then sold.
const ORDER = { whelped: 0, weaning: 0, ready: 0, expected: 1, sold: 2 };
export function checkinLitters(litters) {
  return litters
    .filter((l) => !l.is_archived && l.status !== 'closed' && l.status in ORDER)
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]
      || (b.whelp_date || '').localeCompare(a.whelp_date || '')
      || (b.created_at || '').localeCompare(a.created_at || ''));
}

// The litter's pups that are still part of it: not archived (Lite's departed
// pups are) and not deceased. `home`: of those, the puppies still with her (not
// grown into an adult record, not gone home on a delivered sale) — the ones she
// weighs and treats.
export function rosterOf(litterId, dogs) {
  return dogs.filter((d) => d.litter_id === litterId && !d.is_archived && d.status !== 'deceased');
}
export function homePups(roster, sales = []) {
  const gone = new Set(sales.filter((s) => !s.is_archived && s.status === 'delivered').map((s) => s.dog_id));
  return roster.filter((d) => d.status === 'puppy' && !gone.has(d.id));
}

// "6 puppies: 3 available, 2 undecided, 1 keeping." in DISPOSITION order.
export function dispositionSummary(roster) {
  if (!roster.length) return 'No puppies on the litter yet.';
  const counts = new Map();
  for (const p of roster) counts.set(p.disposition || 'none', (counts.get(p.disposition || 'none') || 0) + 1);
  const parts = DISPOSITION.filter((v) => counts.get(v.value)).map((v) => `${counts.get(v.value)} ${v.label.toLowerCase()}`);
  if (counts.get('none')) parts.push(`${counts.get('none')} grown`);
  return `${plural(roster.length, 'puppy', 'puppies')}: ${parts.join(', ')}.`;
}

// --- Litter lifecycle rules (shared with Today's nudges) --------------------------

// `pups` here: the roster without deceased pups (a deceased pup's disposition is
// null, which would otherwise hold these up forever).
// Every pup resolved to placed/keeping/health hold, with at least one placed.
export const litterSoldDue = (l, pups) => l.status === 'ready' && pups.length > 0
  && pups.every((p) => ['placed', 'keeping', 'health_hold'].includes(p.disposition))
  && pups.some((p) => p.disposition === 'placed');
// A puppy came back available on a sold or closed litter.
export const litterReopenDue = (l, pups) => (l.status === 'sold' || l.status === 'closed') && pups.some((p) => p.disposition === 'available');
// Sold, nothing available, and every placed pup has a delivered sale.
export function litterCloseDue(l, pups, salesByDog) {
  if (l.status !== 'sold' || pups.some((p) => p.disposition === 'available')) return false;
  const placed = pups.filter((p) => p.disposition === 'placed');
  return placed.length > 0 && placed.every((p) => (salesByDog.get(p.id) || []).some((s) => s.status === 'delivered'));
}

// --- What Kels brings up ------------------------------------------------------------

// The decisions waiting on this litter, most pressing first. Each is
// { id, status? } — the UI words them. `waitlistOn`: the edition has the
// waitlist AND the litter's kennel has families on its list.
export function checkinSuggestions({ litter, roster, sales = [], today, waitlistOn = false }) {
  const out = [];
  const age = ageDays(litter, today);
  const salesByDog = new Map();
  for (const s of sales) {
    if (!salesByDog.has(s.dog_id)) salesByDog.set(s.dog_id, []);
    salesByDog.get(s.dog_id).push(s);
  }
  if (waitlistOn && depositsDueLitters([litter], roster, sales, today).length) out.push({ id: 'open-picks' });
  if (litter.status === 'whelped' && age != null && age >= WEANING_AFTER_DAYS) out.push({ id: 'status', status: 'weaning' });
  if (litter.status === 'weaning' && readyDue(litter, today)) out.push({ id: 'status', status: 'ready' });
  if (litterSoldDue(litter, roster)) out.push({ id: 'status', status: 'sold' });
  if (litterReopenDue(litter, roster)) out.push({ id: 'status', status: 'ready', reopen: true });
  if (litterCloseDue(litter, roster, salesByDog)) out.push({ id: 'status', status: 'closed' });
  return out;
}

export function readyDue(litter, today) {
  const ready = litter.estimated_ready_date || (litter.whelp_date ? addDaysToYMD(litter.whelp_date, READY_AFTER_DAYS) : null);
  return Boolean(ready) && ready <= today;
}

// The statuses she can move a born litter to from the check-in.
export const statusChoices = () => LITTER_STATUS.filter((s) => s.value !== 'expected');
export const statusLabel = (v) => descriptor(LITTER_STATUS, v).label;

// --- Weights ------------------------------------------------------------------------

// A weight_check event's weight in ounces (null when it has none).
export function eventOz(e) {
  const lbs = Number(e?.details?.weight_lbs) || 0;
  const oz = Number(e?.details?.weight_oz) || 0;
  return lbs || oz ? Math.round((lbs * 16 + oz) * 10) / 10 : null;
}

// Each pup's most recent weight: Map dogId → { date, oz }. `events`: weight_check
// events for these pups (any order; archived ones are skipped).
export function lastWeights(events) {
  const out = new Map();
  for (const e of events) {
    if (e.is_archived || e.event_type !== 'weight_check' || e.subject_type !== 'dog') continue;
    const oz = eventOz(e);
    if (oz == null) continue;
    const cur = out.get(e.subject_id);
    if (!cur || e.event_date > cur.date || (e.event_date === cur.date && (e.created_at || '') > (cur.created_at || ''))) {
      out.set(e.subject_id, { date: e.event_date, oz, created_at: e.created_at });
    }
  }
  return out;
}

// "2 lb 3.5 oz" / "14 oz".
export function fmtOz(total) {
  if (total == null) return '';
  const lbs = Math.floor(total / 16);
  const oz = Math.round((total - lbs * 16) * 10) / 10;
  return lbs ? `${lbs} lb${oz ? ` ${oz} oz` : ''}` : `${oz} oz`;
}

// What she typed for one pup (pounds and ounces, either blank) → total ounces,
// null when both are blank, or { error }.
export function parseWeight(lbsText, ozText) {
  const l = String(lbsText ?? '').trim();
  const o = String(ozText ?? '').trim();
  if (!l && !o) return null;
  const lbs = l ? Number(l) : 0;
  const oz = o ? Number(o) : 0;
  if (!Number.isFinite(lbs) || !Number.isFinite(oz) || lbs < 0 || oz < 0) return { error: 'Weights are numbers, like 2 lb 3.5 oz.' };
  const total = Math.round((lbs * 16 + oz) * 10) / 10;
  if (total === 0) return { error: 'A weight can\'t be zero.' };
  return total;
}

// The weight_check details for a total in ounces (as the birth weight is stored).
export const weightDetails = (total, timeOfDay = '') => ({
  weight_lbs: Math.floor(total / 16),
  weight_oz: Math.round((total - Math.floor(total / 16) * 16) * 10) / 10,
  ...(timeOfDay ? { time_of_day: timeOfDay } : {})
});

// How this weigh-in compares with each pup's last one. `rows`: [{ pup, oz, prev }]
// where prev is { date, oz } or null. → { gained, lost, same, first, top }:
// `lost` and `same` are the pups to keep an eye on (a pup should gain every week);
// `top` the biggest gain.
export function weightReport(rows) {
  const out = { gained: [], lost: [], same: [], first: [], top: null };
  for (const r of rows) {
    if (!r.prev) { out.first.push(r); continue; }
    const diff = Math.round((r.oz - r.prev.oz) * 10) / 10;
    const row = { ...r, diff };
    if (diff > 0) out.gained.push(row);
    else if (diff < 0) out.lost.push(row);
    else out.same.push(row);
    if (diff > 0 && (!out.top || diff > out.top.diff)) out.top = row;
  }
  return out;
}

// When the litter was last weighed (the newest weight among these pups), or null.
export function lastWeighedDate(weights, pups) {
  let best = null;
  for (const p of pups) {
    const w = weights.get(p.id);
    if (w && (!best || w.date > best)) best = w.date;
  }
  return best;
}

// --- Care -----------------------------------------------------------------------------

// One care event per chosen pup. `form`: { date, endDate?, details } with the
// type's details already read. The title is the named thing (the drug, the
// vaccine…), else the type's label.
export function careEvents(kind, pupIds, form) {
  const k = CARE_KINDS[kind];
  const name = String(form.details?.[k.nameKey] ?? '').trim();
  const details = Object.fromEntries(Object.entries(form.details || {}).filter(([, v]) => String(v ?? '').trim() !== '').map(([key, v]) => [key, String(v).trim()]));
  return pupIds.map((id) => ({
    subject_type: 'dog', subject_id: id, event_type: k.eventType,
    event_date: form.date, ...(form.endDate ? { event_end_date: form.endDate } : {}),
    title: name || k.label, details
  }));
}

// What's wrong with a care form, or ''.
export function careProblem(kind, pupIds, form) {
  const k = CARE_KINDS[kind];
  if (!pupIds.length) return 'Pick at least one puppy.';
  if (!form.date) return 'When was it? Pick a date.';
  if (form.endDate && form.endDate < form.date) return 'The end date is before the start.';
  if (!k.optionalName && !String(form.details?.[k.nameKey] ?? '').trim()) return `${k.ask.replace(/\?$/, '')}? Fill that in first.`;
  return '';
}

// Default for "push the deposit date back".
export const rescheduleDefault = (today) => addDaysToYMD(today, DEPOSIT_RESCHEDULE_DAYS);
