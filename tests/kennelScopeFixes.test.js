// kennelScopeFixes.test.js — review fix step 10's multi-kennel half (K14 review):
// a kennel in use can't stop being her own (K14-6), the one money-total rule for
// expenses (K14-11), the prospective Companion bundle follows one kennel (K14-2),
// what a Dog Card may send (K14-8, K14-15), majors with no judge (K14-12) and the
// href check (K14-17).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { expenseInScopeOf, isUnplacedExpenseOf } from '../shared/data/scopePredicates.js';
import { trackProgress } from '../shared/data/showPoints.js';
import { TITLE_TRACKS } from '../shared/data/vocab.js';

let tables, kennelRepo, dogRepo, settings, companion, C, ui;

before(async () => {
  ({ tables } = await installMemoryDb());
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  settings = await import('../shared/data/settings.js');
  companion = await import('../shared/data/companionExport.js');
  C = await import('../shared/data/dogCard.js');
  ui = await import('../shared/data/safeHref.js');
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
});

const BREED = 'Golden Retriever';
const owned = (k, over = {}) => ({ sex: 'female', breed: BREED, ownership_type: 'owned', status: 'active_breeding', kennel_id: k.id, ...over });

// --- K14-6 -----------------------------------------------------------------------

test('a kennel with her dogs on it cannot be unticked as her own', async () => {
  const k = await kennelRepo.create({ kennel_name: 'Briar Hollow', is_own_kennel: true });
  await dogRepo.create(owned(k, { call_name: 'Rose' }));
  await assert.rejects(kennelRepo.update(k.id, { is_own_kennel: false }), /Briar Hollow.*1 dog.*archive the kennel instead/);
  assert.equal((await kennelRepo.getById(k.id)).is_own_kennel, true);
  // Other edits still save.
  await kennelRepo.update(k.id, { kennel_name: 'Briar Hollow Kennels', is_own_kennel: true });
});

test('an own kennel nothing is filed under can be unticked', async () => {
  const k = await kennelRepo.create({ kennel_name: 'Spare', is_own_kennel: true });
  const updated = await kennelRepo.update(k.id, { is_own_kennel: false });
  assert.equal(updated.is_own_kennel, false);
});

test('holds count each kind, and an outside dog living there does not hold it', async () => {
  const k = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true });
  await dogRepo.create(owned(k, { call_name: 'A' }));
  await dogRepo.create(owned(k, { call_name: 'B', sex: 'male' }));
  tables.dogs.rows.set('ext', { id: 'ext', ownership_type: 'external', kennel_id: k.id, is_archived: false });
  tables.litters.rows.set('l1', { id: 'l1', kennel_id: k.id, is_archived: true });
  const mod = await import('../shared/data/kennelRepo.js');
  const found = await mod.ownKennelHolds(k.id);
  assert.deepEqual(found, [{ label: 'dog', count: 2 }, { label: 'litter', count: 1 }]);
  assert.equal(mod.holdsSentence([{ label: 'waitlist entry', count: 2 }, { label: 'sale', count: 1 }]), '2 waitlist entries, 1 sale');
});

// --- K14-11 ----------------------------------------------------------------------

const A = 'kA';
const B = 'kB';
const maps = {
  dog: new Map([['own', { id: 'own', ownership_type: 'owned', kennel_id: A }], ['stud', { id: 'stud', ownership_type: 'external', kennel_id: 'outside' }]]),
  litter: new Map(),
  pairing: new Map(),
  stud_service: new Map([['ss', { id: 'ss', kennel_id: A }]])
};

test('an outside dog’s cost tied to a stud service counts only under that kennel', () => {
  const x = { subject_type: 'dog', subject_id: 'stud', stud_service_id: 'ss' };
  assert.equal(expenseInScopeOf(A, x, maps), true);
  assert.equal(expenseInScopeOf(B, x, maps), false);
  assert.equal(expenseInScopeOf(null, x, maps), true);
  assert.equal(isUnplacedExpenseOf(x, maps), false);
});

test('an outside dog’s cost with nothing to place it counts only under All kennels', () => {
  const x = { subject_type: 'dog', subject_id: 'stud' };
  assert.equal(expenseInScopeOf(A, x, maps), false);
  assert.equal(expenseInScopeOf(B, x, maps), false);
  assert.equal(expenseInScopeOf(null, x, maps), true);
  assert.equal(isUnplacedExpenseOf(x, maps), true);
});

test('her own dog’s cost and kennel overhead follow the subject as before', () => {
  assert.equal(expenseInScopeOf(A, { subject_type: 'dog', subject_id: 'own' }, maps), true);
  assert.equal(expenseInScopeOf(B, { subject_type: 'dog', subject_id: 'own' }, maps), false);
  assert.equal(expenseInScopeOf(B, { subject_type: 'kennel', subject_id: B }, maps), true);
  // An unresolvable subject is still shown rather than dropped.
  assert.equal(expenseInScopeOf(B, { subject_type: 'dog', subject_id: 'gone' }, maps), true);
  assert.equal(isUnplacedExpenseOf({ subject_type: 'dog', subject_id: 'own' }, maps), false);
});

// --- K14-2 -----------------------------------------------------------------------

async function twoKennelsWithPups() {
  const t = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true });
  const b = await kennelRepo.create({ kennel_name: 'Briar Hollow', is_own_kennel: true });
  const tl = { id: 'tl', kennel_id: t.id, status: 'ready', whelp_date: '2026-09-01', is_archived: false };
  const bl = { id: 'bl', kennel_id: b.id, status: 'ready', whelp_date: '2026-09-02', is_archived: false };
  tables.litters.rows.set(tl.id, tl);
  tables.litters.rows.set(bl.id, bl);
  await dogRepo.create(owned(t, { call_name: 'Goldie', status: 'puppy', disposition: 'available', litter_id: tl.id }));
  await dogRepo.create(owned(b, { call_name: 'Curly', status: 'puppy', disposition: 'available', litter_id: bl.id, breed: 'Poodle' }));
  return { t, b, tl, bl };
}

test('the prospective bundle holds only the active kennel’s pups', async () => {
  const { t, tl } = await twoKennelsWithPups();
  settings.setActiveKennelId(t.id);
  const bundle = await companion.buildProspectiveBundle({ name: 'Family' });
  assert.equal(bundle.litters.length, 1);
  assert.deepEqual(bundle.litters[0].pups.map((p) => p.callName), ['Goldie']);
  assert.ok(tl);
});

test('the guided litter flow’s kennel wins over the active one', async () => {
  const { t, b } = await twoKennelsWithPups();
  settings.setActiveKennelId(t.id);
  const bundle = await companion.buildProspectiveBundle({ name: 'Family' }, { kennelId: b.id });
  assert.deepEqual(bundle.litters.flatMap((l) => l.pups.map((p) => p.callName)), ['Curly']);
});

test('under All kennels with pups at two kennels it asks which kennel first', async () => {
  await twoKennelsWithPups();
  await assert.rejects(companion.buildProspectiveBundle({ name: 'Family' }), /more than one of your kennels/);
});

// --- K14-8, K14-15 ------------------------------------------------------------------

test('a card sends only the Send-from kennel’s own dogs', () => {
  assert.equal(C.canSendFrom({ ownership_type: 'owned', kennel_id: A }, A), true);
  assert.equal(C.canSendFrom({ ownership_type: 'co_owned', kennel_id: A }, A), true);
  assert.equal(C.canSendFrom({ ownership_type: 'owned', kennel_id: B }, A), false, 'another own kennel');
  assert.equal(C.canSendFrom({ ownership_type: 'external', kennel_id: 'x' }, A), false, 'an outside stud');
  assert.equal(C.canSendFrom({ ownership_type: 'leased_in', kennel_id: A }, A), false);
  assert.equal(C.canSendFrom({ ownership_type: 'owned', kennel_id: A, pedigree_only: true }, A), false);
});

test('building a card refuses an outside dog, and it still rides as an ancestor', async () => {
  const k = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true });
  const { contactRepo } = await import('../shared/data/contactRepo.js');
  const owner = await contactRepo.create({ name: 'Other Breeder' });
  const stud = await dogRepo.create({ call_name: 'Outside Stud', sex: 'male', breed: BREED, ownership_type: 'external', owner_contact_id: owner.id, status: 'active_breeding' });
  await assert.rejects(C.buildDogCard({ fromKennelId: k.id, dogIds: [stud.id] }), /can’t be sent from there/);
  const pup = await dogRepo.create(owned(k, { call_name: 'Kid', sire_id: stud.id }));
  const card = await C.buildDogCard({ fromKennelId: k.id, dogIds: [pup.id] });
  assert.deepEqual(card.dogs.map((d) => [d.callName, d.sent]), [['Kid', true], ['Outside Stud', false]]);
});

test('a microchip goes only for a sent dog still in her program', async () => {
  const k = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true });
  const dam = await dogRepo.create(owned(k, { call_name: 'Dam', microchip_id: '111' }));
  const kid = await dogRepo.create(owned(k, { call_name: 'Kid', dam_id: dam.id, microchip_id: '222' }));
  const placed = await dogRepo.create(owned(k, { call_name: 'Pet', status: 'pet_home', microchip_id: '333' }));
  const card = await C.buildDogCard({ fromKennelId: k.id, dogIds: [kid.id, placed.id] });
  const chip = Object.fromEntries(card.dogs.map((d) => [d.callName, d.microchipId]));
  assert.deepEqual(chip, { Kid: '222', Pet: '', Dam: '' });
  assert.equal(C.sendsMicrochip({ status: 'puppy', disposition: 'placed' }, true), false);
});

// --- K14-12 ----------------------------------------------------------------------

test('two majors with no judge typed ask for the judges, not two more majors', () => {
  const CH = TITLE_TRACKS.find((t) => t.value === 'akc_ch');
  const ev = (date, points, judge) => ({ id: date, event_type: 'show', event_date: date, is_archived: false, details: { entry_status: 'shown', points_toward: 'akc_ch', points, judge } });
  const p = trackProgress([
    ev('2026-01-03', 3, ''), ev('2026-01-10', 4, ''),
    ev('2026-01-17', 3, 'Judge A'), ev('2026-01-24', 3, 'Judge B'), ev('2026-01-31', 2, 'Judge C')
  ], CH);
  assert.equal(p.majors, 4);
  assert.ok(!p.missing.some((m) => /majors? under/.test(m)), JSON.stringify(p.missing));
  const q = trackProgress([ev('2026-01-03', 3, ''), ev('2026-01-10', 4, ''), ev('2026-01-17', 2, 'Judge C'), ev('2026-01-24', 1, 'Judge D')], CH);
  assert.ok(q.missing.includes('the judge on 2 majors, so they can be checked'), JSON.stringify(q.missing));
  assert.equal(q.complete, false);
});

// --- K14-17 ----------------------------------------------------------------------

test('safeHref keeps http(s) and mailto, and drops other schemes', () => {
  assert.equal(ui.safeHref('https://example.com/a'), 'https://example.com/a');
  assert.equal(ui.safeHref('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(ui.safeHref('javascript:alert(1)'), '#');
  assert.equal(ui.safeHref(' JavaScript:alert(1)'), '#');
  assert.equal(ui.safeHref('data:text/html,x'), '#');
  assert.equal(ui.safeHref('www.example.com'), 'https://www.example.com');
  assert.equal(ui.safeHref(''), '#');
});
