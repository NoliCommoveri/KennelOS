// paymentScheduleIncome.test.js — Financials on the payment statement (Payment
// Schedule plan build step 3): incomeView.ledgerComponents (money earned on its own
// date, what's owed anticipated on the due date that needs it, credits for funds
// received earned on the covered charge's due date, D21), paidOnSale counting
// recorded payments, and Receivables one row per due date. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentStatement } from '../shared/data/paymentSchedule.js';
import { ledgerComponents, incomeLineItems, paidOnSale, familyCredit } from '../shared/data/incomeView.js';
import { incomeEntries, receivableRows } from '../shared/data/moneyReport.js';
import { CREDIT_USE_VALUES } from '../shared/data/receivedCredits.js';

const TODAY = '2026-11-13';
const BIRTH = '2026-10-01'; // 8 weeks = Nov 26
const PICKUP = '2026-12-24';
const opts = (o = {}) => ({ birthDate: BIRTH, pickupDate: PICKUP, today: TODAY, ...o });
const sale = (o = {}) => ({ id: 's1', status: 'deposit_paid', price: 2500, deposit_amount: 500, deposit_date: '2026-10-20', sale_date: '2026-10-01', ...o });
const credit = (amount, date, applies_to = CREDIT_USE_VALUES, id = `c${amount}`) => ({ id, amount, date, applies_to });
const r2 = (n) => Math.round(n * 100) / 100;
const sum = (xs, f = (x) => x.amount) => r2(xs.reduce((t, x) => t + f(x), 0));
const ledger = (s, o = {}) => ledgerComponents(s, paymentStatement(s, opts(o)), { today: TODAY });
const final = { id: 'final', due: 'at_pickup', covers: ['all'], percent: 100, basis: 'total' };

// Totals by key and state, for comparing two lists of components.
const byKeyState = (cs) => {
  const m = {};
  for (const c of cs) m[`${c.key || c.component}|${c.state}`] = r2((m[`${c.key || c.component}|${c.state}`] || 0) + c.amount);
  return m;
};

test('no schedule, no payments, no credits: every sale earns and anticipates exactly what it did before', () => {
  const extrasOf = {
    none: [],
    one: [{ id: 'x', label: 'Photos', amount: 150 }],
    steps: [{ id: 't', label: 'Training', amount: 600, payments: [{ id: 'a', percent: 50, due: 'on_approval', due_date: '2026-11-01', paid_date: '2026-11-01' }, { id: 'b', percent: 50, due: 'with_balance' }] }],
    kept: [{ id: 'k', label: 'Stay', amount: 400, kept_after_cancel: true }, { id: 'x', label: 'Photos', amount: 150 }]
  };
  let n = 0;
  for (const status of ['deposit_pending', 'deposit_paid', 'paid_in_full', 'delivered', 'cancelled', 'returned', 'voided'])
  for (const fee of [null, { amount: 50, toward: 'balance' }, { amount: 300, toward: 'deposit' }, { amount: 700, toward: 'deposit' }])
  for (const extras of Object.keys(extrasOf))
  for (const paidDate of [null, '2026-12-01'])
  for (const transport of [0, 200]) {
    n++;
    const s = sale({ status, deposit_date: status === 'deposit_pending' ? null : '2026-10-20', balance_paid_date: paidDate, transport_fee: transport,
      deferred_boarding_amount: 25, deferred_boarding_duration_days: '4', extra_charges: extrasOf[extras],
      ...(status === 'voided' ? { end_reason: 'pup_died' } : {}) });
    const at = `${status} ${JSON.stringify(fee)} ${extras} ${paidDate} ${transport}`;
    const now = ledger(s, { feeCredit: fee });
    // The one change: a balance paid date with the deposit never marked received means
    // paid in full, the deposit included (as the sale's Payments card has read it since
    // step 2); before, Financials left that deposit anticipated.
    if (paidDate && status === 'deposit_pending') {
      assert.ok(!now.some((c) => c.state === 'anticipated'), at);
      continue;
    }
    const before = incomeLineItems('sale', s, { feeCredit: fee || 0 });
    assert.deepEqual(byKeyState(now), byKeyState(before), at);
    // Money earned is filed on the same date as before: the deposit on its date, a step
    // on its paid date, the rest on the balance paid date (each else the sale's date).
    for (const c of now.filter((x) => x.state === 'earned')) {
      const step = c.key.split(':')[2];
      const want = c.component === 'deposit' ? s.deposit_date || s.sale_date
        : step && extrasOf[extras][0].payments?.find((p) => p.id === step)?.paid_date ? '2026-11-01'
          : s.balance_paid_date || s.sale_date;
      assert.equal(c.when, want, `${at}: ${c.key}`);
    }
  }
  assert.equal(n, 7 * 4 * 4 * 2 * 2);
});

test('payments are earned on their own dates; what\'s owed is anticipated on the due date that needs it', () => {
  const s = sale({
    payment_schedule: [{ id: 'half', due: 'at_weeks', n: 8, covers: ['price'], percent: 50 }, final],
    payments: [{ id: 'p1', amount: 400, date: '2026-11-05' }], transport_fee: 300
  });
  const cs = ledger(s);
  assert.deepEqual(cs.filter((c) => c.state === 'earned').map((c) => [c.key, c.amount, c.when]), [['deposit', 500, '2026-10-20'], ['balance', 400, '2026-11-05']]);
  // Half the $2,500 price is due at 8 weeks (Nov 26): the deposit and the payment
  // leave $350 of it owed then; the rest of the price and transport at pickup.
  assert.deepEqual(cs.filter((c) => c.state === 'anticipated').map((c) => [c.key, c.amount, c.due, c.due_id]),
    [['balance', 350, '2026-11-26', 'half'], ['balance', 1250, PICKUP, 'final'], ['transport', 300, PICKUP, 'final']]);
});

test('an unpaid deposit is due when it was asked for; without that date, it has no due date', () => {
  const s = sale({ status: 'deposit_pending', deposit_date: null });
  assert.deepEqual(ledger(s, { depositDueDate: '2026-11-20' }).filter((c) => c.key === 'deposit').map((c) => [c.state, c.due, c.when]), [['anticipated', '2026-11-20', '2026-11-20']]);
  assert.deepEqual(ledger(s).filter((c) => c.key === 'deposit').map((c) => [c.state, c.due, c.when]), [['anticipated', '', '2026-10-01']]);
});

test('the application fee credited toward the price is never the sale\'s income (the waitlist row has it)', () => {
  const cs = ledger(sale({ status: 'deposit_pending', deposit_date: null }), { feeCredit: { amount: 300, toward: 'deposit', date: '2026-08-01' } });
  assert.equal(sum(cs.filter((c) => c.key === 'deposit')), 200);
  assert.equal(sum(cs), 2200);
});

test('D21: a credit is held money; the charge it covers is anticipated until its due date, then earned on it', () => {
  const credits = [credit(800, '2026-06-01')];
  // The credit pays the $500 deposit and $300 of the price. The deposit was asked for
  // Oct 15 (past): earned then, not on the credit's June date. The price's due date is
  // at pickup (Dec 24, future): anticipated, marked credited.
  const s = sale({ status: 'deposit_pending', deposit_date: null });
  let cs = ledger(s, { credits, depositDueDate: '2026-10-15' });
  assert.deepEqual(cs.filter((c) => c.credited).map((c) => [c.key, c.amount, c.state, c.when]), [['deposit', 500, 'earned', '2026-10-15'], ['balance', 300, 'anticipated', PICKUP]]);
  assert.ok(!cs.some((c) => c.when === '2026-06-01'), 'never the credit\'s own date');
  // Once the pickup has passed, the credited part of the price is earned on it.
  cs = ledgerComponents(s, paymentStatement(s, opts({ credits, depositDueDate: '2026-10-15', today: '2027-01-02' })), { today: '2027-01-02' });
  assert.deepEqual(cs.filter((c) => c.credited).map((c) => [c.key, c.state, c.when]), [['deposit', 'earned', '2026-10-15'], ['balance', 'earned', PICKUP]]);
  // With a schedule, the credit's share of the price is due with the due date it filled.
  const sched = sale({ status: 'deposit_pending', deposit_date: null, payment_schedule: [{ id: 'half', due: 'on_date', due_date: '2026-11-01', covers: ['price'], percent: 50 }, final] });
  cs = ledger(sched, { credits, depositDueDate: '2026-10-15' });
  assert.deepEqual(cs.filter((c) => c.credited && c.key === 'balance').map((c) => [c.amount, c.state, c.when]), [[300, 'earned', '2026-11-01']]);
});

test('D21: a covered charge whose due date can\'t be known yet is earned once received / paid in full, on that date', () => {
  const credits = [credit(800, '2026-06-01')];
  const s = sale({ deposit_date: '2026-10-20', status: 'paid_in_full', balance_paid_date: '2026-12-01' });
  const cs = ledgerComponents(s, paymentStatement(s, { today: TODAY, credits }), { today: TODAY }); // no pickup date known
  assert.deepEqual(cs.filter((c) => c.credited).map((c) => [c.key, c.state, c.when]), [['deposit', 'earned', '2026-10-20'], ['balance', 'earned', '2026-12-01']]);
  const open = sale({ status: 'deposit_pending', deposit_date: null });
  const owed = ledgerComponents(open, paymentStatement(open, { today: TODAY, credits }), { today: TODAY });
  assert.deepEqual(owed.filter((c) => c.credited).map((c) => [c.key, c.state, c.due]), [['deposit', 'anticipated', ''], ['balance', 'anticipated', '']]);
});

test('a returned or cancelled sale keeps only what was paid, payments included; a lost one counts nothing', () => {
  const pay = [{ id: 'p1', amount: 400, date: '2026-11-05' }];
  assert.deepEqual(ledger(sale({ status: 'cancelled', payments: pay })).map((c) => [c.key, c.amount, c.state]), [['deposit', 500, 'earned'], ['balance', 400, 'earned']]);
  assert.deepEqual(ledger(sale({ status: 'voided', end_reason: 'pup_died', payments: pay })), []);
});

test('every combination: earned + anticipated is the sale\'s value less the credited fee, and what\'s owed is the statement\'s remaining', () => {
  const SCHEDULES = [undefined, [{ id: 'a', due: 'at_weeks', n: 8, covers: ['price', 'extras'], percent: 50 }, final],
    [{ id: 'a', due: 'on_date', due_date: '2026-12-01', covers: ['all'], amount: 600, prior_funds: 'dont_count' }, final]];
  const EXTRAS = [[], [{ id: 'x', label: 'Stay', amount: 900 }], [{ id: 'ph', label: 'Photos', amount: 150, own_due_dates: true }]];
  const FEES = [null, { amount: 300, toward: 'deposit', date: '2026-08-01' }, { amount: 700, toward: 'deposit', date: '2026-08-01' }];
  const CREDITS = [[], [credit(800, '2026-09-01')], [credit(300, '2026-09-01', ['price', 'extras']), credit(5000, '2026-10-01')]];
  const PAYMENTS = [[], [{ id: 'p1', amount: 300, date: '2026-10-25' }, { id: 'p2', amount: 700, date: '2026-11-20' }], [{ id: 'p1', amount: 10000, date: '2026-11-05' }]];
  for (const status of ['deposit_pending', 'deposit_paid', 'paid_in_full', 'delivered'])
  for (const schedule of SCHEDULES) for (const extras of EXTRAS) for (const fee of FEES) for (const credits of CREDITS) for (const payments of PAYMENTS) {
    const s = sale({ status, deposit_date: status === 'deposit_pending' ? null : '2026-10-20', payment_schedule: schedule, extra_charges: extras, payments, transport_fee: 250 });
    const st = paymentStatement(s, opts({ feeCredit: fee, credits, depositDueDate: '2026-10-15' }));
    const cs = ledgerComponents(s, st, { today: TODAY });
    const at = `${status} ${schedule?.length} ${extras[0]?.id} ${fee?.amount} ${credits.length} ${payments.length}`;
    const feePaid = sum(st.received.filter((r) => r.kind === 'fee').flatMap((r) => r.pays));
    assert.equal(sum(cs), r2(st.total - feePaid), at);
    assert.equal(sum(cs.filter((c) => c.state === 'anticipated' && !c.credited)), st.remaining, at);
    assert.ok(cs.every((c) => c.amount > 0 && c.when), at);
  }
});

test('paidOnSale: what it read before when nothing was recorded; recorded payments now count', () => {
  for (const status of ['deposit_pending', 'deposit_paid', 'paid_in_full', 'delivered'])
  for (const fee of [0, { amount: 300, toward: 'deposit' }, { amount: 100, toward: 'balance' }]) {
    const s = sale({ status, deposit_date: status === 'deposit_pending' ? null : '2026-10-20', transport_fee: 200, extra_charges: [{ id: 't', label: 'Training', amount: 600, payments: [{ id: 'a', percent: 50, due: 'on_approval', due_date: '2026-11-01', paid_date: '2026-11-01' }, { id: 'b', percent: 50, due: 'with_balance' }] }] });
    const before = sum(incomeLineItems('sale', s, { feeCredit: fee }).filter((c) => c.state === 'earned'));
    assert.equal(paidOnSale(s, { feeCredit: fee }), before, `${status} ${JSON.stringify(fee)}`);
  }
  const s = sale({ payments: [{ id: 'p1', amount: 400, date: '2026-11-05' }] });
  assert.equal(paidOnSale(s), 900);
  assert.equal(paidOnSale({ ...s, status: 'voided', end_reason: 'pup_died' }), 900, 'a lost sale still says what was paid on it');
  // Credits count toward what money hasn't paid (a balance due), never twice.
  const entry = { received_credits: [credit(700, '2026-09-01')] };
  const f = familyCredit(entry, s);
  assert.equal(paidOnSale(s, { received: f.received }), 900 + 200, '$500 of the credit is on the deposit, already paid; $200 on the price');
});

test('Receivables: a sale is one row per due date, with its own Due by; credited money isn\'t owed', () => {
  const s = sale({
    status: 'deposit_pending', deposit_date: null, transport_fee: 300,
    payment_schedule: [{ id: 'half', due: 'at_weeks', n: 8, covers: ['price'], percent: 50 }, final]
  });
  const components = ledger(s, { credits: [credit(200, '2026-09-01', ['price'])], depositDueDate: '2026-11-20' });
  const row = { source_type: 'sale', source_id: 's1', counterparty: 'Jo', dog: 'Wren', href: 'sale.html?id=s1', components };
  const rows = receivableRows(incomeEntries([row]), TODAY);
  // The deposit $500 (Nov 20); half the price by Nov 26 is $1,250 less the deposit's
  // $500 asked first and the $200 credit = $550; the rest of the price and transport at pickup.
  assert.deepEqual(rows.map((r) => [r.due, r.amount, r.components]), [
    ['2026-11-20', 500, ['deposit']], ['2026-11-26', 550, ['balance']], [PICKUP, 1550, ['balance', 'transport']]
  ]);
  assert.equal(sum(rows), paymentStatement(s, opts({ credits: [credit(200, '2026-09-01', ['price'])], depositDueDate: '2026-11-20' })).remaining);
});
