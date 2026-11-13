// paymentSchedule.test.js — a sale's payment schedule and money statement
// (data/paymentSchedule.js, Payment Schedule plan §3–§4): one named case per pattern
// the plan lists (§2), the four due-date kinds, transport last, labels, and a
// generated test over every combination of fee credit, credits, deposit, payments,
// schedule, extras, transport/boarding and status, checking the statement always
// adds up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  paymentStatement, cleanSchedule, defaultSchedule, scheduleOf, dueDateOf, saleCharges, coveredTotal,
  allocateMoney, scheduleSummary, coversText, scheduleProblem, readSchedule, savedSchedules, readSavedSchedules,
  scheduleFromSaved, newPayment, paymentsWith, addedFees, paidInFullOffer, finalDueDate
} from '../shared/data/paymentSchedule.js';
import { creditsOf, feeCharge, CREDIT_USE_VALUES } from '../shared/data/receivedCredits.js';
import { incomeLineItems } from '../shared/data/incomeView.js';

const TODAY = '2026-11-13';
const BIRTH = '2026-10-01'; // 7 weeks = Nov 19, 8 weeks = Nov 26, 9 weeks = Dec 3
const PICKUP = '2026-12-24';
const opts = (o = {}) => ({ birthDate: BIRTH, pickupDate: PICKUP, today: TODAY, ...o });
const sale = (o = {}) => ({ id: 's1', status: 'deposit_paid', price: 2500, deposit_amount: 500, deposit_date: '2026-10-20', ...o });
const credit = (amount, date, applies_to = CREDIT_USE_VALUES, id = `c${amount}`) => ({ id, amount, date, applies_to });
const sum = (xs, f = (x) => x) => Math.round(xs.reduce((t, x) => t + f(x), 0) * 100) / 100;
const final = { id: 'final', due: 'at_pickup', covers: ['all'], percent: 100, basis: 'total' };

// --- The schedule as stored -----------------------------------------------------------

test('cleanSchedule: bad steps dropped, a final step added when missing, kinds defaulted', () => {
  assert.equal(cleanSchedule(null), null);
  assert.equal(cleanSchedule([{ due: 'nope', covers: ['all'], percent: 50 }]), null);
  const s = cleanSchedule([
    { id: 'a', due: 'at_weeks', n: 8, covers: ['price', 'extra:x'], percent: 50 },
    { id: 'b', due: 'on_date', due_date: '2026-12-01', covers: ['all'], amount: 300 },
    { id: 'c', due: 'at_pickup', covers: [], percent: 10 }, // no covers → dropped
    { id: 'd', due: 'at_pickup', covers: ['all'] }          // neither percent nor amount → dropped
  ]);
  assert.deepEqual(s.map((x) => x.id), ['a', 'b', 'final']);
  assert.equal(s[0].basis, 'total');
  assert.equal(s[1].prior_funds, 'count');
  assert.deepEqual(s[2], final);
});

test('no schedule stored: one due date, everything, on the balance due date, else at pickup', () => {
  assert.deepEqual(defaultSchedule({ balance_due_date: '2026-12-10' }), [{ id: 'final', due: 'on_date', due_date: '2026-12-10', covers: ['all'], percent: 100, basis: 'total' }]);
  assert.deepEqual(scheduleOf({}), [final]);
  const st = paymentStatement(sale({ balance_due_date: '2026-12-10' }), opts());
  assert.equal(st.hasSchedule, false);
  assert.equal(st.dueDates.length, 1);
  assert.equal(st.dueDates[0].date, '2026-12-10');
  assert.equal(st.dueDates[0].ask, 2000);
  assert.equal(st.dueDates[0].owed, 2000);
});

test('dueDateOf: ages follow the birth date and pickup follows the pickup date, until she types a date', () => {
  assert.equal(dueDateOf({ due: 'at_weeks', n: 7 }, { birthDate: BIRTH }), '2026-11-19');
  assert.equal(dueDateOf({ due: 'at_weeks', n: 7 }, { birthDate: '2026-10-08' }), '2026-11-26');
  assert.equal(dueDateOf({ due: 'at_weeks', n: 7, due_date: '2026-11-30' }, { birthDate: BIRTH }), '2026-11-30');
  assert.equal(dueDateOf({ due: 'before_pickup', n: 3 }, { pickupDate: PICKUP }), '2026-12-21');
  assert.equal(dueDateOf({ due: 'at_pickup' }, { pickupDate: PICKUP }), PICKUP);
  assert.equal(dueDateOf({ due: 'at_weeks', n: 7 }, {}), null);
  assert.equal(dueDateOf({ due: 'on_date' }, {}), null);
});

// --- The patterns (plan §2) ------------------------------------------------------------

test('everything at pickup (today\'s default): the rest of the price, due at pickup', () => {
  const st = paymentStatement(sale(), opts());
  assert.equal(st.total, 2500);
  assert.equal(st.paid, 500);
  assert.equal(st.remaining, 2000);
  assert.equal(st.dueDates[0].date, PICKUP);
  assert.deepEqual(st.next, { kind: 'schedule', id: 'final', label: 'Final payment', date: PICKUP, owed: 2000, isFinal: true });
});

test('everything by an age (a transported pup): due at 7 weeks', () => {
  const st = paymentStatement(sale({ transport_fee: 300, payment_schedule: [{ id: 'w7', due: 'at_weeks', n: 7, covers: ['all'], percent: 100 }] }), opts());
  assert.equal(st.dueDates.length, 1);
  assert.equal(st.dueDates[0].date, '2026-11-19');
  assert.equal(st.dueDates[0].ask, 2300);
  assert.equal(st.dueDates[0].status, 'due_soon');
});

test('50% of price + a stay package by 8 weeks, counting everything paid, the rest at pickup', () => {
  const s = sale({
    extra_charges: [{ id: 'pkg', label: '12-week stay', amount: 1200 }],
    payment_schedule: [{ id: 'w8', due: 'at_weeks', n: 8, covers: ['price', 'extra:pkg'], percent: 50 }, final]
  });
  let st = paymentStatement(s, opts());
  const [w8, fin] = st.dueDates;
  assert.equal(w8.coveredTotal, 3700);
  assert.equal(w8.threshold, 1850);
  assert.equal(w8.ask, 1350, 'the deposit already paid counts toward the 50%');
  assert.equal(w8.date, '2026-11-26');
  assert.equal(fin.ask, 1850);
  // A family that paid early owes less by 8 weeks.
  st = paymentStatement({ ...s, payments: [{ id: 'p1', amount: 400, date: '2026-11-01' }] }, opts());
  assert.equal(st.dueDates[0].owed, 950);
  assert.equal(st.dueDates[1].owed, 1850);
  assert.equal(st.remaining, 2800);
});

test('the price by 9 weeks, boarding by the day at pickup', () => {
  const st = paymentStatement(sale({
    deferred_boarding_amount: 20, deferred_boarding_duration_days: '10',
    payment_schedule: [{ id: 'w9', due: 'at_weeks', n: 9, covers: ['price', 'transport', 'extras'], percent: 100 }, final]
  }), opts());
  assert.equal(st.dueDates[0].ask, 2000);
  assert.equal(st.dueDates[0].date, '2026-12-03');
  assert.equal(st.dueDates[1].ask, 200, 'only the boarding is left for pickup');
});

test('a dollar payment that earlier money can, or can\'t, cover', () => {
  const credits = [credit(400, '2026-09-01', ['price', 'extras'])];
  const sched = (prior_funds) => sale({ payment_schedule: [{ id: 'd1', due: 'on_date', due_date: '2026-12-01', covers: ['all'], amount: 500, prior_funds }, final] });
  let st = paymentStatement(sched('count'), opts({ credits }));
  assert.equal(st.dueDates[0].owed, 100, 'the $400 credit covers most of it');
  st = paymentStatement(sched('dont_count'), opts({ credits }));
  assert.equal(st.dueDates[0].owed, 500, 'the credit skips it…');
  assert.equal(st.dueDates[1].owed, 1100, '…and goes to the final payment');
  assert.equal(st.remaining, 1600);
  st = paymentStatement({ ...sched('dont_count'), payments: [{ id: 'p', amount: 500, date: '2026-11-20' }] }, opts({ credits }));
  assert.equal(st.dueDates[0].owed, 0, 'a payment recorded on the sale covers it');
});

test('percent of remaining: measured against what earlier due dates asked, new money only', () => {
  const s = sale({ price: 3000, payment_schedule: [{ id: 'r', due: 'at_weeks', n: 8, covers: ['price'], percent: 50, basis: 'remaining' }, final] });
  let st = paymentStatement(s, opts());
  assert.equal(st.dueDates[0].ask, 1250, '50% of the 2,500 left after the deposit');
  st = paymentStatement(s, opts({ credits: [credit(300, '2026-09-01')] }));
  assert.equal(st.dueDates[0].ask, 1250);
  assert.equal(st.dueDates[0].owed, 1250, 'a credit is earlier money: it doesn\'t count');
  st = paymentStatement({ ...s, payments: [{ id: 'p', amount: 2000, date: '2026-11-01' }] }, opts());
  assert.equal(st.dueDates[0].ask, 1250, 'paying early doesn\'t shrink it (D19)');
  assert.equal(st.dueDates[0].owed, 0);
  assert.equal(st.dueDates[1].owed, 500);
});

test('earlier money with nowhere else to go covers a "doesn\'t count" due date last', () => {
  const s = sale({ price: 1000, deposit_amount: 0, deposit_date: null, status: 'deposit_pending',
    payment_schedule: [{ id: 'd', due: 'on_date', due_date: '2026-12-01', covers: ['all'], amount: 400, prior_funds: 'dont_count' }, final] });
  const st = paymentStatement(s, opts({ credits: [credit(1000, '2026-09-01')] }));
  assert.equal(st.remaining, 0);
  assert.equal(st.dueDates[0].owed, 0, 'nothing is shown owed once everything is paid');
});

// --- Which charge money pays ----------------------------------------------------------

test('payments pay price, boarding, extras, then transport last (D16)', () => {
  const st = paymentStatement(sale({
    price: 2000, transport_fee: 200, deferred_boarding_amount: 50,
    extra_charges: [{ id: 'x', label: 'Photos', amount: 100 }],
    payments: [{ id: 'p', amount: 1700, date: '2026-11-10' }]
  }), opts());
  const pay = st.received.find((r) => r.kind === 'payment');
  assert.deepEqual(pay.pays.map((p) => [p.key, p.amount]), [['balance', 1500], ['boarding', 50], ['extra:x', 100], ['transport', 50]]);
});

test('payments never pay the deposit or an extra on its own dates; extra money is unapplied', () => {
  const st = paymentStatement(sale({
    status: 'deposit_pending', deposit_date: null, price: 1000,
    extra_charges: [{ id: 'ph', label: 'Photos', amount: 150, own_due_dates: true }],
    payments: [{ id: 'p', amount: 900, date: '2026-11-10' }]
  }), opts());
  const pay = st.received.find((r) => r.kind === 'payment');
  assert.deepEqual(pay.pays.map((p) => p.key), ['balance']);
  assert.equal(pay.unapplied, 400);
  assert.equal(st.deposit.owed, 500);
  assert.equal(st.ownDated[0].owed, 150);
  assert.equal(st.ownDated[0].date, PICKUP, 'an own-dated extra with no steps is due with the final payment');
});

test('a payment toward an own-dated step pays only that step', () => {
  const s = sale({
    extra_charges: [{ id: 'tr', label: 'Training', amount: 600, payments: [
      { id: 'a', percent: 50, due: 'on_approval', due_date: '2026-11-15' }, { id: 'b', percent: 50, due: 'before_pickup', n: 2 }] }],
    payments: [{ id: 'p', amount: 300, date: '2026-11-14', toward: 'extra:tr:a' }]
  });
  const st = paymentStatement(s, opts());
  assert.deepEqual(st.ownDated.map((o) => [o.key, o.owed, o.date]), [['extra:tr:a', 0, '2026-11-15'], ['extra:tr:b', 300, '2026-12-22']]);
  assert.equal(st.dueDates[0].owed, 2000, 'the schedule is untouched by it');
});

test('an extra a due date names is paid through the schedule, its own steps unused', () => {
  const s = sale({
    extra_charges: [{ id: 'tr', label: 'Training', amount: 600, payments: [{ id: 'a', percent: 100, due: 'with_balance' }] }],
    payment_schedule: [{ id: 'w8', due: 'at_weeks', n: 8, covers: ['extra:tr'], percent: 100 }, final]
  });
  const st = paymentStatement(s, opts());
  assert.equal(st.ownDated.length, 0);
  assert.equal(saleCharges(s, cleanSchedule(s.payment_schedule)).find((c) => c.key === 'extra:tr').part, 'schedule');
  assert.equal(coveredTotal(['extra:tr'], st.charges), 600);
});

test('no schedule: an extra with its own steps keeps them, as today', () => {
  const st = paymentStatement(sale({ extra_charges: [{ id: 'tr', label: 'Training', amount: 600, payments: [{ id: 'a', percent: 100, due: 'on_approval', due_date: '2026-11-20', paid_date: '2026-11-18' }] }] }), opts());
  assert.deepEqual(st.ownDated.map((o) => [o.owed, o.paid]), [[0, 600]]);
  assert.equal(st.received.find((r) => r.kind === 'step').date, '2026-11-18');
});

// --- Credits and the application fee ---------------------------------------------------

test('a credit covering the deposit labels it "Deposit (credited)"; the deposit itself sends only the rest', () => {
  const st = paymentStatement(sale(), opts({ credits: [credit(300, '2026-09-01')] }));
  const cr = st.received.find((r) => r.kind === 'credit');
  assert.deepEqual(cr.pays, [{ key: 'deposit', amount: 300, label: 'Deposit (credited)' }]);
  const dep = st.received.find((r) => r.kind === 'deposit');
  assert.equal(dep.amount, 200);
  assert.equal(dep.pays[0].label, 'Deposit');
});

test('the application fee credit: toward the deposit up to it, beyond it the price', () => {
  for (const [amount, toward, depositPart, balancePart] of [[50, 'balance', 0, 50], [300, 'deposit', 300, 0], [500, 'deposit', 500, 0], [700, 'deposit', 500, 200]]) {
    const st = paymentStatement(sale({ status: 'deposit_pending', deposit_date: null }), opts({ feeCredit: { amount, toward, date: '2026-08-01' } }));
    const fee = st.received.find((r) => r.kind === 'fee');
    const of = (k) => fee.pays.find((p) => p.key === k)?.amount || 0;
    assert.equal(of('deposit'), depositPart, `${amount} ${toward}`);
    assert.equal(of('balance'), balancePart, `${amount} ${toward}`);
    assert.ok(fee.pays.every((p) => p.label.endsWith('(credited)')));
    assert.equal(st.deposit.owed, 500 - depositPart);
  }
});

test('credits pay the application fee first, labelled "Application fee (credited)", and it stays off the sale total', () => {
  const entry = { fee_amount: 100, received_credits: [credit(250, '2026-08-01')] };
  const st = paymentStatement(sale({ status: 'deposit_pending', deposit_date: null }), opts({ credits: creditsOf(entry), feeCharges: feeCharge(entry) }));
  const cr = st.received.find((r) => r.kind === 'credit');
  assert.deepEqual(cr.pays.map((p) => [p.label, p.amount]), [['Application fee (credited)', 100], ['Deposit (credited)', 150]]);
  assert.deepEqual(st.fee, { charged: 100, credited: 100 });
  assert.equal(st.total, 2500);
  assert.equal(st.paid, 150);
});

test('allocateMoney: in order, each item only toward the uses it names', () => {
  const charges = [{ key: 'deposit', use: 'deposit', amount: 500 }, { key: 'balance', use: 'price', amount: 1500 }, { key: 'transport', use: 'extras', amount: 100 }];
  const a = allocateMoney([{ id: 'a', amount: 700 }, { id: 'b', amount: 2000, uses: ['extras'] }], charges);
  assert.deepEqual(a.byKey, { deposit: 500, balance: 200, transport: 100 });
  assert.deepEqual(a.perItem.b, [{ key: 'transport', amount: 100 }]);
});

// --- Status, next, ended sales, words -------------------------------------------------------

test('status and next: not received once the date passes; the deposit comes first while owed', () => {
  let st = paymentStatement(sale({ payment_schedule: [{ id: 'd', due: 'on_date', due_date: '2026-11-01', covers: ['all'], amount: 500 }, final] }), opts());
  assert.equal(st.dueDates[0].status, 'not_received');
  assert.equal(st.next.id, 'd');
  st = paymentStatement(sale({ status: 'deposit_pending', deposit_date: null }), opts({ depositDueDate: '2026-11-10' }));
  assert.deepEqual([st.next.kind, st.next.date, st.deposit.status], ['deposit', '2026-11-10', 'not_received']);
  st = paymentStatement(sale({ status: 'paid_in_full', balance_paid_date: '2026-11-12' }), opts());
  assert.equal(st.remaining, 0);
  assert.equal(st.next, null);
  assert.equal(st.received.find((r) => r.kind === 'paid_in_full').amount, 2000);
});

test('an ended sale: what was paid stands; nothing is owed', () => {
  const st = paymentStatement(sale({ status: 'cancelled', payments: [{ id: 'p', amount: 300, date: '2026-11-01' }] }), opts());
  assert.equal(st.ended, true);
  assert.equal(st.paid, 800);
  assert.equal(st.remaining, 0);
  assert.deepEqual(st.dueDates, []);
});

test('scheduleSummary and coversText', () => {
  const money = (n) => `$${n.toLocaleString('en-US')}`;
  const date = (d) => d;
  let st = paymentStatement(sale(), opts());
  assert.equal(scheduleSummary(st, { money, date }), `everything due ${PICKUP}`);
  st = paymentStatement(sale({ extra_charges: [{ id: 'pkg', label: 'Stay', amount: 1200 }], payment_schedule: [{ id: 'w8', due: 'at_weeks', n: 8, covers: ['price', 'extra:pkg'], percent: 50 }, final] }), opts());
  assert.equal(scheduleSummary(st, { money, date }), `$1,350 by 2026-11-26 (50% of purchase price and Stay); the rest by ${PICKUP}`);
  assert.equal(coversText(['all']), 'everything');
  assert.equal(coversText(['price', 'boarding', 'transport']), 'purchase price, boarding and transport');
});

// --- Today's numbers, unchanged ------------------------------------------------------------

test('no schedule, no payments, no credits: what\'s left is exactly what Financials anticipates today', () => {
  const extrasOf = { none: [], one: [{ id: 'x', label: 'Photos', amount: 150 }], steps: [{ id: 't', label: 'Training', amount: 600, payments: [{ id: 'a', percent: 50, due: 'on_approval', due_date: '2026-11-01', paid_date: '2026-11-01' }, { id: 'b', percent: 50, due: 'with_balance' }] }] };
  for (const status of ['deposit_pending', 'deposit_paid', 'paid_in_full', 'delivered'])
  for (const fee of [null, { amount: 50, toward: 'balance' }, { amount: 300, toward: 'deposit' }, { amount: 700, toward: 'deposit' }])
  for (const extras of Object.keys(extrasOf))
  for (const transport of [0, 200]) {
    const s = sale({ status, deposit_date: status === 'deposit_pending' ? null : '2026-10-20', transport_fee: transport, deferred_boarding_amount: 25, deferred_boarding_duration_days: '4', extra_charges: extrasOf[extras] });
    const st = paymentStatement(s, opts({ feeCredit: fee }));
    const anticipated = sum(incomeLineItems('sale', s, { feeCredit: fee || 0 }).filter((c) => c.state === 'anticipated'), (c) => c.amount);
    assert.equal(st.remaining, anticipated, `${status} ${JSON.stringify(fee)} ${extras} ${transport}`);
  }
});

// --- Every combination ------------------------------------------------------------------

const SCHEDULES = {
  none: undefined,
  byAge: [{ id: 'w7', due: 'at_weeks', n: 7, covers: ['all'], percent: 100 }],
  pctTotal: [{ id: 'a', due: 'at_weeks', n: 8, covers: ['price', 'extras'], percent: 50 }, final],
  pctRemaining: [{ id: 'a', due: 'at_weeks', n: 8, covers: ['price'], percent: 40, basis: 'remaining' }, final],
  amtCount: [{ id: 'a', due: 'on_date', due_date: '2026-11-01', covers: ['all'], amount: 600 }, final],
  amtFresh: [{ id: 'a', due: 'on_date', due_date: '2026-12-01', covers: ['all'], amount: 600, prior_funds: 'dont_count' }, final],
  mixed: [
    { id: 'a', due: 'on_date', due_date: '2026-11-01', covers: ['all'], amount: 300, prior_funds: 'dont_count' },
    { id: 'b', due: 'at_weeks', n: 8, covers: ['price', 'boarding'], percent: 60 },
    { id: 'c', due: 'before_pickup', n: 3, covers: ['price'], percent: 50, basis: 'remaining' },
    final
  ]
};
const EXTRAS = {
  none: [],
  onSchedule: [{ id: 'x', label: 'Stay', amount: 900 }],
  ownFlagged: [{ id: 'ph', label: 'Photos', amount: 150, own_due_dates: true }],
  ownSteps: [{ id: 't', label: 'Training', amount: 600, payments: [{ id: 'a', percent: 50, due: 'on_approval', due_date: '2026-11-01', paid_date: '2026-11-01' }, { id: 'b', percent: 50, due: 'before_pickup', n: 2 }] }]
};
const FEES = [null, { amount: 50, toward: 'balance', date: '2026-08-01' }, { amount: 300, toward: 'deposit', date: '2026-08-01' }, { amount: 500, toward: 'deposit', date: '2026-08-01' }, { amount: 700, toward: 'deposit', date: '2026-08-01' }];
const CREDITS = [[], [credit(200, '2026-09-01')], [credit(800, '2026-09-01')], [credit(300, '2026-09-01', ['price', 'extras']), credit(5000, '2026-10-01')]];
const PAYMENTS = [[], [{ id: 'p1', amount: 300, date: '2026-11-05' }], [{ id: 'p1', amount: 300, date: '2026-10-25' }, { id: 'p2', amount: 700, date: '2026-11-20' }], [{ id: 'p1', amount: 10000, date: '2026-11-05' }]];
const OTHER = [{}, { transport_fee: 250 }, { transport_fee: 250, deferred_boarding_amount: 20, deferred_boarding_duration_days: '10' }];
const STATUSES = ['deposit_pending', 'deposit_paid', 'paid_in_full', 'delivered', 'cancelled', 'voided'];

test('every combination: the statement always adds up', () => {
  let n = 0;
  for (const status of STATUSES)
  for (const fee of FEES)
  for (const credits of CREDITS)
  for (const payments of PAYMENTS)
  for (const sched of Object.keys(SCHEDULES))
  for (const extras of Object.keys(EXTRAS))
  for (const other of OTHER) {
    n++;
    const s = sale({ status, deposit_date: status === 'deposit_pending' ? null : '2026-10-20', payments, payment_schedule: SCHEDULES[sched], extra_charges: EXTRAS[extras], ...other });
    const st = paymentStatement(s, opts({ feeCredit: fee, credits, depositDueDate: '2026-10-15' }));
    const at = `${status} fee=${fee?.amount}/${fee?.toward} credits=${credits.length} pay=${payments.length} ${sched} ${extras} ${JSON.stringify(other)}`;
    const left = new Map(st.charges.map((c) => [c.key, c.amount]));
    for (const r of st.received) for (const p of r.pays) if (left.has(p.key)) left.set(p.key, Math.round((left.get(p.key) - p.amount) * 100) / 100);

    // Money adds up.
    assert.equal(st.total, sum(st.charges, (c) => c.amount), at);
    assert.equal(st.paid, sum(st.received.flatMap((r) => r.pays).filter((p) => p.key !== 'fee'), (p) => p.amount), at);
    for (const [key, v] of left) assert.ok(v >= 0, `${at}: ${key} overpaid`);
    for (const r of st.received) {
      assert.ok(r.amount >= 0 && r.unapplied >= 0, at);
      assert.equal(r.amount, sum(r.pays, (p) => p.amount), at);
      // A receipt's lines are exactly the money: never $0, never missing.
      for (const p of r.pays) assert.ok(p.amount > 0, `${at}: a $0 line`);
      if (['fee', 'credit'].includes(r.kind)) assert.ok(r.pays.every((p) => p.label.endsWith(' (credited)')), at);
      else assert.ok(r.pays.every((p) => !p.label.includes('(credited)')), at);
    }
    // The deposit receipt is never missing when a deposit was marked received and
    // anything was left of it to send.
    if (st.deposit === null && !st.ended && s.deposit_amount > 0) assert.fail(`${at}: no deposit`);

    if (st.ended) {
      assert.equal(st.remaining, 0, at);
      assert.deepEqual(st.dueDates, [], at);
      continue;
    }
    assert.equal(Math.round((st.paid + st.remaining) * 100) / 100, st.total, at);

    // Every due date: owed = what it asks − what it took; the asks add up to everything.
    for (const d of st.dueDates) {
      assert.ok(d.ask >= 0 && d.filled >= 0 && d.filled <= d.ask + 0.001, at);
      assert.equal(d.owed, Math.round((d.ask - d.filled) * 100) / 100, at);
      assert.ok(['met', 'upcoming', 'due_soon', 'not_received', 'no_date'].includes(d.status), at);
    }
    assert.equal(Math.round((st.deposit.amount + sum(st.dueDates, (d) => d.ask)) * 100) / 100, coveredTotal(['all'], st.charges), at);
    // Everything owed is somewhere: the deposit, a due date or an own-dated extra.
    assert.equal(Math.round((st.deposit.owed + sum(st.dueDates, (d) => d.owed) + sum(st.ownDated, (o) => o.owed)) * 100) / 100, st.remaining, at);

    // Earlier money never fills a "doesn't count" due date while a due date it may
    // cover is still owed.
    const newMoney = sum(st.received.filter((r) => ['payment', 'paid_in_full'].includes(r.kind)).flatMap((r) => r.pays).filter((p) => st.charges.find((c) => c.key === p.key)?.part === 'schedule'), (p) => p.amount);
    if (st.dueDates.some((d) => !d.fresh && d.owed > 0)) {
      assert.ok(sum(st.dueDates.filter((d) => d.fresh), (d) => d.filled) <= newMoney + 0.001, `${at}: earlier money filled a "doesn't count" due date`);
    }
    // Transport is paid by a payment only once everything else on the schedule is.
    const payPaidTransport = st.received.some((r) => ['payment', 'paid_in_full'].includes(r.kind) && r.pays.some((p) => p.key === 'transport'));
    if (payPaidTransport) {
      for (const c of st.charges.filter((x) => x.part === 'schedule' && x.key !== 'transport')) assert.equal(left.get(c.key), 0, `${at}: transport before ${c.key}`);
    }
    // Something owed means a next payment.
    if (st.remaining > 0) assert.ok(st.next && st.next.owed > 0, at);
    else assert.equal(st.next, null, at);
  }
  assert.equal(n, 40320);
});

// --- Editing (the schedule editor, saved schedules, payments, new fees) -------------------

test('scheduleProblem: what\'s missing, row by row; the last row is always everything at 100%', () => {
  const fin = { due: 'at_pickup', covers: ['all'], percent: 100, basis: 'total' };
  assert.equal(scheduleProblem([fin]), '');
  assert.equal(scheduleProblem([]), 'Add at least the final payment.');
  assert.match(scheduleProblem([{ due: 'nope', covers: ['all'], percent: 50 }, fin]), /Payment 1: choose when/);
  assert.match(scheduleProblem([{ due: 'at_weeks', n: '', covers: ['all'], percent: 50 }, fin]), /how many weeks/);
  assert.match(scheduleProblem([{ due: 'at_weeks', n: 0, covers: ['all'], percent: 50 }, fin]), /at least 1 week/);
  assert.match(scheduleProblem([{ due: 'on_date', covers: ['all'], percent: 50 }, fin]), /choose the date/);
  assert.match(scheduleProblem([{ due: 'at_pickup', covers: [], percent: 50 }, fin]), /tick what it covers/);
  assert.match(scheduleProblem([{ due: 'at_pickup', covers: ['price'], percent: 150 }, fin]), /1 to 100/);
  assert.match(scheduleProblem([{ due: 'at_pickup', covers: ['price'], percent: '', amount: 0 }, fin]), /amount above 0/);
  assert.match(scheduleProblem([{ due: 'at_pickup', covers: ['price'], percent: 50 }]), /everything left/);
  assert.match(scheduleProblem([{ ...fin, basis: 'remaining' }]), /everything left/);
  // Saved schedules: no typed dates, no single extras.
  assert.match(scheduleProblem([{ due: 'on_date', due_date: '2026-12-01', covers: ['all'], percent: 50 }, fin], { saved: true }), /can't use a date/);
  assert.match(scheduleProblem([{ due: 'at_weeks', n: 8, covers: ['extra:x'], percent: 50 }, fin], { saved: true }), /not one extra/);
});

test('readSchedule: cleaned, with ids kept or minted', () => {
  const { schedule, error } = readSchedule([
    { id: 'keep', due: 'at_weeks', n: '8', covers: ['price'], percent: '50', amount: '' },
    { due: 'on_date', due_date: '2026-12-01', covers: ['all'], percent: '', amount: '300', prior_funds: 'dont_count' },
    { due: 'at_pickup', covers: ['all'], percent: 100, basis: 'total' }
  ]);
  assert.equal(error, '');
  assert.equal(schedule[0].id, 'keep');
  assert.equal(schedule[0].n, 8);
  assert.equal(schedule[0].percent, 50);
  assert.ok(schedule[1].id && schedule[1].id !== 'keep');
  assert.deepEqual([schedule[1].amount, schedule[1].prior_funds], [300, 'dont_count']);
  assert.equal(schedule.length, 3);
  assert.equal(readSchedule([{ due: 'at_pickup', covers: ['price'], percent: 50 }]).schedule, null);
});

test('saved schedules: named, checked, copied onto a sale with ids of their own', () => {
  const steps = [{ id: 'a', due: 'at_weeks', n: 8, covers: ['price', 'extras'], percent: 50 }, { id: 'b', due: 'at_pickup', covers: ['all'], percent: 100, basis: 'total' }];
  const { list, error } = readSavedSchedules([{ name: 'Longer stay', steps }]);
  assert.equal(error, '');
  assert.equal(list[0].name, 'Longer stay');
  assert.ok(list[0].id);
  assert.match(readSavedSchedules([{ name: '', steps }]).error, /name/);
  assert.match(readSavedSchedules([{ name: 'A', steps }, { name: 'a', steps }]).error, /Two saved schedules/);
  assert.match(readSavedSchedules([{ name: 'A', steps: [steps[0]] }]).error, /"A": The final payment covers everything/);
  // Read back from a kennel: bad ones dropped, a stray typed date ignored.
  const kennel = { payment_schedules: [list[0], { id: 'x', name: '', steps }, { id: 'y', name: 'Dated', steps: [{ ...steps[1], due_date: '2026-12-01' }] }] };
  const back = savedSchedules(kennel);
  assert.deepEqual(back.map((x) => x.name), ['Longer stay', 'Dated']);
  assert.equal(back[1].steps[0].due_date, undefined);
  const copied = scheduleFromSaved(back[0]);
  assert.equal(copied.length, 2);
  assert.ok(copied.every((st, i) => st.id && st.id !== back[0].steps[i].id));
  assert.equal(savedSchedules(null).length, 0);
});

test('newPayment and paymentsWith: amount and date required; add, replace, remove by id', () => {
  const p = newPayment({ amount: '300', date: '2026-11-10', method: 'Zelle', account_id: '', note: ' ' });
  assert.deepEqual(Object.keys(p).sort(), ['amount', 'date', 'id', 'method']);
  assert.throws(() => newPayment({ amount: 0, date: '2026-11-10' }), /amount/);
  assert.throws(() => newPayment({ amount: 5, date: '' }), /date/);
  const sale = { payments: [{ id: 'a', amount: 100, date: '2026-11-01' }] };
  assert.equal(paymentsWith(sale, p).length, 2);
  assert.deepEqual(paymentsWith(sale, { id: 'a', amount: 150, date: '2026-11-01' }).map((x) => x.amount), [150]);
  assert.deepEqual(paymentsWith(sale, { id: 'a' }, { remove: true }), []);
  assert.equal(paymentsWith({}, p).length, 1);
});

test('addedFees: a transport fee set or raised, boarding added or raised, a new extra', () => {
  const before = { transport_fee: 100, deferred_boarding_amount: 20, deferred_boarding_duration_days: '5', extra_charges: [{ id: 'x', label: 'Photos', amount: 150 }] };
  assert.deepEqual(addedFees(before, before), []);
  assert.deepEqual(addedFees(before, { ...before, transport_fee: 80 }), [], 'a lower fee isn\'t a new fee');
  assert.deepEqual(addedFees(before, { ...before, transport_fee: 200 }).map((f) => f.kind), ['transport']);
  assert.deepEqual(addedFees(before, { ...before, deferred_boarding_duration_days: '9' }).map((f) => f.kind), ['boarding']);
  const more = addedFees(before, { ...before, extra_charges: [...before.extra_charges, { id: 'y', label: 'Training', amount: 600 }, { id: 'z', label: 'Video', amount: 75, own_due_dates: true }] });
  assert.deepEqual(more.map((f) => [f.kind, f.label, !!f.own]), [['extra', 'Training', false], ['extra', 'Video', true]]);
  assert.deepEqual(addedFees(null, { transport_fee: 50 }).map((f) => f.kind), ['transport'], 'a new sale with a fee');
});

test('paidInFullOffer: only once everything is paid and the sale isn\'t already marked', () => {
  let s = sale({ price: 1000, deposit_amount: 500, payments: [{ id: 'p', amount: 500, date: '2026-11-11' }] });
  assert.deepEqual(paidInFullOffer(paymentStatement(s, opts()), s), { date: '2026-11-11' });
  s = { ...s, payments: [{ id: 'p', amount: 400, date: '2026-11-11' }] };
  assert.equal(paidInFullOffer(paymentStatement(s, opts()), s), null);
  s = sale({ price: 1000, status: 'paid_in_full', balance_paid_date: '2026-11-12' });
  assert.equal(paidInFullOffer(paymentStatement(s, opts()), s), null);
  s = sale({ price: 1000, status: 'cancelled' });
  assert.equal(paidInFullOffer(paymentStatement(s, opts()), s), null);
});

test('finalDueDate: the last due date\'s', () => {
  assert.equal(finalDueDate(paymentStatement(sale({ balance_due_date: '2026-12-10' }), opts())), '2026-12-10');
  assert.equal(finalDueDate(null), null);
});
