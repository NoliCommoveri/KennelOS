// waitlistFamilyPages.test.js — Waitlist fixes plan step 3 (E3, K7-9, K8-8): a family
// page without the list. A litter sold before she used the waitlist is kept off it
// (`Litter.waitlist_off`) and each of its buyers gets a status page (`off_list`
// records) that never ranks, never shows on a list, a funnel or a report, and is never
// put back in line; a back-out closes the family's waiting requests.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let dogRepo; let litterRepo; let contactRepo; let saleRepo;
let waitlistEntryRepo; let waitlistOfferRepo; let actions; let rules; let projection; let reports; let pages; let slots; let preview;
const DAY = '2026-11-11';

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
  projection = await import('../shared/data/waitlistProjection.js');
  reports = await import('../shared/data/waitlistReports.js');
  pages = await import('../cloud/src/familyPages.js');
  slots = await import('../shared/data/pickupSlots.js');
  preview = await import('../shared/data/picksPreview.js');
});

let K; let A; let OLD;
const ids = {};

// Litter A (on the waitlist): Pip (male), Poppy (female). Litter OLD (sold before the
// waitlist): Rex sold to the Grays, Ruby sold to the Hales, Rue with no sale.
// On the list: Lee (male only), Kim (either).
beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, public_id: 'kos1_11111111-2222-4333-8444-555555555555', waitlist_config: { max_passes: 2, respond_days: 3 } });
  const dog = (call_name, sex, extra = {}) => dogRepo.create({ call_name, sex, breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id, ...extra });
  const ash = await dog('Ash', 'male');
  const jun = await dog('Juniper', 'female');
  A = await litterRepo.create({ dam_id: jun.id, sire_id: ash.id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-09-01', nickname: 'Litter A' });
  OLD = await litterRepo.create({ dam_id: jun.id, sire_id: ash.id, status: 'ready', kennel_id: K.id, whelp_date: '2026-08-01', nickname: 'Old litter' });
  const pup = (name, sex, litter, extra = {}) => dog(name, sex, { status: 'puppy', litter_id: litter.id, disposition: 'available', intended_registration: 'limited', ...extra });
  ids.pip = (await pup('Pip', 'male', A)).id;
  ids.poppy = (await pup('Poppy', 'female', A)).id;
  ids.rex = (await pup('Rex', 'male', OLD, { disposition: 'placed' })).id;
  ids.ruby = (await pup('Ruby', 'female', OLD, { disposition: 'placed' })).id;
  ids.rue = (await pup('Rue', 'female', OLD)).id;
  const buyer = async (name) => (await contactRepo.create({ name: `${name} Family`, email: `${name.toLowerCase()}@example.com` })).id;
  ids.gray = await buyer('Gray');
  ids.hale = await buyer('Hale');
  ids.rexSale = (await saleRepo.create({ dog_id: ids.rex, buyer_contact_id: ids.gray, registration_type: 'limited', status: 'deposit_paid', kennel_id: K.id, sale_date: '2026-08-20', deposit_amount: 500, deposit_date: '2026-08-20' })).id;
  ids.rubySale = (await saleRepo.create({ dog_id: ids.ruby, buyer_contact_id: ids.hale, registration_type: 'limited', status: 'deposit_paid', kennel_id: K.id, sale_date: '2026-08-21', deposit_amount: 500, deposit_date: '2026-08-21' })).id;
  const fam = async (name, fee, extra = {}) => {
    const c = await contactRepo.create({ name: `${name} Family`, email: `${name.toLowerCase()}@example.com` });
    return (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'active', approved_date: '2026-01-01', fee_received_date: fee, applied_date: '2025-12-20',
      pref_sex: 'any', pref_purposes: ['pet'], application: { name: `Sam ${name}` }, ...extra })).id;
  };
  ids.lee = await fam('Lee', '2026-01-01', { pref_sex: 'male' });
  ids.kim = await fam('Kim', '2026-01-02');
});

const all = async () => ({
  entries: await waitlistEntryRepo.getByKennel(K.id),
  sales: await saleRepo.getAll({ includeArchived: true }),
  dogs: await dogRepo.getAll({ includeArchived: true }),
  offers: await waitlistOfferRepo.getByKennel(K.id),
  litters: await litterRepo.getAll({ includeArchived: true })
});
const build = async () => {
  const { entries, sales, dogs, offers, litters } = await all();
  return projection.buildProjection({
    kennel: await kennelRepo.getById(K.id), entries, offers, litters, dogs, sales, contacts: await contactRepo.getAll({ includeArchived: true }), today: DAY
  });
};
const pageOf = async (saleId) => (await waitlistEntryRepo.getByKennel(K.id)).find((e) => e.placed_sale_id === saleId && e.off_list);

// --- The rules ----------------------------------------------------------------------

test('E3: a litter kept off the waitlist is no waitlist litter, and never has open picks', () => {
  const l = { id: 'L', kennel_id: 'k', status: 'whelped', picks_opened_date: '2026-11-01' };
  assert.equal(rules.isWaitlistLitter(l, 'k'), true);
  assert.equal(rules.isWaitlistLitter({ ...l, waitlist_off: true }, 'k'), false);
  assert.equal(rules.isPicksOpen(l), true);
  assert.equal(rules.isPicksOpen({ ...l, waitlist_off: true }), false, 'a stale picks date opens nothing');
  assert.equal(rules.isWhelpNoteLitter({ ...l, picks_opened_date: null, waitlist_off: true }), false);
  assert.deepEqual(rules.depositsDueLitters([{ ...l, picks_opened_date: null, accept_deposits_date: '2026-11-01', waitlist_off: true }], [{ id: 'p', litter_id: 'L', disposition: 'available' }], [], DAY), []);
});

test('E3: familyPageBlocker refuses an ended sale, no buyer, a claimed sale; familyPagePlan lists what it will do', async () => {
  const { entries, sales, dogs, offers } = await all();
  const rexSale = sales.find((s) => s.id === ids.rexSale);
  assert.equal(rules.familyPageBlocker(rexSale, entries, offers), '');
  assert.match(rules.familyPageBlocker({ ...rexSale, status: 'cancelled' }, entries, offers), /has ended/);
  assert.match(rules.familyPageBlocker({ ...rexSale, buyer_contact_id: null }, entries, offers), /no buyer/);
  assert.match(rules.familyPageBlocker(rexSale, [...entries, { id: 'x', status: 'placed', placed_sale_id: rexSale.id }], offers), /already has a status page/);
  const plan = rules.familyPagePlan(OLD, { pups: dogs, sales, entries, offers });
  assert.deepEqual(plan.rows.map((r) => [r.dog.call_name, r.blocker]), [['Rex', ''], ['Ruby', '']]);
  assert.deepEqual(plan.unsold.map((d) => d.call_name), ['Rue']);
});

// --- Sold before the waitlist --------------------------------------------------------

test('E3: "Non-Waitlist Sales" keeps the litter off and gives each buyer a family page', async () => {
  const res = await actions.soldBeforeWaitlist(OLD.id, { date: DAY });
  assert.equal(res.litter.waitlist_off, true);
  assert.equal(res.created.length, 2);
  for (const e of res.created) {
    assert.equal(e.status, 'placed');
    assert.equal(e.off_list, true);
    assert.equal(e.kennel_id, K.id);
    assert.equal(e.fee_received_date ?? null, null, 'no fee, no place');
  }
  assert.deepEqual(res.created.map((e) => e.placed_sale_id).sort(), [ids.rexSale, ids.rubySale].sort());
  assert.equal((await contactRepo.getById(ids.gray)).waitlist_status || 'none', 'none', 'never on the list');
  // Again: nothing new (each sale already has its page); a sale made later gets one.
  const again = await actions.soldBeforeWaitlist(OLD.id, { date: DAY });
  assert.equal(again.created.length, 0);
  assert.equal(again.skipped.length, 2);
  const late = await saleRepo.create({ dog_id: ids.rue, buyer_contact_id: ids.gray, registration_type: 'limited', status: 'deposit_paid', kennel_id: K.id, sale_date: DAY });
  const more = await actions.soldBeforeWaitlist(OLD.id, { date: DAY });
  assert.deepEqual(more.created.map((e) => e.placed_sale_id), [late.id]);
});

test('E3: refused while picks are open on the litter', async () => {
  await litterRepo.update(OLD.id, { picks_opened_date: DAY });
  await assert.rejects(actions.soldBeforeWaitlist(OLD.id, { date: DAY }), /Close picks first/);
});

test('E3: a litter kept off the waitlist: no picks, no turn, no preview', async () => {
  await actions.soldBeforeWaitlist(OLD.id, { date: DAY });
  await assert.rejects(actions.openPicks(OLD.id, { date: DAY }), /kept off the waitlist/);
  await assert.rejects(actions.offerNext(OLD.id, { date: DAY }), /kept off the waitlist/);
  await assert.rejects(actions.offerTo(OLD.id, ids.kim, { today: DAY }), /kept off the waitlist/);
  const { entries, sales, dogs, offers, litters } = await all();
  const kennel = await kennelRepo.getById(K.id);
  assert.throws(() => preview.previewPicks({ kennel, entries, offers, litters, dogs, sales }, { litterId: OLD.id, today: DAY }), /kept off the waitlist/);
  // A stale picks date (another device) still never puts Rue in a turn.
  await litterRepo.update(OLD.id, { picks_opened_date: DAY });
  const turn = await actions.openPicks(A.id, { date: DAY });
  assert.deepEqual(turn.litter_ids || turn.offers.map((o) => o.litter_id), [A.id]);
  // Back on the waitlist: picks can open.
  await actions.putLitterOnWaitlist(OLD.id);
  assert.equal((await litterRepo.getById(OLD.id)).waitlist_off, false);
});

// --- Family pages show on no list ----------------------------------------------------

test('E3: a family page only never ranks, holds no number, and is in no public list, report or count', async () => {
  const { created } = await actions.soldBeforeWaitlist(OLD.id, { date: DAY });
  const { entries, sales, dogs, offers } = await all();
  const off = created.map((e) => e.id);
  assert.ok(entries.filter((e) => off.includes(e.id)).every((e) => !rules.holdsPlace(e, { sales, dogs })));
  assert.deepEqual([...rules.overallPositions(entries, K.id, new Map(), { sales, dogs }).keys()].sort(), [ids.lee, ids.kim].sort());
  assert.ok(!rules.rankedList(entries, K.id).some((e) => off.includes(e.id)));
  assert.equal(rules.publicSelected(entries, K.id, new Map(), { sales, dogs, nameOf: () => 'x' }).length, 0);
  assert.equal(rules.publicList(entries, K.id, new Map(), { today: DAY, sales, dogs, nameOf: () => 'x' }).length, 2);
  // Reports read listRecords: the funnel and exits never see them.
  const listed = rules.listRecords(entries);
  assert.equal(listed.length, 2);
  assert.equal(reports.funnelCounts(listed, offers, sales).find((s) => s.value === 'placed').count, 0);
  assert.equal(rules.deriveContactWaitlistStatus(entries.filter((e) => e.contact_id === ids.gray)), 'none');
});

test('E3: the projection: no Available Puppies card for the litter, no turn queue, and the family page has its own view', async () => {
  const { created } = await actions.soldBeforeWaitlist(OLD.id, { date: DAY });
  const p = await build();
  assert.deepEqual(Object.keys(p.litters), [A.id], 'only the waitlist litter');
  assert.ok(!p.upcoming.some((u) => u.litter_id === OLD.id));
  assert.ok(!p.turn_queue.some((q) => created.some((e) => e.id === q.entry_id)));
  assert.ok(!p.public_list.some((r) => /Gray|Hale/.test(r.name)));
  assert.equal(p.public_selected.length, 0);
  const view = p.entries[created[0].id];
  assert.equal(view.page_only, true);
  assert.equal(view.status, 'placed');
  assert.ok(view.companion, 'an open sale: their page has its cards');
  assert.ok(view.back_out?.available, 'they can tell her they need to back out');
  assert.equal(view.position, undefined, 'no number');
  // The Worker passes the flag through; the waitlist families' views have none.
  const sv = pages.statusView(p, created[0].id);
  assert.equal(sv.family.page_only, true);
  assert.deepEqual(sv.public_list, []);
  assert.equal(pages.statusView(p, ids.kim).family.page_only, undefined);
});

test('E3: a backup without the two fields reads both as off', async () => {
  const { entries, litters } = await all();
  assert.ok(entries.every((e) => !rules.isFamilyPageOnly(e)));
  assert.ok(rules.isWaitlistLitter(litters.find((l) => l.id === A.id), K.id));
});

// --- One sale at a time, and a placed family kept off the list -------------------------

test('E3: addFamilyPage makes one page and refuses a second, a released sale, and a turn\'s pick', async () => {
  const e = await actions.addFamilyPage(ids.rexSale, { date: DAY });
  assert.equal(e.off_list, true);
  await assert.rejects(actions.addFamilyPage(ids.rexSale), /already has a status page/);
  await saleRepo.update(ids.rubySale, { status: 'cancelled' });
  await assert.rejects(actions.addFamilyPage(ids.rubySale), /has ended/);
  const turn = await actions.openPicks(A.id, { date: DAY });
  const { sale } = await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.pip, date: DAY });
  await assert.rejects(actions.addFamilyPage(sale.id), /pick on a family's turn/);
});

test('E3: "Keep off the list" on a placed family: the families behind move up; undo gives the place back', async () => {
  const turn = await actions.openPicks(A.id, { date: DAY });
  assert.equal(turn.entry_id, ids.lee);
  await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.pip, date: DAY });
  await actions.confirmDeposit(turn.offers[0].id, { date: DAY, amount: 500 });
  const number = async (id) => { const { entries, sales, dogs } = await all(); return rules.overallPositions(entries, K.id, new Map(), { sales, dogs }).get(id); };
  assert.equal(await number(ids.lee), 1, 'Pup selected');
  assert.equal(await number(ids.kim), 2);
  await actions.setFamilyPageOnly(ids.lee, true, { date: DAY });
  assert.equal(await number(ids.lee), undefined);
  assert.equal(await number(ids.kim), 1);
  await actions.setFamilyPageOnly(ids.lee, false, { date: DAY });
  assert.equal(await number(ids.lee), 1);
  assert.equal(await number(ids.kim), 2);
  await assert.rejects(actions.setFamilyPageOnly(ids.kim, true), /Only a placed family/);
});

// --- Backing out, a lost pup (D8) and their requests (K8-8) ---------------------------

test('D8: a family page only backs out with Keep or Refund, never Move; it stays off every list', async () => {
  const e = await actions.addFamilyPage(ids.rexSale, { date: DAY });
  await waitlistEntryRepo.update(e.id, { back_out_request: { requested_date: DAY, reason: { id: 'other', label: 'Other' } } });
  await assert.rejects(actions.approveBackOut(e.id, { outcome: 'move', date: DAY }), /keep or refund/);
  const res = await actions.approveBackOut(e.id, { outcome: 'keep', date: DAY });
  assert.equal(res.entry.status, 'withdrawn');
  assert.equal(res.entry.off_list, true);
  const p = await build();
  assert.equal(p.entries[e.id].page_only, true);
  assert.ok(!p.public_list.some((r) => /Gray/.test(r.name)));
});

test('D8: a family page only whose pup is lost is never put back in line', async () => {
  const e = await actions.addFamilyPage(ids.rexSale, { date: DAY });
  await saleRepo.update(ids.rexSale, { status: 'voided', end_reason: 'pup_died' });
  const sale = await saleRepo.getById(ids.rexSale);
  assert.equal(rules.lostSaleFamily(sale, [await waitlistEntryRepo.getById(e.id)], []), null);
  assert.equal(await actions.lostSaleFamilyFor(ids.rexSale), null);
});

test('K8-8: a back-out closes their waiting pickup and extras requests; a time they asked for is free again', async () => {
  const e = await actions.addFamilyPage(ids.rexSale, { date: DAY });
  await waitlistEntryRepo.update(e.id, {
    pickup_requests: [{ id: 'pr1', kind: 'slot', slot_id: 'slot1', date: '2026-12-01', requested_date: DAY }, { id: 'pr0', kind: 'slot', slot_id: 'slot0', requested_date: '2026-11-01', decided: 'approved', decided_date: '2026-11-02' }],
    extra_requests: [{ id: 'xr1', kind: 'add', list_id: 'train', name: 'Training', requested_date: DAY }],
    back_out_request: { requested_date: DAY, reason: { id: 'other', label: 'Other' } }
  });
  const before = await waitlistEntryRepo.getById(e.id);
  assert.equal(slots.slotBookings([], [before]).get('slot1'), 1);
  await actions.approveBackOut(e.id, { outcome: 'refund', date: DAY });
  const after = await waitlistEntryRepo.getById(e.id);
  assert.equal(after.pickup_requests.find((r) => r.id === 'pr1').decided, 'closed');
  assert.equal(after.pickup_requests.find((r) => r.id === 'pr0').decided, 'approved', 'decided ones are kept as they were');
  assert.equal(after.extra_requests[0].decided, 'closed');
  assert.equal(actions.hasPendingRequest(after, 'back_out_request'), false);
  assert.equal(slots.slotBookings([], [after]).get('slot1'), undefined);
});

test('K8-8: slotBookings skips a record with no open sale', () => {
  const entries = [{ id: 'a', pickup_requests: [{ id: 'r', kind: 'slot', slot_id: 's1', requested_date: DAY }] }];
  assert.equal(slots.slotBookings([], entries).get('s1'), 1);
  assert.equal(slots.slotBookings([], entries, { live: () => false }).get('s1'), undefined);
});
