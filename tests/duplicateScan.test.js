// duplicateScan.test.js — records entered twice on this device (data/duplicateScan.js)
// and merging a pair of any kind (data/recordMerge.js mergeDuplicate): what the
// Import/Export page's Scan for duplicates card raises and does.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, S, M;
before(async () => {
  ({ tables } = await installMemoryDb());
  S = await import('../shared/data/duplicateScan.js');
  M = await import('../shared/data/recordMerge.js');
});

const PRO = {
  contactsSection: true, accounts: true, waitlist: true, feedingSchedule: true, studServices: true, contracts: true, documents: true
};
const LITE = {};
const at = (d) => `2026-0${d}-01T00:00:00Z`;
const put = (table, row) => tables[table].rows.set(row.id, { is_archived: false, created_at: at(1), ...row });
const row = (table, id) => tables[table].rows.get(id);

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
});

// Two of everything, each pair the same record entered twice.
function everyKind() {
  return {
    kennels: [{ id: 'k1', kennel_name: 'Oak Hill', is_own_kennel: true }, { id: 'k2', kennel_name: 'oak  hill', is_own_kennel: true }],
    accounts: [{ id: 'ac1', name: 'AKC', account_type: 'registry' }, { id: 'ac2', name: 'akc', account_type: 'registry' }],
    contacts: [{ id: 'c1', name: 'Ann Lee', email: 'ann@x.com' }, { id: 'c2', name: 'Ann Lee', phone: '555', email: 'ANN@x.com' }],
    waitlist_programs: [{ id: 'wp1', kennel_id: 'k1', name: 'Pet' }, { id: 'wp2', kennel_id: 'k1', name: 'pet' }],
    breed_feeding_schedules: [{ id: 'f1', breed: 'Boston Terrier' }, { id: 'f2', breed: 'boston terrier' }],
    dogs: [
      { id: 'd1', call_name: 'Bella', registered_name: 'CH Bella of Oak', sex: 'female', breed: 'Boston' },
      { id: 'd2', call_name: 'Bel', registered_name: 'Bella of Oak', sex: 'female', breed: 'Boston' },
      { id: 'sire', call_name: 'Max', sex: 'male', breed: 'Boston' }
    ],
    pairings: [{ id: 'p1', dam_id: 'd1', sire_id: 'sire', planned_date: '2026-03-01' }, { id: 'p2', dam_id: 'd1', sire_id: 'sire', planned_date: '2026-03-01' }],
    litters: [{ id: 'l1', dam_id: 'd1', sire_id: 'sire', whelp_date: '2026-05-03' }, { id: 'l2', dam_id: 'd1', sire_id: 'sire', whelp_date: '2026-05-03' }],
    sales: [{ id: 's1', dog_id: 'd1', buyer_contact_id: 'c1' }, { id: 's2', dog_id: 'd1', buyer_contact_id: 'c1' }],
    stud_services: [{ id: 't1', our_dog_id: 'sire', partner_dog_id: 'd1', sent_date: '2026-02-01' }, { id: 't2', our_dog_id: 'sire', partner_dog_id: 'd1', sent_date: '2026-02-01' }],
    contracts: [{ id: 'ct1', contract_type: 'sale', related_sale_id: 's1' }, { id: 'ct2', contract_type: 'sale', related_sale_id: 's1' }],
    events: [{ id: 'e1', subject_type: 'dog', subject_id: 'd1', event_type: 'weight_check', event_date: '2026-04-01', details: { weight_lbs: '20' } },
      { id: 'e2', subject_type: 'dog', subject_id: 'd1', event_type: 'weight_check', event_date: '2026-04-01', details: { weight_lbs: '20' } }],
    expenses: [{ id: 'x1', receipt_number: 'R-9', amount: 10 }, { id: 'x2', receipt_number: 'R-9', amount: 10 }],
    documents: [{ id: 'doc1', dog_id: 'd1', doc_type: 'pedigree', title: 'Pedigree' }, { id: 'doc2', dog_id: 'd1', doc_type: 'pedigree', title: 'pedigree' }],
    waitlist_entries: [{ id: 'w1', kennel_id: 'k1', contact_id: 'c1', status: 'active' }, { id: 'w2', kennel_id: 'k1', contact_id: 'c1', status: 'applied' }],
    waitlist_offers: [{ id: 'o1', entry_id: 'w1', litter_id: 'l1', offered_date: '2026-06-01' }, { id: 'o2', entry_id: 'w1', litter_id: 'l1', offered_date: '2026-06-01' }]
  };
}

test('every kind of record is scanned, in parent-first order', () => {
  const found = S.findDuplicates({ rows: everyKind(), flags: PRO });
  assert.deepEqual([...new Set(found.map((f) => f.table))], S.SCAN_TABLES);
  const dog = found.find((f) => f.table === 'dogs');
  assert.equal(dog.strength, 'certain'); // the same registered name, titles aside
  assert.ok(dog.shared.includes('registered name'));
  assert.deepEqual(found.find((f) => f.table === 'contacts').shared, ['name', 'email']);
});

test('Lite scans only what Lite has, and only its own kennels', () => {
  const rows = everyKind();
  rows.kennels.push({ id: 'k3', kennel_name: 'Far Away' }, { id: 'k4', kennel_name: 'Far Away' });
  const found = S.findDuplicates({ rows, flags: LITE });
  const kinds = new Set(found.map((f) => f.table));
  for (const t of ['contacts', 'accounts', 'stud_services', 'contracts', 'documents', 'waitlist_entries']) assert.ok(!kinds.has(t), t);
  assert.ok(kinds.has('dogs') && kinds.has('litters') && kinds.has('events') && kinds.has('expenses'));
  assert.deepEqual(found.filter((f) => f.table === 'kennels').map((f) => f.key), ['kennels:k1:k2']);
});

test('never a pair: archived records, a known different sex, a dog and its parent, two weights on one day', () => {
  const rows = {
    dogs: [
      { id: 'a', call_name: 'Rex', sex: 'male', breed: 'Lab', registered_name: 'Rex' },
      { id: 'b', call_name: 'Rex', sex: 'female', breed: 'Lab', registered_name: 'Rex' },
      { id: 'c', call_name: 'Rex', sex: 'male', breed: 'Lab', sire_id: 'a' },
      { id: 'd', call_name: 'Rex', sex: 'male', breed: 'Lab', is_archived: true }
    ],
    events: [
      { id: 'e1', subject_type: 'dog', subject_id: 'a', event_type: 'weight_check', event_date: '2026-04-01', details: { weight_lbs: '20' } },
      { id: 'e2', subject_type: 'dog', subject_id: 'a', event_type: 'weight_check', event_date: '2026-04-01', details: { weight_lbs: '22' } }
    ]
  };
  assert.deepEqual(S.findDuplicates({ rows, flags: PRO }), []);
});

test('possible pairs are raised too, and a dismissed pair is left out', () => {
  const rows = { dogs: [
    { id: 'a', call_name: 'Blue', sex: 'male', breed: 'Lab', litter_id: 'L' },
    { id: 'b', call_name: 'blue', sex: 'male', breed: 'Lab', litter_id: 'L' }
  ] };
  const [f] = S.findDuplicates({ rows, flags: PRO });
  assert.equal(f.strength, 'possible'); // two pups of one litter by name: asked, never certain
  assert.deepEqual(S.dismissKeys(f), ['dup:dogs:a:b', 'tidy:dupdog:a:b']);
  assert.deepEqual(S.findDuplicates({ rows, flags: PRO, dismissed: (x) => x.key === f.key }), []);
});

test('merging two litters moves the pups, events and expenses, fills blanks and archives the other', async () => {
  put('kennels', { id: 'K', kennel_name: 'Mine', is_own_kennel: true });
  put('litters', { id: 'keep', dam_id: 'D', sire_id: 'S', status: 'whelped', whelp_date: '2026-05-03', kennel_id: 'K', notes: 'first' });
  put('litters', { id: 'dup', dam_id: 'D', sire_id: 'S', status: 'weaning', whelp_date: '2026-05-03', kennel_id: 'K', puppies_born_total: 5, notes: 'second', created_at: at(2) });
  put('dogs', { id: 'pup', call_name: 'Pup', litter_id: 'dup', dam_id: 'D', sire_id: 'S', kennel_id: 'K' });
  put('events', { id: 'ev', subject_type: 'litter', subject_id: 'dup', event_type: 'note', event_date: '2026-05-04', title: 'Born' });
  put('expenses', { id: 'ex', subject_type: 'litter', subject_id: 'dup', amount: 40, category: 'veterinary', expense_date: '2026-05-05' });
  localStorage.setItem('kennelOS.someDraft', JSON.stringify({ litterId: 'dup' }));

  const conflicts = M.duplicateConflicts('litters', row('litters', 'keep'), row('litters', 'dup'));
  assert.deepEqual(conflicts.map((c) => c.key), ['status']);
  const { moved } = await M.mergeDuplicate('litters', 'keep', 'dup', { status: 'drop' });
  assert.equal(moved, 3);
  assert.equal(row('dogs', 'pup').litter_id, 'keep');
  assert.equal(row('events', 'ev').subject_id, 'keep');
  assert.equal(row('expenses', 'ex').subject_id, 'keep');
  const kept = row('litters', 'keep');
  assert.equal(kept.status, 'weaning');
  assert.equal(kept.puppies_born_total, 5);
  assert.equal(kept.notes, 'first\n\nsecond');
  assert.equal(row('litters', 'dup').is_archived, true);
  assert.equal(JSON.parse(localStorage.getItem('kennelOS.someDraft')).litterId, 'keep');
});

test('merging events joins their details; the kept one wins where both have a value unless chosen', () => {
  const keep = { id: 'a', event_type: 'vet_visit', details: { vet: 'Dr A', reason: '' } };
  const drop = { id: 'b', event_type: 'vet_visit', details: { vet: 'Dr B', reason: 'Checkup' } };
  assert.deepEqual(M.duplicateConflicts('events', keep, drop).map((c) => c.key), ['details']);
  assert.deepEqual(M.duplicateChanges('events', keep, drop).details, { vet: 'Dr A', reason: 'Checkup' });
  assert.deepEqual(M.duplicateChanges('events', keep, drop, { details: 'drop' }).details, { vet: 'Dr B', reason: 'Checkup' });
});

test('a kennel of hers is never merged into someone else\'s, and a kennel keeps its own public ID', async () => {
  assert.match(M.duplicateBlocker('kennels', { is_own_kennel: true }, { is_own_kennel: false }), /someone else/);
  assert.deepEqual(M.duplicateConflicts('kennels', { id: 'a', public_id: 'X', kennel_name: 'A' }, { id: 'b', public_id: 'Y', kennel_name: 'A' }), []);
  put('kennels', { id: 'mine', kennel_name: 'Oak', is_own_kennel: true });
  put('kennels', { id: 'theirs', kennel_name: 'Oak' });
  await assert.rejects(M.mergeDuplicate('kennels', 'mine', 'theirs'), /someone else/);
});

test('dogs and contacts merge through mergeRecords, and settings follow', async () => {
  put('dogs', { id: 'keep', call_name: 'Bella', sex: 'female', breed: 'Boston', ownership_type: 'owned', status: 'active_breeding' });
  put('dogs', { id: 'dup', call_name: 'Bella', sex: 'female', breed: 'Boston', ownership_type: 'owned', status: 'active_breeding', created_at: at(2) });
  put('litters', { id: 'L', dam_id: 'dup', sire_id: 'S', status: 'whelped' });
  localStorage.setItem('kennelOS.lastDog', 'dup');
  const scan = await M.scanForDuplicates({ flags: PRO });
  assert.deepEqual(scan.findings.map((f) => f.key), ['dogs:dup:keep']);
  await M.mergeDuplicate('dogs', 'keep', 'dup');
  assert.equal(row('litters', 'L').dam_id, 'keep');
  assert.equal(row('dogs', 'dup').is_archived, true);
  assert.equal(localStorage.getItem('kennelOS.lastDog'), 'keep');
  assert.deepEqual((await M.scanForDuplicates({ flags: PRO })).findings, []);
});
