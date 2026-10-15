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
  for (const q of ['zeus', 'puppies', 'zeus receipts', 'zeus puppies receipts']) assert.equal(about(q), null, q);
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

const ev = (id, event_type, event_date, details = {}) => ({ id, subject_type: 'dog', subject_id: 'JJ', event_type, event_date, details });
const health = { ...rows, events: [
  ev('e1', 'vaccination', '2025-03-01', { vaccine: 'Rabies', next_due: '2028-03-01' }),
  ev('e2', 'vaccination', '2026-03-01', { vaccine: 'DHPP', next_due: '2026-09-01' }),
  ev('e3', 'vet_visit', '2026-08-03', { reason: 'Ear infection' }),
  ev('e4', 'illness', '2026-01-10', { diagnosis: 'Kennel cough' }),
  { ...ev('e5', 'vaccination', '2026-04-01', { vaccine: 'Lepto' }), subject_id: 'Zeus' }] };
const aboutH = (q) => A.aboutDog(q, health, { flags, today: '2026-10-15' });

test('"JJ shots": her shots, the last and the next due (overdue here), and adding one first', () => {
  const a = aboutH('JJ shots');
  assert.deepEqual(a.topics, ['shots']);
  assert.equal(a.add, false);
  const { dog, facts } = a.dogs[0];
  assert.deepEqual(facts.shots.map((e) => e.id), ['e2', 'e1']);
  assert.match(A.factsSentence(dog, facts, { topics: a.topics }), /^JJ's last shot was DHPP on .+, and DHPP was due .+ \(overdue\)\.$/);
  const res = A.topicResults('shots', dog, facts, health, { flags });
  assert.deepEqual(res.hits.map((h) => [h.c.title, h.c.href]), [['DHPP (vaccination)', 'dog.html?id=JJ&openEvent=e2'], ['Rabies (vaccination)', 'dog.html?id=JJ&openEvent=e1']]);
  assert.deepEqual([res.extras[0].title, res.extras[0].href, res.extras[0].first], ['Add a shot for JJ', 'dog.html?id=JJ&logEvent=vaccination', true]);
});

test('"JJ vet" lists her vet visits and health events; "JJ health" touches shots and vet', () => {
  const a = aboutH('jj vet');
  assert.deepEqual(a.dogs[0].facts.vet.map((e) => e.id), ['e3', 'e4']);
  assert.match(A.factsSentence(a.dogs[0].dog, a.dogs[0].facts, { topics: ['vet'] }), /^JJ's latest was a vet visit on .+ \(Ear infection\)\.$/);
  assert.equal(A.addCandidate('vet', a.dogs[0].dog).title, 'Add a health event for JJ');
  assert.deepEqual(aboutH('jj health').dogs[0].offered, ['shots', 'vet']);
});

test('an add word: "log a shot for JJ", "JJ got sick"; not for a topic that can\'t add', () => {
  for (const q of ['log a shot for JJ', 'add JJ vet visit', 'JJ got sick', 'gave JJ her rabies']) assert.equal(aboutH(q)?.add, true, q);
  assert.equal(aboutH('add zeus puppies')?.add, false);
  assert.equal(A.addCandidate('pups', { id: 'Zeus', call_name: 'Zeus' }), null);
});

test('"JJ vet": who saw her last, her vet costs this year, her vet and the Financials link', () => {
  const vetRows = { ...health,
    contacts: [...rows.contacts, { id: 'v1', name: 'Dr. Nguyen', contact_type: ['vet'] }],
    events: [...health.events.map((e) => (e.id === 'e3' ? { ...e, related_contact_id: 'v1' } : e))],
    expenses: [
      { id: 'x1', subject_type: 'dog', subject_id: 'JJ', category: 'veterinary', amount: 300, expense_date: '2026-08-03' },
      { id: 'x2', subject_type: 'dog', subject_id: 'JJ', category: 'veterinary', amount: 120, expense_date: '2026-01-10' },
      { id: 'x3', subject_type: 'dog', subject_id: 'JJ', category: 'veterinary', amount: 900, expense_date: '2025-05-01' },
      { id: 'x4', subject_type: 'dog', subject_id: 'JJ', category: 'food', amount: 50, expense_date: '2026-02-01' }] };
  const a = A.aboutDog('jj vet', vetRows, { flags, today: '2026-10-15' });
  const { dog, facts } = a.dogs[0];
  assert.deepEqual([facts.seen.name, facts.vetCosts.thisYear, facts.vetCosts.total], ['Dr. Nguyen', 420, 1320]);
  assert.match(A.factsSentence(dog, facts, { topics: ['vet'] }),
    /^JJ was last seen by Dr\. Nguyen on .+ \(Ear infection\)\. She has \$420 in vet expenses logged this year\.$/);
  const pro = A.topicResults('vet', dog, facts, vetRows, { flags: { ...flags, contactsSection: true } }).extras;
  assert.deepEqual(pro.map((c) => c.href), ['dog.html?id=JJ&logEvent=vet_visit', 'contact.html?id=v1', 'financials.html?view=expenses&bucket=veterinary&dog=JJ']);
  const lite = A.topicResults('vet', dog, facts, vetRows, { flags, edition: 'lite' }).extras;
  assert.deepEqual(lite.map((c) => c.id), ['add:vet:JJ', 'vet-costs:JJ']);
});
