// puppyRecordPdf.test.js — the Puppy Record's Share as PDF file (assets/puppyRecordPdf.js).
// Renders record models through the vendored jsPDF (the same file the app loads)
// and checks the result is a real PDF carrying the record's text; and that every
// kind of section the page builds (pages/puppy-record.js recordModel) is one the
// PDF draws, so the two can't drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadJsPdf } from '../shared/assets/invoicePdf.js';
import { renderPuppyRecordPdf } from '../shared/assets/puppyRecordPdf.js';

const f = (k, v, bold = false) => ({ k, v, bold });
const item = (label, dates, extra = {}) => ({ label, vet: [], notes: '', dates, ...extra });

const record = (over = {}) => ({
  logo: '', title: 'Thornfield Kennels', sub: 'Puppy Record', generated: 'Generated 11/20/2026',
  sections: [
    { kind: 'info', label: 'Puppy Information', cols: [[f('Call name', 'Daisy', true), f('Sex', 'Female')], [f('Microchip ID', '985141000998877')]] },
    { kind: 'parents', label: 'Parents', parents: [
      { role: 'Sire', cols: [[f('Registered name', 'Meadow Ridge Maximus Gunnar')]], tests: 'Embark Breeder Panel: Clear' },
      { role: 'Dam', unknown: true }
    ] },
    { kind: 'health', label: 'Health History', columns: [
      [{ title: 'Vaccination', items: [item('Puppy shots — DHPP', '04/15/2026')] }],
      [{ title: 'Vet visit', items: [item('Wellness exam', '04/25/2026', { vet: ['Vet: Dr. Nguyen · 555-0101'], notes: 'Healthy.' })] }],
      []
    ] },
    { kind: 'buyer', label: 'Buyer', cols: [[f('Name', 'Nora Kim'), f('Address', '48 Birchwood Lane\nBurlington, VT 05401')]] }
  ],
  ...over
});

const text = (pdf) => pdf.output();

test('a record renders as a one-page PDF with its text', async () => {
  const JsPDF = await loadJsPdf();
  const pdf = renderPuppyRecordPdf({ cover: null, records: [record()], filename: 'Daisy Puppy Record.pdf' }, JsPDF);
  const out = text(pdf);
  assert.match(out, /^%PDF-1\.\d/);
  for (const s of ['Thornfield Kennels', 'Puppy Information', 'Daisy', 'SIRE', 'Unknown', 'Embark Breeder Panel: Clear',
    'Vaccination', 'Puppy shots - DHPP', 'Dr. Nguyen', 'Healthy.', 'Nora Kim', 'Burlington, VT 05401']) {
    assert.ok(out.includes(s), `missing "${s}"`);
  }
  assert.equal(pdf.getNumberOfPages(), 1);
});

test('several pups start a page each, after the cover page', async () => {
  const JsPDF = await loadJsPdf();
  const cover = { title: 'Getting ready to leave', label: 'Juniper x Gunnar', generated: '11/20/2026 · for you, not the families',
    rows: [{ name: 'Daisy', status: '3 of 5 done', family: 'Nora Kim', dropoff: 'Drop-off 05/01/2026', done: 'Microchip', missing: 'Contract' },
      { name: 'Cedar', status: '0 of 5 done', family: '', dropoff: '', done: '', missing: 'Nothing' }] };
  const pdf = renderPuppyRecordPdf({ cover, records: [record(), record({ title: 'Second' })], filename: 'x.pdf' }, JsPDF);
  const out = text(pdf);
  for (const s of ['Getting ready to leave', 'PUPPY', 'No sale', 'Contract', 'Second']) assert.ok(out.includes(s), `missing "${s}"`);
  assert.equal(pdf.getNumberOfPages(), 3);
});

test('a long health history flows onto more pages, and empty sections say so', async () => {
  const JsPDF = await loadJsPdf();
  const many = Array.from({ length: 30 }, (_, i) => item(`Dose ${i + 1} of something with a fairly long description`, '01/01/2026'));
  const r = record();
  r.sections[2].columns = [[{ title: 'Medication', items: many }, { title: 'Last card', items: [item('The end', '02/02/2026')] }], [], []];
  r.sections[0].cols = [];
  const pdf = renderPuppyRecordPdf({ cover: null, records: [r, record({ sections: [{ kind: 'health', label: 'Health History', columns: [] }] })], filename: 'x.pdf' }, JsPDF);
  const out = text(pdf);
  assert.ok(pdf.getNumberOfPages() >= 3);
  for (const s of ['Last card', 'No details recorded.', 'No health events to show.']) assert.ok(out.includes(s), `missing "${s}"`);
});

test('every section kind the page builds is one the PDF draws', () => {
  const page = readFileSync(new URL('../shared/pages/puppy-record.js', import.meta.url), 'utf8');
  const pdfSrc = readFileSync(new URL('../shared/assets/puppyRecordPdf.js', import.meta.url), 'utf8');
  const built = new Set([...page.matchAll(/kind: '(\w+)'/g)].map((x) => x[1]));
  const drawn = new Set([...pdfSrc.matchAll(/s\.kind === '(\w+)'/g)].map((x) => x[1]));
  assert.ok(built.size >= 4);
  assert.deepEqual([...built].sort(), [...drawn].sort());
});
