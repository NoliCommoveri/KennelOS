// prefillSamples.test.js — the Field guide's Sample sales: each sample's contract lines
// add up as a contract's do, and each line names a real detail and the sale's parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_SALES, sampleSale } from '../shared/data/prefillSamples.js';
import { FIRMA_LABELS } from '../shared/data/contractForms.js';

const n = (x) => Number(x || 0);
const r2 = (x) => Math.round(x * 100) / 100;
const KNOWN = new Set(['price', 'deposit', 'feeCredit', 'credit', 'payments', 'transport', 'boarding', 'extra', 'pickup', 'due:none']);

test('every sample adds up: the price table, the whole sale, and the payment plan', () => {
  assert.ok(SAMPLE_SALES.length >= 6);
  for (const { id } of SAMPLE_SALES) {
    const x = sampleSale(id);
    const v = Object.fromEntries(x.sections.flatMap((s) => s.lines).map((l) => [l.field, l.value]));
    assert.equal(r2(n(v.depositAmount) + n(v.otherPaymentsReceived) + n(v.purchaseBalanceDue)), n(v.price), `${id}: price table`);
    assert.equal(r2(n(v.paidToDate) + n(v.balanceDue)), n(v.totalCharges), `${id}: whole sale`);
    const depositOwed = r2(n(v.depositDue));
    assert.equal(r2(n(v.paidToDate) + depositOwed + n(v.payment1Amount) + n(v.payment2Amount) + n(v.finalPaymentAmount)), n(v.totalCharges), `${id}: plan`);
    if (v.extraPrice) assert.equal(n(v.priceWithExtra), r2(n(v.price) + n(v.extraPrice)), `${id}: price plus package`);
  }
});

test('each line names a detail with its editor label, and outlines only parts the sale has', () => {
  for (const { id } of SAMPLE_SALES) {
    const x = sampleSale(id);
    const rows = new Set(x.saleRows.map((r) => r.key));
    for (const r of rows) assert.ok(KNOWN.has(r) || r.startsWith('due:'), `${id}: ${r}`);
    for (const l of x.sections.flatMap((s) => s.lines)) {
      assert.equal(l.label, FIRMA_LABELS[l.field], `${id}: ${l.field}`);
      assert.ok(l.value ? l.math : l.why, `${id}: ${l.field} says how, or why it's blank`);
      if (n(l.value) > 0 || (l.value && Number.isNaN(Number(l.value)))) assert.ok(l.sources.some((k) => rows.has(k)), `${id}: ${l.field} outlines something`);
    }
  }
});

test('the samples cover the setups: a plan and none, transport, boarding, a package, credits and none', () => {
  const all = SAMPLE_SALES.map(({ id }) => sampleSale(id));
  const has = (k) => all.some((x) => x.saleRows.some((r) => r.key === k));
  for (const k of ['transport', 'boarding', 'extra', 'feeCredit', 'credit', 'payments', 'due:none']) assert.ok(has(k), k);
  assert.ok(all.some((x) => x.saleRows.filter((r) => r.key.startsWith('due:') && r.key !== 'due:none').length >= 3), 'a plan with two payments before the final');
});
