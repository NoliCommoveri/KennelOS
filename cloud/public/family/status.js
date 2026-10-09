// A family's own status page: /s/<token> (Waitlist Spec §8.3; W2 Plan §5, step 5).
// Their place, their offers and the pups in them, the fee while it's unpaid, the
// litters and their place in each, and the public list. From a SIGNED-IN browser
// (See Your Details) it also lets them respond: choose a pup or pass, say they're
// still interested, ask for a pause, change which litters they wait for, ask to
// change a matching answer, leave the list, message the breeder, and (once they
// have a puppy on the way, placed or not) ask for their Companion link. Anyone with
// only the link can look but not act: the server needs the family session.
//
// Every action is recorded on the server for the breeder's device, which decides
// (W2 Plan §6): the page says what's waiting for her until her next update.
// Messages are sealed here, in this browser, to her key (seal.js); the server
// can't read them.
import {
  esc, fmtDate, money, fetchJson, loadError, publicListHtml, possessive, upcomingItemHtml, litterHtml, deadlineText, fmtShortDate,
  SEX_LABEL, READY_LABEL, PLACEMENT_LABEL, CREDIT_LABEL
} from './common.js';
import { rememberedFamily, forgetFamily } from './session.js';
import { seal } from './seal.js';

const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/')[2] || '';
const MESSAGE_MAX = 5000;

const STATUS = {
  applied: { badge: 'info', label: 'Application received' },
  approved: { badge: 'warn', label: 'Approved: fee due' },
  active: { badge: '', label: 'On the list' },
  placed: { badge: '', label: 'Placed' },
  declined: { badge: 'plain', label: 'Not accepted' },
  withdrawn: { badge: 'plain', label: 'Left the list' },
  removed: { badge: 'plain', label: 'No longer on the list' },
  expired: { badge: 'plain', label: 'Fee window closed' },
};

// The page's state: the view the server sent, the browser's family session (or
// null), and which editor is open.
const state = { v: null, session: null, open: null, flash: '', opened: new Set() };

// "Born 09/01/2026 · Ready 10/27/2026" (Available Puppies).
function litterDates(l) {
  const bits = [];
  if (l.whelp_date) bits.push(`Born ${fmtShortDate(l.whelp_date)}`);
  else if (l.status === 'expected') bits.push('Expected');
  if (l.status === 'ready') bits.push('Ready to go home');
  else if (l.ready_date) bits.push(`Ready ${fmtShortDate(l.ready_date)}`);
  return bits.join(' · ');
}

// "2 females and 1 male remaining".
function pupsRemaining(l) {
  const f = Number(l.pups_female) || 0;
  const m = Number(l.pups_male) || 0;
  const other = Math.max((Number(l.pups_available) || 0) - f - m, 0);
  const part = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const bits = [f && part(f, 'female', 'females'), m && part(m, 'male', 'males'), other && part(other, 'puppy', 'puppies')].filter(Boolean);
  if (!bits.length) return 'No puppies remaining';
  return `${bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0]} remaining`;
}

// A litter they passed on (or let their turn lapse on) that's still being offered.
const spentOn = (id) => (state.v.family.place_hidden?.litters || []).find((x) => x.litter_id === id) || null;

// A section of the page. Titled sections fold away and start folded (decided
// 2026-10-08), except the ones asking the family to do something now (openCard).
// Which ones they've opened is kept across re-renders (state.opened), so a
// section stays open while they use a button in it.
function card(title, body, cls = '') {
  if (!title) return openCard(title, body, cls);
  const key = String(title).replace(/<[^>]*>/g, '');
  return `<details class="card collapsible ${cls}" data-key="${esc(key)}"${state.opened.has(key) ? ' open' : ''}><summary><h2>${title}</h2></summary>${body}</details>`;
}

function openCard(title, body, cls = '') {
  return `<div class="card ${cls}">${title ? `<h2>${title}</h2>` : ''}${body}</div>`;
}

function closedText(status, kennel) {
  switch (status) {
    case 'placed': return `Congratulations on your puppy from ${esc(kennel)}! Your time on the waitlist is complete.`;
    case 'declined': return `${esc(kennel)} wasn't able to accept this application. Please contact them with any questions.`;
    case 'withdrawn': return 'You left the waitlist. Contact the breeder if you would like to apply again.';
    case 'removed': return `You're no longer on ${esc(possessive(kennel))} waitlist. Contact them with any questions.`;
    case 'expired': return `The application fee wasn't received in time, so the application has closed. Contact ${esc(kennel)} if you'd like to apply again.`;
    default: return '';
  }
}

// --- What's waiting for the breeder ------------------------------------------------

const pendingOf = (kind, test = () => true) => (state.v.pending || []).filter((p) => p.kind === kind && test(p.payload || {}));
const waiting = (kennel) => `Waiting for ${esc(kennel)} to update the list.`;
const signedIn = () => Boolean(state.session);
const canAct = () => signedIn() && ['applied', 'approved', 'active'].includes(state.v.family.status);

function decidedLine(req, what, kennel) {
  if (!req || !req.decided) return '';
  return req.decided === 'approved'
    ? `<p class="small">${esc(kennel)} approved ${what} on ${esc(fmtDate(req.decided_date))}.</p>`
    : `<p class="small">${esc(kennel)} didn't approve ${what} (${esc(fmtDate(req.decided_date))}). Contact them if you have questions.</p>`;
}

// --- Matching answers (Spec §15.9: they ask, she approves) -----------------------

const PREF_FIELDS = [
  { key: 'pref_sex', prefs: 'sex', label: 'Sex', text: (v) => SEX_LABEL[v] || 'Either' },
  { key: 'pref_breed', prefs: 'breed', label: 'Breed', text: (v) => v || 'Any' },
  { key: 'pref_placement_type', prefs: 'placement', label: 'Placement', text: (v) => PLACEMENT_LABEL[v] || 'Any' },
  { key: 'pref_colors', prefs: 'colors', label: 'Colors', text: (v) => (Array.isArray(v) && v.length ? v.join(', ') : 'Any') },
  { key: 'ready_timing', prefs: 'ready_timing', label: 'Ready to buy', text: (v) => READY_LABEL[v] || 'Not answered' },
];

// The answers a family asks to change: colors only while she matches on color
// (otherwise they're notes), breed only when she has breeds to choose from.
function editableFields() {
  const k = state.v.kennel;
  return PREF_FIELDS.filter((f) => (f.key !== 'pref_colors' || k.color_matching) && (f.key !== 'pref_breed' || (k.breeds || []).length));
}

function prefEditor(prefs) {
  const k = state.v.kennel;
  const opts = (pairs, current) => pairs.map(([v, label]) => `<option value="${esc(v)}"${v === (current ?? '') ? ' selected' : ''}>${esc(label)}</option>`).join('');
  const control = (f) => {
    const cur = prefs[f.prefs];
    switch (f.key) {
      case 'pref_sex': return `<select name="pref_sex">${opts(Object.entries(SEX_LABEL), cur || 'any')}</select>`;
      case 'pref_breed': return `<select name="pref_breed">${opts([['', 'Any'], ...(k.breeds || []).map((b) => [b, b])], cur || '')}</select>`;
      case 'pref_placement_type': return `<select name="pref_placement_type">${opts([['', 'Any'], ...Object.entries(PLACEMENT_LABEL)], cur || '')}</select>`;
      case 'pref_colors': return `<input type="text" name="pref_colors" value="${esc((cur || []).join(', '))}" placeholder="Separate colors with commas">`;
      case 'ready_timing': return `<select name="ready_timing">${opts([['', 'Not answered'], ...Object.entries(READY_LABEL)], cur || '')}</select>`;
      default: return '';
    }
  };
  return `<form data-form="pref_change" class="mt8">
      ${editableFields().map((f) => `<label class="q mt8">${esc(f.label)}${control(f)}</label>`).join('')}
      ${canChooseParents() ? parentsFields(state.v.family) : ''}
      <label class="q mt8">Anything you'd like to add? <span class="muted small">(optional)</span><textarea name="note" maxlength="500"></textarea></label>
      <p class="small muted">${esc(state.v.kennel.name)} decides on a change like this. Until then, nothing changes: your offers and your place stay as they are.</p>
      <div class="actions"><button class="primary" type="submit">Send my request</button><button class="secondary" type="button" data-act="close">Cancel</button></div>
    </form>`;
}

function prefsHtml(f) {
  const prefs = f.prefs;
  if (!prefs) return '';
  const kennel = state.v.kennel.name;
  const rows = PREF_FIELDS.filter((x) => x.key !== 'pref_breed' || prefs.breed || (state.v.kennel.breeds || []).length)
    .map((x) => `<dt>${esc(x.label)}</dt><dd>${esc(x.text(prefs[x.prefs]))}</dd>`).join('')
    + (f.status === 'active' ? `<dt>Parents</dt><dd>${esc(parentsText(f.listen))}</dd>` : '');
  const req = f.requests?.pref_change;
  const sent = pendingOf('pref_change');
  let status = '';
  if (sent.length || (req && !req.decided)) {
    const changes = sent.length ? sent[sent.length - 1].payload.changes : req.changes;
    const asked = PREF_FIELDS.filter((x) => changes && changes[x.key] !== undefined).map((x) => `${x.label}: ${x.text(changes[x.key])}`).join(', ');
    status = `<p class="small"><span class="badge warn">Requested</span> ${esc(asked)}. Waiting for ${esc(kennel)}.</p>`;
  } else {
    status = decidedLine(req, 'your requested change', kennel);
  }
  if (f.status === 'active') status += listenStatus(f);
  let action = '<p class="small muted">To change any of these, contact the breeder.</p>';
  if (canAct() && (editableFields().length || canChooseParents())) {
    action = state.open === 'pref_change' ? prefEditor(prefs)
      : `<p class="small muted">The answers that decide which pups you're offered change only with ${esc(possessive(kennel))} OK.</p>
         <div class="actions"><button class="secondary" type="button" data-act="open" data-what="pref_change">Ask to change</button></div>`;
  }
  return `<dl class="facts">${rows}</dl>${status}${action}`;
}

// --- Offers ----------------------------------------------------------------------

// Her reasons for a pass (Waitlist Spec §16.5), as radio buttons; "Other" has a
// short text box. Used for passing on a turn and for "Not this litter".
function reasonForm(form, intro, submitLabel, hidden = {}) {
  const reasons = state.v.kennel.pass_reasons || [];
  return `<form data-form="${form}" class="mt8">
      ${Object.entries(hidden).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}
      <p class="mt0 small">${intro}</p>
      <fieldset class="field"><legend class="q">Why? <span class="req">*</span></legend><div class="choices">
        ${reasons.map((r, i) => `<label class="choice"><input type="radio" name="reason_id" value="${esc(r.id)}"${i === 0 ? ' required' : ''}> ${esc(r.label)}</label>`).join('')}
      </div></fieldset>
      ${reasons.some((r) => r.id === 'other') ? '<label class="q mt8">If other, please tell us more<input type="text" name="reason_text" maxlength="200"></label>' : ''}
      <div class="actions mt8"><button class="${form === 'pass' ? 'pass' : 'primary'}" type="submit">${esc(submitLabel)}</button><button class="secondary" type="button" data-act="close">Cancel</button></div>
    </form>`;
}

// The message she wrote for a reason, shown once they've sent it.
function reasonMessage(id) {
  const r = (state.v.kennel.pass_reasons || []).find((x) => x.id === id);
  return r?.message || 'Thank you for letting us know.';
}

// A family's turn (Waitlist Spec §16.1): every litter it covers, in one card. They
// choose ONE pup from any of them, or pass on all of them (only that counts as a
// pass, and once). `rows` are the turn's offers, each one litter.
function turnHtml(rows) {
  const v = state.v;
  const kennel = v.kennel.name;
  const turnId = rows[0].turn_id || rows[0].id;
  const ids = new Set(rows.map((o) => o.id));
  const mine = (p) => p.turn_id === turnId || ids.has(p.offer_id);
  const sentPick = pendingOf('pick', mine)[0];
  const sentPass = pendingOf('pass', mine)[0];
  const picked = rows.find((o) => o.picked_dog_id);
  const chosen = picked?.picked_dog_id || sentPick?.payload.dog_id || null;
  const actOn = canAct() && !chosen && !sentPass;
  const several = rows.length > 1;
  const pupsOf = (o) => (o.pups.length
    ? `<div class="pups">${o.pups.map((d) => {
      const label = `${esc(d.call_name)} · ${esc(SEX_LABEL[d.sex] || '')}${d.color ? ` · ${esc(d.color)}` : ''}`;
      const yours = d.id === chosen ? ' <span class="badge">Your pick</span>' : '';
      return actOn
        ? `<button type="button" class="pup secondary" data-act="pick" data-offer="${esc(o.id)}" data-dog="${esc(d.id)}" data-name="${esc(d.call_name)}">${label}</button>`
        : `<span class="pup">${label}${yours}</span>`;
    }).join('')}</div>`
    : '<p class="small muted mt0">No pups left in this litter for you.</p>');
  const chosenName = rows.flatMap((o) => o.pups).find((d) => d.id === chosen)?.call_name || 'a pup';
  let next;
  if (sentPass) next = `<p>You passed on ${several ? 'all of these' : 'this litter'}. ${waiting(kennel)}</p>`;
  else if (sentPick && !picked) next = `<p>You chose ${esc(chosenName)}. ${waiting(kennel)} Send your deposit by the deadline to keep them.</p>`;
  else if (picked) next = '<p>You picked a pup. Send your deposit by the deadline to keep them.</p>';
  else if (actOn && state.open === `pass:${turnId}`) {
    const p = v.family.passes;
    next = reasonForm('pass', `Pass on this turn?${p ? ` You've used ${esc(p.used)} of ${esc(p.max)} passes; this may count as one.` : ''}`,
      'Pass on turn', { turn_id: turnId });
  } else if (actOn) {
    // One pass per turn, whatever litters it covers (Spec §16.1).
    const p = v.family.passes;
    next = `<div class="actions mt8"><button type="button" class="pass" data-act="open" data-what="pass:${esc(turnId)}">Pass on turn</button></div>
      ${p ? `<p class="small muted mt0">${esc(p.used)} of ${esc(p.max)} passes used</p>` : ''}`;
  } else next = signedIn() ? '' : `<p>Sign in at the top of the page to choose a pup or pass, or contact ${esc(kennel)}.</p>`;
  const respondBy = rows.map((o) => o.respond_by_date || '').sort().reverse()[0];
  return openCard('The wait is over!', `
    <p class="mt0">Below are the puppies available for selection.</p>
    ${rows.map((o) => `<p class="mt8"><strong>${esc(o.litter)}</strong></p>${pupsOf(o)}`).join('')}
    ${next}
    ${respondBy ? `<p class="deadline"><strong>${esc(deadlineText(respondBy, v.kennel.time_zone))}</strong></p>` : ''}`, 'turn');
}

// The family's offers as turns, oldest first.
function turnsOf(offers) {
  const groups = new Map();
  for (const o of offers) {
    const id = o.turn_id || o.id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(o);
  }
  return [...groups.values()];
}

// --- "Not this litter" (Spec §16.2) ----------------------------------------------
// A family who already knows a litter isn't for them says so ahead of time, with a
// reason. Nothing counts unless their turn comes; then that litter is left out of
// it (and a turn of nothing else is passed at once). They can take it back.

// What "Not this litter" acts on. A litter with open picks or an early litter is
// its litter; a pairing (or a litter not yet born) is its pairing when it has one,
// so the choice carries over to the litter born of it (§16.2).
const litterTarget = (l) => ({ key: `l:${l.id}`, label: l.label, send: { litter_id: l.id }, litter_id: l.id, pairing_id: l.pairing_id || null });
const upcomingTarget = (u) => ({
  key: `u:${u.id}`, label: u.label,
  send: u.kind !== 'early_litter' && u.pairing_id ? { pairing_id: u.pairing_id } : { litter_id: u.litter_id },
  litter_id: u.litter_id || null, pairing_id: u.pairing_id || null
});
const matches = (x, t) => Boolean((x.litter_id && x.litter_id === t.litter_id) || (x.pairing_id && x.pairing_id === t.pairing_id));

// The prepass in force for this target, as { litter_id } or { pairing_id } (what
// Undo sends), or null. Their own unanswered actions count first.
function prepassedNow(t) {
  const pend = (state.v.pending || []).filter((p) => (p.kind === 'prepass' || p.kind === 'unprepass') && matches(p.payload || {}, t));
  if (pend.length) {
    const last = pend[pend.length - 1];
    return last.kind === 'prepass' ? (last.payload.litter_id ? { litter_id: last.payload.litter_id } : { pairing_id: last.payload.pairing_id }) : null;
  }
  const p = (state.v.family.prepasses || []).find((x) => matches(x, t));
  return p ? (p.litter_id ? { litter_id: p.litter_id } : { pairing_id: p.pairing_id }) : null;
}

function notThisLitter(t) {
  if (!canAct() || state.v.family.status !== 'active') return '';
  if (t.litter_id && ((state.v.offers || []).some((o) => o.litter_id === t.litter_id) || spentOn(t.litter_id))) return '';
  const done = prepassedNow(t);
  if (done) {
    const attr = done.litter_id ? `data-litter="${esc(done.litter_id)}"` : `data-pairing="${esc(done.pairing_id)}"`;
    return `<div class="row mt8"><span class="small"><span class="badge plain">Not this litter</span> We'll leave it out of your turn. Only if it's the only litter in your turn does that count as a pass.</span>
      <button type="button" class="linkish small" data-act="unprepass" ${attr}>Undo</button></div>`;
  }
  if (state.open === `prepass:${t.key}`) {
    return reasonForm('prepass', `Not interested in ${esc(t.label)}? We'll leave it out of your turn when it comes. Nothing counts now; only if it's the only litter in your turn does that count as a pass. You keep your place for every other litter.`,
      'Not this litter', t.send);
  }
  return `<div class="actions mt8"><button type="button" class="secondary small" data-act="open" data-what="prepass:${esc(t.key)}">Not this litter</button></div>`;
}

// Pairings and litters before picks open, as she shows them on family pages
// (Spec §16.4): what's coming, whether it's one they're waiting for, and for a
// whelped litter their place in it now. A pairing has no pups, so no place.
function upcomingCard(v) {
  if (!(v.upcoming || []).length) return '';
  // Laid out like Available Puppies; no badges (decided 2026-10-08).
  const items = v.upcoming.map((u) => `<li>${upcomingItemHtml(u, u.waiting ? notThisLitter(upcomingTarget(u)) : '')}</li>`).join('');
  return card('Coming up', `<ul class="plain">${items}</ul>
    <p class="small muted">Plans can change.</p>`);
}

// --- Your place: still interested, pause, leave ----------------------------------

function placeActions(f) {
  if (!canAct()) return '';
  const kennel = state.v.kennel.name;
  const parts = [];
  if (pendingOf('still_interested').length) parts.push(`<p class="small">Thanks! ${esc(kennel)} will see that you're still interested.</p>`);

  const pauseSent = pendingOf('pause_request');
  const pauseReq = f.requests?.pause;
  if (pauseSent.length) parts.push(`<p class="small"><span class="badge warn">Pause requested</span> until ${esc(fmtDate(pauseSent[pauseSent.length - 1].payload.until))}. ${waiting(kennel)}</p>`);
  else if (pauseReq && !pauseReq.decided) parts.push(`<p class="small"><span class="badge warn">Pause requested</span> until ${esc(fmtDate(pauseReq.until))}. Waiting for ${esc(kennel)} to decide.</p>`);
  else parts.push(decidedLine(pauseReq, 'your pause', kennel));

  if (state.open === 'pause') {
    const min = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    parts.push(`<form data-form="pause" class="mt8">
        <label class="q">Pause my place until<input type="date" name="until" min="${min}" required></label>
        <label class="q mt8">Why? <span class="muted small">(optional; only ${esc(kennel)} sees this)</span><textarea name="note" maxlength="500"></textarea></label>
        <p class="small muted">While paused you keep your place, you aren't offered pups, and it never counts as a pass. ${esc(kennel)} approves each pause.</p>
        <div class="actions"><button class="primary" type="submit">Ask for a pause</button><button class="secondary" type="button" data-act="close">Cancel</button></div>
      </form>`);
  } else if (state.open === 'leave') {
    parts.push(`<form data-form="leave" class="mt8">
        <p class="mt0"><strong>Leave ${esc(possessive(kennel))} waitlist?</strong> You'd lose your place. Coming back later means applying again.</p>
        <label class="q">Anything you'd like to tell ${esc(kennel)}? <span class="muted small">(optional)</span><textarea name="note" maxlength="500"></textarea></label>
        <div class="actions"><button class="primary danger" type="submit">Leave the list</button><button class="secondary" type="button" data-act="close">Keep my place</button></div>
      </form>`);
  } else if (pendingOf('leave').length) {
    parts.push(`<p class="small">You asked to leave the list. ${waiting(kennel)}</p>`);
  } else {
    const buttons = [];
    if (f.status === 'active') buttons.push('<button type="button" class="secondary" data-act="still_interested">Still interested</button>');
    if (f.status === 'active' && !pauseSent.length && !(pauseReq && !pauseReq.decided)) buttons.push('<button type="button" class="secondary" data-act="open" data-what="pause">Request a pause</button>');
    buttons.push('<button type="button" class="secondary" data-act="open" data-what="leave">Leave the list</button>');
    parts.push(`<div class="actions mt8">${buttons.join('')}</div>`);
  }
  return parts.join('');
}

// Why there's no number (decided 2026-10-08): during their turn, and after a turn
// they passed on or let lapse, until those litters close. They keep their place.
function placeHiddenHtml(h) {
  if (!h) return '';
  if (h.reason === 'turn') return '<p class="mt0"><strong>The wait is over!</strong> Pick a pup above, or pass on your turn.</p>';
  const names = (h.litters || []).map((l) => l.label).filter(Boolean);
  const lapsed = (h.litters || []).every((l) => l.outcome === 'no_response');
  const what = names.length ? names.join(' and ') : 'that litter';
  return `<p class="mt0">${lapsed ? `Your turn on ${esc(what)} ended.` : `You passed on ${esc(what)}.`} You keep your place for future litters.</p>
    <p class="small muted">Your number shows again once ${names.length > 1 ? 'those litters close' : 'that litter closes'}.</p>`;
}

// --- Ready now? (Spec §16.7) -----------------------------------------------------
// When their readiness hold ends (while the list is online), they're asked. Yes ends
// the hold. Not yet: a new date and a reason, which ask the breeder for a pause.

const READY_TITLE = 'Alert: Pause Ending';
const READY_TEXT = 'Your scheduled pause is ending. Please confirm that you are now ready to receive offers for upcoming puppies.';

function readyHtml(f) {
  const rc = f.ready_check;
  if (!rc || f.status !== 'active') return '';
  const kennel = state.v.kennel.name;
  const sent = pendingOf('ready');
  if (sent.length || rc.answer) {
    const answer = sent.length ? sent[sent.length - 1].payload.answer : rc.answer;
    return answer === 'yes' ? '' : openCard(READY_TITLE, `<p class="mt0">You said you're not ready yet. Your pause request is with ${esc(kennel)}; until they decide, you won't be offered a pup.</p>`);
  }
  // At the bottom: the deadline, and what not answering means. Only when there is
  // a deadline (her rule removes families who don't answer); otherwise they just
  // stay paused, so there's nothing to warn about.
  const deadline = rc.answer_by ? `<div class="deadline"><p class="mt0"><strong>Deadline for response: ${esc(fmtShortDate(rc.answer_by))}</strong></p>
    <p class="small muted mt0">Failure to respond may result in removal from the waitlist; if removed, you will need to re-apply in order to be considered again in the future.</p></div>` : '';
  if (!canAct()) {
    return openCard(READY_TITLE, `<p class="mt0">${READY_TEXT}</p><p class="small muted">Sign in on the waitlist page to answer.</p>${deadline}`, 'alert');
  }
  if (state.open === 'ready_no') {
    return openCard(READY_TITLE, `<form data-form="ready_no">
        <label class="q">When do you expect to be ready? <span class="req">*</span><input type="date" name="until" required></label>
        <label class="q mt8">Why not yet? <span class="req">*</span><textarea name="reason" maxlength="500" required></textarea></label>
        <p class="small muted">${esc(kennel)} sees your reason and decides on pausing your place until then. You keep your place.</p>
        <div class="actions"><button class="primary" type="submit">Send</button><button class="secondary" type="button" data-act="close">Cancel</button></div>
      </form>${deadline}`, 'alert');
  }
  return openCard(READY_TITLE, `<p class="mt0">${READY_TEXT}</p>
    <div class="actions"><button type="button" class="primary" data-act="ready_yes">Yes, I'm ready</button><button type="button" class="secondary" data-act="open" data-what="ready_no">Not yet</button></div>
    ${deadline}`, 'alert');
}

// --- A litter was born (Spec §16.6) ---------------------------------------------
// For a born litter whose picks aren't open yet: "A litter you match was born", or,
// when their listen-only choice or answers keep them out, what does and a way to
// review it. Changes go through the usual rules: a wider listen-only change applies
// at once, any change to an answer waits for her OK (Q26).

// New pups on the way or born (Spec §16.6): which litters match their answers and
// which don't, so they can check them. Changes are asked for in "What you asked
// for" further down (decided 2026-10-08: no buttons here).
function whelpNotesHtml(f) {
  const notes = (f.whelp_notes || []).filter((n) => !prepassedNow({ litter_id: n.litter_id, pairing_id: n.pairing_id }));
  if (!notes.length) return '';
  const list = (ns) => `<ul class="plain names">${ns.map((n) => `<li>${litterHtml({ breed: n.breed, name: n.label, dam: n.dam, sire: n.sire })}</li>`).join('')}</ul>`;
  const match = notes.filter((n) => n.kind === 'match');
  const review = notes.filter((n) => n.kind === 'review');
  return openCard('Review Your Preferences', `
    <p class="mt0">With new pups upcoming, please take a moment to confirm your preferences.</p>
    ${match.length ? `<p class="mt8"><strong>Litters matching preferences:</strong></p>${list(match)}` : ''}
    ${review.length ? `<p class="mt8"><strong>Litters not matching preferences:</strong></p>${list(review)}` : ''}`);
}

// --- Which litters (listen-only, Spec §15.7) --------------------------------------

// Which litters they wait for (listen-only, Spec §15.7, §16.3) is the "Parents"
// line of What you asked for (decided 2026-10-08): "Any", "Ash, Juniper only", or
// "Not Willow". It's changed with the rest of their answers (Ask to change).
const parentList = () => { const p = state.v.kennel.parents || { sires: [], dams: [] }; return [...p.sires, ...p.dams]; };
const canChooseParents = () => state.v.family.status === 'active' && parentList().length > 0;

function parentsText(l) {
  const name = (id) => parentList().find((d) => d.id === id)?.name || 'a parent no longer listed';
  const names = [...(l?.sire_ids || []), ...(l?.dam_ids || [])].map(name);
  if (!l || l.mode === 'all' || !names.length) return 'Any';
  return l.mode === 'except' ? `Not ${names.join(', ')}` : `${names.join(', ')} only`;
}

function listenStatus(f) {
  const k = state.v.kennel;
  const req = f.requests?.listen;
  if (pendingOf('listen').length) return `<p class="small"><span class="badge warn">Parents change sent</span> ${waiting(k.name)}</p>`;
  if (req && !req.decided) return `<p class="small"><span class="badge warn">Requested</span> Parents: ${esc(parentsText(req))}. Waiting for ${esc(k.name)} to decide.</p>`;
  return decidedLine(req, 'your change to the parents you wait for', k.name);
}

function parentsFields(f) {
  const p = state.v.kennel.parents || { sires: [], dams: [] };
  const mode = ['selected', 'except'].includes(f.listen?.mode) ? f.listen.mode : 'all';
  const box = (side, d, ids) => `<label class="choice"><input type="checkbox" name="${side}" value="${esc(d.id)}"${(ids || []).includes(d.id) ? ' checked' : ''}> ${esc(d.name)}</label>`;
  return `<fieldset class="field mt8"><legend class="q">Parents</legend>
      <div class="choices">
        <label class="choice"><input type="radio" name="mode" value="all"${mode === 'all' ? ' checked' : ''}> Any</label>
        <label class="choice"><input type="radio" name="mode" value="selected"${mode === 'selected' ? ' checked' : ''}> Only these parents</label>
        <label class="choice"><input type="radio" name="mode" value="except"${mode === 'except' ? ' checked' : ''}> Not these parents</label>
      </div>
      ${p.sires.length ? `<p class="small muted mt8">Sires</p><div class="choices">${p.sires.map((d) => box('sire', d, f.listen?.sire_ids)).join('')}</div>` : ''}
      ${p.dams.length ? `<p class="small muted mt8">Dams</p><div class="choices">${p.dams.map((d) => box('dam', d, f.listen?.dam_ids)).join('')}</div>` : ''}
      <p class="small muted">A litter counts if its sire OR its dam is one you picked. You keep your place either way. Waiting for more litters happens at ${esc(possessive(state.v.kennel.name))} next update; fewer needs their OK.</p>
    </fieldset>`;
}

// --- Their Companion link (Spec §8.3) ---------------------------------------------
// Only for a family with an open sale (her device says so). They ask; she sends the
// link herself, by text or email, and marks it sent. Any time after she's dealt with
// a request they can ask again (for a fresh link).

function companionHtml(f) {
  const c = f.companion;
  if (!c?.available) return '';
  const kennel = state.v.kennel.name;
  const req = c.request;
  const parts = [`<p class="mt0 small">A private page with your puppy's details and updates, which ${esc(kennel)} sends you by text or email.</p>`];
  const sent = pendingOf('companion_request').length;
  const open = sent || (req && !req.decided);
  if (sent) parts.push(`<p class="small"><span class="badge warn">Requested</span> ${esc(kennel)} will see it at their next update, then send it by text or email.</p>`);
  else if (req && !req.decided) parts.push(`<p class="small"><span class="badge warn">Requested</span> on ${esc(fmtDate(req.requested_date))}. ${esc(kennel)} will send it by text or email.</p>`);
  else if (req?.decided === 'sent') parts.push(`<p class="small">${esc(kennel)} sent your link on ${esc(fmtDate(req.decided_date))}. Check your texts and email.</p>`);
  else if (req?.decided === 'declined') parts.push(`<p class="small">${esc(kennel)} didn't send a link (${esc(fmtDate(req.decided_date))}). Contact them if you have questions.</p>`);
  if (!signedIn()) {
    // Still on the list: the Sign In button at the top covers it. Placed: it's here.
    const onList = ['applied', 'approved', 'active'].includes(f.status);
    parts.push(`<p class="small muted">To ask for it, sign in on this device with a code sent to the email on your application.</p>
      ${!onList && state.v.kennel.public_id ? `<div class="actions"><a class="button secondary" href="/list/${encodeURIComponent(state.v.kennel.public_id)}">Sign in with a code</a></div>` : ''}`);
  } else if (state.open === 'companion') {
    parts.push(`<form data-form="companion" class="mt8">
        <label class="q">Anything ${esc(kennel)} should know? <span class="muted small">(optional; only ${esc(kennel)} sees this)</span><textarea name="note" maxlength="500"></textarea></label>
        <div class="actions"><button class="primary" type="submit">Ask for my link</button><button class="secondary" type="button" data-act="close">Cancel</button></div>
      </form>`);
  } else if (!open) {
    parts.push(`<div class="actions mt8"><button type="button" class="secondary" data-act="open" data-what="companion">${req ? 'Ask for a new link' : 'Request my Companion link'}</button></div>`);
  }
  return card('Your Companion page', parts.join(''));
}

// --- Messages ----------------------------------------------------------------------

// The emails the kennel sent them (W2 step 6), newest first, so one lost to spam
// is still read here. An old one (90 days) shows its subject only.
function emailsHtml() {
  const list = state.v.emails || [];
  if (!list.length) return '';
  const items = list.map((m) => `<li>
      <p class="small muted mt0">${esc(fmtDate(String(m.at).slice(0, 10)))}</p>
      <p class="mt0"><strong>${esc(m.subject)}</strong></p>
      ${m.body ? `<p class="pre small mt0">${esc(m.body)}</p>` : ''}
    </li>`).join('');
  return card(`Emails from ${esc(state.v.kennel.name)}`, `<ul class="plain emails">${items}</ul>`);
}

function messageHtml() {
  const k = state.v.kennel;
  if (!k.message_key || !['applied', 'approved', 'active'].includes(state.v.family.status)) return '';
  if (!signedIn()) return '';
  return card(`Send ${esc(k.name)} a message`, `
    <form data-form="message">
      <textarea name="body" maxlength="${MESSAGE_MAX}" required aria-label="Your message"></textarea>
      <p class="small muted">Only ${esc(k.name)} can read this: it's sealed on this device before it's sent.</p>
      <div class="actions"><button class="primary" type="submit">Send</button></div>
    </form>`);
}

// A browser that only has the link: one Sign In button at the top of the page
// (decided 2026-10-08), to the public list with its sign-in opened (#signin).
function signInButton() {
  const v = state.v;
  if (signedIn() || !['applied', 'approved', 'active'].includes(v.family.status) || !v.kennel.public_id) return '';
  return `<div class="actions signin-top"><a class="button primary" href="/list/${encodeURIComponent(v.kennel.public_id)}#signin">Sign In</a></div>`;
}

function mineHtml() {
  const v = state.v;
  const f = v.family;
  const kennel = v.kennel.name;
  const st = STATUS[f.status] || { badge: 'plain', label: f.status };
  // No badge for a family on the list: being on it is why they're here.
  const parts = f.status === 'active' ? [] : [`<p><span class="badge ${st.badge}">${esc(st.label)}</span></p>`];
  if (state.flash) parts.push(`<p class="card notice-card small" role="status">${esc(state.flash)}</p>`);

  if (!['applied', 'approved', 'active'].includes(f.status)) {
    parts.push(card('', `<p class="mt0">${closedText(f.status, kennel)}</p>`));
    parts.push(companionHtml(f));
    parts.push(emailsHtml());
    return parts.join('');
  }

  if (f.status === 'applied') {
    parts.push(openCard('Thank you for applying', `<p class="mt0">${esc(kennel)} will review your application. This page will show their decision.</p>`));
  }

  if (f.fee_due) {
    const fee = f.fee_due;
    parts.push(openCard('Your application fee', `
      <p class="big mt0">${esc(money(fee.amount))}</p>
      ${fee.due_date ? `<p>Please pay by <strong>${esc(fmtDate(fee.due_date))}</strong>.</p>` : ''}
      ${fee.credit_policy ? `<p class="small muted">${esc(CREDIT_LABEL[fee.credit_policy] || '')}</p>` : ''}
      ${fee.instructions ? `<p class="small muted mt0">How to pay:</p><p class="pre mt0">${esc(fee.instructions)}</p>` : ''}
      <p class="small muted">Your place on the list is set from the day ${esc(kennel)} receives your fee.</p>`));
  }

  for (const rows of turnsOf(v.offers)) parts.push(turnHtml(rows));
  parts.push(companionHtml(f));
  parts.push(readyHtml(f));

  if (f.status === 'active') {
    const notices = [];
    if (f.paused_until) notices.push(`Your place is paused until ${esc(fmtDate(f.paused_until))}. You keep your place; you won't be offered a pup until then.`);
    if (f.ready_from) notices.push(`You said you'd be ready to buy later, so you won't be offered a pup before ${esc(fmtDate(f.ready_from))}. You keep your place.`);
    if (f.listen?.mode === 'selected') notices.push('You\'re only waiting for litters from the parents you chose. You keep your place for everything else.');
    else if (f.listen?.mode === 'except' && (f.listen.sire_ids?.length || f.listen.dam_ids?.length)) notices.push('You\'re skipping litters from the parents you chose. You keep your place for everything else.');
    parts.push(openCard('Current Position', `
      ${f.position ? `<p class="big mt0">#${esc(f.position)}</p><p class="muted mt0">${esc(kennel)}</p>` : placeHiddenHtml(f.place_hidden)}
      ${notices.map((n) => `<p class="small">${n}</p>`).join('')}
      <dl class="facts">
        ${f.fee_received_date ? `<dt>Added</dt><dd>${esc(fmtShortDate(f.fee_received_date))}</dd>` : ''}
        ${f.passes ? `<dt>Passes</dt><dd>${esc(f.passes.used)} of ${esc(f.passes.max)} used</dd>` : ''}
      </dl>
      ${placeActions(f)}`));
    parts.push(whelpNotesHtml(f));

    if (v.litters.length) {
      // Litters with open picks (decided 2026-10-08): breed, her nickname, sire ×
      // dam, the dates, and the pups still available by sex.
      const items = v.litters.map((l) => `<li>${litterHtml({
        breed: l.breed, name: l.nickname || l.label, dam: l.dam, sire: l.sire, when: litterDates(l),
        extra: `<div class="small">${esc(pupsRemaining(l))}</div>${notThisLitter(litterTarget(l))}`
      })}</li>`).join('');
      parts.push(card('Available Puppies', `<ul class="plain">${items}</ul>`));
    }
    parts.push(upcomingCard(v));
  } else if (canAct()) {
    parts.push(card('', placeActions(f)));
  }

  parts.push(card('What you asked for', prefsHtml(f)));
  parts.push(emailsHtml());
  parts.push(messageHtml());
  return parts.join('');
}

// --- Acting ------------------------------------------------------------------------

const ERRORS = {
  offer_closed: 'That offer has closed. The page now shows where things stand.',
  already_picked: 'You already chose a pup for this litter.',
  already_passed: 'You already passed on this litter.',
  pup_taken: 'Another family just chose that pup. Please pick another.',
  pup_not_offered: "That pup isn't one offered to you.",
  reason_required: 'Please choose a reason (and for "Other", a few words).',
  in_your_turn: "That litter is in your turn now: choose a pup or pass on the turn instead.",
  not_listed: "That litter isn't on the list any more.",
  not_prepassed: 'That was already taken back.',
  not_asked: 'That question has already been answered.',
  already_answered: "You've already answered. The breeder will see it at their next update.",
  not_on_list: "You can't do that right now; the page now shows where things stand.",
  bad_date: 'Please pick a date after today, within two years.',
  no_parents: 'Pick at least one sire or dam, or choose All litters.',
  nothing_to_change: "That's the same as your answers now.",
  not_yet: "The breeder hasn't added your application to their list yet. Try again later.",
  messages_off: "Messages aren't switched on for this waitlist.",
  form_changed: 'This page was out of date. It has been refreshed; please send your message again.',
  no_sale: "There's no puppy sale on record for you right now, so there's no Companion link to send. Contact the breeder with any questions.",
  already_requested: "You've already asked. The breeder will send your link by text or email.",
  other_family: 'This device is signed in as a different family. Sign out on the waitlist page and sign in again.',
};

async function send(path, body) {
  const r = await fetchJson(path, { method: 'POST', json: { session: state.session.session, status_token: token, ...body } });
  if (r.ok) return true;
  const code = r.body?.error;
  if (r.status === 401) {
    forgetFamily(state.v.kennel.public_id);
    state.session = null;
    state.flash = 'You were signed out on this device. Sign in again with a code to respond.';
  } else {
    state.flash = ERRORS[code] || loadError(r, { notFound: 'Something went wrong. Please try again.' });
  }
  return false;
}

async function act(action, extra, done) {
  if (await send('/f/act', { action, ...extra })) { state.open = null; state.flash = done; }
  await load();
}

async function onClick(ev) {
  const b = ev.target.closest('button[data-act]');
  if (!b || b.disabled) return;
  const kennel = state.v.kennel.name;
  switch (b.dataset.act) {
    case 'open':
      state.open = b.dataset.what; state.flash = ''; render();
      if (b.dataset.scroll) document.querySelector(`form[data-form="${state.open}"]`)?.scrollIntoView({ block: 'center' });
      return;
    case 'close': state.open = null; render(); return;
    case 'pick': {
      const offer = state.v.offers.find((o) => o.id === b.dataset.offer);
      if (!window.confirm(`Choose ${b.dataset.name}? Send your deposit by ${fmtDate(offer?.respond_by_date)} to keep them.`)) return;
      b.disabled = true;
      await act('pick', { offer_id: b.dataset.offer, dog_id: b.dataset.dog }, `You chose ${b.dataset.name}. ${kennel} will confirm, and holds them for you meanwhile.`);
      return;
    }
    case 'unprepass':
      b.disabled = true;
      await act('unprepass', b.dataset.litter ? { litter_id: b.dataset.litter } : { pairing_id: b.dataset.pairing }, 'Done. That litter is back in your turn when it comes.');
      return;
    case 'ready_yes':
      b.disabled = true;
      await act('ready', { answer: 'yes' }, `Thanks! ${kennel} will see that you're ready at their next update.`);
      return;
    case 'still_interested':
      b.disabled = true;
      await act('still_interested', {}, `Thanks! ${kennel} will see that you're still interested.`);
      return;
    default:
  }
}

async function onSubmit(ev) {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const data = new FormData(form);
  const kennel = state.v.kennel.name;
  switch (form.dataset.form) {
    case 'pass':
    case 'prepass': {
      const reasonId = String(data.get('reason_id') || '');
      const text = String(data.get('reason_text') || '').trim();
      if (!reasonId || (reasonId === 'other' && !text)) {
        state.flash = reasonId ? 'Please tell us a little more under "Other".' : 'Please choose a reason.';
        button.disabled = false;
        render();
        return;
      }
      const target = form.dataset.form === 'pass' ? { turn_id: data.get('turn_id') }
        : data.get('pairing_id') ? { pairing_id: data.get('pairing_id') } : { litter_id: data.get('litter_id') };
      await act(form.dataset.form, { ...target, reason_id: reasonId, reason_text: text }, reasonMessage(reasonId));
      return;
    }
    case 'ready_no': {
      const reason = String(data.get('reason') || '').trim();
      if (!reason) { state.flash = 'Please tell us why not yet.'; button.disabled = false; render(); return; }
      await act('ready', { answer: 'no', until: data.get('until'), reason }, `Thanks for letting us know. ${kennel} decides on pausing your place; until then you won't be offered a pup.`);
      return;
    }
    case 'pause':
      await act('pause_request', { until: data.get('until'), note: data.get('note') }, `Your pause request is on its way. ${kennel} decides; until then nothing changes.`);
      return;
    case 'companion':
      await act('companion_request', { note: data.get('note') }, `Your request is on its way. ${kennel} will send your Companion link by text or email.`);
      return;
    case 'leave':
      await act('leave', { note: data.get('note') }, `${kennel} will see that you're leaving at their next update.`);
      return;
    case 'pref_change': {
      const prefs = state.v.family.prefs;
      const changes = {};
      for (const f of editableFields()) {
        if (f.key === 'pref_colors') {
          const colors = String(data.get('pref_colors') || '').split(',').map((c) => c.trim()).filter(Boolean);
          if (colors.join(',').toLowerCase() !== (prefs.colors || []).join(',').toLowerCase()) changes.pref_colors = colors;
        } else {
          const value = String(data.get(f.key) ?? '');
          const now = f.key === 'pref_sex' ? (prefs.sex || 'any') : (prefs[f.prefs] || '');
          if (value !== now) changes[f.key] = value;
        }
      }
      // Parents (listen-only) ride the same form but are their own action.
      let listen = null;
      if (canChooseParents()) {
        const mode = ['selected', 'except'].includes(data.get('mode')) ? data.get('mode') : 'all';
        const next = { mode, sire_ids: mode !== 'all' ? data.getAll('sire') : [], dam_ids: mode !== 'all' ? data.getAll('dam') : [] };
        const cur = state.v.family.listen || { mode: 'all', sire_ids: [], dam_ids: [] };
        const same = (a, b) => [...(a || [])].sort().join() === [...(b || [])].sort().join();
        const curMode = ['selected', 'except'].includes(cur.mode) ? cur.mode : 'all';
        if (next.mode !== curMode || (next.mode !== 'all' && (!same(next.sire_ids, cur.sire_ids) || !same(next.dam_ids, cur.dam_ids)))) listen = next;
      }
      if (!Object.keys(changes).length && !listen) { state.flash = ERRORS.nothing_to_change; button.disabled = false; render(); return; }
      const done = `Your request is on its way. ${kennel} decides; until then nothing changes.`;
      if (listen && !Object.keys(changes).length) { await act('listen', listen, `Saved. ${kennel} will see it at their next update.`); return; }
      if (listen && !(await send('/f/act', { action: 'listen', ...listen }))) { await load(); return; }
      await act('pref_change', { changes, note: data.get('note') }, done);
      return;
    }
    case 'message': {
      const body = String(data.get('body') || '').trim().slice(0, MESSAGE_MAX);
      if (!body) { button.disabled = false; return; }
      const key = state.v.kennel.message_key;
      let sealed;
      try { sealed = await seal(key.public_key, key.key_id, { body }); } catch {
        state.flash = "This browser couldn't seal your message. Please try another browser.";
        render();
        return;
      }
      const ok = await send('/f/message', { key_id: key.key_id, sealed });
      if (ok) state.flash = `Sent. ${kennel} will see it next time they open KennelOS.`;
      await load();
      return;
    }
    default:
  }
}

// --- Loading -----------------------------------------------------------------------

function selectTab(which) {
  const mine = which === 'mine';
  $('tab-mine').setAttribute('aria-selected', String(mine));
  $('tab-list').setAttribute('aria-selected', String(!mine));
  $('mine').hidden = !mine;
  $('public').hidden = mine;
}

function render() {
  // Keep the sections they opened open (card()).
  for (const d of $('mine').querySelectorAll('details[data-key]')) {
    if (d.open) state.opened.add(d.dataset.key); else state.opened.delete(d.dataset.key);
  }
  $('mine').innerHTML = mineHtml();
  $('signin-slot').innerHTML = signInButton();
  $('mine').hidden = $('tab-list').getAttribute('aria-selected') === 'true';
}

let wired = false;
async function load() {
  const res = await fetchJson(`/f/status/${encodeURIComponent(token)}`);
  if (!res.ok) {
    $('error').textContent = loadError(res, { notFound: "This link doesn't work any more. The breeder may have sent you a newer one, or you can ask them for it." });
    $('error').hidden = false;
    $('mine').hidden = true;
    return;
  }
  const v = res.body;
  state.v = v;
  // This browser's family session for this kennel, if it signed in. Whether it's
  // THIS family's is the server's call (other_family): a New link changes the
  // token but keeps the session, so the saved token isn't compared here.
  state.session = v.kennel.public_id ? rememberedFamily(v.kennel.public_id) : null;
  document.title = `${v.kennel.name} Waitlist`;
  $('title').textContent = v.family.name ? `Hi, ${v.family.name.split(/\s+/)[0]}` : `${v.kennel.name} Waitlist`;
  $('updated').textContent = `${v.kennel.name} Waitlist${v.as_of ? ` · updated ${fmtDate(v.as_of)}` : ''}`;
  render();

  if (!wired) {
    wired = true;
    $('mine').addEventListener('click', (ev) => { onClick(ev).catch(() => {}); });
    $('mine').addEventListener('submit', (ev) => { onSubmit(ev).catch(() => {}); });
    if (v.public_list.length) {
      $('tabs').hidden = false;
      const renderList = () => { $('list').innerHTML = publicListHtml(state.v.public_list, $('search').value, state.v.family.position || null); };
      $('search').addEventListener('input', renderList);
      renderList();
      $('tab-mine').addEventListener('click', () => selectTab('mine'));
      $('tab-list').addEventListener('click', () => selectTab('list'));
    }
  }
}

load();
