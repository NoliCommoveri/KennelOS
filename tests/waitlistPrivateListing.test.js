// waitlistPrivateListing.test.js — a family asks on the application to list
// privately on the public list ("A***** K", Waitlist Spec §15.3), and she answers
// in the Approve step, through the real actions and repos on the in-memory database.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let waitlistEntryRepo; let actions;
const DAY = '2026-10-08';
let K;

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js'));
  actions = await import('../shared/data/waitlistActions.js');
});

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, waitlist_config: { fee_amount: 100 } });
});

const applied = (extra = {}) => waitlistEntryRepo.create({
  kennel_id: K.id, status: 'applied', applied_date: DAY, application: { name: 'Andrea Kim', email: 'a@example.com' }, ...extra
});

test('approving answers their request: yes lists them privately, no keeps "Andrea K."', async () => {
  const yes = await applied({ private_request: { requested_date: DAY } });
  await actions.approve(yes.id, { date: DAY, privateListing: true });
  const y = await waitlistEntryRepo.getById(yes.id);
  assert.equal(y.status, 'approved');
  assert.equal(y.private_listing, true);
  assert.deepEqual(y.private_request, { requested_date: DAY, decided: 'approved', decided_date: DAY });

  const no = await applied({ private_request: { requested_date: DAY } });
  await actions.approve(no.id, { date: DAY, privateListing: false });
  const n = await waitlistEntryRepo.getById(no.id);
  assert.equal(n.private_listing, false);
  assert.equal(n.private_request.decided, 'declined');
});

test('without a request the answer is ignored; without an answer the request waits', async () => {
  const none = await applied();
  await actions.approve(none.id, { date: DAY, privateListing: true });
  assert.equal((await waitlistEntryRepo.getById(none.id)).private_listing, undefined);

  const asked = await applied({ private_request: { requested_date: DAY } });
  await actions.approve(asked.id, { date: DAY });
  const a = await waitlistEntryRepo.getById(asked.id);
  assert.equal(a.private_listing, undefined);
  assert.equal(actions.hasPendingRequest(a, 'private_request'), true);
});
