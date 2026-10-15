// goHome.test.js — a sold puppy's way home (data/goHome.js): when Today and
// Kels ask to schedule the pickup, to log the boarding a sale charges for, or
// whether a puppy whose pickup date passed went home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../shared/data/goHome.js';
import { addDaysToYMD } from '../shared/data/dateUtils.js';

const today = '2026-10-15';
const at = (n) => addDaysToYMD(today, n);
const pup = { id: 'p', status: 'puppy', litter_id: 'L', call_name: 'Cedar' };
const litter = (ready) => ({ id: 'L', whelp_date: addDaysToYMD(ready, -56), estimated_ready_date: ready });
const sale = (extra = {}) => ({ id: 's', dog_id: 'p', buyer_contact_id: 'buyer', status: 'deposit_paid', created_at: '2026-09-01T00:00:00Z', ...extra });
const pickup = (date, extra = {}) => ({ subject_type: 'dog', subject_id: 'p', event_type: 'placement', event_date: date, related_contact_id: 'buyer', ...extra });
const boarding = (start, end = null) => ({ subject_type: 'dog', subject_id: 'p', event_type: 'boarding', event_date: start, ...(end ? { event_end_date: end } : {}) });
const issue = (opts) => H.goHomeIssue({ pup, litter: litter(at(3)), sales: [sale()], events: [], today, ...opts })?.kind ?? null;

test('the ready date: the estimate, else 8 weeks after the birth', () => {
  assert.equal(H.readyDateOf({ whelp_date: '2026-09-01', estimated_ready_date: '2026-11-01' }), '2026-11-01');
  assert.equal(H.readyDateOf({ whelp_date: '2026-09-01' }), '2026-10-27');
  assert.equal(H.readyDateOf({}), null);
});

test('schedule: from a week before the ready date, with a sale in progress and nothing on the calendar', () => {
  assert.equal(issue({ litter: litter(at(8)) }), null, 'more than a week out');
  assert.equal(issue({ litter: litter(at(7)) }), 'schedule');
  assert.equal(issue({}), 'schedule');
  assert.equal(issue({ litter: litter(at(-10)) }), 'schedule', 'past the ready date too');
  // Only a sale far enough along: Deposit paid or Paid in full.
  assert.equal(issue({ sales: [sale({ status: 'paid_in_full' })] }), 'schedule');
  for (const status of ['deposit_pending', 'delivered', 'cancelled', 'returned', 'voided']) assert.equal(issue({ sales: [sale({ status })] }), null, status);
  assert.equal(issue({ sales: [sale({ is_archived: true })] }), null);
  // A puppy no longer a puppy, or archived, or a litter with no dates: nothing.
  assert.equal(H.goHomeIssue({ pup: { ...pup, is_archived: true }, litter: litter(at(3)), sales: [sale()], events: [], today }), null);
  assert.equal(H.goHomeIssue({ pup: { ...pup, status: 'external_reference' }, litter: litter(at(3)), sales: [sale()], events: [], today }), null);
  assert.equal(H.goHomeIssue({ pup, litter: {}, sales: [sale()], events: [], today }), null);
});

test('a pickup on the calendar, or boarding running today or later, settles it', () => {
  assert.equal(issue({ events: [pickup(at(5))] }), null);
  assert.equal(issue({ events: [pickup(today)] }), null, 'today counts as scheduled');
  assert.equal(issue({ events: [pickup(at(5), { related_contact_id: null })] }), null, 'a pickup logged without a contact counts');
  assert.equal(issue({ events: [pickup(at(5), { related_contact_id: 'someone-else' })] }), 'schedule', 'another family\'s pickup doesn\'t');
  assert.equal(issue({ events: [pickup(at(5), { is_archived: true })] }), 'schedule');
  assert.equal(issue({ events: [boarding(at(-1), at(10))] }), null, 'staying on');
  assert.equal(issue({ events: [boarding(at(1))] }), null, 'open-ended boarding');
  assert.equal(issue({ events: [boarding(at(-20), at(-15))] }), 'schedule', 'boarding long before the go-home doesn\'t');
});

test('overdue: the pickup passed and the sale isn\'t Delivered', () => {
  const x = H.goHomeIssue({ pup, litter: litter(at(-5)), sales: [sale()], events: [pickup(at(-3)), pickup(at(-6))], today });
  assert.deepEqual([x.kind, x.pickupDate, x.sale.id], ['overdue', at(-3), 's']);
  assert.equal(issue({ events: [pickup(at(-3)), pickup(at(4))] }), null, 'moved to a later date');
  assert.equal(issue({ events: [pickup(at(-3)), boarding(at(-3), at(6))] }), null, 'staying on, boarding');
  assert.equal(issue({ events: [pickup(at(-3))], sales: [sale({ status: 'delivered' })] }), null);
  assert.equal(issue({ events: [pickup(at(-1), { related_contact_id: 'old-family' })] }), 'schedule', 'an earlier family\'s pickup isn\'t this one');
});

test('boarding: a sale with a boarding charge and no boarding logged around the go-home', () => {
  const charged = sale({ deferred_boarding_amount: 15, deferred_boarding_frequency: 'Day', deferred_boarding_duration_days: '14' });
  assert.equal(issue({ sales: [charged] }), 'boarding');
  assert.equal(issue({ sales: [charged], events: [pickup(at(20))] }), 'boarding', 'a pickup set but the boarding not logged');
  assert.equal(issue({ sales: [charged], events: [boarding(at(3), at(16)), pickup(at(17))] }), null);
  assert.equal(issue({ sales: [charged], events: [boarding(at(3), at(16))] }), null, 'boarding running: no pickup needed yet');
  // After the boarding ends, the pickup questions come back.
  assert.equal(issue({ sales: [charged], events: [boarding(at(-14), at(-1))] }), 'schedule');
  assert.equal(issue({ sales: [sale({ deferred_boarding_amount: 0 })] }), 'schedule');
  assert.equal(issue({ sales: [charged], litter: litter(at(9)) }), null, 'more than a week out');
});

test('the boarding span: a count of the frequency\'s units', () => {
  const s = (frequency, count) => ({ deferred_boarding_amount: 10, deferred_boarding_frequency: frequency, deferred_boarding_duration_days: count });
  assert.equal(H.boardingEnd(s('Day', '14'), '2026-10-15'), '2026-10-28');
  assert.equal(H.boardingEnd(s('Week', '2'), '2026-10-15'), '2026-10-28');
  assert.equal(H.boardingEnd(s('Month', '1'), '2026-10-15'), '2026-11-14');
  assert.equal(H.boardingEnd(s('Day', ''), '2026-10-15'), '');
  assert.equal(H.boardingEnd(s('Day', 'a few'), '2026-10-15'), '');
  assert.equal(H.boardingChargeText(s('Week', '2')), '$10 per week × 2');
  assert.equal(H.boardingChargeText(sale()), '');
});

test('the events Kels writes', () => {
  assert.deepEqual(H.pickupEvent(pup, sale(), today, '10am'), {
    subject_type: 'dog', subject_id: 'p', event_type: 'placement', event_date: today,
    title: 'Puppy pickup', related_contact_id: 'buyer', details: { placement_time: '10am' }
  });
  assert.deepEqual(H.boardingEvent(pup, today, at(13)), {
    subject_type: 'dog', subject_id: 'p', event_type: 'boarding', event_date: today, event_end_date: at(13),
    title: 'Deferred pickup boarding', details: { boarding_reason: 'Deferred pickup' }
  });
  assert.equal(H.defaultStart(at(3), today), at(3));
  assert.equal(H.defaultStart(at(-3), today), today);
});

test('deliveredOwnershipChanges: External (owner set) or Co-owned (buyer added once)', () => {
  const dog = { id: 'd', co_owner_contact_ids: ['x'] };
  assert.deepEqual(H.deliveredOwnershipChanges(dog, 'external', { ownerId: 'b', buyerId: 'b', today: '2026-10-15' }),
    { ownership_type: 'external', status: 'external_reference', status_date: '2026-10-15', owner_contact_id: 'b' });
  assert.deepEqual(H.deliveredOwnershipChanges(dog, 'external', { today: '2026-10-15' }),
    { ownership_type: 'external', status: 'external_reference', status_date: '2026-10-15' }, 'no owner picked');
  assert.deepEqual(H.deliveredOwnershipChanges(dog, 'co_owned', { buyerId: 'b' }), { ownership_type: 'co_owned', co_owner_contact_ids: ['x', 'b'] });
  assert.deepEqual(H.deliveredOwnershipChanges({ co_owner_contact_ids: ['b'] }, 'co_owned', { buyerId: 'b' }), { ownership_type: 'co_owned' }, 'already a co-owner');
  assert.equal(H.deliveredOwnershipChanges(dog, ''), null);
  assert.equal(H.deliveredOwnershipChanges(null, 'external'), null);
});
