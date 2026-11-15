// litterFinances.test.js — the Litter P&L (data/litterFinances.js) over the real repos
// and income rows: a sale that fell through keeps the money it kept, but isn't a puppy
// sold (review K10-3).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let kennelRepo; let dogRepo; let contactRepo; let litterRepo; let saleRepo; let getLitterFinances;

before(async () => {
  await installMemoryDb();
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ litterRepo } = await import('../shared/data/litterRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ getLitterFinances } = await import('../shared/data/litterFinances.js'));
});

test('a pup sold, the sale cancelled with the deposit kept, then sold again: one puppy sold', async () => {
  const K = await kennelRepo.create({ kennel_name: 'Oak Hill', is_own_kennel: true });
  const dog = (o) => dogRepo.create({ breed: 'Boxer', ownership_type: 'owned', kennel_id: K.id, ...o });
  const dam = await dog({ call_name: 'Hazel', sex: 'female', status: 'active_breeding' });
  const sire = await dog({ call_name: 'Rocco', sex: 'male', status: 'active_breeding' });
  const l = await litterRepo.create({ kennel_id: K.id, dam_id: dam.id, sire_id: sire.id, status: 'ready', whelp_date: '2026-08-01' });
  const cedar = await dog({ call_name: 'Cedar', sex: 'male', status: 'puppy', litter_id: l.id, date_of_birth: '2026-08-01' });
  const a = await contactRepo.create({ name: 'First family' });
  const b = await contactRepo.create({ name: 'Second family' });
  const base = { kennel_id: K.id, dog_id: cedar.id, registration_type: 'limited', price: 3000, deposit_amount: 500, deposit_date: '2026-09-01' };
  await saleRepo.create({ ...base, buyer_contact_id: a.id, status: 'cancelled' });
  await saleRepo.create({ ...base, buyer_contact_id: b.id, status: 'deposit_paid', deposit_date: '2026-10-01' });
  const [row] = (await getLitterFinances()).filter((r) => r.litterId === l.id || r.id === l.id || r.litter?.id === l.id);
  assert.ok(row, 'the litter has a row');
  assert.equal(row.puppiesSold, 1);
  assert.equal(row.earned, 1000, 'both deposits: the kept one and the new one');
  assert.equal(row.anticipated, 2500);
});

// Review K10-5: a sale with no dates counted in the Overview but in no report.
test('a sale typed in with no dates is filed under the day it was entered', async () => {
  const { getIncomeRows } = await import('../shared/data/incomeView.js');
  const { incomeEntries } = await import('../shared/data/moneyReport.js');
  const K = await kennelRepo.create({ kennel_name: 'Undated', is_own_kennel: true });
  const pup = await dogRepo.create({ call_name: 'Nodate', breed: 'Boxer', sex: 'female', ownership_type: 'owned', status: 'puppy', kennel_id: K.id });
  const buyer = await contactRepo.create({ name: 'Old buyer' });
  const s = await saleRepo.create({ kennel_id: K.id, dog_id: pup.id, buyer_contact_id: buyer.id, registration_type: 'limited', price: 3000, status: 'paid_in_full' });
  const rows = (await getIncomeRows()).filter((r) => r.source_id === s.id);
  const entries = incomeEntries(rows);
  assert.ok(entries.length > 0);
  for (const e of entries) assert.equal(e.date, s.created_at.slice(0, 10));
  assert.equal(entries.reduce((t, e) => t + (e.state === 'earned' ? e.amount : 0), 0), 3000);
});

// Review K10-6: a custom range took whole months by their 1st (Mar 15 – Apr 10 showed all
// of April and none of March).
test('Profit & Loss over a custom range counts exactly the money dated inside it', async () => {
  const { loadProfitLoss } = await import('../shared/data/reportSources.js');
  const { expenseRepo } = await import('../shared/data/expenseRepo.js');
  const K = await kennelRepo.create({ kennel_name: 'Ranges', is_own_kennel: true });
  const pup = await dogRepo.create({ call_name: 'Range', breed: 'Boxer', sex: 'female', ownership_type: 'owned', status: 'puppy', kennel_id: K.id });
  const buyer = await contactRepo.create({ name: 'Range buyer' });
  await saleRepo.create({ kennel_id: K.id, dog_id: pup.id, buyer_contact_id: buyer.id, registration_type: 'limited', price: 3000, deposit_amount: 500,
    deposit_date: '2025-03-20', status: 'deposit_paid', payments: [{ id: 'p1', amount: 700, date: '2025-04-20' }] });
  await expenseRepo.create({ kennel_id: K.id, subject_type: 'kennel', subject_id: K.id, category: 'vet', amount: 80, expense_date: '2025-03-10', description: 'before the range' });
  await expenseRepo.create({ kennel_id: K.id, subject_type: 'kennel', subject_id: K.id, category: 'vet', amount: 40, expense_date: '2025-04-05', description: 'inside' });
  const src = await loadProfitLoss('2025-12-31');
  const rows = src.rowsIn({ from: '2025-03-15', to: '2025-04-10' });
  assert.deepEqual(rows.map((m) => m.period), ['2025-04', '2025-03']);
  const by = Object.fromEntries(rows.map((m) => [m.period, m]));
  assert.equal(by['2025-03'].income, 500, 'the deposit of Mar 20 is in');
  assert.equal(by['2025-03'].expenses, 0, 'the vet bill of Mar 10 is out');
  assert.equal(by['2025-04'].income, 0, 'the payment of Apr 20 is out');
  assert.equal(by['2025-04'].expenses, 40);
  assert.equal(src.rowsIn({}).length, src.rows.length, 'all time: the same rows');
});

// Review K10-8: a credited application fee left the litter until the deposit was in.
test('a fee credited toward a side sale waiting on its deposit is on that pup\'s litter', async () => {
  const { waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js');
  const K = await kennelRepo.create({ kennel_name: 'Side', is_own_kennel: true });
  const dog = (o) => dogRepo.create({ breed: 'Boxer', ownership_type: 'owned', kennel_id: K.id, ...o });
  const dam = await dog({ call_name: 'Mae', sex: 'female', status: 'active_breeding' });
  const sire = await dog({ call_name: 'Bo', sex: 'male', status: 'active_breeding' });
  const l = await litterRepo.create({ kennel_id: K.id, dam_id: dam.id, sire_id: sire.id, status: 'ready', whelp_date: '2026-08-01' });
  const willow = await dog({ call_name: 'Willow', sex: 'female', status: 'puppy', litter_id: l.id, date_of_birth: '2026-08-01' });
  const fam = await contactRepo.create({ name: 'Side family' });
  await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: fam.id, status: 'approved', applied_date: '2026-07-01',
    fee_amount: 100, fee_received_date: '2026-07-02', fee_credit_policy: 'credited_to_purchase' });
  await saleRepo.create({ kennel_id: K.id, dog_id: willow.id, buyer_contact_id: fam.id, registration_type: 'limited', price: 3000, deposit_amount: 500, status: 'deposit_pending' });
  const row = (await getLitterFinances()).find((r) => r.litter?.id === l.id);
  assert.equal(row.earned, 100, 'the fee, earned');
  assert.equal(row.anticipated, 2900, 'the rest of the price');
  assert.equal(row.puppiesSold, 1);
});
