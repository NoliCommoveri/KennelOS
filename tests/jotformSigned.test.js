// jotformSigned.test.js — Integrations plan step 7 (2026-10-12): a contract sent
// on one of her Jotform forms is marked Signed when her device finds the form's
// submission carrying the contract's reference. The pure parts (the form a
// contract went out on, its id, the reference field, a submission's reference),
// then end to end on the in-memory database with Jotform stubbed: the key on the
// device, a pasted form and a matched one, a contract she changed meanwhile.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { jotformFormId, refParam, formForContract, submissionRef, pendingByForm, signedEvent } from '../shared/data/jotformSigned.js';

const PASTED = { id: 'f1', form_type: 'pet_home', label: 'Pet home', url: 'https://form.jotform.com/241000000001', account_id: 'a1' };
const MATCHED = { id: 'f2', form_type: 'co_own', label: 'Co-own', url: 'https://form.jotform.com/241000000002', form_id: '241000000002', field_map: { contractRef: 'ref12', buyerEmail: 'email3' }, account_id: 'a1' };
const sub = (id, ref, created, name = 'contractRef') => ({ id, created_at: created, status: 'ACTIVE', answers: { 3: { name: 'email3', answer: 'b@x.com' }, 12: { name, answer: ref } } });

test('the form a contract went out on, its id and its reference field', () => {
  const c = { esign_url: 'https://form.jotform.com/241000000001?buyerName=Ann&contractRef=c1' };
  assert.equal(formForContract(c, [MATCHED, PASTED]), PASTED, 'matched by the link without its query');
  assert.equal(formForContract({ esign_url: 'https://example.com/x' }, [PASTED]), null);
  assert.equal(jotformFormId(PASTED), '241000000001', 'from the link');
  assert.equal(jotformFormId({ url: 'https://www.jotform.com/form/241000000009/' }), '241000000009');
  assert.equal(jotformFormId(MATCHED), '241000000002', 'the id Connect Jotform kept');
  assert.equal(refParam(PASTED), 'contractRef', 'a pasted form uses the fixed name');
  assert.equal(refParam(MATCHED), 'ref12', 'a matched form, her field');
  assert.equal(refParam({ ...MATCHED, field_map: { buyerEmail: 'email3' } }), '', 'matched with no reference field: nothing to find');
});

test('a submission\'s reference; only Sent Jotform contracts are looked for, per form', () => {
  assert.equal(submissionRef(sub('s1', 'c1', '2026-10-12 09:00:00'), 'contractRef'), 'c1');
  assert.equal(submissionRef(sub('s1', 'c1', '2026-10-12 09:00:00'), 'other'), '');
  const sent = (id, date, extra = {}) => ({ id, status: 'sent', esign_provider: 'jotform', esign_url: `${PASTED.url}?contractRef=${id}`, esign_sent_date: date, ...extra });
  const groups = pendingByForm([
    sent('c1', '2026-10-05'), sent('c2', '2026-10-01'),
    sent('c3', '2026-10-01', { status: 'signed' }), sent('c4', '2026-10-01', { esign_provider: 'link' }), sent('c5', '2026-10-01', { is_archived: true })
  ], [PASTED]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].contracts.map((c) => c.id), ['c1', 'c2']);
  assert.equal(groups[0].since, '2026-10-01', 'the earliest sent date');
  const ev = signedEvent({ id: 'c1' }, sub('s9', 'c1', '2026-10-12 09:00:00'));
  assert.equal(ev.id, 'jotform-s9');
  assert.equal(ev.kind, 'contract.signed');
  assert.deepEqual(ev.payload, { date: '2026-10-12', submissionId: 's9' }, 'nothing of the buyer\'s answers');
});

// --- End to end (in-memory db, Jotform stubbed) ------------------------------------

let jotform; let accountRepo; let contractRepo; let kennelRepo; let setJotformKey;
let calls; let submissionsByForm;
const realFetch = globalThis.fetch;

before(async () => {
  await installMemoryDb();
  jotform = await import('../shared/data/jotformSigned.js');
  ({ accountRepo } = await import('../shared/data/accountRepo.js'));
  ({ contractRepo } = await import('../shared/data/contractRepo.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ setJotformKey } = await import('../shared/data/jotformKeyStore.js'));
});

beforeEach(() => {
  calls = [];
  submissionsByForm = {};
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    calls.push(u);
    const m = u.pathname.match(/^\/form\/(\d+)\/submissions$/);
    if (m) return { ok: true, status: 200, json: async () => ({ responseCode: 200, content: submissionsByForm[m[1]] || [] }) };
    return { ok: false, status: 404, json: async () => ({ responseCode: 404, message: 'no' }) };
  };
  localStorage.clear();
});
afterEach(() => { globalThis.fetch = realFetch; });

async function setup({ connect = true } = {}) {
  const acct = await accountRepo.create({
    name: 'Jotform', account_type: 'form_service',
    contract_forms: [{ id: 'f1', form_type: 'pet_home', label: 'Pet home', url: PASTED.url }, { id: 'f2', form_type: 'co_own', label: 'Co-own', url: MATCHED.url, form_id: MATCHED.form_id, field_map: MATCHED.field_map }]
  });
  const k = await kennelRepo.create({ kennel_name: `Test ${Math.random()}`, is_own_kennel: true });
  if (connect) await setJotformKey(acct.id, { api_key: 'abcdefghijklmnop0123', region: 'us' });
  const mk = (url, extra = {}) => contractRepo.create({ kennel_id: k.id, title: 'Contract', contract_type: 'sale', status: 'sent', esign_provider: 'jotform', esign_url: url, esign_sent_date: '2026-10-05', ...extra });
  return { acct, mk };
}

test('a Sent contract whose form came back is marked Signed on the submission\'s date', async () => {
  const { mk } = await setup();
  const a = await mk(`${PASTED.url}?contractRef=x`);
  const b = await mk(`${MATCHED.url}?ref12=y`);
  const waiting = await mk(`${PASTED.url}?contractRef=z`);
  submissionsByForm['241000000001'] = [sub('s2', a.id, '2026-10-11 08:00:00'), sub('s1', a.id, '2026-10-10 20:00:00'), sub('s3', 'someone-else', '2026-10-11 09:00:00')];
  submissionsByForm['241000000002'] = [sub('s4', b.id, '2026-10-12 07:00:00', 'ref12')];

  const r = await jotform.checkJotformSignatures({ force: true });
  assert.deepEqual(r, { signed: 2, review: 0, skipped: 0, checked: 3, notConnected: 0 });
  const a2 = await contractRepo.getById(a.id);
  assert.equal(a2.status, 'signed');
  assert.equal(a2.signed_date, '2026-10-10', 'the first submission: when it was signed');
  assert.equal((await contractRepo.getById(b.id)).signed_date, '2026-10-12');
  assert.equal((await contractRepo.getById(waiting.id)).status, 'sent', 'no submission yet');

  const asked = calls.find((u) => u.pathname === '/form/241000000001/submissions');
  assert.equal(asked.searchParams.get('apiKey'), 'abcdefghijklmnop0123');
  assert.deepEqual(JSON.parse(asked.searchParams.get('filter')), { 'created_at:gt': '2026-10-04 00:00:00' }, 'from a day before the earliest sent');

  assert.equal(await jotform.checkJotformSignatures(), null, 'not due again within 15 minutes');
  const again = await jotform.checkJotformSignatures({ force: true });
  assert.equal(again.checked, 1, 'signed ones are no longer looked for');
});

test('a contract she changed since it was sent gets a review, not a write', async () => {
  const { mk } = await setup();
  const c = await mk(`${PASTED.url}?contractRef=x`);
  submissionsByForm['241000000001'] = [sub('s7', c.id, '2026-10-11 08:00:00')];
  // She edits it to Declined after the check listed it (the race the review covers).
  const { applyIntegrationEvent } = await import('../shared/data/integrationApply.js');
  await contractRepo.update(c.id, { status: 'declined' });
  const outcome = await applyIntegrationEvent(jotform.signedEvent(c, submissionsByForm['241000000001'][0]));
  assert.equal(outcome, 'review');
  const after = await contractRepo.getById(c.id);
  assert.equal(after.status, 'declined');
  assert.equal(after.integration_reviews[0].kind, 'contract.signed');
});

test('not connected on this device: nothing is asked, and it says so', async () => {
  const k = await kennelRepo.create({ kennel_name: `Test ${Math.random()}`, is_own_kennel: true });
  const url = 'https://form.jotform.com/241000000077';
  await accountRepo.create({ name: 'Other Jotform', account_type: 'form_service', contract_forms: [{ id: 'f9', form_type: 'pet_home', label: 'Pet home', url }] });
  const c = await contractRepo.create({ kennel_id: k.id, title: 'Contract', contract_type: 'sale', status: 'sent', esign_provider: 'jotform', esign_url: `${url}?contractRef=x`, esign_sent_date: '2026-10-05' });
  const r = await jotform.checkJotformSignatures({ force: true, contractIds: [c.id] });
  assert.equal(r.notConnected, 1);
  assert.equal(calls.length, 0);
});
