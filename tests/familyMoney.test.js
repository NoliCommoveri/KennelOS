// familyMoney.test.js — a family's invoices and receipts (Payment Schedule plan §6,
// build step 4; data/familyMoney.js): the two named regressions (a paid deposit's
// receipt at $0, the deposit receipt missing when the fee covered it), every
// combination of fee, credits, deposit, payments, schedule, extras and status
// checked the way §6.3 lists, and the applicant page's documents read through the
// real document builder over the sample data.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { paymentStatement } from '../shared/data/paymentSchedule.js';
import { familyAccount, resolvePick, documentLines, familyDocs, FEE_KEY } from '../shared/data/familyMoney.js';
import { creditsOf, feeCharge, CREDIT_USE_VALUES } from '../shared/data/receivedCredits.js';

const TODAY = '2026-11-13';
const opts = (o = {}) => ({ birthDate: '2026-10-01', pickupDate: '2026-12-24', today: TODAY, depositDueDate: '2026-10-15', ...o });
const sale = (o = {}) => ({ id: 's1', status: 'deposit_paid', price: 2500, deposit_amount: 500, deposit_date: '2026-10-20', ...o });
const credit = (amount, date, applies_to = CREDIT_USE_VALUES, id = `c${amount}`) => ({ id, amount, date, applies_to });
const r2 = (n) => Math.round(n * 100) / 100;
const sum = (xs, f = (x) => x.amount) => r2(xs.reduce((t, x) => t + f(x), 0));
const final = { id: 'final', due: 'at_pickup', covers: ['all'], percent: 100, basis: 'total' };

// A family: the entry (its fee, credits) and its sale's statement, read as the app does.
function family({ s, entry = null, credited = false, toward = 'deposit' }) {
  const fee = entry && credited && entry.fee_received_date ? { amount: Number(entry.fee_amount), toward, date: entry.fee_received_date } : null;
  const statement = paymentStatement(s, opts({ feeCredit: fee, credits: entry ? creditsOf(entry) : [], feeCharges: entry ? feeCharge(entry) : [] }));
  return { account: familyAccount({ entry, statement, sale: s }), statement };
}
const receipt = (account, pick) => documentLines(account, { doc: 'receipt', money: resolvePick(account, 'receipt', pick) });
const invoice = (account, pick) => documentLines(account, { doc: 'invoice', lines: resolvePick(account, 'invoice', pick).map((ref) => ({ ref })) });

test('regression: a paid deposit\'s receipt prints the deposit, never $0', () => {
  const { account } = family({ s: sale() });
  const r = receipt(account, 'deposit');
  assert.deepEqual(r.rows.map((x) => [x.label, x.amount, x.date]), [['Deposit', 500, '2026-10-20']]);
  assert.deepEqual(r.totals.map((t) => [t.label, t.amount]), [['Total paid', 500]]);
});

test('regression: with the application fee credited toward the whole deposit, the deposit receipt is there, "(credited)"', () => {
  const entry = { id: 'e1', fee_amount: 500, fee_received_date: '2026-08-01', fee_payment_method: 'Venmo' };
  const { account } = family({ s: sale({ status: 'deposit_pending', deposit_date: null }), entry, credited: true });
  const docs = familyDocs(account);
  assert.ok(docs.some((d) => d.label === 'Deposit receipt' && d.pick === 'deposit'), 'the deposit receipt shows');
  assert.deepEqual(receipt(account, 'deposit').rows.map((x) => [x.label, x.amount]), [['Deposit (credited)', 500]]);
  // The fee is counted once: the family owes the price, not the fee on top.
  assert.equal(account.total, 2500);
  assert.equal(account.paid, 500);
  assert.equal(account.owed, 2000);
  assert.deepEqual(receipt(account, 'fee').rows.map((x) => [x.label, x.amount, x.method]), [['Waitlist application fee', 500, 'Venmo']]);
});

test('an invoice bills each line\'s whole amount, takes off what\'s paid and credited, and ends with the account summary', () => {
  const s = sale({ transport_fee: 300, payment_schedule: [{ id: 'half', due: 'at_weeks', n: 8, covers: ['price'], percent: 50 }, final], payments: [{ id: 'p1', amount: 400, date: '2026-11-05', method: 'Zelle' }] });
  const entry = { id: 'e1', received_credits: [credit(100, '2026-09-01', ['price'])] };
  const { account } = family({ s, entry });
  const next = invoice(account, 'next');
  // Half the price by Nov 26 asks $750 after the deposit; $100 credit and $400 paid leave $250.
  assert.deepEqual(next.rows.map((x) => [x.label, x.amount, x.dueDate]), [['Remaining Purchase Price', 750, '2026-11-26']]);
  assert.deepEqual(next.totals.map((t) => [t.label, t.amount]), [['Subtotal', 750], ['Less credit for funds already received', -100], ['Less amount already collected', -400], ['Balance', 250]]);
  assert.deepEqual(next.summary.map((t) => [t.label, t.amount]), [['Total', 2800], ['Paid to date', 1000], ['This invoice', 250], ['Still owed after it', 1550]]);
  assert.equal(next.rows[0].marker, '', 'no standing due-date footnote with a schedule');
  // A partial amount bills only that.
  const part = documentLines(account, { doc: 'invoice', lines: [{ ref: 'transport@final', amount: 100 }] });
  assert.deepEqual(part.rows.map((x) => [x.label, x.amount]), [['Transport Fee (partial)', 100]]);
  assert.equal(part.totals.at(-1).amount, 100);
  assert.equal(part.finalOnly, true, 'the final payment\'s own methods print on it');
});

test('a receipt for one payment prints what it paid, with its date and method', () => {
  const s = sale({ payments: [{ id: 'p1', amount: 2200, date: '2026-11-05', method: 'Zelle' }], transport_fee: 300 });
  const { account } = family({ s });
  const r = receipt(account, 'money:payment:p1');
  assert.deepEqual(r.rows.map((x) => [x.label, x.amount, x.method]), [['Remaining Purchase Price', 2000, 'Zelle'], ['Transport Fee', 200, 'Zelle']]);
  assert.ok(familyDocs(account).some((d) => d.pick === 'money:payment:p1'));
});

// --- Every combination (§6.3) -----------------------------------------------------------

test('every combination: receipts are exactly the money, never $0; they add up to paid to date; invoices bill what\'s owed', () => {
  const SCHEDULES = [undefined, [{ id: 'a', due: 'at_weeks', n: 8, covers: ['price', 'extras'], percent: 50 }, final],
    [{ id: 'a', due: 'on_date', due_date: '2026-12-01', covers: ['all'], amount: 600, prior_funds: 'dont_count' }, final]];
  const EXTRAS = [[], [{ id: 'x', label: 'Stay', amount: 900 }], [{ id: 'ph', label: 'Photos', amount: 150, own_due_dates: true }],
    [{ id: 't', label: 'Training', amount: 600, payments: [{ id: 'a', percent: 50, due: 'on_approval', due_date: '2026-11-01', paid_date: '2026-11-01' }, { id: 'b', percent: 50, due: 'before_pickup', n: 2 }] }]];
  const ENTRIES = [
    null,
    { id: 'e', fee_amount: 300, fee_received_date: '2026-08-01', fee_credit_policy: 'credited_to_purchase' },
    { id: 'e', fee_amount: 700, fee_received_date: '2026-08-01', fee_credit_policy: 'credited_to_purchase' },
    { id: 'e', fee_amount: 300, fee_received_date: null, received_credits: [credit(800, '2026-06-01')] },
    { id: 'e', fee_amount: 300, fee_received_date: '2026-08-01', fee_credit_amount: 300, received_credits: [credit(300, '2026-06-01', ['fee', 'price']), credit(5000, '2026-07-01')] }
  ];
  const PAYMENTS = [[], [{ id: 'p1', amount: 300, date: '2026-10-25' }, { id: 'p2', amount: 700, date: '2026-11-20' }], [{ id: 'p1', amount: 10000, date: '2026-11-05' }]];
  let n = 0;
  for (const status of ['deposit_pending', 'deposit_paid', 'paid_in_full', 'delivered', 'cancelled'])
  for (const schedule of SCHEDULES) for (const extras of EXTRAS) for (const entry of ENTRIES) for (const payments of PAYMENTS)
  for (const transport of [0, 250]) {
    n++;
    const s = sale({ status, deposit_date: status === 'deposit_pending' ? null : '2026-10-20', payment_schedule: schedule, extra_charges: extras, payments, transport_fee: transport,
      ...(status === 'paid_in_full' ? { balance_paid_date: '2026-12-01' } : {}) });
    const credited = entry?.fee_credit_policy === 'credited_to_purchase';
    const { account } = family({ s, entry, credited });
    const at = `${status} ${schedule?.length} ${extras[0]?.id} ${entry?.fee_amount}/${entry?.received_credits?.length} ${payments.length} ${transport}`;
    assert.equal(r2(account.paid + account.owed), account.total, at);
    // A receipt's lines are exactly the money ticked, never $0 and never missing.
    for (const m of account.money) {
      const r = receipt(account, `money:${m.ref}`);
      assert.ok(r.rows.length > 0 && r.rows.every((x) => x.amount > 0), `${at}: ${m.ref}`);
      assert.equal(sum(r.rows), m.amount, `${at}: ${m.ref}`);
      assert.equal(r.totals.at(-1).amount, m.amount, at);
    }
    // The receipts for all the money add up to paid to date (the fee credited toward
    // the price is the fee's money again, so it counts once).
    assert.equal(r2(sum(account.money) - account.feeCreditApplied), account.paid, at);
    // Everything owed, invoiced, is what's owed; the next payment's invoice is its amount.
    assert.equal(invoice(account, 'owed').totals.at(-1).amount, account.owed, at);
    if (account.next) assert.equal(invoice(account, 'next').totals.at(-1).amount, account.next.owed, at);
    else assert.equal(account.owed, 0, at);
    // Every document on the applicant page has lines and no $0 line.
    for (const d of familyDocs(account)) {
      const lines = d.doc === 'receipt' ? receipt(account, d.pick) : invoice(account, d.pick);
      assert.ok(lines.rows.length && lines.rows.every((x) => x.amount > 0), `${at}: ${d.label}`);
    }
    // The fee line, when there's a fee, is never billed twice.
    assert.ok(account.charges.filter((c) => c.key === FEE_KEY).length <= 1, at);
  }
  assert.equal(n, 5 * 3 * 4 * 5 * 3 * 2);
});

// --- The applicant page's documents, through the real document builder ------------------

let saleRepo, waitlistEntryRepo, buildInvoiceDoc, loadFamilyAccount;
before(async () => {
  await installMemoryDb();
  globalThis.document ??= { addEventListener() {} }; // invoiceDoc reaches ui.js
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js'));
  ({ buildInvoiceDoc } = await import('../shared/assets/invoiceDoc.js'));
  ({ loadFamilyAccount } = await import('../shared/data/familyMoney.js'));
  const { seedSampleData } = await import('../shared/data/sampleData.js');
  await seedSampleData();
});

test('the sample families\' documents: what the page lists is what the document prints', async () => {
  const entries = (await waitlistEntryRepo.getAll()).filter((e) => e.placed_sale_id || Number(e.fee_amount) > 0);
  assert.ok(entries.length > 2);
  let docs = 0;
  for (const e of entries) {
    const fam = await loadFamilyAccount({ entryId: e.id });
    for (const d of familyDocs(fam.account)) {
      docs++;
      const built = await buildInvoiceDoc({ source: 'family', entry: e.id, doc: d.doc, cfg: { v: 2, pick: d.pick } });
      const want = d.doc === 'receipt' ? receipt(fam.account, d.pick) : invoice(fam.account, d.pick);
      assert.deepEqual(built.rows.map((x) => x.amount), want.rows.map((x) => x.amount), `${e.id} ${d.label}`);
      assert.deepEqual(built.totals, want.totals, `${e.id} ${d.label}`);
      assert.deepEqual(built.summary, want.summary);
      assert.ok(built.rows.every((x) => x.amount > 0));
    }
  }
  assert.ok(docs > 3);
});

test('an older sale link reads as the sale\'s whole invoice; a waitlist link as the fee\'s', async () => {
  const s = (await saleRepo.getAll()).find((x) => x.status === 'deposit_paid');
  const d = await buildInvoiceDoc({ source: 'sale', id: s.id, doc: 'invoice' });
  const fam = await loadFamilyAccount({ saleId: s.id });
  assert.deepEqual(d.rows.map((x) => x.amount), invoice(fam.account, 'sale').rows.map((x) => x.amount));
  assert.equal(d.saleId, s.id);
  const e = (await waitlistEntryRepo.getAll()).find((x) => Number(x.fee_amount) > 0 && x.fee_received_date);
  const fee = await buildInvoiceDoc({ source: 'waitlist', id: e.id, doc: 'receipt' });
  assert.ok(fee.rows.length >= 1 && fee.rows.every((x) => /application fee/i.test(x.label)));
});
