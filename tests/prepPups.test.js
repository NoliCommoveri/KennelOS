// prepPups.test.js — Kels's "Pups are going home" and the Puppy Record's cover
// page, their shared data half (data/prepPups.js): which litters are offered,
// which pups are ticked, each pup's sale, and what's done or missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../shared/data/prepPups.js';
import * as H from '../shared/data/goHome.js';
import { addDaysToYMD } from '../shared/data/dateUtils.js';

const today = '2026-10-15';
const at = (n) => addDaysToYMD(today, n);
const PRO = { contracts: true, feedingSchedule: true };
const pup = (extra = {}) => ({ id: 'p', litter_id: 'L', status: 'puppy', call_name: 'Cedar', breed: 'Boston Terrier', ...extra });
const sale = (extra = {}) => ({ id: 's', dog_id: 'p', buyer_contact_id: 'buyer', status: 'deposit_paid', registration_type: 'limited', created_at: '2026-09-01T00:00:00Z', ...extra });
const ev = (type, date, extra = {}) => ({ subject_type: 'dog', subject_id: 'p', event_type: type, event_date: date, ...extra });
const ready = (opts) => P.readiness({ pup: pup(), sale: sale(), events: [], contracts: [], litter: { id: 'L' }, flags: PRO, today, ...opts });
const missing = (opts) => ready(opts).missing;

test('litters offered: born, not closed, with a pup still at home; newest born first', () => {
  const dogs = [
    { id: 'a', litter_id: 'A', status: 'puppy' },
    { id: 'b', litter_id: 'B', status: 'puppy' },
    { id: 'c', litter_id: 'C', status: 'puppy' },
    { id: 'g', litter_id: 'G', status: 'puppy' },
    { id: 'x', litter_id: 'X', status: 'puppy' }
  ];
  const sales = [{ dog_id: 'g', status: 'delivered' }];
  const list = P.prepLitters([
    { id: 'A', status: 'ready', whelp_date: '2026-08-01' },
    { id: 'B', status: 'sold', whelp_date: '2026-08-20' },
    { id: 'C', status: 'closed', whelp_date: '2026-08-10' },
    { id: 'E', status: 'expected' },
    { id: 'G', status: 'ready', whelp_date: '2026-08-05' },
    { id: 'X', status: 'ready', whelp_date: '2026-08-30', is_archived: true }
  ], dogs, sales);
  assert.deepEqual(list.map((l) => l.id), ['B', 'A'], 'a sold litter can still have pups at home; every pup gone home → not offered');
});

test('the pup\'s sale: newest open, else newest delivered; released ones never', () => {
  assert.equal(P.pupSale([]), null);
  assert.equal(P.pupSale([sale({ id: 'c', status: 'cancelled' })]), null);
  assert.equal(P.pupSale([sale({ id: 'd', status: 'delivered' }), sale({ id: 'o', status: 'deposit_pending', created_at: '2026-01-01' })]).id, 'o');
  assert.equal(P.pupSale([sale({ id: 'd', status: 'delivered' })]).id, 'd');
  assert.equal(P.pupSale([sale({ id: 'old', created_at: '2026-01-01' }), sale({ id: 'new', created_at: '2026-02-01' })]).id, 'new');
  assert.equal(P.pupSale([sale({ id: 'a', is_archived: true })]), null);
});

test('ticked by default: a sale at Deposit paid or later', () => {
  assert.equal(P.pickedByDefault(null), false);
  assert.equal(P.pickedByDefault(sale({ status: 'deposit_pending' })), false);
  assert.equal(P.pickedByDefault(sale()), true);
  assert.equal(P.pickedByDefault(sale({ status: 'paid_in_full' })), true);
});

test('a pup with nothing done is missing every item, in order', () => {
  assert.deepEqual(missing({ sale: sale({ registration_type: '' }) }), ['chip', 'litter_reg', 'pup_reg', 'shots', 'deworm', 'pickup', 'balance', 'contract', 'registration', 'feeding']);
});

test('a pup with no sale skips the sale items', () => {
  assert.deepEqual(missing({ sale: null }), ['chip', 'litter_reg', 'pup_reg', 'shots', 'deworm', 'feeding']);
});

test('Lite: no contract or feeding schedule items', () => {
  assert.deepEqual(missing({ flags: {} }), ['chip', 'litter_reg', 'pup_reg', 'shots', 'deworm', 'pickup', 'balance']);
});

test('chip, shots and deworming', () => {
  const r = ready({ pup: pup({ microchip_id: '985' }), events: [ev('vaccination', at(-3)), ev('vaccination', at(-10)), ev('preventative', at(-1))] });
  const by = Object.fromEntries(r.items.map((i) => [i.key, i]));
  assert.equal(by.chip.done, true);
  assert.equal(by.chip.detail, '985');
  assert.equal(by.shots.detail, at(-3), 'the newest');
  assert.equal(by.deworm.done, true);
  assert.ok(missing({ events: [ev('vaccination', at(-3), { is_archived: true })] }).includes('shots'), 'archived ones don\'t count');
});

test('drop-off date: a placement event for this family, today or later', () => {
  assert.ok(missing({ events: [ev('placement', at(-1), { related_contact_id: 'buyer' })] }).includes('pickup'), 'a past one isn\'t on the calendar');
  assert.ok(missing({ events: [ev('placement', at(3), { related_contact_id: 'someone else' })] }).includes('pickup'));
  assert.ok(!missing({ events: [ev('placement', at(3), { related_contact_id: 'buyer' })] }).includes('pickup'));
  assert.ok(!missing({ events: [ev('placement', today)] }).includes('pickup'), 'no contact on it still counts (older drop-offs)');
  assert.equal(ready({ events: [ev('placement', at(9)), ev('placement', at(4))] }).pickupDate, at(4), 'the soonest');
});

test('balance: paid in full, a paid date, or a due date', () => {
  assert.ok(missing({}).includes('balance'));
  assert.ok(!missing({ sale: sale({ status: 'paid_in_full' }) }).includes('balance'));
  assert.ok(!missing({ sale: sale({ balance_paid_date: at(-1) }) }).includes('balance'));
  assert.ok(!missing({ sale: sale({ balance_due_date: at(5) }) }).includes('balance'));
});

test('contract: one signed on the sale', () => {
  assert.ok(missing({ contracts: [{ status: 'sent' }] }).includes('contract'));
  assert.ok(missing({ contracts: [{ status: 'signed', is_archived: true }] }).includes('contract'));
  assert.ok(!missing({ contracts: [{ status: 'sent' }, { status: 'signed' }] }).includes('contract'));
});

test('feeding: the litter\'s override or a breed schedule', () => {
  assert.ok(!missing({ litter: { feeding_schedule_override: 'Lean' } }).includes('feeding'));
  assert.ok(!missing({ hasBreedSchedule: true }).includes('feeding'));
  assert.ok(missing({ litter: { feeding_schedule_override: '  ' } }).includes('feeding'));
});

test('doneText and missingFor', () => {
  const r = ready({ pup: pup({ microchip_id: '1' }) });
  assert.equal(P.doneText(r), '2 of 10 done', 'chip and registration');
  const rows = [{ pup: { id: 'a' }, ready: r }, { pup: { id: 'b' }, ready: ready({ pup: pup({ microchip_id: '' }) }) }];
  assert.deepEqual(P.missingFor(rows, 'chip').map((x) => x.pup.id), ['b']);
});

test('the drop-off defaults to the ready date, or today once it has passed', () => {
  assert.equal(P.pickupDefault({ estimated_ready_date: at(10) }, today), at(10));
  assert.equal(P.pickupDefault({ estimated_ready_date: at(-2) }, today), today);
  assert.equal(P.pickupDefault({}, today), today);
});

test('goHome.pickupEvent: a method other than Local pickup is a drop-off', () => {
  const p = { id: 'p' };
  const s = { buyer_contact_id: 'buyer' };
  assert.equal(H.pickupEvent(p, s, today).title, H.PICKUP_TITLE);
  assert.deepEqual(H.pickupEvent(p, s, today).details, {});
  assert.equal(H.pickupEvent(p, s, today, '', 'Local pickup').title, H.PICKUP_TITLE);
  const e = H.pickupEvent(p, s, today, '10am', 'Flight nanny');
  assert.equal(e.title, H.DROPOFF_TITLE);
  assert.deepEqual(e.details, { placement_time: '10am', dropoff_method: 'Flight nanny' });
  assert.equal(e.related_contact_id, 'buyer');
});

test('optional items are checked only when ticked', () => {
  assert.deepEqual(missing({ checks: [] }), ['shots', 'deworm', 'pickup', 'balance', 'contract']);
  assert.deepEqual(missing({ checks: ['litter_reg'] }), ['litter_reg', 'shots', 'deworm', 'pickup', 'balance', 'contract']);
  assert.deepEqual(P.optionalItems(PRO).map((i) => i.key), ['chip', 'litter_reg', 'pup_reg', 'feeding']);
  assert.deepEqual(P.optionalItems({}).map((i) => i.key), ['chip', 'litter_reg', 'pup_reg'], 'Lite has no feeding schedules');
});

test('litter registration number: the litter\'s, blank doesn\'t count', () => {
  assert.ok(!missing({ litter: { litter_registration_number: 'AKC-123' } }).includes('litter_reg'));
  assert.ok(missing({ litter: { litter_registration_number: '  ' } }).includes('litter_reg'));
});

test('planWithoutSale: Available or Placed pups with no sale going ahead, Placed first', () => {
  const row = (id, disposition, s = null) => ({ pup: { id, disposition }, sale: s });
  const rows = [
    row('a', 'available'), row('b', 'placed'), row('c', 'keeping'), row('d', 'undecided'),
    row('e', 'placed', sale()), row('f', 'available', sale({ status: 'cancelled' })), row('g', 'placed', sale({ is_archived: true }))
  ];
  assert.deepEqual(P.planWithoutSale(rows).map((r) => r.pup.id), ['b', 'g', 'a', 'f']);
});

test('pup registration: both the registered name and the number', () => {
  const m = (p) => missing({ pup: pup(p), checks: ['pup_reg'] }).includes('pup_reg');
  assert.ok(m({}));
  assert.ok(m({ registered_name: 'Thornfield Cedar' }), 'a name alone isn\'t enough');
  assert.ok(m({ registration_number: 'AKC1' }), 'a number alone isn\'t enough');
  assert.ok(!m({ registered_name: 'Thornfield Cedar', registration_number: 'AKC1' }));
});
