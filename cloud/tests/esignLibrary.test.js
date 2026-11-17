// The template library (docs/KennelOS_Integrations_Plan.md §2.3b): support links an
// account's Firma workspace as the library in the manager app, names breeders, says who
// may add each template; a breeder adds a copy to her workspace with its prefilled
// fields pointed at her own custom fields (by field_name). A fake Firma stands in.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn } from './helpers/env.js';
import { worker } from './helpers/worker.js';

const { prefillRemap } = await import('../src/esignLibrary.js');
const { removeAccount } = await import('../src/program.js');

const MASTER = 'firma_master_key';
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const count = (env, sql, ...a) => env.DB.raw.prepare(sql).get(...a).n;

// --- prefillRemap (pure) -----------------------------------------------------------------

const LIB = [
  { id: 'L1', field_name: 'buyer_name', field_label: 'Buyer: name' },
  { id: 'L2', field_name: 'pup_price', field_label: 'Pup: price' },
  { id: 'L3', field_name: 'pup_name', field_label: 'Pup: name' },
];
const HER = [
  { id: 'H1', field_name: 'buyer_name', field_label: 'Buyer: name' },
  { id: 'H2', field_name: 'pup_price', field_label: 'Pup: price' },
  { id: 'H9', field_name: 'buyer_name', field_label: 'Buyer: name' }, // a later copy of a name
];
const field = (id, key, extra = {}) => ({ id, type: 'text', format_rules: { prefilledData: key, fontSize: 12 }, ...extra });

test('prefillRemap points each library prefill at her field of the same name, in the same form', () => {
  const { changes, missing, unmapped } = prefillRemap([
    field('f1', 'custom_workspace_L1', { variable_name: 'custom_workspace_L1' }),
    field('f2', 'L2'), // the bare id
    field('f3', 'email'), // Firma's recipient key: the same everywhere
    field('f4', 'buyer_name'), // a plain fact name: fills anywhere
    field('f5', 'custom_workspace_H1'), // already hers
    field('f6', 'custom_workspace_H9'), // her later copy: pointed at the one kept
    field('f7', 'custom_workspace_nobody'),
    { id: 'f8', type: 'signature' },
  ], LIB, HER);
  assert.deepEqual(changes, [
    { id: 'f1', format_rules: { prefilledData: 'custom_workspace_H1', fontSize: 12 }, variable_name: 'custom_workspace_H1' },
    { id: 'f2', format_rules: { prefilledData: 'H2', fontSize: 12 } },
    { id: 'f6', format_rules: { prefilledData: 'custom_workspace_H1', fontSize: 12 } },
  ]);
  assert.deepEqual(missing, []);
  assert.equal(unmapped, 1);
});

test('prefillRemap lists the fields she lacks, once each, and the same workspace needs nothing', () => {
  const r = prefillRemap([field('f1', 'custom_workspace_L3'), field('f2', 'L3')], LIB, HER);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.missing, [{ field_name: 'pup_name', field_label: 'Pup: name' }]);
  const same = prefillRemap([field('f1', 'custom_workspace_L1'), field('f2', 'custom_workspace_L3')], LIB, LIB);
  assert.deepEqual(same.changes, []);
  assert.deepEqual(same.missing, []);
});

// --- A fake Firma ------------------------------------------------------------------------

let fake;
let realFetch;
function makeFake() {
  const f = { calls: [], workspaces: new Map(), fields: new Map(), templates: new Map(), nextWs: 1, nextTpl: 1, patchStatus: null, copyStatus: null };
  f.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace('/functions/v1/signing-request-api', '');
    const method = init.method || 'GET';
    const auth = (init.headers?.authorization || '').replace(/^Bearer /, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    f.calls.push({ method, path, auth, body });
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    let m;
    if (method === 'POST' && path === '/workspaces' && auth === MASTER) {
      const id = `ws_${f.nextWs++}`;
      const w = { id, name: body.name, api_key: `live_${id}`, webhook_enabled: false };
      f.workspaces.set(id, w);
      f.fields.set(id, []);
      return reply(201, w);
    }
    if ((m = /^\/workspaces\/([^/]+)$/.exec(path)) && auth === MASTER) {
      const w = f.workspaces.get(m[1]);
      if (method === 'PATCH') { w.webhook_enabled = true; return reply(200, w); }
      return reply(200, { ...w, webhook_secret: 's'.repeat(64) });
    }
    if (method === 'POST' && path === '/webhooks' && auth === MASTER) return reply(201, { id: `wh_${f.nextWs}` });
    if (method === 'POST' && (m = /^\/templates\/([^/]+)\/copy$/.exec(path))) {
      if (auth !== MASTER) return reply(403, { code: 'FORBIDDEN' });
      if (f.copyStatus) return reply(f.copyStatus, {});
      const src = f.templates.get(m[1]);
      if (!src || !f.workspaces.has(body.workspace_id)) return reply(404, { code: 'NOT_FOUND' });
      const id = `tpl_${f.nextTpl++}`;
      // Deep copy: the fields keep their prefills as they were (the library's ids).
      f.templates.set(id, { id, name: body.name ?? `${src.name} (copy)`, ws: body.workspace_id, fields: src.fields.map((x, i) => ({ ...structuredClone(x), id: `${id}_f${i}` })) });
      return reply(201, { id, name: f.templates.get(id).name, workspace_id: body.workspace_id, created_date: iso(), seal_participants: [] });
    }
    const ws = [...f.workspaces.values()].find((w) => w.api_key === auth);
    if (!ws) return reply(401, { code: 'UNAUTHORIZED' });
    if ((m = /^\/workspace\/([^/]+)\/custom-fields$/.exec(path))) {
      if (m[1] !== ws.id) return reply(403, {});
      const list = f.fields.get(ws.id);
      if (method === 'GET') {
        const size = Number(u.searchParams.get('page_size')) || 20;
        const page = Number(u.searchParams.get('page')) || 1;
        return reply(200, { results: list.slice((page - 1) * size, page * size) });
      }
      list.push({ id: `${ws.id}_cf${list.length}`, field_name: body.field_name, field_label: body.field_label });
      return reply(201, list[list.length - 1]);
    }
    if (method === 'GET' && path === '/templates') return reply(200, { results: [...f.templates.values()].filter((t) => t.ws === ws.id).map(({ fields: _f, ...t }) => ({ ...t, page_count: 3 })) });
    if ((m = /^\/templates\/([^/]+)\/fields$/.exec(path))) {
      const t = f.templates.get(m[1]);
      return t && t.ws === ws.id ? reply(200, { results: t.fields }) : reply(404, {});
    }
    if ((m = /^\/templates\/([^/]+)$/.exec(path))) {
      const t = f.templates.get(m[1]);
      if (!t || t.ws !== ws.id) return reply(404, { code: 'NOT_FOUND' });
      if (method === 'GET') return reply(200, { id: t.id, name: t.name, page_count: 3 });
      if (method === 'DELETE') { f.templates.delete(t.id); return reply(200, {}); }
      if (method === 'PATCH') {
        if (f.patchStatus) return reply(f.patchStatus, { code: 'VALIDATION_ERROR' });
        const x = t.fields.find((y) => y.id === body.field.id);
        if (!x) return reply(404, {});
        Object.assign(x, body.field);
        return reply(200, { field: x });
      }
    }
    return reply(404, { code: 'NOT_FOUND' });
  };
  return f;
}

beforeEach(() => { fake = makeFake(); realFetch = globalThis.fetch; globalThis.fetch = fake.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

const envWith = () => makeEnv({ INT_TOKEN_KEY: 'test-int-token-key', FIRMA_API_KEY: MASTER });

function makePro(env, session) {
  const { email_hash: eh } = env.DB.raw.prepare('SELECT u.email_hash FROM users u JOIN programs p ON p.owner_user_id = u.id WHERE p.id = ?').get(session.programId);
  env.DB.raw.prepare(`INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
     VALUES (?, ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`).run(`order:${session.programId}`, eh, iso(), iso());
}

// A Pro account with e-signing set up, and its workspace's fact fields.
async function breeder(env, email, fieldNames = ['buyer_name', 'pup_price', 'pup_name']) {
  const s = await signIn(env, email, { deviceId: `dev-${email}` });
  makePro(env, s);
  const r = await call(env, 'POST', '/integrations/firma/connect', { token: s.token, body: { kennelName: email } });
  assert.equal(r.status, 200, await r.clone().text());
  const fields = await call(env, 'POST', '/integrations/firma/fields', { token: s.token, body: { fields: fieldNames.map((n) => ({ name: n, label: n })) } });
  assert.equal(fields.status, 200);
  s.ws = [...fake.workspaces.values()].at(-1).id;
  return s;
}

const mreq = (path, init = {}) => new Request(`https://api.example${path}`, init);
async function manager(env, path, body) {
  const login = await worker.fetch(mreq('/manager/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: env.OPS_TOKEN }) }), env);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const init = body === undefined ? { headers: { Cookie: cookie } }
    : { method: 'POST', headers: { Cookie: cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await worker.fetch(mreq(`/manager/api/${path}`, init), env);
  return { status: res.status, body: await res.json() };
}

// A template in the library workspace, its fields prefilled from the library's own fields.
function libraryTemplate(libWs, name = 'Puppy sale contract', n = null) {
  const rows = fake.fields.get(libWs);
  const id = `tpl_${fake.nextTpl++}`;
  const fields = n == null
    ? [
      { id: 'a', type: 'text', format_rules: { prefilledData: `custom_workspace_${rows.find((r) => r.field_name === 'buyer_name').id}` } },
      { id: 'b', type: 'text', format_rules: { prefilledData: `custom_workspace_${rows.find((r) => r.field_name === 'pup_name').id}` } },
      { id: 'c', type: 'text', format_rules: { prefilledData: 'email' } },
      { id: 'd', type: 'signature' },
    ]
    : Array.from({ length: n }, (_, i) => ({ id: `x${i}`, type: 'text', format_rules: { prefilledData: `custom_workspace_${rows[0].id}` } }));
  fake.templates.set(id, { id, name, ws: libWs, fields });
  return id;
}

async function setUp(env) {
  const lib = await breeder(env, 'owner-test@example.com');
  const dana = await breeder(env, 'dana@example.com', ['buyer_name', 'pup_price']); // no pup_name yet
  const lee = await breeder(env, 'lee@example.com');
  assert.equal((await manager(env, 'library/link', { email: 'owner-test@example.com', label: 'My test account' })).status, 200);
  for (const [email, label] of [['dana@example.com', 'Dana at Blue Ridge'], ['lee@example.com', 'Lee']]) {
    assert.equal((await manager(env, 'library/breeder', { email, label })).status, 200);
  }
  return { lib, dana, lee };
}

const offered = async (env, s) => (await (await call(env, 'GET', '/integrations/firma/library', { token: s.token })).json()).templates;
const add = (env, s, templateId) => call(env, 'POST', '/integrations/firma/library/add', { token: s.token, body: { templateId } });

// --- The manager app ---------------------------------------------------------------------

test('linking the library needs an account with e-signing set up', async () => {
  const env = await envWith();
  assert.equal((await manager(env, 'library/link', { email: 'nobody@example.com' })).body.error, 'no_account');
  const s = await signIn(env, 'fresh@example.com', { deviceId: 'd1' });
  makePro(env, s);
  const r = await manager(env, 'library/link', { email: 'fresh@example.com' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'library_not_set_up');
  assert.equal((await manager(env, 'library')).body.linked, null);
});

test('support says who may add each template: no one, chosen breeders, or every breeder', async () => {
  const env = await envWith();
  const { lib, dana, lee } = await setUp(env);
  const tpl = libraryTemplate(lib.ws);
  let view = (await manager(env, 'library')).body;
  assert.deepEqual(view.linked, { programId: lib.programId, label: 'My test account', connected: true });
  assert.equal(view.templates.length, 1);
  assert.equal(view.templates[0].to, 'none');
  assert.deepEqual(view.breeders.map((b) => [b.label, b.esign]), [['Dana at Blue Ridge', true], ['Lee', true]]);
  assert.deepEqual(await offered(env, dana), []);

  // Chosen: Dana only. A program id support never named is dropped.
  view = (await manager(env, 'library/offer', { templateId: tpl, name: 'Puppy sale (KennelOS)', description: 'Pet home, limited registration', signs: 'last', to: 'chosen', programIds: [dana.programId, 'someone-else'] })).body;
  assert.deepEqual(view.templates[0].programIds, [dana.programId]);
  assert.equal(view.templates[0].signs, 'last');
  assert.deepEqual(await offered(env, dana), [{ id: tpl, name: 'Puppy sale (KennelOS)', description: 'Pet home, limited registration', signs: 'last', added: false }]);
  assert.deepEqual(await offered(env, lee), []);
  assert.equal((await add(env, lee, tpl)).status, 404);

  // Every breeder.
  await manager(env, 'library/offer', { templateId: tpl, name: 'Puppy sale (KennelOS)', to: 'all' });
  assert.equal((await offered(env, lee)).length, 1);
  // Withdrawn.
  await manager(env, 'library/offer', { templateId: tpl, to: 'none' });
  assert.deepEqual(await offered(env, dana), []);
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_library_access'), 0);
  // A template not in the library can't be offered.
  assert.equal((await manager(env, 'library/offer', { templateId: 'tpl_999', to: 'all' })).body.error, 'template_missing');
});

// --- Adding one ---------------------------------------------------------------------------

test('adding copies the template to her workspace and points its prefills at her fields', async () => {
  const env = await envWith();
  const { lib, dana } = await setUp(env);
  const tpl = libraryTemplate(lib.ws);
  await manager(env, 'library/offer', { templateId: tpl, name: 'Puppy sale (KennelOS)', signs: 'first', to: 'chosen', programIds: [dana.programId] });

  const r = await add(env, dana, tpl);
  assert.equal(r.status, 200, await r.clone().text());
  const out = await r.json();
  assert.equal(out.ready, true);
  assert.equal(out.unmapped, 0);
  assert.equal(out.signs, 'first');
  const copy = fake.templates.get(out.id);
  assert.equal(copy.ws, dana.ws);
  assert.equal(copy.name, 'Puppy sale (KennelOS)');
  // The copy was made with the company key, into her workspace.
  const copyCall = fake.calls.find((c) => c.path === `/templates/${tpl}/copy`);
  assert.equal(copyCall.auth, MASTER);
  assert.equal(copyCall.body.workspace_id, dana.ws);
  // pup_name was missing in hers: made, then used.
  const hers = fake.fields.get(dana.ws);
  const idOf = (name) => hers.find((x) => x.field_name === name).id;
  assert.deepEqual(copy.fields.map((x) => x.format_rules?.prefilledData ?? null),
    [`custom_workspace_${idOf('buyer_name')}`, `custom_workspace_${idOf('pup_name')}`, 'email', null]);
  // The library's own template is untouched.
  assert.match(fake.templates.get(tpl).fields[0].format_rules.prefilledData, new RegExp(`^custom_workspace_${lib.ws}_cf`));

  // It now shows as added; adding again answers the copy she has, with no new copy.
  assert.equal((await offered(env, dana))[0].added, true);
  const again = await (await add(env, dana, tpl)).json();
  assert.equal(again.id, out.id);
  assert.equal(again.already, true);
  assert.equal(fake.calls.filter((c) => c.path.endsWith('/copy')).length, 1);
  assert.equal((await manager(env, 'library')).body.templates.find((t) => t.id === tpl).copies, 1);

  // Deleted in her editor: the next add makes a new copy.
  fake.templates.delete(out.id);
  const fresh = await (await add(env, dana, tpl)).json();
  assert.notEqual(fresh.id, out.id);
  assert.equal(fresh.ready, true);
});

test('adding again for another kind makes one more copy beside hers, named for it', async () => {
  const env = await envWith();
  const { lib, dana } = await setUp(env);
  const tpl = libraryTemplate(lib.ws);
  await manager(env, 'library/offer', { templateId: tpl, name: 'Training agreement', signs: 'none', to: 'chosen', programIds: [dana.programId] });
  const first = await (await add(env, dana, tpl)).json();
  const again = (body) => call(env, 'POST', '/integrations/firma/library/add', { token: dana.token, body: { templateId: tpl, ...body } });
  const second = await (await again({ another: true, name: 'Training agreement (4-week training)' })).json();
  assert.notEqual(second.id, first.id);
  assert.equal(second.ready, true);
  assert.equal(second.already, false);
  assert.equal(fake.templates.get(second.id).name, 'Training agreement (4-week training)');
  assert.equal(fake.templates.get(second.id).ws, dana.ws);
  assert.equal(fake.templates.get(first.id).name, 'Training agreement', 'the first copy is untouched');
  assert.equal(fake.calls.filter((c) => c.path.endsWith('/copy')).length, 2);
  // A plain add still answers a copy she has, never a new one.
  assert.equal((await (await add(env, dana, tpl)).json()).already, true);
  assert.equal(fake.calls.filter((c) => c.path.endsWith('/copy')).length, 2);
  // Both prefills re-pointed at her fields, like the first.
  assert.deepEqual(fake.templates.get(second.id).fields.map((x) => x.format_rules?.prefilledData ?? null),
    fake.templates.get(first.id).fields.map((x) => x.format_rules?.prefilledData ?? null));
});

test('a long template is pointed over several calls, and a refused field is counted, not retried forever', async () => {
  const env = await envWith();
  const { lib, lee } = await setUp(env);
  const tpl = libraryTemplate(lib.ws, 'Long', 60);
  await manager(env, 'library/offer', { templateId: tpl, to: 'all' });
  const first = await (await add(env, lee, tpl)).json();
  assert.equal(first.ready, false);
  const second = await (await add(env, lee, tpl)).json();
  assert.equal(second.ready, true);
  assert.equal(second.id, first.id);
  assert.ok(fake.templates.get(first.id).fields.every((x) => x.format_rules.prefilledData.startsWith(`custom_workspace_${lee.ws}_`)));

  const short = libraryTemplate(lib.ws, 'Short');
  await manager(env, 'library/offer', { templateId: short, to: 'all' });
  fake.patchStatus = 400;
  const refused = await (await add(env, lee, short)).json();
  assert.equal(refused.ready, true);
  assert.equal(refused.unmapped, 2);
});

test('a copy Firma refused is forgotten; the library unlinked or its account deleted takes its offers', async () => {
  const env = await envWith();
  const { lib, dana } = await setUp(env);
  const tpl = libraryTemplate(lib.ws);
  await manager(env, 'library/offer', { templateId: tpl, to: 'all' });
  fake.copyStatus = 500;
  assert.equal((await add(env, dana, tpl)).status, 502);
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_library_copies'), 0);
  fake.copyStatus = null;
  assert.equal((await add(env, dana, tpl)).status, 200);

  // Dana's account deleted: her breeder entry and copy rows go.
  const danaUser = env.DB.raw.prepare('SELECT owner_user_id AS u FROM programs WHERE id = ?').get(dana.programId).u;
  await removeAccount(env, { userId: danaUser, programId: dana.programId });
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_library_breeders WHERE program_id = ?', dana.programId), 0);
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_library_copies'), 0);

  // The library's account deleted: the link and the offers go.
  const libUser = env.DB.raw.prepare('SELECT owner_user_id AS u FROM programs WHERE id = ?').get(lib.programId).u;
  await removeAccount(env, { userId: libUser, programId: lib.programId });
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM ops_config WHERE key LIKE 'esign_library%'"), 0);
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM esign_library_templates'), 0);
  assert.equal((await manager(env, 'library')).body.linked, null);
});
