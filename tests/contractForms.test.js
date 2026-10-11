// contractForms.test.js — her contract forms and the prefilled "Send for
// signature" link (Integrations plan §2.1a): which links and rows are kept, which
// forms a contract is offered (best first), what each form type fills, and that
// nothing outside the allow-list (notes, terms, end reasons) gets into a link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formLink, formProvider, cleanForms, allForms, rankForms, prefillValues, prefillUrl,
  splitName, fieldGroupsFor, PREFILL_FIELDS, signatureMessage
} from '../shared/data/contractForms.js';
import { CONTRACT_FORM_TYPE, CONTRACT_TYPE } from '../shared/data/vocab.js';

const form = (id, form_type, label, url = `https://form.jotform.com/${id}`) => ({ id, form_type, label, url });

test('every form type serves real contract types', () => {
  const types = new Set(CONTRACT_TYPE.map((t) => t.value));
  for (const t of CONTRACT_FORM_TYPE) {
    assert.ok(t.contractTypes.length, t.value);
    for (const ct of t.contractTypes) assert.ok(types.has(ct), `${t.value} → ${ct}`);
  }
  // Every contract type has at least one form type to offer.
  for (const ct of types) assert.ok(CONTRACT_FORM_TYPE.some((t) => t.contractTypes.includes(ct)), ct);
});

test('only http(s) links count; the provider comes from the host', () => {
  assert.equal(formLink(' https://form.jotform.com/123 '), 'https://form.jotform.com/123');
  assert.equal(formLink('javascript:alert(1)'), '');
  assert.equal(formLink('form.jotform.com/123'), '');
  assert.equal(formLink(''), '');
  assert.equal(formProvider('https://form.jotform.com/123'), 'jotform');
  assert.equal(formProvider('https://eu.jotform.com/123'), 'jotform');
  assert.equal(formProvider('https://www.jotform.com/form/123'), 'jotform');
  assert.equal(formProvider('https://notjotform.com/123'), 'link');
  assert.equal(formProvider('https://docs.google.com/forms/x'), 'link');
});

test('cleanForms keeps known types with a usable link, and labels a blank one', () => {
  const out = cleanForms([
    form('a', 'pet_home', '  In state  '),
    form('b', 'nonsense', 'x'),
    form('c', 'stud_service', 'Stud', 'ftp://x'),
    { id: 'd', form_type: 'co_own', label: '', url: 'https://form.jotform.com/d' },
    null
  ]);
  assert.deepEqual(out.map((f) => [f.id, f.label]), [['a', 'In state'], ['d', 'Co-ownership contract']]);
  assert.deepEqual(cleanForms(undefined), [], 'an older backup has no contract_forms');
  assert.ok(cleanForms([{ form_type: 'other', url: 'https://x.test/f' }])[0].id, 'a row without an id gets one');
});

test('allForms skips archived accounts and names the account', () => {
  const out = allForms([
    { id: 'j', name: 'Jotform', contract_forms: [form('a', 'pet_home', 'Pet')] },
    { id: 'old', name: 'Old', is_archived: true, contract_forms: [form('b', 'pet_home', 'Old pet')] },
    { id: 'n', name: 'No forms' }
  ]);
  assert.deepEqual(out.map((f) => [f.id, f.account_id, f.account_name]), [['a', 'j', 'Jotform']]);
});

test('rankForms offers the forms for this contract type, best fit for the sale first', () => {
  const forms = [
    form('stud', 'stud_service', 'Stud'),
    form('br', 'breeding_rights', 'Breeding rights'),
    form('pet2', 'pet_home', 'Pet home – out of state'),
    form('pet1', 'pet_home', 'Pet home – in state'),
    form('dep', 'deposit', 'Deposit'),
    form('co', 'co_own', 'Co-own')
  ];
  const sale = { contract_type: 'sale' };
  let r = rankForms(forms, sale, { registration_type: 'limited', status: 'paid_in_full' });
  assert.deepEqual(r.matching.map((f) => f.id), ['pet1', 'pet2', 'br', 'dep', 'co']);
  assert.deepEqual(r.others.map((f) => f.id), ['stud']);
  r = rankForms(forms, sale, { registration_type: 'full', status: 'deposit_paid' });
  assert.equal(r.matching[0].id, 'br');
  r = rankForms(forms, sale, { registration_type: 'full', status: 'deposit_pending' });
  assert.deepEqual(r.matching.slice(0, 2).map((f) => f.id), ['br', 'dep']);
  r = rankForms(forms, sale, { registration_type: 'co_own', status: 'delivered' });
  assert.equal(r.matching[0].id, 'co');
  r = rankForms(forms, { contract_type: 'stud_service' });
  assert.deepEqual(r.matching.map((f) => f.id), ['stud']);
  r = rankForms(forms, { contract_type: 'lease' });
  assert.equal(r.matching.length, 0, 'no lease form: the page shows all of them');
  assert.equal(r.others.length, forms.length);
});

const kennel = { kennel_name: 'Thornfield', location: 'Asheville, NC', website: '' };
const buyer = { name: 'Jane Q. Smith', email: 'jane@example.com', phone: '555-0100', address: '1 Elm St', notes: 'SECRET NOTE' };
const puppy = { id: 'p', call_name: 'Bella', registered_name: 'Thornfield Bella', sex: 'female', color_markings: 'Red', date_of_birth: '2026-06-01', microchip_id: '985000', breed: 'Golden Retriever', notes: 'SECRET NOTE' };
const saleFacts = {
  contract: { id: 'c1', contract_type: 'sale', title: '', terms_summary: 'SECRET TERMS', notes: 'SECRET NOTE' },
  kennel, today: '2026-10-11',
  sale: { id: 's1', registration_type: 'limited', price: 3000, deposit_amount: 500, notes: 'SECRET NOTE', end_reason: 'SECRET' },
  buyer, puppy, balanceDue: 2500,
  sire: { call_name: 'Duke', registered_name: 'CH Duke' }, dam: { call_name: 'Rose' }
};

test('a sale form fills the buyer, the pup and the money', () => {
  const v = Object.fromEntries(prefillValues('pet_home', saleFacts));
  assert.equal(v.contractRef, 'c1');
  assert.equal(v.saleRef, 's1');
  assert.equal(v.contractTitle, 'Sale');
  assert.equal(v.kennelName, 'Thornfield');
  assert.ok(!('kennelWebsite' in v), 'empty values are left out');
  assert.equal(v.buyerName, 'Jane Q. Smith');
  assert.equal(v.buyerFirstName, 'Jane Q.');
  assert.equal(v.buyerLastName, 'Smith');
  assert.equal(v.buyerEmail, 'jane@example.com');
  assert.equal(v.puppyName, 'Bella');
  assert.equal(v.puppySex, 'Female');
  assert.equal(v.sireName, 'CH Duke');
  assert.equal(v.damName, 'Rose');
  assert.equal(v.registrationType, 'Limited');
  assert.equal(v.price, '3000.00');
  assert.equal(v.depositAmount, '500.00');
  assert.equal(v.balanceDue, '2500.00');
});

test('nothing outside the allow-list gets into a link', () => {
  const allowed = new Set(Object.values(PREFILL_FIELDS).flat().map(([k]) => k));
  for (const t of CONTRACT_FORM_TYPE) {
    for (const [k, v] of prefillValues(t.value, saleFacts)) {
      assert.ok(allowed.has(k), `${t.value}: ${k} not in PREFILL_FIELDS`);
      assert.ok(!/SECRET/.test(v), `${t.value}: ${k} leaked a private value`);
    }
  }
});

test('a stud form names the stud and dam by direction, and the other party', () => {
  const studFacts = (direction) => ({
    contract: { id: 'c2', contract_type: 'stud_service' }, kennel, today: '2026-10-11',
    studService: { id: 'ss', direction, fee_amount: 1500, type: 'ai' },
    studDog: direction === 'outgoing' ? { call_name: 'Duke' } : { call_name: 'Max' },
    studDam: direction === 'outgoing' ? { call_name: 'Lady' } : { call_name: 'Rose' },
    partner: { name: 'Bo Jones', email: 'bo@example.com' }
  });
  const v = Object.fromEntries(prefillValues('stud_service', studFacts('outgoing')));
  assert.equal(v.studName, 'Duke');
  assert.equal(v.damName, 'Lady');
  assert.equal(v.partnerFirstName, 'Bo');
  assert.equal(v.studFee, '1500.00');
  assert.equal(v.serviceType, 'AI / shipped');
  assert.equal(v.studServiceRef, 'ss');
  assert.ok(!('buyerName' in v));
});

test('a lease form fills the dog, the other party and the lease dates', () => {
  const v = Object.fromEntries(prefillValues('lease', {
    contract: { id: 'c3', contract_type: 'lease', lease_start_date: '2026-11-01', lease_end_date: '2027-11-01' },
    kennel, dog: { call_name: 'Juno', sex: 'female', breed: 'Boxer' }, partner: { name: 'Ann Lee' }
  }));
  assert.equal(v.dogName, 'Juno');
  assert.equal(v.dogSex, 'Female');
  assert.equal(v.breed, 'Boxer');
  assert.equal(v.partnerName, 'Ann Lee');
  assert.equal(v.leaseStart, '2026-11-01');
  assert.equal(v.leaseEnd, '2027-11-01');
});

test('a co-own sale names its buyer, not a second party', () => {
  assert.deepEqual(fieldGroupsFor('co_own'), ['sale', 'dog']);
  const keys = prefillValues('co_own', saleFacts).map(([k]) => k);
  assert.ok(keys.includes('buyerName'));
  assert.ok(!keys.includes('partnerName'));
});

test('prefillUrl adds the values and keeps what the link already had', () => {
  const url = prefillUrl('https://form.jotform.com/123?theme=dark&buyerName=old', [['buyerName', 'Jane & Co'], ['price', '3000.00']]);
  const u = new URL(url);
  assert.equal(u.searchParams.get('theme'), 'dark');
  assert.equal(u.searchParams.get('buyerName'), 'Jane & Co');
  assert.equal(u.searchParams.get('price'), '3000.00');
  assert.equal(u.searchParams.getAll('buyerName').length, 1);
});

test('names split on the last space; the message carries the link', () => {
  assert.deepEqual(splitName('  Jane   Smith '), ['Jane', 'Smith']);
  assert.deepEqual(splitName('Cher'), ['Cher', '']);
  assert.deepEqual(splitName(''), ['', '']);
  const m = signatureMessage({ who: 'Jane', kennelName: 'Thornfield', formLabel: 'Pet home contract', subject: 'Bella', link: 'https://x.test/f?a=1' });
  assert.match(m.subject, /Pet home contract for Bella/);
  assert.match(m.body, /^Hi Jane,/);
  assert.ok(m.body.includes('https://x.test/f?a=1'));
  assert.ok(m.body.endsWith('Thornfield'));
});
