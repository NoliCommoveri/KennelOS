// backOut.test.js — a family backing out (docs/KennelOS_Family_Requests_Plan.md §7):
// her reasons and policy, what the confirm offers to take off, and the income of an
// extra she kept on the cancelled or refunded sale.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { backOutReasons, suggestOutcome, policyRowText, ageWeeks, backOutItems, backOutSummary, backOutPaidText, backOutPolicyText, BACK_OUT_POLICY_TEXT_DEFAULT } from '../shared/data/backOut.js';

let income;
before(async () => {
  await installMemoryDb();
  income = await import('../shared/data/incomeView.js');
});

test('her reasons, then "Something else"; the default list when she has none', () => {
  assert.deepEqual(backOutReasons({}).map((r) => r.id), ['changed_mind', 'circumstances', 'pup', 'timing', 'other']);
  assert.deepEqual(backOutReasons({ back_out_reasons: [{ id: 'moving', label: 'Moving' }, { id: 'other', label: 'x' }] }).map((r) => r.id), ['moving', 'other']);
  assert.equal(backOutPolicyText({}, 'Test Boston'), BACK_OUT_POLICY_TEXT_DEFAULT.replace('[Kennel Name]', 'Test Boston'));
  assert.match(backOutPolicyText({}, 'Test Boston'), /^Please note that all paid deposits are non-refundable.*sometimes, life happens; Test Boston will review your reason/);
  assert.equal(backOutPolicyText({ back_out_policy_text: 'Call [kennel name] first.' }, 'Briar Hollow'), 'Call Briar Hollow first.');
});

test('the first rule that fits the reason and the pup\'s age suggests; none fits: keep', () => {
  const config = { back_out_policy: [
    { reason_id: 'changed_mind', until_weeks: 6, outcome: 'move' },
    { reason_id: 'pup', outcome: 'move' },
    { reason_id: 'any', from_weeks: 10, outcome: 'keep' }
  ] };
  assert.equal(ageWeeks('2026-09-01', '2026-10-06'), 5);
  assert.equal(suggestOutcome(config, 'changed_mind', 5).outcome, 'move');
  assert.equal(suggestOutcome(config, 'changed_mind', 6).outcome, 'keep', '"until 6 weeks" means younger than 6');
  assert.equal(suggestOutcome(config, 'pup', 12).outcome, 'move', 'any age');
  assert.equal(suggestOutcome(config, 'changed_mind', null).row, null, 'an age rule with no age known: skipped');
  assert.equal(policyRowText(config.back_out_policy[0], backOutReasons({})), 'We changed our mind, under 6 weeks → put them back in line');
});

test('the confirm ticks unpaid, unstarted things to remove and keeps what she is owed', () => {
  const sale = { id: 's1', dog_id: 'p1', buyer_contact_id: 'c1', extra_charges: [
    { id: 'tr', label: 'Puppy training', amount: 600, payments: [{ id: 'a', percent: 50, due: 'at_weeks', paid_date: '2026-10-28' }, { id: 'b', percent: 50, due: 'with_balance' }] },
    { id: 'ph', label: 'Photos', amount: 150 },
    { id: 'vid', label: 'Video', amount: 75, completed_date: '2026-10-20' },
    { id: 'fee', label: 'PayPal fee', amount: 5, fee_for: 'deposit' }
  ] };
  const events = [
    { id: 'st1', subject_id: 'p1', event_type: 'boarding', event_date: '2026-11-10', event_end_date: '2026-11-23', title: 'Puppy training', details: { sale_id: 's1', extra_charge_id: 'tr' } },
    { id: 'st2', subject_id: 'p1', event_type: 'boarding', event_date: '2026-10-25', title: 'Deferred pickup boarding', details: { sale_id: 's1' } },
    { id: 'pk', subject_id: 'p1', event_type: 'placement', event_date: '2026-11-24', related_contact_id: 'c1', title: 'Puppy pickup' },
    { id: 'old', subject_id: 'p1', event_type: 'placement', event_date: '2026-10-01', related_contact_id: 'c1' }
  ];
  const items = backOutItems({ sale, events, today: '2026-11-01' });
  assert.deepEqual(items.map((i) => [i.id, i.remove, i.detail]), [
    ['tr', false, '50% paid'], ['ph', true, 'nothing paid'], ['vid', false, 'done'],
    ['st1', true, '2026-11-10 to 2026-11-23'], ['st2', false, '2026-10-25, under way'], ['pk', true, '2026-11-24']
  ]);
  assert.equal(backOutSummary('keep', { paid: 800, items, money: (n) => `$${n}` }),
    'Cancel the sale and keep the $800 they paid, keep Puppy training (still owed), keep Video (still owed), remove Photos, remove Puppy training on 2026-11-10, remove Puppy pickup on 2026-11-24');
  // D9: nothing is refunded; back in line carries the credit she chose, the rest is kept.
  assert.equal(backOutSummary('move', { paid: 800, credit: 500 }), 'Cancel the sale and put them back at the end of the line with a $500 credit toward their next pup; the other $300 they paid is kept');
  assert.equal(backOutSummary('move', { paid: 800, credit: 800 }), 'Cancel the sale and put them back at the end of the line with a $800 credit toward their next pup');
  assert.equal(backOutSummary('move', { paid: 800, credit: 0 }), 'Cancel the sale and put them back at the end of the line with no credit; the $800 they paid is kept');
  assert.equal(backOutSummary('keep', { paid: 0 }), 'Cancel the sale', 'nothing paid: no money named');
});

test('K8-13: an extra kept on the sale says "paid" once it is, never "still owed"', () => {
  const sale = { id: 's1', dog_id: 'p1', extra_charges: [
    { id: 'tr', label: 'Puppy training', amount: 600, completed_date: '2026-10-20', payments: [{ id: 'a', percent: 50, due: 'on_approval', paid_date: '2026-10-01' }, { id: 'b', percent: 50, due: 'with_balance', paid_date: '2026-10-15' }] },
    { id: 'ph', label: 'Photos', amount: 150, payments: [{ id: 'a', percent: 100, due: 'on_approval', paid_date: '2026-10-01' }] }
  ] };
  const items = backOutItems({ sale, events: [], today: '2026-11-01' });
  assert.deepEqual(items.map((i) => [i.id, i.detail, i.owed, i.remove]), [['tr', 'done, paid', false, false], ['ph', 'paid', false, false]]);
  assert.equal(backOutSummary('keep', { paid: 750, items, money: (n) => `$${n}` }), 'Cancel the sale and keep the $750 they paid, keep Puppy training (paid), keep Photos (paid)');
});

test('K8-2: what they paid, line by line', () => {
  const money = (n) => `$${n}`;
  assert.equal(backOutPaidText([{ label: 'Deposit', amount: 500 }, { label: 'Balance', amount: 2500 }, { label: 'Transport', amount: 200 }], money),
    'They\'ve paid $3200 on this sale: deposit $500, balance $2500, transport $200.');
  assert.equal(backOutPaidText([], money), 'Nothing has been paid on this sale yet: no deposit was received.');
});

test('an extra she kept stays owed on a cancelled or refunded sale: paid parts earned, the rest anticipated', () => {
  const kept = { id: 'tr', label: 'Puppy training', amount: 600, kept_after_cancel: true, payments: [{ id: 'a', percent: 50, due: 'at_weeks', due_date: '2026-10-27', paid_date: '2026-10-28' }, { id: 'b', percent: 50, due: 'with_balance' }] };
  const base = { id: 's1', price: 3000, deposit_amount: 500, deposit_date: '2026-10-01', extra_charges: [kept, { id: 'ph', label: 'Photos', amount: 150 }] };
  const parts = (s) => income.incomeLineItems('sale', s).map((c) => [c.key, c.amount, c.state]);
  assert.deepEqual(parts({ ...base, status: 'cancelled' }), [
    ['deposit', 500, 'earned'], ['extra:tr:a', 300, 'earned'], ['extra:tr:b', 300, 'anticipated']
  ], 'cancelled: the deposit stays earned, the kept extra is owed, the rest dropped');
  assert.deepEqual(parts({ ...base, status: 'voided', end_reason: 'buyer_backed_out' }), [
    ['extra:tr:a', 300, 'earned'], ['extra:tr:b', 300, 'anticipated']
  ], 'refunded: the deposit isn\'t income, the kept extra still is');
});

test('a refunded back-out never offers to put the family back in line', async () => {
  const { restoresFamily } = await import('../shared/data/waitlistRules.js');
  assert.equal(restoresFamily({ status: 'voided', end_reason: 'pup_died' }), true);
  assert.equal(restoresFamily({ status: 'voided', end_reason: 'buyer_backed_out' }), false);
});
