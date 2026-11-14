// waitlistEmptiedTurns.test.js — Waitlist fixes plan step 1 (K6-1, K6b-1..4, K6b-10):
// a turn left with no pup in it ends, never as a pass, and the turn moves on as her
// "left" setting says; a family leaving the list loses its pending side sale (a held
// pup goes back); a side-sale deposit can't place a family off the list; Tidy up
// asks "Placed?" only once the deposit is in; "Undo fee received" waits for no side
// sale; the server can't give a turn to a family with a side sale pending.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let dogRepo; let litterRepo; let contactRepo; let saleRepo;
let waitlistEntryRepo; let waitlistOfferRepo; let actions; let rules; let tidy; let events;
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
  tidy = await import('../shared/data/tidyRules.js');
  events = await import('../shared/data/waitlistEvents.js');
});

let K; let A; let B;
const ids = {};
const setAuto = (on) => kennelRepo.update(K.id, { waitlist_config: { ...K.waitlist_config, auto_offer_on: on } });
const allSales = () => saleRepo.getAll({ includeArchived: true });
const offersOf = (entryId) => waitlistOfferRepo.getByEntry(entryId);

// Litter A: Pip (male) and Poppy (female). Litter B: Willow (female, Keeping).
// Lee wants a male (only Pip fits); Kim and Park take either.
beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, waitlist_config: { max_passes: 2, respond_days: 3 } });
  const dog = (call_name, sex, extra = {}) => dogRepo.create({ call_name, sex, breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id, ...extra });
  const ash = await dog('Ash', 'male');
  const jun = await dog('Juniper', 'female');
  A = await litterRepo.create({ dam_id: jun.id, sire_id: ash.id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-08-01', nickname: 'Litter A' });
  B = await litterRepo.create({ dam_id: jun.id, sire_id: ash.id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-09-01', nickname: 'Litter B' });
  const pup = (name, sex, litter, extra = {}) => dog(name, sex, { status: 'puppy', litter_id: litter.id, disposition: 'available', intended_registration: 'limited', ...extra });
  ids.pip = (await pup('Pip', 'male', A)).id;
  ids.poppy = (await pup('Poppy', 'female', A)).id;
  ids.willow = (await pup('Willow', 'female', B, { disposition: 'keeping' })).id;
  const fam = async (name, fee, extra = {}) => {
    const c = await contactRepo.create({ name, email: `${name.toLowerCase()}@example.com` });
    return (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'active', approved_date: '2026-01-01', fee_received_date: fee, pref_sex: 'any', pref_purposes: ['pet'], ...extra })).id;
  };
  ids.lee = await fam('Lee', '2026-01-01', { pref_sex: 'male' });
  ids.kim = await fam('Kim', '2026-01-02');
  ids.park = await fam('Park', '2026-01-03');
});

// Lee's turn on Litter A, which lists only Pip.
async function leeHoldsPip() {
  const turn = await actions.openPicks(A.id, { date: DAY });
  assert.equal(turn.entry_id, ids.lee);
  assert.deepEqual(turn.offers[0].eligible_dog_ids, [ids.pip]);
  return turn;
}

// --- The rule ---------------------------------------------------------------------

test('turnIsEmpty: a pup still available, or a pick waiting on its deposit, keeps a turn', () => {
  const pups = [{ id: 'p1', litter_id: 'L' }, { id: 'p2', litter_id: 'L', disposition: 'keeping' }];
  const row = { outcome: 'open', litter_id: 'L', eligible_dog_ids: ['p1'] };
  const avail = (d) => ({ ...d, disposition: d.disposition || 'available' });
  assert.equal(rules.turnIsEmpty([row], pups.map(avail), []), false);
  assert.equal(rules.turnIsEmpty([{ ...row, eligible_dog_ids: ['p2'] }], pups.map(avail), []), true, 'its only pup is kept');
  assert.equal(rules.turnIsEmpty([{ ...row, eligible_dog_ids: ['p2'], chosen_dog_id: 'p2' }], pups.map(avail), []), false, 'a pick holds the turn');
  assert.equal(rules.turnIsEmpty([{ ...row, outcome: 'passed' }], pups.map(avail), []), false, 'a closed turn is not "emptied"');
  assert.equal(rules.turnIsEmpty([row], pups.map(avail), [{ id: 's', dog_id: 'p1', status: 'deposit_paid' }]), true, 'sold');
});

// --- K6-1: a pup leaves the available set ------------------------------------------

test('K6-1: the last pup kept ends the turn, never a pass; with "left" off, she is told who is next', async () => {
  const turn = await leeHoldsPip();
  await dogRepo.update(ids.pip, { disposition: 'keeping' });
  const r = await actions.endEmptiedTurns({ date: '2026-10-09' });
  assert.deepEqual(r.ended, [{ entry_id: ids.lee, turn_id: turn.id, litter_ids: [A.id] }]);
  const row = (await offersOf(ids.lee))[0];
  assert.equal(row.outcome, 'voided');
  assert.equal(row.counts_as_pass, false);
  assert.match(row.notes, /no pup was left in their turn\. Not a pass\./);
  assert.equal(rules.passesUsed({ id: ids.lee }, await offersOf(ids.lee)), 0);
  const lee = await waitlistEntryRepo.getById(ids.lee);
  assert.equal(lee.status, 'active', 'still on the list');
  assert.ok(lee.messages.some((m) => /Their turn ended: no pup was left in it/.test(m.body)));
  // Poppy is still there for Kim (either): nobody offered, Kim named.
  assert.equal(r.offered.length, 0);
  assert.equal(r.waiting[0].entry_id, ids.kim);
  // Nothing more to end.
  assert.equal((await actions.endEmptiedTurns({ date: '2026-10-09' })).ended.length, 0);
});

test('K6-1: with automatic offers on for "left", the next family that matches a pup gets the turn', async () => {
  await setAuto(['left']);
  await leeHoldsPip();
  await dogRepo.update(ids.pip, { disposition: 'health_hold' });
  const r = await actions.endEmptiedTurns({ date: '2026-10-09' });
  assert.equal(r.ended.length, 1);
  assert.equal(r.offered.length, 1);
  assert.equal(r.offered[0].entry_id, ids.kim);
  assert.deepEqual(r.offered[0].offers[0].eligible_dog_ids, [ids.poppy]);
});

test('K6-1: with every pup gone, nobody gets a turn', async () => {
  await setAuto(['left']);
  await leeHoldsPip();
  await dogRepo.update(ids.pip, { status: 'deceased', date_of_death: '2026-10-09' });
  await dogRepo.update(ids.poppy, { disposition: 'keeping' });
  const r = await actions.endEmptiedTurns({ date: '2026-10-09' });
  assert.equal(r.ended.length, 1);
  assert.equal(r.offered.length, 0);
  assert.equal(r.waiting.length, 0);
});

test('K6-1: a turn whose pup is still there, or picked and waiting on its deposit, is not ended', async () => {
  const turn = await leeHoldsPip();
  assert.equal((await actions.endEmptiedTurns({ date: DAY })).ended.length, 0, 'Pip is still available');
  await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.pip, date: DAY });
  assert.equal(rules.isPupAvailable(await dogRepo.getById(ids.pip), await allSales()), false, 'the pick\'s sale holds Pip');
  assert.equal((await actions.endEmptiedTurns({ date: DAY })).ended.length, 0, 'their pick holds the turn');
});

test('K6-1: a pass or no response recorded on an emptied turn is never counted', async () => {
  const turn = await leeHoldsPip();
  await dogRepo.update(ids.pip, { disposition: 'keeping' });
  const r = await actions.recordOutcome(turn.offers[0].id, 'no_response', { date: '2026-10-12' });
  assert.equal(r.passes.counted, false);
  assert.equal(r.passes.empty, true);
  assert.equal(r.passes.used, 0);
  const row = (await offersOf(ids.lee))[0];
  assert.equal(row.counts_as_pass, false);
  assert.match(row.notes, /Not counted as a pass: no pup was left in their turn/);
});

test('K6-1: a pass on a turn that still has its pup counts as before', async () => {
  const turn = await leeHoldsPip();
  const r = await actions.recordOutcome(turn.offers[0].id, 'passed', { date: '2026-10-09' });
  assert.equal(r.passes.counted, true);
});

test('K6-1: a sale made for the pup elsewhere (the Sale page) empties the turn too', async () => {
  await leeHoldsPip();
  const c = await contactRepo.create({ name: 'Walk-in' });
  await saleRepo.create({ dog_id: ids.pip, buyer_contact_id: c.id, registration_type: 'limited', status: 'deposit_pending', kennel_id: K.id, sale_date: DAY });
  assert.equal((await actions.endEmptiedTurns({ date: DAY })).ended.length, 1);
});

// --- K6b-2: a side sale's deposit empties another family's open turn ----------------

test('K6b-2: a side-sale deposit on the only pup of an open turn ends that turn (not a pass) and says so', async () => {
  const turn = await leeHoldsPip();
  const { sale } = await actions.recordSideSale(ids.park, { dogId: ids.pip, registration: 'limited', date: DAY });
  const res = await actions.confirmSideDeposit(sale.id, { date: DAY, amount: 300 });
  assert.deepEqual(res.ended, [{ entry_id: ids.lee, turn_id: turn.id, litter_ids: [A.id] }]);
  const row = await waitlistOfferRepo.getById(turn.offers[0].id);
  assert.equal(row.outcome, 'voided');
  assert.equal(row.counts_as_pass, false);
  assert.equal(res.waiting[0].entry_id, ids.kim, 'the turn moves on: Kim is next for Poppy');
  const lines = rules.describeOfferChanges(res, { nameOf: (id) => ({ [ids.lee]: 'Lee', [ids.kim]: 'Kim' })[id] || '?', litterOf: () => 'Litter A' });
  assert.ok(lines.some((l) => /Lee's turn ended because no pup was left in it\. Not a pass/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /Kim is next/.test(l)), lines.join('\n'));
});

test('a turn deposit: the family\'s own accepted turn is not reported as ended', async () => {
  const turn = await leeHoldsPip();
  await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.pip, date: DAY });
  const res = await actions.confirmDeposit(turn.offers[0].id, { date: DAY, amount: 300 });
  assert.equal(res.offer.outcome, 'accepted');
  assert.deepEqual(res.ended, []);
});

// --- K6b-1: leaving the list cancels a pending side sale ----------------------------

for (const [label, leave] of [
  ['withdraw', (id) => actions.withdraw(id, { date: DAY, byBreeder: true })],
  ['removeByBreeder', (id) => actions.removeByBreeder(id, { date: DAY })],
  ['archiveEntry', (id) => actions.archiveEntry(id, { date: DAY })],
  ['removeForNoReadyAnswer', (id) => actions.removeForNoReadyAnswer(id, { date: DAY })]
]) {
  test(`K6b-1: ${label} cancels their side sale and puts a held pup back`, async () => {
    const { sale } = await actions.recordSideSale(ids.park, { dogId: ids.willow, registration: 'limited', date: DAY });
    assert.equal(sale.side_holds_pup, true);
    const res = await leave(ids.park);
    assert.deepEqual(res.side_released, [{ entry_id: ids.park, sale_id: sale.id, restored: 'keeping' }]);
    assert.equal((await saleRepo.getById(sale.id)).status, 'cancelled');
    assert.equal((await dogRepo.getById(ids.willow)).disposition, 'keeping');
    const park = await waitlistEntryRepo.getById(ids.park);
    const line = park.messages.find((m) => m.id === `side-sale-cancel-${sale.id}`);
    assert.ok(line && !/keep their place/.test(line.body), 'no place kept: they left');
  });
}

test('K6b-1: leaving with an unheld side sale: cancelled, the pup still offered', async () => {
  const { sale } = await actions.recordSideSale(ids.park, { dogId: ids.poppy, registration: 'limited', date: DAY });
  const res = await actions.withdraw(ids.park, { date: DAY });
  assert.deepEqual(res.side_released, [{ entry_id: ids.park, sale_id: sale.id, restored: null }]);
  assert.equal((await saleRepo.getById(sale.id)).status, 'cancelled');
  assert.equal(rules.isPupAvailable(await dogRepo.getById(ids.poppy), await allSales()), true);
  const lines = rules.describeOfferChanges(res, { nameOf: () => 'Park', litterOf: () => 'Litter A' });
  assert.ok(lines.some((l) => /Park's side sale was cancelled, since they're no longer on the list\. The pup is free/.test(l)), lines.join('\n'));
});

test('K6b-1: a side-sale deposit is refused for a family no longer on the list', async () => {
  const { sale } = await actions.recordSideSale(ids.park, { dogId: ids.poppy, registration: 'limited', date: DAY });
  await waitlistEntryRepo.update(ids.park, { status: 'withdrawn', withdrawn_date: DAY }); // e.g. synced from another device
  await assert.rejects(actions.confirmSideDeposit(sale.id, { date: DAY }), /no longer on the list/);
  assert.equal((await waitlistEntryRepo.getById(ids.park)).status, 'withdrawn');
  assert.equal((await dogRepo.getById(ids.poppy)).disposition, 'available');
});

// --- K6b-3: Tidy up --------------------------------------------------------------------

test('K6b-3: Tidy up asks "Mark Placed?" only once the deposit is in', async () => {
  const { sale } = await actions.recordSideSale(ids.park, { dogId: ids.pip, registration: 'limited', date: DAY });
  assert.deepEqual(tidy.pupPlacedFindings(await dogRepo.getAll(), await allSales()), [], 'deposit pending: not asked');
  await saleRepo.update(sale.id, { status: 'deposit_paid', deposit_date: DAY }); // recorded on the Sale page
  const f = tidy.pupPlacedFindings(await dogRepo.getAll(), await allSales());
  assert.deepEqual(f.map((x) => x.dog.id), [ids.pip]);
  assert.equal(f[0].sale.id, sale.id);
});

// --- K6b-4: Undo fee received ----------------------------------------------------------

test('K6b-4: "Undo fee received" is not offered once they have a side sale', async () => {
  await waitlistEntryRepo.update(ids.park, { status: 'approved', fee_received_date: null });
  await actions.feeReceived(ids.park, { date: DAY });
  const today = new Date().toISOString().slice(0, 10);
  const park = await waitlistEntryRepo.getById(ids.park);
  assert.equal(rules.canUndoFeeReceived(park, [], today, await allSales()), true);
  await actions.recordSideSale(ids.park, { dogId: ids.pip, registration: 'limited', date: DAY });
  assert.equal(rules.canUndoFeeReceived(park, [], today, await allSales()), false);
  await assert.rejects(actions.undoFeeReceived(ids.park, { today }), /can no longer be marked not received/);
  assert.throws(() => rules.canUndoFeeReceived(park, [], today), /needs the sales/);
});

// --- K6b-10: server turns and side sales ----------------------------------------------

test('K6b-10: a turn the server gave a family with a pending side sale is not recorded', async () => {
  const { sale } = await actions.recordSideSale(ids.park, { dogId: ids.willow, registration: 'limited', date: DAY });
  await litterRepo.update(A.id, { picks_opened_date: DAY });
  const plan = events.planServerEvent(
    { kind: 'server_offer', createdAt: `${DAY}T12:00:00Z`, payload: { turn_id: 't1', respond_by_date: '2026-10-11', rows: [{ offer_id: 'o1', litter_id: A.id, dog_ids: [ids.pip] }] } },
    { entry: await waitlistEntryRepo.getById(ids.park), pups: await dogRepo.getAll(), sales: await allSales(), litters: new Map([[A.id, await litterRepo.getById(A.id)]]), pupName: () => 'Willow' });
  assert.equal(plan.op, 'note');
  assert.match(plan.activity.body, /side sale to them \(Willow, waiting on the deposit\)/);
  assert.equal(sale.status, 'deposit_pending');
});

test('K6b-10: a side-sale deposit that voids the family\'s own turn moves the turn on', async () => {
  await setAuto(['accepted']);
  const { sale } = await actions.recordSideSale(ids.park, { dogId: ids.willow, registration: 'limited', date: DAY });
  // A turn recorded before the refusal above existed (an older device applied it).
  await litterRepo.update(A.id, { picks_opened_date: DAY });
  await actions.applyServerOffer(ids.park, { turn_id: 'srv-t1', offered_date: DAY, respond_by_date: '2026-10-11', rows: [{ offer_id: 'srv-o1', litter_id: A.id, dog_ids: [ids.poppy] }] });
  const res = await actions.confirmSideDeposit(sale.id, { date: DAY, amount: 300 });
  assert.equal((await waitlistOfferRepo.getById('srv-o1')).outcome, 'voided');
  assert.ok(res.next, 'automatic offers on for "accepted": the next family has the turn');
  assert.equal(res.next.entry_id, ids.lee);
});

test('a side-sale deposit with no turn to end moves nothing on (as before)', async () => {
  await setAuto(['accepted', 'left']);
  const { sale } = await actions.recordSideSale(ids.park, { dogId: ids.willow, registration: 'limited', date: DAY });
  const res = await actions.confirmSideDeposit(sale.id, { date: DAY });
  assert.equal(res.next, null);
  assert.deepEqual(res.ended, []);
  assert.equal((await waitlistOfferRepo.getAll()).length, 0);
});

// --- The check after every change ------------------------------------------------------

test('watchEmptiedTurns ends an emptied turn after a data change, and waits while a dialog is open', async () => {
  await leeHoldsPip();
  const win = new EventTarget();
  let open = true;
  const told = [];
  const stop = actions.watchEmptiedTurns({ win, delay: 20, busy: () => open, onEnded: (r) => { told.push(r); } });
  await dogRepo.update(ids.pip, { disposition: 'keeping' });
  win.dispatchEvent(new Event('kennelos:datachanged'));
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(told.length, 0, 'a dialog is open: not yet');
  open = false;
  for (let i = 0; i < 50 && !told.length; i++) await new Promise((r) => setTimeout(r, 20));
  stop();
  assert.equal(told.length, 1);
  assert.equal(told[0].ended[0].entry_id, ids.lee);
  assert.equal((await offersOf(ids.lee))[0].outcome, 'voided');
});
