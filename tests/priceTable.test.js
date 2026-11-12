// The contract payment table (incomeView.priceTable): the purchase price only, the
// waitlist fee the family actually paid, and received funds counted once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

await installMemoryDb();
const { priceTable, familyCredit } = await import('../shared/data/incomeView.js');
const { prefillValues } = await import('../shared/data/contractForms.js');

const sale = { id: 's1', status: 'deposit_pending', price: 3000, deposit_amount: 500, transport_fee: 400 };
const entry = (over = {}) => ({ id: 'e1', placed_sale_id: 's1', fee_amount: 75, fee_received_date: '2026-09-01', ...over });

test('a sale outside the waitlist: no fee, the price less the deposit due, transport left out', () => {
  assert.deepEqual(priceTable(sale), { feePaid: 0, feeCredit: 0, depositDue: 500, otherPaid: 0, balanceDue: 2500 });
});

test('the fee is what this family paid (its own amount), credited or not, and only once received', () => {
  assert.equal(priceTable(sale, { entries: [entry()] }).feePaid, 75, 'her setting may say 50: the entry says 75');
  assert.equal(priceTable(sale, { entries: [entry({ fee_received_date: null })] }).feePaid, 0, 'not received');
  assert.equal(priceTable(sale, { entries: [entry({ placed_sale_id: 'other' })] }).feePaid, 0, 'another sale');
  assert.equal(priceTable(sale, { entries: [entry({ is_archived: true })] }).feePaid, 0);
});

test('the credit comes off the balance, or off the deposit (then not off the balance)', () => {
  const toBalance = priceTable(sale, { entries: [entry()], feeCredit: { amount: 75, toward: 'balance' } });
  assert.deepEqual(toBalance, { feePaid: 75, feeCredit: 75, depositDue: 500, otherPaid: 0, balanceDue: 2425 });
  const toDeposit = priceTable(sale, { entries: [entry()], feeCredit: { amount: 75, toward: 'deposit' } });
  assert.deepEqual(toDeposit, { feePaid: 75, feeCredit: 75, depositDue: 425, otherPaid: 0, balanceDue: 2500 });
});

test('received funds: what covers the deposit isn\'t counted again; the leftover is a payment received', () => {
  const e = entry({ received_credits: [{ id: 'c1', amount: 800, date: '2026-08-01' }] });
  const received = familyCredit(e, sale, { amount: 0, toward: 'balance' }).received;
  const t = priceTable(sale, { entries: [e], received });
  assert.equal(t.otherPaid, 300, '800 received: 500 covers the deposit, 300 goes on the balance');
  assert.equal(t.balanceDue, 2200);
});

test('a paid balance is a payment received, and nothing is left due', () => {
  assert.deepEqual(priceTable({ ...sale, balance_paid_date: '2026-11-01' }), { feePaid: 0, feeCredit: 0, depositDue: 500, otherPaid: 2500, balanceDue: 0 });
});

test('the new fields fill a sale contract', () => {
  const v = Object.fromEntries(prefillValues('pet_home', { sale, priceTable: { feePaid: 75, feeCredit: 75, otherPaid: 0, balanceDue: 2425 } }));
  assert.equal(v.waitlistFeePaid, '75.00');
  assert.equal(v.waitlistFeeCredit, '75.00');
  assert.equal(v.otherPaymentsReceived, '0.00');
  assert.equal(v.purchaseBalanceDue, '2425.00');
  assert.equal(v.price, '3000.00');
});

test('deposit due: less the fee credited toward the deposit and the credits allowed to go to the deposit', () => {
  const towardDeposit = { amount: 75, toward: 'deposit' };
  assert.equal(priceTable(sale, { feeCredit: towardDeposit }).depositDue, 425, '500 less the 75 fee');
  assert.equal(priceTable(sale, { feeCredit: { amount: 75, toward: 'balance' } }).depositDue, 500, 'a fee toward the balance leaves the deposit');

  // 300 of received funds, allowed on the deposit: 425 - 300 = 125 still due; the balance untouched.
  const onDeposit = entry({ received_credits: [{ id: 'c1', amount: 300, date: '2026-08-01' }] });
  let received = familyCredit(onDeposit, sale, towardDeposit).received;
  let t = priceTable(sale, { feeCredit: towardDeposit, received });
  assert.deepEqual([t.depositDue, t.otherPaid, t.balanceDue], [125, 0, 2500]);

  // The same funds NOT allowed on the deposit (her Applies to ticks): they go on the balance.
  const notDeposit = entry({ received_credits: [{ id: 'c1', amount: 300, date: '2026-08-01', applies_to: ['price'] }] });
  received = familyCredit(notDeposit, sale, towardDeposit).received;
  t = priceTable(sale, { feeCredit: towardDeposit, received });
  assert.deepEqual([t.depositDue, t.otherPaid, t.balanceDue], [425, 300, 2200]);

  // Her table adds up: total = deposit + additional credits + balance due.
  assert.equal(sale.price, sale.deposit_amount + t.otherPaid + t.balanceDue);

  // More than the deposit: it's covered, the rest goes on the balance.
  const big = entry({ received_credits: [{ id: 'c1', amount: 1000, date: '2026-08-01' }] });
  received = familyCredit(big, sale, towardDeposit).received;
  t = priceTable(sale, { feeCredit: towardDeposit, received });
  assert.deepEqual([t.depositDue, t.otherPaid, t.balanceDue], [0, 575, 1925]);
  assert.equal(Object.fromEntries(prefillValues('pet_home', { sale, priceTable: t })).depositDue, '0.00');
});
