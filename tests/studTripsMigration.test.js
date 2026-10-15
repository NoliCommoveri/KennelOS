// studTripsMigration.test.js — studServiceRepo.migrateStudTrips: a direction from
// before it meant who travels is read as one, and every in-person stud service's
// trip becomes a boarding event, once, never twice.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let studServiceRepo; let eventRepo; let kennelRepo; let dogRepo; let contactRepo;
before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ studServiceRepo } = await import('../shared/data/studServiceRepo.js'));
  ({ eventRepo } = await import('../shared/data/eventRepo.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
});

test('old directions become who travels; in-person trips become boarding events, once', async () => {
  const K = await kennelRepo.create({ kennel_name: 'Briar Hollow', is_own_kennel: true });
  const owner = await contactRepo.create({ name: 'Ellen Brooks', address: '12 Oak St\nBurlington, VT' });
  const stud = await dogRepo.create({ call_name: 'Birch', sex: 'male', breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id });
  const dam = await dogRepo.create({ call_name: 'Nell', sex: 'female', breed: 'Boston Terrier', ownership_type: 'external', status: 'external_reference', owner_contact_id: owner.id });
  const base = { kennel_id: K.id, our_dog_id: stud.id, partner_dog_id: dam.id, partner_contact_id: owner.id, status: 'completed' };
  await db.stud_services.add({ id: 'trip', ...base, direction: 'outgoing', type: 'in_person', sent_date: '2026-09-01', returned_date: '2026-09-04' });
  await db.stud_services.add({ id: 'ai', ...base, direction: 'incoming', type: 'ai', sent_date: '2026-08-01' });
  await db.stud_services.add({ id: 'off', ...base, direction: 'to_us', type: 'in_person', status: 'cancelled', sent_date: '2026-07-01' });

  await studServiceRepo.migrateStudTrips();
  assert.equal((await studServiceRepo.getById('trip')).direction, 'to_partner');
  assert.equal((await studServiceRepo.getById('ai')).direction, 'shipped');
  const boarding = (await eventRepo.getAll()).filter((e) => e.event_type === 'boarding');
  assert.equal(boarding.length, 1, 'only the in-person, not-cancelled trip');
  assert.deepEqual([boarding[0].subject_id, boarding[0].event_date, boarding[0].event_end_date, boarding[0].details.boarding_reason, boarding[0].details.location],
    [stud.id, '2026-09-01', '2026-09-04', 'Stud service', '12 Oak St, Burlington, VT']);

  // A second run (Reset App cleared the flag, say) finds the trip already boarded.
  localStorage.removeItem('kennelOS.studTripsMigrated');
  await studServiceRepo.migrateStudTrips();
  assert.equal((await eventRepo.getAll()).filter((e) => e.event_type === 'boarding').length, 1);
});
