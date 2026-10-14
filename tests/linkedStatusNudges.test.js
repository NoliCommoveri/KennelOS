// linkedStatusNudges.test.js — Today's nudges for a status change on one record
// that implies one on a linked record (End-State guide §19): a whelped litter
// whose pairing isn't, a pairing that didn't take with its litter still Expected,
// a whelped pairing with no litter, and a Deceased dog still on an open sale or
// an unfinished pairing. Each one suggests; only its action writes. Also: the
// litter-lifecycle rules (sold / reopen / close) leave a Deceased pup out, and a
// pup that died is offered for archiving. And a pairing due within 3 days with
// no litter yet suggests creating it.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let dogRepo; let contactRepo; let pairingRepo; let litterRepo; let saleRepo;
let computeNudges; let deceasedDogNudges; let deceasedArchiveAction; let editionFlags;

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ pairingRepo } = await import('../shared/data/pairingRepo.js'));
  ({ litterRepo } = await import('../shared/data/litterRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ computeNudges, deceasedDogNudges, deceasedArchiveAction } = await import('../shared/data/nudges.js'));
  ({ editionFlags } = await import('../shared/data/editionConfig.js'));
});

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const nudgesFor = async (prefix) => (await computeNudges()).filter((n) => n.key.startsWith(prefix));

let K; let dam; let sire;
beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Briar Hollow', is_own_kennel: true });
  const dog = (over) => dogRepo.create({ breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id, ...over });
  dam = await dog({ call_name: 'Hazel', sex: 'female' });
  sire = await dog({ call_name: 'Rocco', sex: 'male' });
});

const pairing = (over = {}) => pairingRepo.create({
  kennel_id: K.id, dam_id: dam.id, sire_id: sire.id, pairing_type: 'actual', status: 'bred', expected_due_date: daysAgo(5), ...over
});
const litter = (p, over = {}) => litterRepo.create({
  kennel_id: K.id, pairing_id: p.id, dam_id: dam.id, sire_id: sire.id, status: 'whelped', whelp_date: daysAgo(3), ...over
});

test('a whelped litter whose pairing still says otherwise → mark the pairing whelped', async () => {
  const p = await pairing({ status: 'confirmed_pregnant' });
  const l = await litter(p, { status: 'weaning' });
  const [n, ...rest] = await nudgesFor('litterpairing:');
  assert.equal(rest.length, 0);
  assert.equal(n.key, `litterpairing:${l.id}`);
  assert.equal(n.actions[0].label, 'Mark pairing whelped');
  assert.equal((await nudgesFor('pairingoverdue:')).length, 0, 'the overdue rule stays quiet once a litter exists');
  await n.actions[0].run();
  assert.equal((await pairingRepo.getById(p.id)).status, 'whelped');
  assert.equal((await nudgesFor('litterpairing:')).length, 0, 'gone once the pairing matches');
  assert.equal((await nudgesFor('pairingnolitter:')).length, 0, 'and the pairing has its litter');
});

test('an Expected litter, an archived one, or no linked pairing → nothing', async () => {
  const p = await pairing();
  await litter(p, { status: 'expected' });
  const l2 = await litter(p, { status: 'whelped' });
  await litterRepo.archive(l2.id);
  await litterRepo.create({ kennel_id: K.id, dam_id: dam.id, sire_id: sire.id, status: 'whelped' });
  assert.equal((await nudgesFor('litterpairing:')).length, 0);
});

test('a pairing that didn\'t take, with its litter still Expected → archive the litter', async () => {
  for (const status of ['not_pregnant', 'failed', 'cancelled']) {
    for (const t of [db.pairings, db.litters]) await t.clear();
    const p = await pairing();
    const l = await litter(p, { status: 'expected', whelp_date: null });
    assert.equal((await nudgesFor('pairingended:')).length, 0, 'not while the pairing is still bred');
    await pairingRepo.update(p.id, { status });
    const [n, ...rest] = await nudgesFor('pairingended:');
    assert.equal(rest.length, 0);
    assert.equal(n.key, `pairingended:${l.id}`);
    await n.actions[0].run();
    assert.equal((await litterRepo.getById(l.id)).is_archived, true, status);
    assert.equal((await nudgesFor('pairingended:')).length, 0);
  }
});

test('a pairing marked Whelped with no litter → record it (recent, own dam only)', async () => {
  const p = await pairing({ status: 'whelped' });
  const [n, ...rest] = await nudgesFor('pairingnolitter:');
  assert.equal(rest.length, 0);
  assert.equal(n.key, `pairingnolitter:${p.id}`);
  assert.equal(n.actions[0].label, 'Create litter');

  await pairingRepo.update(p.id, { expected_due_date: daysAgo(400) });
  assert.equal((await nudgesFor('pairingnolitter:')).length, 0, 'a historical pairing doesn\'t flood Today');

  await pairingRepo.update(p.id, { expected_due_date: daysAgo(5) });
  const owner = await contactRepo.create({ name: 'Dana Pike' });
  const outside = await dogRepo.create({ call_name: 'Lulu', sex: 'female', breed: 'Boston Terrier', ownership_type: 'external', owner_contact_id: owner.id, status: 'external_reference' });
  await pairingRepo.update(p.id, { dam_id: outside.id });
  assert.equal((await nudgesFor('pairingnolitter:')).length, 0, 'an outside dam\'s litter isn\'t ours to record');

  await pairingRepo.update(p.id, { dam_id: dam.id });
  const l = await litter(p);
  await litterRepo.archive(l.id);
  assert.equal((await nudgesFor('pairingnolitter:')).length, 0, 'an archived litter still counts as recorded');
});

test('a Deceased dog on an unfinished pairing → cancel it, or mark it failed', async () => {
  const planned = await pairing({ status: 'planned' });
  const bred = await pairing({ status: 'bred' });
  await pairing({ status: 'whelped' });
  assert.equal((await nudgesFor('deceased-')).length, 0, 'nothing while she lives');

  await dogRepo.update(dam.id, { status: 'deceased', date_of_death: daysAgo(1) });
  const byKey = new Map((await nudgesFor('deceased-pairing:')).map((n) => [n.key, n]));
  assert.equal(byKey.size, 2, 'a whelped pairing is finished');
  assert.equal(byKey.get(`deceased-pairing:${planned.id}:${dam.id}`).actions[0].label, 'Cancel pairing');
  assert.equal(byKey.get(`deceased-pairing:${bred.id}:${dam.id}`).actions[0].label, 'Mark failed');
  await byKey.get(`deceased-pairing:${planned.id}:${dam.id}`).actions[0].run();
  await byKey.get(`deceased-pairing:${bred.id}:${dam.id}`).actions[0].run();
  assert.equal((await pairingRepo.getById(planned.id)).status, 'cancelled');
  assert.equal((await pairingRepo.getById(bred.id)).status, 'failed');
  assert.equal((await nudgesFor('deceased-pairing:')).length, 0);
});

test('a Deceased sire: only a Planned pairing, and never a frozen-semen AI', async () => {
  const planned = await pairing({ status: 'planned' });
  await pairing({ status: 'bred' });
  await pairing({ status: 'planned', method: 'ai_frozen' });
  await dogRepo.update(sire.id, { status: 'deceased' });
  const keys = (await nudgesFor('deceased-pairing:')).map((n) => n.key);
  assert.deepEqual(keys, [`deceased-pairing:${planned.id}:${sire.id}`]);
});

test('a Deceased dog with an open sale → open the sale to end it; a delivered one is finished', async () => {
  const buyer = await contactRepo.create({ name: 'Renee Coleman' });
  const pup = await dogRepo.create({ call_name: 'Maple', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'puppy', kennel_id: K.id });
  const open = await saleRepo.create({ kennel_id: K.id, dog_id: pup.id, buyer_contact_id: buyer.id, registration_type: 'limited', status: 'deposit_paid' });
  await saleRepo.create({ kennel_id: K.id, dog_id: dam.id, buyer_contact_id: buyer.id, registration_type: 'limited', status: 'delivered' });
  await dogRepo.update(pup.id, { status: 'deceased' });
  await dogRepo.update(dam.id, { status: 'deceased' });
  const sales = await nudgesFor('deceased-sale:');
  assert.deepEqual(sales.map((n) => n.key), [`deceased-sale:${open.id}`]);
  assert.equal(sales[0].subjectHref, `sale.html?id=${encodeURIComponent(open.id)}`);
});

// --- The litter-lifecycle rules leave a Deceased pup out --------------------------------

const pupOf = (l, over) => dogRepo.create({
  breed: 'Boston Terrier', ownership_type: 'owned', status: 'puppy', kennel_id: K.id, litter_id: l.id, dam_id: dam.id, sire_id: sire.id, ...over
});

test('a Deceased pup (from a row written before disposition was cleared) doesn\'t ask to reopen a sold litter', async () => {
  const l = await litterRepo.create({ kennel_id: K.id, dam_id: dam.id, sire_id: sire.id, status: 'sold' });
  await pupOf(l, { call_name: 'Pip', sex: 'male', disposition: 'placed' });
  const gone = await pupOf(l, { call_name: 'Wren', sex: 'female', disposition: 'available' });
  assert.equal((await nudgesFor('litterreopen:')).length, 1, 'alive and available: reopen');
  // dogRepo nulls a non-puppy's disposition; write past it, as an old restore would.
  await db.dogs.update(gone.id, { status: 'deceased' });
  assert.equal((await nudgesFor('litterreopen:')).length, 0);
});

test('a Deceased pup doesn\'t hold up "mark sold" or "close"', async () => {
  const buyer = await contactRepo.create({ name: 'Renee Coleman' });
  const l = await litterRepo.create({ kennel_id: K.id, dam_id: dam.id, sire_id: sire.id, status: 'ready' });
  const pip = await pupOf(l, { call_name: 'Pip', sex: 'male', disposition: 'placed' });
  const wren = await pupOf(l, { call_name: 'Wren', sex: 'female', status: 'deceased' });
  assert.equal(wren.disposition ?? null, null, 'a dead pup carries no disposition');
  assert.deepEqual((await nudgesFor('littersold:')).map((n) => n.key), [`littersold:${l.id}`]);

  await litterRepo.update(l.id, { status: 'sold' });
  await saleRepo.create({ kennel_id: K.id, dog_id: pip.id, buyer_contact_id: buyer.id, registration_type: 'limited', status: 'delivered' });
  await pupOf(l, { call_name: 'Moss', sex: 'male', disposition: 'placed', status: 'deceased' });
  assert.deepEqual((await nudgesFor('litterclose:')).map((n) => n.key), [`litterclose:${l.id}`], 'a placed pup that died before going home has no delivered sale');
});

test('a litter whose pups all died gets none of the three', async () => {
  const l = await litterRepo.create({ kennel_id: K.id, dam_id: dam.id, sire_id: sire.id, status: 'sold' });
  await pupOf(l, { call_name: 'Wren', sex: 'female', disposition: 'available', status: 'deceased' });
  const keys = (await computeNudges()).map((n) => n.key).filter((k) => /^litter(sold|reopen|close):/.test(k));
  assert.deepEqual(keys, []);
});

// --- A pup that died is offered for archiving ------------------------------------------

const deadPup = (over) => dogRepo.create({
  call_name: 'Wren', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', kennel_id: K.id,
  status: 'deceased', date_of_birth: daysAgo(80), date_of_death: daysAgo(10), ...over
});

test('a pup that died recently → Archive; it leaves the list', async () => {
  const wren = await deadPup();
  const [n, ...rest] = await nudgesFor('deceased-archive:');
  assert.equal(rest.length, 0);
  assert.equal(n.key, `deceased-archive:${wren.id}`);
  assert.equal(n.actions[0].label, 'Archive');
  assert.ok(!n.actions[0].confirm, 'Pro archives straight from the button');
  await n.actions[0].run();
  assert.equal((await dogRepo.getById(wren.id)).is_archived, true);
  assert.equal((await nudgesFor('deceased-archive:')).length, 0);
});

test('not for a dog that died grown, long ago, or with no birth date to go by', async () => {
  await deadPup({ call_name: 'Old', date_of_birth: daysAgo(3 * 365) });
  await deadPup({ call_name: 'Long ago', date_of_birth: daysAgo(300), date_of_death: daysAgo(200) });
  await deadPup({ call_name: 'Unknown', date_of_birth: null });
  assert.equal((await nudgesFor('deceased-archive:')).length, 0);
});

test('no birth date: the litter\'s whelp date stands in', async () => {
  const l = await litterRepo.create({ kennel_id: K.id, dam_id: dam.id, sire_id: sire.id, status: 'ready', whelp_date: daysAgo(60) });
  const wren = await deadPup({ date_of_birth: null, litter_id: l.id, dam_id: dam.id, sire_id: sire.id });
  assert.deepEqual((await nudgesFor('deceased-archive:')).map((n) => n.key), [`deceased-archive:${wren.id}`]);
});

test('the dog page offers it whenever she has just moved a Puppy to Deceased', async () => {
  const wren = await deadPup({ date_of_birth: null, date_of_death: null });
  const list = (wasPuppy) => deceasedDogNudges([wren], { pairings: [], sales: [], dogsById: new Map(), wasPuppy }).map((n) => n.key);
  assert.deepEqual(list(false), []);
  assert.deepEqual(list(true), [`deceased-archive:${wren.id}`]);
});

test('an archived pup that died still shows its open sale', async () => {
  const buyer = await contactRepo.create({ name: 'Renee Coleman' });
  const wren = await deadPup();
  const open = await saleRepo.create({ kennel_id: K.id, dog_id: wren.id, buyer_contact_id: buyer.id, registration_type: 'limited', status: 'deposit_paid' });
  await dogRepo.archive(wren.id);
  assert.deepEqual((await nudgesFor('deceased-')).map((n) => n.key), [`deceased-sale:${open.id}`]);
});

test('Lite: the permanent "remove from program" departure, which asks first', async () => {
  const wren = await deadPup();
  editionFlags.manualDogArchive = false;
  try {
    const a = deceasedArchiveAction(wren);
    assert.equal(a.label, 'Remove from program');
    assert.equal(a.confirm, true);
    assert.equal(a.ask.confirmLabel, 'Remove permanently');
    assert.equal(a.ask.danger, true);
  } finally {
    editionFlags.manualDogArchive = true;
  }
});

// --- Due soon: create the litter ahead of the whelp ----------------------------------

const daysAhead = (n) => daysAgo(-n);

test('a bred pairing due within 3 days with no litter → create the litter', async () => {
  for (const [n, word] of [[0, 'today'], [1, 'tomorrow'], [3, 'in 3 days']]) {
    await db.pairings.clear();
    const p = await pairing({ status: 'confirmed_pregnant', expected_due_date: daysAhead(n) });
    const [x, ...rest] = await nudgesFor('pairingduesoon:');
    assert.equal(rest.length, 0);
    assert.equal(x.key, `pairingduesoon:${p.id}`);
    assert.equal(x.actions[0].label, 'Create litter');
    assert.match(x.title, new RegExp(`is due ${word} — create the litter\\?$`));
  }
});

test('not too early, not once overdue (that rule takes over), not Planned, not with a litter', async () => {
  await pairing({ expected_due_date: daysAhead(4) });
  const overdue = await pairing({ expected_due_date: daysAgo(1) });
  await pairing({ status: 'planned', expected_due_date: daysAhead(2) });
  const withLitter = await pairing({ expected_due_date: daysAhead(2) });
  await litter(withLitter, { status: 'expected', whelp_date: null });
  assert.equal((await nudgesFor('pairingduesoon:')).length, 0);
  assert.deepEqual((await nudgesFor('pairingoverdue:')).map((n) => n.key), [`pairingoverdue:${overdue.id}`]);
});
