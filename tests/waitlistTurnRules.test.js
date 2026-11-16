// waitlistTurnRules.test.js — Waitlist Fixes plan step 6, "one turn rule each"
// (K6-2, K6-4, K6-6, K6-7, K6-8, K6-11, K6-12, K6b-6): the out-of-turn guard asks
// the kennel-wide rule, the dialog and offerTo share one blocker, a joining litter
// never shortens a deadline, an extension lands on an open day, opening picks again
// keeps its first date, and an undone pass gives back only what it closed.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let dogRepo; let litterRepo; let contactRepo; let saleRepo;
let waitlistEntryRepo; let waitlistOfferRepo; let actions; let rules;
const DAY = '2026-10-08';

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ litterRepo } = await import('../shared/data/litterRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js'));
  ({ waitlistOfferRepo } = await import('../shared/data/waitlistOfferRepo.js'));
  actions = await import('../shared/data/waitlistActions.js');
  rules = await import('../shared/data/waitlistRules.js');
  ({ waitlistProgramRepo } = await import('../shared/data/waitlistProgramRepo.js'));
  preview = await import('../shared/data/picksPreview.js');
});
let waitlistProgramRepo; let preview;

let K; let A; let B; let C;
const ids = {};

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, waitlist_config: { max_passes: 2, respond_days: 3 } });
  const dog = (call_name, sex, extra = {}) => dogRepo.create({ call_name, sex, breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id, ...extra });
  const ash = await dog('Ash', 'male');
  const jun = await dog('Juniper', 'female');
  const wil = await dog('Willow', 'female');
  const mk = async (dam, label) => litterRepo.create({ dam_id: dam.id, sire_id: ash.id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-08-01', nickname: label });
  A = await mk(jun, 'Litter A');
  B = await mk(wil, 'Litter B');
  C = await mk(jun, 'Litter C');
  const pup = (name, sex, litter) => dog(name, sex, { status: 'puppy', litter_id: litter.id, disposition: 'available' });
  ids.aMale = (await pup('Pip', 'male', A)).id;
  ids.aFemale = (await pup('Poppy', 'female', A)).id;
  ids.bFemale = (await pup('Pearl', 'female', B)).id;
  ids.cMale = (await pup('Rex', 'male', C)).id;
  const fam = async (name, fee, extra = {}) => {
    const c = await contactRepo.create({ name, email: `${name.toLowerCase()}@example.com` });
    return (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'active', approved_date: '2026-01-01', fee_received_date: fee, pref_sex: 'any', ...extra })).id;
  };
  ids.lee = await fam('Lee', '2026-01-01', { pref_sex: 'male' });
  ids.kim = await fam('Kim', '2026-01-02');
  ids.ng = await fam('Ng', '2026-01-03', { pref_sex: 'female' });
});

const openRows = async () => (await waitlistOfferRepo.getByKennel(K.id)).filter((o) => o.outcome === 'open');
const fam2 = async (name, fee, extra = {}) => {
  const c = await contactRepo.create({ name, email: `${name.toLowerCase()}@example.com` });
  return (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'active', approved_date: '2025-01-01', fee_received_date: fee, pref_sex: 'any', ...extra })).id;
};

// --- K6-6: the out-of-turn guard ------------------------------------------------------

test('K6-6: offerTo refuses a family the kennel-wide rule doesn\'t name, unless told it\'s out of order', async () => {
  // The Oxleys (female only) are first in line; picks are open on B (a female).
  // Litter C (one male, picks not open) has the Lees first in its own queue, but a
  // turn offered now belongs to the Oxleys.
  ids.ox = await fam2('Oxley', '2025-12-01', { pref_sex: 'female' });
  await litterRepo.update(B.id, { picks_opened_date: DAY });
  const lee = await waitlistEntryRepo.getById(ids.lee);
  const kc = { offers: [], litters: [A, { ...B, picks_opened_date: DAY }, C], pups: await dogRepo.getAll(), sales: [] };
  assert.equal(rules.nextFamilyForLitter(await waitlistEntryRepo.getByKennel(K.id), [], C, kc.pups, [], { today: DAY }).entry.id, ids.lee,
    'the litter\'s own queue names the Lees');
  const next = rules.nextOfferedTurn(await waitlistEntryRepo.getByKennel(K.id), [], kc.litters, kc.pups, [], { today: DAY, kennelId: K.id, opening: C });
  assert.equal(next.entry.id, ids.ox, 'the kennel-wide rule names the Oxleys');
  await assert.rejects(actions.offerTo(C.id, lee.id, { today: DAY }), (err) => err.code === 'out_of_turn' && err.nextEntry.id === ids.ox);
  assert.equal((await openRows()).length, 0, 'nothing written');
  assert.equal((await litterRepo.getById(C.id)).picks_opened_date ?? null, null, 'picks not opened by a refused offer');
  const t = await actions.offerTo(C.id, lee.id, { today: DAY, outOfOrder: true });
  assert.match(t.offers[0].notes, /Oxley was next in line/, 'the note can\'t be lost');
});

test('K6-6: the family the rule names is offered without a confirm and with no note', async () => {
  await litterRepo.update(A.id, { picks_opened_date: DAY });
  const t = await actions.offerTo(A.id, ids.lee, { today: DAY });
  assert.equal(t.entry_id, ids.lee);
  assert.equal(t.offers[0].notes, '');
});

test('K6-6: a family whose whole turn is "Not this litter" isn\'t who the guard names', async () => {
  await litterRepo.update(A.id, { picks_opened_date: DAY });
  await waitlistEntryRepo.update(ids.lee, { prepasses: [{ litter_id: A.id, date: DAY }] });
  const entries = await waitlistEntryRepo.getByKennel(K.id);
  const next = rules.nextOfferedTurn(entries, [], [{ ...A, picks_opened_date: DAY }, B, C], await dogRepo.getAll(), [], { today: DAY, kennelId: K.id });
  assert.equal(next.entry.id, ids.kim);
  const t = await actions.offerTo(A.id, ids.kim, { today: DAY });
  assert.equal(t.entry_id, ids.kim);
});

// --- K6-7: one blocker for the dialog and the action ----------------------------------

test('K6-7: offerBlocker gives the real reason: "Not this litter", a side sale, a held turn', async () => {
  const pups = await dogRepo.getAll();
  const opts = (offers = [], sales = []) => ({ offers, pups, sales, today: DAY, nameOf: () => 'The Kims' });
  await waitlistEntryRepo.update(ids.lee, { prepasses: [{ litter_id: A.id, date: DAY }] });
  const lee = await waitlistEntryRepo.getById(ids.lee);
  assert.match(rules.offerBlocker(lee, A, opts()), /Not this litter/);
  await assert.rejects(actions.offerTo(A.id, ids.lee, { today: DAY, outOfOrder: true }), /Not this litter/);
  const kim = await waitlistEntryRepo.getById(ids.kim);
  const side = { id: 's1', side_entry_id: ids.kim, dog_id: ids.aFemale, status: 'deposit_pending' };
  assert.match(rules.offerBlocker(kim, A, opts([], [side])), /side sale/);
  const held = [{ id: 'o1', entry_id: ids.ng, litter_id: B.id, kennel_id: K.id, outcome: 'open' }];
  assert.equal(rules.offerBlocker(kim, A, opts(held)), 'The Kims holds the turn now; one family at a time.');
  assert.equal(rules.offerBlocker(kim, A, opts()), '');
});

// --- K6-2 and K6-8: deadlines ---------------------------------------------------------

test('K6-2: a litter joining an extended turn keeps the later deadline', async () => {
  const t = await actions.openPicks(A.id, { date: DAY });
  assert.equal(t.entry_id, ids.lee);
  await actions.extendTurn(t.id, { until: '2026-10-25', date: DAY });
  const joined = await actions.openPicks(C.id, { date: '2026-10-09' });
  assert.equal(joined.joined, true);
  assert.equal(joined.respond_by_date, '2026-10-25');
  assert.deepEqual((await openRows()).map((o) => o.respond_by_date), ['2026-10-25', '2026-10-25'], 'every row of the turn agrees');
});

test('K6-2: a join that lengthens the turn still restarts it', async () => {
  const t = await actions.openPicks(A.id, { date: DAY });
  assert.equal(t.respond_by_date, '2026-10-11');
  const joined = await actions.openPicks(C.id, { date: '2026-10-10' });
  assert.equal(joined.respond_by_date, '2026-10-13');
});

test('K6-8: an extension onto a closed day moves to her next open day, and says so', async () => {
  // Monday to Friday, closed on Monday 2026-10-26.
  await kennelRepo.update(K.id, { waitlist_config: { max_passes: 2, respond_days: 3, open_days: [1, 2, 3, 4, 5], closed_dates: ['2026-10-26'] } });
  const t = await actions.openPicks(A.id, { date: DAY });
  const sunday = await actions.extendTurn(t.id, { until: '2026-10-25', date: DAY });
  assert.equal(sunday.respond_by_date, '2026-10-27', 'Sunday, then her closed Monday, lands on Tuesday');
  assert.equal(sunday.moved_from, '2026-10-25');
  const friday = await actions.extendTurn(t.id, { until: '2026-10-30', date: DAY });
  assert.equal(friday.respond_by_date, '2026-10-30');
  assert.equal(friday.moved_from, null);
  assert.equal(rules.onOpenDay('2026-10-24', { open_days: [1, 2, 3, 4, 5] }), '2026-10-26');
});

// --- K6-11 ------------------------------------------------------------------------------

test('K6-11: opening picks again keeps the first opened date; closing clears it', async () => {
  await actions.openPicks(A.id, { date: DAY });
  await actions.openPicks(A.id, { date: '2026-11-01' });
  assert.equal((await litterRepo.getById(A.id)).picks_opened_date, DAY);
  await actions.closePicks(A.id);
  await actions.openPicks(A.id, { date: '2026-11-02' });
  assert.equal((await litterRepo.getById(A.id)).picks_opened_date, '2026-11-02');
});

// --- K6-12: one helper each --------------------------------------------------------------

test('K6-12: one turn deadline, one "is overdue", one "holds the turn"', () => {
  const rows = [
    { id: 'a', turn_id: 't', entry_id: 'e1', kennel_id: 'k', outcome: 'open', respond_by_date: '2026-10-05' },
    { id: 'b', turn_id: 't', entry_id: 'e1', kennel_id: 'k', outcome: 'open', respond_by_date: '2026-10-07' }
  ];
  assert.equal(rules.turnRespondBy(rows), '2026-10-07');
  assert.equal(rules.turnRespondBy([]), null);
  const [turn] = rules.openTurns(rows, 'k');
  assert.equal(rules.isTurnOverdue(turn, '2026-10-07'), false, 'the day itself is on time');
  assert.equal(rules.isTurnOverdue(turn, '2026-10-08'), true);
  assert.equal(rules.holdsTurn(rows, 'e1'), true);
  assert.equal(rules.holdsTurn(rows, 'e2'), false);
  assert.equal(rules.holdsTurn(rows.map((o) => ({ ...o, outcome: 'passed' })), 'e1'), false);
  assert.equal('overdueOffers' in rules, false, 'the dead copy is gone');
});

// --- K6-4: undoing a pass gives back only what it closed ------------------------------

test('K6-4: undoing a pass leaves a "Not this litter" litter closed', async () => {
  // The Kims said "Not this litter" to B; A and B both open; their turn is A only.
  await waitlistEntryRepo.update(ids.kim, { prepasses: [{ litter_id: B.id, date: '2026-10-01' }] });
  await litterRepo.update(B.id, { picks_opened_date: DAY });
  const t = await actions.offerTo(A.id, ids.kim, { today: DAY, outOfOrder: true });
  assert.deepEqual(t.litter_ids, [A.id]);
  const rowA = t.offers[0];
  await actions.recordOutcome(rowA.id, 'passed', { date: DAY });
  const back = await actions.undoPass(rowA.id, { today: DAY });
  assert.deepEqual(back.offers.map((o) => o.litter_id), [A.id], 'only A is back');
  const rows = await waitlistOfferRepo.getByEntry(ids.kim);
  assert.equal(rows.find((o) => o.litter_id === B.id).outcome, 'passed', 'B stays as they asked');
  assert.equal(rows.find((o) => o.litter_id === A.id).outcome, 'open');
});

test('K6-4: a turn passed in full ahead of time has no turn to give back', async () => {
  await waitlistEntryRepo.update(ids.lee, { prepasses: [{ litter_id: A.id, date: '2026-10-01' }] });
  const res = await actions.openPicks(A.id, { date: DAY });
  assert.equal(res.entry_id, ids.kim, 'the Lees were passed on the way');
  const leeRow = (await waitlistOfferRepo.getByEntry(ids.lee))[0];
  await assert.rejects(actions.undoPass(leeRow.id, { today: DAY }), /no turn to give back/);
});

// --- K6b-6: the preview's "next in line" is what will happen ---------------------------

async function previewData() {
  const [kennel, entries, offers, litters, dogs, sales, programsById, contacts] = await Promise.all([
    kennelRepo.getById(K.id), waitlistEntryRepo.getByKennel(K.id), waitlistOfferRepo.getByKennel(K.id),
    litterRepo.getAll({ includeArchived: true }), dogRepo.getAll({ includeArchived: true }),
    saleRepo.getAll({ includeArchived: true }), waitlistProgramRepo.getMapForKennel(K.id), contactRepo.getAll({ includeArchived: true })
  ]);
  return { kennel, entries, offers, litters, dogs, sales, programsById, contacts };
}

test('K6b-6: who\'s next after the holder doesn\'t change with the Either switch or the view, and skips a full "Not this litter"', async () => {
  const t = await actions.openPicks(A.id, { date: DAY });
  assert.equal(t.entry_id, ids.lee);
  // The Ngs said "Not this litter" to both A and B: their turn would pass at once.
  await waitlistEntryRepo.update(ids.ng, { prepasses: [{ litter_id: A.id, date: DAY }, { litter_id: B.id, date: DAY }] });
  const data = await previewData();
  const runs = [
    preview.previewPicks(data, { litterId: B.id, today: DAY }),
    preview.previewPicks(data, { litterId: B.id, today: DAY, eitherAs: 'male' }),
    preview.previewPicks(data, { litterId: B.id, today: DAY, view: 'alone' })
  ];
  for (const p of runs) {
    assert.equal(p.action.kind, 'wait');
    assert.deepEqual(p.action.next_after, [{ entry_id: ids.kim, litter_ids: [A.id, B.id].sort() }]);
  }
  assert.equal(runs[0].positions[ids.kim], 2);
});

// --- Notes: an undated family, and "Place them with…" -----------------------------------

test('an active family with no date sorts last in its group, never #1', () => {
  const a = { id: 'a', kennel_id: 'k', status: 'active', fee_received_date: '2026-01-01' };
  const none = { id: 'z', kennel_id: 'k', status: 'active' };
  assert.deepEqual(rules.rankedList([none, a], 'k').map((e) => e.id), ['a', 'z']);
});

test('"Place them with" a family with no date refuses instead of clearing the override', async () => {
  await waitlistEntryRepo.update(ids.kim, { position_anchor_date: '2026-03-01' });
  const undated = await fam2('Undated', null, { approved_date: null });
  await assert.rejects(actions.setPositionAnchor(ids.kim, { afterEntryId: undated }), /no date in line/);
  assert.equal((await waitlistEntryRepo.getById(ids.kim)).position_anchor_date, '2026-03-01');
});
