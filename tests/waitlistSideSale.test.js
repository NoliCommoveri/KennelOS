// waitlistSideSale.test.js — side sales (Side Sale Spec) through the real actions on
// the in-memory database: never a turn, the pup still offered until the deposit
// unless it was pulled from Undecided / Keeping / Health hold (then held, and put
// back on cancel), the family not offered turns meanwhile, the deposit placing them
// without moving any turn on, and two claims on one pup resolved when one deposit
// arrives.
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

let K; let A; let B;
const ids = {};

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, waitlist_config: { max_passes: 2, respond_days: 3 } });
  const dog = (call_name, sex, extra = {}) => dogRepo.create({ call_name, sex, breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id, ...extra });
  const ash = await dog('Ash', 'male');
  const jun = await dog('Juniper', 'female');
  A = await litterRepo.create({ dam_id: jun.id, sire_id: ash.id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-08-01', nickname: 'Litter A' });
  B = await litterRepo.create({ dam_id: jun.id, sire_id: ash.id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-09-01', nickname: 'Litter B' });
  const pup = (name, sex, litter, extra = {}) => dog(name, sex, { status: 'puppy', litter_id: litter.id, disposition: 'available', intended_registration: 'limited', ...extra });
  ids.willow = (await pup('Willow', 'female', A)).id;
  ids.pip = (await pup('Pip', 'male', A)).id;
  ids.held = (await pup('Hazel', 'female', A, { disposition: 'health_hold' })).id;
  ids.bPup = (await pup('Bea', 'female', B)).id;
  const fam = async (name, fee, extra = {}) => {
    const c = await contactRepo.create({ name, email: `${name.toLowerCase()}@example.com` });
    return (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'active', approved_date: '2026-01-01', fee_received_date: fee, pref_sex: 'any', pref_purposes: ['pet'], ...extra })).id;
  };
  ids.lee = await fam('Lee', '2026-01-01');
  ids.kim = await fam('Kim', '2026-01-02');
  ids.ng = await fam('Ng', '2026-01-03', { pref_sex: 'male' });
});

const allSales = () => saleRepo.getAll({ includeArchived: true });

test('a side sale on an Available pup: a deposit-pending sale, no offer row, the pup still offered', async () => {
  const { sale, issues } = await actions.recordSideSale(ids.ng, { dogId: ids.willow, registration: 'limited', date: DAY });
  assert.equal(sale.status, 'deposit_pending');
  assert.equal(sale.side_entry_id, ids.ng);
  assert.equal(sale.side_holds_pup, false);
  assert.equal(sale.side_deposit_due, '2026-10-11');
  assert.deepEqual(issues.fields, ['sex'], 'Ng asked for a male');
  assert.equal((await waitlistOfferRepo.getAll()).length, 0, 'never a turn');
  const willow = await dogRepo.getById(ids.willow);
  assert.equal(rules.isPupAvailable(willow, await allSales()), true, 'still offered until the deposit');
  // Opening picks: the top family still gets a turn listing Willow.
  const turn = await actions.openPicks(A.id, { date: DAY });
  assert.equal(turn.entry_id, ids.lee);
  assert.ok(turn.offers[0].eligible_dog_ids.includes(ids.willow));
});

test('a family with a pending side sale is not offered turns meanwhile; a cancel gives them back their place', async () => {
  const { sale } = await actions.recordSideSale(ids.lee, { dogId: ids.bPup, registration: 'limited', date: DAY });
  const turn = await actions.openPicks(A.id, { date: DAY });
  assert.equal(turn.entry_id, ids.kim, 'Lee is skipped while buying');
  await actions.recordOutcome(turn.offers[0].id, 'voided', { date: DAY });
  await actions.cancelSideSale(sale.id, { date: DAY });
  assert.equal((await saleRepo.getById(sale.id)).status, 'cancelled');
  const next = await actions.offerNext(A.id, { date: DAY });
  assert.equal(next.entry_id, ids.lee, 'back at the top, never a pass');
  const offers = await waitlistOfferRepo.getByEntry(ids.lee);
  assert.equal(rules.passesUsed({ id: ids.lee }, offers), 0);
});

test('a pup pulled from Health hold is Available, held for the family, and goes back on cancel', async () => {
  const { sale } = await actions.recordSideSale(ids.kim, { dogId: ids.held, registration: 'limited', date: DAY });
  assert.equal(sale.side_holds_pup, true);
  assert.equal(sale.side_prior_disposition, 'health_hold');
  const hazel = await dogRepo.getById(ids.held);
  assert.equal(hazel.disposition, 'available');
  assert.equal(rules.isPupAvailable(hazel, await allSales()), false, 'held for Kim');
  const r = await actions.cancelSideSale(sale.id, { date: DAY });
  assert.equal(r.restored, 'health_hold');
  assert.equal((await dogRepo.getById(ids.held)).disposition, 'health_hold');
});

test('the deposit places the family and the pup; no turn moves on', async () => {
  const { sale } = await actions.recordSideSale(ids.kim, { dogId: ids.willow, registration: 'full', updateRegistration: true, date: DAY });
  assert.equal((await dogRepo.getById(ids.willow)).intended_registration, 'full');
  assert.equal(sale.registration_type, 'full');
  const res = await actions.confirmSideDeposit(sale.id, { date: DAY, amount: 500 });
  assert.equal(res.sale.status, 'deposit_paid');
  assert.equal(res.sale.deposit_amount, 500);
  assert.equal((await dogRepo.getById(ids.willow)).disposition, 'placed');
  const kim = await waitlistEntryRepo.getById(ids.kim);
  assert.equal(kim.status, 'placed');
  assert.equal(kim.placed_sale_id, sale.id);
  assert.equal((await waitlistOfferRepo.getAll()).length, 0);
});

test('"Also update their answers to match" writes only what ruled the pup out, logged as hers', async () => {
  await actions.recordSideSale(ids.ng, { dogId: ids.willow, registration: 'limited', updateAnswers: true, date: DAY });
  const ng = await waitlistEntryRepo.getById(ids.ng);
  assert.equal(ng.pref_sex, 'female');
  assert.deepEqual(ng.pref_purposes, ['pet']);
  assert.equal(ng.pref_change_log.at(-1).field, 'pref_sex');
  assert.equal(ng.pref_change_log.at(-1).by, 'breeder');
});

test('refused: the family holds the turn, a second pending side sale, a placed pup, not on the list', async () => {
  const turn = await actions.openPicks(A.id, { date: DAY });
  await assert.rejects(actions.recordSideSale(turn.entry_id, { dogId: ids.bPup, registration: 'limited', date: DAY }), /hold the turn/);
  await actions.recordSideSale(ids.kim, { dogId: ids.bPup, registration: 'limited', date: DAY });
  await assert.rejects(actions.recordSideSale(ids.kim, { dogId: ids.pip, registration: 'limited', date: DAY }), /already have a side sale/);
  await dogRepo.update(ids.pip, { disposition: 'placed' });
  await assert.rejects(actions.recordSideSale(ids.ng, { dogId: ids.pip, registration: 'limited', date: DAY }), /already placed/);
  await waitlistEntryRepo.update(ids.ng, { status: 'withdrawn' });
  await assert.rejects(actions.recordSideSale(ids.ng, { dogId: ids.willow, registration: 'limited', date: DAY }), /on the list/);
});

test('two claims: the turn family picks the side-sale pup; the side deposit arriving first lets their pick go', async () => {
  const { sale } = await actions.recordSideSale(ids.ng, { dogId: ids.willow, registration: 'limited', date: DAY });
  const turn = await actions.openPicks(A.id, { date: DAY }); // Lee
  const row = turn.offers[0];
  await actions.recordPick(row.id, { chosenDogId: ids.willow, date: DAY });
  const claims = rules.pupClaims(ids.willow, { sales: await allSales(), offers: await waitlistOfferRepo.getAll() });
  assert.deepEqual(claims.map((c) => c.kind).sort(), ['pick', 'side']);
  const res = await actions.confirmSideDeposit(sale.id, { date: DAY });
  assert.deepEqual(res.resolved.map((r) => [r.kind, r.entry_id, r.voided]), [['pick_released', ids.lee, false]]);
  const lee = await waitlistOfferRepo.getById(row.id);
  assert.equal(lee.outcome, 'open', 'their turn stays open on the pups left (Pip)');
  assert.equal(lee.chosen_dog_id, null);
  const leeSales = (await allSales()).filter((s) => s.buyer_contact_id !== res.sale.buyer_contact_id && s.dog_id === ids.willow);
  assert.equal(leeSales[0].status, 'cancelled');
});

test('two claims: the turn deposit arriving first cancels the side sale; that family keeps their place', async () => {
  const { sale } = await actions.recordSideSale(ids.ng, { dogId: ids.willow, registration: 'limited', date: DAY });
  const turn = await actions.openPicks(A.id, { date: DAY });
  await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.willow, date: DAY });
  const res = await actions.confirmDeposit(turn.offers[0].id, { date: DAY });
  assert.deepEqual(res.resolved.map((r) => [r.kind, r.entry_id]), [['side_cancelled', ids.ng]]);
  assert.equal((await saleRepo.getById(sale.id)).status, 'cancelled');
  assert.equal((await waitlistEntryRepo.getById(ids.ng)).status, 'active');
});

test('a released pick with no pup left ends their turn without a pass', async () => {
  await dogRepo.update(ids.pip, { disposition: 'keeping' });
  await dogRepo.update(ids.held, { disposition: 'keeping' });
  const { sale } = await actions.recordSideSale(ids.ng, { dogId: ids.willow, registration: 'limited', date: DAY });
  const turn = await actions.openPicks(A.id, { date: DAY }); // Lee: Willow only
  await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.willow, date: DAY });
  const res = await actions.confirmSideDeposit(sale.id, { date: DAY });
  assert.equal(res.resolved[0].voided, true);
  const row = await waitlistOfferRepo.getById(turn.offers[0].id);
  assert.equal(row.outcome, 'voided');
  assert.equal(row.counts_as_pass, false);
});

test('sideSaleBlocker: placed, deceased, gone home, outside, archived; anything else is allowed', () => {
  const d = (x) => ({ call_name: 'Pup', status: 'puppy', disposition: 'available', ...x });
  assert.match(rules.sideSaleBlocker(d({ disposition: 'placed' })), /placed/);
  assert.match(rules.sideSaleBlocker(d({ status: 'deceased' })), /deceased/);
  assert.match(rules.sideSaleBlocker(d({ status: 'pet_home' })), /gone home/);
  assert.match(rules.sideSaleBlocker(d({ status: 'external_reference' })), /outside/);
  assert.match(rules.sideSaleBlocker(d({ is_archived: true })), /archived/);
  for (const disposition of ['undecided', 'keeping', 'health_hold', 'available']) assert.equal(rules.sideSaleBlocker(d({ disposition })), '');
});

test('the family page reads it as a turn with a pick: same row shape, their number hidden, the server marker only', async () => {
  const { buildProjection } = await import('../shared/data/waitlistProjection.js');
  const { sale } = await actions.recordSideSale(ids.ng, { dogId: ids.willow, registration: 'limited', date: DAY });
  const p = buildProjection({
    kennel: await kennelRepo.getById(K.id), entries: await waitlistEntryRepo.getByKennel(K.id), offers: [],
    litters: await litterRepo.getAll(), dogs: await dogRepo.getAll(), sales: await allSales(), contacts: await contactRepo.getAll(), today: DAY
  });
  const ng = p.entries[ids.ng];
  assert.equal(ng.offers.length, 1);
  assert.deepEqual({ ...ng.offers[0], picked_pup: undefined, deposit_amount: undefined, deposit_instructions: undefined }, {
    id: sale.id, turn_id: sale.id, litter_id: A.id, offered_date: DAY, respond_by_date: '2026-10-11',
    eligible_dog_ids: [ids.willow], picked_dog_id: ids.willow, direct: true,
    picked_pup: undefined, deposit_amount: undefined, deposit_instructions: undefined
  });
  assert.equal(ng.offers[0].picked_pup.call_name, 'Willow');
  assert.deepEqual(ng.place_hidden, { reason: 'turn' });
  assert.equal(p.turn_queue.some((q) => q.entry_id === ids.ng), false, 'not offered turns meanwhile');
  assert.ok(p.litters[A.id].pups.some((d) => d.id === ids.willow), 'Willow still shows as available');
  assert.equal(p.litters[A.id].open_offer_entry_id ?? null, null, 'never the litter\'s open offer');
});
