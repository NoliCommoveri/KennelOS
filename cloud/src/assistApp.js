// The manager app's files (assist.js serves them under /manager/): support's
// installable page for assisted setup and help. One page, its script and its
// service worker (pushes), a manifest and two icons.
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
<main id="main"><p class="muted">Loading…</p></main>
<script src="/manager/app.js" defer></script></body></html>`;

// ---------- the page (runs in the browser) ----------
function managerPage() {
  const main = document.getElementById('main');
  const STATE = { setup: 'Setting up', idle: 'Hers', requested: 'Asked for help', helping: 'You’re helping' };
  const ERRORS = {
    wrong_token: 'That token didn’t match.', account_exists: 'That email already has an account. Delete it below first, then start again.',
    bad_email: 'Check the email address.', label_required: 'Give her a name you’ll recognise.', no_account: 'No account uses that email.',
    confirm_required: 'Type DELETE to confirm.', help_not_requested: 'She hasn’t asked for help. She presses Get help in her app first.',
    maintenance: 'The server is in maintenance (a migration is waiting on /ops).',
  };
  let lastLink = null;
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
    main.innerHTML = '<form class="card" id="login"><h2>Sign in</h2><p class="muted">Use the ops token, as on /ops.</p>'
      + '<label for="tok">Ops token<input id="tok" type="password" autocomplete="current-password" required></label>'
      + (msg ? '<p class="err">' + esc(msg) + '</p>' : '') + '<button class="solid">Sign in</button></form>';
    document.getElementById('login').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('login', { token: document.getElementById('tok').value }); load(); } catch (err) { loginView(err.message); }
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
    document.getElementById('logout').hidden = false;
    document.getElementById('refresh').hidden = false;
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
      + '<details class="card"><summary>Delete an account</summary><form id="del" class="card" style="border:0;padding:0">'
      + '<p class="muted">Everything the account holds in the cloud goes. A Pro purchase stays on record.</p>'
      + '<label for="d-email">Its email<input id="d-email" type="email" autocomplete="off" required></label>'
      + '<label class="check"><input id="d-erase" type="checkbox" checked> Erase its devices when they next open (they free their Pro activations and drop its passkeys)</label>'
      + '<label for="d-confirm">Type DELETE to confirm<input id="d-confirm" autocomplete="off" required></label>'
      + '<button class="danger">Delete the account</button></form></details>';
    const pushBtn = document.getElementById('push');
    if (pushBtn) pushBtn.addEventListener('click', async () => { try { await turnOnPush(data.push); toast('Notifications on'); load(); } catch (err) { toast(err.message); } });
    document.getElementById('start').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('start', { label: document.getElementById('s-label').value, email: document.getElementById('s-email').value });
        lastLink = { programId: r.programId, link: r.link }; toast('Account made. Copy the link.'); load();
      } catch (err) { toast(err.message); }
    });
    document.getElementById('del').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('delete', { email: document.getElementById('d-email').value, erase: document.getElementById('d-erase').checked, confirm: document.getElementById('d-confirm').value });
        toast('Deleted' + (r.devices ? '. ' + r.devices + ' device(s) will be told when they next open.' : '.')); load();
      } catch (err) { toast(err.message); }
    });
    main.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await api('link', { programId: b.dataset.link }); lastLink = { programId: b.dataset.link, link: r.link }; load(); } catch (err) { toast(err.message); }
    }));
    main.querySelectorAll('[data-end]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('end', { programId: b.dataset.end }); toast('Help ended. Your device wipes its copy when it next opens.'); load(); } catch (err) { toast(err.message); }
    }));
    main.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy)));
  }

  document.getElementById('logout').addEventListener('click', async () => { await api('logout', {}).catch(() => {}); loginView(); });
  document.getElementById('refresh').addEventListener('click', load);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/manager/sw.js', { scope: '/manager/' }).catch(() => {});
  setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('input:focus')) load(); }, 30000);
  load();
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

export const MANAGER_FILES = {
  '': { type: 'text/html; charset=utf-8', body: HTML },
  'app.js': { type: 'text/javascript; charset=utf-8', body: `(${managerPage.toString()})();\n` },
  'sw.js': { type: 'text/javascript; charset=utf-8', body: `(${managerWorker.toString()})();\n` },
  'manifest.webmanifest': { type: 'application/manifest+json', body: MANIFEST },
  'icon-192.png': { type: 'image/png', base64: true, body: ICON_192 },
  'icon-512.png': { type: 'image/png', base64: true, body: ICON_512 },
};
