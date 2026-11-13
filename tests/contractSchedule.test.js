// contractSchedule.test.js — a sale's payment schedule on its contract (Payment Schedule
// plan §8.1, build step 5): the eight prefills, an extra agreement's plan and the transport
// due date, all read from the payment statement, so a contract says what the Payments
// card says. Credits here are credits for funds received (WaitlistEntry.received_credits):
// they pay the application fee first, then the sale, and only what they put on the sale
// counts as paid on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentStatement } from '../shared/data/paymentSchedule.js';
import { prefillValues, PREFILL_FIELDS } from '../shared/data/contractForms.js';
import { addOnFacts } from '../shared/data/contractAddOns.js';
import { creditsOf, feeCharge, CREDIT_USE_VALUES } from '../shared/data/receivedCredits.js';
import { familyCredit, incomeLineItems, paidOnSale } from '../shared/data/incomeView.js';

const TODAY = '2026-11-13';
const opts = (o = {}) => ({ birthDate: '2026-10-01', pickupDate: '2026-12-24', today: TODAY, depositDueDate: '2026-10-15', ...o });
const sale = (o = {}) => ({ id: 's1', status: 'deposit_paid', price: 2500, deposit_amount: 500, deposit_date: '2026-10-20', ...o });
const credit = (amount, date, applies_to = CREDIT_USE_VALUES, id = `c${amount}`) => ({ id, amount, date, applies_to });
const final = { id: 'final', due: 'at_pickup', covers: ['all'], percent: 100, basis: 'total' };
const r2 = (n) => Math.round(n * 100) / 100;
const NEW = ['totalCharges', 'paidToDate', 'payment1Amount', 'payment1Due', 'payment2Amount', 'payment2Due', 'finalPaymentAmount', 'finalPaymentDue'];

// The contract's values for a sale, its statement read as the app reads it.
function contract(s, { entry = null, fee = null, formType = 'pet_home', extra = null, events = [] } = {}) {
  const st = paymentStatement(s, opts({ feeCredit: fee, credits: entry ? creditsOf(entry) : [], feeCharges: entry ? feeCharge(entry) : [] }));
  const addOns = addOnFacts({ sale: s, events, priceList: [], today: TODAY });
  const form = extra ? { form_type: 'extra', extra_list_id: extra } : formType;
  return { v: Object.fromEntries(prefillValues(form, { sale: s, statement: st, addOns })), st };
}

test('the eight new fields are sale fields, after the ones already there', () => {
  const names = PREFILL_FIELDS.sale.map(([k]) => k);
  assert.deepEqual(names.slice(-8), NEW);
  for (const k of ['price', 'depositDue', 'balanceDue', 'purchaseBalanceDue']) assert.ok(names.includes(k), `${k} kept`);
});

test('no schedule: the total, what\'s paid, and one final payment (no payment 1 or 2)', () => {
  const { v } = contract(sale({ transport_fee: 300, balance_due_date: '2026-12-20' }));
  assert.equal(v.totalCharges, '2800.00');
  assert.equal(v.paidToDate, '500.00');
  assert.equal(v.payment1Amount, undefined);
  assert.equal(v.payment2Amount, undefined);
  assert.deepEqual([v.finalPaymentAmount, v.finalPaymentDue], ['2300.00', '2026-12-20']);
  // No balance due date: at pickup.
  assert.equal(contract(sale()).v.finalPaymentDue, '2026-12-24');
});

test('a schedule: payments 1 and 2 are the due dates before the final; each amount is what\'s still owed by it', () => {
  const s = sale({
    transport_fee: 300,
    payment_schedule: [
      { id: 'half', due: 'at_weeks', n: 8, covers: ['price'], percent: 50 },
      { id: 'dec', due: 'on_date', due_date: '2026-12-10', covers: ['all'], amount: 400, prior_funds: 'dont_count' },
      final
    ],
    payments: [{ id: 'p1', amount: 300, date: '2026-11-05' }]
  });
  const { v } = contract(s);
  // Half the price by Nov 26 asks $750 after the deposit; $300 paid leaves $450.
  assert.deepEqual([v.payment1Amount, v.payment1Due], ['450.00', '2026-11-26']);
  assert.deepEqual([v.payment2Amount, v.payment2Due], ['400.00', '2026-12-10']);
  assert.deepEqual([v.finalPaymentAmount, v.finalPaymentDue], ['1150.00', '2026-12-24']);
  assert.deepEqual([v.totalCharges, v.paidToDate], ['2800.00', '800.00']);

  // Met: 0.00, never left blank (blank would read as "no such payment").
  const paid = contract({ ...s, payments: [{ id: 'p1', amount: 750, date: '2026-11-05' }] }).v;
  assert.equal(paid.payment1Amount, '0.00');
  // A date not known yet is left out; its amount still prints.
  const noBirth = paymentStatement(s, opts({ birthDate: null }));
  const nb = Object.fromEntries(prefillValues('pet_home', { sale: s, statement: noBirth }));
  assert.equal(nb.payment1Due, undefined);
  assert.equal(nb.payment1Amount, '450.00');
});

test('a third earlier due date has no slot; the final is still the last', () => {
  const step = (id, d) => ({ id, due: 'on_date', due_date: d, covers: ['all'], amount: 100 });
  const { v } = contract(sale({ payment_schedule: [step('a', '2026-11-20'), step('b', '2026-11-27'), step('c', '2026-12-04'), final] }));
  assert.deepEqual([v.payment1Due, v.payment2Due, v.finalPaymentDue], ['2026-11-20', '2026-11-27', '2026-12-24']);
  assert.equal(v.finalPaymentAmount, '1700.00');
});

test('credits: only what a credit puts on the sale is paid on it; the fee credited counts, the fee itself and any leftover don\'t', () => {
  // $650 of credit: the unpaid $150 fee first, then the $500 deposit. The sale is owed
  // nothing toward the deposit, and has $500 paid on it, not $650.
  const entry = { id: 'e1', fee_amount: 150, received_credits: [credit(650, '2026-09-01')] };
  let { v } = contract(sale({ status: 'deposit_pending', deposit_date: null }), { entry });
  assert.deepEqual([v.totalCharges, v.paidToDate, v.finalPaymentAmount], ['2500.00', '500.00', '2000.00']);

  // More credit than everything: the sale is paid in full, the rest stays the family's.
  ({ v } = contract(sale(), { entry: { id: 'e1', received_credits: [credit(9000, '2026-09-01')] } }));
  assert.deepEqual([v.paidToDate, v.finalPaymentAmount], ['2500.00', '0.00']);

  // A credit ticked for the price only never pays the deposit.
  ({ v } = contract(sale({ status: 'deposit_pending', deposit_date: null }), { entry: { id: 'e1', received_credits: [credit(300, '2026-09-01', ['price'])] } }));
  assert.deepEqual([v.paidToDate, v.finalPaymentAmount], ['300.00', '1700.00']);

  // The application fee received and credited toward the purchase is money on the sale.
  ({ v } = contract(sale({ status: 'deposit_pending', deposit_date: null }), { fee: { amount: 200, toward: 'deposit', date: '2026-08-01' } }));
  assert.deepEqual([v.paidToDate, v.finalPaymentAmount], ['200.00', '2000.00']);
});

test('earlier money never covers a "new payments only" due date while anything else can take it (D18)', () => {
  const s = sale({ payment_schedule: [{ id: 'new', due: 'on_date', due_date: '2026-12-01', covers: ['all'], amount: 500, prior_funds: 'dont_count' }, final] });
  const { v } = contract(s, { entry: { id: 'e1', received_credits: [credit(1000, '2026-09-01')] } });
  // $1,000 credit: $500 deposit, $500 to the final. The new-payments-only $500 stays owed.
  assert.deepEqual([v.payment1Amount, v.finalPaymentAmount, v.paidToDate], ['500.00', '1000.00', '1000.00']);
});

test('a returned, cancelled or voided sale: what was paid stands, no due dates', () => {
  const { v } = contract(sale({ status: 'cancelled', payments: [{ id: 'p', amount: 300, date: '2026-11-01' }] }));
  assert.equal(v.paidToDate, '800.00');
  for (const k of ['payment1Amount', 'finalPaymentAmount', 'finalPaymentDue']) assert.equal(v[k], undefined);
});

test('an extra paid through the schedule: its plan is its share of each due date; own-dated and no-schedule extras keep their steps', () => {
  const steps = [{ id: 'a', percent: 50, due: 'on_approval', due_date: '2026-11-20' }, { id: 'b', percent: 50, due: 'with_balance' }];
  const training = { id: 'x1', list_id: 'train', label: 'Training', amount: 600, payments: steps.map((st) => ({ ...st, amount: 300 })) };
  const half = { id: 'half', due: 'at_weeks', n: 8, covers: ['price', 'extra:x1'], percent: 50 };
  const s = sale({ extra_charges: [training], payment_schedule: [half, final] });
  // 50% of (2500 + 600) = 1550 by Nov 26, less the 500 deposit: 1050, paid in charge order
  // (the price, then the extra), so the extra has nothing due then; all 600 at pickup.
  let { v } = contract(s, { extra: 'train' });
  assert.equal(v.extraPayments, '100% (600.00) due 2026-12-24');
  assert.equal(v.extraPayment2Amount, undefined, 'its own two steps are not used');

  // What a due date covers sets how much it asks, not which charge pays it: money pays
  // the price first (D16), as the invoices and Financials read it (chargePieces). A due
  // date naming only the extra is still filled by the price.
  ({ v } = contract(sale({ extra_charges: [training], payment_schedule: [{ id: 'x', due: 'on_date', due_date: '2026-12-01', covers: ['extra:x1'], amount: 300 }, final] }), { extra: 'train' }));
  assert.equal(v.extraPayments, '100% (600.00) due 2026-12-24');
  // 90% of everything by Dec 1 asks 2790 - 500 = 2290: the 2000 left of the price, then
  // 290 of the extra; its other 310 at pickup. (An extra with steps of its own that no
  // due date names stays on its own dates, so this one has none.)
  const { payments: _p, ...plainTraining } = training;
  ({ v } = contract(sale({ extra_charges: [plainTraining], payment_schedule: [{ id: 'x', due: 'on_date', due_date: '2026-12-01', covers: ['all'], percent: 90 }, final] }), { extra: 'train' }));
  assert.equal(v.extraPayments, '48.33% (290.00) due 2026-12-01; 51.67% (310.00) due 2026-12-24');
  assert.deepEqual([v.extraPayment1Amount, v.extraPayment1Due, v.extraPayment2Amount, v.extraPayment2Due], ['290.00', '2026-12-01', '310.00', '2026-12-24']);

  // The final payment's date not known yet: "with the balance".
  const noPickup = { ...s };
  const st = paymentStatement(noPickup, opts({ pickupDate: null }));
  v = Object.fromEntries(prefillValues({ form_type: 'extra', extra_list_id: 'train' }, { sale: noPickup, statement: st, addOns: addOnFacts({ sale: noPickup, priceList: [], today: TODAY }) }));
  assert.equal(v.extraPayments, '100% (600.00) with the balance');

  // Own-dated (flagged), or the sale has no schedule: its own steps, as before.
  const own = contract(sale({ extra_charges: [{ ...training, own_due_dates: true }], payment_schedule: [half, final] }), { extra: 'train' }).v;
  assert.equal(own.extraPayments, '50% (300.00) due 2026-11-20; 50% (300.00) with the balance');
  const none = contract(sale({ extra_charges: [training] }), { extra: 'train' }).v;
  assert.equal(none.extraPayments, '50% (300.00) due 2026-11-20; 50% (300.00) with the balance');
});

test('transport is due with the final payment on a schedule; the balance due date without one', () => {
  const s = sale({ transport_fee: 300, balance_due_date: '2026-12-01', payment_schedule: [{ id: 'a', due: 'at_weeks', n: 8, covers: ['transport'], percent: 100 }, final] });
  // The stored balance due date is stale (pickup moved): the final payment's date wins.
  assert.equal(contract(s, { formType: 'transport' }).v.transportDueDate, '2026-12-24');
  const { payment_schedule: _x, ...plain } = s;
  assert.equal(contract(plain, { formType: 'transport' }).v.transportDueDate, '2026-12-01');
});

// --- Every combination ------------------------------------------------------------------

test('every combination: the fields are the statement\'s, they add up, and balanceDue agrees', () => {
  const SCHEDULES = [undefined,
    [{ id: 'a', due: 'at_weeks', n: 8, covers: ['price', 'extras'], percent: 50 }, final],
    [{ id: 'a', due: 'on_date', due_date: '2026-12-01', covers: ['all'], amount: 600, prior_funds: 'dont_count' }, final],
    [{ id: 'a', due: 'at_weeks', n: 7, covers: ['all'], percent: 30, basis: 'remaining' }, { id: 'b', due: 'before_pickup', n: 5, covers: ['price'], amount: 400 }, final]];
  const CREDITS = [[], [credit(200, '2026-09-01')], [credit(1200, '2026-09-01')], [credit(9000, '2026-09-01')], [credit(300, '2026-09-01', ['price'])], [credit(100, '2026-09-01', ['fee'])]];
  const FEES = [null, { amount: 100, toward: 'balance' }, { amount: 300, toward: 'deposit' }, { amount: 700, toward: 'deposit' }];
  const PAYMENTS = [[], [{ id: 'p', amount: 400, date: '2026-11-01' }], [{ id: 'p', amount: 300, date: '2026-11-01' }, { id: 'q', amount: 5000, date: '2026-11-10' }]];
  const STATUS = [{ status: 'deposit_pending', deposit_date: null }, { status: 'deposit_paid' }, { status: 'paid_in_full', balance_paid_date: '2026-11-10' }];
  const OTHER = [{}, { transport_fee: 300 },
    { transport_fee: 300, deferred_boarding_amount: 20, deferred_boarding_duration_days: 5, extra_charges: [{ id: 'x', label: 'Training', amount: 600 }] },
    { extra_charges: [{ id: 'o', label: 'Photos', amount: 75, own_due_dates: true, payments: [{ id: 'a', percent: 100, amount: 75, due: 'on_date', due_date: '2026-11-30' }] }] }];
  let n = 0;
  for (const sch of SCHEDULES) for (const cr of CREDITS) for (const fee of FEES) for (const pays of PAYMENTS) for (const status of STATUS) for (const other of OTHER) for (const feeOwed of [false, true]) {
    const s = sale({ ...status, ...other, payments: pays, ...(sch ? { payment_schedule: sch } : {}) });
    const entry = { id: 'e', received_credits: cr, ...(feeOwed ? { fee_amount: 150 } : {}) };
    const { v, st } = contract(s, { entry, fee: fee ? { ...fee, date: '2026-08-01' } : null });
    const where = JSON.stringify({ sch: sch?.length || 0, cr, fee, pays: pays.length, status: status.status, other: Object.keys(other), feeOwed });
    const m = (k) => Number(v[k] || 0);
    assert.equal(v.totalCharges, st.total.toFixed(2), where);
    assert.equal(v.paidToDate, st.paid.toFixed(2), where);
    // Everything owed is somewhere: the deposit, payments 1 and 2, the final payment and
    // extras on their own dates (no schedule here has more than two earlier due dates).
    const owed = r2((st.deposit?.owed || 0) + m('payment1Amount') + m('payment2Amount') + m('finalPaymentAmount') + st.ownDated.reduce((t, o) => t + o.owed, 0));
    assert.equal(owed, r2(m('totalCharges') - m('paidToDate')), where);
    const earlier = st.dueDates.filter((d) => !d.isFinal);
    assert.equal(v.payment1Amount, earlier[0] ? earlier[0].owed.toFixed(2) : undefined, where);
    assert.equal(v.finalPaymentAmount, st.dueDates.at(-1).owed.toFixed(2), where);
    // The balance still due the contract already carried (contractSend.balanceDueOn) is the same figure.
    const feeCredit = fee || { amount: 0, toward: 'balance' };
    const total = incomeLineItems('sale', s, { feeCredit }).reduce((t, x) => t + x.amount, 0);
    const balanceDue = Math.max(0, total - paidOnSale(s, { feeCredit, received: familyCredit(entry, s, feeCredit)?.received || null }));
    assert.equal(r2(balanceDue), st.remaining, where);
    n++;
  }
  assert.ok(n > 5000);
});
