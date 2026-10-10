// processingFees.test.js — a sales channel's processing fee (Integrations plan §5):
// the rate math (percentage + fixed, either may be zero), the price that nets a
// set amount, and how the fee comes off earned income in Financials without ever
// touching the invoice's buyer-facing lines. Plus the Account rate validation and
// the delete guard for an account a sale went through.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { feeRate, isUsableRate, processingFee, priceToNet, netOf, rateLabel } from '../shared/data/processingFees.js';

// --- The math (pure) -----------------------------------------------------------

test('a rate is a percentage plus a fixed amount; either part may be zero', () => {
  assert.deepEqual(feeRate({ fee_percent: 6.25, fee_fixed: 5 }), { percent: 6.25, fixed: 5 });
  assert.deepEqual(feeRate({ fee_percent: '6.25', fee_fixed: '' }), { percent: 6.25, fixed: 0 });
  assert.deepEqual(feeRate({ fee_percent: null, fee_fixed: 25 }), { percent: 0, fixed: 25 });
  assert.equal(feeRate({ fee_percent: '', fee_fixed: null }), null, 'no fee at all');
  assert.equal(feeRate(null), null);
  assert.equal(isUsableRate({ percent: 100, fixed: 0 }), false, 'a 100% fee leaves nothing to net');
  assert.equal(isUsableRate({ percent: -1, fixed: 0 }), false);
});

test('the fee is price × percent + fixed, to the cent', () => {
  assert.equal(processingFee(3200, { percent: 6.25, fixed: 0 }), 200);
  assert.equal(processingFee(2800, { percent: 6.25, fixed: 5 }), 180);
  assert.equal(processingFee(1000, { percent: 2.9, fixed: 0.3 }), 29.3);
  assert.equal(processingFee(1000, { percent: 0, fixed: 25 }), 25, 'a flat fee alone');
  assert.equal(processingFee('', { percent: 6.25, fixed: 5 }), null, 'no price, no fee');
  assert.equal(processingFee(1000, null), null);
});

test('the price that nets a set amount divides by (1 − percent), not adds the percent on top', () => {
  const goodDog = { percent: 6.25, fixed: 0 };
  assert.equal(priceToNet(3000, goodDog), 3200);
  // Adding 6.25% on top falls short: $3,187.50 nets $2,988.28.
  assert.equal(netOf(3187.5, processingFee(3187.5, goodDog)), 2988.28);
  assert.equal(netOf(3200, processingFee(3200, goodDog)), 3000);
  // With a fixed part too: (3000 + 5) / 0.9375 = 3205.333… → rounded UP to the cent.
  const withFixed = { percent: 6.25, fixed: 5 };
  const price = priceToNet(3000, withFixed);
  assert.equal(price, 3205.34);
  assert.ok(netOf(price, processingFee(price, withFixed)) >= 3000, 'never nets less than asked');
  assert.equal(priceToNet(100, { percent: 0, fixed: 25 }), 125, 'a flat fee is simply added');
  assert.equal(priceToNet(0, goodDog), null);
  assert.equal(priceToNet(3000, { percent: 100, fixed: 0 }), null);
});

test('a rate reads as "6.25% + $5.00"', () => {
  assert.equal(rateLabel({ percent: 6.25, fixed: 5 }), '6.25% + $5.00');
  assert.equal(rateLabel({ percent: 2.9, fixed: 0.3 }), '2.9% + $0.30');
  assert.equal(rateLabel({ percent: 0, fixed: 25 }), '$25.00');
  assert.equal(rateLabel({ percent: 6.25, fixed: 0 }), '6.25%');
  assert.equal(rateLabel(null), '');
});

// --- Income, invoice and the delete guard (in-memory database) ------------------

let db; let kennelRepo; let dogRepo; let contactRepo; let saleRepo; let accountRepo; let income;
let K; let pup; let buyer; let channel;

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ accountRepo } = await import('../shared/data/accountRepo.js'));
  income = await import('../shared/data/incomeView.js');
});

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true });
  pup = await dogRepo.create({ call_name: 'Cedar', sex: 'male', breed: 'Boston Terrier', ownership_type: 'owned', status: 'puppy', kennel_id: K.id });
  buyer = await contactRepo.create({ name: 'Jamal' });
  channel = await accountRepo.create({ name: 'Good Dog', account_type: 'marketplace', fee_percent: 6.25, fee_fixed: 0 });
});

const makeSale = (over = {}) => saleRepo.create({
  kennel_id: K.id, dog_id: pup.id, buyer_contact_id: buyer.id, registration_type: 'limited',
  price: 3200, deposit_amount: 800, deposit_date: '2026-09-01', status: 'deposit_paid',
  sales_channel_account_id: channel.id, processing_fee_amount: 200, fee_passed_to_buyer: true, ...over
});

const saleRow = async () => (await income.getIncomeRows()).find((r) => r.source_type === 'sale');
const feeLines = (row) => row.components.filter((c) => c.component === 'processing_fee');

test('the fee comes off income, split with the payments it was taken from', async () => {
  await makeSale();
  const row = await saleRow();
  // Deposit $800 earned, balance $2,400 anticipated: a quarter of the fee is earned.
  assert.deepEqual(feeLines(row).map((c) => [c.amount, c.state]), [[-50, 'earned'], [-150, 'anticipated']]);
  assert.equal(row.earned, 750);
  assert.equal(row.anticipated, 2250);
  assert.equal(row.processing_fee, 200);
  assert.equal(feeLines(row)[0].when, '2026-09-01', 'filed with the deposit it came out of');
});

test('a sale paid in full nets exactly price − fee, whatever the rounding', async () => {
  await makeSale({ price: 3205.34, deposit_amount: 1000, processing_fee_amount: 205.33, status: 'paid_in_full', balance_paid_date: '2026-10-01', transport_fee: 250 });
  const row = await saleRow();
  assert.equal(Math.round(feeLines(row).reduce((t, c) => t + c.amount, 0) * 100) / 100, -205.33);
  assert.equal(Math.round(row.earned * 100) / 100, Math.round((3205.34 + 250 - 205.33) * 100) / 100);
  assert.equal(row.anticipated, 0);
});

test('a cancelled sale keeps only the paid share of the fee; a lost sale has none', async () => {
  const s = await makeSale({ status: 'cancelled' });
  let row = await saleRow();
  assert.deepEqual(feeLines(row).map((c) => [c.amount, c.state]), [[-50, 'earned']], 'the deposit stays, and so does its share of the fee');
  await saleRepo.update(s.id, { status: 'voided', end_reason: 'pup_died' });
  assert.equal(await saleRow(), undefined, 'a voided sale counts nothing, fee included');
});

test('the invoice and what the buyer has paid never show the fee', async () => {
  const s = await makeSale();
  const lines = income.incomeLineItems('sale', s);
  assert.ok(!lines.some((c) => c.component === 'processing_fee'));
  assert.equal(lines.reduce((t, c) => t + c.amount, 0), 3200, 'the buyer\'s price, gross');
  assert.equal(income.paidOnSale(s), 800);
});

test('the fee shows as its own negative line in the income breakdown, and never as money owed', async () => {
  await makeSale();
  const { totals, byComponent } = income.summarize(await income.getIncomeRows());
  assert.deepEqual(byComponent.get('processing_fee'), { earned: -50, anticipated: -150, pick: 0 });
  assert.equal(totals.earned, 750);
  const { incomeEntries, receivableRows } = await import('../shared/data/moneyReport.js');
  const owed = receivableRows(incomeEntries(await income.getIncomeRows()), '2026-10-10');
  assert.ok(!owed.some((r) => r.component === 'processing_fee'), 'the buyer still owes the full balance');
  assert.equal(owed.reduce((t, r) => t + r.amount, 0), 2400);
});

test('no fee, no fee lines: a direct sale is unchanged', async () => {
  await makeSale({ sales_channel_account_id: null, processing_fee_amount: null });
  const row = await saleRow();
  assert.equal(feeLines(row).length, 0);
  assert.equal(row.earned, 800);
  assert.equal(row.processing_fee, 0);
});

test('an account a sale went through can only be archived', async () => {
  await makeSale();
  const blockers = await accountRepo.getDeleteBlockers(channel.id);
  assert.deepEqual(blockers.map((b) => b.label), ['sales channel on a sale']);
  await assert.rejects(() => accountRepo.hardDelete(channel.id));
});

test('an account\'s rate must be a percentage below 100 and a fixed amount of 0 or more', async () => {
  await assert.rejects(() => accountRepo.create({ name: 'X', fee_percent: 100 }), /less than 100/);
  await assert.rejects(() => accountRepo.create({ name: 'X', fee_percent: -1 }), /0 or more/);
  await assert.rejects(() => accountRepo.create({ name: 'X', fee_fixed: -5 }), /negative/);
  await accountRepo.update(channel.id, { fee_percent: null, fee_fixed: '' });
  assert.equal(feeRate(await accountRepo.getById(channel.id)), null, 'clearing the rate is fine');
});
