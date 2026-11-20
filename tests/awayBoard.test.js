// awayBoard.test.js — where a boarding stay is (vocab.boardingStayAt): Away from
// home lists only dogs that are somewhere else; a sold pup's deferred pickup or
// extended stay, and a stud visiting us, are the board's "Staying with us" rows.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { boardingStayAt } from '../shared/data/vocab.js';
import { boardingEvent, trainingStayEvent } from '../shared/data/goHome.js';
import { studBoardingPrefill } from '../shared/data/studRules.js';

const ev = (details) => ({ event_type: 'boarding', details });

test('boardingStayAt: the Where choice wins', () => {
  assert.equal(boardingStayAt(ev({ stay_at: 'with_us', location: 'Handler' })), 'with_us');
  assert.equal(boardingStayAt(ev({ stay_at: 'away', boarding_reason: 'Deferred pickup' })), 'away');
});

test('boardingStayAt: a stay logged before Where is worked out', () => {
  assert.equal(boardingStayAt(ev({ sale_id: 's', extra_charge_id: 'x' })), 'with_us', 'a stay extra, whatever its title or reason');
  assert.equal(boardingStayAt(ev({ boarding_reason: 'Training', sale_id: 's', extra_charge_id: 'x' })), 'with_us');
  assert.equal(boardingStayAt(ev({ sale_id: 's', pickup_boarding: 'yes' })), 'with_us', 'a pickup\'s standard boarding');
  assert.equal(boardingStayAt(ev({ boarding_reason: ' deferred pickup ' })), 'with_us');
  assert.equal(boardingStayAt(ev({ boarding_reason: 'Extended stay' })), 'with_us');
  assert.equal(boardingStayAt(ev({ boarding_reason: 'Stud service', location: 'With us' })), 'with_us', 'a stud coming to us');
  assert.equal(boardingStayAt(ev({ boarding_reason: 'Training', location: 'Trainer' })), 'away', 'a trip to a trainer');
  assert.equal(boardingStayAt(ev({})), 'away');
  assert.equal(boardingStayAt({ event_type: 'boarding' }), 'away', 'no details');
});

test('the stays the app logs say where they are', () => {
  const pup = { id: 'p' };
  const stay = trainingStayEvent(pup, { id: 's' }, { id: 'x', label: '12 Week Extended Stay', boarding_days: 84 }, '2026-11-01');
  assert.equal(stay.details.stay_at, 'with_us');
  assert.equal(stay.details.boarding_reason, 'Extended stay');
  assert.equal(boardingEvent(pup, '2026-11-01').details.stay_at, 'with_us');
  const svc = { sent_date: '2026-01-01', returned_date: '2026-01-05' };
  assert.equal(studBoardingPrefill({ ...svc, direction: 'to_us' }).details.stay_at, 'with_us');
  assert.equal(studBoardingPrefill({ ...svc, direction: 'to_partner' }, { address: '1 Main St' }).details.stay_at, 'away');
});

let db; let eventRepo; let getAwayBoardRows; let getStayingWithUsRows;
before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ eventRepo } = await import('../shared/data/eventRepo.js'));
  ({ getAwayBoardRows, getStayingWithUsRows } = await import('../shared/data/awayBoard.js'));
});
beforeEach(async () => { for (const t of db.tables) await t.clear(); });

test('the board splits current stays into away and with us', async () => {
  const board = (subject_id, details, title = 'Boarding') => eventRepo.create({ subject_type: 'dog', subject_id, event_type: 'boarding', event_date: '2026-01-01', title, details });
  await board('away', { location: 'Handler', boarding_reason: 'With handler / show circuit' });
  await board('pup', { sale_id: 's', extra_charge_id: 'x' }, '12 Week Extended Stay');
  await board('late', { boarding_reason: 'Deferred pickup' });
  assert.deepEqual((await getAwayBoardRows()).map((r) => r.dogId), ['away']);
  const withUs = await getStayingWithUsRows();
  assert.deepEqual(withUs.map((r) => r.dogId).sort(), ['late', 'pup']);
  assert.equal(withUs.find((r) => r.dogId === 'pup').title, '12 Week Extended Stay');
});
