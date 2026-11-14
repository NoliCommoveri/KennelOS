// The contract payment table (incomeView.priceTable): the purchase price only, with
// every credit counted once, so price = deposit + other payments + balance due.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

await installMemoryDb();
const { priceTable, familyCredit } = await import('../shared/data/incomeView.js');
const { prefillValues, PREFILL_FIELDS } = await import('../shared/data/contractForms.js');

const sale = { id: 's1', status: 'deposit_pending', price: 3000, deposit_amount: 500, transport_fee: 400 };
const entry = (over = {}) => ({ id: 'e1', placed_sale_id: 's1', fee_amount: 75, fee_received_date: '2026-09-01', ...over });
const adds = (t, s = sale) => assert.equal(s.price, s.deposit_amount + t.otherPaid + t.balanceDue, JSON.stringify(t));
const toBalance = { amount: 75, toward: 'balance' };
const toDeposit = { amount: 75, toward: 'deposit' };

test('a sale with no credits: the deposit, and the price less it; transport left out', () => {
  assert.deepEqual(priceTable(sale), { depositDue: 500, otherPaid: 0, balanceDue: 2500 });
});

test('a credited fee comes off the deposit, or counts toward the balance', () => {
  let t = priceTable(sale, { feeCredit: toBalance });
  assert.deepEqual(t, { depositDue: 500, otherPaid: 75, balanceDue: 2425 }); adds(t);
  t = priceTable(sale, { feeCredit: toDeposit });
  assert.deepEqual(t, { depositDue: 425, otherPaid: 0, balanceDue: 2500 }); adds(t);
  // A fee larger than the deposit: the deposit is covered, the rest goes toward the balance.
  t = priceTable({ ...sale, deposit_amount: 50 }, { feeCredit: toDeposit });
  assert.deepEqual(t, { depositDue: 0, otherPaid: 25, balanceDue: 2925 });
});

test('received funds: on the deposit when allowed, else toward the balance; never both', () => {
  // 300 allowed on the deposit: 425 - 300 still due; the balance untouched.
  const onDeposit = entry({ received_credits: [{ id: 'c1', amount: 300, date: '2026-08-01' }] });
  let t = priceTable(sale, { feeCredit: toDeposit, received: familyCredit(onDeposit, sale, toDeposit).received });
  assert.deepEqual(t, { depositDue: 125, otherPaid: 0, balanceDue: 2500 }); adds(t);

  // The same funds NOT allowed on the deposit (her Applies to ticks): toward the balance.
  const notDeposit = entry({ received_credits: [{ id: 'c1', amount: 300, date: '2026-08-01', applies_to: ['price'] }] });
  t = priceTable(sale, { feeCredit: toDeposit, received: familyCredit(notDeposit, sale, toDeposit).received });
  assert.deepEqual(t, { depositDue: 425, otherPaid: 300, balanceDue: 2200 }); adds(t);

  // More than the deposit: it's covered, the rest goes toward the balance.
  const big = entry({ received_credits: [{ id: 'c1', amount: 1000, date: '2026-08-01' }] });
  t = priceTable(sale, { feeCredit: toDeposit, received: familyCredit(big, sale, toDeposit).received });
  assert.deepEqual(t, { depositDue: 0, otherPaid: 575, balanceDue: 1925 }); adds(t);

  // Funds that paid the fee (recorded on the entry) count only as the fee.
  const paidFee = entry({ fee_credit_amount: 75, received_credits: [{ id: 'c1', amount: 400, date: '2026-08-01' }] });
  const c = familyCredit(paidFee, sale, toBalance);
  assert.equal(c.byKey.fee, 75);
  t = priceTable(sale, { feeCredit: toBalance, received: c.received });
  assert.deepEqual(t, { depositDue: 175, otherPaid: 75, balanceDue: 2425 }); adds(t);
  assert.equal(500 - t.depositDue + t.otherPaid, 400, 'the 400 shows once: 325 on the deposit, 75 as the fee');
});

test('the deposit still due reads the same before and after the deposit is marked paid', () => {
  const e = entry({ received_credits: [{ id: 'c1', amount: 300, date: '2026-08-01' }] });
  const paid = { ...sale, status: 'deposit_paid', deposit_date: '2026-10-01' };
  const before = priceTable(sale, { feeCredit: toDeposit, received: familyCredit(e, sale, toDeposit).received });
  const after = priceTable(paid, { feeCredit: toDeposit, received: familyCredit(e, paid, toDeposit).received });
  assert.equal(before.depositDue, 125);
  assert.deepEqual(after, before);
});

test('a paid balance is a payment received, and nothing is left due', () => {
  const t = priceTable({ ...sale, balance_paid_date: '2026-11-01' });
  assert.deepEqual(t, { depositDue: 500, otherPaid: 2500, balanceDue: 0 }); adds(t);
});

test('payments recorded on the sale count toward the price (Payment Schedule plan §3.2)', () => {
  const pay = (amount, date = '2026-11-01', over = {}) => ({ id: `p${amount}${date}`, amount, date, ...over });
  const paid = { ...sale, status: 'deposit_paid', deposit_date: '2026-10-01' };
  // A $1,000 payment: received, and $1,500 of the price left.
  let t = priceTable({ ...paid, payments: [pay(1000)] });
  assert.deepEqual(t, { depositDue: 500, otherPaid: 1000, balanceDue: 1500 }); adds(t);
  // Several payments add up; one beyond the price goes on to transport, not here.
  t = priceTable({ ...paid, payments: [pay(1000), pay(1200, '2026-11-05')] });
  assert.deepEqual(t, { depositDue: 500, otherPaid: 2200, balanceDue: 300 }); adds(t);
  t = priceTable({ ...paid, payments: [pay(2800)] });
  assert.deepEqual(t, { depositDue: 500, otherPaid: 2500, balanceDue: 0 }); adds(t);
  // After the credited fee: the fee pays first, the payment covers the rest of it.
  t = priceTable({ ...paid, payments: [pay(2500)] }, { feeCredit: toBalance });
  assert.deepEqual(t, { depositDue: 500, otherPaid: 2500, balanceDue: 0 }); adds(t);
  t = priceTable({ ...paid, payments: [pay(1000)] }, { feeCredit: toBalance });
  assert.deepEqual(t, { depositDue: 500, otherPaid: 1075, balanceDue: 1425 }); adds(t);
  // After credits for funds received on the price: never counted twice.
  const e = entry({ received_credits: [{ id: 'c1', amount: 1000, date: '2026-08-01', applies_to: ['price'] }] });
  const withPay = { ...paid, payments: [pay(1000)] };
  t = priceTable(withPay, { received: familyCredit(e, withPay).received });
  assert.deepEqual(t, { depositDue: 500, otherPaid: 2000, balanceDue: 500 }); adds(t);
  t = priceTable({ ...paid, payments: [pay(2000)] }, { received: familyCredit(e, paid).received });
  assert.deepEqual(t, { depositDue: 500, otherPaid: 2500, balanceDue: 0 }); adds(t);
  // Marked paid in full as well: the balance once, not again for the payments.
  t = priceTable({ ...paid, balance_paid_date: '2026-11-10', payments: [pay(1000)] });
  assert.deepEqual(t, { depositDue: 500, otherPaid: 2500, balanceDue: 0 }); adds(t);
  // A payment toward an extra on its own dates isn't toward the price.
  const ownExtra = { id: 'x1', label: 'Photos', amount: 200, own_due_dates: true };
  t = priceTable({ ...paid, extra_charges: [ownExtra], payments: [pay(200, '2026-11-01', { toward: 'extra:x1' })] });
  assert.deepEqual(t, { depositDue: 500, otherPaid: 0, balanceDue: 2500 });
  // A payment on a schedule pays the price the same way.
  const sched = [{ id: 'd1', due: 'on_date', due_date: '2026-11-20', covers: ['price'], percent: 50, basis: 'total' },
    { id: 'final', due: 'at_pickup', covers: ['all'], percent: 100, basis: 'total' }];
  t = priceTable({ ...paid, payment_schedule: sched, payments: [pay(1000)] });
  assert.deepEqual(t, { depositDue: 500, otherPaid: 1000, balanceDue: 1500 }); adds(t);
});

test('an ended sale keeps what was paid; a lost one counts nothing, as before', () => {
  const pays = [{ id: 'p1', amount: 1000, date: '2026-11-01' }];
  const base = { ...sale, deposit_date: '2026-10-01', payments: pays };
  assert.deepEqual(priceTable({ ...base, status: 'cancelled' }), { depositDue: 500, otherPaid: 1000, balanceDue: 0 });
  assert.deepEqual(priceTable({ ...base, status: 'returned' }), { depositDue: 500, otherPaid: 1000, balanceDue: 0 });
  assert.deepEqual(priceTable({ ...base, status: 'voided' }), { depositDue: 500, otherPaid: 0, balanceDue: 0 });
});

test('the payment-table fields fill a sale contract, zeros included', () => {
  const v = Object.fromEntries(prefillValues('pet_home', { sale, priceTable: { depositDue: 0, otherPaid: 0, balanceDue: 2425 } }));
  assert.equal(v.depositDue, '0.00');
  assert.equal(v.otherPaymentsReceived, '0.00');
  assert.equal(v.purchaseBalanceDue, '2425.00');
  assert.equal(v.price, '3000.00');
});

test('every field label fits Firma\'s 100 characters, and no dropped field is back', () => {
  const all = Object.values(PREFILL_FIELDS).flat();
  assert.deepEqual(all.filter(([, label]) => label.length > 100).map(([k]) => k), []);
  const names = new Set(all.map(([k]) => k));
  for (const gone of ['waitlistFeePaid', 'waitlistFeeCredit', 'transportMethod', 'deliveryTime', 'goHomeFrom']) assert.equal(names.has(gone), false, gone);
  assert.equal(names.size, 88); // + the payment schedule's 8 (Payment Schedule plan §8.1)
});
