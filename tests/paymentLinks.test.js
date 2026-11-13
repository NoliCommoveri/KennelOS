// paymentLinks.test.js — her own payment link (Integrations plan §4, Level 0):
// which accounts can take a payment, the sale's Sold / paid through account
// first, what can be asked for, and the messages (the payment request, and the
// waitlist's deposit request using the same account).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentLink, takesPayments, paymentAccounts, salePaidVia, salePayAccount, paidViaField, paymentOptions, paymentLines, paymentRequestMessage } from '../shared/data/paymentLinks.js';
import { depositRequestMessage } from '../shared/data/depositRequest.js';
import { paymentStatement } from '../shared/data/paymentSchedule.js';

const PS = 'payment_service';
const stripe = { id: 's', name: 'Stripe', account_type: PS, payment_link: 'https://buy.stripe.com/abc' };
const zelle = { id: 'z', name: 'Bank', account_type: PS, payment_instructions: 'Zelle to pay@kennel.example' };
const goodDog = { id: 'g', name: 'Good Dog', account_type: 'marketplace', fee_percent: 6.25 };
const old = { id: 'o', name: 'Old Square', account_type: PS, payment_link: 'https://square.link/u/x', is_archived: true };

test('a payment link is a web address; an account takes payments with a link or instructions', () => {
  assert.equal(paymentLink('https://buy.stripe.com/abc'), 'https://buy.stripe.com/abc');
  assert.equal(paymentLink('venmo @me'), '');
  assert.equal(paymentLink('javascript:alert(1)'), '');
  assert.ok(takesPayments(stripe));
  assert.ok(takesPayments(zelle));
  assert.ok(!takesPayments(goodDog));
  assert.ok(!takesPayments({ account_type: PS, payment_link: 'not a link' }));
  assert.ok(!takesPayments({ ...stripe, account_type: 'software' }), 'a link on another type stays stored, unoffered');
  assert.ok(!takesPayments(null));
});

test('paymentAccounts: not archived, takes payments, by name', () => {
  assert.deepEqual(paymentAccounts([stripe, goodDog, old, zelle]).map((a) => a.id), ['z', 's']);
});

test('each part of a sale has its own paid-via account; the balance falls back to the deposit\'s', () => {
  const all = [stripe, zelle, goodDog, old];
  const sale = { deposit_paid_via_account_id: 's', balance_paid_via_account_id: 'z', sales_channel_account_id: 'g' };
  assert.equal(salePaidVia(sale, all, 'deposit'), stripe);
  assert.equal(salePaidVia(sale, all, 'balance'), zelle);
  assert.equal(salePaidVia({ deposit_paid_via_account_id: 's' }, all, 'all'), stripe);
  assert.equal(salePaidVia({ deposit_paid_via_account_id: 'o' }, all, 'deposit'), old, 'the sale\'s own, even archived');
  assert.equal(salePaidVia({ sales_channel_account_id: 'g' }, all, 'deposit'), null, 'Sold through is not paid via');
  assert.equal(salePayAccount({ deposit_paid_via_account_id: 'g' }, all, 'deposit'), null, 'not a payment service');
  assert.equal(paidViaField('deposit'), 'deposit_paid_via_account_id');
  assert.equal(paidViaField('all'), 'balance_paid_via_account_id');
});

test('paymentOptions: from the statement, the deposit owed, the next payment, everything owed, each once', () => {
  const base = { status: 'deposit_pending', price: 3000, deposit_amount: 500, transport_fee: 150 };
  const opts = { today: '2026-10-15', pickupDate: '2026-12-01', depositDueDate: '2026-10-20' };
  assert.deepEqual(paymentOptions(paymentStatement(base, opts)), [
    { key: 'deposit', label: 'Deposit', amount: 500, due: '2026-10-20', atPickup: false, final: false },
    { key: 'next', label: 'Balance', amount: 2650, due: '2026-12-01', atPickup: false, final: true },
    { key: 'all', label: 'Everything owed', amount: 3150, due: '2026-12-01', atPickup: false, final: true }
  ]);
  // The application fee credited toward the deposit: the deposit owed is what's left.
  const credited = paymentOptions(paymentStatement(base, { ...opts, feeCredit: { amount: 50, toward: 'deposit', date: '2026-09-01' } }));
  assert.equal(credited[0].amount, 450);
  assert.equal(credited[2].amount, 3100);
  // The deposit paid, two due dates: the next one, then everything (the final payment).
  const sched = { ...base, status: 'deposit_paid', deposit_date: '2026-10-01',
    payment_schedule: [{ id: 'a', due: 'on_date', due_date: '2026-11-01', covers: ['price'], percent: 50, basis: 'total' }, { id: 'b', due: 'at_pickup', covers: ['all'], percent: 100, basis: 'total' }] };
  const o = paymentOptions(paymentStatement(sched, opts));
  assert.deepEqual(o.map((x) => [x.key, x.amount, x.final]), [['next', 1000, false], ['all', 2650, true]], '50% of $3,000 less the $500 deposit');
  assert.match(o[0].label, /^Next payment/);
  // Paid down to the final payment: one option, the final payment.
  const last = paymentOptions(paymentStatement({ ...sched, payments: [{ id: 'p', amount: 1000, date: '2026-10-20' }] }, opts));
  assert.deepEqual(last.map((x) => [x.key, x.label, x.amount]), [['next', 'Final payment', 1650]]);
  assert.deepEqual(paymentOptions(paymentStatement({ ...base, status: 'paid_in_full', deposit_date: '2026-10-01', balance_paid_date: '2026-11-01' }, opts)), [], 'nothing owed');
  assert.deepEqual(paymentOptions(null), []);
});

test('paymentRequestMessage: the next or final payment, at pickup, with her final-payment methods', () => {
  const m = paymentRequestMessage({ who: 'Ann', pupName: 'Maple', what: 'final', amount: '$1,650.00', atPickup: true, finalMethods: 'Cash or Zelle only', account: zelle });
  assert.match(m.body, /pay the final payment of \$1,650\.00 for Maple, due at pickup\./);
  assert.match(m.body, /For the final payment: Cash or Zelle only/);
  assert.equal(m.subject, 'Maple: your final payment');
  assert.match(paymentRequestMessage({ what: 'next', amount: '$1,000.00', due: 'Nov 1' }).body, /the next payment of \$1,000\.00, due by Nov 1\./);
});

test('paymentLines: the link then the instructions, or the instructions alone', () => {
  assert.deepEqual(paymentLines(stripe), ['Pay online: https://buy.stripe.com/abc']);
  assert.deepEqual(paymentLines({ ...stripe, payment_instructions: 'Card or Apple Pay.' }), ['Pay online: https://buy.stripe.com/abc', 'Card or Apple Pay.']);
  assert.deepEqual(paymentLines(zelle), ['How to pay: Zelle to pay@kennel.example']);
  assert.deepEqual(paymentLines(goodDog), []);
});

test('paymentRequestMessage', () => {
  const m = paymentRequestMessage({ who: 'Ann', pupName: 'Maple', what: 'balance', amount: '$2,650.00', due: 'Nov 1, 2026', account: stripe, kennelName: 'Thornfield' });
  assert.equal(m.subject, 'Maple: your balance');
  assert.match(m.body, /^Hi Ann,/);
  assert.match(m.body, /pay the balance of \$2,650\.00 for Maple, due by Nov 1, 2026\./);
  assert.match(m.body, /Pay online: https:\/\/buy\.stripe\.com\/abc/);
  assert.match(m.body, /Thornfield$/);
  const bare = paymentRequestMessage({ what: 'deposit', account: zelle });
  assert.equal(bare.subject, 'Your puppy: deposit');
  assert.match(bare.body, /^Hi,\n\nHere's how to pay the deposit\./);
  assert.match(bare.body, /How to pay: Zelle/);
});

test("the waitlist's deposit request carries the paid-through account's link, before her instructions", () => {
  const m = depositRequestMessage({ pupName: 'Maple', payAccount: stripe, paymentText: 'or a check' });
  assert.match(m.body, /Pay online: https:\/\/buy\.stripe\.com\/abc\n\nOr pay: or a check/);
  const none = depositRequestMessage({ pupName: 'Maple', payAccount: goodDog, paymentText: 'a check' });
  assert.match(none.body, /How to pay: a check/);
  assert.doesNotMatch(none.body, /Pay online/);
});
