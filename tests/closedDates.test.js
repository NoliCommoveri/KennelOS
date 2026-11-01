// closedDates.test.js — her waitlist closed (blackout) dates drop off by themselves a
// week after they pass (waitlistActions.tidyClosedDates, run when the app loads).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let kennelRepo;
let actions;
before(async () => {
  await installMemoryDb();
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  actions = await import('../shared/data/waitlistActions.js');
});

test('closed dates more than 7 days past are removed; the rest, and kennels without a list, are left alone', async () => {
  const mine = await kennelRepo.create({ kennel_name: 'Test Boston', is_own_kennel: true,
    waitlist_config: { respond_days: 3, closed_dates: ['2026-10-01', '2026-10-25', '2026-11-26'] } });
  const plain = await kennelRepo.create({ kennel_name: 'No list', is_own_kennel: true, waitlist_config: { respond_days: 3 } });
  assert.equal(await actions.tidyClosedDates('2026-11-01'), 1);
  const after = await kennelRepo.getById(mine.id);
  assert.deepEqual(after.waitlist_config.closed_dates, ['2026-10-25', '2026-11-26'], '10-01 is a month past; 10-25 only a week');
  assert.equal(after.waitlist_config.respond_days, 3, 'the rest of her settings untouched');
  assert.equal((await kennelRepo.getById(plain.id)).waitlist_config.closed_dates, undefined);
  assert.equal(await actions.tidyClosedDates('2026-11-01'), 0, 'nothing left to tidy');
});
