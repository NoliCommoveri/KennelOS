// The waitlist application fee paid online, on the family pages
// (docs/KennelOS_Integrations_Plan.md §4): the Pay link her device published, a
// web address only, with the family's id added for a Stripe link; shown to an
// applicant until they've paid, and kept on an approved family's fee_due.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { feePayFor, statusView, pendingView } = await import('../src/familyPages.js');

const projection = (feePay, entries = {}) => ({ kennel: { name: 'Thornfield', fee_pay: feePay }, entries, litters: {}, public_list: [] });
const stripePay = { url: 'https://buy.stripe.com/fee', amount: 50, ref_param: true, instructions: 'Or Zelle' };

test('feePayFor: a Stripe link names the family; any other link is passed as is; junk is dropped', () => {
  assert.deepEqual(feePayFor(projection(stripePay), 'entry-1'),
    { url: 'https://buy.stripe.com/fee?client_reference_id=entry-1', amount: 50, instructions: 'Or Zelle' });
  assert.equal(feePayFor(projection({ ...stripePay, url: 'https://square.link/u/x' }), 'entry-1').url, 'https://square.link/u/x');
  assert.equal(feePayFor(projection({ ...stripePay, url: 'https://evil.example/?x=1', ref_param: true }), 'e').url, 'https://evil.example/?x=1', 'no id on a non-Stripe link');
  assert.equal(feePayFor(projection({ ...stripePay, url: 'javascript:alert(1)' }), 'e'), null);
  assert.equal(feePayFor(projection(undefined), 'e'), null);
});

test('an applicant sees Pay until they have paid; an approved family keeps its own pay_url', () => {
  assert.equal(pendingView(projection(stripePay), { name: 'Ann' }, 'app-1').family.fee_pay.url,
    'https://buy.stripe.com/fee?client_reference_id=app-1', 'not yet taken in by her device');
  const applied = statusView(projection(stripePay, { e1: { name: 'Ann', status: 'applied' } }), 'e1');
  assert.ok(applied.family.fee_pay);
  const paid = statusView(projection(stripePay, { e1: { name: 'Ann', status: 'applied', fee_paid_online: '2026-10-12' } }), 'e1');
  assert.equal(paid.family.fee_pay, undefined);
  assert.equal(paid.family.fee_paid_online, '2026-10-12');
  const approved = statusView(projection(undefined, { e1: { name: 'Ann', status: 'approved',
    fee_due: { amount: 50, pay_url: 'https://buy.stripe.com/fee?client_reference_id=e1', pay_amount: 51.81 } } }), 'e1');
  assert.equal(approved.family.fee_due.pay_amount, 51.81);
  const bad = statusView(projection(undefined, { e1: { name: 'Ann', status: 'approved', fee_due: { amount: 50, pay_url: 'data:text/html,x', pay_amount: 1 } } }), 'e1');
  assert.equal(bad.family.fee_due.pay_url, undefined);
});
