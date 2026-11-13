// A family's payments on their status page (Payment Schedule plan §7): her device
// publishes the sale's statement as the family may see it; the Worker copies it field
// by field, only for a family with an open sale.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { paymentsOf, statusView } = await import('../src/familyPages.js');

const view = {
  total: 3200, paid: 950, remaining: 2250,
  deposit: { amount: 500, owed: 0, date: '2026-11-01', state: 'met' },
  due: [
    { label: 'Payment 1', date: '2026-12-04', at_pickup: false, amount: 900, owed: 450, final: false, state: 'next' },
    { label: 'Final payment', date: null, at_pickup: true, amount: 1800, owed: 1800, final: true, state: 'later' }
  ],
  own: [{ label: 'Photo package', amount: 100, owed: 0, date: '2026-11-20', state: 'met' }],
  received: [
    { date: '2026-10-01', label: 'Deposit (credited)', amount: 200 },
    { date: '2026-11-01', label: 'Deposit', amount: 300 },
    { date: '2026-11-10', label: 'Remaining Purchase Price', amount: 450 }
  ],
  next: { label: 'Payment 1', date: '2026-12-04', at_pickup: false, owed: 450, final: false, deposit: false },
  how_to_pay: 'Zelle to 555-0100', final_methods: 'Cash or Zelle only'
};

test('paymentsOf keeps the published fields and nothing else', () => {
  const out = paymentsOf({ ...view, notes: 'her private note', buyer_phone: '555', due: [{ ...view.due[0], step: { percent: 50 } }] });
  assert.equal(out.notes, undefined);
  assert.equal(out.buyer_phone, undefined);
  assert.equal(out.due[0].step, undefined);
  assert.deepEqual(Object.keys(out).sort(), ['deposit', 'due', 'final_methods', 'how_to_pay', 'next', 'own', 'paid', 'received', 'remaining', 'total']);
  assert.deepEqual(paymentsOf(view).received, view.received);
  assert.deepEqual(paymentsOf(view).next, view.next);
});

test('paymentsOf drops junk: bad dates, states, amounts; nothing at all for a $0 sale', () => {
  const out = paymentsOf({ ...view, deposit: { amount: -5, owed: 'x', date: 'soon', state: 'overdue' }, received: [{ date: 'x', label: 7, amount: 0 }, null] });
  assert.deepEqual(out.deposit, { amount: 0, owed: 0, date: null, state: 'later' });
  assert.deepEqual(out.received, []);
  assert.equal(paymentsOf({ ...view, total: 0 }), null);
  assert.equal(paymentsOf(null), null);
  assert.equal(paymentsOf('x'), null);
});

const projection = (entry) => ({ kennel: { name: 'Thornfield' }, entries: { e1: entry }, litters: {}, public_list: [] });

test('only a family with an open sale gets the card', () => {
  const placed = statusView(projection({ name: 'Ann', status: 'placed', companion: { available: true, request: null }, payments: view }), 'e1');
  assert.equal(placed.family.payments.total, 3200);
  const onList = statusView(projection({ name: 'Ann', status: 'active', companion: { available: true, request: null }, payments: view }), 'e1');
  assert.equal(onList.family.payments.remaining, 2250, 'a family whose pick awaits the deposit sees it too');
  const noSale = statusView(projection({ name: 'Ann', status: 'placed', payments: view }), 'e1');
  assert.equal(noSale.family.payments, undefined);
});
