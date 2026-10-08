// saleStatus.test.js — the `voided` sale status (a sale that fell through on the
// kennel's side, e.g. the pup died before going home) beside `cancelled` (the buyer
// backed out): both close the sale and free the pup, but only a cancelled sale
// keeps a paid deposit as earned income (Financials §21).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { SALE_STATUS, RELEASED_SALE_STATUSES, TERMINAL_SALE_STATUSES, isOpenSale, descriptor } from '../shared/data/vocab.js';

let incomeLineItems;
before(async () => {
  await installMemoryDb();
  ({ incomeLineItems } = await import('../shared/data/incomeView.js'));
});

const sale = (over = {}) => ({ id: 's', dog_id: 'd', price: 2000, deposit_amount: 500, deposit_date: '2026-09-01', ...over });

test('voided is a sale status that closes the sale and releases the pup', () => {
  assert.equal(descriptor(SALE_STATUS, 'voided').label, 'Voided');
  assert.ok(RELEASED_SALE_STATUSES.includes('voided'));
  assert.ok(TERMINAL_SALE_STATUSES.includes('voided'));
  assert.ok(TERMINAL_SALE_STATUSES.includes('delivered'));
  assert.ok(!RELEASED_SALE_STATUSES.includes('delivered'), 'a delivered pup is not released');
  assert.equal(isOpenSale(sale({ status: 'voided' })), false);
  assert.equal(isOpenSale(sale({ status: 'deposit_paid' })), true);
});

test('a cancelled sale keeps its paid deposit as earned; a voided one counts nothing', () => {
  assert.deepEqual(incomeLineItems('sale', sale({ status: 'cancelled' })).map((c) => [c.component, c.amount, c.state]),
    [['deposit', 500, 'earned']], 'the buyer backed out: the deposit stays, the unpaid balance is dropped');
  assert.deepEqual(incomeLineItems('sale', sale({ status: 'voided' })), [], 'the kennel voided it: nothing is income');
  assert.deepEqual(incomeLineItems('sale', sale({ status: 'voided', balance_paid_date: '2026-09-20' })), []);
});
