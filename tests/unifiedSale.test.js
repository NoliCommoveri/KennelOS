// unifiedSale.test.js — what every sale does, whoever's buying (Unified Sale plan
// Phase 1, §2.2): the checks (saleChecks), a pending sale holding its pup (U8), a
// pulled pup put back on cancel (pendingSale), every other claim ended when a deposit
// is recorded on the Sale page (waitlistActions.settleOtherClaims), the deposit due
// date on any sale (its sync class, the statement, Today's overdue flag), and an
// older backup's sale with no deposit_due_date.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let dogRepo; let litterRepo; let contactRepo; let saleRepo;
let waitlistEntryRepo; let waitlistOfferRepo; let actions; let rules; let checks; let pending; let nudges;
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
  checks = await import('../shared/data/saleChecks.js');
  pending = await import('../shared/data/pendingSale.js');
  nudges = await import('../shared/data/nudges.js');
});

let K; let A;
const ids = {};

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, waitlist_config: { max_passes: 2, respond_days: 3 } });
  const dog = (call_name, sex, extra = {}) => dogRepo.create({ call_name, sex, breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id, ...extra });
  const ash = await dog('Ash', 'male');
  const jun = await dog('Juniper', 'female');
  A = await litterRepo.create({ dam_id: jun.id, sire_id: ash.id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-08-01', nickname: 'Litter A' });
  const pup = (name, sex, extra = {}) => dog(name, sex, { status: 'puppy', litter_id: A.id, disposition: 'available', intended_registration: 'limited', ...extra });
  ids.willow = (await pup('Willow', 'female')).id;
  ids.pip = (await pup('Pip', 'male')).id;
  ids.wren = (await pup('Wren', 'female', { disposition: 'keeping' })).id;
  ids.ana = (await contactRepo.create({ name: 'Ana Reyes' })).id;
  ids.bo = (await contactRepo.create({ name: 'Bo Haddad' })).id;
  const lee = await contactRepo.create({ name: 'Lee', email: 'lee@example.com' });
  ids.lee = (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: lee.id, status: 'active', approved_date: '2026-01-01', fee_received_date: '2026-01-01', pref_sex: 'any', pref_purposes: ['pet'] })).id;
});

const sell = (dogId, buyer, extra = {}) => saleRepo.create({ dog_id: dogId, buyer_contact_id: buyer, registration_type: 'limited', status: 'deposit_pending', kennel_id: K.id, sale_date: DAY, ...extra });
const allSales = () => saleRepo.getAll({ includeArchived: true });

test('checks: placed and gone pups are refused; Undecided, Keeping and Health hold are pulled', () => {
  const d = (x) => ({ call_name: 'Pup', status: 'puppy', disposition: 'available', ...x });
  assert.match(checks.saleBlocker(d({ disposition: 'placed' })), /placed/);
  assert.match(checks.saleBlocker(d({ status: 'pet_home' })), /gone home/);
  assert.equal(checks.saleBlocker(d({})), '');
  assert.equal(checks.pulledFrom(d({})), null);
  assert.equal(checks.pulledFrom(d({ disposition: null })), 'undecided');
  assert.equal(checks.pulledFrom(d({ disposition: 'keeping' })), 'keeping');
  assert.equal(checks.pulledFrom(d({ disposition: 'health_hold' })), 'health_hold');
});

test('deposit due: deposit_due_date first, an older side sale\'s side_deposit_due, overdue only while pending', () => {
  assert.equal(checks.depositDueOf({ deposit_due_date: '2026-10-10', side_deposit_due: '2026-10-09' }), '2026-10-10');
  assert.equal(checks.depositDueOf({ side_deposit_due: '2026-10-09' }), '2026-10-09', 'a backup from before the field');
  assert.equal(checks.depositDueOf({}), null);
  assert.equal(checks.isDepositOverdue({ status: 'deposit_pending', deposit_due_date: '2026-10-07' }, DAY), true);
  assert.equal(checks.isDepositOverdue({ status: 'deposit_pending', deposit_due_date: DAY }, DAY), false, 'due today is not late');
  assert.equal(checks.isDepositOverdue({ status: 'deposit_paid', deposit_due_date: '2026-10-07' }, DAY), false);
  assert.equal(checks.isDepositOverdue({ status: 'deposit_pending', deposit_due_date: '2026-10-07', is_archived: true }, DAY), false);
});

test('the field: saved on any sale, checked as a date, synced like the side sale\'s due date (U3)', async () => {
  const s = await sell(ids.willow, ids.ana, { deposit_due_date: '2026-10-12' });
  assert.equal((await saleRepo.getById(s.id)).deposit_due_date, '2026-10-12');
  await assert.rejects(sell(ids.pip, ids.bo, { deposit_due_date: '10/12/2026' }), /deposit due date/);
  const { SYNC_REGISTRY } = await import('../shared/data/syncRegistry.js');
  assert.ok(SYNC_REGISTRY.sales.cloud.includes('deposit_due_date'));
  const { CLOUD_FIELDS } = await import('../cloud/src/lib/cloudFields.js');
  assert.ok(JSON.stringify(CLOUD_FIELDS).includes('deposit_due_date'), 'cloudFields.js regenerated');
});

test('a side sale writes both due dates', async () => {
  const { sale } = await actions.recordSideSale(ids.lee, { dogId: ids.willow, registration: 'limited', date: DAY });
  assert.equal(sale.deposit_due_date, sale.side_deposit_due);
});

test('U8: any sale waiting on its deposit holds its pup, off every turn', async () => {
  await sell(ids.willow, ids.ana);
  assert.equal(rules.isPupAvailable(await dogRepo.getById(ids.willow), await allSales()), false);
  const turn = await actions.openPicks(A.id, { date: DAY });
  assert.ok(!turn.offers[0].eligible_dog_ids.includes(ids.willow));
});

test('the claims she is told about while recording, leaving out the sale being edited', async () => {
  const a = await sell(ids.willow, ids.ana, { deposit_due_date: '2026-10-11' });
  const b = await sell(ids.willow, ids.bo);
  const sales = await allSales();
  const others = checks.otherClaims(ids.willow, { sales, exceptSaleId: b.id });
  assert.deepEqual(others.map((c) => c.sale_id), [a.id]);
  const line = checks.claimLine(others[0], { sales, nameOfSale: (s) => (s.buyer_contact_id === ids.ana ? 'Ana Reyes' : '') });
  assert.equal(line, 'Also sold to Ana Reyes, deposit not in yet (due 2026-10-11). The first deposit received takes the pup.');
  assert.deepEqual(checks.otherClaims(ids.pip, { sales }), []);
});

test('a deposit recorded on one sale ends the other pending sale and a turn pick', async () => {
  const turn = await actions.openPicks(A.id, { date: DAY }); // Lee
  await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.willow, date: DAY });
  const other = await sell(ids.willow, ids.bo);
  const mine = await sell(ids.willow, ids.ana);
  await saleRepo.update(mine.id, { status: 'deposit_paid', deposit_date: DAY });
  const res = await actions.settleOtherClaims(mine.id, { date: DAY });
  assert.deepEqual(res.map((r) => r.kind).sort(), ['pick_released', 'sale_cancelled']);
  assert.equal((await saleRepo.getById(other.id)).status, 'cancelled');
  assert.equal((await waitlistOfferRepo.getById(turn.offers[0].id)).chosen_dog_id, null, 'Lee\'s pick let go');
  assert.equal((await saleRepo.getById(mine.id)).status, 'deposit_paid', 'the winner untouched');
});

test('a pulled pup goes back on cancel; not while another sale has it', async () => {
  const s = await sell(ids.wren, ids.ana, { side_holds_pup: true, side_prior_disposition: 'keeping', deposit_due_date: '2026-10-07' });
  await dogRepo.update(ids.wren, { disposition: 'placed' }); // the Sale page's "Placed" prompt
  const r = await pending.cancelPendingSale(s.id, { date: DAY });
  assert.equal(r.sale.status, 'cancelled');
  assert.equal(r.restored, 'keeping');
  assert.equal((await dogRepo.getById(ids.wren)).disposition, 'keeping');

  const s2 = await sell(ids.wren, ids.ana, { side_holds_pup: true, side_prior_disposition: 'keeping' });
  await dogRepo.update(ids.wren, { disposition: 'placed' });
  await sell(ids.wren, ids.bo, { status: 'deposit_paid' });
  assert.equal((await pending.cancelPendingSale(s2.id, { date: DAY })).restored, null, 'Bo\'s sale has the pup now');
  await assert.rejects(pending.cancelPendingSale(s2.id, { date: DAY }), /waiting on its deposit/);
});

test('Today: a late deposit on any sale but a side sale, with Cancel the sale', async () => {
  const late = await sell(ids.willow, ids.ana, { deposit_due_date: '2026-10-07' });
  const side = { ...late, id: 'side', side_entry_id: ids.lee };
  const paid = { ...late, id: 'paid', status: 'deposit_paid' };
  const soon = { ...late, id: 'soon', deposit_due_date: '2026-10-09' };
  const out = nudges.depositOverdueNudges(DAY, [late, side, paid, soon],
    new Map([[ids.willow, { call_name: 'Willow' }]]), new Map([[ids.ana, { name: 'Ana Reyes' }]]));
  assert.equal(out.length, 1);
  assert.equal(out[0].key, `sale-deposit-overdue:${late.id}:2026-10-07`);
  assert.equal(out[0].title, 'Ana Reyes\'s deposit for Willow was due Oct 7');
  assert.deepEqual(out[0].actions.map((a) => a.label), ['Open the sale', 'Cancel the sale']);
});

test('the statement asks for the deposit by the sale\'s own due date', async () => {
  const income = await import('../shared/data/incomeView.js');
  const s = await sell(ids.willow, ids.ana, { price: 3000, deposit_amount: 500, deposit_due_date: '2026-10-12' });
  const { statement } = await income.getSaleStatement(s.id, { today: DAY });
  assert.equal(statement.deposit.date, '2026-10-12');
});
