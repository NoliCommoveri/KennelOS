// backOut.test.js — a family backing out (docs/KennelOS_Family_Requests_Plan.md §7):
// her reasons and policy, what the confirm offers to take off, and the income of an
// extra she kept on the cancelled or refunded sale.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { backOutReasons, suggestOutcome, policyRowText, ageWeeks, backOutItems, backOutSummary, backOutPolicyText, BACK_OUT_POLICY_TEXT_DEFAULT } from '../shared/data/backOut.js';

let income;
before(async () => {
  await installMemoryDb();
  income = await import('../shared/data/incomeView.js');
});

test('her reasons, then "Something else"; the default list when she has none', () => {
  assert.deepEqual(backOutReasons({}).map((r) => r.id), ['changed_mind', 'circumstances', 'pup', 'timing', 'other']);
  assert.deepEqual(backOutReasons({ back_out_reasons: [{ id: 'moving', label: 'Moving' }, { id: 'other', label: 'x' }] }).map((r) => r.id), ['moving', 'other']);
  assert.equal(backOutPolicyText({}), BACK_OUT_POLICY_TEXT_DEFAULT);
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
  assert.equal(policyRowText(config.back_out_policy[0], backOutReasons({})), 'We changed our mind, under 6 weeks → move the deposit to another pup');
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
  assert.equal(backOutSummary('keep', { deposit: 500, items, money: (n) => `$${n}` }),
    'Cancel the sale and keep their $500 deposit, keep Puppy training (still owed), keep Video (still owed), remove Photos, remove Puppy training on 2026-11-10, remove Puppy pickup on 2026-11-24');
  assert.match(backOutSummary('move', { deposit: 500 }), /move their \$500 deposit to another pup \(they go to the end of the line\)/);
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
