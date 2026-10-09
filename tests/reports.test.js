// reports.test.js — the Reports plan's shared pieces: date ranges, period
// buckets and ticks (data/reportMath.js), the SVG charts (assets/chartView.js),
// money by month (data/moneyReport.js), Year in Review (data/yearReview.js), and
// the hub catalog (data/reportCatalog.js) against the files on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  rangeFor, inRange, rangeLabel, periodKey, granularityFor, periodsBetween, periodLabel, periodsFor,
  bucketSum, niceTicks, compactNumber, pct, periodSeries, rankBy, sumOf
} from '../shared/data/reportMath.js';
import { renderBarChart, renderLineChart, renderHbarChart, renderChart, SERIES_COLORS, DIVERGING } from '../shared/assets/chartView.js';
import { incomeEntries, plByPeriod, moneyBreakdown } from '../shared/data/moneyReport.js';
import { yearSummary, reviewYears } from '../shared/data/yearReview.js';
import { REPORTS, REPORT_GROUPS, groupsInUse } from '../shared/data/reportCatalog.js';
import { PRO_ONLY_PAGES } from '../shared/data/proPages.js';

// --- reportMath ---------------------------------------------------------------------

test('rangeFor: presets as YYYY-MM-DD; custom passes through; all is open', () => {
  assert.deepEqual(rangeFor('this_year', '2026-10-09'), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(rangeFor('last_year', '2026-10-09'), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(rangeFor('last_12', '2026-10-09'), { from: '2025-11-01', to: '2026-10-09' }, 'this month and the eleven before');
  assert.deepEqual(rangeFor('last_12', '2026-01-15'), { from: '2025-02-01', to: '2026-01-15' });
  assert.deepEqual(rangeFor('custom', '2026-10-09', { from: '2026-03-01', to: '' }), { from: '2026-03-01', to: null });
  assert.deepEqual(rangeFor('all', '2026-10-09'), { from: null, to: null });
});

test('inRange: inclusive ends; undated rows only in an open range', () => {
  const r = { from: '2026-01-01', to: '2026-12-31' };
  assert.equal(inRange('2026-01-01', r), true);
  assert.equal(inRange('2026-12-31', r), true);
  assert.equal(inRange('2027-01-01', r), false);
  assert.equal(inRange('', r), false);
  assert.equal(inRange('', {}), true);
  assert.equal(inRange('2020-05-05', { from: '2020-01-01', to: null }), true);
  assert.equal(rangeLabel('all', {}), 'All time');
  assert.equal(rangeLabel('custom', { from: '2026-01-01', to: null }), 'From 2026-01-01');
});

test('periods: keys, labels, gap-free spans, month/year switch at two years', () => {
  assert.equal(periodKey('2026-03-14'), '2026-03');
  assert.equal(periodKey('2026-03-14', 'year'), '2026');
  assert.deepEqual(periodsBetween('2025-11-20', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(periodsBetween('2024-06-01', '2026-01-01', 'year'), ['2024', '2025', '2026']);
  assert.deepEqual(periodsBetween('2026-02-01', '2026-01-01'), []);
  assert.equal(granularityFor('2025-01-01', '2026-12-31'), 'month');
  assert.equal(granularityFor('2025-01-01', '2027-01-01'), 'year');
  assert.equal(periodLabel('2026-03'), 'Mar 2026');
  assert.equal(periodLabel('2026-03', { short: true }), 'Mar');
  assert.equal(periodLabel('2026'), '2026');
  assert.deepEqual(periodsFor(['2026-03-02', '', '2026-01-09']).periods, ['2026-01', '2026-02', '2026-03']);
});

test('bucketSum / periodSeries / rankBy / sumOf: every period present, outsiders ignored', () => {
  const rows = [{ d: '2026-01-05', v: 2, k: 'a' }, { d: '2026-03-01', v: 3, k: 'b' }, { d: '2027-01-01', v: 9, k: 'a' }];
  const m = bucketSum(rows, ['2026-01', '2026-02', '2026-03'], { date: (r) => r.d, value: (r) => r.v });
  assert.deepEqual([...m.values()], [2, 0, 3]);
  const p = periodSeries(rows.slice(0, 2), {}, { date: (r) => r.d, series: [{ name: 'All' }, { name: 'B', when: (r) => r.k === 'b', value: (r) => r.v }] });
  assert.equal(p.granularity, 'month');
  assert.deepEqual(p.categories.map((c) => c.key), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(p.series.map((s) => s.values), [[1, 0, 1], [0, 0, 3]]);
  assert.deepEqual(rankBy(rows, { key: (r) => r.k, value: (r) => r.v }).map((r) => [r.key, r.value]), [['a', 11], ['b', 3]]);
  assert.equal(sumOf(rows, (r) => r.v), 14);
  assert.equal(sumOf([{ v: '' }, { v: 'x' }, { v: '2.5' }], (r) => r.v), 2.5);
});

test('niceTicks: clean steps from zero; integer mode never splits a count', () => {
  assert.deepEqual(niceTicks(0, 2).ticks, [0, 0.5, 1, 1.5, 2]);
  assert.deepEqual(niceTicks(0, 2, 4, { integer: true }).ticks, [0, 1, 2]);
  assert.deepEqual(niceTicks(0, 2300).ticks, [0, 1000, 2000, 3000]);
  const neg = niceTicks(-800, 2300);
  assert.ok(neg.min <= -800 && neg.max >= 2300 && neg.ticks.includes(0));
  assert.deepEqual(niceTicks(0, 0).ticks, [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(compactNumber(1500), '1.5k');
  assert.equal(compactNumber(-2000, { money: true }), '-$2k');
  assert.equal(compactNumber(3000000), '3M');
  assert.equal(pct(7, 8), '88%');
  assert.equal(pct(1, 0), null);
});

// --- chartView ----------------------------------------------------------------------

const cats = [{ key: '2026-01', label: 'Jan 2026' }, { key: '2026-02', label: '<Feb>' }];

test('bar chart: one path per non-zero mark, escaped labels, tooltip per category', () => {
  const html = renderBarChart({ title: 'Litters & pups', categories: cats, series: [{ name: 'Litters', values: [2, 0] }] }, 400);
  assert.match(html, /<figure class="chart">/);
  assert.match(html, /Litters &amp; pups/);
  assert.match(html, /&lt;Feb&gt;/);
  assert.doesNotMatch(html, /<Feb>/);
  assert.equal((html.match(/<path /g) || []).length, 1, 'a zero value draws no mark');
  assert.equal((html.match(/class="chart-hit"/g) || []).length, 2);
  assert.doesNotMatch(html, /chart-legend/, 'one series: the title names it, no legend box');
  assert.match(html, new RegExp(`fill="${SERIES_COLORS[0]}"`));
});

test('bar chart: legend for 2+ series in fixed slot order; stacked total in the tooltip; diverging colors by sign', () => {
  const two = renderBarChart({ categories: cats, series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [3, 4] }], stacked: true }, 400);
  assert.match(two, /chart-legend/);
  assert.ok(two.indexOf(SERIES_COLORS[0]) < two.indexOf(SERIES_COLORS[1]));
  assert.match(two, /Total: 4/);
  const div = renderBarChart({ categories: cats, series: [{ name: 'Net', values: [500, -200] }], diverging: true }, 400);
  assert.match(div, new RegExp(`fill="${DIVERGING.positive}"`));
  assert.match(div, new RegExp(`fill="${DIVERGING.negative}"`));
});

test('charts: nothing to draw → an empty note, never a blank axis', () => {
  assert.match(renderBarChart({ categories: cats, series: [{ name: 'A', values: [0, 0] }], emptyText: 'No sales.' }), /chart-empty">No sales\./);
  assert.match(renderLineChart({ series: [] }), /chart-empty/);
  assert.match(renderHbarChart({ rows: [{ label: 'x', value: 0 }] }), /chart-empty/);
});

test('line chart: category and numeric x; end dot ringed; direct labels up to four series', () => {
  const html = renderLineChart({ categories: cats, series: [{ name: 'Net', points: [{ x: '2026-01', y: 10 }, { x: '2026-02', y: -5 }] }] }, 400);
  assert.match(html, /stroke-width="2"/);
  assert.match(html, /<circle [^>]*r="4"[^>]*stroke="#ffffff" stroke-width="2"/);
  const growth = renderLineChart({ xLabel: 'Age (days)', series: [{ name: 'Pup A', points: [{ x: 1, y: 0.5 }, { x: 14, y: 2 }] }, { name: 'Pup B', points: [{ x: 1, y: 0.6 }, { x: 14, y: 1.8 }] }] }, 500);
  assert.match(growth, /Age \(days\)/);
  assert.match(growth, />Pup A</);
  assert.match(growth, /chart-legend/);
});

test('hbar chart: ranked, largest first; past the limit the rest fold into Other', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ label: `S${i}`, value: i + 1 }));
  const html = renderHbarChart({ rows, max: 5 }, 400);
  assert.ok(html.indexOf('>S11<') < html.indexOf('>S10<'));
  assert.match(html, /Other \(8\)/);
  assert.throws(() => renderChart({ type: 'pie' }), /Unknown chart type/);
});

// --- moneyReport --------------------------------------------------------------------

const incomeRows = [
  { source_type: 'sale', date: '2026-01-10', components: [
    { component: 'deposit', amount: 500, state: 'earned', when: '2026-01-10' },
    { component: 'balance', amount: 2000, state: 'earned', when: '2026-03-02' },
    { component: 'transport', amount: 250, state: 'anticipated', when: '2026-04-01' }
  ] },
  { source_type: 'stud', date: '2026-02-01', components: [
    { component: 'stud_fee', amount: 800, state: 'earned', when: '2026-02-01' },
    { component: 'pick', amount: 1500, state: 'noncash', when: '2026-02-01' }
  ] }
];
const expenses = [
  { expense_date: '2026-01-20', amount: 300, category: 'vet' },
  { expense_date: '2026-03-15', amount: '120.50', category: 'food' },
  { expense_date: '2025-12-31', amount: 999, category: 'vet' }
];

test('incomeEntries: one dated entry per cash component; pick value never money', () => {
  const es = incomeEntries(incomeRows);
  assert.equal(es.length, 4);
  assert.ok(!es.some((e) => e.component === 'pick'));
  assert.deepEqual(es.map((e) => e.date), ['2026-01-10', '2026-03-02', '2026-04-01', '2026-02-01']);
});

test('plByPeriod: cash basis by month; anticipated apart from net; running total', () => {
  const months = plByPeriod(incomeEntries(incomeRows), expenses, periodsBetween('2026-01-01', '2026-04-30'));
  assert.deepEqual(months.map((m) => [m.period, m.income, m.expenses, m.net, m.anticipated, m.cumulative]), [
    ['2026-01', 500, 300, 200, 0, 200],
    ['2026-02', 800, 0, 800, 0, 1000],
    ['2026-03', 2000, 120.5, 1879.5, 0, 2879.5],
    ['2026-04', 0, 0, 0, 250, 2879.5]
  ]);
  const { income, spent } = moneyBreakdown(incomeEntries(incomeRows), expenses, (d) => d >= '2026-01-01');
  assert.deepEqual([...income], [['deposit', 500], ['balance', 2000], ['stud_fee', 800]]);
  assert.deepEqual([...spent], [['vet', 300], ['food', 120.5]]);
});

// --- yearReview ---------------------------------------------------------------------

test('yearSummary: litters, pups, placements, money, titles and waitlist for one year', () => {
  const s = yearSummary(2026, {
    litters: [
      { id: 'L1', whelp_date: '2026-02-01', status: 'sold', puppies_born_total: 6, puppies_born_alive: 5 },
      { id: 'L2', whelp_date: '2026-11-20', status: 'expected', puppies_born_total: '' },
      { id: 'L0', whelp_date: '2025-06-01', status: 'closed', puppies_born_total: 4, puppies_born_alive: 4 }
    ],
    sales: [
      { id: 'S1', sale_date: '2026-04-01', status: 'delivered' },
      { id: 'S2', sale_date: '2026-05-01', status: 'voided' },
      { id: 'S3', sale_date: '2025-05-01', status: 'delivered' }
    ],
    moneyEntries: incomeEntries(incomeRows),
    expenses,
    events: [{ event_type: 'title_earned', event_date: '2026-06-01' }, { event_type: 'title_earned', event_date: '2025-06-01' }, { event_type: 'note', event_date: '2026-06-01' }],
    waitlist: [
      { applied_date: '2026-01-04', status: 'active' },
      { applied_date: '2025-08-04', status: 'placed', placed_sale_id: 'S1' },
      { applied_date: '2026-03-04', status: 'withdrawn' }
    ]
  });
  assert.deepEqual(s.litters.map((l) => l.id), ['L1'], 'expected litters and other years are left out');
  assert.equal(s.puppiesBorn, 6);
  assert.equal(s.puppiesAlive, 5);
  assert.deepEqual(s.placements.map((x) => x.id), ['S1']);
  assert.equal(s.fellThrough, 1);
  assert.equal(s.months.length, 12);
  assert.equal(s.moneyIn, 3300);
  assert.equal(s.moneyOut, 420.5);
  assert.equal(s.net, 2879.5);
  assert.equal(s.titles.length, 1);
  assert.equal(s.waitlistApplied, 2);
  assert.equal(s.waitlistPlaced, 1);
  assert.equal(s.waitlistNow, 1);
  assert.deepEqual(reviewYears({ litters: [{ whelp_date: '2024-03-01' }, { whelp_date: '2031-01-01' }] }, 2026), ['2026', '2024'], 'future years left out');
});

// --- reportCatalog ------------------------------------------------------------------

test('every report on the hub exists, is precached, and (but Lite-kept pages) is Pro-only', () => {
  const sw = readFileSync(new URL('../shared/sw.js', import.meta.url), 'utf8');
  const liteKept = ['roster.html', 'live-births.html', 'dashboard.html', 'scheduled-placements.html', 'financials.html'];
  const groups = new Set(REPORT_GROUPS.map((g) => g.value));
  for (const r of REPORTS) {
    assert.ok(groups.has(r.group), `${r.href}: unknown group ${r.group}`);
    assert.ok(existsSync(new URL(`../shared/pages/${r.href}`, import.meta.url)), `${r.href} exists`);
    assert.ok(sw.includes(`'pages/${r.href}'`), `${r.href} is precached`);
    if (!liteKept.includes(r.href)) assert.ok(PRO_ONLY_PAGES.includes(r.href), `${r.href} is Pro-only`);
  }
  assert.equal(REPORTS.filter((r) => r.featured).length, 1);
  assert.ok(groupsInUse().length >= 4);
});

// --- Phase 3 money -------------------------------------------------------------------
import { ageBucket, daysOverdue, receivableRows, pricingRows, averageBy, dogReturnRows } from '../shared/data/moneyReport.js';

test('receivables: anticipated money aged from today; foster owed back undated', () => {
  assert.equal(daysOverdue('2026-10-01', '2026-10-09'), 8);
  assert.equal(ageBucket('2026-10-20', '2026-10-09'), 'not_due');
  assert.equal(ageBucket('2026-10-09', '2026-10-09'), 'not_due', 'due today is not overdue');
  assert.equal(ageBucket('2026-09-01', '2026-10-09'), 'd60');
  assert.equal(ageBucket('2026-01-01', '2026-10-09'), 'd90plus');
  assert.equal(ageBucket('', '2026-10-09'), 'undated');
  const row = { counterparty: 'Jo', dog: 'Wren', href: 'sale.html?id=1' };
  const rows = receivableRows([
    { state: 'anticipated', amount: 2000, component: 'balance', date: '2026-09-20', due: '2026-09-20', row, source_type: 'sale' },
    { state: 'anticipated', amount: 300, component: 'balance', date: '2026-01-02', due: '', row, source_type: 'sale' },
    { state: 'earned', amount: 500, component: 'deposit', date: '2026-09-01', row, source_type: 'sale' },
    { state: 'anticipated', amount: 0, component: 'transport', date: '2026-09-20', row, source_type: 'sale' }
  ], '2026-10-09', [{ litter: { id: 'L' }, amount: 130, label: 'Meadow Ridge' }, { litter: { id: 'M' }, amount: 0, label: 'x' }]);
  assert.deepEqual(rows.map((r) => [r.component, r.amount, r.bucket]), [['balance', 2000, 'd30'], ['balance', 300, 'undated'], ['foster_reimbursable', 130, 'undated']],
    'no due date set: never aged from the sale date');
});

test('pricingRows / averageBy: placed priced sales against the expected price', () => {
  const dogsById = new Map([['p', { id: 'p', sex: 'male' }]]);
  const rows = pricingRows([
    { id: 1, dog_id: 'p', price: 3500, status: 'delivered', sale_date: '2026-01-01' },
    { id: 2, dog_id: 'p', price: '', status: 'delivered' },
    { id: 3, dog_id: 'p', price: 2000, status: 'voided' },
    { id: 4, dog_id: 'x', price: 2500, status: 'deposit_paid', sale_date: '2026-02-01' }
  ], { dogsById, isPlaced: (s) => s.status !== 'voided', expectedFor: (s) => (s.dog_id === 'p' ? 3000 : null) });
  assert.deepEqual(rows.map((r) => [r.sale.id, r.diff]), [[4, null], [1, 500]]);
  assert.deepEqual(averageBy(rows, () => 'all', (r) => r.price), [{ key: 'all', avg: 3000, count: 2 }]);
});

test('dogReturnRows: pups’ income per parent, stud fees, own costs, net', () => {
  const dogs = [{ id: 'dam', sex: 'female' }, { id: 'sire', sex: 'male' }, { id: 'pup', sex: 'male', litter_id: 'L' }];
  const rows = dogReturnRows({
    dogs,
    litters: [{ id: 'L', dam_id: 'dam', sire_id: 'sire', status: 'sold' }],
    incomeRows: [
      { source_type: 'sale', litter_id: 'L', dog_id: 'pup', earned: 2500, anticipated: 500 },
      { source_type: 'stud', dog_id: 'sire', litter_id: null, earned: 800, anticipated: 0 }
    ],
    expenses: [{ subject_type: 'dog', subject_id: 'dam', amount: 1200 }, { subject_type: 'litter', subject_id: 'L', amount: 300 }],
    sales: [{ dog_id: 'pup', status: 'delivered' }],
    isPlaced: () => true
  });
  const dam = rows.find((r) => r.dog.id === 'dam');
  const sire = rows.find((r) => r.dog.id === 'sire');
  assert.deepEqual([dam.earned, dam.studFees, dam.costs, dam.net, dam.pupsSold, dam.anticipated], [2500, 0, 1200, 1300, 1, 500]);
  assert.deepEqual([sire.earned, sire.studFees, sire.net], [2500, 800, 3300], 'the litter counts for both parents');
  assert.ok(!rows.some((r) => r.dog.id === 'pup'));
});
