// /ops: the operator's page (plan §6.6). Everything an operator does to this
// Worker's data happens here, in a browser, never in a terminal.
//
// Access is the OPS_TOKEN Worker secret, typed in once and held in a signed,
// same-origin, HttpOnly cookie. Until the secret is set the page refuses
// everything and says how to set it: it never falls open. Breeder accounts have
// no way in.
//
// While any migration is pending or drifted the page shows only the migration
// table and Apply pending: every other section queries the schema this deploy
// expects, and a page that errors is a page whose Apply pending can't be pressed.
import { applyPending, migrationStatus } from './migrate.js';
import { healthCheck } from './health.js';
import { activeNotices, addNotice, removeNotice, LEVELS } from './notice.js';
import { runRetention } from './retention.js';
import { exportAll, importAll } from './backup.js';
import { mailMode } from './mail.js';
import { hmacHex, timingSafeEqual } from './lib/crypto.js';
import { readCookie } from './lib/http.js';
import { escapeHtml as esc } from './lib/html.js';

const COOKIE = 'ops_session';
const SESSION_SECONDS = 12 * 60 * 60;

async function mintCookie(secret) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  return `${expires}.${await hmacHex(secret, `ops:${expires}`)}`;
}

async function cookieValid(secret, value) {
  if (!value) return false;
  const [expiresRaw, sig] = value.split('.');
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
  return timingSafeEqual(sig ?? '', await hmacHex(secret, `ops:${expires}`));
}

// ---------- rendering ----------

function page(title, body, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — KennelOS ops</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 0 auto; padding: 1.25rem 1rem; max-width: 46rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  h2 { font-size: 1rem; margin: 2rem 0 .5rem; border-bottom: 1px solid #8884; padding-bottom: .25rem; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  td, th { text-align: left; padding: .3rem .5rem .3rem 0; vertical-align: top; }
  code, pre { font-family: ui-monospace, monospace; font-size: .85em; }
  pre { overflow-x: auto; background: #8881; padding: .6rem; border-radius: 4px; }
  button { font: inherit; padding: .5rem .9rem; border-radius: 6px; border: 1px solid #8886; background: #8881; color: inherit; cursor: pointer; }
  input, select { font: inherit; padding: .45rem; width: 100%; box-sizing: border-box; border-radius: 6px; border: 1px solid #8886; background: transparent; color: inherit; }
  form { margin: .5rem 0; }
  .muted { opacity: .65; }
  .bad { color: #d93025; font-weight: 600; }
  .ok { color: #1e8e3e; }
  .pending { font-weight: 600; }
  .note { background: #8881; padding: .6rem .8rem; border-radius: 6px; margin: .75rem 0; }
</style></head><body>${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

function loginPage(message) {
  return page('Sign in', `<h1>KennelOS ops</h1>
${message ? `<p class="bad">${esc(message)}</p>` : ''}
<form method="post" action="/ops/login">
  <p><label>Ops token<br><input type="password" name="token" autocomplete="current-password" autofocus></label></p>
  <button type="submit">Sign in</button>
</form>`);
}

function errorPage(err) {
  return page(
    'Something went wrong',
    `<h1>Something went wrong</h1>
<div class="note">The action did not complete. The message below is what the database reported.</div>
<pre>${esc(String(err?.message ?? err))}</pre>
<p><a href="/ops">Back to ops</a></p>`,
    500,
  );
}

const yesNo = (v) => (v ? '<span class="ok">yes</span>' : '<span class="bad">no</span>');

async function dashboard(env, flash) {
  const health = await healthCheck(env);
  const migrations = health.d1.reachable ? await migrationStatus(env.DB) : [];
  const pending = migrations.filter((m) => m.state === 'pending').length;
  const behind = migrations.some((m) => m.state !== 'applied');

  const migrationRows = migrations
    .map((m) => `<tr>
        <td><code>${esc(m.id)}</code></td>
        <td>${esc(m.name)}</td>
        <td class="${m.state === 'applied' ? 'ok' : m.state === 'pending' ? 'pending' : 'bad'}">${esc(m.state)}</td>
        <td class="muted">${esc(m.applied_at ?? '—')}</td>
      </tr>`)
    .join('');

  const countRows = Object.entries(health.counts)
    .map(([t, n]) => `<tr><td><code>${esc(t)}</code></td><td>${n === null ? '<span class="muted">no table</span>' : esc(n)}</td></tr>`)
    .join('');

  const apiState = !health.d1.reachable
    ? '<p class="bad">D1 is not reachable, so the API is answering 503.</p>'
    : behind
      ? '<p class="bad">The API is answering 503 (maintenance) until every migration below reads applied.</p>'
      : '<p class="ok">Schema is current. The API is serving.</p>';

  return page('Ops', `<h1>KennelOS ops</h1>
<form method="post" action="/ops/logout"><button type="submit">Sign out</button></form>
${flash ?? ''}
${apiState}

<h2>Migrations</h2>
${health.d1.reachable
    ? `<table><tr><th>id</th><th>name</th><th>state</th><th>applied</th></tr>${migrationRows}</table>
<form method="post" action="/ops/migrate"><button type="submit"${pending ? '' : ' disabled'}>Apply pending (${pending})</button></form>
${migrations.some((m) => m.state === 'drifted' || m.state === 'orphaned')
    ? '<p class="bad">A migration has drifted or is orphaned. It is shown, never fixed automatically.</p>'
    : ''}`
    : `<p class="bad">D1 is not reachable.</p><pre>${esc(health.d1.error ?? 'No DB binding.')}</pre>`}

<h2>Health</h2>
<table>
  <tr><td>D1 bound / reachable</td><td>${yesNo(health.d1.bound)} / ${yesNo(health.d1.reachable)}</td></tr>
  <tr><td>R2 bound / reachable</td><td>${yesNo(health.r2.bound)} / ${yesNo(health.r2.reachable)}${health.r2.error ? ` <span class="muted">${esc(health.r2.error)}</span>` : ''}</td></tr>
  <tr><td>Secret <code>EMAIL_HMAC_KEY</code> set</td><td>${yesNo(health.secrets.EMAIL_HMAC_KEY)}</td></tr>
  <tr><td>Schema version</td><td>${esc(health.schema_version ?? 'none')}</td></tr>
</table>
${countRows ? `<h2>Rows</h2><table>${countRows}</table>` : ''}
${behind || !health.d1.reachable ? '<p class="muted">The sections below appear once every migration is applied.</p>' : await currentSections(env)}`);
}

async function currentSections(env) {
  const notices = await activeNotices(env);
  const noticeRows = notices
    .map((n) => `<tr><td>${esc(n.level)}</td><td>${esc(n.message)}</td><td class="muted">${esc(n.until ?? 'until removed')}</td>
      <td><form method="post" action="/ops/notices/remove"><input type="hidden" name="id" value="${esc(n.id)}"><button type="submit">Remove</button></form></td></tr>`)
    .join('');

  let outbox = '';
  if (mailMode(env) === 'outbox') {
    const { results } = await env.DB.prepare(
      'SELECT code, email_hash, created_at FROM dev_outbox ORDER BY id DESC LIMIT 10',
    ).all();
    outbox = `<h2>Sign-in codes (staging outbox)</h2>
<p class="muted">No email provider is connected, so codes land here instead. Kept for an hour.</p>
${results.length
    ? `<table><tr><th>code</th><th>email (hash)</th><th>sent</th></tr>${results
      .map((r) => `<tr><td><code>${esc(r.code)}</code></td><td class="muted"><code>${esc(r.email_hash.slice(0, 10))}…</code></td><td class="muted">${esc(r.created_at)}</td></tr>`)
      .join('')}</table>`
    : '<p class="muted">None yet.</p>'}`;
  }

  return `${outbox}
<h2>Service notices</h2>
${noticeRows ? `<table>${noticeRows}</table>` : '<p class="muted">No active notices.</p>'}
<form method="post" action="/ops/notices">
  <p><label>Level<br><select name="level">${LEVELS.map((l) => `<option>${l}</option>`).join('')}</select></label></p>
  <p><label>Message<br><input name="message" maxlength="1000"></label></p>
  <p><label>Show until (optional)<br><input type="date" name="until"></label></p>
  <button type="submit">Add notice</button>
</form>

<h2>Retention</h2>
<p class="muted">Runs daily by itself. Keeps hourly snapshots for a day and daily ones for 30 days.</p>
<form method="post" action="/ops/retention"><button type="submit">Run retention now</button></form>

<h2>Backup of this database</h2>
<p class="muted">D1 rows only. Snapshot and file bytes in R2 are not in the file.</p>
<p><a href="/ops/export.json">Download export.json</a></p>
<form method="post" action="/ops/import" enctype="multipart/form-data">
  <p><label>Restore into an empty database<br><input type="file" name="file" accept="application/json"></label></p>
  <button type="submit">Import</button>
</form>`;
}

// ---------- routing ----------

export async function handleOps(request, env) {
  try {
    return await route(request, env);
  } catch (err) {
    return errorPage(err);
  }
}

async function route(request, env) {
  const url = new URL(request.url);

  if (!env.OPS_TOKEN) {
    return page(
      'Not configured',
      `<h1>KennelOS ops</h1><div class="note"><strong>OPS_TOKEN is not set.</strong>
      In the Cloudflare dashboard open this Worker → Settings → Variables and Secrets,
      and add <code>OPS_TOKEN</code> as a <em>Secret</em>. Ops is closed until it is set.</div>`,
      503,
    );
  }

  if (url.pathname === '/ops/login' && request.method === 'POST') {
    const form = await request.formData();
    if (!timingSafeEqual(String(form.get('token') ?? ''), env.OPS_TOKEN)) {
      return loginPage('That token did not match.');
    }
    return new Response(null, {
      status: 303,
      headers: {
        location: '/ops',
        'set-cookie': `${COOKIE}=${await mintCookie(env.OPS_TOKEN)}; Path=/ops; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
      },
    });
  }

  if (!(await cookieValid(env.OPS_TOKEN, readCookie(request, COOKIE)))) return loginPage(null);

  if (url.pathname === '/ops/logout' && request.method === 'POST') {
    return new Response(null, {
      status: 303,
      headers: { location: '/ops', 'set-cookie': `${COOKIE}=; Path=/ops; HttpOnly; Secure; SameSite=Strict; Max-Age=0` },
    });
  }

  if (url.pathname === '/ops' && request.method === 'GET') return dashboard(env, null);

  if (url.pathname === '/ops/migrate' && request.method === 'POST') {
    const { log, halted } = await applyPending(env.DB);
    if (!log.length) return dashboard(env, '<p>Nothing pending.</p>');
    const flash = log
      .map((entry) => entry.ok
        ? `<p class="ok">Applied <code>${esc(entry.id)}</code> ${esc(entry.name)}: ${esc(entry.statements)} statements.</p>`
        : `<p class="bad">Failed on <code>${esc(entry.id)}</code> ${esc(entry.name)}. Nothing from this migration was applied.</p>
           <pre>${esc(entry.error)}</pre>
           <details><summary>${esc(entry.statements)} statements in this migration</summary><pre>${esc(entry.statementList
             .map((s, i) => `${String(i + 1).padStart(3)}  ${s};`)
             .join('\n\n'))}</pre></details>`)
      .join('');
    return dashboard(env, flash + (halted ? '<p class="bad">Halted. Later migrations were not attempted.</p>' : ''));
  }

  if (url.pathname === '/ops/retention' && request.method === 'POST') {
    const r = await runRetention(env);
    return dashboard(env, `<p class="ok">Retention done: ${esc(r.snapshotsDropped)} snapshots and ${esc(r.pendingDropped)} abandoned uploads removed, ${esc(r.filesDropped)} unreferenced files removed.</p>`);
  }

  if (url.pathname === '/ops/notices' && request.method === 'POST') {
    const form = await request.formData();
    try {
      await addNotice(env, { level: form.get('level'), message: form.get('message'), until: form.get('until') });
    } catch (err) {
      return dashboard(env, `<p class="bad">${esc(err.message)}</p>`);
    }
    return dashboard(env, '<p class="ok">Notice added.</p>');
  }

  if (url.pathname === '/ops/notices/remove' && request.method === 'POST') {
    await removeNotice(env, (await request.formData()).get('id'));
    return dashboard(env, '<p class="ok">Notice removed.</p>');
  }

  if (url.pathname === '/ops/export.json' && request.method === 'GET') {
    const data = await exportAll(env.DB);
    return new Response(JSON.stringify(data), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="kennelos-cloud-${data.exported_at.slice(0, 10)}.json"`,
        'cache-control': 'no-store',
      },
    });
  }

  if (url.pathname === '/ops/import' && request.method === 'POST') {
    const file = (await request.formData()).get('file');
    if (!file || typeof file.text !== 'function') return dashboard(env, '<p class="bad">Choose an export.json file first.</p>');
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return dashboard(env, '<p class="bad">That file is not JSON.</p>');
    }
    const result = await importAll(env.DB, data);
    return dashboard(env, result.ok
      ? `<p class="ok">Imported ${esc(result.rows)} rows.</p>`
      : `<p class="bad">Nothing was imported. ${esc(result.reason)}</p>`);
  }

  return page('Not found', '<h1>Not found</h1><p><a href="/ops">Back to ops</a></p>', 404);
}
