// extraCharges.test.js — a sale's extra charges (guide §21.2): photo packages and
// a payment fee charged back, one invoice line each, paid with the balance; the
// kennel's price list; and the deposit fee charge-back offer.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { saleExtraCharges, extraChargesTotal, readExtraCharges, kennelChargeList, newExtraCharge, depositFeeChargeBack } from '../shared/data/extraCharges.js';

// --- The list (pure) -------------------------------------------------------------

test('a stored list keeps rows with a name and an amount above 0, to the cent', () => {
  const sale = { extra_charges: [
    { id: 'a', label: ' Gold photo package ', amount: '150' },
    { id: 'b', label: 'Video', amount: 75.555 },
    { id: 'c', label: '', amount: 20 },
    { id: 'd', label: 'Free thing', amount: 0 },
    null
  ] };
  assert.deepEqual(saleExtraCharges(sale), [
    { id: 'a', label: 'Gold photo package', amount: 150 },
    { id: 'b', label: 'Video', amount: 75.56 }
  ]);
  assert.equal(extraChargesTotal(sale), 225.56);
  assert.deepEqual(saleExtraCharges({}), [], 'no field, no charges');
  assert.deepEqual(saleExtraCharges({ extra_charges: 'junk' }), []);
});

test('a row without an id reads by its place, so line keys stay put between views', () => {
  const sale = { extra_charges: [{ label: 'Photos', amount: 100 }] };
  assert.equal(saleExtraCharges(sale)[0].id, saleExtraCharges(sale)[0].id);
});

test('a form row with only a name or only an amount is an error; blank rows drop', () => {
  assert.match(readExtraCharges([{ label: 'Photos', amount: '' }]).error, /Photos/);
  assert.match(readExtraCharges([{ label: '', amount: '50' }]).error, /name/);
  const { list, error } = readExtraCharges([{ label: 'Photos', amount: '50' }, { label: '', amount: '' }]);
  assert.equal(error, '');
  assert.equal(list.length, 1);
  assert.ok(list[0].id, 'saving mints an id');
});

test('a price-list entry is copied onto the sale, not linked', () => {
  const kennel = { extra_charge_list: [{ id: 'p1', label: 'Gold photo package', amount: 150 }] };
  const [preset] = kennelChargeList(kennel);
  const charge = newExtraCharge(preset);
  assert.equal(charge.label, 'Gold photo package');
  assert.equal(charge.amount, 150);
  assert.notEqual(charge.id, preset.id);
  assert.deepEqual({ label: newExtraCharge().label, amount: newExtraCharge().amount }, { label: '', amount: '' });
});

test('a deposit paid through a charge-back account offers its fee, once', () => {
  const paypal = { id: 'pp', name: 'PayPal (business)', account_type: 'payment_service', fee_percent: 3.49, fee_fixed: 0.49, fee_charge_back: true };
  const sale = { deposit_amount: 500, deposit_paid_via_account_id: 'pp' };
  assert.deepEqual(depositFeeChargeBack(sale, paypal, true), { fee_for: 'deposit', label: 'PayPal (business) fee', amount: 17.94 });
  assert.equal(depositFeeChargeBack(sale, paypal, false), null, 'not until the deposit is paid');
  assert.equal(depositFeeChargeBack(sale, { ...paypal, fee_charge_back: false }, true), null, 'the account must be set to charge back');
  assert.equal(depositFeeChargeBack(sale, { ...paypal, fee_percent: 0, fee_fixed: 0 }, true), null, 'no rate, no fee');
  assert.equal(depositFeeChargeBack({ ...sale, deposit_amount: 0 }, paypal, true), null);
  const charged = { ...sale, extra_charges: [{ id: 'x', label: 'PayPal (business) fee', amount: 17.94, fee_for: 'deposit' }] };
  assert.equal(depositFeeChargeBack(charged, paypal, true), null, 'already on the sale');
});

// --- Income and the invoice (in-memory database) -------------------------------------

let db; let kennelRepo; let dogRepo; let contactRepo; let saleRepo; let income;
let K; let pup; let buyer;

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  income = await import('../shared/data/incomeView.js');
});

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true });
  pup = await dogRepo.create({ call_name: 'Cedar', sex: 'male', breed: 'Boston Terrier', ownership_type: 'owned', status: 'puppy', kennel_id: K.id });
  buyer = await contactRepo.create({ name: 'Jamal' });
});

const makeSale = (over = {}) => saleRepo.create({
  kennel_id: K.id, dog_id: pup.id, buyer_contact_id: buyer.id, registration_type: 'limited',
  price: 3000, deposit_amount: 500, deposit_date: '2026-09-01', status: 'deposit_paid',
  extra_charges: [
    { id: 'gold', label: 'Gold photo package', amount: 150 },
    { id: 'video', label: 'Birth video', amount: 75 }
  ],
  ...over
});

test('each extra charge is its own line, keyed by id, named as she named it', async () => {
  const s = await makeSale();
  const extras = income.incomeLineItems('sale', s).filter((c) => c.component === 'extra');
  assert.deepEqual(extras.map((c) => [c.key, c.invoiceLabel, c.amount, c.state]), [
    ['extra:gold', 'Gold photo package', 150, 'anticipated'],
    ['extra:video', 'Birth video', 75, 'anticipated']
  ]);
  assert.equal(income.incomeLineItems('sale', s).find((c) => c.component === 'balance').invoiceLabel, 'Remaining Purchase Price');
});

test('extra charges are paid with the balance', async () => {
  const s = await makeSale({ status: 'paid_in_full', balance_paid_date: '2026-10-01' });
  const row = (await income.getIncomeRows()).find((r) => r.source_id === s.id);
  assert.equal(row.earned, 3225);
  assert.equal(row.anticipated, 0);
  assert.equal(income.paidOnSale(s), 3225);
  const { byComponent } = income.summarize(await income.getIncomeRows());
  assert.equal(byComponent.get('extra').earned, 225, 'one Extra charges heading in Financials');
});

test('a cancelled sale drops unpaid extra charges', async () => {
  await makeSale({ status: 'cancelled' });
  const row = (await income.getIncomeRows()).find((r) => r.source_type === 'sale');
  assert.ok(!row.components.some((c) => c.component === 'extra'));
});
