// Shared by the family pages (list.js, status.js). Plain browser modules: no
// framework, no outside requests, nothing stored in the browser.
//
// The labels below are copied from shared/data/vocab.js (these pages aren't part
// of the app and can't import it); tests/familyPages.test.js in the repo root
// fails if they drift.
export const SEX_LABEL = { any: 'Either', male: 'Male', female: 'Female' };
export const READY_LABEL = { asap: 'ASAP', '1_month': '1 month', '3_months': '3 months', '6_plus_months': '6+ months' };
export const PURPOSE_LABEL = {
  pet: 'Pet / companion', performance: 'Performance sports (agility, obedience…)', show: 'Show', breeding: 'Breeding', co_own: 'Co-own',
};
// "Pet / companion, Show": a family's purposes in words, in vocab order; 'Any' when none.
export function purposesText(v) {
  const picked = Array.isArray(v) ? v : [];
  return Object.keys(PURPOSE_LABEL).filter((k) => picked.includes(k)).map((k) => PURPOSE_LABEL[k]).join(', ') || 'Any';
}
export const CREDIT_LABEL = {
  credited_to_purchase: 'Credited to purchase price',
  non_refundable: 'Non-refundable',
  refundable: 'Refundable',
};

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// YYYY-MM-DD → "Oct 10, 2026" (a calendar date: no time zone shift).
export function fmtDate(ymd, { weekday = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd ?? ''))) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', ...(weekday ? { weekday: 'long' } : {}),
  });
}

// An offer's deadline (Spec §6.5: end of day in the kennel's time zone):
// "Deadline: Saturday, 10/10/2026 @11:59 pm CDT". The zone's short name is the
// one in effect that day; without a zone, none is shown.
// "10/26/2026".
export function fmtShortDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd ?? ''))) return '';
  const [y, m, d] = ymd.split('-');
  return `${m}/${d}/${y}`;
}

export function deadlineText(ymd, timeZone = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd ?? ''))) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' });
  let zone = '';
  if (timeZone) {
    try {
      zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
        .formatToParts(new Date(Date.UTC(y, m - 1, d, 17))).find((p) => p.type === 'timeZoneName')?.value || '';
    } catch { zone = ''; }
  }
  return `Deadline: ${day}, ${fmtShortDate(ymd)} @11:59\u00a0pm${zone ? `\u00a0${zone}` : ''}`;
}

// "Thornfield Kennels'" / "Juniper's": the kennel's name as an owner.
export function possessive(name) {
  const n = String(name ?? '').trim();
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
}

export function money(amount) {
  const n = Number(amount);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '';
}

// GET / POST same-origin JSON. → { ok, status, body }. Never throws.
export async function fetchJson(path, { method = 'GET', json } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: json ? { 'content-type': 'application/json' } : {},
      body: json ? JSON.stringify(json) : undefined,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

// Why a page couldn't load, in words.
export function loadError(res, { notFound }) {
  if (res.status === 404) return notFound;
  if (res.status === 503) return 'This page is down for a few minutes of maintenance. Please try again shortly.';
  if (res.status === 429) return 'Too many requests from your connection. Please try again in a little while.';
  if (res.status === 0) return 'You seem to be offline. Check your connection and try again.';
  return 'Something went wrong loading this page. Please try again.';
}

// Does a public-list row match what was typed? A number (with or without #) is a
// position, exactly; anything else is looked for, case- and accent-insensitive,
// in the name and the date added.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
export function rowMatches(row, query) {
  const q = fold(query);
  if (!q) return true;
  if (/^#?\d+$/.test(q)) return String(row.position) === q.replace(/^#/, '');
  return fold(row.name).includes(q) || fold(fmtDate(row.added)).includes(q);
}

// The public list as a table body, filtered by `query`. `mine` is the position to
// highlight (the family's own row on their status page), or null.
// A family holding a turn (`deciding`, masked by the server) shows as "Currently
// deciding", highlighted, with their sex preference and date added (decided 2026-10-10).
export function publicListHtml(rows, query = '', mine = null) {
  const shown = rows.filter((r) => rowMatches(r, query));
  if (!rows.length) return '<p class="muted">No families to show right now.</p>';
  if (!shown.length) return `<p class="muted">No one on the list matches "${esc(query)}".</p>`;
  const rowClass = (r) => [r.position === mine && 'mine', r.deciding && 'deciding'].filter(Boolean).join(' ');
  const body = shown.map((r) => `<tr${rowClass(r) ? ` class="${rowClass(r)}"` : ''}>
      <td class="num">#${esc(r.position)}</td>
      <td>${r.deciding ? `<em>${esc(r.name)}</em>` : esc(r.name)}${r.position === mine ? ' <span class="badge">You</span>' : ''}</td>
      <td>${esc(SEX_LABEL[r.pref_sex] || 'Either')}</td>
      <td class="small">${esc(fmtDate(r.added))}</td></tr>`).join('');
  const gaps = rows.some((r, i) => r.position !== i + 1);
  return `<table class="list"><thead><tr><th>#</th><th>Name</th><th>Wants</th><th>Added</th></tr></thead><tbody>${body}</tbody></table>
    ${gaps ? '<p class="small muted">Note: in special circumstances, some applicant names may not be displayed above. Their place is being held, but they are not currently eligible for available pups.</p>' : ''}`;
}

// A pairing or litter before picks open (Waitlist Spec §16.4): its parents with
// their titles, and her dates. Used by the public list and the status page.
const parentText = (d) => [d?.name || '', ...(d?.titles || [])].filter(Boolean).join(' ');

// "Dam: Juniper · Sire: Ash CH": a litter's parents, the same on every card.
export function parentsLine(dam, sire) {
  if (!dam?.name && !sire?.name) return '';
  return `<div class="small">Dam: ${esc(parentText(dam))} · Sire: ${esc(parentText(sire))}</div>`;
}

// One litter (or pairing) the same way everywhere a family sees one (decided
// 2026-10-08): the breed, its name, its parents, its dates, then any extra lines.
export function litterHtml({ breed = null, name = '', dam = null, sire = null, when = '', extra = '' }) {
  return `${breed ? `<div class="small muted">${esc(breed)}</div>` : ''}<div><strong>${esc(name)}</strong></div>
    ${parentsLine(dam, sire)}${when ? `<div class="small muted">${esc(when)}</div>` : ''}${extra}`;
}

// A Coming up item's dates: "Born 09/20/2026 · Planned offering 11/01/2026",
// "Expected 01/10/2027", or "Planned pairing".
export function upcomingWhen(u) {
  if (u.kind === 'early_litter') {
    return [u.whelp_date ? `Born ${fmtShortDate(u.whelp_date)}` : 'Born', u.picks_expected_date ? `Planned offering ${fmtShortDate(u.picks_expected_date)}` : ''].filter(Boolean).join(' · ');
  }
  if (u.kind === 'planned_pairing') return 'Planned pairing';
  return u.expected_whelp_date ? `Expected ${fmtShortDate(u.expected_whelp_date)}` : 'Expected';
}

export function upcomingItemHtml(u, extra = '') {
  return litterHtml({ breed: u.breed, name: u.label, dam: u.dam, sire: u.sire, when: upcomingWhen(u), extra });
}

// "Born 09/01/2026 · Ready 10/27/2026" (Available Puppies).
export function litterDates(l) {
  const bits = [];
  if (l.whelp_date) bits.push(`Born ${fmtShortDate(l.whelp_date)}`);
  else if (l.status === 'expected') bits.push('Expected');
  if (l.status === 'ready') bits.push('Ready to go home');
  else if (l.ready_date) bits.push(`Ready ${fmtShortDate(l.ready_date)}`);
  return bits.join(' · ');
}

// "2 females and 1 male remaining".
export function pupsRemaining(l) {
  const f = Number(l.pups_female) || 0;
  const m = Number(l.pups_male) || 0;
  const other = Math.max((Number(l.pups_available) || 0) - f - m, 0);
  const part = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const bits = [f && part(f, 'female', 'females'), m && part(m, 'male', 'males'), other && part(other, 'puppy', 'puppies')].filter(Boolean);
  if (!bits.length) return 'No puppies remaining';
  return `${bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0]} remaining`;
}

// One litter with open picks (Available Puppies), the same on the public list and a
// family's page; `extra` adds lines under it.
export function availableItemHtml(l, extra = '') {
  return litterHtml({ breed: l.breed, name: l.nickname || l.label, dam: l.dam, sire: l.sire, when: litterDates(l), extra: `<div class="small">${esc(pupsRemaining(l))}</div>${extra}` });
}

export function upcomingListHtml(rows) {
  if (!rows.length) return '';
  return `<ul class="plain">${rows.map((u) => `<li>${upcomingItemHtml(u)}</li>`).join('')}</ul>
    <p class="small muted">Plans can change.</p>`;
}
