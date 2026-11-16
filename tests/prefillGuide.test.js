// prefillGuide.test.js — the Field guide's rows: every detail, its editor label, how it's
// worked out, and examples that are what a real send fills for the made-up records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideRows, GUIDE_GROUPS } from '../shared/data/prefillGuide.js';
import { PREFILL_FIELDS, FIRMA_LABELS } from '../shared/data/contractForms.js';

test('every detail is in the guide once, with its editor label and how it\'s worked out', () => {
  const rows = guideRows();
  const names = new Set(Object.values(PREFILL_FIELDS).flat().map(([k]) => k));
  assert.equal(rows.length, names.size);
  assert.deepEqual(new Set(rows.map((r) => r.name)), names);
  for (const r of rows) {
    assert.equal(r.label, FIRMA_LABELS[r.name], `${r.name} has its Firma label`);
    assert.ok(r.how && r.how.length > 8, `${r.name} says how it's worked out`);
    assert.ok(r.groups.length >= 1);
  }
  assert.deepEqual(GUIDE_GROUPS.map((g) => g.key).sort(), Object.keys(PREFILL_FIELDS).sort(), 'every group has a heading');
});

test('a detail in two groups keeps each group\'s example', () => {
  const dam = guideRows().find((r) => r.name === 'damName');
  assert.deepEqual(dam.groups, ['sale', 'stud_service']);
  assert.equal(dam.examples.sale, 'Maple Ridge\'s Rosie Belle', 'a sale: the registered name');
  assert.equal(dam.examples.stud_service, 'Daisy', 'a stud service: the call name');
});

test('the examples add up the way the contracts do', () => {
  const v = Object.fromEntries(guideRows().map((r) => [r.name, Number(r.example) || r.example]));
  assert.equal(v.priceWithExtra, v.price + v.extraPrice);
  assert.equal(v.price, v.depositAmount + v.otherPaymentsReceived + v.purchaseBalanceDue);
  assert.equal(v.totalCharges, v.price + v.transportFee + v.boardingTotal + v.extraPrice);
  assert.equal(v.totalCharges, v.paidToDate + v.payment1Amount + v.finalPaymentAmount);
  assert.equal(v.balanceDue, v.totalCharges - v.paidToDate);
  assert.equal(v.payment2Amount, '', 'a schedule with one due date before the final');
});
