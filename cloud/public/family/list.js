// The public list page: /list/<kennel public_id> (Waitlist Spec §15.3; W2 Plan §5).
// Everyone on the list, however many, with a search box that filters in this
// browser (nothing typed is sent anywhere), and "See Your Details": a family
// signs in with a code emailed to the address on their application, and this
// browser remembers them for 90 days. Inside her own website (embedded.js), the
// form and a family's status page open in a new tab instead.
import { esc, fetchJson, fmtDate, fmtShortDate, countdownHtml, loadError, publicListHtml, possessive, upcomingListHtml, availableItemHtml, policiesHtml, openPolicy, startCountdowns } from './common.js';
import { rememberFamily, rememberedFamily, forgetFamily } from './session.js';
import { EMBEDDED, setupEmbed, outward } from './embedded.js';
import { applyTheme, savedTheme, showLogo } from './theme.js';

// The palette a family chose on their status page, if this browser has one.
applyTheme(savedTheme());

const $ = (id) => document.getElementById(id);
const publicId = decodeURIComponent(location.pathname.split('/')[2] || '');

function showError(text) {
  $('error').textContent = text;
  $('error').hidden = false;
}

const statusPath = (token) => `/s/${encodeURIComponent(token)}`;

// A browser that signed in before: ask for the family's current link (it changes
// if the breeder makes a new one). Signed out or expired: back to the code form.
async function showRemembered() {
  const saved = rememberedFamily(publicId);
  if (!saved) return false;
  const r = await fetchJson('/f/session', { method: 'POST', json: { session: saved.session } });
  if (r.status === 401) { forgetFamily(publicId); return false; }
  showSignedIn(r.ok ? r.body.status_token : saved.statusToken);
  return true;
}

// "You're signed in" with the button to their page.
function showSignedIn(token) {
  $('open-mine').href = statusPath(token);
  outward($('open-mine'));
  $('remembered').hidden = false;
  $('signin').hidden = true;
}

function wireSignIn(kennel) {
  $('code-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const button = $('code-form').querySelector('button');
    button.disabled = true;
    const r = await fetchJson('/f/verify', { method: 'POST', json: { public_id: publicId, code: $('code').value } });
    button.disabled = false;
    if (r.ok) {
      rememberFamily(publicId, { session: r.body.session, statusToken: r.body.status_token, expiresAt: r.body.expires_at });
      // Framed: her private page opens in its own tab, from the "Open my page" button.
      // (Not read back from storage: a framed page's storage may be blocked.)
      if (EMBEDDED) { showSignedIn(r.body.status_token); return; }
      location.assign(statusPath(r.body.status_token));
      return;
    }
    const code = r.body?.error;
    $('code-result').textContent = code === 'invalid_code' || code === 'bad_code'
      ? "That code didn't work. Codes last 15 minutes and work once; you can send yourself a new one below."
      : loadError(r, { notFound: 'Please try again.' });
  });

  $('email-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const button = $('email-form').querySelector('button');
    button.disabled = true;
    const email = $('email').value.trim();
    const r = await fetchJson('/f/code', { method: 'POST', json: { public_id: publicId, email } });
    button.disabled = false;
    $('email-result').innerHTML = r.ok
      ? `If <strong>${esc(email)}</strong> is on ${esc(possessive(kennel.name))} waitlist, a new code is on its way. Enter it above. Check your spam folder if it doesn't arrive in a few minutes.`
      : esc(r.body?.error === 'bad_email' ? "That email address doesn't look right." : loadError(r, { notFound: 'Please try again.' }));
    if (r.ok) $('code').focus();
  });

  $('sign-out').addEventListener('click', () => {
    forgetFamily(publicId);
    $('remembered').hidden = true;
    $('signin').hidden = false;
  });
}

// The pop-up on opening the public list (owner, 2026-11-19): every born litter she
// shows on the list whose picks haven't opened yet (not taking deposits), one group
// per litter (its name and birth date) with the countdown to picks opening. Shown
// to everyone, signed in or not, once per visit, closed with "Got it". Litters with
// picks open aren't in it (they're under Available Puppies). Not inside her own
// website: a framed page grows to fit, so a pop-up there could land off screen.
// Soonest opening first; a litter with no opening day planned yet last.
function openingSoonPopup(upcoming) {
  const born = upcoming.filter((u) => u.kind === 'early_litter');
  if (!born.length || EMBEDDED) return;
  const at = (u) => { const t = Date.parse(u.picks_expected_at || ''); return Number.isFinite(t) ? t : Infinity; };
  const groups = [...born].sort((a, b) => at(a) - at(b)).map((u) => `<div class="popup-litter">
      <h3>${esc(u.label || 'Litter')}</h3>
      ${u.whelp_date ? `<p class="small muted">Born ${esc(fmtShortDate(u.whelp_date))}</p>` : ''}
      ${Number.isFinite(at(u))
        ? `<p class="popup-time">${countdownHtml(u.picks_expected_at, { label: 'Picks open in', done: 'Picks are due to open now' })}</p>`
        : '<p class="muted">Opening date coming soon</p>'}
    </div>`).join('');
  const before = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal status-popup public-popup" role="dialog" aria-modal="true" aria-labelledby="lp-title">
      <h2 id="lp-title">Picks opening soon</h2>
      ${groups}
      <div class="modal-actions"><button type="button" class="primary" data-lp="close">Got it</button></div>
    </div>`;
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(); } };
  const done = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (before && typeof before.focus === 'function' && before.isConnected) before.focus();
  };
  overlay.querySelector('[data-lp="close"]').addEventListener('click', done);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.querySelector('[data-lp="close"]').focus();
  startCountdowns();
}

async function load() {
  const res = await fetchJson(`/f/list/${encodeURIComponent(publicId)}`);
  if (!res.ok) {
    showError(loadError(res, { notFound: "This waitlist isn't online. The breeder may have taken it down, or the link is incomplete." }));
    return;
  }
  const { kennel, as_of: asOf, rows, selected = [], available = [], upcoming = [] } = res.body;
  document.title = `${kennel.name} Waitlist`;
  showLogo($('kennel-logo'), kennel);
  $('title').textContent = `${kennel.name} Waitlist`;
  if (kennel.name) $('footer').textContent = `For questions or concerns, please contact ${kennel.name}.`;
  // Her message under the heading (plain text; line breaks kept by the CSS).
  if (kennel.intro) {
    $('intro').textContent = kennel.intro;
    $('intro').hidden = false;
  }
  $('updated').textContent = asOf ? `Updated ${fmtDate(asOf)}` : '';
  // Her online application form, when she takes applications online.
  if (kennel.apply_open) {
    $('apply-link').href = `/apply/${encodeURIComponent(publicId)}`;
    outward($('apply-link'));
    $('apply').hidden = false;
  }
  $('content').hidden = false;
  // Litters with open picks, as on a family's own page (decided 2026-10-10).
  if (kennel.policies?.length) {
    $('policies').innerHTML = `<summary><h2>Our Waitlist Policies</h2></summary>${kennel.policies_updated ? `<p class="small muted mt0">Updated ${esc(fmtDate(kennel.policies_updated))}</p>` : ''}${policiesHtml(kennel)}`;
    $('policies').hidden = false;
    if (location.hash === '#policies') openPolicy($('policies'));
  }
  if (available.length) {
    $('available').innerHTML = `<summary><h2>Available Puppies</h2></summary><ul class="plain segs">${available.map((l) => `<li>${availableItemHtml(l)}</li>`).join('')}</ul>`;
    $('available').hidden = false;
  }
  // Pairings and litters she shows publicly before picks open (Spec §16.4).
  if (upcoming.length) {
    $('upcoming').innerHTML = `<summary><h2>Coming up</h2></summary>${upcomingListHtml(upcoming)}`;
    $('upcoming').hidden = false;
    startCountdowns(); // Picks open in… on a born litter
  }

  // No family count (decided 2026-10-10): paused families are left off the list,
  // so a count of rows is never how many are on it.
  const render = () => { $('list').innerHTML = publicListHtml(rows, $('search').value, null, selected); };
  $('search').addEventListener('input', render);
  render();
  wireSignIn(kennel);
  if (location.hash !== '#signin') openingSoonPopup(upcoming);
  await showRemembered();
  // From a status page's Sign In button: open the sign-in and bring it into view.
  if (location.hash === '#signin') {
    $('details').open = true;
    $('details').scrollIntoView({ block: 'start' });
    $('code')?.focus({ preventScroll: true });
  }
}

setupEmbed();
load();
