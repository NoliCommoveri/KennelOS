// E-sign through Firma (docs/KennelOS_Integrations_Plan.md §2.3a, step 8; D25–D26):
// a workspace per program on KennelOS's Firma account, her templates, sends within
// the monthly limit (set in /ops), Firma's signed webhook back to her contract,
// disconnect and account deletion. A fake Firma stands in for the real API.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeEnv, call, signIn } from './helpers/env.js';
import { worker } from './helpers/worker.js';

const firma = await import('../src/firma.js');
const { runRetention } = await import('../src/retention.js');
const { removeAccount } = await import('../src/program.js');

const MASTER = 'firma_master_key';
const KEY = 'test-int-token-key';
const SECRET = 'a'.repeat(64);
const iso = (ms) => new Date(ms).toISOString();
const count = (env, sql, ...a) => env.DB.raw.prepare(sql).get(...a).n;
const CONTRACT = '0b9a1c64-1111-4c6e-9a3e-000000000001';

function makePro(env, session) {
  const { email_hash: eh } = env.DB.raw.prepare(
    'SELECT u.email_hash FROM users u JOIN programs p ON p.owner_user_id = u.id WHERE p.id = ?',
  ).get(session.programId);
  env.DB.raw.prepare(
    `INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
     VALUES (?, ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`,
  ).run(`order:${session.programId}`, eh, iso(Date.now()), iso(Date.now()));
}

async function breeder(env, email = 'breeder@example.com') {
  const s = await signIn(env, email, { deviceId: 'phone-1' });
  makePro(env, s);
  return s;
}

// --- A fake Firma -------------------------------------------------------------------------

let fake;
let realFetch;
function makeFake() {
  const f = {
    calls: [], workspaces: new Map(), webhooks: new Map(), templates: new Map(), fields: new Map(), sends: [],
    sendReply: null, // (body) => { status, data } to override create-and-send once
    nextWs: 1, nextSr: 1,
  };
  f.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace('/functions/v1/signing-request-api', '');
    const method = init.method || 'GET';
    const auth = (init.headers?.authorization || '').replace(/^Bearer /, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    f.calls.push({ method, path, auth, body });
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    const wsOfKey = [...f.workspaces.values()].find((w) => w.api_key === auth || w.test_api_key === auth);
    let m;
    if (method === 'GET' && path === '/company' && auth === MASTER) return reply(200, { credits: 42 });
    if (method === 'POST' && path === '/workspaces' && auth === MASTER) {
      const id = `ws_${f.nextWs++}`;
      const w = { id, name: body.name, api_key: `live_${id}`, test_api_key: `test_${id}`, webhook_enabled: false };
      f.workspaces.set(id, w);
      return reply(201, w);
    }
    if ((m = /^\/workspaces\/([^/]+)$/.exec(path)) && auth === MASTER) {
      const w = f.workspaces.get(m[1]);
      if (!w) return reply(404, { code: 'NOT_FOUND' });
      if (method === 'PATCH') { if (body.webhook_enabled) w.webhook_enabled = true; return reply(200, w); }
      return reply(200, { ...w, webhook_secret: w.webhook_enabled ? SECRET : null });
    }
    if (method === 'POST' && path === '/webhooks' && auth === MASTER) {
      const id = `wh_${f.webhooks.size + 1}`;
      f.webhooks.set(id, { id, ...body, deleted: false });
      return reply(201, { id, url: body.url, events: body.events, enabled: true });
    }
    if (method === 'DELETE' && (m = /^\/webhooks\/([^/]+)$/.exec(path)) && auth === MASTER) {
      f.webhooks.get(m[1]).deleted = true;
      return reply(200, { message: 'deleted' });
    }
    if (!wsOfKey) return reply(401, { code: 'UNAUTHORIZED' });
    if ((m = /^\/workspace\/([^/]+)\/custom-fields$/.exec(path))) {
      if (m[1] !== wsOfKey.id) return reply(403, { code: 'FORBIDDEN' });
      const list = f.fields.get(m[1]) || [];
      f.fields.set(m[1], list);
      if (method === 'GET') return reply(200, list);
      list.push({ id: `cf_${list.length}`, field_name: body.field_name, field_label: body.field_label });
      return reply(201, list[list.length - 1]);
    }
    if (method === 'POST' && path === '/templates') {
      const id = `tpl_${f.templates.size + 1}`;
      f.templates.set(id, { id, name: body.name, ws: wsOfKey.id, page_count: 2 });
      return reply(201, { id, name: body.name, page_count: 2 });
    }
    if (method === 'GET' && path === '/templates') {
      return reply(200, { results: [...f.templates.values()].filter((t) => t.ws === wsOfKey.id) });
    }
    if (method === 'GET' && (m = /^\/templates\/([^/]+)$/.exec(path))) {
      const t = f.templates.get(m[1]);
      return t && t.ws === wsOfKey.id ? reply(200, t) : reply(404, { code: 'NOT_FOUND' });
    }
    if (method === 'POST' && path === '/generate-template-token') return reply(201, { token: `jwt_${body.companies_workspaces_templates_id}`, expires_at: '2026-11-12T00:00:00Z' });
    if (method === 'POST' && path === '/signing-requests/create-and-send') {
      if (f.sendReply) { const r = f.sendReply(body); f.sendReply = null; if (r === 'network') throw new TypeError('fetch failed'); return reply(r.status, r.data); }
      const id = `sr_${f.nextSr++}`;
      f.sends.push({ id, ws: wsOfKey.id, body });
      return reply(201, { id, status: 'sent', first_signer: { id: `su_${id}`, email: body.recipients[0].email, signing_link: `https://app.firma.dev/signing/su_${id}` }, credits_remaining: 41 });
    }
    if (method === 'GET' && (m = /^\/signing-requests\/([^/]+)\/users$/.exec(path))) {
      return reply(200, [{ id: `su_${m[1]}`, designation: 'Signer' }]);
    }
    if (method === 'GET' && (m = /^\/signing-requests\/([^/]+)\/download$/.exec(path))) {
      return reply(200, { status: 'finished', is_partial: false, download_url: `https://files.firma.dev/${m[1]}.pdf?sig=x`, expires_at: '2026-11-11T23:00:00Z' });
    }
    return reply(404, { code: 'NOT_FOUND' });
  };
  return f;
}

beforeEach(() => { fake = makeFake(); realFetch = globalThis.fetch; globalThis.fetch = fake.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

const envWith = (extra = {}) => makeEnv({ INT_TOKEN_KEY: KEY, FIRMA_API_KEY: MASTER, ...extra });

async function connected(env, email) {
  const s = await breeder(env, email);
  const r = await call(env, 'POST', '/integrations/firma/connect', { token: s.token, body: { kennelName: 'Maple Ridge Labradors' } });
  assert.equal(r.status, 200, await r.clone().text());
  return s;
}

const send = (env, s, extra = {}) => call(env, 'POST', '/integrations/esign/send', {
  token: s.token,
  body: {
    contractId: CONTRACT, templateId: 'tpl_1', title: 'Puppy sale: Biscuit',
    signer: { firstName: 'Ann', lastName: 'Lee', email: 'Ann@Example.com' },
    facts: { puppyName: 'Biscuit', price: '2500.00', 'bad key': 'x', notes: '' },
    ...extra,
  },
});

function signed(body, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(body);
  const v1 = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return { raw, header: `t=${t},v1=${v1}` };
}
const hookPathOf = (env) => {
  const wh = [...fake.webhooks.values()].at(-1);
  return new URL(wh.url).pathname;
};
const postHook = (env, path, raw, header) => call(env, 'POST', path, { body: new TextEncoder().encode(raw), headers: header ? { 'x-firma-signature': header, 'content-type': 'application/json' } : {} });

// --- Tests ----------------------------------------------------------------------------------

test('connect makes her workspace, its webhook and seals its keys; once only; Pro only', async () => {
  const env = await envWith();
  const s = await connected(env);
  const w = fake.workspaces.get('ws_1');
  assert.equal(w.name, 'Maple Ridge Labradors');
  assert.equal(w.webhook_enabled, true, 'the workspace webhook switch is on');
  const wh = fake.webhooks.get('wh_1');
  assert.equal(wh.workspace_id, 'ws_1');
  assert.match(wh.url, /^https:\/\/api\.example\/hooks\/firma\/[0-9a-f]{64}$/);
  assert.deepEqual(wh.events.sort(), ['signing_request.cancelled', 'signing_request.completed', 'signing_request.expired', 'signing_request.recipient.declined']);

  const row = env.DB.raw.prepare("SELECT * FROM int_connections WHERE provider = 'firma'").get();
  assert.equal(row.account_ref, 'ws_1');
  for (const secret of ['live_ws_1', SECRET, new URL(wh.url).pathname.split('/').pop()]) {
    assert.ok(!JSON.stringify(row).includes(secret), 'no key, secret or hook secret in the clear');
  }

  const again = await call(env, 'POST', '/integrations/firma/connect', { token: s.token, body: {} });
  assert.equal(again.status, 200);
  assert.equal(fake.workspaces.size, 1, 'a second connect makes nothing');

  const status = await (await call(env, 'GET', '/integrations/firma', { token: s.token })).json();
  assert.equal(status.connected, true);
  assert.deepEqual({ used: status.usage.used, limit: status.usage.limit, own: status.usage.own }, { used: 0, limit: 10, own: false });
  assert.match(status.usage.resetsOn, /^\d{4}-\d{2}-01$/);

  const other = await signIn(env, 'free@example.com', { deviceId: 'x' });
  assert.equal((await call(env, 'POST', '/integrations/firma/connect', { token: other.token, body: {} })).status, 403, 'not Pro');
  const bare = await makeEnv({ INT_TOKEN_KEY: KEY });
  const s2 = await breeder(bare);
  const r = await call(bare, 'POST', '/integrations/firma/connect', { token: s2.token, body: {} });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'esign_not_configured');
});

test('in test mode her workspace\'s test key is the one kept', async () => {
  const env = await envWith({ FIRMA_TEST_MODE: 'true' });
  const s = await connected(env);
  await call(env, 'POST', '/integrations/firma/templates', { token: s.token, body: { name: 'Pet home', document: 'JVBERi0xLjQK' } });
  assert.equal(fake.calls.find((c) => c.path === '/templates').auth, 'test_ws_1');
});

test('connect undoes itself when Firma gives no webhook secret', async () => {
  const env = await envWith();
  const s = await breeder(env);
  const real = fake.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const res = await real(url, init);
    if (/\/workspaces\/ws_\d+$/.test(new URL(url).pathname) && (init.method || 'GET') === 'GET') {
      const d = await res.json();
      return new Response(JSON.stringify({ ...d, webhook_secret: null }), { status: 200 });
    }
    if (/rotate-secret$/.test(new URL(url).pathname)) return new Response('{}', { status: 500 });
    return res;
  };
  const r = await call(env, 'POST', '/integrations/firma/connect', { token: s.token, body: {} });
  assert.equal(r.status, 502);
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM int_connections'), 0);
  assert.equal(fake.webhooks.get('wh_1').deleted, true);
});

test('fields: her workspace gets the facts as custom fields, the missing ones only', async () => {
  const env = await envWith();
  const s = await connected(env);
  const fields = [{ name: 'puppyName', label: 'Puppy\'s call name' }, { name: 'price', label: 'Price' }, { name: 'bad name', label: 'x' }];
  assert.deepEqual(await (await call(env, 'POST', '/integrations/firma/fields', { token: s.token, body: { fields } })).json(), { added: 2 });
  assert.deepEqual(await (await call(env, 'POST', '/integrations/firma/fields', { token: s.token, body: { fields } })).json(), { added: 0 });
  assert.deepEqual(fake.fields.get('ws_1').map((f) => f.field_name), ['puppyName', 'price']);
  const many = Array.from({ length: 41 }, (_, i) => ({ name: `f${i}`, label: 'x' }));
  assert.equal((await call(env, 'POST', '/integrations/firma/fields', { token: s.token, body: { fields: many } })).status, 400);
});

test('templates: made, listed and opened with her workspace key; another kennel\'s is a 404', async () => {
  const env = await envWith();
  const s = await connected(env);
  const t = await (await call(env, 'POST', '/integrations/firma/templates', { token: s.token, body: { name: 'Pet home', document: 'JVBERi0xLjQK' } })).json();
  assert.deepEqual(t, { id: 'tpl_1', name: 'Pet home', pageCount: 2 });
  assert.equal(fake.calls.find((c) => c.path === '/templates').auth, 'live_ws_1', 'her key, not the master');
  assert.equal((await call(env, 'POST', '/integrations/firma/templates', { token: s.token, body: { name: 'x', document: 'not base64!' } })).status, 400);

  const list = await (await call(env, 'GET', '/integrations/firma/templates', { token: s.token })).json();
  assert.deepEqual(list.templates.map((x) => x.name), ['Pet home']);
  const tok = await (await call(env, 'POST', '/integrations/firma/template-token', { token: s.token, body: { templateId: 'tpl_1' } })).json();
  assert.equal(tok.token, 'jwt_tpl_1');

  const s2 = await connected(env, 'other@example.com');
  assert.equal((await call(env, 'POST', '/integrations/firma/template-token', { token: s2.token, body: { templateId: 'tpl_1' } })).status, 404);
  assert.equal((await call(env, 'GET', '/integrations/firma/templates', { token: s2.token })).status, 200);

  const s3 = await breeder(env, 'unconnected@example.com');
  const r = await call(env, 'GET', '/integrations/firma/templates', { token: s3.token });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'esign_not_connected');
});

test('send: the buyer as Signer with the facts, on her key; a second send needs resend', async () => {
  const env = await envWith();
  const s = await connected(env);
  const r = await send(env, s);
  assert.equal(r.status, 200, await r.clone().text());
  const out = await r.json();
  assert.equal(out.signingRequestId, 'sr_1');
  assert.equal(out.signingLink, 'https://app.firma.dev/signing/su_sr_1');
  assert.equal(out.usage.used, 1);

  const call0 = fake.calls.find((c) => c.path === '/signing-requests/create-and-send');
  assert.equal(call0.auth, 'live_ws_1');
  assert.equal(call0.body.template_id, 'tpl_1');
  assert.deepEqual(call0.body.recipients, [{ first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com', designation: 'Signer', order: 1, custom_fields: { puppyName: 'Biscuit', price: '2500.00' } }]);
  assert.equal(call0.body.settings.send_signing_email, true);

  const row = env.DB.raw.prepare('SELECT * FROM esign_sends').get();
  assert.equal(row.contract_id, CONTRACT);
  assert.equal(row.status, 'sent');
  assert.ok(!JSON.stringify(row).includes('ann@example.com') && !JSON.stringify(row).includes('Biscuit'), 'no buyer data kept');

  const again = await send(env, s);
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: 'already_sent', signingRequestId: 'sr_1', status: 'sent' });
  const resent = await send(env, s, { resend: true, emailSigner: false });
  assert.equal(resent.status, 200);
  assert.equal(fake.sends.at(-1).body.settings.send_signing_email, false);
  assert.equal((await resent.json()).usage.used, 2, 'a resend counts again');

  for (const bad of [{ contractId: 'a/b' }, { templateId: '' }, { signer: { firstName: '', email: 'a@b.co' } }, { signer: { firstName: 'A', email: 'nope' } }]) {
    assert.equal((await send(env, s, bad)).status, 400, JSON.stringify(bad));
  }
});

test('the monthly limit: the default from /ops, an account\'s own, and the month\'s reset', async () => {
  const env = await envWith();
  const s = await connected(env);
  for (let i = 0; i < 10; i++) {
    assert.equal((await send(env, s, { contractId: `c-${i}` })).status, 200);
  }
  const over = await send(env, s, { contractId: 'c-10' });
  assert.equal(over.status, 409);
  const body = await over.json();
  assert.equal(body.error, 'esign_limit_reached');
  assert.deepEqual([body.usage.used, body.usage.limit], [10, 10]);
  assert.equal(fake.sends.length, 10, 'Firma was not called');

  await firma.setDefaultMonthlyLimit(env, 12);
  assert.equal((await send(env, s, { contractId: 'c-10' })).status, 200);
  await firma.setProgramMonthlyLimit(env, s.programId, 11);
  assert.equal((await send(env, s, { contractId: 'c-11' })).status, 409, 'her own limit replaces the default');
  await firma.setProgramMonthlyLimit(env, s.programId, null);
  assert.equal((await send(env, s, { contractId: 'c-11' })).status, 200, 'back to the default');
  await assert.rejects(firma.setDefaultMonthlyLimit(env, -1), /bad_limit/);
  await assert.rejects(firma.setProgramMonthlyLimit(env, s.programId, 'x'), /bad_limit/);

  // Last month's sends don't count.
  env.DB.raw.prepare('UPDATE esign_sends SET sent_at = ?').run('2020-01-15T00:00:00.000Z');
  assert.equal((await firma.usage(env, s.programId)).used, 0);
  assert.deepEqual(firma.monthBounds(new Date('2026-12-31T23:59:00Z')), { start: '2026-12-01T00:00:00.000Z', resetsOn: '2027-01-01' });
});

test('send failures: a refusal frees its place, an unknown outcome keeps it, a started send is kept', async () => {
  const env = await envWith();
  const s = await connected(env);

  fake.sendReply = () => ({ status: 400, data: { code: 'RECIPIENT_EMAIL_SUPPRESSED', error: 'ann@example.com is suppressed' } });
  const refused = await send(env, s);
  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), { error: 'esign_refused', code: 'RECIPIENT_EMAIL_SUPPRESSED' }, 'Firma\'s code, never its message');
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_sends'), 0);

  fake.sendReply = () => ({ status: 402, data: { code: 'INSUFFICIENT_CREDITS' } });
  assert.equal((await send(env, s)).status, 503);
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_sends'), 0);

  fake.sendReply = () => 'network';
  const lost = await send(env, s);
  assert.equal(lost.status, 502);
  assert.equal((await lost.json()).error, 'esign_unknown');
  assert.equal(env.DB.raw.prepare('SELECT status FROM esign_sends').get().status, 'unknown', 'counted: the credit may be spent');
  assert.equal((await send(env, s)).status, 409, 'and it holds the contract until she resends');

  env.DB.raw.prepare('DELETE FROM esign_sends').run();
  fake.sendReply = () => ({ status: 409, data: { code: 'SEND_EFFECTS_EXIST', signing_request_id: 'sr_started' } });
  const started = await (await send(env, s)).json();
  assert.equal(started.signingRequestId, 'sr_started');
  assert.equal(started.signingLink, 'https://app.firma.dev/signing/su_sr_started');
});

test('the webhook: signed by her workspace\'s secret, matched to her contract, nothing else kept', async () => {
  const env = await envWith();
  const s = await connected(env);
  await send(env, s);
  const path = hookPathOf(env);
  const event = {
    id: 'evt_1', type: 'signing_request.completed', created_at: '2026-11-11T20:00:00Z', workspace_id: 'ws_1',
    data: { signing_request: { id: 'sr_1', completed_at: '2026-11-10T18:30:00Z' }, recipients: [{ email: 'ann@example.com', name: 'Ann Lee' }] },
  };

  const forged = signed(event, { secret: 'b'.repeat(64) });
  assert.equal((await postHook(env, path, forged.raw, forged.header)).status, 401);
  const stale = signed(event, { t: Math.floor(Date.now() / 1000) - 600 });
  assert.equal((await postHook(env, path, stale.raw, stale.header)).status, 401, 'outside the 5-minute window');
  assert.equal((await postHook(env, path, JSON.stringify(event), null)).status, 401);

  const good = signed(event);
  const r = await postHook(env, path, good.raw, good.header);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, received: 1 });
  const ev = env.DB.raw.prepare('SELECT * FROM int_events').get();
  assert.deepEqual([ev.provider, ev.kind, ev.record_type, ev.record_id, JSON.parse(ev.payload)],
    ['firma', 'contract.signed', 'contract', CONTRACT, { date: '2026-11-10' }]);
  assert.equal(env.DB.raw.prepare('SELECT status FROM esign_sends').get().status, 'completed');

  const events = await (await call(env, 'GET', '/integrations/events?since=0', { token: s.token })).json();
  assert.equal(events.events[0].kind, 'contract.signed');
  assert.ok(!JSON.stringify(events).includes('ann@'), 'no buyer data');

  const unknown = signed({ ...event, id: 'evt_2', data: { signing_request: { id: 'sr_someone_else' } } });
  assert.deepEqual(await (await postHook(env, path, unknown.raw, unknown.header)).json(), { ok: true, received: 0 });
  const test_ = signed({ type: 'webhook.test', webhook_id: 'wh_1', data: {} });
  assert.equal((await postHook(env, path, test_.raw, test_.header)).status, 200);
  const expired = signed({ ...event, id: 'evt_3', type: 'signing_request.expired' });
  await postHook(env, path, expired.raw, expired.header);
  assert.equal(env.DB.raw.prepare("SELECT kind FROM int_events WHERE kind = 'contract.expired'").get().kind, 'contract.expired');
});

test('the signed document: a short-lived link, only for her own request', async () => {
  const env = await envWith();
  const s = await connected(env);
  await send(env, s);
  const d = await (await call(env, 'GET', '/integrations/esign/document?ref=sr_1', { token: s.token })).json();
  assert.deepEqual(d, { url: 'https://files.firma.dev/sr_1.pdf?sig=x', expiresAt: '2026-11-11T23:00:00Z', partial: false, status: 'finished' });
  const s2 = await connected(env, 'other@example.com');
  assert.equal((await call(env, 'GET', '/integrations/esign/document?ref=sr_1', { token: s2.token })).status, 404);
});

test('disconnect stops the webhook; account deletion removes her sends and limit; retention keeps a year', async () => {
  const env = await envWith();
  const s = await connected(env);
  await send(env, s);
  await firma.setProgramMonthlyLimit(env, s.programId, 3);
  const { connections } = await (await call(env, 'GET', '/integrations/connections', { token: s.token })).json();
  assert.equal((await call(env, 'DELETE', `/integrations/connections/${connections[0].id}`, { token: s.token })).status, 200);
  assert.equal(fake.webhooks.get('wh_1').deleted, true);
  assert.equal(fake.calls.find((c) => c.method === 'DELETE').auth, MASTER);

  await call(env, 'POST', '/integrations/firma/connect', { token: s.token, body: {} });
  await send(env, s, { contractId: 'c-2' });
  env.DB.raw.prepare("UPDATE esign_sends SET sent_at = ? WHERE contract_id = ?").run(iso(Date.now() - 500 * 86400000), CONTRACT);
  await runRetention(env);
  assert.deepEqual(env.DB.raw.prepare('SELECT contract_id FROM esign_sends').all().map((r) => r.contract_id), ['c-2']);

  await removeAccount(env, { userId: s.userId ?? env.DB.raw.prepare('SELECT owner_user_id AS u FROM programs WHERE id = ?').get(s.programId).u, programId: s.programId });
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_sends'), 0);
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_limits'), 0);
  assert.equal(fake.webhooks.get('wh_2').deleted, true);
});

test('/ops sets the default limit and an account\'s own', async () => {
  const env = await envWith();
  const s = await connected(env);
  await send(env, s);
  const login = await worker.fetch(new Request('https://api.example/ops/login', { method: 'POST', body: new URLSearchParams({ token: 'ops' }) }), env);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const ops = (path, fields) => worker.fetch(new Request(`https://api.example${path}`, fields
    ? { method: 'POST', body: new URLSearchParams(fields), headers: { cookie } } : { headers: { cookie } }), env);

  const page = await (await ops('/ops')).text();
  assert.match(page, /E-sign \(Firma\)/);
  assert.match(page, /<strong>42<\/strong>/, 'credits left');
  assert.match(page, /name="limit"[^>]*value="10"/);

  assert.match(await (await ops('/ops/esign-limit', { limit: '25' })).text(), /may now send 25 contract/);
  assert.equal(await firma.defaultMonthlyLimit(env), 25);
  assert.match(await (await ops('/ops/esign-limit', { limit: '-4' })).text(), /Nothing changed/);
  assert.equal(await firma.defaultMonthlyLimit(env), 25);

  const found = await (await ops('/ops/account/find', { email: 'breeder@example.com' })).text();
  assert.match(found, /Contracts sent for e-signature this month<\/td><td>1 of 25 \(the default\)/);
  assert.match(await (await ops('/ops/account/esign-limit', { program_id: s.programId, limit: '40' })).text(), /may now send 40/);
  assert.deepEqual(await firma.monthlyLimitFor(env, s.programId), { limit: 40, own: true });
  assert.match(await (await ops('/ops/account/esign-limit', { program_id: s.programId, limit: '' })).text(), /uses the default/);
  assert.deepEqual(await firma.monthlyLimitFor(env, s.programId), { limit: 25, own: false });
});
