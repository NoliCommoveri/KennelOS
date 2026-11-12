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
    calls: [], workspaces: new Map(), webhooks: new Map(), templates: new Map(), drafts: new Map(), deletedDrafts: [], fields: new Map(), sends: [], mails: [],
    pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), downloadReply: null, buyerEmail: undefined,
    sendReply: null, // (body) => { status, data } to override create-and-send once
    nextWs: 1, nextSr: 1, nextDraft: 0, srDown: false,
  };
  f.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'files.firma.dev') return new Response(f.pdf, { status: 200, headers: { 'content-type': 'application/pdf' } });
    if (u.hostname === 'api.resend.com') { f.mails.push(JSON.parse(init.body)); return new Response('{"id":"m"}', { status: 200 }); }
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
      return t && (t.ws === wsOfKey.id || t.ws === ANY_WS) ? reply(200, t) : reply(404, { code: 'NOT_FOUND' });
    }
    if (method === 'POST' && path === '/generate-template-token') return reply(201, { token: `jwt_${body.companies_workspaces_templates_id}`, expires_at: '2026-11-12T00:00:00Z' });
    if (method === 'POST' && path === '/signing-requests') {
      const id = `draft_${++f.nextDraft}`;
      f.drafts.set(id, { id, ws: wsOfKey.id, status: 'draft', body });
      return reply(201, { id, status: 'draft' });
    }
    if (method === 'POST' && path === '/jwt/generate-signing-request') {
      return f.drafts.has(body.companies_workspaces_signing_requests_id)
        ? reply(200, { jwt: `srjwt_${body.companies_workspaces_signing_requests_id}`, expires_at: '2026-11-19T00:00:00Z' }) : reply(404, {});
    }
    if ((m = /^\/signing-requests\/([^/]+)$/.exec(path)) && (method === 'GET' || method === 'DELETE')) {
      const d = f.drafts.get(m[1]) || (f.sends.some((x) => x.id === m[1]) ? { id: m[1], ws: f.sends.find((x) => x.id === m[1]).ws, status: 'sent' } : null);
      if (!d || d.ws !== wsOfKey.id) return reply(404, {});
      if (f.srDown) return reply(500, {});
      if (method === 'GET') return reply(200, { id: d.id, status: d.status });
      f.drafts.delete(m[1]); f.deletedDrafts.push(m[1]);
      return reply(200, { deleted: true });
    }
    if (method === 'POST' && path === '/signing-requests/create-and-send') {
      if (f.sendReply) { const r = f.sendReply(body); f.sendReply = null; if (r === 'network') throw new TypeError('fetch failed'); return reply(r.status, r.data); }
      const id = `sr_${f.nextSr++}`;
      f.sends.push({ id, ws: wsOfKey.id, body });
      return reply(201, { id, status: 'sent', first_signer: { id: `su_${id}`, email: body.recipients[0].email, signing_link: `https://app.firma.dev/signing/su_${id}` }, credits_remaining: 41 });
    }
    if (method === 'GET' && (m = /^\/signing-requests\/([^/]+)\/users$/.exec(path))) {
      const sent = f.sends.find((x) => x.id === m[1]);
      const recipients = sent?.body.recipients || [{ order: 1 }];
      return reply(200, recipients.map((r) => ({
        id: r.order === 1 ? `su_${m[1]}` : `su_${m[1]}_${r.order}`, designation: 'Signer', order: r.order,
        email: r.order === 1 && f.buyerEmail !== undefined ? f.buyerEmail : r.email,
      })));
    }
    if (method === 'GET' && (m = /^\/signing-requests\/([^/]+)\/download$/.exec(path))) {
      if (f.downloadReply) return reply(f.downloadReply.status, f.downloadReply.data);
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

// A template every workspace can read by id (never listed), so a send's template check passes.
const ANY_WS = '*';
const send = (env, s, extra = {}) => {
  const id = extra.templateId ?? 'tpl_1';
  if (id && !fake.templates.has(id) && !extra.noTemplate) fake.templates.set(id, { id, name: 'Contract', ws: ANY_WS });
  return sendRaw(env, s, extra);
};
const sendRaw = (env, s, { noTemplate, ...extra } = {}) => call(env, 'POST', '/integrations/esign/send', {
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

test('send: each fact also goes under its custom field\'s ids, so a field the editor tied to an id fills', async () => {
  const env = await envWith();
  const s = await connected(env);
  const sync = await call(env, 'POST', '/integrations/firma/fields', { token: s.token, body: { fields: [{ name: 'puppyName', label: 'Puppy\'s call name' }, { name: 'buyerPhone', label: 'Buyer\'s phone' }] } });
  assert.equal(sync.status, 200, await sync.clone().text());
  const r = await send(env, s);
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(fake.sends[0].body.recipients[0].custom_fields, { puppyName: 'Biscuit', price: '2500.00', cf_0: 'Biscuit', custom_workspace_cf_0: 'Biscuit' },
    'puppyName also as its field id; buyerPhone has no value, so nothing goes for it');
});

test('field aliases and empty prefills (pure)', () => {
  const rows = [
    { id: 'cf_9', field_name: 'BuyerName', field_label: 'Buyer\'s full name', variable_name: 'cf_buyer_name' },
    { id: 'price', field_name: 'price' },
    { id: 'has space', field_name: 'puppyName' },
    { id: 'cf_x', field_name: 'notSent' }
  ];
  assert.deepEqual(firma.withFieldAliases({ buyerName: 'Ann Lee', price: '1.00', puppyName: 'Bo' }, rows),
    { buyerName: 'Ann Lee', price: '1.00', puppyName: 'Bo', cf_9: 'Ann Lee', cf_buyer_name: 'Ann Lee', custom_workspace_cf_9: 'Ann Lee', custom_workspace_price: '1.00' },
    'matched case-insensitively; no duplicate keys; odd ids and unsent facts skipped');
  assert.deepEqual(firma.withFieldAliases({ a: '1' }, null), { a: '1' }, 'no list: the facts as they are');
  const uuid = 'aecb2afb-abb7-4c60-b440-82ee1bdc7144';
  assert.equal(firma.withFieldAliases({ buyerName: 'Ann' }, [{ id: uuid, field_name: 'buyerName' }])[`custom_workspace_${uuid}`], 'Ann',
    'the key Firma\'s editor stores for a workspace custom field (production log)');
  assert.deepEqual(firma.emptyPrefills({ fields: [
    { format_rules: { prefilledData: 'cf_1' }, value: '' },
    { format_rules: { prefilledData: 'cf_2' }, value: 'Ann' },
    { format_rules: {} },
    { format_rules: { prefilledData: 'phone_number' } }
  ] }), ['cf_1', 'phone_number']);
  assert.deepEqual(firma.emptyPrefills({}), []);
});

test('countersign: she is the second Signer of the same request, and gets her own link', async () => {
  const env = await envWith();
  const s = await connected(env);
  const r = await send(env, s, { countersigner: { name: 'Maple Ridge Labradors', email: 'Breeder@Example.com' } });
  assert.equal(r.status, 200, await r.clone().text());
  const out = await r.json();
  assert.equal(out.countersign, true);
  assert.equal(out.signingLink, 'https://app.firma.dev/signing/su_sr_1', 'the buyer\'s link, not hers');
  assert.equal(out.usage.used, 1, 'one request, one send');
  assert.deepEqual(fake.sends[0].body.recipients.map((x) => [x.email, x.order, x.designation]),
    [['ann@example.com', 1, 'Signer'], ['breeder@example.com', 2, 'Signer']]);
  assert.deepEqual(fake.sends[0].body.recipients[1].custom_fields, fake.sends[0].body.recipients[0].custom_fields,
    'the facts go with both signers, so a field placed for her fills (and a required one never blocks the send)');
  assert.ok(!JSON.stringify(env.DB.raw.prepare('SELECT * FROM esign_sends').get()).includes('breeder@example.com'), 'her email not kept');

  const link = await call(env, 'GET', '/integrations/esign/countersign?ref=sr_1', { token: s.token });
  assert.equal(link.status, 200, await link.clone().text());
  assert.deepEqual(await link.json(), { url: 'https://app.firma.dev/signing/su_sr_1_2' });

  const s2 = await connected(env, 'other@example.com');
  assert.equal((await call(env, 'GET', '/integrations/esign/countersign?ref=sr_1', { token: s2.token })).status, 404, 'another kennel\'s request');
  assert.equal((await call(env, 'GET', '/integrations/esign/countersign?ref=a/b', { token: s.token })).status, 400);

  // A request without her: nothing to countersign.
  await send(env, s, { contractId: 'c-2' });
  const none = await call(env, 'GET', '/integrations/esign/countersign?ref=sr_2', { token: s.token });
  assert.equal(none.status, 409);
  assert.equal((await none.json()).error, 'no_countersigner');

  // Once signed (or declined, expired, cancelled) it isn't open any more.
  env.DB.raw.prepare("UPDATE esign_sends SET status = 'completed' WHERE signing_request_id = 'sr_1'").run();
  const closed = await call(env, 'GET', '/integrations/esign/countersign?ref=sr_1', { token: s.token });
  assert.equal(closed.status, 409);
  assert.deepEqual(await closed.json(), { error: 'esign_not_open', status: 'completed' });

  for (const bad of [{ name: '', email: 'b@ex.com' }, { name: 'B', email: 'nope' }, { name: 'B', email: 'ann@example.com' }]) {
    assert.equal((await send(env, s, { contractId: 'c-3', countersigner: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal(fake.sends.length, 2, 'a bad countersigner never reaches Firma');
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

test('send: a template gone from Firma is refused before it counts; the list says it is complete', async () => {
  const env = await envWith();
  const s = await connected(env);
  const gone = await send(env, s, { templateId: 'tpl_deleted', noTemplate: true });
  assert.equal(gone.status, 404);
  assert.equal((await gone.json()).error, 'template_missing');
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_sends'), 0, 'no place taken');
  assert.ok(!fake.calls.some((c) => c.path === '/signing-requests/create-and-send'), 'Firma never asked to send it');

  // Deleted between the check and the send: Firma's 404 frees the place too.
  fake.sendReply = () => ({ status: 404, data: { code: 'NOT_FOUND' } });
  const late = await send(env, s);
  assert.equal(late.status, 404);
  assert.equal((await late.json()).error, 'template_missing');
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_sends'), 0);

  // Any other answer to the check leaves the send to Firma.
  fake.templates.delete('tpl_1');
  const realFake = fake.fetch;
  globalThis.fetch = async (url, init) => (/\/templates\/tpl_1$/.test(new URL(url).pathname) ? new Response('{}', { status: 500 }) : realFake(url, init));
  assert.equal((await sendRaw(env, s)).status, 200);
  globalThis.fetch = realFake;

  const list = await (await call(env, 'GET', '/integrations/firma/templates', { token: s.token })).json();
  assert.equal(list.complete, true);

  // One send reads the template once.
  fake.calls.length = 0;
  assert.equal((await send(env, s, { resend: true })).status, 200);
  assert.equal(fake.calls.filter((c) => c.path === '/templates/tpl_1').length, 1);
});

test('preview: a free draft of the send, opened by token, never counted; only a draft is ever discarded', async () => {
  const env = await envWith();
  const s = await connected(env);
  fake.templates.set('tpl_1', { id: 'tpl_1', name: 'Contract', ws: ANY_WS });
  const r = await call(env, 'POST', '/integrations/esign/preview', { token: s.token, body: {
    contractId: CONTRACT, templateId: 'tpl_1', title: 'Puppy sale: Biscuit',
    signer: { firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com' },
    facts: { puppyName: 'Biscuit' }, countersigner: { name: 'Jane Doe', email: 'jane@example.com' } } });
  assert.equal(r.status, 200, await r.clone().text());
  const out = await r.json();
  assert.deepEqual(out, { previewId: 'draft_1', token: 'srjwt_draft_1', expiresAt: '2026-11-19T00:00:00Z' });
  const draft = fake.drafts.get('draft_1').body;
  assert.equal(draft.template_id, 'tpl_1');
  assert.equal(draft.recipients[0].custom_fields.puppyName, 'Biscuit');
  assert.equal(draft.recipients[1].first_name, 'Jane Doe', 'she\'s on it too, as on a send');
  assert.equal(draft.settings.send_signing_email, false);
  assert.ok(!fake.calls.some((c) => c.path === '/signing-requests/create-and-send'), 'nothing sent');
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM esign_sends WHERE status != 'preview'"), 0, 'never counted');
  assert.equal((await firma.usage(env, s.programId)).used, 0);
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM esign_sends WHERE status = 'preview' AND signing_request_id = 'draft_1'"), 1, 'it holds a place');

  const gone = await call(env, 'POST', '/integrations/esign/preview', { token: s.token, body: {
    contractId: CONTRACT, templateId: 'tpl_x', signer: { firstName: 'Ann', email: 'ann@example.com' } } });
  assert.equal((await gone.json()).error, 'template_missing');

  const del = await call(env, 'DELETE', '/integrations/esign/preview?id=draft_1', { token: s.token });
  assert.deepEqual(await del.json(), { discarded: true });
  assert.deepEqual(fake.deletedDrafts, ['draft_1']);
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_sends'), 0, 'its place is free again');

  // A sent request is never deleted through this route.
  const sent = await (await send(env, s)).json();
  assert.deepEqual(await (await call(env, 'DELETE', `/integrations/esign/preview?id=${sent.signingRequestId}`, { token: s.token })).json(), { discarded: false });
  assert.deepEqual(fake.deletedDrafts, ['draft_1']);
});

const preview = (env, s, extra = {}) => {
  if (!fake.templates.has('tpl_1')) fake.templates.set('tpl_1', { id: 'tpl_1', name: 'Contract', ws: ANY_WS });
  return call(env, 'POST', '/integrations/esign/preview', { token: s.token, body: {
    contractId: CONTRACT, templateId: 'tpl_1', title: 'Puppy sale: Biscuit',
    signer: { firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com' }, facts: { puppyName: 'Biscuit' }, ...extra } });
};
const previews = (env) => count(env, "SELECT COUNT(*) AS n FROM esign_sends WHERE status = 'preview'");

test('a preview holds a place: one at a time, none at the limit, and a send frees it', async () => {
  const env = await envWith();
  const s = await connected(env);
  await firma.setProgramMonthlyLimit(env, s.programId, 2);

  // A new preview replaces the one before it.
  assert.equal((await preview(env, s)).status, 200);
  assert.equal((await (await preview(env, s)).json()).previewId, 'draft_2');
  assert.deepEqual(fake.deletedDrafts, ['draft_1']);
  assert.equal(previews(env), 1);

  // A send discards her open preview first, so it never blocks her own send.
  assert.equal((await send(env, s)).status, 200);
  assert.deepEqual(fake.deletedDrafts, ['draft_1', 'draft_2']);
  assert.equal(previews(env), 0);
  assert.equal((await firma.usage(env, s.programId)).used, 1);

  // One place left: a preview takes it, and is still only a preview.
  assert.equal((await preview(env, s)).status, 200);
  assert.equal((await firma.usage(env, s.programId)).used, 1);
  assert.equal((await send(env, s, { resend: true })).status, 200);
  assert.equal((await firma.usage(env, s.programId)).used, 2);

  // At the limit there's no place to hold: no preview.
  const full = await preview(env, s);
  assert.equal(full.status, 409);
  assert.equal((await full.json()).error, 'esign_limit_reached');
  assert.ok(!fake.drafts.size, 'no draft made');
});

test('a preview whose draft can\'t be discarded keeps its place, so a draft sent another way can\'t pass the limit', async () => {
  const env = await envWith();
  const s = await connected(env);
  await firma.setProgramMonthlyLimit(env, s.programId, 1);
  assert.equal((await preview(env, s)).status, 200);

  // Firma doesn't answer for the draft: its place stays held, and the last place isn't sold twice.
  fake.srDown = true;
  const held = await send(env, s);
  assert.equal(held.status, 409);
  assert.equal((await held.json()).error, 'esign_limit_reached');
  assert.equal(fake.sends.length, 0);
  assert.equal(previews(env), 1);

  // The draft was sent from Firma's own editor with its token: found, and counted as her send.
  fake.srDown = false;
  fake.drafts.get('draft_1').status = 'sent';
  const after = await send(env, s);
  assert.equal(after.status, 409, 'the month is used: the draft took the place');
  assert.equal(previews(env), 0);
  assert.equal((await firma.usage(env, s.programId)).used, 1);
  assert.deepEqual(fake.deletedDrafts, [], 'a sent request is never deleted');
});

test('the hourly sweep discards previews left open; a status KennelOS doesn\'t know is never counted', async () => {
  const env = await envWith();
  const s = await connected(env);
  assert.equal((await preview(env, s)).status, 200);
  const soon = new Date(Date.now() + 10 * 60 * 1000);
  assert.deepEqual(await firma.runEsignPreviews(env, { now: soon }), { freed: 0, counted: 0, held: 0 }, 'under an hour old: left alone');
  const later = new Date(Date.now() + firma.PREVIEW_KEEP_MS + 60 * 1000);
  assert.deepEqual(await firma.runEsignPreviews(env, { now: later }), { freed: 1, counted: 0, held: 0 });
  assert.deepEqual(fake.deletedDrafts, ['draft_1']);
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_sends'), 0);

  // An unknown status: held, never counted, and let go once its token is dead.
  assert.equal((await preview(env, s)).status, 200);
  fake.drafts.get('draft_2').status = 'something_new';
  assert.deepEqual(await firma.runEsignPreviews(env, { now: later }), { freed: 0, counted: 0, held: 1 });
  assert.equal((await firma.usage(env, s.programId)).used, 0);
  const dead = new Date(Date.now() + firma.PREVIEW_TOKEN_MS + 60 * 1000);
  assert.deepEqual(await firma.runEsignPreviews(env, { now: dead }), { freed: 1, counted: 0, held: 0 });
  assert.deepEqual(fake.deletedDrafts, ['draft_1'], 'only a draft is ever deleted');

  // A draft that was sent: the sweep counts it.
  assert.equal((await preview(env, s)).status, 200);
  fake.drafts.get('draft_3').status = 'completed';
  assert.deepEqual(await firma.runEsignPreviews(env, { now: later }), { freed: 0, counted: 1, held: 0 });
  assert.equal((await firma.usage(env, s.programId, later)).used, 1);
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
  assert.deepEqual(d, { url: 'https://files.firma.dev/sr_1.pdf?sig=x', expiresAt: '2026-11-11T23:00:00Z', partial: false, status: 'finished', kept: false, emailedAt: null });
  const s2 = await connected(env, 'other@example.com');
  assert.equal((await call(env, 'GET', '/integrations/esign/document?ref=sr_1', { token: s2.token })).status, 404);
});

test('keep the copy: queued when signed, copied to R2, the buyer emailed a link, her Signed copy is ours', async () => {
  const env = await envWith({ MAIL_FROM: 'KennelOS <signin@kennelos.app>', FAMILY_PAGES_ORIGIN: 'https://apply.kennelos.app' });
  const s = await connected(env);
  env.RESEND_API_KEY = 're_test'; // after sign-in, whose code the outbox holds
  const r = await send(env, s, { keepCopy: true, kennelName: '  Maple   Ridge  ' });
  assert.equal((await r.json()).keepCopy, true);
  await send(env, s, { contractId: 'c-plain' });
  const row = () => env.DB.raw.prepare("SELECT * FROM esign_sends WHERE signing_request_id = 'sr_1'").get();
  assert.deepEqual([row().keep_copy, row().kennel_name, row().copy_status], [1, 'Maple Ridge', null]);

  // Nothing to do until it's signed.
  assert.deepEqual(await firma.runEsignCopies(env), { kept: 0, emailed: 0, noEmail: 0, failed: 0, waiting: 0 });

  const hook = hookPathOf(env);
  for (const id of ['sr_1', 'sr_2']) {
    const { raw, header } = signed({ id: `evt_${id}`, type: 'signing_request.completed', created_at: iso(Date.now()), data: { signing_request: { id, completed_at: '2026-11-12T10:00:00Z' } } });
    assert.equal((await postHook(env, hook, raw, header)).status, 200);
  }
  assert.equal(row().copy_status, 'pending');
  assert.equal(env.DB.raw.prepare("SELECT copy_status FROM esign_sends WHERE signing_request_id = 'sr_2'").get().copy_status, null, 'not asked: not kept');

  // Firma still preparing it: tried again next hour.
  fake.downloadReply = { status: 503, data: { code: 'NOT_READY' } };
  assert.equal((await firma.runEsignCopies(env)).waiting, 1);
  assert.deepEqual([row().copy_status, row().copy_tries], ['pending', 1]);
  fake.downloadReply = null;

  const out = await firma.runEsignCopies(env);
  assert.deepEqual(out, { kept: 1, emailed: 1, noEmail: 0, failed: 0, waiting: 0 });
  assert.equal(row().copy_status, 'emailed');
  assert.equal(row().copy_key, `esign/${s.programId}/${row().id}.pdf`);
  assert.equal(row().copy_bytes, fake.pdf.length);
  assert.ok(row().emailed_at);
  assert.ok(!JSON.stringify(row()).includes('ann@example.com'), 'the buyer\'s email not kept');

  assert.equal(fake.mails.length, 1);
  const mail = fake.mails[0];
  assert.deepEqual(mail.to, ['ann@example.com']);
  assert.equal(mail.from, '"Maple Ridge via KennelOS" <signin@kennelos.app>');
  assert.equal(mail.subject, 'Your signed contract from Maple Ridge');
  const link = /https:\/\/apply\.kennelos\.app(\/signed\/[^\s]+)/.exec(mail.text)[1];

  // The link serves the PDF; a changed mac or id doesn't.
  const res = await call(env, 'GET', link);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), fake.pdf);
  assert.equal((await call(env, 'GET', link.replace(/.$/, (c) => (c === '0' ? '1' : '0')))).status, 404);
  assert.equal((await call(env, 'GET', `/signed/${crypto.randomUUID()}/${'0'.repeat(32)}`)).status, 404);

  // Her Signed copy is the same link.
  const d = await (await call(env, 'GET', '/integrations/esign/document?ref=sr_1', { token: s.token })).json();
  assert.equal(d.kept, true);
  assert.ok(d.url.endsWith(link));
  assert.equal(d.emailedAt, row().emailed_at);

  // Done: the next run leaves it alone.
  assert.deepEqual(await firma.runEsignCopies(env), { kept: 0, emailed: 0, noEmail: 0, failed: 0, waiting: 0 });
  assert.equal(fake.mails.length, 1);

  // Retention keeps a kept copy's row past the year; account deletion removes it and the PDF.
  env.DB.raw.prepare("UPDATE esign_sends SET sent_at = '2020-01-01T00:00:00.000Z'").run();
  await runRetention(env);
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_sends'), 1, 'the kept one only');
  assert.ok(await env.FILES.get(row().copy_key));
  const key = row().copy_key;
  await removeAccount(env, { userId: env.DB.raw.prepare('SELECT owner_user_id AS u FROM programs WHERE id = ?').get(s.programId).u, programId: s.programId });
  assert.equal(await env.FILES.get(key), null);
  assert.equal((await call(env, 'GET', link)).status, 404);
});

test('keep the copy: no buyer email from Firma, and giving up after two days', async () => {
  const env = await envWith({ FAMILY_PAGES_ORIGIN: 'https://apply.kennelos.app' });
  const s = await connected(env);
  await send(env, s, { keepCopy: true, kennelName: 'Maple' });
  await send(env, s, { contractId: 'c-2', keepCopy: true });
  env.DB.raw.prepare("UPDATE esign_sends SET status = 'completed', copy_status = 'pending'").run();
  const st = (id) => env.DB.raw.prepare('SELECT copy_status, copy_key FROM esign_sends WHERE signing_request_id = ?').get(id);

  fake.buyerEmail = '';
  const out = await firma.runEsignCopies(env);
  assert.deepEqual([out.kept, out.noEmail], [2, 2]);
  assert.equal(st('sr_1').copy_status, 'no_email');
  assert.ok(st('sr_1').copy_key, 'kept all the same: her Signed copy opens it');

  env.DB.raw.prepare("UPDATE esign_sends SET copy_status = 'pending', copy_key = NULL, copy_tries = ? WHERE signing_request_id = 'sr_2'").run(firma.COPY_MAX_TRIES - 1);
  fake.downloadReply = { status: 200, data: { is_partial: true, download_url: 'https://files.firma.dev/x.pdf' } };
  assert.equal((await firma.runEsignCopies(env)).failed, 1);
  assert.equal(st('sr_2').copy_status, 'failed', 'a partial copy is never kept, and two days of tries end it');
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

test('the template editor page is served sandboxed, with no referrer and no caching', async () => {
  const assets = { fetch: async (req) => {
    const path = new URL(req.url).pathname;
    return path.startsWith('/esign/') ? new Response(`file:${path}`, { status: 200 }) : new Response('not found', { status: 404 });
  } };
  const env = await makeEnv({ ASSETS: assets });
  const get = (path) => worker.fetch(new Request(`https://api.example${path}`), env);
  const page = await get('/esign/editor');
  assert.equal(page.status, 200);
  assert.equal(await page.text(), 'file:/esign/editor.html');
  assert.match(page.headers.get('content-security-policy'), /^sandbox allow-scripts /);
  assert.doesNotMatch(page.headers.get('content-security-policy'), /allow-same-origin/, 'an opaque origin: no cookies, no storage');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(await (await get('/esign/editor.js')).text(), 'file:/esign/editor.js');
  assert.equal(await (await get('/esign/editor.css')).text(), 'file:/esign/editor.css');
  for (const path of ['/esign/editor.html', '/esign/other.js', '/esign/']) assert.notEqual((await get(path)).status, 200, path);
});
