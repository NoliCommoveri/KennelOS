// The public list page: /list/<kennel public_id> (Waitlist Spec §15.3; W2 Plan §5).
// Everyone on the list, however many, with a search box that filters in this
// browser (nothing typed is sent anywhere), and "Email me my link".
import { esc, fmtDate, fetchJson, loadError, publicListHtml, rowMatches, possessive } from './common.js';

const $ = (id) => document.getElementById(id);
const publicId = decodeURIComponent(location.pathname.split('/')[2] || '');

function showError(text) {
  $('error').textContent = text;
  $('error').hidden = false;
}

async function load() {
  const res = await fetchJson(`/f/list/${encodeURIComponent(publicId)}`);
  if (!res.ok) {
    showError(loadError(res, { notFound: "This waitlist isn't online. The breeder may have taken it down, or the link is incomplete." }));
    return;
  }
  const { kennel, as_of: asOf, rows } = res.body;
  document.title = `${kennel.name} waitlist`;
  $('title').textContent = `${kennel.name} waitlist`;
  $('updated').textContent = asOf ? `Updated ${fmtDate(asOf)}` : '';
  $('content').hidden = false;

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

  $('link-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const button = ev.submitter || $('link-form').querySelector('button');
    button.disabled = true;
    const r = await fetchJson('/f/link', { method: 'POST', json: { public_id: publicId, email: $('link-email').value } });
    button.disabled = false;
    $('link-result').innerHTML = r.ok
      ? `If <strong>${esc($('link-email').value.trim())}</strong> is on ${esc(possessive(kennel.name))} list, your link is on its way. Check your spam folder if it doesn't arrive in a few minutes.`
      : esc(r.status === 400 ? 'That email address doesn\'t look right.' : loadError(r, { notFound: 'Please try again.' }));
  });
}

load();
