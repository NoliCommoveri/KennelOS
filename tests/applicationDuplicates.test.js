// applicationDuplicates.test.js — one family who applied twice to one waitlist
// (data/applicationDuplicates.js, waitlistActions.mergeApplications;
// docs/KennelOS_Duplicate_Applications_Plan.md): which pairs are suggested, which
// one is suggested to keep, when a merge is refused, what the kept entry ends up
// with (its own place, the other's answers where chosen, a fee as a credit), that
// the other is deleted, and that their two contact cards can merge in one step.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, D, A, S, T;
before(async () => {
  ({ tables } = await installMemoryDb());
  D = await import('../shared/data/applicationDuplicates.js');
  A = await import('../shared/data/waitlistActions.js');
  S = await import('../shared/data/duplicateScan.js');
  T = await import('../shared/data/tidyRules.js');
});

const put = (table, row) => tables[table].rows.set(row.id, { is_archived: false, created_at: '2026-01-01T00:00:00Z', ...row });
const row = (table, id) => tables[table].rows.get(id);
const entry = (id, over = {}) => ({
  id, kennel_id: 'K', status: 'applied', applied_date: '2026-10-01', pref_sex: 'any', listen_mode: 'all',
  listen_sire_ids: [], listen_dam_ids: [], ...over
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  put('kennels', { id: 'K', kennel_name: 'Mine', is_own_kennel: true });
  put('kennels', { id: 'K2', kennel_name: 'Second', is_own_kennel: true });
});

// --- Finding pairs (pure) --------------------------------------------------------

test('the same email or phone is a likely pair; a near name only a maybe; nothing in common, none', () => {
  const a = entry('a', { application: { name: 'Jennifer Smith', email: 'Jen@X.com', phone: '(555) 123-4567' } });
  const b = entry('b', { application: { name: 'Jen Smyth', email: 'jen@x.com' } });
  const c = entry('c', { application: { name: 'Jenifer Smith', email: 'other@y.com' } });
  const d = entry('d', { application: { name: 'Bob Jones', email: 'bob@z.com' } });
  assert.deepEqual(D.entriesMatch(a, b), { strength: 'certain', reason: 'email' });
  assert.equal(D.entriesMatch(a, c).strength, 'possible');
  assert.equal(D.entriesMatch(a, d), null);
  const m = D.applicationMatches(a, [a, b, c, d]);
  assert.deepEqual(m.map((x) => x.entry.id), ['b', 'c'], 'surest first');
});

test('a contact\'s details count too, and the same contact is certain', () => {
  const contactsById = new Map([['c1', { id: 'c1', name: 'Jennifer Smith', phone: '555-123-4567' }]]);
  const a = entry('a', { status: 'active', contact_id: 'c1', application: { name: 'J S' } });
  const b = entry('b', { application: { name: 'Someone', phone: '5551234567' } });
  assert.deepEqual(D.entriesMatch(a, b, contactsById), { strength: 'certain', reason: 'phone' });
  assert.equal(D.entriesMatch(a, entry('c', { status: 'approved', contact_id: 'c1' })).reason, 'contact');
});

test('only live entries on the same list pair up, and a dismissed pair is left out', () => {
  const app = { name: 'Ann Lee', email: 'ann@x.com' };
  const a = entry('a', { application: app });
  const list = [a, entry('b', { application: app, kennel_id: 'K2' }), entry('c', { application: app, status: 'placed' }),
    entry('d', { application: app, is_archived: true }), entry('e', { application: app, status: 'declined' }), entry('f', { application: app })];
  assert.deepEqual(D.applicationMatches(a, list).map((m) => m.entry.id), ['f']);
  assert.deepEqual(D.applicationMatches(a, list, { dismissed: (x, y) => D.pairKey(x, y) === D.pairKey('a', 'f') }), []);
  const pairs = D.duplicateApplicationPairs(list);
  assert.deepEqual(pairs.map((p) => p.key), [D.pairKey('a', 'f')]);
  assert.deepEqual(D.duplicateDismissKeys('f', 'a'), ['dup:waitlist_entries:a:f', 'tidy:dupapplication:a:f', 'waitlist-duplicate:a:f']);
});

test('the Import/Export scan and Kels\'s tidy-up raise an open application pair, which has no contact yet', () => {
  const app = { name: 'Ann Lee', email: 'ann@x.com' };
  const rows = { waitlist_entries: [entry('a', { application: app }), entry('b', { application: app, applied_date: '2026-10-05' })] };
  const found = S.findDuplicates({ rows, flags: { waitlist: true } });
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].table, found[0].strength], ['waitlist_entries', 'certain']);
  assert.ok(S.dismissKeys(found[0]).includes('waitlist-duplicate:a:b'));
  assert.equal(S.findDuplicates({ rows, flags: {} }).length, 0, 'not without the waitlist');
  const tidy = T.tidyFindings({ litters: [], pairings: [], sales: [], dogs: [], allDogs: [], waitlistEntries: rows.waitlist_entries, flags: { waitlist: true } });
  assert.deepEqual(tidy.map((f) => [f.kind, f.key]), [['duplicate-applications', 'dupapplication:a:b']]);
  assert.equal(T.tidyFindings({ litters: [], pairings: [], sales: [], dogs: [], allDogs: [], waitlistEntries: rows.waitlist_entries, flags: {} }).length, 0);
});

// --- Which to keep, and when not (pure) ----------------------------------------------

test('the one further along is suggested to keep, then an open turn, then the earlier place', () => {
  const applied = entry('a', { applied_date: '2026-09-01' });
  const active = entry('b', { status: 'active', applied_date: '2026-10-01', fee_received_date: '2026-10-03' });
  assert.equal(D.suggestKeepEntry(applied, active), active);
  const x = entry('x', { status: 'active', fee_received_date: '2026-10-05' });
  const y = entry('y', { status: 'active', fee_received_date: '2026-10-09' });
  assert.equal(D.suggestKeepEntry(y, x), x, 'earlier place');
  assert.equal(D.suggestKeepEntry(x, y, [{ id: 'o', entry_id: 'y', outcome: 'open' }]), y, 'a turn open');
  assert.equal(D.suggestKeepEntry(entry('p'), entry('q', { application: { name: 'Q', about: 'Lots' } })).id, 'q', 'more answers');
});

test('refused: two lists, a closed entry, two open turns, or deleting the offered one for one not on the list', () => {
  const a = entry('a');
  assert.match(D.applicationMergeBlocker(a, entry('b', { kennel_id: 'K2' })), /two different waitlists/);
  assert.match(D.applicationMergeBlocker(a, entry('b', { status: 'withdrawn' })), /Only open applications/);
  const x = entry('x', { status: 'active' });
  const y = entry('y', { status: 'active' });
  const open = [{ id: 'o1', entry_id: 'x', outcome: 'open' }, { id: 'o2', entry_id: 'y', outcome: 'open' }];
  assert.match(D.applicationMergeBlocker(x, y, open), /Both of them have a turn open/);
  assert.match(D.applicationMergeBlocker(a, y, [{ id: 'o3', entry_id: 'y', outcome: 'passed' }]), /Keep the one that's on the list/);
  assert.equal(D.applicationMergeBlocker(y, a, [{ id: 'o3', entry_id: 'y', outcome: 'passed' }]), null);
  assert.equal(D.applicationMergeBlocker(x, y, [open[0]]), null);
});

// --- What the kept one gets (pure) -------------------------------------------------

test('answers: blanks fill, a conflict is hers to choose; the kept one\'s place, fee and link stay its own', () => {
  const keep = entry('k', {
    status: 'active', fee_received_date: '2026-10-03', fee_amount: 200, fee_payment_method: 'Cash', status_token: 'tk',
    application: { name: 'Jen Smith', email: 'jen@x.com', household: 'Two kids' }, pref_sex: 'any', notes: 'Called once'
  });
  const drop = entry('d', {
    status: 'applied', applied_date: '2026-10-07', status_token: 'td', waitlist_program_id: 'P',
    application: { name: 'Jennifer Smyth', email: 'jen@x.com', household: 'Three kids', yard: 'Fenced' },
    pref_sex: 'female', notes: 'Prefers texts', application_questions: [{ id: 'yard', label: 'Your yard' }]
  });
  const conflicts = D.applicationConflicts(keep, drop, { labelOf: (id) => `Q ${id}` });
  assert.deepEqual(conflicts.map((c) => c.key), ['application.name', 'application.household']);
  assert.equal(conflicts[0].label, 'Q name');
  const ch = D.applicationMergeChanges(keep, drop, { 'application.household': 'drop' }, { today: '2026-11-08', dropName: 'Jennifer Smyth' });
  assert.deepEqual(ch.application, { name: 'Jen Smith', email: 'jen@x.com', household: 'Three kids', yard: 'Fenced' });
  assert.equal(ch.pref_sex, 'female', '"any" fills from the other\'s answer');
  assert.equal(ch.notes, 'Called once\n\nPrefers texts');
  assert.deepEqual(ch.application_questions, [{ id: 'yard', label: 'Your yard' }]);
  for (const k of ['status', 'fee_received_date', 'fee_amount', 'status_token', 'waitlist_program_id', 'applied_date']) assert.equal(k in ch, false, k);
  assert.deepEqual(ch.merged_applications, [{ date: '2026-11-08', name: 'Jennifer Smyth', applied_date: '2026-10-07', status: 'applied' }]);
  assert.equal(ch.received_credits, undefined, 'no fee paid on the other, no credit');
});

test('a fee the other paid becomes a credit on the kept one (both paid: still a credit)', () => {
  assert.equal(D.paidFeeCredit(entry('w', { fee_received_date: '2026-10-01', fee_amount: 100, fee_payment_method: 'Waived' })), null);
  assert.deepEqual(D.paidFeeCredit(entry('m', { fee_received_date: '2026-10-01', fee_amount: 250, fee_credit_amount: 50, fee_payment_method: 'Zelle' })),
    { amount: 200, date: '2026-10-01', method: 'Zelle' });
  assert.deepEqual(D.paidFeeCredit(entry('o', { fee_paid_online: { date: '2026-10-02', amount: 257.5, method: 'Credit/debit card', reference: 'pi_1' } })),
    { amount: 257.5, date: '2026-10-02', method: 'Credit/debit card' });
  const keep = entry('k', { status: 'active', fee_received_date: '2026-09-01', fee_amount: 250, received_credits: [{ id: 'c0', amount: 20, date: '2026-08-01', applies_to: ['fee'] }] });
  const drop = entry('d', { status: 'approved', fee_received_date: '2026-10-01', fee_amount: 250, fee_payment_method: 'Zelle', received_credits: [{ id: 'c1', amount: 30, date: '2026-09-15', applies_to: ['deposit'] }] });
  const ch = D.applicationMergeChanges(keep, drop, {}, { today: '2026-11-08' });
  assert.deepEqual(ch.received_credits.map((c) => [c.amount, c.date]), [[20, '2026-08-01'], [30, '2026-09-15'], [250, '2026-10-01']]);
  assert.deepEqual(ch.received_credits[2].applies_to, ['fee', 'deposit', 'price', 'extras']);
  assert.match(ch.received_credits[2].note, /duplicate application/);
  assert.equal(ch.merged_applications[0].fee_credit, 250);
});

// --- The merge (Dexie) -----------------------------------------------------------

test('merging keeps the chosen one, moves the other\'s offers and fee, and deletes it', async () => {
  put('contacts', { id: 'c1', name: 'Jen Smith', email: 'jen@x.com', contact_type: ['buyer'] });
  put('waitlist_entries', entry('keep', { status: 'active', contact_id: 'c1', approved_date: '2026-09-02', fee_received_date: '2026-09-05', fee_amount: 200, application: { name: 'Jen Smith', email: 'jen@x.com' } }));
  put('waitlist_entries', entry('dup', { status: 'applied', applied_date: '2026-10-07', application: { name: 'Jennifer Smyth', email: 'jen@x.com', yard: 'Fenced' }, fee_paid_online: { date: '2026-10-07', amount: 200, reference: 'pi_9' } }));
  put('waitlist_offers', { id: 'o1', entry_id: 'dup', kennel_id: 'K', litter_id: 'L', outcome: 'passed' });

  const res = await A.mergeApplications('keep', 'dup', { date: '2026-11-08', dropName: 'Jennifer Smyth' });
  assert.equal(row('waitlist_entries', 'dup'), undefined, 'the other is deleted, not archived');
  const kept = row('waitlist_entries', 'keep');
  assert.equal(kept.status, 'active');
  assert.equal(kept.fee_received_date, '2026-09-05', 'its own place');
  assert.equal(kept.application.yard, 'Fenced');
  assert.equal(kept.received_credits.length, 1);
  assert.equal(kept.received_credits[0].amount, 200);
  assert.equal(row('waitlist_offers', 'o1').entry_id, 'keep');
  assert.equal(res.moved, 1);
  assert.equal(res.contactsMerged, false);
});

test('an open application with no contact takes the other\'s contact', async () => {
  put('contacts', { id: 'c2', name: 'Ann Lee', email: 'ann@x.com' });
  put('waitlist_entries', entry('a', { application: { name: 'Ann Lee', email: 'ann@x.com', about: 'Long answer' } }));
  put('waitlist_entries', entry('b', { status: 'approved', contact_id: 'c2', approved_date: '2026-10-02', fee_amount: 100, fee_due_date: '2026-10-09', application: { name: 'Ann Lee' } }));
  await A.mergeApplications('a', 'b', { date: '2026-11-08' });
  assert.equal(row('waitlist_entries', 'a').contact_id, 'c2');
  assert.equal(row('waitlist_entries', 'a').status, 'applied', 'the kept one\'s own status');
  assert.equal(row('waitlist_entries', 'b'), undefined);
});

test('their two contact cards merge in the same step, when she asks', async () => {
  put('contacts', { id: 'c1', name: 'Jen Smith', email: 'jen@x.com', contact_type: ['buyer'] });
  put('contacts', { id: 'c2', name: 'Jennifer Smyth', phone: '555-1234567', contact_type: ['buyer'] });
  put('sales', { id: 's', buyer_contact_id: 'c2', kennel_id: 'K', status: 'deposit_pending' });
  put('waitlist_entries', entry('x', { status: 'active', contact_id: 'c1', approved_date: '2026-09-01', fee_received_date: '2026-09-01', fee_amount: 0, fee_payment_method: 'Waived' }));
  put('waitlist_entries', entry('y', { status: 'approved', contact_id: 'c2', approved_date: '2026-10-01', fee_amount: 100, fee_due_date: '2026-10-08' }));
  const res = await A.mergeApplications('x', 'y', { mergeContacts: true, contactChoices: { name: 'keep' }, date: '2026-11-08' });
  assert.equal(res.contactsMerged, true);
  assert.equal(row('contacts', 'c2'), undefined);
  assert.equal(row('contacts', 'c1').phone, '555-1234567');
  assert.equal(row('contacts', 'c1').name, 'Jen Smith');
  assert.equal(row('sales', 's').buyer_contact_id, 'c1');
  assert.equal(row('waitlist_entries', 'x').contact_id, 'c1');
});

test('a refused merge changes nothing', async () => {
  put('waitlist_entries', entry('a', { application: { name: 'A' } }));
  put('waitlist_entries', entry('b', { status: 'active', contact_id: 'c', approved_date: '2026-09-01', fee_received_date: '2026-09-01', application: { name: 'A' } }));
  put('contacts', { id: 'c', name: 'A' });
  put('waitlist_offers', { id: 'o', entry_id: 'b', kennel_id: 'K', litter_id: 'L', outcome: 'passed' });
  await assert.rejects(A.mergeApplications('a', 'b'), /Keep the one that's on the list/);
  assert.ok(row('waitlist_entries', 'a') && row('waitlist_entries', 'b'));
  assert.equal(row('waitlist_offers', 'o').entry_id, 'b');
});
