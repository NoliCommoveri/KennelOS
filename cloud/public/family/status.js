// A family's own status page: /s/<token> (Waitlist Spec §8.3; W2 Plan §5).
// Read-only for now: their place, their offers and the pups in them, the fee
// while it's unpaid, the litters and their place in each, and the public list.
// The buttons (accept, pass, pause request…) come with W2 step 5.
import { esc, fmtDate, money, fetchJson, loadError, publicListHtml, possessive, SEX_LABEL, READY_LABEL, PLACEMENT_LABEL, CREDIT_LABEL } from './common.js';

const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/')[2] || '';

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

// One line about a litter: "Expected", "Born Sep 1, 2026 · ready about Oct 27", …
function litterLine(l) {
  const bits = [];
  if (l.status === 'expected' || !l.whelp_date) bits.push('Expected');
  else bits.push(`Born ${fmtDate(l.whelp_date)}`);
  if (l.status === 'ready') bits.push('ready to go home');
  else if (l.ready_date) bits.push(`ready about ${fmtDate(l.ready_date)}`);
  if (l.picks_open) bits.push('picks are open');
  return bits.join(' · ');
}

function litterBadge(l) {
  if (l.your_position) return `<span class="badge">#${esc(l.your_position)} in line</span>`;
  if (!l.pups_available) return `<span class="badge plain">${l.status === 'expected' ? 'No pups yet' : 'No pups available'}</span>`;
  return '<span class="badge plain">Not a match for you</span>';
}

function card(title, body, cls = '') {
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

function prefsHtml(prefs) {
  if (!prefs) return '';
  const rows = [
    ['Sex', SEX_LABEL[prefs.sex] || 'Either'],
    ['Breed', prefs.breed || 'Any'],
    ['Placement', PLACEMENT_LABEL[prefs.placement] || 'Any'],
    ['Colors', prefs.colors?.length ? prefs.colors.join(', ') : 'Any'],
    ['Ready to buy', READY_LABEL[prefs.ready_timing] || 'Not answered'],
  ];
  return `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <p class="small muted">To change any of these, contact the breeder.</p>`;
}

function offerHtml(o, kennel, timeZone) {
  const zone = timeZone ? ` (${esc(timeZone.replace(/_/g, ' '))} time)` : '';
  const pups = o.pups.length
    ? `<div class="pups">${o.pups.map((d) => `<span class="pup">${esc(d.call_name)} · ${esc(SEX_LABEL[d.sex] || '')}${d.color ? ` · ${esc(d.color)}` : ''}${d.id === o.picked_dog_id ? ' <span class="badge">Your pick</span>' : ''}</span>`).join('')}</div>`
    : '';
  const picked = o.picked_dog_id
    ? '<p>You picked a pup. Send your deposit by the date above to keep them.</p>'
    : `<p>Contact ${esc(kennel)} to choose a pup or to pass on this litter.</p>`;
  return card("It's your turn!", `
    <p class="mt0"><strong>${esc(o.litter)}</strong></p>
    <p>Please respond by <strong>11:59 pm on ${esc(fmtDate(o.respond_by_date, { weekday: true }))}</strong>${zone}.</p>
    ${pups ? `<p class="small muted mt0">Pups available to you:</p>${pups}` : ''}
    ${picked}`, 'turn');
}

function mineHtml(v) {
  const f = v.family;
  const kennel = v.kennel.name;
  const st = STATUS[f.status] || { badge: 'plain', label: f.status };
  const parts = [`<p><span class="badge ${st.badge}">${esc(st.label)}</span></p>`];

  if (!['applied', 'approved', 'active'].includes(f.status)) {
    parts.push(card('', `<p class="mt0">${closedText(f.status, kennel)}</p>`));
    return parts.join('');
  }

  if (f.status === 'applied') {
    parts.push(card('Thank you for applying', `<p class="mt0">${esc(kennel)} will review your application. This page will show their decision.</p>`));
  }

  if (f.fee_due) {
    const fee = f.fee_due;
    parts.push(card('Your application fee', `
      <p class="big mt0">${esc(money(fee.amount))}</p>
      ${fee.due_date ? `<p>Please pay by <strong>${esc(fmtDate(fee.due_date))}</strong>.</p>` : ''}
      ${fee.credit_policy ? `<p class="small muted">${esc(CREDIT_LABEL[fee.credit_policy] || '')}</p>` : ''}
      ${fee.instructions ? `<p class="small muted mt0">How to pay:</p><p class="pre mt0">${esc(fee.instructions)}</p>` : ''}
      <p class="small muted">Your place on the list is set from the day ${esc(kennel)} receives your fee.</p>`));
  }

  for (const o of v.offers) parts.push(offerHtml(o, kennel, v.kennel.time_zone));

  if (f.status === 'active') {
    const notices = [];
    if (f.paused_until) notices.push(`Your place is paused until ${esc(fmtDate(f.paused_until))}. You keep your place; you won't be offered a pup until then.`);
    if (f.ready_from) notices.push(`You said you'd be ready to buy later, so you won't be offered a pup before ${esc(fmtDate(f.ready_from))}. You keep your place.`);
    if (f.listen?.mode === 'selected') notices.push('You\'re only waiting for litters from the parents you chose. You keep your place for everything else.');
    parts.push(card('Your place', `
      ${f.position ? `<p class="big mt0">#${esc(f.position)}</p><p class="muted mt0">on ${esc(possessive(kennel))} waitlist</p>` : ''}
      ${notices.map((n) => `<p class="small">${n}</p>`).join('')}
      <dl class="facts">
        ${f.fee_received_date ? `<dt>On the list since</dt><dd>${esc(fmtDate(f.fee_received_date))}</dd>` : ''}
        ${f.passes ? `<dt>Passes used</dt><dd>${esc(f.passes.used)} of ${esc(f.passes.max)}</dd>` : ''}
      </dl>`));

    if (v.litters.length) {
      const items = v.litters.map((l) => `<li><div class="row"><strong>${esc(l.label)}</strong>
          <span class="small">${litterBadge(l)}</span></div>
        <div class="small muted">${esc(litterLine(l))}</div></li>`).join('');
      parts.push(card('Litters', `<ul class="plain">${items}</ul>
        <p class="small muted">"In line" counts only families who match that litter's pups.</p>`));
    }
  }

  parts.push(card('What you asked for', prefsHtml(f.prefs)));
  return parts.join('');
}

function selectTab(which) {
  const mine = which === 'mine';
  $('tab-mine').setAttribute('aria-selected', String(mine));
  $('tab-list').setAttribute('aria-selected', String(!mine));
  $('mine').hidden = !mine;
  $('public').hidden = mine;
}

async function load() {
  const res = await fetchJson(`/f/status/${encodeURIComponent(token)}`);
  if (!res.ok) {
    $('error').textContent = loadError(res, { notFound: "This link doesn't work any more. The breeder may have sent you a newer one, or you can ask them for it." });
    $('error').hidden = false;
    return;
  }
  const v = res.body;
  document.title = `${v.kennel.name} waitlist`;
  $('title').textContent = v.family.name ? `Hi, ${v.family.name.split(/\s+/)[0]}` : `${v.kennel.name} waitlist`;
  $('updated').textContent = `${v.kennel.name} waitlist${v.as_of ? ` · updated ${fmtDate(v.as_of)}` : ''}`;
  $('mine').innerHTML = mineHtml(v);
  $('mine').hidden = false;

  if (v.public_list.length) {
    $('tabs').hidden = false;
    const render = () => { $('list').innerHTML = publicListHtml(v.public_list, $('search').value, v.family.position || null); };
    $('search').addEventListener('input', render);
    render();
    $('tab-mine').addEventListener('click', () => selectTab('mine'));
    $('tab-list').addEventListener('click', () => selectTab('list'));
  }
}

load();
