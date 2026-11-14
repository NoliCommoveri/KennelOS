// dogTitles.test.js — a dog's titles as one list (data/dogTitles.js; Dog Titles
// Field Plan §2, §8.0): the field, its title_earned events and titles on the front
// of its registered name, merged at read time; and dogRepo normalizing the field.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import {
  abbrKey, sameTitle, normalizeTitles, titlesOf, displayName, feedOrder, holdsTitle, isPrefixTitle, nameTitles,
  TITLE_SUFFIXES, titleSuggestions, splitTitleInput, formTitleChips
} from '../shared/data/dogTitles.js';

const ev = (abbr, date, extra = {}) => ({
  id: `e-${abbr}-${date}`, event_type: 'title_earned', subject_type: 'dog', subject_id: 'D', event_date: date,
  details: { title_abbreviation: abbr, organization: extra.organization ?? '' }, is_archived: false, ...extra
});
const abbrs = (list) => list.map((t) => t.abbr);

test('abbrKey and sameTitle: case and dots ignored; a blank organization matches any', () => {
  assert.equal(abbrKey('H.CH'), 'HCH');
  assert.equal(abbrKey(' gch b '), 'GCHB');
  assert.ok(sameTitle({ abbr: 'H.CH' }, { abbr: 'HCH' }));
  assert.ok(sameTitle({ abbr: 'CH', organization: 'AKC' }, { abbr: 'ch', organization: '' }));
  assert.ok(sameTitle({ abbr: 'CH', organization: 'AKC' }, { abbr: 'CH', organization: 'akc' }));
  assert.ok(!sameTitle({ abbr: 'CH', organization: 'AKC' }, { abbr: 'CH', organization: 'UKC' }));
  assert.ok(!sameTitle({ abbr: 'CH' }, { abbr: 'GCH' }));
});

test('normalizeTitles: trims, caps lengths, keeps only a real date, drops blanks, merges duplicates', () => {
  assert.deepEqual(normalizeTitles(undefined), []);
  assert.deepEqual(normalizeTitles([
    ' GCH ', { abbr: 'ch', organization: ' AKC ', earned_on: '2020-03-04' }, { abbr: 'CH', earned_on: '2019-01-02' },
    { abbr: '' }, null, { abbr: 'CGC', earned_on: 'March 2021' }, { abbr: 'X'.repeat(40), organization: 'O'.repeat(70) }
  ]), [
    { abbr: 'GCH', organization: '', earned_on: '' },
    { abbr: 'ch', organization: 'AKC', earned_on: '2019-01-02' },
    { abbr: 'CGC', organization: '', earned_on: '' },
    { abbr: 'X'.repeat(30), organization: 'O'.repeat(60), earned_on: '' }
  ]);
});

test('prefix titles: the list, a repeat number allowed; everything else goes after the name', () => {
  for (const t of ['CH', 'GCH', 'GCHB', 'GCHP2', 'MACH3', 'INT', 'RACH', 'C.H.']) assert.ok(isPrefixTitle(t), t);
  for (const t of ['CGC', 'JH', 'RN', 'UDX2', 'HCH', 'TKN']) assert.ok(!isPrefixTitle(t), t);
});

test('titlesOf merges the field, events and the name; a matching event dates the field entry', () => {
  const dog = { id: 'D', registered_name: 'BIS A-K Bella', titles: [{ abbr: 'GCHB' }, { abbr: 'CH', organization: 'AKC' }, { abbr: 'CGC' }] };
  const events = [
    ev('CH', '2021-05-01', { organization: 'AKC' }),
    ev('GCHS', '2023-01-01'), ev('GCHG', '2024-01-01'),
    ev('RN', '2020-01-01'), ev('TKN', '2022-01-01'),
    ev('JH', '2022-06-01', { is_archived: true }),
    ev('CD', '2022-06-01', { subject_id: 'OTHER' }),
    { ...ev('BN', '2022-06-01'), event_type: 'show' }
  ];
  const t = titlesOf(dog, events);
  assert.deepEqual(abbrs(t), ['GCHG', 'GCHS', 'GCHB', 'CH', 'BIS', 'CGC', 'RN', 'TKN']);
  const ch = t.find((x) => x.abbr === 'CH');
  assert.equal(ch.source, 'field');
  assert.equal(ch.earned_on, '2021-05-01');
  assert.equal(ch.event_id, 'e-CH-2021-05-01');
  assert.equal(t.find((x) => x.abbr === 'BIS').source, 'name');
  assert.equal(t.find((x) => x.abbr === 'GCHG').source, 'event');
});

test('titlesOf: a bought CH that later logs a GCH shows "GCH CH"; the earlier date wins', () => {
  const dog = { id: 'D', registered_name: 'Bella', titles: [{ abbr: 'CH', earned_on: '2020-01-01' }] };
  const t = titlesOf(dog, [ev('GCH', '2024-04-01'), ev('C.H.', '2021-01-01')]);
  assert.deepEqual(abbrs(t), ['GCH', 'CH']);
  assert.equal(t[1].earned_on, '2020-01-01');
  assert.deepEqual(titlesOf(null), []);
  assert.deepEqual(titlesOf({ id: 'D' }), []);
});

test('displayName: prefixes, the name without its front titles, suffixes', () => {
  const dog = { id: 'D', call_name: 'Bella', registered_name: 'GCH A-K Bella', titles: [{ abbr: 'CH' }, { abbr: 'CGC' }] };
  assert.equal(displayName(dog, titlesOf(dog)), 'CH GCH A-K Bella CGC');
  assert.equal(displayName({ call_name: 'Pip', titles: [{ abbr: 'RN' }] }), 'Pip RN');
  assert.equal(displayName({ call_name: 'Pip' }), 'Pip');
  assert.equal(displayName(null), '');
});

test('feedOrder: dated titles by date, then undated in display order', () => {
  const list = [{ abbr: 'GCH', earned_on: '' }, { abbr: 'CH', earned_on: '2022-01-01' }, { abbr: 'CGC', earned_on: '' }, { abbr: 'RN', earned_on: '2021-01-01' }];
  assert.deepEqual(abbrs(feedOrder(list)), ['RN', 'CH', 'GCH', 'CGC']);
});

test('holdsTitle: a repeat number counts, case and dots ignored', () => {
  assert.ok(holdsTitle([{ abbr: 'GCH2' }], 'GCH'));
  assert.ok(holdsTitle([{ abbr: 'g.c.h' }], 'GCH'));
  assert.ok(holdsTitle(['CH'], 'CH'));
  assert.ok(!holdsTitle([{ abbr: 'GCH' }], 'CH'));
  assert.ok(!holdsTitle([], 'CH'));
  assert.ok(!holdsTitle(null, 'CH'));
});

test('nameTitles: the titles on the front of a registered name', () => {
  assert.deepEqual(nameTitles('GCHP2 CH A-K Bella'), { name: 'A-K Bella', titles: ['GCHP2', 'CH'] });
});

// --- dogRepo -----------------------------------------------------------------

let tables, repo;
before(async () => {
  ({ tables } = await installMemoryDb());
  repo = await import('../shared/data/dogRepo.js');
});
beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  tables.kennels.rows.set('K', { id: 'K', kennel_name: 'Mine', is_own_kennel: true, is_archived: false });
});
const base = { call_name: 'Bella', sex: 'female', breed: 'Beagle', ownership_type: 'owned', status: 'active_breeding', kennel_id: 'K' };

test('dogRepo normalizes titles and trims country_of_origin on every write that carries them', async () => {
  const d = await repo.dogRepo.create({ ...base, titles: [' CH ', { abbr: 'ch' }, { abbr: '' }], country_of_origin: '  Serbia ' });
  assert.deepEqual(d.titles, [{ abbr: 'CH', organization: '', earned_on: '' }]);
  assert.equal(d.country_of_origin, 'Serbia');
  await repo.dogRepo.update(d.id, { notes: 'hi' });
  const kept = await repo.dogRepo.getById(d.id);
  assert.equal(kept.titles.length, 1);
  assert.equal(kept.country_of_origin, 'Serbia');
  await repo.dogRepo.update(d.id, { titles: [{ abbr: 'GCH', earned_on: 'soon' }, 'CH'], country_of_origin: null });
  const after = await repo.dogRepo.getById(d.id);
  assert.deepEqual(after.titles, [{ abbr: 'GCH', organization: '', earned_on: '' }, { abbr: 'CH', organization: '', earned_on: '' }]);
  assert.equal(after.country_of_origin, '');
  const plain = await repo.dogRepo.create({ ...base, call_name: 'Plain' });
  assert.ok(!('titles' in plain), 'a dog written without titles stays without the field');
});

// --- The Dog form's Titles row (§8 phase 3) ---------------------------------

test('suggestions: AKC prefixes and suffixes, each once, suffixes not mistaken for prefixes', () => {
  const all = titleSuggestions();
  for (const a of ['CH', 'GCH', 'GCHB', 'MACH', 'CGC', 'CGCA', 'TKN', 'JH', 'RN', 'CD', 'BN', 'UDX', 'QA2']) assert.ok(all.includes(a), a);
  assert.equal(new Set(all.map(abbrKey)).size, all.length, 'no duplicates');
  assert.ok(all.indexOf('CH') < all.indexOf('CGC'), 'prefixes first');
  for (const a of TITLE_SUFFIXES) assert.equal(isPrefixTitle(a), false, `${a} goes after the name`);
});

test('splitTitleInput: spaces, commas and semicolons separate titles', () => {
  assert.deepEqual(splitTitleInput('GCH CH'), ['GCH', 'CH']);
  assert.deepEqual(splitTitleInput(' CGC,  TKN; RN '), ['CGC', 'TKN', 'RN']);
  assert.deepEqual(splitTitleInput('   '), []);
  assert.deepEqual(splitTitleInput(null), []);
});

test('formTitleChips: field chips editable in her order, logged and name-only titles read-only', () => {
  const dog = {
    id: 'D', registered_name: 'CH GCH A-K Bella',
    titles: [{ abbr: 'CH', organization: '', earned_on: '' }, { abbr: 'CGC', organization: 'AKC', earned_on: '2021-02-03' }]
  };
  const events = [ev('CH', '2019-05-01'), ev('TKN', '2022-01-01'), ev('X', '2020-01-01', { is_archived: true })];
  const chips = formTitleChips(dog, events);
  assert.deepEqual(chips.field.map((t) => t.abbr), ['CH', 'CGC']);
  assert.equal(chips.field[0].event_id, 'e-CH-2019-05-01', 'a field title that is also logged links to its event');
  assert.equal(chips.field[0].earned_on, '', 'the chip keeps what she typed, not the merged date');
  assert.equal(chips.field[1].event_id, undefined);
  assert.deepEqual(abbrs(chips.event), ['TKN'], 'only logged titles the field lacks; archived ones skipped');
  assert.equal(chips.event[0].event_id, 'e-TKN-2022-01-01');
  assert.deepEqual(abbrs(chips.name), ['GCH'], 'only name titles the field lacks');
});

test('formTitleChips: a blank chip being typed stays in place and matches nothing', () => {
  const chips = formTitleChips({ id: 'D', titles: [{ abbr: '' }, { abbr: 'ch' }] }, [ev('CH', '2019-05-01')]);
  assert.deepEqual(chips.field.map((t) => t.abbr), ['', 'ch']);
  assert.equal(chips.field[0].event_id, undefined);
  assert.equal(chips.field[1].event_id, 'e-CH-2019-05-01', 'case ignored');
  assert.deepEqual(chips.event, []);
  assert.deepEqual(formTitleChips(null), { field: [], event: [], name: [] });
});
