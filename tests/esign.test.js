// esign.test.js — e-sign through Firma on her device (Integrations plan §2.3a,
// step 8; D25–D26, D30–D31): her Firma templates as contract-form rows, what a
// send carries, the reviews an expired or cancelled request leaves, and end to
// end against the real Worker in-process with a fake Firma: set up, upload, type
// a template, send a contract, send again, and the signed contract back.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { installMemoryDb } from './support/memoryDb.js';
import { makeEnv, lastCode } from '../cloud/tests/helpers/env.js';
import { worker } from '../cloud/tests/helpers/worker.js';
import { cleanForms, isFirmaForm, allForms, PREFILL_FIELDS } from '../shared/data/contractForms.js';
import { mergeTemplates, withTemplateRow, firmaAccountOf, FIRMA_ACCOUNT } from '../shared/data/esignTemplates.js';
import { planIntegrationEvent, reviewTitle } from '../shared/data/integrationEvents.js';

const TID = 'tpl_1';

// --- Pure ----------------------------------------------------------------------------------

test('a Firma template is a contract-form row with its template id and no link', () => {
  const rows = cleanForms([
    { id: 'a', form_type: 'pet_home', label: 'Pet home', provider: 'firma', template_id: TID },
    { id: 'b', form_type: 'pet_home', label: 'No id', provider: 'firma' },
    { id: 'c', form_type: 'nope', provider: 'firma', template_id: TID },
    { id: 'd', form_type: 'deposit', label: 'Pasted', url: 'https://form.jotform.com/1' }
  ]);
  assert.deepEqual(rows.map((f) => f.id), ['a', 'd']);
  assert.deepEqual(rows[0], { id: 'a', form_type: 'pet_home', label: 'Pet home', provider: 'firma', template_id: TID });
  assert.equal(isFirmaForm(rows[0]), true);
  assert.equal(isFirmaForm(rows[1]), false);
  assert.equal(allForms([{ id: 'x', name: 'E-sign (Firma)', account_type: 'form_service', contract_forms: rows }]).length, 2);
});

test('templates: the type she gave each one, set and removed on the account', () => {
  let forms = withTemplateRow([], { templateId: TID, name: 'Pet home contract', formType: 'pet_home' });
  assert.equal(forms.length, 1);
  assert.equal(forms[0].label, 'Pet home contract');
  const id = forms[0].id;
  forms = withTemplateRow(forms, { templateId: TID, name: 'Pet home v2', formType: 'breeding_rights' });
  assert.deepEqual([forms.length, forms[0].id, forms[0].form_type], [1, id, 'breeding_rights'], 'the same row, retyped');
  const account = { id: 'acc', ...FIRMA_ACCOUNT, contract_forms: forms };
  assert.equal(firmaAccountOf([{ id: 'o', account_type: 'form_service', contract_forms: [] }, account]), account);
  assert.deepEqual(mergeTemplates([{ id: TID, name: 'Pet home v2', pageCount: 3 }, { id: 'tpl_2', name: 'New' }], [account]),
    [{ id: TID, name: 'Pet home v2', pageCount: 3, form_type: 'breeding_rights', label: 'Pet home v2' },
      { id: 'tpl_2', name: 'New', pageCount: null, form_type: '', label: '' }]);
  assert.deepEqual(withTemplateRow(forms, { templateId: TID, formType: '' }), [], 'not offered: removed');
});

test('an expired or cancelled request waits on Today while the contract is still Sent', () => {
  const ev = (kind) => ({ seq: 3, provider: 'firma', kind, recordType: 'contract', recordId: 'c', payload: { date: '2026-11-12' }, createdAt: '2026-11-12T10:00:00Z' });
  const expired = planIntegrationEvent(ev('contract.expired'), { status: 'sent' });
  assert.equal(expired.op, 'review');
  assert.match(expired.review.reason, /ran out/);
  assert.equal(planIntegrationEvent(ev('contract.cancelled'), { status: 'sent' }).op, 'review');
  assert.equal(planIntegrationEvent(ev('contract.expired'), { status: 'signed' }).op, 'skip', 'she moved on');
  assert.equal(reviewTitle({ provider: 'firma', kind: 'contract.expired' }), 'Firma says the contract\'s signing link expired');
  assert.equal(reviewTitle({ provider: 'firma', kind: 'contract.cancelled' }), 'Firma says the contract\'s signing request was cancelled');
});

// --- End to end ------------------------------------------------------------------------------

const FIRMA = 'https://api.firma.dev/functions/v1/signing-request-api';
const MASTER = 'firma_master';
const SECRET = 's'.repeat(64);
let env; let fake; let api; let auth; let esign; let ci; let send;
let kennelRepo; let contactRepo; let dogRepo; let saleRepo; let contractRepo; let accountRepo; let esignTemplates;

function makeFake() {
  const f = { workspaces: new Map(), fields: [], templates: new Map(), sends: [], webhookUrl: null, fieldCalls: 0 };
  f.handle = async (url, init) => {
    const path = new URL(url).pathname.replace('/functions/v1/signing-request-api', '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    let m;
    if (method === 'POST' && path === '/workspaces') {
      const w = { id: 'ws_1', name: body.name, api_key: 'live_ws_1', test_api_key: 'test_ws_1' };
      f.workspaces.set(w.id, w);
      return reply(201, w);
    }
    if ((m = /^\/workspaces\/([^/]+)$/.exec(path))) return reply(200, { ...f.workspaces.get(m[1]), webhook_secret: SECRET });
    if (method === 'POST' && path === '/webhooks') { f.webhookUrl = body.url; return reply(201, { id: 'wh_1' }); }
    if (/^\/workspace\/[^/]+\/custom-fields$/.test(path)) {
      if (method === 'GET') { f.fieldCalls++; return reply(200, f.fields); }
      f.fields.push(body);
      return reply(201, body);
    }
    if (method === 'GET' && path === '/templates') return reply(200, { results: [...f.templates.values()] });
    if (method === 'POST' && path === '/templates') {
      const t = { id: `tpl_${f.templates.size + 1}`, name: body.name, page_count: 2 };
      f.templates.set(t.id, t);
      return reply(201, t);
    }
    if ((m = /^\/templates\/([^/]+)$/.exec(path))) return f.templates.has(m[1]) ? reply(200, f.templates.get(m[1])) : reply(404, {});
    if (method === 'POST' && path === '/generate-template-token') return reply(200, { token: 'jwt.for.editor', expires_at: '2026-11-13T00:00:00Z' });
    if (method === 'POST' && path === '/signing-requests/create-and-send') {
      const id = `sr_${f.sends.length + 1}`;
      f.sends.push(body);
      return reply(201, { id, first_signer: { signing_link: `https://app.firma.dev/signing/u_${id}` } });
    }
    if ((m = /^\/signing-requests\/([^/]+)\/download$/.exec(path))) return reply(200, { download_url: `https://files.firma.dev/${m[1]}.pdf`, expires_at: null, is_partial: false, status: 'completed' });
    return reply(404, { code: 'NOT_FOUND' });
  };
  return f;
}

async function workerFetch(url, init = {}) {
  if (String(url).startsWith(FIRMA)) return fake.handle(url, init);
  const headers = { ...(init.headers || {}), origin: 'http://localhost:8000' };
  if (typeof init.body === 'string') headers['content-length'] = String(new TextEncoder().encode(init.body).length);
  return worker.fetch(new Request(url, { method: init.method, headers, body: init.body, signal: init.signal }), env);
}

async function breeder() {
  const email = 'breeder@example.com';
  await auth.startSignIn(email);
  await auth.verifySignIn(email, lastCode(env), { deviceLabel: 'Phone' });
  const { email_hash: eh } = env.DB.raw.prepare('SELECT email_hash FROM users').get();
  env.DB.raw.prepare(`INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
    VALUES ('order:1', ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`).run(eh, new Date().toISOString(), new Date().toISOString());
  await api.takeOverBacking(auth.sessionToken());
}

// Firma's webhook, signed as Firma signs it.
async function firmaSays(type, signingRequestId) {
  const raw = JSON.stringify({ id: `evt_${type}`, type, created_at: '2026-11-14T09:00:00Z', data: { signing_request: { id: signingRequestId, completed_at: '2026-11-14T09:00:00Z' } } });
  const t = String(Math.floor(Date.now() / 1000));
  const v1 = createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex');
  const res = await worker.fetch(new Request(fake.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-firma-signature': `t=${t},v1=${v1}` }, body: raw }), env);
  assert.equal(res.status, 200);
}

before(async () => {
  await installMemoryDb();
  globalThis.location = { hostname: 'localhost' };
  globalThis.fetch = workerFetch;
  api = await import('../shared/data/cloud/cloudApi.js');
  auth = await import('../shared/data/cloud/cloudAuth.js');
  esign = await import('../shared/data/cloud/cloudEsign.js');
  ci = await import('../shared/data/cloud/cloudIntegrations.js');
  send = await import('../shared/data/contractSend.js');
  esignTemplates = await import('../shared/data/esignTemplates.js');
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ contractRepo } = await import('../shared/data/contractRepo.js'));
  ({ accountRepo } = await import('../shared/data/accountRepo.js'));
});

beforeEach(async () => {
  env = await makeEnv({ INT_TOKEN_KEY: 'k', FIRMA_API_KEY: MASTER });
  fake = makeFake();
  localStorage.clear();
  globalThis.location = { hostname: 'localhost' };
});

test('the facts go to Firma as custom fields, each once, in calls of at most 40', () => {
  const names = esign.factFields().map((f) => f.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(new Set(names), new Set(Object.values(PREFILL_FIELDS).flat().map(([k]) => k)));
  assert.ok(names.length > 40, 'more than one call');
});

test('signed out: nothing is offered and nothing is asked of the server', async () => {
  assert.equal(esign.esignSignedIn(), false);
  await assert.rejects(esign.esignStatus(), api.CloudAuthError);
  assert.equal(fake.workspaces.size, 0);
});

test('set up, upload and type a template, send a contract, and it comes back signed', async () => {
  await breeder();
  assert.equal(esign.esignSignedIn(), true);
  assert.deepEqual((await esign.esignStatus()).connected, false);

  // Set up: her workspace, named for her kennel, and the facts as its fields.
  const status = await esign.setUpEsign('Maple Labs');
  assert.equal(status.connected, true);
  assert.equal(fake.workspaces.get('ws_1').name, 'Maple Labs');
  assert.equal(fake.fields.length, esign.factFields().length);
  assert.ok(fake.fields.every((f) => /^[A-Za-z]\w*$/.test(f.field_name) && f.field_label));
  assert.equal(await esign.syncFactFields(), 0, 'repeating adds nothing');

  // Upload a PDF; say what kind of contract it is.
  const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], { type: 'application/pdf' });
  pdf.name = 'Pet home.pdf';
  await assert.rejects(esign.uploadTemplate({ name: 'x', file: new Blob(['hi'], { type: 'text/plain' }) }), /PDF/);
  const t = await esign.uploadTemplate({ name: 'Pet home contract', file: pdf });
  assert.deepEqual(t, { id: 'tpl_1', name: 'Pet home contract', pageCount: 2 });
  assert.equal(fake.templates.size, 1);
  await esignTemplates.setTemplateType({ templateId: t.id, name: t.name, formType: 'pet_home' });
  const accounts = await accountRepo.getAll();
  assert.equal(accounts.length, 1, 'the E-sign (Firma) account, made once');
  assert.equal(accounts[0].name, 'E-sign (Firma)');
  assert.deepEqual(esignTemplates.mergeTemplates(await esign.templates(), accounts).map((x) => x.form_type), ['pet_home']);

  // The editor: the Worker's sandboxed page, the token only in the fragment.
  const link = new URL(await esign.editorLink(t.id));
  assert.equal(link.pathname, '/esign/editor');
  assert.equal(link.search, '');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(link.hash.slice(1))), { t: 'jwt.for.editor', id: 'tpl_1' });

  // A contract offers the template beside her pasted forms.
  const k = await kennelRepo.create({ kennel_name: 'Maple Labs', is_own_kennel: true });
  const buyer = await contactRepo.create({ name: 'Ann Q. Buyer', email: 'ann@example.com' });
  const pup = await dogRepo.create({ call_name: 'Juniper', breed: 'Lab', sex: 'female', ownership_type: 'owned', status: 'puppy', kennel_id: k.id });
  const sale = await saleRepo.create({ dog_id: pup.id, buyer_contact_id: buyer.id, registration_type: 'limited', status: 'deposit_pending', price: 3000, deposit_amount: 500, kennel_id: k.id });
  const contract = await contractRepo.create({ contract_type: 'sale', related_sale_id: sale.id, kennel_id: k.id, status: 'draft', title: 'Pet home: Juniper' });
  const forms = await send.loadContractForms();
  const form = forms.find(isFirmaForm);
  assert.ok(form, 'offered while signed in');
  const facts = await send.gatherContractFacts(contract);

  // Send.
  const res = await esign.sendForEsign({ contract, form, facts, signer: buyer });
  assert.equal(fake.sends.length, 1);
  const sent = fake.sends[0];
  assert.equal(sent.template_id, 'tpl_1');
  assert.equal(sent.name, 'Pet home contract: Juniper');
  assert.deepEqual([sent.recipients[0].first_name, sent.recipients[0].last_name, sent.recipients[0].email], ['Ann Q.', 'Buyer', 'ann@example.com']);
  assert.equal(sent.recipients[0].custom_fields.puppyName, 'Juniper');
  assert.equal(sent.recipients[0].custom_fields.price, '3000.00');
  assert.equal(sent.settings.send_signing_email, true);
  assert.equal(res.contract.status, 'sent');
  assert.equal(res.contract.esign_provider, 'firma');
  assert.equal(res.contract.esign_ref, 'sr_1');
  assert.equal(res.contract.esign_url, 'https://app.firma.dev/signing/u_sr_1');
  assert.equal(res.contract.esign_form_label, 'Pet home contract');
  assert.equal(res.usage.used, 1);

  // Again: refused until she says so, then it counts again.
  const again = await esign.sendForEsign({ contract: res.contract, form, facts, signer: buyer }).catch((e) => e);
  assert.equal(esign.esignProblem(again).kind, 'already_sent');
  assert.equal(fake.sends.length, 1);
  const resent = await esign.sendForEsign({ contract: res.contract, form, facts, signer: buyer, emailSigner: false, resend: true });
  assert.equal(resent.contract.esign_ref, 'sr_2');
  assert.equal(fake.sends[1].settings.send_signing_email, false);
  assert.equal(resent.usage.used, 2);

  // Firma says it was signed: her device marks it.
  await firmaSays('signing_request.completed', 'sr_2');
  assert.deepEqual(await ci.syncIntegrationEvents(), { applied: 1, review: 0, skipped: 0 });
  const signed = await contractRepo.getById(contract.id);
  assert.equal(signed.status, 'signed');
  assert.equal(signed.signed_date, '2026-11-14');
  assert.equal((await esign.signedCopyLink('sr_2')).url, 'https://files.firma.dev/sr_2.pdf');
});

test('at the limit a send is refused with the reset date, and Firma is never called', async () => {
  await breeder();
  await esign.setUpEsign('Maple Labs');
  env.DB.raw.prepare("INSERT INTO ops_config (key, value, updated_at) VALUES ('esign_monthly_limit', '0', ?)").run(new Date().toISOString());
  const k = await kennelRepo.create({ kennel_name: 'Maple Labs', is_own_kennel: true });
  const contract = await contractRepo.create({ contract_type: 'other', status: 'draft', title: 'Other', kennel_id: k.id });
  const form = { id: 'f', form_type: 'other', label: 'Other', provider: 'firma', template_id: 'tpl_9' };
  const err = await esign.sendForEsign({ contract, form, facts: { contract }, signer: { name: 'Bo', email: 'bo@example.com' } }).catch((e) => e);
  const p = esign.esignProblem(err);
  assert.equal(p.kind, 'limit');
  assert.match(p.message, /resets on \d{4}-\d{2}-01/);
  assert.equal(fake.sends.length, 0);
  assert.equal((await contractRepo.getById(contract.id)).status, 'draft');
});
