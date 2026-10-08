// waitlistRules.test.js — the waitlist rules engine (data/waitlistRules.js,
// Waitlist Spec §6). These are the rules that decide who's next for a pup and who
// drops off the list, so a silent regression would wrong a real family: position
// order, eligibility (incl. breed), listen-only/pause never costing a place, pass
// counting, the second-pass removal + its undo, and Contact.waitlist_status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitlistConfig, WAITLIST_CONFIG_DEFAULTS, autoOffers, autoOfferSummary, closingTrigger, feeForEntry, isFeeWaived, feeDueDate, respondByDate,
  anchorDate, isMovedByBreeder, rankedList, overallPositions,
  isPupAvailable, pupMatchesPrefs, prefColorTokens, isPaused, isManuallyPaused, isReadyHeld, readyFromDate, isListeningFor, eligiblePupsFor,
  litterQueue, nextFamilyForLitter, hasOpenOffer, turnSpent,
  countsAsPass, passesUsed, shouldRemoveForPasses, canUndoRemoval, passToForgive,
  overdueOffers, overdueFees, deriveContactWaitlistStatus, contactMatches, entryName,
  soonFamiliesForLitter, soonFamiliesForKennel, soonNoticeText, SOON_NOTICE_DEFAULT, describeOfferChanges,
  isAwaitingDeposit, switchablePups, canSwitchAcceptedPick, undoPassBlocker, kennelBreeds, resolveBreed,
  prefChangeLines, narrowedPrefs, prefChangeEffect, PREF_CHANGE_FIELDS,
  turnIdOf, turnOffers, openTurns, turnLittersFor, nextTurn, joinsOpenTurn, overdueTurns,
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
  listen_sire_ids: [],
  listen_dam_ids: [],
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
  assert.deepEqual(c.auto_offer_on, [], 'decided 2026-10-06: offers are made by her unless she turns this on');
  assert.equal('auto_offer_next' in c, false, 'replaced by auto_offer_on (2026-10-08)');
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

test('listen-only: considered only for litters by a chosen sire OR out of a chosen dam', () => {
  const l = litter({ sire_id: 'S1', dam_id: 'D1' });
  const sel = (over) => entry({ listen_mode: 'selected', ...over });
  assert.equal(isListeningFor(entry(), l), true);
  assert.equal(isListeningFor(sel(), l), false, 'nothing picked yet');
  assert.equal(isListeningFor(sel({ listen_sire_ids: ['S1'] }), l), true);
  assert.equal(isListeningFor(sel({ listen_dam_ids: ['D1'] }), l), true);
  assert.equal(isListeningFor(sel({ listen_sire_ids: ['S1'], listen_dam_ids: ['D9'] }), l), true, 'either side is enough');
  assert.equal(isListeningFor(sel({ listen_sire_ids: ['S9'], listen_dam_ids: ['D9'] }), l), false);
  assert.equal(isListeningFor(sel({ listen_sire_ids: ['D1'] }), l), false, 'a dog picked as sire never matches the dam side');
  assert.equal(isListeningFor(sel({ listen_sire_ids: ['S1'] }), litter({ sire_id: null, dam_id: 'D1' })), false, 'unknown sire');
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

// --- Sale prefill shared with the accept flow (data/saleDefaults.js) ---------------
import { expectedPricing } from '../shared/data/saleDefaults.js';

test('expectedPricing: by the pup\'s sex from the litter; nulls when unknown or blank', () => {
  const litter = { expected_price_male: 2500, expected_price_female: 2800, expected_deposit_male: 500, expected_deposit_female: '' };
  assert.deepEqual(expectedPricing({ sex: 'male' }, litter), { price: 2500, deposit_amount: 500 });
  assert.deepEqual(expectedPricing({ sex: 'female' }, litter), { price: 2800, deposit_amount: null });
  assert.deepEqual(expectedPricing({ sex: '' }, litter), { price: null, deposit_amount: null });
  assert.deepEqual(expectedPricing({ sex: 'male' }, null), { price: null, deposit_amount: null });
});

test('turnSpent: any offer but a voided one uses up the family\'s turn on that litter', () => {
  const offers = [
    offer({ entry_id: 'a', litter_id: 'L1', outcome: 'passed' }),
    offer({ entry_id: 'b', litter_id: 'L1', outcome: 'voided' }),
    offer({ entry_id: 'c', litter_id: 'L2', outcome: 'open' }),
    offer({ entry_id: 'd', litter_id: 'L1', outcome: 'open', is_archived: true }),
  ];
  assert.equal(turnSpent(offers, 'L1', 'a'), true);
  assert.equal(turnSpent(offers, 'L1', 'b'), false, 'a voided offer gives the turn back');
  assert.equal(turnSpent(offers, 'L1', 'c'), false, 'another litter');
  assert.equal(turnSpent(offers, 'L1', 'd'), false, 'archived offers are ignored');
});

// --- "It's almost your turn" (Spec §15.5) ---------------------------------------

test('soon: one family per available pup, in line order, skipping ineligible families', () => {
  const L = litter();
  const pups = [pup(), pup()];
  const a = entry({ fee_received_date: '2026-01-01' });
  const paused = entry({ fee_received_date: '2026-01-02', paused_until: '2026-12-31' });
  const b = entry({ fee_received_date: '2026-01-03' });
  const c = entry({ fee_received_date: '2026-01-04' });
  const rows = soonFamiliesForLitter([c, b, paused, a], [], L, pups, [], { today: TODAY });
  assert.deepEqual(rows.map((r) => r.entry.id), [a.id, b.id], 'two pups → the first two eligible families');
  assert.deepEqual(rows.map((r) => r.soonPosition), [1, 2]);
  assert.ok(rows.every((r) => !r.inFlight));
});

test('soon: a family with an open offer anywhere counts toward the pups but is in flight', () => {
  const L1 = litter({ id: 'L1' });
  const pups = [pup(), pup()];
  const a = entry({ fee_received_date: '2026-01-01' });
  const b = entry({ fee_received_date: '2026-01-02' });
  const c = entry({ fee_received_date: '2026-01-03' });
  // `a` is mid-decision on ANOTHER litter.
  const offers = [offer({ entry_id: a.id, litter_id: 'L2' })];
  const rows = soonFamiliesForLitter([a, b, c], offers, L1, pups, [], { today: TODAY });
  assert.deepEqual(rows.map((r) => [r.entry.id, r.inFlight]), [[a.id, true], [b.id, false]],
    'a takes a pup\'s worth of room, so c is not reached');
});

test('soon: an open offer on this litter counts; a closed turn here frees the room', () => {
  const L = litter();
  const pups = [pup(), pup()];
  const a = entry({ fee_received_date: '2026-01-01' });
  const b = entry({ fee_received_date: '2026-01-02' });
  const c = entry({ fee_received_date: '2026-01-03' });
  const openHere = [offer({ entry_id: b.id })];
  assert.deepEqual(soonFamiliesForLitter([a, b, c], openHere, L, pups, [], { today: TODAY }).map((r) => [r.entry.id, r.inFlight]),
    [[a.id, false], [b.id, true]]);
  const passedHere = [offer({ entry_id: a.id, outcome: 'passed' })];
  assert.deepEqual(soonFamiliesForLitter([a, b, c], passedHere, L, pups, [], { today: TODAY }).map((r) => r.entry.id),
    [b.id, c.id], 'a already passed on this litter, so they are not counted');
  // The family holding this litter's open offer is now paused: still holds the turn.
  const pausedHolder = entry({ fee_received_date: '2026-01-01', paused_until: '2026-12-31' });
  assert.deepEqual(soonFamiliesForLitter([pausedHolder, b, c], [offer({ entry_id: pausedHolder.id })], L, pups, [], { today: TODAY })
    .map((r) => r.entry.id), [b.id]);
});

test('soon: no available pups → nobody', () => {
  const placed = pup({ disposition: 'placed' });
  assert.deepEqual(soonFamiliesForLitter([entry()], [], litter(), [placed], [], { today: TODAY }), []);
});

test('soon across litters: one row per family, in list order; in-flight families flagged', () => {
  const L1 = litter({ id: 'L1' });
  const L2 = litter({ id: 'L2', pairing_id: 'P2' });
  const pups = [pup({ litter_id: 'L1' }), pup({ litter_id: 'L2' }), pup({ litter_id: 'L2' })];
  const a = entry({ fee_received_date: '2026-01-01' });
  const b = entry({ fee_received_date: '2026-01-02' });
  const c = entry({ fee_received_date: '2026-01-03' });
  const offers = [offer({ entry_id: a.id, litter_id: 'L1' })];
  const rows = soonFamiliesForKennel([c, b, a], offers, [L1, L2], pups, [], { today: TODAY });
  assert.deepEqual(rows.map((r) => r.entry.id), [a.id, b.id]);
  assert.equal(rows[0].inFlight, true, 'a holds an offer on L1');
  assert.deepEqual(rows[0].litters.map((x) => x.litter.id), ['L1', 'L2']);
  assert.deepEqual(rows[1].litters.map((x) => [x.litter.id, x.soonPosition]), [['L2', 2]]);
});

test('soonNoticeText: her default, [Kennel Name] filled in, first line is the subject', () => {
  const n = soonNoticeText(waitlistConfig(null), 'Thornfield Kennels');
  assert.equal(n.subject, "It's almost your turn!");
  assert.ok(n.body.startsWith('Thornfield Kennels has puppies who will soon be searching'));
  assert.ok(!n.text.includes('[Kennel Name]'));
  assert.ok(SOON_NOTICE_DEFAULT.includes('[Kennel Name]'));
  const custom = soonNoticeText({ soon_notice_text: 'Pups soon\nHi from [kennel name]!' }, 'Oak');
  assert.deepEqual([custom.subject, custom.body], ['Pups soon', 'Hi from Oak!']);
});

test('describeOfferChanges: nothing changed → no lines; voids and new offers are named', () => {
  const opts = { nameOf: (id) => `fam-${id}`, litterOf: (id) => `lit-${id}` };
  assert.deepEqual(describeOfferChanges({}, opts), []);
  const lines = describeOfferChanges({
    next: offer({ entry_id: 'x', litter_id: 'A', respond_by_date: '2026-10-09' }),
    voided: [offer({ litter_id: 'B' })],
    offered: [offer({ entry_id: 'y', litter_id: 'B', respond_by_date: '2026-10-09' })],
  }, opts);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /lit-B was voided \(not a pass\)/);
  assert.match(lines[1], /lit-A: now fam-x's turn/);
  assert.match(lines[2], /lit-B: now fam-y's turn/);
  assert.match(describeOfferChanges({ next: { entry_id: 'x', litter_ids: ['A', 'B'], respond_by_date: '2026-10-09' } }, opts)[0], /lit-A, lit-B: now fam-x's turn/, 'a turn names every litter it covers');
  assert.match(describeOfferChanges({ voided: [offer({ litter_id: 'B' })] }, opts).at(-1), /Nobody else/);
});

// --- Her fixes, 2026-10-06 ---------------------------------------------------------

test('order: two fees on the same day stay in the order they were PAID, not the order they applied', () => {
  // Applied/approved first, but paid second.
  const early = entry({ id: 'early', approved_date: '2026-01-01', created_at: '2026-01-01T00:00:00.000Z', fee_received_date: '2026-02-01', fee_received_at: '2026-02-01T15:00:00.000Z' });
  const late = entry({ id: 'late', approved_date: '2026-01-20', created_at: '2026-01-20T00:00:00.000Z', fee_received_date: '2026-02-01', fee_received_at: '2026-02-01T09:00:00.000Z' });
  assert.deepEqual(rankedList([early, late], K).map((e) => e.id), ['late', 'early']);
  // A different fee DATE still wins over the recorded time.
  const backdated = entry({ id: 'back', fee_received_date: '2026-01-31', fee_received_at: '2026-02-02T09:00:00.000Z' });
  assert.deepEqual(rankedList([early, late, backdated], K).map((e) => e.id), ['back', 'late', 'early']);
});

test('awaiting deposit: an open offer with a pick; never a closed one', () => {
  assert.equal(isAwaitingDeposit(offer({ chosen_dog_id: 'd' })), true);
  assert.equal(isAwaitingDeposit(offer()), false);
  assert.equal(isAwaitingDeposit(offer({ outcome: 'accepted', chosen_dog_id: 'd' })), false);
});

test('a held pick keeps the litter\'s turn: nobody else is next while it waits on the deposit', () => {
  const a = entry({ id: 'a', fee_received_date: '2026-01-01' });
  const b = entry({ id: 'b', fee_received_date: '2026-02-01' });
  const pups = [pup({ id: 'p1' }), pup({ id: 'p2' })];
  const held = offer({ entry_id: 'a', chosen_dog_id: 'p1', sale_id: 's1' });
  const sales = [{ id: 's1', dog_id: 'p1', status: 'deposit_pending', is_archived: false }];
  assert.equal(nextFamilyForLitter([a, b], [held], litter(), pups, sales, { today: TODAY }), null);
});

test('switchable pups: this litter\'s available, matching pups other than the current pick', () => {
  const fam = entry({ status: 'placed', pref_sex: 'female' });
  const pups = [pup({ id: 'cur' }), pup({ id: 'f2' }), pup({ id: 'm1', sex: 'male' }), pup({ id: 'sold' }), pup({ id: 'other', litter_id: 'L2' })];
  const sales = [{ dog_id: 'cur', status: 'deposit_pending', is_archived: false }, { dog_id: 'sold', status: 'deposit_paid', is_archived: false }];
  assert.deepEqual(switchablePups(fam, litter(), pups, sales, { currentDogId: 'cur' }).map((d) => d.id), ['f2']);
});

test('an accepted pick can be switched until the next family is offered (a voided later offer doesn\'t count)', () => {
  const acc = offer({ id: 'acc', outcome: 'accepted', chosen_dog_id: 'p1', created_at: '2026-09-01T10:00:00.000Z' });
  assert.equal(canSwitchAcceptedPick(acc, [acc]), true);
  const voidedLater = offer({ outcome: 'voided', created_at: '2026-09-02T10:00:00.000Z' });
  assert.equal(canSwitchAcceptedPick(acc, [acc, voidedLater]), true);
  const earlier = offer({ outcome: 'passed', created_at: '2026-08-01T10:00:00.000Z' });
  assert.equal(canSwitchAcceptedPick(acc, [acc, earlier]), true);
  const nextFam = offer({ outcome: 'open', created_at: '2026-09-03T10:00:00.000Z' });
  assert.equal(canSwitchAcceptedPick(acc, [acc, nextFam]), false);
  assert.equal(canSwitchAcceptedPick(offer({ outcome: 'passed' }), []), false);
});

test('undo a pass: only a pass / no response, for a family still on the list or removed by it within 7 days', () => {
  const passed = offer({ outcome: 'passed' });
  assert.equal(undoPassBlocker(passed, entry(), TODAY), '');
  assert.equal(undoPassBlocker(offer({ outcome: 'no_response' }), entry(), TODAY), '');
  assert.notEqual(undoPassBlocker(offer({ outcome: 'accepted' }), entry(), TODAY), '');
  assert.notEqual(undoPassBlocker(offer({ outcome: 'voided' }), entry(), TODAY), '');
  assert.equal(undoPassBlocker(passed, entry({ status: 'removed', removed_reason: 'second_pass', removed_date: '2026-10-01' }), TODAY), '');
  assert.notEqual(undoPassBlocker(passed, entry({ status: 'removed', removed_reason: 'second_pass', removed_date: '2026-09-01' }), TODAY), '');
  assert.notEqual(undoPassBlocker(passed, entry({ status: 'placed' }), TODAY), '');
  assert.notEqual(undoPassBlocker(passed, entry({ status: 'removed', removed_reason: 'by_breeder', removed_date: TODAY }), TODAY), '');
});

test('undone pass: the reopened offer holds the turn, and the family is spent no longer once it is open again', () => {
  const a = entry({ id: 'a', fee_received_date: '2026-01-01' });
  const b = entry({ id: 'b', fee_received_date: '2026-02-01' });
  const pups = [pup({ id: 'p1' })];
  // After the undo: A's offer is open again, B's was voided.
  const offers = [offer({ entry_id: 'a', outcome: 'open' }), offer({ entry_id: 'b', outcome: 'voided' })];
  assert.equal(nextFamilyForLitter([a, b], offers, litter(), pups, [], { today: TODAY }), null);
  // When A's turn settles (passes again), B — whose voided offer didn't spend the turn — is next.
  offers[0].outcome = 'passed';
  assert.equal(nextFamilyForLitter([a, b], offers, litter(), pups, [], { today: TODAY }).entry.id, 'b');
});

test('describeOfferChanges: with automatic offers off, who is next is named but not offered', () => {
  const opts = { nameOf: (id) => `fam-${id}`, litterOf: (id) => `lit-${id}` };
  const lines = describeOfferChanges({ waiting: [{ litter_id: 'A', entry_id: 'x' }] }, opts);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /lit-A: fam-x is next\. No turn was offered/);
  const both = describeOfferChanges({ voided: [offer({ litter_id: 'B' })], waiting: [{ litter_id: 'B', entry_id: 'y' }] }, opts);
  assert.ok(!both.some((l) => /Nobody else/.test(l)), 'a waiting family means somebody IS eligible');
});

test('kennel breeds: this kennel\'s live dogs\' breeds + its preferred breeds, deduped case-insensitively, sorted', () => {
  const kennel = { id: K, preferred_breeds: ['french bulldog', 'Pug'] };
  const dogs = [
    { kennel_id: K, breed: 'Boston Terrier' }, { kennel_id: K, breed: ' boston terrier ' },
    { kennel_id: K, breed: 'French Bulldog' }, { kennel_id: K, breed: '' },
    { kennel_id: K, breed: 'Beagle', is_archived: true }, { kennel_id: 'other', breed: 'Poodle' },
  ];
  assert.deepEqual(kennelBreeds(kennel, dogs), ['Boston Terrier', 'French Bulldog', 'Pug']);
  assert.deepEqual(kennelBreeds(null, dogs), []);
});

test('resolveBreed: the kennel\'s spelling for a case/space variant; null when unknown; blank = any', () => {
  const breeds = ['Boston Terrier', 'French Bulldog'];
  assert.equal(resolveBreed('  boston TERRIER ', breeds), 'Boston Terrier');
  assert.equal(resolveBreed('Boston', breeds), null);
  assert.equal(resolveBreed('Bostin Terrier', breeds), null);
  assert.equal(resolveBreed('', breeds), '');
});

// --- Readiness hold (Spec §15.8) -----------------------------------------------------

test('readiness hold: the soonest they can commit, from the fee date (or approval with no fee)', () => {
  assert.equal(readyFromDate(entry({ ready_timing: 'asap' })), null);
  assert.equal(readyFromDate(entry({ ready_timing: undefined })), null, 'not answered = no hold');
  assert.equal(readyFromDate(entry({ ready_timing: '1_month', fee_received_date: '2026-01-10' })), '2026-02-10');
  assert.equal(readyFromDate(entry({ ready_timing: '3_months', fee_received_date: '2026-01-10' })), '2026-04-10');
  assert.equal(readyFromDate(entry({ ready_timing: '6_plus_months', fee_received_date: '2026-01-10' })), '2026-07-10');
  assert.equal(readyFromDate(entry({ ready_timing: '1_month', fee_received_date: null, approved_date: '2026-08-31' })), '2026-09-30', 'no fee → approval; month-end clamps');
  assert.equal(readyFromDate(entry({ ready_timing: '1_month', fee_received_date: null, approved_date: null })), null);
});

test('readiness hold: paused (no offers, off the public list) until the ready date, then back', () => {
  const held = entry({ ready_timing: '3_months', fee_received_date: '2026-08-01' }); // ready 2026-11-01
  assert.equal(isReadyHeld(held, TODAY), true);
  assert.equal(isPaused(held, TODAY), true);
  assert.equal(isManuallyPaused(held, TODAY), false);
  assert.equal(isReadyHeld(held, '2026-11-01'), false, 'back in contention on the ready date');
  const l = litter();
  assert.deepEqual(eligiblePupsFor(held, l, [pup()], [], { today: TODAY }), []);
  assert.equal(eligiblePupsFor(held, l, [pup()], [], { today: '2026-11-01' }).length, 1);
});

// --- Changes to the matching answers (Spec §15.9) -----------------------------------

test('prefChangeLines: one line per tracked field that really changed', () => {
  const before = entry({ pref_sex: 'male', pref_breed: 'Boston Terrier', pref_colors: ['Brindle', 'seal'], ready_timing: 'asap' });
  const lines = prefChangeLines(before, {
    pref_sex: 'any', pref_breed: 'boston terrier ', pref_colors: ['seal', 'brindle'], ready_timing: '3_months', notes: 'x'
  }, { date: TODAY });
  assert.deepEqual(lines, [
    { date: TODAY, field: 'pref_sex', from: 'male', to: 'any', by: 'breeder' },
    { date: TODAY, field: 'ready_timing', from: 'asap', to: '3_months', by: 'breeder' }
  ], 'breed case and color order are not changes; untracked fields are ignored');
  assert.deepEqual(prefChangeLines(entry({ pref_placement_type: '' }), { pref_placement_type: null }, { date: TODAY }), [], 'blank and null alike');
  assert.equal(prefChangeLines(entry(), { pref_breed: 'Frenchie' }, { date: TODAY, by: 'request' })[0].by, 'request');
  assert.deepEqual(PREF_CHANGE_FIELDS, ['pref_sex', 'pref_breed', 'pref_placement_type', 'pref_colors', 'ready_timing']);
});

test('narrowedPrefs: any → specific, specific → other, later readiness; colors only with matching on', () => {
  const e = entry({ pref_sex: 'any', pref_breed: '', pref_placement_type: 'pet', pref_colors: ['seal'], ready_timing: '1_month' });
  assert.deepEqual(narrowedPrefs(e, { pref_sex: 'female', pref_breed: 'Boston Terrier', pref_placement_type: 'show', ready_timing: '6_plus_months' }),
    ['pref_sex', 'pref_breed', 'pref_placement_type', 'ready_timing']);
  assert.deepEqual(narrowedPrefs(e, { pref_placement_type: '', ready_timing: 'asap', pref_sex: 'any' }), [], 'wider is never narrowing');
  assert.deepEqual(narrowedPrefs(e, { pref_colors: ['brindle'] }), [], 'colors are notes while matching is off');
  const on = { ...WAITLIST_CONFIG_DEFAULTS, color_matching: true };
  assert.deepEqual(narrowedPrefs(e, { pref_colors: ['brindle'] }, on), ['pref_colors'], 'dropping a color narrows');
  assert.deepEqual(narrowedPrefs(e, { pref_colors: ['seal', 'brindle'] }, on), [], 'adding a color widens');
  assert.deepEqual(narrowedPrefs(e, { pref_colors: [] }, on), [], 'clearing colors widens to any');
  assert.deepEqual(narrowedPrefs(entry({ pref_colors: [] }), { pref_colors: ['seal'] }, on), ['pref_colors']);
});

test('prefChangeEffect: next-for litters they would be skipped on, and open offers (which stay open)', () => {
  const a = entry({ id: 'a', fee_received_date: '2026-01-01' });
  const b = entry({ id: 'b', fee_received_date: '2026-02-01' });
  const l = litter();
  const pups = [pup({ sex: 'female' })];
  const opts = { litters: [l], entries: [a, b], offers: [], pups, sales: [], today: TODAY };
  const fx = prefChangeEffect(a, { pref_sex: 'male' }, opts);
  assert.deepEqual(fx.narrowed, ['pref_sex']);
  assert.deepEqual(fx.skippedLitters.map((x) => x.id), ['L1'], 'a is next; wanting a male skips them');
  assert.deepEqual(prefChangeEffect(a, { pref_sex: 'female' }, opts).skippedLitters, [], 'still matches, still next');
  assert.deepEqual(prefChangeEffect(b, { pref_sex: 'male' }, opts).skippedLitters, [], 'b is not next');
  const o = offer({ entry_id: 'a' });
  const withOffer = prefChangeEffect(a, { pref_sex: 'male' }, { ...opts, offers: [o] });
  assert.deepEqual(withOffer.openOffers.map((x) => x.id), [o.id]);
  assert.deepEqual(withOffer.skippedLitters, [], 'an offer is open, so nobody is "next"');
  assert.deepEqual(prefChangeEffect(a, { pref_sex: 'any' }, { ...opts, offers: [o] }),
    { narrowed: [], openOffers: [], skippedLitters: [] }, 'widening has nothing to warn about');
});

test('automatic offers are per moment; the old all-or-nothing switch still means every moment (Spec §4.6)', () => {
  const none = waitlistConfig({ waitlist_config: {} });
  const all = ['accepted', 'passed', 'no_response', 'no_deposit', 'left'];
  for (const t of all) assert.equal(autoOffers(none, t), false, t);
  const legacy = waitlistConfig({ waitlist_config: { auto_offer_next: true } });
  for (const t of all) assert.equal(autoOffers(legacy, t), true, t);
  assert.equal(autoOffers(waitlistConfig({ waitlist_config: { auto_offer_next: false } }), 'passed'), false);
  const some = waitlistConfig({ waitlist_config: { auto_offer_next: true, auto_offer_on: ['accepted', 'no_response'] } });
  assert.equal(autoOffers(some, 'accepted'), true);
  assert.equal(autoOffers(some, 'no_response'), true);
  assert.equal(autoOffers(some, 'passed'), false, 'the new list wins over the old switch');
  assert.equal(autoOffers(some, 'left'), false);
  assert.equal(autoOffers(some, 'no_deposit'), false, 'a missed deposit is its own moment');
  assert.equal(autoOffers(some, undefined), false);
  assert.match(autoOfferSummary(some), /accepts a pup or lets the deadline pass/);
  assert.match(autoOfferSummary(none), /you offer the next family/);
  assert.match(autoOfferSummary(legacy), /offered automatically\.$/);
});

test('a no response on an offer with a pick is the missed deposit (closingTrigger)', () => {
  assert.equal(closingTrigger({ chosen_dog_id: 'd1' }, 'no_response'), 'no_deposit');
  assert.equal(closingTrigger({ chosen_dog_id: null }, 'no_response'), 'no_response');
  assert.equal(closingTrigger({ chosen_dog_id: 'd1' }, 'passed'), 'passed');
  assert.equal(closingTrigger({ chosen_dog_id: 'd1' }, 'accepted'), 'accepted');
});

// --- Turns (Spec §16.1, decided 2026-10-08) -------------------------------------------

function turnWorld() {
  const A = litter({ id: 'A', picks_opened_date: '2026-10-01' });
  const B = litter({ id: 'B', picks_opened_date: '2026-10-01' });
  const pups = [
    pup({ id: 'a-m', litter_id: 'A', sex: 'male' }), pup({ id: 'a-f', litter_id: 'A', sex: 'female' }),
    pup({ id: 'b-f', litter_id: 'B', sex: 'female' }),
  ];
  const lee = entry({ id: 'lee', fee_received_date: '2026-01-01', pref_sex: 'male' }); // only A has a male
  const kim = entry({ id: 'kim', fee_received_date: '2026-01-02' }); // anything
  const ng = entry({ id: 'ng', fee_received_date: '2026-01-03', pref_sex: 'female' });
  return { A, B, pups, entries: [lee, kim, ng], opts: { today: TODAY, kennelId: K } };
}

test('a turn lists every open litter the family matches, one family at a time kennel-wide', () => {
  const w = turnWorld();
  const next = nextTurn(w.entries, [], [w.A, w.B], w.pups, [], w.opts);
  assert.equal(next.entry.id, 'lee');
  assert.deepEqual(next.litters.map((x) => [x.litter.id, x.eligibleDogs.map((d) => d.id)]), [['A', ['a-m']]]);
  // Lee holds the turn: nobody else is offered anything, on either litter.
  const held = [offer({ id: 'o1', entry_id: 'lee', litter_id: 'A', turn_id: 't1' })];
  assert.equal(nextTurn(w.entries, held, [w.A, w.B], w.pups, [], w.opts), null);
  // Lee passed: the Kims' turn shows BOTH litters, so they choose knowing what's left of each.
  const passed = [offer({ id: 'o1', entry_id: 'lee', litter_id: 'A', turn_id: 't1', outcome: 'passed' })];
  const kim = nextTurn(w.entries, passed, [w.A, w.B], w.pups, [], w.opts);
  assert.equal(kim.entry.id, 'kim');
  assert.deepEqual(kim.litters.map((x) => x.litter.id), ['A', 'B']);
});

test('skipped is never spent: a family who matched nothing in A is first for B when B opens later', () => {
  const w = turnWorld();
  const Bclosed = { ...w.B, picks_opened_date: null };
  const offers = [
    offer({ id: 'o1', entry_id: 'kim', litter_id: 'A', turn_id: 't2', outcome: 'passed' }),
    offer({ id: 'o2', entry_id: 'ng', litter_id: 'A', turn_id: 't3', outcome: 'passed' }),
  ];
  // Lee (male only) was first for A anyway; make A female-only so Lee is skipped on A.
  const pups = w.pups.filter((d) => d.id !== 'a-m').concat(pup({ id: 'b-m', litter_id: 'B', sex: 'male' }));
  assert.equal(nextTurn(w.entries, offers, [w.A, Bclosed], pups, [], w.opts), null, 'A walked past Lee (no male) to the end');
  const t = nextTurn(w.entries, offers, [w.A, w.B], pups, [], w.opts);
  assert.equal(t.entry.id, 'lee', 'B opens: Lee, skipped on A, comes first');
  assert.deepEqual(t.litters.map((x) => x.litter.id), ['B']);
});

test('a litter opening mid-turn joins it only when the holder is the highest-ranked family it fits', () => {
  const w = turnWorld();
  const kimTurn = { id: 't2', entry_id: 'kim' };
  const held = [
    offer({ id: 'o0', entry_id: 'lee', litter_id: 'A', turn_id: 't1', outcome: 'passed' }),
    offer({ id: 'o1', entry_id: 'kim', litter_id: 'A', turn_id: 't2' }),
  ];
  // B fits Kim (anything) and Lee doesn't match B (no male): B joins Kim's turn.
  assert.deepEqual(joinsOpenTurn(kimTurn, w.B, w.entries, held, w.pups, [], { today: TODAY }).map((d) => d.id), ['b-f']);
  // With a male in B, Lee (ranked above Kim) fits it: B waits for the next turn.
  const pups = [...w.pups, pup({ id: 'b-m', litter_id: 'B', sex: 'male' })];
  assert.deepEqual(joinsOpenTurn(kimTurn, w.B, w.entries, held, pups, [], { today: TODAY }), []);
});

test('turn bookkeeping: ids, rows, open turns and overdue turns (one per turn)', () => {
  const rows = [
    offer({ id: 'o1', entry_id: 'kim', litter_id: 'A', turn_id: 't', respond_by_date: '2026-10-03' }),
    offer({ id: 'o2', entry_id: 'kim', litter_id: 'B', turn_id: 't', respond_by_date: '2026-10-03' }),
    offer({ id: 'legacy', entry_id: 'ng', litter_id: 'C', respond_by_date: '2026-10-09' }),
  ];
  assert.equal(turnIdOf(rows[2]), 'legacy', 'an offer from before turns is its own turn');
  assert.deepEqual(turnOffers(rows, 't').map((o) => o.id), ['o1', 'o2']);
  assert.deepEqual(openTurns(rows, K).map((t) => [t.id, t.offers.length]), [['t', 2], ['legacy', 1]]);
  assert.deepEqual(overdueTurns(rows, TODAY).map((t) => t.id), ['t']);
  const w = turnWorld();
  assert.deepEqual(turnLittersFor(w.entries[1], [offer({ entry_id: 'kim', litter_id: 'A', outcome: 'no_response' })], [w.A, w.B], w.pups, [], { today: TODAY })
    .map((x) => x.litter.id), ['B'], 'a turn already spent on A leaves only B');
});

test('canSwitchAcceptedPick: blocked once another family has been offered a turn anywhere in the kennel', () => {
  const acc = offer({ id: 'acc', litter_id: 'A', turn_id: 't1', outcome: 'accepted', chosen_dog_id: 'a-f', created_at: '2026-10-01T00:00:00Z' });
  const sibling = offer({ id: 'sib', litter_id: 'B', turn_id: 't1', outcome: 'voided', created_at: '2026-10-01T00:00:00Z' });
  assert.equal(canSwitchAcceptedPick(acc, [acc, sibling]), true);
  const later = offer({ id: 'later', litter_id: 'B', turn_id: 't2', outcome: 'open', created_at: '2026-10-02T00:00:00Z' });
  assert.equal(canSwitchAcceptedPick(acc, [acc, sibling, later]), false, 'a later turn on ANOTHER litter still blocks it');
});
