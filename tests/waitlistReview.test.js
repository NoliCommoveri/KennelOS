// waitlistReview.test.js — Kels's "Review my waitlist" (Kels Roadmap §3.16): its
// pure rules (data/waitlistReview.js), the snooze it adds to Today's nudges
// (nudgeState), and the three actions it added (previewNextTurn, extendTurn, a
// back-out she heard about some other way), on the in-memory database.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { readNudgeKey, STEP_OF, reviewSummary, readinessProblems, outcomeReport } from '../shared/data/waitlistReview.js';

test('readNudgeKey: each waitlist key says who and what it is about', () => {
  assert.equal(readNudgeKey('waitlist-pause-request:e1:2026-10-01:2026-12-01').entryId, 'e1');
  assert.deepEqual([readNudgeKey('waitlist-extra-request:e1:r9').entryId, readNudgeKey('waitlist-extra-request:e1:r9').requestId], ['e1', 'r9']);
  assert.equal(readNudgeKey('waitlist-offer-overdue:t7').turnId, 't7');
  assert.equal(readNudgeKey('waitlist-open-picks:l3:2026-11-01').litterId, 'l3');
  const x = readNudgeKey('extra-due:s1:c2:p3');
  assert.deepEqual([x.saleId, x.chargeId, x.stepId], ['s1', 'c2', 'p3']);
  assert.equal(STEP_OF['waitlist-back-out'], 'backouts');
  assert.equal(STEP_OF['waitlist-applications'], undefined, 'applications are listed by the task itself');
});

test('reviewSummary: the opening line, in the roadmap\'s words; empty when nothing waits', () => {
  assert.equal(reviewSummary({}), '');
  assert.equal(reviewSummary({ backOuts: 1, requests: { extra: 2, pickup: 1 }, messages: 3, applications: 2, fees: 1, picks: ['Daisy\'s litter'], turns: 1 }),
    'Here\'s what\'s waiting on you: 1 family backing out, 3 requests (2 extras, a pickup time), 3 new messages, picks to open on Daisy\'s litter, 1 turn to offer, 2 new applications, 1 fee to check.');
  assert.match(reviewSummary({ ready: 2, removals: 1 }), /2 families who haven't answered "Ready now\?", 1 removal you can still undo\.$/);
});

test('readinessProblems: not set up stops with Set up my waitlist; offline, no own form, form not online each say so and hand off', () => {
  const none = readinessProblems({ setUp: false });
  assert.equal(none.stop, true);
  assert.deepEqual(none.fixes.map((f) => f.task), ['waitlist-setup']);
  assert.deepEqual(readinessProblems({ setUp: true, onlineOffered: true, online: true, formOpen: true, ownForm: true }), { stop: false, lines: [], fixes: [] });
  const offline = readinessProblems({ setUp: true, onlineOffered: true, online: false, ownForm: false });
  assert.equal(offline.stop, false);
  assert.equal(offline.lines.length, 2);
  assert.deepEqual(offline.fixes.map((f) => f.task), ['waitlist-setup', 'form-setup']);
  const closed = readinessProblems({ setUp: true, onlineOffered: true, online: true, formOpen: false, ownForm: true });
  assert.match(closed.lines[0], /can't apply online/);
  assert.deepEqual(closed.fixes.map((f) => f.task), ['form-setup']);
  assert.match(readinessProblems({ setUp: true, onlineOffered: true, online: true, formOpen: true, ownForm: true, publishProblem: 'Sign in again.' }).lines[0], /isn't publishing right now: Sign in again\./);
  assert.equal(readinessProblems({ setUp: true, onlineOffered: false, ownForm: true }).lines.length, 0, 'no online offered: nothing to say about it');
});

test('outcomeReport: the pass, then the changes, then "nobody else" when the turn went nowhere', () => {
  assert.deepEqual(outcomeReport({ passes: { counted: true, used: 1, max: 2 }, next: { id: 't' } }, { name: 'Lee', changes: ['It\'s Kim\'s turn.'] }),
    ['This counts as Lee\'s pass 1 of 2. They keep their place.', 'It\'s Kim\'s turn.']);
  assert.deepEqual(outcomeReport({ passes: { counted: false } }, { name: 'Lee' }), ['This doesn\'t count as a pass for Lee.', 'Nobody else on the list is eligible for your open litters right now.']);
});

// --- On the in-memory database ---------------------------------------------------------

let db; let kennelRepo; let dogRepo; let litterRepo; let contactRepo; let waitlistEntryRepo; let waitlistOfferRepo; let actions; let nudgeState;
const DAY = '2026-10-08';
let K; let A; const ids = {};

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ litterRepo } = await import('../shared/data/litterRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js'));
  ({ waitlistOfferRepo } = await import('../shared/data/waitlistOfferRepo.js'));
  actions = await import('../shared/data/waitlistActions.js');
  nudgeState = await import('../shared/data/nudgeState.js');
});

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, waitlist_config: { max_passes: 2, respond_days: 3 } });
  const dog = (call_name, sex, extra = {}) => dogRepo.create({ call_name, sex, breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id, ...extra });
  const ash = await dog('Ash', 'male');
  const jun = await dog('Juniper', 'female');
  A = await litterRepo.create({ dam_id: jun.id, sire_id: ash.id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-08-01', nickname: 'Litter A' });
  ids.pip = (await dog('Pip', 'male', { status: 'puppy', litter_id: A.id, disposition: 'available' })).id;
  const fam = async (name, fee) => {
    const c = await contactRepo.create({ name, email: `${name.toLowerCase()}@example.com` });
    return (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'active', approved_date: '2026-01-01', fee_received_date: fee, pref_sex: 'any' })).id;
  };
  ids.lee = await fam('Lee', '2026-01-01');
  ids.kim = await fam('Kim', '2026-01-02');
});

test('previewNextTurn: who would get the turn, without offering it; nobody while a turn is open', async () => {
  assert.equal(await actions.previewNextTurn(K.id, { today: DAY }), null, 'picks not open: nobody yet');
  await litterRepo.update(A.id, { picks_opened_date: DAY });
  const next = await actions.previewNextTurn(K.id, { today: DAY });
  assert.equal(next.entry.id, ids.lee);
  assert.deepEqual(next.litters.map((x) => x.litter.id), [A.id]);
  assert.equal((await waitlistOfferRepo.getByKennel(K.id)).length, 0, 'nothing offered by a preview');
  await actions.offerNextTurn(K.id, { today: DAY });
  assert.equal(await actions.previewNextTurn(K.id, { today: DAY }), null);
});

test('extendTurn: every open offer of the turn gets the new deadline, noted; a past date is refused', async () => {
  const turn = await actions.openPicks(A.id, { date: DAY });
  await assert.rejects(actions.extendTurn(turn.id, { until: DAY, date: DAY }), /after today/);
  const out = await actions.extendTurn(turn.id, { until: '2026-10-20', date: DAY });
  assert.equal(out.respond_by_date, '2026-10-20');
  const rows = (await waitlistOfferRepo.getByKennel(K.id)).filter((o) => o.outcome === 'open');
  assert.ok(rows.every((o) => o.respond_by_date === '2026-10-20' && /Given more time on 2026-10-08/.test(o.notes)));
});

test('approveBackOut with `told`: a back-out she heard about some other way takes the same path; without it, still refused', async () => {
  const turn = await actions.openPicks(A.id, { date: DAY });
  await actions.recordOutcome(turn.offers[0].id, 'accepted', { date: DAY, chosenDogId: ids.pip, depositDate: DAY, depositAmount: 500 });
  await assert.rejects(actions.approveBackOut(ids.lee, { outcome: 'keep', date: DAY }), /no back-out request/);
  const res = await actions.approveBackOut(ids.lee, { outcome: 'keep', pup: 'available', date: DAY, told: { reason: { id: 'told', label: 'They told you' } } });
  assert.equal(res.entry.status, 'withdrawn');
  assert.equal(res.entry.back_out_request.by, 'breeder');
  assert.equal(res.entry.back_out_request.decided, 'approved');
  assert.equal(res.sale.status, 'cancelled');
  assert.equal((await dogRepo.getById(ids.pip)).disposition, 'available');
});

test('snooze: hidden until its day, then back; a plain dismiss stays', () => {
  nudgeState.clearAll();
  nudgeState.snooze('waitlist-open-picks:l1:2026-10-08', '2026-10-11');
  assert.equal(nudgeState.isDismissed('waitlist-open-picks:l1:2026-10-08', '2026-10-10'), true);
  assert.equal(nudgeState.isDismissed('waitlist-open-picks:l1:2026-10-08', '2026-10-11'), false, 'back on its day');
  assert.equal(nudgeState.snoozedUntil('waitlist-open-picks:l1:2026-10-08'), '2026-10-11');
  assert.equal(nudgeState.dismissedAt('waitlist-open-picks:l1:2026-10-08'), null);
  nudgeState.dismiss('x');
  assert.equal(nudgeState.isDismissed('x', '2099-01-01'), true);
});
