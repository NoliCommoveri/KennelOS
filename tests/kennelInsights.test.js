// kennelInsights.test.js — Kels's "How my business is doing" sentences
// (data/kennelInsights.js): each from a report's rows for the range, the minimums
// before she ranks, ties, and what's said when there's too little.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../shared/data/kennelInsights.js';
import { productionRowsIn } from '../shared/data/breedingReports.js';

const THIS_YEAR = { from: '2026-01-01', to: '2026-12-31' };
const ctx = (extra = {}) => ({ preset: 'this_year', range: THIS_YEAR, today: '2026-10-16', flags: { waitlist: true, shows: true, studServices: true }, ...extra });
const texts = (xs) => xs.map((x) => x.text);
const find = (xs, id) => xs.find((x) => x.id === id);

const dog = (id, call_name, sex, extra = {}) => ({ id, call_name, sex, status: 'active_breeding', ownership_type: 'owned', kennel_id: 'k', date_of_birth: '2020-01-01', ...extra });
const litter = (id, dam_id, sire_id, whelp_date, born, alive = born) => ({ id, dam_id, sire_id, whelp_date, status: 'whelped', puppies_born_total: born, puppies_born_alive: alive });

// A Production loader as reportSources builds it, over these records.
function production({ dogs, litters, pairings = [] }) {
  const data = { dogs, litters, puppies: [], breeders: dogs, pairings, kennelsById: new Map() };
  return { href: 'production-report.html', rowsIn: (range) => productionRowsIn(data, range, '2026-10-16'), dogs };
}

test('topics and their reports follow the edition', () => {
  assert.deepEqual(K.insightTopics({}).map((t) => t.id), ['dogs', 'money', 'litters', 'sales', 'all']);
  assert.equal(K.insightTopics({ waitlist: true }).find((t) => t.id === 'sales').label, 'Sales & the waitlist');
  assert.equal(K.insightTopics({ shows: true }).find((t) => t.id === 'shows').label, 'Shows');
  assert.ok(!K.topicSources('sales', {}).includes('Applications'));
  assert.ok(K.topicSources('sales', { waitlist: true }).includes('WaitlistToday'));
  assert.ok(K.topicSources('all', { shows: true }).includes('ShowRecord'));
});

test('rowsOf cuts a report to the range the way it does', () => {
  const src = { rows: [{ d: '2025-05-01', k: 'a' }, { d: '2026-05-01', k: 'a' }, { d: '2026-06-01', k: 'b' }], scope: (r) => r.k === 'a', date: (r) => r.d };
  assert.equal(K.rowsOf(src, THIS_YEAR).length, 1);
  assert.equal(K.rowsOf(src, { from: null, to: null }).length, 2);
  assert.equal(K.rowsOf({ rows: [1, 2] }, THIS_YEAR).length, 2); // no date: a now report
});

test('most prolific dam needs 2 litters; under that it is too early', () => {
  const dogs = [dog('bella', 'Bella', 'female'), dog('rosie', 'Rosie', 'female'), dog('duke', 'Duke', 'male')];
  const two = production({ dogs, litters: [litter('l1', 'bella', 'duke', '2026-02-01', 6), litter('l2', 'bella', 'duke', '2026-09-01', 8), litter('l3', 'rosie', 'duke', '2026-03-01', 5)] });
  const out = K.insightsFor('dogs', { Production: two }, ctx());
  assert.equal(find(out, 'prolific-dam').text, 'Your most prolific dam this year is Bella, with 2 litters and 14 puppies.');
  assert.equal(find(out, 'prolific-dam').source.href, 'production-report.html');
  assert.equal(find(out, 'prolific-dam').source.range, 'this_year');
  assert.equal(find(out, 'prolific-sire').text, 'Your most prolific sire this year is Duke, with 3 litters and 19 puppies.');

  const one = production({ dogs, litters: [litter('l1', 'bella', 'duke', '2026-02-01', 6), litter('l3', 'rosie', 'duke', '2026-03-01', 5)] });
  assert.equal(find(K.insightsFor('dogs', { Production: one }, ctx()), 'prolific-dam').text,
    'Bella and Rosie each had one litter this year, so it\'s too early to say which dam is most productive.');
});

test('a tie is said as a tie', () => {
  const dogs = [dog('a', 'Ava', 'female'), dog('b', 'Bea', 'female'), dog('s', 'Sam', 'male')];
  const src = production({ dogs, litters: [litter('1', 'a', 's', '2026-01-05', 4), litter('2', 'a', 's', '2026-08-05', 4), litter('3', 'b', 's', '2026-01-09', 5), litter('4', 'b', 's', '2026-08-09', 3)] });
  assert.match(find(K.insightsFor('dogs', { Production: src }, ctx()), 'prolific-dam').text, /^Ava and Bea tie as your most prolific dams this year, with 8 puppies each\.$/);
});

test('a breeding girl with no litter is said as what happened, never blamed', () => {
  const dogs = [dog('m', 'Maple', 'female'), dog('r', 'Rosie', 'female'), dog('y', 'Young', 'female', { date_of_birth: '2026-03-01' }),
    dog('p', 'Pet', 'female', { status: 'pet_home' }), dog('d', 'Duke', 'male')];
  const pairings = [{ id: 'p1', dam_id: 'r', sire_id: 'd', planned_date: '2026-04-02', status: 'not_pregnant' }];
  const out = K.insightsFor('dogs', { Production: production({ dogs, litters: [], pairings }) }, ctx());
  assert.equal(find(out, 'no-litter').text, 'No litter this year from 2 breeding girls: Rosie was bred but didn\'t take, and Maple hasn\'t been bred.');
  assert.equal(find(out, 'no-litter').tone, 'watch');
});

test('a sire\'s rate only past 3 decided breedings; the overall rate too', () => {
  const p = (id, sire, status) => ({ pairing: { id, sire_id: sire, planned_date: '2026-05-01' }, outcome: status });
  const rows = [p(1, 'a', 'success'), p(2, 'a', 'success'), p(3, 'a', 'success'), p(4, 'b', 'success'), p(5, 'b', 'failed'), p(6, 'b', 'failed'), p(7, 'c', 'failed')];
  const src = { href: 'pairing-success-report.html', rows, date: (r) => r.pairing.planned_date, dogs: [dog('a', 'Ace', 'male'), dog('b', 'Bo', 'male'), dog('c', 'Cy', 'male')] };
  const out = K.insightsFor('dogs', { PairingSuccess: src }, ctx());
  assert.equal(find(out, 'breedings').text, '4 of 7 breedings took this year.');
  assert.equal(find(out, 'sire-rate').text, 'Of your sires, Bo\'s breedings took least often: 1 of 3.'); // Cy has 1: not ranked
});

test('earnings and return come from Breeding-Dog Return, lifetime', () => {
  const r = (id, name, sex, earned, studFees, costs) => ({ dog: dog(id, name, sex), role: sex === 'female' ? 'dam' : 'sire', earned, studFees, costs, anticipated: 0, net: earned + studFees - costs });
  const src = { href: 'dog-return-report.html', rows: [r('d', 'Duke', 'male', 12000, 6400, 2000), r('g', 'Gus', 'male', 3000, 0, 500), r('ro', 'Rosie', 'female', 300, 0, 1800), r('b', 'Bella', 'female', 9000, 0, 1000)] };
  const out = K.insightsFor('dogs', { DogReturn: src }, ctx());
  assert.equal(find(out, 'earning-sire').text, 'Your highest-earning sire is Duke: his pups and stud fees have brought in $18,400 so far.');
  assert.equal(find(out, 'earning-sire').source.range, null);
  assert.equal(find(out, 'in-the-red').text, 'Rosie\'s own costs are more than her pups have brought in so far, by $1,500.');
});

test('money: net, best month, biggest cost, owed, registrations, Full vs Limited', () => {
  const months = [{ period: '2026-03', income: 3000, expenses: 500, net: 2500, anticipated: 0 }, { period: '2026-04', income: 0, expenses: 900, net: -900, anticipated: 0 }, { period: '2025-12', income: 9999, expenses: 0, net: 9999, anticipated: 0 }];
  const sale = (reg, price, date = '2026-05-01') => ({ registration_type: reg, price, sale_date: date, status: 'paid_in_full' });
  const L = {
    ProfitLoss: { href: 'pl-report.html', rows: months, date: (m) => `${m.period}-01` },
    Expenses: { href: 'expenses-report.html', rows: [{ category: 'veterinary', amount: 900, expense_date: '2026-04-02' }, { category: 'food', amount: 500, expense_date: '2026-03-02' }], date: (x) => x.expense_date },
    Receivables: { href: 'receivables-report.html', rows: [{ amount: 1000, bucket: 'd30' }, { amount: 500, bucket: 'not_due' }] },
    Placements: { href: 'placements-report.html', rows: [sale('limited', 2500), sale('limited', 2500), sale('full', 3000)], date: (s) => s.sale_date },
    Pricing: { href: 'pricing-report.html', rows: [1, 2, 3].map(() => ({ sale: { registration_type: 'limited', sale_date: '2026-05-01' }, price: 2500, diff: null }))
      .concat([1, 2, 3].map(() => ({ sale: { registration_type: 'full', sale_date: '2026-05-01' }, price: 2800, diff: null }))), date: (r) => r.sale.sale_date }
  };
  const out = K.insightsFor('money', L, ctx());
  assert.deepEqual(texts(out), [
    'You made $1,600 net this year: $3,000 came in and $1,400 went out.',
    'Your best month was March 2026, with $2,500 net.',
    'Your biggest cost was veterinary, at $900 (64% of what you spent).',
    'You\'re owed $1,500 right now, and $1,000 of it is overdue.',
    'Limited pups brought in $5,000, Full $3,000.',
    'Full sells for $300 more than Limited, on average.'
  ]);
  L.Pricing.rows = L.Pricing.rows.slice(1);
  assert.match(find(K.insightsFor('money', L, ctx()), 'full-vs-limited').text, /too early to compare Full and Limited prices: you've sold 3 on Full and 2 on Limited/);
});

test('litters: counts, average only past 2, live births', () => {
  const ls = [litter('1', 'a', 's', '2026-02-01', 6, 5), litter('2', 'a', 's', '2026-08-01', 8, 8)];
  const L = { Litters: { href: 'litters-report.html', rows: ls, date: (l) => l.whelp_date }, LiveBirths: { href: 'live-births.html', rows: ls, date: (l) => l.whelp_date } };
  assert.deepEqual(texts(K.insightsFor('litters', L, ctx())), [
    'You had 2 litters this year, with 14 puppies born.', 'Your average litter was 7.0 puppies.', '13 of 14 puppies were born alive (93%).'
  ]);
  L.Litters.rows = ls.slice(0, 1);
  assert.equal(find(K.insightsFor('litters', L, ctx()), 'avg-litter'), undefined);
});

test('sales: placements and the waitlist only where the edition has it', () => {
  const sale = (reg, price) => ({ registration_type: reg, price, sale_date: '2026-05-01', status: 'paid_in_full', lead_source: 'Website' });
  const placements = { href: 'placements-report.html', rows: [sale('limited', 2500), sale('limited', 2600), sale('limited', 2700), sale('full', 3200)], date: (s) => s.sale_date };
  const waitlist = { href: 'waitlist-today-report.html', rows: [{ pref_sex: 'female' }, { pref_sex: 'any' }], paused: () => false, waited: () => 40, pipeline: [{ status: 'applied' }] };
  const L = { Placements: placements, WaitlistToday: waitlist };
  const out = K.insightsFor('sales', L, ctx());
  assert.equal(find(out, 'placed').text, 'You placed 4 pups this year, for $11,000 (about $2,750 each).');
  assert.equal(find(out, 'placed-registration').text, '3 on Limited and 1 on Full.');
  assert.equal(find(out, 'waiting').text, '2 families are waiting now: 1 for a girl and 1 for either. They\'ve waited about 40 days (the middle of the list).');
  assert.equal(find(out, 'pipeline').text, '1 application to review.');
  assert.equal(find(K.insightsFor('sales', L, ctx({ flags: {} })), 'waiting'), undefined);
});

test('the whole picture takes the top of each topic, then Year in Review', () => {
  const ls = [litter('1', 'a', 's', '2026-02-01', 6)];
  const out = K.insightsFor('all', { Litters: { href: 'litters-report.html', rows: ls, date: (l) => l.whelp_date } }, ctx({ flags: {} }));
  assert.deepEqual(out.map((x) => x.id), ['litters', 'year-review']);
  assert.equal(out[1].source.href, 'year-review.html');
});

test('nothing to say is said, with a longer range offered', () => {
  assert.equal(K.insightsFor('dogs', {}, ctx()).length, 0);
  assert.match(K.nothingText('My dogs', 'this_year'), /this year\. Want me to look at all time instead\?$/);
  assert.doesNotMatch(K.nothingText('My dogs', 'all'), /all time instead/);
});

test('every source names a report in the catalog', () => {
  const dogs = [dog('bella', 'Bella', 'female'), dog('duke', 'Duke', 'male')];
  const out = K.insightsFor('dogs', { Production: production({ dogs, litters: [litter('l1', 'bella', 'duke', '2026-02-01', 6), litter('l2', 'bella', 'duke', '2026-09-01', 8)] }) }, ctx());
  for (const x of out) assert.notEqual(x.source.title, 'the report', x.source.href);
});
