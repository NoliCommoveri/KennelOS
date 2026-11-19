// saleRefunds.test.js — review batch G: a partial refund on a sale that ended
// (K10-11, R4) and the Sale page's "You net" read from the ledger (K10-10).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let dogRepo; let contactRepo; let saleRepo; let waitlistEntryRepo; let income;
let K; let pup; let buyer;

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js'));
  income = await import('../shared/data/incomeView.js');
});

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true });
  pup = await dogRepo.create({ call_name: 'Ruby', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'puppy', kennel_id: K.id });
  buyer = await contactRepo.create({ name: 'Jamal' });
});

const makeSale = (over = {}) => saleRepo.create({
  kennel_id: K.id, dog_id: pup.id, buyer_contact_id: buyer.id, registration_type: 'limited',
  price: 3000, deposit_amount: 500, deposit_date: '2026-03-01', balance_paid_date: '2026-05-01',
  sale_date: '2026-03-01', status: 'paid_in_full', ...over
});
const saleRow = async (id) => (await income.getIncomeRows()).find((r) => r.source_id === id);
const refundLines = (row) => row.components.filter((c) => c.component === 'refund');

// --- K10-11: a partial refund ---------------------------------------------------

test('a $1,000 refund on a returned $3,000 sale leaves $2,000 earned, the refund on its date', async () => {
  const s = await makeSale();
  await saleRepo.update(s.id, { status: 'returned', end_reason: 'buyer_choice', refund_amount: 1000, refund_date: '2026-08-10' });
  const row = await saleRow(s.id);
  assert.equal(row.earned, 2000);
  assert.equal(row.anticipated, 0);
  assert.deepEqual(refundLines(row).map((c) => [c.amount, c.state, c.when]), [[-1000, 'earned', '2026-08-10']]);
  // Filed by month: the refund comes off August, the money stays in March and May.
  const { incomeEntries } = await import('../shared/data/moneyReport.js');
  const aug = incomeEntries([row]).filter((e) => e.date.startsWith('2026-08'));
  assert.equal(aug.reduce((t, e) => t + e.amount, 0), -1000);
});

test('a refund on a cancelled sale comes off the deposit she kept', async () => {
  const s = await makeSale({ status: 'cancelled', balance_paid_date: null, refund_amount: 200, refund_date: '2026-04-01' });
  assert.equal((await saleRow(s.id)).earned, 300);
});

test('a refund never takes a sale below nothing', async () => {
  const s = await makeSale({ status: 'cancelled', balance_paid_date: null, refund_amount: 900, refund_date: '2026-04-01' });
  const row = await saleRow(s.id);
  assert.equal(row.earned, 0);
  assert.deepEqual(refundLines(row).map((c) => c.amount), [-500]);
});

test('a lost sale already counts nothing, so a refund on it changes nothing', async () => {
  const s = await makeSale({ status: 'returned', end_reason: 'health_problem', refund_amount: 3000, refund_date: '2026-08-10' });
  const row = await saleRow(s.id);
  assert.equal(row ? row.earned : 0, 0);
  assert.equal(row ? refundLines(row).length : 0, 0);
});

test('only an ended sale that kept money carries a refund; reopening it clears one', async () => {
  const { canRecordRefund } = await import('../shared/data/vocab.js');
  assert.equal(canRecordRefund({ status: 'returned', end_reason: 'buyer_choice' }), true);
  assert.equal(canRecordRefund({ status: 'cancelled' }), true);
  assert.equal(canRecordRefund({ status: 'returned', end_reason: 'health_problem' }), false);
  assert.equal(canRecordRefund({ status: 'voided', end_reason: 'pup_died' }), false);
  assert.equal(canRecordRefund({ status: 'paid_in_full' }), false);

  const s = await makeSale({ status: 'returned', end_reason: 'buyer_choice', refund_amount: 1000, refund_date: '2026-08-10' });
  const back = await saleRepo.update(s.id, { status: 'delivered' });
  assert.equal(back.refund_amount, null);
  assert.equal(back.refund_date, null);
  // On a new sale with an open status it's never stored.
  const fresh = await makeSale({ status: 'deposit_paid', refund_amount: 50 });
  assert.equal(fresh.refund_amount ?? null, null);
});

test('a negative refund or a malformed date is refused', async () => {
  await assert.rejects(makeSale({ status: 'cancelled', refund_amount: -5, refund_date: '2026-04-01' }), /refund/i);
  await assert.rejects(makeSale({ status: 'cancelled', refund_amount: 5, refund_date: '04/01/2026' }), /refund/i);
});

test('the refund fields are private, like the price', async () => {
  const { SYNC_REGISTRY } = await import('../shared/data/syncRegistry.js');
  assert.ok(SYNC_REGISTRY.sales.private.includes('refund_amount'));
  assert.ok(SYNC_REGISTRY.sales.private.includes('refund_date'));
});

// --- K10-10: "You net" from the ledger -------------------------------------------

test('"You net" counts a fee charged back as an extra: price − fee + extra', async () => {
  // PayPal took $17.94; she added it as an extra so the family pays it.
  const s = await makeSale({ status: 'deposit_paid', balance_paid_date: null, processing_fee_amount: 17.94,
    extra_charges: [{ id: 'pp', label: 'PayPal fee', amount: 17.94 }] });
  assert.equal(await income.getSaleNet(s.id), 3000);
});

test('"You net" includes the application fee credited to the price (the review\'s scenario)', async () => {
  await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: buyer.id, status: 'approved', applied_date: '2026-02-01',
    fee_amount: 100, fee_received_date: '2026-02-02', fee_credit_policy: 'credited_to_purchase' });
  const s = await makeSale({ status: 'deposit_paid', balance_paid_date: null, processing_fee_amount: 90,
    extra_charges: [{ id: 'photo', label: 'Photo package', amount: 150 }] });
  // $3,000 + $150 − $90; the $100 fee is earned on the family's row but is part of this price.
  assert.equal(await income.getSaleNet(s.id), 3060);
});

test('"You net" takes off a refund', async () => {
  const s = await makeSale({ status: 'returned', end_reason: 'buyer_choice', processing_fee_amount: 90, refund_amount: 1000, refund_date: '2026-08-10' });
  assert.equal(await income.getSaleNet(s.id), 1910);
});

test('getSaleNet reads one sale whatever kennel the app is scoped to, and null for none', async () => {
  const s = await makeSale();
  assert.equal(await income.getSaleNet(s.id), 3000);
  assert.equal(await income.getSaleNet('nope'), null);
});
