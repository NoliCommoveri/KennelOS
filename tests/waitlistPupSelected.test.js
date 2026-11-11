// waitlistPupSelected.test.js — Waitlist Fixes Plan step 2 (§3.1, §3.2, §6):
// "Pup selected" (a placed family keeps its place and number until the pup goes
// home), "Already Reserved" (pups whose disposition is Placed, the website's rule),
// one rule for the litters the waitlist shows, one "placed family" for the reports,
// public names built from the right name, a decided back-out shown to the family,
// and the policies banner date for a placed family.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let dogRepo; let litterRepo; let contactRepo; let saleRepo;
let waitlistEntryRepo; let waitlistOfferRepo; let actions; let rules; let projection; let site; let reports;
let pages; let common; let moves;
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
  projection = await import('../shared/data/waitlistProjection.js');
  site = await import('../shared/data/siteExport.js');
  reports = await import('../shared/data/waitlistReports.js');
  pages = await import('../cloud/src/familyPages.js');
  common = await import('../cloud/public/family/common.js');
  moves = await import('../cloud/src/serverMoves.js');
});

let K; let A;
const ids = {};

// Litter A: Pip, Max (males), Poppy (female). Lee wants a male; Kim, Ng and Ode
// take either, in that order.
beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, public_id: 'kos1_11111111-2222-4333-8444-555555555555', waitlist_config: { max_passes: 2, respond_days: 3 } });
  const dog = (call_name, sex, extra = {}) => dogRepo.create({ call_name, sex, breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id, ...extra });
  const ash = await dog('Ash', 'male');
  const jun = await dog('Juniper', 'female');
  A = await litterRepo.create({ dam_id: jun.id, sire_id: ash.id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-08-01', nickname: 'Litter A' });
  const pup = (name, sex) => dog(name, sex, { status: 'puppy', litter_id: A.id, disposition: 'available', intended_registration: 'limited' });
  ids.pip = (await pup('Pip', 'male')).id;
  ids.max = (await pup('Max', 'male')).id;
  ids.poppy = (await pup('Poppy', 'female')).id;
  const fam = async (name, fee, extra = {}) => {
    const c = await contactRepo.create({ name: `${name} Family`, email: `${name.toLowerCase()}@example.com` });
    return (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'active', approved_date: '2026-01-01', fee_received_date: fee, applied_date: '2025-12-20',
      pref_sex: 'any', pref_purposes: ['pet'], application: { name: `${name === 'Lee' ? 'Jane' : name === 'Kim' ? 'Andrea' : 'Sam'} ${name}` }, ...extra })).id;
  };
  ids.lee = await fam('Lee', '2026-01-01', { pref_sex: 'male' });
  ids.kim = await fam('Kim', '2026-01-02', { private_listing: true });
  ids.ng = await fam('Ng', '2026-01-03');
  ids.ode = await fam('Ode', '2026-01-04');
});

const all = async () => ({
  entries: await waitlistEntryRepo.getByKennel(K.id),
  sales: await saleRepo.getAll({ includeArchived: true }),
  dogs: await dogRepo.getAll({ includeArchived: true }),
  offers: await waitlistOfferRepo.getByKennel(K.id)
});
const numbers = async () => {
  const { entries, sales, dogs } = await all();
  return rules.overallPositions(entries, K.id, new Map(), { sales, dogs });
};
const build = async () => {
  const { entries, sales, dogs, offers } = await all();
  return projection.buildProjection({
    kennel: await kennelRepo.getById(K.id), entries, offers, litters: await litterRepo.getAll({ includeArchived: true }),
    dogs, sales, contacts: await contactRepo.getAll({ includeArchived: true }), today: DAY
  });
};

// Lee holds the turn, picks Pip and pays: placed, with a pup selected. → Lee's sale.
async function placeLee() {
  const turn = await actions.openPicks(A.id, { date: DAY });
  assert.equal(turn.entry_id, ids.lee);
  await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.pip, date: DAY });
  const res = await actions.confirmDeposit(turn.offers[0].id, { date: DAY, amount: 500 });
  return res.sale;
}

// --- E1: one numbering ---------------------------------------------------------------

test('E1: a reader of a family\'s number without the sales and dogs throws', () => {
  for (const call of [
    () => rules.numberedList([], K.id),
    () => rules.overallPositions([], K.id),
    () => rules.prefPlaces([], K.id),
    () => rules.publicList([], K.id, new Map(), { today: DAY }),
    () => rules.publicSelected([], K.id)
  ]) assert.throws(call, /needs the sales and dogs/);
});

test('E1: a deposit ahead of a family doesn\'t change its number; Lee keeps #1 as Pup selected', async () => {
  const before = await numbers();
  assert.deepEqual([ids.lee, ids.kim, ids.ng, ids.ode].map((id) => before.get(id)), [1, 2, 3, 4]);
  await placeLee();
  const after = await numbers();
  assert.deepEqual([ids.lee, ids.kim, ids.ng, ids.ode].map((id) => after.get(id)), [1, 2, 3, 4], 'nobody moves');
  assert.equal(after.size, 4, '"of 4": the totals count the family with a pup selected');
  const { entries, sales, dogs, offers } = await all();
  const lee = entries.find((e) => e.id === ids.lee);
  assert.equal(lee.status, 'placed');
  assert.equal(rules.holdsPlace(lee, { sales, dogs }), true);
  // Never offered a turn: not in the waiting list, the turn queue or nextTurn.
  assert.equal(rules.rankedList(entries, K.id).some((e) => e.id === ids.lee), false);
  const next = rules.nextTurn(entries, offers, await litterRepo.getAll(), dogs, sales, { today: DAY, kennelId: K.id });
  assert.equal(next.entry.id, ids.kim);
  const p = await build();
  assert.equal(p.turn_queue.some((q) => q.entry_id === ids.lee), false);
});

test('E1: every reader gives the same number on one record set', async () => {
  await placeLee();
  const { entries, sales, dogs } = await all();
  const nums = await numbers();
  const p = await build();
  const opts = { today: DAY, sales, dogs };
  const list = rules.publicList(entries, K.id, new Map(), opts);
  const selected = rules.publicSelected(entries, K.id, new Map(), { sales, dogs });
  for (const id of [ids.kim, ids.ng, ids.ode]) assert.equal(p.entries[id].position, nums.get(id), 'the status page');
  assert.deepEqual(list.map((r) => r.position), [ids.kim, ids.ng, ids.ode].map((id) => nums.get(id)), 'the public list');
  assert.deepEqual(selected.map((r) => r.position), [nums.get(ids.lee)], 'Pup selected');
  assert.deepEqual(p.public_list.map((r) => r.position), list.map((r) => r.position));
  assert.deepEqual(p.public_selected, selected);
  const prefs = rules.prefPlaces(entries, K.id, new Map(), undefined, { sales, dogs });
  assert.equal(prefs.get(ids.lee).sex, 1, 'Lee, first for a male');
  // The copied text puts the row in at its number.
  const text = rules.publicListText(list, { selected });
  assert.match(text, /✓ #1 Jane L\. · Pup selected\n#2 A\*\*\*\*\*/);
  assert.equal(/some applicant names may not be displayed/.test(text), false, 'a held number is not a gap');
});

test('E1: the public rows: unchanged shape, private names stay masked, never the pup', async () => {
  await waitlistEntryRepo.update(ids.lee, { private_listing: true });
  await placeLee();
  const p = await build();
  assert.deepEqual(Object.keys(p.public_list[0]).sort(), ['added', 'name', 'position', 'pref_sex']);
  assert.deepEqual(p.public_selected, [{ position: 1, name: 'J*** L', added: '2026-01-01' }]);
  assert.equal(JSON.stringify(p.public_selected).includes('Pip'), false);
  // The server passes them through, and the family pages draw them at their number.
  const view = pages.listView(p);
  assert.deepEqual(view.selected, [{ position: 1, name: 'J*** L', added: '2026-01-01' }]);
  const html = common.publicListHtml(view.rows, '', null, view.selected);
  assert.match(html, /class="selected"[\s\S]*✓<\/span> #1[\s\S]*J\*\*\* L[\s\S]*Pup selected/);
  assert.equal(html.includes('some applicant names may not be displayed'), false);
  assert.match(common.publicListHtml(view.rows, '#1', null, view.selected), /Pup selected/, 'search by number finds it');
  assert.match(common.publicListHtml(view.rows, '', null, []), /some applicant names may not be displayed/, 'an older page: the gap note');
  const status = pages.statusView(p, ids.ng);
  assert.deepEqual(status.public_selected, view.selected);
});

test('E1: the pup going home moves everyone behind up one', async () => {
  const sale = await placeLee();
  await saleRepo.update(sale.id, { status: 'delivered' });
  const nums = await numbers();
  assert.equal(nums.has(ids.lee), false);
  assert.deepEqual([ids.kim, ids.ng, ids.ode].map((id) => nums.get(id)), [1, 2, 3]);
});

test('E1: the pup turned External: the row goes', async () => {
  await placeLee();
  await dogRepo.update(ids.pip, { status: 'external_reference' });
  assert.equal((await numbers()).has(ids.lee), false);
});

test('E1: a lost pup\'s family put back in line takes the number it held, and nobody moves', async () => {
  const sale = await placeLee();
  const before = await numbers();
  await saleRepo.update(sale.id, { status: 'voided', end_reason: 'pup_died' });
  await dogRepo.update(ids.pip, { status: 'deceased', date_of_death: LATER });
  await actions.restoreAfterLostSale(sale.id, { date: LATER });
  const after = await numbers();
  assert.equal((await waitlistEntryRepo.getById(ids.lee)).status, 'active');
  for (const id of [ids.lee, ids.kim, ids.ng, ids.ode]) assert.equal(after.get(id), before.get(id));
});

test('E1: a backed-out, returned or off-list record holds no place', async () => {
  const sale = await placeLee();
  const lee = await waitlistEntryRepo.getById(ids.lee);
  const { sales, dogs } = await all();
  const withSale = (status) => sales.map((s) => (s.id === sale.id ? { ...s, status } : s));
  assert.equal(rules.holdsPlace(lee, { sales: withSale('cancelled'), dogs }), false, 'backed out');
  assert.equal(rules.holdsPlace(lee, { sales: withSale('returned'), dogs }), false, 'returned');
  assert.equal(rules.holdsPlace({ ...lee, off_list: true }, { sales, dogs }), false, 'a family page only (step 3)');
  assert.equal(rules.holdsPlace({ ...lee, is_archived: true }, { sales, dogs }), false);
  assert.equal(rules.holdsPlace(lee, { sales: new Map(sales.map((s) => [s.id, s])), dogs: new Map(dogs.map((d) => [d.id, d])) }), true, 'Maps work too');
});

test('E1: a family placed through a side sale holds its place the same way', async () => {
  const { sale } = await actions.recordSideSale(ids.ode, { dogId: ids.poppy, registration: 'limited', date: DAY });
  await actions.confirmSideDeposit(sale.id, { date: DAY, amount: 300 });
  const nums = await numbers();
  assert.equal(nums.get(ids.ode), 4);
  assert.equal(nums.size, 4);
});

// --- E2: Already Reserved -------------------------------------------------------------

test('E2: isPupReserved and the website agree on every disposition and status', () => {
  const dispositions = ['available', 'placed', 'keeping', 'undecided', 'health_hold', null];
  const statuses = ['puppy', 'deceased', 'pet_home', 'external_reference'];
  for (const disposition of dispositions) {
    for (const status of statuses) {
      for (const is_archived of [false, true]) {
        const pup = { id: 'p', disposition, status, is_archived, sex: 'male' };
        const onSite = !is_archived && !['deceased', 'external_reference'].includes(status) && site.puppyStatus(pup) === 'placed';
        assert.equal(rules.isPupReserved(pup), onSite, JSON.stringify(pup));
        assert.equal(rules.isPupReserved(pup) && rules.isPupAvailable(pup, []), false, 'never both');
      }
    }
  }
});

test('E2: a reserved pup is on the card under Already Reserved, never in a turn', async () => {
  await placeLee();
  let p = await build();
  const l = p.litters[A.id];
  assert.deepEqual(l.reserved.map((d) => d.call_name), ['Pip']);
  assert.equal(l.pups.some((d) => d.id === ids.pip), false, 'only available pups in `pups`');
  assert.equal(l.pups.some((d) => l.reserved.some((r) => r.id === d.id)), false, 'no pup in both');
  // Kim's turn: Pip in no offer's pups or eligible ids, nor the server's available set.
  const turn = await actions.offerNext(A.id, { date: DAY });
  assert.equal(turn.entry_id, ids.kim);
  p = await build();
  for (const e of Object.values(p.entries)) for (const o of e.offers || []) assert.equal((o.eligible_dog_ids || []).includes(ids.pip), false);
  const view = pages.statusView(p, ids.kim);
  for (const o of view.offers) assert.equal(o.pups.some((d) => d.call_name === 'Pip'), false);
  p.entries[ids.kim].offers = [];
  const next = moves.nextFromQueue(p);
  assert.equal(next ? next.rows.some((r) => r.dog_ids.includes(ids.pip)) : false, false);
  // The card the family pages draw.
  const card = pages.listView(p).available.find((x) => x.id === A.id);
  assert.deepEqual(card.reserved.map((d) => d.call_name), ['Pip']);
  const html = common.pupColumnsHtml(card);
  assert.match(html, /Still Available[\s\S]*Males[\s\S]*Max[\s\S]*Already Reserved[\s\S]*Males[\s\S]*Pip/);
  assert.equal(/Lee/.test(html), false, 'nothing says who reserved it');
});

test('E2: a pick still waiting on its deposit is in neither list', async () => {
  const turn = await actions.openPicks(A.id, { date: DAY });
  await actions.recordPick(turn.offers[0].id, { chosenDogId: ids.pip, date: DAY });
  const l = (await build()).litters[A.id];
  assert.equal(l.pups.some((d) => d.id === ids.pip), false);
  assert.equal(l.reserved.some((d) => d.id === ids.pip), false);
});

test('E2: gone home, or set back to Available, leaves Already Reserved', async () => {
  const sale = await placeLee();
  await dogRepo.update(ids.pip, { status: 'external_reference' });
  assert.equal((await build()).litters[A.id].reserved.length, 0);
  await dogRepo.update(ids.pip, { status: 'puppy', disposition: 'available' });
  await saleRepo.update(sale.id, { status: 'returned' });
  const l = (await build()).litters[A.id];
  assert.equal(l.reserved.length, 0);
  assert.ok(l.pups.some((d) => d.id === ids.pip));
});

test('E2: a card with no reserved pup looks as before; nothing left reads "No puppies remaining"', () => {
  const pup = (call_name, sex) => ({ call_name, sex });
  assert.equal(common.pupColumnsHtml({ pups: [pup('Max', 'male')], reserved: [] }).includes('Already Reserved'), false);
  assert.match(common.pupColumnsHtml({ pups: [], reserved: [pup('Pip', 'male')] }), /No puppies remaining[\s\S]*Already Reserved[\s\S]*Pip/);
});

// --- One rule for "a litter the waitlist shows" (K6-12 item 1) -------------------------

test('a litter the waitlist shows: a live stage, not archived, this kennel', () => {
  const l = (status, extra = {}) => ({ id: status, status, kennel_id: 'k', ...extra });
  const list = [l('planned'), l('expected'), l('whelped'), l('weaning'), l('ready'), l('sold'), l('closed'), l('ready', { id: 'x', is_archived: true }), l('ready', { id: 'y', kennel_id: 'other' })];
  assert.deepEqual(rules.waitlistLitters('k', list).map((x) => x.id), ['expected', 'whelped', 'weaning', 'ready']);
  assert.deepEqual(rules.waitlistLitters({ id: 'k' }, list).map((x) => x.id), ['expected', 'whelped', 'weaning', 'ready']);
  assert.deepEqual(projection.LIVE_LITTER, rules.LISTEN_LIVE_LITTER);
});

// --- K8-12: who counts as placed -----------------------------------------------------

test('K8-12: a family that backed out is not counted Placed', () => {
  const sales = [{ id: 's1', status: 'cancelled', sale_date: '2026-03-01' }, { id: 's2', status: 'deposit_paid', sale_date: '2026-03-01' }];
  const backed = { id: 'a', status: 'withdrawn', placed_sale_id: 's1', applied_date: '2026-01-01', back_out_request: { decided: 'approved', outcome: 'keep' } };
  const placed = { id: 'b', status: 'placed', placed_sale_id: 's2', applied_date: '2026-01-01' };
  assert.equal(rules.isPlacedFamily(backed, sales), false);
  assert.equal(rules.isPlacedFamily(placed, sales), true);
  assert.equal(reports.funnelStage(backed, new Set(['a']), sales), 3, 'got as far as Offered');
  assert.equal(reports.funnelStage(placed, new Set(), sales), 4);
  assert.deepEqual(reports.daysToPlacement([backed, placed], new Map(sales.map((s) => [s.id, s]))), [59]);
  assert.equal(reports.exitLabel(backed), 'Backed out');
  assert.equal(reports.exitGroup(backed), 'backed_out');
  assert.equal(reports.exitLabel({ status: 'withdrawn' }), 'Withdrew');
  const { outcomes } = reports.offerOutcomes([{ outcome: 'accepted', backed_out_date: '2026-03-02' }, { outcome: 'accepted' }]);
  assert.deepEqual(outcomes, [{ label: 'Backed out', value: 1 }, { label: 'Accepted', value: 1 }]);
  const rows = reports.offerAndExitRows([backed], [{ id: 'o', entry_id: 'a', outcome: 'accepted', backed_out_date: '2026-03-02', outcome_date: '2026-02-01' }]);
  assert.deepEqual(rows.map((r) => r.what).sort(), ['accepted_backed_out', 'backed_out']);
  assert.equal(reports.offerAndExitStats(rows).accepted, 0);
});

// --- K7-8: public names ----------------------------------------------------------------

test('K7-8: household and "Last, First" names never show a surname', () => {
  const cases = {
    'Smith Family': ['S. Family', 'S**** Family'],
    'Smith, John': ['John S.', 'J*** S'],
    'The Smith Family': ['S. Family', 'S**** Family'],
    'Ortiz-Lopez Family': ['O. Family', 'O********** Family'],
    'Dr. Jane Smith': ['Jane S.', 'J*** S'],
    'Jane Smith': ['Jane S.', 'J*** S'],
    Cher: ['Cher', 'C***'],
    '': ['Family', 'Family']
  };
  for (const [name, [pub, priv]] of Object.entries(cases)) {
    assert.equal(rules.publicName(name), pub, name);
    assert.equal(rules.privateName(name), priv, name);
  }
  const entry = { application: { name: 'Jane Smith' } };
  assert.equal(rules.publicSourceName(entry, { name: 'Smith Family' }), 'Jane Smith', 'the applicant\'s own name');
  assert.equal(rules.publicSourceName(entry, { name: 'Smith, Jane' }), 'Jane Smith');
  assert.equal(rules.publicSourceName(entry, { name: 'Janet Smith' }), 'Janet Smith', 'an ordinary contact name stands');
  assert.equal(rules.publicSourceName({}, { name: 'Smith Family' }), 'Smith Family', 'nothing better: the household form');
});

test('K7-8: the projection builds the public list from the applicant\'s name when the contact is a household', async () => {
  const p = await build();
  assert.equal(p.public_list[0].name, 'Jane L.', 'contact "Lee Family", applied as "Jane Lee"');
});

// --- K8-7: a decided back-out stays on the family's page --------------------------------

test('K8-7: after a back-out, the family is shown what happened to their deposit', async () => {
  const sale = await placeLee();
  await waitlistEntryRepo.update(ids.lee, { back_out_request: { requested_date: DAY, by: 'family', reason: { id: 'r', label: 'Changed plans' } } });
  await actions.approveBackOut(ids.lee, { outcome: 'keep', date: DAY });
  assert.equal((await saleRepo.getById(sale.id)).status, 'cancelled');
  const p = await build();
  const e = p.entries[ids.lee];
  assert.equal(e.status, 'withdrawn');
  assert.equal(e.back_out.available, false);
  assert.equal(e.back_out.request.decided, 'approved');
  assert.equal(e.back_out.request.outcome, 'keep');
  assert.equal(p.kennel.back_out_reasons, undefined, 'no form, so no reasons');
  const view = pages.statusView(p, ids.lee);
  assert.deepEqual(view.family.back_out, { available: false, request: { reason: 'Changed plans', requested_date: DAY, decided: 'approved', decided_date: DAY, outcome: 'keep' } });
  assert.equal((await numbers()).has(ids.lee), false, 'they stop holding their place at the same moment');
});

test('K8-7: each back-out outcome has its own email', async () => {
  const { EMAIL_KINDS, EMAIL_TEMPLATE_KINDS, DEFAULT_EMAIL_TEMPLATES } = await import('../shared/data/waitlistEmails.js');
  for (const kind of ['backed_out_keep', 'backed_out_move', 'backed_out_refund']) {
    assert.ok(EMAIL_KINDS.includes(kind));
    assert.ok(EMAIL_TEMPLATE_KINDS.some((k) => k.kind === kind));
    assert.ok(DEFAULT_EMAIL_TEMPLATES[kind].body.length);
  }
  assert.match(DEFAULT_EMAIL_TEMPLATES.backed_out_keep.body, /deposit is kept/);
  assert.match(DEFAULT_EMAIL_TEMPLATES.backed_out_move.body, /moves to your next puppy/);
  assert.match(DEFAULT_EMAIL_TEMPLATES.backed_out_refund.body, /refunding your deposit/);
});

// --- K7-12: the policies banner date for a placed family ---------------------------------

test('K7-12: a placed family with an open sale gets the day they applied, for the policies banner', async () => {
  await placeLee();
  const p = await build();
  assert.equal(p.entries[ids.lee].status, 'placed');
  assert.equal(p.entries[ids.lee].applied_date, '2025-12-20');
  p.entries[ids.lee].companion = { available: true };
  assert.equal(pages.statusView(p, ids.lee).family.applied_date, '2025-12-20');
});
