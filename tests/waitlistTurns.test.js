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
