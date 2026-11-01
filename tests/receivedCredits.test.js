// receivedCredits.test.js — a waitlist family's credits for funds already received
// (data/receivedCredits.js), how they're spread over the fee and the sale
// (incomeView.familyCredit), and the money figures that take them off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditsOf, newCredit, feeCharge, allocateCredits, saleCredited, CREDIT_USE_VALUES } from '../shared/data/receivedCredits.js';
import { familyCredit, saleCreditCharges, paidOnSale, paidBesidesCredits, incomeLineItems } from '../shared/data/incomeView.js';
import { creditSale } from '../shared/data/familyExtras.js';

const credit = (amount, date, applies_to = CREDIT_USE_VALUES, id = `c${amount}${date}`) => ({ id, amount, date, applies_to });
const sale = (over = {}) => ({ id: 's1', status: 'deposit_pending', price: 2000, deposit_amount: 500, transport_fee: 100, ...over });

test('newCredit: every use ticked by default; amount, date and a use are required', () => {
  const c = newCredit({ amount: '200', date: '2025-03-01' });
  assert.equal(c.amount, 200);
  assert.deepEqual(c.applies_to, CREDIT_USE_VALUES);
  assert.ok(c.id);
  assert.throws(() => newCredit({ amount: 0, date: '2025-03-01' }), /amount/);
  assert.throws(() => newCredit({ amount: 5, date: '' }), /date/);
  assert.throws(() => newCredit({ amount: 5, date: '2025-03-01', applies_to: [] }), /at least one/);
});

test('creditsOf: oldest first, bad rows dropped', () => {
  const e = { received_credits: [credit(100, '2025-05-01'), { id: 'x', amount: 0 }, credit(50, '2025-01-01')] };
  assert.deepEqual(creditsOf(e).map((c) => c.amount), [50, 100]);
});

test('feeCharge: the whole fee while unpaid; once received only the part a credit paid', () => {
  assert.deepEqual(feeCharge({ fee_amount: 150 }), [{ key: 'fee', use: 'fee', amount: 150 }]);
  assert.deepEqual(feeCharge({ fee_amount: 150, fee_received_date: '2025-02-01' }), []);
  assert.deepEqual(feeCharge({ fee_amount: 150, fee_received_date: '2025-02-01', fee_credit_amount: 150 }), [{ key: 'fee', use: 'fee', amount: 150 }]);
  assert.deepEqual(feeCharge({ fee_amount: 0 }), []);
});

test('allocateCredits: fee, then deposit, then price, then extras; only ticked uses', () => {
  const charges = [{ key: 'fee', use: 'fee', amount: 150 }, { key: 'deposit', use: 'deposit', amount: 500 }, { key: 'balance', use: 'price', amount: 1500 }, { key: 'transport', use: 'extras', amount: 100 }];
  const a = allocateCredits([credit(700, '2025-01-01')], charges);
  assert.deepEqual(a.byKey, { fee: 150, deposit: 500, balance: 50 });
  assert.equal(a.remaining, 0);
  const b = allocateCredits([credit(200, '2025-01-01', ['price', 'extras'])], charges);
  assert.deepEqual(b.byKey, { balance: 200 });
  const c = allocateCredits([credit(300, '2025-01-01', ['fee'])], charges);
  assert.deepEqual(c.byKey, { fee: 150 });
  assert.equal(c.remaining, 150);
});

test('familyCredit: a $200 early deposit is part of a $500 deposit, not all of it', () => {
  const entry = { fee_amount: 0, received_credits: [credit(200, '2025-03-01')] };
  const f = familyCredit(entry, sale());
  assert.deepEqual(f.byKey, { deposit: 200 });
  assert.deepEqual(f.received, { byKey: { deposit: 200 }, date: '2025-03-01' });
  assert.equal(saleCredited(f), 200);
  // Invoice lines stay whole: the credit prefills "already collected" instead.
  assert.equal(incomeLineItems('sale', sale()).find((x) => x.key === 'deposit').amount, 500);
});

test('familyCredit: no sale yet, or a released sale, leaves the rest as credit', () => {
  const entry = { fee_amount: 100, received_credits: [credit(300, '2025-03-01')] };
  assert.deepEqual(familyCredit(entry, null).byKey, { fee: 100 });
  assert.equal(familyCredit(entry, null).remaining, 200);
  assert.deepEqual(saleCreditCharges(sale({ status: 'voided' })), []);
  assert.equal(familyCredit({ fee_amount: 0 }, sale()), null);
});

test('paidOnSale counts the credit as paid when asked; the carry-over leaves it on the entry', () => {
  const entry = { fee_amount: 0, received_credits: [credit(200, '2025-03-01')] };
  const open = sale();
  const f = familyCredit(entry, open);
  assert.equal(paidOnSale(open), 0);
  assert.equal(paidOnSale(open, { received: f.received }), 200);
  // Deposit paid in full ($500, $200 of it the credit): $300 is carried, the $200 stays credit.
  const paid = sale({ status: 'voided', deposit_date: '2026-05-01' });
  assert.equal(paidBesidesCredits(paid, entry, { asStatus: 'deposit_paid' }), 300);
  assert.equal(paidBesidesCredits(sale({ status: 'voided' }), entry, { asStatus: 'deposit_pending' }), 0);
});

test('creditSale: a delivered sale keeps the credit; a cancelled one gives it back', () => {
  const entry = { id: 'e1', placed_sale_id: 's1' };
  assert.equal(creditSale(entry, [sale({ status: 'delivered' })])?.id, 's1');
  assert.equal(creditSale(entry, [sale({ status: 'cancelled' })]), null);
});
