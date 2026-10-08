// The public list page: /list/<kennel public_id> (Waitlist Spec §15.3; W2 Plan §5).
// Everyone on the list, however many, with a search box that filters in this
// browser (nothing typed is sent anywhere), and "See Your Details": a family
// signs in with a code emailed to the address on their application, and this
// browser remembers them for 90 days.
import { esc, fetchJson, fmtDate, loadError, publicListHtml, rowMatches, possessive, upcomingListHtml } from './common.js';
import { rememberFamily, rememberedFamily, forgetFamily } from './session.js';

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
  const token = r.ok ? r.body.status_token : saved.statusToken;
  $('open-mine').href = statusPath(token);
  $('remembered').hidden = false;
  $('signin').hidden = true;
  return true;
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

async function load() {
  const res = await fetchJson(`/f/list/${encodeURIComponent(publicId)}`);
  if (!res.ok) {
    showError(loadError(res, { notFound: "This waitlist isn't online. The breeder may have taken it down, or the link is incomplete." }));
    return;
  }
  const { kennel, as_of: asOf, rows, upcoming = [] } = res.body;
  document.title = `${kennel.name} waitlist`;
  $('title').textContent = `${kennel.name} waitlist`;
  $('updated').textContent = asOf ? `Updated ${fmtDate(asOf)}` : '';
  // Her online application form, when she takes applications online.
  if (kennel.apply_open) {
    $('apply-link').href = `/apply/${encodeURIComponent(publicId)}`;
    $('apply').hidden = false;
  }
  $('content').hidden = false;
  // Pairings and litters she shows publicly before picks open (Spec §16.4).
  if (upcoming.length) {
    $('upcoming').innerHTML = `<h2>Coming up</h2>${upcomingListHtml(upcoming)}`;
    $('upcoming').hidden = false;
  }

  const render = () => {
    const q = $('search').value;
    $('list').innerHTML = publicListHtml(rows, q);
    const n = rows.filter((r) => rowMatches(r, q)).length;
    $('count').textContent = q.trim()
      ? `${n} of ${rows.length} ${rows.length === 1 ? 'family' : 'families'}`
      : `${rows.length} ${rows.length === 1 ? 'family' : 'families'} on the list`;
  };
  $('search').addEventListener('input', render);
  render();
  wireSignIn(kennel);
  await showRemembered();
}

load();
