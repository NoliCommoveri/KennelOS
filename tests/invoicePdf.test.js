// invoicePdf.test.js — the PDF renderer behind "Download PDF" (assets/invoicePdf.js,
// Waitlist Spec §15.2). Renders a document model through the vendored jsPDF build
// (the same file the app loads) and checks the result is a real PDF carrying the
// document's text, and that text the standard fonts can't draw is made safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJsPdf, renderInvoicePdf, pdfText } from '../shared/assets/invoicePdf.js';

const model = (over = {}) => ({
  source: 'waitlist', isReceipt: true, docType: 'Receipt', number: 'RCT-20261006-ABC123', date: '2026-10-06',
  issuer: { name: 'Thornfield Kennels', lines: ['Jo Breeder', 'Austin, TX', 'jo@example.com'], logo: '' },
  partyRole: 'Received from', recipient: { name: 'Jane Smith', lines: ['jane@example.com'] },
  re: 'Re: Waitlist application fee for Thornfield Kennels (credited to purchase price)',
  rows: [{ label: 'Waitlist application fee', marker: '', due: '', amount: 300 }],
  totals: [{ label: 'Total paid', amount: 300, total: true }],
  pay: { title: 'Payment received', rows: [['Payment method', 'Venmo'], ['Payment date', '10/01/2026']], methods: [], note: 'Paid via Venmo. Thank you!' },
  notes: '', footnotes: [], filename: 'Receipt-RCT.pdf',
  ...over
});

// jsPDF compresses nothing by default, so drawn text appears in the content stream.
const pdfString = (pdf) => pdf.output();

test('a fee receipt renders as a PDF with its text', async () => {
  const JsPDF = await loadJsPdf();
  const out = pdfString(renderInvoicePdf(model(), JsPDF));
  assert.match(out, /^%PDF-1\.\d/);
  for (const s of ['RECEIPT', 'Thornfield Kennels', 'Jane Smith', 'Waitlist application fee', 'PAID', 'Venmo']) {
    assert.ok(out.includes(s), `missing "${s}"`);
  }
});

test('an invoice with due dates, methods, footnotes and many lines spills onto a second page', async () => {
  const JsPDF = await loadJsPdf();
  const rows = Array.from({ length: 40 }, (_, i) => ({ label: `Line ${i + 1} — boarding`, marker: i === 0 ? '*' : '', due: '11/01/2026', amount: 10 }));
  const pdf = renderInvoicePdf(model({
    isReceipt: false, docType: 'Invoice', partyRole: 'Bill to', rows,
    totals: [{ label: 'Subtotal', amount: 400 }, { label: 'Less amount already collected', amount: -50 }, { label: 'Balance', amount: 350, total: true }],
    pay: { title: 'Payment may be made using one of the following methods:', rows: [], methods: ['Cash', 'Venmo', 'Zelle', 'Check'], note: '' },
    notes: 'Thank you!', footnotes: [{ marker: '*', text: 'All deposit fees are non-refundable.' }]
  }), JsPDF);
  assert.ok(pdf.getNumberOfPages() >= 2);
  const out = pdfString(pdf);
  assert.ok(out.includes('Line 40 - boarding'), 'em dash drawn as a plain dash');
  assert.ok(out.includes('Balance'));
});

test('text the standard fonts can\'t draw is made safe', () => {
  assert.equal(pdfText('A — B − C “q” … ×'), 'A - B - C "q" ... x');
  assert.equal(pdfText('Zoë café'), 'Zoë café');
  assert.equal(pdfText('🐶 Rex'), '? Rex');
});
