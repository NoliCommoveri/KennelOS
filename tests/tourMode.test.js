// tourMode.test.js — the guided tour's sample data can't outlive the tour (Load
// Performance plan Phase 2, D1–D5): the tour is read-only, its seed is cleared by
// itself outside its own session, an old seed's links are detached, a restore
// clears the seed first, and archived leftovers are found by the seed's names.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, settings, demo, sample, dogRepo, kennelRepo, fileRepo, ie, T, stripe, kp, expenseRepo, studServiceRepo;

function sessionStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}

before(async () => {
  ({ tables } = await installMemoryDb());
  settings = await import('../shared/data/settings.js');
  demo = await import('../shared/data/demoMode.js');
  sample = await import('../shared/data/sampleData.js');
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ fileRepo } = await import('../shared/data/fileRepo.js'));
  ({ expenseRepo } = await import('../shared/data/expenseRepo.js'));
  ({ studServiceRepo } = await import('../shared/data/studServiceRepo.js'));
  ie = await import('../shared/data/importExport.js');
  T = await import('../shared/data/tidyRules.js');
  stripe = await import('../shared/data/stripeKeyStore.js');
  kp = await import('../shared/data/kennelportLink.js');
});

beforeEach(async () => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
  globalThis.sessionStorage = sessionStore();
  await sample.seedSampleData(); // the test runs the seed directly, as the seed window would
});

const now = '2026-11-18T10:00:00.000Z';
const row = (id, extra) => ({ id, is_archived: false, created_at: now, updated_at: now, ...extra });

test('while the seed is loaded every write is refused with the tour\'s own words; the seed window lets it through', async () => {
  assert.equal(demo.isTourMode(), true);
  assert.equal(demo.isReadOnly(), true);
  await assert.rejects(() => kennelRepo.create({ kennel_name: 'Mine', is_own_kennel: true }), (e) => e instanceof demo.TourModeError && e instanceof demo.DemoModeError && /tour's sample kennel/.test(e.message));
  const dog = [...tables.dogs.rows.values()][0];
  await assert.rejects(() => dogRepo.update(dog.id, { notes: 'x' }), demo.TourModeError);
  await assert.rejects(() => dogRepo.hardDelete(dog.id), demo.TourModeError);
  await assert.rejects(() => fileRepo.create(new Blob(['%PDF'], { type: 'application/pdf' })), demo.TourModeError);
  const k = await demo.withSeedAllowed(() => kennelRepo.create({ kennel_name: 'Mine', is_own_kennel: true }));
  assert.ok(k.id);
  settings.removeSampleDataManifest();
  assert.equal(demo.isTourMode(), false);
  await dogRepo.update(dog.id, { notes: 'x' }); // her own records again: writable
});

test('outside actions on the sample kennel are refused too: linking a website, connecting Stripe', async () => {
  const thornfield = await kennelRepo.getById(sample.getSampleDataManifest().kennels[0]);
  await assert.rejects(() => kp.connectWebsite(thornfield, 'CODE', 'Phone'), demo.TourModeError);
  await assert.rejects(() => stripe.setStripeKey('acct', { api_key: 'rk_test', currency: 'usd' }), demo.TourModeError);
});

test('the one-time migrations wait until the seed is gone', async () => {
  const ev = [...tables.events.rows.values()][0];
  tables.events.rows.set(ev.id, { ...ev, cost: 25 });
  await expenseRepo.migrateEventCosts();
  assert.equal(settings.getExpensesMigrated(), false, 'not run over the sample');
  await studServiceRepo.migrateStudTrips();
  assert.equal(settings.getStudTripsMigrated(), false);
});

test('the seed lives only while the tour is active, in the session that seeded it (D2)', () => {
  const seededAt = sample.getSampleDataManifest().seededAt;
  settings.setWizardStatusRaw('active');
  assert.equal(settings.tourSeedExpired(), true, 'not marked in this session: clear');
  settings.markTourSeededThisSession(seededAt);
  assert.equal(settings.tourSeedExpired(), false, 'active, this session: keep');
  settings.setWizardStatusRaw('dismissed');
  assert.equal(settings.tourSeedExpired(), true, 'skipped or left: clear');
  settings.setWizardStatusRaw('active');
  globalThis.sessionStorage = sessionStore(); // the tab was closed; a new one opened
  assert.equal(settings.tourSeedExpired(), true, 'another session: clear');
  settings.removeSampleDataManifest();
  assert.equal(settings.tourSeedExpired(), false, 'no seed: nothing to clear');
});

test('a clean seed clears completely, and nothing points at anything gone', async () => {
  settings.setNavKennels({ name: null, own: [{ id: 'x', kennel_name: 'Thornfield Kennels' }] });
  const res = await sample.clearSampleData();
  assert.equal(res.cleared, true);
  assert.deepEqual(res.detached, []);
  for (const [name, t] of Object.entries(tables)) if (!['device_secrets', 'sync_meta', 'sync_lost', 'files'].includes(name)) assert.equal(t.rows.size, 0, `${name} emptied`);
  assert.equal(settings.getSampleDataManifest(), null);
  assert.equal(settings.wasSampleDataCleared(), true, 'the kennel-setup gate comes next');
  assert.equal(settings.getNavKennels(), null, 'the nav forgets the sample kennel');
});

// An old seed, from before the tour was read-only: her own records point at it.
function contaminate() {
  const m = sample.getSampleDataManifest();
  const thornfield = m.kennels[0];
  const sampleDog = tables.dogs.rows.get(m.dogs[0]);
  const sampleContact = m.contacts[0];
  tables.dogs.rows.set('real-dog', row('real-dog', { call_name: 'Real', ownership_type: 'owned', status: 'active_breeding', kennel_id: thornfield, sire_id: sampleDog.id, co_owner_contact_ids: [sampleContact, 'someone-real'] }));
  tables.litters.rows.set('real-litter', row('real-litter', { dam_id: sampleDog.id, sire_id: 'real-dog', kennel_id: thornfield }));
  tables.sales.rows.set('real-sale', row('real-sale', { dog_id: 'real-dog', buyer_contact_id: sampleContact, kennel_id: thornfield, payments: [{ id: 'p', amount: 5, account_id: m.accounts?.[0] || 'none' }] }));
  tables.events.rows.set('real-event', row('real-event', { subject_type: 'dog', subject_id: sampleDog.id, event_type: 'vet_visit', event_date: '2026-11-01', title: 'Checkup' }));
  return { thornfield, sampleDog, sampleContact };
}

test('an old seed with no kennel of her own waits for one, changing nothing (D4)', async () => {
  contaminate();
  const sizes = Object.fromEntries(Object.entries(tables).map(([n, t]) => [n, t.rows.size]));
  const res = await sample.clearSampleData();
  assert.equal(res.cleared, false);
  assert.equal(res.reason, 'needs-kennel');
  assert.deepEqual(Object.fromEntries(Object.entries(tables).map(([n, t]) => [n, t.rows.size])), sizes, 'nothing removed yet');
  assert.ok(settings.getSampleDataManifest(), 'the seed is still known');
});

test('an old seed is removed whole: kennel links move to her kennel, other links clear, and the notice says so (D4)', async () => {
  const { sampleDog } = contaminate();
  tables.kennels.rows.set('mine', row('mine', { kennel_name: 'Oak Hill', is_own_kennel: true, created_at: '2026-11-17T00:00:00.000Z' }));
  const res = await sample.clearSampleData();
  assert.equal(res.cleared, true);
  // Every sample record is gone; hers stay.
  assert.equal(tables.dogs.rows.has(sampleDog.id), false);
  assert.ok(tables.dogs.rows.has('real-dog') && tables.litters.rows.has('real-litter') && tables.sales.rows.has('real-sale') && tables.events.rows.has('real-event'));
  const dog = tables.dogs.rows.get('real-dog');
  assert.equal(dog.kennel_id, 'mine', 'filed under her kennel now');
  assert.equal(dog.sire_id, null, 'the sample sire is cleared');
  assert.deepEqual(dog.co_owner_contact_ids, ['someone-real'], 'only the sample contact leaves the list');
  assert.equal(tables.litters.rows.get('real-litter').dam_id, null);
  assert.equal(tables.litters.rows.get('real-litter').kennel_id, 'mine');
  assert.equal(tables.sales.rows.get('real-sale').buyer_contact_id, null, 'a sample buyer is cleared (contacts were never checked before)');
  assert.equal(tables.events.rows.get('real-event').subject_id, null, 'her event stays, about nothing');
  assert.ok(res.detached.includes('Real: moved from Thornfield Kennels (from the tour; kennel of a dog) to Oak Hill.'), res.detached.join('\n'));
  assert.ok(res.detached.some((l) => /^a sale of Real: its link to .+ \(from the tour; buyer on a sale\) is cleared\.$/.test(l)), res.detached.join('\n'));
  assert.ok(settings.getCloudDirtyAt(), 'her changed records go to the cloud');
  // Nothing anywhere still names the removed sample dog.
  for (const t of Object.values(tables)) for (const r of t.rows.values()) assert.ok(!JSON.stringify(r).includes(`"${sampleDog.id}"`), `${r.id} still names a sample dog`);
});

test('a restore during the tour clears the seed first, then goes ahead', async () => {
  const file = { schema_version: 1, collections: { kennels: [row('k-real', { kennel_name: 'Mine', is_own_kennel: true })] } };
  await ie.restoreBackup(file, 'merge');
  assert.equal(settings.getSampleDataManifest(), null);
  assert.deepEqual([...tables.kennels.rows.keys()], ['k-real']);
  assert.equal(tables.dogs.rows.size, 0);
});

test('Tidy up finds archived leftovers by the seed\'s names, and only archived ones (D5)', () => {
  const kennels = [
    row('t', { kennel_name: 'Thornfield Kennels', is_archived: true }),
    row('mine', { kennel_name: 'Oak Hill', is_own_kennel: true }),
    row('live-thorn', { kennel_name: 'Thornfield Kennels', is_archived: false })
  ];
  const dogs = [
    row('j', { call_name: 'Juniper', kennel_id: 't', is_archived: true }),
    row('j2', { call_name: 'Juniper', kennel_id: 'mine', is_archived: true }), // hers, archived: not tied to the seed
    row('reg', { call_name: 'Ivy', registered_name: 'Thornfield Wild Ivy', kennel_id: 'mine', is_archived: true }),
    row('live', { call_name: 'Willow', kennel_id: 't', is_archived: false })
  ];
  const contacts = [
    row('c1', { name: 'Dana Ruiz', phone: '555-0102', is_archived: true }),
    row('c2', { name: 'Dana Ruiz', phone: '802-555-1234', is_archived: true }) // a real Dana
  ];
  const litters = [row('l', { sire_id: 'reg', dam_id: 'j', is_archived: true }), row('l2', { sire_id: 'live', dam_id: 'j', is_archived: true })];
  const [f] = T.tourLeftoverFindings({ kennels, dogs, contacts, litters, pairings: [] });
  assert.equal(f.kind, 'tour-leftovers');
  assert.deepEqual(f.kennels.map((r) => r.id), ['t']);
  assert.deepEqual(f.dogs.map((r) => r.id).sort(), ['j', 'reg']);
  assert.deepEqual(f.contacts.map((r) => r.id), ['c1']);
  assert.deepEqual(f.litters.map((r) => r.id), ['l'], 'a litter goes only when both parents do');
  assert.deepEqual(T.tourLeftoverFindings({ kennels: [kennels[1]], dogs: [], contacts: [] }), []);
});
