// reservationContract.test.js — a Reservation contract (vocab CONTRACT_TYPE): a
// reservation agreement sent before there's a sale, with or without the waitlist.
// Its buyer, litter, preferred sex and color and deposit are picked on the Contract
// page and go to her form as prefilled facts, so the family only signs.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { reservationDeposit } from '../shared/data/saleDefaults.js';
import { prefillValues, fieldGroupsFor, rankForms } from '../shared/data/contractForms.js';

let db; let kennelRepo; let dogRepo; let contactRepo; let contractRepo; let litterRepo; let send;
let BUYER_LINK_TYPES; let CONTACT_LINK_TYPES; let referenceRegistry;

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ contractRepo, BUYER_LINK_TYPES, CONTACT_LINK_TYPES } = await import('../shared/data/contractRepo.js'));
  ({ litterRepo } = await import('../shared/data/litterRepo.js'));
  referenceRegistry = await import('../shared/data/referenceRegistry.js');
  send = await import('../shared/data/contractSend.js');
});

// --- Pure ------------------------------------------------------------------------------

test('the deposit fills in from the litter\'s expected deposit for the preferred sex', () => {
  const litter = { expected_deposit_male: 400, expected_deposit_female: 500 };
  assert.equal(reservationDeposit(litter, 'male'), 400);
  assert.equal(reservationDeposit(litter, 'female'), 500);
  assert.equal(reservationDeposit(litter, 'any'), null, 'Either, and the two differ: she types it');
  assert.equal(reservationDeposit({ expected_deposit_male: 400, expected_deposit_female: 400 }, 'any'), 400);
  assert.equal(reservationDeposit({ expected_deposit_female: '450' }, 'any'), 450, 'only one set: that one');
  assert.equal(reservationDeposit({ expected_deposit_male: '' }, 'male'), null);
  assert.equal(reservationDeposit(null, 'male'), null, 'next available litter: nothing to fill in');
});

test('a Deposit form fills the reservation group; a reservation fills it on any form', () => {
  assert.ok(fieldGroupsFor('deposit').includes('reservation'));
  assert.ok(!fieldGroupsFor('pet_home').includes('reservation'));
  const facts = {
    contract: { id: 'c1', contract_type: 'reservation', reservation_pref_sex: 'male', reservation_pref_color: 'Seal & white', reservation_deposit_amount: 400 },
    buyer: { name: 'Jordan Q. Lee', email: 'jordan@example.com' },
    sire: { call_name: 'Duke' }, dam: { call_name: 'Rosie', registered_name: 'Nine Acre Rosie' },
    reservation: { litterName: 'Rosie × Duke' }
  };
  for (const type of ['deposit', 'other']) {
    const v = Object.fromEntries(prefillValues(type, facts));
    assert.equal(v.litterName, 'Rosie × Duke', type);
    assert.equal(v.preferredSex, 'Male');
    assert.equal(v.preferredColor, 'Seal & white');
    assert.equal(v.reservationDeposit, '400.00');
    assert.equal(v.buyerFirstName, 'Jordan Q.');
    assert.equal(v.damName, 'Nine Acre Rosie');
    assert.equal(v.sireName, 'Duke');
    assert.equal(v.contractTitle, 'Reservation', 'no title: the type');
  }
  // 'any' reads as Either on the form.
  const either = Object.fromEntries(prefillValues('deposit', { ...facts, contract: { ...facts.contract, reservation_pref_sex: 'any' } }));
  assert.equal(either.preferredSex, 'Either');
  // A sale's Deposit form leaves the reservation details out.
  const onSale = Object.fromEntries(prefillValues('deposit', { contract: { id: 'c2', contract_type: 'sale' }, reservation: { litterName: 'X' } }));
  assert.equal(onSale.litterName, undefined);
});

test('a reservation is offered her Deposit forms first', () => {
  const forms = [
    { id: 'ph', form_type: 'pet_home', label: 'Pet home', url: 'https://form.jotform.com/1' },
    { id: 'dp', form_type: 'deposit', label: 'Reservation deposit', url: 'https://form.jotform.com/2' }
  ];
  const r = rankForms(forms, { contract_type: 'reservation' });
  assert.deepEqual(r.matching.map((f) => f.id), ['dp']);
});

test('a reservation\'s buyer isn\'t a partner', () => {
  assert.ok(BUYER_LINK_TYPES.includes('reservation'));
  assert.ok(!CONTACT_LINK_TYPES.includes('reservation'));
  assert.equal(contractRepo.isLivePartnerContract({ contract_type: 'reservation', related_contact_id: 'x', status: 'sent' }, '2026-11-16'), false);
});

test('its litter is a registered reference', () => {
  const refs = referenceRegistry.LITTER_REFERENCES.filter((r) => r.table === 'contracts');
  assert.deepEqual(refs.map((r) => r.field), ['reservation_litter_id']);
});

// --- On the in-memory database ---------------------------------------------------------

let K; let buyer; let litter;

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Nine Acre', location: 'Carriere, MS', is_own_kennel: true });
  const sire = await dogRepo.create({ call_name: 'Willis', sex: 'male', breed: 'Boston Terrier', ownership_type: 'owned', status: 'breeding', kennel_id: K.id });
  const dam = await dogRepo.create({ call_name: 'Fauna', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'breeding', kennel_id: K.id });
  litter = await litterRepo.create({ dam_id: dam.id, sire_id: sire.id, status: 'expected', kennel_id: K.id, expected_deposit_male: 400, expected_deposit_female: 400 });
  buyer = await contactRepo.create({ name: 'Cadence Moore', email: 'cadence@example.com', phone: '555-0101' });
});

test('saving keeps a reservation\'s details tidy and clears them off other types', async () => {
  const c = await contractRepo.create({
    contract_type: 'reservation', kennel_id: K.id, related_contact_id: buyer.id, related_sale_id: 'stray',
    reservation_litter_id: litter.id, reservation_pref_sex: 'nonsense', reservation_pref_color: '  Fawn ', reservation_deposit_amount: '400'
  });
  assert.equal(c.related_contact_id, buyer.id, 'the buyer stays');
  assert.equal(c.related_sale_id, null, 'a reservation has no sale');
  assert.equal(c.reservation_pref_sex, 'any');
  assert.equal(c.reservation_pref_color, 'Fawn');
  assert.equal(c.reservation_deposit_amount, 400);
  const blank = await contractRepo.update(c.id, { reservation_deposit_amount: '' });
  assert.equal(blank.reservation_deposit_amount, null);
  const other = await contractRepo.update(c.id, { contract_type: 'sale' });
  assert.equal(other.related_contact_id, null);
  assert.equal(other.reservation_litter_id, null);
  assert.equal(other.reservation_pref_sex, null);
});

test('sending a reservation fills in its buyer, litter, preferences and deposit', async () => {
  const c = await contractRepo.create({
    contract_type: 'reservation', kennel_id: K.id, related_contact_id: buyer.id, title: 'Reservation: Cadence',
    reservation_litter_id: litter.id, reservation_pref_sex: 'male', reservation_pref_color: 'Fawn', reservation_deposit_amount: 400
  });
  const facts = await send.gatherContractFacts(c);
  const form = { id: 'f1', form_type: 'deposit', label: 'Deposit agreement', url: 'https://form.jotform.com/1' };
  const q = new URL(send.buildSignatureLink(form, facts).url).searchParams;
  assert.equal(q.get('buyerName'), 'Cadence Moore');
  assert.equal(q.get('buyerEmail'), 'cadence@example.com');
  assert.equal(q.get('litterName'), 'Fauna × Willis');
  assert.equal(q.get('damName'), 'Fauna');
  assert.equal(q.get('preferredSex'), 'Male');
  assert.equal(q.get('preferredColor'), 'Fawn');
  assert.equal(q.get('reservationDeposit'), '400.00');
  assert.equal(facts.buyer.id, buyer.id, 'the signer is the buyer');
});

test('no litter picked: the next available litter', async () => {
  const c = await contractRepo.create({ contract_type: 'reservation', kennel_id: K.id, related_contact_id: buyer.id });
  const facts = await send.gatherContractFacts(c);
  const v = Object.fromEntries(prefillValues('deposit', facts));
  assert.equal(v.litterName, send.NEXT_AVAILABLE_LITTER);
  assert.equal(v.preferredSex, 'Either');
  assert.equal(v.reservationDeposit, undefined, 'no deposit set: left blank');
});
