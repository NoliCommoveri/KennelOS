// waitlistTurns.test.js — the offer flow as turns (Waitlist Spec §16.1, decided
// 2026-10-08), through the real actions and repos on the in-memory database: one
// family at a time across the kennel's open litters, every open litter they match
// in their turn, only a pass on all of it counting (once), picks switching between
// the litters of a turn, the deposit ending the turn, a litter joining a turn, and
// an undo giving the whole turn back.
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
});

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

test('opening picks on two litters: one turn, for the top family, covering every open litter they match', async () => {
  const t1 = await actions.openPicks(A.id, { date: DAY });
  assert.equal(t1.entry_id, ids.lee);
  assert.deepEqual(t1.litter_ids, [A.id]);
  // B opens during Lee's turn; Lee (male only) doesn't match B, and the Kims (ranked
  // below Lee) do, so B waits for the next turn instead of joining Lee's.
  assert.equal(await actions.openPicks(B.id, { date: DAY }), null);
  assert.equal((await openRows()).length, 1, 'still one family at a time');
  await assert.rejects(actions.offerTo(B.id, ids.kim), /holds the turn/);

  // Lee passes: the Kims' turn shows both litters at once.
  const res = await actions.recordOutcome(t1.offers[0].id, 'passed', { date: DAY });
  assert.equal(res.next, null, 'automatic offers are off');
  assert.deepEqual(res.waiting, [{ entry_id: ids.kim, litter_ids: [A.id, B.id].sort() }]);
  const kim = await actions.offerNext(A.id, { date: DAY });
  assert.equal(kim.entry_id, ids.kim);
  assert.deepEqual([...kim.litter_ids].sort(), [A.id, B.id].sort());
  assert.equal(new Set(kim.offers.map((o) => o.turn_id)).size, 1);
  assert.equal(new Set(kim.offers.map((o) => o.respond_by_date)).size, 1);
});

test('only passing on everything counts, and it counts once however many litters the turn had', async () => {
  await litterRepo.update(B.id, { picks_opened_date: DAY });
  const t = await actions.offerTo(A.id, ids.kim, { today: DAY, note: 'out of order' });
  assert.equal(t.offers.length, 2);
  const res = await actions.recordOutcome(t.offers[1].id, 'passed', { date: DAY });
  assert.deepEqual(res.passes, { used: 1, max: 2, counted: true });
  const rows = await waitlistOfferRepo.getByEntry(ids.kim);
  assert.deepEqual(rows.map((o) => o.outcome), ['passed', 'passed'], 'the whole turn closed');
  assert.equal(rows.filter((o) => o.counts_as_pass).length, 1);
  assert.equal(rules.turnSpent(rows, A.id, ids.kim) && rules.turnSpent(rows, B.id, ids.kim), true);
  // A litter opening later is a fresh chance for them.
  await litterRepo.update(C.id, { picks_opened_date: DAY });
  const c = await waitlistEntryRepo.getById(ids.lee);
  assert.ok(c, 'Lee is still there');
  const offers = await waitlistOfferRepo.getByKennel(K.id);
  assert.deepEqual(rules.turnLittersFor(await waitlistEntryRepo.getById(ids.kim), offers, [A, B, { ...C, picks_opened_date: DAY }],
    await dogRepo.getAll(), [], { today: DAY }).map((x) => x.litter.id), [C.id]);
});

test('a pick can move between the litters of a turn; the deposit ends the whole turn without a pass', async () => {
  await litterRepo.update(B.id, { picks_opened_date: DAY });
  const t = await actions.offerTo(A.id, ids.kim, { today: DAY });
  const rowA = t.offers.find((o) => o.litter_id === A.id);
  const rowB = t.offers.find((o) => o.litter_id === B.id);
  const { sale: s1 } = await actions.recordPick(rowA.id, { chosenDogId: ids.aFemale, date: DAY });
  const { sale: s2 } = await actions.recordPick(rowB.id, { chosenDogId: ids.bFemale, date: DAY });
  assert.equal((await saleRepo.getById(s1.id)).status, 'cancelled', 'their first pick was let go');
  assert.equal((await waitlistOfferRepo.getById(rowA.id)).chosen_dog_id, null);
  const res = await actions.confirmDeposit(rowB.id, { date: DAY });
  assert.equal((await saleRepo.getById(s2.id)).status, 'deposit_paid');
  assert.equal((await waitlistEntryRepo.getById(ids.kim)).status, 'placed');
  assert.equal((await waitlistOfferRepo.getById(rowA.id)).outcome, 'voided');
  assert.equal((await waitlistOfferRepo.getById(rowA.id)).counts_as_pass, false);
  assert.deepEqual(res.voided, [], 'the rest of the same turn closing is not reported as news');
  assert.equal(res.waiting[0].entry_id, ids.lee, 'next turn: the Lees, for litter A');
});

test('a litter opening mid-turn joins it when the holder is the top family for it, restarting the deadline', async () => {
  await litterRepo.update(C.id, { picks_opened_date: '2026-10-01' });
  const t = await actions.offerTo(C.id, ids.lee, { today: '2026-10-01' }); // Lee: male only; C has Rex
  assert.equal(t.offers[0].respond_by_date, '2026-10-04');
  const joined = await actions.openPicks(A.id, { date: DAY }); // A has Pip (male): Lee is the top family for it
  assert.equal(joined.joined, true);
  assert.deepEqual([...joined.litter_ids].sort(), [A.id, C.id].sort());
  const rows = await waitlistOfferRepo.getByEntry(ids.lee);
  assert.deepEqual([...new Set(rows.map((o) => o.respond_by_date))], ['2026-10-11'], 'one deadline for the turn, restarted');
});

test('no response and void close the whole turn; an undo gives the whole turn back', async () => {
  await litterRepo.update(B.id, { picks_opened_date: DAY });
  const t = await actions.offerTo(A.id, ids.kim, { today: DAY });
  await actions.recordOutcome(t.offers[0].id, 'no_response', { date: '2026-10-12' });
  assert.deepEqual((await waitlistOfferRepo.getByEntry(ids.kim)).map((o) => o.outcome), ['no_response', 'no_response']);
  const back = await actions.undoPass(t.offers[1].id, { today: '2026-10-13' });
  assert.equal(back.offers.length, 2, 'both litters reopen');
  assert.equal((await waitlistOfferRepo.getByEntry(ids.kim)).filter((o) => o.counts_as_pass).length, 0);
  await actions.recordOutcome(back.offer.id, 'voided', { date: '2026-10-13' });
  assert.deepEqual((await waitlistOfferRepo.getByEntry(ids.kim)).map((o) => o.outcome), ['voided', 'voided']);
  assert.equal((await openRows()).length, 0);
});

test('leaving the list with a turn open voids every litter of it and the kennel moves on', async () => {
  await litterRepo.update(B.id, { picks_opened_date: DAY });
  await actions.offerTo(A.id, ids.kim, { today: DAY });
  const res = await actions.withdraw(ids.kim, { date: DAY });
  assert.equal(res.voided.length, 2);
  assert.deepEqual(res.waiting.map((w) => w.entry_id), [ids.lee], 'one "who is next" for the kennel, not one per litter');
});

// --- "Not this litter" and pass reasons (Spec §16.2, §16.5) -------------------------

const reason = { id: 'finances', label: 'Financial reasons', text: '' };

test('"Not this litter" counts for nothing until the turn comes, and then the rest of the turn is offered', async () => {
  await actions.addPrepass(ids.kim, { litter_id: A.id, reason, date: DAY });
  await litterRepo.update(B.id, { picks_opened_date: DAY });
  const t = await actions.offerTo(B.id, ids.kim, { today: DAY });
  assert.deepEqual(t.litter_ids, [B.id], 'A is left out of the offer');
  await litterRepo.update(A.id, { picks_opened_date: DAY });
  const rows = await waitlistOfferRepo.getByEntry(ids.kim);
  const aRow = rows.find((o) => o.litter_id === A.id);
  assert.equal(aRow, undefined, 'A wasn\'t open when the turn was made: nothing recorded for it');
  assert.equal((await waitlistEntryRepo.getById(ids.kim)).prepasses.length, 1, 'still pending');
});

test('a turn made only of "Not this litter" litters is passed at once, counting once, and the list moves on', async () => {
  await actions.addPrepass(ids.lee, { litter_id: A.id, reason, date: DAY });
  const t = await actions.openPicks(A.id, { date: DAY }); // Lee (first) passed on A ahead of time
  assert.equal(t.entry_id, ids.kim, 'the turn went straight to the Kims');
  assert.deepEqual(t.auto_passed.map((x) => x.entry_id), [ids.lee]);
  const lee = await waitlistOfferRepo.getByEntry(ids.lee);
  assert.deepEqual(lee.map((o) => [o.outcome, o.counts_as_pass, o.pass_reason?.id]), [['passed', true, 'finances']]);
  const entry = await waitlistEntryRepo.getById(ids.lee);
  assert.deepEqual(entry.prepasses, [], 'used up');
  assert.match(entry.messages.at(-1).body, /recorded as a pass \(pass 1 of 2\)/);
});

test('a mixed turn: the "Not this litter" litter is recorded as passed (not counted), the rest is offered', async () => {
  await actions.addPrepass(ids.kim, { litter_id: A.id, reason, date: DAY });
  await litterRepo.update(B.id, { picks_opened_date: DAY });
  await litterRepo.update(A.id, { picks_opened_date: DAY });
  await actions.recordOutcome((await actions.offerTo(A.id, ids.lee, { today: DAY })).offers[0].id, 'passed', { date: DAY });
  const t = await actions.offerNext(A.id, { date: DAY });
  assert.equal(t.entry_id, ids.kim);
  assert.deepEqual(t.litter_ids, [B.id]);
  const rows = await waitlistOfferRepo.getByEntry(ids.kim);
  assert.deepEqual(rows.map((o) => [o.litter_id === A.id ? 'A' : 'B', o.outcome, Boolean(o.counts_as_pass)]).sort(), [['A', 'passed', false], ['B', 'open', false]]);
  assert.equal(new Set(rows.map((o) => o.turn_id)).size, 1, 'one turn');
  // Passing the rest on their status page, with a reason: the whole turn counts once.
  const res = await actions.recordOutcome(t.offers[0].id, 'passed', { date: DAY, passReason: { id: 'timing', label: 'The timing', text: '' } });
  assert.equal(res.passes.used, 1);
  assert.equal((await waitlistOfferRepo.getById(t.offers[0].id)).pass_reason.id, 'timing');
});

test('her own pass carries no reason; taking a "Not this litter" back leaves nothing behind', async () => {
  const t = await actions.offerTo(A.id, ids.lee, { today: DAY });
  await actions.recordOutcome(t.offers[0].id, 'passed', { date: DAY });
  assert.equal((await waitlistOfferRepo.getById(t.offers[0].id)).pass_reason, undefined);
  await actions.addPrepass(ids.kim, { litter_id: C.id, reason, date: DAY });
  await actions.removePrepass(ids.kim, { litter_id: C.id });
  assert.deepEqual((await waitlistEntryRepo.getById(ids.kim)).prepasses, []);
});

// Reported 2026-10-10: "Next turn" showed a family who had said "Not this litter" to
// every open litter, and "Offer to them" quietly passed them and moved on.
test('the next turn line says when the family said "Not this litter" to all of it, before she taps', async () => {
  const { nextTurnPrepassNote, nextTurn, waitlistConfig } = await import('../shared/data/waitlistRules.js');
  await actions.addPrepass(ids.lee, { litter_id: A.id, reason, date: DAY });
  await litterRepo.update(A.id, { picks_opened_date: DAY });
  const entries = await waitlistEntryRepo.getByKennel(K.id);
  const offers = await waitlistOfferRepo.getByKennel(K.id);
  const litters = await litterRepo.getAll();
  const dogs = await dogRepo.getAll();
  const config = waitlistConfig(await kennelRepo.getById(K.id));
  const n = nextTurn(entries, offers, litters, dogs, [], { today: DAY, config, programsById: new Map(), kennelId: K.id });
  assert.equal(n.entry.id, ids.lee);
  const note = nextTurnPrepassNote(n.entry, n.litters, { offers, config, litterOf: (l) => l.nickname });
  assert.match(note, /They said "Not this litter" to Litter A\. "Offer to them" records their turn as a pass \(pass 1 of 2\) and offers the next family\./);
});

test('passes recorded on the way are reported, even when nobody is left to offer', async () => {
  const { describeOfferChanges } = await import('../shared/data/waitlistRules.js');
  for (const id of [ids.lee, ids.kim, ids.ng]) await actions.addPrepass(id, { litter_id: A.id, reason, date: DAY });
  await litterRepo.update(A.id, { picks_opened_date: DAY });
  const r = await actions.offerNext(A.id, { today: DAY });
  assert.equal(r.none, true);
  assert.deepEqual(r.auto_passed.map((x) => x.entry_id), [ids.lee, ids.kim, ids.ng]);
  assert.deepEqual(r.auto_passed.map((x) => [x.counted, x.used, x.max]), [[true, 1, 2], [true, 1, 2], [true, 1, 2]]);
  const lines = describeOfferChanges({ auto_passed: r.auto_passed }, { nameOf: (id) => (id === ids.lee ? 'Lee' : 'other'), litterOf: () => 'A' });
  assert.equal(lines[0], 'Lee had said "Not this litter" to A, so their turn was recorded as a pass (pass 1 of 2) and the list moved on.');
  assert.equal(await actions.offerNext(A.id, { today: DAY }), null, 'nothing more happens');
});
