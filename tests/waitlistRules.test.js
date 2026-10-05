// waitlistRules.test.js — the waitlist rules engine (data/waitlistRules.js,
// Waitlist Spec §6). These are the rules that decide who's next for a pup and who
// drops off the list, so a silent regression would wrong a real family: position
// order, eligibility (incl. breed), listen-only/pause never costing a place, pass
// counting, the second-pass removal + its undo, and Contact.waitlist_status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitlistConfig, WAITLIST_CONFIG_DEFAULTS, feeForEntry, isFeeWaived, feeDueDate, respondByDate,
  anchorDate, isMovedByBreeder, rankedList, overallPositions,
  isPupAvailable, pupMatchesPrefs, prefColorTokens, isPaused, isListeningFor, eligiblePupsFor,
  litterQueue, nextFamilyForLitter, hasOpenOffer,
  countsAsPass, passesUsed, shouldRemoveForPasses, canUndoRemoval, passToForgive,
  overdueOffers, overdueFees, deriveContactWaitlistStatus, contactMatches, entryName,
} from '../shared/data/waitlistRules.js';

const K = 'kennel-a';
const TODAY = '2026-10-05';

let n = 0;
const entry = (over = {}) => ({
  id: over.id ?? `e${++n}`,
  kennel_id: K,
  status: 'active',
  is_archived: false,
  listen_mode: 'all',
  pref_sex: 'any',
  listen_pairing_ids: [],
  listen_litter_ids: [],
  approved_date: '2026-01-01',
  fee_received_date: '2026-01-10',
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
});
const litter = (over = {}) => ({ id: 'L1', kennel_id: K, pairing_id: 'P1', ...over });
const pup = (over = {}) => ({
  id: over.id ?? `d${++n}`, litter_id: 'L1', status: 'puppy', sex: 'female', breed: 'Boston Terrier',
  is_archived: false, ...over,
});
const offer = (over = {}) => ({
  id: over.id ?? `o${++n}`, litter_id: 'L1', kennel_id: K, outcome: 'open', is_archived: false,
  offered_date: '2026-09-01', ...over,
});

// --- Config ---------------------------------------------------------------------

test('waitlistConfig: no kennel / no config → defaults; blank values fall back', () => {
  assert.deepEqual(waitlistConfig(null), { ...WAITLIST_CONFIG_DEFAULTS });
  assert.deepEqual(waitlistConfig({}), { ...WAITLIST_CONFIG_DEFAULTS });
  const c = waitlistConfig({ waitlist_config: { max_passes: 3, respond_days: '', fee_amount: 250 } });
  assert.equal(c.max_passes, 3);
  assert.equal(c.respond_days, 3, 'blank respond_days falls back to the default');
  assert.equal(c.fee_amount, 250);
  assert.equal(c.no_response_counts_as_pass, true, 'Q3 decided: no response counts by default');
  assert.equal(c.color_matching, false);
});

test('fees: a program override wins, 0 means waived, and a blank override is the normal fee', () => {
  const config = waitlistConfig({ waitlist_config: { fee_amount: 300 } });
  assert.equal(feeForEntry(config, null), 300);
  assert.equal(feeForEntry(config, { fee_override: null }), 300);
  assert.equal(feeForEntry(config, { fee_override: '' }), 300);
  assert.equal(feeForEntry(config, { fee_override: 100 }), 100);
  assert.equal(feeForEntry(config, { fee_override: 0 }), 0);
  assert.equal(isFeeWaived(config, { fee_override: 0 }), true);
  assert.equal(isFeeWaived(config, null), false);
  assert.equal(feeForEntry(waitlistConfig(null), null), null, 'no fee configured');
});

test('fee due date only exists when the kennel sets a fee window', () => {
  assert.equal(feeDueDate('2026-10-01', waitlistConfig(null)), null);
  assert.equal(feeDueDate('2026-10-01', waitlistConfig({ waitlist_config: { fee_due_days: 14 } })), '2026-10-15');
});

test('respond-by date uses the program window when it sets one', () => {
  const config = waitlistConfig(null);
  assert.equal(respondByDate('2026-10-01', config, null), '2026-10-04');
  assert.equal(respondByDate('2026-10-01', config, { respond_days_override: 7 }), '2026-10-08');
  assert.equal(respondByDate('2026-12-30', config, null), '2027-01-02', 'crosses a year boundary');
});

// --- Position -----------------------------------------------------------------------

test('order: earliest fee date first; only active, non-archived entries of THIS kennel', () => {
  const a = entry({ id: 'a', fee_received_date: '2026-03-01' });
  const b = entry({ id: 'b', fee_received_date: '2026-02-01' });
  const applied = entry({ id: 'c', status: 'approved', fee_received_date: null });
  const archived = entry({ id: 'd', is_archived: true, fee_received_date: '2025-01-01' });
  const otherKennel = entry({ id: 'e', kennel_id: 'kennel-b', fee_received_date: '2025-01-01' });
  assert.deepEqual(rankedList([a, b, applied, archived, otherKennel], K).map((e) => e.id), ['b', 'a']);
});

test('order: an `ahead` program comes first, still ordered by fee date among themselves', () => {
  const programs = new Map([['prog', { id: 'prog', priority: 'ahead' }], ['std', { id: 'std', priority: 'standard' }]]);
  const early = entry({ id: 'early', fee_received_date: '2026-01-01' });
  const late = entry({ id: 'late', fee_received_date: '2026-06-01', waitlist_program_id: 'prog' });
  const later = entry({ id: 'later', fee_received_date: '2026-07-01', waitlist_program_id: 'prog' });
  const std = entry({ id: 'std', fee_received_date: '2025-12-01', waitlist_program_id: 'std' });
  assert.deepEqual(rankedList([early, later, late, std], K, programs).map((e) => e.id), ['late', 'later', 'std', 'early']);
});

test('order: the manual anchor replaces the fee date but never crosses the priority group', () => {
  const programs = new Map([['prog', { id: 'prog', priority: 'ahead' }]]);
  const ahead = entry({ id: 'ahead', fee_received_date: '2026-09-01', waitlist_program_id: 'prog' });
  const moved = entry({ id: 'moved', fee_received_date: '2026-08-01', position_anchor_date: '2020-01-01' });
  const plain = entry({ id: 'plain', fee_received_date: '2026-02-01' });
  assert.deepEqual(rankedList([plain, moved, ahead], K, programs).map((e) => e.id), ['ahead', 'moved', 'plain']);
  assert.equal(anchorDate(moved), '2020-01-01');
  assert.equal(isMovedByBreeder(moved), true);
  assert.equal(isMovedByBreeder(plain), false);
});

test('order: ties break by approved date, then created_at, then id — deterministic', () => {
  const x = entry({ id: 'x', approved_date: '2026-01-05' });
  const y = entry({ id: 'y', approved_date: '2026-01-02' });
  const z1 = entry({ id: 'z1', approved_date: '2026-01-05', created_at: '2026-01-01T00:00:00.000Z' });
  const z2 = entry({ id: 'z2', approved_date: '2026-01-05', created_at: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(rankedList([z2, x, z1, y], K).map((e) => e.id), ['y', 'x', 'z1', 'z2']);
});

test('a fee-waived entry with no fee date is anchored at its approval date', () => {
  const waived = entry({ id: 'w', fee_received_date: null, approved_date: '2026-01-05' });
  const paid = entry({ id: 'p', fee_received_date: '2026-01-07' });
  assert.deepEqual(rankedList([paid, waived], K).map((e) => e.id), ['w', 'p']);
});

test('positions are derived: removing someone ahead moves everyone behind up', () => {
  const list = [entry({ id: 'a', fee_received_date: '2026-01-01' }), entry({ id: 'b', fee_received_date: '2026-02-01' }), entry({ id: 'c', fee_received_date: '2026-03-01' })];
  assert.equal(overallPositions(list, K).get('c'), 3);
  list[0] = { ...list[0], status: 'placed' };
  assert.equal(overallPositions(list, K).get('c'), 2);
  assert.equal(overallPositions(list, K).has('a'), false);
});

// --- Availability + preferences --------------------------------------------------------

test('a pup is available unless kept back, placed, deceased, archived, or spoken for by a sale', () => {
  assert.equal(isPupAvailable(pup()), true, 'unset disposition counts as available');
  assert.equal(isPupAvailable(pup({ disposition: 'undecided' })), true);
  assert.equal(isPupAvailable(pup({ disposition: 'available' })), true);
  assert.equal(isPupAvailable(pup({ disposition: 'keeping' })), false);
  assert.equal(isPupAvailable(pup({ disposition: 'placed' })), false);
  assert.equal(isPupAvailable(pup({ status: 'deceased' })), false);
  assert.equal(isPupAvailable(pup({ is_archived: true })), false);
  const d = pup({ id: 'dx' });
  assert.equal(isPupAvailable(d, [{ dog_id: 'dx', status: 'deposit_pending', is_archived: false }]), false);
  assert.equal(isPupAvailable(d, [{ dog_id: 'dx', status: 'delivered', is_archived: false }]), false);
  assert.equal(isPupAvailable(d, [{ dog_id: 'dx', status: 'cancelled', is_archived: false }]), true, 'a cancelled sale frees the pup');
  assert.equal(isPupAvailable(d, [{ dog_id: 'dx', status: 'returned', is_archived: false }]), true);
  assert.equal(isPupAvailable(d, [{ dog_id: 'dx', status: 'deposit_paid', is_archived: true }]), true, 'an archived sale is ignored');
});

test('sex preference: any matches both; a set sex matches only that sex', () => {
  assert.equal(pupMatchesPrefs(entry(), pup({ sex: 'male' })), true);
  assert.equal(pupMatchesPrefs(entry({ pref_sex: 'female' }), pup({ sex: 'male' })), false);
  assert.equal(pupMatchesPrefs(entry({ pref_sex: 'female' }), pup({ sex: 'female' })), true);
});

test('breed preference decides eligibility: case-insensitive, trimmed; blank = any', () => {
  assert.equal(pupMatchesPrefs(entry({ pref_breed: '' }), pup({ breed: 'Boxer' })), true);
  assert.equal(pupMatchesPrefs(entry({ pref_breed: 'Boxer' }), pup({ breed: 'Boston Terrier' })), false);
  assert.equal(pupMatchesPrefs(entry({ pref_breed: '  boston terrier ' }), pup({ breed: 'Boston Terrier' })), true);
  assert.equal(pupMatchesPrefs(entry({ pref_breed: 'Boxer' }), pup({ breed: '' })), true, 'a pup with no breed recorded matches any');
});

test('placement preference checks the pup\'s intended placement; unset on either side matches', () => {
  assert.equal(pupMatchesPrefs(entry({ pref_placement_type: 'show' }), pup({ intended_placement: 'pet' })), false);
  assert.equal(pupMatchesPrefs(entry({ pref_placement_type: 'show' }), pup({ intended_placement: 'show' })), true);
  assert.equal(pupMatchesPrefs(entry({ pref_placement_type: 'show' }), pup()), true);
  assert.equal(pupMatchesPrefs(entry(), pup({ intended_placement: 'show' })), true);
});

test('color preference is a note unless color matching is on', () => {
  const fam = entry({ pref_colors: ['Brindle'] });
  const black = pup({ color_markings: 'Black & white' });
  assert.equal(pupMatchesPrefs(fam, black), true, 'off by default (Q4)');
  const on = waitlistConfig({ waitlist_config: { color_matching: true } });
  assert.equal(pupMatchesPrefs(fam, black, on), false);
  assert.equal(pupMatchesPrefs(fam, pup({ color_markings: 'Seal brindle & white' }), on), true);
  assert.deepEqual(prefColorTokens({ pref_colors: 'Red, Fawn ,' }), ['red', 'fawn'], 'tolerates a comma string');
});

// --- Eligibility, listen-only, pause ------------------------------------------------------

test('pause: paused through paused_until inclusive, back in contention the day after', () => {
  assert.equal(isPaused(entry({ paused_until: '2026-10-05' }), TODAY), true);
  assert.equal(isPaused(entry({ paused_until: '2026-10-04' }), TODAY), false);
  assert.equal(isPaused(entry(), TODAY), false);
});

test('listen-only: considered only for chosen litters or pairings', () => {
  const l = litter();
  assert.equal(isListeningFor(entry(), l), true);
  assert.equal(isListeningFor(entry({ listen_mode: 'selected' }), l), false);
  assert.equal(isListeningFor(entry({ listen_mode: 'selected', listen_litter_ids: ['L1'] }), l), true);
  assert.equal(isListeningFor(entry({ listen_mode: 'selected', listen_pairing_ids: ['P1'] }), l), true);
  assert.equal(isListeningFor(entry({ listen_mode: 'selected', listen_pairing_ids: ['P1'] }), litter({ pairing_id: null })), false);
});

test('eligible pups: only this litter, available, matching — and none for an ineligible family', () => {
  const l = litter();
  const girl = pup({ id: 'girl', sex: 'female' });
  const boy = pup({ id: 'boy', sex: 'male' });
  const kept = pup({ id: 'kept', disposition: 'keeping' });
  const other = pup({ id: 'other', litter_id: 'L2' });
  const pups = [girl, boy, kept, other];
  const opts = { today: TODAY };
  assert.deepEqual(eligiblePupsFor(entry(), l, pups, [], opts).map((d) => d.id), ['girl', 'boy']);
  assert.deepEqual(eligiblePupsFor(entry({ pref_sex: 'male' }), l, pups, [], opts).map((d) => d.id), ['boy']);
  assert.deepEqual(eligiblePupsFor(entry({ paused_until: '2026-12-01' }), l, pups, [], opts), []);
  assert.deepEqual(eligiblePupsFor(entry({ listen_mode: 'selected' }), l, pups, [], opts), []);
  assert.deepEqual(eligiblePupsFor(entry({ status: 'approved' }), l, pups, [], opts), []);
  assert.deepEqual(eligiblePupsFor(entry({ kennel_id: 'kennel-b' }), l, pups, [], opts), [], 'another kennel\'s list');
});

test('litter queue: list order, filtered to eligible families, with per-litter positions', () => {
  const l = litter();
  const pups = [pup({ sex: 'female' })];
  const first = entry({ id: 'first', fee_received_date: '2026-01-01', pref_sex: 'male' }); // no match
  const second = entry({ id: 'second', fee_received_date: '2026-02-01' });
  const third = entry({ id: 'third', fee_received_date: '2026-03-01', listen_mode: 'selected' }); // not listening
  const fourth = entry({ id: 'fourth', fee_received_date: '2026-04-01' });
  const q = litterQueue([fourth, third, second, first], l, pups, [], { today: TODAY });
  assert.deepEqual(q.map((x) => [x.entry.id, x.litterPosition]), [['second', 1], ['fourth', 2]]);
  // Overall position is unchanged by being skipped (listen-only never costs a place).
  assert.equal(overallPositions([fourth, third, second, first], K).get('third'), 3);
});

test('next family: one open offer per litter; spent turns skipped; a voided offer gives the turn back', () => {
  const l = litter();
  const pups = [pup(), pup()];
  const a = entry({ id: 'a', fee_received_date: '2026-01-01' });
  const b = entry({ id: 'b', fee_received_date: '2026-02-01' });
  const c = entry({ id: 'c', fee_received_date: '2026-03-01' });
  const entries = [a, b, c];
  const opts = { today: TODAY };

  assert.equal(nextFamilyForLitter(entries, [], l, pups, [], opts).entry.id, 'a');
  assert.equal(nextFamilyForLitter(entries, [offer({ entry_id: 'a' })], l, pups, [], opts), null, 'an offer is open');
  assert.equal(hasOpenOffer([offer({ entry_id: 'a' })], 'L1'), true);

  const spent = [offer({ entry_id: 'a', outcome: 'passed' })];
  assert.equal(nextFamilyForLitter(entries, spent, l, pups, [], opts).entry.id, 'b');
  const voided = [offer({ entry_id: 'a', outcome: 'voided' })];
  assert.equal(nextFamilyForLitter(entries, voided, l, pups, [], opts).entry.id, 'a');
  const otherLitter = [offer({ entry_id: 'a', outcome: 'passed', litter_id: 'L9' })];
  assert.equal(nextFamilyForLitter(entries, otherLitter, l, pups, [], opts).entry.id, 'a', 'a pass on another litter doesn\'t spend this one');

  const allSpent = ['a', 'b', 'c'].map((id) => offer({ entry_id: id, outcome: 'no_response' }));
  assert.equal(nextFamilyForLitter(entries, allSpent, l, pups, [], opts), null, 'list ran out');
});

// --- Passes, removal, undo ---------------------------------------------------------------------

test('countsAsPass: passed always, no_response per config, never voided/accepted/open, never for a passes_count=false program', () => {
  const config = waitlistConfig(null);
  assert.equal(countsAsPass('passed', { config }), true);
  assert.equal(countsAsPass('no_response', { config }), true);
  assert.equal(countsAsPass('no_response', { config: waitlistConfig({ waitlist_config: { no_response_counts_as_pass: false } }) }), false);
  for (const o of ['voided', 'accepted', 'open']) assert.equal(countsAsPass(o, { config }), false, o);
  assert.equal(countsAsPass('passed', { config, program: { passes_count: false } }), false);
  assert.equal(countsAsPass('passed', { config, program: { passes_count: true } }), true);
});

test('passes are counted from frozen counts_as_pass; the second removes the family', () => {
  const e = entry({ id: 'fam' });
  const offers = [
    offer({ entry_id: 'fam', outcome: 'passed', counts_as_pass: true }),
    offer({ entry_id: 'fam', outcome: 'voided', counts_as_pass: false }),
    offer({ entry_id: 'fam', outcome: 'passed', counts_as_pass: true, is_archived: true }),
    offer({ entry_id: 'other', outcome: 'passed', counts_as_pass: true }),
  ];
  assert.equal(passesUsed(e, offers), 1);
  assert.equal(shouldRemoveForPasses(e, offers), false);
  offers.push(offer({ entry_id: 'fam', outcome: 'no_response', counts_as_pass: true }));
  assert.equal(passesUsed(e, offers), 2);
  assert.equal(shouldRemoveForPasses(e, offers), true);
  assert.equal(shouldRemoveForPasses(e, offers, waitlistConfig({ waitlist_config: { max_passes: 3 } })), false);
  assert.equal(shouldRemoveForPasses({ ...e, status: 'removed' }, offers), false, 'already off the list');
});

test('undo window is 7 days from removed_date, second-pass removals only', () => {
  const removed = entry({ status: 'removed', removed_reason: 'second_pass', removed_date: '2026-09-28' });
  assert.equal(canUndoRemoval(removed, '2026-10-05'), true, 'day 7');
  assert.equal(canUndoRemoval(removed, '2026-10-06'), false, 'day 8');
  assert.equal(canUndoRemoval({ ...removed, removed_reason: 'by_breeder' }, '2026-09-29'), false);
  assert.equal(canUndoRemoval(entry(), TODAY), false);
});

test('undo forgives the most recent counted pass, so the family isn\'t removed again at once', () => {
  const e = entry({ id: 'fam', status: 'removed', removed_reason: 'second_pass', removed_date: '2026-10-01' });
  const first = offer({ id: 'first', entry_id: 'fam', outcome: 'passed', counts_as_pass: true, outcome_date: '2026-05-01' });
  const second = offer({ id: 'second', entry_id: 'fam', outcome: 'no_response', counts_as_pass: true, outcome_date: '2026-10-01' });
  const offers = [second, first];
  assert.equal(passToForgive(e, offers).id, 'second');
  const afterUndo = offers.map((o) => (o.id === 'second' ? { ...o, counts_as_pass: false } : o));
  assert.equal(shouldRemoveForPasses({ ...e, status: 'active' }, afterUndo), false);
});

// --- Deadlines -------------------------------------------------------------------------------

test('overdue offers and fees are the ones past their date (today itself is still on time)', () => {
  const offers = [
    offer({ id: 'late', respond_by_date: '2026-10-04' }),
    offer({ id: 'due-today', respond_by_date: TODAY }),
    offer({ id: 'closed', respond_by_date: '2026-09-01', outcome: 'passed' }),
  ];
  assert.deepEqual(overdueOffers(offers, TODAY).map((o) => o.id), ['late']);
  const entries = [
    entry({ id: 'unpaid', status: 'approved', fee_due_date: '2026-10-01' }),
    entry({ id: 'no-window', status: 'approved' }),
    entry({ id: 'paid', status: 'active', fee_due_date: '2026-10-01' }),
  ];
  assert.deepEqual(overdueFees(entries, TODAY).map((e) => e.id), ['unpaid']);
});

// --- Contact.waitlist_status ----------------------------------------------------------------------

test('contact waitlist_status: active while any run is open; fulfilled when the latest ended placed; else none', () => {
  assert.equal(deriveContactWaitlistStatus([]), 'none');
  assert.equal(deriveContactWaitlistStatus([entry({ status: 'applied' })]), 'active');
  assert.equal(deriveContactWaitlistStatus([entry({ status: 'approved' })]), 'active');
  assert.equal(deriveContactWaitlistStatus([entry({ status: 'placed', created_at: '2024-01-01' })]), 'fulfilled');
  assert.equal(deriveContactWaitlistStatus([
    entry({ status: 'placed', created_at: '2024-01-01' }),
    entry({ status: 'active', created_at: '2026-01-01' }),
  ]), 'active', 'a second run for another puppy');
  assert.equal(deriveContactWaitlistStatus([
    entry({ status: 'placed', created_at: '2024-01-01' }),
    entry({ status: 'withdrawn', created_at: '2026-01-01' }),
  ]), 'none', 'latest run ended without a placement');
  assert.equal(deriveContactWaitlistStatus([entry({ status: 'active', is_archived: true })]), 'none', 'archived ignored');
});

// --- Applicant ↔ Contact matching (Spec §5.2) ---------------------------------------

test('contact matches: email first (case/space-insensitive), then same-name; archived excluded; never automatic', () => {
  const contacts = [
    { id: 'c1', name: 'Jane Smith', email: 'JANE@example.com ' },
    { id: 'c2', name: 'jane smith', email: 'other@example.com' },
    { id: 'c3', name: 'Jane Smith', email: '', is_archived: true },
    { id: 'c4', name: 'Bob Lee', email: '' },
  ];
  const m = contactMatches({ name: ' Jane Smith', email: 'jane@example.com' }, contacts);
  assert.deepEqual(m.map((x) => [x.contact.id, x.reason]), [['c1', 'email'], ['c2', 'name']]);
  assert.deepEqual(contactMatches({ name: 'Nobody' }, contacts), []);
  assert.deepEqual(contactMatches({}, contacts), [], 'blank applicant matches nothing');
});

test('entryName: the linked contact wins, else the applicant, else a placeholder', () => {
  assert.equal(entryName({ application: { name: 'Applied As' } }, { name: 'Contact Name' }), 'Contact Name');
  assert.equal(entryName({ application: { name: 'Applied As' } }, null), 'Applied As');
  assert.equal(entryName({}, null), 'Unnamed applicant');
});
