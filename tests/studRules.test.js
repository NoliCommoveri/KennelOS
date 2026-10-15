// studRules.test.js — our stud's outside breedings (outgoing stud services): their
// litters are never asked for, and a pick-of-litter fee brings a "ready to add your
// pick puppy?" reminder 63 + 56 days after the service (shared/data/studRules.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../shared/data/studRules.js';

const svc = (o = {}) => ({ id: 's', direction: 'outgoing', status: 'completed', fee_structure: 'pick_of_litter', our_dog_id: 'stud', partner_dog_id: 'dam', sent_date: '2026-01-01', returned_date: '2026-01-05', ...o });

test('outgoingPairingIds: live outgoing services with a breeding', () => {
  const ids = S.outgoingPairingIds([svc({ pairing_id: 'p1' }), svc({ pairing_id: 'p2', direction: 'incoming' }), svc({ pairing_id: 'p3', is_archived: true }), svc()]);
  assert.deepEqual([...ids], ['p1']);
});

test('pick ready 63 + 56 days after the service (returned, else sent)', () => {
  assert.equal(S.pickReadyDate(svc()), '2026-05-04');
  assert.equal(S.pickReadyDate(svc({ returned_date: null })), '2026-04-30');
  assert.equal(S.pickReadyDate(svc({ returned_date: null, sent_date: null })), null);
});

test('pickDue: outgoing, completed, a pick in the fee, ready, not on file or settled', () => {
  assert.equal(S.pickDue(svc(), [], '2026-05-03'), false, 'not ready yet');
  assert.equal(S.pickDue(svc(), [], '2026-05-04'), true);
  assert.equal(S.pickDue(svc({ fee_structure: 'flat_plus_pick' }), [], '2026-06-01'), true);
  assert.equal(S.pickDue(svc({ fee_structure: 'flat_fee' }), [], '2026-06-01'), false);
  assert.equal(S.pickDue(svc({ direction: 'incoming' }), [], '2026-06-01'), false, 'their pick from our litter isn\'t ours to add');
  assert.equal(S.pickDue(svc({ status: 'in_progress' }), [], '2026-06-01'), false);
  assert.equal(S.pickDue(svc({ pick_status: 'Claimed' }), [], '2026-06-01'), false);
  assert.equal(S.pickDue(svc({ pick_status: 'waived' }), [], '2026-06-01'), false);
  assert.equal(S.pickDue(svc({ pick_status: 'pending' }), [], '2026-06-01'), true);
});

test('a pup of that stud out of that dam, born after the service, settles it', () => {
  const pup = { sire_id: 'stud', dam_id: 'dam', date_of_birth: '2026-03-07' };
  assert.equal(S.pickDue(svc(), [pup], '2026-06-01'), false);
  assert.equal(S.pickDue(svc(), [{ ...pup, date_of_birth: '2025-03-07' }], '2026-06-01'), true, 'an older litter of the same pair');
  assert.equal(S.pickDue(svc(), [{ ...pup, pedigree_only: true }], '2026-06-01'), true);
  assert.equal(S.pickDue(svc(), [{ ...pup, dam_id: 'other' }], '2026-06-01'), true);
});

test('pickPupDefaults: ours, a puppy, the pair, the stud\'s breed, estimated birth', () => {
  assert.deepEqual(S.pickPupDefaults(svc({ kennel_id: 'K' }), { breed: 'Boston Terrier' }), {
    sire_id: 'stud', dam_id: 'dam', date_of_birth: '2026-03-09', dob_is_estimated: true,
    status: 'puppy', ownership_type: 'owned', disposition: 'keeping', breed: 'Boston Terrier', kennel_id: 'K'
  });
});
