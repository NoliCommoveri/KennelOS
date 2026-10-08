// waitlistLostPup.test.js — a waitlist family's pup is lost (Waitlist Spec §16.11),
// through the real actions and repos on the in-memory database: a sale VOIDED (the
// pup died or failed a health check before going home) or RETURNED for a health
// problem puts the family back in line in their original place, with that litter
// theirs to be offered again; what they'd paid can be carried to their next pup's
// deposit; the next turn follows automatic offers ('restored'); a cancelled sale or
// a buyer's-choice return never restores anyone. Plus the Sale's end reason and the
// Health hold disposition.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let dogRepo; let litterRepo; let contactRepo; let saleRepo;
let waitlistEntryRepo; let waitlistOfferRepo; let actions; let rules; let income;
const DAY = '2026-10-08';
const LATER = '2026-10-20';

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
  income = await import('../shared/data/incomeView.js');
});

let K; let A;
const ids = {};

async function setup(config = {}) {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, waitlist_config: { max_passes: 2, respond_days: 3, ...config } });
  const dog = (call_name, sex, extra = {}) => dogRepo.create({ call_name, sex, breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id, ...extra });
  const ash = await dog('Ash', 'male');
  const jun = await dog('Juniper', 'female');
  A = await litterRepo.create({ dam_id: jun.id, sire_id: ash.id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-08-01', nickname: 'Litter A',
    expected_price_male: 2000, expected_deposit_male: 500, expected_price_female: 2000, expected_deposit_female: 500 });
  const pup = (name, sex) => dog(name, sex, { status: 'puppy', litter_id: A.id, disposition: 'available', date_of_birth: '2026-08-01' });
  ids.pip = (await pup('Pip', 'male')).id;
  ids.max = (await pup('Max', 'male')).id;
  ids.poppy = (await pup('Poppy', 'female')).id;
  const fam = async (name, fee, extra = {}) => {
    const c = await contactRepo.create({ name, email: `${name.toLowerCase()}@example.com` });
    return (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'active', approved_date: '2026-01-01', fee_received_date: fee, pref_sex: 'any', ...extra })).id;
  };
  ids.lee = await fam('Lee', '2026-01-01', { pref_sex: 'male' });
  ids.kim = await fam('Kim', '2026-01-02');
  ids.ng = await fam('Ng', '2026-01-03');
}

beforeEach(() => setup());

// Lee is offered Litter A, picks Pip and pays: placed. Returns Lee's sale.
async function placeLee() {
  const turn = await actions.openPicks(A.id, { date: DAY });
  assert.equal(turn.entry_id, ids.lee);
  const { sale } = await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.pip, date: DAY });
  await actions.confirmDeposit(turn.offers[0].id, { date: DAY });
  return saleRepo.getById(sale.id);
}

const position = async (entryId) => rules.overallPositions(await waitlistEntryRepo.getByKennel(K.id), K.id).get(entryId);

test('only a voided sale or a health return is a lost pup', () => {
  assert.equal(rules.restoresFamily({ status: 'voided' }), true);
  assert.equal(rules.restoresFamily({ status: 'returned', end_reason: 'health_problem' }), true);
  assert.equal(rules.restoresFamily({ status: 'returned', end_reason: 'buyer_choice' }), false);
  assert.equal(rules.restoresFamily({ status: 'returned' }), false);
  assert.equal(rules.restoresFamily({ status: 'cancelled' }), false, 'the buyer backed out');
  assert.equal(rules.restoresFamily({ status: 'deposit_paid' }), false);
  assert.equal(rules.restoresFamily({ status: 'voided', is_archived: true }), false);
});

test('a pup on Health hold is never offered', () => {
  const pup = { id: 'p', status: 'puppy', disposition: 'health_hold' };
  assert.equal(rules.isPupAvailable(pup, []), false);
  assert.equal(rules.isPupAvailable({ ...pup, disposition: 'available' }, []), true);
  assert.equal(rules.isPupAvailable({ ...pup, disposition: null, status: 'pet_home' }, []), false, 'gone home: a puppy again before it\'s offered');
  assert.equal(rules.isPupAvailable({ ...pup, disposition: null, status: 'external_reference' }, []), false);
});

test('the pup died after the deposit: the family is back in their original place, offered that litter again, and pays nothing twice', async () => {
  const sale = await placeLee();
  // Kim's turn is next; she takes Poppy, so Lee's original place is ahead of everyone left.
  const kimTurn = await actions.offerNext(A.id, { today: DAY });
  assert.equal(kimTurn.entry_id, ids.kim);
  await actions.recordOutcome(kimTurn.offers[0].id, 'accepted', { chosenDogId: ids.poppy, date: DAY });
  assert.equal((await waitlistEntryRepo.getById(ids.lee)).status, 'placed');

  // Pip dies before going home: she voids the sale and records the death.
  await saleRepo.update(sale.id, { status: 'voided', end_reason: 'pup_died' });
  await dogRepo.update(ids.pip, { status: 'deceased', date_of_death: LATER });
  assert.equal(await actions.lostSaleFamilyFor(sale.id).then((f) => f.kind), 'placed');

  const res = await actions.restoreAfterLostSale(sale.id, { date: LATER, carry: { amount: 500 } });
  const lee = await waitlistEntryRepo.getById(ids.lee);
  assert.equal(lee.status, 'active');
  assert.equal(lee.placed_sale_id, null);
  assert.equal(lee.fee_received_date, '2026-01-01', 'their own fee date: their original place');
  assert.deepEqual(lee.carried_payment, { amount: 500, date: LATER, from_sale_id: sale.id });
  assert.equal(await position(ids.lee), 1);
  assert.equal((await contactRepo.getById(lee.contact_id)).waitlist_status, 'active');

  const offers = await waitlistOfferRepo.getByEntry(ids.lee);
  assert.deepEqual(offers.map((o) => o.outcome), ['voided'], 'their accepted offer is voided');
  assert.equal(offers[0].counts_as_pass, false);
  assert.equal(offers[0].sale_id, sale.id, 'it still records the sale');
  assert.equal(rules.turnSpent(offers, A.id, ids.lee), false, 'so Litter A can be theirs again');
  assert.equal(rules.passesUsed(lee, offers), 0);

  // Automatic offers are off: nobody is offered, and Lee is who's next.
  assert.equal(res.next, null);
  assert.deepEqual(res.waiting, [{ entry_id: ids.lee, litter_ids: [A.id] }]);

  // Offered again: only Max is left for them (Pip is dead, Poppy is the Kims').
  const turn = await actions.offerNext(A.id, { today: LATER });
  assert.equal(turn.entry_id, ids.lee);
  assert.deepEqual(turn.offers[0].eligible_dog_ids, [ids.max]);
  const { sale: next } = await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.max, date: LATER });
  assert.equal(next.deposit_amount, 500, 'what they paid on Pip is their deposit on Max');
  await actions.confirmDeposit(turn.offers[0].id, { date: LATER });
  const placed = await waitlistEntryRepo.getById(ids.lee);
  assert.equal(placed.status, 'placed');
  assert.equal(placed.placed_sale_id, next.id);
  assert.equal(placed.carried_payment, null, 'used up');

  // The voided sale counts nothing; the deposit counts once, on Max's sale.
  const rows = await income.getIncomeRows();
  const sum = (id) => rows.filter((r) => r.source_id === id).reduce((n, r) => n + r.earned, 0);
  assert.equal(sum(sale.id), 0);
  assert.equal(sum(next.id), 500);
});

test('with automatic offers on for "restored", their turn comes now when nobody holds one', async () => {
  await setup({ auto_offer_on: ['restored'] });
  const sale = await placeLee();
  await saleRepo.update(sale.id, { status: 'voided', end_reason: 'failed_health_check' });
  await dogRepo.update(ids.pip, { disposition: 'health_hold' });
  const res = await actions.restoreAfterLostSale(sale.id, { date: LATER });
  assert.equal(res.next.entry_id, ids.lee);
  assert.deepEqual(res.next.offers[0].eligible_dog_ids, [ids.max], 'never the pup on Health hold');
  assert.equal((await waitlistEntryRepo.getById(ids.lee)).carried_payment ?? null, null, 'refunded: nothing carried');
});

test('another family holding the turn keeps it; the restored family is next after them', async () => {
  await setup({ auto_offer_on: ['restored'] });
  const sale = await placeLee();
  const kimTurn = await actions.offerNext(A.id, { today: DAY });
  await saleRepo.update(sale.id, { status: 'voided', end_reason: 'pup_died' });
  await dogRepo.update(ids.pip, { status: 'deceased', date_of_death: LATER });
  const res = await actions.restoreAfterLostSale(sale.id, { date: LATER });
  assert.equal(res.next, null, 'the Kims hold the turn');
  assert.equal((await waitlistOfferRepo.getById(kimTurn.offers[0].id)).outcome, 'open', 'their turn is untouched');
  const after = await actions.recordOutcome(kimTurn.offers[0].id, 'passed', { date: LATER });
  assert.equal(after.next, null, 'automatic offers are off for passes');
  assert.equal(after.waiting[0].entry_id, ids.lee);
});

test('a health return within the guarantee restores them; a buyer\'s-choice return or a cancelled sale does not', async () => {
  const sale = await placeLee();
  await saleRepo.update(sale.id, { status: 'delivered' });
  await saleRepo.update(sale.id, { status: 'returned', end_reason: 'buyer_choice' });
  assert.equal(await actions.lostSaleFamilyFor(sale.id), null);
  await assert.rejects(actions.restoreAfterLostSale(sale.id), /lost pup/);
  await saleRepo.update(sale.id, { status: 'cancelled' });
  assert.equal(await actions.lostSaleFamilyFor(sale.id), null);
  await saleRepo.update(sale.id, { status: 'returned', end_reason: 'health_problem' });
  assert.equal((await actions.lostSaleFamilyFor(sale.id)).kind, 'placed');
  // Paid in full and delivered before it came back: everything paid is offered to carry.
  const paid = income.paidOnSale({ ...sale, status: 'returned', balance_paid_date: DAY }, { asStatus: 'delivered' });
  assert.equal(paid, 2000);
});

test('the pup is lost while they\'re still choosing: their pick is cleared and the turn starts over, never with that pup', async () => {
  const turn = await actions.openPicks(A.id, { date: DAY });
  const { sale } = await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.pip, date: DAY });
  await saleRepo.update(sale.id, { status: 'voided', end_reason: 'failed_health_check' });
  assert.equal((await actions.lostSaleFamilyFor(sale.id)).kind, 'picked');
  const res = await actions.restoreAfterLostSale(sale.id, { date: LATER });
  const row = res.offers[0];
  assert.equal(row.outcome, 'open');
  assert.equal(row.chosen_dog_id, null);
  assert.equal(row.sale_id, null);
  assert.equal(row.respond_by_date, '2026-10-23', 'a fresh deadline');
  assert.deepEqual(row.eligible_dog_ids, [ids.max], 'Pip is left out even before she puts it on hold');
  // They pick again.
  await actions.recordPick(row.id, { chosenDogId: ids.max, date: LATER });
});

test('the lost pup was the only one for them: the turn ends (not a pass) and the list moves on', async () => {
  await dogRepo.update(ids.max, { disposition: 'keeping' });
  const turn = await actions.openPicks(A.id, { date: DAY });
  const { sale } = await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.pip, date: DAY });
  await saleRepo.update(sale.id, { status: 'voided', end_reason: 'pup_died' });
  await dogRepo.update(ids.pip, { status: 'deceased', date_of_death: LATER });
  const res = await actions.restoreAfterLostSale(sale.id, { date: LATER });
  assert.equal(res.offers.length, 0);
  assert.equal(res.voided[0].outcome, 'voided');
  assert.equal(res.voided[0].counts_as_pass, false);
  assert.equal(res.waiting[0].entry_id, ids.kim, 'Poppy goes to the Kims next');
  const lee = await waitlistEntryRepo.getById(ids.lee);
  assert.equal(lee.status, 'active');
  assert.equal(await position(ids.lee), 1, 'they keep their place');
});

test('a sale\'s end reason must fit its status, and leaves with it', async () => {
  const sale = await placeLee();
  await assert.rejects(saleRepo.update(sale.id, { status: 'voided', end_reason: 'buyer_choice' }), /isn't a reason for a voided sale/);
  const voided = await saleRepo.update(sale.id, { status: 'voided', end_reason: 'pup_died', end_note: 'parvo' });
  assert.equal(voided.end_reason, 'pup_died');
  const back = await saleRepo.update(sale.id, { status: 'deposit_paid' });
  assert.equal(back.end_reason, null, 'a sale back in progress carries no end reason');
  assert.equal(back.end_note, null);
  const ret = await saleRepo.update(sale.id, { status: 'returned' });
  assert.equal(ret.end_reason ?? null, null, 'the repo allows a return without one (the form asks)');
});
