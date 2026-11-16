// The manager app's files (assist.js serves them under /manager/): support's
// installable page for assisted setup and help, and the template library (People and
// Templates, esignLibrary.js). One page, its script and its service worker (pushes),
// a manifest and two icons.
//
// The page script and the service worker are real functions here, sent as their
// own source (fn.toString()), so they're checked like any other code and need no
// build step. They run in the browser, not the Worker: no imports, no closures.
import { ICON_192, ICON_512 } from './assistIcons.js';

const CSS = `
:root { color-scheme: light; --bg: #F4F1EA; --surface: #FFFFFF; --ink: #1D2321; --muted: #5E6763; --line: #D9D4C8;
  --accent: #184A45; --accent-ink: #F5F0E4; --warm: #E8B04A; --bad: #A3261E; --ok: #2F6B3A; --soft: #E3ECE8; }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --bg: #121615; --surface: #1B2120; --ink: #E7ECE9;
  --muted: #9DA8A3; --line: #2E3735; --accent: #7FB8AE; --accent-ink: #0F1A18; --soft: #22302D; --bad: #F08A80; --ok: #86C495; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 2; background: var(--accent); color: var(--accent-ink);
  padding: calc(10px + env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) 10px max(16px, env(safe-area-inset-left, 0px));
  display: flex; align-items: center; gap: 10px; }
header b { font-size: 17px; margin-right: auto; }
header button { background: transparent; color: inherit; border: 1px solid currentColor; }
main { max-width: 640px; margin: 0 auto; padding: 14px max(16px, env(safe-area-inset-left, 0px)) 40px; display: grid; gap: 12px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: grid; gap: 10px; min-width: 0; }
h2 { font-size: 16px; margin: 0; }
p { margin: 0; }
.muted { color: var(--muted); font-size: 13px; }
label { display: grid; gap: 4px; font-weight: 600; font-size: 13px; }
label.check { display: flex; gap: 8px; align-items: flex-start; font-weight: 400; font-size: 14px; }
input { font: inherit; color: var(--ink); background: var(--bg); border: 1.5px solid var(--line); border-radius: 8px; padding: 9px 10px; width: 100%; min-height: 42px; }
label.check input { width: auto; min-height: 0; margin-top: 3px; }
button { font: inherit; font-weight: 700; font-size: 14px; min-height: 40px; padding: 8px 14px; border-radius: 8px; border: 1.5px solid var(--accent);
  background: transparent; color: var(--accent); cursor: pointer; }
button.solid { background: var(--accent); color: var(--accent-ink); }
button.danger { border-color: var(--bad); color: var(--bad); }
button:disabled { opacity: .5; cursor: default; }
:focus-visible { outline: 2px solid var(--warm); outline-offset: 2px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.state::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.state.setup { color: var(--accent); } .state.requested { color: #B66A00; } .state.helping { color: var(--ok); }
.link { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; background: var(--soft); border-radius: 8px; padding: 8px; user-select: all; }
.events { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; font-size: 13px; color: var(--muted); }
.note { background: var(--soft); border-radius: 8px; padding: 10px; font-size: 13px; }
.err { color: var(--bad); font-size: 13px; font-weight: 600; }
details summary { cursor: pointer; font-weight: 700; color: var(--accent); }
.tabs { display: flex; gap: 6px; max-width: 640px; margin: 0 auto; padding: 12px max(16px, env(safe-area-inset-left, 0px)) 0; }
.tabs button { flex: 1; } .tabs button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); }
textarea { font: inherit; color: var(--ink); background: var(--bg); border: 1.5px solid var(--line); border-radius: 8px; padding: 9px 10px; width: 100%; min-height: 60px; resize: vertical; }
fieldset { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin: 0; display: grid; gap: 6px; min-width: 0; }
legend { font-weight: 600; font-size: 13px; padding: 0 4px; }
.toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); background: var(--ink); color: var(--bg);
  padding: 10px 14px; border-radius: 8px; font-size: 14px; max-width: calc(100vw - 32px); }
`;

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="theme-color" content="#184A45">
<title>KennelOS Assist</title>
<link rel="manifest" href="/manager/manifest.webmanifest"><link rel="icon" href="/manager/icon-192.png">
<link rel="apple-touch-icon" href="/manager/icon-192.png">
<style>${CSS}</style></head><body>
<header><b>KennelOS Assist</b><button type="button" id="refresh" hidden>Refresh</button><button type="button" id="logout" hidden>Sign out</button></header>
<nav class="tabs" id="tabs" hidden><button type="button" data-view="people" aria-pressed="true">People</button><button type="button" data-view="templates" aria-pressed="false">Templates</button></nav>
<main id="main"><p class="muted">Loading…</p></main>
<script src="/manager/app.js" defer></script></body></html>`;

// ---------- the page (runs in the browser) ----------
function managerPage() {
  const main = document.getElementById('main');
  const STATE = { setup: 'Setting up', idle: 'Hers', requested: 'Asked for help', helping: 'You’re helping' };
  const ERRORS = {
    wrong_token: 'That token didn’t match.', account_exists: 'That email already has an account. Delete it below first, then start again.',
    bad_email: 'Check the email address.', label_required: 'Give her a name you’ll recognise.', no_account: 'No account uses that email.',
    confirm_required: 'Type DELETE to confirm.', look_up_first: 'Look the account up first.',
    lookup_expired: 'That look-up is over ten minutes old. Look the account up again.',
    account_changed: 'Nothing was deleted: the account changed since you looked it up (a device synced, backed up or signed in). Look it up again.',
    help_not_requested: 'She hasn’t asked for help. She presses Get help in her app first.',
    maintenance: 'The server is in maintenance (a migration is waiting on /ops).',
    library_not_set_up: 'That account hasn’t set up e-signing. Sign in to it in KennelOS and press Set up e-signing on Contracts → Contract templates, then link it.',
    library_not_linked: 'Link the library account first.', template_missing: 'That template isn’t in the library any more.',
    esign_unavailable: 'Firma didn’t answer. Try again in a minute.', esign_not_configured: 'Firma isn’t set up on the server (FIRMA_API_KEY).',
  };
  let view = location.hash === '#templates' ? 'templates' : 'people';
  let lastLink = null;
  let toDelete = null; // the account looked up for Delete, until it's deleted or cancelled
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (iso) => {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    if (mins < 48 * 60) return Math.round(mins / 60) + ' h ago';
    return new Date(iso).toLocaleDateString();
  };
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
  }
  async function api(path, body) {
    const res = await fetch('/manager/api/' + path, body === undefined ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(ERRORS[data.error] || ('Refused: ' + (data.error || res.status))); e.code = data.error; throw e; }
    return data;
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { toast('Select the link and copy it'); }
  }

  function loginView(msg) {
    document.getElementById('logout').hidden = true;
    document.getElementById('refresh').hidden = true;
    document.getElementById('tabs').hidden = true;
    main.innerHTML = '<form class="card" id="login"><h2>Sign in</h2><p class="muted">Use the ops token, as on /ops.</p>'
      + '<label for="tok">Ops token<input id="tok" type="password" autocomplete="current-password" required></label>'
      + (msg ? '<p class="err">' + esc(msg) + '</p>' : '') + '<button class="solid">Sign in</button></form>';
    document.getElementById('login').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('login', { token: document.getElementById('tok').value }); render(); } catch (err) { loginView(err.message); }
    });
  }

  async function pushState(key) {
    if (!key || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unavailable';
    const reg = await navigator.serviceWorker.getRegistration('/manager/');
    const sub = reg && await reg.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  }
  function keyBytes(b64) {
    const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }
  async function turnOnPush(key) {
    const reg = await navigator.serviceWorker.register('/manager/sw.js', { scope: '/manager/' });
    await navigator.serviceWorker.ready;
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this app in your phone’s settings.');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    await api('push', { endpoint: sub.endpoint });
  }

  const sizeText = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB');
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString() : 'never');
  // What only this account has, shown before the delete can be pressed (review K05-2).
  function deleteConfirmHtml(a) {
    const counts = a.latestSnapshot && a.latestSnapshot.counts
      ? Object.keys(a.latestSnapshot.counts).filter((k) => a.latestSnapshot.counts[k]).map((k) => a.latestSnapshot.counts[k] + ' ' + k).join(', ') : '';
    return '<form id="del" class="card" style="border:0;padding:0">'
      + '<p>You typed <strong>' + esc(a.typed) + '</strong>. Is this her account?</p>'
      + '<ul class="events">'
      + '<li>Made ' + esc(stamp(a.createdAt)) + '</li>'
      + '<li>Newest cloud backup: ' + (a.latestSnapshot ? esc(stamp(a.latestSnapshot.createdAt) + ', ' + sizeText(a.latestSnapshot.size) + (counts ? ' (' + counts + ')' : '')) : 'none') + '</li>'
      + '<li>' + esc(a.snapshots) + ' backup(s), ' + esc(a.records) + ' synced record(s)' + (a.vault ? ', private records on' : '') + (a.waitlist ? ', waitlist online' : '') + '</li>'
      + '<li>' + (a.assist ? 'Support set up or helped this account as “' + esc(a.assist.label) + '”' : 'Support never set up or helped this account') + '</li>'
      + (a.devices.length ? a.devices.map((d) => '<li>' + esc(d.label || 'Unnamed device') + (d.helper ? ' (support)' : '') + ': last seen ' + esc(stamp(d.lastSeen)) + (d.live ? '' : ', signed out') + '</li>').join('') : '<li>No devices</li>')
      + '</ul>'
      + '<p class="muted">Everything the account holds in the cloud goes. A Pro purchase stays on record.</p>'
      + '<label class="check"><input id="d-erase" type="checkbox"> Also erase its devices when they next open: only for a fresh start where nothing on them is worth keeping (they free their Pro activations and drop its passkeys). A device that doesn’t open KennelOS within 90 days keeps its copy.</label>'
      + '<label for="d-confirm">Type DELETE to confirm<input id="d-confirm" autocomplete="off" required></label>'
      + '<div class="row"><button class="danger">Delete this account</button><button type="button" id="del-cancel">Cancel</button></div></form>';
  }

  function programCard(p) {
    const canLink = p.state !== 'idle';
    const canEnd = p.helperSignedIn || p.state === 'requested' || p.state === 'helping';
    const showLink = lastLink && lastLink.programId === p.programId;
    return '<section class="card"><div class="row" style="justify-content:space-between"><h2>' + esc(p.label) + '</h2>'
      + '<span class="state ' + esc(p.state) + '">' + esc(STATE[p.state] || p.state) + '</span></div>'
      + '<p class="muted">Her devices last seen ' + esc(when(p.herLastSeen)) + ' · your device ' + (p.helperSignedIn ? 'signed in' : 'not signed in') + '</p>'
      + (p.state === 'requested' ? '<p class="note">She’s waiting. Make a link and open it in her browser profile on your computer; her app hands over her private records by itself while it’s open.</p>' : '')
      + (p.state === 'setup' && !p.helperSignedIn ? '<p class="note">Open the link in a browser profile kept for her alone. When help ends, KennelOS wipes that profile’s copy.</p>' : '')
      + (showLink ? '<div class="link">' + esc(lastLink.link) + '</div><div class="row"><button data-copy="' + esc(lastLink.link) + '">Copy link</button>'
        + '<span class="muted">Works once, for 15 minutes.</span></div>' : '')
      + '<div class="row">' + (canLink ? '<button data-link="' + esc(p.programId) + '">' + (showLink ? 'New link' : 'Make link') + '</button>' : '')
      + (canEnd ? '<button class="danger" data-end="' + esc(p.programId) + '">End help</button>' : '') + '</div>'
      + (p.events.length ? '<ul class="events">' + p.events.map((e) => '<li>' + esc(when(e.at)) + ': ' + esc(e.text) + '</li>').join('') + '</ul>' : '')
      + '</section>';
  }

  async function load() {
    let data;
    try { data = await api('programs'); } catch (err) {
      if (err.code === 'signed_out') return loginView();
      main.innerHTML = '<p class="err">' + esc(err.message) + '</p>'; return;
    }
    signedIn();
    const push = await pushState(data.push);
    const waiting = data.programs.filter((p) => p.state === 'requested');
    main.innerHTML = (push === 'off' ? '<section class="card"><h2>Get notified</h2><p class="muted">When someone asks for help or takes over a setup, this device gets a notification.</p><div class="row"><button class="solid" id="push">Turn on notifications</button></div></section>' : '')
      + (push === 'unavailable' && data.push ? '<p class="muted">Notifications need this page installed to your home screen (Share → Add to Home Screen on iPhone).</p>' : '')
      + (!data.push ? '<p class="muted">Notifications aren’t set up on the server yet (the push key on /ops).</p>' : '')
      + (waiting.length ? '<h2>Waiting for you</h2>' + waiting.map(programCard).join('') : '')
      + '<details class="card" id="startbox"' + (data.programs.length ? '' : ' open') + '><summary>Start an assisted setup</summary>'
      + '<form id="start" class="card" style="border:0;padding:0"><p class="muted">Makes her account with her email, and a link that signs your device in to it. Delete any old account first.</p>'
      + '<label for="s-label">Her name (only you see it)<input id="s-label" maxlength="60" required placeholder="Dana at Blue Ridge Bostons"></label>'
      + '<label for="s-email">Her email<input id="s-email" type="email" autocomplete="off" required></label>'
      + '<button class="solid">Make her account</button></form></details>'
      + (data.programs.filter((p) => p.state !== 'requested').map(programCard).join('') || '')
      + '<details class="card"' + (toDelete ? ' open' : '') + '><summary>Delete an account</summary>'
      + (toDelete ? deleteConfirmHtml(toDelete)
        : '<form id="del-find" class="card" style="border:0;padding:0">'
        + '<p class="muted">Look the account up first: nothing is deleted until you have seen whose it is.</p>'
        + '<label for="d-email">Its email<input id="d-email" type="email" autocomplete="off" required></label>'
        + '<button>Look up</button></form>')
      + '</details>';
    const pushBtn = document.getElementById('push');
    if (pushBtn) pushBtn.addEventListener('click', async () => { try { await turnOnPush(data.push); toast('Notifications on'); load(); } catch (err) { toast(err.message); } });
    document.getElementById('start').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('start', { label: document.getElementById('s-label').value, email: document.getElementById('s-email').value });
        lastLink = { programId: r.programId, link: r.link }; toast('Account made. Copy the link.'); load();
      } catch (err) { toast(err.message); }
    });
    document.getElementById('del-find')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { toDelete = await api('delete-lookup', { email: document.getElementById('d-email').value }); load(); } catch (err) { toast(err.message); }
    });
    document.getElementById('del-cancel')?.addEventListener('click', () => { toDelete = null; load(); });
    document.getElementById('del')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const erase = document.getElementById('d-erase').checked;
        const r = await api('delete', { userId: toDelete.userId, confirmToken: toDelete.confirmToken, erase, confirm: document.getElementById('d-confirm').value });
        toDelete = null;
        toast('Deleted.' + (r.devices ? (erase
          ? ' Devices that open KennelOS within 90 days erase their copy; one that stays away longer keeps it.'
          : ' Its devices keep their records.') : ''));
        load();
      } catch (err) {
        if (err.code === 'account_changed' || err.code === 'lookup_expired' || err.code === 'no_account') toDelete = null;
        toast(err.message); load();
      }
    });
    main.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await api('link', { programId: b.dataset.link }); lastLink = { programId: b.dataset.link, link: r.link }; load(); } catch (err) { toast(err.message); }
    }));
    main.querySelectorAll('[data-end]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('end', { programId: b.dataset.end }); toast('Help ended. Your device wipes its copy when it next opens.'); load(); } catch (err) { toast(err.message); }
    }));
    main.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy)));
  }

  function signedIn() {
    document.getElementById('logout').hidden = false;
    document.getElementById('refresh').hidden = false;
    document.getElementById('tabs').hidden = false;
    document.querySelectorAll('#tabs [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  }

  // ---------- Templates: the template library (esignLibrary.js) ----------
  // The library is the Firma workspace of one KennelOS account (support's test account),
  // where templates are built in the app itself. Here: link it, name breeders, and say
  // who may add each template.
  const TO = { none: 'No one', all: 'Every breeder', chosen: 'Breeders I choose' };
  const SIGNS = { none: 'Only the buyer', first: 'The breeder signs first, then the buyer', last: 'The buyer signs, then the breeder' };
  function linkForm(again) {
    return '<form id="lib-link" class="card" style="border:0;padding:0">'
      + '<p class="muted">' + (again ? 'Link a different account. Its templates replace these; what you offered from this one is withdrawn (copies breeders added stay theirs).'
        : 'The KennelOS account whose contract templates you offer to breeders: your test account. It needs Pro and Set up e-signing done (Contracts → Contract templates).') + '</p>'
      + '<label for="l-email">Its email<input id="l-email" type="email" autocomplete="off" required></label>'
      + '<label for="l-label">A name only you see<input id="l-label" maxlength="60" placeholder="My test account"></label>'
      + '<button class="solid">Link</button></form>';
  }
  function templateCard(t, breeders) {
    const pages = t.pageCount ? t.pageCount + (t.pageCount === 1 ? ' page' : ' pages') + ' · ' : '';
    const copies = !t.copies ? 'not added yet' : (t.copies === 1 ? 'added by 1 breeder' : 'added by ' + t.copies + ' breeders');
    const radio = (v) => '<label class="check"><input type="radio" name="to-' + esc(t.id) + '" value="' + v + '"' + (t.to === v ? ' checked' : '') + '> ' + esc(TO[v]) + '</label>';
    const sign = (v) => '<label class="check"><input type="radio" name="signs-' + esc(t.id) + '" value="' + v + '"' + (t.signs === v ? ' checked' : '') + '> ' + esc(SIGNS[v]) + '</label>';
    const picks = breeders.length
      ? breeders.map((b) => '<label class="check"><input type="checkbox" data-pick value="' + esc(b.programId) + '"' + (t.programIds.indexOf(b.programId) >= 0 ? ' checked' : '') + '> ' + esc(b.label) + '</label>').join('')
      : '<p class="muted">Name breeders above to choose them here.</p>';
    return '<form class="card" data-offer="' + esc(t.id) + '"><div class="row" style="justify-content:space-between"><h2>' + esc(t.firmaName || t.name) + '</h2>'
      + '<span class="state' + (t.to === 'none' ? '' : ' helping') + '">' + esc(t.to === 'none' ? 'Not offered' : 'Offered') + '</span></div>'
      + '<p class="muted">' + esc(pages + copies) + '</p>'
      + (t.gone ? '<p class="note">Deleted from the library: no one can add it now. Copies breeders added stay theirs.</p><div class="row"><button type="button" class="danger" data-withdraw="' + esc(t.id) + '">Withdraw</button></div></form>'
        : '<label>Name breeders see<input name="name" maxlength="255" value="' + esc(t.name) + '"></label>'
        + '<label>What it’s for (optional)<textarea name="description" maxlength="300" placeholder="Shown under its name when a breeder adds it">' + esc(t.description) + '</textarea></label>'
        + '<fieldset><legend>Who signs it (as you placed its signers)</legend>' + sign('none') + sign('first') + sign('last') + '</fieldset>'
        + '<fieldset><legend>Who may add it</legend>' + radio('none') + radio('all') + radio('chosen') + '</fieldset>'
        + '<fieldset data-picks' + (t.to === 'chosen' ? '' : ' hidden') + '><legend>Breeders</legend>' + picks + '</fieldset>'
        + '<div class="row"><button class="solid">Save</button></div></form>');
  }
  async function loadLibrary() {
    let data;
    try { data = await api('library'); } catch (err) {
      if (err.code === 'signed_out') return loginView();
      main.innerHTML = '<p class="err">' + esc(err.message) + '</p>'; return;
    }
    signedIn();
    const lib = data.linked;
    const libCard = !lib
      ? '<section class="card"><h2>Template library</h2>' + linkForm(false) + '</section>'
      : '<section class="card"><div class="row" style="justify-content:space-between"><h2>Template library</h2><span class="state' + (lib.connected ? ' helping' : ' requested') + '">' + (lib.connected ? 'Linked' : 'Needs set up') + '</span></div>'
        + '<p>' + esc(lib.label || 'Linked account') + '</p>'
        + (lib.connected ? '<p class="muted">Build templates in KennelOS signed in to that account: Contracts → Contract templates → Upload, then Place fields (on a computer). Each one shows here; no breeder sees it until you say who may add it. A breeder adds a copy from their own Contract templates: their copy is theirs, and later changes here don’t reach it.</p>'
          : '<p class="note">That account’s e-signing isn’t set up any more (its Firma workspace is gone). Press Set up e-signing on it again, then link it again.</p>')
        + '<details><summary>Link a different account</summary>' + linkForm(true) + '</details>'
        + '<div class="row"><button type="button" class="danger" id="lib-unlink">Unlink</button></div></section>';
    const breederCard = '<section class="card"><h2>Breeders</h2>'
      + '<p class="muted">The breeders you choose templates for. “Every breeder” needs no one named here.</p>'
      + (data.breeders.length ? '<ul class="events">' + data.breeders.map((b) => '<li class="row" style="justify-content:space-between;flex-wrap:nowrap"><span style="flex:1;min-width:0"><strong>' + esc(b.label) + '</strong>'
        + (b.esign ? '' : ' · hasn’t set up e-signing yet (they see templates once they do)') + '</span>'
        + '<button type="button" class="danger" data-unname="' + esc(b.programId) + '">Remove</button></li>').join('') + '</ul>' : '')
      + '<details' + (data.breeders.length ? '' : ' open') + '><summary>Add a breeder</summary><form id="b-add" class="card" style="border:0;padding:0">'
      + '<label for="b-label">Their name (only you see it)<input id="b-label" maxlength="60" required placeholder="Dana at Blue Ridge Bostons"></label>'
      + '<label for="b-email">Their KennelOS email<input id="b-email" type="email" autocomplete="off" required></label>'
      + '<button class="solid">Add</button></form></details></section>';
    const templates = !lib ? ''
      : !data.templatesRead ? '<p class="err">Couldn’t read the library’s templates from Firma. Refresh to try again.</p>'
        : (data.templates.length ? '<h2>Templates</h2>' + data.templates.map((t) => templateCard(t, data.breeders)).join('')
          : '<p class="muted">No templates in the library yet. Upload one on that account’s Contract templates.</p>');
    main.innerHTML = libCard + breederCard + templates;

    const done = (msg) => (r) => { toast(msg); return r; };
    const run = async (path, body, msg) => { try { await api(path, body).then(done(msg)); loadLibrary(); } catch (err) { toast(err.message); } };
    main.querySelectorAll('#lib-link').forEach((f) => f.addEventListener('submit', (e) => {
      e.preventDefault();
      run('library/link', { email: f.querySelector('#l-email').value, label: f.querySelector('#l-label').value }, 'Library linked');
    }));
    document.getElementById('lib-unlink')?.addEventListener('click', () => {
      if (confirm('Unlink the library? What you offered is withdrawn. Copies breeders added stay theirs.')) run('library/unlink', {}, 'Library unlinked');
    });
    document.getElementById('b-add').addEventListener('submit', (e) => {
      e.preventDefault();
      run('library/breeder', { label: document.getElementById('b-label').value, email: document.getElementById('b-email').value }, 'Breeder added');
    });
    main.querySelectorAll('[data-unname]').forEach((b) => b.addEventListener('click', () => {
      if (confirm('Remove this breeder? Templates you chose them for stop being offered to them. Copies they added stay theirs.')) run('library/breeder', { programId: b.dataset.unname, remove: true }, 'Removed');
    }));
    main.querySelectorAll('[data-withdraw]').forEach((b) => b.addEventListener('click', () => run('library/offer', { templateId: b.dataset.withdraw, to: 'none' }, 'Withdrawn')));
    main.querySelectorAll('form[data-offer]').forEach((f) => {
      const picks = f.querySelector('[data-picks]');
      const toOf = () => (f.querySelector('input[name^="to-"]:checked') || {}).value || 'none';
      f.querySelectorAll('input[name^="to-"]').forEach((r) => r.addEventListener('change', () => { if (picks) picks.hidden = toOf() !== 'chosen'; }));
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const to = toOf();
        const signs = (f.querySelector('input[name^="signs-"]:checked') || {}).value || 'none';
        const programIds = Array.prototype.map.call(f.querySelectorAll('[data-pick]:checked'), (x) => x.value);
        if (to === 'chosen' && !programIds.length) { toast('Tick at least one breeder, or choose No one.'); return; }
        run('library/offer', { templateId: f.dataset.offer, to, signs, programIds, name: f.querySelector('[name=name]').value, description: f.querySelector('[name=description]').value }, 'Saved');
      });
    });
  }

  function render() { return view === 'templates' ? loadLibrary() : load(); }
  document.querySelectorAll('#tabs [data-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    history.replaceState(null, '', view === 'templates' ? '#templates' : location.pathname);
    render();
  }));
  document.getElementById('logout').addEventListener('click', async () => { await api('logout', {}).catch(() => {}); loginView(); });
  document.getElementById('refresh').addEventListener('click', render);
  // People refreshes by itself; Templates only when asked (it holds unsaved ticks).
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && view === 'people') load(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/manager/sw.js', { scope: '/manager/' }).catch(() => {});
  setInterval(() => { if (view === 'people' && document.visibilityState === 'visible' && !document.querySelector('input:focus')) load(); }, 30000);
  render();
}

// ---------- the service worker (runs in the browser) ----------
function managerWorker() {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('push', (e) => {
    e.waitUntil((async () => {
      let n = { title: 'KennelOS Assist', body: 'Something needs you.', tag: 'assist' };
      try {
        const sub = await self.registration.pushManager.getSubscription();
        const res = await fetch('/manager/api/pending', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub ? sub.endpoint : '' }),
        });
        if (res.ok) n = await res.json();
      } catch (err) { /* show the generic one */ }
      await self.registration.showNotification(n.title, { body: n.body, tag: n.tag, icon: '/manager/icon-192.png', badge: '/manager/icon-192.png', data: { url: '/manager/' } });
    })());
  });
  self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    e.waitUntil((async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = all.find((c) => new URL(c.url).pathname.startsWith('/manager/'));
      if (open) { await open.focus(); open.postMessage('refresh'); } else await self.clients.openWindow('/manager/');
    })());
  });
}

const MANIFEST = JSON.stringify({
  name: 'KennelOS Assist', short_name: 'Assist', start_url: '/manager/', scope: '/manager/', display: 'standalone',
  background_color: '#F4F1EA', theme_color: '#184A45',
  icons: [
    { src: '/manager/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: '/manager/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
});

// Wrangler bundles with esbuild's keepNames, which wraps named functions in calls to
// a `__name` helper that exists in the Worker bundle but not in the browser. These
// scripts are sent as their source, so each starts with a stand-in.
const NAME_SHIM = 'var __name = function (fn) { return fn; };\n';
const asScript = (fn) => `${NAME_SHIM}(${fn.toString()})();\n`;

export const MANAGER_FILES = {
  '': { type: 'text/html; charset=utf-8', body: HTML },
  'app.js': { type: 'text/javascript; charset=utf-8', body: asScript(managerPage) },
  'sw.js': { type: 'text/javascript; charset=utf-8', body: asScript(managerWorker) },
  'manifest.webmanifest': { type: 'application/manifest+json', body: MANIFEST },
  'icon-192.png': { type: 'image/png', base64: true, body: ICON_192 },
  'icon-512.png': { type: 'image/png', base64: true, body: ICON_512 },
};
