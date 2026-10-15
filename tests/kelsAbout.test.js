// kelsAbout.test.js — "Zeus puppies" (data/kelsAbout.js): which dog, what it has,
// what Kels says, and each topic's scoped results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../shared/data/kelsAbout.js';

const d = (id, x = {}) => ({ id, call_name: id, sex: 'male', status: 'puppy', ownership_type: 'owned', breed: 'Boston Terrier', ...x });
const rows = {
  dogs: [d('Zeus', { status: 'active_breeding' }), d('JJ', { sex: 'female', status: 'active_breeding' }), d('Zoey', { sex: 'female', status: 'active_breeding' }),
    d('Green', { sire_id: 'Zeus', dam_id: 'JJ', litter_id: 'L1' }), d('Blue', { sire_id: 'Zeus', dam_id: 'JJ', litter_id: 'L1' }),
    d('QB', { sex: 'female', sire_id: 'Zeus', dam_id: 'Zoey', litter_id: 'L2' }), d('Gone', { sire_id: 'Zeus', is_archived: true })],
  litters: [{ id: 'L1', sire_id: 'Zeus', dam_id: 'JJ', status: 'whelped', whelp_date: '2026-10-01' },
    { id: 'L2', sire_id: 'Zeus', dam_id: 'Zoey', status: 'whelped', whelp_date: '2026-10-01' }],
  sales: [{ id: 's1', dog_id: 'Green', buyer_contact_id: 'c1', status: 'paid_in_full', price: 3000 },
    { id: 's2', dog_id: 'QB', buyer_contact_id: 'c1', status: 'cancelled', price: 2500 }],
  contacts: [{ id: 'c1', name: 'Sam Hill' }]
};
const flags = { reports: true };
const about = (q, f = flags) => A.aboutDog(q, rows, { flags: f });

test('"Zeus puppies" touches all three topics, each with something behind it', () => {
  const a = about('Zeus puppies');
  assert.deepEqual(a.topics, ['pups', 'litters', 'sales']);
  assert.equal(a.dogs[0].dog.id, 'Zeus');
  assert.deepEqual(a.dogs[0].offered, ['pups', 'litters', 'sales']);
  assert.equal(A.factsSentence(a.dogs[0].dog, a.dogs[0].facts), 'Zeus has sired 3 puppies across 2 litters, and 1 has sold for $3,000.');
  assert.match(A.factsSentence(a.dogs[0].dog, a.dogs[0].facts, { pronoun: true }), /^He has sired 3 puppies/);
});

test('one topic word is one topic; a dam "has had"; archived pups only where they open', () => {
  assert.deepEqual(about('zeus litters').dogs[0].offered, ['litters']);
  assert.deepEqual(about("Zeus's sales").dogs[0].offered, ['sales']);
  assert.match(A.factsSentence(about('jj pups').dogs[0].dog, about('jj pups').dogs[0].facts), /^JJ has had 2 puppies across 1 litter/);
  assert.equal(about('zeus pups', { ...flags, archivedDogLinks: true }).dogs[0].facts.pups.length, 4);
});

test('not "<dog> <topic>": a name alone, a word alone, a word no topic has', () => {
  for (const q of ['zeus', 'puppies', 'zeus shots', 'zeus puppies receipts']) assert.equal(about(q), null, q);
});

test('a dog with nothing: named, but nothing offered', () => {
  const a = about('green puppies');
  assert.equal(a.dogs[0].dog.id, 'Green');
  assert.deepEqual(a.dogs[0].offered, []);
});

test('scoped results: the puppies (with a litter question and "all of"), the litters, the sales', () => {
  const { dog, facts } = about('zeus puppies').dogs[0];
  const pups = A.topicResults('pups', dog, facts, rows, { flags });
  assert.deepEqual(pups.hits.map((h) => h.c.title), ['Green', 'Blue', 'QB']);
  assert.equal(pups.hits[0].c.facets[0].value, 'JJ × Zeus');
  assert.equal(pups.extras[0].href, 'dog.html?id=Zeus#offspring');
  assert.equal(A.topicResults('litters', dog, facts, rows, { flags }).hits.length, 2);
  const sales = A.topicResults('sales', dog, facts, rows, { flags });
  assert.deepEqual(sales.hits.map((h) => [h.c.title, h.c.sub, h.c.href]), [
    ['Green', 'Sam Hill · $3,000 · Paid in full', 'sale.html?id=s1'], ['QB', 'Sam Hill · $2,500 · Cancelled', 'sale.html?id=s2']]);
  assert.equal(sales.extras[0].href, 'dog-return-report.html');
  assert.deepEqual(A.topicResults('sales', dog, facts, rows, { flags, edition: 'lite' }).extras, []);
  assert.equal(A.topicByKey('sales').sub(facts), '1 sold · $3,000');
});
