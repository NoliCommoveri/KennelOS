// jotformConnect.test.js — Connect Jotform (Integrations plan §2.1b): field
// matching from a form's questions (pure), the field_map on a contract form and
// the link it makes, the API calls (fetch stubbed: the key as a query parameter,
// errors told apart), and the key kept on this device only (never in a backup).
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { formFields, suggestFieldMap, matchWarnings, factsFor, guessFormType } from '../shared/data/jotformMatch.js';
import { cleanForms, cleanFieldMap, mapValues } from '../shared/data/contractForms.js';
import { buildSignatureLink } from '../shared/data/contractSend.js';

// A pet home contract form, the shape GET /form/{id}/questions returns.
const QUESTIONS = {
  1: { qid: '1', order: '1', type: 'control_head', name: 'heading', text: 'Puppy Sales Contract' },
  2: { qid: '2', order: '2', type: 'control_fullname', name: 'buyersName', text: 'Buyer\'s Name' },
  3: { qid: '3', order: '3', type: 'control_email', name: 'email3', text: 'E-mail' },
  4: { qid: '4', order: '4', type: 'control_phone', name: 'phoneNumber', text: 'Phone Number' },
  5: { qid: '5', order: '5', type: 'control_address', name: 'address', text: 'Address' },
  6: { qid: '6', order: '6', type: 'control_textbox', name: 'puppysName', text: 'Puppy\'s Name' },
  7: { qid: '7', order: '7', type: 'control_textbox', name: 'typeA', text: 'Purchase Price' },
  8: { qid: '8', order: '8', type: 'control_textbox', name: 'typeA8', text: 'Deposit' },
  9: { qid: '9', order: '9', type: 'control_datetime', name: 'dateOf', text: 'Date of Birth' },
  10: { qid: '10', order: '10', type: 'control_textbox', name: 'contractRef', text: 'Ref' },
  11: { qid: '11', order: '11', type: 'control_signature', name: 'signature', text: 'Signature' },
  12: { qid: '12', order: '12', type: 'control_button', name: 'submit', text: 'Submit' }
};

test('formFields: fillable fields in order, Full Name and Address by their parts', () => {
  const fields = formFields(QUESTIONS);
  assert.deepEqual(fields.map((f) => f.param), [
    'buyersName[first]', 'buyersName[last]', 'email3', 'phoneNumber', 'address[addr_line1]',
    'puppysName', 'typeA', 'typeA8', 'dateOf', 'contractRef'
  ]);
  assert.equal(fields[0].label, 'Buyer\'s Name (first)');
});

test('suggestFieldMap matches by type, label and our fixed names', () => {
  const { field_map, warnings } = suggestFieldMap('pet_home', QUESTIONS);
  assert.equal(field_map.buyerFirstName, 'buyersName[first]');
  assert.equal(field_map.buyerLastName, 'buyersName[last]');
  assert.equal(field_map.buyerEmail, 'email3');
  assert.equal(field_map.buyerPhone, 'phoneNumber');
  assert.equal(field_map.buyerAddress, 'address[addr_line1]');
  assert.equal(field_map.puppyName, 'puppysName');
  assert.equal(field_map.price, 'typeA');
  assert.equal(field_map.depositAmount, 'typeA8');
  assert.equal(field_map.puppyDob, 'dateOf');
  assert.equal(field_map.contractRef, 'contractRef', 'a field already named as ours');
  const used = Object.values(field_map);
  assert.equal(new Set(used).size, used.length, 'each of her fields fills one fact');
  assert.deepEqual(warnings, []);
});

test('matchWarnings: no signature, no email, no contract reference', () => {
  const bare = { 1: { type: 'control_textbox', name: 'x', text: 'Notes' } };
  const w = matchWarnings('pet_home', bare, {});
  assert.equal(w.length, 3);
  assert.match(w[0], /no signature/);
  assert.match(w[1], /buyer's email/);
  assert.match(matchWarnings('lease', bare, {})[1], /other party's email/);
});

test('factsFor: every-contract facts plus the type\'s groups, no repeats', () => {
  const facts = factsFor('co_own').map(([k]) => k);
  assert.ok(facts.includes('contractRef') && facts.includes('buyerEmail') && facts.includes('dogName'));
  assert.equal(new Set(facts).size, facts.length);
  assert.ok(!factsFor('stud_service').map(([k]) => k).includes('buyerEmail'));
});

test('guessFormType from a title', () => {
  assert.equal(guessFormType('Pet Home Contract 2026'), 'pet_home');
  assert.equal(guessFormType('Breeding Rights Agreement'), 'breeding_rights');
  assert.equal(guessFormType('Co-Ownership Contract'), 'co_own');
  assert.equal(guessFormType('Stud Service Contract'), 'stud_service');
  assert.equal(guessFormType('Puppy Reservation / Deposit'), 'deposit');
  assert.equal(guessFormType('Guardian Home'), 'foster');
  assert.equal(guessFormType('Contact us'), '');
});

test('cleanForms keeps a picked form\'s id and field map; cleanFieldMap drops the rest', () => {
  const [f] = cleanForms([{ id: 'a', form_type: 'pet_home', label: 'Pet', url: 'https://form.jotform.com/123',
    form_id: '123', field_map: { buyerEmail: 'email3', buyerFirstName: 'n[first]', nonsense: 'x', price: 'bad name!' } }]);
  assert.equal(f.form_id, '123');
  assert.deepEqual(f.field_map, { buyerEmail: 'email3', buyerFirstName: 'n[first]' });
  const [pasted] = cleanForms([{ form_type: 'pet_home', url: 'https://form.jotform.com/1', form_id: 'not-digits' }]);
  assert.ok(!('form_id' in pasted) && !('field_map' in pasted));
  assert.equal(cleanFieldMap(['x']), null);
  assert.deepEqual(cleanFieldMap({}), {});
});

test('mapValues: fixed names without a map; only matched facts, renamed, with one', () => {
  const values = [['contractRef', 'c1'], ['buyerEmail', 'a@b.c'], ['buyerAddress', '1 Main St']];
  assert.deepEqual(mapValues(values, null), values);
  assert.deepEqual(mapValues(values, { buyerEmail: 'email3', contractRef: 'ref' }), [['ref', 'c1'], ['email3', 'a@b.c']]);
  assert.deepEqual(mapValues(values, {}), []);
});

test('buildSignatureLink uses the form\'s field map', () => {
  const facts = { contract: { id: 'c1', contract_type: 'sale' }, sale: { id: 's1', price: 3000 }, buyer: { name: 'Ann Smith', email: 'ann@example.com' } };
  const form = { form_type: 'pet_home', url: 'https://form.jotform.com/123', field_map: { buyerFirstName: 'buyersName[first]', buyerLastName: 'buyersName[last]', price: 'typeA', contractRef: 'contractRef' } };
  const { url } = buildSignatureLink(form, facts);
  const q = new URL(url).searchParams;
  assert.equal(q.get('buyersName[first]'), 'Ann');
  assert.equal(q.get('buyersName[last]'), 'Smith');
  assert.equal(q.get('typeA'), '3000.00');
  assert.equal(q.get('contractRef'), 'c1');
  assert.equal(q.get('buyerEmail'), null, 'not matched, not sent');
});

// --- The API and the key on this device (in-memory db, fetch stubbed) -------------

let db; let api; let connect; let ie; let calls; let reply;
const realFetch = globalThis.fetch;

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  api = await import('../shared/data/jotformApi.js');
  connect = await import('../shared/data/jotformConnect.js');
  ie = await import('../shared/data/importExport.js');
});
beforeEach(() => {
  calls = [];
  reply = () => ({ status: 200, body: { responseCode: 200, message: 'success', content: {} } });
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: new URL(url), opts });
    const r = reply(new URL(url));
    if (r === 'network') throw new TypeError('Failed to fetch');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: '', json: async () => r.body };
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const KEY = 'abcdef0123456789abcdef0123456789';

test('calls go to the region\'s host with the key as a query parameter, no cookies', async () => {
  reply = () => ({ status: 200, body: { responseCode: 200, content: [
    { id: '1', title: 'Pet Home', url: 'https://form.jotform.com/1', status: 'ENABLED' },
    { id: '2', title: 'Old', url: 'https://form.jotform.com/2', status: 'DELETED' }
  ] } });
  const forms = await api.jotformForms({ api_key: KEY, region: 'eu' });
  assert.deepEqual(forms.map((f) => f.id), ['1']);
  assert.equal(calls[0].url.origin, 'https://eu-api.jotform.com');
  assert.equal(calls[0].url.pathname, '/user/forms');
  assert.equal(calls[0].url.searchParams.get('apiKey'), KEY);
  assert.equal(calls[0].opts.credentials, 'omit');
  assert.ok(!calls[0].opts.headers, 'no headers: a plain GET, no preflight');
});

test('errors: a refused key, an unreachable API, anything else', async () => {
  reply = () => ({ status: 401, body: { responseCode: 401, message: 'You\'re not authorized to use (/user)' } });
  await assert.rejects(api.jotformUser({ api_key: KEY }), (e) => e.kind === 'auth');
  reply = () => 'network';
  await assert.rejects(api.jotformUser({ api_key: KEY }), (e) => e.kind === 'network' && /Couldn't reach Jotform/.test(e.message));
  reply = () => ({ status: 500, body: { responseCode: 500, message: 'Oops' } });
  await assert.rejects(api.jotformUser({ api_key: KEY }), (e) => e.kind === 'other' && /Oops/.test(e.message));
});

test('connect checks the key, keeps it on this device only, and disconnect forgets it', async () => {
  await assert.rejects(connect.connectJotform('acc1', 'short'), /doesn't look like/);
  assert.equal(calls.length, 0, 'a malformed key never goes to Jotform');
  reply = () => ({ status: 200, body: { responseCode: 200, content: { username: 'thornfield' } } });
  assert.deepEqual(await connect.connectJotform('acc1', ` ${KEY} `, 'us'), { username: 'thornfield' });
  const c = await connect.jotformConnection('acc1');
  assert.equal(c.username, 'thornfield');
  assert.ok(!('api_key' in c), 'the key itself never leaves the store');
  assert.equal((await db.device_secrets.get('jotform:acc1')).api_key, KEY);

  const backup = await ie.exportAll();
  assert.ok(!('device_secrets' in (backup.collections || backup)), 'never in a backup');
  assert.ok(!JSON.stringify(backup).includes(KEY));

  await connect.disconnectJotform('acc1');
  assert.equal(await connect.jotformConnection('acc1'), null);
});

test('a refused key is not stored', async () => {
  reply = () => ({ status: 401, body: { responseCode: 401, message: 'no' } });
  await assert.rejects(connect.connectJotform('acc2', KEY), (e) => e.kind === 'auth');
  assert.equal(await connect.jotformConnection('acc2'), null);
});

test('matchJotformForm: a suggestion, or her saved map kept as it is', async () => {
  reply = (u) => (u.pathname === '/user'
    ? { status: 200, body: { responseCode: 200, content: { username: 'x' } } }
    : { status: 200, body: { responseCode: 200, content: QUESTIONS } });
  await connect.connectJotform('acc3', KEY);
  const m = await connect.matchJotformForm('acc3', '123', 'pet_home');
  assert.equal(calls.at(-1).url.pathname, '/form/123/questions');
  assert.equal(m.field_map.buyerEmail, 'email3');
  const kept = await connect.matchJotformForm('acc3', '123', 'pet_home', { buyerEmail: 'phoneNumber' });
  assert.deepEqual(kept.field_map, { buyerEmail: 'phoneNumber' });
  await connect.disconnectJotform('acc3');
  await assert.rejects(connect.listJotformForms('acc3'), /isn't connected/);
});
