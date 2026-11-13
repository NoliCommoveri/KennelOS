// paymentScheduleData.test.js — a sale's payment statement as the pages load it
// (incomeView.getSaleStatement, Payment Schedule plan §4) over the real sample data,
// and the reference guard on an account a recorded payment came in through.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let saleRepo, accountRepo, kennelRepo, getSaleStatement, findBlockingReferences, ACCOUNT_REFERENCES, daysFromToday, savedSchedules;

before(async () => {
  await installMemoryDb();
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ accountRepo } = await import('../shared/data/accountRepo.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ getSaleStatement } = await import('../shared/data/incomeView.js'));
  ({ findBlockingReferences, ACCOUNT_REFERENCES } = await import('../shared/data/referenceRegistry.js'));
  ({ daysFromToday } = await import('../shared/data/dateUtils.js'));
  ({ savedSchedules } = await import('../shared/data/paymentSchedule.js'));
  const { seedSampleData } = await import('../shared/data/sampleData.js');
  await seedSampleData();
});

const cedarSale = async () => (await saleRepo.getAll()).find((s) => Array.isArray(s.payment_schedule) && s.payment_schedule.length === 2);

test('the sample sale with a schedule: half the price by next week counting the deposit, the rest on the balance due date', async () => {
  const sale = await cedarSale();
  assert.ok(sale, 'the sample has a sale with a payment schedule');
  const { statement } = await getSaleStatement(sale.id);
  assert.equal(statement.hasSchedule, true);
  const [first, last] = statement.dueDates;
  assert.equal(first.date, daysFromToday(7));
  assert.equal(first.threshold, 1400);
  assert.equal(first.ask, 900, 'the $500 deposit counts toward half of $2,800');
  assert.equal(first.owed, 900);
  assert.equal(last.date, daysFromToday(21));
  assert.equal(statement.remaining, 2800 + 250 + 25 * 10 + 150 - 500);
  assert.equal(Math.round((statement.deposit.owed + first.owed + last.owed) * 100) / 100, statement.remaining);
});

test('getSaleStatement takes a sale or its id, and null for none', async () => {
  const sale = await cedarSale();
  assert.equal((await getSaleStatement(sale)).statement.total, (await getSaleStatement(sale.id)).statement.total);
  assert.equal(await getSaleStatement('no-such-sale'), null);
});

test('a sale without a schedule reads as today: everything due once, at pickup when there\'s no balance due date', async () => {
  const sale = (await saleRepo.getAll()).find((s) => !s.payment_schedule && !s.balance_due_date && s.status === 'deposit_paid');
  assert.ok(sale, 'the sample has an open sale with no schedule and no balance due date');
  const loaded = await getSaleStatement(sale.id);
  assert.equal(loaded.statement.hasSchedule, false);
  assert.equal(loaded.statement.dueDates.length, 1);
  assert.equal(loaded.statement.dueDates[0].date, loaded.pickupDate);
  assert.equal(loaded.statement.dueDates[0].owed, loaded.statement.remaining - (loaded.statement.deposit?.owed || 0) - loaded.statement.ownDated.reduce((t, o) => t + o.owed, 0));
});

test('the sample kennel\'s saved schedule reads back', async () => {
  const kennel = (await kennelRepo.getAll()).find((k) => Array.isArray(k.payment_schedules));
  const list = savedSchedules(kennel);
  assert.deepEqual(list.map((x) => x.name), ['Transported pup']);
  assert.equal(list[0].steps.length, 1);
});

test('an account a recorded payment came in through can\'t be deleted', async () => {
  const account = await accountRepo.create({ name: 'Zelle', account_type: 'payment_service' });
  const other = await accountRepo.create({ name: 'Venmo', account_type: 'payment_service' });
  const sale = await cedarSale();
  await saleRepo.update(sale.id, { payments: [{ id: 'p1', amount: 300, date: daysFromToday(-1), account_id: account.id }] });
  const blockers = await findBlockingReferences(ACCOUNT_REFERENCES, account.id);
  assert.deepEqual(blockers, [{ label: 'a payment received on a sale', count: 1 }]);
  assert.deepEqual(await findBlockingReferences(ACCOUNT_REFERENCES, other.id), []);
  const { statement } = await getSaleStatement(sale.id);
  assert.equal(statement.received.find((r) => r.kind === 'payment').amount, 300);
  await saleRepo.update(sale.id, { payments: [] });
});

test('Financials reads every sale as its Payments card does: anticipated (credits aside) is what the statement says is left', async () => {
  const { getIncomeRows } = await import('../shared/data/incomeView.js');
  const rows = (await getIncomeRows()).filter((r) => r.source_type === 'sale');
  assert.ok(rows.length > 3);
  for (const r of rows) {
    const { statement } = await getSaleStatement(r.source_id);
    if (statement.ended) continue;
    const owed = r.components.filter((c) => c.state === 'anticipated' && !c.credited && c.component !== 'processing_fee').reduce((t, c) => t + c.amount, 0);
    assert.equal(Math.round(owed * 100) / 100, statement.remaining, r.dog);
  }
  // The sample sale with a schedule: what's owed by its first due date is on that date.
  const cedar = await cedarSale();
  const row = rows.find((r) => r.source_id === cedar.id);
  const first = row.components.filter((c) => c.state === 'anticipated' && c.due === daysFromToday(7));
  assert.equal(first.reduce((t, c) => t + c.amount, 0), 900);
});
