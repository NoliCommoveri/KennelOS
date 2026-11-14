// esign.test.js — e-sign through Firma on her device (Integrations plan §2.3a,
// step 8; D25–D26, D30–D31): her Firma templates as contract-form rows, what a
// send carries, the reviews an expired or cancelled request leaves, and end to
// end against the real Worker in-process with a fake Firma: set up, upload, type
// a template, send a contract, send again, and the signed contract back; and her
// countersignature (D32).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { installMemoryDb } from './support/memoryDb.js';
import { makeEnv, lastCode } from '../cloud/tests/helpers/env.js';
import { worker } from '../cloud/tests/helpers/worker.js';
import { cleanForms, isFirmaForm, allForms, PREFILL_FIELDS } from '../shared/data/contractForms.js';
import { mergeTemplates, withTemplateRow, firmaAccountOf, FIRMA_ACCOUNT, signingKennel, signsOf, signsDefault } from '../shared/data/esignTemplates.js';
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
    [{ id: TID, name: 'Pet home v2', pageCount: 3, form_type: 'breeding_rights', label: 'Pet home v2', countersign: false, signs: 'none', keepCopy: false, extraListId: '' },
      { id: 'tpl_2', name: 'New', pageCount: null, form_type: '', label: '', countersign: false, signs: 'none', keepCopy: false, extraListId: '' }]);
  assert.deepEqual(withTemplateRow(forms, { templateId: TID, formType: '' }), [], 'not offered: removed');
});

test('countersign: kept on a Firma row, kept through a retype, and off unless true', () => {
  let forms = withTemplateRow([], { templateId: TID, name: 'Pet home', formType: 'pet_home', countersign: true });
  assert.equal(forms[0].countersign, true);
  forms = withTemplateRow(forms, { templateId: TID, name: 'Pet home', formType: 'breeding_rights' });
  assert.equal(forms[0].countersign, true, 'a retype keeps it');
  assert.equal(cleanForms(forms)[0].countersign, true);
  assert.equal(mergeTemplates([{ id: TID, name: 'Pet home' }], [{ id: 'a', account_type: 'form_service', contract_forms: forms }])[0].countersign, true);
  forms = withTemplateRow(forms, { templateId: TID, name: 'Pet home', formType: 'breeding_rights', countersign: false });
  assert.equal('countersign' in forms[0], false);
  assert.equal('countersign' in cleanForms([{ form_type: 'pet_home', provider: 'firma', template_id: TID, countersign: 'yes' }])[0], false);
  assert.equal(mergeTemplates([{ id: TID, name: 'x' }], [])[0].countersign, false);
});

test('who signs: one choice of three on the row (none, last, first), the older yes/no still read', () => {
  let forms = withTemplateRow([], { templateId: TID, name: 'Pet home', formType: 'pet_home', signs: 'first' });
  assert.deepEqual([forms[0].countersign, forms[0].countersign_first, signsOf(forms[0])], [true, true, 'first']);
  assert.equal(cleanForms(forms)[0].countersign_first, true);
  assert.equal(mergeTemplates([{ id: TID, name: 'Pet home' }], [{ id: 'a', account_type: 'form_service', contract_forms: forms }])[0].signs, 'first');
  forms = withTemplateRow(forms, { templateId: TID, name: 'Pet home', formType: 'breeding_rights' });
  assert.equal(signsOf(forms[0]), 'first', 'a retype keeps it');
  forms = withTemplateRow(forms, { templateId: TID, name: 'Pet home', formType: 'pet_home', countersign: true });
  assert.equal(signsOf(forms[0]), 'first', 'the older yes on a first-signing row keeps first');
  forms = withTemplateRow(forms, { templateId: TID, name: 'Pet home', formType: 'pet_home', signs: 'last' });
  assert.deepEqual([forms[0].countersign, 'countersign_first' in forms[0]], [true, false]);
  forms = withTemplateRow(forms, { templateId: TID, name: 'Pet home', formType: 'pet_home', signs: 'none' });
  assert.deepEqual(['countersign' in forms[0], 'countersign_first' in forms[0]], [false, false]);
  // First without countersign isn't a choice: read as buyer only.
  assert.equal('countersign_first' in cleanForms([{ form_type: 'pet_home', provider: 'firma', template_id: TID, countersign_first: true }])[0], false);
  // A row from before the choice (countersign only) is "I sign last".
  assert.equal(signsOf({ countersign: true }), 'last');
  // A new template starts with the last choice, else "I don't sign".
  assert.deepEqual([signsDefault(null), signsDefault({ esign_signs_default: 'first' }), signsDefault({ esign_signs_default: 'bogus' })], ['none', 'first', 'none']);
});

test('keep the copy: its own tick on the row, independent of countersign', () => {
  let forms = withTemplateRow([], { templateId: TID, name: 'Pet home', formType: 'pet_home', keepCopy: true });
  assert.deepEqual([forms[0].keep_copy, 'countersign' in forms[0]], [true, false]);
  forms = withTemplateRow(forms, { templateId: TID, name: 'Pet home', formType: 'pet_home', countersign: true });
  assert.deepEqual([forms[0].keep_copy, forms[0].countersign], [true, true], 'setting one keeps the other');
  assert.equal(cleanForms(forms)[0].keep_copy, true);
  assert.equal(mergeTemplates([{ id: TID, name: 'Pet home' }], [{ id: 'a', account_type: 'form_service', contract_forms: forms }])[0].keepCopy, true);
  forms = withTemplateRow(forms, { templateId: TID, name: 'Pet home', formType: 'pet_home', keepCopy: false });
  assert.deepEqual(['keep_copy' in forms[0], forms[0].countersign], [false, true]);
  assert.equal('keep_copy' in cleanForms([{ form_type: 'pet_home', provider: 'firma', template_id: TID, keep_copy: 1 }])[0], false);
});

test('set up names her own kennel, never a linked outside one listed first', () => {
  const kennels = [
    { id: 'ak', kennel_name: 'A-K Boston Terriers', is_own_kennel: false, public_id: 'kos1_x' },
    { id: 'old', kennel_name: 'Old Name', is_own_kennel: true, is_archived: true },
    { id: 'dd', kennel_name: "Dash'n Darlin's Boston Terriers", is_own_kennel: true },
    { id: 'two', kennel_name: 'Second Kennel', is_own_kennel: true }
  ];
  assert.equal(signingKennel(kennels).id, 'dd');
  assert.equal(signingKennel(kennels, { myId: 'two' }).id, 'two');
  assert.equal(signingKennel(kennels, { activeId: 'two', myId: 'dd' }).id, 'two', 'the kennel she is working in first');
  assert.equal(signingKennel(kennels, { activeId: 'ak' }).id, 'dd', 'an outside kennel never');
  assert.equal(signingKennel(kennels.slice(0, 2)), null);
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
  const f = { workspaces: new Map(), fields: [], templates: new Map(), gone: new Set(), drafts: new Map(), draftN: 0, sends: [], webhookUrl: null, fieldCalls: 0 };
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
    // Deleted (in Firma's editor) = 404; one the fake never made stands in as there.
    if ((m = /^\/templates\/([^/]+)$/.exec(path))) return f.gone.has(m[1]) ? reply(404, {}) : reply(200, f.templates.get(m[1]) || { id: m[1] });
    if (method === 'POST' && path === '/generate-template-token') return reply(200, { token: 'jwt.for.editor', expires_at: '2026-11-13T00:00:00Z' });
    if (method === 'POST' && path === '/signing-requests') { const id = `draft_${++f.draftN}`; f.drafts.set(id, body); return reply(201, { id, status: 'draft' }); }
    if (method === 'POST' && path === '/jwt/generate-signing-request') return reply(200, { jwt: 'jwt.for.preview', expires_at: null });
    if ((m = /^\/signing-requests\/(draft_\d+)$/.exec(path))) {
      if (!f.drafts.has(m[1])) return reply(404, {});
      if (method === 'GET') return reply(200, { id: m[1], status: 'draft' });
      f.drafts.delete(m[1]); return reply(200, {});
    }
    if (method === 'POST' && path === '/signing-requests/create-and-send') {
      if (f.refuseWith) return reply(400, { code: f.refuseWith, message: 'not for her eyes' });
      const id = `sr_${f.sends.length + 1}`;
      f.sends.push(body);
      return reply(201, { id, first_signer: { signing_link: `https://app.firma.dev/signing/u_${id}` } });
    }
    if ((m = /^\/signing-requests\/([^/]+)\/users$/.exec(path))) {
      const body = f.sends[Number(m[1].slice(3)) - 1];
      return reply(200, (body?.recipients || []).map((r) => ({ id: `u_${m[1]}_${r.order}`, designation: r.designation, order: r.order })));
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

test('each fact has its own grouped label in Firma\'s editor; only the first field is relabelled for now', async () => {
  const fields = esign.factFields();
  for (const f of fields) assert.match(f.label, /^[A-Z][\w ]* · \S/, `${f.name}: "${f.label}"`);
  assert.equal(new Set(fields.map((f) => f.label)).size, fields.length, 'no two facts look the same');
  assert.ok(fields.every((f) => f.label.length <= 100));
  const { FIRMA_LABELS } = await import('../shared/data/contractForms.js');
  assert.deepEqual(Object.keys(FIRMA_LABELS).sort(), fields.map((f) => f.name).sort(), 'no label for a fact that isn\'t one');
  assert.deepEqual(esign.RELABEL_FIELDS, ['buyerEmail']);
  assert.equal(fields.find((f) => f.name === 'buyerEmail').label, 'Buyer · Email');
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

test('she signs first: the first signer, the buyer\'s link on the contract, her link from Sign first', async () => {
  await breeder();
  await esign.setUpEsign('Maple Labs');
  const k = await kennelRepo.create({ kennel_name: 'Maple Labs', is_own_kennel: true });
  const buyer = await contactRepo.create({ name: 'Ann Buyer', email: 'ann@example.com' });
  const contract = await contractRepo.create({ contract_type: 'other', status: 'draft', title: 'Other', kennel_id: k.id });
  const form = { id: 'f', form_type: 'other', label: 'Co-own', provider: 'firma', template_id: 'tpl_9', countersign: true, countersign_first: true };
  const facts = { contract, kennel: k };
  assert.deepEqual(esign.countersignerFor(form, facts), { name: 'Maple Labs', email: 'breeder@example.com', first: true });

  const res = await esign.sendForEsign({ contract, form, facts, signer: buyer });
  assert.deepEqual([res.countersign, res.countersignFirst], [true, true]);
  assert.deepEqual(fake.sends[0].recipients.map((r) => [r.email, r.order]), [['breeder@example.com', 1], ['ann@example.com', 2]]);
  assert.deepEqual([res.contract.esign_countersign, res.contract.esign_countersign_first], [true, true]);
  assert.equal(res.contract.esign_url, 'https://app.firma.dev/signing/u_sr_1_2', 'the buyer\'s link, not hers');
  assert.deepEqual(await esign.countersignLink('sr_1'), { url: 'https://app.firma.dev/signing/u_sr_1_1' });
});

test('a new template remembers her last choice of who signs', async () => {
  await esignTemplates.setTemplateType({ templateId: 'tpl_a', name: 'A', formType: 'pet_home', signs: 'first' });
  let account = firmaAccountOf(await accountRepo.getAll());
  assert.equal(signsDefault(account), 'first');
  await esignTemplates.setTemplateType({ templateId: 'tpl_a', name: 'A', formType: 'pet_home', keepCopy: true });
  assert.equal(signsDefault(firmaAccountOf(await accountRepo.getAll())), 'first', 'another setting leaves it');
  await esignTemplates.setTemplateType({ templateId: 'tpl_a', name: 'A', formType: 'pet_home', signs: 'none' });
  account = firmaAccountOf(await accountRepo.getAll());
  assert.deepEqual([signsDefault(account), signsOf(account.contract_forms[0])], ['none', 'none']);
});

test('countersign: she is the second signer, as her account email, and signs from her own link', async () => {
  await breeder();
  await esign.setUpEsign('Maple Labs');
  const k = await kennelRepo.create({ kennel_name: 'Maple Labs', is_own_kennel: true });
  const buyer = await contactRepo.create({ name: 'Ann Buyer', email: 'ann@example.com' });
  const contract = await contractRepo.create({ contract_type: 'other', status: 'draft', title: 'Other', kennel_id: k.id });
  const form = { id: 'f', form_type: 'other', label: 'Co-own', provider: 'firma', template_id: 'tpl_9', countersign: true };
  const facts = { contract, kennel: k };

  assert.deepEqual(esign.countersignerFor(form, facts), { name: 'Maple Labs', email: 'breeder@example.com' });
  assert.equal(esign.countersignerFor({ ...form, countersign: undefined }, facts), null, 'not her template');
  assert.throws(() => esign.sendBody({ contract, form, facts, signer: buyer, account: { email: '' } }),
    (e) => e.code === 'countersigner_email_required' && /account's email/.test(esign.esignProblem(e).message));

  const res = await esign.sendForEsign({ contract, form, facts, signer: buyer });
  assert.equal(res.countersign, true);
  assert.deepEqual(fake.sends[0].recipients.map((r) => [r.email, r.order, r.first_name]),
    [['ann@example.com', 1, 'Ann'], ['breeder@example.com', 2, 'Maple Labs']]);
  assert.equal(res.contract.esign_countersign, true);
  assert.equal(res.contract.esign_url, 'https://app.firma.dev/signing/u_sr_1', 'the buyer\'s link on the contract, not hers');
  assert.equal(res.usage.used, 1, 'one e-sign contract');
  assert.deepEqual(await esign.countersignLink('sr_1'), { url: 'https://app.firma.dev/signing/u_sr_1_2' });

  // Her own email as the buyer's: refused before Firma.
  const c2 = await contractRepo.create({ contract_type: 'other', status: 'draft', title: 'Other 2', kennel_id: k.id });
  const err = await esign.sendForEsign({ contract: c2, form, facts: { contract: c2, kennel: k }, signer: { name: 'Me', email: 'breeder@example.com' } }).catch((e) => e);
  assert.equal(err.code, 'countersigner_is_signer');
  assert.equal(fake.sends.length, 1);

  // A template she doesn't countersign: no second signer, nothing to countersign.
  const plain = await esign.sendForEsign({ contract: c2, form: { ...form, countersign: undefined }, facts: { contract: c2, kennel: k }, signer: buyer });
  assert.equal(plain.contract.esign_countersign, false);
  assert.equal(fake.sends[1].recipients.length, 1);
  const none = await esign.countersignLink('sr_2').catch((e) => e);
  assert.equal(none.code, 'no_countersigner');

  // Signed comes once both have (Firma's completed), and the link is closed after.
  await firmaSays('signing_request.completed', 'sr_1');
  await ci.syncIntegrationEvents();
  assert.equal((await contractRepo.getById(contract.id)).status, 'signed');
  const closed = await esign.countersignLink('sr_1').catch((e) => e);
  assert.equal(esign.esignProblem(closed).message, 'This contract isn\'t out for signature any more, so there\'s nothing to countersign.');
});

test('keep the copy: a send from such a template asks the Worker to keep it, with her kennel\'s name', async () => {
  await breeder();
  await esign.setUpEsign('Maple Labs');
  const k = await kennelRepo.create({ kennel_name: 'Maple Labs', is_own_kennel: true });
  const contract = await contractRepo.create({ contract_type: 'other', status: 'draft', title: 'Other', kennel_id: k.id });
  const form = { id: 'f', form_type: 'other', label: 'Co-own', provider: 'firma', template_id: 'tpl_9', keep_copy: true };
  const body = esign.sendBody({ contract, form, facts: { contract, kennel: k }, signer: { name: 'Ann', email: 'ann@example.com' } });
  assert.deepEqual([body.keepCopy, body.kennelName, 'countersigner' in body], [true, 'Maple Labs', false]);
  assert.equal('keepCopy' in esign.sendBody({ contract, form: { ...form, keep_copy: undefined }, facts: { contract }, signer: { name: 'Ann', email: 'ann@example.com' } }), false);

  const res = await esign.sendForEsign({ contract, form, facts: { contract, kennel: k }, signer: { name: 'Ann', email: 'ann@example.com' } });
  assert.equal(res.keepCopy, true);
  const row = env.DB.raw.prepare('SELECT keep_copy, kennel_name FROM esign_sends').get();
  assert.deepEqual([row.keep_copy, row.kennel_name], [1, 'Maple Labs']);
});

test('a send Firma refuses says so, with Firma\'s reason, and leaves the contract as it was', async () => {
  await breeder();
  await esign.setUpEsign('Maple Labs');
  const k = await kennelRepo.create({ kennel_name: 'Maple Labs', is_own_kennel: true });
  const contract = await contractRepo.create({ contract_type: 'other', status: 'draft', title: 'Other', kennel_id: k.id });
  const form = { id: 'f', form_type: 'other', label: 'Other', provider: 'firma', template_id: 'tpl_9' };
  const signer = { name: 'Bo', email: 'bo@example.com' };
  fake.refuseWith = 'VALIDATION_ERROR';
  const err = await esign.sendForEsign({ contract, form, facts: { contract }, signer }).catch((e) => e);
  assert.equal(err.code, 'esign_refused', 'the Worker\'s code, not overwritten by Firma\'s');
  assert.equal(err.providerCode, 'VALIDATION_ERROR');
  assert.match(esign.esignProblem(err).message, /^Firma refused this \(Firma said VALIDATION_ERROR\)\. .*signature field for each signer/);
  fake.refuseWith = 'RECIPIENT_EMAIL_SUPPRESSED';
  const bounced = await esign.sendForEsign({ contract, form, facts: { contract }, signer }).catch((e) => e);
  assert.match(esign.esignProblem(bounced).message, /won't email that address/);
  assert.equal((await contractRepo.getById(contract.id)).status, 'draft');
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

test('a template deleted in Firma stops being offered, and a send of it is refused before it counts', async () => {
  // Pure: only the Firma rows missing from the live set go.
  const forms = [
    { id: 'a', form_type: 'pet_home', label: 'Kept', provider: 'firma', template_id: 'tpl_1' },
    { id: 'b', form_type: 'pet_home', label: 'Gone', provider: 'firma', template_id: 'tpl_2' },
    { id: 'c', form_type: 'deposit', label: 'Pasted', url: 'https://form.jotform.com/1' }
  ];
  assert.deepEqual(esignTemplates.withoutMissingTemplates(forms, new Set(['tpl_1'])).map((f) => f.id), ['a', 'c']);

  await breeder();
  await esign.setUpEsign('Maple Labs');
  const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], { type: 'application/pdf' });
  for (const name of ['Pet home', 'Breeding rights']) {
    const t = await esign.uploadTemplate({ name, file: pdf });
    await esignTemplates.setTemplateType({ templateId: t.id, name, formType: 'pet_home' });
  }
  const before = (await send.loadContractForms()).filter(isFirmaForm);
  assert.deepEqual(before.map((f) => f.template_id).sort(), ['tpl_1', 'tpl_2']);

  // Deleted in Firma's editor: the next send picker drops it, and forgets it.
  fake.templates.delete('tpl_2'); fake.gone.add('tpl_2');
  assert.deepEqual((await send.loadContractForms()).filter(isFirmaForm).map((f) => f.template_id), ['tpl_1']);
  assert.deepEqual(allForms(await accountRepo.getAll()).filter(isFirmaForm).map((f) => f.template_id), ['tpl_1'], 'forgotten on the account');

  // Firma's list unknown (offline): nothing is dropped.
  fake.templates.delete('tpl_1'); fake.gone.add('tpl_1');
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.equal((await send.loadContractForms()).filter(isFirmaForm).length, 1);
  globalThis.fetch = real;

  // The send of a gone one (a stale picker): refused by the Worker, nothing counted.
  const k = await kennelRepo.create({ kennel_name: 'Maple Labs', is_own_kennel: true });
  const buyer = await contactRepo.create({ name: 'Ann Buyer', email: 'ann@example.com' });
  const contract = await contractRepo.create({ contract_type: 'sale', status: 'draft', title: 'Pet home', kennel_id: k.id });
  const err = await esign.sendForEsign({ contract, form: before.find((f) => f.template_id === 'tpl_1'), facts: await send.gatherContractFacts(contract), signer: buyer }).catch((e) => e);
  assert.equal(esign.esignProblem(err).kind, 'template_missing');
  assert.equal(fake.sends.length, 0);
  assert.equal((await esign.esignStatus()).usage.used, 0);
  await esignTemplates.forgetTemplate('tpl_1');
  assert.equal(allForms(await accountRepo.getAll()).filter(isFirmaForm).length, 0);
});

test('her signature name: her kennel\'s setting, else her contact, else the kennel', () => {
  const kennel = { kennel_name: 'Maple Labs', esign_signer_name: 'Jane M. Doe' };
  const breeder = { name: 'Jane Doe' };
  const { kennelSignerName } = esignTemplates;
  assert.equal(kennelSignerName(kennel, breeder), 'Jane M. Doe');
  assert.equal(kennelSignerName({ kennel_name: 'Maple Labs' }, breeder), 'Jane Doe');
  assert.equal(kennelSignerName({ kennel_name: 'Maple Labs' }), 'Maple Labs');
  assert.deepEqual(esign.countersignerFor({ countersign: true }, { kennel, breeder }, { email: 'jane@example.com' }), { name: 'Jane M. Doe', email: 'jane@example.com' });
  // A template row carries no name of its own.
  const forms = withTemplateRow([], { templateId: TID, name: 'Co-own', formType: 'other', countersign: true });
  assert.deepEqual(Object.keys(cleanForms([{ ...forms[0], signer_name: 'J. Doe' }])[0]).sort(), ['countersign', 'form_type', 'id', 'label', 'provider', 'template_id']);
});

test('each of a sale\'s agreements goes out on its own contract record; a pickup can be set from the send', async () => {
  const { eventRepo } = await import('../shared/data/eventRepo.js');
  const { pickupToSet } = await import('../shared/data/contractAddOns.js');
  const k = await kennelRepo.create({ kennel_name: 'Maple Labs', is_own_kennel: true });
  const buyer = await contactRepo.create({ name: 'Ann Buyer', email: 'ann@example.com' });
  const pup = await dogRepo.create({ call_name: 'Biscuit', breed: 'Labrador Retriever', sex: 'male', status: 'puppy', ownership_type: 'owned', kennel_id: k.id });
  const sale = await saleRepo.create({ dog_id: pup.id, buyer_contact_id: buyer.id, kennel_id: k.id, status: 'deposit_paid', registration_type: 'limited', sale_date: '2026-11-01', price: 3000, deposit_amount: 500,
    transport_fee: 450, deferred_boarding_amount: 25, deferred_boarding_frequency: 'Day', deferred_boarding_duration_days: '5' });
  const forms = [
    { id: 'f1', form_type: 'pet_home', label: 'Pet home' },
    { id: 'f2', form_type: 'transport', label: 'Transport' },
    { id: 'f3', form_type: 'boarding', label: 'Boarding' }
  ];
  let main = await contractRepo.create({ contract_type: 'sale', status: 'draft', title: 'Sale', kennel_id: k.id, related_sale_id: sale.id });

  // Nothing has gone out on it yet: the form goes out on this record.
  assert.equal((await send.contractForForm(main, forms[0], forms)).id, main.id);
  main = await contractRepo.update(main.id, { status: 'sent', esign_form_label: 'Pet home' });
  assert.equal((await send.contractForForm(main, forms[0], forms)).id, main.id, 'the same agreement again: a re-send');

  // Another agreement: a record of its own, named for the form and the pup, reused until it's signed.
  const transport = await send.contractForForm(main, forms[1], forms);
  assert.notEqual(transport.id, main.id);
  assert.deepEqual([transport.title, transport.status, transport.related_sale_id, transport.kennel_id], ['Transport: Biscuit', 'draft', sale.id, k.id]);
  assert.equal((await send.contractForForm(main, forms[1], forms)).id, transport.id, 'the unsent draft is reused');
  await contractRepo.update(transport.id, { status: 'sent', esign_form_label: 'Transport' });
  assert.equal((await send.contractForForm(main, forms[1], forms)).id, transport.id, 'and once sent');
  assert.equal((await send.contractForForm(await contractRepo.getById(transport.id), forms[0], forms)).id, main.id, 'from the transport record, the main contract goes out on its own');
  await contractRepo.update(transport.id, { status: 'signed' });
  assert.notEqual((await send.contractForForm(main, forms[1], forms)).id, transport.id, 'a signed one is never sent over');
  assert.equal((await contractRepo.getBySale(sale.id)).length, 3);

  // A contract with no sale, or one whose sent form isn't among her forms any more, is used as is.
  const lease = await contractRepo.create({ contract_type: 'lease', status: 'sent', title: 'Lease', kennel_id: k.id, esign_form_label: 'Pet home' });
  assert.equal((await send.contractForForm(lease, forms[1], forms)).id, lease.id);
  const renamed = await contractRepo.update(main.id, { esign_form_label: 'Old name' });
  assert.equal((await send.contractForForm(renamed, forms[1], forms)).id, main.id);

  // The boarding agreement is dated by the pickup: none yet, so one is offered and logged.
  let facts = await send.gatherContractFacts(main);
  assert.equal(facts.addOns.pickupDate, '');
  assert.equal(typeof pickupToSet(forms[2], facts.addOns), 'string');
  await send.logPickup(sale, '2026-12-20');
  const events = await eventRepo.getForSubject('dog', pup.id);
  assert.deepEqual(events.map((e) => [e.event_type, e.event_date, e.related_contact_id]), [['placement', '2026-12-20', buyer.id]]);
  facts = await send.gatherContractFacts(main);
  assert.equal(pickupToSet(forms[2], facts.addOns), null);
  assert.equal(facts.pickupDate, '2026-12-20');
  assert.deepEqual(facts.priceTable, { depositDue: 500, otherPaid: 0, balanceDue: 2500 });
  // The payment schedule's fields, from the sale's statement (Payment Schedule plan §8.1):
  // no schedule, so one final payment, at the pickup just logged.
  const { prefillValues } = await import('../shared/data/contractForms.js');
  const v = Object.fromEntries(prefillValues('pet_home', facts));
  assert.deepEqual([v.totalCharges, v.paidToDate, v.payment1Amount, v.finalPaymentAmount, v.finalPaymentDue, v.balanceDue],
    ['3575.00', '500.00', undefined, '3075.00', '2026-12-20', '3075.00']);
});

test('sendDetails: what a send fills in, by its label in Firma\'s editor', () => {
  const form = { form_type: 'pet_home', label: 'Pet home contract' };
  const facts = { sale: { id: 's1', price: 2500 }, buyer: { name: 'Ann Lee', email: 'ann@example.com' }, puppy: { call_name: 'Biscuit' } };
  const d = esign.sendDetails(form, facts);
  const byName = Object.fromEntries(d.map((x) => [x.name, x]));
  assert.equal(byName.buyerName.value, 'Ann Lee');
  assert.equal(byName.puppyName.value, 'Biscuit');
  assert.ok(byName.buyerEmail.label.length > 0);
  assert.ok(!('buyerAddress' in byName), 'a blank detail isn\'t listed');
});

test('previewNotes: each empty prefilled field with why', () => {
  const form = { form_type: 'pet_home', label: 'Our puppy contract' };
  const facts = { sale: { id: 's1' }, buyer: { name: 'Ann Lee' } };
  const n = esign.previewNotes(form, facts, [
    { fact: 'buyerName', label: 'Buyer · Name', filled: true, sent: true, signer: 1 },
    { fact: 'buyerAddress', label: 'Buyer · Address', filled: false, sent: false, signer: 1 },
    { fact: 'studFee', label: 'Stud · Fee', filled: false, sent: false, signer: 1 },
    { fact: null, label: null, filled: false, sent: false, signer: 1 },
    { fact: 'buyerName', label: 'Buyer · Name (2)', filled: false, sent: true, signer: 1 }
  ]);
  assert.equal(n.total, 5);
  assert.equal(n.filled, 1);
  assert.deepEqual(n.empty.map((e) => e.label), ['Buyer · Address', 'Stud · Fee', 'A field', 'Buyer · Name (2)']);
  assert.match(n.empty[0].why, /^Blank on this contract: add it on the buyer's contact/);
  assert.match(n.empty[1].why, /doesn't fill this detail on a template marked "Pet home contract"/);
  assert.match(n.empty[2].why, /^Not one of KennelOS's details/);
  assert.match(n.empty[3].why, /Firma left it empty/);
  assert.equal(esign.previewNotes(form, facts, null), null, 'an older Worker sends no list');
});
