// Shared by the family pages (list.js, status.js). Plain browser modules: no
// framework, no outside requests, nothing stored in the browser.
//
// The labels below are copied from shared/data/vocab.js (these pages aren't part
// of the app and can't import it); tests/familyPages.test.js in the repo root
// fails if they drift.
export const SEX_LABEL = { any: 'Either', male: 'Male', female: 'Female' };
export const READY_LABEL = { asap: 'ASAP', '1_month': '1 month', '3_months': '3 months', '6_plus_months': '6+ months' };
export const PLACEMENT_LABEL = { pet: 'Pet', show: 'Show', breeding_rights: 'Breeding rights', co_own: 'Co-own' };
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
export function publicListHtml(rows, query = '', mine = null) {
  const shown = rows.filter((r) => rowMatches(r, query));
  if (!rows.length) return '<p class="muted">Nobody is on the list yet.</p>';
  if (!shown.length) return `<p class="muted">No one on the list matches "${esc(query)}".</p>`;
  const body = shown.map((r) => `<tr${r.position === mine ? ' class="mine"' : ''}>
      <td class="num">#${esc(r.position)}</td>
      <td>${esc(r.name)}${r.position === mine ? ' <span class="badge">You</span>' : ''}</td>
      <td>${esc(SEX_LABEL[r.pref_sex] || 'Either')}</td>
      <td class="small">${esc(fmtDate(r.added))}</td></tr>`).join('');
  const gaps = rows.some((r, i) => r.position !== i + 1);
  return `<table class="list"><thead><tr><th>#</th><th>Name</th><th>Wants</th><th>Added</th></tr></thead><tbody>${body}</tbody></table>
    ${gaps ? '<p class="small muted">Note: in special circumstances, some applicant names may not be displayed above. Their place is being held, but they are not currently eligible for available pups.</p>' : ''}`;
}

// A pairing or litter before picks open (Waitlist Spec §16.4): its parents with
// their titles, and her dates. Used by the public list and the status page.
const parentText = (d) => [d?.name || '', ...(d?.titles || [])].filter(Boolean).join(' ');
export function upcomingDetails(u) {
  const when = u.kind === 'early_litter'
    ? [u.whelp_date ? `Born ${fmtDate(u.whelp_date)}` : 'Born', u.picks_expected_date ? `picks expected to open ${fmtDate(u.picks_expected_date)}` : ''].filter(Boolean).join(' · ')
    : u.kind === 'planned_pairing' ? 'Planned pairing'
      : u.expected_whelp_date ? `Expected about ${fmtDate(u.expected_whelp_date)}` : 'Expected';
  return `<div class="small">Dam: ${esc(parentText(u.dam))} · Sire: ${esc(parentText(u.sire))}</div><div class="small muted">${esc(when)}</div>`;
}

export function upcomingListHtml(rows) {
  if (!rows.length) return '';
  return `<ul class="plain">${rows.map((u) => `<li><strong>${esc(u.label)}</strong>${upcomingDetails(u)}</li>`).join('')}</ul>
    <p class="small muted">Plans can change.</p>`;
}
