// paymentNudges.test.js — Payment Schedule plan build step 7: Today's payment-due and
// payment-missed nudges (data/nudges.js), extras on a schedule leaving extra-due,
// Review my waitlist reading them (data/waitlistReview.js), what's owed by a pickup
// day (paymentSchedule.owedBy) and the pickup message (goHome.pickupMessage).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { paymentStatement, owedBy, paidInFullChanges } from '../shared/data/paymentSchedule.js';
import { pickupMessage } from '../shared/data/goHome.js';
import { readNudgeKey, STEP_OF, reviewSummary } from '../shared/data/waitlistReview.js';
import { addDaysToYMD, todayYMD } from '../shared/data/dateUtils.js';

let N; let db; let kennelRepo; let dogRepo; let contactRepo; let saleRepo; let litterRepo;
before(async () => {
  await installMemoryDb();
  N = await import('../shared/data/nudges.js');
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ litterRepo } = await import('../shared/data/litterRepo.js'));
});

const today = '2026-11-13';
const at = (n) => addDaysToYMD(today, n);
const final = { id: 'final', due: 'at_pickup', covers: ['all'], percent: 100, basis: 'total' };
const sale = (extra = {}) => ({ id: 's1', dog_id: 'd1', buyer_contact_id: 'c1', status: 'deposit_paid', price: 3000, deposit_amount: 500, deposit_date: at(-40), ...extra });
const opts = (extra = {}) => ({ today, birthDate: at(-50), pickupDate: at(20), ...extra });
const dogs = new Map([['d1', { id: 'd1', call_name: 'Maple' }]]);
const contacts = new Map([['c1', { id: 'c1', name: 'Jordan Reyes' }]]);
const nudgesFor = (s, o = {}) => N.paymentDueNudges(today, [s], new Map([[s.id, paymentStatement(s, opts(o))]]), dogs, contacts);

test('a due date within 7 days: payment-due, with what it still asks; due today says so', () => {
  const s = sale({ payment_schedule: [{ id: 'p1', due: 'on_date', due_date: at(4), covers: ['price'], percent: 50, basis: 'total' }, final] });
  const [n, ...rest] = nudgesFor(s);
  assert.equal(rest.length, 0, 'the final payment at pickup (20 days out) isn\'t due yet');
  assert.equal(n.key, `payment-due:s1:p1:${at(4)}`);
  assert.equal(n.title, 'Jordan Reyes\'s Payment 1 for Maple is due Nov 17: $1,000.00');
  assert.equal(n.owed, 1000, '50% of the price, less the deposit');
  assert.equal(n.subjectHref, 'sale.html?id=s1');
  assert.deepEqual(n.actions.map((a) => a.label), ['Open the sale']);
  const t = nudgesFor({ ...s, payment_schedule: [{ ...s.payment_schedule[0], due_date: today }, final] });
  assert.match(t[0].title, /is due today: \$1,000\.00$/);
  // Part paid already: what's still owed, and the part paid said.
  const part = nudgesFor({ ...s, payments: [{ id: 'x', amount: 400, date: at(-1) }] });
  assert.equal(part[0].owed, 600);
  assert.match(part[0].detail, /^\$400\.00 of it is already paid\./);
  // Eight days out: nothing yet.
  assert.equal(nudgesFor({ ...s, payment_schedule: [{ ...s.payment_schedule[0], due_date: at(8) }, final] }).length, 0);
});

test('a due date gone by without the money: payment-missed, the plan\'s words, Open the sale, never a back-out', () => {
  const s = sale({ payment_schedule: [{ id: 'p1', due: 'on_date', due_date: at(-3), covers: ['price'], percent: 50, basis: 'total' }, final] });
  const [n] = nudgesFor(s);
  assert.equal(n.key, `payment-missed:s1:p1:${at(-3)}`);
  assert.equal(n.title, 'A scheduled payment was not marked received: Jordan Reyes, $1,000.00 due Nov 10.');
  assert.match(n.detail, /record the payment, set a new date, or cancel the sale/);
  assert.deepEqual(n.actions.map((a) => a.label), ['Open the sale']);
  // Paid → gone. A new date she types → a new key (a dismissal doesn't carry over).
  assert.equal(nudgesFor({ ...s, payments: [{ id: 'x', amount: 1000, date: at(-1) }] }).length, 0);
  const moved = nudgesFor({ ...s, payment_schedule: [{ ...s.payment_schedule[0], due_date: at(2) }, final] });
  assert.equal(moved[0].key, `payment-due:s1:p1:${at(2)}`);
});

test('a sale with no schedule is its one due date: the balance due date, else pickup', () => {
  const [n] = nudgesFor(sale({ balance_due_date: at(6) }));
  assert.equal(n.key, `payment-due:s1:final:${at(6)}`);
  assert.equal(n.title, 'Jordan Reyes\'s payment for Maple is due Nov 19: $2,500.00');
  const [p] = nudgesFor(sale(), { pickupDate: at(-2) });
  assert.equal(p.key, `payment-missed:s1:final:${at(-2)}`);
  // With a schedule, the last is "final payment" (payment 1 here is met by the deposit).
  const two = nudgesFor(sale({ payment_schedule: [{ id: 'p1', due: 'on_date', due_date: at(-30), covers: ['price'], percent: 10, basis: 'total' }, final] }), { pickupDate: at(-1) });
  assert.deepEqual(two.map((n) => n.key), [`payment-missed:s1:final:${at(-1)}`]);
  assert.match(two[0].detail, /^The final payment for Maple/);
  // No date known yet: nothing (Financials says "No due date").
  assert.equal(nudgesFor(sale(), { pickupDate: null }).length, 0);
});

test('not nudged: the deposit, paid in full, a closed sale, extras on their own dates', () => {
  // The deposit owed has its own nudges (offers, side sales).
  assert.equal(nudgesFor(sale({ status: 'deposit_pending', deposit_date: null, balance_due_date: at(30) })).length, 0);
  assert.equal(nudgesFor(sale({ status: 'paid_in_full', balance_paid_date: at(-1), balance_due_date: at(2) })).length, 0);
  for (const status of ['delivered', 'cancelled', 'returned', 'voided']) assert.equal(nudgesFor(sale({ status, balance_due_date: at(2) })).length, 0, status);
  const own = sale({ balance_due_date: at(30), extra_charges: [{ id: 'ph', label: 'Photos', amount: 150, own_due_dates: true, payments: [{ id: 'a', percent: 100, due: 'at_weeks', n: 8, due_date: at(2) }] }] });
  assert.equal(paymentStatement(own, opts()).ownDated.length, 1, 'the fixture is an own-dated step');
  assert.equal(nudgesFor(own).length, 0, 'extra-due covers it');
});

test('extra-due: an extra on a schedule is paid through it; own-dated and unscheduled extras keep their steps', () => {
  const tr = { id: 'tr', label: 'Training', amount: 600, payments: [{ id: 'a', percent: 100, due: 'at_weeks', n: 8, due_date: at(2) }] };
  const base = sale({ extra_charges: [tr] });
  const due = (s) => N.extraDueNudges(today, [s], [], dogs, contacts).map((n) => n.key);
  assert.deepEqual(due(base), ['extra-due:s1:tr:a'], 'no schedule: its own steps, as before');
  const scheduled = { ...base, payment_schedule: [final] };
  assert.deepEqual(due(scheduled), [], 'on the schedule: payment-due asks for it');
  assert.deepEqual(due({ ...scheduled, extra_charges: [{ ...tr, own_due_dates: true }] }), ['extra-due:s1:tr:a']);
});

test('Review my waitlist reads them in step 7 and counts them', () => {
  assert.deepEqual(readNudgeKey(`payment-missed:s1:p1:${at(-3)}`), { kind: 'payment-missed', entryId: null, requestId: null, litterId: null, turnId: null, saleId: 's1', chargeId: null, stepId: null, dueId: 'p1' });
  assert.equal(readNudgeKey('payment-due:s9:final:2026-12-01').saleId, 's9');
  assert.equal(STEP_OF['payment-due'], 'fees');
  assert.equal(STEP_OF['payment-missed'], 'fees');
  assert.equal(reviewSummary({ paymentsDue: 2 }), 'Here\'s what\'s waiting on you: 2 payments due or not marked received.');
  assert.equal(reviewSummary({ paymentsDue: 1, extrasDue: 1 }), 'Here\'s what\'s waiting on you: 1 payment due or not marked received, 1 extras payment due.');
});

test('owedBy: what a family owes by a pickup day; the final payment flagged', () => {
  const s = sale({
    payment_schedule: [{ id: 'p1', due: 'on_date', due_date: at(30), covers: ['price'], percent: 50, basis: 'total' }, final],
    extra_charges: [{ id: 'ph', label: 'Photos', amount: 150, own_due_dates: true, payments: [{ id: 'a', percent: 100, due: 'at_weeks', n: 8, due_date: at(60) }] }]
  });
  // Pickup in 20 days, before payment 1's typed date: only what's due by then.
  let st = paymentStatement(s, opts({ pickupDate: at(20) }));
  assert.deepEqual(owedBy(st, at(20)), { amount: 1500, final: true }, 'the final (at pickup) is due; payment 1 (day 30) and photos (day 60) aren\'t');
  assert.deepEqual(owedBy(st, at(60)), { amount: 2650, final: true });
  st = paymentStatement({ ...s, payment_schedule: null, extra_charges: [] }, opts());
  assert.deepEqual(owedBy(st, at(20)), { amount: 2500, final: true });
  st = paymentStatement(sale({ balance_paid_date: at(-1), status: 'paid_in_full' }), opts());
  assert.deepEqual(owedBy(st, at(20)), { amount: 0, final: false });
  assert.deepEqual(owedBy(null, at(1)), { amount: 0, final: false });
  // An unpaid deposit is part of it.
  st = paymentStatement(sale({ status: 'deposit_pending', deposit_date: null }), opts());
  assert.equal(owedBy(st, at(20)).amount, 3000);
});

test('paidInFullChanges: the date, and Paid in full from a deposit status only', () => {
  assert.deepEqual(paidInFullChanges({ status: 'deposit_paid' }, at(0)), { balance_paid_date: today, status: 'paid_in_full' });
  assert.deepEqual(paidInFullChanges({ status: 'delivered' }, at(0)), { balance_paid_date: today });
});

test('the pickup message: the day, what\'s owed by then and the final-payment methods', () => {
  const m = pickupMessage({ who: 'Jordan', pupName: 'Maple', date: 'December 3, 2026', time: '2:00 PM', location: 'the farm', owed: '$2,500.00', finalMethods: 'Cash or Zelle only', kennelName: 'Briar Hollow' });
  assert.equal(m.subject, 'Maple\'s pickup day');
  assert.equal(m.body, [
    'Hi Jordan,', '', 'Maple\'s pickup is all set for December 3, 2026 at 2:00 PM, at the farm.', '',
    '$2,500.00 is due at pickup.', 'For the final payment: Cash or Zelle only', '',
    'Let us know if anything changes, or if you have any questions.', '', 'See you soon!', 'Briar Hollow'
  ].join('\n'));
  const d = pickupMessage({ who: 'Jordan', pupName: 'Maple', date: 'December 3, 2026', dropoff: true, paidUp: true });
  assert.equal(d.subject, 'Maple\'s drop-off day');
  assert.match(d.body, /We're all set to bring Maple to you on December 3, 2026\./);
  assert.match(d.body, /Maple is paid in full\. Thank you!/);
  assert.doesNotMatch(d.body, /due at/);
  const plain = pickupMessage({ pupName: 'Maple', date: 'December 3, 2026' });
  assert.match(plain.body, /^Hi,\n/);
  assert.doesNotMatch(plain.body, /paid in full|due at|final payment/, 'nothing owed by then, but not all paid: no money line');
});

// --- On Today (computeNudges), every edition ---------------------------------------
beforeEach(async () => { if (db) for (const t of db.tables) await t.clear(); });

test('Today: an open sale\'s balance due in 3 days shows payment-due; marked paid in full, it goes', async () => {
  const now = todayYMD();
  const K = await kennelRepo.create({ kennel_name: 'Briar Hollow', is_own_kennel: true });
  const dam = await dogRepo.create({ call_name: 'Hazel', sex: 'female', status: 'active_breeding', kennel_id: K.id, ownership_type: 'owned', breed: 'Boston Terrier' });
  const sire = await dogRepo.create({ call_name: 'Rocco', sex: 'male', status: 'active_breeding', kennel_id: K.id, ownership_type: 'owned', breed: 'Boston Terrier' });
  const L = await litterRepo.create({ kennel_id: K.id, dam_id: dam.id, sire_id: sire.id, status: 'ready', whelp_date: addDaysToYMD(now, -50) });
  const pup = await dogRepo.create({ call_name: 'Maple', sex: 'female', breed: 'Boston Terrier', status: 'puppy', kennel_id: K.id, litter_id: L.id, ownership_type: 'owned' });
  const buyer = await contactRepo.create({ name: 'Jordan Reyes', contact_type: ['buyer'] });
  const s = await saleRepo.create({ kennel_id: K.id, dog_id: pup.id, buyer_contact_id: buyer.id, status: 'deposit_paid', registration_type: 'limited', sale_date: addDaysToYMD(now, -20), price: 3000, deposit_amount: 500, deposit_date: addDaysToYMD(now, -20), balance_due_date: addDaysToYMD(now, 3) });
  let ours = (await N.computeNudges()).filter((n) => n.key.startsWith('payment-'));
  assert.deepEqual(ours.map((n) => n.key), [`payment-due:${s.id}:final:${addDaysToYMD(now, 3)}`]);
  assert.match(ours[0].title, /^Jordan Reyes's payment for Maple is due .+: \$2,500\.00$/);
  await saleRepo.update(s.id, { status: 'paid_in_full', balance_paid_date: now });
  ours = (await N.computeNudges()).filter((n) => n.key.startsWith('payment-'));
  assert.equal(ours.length, 0);
});
