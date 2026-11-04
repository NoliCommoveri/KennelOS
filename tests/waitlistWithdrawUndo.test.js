// waitlistWithdrawUndo.test.js — the 7-day undo on a withdrawal she entered
// ("They withdrew" on the family's page), through the real actions and repos on
// the in-memory database: back to the status they left at their old place, only
// for her own entry (not one from the family's status page), only within 7 days,
// and never once the family has re-applied.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let contactRepo; let waitlistEntryRepo; let actions; let rules;
let K; let entryId; let approvedId;

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js'));
  actions = await import('../shared/data/waitlistActions.js');
  rules = await import('../shared/data/waitlistRules.js');
});

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, waitlist_config: { max_passes: 2, respond_days: 3 } });
  const c = await contactRepo.create({ name: 'Lee', email: 'lee@example.com' });
  entryId = (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'active', approved_date: '2026-01-01', fee_received_date: '2026-01-05', position_anchor_date: '2026-01-03', pref_sex: 'any' })).id;
  const c2 = await contactRepo.create({ name: 'Kim', email: 'kim@example.com' });
  approvedId = (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c2.id, status: 'approved', approved_date: '2026-10-01', pref_sex: 'any' })).id;
});

test('a withdrawal she entered can be undone for 7 days, back to the same status and place', async () => {
  await actions.withdraw(entryId, { date: '2026-11-01', byBreeder: true });
  const w = await waitlistEntryRepo.getById(entryId);
  assert.equal(w.status, 'withdrawn');
  assert.equal(w.withdrawn_from, 'active');
  assert.equal(rules.canUndoWithdrawal(w, '2026-11-08'), true, 'day 7: still');
  assert.equal(rules.canUndoWithdrawal(w, '2026-11-09'), false, 'day 8: gone');

  const back = await actions.undoWithdrawal(entryId, { today: '2026-11-04' });
  assert.equal(back.status, 'active');
  assert.equal(back.withdrawn_date, null);
  assert.equal(back.withdrawn_from, null);
  assert.equal(back.fee_received_date, '2026-01-05');
  assert.equal(back.position_anchor_date, '2026-01-03', 'their old place');
});

test('an approved family goes back to approved', async () => {
  await actions.withdraw(approvedId, { date: '2026-11-01', byBreeder: true });
  assert.equal((await actions.undoWithdrawal(approvedId, { today: '2026-11-02' })).status, 'approved');
});

test("a withdrawal from the family's own status page has no undo", async () => {
  await actions.withdraw(entryId, { date: '2026-11-01' });
  const w = await waitlistEntryRepo.getById(entryId);
  assert.equal(rules.canUndoWithdrawal(w, '2026-11-02'), false);
  await assert.rejects(actions.undoWithdrawal(entryId, { today: '2026-11-02' }), /can no longer be undone/);
});

test('past 7 days the undo is refused', async () => {
  await actions.withdraw(entryId, { date: '2026-11-01', byBreeder: true });
  await assert.rejects(actions.undoWithdrawal(entryId, { today: '2026-11-09' }), /can no longer be undone/);
  assert.equal((await waitlistEntryRepo.getById(entryId)).status, 'withdrawn');
});

test('once the family has re-applied the undo is refused, so they are never on the list twice', async () => {
  await actions.withdraw(entryId, { date: '2026-11-01', byBreeder: true });
  await actions.reapply(entryId, { date: '2026-11-02' });
  await assert.rejects(actions.undoWithdrawal(entryId, { today: '2026-11-03' }), /applied again/);
});
