// fureverPickup.test.js — the FurEver seed packet's pickup plan follows the pup's
// Placement / drop-off event (decided 2026-10-15): which event counts
// (fureverSeedExport.pickupEventFor), what the plan carries from it and from the
// Sale (pickupPlanFor), and the packet buildSeedPacket actually builds.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let fx; let dogRepo; let eventRepo; let kennelRepo;

before(async () => {
  await installMemoryDb();
  fx = await import('../shared/data/fureverSeedExport.js');
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ eventRepo } = await import('../shared/data/eventRepo.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
});

const TODAY = '2026-10-15';
const drop = (id, event_date, extra = {}) => ({ id, event_type: 'placement', subject_type: 'dog', subject_id: 'p1', event_date, details: {}, ...extra });
const sale = { buyer_contact_id: 'buyer', furever_pickup_date: '2026-10-01', furever_pickup_time: '9 AM', furever_pickup_place: 'Old place', furever_pickup_photo_url: 'https://x/p.jpg' };

test('the soonest drop-off from today on wins', () => {
  const evs = [drop('a', '2026-10-01'), drop('b', '2026-10-30'), drop('c', '2026-10-20'), drop('d', TODAY)];
  assert.equal(fx.pickupEventFor(sale, evs, TODAY).id, 'd');
  assert.equal(fx.pickupEventFor(sale, evs.filter((e) => e.id !== 'd'), TODAY).id, 'c');
});

test('with only past drop-offs, the latest one', () => {
  assert.equal(fx.pickupEventFor(sale, [drop('a', '2026-09-01'), drop('b', '2026-10-10')], TODAY).id, 'b');
});

test('archived, other types, undated and another buyer\'s drop-offs are skipped', () => {
  const evs = [
    drop('arch', '2026-10-20', { is_archived: true }),
    drop('other', '2026-10-21', { related_contact_id: 'someone-else' }),
    drop('nodate', ''),
    { id: 'vet', event_type: 'vet_visit', event_date: '2026-10-16' }
  ];
  assert.equal(fx.pickupEventFor(sale, evs, TODAY), null);
  assert.equal(fx.pickupEventFor(sale, [...evs, drop('mine', '2026-10-25', { related_contact_id: 'buyer' })], TODAY).id, 'mine');
  assert.equal(fx.pickupEventFor(sale, [...evs, drop('none', '2026-10-25')], TODAY).id, 'none');
});

test('the plan is the event\'s date, drop-off time and location; the photo stays the Sale\'s', () => {
  const ev = drop('a', '2026-10-20', { details: { placement_time: ' 2:00 PM ', location: 'Our farm', dropoff_method: 'Local pickup' } });
  assert.deepEqual(fx.pickupPlanFor(sale, ev), { photoUrl: 'https://x/p.jpg', date: '2026-10-20', time: '2:00 PM', place: 'Our farm' });
  // An event without a time or place leaves them blank, not the stale typed ones.
  assert.deepEqual(fx.pickupPlanFor(sale, drop('b', '2026-10-21')), { photoUrl: 'https://x/p.jpg', date: '2026-10-21', time: '', place: '' });
});

test('with no drop-off event, the Sale\'s typed fields are the plan', () => {
  assert.deepEqual(fx.pickupPlanFor(sale, null), { photoUrl: 'https://x/p.jpg', date: '2026-10-01', time: '9 AM', place: 'Old place' });
  assert.deepEqual(fx.pickupPlanFor(null, null), { photoUrl: '', date: '', time: '', place: '' });
});

test('buildSeedPacket sends the pup\'s drop-off event', async () => {
  const K = await kennelRepo.create({ kennel_name: 'Briar Hollow', is_own_kennel: true });
  const pup = await dogRepo.create({ call_name: 'Maple', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'puppy', kennel_id: K.id });
  const s = { ...sale, dog_id: pup.id };
  assert.equal((await fx.buildSeedPacket(pup, s)).pickupPlan.place, 'Old place');
  await eventRepo.create({
    subject_type: 'dog', subject_id: pup.id, event_type: 'placement', event_date: '2099-01-02',
    related_contact_id: 'buyer', title: 'Puppy pickup', details: { placement_time: '10 AM', location: 'Kennel' }
  });
  assert.deepEqual((await fx.buildSeedPacket(pup, s)).pickupPlan, { photoUrl: 'https://x/p.jpg', date: '2099-01-02', time: '10 AM', place: 'Kennel' });
});
