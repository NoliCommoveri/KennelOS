// Shared by the family pages (list.js, status.js). Plain browser modules: no
// framework, no outside requests, nothing stored in the browser.
//
// The labels below are copied from shared/data/vocab.js (these pages aren't part
// of the app and can't import it); tests/familyPages.test.js in the repo root
// fails if they drift.
export const SEX_LABEL = { any: 'Either', male: 'Male', female: 'Female' };
// A pup's planned registration, shown wherever a pup is. An undecided one (none
// set: she'd sell it either way) shows nothing here; only where prices show does
// it read "Limited ($3,700 for full)" (status.js).
export const REG_SHORT = { limited: 'Limited', full: 'Full', co_own: 'Co-own', none: 'Unregistered' };
export const pupRegistration = (d) => REG_SHORT[d?.registration] || '';
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
export async function fetchJson(path, { method = 'GET', json, headers = {} } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: json ? { 'content-type': 'application/json', ...headers } : headers,
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
// A paused family (only when she shows them, waitlist_config.public_show_paused)
// reads "Skipped until <date>" (or "Skipped for now") in place of their preference.
// `selected`: the families with a pup selected (Waitlist Fixes Plan §3.1), put in at
// the numbers they hold with a tick, their name and "Pup selected" under Wants. The
// note about names not shown is worked out after they're in, so they never set it off.
export function publicListHtml(rows, query = '', mine = null, selected = []) {
  rows = [...rows, ...(Array.isArray(selected) ? selected : []).map((r) => ({ ...r, selected: true }))]
    .sort((a, b) => a.position - b.position);
  const shown = rows.filter((r) => rowMatches(r, query));
  if (!rows.length) return '<p class="muted">No families to show right now.</p>';
  if (!shown.length) return `<p class="muted">No one on the list matches "${esc(query)}".</p>`;
  const rowClass = (r) => [r.position === mine && 'mine', r.deciding && 'deciding', r.selected && 'selected'].filter(Boolean).join(' ');
  // The date added is a bubble on the ⓘ at the row's end (hover, focus or tap),
  // not a column (asked by the owner, 2026-11-01).
  const added = (r) => (r.added ? `<button type="button" class="added-tip" aria-label="Added ${esc(fmtDate(r.added))}" data-tip="Added ${esc(fmtDate(r.added))}">i</button>` : '');
  // Her program's icon, when she shows them: left of the number, in its own column
  // (there only when some row has one); tapping it shows her description, so
  // families see why someone who joined later is ahead. Never the program's name.
  const marks = rows.some((r) => PROGRAM_ICON_SVG[r.program?.icon] && r.program?.about);
  const program = (r) => (PROGRAM_ICON_SVG[r.program?.icon] && r.program?.about
    ? `<button type="button" class="added-tip program-tip" aria-label="${esc(r.program.about)}" data-tip="${esc(r.program.about)}">${PROGRAM_ICON_SVG[r.program.icon]}</button>` : '');
  const wants = (r) => [SEX_LABEL[r.pref_sex] || 'Either', ...(Array.isArray(r.wants_more) ? r.wants_more : [])].map(esc).join(' · ');
  const body = shown.map((r) => `<tr${rowClass(r) ? ` class="${rowClass(r)}"` : ''}>
      ${marks ? `<td class="mark">${program(r)}</td>` : ''}<td class="num">${r.selected ? '<span class="tick" aria-label="Pup selected">✓</span> ' : ''}#${esc(r.position)}</td>
      <td>${r.deciding ? `<em>${esc(r.name)}</em>` : esc(r.name)}${r.position === mine ? ' <span class="badge">You</span>' : ''}</td>
      <td>${r.selected ? '<em>Pup selected</em>' : r.skipped ? `<em>${esc(r.skipped_until ? `Skipped until ${fmtDate(r.skipped_until)}` : 'Skipped for now')}</em>` : wants(r)}</td>
      <td class="tip">${added(r)}</td></tr>`).join('');
  const gaps = rows.some((r, i) => r.position !== i + 1);
  return `<table class="list"><thead><tr>${marks ? '<th class="mark"><span class="sr-only">Program</span></th>' : ''}<th>#</th><th>Name</th><th>Wants</th><th class="tip"><span class="sr-only">Added</span></th></tr></thead><tbody>${body}</tbody></table>
    ${gaps ? '<p class="small muted">Note: in special circumstances, some applicant names may not be displayed above. Their place is being held, but they are not currently eligible for available pups.</p>' : ''}`;
}

// The program icons: a copy of shared/assets/programIcons.js (these pages are served
// apart from the app; tests/familyPages.test.js fails if the two drift).
export const PROGRAM_ICON_SVG = {
  star: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#d49b0b" d="M12 2.5l2.9 6.1 6.6.7-4.9 4.5 1.4 6.6L12 17l-5.9 3.4 1.4-6.6-4.9-4.5 6.6-.7z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#2f9e5b"/><path d="M7 12.5l3.3 3.3L17 9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  heart: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#d64545" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>',
  ribbon: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8.8 21.5L15.6 10.6C17.6 7.3 16 2.8 12 2.8S6.4 7.3 8.4 10.6L15.2 21.5" fill="none" stroke="#d9559a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  medal: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 2h4l2 6H9zM13 2h4l-2 6h-2z" fill="#3f6fb5"/><circle cx="12" cy="15.5" r="6" fill="#c9971c"/><path fill="#fff" d="M12 11.8l1.1 2.3 2.5.3-1.9 1.7.5 2.5-2.2-1.3-2.2 1.3.5-2.5-1.9-1.7 2.5-.3z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4a6b8a" d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z"/></svg>',
  paw: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><g fill="#8a5a3c"><ellipse cx="6.2" cy="10" rx="2.1" ry="2.6"/><ellipse cx="10" cy="5.8" rx="2.1" ry="2.7"/><ellipse cx="14" cy="5.8" rx="2.1" ry="2.7"/><ellipse cx="17.8" cy="10" rx="2.1" ry="2.6"/><path d="M12 11c3 0 5.6 3.4 5.6 6.1 0 2.1-1.6 3.1-3.3 2.6-.9-.3-1.5-.5-2.3-.5s-1.4.2-2.3.5c-1.7.5-3.3-.5-3.3-2.6C6.4 14.4 9 11 12 11z"/></g></svg>'
};

// A tap on an ⓘ (or a program icon) opens its bubble (touch screens have no hover); a tap anywhere
// else closes it. One listener for every list on the page.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (ev) => {
    const tip = ev.target instanceof Element ? ev.target.closest('.added-tip') : null;
    for (const t of document.querySelectorAll('.added-tip.open')) if (t !== tip) t.classList.remove('open');
    if (tip) tip.classList.toggle('open');
  });
}

// A pairing or litter before picks open (Waitlist Spec §16.4): its parents with
// their titles, and her dates. Used by the public list and the status page.
const parentText = (d) => [d?.name || '', ...(d?.titles || [])].filter(Boolean).join(' ');

// A photos link her device published (a dog's she chose to show, or a litter's),
// opening in a new tab. '' without one.
export function photosLink(url, label = 'Photos') {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
    ? `<a class="photos-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
}
// What a parent's info bubble shows: its registered name, its pedigree (its own
// sire's and dam's registered names) and its health testing, whichever her device
// published. null when none of the three: then there's no bubble.
export function dogInfo(d) {
  const reg = typeof d?.registered_name === 'string' ? d.registered_name : '';
  const ped = d?.pedigree && (d.pedigree.sire || d.pedigree.dam) ? { sire: d.pedigree.sire || '', dam: d.pedigree.dam || '' } : null;
  const tests = Array.isArray(d?.tests) ? d.tests.filter((t) => t && t.name) : [];
  if (!reg && !ped && !tests.length) return null;
  return { name: d?.name || '', registered_name: reg, pedigree: ped, tests };
}

// The ⓘ by a parent's call name, opening dogInfoDialog. '' without anything to show.
export function infoBubble(d) {
  const info = dogInfo(d);
  return info ? ` <button type="button" class="info-bubble" data-dog-info="${esc(JSON.stringify(info))}" aria-label="About ${esc(info.name || 'this dog')}" title="Registered name, pedigree and health testing">i</button>` : '';
}

// A parent's name and titles, its info bubble, then its photos link when it has one.
const parentHtml = (d) => `${esc(parentText(d))}${infoBubble(d)}${d?.photos_url ? ` (${photosLink(d.photos_url)})` : ''}`;

// The info bubble's popup: the parent's registered name, pedigree and health
// testing, each only when published. Close, a backdrop tap and Escape close it.
export function dogInfoHtml(info) {
  const parts = [];
  if (info.registered_name) parts.push(`<h3>Registered name</h3><p>${esc(info.registered_name)}</p>`);
  if (info.pedigree) {
    parts.push(`<h3>Pedigree</h3><dl class="info-facts">${info.pedigree.sire ? `<dt>Sire</dt><dd>${esc(info.pedigree.sire)}</dd>` : ''}${info.pedigree.dam ? `<dt>Dam</dt><dd>${esc(info.pedigree.dam)}</dd>` : ''}</dl>`);
  }
  if (info.tests.length) {
    parts.push(`<h3>Health testing</h3><ul class="plain info-tests">${info.tests.map((t) => `<li>${esc(t.name)}: ${esc(t.result || '')}</li>`).join('')}</ul>`);
  }
  return parts.join('');
}
export function dogInfoDialog(info) {
  const before = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal dog-info" role="dialog" aria-modal="true" aria-labelledby="di-title">
      <h2 id="di-title">${esc(info.name || 'About this dog')}</h2>
      ${dogInfoHtml(info)}
      <div class="modal-actions"><button type="button" class="secondary" data-di="close">Close</button></div>
    </div>`;
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(); } };
  const done = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (before && typeof before.focus === 'function' && before.isConnected) before.focus();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-di]')) done(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.querySelector('[data-di]').focus();
}
// One listener for every bubble a page draws, now or later (pages re-render).
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', (e) => {
    const b = e.target?.closest?.('[data-dog-info]');
    if (!b) return;
    e.preventDefault();
    try { dogInfoDialog(JSON.parse(b.dataset.dogInfo)); } catch { /* a malformed bubble opens nothing */ }
  });
}


// "Dam: Juniper ⓘ · Sire: Ash CH ⓘ": a litter's parents, the same on every card;
// each one's registered name, pedigree and health testing behind its info bubble.
export function parentsLine(dam, sire) {
  if (!dam?.name && !sire?.name) return '';
  return `<div class="small">Dam: ${parentHtml(dam)} · Sire: ${parentHtml(sire)}</div>`;
}

// One litter (or pairing) the same way everywhere a family sees one (decided
// 2026-10-08): the breed, its name, its parents, its dates, the litter's photos
// link (`photos`, when she set one), then any extra lines.
export function litterHtml({ breed = null, name = '', nameAfter = '', dam = null, sire = null, when = '', photos = null, extra = '' }) {
  return `${breed ? `<div class="small muted">${esc(breed)}</div>` : ''}<div><strong>${esc(name)}</strong>${nameAfter}</div>
    ${parentsLine(dam, sire)}${when ? `<div class="small muted">${esc(when)}</div>` : ''}${photos ? `<div class="small">${photosLink(photos, 'See the litter\'s photos')}</div>` : ''}${extra}`;
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

// A planned heat's month, "March 2027", from YYYY-MM. Never a day: only the month
// is published, and it's an estimate.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function fmtMonthYear(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? ''));
  return m && MONTHS[Number(m[2]) - 1] ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}
export const HEAT_DISCLAIMER = 'Heat dates are estimates: the month shown is approximate and can shift.';

export function upcomingItemHtml(u, extra = '') {
  if (u.kind === 'planned_heat') {
    const month = fmtMonthYear(u.expected_month);
    const damPhotos = u.dam?.photos_url ? `<div class="small">${photosLink(u.dam.photos_url, `Photos of ${u.dam.name || 'the dam'}`)}</div>` : '';
    return litterHtml({ breed: u.breed, name: parentText(u.dam) || u.label, nameAfter: infoBubble(u.dam), when: month ? `Upcoming heat · estimated around ${month}` : 'Upcoming heat', extra: damPhotos + extra });
  }
  return litterHtml({ breed: u.breed, name: u.label, dam: u.dam, sire: u.sire, when: upcomingWhen(u), photos: u.photos_url, extra });
}

// Under a Coming up list: plans can change, and heat months are estimates.
export function upcomingFootHtml(rows) {
  return `<p class="small muted">Plans can change.${rows.some((u) => u.kind === 'planned_heat') ? ` ${esc(HEAT_DISCLAIMER)}` : ''}</p>`;
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

// The available pups in two columns, Males on the left and Females on the right,
// the label once above each; a pup's name is its link (its page on her website, or
// its photos) when it has one, with its registration and registry after it when set. A
// pup of no recorded sex gets a third column. Falls back to the counts
// (pupsRemaining) for a card published without names.
// With any reserved pup (`l.reserved`, Waitlist Fixes Plan §3.2), two sections:
// Still Available, then Already Reserved, each with its Males and Females columns
// (side by side, stacked on a phone). Nothing says who reserved a pup.
export function pupColumnsHtml(l) {
  const pups = Array.isArray(l.pups) ? l.pups : null;
  const reserved = Array.isArray(l.reserved) ? l.reserved : [];
  if (!pups) return `<div class="small">${esc(pupsRemaining(l))}</div>`;
  const name = (d) => {
    const bits = [pupRegistration(d), d.registry].filter(Boolean);
    return `${d.photos_url ? photosLink(d.photos_url, d.call_name || 'Puppy') : esc(d.call_name || 'Puppy')}${bits.length ? ` <span class="muted">· ${esc(bits.join(' · '))}</span>` : ''}`;
  };
  const col = (label, list, empty) => `<div class="pup-col"><div class="pup-col-head">${esc(label)}</div>${list.length
    ? `<ul class="plain">${list.map((d) => `<li>${name(d)}</li>`).join('')}</ul>` : `<div class="muted pup-col-empty">${empty}</div>`}</div>`;
  const columns = (list, empty) => {
    const other = list.filter((d) => d.sex !== 'male' && d.sex !== 'female');
    return `<div class="pup-cols small">${col('Males', list.filter((d) => d.sex === 'male'), empty)}${col('Females', list.filter((d) => d.sex === 'female'), empty)}${other.length ? col('Puppies', other, empty) : ''}</div>`;
  };
  const available = pups.length ? columns(pups, 'None left') : '<div class="small muted">No puppies remaining</div>';
  if (!reserved.length) return available;
  return `<div class="pup-sections"><div class="pup-section"><div class="pup-section-head">Still Available</div>${available}</div>
    <div class="pup-section"><div class="pup-section-head">Already Reserved</div>${columns(reserved, 'None')}</div></div>`;
}

// A turn's litter link: its page on her KennelPort website (`page`, from
// waitlistProjection.litterLink), else the photos she set. On a turn the pups' names
// are pick buttons, and a button can't hold a link, so this line is how a family on
// its turn follows the litter: every pup's page sits under the litter's page.
export function litterLinkHtml(l) {
  if (!l?.photos_url) return '';
  return `<p class="small mt0">${photosLink(l.photos_url, l.page ? 'View litter on our website' : 'See the litter\'s photos')}</p>`;
}

// The pups' own links under a turn's pick buttons. Their pages on her website are
// NOT listed pup by pup: the litter's link above the buttons covers them (decided
// 2026-11-03), so they stand in for it only where that litter has no page of its
// own. A pup whose link is just photos ("Photos: Pip · Poppy") always gets its own.
export function pupLinksHtml(l, pups = []) {
  const pages = l?.page ? [] : pups.filter((d) => d.photos_url && d.page).map((d) => photosLink(d.photos_url, `${d.call_name || 'Puppy'}'s page`));
  const photos = pups.filter((d) => d.photos_url && !d.page).map((d) => photosLink(d.photos_url, d.call_name || 'Photos'));
  return `${pages.length ? `<p class="small mt0">On our website: ${pages.join(' · ')}</p>` : ''}${photos.length ? `<p class="small mt0">Photos: ${photos.join(' · ')}</p>` : ''}`;
}

// One litter with open picks (Available Puppies), the same on the public list and a
// family's page; `extra` adds lines under it.
export function availableItemHtml(l, extra = '') {
  return litterHtml({ breed: l.breed, name: l.nickname || l.label, dam: l.dam, sire: l.sire, when: litterDates(l), photos: l.photos_url, extra: `${pupColumnsHtml(l)}${extra}` });
}

export function upcomingListHtml(rows) {
  if (!rows.length) return '';
  return `<ul class="plain">${rows.map((u) => `<li>${upcomingItemHtml(u)}</li>`).join('')}</ul>
    ${upcomingFootHtml(rows)}`;
}

// The family pages' own yes/no dialog, in place of the browser's window.confirm
// (which shows the bare site address and system styling). Mirrors the app's
// confirmModal (shared/assets/ui.js): title, message, a primary and a cancel
// button. Cancel, a backdrop tap and Escape all resolve false. Focus goes to the
// primary button and returns to whatever had it when the dialog closes.
export function confirmDialog({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const before = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="fd-title">
        <h2 id="fd-title">${esc(title)}</h2>
        ${message ? `<p class="muted">${esc(message)}</p>` : ''}
        <div class="modal-actions">
          <button type="button" class="primary${danger ? ' danger' : ''}" data-fd="ok">${esc(confirmLabel)}</button>
          <button type="button" class="secondary" data-fd="cancel">${esc(cancelLabel)}</button>
        </div>
      </div>`;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    const done = (val) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      if (before && typeof before.focus === 'function' && before.isConnected) before.focus();
      resolve(val);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(false);
      const b = e.target.closest('[data-fd]');
      if (b) done(b.dataset.fd === 'ok');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-fd="ok"]').focus();
  });
}

// --- Her waitlist policies (Waitlist Policies plan §3) -------------------------------

// Her closed dates in words, runs of days together: "Dec 24–26, Jan 1".
export function closedDatesText(dates = []) {
  const days = [...new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))))].sort();
  const label = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }); };
  const next = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); };
  const runs = [];
  for (const d of days) {
    const last = runs.at(-1);
    if (last && next(last.to) === d) last.to = d; else runs.push({ from: d, to: d });
  }
  return runs.map((r) => {
    if (r.from === r.to) return label(r.from);
    const sameMonth = r.from.slice(0, 7) === r.to.slice(0, 7);
    return `${label(r.from)}–${sameMonth ? Number(r.to.slice(8)) : label(r.to)}`;
  }).join(', ');
}

// Each policy an expander (the FAQ's look), id "policy-<id>" so a link can open one.
// Under a policy from the business-days topic, her closed dates still ahead.
export function policiesHtml(kennel) {
  const list = Array.isArray(kennel?.policies) ? kennel.policies : [];
  const closed = closedDatesText(kennel?.closed_dates || []);
  return list.map((x) => `<details class="policy" id="policy-${esc(x.id)}"><summary>${esc(x.heading)}</summary><p class="pre">${esc(x.body)}</p>${x.topic === 'days' && closed ? `<p class="small muted closed-dates">Upcoming closed dates: ${esc(closed)}</p>` : ''}</details>`).join('');
}

// The policy whose heading speaks to this moment (e.g. ['deposit', 'pick']), or null.
export function policyAbout(kennel, words) {
  const list = Array.isArray(kennel?.policies) ? kennel.policies : [];
  return list.find((x) => words.some((w) => new RegExp(`\\b${w}`, 'i').test(x.heading))) || null;
}

// Open the policies card (and one policy in it) and scroll to it. `card`: the
// <details> holding them; `id`: a policy's id, or null for the card's top.
export function openPolicy(card, id = null) {
  if (!card) return;
  card.open = true;
  const one = id ? card.querySelector(`#policy-${CSS.escape(id)}`) : null;
  if (one) one.open = true;
  (one || card).scrollIntoView({ behavior: 'smooth', block: 'start' });
}
