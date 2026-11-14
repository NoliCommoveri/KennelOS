// familyPayments.test.js — a family's payments as their own pages show them
// (Payment Schedule plan §7): paymentSchedule.familyPaymentsView over the sale's
// statement, the projection's Payments card and the turn card's deposit, and the
// statements the projection is given (incomeView.getSaleStatements) read exactly as
// her own Payments card reads them.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { paymentStatement, familyPaymentsView, nextPaymentText } from '../shared/data/paymentSchedule.js';
import { buildProjection } from '../shared/data/waitlistProjection.js';

const cents = (n) => Math.round(n * 100) / 100;
const sum = (xs, f) => cents(xs.reduce((t, x) => t + f(x), 0));

const sale = (extra = {}) => ({
  id: 's1', dog_id: 'p1', buyer_contact_id: 'c1', kennel_id: 'k1', status: 'deposit_paid',
  price: 3000, deposit_amount: 500, deposit_date: '2026-10-01', transport_fee: 200, ...extra
});
const credit = (id, amount, date, applies_to = ['fee', 'deposit', 'price', 'extras']) => ({ id, amount, date, applies_to });

// The checks every view must pass.
function checkView(st) {
  const v = familyPaymentsView(st);
  if (!v) return v;
  assert.equal(cents(v.paid + v.remaining), v.total, 'paid + remaining = total');
  assert.equal(sum(v.received, (r) => r.amount), v.paid, 'what was received adds up to paid');
  const owed = cents((v.deposit?.owed || 0) + sum(v.due, (d) => d.owed) + sum(v.own, (o) => o.owed));
  assert.equal(owed, v.remaining, 'what each date still asks adds up to remaining');
  for (const r of v.received) assert.ok(r.amount > 0, 'never a $0 line');
  assert.ok(v.due.length >= 1 && v.due[v.due.length - 1].final, 'the last due date is the final payment');
  const nexts = [v.deposit, ...v.due, ...v.own].filter((x) => x && x.state === 'next');
  assert.ok(nexts.length <= 1, 'one next payment at most');
  if (v.next) assert.equal(nexts.length, 1, 'the next payment is marked on its own row');
  return v;
}

test('a plain sale: the deposit paid, everything else at pickup', () => {
  const st = paymentStatement(sale(), { today: '2026-10-15', pickupDate: '2026-12-01' });
  const v = checkView(st);
  assert.deepEqual(v.deposit, { amount: 500, owed: 0, date: '2026-10-01', state: 'met' });
  assert.equal(v.due.length, 1);
  assert.deepEqual(v.due[0], { label: 'Final payment', date: '2026-12-01', at_pickup: true, amount: 2700, owed: 2700, final: true, state: 'next' });
  assert.deepEqual(v.next, { label: 'Final payment', date: '2026-12-01', at_pickup: true, owed: 2700, final: true, deposit: false });
  assert.deepEqual(v.received, [{ date: '2026-10-01', label: 'Deposit', amount: 500 }]);
  assert.equal(nextPaymentText(st, { money: (n) => `$${n}` }), '$2700 by 2026-12-01');
});

test('credits and the credited application fee show as the lines they paid, "(credited)"; the fee itself and leftover credit don\'t', () => {
  // A $50 fee credited toward the deposit; a $300 credit for funds received, $40 of
  // it paying an unpaid application fee first (credits pay the fee before the sale).
  const st = paymentStatement(sale({ deposit_date: null, status: 'deposit_pending' }), {
    today: '2026-10-15', pickupDate: '2026-12-01',
    feeCredit: { amount: 50, toward: 'deposit', date: '2026-09-01' },
    credits: [credit('cr1', 300, '2026-08-01')], feeCharges: [{ key: 'fee', amount: 40 }], depositDueDate: '2026-10-20'
  });
  const v = checkView(st);
  assert.deepEqual(v.received, [
    { date: '2026-08-01', label: 'Deposit (credited)', amount: 260 },
    { date: '2026-09-01', label: 'Deposit (credited)', amount: 50 }
  ], 'the credit\'s $40 on the fee is not money on the sale');
  assert.equal(v.paid, 310);
  assert.deepEqual(v.deposit, { amount: 500, owed: 190, date: '2026-10-20', state: 'next' });
  assert.equal(v.next.deposit, true);
  assert.equal(nextPaymentText(st, { money: (n) => `$${n}` }), '$190 for the deposit, by 2026-10-20');
});

test('a credit not ticked for the deposit pays the price, and counts as earlier money on a schedule', () => {
  const schedule = [
    { id: 'a', due: 'on_date', due_date: '2026-11-01', covers: ['price'], percent: 50, basis: 'total' },
    { id: 'b', due: 'on_date', due_date: '2026-11-15', covers: ['all'], amount: 300, prior_funds: 'dont_count' },
    { id: 'z', due: 'at_pickup', covers: ['all'], percent: 100, basis: 'total' }
  ];
  const st = paymentStatement(sale({ payment_schedule: schedule }), {
    today: '2026-11-05', pickupDate: '2026-12-01', credits: [credit('cr1', 1200, '2026-07-01', ['price'])]
  });
  const v = checkView(st);
  // 50% of $3,000 = $1,500 by Nov 1: the deposit ($500) and the credit ($1,000 of it).
  assert.equal(v.due[0].owed, 0);
  assert.equal(v.due[0].state, 'met');
  // The $300 "new payments only" isn't touched by the credit's last $200.
  assert.equal(v.due[1].owed, 300);
  assert.equal(v.due[1].state, 'next');
  assert.ok(v.received.some((r) => r.label === 'Remaining Purchase Price (credited)' && r.amount === 1200));
});

test('a date gone by without the payment marked received is "past"; an ended sale shows nothing', () => {
  const schedule = [
    { id: 'a', due: 'on_date', due_date: '2026-11-01', covers: ['all'], amount: 1000, prior_funds: 'count' },
    { id: 'b', due: 'on_date', due_date: '2026-11-20', covers: ['all'], amount: 500, prior_funds: 'count' },
    { id: 'z', due: 'on_date', due_date: '2026-12-15', covers: ['all'], percent: 100, basis: 'total' }
  ];
  const st = paymentStatement(sale({ payment_schedule: schedule }), { today: '2026-11-25' });
  const v = checkView(st);
  assert.equal(v.due[0].state, 'next', 'the oldest owed date is the next payment');
  assert.equal(v.due[1].state, 'past', 'a later one gone by reads "Was due"');
  assert.equal(v.due[2].state, 'later');
  assert.equal(familyPaymentsView(paymentStatement(sale({ status: 'cancelled' }), {})), null);
  assert.equal(familyPaymentsView(paymentStatement({ id: 'x', status: 'deposit_pending' }, {})), null, 'nothing on it');
});

test('payments recorded and an overpayment: never more than the sale asks', () => {
  const st = paymentStatement(sale({ payments: [{ id: 'p1', amount: 1000, date: '2026-10-20' }, { id: 'p2', amount: 5000, date: '2026-11-01', method: 'Zelle', note: 'her note' }] }), { today: '2026-11-02' });
  const v = checkView(st);
  assert.equal(v.remaining, 0);
  assert.equal(v.next, null);
  assert.equal(JSON.stringify(v).includes('her note'), false);
  assert.equal(JSON.stringify(v).includes('Zelle'), false, 'how a payment was made stays hers');
  assert.ok(v.received.some((r) => r.label === 'Transport Fee'), 'transport is paid last, by the overpayment');
});

// --- The projection -----------------------------------------------------------------

const TODAY = '2026-11-02';
const kennel = { id: 'k1', public_id: 'kos1_11111111-2222-4333-8444-555555555555', kennel_name: 'Thornfield', final_payment_methods: 'Cash or Zelle only',
  waitlist_config: { fee_amount: 300, payment_instructions: 'Venmo @thornfield', respond_days: 3, max_passes: 2, auto_offer_on: [], fee_credit_toward: 'deposit' } };
const litter = { id: 'l1', kennel_id: 'k1', status: 'whelped', whelp_date: '2026-09-01', picks_opened_date: '2026-10-25' };
const dogs = [{ id: 'p1', litter_id: 'l1', call_name: 'Pip', sex: 'male', kennel_id: 'k1', disposition: 'placed' },
  { id: 'p2', litter_id: 'l1', call_name: 'Dot', sex: 'female', kennel_id: 'k1', disposition: 'available' }];
const baseEntry = { kennel_id: 'k1', approved_date: '2026-01-01', fee_received_date: '2026-01-05', fee_amount: 300, fee_credit_policy: 'credited_to_purchase' };

function projection(statements) {
  const placedSale = sale({ id: 's1', dog_id: 'p1', buyer_contact_id: 'c1' });
  const pickSale = sale({ id: 's2', dog_id: 'p2', buyer_contact_id: 'c2', status: 'deposit_pending', deposit_date: null });
  const entries = [
    { ...baseEntry, id: 'e1', status: 'placed', contact_id: 'c1', placed_sale_id: 's1' },
    { ...baseEntry, id: 'e2', status: 'active', contact_id: 'c2', received_credits: [credit('cr1', 100, '2026-06-01')] },
    { ...baseEntry, id: 'e3', status: 'active', contact_id: 'c3' }
  ];
  const offers = [{ id: 'o2', entry_id: 'e2', litter_id: 'l1', kennel_id: 'k1', outcome: 'open', offered_date: '2026-11-01', respond_by_date: '2026-11-04', eligible_dog_ids: ['p2'], chosen_dog_id: 'p2', sale_id: 's2' }];
  const contacts = ['c1', 'c2', 'c3'].map((id) => ({ id, name: `Family ${id}`, email: `${id}@example.com` }));
  return buildProjection({ kennel, entries, offers, litters: [litter], dogs, sales: [placedSale, pickSale], contacts, today: TODAY, statements: statements({ placedSale, pickSale }) });
}

test('the projection: a Payments card for each family with an open sale, from the statement it was given', () => {
  const p = projection(({ placedSale, pickSale }) => new Map([
    ['s1', paymentStatement(placedSale, { today: TODAY, feeCredit: { amount: 300, toward: 'deposit', date: '2026-01-05' } })],
    ['s2', paymentStatement(pickSale, { today: TODAY, feeCredit: { amount: 300, toward: 'deposit', date: '2026-01-05' }, credits: [credit('cr1', 100, '2026-06-01')], depositDueDate: '2026-11-04' })]
  ]));
  const e1 = p.entries.e1.payments;
  assert.equal(e1.how_to_pay, 'Venmo @thornfield');
  assert.equal(e1.final_methods, 'Cash or Zelle only');
  assert.equal(e1.total, 3200, 'price and transport');
  assert.equal(e1.paid, 500, 'the fee credited toward the deposit and the deposit\'s rest');
  assert.deepEqual(e1.received.map((r) => r.label), ['Deposit (credited)', 'Deposit']);
  // The pick awaiting its deposit: its card, and the turn card's deposit, from one statement.
  const e2 = p.entries.e2;
  assert.equal(e2.payments.deposit.owed, 100, '$500 less the $300 fee and the $100 credit');
  assert.equal(e2.offers[0].deposit_amount, 500);
  assert.equal(e2.offers[0].deposit_fee_credit, 300);
  assert.equal(e2.offers[0].deposit_credit, 100);
  assert.equal('payments' in p.entries.e3, false, 'no sale, no card');
});

test('the projection without statements: no card, and the turn card\'s deposit worked out as before', () => {
  const p = projection(() => new Map());
  assert.equal('payments' in p.entries.e1, false);
  assert.equal(p.entries.e2.offers[0].deposit_fee_credit, 300);
  assert.equal(p.entries.e2.offers[0].deposit_credit, 100);
});

// --- Loaded as her own page loads them ----------------------------------------------

let saleRepo, getSaleStatement, getSaleStatements;
before(async () => {
  await installMemoryDb();
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ getSaleStatement, getSaleStatements } = await import('../shared/data/incomeView.js'));
  const { seedSampleData } = await import('../shared/data/sampleData.js');
  await seedSampleData();
});

test('getSaleStatements reads every sample sale exactly as getSaleStatement does', async () => {
  const sales = await saleRepo.getAll({ includeArchived: true });
  assert.ok(sales.length > 3);
  const all = await getSaleStatements(sales, { today: '2026-11-13' });
  assert.equal(all.size, sales.length);
  for (const s of sales) {
    assert.deepEqual(all.get(s.id), (await getSaleStatement(s.id, { today: '2026-11-13' })).statement, s.id);
    checkView(all.get(s.id));
  }
  assert.equal((await getSaleStatements([])).size, 0);
});

// --- Companion and the deposit message read the same statement --------------------------

test('Companion: each pup\'s balance and due dates are the statement\'s, the old fields kept for older shells', async () => {
  const { buildFamilyBundle } = await import('../shared/data/companionExport.js');
  const { contactRepo } = await import('../shared/data/contactRepo.js');
  const { dogRepo } = await import('../shared/data/dogRepo.js');
  const { isOpenSale } = await import('../shared/data/vocab.js');
  const sales = (await saleRepo.getAll()).filter((s) => s.buyer_contact_id && s.dog_id && isOpenSale(s));
  let checked = 0;
  for (const s of sales) {
    const b = await buildFamilyBundle(await contactRepo.getById(s.buyer_contact_id));
    const dog = await dogRepo.getById(s.dog_id);
    const pup = b.pups.find((p) => p.callName === (dog?.call_name || ''));
    const v = familyPaymentsView((await getSaleStatement(s.id)).statement);
    if (!pup || !v) continue;
    checked++;
    assert.equal(pup.remainingBalance, v.remaining, 'remainingBalance is the statement\'s');
    assert.deepEqual(pup.payments.due, v.due);
    assert.equal(pup.balanceDueDate, v.due.find((d) => d.final).date || s.balance_due_date || null);
    assert.deepEqual(Object.keys(pup.payments).sort(), ['deposit', 'due', 'finalMethods', 'next', 'own', 'paid', 'received', 'remaining', 'total']);
  }
  assert.ok(checked > 0, 'some sample family has payments');
});

test('the deposit message (K8-1): the deposit after credits, the balance after the deposit, the schedule in words', async () => {
  const { depositMessageMoney, depositRequestMessage } = await import('../shared/data/depositRequest.js');
  const money = (n) => `$${n}`;
  const opts = { today: '2026-10-15', pickupDate: '2026-12-01', depositDueDate: '2026-10-20' };
  // Paid deposit: the balance is everything after it, never the deposit taken off twice.
  const paid = depositMessageMoney(paymentStatement(sale(), opts), { money, depositDate: '2026-10-01' });
  assert.deepEqual(paid, { deposit: '$500', depositCredit: '', depositPaid: '2026-10-01', balance: '$2700', balanceDue: '2026-12-01', schedule: '' });
  // The application fee credited toward the deposit: $450 to send, said so.
  const fee = depositMessageMoney(paymentStatement(sale({ deposit_date: null, status: 'deposit_pending' }), { ...opts, feeCredit: { amount: 50, toward: 'deposit', date: '2026-09-01' } }), { money });
  assert.deepEqual(fee, { deposit: '$450', depositCredit: '$50', depositPaid: false, balance: '$2700', balanceDue: '2026-12-01', schedule: '' });
  const body = depositRequestMessage({ ...fee, depositDue: 'Oct 20', finalMethods: 'Cash only' }).body;
  assert.match(body, /Deposit: \$450 \(after \$50 already credited\), due by Oct 20\./);
  assert.match(body, /The balance of \$2700 is due by 2026-12-01\./);
  assert.match(body, /For the final payment: Cash only/);
  // With a schedule: what follows, in words, in place of one balance.
  const sched = sale({ deposit_date: null, status: 'deposit_pending',
    payment_schedule: [{ id: 'a', due: 'on_date', due_date: '2026-11-01', covers: ['price'], percent: 50, basis: 'total' }, { id: 'b', due: 'at_pickup', covers: ['all'], percent: 100, basis: 'total' }] });
  const m = depositMessageMoney(paymentStatement(sched, opts), { money });
  assert.equal(m.deposit, '$500');
  assert.match(m.schedule, /^\$1000 by 2026-11-01 .*; the rest by 2026-12-01$/);
  assert.match(depositRequestMessage(m).body, /After the deposit: \$1000 by 2026-11-01/);
  assert.doesNotMatch(depositRequestMessage(m).body, /The balance of/);
});
