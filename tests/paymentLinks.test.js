// paymentLinks.test.js — her own payment link (Integrations plan §4, Level 0):
// which accounts can take a payment, the sale's Sold / paid through account
// first, what can be asked for, and the messages (the payment request, and the
// waitlist's deposit request using the same account).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentLink, takesPayments, paymentAccounts, saleChannelPayAccount, paymentOptions, paymentLines, paymentRequestMessage } from '../shared/data/paymentLinks.js';
import { depositRequestMessage } from '../shared/data/depositRequest.js';

const stripe = { id: 's', name: 'Stripe', payment_link: 'https://buy.stripe.com/abc' };
const zelle = { id: 'z', name: 'Bank', payment_instructions: 'Zelle to pay@kennel.example' };
const goodDog = { id: 'g', name: 'Good Dog', fee_percent: 6.25 };
const old = { id: 'o', name: 'Old Square', payment_link: 'https://square.link/u/x', is_archived: true };

test('a payment link is a web address; an account takes payments with a link or instructions', () => {
  assert.equal(paymentLink('https://buy.stripe.com/abc'), 'https://buy.stripe.com/abc');
  assert.equal(paymentLink('venmo @me'), '');
  assert.equal(paymentLink('javascript:alert(1)'), '');
  assert.ok(takesPayments(stripe));
  assert.ok(takesPayments(zelle));
  assert.ok(!takesPayments(goodDog));
  assert.ok(!takesPayments({ payment_link: 'not a link' }));
  assert.ok(!takesPayments(null));
});

test('paymentAccounts: not archived, takes payments, by name', () => {
  assert.deepEqual(paymentAccounts([stripe, goodDog, old, zelle]).map((a) => a.id), ['z', 's']);
});

test("the sale's paid-through account comes first, when it takes payments", () => {
  const all = [stripe, zelle, goodDog, old];
  assert.equal(saleChannelPayAccount({ sales_channel_account_id: 's' }, all), stripe);
  assert.equal(saleChannelPayAccount({ sales_channel_account_id: 'o' }, all), old, 'the sale\'s own, even archived');
  assert.equal(saleChannelPayAccount({ sales_channel_account_id: 'g' }, all), null, 'Good Dog collects its own payment');
  assert.equal(saleChannelPayAccount({}, all), null);
});

test('paymentOptions: the unpaid deposit, the unpaid rest, or both', () => {
  const items = [
    { component: 'deposit', amount: 500, state: 'anticipated' },
    { component: 'balance', amount: 2500, state: 'anticipated' },
    { component: 'transport', amount: 150, state: 'anticipated' }
  ];
  assert.deepEqual(paymentOptions(items), [
    { key: 'deposit', label: 'Deposit', amount: 500 },
    { key: 'balance', label: 'The rest of the price', amount: 2650 },
    { key: 'all', label: 'Everything owed', amount: 3150 }
  ]);
  const depositPaid = [{ ...items[0], state: 'earned' }, items[1]];
  assert.deepEqual(paymentOptions(depositPaid), [{ key: 'balance', label: 'Balance', amount: 2500 }]);
  assert.deepEqual(paymentOptions([{ ...items[0], state: 'earned' }]), []);
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
