// kelsFind.test.js — Kels's "Finding Something": the engine (data/kelsFind.js),
// her records as candidates (data/findRecords.js) and the cheat sheet
// (data/kelsKnowledge.js), searched the way she types.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as F from '../shared/data/kelsFind.js';
import { recordCandidates } from '../shared/data/findRecords.js';
import { PLACES, placeCandidates } from '../shared/data/kelsKnowledge.js';
import { isProOnlyPage } from '../shared/data/proPages.js';
import { navItems, moreItems } from '../shared/data/editionConfig.js';

const PRO = { contactsSection: true, externalOwnership: true, documents: true, reports: true, accounts: true, waitlist: true, shows: true,
  studServices: true, contracts: true, invoicing: true, puppyRecord: true, companion: true, furever: true, assistant: true, feedingSchedule: true, archivedDogLinks: true };
const nav = (p) => [...navItems, ...moreItems].find((i) => i.path === p)?.label || p;

const dog = (id, extra = {}) => ({ id, call_name: id, sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', ...extra });
const rows = {
  dogs: [
    dog('Zoey', { registered_name: 'GCH Thornfield Zoey Mae', registration_number: 'SR123456/01', notes: 'Loves the lake' }),
    dog('Max', { sex: 'male' }),
    dog('Zoe', { breed: 'Poodle', ownership_type: 'external' }),
    dog('Old Zoey', { call_name: '', registered_name: 'Zoey of Old', pedigree_only: true, ownership_type: 'external' })
  ],
  litters: [{ id: 'L1', dam_id: 'Zoey', sire_id: 'Max', status: 'whelped', whelp_date: '2025-04-02' }],
  contacts: [{ id: 'c1', name: 'Dr. Patricia Nguyen', contact_type: ['vet'], phone: '555-0101' }, { id: 'c2', name: 'Sam Hill', contact_type: ['buyer'], notes: 'wants a red girl' }],
  kennels: [{ id: 'k1', kennel_name: 'Thornfield', is_own_kennel: true }],
  events: [{ id: 'e1', subject_type: 'dog', subject_id: 'Max', event_type: 'vaccination', event_date: '2026-03-01', title: 'Vaccination', details: { vaccine: 'Rabies 3yr' } }]
};
const all = () => [...placeCandidates({ edition: 'pro', flags: PRO, nav, kennelId: 'k1' }), ...recordCandidates(rows, PRO)];
const titles = (r) => r.hits.map((h) => h.c.title);

test('words: little words dropped, plurals and "\'s" folded, "show me" isn\'t a dog show', () => {
  assert.deepEqual(F.queryWords('Where are my receipts?').map((q) => q.stem), ['receipt']);
  assert.deepEqual(F.queryWords("Zoey's puppies").map((q) => q.stem), ['zoey', 'puppy']);
  assert.deepEqual(F.queryWords('show me the shows').map((q) => q.word), ['shows']);
  assert.deepEqual(F.queryWords('where is it').map((q) => q.word), ['where', 'is', 'it']); // nothing else to go on
});

test('receipts, and a typo of it, find the expenses', () => {
  for (const q of ['receipts', 'reciepts', 'where are my receipts']) {
    assert.equal(F.search(all(), q).hits[0].c.id, 'place:expenses', q);
  }
});

test('a dog by name: both Zoeys, hers first; a sound-alike only when nothing is spelled that way', () => {
  const r = F.search(all(), 'zoey');
  assert.equal(r.level, 1);
  assert.deepEqual(titles(r).filter((t) => /zo/i.test(t)).slice(0, 2), ['Zoey', 'Zoey of Old']);
  assert.ok(!titles(r).includes('Zoe') && !titles(r).includes('Max'));
  const typo = F.search(all(), 'zoie');
  assert.ok(['Zoey', 'Zoey of Old'].every((t) => titles(typo).includes(t)));
});

test('a title beats a keyword, and the shorter title a tie: puppies, litters', () => {
  assert.equal(F.search(all(), 'puppies').hits[0].c.id, 'place:puppies');
  assert.equal(F.search(all(), 'litter').hits[0].c.id, 'place:litters');
});

test('a record and a word: "zoey litter" is her litter', () => {
  const r = F.search(all(), 'zoey litter');
  assert.equal(r.hits[0].c.id, 'litter:L1');
});

test('a registration number typed any way finds its dog', () => {
  assert.equal(F.clearWinner(F.search(all(), 'SR 123456-01').hits).c.title, 'Zoey');
});

test('deep only when nothing above matches every word: rabies is in Max\'s vaccination', () => {
  const r = F.search(all(), 'rabies');
  assert.equal(r.level, 3);
  assert.equal(r.hits[0].c.title, 'Max');
  assert.equal(r.hits[0].why, 'Vaccination 2026-03-01');
  // A name match never falls through to notes: "lake" is only in Zoey's notes.
  assert.equal(F.search(all(), 'lake').hits[0].why, 'notes');
});

test('vet finds the care team page and her vet', () => {
  const r = F.search(all(), "where's my vet");
  assert.ok(titles(r).includes('Vets and care team'));
  const deep = F.search(all(), 'vet nguyen');
  assert.equal(deep.hits[0].c.title, 'Dr. Patricia Nguyen');
});

test('a cheat-sheet phrase beats a weak match on every word', () => {
  assert.equal(F.search(all(), 'puppy payments').hits[0].c.id, 'place:income');
  assert.equal(F.search(all(), 'stud my dog').hits[0].c.id, 'place:stud-services');
  assert.equal(F.clearWinner(F.search(all(), 'people on waitlist').hits).c.id, 'place:waitlist');
});

test('nothing found says which words', () => {
  const r = F.search(all(), 'xylophone');
  assert.equal(r.hits.length, 0);
  assert.deepEqual(r.unmatched, ['xylophone']);
});

test('clear winner: alone, or well ahead', () => {
  const h = (score) => ({ score });
  assert.equal(F.clearWinner([h(3)]).score, 3);
  assert.equal(F.clearWinner([h(6), h(3)]).score, 6);
  assert.equal(F.clearWinner([h(3), h(2.5)]), null);
});

test('narrowing: first the kind, then the kind\'s own split, never a question that doesn\'t split', () => {
  const c = (id, group, facets = []) => ({ c: { id, group, facets }, score: 1 });
  const mixed = [c(1, 'A dog'), c(2, 'A dog'), c(3, 'A person'), c(4, 'A dog'), c(5, 'A page in the app')];
  assert.equal(F.narrow(mixed).key, 'group');
  const dogs = [1, 2, 3, 4, 5].map((i) => c(i, 'A dog', [{ key: 'whose', question: 'Whose?', value: 'Yours' }, { key: 'sex', question: 'Sex?', value: i % 2 ? 'Boy' : 'Girl' }]));
  const n = F.narrow(dogs);
  assert.equal(n.key, 'sex'); // everyone's "Yours", so that doesn't split them
  assert.deepEqual(n.options.map((o) => [o.label, o.hits.length]), [['Boy', 3], ['Girl', 2]]);
  assert.equal(F.narrow(dogs, new Set(['sex'])), null);
  assert.equal(F.narrow(dogs.slice(0, 4)), null); // few enough already
});

test('Lite: no Pro pages, no flags off, no people or kennels, no archived dogs', () => {
  const lite = placeCandidates({ edition: 'lite', flags: {}, nav, kennelId: 'k1' });
  assert.ok(lite.length > 20);
  for (const p of lite) assert.ok(!isProOnlyPage(p.href.split(/[?#]/)[0]), p.href);
  assert.ok(!lite.some((p) => p.id === 'place:documents' || p.id.startsWith('report:')));
  const recs = recordCandidates({ ...rows, dogs: [...rows.dogs, dog('Gone', { is_archived: true })] }, {});
  assert.ok(!recs.some((r) => r.group === 'A person' || r.group === 'A kennel' || r.title === 'Gone'));
});

test('cheat sheet: unique ids, every page exists and is precached, kennel places need a kennel', () => {
  const ids = PLACES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  const sw = readFileSync(new URL('../shared/sw.js', import.meta.url), 'utf8');
  for (const p of placeCandidates({ edition: 'pro', flags: PRO, nav, kennelId: 'k1' })) {
    const page = p.href.split(/[?#]/)[0];
    assert.ok(existsSync(new URL(`../shared/pages/${page}`, import.meta.url)), page);
    assert.ok(sw.includes(`'pages/${page}'`), `${page} precached`);
    assert.ok(p.where && !p.where.includes('pages/'), `${p.id} names its hub`);
  }
  assert.ok(!placeCandidates({ edition: 'pro', flags: PRO, nav }).some((p) => p.href.includes('kennel.html')));
});

test('unsold or available puppies are on the litter pages', () => {
  for (const q of ['unsold puppies', 'available pups', 'unsold pups', 'available puppies']) {
    assert.equal(F.clearWinner(F.search(all(), q).hits)?.c.id, 'place:litters', q);
  }
  assert.ok(titles(F.search(all(), 'puppies')).includes('Litters'));
});
