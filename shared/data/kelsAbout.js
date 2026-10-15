// kelsAbout.js — "Zeus puppies": a dog named, plus a word about it, for Kels's
// "Finding Something" (End-State guide §33). Pure: takes the rows (loaded by the
// caller through the repos) and what she typed; says which dog she means, what
// it has on record for those words (its puppies, its litters, what its puppies
// sold for), the sentence Kels opens with, and each topic's results as Find
// candidates (data/kelsFind.js). Reads and writes nothing.
//
// Kels asks which topic only when two or more of them have something behind
// them (decided): one goes straight to its results, none says so.
//
// Adding a topic: a line in DOG_TOPICS (its words, its choice label, what it
// counts and lists) and its facts in `factsOf`.
import { queryWords, wordScore } from './kelsFind.js';
import { dogCandidates, litterCandidates } from './findRecords.js';
import { dogName } from './dogRepo.js';
import { litterLabel } from './litterCheckin.js';
import { SALE_STATUS, RELEASED_SALE_STATUSES, descriptor } from './vocab.js';
import { isProOnlyPage } from './proPages.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (n) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 });

// The topics, in the order Kels offers them. `words`: stems she might type
// (synonyms from kelsFind's groups count too); "puppies" is all three.
export const DOG_TOPICS = [
  { key: 'pups', words: ['puppy', 'pup', 'offspring', 'baby', 'kid', 'child', 'progeny', 'son', 'daughter'],
    label: (n) => `One of ${n}'s puppies`, count: (f) => f.pups.length, sub: (f) => plural(f.pups.length, 'puppy', 'puppies'), noun: 'puppies' },
  { key: 'litters', words: ['litter', 'puppy', 'pup', 'bred', 'whelp', 'whelped', 'breeding'],
    label: (n) => `${n}'s litters`, count: (f) => f.litters.length, sub: (f) => plural(f.litters.length, 'litter'), noun: 'litters' },
  { key: 'sales', words: ['sale', 'sold', 'sell', 'money', 'earn', 'earned', 'earning', 'income', 'price', 'buyer', 'puppy', 'pup'],
    label: (n) => `What ${n}'s puppies sold for`, count: (f) => f.sales.length,
    sub: (f) => [f.sold ? `${f.sold} sold` : plural(f.sales.length, 'sale'), f.earned ? money(f.earned) : null].filter(Boolean).join(' · '), noun: 'sales' }
];

const hitsTopic = (q, t) => t.words.some((w) => wordScore(q, w, 1) > 0);
const nameStems = (d) => new Set([d.call_name, d.registered_name].flatMap((t) => (t ? queryWords(t).map((x) => x.stem) : [])));

// What a dog has on record: its puppies (sire or dam), its litters, its puppies' sales.
export function factsOf(dog, { dogs = [], litters = [], sales = [] }, flags = {}) {
  const seen = (r) => !r.is_archived || flags.archivedDogLinks;
  const pups = dogs.filter((d) => (d.sire_id === dog.id || d.dam_id === dog.id) && seen(d));
  const mine = litters.filter((l) => (l.sire_id === dog.id || l.dam_id === dog.id) && !l.is_archived);
  const pupIds = new Set(pups.map((d) => d.id));
  const pupSales = sales.filter((s) => pupIds.has(s.dog_id) && !s.is_archived);
  const placed = pupSales.filter((s) => !RELEASED_SALE_STATUSES.includes(s.status));
  const earned = placed.reduce((t, s) => t + (Number.isFinite(Number(s.price)) && s.price !== '' && s.price != null ? Number(s.price) : 0), 0);
  return { pups, litters: mine, sales: pupSales, sold: new Set(placed.map((s) => s.dog_id)).size, earned };
}

// What Kels says she found: "Zeus has sired 8 puppies across 2 litters, and 5 have sold for $12,400."
// `pronoun`: "He has sired…", after a sentence that already named the dog.
export function factsSentence(dog, f, { pronoun = false } = {}) {
  const name = (pronoun && { male: 'He', female: 'She' }[dog.sex]) || dogName(dog) || 'This dog';
  const verb = dog.sex === 'male' ? 'has sired' : dog.sex === 'female' ? 'has had' : 'has';
  if (!f.pups.length) return f.litters.length ? `${name} has ${plural(f.litters.length, 'litter')} on record.` : '';
  let s = `${name} ${verb} ${plural(f.pups.length, 'puppy', 'puppies')}`;
  if (f.litters.length) s += ` across ${plural(f.litters.length, 'litter')}`;
  if (f.sold) s += `, and ${f.sold} ${f.sold === 1 ? 'has' : 'have'} sold${f.earned ? ` for ${money(f.earned)}` : ''}`;
  return `${s}.`;
}

// Is it "<a dog> <topic words>"? Every word she typed is either one of the
// dog's names or a topic's word, with at least one of each. Returns null, or
// { words, topics (DOG_TOPICS keys her words touch), dogs: [{ dog, facts, offered
// (the topics with something behind them) }] }, dogs with something first.
export function aboutDog(text, rows, { flags = {} } = {}) {
  const qs = queryWords(text);
  if (qs.length < 2) return null;
  const seen = (d) => !d.is_archived || flags.archivedDogLinks;
  const out = [];
  let topics = null;
  for (const dog of (rows.dogs || []).filter(seen)) {
    const names = nameStems(dog);
    const isName = (q) => [...names].some((w) => wordScore(q, w, 0) > 0);
    const rest = qs.filter((q) => !isName(q));
    if (rest.length === qs.length || !rest.length) continue;
    const touched = DOG_TOPICS.filter((t) => rest.some((q) => hitsTopic(q, t)));
    if (!touched.length || !rest.every((q) => touched.some((t) => hitsTopic(q, t)))) continue;
    topics ||= touched.map((t) => t.key);
    const facts = factsOf(dog, rows, flags);
    out.push({ dog, facts, offered: touched.filter((t) => t.count(facts) > 0).map((t) => t.key) });
  }
  if (!out.length) return null;
  // Her own dogs before pedigree-only ones, then the ones with the most to show.
  out.sort((a, b) => b.offered.length - a.offered.length || !!a.dog.pedigree_only - !!b.dog.pedigree_only);
  return { words: qs.map((q) => q.word), topics, dogs: out };
}

// One topic's results for one dog: { hits ([{ c }] for kelsFindUI's offer),
// extras (candidates offered under the list: "All of Zeus's puppies") }.
export function topicResults(key, dog, facts, rows, { flags = {}, edition = 'pro' } = {}) {
  const name = dogName(dog) || 'this dog';
  const dogsById = new Map((rows.dogs || []).map((d) => [d.id, d]));
  const littersById = new Map((rows.litters || []).map((l) => [l.id, l]));
  const contactsById = new Map((rows.contacts || []).map((c) => [c.id, c]));
  const litterOf = (pup) => (littersById.get(pup.litter_id) ? litterLabel(littersById.get(pup.litter_id), dogsById) : pup.date_of_birth ? `Born ${pup.date_of_birth}` : null);
  const hit = (c) => ({ c, matched: 1, score: 0, level: 1, why: null });
  if (key === 'pups') {
    const hits = dogCandidates(facts.pups, { flags }).map((c, i) => {
      const pup = facts.pups[i];
      return hit({ ...c, facets: [{ key: 'pup-litter', question: 'Which litter?', value: litterOf(pup) }, ...c.facets] });
    });
    return { hits, extras: [{ id: `offspring:${dog.id}`, title: `All of ${name}'s puppies`, where: `${name}'s page, under Offspring.`, href: `dog.html?id=${encodeURIComponent(dog.id)}#offspring` }] };
  }
  if (key === 'litters') return { hits: litterCandidates(facts.litters, { dogsById }).map(hit), extras: [] };
  if (key === 'sales') {
    const hits = facts.sales.map((s) => {
      const pup = dogsById.get(s.dog_id);
      const pupName = dogName(pup) || 'A puppy';
      const buyer = contactsById.get(s.buyer_contact_id)?.name || '';
      const status = descriptor(SALE_STATUS, s.status)?.label || s.status;
      const price = s.price !== '' && s.price != null && Number.isFinite(Number(s.price)) ? money(Number(s.price)) : '';
      return hit({
        id: `sale:${s.id}`, group: 'A sale', title: pupName, sub: [buyer, price, status].filter(Boolean).join(' · '),
        where: `${pupName}'s sale${buyer ? ` to ${buyer}` : ''}${price ? `, ${price}` : ''}: ${status.toLowerCase()}.`,
        href: `sale.html?id=${encodeURIComponent(s.id)}`, levels: [[pupName, buyer], [], []],
        facets: [{ key: 'sale-litter', question: 'Which litter?', value: pup ? litterOf(pup) : null }]
      });
    });
    const report = flags.reports && !(edition === 'lite' && isProOnlyPage('dog-return-report.html'));
    return { hits, extras: report ? [{ id: 'report:dog-return-report.html', title: 'Breeding-Dog Return', where: `${name}'s row has what ${name}'s litters brought in, against ${name}'s costs.`, href: 'dog-return-report.html' }] : [] };
  }
  return { hits: [], extras: [] };
}

export const topicByKey = (key) => DOG_TOPICS.find((t) => t.key === key);
