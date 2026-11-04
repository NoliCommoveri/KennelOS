// waitlistUndo.test.js — the 7-day undos for a mistap: a withdrawal she entered
// ("They withdrew" on the family's page), through the real actions and repos on
// the in-memory database: back to the status they left at their old place, only
// for her own entry (not one from the family's status page), only within 7 days,
// and never once the family has re-applied. Then her removal, a decline, a fee
// expired and a fee received.
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

// --- The other undos for a mistap: her removal, a decline, a fee expired, a fee received.

const newApplied = async (name) => {
  const c = await contactRepo.create({ name, email: `${name.toLowerCase()}@example.com` });
  return (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'applied', applied_date: '2026-10-20', pref_sex: 'any' })).id;
};

test('her removal: back on the list at their old place, no pass forgiven, 7 days', async () => {
  await actions.removeByBreeder(entryId, { date: '2026-11-01' });
  await assert.rejects(actions.undoRemoval(entryId, { today: '2026-11-09' }), /can no longer be undone/);
  const back = await actions.undoRemoval(entryId, { today: '2026-11-08' });
  assert.equal(back.status, 'active');
  assert.equal(back.removed_reason, null);
  assert.equal(back.position_anchor_date, '2026-01-03');
});

test('a decline: the application is open again; refused once they re-applied', async () => {
  const id = await newApplied('Ng');
  await actions.decline(id, { date: '2026-11-01' });
  const back = await actions.undoDecline(id, { today: '2026-11-03' });
  assert.equal(back.status, 'applied');
  assert.equal(back.declined_date, null);
  await actions.decline(id, { date: '2026-11-01' });
  await actions.reapply(id, { date: '2026-11-02' });
  await assert.rejects(actions.undoDecline(id, { today: '2026-11-03' }), /applied again/);
});

test('a fee expired: approved again; one closed before expired_date was kept has no undo', async () => {
  await actions.markFeeExpired(approvedId, { date: '2026-11-01' });
  assert.equal((await waitlistEntryRepo.getById(approvedId)).expired_date, '2026-11-01');
  await assert.rejects(actions.undoExpire(approvedId, { today: '2026-11-09' }), /can no longer be undone/);
  const back = await actions.undoExpire(approvedId, { today: '2026-11-08' });
  assert.equal(back.status, 'approved');
  assert.equal(back.expired_date, null);
  const old = await waitlistEntryRepo.update(approvedId, { status: 'expired' });
  assert.equal(rules.canUndoExpire(old, '2026-11-02'), false);
});

test('fee received: back to approved with the fee not received, until they are offered a turn', async () => {
  const today = new Date().toISOString().slice(0, 10);
  await actions.feeReceived(approvedId, { date: '2026-10-30', amount: 250, method: 'Cash', reference: 'r1' });
  const active = await waitlistEntryRepo.getById(approvedId);
  assert.equal(active.status, 'active');
  assert.equal(rules.canUndoFeeReceived(active, [], today), true);
  assert.equal(rules.canUndoFeeReceived(active, [{ entry_id: approvedId }], today), false, 'offered a turn: no undo');
  const back = await actions.undoFeeReceived(approvedId, { today });
  assert.equal(back.status, 'approved');
  assert.equal(back.fee_received_date, null);
  assert.equal(back.fee_received_at, null);
  assert.equal(back.fee_payment_method, '');
  assert.equal(back.fee_amount, 250, 'the fee amount stands');
});

test('an approval that put them straight on the list (no fee) has no fee undo', async () => {
  const id = await newApplied('Ode');
  await kennelRepo.update(K.id, { waitlist_config: { ...K.waitlist_config, fee_amount: 0 } });
  const e = await actions.approve(id, { date: '2026-11-01' });
  assert.equal(e.status, 'active', 'no fee: straight on the list');
  assert.equal(rules.canUndoFeeReceived(e, [], new Date().toISOString().slice(0, 10)), false);
});
